export const MAX_RECORDING_NAME = 64;
export function validRecordingName(name) {
  return typeof name === 'string' && name.length <= MAX_RECORDING_NAME &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:TXT|CSV|BIN)$/i.test(name);
}
export function trailFilename(trail, original) {
  if (!validRecordingName(original)) throw Error('Invalid original recording name.');
  const extension = original.slice(-4);
  let stem = String(trail).trim();
  const supplied = /\.(TXT|CSV|BIN)$/i.exec(stem);
  if (supplied) {
    if (supplied[0].toLowerCase() !== extension.toLowerCase()) throw Error('Keep the recording’s original file extension.');
    stem = stem.slice(0, -4);
  }
  stem = stem.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!stem || !/^[A-Za-z0-9]/.test(stem)) throw Error('Start the trail name with a letter or number.');
  if (stem.length > MAX_RECORDING_NAME - 4) throw Error('Use a trail name of 60 characters or fewer.');
  return stem + extension;
}
export function renameRecording(ride, name, {onBoard = false} = {}) {
  if (!validRecordingName(name) || name.slice(-4).toLowerCase() !== ride.name.slice(-4).toLowerCase()) throw Error('Invalid recording name or file extension.');
  return {...ride, name, originalName: ride.originalName || ride.name,
    sourceName: onBoard ? name : (ride.sourceName || ride.name),
    trainingLabels: ride.trainingLabels ? {...ride.trainingLabels, sourceFile: name} : ride.trainingLabels};
}
export function parseRenameReply(reply, oldName, newName) {
  if (reply !== `RENAMED,${oldName},${newName}`) throw Error('The board did not confirm the requested rename. Refresh the SD list before retrying.');
}
export function commandParts(command) {
  if (!/^[\x20-\x7e]+$/.test(command) || command.length > 160) throw Error('Invalid or oversized board command.');
  if (command.length <= 20) return [command];
  const parts = ['CMD_CLEAR'];
  for (let i = 0; i < command.length; i += 12) parts.push('CMD_ADD,' + command.slice(i, i+12));
  return [...parts, 'CMD_RUN'];
}
