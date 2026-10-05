import { GUITAR_SCALES, guitarAnalysis } from './visualizer-model.js';

// Note Spectrogram telemetry: 88 notes from A0, each in five fine pitch bins.
const FIRST_MIDI = 21;
const NOTE_COUNT = 88;
const FINE = 5;
const FINE_CENTER = 2;
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const INTERVAL_NAMES = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const SINGLE_INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAYS = new Set([12, 24]);
// Notes fade out when the source stops sending frames, e.g. while processing is suspended.
const STALE_MS = 500;
// Shape search: a note left without a string costs more than a wide stretch.
const DROP_COST = 10;
// Marks glide toward each detected pitch so 1/60-octave steps read as continuous motion.
const GLIDE_SECONDS = 0.04;
// Detections closer than this are one sound whose pitch lies between two notes.
const MERGE_SEMITONES = 0.5;
// A sound keeps its mark while its pitch moves less than this between frames, as in vibrato.
const FOLLOW_SEMITONES = 0.75;
// Note Spectrogram revises each frame's detection this many frames later.
const REVISION_AGE = 8;

const isNewer = (candidate, current) => {
    const delta = (candidate - current) >>> 0;
    return delta !== 0 && delta < 0x80000000;
};
const near = (peaks, pitch, range) => peaks.some(peak => Math.abs(peak.pitch - pitch) < range);
const pitchClass = midi => ((midi % 12) + 12) % 12;
// Fret wire position along a scale length of 1, or evenly spaced frets.
const wirePosition = (fret, realistic) => realistic ? 1 - 2 ** (-fret / 12) : fret;

// A fretboard driven by Note Spectrogram's latest detection, hosted like the analyzer plugins.
export class GuitarFretboardDisplay {
    initializeDisplayState() {
        // Latest detected sounds, and the tracked sounds that are drawn: { pitch, target, confidence, level, volume, size }.
        this.peaks = [];
        this.voices = [];
        // Recent frames' detections, the revision's added sounds, and the pitches it ruled out.
        this.recent = [];
        this.revisedPeaks = [];
        this.dropped = [];
        // Volume scale reference, tracked as in Note Spectrogram.
        this.levelReference = -Infinity;
        this.levelReferenceHold = 0;
        this.telemetrySource = null;
        this.activeGeneration = null;
        this.lastFrameIndex = null;
        this.frameArrived = false;
        this.frameTime = -Infinity;
        this.drawTime = null;
        this.shapeKey = null;
        this.shape = new Map();
        this.hand = null;
    }

    setParameters(changed) {
        this.params = { ...this.params, ...changed };
        // mn and mx also map the gradient palette over the playable range.
        Object.assign(this, guitarAnalysis(this.params));
        this.shapeKey = null;
    }

    handleTelemetry(frame) {
        const Note = window.NoteSpectrogramPlugin;
        const snapshot = Note?.prototype.parseTelemetryFrame(frame);
        if (!snapshot) return;
        if (frame.source !== this.telemetrySource) {
            this.telemetrySource = frame.source;
            this.activeGeneration = null;
        }
        if (this.activeGeneration === null || isNewer(snapshot.generation, this.activeGeneration)) {
            this.activeGeneration = snapshot.generation;
            this.lastFrameIndex = null;
            this.recent = [];
        } else if (snapshot.generation !== this.activeGeneration) return;
        if (this.lastFrameIndex !== null && !isNewer(snapshot.frameIndex, this.lastFrameIndex)) return;
        const elapsed = (this.lastFrameIndex === null ? 1 : (snapshot.frameIndex - this.lastFrameIndex) >>> 0) * snapshot.hopSeconds;
        this.lastFrameIndex = snapshot.frameIndex;
        this.peaks = this.detectPeaks(snapshot.levels, snapshot.volumeLevels);
        this.recent = this.recent.filter(record => ((snapshot.frameIndex - record.frameIndex) >>> 0) <= REVISION_AGE);
        this.recent.push({ frameIndex: snapshot.frameIndex, peaks: this.peaks, volumes: snapshot.volumeLevels });
        if (snapshot.revisionAge > 0) this.applyRevision((snapshot.frameIndex - snapshot.revisionAge) >>> 0, snapshot.revisedLevels);
        let framePeak = -Infinity;
        for (const peak of this.peaks) if (peak.volume > framePeak) framePeak = peak.volume;
        Note.updateLevelReference(this, framePeak, elapsed);
        this.frameArrived = true;
    }

    // Sounds whose strongest fine bin reaches the threshold, one per sound.
    detectPeaks(levels, volumes) {
        const last = NOTE_COUNT * FINE - 1;
        const candidates = [];
        for (let note = 0; note < NOTE_COUNT; note++) {
            let best = note * FINE;
            for (let bin = best + 1; bin < note * FINE + FINE; bin++) if (levels[bin] > levels[best]) best = bin;
            const peak = levels[best];
            if (!(peak >= this.params?.th)) continue;
            // Parabolic interpolation over the neighboring fine bins places the peak between bins.
            let shift = 0;
            if (best > 0 && best < last) {
                const below = levels[best - 1], above = levels[best + 1];
                const curvature = below - 2 * peak + above;
                if (curvature < 0) shift = 0.5 * (below - above) / curvature;
                shift = shift < -0.5 ? -0.5 : shift > 0.5 ? 0.5 : shift;
            }
            candidates.push({ pitch: FIRST_MIDI + (best - FINE_CENTER + shift) / FINE, confidence: peak, volume: volumes[best] });
        }
        // A pitch between two notes can light both; the stronger detection stands for the sound.
        candidates.sort((a, b) => b.confidence - a.confidence);
        const peaks = [];
        for (const candidate of candidates) if (!near(peaks, candidate.pitch, MERGE_SEMITONES)) peaks.push(candidate);
        return peaks;
    }

    // The revised detection of an earlier frame shows the sounds the first pass missed,
    // and rules out first-pass sounds that no later frame has detected either.
    applyRevision(frameIndex, levels) {
        const record = this.recent.find(entry => entry.frameIndex === frameIndex);
        if (!record) return;
        const revised = this.detectPeaks(levels, record.volumes);
        const later = this.recent.filter(entry => isNewer(entry.frameIndex, frameIndex));
        // Several frames can arrive between draws, so the results add up until the next draw.
        this.revisedPeaks.push(...revised.filter(peak => !near(record.peaks, peak.pitch, MERGE_SEMITONES)));
        this.dropped.push(...record.peaks.filter(peak => !near(revised, peak.pitch, MERGE_SEMITONES) &&
            !later.some(entry => near(entry.peaks, peak.pitch, FOLLOW_SEMITONES))).map(peak => peak.pitch));
    }

    // Each detected sound continues the nearest tracked sound, so a vibrato across a
    // semitone moves one mark. Marks rise at once and fall linearly over the fall time.
    stepLevels(nowMs) {
        const dt = this.drawTime === null || nowMs < this.drawTime ? 0 : (nowMs - this.drawTime) / 1000;
        this.drawTime = nowMs;
        const loudness = volume => window.NoteSpectrogramPlugin.normalizedLevel(volume, this.levelReference);
        const addVoice = peak => this.voices.push({ pitch: peak.pitch, target: peak.pitch, confidence: peak.confidence, level: 0,
            volume: peak.volume, size: loudness(peak.volume) });
        if (this.frameArrived) {
            this.frameArrived = false;
            this.frameTime = nowMs;
            for (const voice of this.voices) voice.confidence = 0;
            for (const peak of this.peaks) {
                let match = null;
                for (const voice of this.voices) {
                    const distance = Math.abs(voice.target - peak.pitch);
                    if (voice.confidence === 0 && distance < FOLLOW_SEMITONES &&
                        (!match || distance < Math.abs(match.target - peak.pitch))) match = voice;
                }
                if (match) Object.assign(match, { target: peak.pitch, confidence: peak.confidence, volume: peak.volume });
                else addVoice(peak);
            }
            // A missed sound found by the revision lights its nearest mark, or a new one, without moving it.
            for (const peak of this.revisedPeaks) {
                let match = null;
                for (const voice of this.voices) {
                    const distance = Math.abs(voice.target - peak.pitch);
                    if (distance < FOLLOW_SEMITONES && (!match || distance < Math.abs(match.target - peak.pitch))) match = voice;
                }
                if (!match) addVoice(peak);
                else if (peak.confidence > match.confidence) match.confidence = peak.confidence;
            }
            // A sound ruled out by the revision disappears at once unless the latest frame detects it.
            this.voices = this.voices.filter(voice => voice.confidence > 0 ||
                !this.dropped.some(pitch => Math.abs(voice.target - pitch) < FOLLOW_SEMITONES));
            this.revisedPeaks = [];
            this.dropped = [];
        }
        const live = nowMs - this.frameTime <= STALE_MS;
        const fall = this.params.cf > 0 ? dt / this.params.cf : 1;
        const glide = 1 - Math.exp(-dt / GLIDE_SECONDS);
        this.voices = this.voices.filter(voice => {
            const target = live ? voice.confidence : 0;
            const fallen = voice.level - fall;
            voice.level = target >= fallen ? target : fallen;
            voice.pitch += (voice.target - voice.pitch) * glide;
            voice.size += (loudness(voice.volume) - voice.size) * glide;
            return voice.level > 0;
        });
    }

    // One playable position per note: distinct strings, a small fretted span, and
    // close to the previous hand position so the shape does not jump around.
    solveShape(notes, frets) {
        const key = `${notes.join(',')}/${notes.filter(midi => frets.offNut.has(midi)).join(',')}`;
        if (key === this.shapeKey) return;
        this.shapeKey = key;
        const { tn, cp } = this.params;
        const candidates = notes.map(midi => tn.flatMap((open, string) => {
            const fret = midi - open;
            return fret >= frets.low && fret <= frets.high && !(fret === cp && frets.offNut.has(midi)) ? [{ string, fret }] : [];
        }));
        const order = notes.map((_, index) => index).sort((a, b) => candidates[a].length - candidates[b].length);
        const used = new Array(tn.length).fill(false);
        const chosen = new Array(notes.length).fill(null);
        let best = Infinity, bestChoice = chosen.slice();
        const search = (depth, drops, low, high, sum, count) => {
            const partial = drops * DROP_COST + (count ? high - low : 0) + 0.01 * sum;
            if (partial >= best) return;
            if (depth === order.length) {
                const cost = partial + (count && this.hand !== null ? 0.5 * Math.abs(sum / count - this.hand) : 0);
                if (cost < best) { best = cost; bestChoice = chosen.slice(); }
                return;
            }
            const index = order[depth];
            for (const candidate of candidates[index]) {
                if (used[candidate.string]) continue;
                used[candidate.string] = true;
                chosen[index] = candidate;
                const fretted = candidate.fret > cp;
                search(depth + 1, drops,
                    fretted && candidate.fret < low ? candidate.fret : low,
                    fretted && candidate.fret > high ? candidate.fret : high,
                    sum + (fretted ? candidate.fret : 0), count + (fretted ? 1 : 0));
                used[candidate.string] = false;
            }
            chosen[index] = null;
            search(depth + 1, drops + 1, low, high, sum, count);
        };
        search(0, 0, Infinity, -Infinity, 0, 0);
        this.shape = new Map();
        let sum = 0, count = 0;
        bestChoice.forEach((candidate, index) => {
            if (!candidate) return;
            this.shape.set(notes[index], candidate);
            if (candidate.fret > cp) { sum += candidate.fret; count++; }
        });
        if (count) this.hand = sum / count;
    }

    drawGraph(nowMs) {
        const params = this.params;
        if (!params?.tn) return;
        this.stepLevels(nowMs);
        const context = this.ctx, options = this.displayOptions, theme = options.themePalette;
        const { tn, fm, fx, cp, pm, lb, ly } = params;
        const width = this.canvas.width, height = this.canvas.height;
        context.clearRect(0, 0, width, height);
        const vertical = ly === 'Vertical';
        const dpr = this.graphDpr || 1;
        const fontSize = 11 * dpr;
        const font = `${fontSize}px Arial`;
        // u runs along the neck from the headstock; v runs across the strings.
        const point = (u, v) => vertical ? [v, u] : [u, v];
        const length = vertical ? height : width, across = vertical ? width : height;
        const u0 = params.sn ? fontSize * (vertical ? 1.8 : 2.6) : fontSize * 0.5;
        const u1 = length - fontSize * 0.5;
        const numberPad = params.fn ? fontSize * (vertical ? 2.2 : 1.8) : fontSize * 0.5;
        const v0 = vertical ? numberPad : fontSize * 0.5;
        const v1 = vertical ? across - fontSize * 0.5 : across - numberPad;
        if (u1 <= u0 || v1 <= v0) return;

        const first = fm > 1 ? fm : 1;
        const spaces = fx >= first ? fx - first + 1 : 0;
        // A fretless neck plays notes on the fret lines, so it extends half a fret past each end.
        const fretless = params.fl;
        const margin = fretless ? 0.5 : 0;
        const start = first > 1 ? first - 1 + margin : 0;
        const end = spaces ? fx + margin : start;
        const base = wirePosition(start, params.rs);
        const span = wirePosition(end, params.rs) - base;
        // Open strings get the width of the first fret so their marks are as large as its marks.
        const openZone = fm === 0 ? wirePosition(1, params.rs) : 0;
        const unit = (u1 - u0) / (openZone + span);
        const wireU = fret => u0 + (openZone + wirePosition(fret, params.rs) - base) * unit;
        const fretU = fret => fret === 0 ? u0 + openZone * unit / 2 : (wireU(fret - 1) + wireU(fret)) / 2;
        const fretWidth = fret => fret === 0 ? openZone * unit : wireU(fret) - wireU(fret - 1);
        const noteU = fret => fretless ? wireU(fret) : fretU(fret);
        const strings = tn.length;
        const gap = (v1 - v0) / strings;
        // The thickest string lies at the bottom, or on the left of a vertical neck.
        const stringV = string => vertical ? v0 + (string + 0.5) * gap : v1 - (string + 0.5) * gap;
        const low = fm > cp ? fm : cp;
        const radiusAt = fret => (gap < fretWidth(fret) ? gap : fretWidth(fret)) * 0.42;

        const fillRect = (ua, ub, va, vb) => {
            const [x0, y0] = point(ua, va), [x1, y1] = point(ub, vb);
            context.fillRect(x0 < x1 ? x0 : x1, y0 < y1 ? y0 : y1, Math.abs(x1 - x0), Math.abs(y1 - y0));
        };
        const line = (ua, va, ub, vb) => {
            context.beginPath();
            context.moveTo(...point(ua, va));
            context.lineTo(...point(ub, vb));
            context.stroke();
        };
        const circle = (target, u, v, radius) => {
            target.beginPath();
            target.arc(...point(u, v), radius, 0, Math.PI * 2);
        };

        if (spaces && params.fb) {
            context.fillStyle = theme.get('graph-base-soft');
            fillRect(wireU(start), wireU(end), v0, v1);
        }
        if (params.mk) {
            // Markers sit between strings so they never hide a note, as on a real neck.
            const middle = [v0 + Math.floor(strings / 2) * gap];
            const outer = Math.round(strings / 3);
            const pair = outer > 0 && outer < strings - outer ? [v0 + outer * gap, v1 - outer * gap] : middle;
            context.fillStyle = theme.get('graph-grid-soft');
            for (let fret = first; fret <= fx; fret++) {
                const positions = SINGLE_INLAYS.has(fret) ? middle : DOUBLE_INLAYS.has(fret) ? pair : null;
                if (!positions) continue;
                for (const v of positions) {
                    circle(context, noteU(fret), v, radiusAt(fret) * 0.45);
                    context.fill();
                }
            }
        }
        context.strokeStyle = theme.get(fretless ? 'graph-grid-soft' : 'graph-grid-strong');
        context.lineWidth = (fretless ? 1 : 1.5) * dpr;
        for (let fret = Math.ceil(start); fret <= fx; fret++) line(wireU(fret), v0, wireU(fret), v1);
        if (first === 1) {
            context.strokeStyle = theme.get('text-primary');
            context.lineWidth = 4 * dpr;
            line(wireU(0), v0, wireU(0), v1);
        }
        context.strokeStyle = theme.get('graph-trace-tertiary');
        tn.forEach((open, string) => {
            // Lower strings are drawn thicker.
            const thickness = 0.6 + (64 - open) / 16;
            context.lineWidth = dpr * (thickness < 0.6 ? 0.6 : thickness > 3 ? 3 : thickness);
            line(fm === 0 ? u0 : wireU(start), stringV(string), wireU(end), stringV(string));
        });
        if (cp >= first && cp <= fx) {
            context.fillStyle = theme.get('graph-label');
            const right = wireU(cp) - fretWidth(cp) * 0.08;
            fillRect(right - fretWidth(cp) * 0.22, right, v0 - gap * 0.15, v1 + gap * 0.15);
        }

        // Each sound is named and fretted by its nearest note.
        // A fretless string cannot sound below its nut or capo, so a flat open note moves to
        // another string that can play it in the shown range.
        const sounding = new Map(), offNut = new Set();
        for (const voice of this.voices) {
            const midi = Math.round(voice.pitch);
            if (sounding.get(midi) >= voice.level) continue;
            sounding.set(midi, voice.level);
            if (fretless && voice.pitch < midi && tn.some(open => midi - open > low && midi - open <= fx)) offNut.add(midi);
            else offNut.delete(midi);
        }
        const notes = [...sounding.keys()].sort((a, b) => a - b);
        const root = params.ro >= 0 ? params.ro : notes.length ? pitchClass(notes[0]) : -1;
        const names = lb === 'flat' ? FLAT_NAMES : SHARP_NAMES;
        const scaleSteps = params.ro >= 0 && params.sk !== 'none' ? GUITAR_SCALES[params.sk] : null;
        if (scaleSteps) {
            context.strokeStyle = context.fillStyle = theme.get('graph-label');
            context.lineWidth = dpr;
            tn.forEach((open, string) => {
                for (let fret = low; fret <= fx; fret++) {
                    const interval = pitchClass(open + fret - root);
                    if (!scaleSteps.includes(interval)) continue;
                    circle(context, noteU(fret), stringV(string), radiusAt(fret) * 0.6);
                    if (interval === 0) context.fill();
                    else context.stroke();
                }
            });
        }

        context.font = font;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = theme.get('graph-label');
        if (params.sn) {
            tn.forEach((open, string) => {
                options.textContext.fillText(`${names[pitchClass(open)]}${Math.floor(open / 12) - 1}`,
                    ...point(u0 / 2, stringV(string)));
            });
        }
        if (params.fn) {
            const numberV = vertical ? v0 / 2 : (v1 + across) / 2;
            for (let fret = first; fret <= fx; fret++) {
                if (SINGLE_INLAYS.has(fret) || DOUBLE_INLAYS.has(fret) || (fret === first && fm > 0)) {
                    options.textContext.fillText(String(fret), ...point(noteU(fret), numberV));
                }
            }
        }

        // The strongest notes keep a string when there are more notes than strings.
        const shapeMode = pm !== 'all';
        if (shapeMode) {
            const strongest = notes.slice().sort((a, b) => sounding.get(b) - sounding.get(a));
            this.solveShape(strongest.slice(0, strings).sort((a, b) => a - b), { low, high: fx, offNut });
        }
        const marks = [];
        for (const { pitch, level, size } of this.voices) {
            const midi = Math.round(pitch);
            const placed = this.shape.get(midi);
            tn.forEach((open, string) => {
                const fret = midi - open;
                if (fret < low || fret > fx || (fret === cp && offNut.has(midi))) return;
                const inShape = !shapeMode || (placed?.string === string && placed.fret === fret);
                if (!inShape && pm === 'shape') return;
                // Fretless marks follow the detected pitch; an open string stays on or past the nut.
                const stop = pitch - open < cp ? cp : pitch - open;
                // Size by Volume keeps a third of the dot so the quietest detected note stays visible.
                marks.push({ midi, u: noteU(fretless ? stop : fret), v: stringV(string),
                    radius: radiusAt(fret) * (params.vs ? 1 / 3 + 2 / 3 * size : 1),
                    alpha: inShape ? level : level * 0.3, color: options.noteColor(fretless ? pitch : midi, level) });
            });
        }
        if (!marks.length) return;
        options.drawSignal(context, target => {
            for (const mark of marks) {
                const [red, green, blue] = mark.color;
                target.fillStyle = target.strokeStyle = `rgba(${red},${green},${blue},${mark.alpha})`;
                circle(target, mark.u, mark.v, mark.radius);
                target.fill();
                if (pitchClass(mark.midi) === root) {
                    target.lineWidth = 2 * dpr;
                    circle(target, mark.u, mark.v, mark.radius * 1.25);
                    target.stroke();
                }
            }
        });
        if (lb === 'none') return;
        for (const mark of marks) {
            const labelSize = mark.radius * 0.95;
            if (labelSize < 6 * dpr) continue;
            const [red, green, blue] = mark.color;
            const light = 0.299 * red + 0.587 * green + 0.114 * blue > 140;
            context.font = `bold ${labelSize}px Arial`;
            context.globalAlpha = mark.alpha;
            context.fillStyle = light ? '#000' : '#fff'; // theme-allow: Contrasting text on a note-colored dot.
            options.textContext.fillText(lb === 'interval' ? INTERVAL_NAMES[pitchClass(mark.midi - root)]
                : names[pitchClass(mark.midi)], ...point(mark.u, mark.v));
        }
        context.globalAlpha = 1;
    }
}
