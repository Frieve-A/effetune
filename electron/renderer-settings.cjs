const fs = require('node:fs');
const path = require('node:path');
const { getSettingsPath } = require('./settings-profile.cjs');

function accessRendererSettings(userDataPath, { operation, key, value } = {}) {
  if (typeof key !== 'string' || !key || key.length > 256 ||
      !['get', 'set', 'remove'].includes(operation) ||
      (operation === 'set' && (typeof value !== 'string' || value.length > 8 * 1024 * 1024))) {
    throw new TypeError('Invalid settings storage request');
  }
  const directory = getSettingsPath(userDataPath);
  const file = path.join(directory, 'renderer-settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Invalid saved settings');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (operation === 'get') return Object.hasOwn(settings, key) ? settings[key] : null;
  if (operation === 'set') Object.defineProperty(settings, key, { value, enumerable: true, configurable: true, writable: true });
  else delete settings[key];
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings));
  return null;
}

module.exports = { accessRendererSettings };
