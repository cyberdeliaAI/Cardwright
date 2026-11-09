'use strict';
const { readJson, writeJson } = require('./preferences.cjs');
const RELEASE_API = 'https://api.github.com/repos/cyberdeliaAI/Cardwright/releases/latest';

function versionParts(value) {
  if (typeof value !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) throw new Error('Invalid release version');
  return value.split('.').map(Number);
}
function isNewer(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function releaseInfo(data) {
  if (!data || data.draft || data.prerelease || typeof data.tag_name !== 'string' || !data.tag_name.startsWith('v')) throw new Error('Not a stable release');
  const version = data.tag_name.slice(1);
  versionParts(version);
  return { version, url: `https://github.com/cyberdeliaAI/Cardwright/releases/tag/v${version}` };
}
function createUpdateChecker(file, current, request = fetch, now = Date.now) {
  versionParts(current);
  const saved = readJson(file);
  const state = { automatic: saved.automatic !== false, attemptedAt: 0, latest: null, notified: typeof saved.notified === 'string' ? saved.notified : '' };
  if (Number.isFinite(saved.attemptedAt) && saved.attemptedAt > 0 && saved.attemptedAt <= now()) state.attemptedAt = saved.attemptedAt;
  try { if (saved.latest) state.latest = releaseInfo({ tag_name: `v${saved.latest.version}` }); } catch { /* Discard invalid cache metadata. */ }
  let pending;
  const result = () => ({ ...state, current, available: !!state.latest && isNewer(state.latest.version, current) });
  const save = () => writeJson(file, state);
  return {
    get state() { return result(); },
    setAutomatic(enabled) { state.automatic = !!enabled; save(); },
    markNotified() { state.notified = state.latest?.version || ''; save(); },
    check(manual = false) {
      if (pending) return pending;
      if (!manual && (!state.automatic || (state.attemptedAt && now() - state.attemptedAt < 86400000))) return Promise.resolve(result());
      state.attemptedAt = now(); save();
      pending = (async () => {
        try {
          const response = await request(RELEASE_API, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Cardwright/${current}` } });
          if (response.status !== 200) throw new Error('Release check failed');
          let text = '', bytes = 0;
          for await (const chunk of response.body) {
            bytes += chunk.byteLength;
            if (bytes > 1048576) throw new Error('Release response too large');
            text += Buffer.from(chunk).toString('utf8');
          }
          state.latest = releaseInfo(JSON.parse(text)); save();
          return result();
        } catch { return { ...result(), error: 'Could not check for updates. Try again later or view GitHub releases.' }; }
        finally { pending = null; }
      })();
      return pending;
    },
  };
}
module.exports = { createUpdateChecker, isNewer, releaseInfo };
