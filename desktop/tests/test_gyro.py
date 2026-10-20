import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np

from bike_workbench.analysis import Ride, Settings, analyze
from bike_workbench.gyro import bike_frame


def ride(hz=50, quiet=True):
    t = np.arange(4 * hz + 1) / hz
    a = np.zeros((len(t), 3)); a[:, 2] = 1
    a[(t >= 1) & (t <= 1.5), 2] = .1
    a[(t > 1.5) & (t <= 1.5 + 1.1 / hz), 2] = 2.5
    g = np.zeros_like(a)
    # A large steady rotation must not be mistaken for trail vibration.
    g[:, 1] = 40 + 20 * t
    noise = 18 * np.sin(2 * np.pi * 12 * t)
    if quiet:
        noise[(t >= 1) & (t <= 1.5)] = 0
    g[:, 1] += noise
    return Ride(Path('synthetic.csv'), 'synthetic', t, a, g)


class GyroTests(unittest.TestCase):
    def test_smooth_rotation_supports_both_boundaries_at_50_and_250hz(self):
        for hz in (50, 250):
            with self.subTest(hz=hz):
                event = analyze(ride(hz), Settings())["events"][0]
                evidence = event["gyro_evidence"]
                self.assertEqual(evidence["status"], "supports")
                self.assertGreater(evidence["support_score"], 90)
                self.assertTrue(evidence["takeoff_supported"])
                self.assertTrue(evidence["landing_supported"])

    def test_rough_flight_has_no_contrast_and_does_not_delete_candidate(self):
        result = analyze(ride(quiet=False), Settings())
        self.assertEqual(len(result["events"]), 1)
        evidence = result["events"][0]["gyro_evidence"]
        self.assertEqual(evidence["status"], "no contrast")
        self.assertLess(evidence["support_score"], 20)

    def test_quiet_ground_is_inconclusive_not_high_confidence(self):
        r = ride(); r.gyro[:] = 0
        evidence = analyze(r, Settings())["events"][0]["gyro_evidence"]
        self.assertIsNone(evidence["support_score"])
        self.assertIn("quiet", " ".join(evidence["reasons"]))

    def test_all_axis_evidence_is_rotation_invariant(self):
        r = ride()
        before = analyze(r, Settings())["events"][0]["gyro_evidence"]
        theta = .7
        rotation = np.array([[np.cos(theta), -np.sin(theta), 0], [np.sin(theta), np.cos(theta), 0], [0, 0, 1]])
        r.gyro = r.gyro @ rotation.T
        after = analyze(r, Settings())["events"][0]["gyro_evidence"]
        self.assertAlmostEqual(before["support_score"], after["support_score"], places=5)

    def test_pitch_requires_valid_calibration_and_does_not_substitute_axis(self):
        r = ride()
        settings = Settings(gyro_channel="pitch")
        result = analyze(r, settings)
        self.assertEqual(result["gyro_channel"], "pitch unavailable")
        self.assertIsNone(result["events"][0]["gyro_evidence"]["support_score"])
        r.calibration = {"forward": [1, 0, 0], "left": [0, 1, 0], "up": [0, 0, 1], "bias": [0, 10, 0]}
        self.assertAlmostEqual(bike_frame(r)[0, 1], r.gyro[0, 1] - 10)
        evidence = analyze(r, settings)["events"][0]["gyro_evidence"]
        self.assertEqual(evidence["channel"], "bike pitch rate")
        self.assertEqual(evidence["status"], "supports")
        r.calibration["left"] = [1, 0, 0]
        self.assertIsNone(bike_frame(r))

    def test_clipped_flight_invalidates_evidence_not_jump(self):
        r = ride(); r.gyro[np.isclose(r.time, 1.24), 0] = 250
        event = analyze(r, Settings())["events"][0]
        self.assertTrue(event["gyro_clipped"])
        self.assertIsNone(event["gyro_evidence"]["support_score"])
        self.assertIsNone(event["gyro_evidence"]["flight_dps"])

    def test_context_never_crosses_recording_gap(self):
        r = ride()
        # Put a gap within the pre-jump context, but before the candidate.
        r.time[r.time >= .8] += .5
        result = analyze(r, Settings())
        self.assertEqual(result["gap_count"], 1)
        e = result["events"][0]["gyro_evidence"]
        self.assertIsNone(e["before_dps"])
        self.assertIsNone(e["support_score"])
        gap = np.flatnonzero(np.diff(result["time"]) > .12)[0]
        self.assertTrue(np.isnan(result["gyro_vibration"][gap:gap + 2]).all())

    def test_short_flight_is_unavailable(self):
        r = ride()
        r.accel[:, 2] = 1
        r.accel[(r.time >= 1) & (r.time <= 1.12), 2] = .1
        r.accel[np.isclose(r.time, 1.14), 2] = 2.5
        e = analyze(r, Settings())["events"][0]
        self.assertIsNone(e["gyro_evidence"]["support_score"])

    def test_toggle_and_threshold_change_scores_without_moving_boundaries(self):
        r = ride()
        baseline = analyze(r, Settings(gyro_detection="off"))["events"][0]
        for s in (Settings(gyro_evidence="off", gyro_detection="off"), Settings(gyro_ratio=.1, gyro_detection="off"), Settings(gyro_context_s=.5, gyro_detection="off")):
            e = analyze(r, s)["events"][0]
            for k in ("start_s", "end_s", "impact_s", "distance_ft"):
                self.assertEqual(e[k], baseline[k])
        self.assertEqual(analyze(r, Settings(gyro_evidence="off", gyro_detection="off"))["events"][0]["gyro_evidence"]["status"], "off")

    def test_ratio_adjusts_support_labels_without_filtering_events(self):
        r = ride()
        mask = (r.time >= 1) & (r.time <= 1.5)
        r.gyro[mask, 1] += 9 * np.sin(2 * np.pi * 12 * r.time[mask])
        normal = analyze(r, Settings(gyro_detection="off"))["events"][0]
        strict = analyze(r, Settings(gyro_ratio=.25, gyro_detection="off"))["events"][0]
        self.assertEqual(normal["gyro_evidence"]["status"], "supports")
        self.assertEqual(strict["gyro_evidence"]["status"], "no contrast")
        self.assertEqual(normal["start_s"], strict["start_s"])

    def split_flight(self):
        r = ride()
        t = r.time
        r.accel[:, 2] = 1
        r.accel[(t >= 1) & (t <= 1.2), 2] = .1
        r.accel[(t > 1.2) & (t < 1.42), 2] = .9
        r.accel[(t >= 1.42) & (t <= 1.9), 2] = .1
        r.accel[np.isclose(t, 1.3), 2] = 1.8  # A bump can fool acceleration alone.
        r.accel[np.isclose(t, 1.92), 2] = 2.5
        noise = 18 * np.sin(2 * np.pi * 12 * t)
        noise[(t >= 1) & (t <= 1.9)] = 0
        r.gyro[:, 1] = 40 + 20 * t + noise
        return r

    def test_gyro_changes_count_by_joining_quiet_interruption_and_final_impact(self):
        r = self.split_flight()
        s = Settings(merge_gap_s=.1)
        old = analyze(r, replace(s, gyro_detection="off"))["events"]
        new = analyze(r, s)["events"]
        self.assertEqual(len(old), 2)
        self.assertEqual(len(new), 1)
        self.assertEqual(new[0]["gyro_detection"]["joined_gaps"], 1)
        self.assertEqual(new[0]["joined_windows"], 2)
        self.assertAlmostEqual(new[0]["impact_s"], 1.92)
        self.assertAlmostEqual(new[0]["distance_ft"], 26.4 * new[0]["window_s"])

    def test_gyro_does_not_bridge_returning_vibration_clipping_or_full_loading(self):
        for kind in ("vibration", "clipped", "loaded", "gap"):
            with self.subTest(kind=kind):
                r = self.split_flight()
                mask = (r.time > 1.2) & (r.time < 1.42)
                if kind == "vibration":
                    r.gyro[mask, 1] += 60 * np.sin(2 * np.pi * 12 * r.time[mask])
                elif kind == "clipped":
                    r.gyro[np.isclose(r.time, 1.3), 0] = 250
                elif kind == "loaded":
                    r.accel[mask, 2] = 1.3
                    r.accel[np.isclose(r.time, 1.3), 2] = 1.8
                else:
                    r.time[r.time >= 1.4] += 1
                events = analyze(r, Settings(merge_gap_s=.1))["events"]
                self.assertEqual(len(events), 2)
                self.assertTrue(all(e["gyro_detection"]["joined_gaps"] == 0 for e in events))

    def test_gyro_refines_boundaries_and_disabled_mode_reproduces_acceleration(self):
        r = ride()
        old = analyze(r, Settings(gyro_detection="off"))["events"][0]
        new = analyze(r, Settings())["events"][0]
        self.assertNotEqual(new["start_s"], old["start_s"])
        self.assertEqual(new["gyro_detection"]["timing"], "gyro refined timing")
        self.assertLessEqual(abs(new["start_s"] - old["start_s"]), .12)
        self.assertLessEqual(abs(new["end_s"] - old["end_s"]), .12)
        self.assertEqual(new["gyro_detection"]["acceleration_start_s"], old["start_s"])
        fixed = analyze(r, Settings(gyro_refine_s=0))["events"][0]
        self.assertEqual(fixed["start_s"], old["start_s"])
        missing = analyze(r, Settings(gyro_channel="pitch"))["events"][0]
        self.assertEqual(missing["start_s"], old["start_s"])

    def test_gyro_bridge_limits_and_final_impact_are_respected(self):
        r = self.split_flight()
        for settings in (Settings(merge_gap_s=.1, gyro_join_s=0), Settings(merge_gap_s=.1, max_window_s=.7)):
            self.assertEqual(len(analyze(r, settings)["events"]), 2)
        r.accel[np.isclose(r.time, 1.92), 2] = 1
        old = analyze(r, Settings(merge_gap_s=.1, gyro_detection="off"))["events"]
        new = analyze(r, Settings(merge_gap_s=.1))["events"]
        self.assertEqual(len(old), 1)
        self.assertEqual(len(new), 1)
        self.assertEqual(new[0]["gyro_detection"]["joined_gaps"], 0)

    def test_refinement_cannot_remove_an_existing_impact_candidate(self):
        from unittest.mock import patch
        r = ride()
        r.accel[np.isclose(r.time, 1.52), 2] = 1
        r.accel[np.isclose(r.time, 1.78), 2] = 2.5
        with patch("bike_workbench.analysis.gyro.refine_window", return_value=(50, 69, "gyro refined timing")):
            event = analyze(r, Settings())["events"][0]
        self.assertAlmostEqual(event["end_s"], 1.5)
        self.assertAlmostEqual(event["impact_s"], 1.78)
        self.assertIn("lose observed impact", event["gyro_detection"]["timing"])

    def test_invalid_gyro_settings_fail(self):
        for kwargs in ({"gyro_detection": "invalid"}, {"gyro_join_s": -1}, {"gyro_refine_s": -1}, {"gyro_bridge_g": 0}, {"gyro_evidence": "gate"}, {"gyro_channel": "x"}, {"gyro_ratio": 1}, {"gyro_trend_s": 0}, {"gyro_context_s": -1}, {"gyro_floor_dps": float("nan")}):
            with self.assertRaises(ValueError):
                replace(Settings(), **kwargs).validate()
