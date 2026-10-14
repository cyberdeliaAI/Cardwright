// Shared role notation for prompts, UI guidance and the offline audit.
// These helpers only read source text; they never convert card data.
export const PLACEHOLDER_PRESETS = Object.freeze([
  Object.freeze({ id: 'standard', label: 'Standard', char: '{{char}}', user: '{{user}}' }),
  Object.freeze({ id: 'single', label: 'Single braces', char: '{char}', user: '{user}' }),
  Object.freeze({ id: 'character', label: 'Full character', char: '{character}', user: '{user}' }),
]);

export function getPlaceholderPreset(id) {
  return PLACEHOLDER_PRESETS.find((preset) => preset.id === id) || PLACEHOLDER_PRESETS[0];
}

export function findPlaceholderMatches(text = '') {
  text = String(text ?? '');
  // Brace boundaries prevent matching {char} inside {{char}}, unknown nested
  // forms or triple-brace expressions. Preserve the original spelling/case.
  const pattern = /(?<![{}])(?:\{\{char\}\}|\{\{user\}\}|\{character\}|\{char\}|\{user\})(?![{}])/gi;
  return Array.from(text.matchAll(pattern), (match) => ({
    token: match[0], index: match.index,
    role: match[0].toLowerCase().includes('user') ? 'user' : 'char',
  }));
}

export function getPlaceholderContext(presetId, sourceText = '') {
  const preset = getPlaceholderPreset(presetId);
  const existing = { char: [], user: [] };
  for (const match of findPlaceholderMatches(sourceText)) {
    if (!existing[match.role].includes(match.token)) existing[match.role].push(match.token);
  }
  return {
    presetId: preset.id,
    char: existing.char[0] || preset.char,
    user: existing.user[0] || preset.user,
    existing,
  };
}

// Use only for app-owned templates, never for user text, cards or persona data.
export function formatPlaceholderTemplate(template, context) {
  return template.replace(/\{\{(char|user)\}\}/g, (_, role) => context[role]);
}

export function buildPlaceholderInstructions(context, mode = 'edit') {
  const notation = 'Supported role notation: {{char}}, {char} and {character} mean the character; {{user}} and {user} mean the player. These forms have the same roles.';
  if (mode === 'avatar') return `${notation}\nInterpret these tokens as references, but output visual descriptions without any role placeholders.`;
  if (mode === 'audit') return `${notation}\nAll supported forms are valid regardless of the preferred preset. Do not report another supported form as invalid. Mixed notation can be mentioned as advice, without automatically converting it.`;
  const roles = `Role placeholders for this request: ${context.char} = character; ${context.user} = player.`;
  if (mode === 'generation') return [
    notation, roles,
    `Use ${context.char} and ${context.user} in newly generated card fields. Reference data may use other supported forms; use the selected notation for new output.`,
  ].join('\n');
  const tokens = [...context.existing.char, ...context.existing.user];
  return [
    notation, roles,
    'Preserve every placeholder already in the target text exactly, including its spelling, case and braces. Do not convert existing notation, even if it differs from the preferred preset.',
    tokens.length ? `Existing target tokens: ${tokens.join(', ')}.` : 'The target has no recognized role placeholders yet.',
    `For new character/player references, use ${context.char} and ${context.user}. When the target mixes forms, preserve them and use the first existing form for each role for new references.`,
  ].join('\n');
}

export function hasMixedPlaceholders(text) {
  const matches = findPlaceholderMatches(text);
  return matches.length > 0 && !PLACEHOLDER_PRESETS.some((preset) =>
    matches.every((match) => match.token.toLowerCase() === preset[match.role]));
}
