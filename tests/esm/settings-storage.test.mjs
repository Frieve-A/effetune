import assert from 'node:assert/strict';
import test from 'node:test';
import { getSettingsStorage } from '../../js/settings-storage.js';

test('named desktop settings use the native store while unnamed settings keep browser storage', () => {
    const entries = new Map();
    const localStorage = {
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: key => entries.delete(key)
    };
    assert.equal(getSettingsStorage({ localStorage }), localStorage);
    localStorage.setItem('measurement', 'shared');
    for (const name of ['headphones', 'speakers']) {
        const settingsStorage = {
            getItem: key => entries.get(`${name}:${key}`) ?? null,
            setItem: (key, value) => entries.set(`${name}:${key}`, value),
            removeItem: key => entries.delete(`${name}:${key}`)
        };
        const storage = getSettingsStorage({ localStorage, electronAPI: { settingsStorage } });
        assert.equal(storage, settingsStorage);
        assert.equal(storage.getItem('theme'), null);
        storage.setItem('theme', name);
        assert.equal(storage.getItem('theme'), name);
        storage.removeItem('theme');
        assert.equal(storage.getItem('theme'), null);
    }
    assert.equal(localStorage.getItem('measurement'), 'shared');
});
