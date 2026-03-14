import {
  AUTO_LANGUAGE_PREFERENCE,
  LANGUAGE_OPTIONS,
  getLanguageOptionLabel,
  normalizeLanguagePreference
} from '../language-options.js';

export async function loadConfig(isElectron) {
  if (!isElectron) return {};
  try {
    const result = await window.electronAPI.loadConfig();
    if (result.success) return result.config || {};
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return {};
}

export async function saveConfig(isElectron, cfg) {
  if (!isElectron) return;
  try {
    await window.electronAPI.saveConfig(cfg);
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

export async function showConfigDialog(isElectron, currentConfig) {
  if (!isElectron) return;

  // Load the latest config from file to ensure we have the most recent settings
  const config = {
    ...(currentConfig || {}),
    ...await loadConfig(isElectron)
  };
  config.language = normalizeLanguagePreference(config.language || AUTO_LANGUAGE_PREFERENCE);
  
  const presets = (window.pipelineManager && window.pipelineManager.presetManager)
    ? await window.pipelineManager.presetManager.getPresets()
    : {};
  const presetNames = Object.keys(presets).sort();
  const t = window.uiManager.t.bind(window.uiManager);

  // Fix for single preset case: auto-set startupPreset if pipelineStartup is 'preset' but startupPreset is empty
  if (config.pipelineStartup === 'preset' && (!config.startupPreset || config.startupPreset === '') && presetNames.length > 0) {
    config.startupPreset = presetNames[0];
  }

  const dialogHTML = `
    <div class="config-dialog">
      <h2 id="config-title"></h2>
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
      </div>
      <div class="device-section">
        <label class="section-label" for="language-select" id="config-language-label"></label>
        <select id="language-select" class="config-select"></select>
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
          <select id="preset-select" class="config-select" ${config.pipelineStartup === 'preset' ? '' : 'disabled'}>
            ${presetNames.map(n => `<option value="${n}" ${config.startupPreset === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
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

  function renderLanguageOptions() {
    const languageSelect = document.getElementById('language-select');
    if (!languageSelect) {
      return;
    }

    const selectedValue = normalizeLanguagePreference(config.language);
    languageSelect.innerHTML = LANGUAGE_OPTIONS.map(option => {
      const label = getLanguageOptionLabel(option.value, t);
      const selected = option.value === selectedValue ? ' selected' : '';
      return `<option value="${option.value}"${selected}>${label}</option>`;
    }).join('');
  }

  function renderDialogTexts() {
    document.getElementById('config-title').textContent = t('dialog.config.title');
    document.getElementById('config-auto-launch-label').textContent = t('dialog.config.autoLaunch');
    document.getElementById('config-start-min-label').textContent = t('dialog.config.startMinimized');
    document.getElementById('config-tray-label').textContent = t('dialog.config.minimizeToTray');
    document.getElementById('config-check-updates-label').textContent = t('dialog.config.checkForUpdatesOnStartup');
    document.getElementById('config-language-label').textContent = t('dialog.config.language');
    document.getElementById('config-pipeline-label').textContent = t('dialog.config.pipeline');
    document.getElementById('config-pipeline-default-label').textContent = t('dialog.config.pipeline.default');
    document.getElementById('config-pipeline-last-label').textContent = t('dialog.config.pipeline.last');
    document.getElementById('config-pipeline-preset-label').textContent = t('dialog.config.pipeline.preset');
    document.getElementById('close-btn').textContent = t('dialog.config.close');
    renderLanguageOptions();
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

  document.getElementById('auto-launch').addEventListener('change', e => {
    config.autoLaunch = e.target.checked; save();
  });
  document.getElementById('start-min').addEventListener('change', e => {
    config.startMinimized = e.target.checked; save();
  });
  document.getElementById('tray').addEventListener('change', e => {
    config.minimizeToTray = e.target.checked; save();
  });
  document.getElementById('check-updates').addEventListener('change', e => {
    config.checkForUpdatesOnStartup = e.target.checked; save();
  });
  Array.from(overlay.querySelectorAll('input[name="pipeline"]')).forEach(el => {
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
