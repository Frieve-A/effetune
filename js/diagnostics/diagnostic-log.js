import { addDiagnosticWord, redactDiagnosticText } from './diagnostic-redaction.js';

const EVENT_LIMIT = 500;
const CONSOLE_LIMIT = 200;
const TEXT_LIMIT = 500;
const NAME_LIMIT = 200;
export const NATIVE_COUNTERS = [
    'feedUnderruns', 'feedGaps', 'feedBackwardGaps', 'feedOverflows', 'captureUnderruns',
    'deviceDiscontinuities', 'callbackOverruns', 'droppedFeedPackets', 'fileUnderruns', 'fileGaps', 'fileOverflows'
];
const TEXT_FIELDS = new Set(['message', 'error', 'warning', 'stderr', 'stderrTail']);
let recording;

function append(list, entry, limit) {
    list.push(entry);
    if (list.length > limit) list.shift();
}

function comparable(entry) {
    const { epochMs, lastEpochMs, count, delta, ...fields } = entry;
    return JSON.stringify(fields);
}

export function redactEventFields(fields, dictionary, origin) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
        key, TEXT_FIELDS.has(key) && typeof value === 'string'
            ? redactDiagnosticText(value, dictionary, origin).slice(0, TEXT_LIMIT) : value
    ]));
}

export function recordDiagnosticEvent(kind, fields = {}) {
    if (!recording) return;
    const entry = { ...redactEventFields(fields, diagnosticDictionary(), recording.origin),
        kind, origin: 'renderer', epochMs: Date.now() };
    const previous = recording.events.at(-1);
    if (previous?.kind === kind && comparable(previous) === comparable(entry)) {
        previous.count = (previous.count || 1) + 1;
        previous.lastEpochMs = entry.epochMs;
        if (Number.isFinite(entry.delta)) previous.delta += entry.delta;
    } else {
        append(recording.events, entry, EVENT_LIMIT);
    }
}

// Interleaved counters have independent intervals. A silent observation closes
// its own interval even if another counter is still increasing.
export function recordNativeCounters(fields) {
    if (!recording) return;
    for (const name of NATIVE_COUNTERS) {
        const value = fields?.[name];
        if (!Number.isSafeInteger(value) || value < 0) continue;
        const delta = value - (recording.counters.get(name) ?? 0);
        recording.counters.set(name, value);
        const interval = recording.intervals.get(name);
        if (delta <= 0) {
            if (interval) {
                append(recording.events, interval, EVENT_LIMIT);
                recording.intervals.delete(name);
            }
        } else {
            const now = Date.now();
            if (interval) {
                interval.delta += delta;
                interval.count++;
                interval.lastEpochMs = now;
            } else {
                recording.intervals.set(name, { kind: 'nativeCounter', counter: name, origin: 'renderer',
                    epochMs: now, lastEpochMs: now, count: 1, delta });
            }
        }
    }
}

export function closeNativeCounterIntervals() {
    if (!recording) return;
    for (const interval of recording.intervals.values()) append(recording.events, interval, EVENT_LIMIT);
    recording.intervals.clear();
    recording.counters.clear();
}

function storeNames(type, names, selection) {
    if (!recording || !names) return;
    let recent = recording.names.get(type);
    if (!recent) recording.names.set(type, recent = new Map());
    for (const name of names) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const forms = recent.get(name) || new Map();
        if (!forms.size) addDiagnosticWord(forms, name, type, recording.origin);
        if (!forms.size) continue;
        recent.delete(name);
        recent.set(name, forms);
        if (recent.size > NAME_LIMIT) recent.delete(recent.keys().next().value);
        if (selection) for (const [word, token] of forms) selection.set(word, token);
    }
    recording.dictionary = null;
}

export function rememberDiagnosticNames(type, names) {
    storeNames(type, names);
}

export function beginDiagnosticSelection(type, names) {
    if (!recording) return () => {};
    const session = recording;
    const selection = new Map();
    session.selections.add(selection);
    storeNames(type, names, selection);
    return () => {
        session.selections.delete(selection);
        session.dictionary = null;
    };
}

export function diagnosticTrackNames(track) {
    if (!track) return [];
    const names = [track.name, track.title, track.artist, track.album, track.fileName, track.sourceFileName, track.file?.name,
        track.webkitRelativePath, track.relativePath, track.file?.webkitRelativePath, track.meta?.fileName,
        track.meta?.title, track.meta?.artist, track.meta?.album];
    for (let path of [typeof track === 'string' ? track : track.path, track.url, track.uri, track.mediaSource, track.droppedFilePath]) {
        if (typeof path !== 'string' || !path) continue;
        if (/^[a-z]+:\/\//i.test(path)) {
            try { path = decodeURIComponent(new URL(path).pathname); } catch { continue; }
        }
        names.push(path, path.split(/[\\/]/).pop());
    }
    return names;
}

export function rememberDiagnosticTrack(track) {
    if (recording) rememberDiagnosticNames('track', diagnosticTrackNames(track));
}

export function diagnosticDictionary() {
    if (!recording) return new Map();
    if (!recording.dictionary) {
        const entries = new Map();
        for (const names of recording.names.values()) {
            for (const forms of names.values()) for (const [word, token] of forms) entries.set(word, token);
        }
        for (const selection of recording.selections) {
            for (const [word, token] of selection) entries.set(word, token);
        }
        recording.dictionary = entries;
    }
    return recording.dictionary;
}

function argumentText(value) {
    if (value instanceof Error) {
        const description = `${value.name}: ${value.message}`;
        const frames = typeof value.stack === 'string' ? value.stack.split('\n').slice(1, 5) : [];
        return [description, ...frames].join('\n');
    }
    if (value !== null && typeof value === 'object') return Object.prototype.toString.call(value);
    return String(value);
}

function recordConsole(level, values) {
    if (!recording) return;
    const args = [];
    let remaining = TEXT_LIMIT;
    for (const value of values) {
        const text = redactDiagnosticText(argumentText(value), diagnosticDictionary(), recording.origin).slice(0, remaining);
        args.push(text);
        remaining -= text.length + 1;
        if (remaining <= 0) break;
    }
    const signature = JSON.stringify(args).replace(/\d+/g, '#');
    const previous = recording.console.at(-1);
    const now = Date.now();
    if (previous?.level === level && signature === recording.consoleSignature) {
        previous.args = args;
        previous.lastEpochMs = now;
        previous.count = (previous.count || 1) + 1;
    } else {
        append(recording.console, { origin: 'renderer', epochMs: now, level, args }, CONSOLE_LIMIT);
    }
    recording.consoleSignature = signature;
}

export function startDiagnosticRecording(win = globalThis.window) {
    if (recording) return recording.stop;
    const cleanups = [];
    const stop = () => {
        for (const cleanup of cleanups) cleanup();
        recording = null;
    };
    recording = { startedAtEpochMs: Date.now(), events: [], console: [], counters: new Map(),
        intervals: new Map(), names: new Map(), selections: new Set(), origin: win?.location?.href, stop };
    for (const level of ['warn', 'error']) {
        const original = win?.console?.[level];
        if (typeof original !== 'function') continue;
        win.console[level] = function (...args) {
            try { recordConsole(level, args); } catch { /* Recording must never interfere with Console output. */ }
            return original.apply(this, args);
        };
        cleanups.push(() => { win.console[level] = original; });
    }
    for (const [name, listener] of [
        ['error', event => recordConsole('error', [event.error || event.message])],
        ['unhandledrejection', event => recordConsole('error', [event.reason])]
    ]) {
        win?.addEventListener?.(name, listener);
        cleanups.push(() => win?.removeEventListener?.(name, listener));
    }
    return stop;
}

export function getDiagnosticLog() {
    return {
        startedAtEpochMs: recording?.startedAtEpochMs ?? null,
        events: recording ? [...recording.events, ...Array.from(recording.intervals.values(),
            interval => ({ ...interval, ongoing: true }))] : [],
        console: recording?.console.slice() || []
    };
}
