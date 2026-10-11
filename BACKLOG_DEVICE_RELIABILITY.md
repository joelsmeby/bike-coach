# Device Reliability — Implementation Status

## Implemented in source

- [x] Battery-only boot path does not wait for USB Serial.
- [x] BLE advertising begins from normal battery boot.
- [x] `INFO` reports battery voltage and estimated percentage.
- [x] Bike Coach 5.3 displays battery status.
- [x] Low / critical battery states are visually distinguished.
- [x] `POWER_OFF` command added.
- [x] Power-off path syncs/closes the active SD log before sleep.
- [x] IMU, SD, Qwiic, BLE and unused Apollo3 peripherals are shut down before deep sleep.
- [x] Physical RESET button is the intended wake/on mechanism.
- [x] Low-battery protection uses the same safe deep-sleep path.
- [x] Firmware source is now stored permanently in GitHub under `firmware/BikeCoach_Artemis_v0_2_6/`.

## Still requires physical-board verification

- [ ] Compile v0.2.6 with the installed Apollo3 / ArduinoBLE / SdFat / ICM-20948 versions.
- [ ] Flash OpenLog Artemis over USB.
- [ ] Disconnect USB and cold-start from LiPo using RESET.
- [ ] Confirm BLE discovery without ever reconnecting USB.
- [ ] Confirm displayed battery voltage against a multimeter and tune `VIN_CORRECTION` if needed.
- [ ] Confirm ride start / stop / download still works.
- [ ] Confirm disconnect / reconnect without USB.
- [ ] Confirm `Power Off Bike Coach` enters deep sleep.
- [ ] Measure standby current.
- [ ] Press RESET and confirm BLE advertises again.

## Release gate

Do not mark GitHub issue #1 complete until the physical-board checks above pass.
