import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QSettings

from bike_workbench.app import Workbench
from bike_workbench.session import read_session
from test_analysis import write_csv


class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.csv = Path(self.directory.name) / "ride.csv"
        write_csv(self.csv)
        preferences = QSettings(str(Path(self.directory.name) / "preferences.ini"), QSettings.IniFormat)
        self.preferences_patch = patch("bike_workbench.app.QtCore.QSettings", return_value=preferences)
        self.preferences_patch.start()
        self.window = Workbench(catalog_path=Path(self.directory.name) / "catalog.json")
        self.window.open_csv(path=self.csv)

    def tearDown(self):
        self.window.timer.stop()
        self.window.autosave_timer.stop()
        self.window.dirty = False
        self.window.close()
        self.window.deleteLater()
        self.preferences_patch.stop()
        self.directory.cleanup()

    def test_select_label_compare_save_reload(self):
        w = self.window
        self.assertEqual(w.event_table.rowCount(), 1)
        w.event_table.selectRow(0)
        self.assertAlmostEqual(w.selection.getRegion()[0], 1)
        w.label_note.setText("Known test jump")
        w.add_label("jump")
        with patch("bike_workbench.app.W.QInputDialog.getText", return_value=("Initial median", True)):
            w.capture_baseline()
        self.assertEqual(len(w.labels), 1)
        self.assertEqual(len(w.snapshots), 1)
        w.controls["filter"].setCurrentIndex(w.controls["filter"].findData("butterworth"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        self.assertEqual(w.labels[0]["start_s"], 1)
        path = Path(self.directory.name) / "run.json"
        self.assertTrue(w.write_session(path))
        saved, _, _, result = read_session(path)
        self.assertEqual(saved["labels"][0]["note"], "Known test jump")
        self.assertEqual(saved["settings"]["filter"], "butterworth")
        w.open_session(path=path)
        self.assertEqual(len(w.labels), 1)
        self.assertEqual(len(w.snapshots), 1)
        self.assertIsNotNone(w.baseline)
        self.assertFalse(w.dirty)

    def test_distance_column_updates_and_speed_survives_save(self):
        w = self.window
        self.assertEqual(w.event_table.horizontalHeaderItem(4).text(), "Est. ft*")
        self.assertEqual(w.event_table.item(0, 4).text(), "13.7")
        w.controls["assumed_speed_mph"].setValue(36)
        w.timer.stop()
        self.assertTrue(w.recalculate())
        self.assertEqual(w.event_table.item(0, 4).text(), "27.5")
        self.assertIn("36 mph", w.event_table.item(0, 4).toolTip())
        path = Path(self.directory.name) / "speed.json"
        self.assertTrue(w.write_session(path))
        _, _, settings, result = read_session(path)
        self.assertEqual(settings.assumed_speed_mph, 36)
        self.assertAlmostEqual(result["events"][0]["distance_ft"], 27.456)

    def test_gps_file_distance_source_and_saved_evidence(self):
        import json
        from test_gps import metadata
        ride, gps = metadata()
        self.csv.write_text("# BikeCoachRide=" + json.dumps(ride) + "\n# BikeCoachGPS=" + json.dumps(gps) + "\n" + self.csv.read_text())
        w = self.window
        w.dirty = False
        w.open_csv(path=self.csv)
        self.assertIn("GPS", w.event_table.item(0, 8).text())
        self.assertAlmostEqual(float(w.event_table.item(0, 4).text()), 13.6)
        self.assertIn("Mean horizontal speed", w.event_table.item(0, 4).toolTip())
        path = Path(self.directory.name) / "gps-session.json"
        self.assertTrue(w.write_session(path))
        saved, _, _, result = read_session(path)
        self.assertEqual(saved["gps"]["speed_fix_count"], 41)
        self.assertEqual(result["events"][0]["distance_source"], "gps_horizontal_speed_integral")
        self.assertEqual(saved["events"][0]["distance_evidence"]["quality"], "sampled")

    def test_catalog_unknown_angles_persistence_and_separate_measurements(self):
        w = self.window
        w.event_table.selectRow(0)
        c = w.catalog
        c.trail.setText("Sea Donkey")
        c.jump.setText("Jump 1")
        self.assertTrue(c.save())
        entry = c.entries[0]
        self.assertIsNone(entry["ramp_angle_deg"])
        self.assertIsNone(entry["bike_pitch_deg"])
        self.assertEqual(entry["observation"]["recording_sha256"], w.ride.sha256)
        known, angle = c.angles["bike_pitch_deg"]
        known.setChecked(True)
        angle.setValue(25)
        self.assertFalse(c.save())  # Measurement provenance required.
        c.notes.setText("Manual video estimate of bike pitch, uncalibrated")
        self.assertTrue(c.save())
        self.assertIsNone(c.entries[0]["trajectory_angle_deg"])
        self.assertIsNone(c.entries[0]["ramp_angle_deg"])
        self.assertEqual(c.entries[0]["bike_pitch_deg"], 25)
        from bike_workbench.catalog import Catalog
        reopened = Catalog(w, c.path)
        self.assertEqual(reopened.entries, c.entries)
        path = Path(self.directory.name) / "catalog-session.json"
        self.assertTrue(w.write_session(path))
        saved = read_session(path)[0]
        self.assertEqual(saved["catalog_entries"], c.entries)
        self.assertEqual(saved["gps"]["available"], False)
        reopened.deleteLater()

    def test_catalog_corruption_does_not_overwrite_file(self):
        from bike_workbench.catalog import Catalog
        path = Path(self.directory.name) / "bad-catalog.json"
        path.write_text("broken")
        catalog = Catalog(self.window, path)
        self.assertFalse(catalog.save())
        self.assertEqual(path.read_text(), "broken")
        catalog.deleteLater()

    def test_invalid_settings_cannot_autosave_stale_results(self):
        w = self.window
        w.controls["core_g"].setValue(.8)
        w.timer.stop()
        self.assertFalse(w.recalculate())
        self.assertFalse(w.write_session(Path(self.directory.name) / "invalid.json"))
        self.assertFalse((Path(self.directory.name) / "invalid.json").exists())

    def test_timing_change_cannot_move_existing_labels(self):
        w = self.window
        w.event_table.selectRow(0)
        w.add_label("jump")
        w.controls["uniform_hz"].setValue(250)
        w.timer.stop()
        self.assertFalse(w.recalculate())
        self.assertEqual(w.labels[0]["start_s"], 1)

    def test_autosave_persists_label_and_removal(self):
        w = self.window
        path = Path(self.directory.name) / "autosave.json"
        self.assertTrue(w.write_session(path))
        w.event_table.selectRow(0)
        w.add_label("not_jump")
        w.autosave()
        self.assertEqual(read_session(path)[0]["labels"][0]["kind"], "not_jump")
        w.label_table.selectRow(0)
        w.remove_label()
        w.autosave()
        self.assertEqual(read_session(path)[0]["labels"], [])

    def test_full_ride_restores_hidden_curves_and_fixed_y_range(self):
        w = self.window
        w.raw_curve.hide()
        w.clean_curve.hide()
        w.load_plot.setYRange(20, 30)
        w.full_ride()
        self.assertTrue(w.raw_curve.isVisible())
        self.assertTrue(w.clean_curve.isVisible())
        self.assertFalse(w.load_plot.getViewBox().autoRangeEnabled()[1])
        self.assertAlmostEqual(w.load_plot.viewRange()[1][0], 0)
        self.assertGreater(w.load_plot.viewRange()[1][1], 2.5)

    def test_vertical_ranges_survive_zoom_pan_filter_and_legend_changes(self):
        w = self.window
        plots = [w.load_plot, w.gyro_plot, w.overview]
        initial = [tuple(plot.viewRange()[1]) for plot in plots]
        w.load_plot.setXRange(1.1, 1.2, padding=0)
        w.load_plot.getViewBox().scaleBy((.5, .2))
        w.load_plot.getViewBox().translateBy(y=10)
        w.raw_curve.hide()
        w.controls["filter"].setCurrentIndex(w.controls["filter"].findData("mean"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        self.app.processEvents()
        for plot, expected in zip(plots, initial):
            self.assertAlmostEqual(plot.viewRange()[1][0], expected[0])
            self.assertAlmostEqual(plot.viewRange()[1][1], expected[1])
        w.full_ride()
        for plot, expected in zip(plots, initial):
            self.assertAlmostEqual(plot.viewRange()[1][0], expected[0])
            self.assertAlmostEqual(plot.viewRange()[1][1], expected[1])


if __name__ == "__main__":
    unittest.main()
