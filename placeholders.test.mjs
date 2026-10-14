import assert from 'node:assert/strict';
import test from 'node:test';
import { PLACEHOLDER_PRESETS, findPlaceholderMatches, getPlaceholderContext, getPlaceholderPreset, formatPlaceholderTemplate, hasMixedPlaceholders } from './placeholders.js';
import { runLocalAudit } from './audit.js';

test('role matching distinguishes all tokens and ignores unknown or nested brace expressions', () => {
  const text = '{{char}} {char} {character} {{user}} {user} {{{char}}} {{character}} {username} {{user}}ish';
  assert.deepEqual(findPlaceholderMatches(text).map(({ token, role }) => ({ token, role })), [
    { token: '{{char}}', role: 'char' }, { token: '{char}', role: 'char' },
    { token: '{character}', role: 'char' }, { token: '{{user}}', role: 'user' },
    { token: '{user}', role: 'user' }, { token: '{{user}}', role: 'user' },
  ]);
  for (const match of findPlaceholderMatches(text)) assert.equal(text.slice(match.index, match.index + match.token.length), match.token);
  assert.deepEqual(findPlaceholderMatches(null), []);
});

test('source tokens, case and mixed notation take precedence without mutating the input', () => {
  const text = '{CHAR} talks to {{user}}; {{char}} replies to {user}.';
  const context = getPlaceholderContext('character', text);
  assert.equal(context.presetId, 'character');
  assert.equal(context.char, '{CHAR}');
  assert.equal(context.user, '{{user}}');
  assert.deepEqual(context.existing, { char: ['{CHAR}', '{{char}}'], user: ['{{user}}', '{user}'] });
  assert.equal(formatPlaceholderTemplate('Write {{char}}: / {{user}}: lines.', context), 'Write {CHAR}: / {{user}}: lines.');
  assert.equal(text, '{CHAR} talks to {{user}}; {{char}} replies to {user}.');
  assert.equal(hasMixedPlaceholders(text), true);
  assert.equal(hasMixedPlaceholders('{CHAR} greets {USER}.'), false);
});

test('invalid or missing saved preferences safely use the standard preset', () => {
  for (const id of [undefined, null, '', 'unknown', {}, '__proto__']) assert.equal(getPlaceholderPreset(id).id, 'standard');
});

const auditFields = ({ char, user }) => ({
  description: `${char} is a watchful lighthouse keeper. `.repeat(8),
  personality: `${char} is quiet, observant and curious. `.repeat(4),
  scenario: `${char} meets ${user} beside the old lighthouse.`,
  first_mes: `${char} raises a lantern beside the weathered lighthouse doorway, studying the fog before turning to ${user}. "What brings you here tonight?"`,
  mes_example: `<START>\n${char}: "The sea keeps its secrets."\n${user}: "Will you tell me one?"`,
});
const baseline = runLocalAudit({ fields: auditFields(PLACEHOLDER_PRESETS[0]) });
for (const preset of PLACEHOLDER_PRESETS) {
  test(`${preset.id} receives the same audit result and remains valid under another selected preset`, () => {
    const fields = auditFields(preset);
    const before = structuredClone(fields);
    const expected = runLocalAudit({ fields });
    for (const selected of PLACEHOLDER_PRESETS) {
      const report = runLocalAudit({ fields, placeholderPresetId: selected.id });
      assert.deepEqual(report.stats, expected.stats);
      assert.equal(report.score, baseline.score);
      assert.deepEqual(report.issues, baseline.issues);
    }
    assert.deepEqual(fields, before);
    assert.equal(hasMixedPlaceholders(fields.mes_example), false);
  });

  test(`${preset.id} detects player impersonation, missing context and unfinished text with the correct token`, () => {
    const fields = auditFields(preset);
    fields.first_mes = `${preset.user} decides to walk into the lighthouse.`;
    fields.description += ' TODO';
    fields.scenario = '';
    const report = runLocalAudit({ fields, placeholderPresetId: preset.id });
    assert.ok(report.issues.some((issue) => issue.message.includes(`narrate ${preset.user}'s actions`)));
    assert.ok(report.issues.some((issue) => issue.message.includes(`references ${preset.user} but Scenario is empty`)));
    assert.ok(report.issues.some((issue) => issue.message.includes('placeholder text (TBD/TODO/…)')));
    fields.mes_example = '<START>\nA plain unlabelled example.';
    assert.ok(runLocalAudit({ fields, placeholderPresetId: preset.id }).issues.some((issue) => issue.message === `Example Dialogue has no ${preset.char}: labels.`));
  });
}

test('mixed notation is advisory and malformed player tokens do not trigger impersonation', () => {
  const fields = auditFields(PLACEHOLDER_PRESETS[0]);
  fields.description += ' {char} also carries a compass.';
  fields.first_mes = '{{{user}}} walks inside. {{username}} decides to leave. {user} walkspeed is unknown?';
  const report = runLocalAudit({ fields });
  assert.ok(report.issues.some((issue) => issue.severity === 'info' && issue.message.includes('mixes role-placeholder notation')));
  assert.equal(report.issues.some((issue) => issue.message.includes('appears to narrate')), false);
});
