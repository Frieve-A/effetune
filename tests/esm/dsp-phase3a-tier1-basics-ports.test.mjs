import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { generateGoldens } from '../../tools/dsp-parity/generate.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const basicsRoot = path.join(repoRoot, 'dsp', 'plugins', 'basics');

const ports = [
  {
    directory: 'mute',
    type: 'MutePlugin',
    hash: 0x811c9dc5,
    floatCount: 0,
    caseCount: 11
  },
  {
    directory: 'polarity_inversion',
    type: 'PolarityInversionPlugin',
    hash: 0x811c9dc5,
    floatCount: 0,
    caseCount: 11
  },
  {
    directory: 'dc_offset',
    type: 'DCOffsetPlugin',
    hash: 0x41dc2138,
    floatCount: 1,
    caseCount: 13
  },
  {
    directory: 'stereo_balance',
    type: 'StereoBalancePlugin',
    hash: 0x113edd5b,
    floatCount: 1,
    caseCount: 16
  }
];

async function goldenBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      bytes += (await fs.stat(path.join(directory, entry.name))).size;
    }
  }
  return bytes;
}

function stimulusFor(metadata) {
  return generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex,
    seed: BigInt(metadata.seed)
  });
}

function namedCase(goldens, id) {
  const golden = goldens.find(item => item.metadata.id === id);
  assert.ok(golden, `missing golden case ${id}`);
  return golden;
}

test('Phase 3a Tier-1 basics schemas preserve the legacy parameter layouts', async () => {
  for (const port of ports) {
    const schemaPath = path.join(basicsRoot, port.directory, 'params.json');
    const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    const schema = validateParamSpec(raw, schemaPath);
    assert.equal(schema.type, port.type);
    assert.equal(schema.hash, port.hash);
    assert.equal(schema.floatCount, port.floatCount);
  }
});

test('Phase 3a Tier-1 basics goldens are fresh, bounded, and shape-consistent', async () => {
  for (const port of ports) {
    const goldenDir = path.join(basicsRoot, port.directory, 'golden');
    assert.ok(
      await goldenBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES,
      `${port.type} exceeds the 2 MiB golden budget`
    );

    const goldens = await readGoldenSet(goldenDir);
    assert.equal(goldens.length, port.caseCount);
    for (const golden of goldens) {
      const { metadata, expected } = golden;
      assert.equal(metadata.type, port.type);
      assert.equal(expected.length, metadata.frameCount * metadata.channels);
      assert.ok(metadata.frameCount <= 2048);
    }

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, port.caseCount);
    assert.equal(result.results.every(item => item.comparison.pass), true);
  }
});

test('Phase 3a Tier-1 basics goldens regenerate byte-for-byte', async t => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-phase3a-basics-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  for (const port of ports) {
    const committedDir = path.join(basicsRoot, port.directory, 'golden');
    const regeneratedDir = path.join(temporaryRoot, port.directory);
    await generateGoldens({
      type: port.type,
      repoRoot,
      outputDir: regeneratedDir,
      log() {}
    });

    const committedNames = (await fs.readdir(committedDir)).sort();
    const regeneratedNames = (await fs.readdir(regeneratedDir)).sort();
    assert.deepEqual(regeneratedNames, committedNames);
    for (const name of committedNames) {
      assert.deepEqual(
        await fs.readFile(path.join(regeneratedDir, name)),
        await fs.readFile(path.join(committedDir, name)),
        `${port.type}/${name} did not regenerate deterministically`
      );
    }
  }
});

test('Phase 3a Tier-1 basics goldens capture exact sample and channel behavior', async () => {
  const muteGoldens = await readGoldenSet(path.join(basicsRoot, 'mute', 'golden'));
  for (const value of namedCase(muteGoldens, 'short-final-block-all-channels').expected) {
    assert.equal(value, 0);
  }

  const polarityGoldens = await readGoldenSet(
    path.join(basicsRoot, 'polarity_inversion', 'golden')
  );
  const polarity = namedCase(polarityGoldens, 'non-aligned-mono');
  const polarityInput = stimulusFor(polarity.metadata);
  for (let index = 0; index < polarity.expected.length; ++index) {
    assert.equal(polarity.expected[index], -polarityInput[index]);
  }

  const offsetGoldens = await readGoldenSet(path.join(basicsRoot, 'dc_offset', 'golden'));
  const offset = namedCase(offsetGoldens, 'fractional-positive-stereo');
  const offsetInput = stimulusFor(offset.metadata);
  for (let index = 0; index < offset.expected.length; ++index) {
    assert.equal(offset.expected[index], Math.fround(offsetInput[index] + 0.1));
  }
  assert.equal(offset.expected.some(value => value > 1), true);

  const balanceGoldens = await readGoldenSet(
    path.join(basicsRoot, 'stereo_balance', 'golden')
  );
  const mono = namedCase(balanceGoldens, 'mono-bypass');
  assert.deepEqual(mono.expected, stimulusFor(mono.metadata));

  const allChannels = namedCase(balanceGoldens, 'right-bias-all-channels');
  const allChannelsInput = stimulusFor(allChannels.metadata);
  for (let index = 0; index < allChannels.expected.length; ++index) {
    const expected = index < allChannels.metadata.frameCount
      ? Math.fround(allChannelsInput[index] * 0.5)
      : allChannelsInput[index];
    assert.equal(allChannels.expected[index], expected);
  }
});
