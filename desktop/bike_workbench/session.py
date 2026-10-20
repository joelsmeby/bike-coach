"""Portable JSON experiments. Original ride bytes are never copied or altered."""
from __future__ import annotations

import json
import os
import platform
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy
import scipy

from . import __version__
from .analysis import ALGORITHM_VERSION, Settings, analyze, evaluate, load_ride, algorithm_fingerprint

SCHEMA_VERSION = 1


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            name = handle.name
            json.dump(value, handle, indent=2, allow_nan=False)
            handle.write("\n")
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def make_session(ride, settings, result, labels, snapshots, view, notes, path):
    return {
        "schema_version": SCHEMA_VERSION, "app_version": __version__, "algorithm_version": ALGORITHM_VERSION,
        "analysis_sha256": algorithm_fingerprint(),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "environment": {"python": platform.python_version(), "numpy": numpy.__version__, "scipy": scipy.__version__},
        "recording": {"path": str(ride.path), "relative_path": os.path.relpath(ride.path, Path(path).resolve().parent),
                      "sha256": ride.sha256, "samples": len(ride.time), "calibration": ride.calibration},
        "settings": asdict(settings), "view": [float(v) for v in view], "notes": notes,
        "labels": labels, "snapshots": snapshots, "events": result["events"],
        "gps": result.get("gps"),
        "evaluation": evaluate(result["events"], labels), "warnings": result["warnings"],
    }


def read_session(path, recording_override=None):
    path = Path(path).resolve()
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported session schema version.")
    settings = Settings(**value["settings"])
    settings.validate()
    source = value["recording"]
    candidates = [Path(recording_override)] if recording_override else [path.parent / source["relative_path"], Path(source["path"])]
    recording = next((candidate for candidate in candidates if candidate.is_file()), None)
    if recording is None:
        raise FileNotFoundError("Original recording not found. Relocate it using the file picker or --recording.")
    ride = load_ride(recording)
    if ride.sha256 != source["sha256"]:
        raise ValueError("Recording fingerprint does not match this session. Choose the original file.")
    result = analyze(ride, settings)
    for label in value.get("labels", []):
        if label.get("kind") not in {"jump", "not_jump", "missed"} or not 0 <= label["start_s"] < label["end_s"] <= result["time"][-1]:
            raise ValueError("Session contains an invalid label interval.")
    for snapshot in value.get("snapshots", []):
        Settings(**snapshot["settings"]).validate()
        if not isinstance(snapshot["name"], str):
            raise ValueError("Invalid comparison run name.")
    # Always recompute under current code. Saved events remain evidence of the old run.
    return value, ride, settings, result
