const { createHash } = require('node:crypto');
const path = require('node:path');

const OPTION = '--settings-name';
let settingsName = '';

function parseSettingsArguments(argv) {
  let name = '';
  const args = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument !== OPTION && !argument.startsWith(`${OPTION}=`)) {
      args.push(argument);
      continue;
    }
    const value = argument === OPTION ? argv[++index] : argument.slice(OPTION.length + 1);
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--') ||
        value.length > 64 || /\p{Cc}/u.test(value)) {
      throw new Error('Use --settings-name=NAME with a name of 1 to 64 characters.');
    }
    name = value.normalize('NFC');
  }
  return { name, args };
}

function configureSettingsProfile(argv) {
  settingsName = parseSettingsArguments(argv).name;
}

function getSettingsName() {
  return settingsName;
}

// Preserve case distinctions in both filesystem paths and Windows registry value names.
function settingsNameHash() {
  return createHash('sha256').update(settingsName).digest('hex');
}

function getLoginItemSettings(autoLaunch, platform = process.platform) {
  const settings = { openAtLogin: Boolean(autoLaunch) };
  if (platform === 'win32') {
    settings.args = settingsName ? [`--settings-name=${settingsName}`] : [];
    if (settingsName) settings.name = `com.frieve.effetune.settings.${settingsNameHash()}`;
  }
  return settings;
}

function getSettingsPath(userDataPath) {
  if (!settingsName) return userDataPath;
  return path.join(userDataPath, 'settings', settingsNameHash());
}

function requestSingleInstanceLock(app, userDataPath) {
  if (!settingsName) return app.requestSingleInstanceLock();
  const originalPath = app.getPath('userData');
  // Electron keys its process lock by userData. Restore shared browser storage
  // immediately after acquiring the lock for this settings name.
  app.setPath('userData', getSettingsPath(userDataPath));
  try {
    return app.requestSingleInstanceLock();
  } finally {
    app.setPath('userData', originalPath);
  }
}

module.exports = {
  parseSettingsArguments, configureSettingsProfile, getSettingsName, getSettingsPath, getLoginItemSettings,
  requestSingleInstanceLock
};
