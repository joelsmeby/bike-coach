# SD recording browser protocol

The saved Artemis firmware source is v0.2.4, which writes CSV recordings and sends six-byte sequence/offset headers in BLE notifications. The newer webpage also has a separate BCB1 binary and ACK/CRC32 path. The webpage selects the legacy receiver for `FW=0.2.4`, `FW=0.2.5` and `FW=0.2.6`; other versions retain the BCB1 receiver. The v0.2.6 sketch extends the saved CSV source.

Add two commands to the firmware currently installed on the board:

| Command written to characteristic 1001 | Status on characteristic 1002 | Behavior |
| --- | --- | --- |
| `LIST_FILES,<index>` | `FILE,<index>,<total>,<name>,<size>` | Return one root-level recording at zero-based index. Count only supported `.BIN`, `.TXT`, `.CSV` names. Use a deterministic ordering across all calls while no files change. |
| `LIST_FILES,<total>` | `FILES_END,<total>` | Signal that the list is complete. |
| `GET_FILE,<name>` | Existing `FILE_BEGIN,<name>,<bytes>` and `FILE_END,<name>,<bytes>,CHUNKS=<count>` statuses | Validate a root-level filename, open it read-only, and send it through the **same** six-byte sequence/offset chunks as v0.2.4 `GET_LATEST`. |

The page loads recordings in batches of 50, and the file parser allows safe names of up to 24 characters. Each listing reply fits into the 180-byte status characteristic, but a notification may be limited to 20 bytes. The notification signals readiness; the page reads the full characteristic before parsing the response or issuing another command. This applies even when a truncated size looks like a valid number. `GET_FILE` rejects path separators, missing files, unsupported formats, or active logging. Listing does not alter the SD card. `GET_LATEST` still works for bike setup and the latest ride.

The downloaded recording remains on the board's SD card. `.BIN` recordings use the existing BCB1 decoder; `.TXT` and `.CSV` files must contain the Artemis sensor CSV header. The page holds only one transferred ride in Bluefy at a time; the user must explicitly select **Save CSV to Files** or **Save original to Files** before transferring a different ride. iOS share-sheet support depends on the browser; the page falls back to a browser download and reports that distinction.

The legacy transfer checks every chunk's sequence number and byte offset, the total byte count, and the final chunk count. The v0.2.x transport has no CRC or retransmission; missing chunks fail the transfer, which the user can retry. v0.2.5 was compiled and uploaded by the user; v0.2.6 and the new webpage changes still require hardware testing, including actual selected-file transfer under the phone's negotiated packet size.
