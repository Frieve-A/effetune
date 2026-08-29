import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../plugins/eq/fifteen_band_geq.js', import.meta.url), 'utf8');

for (const { name, width, height, dpr, mobile } of [
  { name: 'desktop', width: 600, height: 240, dpr: 1, mobile: false },
  { name: 'high-DPI desktop', width: 600, height: 240, dpr: 2, mobile: false },
  { name: 'mobile', width: 320, height: 160, dpr: 3, mobile: true }
]) {
  test(`15Band GEQ draws frequency and level labels in CSS pixels on ${name}`, () => {
    const sandbox = {
      PluginBase: class { registerProcessor() {} },
      window: {},
      document: { body: { classList: { contains: name => name === 'layout-mobile' && mobile } } }
    };
    vm.runInNewContext(source, sandbox);
    const plugin = new sandbox.window.FifteenBandGEQPlugin();
    const calls = [];
    const labels = [];
    const ctx = {
      ...Object.fromEntries([
        'setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke',
        'save', 'translate', 'rotate', 'restore'
      ].map(method => [method, (...args) => calls.push([method, ...args])])),
      fillText(text, x, y) {
        labels.push({ text: String(text), x, y, font: this.font, align: this.textAlign });
      }
    };
    const canvas = {
      width: width * dpr,
      height: height * dpr,
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width, height })
    };

    plugin.drawGraph(canvas);

    assert.deepEqual(labels.map(label => label.text), [
      '50', '100', '200', '500', '1k', '2k', '5k', '10k',
      '-18', '-12', '-6', '0', '6', '12', '18',
      'Frequency (Hz)', 'Level (dB)'
    ]);
    assert.deepEqual(calls.slice(0, 2), [
      ['setTransform', dpr, 0, 0, dpr, 0, 0],
      ['clearRect', 0, 0, width, height]
    ]);
    for (const label of labels.slice(0, 8)) {
      assert.equal(label.y, height - 24);
      assert.equal(label.font, '12px Arial');
      assert.equal(label.align, 'center');
      assert.ok(label.x > 0 && label.x < width);
    }
    assert.ok(Math.abs(labels[2].x - width / 3) < 1e-8);
    assert.ok(Math.abs(labels[5].x - width * 2 / 3) < 1e-8);
    for (const label of labels.slice(8, 15)) {
      assert.equal(label.x, 48);
      assert.equal(label.font, '12px Arial');
      assert.equal(label.align, 'right');
      assert.ok(label.y > 0 && label.y < height);
    }
    assert.equal(labels.find(label => label.text === '0').y, height / 2 + 4);
    assert.deepEqual(labels.slice(15), [
      { text: 'Frequency (Hz)', x: width / 2, y: height - 5, font: '14px Arial', align: 'center' },
      { text: 'Level (dB)', x: 0, y: 0, font: '14px Arial', align: 'center' }
    ]);
    assert.deepEqual(calls.filter(([method]) => ['save', 'translate', 'rotate', 'restore'].includes(method)), [
      ['save'], ['translate', 14, height / 2], ['rotate', -Math.PI / 2], ['restore']
    ]);
    assert.equal(calls.filter(([method]) => method === 'stroke').length, 20);
  });
}
