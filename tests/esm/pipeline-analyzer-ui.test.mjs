import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PipelineAnalyzerController } from '../../js/pipeline-analyzer/controller.js';
import { MAX_OUTPUT_SLOTS, PipelineAnalyzerUI } from '../../js/pipeline-analyzer/ui.js';

// This DOM stress suite can consume substantial memory, so the repository runner
// starts it in a dedicated process with EFFETUNE_RUN_PIPELINE_ANALYZER_UI_TEST=1.
// Direct execution without that opt-in keeps every test skipped.
const uiTest = process.env.EFFETUNE_RUN_PIPELINE_ANALYZER_UI_TEST === '1'
  ? test
  : test.skip;

uiTest('places one accessible Analyzer button directly after Share with dedicated spacing', () => {
  const html = fs.readFileSync(new URL('../../effetune.html', import.meta.url), 'utf8');
  const analyzerCss = fs.readFileSync(new URL('../../pipeline-analyzer.css', import.meta.url), 'utf8');
  const sharedCss = fs.readFileSync(new URL('../../effetune.css', import.meta.url), 'utf8');
  const mobileCss = fs.readFileSync(new URL('../../effetune-mobile.css', import.meta.url), 'utf8');
  const uiSource = fs.readFileSync(new URL('../../js/pipeline-analyzer/ui.js', import.meta.url), 'utf8');
  const uiManagerSource = fs.readFileSync(new URL('../../js/ui-manager.js', import.meta.url), 'utf8');

  assert.equal(html.match(/id="pipelineAnalyzerButton"/g)?.length, 1);
  assert.match(html, /id="shareButton"[^>]*>[^<]*<\/button>\s*<button[^>]*id="pipelineAnalyzerButton"[^>]*>.*?<\/button>/s);
  assert.match(html, /id="pipelineAnalyzerButton"[^>]*aria-controls="pipelineAnalyzerPanel"[^>]*aria-expanded="false"[^>]*aria-pressed="false"/);
  assert.match(analyzerCss, /\.pipeline-analyzer-button\s*\{[^}]*margin-left:\s*5px;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-header\s*\{[^}]*padding:\s*20px 20px 10px;/s);
  assert.match(analyzerCss, /body:not\(\.layout-mobile\) \.pipeline-header\s*\{[^}]*padding-top:\s*2px;/s);
  assert.match(analyzerCss, /body:not\(\.layout-mobile\) \.pipeline-analyzer-header\s*\{[^}]*padding:\s*25px 20px 10px;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-title\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*normal;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-icon-button\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-graph-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*1024px;[^}]*aspect-ratio:\s*1024\s*\/\s*480;[^}]*min-height:\s*0;[^}]*margin:\s*10px auto;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*#1a1a1a;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-graph,\s*\.pipeline-analyzer-hover-overlay\s*\{[^}]*position:\s*absolute;[^}]*top:\s*20px;[^}]*left:\s*20px;[^}]*width:\s*calc\(100% - 40px\);[^}]*height:\s*calc\(100% - 40px\);/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-hover-overlay\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-spinner-overlay\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*5;[^}]*inset:\s*20px;[^}]*display:\s*flex;[^}]*pointer-events:\s*none;/s);
  assert.match(uiSource, /'loading-spinner pipeline-analyzer-spinner'/);
  assert.match(analyzerCss, /\.pipeline-analyzer-spinner\s*\{[^}]*display:\s*block;[^}]*position:\s*static;[^}]*z-index:\s*auto;/s);
  assert.doesNotMatch(analyzerCss, /@keyframes pipeline-analyzer-spin|\.pipeline-analyzer-spinner\s*\{[^}]*(?:border|animation):/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-grid line\s*\{[^}]*stroke:\s*#333;[^}]*stroke-width:\s*1;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-axes text\s*\{[^}]*fill:\s*#666;[^}]*font-size:\s*10px;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-curve\s*\{[^}]*stroke-width:\s*1;[^}]*pointer-events:\s*none;[^}]*vector-effect:\s*non-scaling-stroke;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-curve\.is-highlighted\s*\{[^}]*stroke-width:\s*3\.5;[^}]*opacity:\s*1;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-curve\.is-hidden\s*\{[^}]*display:\s*none;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-display-controls\s*\{[^}]*display:\s*grid;[^}]*min-height:\s*64px;[^}]*margin:\s*6px 0 2px;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-view-switcher\s*\{[^}]*column-gap:\s*20px;[^}]*row-gap:\s*2px;/s);
  assert.match(uiSource, /const y = bounds\.top \+ point\.y \* bounds\.height;/);
  assert.doesNotMatch(uiSource,
    /const y = bounds\.top \+ Math\.min\(1, Math\.max\(0, point\.y\)\) \* bounds\.height;/);
  assert.match(analyzerCss, /\.pipeline-analyzer-display-control\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^;]+;[^}]*gap:\s*10px;/s);
  assert.doesNotMatch(analyzerCss, /\.pipeline-analyzer-display-control\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-display-control input\[type='range'\]\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*120px;/s);
  assert.match(sharedCss, /\.parameter-row label\s*\{[^}]*width:\s*120px;/s);
  assert.doesNotMatch(analyzerCss, /\.pipeline-analyzer-curve(?::hover|\.is-selected)/);
  assert.doesNotMatch(analyzerCss, /\.pipeline-analyzer-cursor-line/);
  assert.match(analyzerCss, /\.pipeline-analyzer-legend-row\s*\{[^}]*cursor:\s*default;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-legend-cursor-x\s*\{[^}]*align-self:\s*flex-end;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-legend-cursor-x:empty\s*\{[^}]*display:\s*none;/s);
  assert.match(analyzerCss, /\.pipeline-analyzer-graph-section\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(analyzerCss, /@container \(max-width:\s*480px\)/);
  assert.match(analyzerCss, /body\.layout-mobile \.pipeline-analyzer-graph-shell\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3;/s);
  assert.doesNotMatch(analyzerCss, /\.pipeline-analyzer-view-switcher\s*\{[^}]*position:\s*absolute;/s);
  assert.match(analyzerCss, /body\.layout-mobile \.pipeline-analyzer-legend\s*\{[^}]*top:\s*5px;[^}]*right:\s*5px;[^}]*left:\s*auto;[^}]*font-size:\s*10px;/s);
  assert.match(uiSource, /this\.graphSection\.append\(this\.viewGroup, this\.displayControl, this\.graphShell\)/);
  assert.doesNotMatch(analyzerCss, /body\.layout-mobile \.pipeline-analyzer-legend-label(?:-short)?\s*\{/s);
  assert.match(mobileCss, /body\.layout-mobile \.pipeline-analyzer-panel input\[type='number'\],\s*body\.layout-mobile \.pipeline-analyzer-panel select,[\s\S]*?min-height:\s*var\(--et-mobile-control-height\);[\s\S]*?font-size:\s*16px;/s);
  assert.match(sharedCss, /\.pipeline-analyzer-panel select option,/);
  assert.match(sharedCss, /\.pipeline-analyzer-panel select option:hover,/);
  assert.match(sharedCss, /\.pipeline-analyzer-panel select option:checked,/);
  assert.match(sharedCss, /\.pipeline-analyzer-panel input\[type="number"\],\s*\.pipeline-analyzer-panel select,/);
  assert.match(sharedCss, /\.plugin-parameter-ui \.parameter-row input\[type="number"\],\s*\.pipeline-analyzer-panel input\[type='number'\]\s*\{[^}]*padding:\s*4px;[^}]*background-color:\s*#3d3d3d;[^}]*border:\s*1px solid #4d4d4d;[^}]*color:\s*#ffffff;[^}]*border-radius:\s*4px;/s);
  assert.match(sharedCss, /\.plugin-parameter-ui select,\s*\.pipeline-analyzer-panel select\s*\{[^}]*background-color:\s*#3d3d3d;[^}]*border:\s*1px solid #4d4d4d;[^}]*color:\s*#ffffff;[^}]*border-radius:\s*4px;[^}]*padding:\s*4px;/s);
  assert.match(sharedCss, /body:not\(\.layout-mobile\) \.plugin-parameter-ui \.parameter-row input\[type="number"\],\s*body:not\(\.layout-mobile\) \.pipeline-analyzer-panel input\[type="number"\]\s*\{[^}]*height:\s*26px;[^}]*min-height:\s*26px;[^}]*padding:\s*4px;[^}]*font:\s*inherit;[^}]*line-height:\s*normal;[^}]*color-scheme:\s*dark;/s);
  assert.doesNotMatch(analyzerCss, /\.pipeline-analyzer-panel input\[type='number'\]\s*\{[^}]*(?:height:\s*30px|padding:\s*3px 7px)/s);
  assert.doesNotMatch(analyzerCss, /\.pipeline-analyzer-panel select\s*\{[^}]*(?:height:\s*30px|padding:\s*3px 7px|border-radius:\s*4px)/s);
  assert.doesNotMatch(analyzerCss, /pipeline-analyzer-(?:status|warnings|provenance|graph-empty|stale-badge)/);
  assert.doesNotMatch(uiSource, /GRAPH_BOUNDS|selectedCurveId/);
  assert.doesNotMatch(uiSource, /pipeline-analyzer-cursor-line/);
  assert.match(uiSource, /new this\.window\.ResizeObserver\(\(\) => this\.syncGraphSize\(\)\)/);
  assert.match(uiSource, /this\.graphSvg\.setAttribute\('viewBox', viewBox\)/);
  assert.match(uiSource, /this\.hoverSvg\?\.setAttribute\?\.\('viewBox', viewBox\)/);
  assert.match(uiManagerSource, /onConfigurationChange:\s*\(configuration, meta\)\s*=>\s*this\.pipelineAnalyzerController\?\.setConfiguration\(configuration, meta\)/s);
});

class FakeClassList {
  constructor(element) { this.element = element; }
  values() { return new Set(this.element.className.split(/\s+/).filter(Boolean)); }
  contains(name) { return this.values().has(name); }
  add(...names) {
    const values = this.values();
    for (const name of names) values.add(name);
    this.element.className = [...values].join(' ');
  }
  remove(...names) {
    const values = this.values();
    for (const name of names) values.delete(name);
    this.element.className = [...values].join(' ');
  }
  toggle(name, force) {
    const values = this.values();
    const enabled = force === undefined ? !values.has(name) : Boolean(force);
    if (enabled) values.add(name); else values.delete(name);
    this.element.className = [...values].join(' ');
    return enabled;
  }
}

class FakeElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.eventListeners = new Map();
    this.id = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.textContent = '';
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return index > 0 ? this.parentNode.children[index - 1] : null;
  }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes[name] = text;
    if (name === 'class') this.className = text;
    if (name === 'id') this.id = text;
  }
  getAttribute(name) { return this.attributes[name]; }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, reference) {
    child.parentNode?.removeChild(child);
    const index = reference ? this.children.indexOf(reference) : -1;
    child.parentNode = this;
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }
  contains(candidate) {
    return candidate === this || this.children.some(child => child.contains(candidate));
  }
  querySelector(selector) {
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
    if (selector.startsWith('#') && this.id === selector.slice(1)) return this;
    for (const child of this.children) {
      const result = child.querySelector(selector);
      if (result) return result;
    }
    return null;
  }
  querySelectorAll(selector) {
    const matches = [];
    if (selector === '[data-text-key]' && this.dataset.textKey) matches.push(this);
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) matches.push(this);
    for (const child of this.children) matches.push(...child.querySelectorAll(selector));
    return matches;
  }
  querySelectorById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const result = child.querySelectorById(id);
      if (result) return result;
    }
    return null;
  }
  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    this.eventListeners.set(type, listeners.filter(candidate => candidate !== listener));
  }
  dispatch(type, event = {}) {
    for (const listener of this.eventListeners.get(type) || []) listener({ target: this, ...event });
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    this.dispatch('blur');
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1024, height: 480 }; }
}

function createFixture() {
  const documentRef = {
    activeElement: null,
    createElement: tagName => new FakeElement(documentRef, tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(documentRef, tagName),
    getElementById: id => documentRef.body.querySelectorById(id),
    querySelector: selector => documentRef.body.querySelector(selector)
  };
  documentRef.body = documentRef.createElement('body');
  const main = documentRef.createElement('main');
  main.className = 'main-container';
  const pipeline = documentRef.createElement('section');
  pipeline.id = 'pipeline';
  const header = documentRef.createElement('header');
  header.className = 'pipeline-header';
  const button = documentRef.createElement('button');
  button.id = 'pipelineAnalyzerButton';
  const pipelineList = documentRef.createElement('div');
  pipelineList.id = 'pipelineList';
  const panel = documentRef.createElement('aside');
  panel.id = 'pipelineAnalyzerPanel';
  panel.hidden = true;
  header.appendChild(button);
  pipeline.append(header, pipelineList);
  main.append(pipeline, panel);
  documentRef.body.appendChild(main);

  const windowListeners = new Map();
  let narrow = false;
  let observerDisconnected = false;
  class FakeResizeObserver {
    observe() {}
    disconnect() { observerDisconnected = true; }
  }
  const windowRef = {
    ResizeObserver: FakeResizeObserver,
    matchMedia: () => ({ matches: narrow }),
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    }
  };
  return {
    documentRef, windowRef, main, pipeline, pipelineList, panel, button, windowListeners,
    setNarrow: value => { narrow = value; },
    observerDisconnected: () => observerDisconnected
  };
}

function setFormat(ui, channelCount = 2, sampleRate = 48000) {
  ui.setAudioFormat({ sampleRate, channelCount });
}

uiTest('uses canonical measurement settings and keeps pending format non-destructive', () => {
  const fixture = createFixture();
  const changes = [];
  const ui = new PipelineAnalyzerUI({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    translate: () => 'Translated text',
    onConfigurationChange: configuration => changes.push(configuration)
  });
  assert.equal(ui.title.textContent, 'Pipeline Analyzer');
  assert.equal(ui.inputCaption.textContent, 'Input');
  const defaults = ui.getConfiguration();
  assert.deepEqual(defaults.measurementSettings, {
    signalType: 'mls', levelDb: -12, sequenceLength: 65535,
    stabilizationPeriods: 12, averagingPeriods: 2
  });
  assert.deepEqual(defaults.displaySettings, { smoothingOct: 0.17, impulseRangeMs: 6 });
  assert.equal(defaults.graphView, 'frequency');
  assert.equal(defaults.autoRefresh, true);
  assert.equal(defaults.outputs.length, 1);
  assert.equal(ui.autoRefreshText.textContent, 'Auto');
  assert.deepEqual(ui.refreshButton.parentNode.children, [ui.refreshButton, ui.autoRefreshLabel]);
  assert.equal(ui.autoRefreshInput.checked, true);
  ui.autoRefreshInput.checked = false;
  ui.autoRefreshInput.dispatch('change');
  assert.equal(changes.at(-1).autoRefresh, false);
  assert.equal(ui.settingsDetails.open, undefined);
  assert.equal(ui.inputSelect.disabled, true);
  assert.equal(ui.outputElements.length, 1);
  assert.equal(ui.outputElements[0].output.disabled, true);
  assert.equal(ui.addOutputButton.disabled, true);

  setFormat(ui, 4, 48000);
  assert.equal(ui.inputSelect.disabled, false);
  assert.match(ui.measurementTiming.children[0].textContent, /65535 samples/);
  assert.match(ui.measurementTiming.children[1].textContent, /16\.4 s/);
  assert.match(ui.measurementTiming.children[2].textContent, /19\.1 s/);
});

uiTest('keeps both display controls mounted, enables only relevant settings, and synchronizes range fill', () => {
  const fixture = createFixture();
  const changes = [];
  const ui = new PipelineAnalyzerUI({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    onConfigurationChange: (configuration, meta) => changes.push({ configuration, meta })
  });
  const measurementSettings = { ...ui.getConfiguration().measurementSettings };
  const smoothing = ui.displayControls.smoothingOct;
  const impulse = ui.displayControls.impulseRangeMs;
  assert.deepEqual(ui.displayControl.children, [smoothing.row, impulse.row]);
  assert.equal(smoothing.label.textContent, 'Smoothing (oct):');
  assert.equal(smoothing.label.tagName, 'LABEL');
  assert.equal(smoothing.label.htmlFor, 'pipelineAnalyzerSmoothingRange');
  assert.equal(smoothing.range.id, 'pipelineAnalyzerSmoothingRange');
  assert.equal(smoothing.range.name, 'pipelineAnalyzerSmoothingRange');
  assert.equal(smoothing.range.getAttribute('autocomplete'), 'off');
  assert.equal(smoothing.number.id, 'pipelineAnalyzerSmoothingNumber');
  assert.equal(smoothing.number.name, 'pipelineAnalyzerSmoothingNumber');
  assert.equal(smoothing.number.getAttribute('autocomplete'), 'off');
  assert.equal(smoothing.range.min, '0.02');
  assert.equal(smoothing.range.max, '1');
  assert.equal(smoothing.range.step, '0.01');
  assert.equal(smoothing.range.disabled, false);
  assert.equal(impulse.range.disabled, true);
  assert.equal(smoothing.range.style['--et-range-fill'], `${((0.17 - 0.02) / (1 - 0.02)) * 100}%`);
  assert.equal(impulse.range.style['--et-range-fill'], `${((6 - 1) / (50 - 1)) * 100}%`);
  smoothing.range.value = '0.31';
  smoothing.range.dispatch('input');
  assert.equal(smoothing.number.value, '0.31');
  assert.equal(smoothing.range.style['--et-range-fill'], `${((0.31 - 0.02) / (1 - 0.02)) * 100}%`);
  assert.deepEqual(changes.at(-1).configuration.measurementSettings, measurementSettings);
  assert.equal(changes.at(-1).meta.displayCommit, false);
  smoothing.range.dispatch('change');
  assert.equal(changes.at(-1).meta.displayCommit, true);
  ui.viewInputs.get('phase').input.checked = true;
  ui.viewInputs.get('phase').input.dispatch('change');
  assert.deepEqual(ui.displayControl.children, [smoothing.row, impulse.row]);
  assert.equal(smoothing.range.disabled, false);
  assert.equal(impulse.range.disabled, true);
  smoothing.range.dispatch('input');
  assert.equal(changes.at(-1).configuration.graphView, 'phase');
  assert.equal(changes.at(-1).configuration.displaySettings.smoothingOct, 0.31);
  assert.equal(changes.at(-1).meta.displayCommit, false);
  ui.viewInputs.get('minimumGroupDelay').input.checked = true;
  ui.viewInputs.get('minimumGroupDelay').input.dispatch('change');
  assert.equal(smoothing.range.disabled, false);
  assert.equal(impulse.range.disabled, true);
  ui.viewInputs.get('excessGroupDelay').input.checked = true;
  ui.viewInputs.get('excessGroupDelay').input.dispatch('change');
  assert.equal(smoothing.range.disabled, false);
  assert.equal(impulse.range.disabled, true);
  ui.viewInputs.get('impulse').input.checked = true;
  ui.viewInputs.get('impulse').input.dispatch('change');
  assert.equal(smoothing.range.disabled, true);
  assert.equal(impulse.range.disabled, false);
  assert.equal(impulse.label.textContent, 'Impulse Range (ms):');
  assert.equal(impulse.range.min, '1');
  assert.equal(impulse.range.max, '50');
  assert.equal(impulse.range.step, '0.1');
  impulse.number.value = '12.4';
  impulse.number.dispatch('input');
  assert.equal(impulse.range.value, '12.4');
  assert.equal(impulse.range.style['--et-range-fill'], `${((12.4 - 1) / (50 - 1)) * 100}%`);
  assert.equal(changes.at(-1).meta.displayCommit, false);
  const changesBeforeIncompleteNumber = changes.length;
  impulse.number.value = '-';
  impulse.number.dispatch('input');
  assert.equal(changes.length, changesBeforeIncompleteNumber);
  const commitsBeforeEnter = changes.filter(change => change.meta.displayCommit).length;
  impulse.number.value = '99';
  impulse.number.dispatch('input');
  impulse.number.focus();
  let enterPrevented = false;
  impulse.number.dispatch('keydown', {
    key: 'Enter',
    preventDefault() { enterPrevented = true; }
  });
  assert.equal(enterPrevented, true);
  assert.equal(changes.length, changesBeforeIncompleteNumber + 2);
  assert.equal(changes.at(-1).meta.displayCommit, true);
  assert.equal(changes.filter(change => change.meta.displayCommit).length, commitsBeforeEnter + 1);
  assert.equal(impulse.number.value, '50');
  assert.deepEqual(ui.getConfiguration().displaySettings, { smoothingOct: 0.31, impulseRangeMs: 50 });
});

uiTest('Unit Impulse keeps its own capture length and disables only periodic controls', () => {
  const fixture = createFixture();
  const changes = [];
  const ui = new PipelineAnalyzerUI({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    onConfigurationChange: configuration => changes.push(configuration)
  });
  setFormat(ui);
  ui.sequenceSelect.value = '131071';
  ui.sequenceSelect.dispatch('change');
  ui.signalSelect.value = 'impulse';
  ui.signalSelect.dispatch('change');
  assert.equal(ui.sequenceSelect.disabled, false);
  assert.deepEqual(ui.sequenceSelect.children.map(option => Number(option.value)),
    [32768, 65536, 131072, 262144, 524288]);
  assert.equal(ui.stabilizationInput.disabled, true);
  assert.equal(ui.averagingInput.disabled, true);
  assert.equal(ui.levelInput.disabled, false);
  assert.equal(ui.getConfiguration().measurementSettings.sequenceLength, 131072);
  assert.equal(ui.measurementTiming.children.length, 1);
  assert.match(ui.measurementTiming.children[0].textContent, /131072 samples \(2\.73 s\)/);
  assert.doesNotMatch(ui.measurementTiming.textContent, /support|stabilization|recommended/i);
  setFormat(ui, 2, 96000);
  assert.match(ui.measurementTiming.children[0].textContent, /131072 samples \(1\.37 s\)/);
  ui.sequenceSelect.value = '32768';
  ui.sequenceSelect.dispatch('change');
  assert.equal(changes.at(-1).measurementSettings.sequenceLength, 32768);
  assert.match(ui.measurementTiming.children[0].textContent, /32768 samples \(0\.341 s\)/);
  ui.signalSelect.value = 'mls';
  ui.signalSelect.dispatch('change');
  assert.equal(ui.sequenceSelect.disabled, false);
  assert.equal(ui.sequenceSelect.value, '32767');
  assert.equal(changes.at(-1).measurementSettings.signalType, 'mls');
});

uiTest('TSP uses matching power-of-two lengths and periodic controls', () => {
  const fixture = createFixture();
  const ui = new PipelineAnalyzerUI({ documentRef: fixture.documentRef, windowRef: fixture.windowRef });
  setFormat(ui);
  assert.deepEqual(ui.signalSelect.children.map(option => option.value), ['mls', 'tsp', 'impulse']);
  ui.signalSelect.value = 'tsp';
  ui.signalSelect.dispatch('change');
  assert.equal(ui.sequenceSelect.value, '65536');
  assert.deepEqual(ui.sequenceSelect.children.map(option => Number(option.value)),
    [32768, 65536, 131072, 262144, 524288]);
  assert.equal(ui.sequenceSelect.disabled, false);
  assert.equal(ui.stabilizationInput.disabled, false);
  assert.equal(ui.averagingInput.disabled, false);
  ui.sequenceSelect.value = '131072';
  ui.sequenceSelect.dispatch('change');
  ui.signalSelect.value = 'impulse';
  ui.signalSelect.dispatch('change');
  assert.equal(ui.sequenceSelect.value, '131072');
  assert.equal(ui.sequenceSelect.disabled, false);
  ui.signalSelect.value = 'mls';
  ui.signalSelect.dispatch('change');
  assert.equal(ui.sequenceSelect.value, '131071');
  ui.signalSelect.value = 'tsp';
  ui.signalSelect.dispatch('change');
  assert.equal(ui.sequenceSelect.value, '131072');
});

uiTest('adds distinct participating outputs to the device limit and never deletes the last row', () => {
  const fixture = createFixture();
  const changes = [];
  const ui = new PipelineAnalyzerUI({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    onConfigurationChange: configuration => changes.push(configuration)
  });
  setFormat(ui, 3);
  assert.ok(ui.outputElements[0].deleteButton === null, 'the only Output must not have a delete button');
  ui.addOutputButton.dispatch('click');
  ui.addOutputButton.dispatch('click');
  assert.deepEqual(ui.getConfiguration().outputs.map(output => output.channel), [0, 1, 2]);
  assert.equal(ui.addOutputButton.disabled, true);
  assert.equal(ui.outputElements.every(row => row.deleteButton), true);
  assert.equal(ui.outputElements[0].deleteButton.children[0].tagName, 'SVG');
  assert.equal(ui.outputElements[0].deleteButton.getAttribute('aria-label'), 'Delete Output 1');
  assert.equal(ui.outputElements[0].output.children[1].disabled, true);
  ui.outputElements[1].deleteButton.dispatch('click');
  assert.deepEqual(ui.getConfiguration().outputs.map(output => output.channel), [0, 2]);
  ui.outputElements[1].deleteButton.dispatch('click');
  assert.equal(ui.getConfiguration().outputs.length, 1);
  assert.ok(ui.outputElements[0].deleteButton === null, 'the surviving Output must not have a delete button');
  assert.ok(
    fixture.documentRef.activeElement === ui.outputElements[0].output,
    'the surviving Output selector must retain focus'
  );
  assert.equal(changes.at(-1).outputs.length, 1);
  assert.equal(MAX_OUTPUT_SLOTS, 4);
});

uiTest('keeps missing speaker IR references explicit and lets identity clear them', () => {
  const fixture = createFixture();
  const ui = new PipelineAnalyzerUI({ documentRef: fixture.documentRef, windowRef: fixture.windowRef });
  setFormat(ui);
  ui.setConfiguration({
    inputChannel: 0,
    graphView: 'frequency',
    measurementSettings: {},
    outputs: [{ channel: 0, measurementId: 'missing', pointId: 'missing-point' }]
  });
  const row = ui.outputElements[0];
  assert.equal(row.measurement.value, 'missing');
  assert.equal(row.measurement.children.at(-1).textContent, '—');
  assert.equal(row.measurement.children.at(-1).disabled, true);
  assert.equal(row.point.value, 'missing-point');
  assert.equal(row.point.children.at(-1).textContent, '—');
  assert.equal(row.point.children.at(-1).disabled, true);
  row.measurement.value = '';
  row.measurement.dispatch('change');
  assert.deepEqual(ui.getConfiguration().outputs[0], { channel: 0, measurementId: null, pointId: null });
});

uiTest('renders five two-curve graph views with synchronized hover and legend highlighting', () => {
  const fixture = createFixture();
  const ui = new PipelineAnalyzerUI({ documentRef: fixture.documentRef, windowRef: fixture.windowRef });
  setFormat(ui);
  const view = {
    xTicks: [{ position: 0, label: '20 Hz' }, { position: 1, label: '20 kHz' }],
    yTicks: [{ position: 0, label: '6 dB' }, { position: 1, label: '-18 dB' }],
    curves: [
      { id: 'before', label: 'Before', color: '#b0b0b0', opacity: 0.7, points: [{ x: 0, y: 0.5, xValue: 20, yValue: 0 }, { x: 1, y: 0.25, xValue: 20000, yValue: 6 }] },
      { id: 'after', label: 'After', color: '#00ff00', opacity: 1, points: [{ x: 0, y: 0.6, xValue: 20, yValue: -2 }, { x: 1, y: 0.4, xValue: 20000, yValue: 2 }] }
    ]
  };
  ui.setResult({
    sampleRate: 48000,
    captureLength: 65535,
    reportedLatency: 64,
    measurementSettings: { ...ui.getConfiguration().measurementSettings },
    measurement: {
      stabilizationSeconds: 16.384,
      totalStimulusSeconds: 19.114,
      recommendedStabilizationPeriods: 3
    },
    warnings: [{ code: 'period-residual', details: { residualDb: -30 } }],
    views: {
      frequency: view,
      phase: view,
      minimumGroupDelay: view,
      excessGroupDelay: view,
      impulse: view
    }
  });
  assert.equal(ui.viewInputs.size, 5);
  assert.ok(ui.legend.parentNode === ui.graphShell, 'the legend must stay in the graph shell');
  assert.ok(ui.viewGroup.parentNode === ui.graphSection, 'the view group must stay outside the graph shell');
  assert.equal(ui.viewLabel.textContent, 'Graph:');
  assert.equal(ui.viewGroup.classList.contains('parameter-row'), true);
  assert.equal(ui.viewGroup.classList.contains('radio-group'), true);
  for (const { input, text } of ui.viewInputs.values()) {
    assert.equal(input.parentNode, text.parentNode);
    assert.equal(input.parentNode.classList.contains('pipeline-analyzer-view-option'), true);
  }
  assert.equal(ui.legend.querySelectorAll('.pipeline-analyzer-legend-row').length, 2);
  assert.equal(ui.legend.children[1].querySelector('.pipeline-analyzer-legend-label').textContent, 'Before');
  assert.equal(ui.legend.children[2].querySelector('.pipeline-analyzer-legend-label').textContent, 'After');
  assert.equal(ui.legend.children[1].style.color, '#b0b0b0');
  assert.equal(ui.legend.children[1].style.opacity, '0.7');
  const grid = ui.graphSvg.children[0];
  assert.equal(grid.className, 'pipeline-analyzer-grid');
  assert.equal(grid.children.length, 4);
  assert.deepEqual(
    grid.children.map(line => [line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')]),
    [
      ['0', '0', '0', '480'],
      ['1024', '0', '1024', '480'],
      ['0', '0', '1024', '0'],
      ['0', '480', '1024', '480']
    ]
  );
  const axes = ui.graphSvg.children[1];
  assert.equal(axes.children[2].getAttribute('x'), '20.48');
  assert.equal(axes.children[2].getAttribute('y'), '5');
  assert.equal(axes.children[3].getAttribute('y'), '475');
  assert.equal(ui.graphSvg.children.some(child => child.tagName === 'PATH' && child.attributes.stroke === '#00ff00'), true);
  ui.graphShell.dispatch('pointermove', { clientX: 512, clientY: 240 });
  assert.match(ui.cursorX.textContent, /kHz$/);
  assert.equal(ui.hoverSvg.querySelectorAll('.pipeline-analyzer-cursor-marker').length, 2);
  assert.ok(ui.legendValues.get('before').textContent.length > 0);
  assert.ok(ui.legendValues.get('after').textContent.length > 0);
  const beforePath = ui.curvePaths.get('before');
  const afterPath = ui.curvePaths.get('after');
  ui.legend.children[1].dispatch('mouseenter');
  assert.equal(beforePath.classList.contains('is-highlighted'), true);
  assert.equal(afterPath.classList.contains('is-hidden'), true);
  assert.equal(ui.hoverSvg.querySelectorAll('.pipeline-analyzer-cursor-marker').length, 1);
  assert.equal(ui.legendValues.get('after').textContent, '');
  assert.ok(ui.graphSvg.children.at(-1) === beforePath, 'highlighted curve must render last');
  ui.legend.children[1].dispatch('mouseleave');
  assert.equal(beforePath.classList.contains('is-highlighted'), false);
  assert.equal(afterPath.classList.contains('is-hidden'), false);
  assert.equal(ui.hoverSvg.querySelectorAll('.pipeline-analyzer-cursor-marker').length, 2);
  assert.ok(ui.graphSvg.children[2] === beforePath, 'curve order must be restored');
  for (const viewName of [
    'phase',
    'minimumGroupDelay',
    'excessGroupDelay',
    'impulse',
    'frequency'
  ]) {
    ui.viewInputs.get(viewName).input.checked = true;
    ui.viewInputs.get(viewName).input.dispatch('change');
    ui.graphShell.dispatch('pointermove', { clientX: 512, clientY: 240 });
    ui.legend.children[1].dispatch('mouseenter');
    assert.equal(ui.curvePaths.get('after').classList.contains('is-hidden'), true);
    assert.equal(ui.hoverSvg.querySelectorAll('.pipeline-analyzer-cursor-marker').length, 1);
    assert.equal(ui.legendValues.get('after').textContent, '');
    ui.legend.children[1].dispatch('mouseleave');
    assert.equal(ui.curvePaths.get('after').classList.contains('is-hidden'), false);
    assert.equal(ui.hoverSvg.querySelectorAll('.pipeline-analyzer-cursor-marker').length, 2);
  }
  ui.graphShell.dispatch('pointerleave');
  assert.equal(ui.hoverSvg.children.length, 0);
  assert.equal(ui.cursorX.textContent, '');
  assert.equal(ui.legendValues.get('before').textContent, '');
  ui.graphShell.dispatch('pointermove', { clientX: -1, clientY: 240 });
  assert.equal(ui.hoverSvg.children.length, 0);
  ui.graphSvg.getBoundingClientRect = () => ({ left: 20, top: 20, width: 400, height: 240 });
  ui.syncGraphSize();
  assert.equal(ui.graphSvg.getAttribute('viewBox'), '0 0 400 240');
  assert.equal(ui.hoverSvg.getAttribute('viewBox'), '0 0 400 240');
  ui.viewInputs.get('phase').input.checked = true;
  ui.viewInputs.get('phase').input.dispatch('change');
  assert.equal(ui.getConfiguration().graphView, 'phase');
  const phaseAxes = ui.graphSvg.children[1];
  assert.equal(phaseAxes.children[2].getAttribute('x'), '2');
  assert.equal(phaseAxes.children[2].getAttribute('y'), '5');
  ui.setConfiguration({
    ...ui.getConfiguration(),
    measurementSettings: {
      signalType: 'tsp', levelDb: -12, sequenceLength: 65536,
      stabilizationPeriods: 12, averagingPeriods: 2
    }
  });
  ui.setResult({
    sampleRate: 48000,
    measurementSettings: { ...ui.getConfiguration().measurementSettings },
    measurement: { stabilizationSeconds: 16.384, totalStimulusSeconds: 19.114 },
    views: {
      frequency: view,
      phase: view,
      minimumGroupDelay: view,
      excessGroupDelay: view,
      impulse: view
    }
  });
});

uiTest('limits hover interpolation to finite adjacent points inside each curve span', () => {
  const fixture = createFixture();
  const ui = new PipelineAnalyzerUI({ documentRef: fixture.documentRef, windowRef: fixture.windowRef });
  const points = [
    { x: 0.2, y: 0.5, xValue: 20, yValue: 0 },
    { x: 0.4, y: 0.4, xValue: 100, yValue: 1 },
    { x: Number.NaN, y: Number.NaN, xValue: 200, yValue: Number.NaN },
    { x: 0.6, y: 0.6, xValue: 1000, yValue: -1 },
    { x: 0.8, y: 0.5, xValue: 20000, yValue: 0 }
  ];
  const view = {
    xTicks: [],
    yTicks: [],
    curves: [
      { id: 'before', label: 'Before', color: '#b0b0b0', opacity: 0.7, points },
      { id: 'after', label: 'After', color: '#00ff00', opacity: 1, points }
    ]
  };
  ui.setResult({
    views: {
      frequency: view,
      phase: view,
      minimumGroupDelay: view,
      excessGroupDelay: view,
      impulse: view
    }
  });

  ui.graphShell.dispatch('pointermove', { clientX: 512, clientY: 240 });
  assert.equal(ui.hoverSvg.children.length, 0);
  assert.equal(ui.legendValues.get('before').textContent, '');
  ui.graphShell.dispatch('pointermove', { clientX: 100, clientY: 240 });
  assert.equal(ui.hoverSvg.children.length, 0);
  ui.graphShell.dispatch('pointermove', { clientX: 204.8, clientY: 240 });
  assert.equal(ui.hoverSvg.querySelectorAll('.pipeline-analyzer-cursor-marker').length, 2);
});

uiTest('contains no nonnumeric message regions and retains graph semantics', () => {
  const source = fs.readFileSync(new URL('../../js/pipeline-analyzer/ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /measurementWarnings|graphEmpty|staleBadge|provenance|setStatus|pipeline-analyzer-(?:status|warnings|provenance|graph-empty|stale-badge)/);
  const fixture = createFixture();
  const ui = new PipelineAnalyzerUI({ documentRef: fixture.documentRef, windowRef: fixture.windowRef });
  assert.equal(ui.graphSvg.getAttribute('role'), 'img');
  assert.equal(ui.graphSvg.getAttribute('aria-label'), 'Pipeline response graph');
  assert.equal(ui.graphSvg.getAttribute('aria-busy'), undefined);
  assert.equal(ui.graphSpinner.hidden, true);
  ui.setMeasuring(true);
  assert.equal(ui.graphSvg.getAttribute('aria-busy'), 'true');
  assert.equal(ui.graphSpinner.hidden, false);
  ui.setResult({ views: {} }, { stale: false });
  assert.equal(ui.graphSvg.getAttribute('aria-busy'), 'false');
  assert.equal(ui.graphSpinner.hidden, true);
  ui.setResult({ views: {} }, { stale: true });
  assert.equal(ui.graphSvg.getAttribute('aria-busy'), 'true');
  assert.equal(ui.graphSpinner.hidden, false);
  assert.ok(ui.measurementTiming.parentNode === ui.settingsBody, 'numeric measurement guidance must remain');
  assert.equal(ui.collapseButton.children[0].tagName, 'SVG');
  assert.equal(ui.closeButton.children[0].tagName, 'SVG');
  assert.equal(ui.addOutputButton.children[0].tagName, 'SVG');
  assert.equal(ui.addOutputButton.getAttribute('aria-label'), 'Add Output');
  assert.equal(ui.closeButton.children[0].children[0].getAttribute('d'), 'M6 6l12 12M18 6L6 18');
  ui.setMeasurements([]);
  assert.equal(ui.refreshButton.disabled, false);
  assert.ok(
    ui.routesSection.querySelector('.pipeline-analyzer-notice') === null,
    'the routes section must not contain explanatory notice copy'
  );
  ui.setMeasurementStoreAvailable(false);
  assert.equal(ui.refreshButton.disabled, false);
  setFormat(ui);
  assert.equal(ui.inputSelect.disabled, false);
  assert.equal(ui.outputElements[0].output.disabled, false);
  assert.equal(ui.outputElements[0].measurement.disabled, true);
  assert.equal(ui.outputElements[0].point.disabled, true);
});

uiTest('fully wired Controller round trips preserve focus after editing, adding, and deleting outputs', () => {
  const fixture = createFixture();
  let controller;
  const ui = new PipelineAnalyzerUI({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
    onConfigurationChange: (configuration, meta) => controller.setConfiguration(configuration, meta)
  });
  const audioManager = {
    currentPipeline: 'A',
    masterBypass: false,
    contextManager: {
      audioContext: { sampleRate: 48000, destination: { channelCount: 3 } }
    },
    getCurrentPipeline: () => [],
    getEnabledDspTypes: () => [],
    addEventListener() {},
    removeEventListener() {}
  };
  controller = new PipelineAnalyzerController({
    audioManager,
    workletSync: { preparePluginData: () => ({}) },
    ui,
    storage: null,
    openMeasurementStore: async () => null
  });
  controller.initialize();
  ui.setMeasurements([{ id: 'room', name: 'Room', points: [{ id: 'seat', label: 'Seat' }] }]);

  const smoothingNumber = ui.displayControls.smoothingOct.number;
  smoothingNumber.focus();
  smoothingNumber.value = '0.31';
  smoothingNumber.dispatch('input');
  assert.ok(
    fixture.documentRef.activeElement === smoothingNumber,
    'display number focus must survive the Controller round trip'
  );
  assert.equal(smoothingNumber.value, '0.31');

  ui.addOutputButton.dispatch('click');
  assert.ok(
    fixture.documentRef.activeElement === ui.outputElements[1].output,
    'the added Output selector must receive focus'
  );

  ui.outputElements[1].measurement.value = 'room';
  ui.outputElements[1].measurement.dispatch('change');
  assert.ok(
    fixture.documentRef.activeElement === ui.outputElements[1].measurement,
    'the edited measurement selector must retain focus'
  );
  ui.outputElements[1].point.focus();
  ui.outputElements[1].point.value = 'seat';
  ui.outputElements[1].point.dispatch('change');
  const point = ui.outputElements[1].point;
  assert.ok(
    fixture.documentRef.activeElement === point,
    'point focus should survive the Controller round trip'
  );

  ui.outputElements[0].deleteButton.dispatch('click');
  assert.ok(
    fixture.documentRef.activeElement === ui.outputElements[0].output,
    'the nearest surviving Output selector must receive focus'
  );
  controller.dispose();
});

uiTest('reparents the same panel without losing focus or state and disposes observers', () => {
  const fixture = createFixture();
  const ui = new PipelineAnalyzerUI({ documentRef: fixture.documentRef, windowRef: fixture.windowRef });
  ui.setOpen(true);
  ui.setCollapsed(true);
  ui.closeButton.focus();
  fixture.setNarrow(true);
  ui.syncPlacement();
  assert.ok(fixture.panel.parentNode === fixture.pipeline, 'the panel must move into the pipeline');
  assert.ok(fixture.panel.nextSibling === fixture.pipelineList, 'the panel must precede the pipeline list');
  assert.ok(fixture.documentRef.activeElement === ui.closeButton, 'reparenting must preserve focus');
  assert.equal(ui.collapsed, true);
  ui.setCollapsed(false);
  ui.closeButton.dispatch('click');
  assert.ok(fixture.documentRef.activeElement === fixture.button, 'closing must return focus to the opener');
  fixture.setNarrow(false);
  ui.syncPlacement();
  assert.ok(fixture.panel.parentNode === fixture.main, 'the panel must return to the main layout');
  assert.ok(fixture.panel.previousSibling === fixture.pipeline, 'the panel must follow the pipeline');
  ui.dispose();
  assert.equal(fixture.windowListeners.has('resize'), false);
  assert.equal(fixture.observerDisconnected(), true);
});
