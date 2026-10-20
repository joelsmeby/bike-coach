import {createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';

export async function findPackageDirectory(root = 'dist') {
  root = resolve(root);
  if ((await readdir(root)).includes('manifest.json')) return root;
  const candidates = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    if (entry.isDirectory() && (await readdir(join(root, entry.name))).includes('manifest.json')) candidates.push(join(root, entry.name));
  }
  if (candidates.length !== 1) throw Error('Specify one package directory containing manifest.json.');
  return candidates[0];
}

export async function verifyPackage(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const archives = {};
  for (const [name, expected] of Object.entries(manifest.packages)) {
    if (name !== name.split(/[\\/]/).at(-1)) throw Error('Invalid package filename.');
    const bytes = await readFile(join(directory, name));
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw Error(`Package fingerprint mismatch: ${name}`);
    const contents = unzipSync(bytes);
    const expectedFiles = name.startsWith('BikeCoach-web-') ? manifest.webFiles : manifest.firmwareFiles;
    if (Object.keys(contents).sort().join('\0') !== Object.keys(expectedFiles).sort().join('\0')) throw Error(`Unexpected package contents: ${name}`);
    for (const [path, expectedHash] of Object.entries(expectedFiles)) {
      if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) throw Error('Unsafe archive path.');
      if (digest(contents[path]) !== expectedHash) throw Error(`File fingerprint mismatch: ${path}`);
    }
    archives[name] = contents;
  }
  const webName = Object.keys(archives).find(name => name.startsWith('BikeCoach-web-'));
  if (!webName) throw Error('Web package missing.');
  return {manifest, web: archives[webName]};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = await findPackageDirectory(process.argv[2]);
  const {manifest, web} = await verifyPackage(directory);
  const extracted = await mkdtemp(join(tmpdir(), 'bikecoach-packaged-web-'));
  try {
    for (const [name, bytes] of Object.entries(web)) {
      const target = join(extracted, name);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, bytes);
    }
    console.log(`Fingerprints verified. Testing the extracted web package from ${manifest.sourceCommit}.`);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./test-browser.mjs', import.meta.url))], {
      env: {...process.env, BIKECOACH_WEB_ROOT: extracted}, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } finally {
    await rm(extracted, {recursive: true, force: true});
  }
}
