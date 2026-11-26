/**
 * Speaker distortion measurement screens: start screen, setup, level check and run,
 * the leave dialogs and the audio host shared with the Check again card.
 */
import dataStorage from '../dataStorage.js';
import audioUtils from '../audio-utils/index.js';
import measurementController from '../measurement-controller/index.js';
import { INDIVIDUAL_CHANNELS, channelDisplayLabel, channelIndexOf } from '../audio-utils/channel-selection.js';
import { resolveSweepBand } from '../measurement-model.js';
import { QUICK_AVERAGING, averagingText, formatDbfs, formatDuration } from '../speaker-distortion-figures.js';
import { formatSpan } from '../distortion-diagnosis.js';
import { bandLimitedSettings, levelCheckLowerDb, perChannelSeconds, runSpeakerDistortionMeasurement, saveSpeakerDistortionRecord,
    savedMessageKey, SpeakerDistortionStepError } from '../measurement-controller/speaker-distortion-measurement.js';
import * as speakerDistortion from '../../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { isAndroidHost } from '../../../js/android/bridge.js';
import { configureAndroidMeasurementOutput, validateAndroidMeasurementChannels }
    from '../../../js/android/measurement.js';
import { button, cancelCheckAgain, element, listText, lowerInputText, showToast, uiLanguage, uiText }
    from './speaker-distortion-panel.js';
import { getSpeakerResultOperation, isSpeakerResultBusy, saveSpeakerResult } from './speaker-distortion-refit.js';

export const MINIMUM_RATE_HZ = 44100;
// Distortion Averaging choices, shortest first.
const AVERAGING_OPTIONS = [QUICK_AVERAGING, 1, 2, 4, 8];
const SIGNAL_LEVELS = [-10, -14, -18];
const DEFAULT_CHOICES = { placement: 'inFront', averaging: 2, signalLevel: -10, noiseRetry: true };
// Rows of the frequency response configuration form borrowed by the setup screen, by slot, with
// their sibling help texts. Moving them keeps one shared setting and its listeners.
const BORROWED_CONTROLS = [
    ['speakerDistortionBand', [['sweepBandMode'], ['sweepBandCommonInputs'], ['sweepBandChannelInputs']]],
    ['speakerDistortionDevices', [['audioInput'], ['inputChannel'], ['audioOutput', true], ['outputChannelCount', true],
        ['sampleRate']]]
];

/** Run settings of a Distortion Averaging choice: Quick plays one take of each call at averaging 1. */
export const averagingSettings = choice => (choice === QUICK_AVERAGING
    ? { averaging: 1, fast: true } : { averaging: choice, fast: false });

const byId = id => document.getElementById(id);
const durationText = seconds => formatDuration(seconds,
    { minute: uiText('label:durationMinute'), minutes: uiText('label:durationMinutes') });
const dbfsText = value => `${String(value).replace('-', '−')} dBFS`;
const placementAdvice = (placement, setupStep) => uiText(placement === 'inFront' ? 'advice:hotInFront'
    : setupStep ? 'advice:hotListeningSetup' : 'advice:hotListeningRun');

let uiManager = null;
let levelCheck = null;
// The microphone acquisition and the latest level check of step 2.
let checkAudio = null;
let checkAbort = null;
let run = null;
let audioRelease = null;
const borrowedPlaceholders = [];

/** The stored setup choices; `channels` is null until the user changes the channel boxes. */
export function storedChoices() {
    const settings = dataStorage.loadUserSettings();
    return {
        channels: settings.speakerDistortionChannels ?? null,
        placement: settings.speakerDistortionPlacement ?? DEFAULT_CHOICES.placement,
        averaging: settings.speakerDistortionAveraging ?? DEFAULT_CHOICES.averaging,
        signalLevel: settings.speakerDistortionSignalLevel ?? DEFAULT_CHOICES.signalLevel,
        noiseRetry: settings.speakerDistortionNoiseRetry ?? DEFAULT_CHOICES.noiseRetry
    };
}

function storeChoice(key, value) {
    dataStorage.saveUserSettings({ ...dataStorage.loadUserSettings(), [key]: value });
}

const outputTokens = () => INDIVIDUAL_CHANNELS.slice(0, Number(byId('outputChannelCount').value) || 2);
const selectedRate = () => Number(byId('sampleRate').value);

function selectedChannels() {
    const stored = storedChoices().channels;
    const tokens = outputTokens();
    return stored ? tokens.filter(token => stored.includes(token)) : tokens;
}

/** Run settings of `channels` as planned on the setup screen, at the selected sample rate. */
function plannedSettingsList(choices, channels) {
    const userSettings = dataStorage.loadUserSettings();
    const sweepLength = Number(userSettings.sweepLength) || Number(byId('sweepLength').value);
    return buildSettingsList(choices, channels, selectedRate(), { ...userSettings, sweepLength });
}

/** Planned time of one channel, from the run settings of the first output channel. */
function channelSeconds(choices = storedChoices()) {
    return perChannelSeconds(plannedSettingsList(choices, outputTokens().slice(0, 1))[0]);
}

/** Shared audio host for the run and the Check again card (the panel's `host.audio`). */
export const speakerDistortionAudio = {
    async prepare(rateHz, { channels = [], signal } = {}) {
        await audioRelease;
        signal?.throwIfAborted();
        const android = isAndroidHost();
        const width = android ? outputTokens().length : null;
        if (android) validateAndroidMeasurementChannels(channels, width);
        if (!audioUtils.audioContext) await audioUtils.initialize(rateHz);
        else if (audioUtils.audioContext.sampleRate !== rateHz) await audioUtils.reinitialize(rateHz);
        signal?.throwIfAborted();
        await audioUtils.ensureAudioContextRunning();
        signal?.throwIfAborted();
        if (audioUtils.audioContext.sampleRate !== rateHz) {
            throw new Error(`The audio context runs at ${audioUtils.audioContext.sampleRate} Hz, not ${rateHz} Hz`);
        }
        const settings = dataStorage.loadUserSettings();
        const config = {
            acquisitionMethod: 'ess',
            audioInputId: settings.audioInputId,
            inputChannel: settings.inputChannel,
            audioOutputId: settings.audioOutputId,
            outputChannelCount: width ?? (Number(settings.outputChannelCount) || 2)
        };
        if (android) await configureAndroidMeasurementOutput(config);
        signal?.throwIfAborted();
        measurementController.measurementConfig = config;
        await audioUtils.startMicrophoneInput(settings.audioInputId, settings.inputChannel,
            { signal, outputDeviceId: config.audioOutputId, outputChannelCount: config.outputChannelCount });
        signal?.throwIfAborted();
    },
    async play(buffer, settings, signal, stopWhen) {
        const result = await measurementController.playAndRecordBuffer(buffer, INDIVIDUAL_CHANNELS[settings.index],
            undefined, { signal, stopWhen });
        return result.recording;
    },
    release() {
        audioRelease = measurementController.cleanup();
        return audioRelease;
    }
};

export const isSpeakerDistortionRunActive = () => run !== null;

/* ---------- Borrowed controls ---------- */

function moveBorrowedControls() {
    if (borrowedPlaceholders.length) return;
    for (const [slotId, controls] of BORROWED_CONTROLS) {
        const slot = byId(slotId);
        for (const [id, withHelp] of controls) {
            const row = byId(id).closest('.form-group, .sweep-band-inputs');
            for (const node of withHelp ? [row, row.nextElementSibling] : [row]) {
                const placeholder = document.createComment(id);
                node.before(placeholder);
                borrowedPlaceholders.push([placeholder, node]);
                slot.append(node);
            }
        }
    }
    // The per-channel Sweep Bandwidth editor lists every output channel while borrowed.
    window.app.syncSweepBandChannelChoices();
}

/** Puts the device and Sweep Bandwidth controls back into the frequency response configuration form. */
export function restoreBorrowedControls() {
    if (!borrowedPlaceholders.length) return;
    for (const [placeholder, node] of borrowedPlaceholders.splice(0)) placeholder.replaceWith(node);
    window.app.syncSweepBandChannelChoices();
}

/* ---------- Start screen ---------- */

let startReturnScreen = 'resultsDisplayScreen';
const SPEAKER_MEASUREMENT_SCREENS = new Set(['newMeasurementScreen', 'speakerDistortionSetupScreen',
    'speakerDistortionCheckScreen', 'speakerDistortionRunScreen']);

function rememberReturnScreen() {
    const screen = uiManager.currentScreen;
    if (screen && !SPEAKER_MEASUREMENT_SCREENS.has(screen)) startReturnScreen = screen;
}

export function showNewMeasurementScreen() {
    rememberReturnScreen();
    restoreBorrowedControls();
    const busy = isSpeakerResultBusy();
    byId('measureSpeakerDistortionBtn').disabled = busy;
    byId('speakerDistortionBusyMessage').hidden = !busy;
    byId('speakerDistortionChoiceMessage').textContent =
        uiText('message:speakerDistortionChoice', { time: durationText(channelSeconds()) });
    uiManager.showScreen('newMeasurementScreen');
}

/* ---------- Setup ---------- */

/** Opens step 1; `openedBySetupRequest` marks a window opened by the effect's setup request. */
export async function openSpeakerDistortionSetup({ openedBySetupRequest = false } = {}) {
    rememberReturnScreen();
    const sourceScreen = uiManager.currentScreen;
    if (openedBySetupRequest) uiManager.speakerDistortionOpenedBySetupRequest = true;
    try {
        await window.app.initializeAudio();
        await window.app.populateAudioDevices();
        window.app.selectSavedAudioDevices();
    } catch (error) {
        console.error('Could not open the speaker distortion setup due to audio initialization failure:', error);
        uiManager.showAudioInitError(error);
        return;
    }
    if (uiManager.currentScreen === sourceScreen) showSetupScreen();
}

function showSetupScreen() {
    levelCheck = null;
    moveBorrowedControls();
    const choices = storedChoices();
    byId('speakerDistortionAveraging').value = String(choices.averaging);
    byId('speakerDistortionSignalLevel').value = String(choices.signalLevel);
    document.querySelector(`input[name="speakerDistortionPlacement"][value="${choices.placement}"]`).checked = true;
    document.querySelector(`input[name="speakerDistortionNoiseRetry"][value="${choices.noiseRetry ? 'on' : 'off'}"]`)
        .checked = true;
    renderChannelBoxes();
    updateSetup();
    uiManager.showScreen('speakerDistortionSetupScreen');
}

function renderChannelBoxes() {
    const selected = selectedChannels();
    byId('speakerDistortionChannels').replaceChildren(...outputTokens().map(token => {
        const label = element('label');
        const box = element('input');
        box.type = 'checkbox';
        box.value = token;
        box.checked = selected.includes(token);
        label.append(box, element('span', '', channelDisplayLabel(token)));
        return label;
    }));
}

export function refreshSpeakerDistortionChannels() {
    if (uiManager?.currentScreen !== 'speakerDistortionSetupScreen') return;
    renderChannelBoxes();
    updateSetup();
}

function updateSetup() {
    const choices = storedChoices();
    const inFront = choices.placement === 'inFront';
    byId('speakerDistortionInFrontBox').hidden = !inFront;
    byId('speakerDistortionListeningBox').hidden = inFront;
    byId('speakerDistortionPerChannelTime').textContent =
        uiText('status:perChannelTime', { time: durationText(channelSeconds(choices)) });
    const unmeasurable = showBandMessage(choices);
    const lowRate = selectedRate() < MINIMUM_RATE_HZ;
    byId('speakerDistortionRateMessage').hidden = !lowRate;
    byId('speakerDistortionSetupNext').disabled = lowRate || unmeasurable || selectedChannels().length === 0;
}

/**
 * Tells which checked channels the Sweep Bandwidth setting leaves unmeasurable or, when none is,
 * limits; returns whether any checked channel is unmeasurable.
 */
function showBandMessage(choices) {
    const settingsList = plannedSettingsList(choices, selectedChannels());
    const unmeasurable = settingsList.filter(({ bandwidth }) => !speakerDistortion.isMeasurableBand(bandwidth));
    const [key, shown] = unmeasurable.length
        ? ['message:speakerDistortionBandUnmeasurable', unmeasurable]
        : ['message:speakerDistortionBandLimited', bandLimitedSettings(settingsList)];
    const box = byId('speakerDistortionBandMessage');
    box.hidden = shown.length === 0;
    box.textContent = shown.length === 0 ? '' : uiText(key, {
        bands: listText(shown.map(({ label, bandwidth }) => `${label}: ${formatSpan(...bandwidth)}`), uiLanguage())
    });
    return unmeasurable.length > 0;
}

function bindSetup() {
    const signalLevel = byId('speakerDistortionSignalLevel');
    signalLevel.replaceChildren(...SIGNAL_LEVELS.map(value => {
        const option = element('option', '', dbfsText(value));
        option.value = String(value);
        return option;
    }));
    const averaging = byId('speakerDistortionAveraging');
    averaging.replaceChildren(...AVERAGING_OPTIONS.map(value => {
        const option = element('option', '', averagingText(value));
        option.value = String(value);
        return option;
    }));
    byId('speakerDistortionChannels').addEventListener('change', () => {
        storeChoice('speakerDistortionChannels',
            [...byId('speakerDistortionChannels').querySelectorAll('input:checked')].map(box => box.value));
        updateSetup();
    });
    document.querySelectorAll('input[name="speakerDistortionPlacement"]').forEach(radio =>
        radio.addEventListener('change', () => { storeChoice('speakerDistortionPlacement', radio.value); updateSetup(); }));
    averaging.addEventListener('change', () => {
        storeChoice('speakerDistortionAveraging',
            averaging.value === QUICK_AVERAGING ? QUICK_AVERAGING : Number(averaging.value));
        updateSetup();
    });
    signalLevel.addEventListener('change', () => storeChoice('speakerDistortionSignalLevel', Number(signalLevel.value)));
    document.querySelectorAll('input[name="speakerDistortionNoiseRetry"]').forEach(radio =>
        radio.addEventListener('change', () => storeChoice('speakerDistortionNoiseRetry', radio.value === 'on')));
    byId('sampleRate').addEventListener('change', () => {
        if (uiManager.currentScreen === 'speakerDistortionSetupScreen') updateSetup();
    });
    // Bubbles after the form's own listeners have clamped and stored the Sweep Bandwidth values.
    byId('speakerDistortionBand').addEventListener('change', () => updateSetup());
    byId('speakerDistortionSetupBack').addEventListener('click', showNewMeasurementScreen);
    byId('speakerDistortionSetupNext').addEventListener('click', () => {
        window.app.saveUserSettings();
        restoreBorrowedControls();
        showCheckScreen();
    });
}

/* ---------- Level check ---------- */

function noticeItems(choices, channelCount) {
    const each = channelSeconds(choices);
    return [
        channelCount === 1
            ? uiText('message:noticeTimeOne', { total: durationText(each) })
            : uiText('message:noticeTime', { total: durationText(each * channelCount), n: channelCount,
                each: durationText(each) }),
        choices.signalLevel === -10
            ? uiText('message:noticeLoud')
            : uiText('message:noticeLoudPeak', { peak: formatDbfs(choices.signalLevel + 10) }),
        uiText('message:noticeLoudOdd'),
        uiText('message:noticePeople'),
        uiText('message:noticeCancelIfNoise'),
        uiText('message:noticeSilence'),
        uiText(choices.placement === 'inFront' ? 'message:noticeMicrophoneInFront' : 'message:noticeMicrophone'),
        uiText('message:noticeExpectation')
    ];
}

function targetText(placement, label) {
    return `${uiText('message:targetChannel', { ch: label })} ${uiText(placement === 'inFront'
        ? 'message:targetInFront' : 'message:targetListeningPosition')}`;
}

/** Shows step 2; `messageKey` is the cancel or failure message of the previous run. */
function showCheckScreen(messageKey = null) {
    levelCheck = null;
    const choices = storedChoices();
    const channels = selectedChannels();
    byId('speakerDistortionNotice').replaceChildren(
        ...noticeItems(choices, channels.length).map(text => element('li', '', text)));
    byId('speakerDistortionTarget').textContent = targetText(choices.placement, channelDisplayLabel(channels[0]));
    showCheckResult(messageKey ? { text: uiText(messageKey), warning: true } : null);
    byId('speakerDistortionLevelCheckBtn').disabled = false;
    showLevelMeter(false);
    uiManager.showScreen('speakerDistortionCheckScreen');
    openCheckAudio().catch(() => {});
}

/* The microphone opens with step 2 and its level meter runs until the screen is left. */

const onCheckScreen = () => uiManager?.currentScreen === 'speakerDistortionCheckScreen';

function showLevelMeter(shown) {
    const levelBar = byId('speakerDistortionLevelBar');
    byId('speakerDistortionLevelMeter').hidden = !shown;
    if (shown) {
        measurementController.startLevelMeter(levelBar);
    } else {
        measurementController.stopLevelMeter();
        levelBar.style.width = '0';
    }
}

/** Opens the microphone and starts the level meter of step 2 unless they are already open. */
function openCheckAudio() {
    if (checkAudio) return checkAudio.promise;
    const controller = new AbortController();
    const opened = { controller };
    checkAudio = opened;
    opened.promise = speakerDistortionAudio.prepare(selectedRate(), {
        channels: selectedChannels().map(channelIndexOf), signal: controller.signal
    }).then(() => {
        if (checkAudio === opened && onCheckScreen()) showLevelMeter(true);
    }).catch(error => {
        if (checkAudio === opened) {
            checkAudio = null;
            console.error('Could not open the microphone for the speaker distortion level check:', error);
            if (onCheckScreen()) showCheckResult({ warning: true, text: uiText(error.code === 'measurement-rate-unavailable'
                ? 'error:measurementRateUnavailable' : 'error:audioInitFailed') });
        }
        throw error;
    });
    return opened.promise;
}

function cancelLevelCheck() {
    checkAbort?.abort();
    checkAbort = null;
    checkAudio?.controller.abort();
    checkAudio = null;
}

/** Cancels a level check in progress, stops the level meter and releases the microphone of step 2. */
function closeCheckAudio() {
    cancelLevelCheck();
    showLevelMeter(false);
    return speakerDistortionAudio.release();
}

// A distortion of 1 % lies 40 dB below the test signal, so the noise has to stay at least that far below it.
const LEVEL_CHECK_MIN_SNR_DB = 40;
// Headroom kept when the low signal-to-noise warning tells how far the microphone gain can go up.
const LEVEL_CHECK_GAIN_MARGIN_DB = 6;

/** Result of a passed level check; a low signal-to-noise ratio warns but does not block the measurement. */
function passedCheckResult({ headroomDb, snrDb }) {
    const result = { text: uiText('message:levelCheckOk', { db: Math.round(headroomDb), snr: Math.round(snrDb) }) };
    if (snrDb >= LEVEL_CHECK_MIN_SNR_DB) return result;
    const gain = Math.floor(headroomDb - LEVEL_CHECK_GAIN_MARGIN_DB);
    return { ...result, warning: true, detail: gain >= 1
        ? uiText('warning:levelCheckSnrGain', { gain })
        : uiText('warning:levelCheckSnr') };
}

function showCheckResult(result) {
    const box = byId('speakerDistortionCheckResult');
    box.hidden = !result;
    box.classList.toggle('warning-message', Boolean(result?.warning));
    box.replaceChildren(...(result ? [element('p', '', result.text)] : []),
        ...(result?.detail ? [element('p', '', result.detail)] : []));
    // The next step is the level check until it passes, then Start Measurement.
    const passed = levelCheck?.judged.outcome === 'passed';
    // The note on how loud the measurement gets is not part of the result, so it stays outside a warning box.
    byId('speakerDistortionCheckLoudest').hidden = !passed;
    byId('speakerDistortionStart').disabled = !passed;
    const checkButton = byId('speakerDistortionLevelCheckBtn');
    checkButton.classList.toggle('primary-btn', !passed);
    checkButton.classList.toggle('secondary-btn', passed);
}

/** Builds the per-channel settings for the checked channels, in ascending index order. */
export function buildSettingsList(choices, channels, rateHz, userSettings = dataStorage.loadUserSettings()) {
    const config = { ...userSettings, acquisitionMethod: 'ess' };
    const sweepLength = Number(userSettings.sweepLength);
    return [...channels].sort((a, b) => channelIndexOf(a) - channelIndexOf(b)).map(token => {
        const band = resolveSweepBand(config, token, rateHz, sweepLength);
        return {
            index: channelIndexOf(token),
            label: channelDisplayLabel(token),
            rateHz,
            signalLevelDbfs: choices.signalLevel,
            bandwidth: [band.minFreq, band.maxFreq],
            sweepLength,
            ...averagingSettings(choices.averaging),
            upperLimitHz: speakerDistortion.UPPER_LIMIT_RANGE_HZ[1],
            inputDeviceId: userSettings.audioInputId ?? '',
            inputDeviceLabel: userSettings.audioInputLabel ?? ''
        };
    });
}

export async function runLevelCheck(deps = speakerDistortion) {
    const checkButton = byId('speakerDistortionLevelCheckBtn');
    checkButton.disabled = true;
    levelCheck = null;
    showCheckResult({ text: uiText('status:levelChecking') });
    const choices = storedChoices();
    const controller = new AbortController();
    checkAbort = controller;
    const { signal } = controller;
    const opened = await openCheckAudio().then(() => true, () => false);
    try {
        if (!opened) return;
        signal.throwIfAborted();
        const settingsList = buildSettingsList(choices, selectedChannels(), audioUtils.audioContext.sampleRate);
        const plan = await deps.buildCapturePlan(settingsList[0], { signal });
        const recording = await speakerDistortionAudio.play(plan.levelCheck, settingsList[0], signal);
        const judged = await deps.judgeLevelCheck(recording, plan);
        signal.throwIfAborted();
        console.info(`Speaker distortion: level check ${judged.outcome}, headroom ${judged.headroomDb} dB, `
            + `signal-to-noise ratio ${judged.snrDb} dB`);
        levelCheck = { settingsList, plan, judged };
        showCheckResult(judged.outcome === 'passed'
            ? passedCheckResult(judged)
            : judged.outcome === 'overloaded'
                ? { warning: true,
                    text: uiText('warning:levelCheckOverload', { advice: placementAdvice(choices.placement, true) }),
                    detail: lowerInputText(levelCheckLowerDb(recording, judged, settingsList[0].rateHz)) }
                : { warning: true, text: uiText('warning:levelCheckQuiet') });
    } catch (error) {
        if (signal.aborted) return;
        console.error('Speaker distortion level check failed:', error);
        showCheckResult({ warning: true, text: uiText('error:speakerDistortionPlaybackFailed') });
    } finally {
        if (checkAbort === controller) {
            checkAbort = null;
            if (onCheckScreen()) checkButton.disabled = false;
        }
    }
}

function bindCheck() {
    byId('speakerDistortionLevelCheckBtn').addEventListener('click', () => runLevelCheck());
    byId('speakerDistortionCheckBack').addEventListener('click', () => {
        closeCheckAudio();
        showSetupScreen();
    });
    byId('speakerDistortionStart').addEventListener('click', () => startRun());
}

/* ---------- Run ---------- */

function timeLeftText(seconds) {
    const minutes = Math.round(seconds / 60);
    if (seconds < 60) return uiText('status:lessThanMinute');
    return minutes === 1 ? uiText('status:timeLeftMinute') : uiText('status:timeLeftMinutes', { n: minutes });
}

function rowText(status) {
    return status.row === 'testSignalOf'
        ? uiText('status:testSignalOf', { i: status.capture, n: status.captureCount })
        : uiText(`status:${status.row}`);
}

const PAUSES = {
    moveMicrophone: { text: (label, placement) => targetText(placement, label),
        button: 'button:startMeasuringChannel' },
    levelOverload: { text: (label, placement) =>
        uiText('warning:channelLevelOverload', { ch: label, advice: placementAdvice(placement, false) }),
    button: 'button:checkChannelAgain', warning: true },
    levelQuiet: { text: label => uiText('warning:levelCheckQuiet', { ch: label }),
        button: 'button:checkChannelAgain', warning: true },
    captureOverload: { text: (label, placement) =>
        uiText('error:speakerDistortionOverload', { ch: label, advice: placementAdvice(placement, false) }),
    button: 'button:measureChannelAgain', warning: true }
};

function cancelButtonText(current) {
    return current.done.length
        ? uiText('button:cancelMeasurementDiscards', { channels: listText(current.done, uiLanguage()) })
        : uiText('button:cancelMeasurement');
}

/** A pause shows its own message and buttons in place of the running hint and Cancel. */
function setPaused(paused) {
    byId('speakerDistortionPause').hidden = !paused;
    byId('speakerDistortionRunCancel').hidden = paused;
    byId('speakerDistortionKeepQuiet').hidden = paused;
}

function showPause(current, kind, { settings, lowerDb = null }) {
    const pause = PAUSES[kind];
    const box = byId('speakerDistortionPause');
    box.classList.toggle('warning', Boolean(pause.warning));
    const lower = lowerDb === null ? [] : [element('p', '', lowerInputText(lowerDb))];
    return new Promise(resolve => {
        box.replaceChildren(element('p', '', pause.text(settings.label, current.placement)), ...lower,
            element('div', 'speaker-distortion-buttons'));
        box.lastChild.append(
            button(uiText(pause.button, { ch: settings.label }), () => {
                setPaused(false);
                resolve();
            }, 'primary-btn'),
            button(cancelButtonText(current), () => confirmCancelRun()));
        setPaused(true);
    });
}

/** Moves the active progress bar on by the time spent in its step, never past the step or backwards. */
function tickProgress(current) {
    const progress = current.progress;
    if (!progress) return;
    const elapsed = (performance.now() - progress.startedAt) / 1000;
    const value = progress.base + (elapsed < progress.stepSeconds ? elapsed : progress.stepSeconds) * progress.rate;
    if (value > progress.bar.value) progress.bar.value = value;
}

function onRunStatus(current, status) {
    const settings = current.settingsList[status.channelIndex];
    const row = byId('speakerDistortionRunRows').children[status.channelIndex];
    row.querySelector('.speaker-distortion-run-status').textContent = rowText(status);
    row.dataset.status = status.row;
    const bar = row.querySelector('progress');
    // A level check starts the channel over, as after an overload; a pause leaves the bar where it is.
    if (status.row === 'checkingLevel') bar.value = 0;
    if (status.row === 'done') bar.value = 1;
    const { done, total, stepSeconds } = status.progress ?? {};
    current.progress = status.progress
        ? { bar, base: done / total, rate: 1 / total, stepSeconds, startedAt: performance.now() } : null;
    tickProgress(current);
    if (status.row === 'done') current.done.push(settings.label);
    current.channelLabel = settings.label;
    byId('speakerDistortionRunLine').textContent = status.phase
        ? `${uiText(`message:${status.phase}`, { ch: settings.label, i: status.capture, n: status.captureCount })} `
            + timeLeftText(status.secondsLeft)
        : '';
}

// The level graph canvas of the sweep screen is borrowed while the run screen is shown.
function borrowLevelGraph() {
    const canvas = byId('levelGraph');
    const placeholder = document.createComment('levelGraph');
    canvas.before(placeholder);
    byId('speakerDistortionLevelGraph').append(canvas);
    return () => placeholder.replaceWith(canvas);
}

function renderRunRows(settingsList) {
    byId('speakerDistortionRunRows').replaceChildren(...settingsList.map(settings => {
        const row = element('li', 'speaker-distortion-run-row');
        const bar = element('progress', 'speaker-distortion-run-progress');
        bar.max = 1;
        bar.value = 0;
        bar.setAttribute('aria-label', settings.label);
        row.append(element('span', 'speaker-distortion-run-label', settings.label),
            element('span', 'speaker-distortion-run-status', uiText('status:waiting')), bar);
        return row;
    }));
}

/** Starts the run with the passed level check of step 2. */
export async function startRun({ deps = speakerDistortion } = {}) {
    if (run || levelCheck?.judged.outcome !== 'passed') return;
    const checked = levelCheck;
    const { placement, noiseRetry } = storedChoices();
    const current = { controller: new AbortController(), settingsList: checked.settingsList,
        placement, noiseRetry, done: [], progress: null, channelLabel: checked.settingsList[0].label, restartChannel: null };
    run = current;
    closeCheckAudio();
    current.completion = performRun(current, checked, deps);
    return current.completion;
}

async function performRun(current, { plan, judged }, deps) {
    const { settingsList, placement } = current;
    renderRunRows(settingsList);
    byId('speakerDistortionRunLine').textContent = '';
    setPaused(false);
    uiManager.showScreen('speakerDistortionRunScreen');
    const restoreLevelGraph = borrowLevelGraph();
    const { signal } = current.controller;
    const progressTimer = setInterval(tickProgress, 250, current);
    let record = null;
    let messageKey = null;
    try {
        await speakerDistortionAudio.prepare(settingsList[0].rateHz, { channels: settingsList.map(({ index }) => index), signal });
        record = await runSpeakerDistortionMeasurement({
            settingsList, placement, averaging: settingsList[0].averaging, first: { plan, judged },
            retryOnNoise: current.noiseRetry,
            play: (buffer, settings, stopWhen, playSignal) =>
                speakerDistortionAudio.play(buffer, settings, playSignal, stopWhen),
            pause: (kind, info) => showPause(current, kind, info),
            onStatus: status => onRunStatus(current, status),
            onRestartable: restart => showRestart(current, restart), signal, deps
        });
    } catch (error) {
        if (!signal.aborted) {
            console.error('Speaker distortion measurement failed:', error.cause ?? error);
            messageKey = error.code === 'measurement-rate-unavailable' ? 'error:measurementRateUnavailable'
                : error instanceof SpeakerDistortionStepError && error.kind === 'analysis'
                ? 'error:speakerDistortionAnalysisFailed' : 'error:speakerDistortionPlaybackFailed';
        }
    } finally {
        clearInterval(progressTimer);
        await speakerDistortionAudio.release();
        restoreLevelGraph();
    }
    run = null;
    // A cancel question still open when the run ends has nothing left to cancel.
    if (current.asking) byId('speakerDistortionDialog').style.display = 'none';
    if (current.leaving) return;
    if (record && !signal.aborted) uiManager.showSpeakerDistortionResult(record);
    else showCheckScreen(signal.aborted ? 'message:measurementCancelled' : messageKey);
}

/** Stops an active speaker distortion capture when the page is leaving. */
export function cancelSpeakerDistortionAudio() {
    cancelLevelCheck();
    if (run) {
        run.leaving = true;
        run.controller.abort();
    }
    cancelCheckAgain();
}

/**
 * Asks a question during the run, with Keep measuring as the default answer and `confirm` ({ key, params })
 * as the other; the measurement goes on while it is shown. Resolves true when confirmed and the run goes on.
 */
async function confirmDuringRun(current, titleKey, message, confirm) {
    current.asking = true;
    const answer = askDialog(titleKey, message, [
        { key: 'button:keepMeasuring', value: false, primary: true },
        { ...confirm, value: true }
    ]);
    byId('speakerDistortionDialogButtons').querySelector('.primary-btn').focus();
    const confirmed = await answer;
    current.asking = false;
    return confirmed && run === current;
}

/** Asks before cancelling the run. */
async function confirmCancelRun() {
    const current = run;
    if (!current) return;
    const message = current.done.length
        ? uiText('message:cancelMeasurementDiscards', { channels: listText(current.done, uiLanguage()) })
        : uiText('message:cancelMeasurement');
    if (await confirmDuringRun(current, 'title:stopMeasurement', message, { key: 'button:cancelMeasurement' })) {
        current.controller.abort();
    }
}

/** Shows the button that measures the current channel again while the run offers `restart`, or hides it. */
function showRestart(current, restart) {
    current.restartChannel = restart;
    const restartButton = byId('speakerDistortionRunRestart');
    restartButton.hidden = !restart;
    if (restart) restartButton.textContent = uiText('button:measureChannelAgain', { ch: current.channelLabel });
}

/** Asks before measuring the current channel again from its first test signal. */
async function confirmRestartChannel() {
    const current = run;
    const restart = current?.restartChannel;
    if (!restart) return;
    const ch = current.channelLabel;
    if (await confirmDuringRun(current, 'title:measureChannelAgain', uiText('message:measureChannelAgain', { ch }),
        { key: 'button:measureChannelAgain', params: { ch } }) && current.restartChannel === restart) {
        if (current.progress) current.progress.bar.value = 0;
        current.progress = null;
        restart();
    }
}

/* ---------- Leave dialogs ---------- */

/** Shows the speaker distortion dialog; resolves with the value of the pressed button. */
export function askDialog(titleKey, message, buttons) {
    const dialog = byId('speakerDistortionDialog');
    byId('speakerDistortionDialogTitle').textContent = uiText(titleKey);
    byId('speakerDistortionDialogMessage').textContent = message;
    return new Promise(resolve => {
        byId('speakerDistortionDialogButtons').replaceChildren(...buttons.map(({ key, params, value, primary }) => {
            const choice = button(uiText(key, params), () => {
                dialog.style.display = 'none';
                resolve(value);
            }, primary ? 'primary-btn' : 'secondary-btn');
            if (value === false || value === 'stay') choice.dataset.dialogDismiss = '';
            return choice;
        }));
        dialog.style.display = 'flex';
    });
}

function ageText(measuredAt, now = Date.now()) {
    const format = new Intl.RelativeTimeFormat(uiLanguage(), { numeric: 'auto' });
    const minutes = Math.round((measuredAt - now) / 60000);
    return minutes > -60 ? format.format(minutes, 'minute') : format.format(Math.round(minutes / 60), 'hour');
}

/** Saves the unsaved result; resolves with the new id. */
export async function saveUnsavedResult(name) {
    const result = uiManager.unsavedSpeakerResult;
    if (!result) throw new Error('There is no unsaved speaker distortion result.');
    try {
        return await saveSpeakerResult(result, async () => {
            uiManager.updateResultsGraph();
            const id = await saveSpeakerDistortionRecord(result, { name, untitled: uiText('label:untitled'), store: dataStorage });
            if (uiManager.unsavedSpeakerResult === result) uiManager.unsavedSpeakerResult = null;
            showToast(uiText(savedMessageKey(uiManager.speakerDistortionOpenedBySetupRequest)));
            return id;
        });
    } catch (error) {
        if (uiManager.unsavedSpeakerResult === result) uiManager.updateResultsGraph();
        throw error;
    }
}

/**
 * Asks before leaving a running measurement or an unsaved result.
 * Resolves true when the caller may continue.
 */
export async function confirmSpeakerDistortionLeave() {
    const current = run;
    const operation = getSpeakerResultOperation();
    if (current || operation?.kind === 'check') {
        const stop = await askDialog('title:stopMeasurement', uiText('message:stopMeasurement'), [
            { key: 'button:stopAndLeave', value: true, primary: true },
            { key: 'button:stay', value: false }
        ]);
        if (!stop) return false;
        if (current) {
            current.leaving = true;
            current.controller.abort();
            await current.completion;
        } else {
            operation.controller.abort();
            await operation.completion;
        }
    }
    if (onCheckScreen()) await closeCheckAudio();
    const result = uiManager?.unsavedSpeakerResult;
    if (!result) return true;
    const pending = getSpeakerResultOperation();
    if (pending && pending.kind !== 'save') {
        uiManager.showNotification(uiText('message:speakerDistortionWaitForUpdate'));
        return false;
    }
    const channels = listText(result.speakerModel.channels.map(entry => entry.label), uiLanguage());
    const choice = pending ? 'save' : await askDialog('title:leaveUnsaved',
        uiText('message:leaveUnsaved', { channels, age: ageText(result.speakerModel.measuredAt) }), [
            { key: 'button:saveAndLeave', value: 'save', primary: true },
            { key: 'button:leaveWithoutSaving', value: 'leave' },
            { key: 'button:stay', value: 'stay' }
        ]);
    if (choice === 'stay') return false;
    if (uiManager.unsavedSpeakerResult !== result) return true;
    const latest = getSpeakerResultOperation();
    if (latest && latest.kind !== 'save') {
        uiManager.showNotification(uiText('message:speakerDistortionWaitForUpdate'));
        return false;
    }
    if (choice === 'save' || latest?.kind === 'save') {
        try {
            const id = await saveUnsavedResult(byId('speakerDistortionResultName')?.value ?? '');
            await uiManager.measurementDisplay.selectMeasurement(id);
        } catch (error) {
            console.error('Could not save the speaker distortion measurement:', error);
            uiManager.showNotification(uiText('error:speakerDistortionSaveFailed'), 'error');
            return false;
        }
    } else {
        uiManager.unsavedSpeakerResult = null;
        await uiManager.measurementDisplay.selectLatestMeasurement();
    }
    return true;
}

/* ---------- Setup ---------- */

export function initializeSpeakerDistortionScreens(manager) {
    uiManager = manager;
    manager.speakerDistortionAudio = speakerDistortionAudio;
    byId('measureFrequencyResponseBtn').addEventListener('click', () => uiManager.startNewMeasurement());
    byId('measureSpeakerDistortionBtn').addEventListener('click', () => openSpeakerDistortionSetup());
    byId('newMeasurementBack').addEventListener('click', () => uiManager.showScreen(startReturnScreen));
    byId('speakerDistortionRunCancel').addEventListener('click', () => confirmCancelRun());
    byId('speakerDistortionRunRestart').addEventListener('click', () => confirmRestartChannel());
    bindSetup();
    bindCheck();
    window.addEventListener('beforeunload', event => {
        if (!uiManager.unsavedSpeakerResult && !run) return;
        event.preventDefault();
        event.returnValue = '';
    });
}

export { showSetupScreen as showSpeakerDistortionSetupScreen };
