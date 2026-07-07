import { comparePathRoots } from './root-containment.js';

export class ElectronLibrarySource {
  constructor(api) {
    this.api = api;
    this.kind = 'electron';
    this.capabilities = {
      persistentFolders: true,
      absolutePaths: true,
      showInFolder: true
    };
  }

  async pickFolder() {
    const result = await this.api.selectFolder();
    if (!result || result.canceled || !result.path) return null;
    return {
      kind: 'electron',
      path: result.path,
      displayName: result.displayName || result.path.split(/[\\/]/).filter(Boolean).pop() || result.path
    };
  }

  async checkFolder(folder) {
    const result = await this.api.validateRoots([folder.path]);
    const status = result?.[0];
    if (!status?.exists) return 'missing';
    return status.readable ? 'ok' : 'needs-permission';
  }

  async requestAccess(folder) {
    if ((await this.checkFolder(folder)) === 'ok') return true;
    const picked = await this.pickFolder();
    if (!picked?.path) return false;
    const candidate = {
      ...folder,
      path: picked.path,
      displayName: picked.displayName
    };
    if ((await this.checkFolder(candidate)) !== 'ok') return false;
    folder.path = candidate.path;
    folder.displayName = candidate.displayName;
    return true;
  }

  async compareFolder(candidate, existing) {
    return comparePathRoots(candidate?.path, existing?.path);
  }

  scan(options, sink) {
    const scanId = options.scanId;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    let eventQueue = Promise.resolve();
    const settleAfterQueue = (settle, value) => {
      eventQueue = eventQueue.then(() => settle(value), error => {
        rejectDone(error);
        settle(value);
      });
    };
    const enqueueScanEvent = event => {
      if (event.scanId === scanId) {
        eventQueue = eventQueue.then(async () => {
          await sink(event);
          if (event.type === 'done') {
            settleAfterQueue(resolveDone, event);
          } else if (event.type === 'error' && event.fatal) {
            settleAfterQueue(rejectDone, new Error(event.reason || 'Library scan failed'));
          } else if (event.type === 'error' && event.canceled) {
            settleAfterQueue(resolveDone, event);
          }
        }).catch(error => {
          rejectDone(error);
        });
      }
    };
    const unsubscribe = this.api.onScanEvent(event => {
      enqueueScanEvent(event);
    });
    let cancelRequested = false;
    const request = {
      ...options,
      roots: (options.folders || []).map(folder => ({
        folderId: folder.id,
        id: folder.id,
        path: folder.path
      }))
    };
    this.api.scanStart(request).then(result => {
      if (!result?.success) {
        for (const folderError of result?.folderErrors || []) {
          enqueueScanEvent({
            ...folderError,
            scanId,
            type: 'error',
            fatal: true
          });
        }
        const error = new Error(result?.error || 'Failed to start library scan');
        if (result?.activeScanId) {
          error.activeScanId = result.activeScanId;
        }
        settleAfterQueue(rejectDone, error);
      }
    }).catch(rejectDone);
    return {
      done: done.finally(() => {
        if (typeof unsubscribe === 'function') unsubscribe();
      }),
      cancel: () => {
        cancelRequested = true;
        this.api.scanCancel(scanId);
      },
      get canceled() {
        return cancelRequested;
      }
    };
  }

  async resolveForPlayback(track) {
    return { path: this.getAbsoluteTrackPath(track) };
  }

  async readArtwork(track) {
    const path = this.getAbsoluteTrackPath(track);
    return path ? this.api.readArtwork({ path }) : null;
  }

  async showInFolder(track) {
    const path = this.getAbsoluteTrackPath(track);
    if (!path) return false;
    const result = await this.api.showInFolder(path);
    return result?.success !== false;
  }

  getAbsoluteTrackPath(track = {}) {
    if (track.path) return track.path;
    if (track.absolutePath) return track.absolutePath;
    const folderPath = track.folderPath || track.folder?.path;
    return folderPath && track.relativePath
      ? `${folderPath.replace(/[\\/]+$/, '')}/${track.relativePath}`
      : null;
  }

  async syncFolders(folders) {
    if (typeof this.api.saveFolders !== 'function') return { success: true, skipped: true };
    return this.api.saveFolders((folders || []).map(folder => ({
      id: folder.id,
      kind: folder.kind,
      displayName: folder.displayName,
      path: folder.path || null,
      addedAt: folder.addedAt || null,
      lastScanAt: folder.lastScanAt || null,
      lastScanStats: folder.lastScanStats || null,
      status: folder.status || 'unknown'
    })));
  }

  async loadMirroredFolders() {
    if (typeof this.api.loadFolders !== 'function') return [];
    const result = await this.api.loadFolders();
    if (!result?.success || !Array.isArray(result.folders)) return [];
    return result.folders.filter(folder => folder?.path).map(folder => ({
      ...folder,
      kind: folder.kind || 'electron',
      handle: null
    }));
  }
}
