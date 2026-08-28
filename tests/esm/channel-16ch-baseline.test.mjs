import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PipelineItemBuilder } from '../../js/ui/pipeline/pipeline-item-builder.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';

import { getSerializablePluginStateShort } from '../../js/utils/serialization-utils.js';
import {
  decodeBaselineDom,
  loadBaselinePlugin,
  serializeBaselineDom
} from '../helpers/channel-16ch-baseline.mjs';

const serializations = JSON.parse(fs.readFileSync(
  new URL('../fixtures/channel-16ch-baseline-v1/serializations.json', import.meta.url), 'utf8'));
const matrixDom = JSON.parse(fs.readFileSync(
  new URL('../fixtures/channel-16ch-baseline-v1/matrix-dom.json', import.meta.url), 'utf8'));

function captureSerializations() {
  const MatrixPlugin = loadBaselinePlugin('basics/matrix.js', 'MatrixPlugin');
  const matrix = new MatrixPlugin();
  const channels = Object.fromEntries(['L', 'R', 'A', '3', '4', '8', '34', '56', '78'].map(channel => {
    matrix.channel = channel;
    return [channel, getSerializablePluginStateShort(matrix)];
  }));
  matrix.channel = null;

  const MultiChannelPanelPlugin = loadBaselinePlugin(
    'basics/multi_channel_panel.js', 'MultiChannelPanelPlugin');
  const panel = new MultiChannelPanelPlugin();
  panel.setParameters({
    m: [true, false, false, false, false, false, false, true],
    s: [false, true, false, false, false, false, false, false],
    v: [-1, 0, 1, 2, 3, 4, 5, 6],
    d: [0, 1, 2, 3, 4, 5, 6, 7],
    l: [true, false, false, false, false, false, true]
  });

  const RoomEqPlugin = loadBaselinePlugin('eq/room_eq.js', 'RoomEqPlugin');
  const roomEq = new RoomEqPlugin();
  roomEq.channelMeasurementIds = ['id0', 'id1', 'id2', 'id3', 'id4', 'id5', 'id6', 'id7'];
  roomEq.channelMeasurementNames = [
    'name0', 'name1', 'name2', 'name3', 'name4', 'name5', 'name6', 'name7'
  ];

  return JSON.parse(JSON.stringify({
    matrix: matrix.getSerializableParameters(),
    channels,
    multiChannelPanel: panel.getSerializableParameters(),
    roomEq: roomEq.getSerializableParameters()
  }));
}

test('eight-channel serializations remain byte-equivalent to the P0 baseline', () => {
  assert.deepEqual(captureSerializations(), serializations);
});

test('the Matrix eight-channel DOM matches the P0 baseline tree', () => {
  const MatrixPlugin = loadBaselinePlugin('basics/matrix.js', 'MatrixPlugin');
  // Only the prescribed table sections and sticky header classes may differ.
  const current = serializeBaselineDom(new MatrixPlugin().createUI(), { normalizeMatrixSticky: true });
  assert.deepEqual(current, decodeBaselineDom(matrixDom.tree));
});

test('Matrix expands while stopped from output settings or high routes and retains every channel label', () => {
  for (const window of [{}, { audioContext: { destination: { channelCount: 16 } } }]) {
    const MatrixPlugin = loadBaselinePlugin('basics/matrix.js', 'MatrixPlugin', { window });
    const matrix = new MatrixPlugin();
    matrix.createUI();
    matrix.setParameters({ mx: '00pabff' });
    assert.equal(matrix.generateRouting(), '00pabff');
    const [head, body] = matrix.table.children;
    assert.equal(body.children.length, 16);
    assert.equal(head.children[0].children[1].colSpan, 16);
    const labels = Array.from({ length: 16 }, (_, index) => `Ch ${index + 1}`);
    assert.deepEqual(head.children[1].children.slice(1).map(cell => cell.textContent), labels);
    assert.deepEqual(body.children.map(row => row.children[0].textContent), labels);
    assert.ok(head.children.every(row => row.children.every(cell => cell.className.includes('sticky'))));
    assert.ok(body.children.every(row => row.children[0].className === 'matrix-sticky-row'));
    matrix.setParameters({ mx: '0011' });
    assert.equal(matrix.cellButtons.length, window.audioContext ? 16 : 8);
    matrix.updateChannelAvailability(16);
    assert.equal(matrix.cellButtons.length, 16);
  }
});

test('debug preview shows sixteen Matrix and Multi Channel Panel channels despite stereo telemetry', () => {
  const window = {
    audioContext: { destination: Object.freeze({ channelCount: 2 }) },
    uiManager: { debugChannelCount: 16 }
  };
  const MatrixPlugin = loadBaselinePlugin('basics/matrix.js', 'MatrixPlugin', { window });
  const MultiChannelPanelPlugin = loadBaselinePlugin(
    'basics/multi_channel_panel.js', 'MultiChannelPanelPlugin', { window });
  const matrix = new MatrixPlugin();
  const panel = new MultiChannelPanelPlugin();
  matrix.createUI();
  panel.createUI();
  matrix.updateChannelAvailability(2);
  panel._actualChannelCount = 2;
  panel._updateChannelVisibility();

  // UI inspection only: no assertion that preview channels can carry audio or
  // that plugin operations work. Stereo telemetry must not collapse the preview.
  assert.equal(matrix.cellButtons.length, 16);
  assert.equal(matrix._actualChannelCount, 2);
  assert.equal(matrix.table.children[1].children[15].className.includes('disabled'), false);
  assert.ok(panel.channelContainers.slice(8).every(channel => !channel.hidden));
  assert.equal(window.audioContext.destination.channelCount, 2);

  window.uiManager.debugChannelCount = null;
  matrix.createUI();
  panel.createUI();
  assert.equal(matrix.cellButtons.length, 8);
  assert.ok(panel.channelContainers.slice(8).every(channel => channel.hidden));
});

test('Matrix hexadecimal routes match the parameter packer and JavaScript processor', () => {
  const MatrixPlugin = loadBaselinePlugin('basics/matrix.js', 'MatrixPlugin');
  const matrix = new MatrixPlugin();
  matrix.setParameters({ mx: '00pabff' });
  const bytes = DSP_PARAM_PACKERS.get('MatrixPlugin').packBytes(matrix.getParameters());
  assert.deepEqual([...bytes], [1, 0, 3, 0, 0, 0, 0, 10, 11, 1, 15, 15, 0]);
  const process = new Function('data', 'parameters', 'context', matrix.processorString);
  const data = Float32Array.from({ length: 16 }, (_, index) => index + 1);
  process(data, { enabled: true, mx: matrix.mx, channelCount: 16, blockSize: 1 }, {});
  assert.deepEqual([...data], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -11, 0, 0, 0, 16]);
});

test('Matrix scrolling derives its height from the button dimensions and keeps both headers sticky', () => {
  const css = fs.readFileSync(new URL('../../plugins/basics/matrix.css', import.meta.url), 'utf8');
  assert.match(css, /--matrix-visible-rows:\s*8/);
  assert.match(css, /--matrix-row-height:\s*calc\(var\(--matrix-button-box\)/);
  assert.match(css, /max-height:\s*calc\(var\(--matrix-row-height\).*var\(--matrix-visible-rows\)/);
  assert.match(css, /overflow:\s*auto/);
  assert.match(css, /min-height:\s*var\(--matrix-button-box\)/);
  assert.match(css, /body\.layout-mobile \.matrix-table-wrapper\s*\{\s*--matrix-button-box:\s*40px/);
  assert.match(css, /\.matrix-sticky-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*background-color:\s*#333/s);
  assert.match(css, /\.matrix-sticky-channel-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--matrix-title-height\)/s);
  assert.match(css, /\.matrix-sticky-row\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0/s);
});

test('MultiChannel Panel preserves old array lengths, expands stopped presets, and links channels eight and nine', () => {
  const Plugin = loadBaselinePlugin('basics/multi_channel_panel.js', 'MultiChannelPanelPlugin');
  const panel = new Plugin();
  panel.startAnimation = () => {};
  const ui = panel.createUI();
  assert.equal(ui.children.filter(row => !row.hidden).length, 8);
  assert.equal(panel.linkButtons[7].hidden, true);
  assert.equal(panel.getParameters().m.length, 8);
  assert.equal(panel.getParameters().l.length, 7);
  panel.setParameters({ m16: true, s15: true, v14: -3, d13: 2 });
  const params = panel.getParameters();
  for (const key of ['m', 's', 'v', 'd']) assert.equal(params[key].length, 16);
  assert.equal(params.l.length, 15);
  assert.equal(params.m[15], true);
  assert.equal(params.s[14], true);
  assert.equal(params.v[13], -3);
  assert.equal(params.d[12], 2);
  assert.equal(ui.children.filter(row => !row.hidden).length, 16);
  panel.setParameters({ v8: -6, l8: true });
  assert.equal(panel.v[8], -6);
  assert.deepEqual(Array.from(panel.findLinkedGroup(8)), [7, 8]);
  const defaults = new Plugin();
  const process = new Function('data', 'parameters', 'context', defaults.processorString);
  const data = new Float32Array(16 * 128).fill(0.25);
  process(data, { ...defaults.getParameters(), channelCount: 16, blockSize: 128, sampleRate: 96000 }, {});
  assert.ok(data.every(sample => sample === 0.25));
  const css = fs.readFileSync(new URL('../../plugins/basics/multi_channel_panel.css', import.meta.url), 'utf8');
  assert.match(css, /\.multichannel-panel-link-button\[hidden\]\s*\{\s*display: none;/);
});

test('MultiChannel Panel reset and preset recall clear omitted upper aggregate defaults', () => {
  const Plugin = loadBaselinePlugin('basics/multi_channel_panel.js', 'MultiChannelPanelPlugin');
  const panel = new Plugin();
  panel.defaultParameters = JSON.parse(JSON.stringify(panel.getParameters()));
  const builder = new PipelineItemBuilder({ updateWorkletPlugin() {}, updatePipelineUI() {} });
  const state = () => JSON.parse(JSON.stringify(panel.getSerializableParameters()));
  const defaults = state();
  const recalled = { ...defaults, v: [-3, 0, 0, 0, 0, 0, 0, -6] };
  const setUpperState = () => panel.setParameters({ m16: true, s15: true, v14: -3, d13: 2, l8: true });

  setUpperState();
  const beforePartialEdit = state();
  panel.setParameters({ v1: -2 });
  assert.deepEqual(state(), {
    ...beforePartialEdit, v: [-2, ...beforePartialEdit.v.slice(1)]
  });
  panel.setParameters({});
  assert.equal(panel.m[15], true);
  assert.equal(panel.l[7], true);

  builder.resetPluginToDefaults(panel);
  assert.deepEqual(state(), defaults);
  setUpperState();
  panel.setSerializedParameters(recalled);
  assert.deepEqual(state(), recalled);
  assert.equal(panel.v[8], 0, 'the omitted link must be reset before it can propagate Ch 8 gain');
  assert.equal(panel.l[7], false);
});

test('Room EQ preserves new measurement slots and applies effective taps without changing the preset', () => {
  const Plugin = loadBaselinePlugin('eq/room_eq.js', 'RoomEqPlugin');
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  plugin._renderChannelMeasurements = () => {};
  plugin.channel = 'A';
  plugin._outputChannelCount = 16;
  plugin.setParameters({ tp: 131072, pm: 'lin', ms8: 'a'.repeat(180), mn15: 'b'.repeat(180) });
  assert.equal(plugin.channelMeasurementIds[8].length, 160);
  assert.equal(plugin.channelMeasurementNames[15].length, 160);
  const serialized = plugin.getSerializableParameters();
  assert.equal(serialized.tp, 131072);
  assert.equal(serialized.ms8.length, 160);
  assert.equal(serialized.mn15.length, 160);
  assert.equal(serialized.ms9, undefined);
  assert.equal(plugin._designConfig().taps, 65536);
  assert.equal(plugin.getParameters().fd, 32768);
  assert.equal(plugin._designConfig(96000, 8).taps, 131072);
  plugin._latencyElement = { textContent: '' };
  plugin._renderStatus();
  assert.match(plugin._latencyElement.textContent, /Taps limited to 65536/);
  for (const [channel, first] of [['910', 9], ['1112', 11], ['1314', 13], ['1516', 15], ['16', 16]]) {
    plugin.channel = channel;
    assert.equal(plugin._channelStartIndex(), first);
    assert.equal(plugin._effectiveTapCount(), 131072);
  }
  const restored = new Plugin();
  restored._scheduleDesign = () => {};
  restored._renderChannelMeasurements = () => {};
  restored.setSerializedParameters(serialized);
  assert.equal(restored.channelMeasurementIds[8], plugin.channelMeasurementIds[8]);
  assert.equal(restored.channelMeasurementNames[15], plugin.channelMeasurementNames[15]);
});

test('Auto Pan processes the last stereo pair in sixteen-channel JavaScript fallback', () => {
  const Plugin = loadBaselinePlugin('modulation/auto_pan.js', 'AutoPanPlugin');
  const plugin = new Plugin();
  const process = new Function('data', 'parameters', 'context', plugin.processorString);
  const data = new Float32Array(16 * 128).fill(0.25);
  process(data, { ...plugin.getParameters(), channelCount: 16, blockSize: 128, sampleRate: 96000 }, {});
  assert.ok(data.every(Number.isFinite));
  assert.ok(data.subarray(14 * 128).some(sample => sample !== 0.25));
});
