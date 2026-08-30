const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);
const DEAD_ZONE = 0.15;
const HOLD_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 1000 / 30;

export const KNOWN_APP_SHORTCUTS = Object.freeze(new Set([
  'Ctrl+Z', 'Meta+Z', 'Ctrl+Y', 'Meta+Y', 'Ctrl+S', 'Meta+S',
  'Ctrl+A', 'Meta+A', 'Ctrl+X', 'Meta+X', 'Ctrl+C', 'Meta+C',
  'Ctrl+V', 'Meta+V', 'Ctrl+L', 'Meta+L', 'Ctrl+F', 'Meta+F',
  'Delete', 'Escape', 'F1', 'T', 'A', 'B', 'X', '/', 'Space', ',', '.',
  'N', 'P', 'F', 'R', 'ArrowRight', 'ArrowLeft',
  'Ctrl+ArrowRight', 'Ctrl+Shift+ArrowRight', 'Shift+ArrowRight',
  'Ctrl+ArrowLeft', 'Ctrl+Shift+ArrowLeft', 'Shift+ArrowLeft',
  'Shift+F', 'Shift+R', 'Shift+.', 'Shift+,', 'Ctrl+H', 'Ctrl+M'
]));

function normalizedKeyName(key) {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function keyComboFromEvent(event) {
  if (!event || MODIFIER_KEYS.has(event.key)) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(normalizedKeyName(event.key));
  return parts.join('+');
}

export function isTextEditingTarget(target) {
  const tagName = String(target?.tagName || '').toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
    target?.isContentEditable === true || target?.closest?.('[contenteditable="true"]');
}

function applyDeadZone(value) {
  const numeric = Number(value) || 0;
  const magnitude = Math.abs(numeric);
  if (magnitude <= DEAD_ZONE) return 0;
  return Math.sign(numeric) * ((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE));
}

export class LocalInputSources {
  constructor({
    engine,
    store,
    windowRef = globalThis.window,
    navigatorRef = globalThis.navigator,
    now = () => globalThis.performance?.now?.() ?? Date.now()
  } = {}) {
    this.engine = engine;
    this.store = store;
    this.window = windowRef;
    this.navigator = navigatorRef;
    this.now = now;
    this.keyListening = false;
    this.gamepadListening = false;
    this.gamepadEnabled = false;
    this.dialogOpen = false;
    this.learnCallback = null;
    this.learnCancelCallback = null;
    this.learnAxisSnapshot = new Map();
    this.pressedKeys = new Map();
    this.gamepadStates = new Map();
    this.connectedGamepads = new Set();
    this.handleKeyDown = event => this.onKey(event, true);
    this.handleKeyUp = event => this.onKey(event, false);
    this.handleBlur = () => this.releaseAll();
    this.handleGamepadConnected = event => {
      if (event.gamepad?.id) this.connectedGamepads.add(event.gamepad.id);
      this.syncContinuousFrame();
    };
    this.handleGamepadDisconnected = event => {
      if (event.gamepad?.id) this.releaseGamepad(event.gamepad.id);
      this.connectedGamepads.delete(event.gamepad?.id);
      this.syncContinuousFrame();
    };
    this.engine?.setGamepadPoller?.(this);
  }

  syncSubscriptions(mappings = this.store?.mappings || [], { dialogOpen = false } = {}) {
    this.dialogOpen = Boolean(dialogOpen);
    const needsKeys = dialogOpen || mappings.some(mapping => mapping.source.kind === 'key');
    const needsGamepad = dialogOpen || mappings.some(mapping =>
      mapping.source.kind === 'gamepadButton' || mapping.source.kind === 'gamepadAxis'
    );
    if (needsKeys !== this.keyListening) {
      const method = needsKeys ? 'addEventListener' : 'removeEventListener';
      this.window?.[method]?.('keydown', this.handleKeyDown, true);
      this.window?.[method]?.('keyup', this.handleKeyUp, true);
      this.window?.[method]?.('blur', this.handleBlur);
      this.keyListening = needsKeys;
    }
    if (needsGamepad !== this.gamepadListening) {
      const method = needsGamepad ? 'addEventListener' : 'removeEventListener';
      this.window?.[method]?.('gamepadconnected', this.handleGamepadConnected);
      this.window?.[method]?.('gamepaddisconnected', this.handleGamepadDisconnected);
      this.gamepadListening = needsGamepad;
    }
    this.gamepadEnabled = needsGamepad;
    this.refreshConnectedGamepads();
    this.syncContinuousFrame();
  }

  refreshConnectedGamepads() {
    if (!this.gamepadEnabled || typeof this.navigator?.getGamepads !== 'function') return;
    this.connectedGamepads.clear();
    for (const gamepad of this.navigator.getGamepads() || []) {
      if (gamepad?.connected !== false && gamepad?.id) this.connectedGamepads.add(gamepad.id);
    }
  }

  syncContinuousFrame() {
    this.engine?.setContinuousFrame?.(this.gamepadEnabled && this.connectedGamepads.size > 0);
  }

  onKey(event, pressed) {
    const physicalKey = event.code || event.key;
    const heldSource = !pressed ? this.pressedKeys.get(physicalKey) : null;
    if (!pressed && heldSource) {
      this.pressedKeys.delete(physicalKey);
      const matched = this.engine?.onSourceEvent?.('', heldSource, { pressed: false, repeat: false });
      if (matched) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
      return;
    }
    if (isTextEditingTarget(event.target || this.window?.document?.activeElement)) return;
    const keyCombo = keyComboFromEvent(event);
    if (!keyCombo) return;
    if (pressed && keyCombo === 'Escape' && this.learnCallback) {
      const cancel = this.learnCancelCallback;
      this.cancelLearn();
      cancel?.();
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return;
    }
    if (this.learnCallback) {
      if (pressed && !event.repeat) {
        const callback = this.learnCallback;
        this.cancelLearn();
        callback({
          device: '',
          source: { kind: 'key', keyCombo },
          shortcutConflict: KNOWN_APP_SHORTCUTS.has(keyCombo)
        });
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
      }
      return;
    }
    const source = { kind: 'key', keyCombo };
    const matched = this.engine?.onSourceEvent?.('', source, {
      pressed,
      repeat: Boolean(event.repeat)
    });
    if (pressed && !event.repeat) this.pressedKeys.set(physicalKey, source);
    if (matched) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    }
  }

  startLearn(callback, cancelCallback = null) {
    this.learnCallback = callback;
    this.learnCancelCallback = cancelCallback;
    this.learnAxisSnapshot.clear();
    for (const gamepad of this.navigator?.getGamepads?.() || []) {
      if (!gamepad) continue;
      gamepad.axes?.forEach((value, index) => {
        this.learnAxisSnapshot.set(`${gamepad.index}:${index}`, Number(value) || 0);
      });
    }
  }

  cancelLearn() {
    this.learnCallback = null;
    this.learnCancelCallback = null;
    this.learnAxisSnapshot.clear();
  }

  pollGamepads() {
    if (!this.gamepadEnabled || typeof this.navigator?.getGamepads !== 'function') return;
    if (this.learnCallback) {
      this.pollGamepadsForLearn();
      return;
    }
    const time = this.now();
    for (const gamepad of this.navigator.getGamepads() || []) {
      if (!gamepad || gamepad.connected === false) continue;
      this.connectedGamepads.add(gamepad.id);
      let state = this.gamepadStates.get(gamepad.index);
      if (state && state.id !== gamepad.id) {
        this.releaseGamepad(state.id);
        state = null;
      }
      state ||= { id: gamepad.id, buttons: [], axes: [] };
      gamepad.buttons?.forEach((button, index) => {
        const pressed = Boolean(button?.pressed);
        const previous = state.buttons[index] || { pressed: false, downAt: 0, repeatedAt: 0 };
        if (pressed !== previous.pressed) {
          this.engine?.onSourceEvent?.(gamepad.id, { kind: 'gamepadButton', number: index }, {
            pressed,
            repeat: false
          });
          previous.pressed = pressed;
          previous.downAt = pressed ? time : 0;
          previous.repeatedAt = pressed ? time : 0;
        } else if (pressed && time - previous.downAt >= HOLD_DELAY_MS &&
                   time - previous.repeatedAt >= REPEAT_INTERVAL_MS) {
          previous.repeatedAt = time;
          this.engine?.onSourceEvent?.(gamepad.id, { kind: 'gamepadButton', number: index }, {
            pressed: true,
            repeat: true
          });
        }
        state.buttons[index] = previous;
      });
      gamepad.axes?.forEach((value, index) => {
        const numeric = Number(value) || 0;
        const mappings = (this.store?.mappings || []).filter(mapping =>
          mapping.device === gamepad.id && mapping.source.kind === 'gamepadAxis' &&
          mapping.source.number === index
        );
        if (mappings.length > 0) {
          const modes = new Set(mappings.map(mapping => mapping.source.mode || 'rel'));
          if (modes.has('rel')) {
            const delta = applyDeadZone(numeric);
            this.engine?.onSourceEvent?.(
              gamepad.id,
              { kind: 'gamepadAxis', number: index, mode: 'rel', delta },
              delta
            );
          }
          if (modes.has('abs')) {
            const absolute = Math.abs(numeric) <= DEAD_ZONE ? 0 : numeric;
            this.engine?.onSourceEvent?.(
              gamepad.id,
              { kind: 'gamepadAxis', number: index, mode: 'abs' },
              absolute
            );
          }
        }
        state.axes[index] = numeric;
      });
      this.gamepadStates.set(gamepad.index, state);
    }
  }

  pollGamepadsForLearn() {
    for (const gamepad of this.navigator.getGamepads() || []) {
      if (!gamepad || gamepad.connected === false) continue;
      const buttonIndex = gamepad.buttons?.findIndex(button => Boolean(button?.pressed)) ?? -1;
      if (buttonIndex >= 0) {
        this.finishGamepadLearn(gamepad.id, { kind: 'gamepadButton', number: buttonIndex });
        return;
      }
      for (let index = 0; index < (gamepad.axes?.length || 0); index++) {
        const numeric = Number(gamepad.axes[index]) || 0;
        const baseline = this.learnAxisSnapshot.get(`${gamepad.index}:${index}`) ?? numeric;
        if (Math.abs(numeric - baseline) >= 0.5) {
          this.finishGamepadLearn(gamepad.id, { kind: 'gamepadAxis', number: index, mode: 'rel' });
          return;
        }
      }
    }
  }

  finishGamepadLearn(device, source) {
    const callback = this.learnCallback;
    this.cancelLearn();
    callback?.({ device, source });
  }

  releaseGamepad(gamepadId) {
    for (const [index, state] of this.gamepadStates) {
      if (state.id !== gamepadId) continue;
      state.buttons.forEach((button, number) => {
        if (button?.pressed) {
          this.engine?.onSourceEvent?.(gamepadId, { kind: 'gamepadButton', number }, {
            pressed: false,
            repeat: false
          });
        }
      });
      this.gamepadStates.delete(index);
    }
  }

  releaseAll() {
    for (const [, source] of this.pressedKeys) {
      this.engine?.onSourceEvent?.('', source, { pressed: false, repeat: false });
    }
    this.pressedKeys.clear();
    const gamepadIds = new Set(Array.from(this.gamepadStates.values(), state => state.id));
    for (const gamepadId of gamepadIds) this.releaseGamepad(gamepadId);
  }

  dispose() {
    this.releaseAll();
    if (this.keyListening) this.syncSubscriptions([], { dialogOpen: false });
    if (this.gamepadListening) {
      this.window?.removeEventListener?.('gamepadconnected', this.handleGamepadConnected);
      this.window?.removeEventListener?.('gamepaddisconnected', this.handleGamepadDisconnected);
      this.gamepadListening = false;
    }
    this.engine?.setContinuousFrame?.(false);
  }
}
