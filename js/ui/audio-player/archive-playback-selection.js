import { createBlobSource, getArchiveFormat, openArchive } from '../../library/archive/archive-reader.js';
import { findArchiveCoverEntry, findArchiveWrdEntry, getArchiveScoreEntries } from '../../library/archive/score-entries.js';
import { cueCoverMimeType } from '../../library/metadata/cue-cover.js';
import { attachArtworkFiles, attachLyricsFiles, getArtworkFiles, getLyricsFiles } from './lyrics-file-links.js';
import { MAX_MATERIALIZED_SEQUENCE_ITEMS } from './playback-sequence.js';

const EXPANDED_SELECTION_MAX_BYTES = 256 * 1024 * 1024;

export function isArchivePlaybackInput(input) {
    return !!getArchiveFormat(inputName(input));
}

export async function expandArchivePlaybackSelection(inputs, { chooseEntries, readFileBytes, reportError, rememberArchiveNames, signal }) {
    let expandedBytes = 0;
    try {
        const groups = Array.from(inputs, input => {
            const name = inputName(input);
            return { input, archiveName: getArchiveFormat(name) ? name : null };
        });
        const archiveCount = groups.filter(group => group.archiveName).length;
        if (!archiveCount) return inputs;

        const choices = [];
        for (const group of groups) {
            signal?.throwIfAborted();
            if (!group.archiveName) continue;
            const archive = await openInputArchive(group, readFileBytes, signal);
            group.entries = getArchiveScoreEntries(archive)
                .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
                .map(entry => ({ archiveName: group.archiveName, path: entry.path, size: entry.size }));
            // A compressed tar can retain a large expanded backing Blob. Keep only one open at a time.
            if (archiveCount === 1) group.archive = archive;
            group.listing = { entries: archive.entries };
            choices.push(...group.entries);
        }
        if (!choices.length) return selectionError('midi.archive.noPlayableFiles', reportError, { archiveCount });

        const selected = choices.length === 1 ? choices : await chooseEntries(choices, { archiveCount, signal });
        signal?.throwIfAborted();
        if (!selected?.length) return [];
        const selection = new Set(selected);
        const trackCount = selection.size + groups.length - archiveCount;
        if (trackCount > MAX_MATERIALIZED_SEQUENCE_ITEMS) {
            return selectionError('midi.archive.tooManyFiles', reportError, { trackCount });
        }
        rememberArchiveNames?.(selected.flatMap(({ path }) => [path, baseName(path)]));

        let estimatedBytes = 0;
        const companionsByArchive = new Map();
        for (const group of groups) {
            if (!group.archiveName) continue;
            const selectedEntries = group.entries.filter(entry => selection.has(entry));
            if (!selectedEntries.length) continue;
            const identity = group.input?.path ?? group.input;
            if (!companionsByArchive.has(identity)) companionsByArchive.set(identity, new Map());
            const companions = companionsByArchive.get(identity);
            group.companions = companions;
            group.selectedEntries = selectedEntries.map(entry => {
                const wrd = findArchiveWrdEntry(group.listing, entry.path);
                const cover = findArchiveCoverEntry(group.listing, entry.path);
                estimatedBytes += entry.size;
                for (const companion of [wrd, cover]) {
                    if (!companion || companions.has(companion.path)) continue;
                    companions.set(companion.path, undefined);
                    estimatedBytes += companion.size;
                }
                return { entry, wrd, cover };
            });
        }
        if (estimatedBytes > EXPANDED_SELECTION_MAX_BYTES) {
            return selectionError('midi.archive.tooLarge', reportError, { expandedBytes: estimatedBytes });
        }

        const retainBytes = size => {
            expandedBytes += size;
            if (expandedBytes > EXPANDED_SELECTION_MAX_BYTES) throw new RangeError('Archive selection exceeds its byte limit');
        };

        const output = [];
        for (const group of groups) {
            const { input, archiveName, selectedEntries, companions } = group;
            if (!archiveName) {
                output.push(input);
                continue;
            }
            if (!selectedEntries?.length) continue;
            const archive = group.archive ?? await openInputArchive(group, readFileBytes, signal);
            for (const { entry, wrd, cover } of selectedEntries) {
                signal?.throwIfAborted();
                const bytes = await archive.read(entry.path, { signal });
                retainBytes(bytes.byteLength);
                const file = new File([bytes], baseName(entry.path));
                const wrdFile = await readCompanion(archive, wrd, companions, retainBytes, signal);
                const coverFile = await readCompanion(archive, cover, companions, retainBytes, signal);
                attachLyricsFiles([file], wrdFile ? [wrdFile] : getLyricsFiles(input));
                attachArtworkFiles([file], coverFile ? [coverFile] : getArtworkFiles(input));
                output.push(file);
            }
        }
        signal?.throwIfAborted();
        return output;
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') return [];
        if (expandedBytes > EXPANDED_SELECTION_MAX_BYTES) {
            return selectionError('midi.archive.tooLarge', reportError, { expandedBytes });
        }
        return selectionError('error.musicSelectionUnavailable', reportError, error);
    }
}

async function openInputArchive({ input, archiveName }, readFileBytes, signal) {
    const blob = typeof input?.slice === 'function'
        ? input : new Blob([await readFileBytes(input?.path ?? input, input?.byteLength)]);
    return openArchive(createBlobSource(blob), archiveName, { signal });
}

async function readCompanion(archive, entry, companions, retainBytes, signal) {
    if (!entry) return null;
    const cached = companions.get(entry.path);
    if (cached !== undefined) return cached;
    let bytes;
    try {
        bytes = await archive.read(entry.path, { signal });
    } catch (error) {
        signal?.throwIfAborted();
        console.debug('Could not read an archive companion file:', error);
    }
    if (bytes) retainBytes(bytes.byteLength);
    const name = baseName(entry.path);
    const file = bytes ? new File([bytes], name, { type: cueCoverMimeType(name) ?? '' }) : null;
    companions.set(entry.path, file);
    return file;
}

function selectionError(key, reportError, details) {
    console.warn('Archive playback selection failed:', key, details);
    reportError(key);
    return [];
}

function inputName(input) {
    const name = typeof input === 'string' ? input : input?.name ?? input?.fileName ?? input?.path ?? '';
    return String(name).split(/[\\/]/).at(-1);
}

function baseName(path) {
    return path.split('/').at(-1);
}
