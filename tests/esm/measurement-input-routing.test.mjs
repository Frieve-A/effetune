import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { startMicrophoneInput } from '../../features/measurement/audio-utils/devices.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createNode(name, connections, options = {}) {
    return {
        name,
        channelCount: options.channelCount,
        gain: { value: 1 },
        port: { onmessage: null },
        connect(target, output = 0, input = 0) {
            connections.push([name, target.name, output, input]);
        },
        disconnect() {}
    };
}

function createInputHarness(channelCount) {
    const connections = [];
    const gains = [];
    const track = {
        getSettings: () => ({ channelCount }),
        stop() {}
    };
    const stream = {
        getAudioTracks: () => [track],
        getTracks: () => [track]
    };
    const splitter = createNode('splitter', connections);
    const microphone = createNode('microphone', connections, { channelCount });
    const analyzer = createNode('analyzer', connections);
    const levelMeter = createNode('level-meter', connections);
    const context = {
        state: 'running',
        destination: createNode('destination', connections),
        createMediaStreamSource: () => microphone,
        createChannelSplitter: () => splitter,
        createGain() {
            const gain = createNode(`gain-${gains.length}`, connections);
            gains.push(gain);
            return gain;
        }
    };
    const audioUtils = {
        audioContext: context,
        analyzer,
        stopMicrophoneInput() {},
        ensureAudioContextRunning: async () => true,
        createLevelMeterWorkletNode: async () => levelMeter
    };
    return { audioUtils, connections, gains, stream };
}

test('Both input averages left and right once before level metering and recording', async () => {
    const harness = createInputHarness(2);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => harness.stream
            }
        }
    }, async () => {
        assert.equal(
            await startMicrophoneInput.call(harness.audioUtils, 'device-1', 'both'),
            true
        );
    });

    assert.equal(harness.gains[1].gain.value, 0.5);
    assert.equal(harness.gains[2].gain.value, 0.5);
    assert.equal(harness.connections.some(connection =>
        connection[0] === 'gain-0' && connection[1] === 'level-meter'), true);

    const processingSource = readFileSync(
        new URL('../../features/measurement/measurement-controller/audio-processing.js', import.meta.url),
        'utf8'
    );
    assert.match(processingSource, /audioUtils\.channelGain\.connect\(recordNode\)/);
    assert.doesNotMatch(processingSource, /audioUtils\.microphone\.connect\(recordNode\)/);
});

test('Right input requires and validates a stereo capture stream', async () => {
    const stereo = createInputHarness(2);
    let constraints;
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async requested => {
                    constraints = requested;
                    return stereo.stream;
                }
            }
        }
    }, async () => {
        assert.equal(
            await startMicrophoneInput.call(stereo.audioUtils, 'device-2', 'right'),
            true
        );
    });
    assert.deepEqual(constraints.audio.channelCount, { min: 2 });
    assert.equal(stereo.connections.some(connection =>
        connection[0] === 'splitter' &&
        connection[1] === 'gain-0' &&
        connection[2] === 1), true);

    const mono = createInputHarness(1);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => mono.stream
            }
        }
    }, async () => {
        await assert.rejects(
            startMicrophoneInput.call(mono.audioUtils, 'device-3', 'right'),
            /does not provide a right channel/
        );
    });

    const rejected = createInputHarness(1);
    await withGlobals({
        navigator: {
            mediaDevices: {
                getUserMedia: async () => {
                    const error = new Error('constraint failed');
                    error.name = 'OverconstrainedError';
                    throw error;
                }
            }
        }
    }, async () => {
        await assert.rejects(
            startMicrophoneInput.call(rejected.audioUtils, 'device-4', 'right'),
            /does not provide a right channel/
        );
    });
});
