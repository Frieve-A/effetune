import { requestAndroidDocument, AndroidDocumentFile } from './library-io.js';
import { isSupportedLibraryPath, isSupportedCuePath, isSupportedPlaylistPath } from '../library/constants.js';

export class AndroidLibraryFilesystem {
    constructor({ rootHandle, includeVideo = false, onPlaylistFile = () => {} }) {
        this.uri = rootHandle.androidUri;
        this.includeVideo = includeVideo;
        this.onPlaylistFile = onPlaylistFile;
    }

    async resolve(relativePath) {
        if (!relativePath) return { uri: this.uri };
        if (relativePath.split('/').some(part => part === '..' || part === '.' || !part)) {
            throw new Error('Invalid document path');
        }
        return requestAndroidDocument('documents.resolve', { treeUri: this.uri, relativePath });
    }

    async *entries(relativeDirectory = '', signal) {
        const directory = await this.resolve(relativeDirectory);
        let offset = 0;
        for (;;) {
            signal?.throwIfAborted();
            const page = await requestAndroidDocument('documents.list', { uri: directory.uri, offset, limit: 256 });
            signal?.throwIfAborted();
            const entries = page.entries;
            if (!Array.isArray(entries) || entries.length > 256) throw new Error('Invalid document listing');
            for (const entry of entries) yield entry;
            if (page.nextOffset == null) return;
            if (!entries.length) throw new Error('Document listing did not advance');
            if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error('Invalid document listing offset');
            offset = page.nextOffset;
        }
    }

    async *enumerateDirectory({ relativeDirectory = '', signal } = {}) {
        for await (const entry of this.entries(relativeDirectory, signal)) {
            if (!entry.name || /[\\/]/.test(entry.name) || ['.', '..'].includes(entry.name)) continue;
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            const record = { name: entry.name, relativePath, path: relativePath };
            if (entry.isDirectory) yield { ...record, kind: 'directory' };
            else if (isSupportedLibraryPath(relativePath, this.includeVideo)) yield { ...record, kind: 'file' };
            else if (isSupportedCuePath(relativePath)) yield { ...record, kind: 'cue' };
            else if (isSupportedPlaylistPath(relativePath)) this.onPlaylistFile(record);
        }
    }

    async getFile(relativePath, signal) {
        signal?.throwIfAborted();
        const entry = await this.resolve(relativePath);
        const stat = await requestAndroidDocument('documents.stat', { uri: entry.uri });
        signal?.throwIfAborted();
        if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error('Document size is unavailable');
        return new AndroidDocumentFile({ ...stat, uri: entry.uri });
    }

    async statFile({ entry, signal }) {
        const file = await this.getFile(entry.relativePath, signal);
        return { fileIdentity: file.androidUri, size: file.size, mtimeMs: file.lastModified };
    }

    async listFileNames(directory, signal) {
        const names = [];
        for await (const entry of this.entries(directory, signal)) if (!entry.isDirectory) names.push(entry.name);
        return names;
    }

    async readSmallFile({ relativePath, maximumBytes, signal }) {
        const file = await this.getFile(relativePath, signal);
        if (file.size > maximumBytes) return { tooLarge: true, size: file.size, bytes: null };
        return { tooLarge: false, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
    }
}
