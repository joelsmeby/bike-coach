# Bike Coach firmware 0.2.11

Open `OpenLog_Artemis_BikeCoach.ino` in Arduino IDE and upload with the RedBoard Artemis ATP board selected.

- Accelerometer: ±16 g, explicitly configured after default IMU startup.
- Gyroscope: ±2000 dps.
- Logging target: 250 Hz (4 ms interval); actual rate is recorded in output_Hz.
- Web compatibility: Bike Coach 5.2.3; reports TRANSFER=LEGACY6 and FILES=1.

Compiled successfully with SparkFun Apollo3 core 2.2.1. Program storage: 19%; global RAM: 11%. Hardware upload and recording verification are still required. RTC timestamps retain hundredth-second precision.
