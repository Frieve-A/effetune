import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createGraphGeometry } from '../../features/measurement/graph-geometry.js';
import CorrectionHandler, {
  smoothingToBinsPerOct
} from '../../features/measurement/ui/correction-handler.js';
import {
  buildPerChannelPEQClipboardPayload,
  buildPEQClipboardPayload,
  copyPEQClipboardPayload
} from '../../features/measurement/ui/peq-clipboard.js';
import { UIManager } from '../../features/measurement/ui/ui-manager.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

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

test('channel correction intersects the requested range with its measured band before smoothing and solving', async () => {
  const measurement = {
    sampleRate: 48000, outputChannels: ['left', '2'],
    sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 }, perChannel: [
      { channel: 'left', minFreq: 40, maxFreq: 400 },
      { channel: '2', minFreq: 1500, maxFreq: 1800 }
    ] }
  };
  const response = [[20, 100], [1500, 0], [1550, 1], [1600, 2], [1650, 3], [1700, 2], [1750, 1], [1800, 0], [5000, -100]];
  const smoothingInputs = [];
  const calls = [];
  const manager = new UIManager();
  const handler = manager.correctionHandler;
  handler.peqCalculator.calculatePEQParameters = (...args) => { calls.push(args); return []; };
  await withGlobals({ window: { app: { audioUtils: {
    smoothFrequencyResponse: input => { smoothingInputs.push(input); return input; }
  } } } }, async () => {
    const settings = { lowFreq: 1600, highFreq: 10000, smoothing: 0.3, eqBandCount: 3 };
    await handler.calculatePEQParametersForResponse(response, settings, measurement, '2');
    assert.deepEqual(calls[0].slice(1, 4), [1600, 1800, 3]);
    assert.deepEqual(smoothingInputs[0].map(([frequency]) => frequency), [1600, 1650, 1700, 1750, 1800]);
    assert.deepEqual(calls[0][0], smoothingInputs[0]);
    assert.deepEqual(await handler.calculatePEQParametersForResponse(response,
      { ...settings, highFreq: 1000 }, measurement, '2'), []);
    assert.deepEqual(await handler.calculatePEQParametersForResponse(response.slice(0, 4),
      settings, measurement, '2'), []);
    assert.equal(calls.length, 1);
  });
});

test('channel switching clears stale EQ and shares the selected correction with clipboard and file exports', async t => {
  const measurement = {
    id: 'channel-eq', name: 'Channel EQ', outputChannels: ['left', '2'],
    averageFrequencyResponse: [[100, 1]],
    channelResponses: [
      { channel: 'left', averageFrequencyResponse: [[100, 2]] },
      { channel: '2', averageFrequencyResponse: [[1500, 3]] }
    ],
    points: [{ channels: [{ channel: 'left', frequencyResponse: [[100, 7]] }] }],
    peqParameters: [{ frequency: 200, gain: 1, Q: 1 }]
  };
  const originalGetMeasurement = dataStorage.getMeasurementById;
  dataStorage.getMeasurementById = () => measurement;
  t.after(() => { dataStorage.getMeasurementById = originalGetMeasurement; });
  const manager = new UIManager();
  manager.selectedMeasurementId = measurement.id;
  const display = manager.measurementDisplay;
  display.selectedPointIndex = 0;
  display.selectedChannel = 'left';
  manager.updateResultsGraph = () => {};
  manager.graphRenderer.updateImpulseResponseGraph = () => {};
  let requested = 0;
  manager.correctionHandler.requestCorrectionUpdate = () => { requested += 1; };
  const calculations = [];
  manager.correctionHandler.calculatePEQParametersForResponse = (response, settings, source, channel) =>
    new Promise(resolve => { calculations.push({ response, settings, source, channel, resolve }); });
  const settings = { lowFreq: 20, highFreq: 20000, smoothing: 0.3, eqBandCount: 1 };
  await withGlobals({ document: { querySelectorAll: () => [] } }, async () => {
    const earlier = manager.correctionHandler.calculatePEQParameters(settings);
    display.selectChannel('2');
    assert.equal(measurement.peqParameters, undefined);
    assert.equal(requested, 1);
    const current = manager.correctionHandler.calculatePEQParameters(settings);
    assert.equal(calculations[1].channel, '2');
    assert.strictEqual(calculations[1].response, measurement.channelResponses[1].averageFrequencyResponse);
    const selectedParameters = [{ frequency: 1600, gain: -3, Q: 1 }];
    calculations[1].resolve(selectedParameters);
    await current;
    calculations[0].resolve([{ frequency: 100, gain: 8, Q: 1 }]);
    await earlier;
    assert.strictEqual(measurement.peqParameters, selectedParameters);
    const payload = JSON.parse(buildPEQClipboardPayload(measurement, 1));
    assert.equal(payload[0].f0, 1600);
    const downloads = [];
    manager.downloadFile = (...args) => downloads.push(args);
    manager.exportCSV();
    manager.exportTXT();
    assert.equal(downloads[0][0], dataStorage.exportPEQtoCSV(selectedParameters));
    assert.equal(downloads[1][0], dataStorage.exportPEQtoTXT(selectedParameters));

    display.selectChannel('all');
    const average = manager.correctionHandler.calculatePEQParameters(settings);
    assert.strictEqual(calculations[2].response, measurement.averageFrequencyResponse);
    calculations[2].resolve([{ frequency: 500, gain: -1, Q: 1 }]);
    await average;
    assert.equal(measurement.peqParameters[0].frequency, 500);
  });
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

test('channel PEQ clipboard payload creates one correctly routed effect per channel', () => {
  const parameters = [
    { frequency: 1000, gain: -2, Q: 1 },
    { frequency: 100, gain: 1, Q: 0.7 },
    { frequency: 10000, gain: -1, Q: 1.2 }
  ];
  const payload = buildPerChannelPEQClipboardPayload([
    { channel: 'left', peqParams: parameters },
    { channel: '2', peqParams: parameters.map(parameter => ({ ...parameter, gain: parameter.gain - 1 })) }
  ], 3);
  const effects = JSON.parse(payload);

  assert.deepEqual(effects.map(effect => effect.ch), ['L', '3']);
  assert.deepEqual(effects.map(effect => effect.nm), ['5Band PEQ', '5Band PEQ']);
  assert.equal(payload, JSON.stringify(effects, null, 2));
  assert.equal(JSON.parse(buildPEQClipboardPayload({
    outputChannel: 'multi',
    peqParameters: parameters
  }, 3))[0].ch, undefined);
});

test('single PEQ copy follows the displayed measurement channel', async () => {
  const eqBandCount = { value: '3' };
  await withGlobals({
    window: {
      addEventListener() {},
      electronAPI: {
        async writeClipboardText(payload) {
          this.payload = payload;
          return true;
        }
      }
    },
    document: {
      addEventListener() {},
      getElementById: id => id === 'eqBandCount' ? eqBandCount : null
    }
  }, async () => {
    await import(`../../features/measurement/app.js?peq-copy-channel=${Date.now()}`);
    const storage = window.app.dataStorage;
    const originalGetMeasurement = storage.getMeasurementById;
    const manager = window.app.uiManager;
    const originalMeasurementId = manager.selectedMeasurementId;
    const originalChannel = manager.measurementDisplay.selectedChannel;
    const parameters = [{ frequency: 1000, gain: -2, Q: 1 }];
    try {
      for (const { outputChannel, outputChannels, selectedChannel, expected } of [
        { outputChannel: 'multi', outputChannels: ['left', '2'], selectedChannel: '2', expected: '3' },
        { outputChannel: 'multi', outputChannels: ['left', '3'], selectedChannel: '3', expected: '4' },
        { outputChannel: 'multi', outputChannels: ['left', '7'], selectedChannel: '7', expected: '8' },
        { outputChannel: 'multi', outputChannels: ['left', 'right'], selectedChannel: 'right', expected: 'R' },
        { outputChannel: 'multi', outputChannels: ['left', 'right'], selectedChannel: 'all', expected: undefined },
        { outputChannel: '2', selectedChannel: 'all', expected: '3' },
        { outputChannel: 'left', selectedChannel: 'all', expected: 'L' },
        { outputChannel: 'right', selectedChannel: 'all', expected: 'R' }
      ]) {
        const measurement = {
          id: `copy-${selectedChannel}`, outputChannel, outputChannels, peqParameters: parameters
        };
        storage.getMeasurementById = () => measurement;
        manager.selectedMeasurementId = measurement.id;
        manager.measurementDisplay.selectedChannel = selectedChannel;
        await window.app.copyPEQToClipboard();
        assert.equal(JSON.parse(window.electronAPI.payload)[0].ch, expected);
      }
    } finally {
      storage.getMeasurementById = originalGetMeasurement;
      manager.selectedMeasurementId = originalMeasurementId;
      manager.measurementDisplay.selectedChannel = originalChannel;
    }
  });
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
