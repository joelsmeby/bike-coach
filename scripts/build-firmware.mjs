import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const ideCli = '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli';
const cli = process.env.ARDUINO_CLI || (existsSync(ideCli) ? ideCli : 'arduino-cli');
const buildPath = fileURLToPath(new URL('../.local/build/firmware-profile/', import.meta.url));
mkdirSync(buildPath, {recursive: true});
console.log('Building the canonical firmware with the pinned bikecoach profile. This does not upload to the device.');
const result = spawnSync(cli, [
  'compile', '--profile', 'bikecoach', '--build-path', buildPath,
  'firmware/OpenLog_Artemis_BikeCoach',
], {cwd, stdio: 'inherit'});
if (result.error) {
  console.error(`Cannot start Arduino CLI: ${result.error.message}. Install Arduino IDE/CLI or set ARDUINO_CLI.`);
}
if (result.error || result.status !== 0) process.exit(result.status || 1);
