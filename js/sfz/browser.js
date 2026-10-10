import { openAssetLibraryBrowser, translateLibraryMessage } from '../ui/asset-library-browser.js';
import { enumerateSfzDirectory, listSfzFolderFiles } from './service.js';

const messages = {
  title: 'SFZ Library',
  'aria.dialog': 'SFZ library',
  'aria.search': 'Search SFZ instruments',
  'aria.sort': 'Sort SFZ instruments',
  empty: 'No matching SFZ instruments.',
  'confirm.delete': 'Delete “{name}” from the library? This cannot be undone.',
  'confirm.deleteSelected': 'Delete {count} selected SFZ instruments from the library? This cannot be undone.',
  'status.inUse': 'This SFZ is in use by an effect pipeline and cannot be deleted.',
  'status.deleted': 'SFZ deleted.',
  'status.deleteFailed': 'The SFZ could not be deleted.',
  'status.deletingSelected': 'Deleting {count} selected SFZ instruments…',
  'error.load': 'The SFZ could not be loaded. Check its sample files or choose another instrument.',
  'error.delete': 'The SFZ could not be deleted. Please try again.',
  'error.fileTooLarge': 'This SFZ exceeds the size limit. Increase SFZ size limit in Config → General, or choose a smaller SFZ.',
  'badge.sizeUnknown': 'size unknown',
  'badge.files': 'Files: {count}',
  'badge.regions': 'Regions: {count}',
  'badge.unavailable': 'Information unavailable'
};

function translate(key, fallback, params) {
  if (Object.hasOwn(messages, key)) {
    const messageKey = key === 'error.fileTooLarge' ? 'sfzNotePlayer.error.tooLarge' : `sfzLibrary.${key}`;
    return translateLibraryMessage(messageKey, messages[key], params);
  }
  return translateLibraryMessage(`irLibrary.${key}`, fallback, params);
}

function formatBadge(entry) {
  const size = Number.isSafeInteger(entry.size) && entry.size >= 0
    ? entry.size >= 1048576 ? `${(entry.size / 1048576).toFixed(1)} MiB`
      : entry.size >= 1024 ? `${(entry.size / 1024).toFixed(1)} KiB` : `${entry.size} B`
    : translate('badge.sizeUnknown');
  return [size,
    entry.fileCount !== undefined && translate('badge.files', '', { count: entry.fileCount }),
    entry.regionCount !== undefined && translate('badge.regions', '', { count: entry.regionCount })
  ].filter(Boolean).join(' · ');
}

export function openSfzLibraryBrowser({ service, decode, ...options } = {}) {
  if (!service) throw new TypeError('SFZ library service is required.');
  const metadata = new Map();
  let metadataWork = Promise.resolve();
  let closed = false;
  const native = typeof service.selectFolder === 'function';

  const importFiles = async (files, { isCurrent, onProgress }) => {
    const paths = listSfzFolderFiles(files);
    const result = { imported: [], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
    if (!paths.length) throw Object.assign(new Error('No SFZ files in selection'), { code: 'no-regions' });
    for (const path of paths) {
      if (!isCurrent()) break;
      onProgress({ totalCount: paths.length, completedCount: result.imported.length + result.failedCount,
        importedCount: result.imported.length, failedCount: result.failedCount, currentFiles: [path] });
      try {
        const entry = await service.importFolderFiles(files, path, { decode });
        metadata.delete(entry.id);
        result.imported.push(entry);
      } catch (error) {
        console.error('SFZ library import failed:', path, error);
        result.failedCount++;
        result.failureCodes.push(error?.code === 'too-large' ? 'file-too-large' : error?.code);
      }
      onProgress({ totalCount: paths.length, completedCount: result.imported.length + result.failedCount,
        importedCount: result.imported.length, failedCount: result.failedCount,
        entry: result.imported.at(-1) });
    }
    return result;
  };

  const register = async (method, options) => {
    const entries = await service[method](options);
    return { imported: entries || [], failedCount: 0, unsupportedCount: 0 };
  };

  return openAssetLibraryBrowser({
    ...options,
    onClose() {
      closed = true;
      options.onClose?.();
    },
    service: {
      async list({ query = '', sort = 'filename' }) {
        const entries = (await service.list()).filter(entry =>
          entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
        const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
        return entries.sort(sort === 'recent'
          ? (a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')) || byName(a, b)
          : byName);
      },
      async delete(id, { isInUse }) {
        if (isInUse(id)) return { removed: false, reason: 'in-use' };
        const exists = (await service.list()).some(entry => entry.id === id);
        if (!exists) return { removed: false };
        await service.remove(id);
        metadata.delete(id);
        return { removed: true };
      },
      importFiles,
      async importDirectory(directory, options) {
        return importFiles(await enumerateSfzDirectory(directory, options), options);
      }
    },
    translate,
    formatBadge,
    decorateEntry(row, entry, badge) {
      if (!service.readMetadata || entry.size !== undefined && entry.fileCount !== undefined) return;
      if (!metadata.has(entry.id)) {
        const pending = metadataWork.then(() => closed ? null : service.readMetadata(entry.id));
        metadata.set(entry.id, pending);
        metadataWork = pending.catch(() => {});
      }
      metadata.get(entry.id).then(details => {
        badge.textContent = details ? formatBadge({ ...entry, ...details }) : translate('badge.unavailable');
      }).catch(error => {
        console.error('SFZ library metadata failed:', error);
        badge.textContent = translate('badge.unavailable');
      });
    },
    accept: '.sfz,.wav,.wave,.aif,.aiff,.flac,.mp3,.ogg,.m4a,.inc,.xml',
    folderAccept: '',
    folderFallback: true,
    kind: 'SFZ',
    ...(native && {
      chooseFiles: options => register('selectFiles', options),
      chooseFolder: options => register('selectFolder', options)
    })
  });
}
