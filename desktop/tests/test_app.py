import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PySide6.QtWidgets import QApplication

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
        self.window = Workbench()
        self.window.open_csv(path=self.csv)

    def tearDown(self):
        self.window.timer.stop()
        self.window.autosave_timer.stop()
        self.window.dirty = False
        self.window.close()
        self.window.deleteLater()
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
