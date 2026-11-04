import { MIDI_SYSTEM_RESET, MIDI_DRUM_MODE } from './smf-scheduler.js';

export function midiEventIndex(events, seconds, inclusive = false) {
    let low = 0, high = events.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (events[middle].seconds < seconds || (inclusive && events[middle].seconds === seconds)) low = middle + 1;
        else high = middle;
    }
    return low;
}

export function createMidiChannels() {
    return Array.from({ length: 16 }, (_, index) => {
        const cc = new Uint8Array(128);
        cc[7] = 100; cc[10] = 64; cc[11] = 127;
        cc[98] = cc[99] = cc[100] = cc[101] = 127;
        return { cc, program: 0, bend: 8192, pressure: 0, polyPressure: new Uint8Array(128),
            notes: [], bendRange: 2, bendCents: 0, drumMode: index === 9 ? 1 : 0 };
    });
}

/** Keep note identities distinct; a note-off releases the oldest still-held same-pitch key. */
export function applyMidiEvent(channels, event) {
    if (event.systemReset) {
        const defaults = createMidiChannels();
        for (let index = 0; index < channels.length; index++) Object.assign(channels[index], defaults[index]);
        return;
    }
    if (event.drumMode) {
        channels[event.drumMode.channel].drumMode = event.drumMode.mode;
        return;
    }
    const channelIndex = event.status & 15;
    const channel = channels[channelIndex];
    const { data1, data2 } = event;
    const kind = event.status & 0xf0;
    const releasePedals = () => {
        channel.notes = channel.notes.filter(note => note.down || channel.cc[64] >= 64 || note.sostenuto);
    };
    if (kind === 0x90 && data2) {
        channel.notes.push({ channel: channelIndex, pitch: data1, velocity: data2,
            start: event.seconds, down: true, sostenuto: false, isDrum: !!channel.drumMode, identity: `${event.track}:${event.order}` });
    } else if (kind === 0x80 || kind === 0x90) {
        const note = channel.notes.find(note => note.pitch === data1 && note.down);
        if (note) note.down = false;
        releasePedals();
    } else if (kind === 0xb0) {
        const old = channel.cc[data1];
        channel.cc[data1] = data2;
        if (data1 === 66) {
            if (old < 64 && data2 >= 64) for (const note of channel.notes) note.sostenuto = note.down;
            if (data2 < 64) for (const note of channel.notes) note.sostenuto = false;
        }
        if (data1 === 64 || data1 === 66) releasePedals();
        if (data1 === 120) channel.notes = [];
        if (data1 === 123 || data1 >= 124) {
            for (const note of channel.notes) note.down = false;
            releasePedals();
        }
        if (data1 === 121) {
            channel.cc[1] = channel.cc[64] = channel.cc[66] = channel.cc[67] = 0;
            channel.cc[11] = 127;
            channel.cc[98] = channel.cc[99] = channel.cc[100] = channel.cc[101] = 127;
            channel.bend = 8192; channel.pressure = 0; channel.polyPressure.fill(0);
            for (const note of channel.notes) note.sostenuto = false;
            releasePedals();
        }
        if (data1 === 98 || data1 === 99) channel.cc[100] = channel.cc[101] = 127;
        if (data1 === 100 || data1 === 101) channel.cc[98] = channel.cc[99] = 127;
        if ((data1 === 6 || data1 === 38) && channel.cc[101] === 0 && channel.cc[100] === 0) {
            channel.bendRange = channel.cc[6];
            channel.bendCents = channel.cc[38];
        }
    } else if (kind === 0xc0) channel.program = data1;
    else if (kind === 0xd0) channel.pressure = data1;
    else if (kind === 0xe0) channel.bend = data1 + data2 * 128;
    else if (kind === 0xa0) channel.polyPressure[data1] = data2;
}

export function midiChannelPitch(channel, pitch) {
    return pitch + (channel.bend - 8192) / 8192 * (channel.bendRange + channel.bendCents / 100);
}

// Persistent port state is bounded by MIDI's channels/controllers, not by how
// long the device has been connected. No note messages enter hydration.
function createSeenChannels() {
    return Array.from({ length: 16 }, () => ({ cc: new Map(), pressure: new Set(),
        bend: false, aftertouch: false, program: null, range: null, drumMode: false }));
}

export class MidiInputState {
    constructor() {
        this.channels = createMidiChannels();
        this.seen = createSeenChannels();
        this.sequence = 0;
        this.globalCurrent = new Map();
        this.history = [];
        this.hits = [];
        this.systemReset = 0;
    }

    apply(event) {
        if (event.systemReset) {
            for (const channel of this.channels) for (const note of channel.notes)
                this.history.push({ ...note, end: event.seconds });
            applyMidiEvent(this.channels, event);
            this.seen = createSeenChannels();
            this.globalCurrent.clear();
            this.systemReset = event.systemReset;
            this.sequence++;
            this.prune(event.seconds);
            return;
        }
        if (event.drumMode) {
            applyMidiEvent(this.channels, event);
            this.seen[event.drumMode.channel].drumMode = true;
            this.sequence++;
            return;
        }
        const index = event.status & 15, kind = event.status & 0xf0;
        const channel = this.channels[index], seen = this.seen[index];
        const previous = channel.notes.slice();
        const sequence = ++this.sequence;
        const globalSource = kind === 0xb0 ? event.data1 : kind === 0xe0 ? 128 : kind === 0xd0 ? 129 : kind === 0xa0 ? 130 : null;
        if (globalSource !== null) this.globalCurrent.set(index * 256 + globalSource, { status: event.status,
            data1: event.data1, data2: event.data2 ?? 0, order: sequence });
        const value = { ...event, track: index, order: sequence, isDrum: !!channel.drumMode };
        applyMidiEvent(this.channels, value);
        // A display trail is finite even during a continuous performance.
        if (channel.notes.length > 128) channel.notes.splice(0, channel.notes.length - 128);
        for (const note of previous) if (!channel.notes.includes(note))
            this.history.push({ ...note, end: event.seconds });
        if (kind === 0x90 && event.data2) this.hits.push(value);
        this.prune(event.seconds);
        if (kind === 0xb0) {
            seen.cc.set(event.data1, sequence);
            if (event.data1 === 121) {
                for (const cc of [1, 11, 64, 66, 67, 98, 99, 100, 101]) seen.cc.set(cc, sequence);
                seen.bend = seen.aftertouch = true;
                for (const key of seen.pressure) channel.polyPressure[key] = 0;
            }
            if (event.data1 === 98 || event.data1 === 99)
                for (const cc of [100, 101]) seen.cc.set(cc, sequence);
            if (event.data1 === 100 || event.data1 === 101)
                for (const cc of [98, 99]) seen.cc.set(cc, sequence);
            if ((event.data1 === 6 || event.data1 === 38) && channel.cc[100] === 0 && channel.cc[101] === 0)
                seen.range = [channel.bendRange, channel.bendCents];
        } else if (kind === 0xc0) seen.program = [channel.cc[0], channel.cc[32], channel.program];
        else if (kind === 0xd0) seen.aftertouch = true;
        else if (kind === 0xe0) seen.bend = true;
        else if (kind === 0xa0) seen.pressure.add(event.data1);
    }

    prune(seconds) {
        this.history = this.history.filter(note => note.end >= seconds - 10).slice(-2048);
        this.hits = this.hits.filter(event => event.seconds >= seconds - 10).slice(-2048);
    }

    hydration() {
        const events = [];
        if (this.systemReset) events.push({ status: 0, data1: 0, data2: 0, flags: MIDI_SYSTEM_RESET, noteId: this.systemReset });
        const append = (status, data1, data2 = 0) => events.push({ status, data1, data2, flags: 2048 });
        for (let index = 0; index < 16; index++) {
            const channel = this.channels[index], seen = this.seen[index], cc = channel.cc;
            const control = (number, value) => append(0xb0 | index, number, value);
            if (seen.drumMode) events.push({ status: 0, data1: index, data2: channel.drumMode, flags: MIDI_DRUM_MODE, noteId: 0 });
            if (seen.program) {
                control(0, seen.program[0]); control(32, seen.program[1]);
                append(0xc0 | index, seen.program[2]);
            }
            if (seen.cc.has(121)) control(121, cc[121]);
            if (seen.range) {
                control(101, 0); control(100, 0);
                control(6, seen.range[0]); control(38, seen.range[1]);
            }
            if (seen.range || seen.cc.has(6) || seen.cc.has(38)) {
                control(101, 127); control(100, 127);
            }
            for (const number of seen.cc.keys()) {
                if (number !== 121 && (number < 98 || number > 101)) control(number, cc[number]);
            }
            // Restore the selected RPN/NRPN after Data Entry, so unrelated
            // historical transactions cannot replace the retained bend range.
            const selectors = cc[100] !== 127 || cc[101] !== 127 ? [98, 99, 100, 101] : [100, 101, 98, 99];
            for (const number of selectors)
                if (seen.cc.has(number)) control(number, cc[number]);
            if (seen.bend) append(0xe0 | index, channel.bend & 127, channel.bend >> 7);
            if (seen.aftertouch) append(0xd0 | index, channel.pressure);
            for (const key of seen.pressure) append(0xa0 | index, key, channel.polyPressure[key]);
        }
        // Restore only actual accepted controller values in their original order.
        // Retaining one value per channel/source also serves selected-channel
        // instruments without changing the shared pending snapshot protocol.
        for (const { status, data1, data2 } of [...this.globalCurrent.values()].sort((a, b) => a.order - b.order))
            events.push({ status, data1, data2, flags: 1024 });
        return events;
    }
}

/** Seek state is strictly before the target; events exactly at the target belong to playback. */
export function restoreMidiState(timeline, position) {
    const channels = createMidiChannels();
    const eventIndex = midiEventIndex(timeline.events, position);
    const history = timeline.events.slice(0, eventIndex);
    for (const event of history) applyMidiEvent(channels, event);
    const messages = [];
    const append = (status, data1, data2 = 0) => messages.push({ status, data1, data2 });
    for (let index = 0; index < channels.length; index++) {
        const channel = channels[index];
        append(0xb0 | index, 0, channel.cc[0]);
        append(0xb0 | index, 32, channel.cc[32]);
        append(0xc0 | index, channel.program);
        // Preserve RPN/NRPN transactions in the original history. This snapshot is
        // for hosts which restore the compiled engine separately before reattacks.
        for (let cc = 1; cc < 120; cc++) if (cc !== 32) append(0xb0 | index, cc, channel.cc[cc]);
        append(0xe0 | index, channel.bend & 127, channel.bend >> 7);
        append(0xd0 | index, channel.pressure);
        for (let pitch = 0; pitch < 128; pitch++) if (channel.polyPressure[pitch]) append(0xa0 | index, pitch, channel.polyPressure[pitch]);
        for (const note of channel.notes) append(0x90 | index, note.pitch, note.velocity);
    }
    return { messages, history, channels, notes: channels.flatMap(channel => channel.notes), eventIndex };
}

export function midiTempoAt(timeline, position) {
    const map = timeline.tempoMap;
    return map[Math.max(0, midiEventIndex(map, position, true) - 1)];
}

export function midiTickAt(timeline, position) {
    if (timeline.secondsPerTick !== null) return position / timeline.secondsPerTick;
    const tempo = midiTempoAt(timeline, position);
    return tempo.tick + (position - tempo.seconds) * timeline.division * 1000000 / tempo.microsecondsPerQuarter;
}

export function midiBeatAt(timeline, position) {
    const tempo = midiTempoAt(timeline, position);
    const signature = timeline.timeSignatures[Math.max(0, midiEventIndex(timeline.timeSignatures, position, true) - 1)];
    const tick = midiTickAt(timeline, position);
    const quarter = timeline.division & 0x8000
        ? tempo.quarter + (position - tempo.seconds) * 1000000 / tempo.microsecondsPerQuarter : tick / timeline.division;
    return { ...signature, bpm: 60000000 / tempo.microsecondsPerQuarter, quarter,
        meterQuarter: quarter - signature.quarter };
}
