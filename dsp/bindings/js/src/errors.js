export class EffeTuneError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
    if (options?.code !== undefined) this.code = options.code;
    if (options?.path !== undefined) this.path = options.path;
    if (options?.nodeId !== undefined) this.nodeId = options.nodeId;
    if (options?.edgeId !== undefined) this.edgeId = options.edgeId;
  }
}

export class ValidationError extends EffeTuneError {}
export class EffectError extends EffeTuneError {}
export class AssetError extends EffeTuneError {}
export class EffeTuneRuntimeError extends EffeTuneError {}
export class StateError extends EffeTuneError {}

const ERROR_TYPES = Object.freeze({
  ValidationError,
  EffectError,
  AssetError,
  EffeTuneRuntimeError,
  StateError
});

export function errorMessage(error, fallback) {
  return error instanceof EffeTuneError
    ? { errorType: error.name, message: error.message }
    : { errorType: 'EffeTuneRuntimeError', message: fallback };
}

export function errorFromMessage(errorType, message, fallback) {
  const ErrorType = ERROR_TYPES[errorType] ?? EffeTuneRuntimeError;
  return new ErrorType(message || fallback);
}

// Chain-level validation reports the human-readable message; Graph document
// normalization needs the machine-readable cause to classify the failure. The
// detail rides on a symbol key so Chain behaviour, serialization and existing
// error shapes stay unchanged.
export const VALIDATION_DETAIL = Symbol.for('effetune.validationDetail');

export function withValidationDetail(error, detail) {
  if (error instanceof EffeTuneError && error[VALIDATION_DETAIL] === undefined) {
    error[VALIDATION_DETAIL] = detail;
  }
  return error;
}

export function validationDetail(error) {
  return error?.[VALIDATION_DETAIL];
}
