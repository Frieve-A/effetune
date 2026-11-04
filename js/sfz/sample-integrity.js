import { SfzMd5 } from './md5.js';
import { sfzError } from './parser.js';

export const SFZ_MD5_CHUNK_BYTES = 256 * 1024;
const checkCurrent = isCurrent => {
    if (isCurrent?.() === false) throw sfzError('cancelled', 'Instrument sample checking was cancelled.');
};

export function normalizeSfzMd5(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) {
        throw sfzError('sample-integrity', 'The instrument contains an invalid sample fingerprint. Check the instrument definition.');
    }
    return value.toLowerCase();
}

export async function hashSfzSample(reader, { isCurrent, onProgress } = {}) {
    if (!reader || !Number.isSafeInteger(reader.size) || reader.size < 0 || typeof reader.readRange !== 'function') {
        throw sfzError('prepare', 'An instrument sample could not be opened. Reload the instrument.');
    }
    const hash = new SfzMd5();
    checkCurrent(isCurrent);
    for (let offset = 0; offset < reader.size; offset += SFZ_MD5_CHUNK_BYTES) {
        checkCurrent(isCurrent);
        const length = Math.min(SFZ_MD5_CHUNK_BYTES, reader.size - offset);
        const bytes = await reader.readRange(offset, length);
        checkCurrent(isCurrent);
        if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
            throw sfzError('source-changed', 'An instrument sample changed or could not be read. Reload the instrument.');
        }
        hash.update(bytes);
        onProgress?.({ completedBytes: offset + length, totalBytes: reader.size });
        // A memory-backed reader also yields to cancellation and UI work.
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    checkCurrent(isCurrent);
    if (!reader.size) onProgress?.({ completedBytes: 0, totalBytes: 0 });
    return hash.digest();
}

// One resolver belongs to one captured, already-granted instrument source. It
// never enumerates a directory, opens an arbitrary path, or decodes audio.
export function createSfzSampleIntegrity({ openReader, candidatePaths = [], isCurrent, onProgress,
    onDiagnostic = detail => console.warn('SFZ sample fingerprint:', detail),
    maxLookupBytes = Number.MAX_SAFE_INTEGER, maxLookupFiles = Number.MAX_SAFE_INTEGER } = {}) {
    if (typeof openReader !== 'function' || !Number.isSafeInteger(maxLookupBytes) || maxLookupBytes < 0 ||
        !Number.isSafeInteger(maxLookupFiles) || maxLookupFiles < 0) throw new Error('Invalid sample integrity source.');
    const cache = new Map();
    let lookupBytes = 0, lookupFiles = 0;
    const limit = () => sfzError('sample-lookup-limit',
        'The matching instrument sample was not found within the search limit. Select a smaller instrument folder or restore the original sample name.');
    const fingerprint = async (path, reader, lookup) => {
        const prior = cache.get(path);
        if (prior && prior.revision === reader.revision && prior.size === reader.size) {
            // Existing providers verify revision even on an empty range read.
            await reader.readRange(0, 0);
            checkCurrent(isCurrent);
            return prior.digest;
        }
        if (lookup) {
            if (++lookupFiles > maxLookupFiles || reader.size > maxLookupBytes - lookupBytes) throw limit();
            lookupBytes += reader.size;
        }
        const digest = await hashSfzSample(reader, { isCurrent,
            onProgress: progress => onProgress?.({ ...progress, path, searching: lookup }) });
        if (typeof reader.revision === 'string' && reader.revision) {
            if (cache.size >= 4096) cache.delete(cache.keys().next().value);
            cache.set(path, { revision: reader.revision, size: reader.size, digest });
        }
        return digest;
    };
    return Object.freeze({ async resolve(path, declaration) {
        const expected = normalizeSfzMd5(declaration);
        checkCurrent(isCurrent);
        const named = await openReader(path);
        let actual = null;
        if (named) {
            actual = await fingerprint(path, named, false);
            if (actual === expected) return path;
        }
        const paths = typeof candidatePaths === 'function' ? await candidatePaths(path) : candidatePaths;
        const visited = new Set([path]);
        for (const candidate of paths) {
            checkCurrent(isCurrent);
            if (visited.has(candidate)) continue;
            if (visited.size > maxLookupFiles) throw limit();
            visited.add(candidate);
            const reader = await openReader(candidate);
            if (!reader) continue;
            if (await fingerprint(candidate, reader, true) === expected) {
                onDiagnostic?.({ code: 'sample-renamed', path, resolvedPath: candidate, md5: expected });
                return candidate;
            }
        }
        onDiagnostic?.({ code: 'sample-integrity', path, expected, actual });
        throw sfzError('sample-integrity', named
            ? 'An instrument sample does not match its fingerprint. Restore the original sample or select the complete instrument folder.'
            : 'An instrument sample could not be found by name or fingerprint. Select the complete instrument folder.');
    } });
}
