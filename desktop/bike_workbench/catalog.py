"""Private, editable trail/jump observations, separate from detector settings."""
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PySide6 import QtCore, QtWidgets as W

from .gps import location_at
from .session import atomic_json

ANGLE_FIELDS = {"ramp_angle_deg": "Ramp geometry", "bike_pitch_deg": "Bike pitch at takeoff",
                "trajectory_angle_deg": "Flight direction"}


def validate(entry):
    if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) and entry[k].strip() for k in ("id", "trail", "jump")):
        raise ValueError("Catalog entries need an ID, trail and jump name.")
    for key in ANGLE_FIELDS:
        angle = entry.get(key)
        if angle is not None and (isinstance(angle, bool) or not isinstance(angle, (int, float)) or not math.isfinite(angle) or not -90 <= angle <= 90):
            raise ValueError("Angles must be between −90° and 90°, or unknown.")
    if any(entry.get(key) is not None for key in ANGLE_FIELDS) and not entry.get("measurement_notes", "").strip():
        raise ValueError("Describe how the angle was measured or estimated.")


class Catalog(W.QWidget):
    def __init__(self, workbench, path):
        super().__init__()
        self.workbench, self.path = workbench, Path(path)
        self.entries, self.current_id, self.load_error = [], None, None
        try:
            if self.path.exists():
                value = json.loads(self.path.read_text())
                if value.get("schema_version") != 1 or not isinstance(value.get("entries"), list):
                    raise ValueError("Unsupported catalog format.")
                for entry in value["entries"]:
                    validate(entry)
                if len({e["id"] for e in value["entries"]}) != len(value["entries"]):
                    raise ValueError("Duplicate catalog IDs.")
                self.entries = value["entries"]
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            self.load_error = str(exc)
        layout = W.QVBoxLayout(self)
        note = W.QLabel("Angles are signed relative to horizontal: uphill is positive. Bike pitch can help estimate takeoff direction after calibration; it is not automatically ramp or flight angle. Unknown angles stay blank.")
        note.setWordWrap(True)
        layout.addWidget(note)
        form = W.QGridLayout()
        self.trail, self.jump, self.notes = W.QLineEdit(), W.QLineEdit(), W.QLineEdit()
        for column, (label, widget) in enumerate((("Trail", self.trail), ("Jump", self.jump))):
            form.addWidget(W.QLabel(label), 0, column * 2)
            form.addWidget(widget, 0, column * 2 + 1)
        self.angles = {}
        for column, (key, label) in enumerate(ANGLE_FIELDS.items()):
            box = W.QWidget()
            row = W.QHBoxLayout(box)
            row.setContentsMargins(0, 0, 0, 0)
            known = W.QCheckBox(label)
            spin = W.QDoubleSpinBox()
            spin.setRange(-90, 90)
            spin.setSuffix("°")
            spin.setDecimals(1)
            spin.setEnabled(False)
            known.toggled.connect(spin.setEnabled)
            row.addWidget(known)
            row.addWidget(spin)
            form.addWidget(box, 1, column, 1, 1)
            self.angles[key] = known, spin
        form.addWidget(W.QLabel("Measurement / estimate notes"), 2, 0)
        form.addWidget(self.notes, 2, 1, 1, 3)
        self.notes.setPlaceholderText("e.g. ramp measured with inclinometer; bike pitch from calibrated sensor; video estimate")
        layout.addLayout(form)
        bar = W.QHBoxLayout()
        save, new = W.QPushButton("Save catalog entry"), W.QPushButton("New entry from orange selection")
        save.clicked.connect(self.save)
        new.clicked.connect(self.new)
        bar.addWidget(save)
        bar.addWidget(new)
        self.message = W.QLabel()
        self.message.setWordWrap(True)
        bar.addWidget(self.message, 1)
        layout.addLayout(bar)
        self.table = workbench.table(["Trail", "Jump", "Ramp · °", "Bike pitch · °", "Flight · °", "Measurement notes"])
        self.table.itemSelectionChanged.connect(self.selected)
        layout.addWidget(self.table)
        self.path_label = W.QLabel("Catalog: " + str(self.path))
        self.path_label.setWordWrap(True)
        self.path_label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        layout.addWidget(self.path_label)
        self.refresh()
        if self.load_error:
            self.message.setText("Catalog could not be loaded; saving disabled to preserve it: " + self.load_error)
            save.setEnabled(False)

    def refresh(self):
        self.table.blockSignals(True)
        self.table.setRowCount(len(self.entries))
        for row, entry in enumerate(self.entries):
            values = [entry["trail"], entry["jump"], *["—" if entry.get(k) is None else f"{entry[k]:.1f}" for k in ANGLE_FIELDS], entry.get("measurement_notes", "")]
            for col, text in enumerate(values):
                item = W.QTableWidgetItem(text)
                item.setToolTip(text)
                self.table.setItem(row, col, item)
        self.table.blockSignals(False)

    def new(self):
        self.current_id = None
        self.table.clearSelection()
        self.jump.clear()
        self.notes.clear()
        for known, spin in self.angles.values():
            known.setChecked(False)
            spin.setValue(0)
        self.message.setText("New entry will reference the current recording and orange selection.")

    def selected(self):
        row = self.table.currentRow()
        if row < 0 or not self.table.selectedItems():
            return
        entry = self.entries[row]
        self.current_id = entry["id"]
        self.trail.setText(entry["trail"])
        self.jump.setText(entry["jump"])
        self.notes.setText(entry.get("measurement_notes", ""))
        for key, (known, spin) in self.angles.items():
            known.setChecked(entry.get(key) is not None)
            spin.setValue(entry.get(key) or 0)
        self.message.setText("Editing saved entry; original recording reference is preserved.")

    def save(self):
        try:
            if self.load_error:
                raise ValueError("Repair the catalog file before saving.")
            previous = next((e for e in self.entries if e["id"] == self.current_id), None)
            entry = dict(previous) if previous else {"id": str(uuid.uuid4())}
            entry.update(trail=self.trail.text().strip(), jump=self.jump.text().strip(), measurement_notes=self.notes.text().strip(),
                         updated_at=datetime.now(timezone.utc).isoformat())
            for key, (known, spin) in self.angles.items():
                entry[key] = spin.value() if known.isChecked() else None
            validate(entry)
            if previous is None:
                w = self.workbench
                if w.ride is None or w.result_settings is None:
                    raise ValueError("Open a recording and select a jump interval first.")
                start, end = map(float, w.selection.getRegion())
                if not 0 <= start < end <= w.result["time"][-1]:
                    raise ValueError("Choose an interval inside the recording.")
                entry["observation"] = {"recording_sha256": w.ride.sha256, "recording_path": str(w.ride.path),
                                        "start_s": start, "end_s": end, "uniform_hz": w.result_settings.uniform_hz,
                                        "location": None if w.result_settings.uniform_hz else location_at(w.ride.gps, start)}
            entries = [entry if e["id"] == entry["id"] else e for e in self.entries]
            if previous is None:
                entries.append(entry)
            atomic_json(self.path, {"schema_version": 1, "entries": entries})
            self.entries, self.current_id = entries, entry["id"]
            self.refresh()
            self.message.setText("Saved. Angle fields are observations/estimates, not detector outputs.")
            self.workbench.mark_dirty()
            return True
        except (OSError, ValueError, TypeError) as exc:
            self.message.setText(str(exc))
            return False
