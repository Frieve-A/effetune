import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_SESSION_CAPTURE_TYPE,
  AUDIO_SESSION_IDLE_TYPE,
  AudioSessionTypeController,
  createAudioSessionTypeController,
  isAudioSessionTypeControlSupported
} from '../../js/audio/audio-session-type-controller.js';
import { AudioIOManager } from '../../js/audio/audio-io-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { createConsoleHarness, withGlobals } from '../helpers/global-test-utils.mjs';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const IDLE_STATES = [
  'released',
  'ended',
  'denied',
  'error',
  'not-configured',
  'unknown',
  null,
  undefined
];

/**
 * A stand-in for navigator.audioSession. `attempts` records every assignment the
 * controller tries, including the ones the setter rejects, so a test can prove
 * that a capped controller stops touching the property entirely.
 */
function createSession({ failures = 0 } = {}) {
  const attempts = [];
  const writes = [];
  let failuresLeft = failures;
  let stored = AUDIO_SESSION_IDLE_TYPE;
  const session = {
    get type() {
      return stored;
    },
    set type(value) {
      attempts.push(value);
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error('audio session type rejected');
      }
      stored = value;
      writes.push(value);
    }
  };
  return { session, attempts, writes };
}

function createNavigator({
  userAgent = IPHONE_UA,
  platform = 'iPhone',
  maxTouchPoints = 5,
  session = undefined,
  withSession = true
} = {}) {
  const navigatorRef = { userAgent, platform, maxTouchPoints };
  if (withSession) navigatorRef.audioSession = session;
  return navigatorRef;
}

function createController(options = {}) {
  const { session, attempts, writes } = createSession(options);
  const navigatorRef = createNavigator({ ...options, session });
  const controller = createAudioSessionTypeController({
    navigatorRef,
    isElectron: options.isElectron === true
  });
  return { controller, session, attempts, writes, navigatorRef };
}

async function captureWarnings(callback) {
  const warnings = [];
  await withGlobals({
    console: createConsoleHarness({
      warn(...args) {
        warnings.push(args.join(' '));
      }
    })
  }, callback);
  return warnings;
}

test('the exported types are the two categories iOS accepts without disabling capture', () => {
  assert.equal(AUDIO_SESSION_CAPTURE_TYPE, 'play-and-record');
  assert.equal(AUDIO_SESSION_IDLE_TYPE, 'auto');
});

test('type control is limited to non-Electron iOS hosts that expose an audio session', () => {
  const { session } = createSession();

  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ session })
  }), true);
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ session }),
    isElectron: true
  }), false, 'Electron keeps its own session handling');
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 5, session })
  }), true, 'iPadOS reports a desktop user agent');
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 0, session })
  }), false, 'a real Mac is not gated on the session type');
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5, session })
  }), false);
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ userAgent: DESKTOP_UA, platform: 'Win32', maxTouchPoints: 0, session })
  }), false);
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ withSession: false })
  }), false, 'a host without navigator.audioSession cannot be steered');
  assert.equal(isAudioSessionTypeControlSupported({
    navigatorRef: createNavigator({ session: 'play-and-record' })
  }), false, 'a non-object audioSession is not the WebKit API');
  assert.equal(isAudioSessionTypeControlSupported({ navigatorRef: null }), false);
  assert.equal(isAudioSessionTypeControlSupported(), false);
});

test('the factory declines every host that does not gate audio on the session type', () => {
  for (const options of [
    { withSession: false, userAgent: ANDROID_UA, platform: 'Linux armv8l' },
    { withSession: false, userAgent: DESKTOP_UA, platform: 'Win32', maxTouchPoints: 0 },
    { isElectron: true },
    { userAgent: ANDROID_UA, platform: 'Linux armv8l' },
    { userAgent: IPADOS_UA, platform: 'MacIntel', maxTouchPoints: 0 }
  ]) {
    const { controller, attempts } = createController(options);
    assert.equal(controller, null, JSON.stringify(options));
    assert.deepEqual(attempts, [], 'an unsupported host never has its session type assigned');
  }

  assert.equal(createAudioSessionTypeController(), null);
});

test('the factory builds a controller for an iPhone and for an iPad reporting MacIntel', () => {
  assert.ok(createController().controller instanceof AudioSessionTypeController);
  assert.ok(createController({
    userAgent: IPADOS_UA,
    platform: 'MacIntel',
    maxTouchPoints: 5
  }).controller instanceof AudioSessionTypeController);
});

test('acquiring the microphone applies the capture type once and live keeps it', () => {
  const { controller, attempts, session } = createController();

  controller.sync('acquiring');
  assert.deepEqual(attempts, [AUDIO_SESSION_CAPTURE_TYPE]);
  assert.equal(session.type, AUDIO_SESSION_CAPTURE_TYPE);

  controller.sync('live');
  controller.sync('live');
  controller.sync('acquiring');
  assert.deepEqual(attempts, [AUDIO_SESSION_CAPTURE_TYPE], 'an equivalent state writes nothing');
});

test('every non-capture input state hands the category back to the platform', () => {
  for (const state of IDLE_STATES) {
    const { controller, attempts, session } = createController();
    controller.sync('live');
    controller.sync(state);
    assert.deepEqual(
      attempts,
      [AUDIO_SESSION_CAPTURE_TYPE, AUDIO_SESSION_IDLE_TYPE],
      `state ${String(state)}`
    );
    assert.equal(session.type, AUDIO_SESSION_IDLE_TYPE);

    controller.sync(state);
    assert.equal(attempts.length, 2, 'a repeated idle state writes nothing');
  }
});

test('an exhaustive transition sequence only ever writes the capture or idle type', () => {
  const { controller, attempts } = createController();
  const states = ['acquiring', 'live', ...IDLE_STATES, 'live', 'acquiring', 'denied', 'live'];

  for (const first of states) {
    for (const second of states) {
      controller.sync(first);
      controller.sync(second);
    }
  }

  assert.ok(attempts.length > 0);
  assert.deepEqual(
    [...new Set(attempts)].sort(),
    [AUDIO_SESSION_IDLE_TYPE, AUDIO_SESSION_CAPTURE_TYPE].sort(),
    'a category that would stop microphone capture must never be assigned'
  );
});

test('a rejecting setter is retried a bounded number of times and reported once', async () => {
  const { controller, attempts, writes } = createController({ failures: Number.MAX_SAFE_INTEGER });

  const warnings = await captureWarnings(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      controller.sync('live');
      controller.sync('released');
    }
  });

  assert.deepEqual(attempts, [
    AUDIO_SESSION_CAPTURE_TYPE,
    AUDIO_SESSION_IDLE_TYPE,
    AUDIO_SESSION_CAPTURE_TYPE
  ], 'a rejection leaves the last applied value unset so the next transition retries, and the retry stops after three rejections');
  assert.deepEqual(writes, []);
  assert.equal(controller.failureCount, 3);
  assert.equal(warnings.length, 1, 'giving up is reported exactly once');
  assert.match(warnings[0], /^\[AudioSessionType\]/);
  assert.match(warnings[0], /background playback and OS now-playing stay unavailable/);
});

test('a transient rejection is forgotten once an assignment lands', async () => {
  const { controller, attempts, writes, session } = createController({ failures: 2 });

  const warnings = await captureWarnings(async () => {
    controller.sync('live');
    assert.equal(controller.failureCount, 1);
    assert.equal(session.type, AUDIO_SESSION_IDLE_TYPE, 'the getter keeps reporting the unchanged value');

    controller.sync('live');
    assert.equal(controller.failureCount, 2);

    controller.sync('live');
    assert.equal(controller.failureCount, 0, 'a landed assignment clears the earlier rejections');
  });

  assert.equal(attempts.length, 3);
  assert.deepEqual(writes, [AUDIO_SESSION_CAPTURE_TYPE]);
  assert.equal(session.type, AUDIO_SESSION_CAPTURE_TYPE);
  assert.deepEqual(warnings, [], 'a recovered controller reports nothing');
});

test('dispose releases the category and ignores later input transitions', () => {
  const { controller, attempts, session } = createController();

  controller.sync('live');
  controller.dispose();

  assert.deepEqual(attempts, [AUDIO_SESSION_CAPTURE_TYPE, AUDIO_SESSION_IDLE_TYPE]);
  assert.equal(session.type, AUDIO_SESSION_IDLE_TYPE);

  controller.sync('live');
  controller.sync('acquiring');
  controller.dispose();
  assert.deepEqual(attempts, [AUDIO_SESSION_CAPTURE_TYPE, AUDIO_SESSION_IDLE_TYPE]);
  assert.equal(session.type, AUDIO_SESSION_IDLE_TYPE);
});

test('a controller without a session survives a sync instead of throwing', () => {
  const controller = new AudioSessionTypeController();
  controller.sync('live');
  assert.equal(controller.failureCount, 1);
});

function createInputStream(id = 'mic') {
  const track = {
    readyState: 'live',
    enabled: true,
    muted: false,
    addEventListener() {},
    removeEventListener() {},
    stop() {
      this.readyState = 'ended';
    }
  };
  return { id, getTracks: () => [track], getAudioTracks: () => [track] };
}

function createFakeNode() {
  return {
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
    gain: { value: 1 }
  };
}

function createContextManager() {
  return {
    audioContext: {
      sampleRate: 48000,
      state: 'running',
      destination: createFakeNode(),
      createGain: createFakeNode,
      createBufferSource: createFakeNode,
      createBuffer: () => ({}),
      createMediaStreamSource: () => createFakeNode()
    },
    workletNode: createFakeNode(),
    isFirstLaunch: false
  };
}

async function withIOSAudioIO(callback) {
  const { session, attempts } = createSession();
  const typeAtGetUserMedia = [];
  const navigatorRef = {
    userAgent: IPHONE_UA,
    platform: 'iPhone',
    maxTouchPoints: 5,
    audioSession: session,
    mediaDevices: {
      getUserMedia: async () => {
        typeAtGetUserMedia.push(session.type);
        return createInputStream();
      }
    }
  };
  const windowRef = {
    audioPreferences: {},
    electronAPI: null,
    electronIntegration: null
  };

  await withGlobals({
    window: windowRef,
    navigator: navigatorRef,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: createConsoleHarness({ log() {}, warn() {}, error() {} })
  }, async () => {
    const manager = new AudioIOManager(createContextManager());
    await callback({ manager, session, attempts, typeAtGetUserMedia, windowRef });
  });
}

test('the io manager holds the capture category before it opens the microphone', async () => {
  await withIOSAudioIO(async ({ manager, attempts, typeAtGetUserMedia, session }) => {
    assert.ok(manager.audioSessionType, 'an iOS host gets a controller');
    assert.deepEqual(attempts, [], 'construction alone leaves the platform default in place');

    assert.equal(await manager.initAudioInput(), '');
    assert.deepEqual(typeAtGetUserMedia, [AUDIO_SESSION_CAPTURE_TYPE],
      'the category is already capture-compatible when getUserMedia runs');
    assert.deepEqual(attempts, [AUDIO_SESSION_CAPTURE_TYPE],
      'acquiring and live share one assignment');
    assert.equal(manager.inputResourceState, 'live');
    assert.equal(session.type, AUDIO_SESSION_CAPTURE_TYPE);
  });
});

test('releasing and reacquiring the microphone moves the category with it', async () => {
  await withIOSAudioIO(async ({ manager, attempts, typeAtGetUserMedia, session }) => {
    await manager.initAudioInput();

    manager.releaseAudioInput({ reason: 'test' });
    assert.equal(manager.inputResourceState, 'released');
    assert.equal(session.type, AUDIO_SESSION_IDLE_TYPE);

    await manager.beginReacquireAudioInput({ requireVisible: false });
    assert.deepEqual(typeAtGetUserMedia, [AUDIO_SESSION_CAPTURE_TYPE, AUDIO_SESSION_CAPTURE_TYPE]);
    assert.deepEqual(attempts, [
      AUDIO_SESSION_CAPTURE_TYPE,
      AUDIO_SESSION_IDLE_TYPE,
      AUDIO_SESSION_CAPTURE_TYPE
    ]);
    assert.equal(manager.inputResourceState, 'live');
  });
});

test('an input the user disabled leaves the platform default untouched', async () => {
  await withIOSAudioIO(async ({ manager, attempts, typeAtGetUserMedia, windowRef }) => {
    windowRef.audioPreferences = { inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID };

    assert.equal(await manager.initAudioInput(), '');
    assert.equal(manager.inputResourceState, 'not-configured');
    assert.deepEqual(typeAtGetUserMedia, [], 'no microphone was opened');
    assert.deepEqual(attempts, [AUDIO_SESSION_CAPTURE_TYPE, AUDIO_SESSION_IDLE_TYPE],
      'the acquiring hop is undone as soon as the preference is read');
  });
});

test('an io manager off iOS never builds a session type controller', async () => {
  await withGlobals({
    window: { audioPreferences: {}, electronAPI: null, electronIntegration: null },
    navigator: { userAgent: ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }
  }, () => {
    const manager = new AudioIOManager(createContextManager());
    assert.equal(manager.audioSessionType, null);
    manager._syncAudioSessionType();
  });
});
