'use strict';
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  try {
    if (fs.statSync(file).size > 16384) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  } catch { /* Optional desktop preferences must not block the editor. */ }
}

function windowSize(file, area) {
  const saved = readJson(file);
  const valid = n => Number.isInteger(n) && n >= 1 && n <= 50000;
  const minWidth = Math.min(760, area.width), minHeight = Math.min(600, area.height);
  return {
    width: Math.max(minWidth, Math.min(valid(saved.width) ? saved.width : 1360, area.width)),
    height: Math.max(minHeight, Math.min(valid(saved.height) ? saved.height : 960, area.height)), minWidth, minHeight,
  };
}

function rememberWindowSize(window, file) {
  let timer;
  const save = () => {
    clearTimeout(timer);
    if (window.isDestroyed()) return;
    const { width, height } = window.getNormalBounds();
    if ([width, height].every(n => Number.isInteger(n) && n > 0 && n <= 50000)) writeJson(file, { width, height });
  };
  window.on('resize', () => { clearTimeout(timer); timer = setTimeout(save, 250); });
  window.on('close', save);
  window.on('closed', () => clearTimeout(timer));
}
module.exports = { readJson, writeJson, windowSize, rememberWindowSize };
