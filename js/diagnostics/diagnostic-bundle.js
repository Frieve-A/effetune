import { isAndroidHost } from '../android/bridge.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';
import { diagnosticTrackFormat } from '../ui/audio-player/state-manager.js';
import { diagnosticDictionary, diagnosticTrackNames, getDiagnosticLog, NATIVE_COUNTERS, redactEventFields } from './diagnostic-log.js';
import { addDiagnosticWord, redactDiagnosticText } from './diagnostic-redaction.js';
import { diagnosticSummary } from './diagnostic-summary.js';

const UNAVAILABLE = 'unavailable';
const NOT_APPLICABLE = 'notApplicable';
const DEVICE_LABELS = ['inputDeviceLabel', 'outputDeviceLabel', 'deviceLabel'];
const OBSERVATION_FIELDS = 'role workletGraphGeneration receivedAtEpochMs renderSequence inputActive outputActive';
const ROLLING_FIELDS = 'underruns staleMessages livePcmBytes queuedAudioBuffers scheduledSourceNodes prepared playing failed generation';

// These lists describe the diagnostic file, independently of the evolving source objects.
function pick(source, keys) {
    if (source == null) return undefined;
    const fields = {};
    for (const key of keys.split(' ')) {
        const value = source[key];
        if (value === null || ['number', 'boolean', 'string'].includes(typeof value)) fields[key] = value;
    }
    return fields;
}

function powerState(snapshot) {
    if (!snapshot) return UNAVAILABLE;
    const resources = snapshot.resourceStatus;
    const worklets = resources?.worklets;
    return {
        ...pick(snapshot, 'schemaVersion effectiveState desiredState topologyRevision resourceMutationInProgress processingDirective transportDemand dspProcessingDemand inputSignalForProcessing inputRetentionTarget reason suspendCause resumeKind inputMonitoring manualResumeRequired resourceHealth'),
        transition: pick(snapshot.transition, 'state generation'),
        transitionError: pick(snapshot.transitionError, 'code phase recoverable messageKey'),
        requiredResources: snapshot.requiredResources && {
            ...pick(snapshot.requiredResources, 'allowActiveWhenHealthyMissing'),
            blocking: snapshot.requiredResources.blocking?.filter(value => typeof value === 'string'),
            healthy: snapshot.requiredResources.healthy?.filter(value => typeof value === 'string')
        },
        resourceStatus: {
            context: pick(resources?.context, 'state observedAtEpochMs errorCode'),
            input: pick(resources?.input, 'state availability configured inputConfigRevision inputGeneration inputAvailabilityRevision observedAtEpochMs errorCode'),
            route: pick(resources?.route, 'state intent routeIntentRevision observedAtEpochMs errorCode'),
            outputBridge: pick(resources?.outputBridge, 'state observedAtEpochMs errorCode'),
            playerSource: pick(resources?.playerSource, 'state playerIntentGeneration observedAtEpochMs errorCode'),
            persistence: pick(resources?.persistence, 'state storage journalPhase observedAtEpochMs errorCode'),
            worklets: worklets && {
                ...pick(worklets, 'monitoringFastWakeEligible monitoringFastWakeBlockerReason'),
                temporalSkip: pick(worklets.temporalSkip, 'status blockerReason topologyRevision'),
                automaticMonitoringArm: pick(worklets.automaticMonitoringArm, 'state skipEpoch armAfterRenderSequence'),
                nodes: worklets.nodes?.map(node => ({
                    ...pick(node, 'role workletGraphGeneration topologyRevision state processingState firstRenderSeen renderSequence lastHeartbeatAt errorCode'),
                    statePreparation: {
                        ...pick(node.statePreparation, 'state origin workletGraphGeneration topologyRevision skipEpoch enabledPluginCount coveredPluginCount skippedFrameCount renderSequence errorCode'),
                        appliedPolicyCounts: pick(node.statePreparation?.appliedPolicyCounts, 'stateless resetOnResume agedBySkippedFrames mustProcess')
                    }
                }))
            }
        }
    };
}

function powerSection(manager, win) {
    const diagnostics = manager?.getPowerDiagnostics?.();
    return {
        snapshot: powerState(manager?.getPowerSnapshot?.()),
        settings: pick(manager?.powerPolicyController?.settings || win.appConfig?.powerSaving, 'mode silenceThresholdDb fullSuspendDelaySeconds'),
        diagnostics: diagnostics ? {
            ...pick(diagnostics, 'schemaVersion counterEpoch effectiveCommitSequence workletGraphGeneration capturedAtEpochMs'),
            counters: pick(diagnostics.counters, 'workletRenderBlocks detectorBlocks fullJsProcessBlocks fullWasmProcessBlocks telemetryReads telemetryPosts analyzerRafCallbacks pluginVisualRafCallbacks playerUiTicks playerPositionRafCallbacks inputReleaseTransactions inputTrackStops monitoringRuntimeFailures')
        } : UNAVAILABLE,
        observations: manager?.powerPolicyController?.getDiagnosticObservations?.().map(value => pick(value, OBSERVATION_FIELDS)) ?? UNAVAILABLE
    };
}

function pipelineSection(manager, plugins) {
    if (!plugins) return UNAVAILABLE;
    const bus = value => value === null || (Number.isInteger(value) && value >= 0 && value <= 4) ? value : 'unknown';
    const channels = /^(?:A|L|R|[1-9]|1[0-6]|34|56|78|910|1112|1314|1516)$/;
    const execution = manager.getDspExecutionStateSnapshot?.();
    return {
        plugins: plugins.map(plugin => ({
            type: plugin.constructor.name, enabled: plugin.enabled === true,
            inputBus: bus(plugin.inputBus), outputBus: bus(plugin.outputBus),
            channel: plugin.channel === null || (typeof plugin.channel === 'string' && channels.test(plugin.channel)) ? plugin.channel : 'unknown'
        })),
        parallel: manager.isParallelProcessing?.(),
        execution: execution ? {
            ...pick(execution, 'revision graphGeneration workletEpoch topologyRevision'),
            states: execution.states?.map(item => pick(item, 'pluginType state reason jsFallbackSampleChannels generation'))
        } : UNAVAILABLE
    };
}

function playerSection(player, state) {
    if (!state) return NOT_APPLICABLE;
    const context = player.contextManager;
    const mediaDuration = state.playbackMode === 'audioElement' ? player.audioElement?.duration : null;
    return {
        ...pick(state, 'isPlaying isPaused isStopped playbackMode isTransitioning transitionType isPlaybackPending currentTrackPosition currentTrackDuration bufferPreparationStatus playbackSpeed seamlessMode playbackGeneration playerMute playerVolume'),
        lastTransportCommand: state.lastTransportCommand?.type ?? null,
        committedMode: context?.currentPlaybackDecision?.committedMode,
        replayGainMode: player.replayGain?.mode,
        source: pick(context?.getDiagnosticSourceState?.(), 'playerMute playerVolume replayGainMode volumeGain hasPrivateGate privateGateGain directFile nativeGain'),
        rolling: pick(context?.rollingTransport?.getDiagnosticSnapshot?.(), ROLLING_FIELDS) ?? NOT_APPLICABLE,
        format: diagnosticTrackFormat(state.currentTrack, context?.currentPlaybackDecision,
            context?.rollingTransport?.metadata, Number.isFinite(mediaDuration) ? mediaDuration :
                (state.currentTrackDuration > 0 ? state.currentTrackDuration : null))
    };
}

function nativeSection(native) {
    if (!native) return NOT_APPLICABLE;
    return {
        ...pick(native, 'variant confirmedActivity captureRatio'),
        session: pick(native.session, 'sampleRate deviceRate captureRate width inputChannels outputChannels inputFailed periodFrames inputLatencyFrames outputLatencyFrames'),
        latency: pick(native.latency, 'outputLatencyFrames inputLatencyFrames outputConverterDelayFrames captureTargetFrames captureConverterDelayFrames feedFrames'),
        openSettings: pick(native.openSettings, 'sampleRate outputChannels latency'),
        lastNotification: pick(native.lastNotification, 'state epochMs'),
        lastFailure: pick(native.lastFailure, 'reason epochMs'),
        counters: pick(native.counters, NATIVE_COUNTERS.join(' '))
    };
}

function outputSection(manager) {
    const output = manager?.getDiagnosticOutput?.();
    if (!output) return UNAVAILABLE;
    return {
        ...pick(output, 'outputGain outputTarget'),
        outputGate: pick(output.outputGate, 'status role workletGraphGeneration topologyRevision observedAtEpochMs'),
        networkRequested: pick(output.networkRequested, 'active localEnabled requestId'),
        networkApplied: pick(typeof output.networkApplied === 'object' ? output.networkApplied : null, 'requestId localEnabled') ?? 'unconfirmed'
    };
}

function createDictionary(win, { state, plugins, presets, devices, labels, events, preferences }) {
    const words = new Map(diagnosticDictionary());
    const add = (type, word) => addDiagnosticWord(words, word, type, win.location?.href);
    for (const track of [state?.currentTrack, ...state?.playlist || [], ...state?.queueWindow?.rows || []]) {
        for (const name of diagnosticTrackNames(track?.track ?? track)) add('track', name);
    }
    for (const name of Object.keys(presets || {})) add('preset', name);
    add('preset', win.uiManager?.pipelineManager?.presetManager?.currentPresetName);
    for (const plugin of plugins || []) if (plugin.constructor.name === 'SectionPlugin' || plugin.name === 'Section') add('section', plugin.cm);
    for (const device of devices || []) {
        add('id', device.deviceId);
        add('id', device.groupId);
        add('device', device.label);
    }
    add('id', preferences.inputDeviceId);
    add('id', preferences.outputDeviceId);
    for (const event of events) for (const key of DEVICE_LABELS) add('device', event[key]);
    for (const label of labels) if (words.get(label) === '<device>') words.delete(label);
    return words;
}

function deviceLabel(label, selected, dictionary, origin, ids) {
    if (!label) return 'unnamed';
    if (!selected.has(label)) return '<device>';
    if (ids.some(id => typeof id === 'string' && id && ['Speaker ', 'Microphone '].some(prefix => label === prefix + id.slice(0, 5)))) return 'unnamed';
    return redactDiagnosticText(label, dictionary, origin);
}

function backgroundSection(status) {
    if (!status) return UNAVAILABLE;
    return {
        ...pick(status, 'rendererBackgroundingDisabled backgroundThrottling powerSavingOff appSuspensionBlocked'),
        rendererPowerThrottling: pick(status.rendererPowerThrottling, 'applied processingActive restoring restoreFailed')
    };
}

function browserVersions(userAgent) {
    // Four-part product versions look like IP addresses in the redacted user agent.
    const products = userAgent?.replace(/\([^)]*\)/g, ' ') ?? '';
    const versions = {};
    for (const match of products.matchAll(/(?:^|\s)(Chrome|Chromium|CriOS|Edg|EdgA|EdgiOS|Firefox|FxiOS|Safari|Version|OPR)\/(\d{1,6}(?:\.\d{1,6}){0,3})(?=\s|$)/g)) {
        versions[match[1]] = match[2];
    }
    return versions;
}

// The Android engine reports the devices it actually uses; preferences hold only the last request.
function androidAudio(preferences, snapshot, devices) {
    const label = (list, id) => id > 0 ? list?.find(device => device.id === id)?.label : undefined;
    const inputId = snapshot.inputDeviceId;
    return {
        selection: { ...preferences, latencyHint: snapshot.latencyHint ?? preferences.latencyHint,
            useInputWithPlayer: snapshot.useInputWithPlayer === true,
            inputDeviceId: inputId < 0 ? NO_AUDIO_INPUT_DEVICE_ID : inputId > 0 ? String(inputId) : 'default' },
        inputLabel: label(devices?.inputs, inputId),
        outputLabel: label(devices?.outputs, snapshot.actualOutputDeviceId),
        engine: pick(snapshot, 'sampleRate deviceSampleRate outputHardwareSampleRate channelCount outputBurstFrames outputBufferFrames outputXRuns outputRenderFailures sourceUnderruns inputUnderruns latencyHint')
    };
}

async function optional(read) {
    try { return await read(); } catch { return null; }
}

export async function collectDiagnosticFile(win = window, translate = (_, fallback) => fallback) {
    const now = new Date();
    const manager = win.audioManager;
    const player = win.uiManager?.audioPlayer;
    const contextManager = manager?.contextManager;
    const context = contextManager?.audioContext;
    const io = manager?.ioManager;
    const request = contextManager?.diagnosticRequest;
    const preferences = win.electronIntegration?.audioPreferences || win.audioPreferences || {};
    const android = isAndroidHost(win) || manager?.isAndroid;
    const api = win.electronAPI;
    const [main, background, hints, devices, presets, androidDevices, androidSnapshot] = await Promise.all([
        optional(() => api?.diagnostics?.collect()), optional(() => api?.getBackgroundProcessingStatus?.()),
        optional(() => !api && win.navigator?.userAgentData?.getHighEntropyValues(['platformVersion', 'architecture'])),
        optional(() => win.navigator?.mediaDevices?.enumerateDevices()),
        optional(() => win.uiManager?.pipelineManager?.presetManager?.getPresets?.()),
        optional(() => android && manager?.bridge?.request('audio.devices')),
        optional(() => android && manager?.bridge?.request('snapshot.get'))
    ]);
    const engineSnapshot = android && (androidSnapshot || manager?.snapshot);
    const androidState = engineSnapshot ? androidAudio(preferences, engineSnapshot, androidDevices) : null;
    const selection = androidState?.selection ?? preferences;
    const state = player?.stateManager?.getStateSnapshot?.();
    const plugins = manager?.getCurrentPipeline?.();
    const log = getDiagnosticLog();
    const noInput = selection.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID;
    const inputLabel = !noInput && (androidState ? androidState.inputLabel : preferences.inputDeviceLabel);
    const outputLabel = androidState ? androidState.outputLabel : request?.outputDeviceLabel ?? preferences.outputDeviceLabel;
    const labels = new Set([inputLabel, outputLabel].filter(Boolean));
    const ids = [preferences.inputDeviceId, preferences.outputDeviceId, contextManager?.diagnosticRequestedOutputId,
        ...(devices || []).map(device => device.deviceId)];
    const events = [...log.events, ...main?.events || []].sort((a, b) => a.epochMs - b.epochMs);
    // Android device ids are small integers, so only their labels may enter the redaction dictionary.
    const androidLabels = ['inputs', 'outputs'].flatMap(key => androidDevices?.[key] || []).map(({ label }) => ({ label }));
    const words = createDictionary(win, { state, plugins, presets, devices: [...devices || [], ...androidLabels], labels, events,
        preferences: android ? {} : preferences });
    const origin = win.location?.href;
    const text = value => redactDiagnosticText(value, words, origin);
    const label = value => deviceLabel(value, labels, words, origin, ids);
    const exit = main?.nativeHost?.lastExit;
    const deviceStatus = io?.getDiagnosticDeviceStatus?.(preferences);
    const error = io?.lastInputInitializationError;
    const native = api && !android ? manager?.getDiagnosticNativeState?.() : null;
    const versions = browserVersions(win.navigator?.userAgent);
    const playerState = playerSection(player, state);
    const bundle = {
        format: 'effetune-diagnostics', formatVersion: 1, savedAtEpochMs: now.getTime(),
        utcOffsetMinutes: -now.getTimezoneOffset(), rendererStartedAtEpochMs: log.startedAtEpochMs,
        mainStartedAtEpochMs: main?.startedAtEpochMs ?? (api ? UNAVAILABLE : NOT_APPLICABLE),
        appVersion: main?.environment?.appVersion ?? win.app?.appVersion ?? UNAVAILABLE,
        environment: api ? {
            ...pick(main?.environment, 'isPackaged platform systemVersion arch runningUnderARM64Translation electron chromium node'),
            mediaAccess: pick(main?.environment?.mediaAccess, 'microphone screen') ?? UNAVAILABLE,
            background: backgroundSection(background)
        } : { platform: android ? 'android' : 'web', userAgent: text(win.navigator?.userAgent),
            browserVersions: versions,
            ...pick(hints, 'architecture platformVersion') },
        audio: {
            requested: request ? { ...pick(request, 'sampleRate outputChannels outputSelection creationOutputSelection'), outputDeviceLabel: label(outputLabel) } : UNAVAILABLE,
            settings: { ...pick(selection, 'audioDriver latencyHint useWasmDsp useInputWithPlayer'),
                inputSelection: noInput ? 'none' : selection.inputDeviceId && selection.inputDeviceId !== 'default' ? 'explicit' : 'default',
                ...(!noInput && { inputDeviceLabel: label(inputLabel) }) },
            ...(androidState && { androidEngine: androidState.engine }),
            applied: context ? { ...pick(context, 'state sampleRate baseLatency outputLatency'),
                destination: pick(context.destination, 'channelCount maxChannelCount') } : UNAVAILABLE,
            route: { ...pick(contextManager, 'useMediaStreamOutput'), ...pick(io, 'audioContextSinkMode directOutputMode'),
                ...pick(deviceStatus, noInput ? 'outputMatch route' : 'inputMatch outputMatch route') },
            input: pick(io?.getInputSnapshot?.(), 'state inputAvailability inputGeneration inputRouteConnected trackState'),
            lastInputInitializationError: error ? { name: error.name, message: text(error.message)?.slice(0, 500) } : null,
            output: outputSection(manager)
        },
        power: android ? NOT_APPLICABLE : powerSection(manager, win),
        player: playerState,
        pipeline: pipelineSection(manager, plugins),
        nativeEngine: api && !android ? nativeSection(native) : NOT_APPLICABLE,
        mainProcess: main ? { nativeHost: {
            ...pick(main.nativeHost, 'droppedFeedPackets'),
            lastExit: exit ? { ...pick(exit, 'variant epochMs exitCode signal spawnError droppedFeedPackets'), stderr: text(exit.stderr) } : null
        } } : (api ? UNAVAILABLE : NOT_APPLICABLE),
        events: events.map(event => {
            // Each producer creates its diagnostic fields explicitly at the observation site.
            const result = redactEventFields(event, words, origin);
            for (const key of DEVICE_LABELS) if (key in result) result[key] = label(result[key]);
            return result;
        }),
        console: log.console.map(entry => ({ ...pick(entry, 'origin epochMs level count lastEpochMs'), args: entry.args.map(text) }))
    };
    const summary = diagnosticSummary({ win, environment: main?.environment, android, native, versions, preferences: selection,
        manager, context, outputLabel, inputLabel, trackRate: state?.currentTrack && playerState.format.sampleRate,
        androidEngine: androidState?.engine }, translate);
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return { name: `effetune-diagnostics-${timestamp}.txt`, text: JSON.stringify(bundle, null, 2), summary };
}
