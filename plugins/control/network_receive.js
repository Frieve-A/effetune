class NetworkReceivePlugin extends PluginBase {
    static hidePresetUI = true;

    constructor() {
        super('Live Audio Receive', 'Insert incoming live audio at this position');
        this.temporalCapability = 'stateless';
        this.registerProcessor(`return data;`);
    }
}

window.NetworkReceivePlugin = NetworkReceivePlugin;
