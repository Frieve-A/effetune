import {
  getFileName,
  isSupportedPlaylistPath,
  normalizeRelativePath,
  stripExtension
} from '../constants.js';
import { IncrementalSha256, sha256Hex } from '../repository/sha256.js';

export const MAX_AUTOMATIC_PLAYLISTS_PER_FOLDER = 1_000;

export class AutomaticPlaylistCollector {
  constructor({ limit = MAX_AUTOMATIC_PLAYLISTS_PER_FOLDER } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Playlist collection limit is invalid');
    this.limit = limit;
    this.items = [];
    this.ignored = 0;
  }

  add(candidate) {
    const relativePath = normalizeRelativePath(candidate?.relativePath).normalize('NFC');
    if (!relativePath || !isSupportedPlaylistPath(relativePath)) return false;
    if (this.items.length >= this.limit) {
      this.ignored += 1;
      return false;
    }
    this.items.push(Object.freeze({ ...candidate, relativePath }));
    return true;
  }
}

export function automaticPlaylistIdentity(folderId, relativePath, { contentDigest = null, attemptId = null } = {}) {
  const normalizedFolderId = String(folderId ?? '');
  const normalizedPath = normalizeRelativePath(relativePath).normalize('NFC');
  if (!normalizedFolderId || !normalizedPath) throw new TypeError('Automatic playlist identity is invalid');
  const digest = sha256Hex(new TextEncoder().encode(`${normalizedFolderId}\0${normalizedPath}`));
  const requestDigest = contentDigest === null
    ? digest
    : sha256Hex(new TextEncoder().encode(`${digest}\0${contentDigest}\0${String(attemptId ?? '')}`));
  return Object.freeze({
    clientRequestId: `scan-playlist:${requestDigest}`,
    playlistId: `scan_playlist_${digest}`,
    grantToken: `playlist_import_scan_${digest}`,
    source: Object.freeze({ folderId: normalizedFolderId, relativePath: normalizedPath })
  });
}

export async function importAutomaticPlaylists({
  service,
  folderId,
  collector,
  openSource,
  attemptId = '',
  signal
} = {}) {
  const items = collector?.items ?? [];
  const summary = {
    state: 'completed',
    found: items.length + Number(collector?.ignored ?? 0),
    imported: 0,
    alreadyImported: 0,
    failed: 0,
    ignored: Number(collector?.ignored ?? 0),
    canceled: 0
  };
  if (items.length === 0 || !service || typeof openSource !== 'function') return Object.freeze(summary);
  if (typeof service.startAutomaticPlaylistImport !== 'function' ||
      typeof service.getAutomaticPlaylistImportState !== 'function' ||
      typeof service.waitForTerminal !== 'function') {
    throw new TypeError('Automatic playlist import service is invalid');
  }

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) {
      summary.canceled += items.length - index;
      summary.state = 'playlist-import-canceled';
      break;
    }
    const candidate = items[index];
    const identity = automaticPlaylistIdentity(folderId, candidate.relativePath);
    let opened = null;
    let receipt = null;
    let abortListener = null;
    try {
      opened = await openSource(candidate, identity);
      const source = opened?.source ?? opened;
      const contentDigest = opened?.contentDigest ?? await digestPlaylistSource(source, { signal });
      if (!/^sha256:[0-9a-f]{64}$/.test(contentDigest)) {
        throw new TypeError('Automatic playlist content digest is invalid');
      }
      const revisionIdentity = automaticPlaylistIdentity(folderId, candidate.relativePath, {
        contentDigest,
        attemptId
      });
      const previous = await service.getAutomaticPlaylistImportState({
        ...revisionIdentity.source,
        playlistId: revisionIdentity.playlistId
      });
      if (previous?.state === 'active' && previous?.contentDigest === contentDigest) {
        summary.alreadyImported += 1;
        continue;
      }
      const expectedTargetVersion = previous?.state === 'active'
        ? previous.version
        : 0;
      receipt = await service.startAutomaticPlaylistImport({
        clientRequestId: revisionIdentity.clientRequestId,
        operationKind: 'importPlaylist',
        selectionDescriptor: null,
        target: { playlistId: revisionIdentity.playlistId },
        expectedTargetVersion,
        options: {
          name: stripExtension(getFileName(candidate.relativePath)).trim() || 'Playlist',
          source,
          encoding: null,
          limits: null,
          automaticSource: {
            ...revisionIdentity.source,
            contentDigest
          }
        }
      });
      if (receipt?.kind === 'started' || receipt?.kind === 'active') {
        if (signal && typeof service.cancel === 'function' && typeof receipt.operationId === 'string') {
          abortListener = () => Promise.resolve(service.cancel(receipt.operationId)).catch(() => {});
          signal.addEventListener('abort', abortListener, { once: true });
        }
        const terminal = await service.waitForTerminal(receipt.operationId);
        if (signal?.aborted) {
          summary.canceled += 1;
          summary.state = 'playlist-import-canceled';
        } else if (operationWasUnchanged(terminal)) summary.alreadyImported += 1;
        else if (operationSucceeded(terminal)) summary.imported += 1;
        else summary.failed += 1;
      } else if (receipt?.kind === 'terminal') {
        if (operationWasUnchanged(receipt) || operationSucceeded(receipt)) summary.alreadyImported += 1;
        else summary.failed += 1;
      } else if (receipt?.kind === 'requestIdReuse' || receipt?.kind === 'automaticUnchanged') {
        summary.alreadyImported += 1;
      } else {
        summary.failed += 1;
      }
    } catch {
      if (signal?.aborted) {
        summary.canceled += 1;
        summary.state = 'playlist-import-canceled';
      }
      else summary.failed += 1;
    } finally {
      if (abortListener) signal.removeEventListener('abort', abortListener);
      await Promise.resolve(opened?.release?.(receipt)).catch(() => {});
    }
  }
  return Object.freeze(summary);
}

function operationSucceeded(status) {
  return status?.terminalKind === 'success' || status?.result?.state === 'succeeded';
}

function operationWasUnchanged(status) {
  return status?.result?.result?.automaticUnchanged === true ||
    status?.result?.automaticUnchanged === true;
}

export async function digestPlaylistSource(source, { signal } = {}) {
  if (!source || typeof source.stream !== 'function') {
    throw new TypeError('Automatic playlist source is not streamable');
  }
  const digest = new IncrementalSha256();
  for await (const chunk of readableChunks(source.stream())) {
    throwIfAborted(signal);
    digest.update(chunk);
  }
  throwIfAborted(signal);
  return `sha256:${digest.digestHex()}`;
}

async function* readableChunks(stream) {
  if (stream?.[Symbol.asyncIterator]) {
    yield* stream;
    return;
  }
  const reader = stream?.getReader?.();
  if (!reader) throw new TypeError('Automatic playlist source stream is invalid');
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      yield next.value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Scan aborted', 'AbortError');
}
