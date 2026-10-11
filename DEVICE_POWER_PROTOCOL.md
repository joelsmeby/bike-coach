# Bike Coach device power protocol

Firmware v0.2.6 adds battery status and intentional deep sleep while preserving the existing Bike Coach BLE UUIDs.

## INFO additions

`INFO` continues to reply on status characteristic `1002` with a `BIKECOACH,...` record. v0.2.6 adds:

- `VBAT=<millivolts>` — measured OpenLog Artemis VIN/LiPo voltage.
- `BAT=<percent>` — approximate LiPo state of charge derived from voltage.

Example:

`BIKECOACH,FW=0.2.6,STATE=IDLE,FILE=ride0042.CSV,GPS=1,TRANSFER=LEGACY6,VBAT=3975,BAT=81`

The app may refresh `INFO` periodically while connected.

## POWER_OFF

Command characteristic `1001` accepts:

`POWER_OFF`

Behavior:

1. Reject while a BLE file transfer is active.
2. If logging, sync and close the SD recording.
3. Send `POWERING_OFF` on status characteristic `1002`.
4. Stop BLE advertising / BLE stack.
5. Power down IMU, SD and unused rails.
6. Enter Apollo3 deep sleep indefinitely.
7. Wake by pressing the physical RESET button on the OpenLog Artemis.

The reset button therefore functions as the physical **wake/on** control. The app's **Power Off Bike Coach** command is the normal off control.

## Low battery

After repeated readings below 3.40 V, firmware enters the same safe power-off path after sending `LOW_BATTERY,POWERING_OFF`.

## Design intent

The device should not require USB for normal operation. A cold boot/reset with LiPo power present should proceed directly to BLE initialization and advertising. USB is only required for flashing/debugging/charging workflows, not to make BLE appear.
