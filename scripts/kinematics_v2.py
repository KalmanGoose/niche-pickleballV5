#!/usr/bin/env python3
"""
NCHU Pickleball - Kinematics v2 Module
Core Principles:
1. Isotropic pixel basis: All distances and angles are computed in unskewed pixel coordinates.
2. Honest non-dimensional scaling: Normalized by stable median torso length (torso-lengths / s),
   avoiding uncalibrated pseudo-metric (m/s) claims and per-frame scale jitter.
3. Y-upwards coordinate orientation: Wrist above hip is positive, wrist below hip is negative.
4. Robust 1-Euro filtering and jump/outlier rejection before numerical differentiation.
5. Class-agnostic candidate stroke event detector with peak merging (NMS).
"""

import math
import numpy as np

DEG_OK = "OK"
DEG_SCALE_LOW = "DEGRADED_SCALE_COLLAPSE"
DEG_SCALE_HIGH = "DEGRADED_SCALE_EXPAND"

def to_pixel_coords(norm_pt, width, height):
    """Convert MediaPipe normalized coordinate (x in [0,1], y in [0,1]) to isotropic pixel coordinates."""
    if norm_pt is None:
        return None
    return (float(norm_pt[0]) * width, float(norm_pt[1]) * height)

def calculate_angle_2d(a, b, c):
    """
    Calculate 2D angle ABC (with b as vertex) in degrees in pixel space.
    a, b, c are (x, y) tuples.
    """
    v1 = np.array([a[0] - b[0], a[1] - b[1]], dtype=np.float64)
    v2 = np.array([c[0] - b[0], c[1] - b[1]], dtype=np.float64)
    denom = (np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-7
    cos_val = np.clip(np.dot(v1, v2) / denom, -1.0, 1.0)
    return float(math.degrees(math.acos(cos_val)))

class OneEuroFilter1D:
    """1-Euro Filter for adaptive low-jitter, low-latency smoothing."""
    def __init__(self, min_cutoff=1.0, beta=0.007, d_cutoff=1.0):
        self.min_cutoff = float(min_cutoff)
        self.beta = float(beta)
        self.d_cutoff = float(d_cutoff)
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None

    def _alpha(self, cutoff, dt):
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / max(dt, 1e-5))

    def filter(self, x, t):
        if x is None:
            return None
        if self.t_prev is None:
            self.t_prev = t
            self.x_prev = x
            self.dx_prev = 0.0
            return x

        dt = max(t - self.t_prev, 1e-4)
        edx = (x - self.x_prev) / dt
        alpha_d = self._alpha(self.d_cutoff, dt)
        dx_hat = alpha_d * edx + (1.0 - alpha_d) * self.dx_prev

        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        alpha = self._alpha(cutoff, dt)
        x_hat = alpha * x + (1.0 - alpha) * self.x_prev

        self.x_prev = x_hat
        self.dx_prev = dx_hat
        self.t_prev = t
        return x_hat

class OneEuroFilter2D:
    def __init__(self, min_cutoff=1.2, beta=0.02, d_cutoff=1.0):
        self.fx = OneEuroFilter1D(min_cutoff, beta, d_cutoff)
        self.fy = OneEuroFilter1D(min_cutoff, beta, d_cutoff)

    def filter(self, pt, t):
        if pt is None:
            return None
        return (self.fx.filter(pt[0], t), self.fy.filter(pt[1], t))

def estimate_reference_scale(frames_landmarks, width, height):
    """
    Estimate reference torso scale S_ref (pixels) as the median length of shoulder-midpoint to hip-midpoint.
    Returns S_ref in pixels and list of per-frame torso lengths.
    """
    torso_lengths = []
    for lms in frames_landmarks:
        if not lms:
            torso_lengths.append(None)
            continue
        
        # 11: left shoulder, 12: right shoulder, 23: left hip, 24: right hip
        ls, rs = lms[11], lms[12]
        lh, rh = lms[23], lms[24]
        
        if ls.visibility < 0.4 or rs.visibility < 0.4 or lh.visibility < 0.4 or rh.visibility < 0.4:
            torso_lengths.append(None)
            continue
            
        sh_mid_x = ((ls.x + rs.x) / 2.0) * width
        sh_mid_y = ((ls.y + rs.y) / 2.0) * height
        hip_mid_x = ((lh.x + rh.x) / 2.0) * width
        hip_mid_y = ((lh.y + rh.y) / 2.0) * height
        
        L = math.hypot(sh_mid_x - hip_mid_x, sh_mid_y - hip_mid_y)
        torso_lengths.append(L)

    valid_L = [L for L in torso_lengths if L is not None]
    if len(valid_L) < 10:
        # Fallback to 25% of image height
        scale_ref = float(height) * 0.25
    else:
        scale_ref = float(np.median(valid_L))

    scale_ref = max(scale_ref, 20.0)  # avoid division by zero
    return scale_ref, torso_lengths

def compute_kinematics_series(positions_px, times, scale_ref, visibilities):
    """
    Compute filtered kinematics for a trajectory of 2D points.
    Returns:
        speeds: wrist speed in torso-lengths/sec
        vel_x: horizontal velocity in torso-lengths/sec
        vel_y: vertical velocity (Y-up) in torso-lengths/sec
        accel_y: vertical acceleration (Y-up) in torso-lengths/sec^2
        flags: list of quality flags per frame
    """
    n = len(positions_px)
    flags = ["OK"] * n
    
    # 1. Outlier and jump rejection
    filtered_pos = []
    f2d = OneEuroFilter2D(min_cutoff=1.5, beta=0.03)
    
    # Max reasonable displacement between consecutive frames (30 torso-lengths/sec equivalent)
    max_disp = 1.5 * scale_ref

    last_good_pt = None
    for i in range(n):
        pt = positions_px[i]
        vis = visibilities[i] if visibilities else 1.0
        t = times[i]
        
        if pt is None or vis < 0.4:
            flags[i] = "LOW_CONF"
            filtered_pos.append(None)
            continue
            
        if last_good_pt is not None:
            disp = math.hypot(pt[0] - last_good_pt[0], pt[1] - last_good_pt[1])
            if disp > max_disp:
                flags[i] = "JUMP_OUTLIER"
                filtered_pos.append(None)
                continue
                
        last_good_pt = pt
        f_pt = f2d.filter(pt, t)
        filtered_pos.append(f_pt)

    # 2. Numerical differentiation with contiguous segment handling
    speeds = [0.0] * n
    vel_x = [0.0] * n
    vel_y = [0.0] * n
    accel_y = [0.0] * n

    # Y-up convention: Y_up = -y_px, X_right = x_px
    for i in range(n):
        if filtered_pos[i] is None:
            continue
            
        has_prev = (i > 0 and filtered_pos[i - 1] is not None)
        has_next = (i < n - 1 and filtered_pos[i + 1] is not None)
        
        if has_prev and has_next:
            dt = times[i + 1] - times[i - 1]
            if dt > 1e-4:
                vx = (filtered_pos[i + 1][0] - filtered_pos[i - 1][0]) / dt
                # y_px goes down, so Y_up = -y_px
                vy = (-filtered_pos[i + 1][1] - (-filtered_pos[i - 1][1])) / dt
                vx_s = vx / scale_ref
                vy_s = vy / scale_ref
                vel_x[i] = vx_s
                vel_y[i] = vy_s
                speeds[i] = math.hypot(vx_s, vy_s)
        elif has_next:
            dt = times[i + 1] - times[i]
            if dt > 1e-4:
                vx = (filtered_pos[i + 1][0] - filtered_pos[i][0]) / dt
                vy = (-filtered_pos[i + 1][1] - (-filtered_pos[i][1])) / dt
                vx_s = vx / scale_ref
                vy_s = vy / scale_ref
                vel_x[i] = vx_s
                vel_y[i] = vy_s
                speeds[i] = math.hypot(vx_s, vy_s)
        elif has_prev:
            dt = times[i] - times[i - 1]
            if dt > 1e-4:
                vx = (filtered_pos[i][0] - filtered_pos[i - 1][0]) / dt
                vy = (-filtered_pos[i][1] - (-filtered_pos[i - 1][1])) / dt
                vx_s = vx / scale_ref
                vy_s = vy / scale_ref
                vel_x[i] = vx_s
                vel_y[i] = vy_s
                speeds[i] = math.hypot(vx_s, vy_s)

    # 3. Vertical acceleration derivative
    for i in range(n):
        if filtered_pos[i] is None:
            continue
        has_prev = (i > 0 and filtered_pos[i - 1] is not None)
        has_next = (i < n - 1 and filtered_pos[i + 1] is not None)
        if has_prev and has_next:
            dt = times[i + 1] - times[i - 1]
            if dt > 1e-4:
                accel_y[i] = (vel_y[i + 1] - vel_y[i - 1]) / dt

    return speeds, vel_x, vel_y, accel_y, flags

def detect_candidate_events(
    speeds,
    times,
    positions_px,
    flags,
    scale_ref,
    min_peak_speed=1.5,
    min_path_len=0.3,
    merge_window_s=0.45
):
    """
    Class-agnostic candidate event detector.
    Detects local peaks in wrist speed, merges nearby peaks, and validates path length.
    Returns list of event dicts.
    """
    n = len(speeds)
    if n < 5:
        return []

    # 1. Find all local peaks above min_peak_speed
    raw_peaks = []
    window = 4
    for i in range(window, n - window):
        v = speeds[i]
        if v >= min_peak_speed and flags[i] == "OK":
            is_local_max = all(v >= speeds[i + k] for k in range(-window, window + 1) if k != 0)
            if is_local_max:
                raw_peaks.append(i)

    if not raw_peaks:
        return []

    # 2. Merge peaks that occur within merge_window_s (Non-Maximum Suppression)
    merged_peaks = []
    curr_cluster = [raw_peaks[0]]
    for p in raw_peaks[1:]:
        if times[p] - times[curr_cluster[-1]] <= merge_window_s:
            curr_cluster.append(p)
        else:
            # Pick highest peak in cluster
            best_p = max(curr_cluster, key=lambda idx: speeds[idx])
            merged_peaks.append(best_p)
            curr_cluster = [p]
    if curr_cluster:
        best_p = max(curr_cluster, key=lambda idx: speeds[idx])
        merged_peaks.append(best_p)

    # 3. For each peak, expand to find start and end boundaries, and verify path length
    events = []
    for p in merged_peaks:
        v_peak = speeds[p]
        v_threshold = max(0.5, 0.25 * v_peak)
        
        # Trace backwards
        start_idx = p
        while start_idx > 0 and speeds[start_idx] > v_threshold and (times[p] - times[start_idx]) < 1.0:
            start_idx -= 1
            
        # Trace forwards
        end_idx = p
        while end_idx < n - 1 and speeds[end_idx] > v_threshold and (times[end_idx] - times[p]) < 1.0:
            end_idx += 1

        # Calculate path length between start and end
        path_px = 0.0
        for k in range(start_idx, end_idx):
            if positions_px[k] and positions_px[k + 1]:
                path_px += math.hypot(positions_px[k+1][0] - positions_px[k][0],
                                      positions_px[k+1][1] - positions_px[k][1])
        path_torso = path_px / scale_ref

        if path_torso >= min_path_len:
            events.append({
                "start_frame_idx": start_idx,
                "peak_frame_idx": p,
                "end_frame_idx": end_idx,
                "timestamp_start_s": times[start_idx],
                "timestamp_peak_s": times[p],
                "timestamp_end_s": times[end_idx],
                "duration_s": times[end_idx] - times[start_idx],
                "peak_speed_torso_s": v_peak,
                "path_length_torso": path_torso,
                "quality_flag": flags[p]
            })

    return events
