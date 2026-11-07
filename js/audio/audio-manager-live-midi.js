import { MidiInputState } from '../midi/smf-timeline.js';
import { musicPlayerOwnsMidi } from '../midi/live-input.js';
import { audibleContextTime } from './visual-sync.js';

const INPUT_CAPACITY = 4096;
const INPUT_TIMEOUT_MS = 5000;
const JITTER_SECONDS = 0.01;

export const audioManagerLiveMidiMethods = {
    nextMidiGeneration(previous = 0) {
        this._midiGeneration = Math.max(this._midiGeneration ?? 0,
            Number.isSafeInteger(previous) && previous >= 0 ? previous : 0) + 1;
        return this._midiGeneration;
    },

    setLiveMidiInputSource(sourceKey) {
        sourceKey = typeof sourceKey === 'string' && sourceKey ? sourceKey : null;
        if (musicPlayerOwnsMidi(this.powerPolicyController)) sourceKey = null;
        if ((this._liveMidi?.sourceKey ?? null) === sourceKey) return;
        this._cancelLiveMidiInput();
        const generation = this.nextMidiGeneration();
        this._liveMidi = { sourceKey, generation, state: new MidiInputState(), queue: [],
            before: new Map(), nodes: new Map(), hydrationRequests: new Map(), notice: false, flushing: false };
        this._syncLiveMidiInputTargets();
    },

    getLiveMidiInputSource() {
        return this._liveMidi?.sourceKey ?? null;
    },

    _restartLiveMidiInput(live) {
        if (this._liveMidi !== live || !live.sourceKey) return;
        const sourceKey = live.sourceKey;
        this.setLiveMidiInputSource(null);
        this.setLiveMidiInputSource(sourceKey);
    },

    _liveMidiTargets() {
        const targets = [];
        if (this.masterBypass) return targets;
        for (const node of this._getActiveDspWorklets?.() ?? []) {
            let enabled = true;
            for (const plugin of this._wasmAssetMembershipByNode?.get(node)?.values() ?? []) {
                if (plugin.constructor.name === 'SectionPlugin') { enabled = plugin.enabled !== false; continue; }
                if (plugin.constructor.name !== 'SoundFontPlayerPlugin' || !enabled || plugin.enabled === false) continue;
                const snapshot = this.getEffectiveActiveWasmAssetSnapshot?.(plugin, [0], { primaryWorklet: node });
                // Internal replay can temporarily remove READY without changing
                // the user's asset operation or its already accepted events.
                const token = this._wasmAssetExpectedRevisionsByNode?.get(node)?.get(`${plugin.id}:0`);
                targets.push({ node, plugin, id: plugin.id, token, ready: snapshot?.ready === true &&
                    Number.isSafeInteger(token) && plugin._runtimeAssetErrorRevision !== token });
            }
        }
        return targets;
    },

    _syncLiveMidiInputTargets() {
        const live = this._liveMidi;
        if (!live || live.sourceKey && musicPlayerOwnsMidi(this.powerPolicyController)) return;
        const worklets = [...(this._getActiveDspWorklets?.() ?? [])];
        // A replacement graph is not authoritative until its membership is
        // registered. Asset/state callbacks may arrive during this interval.
        if (!worklets.length || worklets.some(node => !this._wasmAssetMembershipByNode?.has(node))) return;
        for (const node of worklets) {
            if (!live.nodes.has(node)) {
                live.nodes.set(node, new Map());
                node.port.postMessage({ type: 'midiInputConfigure', generation: live.generation,
                    enabled: !!live.sourceKey, anchorFrame: Math.round((this.audioContext?.currentTime ?? 0) * (this.audioContext?.sampleRate ?? 48000)) });
            }
        }
        const targets = this._liveMidiTargets();
        for (const event of live.queue) event.targets = event.targets.filter(arrival =>
            targets.some(target => target.plugin === arrival.plugin &&
                // Staged membership can precede asset replay. Only a registered
                // revision can invalidate an arrival for the same instrument.
                (target.token === undefined || target.token === arrival.token)));
        for (const [plugin, before] of live.before) if (!live.queue.some(event =>
            event.targets.some(target => target.plugin === plugin && target.token === before.token))) live.before.delete(plugin);
        for (const { node, plugin, id, token, ready } of targets) {
            const request = live.hydrationRequests.get(node)?.get(id);
            const requested = request?.token === token;
            if (!ready || !requested && live.nodes.get(node)?.get(id) === token) continue;
            const inflight = live.inflightBefore?.get(plugin), queued = live.before.get(plugin);
            node.port.postMessage({ type: 'midiInputState', generation: live.generation, pluginId: id, token,
                activation: requested ? request.activation : undefined,
                events: (inflight?.token === token ? inflight.events : null) ??
                    (queued?.token === token ? queued.events : null) ?? live.state.hydration() });
            live.nodes.get(node)?.set(id, token);
            if (requested) live.hydrationRequests.get(node).delete(id);
        }
        for (const node of live.nodes.keys()) if (!this._isActiveDspWorklet?.(node)) {
            live.nodes.delete(node);
            live.hydrationRequests.delete(node);
        }
    },

    enqueueLiveMidiInput({ data, timeStamp, sourceKey, systemReset = 0, drumMode = null }) {
        const live = this._liveMidi;
        if (!live?.sourceKey || sourceKey !== live.sourceKey || musicPlayerOwnsMidi(this.powerPolicyController) ||
            !data || (drumMode ? systemReset || data[0] !== 0 || !Number.isInteger(drumMode.channel) || drumMode.channel < 0 ||
                drumMode.channel > 15 || !Number.isInteger(drumMode.mode) || drumMode.mode < 0 || drumMode.mode > 3 ||
                data[1] !== drumMode.channel || data[2] !== drumMode.mode : systemReset ? ![1, 2, 3].includes(systemReset) || data[0] !== 0 : data[0] < 0x80 || data[0] >= 0xf0)) return false;
        const kind = data[0] & 0xf0, length = kind === 0xc0 || kind === 0xd0 ? 2 : 3;
        if (data.length !== length || [...data].slice(1).some(value => value < 0 || value > 127)) return false;
        const targets = this._liveMidiTargets().filter(target => target.ready);
        let before;
        for (const { plugin, token } of targets) if (live.before.get(plugin)?.token !== token) {
            before ??= live.state.hydration();
            live.before.set(plugin, { token, events: before });
        }
        const event = { status: data[0], data1: data[1], data2: data[2] ?? 0,
            ...(systemReset && { systemReset }), ...(drumMode && { drumMode }),
            seconds: this.audioContext?.currentTime ?? 0,
            timeStamp: Number.isFinite(timeStamp) ? timeStamp : performance.now(),
            targets: targets.map(({ plugin, token }) => ({ plugin, token })) };
        live.state.apply(event);
        if (!targets.length) {
            if (!live.notice) {
                live.notice = true;
                globalThis.window?.uiManager?.showTransientMessage?.('sfzPlayer.status.addPlayer', false, {}, 7000);
            }
        }
        if (live.queue.length >= INPUT_CAPACITY) {
            console.error('Live MIDI input exceeded the bounded event queue');
            this._restartLiveMidiInput(live);
            return false;
        }
        live.queue.push(event);
        void this._flushLiveMidiInput();
        return true;
    },

    async _flushLiveMidiInput() {
        const live = this._liveMidi;
        if (!live?.sourceKey || live.flushing || !live.queue.length) return;
        live.flushing = true;
        const release = this.powerPolicyController?.started
            ? this.powerPolicyController.acquireLease('midi-input-event', { mode: 'force-active' }) : null;
        let events = null, delivery = null;
        try {
            if (release) await this.powerPolicyController.requestReconcile('midi-input-event');
            if (this.audioContext?.state !== 'running') await this.contextManager?.resumeAudioContext?.();
            if (this._liveMidi !== live || !live.sourceKey || musicPlayerOwnsMidi(this.powerPolicyController)) return;
            // Arrival-time targets survive a context wake. A newly loaded font
            // never acquires events which arrived while it was unavailable.
            const pendingPlugins = new Map(live.queue.flatMap(event => event.targets.map(target => [target.plugin, target.token])));
            for (const { node, plugin } of this._liveMidiTargets()) if (pendingPlugins.has(plugin))
                await this.waitForEffectiveActiveWasmAssets?.(plugin, [0], { primaryWorklet: node, timeoutMs: INPUT_TIMEOUT_MS });
            if (this._liveMidi !== live || !live.sourceKey || musicPlayerOwnsMidi(this.powerPolicyController)) return;
            this._syncLiveMidiInputTargets();
            events = live.queue.splice(0);
            const targets = this._liveMidiTargets().filter(target => target.ready);
            // Hydration of a target with undelivered events uses the state
            // before the oldest batch still in flight.
            live.inflightBefore ??= new Map();
            for (const [plugin, before] of live.before) if (!live.inflightBefore.has(plugin)) live.inflightBefore.set(plugin, before);
            live.before = new Map();
            const frames = this._liveMidiFrames(live, events);
            const promises = [];
            for (const node of live.nodes.keys()) {
                const members = targets.filter(target => target.node === node);
                const batch = events.map((event, index) => ({ status: event.status, data1: event.data1, data2: event.data2,
                    ...(event.systemReset && { systemReset: event.systemReset }), ...(event.drumMode && { drumMode: event.drumMode }),
                    frame: frames[index],
                    targets: members.filter(target => event.targets.some(arrival => arrival.plugin === target.plugin && arrival.token === target.token))
                        .map(({ id, token }) => ({ id, token })) })).filter(event => event.targets.length);
                if (!batch.length) continue;
                this._liveMidiRequest = (this._liveMidiRequest ?? 0) + 1;
                const requestId = this._liveMidiRequest;
                this._liveMidiAcks ??= new Map();
                promises.push(new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => { this._liveMidiAcks.delete(requestId); reject(new Error('Live MIDI delivery timed out')); }, INPUT_TIMEOUT_MS);
                    this._liveMidiAcks.set(requestId, { node, generation: live.generation,
                        finish: accepted => { clearTimeout(timeout); accepted ? resolve() : reject(new Error('Live MIDI delivery was not accepted')); } });
                }));
                node.port.postMessage({ type: 'midiInputEvents', generation: live.generation, requestId, events: batch });
            }
            live.inflight = (live.inflight ?? 0) + 1;
            delivery = Promise.all(promises);
        } catch (error) {
            console.error('Live MIDI input could not be delivered:', error);
            if (events) this._restartLiveMidiInput(live);
        } finally {
            live.flushing = false;
            if (!delivery) release?.();
            // The worklet acknowledges a batch only after rendering it. Later
            // input is posted without waiting, so its arrival spacing survives.
            if (this._liveMidi === live && live.queue.length) void this._flushLiveMidiInput();
        }
        if (!delivery) return;
        try {
            await delivery;
        } catch (error) {
            console.error('Live MIDI input could not be delivered:', error);
            this._restartLiveMidiInput(live);
        } finally {
            if (--live.inflight === 0) live.inflightBefore = null;
            release?.();
        }
    },

    // Places each event at its Web MIDI arrival time plus a constant latency
    // on the render timeline, so burst rendering and message delays do not
    // re-anchor later events. The latency covers the largest observed distance
    // from the audible clock to the render head plus the largest observed
    // dispatch delay up to JITTER_SECONDS. A longer delay (a context wake)
    // shifts only its own batch, keeping that batch's internal spacing.
    _liveMidiFrames(live, events) {
        const context = this.audioContext, rate = context?.sampleRate ?? 48000;
        const now = performance.now(), currentTime = context?.currentTime ?? 0;
        const heard = context ? audibleContextTime({ outputTimestamp: context.getOutputTimestamp?.(), currentTime,
            outputLatency: context.outputLatency, baseLatency: context.baseLatency, performanceTime: now }) / 1000 : currentTime;
        if (live.clock?.context !== context) live.clock = { context, lead: 0, slack: 0 };
        const clock = live.clock, gap = currentTime - heard;
        if (gap > clock.lead) clock.lead = gap;
        const at = event => Math.round((heard + clock.lead + (event.timeStamp - now) / 1000) * rate) + 128;
        const late = Math.round(currentTime * rate) + 128 - at(events[0]);
        if (late > clock.slack && late <= JITTER_SECONDS * rate) clock.slack = late;
        const shift = late > clock.slack ? late : clock.slack;
        return events.map(event => at(event) + shift);
    },

    _handleLiveMidiInputMessage(node, data) {
        if (data.type === 'midiInputStateRequested') {
            const live = this._liveMidi;
            if (data.generation === live?.generation && this._isActiveDspWorklet?.(node)) {
                if (!live.hydrationRequests.has(node)) live.hydrationRequests.set(node, new Map());
                live.hydrationRequests.get(node).set(data.pluginId, data);
                this._syncLiveMidiInputTargets();
            }
            return true;
        }
        if (data.type === 'midiInputAccepted') {
            const request = this._liveMidiAcks?.get(data.requestId);
            if (request?.node === node && request.generation === data.generation) {
                this._liveMidiAcks.delete(data.requestId);
                request.finish(data.accepted === true);
            }
            return true;
        }
        if (data.type === 'assetState' || data.type === 'sfzRuntimeIdentity')
            queueMicrotask(() => this._syncLiveMidiInputTargets());
        return false;
    },

    getLiveMidiPresentation() {
        const live = this._liveMidi;
        if (!live?.sourceKey || musicPlayerOwnsMidi(this.powerPolicyController)) return null;
        const position = this.audioContext?.currentTime ?? 0;
        live.state.prune(position);
        return { hasMidi: true, live: live.state, position, generation: live.generation,
            playing: true, paused: false, speed: 1, preparing: false };
    },

    _cancelLiveMidiInput() {
        if (this._liveMidi) {
            this._liveMidi.queue.length = 0;
            this._liveMidi.sourceKey = null;
        }
        for (const request of this._liveMidiAcks?.values() ?? []) request.finish(false);
        this._liveMidiAcks?.clear();
    }
};
