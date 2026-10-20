import csv
import json
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from bike_workbench.analysis import Settings, Ride, analyze, evaluate, filter_load, load_ride
from bike_workbench.session import atomic_json, make_session, read_session


def synthetic_ride():
    t = np.arange(201) / 50
    a = np.zeros((len(t), 3))
    a[:, 2] = 1
    a[(t >= 1) & (t <= 1.5), 2] = .1
    a[np.isclose(t, 1.52), 2] = 2.5
    return Ride(Path("synthetic.csv"), "synthetic", t, a, np.zeros_like(a))


def write_csv(path, count=201, hz=50, rounded=False, invalid=False):
    first = datetime(2000, 1, 1, 12)
    with Path(path).open("w", newline="") as f:
        f.write('# BikeCoachCalibration={"forward":[1,0,0]}\n')
        writer = csv.writer(f)
        writer.writerow(["rtcDate", "rtcTime", "aX", "aY", "aZ", "gX", "gY", "gZ", "output_Hz", ""])
        for i in range(count):
            stamp = first + timedelta(seconds=i / hz)
            time = stamp.strftime("%H:%M:%S.%f")
            if rounded:
                time = time[:-4]
            z = 100 if 1 <= i / hz <= 1.5 else (2500 if i == 76 else 1000)
            writer.writerow([stamp.strftime("%m/%d/%Y"), time, 0, 0, "nan" if invalid and i == 2 else z, 0, 0, 0, hz, ""])


class DetectionTests(unittest.TestCase):
    def test_jump_with_impact(self):
        result = analyze(synthetic_ride(), Settings())
        self.assertEqual(len(result["events"]), 1)
        event = result["events"][0]
        self.assertAlmostEqual(event["start_s"], 1)
        self.assertAlmostEqual(event["end_s"], 1.5)
        self.assertAlmostEqual(event["impact_s"], 1.52)
        self.assertTrue(event["clipped"])

    def test_low_load_without_impact_is_only_threshold_candidate(self):
        ride = synthetic_ride()
        ride.accel[76, 2] = 1
        self.assertEqual(analyze(ride, Settings())["events"], [])
        self.assertEqual(len(analyze(ride, Settings(mode="threshold"))["events"]), 1)

    def test_median_repairs_isolated_spike(self):
        ride = synthetic_ride()
        ride.accel[62, 2] = 1.4
        clean = analyze(ride, Settings())
        self.assertEqual(len(clean["events"]), 1)
        self.assertAlmostEqual(clean["events"][0]["start_s"], 1)
        self.assertGreater(clean["raw"][62], 1)
        self.assertLess(clean["filtered"][62], .4)

    def test_gap_never_connects_a_flight_or_impact(self):
        ride = synthetic_ride()
        ride.time[63:] += 1
        self.assertEqual(analyze(ride, Settings())["gap_count"], 1)
        self.assertEqual(analyze(ride, Settings())["events"], [])

    def test_sensor_ranges_change_flags_not_detections(self):
        old = analyze(synthetic_ride(), Settings())
        new = analyze(synthetic_ride(), Settings(accel_range_g=16))
        self.assertTrue(old["events"][0]["clipped"])
        self.assertFalse(new["events"][0]["clipped"])
        self.assertEqual(old["events"][0]["start_s"], new["events"][0]["start_s"])

    def test_assumed_speed_distance_units_and_detection_independence(self):
        ride = synthetic_ride()
        event = analyze(ride, Settings())["events"][0]
        self.assertAlmostEqual(event["window_s"], .52)
        self.assertAlmostEqual(event["distance_ft"], 13.728)
        self.assertAlmostEqual(event["distance_m"], 4.1842944)
        faster = analyze(ride, Settings(assumed_speed_mph=36))["events"][0]
        self.assertAlmostEqual(faster["distance_ft"], event["distance_ft"] * 2)
        self.assertEqual(faster["cores"], event["cores"])
        stopped = analyze(ride, Settings(assumed_speed_mph=0))["events"][0]
        self.assertEqual(stopped["distance_ft"], 0)
        self.assertEqual(event["distance_source"], "assumed_constant_speed_x_candidate_window")
        for speed in [-1, float("nan"), float("inf")]:
            with self.assertRaises(ValueError):
                analyze(ride, Settings(assumed_speed_mph=speed))

    def test_boundaries_and_stationary_are_not_jumps(self):
        ride = synthetic_ride()
        ride.accel[:, 2] = 1
        self.assertEqual(analyze(ride, Settings())["events"], [])
        ride.accel[:30, 2] = .1
        ride.accel[30, 2] = 3
        self.assertEqual(analyze(ride, Settings())["events"], [])

    def test_butterworth_suppresses_chatter_and_has_no_phase_delay(self):
        t = np.arange(1001) / 250
        slow = np.sin(2 * np.pi * t)
        raw = 1 + .15 * slow + .1 * np.sin(2 * np.pi * 60 * t)
        filtered, _ = filter_load(t, raw, Settings(filter="butterworth", cutoff_hz=5))
        interior = slice(100, -100)
        self.assertLess(np.std((filtered - 1 - .15 * slow)[interior]), .005)
        self.assertEqual(np.argmax(np.correlate((filtered - 1)[interior], slow[interior], "full")) - len(slow[interior]) + 1, 0)

    def test_invalid_filter_settings_fail(self):
        for settings in [Settings(window_samples=4), Settings(core_g=.8, expand_g=.6), Settings(cutoff_hz=float("nan"))]:
            with self.assertRaises(ValueError):
                analyze(synthetic_ride(), settings)
        with self.assertRaises(ValueError):
            analyze(synthetic_ride(), Settings(filter="butterworth", cutoff_hz=30))

    def test_labels_are_matched_one_to_one(self):
        events = [{"start_s": 1, "end_s": 2}, {"start_s": 1.1, "end_s": 2.1}]
        labels = [{"kind": "jump", "start_s": 1, "end_s": 2}]
        score = evaluate(events, labels)
        self.assertEqual(score["matched_jumps"], 1)
        self.assertEqual(score["unmatched_candidates"], 1)


class RecordingTests(unittest.TestCase):
    def test_old_session_defaults_to_18mph(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "ride.csv"
            write_csv(csv_path)
            ride = load_ride(csv_path)
            session_path = Path(directory) / "old.json"
            settings = Settings()
            data = make_session(ride, settings, analyze(ride, settings), [], [], [0, 4], "", session_path)
            del data["settings"]["assumed_speed_mph"]
            atomic_json(session_path, data)
            _, _, restored, result = read_session(session_path)
            self.assertEqual(restored.assumed_speed_mph, 18)
            self.assertAlmostEqual(result["events"][0]["distance_ft"], 13.728)

    def test_quantized_250hz_preserves_samples_and_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "quantized.csv"
            write_csv(path, count=1001, hz=250, rounded=True)
            ride = load_ride(path)
            result = analyze(ride, Settings())
            self.assertEqual(len(ride.time), 1001)
            self.assertTrue(np.all(np.diff(ride.time) > 0))
            self.assertGreater(ride.repeated_timestamps, 500)
            self.assertAlmostEqual(result["sample_hz"], 250, delta=1)
            self.assertEqual(result["gap_count"], 0)
            self.assertTrue(any("interpolated" in w for w in ride.warnings))

    def test_nonfinite_record_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.csv"
            write_csv(path, invalid=True)
            with self.assertRaisesRegex(ValueError, "Invalid sensor record"):
                load_ride(path)

    def test_midnight_with_date_rollover(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "midnight.csv"
            write_csv(path)
            text = path.read_text().replace("01/01/2000,12:00:00.", "01/01/2000,23:59:59.")
            text = text.replace("01/01/2000,12:00:01.", "01/02/2000,00:00:00.")
            text = text.replace("01/01/2000,12:00:02.", "01/02/2000,00:00:01.")
            text = text.replace("01/01/2000,12:00:03.", "01/02/2000,00:00:02.")
            text = text.replace("01/01/2000,12:00:04.", "01/02/2000,00:00:03.")
            path.write_text(text)
            self.assertAlmostEqual(load_ride(path).time[-1], 4)

    def test_saved_session_recomputes_and_checks_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "ride.csv"
            write_csv(csv_path)
            session_path = Path(directory) / "run.json"
            ride = load_ride(csv_path)
            settings = Settings()
            result = analyze(ride, settings)
            labels = [{"id": "fixed-label", "kind": "jump", "start_s": 1., "end_s": 1.5, "note": "video"}]
            atomic_json(session_path, make_session(ride, settings, result, labels, [], [0, 4], "notes", session_path))
            saved, restored, _, rerun = read_session(session_path)
            self.assertEqual(saved["labels"], labels)
            self.assertEqual(rerun["events"], result["events"])
            self.assertEqual(restored.sha256, ride.sha256)
            csv_path.write_text(csv_path.read_text().replace(",2500,", ",3000,"))
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                read_session(session_path)

    def test_relocated_recording(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.csv"
            write_csv(path)
            ride = load_ride(path)
            target = Path(directory) / "run.json"
            atomic_json(target, make_session(ride, Settings(), analyze(ride, Settings()), [], [], [0, 4], "", target))
            moved = path.rename(Path(directory) / "moved.csv")
            with self.assertRaises(FileNotFoundError):
                read_session(target)
            self.assertEqual(read_session(target, moved)[1].sha256, ride.sha256)


if __name__ == "__main__":
    unittest.main()
