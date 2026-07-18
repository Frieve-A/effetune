'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { selectCueCoverFileName } = require('./cue-cover.cjs');
const { ArtworkWorkerPool } = require('./library-artwork-worker-pool.cjs');
const {
  createFolderConsolidationDialogOptions,
  createLibraryDialogTranslator
} = require('./library-dialog-localization.cjs');
const { MetadataWorkerPool } = require('./library-metadata-worker-pool.cjs');

const AUDIO_EXTENSIONS = new Set([
  '.aac', '.flac', '.m4a', '.mp3', '.mp4', '.ogg', '.opus', '.wav', '.webm'
]);
const PLAYLIST_EXTENSIONS = new Set(['.m3u', '.m3u8', '.pls', '.xspf']);
const CUE_EXTENSION = '.cue';
const PLAYLIST_IMPORT_GRANT_TTL_MS = 10 * 60 * 1000;
const MAX_PLAYLIST_IMPORT_GRANTS = 8;
const MAX_PLAYLIST_IMPORT_BYTES = 1024 * 1024 * 1024;
const MAX_FOLDER_IDS = 1024;
const MAX_PUBLIC_SCAN_WARNING_SAMPLES = 100;
const ARTWORK_EXTRACTOR_VERSION = 'electron-artwork-v2';
const MAX_ARTWORK_RAW_BYTES = 20 * 1024 * 1024;
const MAX_ARTWORK_SOURCE_DIMENSION = 16384;
const MAX_ARTWORK_SOURCE_PIXELS = 64 * 1024 * 1024;
const MAX_ARTWORK_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_ARTWORK_THUMBNAIL_BYTES = 512 * 1024;
const ARTWORK_CACHE_BYTES = 512 * 1024 * 1024;
const FOLDER_REMOVAL_PROGRESS_INTERVAL_MS = 100;
const FOLDER_REMOVAL_PROGRESS_TRACK_INTERVAL = 100;

class LibraryCatalogScanRuntime extends EventEmitter {
  constructor({
    host,
    dialog,
    getMainWindow = () => null,
    filesystem = fs.promises,
    translate = createLibraryDialogTranslator(),
    metadataParser,
    metadataWorkerPool = null,
    artworkWorkerPool = null,
    imageAdapter = defaultImageAdapter(),
    artworkThumbnailer = null,
    scanConfig = {},
    utilitySessionId = `${process.pid}:${Date.now()}`
  } = {}) {
    super();
    if (!host || typeof host.listScanFolders !== 'function' || typeof host.beginScanFolder !== 'function') {
      throw createRuntimeError('invalidCatalogHost', 'A catalog scan host is required');
    }
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      throw createRuntimeError('invalidDialogAdapter', 'A folder picker is required');
    }
    this.host = host;
    this.dialog = dialog;
    this.getMainWindow = getMainWindow;
    this.translate = translate;
    this.filesystem = filesystem;
    this.metadataWorkerPool = metadataParser ? null : (metadataWorkerPool ?? new MetadataWorkerPool({ workerCount: 4 }));
    this.metadataParser = metadataParser ?? this.metadataWorkerPool;
    this.artworkWorkerPool = artworkWorkerPool ?? new ArtworkWorkerPool({ workerCount: 4 });
    this.artworkThumbnailer = artworkThumbnailer ?? (source => createArtworkThumbnail(source, imageAdapter));
    if (typeof this.artworkThumbnailer !== 'function') {
      throw createRuntimeError('invalidArtworkThumbnailer', 'An artwork thumbnail renderer is required');
    }
    this.utilitySessionId = requireBoundedString(utilitySessionId, 'utilitySessionId', 512);
    this.artworkRequests = new Map();
    this.scanConfig = scanConfig;
    this.grants = new Map();
    this.playlistImportGrants = new Map();
    this.scans = new Map();
    this.folderScanTails = new Map();
    this.pendingFolderDeletions = new Map();
    this.closed = false;
    this.BoundedScanService = null;
    this.automaticPlaylistModule = null;
    this.playlistImportService = null;
    this.handleHostFailure = () => this.revokeAll('catalog-host-failure');
    this.host.on?.('failure', this.handleHostFailure);
  }

  static async open(options) {
    const runtime = new LibraryCatalogScanRuntime(options);
    const modulePath = path.join(__dirname, '../js/library/scan/bounded-scan-service.js');
    const playlistModulePath = path.join(__dirname, '../js/library/playlists/automatic-playlist-import.js');
    const [module, automaticPlaylistModule] = await Promise.all([
      import(pathToFileURL(modulePath).href),
      import(pathToFileURL(playlistModulePath).href)
    ]);
    runtime.BoundedScanService = module.BoundedScanService;
    runtime.automaticPlaylistModule = automaticPlaylistModule;
    await runtime.host.recoverInterruptedMetadataClaims({
      metadataStatus: 'retryable-error',
      errorCode: 'service-interrupted',
      preserveLastKnownGood: true,
      updateDerivedData: false
    });
    await runtime.host.beginArtworkUtilitySession?.({ utilitySessionId: runtime.utilitySessionId });
    await runtime.rehydrateGrants();
    return runtime;
  }

  setPlaylistImportService(service) {
    this.playlistImportService = service;
  }

  async rehydrateGrants() {
    const result = await this.host.listScanFolders({ includeRemoved: false });
    for (const folder of result.folders ?? []) {
      if (folder.kind !== 'electron' || !folder.path) continue;
      this.grants.delete(folder.id);
      let canonicalRoot = null;
      let status = 'ok';
      try {
        canonicalRoot = await this.canonicalDirectory(folder.path);
        if (!sameFilesystemPath(folder.path, canonicalRoot)) status = 'needs-permission';
      } catch (error) {
        status = error?.code === 'ENOENT' ? 'missing' : 'needs-permission';
      }
      const availableFolder = await this.updateFolderStatus(folder, status);
      if (status === 'ok') this.issueGrant(availableFolder, canonicalRoot);
    }
  }

  async addFolder(request = {}) {
    assertAllowedFields(request, ['languageHints'], 'invalidFolderRequest');
    this.assertOpen();
    const languageHints = normalizeLanguageHints(request.languageHints);
    const selected = await this.pickDirectory();
    if (!selected) return { canceled: true };
    const canonicalRoot = await this.canonicalDirectory(selected);
    const pendingDeletion = this.pendingFolderDeletions.get(filesystemPathKey(canonicalRoot));
    if (pendingDeletion) await pendingDeletion;
    const containment = await this.resolveRootContainment(canonicalRoot);
    if (containment.rejected) {
      return this.rejectedFolderResult(canonicalRoot, containment);
    }
    if (containment.children.length > 0) {
      const confirmed = await this.confirmFolderConsolidation();
      if (!confirmed) return { canceled: true };
      for (const child of containment.children) {
        await this.removeFolder({ folderId: child.id });
      }
    }
    const folder = {
      id: `folder_${crypto.randomUUID()}`,
      kind: 'electron',
      displayName: path.basename(canonicalRoot) || canonicalRoot,
      path: canonicalRoot,
      status: 'ok',
      scanGeneration: 0,
      lifecycleVersion: 0,
      addedAt: Date.now(),
      lastScanAt: null
    };
    await this.host.upsertFolders([folder]);
    this.issueGrant(folder, canonicalRoot);
    const scan = await this.scanFolders({
      folderIds: [folder.id],
      scanReason: 'automatic',
      languageHints
    });
    return { canceled: false, folder: publicFolder(folder), existing: false, scan };
  }

  async requestFolderAccess(request) {
    assertExactFields(request, ['folderId'], 'invalidFolderRequest');
    this.assertOpen();
    const folderId = requireBoundedString(request.folderId, 'folderId', 512);
    const folder = await this.requireFolder(folderId);
    const selected = await this.pickDirectory();
    if (!selected) return { canceled: true, folderId };
    const canonicalRoot = await this.canonicalDirectory(selected);
    const containment = await this.resolveRootContainment(canonicalRoot, { excludeId: folderId });
    if (containment.rejected) {
      return this.rejectedFolderResult(canonicalRoot, containment, { folderId });
    }
    if (containment.children.length > 0) {
      const confirmed = await this.confirmFolderConsolidation();
      if (!confirmed) return { canceled: true, folderId };
      for (const child of containment.children) {
        await this.removeFolder({ folderId: child.id });
      }
    }
    const rootChanged = !sameFilesystemPath(folder.path, canonicalRoot);
    if (rootChanged) {
      const affected = [...this.scans.values()]
        .filter(record => record.active && record.folderIds.includes(folderId));
      for (const record of affected) record.controller.abort();
      await Promise.all(affected.map(record => record.task?.catch(() => {})));
    }
    const availableFolder = {
      ...folder,
      displayName: path.basename(canonicalRoot) || canonicalRoot,
      path: canonicalRoot,
      status: 'ok',
      lifecycleVersion: Number(folder.lifecycleVersion) + (rootChanged ? 1 : 0)
    };
    await this.host.upsertFolders([availableFolder]);
    this.issueGrant(availableFolder, canonicalRoot, { catalogReady: !rootChanged });
    const scan = rootChanged
      ? await this.scanFolders({ folderIds: [folderId], scanReason: 'automatic' })
      : null;
    return {
      canceled: false,
      folder: publicFolder(availableFolder),
      ...(scan ? { scan } : {})
    };
  }

  async resolveRootContainment(canonicalRoot, { excludeId = null } = {}) {
    const result = await this.host.listScanFolders({ includeRemoved: false });
    const children = [];
    const folders = (result.folders ?? [])
      .filter(folder => folder.kind === 'electron' && folder.path && folder.id !== excludeId)
      .sort((left, right) => `${left.path}\0${left.id}`.localeCompare(`${right.path}\0${right.id}`));
    for (const existing of folders) {
      const relation = compareFilesystemRoots(canonicalRoot, existing.path);
      if (relation === 'same') return { rejected: true, reason: 'same-root', existing, children: [] };
      if (relation === 'descendant') {
        return { rejected: true, reason: 'descendant-root', existing, children: [] };
      }
      if (relation === 'ancestor') children.push(existing);
    }
    return { rejected: false, reason: null, existing: null, children };
  }

  rejectedFolderResult(canonicalRoot, containment, extra = {}) {
    return {
      canceled: false,
      rejected: true,
      reason: containment.reason,
      candidate: { displayName: path.basename(canonicalRoot) || canonicalRoot },
      existing: publicFolder(containment.existing),
      ...extra
    };
  }

  async confirmFolderConsolidation() {
    const result = await this.dialog.showMessageBox(
      this.getMainWindow(),
      createFolderConsolidationDialogOptions(this.translate)
    );
    return result?.response === 0;
  }

  async scanFolders(request = {}) {
    request = normalizeScanRequest(request);
    assertAllowedFields(
      request,
      ['folderIds', 'scanId', 'resume', 'scanReason', 'languageHints'],
      'invalidScanRequest'
    );
    this.assertOpen();
    if (!this.BoundedScanService) throw createRuntimeError('scanRuntimeNotReady', 'Scan runtime is not ready');
    const folderIds = request.folderIds == null
      ? [...this.grants.keys()]
      : validateStringList(request.folderIds, 'folderIds', MAX_FOLDER_IDS, 512);
    if (folderIds.length === 0) throw createRuntimeError('invalidScanRequest', 'At least one folder is required');
    const resume = request.resume === true;
    const scanId = request.scanId === undefined
      ? `scan_${crypto.randomUUID()}`
      : requireBoundedString(request.scanId, 'scanId', 128);
    if (resume && request.scanId === undefined) {
      throw createRuntimeError('invalidScanRequest', 'A previous scan ID is required to resume');
    }
    if (this.scans.get(scanId)?.active) {
      throw createRuntimeError('scanAlreadyRunning', 'Scan is already running');
    }
    const folders = await this.loadGrantedFolders(folderIds);
    const controller = new AbortController();
    const record = {
      scanId,
      folderIds: folders.map(folder => folder.id),
      active: true,
      status: 'queued',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      results: [],
      error: null,
      controller,
      task: null
    };
    this.scans.set(scanId, record);
    record.task = this.runScanRecord(record, folders, {
      resume,
      scanReason: normalizeScanReason(request.scanReason),
      languageHints: normalizeLanguageHints(request.languageHints),
      signal: controller.signal
    });
    return { accepted: true, scanId, folderIds: [...record.folderIds], resume };
  }

  async runScanRecord(record, folders, options) {
    record.status = 'running';
    record.updatedAt = Date.now();
    this.emitScanEvent(record, { status: 'running' });
    const metadataParser = options.languageHints
      ? {
          parse: request => this.metadataParser.parse({
            ...request,
            languageHints: options.languageHints
          })
        }
      : this.metadataParser;
    const collectors = new Map(folders.map(folder => [
      folder.id,
      new this.automaticPlaylistModule.AutomaticPlaylistCollector()
    ]));
    const service = new this.BoundedScanService({
      repository: this.host,
      filesystem: this.createFilesystemAdapter({
        onPlaylistFile: candidate => collectors.get(candidate.folderId)?.add(candidate)
      }),
      metadataParser,
      config: this.scanConfig,
      onProgress: progress => {
        if (isTerminalScanStatus(progress.status)) return;
        record.status = progress.status;
        record.updatedAt = Date.now();
        this.emitScanEvent(record, { progress });
      }
    });
    try {
      for (const folder of folders) {
        const completed = await this.runFolderSerialized(folder.id, options.signal, async () => {
          this.assertGrant(folder.id, folder.path, folder.lifecycleVersion);
          const result = await service.runFolder({
            scanId: record.scanId,
            folder: { ...folder, normalizedRoot: folder.path },
            scanReason: options.scanReason,
            resume: options.resume,
            signal: options.signal
          });
          if (result.status === 'completed') {
            this.markGrantCatalogReady(folder.id, folder.path, folder.lifecycleVersion);
          }
          const playlistImports = await this.automaticPlaylistModule.importAutomaticPlaylists({
            service: this.playlistImportService,
            folderId: folder.id,
            collector: collectors.get(folder.id),
            attemptId: record.scanId,
            signal: options.signal,
            openSource: async (candidate, identity) => {
              const granted = await this.issuePlaylistImportGrant(candidate.path, {
                token: identity.grantToken,
                includeContentDigest: true,
                signal: options.signal
              });
              return {
                source: granted.source,
                contentDigest: granted.contentDigest,
                release: () => this.playlistImportGrants.delete(granted.source.token)
              };
            }
          });
          return withPlaylistImportSummary(result, playlistImports);
        });
        record.results.push(completed);
      }
      record.status = record.results.some(result => result.status === 'completed-no-sweep')
        ? 'completed-no-sweep'
        : 'completed';
    } catch (error) {
      record.status = options.signal.aborted ? 'paused' : 'failed';
      record.error = sanitizeError(error);
    } finally {
      record.active = false;
      record.updatedAt = Date.now();
      this.emitScanEvent(record, { terminal: true });
    }
  }

  async cancelScan(request) {
    assertExactFields(request, ['scanId'], 'invalidScanRequest');
    const scanId = requireBoundedString(request.scanId, 'scanId', 128);
    const record = this.scans.get(scanId);
    if (!record) return { scanId, canceled: false, status: 'not-found' };
    if (record.active) record.controller.abort();
    await record.task?.catch(() => {});
    return { scanId, canceled: true, status: record.status };
  }

  async runFolderSerialized(folderId, signal, operation) {
    const previous = this.folderScanTails.get(folderId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => {
      throwIfAborted(signal);
      return operation();
    });
    this.folderScanTails.set(folderId, current);
    try {
      return await current;
    } finally {
      if (this.folderScanTails.get(folderId) === current) this.folderScanTails.delete(folderId);
    }
  }

  getScanStatus(request) {
    assertExactFields(request, ['scanId'], 'invalidScanRequest');
    const scanId = requireBoundedString(request.scanId, 'scanId', 128);
    const record = this.scans.get(scanId);
    return record ? publicScanRecord(record) : { scanId, status: 'not-found', active: false };
  }

  async removeFolder(request) {
    assertExactFields(request, ['folderId'], 'invalidFolderRequest');
    const folderId = requireBoundedString(request.folderId, 'folderId', 512);
    const folder = await this.requireFolder(folderId, { includeRemoved: true });
    const expectedLifecycleVersion = folder.status === 'removed'
      ? Number(folder.lifecycleVersion) - 1
      : Number(folder.lifecycleVersion);
    if (!Number.isSafeInteger(expectedLifecycleVersion) || expectedLifecycleVersion < 0) {
      throw createRuntimeError('staleFolderLifecycle', 'Library folder lifecycle has changed');
    }
    const count = await this.host.getScanFolderTrackCount({ folderId });
    const total = Number(count.trackCount);
    if (!Number.isSafeInteger(total) || total < 0) {
      throw createRuntimeError('invalidFolderTrackCount', 'Library folder track count is invalid');
    }
    this.emitFolderRemovalEvent({ folderId, phase: 'removing', deleted: 0, total });
    const pathKey = typeof folder.path === 'string' ? filesystemPathKey(folder.path) : null;
    const deletion = this.finishFolderRemoval(folderId, expectedLifecycleVersion, total).then(result => {
      this.emitFolderRemovalEvent({ folderId, phase: 'done', deleted: result.deleted, total });
      return result;
    }, error => {
      this.emitFolderRemovalEvent({ folderId, phase: 'error', deleted: 0, total });
      throw error;
    });
    if (!pathKey) return deletion;
    this.pendingFolderDeletions.set(pathKey, deletion);
    try {
      return await deletion;
    } finally {
      if (this.pendingFolderDeletions.get(pathKey) === deletion) {
        this.pendingFolderDeletions.delete(pathKey);
      }
    }
  }

  async finishFolderRemoval(folderId, expectedLifecycleVersion, total) {
    this.grants.delete(folderId);
    const affected = [...this.scans.values()].filter(record => record.active && record.folderIds.includes(folderId));
    for (const record of affected) record.controller.abort();
    await Promise.all(affected.map(record => record.task?.catch(() => {})));
    let deleted = 0;
    let lastReportedDeleted = 0;
    let lastReportedAt = Date.now();
    let result;
    do {
      result = await this.host.removeScanFolder({
        folderId,
        expectedLifecycleVersion
      });
      deleted += result.deleted ?? 0;
      const now = Date.now();
      if ((result.deleted ?? 0) > 0 && (
        deleted === total ||
        deleted - lastReportedDeleted >= FOLDER_REMOVAL_PROGRESS_TRACK_INTERVAL ||
        now - lastReportedAt >= FOLDER_REMOVAL_PROGRESS_INTERVAL_MS
      )) {
        this.emitFolderRemovalEvent({ folderId, phase: 'removing', deleted, total });
        lastReportedDeleted = deleted;
        lastReportedAt = now;
      }
    } while (result.hasMore === true);
    return { ...result, deleted };
  }

  async requestArtwork(request) {
    assertAllowedFields(request, ['trackUid', 'reason'], 'invalidArtworkRequest');
    const trackUid = requireBoundedString(request.trackUid, 'trackUid', 512);
    const reason = requireBoundedString(request.reason ?? 'viewport', 'reason', 64);
    if (!['viewport', 'viewport-prefetch', 'detail', 'now-playing'].includes(reason)) {
      throw createRuntimeError('invalidArtworkRequest', 'Artwork request reason is invalid');
    }
    const cached = await this.host.getCachedArtwork(trackUid);
    if (cached) return cached;
    const existing = this.artworkRequests.get(trackUid);
    if (existing) return existing;
    const promise = this.extractArtwork(trackUid).finally(() => this.artworkRequests.delete(trackUid));
    this.artworkRequests.set(trackUid, promise);
    return promise;
  }

  async resolvePlaybackSource(trackUid) {
    this.assertOpen();
    const normalizedTrackUid = requireBoundedString(trackUid, 'trackUid', 512);
    const track = await this.host.getTrackStorageIdentity(normalizedTrackUid);
    if (!track) throw createRuntimeError('trackNotFound', 'Track does not exist');
    const folder = await this.requireFolder(track.folderId);
    let grant;
    try {
      grant = this.assertGrant(folder.id, folder.path, folder.lifecycleVersion);
      if (grant.catalogReady === false) {
        throw createRuntimeError('sourceUnavailable', 'Track source is unavailable while the folder is being rescanned');
      }
    } catch (error) {
      if (!['folderAccessRequired', 'folderAccessRevoked'].includes(error?.code)) throw error;
      throw folderPermissionRequired(track);
    }
    let filePath;
    try {
      filePath = await this.resolveGrantedPath(grant, track.relativePath, { allowRoot: false });
      await this.filesystem.access(filePath, fs.constants.R_OK);
    } catch (error) {
      if (['EACCES', 'EPERM', 'folderAccessRequired', 'folderAccessRevoked'].includes(error?.code)) {
        throw folderPermissionRequired(track);
      }
      throw createRuntimeError('sourceUnavailable', 'Track source is unavailable');
    }
    return {
      kind: 'electron-file',
      trackUid: normalizedTrackUid,
      folderId: track.folderId,
      lifecycleVersion: track.lifecycleVersion,
      path: filePath,
      byteLength: Number.isSafeInteger(track.size) && track.size >= 0 ? track.size : null,
      physicalSourceKey: track.physicalSourceKey ?? `${track.folderId}\0${track.relativePath}`,
      sourceKind: track.sourceKind ?? 'file',
      entryKey: track.entryKey ?? null,
      cueRelativePath: track.cueRelativePath ?? null,
      startFrame: track.startFrame ?? null,
      endFrame: track.endFrame ?? null,
      durationSec: track.durationSec ?? null
    };
  }

  async extractArtwork(trackUid) {
    const track = await this.host.getTrackStorageIdentity(trackUid);
    if (!track?.relativePath || !track.fileIdentity || !Number.isSafeInteger(track.size) ||
        !Number.isSafeInteger(track.mtimeMs) || !Number.isSafeInteger(track.lifecycleVersion)) {
      return { kind: 'placeholder' };
    }
    const folder = await this.requireFolder(track.folderId);
    const grant = this.assertGrant(folder.id, folder.path, folder.lifecycleVersion);
    if (grant.catalogReady === false) return { kind: 'placeholder' };
    const filePath = await this.resolveGrantedPath(grant, track.relativePath, { allowRoot: false });
    const preliminaryClaim = {
      folderId: track.folderId,
      lifecycleVersion: track.lifecycleVersion,
      trackUid,
      sourceKind: 'embedded-file',
      canonicalSourceIdentity: track.relativePath,
      fileIdentity: track.fileIdentity,
      size: track.size,
      mtimeMs: track.mtimeMs,
      embeddedOffset: null,
      embeddedLength: null,
      externalArtworkStat: null,
      extractorVersion: ARTWORK_EXTRACTOR_VERSION,
      utilitySessionId: this.utilitySessionId
    };
    const claimedBeforeDispatch = await this.host.claimArtworkSource({ claim: preliminaryClaim });
    if (!claimedBeforeDispatch?.claim) return { kind: 'placeholder' };
    let extracted;
    try {
      extracted = await this.artworkWorkerPool.extract({ filePath });
    } catch (error) {
      await this.host.scheduleArtworkStagingGc({ claim: claimedBeforeDispatch.claim, reason: 'extract-failed' });
      return { kind: 'placeholder', errorCode: sanitizeArtworkErrorCode(error) };
    }
    let source;
    let claimed;
    let externalCover = null;
    if (extracted) {
      source = Buffer.from(extracted.bytes);
      claimed = await this.host.bindArtworkSourceDetails({
        claim: claimedBeforeDispatch.claim,
        fileStat: extracted.fileStat,
        embeddedOffset: extracted.embeddedOffset,
        embeddedLength: extracted.embeddedLength,
        mimeType: extracted.mimeType
      });
    } else {
      await this.host.scheduleArtworkStagingGc({ claim: claimedBeforeDispatch.claim, reason: 'missing' });
      externalCover = track.sourceKind === 'cue-track'
        ? await this.readCueCover(track, grant)
        : null;
      if (!externalCover) return { kind: 'placeholder' };
      source = externalCover.bytes;
      claimed = await this.host.claimArtworkSource({
        claim: {
          ...preliminaryClaim,
          sourceKind: 'external-file',
          canonicalSourceIdentity: externalCover.relativePath,
          externalArtworkStat: externalCover.stat
        }
      });
    }
    if (!claimed?.claim) {
      if (extracted) {
        await this.host.scheduleArtworkStagingGc({ claim: claimedBeforeDispatch.claim, reason: 'stale-source' });
      }
      return { kind: 'placeholder' };
    }
    let thumbnail;
    try {
      thumbnail = normalizeArtworkThumbnail(await this.artworkThumbnailer(source));
    } catch (error) {
      const errorCode = sanitizeArtworkErrorCode(error);
      await this.host.recordArtworkFailure({
        claim: claimed.claim,
        errorCode,
        placeholder: true,
        preserveExistingArtwork: true
      });
      return { kind: 'placeholder', errorCode };
    }
    if (externalCover && !await this.isCueCoverCurrent(externalCover)) {
      await this.host.scheduleArtworkStagingGc({ claim: claimed.claim, reason: 'stale-source' });
      return { kind: 'placeholder' };
    }
    const admissionRequest = {
      claim: claimed.claim,
      estimatedRawBytes: source.byteLength,
      estimatedThumbnailBytes: MAX_ARTWORK_THUMBNAIL_BYTES,
      cachePolicy: { mode: 'persistent', maxBytes: ARTWORK_CACHE_BYTES }
    };
    let preflight = await this.host.preflightArtworkBatch(admissionRequest);
    if (preflight?.code === 'artwork-cache-full') {
      await this.host.evictArtworkCache({
        mode: 'persistent', maxBytes: ARTWORK_CACHE_BYTES,
        requiredBytes: MAX_ARTWORK_THUMBNAIL_BYTES,
        policy: 'lru-access-time-byte-length'
      });
      preflight = await this.host.preflightArtworkBatch(admissionRequest);
    }
    if (preflight?.ok !== true) {
      await this.host.scheduleArtworkStagingGc({ claim: claimed.claim, reason: 'storage-preflight' });
      return { kind: 'placeholder', errorCode: preflight?.code ?? 'insufficientStorage' };
    }
    const result = await this.host.publishArtwork({
      claim: claimed.claim,
      expectedSourceClaim: claimed.claim,
      cachePolicy: { mode: 'persistent', maxBytes: ARTWORK_CACHE_BYTES },
      thumbnail
    });
    return result.committed === true ? result.artwork : { kind: 'placeholder' };
  }

  async readCueCover(track, grant) {
    try {
      const cueDirectory = path.posix.dirname(track.cueRelativePath || '');
      const directoryRelativePath = cueDirectory === '.' ? '' : cueDirectory;
      const directoryPath = await this.resolveGrantedPath(grant, directoryRelativePath, {
        allowRoot: true,
        directory: true
      });
      const entries = await this.filesystem.readdir(directoryPath, { withFileTypes: true });
      const fileName = selectCueCoverFileName(entries, track.relativePath);
      if (!fileName) return null;
      const relativePath = path.posix.join(directoryRelativePath, fileName);
      const filePath = await this.resolveGrantedPath(grant, relativePath, { allowRoot: false });
      const handle = await this.filesystem.open(filePath, 'r');
      try {
        const before = artworkFileStat(await handle.stat());
        if (before.size === 0 || before.size > MAX_ARTWORK_RAW_BYTES) return null;
        const bytes = Buffer.allocUnsafe(before.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
          if (read.bytesRead === 0) break;
          offset += read.bytesRead;
        }
        const after = artworkFileStat(await handle.stat());
        if (offset !== bytes.byteLength || !sameArtworkFileStat(before, after)) return null;
        return {
          relativePath,
          filePath,
          bytes,
          stat: after
        };
      } finally {
        await handle.close().catch(() => {});
      }
    } catch {
      return null;
    }
  }

  async isCueCoverCurrent(cover) {
    try {
      const stats = await this.filesystem.lstat(cover.filePath);
      return !stats.isSymbolicLink() && sameArtworkFileStat(cover.stat, artworkFileStat(stats));
    } catch {
      return false;
    }
  }

  async pickPlaylistImport(request = {}) {
    assertExactFields(request, [], 'invalidPlaylistImportRequest');
    this.assertOpen();
    const result = await this.dialog.showOpenDialog(this.getMainWindow(), {
      title: 'Import Playlist',
      properties: ['openFile'],
      filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'xspf'] }]
    });
    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length !== 1) {
      return { canceled: true };
    }
    return this.issuePlaylistImportGrant(result.filePaths[0]);
  }

  async grantDroppedPlaylistImport(request = {}) {
    assertExactFields(request, ['path'], 'invalidPlaylistImportRequest');
    this.assertOpen();
    return this.issuePlaylistImportGrant(request.path);
  }

  async issuePlaylistImportGrant(selected, {
    token: requestedToken = null,
    includeContentDigest = false,
    signal = null
  } = {}) {
    if (typeof selected !== 'string' || !path.isAbsolute(selected) ||
        !PLAYLIST_EXTENSIONS.has(path.extname(selected).toLowerCase())) {
      throw createRuntimeError('invalidPlaylistImportSource', 'Playlist file is invalid');
    }
    const lexicalPath = path.resolve(selected);
    const lexicalStats = await this.filesystem.lstat(lexicalPath);
    if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink()) {
      throw createRuntimeError('invalidPlaylistImportSource', 'Selected playlist must be a regular file, not a symbolic link');
    }
    const canonicalPath = path.resolve(await this.filesystem.realpath(lexicalPath));
    const stats = await this.filesystem.lstat(canonicalPath);
    if (!stats.isFile() || stats.isSymbolicLink() || !Number.isSafeInteger(Number(stats.size)) ||
        Number(stats.size) > MAX_PLAYLIST_IMPORT_BYTES) {
      throw createRuntimeError('invalidPlaylistImportSource', 'Selected playlist must be a bounded regular file');
    }
    await this.filesystem.access(canonicalPath, fs.constants.R_OK);
    this.prunePlaylistImportGrants();
    if (this.playlistImportGrants.size >= MAX_PLAYLIST_IMPORT_GRANTS) {
      const oldestToken = [...this.playlistImportGrants.entries()]
        .sort((left, right) => left[1].issuedAt - right[1].issuedAt)[0]?.[0];
      if (oldestToken) this.playlistImportGrants.delete(oldestToken);
    }
    const token = requestedToken === null
      ? `playlist_import_${crypto.randomUUID()}`
      : requireBoundedString(requestedToken, 'token', 512);
    const grant = Object.freeze({
      token,
      path: canonicalPath,
      name: path.basename(canonicalPath),
      extension: path.extname(canonicalPath).toLowerCase(),
      fileIdentity: `${String(stats.dev ?? '')}:${String(stats.ino ?? '')}`,
      size: Number(stats.size),
      mtimeMs: Math.round(Number(stats.mtimeMs)),
      origin: this.playlistOriginForPath(canonicalPath),
      issuedAt: Date.now(),
      expiresAt: Date.now() + PLAYLIST_IMPORT_GRANT_TTL_MS
    });
    const contentDigest = includeContentDigest
      ? await this.digestPlaylistImportGrant(grant, { signal })
      : null;
    this.playlistImportGrants.set(token, grant);
    return {
      canceled: false,
      source: {
        kind: 'electron-import-grant', token, name: grant.name, size: grant.size,
        lastModified: grant.mtimeMs, type: ''
      },
      ...(contentDigest === null ? {} : { contentDigest })
    };
  }

  async digestPlaylistImportGrant(grant, { signal } = {}) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of this.openPlaylistImportGrantStream(grant, { signal })) hash.update(chunk);
    return `sha256:${hash.digest('hex')}`;
  }

  async consumePlaylistImportGrant(source) {
    this.assertOpen();
    assertExactFields(
      source,
      ['kind', 'lastModified', 'name', 'size', 'token', 'type'],
      'invalidPlaylistImportSource'
    );
    if (source.kind !== 'electron-import-grant') {
      throw createRuntimeError('invalidPlaylistImportSource', 'Playlist import requires a main-process grant');
    }
    const token = requireBoundedString(source.token, 'token', 512);
    this.prunePlaylistImportGrants();
    const grant = this.playlistImportGrants.get(token);
    this.playlistImportGrants.delete(token);
    if (!grant || source.name !== grant.name || source.size !== grant.size ||
        source.lastModified !== grant.mtimeMs || !PLAYLIST_EXTENSIONS.has(grant.extension)) {
      throw createRuntimeError('playlistImportGrantInvalid', 'Playlist import grant is missing, expired, or stale');
    }
    await this.assertPlaylistImportGrantFile(grant);
    return Object.freeze({
      name: grant.name,
      size: grant.size,
      lastModified: grant.mtimeMs,
      type: '',
      origin: grant.origin,
      stream: () => this.openPlaylistImportGrantStream(grant)
    });
  }

  prunePlaylistImportGrants() {
    const now = Date.now();
    for (const [token, grant] of this.playlistImportGrants) {
      if (grant.expiresAt < now) this.playlistImportGrants.delete(token);
    }
  }

  playlistOriginForPath(canonicalPath) {
    for (const grant of this.grants.values()) {
      try {
        this.assertGrant(grant.folderId, grant.root, grant.lifecycleVersion);
        const relative = path.relative(grant.root, canonicalPath);
        if (
          relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        ) continue;
        return Object.freeze({
          folderId: grant.folderId,
          playlistRelativePath: relative.split(path.sep).join('/'),
          playlistCanonicalPath: canonicalPath,
          root: grant.root
        });
      } catch {
        // Only a current matching folder grant can establish a trusted playlist origin.
      }
    }
    return null;
  }

  async assertPlaylistImportGrantFile(grant) {
    const canonicalPath = path.resolve(await this.filesystem.realpath(grant.path));
    const stats = await this.filesystem.lstat(canonicalPath);
    if (canonicalPath !== grant.path || !matchesPlaylistImportGrantStats(grant, stats)) {
      throw createRuntimeError('playlistImportSourceChanged', 'Playlist import source changed after selection');
    }
  }

  async *openPlaylistImportGrantStream(grant, { signal } = {}) {
    throwIfAborted(signal);
    await this.assertPlaylistImportGrantFile(grant);
    throwIfAborted(signal);
    const handle = await this.filesystem.open(grant.path, 'r');
    let offset = 0;
    try {
      const openedStats = await handle.stat();
      if (!matchesPlaylistImportGrantStats(grant, openedStats)) {
        throw createRuntimeError('playlistImportSourceChanged', 'Playlist import source changed while opening');
      }
      while (offset < grant.size) {
        throwIfAborted(signal);
        const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, grant.size - offset));
        const result = await handle.read(buffer, 0, buffer.length, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
        yield new Uint8Array(buffer.buffer, buffer.byteOffset, result.bytesRead);
      }
      if (offset !== grant.size) {
        throw createRuntimeError('playlistImportSourceChanged', 'Playlist import source ended unexpectedly');
      }
    } finally {
      await handle.close();
    }
  }

  createFilesystemAdapter({ onPlaylistFile = () => {} } = {}) {
    if (typeof onPlaylistFile !== 'function') {
      throw createRuntimeError('invalidScanAdapter', 'Playlist file observer is invalid');
    }
    return {
      enumerateDirectory: input => this.enumerateDirectory({ ...input, onPlaylistFile }),
      statFile: input => this.statFile(input),
      readSmallFile: input => this.readSmallFile(input)
    };
  }

  async *enumerateDirectory({ root, relativeDirectory = '', signal, onPlaylistFile = () => {} } = {}) {
    throwIfAborted(signal);
    const grant = this.grantForRoot(root);
    const directoryPath = await this.resolveGrantedPath(grant, relativeDirectory, { allowRoot: true, directory: true });
    const handle = await this.filesystem.opendir(directoryPath);
    try {
      for await (const entry of handle) {
        throwIfAborted(signal);
        const relativePath = normalizeRelativePath(path.posix.join(
          relativeDirectory.replaceAll('\\', '/'), entry.name
        ));
        try {
          const candidate = await this.resolveGrantedPath(grant, relativePath, { allowRoot: false });
          const stats = await this.filesystem.lstat(candidate);
          if (stats.isSymbolicLink()) {
            yield { kind: 'error', relativePath, phase: 'containment', error: { code: 'symbolic-link-rejected' } };
          } else if (stats.isDirectory()) {
            yield { kind: 'directory', name: entry.name, relativePath };
          } else if (stats.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            yield { kind: 'file', name: entry.name, relativePath, path: candidate };
          } else if (stats.isFile() && path.extname(entry.name).toLowerCase() === CUE_EXTENSION) {
            yield { kind: 'cue', name: entry.name, relativePath, path: candidate };
          } else if (stats.isFile() && PLAYLIST_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            onPlaylistFile({ folderId: grant.folderId, name: entry.name, relativePath, path: candidate });
          }
        } catch (error) {
          yield { kind: 'error', relativePath, phase: 'containment', error: sanitizeError(error) };
        }
      }
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async statFile({ root, entry, signal } = {}) {
    throwIfAborted(signal);
    const grant = this.grantForRoot(root);
    const relativePath = normalizeRelativePath(entry?.relativePath);
    const candidate = await this.resolveGrantedPath(grant, relativePath, { allowRoot: false });
    const stats = await this.filesystem.lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw createRuntimeError('invalidLibraryEntry', 'Library entry is not a regular file');
    }
    throwIfAborted(signal);
    return {
      fileIdentity: `${String(stats.dev ?? '')}:${String(stats.ino ?? '')}`,
      size: Number(stats.size),
      mtimeMs: Math.round(Number(stats.mtimeMs))
    };
  }

  async readSmallFile({ root, relativePath, maximumBytes, signal } = {}) {
    throwIfAborted(signal);
    const grant = this.grantForRoot(root);
    const candidate = await this.resolveGrantedPath(grant, relativePath, { allowRoot: false });
    const handle = await this.filesystem.open(candidate, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw createRuntimeError('invalidLibraryEntry', 'Library entry is not a regular file');
      }
      if (Number(stats.size) > maximumBytes) {
        return { tooLarge: true, size: Number(stats.size), bytes: null };
      }
      const bytes = Buffer.allocUnsafe(maximumBytes + 1);
      let byteLength = 0;
      while (byteLength < bytes.byteLength) {
        throwIfAborted(signal);
        const read = await handle.read(bytes, byteLength, bytes.byteLength - byteLength, byteLength);
        if (read.bytesRead === 0) break;
        byteLength += read.bytesRead;
      }
      throwIfAborted(signal);
      if (byteLength > maximumBytes) return { tooLarge: true, size: byteLength, bytes: null };
      return { tooLarge: false, size: byteLength, bytes: new Uint8Array(bytes.subarray(0, byteLength)) };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async resolveGrantedPath(grant, relativePath, { allowRoot, directory = false } = {}) {
    this.assertGrant(grant.folderId, grant.root, grant.lifecycleVersion);
    const normalized = relativePath === '' && allowRoot ? '' : normalizeRelativePath(relativePath);
    const lexical = normalized === ''
      ? grant.root
      : path.resolve(grant.root, ...normalized.split('/'));
    assertContained(grant.root, lexical, allowRoot);
    const before = await this.filesystem.lstat(lexical);
    if (before.isSymbolicLink()) throw createRuntimeError('symbolicLinkRejected', 'Symbolic links are not scanned');
    const canonical = path.resolve(await this.filesystem.realpath(lexical));
    assertContained(grant.root, canonical, allowRoot);
    const after = await this.filesystem.lstat(canonical);
    if (after.isSymbolicLink()) throw createRuntimeError('symbolicLinkRejected', 'Symbolic links are not scanned');
    if (directory && !after.isDirectory()) throw createRuntimeError('invalidLibraryDirectory', 'Library path is not a directory');
    return canonical;
  }

  grantForRoot(root) {
    const grant = [...this.grants.values()].find(item => sameFilesystemPath(item.root, root));
    if (!grant) throw createRuntimeError('folderAccessRequired', 'Folder access must be granted before scanning');
    this.assertGrant(grant.folderId, root, grant.lifecycleVersion);
    return grant;
  }

  assertGrant(folderId, root, lifecycleVersion) {
    const grant = this.grants.get(folderId);
    if (
      !grant || grant.revoked ||
      !sameFilesystemPath(grant.root, root) ||
      grant.lifecycleVersion !== lifecycleVersion
    ) {
      throw createRuntimeError('folderAccessRevoked', 'Folder access grant is missing or stale');
    }
    return grant;
  }

  issueGrant(folder, canonicalRoot, { catalogReady = true } = {}) {
    this.grants.set(folder.id, Object.freeze({
      folderId: folder.id,
      root: canonicalRoot,
      lifecycleVersion: Number(folder.lifecycleVersion),
      catalogReady,
      issuedAt: Date.now(),
      revoked: false
    }));
  }

  markGrantCatalogReady(folderId, root, lifecycleVersion) {
    const grant = this.grants.get(folderId);
    if (
      !grant || grant.revoked || grant.catalogReady !== false ||
      !sameFilesystemPath(grant.root, root) || grant.lifecycleVersion !== lifecycleVersion
    ) return;
    this.grants.set(folderId, Object.freeze({ ...grant, catalogReady: true }));
  }

  async loadGrantedFolders(folderIds) {
    if (new Set(folderIds).size !== folderIds.length) {
      throw createRuntimeError('invalidScanRequest', 'Folder IDs must be unique');
    }
    const response = await this.host.listScanFolders({ folderIds, includeRemoved: false });
    const byId = new Map(response.folders.map(folder => [folder.id, folder]));
    return folderIds.map(folderId => {
      const folder = byId.get(folderId);
      if (!folder) throw createRuntimeError('folderUnavailable', 'Library folder is unavailable');
      this.assertGrant(folder.id, folder.path, folder.lifecycleVersion);
      return folder;
    });
  }

  async requireFolder(folderId, { includeRemoved = false } = {}) {
    const response = await this.host.listScanFolders({ folderIds: [folderId], includeRemoved });
    const folder = response.folders[0];
    if (!folder) throw createRuntimeError('folderUnavailable', 'Library folder is unavailable');
    return folder;
  }

  async updateFolderStatus(folder, status) {
    if (folder.status === status) return folder;
    const updated = { ...folder, status };
    await this.host.upsertFolders([updated]);
    return updated;
  }

  async pickDirectory() {
    const result = await this.dialog.showOpenDialog(this.getMainWindow(), {
      title: 'Select Music Folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length !== 1) return null;
    return result.filePaths[0];
  }

  async canonicalDirectory(selected) {
    if (typeof selected !== 'string' || !path.isAbsolute(selected)) {
      throw createRuntimeError('invalidFolderPath', 'Selected folder path is invalid');
    }
    const resolved = path.resolve(await this.filesystem.realpath(path.resolve(selected)));
    const stats = await this.filesystem.lstat(resolved);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw createRuntimeError('invalidFolderPath', 'Selected folder must be a real directory');
    }
    await this.filesystem.access(resolved, fs.constants.R_OK);
    return resolved;
  }

  emitScanEvent(record, extra = {}) {
    this.emit('scan-event', { ...publicScanRecord(record), ...extra });
  }

  emitFolderRemovalEvent(event) {
    this.emit('folder-removal-event', {
      ...event,
      remaining: Math.max(0, event.total - event.deleted),
      terminal: event.phase !== 'removing'
    });
  }

  revokeAll(reason) {
    this.grants.clear();
    this.playlistImportGrants.clear();
    for (const record of this.scans.values()) {
      if (record.active) record.controller.abort(reason);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.revokeAll('runtime-close');
    await Promise.all([...this.scans.values()].map(record => record.task?.catch(() => {})));
    await Promise.allSettled([
      this.metadataWorkerPool?.close?.(),
      this.artworkWorkerPool?.close?.()
    ]);
    this.host.removeListener?.('failure', this.handleHostFailure);
    this.removeAllListeners();
  }

  assertOpen() {
    if (this.closed) throw createRuntimeError('scanRuntimeClosed', 'Scan runtime is closed');
  }
}

function matchesPlaylistImportGrantStats(grant, stats) {
  const identity = `${String(stats.dev ?? '')}:${String(stats.ino ?? '')}`;
  return stats.isFile() && !stats.isSymbolicLink() && identity === grant.fileIdentity &&
    Number(stats.size) === grant.size && Math.round(Number(stats.mtimeMs)) === grant.mtimeMs;
}

function defaultImageAdapter() {
  try {
    return require('electron')?.nativeImage ?? null;
  } catch {
    return null;
  }
}

function createArtworkThumbnail(source, imageAdapter = defaultImageAdapter()) {
  const bytes = Buffer.from(source);
  if (!imageAdapter?.createFromBuffer) {
    throw createRuntimeError('artwork-thumbnail-unavailable', 'Artwork decoder is unavailable');
  }
  let image = imageAdapter.createFromBuffer(bytes);
  if (!image || image.isEmpty?.()) {
    throw createRuntimeError('artwork-decode-failed', 'Artwork could not be decoded');
  }
  const original = image.getSize();
  assertArtworkDecodeAdmission({
    rawByteLength: bytes.byteLength,
    width: original.width,
    height: original.height
  });
  const scale = Math.min(1, 512 / original.width, 512 / original.height);
  const width = Math.max(1, Math.round(original.width * scale));
  const height = Math.max(1, Math.round(original.height * scale));
  if (scale < 1) image = image.resize({ width, height, quality: 'good' });
  for (const quality of [86, 72, 58, 44]) {
    const thumbnailBytes = image.toJPEG(quality);
    if (thumbnailBytes.byteLength <= MAX_ARTWORK_THUMBNAIL_BYTES) {
      return {
        bytes: new Uint8Array(thumbnailBytes), width, height, mimeType: 'image/jpeg'
      };
    }
  }
  throw createRuntimeError('artworkThumbnailTooLarge', 'Artwork thumbnail exceeds the byte limit');
}

function normalizeArtworkThumbnail(value) {
  const source = value?.bytes;
  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : null;
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ARTWORK_THUMBNAIL_BYTES ||
      !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 512 ||
      !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 512 ||
      value.mimeType !== 'image/jpeg') {
    throw createRuntimeError('artwork-thumbnail-invalid', 'Artwork thumbnail is invalid');
  }
  return {
    bytes: new Uint8Array(bytes),
    width: value.width,
    height: value.height,
    mimeType: value.mimeType
  };
}

function assertArtworkDecodeAdmission({ rawByteLength, width, height }) {
  if (!Number.isSafeInteger(rawByteLength) || rawByteLength <= 0 || rawByteLength > MAX_ARTWORK_RAW_BYTES) {
    throw createRuntimeError('artworkRawTooLarge', 'Artwork raw bytes exceed the decode limit');
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      width > MAX_ARTWORK_SOURCE_DIMENSION || height > MAX_ARTWORK_SOURCE_DIMENSION) {
    throw createRuntimeError('artworkDimensionsTooLarge', 'Artwork dimensions exceed the decode limit');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_ARTWORK_SOURCE_PIXELS || pixels * 4 > MAX_ARTWORK_DECODED_BYTES) {
    throw createRuntimeError('artworkDecodeTooLarge', 'Artwork decoded bytes exceed the decode limit');
  }
}

function sanitizeArtworkErrorCode(error) {
  const code = String(error?.code || 'artwork-decode-failed');
  return /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(code) ? code : 'artwork-decode-failed';
}

function artworkFileStat(stats) {
  const size = Number(stats?.size);
  const mtimeMs = Math.round(Number(stats?.mtimeMs));
  if (!stats?.isFile?.() || !Number.isSafeInteger(size) || size < 0 ||
      !Number.isSafeInteger(mtimeMs) || mtimeMs < 0) {
    throw createRuntimeError('artwork-decode-failed', 'Artwork source is not a regular file');
  }
  return {
    fileIdentity: `${String(stats.dev ?? '')}:${String(stats.ino ?? '')}`,
    size,
    mtimeMs
  };
}

function sameArtworkFileStat(left, right) {
  return left.fileIdentity === right.fileIdentity && left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string') throw createRuntimeError('invalidRelativePath', 'Relative path is invalid');
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    normalized.length === 0 || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) ||
    segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) throw createRuntimeError('invalidRelativePath', 'Relative path is invalid');
  return segments.join('/');
}

function assertContained(root, candidate, allowRoot) {
  const relative = path.relative(root, candidate);
  if (relative === '') {
    if (allowRoot) return;
    throw createRuntimeError('pathOutsideGrant', 'A file path must be below its granted root');
  }
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw createRuntimeError('pathOutsideGrant', 'A path escaped its granted root');
  }
}

function sameFilesystemPath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return filesystemPathKey(left) === filesystemPathKey(right);
}

function compareFilesystemRoots(candidate, existing) {
  if (sameFilesystemPath(candidate, existing)) return 'same';
  if (isPathDescendant(candidate, existing)) return 'ancestor';
  if (isPathDescendant(existing, candidate)) return 'descendant';
  return 'separate';
}

function isPathDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function filesystemPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function publicFolder(folder) {
  return {
    id: folder.id,
    displayName: folder.displayName,
    status: folder.status,
    scanGeneration: Number(folder.scanGeneration),
    lifecycleVersion: Number(folder.lifecycleVersion),
    lastScanAt: folder.lastScanAt ?? null
  };
}

function isTerminalScanStatus(status) {
  return status === 'completed' || status === 'completed-no-sweep';
}

function withPlaylistImportSummary(result, playlistImports) {
  return Object.freeze({
    ...result,
    playlistImportState: playlistImports.state ??
      (playlistImports.canceled > 0 ? 'playlist-import-canceled' : 'completed'),
    counts: Object.freeze({
      ...(result?.counts ?? {}),
      playlistsFound: playlistImports.found,
      playlistsImported: playlistImports.imported,
      playlistsAlreadyImported: playlistImports.alreadyImported,
      playlistImportFailures: playlistImports.failed,
      playlistImportsCanceled: playlistImports.canceled ?? 0
    }),
    playlistImports
  });
}

function publicScanRecord(record) {
  return {
    scanId: record.scanId,
    folderIds: [...record.folderIds],
    active: record.active,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    results: record.results.map(result => ({
      folderId: result.folderId,
      generation: result.generation,
      status: result.status,
      continuityBroken: result.continuityBroken,
      sweepEligibility: result.sweepEligibility,
      playlistImportState: result.playlistImportState,
      counts: result.counts,
      warnings: Array.isArray(result.warnings) ? result.warnings.map(warning => ({
        category: warning.category,
        count: warning.count,
        samples: Array.isArray(warning.samples)
          ? warning.samples.slice(0, MAX_PUBLIC_SCAN_WARNING_SAMPLES).map(sample => ({
              code: sample.code,
              path: sample.path
            }))
          : []
      })) : []
    })),
    error: record.error
  };
}

function normalizeScanRequest(value) {
  if (value == null) return { folderIds: null };
  if (Array.isArray(value)) return { folderIds: value };
  return value;
}

function normalizeLanguageHints(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createRuntimeError('invalidLanguageHints', 'Metadata language hints are invalid');
  }
  assertAllowedFields(
    value,
    ['language', 'languagePreference', 'browserLanguage', 'browserLanguages'],
    'invalidLanguageHints'
  );
  const normalized = {};
  for (const field of ['language', 'languagePreference', 'browserLanguage']) {
    const text = normalizeLanguageHint(value[field]);
    if (text) normalized[field] = text;
  }
  if (value.browserLanguages !== undefined) {
    if (!Array.isArray(value.browserLanguages) || value.browserLanguages.length > 8) {
      throw createRuntimeError('invalidLanguageHints', 'Metadata browser languages are invalid');
    }
    const browserLanguages = value.browserLanguages
      .map(normalizeLanguageHint)
      .filter(Boolean);
    if (browserLanguages.length) normalized.browserLanguages = browserLanguages;
  }
  return Object.keys(normalized).length ? Object.freeze(normalized) : null;
}

function normalizeLanguageHint(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 128) {
    throw createRuntimeError('invalidLanguageHints', 'Metadata language hint text is invalid');
  }
  return value.trim();
}

function normalizeScanReason(value) {
  if (value === undefined) return 'explicit-rescan';
  const reason = requireBoundedString(value, 'scanReason', 64);
  if (!['automatic', 'explicit-rescan'].includes(reason)) {
    throw createRuntimeError('invalidScanRequest', 'Scan reason is invalid');
  }
  return reason;
}

function validateStringList(value, field, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw createRuntimeError('invalidScanRequest', `${field} must be a bounded string array`);
  }
  return value.map(item => requireBoundedString(item, field, maximumLength));
}

function requireBoundedString(value, field, maximumLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw createRuntimeError('invalidRequest', `${field} must be a bounded string`);
  }
  return value;
}

function assertExactFields(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createRuntimeError(code, 'Request must be an object');
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw createRuntimeError(code, 'Request fields do not match the control contract');
  }
}

function assertAllowedFields(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createRuntimeError(code, 'Request must be an object');
  }
  const allowed = new Set(fields);
  if (Object.keys(value).some(field => !allowed.has(field))) {
    throw createRuntimeError(code, 'Request contains unsupported fields');
  }
}

function sanitizeError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code.slice(0, 128) : 'unknown-error',
    message: typeof error?.message === 'string' ? error.message.slice(0, 512) : 'Library scan failed'
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Library scan was canceled');
  error.name = 'AbortError';
  error.code = 'scanCanceled';
  throw error;
}

function createRuntimeError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'LibraryCatalogScanRuntimeError';
  error.code = code;
  error.details = details;
  return error;
}

function folderPermissionRequired(track) {
  return createRuntimeError(
    'folderPermissionRequired',
    'Playback folder access must be restored',
    { folderId: track.folderId, lifecycleVersion: track.lifecycleVersion }
  );
}

module.exports = {
  AUDIO_EXTENSIONS,
  createArtworkThumbnail,
  LibraryCatalogScanRuntime
};
