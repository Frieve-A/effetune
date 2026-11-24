import {
  CompositeCatalogSequence,
  MaterializedSequence,
  MAX_MATERIALIZED_SEQUENCE_ITEMS
} from './playback-sequence.js';

const MAX_SESSION_BATCH_BYTES = 512 * 1024;
const MAX_SESSION_COPY_ORDINALS = 4096;
const RESTORED_CATALOG_PAGE_SIZE = 8;

export class PlaybackSessionStore {
  constructor({ getBridge, writeMarker }) {
    this.getBridge = getBridge;
    this.writeMarker = writeMarker;
    this.tail = Promise.resolve();
    this.pendingPlayer = null;
    this.writeTicket = null;
    this.wasScheduled = false;
    this.queueVersion = 1;
    this.savedQueueVersion = 0;
  }

  request(player, { full = false } = {}) {
    this.wasScheduled = true;
    if (full) this.queueVersion += 1;
    this.pendingPlayer = player;
    this.resume();
  }

  resume() {
    if (this.writeTicket || !this.pendingPlayer) return;
    const ticket = {};
    this.writeTicket = ticket;
    this.enqueue(async () => {
      if (this.writeTicket !== ticket) return;
      this.writeTicket = null;
      const player = this.pendingPlayer;
      if (!player || player.playbackManager.isPlaybackSessionWriteBlocked()) return;
      this.pendingPlayer = null;
      const version = this.queueVersion;
      const full = version !== this.savedQueueVersion;
      const snapshot = player.playbackManager.capturePlaybackSession(full);
      if (!snapshot) return;
      const bridge = await this.getBridge();
      if (!bridge) return;
      const request = options => bridge.requestPlaybackSession(options);
      if (full) {
        await this.writeMarker(true);
        await request({ action: 'begin', state: snapshot.state });
        await writeSessionQueue(request, snapshot, bridge.runtime === 'electron');
        await request({ action: 'commit' });
        this.savedQueueVersion = version;
      } else {
        await request({ action: 'update', state: snapshot.state });
      }
    });
  }

  cancelPending(player) {
    if (this.pendingPlayer === player) this.pendingPlayer = null;
  }

  async load() {
    const bridge = await this.getBridge();
    if (!bridge) return undefined;
    const session = await bridge.requestPlaybackSession({ action: 'read' });
    if (!session) return null;
    return prepareSession(bridge, session);
  }

  remove({ onlyIfUnscheduled = false, markerOnly = false, isCurrent = () => true } = {}) {
    if (!onlyIfUnscheduled) {
      this.pendingPlayer = null;
      this.writeTicket = null;
      this.queueVersion += 1;
    }
    const canDelete = () => (!onlyIfUnscheduled || !this.wasScheduled) && isCurrent();
    return this.enqueue(async () => {
      if (!canDelete()) return false;
      if (!markerOnly) {
        const bridge = await this.getBridge();
        if (!bridge || !canDelete()) return false;
        await bridge.requestPlaybackSession({ action: 'delete' });
      }
      await this.writeMarker(false);
      return true;
    });
  }

  enqueue(operation) {
    this.tail = this.tail.then(operation).catch(error => {
      console.warn('The playback session could not be saved:', error);
      return false;
    });
    return this.tail;
  }
}

export function snapshotPlaybackSessionQueue(sequence, playlist, originalPlaylist) {
  if (sequence.kind === 'materialized') {
    const originalOrdinals = new Map(originalPlaylist.map((track, ordinal) => [track.entryInstanceId, ordinal]));
    return playlist.map((track, ordinal) => sessionRow(track, ordinal, originalOrdinals.get(track.entryInstanceId)));
  }

  const snapshots = new Map();
  function snapshot(node) {
    if (snapshots.has(node)) return snapshots.get(node);
    let saved;
    if (node.kind === 'materialized') {
      saved = { kind: 'materialized', rows: node.entries.map((track, ordinal) => sessionRow(track, ordinal)) };
    } else if (node.segments) {
      saved = {
        kind: 'composite',
        toCanonicalOrdinal: snapshotOrdinalMapping(node),
        segments: node.segments.map(segment => ({ ...segment, sequence: snapshot(segment.sequence) }))
      };
    } else {
      saved = { ...node.getDescriptor(), toCanonicalOrdinal: snapshotOrdinalMapping(node) };
    }
    snapshots.set(node, saved);
    return saved;
  }
  return snapshot(sequence);
}

function snapshotOrdinalMapping(sequence) {
  if (!sequence.shuffleEnabled) return null;
  const { permutation, shuffleTransportOffset, itemCount } = sequence;
  return ordinal => permutation.permute((ordinal + shuffleTransportOffset) % itemCount);
}

function sessionRow(track, ordinal, originalOrdinal) {
  const row = { ordinal, ...(originalOrdinal !== undefined ? { originalOrdinal } : {}) };
  const uid = track.libraryTrackId ?? track.trackUid;
  if (uid) return { ...row, trackUid: uid };
  const path = track.path || track.droppedFilePath;
  if (!path || track.uri || !isLocalPath(path)) return row;
  const { meta } = track;
  const fileTrack = { path, name: track.name };
  for (const key of ['sourceKind', 'physicalSourceKey', 'canonicalSourceKey', 'sourceKey']) {
    if (typeof track[key] === 'string') fileTrack[key] = track[key];
  }
  const byteLength = track.file?.size ?? track.byteLength ?? track.fileSize ?? track.size;
  if (Number.isSafeInteger(byteLength) && byteLength >= 0) fileTrack.byteLength = byteLength;
  for (const key of ['startFrame', 'endFrame', 'durationSec']) {
    if (Number.isFinite(track[key]) || track[key] === null) fileTrack[key] = track[key];
  }
  if (meta) {
    const storedMeta = {};
    for (const [key, value] of Object.entries(meta)) {
      if (key === 'picture' || key === 'artworkUrl' || key === 'artworkId') continue;
      if (typeof value === 'string' || Number.isFinite(value) || typeof value === 'boolean' || value === null) {
        Object.defineProperty(storedMeta, key, { enumerable: true, value });
      } else if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
        Object.defineProperty(storedMeta, key, { enumerable: true, value: [...value] });
      }
    }
    fileTrack.meta = storedMeta;
  }
  return { ...row, track: fileTrack };
}

function isLocalPath(path) {
  return path.startsWith('/') && !path.startsWith('//') ||
    /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

async function writeSessionQueue(request, { state, queue }, allowFiles) {
  let unsupportedCount = 0;
  let ungrantedCount = 0;
  let rows = [];
  let rowBytes = 0;
  const copies = new Map();
  let copiedOrdinals = 0;
  const encoder = new TextEncoder();

  async function flushRows() {
    if (rows.length === 0) return;
    const result = await request({ action: 'append', rows });
    ungrantedCount += result?.excludedCount ?? 0;
    rows = [];
    rowBytes = 0;
  }

  async function flushCopy() {
    for (const copy of copies.values()) await request(copy);
    copies.clear();
    copiedOrdinals = 0;
  }

  async function append(row, ordinal) {
    if (!row.trackUid && !(allowFiles && row.track)) {
      unsupportedCount += 1;
      return;
    }
    const item = { ...row, ordinal };
    const bytes = encoder.encode(JSON.stringify(item)).length + 1;
    if (rows.length && rowBytes + bytes > MAX_SESSION_BATCH_BYTES) await flushRows();
    rows.push(item);
    rowBytes += bytes;
  }

  async function appendMapped(node, startOrdinal, ordinal) {
    if (node.kind === 'composite') {
      let canonical = node.toCanonicalOrdinal?.(startOrdinal) ?? startOrdinal;
      for (const segment of node.segments) {
        if (canonical < segment.itemCount) {
          await appendMapped(segment.sequence, segment.startOrdinal + canonical, ordinal);
          return;
        }
        canonical -= segment.itemCount;
      }
    } else if (node.kind === 'materialized') {
      await append(node.rows[startOrdinal], ordinal);
    } else {
      const canonical = node.toCanonicalOrdinal?.(startOrdinal) ?? startOrdinal;
      let copy = copies.get(node.sequenceId);
      if (!copy) {
        copy = { action: 'copy', sequenceId: node.sequenceId, sourceOrdinals: [], destinationOrdinals: [] };
        copies.set(node.sequenceId, copy);
      }
      copy.sourceOrdinals.push(canonical);
      copy.destinationOrdinals.push(ordinal);
      copiedOrdinals += 1;
      if (copiedOrdinals >= MAX_SESSION_COPY_ORDINALS) await flushCopy();
    }
  }

  async function appendRange(node, startOrdinal, itemCount, ordinal, canonicalOrder = false) {
    if (node.kind === 'catalog') {
      await flushCopy();
      await flushRows();
      await request({
        action: 'copy', ordinal, sequenceId: node.sequenceId, startOrdinal, itemCount,
        ...(!canonicalOrder && node.shuffleEnabled ? {
          shuffleSeed: node.shuffleSeed,
          shuffleEpoch: node.shuffleEpoch,
          shuffleTransportOffset: node.shuffleTransportOffset
        } : {})
      });
    } else if (node.kind === 'composite' && (canonicalOrder || !node.toCanonicalOrdinal)) {
      let skip = startOrdinal;
      let remaining = itemCount;
      for (const segment of node.segments) {
        if (skip >= segment.itemCount) {
          skip -= segment.itemCount;
          continue;
        }
        const count = Math.min(remaining, segment.itemCount - skip);
        await appendRange(segment.sequence, segment.startOrdinal + skip, count, ordinal);
        remaining -= count;
        ordinal += count;
        skip = 0;
        if (!remaining) break;
      }
    } else {
      for (let offset = 0; offset < itemCount; offset += 1) {
        await appendMapped(node, startOrdinal + offset, ordinal + offset);
      }
    }
  }

  if (state.kind === 'materialized') {
    for (const row of queue) await append(row, row.ordinal);
  } else {
    await appendRange(queue, 0, state.itemCount, 0, true);
  }
  await flushCopy();
  await flushRows();
  if (unsupportedCount) console.debug('Playback session omitted tracks with no persistent source:', unsupportedCount);
  if (ungrantedCount) console.debug('Playback session omitted local files without read permission:', ungrantedCount);
}

async function prepareSession(bridge, {
  state, restoredCount, currentOrdinal, currentPreserved, catalogSequence, currentTrack
}) {
  const prepared = {
    count: restoredCount,
    itemCount: state.itemCount,
    currentOrdinal,
    position: currentPreserved ? state.position : 0,
    duration: currentPreserved ? state.duration : null,
    repeatMode: state.repeatMode,
    shuffleMode: state.shuffleMode
  };
  if (!restoredCount) return prepared;

  const rows = [];
  if (catalogSequence?.itemCount !== restoredCount) {
    for (let startOrdinal = 0; startOrdinal !== null;) {
      const page = await bridge.requestPlaybackSession({ action: 'page', startOrdinal });
      rows.push(...page.rows);
      startOrdinal = page.nextOrdinal;
    }
  }
  if (state.kind === 'materialized') {
    const playlist = rows.map(row => sessionTrack(bridge, row));
    const originalPlaylist = rows.map((row, index) => ({ row, track: playlist[index] }))
      .sort((a, b) => (a.row.originalOrdinal ?? a.row.ordinal) - (b.row.originalOrdinal ?? b.row.ordinal))
      .map(item => item.track);
    return { ...prepared, playlist, originalPlaylist, currentTrack: playlist[currentOrdinal] };
  }

  const library = catalogSequence && bridge.createPlaybackCatalogSequence({
    ...catalogSequence,
    pageSize: RESTORED_CATALOG_PAGE_SIZE
  });
  let sequence = library;
  if (rows.length) {
    const segments = [];
    let files = [];
    function flushFiles() {
      if (!files.length) return;
      segments.push({ sequence: new MaterializedSequence(files) });
      files = [];
    }
    for (const row of rows) {
      if (row.track) {
        files.push(sessionTrack(bridge, row));
        if (files.length === MAX_MATERIALIZED_SEQUENCE_ITEMS) flushFiles();
      } else {
        flushFiles();
        segments.push({ sequence: library, startOrdinal: row.libraryOrdinal, itemCount: row.itemCount });
      }
    }
    flushFiles();
    sequence = new CompositeCatalogSequence({
      sequenceId: `restored:${globalThis.crypto.randomUUID()}`,
      segments
    });
  }
  if (state.shuffleState && restoredCount === state.itemCount) {
    sequence.restoreShuffleState(state.shuffleState);
  } else if (state.shuffleMode) {
    sequence.setShuffle(true, { seed: globalThis.crypto.getRandomValues(new Uint32Array(1))[0] });
  }
  const transportOrdinal = sequence.toTransportOrdinal(currentOrdinal);
  return {
    ...prepared,
    sequence,
    currentOrdinal: transportOrdinal,
    currentTrack: currentTrack.track ? sessionTrack(bridge, currentTrack) : {
      ...currentTrack,
      sequenceId: catalogSequence.sequenceId,
      canonicalOrdinal: currentTrack.libraryOrdinal,
      transportOrdinal
    }
  };
}

function sessionTrack(bridge, row) {
  if (row.track) return { ...row.track, entryInstanceId: `restored-file:${row.ordinal}` };
  return {
    libraryTrackId: row.trackUid,
    entryInstanceId: row.entryInstanceId,
    name: row.fileName || row.title,
    meta: { title: row.title, artist: row.artist },
    provider: () => bridge.resolvePlaybackSessionLibrarySource(row.trackUid)
  };
}
