import { materializeAcceptanceAsset } from '../helpers/sfz-native-acceptance.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';

async function instrument(text, frames = 480, sample = new Float32Array(frames).fill(0.25)) {
  const parsed = await parseSfz({ selectedPath: 'test.sfz', readText: async () => text, onDiagnostic: null });
  return packSfzAsset(parsed.regions, new Map([['tone.wav', {
    sampleRate: 48000, channels: [sample]
  }]]));
}

async function openPlayer(variant, definition, mc = 0, sample = undefined) {
  const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
  const module = await WebAssembly.compile(fs.readFileSync(new URL(`../../plugins/dsp/${filename}`, import.meta.url)));
  const control = await instantiateDspBinding(module);
  const binding = await instantiateDspBinding(module);
  binding.createEngine();
  assert.equal(binding.prepare(48000, 2, 128, 262144), 0);
  const id = binding.createInstance('SoundFontPlayerPlugin');
  const packer = DSP_PARAM_PACKERS.get('SoundFontPlayerPlugin');
  const asset = await instrument(definition, sample?.length, sample);
  assert.equal(binding.instanceSetParams(id, packer.pack({ mc, pl: 64, og: 0 }), packer.hash), 0);
  const preparedAsset = await materializeAcceptanceAsset(control, asset, { playerKind: 'SoundFontPlayerPlugin' });
  assert.equal(binding.instanceSetAsset(id, 0, preparedAsset.payload,
    { ...preparedAsset, frames: preparedAsset.samples, topology: 0 }), 0);
  const result = {
    events(events, flags = 0) { assert.equal(binding.instanceSetMidiEvents(id, events, 1, flags), 0); },
    channel(channel) { result.parameters({ mc: channel }); },
    parameters(values) {
      assert.equal(binding.instanceSetParams(id, packer.pack({ mc, pl: 64, og: 0, ...values }), packer.hash), 0);
    },
    render() {
      const { combined, offsets } = binding.getArenaViews();
      combined.fill(0);
      assert.equal(binding.instanceProcess(id, offsets.combined, 2, 128, 0), 0);
      return combined.slice(0, 256);
    },
    close() { binding.destroyInstance(id); binding.destroyEngine(); control.destroyEngine(); }
  };
  result.render();
  result.events([], 1);
  return result;
}

for (const variant of ['baseline', 'simd']) {
  test(`SFZ ${variant} changing MIDI channel retires old voices and restores only the new channel`, async () => {
    const player = await openPlayer(variant, '<region> sample=tone.wav key=60 loop_mode=loop_continuous', 1);
    const event = (status, noteId = 0) => ({ offsetFrames: 0, status, data1: 60, data2: 127, noteId });
    try {
      player.events([event(0x90, 1)]);
      player.render();
      assert.ok(player.render().some(sample => sample > 0.1));
      player.channel(2);
      player.events([event(0x80)]);
      for (let block = 0; block < 16; block++) player.render();
      assert.ok(player.render().every(sample => Math.abs(sample) < 1e-7),
        'the old channel cannot leave a voice stuck after its note-off is filtered');

      player.events([], 1);
      player.events([event(0x90, 1), event(0x91, 2)], 2);
      player.events([], 4);
      player.render();
      assert.ok(player.render().some(sample => sample > 0.1), 'the newly selected held note is restored');
      player.events([event(0x81)]);
      for (let block = 0; block < 16; block++) player.render();
      assert.ok(player.render().every(sample => Math.abs(sample) < 1e-7),
        'only one newly selected identity was restored and its note-off releases it');
    } finally { player.close(); }
  });

  test(`SFZ ${variant} tuning offsets follow the untransposed key`, async () => {
    // A 64-frame-period sine plays 750 Hz at key 60.
    const sine = Float32Array.from({ length: 4096 }, (_, frame) => 0.25 * Math.sin(2 * Math.PI * frame / 64));
    const player = await openPlayer(variant, '<region> sample=tone.wav lokey=48 hikey=96 pitch_keycenter=60 ' +
      'loop_mode=loop_continuous loop_start=0 loop_end=4095 amp_veltrack=0', 0, sine);
    const frequency = (parameters, key) => {
      player.parameters(parameters);
      player.events([{ offsetFrames: 0, status: 0x90, data1: key, data2: 100, noteId: key }]);
      const left = new Float32Array(80 * 128);
      for (let block = 0; block < 80; block++) left.set(player.render().subarray(0, 128), block * 128);
      player.events([{ offsetFrames: 0, status: 0x80, data1: key, data2: 0, noteId: key }]);
      for (let block = 0; block < 16; block++) player.render();
      let first = -1, last = -1, count = 0;
      for (let i = 1024; i < left.length; i++) {
        if (left[i - 1] <= 0 && left[i] > 0) {
          const t = i - 1 + left[i - 1] / (left[i - 1] - left[i]);
          if (first < 0) first = t;
          last = t;
          count++;
        }
      }
      return (count - 1) * 48000 / (last - first);
    };
    const cents = (parameters, key) => 1200 * Math.log2(frequency(parameters, key) / frequency({ ...parameters, tu: 0, tk: 0 }, key));
    try {
      // Zero-crossing timing over 0.19 s resolves far below 0.001 cent; table values are rounded to 0.001 cent.
      const tolerance = 0.01;
      assert.ok(Math.abs(cents({ tu: 1, tk: 7 }, 71) + 13.686) < tolerance, 'Just G major lowers B');
      assert.ok(Math.abs(cents({ tu: 2, tk: 12 }, 61) - 17.108) < tolerance, 'Meantone C minor raises Db');
      assert.ok(Math.abs(cents({ tu: 1, tk: 0, tr: 5 }, 64) + 13.686) < tolerance, 'Transpose keeps the logical-key offset');
    } finally { player.close(); }
  });

  test(`SFZ ${variant} channel selection and held-history pool stay independent of ignored events and release sounds`, async () => {
    const message = (status, data1, data2, noteId = 0) => ({ offsetFrames: 0, status, data1, data2, noteId });
    const selected = await openPlayer(variant, '<group> seq_length=2 ' +
      '<region> sample=tone.wav key=60 seq_position=1 loop_mode=loop_continuous ' +
      '<region> sample=tone.wav key=60 seq_position=2 volume=-144 loop_mode=loop_continuous', 2);
    try {
      selected.events([message(0x90, 60, 127, 1), message(0x91, 60, 127, 2)], 2);
      selected.events([], 4);
      selected.render();
      assert.ok(selected.render().some(sample => sample > 0.1));
    } finally { selected.close(); }

    const history = [message(0x90, 60, 127, 1), message(0x90, 60, 127, 2),
      message(0xb0, 64, 127), message(0x80, 60, 0, 1)];
    for (let note = 0; note < 80; note++) history.push(message(0x90, 61, 127, note + 3), message(0x80, 61, 0));
    const held = await openPlayer(variant, '<region> sample=tone.wav key=60 loop_mode=loop_continuous ' +
      '<region> sample=tone.wav key=61 trigger=release_key loop_mode=one_shot');
    try {
      held.events(history, 2);
      held.events([], 4);
      held.render();
      assert.ok(held.render().some(sample => sample > 0.2), 'both overlapping key/pedal-held identities survive release history');
    } finally { held.close(); }

    const choked = await openPlayer(variant, '<region> sample=tone.wav key=60 off_by=7 loop_mode=loop_continuous ' +
      '<region> sample=tone.wav key=61 group=7 trigger=release_key loop_mode=one_shot');
    try {
      choked.events([message(0x90, 60, 127, 1), message(0x90, 61, 127, 2), message(0x80, 61, 0)], 2);
      choked.events([], 4);
      assert.ok(choked.render().every(sample => Math.abs(sample) < 1e-7), 'release-trigger choke history still removes a held voice');
    } finally { choked.close(); }

    for (const boundary of ['all-sound-off', 'reset']) {
      const cleared = await openPlayer(variant, '<region> sample=tone.wav key=60 loop_mode=loop_continuous');
      try {
        cleared.events([message(0x90, 60, 127, 1)], 2);
        if (boundary === 'all-sound-off') cleared.events([message(0xb0, 120, 0)], 2);
        else cleared.events([], 1);
        cleared.events([message(0xb0, 64, 127)], 2);
        cleared.events([], 4);
        assert.ok(cleared.render().every(sample => Math.abs(sample) < 1e-7),
          `${boundary} cannot revive cleared history when sustain is pressed later`);
      } finally { cleared.close(); }
    }
  });

  test(`SFZ ${variant} seek reattacks held notes without resurrecting released sample history`, async () => {
    const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
    const module = await WebAssembly.compile(fs.readFileSync(new URL(`../../plugins/dsp/${filename}`, import.meta.url)));
    const control = await instantiateDspBinding(module);
    const binding = await instantiateDspBinding(module);
    binding.createEngine();
    assert.equal(binding.prepare(48000, 2, 128, 262144), 0);
    const packer = DSP_PARAM_PACKERS.get('SoundFontPlayerPlugin');
    let { combined, offsets } = binding.getArenaViews();
    const on = { offsetFrames: 0, status: 0x90, data1: 60, data2: 127, noteId: 1 };
    const off = { offsetFrames: 0, status: 0x80, data1: 60, data2: 0, noteId: 0 };
    try {
      for (const trigger of ['attack', 'release', 'release_key']) {
        const player = binding.createInstance('SoundFontPlayerPlugin');
        try {
          const asset = await instrument(`<region> sample=tone.wav key=60 loop_mode=one_shot trigger=${trigger}`);
          assert.equal(binding.instanceSetParams(player, packer.pack({ mc: 0, pl: 64, og: 0 }), packer.hash), 0);
          const preparedAsset = await materializeAcceptanceAsset(control, asset, { playerKind: 'SoundFontPlayerPlugin' });
          assert.equal(binding.instanceSetAsset(player, 0, preparedAsset.payload,
            { ...preparedAsset, frames: preparedAsset.samples, topology: 0 }), 0);
          const process = () => {
            ({ combined, offsets } = binding.getArenaViews());
            combined.fill(0);
            assert.equal(binding.instanceProcess(player, offsets.combined, 2, 128, 0), 0);
          };
          process();
          assert.equal(binding.instanceSetMidiEvents(player, [], 1, 1), 0);
          assert.equal(binding.instanceSetMidiEvents(player, [on, off], 1, 2), 0);
          assert.equal(binding.instanceSetMidiEvents(player, [], 1, 4), 0);
          for (let block = 0; block < 8; block++) {
            process();
            assert.ok(combined.subarray(0, 256).every(sample => Math.abs(sample) < 1e-7), trigger);
          }
          if (trigger === 'attack') {
            assert.equal(binding.instanceSetMidiEvents(player, [], 2, 1), 0);
            assert.equal(binding.instanceSetMidiEvents(player, [on], 2, 2), 0);
            assert.equal(binding.instanceSetMidiEvents(player, [{ offsetFrames: 17, status: 0,
              data1: 0, data2: 0, noteId: 0, flags: 4 }], 2, 0), 0);
            process();
            assert.ok(combined.subarray(0, 18).every(sample => Math.abs(sample) < 1e-7));
            assert.ok(combined[120] > 0.01);
            assert.equal(binding.instanceSetMidiEvents(player, [{ offsetFrames: 0, status: 0xb0,
              data1: 123, data2: 0 }], 2, 0), 0);
            process();
            assert.equal(binding.instanceSetMidiEvents(player, [], 3, 9), 0);
            process();
            assert.ok(combined[20] > 0.01, 'natural EOF preserves a released-key one-shot');
            assert.equal(binding.instanceSetMidiEvents(player, [], 4, 1), 0);
            process();
            process();
            assert.ok(combined.subarray(0, 256).every(sample => Math.abs(sample) < 1e-7),
              'explicit Stop terminates the same one-shot');
          }
        } finally { binding.destroyInstance(player); }
      }
    } finally { binding.destroyEngine(); control.destroyEngine(); }
  });
}

test('SFZ conservative tail includes all supported onset delays before a release sample', async () => {
  const asset = await instrument('<region> sample=tone.wav key=60 trigger=release loop_mode=one_shot ' +
    'delay=1 delay_random=.2 ampeg_delay=.3', 4800);
  assert.ok(asset.tailSeconds >= 1.6);
});
