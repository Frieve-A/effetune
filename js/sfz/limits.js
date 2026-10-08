export const SFZ_SIZE_LIMIT_MIB_OPTIONS = Object.freeze([64, 128, 256, 512, 1024]);
export const SFZ_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
export const SFZ_MAX_SUPPORTED_BYTES = 1024 * 1024 * 1024;

export function normalizeSfzSizeLimitMiB(value) {
  return SFZ_SIZE_LIMIT_MIB_OPTIONS.includes(value) ? value : SFZ_DEFAULT_MAX_BYTES / (1024 * 1024);
}

export function getSfzMaxBytes(value) {
  return normalizeSfzSizeLimitMiB(value) * 1024 * 1024;
}

export function requireSfzMaxBytes(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > SFZ_MAX_SUPPORTED_BYTES) {
    throw new RangeError('Invalid SFZ size limit.');
  }
  return value;
}
