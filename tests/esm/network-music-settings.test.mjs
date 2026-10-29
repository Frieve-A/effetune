import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NetworkMusicSettings } from '../../js/network-music/settings-view.js';
import { SELECTABLE_LANGUAGE_CODES } from '../../js/language-options.js';
import { parseCommentedJSON } from '../../js/utils/parse-commented-json.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';

function fixture(t, isPwa = false) {
  const document = createFakeDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    element.replaceChildren = (...children) => {
      for (const child of [...element.children]) element.removeChild(child);
      for (const child of children) element.appendChild(child);
    };
    return element;
  };
  const root = document.createElement('section');
  const calls = [];
  const state = { gatewayPermissions: { libraries: false, players: true }, sources: [{ id: 'source-a', name: 'Music' }], manualDevices: [] };
  const remoteSettings = { status: { connection: { endpoint: 'https://music.example.com', fromEnvironment: false } },
    subscribe(listener) { this.listener = listener; listener(); return () => { this.listener = null; }; },
    async update(action) { this.status = await action(); this.listener?.(); } };
  const api = { isPwa, networkMusicGetState: async () => state,
    async networkMusicConfigure(request) { calls.push(request); return state; },
    cancelSourceRegistration: () => calls.push('cancel'),
    remoteV1: isPwa ? undefined : { settings: {
      selectConnectionFile: async kind => ({ selectionId: `opaque-${kind}`, fileName: `${kind}.pem` }),
      setConnection: async request => calls.push(request),
      getStatus: async () => remoteSettings.status,
      testConnection: async () => ({ ok: false, code: 'certificate-hostname' })
    } }
  };
  const view = new NetworkMusicSettings({ root, api, remoteSettings, translate: key => key, documentRef: document });
  t.after(() => view.dispose());
  const click = async key => {
    const button = view.labels.find(([element, label]) => element.tagName === 'BUTTON' && label === key)?.[0];
    assert.ok(button, key);
    await button.dispatchEvent('click');
  };
  return { view, calls, state, root, remoteSettings, click };
}

test('network settings save separate gateway permissions and source credentials without generic config persistence', async t => {
  const { view, calls, click } = fixture(t);
  await view.mount();
  view.allowLibraries.checked = true;
  view.allowPlayers.checked = false;
  await click('networkMusic.save');
  assert.deepEqual(calls[0], { gatewayPermissions: { libraries: true, players: false } });
  view.sourceName.value = 'Home'; view.sourceUrl.value = 'https://server.example.com';
  view.sourceUser.value = 'user'; view.sourcePassword.value = 'private-secret';
  await click('networkMusic.settings.add');
  assert.deepEqual(calls[1], { subsonic: { action: 'add', name: 'Home', url: 'https://server.example.com', user: 'user', password: 'private-secret' } });
  assert.equal(view.sourcePassword.value, '');
  await click('networkMusic.remove');
  assert.deepEqual(calls[2], { subsonic: { action: 'remove', id: 'source-a' } });
  const parent = view.sourceUrl.parentNode;
  view.updateLanguage();
  assert.equal(view.sourceUrl.parentNode, parent, 'updating labels must not replace input controls');
});

test('HTTPS settings use opaque file selections and keep environment-owned controls read-only', async t => {
  const { view, calls, remoteSettings, click } = fixture(t);
  await view.mount();
  await click('networkMusic.settings.certificate');
  await click('networkMusic.settings.key');
  const save = view.connectionControls.find(button => button.textContent === 'networkMusic.save');
  await save.dispatchEvent('click');
  assert.deepEqual(calls[0], { endpoint: 'https://music.example.com', certificateSelection: 'opaque-certificate', keySelection: 'opaque-key' });
  assert.equal(JSON.stringify(calls[0]).includes('.pem'), false);
  await click('networkMusic.settings.test');
  assert.equal(view.connectionStatus.textContent, 'networkMusic.settings.hostnameMismatch');
  remoteSettings.status.connection.fromEnvironment = true;
  remoteSettings.listener();
  assert.ok(view.connectionControls.every(control => control.disabled));
  assert.equal(view.environmentNotice.hidden, false);
});

test('PWA source settings omit desktop permissions and stop a pending source registration on close', async t => {
  const { view, calls } = fixture(t, true);
  await view.mount();
  assert.equal(view.allowLibraries, undefined);
  assert.equal(view.manualUrl, undefined);
  assert.equal(view.endpoint, undefined);
  view.sourcePassword.value = 'private-secret';
  view.dispose();
  assert.equal(view.sourcePassword.value, '');
  assert.equal(calls.at(-1), 'cancel');
});

test('network setup controls and recovery guidance are available in every selectable language', () => {
  const source = readFileSync(new URL('../../js/network-music/settings-view.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/'networkMusic\.settings\.([A-Za-z]+)'/g)].map(match => match[1]);
  keys.push('gateway', 'gatewayHelp', 'allowLibraries', 'allowPlayers', 'subsonic', 'subsonicHelp', 'directHelp', 'name',
    'serverUrl', 'user', 'password', 'manual', 'manualHelp', 'descriptorUrl', 'https', 'httpsHelp', 'endpoint', 'certificate', 'key',
    'expired', 'hostnameMismatch', 'invalidCertificate', 'unreachable', 'connectionOk', 'connectionFailed', 'subsonicConnection', 'subsonicAuthentication');
  for (const language of SELECTABLE_LANGUAGE_CODES) {
    const locale = parseCommentedJSON(readFileSync(new URL(`../../js/locales/${language}.json5`, import.meta.url), 'utf8'));
    for (const key of new Set(keys)) assert.equal(typeof locale[`networkMusic.settings.${key}`], 'string', `${language}: ${key}`);
    assert.equal(typeof locale['networkMusic.mute'], 'string');
  }
});
