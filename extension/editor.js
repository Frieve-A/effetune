import { ExtensionClient } from './protocol.js';
import { ExtensionIrLibraryClient } from './ir-library.js';
import { initializePluginModel, serializePipeline } from './model.js';
import { PipelineManager } from '../js/ui/pipeline-manager.js';
import { PluginListManager } from '../js/ui/plugin-list-manager.js';
import { TelemetryHub } from '../js/audio/telemetry-hub.js';
import { installRangeFillStyling } from '../js/ui/range-fill.js';
import { applySerializedState, getSerializablePluginStateShort, convertShortToLongFormat } from '../js/utils/serialization-utils.js';
import dataStorage, { MeasurementImportError } from '../features/measurement/dataStorage.js';

const MAXIMUM_MEASUREMENT_IMPORT_BYTES = 128 * 1024 * 1024;
const TRANSIENT_MESSAGE_DURATION_MS = 3000;
const VIRTUAL_MEASUREMENT_CHANNEL_SEPARATOR = '::ch=';

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

export function createUiManager(translations, showMessage, hideMessage) {
  return {
    translations,
    englishTranslations: translations,
    expandedPlugins: new Set(),
    layoutMode: { isMobile: false },
    debugChannelCount: 2,
    t(key, params = {}) {
      return substitute(translations[key] || key, params);
    },
    updateURL() {},
    updatePipelineToggleButton() {},
    clearError() { hideMessage(); },
    isDoubleBlindActive() { return false; },
    getLocalizedDocPath(path) { return path; },
    showTransientMessage(key, isError = false, params = {}, duration = 3000) {
      const fallback = isError ? 'Something went wrong. Try again.' : 'Pipeline updated.';
      showMessage(substitute(translations[key] || fallback, params), !isError, duration);
    },
    setError(key, isError = false, params = {}) {
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
  }

  get pipeline() { return this.pipelineA; }
  set pipeline(plugins) { this.pipelineA = plugins; }
  getCurrentPipeline() { return this.pipelineA; }
  updateCurrentPipeline(plugins) { this.pipelineA = plugins; }
  getActivePowerWorklets() { return [this.workletNode]; }
  incrementPowerDiagnostic() {}
  syncPrimaryWasmAssetMembership() {}
  notifyPipelineAnalysisInvalidated() {}
  rebuildPipeline() {}
  dispatchEvent() {}

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
    // File preparation reserves its place immediately; ordinary payloads are
    // captured now so subsequent local edits cannot change the queued intent.
    const payload = typeof args === 'function' ? args : structuredClone(args);
    return this.enqueue(async () => this.client.request(command,
      typeof payload === 'function' ? await payload() : payload));
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
      settingsMenuButton: this.document.getElementById('editorSettingsMenuButton'),
      settingsMenu: this.document.getElementById('editorSettingsMenu'),
      importMeasurement: this.document.getElementById('editorImportMeasurement'),
      deleteMeasurement: this.document.getElementById('editorDeleteMeasurement'),
      measurementFile: this.document.getElementById('editorMeasurementFile'),
      importPreset: this.document.getElementById('editorImportPreset'),
      exportPreset: this.document.getElementById('editorExportPreset'),
      presetFile: this.document.getElementById('editorPresetFile'),
      undo: this.document.getElementById('undoButton'),
      redo: this.document.getElementById('redoButton'),
      message: this.document.getElementById('editorMessage')
    };

    const [snapshot, translations, model] = await Promise.all([
      this.client.connect(),
      loadEnglishTranslations(),
      initializePluginModel()
    ]);
    this.snapshot = snapshot;
    window.irLibraryService = new ExtensionIrLibraryClient(this.client);
    await window.irLibraryService.refresh();
    this.pluginManager = normalizeModelResult(model);
    keepExtensionEffects(this.pluginManager);
    const createPlugin = this.pluginManager.createPlugin.bind(this.pluginManager);
    this.pluginManager.createPlugin = name => {
      const plugin = createPlugin(name);
      plugin.setWasmAssetTargetResolver?.(() => []);
      return plugin;
    };
    this.uiManager = createUiManager(
      translations,
      (text, success, duration) => this.showMessage(text, success, duration),
      () => this.hideMessage()
    );
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
    this.pluginListManager.initPluginList();
    this.pipelineManager.initDragAndDrop();
    this.rangeFillController.refresh();
    this.collapseEffectListAtNarrowWidth();
    this.pipelineManager.historyManager.saveState();
    await this.updateTelemetrySubscription();
    return this;
  }

  bindEvents() {
    this.client.addEventListener('state', event => this.restoreSnapshot(event.detail));
    this.client.addEventListener('workletMessage', event => {
      this.audioManager.telemetryHub.handleMessage(event.detail);
      this.audioManager.workletPort.deliver(event.detail);
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
    this.elements.deleteMeasurement.addEventListener('click', () => {
      this.closeSettingsMenu();
      void this.deleteImportedMeasurement();
    });
    this.elements.importPreset.addEventListener('click', () => {
      this.closeSettingsMenu();
      this.elements.presetFile.click();
    });
    this.elements.presetFile.addEventListener('change', event => this.importPresetFile(event));
    this.elements.exportPreset.addEventListener('click', () => {
      this.closeSettingsMenu();
      void this.exportPreset();
    });
    this.elements.undo.addEventListener('click', () => this.pipelineManager.undo());
    this.elements.redo.addEventListener('click', () => this.pipelineManager.redo());
    this.document.addEventListener('visibilitychange', () => this.updateTelemetrySubscription());
    this.document.addEventListener('click', event => {
      if (event?.target === this.elements.settingsMenuButton || event?.target === this.elements.settingsMenu) return;
      this.closeSettingsMenu();
    });
    this.document.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.closeSettingsMenu();
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
    this.audioManager.workletNode.context.sampleRate = snapshot.sampleRate || 48000;
    this.pipelineManager.core.enabled = !this.audioManager.masterBypass;
    this.pipelineManager.core.masterToggle?.classList.toggle('off', this.audioManager.masterBypass);
    this.pipelineManager.core.updateAllPluginDisplayState?.();
  }

  restoreSnapshot(snapshot, force = false) {
    if (!snapshot || (this.snapshot && snapshot.revision < this.snapshot.revision)) return;
    const rebuild = force || !this.pipelineMatches(snapshot);
    this.snapshot = snapshot;
    this.syncRuntimeState(snapshot);
    this.renderSession();
    if (!force && this.audioManager.pendingMutations > 0) return;
    if (!rebuild) return;

    this.audioManager.suppressMutations = true;
    try {
      for (const plugin of this.audioManager.pipeline) plugin.cleanup?.();
      const plugins = (snapshot.plugins || []).map(state => {
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
      this.pipelineManager.historyManager.saveState();
    } finally {
      this.audioManager.suppressMutations = false;
    }
  }

  renderSession() {
    const snapshot = this.snapshot;
    this.elements.target.textContent = snapshot.target?.title || 'No tab selected';
    this.elements.target.title = snapshot.target?.title || '';
    this.elements.status.textContent = STATUS_LABELS[snapshot.status] || STATUS_LABELS.error;
    this.elements.status.className = `editor-status ${snapshot.status === 'processing' ? 'processing' : snapshot.status === 'error' ? 'error' : ''}`.trim();
    this.elements.sampleRate.textContent = snapshot.sampleRate ? `${snapshot.sampleRate.toLocaleString()} Hz` : '';
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

  confirmImportedMeasurementDeletion(measurements) {
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
      description.textContent = 'Select an imported measurement to delete. Any Room EQ or Crosstalk Cancellation assignment that uses it will be cleared.';
      const select = this.document.createElement('select');
      select.setAttribute('aria-label', 'Imported measurement');
      for (const measurement of measurements) {
        const option = this.document.createElement('option');
        option.value = measurement.id;
        option.textContent = measurement.name || 'Measurement';
        select.appendChild(option);
      }
      const buttons = this.document.createElement('div');
      buttons.className = 'dialog-buttons';
      const cancel = this.document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      const confirm = this.document.createElement('button');
      confirm.type = 'button';
      confirm.textContent = 'Delete';
      buttons.append(cancel, confirm);
      dialog.append(title, description, select, buttons);
      overlay.appendChild(dialog);

      let finished = false;
      const finish = measurementId => {
        if (finished) return;
        finished = true;
        this.document.removeEventListener('keydown', handleKeyDown);
        overlay.remove();
        resolve(measurementId);
      };
      const handleKeyDown = event => {
        if (event.key === 'Escape') finish(null);
      };
      cancel.addEventListener('click', () => finish(null));
      confirm.addEventListener('click', () => finish(select.value));
      this.document.addEventListener('keydown', handleKeyDown);
      this.document.body.appendChild(overlay);
      select.focus();
    });
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

  async deleteImportedMeasurement() {
    this.elements.deleteMeasurement.disabled = true;
    try {
      await this.measurementStorage.initialize();
      const measurements = this.measurementStorage.getAllMeasurements()
        .filter(measurement => measurement?.imported === true);
      if (measurements.length === 0) {
        this.showMessage('There are no imported measurements to delete.', true, TRANSIENT_MESSAGE_DURATION_MS);
        return false;
      }
      const measurementId = await this.confirmImportedMeasurementDeletion(measurements);
      if (!measurementId) return false;
      const measurement = this.measurementStorage.getMeasurementById(measurementId);
      if (measurement?.imported !== true) {
        this.showMessage('That imported measurement is no longer available.', false);
        return false;
      }
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
      this.showMessage(`Deleted imported measurement “${measurement.name || 'Measurement'}”.`, true,
        TRANSIENT_MESSAGE_DURATION_MS);
      return true;
    } catch (error) {
      console.error('[EffeTune extension] Measurement deletion failed', error);
      this.showMessage('The imported measurement could not be deleted. Try again.', false);
      return false;
    } finally {
      this.elements.deleteMeasurement.disabled = false;
    }
  }

  async exportPreset() {
    try {
      const snapshot = await this.audioManager.request('getState');
      const preset = {
        ...this.pipelineManager.getCurrentPresetData(),
        pipeline: snapshot.plugins.map(({ id, ...state }) => convertShortToLongFormat(state))
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

  updateTelemetrySubscription() {
    return this.client.request('setTelemetry', { enabled: !this.document.hidden })
      .catch(error => console.error('[EffeTune extension] Telemetry subscription failed', error));
  }

  collapseEffectListAtNarrowWidth() {
    const media = window.matchMedia?.('(max-width: 980px)');
    const collapse = () => {
      const manager = this.pluginListManager?.collapseManager;
      if (media?.matches && manager && !manager.isCollapsed) manager.togglePluginListCollapse();
    };
    collapse();
    media?.addEventListener?.('change', collapse);
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
