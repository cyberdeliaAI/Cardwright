'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { applicationUrl, externalUrl, permissionAllowed, contentPolicy } = require('../security.cjs');
const { startBackend } = require('../backend.cjs');
const { windowSize, writeJson, readJson } = require('../preferences.cjs');
const { createUpdateChecker, isNewer, releaseInfo } = require('../updates.cjs');
const origin = 'http://127.0.0.1:8787';

test('desktop navigation stays on the shared entry page and external links require HTTPS', () => {
  for (const url of [origin, origin + '/index.html', origin + '/#card']) assert.equal(applicationUrl(url, origin), true);
  for (const url of [origin + '/api/config', origin + '/?page=other', 'https://foreign.example', 'file:///tmp/index.html', 'javascript:alert(1)']) assert.equal(applicationUrl(url, origin), false);
  assert.equal(externalUrl('https://github.com/cyberdeliaAI/Cardwright'), 'https://github.com/cyberdeliaAI/Cardwright');
  for (const url of ['http://example.com', 'file:///tmp/test', 'javascript:alert(1)', 'https://user:password@example.com']) assert.equal(externalUrl(url), null);
  assert.ok(contentPolicy.includes("script-src 'self'"));
  assert.equal(contentPolicy.includes("script-src 'self' 'unsafe-inline'"), false);
});

test('only the main application may request fullscreen or sanitized clipboard writes', () => {
  const contents = { getURL: () => origin };
  for (const permission of ['fullscreen', 'clipboard-sanitized-write']) assert.equal(permissionAllowed(contents, permission, origin, { isMainFrame: true }, origin), true);
  for (const permission of ['media', 'camera', 'microphone', 'clipboard-read', 'display-capture']) assert.equal(permissionAllowed(contents, permission, origin, {}, origin), false);
  assert.equal(permissionAllowed(contents, 'fullscreen', 'https://foreign.example', {}, origin), false);
  assert.equal(permissionAllowed(contents, 'fullscreen', origin, { isMainFrame: false }, origin), false);
});

test('desktop starts the shared server and stops only a server it owns', async () => {
  let stops = 0, connections = 0;
  const server = { address: () => ({ port: 4567 }), close: () => stops++, closeAllConnections: () => connections++ };
  const backend = await startBackend({ version: '1.3.0', port: 0, startServer: async options => { assert.equal(options.host, '127.0.0.1'); return server; } });
  assert.equal(backend.origin, 'http://127.0.0.1:4567'); assert.equal(backend.owned, true);
  backend.stop(); assert.equal(stops, 1); assert.equal(connections, 1);
  const reused = await startBackend({ version: '1.3.0', startServer: async () => { throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' }); }, probe: async () => ({ app: 'Cardwright', version: '1.3.0', desktopProtocol: 1 }) });
  assert.equal(reused.owned, false); reused.stop(); assert.equal(stops, 1);
});

test('unrelated or older servers are never reused or terminated', async () => {
  for (const info of [{}, { app: 'Cardwright', version: '1.2.0', desktopProtocol: 1 }, { app: 'Other', version: '1.3.0', desktopProtocol: 1 }]) {
    await assert.rejects(startBackend({ version: '1.3.0', startServer: async () => { throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' }); }, probe: async () => info }), /Close that server/);
  }
});

test('saved window dimensions are bounded and corrupt preferences are harmless', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardwright-window-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'window.json');
  writeJson(file, { width: 3000, height: 2000 });
  assert.deepEqual(windowSize(file, { width: 1280, height: 800 }), { width: 1280, height: 800, minWidth: 760, minHeight: 600 });
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(windowSize(file, { width: 600, height: 500 }), { width: 600, height: 500, minWidth: 600, minHeight: 500 });
});

test('update metadata accepts stable releases and constructs its own trusted link', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.3.0', '1.3.0'), false);
  assert.equal(isNewer('1.2.9', '1.3.0'), false);
  assert.equal(releaseInfo({ tag_name: 'v1.4.0', html_url: 'https://foreign.example' }).url, 'https://github.com/cyberdeliaAI/Cardwright/releases/tag/v1.4.0');
  for (const data of [{ tag_name: 'v1.4.0', draft: true }, { tag_name: 'v1.4.0', prerelease: true }, { tag_name: 'v1.4.0-beta.1' }, { tag_name: 'vjavascript:alert(1)' }]) assert.throws(() => releaseInfo(data));
});

test('release checks are daily, cached, opt-out and independent of API credentials', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardwright-updates-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'updates.json');
  let calls = 0, time = 100000;
  const request = async (url, options) => {
    calls++; assert.equal(url, 'https://api.github.com/repos/cyberdeliaAI/Cardwright/releases/latest');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ tag_name: 'v1.4.0' }));
  };
  const checker = createUpdateChecker(file, '1.3.0', request, () => time);
  assert.equal((await checker.check()).available, true);
  await checker.check(); assert.equal(calls, 1);
  const restored = createUpdateChecker(file, '1.3.0', request, () => time);
  await restored.check(); assert.equal(calls, 1);
  time += 86400001; restored.setAutomatic(false); await restored.check(); assert.equal(calls, 1);
  await restored.check(true); assert.equal(calls, 2);
  assert.equal(readJson(file).automatic, false);
});

test('failed release checks are throttled across restarts and preserve the last known release', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardwright-update-error-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'updates.json');
  writeJson(file, { latest: { version: '1.4.0' } });
  let calls = 0;
  const request = async () => { calls++; throw new Error('Offline'); };
  const checker = createUpdateChecker(file, '1.3.0', request, () => 100000);
  const result = await checker.check(); assert.ok(result.error); assert.equal(result.available, true);
  await createUpdateChecker(file, '1.3.0', request, () => 100001).check();
  assert.equal(calls, 1);
});
