import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DSP_PARAM_LAYOUTS,
  PhaseSelectEqPlugin_PARAMS_HASH,
  packPhaseSelectEqPluginParams
} from '../../js/audio/dsp-params.generated.js';
import { SHIPPED_ENABLED_TYPES } from '../../js/audio/dsp-rollout.js';
import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const repeat = (value, count = 5) => Array.from({ length: count }, () => value);

test('Phase Select EQ has a fixed field-major 5-band DSP ABI', () => {
  assert.equal(PhaseSelectEqPlugin_PARAMS_HASH, 0x51c6d77a);
  assert.deepEqual(DSP_PARAM_LAYOUTS.PhaseSelectEqPlugin, {
    hash: 0x51c6d77a,
    floatCount: 75
  });
  assert.deepEqual(Array.from(packPhaseSelectEqPluginParams()), [
    1, 0, 0, 0, 0,
    ...repeat(80),
    ...repeat(100),
    ...repeat(10000),
    ...repeat(12000),
    ...repeat(0),
    ...repeat(0),
    ...repeat(30),
    ...repeat(45),
    ...repeat(100),
    0, 0, 0, 0, 0,
    ...repeat(-100),
    ...repeat(-100),
    ...repeat(100),
    ...repeat(100)
  ]);
});

test('Phase Select EQ packs object regions and clamps each public DSP field', () => {
  const packed = packPhaseSelectEqPluginParams({
    regions: [
      {
        en: false,
        ofl: -1,
        fl: 41.5,
        fh: 50000,
        ofh: 39999,
        opl: -5,
        pl: 42.25,
        ph: 181,
        oph: 179.5,
        gn: 250,
        obl: -125,
        bl: -45.5,
        bh: 125,
        obh: 95.5
      },
      {
        en: 1,
        ofl: 40001,
        fl: 20,
        fh: 20,
        ofh: Number.NaN,
        opl: 180,
        pl: 0,
        ph: 0,
        oph: Number.POSITIVE_INFINITY,
        gn: -25,
        so: 1,
        obl: 125,
        bl: -125,
        bh: Number.NaN,
        obh: Number.NEGATIVE_INFINITY
      }
    ]
  });

  assert.equal(packed.length, 75);
  assert.deepEqual(Array.from(packed.slice(0, 2)), [0, 1]);
  assert.deepEqual(Array.from(packed.slice(5, 7)), [20, 40000]);
  assert.deepEqual(Array.from(packed.slice(10, 12)), [41.5, 20]);
  assert.deepEqual(Array.from(packed.slice(15, 17)), [40000, 20]);
  assert.deepEqual(Array.from(packed.slice(20, 22)), [39999, 12000]);
  assert.deepEqual(Array.from(packed.slice(25, 27)), [0, 180]);
  assert.deepEqual(Array.from(packed.slice(30, 32)), [42.25, 0]);
  assert.deepEqual(Array.from(packed.slice(35, 37)), [180, 0]);
  assert.deepEqual(Array.from(packed.slice(40, 42)), [179.5, 45]);
  assert.deepEqual(Array.from(packed.slice(45, 47)), [200, 0]);
  assert.deepEqual(Array.from(packed.slice(50, 52)), [0, 1]);
  assert.deepEqual(Array.from(packed.slice(55, 57)), [-100, 100]);
  assert.deepEqual(Array.from(packed.slice(60, 62)), [-45.5, -100]);
  assert.deepEqual(Array.from(packed.slice(65, 67)), [100, 100]);
  assert.deepEqual(Array.from(packed.slice(70, 72)), [95.5, 100]);
});

test('Phase Select EQ accepts indexed compact keys when no regions array is present', () => {
  const packed = packPhaseSelectEqPluginParams({
    en0: false,
    en4: true,
    ofl4: 123,
    fl4: 456,
    fh4: 789,
    ofh4: 1234,
    opl4: 12,
    pl4: 34,
    ph4: 56,
    oph4: 78,
    gn4: 175,
    so4: true,
    obl4: -90,
    bl4: -50,
    bh4: 60,
    obh4: 90
  });

  assert.equal(packed[0], 0);
  assert.equal(packed[4], 1);
  assert.equal(packed[9], 123);
  assert.equal(packed[14], 456);
  assert.equal(packed[19], 789);
  assert.equal(packed[24], 1234);
  assert.equal(packed[29], 12);
  assert.equal(packed[34], 34);
  assert.equal(packed[39], 56);
  assert.equal(packed[44], 78);
  assert.equal(packed[49], 175);
  assert.equal(packed[54], 1);
  assert.equal(packed[59], -90);
  assert.equal(packed[64], -50);
  assert.equal(packed[69], 60);
  assert.equal(packed[74], 90);
});

test('Phase Select EQ is shipped in Spatial order with telemetry type 20', () => {
  const balanceIndex = SHIPPED_ENABLED_TYPES.indexOf('MultibandBalancePlugin');
  assert.notEqual(balanceIndex, -1);
  assert.deepEqual(SHIPPED_ENABLED_TYPES.slice(balanceIndex, balanceIndex + 3), [
    'MultibandBalancePlugin',
    'PhaseSelectEqPlugin',
    'StereoBlendPlugin'
  ]);
  assert.equal(TelemetryFrameType.TAP_PHASE_SELECT_MAP, 20);
});
