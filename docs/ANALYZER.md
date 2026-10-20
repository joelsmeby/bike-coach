# Shared web and desktop analysis

`analysis-engine.mjs` is the single production implementation for CSV/RTC import, calibration-aware gyro evidence, load filters, jump detection/refinement, GPS distance checks and height/distance metrics. The browser imports it directly. Desktop `shared_engine.py` calls the same module through PySide6's QJSEngine, already included in the desktop runtime. There is no added server, Node installation or browser download for desktop use. Its wrapper creates an offscreen QApplication for CLI analysis when no GUI exists. Analysis must run on the application's Qt thread.

`jump-analysis.mjs` is a compatibility adapter, not an independent detector. Python `Settings` remains a typed UI/session schema; parity checks enforce that its fields/defaults match `DEFAULT_SETTINGS`. The engine hash is stored in desktop sessions. Both interfaces display `shared-motion/2.0.0` and exchange `{algorithm_version, settings}` JSON; the desktop also accepts raw settings and the web can import the settings from a desktop session. Exporting settings does not transfer private recordings, annotations or catalogs.

## Use

Open `analyzer.html` through the existing website or a local HTTP server. Load a downloaded recording, select acceleration + gyro or acceleration only, and adjust the small set of filter/load controls. Imported advanced settings are retained even when they are not exposed as individual web controls. Settings persist in browser-local storage. Sensor assumptions and Butterworth cutoff are under Recording ranges and filter cutoff. The automatic range assumption matches the desktop and is not proof of device configuration.

Three main charts show raw/filtered load, rotation and vibration. Rotation/vibration bounds are fixed input values; Fit visible gyro once changes them once. More signals preserves the acceleration axes, magnetometer and integrated angle views. Hide jump table collapses candidate results. Tap a row to focus the charts. Activity-labeling and GPS-route features remain available. Live serial recording remains available, but jump analysis targets completed downloaded files, not an unvalidated live detector.

The same original CSV, full settings and engine version produce equivalent analysis on both platforms. This does not synchronize files or instantly upgrade an already-running desktop app/cached browser tab. Restart desktop after source updates and reload the webpage after deploying all assets together. Compare the displayed engine version and exchange settings to reproduce an experiment.

## Metric assumptions

- Candidate duration includes one nominal sample interval; it is not verified airtime.
- Height is `g × duration² / 8`, using g = 9.80665 m/s². This assumes ideal ballistic flight and equal takeoff/landing elevation. It is an estimate, unsuitable as measured height for step-downs/step-ups without further information.
- Horizontal distance integrates reported GPS horizontal speed only when matching ride identity, synchronization, coverage and fix quality pass shared checks. Sparse interpolation, approach-speed extrapolation and assumed-speed fallbacks have distinct evidence/source labels. Assumed speed defaults to 18 mph; it is explicitly horizontal. Coordinates are not differenced to invent high-rate speed.
- Gyro support and timing adjustments are heuristic. Clipping, gaps, low context vibration and missing calibration cause conservative fallbacks. Gyro rates and integrated rotation do not establish takeoff/ramp angle.

## Verification and maintenance

```sh
PYTHONPATH=desktop .local/desktop-venv/bin/python -m unittest discover -s desktop/tests -v
node --test analysis-engine.test.mjs
BIKECOACH_PYTHON=.local/desktop-venv/bin/python node scripts/check-analysis-parity.mjs
pnpm test:browser
```

The desktop workflow watches the shared module, analyzer and desktop changes. It runs Python regression tests, Node tests and `scripts/check-analysis-parity.mjs` against 19 generated cases: 50/250 Hz, quantized RTC, filtering, gyro joins/refinement, clipping/gaps, pitch calibration, and dense/sparse/missing/bad-sync GPS. It checks defaults, import timing, full filtered/vibration arrays, every event and metric across Qt and Node. Browser tests exercise actual UI output, settings import/export, GPS source labels, collapse and mobile layout. Fixtures contain synthetic data only.

Change algorithms and metrics in the shared module; do not add platform-specific calculation paths. Update `ENGINE_VERSION` and the Python version constant together, extend regression/parity cases, and deploy the entire web asset set together. Interfaces may offer different editing tools, but must retain imported settings and identify assumptions. Tests demonstrate software agreement, not physical measurement accuracy.
