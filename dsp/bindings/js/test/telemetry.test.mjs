import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeTelemetryPacket } from '../dist/telemetry.js';

const HQ_MIN_FREQUENCY = 20;
const HQ_MAX_FREQUENCY = 40_000;

function validRange(frameType, cellCount, sampleRate) {
  let firstValidIndex = cellCount;
  let validCellCount = 0;
  const logStep = Math.log(HQ_MAX_FREQUENCY / HQ_MIN_FREQUENCY) / (cellCount - 1);
  for (let index = 0; index < cellCount; index++) {
    const ascending = frameType === 4 ? index : cellCount - 1 - index;
    const frequency = ascending === cellCount - 1
      ? HQ_MAX_FREQUENCY
      : HQ_MIN_FREQUENCY * Math.exp(ascending * logStep);
    if (frequency <= sampleRate * 0.5) {
      if (firstValidIndex === cellCount) firstValidIndex = index;
      validCellCount += 1;
    }
  }
  return {
    firstValidIndex: validCellCount === 0 ? 0 : firstValidIndex,
    validCellCount
  };
}

function hqPacket({
  frameType,
  tapId,
  sampleRate = 48_000,
  points = 10,
  cellCount = frameType === 4 ? 2048 : 256,
  minFrequency = HQ_MIN_FREQUENCY,
  maxFrequency = HQ_MAX_FREQUENCY,
  hop,
  firstValidIndex,
  validCellCount
}) {
  const range = validRange(frameType, cellCount, sampleRate);
  const nominalHop = frameType === 4
    ? Math.max((1 << points) / 2, Math.ceil(sampleRate / 30))
    : (1 << points) / 2;
  const payloadBytes = 48 + cellCount * (frameType === 4 ? 8 : 1);
  const bytes = (16 + payloadBytes + 3) & ~3;
  const packet = new Uint8Array(bytes);
  const view = new DataView(packet.buffer);
  view.setUint16(0, frameType, true);
  view.setUint16(2, 2, true);
  view.setUint32(4, tapId, true);
  view.setUint32(8, 17, true);
  view.setUint16(12, payloadBytes, true);
  view.setFloat32(16, sampleRate, true);
  view.setUint16(20, points, true);
  view.setUint16(22, 0, true);
  view.setUint32(24, hop ?? nominalHop, true);
  view.setUint32(28, 3, true);
  view.setBigUint64(32, 0x20_0000_0001n, true);
  view.setUint32(40, 42, true);
  view.setUint32(44, cellCount, true);
  view.setFloat32(48, minFrequency, true);
  view.setFloat32(52, maxFrequency, true);
  view.setUint32(56, firstValidIndex ?? range.firstValidIndex, true);
  view.setUint32(60, validCellCount ?? range.validCellCount, true);
  return { packet, view, bytes, nominalHop, ...range };
}

function pitchPacket(midi) {
  const packet = new Uint8Array(60);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 26, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 9, true);
  view.setUint16(12, 44, true);
  view.setFloat32(16, 48_000, true);
  view.setFloat32(20, 1, true);
  view.setFloat32(24, 0.01, true);
  view.setUint32(28, 99, true);
  view.setUint32(32, 3, true);
  view.setFloat32(36, 440, true);
  view.setFloat32(40, midi, true);
  view.setFloat32(44, 10, true);
  view.setFloat32(48, 0.9, true);
  view.setFloat32(52, -12, true);
  view.setUint16(56, 1, true);
  return packet;
}

test('pitch telemetry preserves fractional estimates within the endpoint half-rows', () => {
  const nodes = new Map([[9, {
    effectType: 'PitchMeter', effectId: 'pitch', effectIndex: 0
  }]]);
  for (const midi of [20.9, 108.1]) {
    const packet = pitchPacket(midi);
    const result = decodeTelemetryPacket(packet, packet.byteLength, nodes, 0);
    assert.equal(result.frames.length, 1);
    assert.equal(result.frames[0].midi, Math.fround(midi));
  }
  for (const midi of [20.49, 108.51]) {
    const packet = pitchPacket(midi);
    assert.deepEqual(
      decodeTelemetryPacket(packet, packet.byteLength, nodes, 0).frames,
      []
    );
  }
});

function rhythmPacket({ locked = true, events = 1, patch = null, version = 1 } = {}) {
  const payloadBytes = version === 4 ? 1496 : 1344;
  const packet = new Uint8Array(16 + payloadBytes);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 28, true);
  view.setUint16(2, version, true);
  view.setUint32(4, 13, true);
  view.setUint16(12, payloadBytes, true);
  const payload = new DataView(packet.buffer, 16);
  payload.setFloat32(0, 48_000, true);
  payload.setUint32(4, 2, true);
  payload.setUint32(8, 256, true);
  payload.setUint32(12, 500, true);
  payload.setFloat32(16, 3.5, true);
  payload.setFloat32(20, 0.032, true);
  payload.setUint32(24, 1, true);
  payload.setUint32(28, events, true);
  if (locked) {
    payload.setUint32(32, 1, true);
    payload.setUint32(36, 3, true);
    payload.setFloat32(40, version >= 3 ? .5 : 2.5, true);
    payload.setFloat32(44, 0.5, true);
    payload.setUint32(48, 510, true);
    payload.setFloat32(52, 0.25, true);
    payload.setUint32(56, 7, true);
  }
  payload.setFloat32(60, 120, true);
  payload.setFloat32(64 + 4 * 91, 1, true);
  payload.setFloat32(64 + 4 * 43, 0.5, true);
  for (let index = 0; index < events; index++) {
    const offset = 832 + index * 32;
    payload.setUint32(offset, 480 + index, true);
    payload.setFloat32(offset + 4, 0.75, true);
    payload.setUint32(offset + 8, locked ? 3 : 0, true);
    payload.setInt32(offset + 12, locked ? -1 : 0, true);
    payload.setFloat32(offset + 16, locked ? 0.875 : 0, true);
    payload.setFloat32(offset + 20, locked ? 0.5 : 0, true);
    payload.setFloat32(offset + 24, 0.8, true);
    payload.setUint8(offset + 28, 2);
    payload.setUint8(offset + 29, locked ? 0 : 1);
  }
  patch?.(payload);
  return packet;
}

test('rhythm analyzer v4 transports provisional onsets and a replaceable best path with a closed tick gate', () => {
  const nodes = new Map([[13, { effectType: 'RhythmAnalyzer' }]]);
  const packet = rhythmPacket({ version: 4, patch: payload => {
    payload.setUint32(32, 0, true);
    payload.setUint8(861, 3);
    payload.setUint32(1344, 2, true);
    payload.setFloat32(1348, .5, true);
    payload.setInt32(1352, 480, true);
    payload.setFloat32(1356, .25, true);
    payload.setInt32(1360, 6, true);
    payload.setInt32(1364, 574, true);
    payload.setFloat32(1368, .25, true);
    payload.setInt32(1372, 7, true);
  } });
  const decode = bytes => decodeTelemetryPacket(bytes, bytes.byteLength, nodes, 0).frames;
  const [frame] = decode(packet);
  assert.equal(frame.locked, false);
  assert.equal(frame.events[0].flags, 3);
  assert.equal(frame.events[0].unlocked, false);
  assert.equal(frame.previewPeriodSeconds, .5);
  assert.deepEqual(frame.previewBeats, [{ frame: 480, fraction: .25, beatIndex: 6 },
    { frame: 574, fraction: .25, beatIndex: 7 }]);
  for (const patch of [payload => payload.setUint32(1344, 13, true),
    payload => payload.setFloat32(1348, 0, true), payload => payload.setInt32(1364, 479, true)]) {
    const invalid = packet.slice();
    patch(new DataView(invalid.buffer, 16));
    assert.deepEqual(decode(invalid), []);
  }
});

test('rhythm analyzer telemetry decodes tracker state, tempogram and onset events', () => {
  const nodes = new Map([[13, {
    effectType: 'RhythmAnalyzer', effectId: 'rhythm', effectIndex: 0
  }]]);
  const decode = packet => decodeTelemetryPacket(packet, packet.byteLength, nodes, 0).frames;

  const [frame] = decode(rhythmPacket());
  assert.equal(frame.kind, 'rhythmAnalyzer');
  assert.equal(frame.sampleRate, 48_000);
  assert.equal(frame.generation, 2);
  assert.equal(frame.envelopeHopSamples, 256);
  assert.equal(frame.envelopeFrameCount, 500);
  assert.equal(frame.timeSeconds, 3.5);
  assert.equal(frame.latencySeconds, Math.fround(0.032));
  assert.equal(frame.droppedEvents, 1);
  assert.equal(frame.locked, true);
  assert.equal(frame.lockEpoch, 3);
  assert.equal(frame.confidence, 2.5);
  assert.equal(frame.periodSeconds, 0.5);
  assert.equal(frame.nextBeatFrame, 510);
  assert.equal(frame.nextBeatFraction, 0.25);
  assert.equal(frame.nextBeatIndex, 7);
  assert.equal(frame.combBestBpm, 120);
  assert.equal(frame.tempogram.length, 192);
  assert.equal(frame.tempogram[91], 1);
  assert.equal(frame.tempogram[43], 0.5);
  assert.deepEqual(frame.events, [{
    frame: 480, fraction: 0.75, lockEpoch: 3, beatIndex: -1, beatFraction: 0.875,
    periodSeconds: 0.5, strength: Math.fround(0.8), band: 2, unlocked: false
  }]);

  const [unlocked] = decode(rhythmPacket({ locked: false, events: 16 }));
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.events.length, 16);
  assert.ok(unlocked.events.every(event => event.unlocked));

  for (const [name, patch] of [
    ['short payload', null],
    ['zero generation', payload => payload.setUint32(4, 0, true)],
    ['zero envelope hop', payload => payload.setUint32(8, 0, true)],
    ['17 events', payload => payload.setUint32(28, 17, true)],
    ['unknown tracker flag', payload => payload.setUint32(32, 3, true)],
    ['locked without period', payload => payload.setFloat32(44, 0, true)],
    ['tempogram above one', payload => payload.setFloat32(64, 1.5, true)],
    ['fraction of one', payload => payload.setFloat32(836, 1, true)],
    ['unknown band', payload => payload.setUint8(860, 3)],
    ['unknown event flag', payload => payload.setUint8(861, 2)],
    ['zero strength', payload => payload.setFloat32(856, 0, true)]
  ]) {
    const packet = rhythmPacket({ patch });
    if (!patch) new DataView(packet.buffer).setUint16(12, 1340, true);
    assert.deepEqual(decode(packet), [], name);
  }
  const unlockedWithPeriod = rhythmPacket({
    locked: false, patch: payload => payload.setFloat32(44, 0.5, true)
  });
  assert.deepEqual(decode(unlockedWithPeriod), []);
});

function tonalBalancePacket(patch = null) {
  const packet = new Uint8Array(16 + 1564);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 29, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 14, true);
  view.setUint16(12, 1564, true);
  const payload = new DataView(packet.buffer, 16);
  payload.setFloat32(0, 96_000, true);
  payload.setUint16(4, 41, true);
  payload.setUint16(6, 128, true);
  payload.setUint8(8, 0b1111);
  payload.setUint8(9, 2);
  payload.setFloat32(12, -18.5, true);
  payload.setFloat32(16, -1.25, true);
  payload.setUint32(20, 900, true);
  payload.setFloat32(24 + 4 * 10, 71.5, true);
  payload.setFloat32(188 + 4 * 10, 0.75, true);
  payload.setFloat32(352 + 4 * 10, 0.5, true);
  payload.setFloat32(516 + 4 * 10, -2.5, true);
  payload.setFloat32(680 + 4 * 10, 3.25, true);
  payload.setFloat32(844 + 4 * 10, 1.5, true);
  payload.setUint8(1008 + 10, 0b11101);
  payload.setFloat32(1052 + 4 * 127, -3.75, true);
  patch?.(payload);
  return packet;
}

test('tonal balance telemetry decodes band statistics, target and response', () => {
  const nodes = new Map([[14, {
    effectType: 'TonalBalanceEQ', effectId: 'tonal', effectIndex: 1
  }]]);
  const decode = packet => decodeTelemetryPacket(packet, packet.byteLength, nodes, 0).frames;

  const [frame] = decode(tonalBalancePacket());
  assert.equal(frame.kind, 'tonalBalance');
  assert.equal(frame.effectType, 'TonalBalanceEQ');
  assert.equal(frame.sampleRate, 96_000);
  assert.equal(frame.targetIndex, 2);
  assert.deepEqual(
    [frame.absoluteGate, frame.relativeGate, frame.loudnessValid, frame.targetValid],
    [true, true, true, true]
  );
  assert.equal(frame.loudnessLkfs, -18.5);
  assert.equal(frame.makeupDb, -1.25);
  assert.equal(frame.gatedHopCount, 900);
  for (const name of ['levelDb', 'persistence', 'presence', 'commandDb', 'targetMuDb',
    'targetSigmaDb', 'bandFlags']) {
    assert.equal(frame[name].length, 41, name);
  }
  assert.deepEqual(
    [frame.levelDb[10], frame.persistence[10], frame.presence[10], frame.commandDb[10],
      frame.targetMuDb[10], frame.targetSigmaDb[10], frame.bandFlags[10]],
    [71.5, 0.75, 0.5, -2.5, 3.25, 1.5, 0b11101]
  );
  assert.equal(frame.responseDb.length, 128);
  assert.equal(frame.responseDb[127], -3.75);

  for (const [name, patch] of [
    ['short payload', null],
    ['band count', payload => payload.setUint16(4, 40, true)],
    ['grid count', payload => payload.setUint16(6, 127, true)],
    ['unknown state flag', payload => payload.setUint8(8, 0b10000)],
    ['reserved header', payload => payload.setUint16(10, 1, true)],
    ['loudness without validity', payload => payload.setUint8(8, 0b1011)],
    ['non-finite level', payload => payload.setFloat32(24, Number.NaN, true)],
    ['presence above one', payload => payload.setFloat32(352, 1.5, true)],
    ['negative sigma', payload => payload.setFloat32(844, -1, true)],
    ['unknown band flag', payload => payload.setUint8(1008, 0b100000)],
    ['reserved band bytes', payload => payload.setUint8(1051, 1)],
    ['non-finite response', payload => payload.setFloat32(1052, Infinity, true)]
  ]) {
    const packet = tonalBalancePacket(patch);
    if (!patch) new DataView(packet.buffer).setUint16(12, 1560, true);
    assert.deepEqual(decode(packet), [], name);
  }
});

function analogMeterPacket({ mode, channels, flags = 0, program = null }) {
  const payloadBytes = 4 + channels.length * 8 + (program ? 24 : 0);
  const packet = new Uint8Array((16 + payloadBytes + 3) & ~3);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 27, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 11, true);
  view.setUint16(12, payloadBytes, true);
  view.setUint8(16, mode);
  view.setUint8(17, channels.length);
  view.setUint16(18, flags, true);
  const values = [...channels.flat(), ...(program ?? [])];
  values.forEach((value, index) => view.setFloat32(20 + index * 4, value, true));
  return { packet, view };
}

test('analog meter telemetry decodes needle and program loudness records', () => {
  const nodes = new Map([[11, {
    effectType: 'AnalogMeter', effectId: 'meter', effectIndex: 0
  }]]);
  const decode = packet => decodeTelemetryPacket(packet, packet.byteLength, nodes, 2).frames;

  const [peak] = decode(analogMeterPacket({ mode: 4, channels: [[-6, 0.5], [-240, -240]] }).packet);
  assert.equal(peak.kind, 'analogMeter');
  assert.equal(peak.mode, 4);
  assert.equal(peak.channelCount, 2);
  assert.equal(peak.integratedValid, false);
  assert.equal(peak.lraValid, false);
  assert.deepEqual(peak.channels, [{ needleDb: -6, maxDb: 0.5 }, { needleDb: -240, maxDb: -240 }]);
  assert.equal(peak.program, null);
  assert.equal(peak.dropped, 2);

  const [loudness] = decode(analogMeterPacket({
    mode: 5, channels: [[-23, -24]], flags: 3, program: [-23, -23.5, -23, 7, -1.5, 12]
  }).packet);
  assert.equal(loudness.integratedValid, true);
  assert.equal(loudness.lraValid, true);
  assert.deepEqual(loudness.program, {
    momentary: -23, shortTerm: -23.5, integrated: -23, lra: 7,
    maxTruePeak: -1.5, integratedSeconds: 12
  });
  const [pending] = decode(analogMeterPacket({
    mode: 5, channels: [[-23, -24]], program: [-23, -23.5, 0, 0, -1.5, 0.3]
  }).packet);
  assert.equal(pending.integratedValid, false);
  assert.equal(pending.program.integrated, 0);

  for (const [name, fields] of [
    ['unknown mode', { mode: 6, channels: [[-6, -6]] }],
    ['no channels', { mode: 0, channels: [] }],
    ['17 channels', { mode: 0, channels: Array(17).fill([-6, -6]) }],
    ['loudness flags outside Loudness', { mode: 0, channels: [[-6, -6]], flags: 1 }],
    ['unknown flag', { mode: 5, channels: [[-6, -6]], flags: 4, program: [-23, -23, 0, 0, -1, 0] }],
    ['missing program', { mode: 5, channels: [[-6, -6]] }],
    ['program outside Loudness', { mode: 0, channels: [[-6, -6]], program: [-23, -23, 0, 0, -1, 0] }],
    ['below floor', { mode: 0, channels: [[-241, -6]] }],
    ['non-finite', { mode: 0, channels: [[Number.NaN, -6]] }],
    ['invalid integrated not zero', { mode: 5, channels: [[-6, -6]], program: [-23, -23, -23, 0, -1, 0] }],
    ['negative LRA', { mode: 5, channels: [[-6, -6]], flags: 2, program: [-23, -23, 0, -1, -1, 0] }],
    ['negative duration', { mode: 5, channels: [[-6, -6]], program: [-23, -23, 0, 0, -1, -1] }]
  ]) {
    assert.deepEqual(decode(analogMeterPacket(fields).packet), [], name);
  }
});

test('HQ spectrum telemetry accepts the canonical v2 contract and owns its dB arrays', () => {
  const { packet, view, bytes } = hqPacket({ frameType: 4, tapId: 7 });
  for (let cell = 0; cell < 2048; cell++) {
    view.setFloat32(64 + cell * 4, -10 - cell / 2048, true);
    view.setFloat32(64 + (2048 + cell) * 4, -5 - cell / 2048, true);
  }
  const nodes = new Map([[7, {
    effectType: 'SpectrumAnalyzer', effectId: 'spectrum', effectIndex: 2
  }]]);
  const result = decodeTelemetryPacket(packet, bytes, nodes, 5);
  assert.equal(result.pendingDropped, 0);
  assert.equal(result.frames.length, 1);
  const frame = result.frames[0];
  assert.equal(frame.kind, 'spectrumHq');
  assert.equal(frame.captureEnd, 0x20_0000_0001n);
  assert.equal(frame.hop, 1600);
  assert.equal(frame.generation, 3);
  assert.equal(frame.frameIndex, 42);
  assert.equal(frame.cellCount, 2048);
  assert.equal(frame.minFrequency, HQ_MIN_FREQUENCY);
  assert.equal(frame.maxFrequency, HQ_MAX_FREQUENCY);
  assert.equal(frame.firstValidIndex, 0);
  assert.equal(frame.validCellCount, 1910);
  assert.equal(frame.currentDb.length, 2048);
  assert.equal(frame.peakDb.length, 2048);
  assert.equal(frame.currentDb[0], -10);
  assert.equal(frame.peakDb[0], -5);
  view.setFloat32(64, 99, true);
  assert.equal(frame.currentDb[0], -10);
});

test('Chroma Spiral accepts only HQ spectrum telemetry', () => {
  const { packet, view, bytes } = hqPacket({ frameType: 4, tapId: 7 });
  const nodes = new Map([[7, {
    effectType: 'ChromaSpiral', effectId: 'chroma', effectIndex: 0
  }]]);
  assert.equal(decodeTelemetryPacket(packet, bytes, nodes, 0).frames[0].kind, 'spectrumHq');
  view.setUint16(2, 1, true);
  assert.deepEqual(decodeTelemetryPacket(packet, bytes, nodes, 0).frames, []);
});

test('HQ spectrogram telemetry accepts the canonical descending v2 grid', () => {
  const valid = hqPacket({ frameType: 5, tapId: 8 });
  for (let cell = 0; cell < 256; cell++) valid.packet[64 + cell] = cell;
  const nodes = new Map([[8, {
    effectType: 'Spectrogram', effectId: 'spectrogram', effectIndex: 0
  }]]);
  const decoded = decodeTelemetryPacket(valid.packet, valid.bytes, nodes, 0).frames[0];
  assert.equal(decoded.kind, 'spectrogramHq');
  assert.equal(decoded.hop, 512);
  assert.equal(decoded.cellCount, 256);
  assert.equal(decoded.firstValidIndex, 18);
  assert.equal(decoded.validCellCount, 238);
  assert.equal(decoded.intensities[0], 0);
  assert.equal(decoded.intensities[255], 255);
});

test('HQ telemetry rejects metadata outside each analyzer v2 contract', () => {
  const cases = [
    { frameType: 4, tapId: 7, effectType: 'SpectrumAnalyzer', cellCount: 2048 },
    { frameType: 5, tapId: 8, effectType: 'Spectrogram', cellCount: 256 }
  ];
  for (const fixtureCase of cases) {
    const canonical = hqPacket(fixtureCase);
    const mutations = [
      ['cell count', () => hqPacket({ ...fixtureCase, cellCount: fixtureCase.cellCount - 1 })],
      ['minimum frequency', () => hqPacket({ ...fixtureCase, minFrequency: 21 })],
      ['maximum frequency', () => hqPacket({ ...fixtureCase, maxFrequency: 39_999 })],
      ['nominal hop', () => hqPacket({ ...fixtureCase, hop: canonical.nominalHop + 1 })],
      ['first valid index', () => hqPacket({
        ...fixtureCase, firstValidIndex: canonical.firstValidIndex + 1
      })],
      ['valid cell count', () => hqPacket({
        ...fixtureCase, validCellCount: canonical.validCellCount - 1
      })]
    ];
    const nodes = new Map([[fixtureCase.tapId, {
      effectType: fixtureCase.effectType, effectId: null, effectIndex: 0
    }]]);
    for (const [name, makeInvalid] of mutations) {
      const invalid = makeInvalid();
      const result = decodeTelemetryPacket(invalid.packet, invalid.bytes, nodes, 4);
      assert.deepEqual(result.frames, [], `${fixtureCase.effectType}: ${name}`);
      assert.equal(result.pendingDropped, 4, `${fixtureCase.effectType}: ${name}`);
    }
  }
});

test('legacy spectrum and spectrogram v1 telemetry remains accepted', () => {
  const spectrumPoints = 8;
  const spectrumBins = (1 << (spectrumPoints - 1)) + 1;
  const spectrumPayloadBytes = 12 + spectrumBins * 8;
  const spectrum = new Uint8Array((16 + spectrumPayloadBytes + 3) & ~3);
  const spectrumView = new DataView(spectrum.buffer);
  spectrumView.setUint16(0, 4, true);
  spectrumView.setUint16(2, 1, true);
  spectrumView.setUint32(4, 7, true);
  spectrumView.setUint16(12, spectrumPayloadBytes, true);
  spectrumView.setFloat32(16, 48_000, true);
  spectrumView.setUint32(20, spectrumBins, true);
  spectrumView.setUint16(24, spectrumPoints, true);

  const spectrogram = new Uint8Array(16 + 268);
  const spectrogramView = new DataView(spectrogram.buffer);
  spectrogramView.setUint16(0, 5, true);
  spectrogramView.setUint16(2, 1, true);
  spectrogramView.setUint32(4, 8, true);
  spectrogramView.setUint16(12, 268, true);
  spectrogramView.setFloat32(16, 48_000, true);
  spectrogramView.setFloat32(20, 1, true);
  spectrogramView.setUint16(24, 256, true);
  spectrogramView.setUint16(26, 10, true);

  for (const fixture of [
    { packet: spectrum, tapId: 7, effectType: 'SpectrumAnalyzer', kind: 'spectrum' },
    { packet: spectrogram, tapId: 8, effectType: 'Spectrogram', kind: 'spectrogram' }
  ]) {
    const nodes = new Map([[fixture.tapId, {
      effectType: fixture.effectType, effectId: null, effectIndex: 0
    }]]);
    const result = decodeTelemetryPacket(
      fixture.packet, fixture.packet.byteLength, nodes, 3
    );
    assert.equal(result.frames.length, 1);
    assert.equal(result.frames[0].kind, fixture.kind);
    assert.equal(result.frames[0].dropped, 3);
    assert.equal(result.pendingDropped, 0);
  }
});
