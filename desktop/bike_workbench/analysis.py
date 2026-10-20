"""Reproducible load-based candidate detection. No UI or network dependencies."""
from __future__ import annotations

import csv
import hashlib
import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.optimize import linear_sum_assignment
from scipy.signal import butter, sosfiltfilt

from . import gps

ALGORITHM_VERSION = "load-sequence/1.3.0"


def algorithm_fingerprint():
    return hashlib.sha256(Path(__file__).read_bytes() + Path(gps.__file__).read_bytes()).hexdigest()


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
    merge_gap_s: float = 0.2
    landing_hold_s: float = 0.08

    def validate(self):
        numeric = [v for v in asdict(self).values() if isinstance(v, (int, float))]
        if not all(math.isfinite(v) for v in numeric):
            raise ValueError("Settings must be finite numbers.")
        if self.filter not in {"raw", "median", "mean", "butterworth"}:
            raise ValueError("Unknown filter.")
        if self.mode not in {"sequence", "threshold"}:
            raise ValueError("Unknown detector.")
        if not isinstance(self.window_samples, int) or self.window_samples < 1 or self.window_samples % 2 != 1:
            raise ValueError("Filter window must be a positive odd number of samples.")
        if not 0 < self.core_g <= self.expand_g:
            raise ValueError("Expansion threshold must be at least the core threshold.")
        if not 0 < self.min_core_s <= self.max_window_s or self.gap_s <= 0:
            raise ValueError("Durations and gap limit must be positive.")
        if self.cutoff_hz <= 0 or self.uniform_hz < 0 or self.impact_search_s <= 0:
            raise ValueError("Cutoff and impact search must be positive; sample rate cannot be negative.")
        if min(self.accel_range_g, self.gyro_range_dps, self.impact_g) <= 0:
            raise ValueError("Sensor ranges and impact threshold must be positive.")
        if self.distance_mode not in {"auto", "assumed"}:
            raise ValueError("Unknown distance mode.")
        if min(self.gps_max_sync_s, self.gps_max_gap_s, self.gps_max_age_s, self.gps_max_accuracy_m) <= 0:
            raise ValueError("GPS quality limits must be positive.")
        if self.assumed_speed_mph < 0:
            raise ValueError("Assumed speed cannot be negative.")
        if self.merge_gap_s < 0 or self.landing_hold_s <= 0:
            raise ValueError("Join gap cannot be negative; landing hold must be positive.")


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
    lines = payload.decode("utf-8-sig").splitlines()
    calibration, warnings = {}, []
    for line in lines:
        if line.startswith("# BikeCoachCalibration="):
            try:
                calibration = json.loads(line.split("=", 1)[1])
            except (ValueError, TypeError):
                warnings.append("Calibration comment is invalid; displaying device axes.")
    reader = csv.DictReader(line for line in lines if line.strip() and not line.startswith("#"))
    required = {"rtcDate", "rtcTime", "aX", "aY", "aZ", "gX", "gY", "gZ"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("CSV needs rtcDate, rtcTime, aX/aY/aZ (mg), gX/gY/gZ (degrees/s).")
    times, accel, gyro, rates = [], [], [], []
    first_stamp = None
    for number, row in enumerate(reader, 2):
        try:
            stamp = datetime.strptime(row["rtcDate"] + " " + row["rtcTime"], "%m/%d/%Y %H:%M:%S.%f")
            a = [float(row[k]) / 1000 for k in ("aX", "aY", "aZ")]
            g = [float(row[k]) for k in ("gX", "gY", "gZ")]
            if not all(math.isfinite(v) for v in a + g):
                raise ValueError("nonfinite sensor value")
        except (ValueError, KeyError, TypeError) as exc:
            raise ValueError(f"Invalid sensor record near CSV row {number}: {exc}") from exc
        if first_stamp is None:
            first_stamp = stamp
        times.append((stamp - first_stamp).total_seconds())
        accel.append(a)
        gyro.append(g)
        try:
            hz = float(row.get("output_Hz", "0"))
            if math.isfinite(hz) and hz > 0:
                rates.append(hz)
        except (ValueError, TypeError):
            pass
    if len(times) < 4:
        raise ValueError("Recording needs at least four valid samples.")
    time = np.array(times, dtype=float)
    if np.any(np.diff(time) < 0):
        raise ValueError("RTC timestamps move backwards. Split the recording at the clock reset first.")
    repeats = int(np.count_nonzero(np.diff(time) == 0))
    if repeats:
        if time[-1] <= 0:
            raise ValueError("Recording has no measurable timestamp span.")
        # Preserve row order and gaps. Distribute equal stamps within their RTC bin.
        nominal_dt = time[-1] / (len(time) - 1)
        starts = np.r_[0, np.flatnonzero(np.diff(time) > 0) + 1]
        ends = np.r_[starts[1:], len(time)]
        original = time.copy()
        for start, end in zip(starts, ends):
            if end - start == 1:
                continue
            width = original[end] - original[start] if end < len(time) else nominal_dt * (end - start)
            if width > 0.12:
                width = nominal_dt * (end - start)
            time[start:end] += np.arange(end - start) * width / (end - start)
        warnings.append(f"{repeats:,} repeated RTC stamps: sample times interpolated within bins; boundaries are approximate.")
    warnings.append("Acceleration units assumed mg; gyro units assumed degrees/s. Sensor ranges are editable assumptions.")
    gps_data, gps_warnings = gps.import_gps(lines)
    warnings.extend(gps_warnings)
    return Ride(path, hashlib.sha256(payload).hexdigest(), time, np.array(accel), np.array(gyro),
                calibration, warnings, repeats, float(np.median(rates)) if rates else None, gps_data)


def timeline(ride: Ride, settings: Settings):
    if settings.uniform_hz:
        return np.arange(len(ride.time), dtype=float) / settings.uniform_hz
    return ride.time.copy()


def segments(time, gap_s):
    cuts = np.flatnonzero(np.diff(time) > gap_s) + 1
    return [(int(a), int(b)) for a, b in zip(np.r_[0, cuts], np.r_[cuts, len(time)])]


def filter_load(time, raw, settings: Settings):
    settings.validate()
    out = np.array(raw, copy=True)
    warnings = []
    for start, end in segments(time, settings.gap_s):
        values = raw[start:end]
        if settings.filter == "median":
            out[start:end] = median_filter(values, size=settings.window_samples, mode="nearest")
        elif settings.filter == "mean":
            out[start:end] = uniform_filter1d(values, size=settings.window_samples, mode="nearest")
        elif settings.filter == "butterworth":
            if len(values) < 3:
                warnings.append("Short segment left unfiltered.")
                continue
            t = time[start:end]
            # Use a uniform grid before a digital filter; never filter across gaps.
            fs = (len(t) - 1) / (t[-1] - t[0])
            if settings.cutoff_hz >= fs / 2:
                raise ValueError(f"Cutoff must be below Nyquist ({fs / 2:.2f} Hz).")
            count = max(2, int(round((t[-1] - t[0]) * fs)) + 1)
            grid = np.linspace(t[0], t[-1], count)
            fs = (count - 1) / (t[-1] - t[0])
            if settings.cutoff_hz >= fs / 2:
                raise ValueError("Cutoff is too high for this segment's sample rate.")
            sos = butter(2, settings.cutoff_hz, fs=fs, output="sos")
            if len(grid) <= 9:
                warnings.append("Short segment left unfiltered (Butterworth padding).")
                continue
            clean = sosfiltfilt(sos, np.interp(grid, t, values))
            out[start:end] = np.interp(t, grid, clean)
    return out, list(dict.fromkeys(warnings))


def analyze(ride: Ride, settings: Settings):
    settings.validate()
    time, raw = timeline(ride, settings), ride.load
    clean, warnings = filter_load(time, raw, settings)
    clipped = np.any(np.abs(ride.accel) >= settings.accel_range_g * .9999, axis=1)
    gyro_clipped = np.any(np.abs(ride.gyro) >= settings.gyro_range_dps * .9999, axis=1)
    events = []
    for start, end in segments(time, settings.gap_s):
        dt = float(np.mean(np.diff(time[start:end]))) if end - start > 1 else 0
        windows = []
        low = clean[start:end] < settings.core_g
        edges = np.diff(np.r_[False, low, False].astype(int))
        for cs, ce in zip(np.flatnonzero(edges == 1) + start, np.flatnonzero(edges == -1) + start - 1):
            if time[ce] - time[cs] + dt + 1e-8 < settings.min_core_s:
                continue
            left, right = int(cs), int(ce)
            while left > start and clean[left - 1] < settings.expand_g:
                left -= 1
            while right + 1 < end and clean[right + 1] < settings.expand_g:
                right += 1
            if time[right] - time[left] + dt > settings.max_window_s:
                continue
            # Require observable entry/exit; segment boundaries cannot prove a jump.
            if left == start or right == end - 1:
                continue
            core = [float(time[cs]), float(time[ce])]
            if windows and windows[-1]["left"] == left and windows[-1]["right"] == right:
                windows[-1]["cores"].append(core)
                continue
            windows.append({"left": left, "right": right, "cores": [core], "parts": 1})

        joined = []
        for window in windows:
            if joined and settings.merge_gap_s > 0:
                previous = joined[-1]
                separation = time[window["left"]] - time[previous["right"]]
                span = time[window["right"]] - time[previous["left"]] + dt
                if separation <= settings.merge_gap_s + 1e-8 and span <= settings.max_window_s:
                    # A brief spike does not establish touchdown. Require sustained
                    # support-level load before treating adjacent windows as distinct.
                    left_gap, right_gap = previous["right"] + 1, window["left"]
                    contact = clean[left_gap:right_gap] >= max(.8, settings.expand_g)
                    edges = np.diff(np.r_[False, contact, False].astype(int))
                    begins = np.flatnonzero(edges == 1) + left_gap
                    finishes = np.flatnonzero(edges == -1) + left_gap - 1
                    sustained = any(time[b] - time[a] + dt + 1e-8 >= settings.landing_hold_s
                                    for a, b in zip(begins, finishes))
                    if not sustained:
                        previous["right"] = window["right"]
                        previous["cores"].extend(window["cores"])
                        previous["parts"] += window["parts"]
                        continue
            joined.append(window)

        for window in joined:
            left, right = window["left"], window["right"]
            limit = min(end, int(np.searchsorted(time, time[right] + settings.impact_search_s, side="right")))
            hits = np.flatnonzero(raw[right + 1:limit] > settings.impact_g)
            impact_index = int(right + 1 + hits[0]) if len(hits) else None
            if settings.mode == "sequence" and impact_index is None:
                continue
            events.append({
                "start_index": left, "end_index": right,
                "start_s": float(time[left]), "end_s": float(time[right]),
                "window_s": float(time[right] - time[left] + dt),
                "cores": window["cores"], "joined_windows": window["parts"],
                "impact_s": float(time[impact_index]) if impact_index is not None else None,
                "impact_g": float(raw[impact_index]) if impact_index is not None else None,
                "mean_g": float(raw[left:right + 1].mean()),
                "min_g": float(raw[left:right + 1].min()),
                "clipped": bool(clipped[left:limit].any()),
                "gyro_clipped": bool(gyro_clipped[left:limit].any()),
            })
    for event in events:
        distance = gps.estimate(ride.gps, event, settings)
        event["distance_m"] = distance["distance_m"]
        event["distance_ft"] = distance["distance_m"] / .3048
        event["assumed_speed_mph"] = settings.assumed_speed_mph
        event["distance_source"] = distance["source"]
        event["distance_evidence"] = distance
    if settings.uniform_hz:
        warnings.append("Uniform sample-rate override active: RTC gaps and timing jitter are ignored.")
    intervals = np.diff(time)
    continuous_intervals = intervals[intervals <= settings.gap_s]
    sample_hz = float(1 / np.mean(continuous_intervals)) if len(continuous_intervals) else 0.0
    return {"time": time, "raw": raw, "filtered": clean, "events": events,
            "clipped": clipped, "gyro_clipped": gyro_clipped, "warnings": ride.warnings + warnings,
            "sample_hz": sample_hz, "gps": gps.summary(ride.gps),
            "gap_count": len(segments(time, settings.gap_s)) - 1}


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
