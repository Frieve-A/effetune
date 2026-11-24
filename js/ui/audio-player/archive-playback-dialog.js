import { LIBRARY_STYLESHEET } from '../../utils/app-stylesheets.js';
import { loadStylesheet } from '../../utils/classic-script-loader.js';
import { escapeHtml } from '../../utils/escape-html.js';
import { ICONS, nextDialogId, removeElement, setupModalFocus } from '../library/library-view-shared.js';

export function chooseArchivePlaybackEntries(entries, { archiveCount, signal, t }) {
    if (signal?.aborted) return Promise.resolve([]);
    loadStylesheet(LIBRARY_STYLESHEET);
    const dialogId = nextDialogId('archive-playback');
    const label = key => escapeHtml(t(key));
    const backdrop = document.createElement('div');
    backdrop.className = 'library-dialog-backdrop';
    backdrop.innerHTML = `
        <form class="library-properties-dialog library-properties-dialog-scrollable" role="dialog" aria-modal="true" aria-labelledby="${dialogId}-title">
            <div class="library-properties-head">
                <h2 id="${dialogId}-title">${label('midi.archive.chooseFiles')}</h2>
                <button type="button" class="library-icon-button library-dialog-close" aria-label="${label('library.dialog.close')}">${ICONS.close}</button>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 14px;">
                <button type="button" class="library-button" data-select-all>${label('library.paged.selectAll')}</button>
                <button type="button" class="library-button" data-deselect-all>${label('library.paged.deselectAll')}</button>
            </div>
            <div class="library-properties-body" style="display: grid; gap: 4px; padding: 0 14px;">
                ${entries.map(({ archiveName, path }) => `
                    <label style="display: flex; align-items: flex-start; gap: 8px; overflow-wrap: anywhere;">
                        <input type="checkbox" checked>
                        <span>${escapeHtml(archiveCount > 1 ? `${archiveName}: ${path}` : path)}</span>
                    </label>
                `).join('')}
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; padding: 14px;">
                <button type="button" class="library-button" data-cancel>${label('library.action.cancel')}</button>
                <button type="submit" class="library-button">${label('midi.archive.open')}</button>
            </div>
        </form>`;
    const form = backdrop.querySelector('form');
    const open = form.querySelector('button[type="submit"]');
    const checkboxes = Array.from(form.querySelectorAll('input[type="checkbox"]'));
    const updateOpenButton = () => { open.disabled = !checkboxes.some(checkbox => checkbox.checked); };

    return new Promise(resolve => {
        let restoreFocus;
        const finish = selected => {
            signal?.removeEventListener('abort', cancel);
            removeElement(backdrop);
            restoreFocus?.();
            resolve(selected);
        };
        const cancel = () => finish([]);
        const selectAll = checked => {
            for (const checkbox of checkboxes) checkbox.checked = checked;
            updateOpenButton();
        };
        signal?.addEventListener('abort', cancel, { once: true });
        form.addEventListener('change', updateOpenButton);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const selected = entries.filter((_, index) => checkboxes[index].checked);
            if (selected.length) finish(selected);
        });
        form.querySelector('[data-select-all]').addEventListener('click', () => selectAll(true));
        form.querySelector('[data-deselect-all]').addEventListener('click', () => selectAll(false));
        form.querySelector('[data-cancel]').addEventListener('click', cancel);
        form.querySelector('.library-dialog-close').addEventListener('click', cancel);
        backdrop.addEventListener('click', event => { if (event.target === backdrop) cancel(); });
        backdrop.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        });
        document.body.appendChild(backdrop);
        restoreFocus = setupModalFocus(backdrop, checkboxes[0], null, form.querySelector('.library-properties-body'));
    });
}
