const STARTUP_OPERATION_WAIT_MS = 1000;

function getDefaultWindow() {
    return typeof window !== 'undefined' ? window : {};
}

function audioContextOptions(preferences) {
    const options = {
        latencyHint: preferences?.latencyHint || 'interactive'
    };
    if (Number.isFinite(preferences?.sampleRate) && preferences.sampleRate > 0) {
        options.sampleRate = preferences.sampleRate;
    }
    if (preferences?.outputDeviceId && preferences.outputDeviceId !== 'default') {
        options.sinkId = preferences.outputDeviceId;
    }
    return options;
}

function createAudioContext(AudioContextClass, preferences, logger) {
    const options = audioContextOptions(preferences);
    try {
        return new AudioContextClass(options);
    } catch (error) {
        if (!Object.prototype.hasOwnProperty.call(options, 'sinkId')) throw error;
        delete options.sinkId;
        logger.info('The startup audio context is using the default output device.', error);
        return new AudioContextClass(options);
    }
}

function createSilentSource(audioContext) {
    const source = audioContext.createBufferSource();
    source.buffer = audioContext.createBuffer(2, 128, audioContext.sampleRate);
    source.loop = true;
    return source;
}

function createSilentRenderGraph(audioContext, destination) {
    const source = createSilentSource(audioContext);
    const createProcessor = audioContext.createScriptProcessor || audioContext.createJavaScriptNode;
    let processor = null;
    let silenceGain = null;

    if (typeof createProcessor === 'function') {
        processor = createProcessor.call(audioContext, 4096, 2, 2);
        processor.onaudioprocess = event => {
            const output = event.outputBuffer;
            for (let channel = 0; channel < output.numberOfChannels; channel++) {
                output.getChannelData(channel).fill(0);
            }
        };
        source.connect(processor);
        processor.connect(destination);
    } else {
        silenceGain = audioContext.createGain();
        silenceGain.gain.value = 0;
        source.connect(silenceGain);
        silenceGain.connect(destination);
    }

    source.start();
    return { source, processor, silenceGain };
}

function settleWithin(promise, timeoutMs, onRejected) {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).then(
            () => true,
            error => {
                onRejected?.(error);
                return false;
            }
        ),
        new Promise(resolve => {
            timer = setTimeout(() => resolve(false), timeoutMs);
        })
    ]).finally(() => {
        if (timer !== null) clearTimeout(timer);
    });
}

async function loadAudioPreferences(windowRef, logger) {
    try {
        const result = await windowRef.electronAPI?.loadAudioPreferences?.();
        return result?.success && result.preferences ? result.preferences : {};
    } catch (error) {
        logger.warn('Startup audio preferences could not be loaded; using defaults.', error);
        return {};
    }
}

function createLegacyOutputRoute(audioContext, deviceId, windowRef) {
    const AudioClass = windowRef.Audio;
    if (deviceId === 'default' ||
        typeof AudioClass !== 'function' ||
        typeof audioContext.createMediaStreamDestination !== 'function') {
        return null;
    }

    const destination = audioContext.createMediaStreamDestination();
    const audioElement = new AudioClass();
    if (typeof audioElement.setSinkId !== 'function') return null;
    audioElement.autoplay = true;
    audioElement.volume = 1;
    audioElement.muted = false;
    audioElement.srcObject = destination.stream;
    const setup = Promise.resolve()
        .then(() => audioElement.setSinkId(deviceId))
        .then(() => audioElement.play());
    return { destination, audioElement, setup };
}

export async function warmUpAudioOutput({
    windowRef = getDefaultWindow(),
    logger = console,
    operationWaitMs = STARTUP_OPERATION_WAIT_MS
} = {}) {
    const preferences = await loadAudioPreferences(windowRef, logger);
    const AudioContextClass = windowRef.AudioContext || windowRef.webkitAudioContext;
    if (typeof AudioContextClass !== 'function') {
        throw new Error('Web Audio is unavailable');
    }

    const audioContext = createAudioContext(AudioContextClass, preferences, logger);
    const deviceId = preferences.outputDeviceId || 'default';
    const canSelectContextSink = typeof audioContext.setSinkId === 'function';
    const legacyRoute = canSelectContextSink
        ? null
        : createLegacyOutputRoute(audioContext, deviceId, windowRef);
    const outputDestination = legacyRoute?.destination || audioContext.destination;
    const graph = createSilentRenderGraph(audioContext, outputDestination);

    const operations = [
        settleWithin(
            Promise.resolve().then(() => audioContext.resume()),
            operationWaitMs,
            error => logger.warn('Startup audio context could not be resumed:', error)
        )
    ];
    if (canSelectContextSink) {
        operations.push(settleWithin(
            Promise.resolve().then(() => audioContext.setSinkId(deviceId)),
            operationWaitMs,
            error => logger.warn('Startup audio output selection failed; using the available output.', error)
        ));
    } else if (legacyRoute) {
        operations.push(settleWithin(
            legacyRoute.setup,
            operationWaitMs,
            error => logger.warn('Startup audio output selection failed; using the default output.', error)
        ));
    }

    const warmup = {
        audioContext,
        outputDestination,
        audioElement: legacyRoute?.audioElement || null,
        ...graph
    };
    // Keep every node alive until Electron replaces this sacrificial renderer.
    windowRef.__EFFECTUNE_STARTUP_AUDIO_WARMUP__ = warmup;
    await Promise.all(operations);
    return warmup;
}

export { STARTUP_OPERATION_WAIT_MS };
