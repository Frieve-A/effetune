import { getAndroidBridge, isAndroidHost } from './bridge.js';
import { AndroidDocuments } from './documents.js';

export function shareAndroidContent(payload) {
    return getAndroidBridge().request('documents.share', payload);
}

export async function exportAndroidFile(blob, filename, translate, { signal, onWriteProgress } = {}) {
    const documents = new AndroidDocuments();
    const mimeType = blob.type || 'application/octet-stream';
    const shareLabel = translate('fileExport.android.share');
    const selected = await documents.pick({ kind: 'export', name: filename, mimeType,
        saveLabel: translate('fileExport.android.save'), shareLabel });
    await documents.write(selected.uri, blob, {
        signal,
        onProgress: onWriteProgress && (progress => onWriteProgress({ ...progress, share: selected.share }))
    });
    if (!selected.share) return 'saved';
    await shareAndroidContent({ uri: selected.uri, mimeType, title: shareLabel });
    return 'shareOpened';
}

export function installAndroidFileDownloads(
    windowRef = globalThis.window,
    onError = () => windowRef.uiManager?.setError?.('error.fileExportFailed', true),
    translate = key => windowRef.uiManager?.t?.(key)
) {
    if (!isAndroidHost(windowRef)) return;
    windowRef.document.addEventListener('click', event => {
        const link = event.target?.closest?.('a[download]');
        if (!link) return;
        const url = new URL(link.href, windowRef.location.href);
        if (!['blob:', 'data:'].includes(url.protocol) && url.origin !== windowRef.location.origin) return;
        event.preventDefault();
        const filename = link.download || 'EffeTune';
        // Read immediately: callers normally revoke their Blob URL after click().
        const blob = fetch(url.href).then(response => {
            if (!response.ok) throw new Error('Export data is unavailable');
            return response.blob();
        });
        void blob.then(data => exportAndroidFile(data, filename, translate)).catch(error => {
            if (error.name === 'AbortError') return;
            console.error('Android file export failed:', error);
            onError(error);
        });
    }, true);
}
