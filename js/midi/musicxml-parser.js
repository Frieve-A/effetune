import { SMF_MAX_BYTES, SMF_MAX_EVENTS } from './smf-parser.js';
import { quarterToSeconds } from './lyrics-timeline.js';

function fail(kind = 'corrupt') {
    const error = new Error(kind === 'unsupported'
        ? 'This MusicXML score uses playback features that are not supported. Export it as MIDI to play it.'
        : kind === 'too-large' ? 'This MusicXML file is too large to open.'
            : 'This MusicXML file is incomplete or damaged.');
    error.code = `musicxml-${kind}`;
    throw error;
}

const children = (node, name) => node?.children.filter(child => child.name === name) ?? [];
const child = (node, name) => children(node, name)[0];
const text = (node, name, fallback = '') => child(node, name)?.text.trim() ?? fallback;
function number(node, name, fallback = 0) {
    const value = Number(text(node, name, String(fallback)));
    if (!Number.isFinite(value)) fail();
    return value;
}

function entities(value) {
    if (/&(?!(?:[A-Za-z]+|#\d+|#x[\da-f]+);)/i.test(value)) fail();
    return value.replace(/&([^;\s]{1,32});/g, (_, entity) => {
        const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        if (Object.hasOwn(known, entity)) return known[entity];
        const hexadecimal = entity[1]?.toLowerCase() === 'x';
        const numeric = /^#(?:x[\da-f]+|\d+)$/i.test(entity)
            ? Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10) : 0;
        if (!numeric || numeric > 0x10ffff || numeric >= 0xd800 && numeric <= 0xdfff) fail();
        return String.fromCodePoint(numeric);
    });
}

// The small score reader never resolves DTDs, entities, URLs, or external files.
function xmlDocument(source) {
    if (source.length > SMF_MAX_BYTES) fail('too-large');
    if (/<!ENTITY/i.test(source)) fail('unsupported');
    const document = { children: [], text: '' }, stack = [document];
    // Sticky matching rejects a malformed token at its current position without rescanning later offsets.
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/gy;
    let end = 0, count = 0;
    for (const match of source.matchAll(tokens)) {
        if (match.index !== end || ++count > 1000000) fail('too-large');
        const token = match[0]; end += token.length;
        if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!DOCTYPE')) continue;
        if (token.startsWith('<![CDATA[')) { stack.at(-1).text += token.slice(9, -3); continue; }
        if (token.startsWith('</')) {
            if (stack.length < 2 || token.slice(2, -1).trim() !== stack.pop().qualifiedName) fail();
        } else if (token.startsWith('<')) {
            const opening = /^<([\w:.-]+)/.exec(token);
            if (!opening || token.startsWith('<!') || stack.length > 128) fail();
            const selfClosing = token.endsWith('/>');
            const attributeSource = token.slice(opening[0].length, selfClosing ? -2 : -1);
            const attributes = Object.create(null);
            const attributeTokens = /\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/gy;
            let attributeEnd = 0;
            for (const match of attributeSource.matchAll(attributeTokens)) {
                const [, key, value] = match;
                if (Object.hasOwn(attributes, key)) fail();
                attributes[key] = entities(value.slice(1, -1));
                attributeEnd += match[0].length;
            }
            if (attributeSource.slice(attributeEnd).trim()) fail();
            const node = { name: opening[1].split(':').at(-1), qualifiedName: opening[1], attributes, children: [], text: '' };
            stack.at(-1).children.push(node);
            if (!selfClosing) stack.push(node);
        } else stack.at(-1).text += entities(token);
    }
    if (end !== source.length || stack.length !== 1 || document.children.length !== 1 || document.text.trim()) fail();
    return document.children[0];
}

function decodeXml(bytes) {
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c) encoding = 'utf-16be';
    else encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(new TextDecoder().decode(bytes.subarray(0, 256)))?.[1] ?? encoding;
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\ufeff/, ''); }
    catch { fail(); }
}

async function unzipScore(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => { if (offset < 0 || offset + 2 > bytes.length) fail(); return view.getUint16(offset, true); };
    const u32 = offset => { if (offset < 0 || offset + 4 > bytes.length) fail(); return view.getUint32(offset, true); };
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
        if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    }
    if (end < Math.max(0, bytes.length - 65557) || u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail();
    const count = u16(end + 10), files = new Map();
    if (count > 4096 || u32(end + 12) > SMF_MAX_BYTES) fail('too-large');
    let position = u32(end + 16);
    for (let index = 0; index < count; index++) {
        if (u32(position) !== 0x02014b50) fail();
        const flags = u16(position + 8), method = u16(position + 10), size = u32(position + 24);
        const crc = u32(position + 16), packed = u32(position + 20), offset = u32(position + 42);
        const length = u16(position + 28), next = position + 46 + length + u16(position + 30) + u16(position + 32);
        if (next > end || flags & 1 || files.size > 4096) fail();
        const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(position + 46, position + 46 + length));
        if (files.has(name)) fail();
        files.set(name, { method, size, packed, offset, crc }); position = next;
    }
    const extract = async name => {
        const entry = files.get(name);
        if (!entry || entry.size > SMF_MAX_BYTES) fail(entry ? 'too-large' : 'corrupt');
        const { offset, size, packed, method, crc } = entry;
        const checked = data => {
            let computed = 0xffffffff;
            for (const byte of data) {
                computed ^= byte;
                for (let bit = 0; bit < 8; bit++) computed = computed >>> 1 ^ (computed & 1 ? 0xedb88320 : 0);
            }
            if ((computed ^ 0xffffffff) >>> 0 !== crc) fail();
            return data;
        };
        if (u32(offset) !== 0x04034b50) fail();
        const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
        if (start + packed > bytes.length) fail();
        const data = bytes.subarray(start, start + packed);
        if (method === 0) { if (size !== data.length) fail(); return checked(data); }
        if (method !== 8) fail('unsupported');
        const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const chunks = []; let total = 0;
        try {
            for (;;) {
                const result = await reader.read(); if (result.done) break;
                total += result.value.length;
                if (total > size || total > SMF_MAX_BYTES) { await reader.cancel(); fail('too-large'); }
                chunks.push(result.value);
            }
        } catch (error) { if (error.code) throw error; fail(); }
        if (total !== size) fail();
        const result = new Uint8Array(total); let cursor = 0;
        for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
        return checked(result);
    };
    const container = xmlDocument(decodeXml(await extract('META-INF/container.xml')));
    if (container.name !== 'container') fail();
    const rootfile = child(child(container, 'rootfiles'), 'rootfile');
    const name = rootfile?.attributes['full-path'];
    if (!name || name.startsWith('/') || name.split('/').some(segment => segment === '..') || name.includes('\\')) fail();
    return extract(name);
}

function instrument(node, fallback) {
    const channel = number(node, 'midi-channel', fallback.channel + 1) - 1;
    const program = number(node, 'midi-program', fallback.program + 1) - 1;
    const unpitched = number(node, 'midi-unpitched', (fallback.unpitched ?? -1) + 1) - 1;
    if (![channel, program, unpitched].every(Number.isInteger) || channel < 0 || channel > 15 || program < 0 || program > 127 || unpitched < -1 || unpitched > 127) fail();
    return { channel, program, unpitched };
}

/** Convert score timing into the same bounded channel-event timeline used by SMF. */
export function parseMusicXml(input, { fileName = '' } = {}) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > SMF_MAX_BYTES) fail('too-large');
    const root = xmlDocument(decodeXml(bytes));
    if (!['score-partwise', 'score-timewise'].includes(root.name)) fail('unsupported');
    const definitions = children(child(root, 'part-list'), 'score-part');
    if (!definitions.length || definitions.length > 256) fail('unsupported');
    const measures = [], parts = [];
    let totalEvents = 0;
    for (const [track, definition] of definitions.entries()) {
        const id = definition.attributes.id;
        const source = root.name === 'score-partwise'
            ? children(children(root, 'part').find(part => part.attributes.id === id), 'measure')
            : children(root, 'measure').map(measure => children(measure, 'part').find(part => part.attributes.id === id));
        if (!source.length || source.some(item => !item)) fail();
        const defaultChannel = track < 9 ? track : track + 1;
        const fallback = { channel: defaultChannel % 16, program: 0, unpitched: -1 };
        if (track >= 15 && !children(definition, 'midi-instrument').length) fail('unsupported');
        const instruments = new Map(children(definition, 'midi-instrument').map(node => [node.attributes.id, instrument(node, fallback)]));
        const initialInstruments = [...instruments.values()];
        let currentInstrument = initialInstruments[0] ?? fallback;
        let divisions = 1, transpose = 0, meter = 4, velocity = 80;
        const part = [];
        for (const [index, measure] of source.entries()) {
            const events = [], notes = []; let cursor = 0, extent = 0, lastStart = 0;
            const shared = measures[index] ??= { length: 0, repeat: null, forward: false, endings: null, endingStop: false };
            for (const item of measure.children) {
                if (item.name === 'attributes') {
                    if (children(item, 'measure-style').some(style => child(style, 'measure-repeat'))) fail('unsupported');
                    divisions = number(item, 'divisions', divisions);
                    if (divisions <= 0) fail();
                    const time = child(item, 'time');
                    if (time && child(time, 'beats')) {
                        const beats = text(time, 'beats').split('+').reduce((sum, value) => sum + Number(value), 0);
                        const denominator = number(time, 'beat-type', 4);
                        if (!Number.isFinite(beats) || beats <= 0 || denominator <= 0) fail();
                        meter = beats * 4 / denominator;
                        events.push({ quarter: cursor, type: 'timeSignature', numerator: beats, denominator });
                    }
                    if (child(item, 'transpose')) transpose = number(child(item, 'transpose'), 'chromatic') + 12 * number(child(item, 'transpose'), 'octave-change');
                } else if (item.name === 'backup' || item.name === 'forward') {
                    const duration = number(item, 'duration') / divisions;
                    if (duration <= 0) fail();
                    cursor += item.name === 'backup' ? -duration : duration;
                    if (cursor < -1e-8) fail();
                    extent = Math.max(extent, cursor);
                } else if (item.name === 'direction' || item.name === 'sound') {
                    const sound = item.name === 'sound' ? item : child(item, 'sound');
                    if (sound && (sound.attributes.dacapo === 'yes' || ['dalsegno', 'tocoda', 'fine'].some(key => sound.attributes[key]))) fail('unsupported');
                    const offset = number(sound, 'offset', number(item, 'offset')) / divisions;
                    let tempo = Number(sound?.attributes.tempo ?? 0);
                    const metronome = child(child(item, 'direction-type'), 'metronome');
                    if (!tempo && metronome) {
                        const units = { whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 };
                        const unit = units[text(metronome, 'beat-unit')];
                        tempo = number(metronome, 'per-minute') * unit * (2 - 2 ** -children(metronome, 'beat-unit-dot').length);
                    }
                    if (tempo) {
                        if (!Number.isFinite(tempo) || tempo <= 0) fail();
                        events.push({ quarter: Math.max(0, cursor + offset), type: 'tempo', microsecondsPerQuarter: 60000000 / tempo });
                    }
                    if (sound?.attributes.dynamics !== undefined) {
                        velocity = Math.round(Number(sound.attributes.dynamics) * .9);
                        if (!Number.isFinite(velocity) || velocity < 0) fail();
                        velocity = Math.min(127, velocity);
                    }
                    for (const midi of children(sound, 'midi-instrument')) {
                        currentInstrument = instrument(midi, instruments.get(midi.attributes.id) ?? currentInstrument);
                        instruments.set(midi.attributes.id, currentInstrument);
                        events.push({ quarter: cursor + offset, type: 'midi', status: 0xc0 | currentInstrument.channel, data1: currentInstrument.program, data2: 0 });
                    }
                } else if (item.name === 'note') {
                    if (child(item, 'grace')) continue;
                    const duration = number(item, 'duration', child(item, 'rest')?.attributes.measure === 'yes' ? meter * divisions : 0) / divisions;
                    if (duration <= 0) fail();
                    const chord = !!child(item, 'chord'), start = chord ? lastStart : cursor;
                    if (!chord) { lastStart = start; cursor += duration; }
                    extent = Math.max(extent, start + duration);
                    for (const lyric of children(item, 'lyric')) {
                        const segments = lyric.children.filter(node => ['text', 'elision', 'syllabic'].includes(node.name))
                            .map(node => ({ type: node.name, text: node.name === 'elision' ? node.text || '‿' : node.text }));
                        const value = segments.filter(segment => segment.type !== 'syllabic').map(segment => segment.text).join('');
                        const extend = child(lyric, 'extend');
                        if (value || extend) events.push({ quarter: start, endQuarter: start + duration, type: 'lyric', text: value,
                            part: String(id ?? track), verse: lyric.attributes.number || lyric.attributes.name || '1',
                            syllabic: text(lyric, 'syllabic', 'single'), segments, extend: extend ? extend.attributes.type || 'start' : '',
                            endLine: !!child(lyric, 'end-line'), endParagraph: !!child(lyric, 'end-paragraph'),
                            timeOnly: lyric.attributes['time-only']?.split(',').map(value => Number(value.trim())) ?? null });
                    }
                    if (child(item, 'rest') || child(item, 'cue')) continue;
                    const selected = instruments.get(child(item, 'instrument')?.attributes.id) ?? currentInstrument;
                    const pitch = child(item, 'pitch'), unpitched = child(item, 'unpitched');
                    const steps = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                    const step = steps[text(pitch ?? unpitched, pitch ? 'step' : 'display-step')];
                    const key = unpitched && selected.unpitched >= 0 ? selected.unpitched
                        : (number(pitch ?? unpitched, pitch ? 'octave' : 'display-octave') + 1) * 12 + step + number(pitch, 'alter') + transpose;
                    if (!Number.isInteger(key)) fail('unsupported');
                    if (key < 0 || key > 127 || !pitch && !unpitched) fail();
                    const ties = children(item, 'tie').map(tie => tie.attributes.type);
                    const noteVelocity = item.attributes.dynamics === undefined ? velocity : Math.round(Number(item.attributes.dynamics) * .9);
                    if (!Number.isFinite(noteVelocity) || noteVelocity < 0) fail();
                    notes.push({ quarter: start, end: start + duration, pitch: key, velocity: Math.min(127, noteVelocity), channel: selected.channel, program: selected.program,
                        voice: text(item, 'voice', '1'), tieStart: ties.includes('start'), tieStop: ties.includes('stop') });
                } else if (item.name === 'barline') {
                    const repeat = child(item, 'repeat'), ending = child(item, 'ending');
                    if (repeat?.attributes.direction === 'forward') shared.forward = true;
                    if (repeat?.attributes.direction === 'backward') {
                        shared.repeat = Number(repeat.attributes.times ?? 2);
                        if (!Number.isInteger(shared.repeat) || shared.repeat < 1 || shared.repeat > 16) fail('unsupported');
                    }
                    if (ending?.attributes.type === 'start') {
                        shared.endings = ending.attributes.number.split(',').map(Number);
                        if (!shared.endings.every(value => Number.isInteger(value) && value >= 1 && value <= 16)) fail('unsupported');
                    }
                    if (['stop', 'discontinue'].includes(ending?.attributes.type)) shared.endingStop = true;
                }
                if (++totalEvents > SMF_MAX_EVENTS) fail('too-large');
            }
            shared.length = Math.max(shared.length, extent || meter);
            part.push({ events, notes });
        }
        parts.push({ measures: part, instruments: initialInstruments.length ? initialInstruments : [fallback], track });
    }
    let endingNumbers = null, activeRepeat = false, writtenTempo = 500000;
    let writtenMeter = { numerator: 4, denominator: 4 };
    for (const [index, measure] of measures.entries()) {
        measure.entryTempo = writtenTempo;
        measure.entryMeter = writtenMeter;
        const timing = parts.flatMap(part => (part.measures[index]?.events ?? [])
            .filter(event => event.type === 'tempo' || event.type === 'timeSignature')
            .map(event => ({ ...event, track: part.track })));
        timing.sort((a, b) => a.quarter - b.quarter || a.track - b.track);
        for (const event of timing) {
            if (event.type === 'tempo') writtenTempo = event.microsecondsPerQuarter;
            else writtenMeter = { numerator: event.numerator, denominator: event.denominator };
        }
        if (measure.forward) {
            if (activeRepeat) fail('unsupported');
            activeRepeat = true;
        }
        if (measure.repeat) activeRepeat = false;
        if (measure.endings) endingNumbers = measure.endings;
        measure.endingNumbers = endingNumbers;
        if (measure.endingStop) endingNumbers = null;
    }
    const raw = [], held = new Map(); let quarter = 0, order = 0, repeatStart = 0, pass = 1, completedRepeat = false;
    const push = event => { if (raw.length >= SMF_MAX_EVENTS) fail('too-large'); raw.push({ ...event, order: order++ }); };
    const initializedChannels = new Set();
    for (const part of parts) for (const selected of part.instruments) {
        if (initializedChannels.has(selected.channel)) continue;
        initializedChannels.add(selected.channel);
        push({ quarter: 0, track: part.track, type: 'midi', status: 0xc0 | selected.channel, data1: selected.program, data2: 0 });
    }
    let visits = 0, restoreTiming = false;
    for (let index = 0; index < measures.length; index++) {
        if (++visits > 100000) fail('too-large');
        const measure = measures[index];
        if (completedRepeat && !measure.endingNumbers) { pass = 1; completedRepeat = false; }
        if (measure.forward && pass === 1) repeatStart = index;
        const play = !measure.endingNumbers || measure.endingNumbers.includes(pass);
        if (play) {
            if (restoreTiming) {
                push({ quarter, track: 0, type: 'tempo', microsecondsPerQuarter: measure.entryTempo });
                push({ quarter, track: 0, type: 'timeSignature', ...measure.entryMeter });
                restoreTiming = false;
            }
            for (const part of parts) {
                for (const event of part.measures[index]?.events ?? []) {
                    if (event.type === 'lyric' && event.timeOnly && !event.timeOnly.includes(pass)) continue;
                    push({ ...event, quarter: event.quarter + quarter,
                        ...(event.type === 'lyric' ? { endQuarter: event.endQuarter + quarter } : {}), track: part.track });
                }
                for (const note of part.measures[index]?.notes ?? []) {
                    const key = `${part.track}:${note.channel}:${note.voice}:${note.pitch}`;
                    const previous = held.get(key);
                    const endQuarter = quarter + note.end;
                    if (note.tieStop && previous && Math.abs(previous.quarter - (quarter + note.quarter)) < 1e-8) previous.quarter = endQuarter;
                    else {
                        push({ quarter: quarter + note.quarter, track: part.track, type: 'midi', status: 0xc0 | note.channel, data1: note.program, data2: 0 });
                        push({ quarter: quarter + note.quarter, track: part.track, type: 'midi', status: 0x90 | note.channel, data1: note.pitch, data2: note.velocity });
                        const off = { quarter: endQuarter, track: part.track, type: 'midi', status: 0x80 | note.channel, data1: note.pitch, data2: 0, order: order++ };
                        if (raw.length >= SMF_MAX_EVENTS) fail('too-large');
                        raw.push(off); held.set(key, off);
                    }
                    if (!note.tieStart) held.delete(key);
                }
            }
            quarter += measure.length;
            if (quarter > 10000000) fail('too-large');
        }
        if (measure.repeat) {
            if (pass < measure.repeat) { pass++; index = repeatStart - 1; restoreTiming = true; }
            else { repeatStart = index + 1; completedRepeat = true; }
        }
    }
    for (const event of raw) {
        event.quarter = Math.max(0, event.quarter);
        quarter = Math.max(quarter, event.quarter);
    }
    raw.sort((a, b) => a.quarter - b.quarter || a.track - b.track || a.order - b.order);
    const tempoMap = [{ tick: 0, seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 }];
    const timeSignatures = [{ tick: 0, seconds: 0, quarter: 0, numerator: 4, denominator: 4 }];
    const events = [], lyricCues = [], channelPrograms = new Int16Array(16).fill(-1);
    let origin = 0, seconds = 0, tempo = 500000;
    for (const event of raw) {
        if (event.type === 'midi' && (event.status & 0xf0) === 0xc0) {
            const channel = event.status & 15;
            if (channelPrograms[channel] === event.data1) continue;
            channelPrograms[channel] = event.data1;
        }
        event.tick = event.quarter * 480;
        event.seconds = seconds + (event.quarter - origin) * tempo / 1000000;
        if (event.type === 'tempo') { origin = event.quarter; seconds = event.seconds; tempo = event.microsecondsPerQuarter; tempoMap.push(event); }
        else if (event.type === 'timeSignature') timeSignatures.push(event);
        else if (event.type === 'lyric') lyricCues.push(event);
        else events.push(event);
    }
    const duration = seconds + (quarter - origin) * tempo / 1000000;
    if (!Number.isFinite(duration) || duration > 86400) fail('too-large');
    const timeline = { format: 1, division: 480, secondsPerTick: null, durationTicks: quarter * 480, duration,
        title: text(root, 'movement-title') || text(child(root, 'work'), 'work-title') || fileName.replace(/\.(?:musicxml|xml|mxl)$/i, ''),
        events, tempoMap, timeSignatures };
    if (lyricCues.length) {
        const extending = new Map();
        for (const cue of lyricCues) {
            cue.endSeconds = quarterToSeconds(timeline, cue.endQuarter);
            const key = JSON.stringify([cue.part, cue.verse]);
            const previous = extending.get(key);
            if (previous) previous.endSeconds = cue.text ? cue.seconds : cue.endSeconds;
            if (cue.text) extending.delete(key);
            if (cue.extend === 'start') extending.set(key, cue);
            if (cue.extend === 'stop') extending.delete(key);
            delete cue.timeOnly;
        }
        timeline.lyrics = { source: 'musicxml', cues: lyricCues,
            parts: definitions.map((definition, index) => ({ id: String(definition.attributes.id ?? index), name: text(definition, 'part-name') })) };
    }
    return timeline;
}

export async function parseMusicXmlFile(input, options = {}) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > SMF_MAX_BYTES) fail('too-large');
    options.signal?.throwIfAborted();
    try {
        const score = bytes[0] === 0x50 && bytes[1] === 0x4b ? await unzipScore(bytes) : bytes;
        options.signal?.throwIfAborted();
        return parseMusicXml(score, options);
    } catch (error) {
        if (error.code?.startsWith('musicxml-') || options.signal?.aborted) throw error;
        fail();
    }
}
