# Historical release notes

Preserved from the local working folder during organization. These notes describe earlier release work and are not the current installation checklist. Use README.md at the project root and GitHub Releases for current instructions.

# Firmware 0.2.11: ±16 g, 250 Hz

The current sketch explicitly configures ±16 g acceleration and ±2000 dps rotation after default IMU startup. Logging targets 250 Hz. It advertises its transfer capabilities and works with the published Bike Coach 5.2.3 webpage. Upload `firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino` through Arduino; the top-level sketch copy is identical. Verify firmware 0.2.11 after reconnecting. Physical upload and measurement checks are still required.

# Web 5.2.3: fix ERR,PACKET_SIZE with firmware 0.2.9

Upload the contents of `BikeCoach_5_2_3_Download_Fix.zip` to the existing website, replacing the matching files. Reload Bluefy until the header reads 5.2.3, then disconnect and reconnect the board. Existing firmware 0.2.9 works with this web update; no reflash is required for this fix.

The webpage previously recognized the six-byte transfer protocol only through firmware 0.2.8. Firmware 0.2.9 was misidentified, causing an extra command argument and ERR,PACKET_SIZE. The corrected webpage selects the proper receiver, packet-size command, command staging and FILE_READY handshake for 0.2.9.

Optional firmware 0.2.10 explicitly advertises TRANSFER=LEGACY6 and FILES=1 so future versions can announce their capabilities. Both sketch copies are identical. The ±8 g accelerometer range, ±2000 dps gyro range and 250 Hz logging target are retained. Use the updated webpage with this firmware.

Validation: 15 focused JavaScript tests passed; a real headless browser with simulated 20-byte BLE completed downloads, SD rename, reconnect and CSV export against original 0.2.9. Firmware 0.2.10 compiled for RedBoard Artemis ATP (19% program storage, 11% RAM). Physical BLE/SD throughput still requires verification on the board.

# Firmware 0.2.9: ±8 g, 250 Hz

Upload `firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino` (the top-level sketch copy is identical). The board reports firmware 0.2.9. Accelerometer range is explicitly set to ±8 g after default initialization; gyro range is ±2000 dps. Failed range configuration stops startup with `FATAL,IMU_FULL_SCALE`.

Logging now targets one sample every 4 ms (250 Hz), with a flush every 250 rows. `output_Hz` remains the measured interval rate, so SD/BLE delays can reduce throughput. A 10-second recording should contain approximately 2,500 rows. RTC timestamps still have hundredth-second precision, so multiple samples can share a timestamp. Hardware verification and upload are still required.

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
