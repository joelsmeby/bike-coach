# Bike Coach device power protocol

Current source: firmware 0.2.12 / web 5.2.4. Earlier 0.2.6 power documentation described behavior that was absent from 0.2.11. Compilation, deployment, upload and physical validation are separate facts.

## Wake and startup

With a charged LiPo connected, press physical RESET to restart/wake the OpenLog Artemis. No USB connection is required. Power LED is enabled, STAT briefly acknowledges boot, Bluetooth advertises BikeCoach and the device stays idle until START_RIDE. Battery reconnection alone is not a guaranteed reset because the onboard backup battery can retain sleep state. RESET during recording can lose unsaved data; normally STOP_RIDE first.

Bluetooth starts independently of SD/IMU initialization success. INFO returns a stored full response on characteristic 1002 (read it after a shortened notification):

`BIKECOACH,FW=0.2.12,TRANSFER=LEGACY6,FILES=1,POWER_OFF=1,STATE=IDLE,SD=1,IMU=1,FAULT=NONE,FILE=`

Faults use STATE=FAULT plus SD/IMU readiness and FAULT=SD_INIT, IMU_INIT, IMU_STARTUP or IMU_RANGE. If both fail, FAULT names the SD failure and both readiness fields remain zero. Recording is blocked when either component is unavailable. Missing SD blocks file operations; an IMU fault alone does not block downloads. The phone displays the startup fault. STAT flashes briefly once per second while a startup fault persists. RESET retries initialization. BLE initialization failure is visible through STAT/Serial and is retried every five seconds; Bluetooth cannot report its own inability to initialize.

## Battery reading

Read characteristic 1004: `POWER,<millivolts>`. VIN is sampled every two seconds, including during transfers. The shared VIN rail reports external power while USB is present; it cannot reveal the battery's actual voltage or charging completion then. Percent is a voltage estimate in the frontend. Measurement calibration must be checked against a multimeter.

## POWER_OFF

Command characteristic 1001 accepts POWER_OFF only as an implemented capability when INFO includes POWER_OFF=1. The phone disables its button on older firmware, during busy operations or while recording (stop first).

Firmware rejects manual POWER_OFF during a transfer with ERR,TRANSFER_ACTIVE. Otherwise it syncs and closes an active log; a failed sync or close reports ERR,SD_SYNC or ERR,SD_CLOSE and leaves the device awake. After successful closure it reports POWERING_OFF, allows a brief notification interval, stops BLE and powers down SD/IMU/Qwiic, GPIO pads, LEDs and unused peripherals. Apollo3 enters deep sleep with RTC retained, until hardware RESET. Pending SD internal writes receive a delay before the rail is disabled. Sleep does not erase recordings. Charging can continue from USB independently of firmware sleep.

## Low battery

Three consecutive valid VIN readings below 3400 mV trigger automatic shutdown, approximately six seconds of sustained low readings. A healthy/external-power or invalid reading resets the count; readings outside the plausible ADC range are not treated as a calibrated low battery. Low battery cancels a read-only transfer, safely closes an active log and then reports LOW_BATTERY,POWERING_OFF before sleeping. A sync/close error aborts shutdown and will be retried on the next low reading. A valid low reading also blocks START_RIDE with ERR,LOW_BATTERY. This does not guarantee recovery from sudden power loss or a hardware fault.

## Required physical checks

Confirm startup/repeated RESET on battery, BLE reconnect, fault reporting, manual sleep/wake, ADC accuracy and low-battery behavior under controlled supply, transfer cancellation, recording integrity and measured sleep current. Do not infer sleep current or reliable wake from a successful compile or simulated test.
