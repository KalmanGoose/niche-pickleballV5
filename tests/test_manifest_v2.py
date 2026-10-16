#!/usr/bin/env python3
"""
Regression tests for TASK-V8-608:
1. Manifest read failure / corruption / missing-column protection (fail-closed, preserve original bytes)
2. Orphan human-signed event protection (abort publish, preserve manifest/dataset/checkpoint bytes)
3. Timestamp fallback ambiguity & contradictory human annotation status rejection
4. Atomic replacement failure recovery (temp cleanup + original file untouched)
5. Strict human-verified status table in summarize_manifest_audit (reject AUTO_TIERED+TRUE and contradictions)
6. Sequence DP event matching in evaluate_event_detection (maximize TP first, then minimize total time error)
"""

import csv
import hashlib
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import scripts.audit_biomechanics_tiering as tiering_mod
import scripts.evaluate_detector_v2 as eval_mod
import scripts.extract_strokes_v2 as extract_mod
from scripts.manifest_annotations_v2 import ManifestValidationError, atomic_write_csv_rows


def sha256_bytes(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def _sample_event(eid="smash_ev_001", vid="smash.mp4", ts=3.235, dur=0.25, spd=5.5, cls="SMASH"):
    return {
        "event_id": eid,
        "video": vid,
        "raw_class": cls,
        "candidate_peak_frame": 194,
        "start_frame": 186,
        "end_frame": 202,
        "timestamp_peak_s": ts,
        "duration_s": dur,
        "peak_speed_torso_s": spd,
        "path_length_torso": 1.2,
        "quality_flag": "OK",
        "features": {k: 0.5 for k in extract_mod.FEATURE_NAMES_V2},
    }


class TestManifestSafetyAndDetectorEvalV2(unittest.TestCase):

    def _write_csv(self, path, fieldnames, rows):
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def test_1_summarize_manifest_rejects_auto_tiered_and_contradictory_statuses(self):
        """
        Only HUMAN_CONFIRMED/TRUE, VERIFIED_TRUE/TRUE, HUMAN_REJECTED/FALSE, VERIFIED_FALSE/FALSE
        may count toward human_verified_tp/fp and verified_candidate_precision denominator.
        """
        bad_and_pending_rows = [
            {"event_id": "e1", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": "AUTO_TIERED", "is_true_stroke": "TRUE"},
            {"event_id": "e2", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": "PENDING_HUMAN_AUDIT", "is_true_stroke": "TRUE"},
            {"event_id": "e3", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": "HUMAN_CONFIRMED", "is_true_stroke": "FALSE"},
            {"event_id": "e4", "video": "v.mp4", "heuristic_tier": "TIER_C_SUSPECT", "manual_verified": "HUMAN_REJECTED", "is_true_stroke": "TRUE"},
            {"event_id": "e5", "video": "v.mp4", "heuristic_tier": "TIER_B_MARGINAL", "manual_verified": "UNKNOWN_STATUS", "is_true_stroke": "TRUE"},
            {"event_id": "e6", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": "", "is_true_stroke": ""},
            {"event_id": "e7", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": "PENDING_HUMAN_AUDIT", "is_true_stroke": "PENDING"},
        ]
        summary = eval_mod.summarize_manifest_audit(bad_and_pending_rows)
        self.assertEqual(summary["human_verified_total"], 0)
        self.assertEqual(summary["human_verified_tp"], 0)
        self.assertEqual(summary["human_verified_fp"], 0)
        self.assertIsNone(summary["verified_candidate_precision"])
        self.assertEqual(summary.get("invalid_or_contradictory_count"), 5)
        self.assertEqual(summary["pending_human_audit"], 2)

        # Now add the 4 valid combinations (with whitespace / lowercase variations)
        valid_rows = bad_and_pending_rows + [
            {"event_id": "e8", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": " human_confirmed ", "is_true_stroke": " true "},
            {"event_id": "e9", "video": "v.mp4", "heuristic_tier": "TIER_A_CANDIDATE", "manual_verified": "VERIFIED_TRUE", "is_true_stroke": "TRUE"},
            {"event_id": "e10", "video": "v.mp4", "heuristic_tier": "TIER_C_SUSPECT", "manual_verified": "human_rejected", "is_true_stroke": "false"},
            {"event_id": "e11", "video": "v.mp4", "heuristic_tier": "TIER_C_SUSPECT", "manual_verified": "VERIFIED_FALSE", "is_true_stroke": "FALSE"},
        ]
        summary2 = eval_mod.summarize_manifest_audit(valid_rows)
        self.assertEqual(summary2["human_verified_tp"], 2)
        self.assertEqual(summary2["human_verified_fp"], 2)
        self.assertEqual(summary2["human_verified_total"], 4)
        self.assertAlmostEqual(summary2["verified_candidate_precision"], 0.5)

    def test_2_event_detection_dp_maximizes_cardinality_then_minimizes_distance(self):
        """
        GT [0.0, 0.4], candidates [0.25, 0.5], tol 0.30s -> must yield 2 TP (0.25->0.0, 0.5->0.4),
        whereas greedy nearest-peak wrongly assigns 0.25->0.4 and gets only 1 TP.
        """
        gt = [
            {"video": "v1.mp4", "timestamp_peak_s": 0.0},
            {"video": "v1.mp4", "timestamp_peak_s": 0.4},
        ]
        det = [
            {"video": "v1.mp4", "timestamp_peak_s": 0.25},
            {"video": "v1.mp4", "timestamp_peak_s": 0.50},
        ]
        res = eval_mod.evaluate_event_detection(det, gt, tolerance_s=0.30)
        self.assertEqual(res["tp"], 2)
        self.assertEqual(res["fp"], 0)
        self.assertEqual(res["fn"], 0)
        self.assertAlmostEqual(res["precision"], 1.0)
        self.assertAlmostEqual(res["recall"], 1.0)

        # Reordering inputs must produce identical result
        res_perm = eval_mod.evaluate_event_detection(list(reversed(det)), list(reversed(gt)), tolerance_s=0.30)
        self.assertEqual(res_perm["tp"], 2)
        self.assertEqual(res_perm["fp"], 0)
        self.assertEqual(res_perm["fn"], 0)

        # Tie-breaking by smaller total distance when cardinality is equal (1 TP either way)
        gt_tie = [{"video": "v1.mp4", "timestamp_peak_s": 1.0}]
        det_tie = [
            {"video": "v1.mp4", "timestamp_peak_s": 0.75},  # diff 0.25
            {"video": "v1.mp4", "timestamp_peak_s": 1.05},  # diff 0.05
        ]
        res_tie = eval_mod.evaluate_event_detection(det_tie, gt_tie, tolerance_s=0.30)
        self.assertEqual(res_tie["tp"], 1)
        self.assertEqual(res_tie["fp"], 1)
        self.assertEqual(res_tie["fn"], 0)
        self.assertAlmostEqual(res_tie.get("total_abs_time_error_s", 0.0), 0.05, places=6)

        # Cross-video events must never match, and exact boundary (diff == tolerance_s) must match
        gt_multi = [
            {"video": "v1.mp4", "timestamp_peak_s": 1.0},
            {"video": "v2.mp4", "timestamp_peak_s": 2.0},
        ]
        det_multi = [
            {"video": "v1.mp4", "timestamp_peak_s": 1.25},  # exact boundary 0.25
            {"video": "v1.mp4", "timestamp_peak_s": 2.0},   # wrong video for 2.0
        ]
        res_multi = eval_mod.evaluate_event_detection(det_multi, gt_multi, tolerance_s=0.25)
        self.assertEqual(res_multi["tp"], 1)
        self.assertEqual(res_multi["fp"], 1)
        self.assertEqual(res_multi["fn"], 1)

        # Duplicate timestamps at same instant are still matched 1-to-1 (never 2 detections to 1 GT)
        gt_dup = [{"video": "v1.mp4", "timestamp_peak_s": 1.0}]
        det_dup = [
            {"video": "v1.mp4", "timestamp_peak_s": 1.0},
            {"video": "v1.mp4", "timestamp_peak_s": 1.0},
        ]
        res_dup = eval_mod.evaluate_event_detection(det_dup, gt_dup, tolerance_s=0.30)
        self.assertEqual(res_dup["tp"], 1)
        self.assertEqual(res_dup["fp"], 1)
        self.assertEqual(res_dup["fn"], 0)

    def test_3_corrupted_or_unreadable_manifest_aborts_and_preserves_bytes(self):
        """
        If an existing manifest is unreadable (PermissionError), invalid UTF-8, missing required
        columns, or has contradictory status, both extraction publishing and tiering must raise
        an error and never overwrite existing manifest/dataset/checkpoint bytes.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = os.path.join(tmpdir, "candidate_events_manifest.csv")
            dataset_path = os.path.join(tmpdir, "real_strokes_dataset_v2.json")
            dataset_csv_path = os.path.join(tmpdir, "real_strokes_dataset_v2.csv")
            checkpoint_path = os.path.join(tmpdir, "checkpoint_v2.json")

            events = [_sample_event()]
            with open(dataset_path, "w", encoding="utf-8") as f:
                json.dump({"events": events}, f)
            with open(dataset_csv_path, "w", encoding="utf-8") as f:
                f.write("event_id,video\nsmash_ev_001,smash.mp4\n")
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump({"smash.mp4": {"events_count": 1}}, f)

            ds_sha = sha256_bytes(dataset_path)
            csv_sha = sha256_bytes(dataset_csv_path)
            chk_sha = sha256_bytes(checkpoint_path)

            # Case A: Invalid UTF-8 bytes
            with open(manifest_path, "wb") as f:
                f.write(b"event_id,video,timestamp_peak_s\nsmash_ev_001,smash.mp4,\xff\xfe\x00\n")
            orig_sha = sha256_bytes(manifest_path)

            with self.assertRaises(ManifestValidationError):
                extract_mod.load_existing_manifest_annotations(manifest_path)

            with self.assertRaises(ManifestValidationError):
                extract_mod.publish_extraction_outputs(
                    all_events=events,
                    staged_checkpoint={"smash.mp4": {"events_count": 1}},
                    metadata={"version": "2.0.0"},
                    manifest_path=manifest_path,
                    dataset_json_path=dataset_path,
                    dataset_csv_path=dataset_csv_path,
                    checkpoint_path=checkpoint_path,
                )

            with patch.object(tiering_mod, "MANIFEST_IN", manifest_path), \
                 patch.object(tiering_mod, "MANIFEST_OUT", manifest_path), \
                 patch.object(tiering_mod, "DATASET_PATH", dataset_path):
                with self.assertRaises(ManifestValidationError):
                    tiering_mod.run_tiering()

            self.assertEqual(sha256_bytes(manifest_path), orig_sha)
            self.assertEqual(sha256_bytes(dataset_path), ds_sha)
            self.assertEqual(sha256_bytes(dataset_csv_path), csv_sha)
            self.assertEqual(sha256_bytes(checkpoint_path), chk_sha)

            # Case B: Missing required column ('notes' missing)
            with open(manifest_path, "w", encoding="utf-8") as f:
                f.write("event_id,video,timestamp_peak_s,manual_verified,is_true_stroke\nsmash_ev_001,smash.mp4,3.235,HUMAN_CONFIRMED,TRUE\n")
            missing_col_sha = sha256_bytes(manifest_path)

            with self.assertRaises(ManifestValidationError):
                extract_mod.load_existing_manifest_annotations(manifest_path)
            self.assertEqual(sha256_bytes(manifest_path), missing_col_sha)

            # Case C: Simulated PermissionError on open
            with patch("builtins.open", side_effect=PermissionError("Simulated EACCES")):
                with self.assertRaises(ManifestValidationError):
                    extract_mod.load_existing_manifest_annotations(manifest_path)
            self.assertEqual(sha256_bytes(manifest_path), missing_col_sha)

    def test_4_orphan_human_signed_event_aborts_publish_and_preserves_files(self):
        """
        If an existing human-signed row has no matching event in the new events list,
        both tiering and extraction publish must abort and keep original manifest/dataset/checkpoint intact.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = os.path.join(tmpdir, "candidate_events_manifest.csv")
            dataset_path = os.path.join(tmpdir, "real_strokes_dataset_v2.json")
            dataset_csv_path = os.path.join(tmpdir, "real_strokes_dataset_v2.csv")
            checkpoint_path = os.path.join(tmpdir, "checkpoint_v2.json")

            fieldnames = [
                "event_id", "video", "timestamp_peak_s", "duration_s",
                "peak_speed_torso_s", "raw_class", "heuristic_tier",
                "audit_notes", "manual_verified", "is_true_stroke", "notes"
            ]
            self._write_csv(manifest_path, fieldnames, [
                {
                    "event_id": "smash_ev_001",
                    "video": "smash.mp4",
                    "timestamp_peak_s": "3.235",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "5.500",
                    "raw_class": "SMASH",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "ok",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "Verified contact"
                },
                {
                    "event_id": "smash_ev_999",
                    "video": "smash.mp4",
                    "timestamp_peak_s": "19.800",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "6.100",
                    "raw_class": "SMASH",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "ok",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "Orphan human verified stroke"
                }
            ])
            orig_manifest_sha = sha256_bytes(manifest_path)

            events = [_sample_event()]
            with open(dataset_path, "w", encoding="utf-8") as f:
                json.dump({"events": events}, f)
            with open(dataset_csv_path, "w", encoding="utf-8") as f:
                f.write("event_id,video\nsmash_ev_001,smash.mp4\n")
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump({"smash.mp4": {"events_count": 2}}, f)

            orig_ds_sha = sha256_bytes(dataset_path)
            orig_csv_sha = sha256_bytes(dataset_csv_path)
            orig_chk_sha = sha256_bytes(checkpoint_path)

            with self.assertRaises(ManifestValidationError) as ctx_ext:
                extract_mod.publish_extraction_outputs(
                    all_events=events,
                    staged_checkpoint={"smash.mp4": {"events_count": 1}},
                    metadata={"version": "2.0.0"},
                    manifest_path=manifest_path,
                    dataset_json_path=dataset_path,
                    dataset_csv_path=dataset_csv_path,
                    checkpoint_path=checkpoint_path,
                )
            self.assertIn("smash_ev_999", str(ctx_ext.exception))

            with patch.object(tiering_mod, "MANIFEST_IN", manifest_path), \
                 patch.object(tiering_mod, "MANIFEST_OUT", manifest_path), \
                 patch.object(tiering_mod, "DATASET_PATH", dataset_path):
                with self.assertRaises(ManifestValidationError) as ctx:
                    tiering_mod.run_tiering()
                self.assertIn("smash_ev_999", str(ctx.exception))

            self.assertEqual(sha256_bytes(manifest_path), orig_manifest_sha, "Orphan signed event was overwritten!")
            self.assertEqual(sha256_bytes(dataset_path), orig_ds_sha)
            self.assertEqual(sha256_bytes(dataset_csv_path), orig_csv_sha)
            self.assertEqual(sha256_bytes(checkpoint_path), orig_chk_sha)

    def test_5_ambiguous_timestamp_fallback_and_atomic_replace_failure(self):
        """
        Verify:
        1) 2 old signed events within tolerance of 1 new event -> rejected as ambiguous.
        2) 2 new events competing for 1 old signed event within tolerance -> rejected as ambiguous.
        3) Unambiguous timestamp fallback carries over old stable event_id, and preserves notes on unsigned rows.
        4) os.replace failure preserves original file bytes and cleans up temp file.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = os.path.join(tmpdir, "candidate_events_manifest.csv")
            dataset_path = os.path.join(tmpdir, "real_strokes_dataset_v2.json")

            fieldnames = [
                "event_id", "video", "timestamp_peak_s", "duration_s",
                "peak_speed_torso_s", "raw_class", "heuristic_tier",
                "audit_notes", "manual_verified", "is_true_stroke", "notes"
            ]
            # Subcase 5a: Two old signed events at 5.000s and 5.004s competing for new_ev_001 at 5.002s
            self._write_csv(manifest_path, fieldnames, [
                {
                    "event_id": "old_ev_001",
                    "video": "dink.mp4",
                    "timestamp_peak_s": "5.000",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "3.500",
                    "raw_class": "KITCHEN_DINK",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "First"
                },
                {
                    "event_id": "old_ev_002",
                    "video": "dink.mp4",
                    "timestamp_peak_s": "5.004",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "3.600",
                    "raw_class": "KITCHEN_DINK",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "",
                    "manual_verified": "HUMAN_REJECTED",
                    "is_true_stroke": "FALSE",
                    "notes": "Second"
                }
            ])
            orig_sha = sha256_bytes(manifest_path)

            with open(dataset_path, "w", encoding="utf-8") as f:
                json.dump({
                    "events": [_sample_event(eid="new_ev_001", vid="dink.mp4", ts=5.002, spd=3.55, cls="KITCHEN_DINK")]
                }, f)

            with patch.object(tiering_mod, "MANIFEST_IN", manifest_path), \
                 patch.object(tiering_mod, "MANIFEST_OUT", manifest_path), \
                 patch.object(tiering_mod, "DATASET_PATH", dataset_path):
                with self.assertRaises(ManifestValidationError):
                    tiering_mod.run_tiering()

            self.assertEqual(sha256_bytes(manifest_path), orig_sha)

            # Subcase 5b: Two new events (5.01s and 5.03s) competing for 1 old signed event (5.02s)
            self._write_csv(manifest_path, fieldnames, [
                {
                    "event_id": "old_ev_solo",
                    "video": "dink.mp4",
                    "timestamp_peak_s": "5.020",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "3.500",
                    "raw_class": "KITCHEN_DINK",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "Solo old"
                }
            ])
            orig_sha_b = sha256_bytes(manifest_path)
            with open(dataset_path, "w", encoding="utf-8") as f:
                json.dump({
                    "events": [
                        _sample_event(eid="new_ev_a", vid="dink.mp4", ts=5.010, spd=3.5, cls="KITCHEN_DINK"),
                        _sample_event(eid="new_ev_b", vid="dink.mp4", ts=5.030, spd=3.6, cls="KITCHEN_DINK"),
                    ]
                }, f)
            with patch.object(tiering_mod, "MANIFEST_IN", manifest_path), \
                 patch.object(tiering_mod, "MANIFEST_OUT", manifest_path), \
                 patch.object(tiering_mod, "DATASET_PATH", dataset_path):
                with self.assertRaises(ManifestValidationError):
                    tiering_mod.run_tiering()
            self.assertEqual(sha256_bytes(manifest_path), orig_sha_b)

            # Subcase 5c: Unambiguous timestamp fallback + unsigned note preservation
            self._write_csv(manifest_path, fieldnames, [
                {
                    "event_id": "stable_old_id_01",
                    "video": "dink.mp4",
                    "timestamp_peak_s": "5.000",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "3.500",
                    "raw_class": "KITCHEN_DINK",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "Confirmed dink"
                },
                {
                    "event_id": "unsigned_note_id_02",
                    "video": "dink.mp4",
                    "timestamp_peak_s": "9.000",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "3.200",
                    "raw_class": "KITCHEN_DINK",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "",
                    "manual_verified": "PENDING_HUMAN_AUDIT",
                    "is_true_stroke": "PENDING",
                    "notes": "Need slow-mo check"
                }
            ])
            with open(dataset_path, "w", encoding="utf-8") as f:
                json.dump({
                    "events": [
                        _sample_event(eid="renumbered_ev_001", vid="dink.mp4", ts=5.020, spd=3.5, cls="KITCHEN_DINK"),
                        _sample_event(eid="unsigned_note_id_02", vid="dink.mp4", ts=9.000, spd=3.2, cls="KITCHEN_DINK"),
                    ]
                }, f)

            # Subcase 5d: Simulated os.replace failure leaves original file intact and removes temp file
            before_replace_sha = sha256_bytes(manifest_path)
            with patch("scripts.manifest_annotations_v2.os.replace", side_effect=OSError("Simulated disk error")):
                with self.assertRaises(OSError):
                    atomic_write_csv_rows(manifest_path, fieldnames, [])
            self.assertEqual(sha256_bytes(manifest_path), before_replace_sha)
            leftover_temps = [n for n in os.listdir(tmpdir) if ".tmp." in n]
            self.assertEqual(leftover_temps, [])

            # Now run tiering normally for Subcase 5c and verify stable ID + notes preservation
            with patch.object(tiering_mod, "MANIFEST_IN", manifest_path), \
                 patch.object(tiering_mod, "MANIFEST_OUT", manifest_path), \
                 patch.object(tiering_mod, "DATASET_PATH", dataset_path):
                tiering_mod.run_tiering()

            with open(manifest_path, "r", encoding="utf-8") as f:
                out_rows = list(csv.DictReader(f))
            self.assertEqual(len(out_rows), 2)
            self.assertEqual(out_rows[0]["event_id"], "stable_old_id_01")
            self.assertEqual(out_rows[0]["manual_verified"], "HUMAN_CONFIRMED")
            self.assertEqual(out_rows[0]["is_true_stroke"], "TRUE")
            self.assertEqual(out_rows[0]["notes"], "Confirmed dink")
            # Unsigned row with notes keeps its notes but stays PENDING_HUMAN_AUDIT / PENDING
            self.assertEqual(out_rows[1]["event_id"], "unsigned_note_id_02")
            self.assertEqual(out_rows[1]["manual_verified"], "PENDING_HUMAN_AUDIT")
            self.assertEqual(out_rows[1]["is_true_stroke"], "PENDING")
            self.assertEqual(out_rows[1]["notes"], "Need slow-mo check")

    def test_6_exact_id_with_shifted_timestamp_rejected_as_ambiguity(self):
        """
        [P1 Regression]
        Old manifest has smash_ev_001 at 3.235s with HUMAN_CONFIRMED/TRUE.
        New detector run assigns smash_ev_001 at 19.800s.
        Exact ID matching MUST verify timestamp consistency (abs(dt) <= tolerance_s).
        Because dt = 16.565s > 0.250s, this MUST be rejected as an ambiguity/conflict
        requiring human audit, and MUST NOT silently inherit HUMAN_CONFIRMED/TRUE.
        Original manifest/dataset/checkpoint files must remain untouched.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = os.path.join(tmpdir, "candidate_events_manifest.csv")
            dataset_path = os.path.join(tmpdir, "real_strokes_dataset_v2.json")
            dataset_csv_path = os.path.join(tmpdir, "real_strokes_dataset_v2.csv")
            checkpoint_path = os.path.join(tmpdir, "checkpoint_v2.json")

            fieldnames = [
                "event_id", "video", "timestamp_peak_s", "duration_s",
                "peak_speed_torso_s", "raw_class", "heuristic_tier",
                "audit_notes", "manual_verified", "is_true_stroke", "notes"
            ]
            self._write_csv(manifest_path, fieldnames, [
                {
                    "event_id": "smash_ev_001",
                    "video": "smash.mp4",
                    "timestamp_peak_s": "3.235",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "5.500",
                    "raw_class": "SMASH",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "ok",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "Original 3.235s verified stroke"
                }
            ])
            orig_m_sha = sha256_bytes(manifest_path)

            # New detector output has smash_ev_001 at 19.800s
            shifted_event = _sample_event(eid="smash_ev_001", vid="smash.mp4", ts=19.800)
            with open(dataset_path, "w", encoding="utf-8") as f:
                json.dump({"events": [shifted_event]}, f)
            with open(dataset_csv_path, "w", encoding="utf-8") as f:
                f.write("event_id,video\nsmash_ev_001,smash.mp4\n")
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump({"smash.mp4": {"events_count": 1}}, f)

            orig_ds_sha = sha256_bytes(dataset_path)
            orig_csv_sha = sha256_bytes(dataset_csv_path)
            orig_chk_sha = sha256_bytes(checkpoint_path)

            with self.assertRaises(ManifestValidationError) as ctx:
                extract_mod.publish_extraction_outputs(
                    all_events=[shifted_event],
                    staged_checkpoint={"smash.mp4": {"events": [shifted_event]}},
                    metadata={"version": "2.0.0"},
                    manifest_path=manifest_path,
                    dataset_json_path=dataset_path,
                    dataset_csv_path=dataset_csv_path,
                    checkpoint_path=checkpoint_path,
                )
            self.assertIn("exact ID matched but timestamp shifted", str(ctx.exception))
            self.assertIn("smash_ev_001", str(ctx.exception))

            # Verify files were not modified
            self.assertEqual(sha256_bytes(manifest_path), orig_m_sha)
            self.assertEqual(sha256_bytes(dataset_path), orig_ds_sha)
            self.assertEqual(sha256_bytes(dataset_csv_path), orig_csv_sha)
            self.assertEqual(sha256_bytes(checkpoint_path), orig_chk_sha)

            # Also verify tiering refuses to process shifted timestamp
            with patch.object(tiering_mod, "MANIFEST_IN", manifest_path), \
                 patch.object(tiering_mod, "MANIFEST_OUT", manifest_path), \
                 patch.object(tiering_mod, "DATASET_PATH", dataset_path):
                with self.assertRaises(ManifestValidationError):
                    tiering_mod.run_tiering()
            self.assertEqual(sha256_bytes(manifest_path), orig_m_sha)

    def test_7_multi_file_batch_publish_rollback_on_any_failure(self):
        """
        [P1 Regression]
        Multi-file publication of [manifest, dataset JSON, dataset CSV, checkpoint JSON]
        must be strictly transactional (all-or-nothing rollback).
        Injected failure at file 1, 2, 3, or 4 must leave ALL 4 files 100% byte-for-byte identical (SHA-256).
        """
        import scripts.manifest_annotations_v2 as man_v2_mod

        for fail_step in [1, 2, 3, 4]:
            with self.subTest(fail_step=fail_step):
                with tempfile.TemporaryDirectory() as tmpdir:
                    manifest_path = os.path.join(tmpdir, "candidate_events_manifest.csv")
                    dataset_path = os.path.join(tmpdir, "real_strokes_dataset_v2.json")
                    dataset_csv_path = os.path.join(tmpdir, "real_strokes_dataset_v2.csv")
                    checkpoint_path = os.path.join(tmpdir, "checkpoint_v2.json")

                    fieldnames = [
                        "event_id", "video", "timestamp_peak_s", "duration_s",
                        "peak_speed_torso_s", "raw_class", "heuristic_tier",
                        "audit_notes", "manual_verified", "is_true_stroke", "notes"
                    ]
                    self._write_csv(manifest_path, fieldnames, [
                        {
                            "event_id": "ev_init",
                            "video": "v.mp4",
                            "timestamp_peak_s": "1.000",
                            "duration_s": "0.200",
                            "peak_speed_torso_s": "4.000",
                            "raw_class": "SMASH",
                            "heuristic_tier": "TIER_A_CANDIDATE",
                            "audit_notes": "",
                            "manual_verified": "PENDING_HUMAN_AUDIT",
                            "is_true_stroke": "PENDING",
                            "notes": "Initial state",
                        }
                    ])
                    with open(dataset_path, "w", encoding="utf-8") as f:
                        f.write('{"initial": "dataset_json"}\n')
                    with open(dataset_csv_path, "w", encoding="utf-8") as f:
                        f.write("event_id,video\nev_init,v.mp4\n")
                    with open(checkpoint_path, "w", encoding="utf-8") as f:
                        f.write('{"initial": "checkpoint_json"}\n')

                    orig_shas = {
                        "manifest": sha256_bytes(manifest_path),
                        "dataset_json": sha256_bytes(dataset_path),
                        "dataset_csv": sha256_bytes(dataset_csv_path),
                        "checkpoint": sha256_bytes(checkpoint_path),
                    }

                    new_event = _sample_event(eid="ev_init", vid="v.mp4", ts=1.000)
                    staged_chk = {"v.mp4": {"events": [new_event]}}

                    step_counter = 0
                    real_replace = man_v2_mod._replace_single_file

                    def mocked_replace(src, dst):
                        nonlocal step_counter
                        step_counter += 1
                        if step_counter == fail_step:
                            raise OSError(f"Simulated write failure on step {fail_step}")
                        real_replace(src, dst)

                    with patch.object(man_v2_mod, "_replace_single_file", side_effect=mocked_replace):
                        with self.assertRaises(OSError) as ctx:
                            extract_mod.publish_extraction_outputs(
                                all_events=[new_event],
                                staged_checkpoint=staged_chk,
                                metadata={"version": "2.0.0"},
                                manifest_path=manifest_path,
                                dataset_json_path=dataset_path,
                                dataset_csv_path=dataset_csv_path,
                                checkpoint_path=checkpoint_path,
                            )
                        self.assertIn(f"Simulated write failure on step {fail_step}", str(ctx.exception))

                    # Verify all 4 files are byte-for-byte untouched
                    self.assertEqual(sha256_bytes(manifest_path), orig_shas["manifest"], f"Manifest corrupted on step {fail_step} failure!")
                    self.assertEqual(sha256_bytes(dataset_path), orig_shas["dataset_json"], f"Dataset JSON corrupted on step {fail_step} failure!")
                    self.assertEqual(sha256_bytes(dataset_csv_path), orig_shas["dataset_csv"], f"Dataset CSV corrupted on step {fail_step} failure!")
                    self.assertEqual(sha256_bytes(checkpoint_path), orig_shas["checkpoint"], f"Checkpoint corrupted on step {fail_step} failure!")

                    # Ensure no lingering staging or rollback temporary files
                    lingering_temps = [f for f in os.listdir(tmpdir) if ".tmp." in f or f.startswith(".batch_pub_")]
                    self.assertEqual(lingering_temps, [])

    def test_8_cross_artifact_event_id_consistency_and_persistent_mapping(self):
        """
        [P2 Regression]
        When timestamp fallback carries over a stable old ID, ALL 4 artifacts
        (manifest.csv, dataset.csv, dataset.json, checkpoint.json) must share the
        exact same resolved_event_id, and full_output['metadata']['event_id_mapping']
        must persist the verifiable mapping between detector_event_id and stable_event_id.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = os.path.join(tmpdir, "candidate_events_manifest.csv")
            dataset_path = os.path.join(tmpdir, "real_strokes_dataset_v2.json")
            dataset_csv_path = os.path.join(tmpdir, "real_strokes_dataset_v2.csv")
            checkpoint_path = os.path.join(tmpdir, "checkpoint_v2.json")

            fieldnames = [
                "event_id", "video", "timestamp_peak_s", "duration_s",
                "peak_speed_torso_s", "raw_class", "heuristic_tier",
                "audit_notes", "manual_verified", "is_true_stroke", "notes"
            ]
            self._write_csv(manifest_path, fieldnames, [
                {
                    "event_id": "stable_old_id_01",
                    "video": "dink.mp4",
                    "timestamp_peak_s": "5.000",
                    "duration_s": "0.250",
                    "peak_speed_torso_s": "3.500",
                    "raw_class": "KITCHEN_DINK",
                    "heuristic_tier": "TIER_A_CANDIDATE",
                    "audit_notes": "",
                    "manual_verified": "HUMAN_CONFIRMED",
                    "is_true_stroke": "TRUE",
                    "notes": "Confirmed dink",
                }
            ])

            # New detector output generated raw detector ID 'raw_det_999' at 5.015s (within 0.25s)
            raw_event = _sample_event(
                eid="raw_det_999",
                vid="dink.mp4",
                ts=5.015,
                spd=3.55,
                cls="KITCHEN_DINK"
            )
            raw_event["candidate_peak_frame"] = 150
            staged_chk = {
                "dink.mp4": {
                    "events": [
                        {
                            "event_id": "raw_det_999",
                            "candidate_peak_frame": 150,
                            "timestamp_peak_s": 5.015,
                        }
                    ]
                }
            }

            extract_mod.publish_extraction_outputs(
                all_events=[raw_event],
                staged_checkpoint=staged_chk,
                metadata={"version": "2.0.0"},
                manifest_path=manifest_path,
                dataset_json_path=dataset_path,
                dataset_csv_path=dataset_csv_path,
                checkpoint_path=checkpoint_path,
            )

            # 1. Manifest CSV check
            with open(manifest_path, "r", encoding="utf-8") as f:
                m_rows = list(csv.DictReader(f))
            self.assertEqual(len(m_rows), 1)
            self.assertEqual(m_rows[0]["event_id"], "stable_old_id_01")
            self.assertEqual(m_rows[0]["manual_verified"], "HUMAN_CONFIRMED")
            self.assertEqual(m_rows[0]["is_true_stroke"], "TRUE")

            # 2. Dataset JSON check
            with open(dataset_path, "r", encoding="utf-8") as f:
                ds_json = json.load(f)
            self.assertEqual(len(ds_json["events"]), 1)
            self.assertEqual(ds_json["events"][0]["event_id"], "stable_old_id_01")
            self.assertEqual(ds_json["events"][0]["detector_event_id"], "raw_det_999")
            mapping = ds_json["metadata"].get("event_id_mapping", [])
            self.assertEqual(len(mapping), 1)
            self.assertEqual(mapping[0]["video"], "dink.mp4")
            self.assertEqual(mapping[0]["stable_event_id"], "stable_old_id_01")
            self.assertEqual(mapping[0]["detector_event_id"], "raw_det_999")
            self.assertAlmostEqual(mapping[0]["timestamp_peak_s"], 5.015)

            # 3. Dataset CSV check
            with open(dataset_csv_path, "r", encoding="utf-8") as f:
                csv_rows = list(csv.DictReader(f))
            self.assertEqual(len(csv_rows), 1)
            self.assertEqual(csv_rows[0]["event_id"], "stable_old_id_01")

            # 4. Checkpoint JSON check
            with open(checkpoint_path, "r", encoding="utf-8") as f:
                chk_json = json.load(f)
            self.assertEqual(chk_json["dink.mp4"]["events"][0]["event_id"], "stable_old_id_01")
            self.assertEqual(chk_json["dink.mp4"]["events"][0]["detector_event_id"], "raw_det_999")

            # Cross-artifact join on (video, event_id) must match across all 4 files
            join_key_manifest = (m_rows[0]["video"], m_rows[0]["event_id"])
            join_key_ds_json = (ds_json["events"][0]["video"], ds_json["events"][0]["event_id"])
            join_key_ds_csv = (csv_rows[0]["video"], csv_rows[0]["event_id"])
            join_key_chk = ("dink.mp4", chk_json["dink.mp4"]["events"][0]["event_id"])
            self.assertEqual(join_key_manifest, ("dink.mp4", "stable_old_id_01"))
            self.assertEqual(join_key_manifest, join_key_ds_json)
            self.assertEqual(join_key_manifest, join_key_ds_csv)
            self.assertEqual(join_key_manifest, join_key_chk)


if __name__ == "__main__":
    unittest.main()
