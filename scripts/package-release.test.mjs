import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {packageRelease} from './package-release.mjs';
import {verifyPackage} from './verify-package.mjs';

test('packages preserve the committed source, exclude private/old files, and reproduce byte-for-byte', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'bikecoach-package-'));
  const git = process.env.BIKECOACH_GIT || 'git';
  const run = (...args) => execFileSync(git, ['-C', repo, ...args]);
  try {
    const prefix = 'firmware/OpenLog_Artemis_BikeCoach/';
    await mkdir(join(repo, prefix), {recursive: true});
    const files = {
      'index.html': '<strong>BIKE COACH · 5.2.3</strong><script src="app-v4.js?v=1"></script>',
      'analyzer.html': '<script type="module">import "./sample.mjs";</script>',
      'app-v4.js': 'import "./sample.mjs?v=2";',
      'storage.js': 'export const store = true;',
      'sample.mjs': 'export const original = 42;',
      'style.css': 'body {color: black}',
      'sample.test.mjs': '// Must not ship',
      'train-model.mjs': '// Must not ship',
      'app-v3.js': '// Must not ship',
      'private-ride.csv': 'precise personal GPS data must not ship',
      [prefix + 'OpenLog_Artemis_BikeCoach.ino']: 'status("BIKECOACH,FW=0.2.11");',
      [prefix + 'README.md']: 'Canonical sketch instructions',
      [prefix + 'sketch.yaml']: 'profiles: {}',
    };
    for (const [path, content] of Object.entries(files)) await writeFile(join(repo, path), content);
    run('init', '-b', 'main'); run('add', '.');
    run('-c', 'user.name=Package Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
    const commit = run('rev-parse', 'HEAD').toString().trim();
    await writeFile(join(repo, 'sample.mjs'), 'uncommitted change must not ship');
    const a = await packageRelease({repo, out: join(repo, 'a'), git});
    const b = await packageRelease({repo, out: join(repo, 'b'), git});
    assert.equal(a.manifest.sourceCommit, commit);
    for (const [name, details] of Object.entries(a.manifest.packages)) {
      const bytes = await readFile(join(a.destination, name));
      assert.deepEqual(bytes, await readFile(join(b.destination, name)));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), details.sha256);
      const contents = unzipSync(bytes);
      assert.ok(!Object.keys(contents).some(path => /private|app-v3|\.test\.|train-/.test(path)));
      if (name.includes('-web-')) assert.equal(Buffer.from(contents['sample.mjs']).toString(), files['sample.mjs']);
      else assert.ok(contents['OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino']);
    }
    assert.equal((await verifyPackage(a.destination)).manifest.sourceCommit, commit);
    const webZip = Object.keys(a.manifest.packages).find(name => name.startsWith('BikeCoach-web-'));
    const originalZip = await readFile(join(a.destination, webZip));
    await writeFile(join(a.destination, webZip), Buffer.concat([originalZip, Buffer.from('changed')]));
    await assert.rejects(verifyPackage(a.destination), /fingerprint mismatch/);
    await writeFile(join(a.destination, webZip), originalZip);
    await assert.rejects(packageRelease({repo, out: a.destination, git}), /EEXIST/);
    await writeFile(join(repo, 'app-v4.js'), 'import "./missing-module.mjs";');
    run('add', 'app-v4.js');
    run('-c', 'user.name=Package Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'missing dependency');
    await assert.rejects(packageRelease({repo, out: join(repo, 'broken'), git}), /missing package asset/);
  } finally {
    await rm(repo, {recursive: true, force: true});
  }
});
