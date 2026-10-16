#!/usr/bin/env python3
"""
Pickleball N-GO — Local Visual Annotation HTTP Server (TASK-V8-609)
==================================================================
Provides loopback-only (127.0.0.1) HTTP server for:
1. Serving tools/annotate_visual.html without external CDN dependencies.
2. HTTP Range streaming of local video files in data/videos/ with path traversal guards.
3. Candidate events reading & safe transactional auditing via manifest_annotations_v2.
4. Independent blind-mode Ground Truth recording into ground_truth_events.json.
5. Strict output isolation: pilot data writes strictly to designated output directory
   (never overwriting formal data/v2 without explicit configuration).
"""

import argparse
import csv
import hashlib
import json
import math
import mimetypes
import os
import re
import shutil
import sys
import time
from http import HTTPStatus
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Add repo root to path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import scripts.manifest_annotations_v2 as man_v2_mod

PILOT_VIDEOS = ["dink2.mp4", "smash2.mp4", "serve_legal1.mp4"]
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def safe_resolve_path(base_dir, requested_path):
    """
    Resolve requested_path relative to base_dir and verify that it strictly
    resides within base_dir. Rejects directory traversal (e.g. '../').
    Returns resolved absolute path or raises PermissionError.
    """
    base_dir = os.path.realpath(base_dir)
    joined = os.path.realpath(os.path.join(base_dir, requested_path.lstrip("/\\")))
    if joined != base_dir and not joined.startswith(base_dir + os.sep):
        raise PermissionError(f"Path traversal blocked: '{requested_path}' outside '{base_dir}'")
    return joined


def validate_safe_output_dir(output_dir, manifest_path=None, videos_dir=None, repo_root=None):
    """
    Validate that output_dir is an isolated, safe directory.
    Strictly forbids:
      - Any path resolving into any repository data/** directory (direct or via symlinks),
        including worktree and main repository data directories.
      - Any path resolving to the same directory as manifest_path, or pointing inside/to manifest_path.
      - Any path resolving into or identical to videos_dir.
      - Symlink aliases that resolve back into forbidden areas.
    Does NOT create directories if validation fails.
    Returns canonical realpath of output_dir if valid, otherwise raises ValueError.
    """
    if not output_dir or not str(output_dir).strip():
        raise ValueError("output_dir must be an explicitly specified non-empty path")

    raw_path = os.path.abspath(output_dir)

    # Resolve symlinks in existing ancestors even if leaf does not exist yet
    curr = raw_path
    uncreated_parts = []
    while curr and not os.path.exists(curr):
        curr, tail = os.path.split(curr)
        if not tail:
            break
        uncreated_parts.append(tail)

    if os.path.exists(curr):
        real_ancestor = os.path.realpath(curr)
        real_out = os.path.abspath(os.path.join(real_ancestor, *reversed(uncreated_parts)))
    else:
        real_out = os.path.realpath(raw_path)

    # Collect all actual repository data/** roots across worktree and source roots
    data_roots = set()
    root = os.path.realpath(repo_root or REPO_ROOT)
    data_roots.add(os.path.realpath(os.path.join(root, "data")))

    for p in [repo_root, REPO_ROOT, manifest_path, videos_dir]:
        if not p:
            continue
        p_real = os.path.realpath(os.path.abspath(p))
        if os.path.isdir(p_real) and os.path.basename(p_real) != "data":
            cand_data = os.path.realpath(os.path.join(p_real, "data"))
            if os.path.isdir(cand_data):
                data_roots.add(cand_data)
        # Check all ancestors for any directory named 'data'
        cur_anc = p_real
        while cur_anc and cur_anc != os.path.dirname(cur_anc):
            if os.path.basename(cur_anc) == "data":
                data_roots.add(cur_anc)
            cur_anc = os.path.dirname(cur_anc)

    # 1. Check against all discovered repository data/** directories
    for d_root in sorted(data_roots):
        if real_out == d_root or real_out.startswith(d_root + os.sep):
            raise ValueError(
                f"SECURITY VIOLATION: output_dir '{output_dir}' resolves to '{real_out}' "
                f"which is inside the repository's data/** directory '{d_root}'. Formal dataset is strictly read-only!"
            )

    # 2. Check against source manifest and its directory
    if manifest_path:
        real_manifest = os.path.realpath(os.path.abspath(manifest_path))
        real_manifest_dir = os.path.dirname(real_manifest)
        if real_out == real_manifest:
            raise ValueError(
                f"SECURITY VIOLATION: output_dir '{output_dir}' resolves directly to source manifest '{real_manifest}'."
            )
        if real_out == real_manifest_dir or real_out.startswith(real_manifest_dir + os.sep):
            raise ValueError(
                f"SECURITY VIOLATION: output_dir '{output_dir}' resolves to '{real_out}' "
                f"which is identical to source manifest or its directory '{real_manifest_dir}'. "
                f"Pilot output must be in an isolated directory!"
            )
        if real_manifest.startswith(real_out + os.sep):
            raise ValueError(
                f"SECURITY VIOLATION: output_dir '{output_dir}' resolves to an ancestor of source manifest '{real_manifest}'."
            )

    # 3. Check against videos_dir
    if videos_dir:
        real_videos_dir = os.path.realpath(os.path.abspath(videos_dir))
        if real_out == real_videos_dir or real_out.startswith(real_videos_dir + os.sep):
            raise ValueError(
                f"SECURITY VIOLATION: output_dir '{output_dir}' resolves to '{real_out}' "
                f"which is identical to or inside videos directory '{real_videos_dir}'."
            )
        if real_videos_dir.startswith(real_out + os.sep):
            raise ValueError(
                f"SECURITY VIOLATION: output_dir '{output_dir}' resolves to an ancestor of videos directory '{real_videos_dir}'."
            )

    return real_out


def get_video_duration(vpath):
    """
    Get duration in seconds of video file at vpath using cv2.VideoCapture.
    Returns float duration in seconds, or None if unreadable / cannot be determined.
    """
    if not vpath or not os.path.isfile(vpath) or os.path.getsize(vpath) == 0:
        return None
    try:
        import cv2
        cap = cv2.VideoCapture(vpath)
        if not cap.isOpened():
            return None
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        cap.release()
        if fps > 0 and frame_count > 0:
            return round(frame_count / fps, 4)
    except Exception:
        pass
    return None


class AnnotationRequestHandler(BaseHTTPRequestHandler):
    server_config = {}

    def log_message(self, format, *args):
        # Override to suppress noisy stdout during unit tests unless debug enabled
        if self.server_config.get("debug", False):
            super().log_message(format, *args)

    def _send_json(self, status_code, payload):
        data = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(data)

    def _send_error_json(self, status_code, message, extra=None):
        payload = {"error": message, "status": "ERROR"}
        if extra:
            payload.update(extra)
        self._send_json(status_code, payload)


    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Invalid JSON request body: {e}")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        try:
            if path in ("/", "/index.html", "/tools/annotate_visual.html", "/annotate_visual.html"):
                self._handle_serve_ui()
            elif path == "/api/status":
                self._handle_get_status()
            elif path == "/api/videos":
                self._handle_get_videos()
            elif path == "/api/candidates":
                self._handle_get_candidates(query)
            elif path == "/api/ground_truth/export":
                self._handle_get_ground_truth_export()
            elif path == "/api/ground_truth":
                self._handle_get_ground_truth(query)
            elif path.startswith("/video/"):
                video_name = path[len("/video/"):]
                self._handle_stream_video(video_name)
            else:
                self._send_error_json(HTTPStatus.NOT_FOUND, f"Endpoint not found: {path}")
        except (BrokenPipeError, ConnectionResetError):
            # Client closed the connection early (common when browser seeks or closes video stream)
            pass
        except PermissionError as pe:
            self._send_error_json(HTTPStatus.FORBIDDEN, str(pe))
        except Exception as exc:
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"Server error: {exc}")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/candidates/audit":
                self._handle_post_candidate_audit()
            elif path == "/api/candidates/init":
                self._handle_post_candidate_init()
            elif path == "/api/ground_truth":
                self._handle_post_ground_truth()
            else:
                self._send_error_json(HTTPStatus.NOT_FOUND, f"Endpoint not found: {path}")
        except PermissionError as pe:
            self._send_error_json(HTTPStatus.FORBIDDEN, str(pe))
        except ValueError as ve:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(ve))
        except man_v2_mod.ManifestConflictError as ce:
            self._send_error_json(HTTPStatus.CONFLICT, str(ce), extra={"error_code": "CONFLICT"})
        except man_v2_mod.ManifestValidationError as mve:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(mve))
        except Exception as exc:
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"Server error: {exc}")


    # =========================================================================
    # Request Handlers
    # =========================================================================

    def _handle_serve_ui(self):
        html_path = self.server_config["tools_html"]
        if not os.path.exists(html_path):
            self._send_error_json(HTTPStatus.NOT_FOUND, f"UI template not found at '{html_path}'")
            return
        with open(html_path, "rb") as f:
            content = f.read()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)

    def _get_video_duration(self, video_name):
        configured_durations = self.server_config.get("video_durations")
        if configured_durations and video_name in configured_durations:
            return float(configured_durations[video_name])

        vdir = self.server_config.get("videos_dir")
        if not vdir:
            return None
        vpath = os.path.join(vdir, video_name)
        return get_video_duration(vpath)

    def _get_all_pilot_video_durations(self):
        durations = {}
        configured = self.server_config.get("video_durations") or {}
        durations.update(configured)
        vdir = self.server_config.get("videos_dir")
        if vdir and os.path.exists(vdir):
            for pv in PILOT_VIDEOS:
                if pv not in durations:
                    vp = os.path.join(vdir, pv)
                    if os.path.isfile(vp):
                        d = get_video_duration(vp)
                        if d is not None and d > 0:
                            durations[pv] = d
        return durations

    def _get_video_sha(self, video_name):
        configured_shas = self.server_config.get("video_shas")
        if configured_shas and video_name in configured_shas:
            return configured_shas[video_name]

        vdir = self.server_config.get("videos_dir")
        if not vdir:
            return None
        vpath = os.path.join(vdir, video_name)
        if not (os.path.isfile(vpath) and os.access(vpath, os.R_OK) and os.path.getsize(vpath) > 0):
            return None
        try:
            return man_v2_mod.compute_file_sha256(vpath)
        except Exception:
            return None

    def _get_all_pilot_video_shas(self):
        shas = {}
        configured = self.server_config.get("video_shas") or {}
        shas.update(configured)
        vdir = self.server_config.get("videos_dir")
        if vdir and os.path.exists(vdir):
            for pv in PILOT_VIDEOS:
                if pv not in shas:
                    vp = os.path.join(vdir, pv)
                    if os.path.isfile(vp) and os.access(vp, os.R_OK) and os.path.getsize(vp) > 0:
                        try:
                            s = man_v2_mod.compute_file_sha256(vp)
                            if s and len(s) == 64:
                                shas[pv] = s
                        except Exception:
                            pass
        return shas

    def _get_ground_truth_dict(self):
        output_dir = self.server_config["output_dir"]
        gt_path = os.path.join(output_dir, "ground_truth_events.json")
        if not os.path.exists(gt_path):
            return None
        with open(gt_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        video_durations = self._get_all_pilot_video_durations()
        video_shas = self._get_all_pilot_video_shas()
        man_v2_mod.validate_ground_truth_events(
            data,
            allowed_videos=PILOT_VIDEOS,
            video_durations=video_durations,
            video_shas=video_shas,
        )
        return data

    def _is_video_ground_truth_frozen(self, vname):
        try:
            gt_data = self._get_ground_truth_dict()
            if not gt_data:
                return False
            vinfo = gt_data.get("videos", {}).get(vname, {})
            if vinfo.get("status") != "FROZEN" or vinfo.get("full_video_reviewed") is not True:
                return False

            # Verify recorded SHA matches current disk SHA
            rec_sha = vinfo.get("video_sha256")
            if not rec_sha or not isinstance(rec_sha, str) or len(rec_sha.strip()) != 64:
                return False
            curr_sha = self._get_video_sha(vname)
            if not curr_sha or curr_sha.strip().lower() != rec_sha.strip().lower():
                return False

            return True
        except Exception:
            return False

    def _handle_get_status(self):
        output_dir = self.server_config["output_dir"]
        active_manifest = self._get_active_manifest_path()
        gt_path = os.path.join(output_dir, "ground_truth_events.json")

        video_statuses = {}
        for pv in PILOT_VIDEOS:
            frozen = self._is_video_ground_truth_frozen(pv)
            video_statuses[pv] = {
                "ground_truth_frozen": frozen,
                "candidate_audit_unlocked": frozen,
            }

        self._send_json(HTTPStatus.OK, {
            "status": "OK",
            "host": self.server_config["host"],
            "port": self.server_config["port"],
            "videos_dir": self.server_config["videos_dir"],
            "base_manifest_path": self.server_config["manifest_path"],
            "output_dir": output_dir,
            "active_manifest_path": active_manifest,
            "ground_truth_path": gt_path,
            "pilot_videos": PILOT_VIDEOS,
            "video_statuses": video_statuses,
            "has_active_manifest": os.path.exists(active_manifest),
            "has_ground_truth": os.path.exists(gt_path),
        })

    def _handle_get_videos(self):
        vdir = self.server_config["videos_dir"]
        videos = []
        if os.path.exists(vdir):
            for fname in sorted(os.listdir(vdir)):
                if fname.lower().endswith((".mp4", ".mov")):
                    fpath = os.path.join(vdir, fname)
                    sz = os.path.getsize(fpath)
                    is_pilot = fname in PILOT_VIDEOS
                    frozen = self._is_video_ground_truth_frozen(fname)
                    videos.append({
                        "filename": fname,
                        "size_bytes": sz,
                        "size_mb": round(sz / (1024 * 1024), 2),
                        "is_pilot": is_pilot,
                        "ground_truth_frozen": frozen,
                        "candidate_audit_unlocked": frozen,
                    })

        self._send_json(HTTPStatus.OK, {
            "videos": videos,
            "total_count": len(videos),
            "pilot_count": len([v for v in videos if v["is_pilot"]]),
        })

    def _get_active_manifest_path(self):
        """
        Returns path to the candidate manifest in output_dir if present,
        otherwise falls back to read-only base_manifest_path.
        """
        output_dir = self.server_config["output_dir"]
        out_manifest = os.path.join(output_dir, "candidate_events_manifest.csv")
        if os.path.exists(out_manifest):
            return out_manifest
        return self.server_config["manifest_path"]

    def _handle_get_candidates(self, query):
        vname = query.get("video", [None])[0]
        if vname:
            vname = os.path.basename(vname)
            # Enforce Blind Review First: Video must complete blind review and be frozen
            if not self._is_video_ground_truth_frozen(vname):
                self._send_error_json(
                    HTTPStatus.FORBIDDEN,
                    f"Candidate audit is locked for '{vname}'. You must first complete the blind full-video "
                    f"ground truth review, verify full_video_reviewed=True, and freeze the ground truth before "
                    f"candidate audit is permitted.",
                    extra={
                        "error_code": "BLIND_REVIEW_REQUIRED",
                        "video": vname,
                        "ground_truth_frozen": False,
                    }
                )
                return

        manifest_path = self._get_active_manifest_path()
        if not os.path.exists(manifest_path):
            self._send_json(HTTPStatus.OK, {
                "events": [],
                "total_count": 0,
                "audited_count": 0,
                "pending_count": 0,
                "manifest_source": "NONE",
            })
            return

        state = man_v2_mod.load_and_validate_manifest(manifest_path)
        all_rows = state["rows"]

        filtered = []
        tp_count = 0
        fp_count = 0
        pending_count = 0

        for r in all_rows:
            r_vid = r.get("video")
            # If no vname filter is specified, only return candidates for videos whose ground truth is frozen
            if not vname and not self._is_video_ground_truth_frozen(r_vid):
                continue
            if vname and r_vid != vname:
                continue

            filtered.append(r)
            mv = r.get("manual_verified", "").strip().upper()
            it = r.get("is_true_stroke", "").strip().upper()
            if (mv, it) in [("HUMAN_CONFIRMED", "TRUE"), ("VERIFIED_TRUE", "TRUE")]:
                tp_count += 1
            elif (mv, it) in [("HUMAN_REJECTED", "FALSE"), ("VERIFIED_FALSE", "FALSE")]:
                fp_count += 1
            else:
                pending_count += 1

        self._send_json(HTTPStatus.OK, {
            "video_filter": vname,
            "events": filtered,
            "total_count": len(filtered),
            "tp_count": tp_count,
            "fp_count": fp_count,
            "pending_count": pending_count,
            "is_isolated_copy": manifest_path != self.server_config["manifest_path"],
            "manifest_path": manifest_path,
        })

    def _ensure_output_manifest_copy(self):
        output_dir = self.server_config["output_dir"]
        os.makedirs(output_dir, exist_ok=True)
        out_manifest = os.path.join(output_dir, "candidate_events_manifest.csv")
        if os.path.exists(out_manifest):
            return out_manifest, 0

        base_manifest = self.server_config["manifest_path"]
        if not os.path.exists(base_manifest):
            raise FileNotFoundError(f"Base manifest not found: {base_manifest}")

        man_v2_mod.check_no_pending_recovery(output_dir)

        with open(base_manifest, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            rows = list(reader)

        file_specs = [
            {
                "target_path": out_manifest,
                "type": "csv",
                "fieldnames": fieldnames,
                "rows": rows,
            }
        ]
        man_v2_mod.batch_publish_files(file_specs, auto_recover=True)
        return out_manifest, len(rows)

    def _handle_post_candidate_init(self):
        """
        Initialize an isolated working copy of the candidate manifest in output_dir
        so that subsequent audits never mutate formal data/v2.
        """
        out_manifest, count = self._ensure_output_manifest_copy()
        self._send_json(HTTPStatus.OK, {
            "status": "INITIALIZED",
            "active_manifest_path": out_manifest,
            "event_count": count,
        })

    def _handle_post_candidate_audit(self):
        body = self._read_json_body()
        video = body.get("video")
        event_id = body.get("event_id")
        manual_verified = body.get("manual_verified")
        is_true_stroke = body.get("is_true_stroke")
        notes = body.get("notes")
        reviewer = body.get("reviewer", "")
        expected_manual_verified = body.get("expected_manual_verified")
        expected_is_true_stroke = body.get("expected_is_true_stroke")
        is_correction = bool(body.get("is_correction", False))
        correction_reason = body.get("correction_reason", "")

        if not video or not event_id:
            raise ValueError("Both 'video' and 'event_id' are required")
        if manual_verified is None or is_true_stroke is None:
            raise ValueError("'manual_verified' and 'is_true_stroke' are required")

        # Enforce Blind Review First: Video ground truth must be frozen before auditing
        if not self._is_video_ground_truth_frozen(video):
            self._send_error_json(
                HTTPStatus.FORBIDDEN,
                f"Candidate audit is locked for '{video}'. Blind ground truth must be completed and frozen first.",
                extra={"error_code": "BLIND_REVIEW_REQUIRED", "video": video}
            )
            return

        out_manifest, _ = self._ensure_output_manifest_copy()

        # Update row using strict transactional publisher with conflict detection
        updated_row = man_v2_mod.update_candidate_manifest_row(
            manifest_path=out_manifest,
            video=video,
            event_id=event_id,
            manual_verified=manual_verified,
            is_true_stroke=is_true_stroke,
            notes=notes,
            reviewer=reviewer,
            expected_manual_verified=expected_manual_verified,
            expected_is_true_stroke=expected_is_true_stroke,
            is_correction=is_correction,
            correction_reason=correction_reason,
            auto_recover=True,
        )

        self._send_json(HTTPStatus.OK, {
            "status": "UPDATED",
            "event": updated_row,
            "manifest_path": out_manifest,
        })

    def _handle_get_ground_truth(self, query):
        vname = query.get("video", [None])[0]
        if vname:
            vname = os.path.basename(vname)

        output_dir = self.server_config["output_dir"]
        gt_path = os.path.join(output_dir, "ground_truth_events.json")

        if not os.path.exists(gt_path):
            self._send_json(HTTPStatus.OK, {
                "ground_truth_exists": False,
                "gt_path": gt_path,
                "version": "2.1.0-ground-truth-pilot",
                "time_base": "media_presentation_time_seconds",
                "events": [],
                "status": "NOT_STARTED",
                "full_video_reviewed": False,
            })
            return

        # Fail-closed read: if file exists but is corrupted, do not swallow
        try:
            with open(gt_path, "r", encoding="utf-8") as f:
                gt_data = json.load(f)
            video_durations = self._get_all_pilot_video_durations()
            video_shas = self._get_all_pilot_video_shas()
            man_v2_mod.validate_ground_truth_events(
                gt_data,
                allowed_videos=PILOT_VIDEOS,
                video_durations=video_durations,
                video_shas=video_shas,
            )
        except Exception as e:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                f"Existing ground truth file at '{gt_path}' is corrupted or unreadable: {e}",
                extra={"error_code": "CORRUPT_EXISTING_GROUND_TRUTH"}
            )
            return

        v_info = gt_data.get("videos", {}).get(vname, {}) if vname else {}
        v_events = v_info.get("events", []) if vname else []
        if not vname:
            for vi in gt_data.get("videos", {}).values():
                v_events.extend(vi.get("events", []))

        self._send_json(HTTPStatus.OK, {
            "ground_truth_exists": True,
            "gt_path": gt_path,
            "reviewer": v_info.get("reviewer", gt_data.get("reviewer", "")),
            "version": gt_data.get("version", ""),
            "time_base": gt_data.get("time_base", ""),
            "video_filter": vname,
            "status": v_info.get("status", "IN_PROGRESS"),
            "full_video_reviewed": v_info.get("full_video_reviewed", False),
            "events": v_events,
            "total_count": len(v_events),
            "audit_trail": v_info.get("audit_trail", []),
        })

    def _handle_post_ground_truth(self):
        body = self._read_json_body()
        reviewer = str(body.get("reviewer", "")).strip()
        video = body.get("video")
        events = body.get("events")
        freeze = bool(body.get("freeze", False))
        full_video_reviewed = bool(body.get("full_video_reviewed", False))
        is_correction = bool(body.get("is_correction", False))
        correction_reason = str(body.get("correction_reason", "")).strip()
        notes = str(body.get("notes", "")).strip()

        if not reviewer:
            raise ValueError("Reviewer identity ('reviewer') is required")
        if not video:
            raise ValueError("'video' filename is required")
        if not isinstance(events, list):
            raise ValueError("'events' must be a list of ground truth event objects")

        video = os.path.basename(video)
        if video not in PILOT_VIDEOS:
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"Video '{video}' is not in allowed pilot videos: {sorted(PILOT_VIDEOS)}",
                extra={"error_code": "INVALID_PILOT_VIDEO", "video": video}
            )
            return

        vdir = self.server_config["videos_dir"]
        try:
            vpath = safe_resolve_path(vdir, video)
        except PermissionError as pe:
            self._send_error_json(HTTPStatus.FORBIDDEN, str(pe))
            return

        if not (os.path.isfile(vpath) and os.access(vpath, os.R_OK) and os.path.getsize(vpath) > 0):
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"Video file '{video}' is missing, empty, or unreadable in '{vdir}'.",
                extra={"error_code": "INVALID_VIDEO_FILE", "video": video}
            )
            return

        try:
            v_sha = man_v2_mod.compute_file_sha256(vpath)
        except Exception as e:
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"Failed to compute SHA-256 for video '{video}': {e}",
                extra={"error_code": "VIDEO_SHA_FAILED", "video": video}
            )
            return

        if not v_sha or len(v_sha) != 64:
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"Invalid SHA-256 calculated for video '{video}': {v_sha}",
                extra={"error_code": "INVALID_VIDEO_SHA", "video": video}
            )
            return

        v_dur = self._get_video_duration(video)
        if v_dur is None or v_dur <= 0:
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"Cannot determine valid duration for video '{video}'. Video may be corrupt or unreadable.",
                extra={"error_code": "INVALID_VIDEO_DURATION", "video": video}
            )
            return

        for idx, ev in enumerate(events):
            if not isinstance(ev, dict):
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"Event #{idx} must be a dictionary object",
                    extra={"error_code": "INVALID_EVENT_FORMAT"}
                )
                return
            ts = ev.get("timestamp_s")
            if ts is None or not isinstance(ts, (int, float)) or math.isnan(ts) or math.isinf(ts):
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"Event #{idx} has invalid timestamp_s: {ts}",
                    extra={"error_code": "INVALID_TIMESTAMP", "event_index": idx}
                )
                return
            if ts < 0.0 or ts > v_dur:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"Event #{idx} timestamp {ts}s exceeds video duration bounds [0.0, {v_dur}s] for '{video}'",
                    extra={"error_code": "TIMESTAMP_OUT_OF_BOUNDS", "event_index": idx, "timestamp_s": ts, "duration_s": v_dur}
                )
                return

        output_dir = self.server_config["output_dir"]
        os.makedirs(output_dir, exist_ok=True)
        gt_path = os.path.join(output_dir, "ground_truth_events.json")

        # Fail-closed check: if existing ground_truth_events.json exists,
        # it MUST be readable and valid JSON; do NOT swallow error!
        gt_data = {
            "version": "2.1.0-ground-truth-pilot",
            "time_base": "media_presentation_time_seconds",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime()),
            "videos": {},
        }

        existing_vinfo = {}
        if os.path.exists(gt_path):
            try:
                with open(gt_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                gt_data = existing
                if "videos" not in gt_data or not isinstance(gt_data["videos"], dict):
                    gt_data["videos"] = {}
                existing_vinfo = gt_data["videos"].get(video, {})
            except Exception as e:
                # Halt write and fail-closed: preserve corrupt file
                self._send_error_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    f"Existing ground truth file at '{gt_path}' is corrupted or invalid: {e}. "
                    f"Halting write to preserve original file bytes (fail-closed).",
                    extra={"error_code": "CORRUPT_EXISTING_GROUND_TRUTH"}
                )
                return

            # Check video SHA immutability against existing ground truth entry
            existing_sha = existing_vinfo.get("video_sha256")
            if existing_sha:
                if not isinstance(existing_sha, str) or len(existing_sha.strip()) != 64:
                    self._send_error_json(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        f"Existing ground truth for '{video}' has invalid recorded SHA-256: '{existing_sha}'",
                        extra={"error_code": "CORRUPT_EXISTING_GROUND_TRUTH", "video": video}
                    )
                    return
                if existing_sha.strip().lower() != v_sha.strip().lower():
                    # Condition 2: 更正請求則依方案回 409 VIDEO_SHA_MISMATCH，並驗證真值檔及既有匯出檔位元組不變。
                    self._send_error_json(
                        HTTPStatus.CONFLICT,
                        f"Video '{video}' content on disk has changed! "
                        f"Recorded SHA-256 is '{existing_sha}', but current disk file SHA-256 is '{v_sha}'. "
                        f"Ground truth cannot be silently rebound to modified video content. "
                        f"Replacing video requires an explicit migration / full blind review reset.",
                        extra={
                            "error_code": "VIDEO_SHA_MISMATCH",
                            "video": video,
                            "recorded_sha256": existing_sha,
                            "current_sha256": v_sha,
                        }
                    )
                    return

            # Validate existing schema with video_shas
            try:
                video_durations = self._get_all_pilot_video_durations()
                video_durations[video] = v_dur
                video_shas = self._get_all_pilot_video_shas()
                video_shas[video] = v_sha
                man_v2_mod.validate_ground_truth_events(
                    existing,
                    allowed_videos=PILOT_VIDEOS,
                    video_durations=video_durations,
                    video_shas=video_shas,
                )
            except Exception as e:
                self._send_error_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    f"Existing ground truth file at '{gt_path}' is corrupted or invalid: {e}. "
                    f"Halting write to preserve original file bytes (fail-closed).",
                    extra={"error_code": "CORRUPT_EXISTING_GROUND_TRUTH"}
                )
                return

        # Check freeze & correction constraints
        was_frozen = bool(
            existing_vinfo.get("status") == "FROZEN" and
            existing_vinfo.get("full_video_reviewed") is True
        )
        if was_frozen and not is_correction:
            self._send_error_json(
                HTTPStatus.CONFLICT,
                f"Video '{video}' ground truth is already FROZEN. Modifying it requires "
                f"an explicit correction request with is_correction=True and a non-empty correction_reason.",
                extra={"error_code": "ALREADY_FROZEN", "video": video}
            )
            return

        if was_frozen and is_correction:
            if not correction_reason:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    "correction_reason is required when modifying a frozen ground truth.",
                    extra={"error_code": "MISSING_CORRECTION_REASON"}
                )
                return

        # If freeze is requested, full_video_reviewed MUST be True
        if freeze and not full_video_reviewed:
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                "full_video_reviewed must be True to freeze ground truth.",
                extra={"error_code": "FULL_VIDEO_REVIEW_REQUIRED"}
            )
            return

        # Determine new status
        iso_now = time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime())
        status = "FROZEN" if (freeze or was_frozen) else "IN_PROGRESS"
        frozen_at = existing_vinfo.get("frozen_at") or (iso_now if status == "FROZEN" else None)

        audit_trail = list(existing_vinfo.get("audit_trail", []))
        if was_frozen and is_correction:
            prev_events = list(existing_vinfo.get("events", []))
            prev_events_json = json.dumps(prev_events, sort_keys=True)
            prev_events_sha = hashlib.sha256(prev_events_json.encode("utf-8")).hexdigest()
            audit_trail.append({
                "timestamp": iso_now,
                "reviewer": reviewer,
                "reason": correction_reason,
                "previous_events": prev_events,
                "previous_events_sha256": prev_events_sha,
                "previous_events_count": len(prev_events),
                "new_events_count": len(events),
            })

        gt_data["videos"][video] = {
            "status": status,
            "full_video_reviewed": full_video_reviewed if freeze else existing_vinfo.get("full_video_reviewed", False),
            "reviewer": reviewer,
            "video_sha256": v_sha,
            "video_duration_s": v_dur,
            "frozen_at": frozen_at,
            "events": events,
            "event_count": len(events),
            "notes": notes or existing_vinfo.get("notes", ""),
            "audit_trail": audit_trail,
        }

        # Validate with man_v2_mod and save atomically
        try:
            durations = self._get_all_pilot_video_durations()
            durations[video] = v_dur
            shas = self._get_all_pilot_video_shas()
            shas[video] = v_sha
            man_v2_mod.save_ground_truth_events(
                gt_path,
                gt_data,
                allowed_videos=PILOT_VIDEOS,
                video_durations=durations,
                video_shas=shas,
                auto_recover=True,
            )
        except Exception as e:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                f"Failed to save ground truth: {e}"
            )
            return

        self._send_json(HTTPStatus.OK, {
            "status": "SAVED",
            "gt_path": gt_path,
            "video": video,
            "video_status": status,
            "saved_count": len(events),
            "full_video_reviewed": gt_data["videos"][video]["full_video_reviewed"],
        })

    def _handle_get_ground_truth_export(self):
        output_dir = self.server_config["output_dir"]
        gt_path = os.path.join(output_dir, "ground_truth_events.json")
        if not os.path.exists(gt_path):
            self._send_json(HTTPStatus.OK, [])
            return

        try:
            with open(gt_path, "r", encoding="utf-8") as f:
                gt_data = json.load(f)

            video_durations = self._get_all_pilot_video_durations()
            video_shas = self._get_all_pilot_video_shas()
            eval_list = man_v2_mod.export_evaluator_ground_truth(
                gt_data,
                only_frozen=True,
                include_unsure=False,
                allowed_videos=PILOT_VIDEOS,
                video_durations=video_durations,
                video_shas=video_shas,
            )
            self._send_json(HTTPStatus.OK, eval_list)
        except Exception as e:
            err_str = str(e).lower()
            if "timestamp" in err_str or "duration" in err_str or "exceeds" in err_str:
                err_code = "TIMESTAMP_OUT_OF_BOUNDS"
            elif "sha" in err_str or "hash" in err_str:
                err_code = "VIDEO_SHA_MISMATCH"
            else:
                err_code = "GROUND_TRUTH_VALIDATION_ERROR"
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                f"Export rejected: ground truth validation failed ({e})",
                extra={"error_code": err_code}
            )


    def _handle_stream_video(self, requested_video):
        """
        Stream video with HTTP Range request support (206 Partial Content).
        Required by browsers for seeking and smooth frame navigation.
        """
        vdir = self.server_config["videos_dir"]
        target_path = safe_resolve_path(vdir, requested_video)

        if not os.path.isfile(target_path):
            self._send_error_json(HTTPStatus.NOT_FOUND, f"Video not found: {requested_video}")
            return

        file_size = os.path.getsize(target_path)
        content_type, _ = mimetypes.guess_type(target_path)
        if not content_type:
            content_type = "video/mp4"

        range_header = self.headers.get("Range")
        if not range_header:
            # Full file request
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                with open(target_path, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # Parse Range header: e.g. "bytes=0-1023" or "bytes=1024-"
        match = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
        if not match:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return

        start_str, end_str = match.groups()
        if start_str and end_str:
            start = int(start_str)
            end = int(end_str)
        elif start_str:
            start = int(start_str)
            end = file_size - 1
        elif end_str:
            suffix_len = int(end_str)
            start = max(0, file_size - suffix_len)
            end = file_size - 1
        else:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return

        if start >= file_size or end >= file_size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return

        length = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        try:
            with open(target_path, "rb") as f:
                f.seek(start)
                remaining = length
                chunk_size = 64 * 1024
                while remaining > 0:
                    to_read = min(chunk_size, remaining)
                    chunk = f.read(to_read)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


def create_annotation_server(
    host=DEFAULT_HOST,
    port=DEFAULT_PORT,
    videos_dir="data/videos",
    manifest_path="data/v2/candidate_events_manifest.csv",
    output_dir=None,
    tools_html="tools/annotate_visual.html",
    video_durations=None,
    video_shas=None,
    debug=False,
    verify_pilot_videos=False,
):
    """
    Factory function to configure and instantiate HTTPServer.
    Enforces safe output_dir validation (realpath check against repo data/**, manifest_path, and videos_dir).
    """
    validated_out = validate_safe_output_dir(
        output_dir=output_dir,
        manifest_path=manifest_path,
        videos_dir=videos_dir,
        repo_root=REPO_ROOT,
    )

    if verify_pilot_videos:
        for v in PILOT_VIDEOS:
            vp = os.path.join(videos_dir, v)
            if not (os.path.isfile(vp) and os.access(vp, os.R_OK)):
                raise FileNotFoundError(f"Pilot video '{v}' not accessible in '{videos_dir}'")

    AnnotationRequestHandler.server_config = {
        "host": host,
        "port": port,
        "videos_dir": os.path.abspath(videos_dir),
        "manifest_path": os.path.abspath(manifest_path),
        "output_dir": validated_out,
        "tools_html": os.path.abspath(tools_html),
        "video_durations": dict(video_durations) if video_durations else None,
        "video_shas": dict(video_shas) if video_shas else None,
        "debug": debug,
    }
    server = HTTPServer((host, port), AnnotationRequestHandler)
    # Update actual bound port (useful if port=0 was passed for ephemeral test ports)
    AnnotationRequestHandler.server_config["port"] = server.server_port
    return server


def main():
    parser = argparse.ArgumentParser(description="Pickleball N-GO Local Annotation Server (TASK-V8-609)")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port (default: 8765)")
    parser.add_argument("--videos-dir", default=os.path.join(REPO_ROOT, "data/videos"), help="Videos directory")
    parser.add_argument("--manifest-path", default=os.path.join(REPO_ROOT, "data/v2/candidate_events_manifest.csv"), help="Base candidate manifest")
    parser.add_argument("--output-dir", required=True, help="Pilot annotations output directory (MUST be an explicitly specified isolated directory)")
    parser.add_argument("--tools-html", default=os.path.join(REPO_ROOT, "tools/annotate_visual.html"), help="Annotation HTML UI file")
    parser.add_argument("--debug", action="store_true", help="Enable verbose debug logging")
    args = parser.parse_args()

    # Security check: strictly bind to loopback
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"SECURITY ERROR: Server must strictly bind to loopback (127.0.0.1), got: {args.host}")
        sys.exit(1)

    # 1. Output directory safety validation (fail-closed, does NOT create dir if invalid)
    try:
        validated_out = validate_safe_output_dir(
            output_dir=args.output_dir,
            manifest_path=args.manifest_path,
            videos_dir=args.videos_dir,
            repo_root=REPO_ROOT,
        )
    except ValueError as ve:
        print(f"\n❌ SECURITY CONFIGURATION ERROR:\n{ve}\n")
        sys.exit(1)

    # 2. Pilot videos existence validation
    missing_videos = []
    for v in PILOT_VIDEOS:
        vp = os.path.join(args.videos_dir, v)
        if not (os.path.isfile(vp) and os.access(vp, os.R_OK)):
            missing_videos.append(v)
    if missing_videos:
        print("\n❌ PILOT VIDEOS NOT FOUND OR UNREADABLE:")
        print(f"Missing videos in '{args.videos_dir}': {missing_videos}")
        print("In isolated worktrees, pass --videos-dir pointing to the read-only video directory in the main repo:")
        print(f"  --videos-dir \"/Users/ethanchen/Desktop/匹克球/test systeam/匹克球N-GO.v1/data/videos\"\n")
        sys.exit(1)

    os.makedirs(validated_out, exist_ok=True)
    server = create_annotation_server(
        host=args.host,
        port=args.port,
        videos_dir=args.videos_dir,
        manifest_path=args.manifest_path,
        output_dir=validated_out,
        tools_html=args.tools_html,
        debug=args.debug,
        verify_pilot_videos=True,
    )

    actual_port = server.server_port
    print("=" * 72)
    print("🎾 Pickleball N-GO — Local Visual Annotation Server (TASK-V8-609)")
    print("=" * 72)
    print(f"📡 Server running at: http://{args.host}:{actual_port}/")
    print(f"📁 Videos directory : {args.videos_dir}")
    print(f"📄 Base manifest    : {args.manifest_path}")
    print(f"💾 Output directory : {validated_out} (isolated, formal data/v2 untouched)")
    print(f"🎯 Pilot videos     : {', '.join(PILOT_VIDEOS)}")
    print("🔒 Security         : Strictly loopback bound; Range streaming enabled")
    print("=" * 72)
    print("Press Ctrl+C to terminate server.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
