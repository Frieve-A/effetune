import { MidiInputState, midiEventIndex } from './smf-timeline.js';
import { recognizeMidiSystemReset } from './system-reset.js';

// Reports arrive about every 33 ms; this keeps the device queue ahead of them.
const LOOKAHEAD_MS = 100;
// GM/GS/XG synths drop messages for about 50-100 ms after a system reset.
const RESET_SETTLE_MS = 100;
const sendLists = new WeakMap();

// Channel voice messages and complete SysEx packets in file order. Status-0
// reset markers are the scheduler's typed copy of SysEx that is sent raw here.
function sendList(timeline) {
    let list = sendLists.get(timeline);
    if (!list) {
        list = (timeline.events ?? []).filter(event => event.status);
        if (timeline.sysex?.length) list = [...list, ...timeline.sysex]
            .sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
        sendLists.set(timeline, list);
    }
    return list;
}

function messageBytes({ status, data1, data2 = 0 }) {
    const kind = status & 0xf0;
    return kind === 0xc0 || kind === 0xd0 ? [status, data1] : [status, data1, data2];
}

/**
 * Mirrors realtime MIDI file playback to an external Web MIDI output.
 * The transport anchor maps file seconds to render context time; getClockOffset(now)
 * maps render context time to the performance.now() time it is heard.
 */
export class MidiFileOutput {
    constructor({ getOutput, getClockOffset, now = () => performance.now() }) {
        this.getOutput = getOutput;
        this.getClockOffset = getClockOffset;
        this.now = now;
        this.run = null;
        // Device queues are time-ordered, so this floor outlives runs: a new run's
        // chase and events must not overtake the previous run's queued release.
        this.lastTimestamp = -Infinity;
    }

    start(timeline, { position, anchorTime, speed, generation }) {
        this.stop();
        const list = sendList(timeline);
        this.run = { list, cursor: midiEventIndex(list, position), position, anchorTime, speed, generation,
            port: null, held: new Set() };
        this.pump(generation);
    }

    retime(contextTime, speed) {
        const run = this.run;
        if (!run) return;
        if (contextTime > run.anchorTime) run.position += (contextTime - run.anchorTime) * run.speed;
        run.anchorTime = contextTime;
        run.speed = speed;
    }

    pump(generation, flush = false) {
        const run = this.run;
        if (!run || run.generation !== generation) return;
        const port = this.getOutput();
        if (port !== run.port) this.switchPort(run, port);
        const now = this.now(), offset = this.getClockOffset(now), limit = flush ? Infinity : now + LOOKAHEAD_MS;
        while (run.cursor < run.list.length) {
            const event = run.list[run.cursor];
            const timestamp = offset + (run.anchorTime + (event.seconds - run.position) / run.speed) * 1000;
            if (timestamp >= limit) break;
            run.cursor++;
            if (run.port) this.send(run, event.data ?? messageBytes(event), timestamp);
        }
    }

    finish(generation) {
        if (this.run?.generation !== generation) return;
        this.pump(generation, true);
        this.stop();
    }

    stop() {
        const run = this.run;
        this.run = null;
        if (run?.port) this.silence(run);
    }

    switchPort(run, port) {
        if (run.port) this.silence(run);
        run.port = port;
        if (port) this.chase(run);
    }

    // Restore non-note state before the cursor: SysEx since the last reset, then
    // the same compact channel snapshot that live input hydration uses.
    chase(run) {
        const state = new MidiInputState();
        let resetData = null, sysex = [];
        for (let index = 0; index < run.cursor; index++) {
            const event = run.list[index];
            if (event.data) {
                const reset = recognizeMidiSystemReset(event.data);
                if (reset) {
                    resetData = event.data;
                    sysex = [];
                    state.apply({ systemReset: reset, seconds: event.seconds });
                } else sysex.push(event.data);
            } else if ((event.status & 0xe0) !== 0x80) state.apply(event);
        }
        let timestamp = this.now();
        if (resetData) {
            this.send(run, resetData, timestamp);
            // Synths ignore input for a while after a reset. send() may have moved the reset
            // later than now, so the state follows the time it was actually queued.
            timestamp = this.lastTimestamp + RESET_SETTLE_MS;
        }
        for (const data of sysex) this.send(run, data, timestamp);
        // Flag 1024 is the globalCurrent resend, which duplicates the channel snapshot.
        for (const event of state.hydration()) {
            if (event.status && event.flags !== 1024) this.send(run, messageBytes(event), timestamp);
        }
    }

    // Release everything after the messages already queued on the device.
    silence(run) {
        const timestamp = this.now();
        for (const note of run.held) this.send(run, [0x80 | note >> 7, note & 127, 0], timestamp);
        run.held.clear();
        for (let channel = 0; channel < 16; channel++) {
            this.send(run, [0xb0 | channel, 121, 0], timestamp);
            this.send(run, [0xb0 | channel, 64, 0], timestamp);
            this.send(run, [0xb0 | channel, 123, 0], timestamp);
        }
    }

    send(run, data, timestamp) {
        if (timestamp < this.lastTimestamp) timestamp = this.lastTimestamp;
        this.lastTimestamp = timestamp;
        const kind = data[0] & 0xf0, note = (data[0] & 15) << 7 | data[1];
        if (kind === 0x90 && data[2]) run.held.add(note);
        else if (kind === 0x80 || kind === 0x90) run.held.delete(note);
        try {
            run.port.send(data, timestamp);
        } catch (error) {
            console.warn('MIDI output message could not be sent:', error);
        }
    }
}
