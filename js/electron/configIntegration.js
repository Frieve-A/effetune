import {
  AUTO_LANGUAGE_PREFERENCE,
  LANGUAGE_OPTIONS,
  getLanguageOptionLabel,
  normalizeLanguagePreference
} from '../language-options.js';
import {
  loadConfig,
  publishElectronConfigSnapshot,
  saveConfig
} from './config-store.js';
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
import {
  OFFLINE_OUTPUT_FORMATS,
  normalizeOfflineOutputSettings
} from '../audio/offline-output-settings.js';
import { isVisualSyncEnabled } from '../audio/visual-sync.js';
import { validateRules } from '../browser/url-rules.js';
import { SFZ_SIZE_LIMIT_MIB_OPTIONS, normalizeSfzSizeLimitMiB } from '../sfz/limits.js';
import { closeStandardSelect, enableStandardSelects } from '../ui/standard-select.js';
import { getRemoteControlSettings } from '../remote/remote-control-settings.js';
import { NetworkMusicSettings } from '../network-music/settings-view.js';

import { THEME_PRESETS, getThemePreset, normalizeThemeId } from '../theme-registry.mjs';

export { loadConfig, saveConfig };

const CONFIG_CATEGORY_LABEL_KEYS = {
  general: 'dialog.config.category.general',
  startup: 'dialog.config.category.startup',
  display: 'dialog.config.category.display',
  powerSaving: 'dialog.config.powerSaving.title',
  offlineOutput: 'dialog.config.offlineOutput.title',
  controllers: 'dialog.config.physicalControl',
  browser: 'dialog.config.browser.title',
  network: 'dialog.config.category.network'
};

// The dialog reopens on the category the user viewed last in this session.
let selectedConfigCategory = 'general';

export async function showConfigDialog(isElectron, currentConfig) {
  // Load the latest config from file to ensure we have the most recent settings
  const config = {
    ...(currentConfig || {}),
    ...await loadConfig(isElectron)
  };
  if ('theme' in config) config.theme = normalizeThemeId(config.theme);
  config.language = normalizeLanguagePreference(config.language || AUTO_LANGUAGE_PREFERENCE);
  const startupViews = isElectron ? ['effects', 'library', 'visualizer', 'browser'] : ['effects', 'library', 'visualizer'];
  config.startupView = startupViews.includes(config.startupView) ? config.startupView : 'effects';
  config.libraryStartupView = normalizeMusicLibraryStartupView(config.libraryStartupView);
  config.libraryIncludeVideo = config.libraryIncludeVideo === true;
  config.videoAutoRotate = config.videoAutoRotate !== false;
  let visualizerHdr = false;
  try {
    visualizerHdr = window.localStorage?.getItem('effetune_visualizer_hdr') === 'true';
  } catch (error) {
    console.warn('Failed to load Visualizer HDR setting:', error);
  }
  config.frequencyPreviewSound = config.frequencyPreviewSound === 'bandpassNoise' ? 'bandpassNoise' : 'sine';
  config.sfzMaxSizeMiB = normalizeSfzSizeLimitMiB(config.sfzMaxSizeMiB);
  config.spectrumOverlayQuality = config.spectrumOverlayQuality === 'hq' ? 'hq' : 'normal';
  config.spectrumOverlayPeakHold = config.spectrumOverlayPeakHold === true;
  config.pipelineColumnMode = config.pipelineColumnMode === 'manual' ? 'manual' : 'auto';
  let powerSavingSettings = normalizePowerSettings(config.powerSaving);
  config.powerSaving = { ...powerSavingSettings };
  let offlineOutputSettings = normalizeOfflineOutputSettings(config.offlineOutput);
  config.offlineOutput = { ...offlineOutputSettings };
  let defaultBrowserUserAgent = '';
  if (isElectron && window.electronAPI?.browser?.getState) {
    const browserState = await window.electronAPI.browser.getState();
    config.browser = browserState.settings;
    defaultBrowserUserAgent = browserState.defaultUserAgent;
  }
  
  const pipelinePresetManager = window.pipelineManager && window.pipelineManager.presetManager;
  const presets = pipelinePresetManager
    ? (typeof pipelinePresetManager.getLoadablePresets === 'function'
      ? await pipelinePresetManager.getLoadablePresets()
      : await pipelinePresetManager.getPresets())
    : {};
  const presetNames = Object.keys(presets).sort();
  let browserRulesDraft = structuredClone(config.browser?.urlRules || []);
  const browserRuleLabels = [];
  const t = window.uiManager?.t
    ? window.uiManager.t.bind(window.uiManager)
    : key => key;
  const openHomeAPI = isElectron ? window.electronAPI?.openHomeV1 : null;
  const airPlayAPI = isElectron ? window.electronAPI?.airPlayV1 : null;
  const networkMusicAPI = isElectron ? window.electronAPI : null;
  const remoteControlSettings = networkMusicAPI?.remoteV1?.settings
    ? getRemoteControlSettings(networkMusicAPI.remoteV1.settings) : null;
  const isMsix = isElectron && window.electronAPI?.isMsix === true;

  // Fix for single preset case: auto-set startupPreset if pipelineStartup is 'preset' but startupPreset is empty
  if (config.pipelineStartup === 'preset' && (!config.startupPreset || config.startupPreset === '') && presetNames.length > 0) {
    config.startupPreset = presetNames[0];
  }

  const electronStartupSections = isElectron ? `
      <div class="device-section">
        ${isMsix ? `
        <div class="power-mode-help" id="store-startup-help"></div>
        <button type="button" class="library-button" id="store-startup"></button>` : `
        <div class="checkbox-container">
          <input type="checkbox" id="auto-launch" ${config.autoLaunch ? 'checked' : ''}>
          <label for="auto-launch" id="config-auto-launch-label"></label>
        </div>`}
      </div>
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="start-min" ${config.startMinimized ? 'checked' : ''}>
          <label for="start-min" id="config-start-min-label"></label>
        </div>
      </div>` : '';

  const electronGeneralSections = isElectron ? `
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="tray" ${config.minimizeToTray ? 'checked' : ''}>
          <label for="tray" id="config-tray-label"></label>
        </div>
      </div>
      <div class="device-section">
        ${isMsix ? `
        <div class="power-mode-help" id="store-updates-help"></div>
        <button type="button" class="library-button" id="store-updates"></button>` : `
        <div class="checkbox-container">
          <input type="checkbox" id="check-updates" ${config.checkForUpdatesOnStartup !== false ? 'checked' : ''}>
          <label for="check-updates" id="config-check-updates-label"></label>
        </div>`}
      </div>
      <div class="device-section">
        <div class="checkbox-container">
          <input type="checkbox" id="hardware-acceleration" aria-describedby="hardware-acceleration-help" ${config.hardwareAcceleration !== false ? 'checked' : ''}>
          <label for="hardware-acceleration" id="hardware-acceleration-label"></label>
        </div>
        <div class="power-mode-help" id="hardware-acceleration-help"></div>
      </div>` : '';

  const networkNameSection = isElectron ? `
      <div class="device-section" id="network-device-name-section">
        <div class="network-name-row">
          <label for="network-device-name" id="network-device-name-label"></label>
          <input type="text" id="network-device-name" maxlength="128" disabled>
        </div>
      </div>` : '';

  const remoteControlSection = isElectron ? `
      <div class="device-section" id="network-remote-control-section">
        <label class="section-label" id="network-remote-control-title"></label>
        <div class="checkbox-container">
          <input type="checkbox" id="network-remote-control-enabled" disabled>
          <label for="network-remote-control-enabled" id="network-remote-control-enabled-label"></label>
        </div>
        <div class="network-remote-control-status" id="network-remote-control-status" role="status" aria-live="polite"></div>
      </div>` : '';

  const openHomeSection = isElectron ? `
      <div class="device-section" id="openhome-section">
        <label class="section-label" id="openhome-title"></label>
        <div class="checkbox-container">
          <input type="checkbox" id="openhome-enabled" disabled aria-describedby="openhome-risk">
          <label for="openhome-enabled" id="openhome-enabled-label"></label>
        </div>
        <div class="openhome-status" id="openhome-status" role="status" aria-live="polite"></div>
        <div class="openhome-help" id="openhome-risk"></div>
      </div>` : '';

  const networkReceptionSections = isElectron ? `
      <div class="device-section" id="upnp-av-section">
        <label class="section-label" id="upnp-av-title"></label>
        <div class="checkbox-container">
          <input type="checkbox" id="upnp-av-enabled" disabled aria-describedby="upnp-av-risk">
          <label for="upnp-av-enabled" id="upnp-av-enabled-label"></label>
        </div>
        <div class="openhome-status" id="upnp-av-status" role="status" aria-live="polite"></div>
        <div class="openhome-help" id="upnp-av-risk"></div>
      </div>
      <div class="device-section" id="airplay-section">
        <label class="section-label" id="airplay-title"></label>
        <div class="checkbox-container">
          <input type="checkbox" id="airplay-enabled" disabled aria-describedby="airplay-help">
          <label for="airplay-enabled" id="airplay-enabled-label"></label>
        </div>
        <div class="openhome-status" id="airplay-status" role="status" aria-live="polite"></div>
        <div class="openhome-help" id="airplay-help"></div>
      </div>` : '';

  const librarySharingSection = isElectron ? `
      <div class="device-section" id="library-sharing-section">
        <label class="section-label" id="library-sharing-title"></label>
        <div class="checkbox-container">
          <input type="checkbox" id="library-sharing-enabled" disabled aria-describedby="library-sharing-help">
          <label for="library-sharing-enabled" id="library-sharing-enabled-label"></label>
        </div>
        <div class="library-sharing-options">
          <div class="power-mode-help" id="library-sharing-help"></div>
          <div class="library-sharing-folders" id="library-sharing-folders"></div>
          <div class="power-mode-help" id="library-sharing-empty" hidden></div>
          <div class="library-sharing-actions">
            <button type="button" class="library-button" id="library-sharing-save" disabled></button>
            <div class="power-mode-help" id="library-sharing-status" role="status" aria-live="polite"></div>
          </div>
        </div>
      </div>` : '';

  const powerSavingSection = `
      <div class="device-section" id="power-saving-section">
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
          <div class="power-mode-option">
            <div class="checkbox-container">
              <input type="checkbox" id="power-skip-display-dsp-when-hidden" aria-describedby="power-skip-display-dsp-when-hidden-help" ${powerSavingSettings.skipDisplayDspWhenHidden ? 'checked' : ''}>
              <label for="power-skip-display-dsp-when-hidden" id="power-skip-display-dsp-when-hidden-label"></label>
            </div>
            <div class="power-mode-help" id="power-skip-display-dsp-when-hidden-help"></div>
          </div>
        </div>
      </div>`;

  const physicalControlSection = `
      <div class="device-section" id="physical-control-section">
        <label class="section-label" id="physical-control-title"></label>
        <button type="button" class="library-button" id="controller-mapping-btn"></button>
      </div>`;

  const offlineOutputSection = `
      <div class="device-section" id="offline-output-section">
        <label class="section-label" id="offline-output-title"></label>
        <div class="offline-output-row">
          <label for="offline-output-format" id="offline-output-format-label"></label>
          <select id="offline-output-format" class="config-select"></select>
        </div>
        <div class="offline-output-row">
          <label for="offline-output-sample-rate" id="offline-output-sample-rate-label"></label>
          <select id="offline-output-sample-rate" class="config-select"></select>
        </div>
        <div class="offline-output-row" id="offline-output-quality-row">
          <label for="offline-output-quality" id="offline-output-quality-label"></label>
          <select id="offline-output-quality" class="config-select" aria-describedby="offline-output-help"></select>
        </div>
        <div class="offline-output-help" id="offline-output-help"></div>
      </div>`;

  const categoryPanels = {
    general: `
          <div class="device-section">
            <label class="section-label" for="language-select" id="config-language-label"></label>
            <select id="language-select" class="config-select"></select>
          </div>
          <div class="device-section">
            <label class="section-label" for="theme-select" id="config-theme-label"></label>
            <select id="theme-select" class="config-select"></select>
          </div>
          <div class="device-section">
            <label class="section-label" for="frequency-preview-sound" id="frequency-preview-sound-label"></label>
            <select id="frequency-preview-sound" class="config-select"></select>
          </div>
          <div class="device-section">
            <label class="section-label" for="sfz-size-limit" id="sfz-size-limit-label"></label>
            <select id="sfz-size-limit" class="config-select" aria-describedby="sfz-size-limit-help"></select>
            <div class="power-mode-help" id="sfz-size-limit-help"></div>
          </div>
          <div class="device-section">
            <div class="checkbox-container">
              <input type="checkbox" id="library-include-video" aria-describedby="library-include-video-help" ${config.libraryIncludeVideo ? 'checked' : ''}>
              <label for="library-include-video" id="library-include-video-label"></label>
            </div>
            <div class="power-mode-help" id="library-include-video-help"></div>
          </div>
          ${electronGeneralSections}`,
    startup: `
          ${electronStartupSections}
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
            <div class="radio-container">
              <input type="radio" name="startup-view" id="startup-view-visualizer" value="visualizer" ${config.startupView === 'visualizer' ? 'checked' : ''}>
              <label for="startup-view-visualizer" id="config-startup-view-visualizer-label"></label>
              <input type="checkbox" id="visualizer-startup-expanded" ${config.visualizerStartupExpanded === true ? 'checked' : ''} ${config.startupView === 'visualizer' ? '' : 'disabled'}>
              <label for="visualizer-startup-expanded" id="config-visualizer-startup-expanded-label"></label>
            </div>
            ${isElectron ? `<div class="radio-container">
              <input type="radio" name="startup-view" id="startup-view-browser" value="browser" ${config.startupView === 'browser' ? 'checked' : ''}>
              <label for="startup-view-browser" id="config-startup-view-browser-label"></label>
            </div>` : ''}
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
          </div>`,
    display: `
          <div class="device-section">
            <label class="section-label" for="pipeline-column-mode" id="pipeline-column-mode-label"></label>
            <select id="pipeline-column-mode" class="config-select" aria-describedby="pipeline-column-mode-help"></select>
            <div class="power-mode-help" id="pipeline-column-mode-help"></div>
          </div>
          <div class="device-section">
            <div class="checkbox-container">
              <input type="checkbox" id="visual-sync" aria-describedby="visual-sync-help" ${isVisualSyncEnabled(config) ? 'checked' : ''}>
              <label for="visual-sync" id="visual-sync-label"></label>
            </div>
            <div class="power-mode-help" id="visual-sync-help"></div>
          </div>
          <div class="device-section" role="group" aria-labelledby="spectrum-overlay-title">
            <div class="section-label" id="spectrum-overlay-title"></div>
            <div class="spectrum-overlay-row">
              <label for="spectrum-overlay-quality" id="spectrum-overlay-quality-label"></label>
              <select id="spectrum-overlay-quality" class="config-select"></select>
            </div>
            <div class="spectrum-overlay-row">
              <label for="spectrum-overlay-display" id="spectrum-overlay-display-label"></label>
              <select id="spectrum-overlay-display" class="config-select"></select>
            </div>
          </div>
          <div class="device-section">
            <div class="checkbox-container">
              <input type="checkbox" id="video-auto-rotate" aria-describedby="video-auto-rotate-help" ${config.videoAutoRotate ? 'checked' : ''}>
              <label for="video-auto-rotate" id="video-auto-rotate-label"></label>
            </div>
            <div class="power-mode-help" id="video-auto-rotate-help"></div>
          </div>
          <div class="device-section">
            <div class="checkbox-container">
              <input type="checkbox" id="visualizer-hdr" aria-describedby="visualizer-hdr-help" ${visualizerHdr ? 'checked' : ''}>
              <label for="visualizer-hdr" id="visualizer-hdr-label"></label>
            </div>
            <div class="power-mode-help" id="visualizer-hdr-help"></div>
          </div>`,
    powerSaving: powerSavingSection,
    offlineOutput: offlineOutputSection,
    controllers: physicalControlSection,
    ...(isElectron ? {
      browser: `
          <div class="device-section">
            <label class="section-label" for="browser-user-agent" id="browser-user-agent-label"></label>
            <div class="browser-setting-row">
              <input type="text" class="browser-setting-input" id="browser-user-agent" maxlength="1024" spellcheck="false" aria-describedby="browser-user-agent-help">
              <button type="button" class="library-button" id="browser-reset-user-agent"></button>
            </div>
            <div class="power-mode-help" id="browser-user-agent-help"></div>
            <div class="checkbox-container">
              <input type="checkbox" id="browser-open-tabs-externally">
              <label for="browser-open-tabs-externally" id="browser-open-tabs-externally-label"></label>
            </div>
          </div>
          <div class="device-section">
            <label class="section-label" for="browser-start-page" id="browser-start-page-label"></label>
            <div class="browser-setting-row">
              <input type="text" class="browser-setting-input" id="browser-start-page" maxlength="8192" spellcheck="false" aria-describedby="browser-start-page-help">
              <button type="button" class="library-button" id="browser-reset-start-page"></button>
            </div>
            <div class="power-mode-help" id="browser-start-page-help"></div>
          </div>
          <fieldset class="device-section browser-rules" id="browser-rules-controls">
            <legend class="section-label" id="browser-rules-title"></legend>
            <div class="power-mode-help" id="browser-rules-help"></div>
            <div id="browser-rules-list"></div>
            <div class="browser-setting-row">
              <button type="button" class="library-button" id="browser-rules-add"></button>
              <button type="button" class="library-button" id="browser-rules-save"></button>
              <button type="button" class="library-button" id="browser-rules-cancel"></button>
            </div>
          </fieldset>`,
      network: networkNameSection + remoteControlSection + openHomeSection + networkReceptionSections + librarySharingSection
    } : {})
  };
  const categories = Object.keys(categoryPanels);
  if (!categories.includes(selectedConfigCategory)) selectedConfigCategory = categories[0];

  const dialogHTML = `
    <div class="config-dialog">
      <h2 id="config-title"></h2>
      <div class="config-dialog-content">
        <nav class="config-category-list">
          ${categories.map(category => `
          <button type="button" class="config-category-button" id="config-category-${category}" aria-controls="config-panel-${category}"></button>`).join('')}
        </nav>
        <div class="config-category-panels" id="config-category-panels">
          ${categories.map(category => `
          <div class="config-category-panel" id="config-panel-${category}">${categoryPanels[category]}
          </div>`).join('')}
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
  const networkSettings = isElectron ? new NetworkMusicSettings({
    root: document.getElementById('config-panel-network'), api: networkMusicAPI, remoteSettings: remoteControlSettings, translate: t
  }) : null;
  await networkSettings?.mount();
  enableStandardSelects(overlay);

  const style = document.createElement('style');
  style.textContent = `
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: var(--et-scrim);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .config-dialog {
      background-color: var(--et-surface-5);
      border-radius: 8px;
      padding: 20px;
      width: 760px;
      max-width: calc(100% - 32px);
      height: min(600px, calc(100% - 40px));
      max-height: calc(100% - 32px);
      overflow: auto;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      color: var(--et-text-primary);
    }
    .config-dialog h2 {
      margin-top: 0;
      margin-bottom: 16px;
      color: var(--et-text-primary);
    }
    .config-dialog-content {
      flex: 1 1 auto;
      min-height: 0;
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr);
      border-top: 1px solid var(--et-surface-20);
    }
    .config-category-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 12px 12px 12px 0;
      border-right: 1px solid var(--et-surface-20);
      overflow-y: auto;
    }
    .config-category-button {
      flex: 0 0 auto;
      padding: 8px 12px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--et-surface-89);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .config-category-button:hover {
      background-color: var(--et-surface-13);
      color: var(--et-text-primary);
    }
    .config-category-button[aria-current="true"] {
      background-color: var(--et-surface-17);
      box-shadow: inset 3px 0 0 var(--et-accent);
      color: var(--et-text-primary);
      font-weight: bold;
    }
    .config-category-panels {
      min-width: 0;
      padding: 16px 4px 0 24px;
      overflow-y: auto;
    }
    .config-category-panel[hidden] {
      display: none;
    }
    .device-section {
      margin-bottom: 18px;
    }
    .device-section .section-label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
      color: var(--et-text-primary);
    }
    .power-mode-option {
      margin-bottom: 9px;
    }
    .power-mode-option .radio-container {
      margin-bottom: 2px;
    }
    .power-mode-help {
      margin-top: 6px;
      margin-left: 26px;
      color: var(--et-surface-74);
      font-size: 12px;
      line-height: 1.4;
    }
    .power-saving-warning {
      margin: 10px 0 12px 26px;
      padding: 9px 10px;
      border: 1px solid var(--et-warning);
      border-radius: 4px;
      background: color-mix(in srgb, var(--et-warning) 10%, transparent);
      color: var(--et-warning);
      font-size: 12px;
      line-height: 1.45;
    }
    .power-saving-warning[hidden],
    .power-setting-row[hidden],
    .offline-output-row[hidden] {
      display: none;
    }
    .offline-output-row,
    .spectrum-overlay-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(120px, 1fr);
      align-items: center;
      gap: 10px;
      margin-bottom: 9px;
    }
    .spectrum-overlay-row:last-child {
      margin-bottom: 0;
    }
    .offline-output-row .config-select,
    .spectrum-overlay-row .config-select {
      width: 100%;
    }
    .offline-output-help {
      color: var(--et-surface-74);
      font-size: 12px;
      line-height: 1.4;
    }
    .network-name-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
    }
    .network-name-row label {
      flex: 0 0 auto;
      color: var(--et-surface-89);
      font-size: 13px;
    }
    .network-name-row input,
    .browser-setting-input {
      min-width: 0;
      flex: 1 1 auto;
      padding: 6px 8px;
      border: 1px solid var(--et-surface-28);
      border-radius: 4px;
      background: var(--et-surface-7);
      color: var(--et-surface-96);
    }
    .browser-setting-input {
      flex: 1 1 0;
      box-sizing: border-box;
    }
    .network-name-row input:focus,
    .browser-setting-input:focus {
      border-color: var(--et-surface-51);
      outline: none;
    }
    .network-name-row input:disabled,
    .browser-setting-input:disabled {
      opacity: 0.6;
    }
    .browser-setting-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .browser-setting-row .library-button {
      flex: 0 0 auto;
      white-space: nowrap;
    }
    .browser-rules {
      min-width: 0;
      border: 0;
      padding: 0;
      margin-inline: 0;
    }
    .browser-rules > .section-label {
      padding: 0;
    }
    .browser-rules > .power-mode-help {
      margin: 0 0 12px;
    }
    .browser-rules > .browser-setting-row {
      flex-wrap: wrap;
    }
    .browser-rule-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .browser-rule-row .browser-setting-input {
      min-width: 130px;
    }
    .browser-rule-row select {
      flex: 1 1 120px;
      min-width: 0;
      max-width: 100%;
    }
    .network-remote-control-status,
    .openhome-status {
      margin: 8px 0 0 26px;
      color: var(--et-surface-74);
      font-size: 12px;
      font-weight: bold;
      line-height: 1.4;
    }
    .openhome-status[data-state="published"] {
      color: var(--et-success);
    }
    .network-remote-control-status[data-state="error"],
    .openhome-status[data-state="error"],
    .openhome-status[data-state="unavailable"] {
      color: var(--et-danger);
    }
    .openhome-help {
      margin: 6px 0 0 26px;
      color: var(--et-surface-74);
      font-size: 12px;
      line-height: 1.45;
    }
    .library-sharing-options {
      display: grid;
      gap: 12px;
      margin: 6px 0 0 26px;
    }
    .library-sharing-options .power-mode-help {
      margin: 0;
    }
    .library-sharing-folders {
      display: grid;
      gap: 6px;
    }
    .library-sharing-folders label {
      overflow-wrap: anywhere;
    }
    .library-sharing-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .library-sharing-folders:empty,
    #library-sharing-status:empty {
      display: none;
    }
    .network-settings-section {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .network-settings-section .section-label {
      margin: 0;
      font-size: inherit;
    }
    .network-settings-section p,
    .network-settings-status {
      margin: 0;
      color: var(--et-surface-74);
      font-size: 12px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .network-setting-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
      align-items: center;
      gap: 10px;
      color: var(--et-surface-89);
      font-size: 13px;
    }
    .network-setting-row input {
      width: 100%;
    }
    .network-settings-section .checkbox-container {
      cursor: pointer;
    }
    .network-settings-section > .library-button {
      justify-self: start;
    }
    .network-settings-actions,
    .network-settings-file-row,
    .network-settings-entry {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .network-settings-file-row > span,
    .network-settings-entry > span {
      flex: 1 1 140px;
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--et-surface-74);
      font-size: 12px;
    }
    .network-settings-list {
      display: grid;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--et-surface-17);
    }
    .network-settings-section .library-button {
      max-width: 100%;
      white-space: normal;
    }
    .network-settings-list:empty,
    .network-settings-section p:empty,
    .network-settings-section [hidden],
    .network-settings-status:empty {
      display: none;
    }
    .power-advanced-settings {
      margin: 12px 0 0 26px;
      padding-top: 10px;
      border-top: 1px solid var(--et-surface-17);
    }
    .power-advanced-label {
      margin-bottom: 8px;
      color: var(--et-surface-89);
      font-size: 12px;
      font-weight: bold;
    }
    .power-setting-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 34px;
      color: var(--et-surface-89);
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
      color: var(--et-text-primary);
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
      color: var(--et-text-primary);
      cursor: pointer;
    }
    .config-select {
      margin-left: auto;
      padding: 4px 8px;
      background-color: var(--et-surface-13);
      color: var(--et-text-primary);
      border: 1px solid var(--et-surface-20);
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
      padding-top: 16px;
      border-top: 1px solid var(--et-surface-20);
    }
    .dialog-buttons button {
      padding: 8px 16px;
      margin-left: 10px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background-color: var(--et-accent);
      color: var(--et-on-accent);
    }
    .dialog-buttons button:hover {
      background-color: var(--et-accent-hover);
    }
    body.layout-mobile .config-dialog-content {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }
    body.layout-mobile .config-category-list {
      flex-direction: row;
      padding: 8px 0;
      border-right: 0;
      border-bottom: 1px solid var(--et-surface-20);
      overflow-x: auto;
      overflow-y: hidden;
    }
    body.layout-mobile .config-category-button {
      white-space: nowrap;
    }
    body.layout-mobile .config-category-panels {
      padding-left: 0;
    }
    @media (max-width: 700px) {
      .config-dialog {
        width: 400px;
      }
      .config-dialog-content {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
      }
      .config-category-list {
        flex-direction: row;
        padding: 8px 0;
        border-right: 0;
        border-bottom: 1px solid var(--et-surface-20);
        overflow-x: auto;
        overflow-y: hidden;
      }
      .config-category-button {
        white-space: nowrap;
      }
      .config-category-panels {
        padding-left: 0;
      }
      .power-mode-help,
      .power-saving-warning,
      .power-advanced-settings,
      .library-sharing-options,
      .network-remote-control-status,
      .openhome-status,
      .openhome-help {
        margin-left: 0;
      }
      .network-name-row {
        align-items: stretch;
        flex-direction: column;
        gap: 4px;
      }
      .network-setting-row {
        grid-template-columns: minmax(0, 1fr);
        gap: 4px;
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

  function renderThemeOptions() {
    replaceOptions(document.getElementById('theme-select'), THEME_PRESETS.map(preset => preset.id),
      normalizeThemeId(config.theme), id => getThemePreset(id).label);
  }

  function renderPipelineColumnOptions() {
    replaceOptions(document.getElementById('pipeline-column-mode'), ['manual', 'auto'],
      config.pipelineColumnMode, value => t(`dialog.config.pipelineColumns.${value}`));
  }

  function renderSpectrumOverlayOptions() {
    replaceOptions(document.getElementById('spectrum-overlay-quality'),
      ['normal', 'hq'], config.spectrumOverlayQuality,
      value => t(`dialog.config.spectrumOverlay.quality.${value}`));
    replaceOptions(document.getElementById('spectrum-overlay-display'),
      ['instant', 'peakHold'], config.spectrumOverlayPeakHold ? 'peakHold' : 'instant',
      value => t(`dialog.config.spectrumOverlay.display.${value}`));
  }

  function renderFrequencyPreviewOptions() {
    replaceOptions(document.getElementById('frequency-preview-sound'),
      ['sine', 'bandpassNoise'], config.frequencyPreviewSound,
      value => t(`dialog.config.frequencyPreview.${value}`));
  }

  function renderSfzSizeLimitOptions() {
    replaceOptions(document.getElementById('sfz-size-limit'), SFZ_SIZE_LIMIT_MIB_OPTIONS,
      normalizeSfzSizeLimitMiB(config.sfzMaxSizeMiB), value => `${value} MiB`);
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

    const skipDisplayDsp = document.getElementById('power-skip-display-dsp-when-hidden');
    if (skipDisplayDsp) skipDisplayDsp.checked = settings.skipDisplayDspWhenHidden;
  }

  function renderOfflineOutputControls() {
    offlineOutputSettings = normalizeOfflineOutputSettings(offlineOutputSettings);
    config.offlineOutput = { ...offlineOutputSettings };
    const definition = OFFLINE_OUTPUT_FORMATS[offlineOutputSettings.format];
    const formatSelect = document.getElementById('offline-output-format');
    const sampleRateSelect = document.getElementById('offline-output-sample-rate');
    const qualityRow = document.getElementById('offline-output-quality-row');
    const qualityLabel = document.getElementById('offline-output-quality-label');
    const qualitySelect = document.getElementById('offline-output-quality');

    replaceOptions(
      formatSelect,
      Object.keys(OFFLINE_OUTPUT_FORMATS),
      offlineOutputSettings.format,
      id => t(OFFLINE_OUTPUT_FORMATS[id].labelKey)
    );
    replaceOptions(
      sampleRateSelect,
      definition.sampleRates,
      offlineOutputSettings.sampleRate,
      rate => `${rate / 1000} kHz`
    );

    const hasQualitySelect = definition.qualityType !== null;
    qualityRow.hidden = !hasQualitySelect;
    qualitySelect.disabled = !hasQualitySelect;
    if (hasQualitySelect) {
      qualityLabel.textContent = t('dialog.config.offlineOutput.sampleFormat');
      replaceOptions(
        qualitySelect,
        definition.qualityOptions.map(option => option.id),
        offlineOutputSettings[definition.qualityType],
        id => t(definition.qualityOptions.find(option => option.id === id).labelKey)
      );
    }
  }

  let openHomeStatus = null;
  let openHomeStatusLoaded = false;
  let openHomeStatusReadFailed = false;
  let openHomeOperationFailed = false;
  let openHomeChangeInFlight = false;
  let upnpAvOperationFailed = false;
  let upnpAvChangeInFlight = false;
  let upnpAvRequestedEnabled = false;
  let airPlayStatus = null;
  let airPlayStatusLoaded = false;
  let airPlayStatusReadFailed = false;
  let airPlayOperationFailed = false;
  let airPlayChangeInFlight = false;
  let airPlayRequestedEnabled = false;
  let removeAirPlayStatusListener = null;
  let networkNameChangeInFlight = false;
  let openHomeRequestedEnabled = false;
  let removeOpenHomeStatusListener = null;
  let removeRemoteControlSettingsListener = null;
  const librarySharingControls = isElectron ? {
    enabled: document.getElementById('library-sharing-enabled'),
    folders: document.getElementById('library-sharing-folders'),
    empty: document.getElementById('library-sharing-empty'),
    save: document.getElementById('library-sharing-save'),
    status: document.getElementById('library-sharing-status')
  } : null;
  let librarySharing = null;
  let librarySharingSaving = false;
  let librarySharingStatusKey = 'loading';
  let librarySharingFolderInputs = [];

  function renderRemoteControlSettings() {
    const input = document.getElementById('network-remote-control-enabled');
    const statusElement = document.getElementById('network-remote-control-status');
    if (!input || !statusElement) return;
    const status = remoteControlSettings?.status;
    input.checked = status?.enabled === true;
    input.disabled = !status || remoteControlSettings.busy;
    const errorKey = remoteControlSettings?.errorKey || (status?.error ? 'startFailed' : null);
    statusElement.textContent = errorKey ? t(`dialog.remoteControl.${errorKey}`)
      : remoteControlSettings && !status ? t('dialog.remoteControl.loading') : '';
    statusElement.setAttribute('data-state', errorKey ? 'error' : '');
  }

  function markLibrarySharingUnsaved() {
    librarySharingStatusKey = 'unsaved';
    renderLibrarySharing();
    networkSettings?.updateLanguage();
  }

  function renderLibrarySharing() {
    if (!librarySharingControls) return;
    const { enabled, save, empty, status } = librarySharingControls;
    const disabled = !librarySharing || librarySharingSaving;
    enabled.disabled = disabled;
    save.disabled = disabled;
    for (const input of librarySharingFolderInputs) input.disabled = disabled;
    empty.hidden = !librarySharing || librarySharing.folders.length > 0;
    status.textContent = librarySharingStatusKey
      ? t(`dialog.config.librarySharing.${librarySharingStatusKey}`) : '';
  }

  function acceptLibrarySharing(state) {
    const sharing = state?.sharing;
    if (typeof sharing?.enabled !== 'boolean' || !Array.isArray(sharing.folderIds) ||
        !Array.isArray(sharing.folders)) throw new Error('Invalid library sharing state');
    librarySharing = sharing;
    librarySharingControls.enabled.checked = sharing.enabled;
    const folders = librarySharingControls.folders;
    while (folders.children.length) folders.removeChild(folders.children[0]);
    librarySharingFolderInputs = sharing.folders.map((folder, index) => {
      const row = document.createElement('div');
      row.className = 'checkbox-container';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `library-sharing-folder-${index}`;
      input.value = folder.id;
      input.checked = sharing.folderIds.includes(folder.id);
      input.addEventListener('change', markLibrarySharingUnsaved);
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = folder.name;
      row.appendChild(input);
      row.appendChild(label);
      folders.appendChild(row);
      return input;
    });
  }

  async function refreshLibrarySharing() {
    if (!isElectron) return;
    try {
      acceptLibrarySharing(await networkMusicAPI.networkMusicGetState({ loadSharingFolders: true }));
      librarySharingStatusKey = '';
    } catch (error) {
      console.error('Failed to read library sharing settings:', error);
      librarySharing = null;
      librarySharingStatusKey = 'loadFailed';
    }
    renderLibrarySharing();
  }

  async function saveLibrarySharing() {
    if (!librarySharing || librarySharingSaving) return;
    const request = {
      enabled: librarySharingControls.enabled.checked,
      folderIds: librarySharingFolderInputs.filter(input => input.checked).map(input => input.value)
    };
    librarySharingSaving = true;
    librarySharingStatusKey = 'saving';
    renderLibrarySharing();
    try {
      acceptLibrarySharing(await networkMusicAPI.networkMusicSetSharing(request));
      librarySharingStatusKey = 'saved';
    } catch (error) {
      console.error('Failed to save library sharing settings:', error);
      await refreshLibrarySharing();
      if (librarySharing) librarySharingStatusKey = 'saveFailed';
    } finally {
      librarySharingSaving = false;
      renderLibrarySharing();
    }
  }

  function publishOpenHomeEnabled(enabled) {
    const publishedConfig = window.appConfig || config;
    const publishedEnabled = publishedConfig.openHomeRemoteControl === true;
    config.openHomeRemoteControl = enabled;
    window.uiManager?.setOpenHomeRemoteControlEnabled?.(enabled);
    if (publishedEnabled === enabled) return;
    publishElectronConfigSnapshot({
      ...publishedConfig,
      openHomeRemoteControl: enabled
    });
  }

  function publishNetworkDeviceName(friendlyName) {
    if (typeof friendlyName !== 'string' || !friendlyName) return;
    config.openHomeFriendlyName = friendlyName;
    publishElectronConfigSnapshot({
      ...(window.appConfig || config),
      openHomeFriendlyName: friendlyName
    });
  }

  function acceptOpenHomeStatus(status) {
    if (!status || typeof status !== 'object' || typeof status.enabled !== 'boolean') {
      return false;
    }
    openHomeStatus = { ...status };
    openHomeStatusLoaded = true;
    openHomeStatusReadFailed = false;
    publishOpenHomeEnabled(status.enabled);
    const upnpAvEnabled = status.upnpAvEnabled === true;
    if ((config.upnpAvRemoteControl === true) !== upnpAvEnabled) {
      config.upnpAvRemoteControl = upnpAvEnabled;
      publishElectronConfigSnapshot({ ...(window.appConfig || config), upnpAvRemoteControl: upnpAvEnabled });
    }
    window.uiManager?.setUpnpAvRemoteControlEnabled?.(upnpAvEnabled);
    if (typeof status.friendlyName === 'string' && status.friendlyName) {
      config.openHomeFriendlyName = status.friendlyName;
    }
    return true;
  }

  function getNetworkPlayerStatusPresentation(upnpAv = false) {
    const enabled = upnpAv ? openHomeStatus?.upnpAvEnabled : openHomeStatus?.enabled;
    const changing = upnpAv ? upnpAvChangeInFlight : openHomeChangeInFlight;
    const requested = upnpAv ? upnpAvRequestedEnabled : openHomeRequestedEnabled;
    const operationFailed = upnpAv ? upnpAvOperationFailed : openHomeOperationFailed;
    if (!openHomeAPI) {
      return { key: 'unavailable', state: 'unavailable' };
    }
    if (!openHomeStatusLoaded) {
      return { key: 'loading', state: 'pending' };
    }
    if (operationFailed) {
      return { key: 'updateFailed', state: 'error' };
    }
    if (openHomeStatusReadFailed || enabled && openHomeStatus?.state === 'failed') {
      return { key: 'error', state: 'error' };
    }
    if (openHomeStatus?.available === false || openHomeStatus?.state === 'unavailable') {
      return { key: 'unavailable', state: 'unavailable' };
    }
    if (changing) {
      return {
        key: requested ? 'enabling' : 'disabling',
        state: 'pending'
      };
    }
    if (openHomeStatus?.state === 'stopping') {
      return { key: 'stopping', state: 'pending' };
    }
    if (!enabled) {
      return { key: 'stopped', state: 'stopped' };
    }
    if (!openHomeStatus.rendererReady) {
      return { key: 'waiting', state: 'pending' };
    }
    if (openHomeStatus.state === 'ready') {
      return { key: 'published', state: 'published' };
    }
    return { key: 'starting', state: 'pending' };
  }

  function renderNetworkStatus(updateDeviceName = false) {
    const input = document.getElementById('openhome-enabled');
    const nameInput = document.getElementById('network-device-name');
    const statusElement = document.getElementById('openhome-status');
    if (!input || !nameInput || !statusElement) return;
    input.checked = openHomeChangeInFlight
      ? openHomeRequestedEnabled
      : Boolean(openHomeStatus?.enabled);
    input.disabled = !openHomeAPI || openHomeChangeInFlight || !openHomeStatusLoaded ||
      (openHomeStatus?.available === false && openHomeStatus?.enabled !== true);
    if (!networkNameChangeInFlight && (updateDeviceName || document.activeElement !== nameInput)) {
      nameInput.value = openHomeStatus?.friendlyName || config.openHomeFriendlyName || '';
    }
    nameInput.disabled = typeof openHomeAPI?.setFriendlyName !== 'function' ||
      networkNameChangeInFlight || !openHomeStatusLoaded;
    const presentation = getNetworkPlayerStatusPresentation();
    statusElement.textContent = t(`dialog.config.openHome.status.${presentation.key}`);
    statusElement.setAttribute('data-state', presentation.state);
    const upnpAvInput = document.getElementById('upnp-av-enabled');
    const upnpAvStatus = document.getElementById('upnp-av-status');
    if (upnpAvInput && upnpAvStatus) {
      upnpAvInput.checked = upnpAvChangeInFlight ? upnpAvRequestedEnabled : Boolean(openHomeStatus?.upnpAvEnabled);
      upnpAvInput.disabled = typeof openHomeAPI?.setUpnpAvEnabled !== 'function' || upnpAvChangeInFlight || !openHomeStatusLoaded ||
        (openHomeStatus?.available === false && openHomeStatus?.upnpAvEnabled !== true);
      const upnpPresentation = getNetworkPlayerStatusPresentation(true);
      const namespace = ['published', 'error'].includes(upnpPresentation.key) ? 'upnpAv' : 'openHome';
      upnpAvStatus.textContent = t(`dialog.config.${namespace}.status.${upnpPresentation.key}`);
      upnpAvStatus.setAttribute('data-state', upnpPresentation.state);
    }
  }

  function acceptAirPlayStatus(status) {
    if (!status || typeof status.enabled !== 'boolean' ||
        !['off', 'unavailable', 'starting', 'ready', 'receiving', 'failed'].includes(status.state)) return false;
    airPlayStatus = { ...status };
    airPlayStatusLoaded = true;
    airPlayStatusReadFailed = false;
    if ((config.airPlayReceiver === true) !== status.enabled) {
      config.airPlayReceiver = status.enabled;
      publishElectronConfigSnapshot({ ...(window.appConfig || config), airPlayReceiver: status.enabled });
    }
    window.uiManager?.setAirPlayReceiverEnabled?.(status.enabled);
    return true;
  }

  function renderAirPlayStatus() {
    const input = document.getElementById('airplay-enabled');
    const element = document.getElementById('airplay-status');
    if (!input || !element) return;
    input.checked = airPlayChangeInFlight ? airPlayRequestedEnabled : airPlayStatus?.enabled === true;
    input.disabled = !airPlayAPI || airPlayChangeInFlight || !airPlayStatusLoaded ||
      (airPlayStatus?.available === false && airPlayStatus?.enabled !== true);
    const key = !airPlayAPI ? 'unavailable' : !airPlayStatusLoaded ? 'loading' : airPlayOperationFailed ? 'updateFailed'
      : airPlayStatusReadFailed ? 'failed'
      : airPlayChangeInFlight ? (airPlayRequestedEnabled ? 'starting' : 'disabling')
        : airPlayStatus?.available === false ? 'unavailable' : airPlayStatus?.state || 'failed';
    element.textContent = t(`dialog.config.${key === 'disabling' ? 'openHome' : 'airPlay'}.status.${key}`);
    element.setAttribute('data-state', ['ready', 'receiving'].includes(key) ? 'published'
      : ['unavailable', 'failed', 'updateFailed'].includes(key) ? 'error' : key === 'off' ? 'stopped' : 'pending');
  }

  async function refreshAirPlayStatus() {
    if (!airPlayAPI) {
      airPlayStatusLoaded = true;
      renderAirPlayStatus();
      return;
    }
    try {
      if (!acceptAirPlayStatus(await airPlayAPI.getStatus())) throw new Error('Invalid AirPlay status response');
    } catch (error) {
      console.error('Failed to read AirPlay receiver status:', error);
      airPlayStatusLoaded = true;
      airPlayStatusReadFailed = true;
    }
    renderAirPlayStatus();
  }

  async function applyAirPlayEnabled(enabled) {
    if (airPlayChangeInFlight || !airPlayAPI) return;
    airPlayChangeInFlight = true;
    airPlayRequestedEnabled = enabled;
    airPlayOperationFailed = false;
    renderAirPlayStatus();
    try {
      if (!acceptAirPlayStatus(await airPlayAPI.setEnabled(enabled))) throw new Error('Invalid AirPlay status response');
    } catch (error) {
      console.error('Failed to update AirPlay reception:', error);
      await refreshAirPlayStatus();
      airPlayOperationFailed = true;
    } finally {
      airPlayChangeInFlight = false;
      renderAirPlayStatus();
    }
  }

  async function refreshOpenHomeStatus() {
    if (!openHomeAPI || typeof openHomeAPI.getStatus !== 'function') {
      openHomeStatusLoaded = true;
      renderNetworkStatus();
      return false;
    }
    try {
      const status = await openHomeAPI.getStatus();
      if (!acceptOpenHomeStatus(status)) throw new Error('Invalid OpenHome status response');
      renderNetworkStatus();
      return true;
    } catch (error) {
      openHomeStatusLoaded = true;
      openHomeStatusReadFailed = true;
      console.error('Failed to read OpenHome remote control status:', error);
      renderNetworkStatus();
      return false;
    }
  }

  async function applyOpenHomeEnabled(enabled) {
    if (openHomeChangeInFlight || typeof openHomeAPI?.setEnabled !== 'function') return;
    openHomeChangeInFlight = true;
    openHomeRequestedEnabled = enabled;
    openHomeOperationFailed = false;
    renderNetworkStatus();
    try {
      const status = await openHomeAPI.setEnabled(enabled);
      if (!acceptOpenHomeStatus(status)) throw new Error('Invalid OpenHome status response');
    } catch (error) {
      console.error('Failed to update OpenHome remote control:', error);
      await refreshOpenHomeStatus();
      openHomeOperationFailed = true;
    } finally {
      openHomeChangeInFlight = false;
      renderNetworkStatus();
    }
  }

  async function applyUpnpAvEnabled(enabled) {
    if (upnpAvChangeInFlight || typeof openHomeAPI?.setUpnpAvEnabled !== 'function') return;
    upnpAvChangeInFlight = true;
    upnpAvRequestedEnabled = enabled;
    upnpAvOperationFailed = false;
    renderNetworkStatus();
    try {
      if (!acceptOpenHomeStatus(await openHomeAPI.setUpnpAvEnabled(enabled))) throw new Error('Invalid network player status response');
    } catch (error) {
      console.error('Failed to update UPnP AV reception:', error);
      await refreshOpenHomeStatus();
      upnpAvOperationFailed = true;
    } finally {
      upnpAvChangeInFlight = false;
      renderNetworkStatus();
    }
  }

  async function applyNetworkDeviceName(friendlyName) {
    if (networkNameChangeInFlight || typeof openHomeAPI?.setFriendlyName !== 'function') return;
    networkNameChangeInFlight = true;
    renderNetworkStatus();
    try {
      const status = await openHomeAPI.setFriendlyName(friendlyName);
      if (!acceptOpenHomeStatus(status)) throw new Error('Invalid OpenHome status response');
      publishNetworkDeviceName(status.friendlyName);
    } catch (error) {
      console.error('Failed to update the network device name:', error);
      await refreshOpenHomeStatus();
      window.uiManager?.setError?.(t('dialog.config.network.deviceNameSaveFailed'), true);
    } finally {
      networkNameChangeInFlight = false;
      renderNetworkStatus(true);
    }
  }

  function selectCategory(category) {
    selectedConfigCategory = category;
    for (const candidate of categories) {
      const selected = candidate === category;
      const button = document.getElementById(`config-category-${candidate}`);
      button.setAttribute('aria-current', String(selected));
      if (selected) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      document.getElementById(`config-panel-${candidate}`).hidden = !selected;
    }
    const panels = document.getElementById('config-category-panels');
    if (panels) panels.scrollTop = 0;
  }

  function renderDialogTexts() {
    document.getElementById('config-title').textContent = t('dialog.config.title');
    for (const category of categories) {
      document.getElementById(`config-category-${category}`).textContent =
        t(CONFIG_CATEGORY_LABEL_KEYS[category]);
    }
    const autoLaunchLabel = document.getElementById('config-auto-launch-label');
    if (autoLaunchLabel) autoLaunchLabel.textContent = t('dialog.config.autoLaunch');
    for (const [id, key] of [
      ['network-remote-control-title', 'dialog.remoteControl.title'],
      ['network-remote-control-enabled-label', 'dialog.remoteControl.enabled'],
      ['store-startup-help', 'dialog.store.startupHelp'],
      ['store-startup', 'dialog.store.openStartup'],
      ['store-updates-help', 'dialog.store.updatesHelp'],
      ['store-updates', 'dialog.store.openUpdates']
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = t(key);
    }
    const startMinLabel = document.getElementById('config-start-min-label');
    if (startMinLabel) startMinLabel.textContent = t('dialog.config.startMinimized');
    const trayLabel = document.getElementById('config-tray-label');
    if (trayLabel) trayLabel.textContent = t('dialog.config.minimizeToTray');
    const checkUpdatesLabel = document.getElementById('config-check-updates-label');
    if (checkUpdatesLabel) checkUpdatesLabel.textContent = t('dialog.config.checkForUpdatesOnStartup');
    const hardwareAccelerationLabel = document.getElementById('hardware-acceleration-label');
    if (hardwareAccelerationLabel) hardwareAccelerationLabel.textContent = t('dialog.config.hardwareAcceleration');
    const hardwareAccelerationHelp = document.getElementById('hardware-acceleration-help');
    if (hardwareAccelerationHelp) hardwareAccelerationHelp.textContent = t('dialog.config.hardwareAccelerationHelp');
    for (const key of ['title', 'help', 'add', 'save', 'cancel']) {
      const element = document.getElementById(`browser-rules-${key}`);
      if (element) element.textContent = t(`dialog.config.browser.rules.${key}`);
    }
    for (const [element, key, attribute] of browserRuleLabels) {
      if (attribute) element.setAttribute(attribute, t(`dialog.config.browser.rules.${key}`));
      else element.textContent = t(`dialog.config.browser.rules.${key}`);
    }
    const browserUserAgentLabel = document.getElementById('browser-user-agent-label');
    if (browserUserAgentLabel) browserUserAgentLabel.textContent = t('dialog.config.browser.userAgent');
    const browserUserAgentHelp = document.getElementById('browser-user-agent-help');
    if (browserUserAgentHelp) browserUserAgentHelp.textContent = t('dialog.config.browser.userAgentHelp');
    const browserOpenTabsLabel = document.getElementById('browser-open-tabs-externally-label');
    if (browserOpenTabsLabel) browserOpenTabsLabel.textContent = t('dialog.config.browser.openTabsExternally');
    const browserStartPageLabel = document.getElementById('browser-start-page-label');
    if (browserStartPageLabel) browserStartPageLabel.textContent = t('dialog.config.browser.startPage');
    const browserStartPageHelp = document.getElementById('browser-start-page-help');
    if (browserStartPageHelp) browserStartPageHelp.textContent = t('dialog.config.browser.startPageHelp');
    const browserResetStartPageLabel = document.getElementById('browser-reset-start-page');
    if (browserResetStartPageLabel) browserResetStartPageLabel.textContent = t('dialog.config.browser.reset');
    const browserResetUserAgentLabel = document.getElementById('browser-reset-user-agent');
    if (browserResetUserAgentLabel) browserResetUserAgentLabel.textContent = t('dialog.config.browser.reset');
    const openHomeTitle = document.getElementById('openhome-title');
    if (openHomeTitle) openHomeTitle.textContent = t('dialog.config.openHome.title');
    const openHomeEnabledLabel = document.getElementById('openhome-enabled-label');
    if (openHomeEnabledLabel) openHomeEnabledLabel.textContent = t('dialog.config.openHome.enable');
    const networkDeviceNameLabel = document.getElementById('network-device-name-label');
    if (networkDeviceNameLabel) {
      networkDeviceNameLabel.textContent = t('dialog.config.network.deviceName');
      networkDeviceNameLabel.title = t('dialog.config.network.deviceNameHelp');
    }
    const networkDeviceName = document.getElementById('network-device-name');
    if (networkDeviceName) {
      networkDeviceName.title = t('dialog.config.network.deviceNameHelp');
    }
    const openHomeRisk = document.getElementById('openhome-risk');
    if (openHomeRisk) openHomeRisk.textContent = t('dialog.config.openHome.risk');
    for (const [id, key] of [
      ['upnp-av-title', 'upnpAv.title'], ['upnp-av-enabled-label', 'upnpAv.enable'], ['upnp-av-risk', 'upnpAv.risk'],
      ['airplay-title', 'airPlay.title'], ['airplay-enabled-label', 'airPlay.enable'], ['airplay-help', 'airPlay.help']
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = t(`dialog.config.${key}`);
    }
    for (const [id, key] of [
      ['library-sharing-title', 'networkMusic.sharing'],
      ['library-sharing-enabled-label', 'networkMusic.shareEnabled'],
      ['library-sharing-help', 'networkMusic.shareNotice'],
      ['library-sharing-empty', 'dialog.config.librarySharing.empty'],
      ['library-sharing-save', 'networkMusic.save']
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = t(key);
    }
    document.getElementById('config-language-label').textContent = t('dialog.config.language');
    document.getElementById('library-include-video-label').textContent = t('dialog.config.libraryIncludeVideo');
    document.getElementById('library-include-video-help').textContent = t('dialog.config.libraryIncludeVideoHelp');
    document.getElementById('video-auto-rotate-label').textContent = t('dialog.config.videoAutoRotate');
    document.getElementById('video-auto-rotate-help').textContent = t('dialog.config.videoAutoRotateHelp');
    document.getElementById('visualizer-hdr-label').textContent = t('dialog.config.visualizerHdr');
    document.getElementById('visualizer-hdr-help').textContent = t('dialog.config.visualizerHdrHelp');
    document.getElementById('config-theme-label').textContent = t('dialog.config.theme');
    document.getElementById('pipeline-column-mode-label').textContent = t('dialog.config.pipelineColumns');
    document.getElementById('pipeline-column-mode-help').textContent = t('dialog.config.pipelineColumns.help');
    renderPipelineColumnOptions();
    document.getElementById('frequency-preview-sound-label').textContent = t('dialog.config.frequencyPreview.sound');
    renderFrequencyPreviewOptions();
    document.getElementById('sfz-size-limit-label').textContent = t('dialog.config.sfzSizeLimit');
    document.getElementById('sfz-size-limit-help').textContent = t('dialog.config.sfzSizeLimitHelp');
    renderSfzSizeLimitOptions();
    document.getElementById('visual-sync-label').textContent = t('dialog.config.visualSync.label');
    document.getElementById('visual-sync-help').textContent = t('dialog.config.visualSync.help');
    renderThemeOptions();
    document.getElementById('spectrum-overlay-title').textContent = t('dialog.config.spectrumOverlay.title');
    document.getElementById('spectrum-overlay-quality-label').textContent = t('dialog.config.spectrumOverlay.quality');
    document.getElementById('spectrum-overlay-display-label').textContent = t('dialog.config.spectrumOverlay.display');
    renderSpectrumOverlayOptions();
    document.getElementById('config-startup-view-label').textContent = t('dialog.config.startupView');
    document.getElementById('config-startup-view-effects-label').textContent = t('dialog.config.startupView.effects');
    document.getElementById('config-startup-view-library-label').textContent = t('dialog.config.startupView.library');
    document.getElementById('config-startup-view-visualizer-label').textContent = t('dialog.config.startupView.visualizer');
    document.getElementById('config-visualizer-startup-expanded-label').textContent = t('dialog.config.visualizerStartupExpanded');
    const browserStartupLabel = document.getElementById('config-startup-view-browser-label');
    if (browserStartupLabel) browserStartupLabel.textContent = t('dialog.config.startupView.browser');
    document.getElementById('config-pipeline-label').textContent = t('dialog.config.pipeline');
    document.getElementById('config-pipeline-default-label').textContent = t('dialog.config.pipeline.default');
    document.getElementById('config-pipeline-last-label').textContent = t('dialog.config.pipeline.last');
    document.getElementById('config-pipeline-preset-label').textContent = t('dialog.config.pipeline.preset');
    const physicalControlTitle = document.getElementById('physical-control-title');
    if (physicalControlTitle) physicalControlTitle.textContent = t('dialog.config.physicalControl');
    document.getElementById('offline-output-title').textContent = t('dialog.config.offlineOutput.title');
    document.getElementById('offline-output-format-label').textContent = t('dialog.config.offlineOutput.format');
    document.getElementById('offline-output-sample-rate-label').textContent = t('dialog.config.offlineOutput.sampleRate');
    document.getElementById('offline-output-help').textContent = t('dialog.config.offlineOutput.channelHelp');
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
    const skipDisplayDspLabel = document.getElementById('power-skip-display-dsp-when-hidden-label');
    if (skipDisplayDspLabel) {
      skipDisplayDspLabel.textContent = t('dialog.config.powerSaving.skipDisplayDspWhenHidden');
    }
    const skipDisplayDspHelp = document.getElementById('power-skip-display-dsp-when-hidden-help');
    if (skipDisplayDspHelp) {
      skipDisplayDspHelp.textContent = t('dialog.config.powerSaving.skipDisplayDspWhenHiddenHelp');
    }
    document.getElementById('controller-mapping-btn').textContent = t('midi.openSettings');
    document.getElementById('close-btn').textContent = t('dialog.config.close');
    renderLanguageOptions();
    renderLibraryStartupViewOptions();
    renderPresetOptions();
    renderPowerSettingOptions();
    syncPowerSettingControls();
    renderOfflineOutputControls();
    renderNetworkStatus();
    renderAirPlayStatus();
    renderRemoteControlSettings();
    renderLibrarySharing();
  }

  function publishElectronConfig(nextConfig) {
    const publishedConfig = {
      ...nextConfig,
      powerSaving: { ...normalizePowerSettings(nextConfig.powerSaving) },
      offlineOutput: normalizeOfflineOutputSettings(nextConfig.offlineOutput)
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
    const hardwareAcceleration = document.getElementById('hardware-acceleration');
    if (hardwareAcceleration) hardwareAcceleration.checked = config.hardwareAcceleration !== false;
    const visualSync = document.getElementById('visual-sync');
    if (visualSync) visualSync.checked = isVisualSyncEnabled(config);
    const libraryIncludeVideo = document.getElementById('library-include-video');
    if (libraryIncludeVideo) libraryIncludeVideo.checked = config.libraryIncludeVideo === true;
    const videoAutoRotate = document.getElementById('video-auto-rotate');
    if (videoAutoRotate) videoAutoRotate.checked = config.videoAutoRotate !== false;
    const visualizerHdrInput = document.getElementById('visualizer-hdr');
    if (visualizerHdrInput) visualizerHdrInput.checked = visualizerHdr;

    const startupView = startupViews.includes(config.startupView) ? config.startupView : 'effects';
    const startupEffects = document.getElementById('startup-view-effects');
    const startupLibrary = document.getElementById('startup-view-library');
    if (startupEffects) startupEffects.checked = startupView === 'effects';
    if (startupLibrary) startupLibrary.checked = startupView === 'library';
    const startupVisualizer = document.getElementById('startup-view-visualizer');
    if (startupVisualizer) startupVisualizer.checked = startupView === 'visualizer';
    const visualizerStartupExpanded = document.getElementById('visualizer-startup-expanded');
    if (visualizerStartupExpanded) {
      visualizerStartupExpanded.checked = config.visualizerStartupExpanded === true;
      visualizerStartupExpanded.disabled = startupView !== 'visualizer';
    }
    const startupBrowser = document.getElementById('startup-view-browser');
    if (startupBrowser) startupBrowser.checked = startupView === 'browser';
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
    renderThemeOptions();
    renderOfflineOutputControls();
    renderPipelineColumnOptions();
    renderSpectrumOverlayOptions();
    renderFrequencyPreviewOptions();
    renderSfzSizeLimitOptions();
  }

  let configSaveSequence = 0;
  let visualSyncUpdateSequence = 0;
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

  async function applyOfflineOutputSettings(partialOfflineOutput) {
    const previous = offlineOutputSettings;
    offlineOutputSettings = normalizeOfflineOutputSettings({
      ...offlineOutputSettings,
      ...partialOfflineOutput
    });
    config.offlineOutput = { ...offlineOutputSettings };
    renderOfflineOutputControls();
    if (await save({ offlineOutput: { ...offlineOutputSettings } })) {
      offlineOutputSettings = normalizeOfflineOutputSettings(
        window.appConfig?.offlineOutput || offlineOutputSettings
      );
      renderOfflineOutputControls();
      return true;
    }
    offlineOutputSettings = previous;
    config.offlineOutput = { ...previous };
    renderOfflineOutputControls();
    return false;
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
  selectCategory(selectedConfigCategory);
  for (const category of categories) {
    document.getElementById(`config-category-${category}`)
      .addEventListener('click', () => selectCategory(category));
  }

  for (const [id, uri] of [
    ['store-startup', 'ms-settings:startupapps'],
    ['store-updates', 'ms-windows-store://downloadsandupdates']
  ]) {
    document.getElementById(id)?.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.openExternalUrl(uri);
        if (result?.success !== true) throw new Error('Windows action failed');
      } catch (error) {
        console.error('Could not open Windows settings or Microsoft Store:', error);
        window.uiManager?.setError?.(t('dialog.store.openFailed'), true);
      }
    });
  }
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
  const hardwareAcceleration = document.getElementById('hardware-acceleration');
  if (hardwareAcceleration) {
    hardwareAcceleration.addEventListener('change', async e => {
      await save({ hardwareAcceleration: e.target.checked });
    });
  }
  document.getElementById('visual-sync')?.addEventListener('change', async e => {
    const enabled = e.target.checked;
    const updateSequence = ++visualSyncUpdateSequence;
    if (!await save({ visualSync: enabled })) return;
    if (updateSequence !== visualSyncUpdateSequence) return;
    await window.audioManager?.setVisualSyncEnabled?.(enabled);
  });
  document.getElementById('library-include-video').addEventListener('change', async e => {
    await save({ libraryIncludeVideo: e.target.checked });
  });
  document.getElementById('video-auto-rotate').addEventListener('change', async e => {
    if (!await save({ videoAutoRotate: e.target.checked })) return;
    window.uiManager?.audioPlayer?.ui?.refreshVideoRotation?.();
  });
  document.getElementById('visualizer-hdr').addEventListener('change', e => {
    const enabled = e.target.checked;
    try {
      window.localStorage.setItem('effetune_visualizer_hdr', String(enabled));
    } catch (error) {
      console.error('Failed to save Visualizer HDR setting:', error);
      e.target.checked = visualizerHdr;
      window.uiManager?.setError?.('Failed to save settings.', true);
      return;
    }
    visualizerHdr = enabled;
    window.uiManager?.visualizerView?.setHdrEnabled(enabled);
  });
  document.getElementById('frequency-preview-sound').addEventListener('change', async e => {
    const frequencyPreviewSound = e.target.value === 'bandpassNoise' ? 'bandpassNoise' : 'sine';
    await save({ frequencyPreviewSound });
  });
  document.getElementById('sfz-size-limit').addEventListener('change', async e => {
    await save({ sfzMaxSizeMiB: normalizeSfzSizeLimitMiB(Number(e.target.value)) });
  });
  document.getElementById('spectrum-overlay-quality')?.addEventListener('change', async e => {
    const quality = e.target.value === 'hq' ? 'hq' : 'normal';
    if (!await save({ spectrumOverlayQuality: quality })) return;
    window.SpectrumOverlay?.setSettings?.({ quality, peakHold: config.spectrumOverlayPeakHold });
  });
  document.getElementById('spectrum-overlay-display')?.addEventListener('change', async e => {
    const peakHold = e.target.value === 'peakHold';
    if (!await save({ spectrumOverlayPeakHold: peakHold })) return;
    window.SpectrumOverlay?.setSettings?.({ quality: config.spectrumOverlayQuality, peakHold });
  });
  const openHomeEnabled = document.getElementById('openhome-enabled');
  openHomeEnabled?.addEventListener('change', async e => {
    await applyOpenHomeEnabled(e.target.checked);
  });
  document.getElementById('upnp-av-enabled')?.addEventListener('change', e => applyUpnpAvEnabled(e.target.checked));
  document.getElementById('airplay-enabled')?.addEventListener('change', e => applyAirPlayEnabled(e.target.checked));
  const networkDeviceName = document.getElementById('network-device-name');
  networkDeviceName?.addEventListener('change', async e => {
    await applyNetworkDeviceName(e.target.value);
  });
  document.getElementById('network-remote-control-enabled')?.addEventListener('change', e =>
    remoteControlSettings?.setEnabled(e.target.checked));
  const browserUserAgent = document.getElementById('browser-user-agent');
  const browserOpenTabs = document.getElementById('browser-open-tabs-externally');
  const browserStartPage = document.getElementById('browser-start-page');
  const browserResetStartPage = document.getElementById('browser-reset-start-page');
  const browserResetUserAgent = document.getElementById('browser-reset-user-agent');
  const browserControls = [browserUserAgent, browserOpenTabs, browserStartPage, browserResetStartPage, browserResetUserAgent, document.getElementById('browser-rules-controls')].filter(Boolean);
  function syncBrowserControls() {
    if (!browserUserAgent) return;
    browserUserAgent.value = config.browser?.userAgent || defaultBrowserUserAgent;
    browserOpenTabs.checked = config.browser?.openTabsExternally !== false;
    browserStartPage.value = config.browser?.startPage || '';
    for (const control of browserControls) control.disabled = !window.electronAPI?.browser;
  }
  async function saveBrowserSettings(patch) {
    for (const control of browserControls) control.disabled = true;
    try {
      const result = await window.electronAPI.browser.saveSettings(patch);
      if (result?.error === 'invalidRules') {
        window.uiManager?.setError?.(t('dialog.config.browser.rules.invalid'), true);
        return false;
      }
      if (result?.error === 'invalidURL') {
        window.uiManager?.setError?.(t('dialog.config.browser.invalidStartPage'), true);
        return;
      }
      if (!result?.ok) throw new Error('Browser settings save failed');
      config.browser = result.settings;
      publishElectronConfig({ ...(window.appConfig || config), browser: result.settings });
      return true;
    } catch (error) {
      console.error('Failed to save Browser settings:', error);
      window.uiManager?.setError?.(t('dialog.config.browser.saveFailed'), true);
      return false;
    } finally {
      syncBrowserControls();
    }
  }
  syncBrowserControls();
  browserUserAgent?.addEventListener('change', () => saveBrowserSettings({
    userAgent: browserUserAgent.value.trim() === defaultBrowserUserAgent ? '' : browserUserAgent.value
  }));
  browserResetUserAgent?.addEventListener('click', () => saveBrowserSettings({ userAgent: '' }));
  browserOpenTabs?.addEventListener('change', () => saveBrowserSettings({ openTabsExternally: browserOpenTabs.checked }));
  browserStartPage?.addEventListener('change', () => saveBrowserSettings({ startPage: browserStartPage.value }));
  browserResetStartPage?.addEventListener('click', () => saveBrowserSettings({ startPage: '' }));
  function labelBrowserRule(element, key, attribute) {
    browserRuleLabels.push([element, key, attribute]);
    if (attribute) element.setAttribute(attribute, t(`dialog.config.browser.rules.${key}`));
    else element.textContent = t(`dialog.config.browser.rules.${key}`);
  }
  function renderBrowserRules() {
    const list = document.getElementById('browser-rules-list');
    if (!list) return;
    list.innerHTML = '';
    browserRuleLabels.length = 0;
    for (const [index, rule] of browserRulesDraft.entries()) {
      const row = document.createElement('div');
      row.className = 'browser-rule-row';
      const enabledLabel = document.createElement('label');
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = rule.enabled;
      enabled.addEventListener('change', () => { rule.enabled = enabled.checked; });
      enabledLabel.appendChild(enabled);
      const enabledText = document.createElement('span');
      labelBrowserRule(enabledText, 'enabled');
      enabledLabel.appendChild(enabledText);
      row.appendChild(enabledLabel);
      const pattern = document.createElement('input');
      pattern.type = 'text';
      pattern.className = 'browser-setting-input';
      pattern.value = rule.pattern;
      pattern.placeholder = 'example.com/*';
      pattern.spellcheck = false;
      labelBrowserRule(pattern, 'pattern', 'aria-label');
      pattern.addEventListener('input', () => { rule.pattern = pattern.value; });
      row.appendChild(pattern);
      const preset = document.createElement('select');
      labelBrowserRule(preset, 'preset', 'aria-label');
      for (const name of new Set([rule.preset, ...presetNames])) {
        const option = document.createElement('option');
        option.value = name;
        if (!name) labelBrowserRule(option, 'choosePreset');
        else option.textContent = name;
        preset.appendChild(option);
      }
      preset.value = rule.preset;
      preset.addEventListener('change', () => { rule.preset = preset.value; });
      row.appendChild(preset);
      for (const [key, offset] of [['up', -1], ['down', 1], ['delete', 0]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'library-button';
        labelBrowserRule(button, key);
        button.disabled = offset !== 0 && (index + offset < 0 || index + offset >= browserRulesDraft.length);
        button.addEventListener('click', () => {
          if (!offset) browserRulesDraft.splice(index, 1);
          else [browserRulesDraft[index], browserRulesDraft[index + offset]] = [browserRulesDraft[index + offset], rule];
          renderBrowserRules();
        });
        row.appendChild(button);
      }
      list.appendChild(row);
    }
    enableStandardSelects(list);
  }
  document.getElementById('browser-rules-add')?.addEventListener('click', () => {
    browserRulesDraft.push({ pattern: '', preset: presetNames[0] || '', enabled: true });
    renderBrowserRules();
  });
  document.getElementById('browser-rules-save')?.addEventListener('click', async () => {
    let urlRules;
    try { urlRules = validateRules(browserRulesDraft); }
    catch {
      window.uiManager?.setError?.(t('dialog.config.browser.rules.invalid'), true);
      return;
    }
    if (await saveBrowserSettings({ urlRules })) {
      browserRulesDraft = structuredClone(config.browser.urlRules);
      renderBrowserRules();
    }
  });
  document.getElementById('browser-rules-cancel')?.addEventListener('click', () => {
    browserRulesDraft = structuredClone(config.browser?.urlRules || []);
    renderBrowserRules();
  });
  renderBrowserRules();
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
  document.getElementById('power-skip-display-dsp-when-hidden')?.addEventListener(
    'change',
    async e => {
      await applyPowerSettings({ skipDisplayDspWhenHidden: e.target.checked });
    }
  );
  document.getElementById('offline-output-format')?.addEventListener('change', async e => {
    await applyOfflineOutputSettings({ format: e.target.value });
  });
  document.getElementById('offline-output-sample-rate')?.addEventListener('change', async e => {
    await applyOfflineOutputSettings({ sampleRate: Number(e.target.value) });
  });
  document.getElementById('offline-output-quality')?.addEventListener('change', async e => {
    const definition = OFFLINE_OUTPUT_FORMATS[offlineOutputSettings.format];
    if (!definition.qualityType) return;
    await applyOfflineOutputSettings({ [definition.qualityType]: e.target.value });
  });
  [
    document.getElementById('startup-view-effects'),
    document.getElementById('startup-view-library'),
    document.getElementById('startup-view-visualizer'),
    document.getElementById('startup-view-browser')
  ].filter(Boolean).forEach(el => {
    el.addEventListener('change', async () => {
      const startupView = startupViews.includes(el.value) ? el.value : 'effects';
      if (await save({ startupView })) syncConfigControls();
    });
  });
  const libraryStartupViewSelect = document.getElementById('library-startup-view-select');
  document.getElementById('visualizer-startup-expanded').addEventListener('change', async e => {
    await save({ visualizerStartupExpanded: e.target.checked });
  });
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
  document.getElementById('theme-select').addEventListener('change', async e => {
    const theme = normalizeThemeId(e.target.value);
    if (!await save({ theme })) return;
    window.uiManager?.setThemePreference?.(theme);
  });

  document.getElementById('pipeline-column-mode').addEventListener('change', async e => {
    const pipelineColumnMode = e.target.value === 'manual' ? 'manual' : 'auto';
    if (!await save({ pipelineColumnMode })) return;
    const columnManager = window.uiManager?.pipelineManager?.core?.columnManager;
    columnManager?.updatePipelineColumns(columnManager.getCurrentColumns());
  });
  document.getElementById('controller-mapping-btn').addEventListener('click', async () => {
    try {
      const manager = window.midiControllerManager ||
        await window.app?.ensureMidiControllerManager?.();
      await manager?.openDialog?.();
    } catch (error) {
      console.error('Failed to open controller mapping settings:', error);
      window.uiManager?.setError?.('Controller mapping settings could not be opened. Please try again.', true);
    }
  });
  function closeDialog() {
    closeStandardSelect(document);
    removeOpenHomeStatusListener?.();
    removeOpenHomeStatusListener = null;
    removeAirPlayStatusListener?.();
    removeAirPlayStatusListener = null;
    removeRemoteControlSettingsListener?.();
    networkSettings?.dispose();
    removeRemoteControlSettingsListener = null;
    document.body.removeChild(overlay);
    document.head.removeChild(style);
    document.removeEventListener('keydown', handleKeydown);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  }

  document.getElementById('close-btn').addEventListener('click', closeDialog);
  document.getElementById('library-sharing-save')?.addEventListener('click', saveLibrarySharing);
  document.getElementById('library-sharing-enabled')?.addEventListener('change', markLibrarySharingUnsaved);
  document.addEventListener('keydown', handleKeydown);

  if (typeof openHomeAPI?.onStatus === 'function') {
    removeOpenHomeStatusListener = openHomeAPI.onStatus(status => {
      if (!acceptOpenHomeStatus(status)) {
        console.warn('Ignored an invalid OpenHome remote control status update');
        return;
      }
      if (!openHomeChangeInFlight) openHomeOperationFailed = false;
      if (!upnpAvChangeInFlight) upnpAvOperationFailed = false;
      renderNetworkStatus();
    });
  }
  if (typeof airPlayAPI?.onStatus === 'function') {
    removeAirPlayStatusListener = airPlayAPI.onStatus(status => {
      if (!acceptAirPlayStatus(status)) return;
      if (!airPlayChangeInFlight) airPlayOperationFailed = false;
      renderAirPlayStatus();
    });
  }
  removeRemoteControlSettingsListener = remoteControlSettings?.subscribe(renderRemoteControlSettings);
  await Promise.all([refreshOpenHomeStatus(), refreshAirPlayStatus(), refreshLibrarySharing()]);
}
