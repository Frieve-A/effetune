import { MidiFrameScheduler, validateMidiSchedule } from '../midi/smf-scheduler.js';
import { sfzAssetTailSeconds } from '../sfz/asset.js';

export const MIDI_MAX_TAIL_SECONDS = 120;

export function snapshotMidiPipeline(pipeline, sampleRate) {
    return pipeline.map(plugin => {
        const snapshot = Object.assign(Object.create(Object.getPrototypeOf(plugin)), plugin);
        const parameters = structuredClone(plugin.getParameters?.({ sampleRate }) ?? {});
        snapshot.getParameters = () => parameters;
        snapshot._wasmAssets = new Map(plugin.getWasmAssets?.() ?? []);
        if (plugin.constructor.name === 'SoundFontPlayerPlugin') {
            snapshot._pending = null;
            snapshot.resolveOfflineDspAssetRequirement = async () => ({ required: !!snapshot.sf });
        }
        return snapshot;
    });
}

export function prepareOfflineMidiSession(session, timeline, pipeline, sampleRate) {
    validateMidiSchedule(timeline, sampleRate);
    const instruments = [...(session?.entries.values() ?? [])]
        .filter(entry => entry.typeName === 'SoundFontPlayerPlugin' && !entry.disabled && entry.offlineAssetsReady);
    if (!instruments.length) {
        const error = new Error('Add SFZ Player and choose an instrument from SFZ Library before rendering this MIDI file.');
        error.userMessageKey = 'sfzPlayer.error.offlineInstrument';
        throw error;
    }
    const scheduler = new MidiFrameScheduler(sampleRate);
    scheduler.configure({ timeline, position: 0, anchorFrame: 0, speed: 1, gain: 1,
        generation: 1, playing: false, preparing: true });
    session.binding.prepareMidiTransport?.(scheduler.transportPoints);
    const delays = new Map();
    const busDelays = new Map([[0, 0]]);
    const dataEntry = Array.from({ length: 16 }, () => null);
    for (const event of timeline.events) {
        if ((event.status & 0xf0) !== 0xb0 || (event.data1 !== 6 && event.data1 !== 38)) continue;
        const channel = dataEntry[event.status & 15] ??= { coarse: 0, fine: 0 };
        const field = event.data1 === 6 ? 'coarse' : 'fine';
        channel[field] = Math.max(channel[field], event.data2);
    }
    let tailSeconds = 0, bounded = true;
    for (const plugin of pipeline) {
        if (!plugin.enabled || plugin.constructor.name === 'SectionPlugin') continue;
        const entry = session.entries.get(plugin);
        const params = entry?.offlineState?.parameters ?? plugin.getParameters({ sampleRate });
        const inputBus = params.inputBus ?? plugin.inputBus ?? 0;
        const outputBus = params.outputBus ?? plugin.outputBus ?? 0;
        const inputDelay = busDelays.get(inputBus) ?? 0;
        const latency = entry ? session.binding.instanceLatency(entry.instanceId) : 0;
        busDelays.set(outputBus, Math.max(busDelays.get(outputBus) ?? 0, inputDelay + latency));
        if (entry?.typeName === 'SoundFontPlayerPlugin') {
            scheduler.register(plugin.id, entry.instanceId);
            session.binding.instanceSetSeed?.(entry.instanceId, 0x4d494449, 1);
            delays.set(plugin.id, inputDelay);
            const assets = entry.offlineState?.assets ?? plugin.getWasmAssets?.();
            const selected = params.mc ? [dataEntry[params.mc - 1]] : dataEntry;
            const range = selected.filter(Boolean).reduce((result, value) => ({
                coarse: Math.max(result?.coarse ?? 0, value.coarse),
                fine: Math.max(result?.fine ?? 0, value.fine)
            }), null);
            const asset = assets?.get(0);
            const tail = asset?.payload ? sfzAssetTailSeconds(asset.payload, range) : range ? null : asset?.tailSeconds;
            if (Number.isFinite(tail) && tail >= 0) tailSeconds += tail;
            else bounded = false;
        } else if (plugin.constructor.name === 'VolumePlugin') {
            // A stateless gain cannot retain future output.
        } else if (plugin.constructor.name === 'DelayPlugin' && params.fb === 0) {
            tailSeconds += (params.pd + params.ds) / 1000;
        } else if (typeof plugin.getOfflineTailSeconds === 'function') {
            const tail = plugin.getOfflineTailSeconds({ sampleRate, offlineState: entry?.offlineState });
            if (Number.isFinite(tail) && tail >= 0) tailSeconds += tail;
            else bounded = false;
        } else bounded = false;
    }
    tailSeconds += Math.max(0, ...busDelays.values()) / sampleRate + 1 / sampleRate;
    const tailLimitReached = !bounded || tailSeconds > MIDI_MAX_TAIL_SECONDS;
    return { scheduler, instruments, delays, tailLimitReached,
        tailSeconds: tailLimitReached ? MIDI_MAX_TAIL_SECONDS : tailSeconds };
}

export async function prepareOfflineMidiPlayback(midi, session, {
    processPending, configureGraph, isCancelled
}) {
    const binding = session.binding;
    const checkpoints = [];
    const preserveAcrossGraphReset = session.descriptorEligible && binding.hasOfflineGraph?.();
    let processed = 0;
    for (const entry of midi.instruments) {
        let ready = false;
        // History and script initialization are bounded native slices. Source time
        // stays at zero, so even an event at zero belongs to the first output block.
        for (let attempt = 0; attempt < 4096; attempt++) {
            if (isCancelled()) return false;
            ready = midi.scheduler.processInstance(binding, entry.plugin.id, 0, 128,
                midi.delays.get(entry.plugin.id) ?? 0);
            if (ready) break;
            processPending(entry);
            if (++processed % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (!ready) throw new Error('The instrument could not finish preparing for export.');
    }
    if (isCancelled()) return false;
    if (preserveAcrossGraphReset) {
        for (const entry of midi.instruments) {
            if (binding.instanceSetMidiEvents(entry.instanceId, [], midi.scheduler.generation, 16) !== 0) {
                throw new Error('The instrument could not be prepared for export.');
            }
            checkpoints.push([entry.instanceId, binding.instanceWriteMidiCheckpoint(entry.instanceId)]);
        }
    }
    // Configuring the graph resets its members; preserve only the prepared MIDI
    // state. No upstream/downstream audio, graph delay or output clock is advanced.
    configureGraph();
    for (const [instanceId, checkpoint] of checkpoints) {
        if (binding.instanceReadMidiCheckpoint(instanceId, checkpoint) !== 0) {
            throw new Error('The instrument could not be prepared for export.');
        }
    }
    // Checkpoint restoration can grow memory after graph preparation cached the arena.
    session.arena = binding.getArenaViews();
    if (isCancelled()) return false;
    if (checkpoints.length) {
        // A restored checkpoint is paused. Use the scheduler's normal resume
        // marker at the first output frame, retaining its already prepared cursor.
        midi.scheduler.configure({ generation: midi.scheduler.generation, position: 0,
            anchorFrame: 0, speed: 1, gain: 1, preparing: true, mode: 'resume' });
    }
    midi.scheduler.start(midi.scheduler.generation, 0);
    return true;
}

export function processOfflineMidiBlock(midi, session, offset, frames) {
    for (const entry of midi.instruments) {
        if (!midi.scheduler.processInstance(session.binding, entry.plugin.id, offset, frames,
            midi.delays.get(entry.plugin.id) ?? 0)) {
            throw new Error('The instrument was not ready to render this MIDI file.');
        }
    }
}
