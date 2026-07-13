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
import {
  MUSIC_LIBRARY_STARTUP_VIEWS,
  normalizeMusicLibraryStartupView
} from '../library/constants.js';
import {
  FULL_SUSPEND_DELAY_SECONDS_VALUES,
  PowerPolicy,
  SILENCE_THRESHOLD_DB_VALUES,
  mergePowerSavingSettings,
  normalizePowerSettings
} from '../audio/power-policy.js';

const electronConfigStates = new WeakMap();
const fallbackElectronConfigState = {
  snapshot: null,
  commitTail: Promise.resolve()
};

function cloneElectronConfig(config) {
  const cloned = { ...config };
  if (config?.powerSaving && typeof config.powerSaving === 'object' &&
      !Array.isArray(config.powerSaving)) {
    cloned.powerSaving = { ...config.powerSaving };
  }
  return cloned;
}

function getElectronConfigState() {
  const electronAPI = window.electronAPI;
  if (!electronAPI || (typeof electronAPI !== 'object' && typeof electronAPI !== 'function')) {
    return fallbackElectronConfigState;
  }
  let state = electronConfigStates.get(electronAPI);
  if (!state) {
    state = { snapshot: null, commitTail: Promise.resolve() };
    electronConfigStates.set(electronAPI, state);
  }
  return state;
}

function publishElectronConfigSnapshot(config, state = getElectronConfigState()) {
  const published = cloneElectronConfig(config);
  state.snapshot = cloneElectronConfig(published);
  window.appConfig = published;
  if (window.electronIntegration) {
    window.electronIntegration.config = published;
  }
}

export async function loadConfig(isElectron) {
  if (!isElectron) return loadWebAppConfig();
  try {
    const result = await window.electronAPI.loadConfig();
    if (result.success) {
      const config = result.config || {};
      getElectronConfigState().snapshot = cloneElectronConfig(config);
      return config;
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return {};
}

export async function saveConfig(isElectron, cfg) {
  if (!isElectron) {
    try {
      return await saveWebAppConfig(cfg);
    } catch (error) {
      console.error('Failed to save Web App Config:', error);
      return false;
    }
  }
  const state = getElectronConfigState();
  const patch = { ...cfg };
  const result = state.commitTail.then(async () => {
    const current = state.snapshot || window.electronIntegration?.config || window.appConfig || {};
    const nextConfig = { ...current, ...patch };
    try {
      const saveResult = await window.electronAPI.saveConfig(nextConfig);
      if (saveResult?.success === true) {
        publishElectronConfigSnapshot(nextConfig, state);
        if (saveResult.warning) {
          console.warn('Config was saved with a non-fatal side-effect failure:', saveResult.warning);
        }
        return true;
      }
      console.error(
        'Failed to save config:',
        saveResult?.error || 'Unknown Electron save failure'
      );
      return false;
    } catch (error) {
      console.error('Failed to save config:', error);
      return false;
    }
  });
  state.commitTail = result.catch(() => {});
  return result;
}

export async function showConfigDialog(isElectron, currentConfig) {
  // Load the latest config from file to ensure we have the most recent settings
  const config = {
    ...(currentConfig || {}),
    ...await loadConfig(isElectron)
  };
  config.language = normalizeLanguagePreference(config.language || AUTO_LANGUAGE_PREFERENCE);
  config.startupView = config.startupView === 'library' ? 'library' : 'effects';
  config.libraryStartupView = normalizeMusicLibraryStartupView(config.libraryStartupView);
  let powerSavingSettings = normalizePowerSettings(config.powerSaving);
  config.powerSaving = { ...powerSavingSettings };
  
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

  const powerSavingSection = `
      <div class="device-section power-saving-section" id="power-saving-section">
        <label class="section-label" id="power-saving-title"></label>
        <div class="power-mode-group" id="power-mode-group" role="radiogroup" aria-labelledby="power-saving-title">
          <div class="power-mode-option">
            <div class="radio-container">
              <input type="radio" name="power-saving-mode" id="power-mode-continuous" value="continuous" aria-describedby="power-mode-continuous-help" ${powerSavingSettings.mode === PowerPolicy.CONTINUOUS ? 'checked' : ''}>
              <label for="power-mode-continuous" id="power-mode-continuous-label"></label>
            </div>
            <div class="power-mode-help" id="power-mode-continuous-help"></div>
          </div>
          <div class="power-mode-option">
            <div class="radio-container">
              <input type="radio" name="power-saving-mode" id="power-mode-balanced" value="balanced" aria-describedby="power-mode-balanced-help" ${powerSavingSettings.mode === PowerPolicy.BALANCED ? 'checked' : ''}>
              <label for="power-mode-balanced" id="power-mode-balanced-label"></label>
            </div>
            <div class="power-mode-help" id="power-mode-balanced-help"></div>
          </div>
          <div class="power-mode-option">
            <div class="radio-container">
              <input type="radio" name="power-saving-mode" id="power-mode-maximum" value="maximum" aria-describedby="power-mode-maximum-help power-saving-maximum-warning" ${powerSavingSettings.mode === PowerPolicy.MAXIMUM ? 'checked' : ''}>
              <label for="power-mode-maximum" id="power-mode-maximum-label"></label>
            </div>
            <div class="power-mode-help" id="power-mode-maximum-help"></div>
          </div>
        </div>
        <div class="power-saving-warning" id="power-saving-maximum-warning" role="note" ${powerSavingSettings.mode === PowerPolicy.MAXIMUM ? '' : 'hidden'}></div>
        <div class="power-advanced-settings" role="group" aria-labelledby="power-saving-advanced-label">
          <div class="power-advanced-label" id="power-saving-advanced-label"></div>
          <div class="power-setting-row" id="power-silence-threshold-row" ${powerSavingSettings.mode === PowerPolicy.CONTINUOUS ? 'hidden' : ''}>
            <label for="power-silence-threshold" id="power-silence-threshold-label"></label>
            <select id="power-silence-threshold" class="config-select" ${powerSavingSettings.mode === PowerPolicy.CONTINUOUS ? 'disabled' : ''}></select>
          </div>
          <div class="power-setting-row" id="power-full-suspend-delay-row" ${powerSavingSettings.mode === PowerPolicy.MAXIMUM ? '' : 'hidden'}>
            <label for="power-full-suspend-delay" id="power-full-suspend-delay-label"></label>
            <select id="power-full-suspend-delay" class="config-select" ${powerSavingSettings.mode === PowerPolicy.MAXIMUM ? '' : 'disabled'}></select>
          </div>
        </div>
      </div>`;

  const dialogHTML = `
    <div class="config-dialog">
      <h2 id="config-title"></h2>
      <div class="config-dialog-content">
        <div class="config-dialog-column">
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
              <select id="library-startup-view-select" class="config-select" aria-labelledby="config-startup-view-library-label" ${config.startupView === 'library' ? '' : 'disabled'}></select>
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
        </div>
        <div class="config-dialog-column config-dialog-power-column">
          ${powerSavingSection}
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
      width: 760px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 40px);
      overflow-y: auto;
      box-sizing: border-box;
      color: #fff;
    }
    .config-dialog h2 {
      margin-top: 0;
      margin-bottom: 20px;
      color: #fff;
    }
    .config-dialog-content {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 24px;
    }
    .config-dialog-column {
      min-width: 0;
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
    .power-saving-section {
      padding-left: 24px;
      border-left: 1px solid #444;
    }
    .power-mode-option {
      margin-bottom: 9px;
    }
    .power-mode-option .radio-container {
      margin-bottom: 2px;
    }
    .power-mode-help {
      margin-left: 26px;
      color: #bbb;
      font-size: 12px;
      line-height: 1.4;
    }
    .power-saving-warning {
      margin: 10px 0 12px 26px;
      padding: 9px 10px;
      border: 1px solid #8a6b2f;
      border-radius: 4px;
      background: #3b321f;
      color: #ffe2a8;
      font-size: 12px;
      line-height: 1.45;
    }
    .power-saving-warning[hidden],
    .power-setting-row[hidden] {
      display: none;
    }
    .power-advanced-settings {
      margin: 12px 0 0 26px;
      padding-top: 10px;
      border-top: 1px solid #3d3d3d;
    }
    .power-advanced-label {
      margin-bottom: 8px;
      color: #ddd;
      font-size: 12px;
      font-weight: bold;
    }
    .power-setting-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 34px;
      color: #ddd;
      font-size: 12px;
    }
    .power-setting-row label {
      flex: 1 1 auto;
      min-width: 0;
    }
    .power-setting-row .config-select {
      flex: 0 0 auto;
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
    body.layout-mobile .config-dialog-content {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    body.layout-mobile .power-saving-section {
      padding-top: 12px;
      padding-left: 0;
      border-top: 1px solid #444;
      border-left: 0;
    }
    @media (max-width: 700px) {
      .config-dialog {
        width: 400px;
      }
      .config-dialog-content {
        grid-template-columns: minmax(0, 1fr);
        gap: 0;
      }
      .power-saving-section {
        padding-top: 12px;
        padding-left: 0;
        border-top: 1px solid #444;
        border-left: 0;
      }
      .power-mode-help,
      .power-saving-warning,
      .power-advanced-settings {
        margin-left: 0;
      }
      .power-setting-row {
        align-items: stretch;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }
      .power-setting-row .config-select {
        width: 100%;
        margin-left: 0;
      }
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

  function renderLibraryStartupViewOptions() {
    replaceOptions(
      document.getElementById('library-startup-view-select'),
      MUSIC_LIBRARY_STARTUP_VIEWS,
      config.libraryStartupView,
      view => t(`library.nav.${view}`)
    );
  }

  function renderPowerSettingOptions() {
    if (!powerSavingSettings) return;
    replaceOptions(
      document.getElementById('power-silence-threshold'),
      SILENCE_THRESHOLD_DB_VALUES,
      powerSavingSettings.silenceThresholdDb,
      value => `${value} dBFS`
    );
    const delayKeyByValue = {
      60: '1m',
      300: '5m',
      900: '15m',
      never: 'never'
    };
    replaceOptions(
      document.getElementById('power-full-suspend-delay'),
      FULL_SUSPEND_DELAY_SECONDS_VALUES,
      powerSavingSettings.fullSuspendDelaySeconds,
      value => t(`dialog.config.powerSaving.delay.${delayKeyByValue[value]}`)
    );
  }

  function syncPowerSettingControls(settings = powerSavingSettings) {
    if (!settings) return;
    const modeInputs = {
      [PowerPolicy.CONTINUOUS]: document.getElementById('power-mode-continuous'),
      [PowerPolicy.BALANCED]: document.getElementById('power-mode-balanced'),
      [PowerPolicy.MAXIMUM]: document.getElementById('power-mode-maximum')
    };
    Object.entries(modeInputs).forEach(([mode, input]) => {
      if (input) input.checked = settings.mode === mode;
    });

    const thresholdSelect = document.getElementById('power-silence-threshold');
    const thresholdRow = document.getElementById('power-silence-threshold-row');
    const thresholdHidden = settings.mode === PowerPolicy.CONTINUOUS;
    if (thresholdSelect) {
      thresholdSelect.value = String(settings.silenceThresholdDb);
      thresholdSelect.disabled = thresholdHidden;
    }
    if (thresholdRow) thresholdRow.hidden = thresholdHidden;

    const delaySelect = document.getElementById('power-full-suspend-delay');
    const delayRow = document.getElementById('power-full-suspend-delay-row');
    const delayHidden = settings.mode !== PowerPolicy.MAXIMUM;
    if (delaySelect) {
      delaySelect.value = String(settings.fullSuspendDelaySeconds);
      delaySelect.disabled = delayHidden;
    }
    if (delayRow) delayRow.hidden = delayHidden;

    const warning = document.getElementById('power-saving-maximum-warning');
    if (warning) {
      warning.hidden = delayHidden;
      warning.setAttribute('aria-hidden', delayHidden ? 'true' : 'false');
    }
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
    const powerSavingTitle = document.getElementById('power-saving-title');
    if (powerSavingTitle) powerSavingTitle.textContent = t('dialog.config.powerSaving.title');
    const continuousLabel = document.getElementById('power-mode-continuous-label');
    if (continuousLabel) continuousLabel.textContent = t('dialog.config.powerSaving.mode.continuous');
    const continuousHelp = document.getElementById('power-mode-continuous-help');
    if (continuousHelp) continuousHelp.textContent = t('dialog.config.powerSaving.mode.continuousHelp');
    const balancedLabel = document.getElementById('power-mode-balanced-label');
    if (balancedLabel) balancedLabel.textContent = t('dialog.config.powerSaving.mode.balanced');
    const balancedHelp = document.getElementById('power-mode-balanced-help');
    if (balancedHelp) balancedHelp.textContent = t('dialog.config.powerSaving.mode.balancedHelp');
    const maximumLabel = document.getElementById('power-mode-maximum-label');
    if (maximumLabel) maximumLabel.textContent = t('dialog.config.powerSaving.mode.maximum');
    const maximumHelp = document.getElementById('power-mode-maximum-help');
    if (maximumHelp) maximumHelp.textContent = t('dialog.config.powerSaving.mode.maximumHelp');
    const maximumWarning = document.getElementById('power-saving-maximum-warning');
    if (maximumWarning) maximumWarning.textContent = t('dialog.config.powerSaving.maximumWarning');
    const advancedLabel = document.getElementById('power-saving-advanced-label');
    if (advancedLabel) advancedLabel.textContent = t('dialog.config.powerSaving.advanced');
    const thresholdLabel = document.getElementById('power-silence-threshold-label');
    if (thresholdLabel) thresholdLabel.textContent = t('dialog.config.powerSaving.silenceThreshold');
    const delayLabel = document.getElementById('power-full-suspend-delay-label');
    if (delayLabel) delayLabel.textContent = t('dialog.config.powerSaving.fullSuspendDelay');
    document.getElementById('close-btn').textContent = t('dialog.config.close');
    renderLanguageOptions();
    renderLibraryStartupViewOptions();
    renderPresetOptions();
    renderPowerSettingOptions();
    syncPowerSettingControls();
  }

  function publishElectronConfig(nextConfig) {
    const publishedConfig = {
      ...nextConfig,
      powerSaving: { ...normalizePowerSettings(nextConfig.powerSaving) }
    };
    publishElectronConfigSnapshot(publishedConfig);
  }

  function syncConfigControls() {
    const autoLaunch = document.getElementById('auto-launch');
    if (autoLaunch) autoLaunch.checked = Boolean(config.autoLaunch);
    const startMin = document.getElementById('start-min');
    if (startMin) startMin.checked = Boolean(config.startMinimized);
    const tray = document.getElementById('tray');
    if (tray) tray.checked = Boolean(config.minimizeToTray);
    const checkUpdates = document.getElementById('check-updates');
    if (checkUpdates) checkUpdates.checked = config.checkForUpdatesOnStartup !== false;

    const startupView = config.startupView === 'library' ? 'library' : 'effects';
    const startupEffects = document.getElementById('startup-view-effects');
    const startupLibrary = document.getElementById('startup-view-library');
    if (startupEffects) startupEffects.checked = startupView === 'effects';
    if (startupLibrary) startupLibrary.checked = startupView === 'library';
    const libraryStartupView = document.getElementById('library-startup-view-select');
    if (libraryStartupView) {
      libraryStartupView.value = normalizeMusicLibraryStartupView(config.libraryStartupView);
      libraryStartupView.disabled = startupView !== 'library';
    }

    const pipelineStartup = ['default', 'preset'].includes(config.pipelineStartup)
      ? config.pipelineStartup
      : 'last';
    for (const value of ['default', 'last', 'preset']) {
      const input = document.getElementById(`pl-${value}`);
      if (input) input.checked = pipelineStartup === value;
    }
    const presetSelect = document.getElementById('preset-select');
    if (presetSelect) {
      presetSelect.value = config.startupPreset || '';
      presetSelect.disabled = pipelineStartup !== 'preset';
    }
    renderLanguageOptions();
  }

  let configSaveSequence = 0;
  async function save(partialConfig) {
    const saveSequence = ++configSaveSequence;
    const saved = await saveConfig(isElectron, partialConfig);
    if (!saved) {
      if (saveSequence === configSaveSequence) syncConfigControls();
      window.uiManager?.setError?.('Failed to save settings.', true);
      return false;
    }
    Object.assign(config, window.appConfig || partialConfig);
    if (saveSequence === configSaveSequence) syncConfigControls();
    return true;
  }

  let powerUpdateSequence = 0;
  async function applyPowerSettings(partialPowerSaving) {
    if (!powerSavingSettings) return false;
    const audioManager = window.audioManager;
    if (typeof audioManager?.updatePowerSettings !== 'function') {
      console.warn('Power settings are unavailable because AudioManager is not ready');
      syncPowerSettingControls();
      return false;
    }

    const previousSettings = powerSavingSettings;
    const optimisticSettings = mergePowerSavingSettings(powerSavingSettings, partialPowerSaving);
    const updateSequence = ++powerUpdateSequence;
    powerSavingSettings = optimisticSettings;
    config.powerSaving = { ...optimisticSettings };
    syncPowerSettingControls();

    try {
      const appliedSettings = await audioManager.updatePowerSettings(partialPowerSaving);
      if (updateSequence !== powerUpdateSequence) return true;
      powerSavingSettings = mergePowerSavingSettings(
        powerSavingSettings,
        appliedSettings && typeof appliedSettings === 'object' ? appliedSettings : partialPowerSaving
      );
      config.powerSaving = { ...powerSavingSettings };
      syncPowerSettingControls();
      if (isElectron) {
        // Web persistence happens inside audioManager.updatePowerSettings.
        // Electron persists the whole config here; powerSaving is always the
        // complete merged object so the main-process shallow merge can never
        // drop silenceThresholdDb / fullSuspendDelaySeconds.
        const saved = await save({ powerSaving: { ...powerSavingSettings } });
        if (!saved) throw new Error('Failed to persist power settings');
      }
      return true;
    } catch (error) {
      if (updateSequence === powerUpdateSequence) {
        let authoritativeSettings = previousSettings;
        let authoritativeConfig = null;
        try {
          const loadedConfig = await loadConfig(isElectron);
          const loadedPowerSaving = loadedConfig?.powerSaving;
          if (loadedPowerSaving && typeof loadedPowerSaving === 'object' &&
              !Array.isArray(loadedPowerSaving)) {
            authoritativeConfig = loadedConfig;
            authoritativeSettings = normalizePowerSettings(loadedPowerSaving);
          }
          if (isElectron) await audioManager.updatePowerSettings(authoritativeSettings);
        } catch (readError) {
          console.error('Failed to read back persisted power settings:', readError);
        }
        powerSavingSettings = authoritativeSettings;
        config.powerSaving = { ...authoritativeSettings };
        syncPowerSettingControls();
        if (isElectron) {
          publishElectronConfig({
            ...(authoritativeConfig || window.appConfig || config),
            powerSaving: authoritativeSettings
          });
        }
      }
      console.error('Failed to update power settings:', error);
      return false;
    }
  }

  renderDialogTexts();

  const autoLaunch = document.getElementById('auto-launch');
  if (autoLaunch) {
    autoLaunch.addEventListener('change', async e => {
      await save({ autoLaunch: e.target.checked });
    });
  }
  const startMin = document.getElementById('start-min');
  if (startMin) {
    startMin.addEventListener('change', async e => {
      await save({ startMinimized: e.target.checked });
    });
  }
  const tray = document.getElementById('tray');
  if (tray) {
    tray.addEventListener('change', async e => {
      await save({ minimizeToTray: e.target.checked });
    });
  }
  const checkUpdates = document.getElementById('check-updates');
  if (checkUpdates) {
    checkUpdates.addEventListener('change', async e => {
      await save({ checkForUpdatesOnStartup: e.target.checked });
    });
  }
  [
    [document.getElementById('power-mode-continuous'), PowerPolicy.CONTINUOUS],
    [document.getElementById('power-mode-balanced'), PowerPolicy.BALANCED],
    [document.getElementById('power-mode-maximum'), PowerPolicy.MAXIMUM]
  ].forEach(([input, mode]) => {
    input?.addEventListener('change', async e => {
      if (!e.target.checked) return;
      await applyPowerSettings({ mode });
    });
  });
  const powerSilenceThreshold = document.getElementById('power-silence-threshold');
  powerSilenceThreshold?.addEventListener('change', async e => {
    await applyPowerSettings({ silenceThresholdDb: Number(e.target.value) });
  });
  const powerFullSuspendDelay = document.getElementById('power-full-suspend-delay');
  powerFullSuspendDelay?.addEventListener('change', async e => {
    const value = e.target.value === 'never' ? 'never' : Number(e.target.value);
    await applyPowerSettings({ fullSuspendDelaySeconds: value });
  });
  [
    document.getElementById('startup-view-effects'),
    document.getElementById('startup-view-library')
  ].filter(Boolean).forEach(el => {
    el.addEventListener('change', async () => {
      const startupView = el.value === 'library' ? 'library' : 'effects';
      if (await save({ startupView })) syncConfigControls();
    });
  });
  const libraryStartupViewSelect = document.getElementById('library-startup-view-select');
  if (libraryStartupViewSelect) {
    libraryStartupViewSelect.addEventListener('change', async e => {
      await save({ libraryStartupView: normalizeMusicLibraryStartupView(e.target.value) });
    });
  }
  const pipelineInputs = typeof overlay.querySelectorAll === 'function'
    ? Array.from(overlay.querySelectorAll('input[name="pipeline"]'))
    : [];
  pipelineInputs.forEach(el => {
    el.addEventListener('change', async () => {
      if (await save({ pipelineStartup: el.value })) syncConfigControls();
    });
  });
  const select = document.getElementById('preset-select');
  if (select) {
    select.addEventListener('change', async e => {
      await save({ startupPreset: e.target.value });
    });
  }
  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
    languageSelect.addEventListener('change', async e => {
      const language = normalizeLanguagePreference(e.target.value);
      if (!await save({ language })) return;

      if (window.uiManager && typeof window.uiManager.setLanguagePreference === 'function') {
        await window.uiManager.setLanguagePreference(language, { persist: false });
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
