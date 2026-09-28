import {
  normalizePlaybackSpeed,
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_MIN,
  PLAYBACK_SPEED_STEP,
  PLAYBACK_SPEED_STEPS
} from '../ui/audio-player/playback-speed.js';

// Controller commands run outside a user gesture. A resume that has not
// settled by then is treated as blocked, and its late result is discarded.
export const PLAYBACK_START_TIMEOUT_MS = 1000;

let presetStepInFlight = false;

function getPlayer(windowRef) {
  return windowRef?.uiManager?.audioPlayer || null;
}

function playerState(windowRef) {
  return getPlayer(windowRef)?.stateManager.getStateSnapshot();
}

function logFailure(promise) {
  void Promise.resolve(promise).catch(error => {
    console.error('[Controller mapping] Player command failed:', error);
  });
}

function startPlayback(windowRef, player, command) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = windowRef.setTimeout(() => resolve('timeout'), PLAYBACK_START_TIMEOUT_MS);
  });
  void Promise.race([player.resumeAudioContextForRemotePlayback(), timeout]).then(result => {
    windowRef.clearTimeout(timer);
    if (result === true) {
      command();
      return;
    }
    console.warn('[Controller mapping] Audio could not resume for controller playback:', result);
    windowRef.uiManager.setError('error.controllerPlaybackBlocked', true);
  });
}

// Wraps a player command so it is a no-op without an open player. Player
// commands never change the pipeline, so they always report false.
function playerAction(command, extra = {}) {
  return {
    kind: 'action',
    ...extra,
    run(windowRef, direction) {
      const player = getPlayer(windowRef);
      if (player) command(windowRef, player, direction);
      return false;
    }
  };
}

async function stepPreset(presetManager, direction) {
  const names = Object.keys(await presetManager.getLoadablePresets()).sort();
  if (names.length === 0) return;
  const index = names.indexOf(presetManager.currentPresetName);
  const next = index < 0
    ? (direction > 0 ? 0 : names.length - 1)
    : (index + direction + names.length) % names.length;
  await presetManager.loadPreset(names[next]);
}

function readPlaybackSpeed(player) {
  return player.stateManager.getStateSnapshot().playbackSpeed;
}

function applyPlaybackSpeed(player, value) {
  return player.playbackManager.setPlaybackSpeed(normalizePlaybackSpeed(value));
}

export const APP_TARGETS = Object.freeze({
  masterBypass: Object.freeze({
    kind: 'action',
    run(windowRef) {
      const toggle = windowRef?.pipelineManager?.core?.masterToggle;
      if (!toggle?.click) return false;
      toggle.click();
      return true;
    },
    state: windowRef => !windowRef?.pipelineManager?.core?.enabled
  }),
  abToggle: Object.freeze({
    kind: 'action',
    run(windowRef) {
      if (!windowRef?.uiManager?.togglePipeline) return false;
      void windowRef.uiManager.togglePipeline();
      return true;
    },
    state: windowRef => windowRef?.audioManager?.currentPipeline === 'B'
  }),
  playPause: Object.freeze(playerAction((windowRef, player) => {
    const manager = player.playbackManager;
    if (manager.activePlayRequest || manager.transitionInProgress || player.stateManager.getStateSnapshot().isPlaying) {
      logFailure(manager.pause());
    } else {
      startPlayback(windowRef, player, () => logFailure(manager.play(false)));
    }
  }, { state: windowRef => Boolean(playerState(windowRef)?.isPlaying) })),
  stop: Object.freeze(playerAction((windowRef, player) => logFailure(player.stop()))),
  track: Object.freeze(playerAction((windowRef, player, direction) => {
    startPlayback(windowRef, player, () => {
      const manager = player.playbackManager;
      player.contextManager?.invalidateAutomaticMoveForManualCommand?.();
      // Priority 2 matches the player's own Next/Previous buttons.
      void manager.runPlaybackCommand(() => manager.runWithPlaybackPending(() => (direction < 0
        ? manager.playPrevious(false)
        : manager.playNext(false, { ignoreRepeatOne: true, reason: 'explicit' })), 2));
    });
  }, { signed: true })),
  seek: Object.freeze(playerAction((windowRef, player, direction) => {
    if (direction < 0) player.playbackManager.rewind(false);
    else player.playbackManager.fastForward(false);
  }, { signed: true })),
  playbackSpeed: Object.freeze({
    kind: 'float',
    descriptor: Object.freeze({
      key: 'playbackSpeed',
      element: 0,
      kind: 'float',
      normalization: 'log',
      minimum: PLAYBACK_SPEED_MIN,
      maximum: PLAYBACK_SPEED_MAX,
      step: PLAYBACK_SPEED_STEP,
      default: 1,
      unit: 'x'
    }),
    target: getPlayer,
    read: readPlaybackSpeed,
    apply: applyPlaybackSpeed,
    // Buttons move one standard speed step and stop at the mapped range ends.
    step(player, direction, lo, hi) {
      const current = readPlaybackSpeed(player);
      direction *= hi < lo ? -1 : 1;
      const next = direction > 0
        ? PLAYBACK_SPEED_STEPS.find(speed => speed > current)
        : PLAYBACK_SPEED_STEPS.findLast(speed => speed < current);
      if (next === undefined) return false;
      const low = lo < hi ? lo : hi;
      const high = lo < hi ? hi : lo;
      return applyPlaybackSpeed(player, next < low ? low : next > high ? high : next);
    }
  }),
  preservePitch: Object.freeze(playerAction((windowRef, player) => {
    player.playbackManager.togglePreservePitch();
  }, { state: windowRef => Boolean(playerState(windowRef)?.preservePitch) })),
  repeat: Object.freeze(playerAction((windowRef, player) => {
    logFailure(player.playbackManager.toggleRepeatMode());
  }, { state: windowRef => (playerState(windowRef)?.repeatMode ?? 'OFF') !== 'OFF' })),
  shuffle: Object.freeze(playerAction((windowRef, player) => {
    logFailure(player.playbackManager.toggleShuffleMode(false));
  }, { state: windowRef => Boolean(playerState(windowRef)?.shuffleMode) })),
  preset: Object.freeze({
    kind: 'action',
    signed: true,
    run(windowRef, direction) {
      const presetManager = windowRef?.pipelineManager?.presetManager;
      // Ignore further steps until the current load settles so encoder
      // bursts cannot overlap preset loads.
      if (!presetManager || presetStepInFlight) return false;
      presetStepInFlight = true;
      void stepPreset(presetManager, direction)
        .catch(error => console.error('[Controller mapping] Preset step failed:', error))
        .finally(() => { presetStepInFlight = false; });
      return false;
    }
  })
});

export function getAppTarget(param) {
  return Object.hasOwn(APP_TARGETS, param) ? APP_TARGETS[param] : null;
}
