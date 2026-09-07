import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../../features/measurement/measurement.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../features/measurement/app.js', import.meta.url), 'utf8');
const startup = source.match(/async function initializeApp\(\) \{[\s\S]*?\n\}/)[0];

test('measurement first display waits for translations and UI initialization', async () => {
  assert.match(html, /<body style="visibility: hidden;">/);
  let visibility = 'hidden';
  let text = 'Frequency Response Measurement';
  let finishTranslation;
  const translationReady = new Promise(resolve => { finishTranslation = resolve; });
  const events = [];
  const initialize = runInNewContext(startup + '\ninitializeApp', {
    document: { body: { style: { removeProperty(property) {
      assert.equal(property, 'visibility');
      assert.equal(text, '周波数応答測定');
      events.push('reveal');
      visibility = '';
    } } } },
    i18n: { async initI18n() {
      await translationReady;
      text = '周波数応答測定';
      events.push('translate');
    } },
    dataStorage: { async initialize() {
      assert.equal(visibility, 'hidden');
      events.push('storage');
    } },
    checkBrowserAudioSupport() {},
    uiManager: { async initialize() {
      assert.equal(visibility, 'hidden');
      events.push('ui');
    } },
    setupEventConnections() { events.push('events'); }
  });
  const pending = initialize();
  await Promise.resolve();
  assert.equal(visibility, 'hidden');
  assert.equal(text, 'Frequency Response Measurement');
  assert.deepEqual(events, []);
  finishTranslation();
  await pending;
  assert.equal(visibility, '');
  assert.deepEqual(events, ['translate', 'storage', 'ui', 'events', 'reveal']);
});

test('measurement initialization failure reveals the error notification', async () => {
  const events = [];
  const initialize = runInNewContext(startup + '\ninitializeApp', {
    document: { body: { style: { removeProperty() { events.push('reveal'); } } } },
    i18n: { async initI18n() {}, t: () => '測定の準備ができませんでした。' },
    dataStorage: { async initialize() { throw new Error('Storage unavailable'); } },
    console: { error() {} },
    uiManager: { showNotification(message, type) {
      assert.equal(message, '測定の準備ができませんでした。');
      assert.equal(type, 'error');
      events.push('notification');
    } }
  });
  await initialize();
  assert.deepEqual(events, ['notification', 'reveal']);
});
