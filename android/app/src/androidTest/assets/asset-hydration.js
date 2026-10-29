(async () => {
    const base = 'https://appassets.androidplatform.net/assets/web/';
    const { getAndroidBridge } = await import(base + 'js/android/bridge.js');
    const { getDefaultIrLibraryService } = await import(base + 'js/ir-library/service.js');
    const { getDefaultSfzLibraryService } = await import(base + 'js/sfz/service.js');
    const { AudioEncoder } = await import(base + 'js/audio/audio-encoder.js');
    const bridge = getAndroidBridge(), manager = window.audioManager;
    const irLibrary = await getDefaultIrLibraryService(), sfzLibrary = await getDefaultSfzLibraryService();
    const check = (value, message) => { if (!value) throw new Error(message); };
    const context = new OfflineAudioContext(2, 48000, 48000), encoder = new AudioEncoder();
    const wave = async (name, frequency, frames = 4800, decay = false) => {
        const buffer = context.createBuffer(2, frames, 48000);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < frames; i++) data[i] = 0.3 * Math.sin(2 * Math.PI * frequency * i / 48000) * (decay ? Math.exp(-i / 800) : 1);
        }
        return new File([(await encoder.encode(buffer, { format: 'wav', sampleRate: 48000, wavSampleFormat: 'float32' })).blob], name, { type: 'audio/wav' });
    };
    const wait = async predicate => {
        const end = performance.now() + 10000;
        while (performance.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
        throw new Error('Asset preparation did not finish');
    };
    const snapshot = () => bridge.request('snapshot.get');
    const render = async plugin => {
        const input = await wave('render.wav', 440, 24000);
        const pipeline = manager.pipeline;
        let output;
        manager.pipeline = [plugin];
        try {
            output = await manager.processAudioFile(input, null,
                { format: 'wav', sampleRate: 48000, wavSampleFormat: 'float32' });
        } finally { manager.pipeline = pipeline; }
        const decoded = await context.decodeAudioData(await output.blob.arrayBuffer());
        let peak = 0, energy = 0, weighted = 0;
        const data = decoded.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            check(Number.isFinite(data[i]), 'Offline asset output is not finite');
            peak = Math.max(peak, Math.abs(data[i])); energy += data[i] * data[i];
            weighted += data[i] * Math.sin(i * 0.031);
        }
        check(peak > 0.00001 && energy > 0.00001, 'Offline asset output is silent');
        return { peak, energy, weighted };
    };
    window.__assets = {
        async previewTarget(region) {
            const plugin = manager.pipeline.find(item => item.constructor.name === 'SFZNotePlayerPlugin');
            check(plugin, 'SFZ preview plugin missing');
            const before = await snapshot();
            if (!window.__previewBefore) window.__previewBefore = before;
            if (!window.__previewUi) {
                window.__previewUi = plugin.createUI();
                document.body.appendChild(window.__previewUi);
                document.body.appendChild(plugin.canvas);
                Object.assign(plugin.canvas.style, { position: 'fixed', left: '8px', top: '80px',
                    width: '300px', height: '120px', zIndex: '2147483647' });
            }
            const canvas = plugin.canvas, rect = canvas.getBoundingClientRect();
            const { keys, edge, gutter } = plugin._graphLayout();
            const key = keys.find(item => item.midi === 69);
            const y = region === 'keyboard' ? edge + gutter * .9 : edge * (1 - 64 / 127);
            window.__previewPlugin = plugin;
            return { x: rect.left + (key.start + key.end) * .5 / canvas.width * rect.width,
                y: rect.top + y / canvas.height * rect.height, velocity: region === 'keyboard' ? 100 : 64 };
        },
        async previewFinished() {
            const state = await snapshot(), before = window.__previewBefore;
            check(window.__previewPlugin._previewMidi === -1, 'SFZ preview did not release');
            check(state.revision === before.revision && JSON.stringify(state.pipeline) === JSON.stringify(before.pipeline) &&
                JSON.stringify(state.assetRefs) === JSON.stringify(before.assetRefs), 'Preview changed canonical history/assets');
            check(!Object.hasOwn(window.__previewPlugin.getParameters(), 'pm'), 'Preview leaked into serialized state');
            window.__previewPlugin.canvas.remove(); window.__previewUi.remove();
            delete window.__previewUi; delete window.__previewBefore;
            return { done: true };
        },
        async editWhileHeld() {
            const plugin = window.__previewPlugin, before = await snapshot(), original = plugin.og;
            const gain = window.__previewUi.querySelector('input[type="range"][id$="-output-gain-slider"]');
            check(gain, 'Rendered Output Gain control is missing');
            gain.value = '-1'; gain.dispatchEvent(new Event('input', { bubbles: true }));
            await manager.pendingMutation;
            const edited = await snapshot(), record = edited.pipeline.find(item => item.id === plugin.id);
            check(record.parameters.og === -1 && !Object.hasOwn(record.parameters, 'pm') &&
                !Object.hasOwn(record.parameters, 'pv'), 'Held preview control state mismatch: ' + JSON.stringify({
                    parameters: record.parameters, localGain: plugin.og, worklet: Boolean(window.workletNode),
                    samePlugin: manager.pipeline.includes(plugin), beforeRevision: before.revision, afterRevision: edited.revision }));
            check(plugin._previewMidi === 69, 'Parameter edit released the held preview');
            gain.value = String(original); gain.dispatchEvent(new Event('input', { bubbles: true }));
            await manager.pendingMutation;
            const restored = await snapshot();
            check(JSON.stringify(restored.pipeline) === JSON.stringify(before.pipeline) &&
                JSON.stringify(restored.assetRefs) === JSON.stringify(before.assetRefs), 'Control restoration changed assets or parameters: ' +
                JSON.stringify({ before: before.pipeline, after: restored.pipeline, beforeRefs: before.assetRefs, afterRefs: restored.assetRefs }));
            window.__previewBefore = restored;
            const fixture = JSON.parse(localStorage.getItem('android-asset-fixture'));
            fixture.revision = restored.revision;
            localStorage.setItem('android-asset-fixture', JSON.stringify(fixture));
            return { done: true };
        },
        async seed() {
            const ir = window.pluginManager.createPlugin('IR Reverb');
            const sfz = window.pluginManager.createPlugin('SFZ Note Player');
            manager.pipeline = manager.pipelineA = [ir, sfz]; manager.currentPipeline = 'A';
            await manager.rebuildPipeline();
            ir.setParameters({ dw: 0, dl: -96, de: false, cm: 'mono', cr: 'full' });
            sfz.setParameters({ dm: 0, wm: 100, th: 0.2, mn: 69, mx: 69, vf: -96 });
            const irIds = [], sfzIds = [];
            for (const [index, frequency] of [400, 900].entries()) {
                const imported = await irLibrary.importFiles([await wave(`hydrate-ir-${index}.wav`, frequency, 4800, true)]);
                check(imported.imported.length === 1, 'IR fixture import failed');
                irIds.push(imported.imported[0].irId);
                const sample = await wave('sample.wav', frequency, 24000);
                const instrument = new File(['<region> sample=sample.wav lokey=0 hikey=127 pitch_keycenter=69 loop_mode=loop_sustain loop_start=0 loop_end=23999 ampeg_release=0.01'], `hydrate-${index}.sfz`);
                const bank = await sfzLibrary.importFolderFiles([instrument, sample], instrument.name,
                    { decode: (bytes, rate) => sfz._decodeAudioData(bytes, rate) });
                sfzIds.push(bank.id);
            }
            await ir.loadLibraryEntry(irLibrary.get(irIds[0]));
            sfz.setParameters({ sf: sfzIds[0] }); await sfz.resolveOfflineDspAssetRequirement();
            await manager.pendingMutation;
            const first = await snapshot();
            await ir.loadLibraryEntry(irLibrary.get(irIds[1]));
            sfz.setParameters({ sf: sfzIds[1] }); await sfz.resolveOfflineDspAssetRequirement();
            await manager.pendingMutation;
            await bridge.request('audio.start');
            const current = await snapshot();
            const fixture = { irIds, sfzIds, irPluginId: ir.id, sfzPluginId: sfz.id,
                firstRefs: first.assetRefs, refs: current.assetRefs, revision: current.revision };
            localStorage.setItem('android-asset-fixture', JSON.stringify(fixture));
            return fixture;
        },
        async verify() {
            const fixture = JSON.parse(localStorage.getItem('android-asset-fixture'));
            let ir = manager.pipeline.find(plugin => plugin.id === fixture.irPluginId);
            let sfz = manager.pipeline.find(plugin => plugin.id === fixture.sfzPluginId);
            const restored = await snapshot();
            check(restored.revision === fixture.revision && JSON.stringify(restored.assetRefs) === JSON.stringify(fixture.refs),
                'Hydration changed native history/assets: ' + JSON.stringify({ before: fixture, after: { revision: restored.revision, refs: restored.assetRefs, definitions: restored.assetDefinitions } }));
            check(ir.ir === fixture.irIds[1] && ir._pcm && ir._prepared, 'Recreated IR has no host PCM');
            check(sfz.sf === fixture.sfzIds[1] && sfz.getWasmAssets().size === 0, 'Recreated SFZ should keep native samples lazy');
            check(manager.isExternalAssetInUse('IR', fixture.irIds[0]) && manager.isExternalAssetInUse('SFZ', fixture.sfzIds[0]), 'Native history source is not protected');
            const currentIr = await render(ir), currentSfz = await render(sfz);
            const offline = await snapshot();
            check(offline.revision === restored.revision && JSON.stringify(offline.assetRefs) === JSON.stringify(restored.assetRefs), 'Offline hydration replaced a native asset');
            const beforeFrames = ir._prepared.frames;
            ir.setParameters({ dt: 50, tr: 50 });
            await wait(async () => (await snapshot()).assetRefs[`IRReverbPlugin:${ir.id}:0`]?.id !== fixture.refs[`IRReverbPlugin:${ir.id}:0`]?.id);
            await manager.pendingMutation;
            check(ir._prepared.frames < beforeFrames && ir.getWasmAssets().get(0).externalAssetParameters.dt === 50, 'Decay/Trim did not prepare a new host asset');
            const edited = await snapshot();
            check(edited.pipeline.find(record => record.id === ir.id).parameters.dt === 50, 'Native controls did not commit with the asset');
            for (let i = 0; i < 20; i++) {
                const state = await snapshot();
                if (state.assetRefs[`IRReverbPlugin:${ir.id}:0`]?.id === fixture.firstRefs[`IRReverbPlugin:${ir.id}:0`]?.id &&
                    state.assetRefs[`SFZNotePlayerPlugin:${sfz.id}:0`]?.id === fixture.firstRefs[`SFZNotePlayerPlugin:${sfz.id}:0`]?.id) break;
                check(state.canUndo, 'Original immutable assets are absent from history');
                await manager.nativePipelineCommand('undo');
            }
            ir = manager.pipeline.find(plugin => plugin.id === fixture.irPluginId);
            sfz = manager.pipeline.find(plugin => plugin.id === fixture.sfzPluginId);
            check(ir.ir === fixture.irIds[0] && sfz.sf === fixture.sfzIds[0] && ir.dt === 100, 'Undo did not restore original source/control definitions');
            const beforeOldRender = await snapshot();
            const oldIr = await render(ir), oldSfz = await render(sfz);
            const afterOldRender = await snapshot();
            check(afterOldRender.revision === beforeOldRender.revision, 'Rendering an old version mutated history');
            check(Math.abs(oldIr.energy - currentIr.energy) > 0.0001 && Math.abs(oldSfz.weighted - currentSfz.weighted) > 0.0001, 'Offline renderer did not use restored source samples');
            return { currentIr, currentSfz, oldIr, oldSfz, frames: ir._prepared.frames };
        },
        async cleanup() {
            const fixture = JSON.parse(localStorage.getItem('android-asset-fixture') || 'null');
            manager.pipeline = manager.pipelineA = []; await manager.rebuildPipeline();
            if (fixture) {
                for (const id of fixture.irIds) await irLibrary.delete(id);
                for (const id of fixture.sfzIds) await sfzLibrary.remove(id);
            }
            localStorage.removeItem('android-asset-fixture');
            await bridge.request('audio.stop');
            return { done: true };
        }
    };
    return { ready: true };
})()
