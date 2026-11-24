import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioIOManager } from '../../js/audio/audio-io-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { createInitialPowerSnapshot } from '../../js/audio/power-snapshot.js';
import { collectDiagnosticFile } from '../../js/diagnostics/diagnostic-bundle.js';
import { recordDiagnosticEvent, rememberDiagnosticNames, rememberDiagnosticTrack, startDiagnosticRecording } from '../../js/diagnostics/diagnostic-log.js';
import { addDiagnosticWord, redactDiagnosticText } from '../../js/diagnostics/diagnostic-redaction.js';
import { UIManager } from '../../js/ui-manager.js';
import { encodePipelineStateJson } from '../../js/utils/pipeline-state-codec.js';

const uuid = 'c054ade2-fcd4-48cf-a5ac-a57334c225c3';
const origin = 'https://audio.example/app/effetune.html';
const createWindow = () => ({ location: { href: origin }, console: { warn() {}, error() {} } });

test('Web diagnostics retain recognized browser versions while removing addresses from the user agent and console', async t => {
    const win = createWindow();
    t.after(startDiagnosticRecording(win));
    win.console.warn('Contacting 192.168.1.2 with Chrome/146.0.0.0');
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64; proxy 192.168.1.2) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36';
    for (const [suffix, versions] of [
        ['', { Chrome: '146.0.0.0', Safari: '537.36' }],
        [' Edg/146.0.1.0 Proxy/192.168.1.2', { Chrome: '146.0.0.0', Edg: '146.0.1.0', Safari: '537.36' }]
    ]) {
        win.navigator = { userAgent: userAgent + suffix };
        const { text } = await collectDiagnosticFile(win);
        const file = JSON.parse(text);
        assert.deepEqual(file.environment.browserVersions, versions);
        assert.doesNotMatch(text, /192\.168\.1\.2/);
        assert.doesNotMatch(file.console[0].args[0], /146\.0\.0\.0/);
    }
});

test('privacy rules preserve known app stack locations and remove shared pipeline URLs', () => {
    const cases = [
        ['C:\\Users\\Alice\\My Recordings\\Song.flac', '<path>'], ['/Volumes/Media/Track.flac', '<path>'],
        ['\\\\my-server\\collection\\Track.mp3', '<path>'], ['/private/tmp/personal', '<path>'],
        ['file:///Users/test/private.txt', '<url>'], ['blob:https://other.example/private', '<url>'],
        ['https://audio.example/app/privateTrack', '<url>'], ['https://other.example/js/app.js:2:1', '<url>'],
        ['data:text/plain,secret', '<url>'], ['me@example.org', '<email>'],
        ['192.168.5.1', '<ip>'], ['2001:db8::50', '<ip>'], [uuid, '<id>'],
        ['57a157a157a157a157a157a1', '<id>'],
        ['at file:///C:/Users/Alice/resources/app.asar/js/app.js:2:10', 'at js/app.js:2:10'],
        ['at /Applications/EffeTune.app/Contents/Resources/app.asar/js/app.js:2:10', 'at js/app.js:2:10'],
        ['at read (/Users/Alice Doe, Jr/Music/File.flac:15:2)', 'at read (<path>)'],
        ['could not read C:\\Users\\Alice (Music)\\Private Album\\Name.flac during playback', 'could not read <path>'],
        ["Error: ENOENT: open '/Users/O'Brien/Music/Secret.flac'", "Error: ENOENT: open '<path>'"],
        ["failed /Users/O'Brien/Music/Secret.flac", 'failed <path>'],
        ['failed /Users/Alice/Music/Folder.mp3 Archive/Secret.flac now', 'failed <path>'],
        ["failed '/Users/Alice/Folder.mp3 Archive/John' Paul/secret' file.flac'", "failed '<path>'"],
        ["at init ('/Users/O'Brien/Folder.mp3 Archive/app.asar/js/app.js:15:2')", "at init ('js/app.js:15:2')"],
        ['at read (https://example.org/pub/(Artist)/Private_Name.flac:15:2)', 'at read (<url>)'],
        ['at read (C:\\Users\\Alice (Music), Jr\\app.asar\\js\\app.js:15:2)', 'at read (js/app.js:15:2)']
    ];
    for (const [input, expected] of cases) assert.equal(redactDiagnosticText(input, [], origin), expected);
    const encoded = encodePipelineStateJson(JSON.stringify([{ nm: 'Section', cm: 'Family listening room' }]));
    const url = new URL(origin);
    url.searchParams.set('p', encoded);
    url.hash = 'private';
    assert.equal(redactDiagnosticText(`at init (${url}:98:12)`, [], origin), 'at init (effetune.html:98:12)');
    const words = new Map();
    addDiagnosticWord(words, 'Ac', 'preset');
    assert.equal(redactDiagnosticText('Ac', words), '<preset>');
    assert.equal(redactDiagnosticText('Ac active "Ac"', words), 'Ac active "<preset>"');
});

test('large URL arguments without an email address redact promptly before the Console length limit', () => {
    const url = 'https://other.example/recording?session=' + 'q'.repeat(100_000);
    const start = performance.now();
    assert.equal(redactDiagnosticText(url), '<url>');
    // Rescanning for @ from each character previously took several seconds at this size.
    assert.ok(performance.now() - start < 1000);
});

test('player format uses rolling decoder metadata and falls back to actual media duration and known track fields', async () => {
    const win = createWindow();
    const state = { playbackMode: 'rollingPcm', currentTrack: { name: 'private.wav', meta: { codec: 'pcm', channels: 1 } } };
    const context = { currentPlaybackDecision: { committedMode: 'rolling', metadata: { sampleRate: 44100 } },
        rollingTransport: { metadata: {
            containerMimeType: 'audio/x-dsf', codec: 'dsd', sampleRate: 48000, sourceSampleRate: 2822400,
            channelCount: 2, durationSec: 92.5, privateProperty: 'never include this'
        } } };
    win.uiManager = { audioPlayer: { stateManager: { getStateSnapshot: () => state },
        contextManager: context, audioElement: { duration: 32.75 } } };
    let { text } = await collectDiagnosticFile(win);
    assert.doesNotMatch(text, /private\.wav|never include/);
    assert.deepEqual(JSON.parse(text).player.format, {
        container: 'dsf', codec: 'dsd', sampleRate: 2822400, channels: 2, durationSec: 92.5
    });
    context.rollingTransport.metadata = { containerMimeType: 'audio/unrecognized-secret', codec: 'unrecognized-secret' };
    ({ text } = await collectDiagnosticFile(win));
    assert.doesNotMatch(text, /unrecognized-secret/);
    assert.equal(JSON.parse(text).player.format.codec, 'pcm');
    delete context.rollingTransport;
    state.playbackMode = 'audioElement';
    context.currentPlaybackDecision.committedMode = 'media';
    assert.deepEqual(JSON.parse((await collectDiagnosticFile(win)).text).player.format, {
        container: 'wav', codec: 'pcm', sampleRate: 44100, channels: 1, durationSec: 32.75
    });
});

test('failed Open Music selection redacts whole names before truncation and bounded retention', async t => {
    const win = createWindow();
    // The selection's catch block writes to the renderer Console.
    t.mock.method(console, 'error', () => {});
    win.console = console;
    t.after(startDiagnosticRecording(win));
    const manager = Object.assign(Object.create(UIManager.prototype), {
        playbackSelectionGeneration: 0, invalidatePlaybackSessionRestore() {}, setError() {},
        playbackSelectionResolver() { throw Object.assign(new Error(), { code: 'cueSelectionInvalid' }); }
    });
    const names = ['Private First "Take".flac', 'Personal Recording ' + 'q'.repeat(510) + '.flac',
        ...Array.from({ length: 210 }, (_, i) => `Private take ${i}.flac`), `Family Session ${uuid}.cue`];
    assert.equal(await manager.openWebPlaybackSelection(names.map(name => ({ name })), true), false);
    assert.equal(await manager.openWebPlaybackSelection([{ name: names.at(-1) }], true), false);
    win.electronAPI = { diagnostics: { collect: () => ({
        nativeHost: { lastExit: { stderr: redactDiagnosticText(`failed to read ${names.at(-1)}`) } }
    }) } };
    const { text } = await collectDiagnosticFile(win);
    assert.doesNotMatch(text, /Private First|Private take|Personal Recording|qqqq|Family Session/);
    assert.match(text, /cueSelectionInvalid/);
    assert.match(text, /failed to read <track>/);
});

test('session, preset, section, device and explicit sink names are removed from free text at save', async t => {
    const win = createWindow();
    t.after(startDiagnosticRecording(win));
    win.console.warn('Startup preset main absent; retries exhausted.');
    rememberDiagnosticNames('preset', ['main']);
    rememberDiagnosticTrack({ name: 'Private Performance', meta: { artist: 'Hidden Artist' } });
    win.console.warn('Preparation failed', 'Private Performance', 'Hidden Artist');
    await AudioIOManager.prototype._setSinkIdWithTimeout({ setSinkId: () => new Promise(() => {}) }, 'hang', 1)
        .catch(error => win.console.error(error));
    recordDiagnosticEvent('outputFallback', { outputDeviceLabel: 'Removed Headset', outputSelection: 'explicit',
        reason: 'sinkFailed', result: 'success' });
    win.navigator = { mediaDevices: { enumerateDevices: async () => [
        { deviceId: 'private-output-serial', groupId: 'private-group', label: 'Other Speaker' }
    ] } };
    win.audioPreferences = { inputDeviceId: 'first-microphone', inputDeviceLabel: 'Microphone first' };
    win.audioManager = { contextManager: { diagnosticRequest: { outputSelection: 'explicit', outputDeviceLabel: 'Selected USB' } },
        getCurrentPipeline: () => [{ name: 'Section', cm: 'Reading Room', inputBus: 'untrusted-value',
            outputBus: null, channel: 'untrusted-value' }] };
    win.electronAPI = { diagnostics: { collect: () => ({ nativeHost: { lastExit: {
        stderr: 'main failed in Reading Room on Other Speaker and Removed Headset using private-output-serial'
    } }, events: [{ kind: 'startup', epochMs: 5, origin: 'main' }] }) } };
    const { text } = await collectDiagnosticFile(win);
    assert.doesNotMatch(text, /Removed Headset|Other Speaker|Reading Room|Private Performance|Hidden Artist|private-output-serial|Microphone first|untrusted-value|\bhang\b/);
    assert.match(text, /Startup preset <preset> absent/);
    assert.match(text, /setSinkId.*timed out/);
    assert.match(text, /<preset> failed in <section> on <device>/);
    const file = JSON.parse(text);
    assert.equal(file.events[0].origin, 'main');
    assert.equal(file.audio.requested.outputDeviceLabel, 'Selected USB');
    assert.equal(file.audio.settings.inputDeviceLabel, 'unnamed');
    assert.equal(file.events[1].outputDeviceLabel, '<device>');
    assert.equal(file.events[1].reason, 'sinkFailed');
    assert.equal(file.events[1].result, 'success');
    win.audioPreferences.inputDeviceId = NO_AUDIO_INPUT_DEVICE_ID;
    assert.equal(JSON.parse((await collectDiagnosticFile(win)).text).audio.settings.inputDeviceLabel, undefined);
});

test('power, engine and Windows status expose only selected leaves and unsupported platforms are marked', async () => {
    const secret = 'EXCLUDED-IDENTITY';
    const power = structuredClone(createInitialPowerSnapshot());
    Object.assign(power.resourceStatus.persistence, { clientId: secret, sessionId: secret });
    power.transition.operationId = secret;
    power.resourceStatus.worklets.nodes.push({ role: 'primary', commandAckId: secret, observationRequestId: secret,
        statePreparation: { ownerOperationId: secret, commandId: secret, ackCommandId: secret } });
    const win = createWindow();
    win.audioManager = { getPowerSnapshot: () => power, getDiagnosticNativeState: () => ({
        variant: 'single', confirmedActivity: 'stopped', session: { recoveryId: secret, periodFrames: 256 },
        openSettings: { inputDeviceId: secret, outputDeviceId: secret, sampleRate: 48000 },
        counters: { feedGaps: 5, privateCounter: secret }
    }), ioManager: { getInputSnapshot: () => ({ deviceId: secret, groupId: secret }) } };
    win.electronAPI = { diagnostics: { collect: () => ({ events: [] }) },
        getBackgroundProcessingStatus: () => ({ rendererPid: secret, appSuspensionBlocked: true,
            rendererPowerThrottling: { applied: true, processingActive: true, restoring: false, restoreFailed: true,
                pid: secret, helperPid: secret, creationTime: secret, error: secret } }) };
    const { text, name } = await collectDiagnosticFile(win);
    const file = JSON.parse(text);
    assert.match(name, /^effetune-diagnostics-\d{8}-\d{6}\.txt$/);
    assert.equal(file.formatVersion, 1);
    assert.ok(Number.isInteger(file.utcOffsetMinutes));
    assert.doesNotMatch(text, /EXCLUDED-IDENTITY/);
    assert.equal(file.environment.background.rendererPowerThrottling.restoreFailed, true);
    assert.equal(file.nativeEngine.confirmedActivity, 'stopped');
    assert.equal(file.nativeEngine.session.periodFrames, 256);
    delete win.electronAPI;
    const web = JSON.parse((await collectDiagnosticFile(win)).text);
    assert.equal(web.mainProcess, 'notApplicable');
    assert.equal(web.nativeEngine, 'notApplicable');
    win.audioManager.isAndroid = true;
    win.audioManager.getPowerSnapshot = () => assert.fail('Android native snapshot');
    assert.equal(JSON.parse((await collectDiagnosticFile(win)).text).power, 'notApplicable');
});

test('silence can be localized before or after the worklet from separate snapshots', async () => {
    const win = createWindow();
    let inputActive = false;
    const output = { outputGate: { status: 'confirmed' }, outputGain: 1 };
    win.audioManager = {
        powerPolicyController: { getDiagnosticObservations: () => [{ role: 'primary', inputActive, outputActive: inputActive }] },
        getDiagnosticOutput: () => output
    };
    win.uiManager = { audioPlayer: { stateManager: { getStateSnapshot: () => ({ isPlaying: true }) },
        contextManager: { getDiagnosticSourceState: () => ({ hasPrivateGate: true, privateGateGain: inputActive ? 1 : 0 }) } } };
    const before = JSON.parse((await collectDiagnosticFile(win)).text);
    assert.equal(before.player.source.privateGateGain, 0);
    assert.equal(before.power.observations[0].inputActive, false);
    inputActive = true;
    output.outputGate.status = 'timedOut';
    output.outputGain = 0;
    output.networkApplied = { localEnabled: false, requestId: 2 };
    const after = JSON.parse((await collectDiagnosticFile(win)).text);
    assert.equal(after.power.observations[0].outputActive, true);
    assert.equal(after.audio.output.outputGate.status, 'timedOut');
    assert.equal(after.audio.output.outputGain, 0);
    assert.equal(after.audio.output.networkApplied.localEnabled, false);
});

test('history aligns capture decisions, visibility, worklet gaps, recovery attempts and App Nap on one timeline', async t => {
    const win = createWindow();
    const clock = t.mock.method(Date, 'now', () => 42);
    t.after(startDiagnosticRecording(win));
    for (const [time, kind, fields] of [
        [2, 'visibility', { hidden: true }], [3, 'contextState', { state: 'suspended', intentional: false }],
        [4, 'visibility', { hidden: false }], [5, 'resume', { trigger: 'visible', reason: 'notFullyActive', result: true }],
        [6, 'resume', { trigger: 'focus', reason: 'inputResumeRequired', contextState: 'running', result: false }],
        [7, 'workletObservation', { previousReceivedAtEpochMs: 1, receivedAtEpochMs: 7 }],
        [9, 'browserCapture', { errorName: 'NotReadableError', message: 'Could not start video source' }]
    ]) {
        clock.mock.mockImplementation(() => time);
        recordDiagnosticEvent(kind, fields);
    }
    win.electronAPI = { diagnostics: { collect: () => ({ startedAtEpochMs: 0, events: [
        { kind: 'appNap', origin: 'main', epochMs: 1, state: 'released' },
        { kind: 'browserCapture', origin: 'main', epochMs: 8, decision: 'granted' },
        { kind: 'appNap', origin: 'main', epochMs: 10, state: 'started' }
    ] }) } };
    const { events } = JSON.parse((await collectDiagnosticFile(win)).text);
    assert.deepEqual(events.map(event => event.epochMs), [1,2,3,4,5,6,7,8,9,10]);
    assert.equal(events[2].intentional, false);
    assert.equal(events[4].trigger, 'visible');
    assert.equal(events[5].reason, 'inputResumeRequired');
    assert.equal(events[5].result, false);
    assert.equal(events[6].previousReceivedAtEpochMs, 1);
    assert.equal(events[7].decision, 'granted');
    assert.equal(events[8].errorName, 'NotReadableError');
    assert.deepEqual(events.filter(event => event.kind === 'appNap').map(event => event.state), ['released','started']);
});

test('the readable summary reports the native driver, sample rate conversion and buffer latency', async () => {
    const win = createWindow();
    const native = { openSettings: { latency: 'balanced' },
        session: { sampleRate: 96000, deviceRate: 48000, captureRate: 44100, periodFrames: 480, inputChannels: 2 },
        latency: { outputLatencyFrames: 960, inputLatencyFrames: 441, outputConverterDelayFrames: 192,
            captureTargetFrames: 882, feedFrames: 1024 } };
    win.audioManager = { getDiagnosticNativeState: () => native, getOutputChannelCount: () => 2,
        getTotalPipelineLatencySamples: () => 960, contextManager: { audioContext: { sampleRate: 96000 } } };
    win.electronAPI = { diagnostics: { collect: () => ({ events: [], environment: { platform: 'win32',
        systemVersion: '10.0.26300', arch: 'x64', electron: '39.2.0', chromium: '142.0.0.0', appVersion: '2.20.0' } }) } };
    const lines = async () => (await collectDiagnosticFile(win)).summary.split('\n').map(line => line.trim());
    const running = await lines();
    for (const line of ['App: EffeTune 2.20.0', 'OS: Windows 10.0.26300 (x64)', 'Driver: WASAPI',
        'Output device: System default (2 ch)', 'Output sample rate conversion: 96000 Hz → 48000 Hz',
        'Input sample rate conversion: 44100 Hz → 96000 Hz', 'Latency setting: Mid', 'Device buffer: 480 samples (10.0 ms)',
        'Output latency: 22.0 ms (driver and device 20.0 ms + sample rate conversion 2.0 ms)',
        'Input latency: 30.0 ms (driver and device 10.0 ms + input buffer 20.0 ms)',
        'Transfer buffer from the app window to the driver: 10.7 ms', 'Total Delay (effect pipeline): 10.0 ms (960 samples)'
    ]) assert.ok(running.includes(line), line);
    native.session = native.latency = null;
    const stopped = await lines();
    assert.ok(stopped.includes('The audio driver is not running.'));
    assert.ok(!stopped.includes('Sample rates'));
});
