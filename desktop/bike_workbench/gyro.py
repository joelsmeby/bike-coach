"""Offline rotation-vibration evidence; never a jump probability or attitude angle."""
import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import savgol_filter


def bike_frame(ride):
    """Return bias-corrected bike rates if the saved frame is orthonormal."""
    try:
        c = ride.calibration
        basis = np.array([c[k] for k in ("forward", "left", "up")], dtype=float)
        bias = np.array(c.get("bias", [0, 0, 0]), dtype=float)
        if basis.shape != (3, 3) or bias.shape != (3,) or not np.isfinite(basis).all() or not np.isfinite(bias).all() or not np.allclose(basis @ basis.T, np.eye(3), atol=.03):
            return None
        return (ride.gyro - bias) @ basis.T
    except (KeyError, TypeError, ValueError):
        return None


def vibration(ride, time, settings, segments):
    """Local RMS after removing a linear trend, resampled per continuous segment."""
    out = np.full(len(time), np.nan)
    if settings.gyro_evidence == "off":
        return out, "off", []
    rates, channel = ride.gyro, "all axes"
    if settings.gyro_channel == "pitch":
        frame = bike_frame(ride)
        if frame is None:
            return out, "pitch unavailable", ["Pitch evidence needs a valid saved bike frame; no device axis was substituted."]
        rates, channel = frame[:, 1:2], "bike pitch rate"
    # Any clipped device axis can corrupt a projected rate; mask its whole filter support.
    clipped = np.any(np.abs(ride.gyro) >= settings.gyro_range_dps * .9999, axis=1)
    for start, end in segments:
        t = time[start:end]
        if len(t) < 8:
            continue
        fs = (len(t) - 1) / (t[-1] - t[0])
        if fs < 20:
            continue
        window = max(5, int(round(settings.gyro_trend_s * fs)))
        window += 1 - window % 2
        rms_window = max(3, int(round(.06 * fs)))
        rms_window += 1 - rms_window % 2
        guard = window // 2 + rms_window // 2
        if len(t) <= 2 * guard + 3:
            continue
        grid = np.linspace(t[0], t[-1], len(t))
        values = np.column_stack([np.interp(grid, t, rates[start:end, axis]) for axis in range(rates.shape[1])])
        trend = savgol_filter(values, window, 1, axis=0, mode="interp")
        power = np.sum((values - trend) ** 2, axis=1)
        rough = np.sqrt(np.maximum(0, uniform_filter1d(power, rms_window, mode="nearest")))
        invalid = np.interp(grid, t, clipped[start:end].astype(float)) > 0
        invalid = maximum_filter1d(invalid, 2 * guard + 1, mode="nearest")
        invalid[:guard] = True
        invalid[-guard:] = True
        # Interpolate validity too, so no value bridges a clipped/edge region.
        mapped = np.interp(t, grid, rough)
        mapped[np.interp(t, grid, invalid.astype(float)) > 0] = np.nan
        out[start:end] = mapped
    return out, channel, ["Gyro evidence is relative vibration contrast, not jump probability. Centered filters blur timing; gyro refinement is bounded and remains an estimate."]


def evidence(time, rough, event, settings, segment):
    result = {"status": "unavailable", "support_score": None, "takeoff_score": None, "landing_score": None,
              "before_dps": None, "flight_dps": None, "after_dps": None,
              "takeoff_supported": False, "landing_supported": False, "reasons": []}
    if settings.gyro_evidence == "off":
        return {**result, "status": "off", "reasons": ["Gyro evidence disabled."]}
    start, end = event["start_s"], event["start_s"] + event["window_s"]
    # Exclude boundary transitions; never collect context across a recording gap.
    guard = settings.gyro_trend_s / 2 + .03
    seg_start, seg_end = segment
    dt = (time[seg_end - 1] - time[seg_start]) / (seg_end - seg_start - 1)
    trend_samples = max(5, int(round(settings.gyro_trend_s / dt)))
    trend_samples += 1 - trend_samples % 2
    rms_samples = max(3, int(round(.06 / dt)))
    rms_samples += 1 - rms_samples % 2
    guard = max(guard, (trend_samples // 2 + rms_samples // 2) * dt)
    intervals = {"before_dps": (start - guard - settings.gyro_context_s, start - guard),
                 "flight_dps": (start + guard, end - guard),
                 "after_dps": (end + guard, end + guard + settings.gyro_context_s)}
    for name, (a, b) in intervals.items():
        mask = (time >= a) & (time <= b)
        indices = np.flatnonzero(mask)
        if a < time[seg_start] or b > time[seg_end - 1] or len(indices) < 3 or b - a < .06 or not np.isfinite(rough[indices]).all():
            result["reasons"].append(name.replace("_dps", "") + ": insufficient continuous, unclipped gyro coverage.")
            continue
        # Time-weighted RMS to avoid overweighting quantized timestamp clusters.
        t, values = time[indices], rough[indices]
        result[name] = float(np.sqrt(np.trapezoid(values ** 2, t) / (t[-1] - t[0])))
    flight = result["flight_dps"]
    if flight is None:
        return result
    for side, context in (("takeoff", "before_dps"), ("landing", "after_dps")):
        baseline = result[context]
        if baseline is None:
            continue
        if baseline < settings.gyro_floor_dps:
            result["reasons"].append(side + ": surrounding trail already quiet; contrast is inconclusive.")
            continue
        result[side + "_score"] = float(100 * np.clip(1 - flight / baseline, 0, 1))
        result[side + "_supported"] = bool(flight / baseline <= settings.gyro_ratio)
    scores = [result["takeoff_score"], result["landing_score"]]
    if all(s is not None for s in scores):
        result["support_score"] = min(scores)
        result["status"] = "supports" if result["takeoff_supported"] and result["landing_supported"] else "mixed" if result["takeoff_supported"] or result["landing_supported"] else "no contrast"
    elif any(s is not None for s in scores):
        result["status"] = "partial"
    result["reasons"].append("Score is reduction in gyro vibration versus local trail; overall uses the weaker boundary. This score is a heuristic; see gyro_detection for any boundary/join changes.")
    return result


def window_evidence(time, rough, left, right, settings, segment):
    a, b = segment
    dt = float(np.mean(np.diff(time[a:b])))
    return evidence(time, rough, {"start_s": float(time[left]), "window_s": float(time[right] - time[left] + dt)}, settings, segment)


def can_bridge(time, clean, rough, previous, current, settings, segment):
    """Join only a low-load interruption with usable quiet gyro across it."""
    if settings.gyro_detection != "assist" or settings.gyro_evidence == "off":
        return False
    left, right = previous["left"], current["right"]
    separation = time[current["left"]] - time[previous["right"]]
    dt = float(np.mean(np.diff(time[segment[0]:segment[1]])))
    if separation > settings.gyro_join_s + 1e-8 or time[right] - time[left] + dt > settings.max_window_s:
        return False
    a, b = previous["right"] + 1, current["left"]
    if a >= b or not np.isfinite(rough[left:right + 1]).all():
        return False
    # Sustained full loading or a large filtered impact must not be erased.
    if np.mean(clean[a:b]) > settings.gyro_bridge_g or np.max(clean[a:b]) >= settings.impact_g:
        return False
    e = window_evidence(time, rough, left, right, settings, segment)
    if e["status"] != "supports":
        return False
    threshold = min(e["before_dps"], e["after_dps"]) * settings.gyro_ratio
    return bool(np.all(rough[a:b] <= threshold))


def refine_window(time, clean, raw, rough, window, settings, segment):
    """Bounded quiet-run refinement; a qualifying acceleration core must remain."""
    left, right = window["left"], window["right"]
    if settings.gyro_detection != "assist" or settings.gyro_refine_s == 0:
        return left, right, "acceleration timing"
    e = window_evidence(time, rough, left, right, settings, segment)
    if e["status"] != "supports" or not np.isfinite(rough[left:right + 1]).all():
        return left, right, "acceleration timing: gyro contrast insufficient or unavailable"
    threshold = min(e["before_dps"], e["after_dps"]) * settings.gyro_ratio
    a = max(segment[0] + 1, int(np.searchsorted(time, time[left] - settings.gyro_refine_s)))
    b = min(segment[1] - 1, int(np.searchsorted(time, time[right] + settings.gyro_refine_s, side="right")))
    quiet = np.isfinite(rough[a:b]) & (rough[a:b] <= threshold)
    edges = np.diff(np.r_[False, quiet, False].astype(int))
    dt = float(np.mean(np.diff(time[segment[0]:segment[1]])))
    choices = []
    for first, last in zip(np.flatnonzero(edges == 1) + a, np.flatnonzero(edges == -1) + a - 1):
        if time[first] > time[left] + settings.gyro_refine_s + 1e-8 or time[last] < time[right] - settings.gyro_refine_s - 1e-8:
            continue
        overlap = max(0., time[min(last, right)] - time[max(first, left)] + dt)
        if overlap < max(settings.min_core_s, .5 * (time[right] - time[left] + dt)):
            continue
        # Only extend into unloading; gyro quietness alone cannot extend into ground contact.
        new_left, new_right = left, right
        if first >= left:
            new_left = int(first)
        else:
            while new_left > first and clean[new_left - 1] < max(.8, settings.expand_g) and raw[new_left - 1] < settings.impact_g:
                new_left -= 1
        if last <= right:
            new_right = int(last)
        else:
            while new_right < last and clean[new_right + 1] < max(.8, settings.expand_g) and raw[new_right + 1] < settings.impact_g:
                new_right += 1
        if new_left > new_right or time[new_right] - time[new_left] + dt > settings.max_window_s:
            continue
        # Retain a full acceleration core, not merely a quiet section of trail.
        low = clean[new_left:new_right + 1] < settings.core_g
        core_edges = np.diff(np.r_[False, low, False].astype(int))
        starts = np.flatnonzero(core_edges == 1) + new_left
        ends = np.flatnonzero(core_edges == -1) + new_left - 1
        if not any(time[y] - time[x] + dt + 1e-8 >= settings.min_core_s for x, y in zip(starts, ends)):
            continue
        choices.append((overlap, new_left, new_right))
    if not choices:
        return left, right, "acceleration timing: no safe gyro refinement"
    _, first, last = max(choices)
    return first, last, "gyro refined timing" if (first, last) != (left, right) else "gyro agrees with acceleration timing"
