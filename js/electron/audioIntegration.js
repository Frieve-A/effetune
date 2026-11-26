/**
 * Audio integration module for EffeTune
 * Provides audio device functionality in Electron and browser builds
 */
import { recordDiagnosticEvent, rememberDiagnosticNames } from '../diagnostics/diagnostic-log.js';
import {
  mergeWebAudioPreferences,
  normalizeWebAudioPreferences
} from './webSettingsStorage.js';
import {
  isMidiDeviceOnlyChange,
  isPlayerPreferenceOnlyChange,
  loadAudioPreferences,
  pickPlayerPreferences,
  saveAudioPreferences
} from './audio-preference-store.js';
import { NO_AUDIO_INPUT_DEVICE_ID, SYSTEM_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';
import { evaluateSystemAudioGuard } from '../audio/system-audio-guard.js';
import { isAndroidHost, getAndroidBridge } from '../android/bridge.js';
import { bindMidiDeviceSettings } from '../midi/device-settings.js';
import { computeAutoTarget, getLoudnessClient } from '../ui/audio-player/replay-gain.js';
import { nativeDriverFor, driverName, listDriverDevices, selectDriverDevices } from './audio-drivers.js';
export { isPlayerPreferenceOnlyChange, loadAudioPreferences, saveAudioPreferences };

/**
 * Get available audio devices
 * @param {boolean} isElectron - Whether running in Electron environment
 * @returns {Promise<Array>} List of audio devices
 */
export async function getAudioDevices(isElectron) {
  if (isAndroidHost()) {
    const devices = await getAndroidBridge().request('audio.devices');
    // Native id 0 is the system default route; the dialog adds the single None input itself.
    const defaultLabel = window.uiManager?.t('dialog.audioConfig.driver.defaultDevice');
    return ['inputs', 'outputs'].flatMap(key => {
      const kind = key === 'inputs' ? 'audioinput' : 'audiooutput';
      return [{ deviceId: 'default', label: defaultLabel, kind,
        ...(key === 'outputs' && devices.defaultOutputChannelCounts && { channelCounts: devices.defaultOutputChannelCounts }) },
        ...devices[key].map(device => ({ deviceId: String(device.id), label: device.label, kind,
          ...(device.channelCounts && { channelCounts: device.channelCounts }) }))];
    });
  }
  try {
    // First try to get devices from Electron's main process
    if (isElectron) {
      try {
        const result = await window.electronAPI.getAudioDevices();
        if (result.success && result.devices && result.devices.length > 0) {
          return result.devices;
        }
      } catch (electronError) {
        console.warn('Failed to get audio devices from Electron API:', electronError);
        // Continue to browser API fallback
      }
    }
    
    // If Electron API fails or returns no devices, try browser's API directly
    // This is especially important for output devices which can be enumerated
    // even when microphone permission is denied
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      try {
        console.log('Trying to enumerate devices using browser API');
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Process and return the devices
        return devices.map(device => ({
          deviceId: device.deviceId,
          kind: device.kind,
          groupId: device.groupId,
          label: device.label || (device.kind === 'audioinput'
            ? 'Microphone (no permission)'
            : device.kind === 'audiooutput'
              ? `Speaker ${device.deviceId.substring(0, 5)}`
              : 'Unknown device')
        }));
      } catch (browserError) {
        console.warn('Failed to enumerate devices using browser API:', browserError);
      }
    }
    
    // If we still have no devices, create default placeholders
    // This ensures the user can at least select the default devices
    return [
      { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' }
    ];
  } catch (error) {
    console.error('Failed to get audio devices:', error);
    // Return default devices as fallback
    return [
      { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' }
    ];
  }
}

function getOutputDeviceSupport(isElectron) {
  if (isAndroidHost()) return { supported: true, reason: '' };
  if (isElectron) {
    return { supported: true, reason: '' };
  }

  if (window.isSecureContext === false) {
    return { supported: false, reasonKey: 'dialog.audioConfig.outputDevice.secureContextRequired' };
  }

  const audioContextPrototype = window.AudioContext?.prototype || window.webkitAudioContext?.prototype;
  const hasAudioContextSink = typeof audioContextPrototype?.setSinkId === 'function';
  const hasElementSink = typeof window.HTMLMediaElement?.prototype?.setSinkId === 'function' ||
    (typeof globalThis.Audio !== 'undefined' && typeof globalThis.Audio.prototype?.setSinkId === 'function');
  const hasUserSelection = typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.selectAudioOutput === 'function';

  if (!hasAudioContextSink && !hasElementSink) {
    return { supported: false, reasonKey: 'dialog.audioConfig.outputDevice.unsupportedBrowser' };
  }

  return {
    supported: true,
    reason: '',
    hasAudioContextSink,
    hasElementSink,
    hasUserSelection
  };
}

function replaceOptions(select, devices, selectedValue) {
  if (!select) return;
  select.innerHTML = '';
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || (device.kind === 'audioinput' ? 'Default Microphone' : 'Default Speaker');
    option.selected = device.deviceId === selectedValue;
    select.appendChild(option);
  });
  select.value = devices.some(device => device.deviceId === selectedValue)
    ? selectedValue
    : (devices[0]?.deviceId || 'default');
}

function getSelectedInputDeviceId(options, selectedValue, physicalInputs) {
  if (options.some(device => device.deviceId === selectedValue)) {
    return selectedValue;
  }
  return physicalInputs[0]?.deviceId || NO_AUDIO_INPUT_DEVICE_ID;
}

function audioPipelineConfigurationEqual(left, right) {
  if (!left || !right) return false;
  const defaults = {
    audioDriver: 'standard',
    outputDeviceId: 'default',
    sampleRate: 96000,
    useInputWithPlayer: false,
    useWasmDsp: true,
    outputChannels: 2,
    latencyHint: 'interactive'
  };
  return Object.entries(defaults).every(([key, fallback]) =>
    Object.is(left[key] ?? fallback, right[key] ?? fallback));
}

function canApplySilentInputWithoutReload(previousPreferences, nextPreferences) {
  return nextPreferences?.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID &&
    previousPreferences?.inputDeviceId !== NO_AUDIO_INPUT_DEVICE_ID &&
    audioPipelineConfigurationEqual(previousPreferences, nextPreferences);
}

function replaceValueOptions(select, values, selectedValue, labelForValue) {
  if (!select) return;
  select.innerHTML = '';
  const selectedValueString = String(selectedValue);
  values.forEach(value => {
    const optionValue = String(value);
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = labelForValue(value);
    option.selected = optionValue === selectedValueString;
    select.appendChild(option);
  });
  select.value = values.some(value => String(value) === selectedValueString) ? selectedValueString : String(values[0] || '');
}

async function applyMidiDevicePreferences(preferences) {
  await window.app?.applyMidiInputPreference?.(preferences.midiInputDeviceKey);
  await window.app?.applyMidiOutputPreference?.(preferences.midiOutputDeviceKey);
}

/**
 * Show audio configuration dialog
 * @param {boolean} isElectron - Whether running in Electron environment
 * @param {Object} audioPreferences - Current audio preferences
 * @param {Function} callback - Callback function to be called when devices are selected
 */
export async function showAudioConfigDialog(isElectron, audioPreferences, callback) {
  try {
    audioPreferences = normalizeWebAudioPreferences(audioPreferences || {});

    // Get available audio devices
    const driverBridge = isElectron && window.electronAPI?.audioEngine;
    const platform = window.electronAPI?.platform;
    const nativeDriver = nativeDriverFor(platform);
    let driver = driverBridge && audioPreferences.audioDriver === nativeDriver ? nativeDriver : 'standard';
    const originalDriver = driver;
    const translate = key => window.uiManager?.t(key);
    const defaultDeviceLabel = translate('dialog.audioConfig.driver.defaultDevice');
    const queryNativeDevices = async () => {
      const listing = await listDriverDevices(nativeDriver,defaultDeviceLabel);
      if (!listing.ok) throw new Error('Native audio device enumeration failed');
      return listing;
    };
    const nativeListing = driverBridge && (driver !== 'standard' || platform === 'linux') ?
      queryNativeDevices().catch(error => {
        console.warn('Audio driver device enumeration failed:',error);
        return null;
      }) : null;
    const initialNative = driver !== 'standard' ? await nativeListing : null;
    const devices = driver === 'standard' ? await getAudioDevices(isElectron) : initialNative?.devices || [];
    
    // Group devices by kind
    let inputDevices = devices.filter(device => device.kind === 'audioinput');
    let outputDevices = devices.filter(device => device.kind === 'audiooutput');
    
    // Ensure we have at least one default device in each category
    if (inputDevices.length === 0) {
      inputDevices.push({ deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' });
    }
    
    if (outputDevices.length === 0) {
      outputDevices.push({ deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' });
    }

    if (driver !== 'standard' && !initialNative) {
      // A failed query provides no evidence that a saved device disappeared.
      for (const [key,kind,options] of [['input','audioinput',inputDevices],['output','audiooutput',outputDevices]]) {
        const deviceId = audioPreferences[`${key}DeviceId`];
        if (deviceId && !['default',NO_AUDIO_INPUT_DEVICE_ID,SYSTEM_AUDIO_INPUT_DEVICE_ID].includes(deviceId)) {
          options.push({deviceId,kind,label:audioPreferences[`${key}DeviceLabel`] ||
            translate(`dialog.audioConfig.${key}Device`)});
        }
      }
    }
    
    console.log('Available input devices:', inputDevices);
    console.log('Available output devices:', outputDevices);
    
    const outputSupport = getOutputDeviceSupport(isElectron);
    if (!outputSupport.supported && audioPreferences?.outputDeviceId && audioPreferences.outputDeviceId !== 'default') {
      audioPreferences = { ...audioPreferences, outputDeviceId: 'default', outputDeviceLabel: '' };
    }

    // Get current sample rate preference or default to 96000
    const currentSampleRate = audioPreferences?.sampleRate || 96000;
    const androidHost = isAndroidHost();
    const nativeAudio = androidHost ? await getAndroidBridge().request('snapshot.get') : null;
    if (nativeAudio) {
      // The running native engine decides what the dialog shows; Android favors stable playback by default.
      const nativeDeviceId = id => id > 0 ? String(id) : 'default';
      audioPreferences = {
        ...audioPreferences,
        inputDeviceId: nativeAudio.inputDeviceId < 0 ? NO_AUDIO_INPUT_DEVICE_ID : nativeDeviceId(nativeAudio.inputDeviceId),
        outputDeviceId: nativeDeviceId(nativeAudio.preferredOutputDeviceId),
        outputChannels: nativeAudio.channelCount,
        midiOutputDeviceKey: nativeAudio.midiOutputDeviceKey ?? '',
        useInputWithPlayer: nativeAudio.useInputWithPlayer === true,
        gaplessPlayback: nativeAudio.gaplessPlayback !== false
      };
    }

    // Get translation function from UIManager
    if (!window.uiManager) {
      console.error('UIManager not available for translations');
      return;
    }
    const t = window.uiManager.t.bind(window.uiManager);
    // System Audio captures the Windows default output through the desktop app.
    const systemAudioOffered = isElectron && window.electronAPI?.platform === 'win32';
    const inputExtras = [
      {
        deviceId: NO_AUDIO_INPUT_DEVICE_ID,
        kind: 'audioinput',
        label: t('dialog.audioConfig.inputDevice.none')
      },
      ...(systemAudioOffered ? [{
        deviceId: SYSTEM_AUDIO_INPUT_DEVICE_ID,
        kind: 'audioinput',
        label: t('dialog.audioConfig.inputDevice.systemAudio')
      }] : []),
    ];
    let inputDeviceOptions = [...inputExtras, ...inputDevices];
    
    // Create dialog HTML
    const dialogHTML = `
      <div class="audio-config-dialog${androidHost ? '' : ' audio-config-dialog-wide'}">
        <h2>${t('dialog.audioConfig.title')}</h2>
        <div class="audio-config-content">
          <div class="audio-config-column">
            <div class="device-section">
              <label for="input-device">${t('dialog.audioConfig.inputDevice')}</label>
              <select id="input-device"></select>
              ${systemAudioOffered ? '<div class="device-help" id="input-device-help"></div>' : ''}
              <div class="checkbox-container">
                <input type="checkbox" id="use-input-with-player" ${audioPreferences?.useInputWithPlayer ? 'checked' : ''}>
                <label for="use-input-with-player">${t('dialog.audioConfig.useInputWithPlayer')}</label>
              </div>
            </div>
            <div class="device-section">
              ${driverBridge ? `<label for="audio-driver">${t('dialog.audioConfig.driver')}</label>
              <select id="audio-driver"></select>` : ''}
              <label for="output-device">${t('dialog.audioConfig.outputDevice')}</label>
              <select id="output-device"></select>
              <div class="device-help" id="output-device-support-message"></div>
            </div>
            <div class="device-section">
              <label for="output-channels">${t('dialog.audioConfig.outputChannels')}</label>
              <select id="output-channels"></select>
              ${!androidHost ? `<div class="checkbox-container">
                <input type="checkbox" id="use-wasm-dsp" ${audioPreferences?.useWasmDsp !== false ? 'checked' : ''}>
                <label for="use-wasm-dsp">${t('dialog.audioConfig.useWasmDsp')}</label>
              </div>` : ''}
              <div class="checkbox-container">
                <input type="checkbox" id="gapless-playback" ${audioPreferences?.gaplessPlayback !== false ? 'checked' : ''}>
                <label for="gapless-playback">${t('dialog.audioConfig.gaplessPlayback')}</label>
              </div>
            </div>
            <div class="device-section">
              <label for="sample-rate">${t('dialog.audioConfig.sampleRate')}</label>
              <select id="sample-rate"></select>
            </div>
            <div class="device-section">
              <label for="latency">${t('dialog.audioConfig.latency')}</label>
              <select id="latency"></select>
            </div>
          </div>
          <div class="audio-config-column">
            <div class="device-section">
              <label for="midi-input-device">${t('dialog.audioConfig.midiInput')}</label>
              <select id="midi-input-device"></select>
              <label for="midi-output-device">${t('dialog.audioConfig.midiOutput')}</label>
              <select id="midi-output-device"></select>
              <button type="button" id="refresh-midi-devices" class="header-button">${t('dialog.audioConfig.midiDevices.refresh')}</button>
              <div class="device-help" id="midi-device-help"></div>
            </div>
            <div class="device-section">
              <label for="replay-gain-mode">${t('dialog.audioConfig.replayGain')}</label>
              <select id="replay-gain-mode"></select>
              <label for="replay-gain-target">${t('dialog.audioConfig.replayGainTarget')} <output id="replay-gain-target-value" aria-live="polite"></output></label>
              <select id="replay-gain-target"></select>
              <label for="replay-gain-preamp">${t('dialog.audioConfig.replayGainPreamp')}</label>
              <input type="number" id="replay-gain-preamp" min="-15" max="15" step="0.5" value="${audioPreferences.replayGainPreampDb}">
              <label for="replay-gain-coverage">${t('dialog.audioConfig.replayGainAutoCoverage')}</label>
              <input type="number" id="replay-gain-coverage" min="1" max="100" step="1" value="${audioPreferences.replayGainAutoCoverage}">
              <div class="checkbox-container">
                <input type="checkbox" id="replay-gain-prevent-clipping" ${audioPreferences.replayGainPreventClipping ? 'checked' : ''}>
                <label for="replay-gain-prevent-clipping">${t('dialog.audioConfig.replayGainPreventClipping')}</label>
              </div>
              <label for="replay-gain-ceiling">${t('dialog.audioConfig.replayGainPeakCeiling')}</label>
              <input type="number" id="replay-gain-ceiling" min="-15" max="0" step="0.5" value="${audioPreferences.replayGainPeakCeilingDb}">
            </div>
          </div>
        </div>
        <div class="dialog-buttons">
          <button id="cancel-button">${t('dialog.audioConfig.cancel')}</button>
          <button id="apply-button" disabled>${t('dialog.audioConfig.apply')}</button>
        </div>
      </div>
    `;
    
    // Create dialog element
    const dialogElement = document.createElement('div');
    dialogElement.className = 'modal-overlay';
    dialogElement.innerHTML = dialogHTML;
    document.body.appendChild(dialogElement);
    
    // Add dialog styles
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: var(--et-scrim);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .audio-config-dialog {
        background-color: var(--et-surface-5);
        border-radius: 8px;
        padding: 20px;
        width: 440px;
        max-width: calc(100% - 32px);
        max-height: calc(100% - 32px);
        box-sizing: border-box;
        overflow: auto;
        display: flex;
        flex-direction: column;
        color: var(--et-text-primary);
      }
      .audio-config-dialog h2 {
        margin: 0 0 16px;
      }
      .audio-config-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-height: 0;
        overflow: auto;
        border-top: 1px solid var(--et-surface-20);
        padding: 16px 4px;
      }
      @media (min-width: 701px) {
        body:not(.layout-mobile) .audio-config-dialog-wide {
          width: 760px;
        }
        body:not(.layout-mobile) .audio-config-dialog-wide .audio-config-content {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px;
        }
        body:not(.layout-mobile) .audio-config-column + .audio-config-column {
          border-inline-start: 1px solid var(--et-surface-20);
          padding-inline-start: 24px;
        }
      }
      .audio-config-dialog .device-section {
        margin-bottom: 15px;
        overflow-wrap: anywhere;
      }
      .audio-config-column:last-child .device-section:last-child {
        margin-bottom: 0;
      }
      .audio-config-dialog .device-section label {
        display: block;
        margin-bottom: 5px;
      }
      .audio-config-dialog .device-section select + label {
        margin-top: 10px;
      }
      .audio-config-dialog .device-section :is(select, input[type="number"]) {
        width: 100%;
        box-sizing: border-box;
        padding: 8px;
        background-color: var(--et-surface-13);
        color: var(--et-text-primary);
        border: 1px solid var(--et-surface-20);
        border-radius: 4px;
      }
      .audio-config-dialog :is(#midi-input-device, #midi-output-device, #refresh-midi-devices) {
        min-height: 35px;
      }
      .audio-config-dialog #refresh-midi-devices {
        box-sizing: border-box;
        margin-top: 8px;
        max-width: 100%;
        padding: 4px 10px;
        white-space: normal;
      }
      body.layout-mobile .audio-config-dialog :is(#midi-input-device, #midi-output-device, #refresh-midi-devices) {
        min-height: var(--et-mobile-control-height);
      }
      .audio-config-dialog .device-help {
        color: var(--et-surface-74);
        font-size: 12px;
        line-height: 1.35;
        margin-top: 6px;
        white-space: pre-line;
      }
      .audio-config-dialog .device-help:empty {
        display: none;
      }
      .audio-config-dialog .checkbox-container {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .audio-config-dialog .checkbox-container input {
        flex-shrink: 0;
      }
      .audio-config-dialog .checkbox-container label {
        margin-bottom: 0;
      }
      .audio-config-dialog .dialog-buttons {
        flex-shrink: 0;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        padding-top: 16px;
        border-top: 1px solid var(--et-surface-20);
      }
      .audio-config-dialog .dialog-buttons button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .audio-config-dialog #apply-button:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `;
    document.head.appendChild(styleElement);
    
    // Add event listeners
    const cancelButton = document.getElementById('cancel-button');
    const applyButton = document.getElementById('apply-button');
    const inputSelect = document.getElementById('input-device');
    const outputSelect = document.getElementById('output-device');

    replaceOptions(
      inputSelect,
      inputDeviceOptions,
      getSelectedInputDeviceId(inputDeviceOptions, audioPreferences?.inputDeviceId || 'default', inputDevices)
    );
    replaceOptions(outputSelect, outputDevices, audioPreferences?.outputDeviceId || 'default');
    const channelSelect = document.getElementById('output-channels');
    let outputChannelsChanged = false;
    const updateChannelOptions = requested => {
      const counts = androidHost
        ? outputDevices.find(device => device.deviceId === outputSelect.value)?.channelCounts ?? [2]
        : [2, 4, 6, 8, 10, 12, 14, 16];
      const selected = androidHost ? counts.filter(count => count <= requested).at(-1) ?? counts[0] : requested;
      replaceValueOptions(channelSelect, counts, selected,
        value => value === 2 ? t('dialog.audioConfig.outputChannels.stereoDefault') : String(value));
    };
    updateChannelOptions(nativeAudio?.channelCount || audioPreferences?.outputChannels || 2);
    if (androidHost) {
      channelSelect.addEventListener('change', () => { outputChannelsChanged = true; });
      outputSelect.addEventListener('change', () => updateChannelOptions(outputChannelsChanged
        ? Number(channelSelect.value) : nativeAudio.preferredOutputChannelCount ?? nativeAudio.channelCount));
    }
    replaceValueOptions(
      document.getElementById('sample-rate'),
      nativeAudio ? nativeAudio.supportedSampleRates ?? [nativeAudio.sampleRate] : [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000],
      nativeAudio?.sampleRate || currentSampleRate,
      value => ({
        44100: '44.1 kHz',
        48000: androidHost ? t('dialog.audioConfig.sampleRate.default', { rate: '48' }) : '48 kHz',
        88200: '88.2 kHz',
        96000: androidHost ? '96 kHz' : t('dialog.audioConfig.sampleRate.default', { rate: '96' }),
        176400: '176.4 kHz',
        192000: '192 kHz',
        352800: '352.8 kHz',
        384000: '384 kHz'
      })[value] ?? `${value / 1000} kHz`
    );
    replaceValueOptions(
      document.getElementById('latency'),
      ['interactive', 'balanced', 'playback'],
      (nativeAudio?.latencyHint ?? audioPreferences?.latencyHint) || 'interactive',
      value => ({
        interactive: t(androidHost ? 'dialog.audioConfig.latency.lowPlain' : 'dialog.audioConfig.latency.low'),
        balanced: t(androidHost ? 'dialog.audioConfig.latency.midDefault' : 'dialog.audioConfig.latency.mid'),
        playback: t('dialog.audioConfig.latency.high')
      })[value]
    );
    {
      const replayGainModeSelect = document.getElementById('replay-gain-mode');
      replaceValueOptions(
        replayGainModeSelect,
        ['off', 'track', 'album'],
        audioPreferences.replayGainMode,
        value => t(`dialog.audioConfig.replayGain.${value}`)
      );
      const target = document.getElementById('replay-gain-target');
      const coverage = document.getElementById('replay-gain-coverage');
      const clipping = document.getElementById('replay-gain-prevent-clipping');
      const ceiling = document.getElementById('replay-gain-ceiling');
      const targetValue = document.getElementById('replay-gain-target-value');
      replaceValueOptions(target, ['manual', 'auto'], audioPreferences.replayGainTarget,
        value => t(`dialog.audioConfig.replayGainTarget.${value}`));
      let previewVersion = 0;
      const updateReplayGainControls = async () => {
        const version = ++previewVersion;
        const disabled = replayGainModeSelect.value === 'off';
        const auto = target.value === 'auto';
        target.disabled = disabled;
        document.getElementById('replay-gain-preamp').disabled = disabled || auto;
        coverage.disabled = disabled || !auto;
        clipping.disabled = disabled;
        ceiling.disabled = disabled || (!auto && !clipping.checked);
        targetValue.textContent = '';
        if (!disabled && auto) {
          try {
            const prefs = normalizeWebAudioPreferences({
              replayGainAutoCoverage: parseFloat(coverage.value),
              replayGainPeakCeilingDb: parseFloat(ceiling.value)
            });
            const client = await getLoudnessClient();
            const stats = await client?.getLoudnessStats({ coverage: prefs.replayGainAutoCoverage });
            if (version === previewVersion) {
              const level = computeAutoTarget({ mode: replayGainModeSelect.value, peakCeilingDb: prefs.replayGainPeakCeilingDb }, stats);
              targetValue.textContent = `${level.toFixed(1)} LUFS`;
            }
          } catch (error) {
            console.warn('Unable to preview the automatic loudness target:', error);
          }
        }
      };
      for (const control of [replayGainModeSelect, target, clipping, coverage, ceiling]) {
        control.addEventListener('change', updateReplayGainControls);
      }
      void updateReplayGainControls();
    }

    const supportMessage = document.getElementById('output-device-support-message');
    if (!outputSupport.supported) {
      outputSelect.disabled = true;
      outputSelect.value = 'default';
      supportMessage.textContent = outputSupport.reasonKey ? t(outputSupport.reasonKey) : '';
    }
    let updateSystemAudioAvailability = () => {};
    if (systemAudioOffered) {
      const inputHelp = document.getElementById('input-device-help');
      // Capturing the output EffeTune plays through would mute it, so the
      // option stays unavailable until another output device is selected.
      updateSystemAudioAvailability = () => {
        const systemAudioOption = Array.from(inputSelect.children)
          .find(option => option.value === SYSTEM_AUDIO_INPUT_DEVICE_ID);
        const outputDeviceId = outputSelect.disabled ? 'default' : outputSelect.value;
        const { allowed } = evaluateSystemAudioGuard(outputDeviceId, outputDevices);
        systemAudioOption.disabled = !allowed;
        inputHelp.textContent = allowed ? '' : t('dialog.audioConfig.inputDevice.systemAudioUnavailable');
        if (!allowed && inputSelect.value === SYSTEM_AUDIO_INPUT_DEVICE_ID) {
          inputSelect.value = NO_AUDIO_INPUT_DEVICE_ID;
        }
      };
      outputSelect.addEventListener('change', updateSystemAudioAvailability);
      updateSystemAudioAvailability();
    }

    let dialogClosed = false;
    let applyInProgress = true;
    let loadingDriver = false, refreshRevision = 0;
    const driverSelect = driverBridge && document.getElementById('audio-driver');
    if (driverSelect) {
      replaceValueOptions(driverSelect, ['standard',nativeDriver], driver,
        value => value === 'standard' ? t('dialog.audioConfig.driver.standard') : driverName(platform, initialNative?.backend));
      if (driver === 'standard' && nativeListing) void nativeListing.then(listing => {
        if (!dialogClosed && refreshRevision === 0 && listing?.backend)
          driverSelect.children[1].textContent = driverName(platform, listing.backend);
      });
    }
    const selectedDevices = () => ({
      inputDeviceId: inputSelect.value, outputDeviceId: outputSelect.value,
      inputDeviceLabel: inputDeviceOptions.find(d => d.deviceId === inputSelect.value)?.label || '',
      outputDeviceLabel: outputDevices.find(d => d.deviceId === outputSelect.value)?.label || ''
    });
    const refreshDevices = async () => {
      if (!driverSelect) return;
      const revision = ++refreshRevision, next = driverSelect.value;
      const previous = selectedDevices();
      loadingDriver = true;
      applyButton.disabled = true;
      try {
        const listing = next === 'standard' ? { devices: await getAudioDevices(isElectron) } :
          await queryNativeDevices();
        if (dialogClosed || revision !== refreshRevision) return;
        if (listing.backend) driverSelect.children[1].textContent = driverName(platform, listing.backend);
        inputDevices = listing.devices.filter(device => device.kind === 'audioinput');
        outputDevices = listing.devices.filter(device => device.kind === 'audiooutput');
        inputDeviceOptions = [...inputExtras, ...inputDevices];
        const selected = selectDriverDevices(inputDeviceOptions, outputDevices, previous);
        replaceOptions(inputSelect, inputDeviceOptions, selected.input);
        replaceOptions(outputSelect, outputDevices, selected.output);
        driver = next;
        updateSystemAudioAvailability();
      } catch (error) {
        console.warn('Audio driver device enumeration failed:',error);
        driverSelect.value = driver;
      } finally {
        if (revision === refreshRevision) {
          loadingDriver = false;
          applyButton.disabled = applyInProgress;
        }
      }
    };
    driverSelect?.addEventListener?.('change', refreshDevices);
    if (driverSelect) navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    let cleanupMidiSettings;
    cancelButton.addEventListener('click', closeDialog);
    document.addEventListener('keydown', handleKeydown);
    applyButton.addEventListener('click', applyPreferences);
    try {
      let midiManager;
      try {
        midiManager = await window.app?.ensureMidiControllerManager?.();
      } catch (error) {
        console.warn('MIDI device initialization failed:', error);
      }
      if (dialogClosed) return;
      cleanupMidiSettings = bindMidiDeviceSettings({
        manager: midiManager,
        inputSelect: document.getElementById('midi-input-device'),
        outputSelect: document.getElementById('midi-output-device'),
        refreshButton: document.getElementById('refresh-midi-devices'),
        status: document.getElementById('midi-device-help'),
        selectedInputKey: audioPreferences.midiInputDeviceKey || '',
        selectedOutputKey: audioPreferences.midiOutputDeviceKey || '', t
      });
    } finally {
      applyInProgress = false;
      applyButton.disabled = loadingDriver;
    }
    function closeDialog() {
      if (dialogClosed) return;
      dialogClosed = true;
      if (driverSelect) navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
      cleanupMidiSettings?.();
      if (dialogElement.parentNode) {
        dialogElement.parentNode.removeChild(dialogElement);
      }
      if (styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
      }
      document.removeEventListener('keydown', handleKeydown);
    }

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
      }
      const targetTagName = e.target?.tagName?.toUpperCase();
      if (e.key === 'Enter' && !e.isComposing &&
          !e.altKey && !e.ctrlKey && !e.metaKey &&
          !e.target?.isContentEditable &&
          !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(targetTagName)) {
        e.preventDefault();
        void applyPreferences();
      }
    }

    // Cancel and keyboard handlers also remain available during MIDI setup.
    
    // Apply button
    async function applyPreferences() {
      if (dialogClosed || applyInProgress || loadingDriver) return;
      applyInProgress = true;
      applyButton.disabled = true;
      try {
      // Get selected values
      const inputDeviceSelect = document.getElementById('input-device');
      const outputDeviceSelect = document.getElementById('output-device');
      const sampleRateSelect = document.getElementById('sample-rate');
      const useInputWithPlayerCheckbox = document.getElementById('use-input-with-player');
      const outputChannelsSelect = document.getElementById('output-channels');
      const useWasmDspCheckbox = document.getElementById('use-wasm-dsp');
      const gaplessPlaybackCheckbox = document.getElementById('gapless-playback');
      const latencySelect = document.getElementById('latency');
      
      const inputDevice = inputDeviceOptions.find(d => d.deviceId === inputDeviceSelect.value);
      let selectedOutputDeviceId = outputDeviceSelect.disabled ? 'default' : outputDeviceSelect.value;
      let outputDevice = outputDevices.find(d => d.deviceId === selectedOutputDeviceId);
      let replacedOutput = null;
      const recordReplacement = (reason, errorName) => {
        replacedOutput = { id: selectedOutputDeviceId, label: outputDevice?.label || '' };
        rememberDiagnosticNames('id', [replacedOutput.id]);
        rememberDiagnosticNames('device', [replacedOutput.label]);
        recordDiagnosticEvent('outputFallback', { reason, errorName, result: 'unknown',
          outputSelection: 'explicit', outputDeviceLabel: replacedOutput.label });
      };
      const selectedSampleRate = parseInt(sampleRateSelect.value, 10);
      const useInputWithPlayer = useInputWithPlayerCheckbox.checked;
      const outputChannels = parseInt(outputChannelsSelect.value, 10);
      const useWasmDsp = useWasmDspCheckbox ? useWasmDspCheckbox.checked : audioPreferences.useWasmDsp;
      const selectedLatency = latencySelect.value;
      if (!isElectron && !androidHost &&
        selectedOutputDeviceId !== 'default' &&
        outputChannels > 2 &&
        !outputSupport.hasAudioContextSink
      ) {
        recordReplacement('multichannelSinkUnavailable');
        console.warn('Output device selection requires AudioContext.setSinkId for multichannel output, using default output.');
        selectedOutputDeviceId = 'default';
        outputDevice = outputDevices.find(d => d.deviceId === 'default') || null;
      }
      if (!isElectron && outputSupport.hasUserSelection && selectedOutputDeviceId !== 'default') {
        try {
          const selectedDevice = await navigator.mediaDevices.selectAudioOutput({ deviceId: selectedOutputDeviceId });
          if (selectedDevice?.deviceId) {
            selectedOutputDeviceId = selectedDevice.deviceId;
            outputDevice = selectedDevice;
          }
        } catch (error) {
          recordReplacement('selectionRejected', error?.name);
          console.warn('Failed to select audio output device, using default output:', error);
          selectedOutputDeviceId = 'default';
          outputDevice = outputDevices.find(d => d.deviceId === 'default') || null;
        }
      }
      
      // Save preferences
      const preferences = {
        ...(driverBridge && driver !== originalDriver ? { audioDriver: driver } : {}),
        midiInputDeviceKey: document.getElementById('midi-input-device').value,
        midiOutputDeviceKey: document.getElementById('midi-output-device').value,
        replayGainMode: document.getElementById('replay-gain-mode').value,
        replayGainTarget: document.getElementById('replay-gain-target').value,
        replayGainPreampDb: parseFloat(document.getElementById('replay-gain-preamp').value),
        replayGainAutoCoverage: parseFloat(document.getElementById('replay-gain-coverage').value),
        replayGainPreventClipping: document.getElementById('replay-gain-prevent-clipping').checked,
        replayGainPeakCeilingDb: parseFloat(document.getElementById('replay-gain-ceiling').value),
        inputDeviceId: inputDeviceSelect.value,
        outputDeviceId: selectedOutputDeviceId,
        inputDeviceLabel: inputDevice?.label || '',
        outputDeviceLabel: outputDevice?.label || '',
        sampleRate: selectedSampleRate,
        useInputWithPlayer: useInputWithPlayer,
        useWasmDsp: useWasmDsp,
        gaplessPlayback: gaplessPlaybackCheckbox.checked,
        outputChannels: outputChannels,
        latencyHint: selectedLatency
      };
      
      const effectivePreferences = mergeWebAudioPreferences(audioPreferences, preferences);
      const appliedPreferences = driverBridge ? effectivePreferences : preferences;
      const midiOnlyChange = isMidiDeviceOnlyChange(audioPreferences, effectivePreferences);
      if (!androidHost && midiOnlyChange) {
        const saved = await saveAudioPreferences(isElectron, {
          midiInputDeviceKey: effectivePreferences.midiInputDeviceKey,
          midiOutputDeviceKey: effectivePreferences.midiOutputDeviceKey
        }, { applyInPlace: 'midi-devices' });
        if (!saved) {
          window.uiManager?.setError?.('error.audioSettingsSaveFailed', true);
          return;
        }
        window.audioPreferences = effectivePreferences;
        if (window.electronIntegration) window.electronIntegration.audioPreferences = effectivePreferences;
        await applyMidiDevicePreferences(effectivePreferences);
        closeDialog();
        callback?.(effectivePreferences);
        return;
      }
      const playerOnlyChange = isPlayerPreferenceOnlyChange(audioPreferences, effectivePreferences);
      if (!androidHost && playerOnlyChange && typeof window.audioManager?.applyPlayerPreferences === 'function') {
        closeDialog();
        let applyResult = '';
        try {
          applyResult = await window.audioManager.applyPlayerPreferences(effectivePreferences);
          if (applyResult) {
            console.error('Failed to apply player preferences:', applyResult);
          }
        } catch (error) {
          console.error('Failed to apply player preferences:', error);
          applyResult = error || true;
        }
        if (applyResult && window.uiManager) {
          window.uiManager.setError('error.audioSettingsSaveFailed', true);
        }
        if (!applyResult) callback?.(effectivePreferences);
        return;
      }
      if (!androidHost && playerOnlyChange) {
        // Persist only the player fields so the stored preferences never
        // absorb session-only runtime overrides or refreshed device labels.
        const saved = await saveAudioPreferences(isElectron, pickPlayerPreferences(effectivePreferences), {
          applyInPlace: 'player-preferences'
        });
        if (!saved) {
          window.uiManager?.setError?.('error.audioSettingsSaveFailed', true);
          return;
        }
        window.audioPreferences = effectivePreferences;
        if (window.electronIntegration) window.electronIntegration.audioPreferences = effectivePreferences;
        closeDialog();
        callback?.(effectivePreferences);
        return;
      }

      const applyThroughAudioManager = !isElectron ||
        canApplySilentInputWithoutReload(audioPreferences, appliedPreferences);
      if (applyThroughAudioManager &&
          window.audioManager && typeof window.audioManager.reset === 'function') {
        let settings = appliedPreferences;
        if (androidHost) {
          settings = playerOnlyChange ? pickPlayerPreferences(effectivePreferences)
            : midiOnlyChange ? {} : { ...appliedPreferences };
          if (!outputChannelsChanged) delete settings.outputChannels;
          for (const key of ['midiInputDeviceKey', 'midiOutputDeviceKey']) {
            if ((effectivePreferences[key] || '') !== (audioPreferences[key] || '')) {
              settings[key] = effectivePreferences[key] || '';
            } else {
              delete settings[key];
            }
          }
        }
        closeDialog();
        let resetResult = '';
        try {
          const manager = window.audioManager.contextManager;
          if (manager) manager.pendingDiagnosticOutput = replacedOutput;
          try {
            resetResult = await window.audioManager.reset(settings);
          } finally {
            if (manager && manager.pendingDiagnosticOutput === replacedOutput) manager.pendingDiagnosticOutput = null;
          }
          if (resetResult) {
            console.error('Failed to apply audio preferences:', resetResult);
          }
        } catch (error) {
          console.error('Failed to apply audio preferences:', error);
          resetResult = error || true;
        }
        if (androidHost && resetResult?.code === 'cancelled') return;
        if (resetResult && window.uiManager) {
          let errorKey = 'error.audioResetFailed';
          if (androidHost && resetResult.code === 'unsupported-format') {
            errorKey = 'dialog.audioConfig.driver.format';
          } else if (androidHost && resetResult.code === 'permission-denied') {
            errorKey = 'error.androidMicrophonePermissionDenied';
          } else if (androidHost && resetResult.code === 'midi-unavailable') {
            errorKey = 'dialog.audioConfig.midiDevices.unavailable';
          } else if (androidHost && (playerOnlyChange || midiOnlyChange)) {
            errorKey = 'error.audioSettingsSaveFailed';
          }
          window.uiManager.setError(errorKey, true);
        }
        if (callback) {
          callback(androidHost ? window.audioPreferences : appliedPreferences);
        }
        if (!androidHost && !resetResult) await applyMidiDevicePreferences(appliedPreferences);
        return;
      }
      if (androidHost) {
        window.uiManager?.setError?.('error.audioSettingsSaveFailed', true);
        return;
      }

      // Save and close
      const saved = await saveAudioPreferences(isElectron, preferences);
      if (!saved) {
        window.uiManager?.setError?.('error.audioSettingsSaveFailed', true);
        return;
      }
      window.audioPreferences = appliedPreferences;
      if (window.electronIntegration) window.electronIntegration.audioPreferences = appliedPreferences;

      // Update AudioWorklet with the new channel configuration
      if (isElectron && window.audioManager && window.audioManager.updateAudioConfig) {
        window.audioManager.updateAudioConfig(appliedPreferences);
      } else if (isElectron && window.workletNode) {
        // Fallback if audioManager is not available
        window.workletNode.port.postMessage({
          type: 'updateAudioConfig',
          outputChannels: preferences.outputChannels
        });
      }
      
      // Remove dialog
      closeDialog();
      
      // Call callback if provided
      if (callback) {
        callback(appliedPreferences);
      }
      
      if (isElectron) window.uiManager?.setError?.('dialog.audioConfig.updatedMessage');
      } finally {
        applyInProgress = false;
        applyButton.disabled = loadingDriver;
      }
    }
  } catch (error) {
    console.error('Failed to show audio config dialog:', error);
  }
}
