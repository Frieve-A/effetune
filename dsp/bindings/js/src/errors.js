export class EffeTuneError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
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
