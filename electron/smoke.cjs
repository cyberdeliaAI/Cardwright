'use strict';
// Maintainer-only integration checks. The launcher always supplies disposable
// profiles, a loopback mock provider and a report path; no real card is opened.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

function install({ app, window, backend, origin, version }) {
  const report = process.env.CARDWRIGHT_SMOKE_REPORT;
  const phase = process.env.CARDWRIGHT_SMOKE_PHASE;
  const profile = process.env.CARDWRIGHT_PROFILE;
  const baselineFile = path.join(profile, 'smoke-baseline.json');
  let downloadIndex = 0, downloadResolve, checkpoint = 'startup';
  window.webContents.session.on('will-download', (_event, item, contents) => {
    if (contents !== window.webContents) return;
    const file = path.join(profile, `export-${phase}-${++downloadIndex}.json`);
    item.setSavePath(file);
    item.once('done', (_event, state) => {
      if (state === 'completed') downloadResolve?.(JSON.parse(fs.readFileSync(file, 'utf8')));
      else downloadResolve?.(null);
    });
  });
  const js = code => window.webContents.executeJavaScript(code);
  const wait = expression => js(`(async () => { for(let i=0;i<100;i++){ if(${expression})return true; await new Promise(r=>setTimeout(r,100)); } throw Error('Renderer condition timed out'); })()`);
  const exported = async () => {
    const result = new Promise(resolve => { downloadResolve = resolve; });
    await js("document.querySelector('#downloadBtn').click()");
    return Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error('Native JSON download timed out')), 15000))]);
  };
  window.webContents.once('did-finish-load', async () => {
    try {
      await wait(`document.querySelector('#appVersion').textContent==='v${version}' && document.querySelector('#fieldNav').children.length===11`);
      const identity = await (await fetch(origin + '/api/config')).json();
      assert.equal(identity.app, 'Cardwright'); assert.equal(identity.version, version); assert.equal(backend.owned, true);
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true);
      assert.equal(await js('typeof require'), 'undefined');
      if (phase === 'initial') {
        checkpoint = 'card import';
        const fixture = { data: { name: 'Smoke Keeper', description: 'Original character description.', personality: 'Quiet and curious.', first_mes: 'Welcome, {{user}}?',
          alternate_greetings: ['Same opening', 'Same opening', '  {{char}}\r\n---\r\n{{user}}  '],
          character_book: { name: 'Legacy coast', custom: 'retained', entries: [{ id: 7, keys: ['coast'], content: 'Original lore content.' }] },
          extensions: { cardwright_concept: 'Existing concept', untouched: { marker: 'Keep this metadata' } } } };
        await js(`(() => { const file=new File([${JSON.stringify(JSON.stringify(fixture))}],'fixture.json',{type:'application/json'}); const data=new DataTransfer(); data.items.add(file); const input=document.querySelector('#fileInput'); input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
        await wait("document.querySelector('#cardSummary').textContent.includes('Smoke Keeper')");
        const baseline = await exported(); assert.ok(baseline);
        fs.writeFileSync(baselineFile, JSON.stringify(baseline));
        checkpoint = 'source draft';
        await js("document.querySelector('[data-view=concept]').click(); const source=document.querySelector('#sourceTextInput'); source.value='Aster is a lighthouse keeper. Appearance and player relationship are not specified.'; source.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#createSourceConceptBtn').click();");
        await wait("!document.querySelector('#sourceConceptDraftEditor').disabled && document.querySelector('#sourceConceptDraftEditor').value.includes('MOCK_SOURCE_CONCEPT')");
        assert.equal(await js("document.querySelector('#conceptInput').value"), 'Existing concept');
        assert.deepEqual(await exported(), baseline);
        await js("const draft=document.querySelector('#sourceConceptDraftEditor'); draft.value='Edited source concept'; draft.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#applySourceConceptBtn').click(); const preset=document.querySelector('#placeholderPresetSelect'); preset.value='character'; preset.dispatchEvent(new Event('change',{bubbles:true}));");
        const applied = await exported();
        baseline.data.extensions.cardwright_concept = 'Edited source concept';
        assert.deepEqual(applied, baseline);
        fs.writeFileSync(baselineFile, JSON.stringify(baseline));
        checkpoint = 'second source draft';
        await js("document.querySelector('#createSourceConceptBtn').click()");
        await wait("!document.querySelector('#sourceConceptDraftEditor').disabled && document.querySelector('#sourceConceptDraftEditor').value.includes('MOCK_SOURCE_CONCEPT')");
        await js("document.querySelector('#sourceConceptDraftEditor').value='Unapplied local draft'; document.querySelector('#sourceConceptDraftEditor').dispatchEvent(new Event('input',{bubbles:true})); window.dispatchEvent(new Event('beforeunload'));");
      } else {
        await wait("document.querySelector('#cardSummary').textContent.includes('Smoke Keeper')");
        assert.deepEqual(await exported(), JSON.parse(fs.readFileSync(baselineFile, 'utf8')));
        const restored = await js("({concept:document.querySelector('#conceptInput').value,draft:document.querySelector('#sourceConceptDraftEditor').value,preset:document.querySelector('#placeholderPresetSelect').value,apply:document.querySelector('#applySourceConceptBtn').disabled})");
        assert.deepEqual(restored, { concept: 'Edited source concept', draft: 'Unapplied local draft', preset: 'character', apply: false });
      }
      fs.writeFileSync(report, JSON.stringify({ ok: true, phase, appVersion: version, electron: process.versions.electron, sandbox: prefs.sandbox, sharedServer: true, nativeExport: true, dataPreserved: true }));
      window.close(); app.quit();
    } catch (error) {
      const diagnostics = await js("({version:document.querySelector('#appVersion')?.textContent,summary:document.querySelector('#cardSummary')?.textContent,status:document.querySelector('#sourceConceptStatus')?.textContent,log:document.querySelector('#logOutput')?.textContent})").catch(() => ({}));
      fs.writeFileSync(report, JSON.stringify({ ok: false, phase, checkpoint, error: error.message, diagnostics, stack: error.stack }));
      window.destroy(); app.exit(1);
    }
  });
}
module.exports = { install };
