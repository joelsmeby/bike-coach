"""Typed desktop adapters to the shared offline analysis engine."""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from .shared_engine import call, ENGINE_PATH

ALGORITHM_VERSION = "shared-motion/2.0.0"


def algorithm_fingerprint():
    return hashlib.sha256(ENGINE_PATH.read_bytes()).hexdigest()


@dataclass
class Settings:
    filter: str = "median"
    window_samples: int = 3
    cutoff_hz: float = 5.0
    mode: str = "sequence"
    core_g: float = 0.4
    expand_g: float = 0.6
    min_core_s: float = 0.12
    max_window_s: float = 3.0
    impact_g: float = 1.5
    impact_search_s: float = 0.3
    gap_s: float = 0.12
    accel_range_g: float = 2.0
    gyro_range_dps: float = 250.0
    uniform_hz: float = 0.0
    assumed_speed_mph: float = 18.0
    distance_mode: str = "auto"
    gps_max_sync_s: float = .25
    gps_max_gap_s: float = 1.5
    gps_max_age_s: float = 1.0
    gps_max_accuracy_m: float = 20.0
    gyro_detection: str = "assist"
    gyro_join_s: float = .35
    gyro_refine_s: float = .12
    gyro_bridge_g: float = 1.0
    gyro_evidence: str = "support"
    gyro_channel: str = "all"
    gyro_trend_s: float = .12
    gyro_context_s: float = .3
    gyro_ratio: float = .65
    gyro_floor_dps: float = 1.0
    merge_gap_s: float = 0.2
    landing_hold_s: float = 0.08

    def validate(self):
        call("settings", asdict(self))


@dataclass
class Ride:
    path: Path
    sha256: str
    time: np.ndarray
    accel: np.ndarray
    gyro: np.ndarray
    calibration: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    repeated_timestamps: int = 0
    reported_hz: float | None = None
    gps: dict | None = None

    @property
    def load(self):
        return np.linalg.norm(self.accel, axis=1)


def load_ride(path: str | Path) -> Ride:
    path = Path(path).expanduser().resolve()
    payload = path.read_bytes()
    value = call("parseRide", payload.decode("utf-8-sig"))
    return Ride(path, hashlib.sha256(payload).hexdigest(), np.array(value["time"]), np.array(value["accel"]),
                np.array(value["gyro"]), value["calibration"], value["warnings"], value["repeated_timestamps"],
                value["reported_hz"], value["gps"])


def timeline(ride: Ride, settings: Settings):
    if settings.uniform_hz:
        return np.arange(len(ride.time), dtype=float) / settings.uniform_hz
    return ride.time.copy()


def segments(time, gap_s):
    cuts = np.flatnonzero(np.diff(time) > gap_s) + 1
    return [(int(a), int(b)) for a, b in zip(np.r_[0, cuts], np.r_[cuts, len(time)])]


def filter_load(time, raw, settings: Settings):
    settings.validate()
    result = call("filterLoad", np.asarray(time).tolist(), np.asarray(raw).tolist(), asdict(settings))
    return np.asarray(result["filtered"]), result["warnings"]


def analyze(ride: Ride, settings: Settings):
    settings.validate()
    result = call("analyzeRide", {"time": ride.time.tolist(), "accel": ride.accel.tolist(), "gyro": ride.gyro.tolist(),
                                "calibration": ride.calibration, "gps": ride.gps, "warnings": ride.warnings}, asdict(settings))
    for key in ("time", "raw", "filtered", "gyro_vibration", "gyro_rates"):
        result[key] = np.array([np.nan if x is None else x for x in result[key]], dtype=float)
    for key in ("clipped", "gyro_clipped"):
        result[key] = np.array(result[key], dtype=bool)
    return result


def interval_iou(a, b):
    overlap = max(0, min(a["end_s"], b["end_s"]) - max(a["start_s"], b["start_s"]))
    union = max(a["end_s"], b["end_s"]) - min(a["start_s"], b["start_s"])
    return overlap / union if union > 0 else 0


def evaluate(events, labels):
    """Partial-label coverage, not population accuracy. One-to-one IoU >= 0.1."""
    positive = [label for label in labels if label["kind"] in {"jump", "missed"}]
    matched = 0
    if events and positive:
        scores = np.array([[interval_iou(event, label) for label in positive] for event in events])
        rows, cols = linear_sum_assignment(-(scores >= .1).astype(float) * (min(scores.shape) + 1) - scores)
        matched = sum(scores[row, col] >= .1 for row, col in zip(rows, cols))
    rejected = sum(any(interval_iou(e, label) >= .1 for label in labels if label["kind"] == "not_jump") for e in events)
    return {"labeled_jumps": len(positive), "matched_jumps": int(matched),
            "missed_labeled_jumps": len(positive) - int(matched),
            "candidates_overlapping_rejections": int(rejected),
            "unmatched_candidates": len(events) - int(matched),
            "note": "Partial labels only; unmatched candidates are unreviewed, not proven false positives. Match: one-to-one interval IoU >= 0.1."}
