import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

// This runs only after the reusable checks succeed in the manually requested release workflow.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main') {
  throw Error('Publish through the Packages and release workflow on main.');
}
const root = 'release-assets';
const candidates = [];
for (const entry of await readdir(root, {withFileTypes: true})) {
  if (entry.isDirectory() && (await readdir(join(root, entry.name))).includes('manifest.json')) candidates.push(join(root, entry.name));
}
if (candidates.length !== 1) throw Error('Expected one checked installation package directory.');
const directory = candidates[0];
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
if (manifest.sourceCommit !== process.env.GITHUB_SHA) throw Error('Package source does not match the checked commit.');
const files = [...Object.keys(manifest.packages), 'manifest.json', 'INSTALL.md', 'SHA256SUMS.txt'];
if (files.some(name => name !== name.split(/[\\/]/).at(-1))) throw Error('Invalid release asset filename.');
execFileSync('gh', [
  'release', 'create', manifest.releaseTag,
  '--repo', process.env.GITHUB_REPOSITORY,
  '--target', manifest.sourceCommit,
  '--title', manifest.releaseTitle,
  '--notes-file', join(directory, 'INSTALL.md'),
  '--prerelease',
  ...files.map(name => join(directory, name)),
], {stdio: 'inherit'});
