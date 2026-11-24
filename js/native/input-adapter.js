import { AudioIOManager } from '../audio/audio-io-manager.js';
import { NO_AUDIO_INPUT_DEVICE_ID, SYSTEM_AUDIO_INPUT_DEVICE_ID } from '../audio/audio-device-constants.js';
import { evaluateSystemAudioGuard, getDefaultOutputGroupId } from '../audio/system-audio-guard.js';
import { listDriverDevices } from '../electron/audio-drivers.js';

export class NativeInputAdapter extends AudioIOManager {
  constructor(manager) {
    super(manager.contextManager);
    this.manager = manager;
    this.deviceSource = Object.freeze({nativeInput:true});
    this.silentSource = Object.freeze({silentInput:true});
    this.silentInputGainNode = this.silentSource;
  }
  ensureSilentSourceFallback() { return this.silentSource; }
  _refreshInputTrackState(options) {
    if (this.inputSourceNode !== this.deviceSource) super._refreshInputTrackState(options);
  }
  async evaluateSystemAudioGuard(outputId = this.currentOutputDeviceId) {
    if (outputId === 'default') return {...evaluateSystemAudioGuard(outputId, []),defaultGroupId:null};
    const {devices} = await listDriverDevices(this.manager.preferences.audioDriver, '');
    const outputs = devices.filter(device => device.kind === 'audiooutput');
    return {...evaluateSystemAudioGuard(outputId, outputs),defaultGroupId:getDefaultOutputGroupId(outputs)};
  }
  async prepareSystemAudio(outputId, current = () => true) {
    const guard = await this.evaluateSystemAudioGuard(outputId);
    if (!current()) throw this._createStaleInputAcquisitionError();
    if (!guard.allowed || !guard.defaultGroupId || this.systemAudioDisabled) {
      this.markSystemAudioDisabled();
      throw new DOMException('System Audio input is unavailable','NotAllowedError');
    }
    const api = window.electronAPI.systemAudio;
    const token = await api.nativeBegin(guard.defaultGroupId);
    if (!current() || this.engineGone) {
      if (!this.engineGone && token != null) await api.nativeEnd(token);
      throw this._createStaleInputAcquisitionError();
    }
    this.nativeCapture = {token,groupId:guard.defaultGroupId,confirmed:false};
    return this.nativeCapture;
  }
  endSystemAudio(engineGone = false) {
    const capture = this.nativeCapture;
    this.nativeCapture = null;
    this.systemAudioDefaultGroupId = null;
    if (engineGone) this.engineGone = true;
    else if (capture?.token != null) return window.electronAPI.systemAudio.nativeEnd(capture.token);
  }
  async confirmSystemAudio(capture, state) {
    if (state !== 'acquired') {
      if (this.nativeCapture === capture) await this.endSystemAudio();
      throw new Error('System Audio input is unavailable');
    }
    if (this.nativeCapture !== capture) throw this._createStaleInputAcquisitionError();
    let confirmed = false;
    try {
      confirmed = capture.token != null && await window.electronAPI.systemAudio.nativeHold(capture.token);
    } catch (error) { console.warn('System Audio mute confirmation:',error); }
    if (capture !== this.nativeCapture) throw this._createStaleInputAcquisitionError();
    if (!confirmed) {
      await this.manager.replaceInput(NO_AUDIO_INPUT_DEVICE_ID);
      if (this.nativeCapture === capture) await this.endSystemAudio();
      this.markSystemAudioDisabled();
      window.uiManager?.showTransientMessage?.('error.systemAudioMuteUnavailable',true,{},5000);
      const error = new Error('System Audio mute was unavailable');
      error.systemAudioNotified = true;
      throw error;
    }
    capture.confirmed = true;
    this.systemAudioDefaultGroupId = capture.groupId;
    this.manager.send({type:'setInputMix',enabled:this.inputRouteConnected});
  }
  inputMixAllowed() {
    return this.manager.preferences.inputDeviceId !== SYSTEM_AUDIO_INPUT_DEVICE_ID ||
      this.nativeCapture?.confirmed === true;
  }
  setInput(state,notify = false,reopened = false) {
    const live = state === 'acquired';
    if (!live && this.nativeCapture) void this.endSystemAudio();
    const ownsSource = !this.sourceNode || this.sourceNode === this.deviceSource || this.sourceNode === this.silentSource;
    this.inputGeneration++;
    this.inputResourceState = live ? 'live' : state === 'failed' ? 'ended' :
      this.manager.preferences.inputDeviceId === NO_AUDIO_INPUT_DEVICE_ID ? 'not-configured' : 'released';
    this._setInputAvailability(live ? 'available' : 'unknown');
    this.inputResourceId = live ? `native-${this.inputGeneration}` : null;
    this.inputSourceNode = live ? this.deviceSource : null;
    if (ownsSource) this.sourceNode = live ? this.deviceSource : this.silentSource;
    const route = reopened && typeof this.manager.inputMixEnabled === 'boolean' ?
      this.manager.inputMixEnabled : ownsSource || this.manager.preferences.useInputWithPlayer === true;
    this.inputRouteConnected = live && route;
    if (live) this.manager.send({type:'setInputMix',enabled:this.inputRouteConnected});
    if (notify) this.contextManager?.powerStateDelegate?.handleInputResourceEvent?.(this.getInputSnapshot());
  }
  beginReacquireAudioInput(options = {}) {
    const preferences = options.preferences || this.manager.preferences;
    const key = preferences.inputDeviceId || 'default';
    if (key === NO_AUDIO_INPUT_DEVICE_ID) {
      this.inputResourceState = 'not-configured';
      return Promise.resolve(this.getInputSnapshot());
    }
    if (options.requireVisible !== false && document.hidden) {
      return Promise.reject(new DOMException('Audio input requires a visible window','NotAllowedError'));
    }
    if (this._pendingInputAcquisition?.key === key) return this._pendingInputAcquisition.promise;
    const generation = ++this._inputAcquisitionGeneration;
    this.inputResourceState = 'acquiring';
    const acquire = async () => {
      const current = () => generation === this._inputAcquisitionGeneration;
      const capture = key === SYSTEM_AUDIO_INPUT_DEVICE_ID ? await this.prepareSystemAudio(undefined,current) : null;
      let result;
      try {
        result = await this.manager.replaceInput(key,options.timeoutMs);
        if (capture && current()) await this.confirmSystemAudio(capture,result.state);
      } catch (error) {
        if (capture && capture === this.nativeCapture && current() && !this.engineGone) {
          await this.manager.replaceInput(NO_AUDIO_INPUT_DEVICE_ID);
          if (capture === this.nativeCapture) await this.endSystemAudio();
        }
        throw error;
      }
      if (generation !== this._inputAcquisitionGeneration) throw this._createStaleInputAcquisitionError();
      if (result.state !== 'acquired') throw new Error('The selected audio input is unavailable');
      return this.getInputSnapshot();
    };
    const promise = acquire().catch(error => {
      if (generation === this._inputAcquisitionGeneration)
        this.inputResourceState = error.name === 'NotAllowedError' ? 'denied' : 'error';
      throw error;
    }).finally(() => {
      if (this._pendingInputAcquisition?.generation === generation) this._pendingInputAcquisition = null;
    });
    this._pendingInputAcquisition = {key,promise,generation};
    return promise;
  }
  releaseAudioInput(options = {}) {
    if (this.inputStream) return super.releaseAudioInput(options);
    const before = this.getInputSnapshot();
    this.invalidatePendingInputAcquisition();
    if (before.state !== 'live' && before.state !== 'acquiring')
      return {before,after:before,alreadyAbsent:true,stoppedTrackCount:0};
    return this.manager.replaceInput(NO_AUDIO_INPUT_DEVICE_ID).then(result => {
      if (result.state !== 'none') throw new Error('The selected audio input could not be released');
      return {before,after:this.getInputSnapshot(),alreadyAbsent:false,stoppedTrackCount:1};
    });
  }
}
