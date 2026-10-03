// Stand-in for the audio manager on a remote client. The client never touches
// audio: it shows and edits the host's pipeline, so every worklet call is a
// no-op and the only thing that matters is that local edits (which reach the
// manager through commitPowerTopologyMutation, exactly as in the app) are
// reported to the sync engine. Shaped like the extension editor's manager.

class NullWorkletPort extends EventTarget {
    postMessage() {}
    start() {}
}

export class RemoteAudioManager {
    constructor() {
        this.pipelineA = [];
        this.pipelineB = null;
        // Always 'A': the host's A/B choice is only a label here, because the
        // editor shows exactly one pipeline.
        this.currentPipeline = 'A';
        this.masterBypass = false;
        // True while the engine applies the host's state to the editor.
        this.suppressMutations = true;
        // (plugin | null) => void, set by the page once the engine exists.
        this.onLocalChange = null;
        const audioContext = { sampleRate: 48000, destination: { channelCount: 2 } };
        this.workletPort = new NullWorkletPort();
        this.workletNode = { port: this.workletPort, context: audioContext, channelCount: 2 };
        this.audioContext = audioContext;
        this.contextManager = { workletNode: this.workletNode, audioContext };
        this.pipelineProcessor = { setMasterBypass() {} };
        this.outputChannelCount = 2;
    }

    get pipeline() { return this.pipelineA; }
    set pipeline(plugins) { this.pipelineA = plugins; }
    getCurrentPipeline() { return this.pipelineA; }
    updateCurrentPipeline(plugins) { this.pipelineA = plugins; }
    getActivePowerWorklets() { return [this.workletNode]; }
    incrementPowerDiagnostic() {}
    syncPrimaryWasmAssetMembership() {}
    notifyPipelineAnalysisInvalidated() {}
    rebuildPipeline() { globalThis.window?.FrequencyPreview?.stop?.(); }
    setFrequencyPreview() {}
    dispatchEvent() { return true; }
    broadcastToActiveWorklets() {}

    // Every parameter, routing, order, enable and bypass change of the editor
    // comes through here (plugins/plugin-base.js, pipeline-worklet-sync.js).
    commitPowerTopologyMutation(message) {
        if (this.suppressMutations || !this.onLocalChange) return;
        if (message?.type === 'updatePlugin') {
            const plugin = this.pipelineA.find(candidate => candidate.id === message.plugin?.id);
            if (plugin) this.onLocalChange(plugin);
            return;
        }
        this.onLocalChange(null);
    }

    setMasterBypass(enabled) {
        this.masterBypass = !!enabled;
        if (!this.suppressMutations) this.onLocalChange?.(null);
    }
}
