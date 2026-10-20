# Bike Coach desktop jump workbench

A native, local analysis app for developing jump detection against ride recordings. It runs independently of chat, the phone webpage, and the bike. There is no server or data upload. Version 0.2 is an analysis workbench, not a physically validated jump detector.

## Open on Joel's Mac

The project-local Python environment is under `.local/desktop-venv/`. In Finder, open **desktop → dist → Bike Coach Workbench.app**. This is a native macOS launcher, not a shell script renamed as an app. After the first session is saved, the app reopens the last saved session on its next launch. Right-click its Dock icon → Options → Keep in Dock for quick access. **Open Bike Coach.command** remains available for troubleshooting.

On another Mac, install Python 3.12 or later and double-click **Setup Bike Coach.command** once. Setup installs the pinned runtime/build packages into an isolated project environment and uses py2app alias mode to generate the native launcher. Python 3.12 on macOS 14+ is the tested configuration. This launcher depends on this source checkout and environment; it is not a self-contained distributable application. Moving the checkout requires regenerating the launcher and environment. The builder preserves replaced launchers under `.local/launcher-backups/` and makes the former hidden app path point to the visible app. There is one canonical app bundle.

## Use it

1. **Open recording** loads a Bike Coach CSV. The header comment containing calibration is preserved as metadata. Acceleration is interpreted as mg and gyro as degrees/s. The CSV is never modified.
2. Select a candidate row to zoom. Drag the selection in the top overview to inspect any part of the ride. Load and gyro plots share the time axis. Load uses fixed full-recording bounds. Rotation and gyro vibration now have separate plots and fixed editable scales: initially ±100°/s for rotation and 0–50°/s for vibration. Mouse zoom and pan change time only, so heights remain comparable across intervals and filter changes. Right-click a plot for view options; click legend entries to hide/show curves.
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
- Window duration includes one nominal sample interval. It is an unloading estimate, not verified airtime. Height and takeoff angle are not inferred. Horizontal distance uses GPS speed when usable, with explicit fallbacks.
- **Est. ft***: horizontal distance over the candidate window, not verified airborne distance. **Distance source** identifies GPS integration, GPS approach speed held constant, or the editable assumed horizontal speed (18 mph default). Hover for reasons and quality. Distance changes do not change detection. Horizontal speed needs no cosine correction; it already excludes vertical motion. Reported GPS speed is used directly, not calculated by differencing noisy coordinates.

## Analysis and timing

The detector requires a sustained low-load core and expands it while filtered magnitude remains below the higher threshold. Nearby windows are then joined when their separation is at most **Join gaps up to** (default 0.20 s) and there is no sustained support-level loading between them. Sustained support means filtered load at least the higher of 0.8 g and the expansion threshold for **Landing hold** (default 0.08 s). Set the join gap to zero to disable joining. This is a heuristic for split flights, not proof of contact; it can still merge genuinely separate short hops.

After joining, the detector optionally requires subsequent raw loading after the final window. It rejects intervals touching recording/gap boundaries and intervals longer than the configured maximum; it never joins across missing-data gaps. Joined intervals retain all low-load cores, report how many windows were joined in the Review column, and recalculate duration, final impact and distance across the full interval, including the interruption. A low-load window is not sufficient evidence that both wheels left the ground, and the final impact crossing is still an estimate of touchdown.

Filters act on acceleration magnitude, not each axis. Centered median and mean filters use neighboring samples; a second-order Butterworth uses forward/backward filtering (effective order four, zero phase). These are offline methods that can change transition shapes. Butterworth first interpolates each continuous segment to an evenly spaced grid; filters never cross configured gaps. Very short segments stay unfiltered and are reported. Raw data remain available.

Firmware RTC timestamps may be rounded to hundredths of a second. At 250 Hz this creates repeated timestamps. The importer retains every row and distributes equal timestamps within their time bin, preserving larger gaps. These reconstructed times are estimates; the true per-sample jitter is unknown. Estimated rate uses the average continuous interval rather than the median of quantized intervals. **Override rate** assumes uniform sample timing and ignores RTC gaps. Timing cannot change after labels exist; use a fresh experiment to change the clock assumptions.

Sensor ranges are editable clipping assumptions. Opening a CSV with values on the ±2 g rails starts with ±2 g / ±250°/s; otherwise the defaults are ±16 g / ±2000°/s. This is a convenience heuristic, not proof of acquisition settings. Set the actual ranges for the recording being analyzed. The old Full_Share recording needs the old ranges even though the current device configuration is wider.

When calibration contains a valid orthonormal frame, gyro rates are projected onto saved bike forward/left/up axes after subtracting saved bias. Those channels are labeled roll/pitch/yaw rates. This is not a fused orientation estimate; otherwise the app displays device X/Y/Z rates.

Label matching uses one-to-one interval overlap (IoU ≥ 0.1). Counts describe coverage of the examples you labeled. Unmatched detections are unreviewed, not proven false positives; this is not overall accuracy. A comparison across different clock assumptions is disabled.

## Fixed gyro view ranges

At the top of the sidebar, **Fixed gyro chart scales** sets the rotation half-range and vibration maximum independently. These are display ranges, separate from sensor clipping ranges. Zooming, panning, filtering and **Full ride** preserve the chosen vertical bounds. **Fit visible gyro once** fits both gyro plots to the current visible time interval with 10% headroom, then locks the resulting bounds; **Fit full recording once** fits the entire recording. The panel reports samples outside the chosen display ranges so a tight view cannot silently suggest those values are absent. Source values are retained.

Chart ranges save/autosave with the session under `chart_scales`. Older sessions start at ±100°/s and 0–50°/s; use fit or enter different bounds when needed. The vibration chart has its own positive Y axis so its smaller values remain visible beside larger rotation rates. The app header shows v0.2.0 to identify this interface update. Save, fully quit and reopen the app to load new source; opening an already-running app again does not reload its Python modules.

## Gyro support for takeoff and landing

**Gyro support** adds supporting evidence without changing candidate counts, boundaries, joining, impact selection or distances. The default uses all three device gyro axes, making the vibration measure independent of mounting direction. **Bike pitch only** requires a valid saved bike frame; an unavailable frame does not silently substitute a device axis. This measures rotation-rate vibration, not pitch angle.

A separate yellow **Gyro vibration** chart shows local RMS (root mean square: typical fluctuation size) after removing slower rotation with a centered linear trend. The default trend window is about 0.12 s, followed by a 0.06 s RMS window; each is rounded to odd sample counts with minimum 5/3 samples. Processing uses an evenly spaced grid inside each continuous segment. Recording edges, gaps and filter neighborhoods touching gyro clipping remain unavailable. At less than 20 Hz or with too few samples, evidence is unavailable. Like the load filters, this offline method uses neighboring samples and blurs transition timing.

For each candidate, compare vibration inside the window to separate 0.30 s trail intervals before and after it, excluding filter transition margins. **Flight/trail ratio ≤ 0.65** marks a boundary as supported when flight vibration is at least 35% lower. Context below **Min. trail vibration** (default 1°/s) is inconclusive: a quiet trail cannot establish flight. Overall score is the smaller of the two percentage reductions, clipped to 0–100. **Supports** requires both boundaries; **mixed** means one passes; **partial** means only one boundary could be assessed; **unavailable** means neither can be assessed. Low scores are not evidence that a candidate is false. These are heuristics, not jump probabilities.

Hover **Gyro support** in the candidate table for takeoff/landing scores, vibration values and missing-data reasons. **Data & timing** and saved session events retain the evidence; settings and comparison runs preserve the controls. Turn evidence **Off** for an acceleration-only review. Existing sessions acquire the defaults when reopened and preserve previous results through the algorithm-change comparison mechanism. Validate against confirmed jumps/video before using gyro support as a required condition or to move takeoff/landing boundaries.

## GPS distance and jump catalog

The importer reads the phone recorder's matching `# BikeCoachRide=` and `# BikeCoachGPS=` metadata, including board/phone clock synchronization. **GPS when usable** is the default. It integrates reported horizontal speed over the candidate window using linear interpolation between fixes. Default limits are 0.25 s synchronization uncertainty, 1.5 s between fixes, 1 s at either boundary and 20 m reported position uncertainty. These are adjustable screening rules, not guarantees of velocity accuracy. Sparse readings are labeled; interpolation cannot reconstruct instantaneous takeoff speed. If full coverage fails, a recent median approach speed is used when available; otherwise the assumed horizontal speed is explicit. Missing speed, poor fixes, segment changes and long gaps cannot be silently bridged. A uniform sample-rate override disables GPS alignment. **Data & timing** reports cadence and synchronization; each result's `distance_evidence` preserves reasons. Browser position accuracy is not speed accuracy. Timing is approximate relative to the first IMU sample, and unmeasured clock drift may add error.

In **Jump catalog**, select a candidate or adjust the orange interval, enter trail/jump names, and click **Save catalog entry**. The private shared catalog defaults to `desktop/sessions/jump-catalog.json`. Entries preserve recording hash, selected interval and a nearby GPS fix when usable; that fix is not a surveyed takeoff location. Select a catalog row to edit it, or choose **New entry from orange selection** for another observation. Catalog saves are explicit and separate from session autosave; sessions also include a snapshot of entries referencing that recording. Back up the catalog with sessions and originals.

Ramp geometry, bike pitch at takeoff and flight direction are independent optional fields, signed relative to horizontal. Check a field to enter a measured/estimated angle and describe its basis in measurement notes; unchecked means unknown. Bike pitch can support a takeoff-angle estimate after mounting calibration and validation, but suspension movement, rider input and bike rotation can separate pitch from ramp/trajectory angle. The current workbench plots angular velocity and does not automatically calculate absolute pitch. Calibrated orientation estimation and comparison against measured ramps/video remain future work. No angle field automatically changes horizontal-distance estimates.

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
