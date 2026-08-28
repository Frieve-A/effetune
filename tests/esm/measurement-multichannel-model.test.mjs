import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maxRequiredChannelCount,
  nextRotationChannel,
  normalizeOutputChannelSelection,
  peqChannelTokenFor,
  resolveCheckboxToggle,
  selectionFromConfig
} from '../../features/measurement/audio-utils/channel-selection.js';
import {
  aggregateLevelWarnings,
  collectCalibrationIrCandidates,
  collectPointIrKeyIds,
  collectStoredIrKeyIds,
  mergeChannelRedoResult,
  recalculateAverages,
  resolveDisplayedChannelCurves,
  resolveDisplayedResponse,
  resolveCalibrationIrCandidate,
  resolveIrRecordKey,
  resolveIrRecordTarget,
  resolveSweepBand,
  resolveOutputSweepBands,
  resolveResponseSweepBand,
  visibleChannelCurves
} from '../../features/measurement/measurement-model.js';

test('sweep bands preserve channel settings, clamp actual sample rate and resolve all outputs', () => {
  const config = { sweepBand: {
    mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
    perChannel: [
      { channel: 'left', minFreq: 30, maxFreq: 400 },
      { channel: '2', minFreq: 2000, maxFreq: 18000 }
    ]
  } };
  const original = structuredClone(config);
  assert.deepEqual(resolveSweepBand(config, 'left', 32000, 65536),
    { minFreq: 30, maxFreq: 400, bandLimited: true });
  assert.deepEqual(resolveSweepBand(config, '2', 32000, 65536),
    { minFreq: 2000, maxFreq: 15999, bandLimited: true });
  assert.deepEqual(resolveSweepBand(config, 'right', 32000, 65536),
    { minFreq: 20, maxFreq: 15999, bandLimited: true });
  assert.deepEqual(resolveSweepBand(config, 'all', 32000, 65536),
    { minFreq: 20, maxFreq: 15999, bandLimited: true });
  assert.equal(resolveOutputSweepBands(config, 32000, 65536).length, 8);
  assert.deepEqual(config, original);
  config.sweepBand.mode = 'common';
  assert.equal(resolveSweepBand(config, 'left', 48000, 1024).maxFreq, 20000);
  config.sweepBand.mode = 'off';
  assert.deepEqual(resolveSweepBand(config, 'left', 48000, 1024),
    { minFreq: 46.875, maxFreq: 23953.125, bandLimited: false });
});

test('per-channel averages align measured frequencies instead of combining different bands by index', () => {
  const measurement = {
    outputChannels: ['left', '2'],
    points: [{ channels: [
      { channel: 'left', frequencyResponse: [[100, 0], [400, 4]] },
      { channel: '2', frequencyResponse: [[200, 10], [400, 10], [800, 10]] }
    ] }]
  };
  recalculateAverages(measurement);
  assert.deepEqual(measurement.averageFrequencyResponse,
    [[100, 0], [200, 6], [400, 7], [800, 10]]);
  assert.deepEqual(resolveDisplayedResponse(measurement, 0, 'all').frequencyResponse,
    measurement.averageFrequencyResponse);
});

test('result sweep bands use only measured channels for the average and preserve single-channel limits', () => {
  const measurement = {
    outputChannel: 'multi', outputChannels: ['left', '2'], outputChannelCount: 4,
    sampleRate: 32000, sweepLength: 65536,
    sweepBand: {
      mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
      perChannel: [
        { channel: 'left', minFreq: 40, maxFreq: 400 },
        { channel: '2', minFreq: 1500, maxFreq: 1800 }
      ]
    }
  };
  assert.deepEqual(resolveResponseSweepBand(measurement),
    { minFreq: 40, maxFreq: 1800, bandLimited: true });
  assert.deepEqual(resolveResponseSweepBand(measurement, '2'),
    { minFreq: 1500, maxFreq: 1800, bandLimited: true });
  assert.deepEqual(resolveResponseSweepBand({ ...measurement, outputChannel: '2', outputChannels: ['2'] }),
    { minFreq: 1500, maxFreq: 1800, bandLimited: true });
  assert.deepEqual(resolveResponseSweepBand({ ...measurement, outputChannel: 'all', outputChannels: ['all'] }),
    { minFreq: 20, maxFreq: 15999, bandLimited: true });
  assert.deepEqual(resolveResponseSweepBand({ sampleRate: 48000, sweepMinFreq: 80, sweepMaxFreq: 800 }),
    { minFreq: 80, maxFreq: 800, bandLimited: true });
  assert.deepEqual(resolveResponseSweepBand({ ...measurement, sweepLength: 1024, sweepBand: { mode: 'off' } }),
    { minFreq: 31.25, maxFreq: 15968.75, bandLimited: false });
});

test('simultaneous stereo sweep bounds ignore settings for disconnected output channels', () => {
  const config = { outputChannelCount: 2, sweepBand: {
    mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 }, perChannel: [
      { channel: 'left', minFreq: 40, maxFreq: 200 },
      { channel: 'right', minFreq: 200, maxFreq: 400 }
    ]
  } };
  assert.deepEqual(resolveSweepBand(config, 'all', 48000, 131072),
    { minFreq: 40, maxFreq: 400, bandLimited: true });
  assert.deepEqual(resolveOutputSweepBands(config, 48000, 131072).map(band => band.channel),
    ['left', 'right']);
});

test('output selections normalize legacy, mixed, empty, and checkbox states', () => {
  assert.deepEqual(normalizeOutputChannelSelection('both'), ['all']);
  assert.deepEqual(normalizeOutputChannelSelection(['all', '4', 'left', '2']), ['left', '2', '4']);
  assert.deepEqual(normalizeOutputChannelSelection([]), ['all']);
  assert.throws(() => normalizeOutputChannelSelection('multi'));
  assert.deepEqual(selectionFromConfig({ outputChannel: 'multi', outputChannels: ['4', 'left'] }), ['left', '4']);
  assert.deepEqual(resolveCheckboxToggle(['left', '2'], 'all', true), ['all']);
  assert.deepEqual(resolveCheckboxToggle(['all'], 'right', true), ['right']);
  assert.deepEqual(resolveCheckboxToggle(['right'], 'right', false), ['all']);
  assert.deepEqual(resolveCheckboxToggle(['4'], 'left', true), ['left', '4']);
});

test('channel routing helpers preserve canonical order and mappings', () => {
  assert.equal(maxRequiredChannelCount(['left', 'right']), 2);
  assert.equal(maxRequiredChannelCount(['left', '2']), 4);
  assert.equal(maxRequiredChannelCount(['4', '7']), 8);
  assert.equal(nextRotationChannel(['left', '2', '4'], '2'), '4');
  assert.equal(nextRotationChannel(['left', '2', '4'], '4'), 'left');
  assert.equal(nextRotationChannel(['left', '2'], '7'), 'left');
  assert.deepEqual(['left', 'right', '2', '3', '4', '5', '6', '7'].map(peqChannelTokenFor),
    ['L', 'R', '3', '4', '5', '6', '7', '8']);
  assert.throws(() => peqChannelTokenFor('all'));
});

function multichannelMeasurement() {
  return {
    outputChannel: 'multi',
    outputChannels: ['left', '2'],
    points: [
      {
        pointId: 0,
        name: 'Front',
        channels: [
          { channel: 'left', frequencyResponse: [[100, 1], [1000, 3]], maxSignalLevel: -40,
            irId: 1, ir: { stored: true } },
          { channel: '2', frequencyResponse: [[100, 5], [1000, 7]], maxSignalLevel: -0.5,
            irId: 2, ir: { stored: true } }
        ]
      },
      {
        pointId: 3,
        channels: [
          { channel: 'left', frequencyResponse: [[100, 3], [1000, 5]], maxSignalLevel: -20 },
          { channel: '2', frequencyResponse: [[100, 7], [1000, 9]], maxSignalLevel: -10 }
        ]
      }
    ]
  };
}

test('averages and displayed responses preserve point and channel axes', () => {
  const measurement = multichannelMeasurement();
  recalculateAverages(measurement);
  assert.deepEqual(measurement.channelResponses, [
    { channel: 'left', averageFrequencyResponse: [[100, 2], [1000, 4]], maxSignalLevel: -30 },
    { channel: '2', averageFrequencyResponse: [[100, 6], [1000, 8]], maxSignalLevel: -5.25 }
  ]);
  assert.deepEqual(measurement.averageFrequencyResponse, [[100, 4], [1000, 6]]);
  assert.deepEqual(resolveDisplayedResponse(measurement, 'all', '2'), {
    frequencyResponse: [[100, 6], [1000, 8]], maxSignalLevel: -5.25
  });
  assert.deepEqual(resolveDisplayedResponse(measurement, 0, 'all'), {
    frequencyResponse: [[100, 3], [1000, 5]], maxSignalLevel: -20.25
  });
  const curves = resolveDisplayedChannelCurves(measurement, 0);
  assert.deepEqual(curves.map(curve => curve.channel), ['left', '2']);
  assert.deepEqual(visibleChannelCurves(curves, '2').map(curve => curve.channel), ['2']);
  assert.deepEqual(aggregateLevelWarnings(curves), { low: ['left'], high: ['2'] });
});

test('IR key helpers distinguish stored export keys from deletion keys and round trip targets', () => {
  const measurement = multichannelMeasurement();
  measurement.points[0].channels[1].ir.stored = false;
  assert.deepEqual(collectStoredIrKeyIds(measurement.points[0]), [1]);
  assert.deepEqual(collectPointIrKeyIds(measurement.points[0]), [1, 2]);
  assert.deepEqual(resolveIrRecordKey(measurement, 'all', 'left'), {
    pointIndex: 0, channel: 'left', irKey: 1
  });
  assert.deepEqual(resolveIrRecordTarget(measurement, 1), { pointIndex: 0, channel: 'left' });
  assert.equal(resolveIrRecordTarget(measurement, 99), null);
});

test('calibration IR helpers preserve logical points while resolving channel IR keys', () => {
  const measurement = multichannelMeasurement();
  assert.deepEqual(collectCalibrationIrCandidates(measurement), [
    { pointIndex: 0, pointId: 0, channel: 'left', irKey: 1 },
    { pointIndex: 0, pointId: 0, channel: '2', irKey: 2 }
  ]);
  assert.deepEqual(resolveCalibrationIrCandidate(measurement, 0, '2'), {
    pointIndex: 0, pointId: 0, channel: '2', irKey: 2
  });
  assert.equal(resolveCalibrationIrCandidate(measurement, 0), null);
});

test('channel redo replaces only the selected channel and keeps IR IDs stable', () => {
  const measurement = multichannelMeasurement();
  const oldPoint = measurement.points[0];
  let allocations = 0;
  const result = mergeChannelRedoResult(oldPoint, [{ pointId: 1 }, { pointId: 2 }], 'left', {
    frequencyResponse: [[100, 9]],
    maxSignalLevel: -12,
    irValid: true,
    impulseResponse: new Float32Array([1, 0]),
    sampleRate: 48000,
    onsetIndex: 0
  }, () => { allocations += 1; return 99; });
  assert.equal(allocations, 0);
  assert.equal(result.point.channels[0].irId, 1);
  assert.equal(result.point.channels[1], oldPoint.channels[1]);
  assert.deepEqual(result.records.map(record => record.pointId).sort(), [1, 2]);
});

test('flat averages use defensive point-count semantics', () => {
  const measurement = { points: [
    { frequencyResponse: [[100, 1], [1000, 3]], maxSignalLevel: -10 },
    { frequencyResponse: [], maxSignalLevel: undefined },
    { frequencyResponse: [[100, 5], [1000, 7]], maxSignalLevel: -20 }
  ] };
  recalculateAverages(measurement);
  assert.deepEqual(measurement.averageFrequencyResponse, [[100, 3], [1000, 5]]);
  assert.equal(measurement.maxSignalLevel, -15);
  recalculateAverages({ points: [] });
});
