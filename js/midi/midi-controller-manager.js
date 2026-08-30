import { MidiMappingStore, MIDI_SOURCE_KINDS } from './midi-mapping-store.js';
import { ParamAdapter } from './param-adapter.js';
import { MidiMappingEngine } from './midi-mapping-engine.js';
import { LocalInputSources } from './local-input-sources.js';
import { McuProtocol } from './mcu-protocol.js';
import { AutomationScheduler } from './automation-scheduler.js';

const DUPLICATE_DEVICE_SEPARATOR = '\0';

function createPortSlotRegistry() {
  return {
    slotsById: new Map(),
    slotsByName: new Map(),
    slotsByKey: new Map(),
    slotsByPort: new WeakMap()
  };
}

function portSlot(port, registry) {
  const name = port.name || '';
  const id = typeof port.id === 'string' && port.id ? port.id : null;
  let slot = id ? registry.slotsById.get(id) : registry.slotsByPort.get(port);
  if (!slot || slot.name !== name) {
    const slots = registry.slotsByName.get(name) || [];
    const ordinal = slots.length;
    slot = {
      name,
      key: ordinal === 0 ? name : `${name}${DUPLICATE_DEVICE_SEPARATOR}${ordinal + 1}`
    };
    slots.push(slot);
    registry.slotsByName.set(name, slots);
    registry.slotsByKey.set(slot.key, slot);
    if (id) registry.slotsById.set(id, slot);
  }
  registry.slotsByPort.set(port, slot);
  return slot;
}

function portEntries(portMap, registry) {
  return Array.from(portMap?.values?.() || []).map((port, index) => {
    const slot = portSlot(port, registry);
    return {
      port,
      name: port.name || '',
      key: slot.key,
      index,
      connected: port.state !== 'disconnected'
    };
  });
}

function portList(portMap, registry) {
  return portEntries(portMap, registry).map(({ port, ...entry }) => entry);
}

export class MidiControllerManager {
  constructor({
    windowRef = globalThis.window,
    navigatorRef = globalThis.navigator,
    store,
    adapter,
    engine,
    localInputSources,
    mcuProtocol,
    automationScheduler
  } = {}) {
    this.window = windowRef;
    this.navigator = navigatorRef;
    this.adapter = adapter || new ParamAdapter();
    this.store = store || new MidiMappingStore({
      pluginManager: windowRef?.pluginManager,
      adapter: this.adapter,
      isElectron: Boolean(windowRef?.electronIntegration?.isElectron),
      onPersistenceFailure: () => {
        windowRef?.uiManager?.setError?.('error.controllerMappingSaveFailed', true);
      }
    });
    this.engine = engine || new MidiMappingEngine({ store: this.store, adapter: this.adapter, windowRef });
    this.automationScheduler = automationScheduler || new AutomationScheduler({ engine: this.engine });
    this.localInputs = localInputSources || new LocalInputSources({
      engine: this.engine,
      store: this.store,
      windowRef,
      navigatorRef
    });
    this.mcu = mcuProtocol || new McuProtocol({
      engine: this.engine,
      adapter: this.adapter,
      store: this.store,
      getOutput: key => this.findOutput(key),
      windowRef
    });
    this.midiAccess = null;
    this.midiAccessError = null;
    this.midiRequest = null;
    this.midiStateListening = false;
    this.inputPortSlots = createPortSlotRegistry();
    this.outputPortSlots = createPortSlotRegistry();
    this.dialogOpen = false;
    this.learnActive = false;
    this.learnCallback = null;
    this.disposed = false;
    this.changeListeners = new Set();
    this.handleStateChange = () => {
      if (this.disposed) return;
      this.bindInputs();
      this.mcu.startFeedbackPoller();
      this.emitChange();
    };
    this.unsubscribeStore = this.store.subscribe(() => {
      if (this.disposed) return;
      this.automationScheduler.sync(this.store.mappings);
      void this.syncRuntime();
    });
  }

  async initialize(initialConfig = this.window?.appConfig) {
    if (this.disposed) return this;
    await this.store.initialize(initialConfig);
    if (this.disposed) return this;
    this.automationScheduler.sync(this.store.mappings);
    await this.syncRuntime();
    return this;
  }

  isSupported() {
    return typeof this.navigator?.requestMIDIAccess === 'function';
  }

  listInputs() {
    return portList(this.midiAccess?.inputs, this.inputPortSlots);
  }

  listOutputs() {
    return portList(this.midiAccess?.outputs, this.outputPortSlots);
  }

  listGamepads() {
    return Array.from(this.navigator?.getGamepads?.() || [])
      .filter(gamepad => gamepad && gamepad.connected !== false)
      .map(gamepad => ({ name: gamepad.id, connected: true }));
  }

  getDeviceDisplayName(key) {
    const slot = this.inputPortSlots.slotsByKey.get(key) || this.outputPortSlots.slotsByKey.get(key);
    if (slot) return slot.name;
    return key.split(DUPLICATE_DEVICE_SEPARATOR, 1)[0];
  }

  onChange(listener) {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  emitChange() {
    if (this.disposed) return;
    const state = {
      inputs: this.listInputs(),
      outputs: this.listOutputs(),
      gamepads: this.listGamepads(),
      midiError: this.midiAccessError
    };
    this.changeListeners.forEach(listener => listener(state));
  }

  hasMidiMappings() {
    return this.store.mappings.some(mapping => MIDI_SOURCE_KINDS.has(mapping.source.kind));
  }

  async syncRuntime() {
    if (this.disposed) return;
    this.localInputs.syncSubscriptions(this.store.mappings, {
      dialogOpen: this.dialogOpen || this.learnActive
    });
    const needsMidi = this.hasMidiMappings() || this.learnActive;
    if (needsMidi) await this.ensureMidiAccess();
    if (this.disposed) return;
    this.setMidiRuntimeActive(this.hasMidiMappings() || this.learnActive);
    this.mcu.startFeedbackPoller();
    this.emitChange();
  }

  async ensureMidiAccess() {
    if (this.disposed) return null;
    if (!this.isSupported() || this.midiAccess) return this.midiAccess;
    if (this.midiRequest) return this.midiRequest;
    this.midiRequest = this.navigator.requestMIDIAccess({ sysex: false })
      .then(access => {
        if (this.disposed) return null;
        this.midiAccess = access;
        this.midiAccessError = null;
        return access;
      })
      .catch(error => {
        if (this.disposed) return null;
        this.midiAccessError = error;
        console.warn('MIDI access is unavailable. Controller mappings remain saved.');
        return null;
      })
      .finally(() => {
        this.midiRequest = null;
        if (!this.disposed) this.emitChange();
      });
    return this.midiRequest;
  }

  bindInputs() {
    if (this.disposed || !this.midiAccess) return;
    const inputs = portEntries(this.midiAccess.inputs, this.inputPortSlots);
    portEntries(this.midiAccess.outputs, this.outputPortSlots);
    for (const { port: input } of inputs) {
      input.onmidimessage = event => this.onMidiMessage(input, event);
    }
  }

  setMidiRuntimeActive(active) {
    if (!this.midiAccess) return;
    if (active) {
      if (this.disposed) return;
      if (!this.midiStateListening) {
        this.midiAccess.addEventListener?.('statechange', this.handleStateChange);
        if (!this.midiAccess.addEventListener) this.midiAccess.onstatechange = this.handleStateChange;
        this.midiStateListening = true;
      }
      this.bindInputs();
      return;
    }
    if (this.midiStateListening) {
      this.midiAccess.removeEventListener?.('statechange', this.handleStateChange);
      if (this.midiAccess.onstatechange === this.handleStateChange) this.midiAccess.onstatechange = null;
      this.midiStateListening = false;
    }
    for (const input of this.midiAccess.inputs.values()) input.onmidimessage = null;
  }

  parseGenericMessage(data) {
    if (!data || data.length < 2 || data[0] >= 0xf8) return null;
    const type = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    if (type === 0xb0 && data.length >= 3) {
      return { source: { kind: 'cc', channel, number: data[1] }, value: data[2] };
    }
    if ((type === 0x90 || type === 0x80) && data.length >= 3) {
      const pressed = type === 0x90 && data[2] > 0;
      return {
        source: { kind: 'note', channel, number: data[1] },
        value: { pressed, velocity: data[2] }
      };
    }
    if (type === 0xe0 && data.length >= 3) {
      return {
        source: { kind: 'pitchbend', channel },
        value: (data[2] << 7) | data[1]
      };
    }
    return null;
  }

  onMidiMessage(input, event) {
    if (this.disposed) return;
    const deviceKey = portEntries(this.midiAccess?.inputs, this.inputPortSlots)
      .find(entry => entry.port === input)?.key ?? (input.name || '');
    const protocol = this.store.getDeviceProtocol(deviceKey);
    const decoded = protocol === 'mcu'
      ? this.mcu.decode(event.data)
      : this.parseGenericMessage(event.data);
    if (!decoded) return;
    if (this.learnActive) {
      if (protocol !== 'mcu' || decoded.kind !== 'mcuTouch') {
        const source = protocol === 'mcu'
          ? {
              kind: decoded.kind,
              channel: decoded.channel || 0,
              number: decoded.number || 0,
              ...(decoded.delta !== undefined ? { delta: decoded.delta } : {})
            }
          : decoded.source;
        const value = protocol === 'mcu'
          ? (decoded.pressed !== undefined ? { pressed: decoded.pressed } : decoded.value ?? decoded.delta)
          : decoded.value;
        this.captureMidiLearn(deviceKey, source, value, protocol);
      }
      return;
    }
    if (protocol === 'mcu') {
      if (decoded.kind === 'mcuTouch') {
        this.mcu.setTouched(deviceKey, decoded.channel, decoded.pressed);
        return;
      }
      const source = {
        kind: decoded.kind,
        channel: decoded.channel || 0,
        number: decoded.number || 0,
        ...(decoded.delta !== undefined ? { delta: decoded.delta } : {})
      };
      if (this.mcu.shouldIgnoreInput(deviceKey, source)) return;
      const value = decoded.pressed !== undefined
        ? { pressed: decoded.pressed }
        : decoded.value ?? decoded.delta;
      this.engine.onSourceEvent(deviceKey, source, value);
      return;
    }
    this.engine.onSourceEvent(deviceKey, decoded.source, decoded.value);
  }

  captureMidiLearn(deviceKey, source, value, protocol) {
    if (!this.learnCallback) return false;
    if (source.kind === 'note' && !value?.pressed) return false;
    if (source.kind === 'mcuButton' && !value?.pressed) return false;
    if (source.kind === 'mcuButton' && source.number >= 104 && source.number <= 112) return false;
    const callback = this.learnCallback;
    this.cancelLearn();
    callback({ device: deviceKey, source: { ...source }, protocol });
    return true;
  }

  async startLearn(callback) {
    if (this.disposed) return;
    this.cancelLearn();
    this.learnActive = true;
    this.learnCallback = result => {
      const activeCallback = callback;
      this.cancelLearn();
      activeCallback(result);
    };
    this.localInputs.startLearn(this.learnCallback, () => {
      this.cancelLearn();
      this.emitChange();
    });
    await this.syncRuntime();
  }

  cancelLearn() {
    this.learnCallback = null;
    this.learnActive = false;
    this.localInputs.cancelLearn();
    if (!this.disposed) {
      this.localInputs.syncSubscriptions(this.store.mappings, { dialogOpen: this.dialogOpen });
    }
  }

  async setDialogOpen(open) {
    if (this.disposed) return;
    this.dialogOpen = Boolean(open);
    if (!open) this.cancelLearn();
    await this.syncRuntime();
  }

  async setDeviceProtocol(key, protocol) {
    return this.store.setDeviceProtocol(key, protocol);
  }

  findOutput(key) {
    if (!this.midiAccess) return null;
    return portEntries(this.midiAccess.outputs, this.outputPortSlots).find(entry =>
      entry.key === key && entry.connected
    )?.port || null;
  }

  async openDialog() {
    const { MidiMappingDialog } = await import('./midi-mapping-dialog.js');
    if (!this.dialog) this.dialog = new MidiMappingDialog({ manager: this, windowRef: this.window });
    return this.dialog.open();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelLearn();
    this.unsubscribeStore?.();
    this.automationScheduler.dispose();
    this.localInputs.dispose();
    this.engine.dispose();
    this.mcu.dispose();
    if (this.midiAccess) {
      this.setMidiRuntimeActive(false);
    }
    this.changeListeners.clear();
  }
}
