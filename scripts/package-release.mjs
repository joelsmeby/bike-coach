import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipSync} from 'fflate';

const defaultRepo = fileURLToPath(new URL('../', import.meta.url));
const sketch = 'firmware/OpenLog_Artemis_BikeCoach/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

// Read product files from Git, never from a potentially modified working folder.
export async function packageRelease({repo = defaultRepo, ref = 'HEAD', out, git = process.env.BIKECOACH_GIT || 'git'} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) throw Error('Use a commit, branch or tag name for --ref.');
  const run = (...args) => execFileSync(git, ['-C', repo, ...args], {maxBuffer: 32 * 1024 * 1024});
  const commit = run('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
  const files = run('ls-tree', '-r', '--name-only', '-z', commit).toString().split('\0').filter(Boolean);
  const read = path => {
    if (!files.includes(path)) throw Error(`Source commit is missing ${path}`);
    return run('show', `${commit}:${path}`);
  };
  const webVersion = read('index.html').toString().match(/BIKE COACH\s*·\s*(\d+\.\d+\.\d+)/)?.[1];
  const firmwareVersion = read(sketch + 'OpenLog_Artemis_BikeCoach.ino').toString().match(/FW=(\d+\.\d+\.\d+)/)?.[1];
  if (!webVersion || !firmwareVersion) throw Error('Cannot identify web and firmware versions in the source commit.');
  const short = commit.slice(0, 8);
  const id = `web-${webVersion}-fw-${firmwareVersion}-${short}`;
  const metadata = {
    sourceCommit: commit,
    sourceUrl: `https://github.com/joelsmeby/bike-coach/commit/${commit}`,
    sourceCommitDate: run('show', '-s', '--format=%cI', commit).toString().trim(),
    webVersion, firmwareVersion,
    releaseId: id,
    releaseTag: `bikecoach-${id}`,
    releaseTitle: `Bike Coach web ${webVersion} / firmware ${firmwareVersion} (${short})`,
    status: 'Candidate: see the release record for automated and physical validation evidence.',
  };
  const webPaths = files.filter(path => !path.includes('/') && (
    ['index.html', 'analyzer.html', 'style.css', 'app-v4.js', 'storage.js'].includes(path) ||
    (path.endsWith('.mjs') && !path.endsWith('.test.mjs') && !path.startsWith('train-'))
  )).sort();
  const web = Object.fromEntries(webPaths.map(path => [path, read(path)]));
  for (const required of ['index.html', 'analyzer.html', 'style.css', 'app-v4.js', 'storage.js']) {
    if (!web[required]) throw Error(`Web package is missing ${required}`);
  }
  // Catch an import or local HTML asset accidentally omitted from the package.
  for (const [path, bytes] of Object.entries(web)) {
    const source = bytes.toString();
    const refs = [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)].map(m => m[1]);
    if (path.endsWith('.html')) refs.push(...[...source.matchAll(/(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)].map(m => m[1]));
    for (const reference of refs) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
      const dependency = posix.normalize(posix.join(posix.dirname(path), reference.split(/[?#]/)[0]));
      if (!web[dependency]) throw Error(`${path} references missing package asset ${reference}`);
    }
  }
  const firmware = {};
  for (const name of ['OpenLog_Artemis_BikeCoach.ino', 'README.md', 'sketch.yaml']) {
    firmware[`OpenLog_Artemis_BikeCoach/${name}`] = read(sketch + name);
  }
  const install = Buffer.from(`# Bike Coach installation packages\n\nWeb: ${webVersion}\nFirmware: ${firmwareVersion}\nSource commit: ${commit}\n\n## Web package\nExtract the web ZIP and deploy its contents together to the existing website. Keep the site's address unchanged to retain access to that browser's stored profiles and rides. Confirm the webpage reports ${webVersion}.\n\n## Firmware package\nExtract the firmware ZIP and open OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino in Arduino IDE. Select SparkFun Apollo3 > RedBoard Artemis ATP, with Apollo3 core 2.2.1. The exact library versions are in sketch.yaml. Upload only when a firmware update is intended. Confirm firmware ${firmwareVersion} after reconnecting. For development, use the canonical sketch in the Git checkout rather than editing an extracted package.\n\n## Recovery and validation\nKeep this package and its source commit together. Previous GitHub Releases provide older installation packages. SHA256SUMS.txt and manifest.json identify the exact files. These packages contain firmware source, not a pre-flashed device image. Package generation does not establish physical device or ride validation. The release record states what was tested.\n`);
  web['build-info.json'] = json(metadata);
  firmware['build-info.json'] = json(metadata);
  firmware['INSTALL.md'] = install;
  const pack = entries => zipSync(Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), {
    level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0),
  });
  const artifacts = {
    [`BikeCoach-web-${webVersion}-${short}.zip`]: pack(web),
    [`BikeCoach-firmware-${firmwareVersion}-${short}.zip`]: pack(firmware),
  };
  const manifest = {
    ...metadata,
    packages: Object.fromEntries(Object.entries(artifacts).map(([name, bytes]) => [name, {sha256: digest(bytes), bytes: bytes.length}])),
    webFiles: Object.fromEntries(Object.entries(web).map(([name, bytes]) => [name, digest(bytes)])),
    firmwareFiles: Object.fromEntries(Object.entries(firmware).map(([name, bytes]) => [name, digest(bytes)])),
  };
  artifacts['manifest.json'] = json(manifest);
  artifacts['INSTALL.md'] = install;
  artifacts['SHA256SUMS.txt'] = Buffer.from(Object.entries(artifacts).map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join(''));
  const destination = resolve(out || resolve(repo, 'dist', id));
  await mkdir(dirname(destination), {recursive: true});
  await mkdir(destination); // Refuse to silently overwrite a previously generated package.
  for (const [name, bytes] of Object.entries(artifacts)) await writeFile(resolve(destination, name), bytes, {flag: 'wx'});
  console.log(`Packages from ${commit}: ${destination}`);
  return {destination, manifest};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1];
    if (!['--ref', '--out'].includes(flag) || !value) throw Error('Usage: node scripts/package-release.mjs [--ref COMMIT_OR_TAG] [--out NEW_DIRECTORY]');
    options[flag.slice(2)] = value;
  }
  await packageRelease(options);
}
