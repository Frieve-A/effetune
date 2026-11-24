import { AndroidDocuments } from '../android/documents.js';
import { isAndroidHost } from '../android/bridge.js';
import { collectDiagnosticFile } from './diagnostic-bundle.js';

async function saveFile(win, file, androidDocuments) {
    if (win.electronAPI) {
        const result = await win.electronAPI.showSaveDialog({
            defaultPath: file.name, filters: [{ name: 'Text', extensions: ['txt'] }]
        });
        if (result.canceled) return null;
        const saved = await win.electronAPI.saveFile(result.filePath, file.text);
        if (!saved?.success) throw new Error('Diagnostic file write failed');
        return 'saved';
    }
    const blob = new Blob([file.text], { type: 'text/plain;charset=utf-8' });
    if (isAndroidHost(win)) {
        const documents = androidDocuments || new AndroidDocuments();
        try {
            const selected = await documents.pick({ kind: 'save', name: file.name, mimeType: 'text/plain' });
            await documents.write(selected.uri, blob);
        } catch (error) {
            if (error?.name === 'AbortError') return null;
            throw error;
        }
        return 'saved';
    }
    const link = win.document.createElement('a');
    link.download = file.name;
    link.href = URL.createObjectURL(blob);
    try {
        win.document.body.appendChild(link);
        link.click();
    } finally {
        link.remove();
        URL.revokeObjectURL(link.href);
    }
    return 'download';
}

export async function openDiagnosticDialog({
    win = window, translate = (_, fallback) => fallback, collect = collectDiagnosticFile, androidDocuments
} = {}) {
    const doc = win.document;
    if (doc.getElementById('diagnosticTitle')) return;
    const previousFocus = doc.activeElement;
    const element = (tag, className, text) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const overlay = element('div', 'backup-restore-overlay');
    const dialog = element('section', 'backup-restore-dialog diagnostic-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'diagnosticTitle');
    const header = element('div', 'backup-restore-header');
    const title = element('h2', '', translate('diagnostics.title', 'Diagnostic Information'));
    title.id = 'diagnosticTitle';
    header.appendChild(title);
    const overview = element('div', 'diagnostic-summary', translate('diagnostics.loading', 'Collecting information…'));
    overview.tabIndex = 0;
    const fileSection = element('div', 'diagnostic-file');
    fileSection.append(element('h3', '', translate('diagnostics.fileTitle', 'Detailed diagnostic file')),
        element('p', '', translate('diagnostics.intro',
            'This file contains app and audio settings, selected audio device names, recent activity and errors. Nothing is sent automatically.')),
        element('p', '', translate('diagnostics.privacy',
            'Recognized paths, track names and web addresses are replaced, but some may remain. Check the contents before attaching the file. You can edit it after saving.')));
    const details = element('details');
    const summary = element('summary', '', translate('diagnostics.preview', 'Show file contents'));
    const preview = element('pre');
    details.append(summary, preview);
    const status = element('div', 'backup-restore-status');
    status.setAttribute('role', 'status');
    const actions = element('div', 'backup-restore-actions');
    const save = element('button', 'backup-restore-primary', translate('browser.save', 'Save'));
    const close = element('button', '', translate('backupRestore.action.close', 'Close'));
    save.type = close.type = 'button';
    save.disabled = true;
    actions.append(save, close);
    fileSection.appendChild(details);
    dialog.append(header, overview, fileSection, status, actions);
    overlay.appendChild(dialog);
    const dismiss = () => {
        overlay.remove();
        previousFocus?.focus?.();
    };
    close.addEventListener('click', dismiss);
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') dismiss();
        if (event.key === 'Tab' && ((event.shiftKey && doc.activeElement === overview) ||
            (!event.shiftKey && doc.activeElement === close))) {
            event.preventDefault();
            (event.shiftKey ? close : overview).focus();
        }
    });
    const showFailure = error => {
        console.error('Diagnostic file export:', error);
        status.textContent = translate('error.fileExportFailed', 'The file could not be saved. Select another location and try again.');
    };
    doc.body.appendChild(overlay);
    overview.focus();
    try {
        const file = await collect(win, translate);
        overview.textContent = file.summary;
        preview.textContent = file.text;
        save.disabled = false;
        save.addEventListener('click', async () => {
            save.disabled = true;
            status.textContent = '';
            try {
                const result = await saveFile(win, file, androidDocuments);
                if (result === 'saved') status.textContent = translate('diagnostics.saved', 'File saved.');
                if (result === 'download') status.textContent = translate('diagnostics.download', 'Download started.');
            } catch (error) { showFailure(error); }
            finally { save.disabled = false; }
        });
    } catch (error) { showFailure(error); }
}
