import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const pluginUrl = new URL('../../plugins/eq/five_band_fir_peq.js', import.meta.url);
const pluginSource = fs.readFileSync(pluginUrl, 'utf8');
const pluginCss = fs.readFileSync(
  new URL('../../plugins/eq/five_band_fir_peq.css', import.meta.url),
  'utf8'
);

function loadPlugin() {
  const calls = [];
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.id = 'five-band-fir-peq-test';
      this.enabled = true;
      this.channel = null;
      this.powerGainUpperBoundDb = 0;
    }

    registerProcessor(processor) {
      this.processor = processor;
    }

    getParameters() {
      return {
        type: this.constructor.name,
        id: this.id,
        enabled: this.enabled
      };
    }

    _setValidatedParameters(parameters) {
      if (parameters.enabled !== undefined) this.enabled = Boolean(parameters.enabled);
      if (parameters.channel !== undefined) this.channel = parameters.channel;
    }

    parseFiniteNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(minimum, Math.min(maximum, number));
    }

    updateParameters() {
      calls.push(['updateParameters']);
    }

    setWasmAsset(slot, descriptor) {
      calls.push(['setWasmAsset', slot, descriptor]);
      return 17;
    }

    clearWasmAsset(slot) {
      calls.push(['clearWasmAsset', slot]);
    }

    _isCurrentWasmAssetOperation(slot, revision) {
      return slot === 0 && revision === 17;
    }

    cleanup() {
      calls.push(['cleanup']);
    }
  }

  const context = {
    PluginBase,
    window: {},
    document: {
      createElementNS(namespace, tagName) {
        return {
          namespace,
          tagName,
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = String(value);
          }
        };
      },
      removeEventListener() {}
    },
    console,
    Math,
    Number,
    JSON,
    ArrayBuffer,
    Float32Array,
    Map,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(
    `${pluginSource}\nthis.Plugin = FiveBandFIRPEQPlugin;`,
    context,
    { filename: pluginUrl.pathname }
  );
  return { Plugin: context.Plugin, calls };
}

test('5Band FIR PEQ exposes FIR defaults, Q, and slope limits', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};

  assert.equal(plugin.name, '5Band FIR PEQ');
  assert.equal(plugin.pm, 'min');
  assert.equal(plugin.tp, 32768);
  assert.equal(plugin.lt, '128');
  assert.equal(plugin.offlineDspAssetRequired, true);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => plugin[`f${index}`]),
    [100, 316, 1000, 3160, 10000]
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => plugin[`q${index}`]),
    [0.7, 0.7, 0.7, 0.7, 0.7]
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => plugin[`s${index}`]),
    [12, 12, 12, 12, 12]
  );

  plugin.setParameters({
    pm: 'lin',
    tp: 131072,
    lt: '1024',
    q0: 1000,
    q1: 0,
    s0: 1000,
    s1: 0,
    t0: 'hs',
    t1: 'unsupported'
  });

  assert.equal(plugin.pm, 'lin');
  assert.equal(plugin.tp, 131072);
  assert.equal(plugin.lt, '1024');
  assert.equal(plugin.q0, 100);
  assert.equal(plugin.q1, 0.1);
  assert.equal(plugin.s0, 384);
  assert.equal(plugin.s1, 0.1);
  assert.equal(plugin.t0, 'hs');
  assert.equal(plugin.t1, 'pk');
  const supportedTypes = ['pk', 'lp', 'hp', 'ls', 'hs', 'bp', 'no'];
  for (const type of supportedTypes) {
    plugin.setParameters({ t1: type });
    assert.equal(plugin.t1, type);
  }
  plugin.setParameters({ t1: 'ap' });
  assert.equal(plugin.t1, 'no');
  plugin.reset();
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => plugin[`q${index}`]),
    [0.7, 0.7, 0.7, 0.7, 0.7]
  );
  plugin.cleanup();
});

test('5Band FIR PEQ maps its independent bands into the existing FIR designer contract', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  plugin.setParameters({
    f2: 1234,
    g2: 7.5,
    q2: 48,
    t2: 'pk',
    e2: false
  });

  const config = plugin._designConfig(48000);
  assert.equal(config.sampleRate, 48000);
  assert.equal(config.phase, 'min');
  assert.equal(config.taps, 32768);
  assert.equal(config.eqBands.length, 5);
  assert.deepEqual(
    { ...config.eqBands[2] },
    {
      frequency: 1234,
      gain: 7.5,
      q: 48,
      slope: 12,
      type: 'pk',
      enabled: false
    }
  );
  plugin.cleanup();
});

test('5Band FIR PEQ stages a mono FIR through the shared asset contract', async () => {
  const { Plugin, calls } = loadPlugin();
  const plugin = new Plugin();
  const payload = new ArrayBuffer(32 + plugin.tp * Float32Array.BYTES_PER_ELEMENT);
  const result = { payload, qualityWarnings: [] };
  plugin._lastDesign = result;
  plugin._designGeneration = 4;
  plugin._runtimePromise = Promise.resolve({
    IR_ASSET_TOPOLOGY: { mono: 1 },
    selectedIrChannelCount: () => 2,
    estimateIrKernelCommitFootprint: () => 4 * 1024 * 1024
  });

  assert.equal(await plugin._stageDesign(result, 4), true);
  const stage = calls.find(call => call[0] === 'setWasmAsset');
  assert.ok(stage);
  assert.equal(stage[1], 0);
  assert.equal(stage[2].payload, payload);
  assert.equal(stage[2].headBlock, 128);
  assert.equal(stage[2].processingChannels, 2);
  assert.equal(stage[2].formatTag, 1);
  assert.equal(plugin._candidateAssetRevision, 17);
  plugin.cleanup();
});

test('5Band FIR PEQ offline state includes phase delay and selected latency', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin.pm = 'lin';
  plugin.tp = 8192;
  plugin.lt = '256';
  plugin.t0 = 'lp';
  const payload = new ArrayBuffer(32 + plugin.tp * Float32Array.BYTES_PER_ELEMENT);
  let closed = false;
  plugin._runtimePromise = Promise.resolve({
    IR_ASSET_TOPOLOGY: { mono: 1 },
    selectedIrChannelCount: () => 2,
    estimateIrKernelCommitFootprint: () => 1024,
    createFiveBandFirPeqDesigner: () => ({
      async design(config) {
        assert.equal(config.phase, 'lin');
        assert.equal(config.taps, 8192);
        assert.equal(config.eqBands[0].type, 'lp');
        return { payload };
      },
      close() {
        closed = true;
      }
    })
  });

  const state = await plugin.createOfflineDspState({
    sampleRate: 48000,
    outputChannelCount: 2
  });
  assert.equal(closed, true);
  assert.equal(state.offlineDspAssetRequired, true);
  assert.equal(state.parameters.fd, 4096);
  assert.equal(state.parameters.lt, '256');
  assert.equal(state.assets.get(0).warmupSamples, 4352);
  assert.equal(state.assets.get(0).payload, payload);
  plugin.cleanup();
});

test('5Band FIR PEQ accepts only the current FIR asset revision', () => {
  const { Plugin, calls } = loadPlugin();
  const plugin = new Plugin();
  plugin._candidateAssetRevision = 17;
  plugin._lastDesign = { qualityWarnings: [] };

  plugin.onWasmAssetState(0, 3, 16);
  assert.equal(plugin._designStaged, false);

  plugin.onWasmAssetState(0, 3, 17);
  assert.equal(plugin._designPending, false);
  assert.equal(plugin._designStaged, true);
  assert.equal(plugin._effectiveAssetRevision, 17);
  assert.ok(calls.some(call => call[0] === 'updateParameters'));
  plugin.cleanup();
});

test('5Band FIR PEQ response graph supports every FIR magnitude filter type', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const response = (type, frequency, gain = 0) => plugin.calculateBandResponse(frequency, {
    enabled: true,
    frequency: 1000,
    gain,
    q: 1,
    type
  });

  assert.ok(response('pk', 1000, 6) > response('pk', 100, 6) + 4);
  assert.ok(response('ls', 100, 6) > response('ls', 10000, 6) + 4);
  assert.ok(response('hs', 10000, 6) > response('hs', 100, 6) + 4);
  assert.ok(response('lp', 100) > response('lp', 10000) + 20);
  assert.ok(response('hp', 10000) > response('hp', 100) + 20);
  assert.ok(response('bp', 1000) > response('bp', 100) + 10);
  assert.ok(response('no', 1000) < response('no', 100) - 10);
  plugin.cleanup();
});

test('5Band FIR PEQ slope steepens only LowPass and HighPass responses', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const response = (type, frequency, slope) => plugin.calculateBandResponse(frequency, {
    enabled: true,
    frequency: 1000,
    gain: 6,
    q: 1,
    slope,
    type
  });

  assert.ok(response('lp', 10000, 48) < response('lp', 10000, 12) - 40);
  assert.ok(response('hp', 100, 48) < response('hp', 100, 12) - 40);
  assert.equal(response('pk', 1000, 48), response('pk', 1000, 12));
  plugin.cleanup();
});

test('5Band FIR PEQ draws target and realized FIR responses separately', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const children = [];
  plugin.uiCreated = true;
  plugin.responseSvg = {
    clientWidth: 400,
    clientHeight: 200,
    setAttribute() {},
    replaceChildren() {
      children.length = 0;
    },
    appendChild(child) {
      children.push(child);
    }
  };
  plugin._lastDesign = {
    response: {
      frequencies: Float64Array.from([100, 1000, 10000]),
      targetDb: Float64Array.from([0, 0, 0]),
      realizedDb: Float64Array.from([-0.1, 2.5, -0.2])
    }
  };
  plugin._lastDesignSignature = plugin._designSignature();

  plugin.updateResponse();
  assert.equal(children.length, 2);
  assert.equal(children[0].attributes.class, 'five-band-fir-peq-target-response');
  assert.equal(children[0].attributes.stroke, 'rgba(176, 176, 176, 0.7)');
  assert.equal(children[1].attributes.class, 'five-band-fir-peq-realized-response');
  assert.equal(children[1].attributes.stroke, '#00ff00');

  plugin.g0 = 1;
  plugin.updateResponse();
  assert.equal(children.length, 1);
  plugin.cleanup();
});

test('5Band FIR PEQ enables slope controls only for pass filter types', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const slopeSlider = {};
  const slopeText = {};
  const band = {
    querySelector(selector) {
      if (selector === '.five-band-fir-peq-slope-slider') return slopeSlider;
      if (selector === '.five-band-fir-peq-slope-text') return slopeText;
      return null;
    }
  };

  for (const type of ['lp', 'hp']) {
    plugin._setSlopeControlsState(band, type);
    assert.equal(slopeSlider.disabled, false);
    assert.equal(slopeText.disabled, false);
  }
  for (const type of ['pk', 'ls', 'hs', 'bp', 'no']) {
    plugin._setSlopeControlsState(band, type);
    assert.equal(slopeSlider.disabled, true);
    assert.equal(slopeText.disabled, true);
  }
  plugin.cleanup();
});

test('5Band FIR PEQ keeps logarithmic Q and Slope sliders synchronized', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._scheduleDesign = () => {};
  const qSlider = { value: '' };
  const qText = { value: '' };
  const slopeSlider = { value: '' };
  const slopeText = { value: '' };
  const band = {
    querySelector(selector) {
      if (selector === '.five-band-fir-peq-q-slider') return qSlider;
      if (selector === '.five-band-fir-peq-q-text') return qText;
      if (selector === '.five-band-fir-peq-slope-slider') return slopeSlider;
      if (selector === '.five-band-fir-peq-slope-text') return slopeText;
      return null;
    }
  };
  plugin.uiCreated = true;
  plugin.uiContainer = {
    querySelector(selector) {
      return selector.includes('data-band="0"') ? band : null;
    }
  };

  plugin.setParameters({ q0: 37.25, s0: 38.4 });
  assert.ok(Math.abs(
    Plugin._valueFromLogSliderPosition(qSlider.value, 0.1, 100) - 37.25
  ) < 1e-10);
  assert.equal(qText.value, '37.25');
  assert.ok(Math.abs(
    Plugin._valueFromLogSliderPosition(slopeSlider.value, 0.1, 384) - 38.4
  ) < 1e-10);
  assert.equal(slopeText.value, '38.4');

  assert.equal(Plugin._logSliderPosition(0.1, 0.1, 100), 0);
  assert.equal(Plugin._logSliderPosition(100, 0.1, 100), 100);
  assert.ok(Math.abs(Plugin._logSliderPosition(1, 0.1, 100) - 100 / 3) < 1e-10);
  plugin.cleanup();
});

test('5Band FIR PEQ source keeps phase, taps, latency, and narrow-Q UI choices visible', () => {
  assert.match(pluginSource, /Minimum Phase/);
  assert.match(pluginSource, /Linear Phase/);
  assert.match(pluginSource, /\[8192, 16384, 32768, 65536, 131072\]/);
  assert.match(pluginSource, /\[0, 128, 256, 512, 1024\]/);
  assert.match(pluginSource, /qSlider\.min = '0'/);
  assert.match(pluginSource, /qSlider\.max = '100'/);
  assert.match(pluginSource, /five-band-fir-peq-q-slider/);
  assert.match(pluginSource, /qSlider\.addEventListener\('input'/);
  assert.match(pluginSource, /Slope \(dB\/oct\):/);
  assert.match(pluginSource, /slope\.min = '0\.1'/);
  assert.match(pluginSource, /five-band-fir-peq-slope-slider/);
  assert.match(pluginSource, /slopeSlider\.addEventListener\('input'/);
  assert.match(pluginSource, /slopeSlider\.max = '100'/);
  assert.match(pluginSource, /_valueFromLogSliderPosition/);
  assert.match(pluginSource, /fiveBandFirPeq\.graph\.target/);
  assert.match(pluginSource, /fiveBandFirPeq\.graph\.realized/);
  assert.match(pluginSource, /five-band-fir-peq-realized-response/);
  for (const type of ['lp', 'hp', 'bp', 'no']) {
    assert.match(pluginSource, new RegExp(`id: '${type}'`));
  }
  assert.doesNotMatch(pluginSource, /id: 'ap'/);
  assert.doesNotMatch(pluginSource, /FiveBandPEQPlugin/);
  assert.doesNotMatch(pluginSource, /FIRCrossoverPlugin/);
  assert.doesNotMatch(pluginSource, /room-eq\/designer/);
  assert.match(pluginCss, /\.five-band-fir-peq-plugin-ui \.five-band-fir-peq-graph/);
  assert.match(pluginCss, /\.five-band-fir-peq-settings \.radio-group/);
  assert.match(pluginCss, /\.five-band-fir-peq-q-slider/);
  assert.match(pluginCss, /\.five-band-fir-peq-slope-slider/);
  assert.match(pluginCss, /\.five-band-fir-peq-legend/);
  assert.match(pluginCss, /\.five-band-fir-peq-legend-realized/);
  assert.match(pluginCss, /\.five-band-fir-peq-slope-label \{\s*flex: 0 0 100%/);
  assert.match(
    pluginCss,
    /body:not\(\.layout-mobile\).*\.five-band-fir-peq-slope-slider \{\s*min-width: 64px/s
  );
  assert.match(
    pluginCss,
    /body\.layout-mobile .*\.five-band-fir-peq-slope-slider \{[^}]*--et-mobile-effect-slider-min-width/s
  );
  assert.match(pluginCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(pluginCss, /flex: 0 0 90px/);
  assert.match(pluginCss, /body\.layout-mobile \.five-band-fir-peq-plugin-ui/);
});
