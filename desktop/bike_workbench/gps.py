"""GPS helpers delegate analysis to the browser/desktop shared engine."""
from dataclasses import asdict
from .shared_engine import call


def import_gps(lines):
    result = call("importGps", list(lines))
    return result["gps"], result["warnings"]


def summary(gps):
    return call("gpsSummary", gps)


def estimate(gps, event, settings):
    return call("estimateDistance", gps, event, asdict(settings))


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
