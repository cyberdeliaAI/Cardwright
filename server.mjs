import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from './version.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const defaultBaseUrl = 'http://127.0.0.1:1234/v1';
const defaultModel = 'local-model';
const defaultProvider = 'lmstudio';

const aiProviders = {
  lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', model: defaultModel },
  omlx: { label: 'oMLX', baseUrl: 'http://127.0.0.1:8000/v1', model: defaultModel },
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: defaultModel },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { label: 'Custom OpenAI-compatible', baseUrl: defaultBaseUrl, model: defaultModel },
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Only browser assets are public; repository files and secrets are never served.
const publicFiles = new Set([
  '/index.html', '/styles.css', '/app.js', '/token-utils.js', '/audit.js',
  '/cropper.js', '/png.js', '/version.js', '/examples/screenshot01.png',
  '/placeholders.js',
]);

function send(req, res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = body ? JSON.parse(body) : {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Expected a JSON object');
  return payload;
}

function resolveStaticPath(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  return publicFiles.has(requested) ? join(root, requested) : null;
}

function isAllowedLocalRequest(req) {
  const address = req.socket.remoteAddress || '';
  if (address !== '::1' && !/^127\./.test(address) && !/^::ffff:127\./.test(address)) return false;
  try {
    const authority = new URL(`http://${req.headers.host}`);
    if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash) return false;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname)) return false;
    if (Number(authority.port || 80) !== port) return false;
    if (req.headers.origin && req.headers.origin !== authority.origin) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site'
      && !(req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate'
        && req.headers['sec-fetch-dest'] === 'document')) return false;
    return true;
  } catch {
    return false;
  }
}

function isLocalBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

function providerConfig(provider) {
  return aiProviders[String(provider || defaultProvider).toLowerCase()] || aiProviders[defaultProvider];
}

function normalizeBaseUrl(baseUrl, provider) {
  const fallback = providerConfig(provider).baseUrl;
  let base = String(baseUrl || fallback).trim().replace(/\/+$/, '');
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid provider URL');
    }
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
    }
    base = url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('Invalid provider base URL. Use an HTTP or HTTPS URL without credentials, query or fragment.');
  }
  return base;
}

function resolveProviderSettings(payload) {
  for (const key of ['provider', 'baseUrl', 'apiKey', 'model']) {
    if (payload[key] != null && typeof payload[key] !== 'string') throw new Error(`Invalid ${key}`);
  }
  const configuredProvider = process.env.OPENAI_PROVIDER || defaultProvider;
  const provider = payload.provider || configuredProvider;
  const baseUrl = normalizeBaseUrl(payload.baseUrl || process.env.OPENAI_BASE_URL, provider);
  const configuredBaseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL, configuredProvider);
  // A server credential belongs to its configured endpoint, never an arbitrary
  // endpoint supplied by the browser. Browser credentials remain explicit.
  const apiKey = payload.apiKey || (baseUrl === configuredBaseUrl ? process.env.OPENAI_API_KEY || '' : '');
  return { provider, baseUrl, apiKey };
}

function resolveRequestedModel(provider, requestedModel) {
  const trimmed = String(requestedModel || '').trim();
  if (trimmed && trimmed !== defaultModel) return trimmed;
  return providerConfig(provider).model || defaultModel;
}

function buildProviderHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

// Model ids that are not usable as a chat/instruct model for this tool.
const NON_CHAT_MODEL = /embed|image|dall-?e|tts|whisper|audio|moderation|rerank|realtime|transcribe|search|-edit|davinci|babbage/i;
// Ids that are very likely a chat/instruct model, preferred when present.
const PREFERRED_CHAT_MODEL = /gpt|chat|instruct|(?:^|[-_])o[0-9]/i;

function chooseChatModel(models) {
  const list = Array.isArray(models?.data) ? models.data : [];
  const ids = list.map((model) => String(model?.id || '')).filter(Boolean);
  // Drop clearly non-chat models (embeddings, image, audio, legacy completions).
  const candidates = ids.filter((id) => !NON_CHAT_MODEL.test(id));
  // Prefer an obvious chat model (matters for OpenAI's large unsorted list);
  // otherwise fall back to the first candidate, then the first id at all.
  const preferred = candidates.find((id) => PREFERRED_CHAT_MODEL.test(id));
  return preferred || candidates[0] || ids[0] || '';
}

async function fetchProviderModels(baseUrl, apiKey) {
  const upstream = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    redirect: 'error',
    headers: buildProviderHeaders(apiKey),
  });
  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  if (!upstream.ok) {
    throw new Error(data.error?.message || data.error || `Model list failed with HTTP ${upstream.status}`);
  }
  return data;
}

async function resolveModel(baseUrl, apiKey, requestedModel) {
  const shouldAutoResolve = isLocalBaseUrl(baseUrl) && (!requestedModel || requestedModel === defaultModel);
  if (!shouldAutoResolve) return requestedModel || defaultModel;

  try {
    const models = await fetchProviderModels(baseUrl, apiKey);
    return chooseChatModel(models) || defaultModel;
  } catch (error) {
    console.warn(`[Cardwright] Could not auto-detect local model: ${error.message}`);
    return requestedModel || defaultModel;
  }
}

async function handleModels(req, res) {
  let payload;
  let settings;
  try {
    payload = await readJson(req);
    settings = resolveProviderSettings(payload);
  } catch (error) {
    send(req, res, 400, JSON.stringify({ error: error.message || 'Invalid JSON body' }), {
      'Content-Type': 'application/json',
    });
    return;
  }

  const { provider, baseUrl, apiKey } = settings;

  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    send(req, res, 400, JSON.stringify({ error: 'Missing API key. Add it in Settings or set OPENAI_API_KEY.' }), {
      'Content-Type': 'application/json',
    });
    return;
  }

  try {
    const models = await fetchProviderModels(baseUrl, apiKey);
    send(req, res, 200, JSON.stringify({
      models: Array.isArray(models.data) ? models.data : [],
      selectedModel: chooseChatModel(models),
      provider,
      baseUrl,
    }), {
      'Content-Type': 'application/json',
    });
  } catch (error) {
    send(req, res, 502, JSON.stringify({ error: error.message || 'Could not load models' }), {
      'Content-Type': 'application/json',
    });
  }
}

function handleConfig(req, res) {
  const provider = process.env.OPENAI_PROVIDER || defaultProvider;
  send(req, res, 200, JSON.stringify({
    version: APP_VERSION,
    provider,
    providers: aiProviders,
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL, provider),
    model: process.env.OPENAI_MODEL || providerConfig(provider).model || defaultModel,
    hasServerApiKey: !!process.env.OPENAI_API_KEY,
  }), {
    'Content-Type': 'application/json',
  });
}

async function handleAi(req, res) {
  let payload;
  let settings;
  try {
    payload = await readJson(req);
    settings = resolveProviderSettings(payload);
  } catch (error) {
    send(req, res, 400, JSON.stringify({ error: error.message || 'Invalid JSON body' }), {
      'Content-Type': 'application/json',
    });
    return;
  }

  const { provider, baseUrl, apiKey } = settings;
  const requestedModel = resolveRequestedModel(provider, payload.model || process.env.OPENAI_MODEL);
  const model = await resolveModel(baseUrl, apiKey, requestedModel);

  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    send(req, res, 400, JSON.stringify({ error: 'Missing API key. Add it in Settings or set OPENAI_API_KEY.' }), {
      'Content-Type': 'application/json',
    });
    return;
  }

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: buildProviderHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: payload.messages || [],
        temperature: payload.temperature ?? 0.7,
      }),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      send(req, res, upstream.status, text, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      });
      return;
    }

    send(req, res, 200, text, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
  } catch (error) {
    send(req, res, 502, JSON.stringify({ error: error.message || 'AI request failed' }), {
      'Content-Type': 'application/json',
    });
  }
}

function handleShutdown(req, res) {
  send(req, res, 200, JSON.stringify({ ok: true, message: 'Server is shutting down.' }), {
    'Content-Type': 'application/json',
  });

  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
  }, 100);
}

const server = createServer(async (req, res) => {
  if (!isAllowedLocalRequest(req)) {
    send(req, res, 403, 'Forbidden');
    return;
  }
  let url;
  try {
    const origin = new URL(`http://${req.headers.host}`).origin;
    url = new URL(req.url || '/', origin);
    if (url.origin !== origin) throw new Error('Unexpected request origin');
  } catch {
    send(req, res, 400, 'Invalid request URL');
    return;
  }

  if (req.method === 'POST' && ['/api/ai', '/api/models'].includes(url.pathname)
    && (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    send(req, res, 415, JSON.stringify({ error: 'Use Content-Type: application/json' }), { 'Content-Type': 'application/json' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai') {
    await handleAi(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/models') {
    await handleModels(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    try {
      handleConfig(req, res);
    } catch (error) {
      send(req, res, 400, JSON.stringify({ error: error.message }), { 'Content-Type': 'application/json' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    handleShutdown(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, 'Method not allowed');
    return;
  }

  try {
    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      send(req, res, 404, 'Not found');
      return;
    }

    const file = await readFile(filePath);
    send(req, res, 200, file, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    });
  } catch {
    send(req, res, 404, 'Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Cardwright v${APP_VERSION} is running at http://${host}:${port}`);
});
