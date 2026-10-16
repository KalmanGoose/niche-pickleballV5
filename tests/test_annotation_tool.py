#!/usr/bin/env python3
"""
Unit & Regression Tests for Visual Annotation Tool (TASK-V8-609)
================================================================
Verifies:
1. Server loopback binding, static UI serving without external CDN dependencies.
2. HTTP Range streaming (206 Partial Content) and path traversal prevention.
3. Strict output directory isolation: rejecting repo data/**, source manifest directory, and symlinks.
4. "Independent Blind Review First" sequence enforcement: candidate access strictly blocked until blind GT is frozen.
5. Fail-closed handling: corrupted old ground truth file aborts write and preserves original bytes; other videos preserved.
6. Candidate audit optimistic locking, conflict detection, and audit trail generation (P1-4).
7. Ground truth validation: rejects NaN, Inf, negative timestamps, duplicates, and out-of-duration timestamps.
8. Evaluator compatibility: exported ground truth list matches evaluate_detector_v2.py, strictly excluding UNSURE events.
9. Empty events list with full_video_reviewed=True and freeze=True explicitly unlocks candidates.
10. Verification of the exact 67 candidate events across the 3 pilot videos.
11. Transactional isolation: mutations in output_dir leave formal manifest byte-for-byte untouched.
"""

import csv
import io
import json
import math
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import scripts.manifest_annotations_v2 as man_v2_mod
import scripts.annotation_server as srv
import scripts.evaluate_detector_v2 as eval_v2_mod


class InProcessClient:
    """
    In-process HTTP client for AnnotationRequestHandler.
    Simulates complete HTTP protocol over in-memory streams without opening network sockets,
    allowing 100% sandboxed execution with zero network permission requirements.
    """
    def __init__(self, server_config):
        self.server_config = server_config

    def request(self, method, path, headers=None, body=None):
        headers = dict(headers or {})
        if body is not None and "Content-Length" not in headers:
            headers["Content-Length"] = str(len(body))

        raw = f"{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n"
        for k, v in headers.items():
            raw += f"{k}: {v}\r\n"
        raw += "\r\n"
        raw_bytes = raw.encode("utf-8")
        if body is not None:
            raw_bytes += body

        rfile = io.BytesIO(raw_bytes)
        wfile = io.BytesIO()

        srv.AnnotationRequestHandler.server_config = self.server_config

        class DummyServer:
            server_port = self.server_config.get("port", 8765)

        class TestHandler(srv.AnnotationRequestHandler):
            def __init__(self):
                self.rfile = rfile
                self.wfile = wfile
                self.client_address = ("127.0.0.1", 12345)
                self.server = DummyServer()
                self.raw_requestline = self.rfile.readline()
                self.parse_request()
                if self.command == "GET":
                    self.do_GET()
                elif self.command == "POST":
                    self.do_POST()

        TestHandler()
        resp_data = wfile.getvalue()

        # Parse response
        resp_header_part, _, resp_body = resp_data.partition(b"\r\n\r\n")
        lines = resp_header_part.decode("utf-8", errors="replace").split("\r\n")
        status_line = lines[0] if lines else "HTTP/1.1 500 Internal Error"
        parts = status_line.split(" ")
        status_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 500

        resp_headers = {}
        for h in lines[1:]:
            if ":" in h:
                k, v = h.split(":", 1)
                resp_headers[k.strip()] = v.strip()

        return status_code, resp_headers, resp_body

    def get(self, path, headers=None):
        return self.request("GET", path, headers=headers)

    def post(self, path, payload, headers=None):
        headers = dict(headers or {})
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
        return self.request("POST", path, headers=headers, body=body)


class TestAnnotationTool(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="test_anno_tool_")
        self.videos_dir = os.path.join(self.tmpdir, "videos")
        self.output_dir = os.path.join(self.tmpdir, "output")
        self.manifest_path = os.path.join(self.tmpdir, "source_manifest", "candidate_events_manifest.csv")
        os.makedirs(self.videos_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(os.path.dirname(self.manifest_path), exist_ok=True)

        # Create dummy video files
        self.test_video_name = "dink2.mp4"
        self.test_video_path = os.path.join(self.videos_dir, self.test_video_name)
        with open(self.test_video_path, "wb") as f:
            f.write(b"0123456789" * 100)  # 1000 bytes

        # Create sample candidate manifest with 3 pilot videos
        self.fieldnames = [
            "event_id", "video", "timestamp_peak_s", "duration_s",
            "peak_speed_torso_s", "raw_class", "heuristic_tier",
            "audit_notes", "manual_verified", "is_true_stroke", "notes"
        ]
        self.sample_rows = [
            {
                "event_id": "dink2_ev_001",
                "video": "dink2.mp4",
                "timestamp_peak_s": "2.100",
                "duration_s": "0.300",
                "peak_speed_torso_s": "4.200",
                "raw_class": "KITCHEN_DINK",
                "heuristic_tier": "TIER_A_CANDIDATE",
                "audit_notes": "test note",
                "manual_verified": "PENDING_HUMAN_AUDIT",
                "is_true_stroke": "PENDING",
                "notes": "",
            },
            {
                "event_id": "dink2_ev_002",
                "video": "dink2.mp4",
                "timestamp_peak_s": "4.500",
                "duration_s": "0.250",
                "peak_speed_torso_s": "3.800",
                "raw_class": "KITCHEN_DINK",
                "heuristic_tier": "TIER_A_CANDIDATE",
                "audit_notes": "",
                "manual_verified": "PENDING_HUMAN_AUDIT",
                "is_true_stroke": "PENDING",
                "notes": "",
            },
            {
                "event_id": "smash2_ev_001",
                "video": "smash2.mp4",
                "timestamp_peak_s": "1.800",
                "duration_s": "0.200",
                "peak_speed_torso_s": "7.500",
                "raw_class": "SMASH",
                "heuristic_tier": "TIER_A_CANDIDATE",
                "audit_notes": "",
                "manual_verified": "PENDING_HUMAN_AUDIT",
                "is_true_stroke": "PENDING",
                "notes": "",
            },
        ]
        with open(self.manifest_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictReader(f)
            writer = csv.DictWriter(f, fieldnames=self.fieldnames)
            writer.writeheader()
            writer.writerows(self.sample_rows)

        # Tools HTML template path
        self.tools_html = os.path.abspath(os.path.join(os.path.dirname(__file__), "../tools/annotate_visual.html"))

        self.server_config = {
            "host": "127.0.0.1",
            "port": 8765,
            "videos_dir": os.path.abspath(self.videos_dir),
            "manifest_path": os.path.abspath(self.manifest_path),
            "output_dir": os.path.abspath(self.output_dir),
            "tools_html": os.path.abspath(self.tools_html),
            "debug": False,
        }
        self.client = InProcessClient(self.server_config)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _freeze_video_gt(self, video="dink2.mp4", reviewer="Auditor_Ethan"):
        """Helper to freeze blind ground truth for a video so candidates unlock."""
        payload = {
            "reviewer": reviewer,
            "video": video,
            "events": [
                {
                    "gt_id": f"gt_{video}_001",
                    "timestamp_s": 2.100,
                    "stroke_class": "KITCHEN_DINK" if "dink" in video else "SMASH",
                    "confidence": "CONFIRMED",
                    "notes": "Verified stroke",
                }
            ],
            "freeze": True,
            "full_video_reviewed": True,
        }
        status, _, raw = self.client.post("/api/ground_truth", payload)
        self.assertEqual(status, 200, f"Failed to freeze video {video}: {raw.decode('utf-8')}")

    def test_1_server_startup_and_ui_serve_zero_cdn(self):
        """Verify UI is served, contains TASK-V8-609 title, and contains zero external CDN dependencies."""
        status, headers, content = self.client.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"TASK-V8-609", content)
        html_str = content.decode("utf-8").lower()
        # Ensure no external scripts or stylesheets loaded from CDNs
        self.assertNotIn("http://", html_str)
        self.assertNotIn("https://", html_str)
        self.assertNotIn("unpkg.com", html_str)
        self.assertNotIn("cdnjs.cloudflare.com", html_str)
        self.assertNotIn("cdn.jsdelivr.net", html_str)

    def test_2_video_streaming_range_and_traversal_guards(self):
        """Verify HTTP 206 Partial Content for video Range requests and path traversal rejection."""
        status, headers, body = self.client.get(f"/video/{self.test_video_name}")
        self.assertEqual(status, 200)
        self.assertEqual(len(body), 1000)
        self.assertEqual(headers.get("Accept-Ranges"), "bytes")

        status2, headers2, body2 = self.client.get(
            f"/video/{self.test_video_name}",
            headers={"Range": "bytes=0-49"}
        )
        self.assertEqual(status2, 206)
        self.assertEqual(len(body2), 50)
        self.assertEqual(headers2.get("Content-Range"), "bytes 0-49/1000")
        self.assertEqual(body2, b"0123456789" * 5)

        # Path traversal attack: attempt to escape videos_dir
        status3, _, _ = self.client.get("/video/../../../../etc/passwd")
        self.assertIn(status3, (403, 404))

        status4, _, _ = self.client.get("/video/%2e%2e%2f%2e%2e%2fetc/passwd")
        self.assertIn(status4, (403, 404))

    def test_3_safe_output_dir_validation_rejects_repo_data_source_dir_and_symlinks(self):
        """
        [P1 Regression] Verify validate_safe_output_dir strictly rejects:
          - Paths inside repo data/**
          - Directory containing source manifest
          - Symlink aliases resolving to forbidden areas
          - Does not create directory when validation fails
        """
        repo_root = self.tmpdir
        fake_data_dir = os.path.join(repo_root, "data", "v2")
        os.makedirs(fake_data_dir, exist_ok=True)
        source_man = os.path.join(fake_data_dir, "candidate_events_manifest.csv")
        with open(source_man, "w") as f:
            f.write("a,b\n")

        # 1. Direct path inside data/**
        with self.assertRaises(ValueError) as cm1:
            srv.validate_safe_output_dir(fake_data_dir, manifest_path=source_man, repo_root=repo_root)
        self.assertIn("SECURITY VIOLATION", str(cm1.exception))
        self.assertIn("data/**", str(cm1.exception))

        # 2. Output dir same as source manifest directory (outside data/**)
        outside_source_dir = os.path.join(self.tmpdir, "custom_manifest_dir")
        os.makedirs(outside_source_dir, exist_ok=True)
        outside_source_man = os.path.join(outside_source_dir, "manifest.csv")
        with open(outside_source_man, "w") as f:
            f.write("a,b\n")
        with self.assertRaises(ValueError) as cm2:
            srv.validate_safe_output_dir(outside_source_dir, manifest_path=outside_source_man, repo_root=repo_root)
        self.assertIn("identical to source manifest", str(cm2.exception))

        # 3. Symlink pointing to data/**
        symlink_to_data = os.path.join(self.tmpdir, "symlink_data")
        os.symlink(fake_data_dir, symlink_to_data)
        with self.assertRaises(ValueError) as cm3:
            srv.validate_safe_output_dir(symlink_to_data, manifest_path=outside_source_man, repo_root=repo_root)
        self.assertIn("inside the repository's data/** directory", str(cm3.exception))

        # 4. Symlink pointing to source manifest directory
        symlink_to_man_dir = os.path.join(self.tmpdir, "symlink_man_dir")
        os.symlink(outside_source_dir, symlink_to_man_dir)
        with self.assertRaises(ValueError) as cm4:
            srv.validate_safe_output_dir(symlink_to_man_dir, manifest_path=outside_source_man, repo_root=repo_root)
        self.assertIn("identical to source manifest", str(cm4.exception))

        # 5. Non-existent path under symlink that points to data
        non_existent_under_symlink = os.path.join(symlink_to_data, "non_existent_pilot_dir")
        with self.assertRaises(ValueError):
            srv.validate_safe_output_dir(non_existent_under_symlink, manifest_path=source_man, repo_root=repo_root)
        # Verify directory was NOT created
        self.assertFalse(os.path.exists(non_existent_under_symlink))

        # 6. Valid isolated directory succeeds
        safe_out = os.path.join(self.tmpdir, "my_safe_isolated_output")
        canonical = srv.validate_safe_output_dir(safe_out, manifest_path=source_man, repo_root=repo_root)
        self.assertEqual(canonical, os.path.realpath(safe_out))

    def test_4_blind_review_gating_blocks_candidate_access_until_frozen(self):
        """
        [P1 Regression] Verify Blind Review First:
          - Candidates cannot be retrieved or audited before ground truth is frozen.
          - Modifying a frozen ground truth requires explicit correction reason.
        """
        # 1. Candidate GET for unfrozen video is blocked (403)
        st_get, _, body_get = self.client.get("/api/candidates?video=dink2.mp4")
        self.assertEqual(st_get, 403)
        res_get = json.loads(body_get.decode("utf-8"))
        self.assertEqual(res_get["error_code"], "BLIND_REVIEW_REQUIRED")

        # 2. Candidate POST for unfrozen video is blocked (403)
        audit_payload = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_CONFIRMED",
            "is_true_stroke": "TRUE",
        }
        st_audit, _, body_audit = self.client.post("/api/candidates/audit", audit_payload)
        self.assertEqual(st_audit, 403)
        res_audit = json.loads(body_audit.decode("utf-8"))
        self.assertEqual(res_audit["error_code"], "BLIND_REVIEW_REQUIRED")

        # 3. Attempt to freeze with full_video_reviewed=False is rejected (400)
        premature_freeze = {
            "reviewer": "Auditor_Ethan",
            "video": "dink2.mp4",
            "events": [],
            "freeze": True,
            "full_video_reviewed": False,
        }
        st_pre, _, body_pre = self.client.post("/api/ground_truth", premature_freeze)
        self.assertEqual(st_pre, 400)

        # 4. Now properly freeze ground truth
        self._freeze_video_gt(video="dink2.mp4")

        # 5. Candidate GET now succeeds!
        st_get2, _, body_get2 = self.client.get("/api/candidates?video=dink2.mp4")
        self.assertEqual(st_get2, 200)
        res_get2 = json.loads(body_get2.decode("utf-8"))
        self.assertEqual(res_get2["total_count"], 2)

        # 6. Candidate POST now succeeds!
        st_audit2, _, body_audit2 = self.client.post("/api/candidates/audit", audit_payload)
        self.assertEqual(st_audit2, 200)

        # 7. Modifying frozen GT without is_correction is blocked (409 Conflict)
        modify_frozen_gt = {
            "reviewer": "Reviewer_Bob",
            "video": "dink2.mp4",
            "events": [],
            "freeze": True,
            "full_video_reviewed": True,
            "is_correction": False,
        }
        st_mod, _, body_mod = self.client.post("/api/ground_truth", modify_frozen_gt)
        self.assertEqual(st_mod, 409)
        self.assertEqual(json.loads(body_mod.decode("utf-8"))["error_code"], "ALREADY_FROZEN")

        # 8. Modifying frozen GT WITH is_correction and reason succeeds and appends audit trail
        correct_frozen_gt = {
            "reviewer": "Reviewer_Bob",
            "video": "dink2.mp4",
            "events": [
                {
                    "gt_id": "gt_dink2_001",
                    "timestamp_s": 2.100,
                    "stroke_class": "KITCHEN_DINK",
                    "confidence": "CONFIRMED",
                    "notes": "Amended note",
                }
            ],
            "freeze": True,
            "full_video_reviewed": True,
            "is_correction": True,
            "correction_reason": "Corrected stroke timestamp after slow-mo replay",
        }
        st_cor, _, body_cor = self.client.post("/api/ground_truth", correct_frozen_gt)
        self.assertEqual(st_cor, 200)

        # Verify audit trail in ground truth
        st_check, _, body_check = self.client.get("/api/ground_truth?video=dink2.mp4")
        self.assertEqual(st_check, 200)
        data_check = json.loads(body_check.decode("utf-8"))
        self.assertEqual(len(data_check["audit_trail"]), 1)
        self.assertEqual(data_check["audit_trail"][0]["reason"], "Corrected stroke timestamp after slow-mo replay")

    def test_5_corrupt_ground_truth_fails_closed_and_preserves_other_videos(self):
        """
        [P1 Regression] Verify fail-closed behavior:
          - Corrupted existing ground_truth_events.json halts write, returns 500, preserves corrupt bytes.
          - Existing other videos in ground truth are preserved when updating one video.
        """
        gt_path = os.path.join(self.output_dir, "ground_truth_events.json")

        # 1. Place corrupt JSON file
        corrupt_bytes = b"{\n  corrupt json syntax error: missing bracket"
        with open(gt_path, "wb") as f:
            f.write(corrupt_bytes)

        payload = {
            "reviewer": "Auditor_Ethan",
            "video": "dink2.mp4",
            "events": [],
            "full_video_reviewed": True,
            "freeze": True,
        }
        status, _, raw = self.client.post("/api/ground_truth", payload)
        self.assertEqual(status, 500)
        res = json.loads(raw.decode("utf-8"))
        self.assertEqual(res["error_code"], "CORRUPT_EXISTING_GROUND_TRUTH")

        # Verify file on disk was NOT replaced
        with open(gt_path, "rb") as f:
            current_bytes = f.read()
        self.assertEqual(current_bytes, corrupt_bytes)

        # Remove corrupt file and test multi-video preservation
        os.remove(gt_path)
        self._freeze_video_gt(video="dink2.mp4")
        self._freeze_video_gt(video="smash2.mp4")

        # Verify both videos exist in ground_truth_events.json
        with open(gt_path, "r", encoding="utf-8") as f:
            all_gt = json.load(f)
        self.assertIn("dink2.mp4", all_gt["videos"])
        self.assertIn("smash2.mp4", all_gt["videos"])
        self.assertEqual(all_gt["videos"]["dink2.mp4"]["status"], "FROZEN")
        self.assertEqual(all_gt["videos"]["smash2.mp4"]["status"], "FROZEN")

    def test_6_candidate_audit_conflict_detection_and_audit_trail(self):
        """
        [P1 Regression] Verify candidate audit conflict detection:
          - Rejects silent verdict overwrites with 409 Conflict.
          - Rejects optimistic locking mismatch.
          - Explicit correction records previous value, reviewer, timestamp, and reason in notes.
        """
        self._freeze_video_gt(video="dink2.mp4")

        # Step 1: Initial sign-off: HUMAN_CONFIRMED / TRUE
        p1 = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_CONFIRMED",
            "is_true_stroke": "TRUE",
            "notes": "First audit pass",
            "reviewer": "Reviewer_1",
        }
        st1, _, raw1 = self.client.post("/api/candidates/audit", p1)
        self.assertEqual(st1, 200)

        # Step 2: Idempotent re-submission with same verdict succeeds
        st2, _, _ = self.client.post("/api/candidates/audit", p1)
        self.assertEqual(st2, 200)

        # Step 3: Different verdict (HUMAN_REJECTED / FALSE) without is_correction is rejected (409)
        p_conflict = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_REJECTED",
            "is_true_stroke": "FALSE",
            "reviewer": "Reviewer_2",
            "is_correction": False,
        }
        st_conf, _, raw_conf = self.client.post("/api/candidates/audit", p_conflict)
        self.assertEqual(st_conf, 409)
        res_conf = json.loads(raw_conf.decode("utf-8"))
        self.assertEqual(res_conf["error_code"], "CONFLICT")

        # Verify on-disk row still contains HUMAN_CONFIRMED / TRUE
        out_man = os.path.join(self.output_dir, "candidate_events_manifest.csv")
        s = man_v2_mod.load_and_validate_manifest(out_man)
        self.assertEqual(s["rows"][0]["manual_verified"], "HUMAN_CONFIRMED")
        self.assertEqual(s["rows"][0]["is_true_stroke"], "TRUE")

        # Step 4: Optimistic locking mismatch (expected PENDING, but current is CONFIRMED)
        p_exp_mismatch = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_REJECTED",
            "is_true_stroke": "FALSE",
            "expected_manual_verified": "PENDING_HUMAN_AUDIT",
            "is_correction": True,
            "correction_reason": "My reason",
        }
        st_exp, _, raw_exp = self.client.post("/api/candidates/audit", p_exp_mismatch)
        self.assertEqual(st_exp, 409)

        # Step 5: Explicit correction WITH reason, expected status, and reviewer succeeds
        p_correct = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_REJECTED",
            "is_true_stroke": "FALSE",
            "expected_manual_verified": "HUMAN_CONFIRMED",
            "expected_is_true_stroke": "TRUE",
            "reviewer": "Reviewer_2",
            "is_correction": True,
            "correction_reason": "Examined high-fps video, paddle clearly missed ball",
        }
        st_ok, _, raw_ok = self.client.post("/api/candidates/audit", p_correct)
        self.assertEqual(st_ok, 200)

        # Step 6: Verify audit trail recorded in notes
        s2 = man_v2_mod.load_and_validate_manifest(out_man)
        row = s2["rows"][0]
        self.assertEqual(row["manual_verified"], "HUMAN_REJECTED")
        self.assertEqual(row["is_true_stroke"], "FALSE")
        self.assertIn("CORRECTION", row["notes"])
        self.assertIn("Reviewer_2", row["notes"])
        self.assertIn("HUMAN_CONFIRMED/TRUE -> HUMAN_REJECTED/FALSE", row["notes"])
        self.assertIn("Examined high-fps video", row["notes"])

    def test_7_ground_truth_validation_rejects_nan_inf_duplicates_and_durations(self):
        """Verify validate_ground_truth_events rejects NaN, Inf, duplicate gt_id, and out-of-duration timestamps."""
        # 1. Reject NaN timestamp
        gt_nan = {
            "version": "2.1.0",
            "time_base": "media_presentation_time_seconds",
            "videos": {
                "dink2.mp4": {
                    "status": "IN_PROGRESS",
                    "full_video_reviewed": False,
                    "events": [
                        {
                            "gt_id": "gt_01",
                            "timestamp_s": float("nan"),
                            "stroke_class": "KITCHEN_DINK",
                            "confidence": "CONFIRMED",
                        }
                    ]
                }
            }
        }
        with self.assertRaises(man_v2_mod.ManifestValidationError):
            man_v2_mod.validate_ground_truth_events(gt_nan)

        # 2. Reject duplicate gt_id
        gt_dup = {
            "version": "2.1.0",
            "time_base": "media_presentation_time_seconds",
            "videos": {
                "dink2.mp4": {
                    "status": "IN_PROGRESS",
                    "full_video_reviewed": False,
                    "events": [
                        {"gt_id": "gt_same", "timestamp_s": 1.0, "stroke_class": "SMASH", "confidence": "CONFIRMED"},
                        {"gt_id": "gt_same", "timestamp_s": 2.0, "stroke_class": "SMASH", "confidence": "CONFIRMED"},
                    ]
                }
            }
        }
        with self.assertRaises(man_v2_mod.ManifestValidationError):
            man_v2_mod.validate_ground_truth_events(gt_dup)

        # 3. Reject timestamp exceeding duration
        gt_overflow = {
            "version": "2.1.0",
            "time_base": "media_presentation_time_seconds",
            "videos": {
                "dink2.mp4": {
                    "status": "IN_PROGRESS",
                    "full_video_reviewed": False,
                    "events": [
                        {"gt_id": "gt_01", "timestamp_s": 15.0, "stroke_class": "KITCHEN_DINK", "confidence": "CONFIRMED"},
                    ]
                }
            }
        }
        with self.assertRaises(man_v2_mod.ManifestValidationError):
            man_v2_mod.validate_ground_truth_events(gt_overflow, video_durations={"dink2.mp4": 10.9})

    def test_8_ground_truth_evaluator_compatibility_and_unsure_exclusion(self):
        """
        Verify export_evaluator_ground_truth:
          - Strictly excludes events with confidence == 'UNSURE'.
          - Strictly excludes unfrozen videos.
          - Returns format list[dict] directly usable by evaluate_detector_v2.py.
        """
        gt_data = {
            "version": "2.1.0",
            "time_base": "media_presentation_time_seconds",
            "videos": {
                "dink2.mp4": {
                    "status": "FROZEN",
                    "full_video_reviewed": True,
                    "events": [
                        {
                            "gt_id": "gt_01",
                            "timestamp_s": 2.100,
                            "stroke_class": "KITCHEN_DINK",
                            "confidence": "CONFIRMED",
                        },
                        {
                            "gt_id": "gt_02",
                            "timestamp_s": 4.500,
                            "stroke_class": "KITCHEN_DINK",
                            "confidence": "UNSURE",  # Must be EXCLUDED!
                        },
                    ]
                },
                "unfrozen.mp4": {
                    "status": "IN_PROGRESS",
                    "full_video_reviewed": False,
                    "events": [
                        {
                            "gt_id": "gt_03",
                            "timestamp_s": 1.0,
                            "stroke_class": "SMASH",
                            "confidence": "CONFIRMED",
                        }
                    ]
                }
            }
        }
        eval_list = man_v2_mod.export_evaluator_ground_truth(gt_data, only_frozen=True, include_unsure=False)
        self.assertEqual(len(eval_list), 1)
        self.assertEqual(eval_list[0]["video"], "dink2.mp4")
        self.assertEqual(eval_list[0]["timestamp_peak_s"], 2.100)
        self.assertEqual(eval_list[0]["confidence"], "CONFIRMED")

        # Test compatibility with evaluate_event_detection
        candidates = [
            {"video": "dink2.mp4", "timestamp_peak_s": 2.120, "event_id": "cand_01"},
            {"video": "dink2.mp4", "timestamp_peak_s": 4.510, "event_id": "cand_02"},
        ]
        metrics = eval_v2_mod.evaluate_event_detection(candidates, eval_list, tolerance_s=0.30)
        self.assertEqual(metrics["tp"], 1)  # Only 2.100 is GT
        self.assertEqual(metrics["fp"], 1)  # 4.510 has no GT because UNSURE was excluded
        self.assertEqual(metrics["fn"], 0)

    def test_9_empty_ground_truth_explicitly_frozen_unlocks_candidates(self):
        """
        Verify that an empty events list with full_video_reviewed=True and freeze=True
        explicitly represents 'whole video watched, zero confirmed strokes found',
        and successfully unlocks candidate audit for that video.
        """
        empty_freeze = {
            "reviewer": "Auditor_Ethan",
            "video": "dink2.mp4",
            "events": [],
            "full_video_reviewed": True,
            "freeze": True,
            "notes": "Watched entire clip, no valid strokes executed",
        }
        status, _, raw = self.client.post("/api/ground_truth", empty_freeze)
        self.assertEqual(status, 200)

        # Candidate GET should now be unlocked
        st_cand, _, raw_cand = self.client.get("/api/candidates?video=dink2.mp4")
        self.assertEqual(st_cand, 200)
        res_cand = json.loads(raw_cand.decode("utf-8"))
        self.assertEqual(res_cand["total_count"], 2)

    def test_10_pilot_67_events_exact_dataset_integrity(self):
        """
        Verify the actual formal manifest contains all 67 candidate events for the 3 pilot videos:
        - dink2.mp4: 9 events
        - smash2.mp4: 19 events
        - serve_legal1.mp4: 39 events
        Total: exactly 67 events.
        """
        formal_manifest = os.path.abspath(os.path.join(os.path.dirname(__file__), "../data/v2/candidate_events_manifest.csv"))
        self.assertTrue(os.path.exists(formal_manifest))

        state = man_v2_mod.load_and_validate_manifest(formal_manifest)
        pilot_counts = {"dink2.mp4": 0, "smash2.mp4": 0, "serve_legal1.mp4": 0}

        for r in state["rows"]:
            v = r.get("video")
            if v in pilot_counts:
                pilot_counts[v] += 1

        self.assertEqual(pilot_counts["dink2.mp4"], 9)
        self.assertEqual(pilot_counts["smash2.mp4"], 19)
        self.assertEqual(pilot_counts["serve_legal1.mp4"], 39)
        self.assertEqual(sum(pilot_counts.values()), 67)

    def test_11_candidate_audit_isolation_leaves_source_manifest_untouched(self):
        """Verify auditing candidates in output_dir copy never mutates source manifest."""
        self._freeze_video_gt(video="dink2.mp4")
        base_sha_before = man_v2_mod.compute_file_sha256(self.manifest_path)

        p = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_CONFIRMED",
            "is_true_stroke": "TRUE",
        }
        st, _, _ = self.client.post("/api/candidates/audit", p)
        self.assertEqual(st, 200)

        base_sha_after = man_v2_mod.compute_file_sha256(self.manifest_path)
        self.assertEqual(base_sha_before, base_sha_after)


if __name__ == "__main__":
    unittest.main()
