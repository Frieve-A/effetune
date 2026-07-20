import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'vinyl_simulator');

test('Vinyl Simulator freezes the v1 parameter layout and parity matrix', async () => {
  const schemaPath = path.join(pluginRoot, 'params.json');
  const [schemaText, casesText] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8')
  ]);
  const raw = JSON.parse(schemaText);
  const schema = validateParamSpec(raw, schemaPath);
  const cases = JSON.parse(casesText).cases;

  assert.equal(schema.type, 'VinylSimulatorPlugin');
  assert.equal(schema.floatCount, 20);
  assert.deepEqual(
    raw.fields.map(({ key }) => key),
    ['lv', 'hf', 'mb', 'sm', 'rp', 'rd', 'rg', 'dr', 'st', 'sc',
      'sh', 'rs', 'rc', 'tf', 'tm', 'cm', 'dz', 'ql', 'og', 'mx']
  );
  assert.deepEqual(raw.fields.find(field => field.key === 'rp').values, ['33⅓', '45', '78']);
  assert.deepEqual(raw.fields.find(field => field.key === 'sh').values,
    ['Spherical', 'Elliptical']);
  assert.deepEqual(raw.fields.find(field => field.key === 'ql').values,
    ['Eco', 'Standard', 'High', 'Ultra']);

  assert.equal(cases.length, 16);
  assert.ok(cases.every(item => item.params?.fr === true));
  assert.ok(cases.some(item => item.stimulus === 'silence'));
  assert.ok(cases.some(item => item.sampleRate === 44100 && item.channels === 1));
  assert.ok(cases.some(item => item.sampleRate === 48000));
  assert.ok(cases.some(item => item.sampleRate === 192000 && item.params.ql === 'Ultra'));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.channels === 4 && item.channelMode === 'all4'));
  assert.ok(cases.some(item => item.events?.some(event => event.params.ql)));
  assert.ok(cases.some(item => item.events?.some(event => event.params.rp)));
  assert.ok(cases.some(item => item.id === 'standard-static-discharge-silence' &&
    item.stimulus === 'silence' && item.params.st === 1000 &&
    item.params.dr === 0 && item.params.sc === 0));
  for (const sampleRate of [44100, 48000, 96000]) {
    assert.ok(cases.some(item => (item.sampleRate ?? 96000) === sampleRate &&
      item.stimulus === 'silence' && item.params.tm === 0.1 && item.params.tf === 5));
  }
});

test('Vinyl Simulator bounds the seeded static-only reference peak', async () => {
  const goldenRoot = path.join(pluginRoot, 'golden');
  const index = JSON.parse(await fs.readFile(path.join(goldenRoot, 'index.json'), 'utf8'));
  const metadata = await Promise.all(index.cases.map(async file =>
    JSON.parse(await fs.readFile(path.join(goldenRoot, file), 'utf8'))));
  const staticCase = metadata.find(item => item.id === 'standard-static-discharge-silence');
  assert.ok(staticCase);

  const audio = await fs.readFile(path.join(goldenRoot, staticCase.binary));
  let peak = 0;
  for (let offset = 0; offset < audio.byteLength; offset += 4) {
    const sample = Math.abs(audio.readFloatLE(offset));
    if (sample > peak) peak = sample;
  }
  assert.ok(peak > 0.05, `expected audible static events, got peak ${peak}`);
  assert.ok(peak < 0.12, `expected bounded static events, got peak ${peak}`);
});

test('Vinyl Simulator kernel preserves fixed-capacity physical topology', async () => {
  const kernel = await fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8');
  const processStart = kernel.indexOf('  void process(float *audio');
  const telemetryStart = kernel.indexOf('  void writeTelemetry(', processStart);
  assert.ok(processStart >= 0 && telemetryStart > processStart);
  const processBody = kernel.slice(processStart, telemetryStart);

  assert.match(kernel, /kSignalLength = 1u << 15u/);
  assert.match(kernel, /kRoughLength = 1u << 18u/);
  assert.match(kernel, /kMaximumDust = 176u/);
  assert.match(kernel, /kDustTopPoints = 49u/);
  assert.match(kernel, /kMaximumScanPoints = 25u/);
  assert.match(kernel, /struct StereoSample final[\s\S]*float left[\s\S]*float right/);
  assert.match(kernel, /signal_\.resize\(kSignalLength\)/);
  assert.match(kernel, /rough_\.resize\(kRoughLength\)/);
  assert.match(kernel, /dust_\.resize\(kMaximumDust\)/);
  assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);

  assert.match(kernel, /substeps_ = 2u;\s*scan_points_ = 7u/);
  assert.match(kernel, /substeps_ = 4u;\s*scan_points_ = 9u/);
  assert.match(kernel, /substeps_ = 8u;\s*scan_points_ = 13u/);
  assert.match(kernel, /substeps_ = 20u;\s*scan_points_ = kMaximumScanPoints/);
  assert.match(kernel, /quality != last_quality_ \|\| shape != last_shape_/);
  assert.match(kernel, /std::ceil\(kMaximumScanRadius \* sample_rate_ \/ kMinimumGrooveSpeed\) \+ 4\.0/);
  assert.match(kernel, /const double read_sample =\s*static_cast<double>\(sample_counter_\) -\s*static_cast<double>\(latency_samples_\)/);

  assert.match(kernel, /recording_riaa_left_\.process/);
  assert.match(kernel, /playback_riaa_left_\.process/);
  assert.match(kernel, /ContactPair wallContactPair\([\s\S]*?const ScanGeometry &scan\) const noexcept/);
  assert.match(kernel, /const double offset = scan\.offsets\[point\][\s\S]*?result\.left[\s\S]*?result\.right/);
  assert.match(kernel, /const ContactPair contact\s*=\s*wallContactPair\(\s*distance_left,\s*distance_right,\s*center_sample,\s*collect_metrics,\s*scan\s*\)/);
  assert.match(kernel, /2\.0e-6 \*\s*\(left\.integral - previous_integral_left_\) \/ dt/);
  assert.match(kernel, /std::array<float, kDustTopPoints> top/);
  assert.match(kernel, /crushDust\(0u, center_sample, controls_\.side_radius - distance_left\)/);
  assert.match(kernel, /center_sample \+\s*offset \* sample_rate_ \/ controls_\.groove_speed/);
  assert.match(kernel, /smooth\(controls_\.hf_cutoff, targets_\.hf_cutoff\)/);
  assert.match(kernel, /smooth\(controls_\.bass_mono_below, targets_\.bass_mono_below\)/);
  assert.match(kernel, /std::sqrt\(meter_jitter_variance_ns2_\)/);
  assert.match(kernel, /kContactStepsPerCycle = 8u/);
  assert.match(kernel, /contact_stiffness = 1\.5 \* hertz \* std::sqrt\(indentation\)/);
  assert.match(kernel, /substeps_ < minimum/);
  assert.match(kernel, /particle\.scratch \? particle\.scratch_support/);
  assert.match(kernel, /absolute_distance <= support \+ scan_half_/);
  assert.match(kernel, /dust_gaussian_has_spare_/);
  assert.match(kernel, /std::sqrt\(-2\.0 \* std::log\(radius_squared\) \/ radius_squared\)/);
  assert.match(kernel, /rough_random_\.nextFloatSigned\(\)/);
  assert.match(kernel, /dsp::XorShiftRng master\(seed\)/);
  assert.match(kernel, /master\.nextU64\(\) >> 32u/);
  assert.match(kernel, /kStaticReferenceGain = 0\.251188643150958/);
  assert.match(kernel, /kReferenceVelocity \*\s*kStaticReferenceGain/);
  assert.match(kernel, /kPhonoInputResistance = 47\.0e3/);
  assert.match(kernel, /kPhonoInputCapacitance = 200\.0e-12/);
  assert.match(kernel, /kStaticDecaySeconds = kPhonoInputResistance \* kPhonoInputCapacitance/);
  assert.match(kernel, /std::exp\(-age \/ kStaticDecaySeconds\)/);
  assert.doesNotMatch(kernel, /std::exp\(-age \/ 0\.4e-3\)/);
  assert.match(kernel, /static_assert\(sizeof\(VinylSimulatorKernel\) <= 8192u\)/);
});

test('Vinyl Simulator integration registers WASM-only rollout and telemetry v1', async () => {
  const [registry, cmake, readme, rollout, telemetry, plugin, css] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'dsp-rollout.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'js', 'audio', 'telemetry-hub.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'lofi', 'vinyl_simulator.js'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'plugins', 'lofi', 'vinyl_simulator.css'), 'utf8')
  ]);

  assert.match(registry, /EFFETUNE_PLUGIN\(VinylSimulatorPlugin, lofi\/vinyl_simulator\)/);
  assert.match(cmake, /effetune_dsp_vinyl_simulator_tests[\s\S]*vinyl_simulator\/native_test\.cpp/);
  assert.match(rollout, /'VinylArtifactsPlugin',\s*'VinylSimulatorPlugin'/);
  assert.match(readme, /Type 15\s*\(`TAP_VINYL_SIMULATOR`\)[\s\S]*exactly 48 bytes/);
  assert.match(telemetry, /TAP_VINYL_SIMULATOR:\s*15/);

  assert.match(plugin, /if \(!parameters\.fr \|\| typeof context\.__seededRandom !== 'function'\) \{[\s\S]*measurements = \{ bypass: true \}/);
  assert.match(plugin, /delete params\.fr/);
  assert.match(plugin, /delete runtimeParameters\.fr/);
  assert.match(plugin, /getTemporalCapability\(\)[\s\S]*must-process/);
  assert.match(plugin, /VINYL_SIMULATOR_TAP_PHYSICS\s*=\s*15/);
  assert.match(plugin, /payload\.byteLength !== VINYL_SIMULATOR_TELEMETRY_BYTES/);
  assert.match(plugin, /setAttribute\('role', 'status'\)/);
  assert.match(plugin, /setAttribute\('aria-live', 'polite'\)/);
  assert.match(plugin, /setEnabled\(enabled\)[\s\S]*super\.setEnabled\(enabled\)[\s\S]*drawHud\(\)/);
  assert.match(plugin, /kind < 0\.28[\s\S]*kind < 0\.63[\s\S]*kind < 0\.80[\s\S]*kind < 0\.95/);
  assert.match(plugin, /particle\.kind === DUST_KIND_FIBER \|\|[\s\S]*particle\.lateral_half/);
  assert.match(plugin, /particle\.kind === DUST_KIND_GRIT\) particle\.dying = true/);
  assert.match(plugin, /STATIC_REFERENCE_GAIN = 0\.251188643150958/);
  assert.match(plugin, /REFERENCE_VELOCITY \* STATIC_REFERENCE_GAIN/);
  assert.match(plugin, /READING_JITTER_BAR_MAX_NS = 1000/);
  assert.match(plugin, /level: jitterMagnitude \/ READING_JITTER_BAR_MAX_NS/);
  assert.match(plugin, /PHONO_INPUT_RESISTANCE = 47e3/);
  assert.match(plugin, /PHONO_INPUT_CAPACITANCE = 200e-12/);
  assert.match(plugin, /STATIC_DECAY_SECONDS = PHONO_INPUT_RESISTANCE \* PHONO_INPUT_CAPACITANCE/);
  assert.match(plugin, /Math\.exp\(-age \/ STATIC_DECAY_SECONDS\)/);
  assert.doesNotMatch(plugin, /Math\.exp\(-age \/ 0\.4e-3\)/);
  assert.match(css, /\.vinyl-simulator-hud\s*\{[\s\S]*min-height:\s*140px/);
});

test('Vinyl Simulator refreshes the Scan Radius track after Spherical sync', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'vinyl_simulator.js'), 'utf8');
  let refreshedSlider = null;
  let refreshedValue = null;
  const context = {
    PluginBase: class {},
    window: {
      uiManager: {
        refreshRangeFillStyling(slider) {
          refreshedSlider = slider;
          refreshedValue = slider.value;
        }
      }
    }
  };
  vm.runInNewContext(source, context);

  const slider = { disabled: false, value: 2 };
  const number = { disabled: false, value: 2 };
  let disabledClass = null;
  const plugin = Object.create(context.window.VinylSimulatorPlugin.prototype);
  plugin.sh = 'Spherical';
  plugin.rc = 17.5;
  plugin.scanRadiusRow = {
    querySelector(selector) {
      return selector === 'input[type="range"]' ? slider : number;
    },
    classList: {
      toggle(name, enabled) {
        if (name === 'parameter-disabled') disabledClass = enabled;
      }
    }
  };

  plugin._syncScanRadiusControl();

  assert.equal(slider.value, 17.5);
  assert.equal(number.value, 17.5);
  assert.equal(slider.disabled, true);
  assert.equal(number.disabled, true);
  assert.equal(disabledClass, true);
  assert.equal(refreshedSlider, slider);
  assert.equal(refreshedValue, 17.5);
});

test('Vinyl Simulator keeps reference mode inside the seeded parity harness', async () => {
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'vinyl_simulator.js'), 'utf8');
  class PluginBase {
    constructor() {
      this.enabled = true;
      this._sectionEnabled = true;
      this._powerUiEnabled = true;
      this.id = 1;
    }

    registerProcessor(processor) { this.processorString = processor; }
    updateParameters() {}
    getSerializableParameters() { return {}; }
    getWorkletPluginData(parameters) { return parameters; }
    setEnabled(enabled) {
      if (this.enabled === enabled) return;
      this.enabled = enabled;
      this.updateParameters();
      this._refreshAnimationState();
    }
    _setSectionEnabled(enabled) {
      const next = enabled !== false;
      if (this._sectionEnabled === next) return;
      this._sectionEnabled = next;
      this._refreshAnimationState();
    }
    setPowerUiEnabled(enabled) {
      const next = enabled !== false;
      if (this._powerUiEnabled === next) return;
      this._powerUiEnabled = next;
      this._refreshAnimationState();
    }
    canRunAnimation() {
      return this.enabled !== false && this._sectionEnabled !== false &&
        this._powerUiEnabled !== false;
    }
    _refreshAnimationState() {
      if (this.canRunAnimation()) this.startAnimation?.();
      else this.stopAnimation?.();
    }
    requestPowerAnimationFrame() {
      return this.canRunAnimation() ? 23 : null;
    }
  }
  const cancelledFrames = [];
  const context = {
    PluginBase,
    cancelAnimationFrame: id => cancelledFrames.push(id),
    performance: { now: () => 1000 },
    window: { dspTelemetryHub: null }
  };
  vm.runInNewContext(source, context);
  const plugin = new context.window.VinylSimulatorPlugin();
  plugin.setParameters({ fr: true });
  const parameters = {
    ...plugin.getParameters(),
    sampleRate: 48000,
    blockSize: 4,
    channelCount: 1
  };
  const audio = new Float32Array([0.25, -0.5, 0.75, -1]);
  const expected = [...audio];
  const processor = new Function('data', 'parameters', 'context', plugin.processorString);
  const result = processor(audio, parameters, {});

  assert.deepEqual([...result], expected);
  assert.deepEqual(result.measurements, { bypass: true });

  plugin.hudCreatedAt = 0;
  plugin.lastTelemetryAt = 0;
  plugin.lastBypassAt = 1100;
  plugin.bypassSince = 500;
  assert.equal(plugin._hudMode(1200), 'loading');
  assert.equal(plugin._hudMode(1600), 'bypass');

  let statusText = '';
  let statusUpdates = 0;
  const status = {
    attributes: new Map([['aria-live', 'polite']]),
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    get textContent() { return statusText; },
    set textContent(value) {
      statusText = value;
      statusUpdates++;
    }
  };
  plugin.hudStatusElement = status;
  plugin.lastHudStatusMode = null;
  plugin._updateHudStatus('active');
  assert.match(status.textContent, /WASM is active/);
  plugin._updateHudStatus('active');
  assert.equal(statusUpdates, 1);

  let canvasDraws = 0;
  const canvasText = [];
  const context2d = {
    clearRect() { canvasDraws++; canvasText.length = 0; },
    fillRect() {},
    strokeRect() {},
    fillText(value) { canvasText.push(value); }
  };
  plugin.hudCanvas = {
    width: 700,
    height: 100,
    clientWidth: 700,
    getBoundingClientRect: () => ({ width: 700 }),
    getContext: () => context2d
  };
  plugin.lastTelemetryAt = 1000;
  plugin.animationFrameId = 17;

  plugin._setSectionEnabled(false);
  assert.equal(plugin.animationFrameId, null);
  assert.equal(plugin._hudMode(1000), 'paused');
  assert.equal(statusText,
    'The physics display is paused while its section or visual display is inactive.');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.deepEqual(canvasText, [
    'Physics display paused',
    'Turn the Section and visual display back on to resume.'
  ]);
  assert.equal(canvasDraws, 1);

  plugin._setSectionEnabled(true);
  assert.equal(plugin.animationFrameId, 23);
  assert.equal(plugin._hudMode(1000), 'active');
  assert.match(statusText, /WASM is active/);

  plugin.setPowerUiEnabled(false);
  assert.equal(plugin.animationFrameId, null);
  assert.equal(plugin._hudMode(1000), 'paused');
  assert.equal(statusText,
    'The physics display is paused while its section or visual display is inactive.');
  assert.deepEqual(canvasText, [
    'Physics display paused',
    'Turn the Section and visual display back on to resume.'
  ]);
  assert.equal(canvasDraws, 3);

  plugin.setPowerUiEnabled(true);
  assert.equal(plugin.animationFrameId, 23);
  assert.equal(plugin._hudMode(1000), 'active');
  assert.match(statusText, /WASM is active/);

  plugin.setEnabled(false);
  assert.equal(plugin.animationFrameId, null);
  assert.deepEqual(cancelledFrames, [17, 23, 23]);
  assert.equal(canvasDraws, 5);
  assert.equal(statusText, 'Effect is off.');
  assert.equal(statusUpdates, 6);
});
