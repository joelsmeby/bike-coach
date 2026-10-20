"""Phone GPS import and explicitly qualified horizontal-speed estimates."""
import json
import math
import re

import numpy as np


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def import_gps(lines):
    comments = {}
    for name in ("BikeCoachRide", "BikeCoachGPS"):
        line = next((line for line in lines if line.startswith("# " + name + "=")), None)
        if line:
            try:
                comments[name] = json.loads(line.split("=", 1)[1])
            except ValueError:
                return None, ["GPS metadata is invalid; using the speed assumption."]
    gps, ride = comments.get("BikeCoachGPS"), comments.get("BikeCoachRide")
    if gps is None:
        return None, []
    try:
        if not isinstance(gps, dict) or not isinstance(ride, dict):
            raise ValueError("missing recording identity")
        if gps.get("schemaVersion") != 1 or not re.fullmatch(r"[a-f0-9]{16}", str(gps.get("id", ""))) or gps["id"] != ride.get("id"):
            raise ValueError("recording identity mismatch")
        sync = gps["sync"]
        if not all(finite(sync.get(k)) for k in ("phoneEpochMs", "boardMs", "uncertaintyMs")) or not 0 <= sync["uncertaintyMs"] <= 2000:
            raise ValueError("invalid clock synchronization")
        if not isinstance(sync["boardMs"], int) or not isinstance(ride.get("startBoardMs"), int) or not all(0 <= n < 2**32 for n in (sync["boardMs"], ride["startBoardMs"])):
            raise ValueError("invalid board clock")
        delta = (ride["startBoardMs"] - sync["boardMs"]) % 2**32
        if delta > 60000:
            raise ValueError("clock synchronization is too far from recording start")
        start = sync["phoneEpochMs"] + delta
        points = gps["points"]
        if not isinstance(points, list) or len(points) > 100000:
            raise ValueError("invalid point list")
        last = -math.inf
        normalized = []
        for p in points:
            if not all(finite(p.get(k)) for k in ("timestamp", "latitude", "longitude", "accuracy")):
                raise ValueError("invalid location fix")
            if p["timestamp"] <= last or not (-90 <= p["latitude"] <= 90 and -180 <= p["longitude"] <= 180) or p["accuracy"] < 0:
                raise ValueError("invalid fix order or coordinates")
            if not isinstance(p.get("segment"), int) or p["segment"] < 0:
                raise ValueError("invalid GPS segment")
            last = p["timestamp"]
            speed = p.get("speed")
            normalized.append({**p, "t": (p["timestamp"] - start) / 1000,
                               "speed": float(speed) if finite(speed) and 0 <= speed <= 40 else None})
        end = gps.get("endEpochMs")
        if end is not None and (not finite(end) or end < start):
            raise ValueError("invalid recording end time")
        normalized = [p for p in normalized if p["timestamp"] >= start and (end is None or p["timestamp"] <= end)]
        method = gps.get("timingMethod", ride.get("timingMethod", "board-clock"))
        return {"points": normalized, "uncertainty_s": sync["uncertaintyMs"] / 1000,
                "timing_method": method, "id": gps["id"]}, []
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        return None, [f"GPS ignored: {exc}. Using the speed assumption."]


def summary(gps):
    if not gps:
        return {"available": False, "note": "No matching GPS metadata."}
    points = gps["points"]
    intervals = [b["t"] - a["t"] for a, b in zip(points, points[1:]) if a["segment"] == b["segment"]]
    return {"available": True, "fix_count": len(points),
            "speed_fix_count": sum(p["speed"] is not None for p in points),
            "median_interval_s": float(np.median(intervals)) if intervals else None,
            "largest_interval_s": max(intervals) if intervals else None,
            "sync_uncertainty_s": gps["uncertainty_s"], "timing_method": gps["timing_method"],
            "note": "Position accuracy is not speed accuracy. RTC/sample alignment and clock drift can add error."}


def estimate(gps, event, settings):
    result = {"source": "assumed_constant_speed_x_candidate_window", "quality": "assumed",
              "distance_m": settings.assumed_speed_mph * .44704 * event["window_s"],
              "mean_horizontal_mps": settings.assumed_speed_mph * .44704,
              "approach_horizontal_mps": None, "fixes_in_window": 0, "reasons": []}
    if settings.distance_mode == "assumed":
        result["reasons"] = ["Assumed-speed mode selected."]
        return result
    if not gps:
        result["reasons"] = ["No matching GPS data."]
        return result
    result["sync_uncertainty_s"] = gps["uncertainty_s"]
    result["timing_method"] = gps["timing_method"]
    if settings.uniform_hz:
        result["reasons"] = ["Uniform-rate override changes the IMU clock; GPS alignment disabled."]
        return result
    if gps["uncertainty_s"] > settings.gps_max_sync_s:
        result["reasons"] = ["GPS/IMU synchronization uncertainty exceeds the allowed limit."]
        return result
    points = gps["points"]
    start, end = event["start_s"], event["start_s"] + event["window_s"]
    def good(p):
        return p["accuracy"] <= settings.gps_max_accuracy_m and p["speed"] is not None
    # Include invalid intermediate fixes: they must break an integration span.
    ts = np.array([p["t"] for p in points])
    left = int(np.searchsorted(ts, start, side="right")) - 1
    right = int(np.searchsorted(ts, end, side="left"))
    approach = [p for p in points if start - 3 <= p["t"] <= start]
    if approach and good(approach[-1]) and start - approach[-1]["t"] <= settings.gps_max_age_s:
        last_segment = approach[-1]["segment"]
        approach = [p for p in approach if p["segment"] == last_segment]
        if len(approach) >= 2 and all(good(p) for p in approach) and all(b["t"] - a["t"] <= settings.gps_max_gap_s for a, b in zip(approach, approach[1:])):
            result["approach_horizontal_mps"] = float(np.median([p["speed"] for p in approach]))
    reasons = []
    if 0 <= left < right < len(points):
        local = points[left:right + 1]
        gaps = [b["t"] - a["t"] for a, b in zip(local, local[1:])]
        same_segment = all(p["segment"] == local[0]["segment"] for p in local)
        if all(good(p) for p in local) and same_segment and max(gaps) <= settings.gps_max_gap_s and start - local[0]["t"] <= settings.gps_max_age_s and local[-1]["t"] - end <= settings.gps_max_age_s:
            grid = np.r_[start, [p["t"] for p in local if start < p["t"] < end], end]
            speeds = np.interp(grid, [p["t"] for p in local], [p["speed"] for p in local])
            distance = float(np.trapezoid(speeds, grid))
            inside = sum(start <= p["t"] <= end for p in local)
            sparse = max(gaps) > .25 or inside < 3 or gps["uncertainty_s"] > .1 or gps["timing_method"] == "phone-command"
            return {**result, "source": "gps_horizontal_speed_integral", "quality": "sparse" if sparse else "sampled",
                    "distance_m": distance, "mean_horizontal_mps": distance / event["window_s"],
                    "fixes_in_window": inside, "largest_gap_s": max(gaps),
                    "position_accuracy_worst_m": max(p["accuracy"] for p in local),
                    "reasons": ["Sparse or approximately synchronized GPS; interpolation does not resolve instantaneous takeoff speed."] if sparse else ["Based on reported horizontal speed; velocity accuracy is not supplied by the browser."]}
        reasons.append("GPS coverage crosses a gap/segment, is stale, or has missing speed/poor position quality.")
    else:
        reasons.append("GPS does not bracket the full candidate interval.")
    if result["approach_horizontal_mps"] is not None:
        speed = result["approach_horizontal_mps"]
        return {**result, "source": "gps_approach_speed", "quality": "approach_only",
                "distance_m": speed * event["window_s"], "mean_horizontal_mps": speed,
                "reasons": reasons + ["Recent approach horizontal speed held constant across the candidate; flight speed was not measured."]}
    result["reasons"] = reasons + ["No usable recent approach speed; using the explicit speed assumption."]
    return result


def location_at(gps, seconds, max_accuracy=20):
    """Nearby recorded location for catalog reference, never precision ramp mapping."""
    if not gps or gps["uncertainty_s"] > .25:
        return None
    points = [p for p in gps["points"] if p["accuracy"] <= max_accuracy and abs(p["t"] - seconds) <= 1]
    if not points:
        return None
    point = min(points, key=lambda p: abs(p["t"] - seconds))
    return {"latitude": point["latitude"], "longitude": point["longitude"], "accuracy_m": point["accuracy"],
            "sample_offset_s": point["t"] - seconds, "note": "Nearby phone fix; not a surveyed takeoff coordinate."}
