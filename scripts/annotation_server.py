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
import mimetypes
import os
import re
import shutil
import sys
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

    def _send_error_json(self, status_code, message):
        self._send_json(status_code, {"error": message, "status": "ERROR"})

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
            if path == "/" or path == "/index.html":
                self._handle_serve_ui()
            elif path == "/api/status":
                self._handle_get_status()
            elif path == "/api/videos":
                self._handle_get_videos()
            elif path == "/api/candidates":
                self._handle_get_candidates(query)
            elif path == "/api/ground_truth":
                self._handle_get_ground_truth(query)
            elif path.startswith("/video/"):
                video_name = path[len("/video/"):]
                self._handle_stream_video(video_name)
            else:
                self._send_error_json(HTTPStatus.NOT_FOUND, f"Endpoint not found: {path}")
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

    def _handle_get_status(self):
        output_dir = self.server_config["output_dir"]
        active_manifest = self._get_active_manifest_path()
        gt_path = os.path.join(output_dir, "ground_truth_events.json")

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
                    videos.append({
                        "filename": fname,
                        "size_bytes": sz,
                        "size_mb": round(sz / (1024 * 1024), 2),
                        "is_pilot": is_pilot,
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
            if vname and r.get("video") != vname:
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

        if not video or not event_id:
            raise ValueError("Both 'video' and 'event_id' are required")
        if manual_verified is None or is_true_stroke is None:
            raise ValueError("'manual_verified' and 'is_true_stroke' are required")

        out_manifest, _ = self._ensure_output_manifest_copy()

        # Update row using strict transactional publisher
        updated_row = man_v2_mod.update_candidate_manifest_row(
            manifest_path=out_manifest,
            video=video,
            event_id=event_id,
            manual_verified=manual_verified,
            is_true_stroke=is_true_stroke,
            notes=notes,
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
                "reviewer": "",
                "version": "2.0.0-ground-truth-pilot",
                "events": [],
            })
            return

        with open(gt_path, "r", encoding="utf-8") as f:
            gt_data = json.load(f)

        v_events = []
        if vname and "videos" in gt_data and vname in gt_data["videos"]:
            v_events = gt_data["videos"][vname].get("events", [])
        elif not vname and "videos" in gt_data:
            for v_info in gt_data["videos"].values():
                v_events.extend(v_info.get("events", []))

        self._send_json(HTTPStatus.OK, {
            "ground_truth_exists": True,
            "gt_path": gt_path,
            "reviewer": gt_data.get("reviewer", ""),
            "version": gt_data.get("version", ""),
            "time_base": gt_data.get("time_base", ""),
            "video_filter": vname,
            "events": v_events,
            "total_count": len(v_events),
        })

    def _handle_post_ground_truth(self):
        body = self._read_json_body()
        reviewer = str(body.get("reviewer", "")).strip()
        video = body.get("video")
        events = body.get("events")

        if not reviewer:
            raise ValueError("Reviewer identity ('reviewer') is required")
        if not video:
            raise ValueError("'video' filename is required")
        if not isinstance(events, list):
            raise ValueError("'events' must be a list of ground truth event objects")

        video = os.path.basename(video)
        output_dir = self.server_config["output_dir"]
        os.makedirs(output_dir, exist_ok=True)
        gt_path = os.path.join(output_dir, "ground_truth_events.json")

        # Load or initialize gt_data structure
        gt_data = {
            "version": "2.0.0-ground-truth-pilot",
            "time_base": "media_presentation_time_seconds",
            "reviewer": reviewer,
            "created_at": body.get("created_at") or man_v2_mod.time.strftime("%Y-%m-%d %H:%M:%S"),
            "videos": {},
        }

        if os.path.exists(gt_path):
            try:
                with open(gt_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                    if isinstance(existing, dict):
                        gt_data = existing
                        gt_data["reviewer"] = reviewer
                        if "videos" not in gt_data or not isinstance(gt_data["videos"], dict):
                            gt_data["videos"] = {}
            except Exception:
                pass

        # Compute video hash if video exists in videos_dir
        vdir = self.server_config["videos_dir"]
        vpath = os.path.join(vdir, video)
        v_sha = None
        if os.path.exists(vpath):
            v_sha = man_v2_mod.compute_file_sha256(vpath)

        gt_data["videos"][video] = {
            "video_sha256": v_sha,
            "events": events,
            "event_count": len(events),
        }

        # Safe transactional write with write-ahead journal
        man_v2_mod.save_ground_truth_events(gt_path, gt_data, auto_recover=True)

        self._send_json(HTTPStatus.OK, {
            "status": "SAVED",
            "gt_path": gt_path,
            "video": video,
            "saved_count": len(events),
        })

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
            with open(target_path, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
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


def create_annotation_server(
    host=DEFAULT_HOST,
    port=DEFAULT_PORT,
    videos_dir="data/videos",
    manifest_path="data/v2/candidate_events_manifest.csv",
    output_dir="_pilot_annotations",
    tools_html="tools/annotate_visual.html",
    debug=False
):
    """
    Factory function to configure and instantiate HTTPServer.
    """
    AnnotationRequestHandler.server_config = {
        "host": host,
        "port": port,
        "videos_dir": os.path.abspath(videos_dir),
        "manifest_path": os.path.abspath(manifest_path),
        "output_dir": os.path.abspath(output_dir),
        "tools_html": os.path.abspath(tools_html),
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
    parser.add_argument("--output-dir", default=os.path.join(REPO_ROOT, "_pilot_annotations"), help="Pilot annotations output directory")
    parser.add_argument("--tools-html", default=os.path.join(REPO_ROOT, "tools/annotate_visual.html"), help="Annotation HTML UI file")
    parser.add_argument("--debug", action="store_true", help="Enable verbose debug logging")
    args = parser.parse_args()

    # Security check: strictly bind to loopback
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"SECURITY ERROR: Server must strictly bind to loopback (127.0.0.1), got: {args.host}")
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)
    server = create_annotation_server(
        host=args.host,
        port=args.port,
        videos_dir=args.videos_dir,
        manifest_path=args.manifest_path,
        output_dir=args.output_dir,
        tools_html=args.tools_html,
        debug=args.debug,
    )

    actual_port = server.server_port
    print("=" * 72)
    print("🎾 Pickleball N-GO — Local Visual Annotation Server (TASK-V8-609)")
    print("=" * 72)
    print(f"📡 Server running at: http://{args.host}:{actual_port}/")
    print(f"📁 Videos directory : {args.videos_dir}")
    print(f"📄 Base manifest    : {args.manifest_path}")
    print(f"💾 Output directory : {args.output_dir} (isolated, formal data/v2 untouched)")
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
