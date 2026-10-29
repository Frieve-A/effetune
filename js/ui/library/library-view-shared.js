export const PAGED_DEFAULT_SELECT_ALL_LIMIT = 300;

export const ICONS = {
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  shuffle: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
  next: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5v14l9-7z"/><path d="M17 5h2v14h-2z"/></svg>',
  queue: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h11M4 18h7"/><path d="M17 15v6M14 18h6"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  add: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  duplicate: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  drag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 16h10l1-16"/></svg>',
  up: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  down: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
  export: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  import: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>',
  recent: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>',
  starFilled: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.7 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

export const FOCUSABLE_DIALOG_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

let libraryDialogId = 0;

export const PLAYLIST_PICKER_FOCUS_TIMEOUT_MS = 1000;

export const LIBRARY_SEARCH_DEBOUNCE_MS = 100;

export function getLibraryEnterOperation(event) {
  return event.ctrlKey || event.metaKey ? 'queue' : event.shiftKey ? 'playNext' : 'play';
}

export const DETAIL_VIEW_BY_TYPE = Object.freeze({
  album: 'albums',
  artist: 'artists',
  genre: 'genres',
  subfolder: 'subfolders',
  folder: 'folders',
  playlist: 'playlists'
});

export const PAGED_SEARCH_ENTITY_TYPES = Object.freeze(['album', 'artist', 'playlist']);

export const WEB_PLAYLIST_BLOB_EXPORT_MAX_BYTES = 32 * 1024 * 1024;

export class WebPlaylistExportLimitError extends Error {
  constructor(limitBytes, actualBytes) {
    super(`Playlist export exceeds the ${limitBytes}-byte browser limit.`);
    this.name = 'WebPlaylistExportLimitError';
    this.code = 'playlistExportTooLarge';
    this.limitBytes = limitBytes;
    this.actualBytes = actualBytes;
  }
}

export function getPagedPlaylistTarget(playlist) {
  const playlistId = playlist?.playlistId ?? playlist?.id;
  const expectedTargetVersion = Number(playlist?.version);
  if (typeof playlistId !== 'string' || !playlistId ||
      !Number.isSafeInteger(expectedTargetVersion) || expectedTargetVersion < 0) {
    return { accepted: false, reason: 'playlist-version-unavailable' };
  }
  return {
    accepted: true,
    target: { playlistId, name: playlist?.name ?? '' },
    expectedTargetVersion
  };
}

export function setClass(element, className, enabled) {
  if (!element?.classList) return;
  if (typeof element.classList.toggle === 'function') {
    element.classList.toggle(className, enabled);
  } else if (enabled) {
    element.classList.add?.(className);
  } else {
    element.classList.remove?.(className);
  }
}

export function isMobileLayout() {
  return globalThis.document?.body?.classList.contains('layout-mobile');
}

export function isEditableTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.() || '';
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
}

export function isTextEditingTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.() || '';
  if (tagName === 'textarea' || target?.isContentEditable) return true;
  if (tagName !== 'input') return false;
  const type = String(target?.type || target?.getAttribute?.('type') || 'text').toLowerCase();
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

export function hasClassName(element, className) {
  if (element?.classList?.contains?.(className)) return true;
  return String(element?.className || '').split(/\s+/).includes(className);
}

export function getRestorableFocusElement(element) {
  if (!element || typeof element.focus !== 'function') return null;
  if (element.disabled || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return null;
  if ('isConnected' in element && !element.isConnected) return null;
  return element;
}

export function getActiveLibraryDialogBackdrop() {
  const fromQuery = document.querySelector?.('.library-dialog-backdrop');
  if (fromQuery) return fromQuery;
  return Array.from(document.body?.children || [])
    .find(element => hasClassName(element, 'library-dialog-backdrop')) || null;
}

export function nextDialogId(prefix) {
  libraryDialogId += 1;
  return `${prefix}-${libraryDialogId}`;
}

export function setupModalFocus(backdrop, initialFocus = null, returnFocus = null, scrollContainer = null) {
  const previousFocus = getRestorableFocusElement(returnFocus) || getRestorableFocusElement(document.activeElement);
  const onKeyDown = event => {
    if (event.key !== 'Tab') return;
    const focusable = getFocusableDialogElements(backdrop);
    if (!focusable.length) {
      event.preventDefault?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !focusable.includes(active)) {
        event.preventDefault?.();
        focusElementWithoutScroll(last, scrollContainer);
      }
      return;
    }
    if (active === last || !focusable.includes(active)) {
      event.preventDefault?.();
      focusElementWithoutScroll(first, scrollContainer);
    }
  };
  backdrop.addEventListener?.('keydown', onKeyDown);
  focusElementWithoutScroll(initialFocus || getFocusableDialogElements(backdrop)[0] || backdrop, scrollContainer);
  return () => {
    backdrop.removeEventListener?.('keydown', onKeyDown);
    focusElementWithoutScroll(getRestorableFocusElement(previousFocus), scrollContainer);
  };
}

export function focusElementWithoutScroll(element, scrollContainer = null) {
  if (!element?.focus) return;
  const scrollTop = Number(scrollContainer?.scrollTop);
  element.focus({ preventScroll: true });
  if (Number.isFinite(scrollTop) && scrollContainer) scrollContainer.scrollTop = scrollTop;
}

export function getFocusableDialogElements(container) {
  return Array.from(container?.querySelectorAll?.(FOCUSABLE_DIALOG_SELECTOR) || [])
    .filter(element => !element.disabled && !element.hidden && element.getAttribute?.('aria-hidden') !== 'true');
}

export function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatTrackNumber(track) {
  if (!track?.trackNo) return '';
  const total = track.trackTotal ?? track.trackOf;
  return total ? `${track.trackNo}/${total}` : String(track.trackNo);
}

export function formatNumber(value, suffix = '') {
  return Number.isFinite(value) ? `${value}${suffix}` : '';
}

export function joinDisplayPath(root, relativePath) {
  const base = String(root || '').replace(/[\\/]+$/, '');
  const separator = base.includes('\\') ? '\\' : '/';
  const relative = String(relativePath || '').replace(/[\\/]+/g, separator).replace(/^[\\/]+/, '');
  return relative ? `${base}${separator}${relative}` : base;
}

export function isCueTrackDetails(value) {
  const sourceKind = value?.sourceKind ?? value?.source_kind;
  const entryKey = value?.entryKey ?? value?.entry_key;
  return sourceKind === 'cue-track' ||
    typeof entryKey === 'string' && entryKey.startsWith('cue:') ||
    Boolean(value?.cueRelativePath && Number.isSafeInteger(value?.startFrame));
}

export function formatCueTrackRegion(startFrame, endFrame, sourceEndLabel) {
  if (!Number.isSafeInteger(startFrame) || startFrame < 0) return '';
  const start = formatCueFrameTime(startFrame);
  if (endFrame === null) return `${start} – ${sourceEndLabel}`;
  if (!Number.isSafeInteger(endFrame) || endFrame <= startFrame) return '';
  return `${start} – ${formatCueFrameTime(endFrame)}`;
}

export function formatCueFrameTime(frame) {
  const wholeSeconds = Math.floor(frame / 75);
  const milliseconds = Math.round((frame % 75) * 1000 / 75);
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60) % 60;
  const hours = Math.floor(wholeSeconds / 3600);
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `${clock}.${String(milliseconds).padStart(3, '0')}`;
}

export function encodePlaylistExportChunk(chunk) {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk.slice(0));
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }
  throw new TypeError('Playlist export chunks must be strings or byte arrays.');
}

export function sanitizeFileName(value) {
  return String(value || 'playlist')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/./g, char => char.charCodeAt(0) < 32 ? '_' : char)
    .replace(/\s+/g, ' ')
    .trim() || 'playlist';
}

export function createFolderDirKey(folderId, path = '') {
  return `${folderId.length}:${folderId}${path}`;
}

export function decodeFolderDirKey(value) {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  const lengthText = value.slice(0, separator);
  if (separator <= 0 || !/^\d+$/.test(lengthText)) return null;
  const folderIdLength = Number(lengthText);
  if (!Number.isSafeInteger(folderIdLength) || folderIdLength <= 0) return null;
  const start = separator + 1;
  const folderId = value.slice(start, start + folderIdLength);
  return folderId.length === folderIdLength ? { folderId, path: value.slice(start + folderIdLength) } : null;
}

export function normalizeFolderDetail(detail) {
  if (!detail) return null;
  if (detail.type === 'folder') {
    return {
      type: 'folderNode',
      folderId: detail.folderId ?? detail.key,
      path: '',
      title: detail.title || ''
    };
  }
  return { ...detail };
}

export function createFolderNavigationKey(folderId, path) {
  return `${folderId}\0${path}`;
}

export function assertElectronFileResult(result) {
  if (!result?.success) throw new Error(result?.error || 'Playlist file operation failed.');
  return result;
}

export function removeElement(element) {
  if (!element) return;
  if (typeof element.remove === 'function') {
    element.remove();
  } else {
    element.parentNode?.removeChild?.(element);
  }
}

export function isPlaylistFileName(name = '') {
  return /\.(m3u8?|pls|xspf)$/i.test(String(name));
}

export function hasPlaylistFiles(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  if (files.some(file => isPlaylistFileName(file.name))) return true;
  const types = Array.from(dataTransfer?.types || []);
  return types.includes('Files') && files.length === 0;
}

export function clampMenuToViewport(menu) {
  if (!menu?.style || typeof window === 'undefined') return;
  const rect = menu.getBoundingClientRect?.();
  if (!rect) return;
  const maxLeft = Math.max(4, (window.innerWidth || 0) - rect.width - 4);
  const maxTop = Math.max(4, (window.innerHeight || 0) - rect.height - 4);
  const left = Number.parseFloat(menu.style.left) || 0;
  const top = Number.parseFloat(menu.style.top) || 0;
  menu.style.left = `${Math.min(Math.max(4, left), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(4, top), maxTop)}px`;
}
