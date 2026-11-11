import test from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluateSystemAudioGuard,
    getDefaultOutputGroupId
} from '../../js/audio/system-audio-guard.js';

const outputs = [
    { deviceId: 'default', kind: 'audiooutput', groupId: 'group-speakers' },
    { deviceId: 'communications', kind: 'audiooutput', groupId: 'group-speakers' },
    { deviceId: 'speakers', kind: 'audiooutput', groupId: 'group-speakers' },
    { deviceId: 'dac', kind: 'audiooutput', groupId: 'group-dac' }
];

test('evaluateSystemAudioGuard denies the default output selection', () => {
    assert.deepEqual(evaluateSystemAudioGuard('default', outputs),
        { allowed: false, reason: 'default-output-selected' });
    assert.deepEqual(evaluateSystemAudioGuard('', outputs),
        { allowed: false, reason: 'default-output-selected' });
    assert.deepEqual(evaluateSystemAudioGuard(undefined, outputs),
        { allowed: false, reason: 'default-output-selected' });
});

test('evaluateSystemAudioGuard denies an output in the same group as the default', () => {
    assert.deepEqual(evaluateSystemAudioGuard('speakers', outputs),
        { allowed: false, reason: 'same-as-default-output' });
});

test('evaluateSystemAudioGuard allows an output in a different group than the default', () => {
    assert.deepEqual(evaluateSystemAudioGuard('dac', outputs), { allowed: true, reason: null });
});

test('evaluateSystemAudioGuard denies when the list has no default entry', () => {
    const withoutDefault = outputs.filter(device => device.deviceId !== 'default');
    assert.deepEqual(evaluateSystemAudioGuard('dac', withoutDefault),
        { allowed: false, reason: 'output-device-unknown' });
});

test('evaluateSystemAudioGuard denies when the selected output is not listed', () => {
    assert.deepEqual(evaluateSystemAudioGuard('missing', outputs),
        { allowed: false, reason: 'output-device-unknown' });
    assert.deepEqual(evaluateSystemAudioGuard('dac', []),
        { allowed: false, reason: 'output-device-unknown' });
});

test('getDefaultOutputGroupId reads the default entry group', () => {
    assert.equal(getDefaultOutputGroupId(outputs), 'group-speakers');
    assert.equal(getDefaultOutputGroupId(outputs.filter(device => device.deviceId !== 'default')), null);
    assert.equal(getDefaultOutputGroupId(undefined), null);
});
