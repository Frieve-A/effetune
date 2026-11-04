import test from 'node:test';
import assert from 'node:assert/strict';
import { sfzPreparationContext, sfzPreparationContextKey, sameSfzPreparationGeometry,
  sfzPlayerKind, materializeSfzAsset } from '../../js/sfz/preparation-context.js';
import { sfzModulationFootprint } from '../../js/sfz/modulation.js';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';
import { SFZ_MOD_KINDS as K, SFZ_MOD_STORAGE as B, SFZ_MOD_LAYOUT as L } from '../../js/sfz/modulation-schema.js';

test('preparation takes the immutable complete source tempo minimum and the legal speed floor once', () => {
  const timeline = { tempoMap: [{ seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 },
    { seconds: 4, quarter: 8, microsecondsPerQuarter: 1000000 }],
  timeSignatures: [{ seconds: 0, quarter: 0, numerator: 4, denominator: 4 }] };
  const geometry = { sampleRate: 96000, processingChannels: 4, maxFrames: 128 };
  assert.equal(sfzPreparationContext({ ...geometry, timeline }).minimumPhysicalBpm, 15);
  assert.equal(sfzPreparationContext(geometry).minimumPhysicalBpm, 0);
  assert.equal(sfzPreparationContext({ ...geometry, minimumPhysicalBpm: 15, timeline }).minimumPhysicalBpm, 15);
});

test('native byte estimates select channel geometry and reject preparation beyond the memory limit', async () => {
  const base = { payload: new ArrayBuffer(32), footprintBytes: 2048, processingChannels: 1 };
  const context = sfzPreparationContext({ sampleRate: 48000, processingChannels: 4, maxFrames: 128 });
  const descriptor = await materializeSfzAsset(base, context, 4096, async (_payload, received) => {
    assert.equal(received.processingChannels, 4); assert.equal(received.minimumPhysicalBpm, 0); return 1024;
  });
  assert.equal(descriptor.processingChannels, 4); assert.equal(descriptor.footprintBytes, 32 + 1024);
  assert.equal(await materializeSfzAsset(descriptor, { ...context, minimumPhysicalBpm: 30 }, 4096, async () => 1024), descriptor);
  await assert.rejects(materializeSfzAsset(descriptor, context, 4096, async () => 4096), { code: 'too-large' });
  await assert.rejects(materializeSfzAsset(descriptor, context, 4096, async () => 0xffffffff), { code: 'too-large' });
  const stereo = await materializeSfzAsset(descriptor, { ...context, processingChannels: 2 }, 4096, async () => 512);
  assert.notEqual(stereo, descriptor); assert.equal(stereo.footprintBytes, 32 + 512);
});

test('Main and Note players keep separate preparation geometry and budgets', async () => {
  assert.equal(sfzPlayerKind('SoundFontPlayerPlugin'), 1);
  assert.equal(sfzPlayerKind('SFZNotePlayerPlugin'), 0);
  assert.throws(() => sfzPlayerKind('OtherPlugin'), { code: 'prepare' });
  const geometry = { sampleRate: 48000, processingChannels: 2, maxFrames: 128 };
  const note = sfzPreparationContext({ ...geometry, playerKind: 0 });
  const main = sfzPreparationContext({ ...geometry, playerKind: 1 });
  assert.notEqual(sfzPreparationContextKey(note), sfzPreparationContextKey(main));
  assert.equal(sameSfzPreparationGeometry(note, main), false);
  assert.throws(() => sfzPreparationContext({ ...geometry, playerKind: 2 }), { code: 'prepare' });
  const estimates = [];
  const estimate = async (_payload, context) => {
    estimates.push(context.playerKind);
    return context.playerKind ? 2048 : 1024;
  };
  const base = { payload: new ArrayBuffer(32), footprintBytes: 32 };
  const preparedNote = await materializeSfzAsset(base, note, 4096, estimate);
  const preparedMain = await materializeSfzAsset(preparedNote, main, 4096, estimate);
  assert.notEqual(preparedMain, preparedNote);
  assert.equal(preparedNote.nativePreparationBytes, 1024);
  assert.equal(preparedMain.nativePreparationBytes, 2048);
  assert.deepEqual(estimates, [0, 1]);
});

test('the active runtime derives sizing kind from its actual player type', async () => {
  const node = {}, players = [
    { id: 1, constructor: { name: 'SoundFontPlayerPlugin' } },
    { id: 2, constructor: { name: 'SFZNotePlayerPlugin' } }
  ];
  const owner = { _audioGraphGeneration: 1,
    _getPrimaryWorkletNode: () => node,
    _getSfzRuntimePlugin: (_node, id) => players.find(player => player.id === id),
    _requestDspControl: async () => ({ ok: true, context: {
      sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0
    } }) };
  for (const [index, player] of players.entries()) {
    const active = await audioManagerSfzRuntimeMethods.getSfzPreparationContext.call(owner, player);
    const timeline = await audioManagerSfzRuntimeMethods.getSfzPreparationContext.call(owner, player, node, null);
    assert.equal(active.playerKind, index ? 0 : 1);
    assert.equal(timeline.playerKind, active.playerKind);
  }
});

test('independent optional voice pools reserve the used-bank union across disjoint regions', () => {
  const kinds = [K.Oscillator, K.SamplePlayback, K.VoiceDSP, K.NoiseLayer];
  const compiled = { curves: [], regions: kinds.map(kind => ({ instances: [{ kind }], routes: [], parameters: [] })) };
  const metadata = kinds.length * (B.RegionPlanBytes + L.InstanceWords * 4 + B.StateIndexBytes +
    B.GeneratorParametersBytes + B.ConditionIndexBytes) + B.PlaybackPlanBytes;
  const familyBytes = B.OscillatorStateBytes + B.PlaybackStateBytes + B.VoiceDspStateBytes + B.NoiseStateBytes;
  assert.equal(sfzModulationFootprint(compiled), metadata + (2 * B.MaxVoices + B.PreviewVoices) *
    (4 + B.BornFactsBytes + familyBytes));
});
