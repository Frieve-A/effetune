import { FsaLibrarySource } from './fsa-library-source.js';
import { createFallbackDisplayName, normalizeRelativePath } from '../constants.js';

export class ImportLibrarySource extends FsaLibrarySource {
  constructor(windowRef = globalThis.window) {
    super(windowRef);
    this.kind = 'import';
    this.capabilities = {
      persistentFolders: false,
      absolutePaths: false,
      showInFolder: false
    };
    this.sessionFiles = new Map();
  }

  async pickFolder() {
    const files = await this.pickDirectoryFiles();
    if (!files || files.length === 0) return null;
    const rootName = inferRootName(files);
    const folder = {
      kind: 'import',
      path: null,
      handle: null,
      displayName: rootName
    };
    folder.files = files;
    return folder;
  }

  async checkFolder() {
    return 'needs-permission';
  }

  async requestAccess(folder) {
    const picked = await this.pickFolder();
    if (!picked?.files) return false;
    folder.files = picked.files;
    this.replaceSessionFiles(folder.id, picked.files);
    return true;
  }

  scan(options, sink) {
    const folders = options.folders.map(folder => {
      const files = folder.files || [];
      this.replaceSessionFiles(folder.id, files);
      return {
        ...folder,
        handle: {
          async *values() {
            for (const file of files) {
              yield {
                kind: 'file',
                name: normalizeImportPath(file),
                getFile: async () => file
              };
            }
          }
        }
      };
    });
    return super.scan({ ...options, folders }, sink);
  }

  replaceSessionFiles(folderId, files = []) {
    if (!folderId) return;
    this.releaseFolder(folderId);
    files.forEach(file => {
      const relativePath = normalizeImportPath(file);
      this.sessionFiles.set(`${folderId}/${relativePath}`, file);
    });
  }

  releaseFolder(folderId) {
    if (!folderId) return;
    const prefix = `${folderId}/`;
    for (const key of [...this.sessionFiles.keys()]) {
      if (key.startsWith(prefix)) {
        this.sessionFiles.delete(key);
      }
    }
  }

  async resolveForPlayback(track) {
    const key = `${track.folderId}/${track.relativePath}`;
    const file = this.sessionFiles.get(key);
    if (!file) throw new Error('Imported file is offline. Re-import the folder.');
    return { file };
  }

  pickDirectoryFiles() {
    return new Promise(resolve => {
      const win = this.windowRef;
      const input = win.document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.webkitdirectory = true;
      input.style.display = 'none';
      let settled = false;
      let focusTimer = null;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (focusTimer !== null) clearTimeout(focusTimer);
        win.removeEventListener?.('focus', onFocus);
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      };
      const onFocus = () => {
        // 'change'/'cancel' fire after the window regains focus; give them time first.
        focusTimer = setTimeout(settle, 1000);
      };
      input.addEventListener('change', settle, { once: true });
      // Browsers fire 'cancel' (not 'change') when the picker dialog is dismissed.
      input.addEventListener('cancel', settle, { once: true });
      // Fallback for browsers without the 'cancel' event.
      win.addEventListener?.('focus', onFocus, { once: true });
      win.document.body.appendChild(input);
      input.click();
    });
  }
}

function inferRootName(files) {
  const first = files[0];
  const path = first?.webkitRelativePath || first?.name || '';
  return path.split(/[\\/]/)[0] || createFallbackDisplayName(path) || 'Imported Folder';
}

function normalizeImportPath(file) {
  const raw = file.webkitRelativePath || file.name;
  const parts = String(raw).replace(/\\/g, '/').split('/').filter(Boolean);
  return normalizeRelativePath(parts.length > 1 ? parts.slice(1).join('/') : parts.join('/'));
}
