const assert = require('node:assert/strict');
const test = require('node:test');
const { createMacPlaybackPower } = require('../../electron/mac-playback-power.cjs');

test('Mac playback blocker is held only during continuous-mode activity', () => {
  const calls = [];
  let mode = 'continuous';
  const power = createMacPlaybackPower({
    powerSaveBlocker: {
      start(type) { calls.push(['start', type]); return 17; },
      stop(id) { calls.push(['stop', id]); }
    },
    getConfig: () => ({ powerSaving: { mode } })
  });
  power.update(false);
  power.update(true);
  power.update(true);
  assert.deepEqual(calls, [['start', 'prevent-app-suspension']]);
  power.update(false);
  assert.deepEqual(calls.at(-1), ['stop', 17]);
  power.update(true);
  mode = 'balanced';
  power.refreshConfig();
  assert.deepEqual(calls.slice(-2), [['start', 'prevent-app-suspension'], ['stop', 17]]);
  power.update(true);
  assert.equal(calls.length, 4);
  power.stop();
});
