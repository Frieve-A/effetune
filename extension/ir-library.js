import { IrLibraryService } from '../js/ir-library/service.js';

// The editor holds only a read-only view. All storage and decoded-IR cache
// mutations belong to the single service in the Offscreen document.
export class ExtensionIrLibraryClient {
    constructor(client) {
        this.client = client;
        this.entries = [];
        this.view = new IrLibraryService({
            list: () => this.entries,
            get: id => this.entries.find(entry => entry.irId === id) || null
        });
        this.store = { updateAnalysis: (irId, analysis) => this.request('updateAnalysis', { irId, analysis }) };
    }

    list(options) { return this.view.list(options); }
    get(irId) { return this.view.get(irId); }
    refresh() { return this.request('list'); }
    readAnalysis(irId) { return this.request('readAnalysis', { irId }); }

    async request(method, args = {}) {
        const response = await this.client.request('irLibrary', { method, ...args });
        this.entries = response.entries;
        return response.value;
    }

    async import(method, args, options) {
        const operationId = crypto.randomUUID();
        const progress = event => {
            if (event.detail.operationId === operationId) options.onProgress?.(event.detail.progress);
        };
        this.client.addEventListener('irLibraryProgress', progress);
        let cancelled = false;
        const timer = setInterval(() => {
            if (!cancelled && options.isCurrent?.() === false) {
                cancelled = true;
                this.client.channel.postMessage({ kind: 'cancelIrImport', clientId: this.client.id, operationId });
            }
        }, 100);
        try {
            if (options.isCurrent?.() === false) return { imported: [], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
            return await this.request(method, { ...args, operationId, strictPair: options.strictPair === true });
        } finally {
            clearInterval(timer);
            this.client.removeEventListener('irLibraryProgress', progress);
        }
    }

    importFiles(files, options = {}) {
        return this.import('importFiles', { files: Array.from(files, file => ({
            file,
            name: file.name,
            relativePath: file.webkitRelativePath || ''
        })) }, options);
    }

    importDirectory(directory, options = {}) { return this.import('importDirectory', { directory }, options); }

    delete(irId, options = {}) {
        if (options.activeIds?.has?.(irId) || options.isInUse?.(irId)) return Promise.resolve({ removed: false, reason: 'in-use' });
        return this.request('delete', { irId });
    }

    async resolveDecodedPcm(irId, sampleRate, options = {}) {
        if (options.isCurrent?.() === false) return null;
        const pcm = await this.request('resolveDecodedPcm', { irId, sampleRate });
        return options.isCurrent?.() === false ? null : pcm;
    }
}

export class ExtensionIrLibraryHost {
    constructor(service, { decode, resample, isInUse, onProgress }) {
        this.service = service;
        this.adapters = { decode, resample };
        this.isInUse = isInUse;
        this.onProgress = onProgress;
        this.cancelled = new Set();
    }

    cancel(clientId, operationId) { this.cancelled.add(`${clientId}:${operationId}`); }

    async request(args, clientId) {
        const { method, irId, operationId } = args;
        const key = `${clientId}:${operationId}`;
        const options = { strictPair: args.strictPair === true,
            isCurrent: () => !this.cancelled.has(key),
            onProgress: progress => this.onProgress({ clientId, operationId, progress }) };
        let value;
        try {
            if (method === 'list') value = null;
            else if (method === 'importFiles') {
                const files = args.files.map(({ file, name, relativePath }) => ({
                    name, size: file.size, webkitRelativePath: relativePath,
                    arrayBuffer: () => file.arrayBuffer()
                }));
                value = await this.service.importFiles(files, options);
            } else if (method === 'importDirectory') value = await this.service.importDirectory(args.directory, options);
            else if (method === 'delete') value = await this.service.delete(irId, { isInUse: this.isInUse });
            else if (method === 'readAnalysis') value = await this.service.readAnalysis(irId);
            else if (method === 'updateAnalysis') value = await this.service.store.updateAnalysis(irId, args.analysis);
            else if (method === 'resolveDecodedPcm') {
                if (!Number.isFinite(args.sampleRate) || args.sampleRate < 8000 || args.sampleRate > 384000) throw new Error('Invalid IR sample rate');
                value = await this.service.resolveDecodedPcm(irId, args.sampleRate, this.adapters);
            } else throw new Error('Unknown IR library operation');
            return { value, entries: this.service.list() };
        } finally { this.cancelled.delete(key); }
    }
}
