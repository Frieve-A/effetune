import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginPresetStore } from '../../js/ui/pipeline/plugin-preset-store.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createWebStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    api: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  };
}

async function withWebStore(initial, callback) {
  const storage = createWebStorage(initial);
  await withGlobals({
    window: {},
    localStorage: storage.api
  }, () => callback(new PluginPresetStore(), storage));
}

test('web store saves isolated values, renames with overwrite, and removes empty plugin entries', async () => {
  await withWebStore({}, async (store, storage) => {
    const params = { gain: 2, nested: { mix: 0.5 } };
    assert.equal(await store.save(' Tone ', ' Warm ', params), true);
    params.nested.mix = 1;
    const saved = await store.getForPlugin('Tone');
    assert.deepEqual(saved, { Warm: { gain: 2, nested: { mix: 0.5 } } });
    saved.Warm.gain = 99;
    assert.equal((await store.getForPlugin('Tone')).Warm.gain, 2);

    assert.equal(await store.save('Tone', 'Existing', { gain: 7 }), true);
    assert.equal(await store.rename('Tone', 'Warm', 'Existing'), true);
    assert.deepEqual(await store.getForPlugin('Tone'), {
      Existing: { gain: 2, nested: { mix: 0.5 } }
    });
    assert.equal(await store.rename('Tone', 'Missing', 'Nope'), false);
    assert.equal(await store.remove('Tone', ['Missing']), false);
    assert.equal(await store.remove('Tone', ['Existing', 'Existing']), true);
    assert.deepEqual(await store.getForPlugin('Tone'), {});
    assert.deepEqual(JSON.parse(storage.values.get('effetune_plugin_presets')), {});
  });
});

test('web store rejects unsafe input and recovers from invalid or failed storage', async () => {
  await withWebStore({ effetune_plugin_presets: 'not json' }, async store => {
    assert.deepEqual(await store.getForPlugin('Tone'), {});
    assert.deepEqual(await store.getForPlugin('__proto__'), {});
    assert.equal(await store.save('', 'Name', {}), false);
    assert.equal(await store.save('Tone', '__proto__', {}), false);
    assert.equal(await store.save('Tone', 'Name', []), false);
    assert.equal(await store.rename('Tone', 'Name', 'constructor'), false);
    assert.equal(await store.remove('Tone', []), false);
  });

  const storage = createWebStorage();
  storage.api.setItem = () => { throw new Error('disk full'); };
  await withGlobals({ window: {}, localStorage: storage.api }, async () => {
    const store = new PluginPresetStore();
    assert.equal(await store.save('Tone', 'Name', { gain: 1 }), false);
    assert.equal(await store.rename('Tone', 'Name', 'Other'), false);
    assert.equal(await store.remove('Tone', ['Name']), false);
  });

  await withWebStore({ effetune_plugin_presets: '[]' }, async store => {
    assert.deepEqual(await store.readPresets(), {});
  });
});

test('Electron store reads and writes the userData file and reports bridge failures', async () => {
  const writes = [];
  const electronAPI = {
    async getPath(name) { assert.equal(name, 'userData'); return 'settings'; },
    async joinPaths(...parts) { return parts.join('/'); },
    async fileExists() { return true; },
    async readFile() { return { success: true, content: '{"Tone":{"Saved":{"gain":3}}}' }; },
    async saveFile(path, content) { writes.push([path, JSON.parse(content)]); return { success: true }; }
  };
  await withGlobals({
    window: { electronAPI, electronIntegration: { isElectron: true } }
  }, async () => {
    const store = new PluginPresetStore();
    assert.deepEqual(await store.getForPlugin('Tone'), { Saved: { gain: 3 } });
    assert.equal(await store.save('Tone', 'Other', { gain: 4 }), true);
    assert.equal(writes[0][0], 'settings/effetune_plugin_presets.json');
  });

  electronAPI.fileExists = async () => false;
  await withGlobals({ window: { electronAPI, electronIntegration: { isElectron: true } } }, async () => {
    assert.deepEqual(await new PluginPresetStore().readPresets(), {});
  });

  electronAPI.fileExists = async () => true;
  electronAPI.readFile = async () => ({ success: false, error: 'private read detail' });
  writes.length = 0;
  electronAPI.saveFile = async (path, content) => {
    writes.push([path, JSON.parse(content)]);
    return { success: true };
  };
  await withGlobals({ window: { electronAPI, electronIntegration: { isElectron: true } } }, async () => {
    const store = new PluginPresetStore();
    assert.deepEqual(await store.readPresets(), {});
    assert.equal(await store.save('Tone', 'Name', { gain: 1 }), false);
    assert.equal(await store.rename('Tone', 'Saved', 'Other'), false);
    assert.equal(await store.remove('Tone', ['Saved']), false);
    assert.equal(writes.length, 0);
  });

  electronAPI.readFile = async () => ({ success: true, content: 'not json' });
  await withGlobals({ window: { electronAPI, electronIntegration: { isElectron: true } } }, async () => {
    assert.equal(await new PluginPresetStore().save('Tone', 'Recovered', { gain: 5 }), true);
    assert.deepEqual(writes.at(-1)[1], { Tone: { Recovered: { gain: 5 } } });
  });
});

test('mutations are serialized after a failed queued operation', async () => {
  await withWebStore({}, async store => {
    const order = [];
    let release;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    store.readPresets = async () => {
      order.push('read');
      return {};
    };
    store.persistPresets = async presets => {
      order.push(Object.keys(presets.Tone)[0]);
      if (!release) {
        markStarted();
        await new Promise(resolve => { release = resolve; });
        throw new Error('first failed');
      }
    };
    const first = store.save('Tone', 'First', { gain: 1 });
    const second = store.save('Tone', 'Second', { gain: 2 });
    await started;
    assert.deepEqual(order, ['read', 'First']);
    release();
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(order, ['read', 'First', 'read', 'Second']);
  });
});
