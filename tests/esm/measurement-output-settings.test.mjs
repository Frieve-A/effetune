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
const functions = ['getOutputChannelCount', 'getOutputChannelSelection',
  'getSweepBandEditorChannels', 'applyOutputChannelSelection', 'saveUserSettings', 'loadUserSettings']
  .map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');

test('device channel count bounds channel choices and survives settings restoration', () => {
  const countSelect = { value: '6' };
  const inputs = ['all', ...INDIVIDUAL_CHANNELS].map(value => {
    const label = { hidden: false };
    return { value, checked: false, disabled: false, closest: () => label };
  });
  let stored;
  let downstreamSelection;
  const elements = {
    outputChannelCount: countSelect,
    sampleRate: { value: '48000' }, inputChannel: { value: 'both' },
    sweepLength: { value: '131072' }, averaging: { value: '4' }
  };
  const api = runInNewContext(functions + '\n({ getOutputChannelSelection, getSweepBandEditorChannels, applyOutputChannelSelection, saveUserSettings, loadUserSettings })', {
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => selector.includes(':checked')
        ? inputs.filter(input => input.checked) : inputs
    },
    INDIVIDUAL_CHANNELS, SUPPORTED_OUTPUT_CHANNEL_COUNTS, normalizeOutputChannelSelection,
    syncMultichannelControls: selection => { downstreamSelection = selection; },
    getSweepBandConfiguration: () => ({ mode: 'off' }),
    loadSweepBandConfiguration() {},
    window: { app: { dataStorage: {
      saveUserSettings: settings => { stored = settings; },
      loadUserSettings: () => stored
    } } }
  });
  api.applyOutputChannelSelection(['2', '3']);
  assert.deepEqual(Array.from(api.getOutputChannelSelection()), ['2', '3']);
  assert.equal(inputs.filter(input => !input.disabled).length, 7);
  assert.ok(inputs.slice(7).every(input => input.closest().hidden));
  assert.deepEqual(Array.from(api.getSweepBandEditorChannels(['all'])), INDIVIDUAL_CHANNELS.slice(0, 6));
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
});
