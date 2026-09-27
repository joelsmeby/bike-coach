// Proposed firmware protocol: LIST_FILES,<index> returns one FILE row or FILES_END.
// One row per request keeps status notifications below the BLE characteristic limit.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}\.(?:BIN|TXT|CSV)$/i;
export function parseFileReply(reply, requestedIndex) {
  const fields = String(reply).split(',');
  if (fields[0] === 'FILES_END') {
    const total = Number(fields[1]);
    if (!Number.isSafeInteger(total) || total !== requestedIndex) throw Error('Invalid file list ending.');
    return {done: true, total};
  }
  if (fields[0] !== 'FILE' || fields.length !== 5) throw Error('Invalid file list response.');
  const index = Number(fields[1]), total = Number(fields[2]), name = fields[3], size = Number(fields[4]);
  if (!Number.isSafeInteger(index) || index !== requestedIndex || !Number.isSafeInteger(total) || total <= index ||
      total > 10000 || !SAFE_NAME.test(name) || !Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) {
    throw Error('Invalid file information from board.');
  }
  return {done: false, index, total, name, size};
}
export function fileRequest(name, packetLimit) {
  if (!SAFE_NAME.test(name)) throw Error('Invalid recording filename.');
  if (packetLimit !== 20 && packetLimit !== 180) throw Error('Invalid packet size.');
  return `GET_FILE,${name},${packetLimit},8`;
}

function rowTime(fields) {
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(fields[0]);
  const time = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(fields[1]);
  if (!date || !time) return NaN;
  const fraction = Number(`0.${time[4] || '0'}`);
  return new Date(+date[3], +date[1] - 1, +date[2], +time[1], +time[2], +time[3], Math.round(fraction * 1000)).getTime();
}

export function parseTextRecording(bytes) {
  const csv = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const lines = csv.split(/\r?\n/);
  if (!lines.some(line => line.trim().startsWith('rtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ'))) throw Error('This is not an Artemis sensor log.');
  let count = 0, first = NaN, last = NaN;
  for (const line of lines) {
    if (!line.trim() || line.startsWith('rtcDate,') || line.startsWith('#')) continue;
    const fields = line.split(',');
    if (fields.length < 13 || fields.slice(2, 13).some(value => !Number.isFinite(Number(value)))) continue;
    const time = rowTime(fields);
    if (!Number.isFinite(time)) continue;
    if (!Number.isFinite(first)) first = time;
    last = time;
    count++;
  }
  if (!count) throw Error('The sensor log contains no valid samples.');
  return {csv, count, duration: Math.max(0, last - first)};
}

// v0.2.5/v0.2.4 firmware sends a six-byte sequence/offset header without ACKs.
export class LegacyReceiver {
  constructor() { this.offset = 0; this.next = 0; this.done = false; this.size = 0; }
  start(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) throw Error('Invalid recording size.');
    this.size = size; this.bytes = new Uint8Array(size);
    this.done = size === 0;
  }
  accept(packet) {
    if (!this.bytes || this.done || packet.length < 7) throw Error('Unexpected recording packet.');
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const seq = view.getUint16(0, true), offset = view.getUint32(2, true), chunk = packet.subarray(6);
    if (seq !== this.next % 65536 || offset !== this.offset || this.offset + chunk.length > this.size) {
      throw Error('A Bluetooth chunk is missing or out of order. Retry the transfer.');
    }
    this.bytes.set(chunk, this.offset); this.offset += chunk.length; this.next++;
    this.done = this.offset === this.size;
    return {done: this.done, ack: null};
  }
  flush() {return null;}
}
