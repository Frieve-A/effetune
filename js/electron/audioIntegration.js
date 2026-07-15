/**
 * Audio integration module for EffeTune
 * Provides audio device functionality in Electron and browser builds
 */
import {
  loadWebAudioPreferences,
  saveWebAudioPreferences
} from './webSettingsStorage.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';

/**
 * Load saved audio preferences
 * @param {boolean} isElectron - Whether running in Electron environment
 * @returns {Promise<Object|null>} Audio preferences or null if not available
 */
export async function loadAudioPreferences(isElectron) {
  if (!isElectron) return loadWebAudioPreferences();
  
  try {
    const result = await window.electronAPI.loadAudioPreferences();
    if (result.success && result.preferences) {
      return result.preferences;
    }
    return null;
  } catch (error) {
    console.error('Failed to load audio preferences:', error);
    return null;
  }
}

/**
 * Save audio preferences
 * @param {boolean} isElectron - Whether running in Electron environment
 * @param {Object} preferences - Audio device preferences
 * @param {Object} options - Persistence behavior for renderer-managed changes
 * @returns {Promise<boolean>} Success status
 */
export async function saveAudioPreferences(isElectron, preferences, options = {}) {
  if (!isElectron) return saveWebAudioPreferences(preferences);
  
  try {
    const result = await window.electronAPI.saveAudioPreferences(preferences, options);
    return result.success;
  } catch (error) {
    console.error('Failed to save audio preferences:', error);
    return false;
  }
}

/**
 * Get available audio devices
 * @param {boolean} isElectron - Whether running in Electron environment
 * @returns {Promise<Array>} List of audio devices
 */
export async function getAudioDevices(isElectron) {
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

function getSelectedInputDeviceId(devices, selectedValue) {
  if (devices.some(device => device.deviceId === selectedValue)) {
    return selectedValue;
  }
  return devices.find(device => device.deviceId !== NO_AUDIO_INPUT_DEVICE_ID)?.deviceId ||
    NO_AUDIO_INPUT_DEVICE_ID;
}

function audioPipelineConfigurationEqual(left, right) {
  if (!left || !right) return false;
  const defaults = {
    outputDeviceId: 'default',
    sampleRate: 96000,
    useInputWithPlayer: false,
    lowLatencyOutput: false,
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

/**
 * Show audio configuration dialog
 * @param {boolean} isElectron - Whether running in Electron environment
 * @param {Object} audioPreferences - Current audio preferences
 * @param {Function} callback - Callback function to be called when devices are selected
 */
export async function showAudioConfigDialog(isElectron, audioPreferences, callback) {
  try {
    // Show "Configuring audio devices..." message
    if (window.uiManager) {
      window.uiManager.setError('status.configuringAudio');
    }
    
    // Get available audio devices
    const devices = await getAudioDevices(isElectron);
    
    // Group devices by kind
    const inputDevices = devices.filter(device => device.kind === 'audioinput');
    const outputDevices = devices.filter(device => device.kind === 'audiooutput');
    
    // Ensure we have at least one default device in each category
    if (inputDevices.length === 0) {
      inputDevices.push({ deviceId: 'default', kind: 'audioinput', label: 'Default Microphone' });
    }
    
    if (outputDevices.length === 0) {
      outputDevices.push({ deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' });
    }
    
    console.log('Available input devices:', inputDevices);
    console.log('Available output devices:', outputDevices);
    
    const outputSupport = getOutputDeviceSupport(isElectron);
    if (!outputSupport.supported && audioPreferences?.outputDeviceId && audioPreferences.outputDeviceId !== 'default') {
      audioPreferences = { ...audioPreferences, outputDeviceId: 'default', outputDeviceLabel: '' };
    }

    // Get current sample rate preference or default to 96000
    const currentSampleRate = audioPreferences?.sampleRate || 96000;
    
    // Add window close event listener to clear error message
    const clearErrorOnClose = () => {
      if (window.uiManager) {
        window.uiManager.clearError();
      }
      window.removeEventListener('beforeunload', clearErrorOnClose);
    };
    window.addEventListener('beforeunload', clearErrorOnClose);
    
    // Get translation function from UIManager
    if (!window.uiManager) {
      console.error('UIManager not available for translations');
      return;
    }
    const t = window.uiManager.t.bind(window.uiManager);
    const inputDeviceOptions = [
      {
        deviceId: NO_AUDIO_INPUT_DEVICE_ID,
        kind: 'audioinput',
        label: t('dialog.audioConfig.inputDevice.none')
      },
      ...inputDevices
    ];
    
    // Create dialog HTML
    const dialogHTML = `
      <div class="audio-config-dialog">
        <h2>${t('dialog.audioConfig.title')}</h2>
        <div class="device-section">
          <label for="input-device">${t('dialog.audioConfig.inputDevice')}</label>
          <select id="input-device"></select>
          <div class="checkbox-container">
            <input type="checkbox" id="use-input-with-player" ${audioPreferences?.useInputWithPlayer ? 'checked' : ''}>
            <label for="use-input-with-player">${t('dialog.audioConfig.useInputWithPlayer')}</label>
          </div>
        </div>
        <div class="device-section">
          <label for="output-device">${t('dialog.audioConfig.outputDevice')}</label>
          <select id="output-device"></select>
          <div class="device-help" id="output-device-support-message"></div>
        </div>
        <div class="device-section">
          <label for="output-channels">${t('dialog.audioConfig.outputChannels')}</label>
          <select id="output-channels"></select>
          <div class="checkbox-container">
            <input type="checkbox" id="low-latency-output" ${audioPreferences?.lowLatencyOutput ? 'checked' : ''}>
            <label for="low-latency-output">${t('dialog.audioConfig.lowLatencyOutput')}</label>
          </div>
          <div class="checkbox-container">
            <input type="checkbox" id="use-wasm-dsp" ${audioPreferences?.useWasmDsp !== false ? 'checked' : ''}>
            <label for="use-wasm-dsp">${t('dialog.audioConfig.useWasmDsp')}</label>
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
        <div class="dialog-buttons">
          <button id="cancel-button">${t('dialog.audioConfig.cancel')}</button>
          <button id="apply-button">${t('dialog.audioConfig.apply')}</button>
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
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      .audio-config-dialog {
        background-color: #222;
        border-radius: 8px;
        padding: 20px;
        width: 400px;
        color: #fff;
      }
      .device-section {
        margin-bottom: 15px;
      }
      .device-section label {
        display: block;
        margin-bottom: 5px;
      }
      .device-section select {
        width: 100%;
        padding: 8px;
        background-color: #333;
        color: #fff;
        border: 1px solid #444;
        border-radius: 4px;
      }
      .device-help {
        color: #bbb;
        font-size: 12px;
        line-height: 1.35;
        margin-top: 6px;
        min-height: 16px;
      }
      .checkbox-container {
        margin-top: 8px;
        display: flex;
        align-items: center;
      }
      .checkbox-container input[type="checkbox"] {
        margin-right: 8px;
      }
      .checkbox-container label {
        display: inline;
        margin-bottom: 0;
      }
      .dialog-buttons {
        display: flex;
        justify-content: flex-end;
        margin-top: 20px;
      }
      .dialog-buttons button {
        padding: 8px 16px;
        margin-left: 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      #cancel-button {
        background-color: #555;
        color: #fff;
      }
      #apply-button {
        background-color: #007bff;
        color: #fff;
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
      getSelectedInputDeviceId(inputDeviceOptions, audioPreferences?.inputDeviceId || 'default')
    );
    replaceOptions(outputSelect, outputDevices, audioPreferences?.outputDeviceId || 'default');
    replaceValueOptions(
      document.getElementById('output-channels'),
      [2, 4, 6, 8],
      audioPreferences?.outputChannels || 2,
      value => value === 2 ? t('dialog.audioConfig.outputChannels.stereoDefault') : String(value)
    );
    replaceValueOptions(
      document.getElementById('sample-rate'),
      [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000],
      currentSampleRate,
      value => ({
        44100: '44.1 kHz',
        48000: '48 kHz',
        88200: '88.2 kHz',
        96000: t('dialog.audioConfig.sampleRate.default', { rate: '96' }),
        176400: '176.4 kHz',
        192000: '192 kHz',
        352800: '352.8 kHz',
        384000: '384 kHz'
      })[value]
    );
    replaceValueOptions(
      document.getElementById('latency'),
      ['interactive', 'balanced', 'playback'],
      audioPreferences?.latencyHint || 'interactive',
      value => ({
        interactive: t('dialog.audioConfig.latency.low'),
        balanced: t('dialog.audioConfig.latency.mid'),
        playback: t('dialog.audioConfig.latency.high')
      })[value]
    );

    const supportMessage = document.getElementById('output-device-support-message');
    if (!outputSupport.supported) {
      outputSelect.disabled = true;
      outputSelect.value = 'default';
      supportMessage.textContent = outputSupport.reasonKey ? t(outputSupport.reasonKey) : '';
    }
    
    let dialogClosed = false;
    function closeDialog() {
      if (dialogClosed) return;
      dialogClosed = true;
      if (dialogElement.parentNode) {
        dialogElement.parentNode.removeChild(dialogElement);
      }
      if (styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
      }
      document.removeEventListener('keydown', handleKeydown);
      clearErrorOnClose();
    }

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
    }

    // Cancel button
    cancelButton.addEventListener('click', closeDialog);
    document.addEventListener('keydown', handleKeydown);
    
    // Apply button
    applyButton.addEventListener('click', async () => {
      // Get selected values
      const inputDeviceSelect = document.getElementById('input-device');
      const outputDeviceSelect = document.getElementById('output-device');
      const sampleRateSelect = document.getElementById('sample-rate');
      const useInputWithPlayerCheckbox = document.getElementById('use-input-with-player');
      const outputChannelsSelect = document.getElementById('output-channels');
      const lowLatencyOutputCheckbox = document.getElementById('low-latency-output');
      const useWasmDspCheckbox = document.getElementById('use-wasm-dsp');
      const latencySelect = document.getElementById('latency');
      
      const inputDevice = inputDeviceOptions.find(d => d.deviceId === inputDeviceSelect.value);
      let selectedOutputDeviceId = outputDeviceSelect.disabled ? 'default' : outputDeviceSelect.value;
      let outputDevice = outputDevices.find(d => d.deviceId === selectedOutputDeviceId);
      const selectedSampleRate = parseInt(sampleRateSelect.value, 10);
      const useInputWithPlayer = useInputWithPlayerCheckbox.checked;
      const outputChannels = parseInt(outputChannelsSelect.value, 10);
      const lowLatencyOutput = lowLatencyOutputCheckbox.checked;
      const useWasmDsp = useWasmDspCheckbox.checked;
      const selectedLatency = latencySelect.value;
      const directOutputRequested = outputChannels > 2 || lowLatencyOutput;
      if (!isElectron &&
        selectedOutputDeviceId !== 'default' &&
        directOutputRequested &&
        !outputSupport.hasAudioContextSink
      ) {
        console.warn('Output device selection requires AudioContext.setSinkId in direct or multichannel mode, using default output.');
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
          console.warn('Failed to select audio output device, using default output:', error);
          selectedOutputDeviceId = 'default';
          outputDevice = outputDevices.find(d => d.deviceId === 'default') || null;
        }
      }
      
      // Save preferences
      const preferences = {
        inputDeviceId: inputDeviceSelect.value,
        outputDeviceId: selectedOutputDeviceId,
        inputDeviceLabel: inputDevice?.label || '',
        outputDeviceLabel: outputDevice?.label || '',
        sampleRate: selectedSampleRate,
        useInputWithPlayer: useInputWithPlayer,
        lowLatencyOutput: lowLatencyOutput,
        useWasmDsp: useWasmDsp,
        outputChannels: outputChannels,
        latencyHint: selectedLatency
      };
      
      const applyThroughAudioManager = !isElectron ||
        canApplySilentInputWithoutReload(audioPreferences, preferences);
      if (applyThroughAudioManager &&
          window.audioManager && typeof window.audioManager.reset === 'function') {
        closeDialog();
        let resetResult = '';
        try {
          resetResult = await window.audioManager.reset(preferences);
        } catch (error) {
          console.error('Failed to apply audio preferences:', error);
          resetResult = `Audio Error: ${error.message}`;
        }
        if (resetResult && window.uiManager) {
          window.uiManager.setError(resetResult, true);
        }
        if (callback) {
          callback(preferences);
        }
        return;
      }

      // Electron applies the new preferences after the Web path has completed
      // its local, atomic source replacement.
      window.audioPreferences = preferences;

      // Save and close
      await saveAudioPreferences(isElectron, preferences);

      // Update AudioWorklet with the new channel configuration
      if (isElectron && window.audioManager && window.audioManager.updateAudioConfig) {
        window.audioManager.updateAudioConfig(preferences);
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
        callback(preferences);
      }
      
      if (!isElectron) {
        return;
      }

      // Show message about reloading
      const messageElement = document.createElement('div');
      messageElement.style.position = 'fixed';
      messageElement.style.top = '50%';
      messageElement.style.left = '50%';
      messageElement.style.transform = 'translate(-50%, -50%)';
      messageElement.style.backgroundColor = '#222';
      messageElement.style.color = '#fff';
      messageElement.style.padding = '20px';
      messageElement.style.borderRadius = '8px';
      messageElement.style.zIndex = '1000';
      messageElement.style.textAlign = 'center';
      messageElement.innerHTML = `<h3>${t('dialog.audioConfig.updatedTitle')}</h3><p>${t('dialog.audioConfig.updatedMessage')}</p>`;
      document.body.appendChild(messageElement);
      
      // Wait a moment to show the message
      // Note: We don't need to reload here because the main process will handle it
      // The main process already has a timeout to reload after saving preferences
      setTimeout(() => {
        // Just log that we're waiting for the main process to reload
        console.log('Waiting for main process to reload the window...');
        // The main process will reload after 3 seconds
      }, 1500);
    });
  } catch (error) {
    console.error('Failed to show audio config dialog:', error);
  }
}
