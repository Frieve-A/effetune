import { escapeHtml } from '../../utils/escape-html.js';
import { formatDuration, ICONS, isMobileLayout } from './library-view-shared.js';
import { SegmentedVirtualGridGeometry } from './segmented-virtual-grid.js';

export const LIBRARY_NAV_VIEWS = Object.freeze([
  'tracks', 'albums', 'artists', 'genres', 'subfolders', 'files', 'folders', 'recent', 'playlists'
]);
export const VIEW_LABELS = Object.freeze(Object.fromEntries(LIBRARY_NAV_VIEWS.map(view => [
  view, `library.nav.${view === 'recent' ? 'recentlyAdded' : view}`
])));
export const FILE_SORT_COLUMNS = [
  { key: 'path', labelKey: 'library.column.path' },
  { key: 'duration', labelKey: 'library.column.duration' }
];

export function libraryNavItem(view, label, active, count) {
  return `<button type="button" class="library-nav-item${active ? ' active' : ''}" data-view="${escapeHtml(view)}"${active ? ' aria-current="page"' : ''}>
    <span class="library-nav-label">${escapeHtml(label)}</span>
    <span class="library-count"${Number.isSafeInteger(count) ? '' : ' hidden'}>${Number.isSafeInteger(count) ? count : ''}</span>
  </button>`;
}

export function libraryEntityCard(title, caption, { artwork = '<span class="library-paged-artwork" aria-hidden="true"><span></span></span>', playLabel, playDisabled = false } = {}) {
  return `${artwork}
    <span class="library-paged-entity-title library-card-title">${escapeHtml(title)}</span>
    <span class="library-card-subtitle">${escapeHtml(caption)}</span>
    <button type="button" class="library-paged-entity-open library-album-open" aria-label="${escapeHtml(title)}"></button>
    ${playLabel ? `<button type="button" class="library-card-play" tabindex="-1" title="${escapeHtml(playLabel)}" aria-label="${escapeHtml(`${playLabel} ${title}`)}"${playDisabled ? ' disabled' : ''}>${ICONS.play}</button>` : ''}`;
}

export function libraryFolderMain(title, caption) {
  return `<button type="button" class="library-paged-folder-main">
    <span class="library-paged-folder-title">${escapeHtml(title)}</span>
    ${caption ? `<span class="library-paged-folder-secondary">${escapeHtml(caption)}</span>` : ''}
  </button>`;
}

export function libraryDetailHeading(title, count, tracksLabel, backLabel) {
  return `${libraryButton(backLabel, { className: 'library-back', icon: ICONS.back, iconOnly: true })}
    <div class="library-paged-artwork library-paged-detail-artwork" aria-hidden="true"><span></span></div>
    <div><h2>${escapeHtml(title)}</h2><p>${count ?? '…'} ${escapeHtml(tracksLabel)}</p></div>`;
}

export function createLibraryBreadcrumbs(crumbs, title, current, navigate) {
  const breadcrumbs = document.createElement('nav');
  breadcrumbs.className = 'library-folder-breadcrumbs';
  breadcrumbs.setAttribute('aria-label', title);
  const visible = crumbs.length <= 4 ? crumbs : [crumbs[0], crumbs[1], { label: '…', path: null }, ...crumbs.slice(-2)];
  visible.forEach((crumb, index) => {
    if (index > 0) breadcrumbs.append(' / ');
    const element = document.createElement(crumb.path === null ? 'span' : 'button');
    element.textContent = crumb.label;
    if (crumb.path !== null) {
      element.type = 'button';
      element.className = 'library-folder-breadcrumb';
      element.disabled = crumb.path === current;
      element.addEventListener('click', () => navigate(crumb.path));
    }
    breadcrumbs.appendChild(element);
  });
  return breadcrumbs;
}

export function createLibraryEntityGridGeometry(itemCount, containerWidth, mediaCards) {
  const width = Math.max(176, containerWidth || 176);
  const columns = Math.max(1, Math.min(12, Math.floor((width + 16) / 192)));
  const cardWidth = (width - 16 * (columns - 1)) / columns;
  const baseRowHeight = isMobileLayout() ? 196 : 224;
  return new SegmentedVirtualGridGeometry({ itemCount, containerWidth: width,
    rowHeight: mediaCards ? Math.max(baseRowHeight, Math.ceil(cardWidth + 48 + 16)) : baseRowHeight });
}

export function createLibrarySortControl(fields, preference, applySort, translate) {
  const label = document.createElement('label');
  label.className = 'library-entity-sort-control';
  const labelText = document.createElement('span');
  labelText.textContent = translate('library.sort.label');
  const select = document.createElement('select');
  select.className = 'library-entity-sort-select';
  select.setAttribute('aria-label', translate('library.sort.label'));
  for (const field of fields) for (const direction of ['asc', 'desc']) {
    const option = document.createElement('option');
    option.value = `${field.sort}:${direction}`;
    option.textContent = `${translate(field.labelKey)} — ${translate(direction === 'asc' ? 'library.sort.ascending' : 'library.sort.descending')}`;
    option.selected = field.sort === preference.sort && direction === preference.direction;
    select.appendChild(option);
  }
  select.value = `${preference.sort}:${preference.direction}`;
  select.addEventListener('change', event => applySort(event.currentTarget?.value ?? select.value));
  label.appendChild(labelText);
  label.appendChild(select);
  return label;
}

export function librarySortHeader(column, preference, translate) {
  const active = preference.sort === column.key;
  const direction = preference.direction === 'desc' ? 'desc' : 'asc';
  const label = translate(column.labelKey);
  const ariaSort = active ? (direction === 'desc' ? 'descending' : 'ascending') : 'none';
  const ariaLabel = active
    ? translate(direction === 'desc' ? 'library.sort.sortedDescending' : 'library.sort.sortedAscending', { column: label })
    : translate('library.sort.sortBy', { column: label });
  const indicator = active ? ICONS[direction === 'desc' ? 'down' : 'up'] : '';
  return `<span class="library-sort-cell${active ? ' active' : ''}" role="columnheader" aria-sort="${ariaSort}">
    <button type="button" class="library-sort-button${active ? ' active' : ''}" data-sort="${escapeHtml(column.key)}" aria-label="${escapeHtml(ariaLabel)}">
      <span class="library-sort-label">${escapeHtml(label)}</span>
      <span class="library-sort-indicator" aria-hidden="true">${indicator}</span>
    </button>
  </span>`;
}

export const TRACK_COLUMNS = [
  { key: 'trackNo', labelKey: 'library.column.trackNo' },
  { key: 'title', labelKey: 'library.column.title' },
  { key: 'artist', labelKey: 'library.column.artist' },
  { key: 'album', labelKey: 'library.column.album' },
  { key: 'genre', labelKey: 'library.column.genre' },
  { key: 'duration', labelKey: 'library.column.duration' }
];

export function libraryButton(label, { className = '', icon = '', disabled = false, title = label, iconOnly = false } = {}) {
  return `<button type="button" class="${iconOnly ? 'library-icon-button' : 'library-button'} ${className}" title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}"${disabled ? ' disabled' : ''}>${icon}${iconOnly ? '' : `<span>${escapeHtml(label)}</span>`}</button>`;
}

export function libraryMain(actions) {
  return `<div class="library-main">
    <header class="library-header">
      <div class="library-search-wrap"><input class="library-search" type="search" autocomplete="off" spellcheck="false"></div>
      <div class="library-header-actions">${actions}</div>
    </header>
    <div class="library-content" tabindex="0"></div>
    <footer class="library-status"></footer>
  </div>`;
}

export function librarySectionHeading(title, status, backLabel = '') {
  return `${backLabel ? libraryButton(backLabel, { className: 'library-back', icon: ICONS.back, iconOnly: true }) : ''}
    <h2>${escapeHtml(title)}</h2><span>${escapeHtml(status)}</span>`;
}

export function libraryTrackHeader(columns, { selectLabel, favoriteLabel, moreLabel }) {
  return `<span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(selectLabel)}"></span>
    <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(favoriteLabel)}"></span>
    ${columns}
    <span class="library-track-control-header" role="columnheader" aria-label="${escapeHtml(moreLabel)}"></span>`;
}

export function libraryTrackCells(item, {
  title, selectLabel, moreLabel, selected = false, nowPlaying = false, fileRow = false,
  favorite = '', status = '', artist = escapeHtml(item.artist || item.albumArtist || ''), album = escapeHtml(item.album || '')
}) {
  return `<span class="library-paged-select-cell" role="gridcell"><input class="library-paged-select" type="checkbox" aria-label="${escapeHtml(selectLabel)}"${selected ? ' checked' : ''}></span>
    <span class="library-paged-favorite-cell" role="gridcell">${favorite}</span>
    ${fileRow ? '' : `<span class="library-track-number-cell" role="gridcell">${escapeHtml(item.trackNo ?? '')}</span>`}
    <span class="library-track-title" role="gridcell"${fileRow ? ` title="${escapeHtml(title)}"` : ''}><span class="library-now-playing-indicator" aria-hidden="true" ${nowPlaying ? '' : 'hidden'}>♪</span><span class="library-track-title-text">${escapeHtml(title)}</span>${status}</span>
    ${fileRow ? '' : `<span class="library-artist-cell" role="gridcell">${artist}</span><span class="library-album-cell" role="gridcell">${album}</span><span class="library-genre-cell" role="gridcell">${escapeHtml(item.genre || '')}</span>`}
    <span class="library-duration-cell" role="gridcell">${formatDuration(item.durationSec)}</span>
    <span class="library-paged-more-cell" role="gridcell">${libraryButton(moreLabel, { className: 'library-paged-row-more', icon: ICONS.more, iconOnly: true })}</span>`;
}

export function libraryFolderCells(name, count = '') {
  return `<span class="library-folder-directory-icon" aria-hidden="true">📁</span>
    <span class="library-folder-directory-name">${escapeHtml(name)}</span>
    <span class="library-folder-directory-count">${escapeHtml(String(count))}</span>`;
}

export function createLibraryMessage(message, { error = false, retryLabel, retry } = {}) {
  const region = document.createElement(error ? 'section' : 'p');
  region.className = error ? 'library-paged-error' : 'library-paged-loading';
  region.setAttribute('role', error ? 'alert' : 'status');
  if (error) {
    region.innerHTML = `<p>${escapeHtml(message)}</p>${libraryButton(retryLabel, { className: 'library-paged-retry' })}`;
    region.querySelector('.library-paged-retry')?.addEventListener('click', retry);
  } else region.textContent = message;
  return region;
}

export function bindLibrarySearchInput(input, schedule, cancel) {
  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
    cancel();
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    schedule();
  });
  input.addEventListener('input', event => {
    if (!composing && !event.isComposing) schedule();
  });
}

// The same pointer gestures apply to local catalog rows and network browse rows.
export function bindLibraryTrackPointer(row, { isSelected, select, play, contextMenu, selectionMode, enterSelectionMode }) {
  const checkbox = row.querySelector('.library-paged-select');
  checkbox?.addEventListener('click', event => { checkbox._pagedShiftKey = event.shiftKey === true; });
  checkbox?.addEventListener('change', event => {
    select(event.target.checked, { extend: checkbox._pagedShiftKey === true });
    checkbox._pagedShiftKey = false;
  });
  let suppressNextClick = false;
  let longPressHandled = false;
  let touchTimer = null;
  const clearTouchTimer = () => {
    if (touchTimer === null) return;
    clearTimeout(touchTimer);
    touchTimer = null;
  };
  const selectFromLongPress = event => {
    if (!isMobileLayout()) return;
    event.preventDefault?.();
    suppressNextClick = true;
    longPressHandled = true;
    if (isSelected()) { enterSelectionMode(); return; }
    const dispatched = select(true, { exclusive: true });
    if (dispatched?.accepted !== false && dispatched?.value?.accepted !== false) enterSelectionMode();
  };
  row.addEventListener('click', event => {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (event.target?.closest?.('button, input, a, [role="menuitem"]')) return;
    if (isMobileLayout()) {
      if (selectionMode()) select(!isSelected());
      else if (!(event.detail > 1)) play();
      return;
    }
    const additive = event.ctrlKey === true || event.metaKey === true;
    select(additive ? !isSelected() : true, { exclusive: !additive && event.shiftKey !== true, extend: event.shiftKey === true });
  });
  row.addEventListener('dblclick', event => {
    if (event.target?.closest?.('button, input, a, [role="menuitem"]') || isMobileLayout()) return;
    play();
  });
  row.addEventListener('contextmenu', event => {
    const touchPending = touchTimer !== null;
    clearTouchTimer();
    if (isMobileLayout() && (touchPending || longPressHandled)) {
      if (longPressHandled) event.preventDefault?.();
      else selectFromLongPress(event);
      return;
    }
    contextMenu(event);
  });
  row.addEventListener('touchstart', event => {
    clearTouchTimer();
    suppressNextClick = false;
    longPressHandled = false;
    touchTimer = setTimeout(() => { touchTimer = null; selectFromLongPress(event); }, 520);
  }, { passive: false });
  row.addEventListener('touchend', clearTouchTimer);
  for (const type of ['touchmove', 'touchcancel']) row.addEventListener(type, () => {
    clearTouchTimer();
    if (!longPressHandled) suppressNextClick = false;
  });
  row.querySelector('.library-paged-row-more')?.addEventListener('click', event => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect?.() || { left: 16, bottom: 16 };
    contextMenu({ preventDefault() {}, clientX: rect.left, clientY: rect.bottom + 4 }, event.currentTarget);
  });
}
