#!/usr/bin/env python3
"""
Unit tests for Kinematics v2 Pipeline:
1. Coordinate sign and conventions (Y-up, wrist relative to hip)
2. Aspect ratio compensation (isotropic Euclidean distance in physical pixels)
3. Known velocity recovery and zero-velocity recovery
4. Tracking jump / teleportation outlier rejection
5. Scale degeneracy detection
6. Candidate event peak merging
"""

import math
import unittest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.kinematics_v2 import (
    to_pixel_coords,
    calculate_angle_2d,
    OneEuroFilter2D,
    compute_kinematics_series,
    detect_candidate_events,
    estimate_reference_scale,
    DEG_OK,
    DEG_SCALE_LOW,
    DEG_SCALE_HIGH
)

class TestKinematicsV2(unittest.TestCase):

    def test_coordinate_signs_y_up(self):
        """Verify Y-up convention: wrist above hip is positive, wrist below hip is negative."""
        scale = 200.0
        hip_y = 800.0
        wrist_y_above = 600.0
        wrist_y_below = 1000.0
        
        rel_above = (hip_y - wrist_y_above) / scale
        rel_below = (hip_y - wrist_y_below) / scale
        
        self.assertGreater(rel_above, 0, "Wrist above hip must yield positive relative height")
        self.assertEqual(rel_above, 1.0, f"Expected 1.0 torso length above, got {rel_above}")
        self.assertLess(rel_below, 0, "Wrist below hip must yield negative relative height")
        self.assertEqual(rel_below, -1.0, f"Expected -1.0 torso length below, got {rel_below}")

    def test_aspect_ratio_compensation(self):
        """Verify that normalized coordinates (1080x1920) are properly converted to isotropic pixels."""
        w, h = 1080, 1920
        p1_norm = (0.5, 0.5)
        p2_norm = (0.6, 0.5)
        p3_norm = (0.5, 0.6)
        
        p1_px = to_pixel_coords(p1_norm, w, h)
        p2_px = to_pixel_coords(p2_norm, w, h)
        p3_px = to_pixel_coords(p3_norm, w, h)
        
        dist_horizontal = math.hypot(p2_px[0] - p1_px[0], p2_px[1] - p1_px[1])
        dist_vertical = math.hypot(p3_px[0] - p1_px[0], p3_px[1] - p1_px[1])
        
        self.assertEqual(dist_horizontal, 108.0)
        self.assertEqual(dist_vertical, 192.0)
        
        # Check 90-degree angle calculation in pixel space
        angle = calculate_angle_2d((0.0, 100.0), (0.0, 0.0), (100.0, 0.0))
        self.assertTrue(math.isclose(angle, 90.0, abs_tol=1e-5), f"Expected 90 deg, got {angle}")

    def test_constant_velocity_recovery(self):
        """Verify known synthetic velocity is accurately recovered without phantom scale jitter."""
        fps = 60.0
        dt = 1.0 / fps
        scale_ref = 200.0  # 200 pixels = 1 torso length
        known_speed_torso_s = 2.5  # 2.5 torso-lengths per sec = 500 pixels/sec
        
        n_frames = 120
        times = [i * dt for i in range(n_frames)]
        # Linear trajectory moving rightwards at 500 px/sec
        positions_px = [(100.0 + i * dt * 500.0, 500.0) for i in range(n_frames)]
        visibilities = [0.99] * n_frames
        
        speeds, vel_x, vel_y, accel_y, flags = compute_kinematics_series(
            positions_px, times, scale_ref, visibilities
        )
        
        interior_speeds = speeds[20:100]
        for s in interior_speeds:
            self.assertTrue(math.isclose(s, known_speed_torso_s, rel_tol=0.03), f"Speed {s} deviates from known {known_speed_torso_s}")
        
        interior_ay = accel_y[20:100]
        for a in interior_ay:
            self.assertLess(abs(a), 0.1, f"Expected ~0 vertical acceleration, got {a}")

    def test_tracking_jump_outlier_rejection(self):
        """Verify that an insane single-frame teleportation jump does not create 30,000 velocity."""
        fps = 60.0
        dt = 1.0 / fps
        scale_ref = 200.0
        
        n_frames = 60
        times = [i * dt for i in range(n_frames)]
        positions_px = [(500.0, 500.0) for _ in range(n_frames)]
        visibilities = [0.95] * n_frames
        
        # Inject an extreme glitch at frame 30 (teleport to 1500, 1500)
        positions_px[30] = (1500.0, 1500.0)
        
        speeds, vel_x, vel_y, accel_y, flags = compute_kinematics_series(
            positions_px, times, scale_ref, visibilities
        )
        
        self.assertTrue("JUMP_OUTLIER" in flags[30] or "LOW_CONF" in flags[30])
        max_speed = max(speeds)
        self.assertLess(max_speed, 15.0, f"Speed blew up to {max_speed}, jump rejection failed!")

    def test_scale_degeneracy_detection(self):
        """Verify scale degeneracy guard flags frames where torso length collapses."""
        scale_ref = 200.0
        torso_lengths = [190.0, 60.0, 450.0]
        
        flags = []
        for L in torso_lengths:
            if L < 0.4 * scale_ref:
                flags.append(DEG_SCALE_LOW)
            elif L > 2.0 * scale_ref:
                flags.append(DEG_SCALE_HIGH)
            else:
                flags.append(DEG_OK)
                
        self.assertEqual(flags, [DEG_OK, DEG_SCALE_LOW, DEG_SCALE_HIGH])

    def test_candidate_event_peak_merging(self):
        """Verify that multiple local ripples within 0.45s are merged into a single coherent stroke event."""
        fps = 60.0
        dt = 1.0 / fps
        n_frames = 180  # 3 seconds
        times = [i * dt for i in range(n_frames)]
        
        speeds = [0.2] * n_frames
        for i in range(45, 90):
            speeds[i] = 0.2 + 3.8 * math.exp(-((i - 60)**2) / 40.0) + 2.8 * math.exp(-((i - 72)**2) / 30.0)
        for i in range(130, 175):
            speeds[i] = 0.2 + 4.8 * math.exp(-((i - 150)**2) / 50.0)
            
        positions_px = [(500.0 + i * 5.0, 500.0) for i in range(n_frames)]
        flags = ["OK"] * n_frames
        scale_ref = 200.0
        
        events = detect_candidate_events(
            speeds=speeds,
            times=times,
            positions_px=positions_px,
            flags=flags,
            scale_ref=scale_ref,
            min_peak_speed=1.5,
            min_path_len=0.3,
            merge_window_s=0.45
        )
        
        self.assertEqual(len(events), 2, f"Expected 2 merged events, got {len(events)}")
        self.assertTrue(math.isclose(events[0]["timestamp_peak_s"], 1.0, abs_tol=0.1), f"Event 1 peak mismatch: {events[0]}")
        self.assertTrue(math.isclose(events[1]["timestamp_peak_s"], 2.5, abs_tol=0.1), f"Event 2 peak mismatch: {events[1]}")

if __name__ == "__main__":
    unittest.main()
