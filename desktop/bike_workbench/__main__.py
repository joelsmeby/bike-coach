"""GUI launcher and headless, reproducible experiment runner."""
import argparse
import json
from pathlib import Path

from .analysis import Settings, analyze, evaluate, load_ride, ALGORITHM_VERSION, algorithm_fingerprint
from .session import atomic_json, read_session


def main():
    parser = argparse.ArgumentParser(description="Bike Coach desktop jump workbench")
    parser.add_argument("recording", nargs="?", help="Bike Coach CSV or saved .bike-session.json")
    parser.add_argument("--analyze", action="store_true", help="Run without a GUI")
    parser.add_argument("--recording", dest="override", help="Relocate the source CSV for a session")
    parser.add_argument("--output", help="Write analysis JSON")
    parser.add_argument("--settings", help="JSON file containing Settings fields")
    args = parser.parse_args()
    if args.analyze:
        if not args.recording:
            parser.error("--analyze needs a CSV or session")
        try:
            if args.recording.endswith(".json"):
                saved, ride, settings, result = read_session(args.recording, args.override)
                labels = saved.get("labels", [])
            else:
                ride = load_ride(args.recording)
                settings = Settings()
                labels = []
            if args.settings:
                settings = Settings(**json.loads(Path(args.settings).read_text()))
            result = analyze(ride, settings)
            from dataclasses import asdict
            report = {"algorithm_version": ALGORITHM_VERSION, "analysis_sha256": algorithm_fingerprint(), "recording_sha256": ride.sha256,
                      "settings": asdict(settings), "events": result["events"], "warnings": result["warnings"],
                      "sample_hz": result["sample_hz"], "evaluation": evaluate(result["events"], labels)}
            if args.output:
                if Path(args.output).resolve() in {ride.path, Path(args.recording).resolve()}:
                    raise ValueError("Output must not overwrite the original recording or input session.")
                atomic_json(args.output, report)
            else:
                print(json.dumps(report, indent=2, allow_nan=False))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            parser.exit(1, f"Analysis failed: {exc}\n")
    else:
        from .app import run
        run(args.recording)


if __name__ == "__main__":
    main()
