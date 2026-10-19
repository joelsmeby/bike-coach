# Bike Coach Artemis v0.2.6

This is the first Bike Coach firmware version stored permanently in the GitHub repository.

## What changed

- BLE starts during normal setup without waiting for USB Serial.
- `INFO` reports `VBAT=<millivolts>` and `BAT=<percent>`.
- `POWER_OFF` safely closes the active recording, stops BLE and sensors, powers down the SD/IMU/Qwiic rails, and enters Apollo3 deep sleep.
- The physical **RESET** button is the intended wake mechanism.
- Low battery protection enters the same safe deep-sleep path after repeated readings below 3.40 V.
- Accelerometer range is configured to ±16 g and gyro to ±2000 dps for MTB use.
- Existing Bike Coach service UUIDs and v0.2.x six-byte file-transfer framing are retained.
- SD recording listing and selected-file transfer are retained.

## Required libraries / target

- SparkFun Apollo3 Arduino core
- Board target: **SparkFun Apollo3 / RedBoard Artemis ATP**
- ArduinoBLE
- SdFat v2.x
- SparkFun ICM-20948 Arduino Library

Target hardware is the red V10 SparkFun OpenLog Artemis DEV-16832.

## First hardware test

Do not start with a real ride. Use the following bench sequence:

1. Flash v0.2.6 over USB.
2. Disconnect USB completely while leaving the LiPo connected.
3. Press RESET once.
4. From the Bike Coach 5.3 page, confirm `BikeCoach` appears in the Bluetooth picker without reconnecting USB.
5. Connect and confirm the page shows battery percentage and voltage.
6. Start a short 10-second recording, stop it, download it, and open analysis.
7. Disconnect/reconnect Bluetooth without USB and confirm it works.
8. Tap **Power Off Bike Coach**.
9. Confirm BLE disappears and current draw drops substantially.
10. Press RESET and confirm BLE advertises again without USB.

## Battery calibration

The firmware currently uses SparkFun's default V10 VIN correction factor of `1.47` for the high-impedance battery divider. Compare the displayed voltage with a multimeter across the battery connector. If it differs materially, adjust `VIN_CORRECTION` before treating battery percentage as calibrated.

Battery percentage is a voltage-based approximation, not coulomb counting, so it will move somewhat with load and temperature.

## Verification status

The code has been protocol-reviewed against the current Bike Coach web app and SparkFun's OpenLog Artemis power-management implementation. It has **not yet been compiled or exercised on the physical board** in this repository workflow. The bench test above is required before marking GitHub issue #1 complete.
