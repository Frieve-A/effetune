(async () => {
    const base = 'https://appassets.androidplatform.net/assets/web/';
    const { getAndroidBridge } = await import(base + 'js/android/bridge.js');
    const { prepareAndroidPipeline } = await import(base + 'js/android/pipeline.js');
    const { AndroidDocuments } = await import(base + 'js/android/documents.js');
    const bridge = getAndroidBridge();
    const request = bridge.request.bind(bridge);
    bridge.request = async (command, payload) => {
        try { return await request(command, payload); }
        catch (error) { window.__integrationLastError = { command, code: error.code, message: error.message }; throw error; }
    };
    const check = (value, message) => { if (!value) throw new Error(message); };
    window.__integration = {
        async pipeline() {
            const manager = window.audioManager, plugins = window.pluginManager;
            const volume = plugins.createPlugin('Volume', { audioHostActive: false }); volume.id = 9901;
            volume.setParameters({ vl: -9, enabled: false }); volume.inputBus = 2; volume.outputBus = 3; volume.channel = 'R';
            const payload = prepareAndroidPipeline([volume], { sampleRate: manager.getNativeSampleRate() }); payload.slot = 'A';
            manager.acceptSnapshot(await bridge.request('pipeline.set', payload)); await manager.restoreNativePipeline();
            const actual = manager.pipeline[0];
            check(actual.vl === -9 && actual.enabled === false && actual.inputBus === 2 && actual.outputBus === 3 && actual.channel === 'R', 'Hydration lost canonical parameters or routing');
            const routing = document.querySelector('[data-plugin-id="9901"] .bus-info')?.textContent;
            check(routing?.includes('Bus 2→Bus 3') && routing.includes('Right'), 'Rendered routing did not match the native pipeline');
            await manager.nativePipelineCommand('copySlot', { from: 'A', to: 'B' });
            check(manager.pipelineA[0] !== manager.pipelineB[0], 'A/B aliases one plugin');
            manager.pipelineA[0].setParameters({ vl: -12 });
            check(manager.pipelineB[0].vl === -9, 'A edit changed B');
            await manager.nativePipelineCommand('slot', { slot: 'A' });
            return { independent: true };
        },
        async queue() {
            const previous = (await bridge.request('snapshot.get')).playback;
            const docs = new AndroidDocuments(bridge);
            const record = await bridge.request('documents.createTemporary', { name: 'integration-queue.wav' });
            const { AudioEncoder } = await import(base + 'js/audio/audio-encoder.js');
            const context = new OfflineAudioContext(2, 48000, 48000), buffer = context.createBuffer(2, 48000, 48000);
            await docs.write(record.uri, (await new AudioEncoder().encode(buffer, { format: 'wav', sampleRate: 48000, wavSampleFormat: 'pcm16' })).blob);
            const player = await window.uiManager.createAudioPlayer([], false);
            await player.contextManager.replaceNativeQueue({ tracks: Array.from({ length: 8 }, (_, index) => ({ uri: record.uri, name: `Track ${index}` })), index: 7 });
            await player.contextManager.seek(0.2);
            await player.contextManager.command('volume', { volume: 0.42, muted: true });
            await player.contextManager.command('speed', { speed: 1.5, preservePitch: true });
            player.applyPreservePitch(false);
            await new Promise(resolve => setTimeout(resolve, 100));
            const before = await bridge.request('snapshot.get');
            await player.playbackManager.loadFiles([{ uri: record.uri, name: 'Inserted' }], true, 8);
            const after = await bridge.request('snapshot.get');
            check(after.playback.queueLength === 9 && after.playback.index === 7 && after.playback.generation === before.playback.generation, 'Queue insert restarted or lost native playhead');
            check(after.playback.preservePitch === false && after.playback.speed === 1.5, 'Pitch toggle did not reach native playback');
            return { length: after.playback.queueLength, uri: record.uri,
                settings: { volume: previous.volume, muted: previous.muted, speed: previous.speed, preservePitch: previous.preservePitch } };
        },
        async measurement() {
            const app = window.app, controller = app.measurementController;
            document.getElementById('newMeasurementBtn').click();
            const wait = async (predicate, timeout = 10000) => {
                const until = performance.now() + timeout;
                while (!predicate() && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
                check(predicate(), 'Measurement form stage did not complete: ' + JSON.stringify({ screen: app.uiManager.currentScreen, error: window.__integrationLastError, point: !!controller.currentPoint }));
            };
            await wait(() => document.getElementById('audioInput').options.length > 0 && app.uiManager.currentScreen === 'measurementConfigScreen');
            check(app.audioUtils.devices.outputs.length > 0, 'Output devices missing');
            document.getElementById('measurementName').value = 'Android integration fixture';
            document.getElementById('sweepLength').value = '16384';
            document.getElementById('averaging').value = '1';
            document.getElementById('configForm').requestSubmit();
            await wait(() => app.uiManager.currentScreen === 'levelAdjustmentScreen');
            let capturedFrames = 0;
            const process = controller.processRecordedBuffer;
            controller.processRecordedBuffer = function(recording, sweep, repetitions, rate, options) {
                capturedFrames = recording.length;
                // The emulator has no acoustic speaker-to-microphone path. Native capture
                // must complete before the deterministic loopback fixture enters analysis.
                const loopback = new Float32Array(recording.length);
                const gain = 10 ** (options.levelDb / 20), start = Math.round(rate * 0.5);
                for (let i = 0; i < sweep.length; i++) loopback[start + i] = sweep.channels[0][i] * gain;
                return process.call(this, loopback, sweep, repetitions, rate, options);
            };
            try {
                document.getElementById('startMeasurementBtn').click();
                await wait(() => controller.currentPoint && !controller.isRunningMeasurement, 30000);
                const id = controller.currentMeasurement.id;
                document.getElementById('saveAndFinishBtn').click();
                await wait(() => app.uiManager.currentScreen === 'resultsDisplayScreen' && app.dataStorage.getMeasurementById(id));
                const saved = app.dataStorage.getMeasurementById(id).points.length > 0;
                await app.dataStorage.deleteMeasurement(id);
                return { capturedFrames, saved };
            } finally { controller.processRecordedBuffer = process; controller.cleanup(); }
        }
    };
    return { ready: true };
})()
