import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const executable = process.argv[2] || createRequire(import.meta.url)('electron');
const root = await mkdtemp(path.join(tmpdir(), 'cardwright-desktop-smoke-'));
const profile = path.join(root, 'profile'); await mkdir(profile);
let requests = 0;
const provider = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"smoke-model"}]}'); return; }
  const payload = JSON.parse(body); requests++;
  assert.ok(payload.messages[0].content.includes('untrusted reference data'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: 'Identity and timeline\nMOCK_SOURCE_CONCEPT: Aster, lighthouse keeper.\nUnknowns\nAppearance and player relationship: Not specified.' } }] }));
});
provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const phases = [];
try {
  for (const phase of ['initial', 'restart']) {
    const report = path.join(root, `report-${phase}.json`);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CSC_|WIN_CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$|ELECTRON_RUN_AS_NODE$|NODE_OPTIONS$)/.test(key)));
    const child = spawn(executable, process.argv[2] ? [] : ['.'], {
      env: { ...inherited, CARDWRIGHT_PROFILE: profile, CARDWRIGHT_PORT: String(port), CARDWRIGHT_SMOKE_REPORT: report, CARDWRIGHT_SMOKE_PHASE: phase,
        OPENAI_PROVIDER: 'custom', OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, OPENAI_API_KEY: '', OPENAI_MODEL: 'smoke-model' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
    const timeout = setTimeout(() => child.kill(), 60000);
    const [code] = await once(child, 'exit'); clearTimeout(timeout);
    let result;
    try { result = JSON.parse(await readFile(report, 'utf8')); } catch { throw new Error(`Desktop smoke ${phase} produced no report (exit ${code}): ${output}`); }
    assert.equal(code, 0, JSON.stringify(result)); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.electron, '45.2.3'); phases.push(result);
  }
  assert.equal(requests, 2);
  await mkdir('build/reports', { recursive: true });
  await writeFile(`build/reports/electron-${process.platform}-${process.arch}.json`, JSON.stringify({ ok: true, phases }, null, 2));
  console.log(`Desktop ${process.platform}/${process.arch}: sandbox, native exports, source drafts and restart persistence passed on Electron ${phases[0].electron}.`);
} finally {
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
