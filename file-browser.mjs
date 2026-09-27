// Proposed firmware protocol: LIST_FILES,<index> returns one FILE row or FILES_END.
// One row per request keeps status notifications below the BLE characteristic limit.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}\.(?:BIN|TXT|CSV)$/i;
export const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
export function parseFileReply(reply, requestedIndex) {
  const raw = String(reply).replace(/[\r\n\0]+$/, '');
  const fields = raw.split(',');
  const invalid = reason => {
    throw Error('File list entry ' + (requestedIndex + 1) + ': ' + reason + '. Board reply: ' + JSON.stringify(raw.slice(0, 256)));
  };
  const uint = value => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (fields[0] === 'FILES_END') {
    if (fields.length !== 2 || !uint(fields[1]) || Number(fields[1]) !== requestedIndex) invalid('unexpected list ending');
    return {done: true, total: Number(fields[1])};
  }
  if (fields[0] !== 'FILE' || (fields.length !== 5 && fields.length !== 6)) invalid('expected FILE,index,total,name,size[,modified]');
  const index = Number(fields[1]), total = Number(fields[2]), name = fields[3], size = Number(fields[4]);
  if (!uint(fields[1]) || index !== requestedIndex) invalid('wrong file index');
  if (!uint(fields[2]) || total <= index || total > 10000) invalid('invalid file count');
  if (!name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) invalid('invalid filename');
  if (!uint(fields[4]) || size > 0xffffffff) invalid('invalid byte size');
  // Inventory metadata is not a memory allocation or a transfer command.
  // Keep these entries visible while retaining strict download safeguards.
  const unavailableReason = !SAFE_NAME.test(name) ? 'Filename not supported for transfer' :
    size > MAX_TRANSFER_BYTES ? 'Above the 64 MB transfer limit' : size === 0 ? 'Empty recording' : '';
  const modified = parseModifiedDate(fields[5]);
  return {done: false, index, total, name, size, modified, transferable: !unavailableReason, unavailableReason};
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



// FAT timestamps represent the board clock, without a timezone. Never shift them
// to the phone timezone or substitute the download time for a missing SD date.
export function parseModifiedDate(value) {
  if (!value || value === '-') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year,month,day,hour,minute,second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year,month-1,day,hour,minute,second));
  if (year < 1980 || year > 2107 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return value;
}
export function modifiedDateLabel(value) {
  return value ? 'Modified: ' + value.replace('T',' ') + ' (board clock)' : 'Modified: unavailable';
}
