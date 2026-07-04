import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
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

function send(req, res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function resolveStaticPath(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  return join(root, safePath);
}

function isLocalBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
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
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      base = url.toString().replace(/\/+$/, '');
    }
  } catch {
    base = fallback;
  }
  return base;
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

function chooseChatModel(models) {
  const list = Array.isArray(models?.data) ? models.data : [];
  const chatModel = list.find((model) => {
    const id = String(model?.id || '').toLowerCase();
    return id && !id.includes('embed') && !id.includes('embedding') && !id.includes('image');
  });
  return chatModel?.id || list[0]?.id || '';
}

async function fetchProviderModels(baseUrl, apiKey) {
  const upstream = await fetch(`${baseUrl}/models`, {
    method: 'GET',
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
  try {
    payload = await readJson(req);
  } catch {
    send(req, res, 400, JSON.stringify({ error: 'Invalid JSON body' }), {
      'Content-Type': 'application/json',
    });
    return;
  }

  const provider = payload.provider || process.env.OPENAI_PROVIDER || defaultProvider;
  const baseUrl = normalizeBaseUrl(payload.baseUrl || process.env.OPENAI_BASE_URL, provider);
  const apiKey = payload.apiKey || process.env.OPENAI_API_KEY || '';

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
  try {
    payload = await readJson(req);
  } catch {
    send(req, res, 400, JSON.stringify({ error: 'Invalid JSON body' }), {
      'Content-Type': 'application/json',
    });
    return;
  }

  const provider = payload.provider || process.env.OPENAI_PROVIDER || defaultProvider;
  const baseUrl = normalizeBaseUrl(payload.baseUrl || process.env.OPENAI_BASE_URL, provider);
  const apiKey = payload.apiKey || process.env.OPENAI_API_KEY || '';
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
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/ai') {
    await handleAi(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/models') {
    await handleModels(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    handleConfig(req, res);
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
    if (!filePath.startsWith(root)) {
      send(req, res, 403, 'Forbidden');
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
