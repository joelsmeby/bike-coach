import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np

from bike_workbench import gps
from bike_workbench.analysis import Settings, analyze, load_ride
from test_analysis import synthetic_ride, write_csv


def metadata(step=.1, stop=4, speed=8):
    epoch = 1700000000000
    points = [{"timestamp": epoch + round(t * 1000), "latitude": 47., "longitude": -122.,
               "accuracy": 5., "speed": speed, "segment": 0} for t in np.arange(0, stop + step / 2, step)]
    ride = {"id": "0123456789abcdef", "startBoardMs": 200}
    value = {"schemaVersion": 1, "id": ride["id"], "sync": {"phoneEpochMs": epoch - 100, "boardMs": 100, "uncertaintyMs": 25}, "points": points}
    return ride, value


def imported(step=.1, stop=4):
    ride, value = metadata(step, stop)
    data, warnings = gps.import_gps(["# BikeCoachRide=" + json.dumps(ride), "# BikeCoachGPS=" + json.dumps(value)])
    assert not warnings
    return data


class GPSTests(unittest.TestCase):
    event = {"start_s": 1., "window_s": .52}

    def test_import_alignment_wraparound_and_identity(self):
        ride, value = metadata()
        value["sync"]["boardMs"] = 2**32 - 100
        ride["startBoardMs"] = 0
        lines = lambda: ["# BikeCoachRide=" + json.dumps(ride), "# BikeCoachGPS=" + json.dumps(value)]
        data, warnings = gps.import_gps(lines())
        self.assertFalse(warnings)
        self.assertEqual(data["points"][0]["t"], 0)
        ride["id"] = "ffffffffffffffff"
        self.assertIsNone(gps.import_gps(lines())[0])

    def test_invalid_gps_preserves_imu_and_csv_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "ride.csv"
            write_csv(path)
            path.write_text("# BikeCoachGPS={invalid}\n" + path.read_text())
            original = path.read_bytes()
            ride = load_ride(path)
            self.assertIsNone(ride.gps)
            self.assertTrue(any("GPS" in warning for warning in ride.warnings))
            self.assertEqual(len(analyze(ride, Settings())["events"]), 1)
            self.assertEqual(path.read_bytes(), original)

    def test_horizontal_speed_integral_and_sparse_quality(self):
        data = imported()
        for p in data["points"]:
            p["speed"] = 4 + 2 * p["t"]
        result = gps.estimate(data, self.event, Settings())
        self.assertEqual(result["source"], "gps_horizontal_speed_integral")
        self.assertEqual(result["quality"], "sampled")
        self.assertAlmostEqual(result["distance_m"], (6 + 7.04) / 2 * .52)
        result = gps.estimate(imported(1), self.event, Settings())
        self.assertEqual(result["quality"], "sparse")
        self.assertAlmostEqual(result["distance_m"], 8 * .52)

    def test_approach_is_explicitly_different_from_flight_speed(self):
        result = gps.estimate(imported(.5, 1), self.event, Settings())
        self.assertEqual(result["source"], "gps_approach_speed")
        self.assertEqual(result["quality"], "approach_only")
        self.assertAlmostEqual(result["distance_m"], 8 * .52)

    def test_bad_coverage_cannot_be_bridged(self):
        for change in ("segment", "speed", "accuracy", "gap"):
            with self.subTest(change=change):
                data = imported()
                for p in data["points"]:
                    if p["t"] >= 1:
                        p["segment"] = 1
                    if p["t"] == 1:
                        if change == "speed": p["speed"] = None
                        if change == "accuracy": p["accuracy"] = 100
                    if change != "segment": p["segment"] = 0
                event = {"start_s": .9, "window_s": .52}
                if change == "gap":
                    data["points"] = [p for p in data["points"] if p["t"] < .5 or p["t"] > 3]
                result = gps.estimate(data, event, Settings())
                self.assertNotEqual(result["source"], "gps_horizontal_speed_integral")

    def test_sync_override_stale_and_manual_fallback(self):
        data = imported()
        for settings in (replace(Settings(), uniform_hz=250), replace(Settings(), distance_mode="assumed")):
            self.assertEqual(gps.estimate(data, self.event, settings)["quality"], "assumed")
        data["uncertainty_s"] = .5
        self.assertEqual(gps.estimate(data, self.event, Settings())["quality"], "assumed")
        result = gps.estimate(imported(.1, .2), {"start_s": 3, "window_s": 1}, Settings())
        self.assertEqual(result["quality"], "assumed")

    def test_full_analysis_uses_gps_without_changing_jump_detection(self):
        ride = synthetic_ride()
        old = analyze(ride, Settings())
        ride.gps = imported()
        result = analyze(ride, Settings())
        event = result["events"][0]
        self.assertAlmostEqual(event["distance_m"], 8 * event["window_s"])
        self.assertEqual(event["start_s"], old["events"][0]["start_s"])
        self.assertEqual(result["gps"]["speed_fix_count"], 41)

    def test_quality_settings_are_validated(self):
        for key in ("gps_max_sync_s", "gps_max_age_s", "gps_max_gap_s", "gps_max_accuracy_m"):
            with self.assertRaises(ValueError):
                replace(Settings(), **{key: 0}).validate()
        with self.assertRaises(ValueError):
            replace(Settings(), distance_mode="unknown").validate()

    def test_malformed_points_and_order_are_ignored(self):
        for points in ([None], [{"timestamp": float("nan")}], metadata()[1]["points"][::-1]):
            ride, value = metadata()
            value["points"] = points
            data, warnings = gps.import_gps(["# BikeCoachRide=" + json.dumps(ride), "# BikeCoachGPS=" + json.dumps(value)])
            self.assertIsNone(data)
            self.assertTrue(warnings)
