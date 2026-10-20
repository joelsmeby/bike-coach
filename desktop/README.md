# Bike Coach desktop jump workbench

A native, local analysis app for developing jump detection against ride recordings. It runs independently of chat, the phone webpage, and the bike. There is no server or data upload. Version 0.1 is an analysis workbench, not a physically validated jump detector.

## Open on Joel's Mac

The project-local Python environment is under `.local/desktop-venv/`. In Finder, open **desktop → dist → Bike Coach Workbench.app**. This is a native macOS launcher, not a shell script renamed as an app. After the first session is saved, the app reopens the last saved session on its next launch. Right-click its Dock icon → Options → Keep in Dock for quick access. **Open Bike Coach.command** remains available for troubleshooting.

On another Mac, install Python 3.12 or later and double-click **Setup Bike Coach.command** once. Setup installs the pinned runtime/build packages into an isolated project environment and uses py2app alias mode to generate the native launcher. Python 3.12 on macOS 14+ is the tested configuration. This launcher depends on this source checkout and environment; it is not a self-contained distributable application. Moving the checkout requires regenerating the launcher and environment. The builder preserves replaced launchers under `.local/launcher-backups/` and makes the former hidden app path point to the visible app. There is one canonical app bundle.

## Use it

1. **Open recording** loads a Bike Coach CSV. The header comment containing calibration is preserved as metadata. Acceleration is interpreted as mg and gyro as degrees/s. The CSV is never modified.
2. Select a candidate row to zoom. Drag the selection in the top overview to inspect any part of the ride. Load and gyro plots share the time axis. Vertical scales are fixed from the entire recording, with headroom for its largest signals; gyro is symmetric around zero. Mouse zoom and pan change time only, so heights remain comparable across intervals and filter changes. Right-click a plot for view options; click legend entries to hide/show curves.
3. **Save comparison run** before changing settings. The saved filtered load and candidate boundaries appear dashed purple. Switch between saved runs or restore their settings. Comparison settings are rerun under the current algorithm; original results and version remain in JSON.
4. Change the filter or detector controls. Detection reruns automatically. Median and moving-average windows are in samples; 3 samples is about 60 ms at 50 Hz, about 12 ms at 250 Hz. Butterworth cutoff is in Hz.
5. Select a candidate, then drag the orange handles to your estimated takeoff and touchdown. Add a note and choose **Confirm jump** or **Not a jump**. To mark a miss, navigate to it, drag the orange handles and choose **Mark missed jump**. Labels are independent of detector rows and survive filter changes. Overlapping labels must be removed before replacing them.
6. **Save session** once; further settings, labels and notes autosave after a pause. Save as creates an alternative experiment. Sessions default to `desktop/sessions/`, which Git ignores. Keep originals in backed-up private storage; local sessions also need backup.
7. Tell Codex the saved session path and the issue to investigate. The session stores source SHA-256, path, filter/detector settings, labels, snapshots, results, versions and notes. Codex can rerun it without operating the GUI.

If the recording moves, opening its session prompts you to locate the original. A matching SHA-256 is required so annotations cannot silently attach to a different recording. Labels can be selected and removed in **Your labels**. Video synchronization is not included in this version.

## What the marks mean

- Gray: raw acceleration magnitude. Teal: selected filtered magnitude. Purple dashed: comparison run.
- Teal bands: candidate unloading windows. Orange handles: the interval you are labeling.
- Green/red/amber labeled bands: confirmed jump / rejected interval / manually marked missed jump.
- Dashed horizontal line: core threshold; dotted line: expansion threshold.
- Triangles: first raw load crossing above the impact threshold within the search window. These are impact estimates, not proven first tire contact.
- Crosses: samples at the assumed acceleration rail. An asterisk by impact g means at least one sample in the event/search interval was range-flagged, not necessarily that the displayed crossing itself clipped.
- Window duration includes one nominal sample interval. It is an unloading estimate, not verified airtime. Speed and height are not inferred; the separate distance column uses the explicit constant-speed assumption.
- **Est. ft***: distance estimated from the candidate window and the editable **Distance estimate → Assumed speed** control (18 mph by default). At 18 mph, distance is 26.4 feet per second of candidate duration. Hover a distance for meters, speed and duration. This is an assumed-speed estimate, not measured airborne distance; GPS speed is not yet read. Changing the speed updates distances without changing detections. The speed and distances are included in saved sessions, comparison settings and headless analysis results. Older sessions default to 18 mph.

## Analysis and timing

The detector requires a sustained low-load core, expands it while filtered magnitude remains below the higher threshold, and optionally requires subsequent raw loading. It rejects windows that touch a recording/gap boundary and windows longer than the configured maximum. Multiple cores inside the same expanded window become one candidate. A low-load window is not sufficient evidence that both wheels left the ground.

Filters act on acceleration magnitude, not each axis. Centered median and mean filters use neighboring samples; a second-order Butterworth uses forward/backward filtering (effective order four, zero phase). These are offline methods that can change transition shapes. Butterworth first interpolates each continuous segment to an evenly spaced grid; filters never cross configured gaps. Very short segments stay unfiltered and are reported. Raw data remain available.

Firmware RTC timestamps may be rounded to hundredths of a second. At 250 Hz this creates repeated timestamps. The importer retains every row and distributes equal timestamps within their time bin, preserving larger gaps. These reconstructed times are estimates; the true per-sample jitter is unknown. Estimated rate uses the average continuous interval rather than the median of quantized intervals. **Override rate** assumes uniform sample timing and ignores RTC gaps. Timing cannot change after labels exist; use a fresh experiment to change the clock assumptions.

Sensor ranges are editable clipping assumptions. Opening a CSV with values on the ±2 g rails starts with ±2 g / ±250°/s; otherwise the defaults are ±16 g / ±2000°/s. This is a convenience heuristic, not proof of acquisition settings. Set the actual ranges for the recording being analyzed. The old Full_Share recording needs the old ranges even though the current device configuration is wider.

When calibration contains a valid orthonormal frame, gyro rates are projected onto saved bike forward/left/up axes after subtracting saved bias. Those channels are labeled roll/pitch/yaw rates. This is not a fused orientation estimate; otherwise the app displays device X/Y/Z rates.

Label matching uses one-to-one interval overlap (IoU ≥ 0.1). Counts describe coverage of the examples you labeled. Unmatched detections are unreviewed, not proven false positives; this is not overall accuracy. A comparison across different clock assumptions is disabled.

## Reproduce without opening the app

From this repository's root:

```sh
PYTHONPATH=desktop .local/desktop-venv/bin/python -m bike_workbench /path/to/ride.csv --analyze
PYTHONPATH=desktop .local/desktop-venv/bin/python -m bike_workbench /path/to/session.json --analyze --output .local/review.json
PYTHONPATH=desktop .local/desktop-venv/bin/python -m bike_workbench /path/to/session.json --analyze --recording /new/path/to/original.csv
```

`--settings /path/to/settings.json` uses a JSON object containing `Settings` fields; omitted fields take defaults. GUI sessions always recompute under current code. If the saved detector version differs, the GUI preserves the imported previous results in a comparison snapshot before saving.

## Verify

```sh
PYTHONPATH=desktop .local/desktop-venv/bin/python -m unittest discover -s desktop/tests -v
```

Tests cover signal filtering, candidate selection, no-impact intervals, gaps, clipping assumptions, repeated 250 Hz timestamps, date rollover, session fingerprint checking/relocation, labeling, comparison runs, save/reopen and invalid-setting protection. Fixtures are generated synthetic recordings, not personal rides. GUI checks use Qt's offscreen platform and do not establish physical riding accuracy.

The app needs a running desktop session for normal use. Errors from the app launcher are logged under `.local/desktop-workbench.log`. Code lives in `bike_workbench/analysis.py`, `session.py` and `app.py`; the analysis engine has no GUI dependency and can be reused later.

## Compare detection sensitivity

`PYTHONPATH=desktop .local/desktop-venv/bin/python -m bike_workbench.sweep /path/to/ride.csv --output .local/sensitivity.json` compares 216 nearby settings across median and moving-average filters. The report includes original, balanced and sensitive review profiles, candidate overlap across settings, and flags for multiple candidates pointing to the same impact crossing. Parameter support is a sensitivity measure, not a probability that an event is a jump. No target count is used and no profile is claimed to be most accurate without confirmed labels. At 250 Hz, select filter windows in samples deliberately; a 3-sample window has a different physical duration than in the old 50 Hz recording. The GUI flags shared impact crossings in the Review column and shows their distinct count. **Full ride** also restores hidden primary curves and the fixed vertical scales if a plot appears blank.
