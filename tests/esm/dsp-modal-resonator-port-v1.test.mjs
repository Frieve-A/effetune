import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'resonator', 'modal_resonator');
const expectedCaseIds = [
  'default-impulse',
  'all-disabled-dry-path',
  'mixed-modes-44100-mono',
  'all4-192000-extremes',
  'one-frame-blocks',
  'disabled-mode-freeze-resume',
  'live-parameter-change-preserves-state',
  'mix-breakpoints-preserve-tail'
];

test('ModalResonatorPlugin object-array ABI, reviewed cases, and goldens stay frozen',
  async () => {
    const schemaPath = path.join(pluginRoot, 'params.json');
    const [schemaText, casesText] = await Promise.all([
      fs.readFile(schemaPath, 'utf8'),
      fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8')
    ]);
    const schema = validateParamSpec(JSON.parse(schemaText), schemaPath);
    const cases = JSON.parse(casesText).cases;

    assert.equal(schema.type, 'ModalResonatorPlugin');
    assert.equal(schema.hash, 0x5c38e864);
    assert.equal(schema.floatCount, 31);
    assert.equal(schema.tolerance.abs, 0.0001);
    const resonatorMembers = ['en', 'fr', 'dc', 'lp', 'hp', 'gn'];
    assert.deepEqual(
      schema.fields.slice(0, 6).map(field => [
        field.key, field.objectArrayKey, field.memberKey, field.count, field.keys
      ]),
      resonatorMembers.map(member => [
        member,
        'rs',
        member,
        5,
        Array.from({ length: 5 }, (_, index) => `${member}${index}`)
      ])
    );
    assert.deepEqual(schema.fields[6].keys, ['mx']);

    const packer = DSP_PARAM_PACKERS.get('ModalResonatorPlugin');
    assert.ok(packer);
    assert.equal(packer.hash, 0x5c38e864);
    assert.equal(packer.floatCount, 31);
    assert.deepEqual(packer.pack(), Float32Array.from([
      1, 1, 1, 1, 1,
      6.86, 7.52, 7.99, 8.34, 8.75,
      15, 12, 10, 8, 6,
      7.19, 7.86, 8.33, 8.68, 9.08,
      5.8, 6.48, 6.94, 7.29, 7.7,
      0, -3, -6, -9, -12,
      25
    ]));
    const packed = packer.pack({
      rs: Array.from({ length: 5 }, (_, index) => ({
        en: index % 2 === 0,
        fr: 3 + index,
        dc: 10 + index,
        lp: 4 + index,
        hp: 5 + index,
        gn: -2 + index
      })),
      mx: 73
    });
    assert.deepEqual([...packed.slice(0, 5)], [1, 0, 1, 0, 1]);
    assert.deepEqual([...packed.slice(5, 10)], [3, 4, 5, 6, 7]);
    assert.deepEqual([...packed.slice(25, 31)], [-2, -1, 0, 1, 2, 73]);
    const flatPacked = packer.pack({
      en0: false, en1: false, en2: false, en3: false, en4: false,
      fr0: 4, fr1: 5, fr2: 6, fr3: 7, fr4: 8,
      dc0: 20, dc1: 21, dc2: 22, dc3: 23, dc4: 24,
      lp0: 4, lp1: 5, lp2: 6, lp3: 7, lp4: 8,
      hp0: 5, hp1: 6, hp2: 7, hp3: 8, hp4: 9,
      gn0: -10, gn1: -5, gn2: 0, gn3: 5, gn4: 10,
      mx: 64
    });
    assert.deepEqual([...flatPacked], [
      0, 0, 0, 0, 0,
      4, 5, 6, 7, 8,
      20, 21, 22, 23, 24,
      4, 5, 6, 7, 8,
      5, 6, 7, 8, 9,
      -10, -5, 0, 5, 10,
      64
    ]);

    assert.deepEqual(cases.map(item => item.id), expectedCaseIds);
    assert.equal(cases.find(item => item.id === 'all4-192000-extremes').channels, 4);
    assert.equal(cases.find(item => item.id === 'one-frame-blocks').blockSize, 1);
    assert.equal(cases.find(item => item.id === 'disabled-mode-freeze-resume')
      .events.length, 2);
    assert.equal(cases.find(item => item.id === 'live-parameter-change-preserves-state')
      .events.length, 2);

    const goldens = await readGoldenSet(path.join(pluginRoot, 'golden'));
    assert.equal(goldens.length, 8);
    assert.ok(goldens.every(item => item.metadata.type === 'ModalResonatorPlugin'));
    assert.ok(goldens.every(item => item.metadata.jsEngineHash ===
      'd41d6e2d1fb2fe87b01b55ec8c42bbd18ac79eb14d96e46c178614192c870b0b'));
    assert.ok(goldens.every(item => item.expected.every(Number.isFinite)));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', 'ModalResonatorPlugin',
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, 8);
    assert.ok(result.results.every(item => item.comparison.pass));
  });

test('ModalResonatorPlugin kernel preserves JS state and numeric storage boundaries',
  async () => {
    const [kernel, common, nativeTest, registry, cmake, source, readme] = await Promise.all([
      fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8'),
      fs.readFile(path.join(pluginRoot, 'modal_resonator_common.h'), 'utf8'),
      fs.readFile(path.join(pluginRoot, 'native_test.cpp'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'plugins', 'resonator', 'modal_resonator.js'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'dsp', 'README.md'), 'utf8')
    ]);

    assert.match(kernel, /std::vector<float> delay_buffers_/);
    assert.match(kernel, /std::vector<float> accumulation_/);
    assert.match(kernel, /double high_pass_x_previous/);
    assert.match(kernel, /double high_pass_y_previous/);
    assert.match(kernel, /double low_pass_y_previous/);
    assert.match(kernel, /delay\[position\] = static_cast<float>/);
    assert.match(kernel, /accumulation_\[frame\]\s*=\s*static_cast<float>\s*\(/);
    assert.match(kernel, /if\s*\(\s*!config\.enabled\s*\)\s*continue\s*;/);
    assert.match(kernel,
      /if\s*\(\s*active_channels_\s*!=\s*channel_count\s*\)\s*initializeChannels\s*\(\s*channel_count\s*\)\s*;/);
    assert.match(kernel, /requested_delay >= static_cast<double>\(delay_buffer_length_\)/);
    assert.doesNotMatch(kernel, /paramsDirty\(\)/);
    const processBody = /void process\([\s\S]*?\n  }\n\nprivate:/.exec(kernel)?.[0];
    assert.ok(processBody);
    assert.doesNotMatch(processBody, /\.resize\(|\.reserve\(|push_back|\bnew\b/);

    assert.match(common, /kMinimumFrequencyLog = 3\.0/);
    assert.match(common,
      /std::floor\(sample_rate \/ std::exp\(kMinimumFrequencyLog\)\)/);
    assert.match(common, /static_cast<std::uint32_t>\(maximum_delay\) \+ 1u/);

    assert.match(nativeTest, /allocation_guard::Scope allocation_scope/);
    assert.match(nativeTest, /testDisabledResonatorFreezesAllState/);
    assert.match(nativeTest, /testParameterChangesPreserveDelayAndFilterState/);
    assert.match(nativeTest, /testBlockSizeChangesPreserveState/);
    assert.match(nativeTest, /testChannelCountChangeFullyResetsState/);
    assert.match(nativeTest, /testSampleRatePrepareFullyResetsState/);
    assert.match(nativeTest, /testMaximumRateEightChannelCapacityAndAllocation/);
    assert.match(nativeTest, /delay_length == 9560u/);
    assert.match(nativeTest, /delay_bytes == 1529600u/);
    assert.match(nativeTest, /malformed\.frequencyLog\[0\] = -100\.0F/);
    assert.match(registry,
      /EFFETUNE_PLUGIN\(ModalResonatorPlugin, resonator\/modal_resonator\)/);
    assert.match(cmake, /effetune_dsp_modal_resonator_tests/);
    assert.match(source, /context\.delayBuffers\[ch\]\[r\] = new Float32Array/);
    assert.match(source, /context\.accum = new Float32Array/);
    assert.match(source, /if \(!cfg\.enabled\) continue/);
    assert.match(readme, /### Modal Resonator Capacity Decision/);
    assert.match(readme, /1,529,600 delay bytes/);
  });
