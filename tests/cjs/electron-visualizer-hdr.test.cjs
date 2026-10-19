const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Electron enables HDR Canvas input before ready while preserving existing Blink features', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
  const start = source.indexOf('const enabledBlinkFeatures =');
  const end = source.indexOf('// OpenHome transport commands', start);
  assert.ok(start > 0 && end > start && end < source.indexOf('app.whenReady()'));
  for (const initial of ['', 'ExistingFeature, OtherFeature', 'CanvasGlobalHDRHeadroom,OtherFeature']) {
    const switches = new Map([['enable-blink-features', initial]]);
    vm.runInNewContext(source.slice(start, end), { app: { commandLine: {
      getSwitchValue: name => switches.get(name) || '',
      appendSwitch: (name, value) => switches.set(name, value)
    } } });
    const features = switches.get('enable-blink-features').split(',').map(value => value.trim());
    assert.equal(features.filter(value => value === 'CanvasGlobalHDRHeadroom').length, 1);
    for (const existing of initial.split(',').map(value => value.trim()).filter(Boolean)) {
      assert.ok(features.includes(existing));
    }
  }
});
