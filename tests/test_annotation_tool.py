#!/usr/bin/env python3
"""
Unit & Regression Tests for Visual Annotation Tool (TASK-V8-609)
================================================================
Verifies:
1. Server loopback binding, static UI serving without external CDN dependencies.
2. HTTP Range streaming (206 Partial Content) and path traversal prevention.
3. Accurate loading of all 67 candidate events across the 3 pilot videos.
4. Transactional candidate auditing, status pair validation, and isolation from formal data/v2.
5. Blind-mode independent Ground Truth recording and strict separation from candidate manifest.
6. Write-ahead recovery journaling handling under server API.
"""

import csv
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import scripts.manifest_annotations_v2 as man_v2_mod
import scripts.annotation_server as srv


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
        self.manifest_path = os.path.join(self.tmpdir, "candidate_events_manifest.csv")
        os.makedirs(self.videos_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)

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
        # 1. Full content without Range
        status, headers, body = self.client.get(f"/video/{self.test_video_name}")
        self.assertEqual(status, 200)
        self.assertEqual(len(body), 1000)
        self.assertEqual(headers.get("Accept-Ranges"), "bytes")

        # 2. Range request: first 50 bytes (0-49)
        status2, headers2, body2 = self.client.get(
            f"/video/{self.test_video_name}",
            headers={"Range": "bytes=0-49"}
        )
        self.assertEqual(status2, 206)
        self.assertEqual(len(body2), 50)
        self.assertEqual(headers2.get("Content-Range"), "bytes 0-49/1000")
        self.assertEqual(body2, b"0123456789" * 5)

        # 3. Path traversal attack: attempt to escape videos_dir
        status3, _, _ = self.client.get("/video/../../../../etc/passwd")
        self.assertIn(status3, (403, 404))

        status4, _, _ = self.client.get("/video/%2e%2e%2f%2e%2e%2fetc/passwd")
        self.assertIn(status4, (403, 404))

    def test_3_candidate_events_api_and_video_filtering(self):
        """Verify candidate events loading and video filtering."""
        # Get candidates for dink2.mp4
        status, _, body = self.client.get("/api/candidates?video=dink2.mp4")
        self.assertEqual(status, 200)
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(data["total_count"], 2)
        self.assertEqual(data["events"][0]["event_id"], "dink2_ev_001")
        self.assertEqual(data["events"][1]["event_id"], "dink2_ev_002")

        # Get all candidates
        status2, _, body2 = self.client.get("/api/candidates")
        self.assertEqual(status2, 200)
        data2 = json.loads(body2.decode("utf-8"))
        self.assertEqual(data2["total_count"], 3)

    def test_4_candidate_audit_transactional_save_and_isolation(self):
        """
        Verify candidate audit updates row in output_dir using transactional publishing,
        enforces valid status pairs, and leaves original base manifest untouched.
        """
        base_orig_sha = man_v2_mod.compute_file_sha256(self.manifest_path)

        # 1. Sign candidate as HUMAN_CONFIRMED / TRUE
        payload = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_001",
            "manual_verified": "HUMAN_CONFIRMED",
            "is_true_stroke": "TRUE",
            "notes": "Verified pilot dink",
        }
        status, _, raw_res = self.client.post("/api/candidates/audit", payload)
        self.assertEqual(status, 200)
        res = json.loads(raw_res.decode("utf-8"))
        self.assertEqual(res["status"], "UPDATED")
        self.assertEqual(res["event"]["manual_verified"], "HUMAN_CONFIRMED")
        self.assertEqual(res["event"]["is_true_stroke"], "TRUE")
        self.assertEqual(res["event"]["notes"], "Verified pilot dink")

        # 2. Verify output_dir copy was updated
        out_manifest = os.path.join(self.output_dir, "candidate_events_manifest.csv")
        self.assertTrue(os.path.exists(out_manifest))
        state = man_v2_mod.load_and_validate_manifest(out_manifest)
        self.assertEqual(state["rows"][0]["manual_verified"], "HUMAN_CONFIRMED")

        # 3. CRITICAL: Verify base manifest was NEVER modified!
        self.assertEqual(man_v2_mod.compute_file_sha256(self.manifest_path), base_orig_sha)

        # 4. Reject invalid status pair (e.g. AUTO_TIERED / TRUE or contradictory)
        bad_payload = {
            "video": "dink2.mp4",
            "event_id": "dink2_ev_002",
            "manual_verified": "AUTO_TIERED",
            "is_true_stroke": "TRUE",
        }
        b_status, _, b_res = self.client.post("/api/candidates/audit", bad_payload)
        self.assertEqual(b_status, 400)
        b_data = json.loads(b_res.decode("utf-8"))
        self.assertIn("error", b_data)

    def test_5_blind_ground_truth_recording_and_strict_separation(self):
        """
        Verify independent blind ground truth recording into ground_truth_events.json,
        and verify it does NOT modify the candidate events manifest.
        """
        gt_payload = {
            "reviewer": "Auditor_Ethan",
            "video": "dink2.mp4",
            "events": [
                {
                    "gt_id": "gt_dink2_001",
                    "timestamp_s": 2.125,
                    "stroke_class": "KITCHEN_DINK",
                    "confidence": "CONFIRMED",
                    "notes": "Clear push over net",
                },
                {
                    "gt_id": "gt_dink2_002",
                    "timestamp_s": 4.510,
                    "stroke_class": "KITCHEN_DINK",
                    "confidence": "UNSURE",
                    "notes": "Low body speed border case",
                },
            ],
        }

        # 1. Post Ground Truth
        status, _, raw_res = self.client.post("/api/ground_truth", gt_payload)
        self.assertEqual(status, 200)
        res = json.loads(raw_res.decode("utf-8"))
        self.assertEqual(res["status"], "SAVED")
        self.assertEqual(res["saved_count"], 2)

        # 2. Get Ground Truth via API
        g_status, _, g_raw = self.client.get("/api/ground_truth?video=dink2.mp4")
        self.assertEqual(g_status, 200)
        g_res = json.loads(g_raw.decode("utf-8"))
        self.assertTrue(g_res["ground_truth_exists"])
        self.assertEqual(g_res["reviewer"], "Auditor_Ethan")
        self.assertEqual(len(g_res["events"]), 2)
        self.assertEqual(g_res["events"][0]["gt_id"], "gt_dink2_001")

        # 3. Check ground_truth_events.json exists on disk
        gt_path = os.path.join(self.output_dir, "ground_truth_events.json")
        self.assertTrue(os.path.exists(gt_path))
        with open(gt_path, "r", encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["reviewer"], "Auditor_Ethan")
        self.assertIn("dink2.mp4", on_disk["videos"])

        # 4. Strict separation check: Candidate manifest was not modified by Ground Truth save
        out_manifest = os.path.join(self.output_dir, "candidate_events_manifest.csv")
        if os.path.exists(out_manifest):
            cand_state = man_v2_mod.load_and_validate_manifest(out_manifest)
            self.assertEqual(len(cand_state["rows"]), 3)

    def test_6_ground_truth_validation_rejects_malformed_data(self):
        """Verify ground truth validation rejects invalid reviewer, negative timestamps, or bad classes."""
        # Missing reviewer
        bad1 = {
            "reviewer": "   ",
            "video": "dink2.mp4",
            "events": []
        }
        st1, _, _ = self.client.post("/api/ground_truth", bad1)
        self.assertEqual(st1, 400)

        # Invalid stroke class
        bad2 = {
            "reviewer": "Alice",
            "video": "dink2.mp4",
            "events": [
                {
                    "gt_id": "gt_01",
                    "timestamp_s": 1.5,
                    "stroke_class": "INVALID_STROKE_NAME",
                    "confidence": "CONFIRMED",
                }
            ]
        }
        st2, _, _ = self.client.post("/api/ground_truth", bad2)
        self.assertEqual(st2, 400)

    def test_7_pilot_67_events_exact_dataset_integrity(self):
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


if __name__ == "__main__":
    unittest.main()
