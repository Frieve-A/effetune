const fs = require('node:fs');
const path = require('node:path');

const readable = new Map();
const writable = new Map();
const outputDirectories = new Map();
const SETTINGS_FILES = new Set([
  'effetune_presets.json', 'effetune_plugin_presets.json', 'player-state.json', 'effetune_dbt_tests.json'
]);

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try { return fs.realpathSync(resolved); }
  catch (error) {
    if (error.code !== 'ENOENT' || path.dirname(resolved) === resolved) throw error;
    return path.join(canonicalPath(path.dirname(resolved)), path.basename(resolved));
  }
}

function grant(map, value) {
  if (typeof value !== 'string' || !value) return;
  const canonical = canonicalPath(value);
  map.set(pathKey(value), pathKey(canonical));
  map.set(pathKey(canonical), pathKey(canonical));
}

function grantRead(value) { grant(readable, value); }
function grantWrite(value) { grant(writable, value); grantRead(value); }
function grantOutputDirectory(value) { grant(outputDirectories, value); }

function assertSender(event, mainWindow) {
  const contents = mainWindow?.webContents;
  if (!contents || mainWindow.isDestroyed?.() || contents.isDestroyed?.() ||
      event?.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) {
    throw new Error('This window cannot access files.');
  }
}

function assertPath(value, mode, settingsDirectory) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Select a file first.');
  const resolved = path.resolve(value);
  if (process.platform === 'win32' && resolved.replace(/^[a-z]:/i, '').includes(':')) {
    throw new Error('Select a regular file.');
  }
  const key = pathKey(resolved);
  const canonical = pathKey(canonicalPath(resolved));
  const map = mode === 'write' ? writable : readable;
  if (map.get(key) === canonical) return;
  if (mode === 'write') {
    const parent = pathKey(path.dirname(resolved));
    const canonicalParent = pathKey(canonicalPath(path.dirname(resolved)));
    if (outputDirectories.get(parent) === canonicalParent &&
        canonical === pathKey(path.join(canonicalParent, path.basename(resolved)))) return;
  }
  if (settingsDirectory) {
    const settings = canonicalPath(settingsDirectory);
    const name = path.basename(resolved);
    const allowedSetting = SETTINGS_FILES.has(name) || (mode !== 'write' && name === 'pipeline-state.json');
    if (allowedSetting && key === pathKey(path.join(path.resolve(settingsDirectory), name)) &&
        canonical === pathKey(path.join(settings, name))) return;
  }
  throw new Error('Select this file or output folder again to allow access.');
}

function clear() {
  readable.clear();
  writable.clear();
  outputDirectories.clear();
}

module.exports = { SETTINGS_FILES, assertSender, assertPath, grantRead, grantWrite, grantOutputDirectory, clear };
