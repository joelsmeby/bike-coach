# SD recording browser protocol

The saved Artemis firmware source is v0.2.4, which writes CSV recordings and sends six-byte sequence/offset headers in BLE notifications. The newer webpage also has a separate BCB1 binary and ACK/CRC32 path. The webpage selects the legacy receiver for `FW=0.2.4` through `FW=0.2.8`; other versions retain the BCB1 receiver. Firmware v0.2.8 must be paired with frontend 5.2 for transfer-ready and long-command support. It starts idle until an explicit recording command.

Add two commands to the firmware currently installed on the board:

| Command written to characteristic 1001 | Status on characteristic 1002 | Behavior |
| --- | --- | --- |
| `LIST_FILES,<index>` | `FILE,<index>,<total>,<name>,<size>` | Return one root-level recording at zero-based index. Count only supported `.BIN`, `.TXT`, `.CSV` names. Use a deterministic ordering across all calls while no files change. |
| `LIST_FILES,<total>` | `FILES_END,<total>` | Signal that the list is complete. |
| `GET_FILE,<name>` | Existing `FILE_BEGIN,<name>,<bytes>` and `FILE_END,<name>,<bytes>,CHUNKS=<count>` statuses | Validate a root-level filename, open it read-only, and send it through the **same** six-byte sequence/offset chunks as v0.2.4 `GET_LATEST`. |
| `RENAME_FILE,<old>,<new>` | `RENAMED,<old>,<new>` | v0.2.8: closed root-level recordings only. Preserve extension, reject collisions and active recording/transfer, and update the in-memory latest filename. |
| `CMD_CLEAR`, `CMD_ADD,<12 ASCII chars>`, `CMD_RUN` | `CMD_READY` for staging; actual command response on run | v0.2.8: execute a command up to 160 characters using individually acknowledged writes of at most 20 bytes. Staging expires after ten seconds and clears on disconnect or execution. |
| `GET_FILE,<name>,<20 or 180>` / `GET_LATEST,<20 or 180>` then `FILE_READY` | `FILE_BEGIN` then data after ready, ending with `FILE_END` | v0.2.8: read complete begin status before sending ready; packet limit includes the six-byte header. No new status is emitted for ready. |

The page loads recordings in batches of 50 and searches only loaded entries. v0.2.8 allows safe ASCII names up to 64 characters including the four-character extension; older firmware supports 24. Listing replies fit in the 180-byte status characteristic, but a notification may be limited to 20 bytes. The page reads the full characteristic before parsing a command response. The v0.2.8 begin handshake and full end reads also protect long transfer filenames. After rename, enumeration restarts because FAT may move the directory entry. Listing does not alter the SD card.

The downloaded recording remains on the board's SD card. `.BIN` recordings use the existing BCB1 decoder; `.TXT` and `.CSV` files must contain the Artemis sensor CSV header. The page holds only one transferred ride in Bluefy at a time; the user must explicitly select **Save CSV to Files** or **Save original to Files** before transferring a different ride. iOS share-sheet support depends on the browser; the page falls back to a browser download and reports that distinction.

The legacy transfer checks every chunk's sequence number and byte offset, the total byte count, and the final chunk count. v0.2.8 keeps a 32-bit final chunk count while the sequence field wraps modulo 65536. There is no CRC/retransmission; missing chunks fail and require a retry. Browser simulation and host C++ command tests pass; physical rename, SD integrity, real Bluetooth transfer and reconnect behavior still require device testing.
