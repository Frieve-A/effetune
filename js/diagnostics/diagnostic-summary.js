import { NO_AUDIO_INPUT_DEVICE_ID, SYSTEM_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';
import { driverName } from '../electron/audio-drivers.js';

const OS_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
// Chromium-based browsers also report Chrome and Safari tokens, so their own tokens come first.
const BROWSERS = [['Edg', 'Microsoft Edge'], ['EdgA', 'Microsoft Edge'], ['EdgiOS', 'Microsoft Edge'], ['OPR', 'Opera'],
    ['Firefox', 'Firefox'], ['FxiOS', 'Firefox'], ['CriOS', 'Chrome'], ['Chrome', 'Chrome'], ['Version', 'Safari']];
const LATENCY_SETTINGS = {
    interactive: ['dialog.audioConfig.latency.low', 'Low (Default)'],
    balanced: ['dialog.audioConfig.latency.mid', 'Mid'],
    playback: ['dialog.audioConfig.latency.high', 'High (Most stable)']
};
// Android defaults to Mid, so its labels differ from the other platforms.
const ANDROID_LATENCY_SETTINGS = {
    ...LATENCY_SETTINGS,
    interactive: ['dialog.audioConfig.latency.lowPlain', 'Low'],
    balanced: ['dialog.audioConfig.latency.midDefault', 'Mid (Default)']
};

// Builds the plain-language overview shown above the detailed diagnostic file.
export function diagnosticSummary({ win, environment, android, native, versions, preferences, manager, context,
    outputLabel, inputLabel, trackRate, androidEngine }, translate) {
    const t = (key, fallback, values = {}) => translate(`diagnostics.summary.${key}`, fallback)
        .replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
    const unknown = t('unknown', 'Unknown');
    const rate = value => value > 0 ? `${value} Hz` : unknown;
    const time = seconds => Number.isFinite(seconds) && seconds >= 0 ? `${(seconds * 1000).toFixed(1)} ms` : unknown;
    const sections = [];
    const section = (title, lines) => sections.push([title, ...lines.filter(Boolean).map(line => `  ${line}`)].join('\n'));

    const userAgent = win.navigator?.userAgent ?? '';
    const os = environment
        ? [OS_NAMES[environment.platform] ?? environment.platform, environment.systemVersion, environment.arch && `(${environment.arch})`]
        : [win.navigator?.userAgentData?.platform || /\(([^)]+)\)/.exec(userAgent)?.[1]];
    const browser = BROWSERS.find(([token]) => versions[token]);
    const runtime = environment ? `Electron ${environment.electron} (Chromium ${environment.chromium})`
        : browser && `${browser[1]} ${versions[browser[0]]}`;
    section(t('system', 'System'), [
        t('app', 'App: EffeTune {version}', { version: environment?.appVersion ?? win.app?.appVersion ?? unknown }),
        t('os', 'OS: {name}', { name: os.filter(Boolean).join(' ') || unknown }),
        t('runtime', 'Runtime: {name}', { name: runtime || unknown })
    ]);

    const defaultDevice = translate('dialog.audioConfig.driver.defaultDevice', 'System default');
    const input = {
        [NO_AUDIO_INPUT_DEVICE_ID]: translate('dialog.audioConfig.inputDevice.none', 'None (music file player only)'),
        [SYSTEM_AUDIO_INPUT_DEVICE_ID]: translate('dialog.audioConfig.inputDevice.systemAudio', 'System Audio (sound from other apps)')
    }[preferences.inputDeviceId] ?? (inputLabel || defaultDevice);
    const driver = native ? (environment ? driverName(environment.platform) : unknown)
        : android ? 'AAudio / OpenSL ES' : translate('dialog.audioConfig.driver.standard', 'Standard');
    const session = native?.session;
    const hasInput = session?.inputChannels > 0;
    section(t('audio', 'Audio devices'), [
        t('driver', 'Driver: {name}', { name: driver }),
        t('outputDevice', 'Output device: {name} ({channels} ch)', {
            name: outputLabel || defaultDevice, channels: manager?.getOutputChannelCount?.() ?? unknown
        }),
        // Only the native driver reports how many input channels the device actually delivers.
        hasInput
            ? t('inputDeviceChannels', 'Input device: {name} ({channels} ch)', { name: input, channels: session.inputChannels })
            : t('inputDevice', 'Input device: {name}', { name: input }),
        native && !session && t('notRunning', 'The audio driver is not running.')
    ]);
    if (native && !session) return sections.join('\n\n');

    const processing = session?.sampleRate ?? (android ? androidEngine?.sampleRate : context?.sampleRate);
    const rates = [t('processingRate', 'Processing: {rate}', { rate: rate(processing) })];
    if (session) {
        rates.push(t('outputRate', 'Output device: {rate}', { rate: rate(session.deviceRate) }));
        if (hasInput) rates.push(t('inputRate', 'Input device: {rate}', { rate: rate(session.captureRate) }));
    } else if (android && androidEngine?.outputHardwareSampleRate > 0) {
        rates.push(t('outputRate', 'Output device: {rate}', { rate: rate(androidEngine.outputHardwareSampleRate) }));
    }
    if (trackRate) rates.push(t('trackRate', 'Current track: {rate}', { rate: rate(trackRate) }));
    if (session) {
        rates.push(session.sampleRate === session.deviceRate
            ? t('outputConversionNone', 'Output sample rate conversion: None')
            : t('outputConversion', 'Output sample rate conversion: {from} → {to}',
                { from: rate(session.sampleRate), to: rate(session.deviceRate) }));
        if (hasInput) {
            // Device input always passes the adaptive converter that follows the output device clock.
            // The adjustment is the converter's current change from the nominal input-to-output ratio.
            const ppm = Math.round((native.captureRatio * session.sampleRate / session.captureRate - 1) * 1e7) / 10;
            const values = {
                from: rate(session.captureRate), to: rate(session.sampleRate),
                adjustment: native.captureRatio > 0 && Number.isFinite(ppm) ? `${ppm > 0 ? '+' : ''}${(ppm || 0).toFixed(1)} ppm` : unknown
            };
            rates.push(session.captureRate === session.sampleRate
                ? t('inputClockSync', 'Input sample rate conversion: Fine adjustment only, to follow the output device clock (current input rate adjustment: {adjustment})', values)
                : t('inputConversion', 'Input sample rate conversion: {from} → {to}, adjusted to follow the output device clock (current input rate adjustment: {adjustment})', values));
        }
    } else if (android) {
        // Android resamples in the output stream when the hardware rate differs from the engine rate.
        // The hardware rate is 0 when the OS does not report it, so nothing is claimed then.
        const deviceRate = androidEngine?.outputHardwareSampleRate;
        if (deviceRate > 0) {
            rates.push(deviceRate === processing
                ? t('outputConversionNone', 'Output sample rate conversion: None')
                : t('outputConversion', 'Output sample rate conversion: {from} → {to}',
                    { from: rate(processing), to: rate(deviceRate) }));
        }
    } else {
        rates.push(t('systemConversion', 'Sample rate conversion: Done by the browser or system when needed (not shown here)'));
    }
    section(t('sampleRates', 'Sample rates'), rates);

    // Android defaults to the stable setting when nothing has been saved.
    const settings = android ? ANDROID_LATENCY_SETTINGS : LATENCY_SETTINGS;
    const [settingKey, settingFallback] = settings[native?.openSettings?.latency ?? preferences.latencyHint ??
        (android ? 'balanced' : 'interactive')] ?? settings.interactive;
    const latency = [t('latencySetting', 'Latency setting: {value}', { value: translate(settingKey, settingFallback) })];
    if (session) {
        // Clock-derived values are reported only while the driver stream runs.
        const clock = native.latency ?? {};
        const outputDevice = (clock.outputLatencyFrames ?? session.outputLatencyFrames) / session.deviceRate;
        const conversion = session.sampleRate === session.deviceRate ? 0 : clock.outputConverterDelayFrames / session.sampleRate;
        latency.push(
            t('deviceBuffer', 'Device buffer: {frames} samples ({time})',
                { frames: session.periodFrames ?? unknown, time: time(session.periodFrames / session.deviceRate) }),
            t('outputLatency', 'Output latency: {total} (driver and device {device} + sample rate conversion {conversion})',
                { total: time(outputDevice + conversion), device: time(outputDevice), conversion: time(conversion) }));
        if (hasInput) {
            const inputDevice = (clock.inputLatencyFrames ?? session.inputLatencyFrames) / session.captureRate;
            const buffer = clock.captureTargetFrames / session.captureRate;
            const conversion = clock.captureConverterDelayFrames / session.captureRate;
            latency.push(t('inputLatency', 'Input latency: {total} (driver and device {device} + input buffer {buffer} + sample rate conversion {conversion})',
                { total: time(inputDevice + buffer + conversion), device: time(inputDevice), buffer: time(buffer), conversion: time(conversion) }));
        }
        latency.push(t('appBuffer', 'Transfer buffer from the app window to the driver: {time}',
            { time: time(clock.feedFrames / session.sampleRate) }));
    } else if (android) {
        const frames = androidEngine?.outputBufferFrames;
        latency.push(t('deviceBuffer', 'Device buffer: {frames} samples ({time})', {
            frames: frames > 0 ? frames : unknown,
            time: frames > 0 && androidEngine.deviceSampleRate > 0 ? time(frames / androidEngine.deviceSampleRate) : unknown
        }));
    } else if (context) {
        latency.push(t('browserLatency', 'Output latency reported by the browser: {total} (processing {base} + output {output})', {
            total: time(context.baseLatency + context.outputLatency), base: time(context.baseLatency), output: time(context.outputLatency)
        }));
    }
    // Android has no AudioContext, so its processing rate converts the delay.
    const effectsRate = android ? processing : context?.sampleRate;
    if (effectsRate > 0 && manager?.getTotalPipelineLatencySamples) {
        const samples = manager.getTotalPipelineLatencySamples();
        latency.push(t('effectsLatency', 'Total Delay (effect pipeline): {time} ({samples} samples)',
            { time: time(samples / effectsRate), samples }));
    }
    if (session && !native.latency) latency.push(t('partial', 'Some values are available only while audio is running.'));
    section(t('latencyTitle', 'Buffers and latency'), latency);
    return sections.join('\n\n');
}
