import { selectCueCoverFileName } from '../library/metadata/cue-cover.js';
import {
  WebFileSystemScanAdapter,
  queryFolderPermission
} from '../library/scan/web-file-system-adapter.js';
import { WebFolderHandleStore } from '../library/scan/web-folder-handle-store.js';

const CUE_AUDIO_EXTENSIONS = new Set(['flac', 'wav']);
const CUE_COVER_EXTENSIONS = new Set(['jpg', 'png']);

export async function resolveWebCueSiblingFiles({
  cueFileHandle,
  parsedCue,
  signal,
  handleStore = new WebFolderHandleStore(),
  filesystemFactory = rootHandle => new WebFileSystemScanAdapter({ rootHandle })
} = {}) {
  if (cueFileHandle?.kind !== 'file' || typeof cueFileHandle.getFile !== 'function') {
    throw sourceAccessError('cue-file-handle-unavailable');
  }
  if (!parsedCue?.ok) throw sourceAccessError('cue-parse-result-unavailable');

  let matchedFolder = false;
  let permissionRequired = false;
  try {
    const storedFolders = await handleStore.list({ limit: 1_000 });
    for (const stored of storedFolders) {
      throwIfAborted(signal);
      const rootHandle = stored?.handle;
      if (rootHandle?.kind !== 'directory' || typeof rootHandle.resolve !== 'function') continue;

      let cuePathParts;
      try {
        cuePathParts = await rootHandle.resolve(cueFileHandle);
      } catch {
        continue;
      }
      if (!Array.isArray(cuePathParts) || cuePathParts.length === 0) continue;
      matchedFolder = true;

      if (await queryFolderPermission(rootHandle) !== 'granted') {
        let permission = 'denied';
        try {
          permission = typeof rootHandle.requestPermission === 'function'
            ? await rootHandle.requestPermission({ mode: 'read' })
            : 'denied';
        } catch {
          permission = 'denied';
        }
        if (permission !== 'granted') {
          permissionRequired = true;
          continue;
        }
      }

      const relativeDirectory = cuePathParts.slice(0, -1).join('/');
      const filesystem = filesystemFactory(rootHandle);
      const fileNames = await filesystem.listFileNames(relativeDirectory, signal);
      const audioNames = resolveReferencedAudioNames(parsedCue, fileNames);
      if (!audioNames) continue;

      const selectedNames = new Set(audioNames);
      for (const audioName of audioNames) {
        const coverName = selectCueCoverFileName(fileNames, audioName);
        if (coverName && CUE_COVER_EXTENSIONS.has(extensionOf(coverName))) selectedNames.add(coverName);
      }

      const files = [];
      for (const fileName of selectedNames) {
        throwIfAborted(signal);
        const relativePath = relativeDirectory ? `${relativeDirectory}/${fileName}` : fileName;
        files.push(await filesystem.getFile(relativePath, signal));
      }
      return files;
    }
  } finally {
    handleStore.close?.();
  }

  throw sourceAccessError(permissionRequired
    ? 'cue-folder-permission-required'
    : matchedFolder
      ? 'cue-referenced-files-unavailable'
      : 'cue-not-in-registered-folder');
}

function resolveReferencedAudioNames(parsedCue, fileNames) {
  const availableAudioNames = fileNames.filter(name => CUE_AUDIO_EXTENSIONS.has(extensionOf(name)));
  const resolved = [];
  for (const cueFile of parsedCue.files) {
    if (cueFile.audioTrackCount === 0) continue;
    const exactName = String(cueFile.reference).normalize('NFC');
    const exact = availableAudioNames.filter(name => String(name).normalize('NFC') === exactName);
    if (exact.length === 1) {
      resolved.push(exact[0]);
      continue;
    }
    if (exact.length > 1) return null;
    const foldedName = exactName.toLowerCase();
    const compatible = availableAudioNames.filter(name =>
      String(name).normalize('NFC').toLowerCase() === foldedName
    );
    if (compatible.length !== 1) return null;
    resolved.push(compatible[0]);
  }
  return [...new Set(resolved)];
}

function extensionOf(name) {
  const value = String(name ?? '');
  const index = value.lastIndexOf('.');
  return index < 0 ? '' : value.slice(index + 1).toLowerCase();
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Selection aborted', 'AbortError');
}

function sourceAccessError(diagnosticCode) {
  const error = new Error('The CUE source files are not accessible');
  error.name = 'PlaybackSelectionError';
  error.code = 'cueSelectionSourceAccessRequired';
  error.diagnosticCode = diagnosticCode;
  return error;
}
