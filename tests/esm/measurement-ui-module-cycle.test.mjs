import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createGraphGeometry } from '../../features/measurement/graph-geometry.js';
import CorrectionHandler, {
  smoothingToBinsPerOct
} from '../../features/measurement/ui/correction-handler.js';
import {
  buildPEQClipboardPayload,
  copyPEQClipboardPayload
} from '../../features/measurement/ui/peq-clipboard.js';
import { UIManager } from '../../features/measurement/ui/ui-manager.js';

const controllerModules = [
  '../../features/measurement/measurement-controller/index.js',
  '../../features/measurement/measurement-controller/level-adjustment.js',
  '../../features/measurement/measurement-controller/sweep-measurement.js'
];

const internalModules = [
  '../../features/measurement/app.js',
  '../../features/measurement/ui/ui-manager.js',
  '../../features/measurement/measurement-controller/index.js',
  '../../features/measurement/measurement-controller/level-adjustment.js',
  '../../features/measurement/measurement-controller/sweep-measurement.js',
  '../../features/measurement/measurement-controller/graph-utils.js',
  '../../features/measurement/measurement-controller/audio-processing.js'
];

test('measurement controller modules import the canonical UI module without compatibility shims', async () => {
  for (const modulePath of controllerModules) {
    const source = readFileSync(new URL(modulePath, import.meta.url), 'utf8');
    assert.match(source, /from ['"]\.\.\/ui\/ui-manager\.js['"]/);
    assert.doesNotMatch(source, /from ['"]\.\.\/uiManager\.js['"]/);
  }

  const cacheBustedEntry = new URL(
    '../../features/measurement/ui/ui-manager.js?dev=cycle-test',
    import.meta.url
  );
  const { default: uiManager } = await import(cacheBustedEntry.href);
  assert.equal(typeof uiManager.showScreen, 'function');

  for (const legacyName of [
    'audioUtils.js',
    'measurementController.js',
    'peqCalculator.js',
    'uiManager.js'
  ]) {
    assert.equal(existsSync(new URL(`../../features/measurement/${legacyName}`, import.meta.url)), false);
  }
});

test('measurement implementation modules bypass cache-busted compatibility entries', () => {
  const appSource = readFileSync(
    new URL('../../features/measurement/app.js', import.meta.url),
    'utf8'
  );
  for (const modulePath of internalModules) {
    const source = readFileSync(new URL(modulePath, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /(?:\.\.\/|\.\/)(?:audioUtils|uiManager|measurementController|peqCalculator)\.js['"]/
    );
  }

  const html = readFileSync(
    new URL('../../features/measurement/measurement.html', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    html,
    /<script[^>]+src="(?:audioUtils|dataStorage|uiManager|measurementController|peqCalculator|i18n)\.js"/
  );

  const correctionSource = readFileSync(
    new URL('../../features/measurement/ui/correction-handler.js', import.meta.url),
    'utf8'
  );
  assert.match(correctionSource, /import \{ PEQCalculator \} from ['"]\.\.\/peq-calculator\/peq-calculator\.js['"]/);
  assert.match(correctionSource, /smoothingToBinsPerOct\(settings\.smoothing\)/);
  assert.doesNotMatch(appSource, /initializePEQCalculator|window\.PEQCalculator/);
});

test('PEQ smoothing conversion preserves both slider boundaries', () => {
  assert.equal(smoothingToBinsPerOct(0.01), 3.21);
  assert.equal(smoothingToBinsPerOct(1), 24);
});

test('new measurement startup serializes audio initialization and device population', () => {
  const appSource = readFileSync(
    new URL('../../features/measurement/app.js', import.meta.url),
    'utf8'
  );
  const uiSource = readFileSync(
    new URL('../../features/measurement/ui/ui-manager.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(appSource, /newMeasurementBtn[^;]+addEventListener/);
  assert.match(
    uiSource,
    /await window\.app\.initializeAudio\(\);\s+await window\.app\.populateAudioDevices\(\);/
  );
});

test('measurement setup failure restores every configuration control', () => {
  const appSource = readFileSync(
    new URL('../../features/measurement/app.js', import.meta.url),
    'utf8'
  );
  const submitStart = appSource.indexOf(
    "document.getElementById('configForm').addEventListener('submit'"
  );
  const submitEnd = appSource.indexOf('// White noise toggle button', submitStart);
  const submitSource = appSource.slice(submitStart, submitEnd);

  assert.notEqual(submitStart, -1);
  assert.match(submitSource, /uiManager\.setConfigFormBusy\(configForm, true\);/);
  assert.match(
    submitSource,
    /finally \{[\s\S]*?configSubmissionPromise = null;[\s\S]*?uiManager\.setConfigFormBusy\(configForm, false\);/
  );
});

test('back-from-sweep transition has one single-flight owner with retryable cleanup', () => {
  const appSource = readFileSync(
    new URL('../../features/measurement/app.js', import.meta.url),
    'utf8'
  );
  const controllerSource = readFileSync(
    new URL('../../features/measurement/measurement-controller/index.js', import.meta.url),
    'utf8'
  );

  assert.equal(
    [...appSource.matchAll(/backFromSweepButton\.addEventListener/g)].length,
    1
  );
  assert.doesNotMatch(controllerSource, /backFromSweepBtn/);
  const transitionStart = appSource.indexOf(
    "const backFromSweepButton = document.getElementById('backFromSweepBtn');"
  );
  const transitionEnd = appSource.indexOf(
    '// Add window beforeunload event',
    transitionStart
  );
  const transitionSource = appSource.slice(transitionStart, transitionEnd);
  const guardIndex = transitionSource.indexOf(
    'if (backFromSweepTransitionPromise) return;'
  );
  const cancelIndex = transitionSource.indexOf(
    'measurementController.cancelMeasurement();'
  );

  assert.notEqual(transitionStart, -1);
  assert.ok(guardIndex >= 0 && guardIndex < cancelIndex);
  assert.match(transitionSource, /backFromSweepButton\.disabled = true;/);
  assert.match(
    transitionSource,
    /Promise\.resolve\(\)\.then\(async \(\) =>[\s\S]*?await measurementController\.prepareForLevelAdjustment\(\)/
  );
  assert.match(
    transitionSource,
    /finally \{[\s\S]*?backFromSweepTransitionPromise = null;[\s\S]*?backFromSweepButton\.disabled = false;/
  );
});

test('graph geometry preserves logarithmic frequency and linear value endpoints', () => {
  const geometry = createGraphGeometry({
    width: 1000,
    height: 500,
    padding: { top: 20, right: 20, bottom: 30, left: 50 },
    minFrequency: 20,
    maxFrequency: 20000,
    minValue: -24,
    maxValue: 24
  });

  assert.equal(geometry.frequencyToX(20), 50);
  assert.equal(geometry.frequencyToX(20000), 980);
  assert.equal(geometry.frequencyToX(200), 360);
  assert.ok(Math.abs(geometry.xToFrequency(360) - 200) < 1e-10);
  assert.equal(geometry.valueToY(24), 20);
  assert.equal(geometry.valueToY(-24), 470);
  assert.equal(geometry.valueToY(0), 245);
  assert.equal(geometry.yToValue(245), 0);
});

test('PEQ clipboard payload preserves band layout, order, channel, and formatting', () => {
  const parameters = Array.from({ length: 15 }, (_, index) => ({
    frequency: 15000 - index * 900,
    gain: index - 7,
    Q: 0.5 + index / 10
  }));

  for (let bandCount = 3; bandCount <= 15; bandCount += 1) {
    const payload = buildPEQClipboardPayload({
      outputChannel: bandCount % 2 ? 'left' : 'right',
      peqParameters: parameters.slice(0, bandCount)
    }, bandCount);
    const [effect] = JSON.parse(payload);
    const slotCount = bandCount >= 6 ? 15 : 5;
    assert.equal(effect.nm, bandCount >= 6 ? '15Band PEQ' : '5Band PEQ');
    assert.equal(effect.ch, bandCount % 2 ? 'L' : 'R');
    assert.equal(Array.from({ length: slotCount }, (_, index) => effect[`e${index}`])
      .filter(Boolean).length, bandCount);
    const assigned = Array.from({ length: slotCount }, (_, index) =>
      effect[`e${index}`] ? effect[`f${index}`] : null).filter(value => value !== null);
    assert.deepEqual(assigned, parameters.slice(0, bandCount)
      .map(parameter => parameter.frequency).sort((left, right) => left - right));
    assert.equal(payload, JSON.stringify([effect], null, 2));
  }

  assert.equal(buildPEQClipboardPayload({
    outputChannel: 'left',
    peqParameters: parameters.slice(0, 3)
  }, 3), JSON.stringify([{
    nm: '5Band PEQ',
    en: true,
    ch: 'L',
    f0: 13200, g0: -5, q0: 0.7, t0: 'pk', e0: true,
    f1: 316, g1: 0, q1: 1, t1: 'pk', e1: false,
    f2: 14100, g2: -6, q2: 0.6, t2: 'pk', e2: true,
    f3: 3160, g3: 0, q3: 1, t3: 'pk', e3: false,
    f4: 15000, g4: -7, q4: 0.5, t4: 'pk', e4: true
  }], null, 2));
});

test('PEQ clipboard completion follows the asynchronous write result', async () => {
  let resolveWrite;
  let settled = false;
  const measurement = {
    peqParameters: [{ frequency: 1000, gain: -2, Q: 1 }]
  };
  const pending = copyPEQClipboardPayload(measurement, 3, () =>
    new Promise(resolve => { resolveWrite = resolve; }));
  pending.finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveWrite(true);
  await pending;
  assert.equal(settled, true);

  await assert.rejects(
    copyPEQClipboardPayload(measurement, 3, async () => false),
    /Clipboard write was rejected/
  );
  await assert.rejects(
    copyPEQClipboardPayload(measurement, 3, async () => {
      throw new Error('clipboard unavailable');
    }),
    /clipboard unavailable/
  );
});

test('correction scheduler runs only the last request and closes the spinner', async t => {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const spinner = { style: { display: 'none' } };
  const callbacks = new Map();
  let nextTimerId = 1;
  globalThis.document = { getElementById: () => spinner };
  globalThis.setTimeout = callback => {
    const timerId = nextTimerId++;
    callbacks.set(timerId, callback);
    return timerId;
  };
  globalThis.clearTimeout = timerId => callbacks.delete(timerId);
  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  const notices = [];
  const handler = new CorrectionHandler({
    measurementStateGeneration: 2,
    showNotification: (...args) => notices.push(args)
  });
  const generations = [];
  handler.updateCorrection = async generation => { generations.push(generation); };
  handler.requestCorrectionUpdate(1);
  handler.requestCorrectionUpdate(2);
  assert.equal(callbacks.size, 1);
  callbacks.values().next().value();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(generations, [2]);
  assert.equal(spinner.style.display, 'none');

  handler.updateCorrection = async () => { throw new Error('developer-only detail'); };
  handler.requestCorrectionUpdate(2);
  callbacks.values().next().value();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(spinner.style.display, 'none');
  assert.equal(notices.length, 1);
  assert.doesNotMatch(notices[0][0], /developer-only detail/);
});

test('showScreen cleans up only when leaving an audio-active screen', () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    body: { classList: { contains: () => false } }
  };
  try {
    const manager = {
      currentScreen: 'levelAdjustmentScreen',
      cleanupCalls: 0,
      cleanupAudioBeforeNavigation() { this.cleanupCalls += 1; }
    };
    UIManager.prototype.showScreen.call(manager, 'measurementConfigScreen');
    assert.equal(manager.cleanupCalls, 1);
    UIManager.prototype.showScreen.call(manager, 'resultsDisplayScreen');
    assert.equal(manager.cleanupCalls, 1);
    manager.currentScreen = 'levelAdjustmentScreen';
    UIManager.prototype.showScreen.call(manager, 'sweepMeasurementScreen');
    UIManager.prototype.showScreen.call(manager, 'sweepMeasurementScreen');
    assert.equal(manager.cleanupCalls, 1);
    UIManager.prototype.showScreen.call(manager, 'resultsDisplayScreen');
    assert.equal(manager.cleanupCalls, 2);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('navigation callers leave transition cleanup to showScreen while unload remains independent', () => {
  const appSource = readFileSync(
    new URL('../../features/measurement/app.js', import.meta.url), 'utf8'
  );
  const uiSource = readFileSync(
    new URL('../../features/measurement/ui/ui-manager.js', import.meta.url), 'utf8'
  );
  const displaySource = readFileSync(
    new URL('../../features/measurement/ui/measurement-display.js', import.meta.url), 'utf8'
  );
  const controllerSource = readFileSync(
    new URL('../../features/measurement/measurement-controller/index.js', import.meta.url), 'utf8'
  );
  const backStart = appSource.indexOf("document.getElementById('backFromLevelBtn')");
  const backEnd = appSource.indexOf('const backFromSweepButton', backStart);
  const startNewStart = uiSource.indexOf('async startNewMeasurement()');
  const startNewEnd = uiSource.indexOf('prepareConfigScreen()', startNewStart);
  const selectStart = displaySource.indexOf('async selectMeasurement(id)');
  const selectEnd = displaySource.indexOf('displayMeasurementDetails(', selectStart);

  assert.doesNotMatch(appSource.slice(backStart, backEnd), /cleanupAudioBeforeNavigation/);
  assert.doesNotMatch(uiSource.slice(startNewStart, startNewEnd), /cleanupAudioBeforeNavigation/);
  assert.doesNotMatch(displaySource.slice(selectStart, selectEnd), /cleanupAudioBeforeNavigation/);
  assert.doesNotMatch(controllerSource, /backFromLevelBtn|returnToConfigScreen/);
  assert.match(
    appSource,
    /beforeunload[\s\S]*?cleanupAudioBeforeNavigation\(\)/
  );
});

test('measurement user-facing error keys exist in every locale', () => {
  const localeNames = ['ar', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'];
  const keys = [
    'audioUnsupported', 'audioInitFailed', 'measurementNameRequired',
    'invalidSweepRange', 'testSignalFailed', 'measurementConfigUnavailable',
    'measurementFailed', 'measurementImportFailed', 'clipboardWriteFailed',
    'correctionUpdateFailed', 'measurementDisplayFailed'
  ];
  for (const localeName of localeNames) {
    const source = readFileSync(new URL(
      `../../features/measurement/locales/${localeName}.json5`, import.meta.url
    ), 'utf8');
    const translations = JSON.parse(source.replace(/\/\/.*$/gm, ''));
    for (const key of keys) assert.equal(typeof translations[`error:${key}`], 'string');
  }
});
