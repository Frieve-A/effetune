// This dependency-free scheduler is also injected into the standalone audio worklet.
export const MIDI_EVENT_CAPACITY = 4096;
export const MIDI_SYSTEM_RESET = 8192;
export const MIDI_DRUM_MODE = 16384;
const MIDI_RESTORE_SLICE = 256;

// Merge the parser's two ordered maps once, outside audio processing. A meter
// origin stays fixed through tempo changes; native code derives each bar from it.
export function midiTransportPoints(timeline) {
    if (!timeline?.tempoMap?.length || !timeline?.timeSignatures?.length) return [];
    const points = [];
    let tempoIndex = 0, meterIndex = 0, tempo, meter;
    while (tempoIndex < timeline.tempoMap.length || meterIndex < timeline.timeSignatures.length) {
        const seconds = Math.min(timeline.tempoMap[tempoIndex]?.seconds ?? Infinity,
            timeline.timeSignatures[meterIndex]?.seconds ?? Infinity);
        while (timeline.tempoMap[tempoIndex]?.seconds === seconds) tempo = timeline.tempoMap[tempoIndex++];
        while (timeline.timeSignatures[meterIndex]?.seconds === seconds) meter = timeline.timeSignatures[meterIndex++];
        const bpm = 60000000 / tempo.microsecondsPerQuarter;
        points.push({ seconds, ppq: tempo.quarter + (seconds - tempo.seconds) * bpm / 60,
            barStartPpq: meter.quarter, bpm, numerator: meter.numerator, denominator: meter.denominator });
    }
    return points;
}

export function midiMinimumPhysicalBpm(timeline) {
    const points = midiTransportPoints(timeline);
    return points.length ? points.reduce((minimum, point) => Math.min(minimum, point.bpm), Infinity) * .25 : 0;
}

export function validateMidiSchedule(timeline, sampleRate, maximumSpeed = 4, maximumFrames = 128) {
    const window = maximumFrames / sampleRate * maximumSpeed;
    let first = 0;
    for (let index = 0; index < timeline.events.length; index++) {
        while (timeline.events[index].seconds - timeline.events[first].seconds >= window) first++;
        if (index - first + 1 > MIDI_EVENT_CAPACITY - 49) {
            const error = new Error('This MIDI file has too many simultaneous events to play.');
            error.code = 'midi-too-dense';
            throw error;
        }
    }
}

export class MidiFrameScheduler {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.instances = new Map();
        this.stagedInstances = new Map();
        this.timeline = null;
        this.generation = 0;
        this.playing = false;
        this.position = 0;
        this.anchorFrame = 0;
        this.speed = 1;
        this.gain = 1;
    }

    configure({ timeline = this.timeline, position = 0, anchorFrame = 0, speed = 1,
        gain = 1, playing = false, generation, preserveRelease = false, preparing = false, mode = 'reset' }) {
        if (!Number.isInteger(generation) || generation < this.generation) return false;
        if (!Number.isFinite(position) || !Number.isFinite(anchorFrame) ||
            !Number.isFinite(speed) || speed <= 0 || !Number.isFinite(gain)) return false;
        if (this.timeline !== timeline) this.transportPoints = midiTransportPoints(timeline);
        this.timeline = timeline;
        this.position = position;
        this.anchorFrame = anchorFrame;
        this.speed = speed;
        this.gain = gain;
        this.playing = playing;
        this.preparing = preparing;
        this.preparedNotified = false;
        this.generation = generation;
        this.endNotified = false;
        this.resetFlags = preserveRelease ? 9 : 1;
        this.mode = mode;
        this.input = null;
        this.pauseRequest = null;
        for (const state of this.instances.values()) {
            state.generation = -1;
            state.inputFrozen = state.inputResume = false;
            state.inputHydration = 0;
            // A newly ready paused bank has no restored timeline history.
            state.liveJoin = mode === 'live' || mode === 'resume' && (state.forceReset || state.restoring);
            state.joinInitialized = false;
            state.joinReset = mode === 'live' || mode === 'resume' && state.liveJoin;
        }
        return true;
    }

    configureInput({ generation, enabled, anchorFrame = 0 }) {
        if (!this.configure({ timeline: null, generation, anchorFrame, playing: enabled,
            preserveRelease: true, mode: 'input' })) return false;
        this.input = { enabled, targets: new Map(), events: [], serial: 0, hydrationSerial: 0 };
        return true;
    }

    hydrateInput(key, token, events, activation) {
        if (!this.input || !Array.isArray(events) || events.length > MIDI_EVENT_CAPACITY * 2) return false;
        const state = this.instances.get(key);
        if (state?.inputHydration && activation !== state.inputHydration) return false;
        this.input.targets.set(key, { token, events, revision: (this.input.targets.get(key)?.revision ?? 0) + 1 });
        if (state) state.inputHydration = 0;
        return true;
    }

    enqueueInput(events) {
        if (!this.input?.enabled || !Array.isArray(events) ||
            this.input.events.length + events.length > MIDI_EVENT_CAPACITY) return false;
        for (const event of events) {
            if (!Number.isSafeInteger(event.frame) || event.frame < 0 || !Array.isArray(event.targets)) return false;
            this.input.events.push({ ...event, serial: ++this.input.serial });
        }
        return true;
    }

    processInputInstance(binding, key, frame, frames, delay, enabled, ready) {
        const state = this.instances.get(key), input = this.input;
        if (!state || state.failed) return true;
        if (input.enabled && state.inputHydration) return false;
        if (state.inputFrozen && !state.inputResume) return false;
        const snapshot = input.targets.get(key);
        if (state.generation !== this.generation || state.forceReset || state.liveJoin) {
            if (input.enabled && (!enabled || !snapshot || snapshot.token !== state.token)) return false;
            state.batchCount = 0;
            this.send(binding, state, this.resetFlags);
            state.generation = this.generation;
            state.enabled = enabled;
            state.forceReset = state.liveJoin = state.restoring = false;
            state.paused = false;
            state.inputFrozen = state.inputResume = false;
            state.draining = !input.enabled;
            state.inputCursor = 0;
            state.inputOrigin = frame;
            state.clockFrame = 0;
            state.inputRevision = snapshot?.revision;
            if (input.enabled) {
                binding.instanceSetMidiGain(state.instanceId, 1);
                for (const event of snapshot.events) {
                    this.append(state, event.status, event.data1, event.data2, 0, event.noteId ?? 0, event.flags ?? 0);
                    if (state.batchCount === MIDI_EVENT_CAPACITY) { this.send(binding, state, 512); state.batchCount = 0; }
                }
                if (state.batchCount) this.send(binding, state, 512);
            }
            state.batchCount = 0;
        }
        if (!input.enabled) {
            this.clock(binding, state, state.clockFrame, 1);
            state.clockFrame += frames;
            return true;
        }
        if (!enabled) return false;
        if (!ready) {
            // A newly prepared target consumes current channel state without
            // replaying cold NoteOns after prefix readiness. The draft cursor is
            // still committed only after this actual native process callback.
            state.batchCount = 0;
            let systemReset = false;
            for (const event of input.events) {
                if (event.serial <= state.inputCursor) continue;
                if (event.frame + delay >= frame + frames) break;
                if (event.targets.some(target => target.id === key && target.token === state.token) &&
                    ![0x80, 0x90].includes(event.status & 0xf0)) {
                    this.append(state, event.status, event.data1, event.data2, 0,
                        event.systemReset || 0, event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : 0);
                    systemReset ||= !!event.systemReset;
                }
                state.inputCursor = event.serial;
            }
            if (state.batchCount) this.send(binding, state, systemReset ? 0 : 512);
            state.batchCount = 0;
            this.clock(binding, state, state.clockFrame, 0);
            return true;
        }
        this.pendingHistory(binding, state);
        const clock = Math.max(state.clockFrame, frame - state.inputOrigin);
        state.batchCount = 0;
        if (state.inputResume) {
            this.send(binding, state, 32);
            this.clock(binding, state, clock, 0);
            this.append(state, 0, 0, 0, 0, 0, 32, clock);
            state.inputFrozen = state.inputResume = false;
        } else this.clock(binding, state, clock, 1);
        state.paused = false;
        for (const event of input.events) {
            if (event.serial <= state.inputCursor) continue;
            const at = event.frame + delay;
            if (at >= frame + frames) break;
            if (event.targets.some(target => target.id === key && target.token === state.token))
                this.append(state, event.status, event.data1, event.data2, Math.max(0, at - frame),
                    event.systemReset || event.serial, event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : 0);
            state.inputCursor = event.serial;
        }
        this.send(binding, state);
        state.clockFrame = clock + frames;
        return true;
    }

    finishInputFrame(frame) {
        if (!this.input) return;
        this.input.events = this.input.events.filter(event => {
            // Losing processing ownership retires pending actions, including
            // future events. Rejoining receives current controls separately.
            let retained = 0;
            for (const target of event.targets) {
                const state = this.instances.get(target.id);
                if (state && !state.failed && state.enabled && state.token === target.token)
                    event.targets[retained++] = target;
            }
            event.targets.length = retained;
            return event.targets.length && (event.frame >= frame || event.targets.some(target =>
                (this.instances.get(target.id).inputCursor ?? 0) < event.serial));
        });
    }

    start(generation, anchorFrame) {
        if (generation !== this.generation || !Number.isFinite(anchorFrame)) return false;
        this.playing = true;
        this.preparing = false;
        this.anchorFrame = anchorFrame;
        return true;
    }

    requestPause(generation, frame) {
        if (!Number.isInteger(generation) || generation <= this.generation || !Number.isSafeInteger(frame) || frame < 0) return false;
        this.pauseRequest = { frame, position: Math.min(this.currentPosition(frame), this.timeline?.duration ?? Infinity), generation };
        if (!this.playing) { this.position = this.pauseRequest.position; this.anchorFrame = frame; this.playing = true; }
        this.generation = generation;
        this.mode = 'retime';
        this.preparing = false;
        this.preparedNotified = false;
        return true;
    }

    finishPause(frame) {
        if (!this.pauseRequest) return null;
        if (frame < this.pauseRequest.frame) return null;
        const request = this.pauseRequest;
        for (const state of this.instances.values()) if (state.enabled && !state.paused) return null;
        this.position = request.position;
        this.playing = false;
        this.preparing = false;
        this.mode = 'pause';
        this.pauseRequest = null;
        return request;
    }

    setSpeed(speed, position, anchorFrame) {
        if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(position) || !Number.isFinite(anchorFrame)) return false;
        this.position = position;
        this.anchorFrame = anchorFrame;
        this.speed = speed;
        for (const state of this.instances.values()) state.retime = true;
        return true;
    }

    register(key, instanceId, token = 0, channel = 0) {
        const previous = this.instances.get(key);
        if (previous?.instanceId === instanceId) {
            if (previous.token !== token || previous.channel !== channel) {
                previous.token = token; previous.channel = channel; previous.generation = -1; previous.forceReset = true;
                previous.failed = false;
            }
            return previous;
        }
        const state = { instanceId, token, channel, generation: -1, cursor: 0, restoring: true,
            enabled: false, ended: false, target: 0, forceReset: true, clockFrame: 0, clockOrigin: null,
            pool: Array.from({ length: MIDI_EVENT_CAPACITY }, () => ({ offsetFrames: 0,
                status: 0, data1: 0, data2: 0, noteId: 0, flags: 0, renderFrame: 0 })), batchCount: 0 };
        this.instances.set(key, state);
        this.stagedInstances.set(key, { state, draft: { ...state }, pending: false });
        return state;
    }

    // Delivery precedes rendering, but the public cursor describes completed audio.
    stageInstance(binding, key, frame, frames, delay = 0, enabled = true, ready = true) {
        const stage = this.stagedInstances.get(key);
        if (!stage || stage.state !== this.instances.get(key)) return false;
        Object.assign(stage.draft, stage.state);
        this.instances.set(key, stage.draft);
        try {
            const prepared = this.processInstance(binding, key, frame, frames, delay, enabled, ready);
            stage.generation = this.generation;
            stage.pending = true;
            return prepared;
        } finally {
            this.instances.set(key, stage.state);
        }
    }

    commitInstances(binding) {
        try {
            for (const [key, stage] of this.stagedInstances) {
                if (!stage.pending || stage.generation !== this.generation || this.instances.get(key) !== stage.state) continue;
                const state = stage.draft;
                if (state.enabled && !state.restoring && !state.liveJoin && !state.failed &&
                    binding.instanceMidiClock) {
                    const receipt = binding.instanceMidiClock(state.instanceId);
                    if (receipt.generation !== this.generation || receipt.frame !== state.clockFrame)
                        throw new Error('MIDI audio processing did not commit its scheduled frames');
                }
            }
            for (const [key, stage] of this.stagedInstances)
                if (stage.pending && stage.generation === this.generation && this.instances.get(key) === stage.state)
                    Object.assign(stage.state, stage.draft);
        } finally {
            for (const stage of this.stagedInstances.values()) stage.pending = false;
        }
    }

    currentPosition(frame, delay = 0) {
        if (!this.playing || frame <= this.anchorFrame + delay) return this.position;
        return this.position + (frame - this.anchorFrame - delay) / this.sampleRate * this.speed;
    }

    send(binding, state, flags = 0) {
        if (binding.instanceSetMidiEvents(state.instanceId, state.pool, this.generation, flags, state.batchCount) !== 0) {
            throw new Error('MIDI event delivery failed');
        }
    }

    append(state, status, data1, data2, offsetFrames, noteId, flags = 0, renderFrame = 0) {
        if (state.batchCount >= MIDI_EVENT_CAPACITY) throw new Error('MIDI event capacity exceeded');
        const target = state.pool[state.batchCount++];
        target.offsetFrames = offsetFrames;
        target.status = status;
        target.data1 = data1;
        target.data2 = data2 ?? 0;
        target.noteId = flags === MIDI_SYSTEM_RESET || (status & 0xf0) === 0x90 && data2 > 0 ? noteId : 0;
        target.flags = flags;
        target.renderFrame = renderFrame;
    }

    restoreInstanceState(key, { cursor, clockFrame }) {
        const state = this.instances.get(key);
        if (!state || !Number.isInteger(cursor) || cursor < 0 || cursor > (this.timeline?.events.length ?? 0) ||
            !Number.isSafeInteger(clockFrame) || clockFrame < 0) return false;
        state.cursor = cursor;
        state.clockFrame = clockFrame;
        state.forceReset = false;
        state.enabled = true;
        state.liveJoin = false;
        state.restoring = false;
        return true;
    }

    clock(binding, state, frame, flags) {
        if (binding.instanceSetMidiTransport) {
            const history = flags === 2;
            if (binding.instanceSetMidiTransport(state.instanceId, history ? 0 : state.transportFrame ?? 0,
                history ? 0 : state.transportSeconds ?? 0, this.speed, this.timeline?.duration ?? 0,
                this.timeline && this.transportPoints?.length ? 3 : 0) !== 0) {
                throw new Error('MIDI musical transport update failed');
            }
        }
        if (!binding.instanceSetMidiClock) return;
        if (binding.instanceSetMidiClock(state.instanceId, frame, this.generation, flags) !== 0) {
            throw new Error('MIDI render clock update failed');
        }
    }

    pendingHistory(binding, state) {
        const flags = binding.instanceMidiState?.(state.instanceId) ?? 0;
        if (flags & 8) {
            const error = new Error('Instrument script execution failed');
            error.code = 'instrument-script-failed';
            throw error;
        }
        return (flags & 16) !== 0;
    }

    retireFailedInstance(key) {
        const state = this.instances.get(key);
        if (!state) return;
        state.failed = true;
        state.enabled = false;
        state.ownershipActive = false;
        state.restoring = false;
        state.draining = false;
        state.paused = true;
        state.batchCount = 0;
    }

    joinLiveInstance(key, reset = false) {
        const state = this.instances.get(key);
        if (!state) return;
        state.liveJoin = true;
        state.joinInitialized = false;
        state.joinReset = reset;
        state.generation = -1;
    }

    prepareLiveJoin(binding, state, frame, frames, delay, ready) {
        if (state.generation !== this.generation || !state.joinInitialized) {
            this.send(binding, state, !state.joinInitialized && (state.joinReset || state.forceReset) ? this.resetFlags : 64);
            state.generation = this.generation;
            state.enabled = true;
            state.forceReset = false;
            if (!state.joinInitialized) {
                state.cursor = 0;
                state.clockFrame = 0;
                state.clockOrigin = null;
                state.paused = false;
                state.ended = false;
                state.activation = 0;
                state.restoring = false;
                state.joinInitialized = true;
            }
            this.clock(binding, state, state.clockFrame, 0);
        }
        const pauseFrame = this.pauseRequest ? this.pauseRequest.frame + delay : Infinity;
        const targetFrame = pauseFrame < frame + frames ? pauseFrame : frame;
        const target = this.currentPosition(targetFrame, delay);
        const events = this.timeline?.events ?? [];
        let visited = 0;
        while (state.cursor < events.length && events[state.cursor].seconds < target && visited++ < MIDI_RESTORE_SLICE) {
            const event = events[state.cursor++], kind = event.status & 0xf0;
            // Availability is not seek history: hydrate channel transactions,
            // never old notes, controller-triggered samples or script callbacks.
            if (kind !== 0x80 && kind !== 0x90) this.append(state, event.status, event.data1, event.data2,
                0, event.systemReset || 0, event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : 0);
        }
        if (state.batchCount) this.send(binding, state, 512);
        state.batchCount = 0;
        if (state.cursor < events.length && events[state.cursor].seconds < target) return false;
        if (pauseFrame < frame + frames) {
            this.send(binding, state, 16);
            state.paused = true;
            state.liveJoin = false;
            return true;
        }
        if (!ready) return false;
        state.liveJoin = false;
        state.transportFrame = state.clockFrame;
        state.transportSeconds = target;
        state.activation = 32;
        return true;
    }

    processInstance(binding, key, frame, frames, delay = 0, enabled = true, ready = true) {
        if (this.input) return this.processInputInstance(binding, key, frame, frames, delay, enabled, ready);
        const state = this.instances.get(key);
        if (!state) return false;
        if (state.failed) return true;
        this.pendingHistory(binding, state);
        const timed = typeof binding.instanceSetMidiClock === 'function';
        state.batchCount = 0;
        if (state.liveJoin && !this.prepareLiveJoin(binding, state, frame, frames, delay, ready)) return false;
        if (state.generation !== this.generation || state.enabled !== enabled) {
            const mode = state.forceReset || state.enabled !== enabled ? 'reset' : this.mode;
            this.send(binding, state, mode === 'pause' ? 16 : mode === 'resume' ? 32 : mode === 'retime' ? 64 :
                mode === 'drain' ? 128 : this.resetFlags);
            state.generation = this.generation;
            state.enabled = enabled;
            state.forceReset = false;
            state.draining = mode === 'drain';
            if (mode === 'reset') {
                state.paused = false;
                state.cursor = 0;
                state.restoring = true;
                state.ended = false;
                state.historyAwait = false;
                state.historyTargetRequested = false;
                state.clockOrigin = null;
                state.clockFrame = Math.round(this.position * this.sampleRate / this.speed);
                state.transportFrame = 0;
                state.transportSeconds = 0;
            } else {
                state.restoring = false;
                state.needsReattack = false;
                state.activation = mode === 'resume' ? 32 : 0;
                if (mode === 'resume') state.paused = false;
                state.clockOrigin = mode === 'resume' ? null : state.clockOrigin;
                if (mode === 'resume') {
                    state.transportFrame = state.clockFrame;
                    state.transportSeconds = this.position;
                }
            }
            state.target = this.currentPosition(frame, delay);
        }
        if (state.retime) {
            this.send(binding, state, 64);
            state.transportFrame = state.clockOrigin === null ? state.clockFrame : Math.max(state.clockFrame, frame + state.clockOrigin);
            state.transportSeconds = this.currentPosition(frame, delay);
            state.retime = false;
        }
        binding.instanceSetMidiGain(state.instanceId, this.gain);
        if (!this.timeline || !enabled) { this.clock(binding, state, state.clockFrame, 0); return true; }
        if (state.paused) { this.clock(binding, state, state.clockFrame, 0); return true; }
        if (!this.playing && !this.preparing) {
            if (state.draining && state.clockOrigin !== null) {
                const base = Math.max(state.clockFrame, frame + state.clockOrigin);
                this.clock(binding, state, base, 1);
                state.clockFrame = base + frames;
            } else this.clock(binding, state, state.clockFrame, 0);
            return true;
        }
        const events = this.timeline.events;
        if (state.restoring) {
            if (state.historyAwait && this.pendingHistory(binding, state)) return false;
            state.historyAwait = false;
            state.target = this.currentPosition(frame, delay);
            const seekFrame = Math.round(state.target * this.sampleRate / this.speed);
            let visited = 0;
            while (state.cursor < events.length && events[state.cursor].seconds < state.target &&
                visited++ < MIDI_RESTORE_SLICE) {
                const event = events[state.cursor++];
                this.append(state, event.status, event.data1, event.data2, 0, event.systemReset || state.cursor,
                    event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : 0, (event.systemReset || event.drumMode) ? 0 : Math.round(event.seconds * this.sampleRate / this.speed));
            }
            if (state.batchCount) {
                this.send(binding, state, 2);
                this.clock(binding, state, state.pool[state.batchCount - 1].renderFrame, 2);
                state.historyAwait = true;
            }
            state.batchCount = 0;
            if (state.historyAwait && this.pendingHistory(binding, state)) return false;
            if (state.cursor < events.length && events[state.cursor].seconds < state.target) return false;
            if (!state.historyTargetRequested) {
                this.clock(binding, state, seekFrame, 2);
                state.historyTargetRequested = true;
                state.historyAwait = true;
            }
            if (this.pendingHistory(binding, state)) return false;
            state.restoring = false;
            state.needsReattack = state.cursor > 0;
            state.activation = timed ? 4 : state.needsReattack ? 4 : 0;
            state.clockFrame = seekFrame;
            state.transportFrame = seekFrame;
            state.transportSeconds = state.target;
        }
        if (!this.playing) { this.clock(binding, state, state.clockFrame, 0); return true; }
        if (state.activation) {
            const start = this.anchorFrame + delay;
            this.clock(binding, state, state.clockFrame, 0);
            if (start >= frame + frames) return true;
            const activationFrame = start > frame ? start : frame;
            if (this.position < this.timeline.duration) {
                // Reserved internal marker: restore held voices exactly at this instance's origin.
                this.append(state, 0, 0, 0, activationFrame - frame, 0, state.activation, state.clockFrame);
            } else if (timed) this.append(state, 0, 0, 0, activationFrame - frame, 0, 128, state.clockFrame);
            state.clockOrigin = state.clockFrame - activationFrame;
            state.activation = 0;
            state.needsReattack = false;
        } else {
            if (state.clockOrigin === null) state.clockOrigin = state.clockFrame - Math.max(frame, this.anchorFrame + delay);
            const base = Math.max(state.clockFrame, frame + state.clockOrigin);
            this.clock(binding, state, base, 1);
        }
        const pauseFrame = this.pauseRequest ? this.pauseRequest.frame + delay : Infinity;
        const blockEnd = Math.min(frame + frames, pauseFrame);
        while (state.cursor < events.length) {
            const event = events[state.cursor];
            const eventFrame = this.anchorFrame + Math.round((event.seconds - this.position) *
                this.sampleRate / this.speed) + delay;
            if (eventFrame >= blockEnd) break;
            state.cursor++;
            this.append(state, event.status, event.data1, event.data2, eventFrame > frame ? eventFrame - frame : 0,
                event.systemReset || state.cursor, event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : 0,
                (event.systemReset || event.drumMode) ? 0 : Math.max(state.clockFrame, eventFrame + state.clockOrigin));
        }
        const endFrame = this.anchorFrame + Math.round((this.timeline.duration - this.position) *
            this.sampleRate / this.speed) + delay;
        if (!state.ended && endFrame < blockEnd) {
            const offset = endFrame > frame ? endFrame - frame : 0;
            if (timed) this.append(state, 0, 0, 0, offset, 0, 128,
                Math.max(state.clockFrame, endFrame + state.clockOrigin));
            else for (let channel = 0; channel < 16; channel++) {
                this.append(state, 0xb0 | channel, 64, 0, offset, 0);
                this.append(state, 0xb0 | channel, 66, 0, offset, 0);
                this.append(state, 0xb0 | channel, 123, 0, offset, 0);
            }
            state.ended = true;
        }
        if (pauseFrame < frame + frames) {
            const frozenClock = Math.max(state.clockFrame, pauseFrame + state.clockOrigin);
            this.append(state, 0, 0, 0, Math.max(0, pauseFrame - frame), 0, 16, frozenClock);
            state.paused = true;
        }
        if (state.batchCount) this.send(binding, state);
        if (state.clockOrigin !== null) state.clockFrame = Math.max(state.clockFrame, blockEnd + state.clockOrigin);
        return true;
    }
}
