"""Native Qt workbench. Session JSON is the collaboration boundary."""
from __future__ import annotations

import json
import sys
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyqtgraph as pg
from PySide6 import QtCore, QtGui, QtWidgets as W

from . import __version__
from .catalog import Catalog
from .analysis import Settings, analyze, evaluate, load_ride, ALGORITHM_VERSION, algorithm_fingerprint
from .session import atomic_json, make_session, read_session

COLORS = {"raw": "#69798d", "clean": "#70d5d0", "baseline": "#d4a4ff", "clip": "#f28c77",
          "x": "#70d5d0", "y": "#edb86e", "z": "#bd9bea"}


class Workbench(W.QMainWindow):
    def __init__(self, catalog_path=None):
        super().__init__()
        self.ride = self.result = self.session_path = None
        self.labels, self.snapshots = [], []
        self.baseline = None
        self.result_settings = None
        self.dirty = False
        self.updating = False
        self._syncing = False
        self._marks = []
        self.preferences = QtCore.QSettings("BikeCoach", "JumpWorkbench")
        self.setWindowTitle("Bike Coach · Jump Workbench")
        self.resize(1440, 980)
        self.setMinimumSize(1040, 760)
        self.timer = QtCore.QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(180)
        self.timer.timeout.connect(self.recalculate)
        self.autosave_timer = QtCore.QTimer(self)
        self.autosave_timer.setSingleShot(True)
        self.autosave_timer.setInterval(1000)
        self.autosave_timer.timeout.connect(self.autosave)
        self.catalog_path = catalog_path or Path(__file__).resolve().parents[1] / "sessions" / "jump-catalog.json"
        self.build_ui()
        self.setStyleSheet("""
            QMainWindow, QWidget { background:#141b25; color:#e5edf5; font-size:13px; }
            QToolBar { background:#1b2533; spacing:8px; padding:9px; border:0; }
            QToolButton { padding:7px 11px; border-radius:5px; }
            QToolButton:hover, QPushButton:hover { background:#344559; }
            QPushButton { background:#28384a; padding:7px 9px; border:1px solid #3c5064; border-radius:5px; }
            QComboBox, QDoubleSpinBox, QSpinBox, QLineEdit, QPlainTextEdit { background:#202d3c; padding:5px; border:1px solid #3c5064; border-radius:4px; }
            QGroupBox { border:1px solid #334456; border-radius:6px; margin-top:12px; padding-top:13px; font-weight:500; }
            QGroupBox::title { subcontrol-origin:margin; left:10px; padding:0 4px; }
            QHeaderView::section { background:#253346; padding:6px; border:0; color:#cfdae7; }
            QTableWidget { background:#182330; alternate-background-color:#1e2b3a; gridline-color:#2c3d50; selection-background-color:#345869; }
            QTabBar::tab { background:#202c3b; padding:8px 14px; }
            QTabBar::tab:selected { background:#34475a; }
            QStatusBar { background:#1b2533; }
            QScrollArea { border:0; }
            QSplitter::handle { background:#283647; }
        """)
        self.statusBar().showMessage("Open a Bike Coach CSV to begin. All analysis stays on this Mac.")

    def build_ui(self):
        toolbar = self.addToolBar("Session")
        toolbar.setMovable(False)
        self.actions = {}
        for name, text, shortcut, callback in [
            ("open", "Open recording…", "Ctrl+O", self.open_csv),
            ("session", "Open session…", "Ctrl+Shift+O", self.open_session),
            ("save", "Save session", "Ctrl+S", self.save),
            ("save_as", "Save as…", "Ctrl+Shift+S", lambda: self.save(True)),
            ("baseline", "Save comparison run", "", self.capture_baseline),
            ("report", "Export review…", "", self.export_report),
            ("fit", "Full ride", "Ctrl+0", self.full_ride),
        ]:
            action = toolbar.addAction(text)
            action.triggered.connect(callback)
            if shortcut:
                action.setShortcut(shortcut)
            self.actions[name] = action
        toolbar.addSeparator()
        help_action = toolbar.addAction("How to use")
        help_action.triggered.connect(self.show_help)
        central = W.QWidget()
        layout = W.QVBoxLayout(central)
        layout.setContentsMargins(14, 10, 14, 8)
        header = W.QHBoxLayout()
        title = W.QLabel("JUMP WORKBENCH")
        title.setStyleSheet("font-size:18px;font-weight:500;color:#70d5d0;")
        header.addWidget(title)
        self.file_label = W.QLabel("No recording loaded")
        self.file_label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        header.addWidget(self.file_label, 1)
        self.count_label = W.QLabel("Offline · v" + __version__)
        header.addWidget(self.count_label)
        layout.addLayout(header)
        self.notice = W.QLabel("Candidate windows describe unloading, not verified wheel contact or airtime.")
        self.notice.setWordWrap(True)
        self.notice.setStyleSheet("color:#b7c5d5;padding:3px 0;")
        layout.addWidget(self.notice)
        split = W.QSplitter(QtCore.Qt.Horizontal)
        layout.addWidget(split, 1)
        scroll = W.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setMinimumWidth(340)
        scroll.setMaximumWidth(440)
        scroll.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAlwaysOff)
        panel = W.QWidget()
        controls_layout = W.QVBoxLayout(panel)
        controls_layout.setContentsMargins(0, 0, 12, 0)
        self.controls = {}

        def group(title):
            box = W.QGroupBox(title)
            form = W.QFormLayout(box)
            form.setFieldGrowthPolicy(W.QFormLayout.AllNonFixedFieldsGrow)
            form.setRowWrapPolicy(W.QFormLayout.WrapLongRows)
            controls_layout.addWidget(box)
            return form

        def combo(form, key, title, entries):
            widget = W.QComboBox()
            widget.setSizeAdjustPolicy(W.QComboBox.AdjustToMinimumContentsLengthWithIcon)
            widget.setMinimumContentsLength(12)
            for text, value in entries:
                widget.addItem(text, value)
            form.addRow(title, widget)
            widget.currentIndexChanged.connect(self.settings_changed)
            self.controls[key] = widget

        def spin(form, key, title, low, high, step, decimals=2):
            widget = W.QSpinBox() if decimals == 0 else W.QDoubleSpinBox()
            widget.setRange(low, high)
            widget.setSingleStep(step)
            if decimals:
                widget.setDecimals(decimals)
            form.addRow(title, widget)
            widget.valueChanged.connect(self.settings_changed)
            self.controls[key] = widget

        f = group("Filter load magnitude")
        combo(f, "filter", "Method", [("Median (centered)", "median"), ("Moving average (centered)", "mean"),
                                      ("Butterworth (offline)", "butterworth"), ("Raw / no filter", "raw")])
        spin(f, "window_samples", "Window · samples", 1, 501, 2, 0)
        spin(f, "cutoff_hz", "Cutoff · Hz", .1, 120, .5)
        self.filter_note = W.QLabel()
        self.filter_note.setWordWrap(True)
        self.filter_note.setMinimumWidth(0)
        self.filter_note.setSizePolicy(W.QSizePolicy.Ignored, W.QSizePolicy.Preferred)
        f.addRow(self.filter_note)
        f = group("Jump candidates")
        combo(f, "mode", "Detector", [("Low load + impact", "sequence"), ("Low load only", "threshold")])
        for args in [
            ("core_g", "Core below · g", .05, 1.0, .05),
            ("expand_g", "Expand below · g", .05, 1.5, .05),
            ("min_core_s", "Min. core · s", .02, 2., .02),
            ("max_window_s", "Max. window · s", .05, 10., .1),
            ("impact_g", "Impact above · g", .1, 30., .1),
            ("impact_search_s", "Impact search · s", .02, 2., .02),
            ("merge_gap_s", "Join gaps up to · s", 0., 1., .02),
            ("landing_hold_s", "Landing hold · s", .02, .5, .02),
        ]:
            spin(f, *args)
        f = group("Distance estimate")
        combo(f, "distance_mode", "Speed source", [("GPS when usable", "auto"), ("Assumed horizontal speed", "assumed")])
        spin(f, "gps_max_sync_s", "Max clock uncertainty · s", .01, 2., .05)
        spin(f, "gps_max_gap_s", "Max GPS gap · s", .05, 5., .1)
        spin(f, "gps_max_age_s", "Max boundary age · s", .05, 5., .1)
        spin(f, "gps_max_accuracy_m", "Max position uncertainty · m", 1., 100., 1.)
        spin(f, "assumed_speed_mph", "Assumed speed · mph", 0., 100., .5, 1)
        distance_note = W.QLabel("GPS horizontal speed is integrated over the candidate window when usable. Otherwise use recent approach speed, then the assumed horizontal speed. Position accuracy does not measure speed accuracy. No angle correction is needed for horizontal speed.")
        distance_note.setWordWrap(True)
        distance_note.setMinimumWidth(0)
        distance_note.setSizePolicy(W.QSizePolicy.Ignored, W.QSizePolicy.Preferred)
        f.addRow(distance_note)
        f = group("Recording assumptions")
        spin(f, "accel_range_g", "Accel range · ±g", 1., 32., 1.)
        spin(f, "gyro_range_dps", "Gyro range · ±°/s", 125., 4000., 125., 0)
        spin(f, "gap_s", "Split gaps over · s", .02, 2., .02)
        spin(f, "uniform_hz", "Override rate · Hz", 0., 2000., 1.)
        timing_note = W.QLabel("Rate 0 uses RTC timestamps. Override assumes uniform sampling and ignores RTC gaps. Ranges only control clipping markers.")
        timing_note.setWordWrap(True)
        timing_note.setMinimumWidth(0)
        timing_note.setSizePolicy(W.QSizePolicy.Ignored, W.QSizePolicy.Preferred)
        f.addRow(timing_note)
        f = group("Compare runs")
        self.baseline_combo = W.QComboBox()
        self.baseline_combo.addItem("No comparison run", None)
        self.baseline_combo.currentIndexChanged.connect(self.select_baseline)
        f.addRow(self.baseline_combo)
        self.compare_label = W.QLabel("Save a comparison run before changing settings.")
        self.compare_label.setWordWrap(True)
        f.addRow(self.compare_label)
        self.restore_button = W.QPushButton("Restore comparison settings")
        self.restore_button.clicked.connect(self.restore_baseline)
        f.addRow(self.restore_button)
        controls_layout.addStretch()
        scroll.setWidget(panel)
        split.addWidget(scroll)
        right = W.QSplitter(QtCore.Qt.Vertical)
        split.addWidget(right)
        graphs = W.QWidget()
        gl = W.QVBoxLayout(graphs)
        gl.setContentsMargins(4, 0, 0, 0)
        self.overview = self.new_plot("Full ride · drag selection to zoom", "Load", "g")
        self.overview.setMaximumHeight(135)
        self.load_plot = self.new_plot("Raw / filtered load · drag orange handles to label an interval", "Load", "g")
        self.gyro_plot = self.new_plot("Angular velocity · device axes", "Rate", "°/s")
        for plot, stretch in [(self.overview, 1), (self.load_plot, 3), (self.gyro_plot, 2)]:
            gl.addWidget(plot, stretch)
        self.gyro_plot.setXLink(self.load_plot)
        self.load_plot.addLegend(offset=(8, 8))
        self.gyro_plot.addLegend(offset=(8, 8))
        self.raw_curve = self.load_plot.plot(pen=pg.mkPen(COLORS["raw"], width=1), name="Raw")
        self.clean_curve = self.load_plot.plot(pen=pg.mkPen(COLORS["clean"], width=2), name="Filtered")
        self.baseline_curve = self.load_plot.plot(pen=pg.mkPen(COLORS["baseline"], width=1.5, style=QtCore.Qt.DashLine), name="Comparison")
        self.gyro_curves = [self.gyro_plot.plot(pen=pg.mkPen(COLORS[k], width=1), name=k.upper()) for k in ("x", "y", "z")]
        self.overview_curve = self.overview.plot(pen=pg.mkPen(COLORS["raw"], width=1))
        self.clip_marks = pg.ScatterPlotItem(symbol="x", size=7, pen=pg.mkPen(COLORS["clip"]))
        self.impact_marks = pg.ScatterPlotItem(symbol="t1", size=12, brush=COLORS["clean"], pen=None)
        self.load_plot.addItem(self.clip_marks)
        self.load_plot.addItem(self.impact_marks)
        self.core_line = pg.InfiniteLine(angle=0, pen=pg.mkPen("#a8b6c6", style=QtCore.Qt.DashLine))
        self.expand_line = pg.InfiniteLine(angle=0, pen=pg.mkPen("#6d8496", style=QtCore.Qt.DotLine))
        self.load_plot.addItem(self.core_line)
        self.load_plot.addItem(self.expand_line)
        self.zoom_region = pg.LinearRegionItem(values=(0, 5), brush=pg.mkBrush(112, 213, 208, 28))
        self.overview.addItem(self.zoom_region)
        self.zoom_region.sigRegionChanged.connect(self.overview_changed)
        self.zoom_region.sigRegionChangeFinished.connect(self.view_changed)
        self.load_plot.sigXRangeChanged.connect(self.detail_changed)
        self.selection = pg.LinearRegionItem(values=(0, .5), brush=pg.mkBrush(237, 184, 110, 27), pen=pg.mkPen(COLORS["y"]))
        self.load_plot.addItem(self.selection)
        self.selection.sigRegionChanged.connect(self.selection_changed)
        self.crosshairs = []
        for plot in (self.load_plot, self.gyro_plot):
            line = pg.InfiniteLine(angle=90, pen=pg.mkPen("#8397aa", style=QtCore.Qt.DotLine))
            plot.addItem(line, ignoreBounds=True)
            self.crosshairs.append(line)
        self.mouse_proxy = pg.SignalProxy(self.load_plot.scene().sigMouseMoved, rateLimit=30, slot=self.mouse_moved)
        right.addWidget(graphs)
        self.tabs = W.QTabWidget()
        candidate_panel = W.QWidget()
        cl = W.QVBoxLayout(candidate_panel)
        cl.setContentsMargins(3, 3, 3, 3)
        candidate_bar = W.QHBoxLayout()
        for text, handler in [("Previous", lambda: self.step_event(-1)), ("Next", lambda: self.step_event(1))]:
            button = W.QPushButton(text)
            button.clicked.connect(handler)
            candidate_bar.addWidget(button)
        self.selection_label = W.QLabel("Orange selection: —")
        candidate_bar.addWidget(self.selection_label, 1)
        cl.addLayout(candidate_bar)
        self.event_table = self.table(["#", "Start · s", "End · s", "Window · s*", "Est. ft*", "Impact · s", "Impact · g", "Review", "Distance source"])
        self.event_table.horizontalHeaderItem(4).setToolTip("Horizontal distance estimate over the candidate window. Source and quality are shown per row; hover for details. Candidate windows are not verified airtime.")
        self.event_table.itemSelectionChanged.connect(self.event_selected)
        cl.addWidget(self.event_table)
        label_bar = W.QHBoxLayout()
        self.label_note = W.QLineEdit()
        self.label_note.setPlaceholderText("Optional note: e.g. small double, wheel contact uncertain")
        label_bar.addWidget(self.label_note, 1)
        for text, kind in [("Confirm jump", "jump"), ("Not a jump", "not_jump"), ("Mark missed jump", "missed")]:
            button = W.QPushButton(text)
            button.clicked.connect(lambda checked=False, k=kind: self.add_label(k))
            label_bar.addWidget(button)
        cl.addLayout(label_bar)
        self.tabs.addTab(candidate_panel, "Candidates")
        label_panel = W.QWidget()
        ll = W.QVBoxLayout(label_panel)
        self.label_table = self.table(["Type", "Start · s", "End · s", "Note"])
        self.label_table.itemSelectionChanged.connect(self.label_selected)
        ll.addWidget(self.label_table)
        delete = W.QPushButton("Remove selected label")
        delete.clicked.connect(self.remove_label)
        ll.addWidget(delete)
        self.tabs.addTab(label_panel, "Your labels")
        self.catalog = Catalog(self, self.catalog_path)
        self.tabs.addTab(self.catalog, "Jump catalog")
        self.notes = W.QPlainTextEdit()
        self.notes.setPlaceholderText("Session notes: bike, sensor settings, trail, mounting, and what to investigate next…")
        self.notes.textChanged.connect(self.mark_dirty)
        self.tabs.addTab(self.notes, "Session notes")
        self.diagnostics = W.QPlainTextEdit()
        self.diagnostics.setReadOnly(True)
        self.tabs.addTab(self.diagnostics, "Data & timing")
        right.addWidget(self.tabs)
        right.setSizes([620, 260])
        split.setSizes([350, 1050])
        self.setCentralWidget(central)
        self.apply_settings(Settings())

    @staticmethod
    def table(headers):
        table = W.QTableWidget(0, len(headers))
        table.setHorizontalHeaderLabels(headers)
        table.setSelectionBehavior(W.QAbstractItemView.SelectRows)
        table.setSelectionMode(W.QAbstractItemView.SingleSelection)
        table.setEditTriggers(W.QAbstractItemView.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().hide()
        table.horizontalHeader().setSectionResizeMode(W.QHeaderView.Stretch)
        return table

    @staticmethod
    def new_plot(title, label, units):
        plot = pg.PlotWidget(background="#141b25", title=title)
        plot.setLabel("left", label, units=units)
        plot.setLabel("bottom", "Elapsed time", units="s")
        plot.showGrid(x=True, y=True, alpha=.12)
        plot.setClipToView(True)
        plot.setDownsampling(auto=True, mode="peak")
        plot.getViewBox().setMouseEnabled(x=True, y=False)
        return plot

    def settings(self):
        values = {}
        for key, widget in self.controls.items():
            values[key] = widget.currentData() if isinstance(widget, W.QComboBox) else widget.value()
        values["gyro_range_dps"] = float(values["gyro_range_dps"])
        settings = Settings(**values)
        settings.validate()
        return settings

    def apply_settings(self, settings):
        self.updating = True
        for key, value in asdict(settings).items():
            widget = self.controls[key]
            if isinstance(widget, W.QComboBox):
                widget.setCurrentIndex(widget.findData(value))
            else:
                widget.setValue(value)
        self.updating = False
        self.update_filter_controls()

    def update_filter_controls(self):
        method = self.controls["filter"].currentData()
        self.controls["window_samples"].setEnabled(method in {"median", "mean"})
        self.controls["cutoff_hz"].setEnabled(method == "butterworth")
        self.filter_note.setText("Butterworth: order 2, forward/backward; zero phase, effective order 4. Offline only." if method == "butterworth"
                                 else "Centered filters use future samples. Detection uses filtered magnitude; impact uses raw magnitude.")

    def settings_changed(self):
        if self.updating:
            return
        self.update_filter_controls()
        if self.ride:
            # A pending/invalid run must never be saved with stale results.
            self.autosave_timer.stop()
            self.dirty = True
            self.timer.start()
            self.setWindowTitle("Bike Coach · Jump Workbench — settings pending")

    def mark_dirty(self):
        if self.updating or not self.ride:
            return
        self.dirty = True
        self.setWindowTitle("Bike Coach · Jump Workbench — " + self.ride.path.name + " *")
        if self.session_path:
            self.autosave_timer.start()

    def error(self, text):
        W.QMessageBox.warning(self, "Bike Coach Workbench", str(text))

    def ready_to_replace(self):
        if not self.dirty and not self.timer.isActive():
            return True
        answer = W.QMessageBox.question(self, "Save this session?", "Save settings, labels and notes before continuing?",
                                       W.QMessageBox.Save | W.QMessageBox.Discard | W.QMessageBox.Cancel)
        if answer == W.QMessageBox.Save:
            return self.save()
        return answer == W.QMessageBox.Discard

    def open_csv(self, checked=False, path=None):
        if not self.ready_to_replace():
            return
        if path is None:
            path, _ = W.QFileDialog.getOpenFileName(self, "Open recording", str(Path.home() / "Downloads"), "Bike Coach recordings (*.csv);;All files (*)")
        if not path:
            return
        try:
            ride = load_ride(path)
            settings = Settings()
            # Repeated rail values indicate an old ±2g export; otherwise don't infer range.
            if not np.any(np.isclose(np.abs(ride.accel), 2, atol=.00015)):
                settings.accel_range_g, settings.gyro_range_dps = 16, 2000
            result = analyze(ride, settings)
            self.install_ride(ride, settings, result)
            self.labels, self.snapshots, self.baseline = [], [], None
            self.session_path = None
            self.notes.clear()
            self.refresh_snapshots()
            self.refresh_labels()
            self.recalculate()
            self.full_ride()
            if self.result["events"]:
                self.event_table.selectRow(0)
            self.mark_dirty()
        except (OSError, ValueError, TypeError, KeyError) as exc:
            self.error(exc)

    def install_ride(self, ride, settings, result):
        self.timer.stop()
        self.autosave_timer.stop()
        self.ride, self.result = ride, result
        self.result_settings = settings
        self.apply_settings(settings)
        self.zoom_region.setBounds((0, float(result["time"][-1])))
        self.selection.setBounds((0, float(result["time"][-1])))
        self.fix_vertical_scales()
        self.file_label.setText(ride.path.name)
        self.file_label.setToolTip(str(ride.path))
        self.setWindowTitle("Bike Coach · Jump Workbench — " + ride.path.name)

    def open_session(self, checked=False, path=None):
        if not self.ready_to_replace():
            return
        if path is None:
            path, _ = W.QFileDialog.getOpenFileName(self, "Open saved session", str(Path(__file__).resolve().parents[1] / "sessions"), "Bike Coach sessions (*.json)")
        if not path:
            return
        try:
            try:
                saved, ride, settings, result = read_session(path)
            except FileNotFoundError:
                replacement, _ = W.QFileDialog.getOpenFileName(self, "Locate the original recording", "", "CSV (*.csv)")
                if not replacement:
                    return
                saved, ride, settings, result = read_session(path, replacement)
            self.install_ride(ride, settings, result)
            self.labels, self.snapshots = saved.get("labels", []), saved.get("snapshots", [])
            code_changed = saved.get("algorithm_version") != ALGORITHM_VERSION or saved.get("analysis_sha256", algorithm_fingerprint()) != algorithm_fingerprint()
            if code_changed:
                self.snapshots.append({"name": "Imported previous detector results", "algorithm_version": saved.get("algorithm_version"),
                                       "saved_at": saved.get("saved_at"), "settings": saved["settings"],
                                       "analysis_sha256": saved.get("analysis_sha256"),
                                       "events": saved.get("events", []), "evaluation": saved.get("evaluation", {})})
            self.session_path = Path(path)
            self.updating = True
            self.notes.setPlainText(saved.get("notes", ""))
            self.updating = False
            self.baseline = None
            self.refresh_snapshots()
            comparison_index = saved.get("comparison_index")
            if isinstance(comparison_index, int) and 0 <= comparison_index < len(self.snapshots):
                self.baseline = self.snapshots[comparison_index]
                self.baseline_combo.blockSignals(True)
                self.baseline_combo.setCurrentIndex(comparison_index + 1)
                self.baseline_combo.blockSignals(False)
            self.refresh_labels()
            self.recalculate()
            view = saved.get("view", [0, result["time"][-1]])
            if len(view) == 2 and np.isfinite(view).all() and 0 <= view[0] < view[1] <= result["time"][-1] + .01:
                self.load_plot.setXRange(*view, padding=0)
            else:
                self.full_ride()
            selection = saved.get("selection")
            if isinstance(selection, list) and len(selection) == 2 and np.isfinite(selection).all() and 0 <= selection[0] < selection[1] <= result["time"][-1]:
                self.selection.setRegion(selection)
            else:
                visible = self.load_plot.viewRange()[0]
                candidate = next((e for e in result["events"] if e["start_s"] >= visible[0] and e["end_s"] <= visible[1]), None)
                if candidate:
                    self.selection.setRegion((candidate["start_s"], candidate["end_s"]))
            self.dirty = False
            self.setWindowTitle("Bike Coach · Jump Workbench — " + ride.path.name)
            self.preferences.setValue("last_session", str(self.session_path))
            if code_changed:
                self.statusBar().showMessage("Session recomputed using the current detector; stored events preserve the previous results.")
        except (OSError, ValueError, TypeError, KeyError) as exc:
            self.error(exc)

    def recalculate(self):
        if not self.ride:
            return False
        try:
            settings = self.settings()
            if self.labels and self.result_settings and settings.uniform_hz != self.result_settings.uniform_hz:
                raise ValueError("Timing cannot change after labeling. Restore the rate or open a fresh recording to use a different clock.")
            result = analyze(self.ride, settings)
            if self.baseline:
                compare_settings = Settings(**self.baseline["settings"])
                # Comparisons must use the same time coordinate system.
                if compare_settings.uniform_hz != settings.uniform_hz:
                    self.baseline_curve.clear()
                    self.compare_label.setText("Different timing assumptions: comparison overlay disabled. Restore matching rate to compare.")
                else:
                    previous = analyze(self.ride, compare_settings)
                    self.baseline_curve.setData(previous["time"], previous["filtered"], connect="finite")
                    old_score, new_score = evaluate(previous["events"], self.labels), evaluate(result["events"], self.labels)
                    self.compare_label.setText(f"{self.baseline['name']}: {len(previous['events'])} → {len(result['events'])} candidates\n"
                                              f"Labeled jumps matched: {old_score['matched_jumps']} → {new_score['matched_jumps']} / {new_score['labeled_jumps']}\nPartial labels; not overall accuracy.")
            else:
                self.baseline_curve.clear()
            self.result = result
            self.result_settings = settings
            self.render_results(settings)
            self.mark_dirty()
            return True
        except (ValueError, TypeError, KeyError) as exc:
            self.autosave_timer.stop()
            self.notice.setText("Settings need attention: " + str(exc) + " Previous plot retained; saving disabled until corrected.")
            self.statusBar().showMessage(str(exc))
            return False

    def render_results(self, settings):
        r, t = self.result, self.result["time"]
        # Break plot lines at gaps instead of drawing invented transitions.
        breaks = np.r_[np.diff(t) <= settings.gap_s, True]
        for curve, values in [(self.raw_curve, r["raw"]), (self.clean_curve, r["filtered"]), (self.overview_curve, r["raw"])]:
            curve.setData(t, values, connect=breaks)
        gyro = self.ride.gyro
        c = self.ride.calibration
        try:
            basis = np.array([c[axis] for axis in ("forward", "left", "up")], dtype=float)
            bias = np.array(c.get("bias", [0, 0, 0]), dtype=float)
            valid = basis.shape == (3, 3) and bias.shape == (3,) and np.isfinite(basis).all() and np.isfinite(bias).all()
            if not valid or not np.allclose(basis @ basis.T, np.eye(3), atol=.03):
                raise ValueError("Invalid frame")
            gyro = (gyro - bias) @ basis.T
            names = ["Roll · forward", "Pitch · left", "Yaw · up"]
            gyro_title = "Angular velocity · saved bike frame, gyro bias removed"
        except (KeyError, ValueError, TypeError):
            names, gyro_title = ["Device X", "Device Y", "Device Z"], "Angular velocity · device axes"
        self.gyro_plot.setTitle(gyro_title)
        legend = self.gyro_plot.plotItem.legend
        for i, curve in enumerate(self.gyro_curves):
            curve.setData(t, gyro[:, i], connect=breaks)
        for i, (_, label) in enumerate(legend.items):
            label.setText(names[i])
        clip = r["clipped"]
        self.clip_marks.setData(t[clip], r["raw"][clip])
        hits = [e for e in r["events"] if e["impact_s"] is not None]
        self.impact_marks.setData([e["impact_s"] for e in hits], [e["impact_g"] for e in hits])
        self.core_line.setValue(settings.core_g)
        self.expand_line.setValue(settings.expand_g)
        for plot, mark in self._marks:
            plot.removeItem(mark)
        self._marks.clear()
        for event in r["events"]:
            for plot in [self.load_plot, self.overview]:
                mark = pg.LinearRegionItem((event["start_s"], event["end_s"]), movable=False,
                                           brush=pg.mkBrush(112, 213, 208, 22), pen=pg.mkPen(None))
                mark.setZValue(-5)
                plot.addItem(mark)
                self._marks.append((plot, mark))
        for label in self.labels:
            color = {"jump": (109, 217, 147, 32), "missed": (237, 184, 110, 32), "not_jump": (242, 140, 119, 32)}[label["kind"]]
            mark = pg.LinearRegionItem((label["start_s"], label["end_s"]), movable=False,
                                       brush=pg.mkBrush(*color), pen=pg.mkPen(color[:3], style=QtCore.Qt.DotLine))
            mark.setZValue(-4)
            mark.setToolTip(label["kind"] + ": " + label.get("note", ""))
            self.load_plot.addItem(mark)
            self._marks.append((self.load_plot, mark))
        if self.baseline and self.baseline["settings"]["uniform_hz"] == settings.uniform_hz:
            previous = analyze(self.ride, Settings(**self.baseline["settings"]))
            for event in previous["events"]:
                mark = pg.LinearRegionItem((event["start_s"], event["end_s"]), movable=False,
                                           brush=pg.mkBrush(0, 0, 0, 0), pen=pg.mkPen(COLORS["baseline"], style=QtCore.Qt.DashLine))
                mark.setZValue(-3)
                self.load_plot.addItem(mark)
                self._marks.append((self.load_plot, mark))
        self.event_table.blockSignals(True)
        self.event_table.setRowCount(len(r["events"]))
        for row, e in enumerate(r["events"]):
            overlap = [label["kind"] for label in self.labels if min(label["end_s"], e["end_s"]) > max(label["start_s"], e["start_s"])]
            values = [row + 1, f"{e['start_s']:.3f}", f"{e['end_s']:.3f}", f"{e['window_s']:.3f}",
                      f"{e['distance_ft']:.1f}",
                      "—" if e["impact_s"] is None else f"{e['impact_s']:.3f}",
                      "—" if e["impact_g"] is None else f"{e['impact_g']:.2f}" + (" *" if e["clipped"] else ""),
                      ", ".join(overlap) or "Unreviewed"]
            if e["impact_s"] is not None and sum(other["impact_s"] == e["impact_s"] for other in r["events"]) > 1:
                values[-1] += " · shared impact"
            if e["joined_windows"] > 1:
                values[-1] += f" · joined {e['joined_windows']} windows"
            evidence = e["distance_evidence"]
            source = {"gps_horizontal_speed_integral": "GPS", "gps_approach_speed": "GPS approach", "assumed_constant_speed_x_candidate_window": "Assumed"}[e["distance_source"]]
            values.append(source + " · " + evidence["quality"])
            for column, value in enumerate(values):
                item = W.QTableWidgetItem(str(value))
                approach = evidence["approach_horizontal_mps"]
                speed_note = f"Mean horizontal speed: {evidence['mean_horizontal_mps'] / .44704:.1f} mph."
                if approach is not None:
                    speed_note += f" Recent approach: {approach / .44704:.1f} mph (not instantaneous takeoff speed)."
                item.setToolTip(f"{e['distance_ft']:.1f} ft / {e['distance_m']:.1f} m; {values[-1]}\n"
                                f"Fallback assumption: {settings.assumed_speed_mph:g} mph horizontal. Window: {e['window_s']:.3f} s; not verified airtime.\n"
                                + speed_note + "\n" + "\n".join(evidence["reasons"]) if column in (4, 8) else str(value))
                self.event_table.setItem(row, column, item)
        self.event_table.blockSignals(False)
        score = evaluate(r["events"], self.labels)
        unique_impacts = len({event["impact_s"] for event in r["events"] if event["impact_s"] is not None})
        self.count_label.setText(f"{len(r['events'])} candidates · {unique_impacts} impact crossings · {len(self.labels)} labels")
        self.notice.setText(f"{len(t):,} samples · ~{r['sample_hz']:.1f} Hz · {r['gap_count']} gaps · "
                            f"{100 * clip.mean():.1f}% accel range flags · "
                            f"labeled jumps found {score['matched_jumps']}/{score['labeled_jumps']} · "
                            f"* horizontal distance: see source per row; fallback {settings.assumed_speed_mph:g} mph; windows ≠ verified airtime")
        diagnostics = [f"Source: {self.ride.path}", f"SHA-256: {self.ride.sha256}",
                       f"Algorithm: {ALGORITHM_VERSION}", f"Time span: {t[-1]:.3f} s", f"Estimated sample rate: {r['sample_hz']:.3f} Hz",
                       f"Reported output_Hz median: {self.ride.reported_hz}",
                       f"Assumed rails: ±{settings.accel_range_g:g} g / ±{settings.gyro_range_dps:g} °/s",
                       f"Gyro range flags: {np.count_nonzero(r['gyro_clipped']):,}",
                       "", *r["warnings"], "", "GPS sampling and timing:", json.dumps(r["gps"], indent=2), "", json.dumps(score, indent=2), "", json.dumps(asdict(settings), indent=2)]
        self.diagnostics.setPlainText("\n".join(diagnostics))

    def overview_changed(self):
        if self._syncing or not self.result:
            return
        self._syncing = True
        self.load_plot.setXRange(*self.zoom_region.getRegion(), padding=0)
        self._syncing = False

    def detail_changed(self, *args):
        if self._syncing or not self.result:
            return
        self._syncing = True
        self.zoom_region.setRegion(self.load_plot.viewRange()[0])
        self._syncing = False

    def view_changed(self):
        if self.result:
            self.mark_dirty()

    def full_ride(self):
        if self.result:
            self.raw_curve.show()
            self.clean_curve.show()
            for curve in self.gyro_curves:
                curve.show()
            self.fix_vertical_scales()
            self.load_plot.setXRange(0, self.result["time"][-1], padding=0)
            self.overview.setXRange(0, self.result["time"][-1], padding=0)

    def fix_vertical_scales(self):
        """Use whole-recording bounds, independent of time zoom and filters."""
        if not self.ride:
            return
        load_max = max(1.0, float(self.ride.load.max()) * 1.08)
        gyro_max = max(1.0, float(np.linalg.norm(self.ride.gyro, axis=1).max()) * 1.08)
        for plot, low, high in [(self.load_plot, 0.0, load_max), (self.overview, 0.0, load_max),
                                (self.gyro_plot, -gyro_max, gyro_max)]:
            view = plot.getViewBox()
            view.enableAutoRange(axis=pg.ViewBox.YAxis, enable=False)
            view.setLimits(yMin=low, yMax=high, minYRange=high - low, maxYRange=high - low)
            view.setYRange(low, high, padding=0)

    def event_selected(self):
        row = self.event_table.currentRow()
        if self.result and 0 <= row < len(self.result["events"]):
            event = self.result["events"][row]
            self.focus_interval(event["start_s"], event["end_s"])

    def focus_interval(self, start, end):
        self.selection.setRegion((start, end))
        self.load_plot.setXRange(max(0, start - .8), min(self.result["time"][-1], end + .8), padding=0)

    def step_event(self, step):
        count = self.event_table.rowCount()
        if count:
            self.event_table.selectRow((self.event_table.currentRow() + step) % count)

    def selection_changed(self):
        start, end = self.selection.getRegion()
        self.selection_label.setText(f"Orange selection: {start:.3f}–{end:.3f} s")

    def mouse_moved(self, event):
        if not self.result:
            return
        pos = event[0]
        if not self.load_plot.sceneBoundingRect().contains(pos):
            return
        point = self.load_plot.plotItem.vb.mapSceneToView(pos)
        x = point.x()
        if not 0 <= x <= self.result["time"][-1]:
            return
        for line in self.crosshairs:
            line.setPos(x)
        raw = np.interp(x, self.result["time"], self.result["raw"])
        clean = np.interp(x, self.result["time"], self.result["filtered"])
        self.statusBar().showMessage(f"{x:.3f} s · raw {raw:.3f} g · filtered {clean:.3f} g · values interpolated at cursor")

    def add_label(self, kind):
        if not self.result:
            return
        start, end = self.selection.getRegion()
        if end - start < .005:
            self.error("Drag the orange handles to select an interval first.")
            return
        # Labels are independent observations, never attached to a changing row number.
        for existing in self.labels:
            if max(start, existing["start_s"]) < min(end, existing["end_s"]):
                self.error("This interval overlaps an existing label. Remove that label first if you want to change it.")
                return
        self.labels.append({"id": str(uuid.uuid4()), "kind": kind, "start_s": float(start), "end_s": float(end),
                            "note": self.label_note.text().strip(), "created_at": datetime.now(timezone.utc).isoformat()})
        self.label_note.clear()
        self.refresh_labels()
        self.recalculate()
        self.mark_dirty()

    def refresh_labels(self):
        self.label_table.blockSignals(True)
        self.label_table.setRowCount(len(self.labels))
        for row, label in enumerate(self.labels):
            for column, value in enumerate([label["kind"], f"{label['start_s']:.3f}", f"{label['end_s']:.3f}", label.get("note", "")]):
                self.label_table.setItem(row, column, W.QTableWidgetItem(value))
        self.label_table.blockSignals(False)

    def label_selected(self):
        row = self.label_table.currentRow()
        if self.result and 0 <= row < len(self.labels):
            label = self.labels[row]
            self.focus_interval(label["start_s"], label["end_s"])

    def remove_label(self):
        row = self.label_table.currentRow()
        if 0 <= row < len(self.labels):
            del self.labels[row]
            self.refresh_labels()
            self.recalculate()
            self.mark_dirty()

    def capture_baseline(self):
        if not self.ride or not self.recalculate():
            return
        name, ok = W.QInputDialog.getText(self, "Save comparison run", "Run name", text=f"Run {len(self.snapshots) + 1}")
        if not ok or not name.strip():
            return
        self.snapshots.append({"name": name.strip(), "algorithm_version": ALGORITHM_VERSION,
                               "analysis_sha256": algorithm_fingerprint(),
                               "saved_at": datetime.now(timezone.utc).isoformat(), "settings": asdict(self.settings()),
                               "events": self.result["events"], "evaluation": evaluate(self.result["events"], self.labels)})
        self.refresh_snapshots()
        self.baseline_combo.setCurrentIndex(len(self.snapshots))
        self.mark_dirty()

    def refresh_snapshots(self):
        self.baseline_combo.blockSignals(True)
        self.baseline_combo.clear()
        self.baseline_combo.addItem("No comparison run", None)
        for i, snapshot in enumerate(self.snapshots):
            self.baseline_combo.addItem(snapshot["name"], i)
        self.baseline_combo.blockSignals(False)
        self.compare_label.setText("Saved settings are rerun with current code; stored results remain in session JSON.")

    def select_baseline(self):
        index = self.baseline_combo.currentData()
        self.baseline = self.snapshots[index] if index is not None else None
        if self.ride:
            self.recalculate()

    def restore_baseline(self):
        if self.baseline:
            self.apply_settings(Settings(**self.baseline["settings"]))
            self.recalculate()

    def save(self, save_as=False):
        if not self.ride:
            return False
        self.timer.stop()
        if not self.recalculate():
            self.error("Correct the analysis settings before saving.")
            return False
        path = self.session_path
        if save_as or path is None:
            directory = Path(__file__).resolve().parents[1] / "sessions"
            directory.mkdir(exist_ok=True)
            suggested = path or directory / (self.ride.path.stem + ".bike-session.json")
            chosen, _ = W.QFileDialog.getSaveFileName(self, "Save analysis session", str(suggested), "JSON session (*.json)")
            if not chosen:
                return False
            path = Path(chosen)
        return self.write_session(path)

    def write_session(self, path):
        try:
            settings = self.settings()
            if self.timer.isActive() or self.result_settings is None or asdict(settings) != asdict(self.result_settings):
                raise ValueError("Settings have not produced a valid analysis. Correct them before saving.")
            value = make_session(self.ride, settings, self.result, self.labels, self.snapshots,
                                 self.load_plot.viewRange()[0], self.notes.toPlainText(), path)
            value["selection"] = [float(v) for v in self.selection.getRegion()]
            value["catalog_path"] = str(self.catalog.path)
            value["catalog_entries"] = [e for e in self.catalog.entries if e.get("observation", {}).get("recording_sha256") == self.ride.sha256]
            value["comparison_index"] = self.baseline_combo.currentData()
            if Path(path).resolve() == self.ride.path:
                raise ValueError("A session cannot overwrite the original recording.")
            if Path(path).suffix.lower() != ".json":
                raise ValueError("Save sessions with a .json extension.")
            atomic_json(path, value)
            self.session_path = Path(path).resolve()
            self.preferences.setValue("last_session", str(self.session_path))
            self.autosave_timer.stop()
            self.dirty = False
            self.setWindowTitle("Bike Coach · Jump Workbench — " + self.ride.path.name)
            self.statusBar().showMessage("Session saved: " + str(self.session_path))
            return True
        except (OSError, ValueError, TypeError) as exc:
            self.statusBar().showMessage("Save failed: " + str(exc))
            self.dirty = True
            return False

    def autosave(self):
        if self.session_path and self.dirty and not self.timer.isActive():
            self.write_session(self.session_path)

    def export_report(self):
        if not self.ride or not self.recalculate():
            return
        path, _ = W.QFileDialog.getSaveFileName(self, "Export reproducible review", str(self.session_path or Path.home() / "Desktop" / "bike-review.json"), "JSON review (*.json)")
        if not path:
            return
        self.write_session(path)

    def closeEvent(self, event):
        if self.ready_to_replace():
            event.accept()
        else:
            event.ignore()

    def show_help(self):
        W.QMessageBox.information(self, "Using the workbench",
            "1. Open a recording. Select a candidate to zoom, or drag the overview selection.\n\n"
            "2. Save a comparison run, then change filters or detector settings. Raw load always remains visible; "
            "the comparison is dashed purple. Click legend entries to hide curves.\n\n"
            "3. Drag the orange interval handles to your estimated takeoff/landing. Confirm jump, reject it, or mark a missed jump. "
            "Labels stay fixed when settings change. Right-click plots for view options.\n\n"
            "4. Save a session once. Changes then autosave after a short pause. Keep the original CSV. "
            "Tell Codex the session path to review or refine the analysis.\n\n"
            "Shading = candidate unloading. Triangles = first raw impact threshold crossing. Crosses = assumed acceleration rail. "
            "Dashed threshold = core; dotted threshold = expansion. These are candidates, not proven airtime.\n\n"
            "Window duration includes one nominal sample interval. Labels store the endpoints you selected. "
            "A reported clipped impact is a lower bound. This initial version has no video synchronization.")


def run(path=None):
    app = W.QApplication.instance() or W.QApplication(sys.argv[:1])
    app.setApplicationName("Bike Coach Workbench")
    app.setApplicationVersion(__version__)
    app.setStyle("Fusion")
    pg.setConfigOptions(antialias=False, foreground="#bfcddd", background="#141b25")
    window = Workbench()
    if path:
        if str(path).endswith(".json"):
            window.open_session(path=path)
        else:
            window.open_csv(path=path)
    else:
        last = window.preferences.value("last_session", "")
        if last and Path(last).is_file():
            window.open_session(path=last)
    window.show()
    print(f"Workbench ready: {window.file_label.text()} · {window.count_label.text()}", flush=True)
    sys.exit(app.exec())
