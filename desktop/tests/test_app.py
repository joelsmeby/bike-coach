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

    def test_shared_height_and_web_settings_exchange(self):
        import json
        from dataclasses import asdict
        from bike_workbench.analysis import Settings
        from bike_workbench.shared_engine import call
        w = self.window
        defaults = call("metadata")
        self.assertEqual(defaults["defaults"], asdict(Settings()))
        imported = asdict(Settings(assumed_speed_mph=22, gyro_detection="off", filter="raw", core_g=.455, expand_g=.666))
        source = Path(self.directory.name) / "web-settings.json"
        source.write_text(json.dumps({"algorithm_version": defaults["version"], "settings": imported}))
        with patch("bike_workbench.app.W.QFileDialog.getOpenFileName", return_value=(str(source), "")):
            w.import_analysis_settings()
        self.assertEqual(asdict(w.settings()), imported)
        event = w.result["events"][0]
        self.assertAlmostEqual(event["height_m"], 9.80665 * event["window_s"] ** 2 / 8)
        self.assertEqual(w.event_table.item(0, 10).text(), f"{event['height_ft']:.1f}")
        self.assertIn("equal takeoff/landing elevation", w.event_table.item(0, 10).toolTip())
        destination = Path(self.directory.name) / "desktop-settings.json"
        with patch("bike_workbench.app.W.QFileDialog.getSaveFileName", return_value=(str(destination), "")):
            w.export_analysis_settings()
        exported = json.loads(destination.read_text())
        self.assertEqual(exported["settings"], imported)
        self.assertEqual(exported["algorithm_version"], defaults["version"])

    def test_collapse_table_restores_and_persists_without_losing_rows(self):
        w = self.window
        rows = w.event_table.rowCount()
        w.show()
        self.app.processEvents()
        before = w.graph_scroll.viewport().height()
        w.table_toggle.trigger()
        self.app.processEvents()
        self.assertTrue(w.tabs.isHidden())
        self.assertEqual(w.table_toggle.text(), "Show jump table")
        self.assertFalse(w.load_plot.isHidden())
        self.assertFalse(w.gyro_plot.isHidden())
        self.assertFalse(w.vibration_plot.isHidden())
        self.assertGreater(w.graph_scroll.viewport().height(), before)
        self.assertEqual(w.graph_scroll.verticalScrollBar().maximum(), 0)
        path = Path(self.directory.name) / "collapsed.json"
        self.assertTrue(w.write_session(path))
        w.set_table_collapsed(False)
        w.dirty = False
        w.open_session(path=path)
        self.assertTrue(w.tabs.isHidden())
        self.assertTrue(w.table_toggle.isChecked())
        w.table_toggle.trigger()
        self.assertFalse(w.tabs.isHidden())
        self.assertEqual(w.event_table.rowCount(), rows)
        self.assertEqual(w.table_toggle.text(), "Hide jump table")

    def test_gyro_motion_input_changes_detection_and_survives_save(self):
        from test_gyro import GyroTests
        from bike_workbench.analysis import Settings, analyze
        w = self.window
        r = GyroTests().split_flight()
        w.install_ride(r, Settings(merge_gap_s=.1), analyze(r, Settings(merge_gap_s=.1)))
        self.assertTrue(w.recalculate())
        self.assertEqual(w.event_table.rowCount(), 1)
        self.assertIn("gyro joined", w.event_table.item(0, 7).text())
        w.controls["gyro_detection"].setCurrentIndex(w.controls["gyro_detection"].findData("off"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        self.assertEqual(w.event_table.rowCount(), 2)
        w.dirty = False
        w.open_csv(path=self.csv)
        w.controls["gyro_detection"].setCurrentIndex(w.controls["gyro_detection"].findData("off"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        path = Path(self.directory.name) / "motion.json"
        self.assertTrue(w.write_session(path))
        self.assertEqual(read_session(path)[2].gyro_detection, "off")

    def test_jump_detail_centers_and_fits_selection_then_locks_zoom(self):
        import numpy as np
        from test_gyro import ride
        from bike_workbench.analysis import Settings, analyze
        w = self.window
        r = ride()
        w.install_ride(r, Settings(), analyze(r, Settings()))
        self.assertTrue(w.recalculate())
        w.event_table.selectRow(0)
        w.fit_jump_detail()
        mask = (r.time >= 1) & (r.time <= 1.5)
        bounds = tuple(w.gyro_plot.viewRange()[1])
        self.assertLess(bounds[1] - bounds[0], 100)
        self.assertLessEqual(bounds[0], r.gyro[mask].min())
        self.assertGreaterEqual(bounds[1], r.gyro[mask].max())
        self.assertLess(w.vibration_plot.viewRange()[1][1], 15)
        w.load_plot.setXRange(.5, 2.5, padding=0)
        self.assertEqual(tuple(w.gyro_plot.viewRange()[1]), bounds)
        w.chart_controls["gyro_half_span_dps"].setValue(80)
        self.assertFalse(w.auto_fit_jump.isChecked())

    def test_tall_charts_scroll_and_gyro_focus_preserves_session(self):
        w = self.window
        w.show()
        self.app.processEvents()
        self.assertGreaterEqual(w.gyro_plot.height(), 300)
        self.assertGreaterEqual(w.vibration_plot.height(), 280)
        self.assertGreater(w.graph_scroll.verticalScrollBar().maximum(), 0)
        w.load_plot.setXRange(1, 1.6, padding=0)
        w.gyro_focus.setChecked(True)
        self.app.processEvents()
        self.assertAlmostEqual(w.time_view()[0], 1)
        self.assertAlmostEqual(w.time_view()[1], 1.6)
        self.assertTrue(w.load_plot.isHidden())
        self.assertFalse(w.gyro_plot.isHidden())
        w.chart_controls["gyro_center_dps"].setValue(25)
        path = Path(self.directory.name) / "gyro-focus.json"
        self.assertTrue(w.write_session(path))
        w.gyro_focus.setChecked(False)
        w.dirty = False
        w.open_session(path=path)
        self.assertTrue(w.gyro_focus.isChecked())
        self.assertEqual(w.chart_controls["gyro_center_dps"].value(), 25)
        w.gyro_focus.setChecked(False)
        self.assertFalse(w.load_plot.isHidden())

    def test_separate_vibration_plot_and_fixed_gyro_scales_survive_navigation(self):
        w = self.window
        self.assertIsNot(w.vibration_curve.getViewBox(), w.gyro_plot.getViewBox())
        self.assertIs(w.vibration_curve.getViewBox(), w.vibration_plot.getViewBox())
        w.chart_controls["gyro_half_span_dps"].setValue(75)
        w.chart_controls["vibration_max_dps"].setValue(30)
        for plot, bounds in ((w.gyro_plot, (-75, 75)), (w.vibration_plot, (0, 30))):
            self.assertEqual(tuple(plot.viewRange()[1]), bounds)
        w.load_plot.setXRange(1.1, 1.3, padding=0)
        w.vibration_plot.getViewBox().scaleBy((.5, .1))
        w.gyro_plot.getViewBox().translateBy(y=500)
        w.controls["filter"].setCurrentIndex(w.controls["filter"].findData("mean"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        w.full_ride()
        self.app.processEvents()
        self.assertEqual(tuple(w.gyro_plot.viewRange()[1]), (-75, 75))
        self.assertEqual(tuple(w.vibration_plot.viewRange()[1]), (0, 30))
        self.assertFalse(w.vibration_plot.getViewBox().autoRangeEnabled()[1])

    def test_chart_scales_save_reload_and_invalid_values_default(self):
        w = self.window
        w.chart_controls["gyro_half_span_dps"].setValue(85)
        w.chart_controls["vibration_max_dps"].setValue(40)
        path = Path(self.directory.name) / "scales.json"
        self.assertTrue(w.write_session(path))
        w.apply_chart_scales({})
        self.assertEqual(w.chart_controls["gyro_half_span_dps"].value(), 100)
        w.dirty = False
        w.open_session(path=path)
        self.assertEqual(w.chart_controls["gyro_half_span_dps"].value(), 85)
        self.assertEqual(w.chart_controls["vibration_max_dps"].value(), 40)
        w.apply_chart_scales({"gyro_half_span_dps": float("nan"), "vibration_max_dps": -10})
        self.assertEqual(w.chart_controls["gyro_half_span_dps"].value(), 100)
        self.assertEqual(w.chart_controls["vibration_max_dps"].value(), 50)

    def test_fit_gyro_once_uses_visible_data_and_then_stays_locked(self):
        import numpy as np
        from test_gyro import ride
        from bike_workbench.analysis import Settings, analyze
        w = self.window
        r = ride()
        r.gyro[10, 0] = 400  # Outside the jump's visible interval.
        w.install_ride(r, Settings(gyro_range_dps=2000), analyze(r, Settings(gyro_range_dps=2000)))
        self.assertTrue(w.recalculate())
        w.load_plot.setXRange(1.1, 1.4, padding=0)
        w.fit_gyro_scales(True)
        visible_span = w.chart_controls["gyro_half_span_dps"].value()
        self.assertLess(visible_span, 100)
        vibration_span = w.chart_controls["vibration_max_dps"].value()
        w.full_ride()
        self.assertEqual(w.chart_controls["gyro_half_span_dps"].value(), visible_span)
        self.assertEqual(w.chart_controls["vibration_max_dps"].value(), vibration_span)
        w.fit_gyro_scales(False)
        self.assertGreater(w.chart_controls["gyro_half_span_dps"].value(), 400)
        finite = w.result["gyro_vibration"]
        self.assertGreater(w.chart_controls["vibration_max_dps"].value(), np.nanmax(finite))

    def test_gyro_support_curve_controls_and_save_reload(self):
        import numpy as np
        from test_gyro import ride
        from bike_workbench.analysis import Settings, analyze
        w = self.window
        r = ride()
        w.install_ride(r, Settings(), analyze(r, Settings()))
        self.assertTrue(w.recalculate())
        self.assertIn("supports", w.event_table.item(0, 9).text())
        self.assertIn("not a jump probability", w.event_table.item(0, 9).toolTip())
        _, y = w.vibration_curve.getData()
        self.assertTrue(np.isfinite(y).any())
        w.controls["gyro_evidence"].setCurrentIndex(w.controls["gyro_evidence"].findData("off"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        self.assertIn("off", w.event_table.item(0, 9).text())
        _, y = w.vibration_curve.getData()
        self.assertFalse(np.isfinite(y).any())
        # Save with an actual source CSV so the session can be reopened.
        w.dirty = False
        w.open_csv(path=self.csv)
        w.controls["gyro_channel"].setCurrentIndex(w.controls["gyro_channel"].findData("pitch"))
        w.timer.stop()
        self.assertTrue(w.recalculate())
        path = Path(self.directory.name) / "gyro.json"
        self.assertTrue(w.write_session(path))
        saved, _, settings, result = read_session(path)
        self.assertEqual(settings.gyro_channel, "pitch")
        self.assertEqual(saved["events"][0]["gyro_evidence"]["channel"], "pitch unavailable")
        self.assertIsNone(result["events"][0]["gyro_evidence"]["support_score"])

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
