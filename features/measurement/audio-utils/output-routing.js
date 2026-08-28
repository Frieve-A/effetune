const SUPPORTED_OUTPUT_CHANNEL_COUNTS = Object.freeze([2, 4, 6, 8]);
const SET_SINK_ID_TIMEOUT_MS = 3000;

class MeasurementOutputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MeasurementOutputError';
    }
}

function getRequiredOutputChannelCount(channel) {
    const token = String(channel);
    if (!['left', 'right', '0', '1', '2', '3', '4', '5', '6', '7', 'all', 'both'].includes(token)) {
        throw new MeasurementOutputError(`Unsupported measurement output channel: ${token}`);
    }
    let channelIndex;
    if (channel === 'left' || channel === '0') {
        channelIndex = 0;
    } else if (channel === 'right' || channel === '1') {
        channelIndex = 1;
    } else {
        channelIndex = Number.parseInt(channel, 10);
    }

    if (!Number.isInteger(channelIndex) || channelIndex < 0) {
        return 2;
    }
    if (channelIndex < 2) return 2;
    if (channelIndex < 4) return 4;
    if (channelIndex < 6) return 6;
    return 8;
}

function getMeasurementOutputChannelCount(channel, maxChannelCount = 2) {
    if (channel !== 'all' && channel !== 'both') {
        return getRequiredOutputChannelCount(channel);
    }

    const availableChannels = Number(maxChannelCount);
    for (let index = SUPPORTED_OUTPUT_CHANNEL_COUNTS.length - 1; index >= 0; index -= 1) {
        const channelCount = SUPPORTED_OUTPUT_CHANNEL_COUNTS[index];
        if (channelCount <= availableChannels) return channelCount;
    }
    return 2;
}

function validateOutputChannel(channel, outputChannels) {
    const requiredChannels = getRequiredOutputChannelCount(channel);
    if (requiredChannels <= outputChannels) return;

    const displayedChannel = Number.parseInt(channel, 10) + 1;
    throw new MeasurementOutputError(
        `Output Channel Ch ${displayedChannel} requires at least ${requiredChannels} output channels. ` +
        'Choose a compatible measurement output device or a lower output channel.'
    );
}

function configureDestinationChannels(destination, outputChannels) {
    const maxChannels = Number(destination?.maxChannelCount) || 2;
    if (maxChannels < outputChannels) {
        throw new MeasurementOutputError(
            `The selected output device supports ${maxChannels} channels, but measurement Output Channel ` +
            `requires ${outputChannels}. Select a compatible device or a lower output channel.`
        );
    }

    try {
        destination.channelCountMode = 'explicit';
        destination.channelInterpretation = 'discrete';
        destination.channelCount = outputChannels;
    } catch (error) {
        console.error('Could not configure measurement output channels:', error);
        throw new MeasurementOutputError(
            `The selected output device could not be configured for ${outputChannels} channels. ` +
            'Check the selected measurement device and output channel, then try again.'
        );
    }

    if (destination.channelCount !== outputChannels) {
        throw new MeasurementOutputError(
            `The selected output device did not accept the configured ${outputChannels}-channel layout. ` +
            'Check the selected measurement device and output channel, then try again.'
        );
    }
}

async function setSinkIdWithTimeout(target, sinkId, timeoutMs = SET_SINK_ID_TIMEOUT_MS) {
    let timeoutId;
    try {
        await Promise.race([
            target.setSinkId(sinkId),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error('Audio output device selection timed out.'));
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function createStereoElementRoute(
    audioContext,
    outputDeviceId,
    AudioConstructor,
    setSinkIdTimeoutMs
) {
    if (typeof AudioConstructor !== 'function' ||
        typeof audioContext.createMediaStreamDestination !== 'function') {
        throw new MeasurementOutputError(
            'This browser cannot use the selected audio output device for measurements. ' +
            'Use a current version of Chrome or Edge and try again.'
        );
    }

    const audioElement = new AudioConstructor();
    if (typeof audioElement.setSinkId !== 'function') {
        throw new MeasurementOutputError(
            'This browser cannot use the selected audio output device for measurements. ' +
            'Use a current version of Chrome or Edge and try again.'
        );
    }

    const mediaStreamDestination = audioContext.createMediaStreamDestination();
    try {
        mediaStreamDestination.channelCountMode = 'explicit';
        mediaStreamDestination.channelInterpretation = 'discrete';
        mediaStreamDestination.channelCount = 2;
        audioElement.srcObject = mediaStreamDestination.stream;
        await setSinkIdWithTimeout(audioElement, outputDeviceId, setSinkIdTimeoutMs);
        await audioElement.play();
    } catch (error) {
        console.error('Could not start the selected measurement output device:', error);
        try {
            audioElement.pause();
            audioElement.srcObject = null;
            mediaStreamDestination.disconnect();
        } catch (_) {
            // The original output error is more useful.
        }
        throw new MeasurementOutputError(
            'The selected audio output device could not be opened. ' +
            'Make sure it is connected and available, then try again.'
        );
    }

    return {
        mode: 'media-element',
        destination: mediaStreamDestination,
        outputChannels: 2,
        audioElement,
        mediaStreamDestination
    };
}

async function prepareMeasurementOutputRoute(
    audioContext,
    outputDeviceId,
    outputChannel,
    dependencies = {},
    explicitOutputChannels
) {
    if (!audioContext?.destination) {
        throw new MeasurementOutputError(
            'The measurement audio output is not available. Restart audio and try again.'
        );
    }

    const hasExplicitDevice = Boolean(outputDeviceId && outputDeviceId !== 'default');
    const sinkId = hasExplicitDevice ? outputDeviceId : '';
    const canSelectContextSink = typeof audioContext.setSinkId === 'function';
    const currentSinkId = typeof audioContext.sinkId === 'string' ? audioContext.sinkId : null;
    const tokenRequiredChannels = getRequiredOutputChannelCount(outputChannel);
    if (explicitOutputChannels !== undefined &&
        (!SUPPORTED_OUTPUT_CHANNEL_COUNTS.includes(explicitOutputChannels) ||
            explicitOutputChannels < tokenRequiredChannels)) {
        throw new MeasurementOutputError(
            `Invalid explicit measurement output width: ${explicitOutputChannels}`
        );
    }
    const requiredChannels = explicitOutputChannels ?? tokenRequiredChannels;

    if (hasExplicitDevice && !canSelectContextSink) {
        if (requiredChannels !== 2) {
            throw new MeasurementOutputError(
                'This browser cannot send multichannel measurement audio directly to the selected output device. ' +
                'Use a current version of Chrome or Edge and try again.'
            );
        }
        return createStereoElementRoute(
            audioContext,
            outputDeviceId,
            dependencies.AudioConstructor ?? globalThis.Audio,
            dependencies.setSinkIdTimeoutMs
        );
    }

    if (canSelectContextSink &&
        currentSinkId !== sinkId &&
        (hasExplicitDevice || Boolean(currentSinkId))) {
        try {
            await setSinkIdWithTimeout(
                audioContext,
                sinkId,
                dependencies.setSinkIdTimeoutMs
            );
        } catch (error) {
            console.error('Could not select the measurement output device:', error);
            throw new MeasurementOutputError(
                'The selected audio output device could not be opened. ' +
                'Make sure it is connected and available, then try again.'
            );
        }
    }

    // Measurement routing intentionally does not use EffeTune's playback channel
    // setting. A measurement may use a different device and channel layout, so its
    // layout is derived only from the selected measurement channel and device.
    const outputChannels = explicitOutputChannels ?? getMeasurementOutputChannelCount(
        outputChannel,
        audioContext.destination.maxChannelCount
    );
    validateOutputChannel(outputChannel, outputChannels);
    configureDestinationChannels(audioContext.destination, outputChannels);
    return {
        mode: 'direct',
        destination: audioContext.destination,
        outputChannels,
        audioElement: null,
        mediaStreamDestination: null
    };
}

function releaseMeasurementOutputRoute(route) {
    if (!route) return;

    if (route.audioElement) {
        try {
            route.audioElement.pause();
            route.audioElement.srcObject = null;
        } catch (error) {
            console.warn('Could not stop measurement audio element:', error);
        }
    }

    if (route.mediaStreamDestination) {
        try {
            route.mediaStreamDestination.disconnect();
        } catch (error) {
            console.warn('Could not disconnect measurement media stream output:', error);
        }
    }
}

export {
    SUPPORTED_OUTPUT_CHANNEL_COUNTS,
    MeasurementOutputError,
    getRequiredOutputChannelCount,
    getMeasurementOutputChannelCount,
    validateOutputChannel,
    configureDestinationChannels,
    prepareMeasurementOutputRoute,
    releaseMeasurementOutputRoute
};
