export class LibraryRepositoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraryRepositoryError';
    this.code = code;
    this.details = details;
  }
}

export function createRepositoryError(code, message, details = {}) {
  return new LibraryRepositoryError(code, message, details);
}

export function assertRepositoryContract(condition, code, message, details = {}) {
  if (!condition) {
    throw createRepositoryError(code, message, details);
  }
}
