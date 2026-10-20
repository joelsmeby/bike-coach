import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const runs = [
  ['analysis-engine.test.mjs', {}],
  ['analyzer-chart.test.mjs', {}],
  ['analysis-web.test.mjs', {}],
  ['browser-workflow.test.mjs', {BIKECOACH_TEST_INFO: 'BIKECOACH,FW=0.2.9,STATE=IDLE,FILE='}],
  ['browser-workflow.test.mjs', {BIKECOACH_TEST_INFO: 'BIKECOACH,FW=0.2.11,TRANSFER=LEGACY6,FILES=1,STATE=IDLE,FILE='}],
];
for (const [file, extraEnv] of runs) {
  console.log(`\nRunning ${file}${extraEnv.BIKECOACH_TEST_INFO ? ' with ' + extraEnv.BIKECOACH_TEST_INFO : ''}`);
  const result = spawnSync(process.execPath, [file], {
    cwd, env: {...process.env, ...extraEnv}, stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
