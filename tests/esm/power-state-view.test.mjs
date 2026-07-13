import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildPowerSnapshot } from '../../js/audio/power-snapshot.js';
import { PowerStateView } from '../../js/ui/power-state-view.js';

class FakeAction {
  constructor() {
    this.hidden = true;
    this.disabled = false;
    this.textContent = '';
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.focusCalls = 0;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  click() {
    this.listeners.get('click')?.();
  }

  focus() {
    this.focusCalls++;
  }
}

function createDocument(actions = []) {
  return {
    actions,
    querySelectorAll(selector) {
      return selector === '[data-power-resume-action]' ? this.actions : [];
    }
  };
}

function createEventSource() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    emit(name, detail) {
      for (const listener of listeners.get(name) || []) listener({ detail });
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    }
  };
}

function snapshot(overrides = {}) {
  return buildPowerSnapshot({
    effectiveState: 'ACTIVE',
    desiredState: 'ACTIVE',
    topologyRevision: 1,
    ...overrides
  });
}

function readLocale(locale) {
  const source = readFileSync(
    new URL(`../../js/locales/${locale}.json5`, import.meta.url),
    'utf8'
  );
  return JSON.parse(source
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ''));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('transient power transitions never create or reveal a message surface', () => {
  const action = new FakeAction();
  const documentRef = createDocument([action]);
  const eventSource = createEventSource();
  const view = new PowerStateView({ eventSource, documentRef, onResume() {} });

  eventSource.emit('powerStateChanged', snapshot({
    transition: { state: 'resuming', operationId: 'resume-1', generation: 1 }
  }));

  assert.equal(action.hidden, true);
  assert.equal(action.textContent, 'Resume audio processing');
  assert.equal(documentRef.querySelectorAll('[data-power-state-slot]').length, 0);
  view.dispose();
});

test('only an actionable blocked state reveals an ordinary menu action', async () => {
  const action = new FakeAction();
  const documentRef = createDocument([action]);
  const eventSource = createEventSource();
  let resolveResume;
  const seen = [];
  const view = new PowerStateView({
    eventSource,
    documentRef,
    onResume(current) {
      seen.push(current);
      return new Promise(resolve => { resolveResume = resolve; });
    }
  });
  const current = snapshot({ manualResumeRequired: true });
  eventSource.emit('powerResumeRequired', { snapshot: current, reason: 'input-stopped' });

  assert.equal(action.hidden, false);
  assert.equal(action.disabled, false);
  action.click();
  assert.deepEqual(seen, [current]);
  assert.equal(action.disabled, true);
  assert.equal(action.textContent, 'Resume audio processing');
  assert.equal(action.attributes.get('aria-busy'), 'true');

  resolveResume();
  await flushPromises();
  assert.equal(action.disabled, false);
  assert.equal(action.attributes.get('aria-busy'), 'false');
  view.dispose();
});

test('replaceable menu actions are rebound without leaking click handlers', () => {
  const first = new FakeAction();
  const second = new FakeAction();
  const documentRef = createDocument([first]);
  const eventSource = createEventSource();
  let resumes = 0;
  const view = new PowerStateView({
    eventSource,
    documentRef,
    onResume() { resumes++; }
  });
  eventSource.emit('powerStateChanged', snapshot({ resourceHealth: 'blocked' }));
  assert.equal(first.listeners.has('click'), true);

  documentRef.actions = [second];
  view.refreshActions();
  assert.equal(first.listeners.has('click'), false);
  assert.equal(second.hidden, false);
  second.click();
  assert.equal(resumes, 1);

  view.dispose();
  assert.equal(second.hidden, true);
  assert.equal(second.listeners.has('click'), false);
  assert.equal(eventSource.listenerCount('powerStateChanged'), 0);
  assert.equal(eventSource.listenerCount('powerResumeRequired'), 0);
});

test('power UI uses existing menu rows and contains no custom message surface', () => {
  const html = readFileSync(new URL('../../effetune.html', import.meta.url), 'utf8');
  const desktopCss = readFileSync(new URL('../../effetune.css', import.meta.url), 'utf8');
  const mobileCss = readFileSync(new URL('../../effetune-mobile.css', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
  const contextSource = readFileSync(
    new URL('../../js/audio/audio-context-manager.js', import.meta.url),
    'utf8'
  );

  assert.match(html, /class="settings-menu-item" data-power-resume-action hidden/);
  assert.doesNotMatch(html, /powerResumeBanner|powerStateSummary|powerStateIndicator/);
  assert.doesNotMatch(desktopCss, /power-resume-banner|power-state-summary|power-state-indicator/);
  assert.doesNotMatch(mobileCss, /power-resume-banner|power-state-summary|power-state-indicator/);
  assert.doesNotMatch(appSource, /powerController\.beginUserGestureResume/);
  assert.doesNotMatch(contextSource, /powerStateDelegate\.beginUserGestureResume/);
});

test('a transport-active input latch relabels the action as microphone-specific', () => {
  const action = new FakeAction();
  const eventSource = createEventSource();
  const view = new PowerStateView({
    eventSource,
    documentRef: createDocument([action]),
    onResume() {}
  });

  eventSource.emit('powerStateChanged', snapshot({
    manualResumeRequired: true,
    transportDemand: true
  }));
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, 'Resume microphone input');

  eventSource.emit('powerStateChanged', snapshot({
    manualResumeRequired: true,
    transportDemand: true,
    resourceHealth: 'blocked'
  }));
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, 'Resume audio processing');
  view.dispose();
});

test('a transport-active input latch uses the Japanese input-only resume label', () => {
  const action = new FakeAction();
  const eventSource = createEventSource();
  const translations = readLocale('ja');
  const view = new PowerStateView({
    eventSource,
    documentRef: createDocument([action]),
    translate(key, fallback) {
      return translations[key] ?? fallback;
    },
    onResume() {}
  });

  eventSource.emit('powerStateChanged', snapshot({
    manualResumeRequired: true,
    transportDemand: true
  }));

  assert.equal(action.hidden, false);
  assert.equal(action.textContent, '音声入力を再開');
  view.dispose();
});

test('language and layout refreshes preserve the snapshot-specific resume label', () => {
  const desktopAction = new FakeAction();
  const mobileAction = new FakeAction();
  const documentRef = createDocument([desktopAction]);
  const eventSource = createEventSource();
  const translations = readLocale('ja');
  const view = new PowerStateView({
    eventSource,
    documentRef,
    onResume() {}
  });

  eventSource.emit('powerStateChanged', snapshot({
    manualResumeRequired: true,
    transportDemand: true
  }));
  assert.equal(desktopAction.textContent, 'Resume microphone input');

  view.setTranslator((key, fallback) => translations[key] ?? fallback);
  assert.equal(desktopAction.textContent, '音声入力を再開');

  documentRef.actions = [mobileAction];
  view.refreshActions();
  assert.equal(desktopAction.listeners.has('click'), false);
  assert.equal(mobileAction.hidden, false);
  assert.equal(mobileAction.textContent, '音声入力を再開');

  eventSource.emit('powerStateChanged', snapshot({ resourceHealth: 'blocked' }));
  assert.equal(mobileAction.textContent, '音声処理を再開');
  view.dispose();
});

test('a suspended or error resume keeps the generic processing label', () => {
  const action = new FakeAction();
  const eventSource = createEventSource();
  const view = new PowerStateView({
    eventSource,
    documentRef: createDocument([action]),
    onResume() {}
  });

  eventSource.emit('powerStateChanged', snapshot({
    manualResumeRequired: true,
    transportDemand: true,
    effectiveState: 'SUSPENDED'
  }));
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, 'Resume audio processing');

  eventSource.emit('powerStateChanged', snapshot({
    transitionError: {
      code: 'worklet-render-timeout',
      phase: 'power-transition',
      operationId: null,
      recoverable: true,
      messageKey: 'error.powerState.worklet-render-timeout'
    }
  }));
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, 'Resume audio processing');
  view.dispose();
});
