#!/usr/bin/env python3
"""
Shared Manifest Annotations Safety & Atomic I/O Helper (v2)
===========================================================
Provides fail-closed reading, validation, two-layer 1-to-1 annotation matching
(exact (video, event_id) with timestamp consistency check, followed by unambiguous
timestamp fallback for renumbered events), and multi-file batch publishing with
full transactional rollback.
"""

import csv
import hashlib
import json
import math
import os
import shutil
import tempfile
import time
import uuid
from collections import defaultdict

RECOVERY_JOURNAL_FILENAME = ".batch_publish_recovery.json"


def compute_file_sha256(path):
    """Compute hex SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def get_pending_recovery_journal_path(target_dir):
    """
    Check if a pending recovery journal exists in target_dir.
    Returns absolute path if exists, otherwise None.
    """
    target_dir = os.path.abspath(target_dir)
    jpath = os.path.join(target_dir, RECOVERY_JOURNAL_FILENAME)
    if os.path.exists(jpath):
        return jpath
    return None


def check_no_pending_recovery(target_dir):
    """
    Verify that no incomplete or failed batch publish transaction exists in target_dir.
    If a recovery journal is present, raises ManifestValidationError to explicitly
    prevent reading or writing mixed/inconsistent versions.
    """
    jpath = get_pending_recovery_journal_path(target_dir)
    if jpath is not None:
        try:
            with open(jpath, "r", encoding="utf-8") as f:
                jdata = json.load(f)
            status = jdata.get("status", "UNKNOWN")
            tx_id = jdata.get("transaction_id", "UNKNOWN")
            bak = jdata.get("backup_dir", "UNKNOWN")
        except Exception:
            status = "CORRUPT_JOURNAL"
            tx_id = "UNKNOWN"
            bak = "UNKNOWN"
        raise ManifestValidationError(
            f"Incomplete/unresolved batch publication detected in '{target_dir}' "
            f"(tx: {tx_id}, status: {status}). "
            f"Mixed versions may be present; operations are blocked to prevent reading corrupted/mixed state. "
            f"Backups are preserved at: '{bak}'. Please run recover_pending_batch_publish('{target_dir}') first."
        )


def recover_pending_batch_publish(target_dir):
    """
    Recover an incomplete or rollback-failed batch publication in target_dir using
    the preserved journal and backup files. Restores all files to their original
    pre-transaction bytes, validates SHA-256, cleans up the journal and backup directory.
    Returns dict with recovery summary.
    """
    target_dir = os.path.abspath(target_dir)
    jpath = get_pending_recovery_journal_path(target_dir)
    if not jpath:
        return {"status": "NO_PENDING_RECOVERY", "restored_count": 0}

    with open(jpath, "r", encoding="utf-8") as f:
        jdata = json.load(f)

    items = jdata.get("items", [])
    backup_dir = jdata.get("backup_dir")
    target_dirs = jdata.get("target_dirs", [target_dir])
    journal_paths = [os.path.join(td, RECOVERY_JOURNAL_FILENAME) for td in target_dirs]

    # 1. Pre-validation: verify needed backup files exist for modified items
    for item in items:
        state = item.get("state", "COMMITTED")
        if item.get("existed_before") and state in ("COMMITTED", "RESTORE_FAILED"):
            bak_path = item.get("backup_path")
            if not bak_path or not os.path.exists(bak_path):
                raise RuntimeError(
                    f"Cannot recover transaction '{jdata.get('transaction_id')}': backup file missing: {bak_path}"
                )

    # 2. Restore all modified items to their original pre-transaction state
    restored_items = []
    for item in items:
        tpath = item["target_path"]
        state = item.get("state", "COMMITTED")
        if state in ("COMMITTED", "RESTORE_FAILED"):
            if item.get("existed_before"):
                bak_path = item["backup_path"]
                _rollback_restore_file(bak_path, tpath)
                orig_sha = item.get("original_sha256")
                if orig_sha is not None:
                    curr_sha = compute_file_sha256(tpath)
                    if curr_sha != orig_sha:
                        raise RuntimeError(
                            f"Recovery hash mismatch on '{tpath}': expected {orig_sha}, got {curr_sha}"
                        )
            else:
                if os.path.exists(tpath):
                    try:
                        os.unlink(tpath)
                    except OSError:
                        pass
            restored_items.append(tpath)

    # 3. Clean up journal files across all involved target directories
    for jp in journal_paths:
        if os.path.exists(jp):
            try:
                os.unlink(jp)
            except OSError:
                pass

    # 4. Clean up backup directory now that files are safely restored
    if backup_dir and os.path.exists(backup_dir):
        shutil.rmtree(backup_dir, ignore_errors=True)

    return {
        "status": "RECOVERED",
        "transaction_id": jdata.get("transaction_id"),
        "restored_count": len(restored_items),
        "restored_items": restored_items,
    }


REQUIRED_MANIFEST_COLUMNS = {
    "event_id",
    "video",
    "timestamp_peak_s",
    "manual_verified",
    "is_true_stroke",
    "notes",
}

VALID_HUMAN_SIGNED_PAIRS = {
    ("HUMAN_CONFIRMED", "TRUE"): "SIGNED_TP",
    ("VERIFIED_TRUE", "TRUE"): "SIGNED_TP",
    ("HUMAN_REJECTED", "FALSE"): "SIGNED_FP",
    ("VERIFIED_FALSE", "FALSE"): "SIGNED_FP",
}

PENDING_VERIFIED_VALUES = {"", "PENDING_HUMAN_AUDIT", "UNVERIFIED", "AUTO_TIERED"}
PENDING_TRUE_VALUES = {"", "PENDING"}

DEFAULT_TIMESTAMP_TOLERANCE_S = 0.05


class ManifestValidationError(RuntimeError):
    """Raised when an existing manifest cannot be safely read, validated, or merged."""


def classify_annotation_status(manual_verified, is_true_stroke):
    """
    Classify a (manual_verified, is_true_stroke) pair strictly:
    - ('SIGNED_TP', norm_ver, norm_true) for HUMAN_CONFIRMED/TRUE or VERIFIED_TRUE/TRUE
    - ('SIGNED_FP', norm_ver, norm_true) for HUMAN_REJECTED/FALSE or VERIFIED_FALSE/FALSE
    - ('PENDING', norm_ver, norm_true) for unverified/pending/auto-tiered + pending/empty
    - ('INVALID_OR_CONTRADICTORY', norm_ver, norm_true) for everything else
      (e.g. AUTO_TIERED+TRUE, PENDING_HUMAN_AUDIT+TRUE, HUMAN_CONFIRMED+FALSE, unknown)
    """
    norm_ver = "" if manual_verified is None else str(manual_verified).strip().upper()
    norm_true = "" if is_true_stroke is None else str(is_true_stroke).strip().upper()

    pair = (norm_ver, norm_true)
    if pair in VALID_HUMAN_SIGNED_PAIRS:
        return VALID_HUMAN_SIGNED_PAIRS[pair], norm_ver, norm_true

    if norm_ver in PENDING_VERIFIED_VALUES and norm_true in PENDING_TRUE_VALUES:
        return "PENDING", norm_ver, norm_true

    return "INVALID_OR_CONTRADICTORY", norm_ver, norm_true


def load_and_validate_manifest(manifest_path):
    """
    Strictly read and validate an existing manifest CSV.
    - Returns {"exists": False, "rows": [], "by_key": {}} ONLY when the file does not exist.
    - Any I/O error, invalid UTF-8, CSV formatting error, missing column, invalid/non-finite
    - If a pending recovery journal is present in the target directory, raises ManifestValidationError
      to prevent reading inconsistent/mixed version states.
      timestamp, duplicate (video, event_id), or contradictory/invalid human status raises
      ManifestValidationError with path and row number.
    """
    manifest_dir = os.path.dirname(os.path.abspath(manifest_path)) or "."
    check_no_pending_recovery(manifest_dir)

    if not os.path.exists(manifest_path) and not os.path.islink(manifest_path):
        return {
            "exists": False,
            "path": manifest_path,
            "rows": [],
            "by_key": {},
        }

    try:
        with open(manifest_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, restkey="__extra_cols__", restval=None)
            if reader.fieldnames is None:
                raise ManifestValidationError(
                    f"[{manifest_path}:1] Manifest CSV is empty or missing header row."
                )
            header_set = {col.strip() for col in reader.fieldnames if col is not None}
            missing_cols = sorted(REQUIRED_MANIFEST_COLUMNS - header_set)
            if missing_cols:
                raise ManifestValidationError(
                    f"[{manifest_path}:1] Missing required manifest columns: {missing_cols}"
                )

            rows = []
            by_key = {}
            contradictions = []

            for row_idx, raw_row in enumerate(reader, start=2):
                if "__extra_cols__" in raw_row and raw_row["__extra_cols__"]:
                    raise ManifestValidationError(
                        f"[{manifest_path}:{row_idx}] Malformed CSV row with extra unheadered columns."
                    )
                if any(v is None for k, v in raw_row.items() if k in REQUIRED_MANIFEST_COLUMNS):
                    raise ManifestValidationError(
                        f"[{manifest_path}:{row_idx}] Truncated CSV row missing required fields."
                    )

                vid = (raw_row.get("video") or "").strip()
                eid = (raw_row.get("event_id") or "").strip()
                ts_str = (raw_row.get("timestamp_peak_s") or "").strip()
                raw_m_ver = (raw_row.get("manual_verified") or "").strip()
                raw_is_true = (raw_row.get("is_true_stroke") or "").strip()
                raw_notes = (raw_row.get("notes") or "").strip()

                if not vid or not eid:
                    raise ManifestValidationError(
                        f"[{manifest_path}:{row_idx}] Empty video ('{vid}') or event_id ('{eid}')."
                    )

                try:
                    ts_val = float(ts_str)
                except ValueError as exc:
                    raise ManifestValidationError(
                        f"[{manifest_path}:{row_idx}] Unparseable timestamp_peak_s '{ts_str}' for ({vid}, {eid})."
                    ) from exc

                if not math.isfinite(ts_val):
                    raise ManifestValidationError(
                        f"[{manifest_path}:{row_idx}] Non-finite timestamp_peak_s '{ts_str}' for ({vid}, {eid})."
                    )

                key = (vid, eid)
                if key in by_key:
                    prev_line = by_key[key]["line_num"]
                    raise ManifestValidationError(
                        f"[{manifest_path}:{row_idx}] Duplicate (video, event_id)={key} (first seen at line {prev_line})."
                    )

                status_kind, norm_ver, norm_true = classify_annotation_status(raw_m_ver, raw_is_true)
                if status_kind == "INVALID_OR_CONTRADICTORY":
                    contradictions.append(
                        f"line {row_idx} ({vid}, {eid}): manual_verified='{raw_m_ver}', is_true_stroke='{raw_is_true}'"
                    )

                is_signed = status_kind in ("SIGNED_TP", "SIGNED_FP")
                has_notes = raw_notes != ""
                must_preserve = is_signed or has_notes

                parsed_row = {
                    "line_num": row_idx,
                    "video": vid,
                    "event_id": eid,
                    "timestamp_peak_s": ts_val,
                    "timestamp_peak_str": ts_str,
                    "manual_verified": raw_m_ver if is_signed else "PENDING_HUMAN_AUDIT",
                    "is_true_stroke": raw_is_true if is_signed else "PENDING",
                    "raw_manual_verified": raw_m_ver,
                    "raw_is_true_stroke": raw_is_true,
                    "notes": raw_notes,
                    "status_kind": status_kind,
                    "is_signed": is_signed,
                    "has_notes": has_notes,
                    "is_human": is_signed,
                    "must_preserve": must_preserve,
                }
                rows.append(parsed_row)
                by_key[key] = parsed_row

            if contradictions:
                joined = "; ".join(contradictions)
                raise ManifestValidationError(
                    f"[{manifest_path}] Contradictory or invalid annotation status found: {joined}"
                )

            return {
                "exists": True,
                "path": manifest_path,
                "rows": rows,
                "by_key": by_key,
            }
    except ManifestValidationError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise ManifestValidationError(
            f"[{manifest_path}] Failed to read or parse existing manifest: {exc}"
        ) from exc


def match_and_merge_manifest_annotations(
    existing_state,
    new_events,
    timestamp_tolerance_s=DEFAULT_TIMESTAMP_TOLERANCE_S,
):
    """
    Match existing preserved rows (human-signed rows and unsigned rows with notes)
    onto `new_events` in two strict layers:
      1. Exact `(video, event_id)` match WITH timestamp consistency check:
         If event_id matches but timestamp difference > timestamp_tolerance_s,
         it is treated as a conflict/ambiguity requiring human intervention (not silently inherited).
      2. Unambiguous 1-to-1 timestamp fallback within `timestamp_tolerance_s` in the same video
         when `event_id` changed across detector versions.
    If any preserved row is orphaned (no match) or has an ambiguous timestamp match,
    raises ManifestValidationError listing all orphans/ambiguities and refuses to publish.
    """
    seen_new_keys = {}
    for idx, ev in enumerate(new_events):
        vid = str(ev.get("video") or "").strip()
        eid = str(ev.get("event_id") or "").strip()
        if not vid or not eid:
            raise ManifestValidationError(
                f"New event at index {idx} has empty video ('{vid}') or event_id ('{eid}')."
            )
        try:
            ts = float(ev.get("timestamp_peak_s"))
        except (TypeError, ValueError) as exc:
            raise ManifestValidationError(
                f"New event ({vid}, {eid}) has invalid timestamp_peak_s: {ev.get('timestamp_peak_s')}"
            ) from exc
        if not math.isfinite(ts):
            raise ManifestValidationError(
                f"New event ({vid}, {eid}) has non-finite timestamp_peak_s: {ts}"
            )
        key = (vid, eid)
        if key in seen_new_keys:
            raise ManifestValidationError(
                f"Duplicate (video, event_id)={key} in new events at indices {seen_new_keys[key]} and {idx}."
            )
        seen_new_keys[key] = idx

    if not existing_state or not existing_state.get("exists"):
        annotations_by_new_idx = {}
        for idx, ev in enumerate(new_events):
            annotations_by_new_idx[idx] = {
                "resolved_event_id": ev["event_id"],
                "detector_event_id": ev["event_id"],
                "manual_verified": "PENDING_HUMAN_AUDIT",
                "is_true_stroke": "PENDING",
                "notes": "",
                "is_signed": False,
                "is_human": False,
            }
        return {
            "annotations_by_new_idx": annotations_by_new_idx,
            "id_mapping": [],
            "preserved_signed_count": 0,
            "preserved_notes_only_count": 0,
        }

    old_rows = existing_state["rows"]
    preserve_rows = [r for r in old_rows if r["must_preserve"]]

    matched_old_indices = set()
    matched_new_indices = set()
    old_to_new = {}
    orphans = []
    ambiguities = []

    # Layer 1: Exact (video, event_id) match for preserved rows WITH timestamp consistency check
    for old_idx, old_r in enumerate(preserve_rows):
        key = (old_r["video"], old_r["event_id"])
        if key in seen_new_keys:
            new_idx = seen_new_keys[key]
            new_ev = new_events[new_idx]
            diff = abs(float(new_ev["timestamp_peak_s"]) - old_r["timestamp_peak_s"])
            if diff <= timestamp_tolerance_s + 1e-12:
                matched_old_indices.add(old_idx)
                matched_new_indices.add(new_idx)
                old_to_new[old_idx] = (new_idx, "EXACT_ID")
            else:
                ambiguities.append(
                    f"video={old_r['video']}, event_id={old_r['event_id']}: exact ID matched but timestamp shifted from "
                    f"{old_r['timestamp_peak_s']:.3f}s to {float(new_ev['timestamp_peak_s']):.3f}s (> ±{timestamp_tolerance_s:.3f}s)"
                )

    # Layer 2: For unmatched preserved rows where event_id was not exact
    unmatched_preserve_by_video = defaultdict(list)
    for old_idx, old_r in enumerate(preserve_rows):
        if old_idx not in matched_old_indices:
            # If it already had a timestamp shift conflict from Layer 1, don't double-process in Layer 2
            if not any(f"event_id={old_r['event_id']}:" in a for a in ambiguities):
                unmatched_preserve_by_video[old_r["video"]].append((old_idx, old_r))

    unmatched_new_by_video = defaultdict(list)
    for new_idx, ev in enumerate(new_events):
        if new_idx not in matched_new_indices:
            unmatched_new_by_video[ev["video"]].append((new_idx, ev))

    for vid, unmatched_olds in unmatched_preserve_by_video.items():
        cand_news = unmatched_new_by_video.get(vid, [])

        old_candidates = {}
        new_competing_olds = defaultdict(list)

        for old_idx, old_r in unmatched_olds:
            old_ts = old_r["timestamp_peak_s"]
            cands = []
            for new_idx, new_ev in cand_news:
                diff = abs(float(new_ev["timestamp_peak_s"]) - old_ts)
                if diff <= timestamp_tolerance_s + 1e-12:
                    cands.append((new_idx, new_ev, diff))
            old_candidates[old_idx] = cands
            for new_idx, _, _ in cands:
                new_competing_olds[new_idx].append(old_idx)

        all_old_in_vid = [r for r in old_rows if r["video"] == vid]

        for old_idx, old_r in unmatched_olds:
            cands = old_candidates[old_idx]
            if len(cands) == 0:
                orphans.append(
                    f"video={vid}, event_id={old_r['event_id']}, ts={old_r['timestamp_peak_s']:.3f}s, "
                    f"status={old_r['raw_manual_verified']}/{old_r['raw_is_true_stroke']} "
                    f"(reason: no matching new event by ID or within ±{timestamp_tolerance_s:.3f}s)"
                )
            elif len(cands) > 1:
                cand_desc = ", ".join(
                    f"{ne['event_id']}@{float(ne['timestamp_peak_s']):.3f}s" for _, ne, _ in cands
                )
                ambiguities.append(
                    f"video={vid}, old_event_id={old_r['event_id']}@{old_r['timestamp_peak_s']:.3f}s "
                    f"matches multiple new events within ±{timestamp_tolerance_s:.3f}s: [{cand_desc}]"
                )
            else:
                new_idx, new_ev, _ = cands[0]
                new_ts = float(new_ev["timestamp_peak_s"])
                nearby_olds = [
                    r for r in all_old_in_vid
                    if abs(r["timestamp_peak_s"] - new_ts) <= timestamp_tolerance_s + 1e-12
                ]
                if len(new_competing_olds[new_idx]) > 1 or len(nearby_olds) > 1:
                    old_desc = ", ".join(
                        f"{r['event_id']}@{r['timestamp_peak_s']:.3f}s" for r in nearby_olds
                    )
                    ambiguities.append(
                        f"video={vid}, new_event_id={new_ev['event_id']}@{new_ts:.3f}s "
                        f"has multiple old events within ±{timestamp_tolerance_s:.3f}s: [{old_desc}]"
                    )
                else:
                    matched_old_indices.add(old_idx)
                    matched_new_indices.add(new_idx)
                    old_to_new[old_idx] = (new_idx, "TIMESTAMP_FALLBACK")

    if orphans or ambiguities:
        msg_parts = []
        if orphans:
            msg_parts.append(f"Orphan human-annotated events ({len(orphans)}): " + "; ".join(orphans))
        if ambiguities:
            msg_parts.append(f"Ambiguous timestamp matches ({len(ambiguities)}): " + "; ".join(ambiguities))
        raise ManifestValidationError(" | ".join(msg_parts))

    # Build resolved annotations for all new_events
    new_to_old = {new_idx: (old_idx, mode) for old_idx, (new_idx, mode) in old_to_new.items()}
    annotations_by_new_idx = {}
    id_mapping = []
    preserved_signed_count = 0
    preserved_notes_only_count = 0

    used_ids_per_video = defaultdict(set)
    for new_idx, ev in enumerate(new_events):
        vid = ev["video"]
        det_eid = ev["event_id"]
        if new_idx in new_to_old:
            old_idx, mode = new_to_old[new_idx]
            old_r = preserve_rows[old_idx]
            resolved_eid = old_r["event_id"]
            if mode == "TIMESTAMP_FALLBACK" and resolved_eid != det_eid:
                id_mapping.append({
                    "video": vid,
                    "stable_event_id": resolved_eid,
                    "detector_event_id": det_eid,
                    "timestamp_peak_s": float(ev["timestamp_peak_s"]),
                })
            if old_r["is_signed"]:
                preserved_signed_count += 1
            elif old_r["has_notes"]:
                preserved_notes_only_count += 1

            annotations_by_new_idx[new_idx] = {
                "resolved_event_id": resolved_eid,
                "detector_event_id": det_eid,
                "manual_verified": old_r["manual_verified"] if old_r["is_signed"] else "PENDING_HUMAN_AUDIT",
                "is_true_stroke": old_r["is_true_stroke"] if old_r["is_signed"] else "PENDING",
                "notes": old_r["notes"],
                "is_signed": old_r["is_signed"],
                "is_human": old_r["is_signed"],
            }
        else:
            resolved_eid = det_eid
            annotations_by_new_idx[new_idx] = {
                "resolved_event_id": resolved_eid,
                "detector_event_id": det_eid,
                "manual_verified": "PENDING_HUMAN_AUDIT",
                "is_true_stroke": "PENDING",
                "notes": "",
                "is_signed": False,
                "is_human": False,
            }

        if resolved_eid in used_ids_per_video[vid]:
            raise ManifestValidationError(
                f"Event ID collision in video '{vid}' after carrying over stable ID '{resolved_eid}'."
            )
        used_ids_per_video[vid].add(resolved_eid)

    return {
        "annotations_by_new_idx": annotations_by_new_idx,
        "id_mapping": id_mapping,
        "preserved_signed_count": preserved_signed_count,
        "preserved_notes_only_count": preserved_notes_only_count,
    }


def update_events_with_resolved_annotations(all_events, annotations_by_new_idx, staged_checkpoint=None):
    """
    Ensure all event dicts across memory, exports, and checkpoint share the exact same
    resolved event_id so downstream joins on (video, event_id) always succeed.
    """
    for idx, ev in enumerate(all_events):
        ann = annotations_by_new_idx[idx]
        ev["event_id"] = ann["resolved_event_id"]
        ev["detector_event_id"] = ann["detector_event_id"]

    if staged_checkpoint:
        for vname, chk_val in staged_checkpoint.items():
            if isinstance(chk_val, dict) and "events" in chk_val:
                for ev in chk_val["events"]:
                    # Match event by video and detector_event_id or candidate_peak_frame
                    for parent_ev in all_events:
                        if parent_ev["video"] == vname and (
                            parent_ev.get("detector_event_id") == ev.get("detector_event_id")
                            or parent_ev.get("detector_event_id") == ev.get("event_id")
                            or (
                                parent_ev.get("candidate_peak_frame") is not None
                                and parent_ev.get("candidate_peak_frame") == ev.get("candidate_peak_frame")
                            )
                        ):
                            ev["event_id"] = parent_ev["event_id"]
                            ev["detector_event_id"] = parent_ev["detector_event_id"]
                            break


def atomic_write_csv_rows(target_path, fieldnames, rows):
    """
    Atomically write CSV rows to target_path using NamedTemporaryFile + fsync + os.replace.
    """
    target_dir = os.path.dirname(os.path.abspath(target_path)) or "."
    target_base = os.path.basename(target_path)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=target_dir,
            prefix=f".{target_base}.tmp.",
            delete=False,
        ) as tf:
            tmp_path = tf.name
            writer = csv.DictWriter(tf, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, target_path)
        tmp_path = None
    finally:
        if tmp_path is not None and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def atomic_write_json(target_path, data):
    """
    Atomically write JSON data to target_path using NamedTemporaryFile + fsync + os.replace.
    """
    target_dir = os.path.dirname(os.path.abspath(target_path)) or "."
    target_base = os.path.basename(target_path)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=target_dir,
            prefix=f".{target_base}.tmp.",
            delete=False,
        ) as tf:
            tmp_path = tf.name
            json.dump(data, tf, indent=2, ensure_ascii=False)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, target_path)
        tmp_path = None
    finally:
        if tmp_path is not None and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _replace_single_file(src_path, dst_path):
    """
    Copy src_path to dst_path atomically via a sibling temp file in dst_path's directory.
    Separated so rollback restoration uses a distinct function resistant to monkeypatches.
    """
    dst_dir = os.path.dirname(os.path.abspath(dst_path)) or "."
    dst_base = os.path.basename(dst_path)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=dst_dir,
            prefix=f".{dst_base}.replace.tmp.",
            delete=False,
        ) as tf:
            tmp_path = tf.name
            with open(src_path, "rb") as sf:
                shutil.copyfileobj(sf, tf)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, dst_path)
        tmp_path = None
    finally:
        if tmp_path is not None and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _rollback_restore_file(backup_path, dst_path):
    """
    Restore dst_path from backup_path atomically via a sibling temp file in dst_path's directory.
    """
    dst_dir = os.path.dirname(os.path.abspath(dst_path)) or "."
    dst_base = os.path.basename(dst_path)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=dst_dir,
            prefix=f".{dst_base}.rollback.tmp.",
            delete=False,
        ) as tf:
            tmp_path = tf.name
            with open(backup_path, "rb") as sf:
                shutil.copyfileobj(sf, tf)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, dst_path)
        tmp_path = None
    finally:
        if tmp_path is not None and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def batch_publish_files(file_specs, auto_recover=False):
    """
    Publish multiple files with transactional write-ahead journaling and all-or-nothing rollback.
    file_specs: list of dicts:
      {
        "target_path": str,
        "type": "csv" | "json",
        "data": dict/list (if json),
        "fieldnames": list, "rows": list (if csv)
      }
    Protocol:
    1. Pre-flight: checks for pending recovery journals in target directories.
       If auto_recover is True, safely restores any previous aborted transaction before proceeding;
       otherwise raises ManifestValidationError if an unresolved transaction exists.
    2. Stages all files in a temp directory and computes staged SHA-256 hashes.
    3. Backs up existing target files in a temp backup directory and computes original SHA-256.
    4. Writes a persistent Write-Ahead Journal (.batch_publish_recovery.json) recording targets,
       hashes, backup paths, and transaction status BEFORE touching any target files.
    5. Sequentially replaces target files atomically via _replace_single_file.
    6. If ANY replacement fails (e.g. injected OSError on file 2, 3, or 4):
       Rollback attempts to restore all committed files from backup.
       - If rollback succeeds: cleans up journal and backup directory, and re-raises original error.
       - If rollback fails (double-fault): PRESERVES the backup directory, records failure status
         and errors in the recovery journal, and raises RuntimeError.
         Subsequent read and publish operations detect the journal and block mixed-version access
         until recover_pending_batch_publish is invoked.
    """
    target_dirs = sorted({os.path.dirname(os.path.abspath(spec["target_path"])) or "." for spec in file_specs})
    journal_paths = [os.path.join(td, RECOVERY_JOURNAL_FILENAME) for td in target_dirs]

    for td in target_dirs:
        if auto_recover:
            recover_pending_batch_publish(td)
        else:
            check_no_pending_recovery(td)

    staging_dir = tempfile.mkdtemp(prefix=".batch_pub_stage_")
    backup_dir = tempfile.mkdtemp(prefix=".batch_pub_bak_")
    remove_backup_on_finally = False

    staged_items = []
    try:
        # Step 1: Stage all files into staging_dir
        for idx, spec in enumerate(file_specs):
            target_path = os.path.abspath(spec["target_path"])
            base_name = os.path.basename(target_path)
            staged_path = os.path.join(staging_dir, f"staged_{idx}_{base_name}")

            if spec["type"] == "json":
                atomic_write_json(staged_path, spec["data"])
            elif spec["type"] == "csv":
                atomic_write_csv_rows(staged_path, spec["fieldnames"], spec["rows"])
            else:
                raise ValueError(f"Unknown file spec type: {spec['type']}")

            staged_sha = compute_file_sha256(staged_path)
            existed_before = os.path.exists(target_path)
            backup_path = None
            orig_sha = None
            if existed_before:
                orig_sha = compute_file_sha256(target_path)
                backup_path = os.path.join(backup_dir, f"backup_{idx}_{base_name}")
                shutil.copy2(target_path, backup_path)
                if compute_file_sha256(backup_path) != orig_sha:
                    raise RuntimeError(f"Backup verification failed for {target_path}")

            staged_items.append({
                "target_path": target_path,
                "staged_path": staged_path,
                "backup_path": backup_path,
                "original_sha256": orig_sha,
                "staged_sha256": staged_sha,
                "existed_before": existed_before,
                "state": "PENDING",
            })

        # Step 2: Write Write-Ahead Journal BEFORE modifying target files
        tx_id = f"tx_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        journal_data = {
            "transaction_id": tx_id,
            "status": "IN_PROGRESS",
            "timestamp": time.time(),
            "backup_dir": os.path.abspath(backup_dir),
            "staging_dir": os.path.abspath(staging_dir),
            "target_dirs": target_dirs,
            "items": [
                {
                    "target_path": item["target_path"],
                    "backup_path": item["backup_path"],
                    "original_sha256": item["original_sha256"],
                    "staged_sha256": item["staged_sha256"],
                    "existed_before": item["existed_before"],
                    "state": item["state"],
                }
                for item in staged_items
            ],
            "errors": [],
        }
        for jp in journal_paths:
            atomic_write_json(jp, journal_data)

        # Step 3: Atomic sequential replacement with live journal updates
        committed_items = []
        try:
            for idx, item in enumerate(staged_items):
                _replace_single_file(item["staged_path"], item["target_path"])
                item["state"] = "COMMITTED"
                committed_items.append(item)
                journal_data["items"][idx]["state"] = "COMMITTED"
                for jp in journal_paths:
                    atomic_write_json(jp, journal_data)

            # SUCCESS: Clean up journals and mark backup safe to delete
            for jp in journal_paths:
                if os.path.exists(jp):
                    try:
                        os.unlink(jp)
                    except OSError:
                        pass
            remove_backup_on_finally = True

        except BaseException as exc:
            # ROLLBACK: attempt to restore committed items in reverse order
            journal_data["status"] = "ROLLING_BACK"
            for jp in journal_paths:
                atomic_write_json(jp, journal_data)

            rollback_errors = []
            for item in reversed(committed_items):
                try:
                    if item["existed_before"]:
                        _rollback_restore_file(item["backup_path"], item["target_path"])
                        curr_sha = compute_file_sha256(item["target_path"])
                        if curr_sha != item["original_sha256"]:
                            raise RuntimeError(
                                f"Restored file sha mismatch on {item['target_path']}: "
                                f"expected {item['original_sha256']}, got {curr_sha}"
                            )
                    else:
                        if os.path.exists(item["target_path"]):
                            os.unlink(item["target_path"])
                    item["state"] = "RESTORED"
                except BaseException as r_err:
                    item["state"] = "RESTORE_FAILED"
                    rollback_errors.append(f"{item['target_path']}: {r_err}")

            for j_item in journal_data["items"]:
                for c_item in committed_items:
                    if j_item["target_path"] == c_item["target_path"]:
                        j_item["state"] = c_item["state"]

            if not rollback_errors:
                # Clean rollback succeeded: all files restored to original bytes
                for jp in journal_paths:
                    if os.path.exists(jp):
                        try:
                            os.unlink(jp)
                        except OSError:
                            pass
                remove_backup_on_finally = True
                raise
            else:
                # Double fault: rollback failed!
                journal_data["status"] = "ROLLBACK_FAILED"
                journal_data["errors"] = rollback_errors
                for jp in journal_paths:
                    atomic_write_json(jp, journal_data)
                # CRITICAL: DO NOT DELETE BACKUP DIRECTORY!
                remove_backup_on_finally = False
                raise RuntimeError(
                    f"Batch publish failed with '{exc}' and rollback encountered secondary errors: {rollback_errors}. "
                    f"Recovery backup preserved at '{backup_dir}'. "
                    f"Recovery journal persisted at {journal_paths}. "
                    f"Mixed version read/publish is blocked until recover_pending_batch_publish is invoked."
                ) from exc
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)
        if remove_backup_on_finally:
            shutil.rmtree(backup_dir, ignore_errors=True)
