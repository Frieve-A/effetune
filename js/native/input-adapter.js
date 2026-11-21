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
  async evaluateSystemAudioGuard() {
    const {devices} = await listDriverDevices(this.manager.preferences.audioDriver, '');
    const outputs = devices.filter(device => device.kind === 'audiooutput');
    return {...evaluateSystemAudioGuard(this.currentOutputDeviceId, outputs),defaultGroupId:getDefaultOutputGroupId(outputs)};
  }
  setInput(state,notify = false,reopened = false) {
    const live = state === 'acquired';
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
    if (preferences.inputDeviceId === SYSTEM_AUDIO_INPUT_DEVICE_ID) return super.beginReacquireAudioInput(options);
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
    const promise = this.manager.replaceInput(key,options.timeoutMs).then(result => {
      if (generation !== this._inputAcquisitionGeneration) throw this._createStaleInputAcquisitionError();
      if (result.state !== 'acquired') throw new Error('The selected audio input is unavailable');
      return this.getInputSnapshot();
    }).catch(error => {
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
