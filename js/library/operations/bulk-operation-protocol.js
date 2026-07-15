import { createRepositoryError } from '../repository/contract-errors.js';
import { validateSelectionDescriptor } from '../repository/selection-descriptor.js';
import { normalizeRelativePath } from '../constants.js';

export const CANONICAL_REQUEST_VERSION = 1;
export const BULK_OPERATION_KINDS = Object.freeze([
  'play',
  'playNext',
  'queue',
  'addToPlaylist',
  'importPlaylist'
]);

const DURABLE_START_FIELDS = Object.freeze([
  'clientRequestId',
  'expectedTargetVersion',
  'operationKind',
  'options',
  'selectionDescriptor',
  'target'
]);
const PLAYBACK_START_FIELDS = Object.freeze([
  'operationKind',
  'options',
  'selectionDescriptor',
  'target'
]);
const PLAYBACK_OPERATION_KINDS = new Set(['play', 'playNext', 'queue']);
const PROGRESS_FIELDS = Object.freeze([
  'operationId', 'phase', 'processed', 'sequence', 'state', 'total', 'updatedAt'
]);
const PROGRESS_PHASES = new Set(['received', 'snapshotting', 'materializing', 'ready', 'committing', 'terminal']);
const PROGRESS_STATES = new Set([
  'received',
  'running',
  'canceling',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted'
]);
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

export function validateBulkOperationStart(request) {
  assertPlainObject(request, 'invalidOperationRequest');
  if (!BULK_OPERATION_KINDS.includes(request.operationKind)) {
    throw createRepositoryError('invalidOperationKind', 'operationKind is not supported');
  }
  const playback = PLAYBACK_OPERATION_KINDS.has(request.operationKind);
  assertExactFields(
    request,
    playback ? PLAYBACK_START_FIELDS : DURABLE_START_FIELDS,
    'invalidOperationRequest'
  );
  if (!playback) {
    if (typeof request.clientRequestId !== 'string' || request.clientRequestId.length === 0 || request.clientRequestId.length > 128) {
      throw createRepositoryError('invalidOperationRequest', 'clientRequestId must contain 1 to 128 characters');
    }
    if (request.expectedTargetVersion !== null && (
      !Number.isSafeInteger(request.expectedTargetVersion) || request.expectedTargetVersion < 0
    )) {
      throw createRepositoryError('invalidOperationRequest', 'expectedTargetVersion must be null or a non-negative integer');
    }
  }
  assertPlainObject(request.target, 'invalidOperationRequest');
  assertPlainObject(request.options, 'invalidOperationRequest');
  const sequenceSave = request.operationKind === 'addToPlaylist' && request.options.sourceSequenceDescriptor !== undefined;
  const playlistImport = request.operationKind === 'importPlaylist';
  if (sequenceSave) {
    validateSequenceSaveDescriptor(request.options.sourceSequenceDescriptor);
  }
  if (playlistImport && request.selectionDescriptor !== null) {
    throw createRepositoryError('invalidOperationRequest', 'Playlist import must not include a catalog selection');
  }
  const selectionDescriptor = (sequenceSave || playlistImport) && request.selectionDescriptor === null
    ? null
    : validateSelectionDescriptor(request.selectionDescriptor);
  const canonical = {
    canonicalRequestVersion: CANONICAL_REQUEST_VERSION,
    operationKind: request.operationKind,
    selectionDescriptor,
    target: canonicalizeJson(request.target),
    options: playlistImport ? canonicalizeImportOptions(request.options) : canonicalizeJson(request.options)
  };
  if (!playback) {
    canonical.clientRequestId = request.clientRequestId;
    canonical.expectedTargetVersion = request.expectedTargetVersion;
  }
  return Object.freeze(canonical);
}

export function validateSequenceSaveDescriptor(value) {
  assertPlainObject(value, 'invalidOperationRequest');
  if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 256) {
    throw createRepositoryError('sequenceSegmentLimitExceeded', 'Playback sequence descriptor must contain 1 to 256 segments');
  }
  for (const segment of value.segments) {
    assertPlainObject(segment, 'invalidOperationRequest');
    const fields = Object.keys(segment).sort();
    const baseFields = ['endOrdinal', 'sequenceId', 'startOrdinal'];
    const shuffleFields = ['shuffleEpoch', 'shuffleSeed', 'shuffleTransportOffset'];
    const expected = fields.some(field => shuffleFields.includes(field))
      ? [...baseFields, ...shuffleFields].sort()
      : baseFields.sort();
    if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
      throw createRepositoryError('invalidOperationRequest', 'Playback sequence segment has unknown or incomplete fields');
    }
    if (typeof segment.sequenceId !== 'string' || segment.sequenceId.length < 1 || segment.sequenceId.length > 512 ||
        !Number.isSafeInteger(segment.startOrdinal) || segment.startOrdinal < 0 ||
        !Number.isSafeInteger(segment.endOrdinal) || segment.endOrdinal <= segment.startOrdinal) {
      throw createRepositoryError('invalidOperationRequest', 'Playback sequence segment bounds are invalid');
    }
    for (const field of shuffleFields) {
      if (segment[field] !== undefined && (!Number.isSafeInteger(segment[field]) ||
          (field === 'shuffleTransportOffset' && segment[field] < 0))) {
        throw createRepositoryError('invalidOperationRequest', 'Playback sequence shuffle state is invalid');
      }
    }
  }
  const descriptorShuffleFields = ['shuffleEpoch', 'shuffleSeed', 'shuffleTransportOffset'];
  const presentDescriptorShuffleFields = descriptorShuffleFields.filter(field => value[field] !== undefined);
  if (presentDescriptorShuffleFields.length !== 0 && presentDescriptorShuffleFields.length !== descriptorShuffleFields.length) {
    throw createRepositoryError('invalidOperationRequest', 'Playback descriptor shuffle state is incomplete');
  }
  for (const field of descriptorShuffleFields) {
    if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) ||
        (field === 'shuffleTransportOffset' && value[field] < 0))) {
      throw createRepositoryError('invalidOperationRequest', 'Playback descriptor shuffle state is invalid');
    }
  }
  return value;
}

export async function digestBulkOperationRequest(request, cryptoApi = globalThis.crypto) {
  const canonical = validateBulkOperationStart(request);
  if (!cryptoApi?.subtle) {
    throw createRepositoryError('cryptoUnavailable', 'SHA-256 is unavailable');
  }
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalizeJson(canonical)));
  const digest = await cryptoApi.subtle.digest('SHA-256', encoded);
  return {
    canonical,
    requestDigest: `sha256:${bytesToHex(new Uint8Array(digest))}`,
    runtime: canonical.operationKind === 'importPlaylist'
      ? Object.freeze({ source: request.options.source })
      : null
  };
}

function canonicalizeImportOptions(options) {
  assertPlainObject(options, 'invalidOperationRequest');
  const actual = Object.keys(options).sort();
  const expected = ['encoding', 'limits', 'name', 'source'];
  const expectedAutomatic = [...expected, 'automaticSource'].sort();
  if (!sameFields(actual, expected) && !sameFields(actual, expectedAutomatic)) {
    throw createRepositoryError('invalidOperationRequest', 'Playlist import options have unknown or missing fields');
  }
  if (typeof options.name !== 'string' || options.name.length < 1 || options.name.length > 4096) {
    throw createRepositoryError('invalidOperationRequest', 'Playlist import name must contain 1 to 4096 characters');
  }
  const source = options.source;
  let canonicalSource;
  if (source && typeof source.stream === 'function' && typeof source.name === 'string' && Number.isSafeInteger(source.size)) {
    canonicalSource = {
      kind: 'web-file',
      name: source.name.slice(0, 4096),
      size: source.size,
      lastModified: Number.isSafeInteger(source.lastModified) ? source.lastModified : 0,
      type: String(source.type ?? '').slice(0, 1024)
    };
  } else if (source?.kind === 'electron-import-grant') {
    assertPlainObject(source, 'invalidOperationRequest');
    assertExactFields(
      source,
      ['kind', 'lastModified', 'name', 'size', 'token', 'type'],
      'invalidOperationRequest'
    );
    if (typeof source.token !== 'string' || source.token.length < 1 || source.token.length > 512 ||
        typeof source.name !== 'string' || source.name.length < 1 || source.name.length > 4096 ||
        !Number.isSafeInteger(source.size) || source.size < 0 ||
        !Number.isSafeInteger(source.lastModified) || source.lastModified < 0 ||
        typeof source.type !== 'string' || source.type.length > 1024) {
      throw createRepositoryError('invalidOperationRequest', 'Electron playlist import grant is invalid');
    }
    canonicalSource = canonicalizeJson(source);
  } else {
    throw createRepositoryError('invalidOperationRequest', 'Playlist import source is invalid');
  }
  return Object.freeze({
    automaticSource: canonicalizeAutomaticPlaylistSource(options.automaticSource ?? null),
    encoding: options.encoding === null ? null : canonicalizeJson(options.encoding),
    limits: options.limits === null ? null : canonicalizeJson(options.limits),
    name: options.name,
    source: Object.freeze(canonicalSource)
  });
}

function canonicalizeAutomaticPlaylistSource(value) {
  if (value === null) return null;
  assertPlainObject(value, 'invalidOperationRequest');
  assertExactFields(value, ['contentDigest', 'folderId', 'relativePath'], 'invalidOperationRequest');
  if (typeof value.folderId !== 'string' || value.folderId.length < 1 || value.folderId.length > 512 ||
      typeof value.relativePath !== 'string' || value.relativePath.length < 1 || value.relativePath.length > 32768 ||
      typeof value.contentDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.contentDigest)) {
    throw createRepositoryError('invalidOperationRequest', 'Automatic playlist source is invalid');
  }
  const relativePath = normalizeRelativePath(value.relativePath).normalize('NFC');
  if (!relativePath || relativePath.split('/').some(part => part === '..')) {
    throw createRepositoryError('invalidOperationRequest', 'Automatic playlist source path is invalid');
  }
  return Object.freeze({
    folderId: value.folderId,
    relativePath,
    contentDigest: value.contentDigest
  });
}

function sameFields(actual, expected) {
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((field, index) => field === sorted[index]);
}

export class OperationProgressFence {
  constructor(operationId) {
    if (typeof operationId !== 'string' || operationId.length === 0) {
      throw new TypeError('operationId must be a non-empty string');
    }
    this.operationId = operationId;
    this.sequence = -1;
    this.state = 'received';
  }

  accept(event) {
    assertPlainObject(event, 'invalidProgress');
    assertExactFields(event, PROGRESS_FIELDS, 'invalidProgress');
    if (event.operationId !== this.operationId) return false;
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= this.sequence) return false;
    if (TERMINAL_STATES.has(this.state)) return false;
    if (!PROGRESS_PHASES.has(event.phase) || !PROGRESS_STATES.has(event.state)) return false;
    if (TERMINAL_STATES.has(event.state) !== (event.phase === 'terminal')) return false;
    if (!Number.isSafeInteger(event.processed) || event.processed < 0) return false;
    if (event.total !== null && (!Number.isSafeInteger(event.total) || event.total < event.processed)) return false;
    if (!Number.isSafeInteger(event.updatedAt) || event.updatedAt < 0) return false;
    this.sequence = event.sequence;
    this.state = event.state;
    return true;
  }

  get terminal() {
    return TERMINAL_STATES.has(this.state);
  }
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw createRepositoryError('invalidOperationRequest', 'Operation request contains an unsupported value');
    }
    return Object.fromEntries(Object.keys(value).sort().map(key => {
      if (value[key] === undefined) {
        throw createRepositoryError('invalidOperationRequest', 'Operation request cannot contain undefined');
      }
      return [key, canonicalizeJson(value[key])];
    }));
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  throw createRepositoryError('invalidOperationRequest', 'Operation request contains an unsupported value');
}

function bytesToHex(bytes) {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function assertPlainObject(value, code) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (!value || Array.isArray(value) || (prototype !== Object.prototype && prototype !== null)) {
    throw createRepositoryError(code, 'Value must be a plain object');
  }
}

function assertExactFields(value, fields, code) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw createRepositoryError(code, 'Operation request has unknown or missing fields', { actual, expected });
  }
}
