import { applyMidiEvent, createMidiChannels, midiChannelPitch, midiBeatAt } from '../midi/smf-timeline.js';

export const MIDI_VISUALIZER_TYPES = ['notes', 'drums', 'guitar', 'rhythm-analyzer', 'midi'];
// MIDI channels are zero-based; adjacent channels use widely separated hues.
const midiChannelHue = channel => channel * 112.5 % 360;
export const midiChannelColor = channel => `hsl(${midiChannelHue(channel)}, 60%, 55%)`; // theme-allow: Stable hues identify MIDI channels across themes.
export function midiChannelRgb(channel) {
    const sector = midiChannelHue(channel) / 60;
    // HSL saturation 60% and lightness 55% give chroma .54 and minimum .28.
    const chroma = .54, secondary = chroma * (1 - Math.abs(sector % 2 - 1));
    const components = sector < 1 ? [chroma, secondary, 0] : sector < 2 ? [secondary, chroma, 0]
        : sector < 3 ? [0, chroma, secondary] : sector < 4 ? [0, secondary, chroma]
        : sector < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    return components.map(value => Math.round((value + .28) * 255));
}
// GM percussion notes are explicit: unknown kit assignments remain unclassified.
const GM_DRUM_LANES = new Map([
    [35, 0], [36, 0], [38, 1], [40, 1], [37, 1], [39, 1],
    [42, 2], [44, 2], [46, 2], [49, 3], [51, 3], [52, 3], [53, 3], [55, 3], [57, 3], [59, 3],
    [41, 4], [43, 4], [45, 4], [47, 4], [48, 4], [50, 4]
]);
const CHORDS = [[0, 4, 7], [0, 3, 7], [0, 3, 6], [0, 4, 8], [0, 4, 7, 11],
    [0, 3, 7, 10], [0, 4, 7, 10], [0, 3, 6, 9], [0, 3, 6, 10], [0, 2, 7], [0, 5, 7]];
const CHORD_NAMES = ['', 'm', 'dim', 'aug', 'maj7', 'm7', '7', 'dim7', 'm7b5', 'sus2', 'sus4'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Chord naming is an interpretation of the pitches, rather than SMF metadata.
export function inferMidiChord(notes) {
    const pitches = notes.map(note => Math.round(note.pitch)).sort((a, b) => a - b);
    const classes = new Set(pitches.map(pitch => (pitch % 12 + 12) % 12));
    if (classes.size < 3) return null;
    for (const root of classes) for (let quality = 0; quality < CHORDS.length; quality++) {
        const intervals = CHORDS[quality];
        if (intervals.length !== classes.size || !intervals.every(interval => classes.has((root + interval) % 12))) continue;
        const bass = pitches[0] % 12;
        return { root, quality, bass, name: NOTE_NAMES[root] + CHORD_NAMES[quality] +
            (bass !== root ? '/' + NOTE_NAMES[bass] : '') };
    }
    return null;
}

/** One song-owned clock and state projection, shared by all four displays. */
export class MidiVisualizerAdapter {
    reset(presentation) {
        // Checkpoint generations restart note projection without changing the song's beat history.
        if (this.timeline !== presentation.timeline || this.presentationEpoch !== presentation.presentationEpoch ||
            this.sourceGeneration !== presentation.sourceGeneration) this.clockIdentity = {};
        this.timeline = presentation.timeline;
        this.presentationEpoch = presentation.presentationEpoch;
        this.sourceGeneration = presentation.sourceGeneration;
        this.generation = presentation.generation;
        this.channels = createMidiChannels();
        this.index = 0;
        this.position = -1;
        this.history = [];
        this.hits = [];
        this.identity = {};
    }

    snapshot(presentation) {
        if (presentation.live) {
            const state = presentation.live;
            const notes = state.channels.flatMap(channel => channel.notes.filter(note => !note.isDrum)
                .map(note => ({ ...note, pitch: midiChannelPitch(channel, note.pitch) })));
            return { sourceKind: 'midi', source: state, generation: presentation.generation, channels: state.channels,
                position: presentation.position, playing: true, paused: false, speed: 1,
                notes, history: state.history.filter(note => !note.isDrum),
                hits: state.hits.map(event => ({ time: event.seconds, velocity: event.data2 / 127,
                    band: event.isDrum ? GM_DRUM_LANES.get(event.data1) : undefined,
                    channel: event.status & 15, note: event.data1, identity: `${event.track}:${event.order}` })),
                beat: null, chord: inferMidiChord(notes) };
        }
        const position = Math.max(0, Math.min(presentation.timeline.duration, presentation.position || 0));
        if (this.timeline !== presentation.timeline || this.presentationEpoch !== presentation.presentationEpoch ||
            this.sourceGeneration !== presentation.sourceGeneration || this.generation !== presentation.generation ||
            position < this.position) this.reset(presentation);
        if (this.position === position && this.playing === presentation.playing && this.paused === presentation.paused &&
            this.current?.speed === (presentation.speed || 1)) return this.current;
        const events = this.timeline.events;
        while (this.index < events.length && events[this.index].seconds <= position) {
            const event = events[this.index++];
            const channel = this.channels[event.status & 15];
            const previous = channel.notes.slice();
            applyMidiEvent(this.channels, event);
            for (const note of previous) if (!channel.notes.includes(note) && !note.isDrum) {
                this.history.push({ ...note, end: event.seconds });
            }
            if ((event.status & 0xf0) === 0x90 && event.data2) {
                this.hits.push({ time: event.seconds, velocity: event.data2 / 127,
                    band: channel.drumMode ? GM_DRUM_LANES.get(event.data1) : undefined,
                    channel: event.status & 15, note: event.data1,
                    identity: `${event.track}:${event.order}` });
            }
        }
        this.history = this.history.filter(note => note.end >= position - 10);
        this.hits = this.hits.filter(hit => hit.time >= position - 10);
        const ended = position >= this.timeline.duration;
        const stopped = !presentation.playing && !presentation.paused;
        const notes = ended || stopped ? [] : this.channels.flatMap(channel => channel.notes.filter(note => !note.isDrum)
            .map(note => ({ ...note, pitch: midiChannelPitch(channel, note.pitch) })));
        this.position = position;
        this.playing = presentation.playing;
        this.paused = presentation.paused;
        this.current = { sourceKind: 'midi', source: this.identity, clockSource: this.clockIdentity, generation: this.generation,
            position, playing: presentation.playing, paused: presentation.paused,
            speed: presentation.speed || 1, channels: this.channels, notes, history: stopped ? [] : this.history,
            hits: ended || stopped ? [] : this.hits, beat: midiBeatAt(this.timeline, position),
            beatAt: seconds => midiBeatAt(presentation.timeline, seconds), chord: inferMidiChord(notes) };
        return this.current;
    }
}

function displayColor(item, context, width, height) {
    if (item.palette.mode === 'solid') return item.palette.color;
    const gradient = context.createLinearGradient(0, height, width, 0);
    const stops = item.palette.stops || [];
    if (!stops.length) return '#66c2ff'; // theme-allow: Fallback matches the default graph trace.
    for (const stop of stops) gradient.addColorStop(stop.position ?? stop.pos ?? 0, stop.color);
    return gradient;
}

export function drawMidiNotes(context, canvas, item, snapshot, theme) {
    const { width, height } = canvas, params = item.params;
    const low = params.mn, high = params.mx, count = high - low + 1;
    const vertical = params.ly === 'Vertical';
    const keySize = params.kb ? Math.min(width, height) * .13 * params.kl / 100 : 0;
    const plotWidth = width - (vertical ? 0 : keySize), plotHeight = height - (vertical ? keySize : 0);
    const now = snapshot.position, span = params.ts;
    context.clearRect(0, 0, width, height);
    context.save();
    context.beginPath(); context.rect(0, 0, plotWidth, plotHeight); context.clip();
    if (params.showAxes) {
        context.strokeStyle = theme.get('graph-grid-subtle'); context.lineWidth = 1;
        for (let note = low; note <= high; note++) {
            context.beginPath();
            if (vertical) { const x = (note - low) / count * plotWidth; context.moveTo(x, 0); context.lineTo(x, plotHeight); }
            else { const y = (high - note) / count * plotHeight; context.moveTo(0, y); context.lineTo(plotWidth, y); }
            context.stroke();
        }
    }
    const drawNote = (note, end) => {
        if (note.pitch < low || note.pitch > high || end < now - span) return;
        const start = Math.max(now - span, note.start);
        const from = (start - now + span) / span, to = (Math.min(now, end) - now + span) / span;
        context.fillStyle = item.palette.mode === 'note-colors' && globalThis.window?.NoteSpectrogramPlugin?.noteColor
            ? `rgb(${window.NoteSpectrogramPlugin.noteColor(Math.round(note.pitch)).join(',')})` : displayColor(item, context, width, height);
        context.globalAlpha = params.vl ? note.velocity / 127 : 1;
        if (vertical) context.fillRect((note.pitch - low) / count * plotWidth, (1 - to) * plotHeight,
            Math.max(1, plotWidth / count), Math.max(2, (to - from) * plotHeight));
        else context.fillRect(from * plotWidth, (high - note.pitch) / count * plotHeight,
            Math.max(2, (to - from) * plotWidth), Math.max(1, plotHeight / count));
    };
    for (const note of snapshot.history) drawNote(note, note.end);
    for (const note of snapshot.notes) drawNote(note, now);
    context.restore();
    if (params.kb) {
        for (let note = low; note <= high; note++) {
            const black = [1, 3, 6, 8, 10].includes(note % 12);
            context.fillStyle = black ? theme.get('graph-label') : theme.get('graph-base-soft');
            if (vertical) context.fillRect((note - low) / count * plotWidth, plotHeight, plotWidth / count, keySize);
            else context.fillRect(plotWidth, (high - note) / count * plotHeight, keySize, plotHeight / count);
        }
    }
    if (params.showAxisNumbers) {
        context.fillStyle = theme.get('graph-label'); context.font = `${Math.max(10, height / 24)}px sans-serif`;
        context.fillText('MIDI · velocity', 5, Math.max(12, height / 22));
    }
    if (params.ck && snapshot.chord) {
        context.fillStyle = theme.get('text-primary'); context.textAlign = 'right';
        context.font = `${Math.max(12, height / 15)}px sans-serif`;
        context.fillText(snapshot.chord.name, width - 5, Math.max(16, height / 12));
        context.textAlign = 'left';
    }
}
