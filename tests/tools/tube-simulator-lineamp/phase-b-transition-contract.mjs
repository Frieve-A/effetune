export const PHASE_B_TRANSITION_CONTRACT =
  'tube-line-phase-b-reset-transition-v5';
export const PHASE_B_FADE_OUT_MS = 5;
export const PHASE_B_WARMUP_MS = 50;
export const PHASE_B_FADE_IN_MS = 5;
export const PHASE_B_EVENT1_MS = 25;
export const PHASE_B_EVENT2_MS = 90;
export const PHASE_B_ACTIVE_END_MS = 175;
export const PHASE_B_RMS_WINDOW_FRAMES = 64;
export const PHASE_B_BLOCK_SIZE = 128;

function frameCount(sampleRate, milliseconds) {
  return Math.ceil(sampleRate * milliseconds / 1000);
}

function postObservationEnd(cycleEndFrame, blockSize) {
  return Math.ceil(
    (cycleEndFrame + PHASE_B_RMS_WINDOW_FRAMES) / blockSize
  ) * blockSize;
}

export function buildPhaseBTransitionSchedule(
  sampleRate,
  blockSize = PHASE_B_BLOCK_SIZE
) {
  if (!Number.isInteger(sampleRate) || sampleRate < 1 ||
      !Number.isInteger(blockSize) || blockSize < 1) {
    throw new Error('Phase B reset transition schedule configuration is invalid');
  }
  const fadeOutFrames = frameCount(sampleRate, PHASE_B_FADE_OUT_MS);
  const warmupFrames = frameCount(sampleRate, PHASE_B_WARMUP_MS);
  const fadeInFrames = frameCount(sampleRate, PHASE_B_FADE_IN_MS);
  const cycleFrames = fadeOutFrames + warmupFrames + fadeInFrames;
  const event1Frame = frameCount(sampleRate, PHASE_B_EVENT1_MS);
  const event2Frame = frameCount(sampleRate, PHASE_B_EVENT2_MS);
  const activeEndFrame = frameCount(sampleRate, PHASE_B_ACTIVE_END_MS);
  const cycleFor = eventFrame => {
    const resetFrame = eventFrame + fadeOutFrames;
    const fadeInStartFrame = resetFrame + warmupFrames;
    const cycleEndFrame = fadeInStartFrame + fadeInFrames;
    return {
      eventFrame,
      fadeOutStartFrame: eventFrame,
      resetFrame,
      warmupStartFrame: resetFrame,
      fadeInStartFrame,
      cycleEndFrame,
      postStartFrame: cycleEndFrame,
      postEndFrame: postObservationEnd(cycleEndFrame, blockSize)
    };
  };
  const cycles = [cycleFor(event1Frame), cycleFor(event2Frame)];
  if (cycles[0].cycleEndFrame > event2Frame ||
      cycles[1].cycleEndFrame > activeEndFrame) {
    throw new Error('Phase B reset transition cycles overlap their absolute boundaries');
  }
  return {
    contract: PHASE_B_TRANSITION_CONTRACT,
    sampleRate,
    blockSize,
    fadeOutMilliseconds: PHASE_B_FADE_OUT_MS,
    warmupMilliseconds: PHASE_B_WARMUP_MS,
    fadeInMilliseconds: PHASE_B_FADE_IN_MS,
    fadeOutFrames,
    warmupFrames,
    fadeInFrames,
    cycleFrames,
    event1Frame,
    event2Frame,
    activeEndFrame,
    activeFrames: activeEndFrame,
    cycles
  };
}
