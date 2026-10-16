#!/usr/bin/env python3
"""
Shared Manifest Annotations Safety & Atomic I/O Helper (v2)
===========================================================
Provides fail-closed reading, validation, two-layer 1-to-1 annotation matching
(exact (video, event_id) followed by unambiguous timestamp fallback), and
single-file atomic replacement via tempfile + fsync + os.replace.
"""

import csv
import json
import math
import os
import tempfile
from collections import defaultdict

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
      timestamp, duplicate (video, event_id), or contradictory/invalid human status raises
      ManifestValidationError with path and row number.
    """
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
      1. Exact `(video, event_id)` match.
      2. Unambiguous 1-to-1 timestamp fallback within `timestamp_tolerance_s` in the same video
         when `event_id` changed across detector versions.
    If any preserved row is orphaned (no match) or has an ambiguous timestamp match,
    raises ManifestValidationError listing all orphans/ambiguities and refuses to publish.

    Returns dict with:
      - `annotations_by_new_idx`: dict mapping index in `new_events` -> resolved annotation dict
        (including `resolved_event_id` carrying over the stable old ID when matched by timestamp,
         and `detector_event_id` recording the raw new detector ID).
      - `id_mapping`: list of dicts for any event whose ID was carried over from an old signed row.
      - `preserved_signed_count`: number of human-signed rows preserved.
      - `preserved_notes_only_count`: number of unsigned note rows preserved.
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

    # Layer 1: Exact (video, event_id) match for preserved rows
    for old_idx, old_r in enumerate(preserve_rows):
        key = (old_r["video"], old_r["event_id"])
        if key in seen_new_keys:
            new_idx = seen_new_keys[key]
            matched_old_indices.add(old_idx)
            matched_new_indices.add(new_idx)
            old_to_new[old_idx] = (new_idx, "EXACT_ID")

    # Also reserve any new_events that exactly match an unsigned old row's (video, event_id)
    # ONLY if no timestamp ambiguity exists, wait: what if detector renumbered events?
    # If detector renumbered events, ev_001 might now be at a completely different timestamp!
    # Wait: let's check if Layer 1 exact ID match should also verify that if an old row matched by ID,
    # Wait: in tiering, IDs are identical; in re-extraction with same events, IDs are identical.
    # For Layer 2 (unmatched preserved rows where ID changed):
    orphans = []
    ambiguities = []

    # Group all old rows (both signed and unsigned) and unmatched new events by video
    unmatched_preserve_by_video = defaultdict(list)
    for old_idx, old_r in enumerate(preserve_rows):
        if old_idx not in matched_old_indices:
            unmatched_preserve_by_video[old_r["video"]].append((old_idx, old_r))

    unmatched_new_by_video = defaultdict(list)
    for new_idx, ev in enumerate(new_events):
        if new_idx not in matched_new_indices:
            unmatched_new_by_video[ev["video"]].append((new_idx, ev))

    for vid, unmatched_olds in unmatched_preserve_by_video.items():
        cand_news = unmatched_new_by_video.get(vid, [])

        # For each unmatched old preserved row, find candidate new events within tolerance
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

        # Also check if any OTHER old row in the same video falls within timestamp_tolerance_s
        # of an unmatched preserved row's candidate new event (causing old-row ambiguity)
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
                # Check if multiple preserved rows compete for this new_idx, OR multiple old rows
                # in the manifest lie within tolerance of new_ts
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

    # Check for ID collision if any TIMESTAMP_FALLBACK carries over old event_id
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


def atomic_write_csv_rows(target_path, fieldnames, rows):
    """
    Atomically write CSV rows to `target_path` using a sibling NamedTemporaryFile,
    flush + fsync, and os.replace. Cleans up temp file and preserves original target on failure.
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
    Atomically write JSON data to `target_path` using a sibling NamedTemporaryFile,
    flush + fsync, and os.replace. Cleans up temp file and preserves original target on failure.
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
