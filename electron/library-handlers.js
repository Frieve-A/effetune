const fs = require('fs');
const path = require('path');

const defaultScanner = require('./library-scanner');

const MAX_ACTIVE_LIBRARY_SCANS = 2;
const MAX_LIBRARY_FOLDERS_MIRROR_BYTES = 256 * 1024;
const MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS = 512;
const MAX_LIBRARY_FOLDERS_MIRROR_STRING_LENGTH = 8192;
const MAX_LIBRARY_VALIDATE_ROOTS = 128;
const MAX_LIBRARY_VALIDATE_CONCURRENCY = 8;
const MAX_LIBRARY_SCAN_ID_LENGTH = 128;
const MAX_LIBRARY_SCAN_ROOTS = 128;
const MAX_LIBRARY_SCAN_KNOWN_FILES = 100000;
const MAX_LIBRARY_SCAN_STRING_LENGTH = 8192;
const MAX_LIBRARY_LANGUAGE_HINT_STRING_LENGTH = 64;
const MAX_LIBRARY_LANGUAGE_HINTS = 8;
const MAX_LIBRARY_READ_FILE_BYTES = defaultScanner.MAX_READ_FILE_BYTES || 256 * 1024 * 1024;
const MAX_LIBRARY_READ_ARTWORK_BYTES = defaultScanner.MAX_ARTWORK_BYTES || 20 * 1024 * 1024;
const MAX_LIBRARY_READ_GLOBAL_CONCURRENCY = 8;
const MAX_LIBRARY_READ_SENDER_CONCURRENCY = 4;
const MAX_LIBRARY_READ_GLOBAL_ACTIVE_BYTES = MAX_LIBRARY_READ_FILE_BYTES * 2;
const MAX_LIBRARY_READ_SENDER_ACTIVE_BYTES = MAX_LIBRARY_READ_FILE_BYTES;

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function getElectronDependency(dependencies, name) {
  if (dependencies && dependencies[name]) return dependencies[name];
  return require('electron')[name];
}

function getMainWindowProvider(dependencies) {
  if (dependencies && typeof dependencies.getMainWindow === 'function') {
    return dependencies.getMainWindow;
  }

  return () => {
    try {
      return require('./constants').getMainWindow();
    } catch {
      return null;
    }
  };
}

function normalizePathList(paths, {
  maxItems = MAX_LIBRARY_VALIDATE_ROOTS,
  maxStringLength = MAX_LIBRARY_SCAN_STRING_LENGTH
} = {}) {
  if (!Array.isArray(paths)) return [];
  const normalizedPaths = [];
  const inputLimit = paths.length < maxItems ? paths.length : maxItems;
  for (let index = 0; index < inputLimit; index += 1) {
    const item = paths[index];
    if (typeof item !== 'string' || item.trim() === '' || item.length > maxStringLength) continue;
    normalizedPaths.push(path.resolve(item));
  }
  return normalizedPaths;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = items.length < concurrency ? items.length : concurrency;
  const workers = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push((async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

async function validateRoot(rootPath) {
  const resolvedPath = path.resolve(rootPath);
  let exists = false;
  let readable = false;
  let isDirectory = false;
  let error = null;

  try {
    const stat = await fs.promises.stat(resolvedPath);
    exists = true;
    isDirectory = stat.isDirectory();
    if (isDirectory) {
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
      readable = true;
    }
  } catch (validationError) {
    error = validationError && validationError.message ? validationError.message : String(validationError);
    if (validationError && (validationError.code === 'EACCES' || validationError.code === 'EPERM')) {
      exists = true;
    }
  }

  return {
    path: resolvedPath,
    exists,
    readable,
    isDirectory,
    error
  };
}

function toScanErrorEvent(scanId, error) {
  const canceled = defaultScanner.isAbortError(error);
  return {
    scanId,
    type: 'error',
    fatal: !canceled,
    canceled,
    reason: error && error.message ? error.message : String(error || 'Unknown scan error')
  };
}

function classifyScanRootError(error) {
  const code = error && error.code ? error.code : '';
  if (code === 'ENOENT') return 'missing';
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOTDIR') return 'not-directory';

  const reason = error && error.message ? error.message : String(error || '');
  if (/No library folder has been selected|outside the selected music library folders/i.test(reason)) {
    return 'permission-denied';
  }
  return 'filesystem-error';
}

function toFolderScanErrorEvent(scanId, root, error, fatal = false) {
  const event = {
    scanId,
    type: 'error',
    fatal,
    folderId: root?.folderId || root?.id || null,
    path: root?.path || null,
    reason: error && error.message ? error.message : String(error || 'Unknown scan error'),
    category: classifyScanRootError(error)
  };
  if (error && error.code) {
    event.code = error.code;
  }
  return event;
}

function isDestroyedTarget(target) {
  return !!(target && typeof target.isDestroyed === 'function' && target.isDestroyed());
}

function createEventSender(ipcEvent, getMainWindow) {
  return payload => {
    if (ipcEvent && ipcEvent.sender && typeof ipcEvent.sender.send === 'function') {
      // Drop events silently once the originating window is gone.
      if (!isDestroyedTarget(ipcEvent.sender)) {
        ipcEvent.sender.send('library-scan-event', payload);
      }
      return;
    }

    const mainWindow = getMainWindow();
    if (mainWindow && !isDestroyedTarget(mainWindow)
      && mainWindow.webContents && typeof mainWindow.webContents.send === 'function'
      && !isDestroyedTarget(mainWindow.webContents)) {
      mainWindow.webContents.send('library-scan-event', payload);
    }
  };
}

function createScanRequestLimitError(message) {
  const error = new Error(message);
  error.code = 'ERR_LIBRARY_SCAN_REQUEST_LIMIT';
  return error;
}

function assertScanStringLimit(value, field) {
  if (typeof value === 'string' && value.length > MAX_LIBRARY_SCAN_STRING_LENGTH) {
    throw createScanRequestLimitError(`${field} is too long`);
  }
}

function getSafeScanIdForResponse(request) {
  if (!request || typeof request !== 'object' || typeof request.scanId !== 'string') return null;
  const scanId = request.scanId.trim();
  return scanId && scanId.length <= MAX_LIBRARY_SCAN_ID_LENGTH ? scanId : null;
}

function normalizeScanId(request) {
  if (typeof request.scanId !== 'string' || request.scanId.trim() === '') {
    return `scan_${Date.now().toString(36)}`;
  }

  const scanId = request.scanId.trim();
  if (scanId.length > MAX_LIBRARY_SCAN_ID_LENGTH) {
    throw createScanRequestLimitError('scanId is too long');
  }
  return scanId;
}

function normalizeScanRoot(root, index) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  if (typeof root.path !== 'string' || root.path.trim() === '') return null;
  assertScanStringLimit(root.path, `roots[${index}].path`);

  const normalizedRoot = { path: root.path };
  if (typeof root.folderId === 'string' && root.folderId.trim() !== '') {
    assertScanStringLimit(root.folderId, `roots[${index}].folderId`);
    normalizedRoot.folderId = root.folderId;
  }
  if (typeof root.id === 'string' && root.id.trim() !== '') {
    assertScanStringLimit(root.id, `roots[${index}].id`);
    normalizedRoot.id = root.id;
  }
  return normalizedRoot;
}

function normalizeScanRoots(roots) {
  if (!Array.isArray(roots)) return [];
  if (roots.length > MAX_LIBRARY_SCAN_ROOTS) {
    throw createScanRequestLimitError(`Library scan supports at most ${MAX_LIBRARY_SCAN_ROOTS} roots`);
  }
  const normalizedRoots = [];
  for (let index = 0; index < roots.length; index += 1) {
    const normalizedRoot = normalizeScanRoot(roots[index], index);
    if (normalizedRoot) normalizedRoots.push(normalizedRoot);
  }
  return normalizedRoots;
}

function normalizeKnownFile(file, index) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return null;
  if (typeof file.folderId !== 'string' || file.folderId.trim() === '') return null;
  if (typeof file.relativePath !== 'string' || file.relativePath.trim() === '') return null;
  assertScanStringLimit(file.folderId, `knownFiles[${index}].folderId`);
  assertScanStringLimit(file.relativePath, `knownFiles[${index}].relativePath`);
  const size = Number(file.size);
  const mtimeMs = Number(file.mtimeMs);
  if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) return null;

  const normalizedFile = {
    folderId: file.folderId,
    relativePath: file.relativePath,
    size,
    mtimeMs
  };
  if (typeof file.trackId === 'string' && file.trackId.trim() !== '') {
    assertScanStringLimit(file.trackId, `knownFiles[${index}].trackId`);
    normalizedFile.trackId = file.trackId;
  }
  if (typeof file.artworkId === 'string' && file.artworkId.trim() !== '') {
    assertScanStringLimit(file.artworkId, `knownFiles[${index}].artworkId`);
    normalizedFile.artworkId = file.artworkId;
  }
  return normalizedFile;
}

function normalizeKnownFiles(knownFiles) {
  if (!Array.isArray(knownFiles)) return [];
  if (knownFiles.length > MAX_LIBRARY_SCAN_KNOWN_FILES) {
    throw createScanRequestLimitError(`Library scan supports at most ${MAX_LIBRARY_SCAN_KNOWN_FILES} known files`);
  }
  const normalizedFiles = [];
  for (let index = 0; index < knownFiles.length; index += 1) {
    const normalizedFile = normalizeKnownFile(knownFiles[index], index);
    if (normalizedFile) normalizedFiles.push(normalizedFile);
  }
  return normalizedFiles;
}

function normalizeLanguageHintString(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > MAX_LIBRARY_LANGUAGE_HINT_STRING_LENGTH) return '';
  return text;
}

function normalizeLanguageHints(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {};
  for (const field of ['language', 'languagePreference', 'browserLanguage']) {
    const text = normalizeLanguageHintString(value[field]);
    if (text) normalized[field] = text;
  }
  if (Array.isArray(value.browserLanguages)) {
    const browserLanguages = [];
    const limit = value.browserLanguages.length < MAX_LIBRARY_LANGUAGE_HINTS
      ? value.browserLanguages.length
      : MAX_LIBRARY_LANGUAGE_HINTS;
    for (let index = 0; index < limit; index += 1) {
      const text = normalizeLanguageHintString(value.browserLanguages[index]);
      if (text) browserLanguages.push(text);
    }
    if (browserLanguages.length > 0) normalized.browserLanguages = browserLanguages;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function copyScanOption(target, source, field) {
  if (hasOwn(source, field)) target[field] = source[field];
}

function normalizeScanRequest(request = {}) {
  const source = request && typeof request === 'object' ? request : {};
  const scanId = normalizeScanId(source);
  const normalizedRequest = {
    scanId,
    roots: normalizeScanRoots(source.roots),
    knownFiles: normalizeKnownFiles(source.knownFiles)
  };
  for (const field of [
    'concurrency',
    'batchSize',
    'seenFilesBatchSize',
    'batchIntervalMs',
    'maxBatchArtworkBytes',
    'maxFolderArtworkCacheBytes',
    'parseFileTimeoutMs',
    'maxArtworkBytes',
    'skipCovers'
  ]) {
    copyScanOption(normalizedRequest, source, field);
  }
  const languageHints = normalizeLanguageHints(source.languageHints);
  if (languageHints) normalizedRequest.languageHints = languageHints;
  return normalizedRequest;
}

function normalizeReadFileRequest(request) {
  if (typeof request === 'string') {
    return { path: request, offset: 0, length: undefined, maxBytes: undefined };
  }
  return {
    path: request && request.path,
    offset: request && request.offset,
    length: request && request.length,
    maxBytes: request && request.maxBytes
  };
}

function normalizeReadArtworkRequest(request) {
  if (typeof request === 'string') {
    return { path: request, parseFileTimeoutMs: undefined };
  }
  return {
    path: request && request.path,
    parseFileTimeoutMs: request && request.parseFileTimeoutMs
  };
}

function normalizeReadBudgetByteOption(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error('Byte offset, length, and maxBytes must be non-negative safe integers');
  }
  return number;
}

function estimateReadFileActiveBytes(readRequest) {
  const maxBytes = normalizeReadBudgetByteOption(readRequest.maxBytes, MAX_LIBRARY_READ_FILE_BYTES);
  const cappedMaxBytes = maxBytes > MAX_LIBRARY_READ_FILE_BYTES ? MAX_LIBRARY_READ_FILE_BYTES : maxBytes;
  if (readRequest.length === undefined || readRequest.length === null) return cappedMaxBytes;
  const length = normalizeReadBudgetByteOption(readRequest.length, 0);
  return length < cappedMaxBytes ? length : cappedMaxBytes;
}

function createLibraryReadBudgetError(message) {
  const error = new Error(message);
  error.code = 'ERR_LIBRARY_READ_BUDGET';
  return error;
}

function createReadBudgetTracker() {
  const anonymousSender = {};
  const senderStates = new WeakMap();
  const globalState = { active: 0, bytes: 0 };

  function getSenderState(sender) {
    const senderKey = sender && (typeof sender === 'object' || typeof sender === 'function')
      ? sender
      : anonymousSender;
    let state = senderStates.get(senderKey);
    if (!state) {
      state = { active: 0, bytes: 0 };
      senderStates.set(senderKey, state);
    }
    return state;
  }

  function acquire(sender, activeBytes, operation) {
    const bytes = activeBytes > 0 ? activeBytes : 0;
    const senderState = getSenderState(sender);
    if (globalState.active >= MAX_LIBRARY_READ_GLOBAL_CONCURRENCY) {
      throw createLibraryReadBudgetError(`Too many library ${operation} requests are already active`);
    }
    if (senderState.active >= MAX_LIBRARY_READ_SENDER_CONCURRENCY) {
      throw createLibraryReadBudgetError(`Too many library ${operation} requests are already active for this window`);
    }
    if (globalState.bytes + bytes > MAX_LIBRARY_READ_GLOBAL_ACTIVE_BYTES) {
      throw createLibraryReadBudgetError(`Library ${operation} requests exceed the global active byte budget`);
    }
    if (senderState.bytes + bytes > MAX_LIBRARY_READ_SENDER_ACTIVE_BYTES) {
      throw createLibraryReadBudgetError(`Library ${operation} requests exceed the active byte budget for this window`);
    }

    globalState.active += 1;
    globalState.bytes += bytes;
    senderState.active += 1;
    senderState.bytes += bytes;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      globalState.active -= 1;
      globalState.bytes -= bytes;
      senderState.active -= 1;
      senderState.bytes -= bytes;
      if (globalState.bytes < 0) globalState.bytes = 0;
      if (senderState.bytes < 0) senderState.bytes = 0;
    };
  }

  return { acquire };
}

async function runWithReadBudget(readBudgets, sender, activeBytes, operation, callback) {
  const release = readBudgets.acquire(sender, activeBytes, operation);
  try {
    return await callback();
  } finally {
    release();
  }
}

function assertSupportedAudioReadPath(filePath, operation) {
  if (!defaultScanner.isSupportedAudioFile(filePath)) {
    throw new Error(`${operation} requires a supported audio file`);
  }
}

function getLibraryFoldersMirrorPath(app, dependencies = {}) {
  const userDataPath = typeof dependencies.getUserDataPath === 'function'
    ? dependencies.getUserDataPath()
    : app.getPath('userData');
  return path.join(userDataPath, 'library-folders.json');
}

function normalizeMirrorString(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (value.length > MAX_LIBRARY_FOLDERS_MIRROR_STRING_LENGTH) return null;
  return value;
}

function normalizeMirrorPath(value) {
  const stringValue = normalizeMirrorString(value);
  return stringValue ? path.resolve(stringValue) : null;
}

function normalizeMirrorTimestamp(value) {
  if (Number.isFinite(value)) return value;
  return normalizeMirrorString(value);
}

function normalizeMirrorStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stats = {};
  let count = 0;
  for (const key in value) {
    if (!hasOwn(value, key)) continue;
    const item = value[key];
    const normalizedKey = normalizeMirrorString(key);
    if (!normalizedKey) continue;
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean' && item !== null) continue;
    if (typeof item === 'string' && item.length > MAX_LIBRARY_FOLDERS_MIRROR_STRING_LENGTH) continue;
    stats[normalizedKey] = item;
    count += 1;
    if (count >= 32) break;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}

function normalizeFolderRequest(folder) {
  if (!folder || typeof folder !== 'object' || Array.isArray(folder)) return null;
  const hasPath = hasOwn(folder, 'path') && folder.path !== null && folder.path !== undefined;
  const folderPath = normalizeMirrorPath(folder.path);
  if (hasPath && !folderPath) return null;
  return {
    id: normalizeMirrorString(folder.id),
    kind: normalizeMirrorString(folder.kind),
    displayName: normalizeMirrorString(folder.displayName),
    path: folderPath,
    addedAt: normalizeMirrorTimestamp(folder.addedAt),
    lastScanAt: normalizeMirrorTimestamp(folder.lastScanAt),
    lastScanStats: normalizeMirrorStats(folder.lastScanStats),
    status: normalizeMirrorString(folder.status) || 'unknown'
  };
}

function normalizeFolderRequestList(folders) {
  if (!Array.isArray(folders)) return [];
  const normalizedFolders = [];
  const inputLimit = folders.length < MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS
    ? folders.length
    : MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS;
  for (let index = 0; index < inputLimit; index += 1) {
    const normalizedFolder = normalizeFolderRequest(folders[index]);
    if (normalizedFolder) normalizedFolders.push(normalizedFolder);
  }
  return normalizedFolders;
}

async function getCanonicalMirrorPath(folderPath) {
  if (!folderPath) return null;
  try {
    return await fs.promises.realpath(folderPath);
  } catch {
    return null;
  }
}

async function serializeFolderForMirror(folder = {}) {
  const folderPath = normalizeMirrorPath(folder.path);
  const serialized = {
    id: normalizeMirrorString(folder.id),
    kind: normalizeMirrorString(folder.kind),
    displayName: normalizeMirrorString(folder.displayName),
    path: folderPath,
    addedAt: normalizeMirrorTimestamp(folder.addedAt),
    lastScanAt: normalizeMirrorTimestamp(folder.lastScanAt),
    lastScanStats: normalizeMirrorStats(folder.lastScanStats),
    status: normalizeMirrorString(folder.status) || 'unknown'
  };
  const canonicalPath = await getCanonicalMirrorPath(folderPath);
  if (canonicalPath) {
    serialized.canonicalPath = canonicalPath;
  }
  return serialized;
}

function sanitizeFolderFromMirror(folder) {
  if (!folder || typeof folder !== 'object' || Array.isArray(folder)) return null;
  return {
    id: normalizeMirrorString(folder.id),
    kind: normalizeMirrorString(folder.kind),
    displayName: normalizeMirrorString(folder.displayName),
    path: normalizeMirrorPath(folder.path),
    canonicalPath: normalizeMirrorPath(folder.canonicalPath),
    addedAt: normalizeMirrorTimestamp(folder.addedAt),
    lastScanAt: normalizeMirrorTimestamp(folder.lastScanAt),
    lastScanStats: normalizeMirrorStats(folder.lastScanStats),
    status: normalizeMirrorString(folder.status) || 'unknown'
  };
}

function sanitizeFoldersFromMirror(folders) {
  if (!Array.isArray(folders)) return [];
  const sanitized = [];
  for (const folder of folders) {
    const sanitizedFolder = sanitizeFolderFromMirror(folder);
    if (sanitizedFolder) sanitized.push(sanitizedFolder);
    if (sanitized.length >= MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS) break;
  }
  return sanitized;
}

function createMirrorLimitError(mirrorPath, size) {
  const error = new Error(`Library folder mirror is too large (${size} bytes)`);
  error.code = 'ERR_LIBRARY_FOLDERS_MIRROR_TOO_LARGE';
  error.path = mirrorPath;
  error.size = size;
  error.maxBytes = MAX_LIBRARY_FOLDERS_MIRROR_BYTES;
  return error;
}

function createNotFileError(filePath) {
  const error = new Error(`${filePath} is not a file`);
  error.code = 'EISDIR';
  return error;
}

async function readTextFileWithSizeLimit(filePath, maxBytes) {
  const initialStat = await fs.promises.stat(filePath);
  if (!initialStat.isFile()) {
    const error = new Error(`${filePath} is not a file`);
    error.code = 'EISDIR';
    throw error;
  }
  if (initialStat.size > maxBytes) {
    throw createMirrorLimitError(filePath, initialStat.size);
  }

  const fileHandle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fileHandle.stat();
    if (!stat.isFile()) {
      const error = new Error(`${filePath} is not a file`);
      error.code = 'EISDIR';
      throw error;
    }
    if (stat.size > maxBytes) {
      throw createMirrorLimitError(filePath, stat.size);
    }
    if (stat.size === 0) return '';

    const buffer = Buffer.allocUnsafe(stat.size);
    let bytesRead = 0;
    while (bytesRead < stat.size) {
      const result = await fileHandle.read(buffer, bytesRead, stat.size - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }

    const finalStat = await fileHandle.stat();
    if (finalStat.size > maxBytes) {
      throw createMirrorLimitError(filePath, finalStat.size);
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fileHandle.close();
  }
}

async function writeLibraryFoldersMirror(app, folders, dependencies = {}) {
  const mirrorPath = getLibraryFoldersMirrorPath(app, dependencies);
  const serializedFolders = [];
  if (Array.isArray(folders)) {
    for (const folder of folders) {
      serializedFolders.push(await serializeFolderForMirror(folder));
      if (serializedFolders.length >= MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS) break;
    }
  }
  const payload = {
    version: 2,
    updatedAt: Date.now(),
    folders: serializedFolders
  };
  const content = JSON.stringify(payload, null, 2);
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_LIBRARY_FOLDERS_MIRROR_BYTES) {
    throw createMirrorLimitError(mirrorPath, byteLength);
  }
  await fs.promises.mkdir(path.dirname(mirrorPath), { recursive: true });
  const temporaryPath = `${mirrorPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, 'utf8');
  try {
    await fs.promises.copyFile(mirrorPath, `${mirrorPath}.bak`);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  await fs.promises.rename(temporaryPath, mirrorPath);
  return { success: true, path: mirrorPath, count: payload.folders.length, folders: payload.folders };
}

async function readLibraryFoldersMirror(app, dependencies = {}) {
  const mirrorPath = getLibraryFoldersMirrorPath(app, dependencies);
  try {
    const content = await readTextFileWithSizeLimit(mirrorPath, MAX_LIBRARY_FOLDERS_MIRROR_BYTES);
    const parsed = JSON.parse(content);
    return {
      success: true,
      path: mirrorPath,
      folders: sanitizeFoldersFromMirror(parsed?.folders),
      updatedAt: parsed?.updatedAt || null
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { success: true, path: mirrorPath, folders: [], updatedAt: null };
    }
    return {
      success: false,
      path: mirrorPath,
      folders: [],
      updatedAt: null,
      error: error && error.message ? error.message : String(error)
    };
  }
}

function registerLibraryIpcHandlers(ipcMain, dependencies = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('registerLibraryIpcHandlers requires an ipcMain-like object');
  }

  const app = getElectronDependency(dependencies, 'app');
  const dialog = getElectronDependency(dependencies, 'dialog');
  const shell = getElectronDependency(dependencies, 'shell');
  const scanner = dependencies.scanner || defaultScanner;
  const getMainWindow = getMainWindowProvider(dependencies);
  const activeScans = new Map();
  const pendingScanStarts = new Map();
  const readBudgets = createReadBudgetTracker();
  const allowedRoots = new Set();
  let mirrorHydrationAttempted = false;

  function normalizeForComparison(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  function isInsideOrSamePath(candidatePath, rootPath) {
    const relativePath = path.relative(rootPath, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  }

  async function addAllowedRoot(rootSet, rootPath) {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') return null;
    const resolvedPath = path.resolve(rootPath);
    rootSet.add(normalizeForComparison(resolvedPath));
    try {
      rootSet.add(normalizeForComparison(await fs.promises.realpath(resolvedPath)));
    } catch {
      // Keep the resolved path for roots that are not readable yet.
    }
    return resolvedPath;
  }

  async function rememberAllowedRoot(rootPath) {
    return addAllowedRoot(allowedRoots, rootPath);
  }

  async function validateMirrorFolderTrust(folder) {
    if (!folder?.path) {
      return { folder, trusted: false };
    }

    const resolvedPath = path.resolve(folder.path);
    const nextFolder = { ...folder, path: resolvedPath };
    if (folder.status === 'missing' || folder.status === 'needs-permission') {
      return { folder: nextFolder, trusted: false };
    }

    let currentCanonicalPath;
    try {
      currentCanonicalPath = await fs.promises.realpath(resolvedPath);
    } catch {
      return {
        folder: { ...nextFolder, status: 'needs-permission' },
        trusted: false
      };
    }

    const storedCanonicalPath = normalizeMirrorPath(folder.canonicalPath);
    if (!storedCanonicalPath) {
      return {
        folder: { ...nextFolder, status: 'needs-permission' },
        trusted: false
      };
    }
    const currentComparisonPath = normalizeForComparison(currentCanonicalPath);
    const trusted = normalizeForComparison(storedCanonicalPath) === currentComparisonPath;

    if (!trusted) {
      return {
        folder: { ...nextFolder, status: 'needs-permission' },
        trusted: false
      };
    }

    return {
      folder: { ...nextFolder, canonicalPath: currentCanonicalPath },
      trusted: true
    };
  }

  async function rebuildAllowedRootsFromFolders(folders) {
    const nextAllowedRoots = new Set();
    const validatedFolders = [];
    if (Array.isArray(folders)) {
      for (const folder of folders) {
        const validation = await validateMirrorFolderTrust(folder);
        validatedFolders.push(validation.folder);
        if (validation.trusted) {
          await addAllowedRoot(nextAllowedRoots, validation.folder?.path);
        }
      }
    }
    allowedRoots.clear();
    for (const rootPath of nextAllowedRoots) {
      allowedRoots.add(rootPath);
    }
    return validatedFolders;
  }

  async function hydrateAllowedRootsFromMirror({ force = false } = {}) {
    if (mirrorHydrationAttempted && !force) return null;
    mirrorHydrationAttempted = true;
    const mirror = await readLibraryFoldersMirror(app, dependencies);
    if (mirror.success) {
      mirror.folders = await rebuildAllowedRootsFromFolders(mirror.folders);
    }
    return mirror;
  }

  async function filterAllowedMirrorFolders(folders) {
    if (!Array.isArray(folders)) return [];
    const allowedFolders = [];
    for (const folder of folders) {
      if (!folder?.path) {
        allowedFolders.push(folder);
        continue;
      }
      try {
        await assertAllowedLibraryPath(folder.path);
        allowedFolders.push(folder);
      } catch {
        // The renderer may only mirror folders that the main process already trusts.
      }
    }
    return allowedFolders;
  }

  async function assertAllowedLibraryPath(filePath, {
    requireFile = false,
    returnCanonical = false
  } = {}) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new Error('File path is required');
    }
    if (allowedRoots.size === 0) {
      await hydrateAllowedRootsFromMirror();
    }
    if (allowedRoots.size === 0) {
      throw new Error('No library folder has been selected');
    }

    const resolvedPath = path.resolve(filePath);
    const requireExistingPath = requireFile || returnCanonical;
    let canonicalPath = null;
    let candidatePath = normalizeForComparison(resolvedPath);
    try {
      canonicalPath = await fs.promises.realpath(resolvedPath);
      candidatePath = normalizeForComparison(canonicalPath);
    } catch (error) {
      if (requireExistingPath || (error && error.code !== 'ENOENT')) {
        throw error;
      }
    }

    for (const rootPath of allowedRoots) {
      if (isInsideOrSamePath(candidatePath, rootPath)) {
        if (requireFile) {
          const stat = await fs.promises.stat(canonicalPath || resolvedPath);
          if (!stat.isFile()) {
            throw createNotFileError(canonicalPath || resolvedPath);
          }
        }
        return returnCanonical && canonicalPath ? canonicalPath : resolvedPath;
      }
    }

    throw new Error('Path is outside the selected music library folders');
  }

  async function resolveLibraryScanRoot(root) {
    const resolvedPath = await assertAllowedLibraryPath(root?.path);
    let comparisonPath = normalizeForComparison(resolvedPath);
    try {
      comparisonPath = normalizeForComparison(await fs.promises.realpath(resolvedPath));
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    }
    return {
      ...root,
      path: resolvedPath,
      comparisonPath
    };
  }

  function rootsOverlap(leftRoot, rightRoot) {
    if (!leftRoot?.comparisonPath || !rightRoot?.comparisonPath) return false;
    return isInsideOrSamePath(leftRoot.comparisonPath, rightRoot.comparisonPath) ||
      isInsideOrSamePath(rightRoot.comparisonPath, leftRoot.comparisonPath);
  }

  function findOverlappingActiveScan(roots) {
    for (const scan of activeScans.values()) {
      const activeRoots = scan.roots || [];
      if (roots.some(root => activeRoots.some(activeRoot => rootsOverlap(root, activeRoot)))) {
        return scan;
      }
    }
    return null;
  }

  function isScanStartCanceled(scanRequest) {
    const pendingScan = pendingScanStarts.get(scanRequest.scanId);
    if (!pendingScan) return false;
    if (isDestroyedTarget(pendingScan.senderContents)) {
      pendingScan.canceled = true;
    }
    return pendingScan.canceled === true;
  }

  function toCanceledScanStartResult(scanId) {
    return {
      success: false,
      scanId,
      canceled: true,
      error: 'Library scan was canceled before it started'
    };
  }

  function createPendingScanStart(scanId, senderContents) {
    const pendingScan = {
      canceled: isDestroyedTarget(senderContents),
      active: false,
      scan: null,
      senderContents,
      cancelOnSenderDestroyed: null
    };
    if (senderContents && typeof senderContents.once === 'function') {
      pendingScan.cancelOnSenderDestroyed = () => {
        pendingScan.canceled = true;
        if (pendingScan.scan && typeof pendingScan.scan.cancel === 'function') {
          try {
            pendingScan.scan.cancel();
          } catch {
            // The scan may already be finished.
          }
        }
      };
      senderContents.once('destroyed', pendingScan.cancelOnSenderDestroyed);
    }
    pendingScanStarts.set(scanId, pendingScan);
    return pendingScan;
  }

  function removePendingScanDestroyedListener(pendingScan) {
    if (!pendingScan || !pendingScan.senderContents || !pendingScan.cancelOnSenderDestroyed) return;
    if (typeof pendingScan.senderContents.removeListener === 'function') {
      try {
        pendingScan.senderContents.removeListener('destroyed', pendingScan.cancelOnSenderDestroyed);
      } catch {
        // Ignore listener cleanup failures on destroyed senders.
      }
    }
    pendingScan.cancelOnSenderDestroyed = null;
  }

  ipcMain.handle('library-select-folder', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: app.getPath('music')
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    const selectedPath = await rememberAllowedRoot(result.filePaths[0]);
    return { canceled: false, path: selectedPath };
  });

  ipcMain.handle('library-validate-roots', async (event, paths) => {
    const rootPaths = normalizePathList(paths);
    return await mapWithConcurrency(rootPaths, MAX_LIBRARY_VALIDATE_CONCURRENCY, async rootPath => {
      try {
        await assertAllowedLibraryPath(rootPath);
      } catch (error) {
        return {
          path: rootPath,
          exists: false,
          readable: false,
          isDirectory: false,
          error: error && error.message ? error.message : String(error)
        };
      }
      return validateRoot(rootPath);
    });
  });

  ipcMain.handle('library-scan-start', async (event, request) => {
    let scanRequest;
    try {
      scanRequest = normalizeScanRequest(request);
    } catch (error) {
      return {
        success: false,
        scanId: getSafeScanIdForResponse(request),
        error: error && error.message ? error.message : String(error)
      };
    }
    const sendEvent = createEventSender(event, getMainWindow);
    if (activeScans.has(scanRequest.scanId) || pendingScanStarts.has(scanRequest.scanId)) {
      return { success: false, scanId: scanRequest.scanId, error: 'Scan is already running' };
    }
    if (scanRequest.roots.length === 0) {
      return { success: false, scanId: scanRequest.scanId, error: 'Library scan requires at least one root' };
    }
    if (activeScans.size + pendingScanStarts.size >= MAX_ACTIVE_LIBRARY_SCANS) {
      return {
        success: false,
        scanId: scanRequest.scanId,
        error: 'Too many library scans are already running'
      };
    }

    const roots = [];
    const rootErrors = [];
    const senderContents = event && event.sender;
    const pendingScanStart = createPendingScanStart(scanRequest.scanId, senderContents);

    try {
      for (const root of scanRequest.roots) {
        if (isScanStartCanceled(scanRequest)) return toCanceledScanStartResult(scanRequest.scanId);
        try {
          const resolvedRoot = await resolveLibraryScanRoot(root);
          if (isScanStartCanceled(scanRequest)) return toCanceledScanStartResult(scanRequest.scanId);
          roots.push(resolvedRoot);
        } catch (error) {
          rootErrors.push({ root, error });
        }
      }

      if (isScanStartCanceled(scanRequest)) return toCanceledScanStartResult(scanRequest.scanId);

      for (const { root, error } of rootErrors) {
        sendEvent(toFolderScanErrorEvent(scanRequest.scanId, root, error, roots.length === 0));
      }

      if (roots.length === 0) {
        const firstError = rootErrors[0]?.error;
        return {
          success: false,
          scanId: scanRequest.scanId,
          error: firstError && firstError.message ? firstError.message : 'No library scan roots are available'
        };
      }

      const overlappingScan = findOverlappingActiveScan(roots);
      if (overlappingScan) {
        return {
          success: false,
          scanId: scanRequest.scanId,
          activeScanId: overlappingScan.scanId,
          error: 'A library scan is already running for one of these roots'
        };
      }

      if (activeScans.size >= MAX_ACTIVE_LIBRARY_SCANS) {
        return {
          success: false,
          scanId: scanRequest.scanId,
          error: 'Too many library scans are already running'
        };
      }

      if (isScanStartCanceled(scanRequest) || isDestroyedTarget(senderContents)) {
        if (pendingScanStart) pendingScanStart.canceled = true;
        return toCanceledScanStartResult(scanRequest.scanId);
      }

      let terminalEventSent = false;
      let activeScanId = scanRequest.scanId;
      const sanitizedScanRequest = {
        ...scanRequest,
        roots: roots.map(({ comparisonPath: _comparisonPath, ...root }) => root)
      };
      const scan = scanner.createLibraryScan(sanitizedScanRequest, scanEvent => {
        if (scanEvent && (scanEvent.type === 'done' || (scanEvent.type === 'error' && scanEvent.fatal))) {
          terminalEventSent = true;
        }
        sendEvent({ ...scanEvent, scanId: activeScanId });
      });
      activeScanId = scan.scanId;
      scan.roots = roots;
      activeScans.set(scan.scanId, scan);
      pendingScanStart.active = true;
      pendingScanStart.scan = scan;

      scan.promise
        .catch(error => {
          if (!terminalEventSent || defaultScanner.isAbortError(error)) {
            try {
              sendEvent(toScanErrorEvent(scan.scanId, error));
            } catch {
              // The window may already be gone; dropping the event is fine.
            }
          }
        })
        .finally(() => {
          activeScans.delete(scan.scanId);
          removePendingScanDestroyedListener(pendingScanStart);
        });

      return { success: true, scanId: scan.scanId };
    } finally {
      pendingScanStarts.delete(scanRequest.scanId);
      if (!pendingScanStart.active) {
        removePendingScanDestroyedListener(pendingScanStart);
      }
    }
  });

  ipcMain.handle('library-scan-cancel', async (event, scanId) => {
    const scan = activeScans.get(scanId);
    if (!scan) {
      const pendingScan = pendingScanStarts.get(scanId);
      if (pendingScan) {
        pendingScan.canceled = true;
        return { success: true, scanId, canceled: true };
      }
      return { success: true, scanId, canceled: false };
    }

    scan.cancel();
    return { success: true, scanId, canceled: true };
  });

  ipcMain.handle('library-read-artwork', async (event, request) => {
    const readRequest = normalizeReadArtworkRequest(request);
    const resolvedPath = await assertAllowedLibraryPath(readRequest.path, {
      requireFile: true,
      returnCanonical: true
    });
    assertSupportedAudioReadPath(resolvedPath, 'Library artwork reads');
    return await runWithReadBudget(
      readBudgets,
      event && event.sender,
      MAX_LIBRARY_READ_ARTWORK_BYTES,
      'artwork read',
      async () => scanner.readArtworkBytes(resolvedPath, {
        parseFileTimeoutMs: readRequest.parseFileTimeoutMs
      })
    );
  });

  ipcMain.handle('library-read-file-bytes', async (event, request) => {
    const readRequest = normalizeReadFileRequest(request);
    const activeBytes = estimateReadFileActiveBytes(readRequest);
    const resolvedPath = await assertAllowedLibraryPath(readRequest.path, {
      requireFile: true,
      returnCanonical: true
    });
    assertSupportedAudioReadPath(resolvedPath, 'Library byte reads');
    const readOptions = {
      offset: readRequest.offset,
      length: readRequest.length
    };
    if (readRequest.maxBytes !== undefined && readRequest.maxBytes !== null) {
      readOptions.maxBytes = readRequest.maxBytes;
    }
    return await runWithReadBudget(
      readBudgets,
      event && event.sender,
      activeBytes,
      'byte read',
      async () => scanner.readFileBytes(resolvedPath, readOptions)
    );
  });

  ipcMain.handle('library-show-in-folder', async (event, filePath) => {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return { success: false, error: 'File path is required' };
    }
    const resolvedPath = await assertAllowedLibraryPath(filePath, {
      requireFile: true,
      returnCanonical: true
    });
    shell.showItemInFolder(resolvedPath);
    return { success: true };
  });

  ipcMain.handle('library-save-folders', async (event, folders) => {
    const folderRequestList = normalizeFolderRequestList(folders);
    if (allowedRoots.size === 0) {
      await hydrateAllowedRootsFromMirror();
    }
    if (allowedRoots.size === 0 && folderRequestList.some(folder => folder?.path)) {
      // Do not let an untrusted renderer refresh path-bearing mirror data
      // before a folder has been granted in this main-process session.
      const existing = await readLibraryFoldersMirror(app, dependencies);
      return { success: true, path: existing.path, count: existing.folders.length, skipped: true };
    }
    const allowedFolders = await filterAllowedMirrorFolders(folderRequestList);
    let result;
    try {
      result = await writeLibraryFoldersMirror(app, allowedFolders, dependencies);
    } catch (error) {
      return {
        success: false,
        path: getLibraryFoldersMirrorPath(app, dependencies),
        count: 0,
        folders: [],
        error: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : undefined
      };
    }
    if (result.success) {
      mirrorHydrationAttempted = true;
      await rebuildAllowedRootsFromFolders(result.folders);
    }
    return result;
  });

  ipcMain.handle('library-load-folders', async () => {
    const result = await readLibraryFoldersMirror(app, dependencies);
    mirrorHydrationAttempted = true;
    if (result.success) {
      result.folders = await rebuildAllowedRootsFromFolders(result.folders);
    }
    return result;
  });

  return {
    activeScans,
    validateRoot
  };
}

module.exports = {
  MAX_LIBRARY_FOLDERS_MIRROR_BYTES,
  MAX_LIBRARY_FOLDERS_MIRROR_FOLDERS,
  MAX_LIBRARY_FOLDERS_MIRROR_STRING_LENGTH,
  MAX_LIBRARY_READ_GLOBAL_ACTIVE_BYTES,
  MAX_LIBRARY_READ_GLOBAL_CONCURRENCY,
  MAX_LIBRARY_READ_SENDER_ACTIVE_BYTES,
  MAX_LIBRARY_READ_SENDER_CONCURRENCY,
  MAX_LIBRARY_SCAN_ID_LENGTH,
  MAX_LIBRARY_SCAN_KNOWN_FILES,
  MAX_LIBRARY_SCAN_ROOTS,
  MAX_LIBRARY_SCAN_STRING_LENGTH,
  MAX_LIBRARY_VALIDATE_ROOTS,
  getLibraryFoldersMirrorPath,
  registerLibraryIpcHandlers,
  validateRoot,
  readLibraryFoldersMirror,
  writeLibraryFoldersMirror
};
