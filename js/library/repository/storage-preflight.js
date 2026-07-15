import { assertRepositoryContract, createRepositoryError } from './contract-errors.js';

export const MEBIBYTE = 1024 * 1024;
export const GIBIBYTE = 1024 * MEBIBYTE;
export const MIN_STORAGE_SAFETY_FLOOR_BYTES = 256 * MEBIBYTE;
export const MAX_STORAGE_SAFETY_FLOOR_BYTES = 8 * GIBIBYTE;

export function calculateStorageSafetyFloor(capacityBytes) {
  assertByteCount(capacityBytes, 'capacityBytes', false);
  return Math.max(
    MIN_STORAGE_SAFETY_FLOOR_BYTES,
    Math.min(MAX_STORAGE_SAFETY_FLOOR_BYTES, Math.floor(capacityBytes * 0.1))
  );
}

export function checkStoragePreflight({
  capacityBytes,
  availableBytes,
  worstCaseBatchWriteBytes,
  estimatedRequiredBytes = 0
}) {
  assertByteCount(capacityBytes, 'capacityBytes', false);
  assertByteCount(availableBytes, 'availableBytes');
  assertByteCount(worstCaseBatchWriteBytes, 'worstCaseBatchWriteBytes');
  assertByteCount(estimatedRequiredBytes, 'estimatedRequiredBytes');
  assertRepositoryContract(availableBytes <= capacityBytes, 'invalidStorageEstimate', 'availableBytes cannot exceed capacityBytes');

  const safetyFloorBytes = calculateStorageSafetyFloor(capacityBytes);
  const operationRequirementBytes = Math.max(worstCaseBatchWriteBytes, estimatedRequiredBytes);
  const requiredAvailableBytes = safetyFloorBytes + operationRequirementBytes;
  assertRepositoryContract(Number.isSafeInteger(requiredAvailableBytes), 'invalidStorageEstimate', 'Storage requirement exceeds the supported integer range');
  return Object.freeze({
    ok: availableBytes >= requiredAvailableBytes,
    capacityBytes,
    availableBytes,
    safetyFloorBytes,
    worstCaseBatchWriteBytes,
    estimatedRequiredBytes,
    requiredAvailableBytes,
    shortfallBytes: Math.max(0, requiredAvailableBytes - availableBytes)
  });
}

export function assertStoragePreflight(input) {
  const result = checkStoragePreflight(input);
  if (!result.ok) {
    throw createRepositoryError('insufficientStorage', 'There is not enough storage for this operation', result);
  }
  return result;
}

function assertByteCount(value, field, allowZero = true) {
  const minimum = allowZero ? 0 : 1;
  assertRepositoryContract(Number.isSafeInteger(value) && value >= minimum, 'invalidStorageEstimate', `${field} must be a safe integer of at least ${minimum}`);
}
