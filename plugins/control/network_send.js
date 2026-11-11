class NetworkSendPlugin extends PluginBase {
    static hidePresetUI = true;

    constructor() {
        super('Live Audio Send', 'Send live audio from this position');
        this.temporalCapability = 'stateless';
        this.registerProcessor(`return data;`);
    }
}

window.NetworkSendPlugin = NetworkSendPlugin;
