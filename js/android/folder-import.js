import { AndroidDocuments } from './documents.js';
import { AndroidDocumentFile } from './library-io.js';

function validateEntryName(name) {
    if (!name || /[\\/]/.test(name) || ['.', '..'].includes(name)) {
        throw new Error('The folder contains an invalid file name');
    }
}

// Keep folder-relative references for the existing IR and SFZ importers.
export async function selectAndroidFolderFiles({ isCurrent } = {}, documents = new AndroidDocuments()) {
    const root = await documents.pick({ kind: 'tree' });
    validateEntryName(root.name);
    const files = [];
    async function visit(uri, prefix, depth) {
        if (depth > 32) throw new RangeError('The selected folder is nested too deeply');
        let offset = 0;
        do {
            if (isCurrent?.() === false) throw new DOMException('Import cancelled', 'AbortError');
            const page = await documents.list(uri, offset);
            for (const entry of page.entries) {
                validateEntryName(entry.name);
                const path = `${prefix}/${entry.name}`;
                if (entry.isDirectory) await visit(entry.uri, path, depth + 1);
                else {
                    const file = new AndroidDocumentFile(entry);
                    file.webkitRelativePath = path;
                    files.push(file);
                }
            }
            if (page.nextOffset != null && page.nextOffset <= offset) throw new Error('Invalid folder page');
            offset = page.nextOffset;
        } while (offset != null);
    }
    await visit(root.uri, root.name, 0);
    return files;
}
