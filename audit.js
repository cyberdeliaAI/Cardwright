// Local (no AI) Cardwright coherence audit.
// Runs entirely in-process and returns a structured report.

import { estimateTokens } from './token-utils.js';

const LABELS = {
  description: 'Description',
  personality: 'Personality',
  scenario: 'Scenario',
  first_mes: 'First Message',
  mes_example: 'Example Dialogue',
  system_prompt: 'System Prompt',
  creator_notes: 'Creator Notes',
  character_note: 'Character Note',
};

const FIELD_BUDGETS = {
  description: { min: 50, max: 2000 },
  personality: { min: 20, max: 600 },
  scenario: { min: 0, max: 1200 },
  first_mes: { min: 30, max: 2000 },
  mes_example: { min: 0, max: 2000 },
  system_prompt: { min: 0, max: 800 },
  creator_notes: { min: 0, max: 500 },
  character_note: { min: 0, max: 400 },
};

const PLACEHOLDER_PATTERNS = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /\bPLACEHOLDER\b/i,
  /\bFILL IN\b/i,
  /\bINSERT HERE\b/i,
  /\bCOMING SOON\b/i,
  /\[\.\.\.?\]/,
];

const USER_IMPERSONATION = [
  /\{\{user\}\}\s+(feels?|thinks?|decides?|walks?|enters?|sits?|looks?|says?|nods?|smiles?|frowns?)/i,
];

const NEGATIVE_PHRASING = [
  /\bdon'?t\b/i,
  /\bnever\b/i,
  /\bdo not\b/i,
  /\bshouldn'?t\b/i,
  /\bmust not\b/i,
  /\bcannot\b/i,
  /\bcan'?t\b/i,
];

/**
 * Run the full local audit.
 * @param {{fields: Object<string,string>, name?: string, lore?: Array}} input
 *   fields keyed by CCS field name; lore is an array of normalized entries
 *   ({ name, keys, secondaryKeys, content, constant, enabled }).
 * @returns {{issues: Array, stats: Object, score: number}}
 */
export function runLocalAudit({ fields = {}, name = '', lore = [] }) {
  const issues = [];
  const add = (severity, category, message, field) => {
    issues.push({ severity, category, message, field });
  };

  // 1. Required fields -------------------------------------------------------
  if (!fields.description?.trim()) add('error', 'fields', 'Required field "Description" is empty.', 'description');
  if (!fields.first_mes?.trim()) add('error', 'fields', 'Required field "First Message" is empty.', 'first_mes');
  if (!fields.personality?.trim()) add('warning', 'fields', '"Personality" is empty. Most cards benefit from a short personality block.', 'personality');

  // 2. Per-field budget + placeholder ---------------------------------------
  for (const [key, budget] of Object.entries(FIELD_BUDGETS)) {
    const content = fields[key];
    if (!content || !content.trim()) continue;
    const tokens = estimateTokens(content);
    if (budget.min > 0 && tokens < budget.min) {
      add('warning', 'fields', `"${LABELS[key]}" is very short (~${tokens}t). Consider expanding it.`, key);
    }
    if (tokens > budget.max) {
      add('warning', 'fields', `"${LABELS[key]}" is long (~${tokens}t, budget ~${budget.max}t). Consider trimming.`, key);
    }
    if (PLACEHOLDER_PATTERNS.some((p) => p.test(content))) {
      add('warning', 'fields', `"${LABELS[key]}" contains placeholder text (TBD/TODO/…). Replace it before publishing.`, key);
    }
  }

  // 3. {{user}} impersonation on narrative fields ---------------------------
  for (const key of ['description', 'scenario', 'first_mes', 'mes_example', 'system_prompt']) {
    const content = fields[key];
    if (content && USER_IMPERSONATION.some((p) => p.test(content))) {
      add('warning', 'consistency', `"${LABELS[key]}" appears to narrate {{user}}'s actions or feelings. Let the player control {{user}}.`, key);
    }
  }

  // 4. System prompt negative phrasing --------------------------------------
  if (fields.system_prompt?.trim()) {
    const negs = NEGATIVE_PHRASING.map((p) => fields.system_prompt.match(p)).filter(Boolean).map((m) => m[0]);
    if (negs.length) {
      add('info', 'fields', `System Prompt uses negative phrasing ("${negs.slice(0, 3).join('", "')}"). Positive instructions usually steer models better.`, 'system_prompt');
    }
  }

  // 5. First message hook ----------------------------------------------------
  if (fields.first_mes?.trim()) {
    const tail = fields.first_mes.slice(-200);
    const hook = /\?/.test(tail) || /\.{3}|—|–/.test(fields.first_mes.trim());
    if (!hook) {
      add('info', 'fields', 'First Message may lack an open-ended hook — consider ending on a question or open action for {{user}}.', 'first_mes');
    }
  }

  // 6. Example dialogue format ----------------------------------------------
  if (fields.mes_example?.trim()) {
    if (!fields.mes_example.includes('<START>')) {
      add('info', 'fields', 'Example Dialogue has no <START> separators between exchanges.', 'mes_example');
    }
    if (!fields.mes_example.includes('{{char}}')) {
      add('info', 'fields', 'Example Dialogue has no {{char}}: labels.', 'mes_example');
    }
  }

  // 7. Cross-field consistency ----------------------------------------------
  if (name && fields.description && fields.personality) {
    const n = name.toLowerCase();
    if (fields.description.toLowerCase().includes(n)
      && !fields.personality.toLowerCase().includes(n)
      && !fields.personality.includes('{{char}}')) {
      add('info', 'consistency', `Name "${name}" appears in Description but not Personality. Consider {{char}} or the name in Personality.`);
    }
  }
  if (fields.first_mes?.includes('{{user}}') && !fields.scenario?.trim()) {
    add('info', 'consistency', 'First Message references {{user}} but Scenario is empty. A little scenario context can help.', 'scenario');
  }

  // 8. Lorebook health -------------------------------------------------------
  if (lore.length) {
    const keyMap = new Map();
    for (const e of lore) {
      for (const key of (e.keys || [])) {
        const k = key.toLowerCase().trim();
        if (!k) continue;
        if (keyMap.has(k)) {
          add('warning', 'lorebook', `Keyword collision: "${key}" is used by both "${keyMap.get(k)}" and "${e.name || '(unnamed)'}".`);
        } else {
          keyMap.set(k, e.name || '(unnamed)');
        }
      }
    }

    const constants = lore.filter((e) => e.constant && e.enabled);
    const constTokens = constants.reduce((s, e) => s + estimateTokens(e.content), 0);
    if (constTokens > 800) {
      add('warning', 'lorebook', `Constant lore entries total ~${constTokens}t and inject on every message. Consider making some keyword-triggered.`);
    }
    if (constants.length > 5) {
      add('info', 'lorebook', `${constants.length} constant entries. Constant entries fire every message — prefer keyword-triggered ones.`);
    }

    const disabled = lore.filter((e) => !e.enabled).length;
    if (disabled) {
      add('info', 'lorebook', `${disabled} lore ${disabled === 1 ? 'entry is' : 'entries are'} disabled and won't trigger.`);
    }

    for (const e of lore.filter((e) => e.enabled && !e.constant && (!e.keys || e.keys.length === 0))) {
      add('error', 'lorebook', `Lore entry "${e.name || '(unnamed)'}" has no keywords and is not constant — it will never activate.`);
    }
  }

  // Stats + score ------------------------------------------------------------
  const filledKeys = Object.keys(LABELS).filter((k) => fields[k]?.trim());
  const cardTokens = filledKeys.reduce((s, k) => s + estimateTokens(fields[k]), 0);
  const loreTokens = lore.reduce((s, e) => s + estimateTokens(e.content), 0);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;
  const score = Math.max(0, 100 - errors * 20 - warnings * 5 - infos * 2);

  return {
    issues,
    score,
    stats: {
      filledFields: filledKeys.length,
      totalFields: Object.keys(LABELS).length,
      cardTokens,
      loreEntries: lore.length,
      loreTokens,
      errors,
      warnings,
      infos,
    },
  };
}
