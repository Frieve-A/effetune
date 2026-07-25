import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('measurement controller modules keep the cache-busted legacy UI entry out of their import cycle', async () => {
  for (const modulePath of controllerModules) {
    const source = readFileSync(new URL(modulePath, import.meta.url), 'utf8');
    assert.match(source, /from ['"]\.\.\/ui\/ui-manager\.js['"]/);
    assert.doesNotMatch(source, /from ['"]\.\.\/uiManager\.js['"]/);
  }

  const cacheBustedEntry = new URL('../../features/measurement/uiManager.js?dev=cycle-test', import.meta.url);
  const { default: uiManager } = await import(cacheBustedEntry.href);
  assert.equal(typeof uiManager.showScreen, 'function');
});

test('measurement implementation modules bypass cache-busted compatibility entries', () => {
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
