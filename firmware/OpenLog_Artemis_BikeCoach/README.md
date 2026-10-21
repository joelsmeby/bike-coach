# Bike Coach firmware 0.2.12

Open `OpenLog_Artemis_BikeCoach.ino` in Arduino IDE and upload with SparkFun Apollo3 > RedBoard Artemis ATP selected. Use the pinned `bikecoach` profile in `sketch.yaml` (Apollo3 core 2.2.1).

- Battery-powered RESET restarts setup, enables the power LED, briefly lights STAT and advertises BikeCoach. No USB Serial connection is awaited. Starts idle; only Start Ride records.
- SD/IMU startup failures remain visible through Bluetooth INFO and a repeating brief STAT flash. Recording is blocked; available SD downloads remain usable when only the IMU failed. Check the hardware and press RESET to retry. SD and IMU each receive up to two initialization attempts; a failed BLE initialization is retried every five seconds.
- Web 5.2.4 provides Power off, enabled only when INFO advertises POWER_OFF=1. Stop recording first in the phone UI. Firmware also supports safely closing an active log on POWER_OFF; rejects manual power-off during a transfer.
- Safe shutdown syncs/closes the log before turning off BLE, IMU/SD/Qwiic rails, LEDs and unused peripherals, then enters deep sleep until physical RESET. A reported sync/close failure aborts shutdown instead of claiming a save succeeded.
- Three consecutive valid VIN readings below 3.40 V, sampled every two seconds, initiate the same shutdown and cancel any read-only transfer. A low reading also blocks starting another recording. USB masks battery voltage on this shared input. This is supplemental protection, not a substitute for the battery protection circuit.
- Accelerometer ±16 g; gyroscope ±2000 dps; target 250 Hz (4 ms). CSV and TRANSFER=LEGACY6/FILES=1 remain compatible. RTC timestamps retain hundredth-second precision.

## Validation boundaries

Build and automated simulation evidence is recorded with the PR and in Notion. This source has not yet been uploaded or physically validated. Confirm battery-only RESET, connect/reconnect, safe sleep/wake, SD file integrity, ADC accuracy/cutoff and actual sleep current on the red OpenLog Artemis v1.0 / DEV-16832. This is not a promise of a particular battery runtime.

Manufacturer reference: [SparkFun sleep implementation](https://github.com/sparkfun/OpenLog_Artemis/blob/main/Firmware/OpenLog_Artemis/lowerPower.ino). Hardware RESET restarts firmware; removing the external battery alone may leave state retained by the RTC backup battery. Do not press RESET during recording as a substitute for stopping/saving first.
