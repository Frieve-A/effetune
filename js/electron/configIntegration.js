import {
  AUTO_LANGUAGE_PREFERENCE,
  LANGUAGE_OPTIONS,
  getLanguageOptionLabel,
  normalizeLanguagePreference
} from '../language-options.js';
import {
  loadWebAppConfig,
  saveWebAppConfig
} from './webSettingsStorage.js';

export async function loadConfig(isElectron) {
  if (!isElectron) return loadWebAppConfig();
  try {
    const result = await window.electronAPI.loadConfig();
    if (result.success) return result.config || {};
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return {};
}

export async function saveConfig(isElectron, cfg) {
  if (!isElectron) return saveWebAppConfig(cfg);
  try {
    await window.electronAPI.saveConfig(cfg);
    return true;
  } catch (error) {
    console.error('Failed to save config:', error);
    return false;
  }
}

export async function showConfigDialog(isElectron, currentConfig) {
  // Load the latest config from file to ensure we have the most recent settings
  const config = {
    ...(currentConfig || {}),
    ...await loadConfig(isElectron)
  };
  config.language = normalizeLanguagePreference(config.language || AUTO_LANGUAGE_PREFERENCE);
  config.startupView = config.startupView === 'library' ? 'library' : 'effects';
  
  const pipelinePresetManager = window.pipelineManager && window.pipelineManager.presetManager;
  const presets = pipelinePresetManager
    ? (typeof pipelinePresetManager.getLoadablePresets === 'function'
      ? await pipelinePresetManager.getLoadablePresets()
      : await pipelinePresetManager.getPresets())
    : {};
  const presetNames = Object.keys(presets).sort();
  const t = window.uiManager?.t
    ? window.uiManager.t.bind(window.uiManager)
    : key => key;

  // Fix for single preset case: auto-set startupPreset if pipelineStartup is 'preset' but startupPreset is empty
  if (config.pipelineStartup === 'preset' && (!config.startupPreset || config.startupPreset === '') && presetNames.length > 0) {
    config.startupPreset = presetNames[0];
  }

  const electronOnlySections = isElectron ? `
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="auto-launch" ${config.autoLaunch ? 'checked' : ''}>
          <label for="auto-launch" id="config-auto-launch-label"></label>
        </div>
      </div>
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="start-min" ${config.startMinimized ? 'checked' : ''}>
          <label for="start-min" id="config-start-min-label"></label>
        </div>
      </div>
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="tray" ${config.minimizeToTray ? 'checked' : ''}>
          <label for="tray" id="config-tray-label"></label>
        </div>
      </div>
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="check-updates" ${config.checkForUpdatesOnStartup !== false ? 'checked' : ''}>
          <label for="check-updates" id="config-check-updates-label"></label>
        </div>
      </div>` : '';

  const dialogHTML = `
    <div class="config-dialog">
      <h2 id="config-title"></h2>
      ${electronOnlySections}
      <div class="device-section">
        <label class="section-label" for="language-select" id="config-language-label"></label>
        <select id="language-select" class="config-select"></select>
      </div>
      <div class="device-section">
        <label class="section-label" id="config-startup-view-label"></label>
        <div class="radio-container">
          <input type="radio" name="startup-view" id="startup-view-effects" value="effects" ${config.startupView === 'effects' ? 'checked' : ''}>
          <label for="startup-view-effects" id="config-startup-view-effects-label"></label>
        </div>
        <div class="radio-container">
          <input type="radio" name="startup-view" id="startup-view-library" value="library" ${config.startupView === 'library' ? 'checked' : ''}>
          <label for="startup-view-library" id="config-startup-view-library-label"></label>
        </div>
      </div>
      <div class="device-section">
        <label class="section-label" id="config-pipeline-label"></label>
        <div class="radio-container">
          <input type="radio" name="pipeline" id="pl-default" value="default" ${config.pipelineStartup === 'default' ? 'checked' : ''}>
          <label for="pl-default" id="config-pipeline-default-label"></label>
        </div>
        <div class="radio-container">
          <input type="radio" name="pipeline" id="pl-last" value="last" ${!config.pipelineStartup || config.pipelineStartup === 'last' ? 'checked' : ''}>
          <label for="pl-last" id="config-pipeline-last-label"></label>
        </div>
        <div class="radio-container">
          <input type="radio" name="pipeline" id="pl-preset" value="preset" ${config.pipelineStartup === 'preset' ? 'checked' : ''}>
          <label for="pl-preset" id="config-pipeline-preset-label"></label>
          <select id="preset-select" class="config-select" ${config.pipelineStartup === 'preset' ? '' : 'disabled'}></select>
        </div>
      </div>
      <div class="dialog-buttons">
        <button id="close-btn"></button>
      </div>
    </div>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = dialogHTML;
  document.body.appendChild(overlay);

  const style = document.createElement('style');
  style.textContent = `
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .config-dialog {
      background-color: #222;
      border-radius: 8px;
      padding: 20px;
      width: 400px;
      color: #fff;
    }
    .config-dialog h2 {
      margin-top: 0;
      margin-bottom: 20px;
      color: #fff;
    }
    .device-section {
      margin-bottom: 15px;
    }
    .device-section .section-label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
      color: #fff;
    }
    .checkbox-container {
      display: flex;
      align-items: center;
    }
    .checkbox-container input[type="checkbox"] {
      margin-right: 8px;
    }
    .checkbox-container label {
      display: inline;
      margin-bottom: 0;
      color: #fff;
      cursor: pointer;
    }
    .radio-container {
      display: flex;
      align-items: center;
      margin-bottom: 5px;
    }
    .radio-container input[type="radio"] {
      margin-right: 8px;
    }
    .radio-container label {
      display: inline;
      margin-bottom: 0;
      margin-right: 8px;
      color: #fff;
      cursor: pointer;
    }
    .config-select {
      margin-left: auto;
      padding: 4px 8px;
      background-color: #333;
      color: #fff;
      border: 1px solid #444;
      border-radius: 4px;
      min-width: 120px;
    }
    .config-select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .dialog-buttons {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }
    .dialog-buttons button {
      padding: 8px 16px;
      margin-left: 10px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background-color: #007bff;
      color: #fff;
    }
    .dialog-buttons button:hover {
      background-color: #0056b3;
    }
  `;
  document.head.appendChild(style);

  function replaceOptions(select, options, selectedValue, labelForValue = value => value) {
    if (!select) return;
    select.innerHTML = '';
    const selectedValueString = String(selectedValue);
    options.forEach(value => {
      const optionValue = String(value);
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = labelForValue(value);
      option.selected = optionValue === selectedValueString;
      select.appendChild(option);
    });
    select.value = options.some(value => String(value) === selectedValueString) ? selectedValueString : String(options[0] || '');
  }

  function renderLanguageOptions() {
    const languageSelect = document.getElementById('language-select');
    if (!languageSelect) {
      return;
    }

    const selectedValue = normalizeLanguagePreference(config.language);
    replaceOptions(
      languageSelect,
      LANGUAGE_OPTIONS.map(option => option.value),
      selectedValue,
      value => getLanguageOptionLabel(value, t)
    );
  }

  function renderPresetOptions() {
    replaceOptions(document.getElementById('preset-select'), presetNames, config.startupPreset || '');
  }

  function renderDialogTexts() {
    document.getElementById('config-title').textContent = t('dialog.config.title');
    const autoLaunchLabel = document.getElementById('config-auto-launch-label');
    if (autoLaunchLabel) autoLaunchLabel.textContent = t('dialog.config.autoLaunch');
    const startMinLabel = document.getElementById('config-start-min-label');
    if (startMinLabel) startMinLabel.textContent = t('dialog.config.startMinimized');
    const trayLabel = document.getElementById('config-tray-label');
    if (trayLabel) trayLabel.textContent = t('dialog.config.minimizeToTray');
    const checkUpdatesLabel = document.getElementById('config-check-updates-label');
    if (checkUpdatesLabel) checkUpdatesLabel.textContent = t('dialog.config.checkForUpdatesOnStartup');
    document.getElementById('config-language-label').textContent = t('dialog.config.language');
    document.getElementById('config-startup-view-label').textContent = t('dialog.config.startupView');
    document.getElementById('config-startup-view-effects-label').textContent = t('dialog.config.startupView.effects');
    document.getElementById('config-startup-view-library-label').textContent = t('dialog.config.startupView.library');
    document.getElementById('config-pipeline-label').textContent = t('dialog.config.pipeline');
    document.getElementById('config-pipeline-default-label').textContent = t('dialog.config.pipeline.default');
    document.getElementById('config-pipeline-last-label').textContent = t('dialog.config.pipeline.last');
    document.getElementById('config-pipeline-preset-label').textContent = t('dialog.config.pipeline.preset');
    document.getElementById('close-btn').textContent = t('dialog.config.close');
    renderLanguageOptions();
    renderPresetOptions();
  }

  function save() {
    saveConfig(isElectron, config);
    // Update global config objects to keep them in sync
    if (window.electronIntegration) {
      window.electronIntegration.config = config;
    }
    window.appConfig = config;
  }

  renderDialogTexts();

  const autoLaunch = document.getElementById('auto-launch');
  if (autoLaunch) {
    autoLaunch.addEventListener('change', e => {
      config.autoLaunch = e.target.checked; save();
    });
  }
  const startMin = document.getElementById('start-min');
  if (startMin) {
    startMin.addEventListener('change', e => {
      config.startMinimized = e.target.checked; save();
    });
  }
  const tray = document.getElementById('tray');
  if (tray) {
    tray.addEventListener('change', e => {
      config.minimizeToTray = e.target.checked; save();
    });
  }
  const checkUpdates = document.getElementById('check-updates');
  if (checkUpdates) {
    checkUpdates.addEventListener('change', e => {
      config.checkForUpdatesOnStartup = e.target.checked; save();
    });
  }
  [
    document.getElementById('startup-view-effects'),
    document.getElementById('startup-view-library')
  ].filter(Boolean).forEach(el => {
    el.addEventListener('change', () => {
      config.startupView = el.value === 'library' ? 'library' : 'effects';
      save();
    });
  });
  const pipelineInputs = typeof overlay.querySelectorAll === 'function'
    ? Array.from(overlay.querySelectorAll('input[name="pipeline"]'))
    : [];
  pipelineInputs.forEach(el => {
    el.addEventListener('change', () => {
      config.pipelineStartup = el.value;
      const select = document.getElementById('preset-select');
      select.disabled = el.value !== 'preset';
      save();
    });
  });
  const select = document.getElementById('preset-select');
  if (select) {
    select.addEventListener('change', e => { config.startupPreset = e.target.value; save(); });
  }
  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
    languageSelect.addEventListener('change', async e => {
      config.language = normalizeLanguagePreference(e.target.value);
      save();

      if (window.uiManager && typeof window.uiManager.setLanguagePreference === 'function') {
        await window.uiManager.setLanguagePreference(config.language, { persist: false });
        renderDialogTexts();
      }
    });
  }
  function closeDialog() {
    document.body.removeChild(overlay);
    document.head.removeChild(style);
    document.removeEventListener('keydown', handleKeydown);
    // const message = t('dialog.config.languageRestartNotice');
    // alert(message);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  }

  document.getElementById('close-btn').addEventListener('click', closeDialog);
  document.addEventListener('keydown', handleKeydown);
}
