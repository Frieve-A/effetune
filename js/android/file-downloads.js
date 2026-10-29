import { isAndroidHost } from './bridge.js';
import { AndroidDocuments } from './documents.js';

export function installAndroidFileDownloads(windowRef = globalThis.window) {
    if (!isAndroidHost(windowRef)) return;
    const documents = new AndroidDocuments();
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
        void blob.then(async data => {
            const selected = await documents.pick({ kind: 'export', name: filename,
                mimeType: data.type || 'application/octet-stream' });
            await documents.write(selected.uri, data);
            if (selected.share) await documents.bridge.request('documents.share', {
                uri: selected.uri, mimeType: data.type || 'application/octet-stream'
            });
        }).catch(error => {
            if (error.name === 'AbortError') return;
            console.error('Android file export failed:', error);
            windowRef.uiManager?.setError?.('error.fileExportFailed', true);
        });
    }, true);
}
