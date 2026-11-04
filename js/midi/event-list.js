const eventLists = new WeakMap();
const EMPTY_EVENTS = Object.freeze([]);
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const META_NAMES = { 0: 'Sequence Number', 1: 'Text', 2: 'Copyright', 3: 'Track Name',
    4: 'Instrument Name', 6: 'Marker', 7: 'Cue Point', 8: 'Program Name', 9: 'Device Name',
    0x20: 'Channel Prefix', 0x21: 'MIDI Port', 0x2f: 'End of Track', 0x54: 'SMPTE Offset',
    0x59: 'Key Signature', 0x7f: 'Sequencer Data' };
const CC_NAMES = { 0: 'Bank Select', 1: 'Modulation', 2: 'Breath', 4: 'Foot Controller',
    5: 'Portamento Time', 6: 'Data Entry', 7: 'Volume', 8: 'Balance', 10: 'Pan', 11: 'Expression',
    12: 'Effect Control 1', 13: 'Effect Control 2', 64: 'Sustain', 65: 'Portamento', 66: 'Sostenuto',
    67: 'Soft Pedal', 68: 'Legato', 69: 'Hold 2', 70: 'Sound Variation', 71: 'Resonance',
    72: 'Release Time', 73: 'Attack Time', 74: 'Brightness', 75: 'Decay Time', 76: 'Vibrato Rate',
    77: 'Vibrato Depth', 78: 'Vibrato Delay', 84: 'Portamento Control', 91: 'Reverb', 92: 'Tremolo',
    93: 'Chorus', 94: 'Celeste', 95: 'Phaser', 96: 'Data Increment', 97: 'Data Decrement',
    98: 'NRPN LSB', 99: 'NRPN MSB', 100: 'RPN LSB', 101: 'RPN MSB', 120: 'All Sound Off',
    121: 'Reset Controllers', 122: 'Local Control', 123: 'All Notes Off', 124: 'Omni Off',
    125: 'Omni On', 126: 'Mono', 127: 'Poly' };
const noteName = pitch => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1} (${pitch})`;
const controllerName = number => CC_NAMES[number] ?? (number >= 32 && number < 64 && CC_NAMES[number - 32]
    ? `${CC_NAMES[number - 32]} LSB` : null);
const numericField = (value, sample = '127') => Object.freeze({ text: String(value), sample, align: 'right' });
const textField = (text, sample = text) => Object.freeze({ text, sample, align: 'left' });

function contentFields(event, content) {
    const { data1 = 0, data2 = 0 } = event;
    if (event.type === 'midi' && !event.systemReset) {
        switch (event.status & 0xf0) {
        case 0x80: case 0x90: case 0xa0:
            return [textField(NOTE_NAMES[data1 % 12], 'C♯'), numericField(Math.floor(data1 / 12) - 1, '-1'),
                textField(' ('), numericField(data1), textField(') '),
                textField((event.status & 0xf0) === 0xa0 ? 'Prs ' : 'Vel '), numericField(data2)];
        case 0xb0: {
            const name = controllerName(data1);
            return [numericField(data1), textField(': '), numericField(data2), textField(name ? ` ${name}` : '')];
        }
        case 0xc0: return [textField('Program '), numericField(data1 + 1)];
        case 0xd0: return [textField('Pressure '), numericField(data1)];
        case 0xe0: return [numericField(data1 + data2 * 128 - 8192, '-8192')];
        }
    }
    if (event.type === 'tempo') return [numericField(content.slice(0, -4), '999.999'), textField(' BPM')];
    if (event.type === 'timeSignature') return [numericField(event.numerator), textField('/'), numericField(event.denominator)];
    return [textField(content)];
}
const shortText = text => {
    const value = String(text ?? '').replaceAll(/\p{Cc}/gu, ' ').trim();
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
};
const hex = value => value.toString(16).padStart(2, '0').toUpperCase();
const byteSummary = event => {
    const preview = (event.dataPreview ?? []).map(hex).join(' ');
    return `${event.byteLength ?? 0} bytes${preview ? `: ${preview}` : ''}${event.byteLength > 16 ? ' …' : ''}`;
};

function describeEvent(event) {
    if (event.type === 'tempo') return ['Tempo', `${Number((60000000 / event.microsecondsPerQuarter).toFixed(3))} BPM`];
    if (event.type === 'timeSignature') return ['Time Signature', `${event.numerator}/${event.denominator}`];
    if (event.type === 'lyric') return ['Lyric', shortText(event.text)];
    if (event.type === 'sysex' || event.systemReset) return ['SysEx',
        event.systemReset ? `${['', 'GM', 'GS', 'XG'][event.systemReset] ?? 'System'} Reset` : byteSummary(event)];
    if (event.type === 'meta') return [META_NAMES[event.meta] ?? `Meta ${hex(event.meta)}`,
        event.text !== undefined ? shortText(event.text) : event.meta === 0x2f ? '' : byteSummary(event)];
    const { data1 = 0, data2 = 0 } = event;
    switch (event.status & 0xf0) {
    case 0x80: return ['Note Off', `${noteName(data1)}, velocity ${data2}`];
    case 0x90: return [data2 ? 'Note On' : 'Note Off', `${noteName(data1)}, velocity ${data2}`];
    case 0xa0: return ['Poly Pressure', `${noteName(data1)}, pressure ${data2}`];
    case 0xb0: {
        const name = controllerName(data1);
        return ['CC', `${name ? `${name} (${data1})` : data1}: ${data2}`];
    }
    case 0xc0: return ['Program Change', `Program ${data1 + 1}`];
    case 0xd0: return ['Channel Pressure', `Pressure ${data1}`];
    case 0xe0: return ['Pitch Bend', `${data1 + data2 * 128 - 8192}`];
    default: return ['MIDI', `${hex(event.status ?? 0)} ${hex(data1)} ${hex(data2)}`];
    }
}

function lastAtQuarter(items, quarter) {
    let low = 0, high = items.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (items[middle].quarter <= quarter + 1e-9) low = middle + 1;
        else high = middle;
    }
    return items[Math.max(0, low - 1)];
}

function meterSegments(timeline) {
    const segments = [{ quarter: 0, bar: 1, numerator: 4, denominator: 4 }];
    for (const signature of timeline.timeSignatures ?? []) {
        const previous = segments.at(-1);
        const quarter = signature.quarter ?? signature.tick / timeline.division;
        if (quarter === previous.quarter) {
            previous.numerator = signature.numerator;
            previous.denominator = signature.denominator;
        } else {
            // A meter change starts a new measure, including after a partial measure.
            const elapsed = (quarter - previous.quarter) / (previous.numerator * 4 / previous.denominator);
            segments.push({ quarter, bar: previous.bar + Math.ceil(elapsed - 1e-9),
                numerator: signature.numerator, denominator: signature.denominator });
        }
    }
    return segments;
}

function eventPosition(timeline, segments, event) {
    const quarter = event.quarter ?? event.tick / timeline.division;
    const meter = lastAtQuarter(segments, quarter);
    const beatLength = 4 / meter.denominator;
    const beats = Math.max(0, (quarter - meter.quarter) / beatLength);
    const beatIndex = Math.floor(beats + 1e-9);
    const bar = meter.bar + Math.floor(beatIndex / meter.numerator);
    const beat = beatIndex % meter.numerator + 1;
    let tick;
    if (timeline.division & 0x8000) {
        const beatQuarter = meter.quarter + beatIndex * beatLength;
        const tempo = lastAtQuarter(timeline.tempoMap, beatQuarter);
        const beatSeconds = tempo.seconds + (beatQuarter - tempo.quarter) * tempo.microsecondsPerQuarter / 1000000;
        tick = event.tick - beatSeconds / timeline.secondsPerTick;
    } else tick = (beats - beatIndex) * beatLength * timeline.division;
    return `${bar}:${beat}:${Math.max(0, Math.floor(tick + 1e-7))}`;
}

/** Immutable display projection, prepared once per parsed file rather than per frame. */
export function getMidiEventList(timeline) {
    if (!timeline || typeof timeline !== 'object') return EMPTY_EVENTS;
    if (eventLists.has(timeline)) return eventLists.get(timeline);
    const events = timeline.displayEvents ?? [...(timeline.events ?? []),
        ...(timeline.tempoMap ?? []).filter(event => Number.isFinite(event.order)),
        ...(timeline.timeSignatures ?? []).filter(event => Number.isFinite(event.order)),
        ...(timeline.lyrics?.cues ?? [])].sort((a, b) => a.seconds - b.seconds ||
            (a.track ?? 0) - (b.track ?? 0) || (a.order ?? 0) - (b.order ?? 0));
    const segments = meterSegments(timeline);
    const rows = Object.freeze(events.map(event => {
        const [type, content] = describeEvent(event);
        return Object.freeze({ seconds: event.seconds, tick: event.tick,
            channel: event.type === 'midi' && !event.systemReset && event.status >= 0x80 && event.status < 0xf0
                ? (event.status & 15) + 1 : null,
            position: eventPosition(timeline, segments, event), type, content,
            contentFields: Object.freeze(contentFields(event, content)) });
    }));
    eventLists.set(timeline, rows);
    return rows;
}
