"""Sensitivity study for one ride. Stability is not ground-truth accuracy."""
import argparse
from dataclasses import asdict, replace
from itertools import product

from .analysis import Settings, analyze, algorithm_fingerprint, interval_iou, load_ride
from .session import atomic_json


def profiles(base=None):
    base = base or Settings()
    return {
        "Original conservative": replace(base, filter="median", window_samples=3, core_g=.4, expand_g=.6,
                                          min_core_s=.12, impact_search_s=.3),
        "Balanced review": replace(base, filter="median", window_samples=3, core_g=.55, expand_g=.7,
                                    min_core_s=.1, impact_search_s=.3, impact_g=1.5),
        "Sensitive review": replace(base, filter="median", window_samples=3, core_g=.55, expand_g=.7,
                                     min_core_s=.08, impact_search_s=.5, impact_g=1.5),
    }


def neighborhood(base):
    for core, duration, expand, search, impact, method in product(
        [.5, .55, .6], [.08, .1, .12], [.65, .7], [.3, .5], [1.3, 1.5],
        [("median", 3), ("median", 5), ("mean", 3)],
    ):
        yield replace(base, core_g=core, min_core_s=duration, expand_g=expand,
                      impact_search_s=search, impact_g=impact, filter=method[0], window_samples=method[1])


def run_sweep(ride, base=None, configurations=None):
    base = base or Settings()
    configurations = list(configurations if configurations is not None else neighborhood(base))
    if not configurations:
        raise ValueError("Need at least one sweep configuration.")
    runs = [{"settings": asdict(settings), "events": analyze(ride, settings)["events"]} for settings in configurations]
    summaries = []
    for name, settings in profiles(base).items():
        events = analyze(ride, settings)["events"]
        enriched = []
        for event in events:
            support = sum(any(interval_iou(event, other) >= .1 for other in run["events"]) for run in runs)
            per_filter = {}
            for method in ("median", "mean"):
                subset = [run for run in runs if run["settings"]["filter"] == method]
                if subset:
                    per_filter[method] = sum(any(interval_iou(event, other) >= .1 for other in run["events"]) for run in subset) / len(subset)
            shared = sum(other["impact_s"] == event["impact_s"] for other in events) > 1 if event["impact_s"] is not None else False
            enriched.append({**event, "neighborhood_support": support / len(runs),
                             "support_by_filter": per_filter, "shares_impact_with_other_candidate": shared})
        impacts = {event["impact_s"] for event in events if event["impact_s"] is not None}
        summaries.append({"name": name, "settings": asdict(settings), "candidate_count": len(events),
                          "unique_impact_crossings": len(impacts), "events": enriched})
    return {"recording_sha256": ride.sha256, "analysis_sha256": algorithm_fingerprint(),
            "configuration_count": len(runs), "profiles": summaries, "runs": runs,
            "interpretation": "Unlabeled sensitivity study, not measured accuracy. Support = fraction of configurations with an overlapping candidate (IoU >= 0.1). Shared impact crossings may be duplicate detections. Balanced is a provisional review profile, not an optimized/validated winner. No target jump count is used."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    ride = load_ride(args.recording)
    from pathlib import Path
    if Path(args.output).resolve() == ride.path:
        parser.error("Output cannot overwrite the recording.")
    report = run_sweep(ride)
    atomic_json(args.output, report)
    for profile in report["profiles"]:
        print(f"{profile['name']}: {profile['candidate_count']} candidates; {profile['unique_impact_crossings']} unique impact crossings")
