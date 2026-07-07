import { estimateTokens } from './token-utils.js';
import { runLocalAudit } from './audit.js';
import { openCropper } from './cropper.js';
import { embedCharaChunk } from './png.js';
import { APP_VERSION } from './version.js';

const FIELD_DEFS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'description', label: 'Description', type: 'long' },
  { key: 'personality', label: 'Personality', type: 'long' },
  { key: 'scenario', label: 'Scenario', type: 'long' },
  { key: 'first_mes', label: 'First Message', type: 'long' },
  { key: 'mes_example', label: 'Example Dialogue', type: 'long' },
  { key: 'system_prompt', label: 'System Prompt', type: 'long' },
  { key: 'creator_notes', label: 'Creator Notes', type: 'long' },
  { key: 'character_note', label: 'Character Note', type: 'long' },
  { key: 'alternate_greetings', label: 'Alternate Greetings', type: 'list' },
  { key: 'tags', label: 'Tags', type: 'tags' },
];

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
const DEFAULT_MODEL = 'local-model';
const DEFAULT_PROVIDER = 'lmstudio';

const AI_PROVIDERS = {
  lmstudio: {
    label: 'LM Studio',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    note: 'LM Studio provider. Load a model and start the Local Server, then Detect Model here.',
  },
  omlx: {
    label: 'oMLX',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: DEFAULT_MODEL,
    note: 'oMLX provider for MLX-format models on Apple Silicon. Add the oMLX API key if your server requires one.',
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: DEFAULT_MODEL,
    note: 'Ollama provider. Pull or run a model in Ollama, then Detect Model here.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: 'OpenAI hosted API. Paste an API key and set the model you want to use.',
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    note: 'Custom OpenAI-compatible endpoint. Enter the base URL, API key if needed, and model.',
  },
};

const FIELD_GUIDANCE = {
  name: {
    guidance: 'Names should stay short and exact. AI edits here should preserve spelling and avoid adding titles unless asked.',
    placeholder: 'Make the name more memorable without changing the concept...',
    instruction: 'Treat this as the character name. Return only the final name, with no notes or alternate list.',
  },
  description: {
    guidance: 'Description is the main card body: identity, appearance, behavior, voice cues, relationship hooks, and playable tension.',
    placeholder: 'Sharpen the hook and remove repeated traits...',
    instruction: 'Prioritize roleplay utility, vivid behavior, clear identity, voice cues, and relationship dynamics. Avoid repeating scenario text.',
  },
  personality: {
    guidance: 'Personality should supplement Description, not duplicate it. Keep it focused on stable traits, contradictions, and behavior.',
    placeholder: 'Make the personality more specific and less generic...',
    instruction: 'Write compact personality material with concrete behavioral tells, contradictions, and interaction patterns.',
  },
  scenario: {
    guidance: 'Scenario defines the roleplay context. It is optional, but useful for immersive, relationship-heavy, or setting-heavy cards.',
    placeholder: 'Clarify the roleplay context without writing the opening scene...',
    instruction: 'Define the durable context for the roleplay: setting, time period, social situation, important relationships, genre assumptions, or narration frame. Keep it reusable beyond the first scene. Do not write the exact opening scene; that belongs in First Message.',
  },
  first_mes: {
    guidance: 'First Message is the opening scene. It should show voice, setting, body language, and give {{user}} something to answer.',
    placeholder: 'Make the opening more immersive and responsive...',
    instruction: 'Write an opening message in {{char}} voice with immediate scene texture, action, and a clear hook for {{user}}.',
  },
  mes_example: {
    guidance: 'Example Dialogue teaches speech pattern and pacing. Keep it in a consistent chat/example format.',
    placeholder: 'Improve voice consistency in the examples...',
    instruction: 'Preserve example-dialogue formatting while strengthening speech pattern, rhythm, and character-specific phrasing.',
  },
  system_prompt: {
    guidance: 'System Prompt should be compact behavioral guidance for the model, not background storage or a second description.',
    placeholder: 'Make this system prompt tighter and safer for roleplay...',
    instruction: 'Treat this as a system prompt. Keep it concise, directive, and behavior-focused. Avoid adding background dumps.',
  },
  creator_notes: {
    guidance: 'Creator Notes are for humans: usage notes, themes, warnings, model tips, and card intent.',
    placeholder: 'Make the creator notes clearer for users...',
    instruction: 'Write human-facing notes. Explain card intent, usage guidance, themes, and caveats without roleplaying as {{char}}.',
  },
  character_note: {
    guidance: 'Character Note is injected during chat. Keep it short, high-impact, and easy for the model to obey.',
    placeholder: 'Compress this into a stronger injected note...',
    instruction: 'Treat this as an injected character note. Keep it brief, high-priority, and actionable during roleplay.',
  },
  alternate_greetings: {
    guidance: 'Alternate Greetings are separate openings. Select one greeting here, then edit or rewrite only that greeting.',
    placeholder: 'Rewrite this selected alternate greeting...',
    instruction: 'Edit only the selected alternate greeting. Return one self-contained opening message, not a list and not multiple greetings.',
  },
  tags: {
    guidance: 'Tags should stay short and comma-separated. They describe genre, traits, setting, and content category.',
    placeholder: 'Clean up tags and add missing useful categories...',
    instruction: 'Return only a comma-separated tag list. Keep tags short, useful, and non-duplicative.',
  },
};

const els = {
  appVersion: document.getElementById('appVersion'),
  aiStatus: document.getElementById('aiStatus'),
  aiStatusText: document.getElementById('aiStatusText'),
  newCardBtn: document.getElementById('newCardBtn'),
  fileInput: document.getElementById('fileInput'),
  downloadBtn: document.getElementById('downloadBtn'),
  downloadPngBtn: document.getElementById('downloadPngBtn'),
  settingsToggleBtn: document.getElementById('settingsToggleBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  avatarInput: document.getElementById('avatarInput'),
  setAvatarBtn: document.getElementById('setAvatarBtn'),
  avatarPreview: document.getElementById('avatarPreview'),
  cardSummary: document.getElementById('cardSummary'),
  fieldNav: document.getElementById('fieldNav'),
  fieldKey: document.getElementById('fieldKey'),
  fieldTitle: document.getElementById('fieldTitle'),
  fieldStats: document.getElementById('fieldStats'),
  altGreetingControls: document.getElementById('altGreetingControls'),
  prevGreetingBtn: document.getElementById('prevGreetingBtn'),
  altGreetingStatus: document.getElementById('altGreetingStatus'),
  nextGreetingBtn: document.getElementById('nextGreetingBtn'),
  addGreetingBtn: document.getElementById('addGreetingBtn'),
  deleteGreetingBtn: document.getElementById('deleteGreetingBtn'),
  fieldEditor: document.getElementById('fieldEditor'),
  providerInput: document.getElementById('providerInput'),
  baseUrlInput: document.getElementById('baseUrlInput'),
  modelInput: document.getElementById('modelInput'),
  modelOptions: document.getElementById('modelOptions'),
  modelSelect: document.getElementById('modelSelect'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  detectModelBtn: document.getElementById('detectModelBtn'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  providerStatus: document.getElementById('providerStatus'),
  providerNote: document.getElementById('providerNote'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  stopServerBtn: document.getElementById('stopServerBtn'),
  auditBtn: document.getElementById('auditBtn'),
  aiFieldScope: document.getElementById('aiFieldScope'),
  aiFieldTitle: document.getElementById('aiFieldTitle'),
  aiFieldGuidance: document.getElementById('aiFieldGuidance'),
  aiActions: [...document.querySelectorAll('.ai-action')],
  instructionInput: document.getElementById('instructionInput'),
  customAiBtn: document.getElementById('customAiBtn'),
  draftPanel: document.getElementById('draftPanel'),
  draftEditor: document.getElementById('draftEditor'),
  applyDraftBtn: document.getElementById('applyDraftBtn'),
  discardDraftBtn: document.getElementById('discardDraftBtn'),
  outputLabel: document.getElementById('outputLabel'),
  copyOutputBtn: document.getElementById('copyOutputBtn'),
  logOutput: document.getElementById('logOutput'),
  viewTabs: [...document.querySelectorAll('.view-tab')],
  cardView: document.getElementById('cardView'),
  conceptView: document.getElementById('conceptView'),
  loreView: document.getElementById('loreView'),
  auditView: document.getElementById('auditView'),
  conceptInput: document.getElementById('conceptInput'),
  generateBtn: document.getElementById('generateBtn'),
  conceptResults: document.getElementById('conceptResults'),
  conceptLog: document.getElementById('conceptLog'),
  loreNameInput: document.getElementById('loreNameInput'),
  loreSummary: document.getElementById('loreSummary'),
  addEntryBtn: document.getElementById('addEntryBtn'),
  loreList: document.getElementById('loreList'),
  loreEmpty: document.getElementById('loreEmpty'),
  loreEntryForm: document.getElementById('loreEntryForm'),
  entryEyebrow: document.getElementById('entryEyebrow'),
  entryTitleHeading: document.getElementById('entryTitleHeading'),
  entryStats: document.getElementById('entryStats'),
  entryName: document.getElementById('entryName'),
  entryKeys: document.getElementById('entryKeys'),
  entrySecondary: document.getElementById('entrySecondary'),
  entryContent: document.getElementById('entryContent'),
  entryEnabled: document.getElementById('entryEnabled'),
  entryConstant: document.getElementById('entryConstant'),
  entryCase: document.getElementById('entryCase'),
  entryPosition: document.getElementById('entryPosition'),
  entryOrder: document.getElementById('entryOrder'),
  entryAiBtn: document.getElementById('entryAiBtn'),
  deleteEntryBtn: document.getElementById('deleteEntryBtn'),
  loreLog: document.getElementById('loreLog'),
  runLocalAuditBtn: document.getElementById('runLocalAuditBtn'),
  auditReport: document.getElementById('auditReport'),
};

let card = null;
let sourceName = '';
let selectedField = FIELD_DEFS[0].key;
let selectedGreetingIndex = 0;
let pendingDraft = null;
let currentView = 'card';
let selectedEntryIndex = 0;
let avatar = null; // { image: HTMLImageElement, dataUrl: string }
let saveTimer = null;
let aiStatusTimer = null;

const STORAGE_CARD = 'cardwright_card';
const STORAGE_AVATAR = 'cardwright_avatar';
const STORAGE_SETTINGS = 'cardwright_settings';
const LEGACY_STORAGE_CARD = 'ccs_standalone_card';
const LEGACY_STORAGE_AVATAR = 'ccs_standalone_avatar';
const LEGACY_STORAGE_SETTINGS = 'ccs_standalone_settings';

await loadSettings();
els.appVersion.textContent = `v${APP_VERSION}`;
els.setAvatarBtn.disabled = false;
const restoredView = restoreCard();
renderFieldNav();
renderSelectedField();
renderLore();
if (restoredView) {
  setView(restoredView);
  updateSummary();
  log('Restored your in-progress card from this browser.');
}
autoDetectModel({ silent: true });

els.fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (file) await loadFile(file);
});

els.downloadBtn.addEventListener('click', () => {
  if (!card) return;
  syncEditorToCard();
  downloadJson(card, `${getField(card, 'name') || 'character-card'}.json`);
});

els.newCardBtn.addEventListener('click', newCard);
els.downloadPngBtn.addEventListener('click', exportPng);
els.setAvatarBtn.addEventListener('click', () => els.avatarInput.click());
els.settingsToggleBtn.addEventListener('click', openSettings);
els.settingsCloseBtn.addEventListener('click', closeSettings);
els.settingsOverlay.addEventListener('click', (event) => {
  if (event.target === els.settingsOverlay) closeSettings();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.settingsOverlay.classList.contains('hidden')) closeSettings();
});

window.addEventListener('beforeunload', () => {
  if (!card) return;
  syncEditorToCard();
  persistCard();
});

els.avatarInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  const canvas = await openCropper(url);
  URL.revokeObjectURL(url);
  if (canvas) {
    setAvatarFromCanvas(canvas);
    log('Avatar image cropped and set. Use Export PNG to save the card with this image.');
  }
});

els.fieldEditor.addEventListener('input', () => {
  if (!card) return;
  setEditorValue(selectedField, els.fieldEditor.value);
  renderFieldNav();
  renderAltGreetingControls();
  updateStats();
  scheduleSave();
});

els.saveSettingsBtn.addEventListener('click', () => {
  saveSettings();
  log('Settings saved.');
});

els.providerInput.addEventListener('change', () => {
  applyProviderPreset(els.providerInput.value);
  saveSettings();
});

els.detectModelBtn.addEventListener('click', () => autoDetectModel({ silent: false, force: true }));
els.testConnectionBtn.addEventListener('click', testAiConnection);
els.modelSelect.addEventListener('change', () => {
  if (!els.modelSelect.value) return;
  els.modelInput.value = els.modelSelect.value;
  saveSettings();
  setProviderStatus(`Selected model: ${els.modelSelect.value}.`, 'ok');
});
els.stopServerBtn.addEventListener('click', stopServer);
els.prevGreetingBtn.addEventListener('click', () => moveGreetingSelection(-1));
els.nextGreetingBtn.addEventListener('click', () => moveGreetingSelection(1));
els.addGreetingBtn.addEventListener('click', addAlternateGreeting);
els.deleteGreetingBtn.addEventListener('click', deleteAlternateGreeting);

els.aiActions.forEach((button) => {
  button.addEventListener('click', () => runFieldAction(button.dataset.action));
});

els.customAiBtn.addEventListener('click', () => {
  const instruction = els.instructionInput.value.trim();
  if (!instruction) {
    log('Add a custom instruction first.');
    return;
  }
  runFieldAction('custom', instruction);
});

els.auditBtn.addEventListener('click', runAudit);
els.copyOutputBtn.addEventListener('click', copyAiOutput);

els.viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => setView(tab.dataset.view));
});

els.conceptInput.addEventListener('input', () => {
  if (!card) return;
  setConcept(els.conceptInput.value);
  scheduleSave();
});

els.generateBtn.addEventListener('click', generateFromConcept);

els.conceptResults.addEventListener('click', (event) => {
  if (event.target.id === 'applyAllConcept') { applyAllConceptFields(); return; }
  const btn = event.target.closest('.apply-field');
  if (btn) applyConceptField(btn.dataset.key);
});

els.loreNameInput.addEventListener('input', () => {
  if (!card) return;
  ensureCharacterBook().name = els.loreNameInput.value;
  scheduleSave();
});

els.addEntryBtn.addEventListener('click', addLoreEntry);
els.deleteEntryBtn.addEventListener('click', deleteLoreEntry);
els.entryAiBtn.addEventListener('click', improveEntryWithAi);

els.entryName.addEventListener('input', () => updateEntry((e) => { e.comment = els.entryName.value; }, { relist: true }));
els.entryKeys.addEventListener('input', () => updateEntry((e) => { e.keys = parseCsv(els.entryKeys.value); }, { relist: true }));
els.entrySecondary.addEventListener('input', () => updateEntry((e) => {
  e.secondary_keys = parseCsv(els.entrySecondary.value);
  e.selective = e.secondary_keys.length > 0;
}));
els.entryContent.addEventListener('input', () => {
  updateEntry((e) => { e.content = els.entryContent.value; }, { relist: true });
  updateEntryStats();
});
els.entryEnabled.addEventListener('change', () => updateEntry((e) => { e.enabled = els.entryEnabled.checked; }, { relist: true }));
els.entryConstant.addEventListener('change', () => updateEntry((e) => { e.constant = els.entryConstant.checked; }, { relist: true }));
els.entryCase.addEventListener('change', () => updateEntry((e) => { e.case_sensitive = els.entryCase.checked; }));
els.entryPosition.addEventListener('change', () => updateEntry((e) => { e.position = els.entryPosition.value; }));
els.entryOrder.addEventListener('change', () => updateEntry((e) => { e.insertion_order = Number(els.entryOrder.value) || 0; }));

els.runLocalAuditBtn.addEventListener('click', renderAudit);

els.auditReport.addEventListener('click', (event) => {
  const fixTarget = event.target.closest('.fix-issue');
  if (fixTarget?.dataset.field) {
    fixAuditIssue({
      field: fixTarget.dataset.field,
      message: fixTarget.dataset.message || '',
      severity: fixTarget.dataset.severity || 'info',
    });
    return;
  }

  const gotoTarget = event.target.closest('.goto');
  if (!gotoTarget || !gotoTarget.dataset.field) return;
  selectAuditField(gotoTarget.dataset.field);
});

els.applyDraftBtn.addEventListener('click', () => {
  if (!pendingDraft) return;
  if (pendingDraft.field === 'alternate_greetings') {
    selectedGreetingIndex = pendingDraft.greetingIndex ?? selectedGreetingIndex;
    setAlternateGreetingAt(card, selectedGreetingIndex, els.draftEditor.value);
  } else {
    setField(card, pendingDraft.field, els.draftEditor.value);
  }
  selectedField = pendingDraft.field;
  pendingDraft = null;
  els.draftPanel.classList.add('hidden');
  renderFieldNav();
  renderSelectedField();
  scheduleSave();
  log('Draft applied.');
});

els.discardDraftBtn.addEventListener('click', () => {
  pendingDraft = null;
  els.draftPanel.classList.add('hidden');
  log('Draft discarded.');
});

async function loadFile(file) {
  try {
    sourceName = file.name;
    const isPng = file.name.toLowerCase().endsWith('.png');
    const parsed = isPng
      ? await readPngCard(file)
      : JSON.parse(await file.text());

    card = normalizeCard(parsed);
    if (isPng) setAvatar(URL.createObjectURL(file));
    selectedField = 'description';
    selectedGreetingIndex = 0;
    selectedEntryIndex = 0;
    pendingDraft = null;
    els.draftPanel.classList.add('hidden');
    els.downloadBtn.disabled = false;
    els.setAvatarBtn.disabled = false;
    setAiEnabled(true);
    updateExportButtons();
    renderFieldNav();
    renderSelectedField();
    renderLore();
    if (currentView === 'audit') renderAudit();
    updateSummary();
    scheduleSave();
    log(`Loaded ${file.name}.`);
  } catch (error) {
    log(`Could not load card: ${error.message}`);
  }
}

function normalizeCard(input) {
  const result = structuredClone(input || {});
  result.data = result.data && typeof result.data === 'object' ? result.data : {};
  if (!result.spec) result.spec = 'chara_card_v2';
  if (!result.spec_version) result.spec_version = '2.0';

  for (const field of FIELD_DEFS) {
    const value = getField(result, field.key);
    if (value !== '') setField(result, field.key, value);
  }

  if (!result.name && result.data.name) result.name = result.data.name;
  return result;
}

function getField(target, key) {
  const data = target?.data || {};
  if (key === 'name') return data.name ?? target.name ?? '';
  if (key === 'character_note') {
    return data.extensions?.depth_prompt?.prompt
      ?? data.character_note
      ?? data.depth_prompt
      ?? target.extensions?.depth_prompt?.prompt
      ?? '';
  }
  if (key === 'alternate_greetings') {
    const value = data.alternate_greetings ?? target.alternate_greetings ?? [];
    return Array.isArray(value) ? value.join('\n---\n') : String(value || '');
  }
  if (key === 'tags') {
    const value = data.tags ?? target.tags ?? [];
    return Array.isArray(value) ? value.join(', ') : String(value || '');
  }
  return data[key] ?? target[key] ?? '';
}

function setField(target, key, value) {
  target.data = target.data && typeof target.data === 'object' ? target.data : {};

  if (key === 'name') {
    target.name = value;
    target.data.name = value;
    return;
  }

  if (key === 'character_note') {
    target.data.extensions = target.data.extensions && typeof target.data.extensions === 'object'
      ? target.data.extensions
      : {};
    target.data.extensions.depth_prompt = target.data.extensions.depth_prompt && typeof target.data.extensions.depth_prompt === 'object'
      ? target.data.extensions.depth_prompt
      : {};
    target.data.extensions.depth_prompt.prompt = value;
    target.data.character_note = value;
    return;
  }

  if (key === 'alternate_greetings') {
    const greetings = parseListValue(value);
    target.data.alternate_greetings = greetings;
    target.alternate_greetings = greetings;
    return;
  }

  if (key === 'tags') {
    const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
    target.data.tags = tags;
    target.tags = tags;
    return;
  }

  target.data[key] = value;
  target[key] = value;
}

function getAlternateGreetings(target) {
  const data = target?.data || {};
  const value = data.alternate_greetings ?? target?.alternate_greetings ?? [];
  if (Array.isArray(value)) return value.map(String);
  return parseListValue(String(value || ''));
}

function setAlternateGreetings(target, greetings) {
  target.data = target.data && typeof target.data === 'object' ? target.data : {};
  const cleanGreetings = greetings.map(String);
  target.data.alternate_greetings = cleanGreetings;
  target.alternate_greetings = cleanGreetings;
}

function setAlternateGreetingAt(target, index, value) {
  const greetings = getAlternateGreetings(target);
  while (greetings.length <= index) greetings.push('');
  greetings[index] = value;
  setAlternateGreetings(target, greetings);
}

function parseListValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // Fall back to delimiter parsing.
    }
  }
  return trimmed.split(/\n-{3,}\n/g).map((item) => item.trim()).filter(Boolean);
}

function renderFieldNav() {
  els.fieldNav.innerHTML = '';

  for (const field of FIELD_DEFS) {
    const value = card ? getField(card, field.key) : '';
    const countLabel = card && field.key === 'alternate_greetings'
      ? `${getAlternateGreetings(card).length} greetings`
      : `~${estimateTokens(value)}t`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = field.key === selectedField ? 'active' : '';
    button.innerHTML = `<strong>${escapeHtml(field.label)}</strong><span>${countLabel}</span>`;
    button.addEventListener('click', () => {
      syncEditorToCard();
      selectedField = field.key;
      if (selectedField === 'alternate_greetings') clampGreetingIndex();
      renderFieldNav();
      renderSelectedField();
    });
    els.fieldNav.appendChild(button);
  }
}

function renderSelectedField() {
  const def = FIELD_DEFS.find((field) => field.key === selectedField) || FIELD_DEFS[0];
  if (def.key === 'alternate_greetings') clampGreetingIndex();
  const greetingCount = card ? getAlternateGreetings(card).length : 0;
  els.fieldKey.textContent = def.key === 'alternate_greetings' && greetingCount
    ? `${def.key}[${selectedGreetingIndex}]`
    : def.key;
  els.fieldTitle.textContent = def.key === 'alternate_greetings' && greetingCount
    ? `Alternate Greeting ${selectedGreetingIndex + 1}`
    : def.label;
  els.fieldEditor.disabled = !card;
  els.fieldEditor.value = card ? getEditorValue(def.key) : '';
  els.fieldEditor.placeholder = def.key === 'alternate_greetings'
    ? 'No alternate greeting selected. Click Add to create one.'
    : 'Card field content will appear here.';
  renderAltGreetingControls();
  renderAiPanel(def);
  updateStats();
}

function getEditorValue(key) {
  if (!card) return '';
  if (key === 'alternate_greetings') {
    return getAlternateGreetings(card)[selectedGreetingIndex] || '';
  }
  return getField(card, key);
}

function setEditorValue(key, value) {
  if (!card) return;
  if (key === 'alternate_greetings') {
    setAlternateGreetingAt(card, selectedGreetingIndex, value);
    return;
  }
  setField(card, key, value);
}

function clampGreetingIndex() {
  const greetings = card ? getAlternateGreetings(card) : [];
  if (greetings.length === 0) {
    selectedGreetingIndex = 0;
    return;
  }
  selectedGreetingIndex = Math.max(0, Math.min(selectedGreetingIndex, greetings.length - 1));
}

function renderAltGreetingControls() {
  const isAlt = selectedField === 'alternate_greetings';
  els.altGreetingControls.classList.toggle('hidden', !isAlt);
  if (!isAlt) return;

  const greetings = card ? getAlternateGreetings(card) : [];
  clampGreetingIndex();
  const count = greetings.length;
  els.altGreetingStatus.textContent = count
    ? `Greeting ${selectedGreetingIndex + 1} of ${count}`
    : '0 greetings';
  els.prevGreetingBtn.disabled = !card || count <= 1 || selectedGreetingIndex === 0;
  els.nextGreetingBtn.disabled = !card || count <= 1 || selectedGreetingIndex >= count - 1;
  els.addGreetingBtn.disabled = !card;
  els.deleteGreetingBtn.disabled = !card || count === 0;
}

function moveGreetingSelection(delta) {
  if (!card || selectedField !== 'alternate_greetings') return;
  syncEditorToCard();
  const greetings = getAlternateGreetings(card);
  if (greetings.length === 0) return;
  selectedGreetingIndex = Math.max(0, Math.min(selectedGreetingIndex + delta, greetings.length - 1));
  renderSelectedField();
}

function addAlternateGreeting() {
  if (!card) return;
  syncEditorToCard();
  const greetings = getAlternateGreetings(card);
  greetings.push('');
  setAlternateGreetings(card, greetings);
  selectedField = 'alternate_greetings';
  selectedGreetingIndex = greetings.length - 1;
  renderFieldNav();
  renderSelectedField();
  scheduleSave();
  log('Added a new alternate greeting.');
}

function deleteAlternateGreeting() {
  if (!card || selectedField !== 'alternate_greetings') return;
  const greetings = getAlternateGreetings(card);
  if (greetings.length === 0) return;
  greetings.splice(selectedGreetingIndex, 1);
  setAlternateGreetings(card, greetings);
  clampGreetingIndex();
  renderFieldNav();
  renderSelectedField();
  scheduleSave();
  log('Deleted alternate greeting.');
}

function renderAiPanel(def) {
  const fieldHelp = getFieldHelp(def.key);
  const isGreeting = def.key === 'alternate_greetings' && card && getAlternateGreetings(card).length > 0;
  els.aiFieldScope.textContent = `AI edit - ${def.key}`;
  els.aiFieldTitle.textContent = isGreeting
    ? `Revise Alternate Greeting ${selectedGreetingIndex + 1}`
    : `Revise ${def.label}`;
  els.aiFieldGuidance.textContent = fieldHelp.guidance;
  els.instructionInput.placeholder = fieldHelp.placeholder;
  els.outputLabel.textContent = 'AI Output';
}

function syncEditorToCard() {
  if (!card || els.fieldEditor.disabled) return;
  setEditorValue(selectedField, els.fieldEditor.value);
}

function updateStats() {
  const text = els.fieldEditor.value || '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  els.fieldStats.textContent = `${text.length} chars / ${words} words / ~${estimateTokens(text)}t`;
  updateSummary();
}

function cardTokenTotal() {
  if (!card) return 0;
  return FIELD_DEFS.reduce((sum, field) => sum + estimateTokens(getField(card, field.key)), 0);
}

function updateSummary() {
  if (!card) {
    els.cardSummary.textContent = 'Create or load a character card to begin.';
    return;
  }
  const name = getField(card, 'name') || 'Untitled character';
  const filled = FIELD_DEFS.filter((field) => getField(card, field.key).trim()).length;
  const loreCount = loreEntries().length;
  const loreNote = loreCount ? ` · ${loreCount} lore ${loreCount === 1 ? 'entry' : 'entries'}` : '';
  els.cardSummary.textContent = `${name} from ${sourceName || 'memory'} - ${filled}/${FIELD_DEFS.length} fields filled · ~${cardTokenTotal()}t${loreNote}`;
}

function setAiEnabled(enabled) {
  els.aiActions.forEach((button) => { button.disabled = !enabled; });
  els.customAiBtn.disabled = !enabled;
  els.auditBtn.disabled = !enabled;
  els.runLocalAuditBtn.disabled = !enabled;
}

function openSettings() {
  els.settingsOverlay.classList.remove('hidden');
  els.settingsOverlay.setAttribute('aria-hidden', 'false');
  els.baseUrlInput.focus();
}

function closeSettings() {
  els.settingsOverlay.classList.add('hidden');
  els.settingsOverlay.setAttribute('aria-hidden', 'true');
  els.settingsToggleBtn.focus();
}

// ─── View switching ────────────────────────────────────────────────────────

function setView(view) {
  if (currentView === 'card') syncEditorToCard();
  currentView = view;

  els.viewTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  els.cardView.classList.toggle('hidden', view !== 'card');
  els.conceptView.classList.toggle('hidden', view !== 'concept');
  els.loreView.classList.toggle('hidden', view !== 'lore');
  els.auditView.classList.toggle('hidden', view !== 'audit');

  if (view === 'card') renderSelectedField();
  if (view === 'concept') renderConcept();
  if (view === 'lore') renderLore();
  if (view === 'audit') renderAudit();
}

// ─── Lorebook model (embedded character_book, V2 spec) ──────────────────────

function getCharacterBook(target) {
  const book = target?.data?.character_book ?? target?.character_book;
  return book && typeof book === 'object' ? book : null;
}

function ensureCharacterBook() {
  card.data = card.data && typeof card.data === 'object' ? card.data : {};
  let book = card.data.character_book;
  if (!book || typeof book !== 'object') {
    book = { name: '', entries: [] };
    card.data.character_book = book;
  }
  if (!Array.isArray(book.entries)) book.entries = [];
  card.character_book = book; // mirror at top level for broad compatibility
  return book;
}

function loreEntries() {
  const book = getCharacterBook(card);
  return book && Array.isArray(book.entries) ? book.entries : [];
}

function entryName(e) { return e.comment ?? e.name ?? ''; }
function entryKeys(e) { return Array.isArray(e.keys) ? e.keys : (e.key != null ? [].concat(e.key) : []); }
function entrySecondary(e) {
  if (Array.isArray(e.secondary_keys)) return e.secondary_keys;
  if (Array.isArray(e.keysecondary)) return e.keysecondary;
  return [];
}
function entryEnabled(e) { return e.enabled !== false && e.disable !== true; }
function entryPosition(e) {
  if (typeof e.position === 'string') return e.position;
  if (e.position === 1) return 'after_char';
  return 'before_char';
}
function entryOrder(e) {
  if (Number.isFinite(e.insertion_order)) return e.insertion_order;
  if (Number.isFinite(e.order)) return e.order;
  return 100;
}

function parseCsv(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function selectedEntry() {
  return loreEntries()[selectedEntryIndex] || null;
}

function loreForAudit() {
  return loreEntries().map((e) => ({
    name: entryName(e),
    keys: entryKeys(e),
    secondaryKeys: entrySecondary(e),
    content: e.content || '',
    constant: !!e.constant,
    enabled: entryEnabled(e),
  }));
}

// ─── Lorebook actions ───────────────────────────────────────────────────────

function addLoreEntry() {
  if (!card) return;
  const book = ensureCharacterBook();
  const nextId = book.entries.reduce((max, e) => Math.max(max, Number(e.id) || 0), -1) + 1;
  book.entries.push({
    id: nextId,
    keys: [],
    secondary_keys: [],
    comment: '',
    content: '',
    enabled: true,
    constant: false,
    selective: false,
    insertion_order: 100,
    position: 'before_char',
    case_sensitive: false,
    extensions: {},
  });
  selectedEntryIndex = book.entries.length - 1;
  renderLore();
  els.entryName.focus();
  loreLog('Added a new lorebook entry.');
  updateSummary();
  scheduleSave();
}

function deleteLoreEntry() {
  if (!card) return;
  const entries = loreEntries();
  if (!entries.length) return;
  entries.splice(selectedEntryIndex, 1);
  selectedEntryIndex = Math.max(0, Math.min(selectedEntryIndex, entries.length - 1));
  renderLore();
  loreLog('Deleted lorebook entry.');
  updateSummary();
  scheduleSave();
}

function updateEntry(mutator, { relist = false } = {}) {
  const entry = selectedEntry();
  if (!entry) return;
  mutator(entry);
  if (relist) renderLoreList();
  renderLoreSummary();
  scheduleSave();
}

async function improveEntryWithAi() {
  const entry = selectedEntry();
  if (!entry) return;
  const current = entry.content || '';
  if (!current.trim()) {
    loreLog('Write some content first, then let the AI improve it.');
    return;
  }

  els.entryAiBtn.disabled = true;
  loreLog('Asking the AI to improve this entry...');
  try {
    const content = await callAi([
      {
        role: 'system',
        content: [
          'You are editing a single character-card lorebook entry.',
          'Keep it factual, compact, and reusable. Write durable world facts, not a scene.',
          'Preserve placeholders like {{char}} and {{user}}. Return only the revised entry content, no markdown fences.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Entry title: ${entryName(entry) || '(untitled)'}`,
          `Trigger keywords: ${entryKeys(entry).join(', ') || '(none)'}`,
          '',
          'Current content:',
          current,
          '',
          'Card context:',
          summarizeCardForPrompt(3000),
        ].join('\n'),
      },
    ]);
    entry.content = content;
    els.entryContent.value = content;
    updateEntryStats();
    renderLoreList();
    renderLoreSummary();
    scheduleSave();
    loreLog('Entry content updated by AI. Edit further or switch entries.');
  } catch (error) {
    loreLog(`AI edit failed: ${error.message}`);
  } finally {
    els.entryAiBtn.disabled = false;
  }
}

// ─── Lorebook rendering ─────────────────────────────────────────────────────

function renderLore() {
  const hasCard = !!card;
  els.loreNameInput.disabled = !hasCard;
  els.addEntryBtn.disabled = !hasCard;
  els.loreNameInput.value = hasCard ? (getCharacterBook(card)?.name || '') : '';
  renderLoreList();
  renderLoreEditor();
  renderLoreSummary();
}

function renderLoreSummary() {
  if (!card) {
    els.loreSummary.textContent = 'No card loaded';
    return;
  }
  const entries = loreEntries();
  if (!entries.length) {
    els.loreSummary.textContent = 'No entries yet';
    return;
  }
  const tokens = entries.reduce((s, e) => s + estimateTokens(e.content), 0);
  const constTokens = entries
    .filter((e) => e.constant && entryEnabled(e))
    .reduce((s, e) => s + estimateTokens(e.content), 0);
  els.loreSummary.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ~${tokens}t (${constTokens}t constant)`;
}

function renderLoreList() {
  els.loreList.innerHTML = '';
  const entries = loreEntries();
  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const off = !entryEnabled(entry) ? ' entry-off' : '';
    button.className = (index === selectedEntryIndex ? 'active' : '') + off;
    const title = entryName(entry) || '(untitled entry)';
    const keys = entryKeys(entry);
    const meta = entry.constant
      ? 'CONSTANT'
      : (keys.length ? `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}` : 'no keys');
    button.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(meta)} · ~${estimateTokens(entry.content)}t</span>`;
    button.addEventListener('click', () => {
      selectedEntryIndex = index;
      renderLore();
    });
    els.loreList.appendChild(button);
  });
}

function renderLoreEditor() {
  const entries = loreEntries();
  if (selectedEntryIndex >= entries.length) selectedEntryIndex = Math.max(0, entries.length - 1);
  const entry = entries[selectedEntryIndex];

  if (!entry) {
    els.loreEntryForm.classList.add('hidden');
    els.loreEmpty.classList.remove('hidden');
    els.loreEmpty.textContent = card
      ? 'No entry selected. Click “Add Entry” to create one.'
      : 'Load a card, then add or select a lorebook entry to edit it.';
    return;
  }

  els.loreEmpty.classList.add('hidden');
  els.loreEntryForm.classList.remove('hidden');
  els.entryEyebrow.textContent = `entry[${selectedEntryIndex}]`;
  els.entryTitleHeading.textContent = entryName(entry) || 'Untitled entry';
  els.entryName.value = entryName(entry);
  els.entryKeys.value = entryKeys(entry).join(', ');
  els.entrySecondary.value = entrySecondary(entry).join(', ');
  els.entryContent.value = entry.content || '';
  els.entryEnabled.checked = entryEnabled(entry);
  els.entryConstant.checked = !!entry.constant;
  els.entryCase.checked = !!entry.case_sensitive;
  els.entryPosition.value = entryPosition(entry);
  els.entryOrder.value = entryOrder(entry);
  updateEntryStats();
}

function updateEntryStats() {
  const text = els.entryContent.value || '';
  els.entryStats.textContent = `${text.length} chars / ~${estimateTokens(text)}t`;
}

function loreLog(message) {
  els.loreLog.textContent = message;
}

// ─── Local audit rendering ──────────────────────────────────────────────────

function renderAudit() {
  if (!card) {
    els.auditReport.innerHTML = 'Load a card and click “Run Audit” to analyze it.';
    return;
  }
  syncEditorToCard();

  const fields = {};
  for (const def of FIELD_DEFS) {
    if (def.key === 'alternate_greetings' || def.key === 'tags') continue;
    fields[def.key] = getField(card, def.key);
  }

  const report = runLocalAudit({
    fields,
    name: getField(card, 'name'),
    lore: loreForAudit(),
  });

  els.auditReport.innerHTML = buildAuditHtml(report);
}

function buildAuditHtml(report) {
  const { issues, stats, score } = report;
  const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'mid' : 'bad';

  const head = `
    <div class="audit-scorebar">
      <div class="audit-score ${scoreClass}">${score}<span style="font-size:14px;color:var(--muted)">/100</span></div>
      <div class="audit-stats">
        <span>${stats.filledFields}/${stats.totalFields} fields</span>
        <span>~${stats.cardTokens}t card</span>
        <span>${stats.loreEntries} lore · ~${stats.loreTokens}t</span>
        <span style="color:var(--danger)">${stats.errors} errors</span>
        <span style="color:#e0b84f">${stats.warnings} warnings</span>
        <span style="color:var(--accent-2)">${stats.infos} info</span>
      </div>
    </div>`;

  if (!issues.length) {
    return `${head}<p class="audit-clean" style="margin-top:16px">No issues found. Card looks healthy. ✓</p>`;
  }

  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);

  const rows = sorted.map((issue) => {
    const actions = issue.field
      ? `
        <span class="audit-actions">
          <button class="fix-issue" type="button" data-field="${escapeHtml(issue.field)}" data-severity="${escapeHtml(issue.severity)}" data-message="${escapeHtml(issue.message)}">Fix with AI</button>
          <button class="goto" type="button" data-field="${escapeHtml(issue.field)}">→ field</button>
        </span>`
      : '<span></span>';
    return `
      <div class="audit-issue">
        <span class="dot ${issue.severity}"></span>
        <span>${escapeHtml(issue.message)}</span>
        ${actions}
      </div>`;
  }).join('');

  return `${head}<div class="audit-group"><h3>Issues (${issues.length})</h3>${rows}</div>`;
}

function selectAuditField(field) {
  setView('card'); // syncs the current editor before we change the selected field
  selectedField = field;
  if (selectedField === 'alternate_greetings') clampGreetingIndex();
  renderFieldNav();
  renderSelectedField();
}

async function fixAuditIssue({ field, message, severity }) {
  if (!card || !field) return;
  syncEditorToCard();
  selectAuditField(field);

  const def = FIELD_DEFS.find((item) => item.key === selectedField);
  const fieldHelp = getFieldHelp(selectedField);
  const fieldLabel = def?.label || selectedField;
  const current = getEditorValue(selectedField);

  els.outputLabel.textContent = `${fieldLabel} Audit Fix`;
  log(`Creating an AI fix for ${fieldLabel}: ${message}`);
  setBusy(true);

  try {
    const content = await callAi([
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          'Fix this single audit issue by revising only the selected field.',
          `Audit severity: ${severity}`,
          `Audit issue: ${message}`,
          `Field key: ${selectedField}`,
          `Field label: ${fieldLabel}`,
          `Field-specific rules: ${fieldHelp.instruction}`,
          'Return only the complete revised field text. Do not wrap it in markdown fences.',
          'Preserve established facts, voice, placeholders like {{char}} and {{user}}, and useful existing content.',
          'Make the smallest useful change that resolves the issue. If the field is empty, create concise content consistent with the full card context.',
          '',
          'Current field:',
          current || '(empty)',
          '',
          'Full card context:',
          summarizeCardForPrompt(),
        ].join('\n'),
      },
    ]);

    pendingDraft = {
      field: selectedField,
      content,
      greetingIndex: selectedField === 'alternate_greetings' ? selectedGreetingIndex : undefined,
    };
    els.draftEditor.value = content;
    els.draftPanel.classList.remove('hidden');
    els.outputLabel.textContent = `${fieldLabel} Audit Fix`;
    log('Audit fix draft ready. Review it before applying.');
  } catch (error) {
    log(`Audit fix failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function runFieldAction(action, customInstruction = '') {
  if (!card) return;
  syncEditorToCard();
  const def = FIELD_DEFS.find((field) => field.key === selectedField);
  const fieldHelp = getFieldHelp(selectedField);
  const current = getEditorValue(selectedField);
  const instruction = customInstruction || actionToInstruction(action);
  const fieldLabel = selectedField === 'alternate_greetings'
    ? `${def.label} ${selectedGreetingIndex + 1}`
    : def.label;

  log(`Running AI edit for ${fieldLabel}...`);
  els.outputLabel.textContent = `${fieldLabel} Edit Status`;
  setBusy(true);

  try {
    const content = await callAi([
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          `Task: ${instruction}`,
          `Field key: ${selectedField}`,
          `Field label: ${fieldLabel}`,
          selectedField === 'alternate_greetings' ? `Selected greeting index: ${selectedGreetingIndex}` : '',
          `Field-specific rules: ${fieldHelp.instruction}`,
          'Return only the revised field text. Do not wrap it in markdown fences.',
          '',
          'Current field:',
          current || '(empty)',
          '',
          'Full card context:',
          summarizeCardForPrompt(),
        ].join('\n'),
      },
    ]);

    pendingDraft = {
      field: selectedField,
      content,
      greetingIndex: selectedField === 'alternate_greetings' ? selectedGreetingIndex : undefined,
    };
    els.draftEditor.value = content;
    els.draftPanel.classList.remove('hidden');
    els.outputLabel.textContent = `${fieldLabel} Edit Status`;
    log('Draft ready. Review it before applying.');
  } catch (error) {
    log(`AI edit failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function runAudit() {
  if (!card) return;
  syncEditorToCard();
  els.outputLabel.textContent = 'Full Card Audit';
  log('Auditing the full card...');
  setBusy(true);

  try {
    const content = await callAi([
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          'Audit this character card for roleplay quality.',
          'This is a full-card audit, not an audit of only the selected field.',
          'Be concise. Use sections: Strengths, Issues, Field-by-field notes, Highest-impact fixes.',
          'Do not rewrite the whole card unless a specific field is broken.',
          'Any text marked "[…field shortened for this prompt…]" was trimmed only to fit this request — the real field is complete, so never report it as cut off or truncated.',
          '',
          summarizeCardForPrompt(8000),
        ].join('\n'),
      },
    ]);
    log(`Full Card Audit\n\n${content}`);
  } catch (error) {
    log(`Audit failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function stopServer() {
  const confirmed = window.confirm('Stop the local Cardwright server? The app page will stop responding until you run node server.mjs again.');
  if (!confirmed) return;

  els.outputLabel.textContent = 'Server';
  log('Stopping local server...');

  try {
    const response = await fetch('/api/shutdown', { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    log('Server shutdown requested. You can start it again with: node server.mjs');
  } catch (error) {
    log(`Could not stop server from the app: ${error.message}`);
  }
}

function actionToInstruction(action) {
  const instructions = {
    rewrite: 'Rewrite this field for clarity, texture, and stronger roleplay utility while preserving canon facts.',
    expand: 'Expand this field with vivid, useful detail. Avoid padding and avoid contradicting other fields.',
    condense: 'Condense this field while preserving the most roleplay-critical information and voice cues.',
    voice: 'Strengthen the character voice, behavioral specificity, and interaction hooks.',
  };
  return instructions[action] || instructions.rewrite;
}

function getFieldHelp(key) {
  return FIELD_GUIDANCE[key] || {
    guidance: 'AI edits apply to the currently selected field.',
    placeholder: 'Describe how this field should change...',
    instruction: 'Edit only the selected field and preserve the surrounding card context.',
  };
}

function buildSystemPrompt() {
  return [
    'You are a careful character-card editor.',
    'Preserve the user-facing card format, placeholders like {{char}} and {{user}}, and any established facts.',
    'Prefer concrete behavior, playable conflict, voice cues, and useful scenario context.',
    'Remove repetition and generic traits unless they serve roleplay.',
  ].join('\n');
}

// Build a labelled dump of every card field. Long fields are capped PER FIELD
// with an explicit marker — never a blind mid-word slice of the whole blob,
// which used to drop later fields entirely and make the AI report a field as
// "cut off mid-sentence" when it was really the prompt being truncated.
function summarizeCardForPrompt(perField = 3000) {
  const lines = FIELD_DEFS.map((field) => {
    let value = getField(card, field.key).trim();
    if (value.length > perField) {
      value = `${value.slice(0, perField)}\n[…field shortened for this prompt; the real field is longer and complete…]`;
    }
    return `## ${field.label} (${field.key})\n${value || '(empty)'}`;
  });
  const concept = getConcept().trim();
  const head = concept ? `## Concept / Brief\n${concept}\n\n` : '';
  return head + lines.join('\n\n');
}

async function callAi(messages) {
  try {
    setAiStatus('connecting', 'Connecting to AI...');
    const settings = await getResolvedSettings();
    setAiStatus('running', 'Generating…');
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('The model returned an empty response.');
    setAiStatus('done', 'AI response ready', { temporary: true });
    return stripReasoning(content);
  } catch (error) {
    setAiStatus('error', 'AI request failed');
    throw error;
  }
}

// Strip reasoning/"thinking" blocks so chain-of-thought from models like Qwen3
// or DeepSeek-R1 never leaks into card fields or breaks the concept JSON.
function stripReasoning(text) {
  if (!text) return '';
  let out = text;
  // Remove complete reasoning blocks: <think>...</think>, <thinking>...</thinking>, etc.
  out = out.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
  // Some chat templates inject the opening tag, so the content starts with the
  // reasoning and only carries a closing tag — keep whatever follows the last one.
  const closers = out.match(/<\/(?:think|thinking|reasoning)>/gi);
  if (closers) {
    const last = closers[closers.length - 1];
    out = out.slice(out.toLowerCase().lastIndexOf(last.toLowerCase()) + last.length);
  }
  // Drop any stray tags left behind.
  out = out.replace(/<\/?(?:think|thinking|reasoning)>/gi, '');
  return out.trim();
}

async function getResolvedSettings() {
  const settings = getSettings();
  if (isLocalBaseUrl(settings.baseUrl)) {
    const detected = await autoDetectModel({ silent: true });
    if (detected) return { ...settings, model: detected };
  }
  return settings;
}

function getSettings() {
  return {
    provider: els.providerInput.value || DEFAULT_PROVIDER,
    baseUrl: els.baseUrlInput.value.trim() || DEFAULT_BASE_URL,
    model: els.modelInput.value.trim() || DEFAULT_MODEL,
    apiKey: els.apiKeyInput.value.trim(),
  };
}

async function autoDetectModel({ silent = false, force = false } = {}) {
  const settings = getSettings();
  const provider = providerDef(settings.provider);
  if (!force && !isLocalBaseUrl(settings.baseUrl)) return '';

  try {
    if (!silent) setAiStatus('connecting', `Checking ${provider.label}...`);
    if (!silent) setProviderStatus(`Detecting ${provider.label} models...`, 'working');
    const response = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    if (data.baseUrl) els.baseUrlInput.value = data.baseUrl;
    populateModelOptions(data.models || []);
    if (data.selectedModel) {
      els.modelInput.value = data.selectedModel;
      if (els.modelSelect.value !== data.selectedModel) els.modelSelect.value = data.selectedModel;
      saveSettings();
      if (!silent) setProviderStatus(`${provider.label}: selected ${data.selectedModel}.`, 'ok');
      if (!silent) setAiStatus('done', `${provider.label}: ${data.selectedModel}`, { temporary: true });
      return data.selectedModel;
    }

    if (!silent) setProviderStatus(`${provider.label} is reachable, but no models were returned.`, 'warn');
    if (!silent) setAiStatus('error', `No ${provider.label} model`);
  } catch (error) {
    if (!silent) setProviderStatus(`${provider.label} detect failed: ${error.message}`, 'error');
    if (!silent) setAiStatus('error', `${provider.label} not reachable`);
  }

  return '';
}

async function testAiConnection() {
  const settings = getSettings();
  const provider = providerDef(settings.provider);
  try {
    setAiStatus('connecting', `Testing ${provider.label}...`);
    setProviderStatus(`Testing ${provider.label} connection...`, 'working');
    const response = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.baseUrl) els.baseUrlInput.value = data.baseUrl;
    populateModelOptions(data.models || []);
    if (data.selectedModel && (!els.modelInput.value.trim() || els.modelInput.value.trim() === DEFAULT_MODEL)) {
      els.modelInput.value = data.selectedModel;
    }
    if (els.modelInput.value.trim()) els.modelSelect.value = els.modelInput.value.trim();
    const count = Array.isArray(data.models) ? data.models.length : 0;
    setProviderStatus(count
      ? `${provider.label} connection OK. ${count} model(s) available.`
      : `${provider.label} connection OK, but no models were returned.`, count ? 'ok' : 'warn');
    setAiStatus('done', `${provider.label} connection OK`, { temporary: true });
    saveSettings();
  } catch (error) {
    setProviderStatus(`${provider.label} connection failed: ${error.message}`, 'error');
    setAiStatus('error', `${provider.label} test failed`);
  }
}

function isLocalBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function providerDef(provider) {
  return AI_PROVIDERS[provider] || AI_PROVIDERS[DEFAULT_PROVIDER];
}

function applyProviderPreset(provider, { clearApiKey = false } = {}) {
  const def = providerDef(provider);
  els.providerInput.value = AI_PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
  if (provider !== 'custom') {
    // Switching provider is an explicit user action, so reset base URL and
    // model to the new provider's preset — a model name from another backend
    // (e.g. "gpt-4o-mini" left over after switching to LM Studio) is never
    // valid. Detect / auto-detect fills in the real model afterwards.
    els.baseUrlInput.value = def.baseUrl;
    els.modelInput.value = def.model;
  }
  if (clearApiKey) els.apiKeyInput.value = '';
  updateProviderUi();
}

function updateProviderUi() {
  const def = providerDef(els.providerInput.value);
  els.providerNote.textContent = def.note;
  els.apiKeyInput.placeholder = els.providerInput.value === 'omlx'
    ? 'oMLX API key, if required'
    : (els.providerInput.value === 'openai' ? 'Required for OpenAI' : 'Optional for local providers');
  setProviderStatus(`${def.label} idle.`, 'idle');
}

function populateModelOptions(models) {
  els.modelOptions.innerHTML = '';
  els.modelSelect.innerHTML = '';

  const ids = models
    .map((model) => (typeof model === 'string' ? model : model?.id))
    .filter(Boolean);

  if (!ids.length) {
    els.modelSelect.classList.add('hidden');
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose detected model...';
  els.modelSelect.appendChild(placeholder);

  const currentModel = els.modelInput.value.trim();
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);

    const datalistOption = document.createElement('option');
    datalistOption.value = id;
    els.modelOptions.appendChild(datalistOption);

    const selectOption = document.createElement('option');
    selectOption.value = id;
    selectOption.textContent = id;
    els.modelSelect.appendChild(selectOption);
  }

  els.modelSelect.classList.remove('hidden');
  els.modelSelect.value = seen.has(currentModel) ? currentModel : '';
}

function setProviderStatus(message, state = 'idle') {
  els.providerStatus.textContent = message;
  els.providerStatus.className = `provider-status ${state}`;
}

async function loadSettings() {
  const serverConfig = await fetchServerConfig();
  const { raw, legacy } = getStoredValue(STORAGE_SETTINGS, LEGACY_STORAGE_SETTINGS);
  if (!raw) {
    applyServerConfig(serverConfig);
    updateProviderUi();
    return;
  }
  try {
    const settings = JSON.parse(raw);
    applyServerConfig(serverConfig, settings);
    if (settings.provider) els.providerInput.value = settings.provider;
    if (settings.baseUrl) els.baseUrlInput.value = settings.baseUrl;
    if (settings.model) els.modelInput.value = settings.model;
    if (settings.apiKey) els.apiKeyInput.value = settings.apiKey;
    updateProviderUi();
    if (legacy) {
      localStorage.setItem(STORAGE_SETTINGS, raw);
      localStorage.removeItem(LEGACY_STORAGE_SETTINGS);
    }
  } catch {
    localStorage.removeItem(STORAGE_SETTINGS);
    localStorage.removeItem(LEGACY_STORAGE_SETTINGS);
  }
}

async function fetchServerConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function applyServerConfig(config, settings = null) {
  if (!config) return;

  if (!settings) {
    els.providerInput.value = config.provider || DEFAULT_PROVIDER;
    els.baseUrlInput.value = config.baseUrl || DEFAULT_BASE_URL;
    els.modelInput.value = config.model || DEFAULT_MODEL;
    return;
  }

  if (config.provider && !settings.provider) {
    settings.provider = config.provider;
  }
  if (config.baseUrl && settings.baseUrl === DEFAULT_BASE_URL && config.baseUrl !== DEFAULT_BASE_URL) {
    settings.baseUrl = config.baseUrl;
  }
  if (config.model && (!settings.model || settings.model === DEFAULT_MODEL) && config.model !== DEFAULT_MODEL) {
    settings.model = config.model;
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(getSettings()));
  localStorage.removeItem(LEGACY_STORAGE_SETTINGS);
}

function getStoredValue(key, legacyKey) {
  const raw = localStorage.getItem(key);
  if (raw) return { raw, legacy: false };
  const legacyRaw = localStorage.getItem(legacyKey);
  return { raw: legacyRaw, legacy: !!legacyRaw };
}

async function readPngCard(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error('Not a valid PNG file.');
  }

  let offset = 8;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = ascii(bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);

    if (type === 'tEXt') {
      const separator = data.indexOf(0);
      if (separator > 0) {
        const keyword = ascii(data.slice(0, separator));
        const value = latin1(data.slice(separator + 1));
        if (keyword === 'chara' || keyword === 'ccv3') return decodeEmbeddedCard(value);
      }
    }

    offset += 12 + length;
  }

  throw new Error('No embedded character-card metadata was found in this PNG.');
}

function decodeEmbeddedCard(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  const binary = atob(trimmed);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes) {
  return new TextDecoder('ascii').decode(bytes);
}

function latin1(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

function downloadJson(value, filename) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[^\w.-]+/g, '_');
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Avatar + PNG export ────────────────────────────────────────────────────

function setAvatar(url) {
  const image = new Image();
  image.onload = () => {
    // Normalize to a data URL so the avatar survives a reload (blob URLs don't).
    let dataUrl = url;
    if (url.startsWith('blob:')) {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      dataUrl = canvas.toDataURL('image/png');
      URL.revokeObjectURL(url);
    }
    avatar = { image, dataUrl };
    renderAvatarPreview();
    updateExportButtons();
    scheduleSave();
  };
  image.onerror = () => { /* leave any existing avatar in place */ };
  image.src = url;
}

function setAvatarFromCanvas(canvas) {
  setAvatar(canvas.toDataURL('image/png'));
}

function clearAvatar() {
  avatar = null;
  renderAvatarPreview();
  updateExportButtons();
}

function renderAvatarPreview() {
  if (avatar?.dataUrl) {
    els.avatarPreview.innerHTML = `<img src="${avatar.dataUrl}" alt="Avatar preview">`;
  } else {
    els.avatarPreview.innerHTML = '<span class="avatar-placeholder">No avatar</span>';
  }
}

function updateExportButtons() {
  els.downloadPngBtn.disabled = !(card && avatar?.image);
}

function ensureImageLoaded(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('Image failed to load')), { once: true });
  });
}

async function exportPng() {
  if (!card) return;
  if (!avatar?.image) {
    log('Set an avatar image first (Set / Crop Image).');
    return;
  }
  syncEditorToCard();
  try {
    await ensureImageLoaded(avatar.image);
    const canvas = document.createElement('canvas');
    canvas.width = avatar.image.naturalWidth || 512;
    canvas.height = avatar.image.naturalHeight || 768;
    canvas.getContext('2d').drawImage(avatar.image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = embedCharaChunk(await blob.arrayBuffer(), JSON.stringify(card));
    const name = getField(card, 'name') || 'character-card';
    downloadBlob(new Blob([bytes], { type: 'image/png' }), `${name}.png`);
    log('Exported PNG with embedded card metadata.');
  } catch (error) {
    log(`PNG export failed: ${error.message}`);
  }
}

// ─── Concept / brief ────────────────────────────────────────────────────────

const CONCEPT_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'tags'];

function getConcept() {
  return card?.data?.extensions?.cardwright_concept
    ?? card?.data?.extensions?.ccs_concept
    ?? '';
}

function setConcept(text) {
  if (!card) return;
  card.data = card.data && typeof card.data === 'object' ? card.data : {};
  card.data.extensions = card.data.extensions && typeof card.data.extensions === 'object' ? card.data.extensions : {};
  card.data.extensions.cardwright_concept = text;
  delete card.data.extensions.ccs_concept;
}

function renderConcept() {
  els.conceptInput.disabled = !card;
  els.generateBtn.disabled = !card;
  els.conceptInput.value = card ? getConcept() : '';
}

function conceptLog(message) {
  els.conceptLog.textContent = message;
}

async function generateFromConcept() {
  if (!card) return;
  const concept = els.conceptInput.value.trim();
  if (!concept) {
    conceptLog('Write a concept first.');
    return;
  }
  setConcept(concept);
  scheduleSave();
  els.generateBtn.disabled = true;
  conceptLog('Generating card fields from your concept...');

  try {
    const content = await callAi([
      {
        role: 'system',
        content: `${buildSystemPrompt()}\nYou are drafting a brand-new character card from a concept. Produce strong, roleplay-ready fields.`,
      },
      {
        role: 'user',
        content: [
          'Create a Character Card V2 card from this concept.',
          'Return ONLY a JSON object (no markdown fences, no commentary) with these string keys:',
          'name, description, personality, scenario, first_mes, mes_example, tags.',
          '- tags is a comma-separated string.',
          '- Use {{char}} and {{user}} placeholders where natural.',
          '- first_mes is an in-character opening scene with a hook for {{user}}.',
          '- mes_example uses <START> blocks with {{char}}: / {{user}}: lines.',
          '',
          'Concept:',
          concept,
        ].join('\n'),
      },
    ]);
    const fields = parseConceptJson(content);
    renderConceptResults(fields);
    conceptLog('Draft fields ready. Edit if needed, then Apply each (or Apply all).');
  } catch (error) {
    conceptLog(`Generation failed: ${error.message}`);
  } finally {
    els.generateBtn.disabled = false;
  }
}

function parseConceptJson(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function renderConceptResults(fields) {
  els.conceptResults.innerHTML = '';
  let any = false;

  for (const key of CONCEPT_FIELDS) {
    let value = fields[key];
    if (Array.isArray(value)) value = value.join(', ');
    if (value == null || String(value).trim() === '') continue;
    any = true;

    const def = FIELD_DEFS.find((f) => f.key === key);
    const item = document.createElement('div');
    item.className = 'concept-item';
    item.innerHTML = `
      <div class="concept-item-head">
        <strong>${escapeHtml(def?.label || key)}</strong>
        <button class="button apply-field" type="button" data-key="${key}">Apply</button>
      </div>
      <textarea data-key="${key}"></textarea>`;
    item.querySelector('textarea').value = String(value);
    els.conceptResults.appendChild(item);
  }

  if (!any) {
    els.conceptResults.textContent = 'No usable fields were returned. Try rephrasing the concept.';
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'concept-apply-all';
  bar.innerHTML = '<button class="button primary" id="applyAllConcept" type="button">Apply all fields</button>';
  els.conceptResults.prepend(bar);
}

function applyConceptField(key) {
  const textarea = els.conceptResults.querySelector(`textarea[data-key="${key}"]`);
  if (!textarea) return;
  setField(card, key, textarea.value);
  const btn = els.conceptResults.querySelector(`.apply-field[data-key="${key}"]`);
  if (btn) { btn.textContent = 'Applied ✓'; btn.disabled = true; }
  renderFieldNav();
  updateSummary();
  scheduleSave();
}

function applyAllConceptFields() {
  els.conceptResults.querySelectorAll('textarea[data-key]').forEach((ta) => setField(card, ta.dataset.key, ta.value));
  els.conceptResults.querySelectorAll('.apply-field').forEach((b) => { b.textContent = 'Applied ✓'; b.disabled = true; });
  renderFieldNav();
  updateSummary();
  scheduleSave();
  conceptLog('All fields applied. Switch to the Card tab to fine-tune.');
}

// ─── New card + auto-save ───────────────────────────────────────────────────

function newCard() {
  if (card && !window.confirm('Start a new blank card? This replaces the card currently open here.')) return;
  card = normalizeCard({ data: { name: '' } });
  sourceName = '';
  selectedField = 'description';
  selectedGreetingIndex = 0;
  selectedEntryIndex = 0;
  pendingDraft = null;
  els.draftPanel.classList.add('hidden');
  els.conceptResults.innerHTML = 'Write a concept above and click “Generate card from concept” to draft the fields.';
  clearAvatar();
  els.downloadBtn.disabled = false;
  els.setAvatarBtn.disabled = false;
  setAiEnabled(true);
  updateExportButtons();
  renderFieldNav();
  renderSelectedField();
  renderLore();
  setView('concept');
  updateSummary();
  persistCard();
  log('Started a new blank card. Describe your idea in the Concept tab.');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistCard, 400);
}

function persistCard() {
  try {
    if (card) {
      localStorage.setItem(STORAGE_CARD, JSON.stringify({
        card,
        sourceName,
        selectedField,
        currentView,
        selectedEntryIndex,
      }));
      localStorage.removeItem(LEGACY_STORAGE_CARD);
    } else {
      localStorage.removeItem(STORAGE_CARD);
      localStorage.removeItem(LEGACY_STORAGE_CARD);
    }
  } catch {
    // Storage unavailable or full — skip silently.
  }
  try {
    if (avatar?.dataUrl) {
      localStorage.setItem(STORAGE_AVATAR, avatar.dataUrl);
      localStorage.removeItem(LEGACY_STORAGE_AVATAR);
    } else {
      localStorage.removeItem(STORAGE_AVATAR);
      localStorage.removeItem(LEGACY_STORAGE_AVATAR);
    }
  } catch {
    // Avatar too large for storage — keep the card saved, drop the image.
  }
}

function restoreCard() {
  let saved;
  try {
    const { raw, legacy } = getStoredValue(STORAGE_CARD, LEGACY_STORAGE_CARD);
    if (!raw) return null;
    saved = JSON.parse(raw);
    if (legacy) {
      localStorage.setItem(STORAGE_CARD, raw);
      localStorage.removeItem(LEGACY_STORAGE_CARD);
    }
  } catch {
    localStorage.removeItem(STORAGE_CARD);
    localStorage.removeItem(LEGACY_STORAGE_CARD);
    return null;
  }

  try {
    card = normalizeCard(saved.card);
    sourceName = saved.sourceName || '';
    selectedField = saved.selectedField || 'description';
    selectedEntryIndex = saved.selectedEntryIndex || 0;
    els.downloadBtn.disabled = false;
    setAiEnabled(true);
    updateExportButtons();
    const { raw: av, legacy: legacyAvatar } = getStoredValue(STORAGE_AVATAR, LEGACY_STORAGE_AVATAR);
    if (legacyAvatar && av) {
      localStorage.setItem(STORAGE_AVATAR, av);
      localStorage.removeItem(LEGACY_STORAGE_AVATAR);
    }
    if (av) setAvatar(av);
    return saved.currentView || 'card';
  } catch {
    card = null;
    return null;
  }
}

function setBusy(isBusy) {
  els.aiActions.forEach((button) => { button.disabled = isBusy || !card; });
  els.customAiBtn.disabled = isBusy || !card;
  els.auditBtn.disabled = isBusy || !card;
}

function setAiStatus(state, text, { temporary = false } = {}) {
  clearTimeout(aiStatusTimer);
  els.aiStatus.className = `ai-status ${state}`;
  els.aiStatusText.textContent = text;
  if (temporary) {
    aiStatusTimer = setTimeout(() => setAiStatus('idle', 'AI idle'), 2600);
  }
}

function log(message) {
  els.logOutput.textContent = message;
  els.copyOutputBtn.disabled = !message;
  resetCopyOutputButton();
}

async function copyAiOutput() {
  const text = els.logOutput.textContent.trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    els.copyOutputBtn.textContent = '✓';
    els.copyOutputBtn.title = 'Copied';
    els.copyOutputBtn.setAttribute('aria-label', 'AI output copied');
    setTimeout(resetCopyOutputButton, 1200);
  } catch {
    els.copyOutputBtn.textContent = '!';
    els.copyOutputBtn.title = 'Could not copy';
    els.copyOutputBtn.setAttribute('aria-label', 'Could not copy AI output');
    setTimeout(resetCopyOutputButton, 1600);
  }
}

function resetCopyOutputButton() {
  els.copyOutputBtn.textContent = '⧉';
  els.copyOutputBtn.title = 'Copy AI output';
  els.copyOutputBtn.setAttribute('aria-label', 'Copy AI output');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
