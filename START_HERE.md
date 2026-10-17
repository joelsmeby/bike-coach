# Bike Coach 5.2 with Artemis firmware 0.2.8

Update both parts together: upload `firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino` through Arduino, and upload the webpage files from this package to the existing website. Keep the directory structure. Reload Bluefy and reconnect; check that the header says **5.2** and the firmware line says **0.2.8**. This package has not been published by this session.

## Name a trail recording

1. Stop recording and tap **List SD card recordings**.
2. Tap **Rename** beside a file. Enter a trail and run, such as `Family Man Run 1`.
3. Check the filename preview and tap **Rename**. The actual SD file becomes `Family_Man_Run_1.TXT`; its contents are preserved.
4. Transfer the recording and save it to Files. **Save CSV to Files** uses the same name with `.csv`.

Names support up to 60 letters/numbers/underscores/hyphens before the extension. Spaces become underscores and accents are simplified. The extension stays locked. Existing names are never overwritten; add a run number or date for repeated trails. Renaming is blocked during recording or transfer. Previously exported copies in the iPhone Files app keep their old names.

**Rename downloaded copy** changes the name used in Bluefy and future exports without changing the SD filename. Bike calibration, training labels, recording identity and raw downloaded bytes are preserved. Renaming on the SD card also updates a matching downloaded recording and the explicitly tracked pending ride. It does not infer calibration for unrelated historical files.

## Other changes

- Search the loaded SD list by trail name or filename. Load more before searching additional recordings.
- Connection, recording and battery state are displayed separately. Recording state is unknown while disconnected; the blue STAT LED indicates recording.
- Charts include zero in their vertical range, so the zero reference line stays visible even when all readings have the same sign.
- Chart labels preserve fractional tick steps such as 2.5 and 0.25 without misleading rounding.
- Long BLE commands use acknowledged small writes. Transfers wait until the page has read the full filename and size, and the smaller-packets option works with firmware 0.2.8.
- The board still starts idle. Neural-network work is on hold; the two-ride KNN model remains unchanged.

## Validation

Automated checks cover naming, locked extensions, metadata preservation, command chunking, sequence wraparound and chart bounds. Host C++ tests exercise the actual firmware rename/command functions with simulated storage and BLE. A real headless-browser test with simulated 20-byte BLE covers connect, listing, long-name SD rename, duplicate rejection, transfer, downloaded-copy rename, CSV export, mobile layout and disconnect.

Firmware 0.2.8 compiled successfully for RedBoard Artemis ATP with SparkFun Apollo3 core 2.2.1, SdFat 2.2.3, ArduinoBLE 1.4.1 and SparkFun ICM-20948 1.3.2. Program storage: 19%. Global RAM: 11%.

These are not physical SD-card or iPhone/Bluefy tests. Verify cold battery-only startup, battery voltage, rename/reconnect behavior and a full real ride transfer on the board. The outstanding battery-only BLE startup issue is not claimed fixed by this release.
