import { readdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';

async function findExecutable(folder, depth = 0) {
  if (depth > 5) return null;
  const entries = await readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === (process.platform === 'win32' ? 'Cardwright.exe' : 'Cardwright')) return path.join(folder, entry.name);
  }
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const found = await findExecutable(path.join(folder, entry.name), depth + 1); if (found) return found;
  }
  return null;
}
const archives = (await readdir('dist')).filter(name => /^cardwright-.*\.(zip|tar\.gz)$/.test(name));
if (!archives.length) throw new Error('No desktop downloads were built.');
for (const archive of archives) {
  const folder = await mkdtemp(path.join(tmpdir(), 'cardwright-package-check-'));
  try {
    if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', path.resolve('dist', archive), folder]);
    else execFileSync('tar', ['-xf', path.resolve('dist', archive), '-C', folder]);
    const executable = await findExecutable(folder); if (!executable) throw new Error('Extracted application executable is missing.');
    if (process.platform === 'darwin') {
      const bundle = executable.slice(0, executable.indexOf('.app') + 4);
      execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], { stdio: 'inherit' });
      if (process.env.CARDWRIGHT_SIGNED_MAC === '1') {
        execFileSync('xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
        execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], { stdio: 'inherit' });
      }
    }
    execFileSync(process.execPath, ['tools/smoke-electron.mjs', executable], { stdio: 'inherit', timeout: 180000 });
    const hash = createHash('sha256').update(await readFile(path.join('dist', archive))).digest('hex');
    await writeFile(path.join('dist', archive + '.sha256'), `${hash}  ${archive}\n`);
    console.log(`Verified extracted package and checksum: ${archive}`);
  } finally { await rm(folder, { recursive: true, force: true }); }
}
