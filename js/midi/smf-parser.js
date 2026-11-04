import { decodeLegacyMetadataBytes, detectLegacyMetadataEncoding } from '../library/metadata/text-encoding.js';
import { recognizeMidiSystemReset, recognizeMidiDrumMode } from './system-reset.js';

export const SMF_MAX_BYTES = 32 * 1024 * 1024;
export const SMF_MAX_EVENTS = 250000;
const MAX_TICKS = 0xffffffff;
const MAX_SECONDS = 24 * 60 * 60;

export function isMidiFile(value) {
    const name = typeof value === 'string' ? value : value?.name ?? value?.fileName ?? value?.path ?? '';
    const path = /^[a-z][a-z\d+.-]*:\/\//i.test(name) ? name.split(/[?#]/, 1)[0] : name;
    return /\.(?:mid|midi|kar)$/i.test(path) || /\.(?:mid|midi|kar)$/i.test(path.split(/[?#]/, 1)[0]);
}

function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function decodeLyric(bytes, hints, encoding = null) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\0', ''); }
    catch {
        if (encoding) return new TextDecoder(encoding).decode(bytes).replaceAll('\0', '');
        // Metadata decoding trims titles; lyric spaces and line breaks carry meaning.
        const whitespace = byte => byte === 9 || byte === 10 || byte === 13 || byte === 32;
        let start = 0, end = bytes.length;
        while (start < end && whitespace(bytes[start])) start++;
        while (end > start && whitespace(bytes[end - 1])) end--;
        const ascii = new TextDecoder();
        return ascii.decode(bytes.subarray(0, start)) + decodeLegacyMetadataBytes(bytes.subarray(start, end), hints).replaceAll('\0', '') + ascii.decode(bytes.subarray(end));
    }
}

function decodeMetadata(bytes, hints, encoding = null) {
    if (encoding && encoding !== 'utf-8') {
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch {
            try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replaceAll('\0', '').trim(); }
            catch { /* A differently encoded field still uses its own metadata detection. */ }
        }
    }
    return decodeLegacyMetadataBytes(bytes, hints).replaceAll('\0', '').trim();
}

/** Parse one bounded SMF sequence. Channel events retain their original same-tick order. */
export function parseSmf(input, { fileName = '', languageHints = null } = {}) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength > SMF_MAX_BYTES) fail('midi-too-large', 'This MIDI file is too large to open.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let position = 0;
    const requireBytes = (count, end = bytes.length) => {
        if (count < 0 || position + count > end) fail('midi-corrupt', 'This MIDI file is incomplete or damaged.');
    };
    const tag = () => {
        requireBytes(4);
        const text = String.fromCharCode(...bytes.subarray(position, position + 4));
        position += 4;
        return text;
    };
    const u16 = () => { requireBytes(2); const value = view.getUint16(position); position += 2; return value; };
    const u32 = () => { requireBytes(4); const value = view.getUint32(position); position += 4; return value; };
    const vlq = end => {
        let value = 0;
        for (let count = 0; count < 4; count++) {
            requireBytes(1, end);
            const byte = bytes[position++];
            value = value * 128 + (byte & 127);
            if (!(byte & 128)) return value;
        }
        fail('midi-corrupt', 'This MIDI file contains an invalid event length.');
    };
    const header = tag();
    if (header !== 'MThd') {
        if (header === 'RIFF') fail('midi-unsupported', 'Open a standard .mid file instead of an RMID file.');
        fail('midi-corrupt', 'This file is not a standard MIDI file.');
    }
    const headerSize = u32();
    if (headerSize < 6) fail('midi-corrupt', 'This MIDI file has a damaged header.');
    requireBytes(headerSize);
    const headerEnd = position + headerSize;
    const format = u16(), trackCount = u16(), division = u16();
    if (format > 1) fail('midi-unsupported', 'This MIDI format is not supported. Use a format 0 or format 1 MIDI file.');
    if (!trackCount || trackCount > 4096 || (format === 0 && trackCount !== 1)) {
        fail('midi-corrupt', 'This MIDI file has an invalid track count.');
    }
    let secondsPerTick = null;
    if (division & 0x8000) {
        const frameCode = (division >> 8) - 256;
        const framesPerSecond = frameCode === -29 ? 30000 / 1001 : -frameCode;
        const ticksPerFrame = division & 255;
        if (![-24, -25, -29, -30].includes(frameCode) || !ticksPerFrame) {
            fail('midi-corrupt', 'This MIDI file has an invalid timing value.');
        }
        secondsPerTick = 1 / (framesPerSecond * ticksPerFrame);
    } else if (!division) fail('midi-corrupt', 'This MIDI file has an invalid timing value.');
    position = headerEnd;
    const allEvents = [];
    const lyricByteGroups = new Map();
    const lyricHints = { ...(typeof languageHints === 'string' ? { language: languageHints } : languageHints),
        referenceTexts: [...(Array.isArray(languageHints?.referenceTexts) ? languageHints.referenceTexts : []), fileName] };
    const textFragments = [];
    const names = [];
    let eventCount = 0, durationTicks = 0, tracksRead = 0;
    while (tracksRead < trackCount) {
        const chunk = tag(), size = u32();
        requireBytes(size);
        const end = position + size;
        if (chunk !== 'MTrk') { position = end; continue; }
        const track = tracksRead++;
        let tick = 0, runningStatus = 0, order = 0, ended = false;
        while (position < end) {
            tick += vlq(end);
            if (tick > MAX_TICKS || ++eventCount > SMF_MAX_EVENTS) {
                fail('midi-too-large', 'This MIDI file contains too many events or is too long.');
            }
            requireBytes(1, end);
            let status = bytes[position];
            if (status < 128) {
                if (!runningStatus) fail('midi-corrupt', 'This MIDI file contains an invalid event.');
                status = runningStatus;
            } else position++;
            const base = { tick, track, order: order++ };
            if (status < 0xf0) {
                runningStatus = status;
                const count = (status & 0xe0) === 0xc0 ? 1 : 2;
                requireBytes(count, end);
                const data1 = bytes[position++], data2 = count === 2 ? bytes[position++] : 0;
                if (data1 > 127 || data2 > 127) fail('midi-corrupt', 'This MIDI file contains an invalid event.');
                allEvents.push({ ...base, type: 'midi', status, data1, data2 });
            } else if (status === 0xff) {
                runningStatus = 0;
                requireBytes(1, end);
                const meta = bytes[position++], length = vlq(end);
                requireBytes(length, end);
                if (meta === 0x2f) {
                    if (length !== 0) fail('midi-corrupt', 'This MIDI file contains an invalid track ending.');
                    ended = true;
                } else if (meta === 0x51) {
                    if (length !== 3) fail('midi-corrupt', 'This MIDI file contains an invalid tempo.');
                    const microsecondsPerQuarter = bytes[position] * 65536 + bytes[position + 1] * 256 + bytes[position + 2];
                    if (!microsecondsPerQuarter) fail('midi-corrupt', 'This MIDI file contains an invalid tempo.');
                    allEvents.push({ ...base, type: 'tempo', microsecondsPerQuarter });
                } else if (meta === 0x58) {
                    if (length < 4 || !bytes[position] || bytes[position + 1] > 7) fail('midi-corrupt', 'This MIDI file contains an invalid time signature.');
                    allEvents.push({ ...base, type: 'timeSignature', numerator: bytes[position], denominator: 2 ** bytes[position + 1] });
                } else if (meta === 3 && length && length <= 4096) {
                    names.push({ track, bytes: bytes.subarray(position, position + length) });
                } else if (meta === 5 && length) {
                    const text = decodeLyric(bytes.subarray(position, position + length), lyricHints);
                    allEvents.push({ ...base, type: 'lyric', text, part: String(track), verse: '1' });
                }
                if (meta !== 0x51 && meta !== 0x58 && !(meta === 5 && length)) {
                    allEvents.push({ ...base, type: 'meta', meta, byteLength: length,
                        dataPreview: [...bytes.subarray(position, position + Math.min(length, 16))],
                        ...(meta >= 1 && meta <= 9 ? { text: (meta === 1 ? decodeLyric : decodeMetadata)(
                            bytes.subarray(position, position + (meta === 1 ? length : Math.min(length, 256))),
                            lyricHints).replaceAll('\0', '') } : {}) });
                }
                if (meta >= 1 && meta <= 9 && length) {
                    textFragments.push({ event: allEvents.at(-1), bytes: bytes.subarray(position, position + length) });
                }
                if ((meta === 1 || meta === 5) && length) {
                    if (!lyricByteGroups.has(track)) lyricByteGroups.set(track, []);
                    lyricByteGroups.get(track).push({ event: allEvents.at(-1), bytes: bytes.subarray(position, position + length) });
                }
                position += length;
                if (ended) break;
            } else if (status === 0xf0 || status === 0xf7) {
                runningStatus = 0;
                const length = vlq(end);
                requireBytes(length, end);
                let systemReset = null, drumMode = null;
                if (length <= 11) {
                    const payload = bytes.subarray(position, position + length);
                    const packet = status === 0xf0 ? Uint8Array.of(0xf0, ...payload) : payload;
                    systemReset = recognizeMidiSystemReset(packet);
                    drumMode = recognizeMidiDrumMode(packet);
                }
                allEvents.push({ ...base, type: 'sysex', status, byteLength: length,
                    dataPreview: [...bytes.subarray(position, position + Math.min(length, 16))],
                    ...(systemReset ? { systemReset } : {}), ...(drumMode ? { drumMode } : {}) });
                position += length;
            } else fail('midi-corrupt', 'This MIDI file contains an invalid event.');
        }
        if (!ended) fail('midi-corrupt', 'This MIDI file is missing a track ending.');
        durationTicks = Math.max(durationTicks, tick);
        position = end;
    }
    // Names can contain only full-width Latin letters, or a single character.
    // Use the other text fields as evidence before decoding these short names.
    const metadataBytes = textFragments.filter(fragment => fragment.bytes.some(byte => byte >= 128))
        .filter(fragment => {
            try { new TextDecoder('utf-8', { fatal: true }).decode(fragment.bytes); return false; }
            catch { return true; }
        })
        .map(fragment => fragment.bytes.filter(byte => byte !== 0));
    const textStream = new Uint8Array(metadataBytes.reduce((size, fragment) => size + fragment.length, 0));
    let textOffset = 0;
    for (const fragment of metadataBytes) { textStream.set(fragment, textOffset); textOffset += fragment.length; }
    const metadataEncoding = detectLegacyMetadataEncoding(textStream, lyricHints);
    for (const fragment of textFragments) {
        if (fragment.event.meta >= 2) fragment.event.text = decodeMetadata(fragment.bytes.subarray(0, 256), lyricHints, metadataEncoding);
    }
    for (const name of names) name.title = decodeMetadata(name.bytes, lyricHints, metadataEncoding);
    for (const fragments of lyricByteGroups.values()) {
        // A single syllable is often too short to identify a legacy character set.
        const nonAscii = fragments.filter(fragment => fragment.bytes.some(byte => byte >= 128));
        if (!nonAscii.length) continue;
        const stream = new Uint8Array(nonAscii.reduce((size, fragment) => size + fragment.bytes.length, 0));
        let offset = 0;
        for (const fragment of nonAscii) { stream.set(fragment.bytes, offset); offset += fragment.bytes.length; }
        const encoding = detectLegacyMetadataEncoding(stream, lyricHints) ?? metadataEncoding;
        if (encoding && encoding !== 'utf-8') {
            for (const fragment of fragments) fragment.event.text = decodeLyric(fragment.bytes, lyricHints, encoding);
        }
    }
    allEvents.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
    const tempoMap = [{ tick: 0, seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 }];
    const timeSignatures = [{ tick: 0, seconds: 0, quarter: 0, numerator: 4, denominator: 4 }];
    let originTick = 0, originSeconds = 0, originQuarter = 0, tempo = 500000;
    const events = [], lyricCues = [];
    for (const event of allEvents) {
        event.seconds = secondsPerTick === null
            ? originSeconds + (event.tick - originTick) * tempo / (division * 1000000)
            : event.tick * secondsPerTick;
        event.quarter = secondsPerTick === null ? event.tick / division
            : originQuarter + (event.seconds - originSeconds) * 1000000 / tempo;
        if (event.type === 'tempo') {
            originTick = event.tick; originSeconds = event.seconds; originQuarter = event.quarter; tempo = event.microsecondsPerQuarter;
            tempoMap.push(event);
        } else if (event.type === 'timeSignature') timeSignatures.push(event);
        else if (event.type === 'lyric') lyricCues.push(event);
        else if (event.type === 'midi') events.push(event);
        else if (event.systemReset || event.drumMode) events.push({ tick: event.tick, track: event.track, order: event.order,
            type: 'midi', status: 0, data1: event.drumMode?.channel ?? 0, data2: event.drumMode?.mode ?? 0,
            ...(event.systemReset ? { systemReset: event.systemReset } : { drumMode: event.drumMode }),
            seconds: event.seconds, quarter: event.quarter });
    }
    const duration = secondsPerTick === null
        ? originSeconds + (durationTicks - originTick) * tempo / (division * 1000000)
        : durationTicks * secondsPerTick;
    if (!Number.isFinite(duration) || duration > MAX_SECONDS) fail('midi-too-large', 'This MIDI file is too long to open.');
    // Soft Karaoke stores timed syllables as Text events, rather than Lyric events.
    // Only an explicit KAR file/identifier opts in: ordinary MIDI text is metadata.
    const texts = allEvents.filter(event => event.type === 'meta' && event.meta === 1 && event.text);
    const karaoke = /\.kar$/i.test(fileName) || texts.some(event => event.text.startsWith('@KMIDI'));
    const headers = karaoke ? texts.filter(event => event.text.startsWith('@')) : [];
    const karaokeTitle = headers.find(event => event.text.startsWith('@T'))?.text.slice(2).trim();
    const karaokeLanguage = headers.find(event => event.text.startsWith('@L'))?.text.slice(2).trim();
    const karaokeTracks = new Set(texts.filter(event => /^@[LT]|^[\\/]/.test(event.text)).map(event => event.track));
    const karaokeCues = karaoke ? texts.filter(event => !event.text.startsWith('@') && !event.text.startsWith('%') &&
        (!karaokeTracks.size || karaokeTracks.has(event.track))) : [];
    const useLyric = lyricCues.some(cue => /\S/.test(cue.text));
    const cues = useLyric ? lyricCues : karaokeCues.some(cue => /\S/.test(cue.text.replace(/^[\\/]/, '')))
        ? karaokeCues.map(cue => ({ ...cue, part: String(cue.track), verse: '1' })) : [];
    return { format, division, secondsPerTick, durationTicks, duration,
        title: karaokeTitle || names.find(name => name.track === 0 && name.title)?.title || names.find(name => name.title)?.title || fileName.replace(/\.(?:mid|midi|kar)$/i, ''),
        events, tempoMap, timeSignatures, displayEvents: allEvents,
        ...(cues.length ? { lyrics: { source: useLyric ? 'midi' : 'kar',
            ...(karaokeLanguage ? { language: karaokeLanguage } : {}), cues: cues.map((cue, index) => ({ ...cue,
                endSeconds: cues[index + 1]?.seconds ?? duration })) } } : {}) };
}

/** Parsing playback files belongs in a short-lived worker, outside the UI/audio threads. */
export async function parseSmfFile(file, { signal, ...options } = {}) {
    if (file.size > SMF_MAX_BYTES) fail('midi-too-large', 'This MIDI file is too large to open.');
    signal?.throwIfAborted();
    const buffer = await file.arrayBuffer();
    signal?.throwIfAborted();
    return parseSmfAsync(buffer, { signal, fileName: file.name, ...options });
}

export async function parseSmfAsync(input, { signal, ...options } = {}) {
    signal?.throwIfAborted();
    const buffer = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    if (buffer.byteLength > SMF_MAX_BYTES) fail('midi-too-large', 'This MIDI file is too large to open.');
    if (typeof Worker === 'undefined') return parseSmf(buffer, options);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./smf-worker.js', import.meta.url), { type: 'module' });
        const finish = (error, result) => {
            signal?.removeEventListener('abort', abort);
            worker.terminate();
            if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(signal.reason ?? new DOMException('Canceled', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => {
            if (data.error) finish(Object.assign(new Error(data.error.message), { code: data.error.code }));
            else finish(null, data.result);
        };
        worker.onerror = () => finish(new Error('The MIDI file could not be read. Try opening it again.'));
        worker.postMessage({ buffer, options }, [buffer]);
    });
}
