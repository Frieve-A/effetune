import {
  defaultAutomationAmount,
  defaultMapRange,
  getAssignableDescriptors,
  getTargetValueRange,
  isNumericTargetRange
} from './param-adapter.js';
import { MAX_TIMER_DELAY_MS } from './midi-mapping-store.js';
import {
  closeStandardSelect,
  enableStandardSelect,
  isStandardSelectOpen
} from '../ui/standard-select.js';

const BUTTON_SOURCE_KINDS = new Set(['note', 'mcuButton', 'key', 'gamepadButton']);
const VIRTUAL_SOURCE_KINDS = new Set(['clock', 'timer']);

function padTimePart(value) {
  return String(value).padStart(2, '0');
}

function localDateValue(date) {
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}`;
}

function timeValue(source) {
  return `${padTimePart(source.hour)}:${padTimePart(source.minute)}:${padTimePart(source.second)}`;
}

function parseTimeValue(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3]) };
}

function timerSchedule(source) {
  return source.schedule || 'interval';
}

function sourceKey(device, source) {
  return [device, source.kind, source.channel || 0, source.number || 0, source.keyCombo || ''].join(':');
}

function sourceLabel(mapping, format) {
  const source = mapping.source;
  if (source.kind === 'clock') {
    return format('midi.source.clock', 'Clock: {component}, {shape}', {
      component: format(`midi.clock.component.${source.component}`, source.component),
      shape: format(`midi.clock.shape.${source.shape}`, source.shape)
    });
  }
  if (source.kind === 'timer') {
    const schedule = timerSchedule(source);
    if (schedule === 'once') {
      return format('midi.source.timer.once', 'Timer: once on {date} at {time}', {
        date: source.date,
        time: timeValue(source)
      });
    }
    if (schedule === 'daily') {
      return format('midi.source.timer.daily', 'Timer: daily at {time}', {
        time: timeValue(source)
      });
    }
    return format('midi.source.timer.interval', 'Timer: every {seconds} s', {
      seconds: source.intervalMs / 1000
    });
  }
  if (source.kind === 'key') return format('midi.source.key', 'Key {key}', { key: source.keyCombo });
  if (source.kind === 'gamepadButton') return format('midi.source.gamepadButton', 'Gamepad button {number}', { number: source.number + 1 });
  if (source.kind === 'gamepadAxis') return format('midi.source.gamepadAxis', 'Gamepad axis {number} ({mode})', {
    number: source.number + 1,
    mode: format(`midi.mode.${source.mode}`, source.mode)
  });
  if (source.kind === 'pitchbend') return format('midi.source.pitchbend', 'Pitch bend ch {channel}', { channel: source.channel + 1 });
  if (source.kind === 'mcuFader') return format('midi.source.mcuFader', 'MCU fader {channel}', { channel: source.channel + 1 });
  if (source.kind === 'mcuVpot') return format('midi.source.mcuVpot', 'MCU V-Pot {number}', { number: source.number + 1 });
  if (source.kind === 'mcuButton') return format('midi.source.mcuButton', 'MCU button {number}', { number: source.number });
  return format('midi.source.midi', '{kind} {number} ch {channel}', {
    kind: source.kind.toUpperCase(), number: source.number, channel: source.channel + 1
  });
}

function createElement(documentRef, tag, className, text) {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export class MidiMappingDialog {
  constructor({ manager, windowRef = globalThis.window, nowDate = () => new Date() } = {}) {
    this.manager = manager;
    this.window = windowRef;
    this.document = windowRef.document;
    this.nowDate = nowDate;
    this.overlay = null;
    this.status = null;
    this.content = null;
    this.pendingConflict = null;
    this.removeManagerListener = null;
  }

  t(key, fallback) {
    const translated = this.window.uiManager?.t?.(key);
    return translated && translated !== key ? translated : fallback;
  }

  format(key, fallback, values = {}) {
    return this.t(key, fallback).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  }

  createSelect() {
    return enableStandardSelect(createElement(this.document, 'select', 'config-select'));
  }

  async open() {
    if (this.overlay) return this.overlay;
    await this.manager.setDialogOpen(true);
    this.overlay = createElement(this.document, 'div', 'library-dialog-backdrop');
    const dialog = createElement(
      this.document,
      'div',
      'library-properties-dialog library-properties-dialog-scrollable midi-mapping-dialog'
    );
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'midi-mapping-title');
    const header = createElement(this.document, 'div', 'library-properties-head');
    const title = createElement(
      this.document,
      'h2',
      '',
      this.t('midi.title', 'Controller Mapping Settings')
    );
    title.id = 'midi-mapping-title';
    header.appendChild(title);
    this.status = createElement(this.document, 'div', 'library-status midi-mapping-status');
    this.status.setAttribute('role', 'status');
    this.content = createElement(this.document, 'div', 'library-properties-body midi-mapping-content');
    const footer = createElement(this.document, 'div', 'library-properties-head');
    footer.appendChild(createElement(this.document, 'span', '', ''));
    const close = createElement(this.document, 'button', 'library-button', this.t('midi.close', 'Close'));
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    footer.appendChild(close);
    dialog.append(header, this.status, this.content, footer);
    this.overlay.appendChild(dialog);
    this.document.body.appendChild(this.overlay);
    this.handleKeyDown = event => {
      if (event.key === 'Escape') {
        if (isStandardSelectOpen(this.document)) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.manager.learnActive) {
          this.manager.cancelLearn();
          this.setStatus('');
        } else {
          this.close();
        }
      }
    };
    this.document.addEventListener('keydown', this.handleKeyDown, true);
    this.removeManagerListener = this.manager.onChange(() => {
      if (!this.manager.learnActive && !this.pendingConflict) this.setStatus('');
      this.render();
    });
    this.render();
    return this.overlay;
  }

  async close() {
    if (!this.overlay) return;
    closeStandardSelect(this.document);
    this.manager.cancelLearn();
    await this.manager.setDialogOpen(false);
    this.removeManagerListener?.();
    this.removeManagerListener = null;
    this.document.removeEventListener('keydown', this.handleKeyDown, true);
    this.overlay.remove();
    this.overlay = null;
  }

  setStatus(message, warning = false) {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.classList.toggle('warning', warning);
  }

  async startLearn() {
    this.pendingConflict = null;
    this.setStatus(this.t(
      'midi.learnPrompt',
      'Move a control, press a key, or use a gamepad control. Press Escape to cancel.'
    ));
    await this.manager.startLearn(result => this.finishLearn(result));
  }

  finishLearn(result) {
    const conflicts = this.manager.store.mappings.filter(mapping =>
      sourceKey(mapping.device, mapping.source) === sourceKey(result.device, result.source)
    );
    if (conflicts.length > 0) {
      this.pendingConflict = { result, conflicts };
      this.renderConflict();
      return;
    }
    void this.addLearnedMapping(result);
  }

  renderConflict() {
    this.status.replaceChildren();
    this.status.classList.add('warning');
    this.status.appendChild(createElement(
      this.document,
      'span',
      '',
      this.t('midi.conflict', 'This control is already mapped. ')
    ));
    const replace = createElement(this.document, 'button', 'library-button', this.t('midi.conflictReplace', 'Replace'));
    const add = createElement(this.document, 'button', 'library-button', this.t('midi.conflictAdd', 'Add'));
    const cancel = createElement(this.document, 'button', 'library-button', this.t('midi.cancel', 'Cancel'));
    replace.addEventListener('click', async () => {
      const pending = this.pendingConflict;
      this.pendingConflict = null;
      for (const mapping of pending.conflicts) await this.manager.store.removeMapping(mapping.id);
      await this.addLearnedMapping(pending.result);
    });
    add.addEventListener('click', () => {
      const pending = this.pendingConflict;
      this.pendingConflict = null;
      void this.addLearnedMapping(pending.result);
    });
    cancel.addEventListener('click', () => {
      this.pendingConflict = null;
      this.setStatus('');
    });
    this.status.append(replace, add, cancel);
  }

  defaultTarget() {
    const pipeline = this.window.audioManager?.pipeline || [];
    const plugin = pipeline.find(candidate => candidate?.constructor?.name);
    if (plugin) {
      const type = plugin.constructor.name;
      const descriptor = getAssignableDescriptors(type, this.manager.adapter)[0];
      return {
        type,
        instance: 'first',
        param: descriptor?.key || '_enabled',
        element: descriptor?.element || 0
      };
    }
    return { type: '_global', instance: 'first', param: 'masterBypass', element: 0 };
  }

  defaultAutomationTarget() {
    const pipelineTypes = (this.window.audioManager?.pipeline || [])
      .map(plugin => plugin?.constructor?.name)
      .filter(Boolean);
    const types = [...pipelineTypes, ...this.pluginTypes().map(plugin => plugin.type)];
    for (const type of new Set(types)) {
      const descriptor = getAssignableDescriptors(type, this.manager.adapter).find(candidate =>
        isNumericTargetRange(candidate)
      );
      if (descriptor) {
        return { type, instance: 'first', param: descriptor.key, element: descriptor.element || 0 };
      }
    }
    return null;
  }

  resetMapForTarget(target) {
    const range = getTargetValueRange(target, this.manager.adapter);
    return {
      ...defaultMapRange(target, this.manager.adapter),
      amount: defaultAutomationAmount(range),
      ...(!isNumericTargetRange(range) ? { behavior: 'direct' } : {})
    };
  }

  defaultTimerSource(schedule = 'interval') {
    if (schedule === 'interval') return { kind: 'timer', schedule, intervalMs: 1000 };
    const next = new Date(this.nowDate().getTime() + 60000);
    const time = {
      hour: next.getHours(),
      minute: next.getMinutes(),
      second: next.getSeconds()
    };
    return schedule === 'once'
      ? { kind: 'timer', schedule, date: localDateValue(next), ...time }
      : { kind: 'timer', schedule: 'daily', ...time };
  }

  isExpiredOnce(source) {
    if (timerSchedule(source) !== 'once') return false;
    const [year, month, day] = source.date.split('-').map(Number);
    const occurrence = new Date(
      year,
      month - 1,
      day,
      source.hour,
      source.minute,
      source.second
    );
    return occurrence.getTime() <= this.nowDate().getTime();
  }

  async addAutomationMapping() {
    const target = this.defaultAutomationTarget();
    if (!target) {
      this.setStatus(this.t(
        'midi.noAutomationTarget',
        'Add an effect with a numeric parameter before creating an automation.'
      ), true);
      return;
    }
    const mapping = await this.manager.store.addMapping({
      device: '',
      source: this.defaultTimerSource(),
      target,
      map: {
        ...this.resetMapForTarget(target),
        sensitivity: 1,
        dir: 1,
        buttonMode: 'toggle',
        behavior: 'direct'
      }
    });
    if (!mapping) {
      this.setStatus(this.t('midi.invalidAutomation', 'That automation could not be created.'), true);
      return;
    }
    this.setStatus('');
    this.render();
    const content = this.content;
    this.window.requestAnimationFrame?.(() => {
      if (content && this.content === content) content.scrollTop = content.scrollHeight;
    });
  }

  async addLearnedMapping(result) {
    const source = {
      channel: 0,
      number: 0,
      keyCombo: '',
      mode: result.source.kind === 'cc' ? 'abs' : result.source.kind === 'gamepadAxis' ? 'rel' : '',
      ...result.source
    };
    const target = this.defaultTarget();
    const mapping = await this.manager.store.addMapping({
      device: result.device,
      source,
      target,
      map: {
        ...defaultMapRange(target, this.manager.adapter),
        sensitivity: 1,
        dir: 1,
        buttonMode: 'toggle'
      }
    });
    if (!mapping) {
      this.setStatus(this.t('midi.invalidMapping', 'That control could not be mapped.'), true);
      return;
    }
    if (result.shortcutConflict) {
      this.setStatus(this.t(
        'midi.shortcutConflictWarning',
        'This key is also used by an app shortcut. The controller mapping takes priority.'
      ), true);
    } else {
      this.setStatus('');
    }
    this.render();
  }

  pluginTypes({ numericOnly = false } = {}) {
    const byType = new Map();
    for (const [displayName, pluginClass] of Object.entries(this.window.pluginManager?.pluginClasses || {})) {
      if (!pluginClass?.name) continue;
      if (numericOnly && !getAssignableDescriptors(pluginClass.name, this.manager.adapter).some(candidate =>
        isNumericTargetRange(candidate)
      )) continue;
      byType.set(pluginClass.name, displayName);
    }
    return Array.from(byType, ([type, label]) => ({ type, label })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }

  render() {
    if (!this.content || this.pendingConflict) return;
    closeStandardSelect(this.document);
    this.content.replaceChildren();
    this.content.appendChild(this.renderDevices());
    const mappingSection = createElement(this.document, 'section', 'midi-mapping-section');
    const mappingHeader = createElement(
      this.document,
      'div',
      'library-properties-head midi-mapping-section-head'
    );
    mappingHeader.appendChild(createElement(this.document, 'h2', '', this.t('midi.mappings', 'Mappings')));
    const actions = createElement(this.document, 'div', 'midi-mapping-header-actions');
    const add = createElement(this.document, 'button', 'library-button', this.t('midi.addLearn', 'Add (Learn)'));
    add.type = 'button';
    add.addEventListener('click', () => this.startLearn());
    const addAutomation = createElement(
      this.document,
      'button',
      'library-button midi-add-automation',
      this.t('midi.addAutomation', 'Add Automation')
    );
    addAutomation.type = 'button';
    addAutomation.addEventListener('click', () => { void this.addAutomationMapping(); });
    actions.append(add, addAutomation);
    mappingHeader.appendChild(actions);
    mappingSection.appendChild(mappingHeader);
    this.content.appendChild(mappingSection);
    const mappings = this.manager.store.mappings;
    if (mappings.length === 0) {
      mappingSection.appendChild(createElement(
        this.document,
        'div',
        'library-status midi-mapping-empty',
        this.t('midi.empty', 'No controller mappings yet.')
      ));
      return;
    }
    const list = createElement(this.document, 'div', 'midi-mapping-list');
    list.setAttribute('role', 'list');
    mappings.forEach(mapping => list.appendChild(this.renderMapping(mapping)));
    mappingSection.appendChild(list);
  }

  renderDevices() {
    const section = createElement(this.document, 'section', 'midi-device-section');
    const header = createElement(this.document, 'div', 'library-properties-head');
    header.appendChild(createElement(this.document, 'h2', '', this.t('midi.devices', 'MIDI Devices')));
    section.appendChild(header);
    const list = createElement(this.document, 'dl', 'library-properties-list');
    section.appendChild(list);
    if (!this.manager.isSupported()) {
      const row = createElement(this.document, 'div');
      row.appendChild(createElement(this.document, 'dt', '', ''));
      row.appendChild(createElement(this.document, 'dd', 'midi-note', this.t(
        'midi.notSupported',
        'MIDI is not supported in this browser. Keyboard and gamepad mappings remain available.'
      )));
      list.appendChild(row);
    } else if (this.manager.midiAccessError?.name === 'TimeoutError') {
      const row = createElement(this.document, 'div');
      row.appendChild(createElement(this.document, 'dt', '', ''));
      row.appendChild(createElement(this.document, 'dd', 'midi-note', this.t(
        'midi.driverStalled',
        'The MIDI system did not respond. MIDI stays off until EffeTune is restarted; keyboard and gamepad mappings keep working.'
      )));
      list.appendChild(row);
    } else if (this.manager.midiAccessError) {
      const row = createElement(this.document, 'div');
      row.appendChild(createElement(this.document, 'dt', '', ''));
      row.appendChild(createElement(this.document, 'dd', 'midi-note', this.t(
        'midi.permissionDenied',
        'MIDI access was not allowed. Check this site’s permissions and reopen this dialog.'
      )));
      list.appendChild(row);
    }
    for (const input of this.manager.listInputs()) {
      const deviceKey = input.key || input.name;
      const row = createElement(this.document, 'div', 'midi-device-row');
      row.appendChild(createElement(this.document, 'dt', '', `${input.connected ? '●' : '○'} ${input.name}`));
      const value = createElement(this.document, 'dd');
      const select = this.createSelect();
      for (const protocol of ['generic', 'mcu']) {
        const option = createElement(this.document, 'option', '', protocol === 'mcu' ? 'MCU' : 'Generic');
        option.value = protocol;
        select.appendChild(option);
      }
      select.value = this.manager.store.getDeviceProtocol(deviceKey);
      select.addEventListener('change', event => {
        void this.manager.setDeviceProtocol(deviceKey, event.target.value);
      });
      const field = createElement(this.document, 'label', 'midi-field', this.t('midi.mode', 'Mode'));
      field.appendChild(select);
      value.appendChild(field);
      row.appendChild(value);
      list.appendChild(row);
    }
    const gamepads = this.manager.listGamepads();
    if (gamepads.length > 0) {
      gamepads.forEach((gamepad, index) => {
        const row = createElement(this.document, 'div', 'midi-device-row');
        row.appendChild(createElement(
          this.document,
          'dt',
          '',
          index === 0 ? this.t('midi.gamepads', 'Gamepads') : ''
        ));
        row.appendChild(createElement(this.document, 'dd', '', `● ${gamepad.name}`));
        list.appendChild(row);
      });
    }
    return section;
  }

  renderMapping(mapping) {
    const isVirtual = VIRTUAL_SOURCE_KINDS.has(mapping.source.kind);
    const row = createElement(this.document, 'div', 'midi-mapping-row');
    row.dataset.mappingId = mapping.id;
    row.setAttribute('role', 'listitem');
    const head = createElement(this.document, 'div', 'midi-mapping-row-head');
    const summary = createElement(
      this.document,
      'div',
      'midi-source-label',
      sourceLabel(mapping, (key, fallback, values) => this.format(key, fallback, values))
    );
    if (mapping.device) summary.append(` — ${this.manager.getDeviceDisplayName?.(mapping.device) || mapping.device}`);
    const remove = createElement(this.document, 'button', 'library-button midi-delete', this.t('midi.delete', 'Delete'));
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      await this.manager.store.removeMapping(mapping.id);
      this.render();
    });
    head.append(summary, remove);
    row.appendChild(head);
    const value = createElement(this.document, 'div', 'midi-mapping-fields');
    const controls = createElement(this.document, 'div', 'midi-target-controls');
    const typeSelect = this.createSelect();
    if (!isVirtual) {
      const globalOption = createElement(this.document, 'option', '', this.t('midi.target.global', 'Global'));
      globalOption.value = '_global';
      typeSelect.appendChild(globalOption);
    }
    for (const pluginType of this.pluginTypes({ numericOnly: isVirtual })) {
      const option = createElement(this.document, 'option', '', pluginType.label);
      option.value = pluginType.type;
      typeSelect.appendChild(option);
    }
    typeSelect.value = mapping.target.type;
    const instanceSelect = this.createSelect();
    for (const instance of ['first', 'last', 'all']) {
      const option = createElement(this.document, 'option', '', this.t(`midi.target.instance.${instance}`, instance));
      option.value = instance;
      instanceSelect.appendChild(option);
    }
    instanceSelect.value = mapping.target.instance;
    instanceSelect.disabled = mapping.target.type === '_global';
    const paramSelect = this.createSelect();
    this.populateParameterSelect(paramSelect, mapping.target.type, mapping.target, { numericOnly: isVirtual });
    typeSelect.addEventListener('change', async event => {
      const type = event.target.value;
      const target = type === '_global'
        ? { type, instance: 'first', param: 'masterBypass', element: 0 }
        : {
            ...this.firstTargetForType(type, { numericOnly: isVirtual }),
            instance: instanceSelect.value
          };
      const update = this.manager.store.updateMapping(mapping.id, {
        target,
        map: this.resetMapForTarget(target)
      });
      this.render();
      await update;
    });
    instanceSelect.addEventListener('change', event => {
      void this.manager.store.updateMapping(mapping.id, {
        target: { instance: event.target.value }
      });
    });
    paramSelect.addEventListener('change', async event => {
      const [param, element] = event.target.value.split(':');
      const target = {
        ...mapping.target,
        instance: instanceSelect.value,
        param,
        element: Number(element) || 0
      };
      const update = this.manager.store.updateMapping(mapping.id, {
        target,
        map: this.resetMapForTarget(target)
      });
      this.render();
      await update;
    });
    const typeField = createElement(
      this.document,
      'label',
      'midi-field midi-target-type-field',
      this.t('midi.target.type', 'Effect')
    );
    typeField.appendChild(typeSelect);
    const instanceField = createElement(
      this.document,
      'label',
      'midi-field midi-target-instance-field',
      this.t('midi.target.instance', 'Instance')
    );
    instanceField.appendChild(instanceSelect);
    const parameterField = createElement(
      this.document,
      'label',
      'midi-field midi-target-parameter-field',
      this.t('midi.target.parameter', 'Parameter')
    );
    parameterField.appendChild(paramSelect);
    controls.append(typeField, instanceField, parameterField);
    value.appendChild(controls);
    value.appendChild(this.renderDetails(mapping));
    row.appendChild(value);
    return row;
  }

  firstTargetForType(type, { numericOnly = false } = {}) {
    const descriptor = getAssignableDescriptors(type, this.manager.adapter).find(candidate =>
      !numericOnly || isNumericTargetRange(candidate)
    );
    return {
      type,
      instance: 'first',
      param: descriptor?.key || '_enabled',
      element: descriptor?.element || 0
    };
  }

  populateParameterSelect(select, type, current, { numericOnly = false } = {}) {
    if (type === '_global') {
      for (const param of ['masterBypass', 'abToggle']) {
        const option = createElement(
          this.document,
          'option',
          '',
          this.t(`midi.target.${param}`, param === 'masterBypass' ? 'Master Bypass' : 'A/B Toggle')
        );
        option.value = `${param}:0`;
        select.appendChild(option);
      }
    } else {
      if (!numericOnly) {
        const enabled = createElement(this.document, 'option', '', this.t('midi.target.enabled', 'Enabled'));
        enabled.value = '_enabled:0';
        select.appendChild(enabled);
      }
      const descriptors = getAssignableDescriptors(type, this.manager.adapter).filter(descriptor =>
        !numericOnly || isNumericTargetRange(descriptor)
      );
      const titleCounts = new Map();
      descriptors.forEach(descriptor => titleCounts.set(descriptor.title, (titleCounts.get(descriptor.title) || 0) + 1));
      for (const descriptor of descriptors) {
        const title = titleCounts.get(descriptor.title) > 1
          ? this.format('midi.parameterNumber', '{title} {number}', {
            title: descriptor.title, number: descriptor.element + 1
          })
          : descriptor.title;
        const unit = descriptor.unit ? ` (${descriptor.unit})` : '';
        const option = createElement(this.document, 'option', '', `${title}${unit}`);
        option.value = `${descriptor.key}:${descriptor.element}`;
        select.appendChild(option);
      }
    }
    select.value = `${current.param}:${current.element}`;
  }

  renderDetails(mapping) {
    const details = createElement(this.document, 'div', 'midi-map-details');
    const range = getTargetValueRange(mapping.target, this.manager.adapter);
    const numericTarget = isNumericTargetRange(range);
    const virtualSource = VIRTUAL_SOURCE_KINDS.has(mapping.source.kind);
    if (virtualSource) this.appendAutomationSourceControls(details, mapping);
    const resolved = mapping.target?.type === '_global' || mapping.target?.param === '_enabled'
      ? null
      : this.manager.adapter.resolve(mapping.target.type, mapping.target.param, mapping.target.element);
    const unit = resolved?.descriptor.unit ? ` (${resolved.descriptor.unit})` : '';
    if (range && range.kind !== 'bool') {
      for (const [field, key, fallback] of [
        ['lo', 'midi.map.minimum', 'Min'],
        ['hi', 'midi.map.maximum', 'Max']
      ]) {
        const wrapper = createElement(
          this.document,
          'label',
          'midi-field',
          `${this.t(key, fallback)}${unit}`
        );
        if (range.kind === 'enum') {
          const select = this.createSelect();
          for (const value of range.values) {
            const option = createElement(this.document, 'option', '', value);
            option.value = value;
            select.appendChild(option);
          }
          select.value = mapping.map[field];
          select.addEventListener('change', event => {
            void this.manager.store.updateMapping(mapping.id, { map: { [field]: event.target.value } });
          });
          wrapper.appendChild(select);
        } else {
          const input = createElement(this.document, 'input', 'preset-dialog-rename-input');
          input.type = 'number';
          input.step = Number.isFinite(range.step) && range.step > 0 ? String(range.step) : 'any';
          input.min = String(range.minimum);
          input.max = String(range.maximum);
          input.value = String(mapping.map[field]);
          input.addEventListener('change', event => {
            void this.manager.store.updateMapping(mapping.id, {
              map: { [field]: Number(event.target.value) }
            });
          });
          wrapper.appendChild(input);
        }
        details.appendChild(wrapper);
      }
    }
    if (!virtualSource) {
      const sensitivityWrapper = createElement(
        this.document,
        'label',
        'midi-field',
        this.t('midi.map.sensitivity', 'Sensitivity')
      );
      const select = this.createSelect();
      for (const value of [0.25, 0.5, 1, 2, 4]) {
        const option = createElement(this.document, 'option', '', String(value));
        option.value = String(value);
        select.appendChild(option);
      }
      select.value = String(mapping.map.sensitivity);
      select.addEventListener('change', event => {
        void this.manager.store.updateMapping(mapping.id, {
          map: { sensitivity: Number(event.target.value) }
        });
      });
      sensitivityWrapper.appendChild(select);
      details.appendChild(sensitivityWrapper);
    }
    const discreteNumeric = numericTarget &&
      (mapping.source.kind === 'timer' || BUTTON_SOURCE_KINDS.has(mapping.source.kind));
    if (discreteNumeric) this.appendBehaviorControls(details, mapping, range);
    if (!virtualSource || (mapping.source.kind === 'timer' && mapping.map.behavior === 'direct')) {
      const direction = this.createSelect();
      for (const [value, key, fallback] of [
        ['1', 'midi.direction.increase', 'Increase (+)'],
        ['-1', 'midi.direction.decrease', 'Decrease (−)']
      ]) {
        const option = createElement(this.document, 'option', '', this.t(key, fallback));
        option.value = value;
        direction.appendChild(option);
      }
      direction.value = String(mapping.map.dir);
      direction.addEventListener('change', event => {
        void this.manager.store.updateMapping(mapping.id, { map: { dir: Number(event.target.value) } });
      });
      const directionWrapper = createElement(
        this.document,
        'label',
        'midi-field',
        this.t('midi.direction', 'Direction')
      );
      directionWrapper.appendChild(direction);
      details.appendChild(directionWrapper);
    }
    if (mapping.source.kind === 'cc' || mapping.source.kind === 'gamepadAxis') {
      const mode = this.createSelect();
      const modes = mapping.source.kind === 'cc'
        ? ['abs', 'rel2c', 'relBin', 'relSign']
        : ['rel', 'abs'];
      for (const value of modes) {
        const option = createElement(this.document, 'option', '', this.t(`midi.mode.${value}`, value));
        option.value = value;
        mode.appendChild(option);
      }
      mode.value = mapping.source.mode;
      mode.addEventListener('change', event => {
        void this.manager.store.updateMapping(mapping.id, { source: { mode: event.target.value } });
      });
      const modeWrapper = createElement(
        this.document,
        'label',
        'midi-field',
        this.t('midi.mode', 'Mode')
      );
      modeWrapper.appendChild(mode);
      details.appendChild(modeWrapper);
    }
    if (mapping.target?.type !== '_global' &&
        BUTTON_SOURCE_KINDS.has(mapping.source.kind) &&
        this.manager.engine?.getTargetKind?.(mapping) === 'bool') {
      const buttonMode = this.createSelect();
      for (const value of ['toggle', 'momentary']) {
        const option = createElement(
          this.document,
          'option',
          '',
          this.t(`midi.buttonMode.${value}`, value === 'toggle' ? 'Toggle' : 'Momentary')
        );
        option.value = value;
        buttonMode.appendChild(option);
      }
      buttonMode.value = mapping.map.buttonMode;
      buttonMode.setAttribute('aria-label', this.t('midi.buttonMode', 'Button Mode'));
      buttonMode.addEventListener('change', event => {
        void this.manager.store.updateMapping(mapping.id, {
          map: { buttonMode: event.target.value }
        });
      });
      const buttonModeWrapper = createElement(
        this.document,
        'label',
        'midi-field',
        this.t('midi.buttonMode', 'Button Mode')
      );
      buttonModeWrapper.appendChild(buttonMode);
      details.appendChild(buttonModeWrapper);
    }
    return details;
  }

  appendAutomationSourceControls(details, mapping) {
    const sourceWrapper = createElement(
      this.document,
      'label',
      'midi-field',
      this.t('midi.automation.source', 'Source')
    );
    const sourceSelect = this.createSelect();
    for (const [kind, key, fallback] of [
      ['timer', 'midi.automation.source.timer', 'Timer'],
      ['clock', 'midi.automation.source.clock', 'Clock']
    ]) {
      const option = createElement(this.document, 'option', '', this.t(key, fallback));
      option.value = kind;
      sourceSelect.appendChild(option);
    }
    sourceSelect.value = mapping.source.kind;
    sourceSelect.setAttribute('aria-label', this.t('midi.automation.source', 'Source'));
    sourceSelect.addEventListener('change', async event => {
      const useClock = event.target.value === 'clock';
      const source = useClock
        ? { kind: 'clock', component: 'hour', shape: 'ramp' }
        : this.defaultTimerSource();
      const patch = { source };
      if (useClock && mapping.map.behavior !== 'direct') patch.map = { behavior: 'direct' };
      await this.manager.store.updateMapping(mapping.id, patch);
      this.render();
    });
    sourceWrapper.appendChild(sourceSelect);
    details.appendChild(sourceWrapper);

    if (mapping.source.kind === 'clock') {
      for (const [field, values, labelKey, labelFallback, valuePrefix] of [
        ['component', ['hour', 'minute', 'second'], 'midi.clock.component', 'Time part', 'midi.clock.component'],
        ['shape', ['ramp', 'sin', 'cos'], 'midi.clock.shape', 'Wave', 'midi.clock.shape']
      ]) {
        const wrapper = createElement(
          this.document,
          'label',
          'midi-field',
          this.t(labelKey, labelFallback)
        );
        const select = this.createSelect();
        for (const value of values) {
          const option = createElement(this.document, 'option', '', this.t(`${valuePrefix}.${value}`, value));
          option.value = value;
          select.appendChild(option);
        }
        select.value = mapping.source[field];
        select.addEventListener('change', event => {
          void this.manager.store.updateMapping(mapping.id, { source: { [field]: event.target.value } });
        });
        wrapper.appendChild(select);
        details.appendChild(wrapper);
      }
      return;
    }

    this.appendTimerScheduleControls(details, mapping);
  }

  appendTimerScheduleControls(details, mapping) {
    const scheduleWrapper = createElement(
      this.document,
      'label',
      'midi-field',
      this.t('midi.timer.schedule', 'Schedule')
    );
    const scheduleSelect = this.createSelect();
    for (const [schedule, key, fallback] of [
      ['interval', 'midi.timer.schedule.interval', 'Interval'],
      ['once', 'midi.timer.schedule.once', 'Once'],
      ['daily', 'midi.timer.schedule.daily', 'Daily']
    ]) {
      const option = createElement(this.document, 'option', '', this.t(key, fallback));
      option.value = schedule;
      scheduleSelect.appendChild(option);
    }
    const schedule = timerSchedule(mapping.source);
    scheduleSelect.value = schedule;
    scheduleSelect.setAttribute('aria-label', this.t('midi.timer.schedule', 'Schedule'));
    scheduleSelect.addEventListener('change', async event => {
      await this.manager.store.updateMapping(mapping.id, {
        source: this.defaultTimerSource(event.target.value)
      });
      this.render();
    });
    scheduleWrapper.appendChild(scheduleSelect);
    details.appendChild(scheduleWrapper);

    if (schedule === 'once') {
      const dateWrapper = createElement(
        this.document,
        'label',
        'midi-field',
        this.t('midi.timer.date', 'Date')
      );
      const date = createElement(this.document, 'input', 'preset-dialog-rename-input');
      date.type = 'date';
      date.value = mapping.source.date;
      date.addEventListener('change', async event => {
        await this.manager.store.updateMapping(mapping.id, { source: { date: event.target.value } });
        this.render();
      });
      dateWrapper.appendChild(date);
      details.appendChild(dateWrapper);
    }

    if (schedule === 'once' || schedule === 'daily') {
      const timeWrapper = createElement(
        this.document,
        'label',
        'midi-field',
        this.t('midi.timer.time', 'Time')
      );
      const time = createElement(this.document, 'input', 'preset-dialog-rename-input');
      time.type = 'time';
      time.step = '1';
      time.value = timeValue(mapping.source);
      time.addEventListener('change', async event => {
        const next = parseTimeValue(event.target.value);
        if (next) await this.manager.store.updateMapping(mapping.id, { source: next });
        this.render();
      });
      timeWrapper.appendChild(time);
      details.appendChild(timeWrapper);
      if (schedule === 'once' && this.isExpiredOnce(mapping.source)) {
        const expired = createElement(
          this.document,
          'span',
          'library-status warning midi-timer-expired',
          this.t('midi.timer.expired', 'Expired')
        );
        expired.setAttribute('role', 'status');
        details.appendChild(expired);
      }
      return;
    }

    const interval = createElement(
      this.document,
      'label',
      'midi-field',
      this.t('midi.timer.interval', 'Interval (seconds)')
    );
    const input = createElement(this.document, 'input', 'preset-dialog-rename-input');
    input.type = 'number';
    input.step = '0.001';
    input.min = '1';
    input.max = String(MAX_TIMER_DELAY_MS / 1000);
    input.value = String(mapping.source.intervalMs / 1000);
    input.addEventListener('change', event => {
      void this.manager.store.updateMapping(mapping.id, {
        source: { intervalMs: Math.round(Number(event.target.value) * 1000) }
      });
    });
    interval.appendChild(input);
    details.appendChild(interval);
  }

  appendBehaviorControls(details, mapping, range) {
    const behaviorWrapper = createElement(
      this.document,
      'label',
      'midi-field',
      this.t('midi.automation.behavior', 'Action')
    );
    const behavior = this.createSelect();
    for (const [value, key, fallback] of [
      ['direct', 'midi.behavior.direct', 'Change by amount'],
      ['random', 'midi.behavior.random', 'Random value in range'],
      ['randomWalk', 'midi.behavior.randomWalk', 'Random step from current value']
    ]) {
      const option = createElement(this.document, 'option', '', this.t(key, fallback));
      option.value = value;
      behavior.appendChild(option);
    }
    behavior.value = mapping.map.behavior || 'direct';
    behavior.addEventListener('change', async event => {
      await this.manager.store.updateMapping(mapping.id, { map: { behavior: event.target.value } });
      this.render();
    });
    behaviorWrapper.appendChild(behavior);
    details.appendChild(behaviorWrapper);

    const needsAmount = mapping.map.behavior === 'randomWalk' ||
      (mapping.source.kind === 'timer' && mapping.map.behavior === 'direct');
    if (!needsAmount) return;
    const resolved = this.manager.adapter.resolve(
      mapping.target.type,
      mapping.target.param,
      mapping.target.element
    );
    const unit = resolved?.descriptor.unit ? ` (${resolved.descriptor.unit})` : '';
    const amountWrapper = createElement(
      this.document,
      'label',
      'midi-field',
      `${this.t('midi.automation.amount', 'Amount')}${unit}`
    );
    const amount = createElement(this.document, 'input', 'preset-dialog-rename-input');
    amount.type = 'number';
    amount.step = Number.isFinite(range.step) && range.step > 0 ? String(range.step) : 'any';
    amount.min = amount.step === 'any' ? String(Number.EPSILON) : amount.step;
    amount.value = String(mapping.map.amount);
    amount.addEventListener('change', event => {
      void this.manager.store.updateMapping(mapping.id, {
        map: { amount: Number(event.target.value) }
      });
    });
    amountWrapper.appendChild(amount);
    details.appendChild(amountWrapper);
  }
}
