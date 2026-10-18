# Bike Coach 5.2.1: restored phone GPS

This restores the phone GPS workflow removed by commit 3f86c24 while retaining the current recording names, file transfers, calibration and charts.

## Installing the webpage

Replace the webpage files together with this release and reload the page in Bluefy. Confirm the header says **5.2.1** and the page shows GPS status. No firmware update is required for the current 0.2.8 recording workflow. Keep existing browser data so saved bike profiles and GPS backups remain available.

## Recording

GPS starts automatically for normal and guided rides. Allow location access, carry the phone, and keep Bluefy visible with the screen on. The page requests a screen wake lock where supported. Check the GPS fix count before riding; denied permission or unavailable fixes are reported explicitly. Sensor recording may continue without a usable location fix.

Stop the ride, download it, and choose **Save CSV to Files**. The export includes `# BikeCoachGPS=` with timestamped latitude, longitude, accuracy, speed and available altitude/heading. `# BikeCoachRide=` identifies the associated ride. Raw sensor bytes remain unchanged. **Save GPS backup to Files** saves a separate JSON track. The analyzer displays the route and its GPS quality and can export the ride with GPS intact.

Firmware advertising GPS timing support uses its original clock synchronization and persistent ride ID. Other firmware uses an approximate phone timestamp around the start command, with timing uncertainty recorded in the track. For this compatibility mode, start, stop and download the ride in the same Bluetooth/page session. Filename and duration must match; disconnects or reloads invalidate this temporary association to prevent attaching GPS to a different recording. A completed downloaded ride retains its GPS after reload and renaming. Separate GPS backups remain stored on the phone, but old sensor-only files cannot acquire missing GPS retroactively.

## Validation

- 18 unit checks cover capture, persistence, permission denial, start failure, native ride IDs, CSV round trips, legacy association, mismatched recordings, disconnects and existing file/graph behavior.
- A headless Chrome workflow with simulated Artemis 0.2.8 and location fixes checks automatic GPS capture, stop/download, CSV coordinates, raw byte preservation, reload, analyzer route/export, long filenames, rename collisions and 20-byte Bluetooth transfers.
- Physical Artemis/iPhone/Bluefy validation remains necessary. Background/locked-screen GPS is not guaranteed.
- The repository's existing firmware command test cannot run because its target `firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino` is missing from the current repository. This release changes no firmware.
