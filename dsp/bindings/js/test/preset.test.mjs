import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  EffectError,
  ValidationError,
  createChain,
  importLegacyPreset,
  parsePreset
} from '../dist/index.js';
import { LEGACY_EFFECT_ALIASES_V1 } from '../dist/preset.js';

const fixtureUrl = new URL('../../common/legacy-app-export-v1.fixture.json', import.meta.url);

function readFixture() {
  return JSON.parse(readFileSync(fixtureUrl, 'utf8'));
}

test('semantic presets are strict and do not guess legacy formats', async () => {
  assert.throws(() => parsePreset({ plugins: [] }), ValidationError);
  const preset = parsePreset({
    version: 1,
    chain: [{ type: 'Compressor', parameters: { threshold: -18 } }]
  });
  assert.equal(preset.chain[0].parameters.threshold, -18);
  assert.equal(preset.chain[0].parameters.ratio, 2);
  const chain = await createChain(JSON.stringify(preset));
  chain.close();
});

test('explicit legacy import converts long and short parameters and channels', () => {
  for (const channel of ['9', '10', '11', '12', '13', '14', '15', '16', '910', '1112', '1314', '1516']) {
    const document = importLegacyPreset({
      pipeline: [{ name: 'Volume', channel, parameters: { vl: 0 } }]
    });
    assert.equal(document.chain[0].channel, channel);
  }
  const long = importLegacyPreset({
    name: 'Long',
    pipeline: [{
      name: 'Compressor',
      enabled: true,
      channel: null,
      inputBus: 0,
      outputBus: 0,
      parameters: { th: -12, rt: 4 }
    }]
  });
  assert.equal(long.chain[0].channel, 'stereo');
  assert.equal(long.chain[0].parameters.threshold, -12);
  assert.equal(long.chain[0].parameters.ratio, 4);

  const short = importLegacyPreset({
    plugins: [{
      nm: 'Tilt EQ',
      en: true,
      ch: '34',
      f0: Math.log(1000),
      sl: 1
    }]
  });
  assert.equal(short.chain[0].type, 'TiltEQ');
  assert.equal(short.chain[0].channel, '34');
  assert.ok(Math.abs(short.chain[0].parameters.pivotFrequency - 1000) < 1e-9);
});

test('legacy Note Spectrogram discards display settings and preserves analysis settings', () => {
  const parameters = {
    cl: 'Rainbow', pr: 'High', ly: 'Vertical', vl: false, ts: 5,
    mn: 36, mx: 84
  };
  for (const preset of [
    { pipeline: [{ name: 'Note Spectrogram', parameters }] },
    { plugins: [{ nm: 'Note Spectrogram', ...parameters }] }
  ]) {
    const document = importLegacyPreset(preset);
    assert.equal(document.chain[0].type, 'NoteSpectrogram');
    assert.deepEqual(document.chain[0].parameters, {
      minimumMidi: 36, maximumMidi: 84
    });
  }
  assert.equal(parameters.cl, 'Rainbow');
  assert.throws(() => importLegacyPreset({
    pipeline: [{ name: 'Note Spectrogram', parameters: { ...parameters, typo: 1 } }]
  }), ValidationError);
  assert.equal(importLegacyPreset({
    pipeline: [{ name: 'Volume', parameters: { vl: -6 } }]
  }).chain[0].parameters.volume, -6);
});

test('legacy Pitch Meter validates and discards its display layout', () => {
  for (const layout of ['Vertical', 'Horizontal']) {
    const document = importLegacyPreset({
      pipeline: [{
        name: 'Pitch Meter',
        parameters: { rf: 442, mn: 40, mx: 88, ly: layout }
      }]
    });
    assert.equal(document.chain[0].type, 'PitchMeter');
    assert.deepEqual(document.chain[0].parameters, {
      referenceA4: 442, minimumMidi: 40, maximumMidi: 88
    });
  }
  assert.throws(() => importLegacyPreset({
    pipeline: [{ name: 'Pitch Meter', parameters: { ly: 'Diagonal' } }]
  }), ValidationError);
});

test('legacy Analog Meter validates and discards its meter-face settings', () => {
  const display = { rl: -20, rg: 60, ph: 0, sc: 2, ln: 1, tg: -14, ls: 1 };
  const document = importLegacyPreset({
    pipeline: [{ name: 'Analog Meter', parameters: display }]
  });
  assert.equal(document.chain[0].type, 'AnalogMeter');
  for (const key of Object.keys(display)) {
    assert.equal(Object.hasOwn(document.chain[0].parameters, key), false, key);
  }
  for (const parameters of [
    { rl: 1 }, { rg: 19 }, { ph: 11 }, { sc: 3 }, { sc: 1.5 }, { ln: 0.5 }, { ln: 2 }, { tg: -9 }, { ls: -1 }, { rl: '0' }
  ]) {
    assert.throws(() => importLegacyPreset({
      pipeline: [{ name: 'Analog Meter', parameters }]
    }), ValidationError, JSON.stringify(parameters));
  }
});

test('legacy Rhythm Analyzer validates and discards its beat-grid display settings', () => {
  const document = importLegacyPreset({
    pipeline: [{ name: 'Rhythm Analyzer', parameters: { mn: 60, mx: 180, sp: 12 } }]
  });
  assert.equal(document.chain[0].type, 'RhythmAnalyzer');
  assert.deepEqual(document.chain[0].parameters, { minimumBpm: 60, maximumBpm: 180, metronomeClick: false });
  for (const parameters of [{ sp: 5 }, { sp: '8' }, { sp: 3 }, { sp: 8.5 }]) {
    assert.throws(() => importLegacyPreset({
      pipeline: [{ name: 'Rhythm Analyzer', parameters }]
    }), ValidationError, JSON.stringify(parameters));
  }
});

test('legacy Rhythm Analyzer validates and discards its panel-toggle display settings', () => {
  const document = importLegacyPreset({
    pipeline: [{ name: 'Rhythm Analyzer', parameters: { mn: 60, mx: 180, vt: false, vm: true, ve: false, vl: true } }]
  });
  assert.equal(document.chain[0].type, 'RhythmAnalyzer');
  assert.deepEqual(document.chain[0].parameters, { minimumBpm: 60, maximumBpm: 180, metronomeClick: false });
  for (const key of ['vt', 'vm', 've', 'vl']) {
    for (const value of [0, 1, '0', 'true', null]) {
      assert.throws(() => importLegacyPreset({
        pipeline: [{ name: 'Rhythm Analyzer', parameters: { [key]: value } }]
      }), ValidationError, JSON.stringify({ [key]: value }));
    }
  }
});

test('legacy analyzer color and Stereo Meter gain are validated and discarded', () => {
  const effects = [
    { name: 'Pitch Meter', parameters: { rf: 442, cl: 'Rainbow' }, expected: { referenceA4: 442 } },
    { name: 'Spectrum Analyzer', parameters: { pt: 10, cl: 'Heatmap' }, expected: { points: 10 } },
    { name: 'Spectrogram', parameters: { dr: -90, cl: 'Normal' }, expected: { dBRange: -90 } },
    { name: 'Stereo Meter', parameters: { wt: 0.2, gn: 12.5 }, expected: { windowTime: 0.2 } }
  ];
  for (const preset of [
    { pipeline: effects.map(({ name, parameters }) => ({ name, parameters })) },
    { plugins: effects.map(({ name, parameters }) => ({ nm: name, ...parameters })) }
  ]) {
    const { chain } = importLegacyPreset(preset);
    for (const [index, { expected }] of effects.entries()) {
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(chain[index].parameters[key], value);
      }
      assert.equal(Object.hasOwn(chain[index].parameters, 'cl'), false);
      assert.equal(Object.hasOwn(chain[index].parameters, 'gn'), false);
    }
  }
  for (const [name, parameters] of [
    ['Pitch Meter', { cl: 'invalid' }],
    ['Spectrum Analyzer', { cl: 1 }],
    ['Spectrogram', { cl: 'Rainbow' }],
    ['Stereo Meter', { gn: -1 }],
    ['Stereo Meter', { gn: 25 }],
    ['Stereo Meter', { gn: true }]
  ]) {
    assert.throws(() => importLegacyPreset({ pipeline: [{ name, parameters }] }), ValidationError);
  }
  assert.throws(() => importLegacyPreset({
    pipeline: [{ name: 'Pitch Meter', parameters: { cl: 'Normal', mystery: 1 } }]
  }), ValidationError);
});

test('legacy analyzer frequency scale maps Log (HQ) and rejects conflicting HQ state', () => {
  for (const name of ['Spectrum Analyzer', 'Spectrogram']) {
    for (const scale of ['log', 'linear']) {
      const preset = importLegacyPreset({
        pipeline: [{ name, parameters: { sc: scale } }]
      });
      assert.equal(Object.hasOwn(preset.chain[0].parameters, 'sc'), false);
      assert.equal(preset.chain[0].parameters.highQualityLog, false);
    }
    const hq = importLegacyPreset({
      pipeline: [{ name, parameters: { sc: 'log-hq' } }]
    });
    assert.equal(hq.chain[0].parameters.highQualityLog, true);
    for (const [scale, highQualityLog] of [
      ['log', false], ['linear', false], ['log-hq', true]
    ]) {
      const consistent = importLegacyPreset({
        pipeline: [{ name, parameters: { sc: scale, hq: highQualityLog } }]
      });
      assert.equal(consistent.chain[0].parameters.highQualityLog, highQualityLog);
      assert.throws(
        () => importLegacyPreset({
          pipeline: [{ name, parameters: { sc: scale, hq: !highQualityLog } }]
        }),
        error => error instanceof ValidationError &&
          error.message.includes('conflicting frequency scale and HQ settings')
      );
    }
    assert.throws(
      () => importLegacyPreset({ pipeline: [{ name, parameters: { sc: 'invalid' } }] }),
      error => error instanceof ValidationError &&
        error.message.includes('invalid frequency scale display state')
    );
    assert.throws(
      () => importLegacyPreset({ pipeline: [{ name, parameters: { sc: 'log', mystery: 1 } }] }),
      ValidationError
    );
  }
});

test('legacy analyzer keyboard display state is validated and discarded', () => {
  for (const name of ['Spectrum Analyzer', 'Spectrogram']) {
    for (const keyboard of [true, false]) {
      const preset = importLegacyPreset({
        pipeline: [{ name, parameters: { kb: keyboard } }]
      });
      assert.equal(Object.hasOwn(preset.chain[0].parameters, 'kb'), false);
    }
    assert.throws(
      () => importLegacyPreset({ pipeline: [{ name, parameters: { kb: 1 } }] }),
      error => error instanceof ValidationError &&
        error.message.includes('invalid keyboard display state')
    );
  }
});

test('legacy Spectrum Analyzer display mode is validated and discarded', () => {
  for (const mode of ['line', 'bar']) {
    const preset = importLegacyPreset({
      pipeline: [{ name: 'Spectrum Analyzer', parameters: { dm: mode } }]
    });
    assert.equal(Object.hasOwn(preset.chain[0].parameters, 'dm'), false);
  }
  assert.throws(
    () => importLegacyPreset({
      pipeline: [{ name: 'Spectrum Analyzer', parameters: { dm: 'invalid' } }]
    }),
    error => error instanceof ValidationError &&
      error.message.includes('invalid display mode state')
  );
  assert.throws(
    () => importLegacyPreset({
      pipeline: [{ name: 'Spectrogram', parameters: { dm: 'bar' } }]
    }),
    error => error instanceof ValidationError &&
      error.message.includes('Unsupported legacy parameter Spectrogram.dm')
  );
});

test('legacy Chroma Spiral display state is validated and discarded', () => {
  for (const mode of [0, 1, 2]) {
    const preset = importLegacyPreset({
      pipeline: [{ name: 'Chroma Spiral', parameters: {
        dm: mode, lo: 1, hi: 9, ft: 3, lr: 24, df: -60
      } }]
    });
    assert.equal(preset.chain[0].type, 'ChromaSpiral');
    assert.deepEqual(preset.chain[0].parameters, {});
  }
  const fractional = importLegacyPreset({
    pipeline: [{ name: 'Chroma Spiral', parameters: { ft: -0.25, lr: 24.5, df: -60.5 } }]
  });
  assert.deepEqual(fractional.chain[0].parameters, {});
  for (const parameters of [
    { dm: true }, { dm: 3 }, { lo: 0 }, { lo: 9 }, { lo: 1.5 },
    { hi: 0 }, { hi: 10 }, { hi: '7' },
    { ft: true }, { ft: -6.1 }, { ft: 6.1 }, { ft: NaN },
    { lr: false }, { lr: 5.9 }, { lr: 96.1 }, { lr: Infinity },
    { df: '-60' }, { df: -120.1 }, { df: -23.9 }, { df: -Infinity }
  ]) {
    assert.throws(() => importLegacyPreset({
      pipeline: [{ name: 'Chroma Spiral', parameters }]
    }), ValidationError);
  }
});

test('legacy importer rejects routing and channel values a serial chain cannot represent', () => {
  assert.throws(() => importLegacyPreset({
    pipeline: [{
      name: 'Volume',
      inputBus: 1,
      outputBus: 0,
      parameters: {}
    }]
  }), ValidationError);
  assert.throws(() => importLegacyPreset({
    plugins: [{ nm: 'Volume', ch: 'surround' }]
  }), ValidationError);
});

test('numeric app display names resolve to semantic effects', () => {
  const fixture = readFixture();
  assert.deepEqual(
    { ...LEGACY_EFFECT_ALIASES_V1 },
    fixture.displayNameAliases,
    'the JavaScript alias table must match the shared cross-language fixture'
  );
  for (const [displayName, type] of Object.entries(fixture.displayNameAliases)) {
    try {
      const chain = importLegacyPreset({
        pipeline: [{ name: displayName, parameters: {} }]
      });
      assert.equal(chain.chain[0].type, type, `display name ${displayName}`);
    } catch (error) {
      // Effects the library drives from a precomputed impulse response resolve their
      // display name but cannot be converted from an app preset at all; the report
      // names the resolved semantic type.
      assert.ok(
        error.message.includes(`${type} cannot be imported from an EffeTune app preset`),
        `${displayName}: ${error.message}`
      );
    }
  }
  assert.throws(() => importLegacyPreset({
    pipeline: [{ name: fixture.unaliasedDisplayName, parameters: {} }]
  }), EffectError);
});

test('app preset envelopes are reported as legacy documents', async () => {
  const expectations = envelope => error => error instanceof ValidationError &&
    error.message.includes(`EffeTune app preset field(s): ${envelope};`) &&
    error.message.includes('importLegacyPreset()');
  for (const envelope of ['pipeline', 'plugins']) {
    assert.throws(() => parsePreset({ [envelope]: [] }), expectations(envelope));
    // Every entry point into the semantic chain document shares the guidance.
    await assert.rejects(
      () => createChain({ [envelope]: [] }),
      expectations(envelope)
    );
    await assert.rejects(
      () => createChain(JSON.stringify({ [envelope]: [] })),
      expectations(envelope)
    );
  }
  assert.throws(
    () => parsePreset({ pipeline: [], plugins: [] }),
    error => error.message.includes('field(s): pipeline, plugins')
  );
  await assert.rejects(
    () => createChain({ pipeline: [], plugins: [] }),
    error => error.message.includes('field(s): pipeline, plugins')
  );
});

test('short-format entries report the supported export format', () => {
  const expectations = error => error instanceof ValidationError &&
    error.message.includes('uses short-format keys (nm/en);') &&
    error.message.includes('URL or clipboard are not supported.') &&
    error.message.includes('.effetune_preset file (long format)');
  assert.throws(
    () => importLegacyPreset({ pipeline: [{ nm: 'Volume', en: true, vl: 0 }] }),
    error => expectations(error) && error.message.startsWith('Legacy pipeline[0]')
  );
  assert.throws(
    () => importLegacyPreset([{ nm: 'Volume', en: true, vl: 0 }]),
    expectations
  );
  // The recognized short-format envelope keeps working.
  const short = importLegacyPreset({ plugins: [{ nm: 'Volume', en: true, vl: 0 }] });
  assert.equal(short.chain[0].type, 'Volume');
});

test('legacy importer keeps malformed app presets inside the error taxonomy', () => {
  // importLegacyPreset() reads files the caller did not author, so a name that is not a
  // string must not escape as a raw TypeError from the Section probe. The Python binding
  // reports the same inputs as EffectError ("legacy effect name must be a non-empty
  // string"); the two bindings agree the import fails, not on which library error it is.
  for (const name of [123, ['Volume'], {}, true, null, undefined]) {
    assert.throws(
      () => importLegacyPreset({ pipeline: [{ name, enabled: true, parameters: {} }] }),
      error => error instanceof ValidationError && !(error instanceof TypeError),
      `name ${JSON.stringify(name) ?? String(name)}`
    );
  }
  // A packed parameter whose inverse transform is arithmetic rejects any value that is
  // not a finite number. Coercion is what makes the guard necessary rather than optional:
  // null and [] become 0 and true becomes 1, and for Simple Jitter's reference transform
  // those land inside the accepted range, so an unguarded import would invent a setting
  // the app never wrote. The Python binding rejects the same values.
  for (const node of [
    { name: 'Tilt EQ', parameters: { f0: [1, 2], sl: 0 } },
    { name: 'Simple Jitter', parameters: { rj: {} } },
    { name: 'Simple Jitter', parameters: { rj: null } },
    { name: 'Simple Jitter', parameters: { rj: true } },
    { name: 'Simple Jitter', parameters: { rj: [] } },
    { name: 'Tilt EQ', parameters: { f0: 'x', sl: 0 } },
    { name: 'Tilt EQ', parameters: { f0: Infinity, sl: 0 } },
    // A value on the wrong scale (Hz where the app stores a logarithm) overflows the
    // inverse transform to Infinity here and raises OverflowError in Python; both
    // bindings report it as a ValidationError.
    { name: 'Tilt EQ', parameters: { f0: 1000, sl: 0 } },
    { name: 'Tilt EQ', parameters: { f0: 1e9, sl: 0 } }
  ]) {
    assert.throws(
      () => importLegacyPreset({ pipeline: [{ ...node, enabled: true }] }),
      ValidationError,
      JSON.stringify(node)
    );
  }
});

test('legacy Section nodes carry the same structural fields as any other node', () => {
  // The app's long format assigns a Section an `id`, and its short format echoes the
  // serializer's structural keys into the node. Both flatten to an empty chain here, and
  // the Python binding is pinned to the same two presets.
  for (const preset of [
    { pipeline: [{ name: 'Section', enabled: true, parameters: { cm: '' }, id: 'x' }] },
    {
      plugins: [{
        nm: 'Section', en: true, cm: 'hi', ch: 'L', ib: 0, ob: 0, pluginType: 'SectionPlugin'
      }]
    }
  ]) {
    assert.deepEqual(importLegacyPreset(preset), { version: 1, chain: [] });
  }
  assert.throws(
    () => importLegacyPreset({ pipeline: [{ name: 'Section', enabled: true, mystery: 1 }] }),
    ValidationError
  );
});

function bundledPresetFiles() {
  const presetRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'presets'
  );
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(directory).sort()) {
      const candidate = path.join(directory, entry);
      if (statSync(candidate).isDirectory()) walk(candidate);
      else if (entry.endsWith('.effetune_preset')) files.push(candidate);
    }
  };
  walk(presetRoot);
  return files.map(file => ({
    file,
    relative: path.relative(presetRoot, file).split(path.sep).join('/')
  }));
}

// Mirrors the Python binding's
// test_app_serializer_corpus_reaches_its_annotated_outcome so that every plugin the
// app can export behaves identically in both languages.
test('the app serializer corpus reaches its annotated outcome for every plugin', () => {
  const corpus = readFixture().appSerializerCorpus;
  assert.equal(corpus.entries.length, corpus.count);
  const counts = {};
  for (const entry of corpus.entries) {
    const label = `${entry.displayName} (${entry.variant})`;
    counts[entry.outcome] = (counts[entry.outcome] ?? 0) + 1;
    const preset = { pipeline: [entry.node] };
    if (entry.outcome === 'imports' || entry.outcome === 'flattened') {
      const chain = importLegacyPreset(preset).chain;
      assert.deepEqual(chain.map(effect => effect.type), entry.types, label);
      for (const effect of chain) assert.equal(effect.channel, entry.channel, label);
      continue;
    }
    assert.throws(() => importLegacyPreset(preset), error => {
      assert.equal(error.name, entry.errorType, label);
      assert.ok(
        error.message.includes(entry.messageIncludes),
        `${label}: ${error.message}`
      );
      return true;
    }, label);
  }
  assert.deepEqual(counts, corpus.outcomeCounts);
});

// Mirrors the Python binding's
// test_bundled_serial_presets_import_and_multibus_presets_explain_limit so that the
// same app corpus imports in both languages.
test('bundled serial app presets import and multi-bus presets explain the limit', () => {
  const corpus = readFixture().bundledPresetCorpus;
  const files = bundledPresetFiles();
  assert.equal(files.length, corpus.count);
  const multiBus = new Set(corpus.multiBus);
  for (const { file, relative } of files) {
    const preset = JSON.parse(readFileSync(file, 'utf8'));
    if (multiBus.has(relative)) {
      assert.throws(
        () => importLegacyPreset(preset),
        error => error instanceof ValidationError &&
          error.message.includes('serial chain'),
        `${relative} should report the serial chain limit`
      );
      continue;
    }
    const document = importLegacyPreset(preset);
    assert.ok(document.chain.length > 0, `${relative} imported an empty chain`);
  }
});

test('bundled app presets resolve every effect display name', () => {
  for (const { file, relative } of bundledPresetFiles()) {
    const preset = JSON.parse(readFileSync(file, 'utf8'));
    try {
      importLegacyPreset(preset);
    } catch (error) {
      // Multi-bus routing is a separate concern; only name resolution
      // (EffectError) is asserted here.
      assert.ok(
        !(error instanceof EffectError),
        `${relative} failed name resolution: ${error.message}`
      );
    }
  }
});

test('structured app parameter shapes convert exactly like the Python binding', () => {
  const fixture = readFixture().structuredParameters;
  const actual = importLegacyPreset(fixture.preset).chain;
  assert.equal(actual.length, fixture.expected.length);
  for (const [index, expected] of fixture.expected.entries()) {
    assert.equal(actual[index].type, expected.type);
    assert.equal(actual[index].enabled, expected.enabled);
    assert.equal(actual[index].channel, expected.channel);
    assert.deepEqual(actual[index].parameters, expected.parameters, expected.type);
  }
  for (const invalid of fixture.invalid) {
    assert.throws(
      () => importLegacyPreset(invalid.preset),
      error => error instanceof ValidationError && error.message.includes(invalid.message),
      invalid.reason
    );
  }
});

// Mirrors the Python binding's
// test_echoed_structural_keys_are_dropped_from_legacy_parameters.
test("the app's echoed structural parameter keys are ignored", () => {
  const fixture = readFixture().echoedStructuralKeys;
  const actual = importLegacyPreset(fixture.preset).chain;
  assert.equal(actual.length, fixture.expected.length);
  for (const [index, expected] of fixture.expected.entries()) {
    assert.equal(actual[index].type, expected.type);
    assert.equal(actual[index].enabled, expected.enabled, expected.type);
    assert.equal(actual[index].channel, expected.channel, expected.type);
    for (const [name, value] of Object.entries(expected.parameters)) {
      assert.deepEqual(actual[index].parameters[name], value, `${expected.type}.${name}`);
    }
  }
});

// Mirrors the Python binding's
// test_bare_array_presets_are_read_as_a_long_format_pipeline.
test('bare array presets are read as a long-format pipeline', () => {
  const fixture = readFixture().bareArrayPipeline;
  for (const source of [fixture.long, JSON.stringify(fixture.long)]) {
    const actual = importLegacyPreset(source).chain;
    assert.equal(actual.length, fixture.expected.length);
    for (const [index, expected] of fixture.expected.entries()) {
      assert.equal(actual[index].type, expected.type);
      assert.equal(actual[index].enabled, expected.enabled, expected.type);
      assert.equal(actual[index].channel, expected.channel, expected.type);
      for (const [name, value] of Object.entries(expected.parameters)) {
        assert.deepEqual(actual[index].parameters[name], value, `${expected.type}.${name}`);
      }
    }
  }
  assert.throws(
    () => importLegacyPreset(fixture.short),
    error => error instanceof ValidationError &&
      error.message.includes(fixture.shortMessageIncludes)
  );
});

test('legacy importer follows the shared app export contract fixture', () => {
  const fixture = readFixture();
  const actual = importLegacyPreset(fixture.preset).chain.map(effect => ({
    id: effect.id,
    type: effect.type,
    enabled: effect.enabled,
    channel: effect.channel,
    parameters: effect.parameters
  }));
  for (let index = 0; index < fixture.expected.length; index++) {
    if (Object.hasOwn(fixture.expected[index], 'id')) {
      assert.equal(actual[index].id, fixture.expected[index].id);
    }
    assert.equal(actual[index].type, fixture.expected[index].type);
    assert.equal(actual[index].enabled, fixture.expected[index].enabled);
    assert.equal(actual[index].channel, fixture.expected[index].channel);
    if (actual[index].type === 'TiltEQ') {
      assert.ok(Math.abs(
        actual[index].parameters.pivotFrequency -
        fixture.expected[index].parameters.pivotFrequency
      ) < 1e-9);
      assert.equal(
        actual[index].parameters.slope,
        fixture.expected[index].parameters.slope
      );
    } else {
      assert.deepEqual(actual[index].parameters, fixture.expected[index].parameters);
    }
  }
  assert.throws(() => importLegacyPreset(fixture.unknownEffect), EffectError);
});
