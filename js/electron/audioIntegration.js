/**
 * Audio integration module for EffeTune
 * Provides audio device functionality when running in Electron
 */

/**
 * Load saved audio preferences
 * @param {boolean} isElectron - Whether running in Electron environment
 * @returns {Promise<Object|null>} Audio preferences or null if not available
 */
export async function loadAudioPreferences(isElectron) {
  if (!isElectron) return null;
  
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
 * @returns {Promise<boolean>} Success status
 */
export async function saveAudioPreferences(isElectron, preferences) {
  if (!isElectron) return false;
  
  try {
    const result = await window.electronAPI.saveAudioPreferences(preferences);
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
  if (!isElectron) return [];
  
  try {
    // First try to get devices from Electron's main process
    try {
      const result = await window.electronAPI.getAudioDevices();
      if (result.success && result.devices && result.devices.length > 0) {
        return result.devices;
      }
    } catch (electronError) {
      console.warn('Failed to get audio devices from Electron API:', electronError);
      // Continue to browser API fallback
    }
    
    // If Electron API fails or returns no devices, try browser's API directly
    // This is especially important for output devices which can be enumerated
    // even when microphone permission is denied
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
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

/**
 * Show audio configuration dialog
 * @param {boolean} isElectron - Whether running in Electron environment
 * @param {Object} audioPreferences - Current audio preferences
 * @param {Function} callback - Callback function to be called when devices are selected
 */
export async function showAudioConfigDialog(isElectron, audioPreferences, callback) {
  if (!isElectron) return;
  
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
    
    // Create dialog HTML
    const dialogHTML = `
      <div class="audio-config-dialog">
        <h2>${t('dialog.audioConfig.title')}</h2>
        <div class="device-section">
          <label for="input-device">${t('dialog.audioConfig.inputDevice')}</label>
          <select id="input-device">
            ${inputDevices.map(device =>
              `<option value="${device.deviceId}" ${audioPreferences?.inputDeviceId === device.deviceId ? 'selected' : ''}>${device.label}</option>`
            ).join('')}
          </select>
          <div class="checkbox-container">
            <input type="checkbox" id="use-input-with-player" ${audioPreferences?.useInputWithPlayer ? 'checked' : ''}>
            <label for="use-input-with-player">${t('dialog.audioConfig.useInputWithPlayer')}</label>
          </div>
        </div>
        <div class="device-section">
          <label for="output-device">${t('dialog.audioConfig.outputDevice')}</label>
          <select id="output-device">
            ${outputDevices.map(device =>
              `<option value="${device.deviceId}" ${audioPreferences?.outputDeviceId === device.deviceId ? 'selected' : ''}>${device.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="device-section">
          <label for="output-channels">${t('dialog.audioConfig.outputChannels')}</label>
          <select id="output-channels">
            <option value="2" ${audioPreferences?.outputChannels === 2 ? 'selected' : ''}>2 - Stereo (Default)</option>
            <option value="4" ${audioPreferences?.outputChannels === 4 ? 'selected' : ''}>4</option>
            <option value="6" ${audioPreferences?.outputChannels === 6 ? 'selected' : ''}>6</option>
            <option value="8" ${audioPreferences?.outputChannels === 8 ? 'selected' : ''}>8</option>
          </select>
          <div class="checkbox-container">
            <input type="checkbox" id="low-latency-output" ${audioPreferences?.lowLatencyOutput ? 'checked' : ''}>
            <label for="low-latency-output">${t('dialog.audioConfig.lowLatencyOutput')}</label>
          </div>
        </div>
        <div class="device-section">
          <label for="sample-rate">${t('dialog.audioConfig.sampleRate')}</label>
          <select id="sample-rate">
            <option value="44100" ${currentSampleRate === 44100 ? 'selected' : ''}>44.1 kHz</option>
            <option value="48000" ${currentSampleRate === 48000 ? 'selected' : ''}>48 kHz</option>
            <option value="88200" ${currentSampleRate === 88200 ? 'selected' : ''}>88.2 kHz</option>
            <option value="96000" ${currentSampleRate === 96000 ? 'selected' : ''}>96 kHz (Default)</option>
            <option value="176400" ${currentSampleRate === 176400 ? 'selected' : ''}>176.4 kHz</option>
            <option value="192000" ${currentSampleRate === 192000 ? 'selected' : ''}>192 kHz</option>
            <option value="352800" ${currentSampleRate === 352800 ? 'selected' : ''}>352.8 kHz</option>
            <option value="384000" ${currentSampleRate === 384000 ? 'selected' : ''}>384 kHz</option>
          </select>
        </div>
        <div class="device-section">
          <label for="latency">${t('dialog.audioConfig.latency')}</label>
          <select id="latency">
            <option value="interactive" ${audioPreferences?.latencyHint === 'interactive' ? 'selected' : ''}>${t('dialog.audioConfig.latency.low')}</option>
            <option value="balanced" ${audioPreferences?.latencyHint === 'balanced' ? 'selected' : ''}>${t('dialog.audioConfig.latency.mid')}</option>
            <option value="playback" ${audioPreferences?.latencyHint === 'playback' ? 'selected' : ''}>${t('dialog.audioConfig.latency.high')}</option>
          </select>
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
    
    // Cancel button
    cancelButton.addEventListener('click', () => {
      document.body.removeChild(dialogElement);
      document.head.removeChild(styleElement);
      // Clear the "Configuring audio devices..." message
      if (window.uiManager) {
        window.uiManager.clearError();
      }
    });
    
    // Apply button
    applyButton.addEventListener('click', async () => {
      // Get selected values
      const inputDeviceSelect = document.getElementById('input-device');
      const outputDeviceSelect = document.getElementById('output-device');
      const sampleRateSelect = document.getElementById('sample-rate');
      const useInputWithPlayerCheckbox = document.getElementById('use-input-with-player');
      const outputChannelsSelect = document.getElementById('output-channels');
      const lowLatencyOutputCheckbox = document.getElementById('low-latency-output');
      const latencySelect = document.getElementById('latency');
      
      const inputDevice = inputDevices.find(d => d.deviceId === inputDeviceSelect.value);
      const outputDevice = outputDevices.find(d => d.deviceId === outputDeviceSelect.value);
      const selectedSampleRate = parseInt(sampleRateSelect.value, 10);
      const useInputWithPlayer = useInputWithPlayerCheckbox.checked;
      const outputChannels = parseInt(outputChannelsSelect.value, 10);
      const lowLatencyOutput = lowLatencyOutputCheckbox.checked;
      const selectedLatency = latencySelect.value;
      
      // Save preferences
      const preferences = {
        inputDeviceId: inputDeviceSelect.value,
        outputDeviceId: outputDeviceSelect.value,
        inputDeviceLabel: inputDevice?.label || '',
        outputDeviceLabel: outputDevice?.label || '',
        sampleRate: selectedSampleRate,
        useInputWithPlayer: useInputWithPlayer,
        lowLatencyOutput: lowLatencyOutput,
        outputChannels: outputChannels,
        latencyHint: selectedLatency
      };
      
      // Update global audio preferences for AudioWorklet context
      window.audioPreferences = preferences;
      
      // Save and close
      await saveAudioPreferences(isElectron, preferences);
      
      // Update AudioWorklet with the new channel configuration
      if (window.audioManager && window.audioManager.updateAudioConfig) {
        window.audioManager.updateAudioConfig(preferences);
      } else if (window.workletNode) {
        // Fallback if audioManager is not available
        window.workletNode.port.postMessage({
          type: 'updateAudioConfig',
          outputChannels: preferences.outputChannels
        });
      }
      
      // Remove dialog
      document.body.removeChild(dialogElement);
      document.head.removeChild(styleElement);
      
      // Call callback if provided
      if (callback) {
        callback(preferences);
      }
      
      // Clear error message
      clearErrorOnClose();

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