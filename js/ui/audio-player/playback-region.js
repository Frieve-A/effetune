const CUE_FRAMES_PER_SECOND = 75;
const MEDIA_DURATION_TOLERANCE_SECONDS = 1 / CUE_FRAMES_PER_SECOND;

export function hasPlaybackRegionDescriptor(track) {
  if (!track) return false;
  const startFrame = track.startFrame;
  const endFrame = track.endFrame;
  if ((startFrame === null || startFrame === undefined) &&
      (endFrame === null || endFrame === undefined)) return false;
  return Object.prototype.hasOwnProperty.call(track, 'startFrame') ||
    Object.prototype.hasOwnProperty.call(track, 'endFrame');
}

export function getPlaybackRegion(track) {
  if (!hasPlaybackRegionDescriptor(track)) return null;

  const startFrame = track.startFrame;
  const endFrame = track.endFrame;
  const durationSec = track.durationSec;
  if (!Number.isSafeInteger(startFrame) || startFrame < 0 ||
      !(endFrame === null || (Number.isSafeInteger(endFrame) && endFrame > startFrame)) ||
      !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError('Playback region descriptor is invalid');
  }

  return Object.freeze({ startFrame, endFrame, durationSec });
}

export function frameToMediaTime(frame) {
  return frame / CUE_FRAMES_PER_SECOND;
}

export function getRegionStartTime(region) {
  return region ? frameToMediaTime(region.startFrame) : 0;
}

export function getRegionEndTime(region) {
  return !region || region.endFrame === null ? null : frameToMediaTime(region.endFrame);
}

export function clampLogicalTime(region, time) {
  const numericTime = Number.isFinite(time) ? time : 0;
  if (!region) return Math.max(0, numericTime);
  return Math.max(0, Math.min(numericTime, region.durationSec));
}

export function mediaTimeToLogicalTime(region, mediaTime) {
  if (!region) return Math.max(0, Number.isFinite(mediaTime) ? mediaTime : 0);
  return clampLogicalTime(region, mediaTime - getRegionStartTime(region));
}

export function logicalTimeToMediaTime(region, logicalTime) {
  if (!region) return Math.max(0, Number.isFinite(logicalTime) ? logicalTime : 0);
  return getRegionStartTime(region) + clampLogicalTime(region, logicalTime);
}

export function isRegionPlayableInMedia(region, mediaDuration) {
  if (!region || !Number.isFinite(mediaDuration) || mediaDuration <= 0) return false;
  const startTime = getRegionStartTime(region);
  const endTime = getRegionEndTime(region);
  if (startTime >= mediaDuration) return false;
  if (endTime !== null) return endTime <= mediaDuration;

  const persistedPhysicalEnd = startTime + region.durationSec;
  return Math.abs(persistedPhysicalEnd - mediaDuration) <= MEDIA_DURATION_TOLERANCE_SECONDS;
}

export function getExplicitPhysicalSourceKey(track) {
  for (const key of ['physicalSourceKey', 'canonicalSourceKey', 'sourceKey']) {
    const value = track?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function getPlaybackPhysicalSourceKey(track) {
  const explicitKey = getExplicitPhysicalSourceKey(track);
  if (explicitKey) return explicitKey;
  if (track?.sourceKind === 'electron-file' && typeof track.path === 'string' && track.path.length > 0) {
    return `electron-file:${track.path}`;
  }
  return null;
}
