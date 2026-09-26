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
