import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { APP_VERSION } from './version.js';

const source = (await readFile(new URL('./server.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/const root = fileURLToPath\(new URL\('\.', import.meta.url\)\);/, "const root = '/fixture/';");

// Exercise the real server routing and provider forwarding with isolated HTTP
// request/response streams; never open a port or contact a real AI service.
function createTestServer(env = {}) {
  let handler;
  const upstreamRequests = [];
  const fileReads = [];
  const timers = [];
  vm.runInNewContext(source, {
    URL, Buffer, extname, join, normalize, APP_VERSION,
    process: { env: { PORT: '8787', ...env }, exit() { throw new Error('Unexpected exit'); } },
    console: { log() {}, warn() {} },
    setTimeout(callback) { timers.push(callback); },
    readFile: async (path) => { fileReads.push(path); return Buffer.from('fixture public asset'); },
    createServer: (callback) => {
      handler = callback;
      return { listen() {}, close() {} };
    },
    fetch: async (url, options) => {
      upstreamRequests.push({ url, ...options });
      return { ok: true, headers: { get: () => 'application/json' }, text: async () => url.endsWith('/models')
        ? '{"data":[{"id":"fixture-chat-instruct"}]}'
        : '{"choices":[{"message":{"content":"Fixture response"}}]}' };
    },
  });
  return {
    upstreamRequests, fileReads, timers,
    async request(path, { method = 'GET', headers = {}, body = '', remoteAddress = '127.0.0.1' } = {}) {
      const request = {
        url: path, method, headers: { host: '127.0.0.1:8787', ...headers }, socket: { remoteAddress },
        async *[Symbol.asyncIterator]() { if (body) yield body; },
      };
      let status;
      let responseHeaders;
      let responseBody;
      await handler(request, {
        writeHead(code, values) { status = code; responseHeaders = values; },
        end(value) { responseBody = value?.toString() || ''; },
      });
      return { status, headers: responseHeaders, body: responseBody };
    },
  };
}

const postJson = (body = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:8787' }, body: JSON.stringify(body) });

test('all frontend assets remain available over GET and HEAD', async () => {
  const server = createTestServer();
  for (const path of ['/', '/index.html', '/app.js', '/styles.css', '/token-utils.js', '/audit.js', '/cropper.js', '/png.js', '/version.js', '/placeholders.js']) {
    assert.equal((await server.request(path)).status, 200, path);
    const response = await server.request(path, { method: 'HEAD' });
    assert.equal(response.status, 200, path);
    assert.equal(response.body, '');
  }
});

test('opening the app from an external link works while embedded cross-site requests stay blocked', async () => {
  const server = createTestServer();
  const response = await server.request('/', { headers: {
    'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers['X-Frame-Options'], 'DENY');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal((await server.request('/', { headers: {
    'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe',
  } })).status, 403);
});

test('hidden files, repository internals and traversal are never read or served', async () => {
  const server = createTestServer();
  for (const path of ['/.env', '/.env.local', '/.git/config', '/server.mjs', '/package.json', '/data-preservation.test.mjs', '/%2eenv', '/%2e%2e/.env', '/%2e%2e%2f.env', '/app.js/../.env', '/%ZZ']) {
    const response = await server.request(path);
    assert.ok([400, 403, 404].includes(response.status), path);
  }
  assert.deepEqual(server.fileReads, []);
});

test('API access rejects foreign origins, rebinding hosts and non-local clients before side effects', async () => {
  const server = createTestServer();
  const denied = [
    { headers: { origin: 'https://foreign.example' } },
    { headers: { origin: 'http://127.0.0.1:9999' } },
    { headers: { origin: 'null' } },
    { headers: { host: 'rebind.example:8787' } },
    { headers: { host: '127.0.0.1:9999' } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { remoteAddress: '192.0.2.4' },
  ];
  for (const options of denied) {
    assert.equal((await server.request('/api/config', options)).status, 403);
    for (const path of ['/api/ai', '/api/models', '/api/shutdown']) {
      assert.equal((await server.request(path, { ...options, method: 'POST', body: '{}' })).status, 403);
    }
  }
  assert.deepEqual(server.upstreamRequests, []);
  assert.deepEqual(server.timers, []);
});

test('local browser and CLI requests still work without disclosing the server key', async () => {
  const server = createTestServer({ OPENAI_API_KEY: 'fixture-server-secret' });
  for (const host of ['127.0.0.1:8787', 'localhost:8787', '[::1]:8787']) {
    const result = await server.request('/api/config', { headers: { host, origin: `http://${host}` }, remoteAddress: '::ffff:127.0.0.1' });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).hasServerApiKey, true);
    assert.equal(result.body.includes('fixture-server-secret'), false);
  }
  assert.equal((await server.request('/api/models', postJson())).status, 200);
  const cliOptions = postJson({ model: 'manual-model', messages: [] });
  delete cliOptions.headers.origin;
  assert.equal((await server.request('/api/ai', cliOptions)).status, 200);
  assert.equal(JSON.parse(server.upstreamRequests.at(-1).body).model, 'manual-model');
  assert.equal((await server.request('/api/shutdown', { method: 'POST', headers: { origin: 'http://127.0.0.1:8787' } })).status, 200);
});

test('the server key is scoped to the configured endpoint and redirects cannot forward credentials', async () => {
  const server = createTestServer({ OPENAI_PROVIDER: 'custom', OPENAI_BASE_URL: 'https://configured.example/v1/', OPENAI_API_KEY: 'fixture-server-secret' });
  for (const path of ['/api/models', '/api/ai']) {
    const count = server.upstreamRequests.length;
    assert.equal((await server.request(path, postJson({ baseUrl: 'https://other.example/v1' }))).status, 400);
    assert.equal(server.upstreamRequests.length, count);
    assert.equal((await server.request(path, postJson({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'manual-model' }))).status, 200);
    assert.equal(server.upstreamRequests.at(-1).headers.Authorization, undefined);
    assert.equal((await server.request(path, postJson({ baseUrl: 'https://other.example/v1', apiKey: 'fixture-browser-key', model: 'manual-model' }))).status, 200);
    assert.equal(server.upstreamRequests.at(-1).headers.Authorization, 'Bearer fixture-browser-key');
    assert.equal((await server.request(path, postJson({ model: 'manual-model' }))).status, 200);
    assert.equal(server.upstreamRequests.at(-1).headers.Authorization, 'Bearer fixture-server-secret');
  }
  assert.ok(server.upstreamRequests.every((request) => request.redirect === 'error'));
});

test('invalid endpoints and malformed request bodies cannot silently use a fallback or crash the server', async () => {
  const server = createTestServer({ OPENAI_API_KEY: 'fixture-server-secret' });
  for (const path of ['/api/ai', '/api/models']) {
    for (const baseUrl of ['broken URL', 'file:///private/secret', 'ftp://host/v1', 'https://user:password@host/v1']) {
      assert.equal((await server.request(path, postJson({ baseUrl }))).status, 400);
    }
    for (const body of ['{bad JSON', 'null', '[]', '"string"']) {
      assert.equal((await server.request(path, { ...postJson(), body })).status, 400);
    }
    assert.equal((await server.request(path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  }
  assert.deepEqual(server.upstreamRequests, []);
});
