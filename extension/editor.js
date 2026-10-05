import { ExtensionClient } from './protocol.js';
import { ExtensionIrLibraryClient } from './ir-library.js';
import { hasPreparationStatus, mirrorPreparationStatus, refreshPreparationStatuses } from './preparation-status-bridge.js';
import { initializePluginModel, serializePipeline, validatePreset } from './model.js';
import { PipelineManager } from '../js/ui/pipeline-manager.js';
import { PluginListManager } from '../js/ui/plugin-list-manager.js';
import { LayoutModeManager } from '../js/ui/layout-mode-manager.js';
import { MobileNumberKeypad } from '../js/ui/mobile-number-keypad.js';
import { TelemetryHub } from '../js/audio/telemetry-hub.js';
import { installRangeFillStyling } from '../js/ui/range-fill.js';
import { applySerializedState, getSerializablePluginStateShort, convertShortToLongFormat } from '../js/utils/serialization-utils.js';
import dataStorage, { MeasurementImportError } from '../features/measurement/dataStorage.js';
import { ExtensionMobileShell } from './mobile-shell.js';
import { createUserDataBackupAdapter } from '../js/user-data-backup/adapters.js';
import { openUserDataBackupDialog } from '../js/user-data-backup/dialog.js';
import { UserDataBackupService } from '../js/user-data-backup/service.js';

const MAXIMUM_MEASUREMENT_IMPORT_BYTES = 128 * 1024 * 1024;
const TRANSIENT_MESSAGE_DURATION_MS = 3000;
const VIRTUAL_MEASUREMENT_CHANNEL_SEPARATOR = '::ch=';
const SAMPLE_RATES = new Set([44100, 48000, 96000, 192000]);
const DOCUMENTATION_BASE_URL = 'https://effetune.frieve.com';
const VISUALIZER_INACTIVE_MESSAGE = 'Start EffeTune on a tab to show Visualizer.';
// Extension-only wording for shared keys whose Web text does not apply here.
const EXTENSION_TRANSLATIONS = Object.freeze({
  'visualizer.unavailable': VISUALIZER_INACTIVE_MESSAGE,
  'visualizer.disabled': VISUALIZER_INACTIVE_MESSAGE
});

const STATUS_LABELS = Object.freeze({
  stopped: 'Not processing',
  starting: 'Starting…',
  processing: 'Processing',
  stopping: 'Stopping…',
  error: 'Needs attention'
});

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isLiveSession(session) {
  return session?.status === 'starting' || session?.status === 'processing';
}

export function selectEditorSnapshot(snapshot, sessionId) {
  if (!Array.isArray(snapshot?.sessions)) return snapshot;
  const session = snapshot.sessions.find(candidate => candidate.sessionId === sessionId && isLiveSession(candidate));
  if (session) return { ...snapshot, ...session, plugins: session.plugins || [] };
  return {
    ...snapshot,
    status: 'stopped',
    title: '',
    error: null,
    presetName: null,
    preparationStatuses: [],
    plugins: snapshot.plugins || [],
    masterBypass: snapshot.masterBypass === true,
    sampleRate: snapshot.sampleRate
  };
}

function parseJson5Object(text) {
  return JSON.parse(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
}

async function loadEnglishTranslations() {
  try {
    const response = await fetch('js/locales/en.json5');
    return response.ok ? parseJson5Object(await response.text()) : {};
  } catch (error) {
    console.error('[EffeTune extension] English translations could not be loaded', error);
    return {};
  }
}

function substitute(text, params) {
  return Object.entries(params || {}).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    text
  );
}

function baseMeasurementId(id) {
  const text = String(id || '');
  const separator = text.lastIndexOf(VIRTUAL_MEASUREMENT_CHANNEL_SEPARATOR);
  return separator > 0 ? text.slice(0, separator) : text;
}

export function getExtensionDocumentationUrl(path) {
  const [basePath, anchor = ''] = path.split('#', 2);
  if (!basePath.startsWith('/plugins/')) return path;
  const htmlPath = basePath.replace(/\.[^/.]+$/, '') + '.html';
  return `${DOCUMENTATION_BASE_URL}/docs${htmlPath}${anchor ? `#${anchor}` : ''}`;
}

export function createUiManager(sourceTranslations, showMessage, hideMessage, openSharedVisualizer) {
  const translations = { ...sourceTranslations, ...EXTENSION_TRANSLATIONS };
  return {
    translations,
    englishTranslations: translations,
    expandedPlugins: new Set(),
    layoutMode: new LayoutModeManager(),
    debugChannelCount: 2,
    openSharedVisualizer,
    t(key, params = {}) {
      return substitute(translations[key] || key, params);
    },
    updateURL() {},
    updatePipelineToggleButton() {},
    clearError() { hideMessage(); },
    isDoubleBlindActive() { return false; },
    getLocalizedDocPath(path) { return getExtensionDocumentationUrl(path); },
    showTransientMessage(key, isError = false, params = {}, duration = 3000) {
      // Shared views may pass an already translated sentence instead of a key.
      const fallback = /\s/.test(key) ? key : (isError ? 'Something went wrong. Try again.' : 'Pipeline updated.');
      showMessage(substitute(translations[key] || fallback, params), !isError, duration);
    },
    setError(key, isError = key.startsWith('error.'), params = {}) {
      const presetError = key === 'error.invalidPresetData' || key === 'error.failedToLoadPreset';
      const fallback = presetError
        ? 'That preset could not be applied. Your current pipeline was kept.'
        : (isError ? 'Something went wrong. Your current pipeline was kept. Try again.' : key);
      showMessage(substitute(translations[key] || fallback, params), !isError);
    }
  };
}

class ExtensionWorkletPort extends EventTarget {
  constructor(send) {
    super();
    this.send = send;
  }

  postMessage(message) {
    if (message?.type === 'registerProcessor') return;
    this.send(message);
  }

  start() {}

  deliver(message) {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}

export class ExtensionAudioManager {
  constructor(client, onError) {
    this.client = client;
    this.onError = onError;
    this.pipelineA = [];
    this.pipelineB = null;
    this.currentPipeline = 'A';
    this.masterBypass = false;
    this.suppressMutations = true;
    this.mutationQueue = Promise.resolve();
    this.pendingMutations = 0;
    this.mutationGeneration = 0;
    this.workletPort = new ExtensionWorkletPort(message => this.forwardPluginMessage(message));
    const audioContext = { sampleRate: 48000, destination: { channelCount: 2 } };
    this.workletNode = {
      port: this.workletPort,
      context: audioContext,
      channelCount: 2
    };
    this.audioContext = audioContext;
    this.contextManager = { workletNode: this.workletNode, audioContext };
    this.pipelineProcessor = { setMasterBypass() {} };
    this.listeners = new Map();
    this.dspReady = false;
  }

  get pipeline() { return this.pipelineA; }
  set pipeline(plugins) { this.pipelineA = plugins; }
  getCurrentPipeline() { return this.pipelineA; }
  updateCurrentPipeline(plugins) { this.pipelineA = plugins; }
  getActivePowerWorklets() { return [this.workletNode]; }
  incrementPowerDiagnostic() {}
  syncPrimaryWasmAssetMembership() {}
  notifyPipelineAnalysisInvalidated() {}
  rebuildPipeline() { window.FrequencyPreview?.stop?.(); }
  setFrequencyPreview(frequency, sound) { this.client.sendFrequencyPreview(frequency, sound); }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }

  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }

  dispatchEvent(name, data) {
    for (const listener of [...(this.listeners.get(name) || [])]) listener(data);
  }

  isDspReady() { return this.dspReady; }

  setDspReady(ready) {
    const becameReady = ready && !this.dspReady;
    this.dspReady = ready;
    // A recreated worklet restarts its frame counters, so listeners resubscribe with fresh tap IDs.
    if (becameReady) this.dispatchEvent('dspReady');
  }

  setVisualizerSources(sources) {
    // Bypass the mutation queue: its settlement would restore the pipeline snapshot.
    const sessionId = this.client.sessionId;
    if (!sessionId) return;
    const key = JSON.stringify([sessionId, sources]);
    if (key === this.lastVisualizerSourcesKey) return;
    this.lastVisualizerSourcesKey = key;
    this.client.request('setVisualizerSources', { sources }).catch(error => {
      if (this.lastVisualizerSourcesKey === key) this.lastVisualizerSourcesKey = null;
      console.error('[EffeTune extension] Visualizer sources update failed', error);
    });
  }

  enqueue(operation) {
    const generation = this.mutationGeneration;
    this.pendingMutations += 1;
    const operationResult = this.mutationQueue.then(() => {
      if (generation !== this.mutationGeneration) throw new Error('This action was cancelled because an earlier edit failed. Try again.');
      return operation();
    });
    const result = operationResult.catch(async error => {
      if (generation === this.mutationGeneration) {
        this.mutationGeneration += 1;
        await this.onError(error);
      }
      throw error;
    }).finally(() => {
      this.pendingMutations -= 1;
      if (this.pendingMutations === 0) this.onMutationsSettled?.();
    });
    this.mutationQueue = result.catch(() => {});
    return result;
  }

  request(command, args = {}) {
    // Reserve file preparation immediately and capture the target and ordinary
    // payloads now so subsequent edits or session changes cannot redirect them.
    const payload = typeof args === 'function' ? args : structuredClone(args);
    const sessionId = this.client.sessionId;
    return this.enqueue(async () => this.client.request(command,
      typeof payload === 'function' ? await payload() : payload, sessionId));
  }

  serializeCurrentPipeline() {
    const serialized = serializePipeline(this.pipelineA);
    return serialized.map((state, index) => ({
      ...state,
      id: this.pipelineA[index].id
    }));
  }

  forwardPluginMessage(message) {
    if (this.suppressMutations) return;
    this.request('workletMessage', { message });
  }

  commitPowerTopologyMutation(message, { reason } = {}) {
    if (this.suppressMutations) return;
    if (reason === 'pipeline-master-bypass' && typeof message?.masterBypass === 'boolean') {
      this.masterBypass = message.masterBypass;
      this.request('setBypass', { enabled: this.masterBypass });
      return;
    }
    if (message?.type === 'updatePlugin') {
      if (!this.pipelineA.some(plugin => plugin.id === message.plugin?.id)) return;
      this.forwardPluginMessage(message);
      return;
    }
    this.request('setPipeline', { plugins: this.serializeCurrentPipeline() });
  }

  setMasterBypass(enabled) {
    this.masterBypass = !!enabled;
    if (!this.suppressMutations) {
      return this.request('setBypass', { enabled: this.masterBypass });
    }
  }
}

function normalizeModelResult(result) {
  return result?.pluginManager || result;
}

function keepExtensionEffects(pluginManager) {
  for (const category of Object.values(pluginManager.effectCategories)) {
    category.plugins = category.plugins.filter(name => {
      const type = pluginManager.pluginClasses[name]?.name;
      return type === 'SectionPlugin' || window.dspParamPackers?.has(type);
    });
  }
}

export class ExtensionEditor {
  constructor({
    client = new ExtensionClient(),
    documentRef = document,
    measurementStorage = dataStorage
  } = {}) {
    this.client = client;
    this.document = documentRef;
    this.measurementStorage = measurementStorage;
    this.snapshot = null;
    this.pluginManager = null;
    this.pipelineManager = null;
    this.pluginListManager = null;
    this.audioManager = null;
    this.uiManager = null;
    this.elements = {};
    this.messageTimer = null;
    this.messageRevision = 0;
    this.measurementUiObserver = null;
    this.ruleDraft = [];
    this.changingSession = false;
  }

  showMessage(text, success = false, duration = 0) {
    const revision = ++this.messageRevision;
    if (this.messageTimer !== null) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    const element = this.elements.message;
    element.textContent = text;
    element.classList.toggle('success', success);
    element.hidden = false;
    if (duration > 0) {
      this.messageTimer = setTimeout(() => {
        if (this.messageRevision !== revision) return;
        this.messageTimer = null;
        element.hidden = true;
      }, duration);
    }
  }

  hideMessage() {
    this.messageRevision += 1;
    if (this.messageTimer !== null) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    this.elements.message.hidden = true;
  }

  reportError(error, message = 'Something went wrong. Your current pipeline was kept. Try again.') {
    console.error('[EffeTune extension]', error);
    this.showMessage(message, false);
  }

  createPresetHost() {
    return {
      getPresets: async () => ({ ...(this.snapshot?.presets || {}) }),
      savePreset: name => this.audioManager.request('savePreset', { name }),
      loadPreset: value => typeof value === 'string'
        ? this.audioManager.request('applyPreset', { name: value })
        : this.audioManager.request('importPreset', { preset: value, name: value?.name }),
      deletePreset: name => this.audioManager.request('deletePreset', { name })
    };
  }

  async initialize() {
    this.elements = {
      target: this.document.getElementById('editorTarget'),
      status: this.document.getElementById('editorStatus'),
      sampleRate: this.document.getElementById('editorSampleRate'),
      sessionSelect: this.document.getElementById('editorSessionSelect'),
      settingsMenuButton: this.document.getElementById('editorSettingsMenuButton'),
      settingsMenu: this.document.getElementById('editorSettingsMenu'),
      sampleRateSelect: this.document.getElementById('editorSampleRateSelect'),
      urlRules: this.document.getElementById('editorUrlRules'),
      backupRestore: this.document.getElementById('editorBackupRestore'),
      rulesDialog: this.document.getElementById('urlRulesDialog'),
      rulesList: this.document.getElementById('urlRulesList'),
      emptyRules: this.document.getElementById('emptyUrlRules'),
      addRule: this.document.getElementById('addUrlRuleButton'),
      saveRules: this.document.getElementById('saveUrlRulesButton'),
      cancelRules: this.document.getElementById('cancelUrlRulesButton'),
      closeRules: this.document.getElementById('closeUrlRulesButton'),
      importMeasurement: this.document.getElementById('editorImportMeasurement'),
      measurementFile: this.document.getElementById('editorMeasurementFile'),
      importPreset: this.document.getElementById('editorImportPreset'),
      exportPreset: this.document.getElementById('editorExportPreset'),
      presetFile: this.document.getElementById('editorPresetFile'),
      undo: this.document.getElementById('undoButton'),
      redo: this.document.getElementById('redoButton'),
      visualizerButton: this.document.getElementById('editorVisualizerButton'),
      message: this.document.getElementById('editorMessage')
    };

    const [snapshot, translations, model] = await Promise.all([
      this.client.connect(),
      loadEnglishTranslations(),
      initializePluginModel()
    ]);
    const firstSession = snapshot.sessions?.find(isLiveSession);
    this.client.sessionId = firstSession?.sessionId || null;
    this.snapshot = snapshot;
    window.irLibraryService = new ExtensionIrLibraryClient(this.client);
    await window.irLibraryService.refresh();
    this.pluginManager = normalizeModelResult(model);
    keepExtensionEffects(this.pluginManager);
    const createPlugin = this.pluginManager.createPlugin.bind(this.pluginManager);
    this.pluginManager.createPlugin = name => {
      const plugin = createPlugin(name);
      plugin.setWasmAssetTargetResolver?.(() => []);
      mirrorPreparationStatus(plugin, () => this.currentSnapshot()?.preparationStatuses);
      return plugin;
    };
    this.uiManager = createUiManager(
      translations,
      (text, success, duration) => this.showMessage(text, success, duration),
      () => this.hideMessage(),
      encoded => this.openSharedVisualizer(encoded)
    );
    this.mobileShell = new ExtensionMobileShell({
      documentRef: this.document,
      translate: (key, fallback) => translations[key] || fallback
    });
    this.uiManager.mobileNav = this.mobileShell;
    this.uiManager.hideVisualizerView = options => {
      void this.setVisualizerVisible(false, options)
        .catch(error => console.error('[EffeTune extension] Visualizer could not be closed', error));
    };
    this.mobileNumberKeypad = new MobileNumberKeypad({
      documentRef: this.document,
      isEnabled: () => this.uiManager.layoutMode.isMobile,
      translate: (key, fallback) => translations[key] || fallback
    });
    this.layoutModeUnsubscribe = this.uiManager.layoutMode.onChange(mode => {
      this.mobileShell.applyMode(mode);
      const columnManager = this.pipelineManager?.core?.columnManager;
      columnManager?.updatePipelineColumns(columnManager.getCurrentColumns());
      this.pluginListManager?.updatePositions();
      if (!this.uiManager.layoutMode.isMobile) this.mobileNumberKeypad.cancel();
    });
    this.mobileShell.applyMode(this.uiManager.layoutMode.mode);
    window.uiManager = this.uiManager;
    window.pluginManager = this.pluginManager;

    this.audioManager = new ExtensionAudioManager(this.client, async error => {
      this.reportError(error);
      try { this.snapshot = await this.client.request('getState'); }
      catch (refreshError) { console.error('[EffeTune extension] State refresh failed', refreshError); }
      if (this.snapshot && this.pipelineManager) this.restoreSnapshot(this.snapshot, true);
    });
    this.audioManager.onMutationsSettled = () => this.restoreSnapshot(this.snapshot);
    this.audioManager.outputChannelCount = 2;
    this.uiManager.audioManager = this.audioManager;
    window.audioManager = this.audioManager;
    window.audioContext = this.audioManager.workletNode.context;
    window.workletNode = this.audioManager.workletNode;
    this.audioManager.telemetryHub = new TelemetryHub({ port: { postMessage() {} } });
    window.dspTelemetryHub = this.audioManager.telemetryHub;

    this.pluginListManager = new PluginListManager(this.pluginManager);
    this.uiManager.pluginListManager = this.pluginListManager;
    const presetHost = this.createPresetHost();
    this.pipelineManager = new PipelineManager(
      this.audioManager,
      this.pluginManager,
      this.uiManager.expandedPlugins,
      this.pluginListManager,
      { presetHost, enableFileProcessing: false }
    );
    this.audioManager.pipelineManager = this.pipelineManager;
    this.uiManager.pipelineManager = this.pipelineManager;
    window.pipelineManager = this.pipelineManager;
    this.rangeFillController = installRangeFillStyling(this.document);

    this.bindEvents();
    this.restoreSnapshot(snapshot, true);
    this.installMeasurementListEnhancements();
    this.pluginListManager.initPluginList();
    this.pipelineManager.initDragAndDrop();
    this.rangeFillController.refresh();
    this.pluginListManager.collapseManager.markReady();
    this.pipelineManager.historyManager.saveState();
    await this.updateTelemetrySubscription();
    return this;
  }

  bindEvents() {
    this.client.addEventListener('state', event => this.restoreSnapshot(event.detail));
    this.client.addEventListener('workletMessage', event => {
      if (['assetState', 'assetLoadRejected'].includes(event.detail?.type) &&
          this.audioManager.pipeline.some(plugin =>
            plugin.id === event.detail.pluginId && hasPreparationStatus(plugin))) return;
      this.audioManager.telemetryHub.handleMessage(event.detail);
      this.audioManager.workletPort.deliver(event.detail);
    });
    this.elements.sessionSelect?.addEventListener('change', () => {
      void this.changeSession(this.elements.sessionSelect.value || null);
    });
    this.elements.sampleRateSelect?.addEventListener('change', () => {
      const value = this.elements.sampleRateSelect.value;
      const sampleRate = value === '' ? null : Number(value);
      if (sampleRate !== null && !SAMPLE_RATES.has(sampleRate)) return;
      void this.client.request('setSampleRate', { sampleRate }).catch(error => {
        this.reportError(error, 'The sample rate could not be changed. Your current setting was kept.');
      });
    });
    this.elements.urlRules?.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.openRulesDialog();
    });
    this.elements.backupRestore?.addEventListener('click', () => {
      this.closeSettingsMenu();
      const adapter = createUserDataBackupAdapter({
        presetManager: this.pipelineManager?.presetManager,
        irLibrary: window.irLibraryService,
        extensionClient: this.client,
        canApplyPreset: item => {
          if (item.kind !== 'pipeline') return true;
          try {
            validatePreset(item.data, this.pluginManager, this.currentSnapshot()?.sampleRate || 48000);
            return true;
          } catch {
            return 'Some effects or settings cannot be used in this extension. The preset will still be saved.';
          }
        }
      });
      const service = new UserDataBackupService({
        adapter,
        appVersion: globalThis.chrome?.runtime?.getManifest?.().version || 'unknown'
      });
      openUserDataBackupDialog({
        service,
        translate: (key, fallback, params) => {
          const translated = this.uiManager?.t?.(key, params);
          return translated && translated !== key ? translated : substitute(fallback, params);
        },
        onRestored: async () => {
          this.snapshot = await this.client.request('getState');
          this.uiManager?.pluginListManager?.refreshPresetsIfVisible?.();
          await this.refreshMeasurementConsumers();
          this.updateImportedDeleteButtons();
        }
      });
    });
    this.elements.addRule?.addEventListener('click', () => {
      this.ruleDraft.push({ pattern: '', preset: Object.keys(this.snapshot?.presets || {})[0] || '', enabled: true });
      this.renderRuleDraft();
    });
    this.elements.saveRules?.addEventListener('click', () => void this.saveRules());
    this.elements.cancelRules?.addEventListener('click', () => this.closeRulesDialog());
    this.elements.closeRules?.addEventListener('click', () => this.closeRulesDialog());
    this.elements.rulesDialog?.addEventListener('click', event => {
      if (event.target === this.elements.rulesDialog) this.closeRulesDialog();
    });
    this.elements.settingsMenuButton.addEventListener('click', event => {
      event?.stopPropagation?.();
      this.toggleSettingsMenu();
    });
    this.elements.importMeasurement.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.elements.measurementFile.click();
    });
    this.elements.measurementFile.addEventListener('change', event => this.importMeasurementFile(event));
    this.elements.importPreset.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.elements.presetFile.click();
    });
    this.elements.presetFile.addEventListener('change', event => this.importPresetFile(event));
    this.elements.exportPreset.addEventListener('click', () => {
      this.closeSettingsMenu();
      void this.exportPreset();
    });
    this.elements.visualizerButton?.addEventListener('click', () => {
      const visible = !this.document.body.classList.contains('view-visualizer');
      void this.setVisualizerVisible(visible).catch(error => {
        this.visualizerModulePromise = null;
        this.reportError(error, 'Visualizer could not be opened. Try again.');
      });
    });
    this.elements.undo.addEventListener('click', () => this.pipelineManager.undo());
    this.elements.redo.addEventListener('click', () => this.pipelineManager.redo());
    this.document.addEventListener('visibilitychange', () => {
      if (!this.changingSession) void this.updateTelemetrySubscription();
    });
    this.document.addEventListener('click', event => {
      if (event?.target === this.elements.settingsMenuButton ||
          this.elements.settingsMenu?.contains?.(event?.target)) return;
      this.closeSettingsMenu();
    });
    this.document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (!this.elements.rulesDialog?.hidden) this.closeRulesDialog();
        else this.closeSettingsMenu();
      }
    });
    window.addEventListener('pagehide', () => {
      this.client.request('setTelemetry', { enabled: false }).catch(() => {});
    }, { once: true });
  }

  toggleSettingsMenu() {
    const expanded = this.elements.settingsMenu.classList.toggle('show');
    this.elements.settingsMenuButton.setAttribute('aria-expanded', String(expanded));
  }

  closeSettingsMenu() {
    this.elements.settingsMenu?.classList.remove('show');
    this.elements.settingsMenuButton?.setAttribute?.('aria-expanded', 'false');
  }

  currentSnapshot(snapshot = this.snapshot) {
    return selectEditorSnapshot(snapshot, this.client.sessionId || null);
  }

  reconcileSession(snapshot) {
    if (this.changingSession) return false;
    if (!Array.isArray(snapshot?.sessions)) return false;
    const liveSessions = snapshot.sessions.filter(isLiveSession);
    if (liveSessions.some(session => session.sessionId === this.client.sessionId)) return false;
    // Keep the visible pipeline until its edits settle, then reconcile again
    // from the queue's settled callback.
    if (this.audioManager?.pendingMutations > 0) return false;
    const nextSessionId = liveSessions[0]?.sessionId || null;
    if (this.client.sessionId === nextSessionId) return false;
    this.client.sessionId = nextSessionId;
    void this.updateTelemetrySubscription();
    return true;
  }

  async changeSession(sessionId) {
    if (this.changingSession || sessionId === this.client.sessionId) return;
    this.changingSession = true;
    const previousSessionId = this.client.sessionId;
    const unlockInput = this.lockEditorInput();
    try {
      await this.audioManager.mutationQueue;
      await this.client.request('setTelemetry', { enabled: false });
      const snapshot = await this.client.request('getState');
      this.client.sessionId = sessionId;
      if (!this.snapshot || snapshot.revision >= this.snapshot.revision) this.snapshot = snapshot;
    } catch (error) {
      this.reportError(error, 'That pipeline could not be opened. Try again.');
    } finally {
      try {
        await this.updateTelemetrySubscription();
      } finally {
        this.changingSession = false;
        try {
          const sessionChanged = this.client.sessionId !== previousSessionId;
          this.restoreSnapshot(this.snapshot, sessionChanged, sessionChanged);
        } finally {
          unlockInput();
        }
      }
    }
  }

  renderSessionOptions(snapshot) {
    const select = this.elements.sessionSelect;
    if (!select || !Array.isArray(snapshot?.sessions)) return;
    const liveSessions = snapshot.sessions.filter(isLiveSession);
    select.replaceChildren();
    if (liveSessions.length === 0) select.add(new Option('Offline pipeline', ''));
    for (const session of liveSessions) {
      select.add(new Option(session.title || `Tab ${session.tabId}`, session.sessionId));
    }
    select.value = this.client.sessionId || '';
  }

  openRulesDialog() {
    this.ruleDraft = structuredClone(this.snapshot?.rules || []);
    this.renderRuleDraft();
    this.elements.rulesDialog.hidden = false;
  }

  closeRulesDialog() {
    if (this.elements.rulesDialog) this.elements.rulesDialog.hidden = true;
  }

  renderRuleDraft() {
    const list = this.elements.rulesList;
    if (!list) return;
    const presets = Object.keys(this.snapshot?.presets || {}).sort((left, right) => left.localeCompare(right));
    list.replaceChildren(...this.ruleDraft.map((rule, index) => {
      const row = this.document.createElement('div');
      row.className = 'url-rule-row';
      const enabledLabel = this.document.createElement('label');
      enabledLabel.className = 'url-rule-enabled';
      enabledLabel.title = 'Enable rule';
      const enabled = this.document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = rule.enabled !== false;
      enabled.setAttribute('aria-label', `Enable rule ${index + 1}`);
      enabled.addEventListener('change', () => { rule.enabled = enabled.checked; });
      enabledLabel.appendChild(enabled);
      const pattern = this.document.createElement('input');
      pattern.type = 'text';
      pattern.value = rule.pattern || '';
      pattern.placeholder = 'example.com/path/*';
      pattern.setAttribute('aria-label', `Pattern for rule ${index + 1}`);
      pattern.addEventListener('input', () => { rule.pattern = pattern.value; });
      const preset = this.document.createElement('select');
      preset.setAttribute('aria-label', `Preset for rule ${index + 1}`);
      const names = presets.includes(rule.preset) || !rule.preset ? presets : [rule.preset, ...presets];
      if (names.length === 0) preset.add(new Option('No saved presets', ''));
      for (const name of names) {
        preset.add(new Option(name === rule.preset && !presets.includes(name) ? `${name} (missing)` : name, name));
      }
      preset.value = rule.preset || '';
      preset.addEventListener('change', () => { rule.preset = preset.value; });
      const makeButton = (text, label, className, disabled, action) => {
        const button = this.document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.className = className;
        button.disabled = disabled;
        button.addEventListener('click', action);
        return button;
      };
      const up = makeButton('↑', `Move rule ${index + 1} up`, 'url-rule-move-up', index === 0, () => {
        [this.ruleDraft[index - 1], this.ruleDraft[index]] = [this.ruleDraft[index], this.ruleDraft[index - 1]];
        this.renderRuleDraft();
      });
      const down = makeButton('↓', `Move rule ${index + 1} down`, 'url-rule-move-down', index === this.ruleDraft.length - 1, () => {
        [this.ruleDraft[index], this.ruleDraft[index + 1]] = [this.ruleDraft[index + 1], this.ruleDraft[index]];
        this.renderRuleDraft();
      });
      const remove = makeButton('×', `Delete rule ${index + 1}`, 'url-rule-delete', false, () => {
        this.ruleDraft.splice(index, 1);
        this.renderRuleDraft();
      });
      row.append(enabledLabel, pattern, preset, up, down, remove);
      return row;
    }));
    this.elements.emptyRules.hidden = this.ruleDraft.length !== 0;
  }

  async saveRules() {
    const rules = this.ruleDraft.map(rule => ({
      pattern: String(rule.pattern || '').trim(),
      preset: String(rule.preset || ''),
      enabled: rule.enabled !== false
    }));
    if (rules.some(rule => !rule.pattern || !rule.preset)) {
      this.showMessage('Each URL rule needs both a pattern and a saved preset.', false);
      return;
    }
    this.elements.saveRules.disabled = true;
    try {
      await this.client.request('setRules', { rules });
      this.closeRulesDialog();
      this.showMessage('URL rules saved.', true, TRANSIENT_MESSAGE_DURATION_MS);
    } catch (error) {
      this.reportError(error, 'The URL rules could not be saved. Check the patterns and try again.');
    } finally {
      this.elements.saveRules.disabled = false;
    }
  }

  serializeVisiblePipeline() {
    return this.audioManager.pipeline.map(plugin => ({
      ...getSerializablePluginStateShort(plugin),
      id: plugin.id
    }));
  }

  pipelineMatches(snapshot) {
    return stableStringify(this.serializeVisiblePipeline()) === stableStringify(snapshot.plugins || []);
  }

  syncRuntimeState(snapshot) {
    this.audioManager.masterBypass = snapshot.masterBypass === true;
    this.audioManager.setDspReady(snapshot.status === 'processing');
    this.audioManager.workletNode.context.sampleRate = snapshot.sampleRate || 48000;
    this.pipelineManager.core.enabled = !this.audioManager.masterBypass;
    this.pipelineManager.core.masterToggle?.classList.toggle('off', this.audioManager.masterBypass);
    this.pipelineManager.core.updateAllPluginDisplayState?.();
  }

  resetPipelineHistory() {
    const history = this.pipelineManager.historyManager;
    history.endOperation?.();
    history.history = [];
    history.historyIndex = -1;
    history.saveState();
  }

  restoreSnapshot(snapshot, force = false, resetHistory = false) {
    if (!snapshot || (this.snapshot && snapshot.revision < this.snapshot.revision)) return;
    if (this.changingSession) {
      this.snapshot = snapshot;
      return;
    }
    const sessionChanged = this.reconcileSession(snapshot);
    const historyBoundary = resetHistory || sessionChanged;
    const selectedSnapshot = this.currentSnapshot(snapshot);
    const rebuild = force || !this.pipelineMatches(selectedSnapshot);
    this.snapshot = snapshot;
    this.syncRuntimeState(selectedSnapshot);
    this.renderSessionOptions(snapshot);
    this.renderGlobalSettings(snapshot);
    this.renderSession(selectedSnapshot);
    if (!force && this.audioManager.pendingMutations > 0) return;
    refreshPreparationStatuses(this.audioManager.pipeline);
    if (!rebuild) {
      if (historyBoundary) this.resetPipelineHistory();
      return;
    }

    this.audioManager.suppressMutations = true;
    try {
      for (const plugin of this.audioManager.pipeline) plugin.cleanup?.();
      const plugins = (selectedSnapshot.plugins || []).map(state => {
        const plugin = this.pluginManager.createPlugin(state.nm);
        plugin.id = state.id;
        plugin.audioManager = this.audioManager;
        plugin.setWasmAssetTargetResolver?.(() => []);
        applySerializedState(plugin, state);
        return plugin;
      });
      this.audioManager.pipelineA = plugins;
      const maxId = plugins.reduce((max, plugin) => Math.max(max, Number(plugin.id) || 0), 0);
      this.pluginManager.nextPluginId = Math.max(this.pluginManager.nextPluginId, maxId + 1);
      this.uiManager.expandedPlugins.clear();
      for (const plugin of plugins) this.uiManager.expandedPlugins.add(plugin);
      this.pipelineManager.updatePipelineUI(true);
      this.rangeFillController?.refresh();
      if (historyBoundary) this.resetPipelineHistory();
      else this.pipelineManager.historyManager.saveState();
    } finally {
      this.audioManager.suppressMutations = false;
    }
  }

  renderGlobalSettings(snapshot) {
    if (this.elements.sampleRateSelect) {
      this.elements.sampleRateSelect.value = snapshot.sampleRate == null ? '' : String(snapshot.sampleRate);
    }
  }

  renderSession(snapshot = this.currentSnapshot()) {
    const title = snapshot.title || snapshot.target?.title || '';
    this.elements.target.textContent = title || 'Offline pipeline';
    this.elements.target.title = title;
    this.elements.status.textContent = STATUS_LABELS[snapshot.status] || STATUS_LABELS.error;
    this.elements.status.className = `editor-status ${snapshot.status === 'processing' ? 'processing' : snapshot.status === 'error' ? 'error' : ''}`.trim();
    this.elements.sampleRate.textContent = snapshot.sampleRate ? `${snapshot.sampleRate.toLocaleString()} Hz` : 'Auto';
    if (snapshot.status === 'error') {
      if (snapshot.error) console.error('[EffeTune extension]', snapshot.error);
      this.showMessage('Processing stopped. Your pipeline is saved; choose a playable tab and start again from the EffeTune button.', false);
    }
  }

  async importPresetFile(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    try {
      await this.audioManager.request('importPreset', async () => {
        const preset = JSON.parse(await file.text());
        return { preset, name: preset?.name };
      });
      this.pipelineManager.presetManager.currentPresetName = '';
      this.showMessage(`Imported “${file.name}”.`, true, TRANSIENT_MESSAGE_DURATION_MS);
    } catch (error) {
      this.reportError(error, 'That preset could not be imported. Your current pipeline was kept.');
    }
  }

  async importMeasurementFile(event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return null;
    if (!/\.json$/i.test(file.name || '')) {
      this.showMessage('Choose a measurement JSON file exported by EffeTune.', false);
      return null;
    }
    if (!Number.isFinite(file.size) || file.size > MAXIMUM_MEASUREMENT_IMPORT_BYTES) {
      this.showMessage('Measurement files must be at most 128 MB.', false);
      return null;
    }

    this.elements.importMeasurement.disabled = true;
    try {
      await this.measurementStorage.initialize();
      const measurementId = await this.measurementStorage.importMeasurementFromJSON(await file.text());
      if (!measurementId) {
        this.showMessage('That file is not a valid EffeTune measurement export.', false);
        return null;
      }
      await this.refreshMeasurementConsumers();
      this.updateImportedDeleteButtons();
      this.showMessage(`Imported measurement “${file.name}”.`, true, TRANSIENT_MESSAGE_DURATION_MS);
      return measurementId;
    } catch (error) {
      console.error('[EffeTune extension] Measurement import failed', error);
      this.showMessage(error instanceof MeasurementImportError && error.kind === 'storage'
        ? 'The measurement could not be saved. Check available browser storage and try again.'
        : 'That measurement could not be imported. Choose a measurement JSON file exported by EffeTune.', false);
      return null;
    } finally {
      this.elements.importMeasurement.disabled = false;
    }
  }

  measurementConsumers() {
    return this.audioManager.pipeline.filter(plugin =>
      plugin?.name === 'Room EQ' || plugin?.name === 'Crosstalk Cancellation');
  }

  confirmImportedMeasurementDeletion(measurement) {
    return new Promise(resolve => {
      const overlay = this.document.createElement('div');
      overlay.className = 'modal-overlay extension-measurement-delete-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'extensionMeasurementDeleteTitle');

      const dialog = this.document.createElement('div');
      dialog.className = 'extension-measurement-delete-dialog';
      const title = this.document.createElement('h2');
      title.id = 'extensionMeasurementDeleteTitle';
      title.textContent = 'Delete imported measurement';
      const description = this.document.createElement('p');
      description.textContent = `Delete imported measurement “${measurement.name || 'Measurement'}”? This cannot be undone.`;
      const buttons = this.document.createElement('div');
      buttons.className = 'dialog-buttons';
      const cancel = this.document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      const confirm = this.document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'extension-measurement-delete-confirm';
      confirm.textContent = 'Delete';
      buttons.append(cancel, confirm);
      dialog.append(title, description, buttons);
      overlay.appendChild(dialog);

      let finished = false;
      const finish = result => {
        if (finished) return;
        finished = true;
        this.document.removeEventListener('keydown', handleKeyDown);
        overlay.remove();
        resolve(result);
      };
      const handleKeyDown = event => {
        if (event.key === 'Escape') finish(false);
      };
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      this.document.addEventListener('keydown', handleKeyDown);
      this.document.body.appendChild(overlay);
      cancel.focus();
    });
  }

  roomEqPluginForMeasurementSelect(select) {
    const pluginId = Number(select?.id?.slice('room-eq-measurement-'.length));
    return this.audioManager.pipeline.find(plugin =>
      plugin?.name === 'Room EQ' && plugin.id === pluginId) || null;
  }

  updateImportedDeleteButtons() {
    for (const row of this.document.querySelectorAll?.('.room-eq-measurement-row') || []) {
      const button = row.querySelector('.extension-measurement-delete');
      const select = row.querySelector('select[id^="room-eq-measurement-"]');
      if (!button || !select) continue;
      const plugin = this.roomEqPluginForMeasurementSelect(select);
      const selectedId = baseMeasurementId(plugin?.measurementId);
      button.disabled = true;
      if (!selectedId) continue;
      void this.measurementStorage.initialize().then(() => {
        if (!button.isConnected) return;
        const currentPlugin = this.roomEqPluginForMeasurementSelect(select);
        if (baseMeasurementId(currentPlugin?.measurementId) !== selectedId) return;
        button.disabled = this.measurementStorage.getMeasurementById(selectedId)?.imported !== true;
      }).catch(error => {
        console.error('[EffeTune extension] Imported measurement state could not be read', error);
      });
    }
  }

  enhanceRoomEqMeasurementRows(root) {
    const rows = [];
    if (root?.matches?.('.room-eq-measurement-row')) rows.push(root);
    rows.push(...(root?.querySelectorAll?.('.room-eq-measurement-row') || []));
    for (const row of rows) {
      if (row.querySelector('.extension-measurement-delete')) continue;
      const select = row.querySelector('select[id^="room-eq-measurement-"]');
      if (!select) continue;
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'room-eq-refresh extension-measurement-delete';
      button.textContent = 'Delete';
      button.title = 'Delete imported measurement';
      button.disabled = true;
      button.addEventListener('click', () => {
        button.disabled = true;
        void this.deleteImportedMeasurement(this.roomEqPluginForMeasurementSelect(select))
          .finally(() => this.updateImportedDeleteButtons());
      });
      select.addEventListener('change', () => this.updateImportedDeleteButtons());
      row.appendChild(button);
    }
    this.updateImportedDeleteButtons();
  }

  installMeasurementListEnhancements() {
    this.enhanceRoomEqMeasurementRows(this.document);
    if (typeof MutationObserver !== 'function' || !this.document.body) return;
    this.measurementUiObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) this.enhanceRoomEqMeasurementRows(node);
        }
      }
    });
    this.measurementUiObserver.observe(this.document.body, { childList: true, subtree: true });
  }

  clearDeletedMeasurementReferences(measurementId) {
    const affected = [];
    for (const plugin of this.measurementConsumers()) {
      const parameters = {};
      const previousParameters = {};
      if (plugin.name === 'Room EQ') {
        if (baseMeasurementId(plugin.measurementId) === measurementId) {
          parameters.ms = '';
          parameters.mn = '';
          parameters.rp = 0;
          previousParameters.ms = plugin.measurementId;
          previousParameters.mn = plugin.measurementName;
          previousParameters.rp = plugin.rp;
        }
        for (let index = 0; index < (plugin.channelMeasurementIds?.length || 0); index += 1) {
          if (baseMeasurementId(plugin.channelMeasurementIds[index]) !== measurementId) continue;
          parameters[`ms${index}`] = '';
          parameters[`mn${index}`] = '';
          previousParameters[`ms${index}`] = plugin.channelMeasurementIds[index];
          previousParameters[`mn${index}`] = plugin.channelMeasurementNames?.[index] || '';
        }
      } else {
        for (const key of ['ll', 'lr', 'rl', 'rr']) {
          if (baseMeasurementId(plugin[key]) !== measurementId) continue;
          parameters[key] = '';
          previousParameters[key] = plugin[key];
        }
      }
      if (Object.keys(parameters).length === 0) continue;
      plugin.setParameters(parameters);
      affected.push({ plugin, previousParameters });
    }
    return affected;
  }

  async refreshMeasurementConsumers() {
    const consumers = this.measurementConsumers().filter(plugin =>
      typeof plugin._refreshMeasurements === 'function');
    await Promise.all(consumers.map(plugin => plugin._refreshMeasurements(false)));
  }

  lockEditorInput() {
    const body = this.document.body;
    const previousInert = body?.inert || false;
    // Inert controls still leave document shortcuts and pending input events.
    const events = ['keydown', 'paste', 'drop', 'change', 'input'];
    const blockInput = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (body) body.inert = true;
    for (const type of events) this.document.addEventListener?.(type, blockInput, true);
    return () => {
      for (const type of events) this.document.removeEventListener?.(type, blockInput, true);
      if (body) body.inert = previousInert;
    };
  }

  async deleteImportedMeasurement(targetPlugin) {
    let unlockInput;
    try {
      await this.measurementStorage.initialize();
      const measurementId = baseMeasurementId(targetPlugin?.measurementId);
      if (!measurementId) return false;
      const measurement = this.measurementStorage.getMeasurementById(measurementId);
      if (measurement?.imported !== true) {
        this.showMessage('Only measurements imported into this extension can be deleted here.', false);
        return false;
      }
      if (!await this.confirmImportedMeasurementDeletion(measurement)) return false;
      // Parameter setters change the visible model before joining the remote queue.
      // Keep editor input locked until both stores and the measurement lists agree.
      unlockInput = this.lockEditorInput();
      await this.audioManager.mutationQueue;
      const mutationGeneration = this.audioManager.mutationGeneration;
      const affected = this.clearDeletedMeasurementReferences(measurementId);
      await (this.audioManager.mutationQueue || Promise.resolve());
      if (mutationGeneration !== undefined &&
          mutationGeneration !== this.audioManager.mutationGeneration) {
        throw new Error('Measurement assignments could not be cleared.');
      }
      let deleted = false;
      try {
        deleted = await this.measurementStorage.deleteMeasurement(measurementId);
      } finally {
        if (!deleted) {
          for (const { plugin, previousParameters } of affected) {
            plugin.setParameters(previousParameters);
          }
          await (this.audioManager.mutationQueue || Promise.resolve());
        }
      }
      if (!deleted) {
        this.showMessage('The imported measurement could not be deleted. Try again.', false);
        return false;
      }
      await this.refreshMeasurementConsumers();
      this.updateImportedDeleteButtons();
      this.showMessage(`Deleted imported measurement “${measurement.name || 'Measurement'}”.`, true,
        TRANSIENT_MESSAGE_DURATION_MS);
      return true;
    } catch (error) {
      console.error('[EffeTune extension] Measurement deletion failed', error);
      this.showMessage('The imported measurement could not be deleted. Try again.', false);
      return false;
    } finally {
      unlockInput?.();
    }
  }

  async exportPreset() {
    try {
      const snapshot = await this.audioManager.request('getState');
      const selectedSnapshot = this.currentSnapshot(snapshot);
      const preset = {
        ...this.pipelineManager.getCurrentPresetData(),
        pipeline: selectedSnapshot.plugins.map(({ id, ...state }) => convertShortToLongFormat(state))
      };
      const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      const safeName = (this.pipelineManager.presetManager.currentPresetName || preset.name || 'EffeTune Preset')
        .replace(/[\\/:*?"<>|]/g, '_');
      link.href = url;
      link.download = `${safeName}.effetune_preset`;
      link.click();
      URL.revokeObjectURL(url);
      this.showMessage('Preset exported.', true, TRANSIENT_MESSAGE_DURATION_MS);
    } catch (error) {
      this.reportError(error, 'The preset could not be exported. Try again.');
    }
  }

  async updateTelemetrySubscription() {
    const enabled = !this.document.hidden;
    try {
      await this.client.request('setTelemetry', { enabled });
    } catch (error) {
      console.error('[EffeTune extension] Telemetry subscription failed', error);
      return;
    }
    // Subscribing clears this editor's Visualizer sources in the session; republish them.
    if (enabled) this.audioManager?.dispatchEvent('dspReady');
  }

  async openSharedVisualizer(encoded) {
    await this.setVisualizerVisible(true);
    await this.visualizerView.importShared(encoded);
  }

  async setVisualizerVisible(visible, options = {}) {
    const revision = this.visualizerRevision = (this.visualizerRevision || 0) + 1;
    if (visible && !this.visualizerView) {
      this.visualizerModulePromise ||= import('../js/visualizer/visualizer-view.js');
      const { VisualizerView } = await this.visualizerModulePromise;
      this.visualizerView ||= new VisualizerView(this.uiManager);
    }
    const view = this.visualizerView;
    if (!view) return;
    await view.initialized;
    if (revision !== this.visualizerRevision) return;
    if (visible) view.show();
    else view.hide(options);
    this.document.body.classList.toggle('view-visualizer', visible);
    this.elements.visualizerButton?.classList.toggle('active', visible);
    this.elements.visualizerButton?.setAttribute('aria-pressed', String(visible));
    if (visible) view.updateVisibility();
  }

}

if (typeof chrome !== 'undefined' && typeof document !== 'undefined') {
  new ExtensionEditor().initialize().catch(error => {
    console.error('[EffeTune extension] Editor initialization failed', error);
    const message = document.getElementById('editorMessage');
    if (message) {
      message.textContent = 'EffeTune could not open the pipeline editor. Close this tab and try again.';
      message.hidden = false;
    }
  });
}
