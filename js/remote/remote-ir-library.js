import { IncrementalSha256 } from '../library/repository/sha256.js';
import { identifySingleIr } from '../ir-library/ir-library-id.js';
import { isSupportedIrFileName } from '../ir-library/audio-header-metadata.js';
import { IR_LIBRARY_MAX_ORIGINAL_BYTES } from '../ir-library/ir-library-limits.js';

const CHUNK_BYTES = 512 * 1024;

async function identify(bytes, cryptoProvider) {
    if (cryptoProvider?.subtle) return (await identifySingleIr(bytes, cryptoProvider)).irId;
    // LAN HTTP has no Web Crypto. Reuse the library's hash and yield between chunks.
    const hash = new IncrementalSha256();
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        hash.update(bytes.subarray(offset, offset + CHUNK_BYTES));
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return hash.digestHex().slice(0, 24);
}

function encodeChunk(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
}

function saveDownload(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// All requests belong to this session. A transfer never resumes on a replacement connection.
export function createRemoteIrLibrary(session, selectEntry, {
    cryptoProvider = globalThis.crypto, download = saveDownload
} = {}) {
    const supports = feature => !session.features || session.features.has(feature);
    const requireConnection = (connection, isCurrent = () => true) => {
        if (!connection || session.ws !== connection || connection.readyState !== 1 || !isCurrent()) {
            throw new Error('IR transfer connection changed or operation cancelled');
        }
    };
    return {
        readOnly: true,
        multipleFiles: false,
        get canImport() { return supports('irSync'); },
        get canLoad() { return supports('irSelection'); },
        async list({ query = '', sort = 'filename' } = {}) {
            if (!supports('irSelection') && !supports('irSync')) return [];
            const { items = [] } = await session.request({
                op: 'listIRs', ...(supports('irSelection') && { includePairs: true })
            }, 'irs');
            const singles = supports('irSync')
                ? supports('irSelection') ? (await session.request({ op: 'listIRs' }, 'irs')).items || [] : items
                : [];
            const downloadableIds = new Set(singles.map(item => item.id));
            const entries = items.map(item => ({
                irId: item.id,
                fileLabel: item.name,
                channels: item.channels,
                sampleRate: item.sampleRate,
                frames: item.frames,
                topology: item.topology,
                importedAt: item.importedAt,
                downloadable: downloadableIds.has(item.id)
            })).filter(entry => entry.fileLabel.toLowerCase().includes(query.toLowerCase()));
            return entries.sort(sort === 'recent'
                ? (a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || ''))
                : (a, b) => a.fileLabel.localeCompare(b.fileLabel));
        },
        async importFiles(files, { isCurrent = () => true, onProgress } = {}) {
            if (!supports('irSync') || files.length !== 1) throw new Error('Single IR upload unavailable');
            const connection = session.ws;
            requireConnection(connection, isCurrent);
            const [file] = files;
            const result = { imported: [], failedCount: 0, unsupportedCount: 0, failureCodes: [] };
            if (!isSupportedIrFileName(file.name)) return { ...result, unsupportedCount: 1 };
            if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > IR_LIBRARY_MAX_ORIGINAL_BYTES) {
                return { ...result, failedCount: 1, failureCodes: ['file-too-large'] };
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (bytes.length !== file.size) throw new Error('IR size mismatch');
            const id = await identify(bytes, cryptoProvider);
            const total = Math.ceil(bytes.length / CHUNK_BYTES);
            for (let index = 0; index < total; index += 1) {
                requireConnection(connection, isCurrent);
                await session.sendCommand({
                    op: 'putIR', id, name: file.name, ext: file.name.split('.').at(-1).toLowerCase(),
                    index, total, bytes: bytes.length,
                    data: encodeChunk(bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES))
                });
                onProgress?.({ completedCount: index + 1, totalCount: total,
                    importedCount: index === total - 1 ? 1 : 0, currentFiles: [file.name] });
            }
            requireConnection(connection, isCurrent);
            result.imported.push({ irId: id, fileLabel: file.name });
            return result;
        },
        async downloadEntry(entry, { isCurrent = () => true } = {}) {
            if (!supports('irSync') || !entry.downloadable) throw new Error('Single IR download unavailable');
            const connection = session.ws;
            requireConnection(connection, isCurrent);
            let bytes;
            let name;
            let total;
            let received = 0;
            let next = 0;
            await session.requestChunks({ op: 'getIR', id: entry.irId }, 'irChunk', chunk => {
                requireConnection(connection, isCurrent);
                if (chunk.id !== entry.irId || chunk.index !== next ||
                    !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > IR_LIBRARY_MAX_ORIGINAL_BYTES ||
                    !Number.isSafeInteger(chunk.total) || chunk.total < 1 || chunk.total > IR_LIBRARY_MAX_ORIGINAL_BYTES / CHUNK_BYTES ||
                    typeof chunk.data !== 'string' || chunk.data.length > Math.ceil(CHUNK_BYTES / 3) * 4) {
                    throw new Error('Invalid IR chunk');
                }
                if (next === 0) {
                    bytes = new Uint8Array(chunk.bytes);
                    name = String(chunk.name || entry.fileLabel).replace(/[\\/]/g, '_');
                    total = chunk.total;
                }
                const binary = atob(chunk.data);
                if (chunk.bytes !== bytes.length || chunk.total !== total || next >= total ||
                    binary.length > CHUNK_BYTES || received + binary.length > bytes.length) throw new Error('IR size mismatch');
                for (let index = 0; index < binary.length; index += 1) bytes[received + index] = binary.charCodeAt(index);
                received += binary.length;
                next += 1;
            });
            if (!bytes || next !== total || received !== bytes.length || await identify(bytes, cryptoProvider) !== entry.irId) {
                throw new Error('Incomplete or invalid IR download');
            }
            requireConnection(connection, isCurrent);
            download(bytes, name);
        },
        selectEntry
    };
}
