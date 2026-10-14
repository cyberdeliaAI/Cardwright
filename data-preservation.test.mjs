import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { runLocalAudit } from './audit.js';
import { embedCharaChunk } from './png.js';
import { estimateTokens } from './token-utils.js';
import { APP_VERSION } from './version.js';
import { getPlaceholderPreset, getPlaceholderContext, formatPlaceholderTemplate, buildPlaceholderInstructions } from './placeholders.js';

const source = (await readFile(new URL('./app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLZkAAAAASUVORK5CYII=',
  'base64',
);
const snapshot = (value) => JSON.parse(JSON.stringify(value));

// Execute the existing frontend and its event handlers with isolated browser
// state. No real browser storage, provider requests, or production exports needed.
async function createApp(savedStorage = new Map(), options = {}) {
  const storage = new Map(savedStorage);
  const nodes = new Map();
  const blobs = new Map();
  const downloads = [];
  const windowEvents = new Map();
  const aiRequests = [];
  const modelRequests = [];
  const clipboardWrites = [];

  function element(tag = 'div') {
    let html = '';
    let value = '';
    const classes = new Set();
    const events = new Map();
    const node = {
      tag, disabled: false, textContent: '', dataset: {}, children: [],
      get value() { return value; },
      set value(text) {
        value = tag === 'textarea' ? String(text).replace(/\r\n?/g, '\n') : String(text);
      },
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, enabled = !classes.has(name)) {
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
      },
      addEventListener(type, callback) { events.set(type, callback); },
      emit(type, event = { target: node }) { return events.get(type)?.(event); },
      click() {
        if (tag === 'a') downloads.push(blobs.get(node.href));
        return node.emit('click');
      },
      appendChild(child) { node.children.push(child); },
      prepend(child) { node.children.unshift(child); },
      attributes: {},
      setAttribute(name, value) { node.attributes[name] = value; },
      focus() {},
      setSelectionRange() {},
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector) {
        const matches = [];
        for (const child of node.children) {
          const tagMatch = selector.match(/^(textarea|button)/);
          const classMatch = selector.match(/^\.([\w-]+)/);
          const keyMatch = selector.match(/\[data-key(?:="([^"]+)")?\]/);
          if ((!tagMatch || child.tag === tagMatch[1])
            && (!classMatch || child.className?.split(' ').includes(classMatch[1]))
            && (!keyMatch || (child.dataset.key != null
              && (keyMatch[1] == null || child.dataset.key === keyMatch[1])))) {
            matches.push(child);
          }
          matches.push(...child.querySelectorAll(selector));
        }
        return matches;
      },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        node.children = [];
        for (const match of value.matchAll(/<(button|textarea)\b([^>]*)>/g)) {
          const child = element(match[1]);
          child.dataset.key = match[2].match(/data-key="([^"]+)"/)?.[1];
          child.className = match[2].match(/class="([^"]+)"/)?.[1] || '';
          node.children.push(child);
        }
      },
    };
    if (tag === 'canvas') {
      node.getContext = () => ({ drawImage() {} });
      node.toDataURL = () => `data:image/png;base64,${pngBytes.toString('base64')}`;
      node.toBlob = (callback) => callback(new Blob([pngBytes], { type: 'image/png' }));
    }
    return node;
  }

  const tabs = ['concept', 'card', 'lore', 'audit'].map((view) => {
    const tab = element('button');
    tab.dataset.view = view;
    return tab;
  });
  const context = vm.createContext({
    crypto: { randomUUID },
    console, structuredClone, Blob, Uint8Array, DataView, TextEncoder, TextDecoder,
    atob, btoa, estimateTokens, runLocalAudit, embedCharaChunk, APP_VERSION,
    getPlaceholderPreset, getPlaceholderContext, formatPlaceholderTemplate, buildPlaceholderInstructions,
    openCropper: async () => null,
    setTimeout: () => 0,
    clearTimeout() {},
    Image: class {
      complete = true;
      naturalWidth = 1;
      naturalHeight = 1;
      set src(value) { this.url = value; this.onload?.(); }
    },
    URL: class extends URL {
      static createObjectURL(blob) {
        const url = `blob:test-${blobs.size}`;
        blobs.set(url, blob);
        return url;
      }
      static revokeObjectURL() {}
    },
    fetch: async (url, request) => {
      if (url === '/api/ai') {
        const payload = JSON.parse(request.body);
        aiRequests.push(payload);
        assert.ok(options.respondToAi, 'Unexpected AI request');
        return options.respondToAi(payload);
      }
      assert.ok(['/api/config', '/api/models'].includes(url), `Unexpected request: ${url}`);
      if (url === '/api/models') {
        const payload = JSON.parse(request.body);
        modelRequests.push(payload);
        if (options.respondToModels) return options.respondToModels(payload);
      }
      return { ok: true, json: async () => ({ provider: 'lmstudio', models: [] }) };
    },
    navigator: {
      clipboard: {
        async writeText(text) {
          await options.writeClipboard?.(text);
          clipboardWrites.push(text);
        },
      },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        options.writeStorage?.(key, value);
        storage.set(key, value);
      },
      removeItem: (key) => storage.delete(key),
    },
    window: {
      addEventListener: (type, callback) => windowEvents.set(type, callback),
      confirm: () => true,
    },
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element(['fieldEditor', 'avatarPromptEditor', 'personaDescriptionInput'].includes(id) ? 'textarea' : 'div'));
        return nodes.get(id);
      },
      querySelectorAll: (selector) => selector === '.view-tab' ? tabs : [],
      createElement: element,
      addEventListener() {},
    },
  });
  await vm.runInContext(`(async () => {
    ${source}
    globalThis.app = {
      get card() { return card; },
      els, loadFile, setView, renderConceptResults, applyConceptField,
      applyAllConceptFields, persistCard, addLoreEntry, updateEntry,
      deleteLoreEntry, setAvatar, exportPng, readPngCard,
      importPersonaPresets, runFieldAction, runAiAudit, runLoreAudit,
      improveEntryWithAi, fixAuditIssue,
      getResolvedSettings, autoDetectModel, testAiConnection,
      selectField(key) {
        const index = FIELD_DEFS.findIndex((field) => field.key === key);
        return els.fieldNav.children[index].click();
      },
    };
  })()`, context);
  return {
    ...context.app,
    get card() { return context.app.card; },
    storage, downloads, aiRequests, modelRequests, clipboardWrites,
    unload: () => windowEvents.get('beforeunload')(),
  };
}

async function importJson(app, card) {
  await app.loadFile({ name: 'fixture.json', text: async () => JSON.stringify(card) });
  assert.equal(app.els.logOutput.textContent, 'Loaded fixture.json.');
}

const basicCard = () => ({ data: {
  name: 'Aster', description: 'Original description', personality: 'Quiet and curious',
  first_mes: 'Welcome, {{user}}. What brings you here?',
} });

for (const applyAll of [false, true]) {
  for (const nextAction of ['audit', 'json', 'png', 'navigation', 'reload']) {
    test(`concept ${applyAll ? 'apply all' : 'apply field'} survives ${nextAction}`, async () => {
      const app = await createApp();
      await importJson(app, basicCard());
      app.setView('concept');
      app.els.conceptInput.value = 'A lighthouse keeper';
      app.els.conceptInput.emit('input');
      app.renderConceptResults({ description: 'Generated description', personality: 'New personality' });
      if (applyAll) app.applyAllConceptFields();
      else app.applyConceptField('description');

      let result;
      if (nextAction === 'audit') {
        app.setView('audit');
        result = app.card;
      } else if (nextAction === 'json') {
        app.els.downloadBtn.click();
        result = JSON.parse(await app.downloads.at(-1).text());
      } else if (nextAction === 'png') {
        app.setAvatar('data:image/png;base64,test');
        await app.exportPng();
        result = await app.readPngCard(app.downloads.at(-1));
      } else if (nextAction === 'navigation') {
        app.selectField('personality');
        result = app.card;
        assert.equal(app.els.fieldEditor.value, applyAll ? 'New personality' : 'Quiet and curious');
      } else {
        app.unload();
        const restored = await createApp(app.storage);
        result = restored.card;
      }
      assert.equal(result.data.description, 'Generated description');
      assert.equal(result.data.extensions.cardwright_concept, 'A lighthouse keeper');
      if (applyAll) assert.equal(result.data.personality, 'New personality');
    });
  }
}

test('active card editor still commits edits before export and navigation', async () => {
  const app = await createApp();
  await importJson(app, basicCard());
  app.els.fieldEditor.value = 'Manual description';
  app.els.downloadBtn.click();
  const exported = JSON.parse(await app.downloads.at(-1).text());
  assert.equal(exported.data.description, 'Manual description');
  app.els.fieldEditor.value = 'Latest description';
  app.selectField('personality');
  assert.equal(app.card.data.description, 'Latest description');
  assert.equal(app.card.data.personality, 'Quiet and curious');
});

function legacyBook() {
  return {
    name: 'Harbor lore', scan_depth: 4, token_budget: 900,
    extensions: { custom: { keep: true } },
    entries: [{
      id: 7, keys: ['harbor'], content: 'Original lore', enabled: true,
      extensions: { source: 'legacy' },
    }],
  };
}

test('adding to a legacy lorebook preserves its entries and metadata', async () => {
  const app = await createApp();
  const book = legacyBook();
  await importJson(app, { ...basicCard(), character_book: book });
  app.addLoreEntry();
  assert.deepEqual(snapshot(app.card.data.character_book.entries[0]), book.entries[0]);
  assert.equal(app.card.data.character_book.entries.length, 2);
  assert.equal(app.card.data.character_book.name, book.name);
  assert.deepEqual(snapshot(app.card.data.character_book.extensions), book.extensions);
  assert.equal(app.card.data.character_book.scan_depth, 4);
  assert.equal(app.card.data.character_book.token_budget, 900);
  assert.strictEqual(app.card.character_book, app.card.data.character_book);
});

test('renaming a legacy lorebook preserves its entries', async () => {
  const app = await createApp();
  const book = legacyBook();
  await importJson(app, { ...basicCard(), character_book: book });
  app.setView('lore');
  app.els.loreNameInput.value = 'Renamed lore';
  app.els.loreNameInput.emit('input');
  assert.equal(app.card.data.character_book.name, 'Renamed lore');
  assert.deepEqual(snapshot(app.card.data.character_book.entries), book.entries);
});

test('lorebook mirrors stay consistent through editing, reload, deletion and export', async () => {
  const app = await createApp();
  const book = legacyBook();
  await importJson(app, { ...basicCard(), data: { ...basicCard().data, character_book: book }, character_book: book });
  app.setView('lore');
  app.updateEntry((entry) => { entry.content = 'Updated lore'; });
  assert.equal(app.card.character_book.entries[0].content, 'Updated lore');
  app.persistCard();
  const restored = await createApp(app.storage);
  assert.strictEqual(restored.card.character_book, restored.card.data.character_book);
  assert.equal(restored.card.character_book.entries[0].content, 'Updated lore');
  restored.deleteLoreEntry();
  restored.els.downloadBtn.click();
  const exported = JSON.parse(await restored.downloads.at(-1).text());
  assert.deepEqual(exported.data.character_book.entries, []);
  assert.deepEqual(exported.character_book, exported.data.character_book);
  assert.deepEqual(exported.data.character_book.extensions, book.extensions);
});

test('nested lorebook remains authoritative when both locations contain different books', async () => {
  const app = await createApp();
  await importJson(app, {
    data: { ...basicCard().data, character_book: legacyBook() },
    character_book: { name: 'Outdated mirror', entries: [] },
  });
  app.addLoreEntry();
  assert.equal(app.card.character_book.name, 'Harbor lore');
  assert.equal(app.card.character_book.entries[0].content, 'Original lore');
  assert.strictEqual(app.card.character_book, app.card.data.character_book);
});

const greetings = ['  Opening A  ', '', 'line A\n---\nline B', '\nÉowyn 🌙\r\n', '{{char}} meets {{user}}'];

for (const location of ['nested', 'legacy']) {
  test(`${location} greetings survive JSON/PNG import, export and autosave exactly`, async () => {
    const app = await createApp();
    const fixture = basicCard();
    if (location === 'nested') fixture.data.alternate_greetings = greetings;
    else fixture.alternate_greetings = greetings;
    await importJson(app, fixture);
    assert.deepEqual(snapshot(app.card.data.alternate_greetings), greetings);
    app.els.downloadBtn.click();
    const exported = JSON.parse(await app.downloads.at(-1).text());
    assert.deepEqual(exported.data.alternate_greetings, greetings);
    assert.deepEqual(exported.alternate_greetings, greetings);

    const png = embedCharaChunk(pngBytes, JSON.stringify(fixture));
    await app.loadFile({ name: 'fixture.png', arrayBuffer: async () => png.buffer });
    assert.equal(app.els.logOutput.textContent, 'Loaded fixture.png.');
    app.persistCard();
    const restored = await createApp(app.storage);
    assert.deepEqual(snapshot(restored.card.data.alternate_greetings), greetings);
    assert.deepEqual(snapshot(restored.card.alternate_greetings), greetings);
  });
}

test('editing one greeting preserves all other greetings and their formatting', async () => {
  const app = await createApp();
  await importJson(app, { data: { ...basicCard().data, alternate_greetings: greetings } });
  app.selectField('alternate_greetings');
  app.els.nextGreetingBtn.click();
  app.els.fieldEditor.value = 'A new second greeting';
  app.els.fieldEditor.emit('input');
  app.els.downloadBtn.click();
  const exported = JSON.parse(await app.downloads.at(-1).text());
  assert.deepEqual(exported.data.alternate_greetings, [greetings[0], 'A new second greeting', ...greetings.slice(2)]);
});

test('viewing an empty greeting list does not create a greeting during export', async () => {
  const app = await createApp();
  await importJson(app, { data: { ...basicCard().data, alternate_greetings: [] } });
  app.selectField('alternate_greetings');
  app.els.downloadBtn.click();
  const exported = JSON.parse(await app.downloads.at(-1).text());
  assert.deepEqual(exported.data.alternate_greetings, []);
});

test('viewing a greeting with CRLF line endings does not change its stored text', async () => {
  const app = await createApp();
  await importJson(app, { data: { ...basicCard().data, alternate_greetings: greetings } });
  app.selectField('alternate_greetings');
  for (let index = 0; index < 3; index++) app.els.nextGreetingBtn.click();
  assert.equal(app.els.fieldEditor.value, '\nÉowyn 🌙\n');
  app.els.downloadBtn.click();
  const exported = JSON.parse(await app.downloads.at(-1).text());
  assert.deepEqual(exported.data.alternate_greetings, greetings);
});

test('legacy delimiter-separated greeting strings remain supported', async () => {
  const app = await createApp();
  await importJson(app, { ...basicCard(), alternate_greetings: 'First opening\n---\nSecond opening' });
  assert.deepEqual(snapshot(app.card.data.alternate_greetings), ['First opening', 'Second opening']);
});

function aiResponse(content) {
  return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
}

test('avatar prompt requires a card with descriptive context', async () => {
  const app = await createApp();
  assert.equal(app.els.generateAvatarPromptBtn.disabled, true);
  assert.equal(app.els.copyAvatarPromptBtn.disabled, true);
  app.els.newCardBtn.click();
  await app.els.generateAvatarPromptBtn.click();
  assert.match(app.els.avatarPromptStatus.textContent, /Add a description/);
  assert.equal(app.aiRequests.length, 0);
});

test('avatar prompt uses the selected provider and current concept-applied card without changing it', async () => {
  const app = await createApp(new Map(), {
    respondToAi: () => aiResponse('A quiet lighthouse keeper, weathered coat, coastal fog, 2:3 portrait.'),
  });
  await importJson(app, basicCard());
  app.els.providerInput.value = 'custom';
  app.els.baseUrlInput.value = 'https://provider.example/v1';
  app.els.modelInput.value = 'portrait-writer';
  app.els.apiKeyInput.value = 'test-key';
  app.setView('concept');
  app.els.conceptInput.value = 'A lighthouse keeper';
  app.els.conceptInput.emit('input');
  app.renderConceptResults({ description: 'A keeper in a weathered coat' });
  app.applyConceptField('description');
  const before = snapshot(app.card);
  await app.els.generateAvatarPromptBtn.click();

  assert.equal(app.aiRequests.length, 1);
  const request = app.aiRequests[0];
  assert.equal(request.provider, 'custom');
  assert.equal(request.baseUrl, 'https://provider.example/v1');
  assert.equal(request.model, 'portrait-writer');
  assert.equal(request.apiKey, 'test-key');
  assert.match(request.messages[1].content, /A keeper in a weathered coat/);
  assert.match(request.messages[1].content, /A lighthouse keeper/);
  assert.equal(app.els.avatarPromptEditor.value, 'A quiet lighthouse keeper, weathered coat, coastal fog, 2:3 portrait.');
  assert.equal(app.els.avatarPromptEditor.disabled, false);
  assert.equal(app.els.copyAvatarPromptBtn.disabled, false);
  assert.equal(app.els.avatarPromptOutput.classList.contains('hidden'), false);
  assert.deepEqual(snapshot(app.card), before);
  assert.equal(app.els.downloadPngBtn.disabled, true);
});

test('copying uses the edited avatar prompt and clearing it disables copying', async () => {
  const app = await createApp(new Map(), { respondToAi: () => aiResponse('Original portrait prompt') });
  await importJson(app, basicCard());
  await app.els.generateAvatarPromptBtn.click();
  app.els.avatarPromptEditor.value = 'Edited portrait prompt\nwith moonlight';
  app.els.avatarPromptEditor.emit('input');
  await app.els.copyAvatarPromptBtn.click();
  assert.deepEqual(app.clipboardWrites, ['Edited portrait prompt\nwith moonlight']);
  assert.equal(app.els.copyAvatarPromptBtn.attributes['aria-label'], 'Avatar prompt copied');
  app.els.avatarPromptEditor.value = '   ';
  app.els.avatarPromptEditor.emit('input');
  assert.equal(app.els.copyAvatarPromptBtn.disabled, true);
  assert.equal(app.els.copyAvatarPromptBtn.textContent, '⧉');
});

test('edited avatar prompts survive browser restore and stay out of JSON/PNG exports', async () => {
  const app = await createApp(new Map(), { respondToAi: () => aiResponse('Portrait prompt') });
  await importJson(app, basicCard());
  await app.els.generateAvatarPromptBtn.click();
  app.els.avatarPromptEditor.value = 'Edited portrait prompt';
  app.els.avatarPromptEditor.emit('input');
  app.unload();
  const restored = await createApp(app.storage);
  assert.equal(restored.els.avatarPromptEditor.value, 'Edited portrait prompt');
  assert.equal(restored.els.copyAvatarPromptBtn.disabled, false);
  assert.equal(restored.els.avatarPromptOutput.classList.contains('hidden'), false);
  restored.els.downloadBtn.click();
  const json = await restored.downloads.at(-1).text();
  assert.equal(json.includes('Edited portrait prompt'), false);
  restored.setAvatar('data:image/png;base64,test');
  await restored.exportPng();
  const pngCard = await restored.readPngCard(restored.downloads.at(-1));
  assert.equal(JSON.stringify(pngCard).includes('Edited portrait prompt'), false);
});

for (const failure of ['provider', 'empty']) {
  test(`avatar ${failure} failure preserves the existing prompt and re-enables controls`, async () => {
    const app = await createApp(new Map(), {
      respondToAi: () => failure === 'provider'
        ? { ok: false, text: async () => JSON.stringify({ error: { message: 'Provider unavailable' } }) }
        : aiResponse('<think>Only internal reasoning</think>'),
    });
    await importJson(app, basicCard());
    app.els.avatarPromptEditor.value = 'Keep this edited prompt';
    app.els.avatarPromptEditor.emit('input');
    const before = snapshot(app.card);
    await app.els.generateAvatarPromptBtn.click();
    assert.match(app.els.avatarPromptStatus.textContent, /Avatar prompt failed:/);
    assert.equal(app.els.avatarPromptEditor.value, 'Keep this edited prompt');
    assert.equal(app.els.avatarPromptEditor.disabled, false);
    assert.equal(app.els.generateAvatarPromptBtn.disabled, false);
    assert.equal(app.els.copyAvatarPromptBtn.disabled, false);
    assert.deepEqual(snapshot(app.card), before);
  });
}

test('clipboard failure leaves the avatar prompt available for manual copying', async () => {
  const app = await createApp(new Map(), {
    respondToAi: () => aiResponse('Portrait prompt'),
    writeClipboard: async () => { throw new Error('Clipboard permission denied'); },
  });
  await importJson(app, basicCard());
  await app.els.generateAvatarPromptBtn.click();
  await app.els.copyAvatarPromptBtn.click();
  assert.match(app.els.avatarPromptStatus.textContent, /Could not copy/);
  assert.equal(app.els.avatarPromptEditor.value, 'Portrait prompt');
  assert.equal(app.els.copyAvatarPromptBtn.disabled, false);
});

for (const replaceCard of [false, true]) {
  test(`pending avatar response is ignored after ${replaceCard ? 'importing another card' : 'starting a new card'}`, async () => {
    let resolveResponse;
    let signalRequest;
    const started = new Promise((resolve) => { signalRequest = resolve; });
    const app = await createApp(new Map(), {
      respondToAi: () => {
        signalRequest();
        return new Promise((resolve) => { resolveResponse = resolve; });
      },
    });
    await importJson(app, basicCard());
    const pending = app.els.generateAvatarPromptBtn.click();
    await started;
    assert.equal(app.els.generateAvatarPromptBtn.disabled, true);
    assert.equal(app.els.avatarPromptEditor.disabled, true);
    await app.els.generateAvatarPromptBtn.click();
    assert.equal(app.aiRequests.length, 1);
    if (replaceCard) await importJson(app, { data: { name: 'Other character', description: 'Another card' } });
    else app.els.newCardBtn.click();
    const before = snapshot(app.card);
    resolveResponse(aiResponse('A portrait for the old card'));
    await pending;
    assert.equal(app.els.avatarPromptEditor.value, '');
    assert.equal(app.els.copyAvatarPromptBtn.disabled, true);
    assert.equal(app.els.generateAvatarPromptBtn.disabled, false);
    assert.equal(app.els.avatarPromptOutput.classList.contains('hidden'), true);
    assert.deepEqual(snapshot(app.card), before);
  });
}

test('avatar controls are connected to the HTML interface', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const id of ['generateAvatarPromptBtn', 'avatarPromptOutput', 'avatarPromptEditor', 'copyAvatarPromptBtn', 'avatarPromptStatus']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<textarea[^>]*id="avatarPromptEditor"/);
  assert.match(html, /aria-label="Copy avatar prompt"/);
});

const personaStorageKey = 'cardwright_persona_presets';
const personaFixture = () => ({ id: 'mira-original', name: 'Mira', description: 'PersonaOnlyMarker_51a: a curious academy student.\nKeeps a notebook.' });
const personaBackup = (presets) => ({ version: 1, presets });
const library = (app) => JSON.parse(app.storage.get(personaStorageKey) || '{"version":1,"presets":[]}');

function choosePersona(app, id = '') {
  app.els.personaPresetSelect.value = id ? `preset:${id}` : '';
  app.els.personaPresetSelect.emit('change');
}

function editPersona(app, name, description) {
  app.els.personaNameInput.value = name;
  app.els.personaDescriptionInput.value = description;
  app.els.personaDescriptionInput.emit('input');
}

async function importPersonas(app, presets) {
  await app.importPersonaPresets({ text: async () => JSON.stringify(personaBackup(presets)) });
}

function generationCard() {
  return { data: {
    ...basicCard().data,
    extensions: { custom: { preserved: true }, cardwright_concept: 'A lighthouse keeper in a coastal town' },
    alternate_greetings: greetings,
    character_book: legacyBook(),
  } };
}

test('persona creation, card-copy edits and explicit updates preserve card data and stable IDs', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  const before = snapshot(app.card);
  app.els.newPersonaBtn.click();
  editPersona(app, 'Mira', 'A curious student');
  assert.equal(library(app).presets.length, 0);
  app.els.savePersonaBtn.click();
  const saved = library(app).presets[0];
  assert.ok(saved.id);
  editPersona(app, 'Mira', 'An experienced student');
  assert.equal(library(app).presets[0].description, 'A curious student');
  assert.equal(app.els.personaPresetSelect.value, 'custom');
  app.els.savePersonaBtn.click();
  assert.equal(library(app).presets[0].id, saved.id);
  assert.equal(library(app).presets[0].description, 'An experienced student');
  assert.deepEqual(snapshot(app.card), before);
});

test('the selected persona snapshot survives reload even if the saved library changes', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  app.unload();
  app.storage.set(personaStorageKey, JSON.stringify(personaBackup([{ ...personaFixture(), description: 'Changed library version' }])));
  const restored = await createApp(app.storage);
  assert.equal(restored.els.personaNameInput.value, 'Mira');
  assert.equal(restored.els.personaDescriptionInput.value, personaFixture().description);
  assert.equal(restored.els.personaPresetSelect.value, 'custom');
  assert.deepEqual(snapshot(restored.card), snapshot(app.card));
});

test('deleting a saved persona keeps the active card copy through reload', async () => {
  const app = await createApp();
  await importJson(app, basicCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  app.els.deletePersonaBtn.click();
  assert.deepEqual(library(app).presets, []);
  assert.equal(app.els.personaDescriptionInput.value, personaFixture().description);
  app.unload();
  const restored = await createApp(app.storage);
  assert.equal(restored.els.personaPresetSelect.value, 'custom');
  assert.equal(restored.els.personaDescriptionInput.value, personaFixture().description);
  assert.equal(restored.els.deletePersonaBtn.disabled, true);
});

test('new cards and JSON/PNG imports default to None while retaining the preset library', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  app.els.newCardBtn.click();
  assert.equal(app.els.personaPresetSelect.value, '');
  choosePersona(app, personaFixture().id);
  await importJson(app, generationCard());
  assert.equal(app.els.personaPresetSelect.value, '');
  choosePersona(app, personaFixture().id);
  const bytes = embedCharaChunk(pngBytes, JSON.stringify(generationCard()));
  await app.loadFile({ name: 'fixture.png', arrayBuffer: async () => bytes.buffer });
  assert.equal(app.els.personaPresetSelect.value, '');
  assert.equal(library(app).presets.length, 1);
  assert.equal(app.els.personaEditor.classList.contains('hidden'), true);
});

test('persona back-ups round-trip exactly and exclude unsaved card-copy edits', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  const preset = { ...personaFixture(), description: '  Éowyn 🌙\r\n{{user}} keeps a notebook.  ' };
  await importPersonas(app, [preset]);
  choosePersona(app, preset.id);
  editPersona(app, 'Local name', 'Unsaved local version');
  app.els.exportPersonasBtn.click();
  const file = app.downloads.at(-1);
  assert.deepEqual(JSON.parse(await file.text()), personaBackup([preset]));
  const other = await createApp();
  await other.importPersonaPresets(file);
  assert.deepEqual(library(other), personaBackup([preset]));
  assert.equal(other.els.personaPresetSelect.value, '');
  assert.equal(app.els.personaNameInput.value, 'Local name');
});

test('import preserves conflicting versions, deduplicates repeated backups and keeps the current card copy', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  editPersona(app, 'Current copy', 'Local-only description');
  const before = snapshot(app.card);
  const conflict = { ...personaFixture(), description: 'Different imported version' };
  await importPersonas(app, [conflict]);
  const firstImport = library(app);
  assert.equal(firstImport.presets.length, 2);
  assert.deepEqual(firstImport.presets[0], personaFixture());
  assert.notEqual(firstImport.presets[1].id, conflict.id);
  assert.equal(firstImport.presets[1].description, conflict.description);
  await importPersonas(app, [conflict]);
  assert.deepEqual(library(app), firstImport);
  await importPersonas(app, [{ ...personaFixture(), id: 'same-content-another-id' }]);
  assert.deepEqual(library(app), firstImport);
  assert.equal(app.els.personaNameInput.value, 'Current copy');
  assert.equal(app.els.personaDescriptionInput.value, 'Local-only description');
  assert.deepEqual(snapshot(app.card), before);
});

for (const invalid of [
  '{broken JSON',
  JSON.stringify({ version: 2, presets: [personaFixture()] }),
  JSON.stringify({ version: 1, presets: [personaFixture(), { id: 'bad', name: 'Missing description' }] }),
  JSON.stringify({ version: 1, presets: [personaFixture(), personaFixture()] }),
  JSON.stringify({ version: 1, presets: [{ ...personaFixture(), description: 42 }] }),
]) {
  test(`invalid persona backup is rejected atomically: ${invalid.slice(0, 45)}`, async () => {
    const app = await createApp();
    await importJson(app, generationCard());
    await importPersonas(app, [personaFixture()]);
    choosePersona(app, personaFixture().id);
    const before = snapshot(app.card);
    const stored = app.storage.get(personaStorageKey);
    await app.importPersonaPresets({ text: async () => invalid });
    assert.match(app.els.personaStatus.textContent, /Could not import presets:/);
    assert.equal(app.storage.get(personaStorageKey), stored);
    assert.equal(app.els.personaDescriptionInput.value, personaFixture().description);
    assert.deepEqual(snapshot(app.card), before);
  });
}

test('failed preset writes preserve the existing library, card and edited persona', async () => {
  let rejectWrites = false;
  const app = await createApp(new Map(), {
    writeStorage: (key) => { if (rejectWrites && key === personaStorageKey) throw new Error('Quota exceeded'); },
  });
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  const stored = app.storage.get(personaStorageKey);
  const before = snapshot(app.card);
  rejectWrites = true;
  editPersona(app, 'Mira', 'Keep my unsaved edits');
  app.els.savePersonaBtn.click();
  assert.match(app.els.personaStatus.textContent, /Could not save presets/);
  await importPersonas(app, [{ id: 'new', name: 'Other', description: 'Another persona' }]);
  assert.equal(app.storage.get(personaStorageKey), stored);
  assert.equal(app.els.personaDescriptionInput.value, 'Keep my unsaved edits');
  assert.deepEqual(snapshot(app.card), before);
});

test('a corrupt stored preset library is kept without blocking restoration of the card', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  app.unload();
  app.storage.set(personaStorageKey, '{corrupt');
  const restored = await createApp(app.storage);
  assert.deepEqual(snapshot(restored.card), snapshot(app.card));
  assert.equal(restored.storage.get(personaStorageKey), '{corrupt');
  assert.equal(restored.els.importPersonasBtn.disabled, true);
  assert.match(restored.els.personaStatus.textContent, /Could not read the preset library/);
});

test('persona context produces reviewable generation drafts without mutating card data or export metadata', async () => {
  const app = await createApp(new Map(), {
    respondToAi: () => aiResponse(JSON.stringify({ description: 'Generated {{char}} meeting {{user}}' })),
  });
  await importJson(app, generationCard());
  app.setView('concept');
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  const before = snapshot(app.card);
  await app.els.generateBtn.click();
  const request = app.aiRequests[0];
  assert.match(request.messages[1].content, /User Persona \(reference for \{\{user\}\}\)/);
  assert.match(request.messages[1].content, /PersonaOnlyMarker_51a/);
  assert.match(request.messages[0].content, /not the identity of \{\{char\}\}/);
  assert.deepEqual(snapshot(app.card), before);
  app.applyConceptField('description');
  const expected = structuredClone(before);
  expected.data.description = expected.description = 'Generated {{char}} meeting {{user}}';
  assert.deepEqual(snapshot(app.card), expected);
  app.els.downloadBtn.click();
  const json = JSON.parse(await app.downloads.at(-1).text());
  assert.deepEqual(json, expected);
  app.setAvatar('data:image/png;base64,test');
  await app.exportPng();
  assert.deepEqual(snapshot(await app.readPngCard(app.downloads.at(-1))), expected);
});

test('None and unfinished personas preserve existing generation behavior', async () => {
  const app = await createApp(new Map(), { respondToAi: () => aiResponse('{"description":"Draft"}') });
  await importJson(app, generationCard());
  await app.els.generateBtn.click();
  assert.equal(JSON.stringify(app.aiRequests[0].messages).includes('User Persona'), false);
  app.els.newPersonaBtn.click();
  editPersona(app, 'Incomplete persona', '');
  await app.els.generateBtn.click();
  assert.equal(app.aiRequests.length, 1);
  assert.match(app.els.conceptLog.textContent, /Complete the persona/);
  choosePersona(app);
  await app.els.generateBtn.click();
  assert.equal(app.aiRequests.length, 2);
  assert.equal(JSON.stringify(app.aiRequests[1].messages).includes('User Persona'), false);
});

test('persona context is sent only for concept generation, never for edits, audits, lore or avatar prompts', async () => {
  const app = await createApp(new Map(), {
    respondToAi: (payload) => aiResponse(JSON.stringify(payload.messages).includes('Create a Character Card V2 card')
      ? '{"description":"Generated character draft"}' : 'Reviewed text'),
  });
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  await app.els.generateBtn.click();
  await app.runFieldAction('rewrite');
  await app.fixAuditIssue({ field: 'description', message: 'Improve clarity', severity: 'info' });
  await app.runAiAudit();
  await app.runLoreAudit();
  await app.improveEntryWithAi();
  await app.els.generateAvatarPromptBtn.click();
  assert.equal(app.aiRequests.length, 7);
  assert.equal(app.aiRequests.filter((request) => JSON.stringify(request.messages).includes('PersonaOnlyMarker_51a')).length, 1);
  for (const request of app.aiRequests.slice(1)) {
    assert.equal(JSON.stringify(request.messages).includes('User Persona'), false);
    assert.equal(JSON.stringify(request.messages).includes('PersonaOnlyMarker_51a'), false);
  }
});

for (const replaceCard of [false, true]) {
  test(`late persona generation drafts are ignored after ${replaceCard ? 'card import' : 'New Card'}`, async () => {
    let resolveResponse;
    let signalRequest;
    const started = new Promise((resolve) => { signalRequest = resolve; });
    const app = await createApp(new Map(), {
      respondToAi: () => { signalRequest(); return new Promise((resolve) => { resolveResponse = resolve; }); },
    });
    await importJson(app, generationCard());
    await importPersonas(app, [personaFixture()]);
    choosePersona(app, personaFixture().id);
    const pending = app.els.generateBtn.click();
    await started;
    assert.equal(app.els.personaPresetSelect.disabled, true);
    assert.equal(app.els.personaDescriptionInput.disabled, true);
    assert.equal(app.els.conceptInput.disabled, true);
    await app.els.generateBtn.click();
    assert.equal(app.aiRequests.length, 1);
    if (replaceCard) await importJson(app, generationCard());
    else app.els.newCardBtn.click();
    const before = snapshot(app.card);
    resolveResponse(aiResponse('{"description":"Stale draft for old persona"}'));
    await pending;
    assert.equal(app.els.conceptResults.querySelectorAll('textarea[data-key]').length, 0);
    assert.equal(app.els.personaPresetSelect.value, '');
    assert.equal(app.els.generateBtn.disabled, false);
    assert.deepEqual(snapshot(app.card), before);
  });
}

test('an old generation response cannot unlock or replace a newer card generation', async () => {
  const resolvers = [];
  const started = [];
  const signals = [];
  for (let index = 0; index < 2; index++) started.push(new Promise((resolve) => { signals.push(resolve); }));
  const app = await createApp(new Map(), {
    respondToAi: () => {
      const index = resolvers.length;
      return new Promise((resolve) => { resolvers.push(resolve); signals[index](); });
    },
  });
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  const oldRequest = app.els.generateBtn.click();
  await started[0];
  await importJson(app, generationCard());
  const newRequest = app.els.generateBtn.click();
  await started[1];
  resolvers[0](aiResponse('{"description":"Old draft"}'));
  await oldRequest;
  assert.equal(app.els.generateBtn.disabled, true);
  assert.equal(app.els.personaPresetSelect.disabled, true);
  assert.equal(app.els.conceptResults.querySelectorAll('textarea[data-key]').length, 0);
  resolvers[1](aiResponse('{"description":"New draft"}'));
  await newRequest;
  assert.equal(app.els.generateBtn.disabled, false);
  assert.equal(app.els.conceptResults.querySelector('textarea[data-key="description"]').value, 'New draft');
  assert.equal(app.els.personaPresetSelect.value, '');
});

test('a generation error keeps the selected persona and re-enables editing', async () => {
  const app = await createApp(new Map(), {
    respondToAi: () => ({ ok: false, text: async () => '{"error":"Provider unavailable"}' }),
  });
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePersona(app, personaFixture().id);
  const before = snapshot(app.card);
  await app.els.generateBtn.click();
  assert.match(app.els.conceptLog.textContent, /Generation failed/);
  assert.equal(app.els.personaDescriptionInput.value, personaFixture().description);
  assert.equal(app.els.personaDescriptionInput.disabled, false);
  assert.equal(app.els.conceptInput.disabled, false);
  assert.equal(app.els.generateBtn.disabled, false);
  assert.deepEqual(snapshot(app.card), before);
});

test('all frontend DOM bindings including persona controls exist in the interface', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const match of source.matchAll(/getElementById\('([^']+)'\)/g)) {
    assert.match(html, new RegExp(`id="${match[1]}"`));
  }
});

async function createDeferredAiApp() {
  let signal;
  const started = new Promise((resolve) => { signal = resolve; });
  let reply;
  const app = await createApp(new Map(), {
    respondToAi: () => { signal(); return new Promise((resolve) => { reply = resolve; }); },
  });
  return { app, started, respond: (text) => reply(aiResponse(text)) };
}

const twoLoreEntries = () => ({ data: {
  ...basicCard().data,
  character_book: { entries: [
    { id: 7, comment: 'Harbor', keys: ['harbor'], content: 'First lore' },
    { id: 7, comment: 'Academy', keys: ['academy'], content: 'Second lore' },
  ] },
} });

for (const auditFix of [false, true]) {
  test(`${auditFix ? 'audit fix' : 'field rewrite'} stays attached to Description after navigating and editing Personality`, async () => {
    const { app, started, respond } = await createDeferredAiApp();
    await importJson(app, generationCard());
    const before = snapshot(app.card);
    const pending = auditFix
      ? app.fixAuditIssue({ field: 'description', message: 'Improve clarity', severity: 'info' })
      : app.runFieldAction('rewrite');
    await started;
    app.selectField('personality');
    app.els.fieldEditor.value = 'Manual personality edits';
    app.els.fieldEditor.emit('input');
    respond('Revised description');
    await pending;
    assert.equal(app.card.data.description, before.data.description);
    app.els.applyDraftBtn.click();
    const expected = structuredClone(before);
    expected.data.description = expected.description = 'Revised description';
    expected.data.personality = expected.personality = 'Manual personality edits';
    assert.deepEqual(snapshot(app.card), expected);
  });
}

test('a greeting rewrite targets the original greeting after greeting navigation', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, { data: { ...basicCard().data, alternate_greetings: ['Same opening', 'Same opening', 'Third opening'] } });
  app.selectField('alternate_greetings');
  app.els.nextGreetingBtn.click();
  const pending = app.runFieldAction('rewrite');
  await started;
  app.els.nextGreetingBtn.click();
  respond('Rewritten second opening');
  await pending;
  app.els.applyDraftBtn.click();
  assert.deepEqual(snapshot(app.card.data.alternate_greetings), ['Same opening', 'Rewritten second opening', 'Third opening']);
});

test('a greeting rewrite follows its original target when an earlier identical greeting is deleted', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, { data: { ...basicCard().data, alternate_greetings: ['Same opening', 'Same opening', 'Third opening'] } });
  app.selectField('alternate_greetings');
  app.els.nextGreetingBtn.click();
  const pending = app.runFieldAction('rewrite');
  await started;
  app.els.prevGreetingBtn.click();
  app.els.deleteGreetingBtn.click();
  respond('Rewritten original second opening');
  await pending;
  app.els.applyDraftBtn.click();
  assert.deepEqual(snapshot(app.card.data.alternate_greetings), ['Rewritten original second opening', 'Third opening']);
});

for (const deleteBeforeResponse of [false, true]) {
  test(`a deleted greeting cannot receive an old draft ${deleteBeforeResponse ? 'after its response' : 'during Apply'}`, async () => {
    const { app, started, respond } = await createDeferredAiApp();
    await importJson(app, { data: { ...basicCard().data, alternate_greetings: ['Original target', 'Other opening'] } });
    app.selectField('alternate_greetings');
    const pending = app.runFieldAction('rewrite');
    await started;
    if (deleteBeforeResponse) app.els.deleteGreetingBtn.click();
    respond('Old rewrite');
    await pending;
    if (!deleteBeforeResponse) app.els.deleteGreetingBtn.click();
    app.els.applyDraftBtn.click();
    assert.deepEqual(snapshot(app.card.data.alternate_greetings), ['Other opening']);
  });
}

test('Apply preserves manual edits made to the target after an AI request', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, generationCard());
  const pending = app.runFieldAction('rewrite');
  await started;
  respond('Outdated description draft');
  await pending;
  app.els.fieldEditor.value = 'Newer manual description';
  app.els.applyDraftBtn.click();
  assert.equal(app.card.data.description, 'Newer manual description');
  assert.match(app.els.logOutput.textContent, /changed|edited/i);
});

for (const auditFix of [false, true]) {
  test(`late ${auditFix ? 'audit fix' : 'field rewrite'} responses do not create drafts for a newly imported card`, async () => {
    const { app, started, respond } = await createDeferredAiApp();
    await importJson(app, generationCard());
    const pending = auditFix
      ? app.fixAuditIssue({ field: 'description', message: 'Improve clarity', severity: 'info' })
      : app.runFieldAction('rewrite');
    await started;
    await importJson(app, generationCard());
    const before = snapshot(app.card);
    respond('Old card draft');
    await pending;
    assert.equal(app.els.draftPanel.classList.contains('hidden'), true);
    app.els.applyDraftBtn.click();
    assert.deepEqual(snapshot(app.card), before);
  });
}

test('lorebook AI updates its original entry without putting that text in another editor or search target', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  const pending = app.improveEntryWithAi();
  await started;
  app.els.loreList.children[1].click();
  app.els.entryAiInstruction.value = 'Instruction for the second entry';
  respond('Improved first lore');
  await pending;
  assert.equal(app.card.data.character_book.entries[0].content, 'Improved first lore');
  assert.equal(app.els.entryContent.value, 'Second lore');
  assert.equal(app.els.entryAiInstruction.value, 'Instruction for the second entry');
  app.els.searchInput.value = 'Second lore';
  app.els.searchBtn.click();
  app.els.searchNextBtn.click();
  assert.equal(app.card.data.character_book.entries[1].content, 'Second lore');
});

test('lorebook AI follows the original entry object after deleting an earlier entry with the same ID', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  app.els.loreList.children[1].click();
  const pending = app.improveEntryWithAi();
  await started;
  app.els.loreList.children[0].click();
  app.els.deleteEntryBtn.click();
  respond('Improved second lore');
  await pending;
  assert.equal(app.card.data.character_book.entries.length, 1);
  assert.equal(app.card.data.character_book.entries[0].comment, 'Academy');
  assert.equal(app.card.data.character_book.entries[0].content, 'Improved second lore');
});

test('lorebook AI preserves newer manual edits to its original entry', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  const pending = app.improveEntryWithAi();
  await started;
  app.els.entryContent.value = 'Newer manual lore';
  app.els.entryContent.emit('input');
  respond('Outdated lore rewrite');
  await pending;
  assert.equal(app.card.data.character_book.entries[0].content, 'Newer manual lore');
  assert.equal(app.els.entryContent.value, 'Newer manual lore');
});

test('a deleted lore entry cannot populate or overwrite its replacement', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  const pending = app.improveEntryWithAi();
  await started;
  app.els.deleteEntryBtn.click();
  app.addLoreEntry();
  app.els.entryContent.value = 'Replacement lore';
  app.els.entryContent.emit('input');
  const before = snapshot(app.card);
  respond('Rewrite for deleted lore');
  await pending;
  assert.deepEqual(snapshot(app.card), before);
  assert.equal(app.els.entryContent.value, 'Replacement lore');
});

test('late lorebook AI responses cannot update the editor or data of a new card', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  const pending = app.improveEntryWithAi();
  await started;
  await importJson(app, twoLoreEntries());
  const before = snapshot(app.card);
  respond('Old card lore');
  await pending;
  assert.deepEqual(snapshot(app.card), before);
  assert.equal(app.els.entryContent.value, 'First lore');
});

for (const lore of [false, true]) {
  test(`an old ${lore ? 'lore' : 'field'} response cannot unlock or replace a newer request`, async () => {
    const replies = [];
    const signals = [];
    const started = [0, 1].map((index) => new Promise((resolve) => { signals[index] = resolve; }));
    const app = await createApp(new Map(), {
      respondToAi: () => {
        const index = replies.length;
        return new Promise((resolve) => { replies.push(resolve); signals[index](); });
      },
    });
    await importJson(app, twoLoreEntries());
    app.setView(lore ? 'lore' : 'card');
    const request = () => lore ? app.improveEntryWithAi() : app.runFieldAction('rewrite');
    const oldRequest = request();
    await started[0];
    await importJson(app, twoLoreEntries());
    const before = snapshot(app.card);
    const newRequest = request();
    await started[1];
    replies[0](aiResponse('Old request text'));
    await oldRequest;
    assert.equal((lore ? app.els.entryAiBtn : app.els.customAiBtn).disabled, true);
    assert.deepEqual(snapshot(app.card), before);
    assert.equal(app.els.draftPanel.classList.contains('hidden'), true);
    replies[1](aiResponse('New request text'));
    await newRequest;
    assert.equal((lore ? app.els.entryAiBtn : app.els.customAiBtn).disabled, false);
    if (!lore) app.els.applyDraftBtn.click();
    assert.equal(lore ? app.card.data.character_book.entries[0].content : app.card.data.description, 'New request text');
  });

  test(`starting a blank card ignores the pending ${lore ? 'lore' : 'field'} response`, async () => {
    const { app, started, respond } = await createDeferredAiApp();
    await importJson(app, twoLoreEntries());
    app.setView(lore ? 'lore' : 'card');
    const pending = lore ? app.improveEntryWithAi() : app.runFieldAction('rewrite');
    await started;
    app.els.newCardBtn.click();
    const before = snapshot(app.card);
    const logBefore = app.els.logOutput.textContent;
    respond('Old card text');
    await pending;
    app.els.applyDraftBtn.click();
    assert.deepEqual(snapshot(app.card), before);
    assert.equal(app.els.draftPanel.classList.contains('hidden'), true);
    assert.equal(app.els.logOutput.textContent, logBefore);
  });

  test(`a reasoning-only ${lore ? 'lore' : 'field'} response preserves the card`, async () => {
    const app = await createApp(new Map(), { respondToAi: () => aiResponse('<think>Internal reasoning</think>') });
    await importJson(app, twoLoreEntries());
    app.setView(lore ? 'lore' : 'card');
    const before = snapshot(app.card);
    await (lore ? app.improveEntryWithAi() : app.runFieldAction('rewrite'));
    assert.deepEqual(snapshot(app.card), before);
    assert.equal(app.els.draftPanel.classList.contains('hidden'), true);
    assert.match((lore ? app.els.loreLog : app.els.logOutput).textContent, /empty/i);
  });
}

test('deleting and recreating an identical greeting cannot revive an earlier draft', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, { data: { ...basicCard().data, alternate_greetings: ['Same opening'] } });
  app.selectField('alternate_greetings');
  const pending = app.runFieldAction('rewrite');
  await started;
  respond('Old greeting draft');
  await pending;
  app.els.deleteGreetingBtn.click();
  app.els.addGreetingBtn.click();
  app.els.fieldEditor.value = 'Same opening';
  app.els.fieldEditor.emit('input');
  assert.equal(app.els.applyDraftBtn.disabled, true);
  app.els.applyDraftBtn.click();
  assert.deepEqual(snapshot(app.card.data.alternate_greetings), ['Same opening']);
});

test('the draft header names its original field and blocks applying over newer manual edits', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, generationCard());
  const pending = app.runFieldAction('rewrite');
  await started;
  app.selectField('personality');
  respond('Description draft');
  await pending;
  assert.equal(app.els.draftLabel.textContent, 'AI Draft — Description');
  app.selectField('description');
  app.els.fieldEditor.value = 'Newer description';
  app.els.fieldEditor.emit('input');
  assert.equal(app.els.applyDraftBtn.disabled, true);
  assert.match(app.els.draftLabel.textContent, /source edited/);
  assert.equal(app.card.data.description, 'Newer description');
});

test('lorebook AI preserves a newer instruction for the same entry', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  app.els.entryAiInstruction.value = 'Original instruction';
  const pending = app.improveEntryWithAi();
  await started;
  app.els.entryAiInstruction.value = 'New instruction';
  respond('First revision');
  await pending;
  assert.equal(app.els.entryAiInstruction.value, 'New instruction');
  assert.equal(app.els.entryContent.value, 'First revision');
});

test('lorebook AI renders its original result after tab navigation', async () => {
  const { app, started, respond } = await createDeferredAiApp();
  await importJson(app, twoLoreEntries());
  app.setView('lore');
  const pending = app.improveEntryWithAi();
  await started;
  app.setView('card');
  respond('Second revision');
  await pending;
  app.setView('lore');
  assert.equal(app.els.entryContent.value, 'Second revision');
  assert.equal(app.card.data.character_book.entries[1].content, 'Second lore');
});

const savedProvider = (model = 'chosen-local-model') => new Map([
  ['cardwright_settings', JSON.stringify({ provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model, apiKey: 'fixture-key' })],
]);
const modelsResponse = () => ({ ok: true, json: async () => ({ models: [{ id: 'first-local-model' }, { id: 'chosen-local-model' }], selectedModel: 'first-local-model' }) });

test('automatic model detection preserves an explicit local model on reload and during AI edits', async () => {
  const app = await createApp(savedProvider(), { respondToModels: modelsResponse, respondToAi: () => aiResponse('Revised text') });
  await importJson(app, basicCard());
  await app.runFieldAction('rewrite');
  assert.equal(app.els.modelInput.value, 'chosen-local-model');
  assert.equal(app.aiRequests[0].model, 'chosen-local-model');
  assert.equal(app.modelRequests.length, 0);
});

test('Detect Model is explicit and Test preserves the current model', async () => {
  const app = await createApp(savedProvider(), { respondToModels: modelsResponse });
  await app.testAiConnection();
  assert.equal(app.els.modelInput.value, 'chosen-local-model');
  await app.autoDetectModel({ force: true });
  assert.equal(app.els.modelInput.value, 'first-local-model');
});

test('a late model detection cannot overwrite a newer manual model or provider configuration', async () => {
  let reply;
  let signal;
  const started = new Promise((resolve) => { signal = resolve; });
  const app = await createApp(savedProvider(), {
    respondToModels: () => { signal(); return new Promise((resolve) => { reply = resolve; }); },
  });
  const pending = app.autoDetectModel({ force: true });
  await started;
  app.els.providerInput.value = 'openai';
  app.els.providerInput.emit('change');
  app.els.modelInput.value = 'manual-remote-model';
  reply(modelsResponse());
  await pending;
  assert.equal(app.els.modelInput.value, 'manual-remote-model');
  assert.equal(app.els.baseUrlInput.value, 'https://api.openai.com/v1');
  assert.equal(app.els.modelSelect.classList.contains('hidden'), true);
});

test('switching provider clears its API key in the UI and saved settings while preserving card data', async () => {
  const app = await createApp(savedProvider());
  await importJson(app, generationCard());
  const before = snapshot(app.card);
  app.els.providerInput.value = 'ollama';
  app.els.providerInput.emit('change');
  assert.equal(app.els.apiKeyInput.value, '');
  assert.equal(JSON.parse(app.storage.get('cardwright_settings')).apiKey, '');
  assert.deepEqual(snapshot(app.card), before);
});

test('changing a custom endpoint clears the previous endpoint key', async () => {
  const app = await createApp(savedProvider());
  app.els.baseUrlInput.value = 'https://other.example/v1';
  app.els.baseUrlInput.emit('change');
  assert.equal(app.els.apiKeyInput.value, '');
  assert.equal(JSON.parse(app.storage.get('cardwright_settings')).apiKey, '');
});

test('automatic detection still resolves local-model and subsequent AI requests keep the detected choice', async () => {
  const app = await createApp(savedProvider('local-model'), { respondToModels: modelsResponse, respondToAi: () => aiResponse('Revised text') });
  // The startup detection is asynchronous; await a resolution for this request.
  const settings = await app.getResolvedSettings();
  assert.equal(settings.model, 'first-local-model');
  assert.equal(app.els.modelInput.value, 'first-local-model');
  await importJson(app, basicCard());
  const count = app.modelRequests.length;
  await app.runFieldAction('rewrite');
  assert.equal(app.aiRequests[0].model, 'first-local-model');
  assert.equal(app.modelRequests.length, count);
});

for (const testConnection of [false, true]) {
  test(`late ${testConnection ? 'Test' : 'Detect Model'} responses preserve a newer model on the same provider`, async () => {
    let reply;
    let signal;
    const started = new Promise((resolve) => { signal = resolve; });
    const app = await createApp(savedProvider(), {
      respondToModels: () => { signal(); return new Promise((resolve) => { reply = resolve; }); },
    });
    const pending = testConnection ? app.testAiConnection() : app.autoDetectModel({ force: true });
    await started;
    app.els.modelInput.value = 'new-manual-model';
    app.els.modelInput.emit('input');
    reply(modelsResponse());
    await pending;
    assert.equal(app.els.modelInput.value, 'new-manual-model');
    assert.equal(app.els.modelSelect.children.length, 0);
    assert.equal(JSON.parse(app.storage.get('cardwright_settings')).model, 'chosen-local-model');
  });
}

const placeholderFixtures = [
  { id: 'standard', char: '{{char}}', user: '{{user}}' },
  { id: 'single', char: '{char}', user: '{user}' },
  { id: 'character', char: '{character}', user: '{user}' },
];
function choosePlaceholders(app, id) {
  app.els.placeholderPresetSelect.value = id;
  app.els.placeholderPresetSelect.emit('change');
}

for (const preset of placeholderFixtures) {
  test(`${preset.id} preference survives reload and stays outside unchanged JSON/PNG card data and persona backups`, async () => {
    const app = await createApp();
    await importJson(app, generationCard());
    await importPersonas(app, [personaFixture()]);
    choosePersona(app, personaFixture().id);
    const before = snapshot(app.card);
    choosePlaceholders(app, preset.id);
    for (const view of ['concept', 'card', 'lore', 'audit']) app.setView(view);
    app.persistCard();
    const saved = JSON.parse(app.storage.get('cardwright_card'));
    assert.equal(saved.placeholderPresetId, preset.id);
    assert.deepEqual(saved.card, before);
    const restored = await createApp(app.storage);
    assert.equal(restored.els.placeholderPresetSelect.value, preset.id);
    assert.equal(restored.els.personaNameInput.value, personaFixture().name);
    assert.deepEqual(snapshot(restored.card), before);
    app.els.downloadBtn.click();
    assert.deepEqual(JSON.parse(await app.downloads.at(-1).text()), before);
    app.setAvatar('data:image/png;base64,test');
    await app.exportPng();
    assert.deepEqual(snapshot(await app.readPngCard(app.downloads.at(-1))), before);
    app.els.exportPersonasBtn.click();
    assert.deepEqual(JSON.parse(await app.downloads.at(-1).text()), { version: 1, presets: [personaFixture()] });
    await app.loadFile({ name: 'fixture.png', arrayBuffer: async () => embedCharaChunk(pngBytes, JSON.stringify(before)).buffer });
    assert.equal(app.els.placeholderPresetSelect.value, 'standard');
    assert.deepEqual(snapshot(app.card), before);
  });

  test(`${preset.id} drives generation and persona instructions without converting reference data`, async () => {
    const generated = `${preset.char} greets ${preset.user}.`;
    const app = await createApp(new Map(), { respondToAi: () => aiResponse(JSON.stringify({ description: generated })) });
    await importJson(app, generationCard());
    await importPersonas(app, [personaFixture()]);
    choosePersona(app, personaFixture().id);
    app.els.personaDescriptionInput.value = '{{user}} is a student who knows {{char}}. PersonaOnlyMarker_51a';
    app.els.personaDescriptionInput.emit('input');
    app.els.conceptInput.value = '{{char}} is a lighthouse keeper meeting {{user}}.';
    app.els.conceptInput.emit('input');
    const before = snapshot(app.card);
    choosePlaceholders(app, preset.id);
    await app.els.generateBtn.click();
    const [system, user] = app.aiRequests[0].messages;
    assert.ok(system.content.includes(`Role placeholders for this request: ${preset.char} = character; ${preset.user} = player.`));
    assert.ok(system.content.includes(`not the identity of ${preset.char}`));
    assert.ok(user.content.includes(`- mes_example uses <START> blocks with ${preset.char}: / ${preset.user}: lines.`));
    assert.ok(user.content.includes(`User Persona (reference for ${preset.user})`));
    assert.ok(user.content.includes('{{char}} is a lighthouse keeper meeting {{user}}.'));
    assert.ok(user.content.includes('{{user}} is a student who knows {{char}}.'));
    assert.equal(app.els.conceptOutputLabel.textContent, `Generated drafts — ${preset.char} / ${preset.user}`);
    assert.deepEqual(snapshot(app.card), before);
    app.applyConceptField('description');
    const expected = structuredClone(before);
    expected.data.description = expected.description = generated;
    assert.deepEqual(snapshot(app.card), expected);
  });

  for (const auditFix of [false, true]) {
    test(`${preset.id} ${auditFix ? 'audit fix' : 'field edit'} preserves target notation despite another selected preference`, async () => {
      const original = `${preset.char} greets ${preset.user}.`;
      const app = await createApp(new Map(), { respondToAi: () => aiResponse(original + ' A revised scene.') });
      await importJson(app, { data: { ...basicCard().data, first_mes: original } });
      choosePlaceholders(app, preset.id === 'standard' ? 'character' : 'standard');
      app.selectField('first_mes');
      const before = snapshot(app.card);
      await (auditFix ? app.fixAuditIssue({ field: 'first_mes', message: 'Add a hook', severity: 'info' }) : app.runFieldAction('rewrite'));
      const [system, user] = app.aiRequests[0].messages;
      assert.ok(system.content.includes(`Role placeholders for this request: ${preset.char} = character; ${preset.user} = player.`));
      assert.ok(system.content.includes('Do not convert existing notation'));
      assert.ok(user.content.includes(`Write an opening message in ${preset.char} voice`));
      assert.ok(user.content.includes(`clear hook for ${preset.user}`));
      assert.deepEqual(snapshot(app.card), before);
      app.els.applyDraftBtn.click();
      assert.equal(app.card.data.first_mes, original + ' A revised scene.');
    });
  }

  test(`${preset.id} lore editing uses its target tokens while AI audits accept all notations and avatar output remains visual`, async () => {
    const original = `${preset.char} knows ${preset.user} from the academy.`;
    const app = await createApp(new Map(), { respondToAi: () => aiResponse(original + ' Revised reference.') });
    const fixture = twoLoreEntries();
    fixture.data.character_book.entries[0].content = original;
    await importJson(app, fixture);
    choosePlaceholders(app, preset.id === 'standard' ? 'character' : 'standard');
    app.setView('lore');
    await app.improveEntryWithAi();
    assert.ok(app.aiRequests[0].messages[0].content.includes(`Role placeholders for this request: ${preset.char} = character; ${preset.user} = player.`));
    assert.equal(app.card.data.character_book.entries[0].content, original + ' Revised reference.');
    assert.equal(app.card.data.character_book.entries[1].content, 'Second lore');
    const before = snapshot(app.card);
    await app.runAiAudit();
    await app.runLoreAudit();
    for (const request of app.aiRequests.slice(1)) assert.ok(request.messages[0].content.includes('All supported forms are valid regardless of the preferred preset.'));
    await app.els.generateAvatarPromptBtn.click();
    assert.ok(app.aiRequests.at(-1).messages[0].content.includes('output visual descriptions without any role placeholders'));
    assert.deepEqual(snapshot(app.card), before);
  });

  test(`${preset.id} is used for missing roles and UI examples without creating card text`, async () => {
    const app = await createApp(new Map(), { respondToAi: () => aiResponse('Draft') });
    await importJson(app, { data: { ...basicCard().data, first_mes: '' } });
    choosePlaceholders(app, preset.id);
    app.selectField('first_mes');
    const before = snapshot(app.card);
    assert.ok(app.els.aiFieldGuidance.textContent.includes(preset.user));
    assert.ok(app.els.conceptInput.placeholder.includes(preset.user));
    assert.ok(app.els.personaGuidance.textContent.includes(preset.user));
    assert.ok(app.els.auditGuidance.textContent.includes(preset.user));
    await app.runFieldAction('rewrite');
    assert.ok(app.aiRequests[0].messages[1].content.includes(`Write an opening message in ${preset.char} voice`));
    assert.deepEqual(snapshot(app.card), before);
  });
}

test('older autosaves and invalid preferences default to Standard without altering the card', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  const before = snapshot(app.card);
  app.persistCard();
  const saved = JSON.parse(app.storage.get('cardwright_card'));
  for (const id of [undefined, 'unknown', {}, null]) {
    const storage = new Map(app.storage);
    storage.set('cardwright_card', JSON.stringify({ ...saved, placeholderPresetId: id }));
    const restored = await createApp(storage);
    assert.equal(restored.els.placeholderPresetSelect.value, 'standard');
    assert.deepEqual(snapshot(restored.card), before);
  }
});

test('new cards and JSON imports reset the preference without rewriting tokens or presets', async () => {
  const app = await createApp();
  await importJson(app, generationCard());
  await importPersonas(app, [personaFixture()]);
  choosePlaceholders(app, 'character');
  app.els.newCardBtn.click();
  assert.equal(app.els.placeholderPresetSelect.value, 'standard');
  choosePlaceholders(app, 'single');
  await importJson(app, { data: { ...basicCard().data, description: '{character} knows {user}.' } });
  assert.equal(app.els.placeholderPresetSelect.value, 'standard');
  assert.equal(app.card.data.description, '{character} knows {user}.');
  assert.deepEqual(JSON.parse(app.storage.get('cardwright_persona_presets')), personaBackup([personaFixture()]));
});

for (const action of ['generation', 'field', 'lore']) {
  test(`${action} responses keep the request notation when the preference changes while waiting`, async () => {
    const { app, started, respond } = await createDeferredAiApp();
    await importJson(app, generationCard());
    choosePlaceholders(app, 'single');
    app.setView(action === 'lore' ? 'lore' : action === 'generation' ? 'concept' : 'card');
    const before = snapshot(app.card);
    const pending = action === 'generation' ? app.els.generateBtn.click() : action === 'field' ? app.runFieldAction('rewrite') : app.improveEntryWithAi();
    await started;
    choosePlaceholders(app, 'character');
    const revised = '{char} meets {user}. Request snapshot preserved.';
    respond(action === 'generation' ? JSON.stringify({ description: revised }) : revised);
    await pending;
    assert.equal(app.els.placeholderPresetSelect.value, 'character');
    if (action === 'generation') {
      assert.equal(app.els.conceptOutputLabel.textContent, 'Generated drafts — {char} / {user}');
      assert.deepEqual(snapshot(app.card), before);
      app.applyConceptField('description');
      assert.equal(app.card.data.description, revised);
    } else if (action === 'field') {
      assert.match(app.els.draftPlaceholderScope.textContent, /Request notation: \{char\} \/ \{user\}/);
      assert.deepEqual(snapshot(app.card), before);
      app.els.applyDraftBtn.click();
      assert.equal(app.card.data.description, revised);
    } else assert.equal(app.card.data.character_book.entries[0].content, revised);
  });
}
