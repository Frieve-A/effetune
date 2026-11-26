import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  INDIVIDUAL_CHANNELS,
  normalizeOutputChannelSelection
} from '../../features/measurement/audio-utils/channel-selection.js';
import { SUPPORTED_OUTPUT_CHANNEL_COUNTS } from '../../features/measurement/audio-utils/output-routing.js';

const source = readFileSync(new URL('../../features/measurement/app.js', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../../features/measurement/ui/speaker-distortion-setup.js', import.meta.url), 'utf8');
const functions = ['getOutputChannelCount', 'getOutputChannelSelection', 'getSweepBandEditorChannels',
  'applyOutputChannelSelection', 'saveUserSettings', 'loadUserSettings', 'syncNativeMeasurementChannels']
  .map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
const refresh = setup.match(/function refreshSpeakerDistortionChannels\([^]*?\n\}/)[0];

test('device channel count bounds channel choices and survives settings restoration', () => {
  const countSelect = { value: '6', replaceChildren(...options) { this.options = options; } };
  const inputs = ['all', ...INDIVIDUAL_CHANNELS].map(value => {
    const label = { hidden: false };
    return { value, checked: false, disabled: false, closest: () => label };
  });
  let stored;
  let downstreamSelection;
  let speakerSetup = false;
  let android = false;
  let distortionChannels;
  let setupUpdates = 0;
  const elements = {
    outputChannelCount: countSelect,
    audioOutput: { value: 'surround', options: [] },
    sweepBandChannel: { closest: () => speakerSetup ? {} : null },
    sampleRate: { value: '48000' }, inputChannel: { value: 'both' },
    sweepLength: { value: '131072' }, averaging: { value: '4' }
  };
  const api = runInNewContext(`${functions}\n${refresh}\n({ getOutputChannelSelection, getSweepBandEditorChannels,
    applyOutputChannelSelection, saveUserSettings, loadUserSettings, syncNativeMeasurementChannels })`, {
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => selector.includes(':checked')
        ? inputs.filter(input => input.checked) : inputs
    },
    INDIVIDUAL_CHANNELS, SUPPORTED_OUTPUT_CHANNEL_COUNTS, normalizeOutputChannelSelection,
    audioUtils: { devices: { outputs: [{ id: 'surround', channelCounts: [2, 6] }, { id: 'stereo', channelCounts: [2] }] } },
    Option: class { constructor(text, value) { Object.assign(this, { text, value }); } },
    isAndroidHost: () => android,
    uiManager: { get currentScreen() { return speakerSetup ? 'speakerDistortionSetupScreen' : 'levelAdjustmentScreen'; } },
    renderChannelBoxes() { distortionChannels = INDIVIDUAL_CHANNELS.slice(0, Number(countSelect.value)); },
    updateSetup() { setupUpdates++; },
    syncMultichannelControls: selection => { downstreamSelection = selection; },
    getSweepBandConfiguration: () => ({ mode: 'off' }),
    loadSweepBandConfiguration() {},
    window: { app: { dataStorage: {
      saveUserSettings: settings => { stored = settings; },
      loadUserSettings: () => stored ?? {}
    } } }
  });
  api.applyOutputChannelSelection(['2', '3']);
  assert.deepEqual(Array.from(api.getOutputChannelSelection()), ['2', '3']);
  assert.equal(inputs.filter(input => !input.disabled).length, 7);
  assert.ok(inputs.slice(7).every(input => input.closest().hidden));
  assert.deepEqual(Array.from(api.getSweepBandEditorChannels(['all'])), INDIVIDUAL_CHANNELS.slice(0, 6));
  speakerSetup = true;
  assert.deepEqual(Array.from(api.getSweepBandEditorChannels(['2', '3'])), INDIVIDUAL_CHANNELS.slice(0, 6));
  android = true;
  assert.deepEqual(Array.from(api.getSweepBandEditorChannels(['2', '3'])), INDIVIDUAL_CHANNELS.slice(0, 6));
  speakerSetup = false;
  android = false;
  api.saveUserSettings();
  assert.equal(stored.outputChannelCount, 6);
  countSelect.value = '2';
  api.applyOutputChannelSelection(['all']);
  api.loadUserSettings();
  assert.equal(Number(countSelect.value), 6);
  assert.deepEqual(Array.from(downstreamSelection), ['2', '3']);

  countSelect.value = '2';
  api.applyOutputChannelSelection(api.getOutputChannelSelection());
  assert.deepEqual(Array.from(api.getOutputChannelSelection()), ['all']);
  assert.equal(inputs.filter(input => !input.disabled).length, 3);
  assert.deepEqual(Array.from(downstreamSelection), ['all']);
  assert.deepEqual(Array.from(api.getSweepBandEditorChannels(['all'])), ['left', 'right']);

  assert.equal(setupUpdates, 0);
  speakerSetup = true;
  android = true;
  api.syncNativeMeasurementChannels({ outputChannelCount: 6 });
  assert.deepEqual(distortionChannels, INDIVIDUAL_CHANNELS.slice(0, 6));
  elements.audioOutput.value = 'stereo';
  api.syncNativeMeasurementChannels();
  assert.deepEqual(distortionChannels, ['left', 'right']);
  assert.equal(setupUpdates, 2);
});
