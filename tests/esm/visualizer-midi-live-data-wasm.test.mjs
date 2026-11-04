import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import vm from 'node:vm';
import { TelemetryHub } from '../../js/audio/telemetry-hub.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { createItem } from '../../js/visualizer/visualizer-model.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';

const scripts = await Promise.all(['plugins/plugin-base.js', 'plugins/sfz-instrument.js',
    'plugins/others/soundfont_player.js'].map(file =>
    readFile(new URL(`../../${file}`, import.meta.url), 'utf8')));

test('MIDI Visualizer acquires the first enabled SoundFont mixer without opening plugin controls',
    { timeout: 30000 }, async () => {
        const fixture = await createSf2RuntimeFixture({ resident: true });
        const harness = await createNativeSamplerWorklet({ variant: 'baseline' });
        const document = createFakeDocument();
        const hub = new TelemetryHub({ port: harness.node.port });
        hub.setVisualSyncResolver(() => performance.now() + 5);
        const window = { audioManager: harness.manager, dspTelemetryHub: hub };
        const previous = { window: globalThis.window, document: globalThis.document,
            requestAnimationFrame: globalThis.requestAnimationFrame,
            cancelAnimationFrame: globalThis.cancelAnimationFrame };
        globalThis.window = window;
        globalThis.document = document;
        globalThis.requestAnimationFrame = () => 1;
        globalThis.cancelAnimationFrame = () => {};
        vm.runInNewContext(scripts.join('\n'), { window, document, console, performance, setTimeout,
            clearTimeout, __EFFECTUNE_WASM_ONLY__: true,
            MutationObserver: class { observe() {} disconnect() {} } });
        const first = new window.SoundFontPlayerPlugin();
        first.id = 7;
        first.sf = 'a'.repeat(24);
        first._wasmAssetOperationRevisions.set(0, 1);
        first.getWasmAssetRevisionDescriptor = () => fixture.descriptor;
        const second = new window.SoundFontPlayerPlugin();
        second.id = 8;
        second.sf = 'b'.repeat(24);
        const disabled = new window.SoundFontPlayerPlugin();
        disabled.id = 9;
        disabled.sf = 'c'.repeat(24);
        disabled.enabled = false;
        const receive = ({ data }) => {
            if (data.type === 'dspTelemetry') hub.handleMessage({ ...data, recycle: false }, harness.node.port);
        };
        harness.node.port.addEventListener('message', receive);
        harness.manager._wasmAssetMembershipByNode.get(harness.node).set(first.id, first);
        harness.manager.currentPipeline = 'A';
        harness.manager.pipelineA = [disabled, first, second];
        harness.manager.pipelineB = [second];
        harness.manager.telemetryHub = hub;
        harness.manager.powerPolicyController = { displayDspBypassed: true };
        harness.manager._scheduleVisualSyncUpdate = () => {};
        harness.manager.addEventListener = () => {};
        harness.manager.removeEventListener = () => {};
        const telemetryRates = [];
        const postMessage = harness.node.port.postMessage;
        harness.node.port.postMessage = data => {
            if (data.type === 'dspSetTelemetryRate') telemetryRates.push(data.hz);
            return postMessage(data);
        };
        let sources;
        try {
            fixture.descriptor.operationRevision = 1;
            await harness.initialize('SoundFontPlayerPlugin', fixture.descriptor);
            first.validatePreparedSfzBank({ format: 'sf2', presets: fixture.source.compiled.presets,
                descriptor: fixture.descriptor });
            await harness.waitFor(() => {
                const entry = harness.processor.wasmInstances.get(first.id);
                const ready = harness.binding.instanceStreamReadiness(entry.id);
                return ready && ready.generation === harness.binding.instanceMidiClock(entry.id).generation &&
                    ready.scope !== 0 && ready.pendingPages === 0 &&
                    harness.manager.getNativeMixerMetadata(first, harness.node).cacheReady;
            });
            const timeline = { duration: 30, division: 480,
                events: [{ seconds: .01, status: 144, data1: 60, data2: 127, order: 0, track: 0 },
                    { seconds: 29, status: 0, data1: 0, data2: 0, systemReset: 1, order: 1, track: 0 }],
                tempoMap: [{ tick: 0, seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 }],
                timeSignatures: [{ tick: 0, seconds: 0, quarter: 0, numerator: 4, denominator: 4 }] };
            const presentation = { hasMidi: true, timeline, position: 0, sourceGeneration: 1,
                generation: 1, playing: true, paused: false, speed: 1 };
            const item = createItem('midi', 'midi');
            let visible = false;
            document.body.classList = { contains: name => name === 'view-visualizer' && visible };
            sources = new VisualizerSources(harness.manager, () => presentation);
            const view = Object.assign(Object.create(VisualizerView.prototype), {
                layout: { aspect: '16:9', items: [item] }, sources,
                video: { setEnabled() {}, setActive() {} }, stage: { style: {} }, counters() {},
                uiManager: { audioManager: harness.manager, isDoubleBlindActive: () => false },
                frameRequest: null, feed: null, playbackControls: null
            });
            const play = async generation => {
                const volume = [100, 48, 110][generation - 1];
                presentation.timeline = { ...timeline, events: [
                    { seconds: 0, status: 176, data1: 7, data2: volume, order: 0, track: 0 },
                    { seconds: .01, status: 144, data1: 60, data2: 127, order: 1, track: 0 },
                    timeline.events[1]
                ] };
                presentation.generation = presentation.sourceGeneration = generation;
                await harness.send({ type: 'midiTransport', timeline: presentation.timeline, generation, position: 0,
                    playing: false, preparing: true, speed: 1, gain: 1, mode: 'reset' });
                await harness.waitFor(() => harness.messages.some(message =>
                    message.type === 'midiPrepared' && message.generation === generation));
                await harness.waitFor(() => {
                    const entry = harness.processor.wasmInstances.get(first.id);
                    const ready = harness.binding.instanceStreamReadiness(entry.id);
                    return ready && ready.generation === generation && ready.scope === 1 &&
                        ready.pendingPages === 0 && ready.readyAheadFrames > 0;
                });
                const previousFrame = first._mixerState;
                await harness.send({ type: 'midiStart', generation, anchorFrame: harness.frame + 128 });
                if (sources.active) {
                    let mixer;
                    await harness.waitFor(() => {
                        mixer = sources.getSoundFontMixer();
                        return first._mixerState !== previousFrame && mixer?.state?.voices > 0 &&
                            mixer.state.channels[0].levelPeak > 0 && mixer.state.channels[0].volume === volume;
                    });
                    assert.equal(sources.midiMixerTarget, first);
                    assert.ok(mixer.state.voices > 0 && mixer.state.channels[0].levelPeak > 0);
                    assert.equal(mixer.state.channels[0].volume, volume);
                    assert.ok(mixer.presets.some(preset => preset.name === fixture.source.compiled.presets[0].name));
                    assert.equal(sources.getFrame(item.id).sourceKind, 'midi');
                }
            };
            await play(1);
            assert.equal(first._midiMeteringDesired, false);
            assert.equal(harness.manager.getDspTelemetryRate(), 0);
            await harness.send({ type: 'configurePowerPolicy', enabled: true,
                workletGraphGeneration: 1, topologyRevision: 1, uiTelemetryEnabled: false,
                displayDspBypassed: true });
            assert.equal(harness.processor.powerPolicy.uiTelemetryEnabled, false);
            view.applyLayout(false);
            visible = true;
            view.updateVisibility();
            assert.equal(harness.manager.getDspTelemetryRate(), 60);
            assert.equal(telemetryRates.at(-1), 60);
            await harness.waitFor(() => sources.getSoundFontMixer()?.state?.channels?.[0]?.levelPeak > 0);
            assert.equal(sources.midiMixerTarget, first);
            assert.equal(disabled._midiMeteringDesired, false);
            assert.equal(second._midiMeteringDesired, false);
            await play(2);
            await play(3);
            harness.manager.currentPipeline = 'B';
            assert.equal(sources.getSoundFontMixer(), null, 'the other pipeline has no native mixer frame');
            assert.equal(sources.midiMixerTarget, second);
            assert.equal(first._midiMeteringDesired, false);
            assert.equal(second._midiMeteringDesired, true);
            harness.manager.currentPipeline = 'A';
            assert.ok(sources.getSoundFontMixer()?.state?.channels[0].levelPeak > 0);
            assert.equal(sources.midiMixerTarget, first);
            assert.equal(second._midiMeteringDesired, false);
            harness.manager.setSoundFontMidiMetering(second, true);
            visible = false;
            view.updateVisibility();
            assert.equal(first._midiMeteringDesired, false);
            assert.equal(harness.processor.soundFontMidiMeteringEntries.size, 0);
            assert.equal(harness.manager.getDspTelemetryRate(), 60,
                'Another SoundFont metering consumer keeps the host rate active');
            harness.manager.setSoundFontMidiMetering(second, false);
            assert.equal(harness.manager.getDspTelemetryRate(), 0);
            assert.equal(telemetryRates.at(-1), 0);
            const reads = harness.processor.powerPolicy.counters.telemetryReads;
            for (let index = 0; index < 8; index++) harness.render();
            assert.equal(harness.processor.powerPolicy.counters.telemetryReads, reads,
                'Hidden Visualizer no longer requests native telemetry');
            assert.equal(harness.errors.length, 0, harness.errors.join('; '));
        } finally {
            sources?.dispose();
            first.cleanup();
            second.cleanup();
            disabled.cleanup();
            hub.clearSubscriptions();
            harness.node.port.postMessage = postMessage;
            harness.node.port.removeEventListener('message', receive);
            await harness.close();
            await fixture.close();
            globalThis.window = previous.window;
            globalThis.document = previous.document;
            globalThis.requestAnimationFrame = previous.requestAnimationFrame;
            globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
        }
    });
