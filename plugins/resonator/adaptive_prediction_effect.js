const ADAPTIVE_PREDICTION_EFFECT_SYSTEM_PRESETS = Object.freeze([
    Object.freeze({ id: 'surprise', label: 'Surprise', params: Object.freeze({
        gap: 1, learn: 0.02, weightDecay: 0, autonomy: 0,
        original: 0, residual: 1, prediction: 0, freeze: false, hold: false
    }) }),
    Object.freeze({ id: 'prediction', label: 'Prediction', params: Object.freeze({
        gap: 5, learn: 0.02, weightDecay: 0, autonomy: 0,
        original: 0, residual: 0, prediction: 1, freeze: false, hold: false
    }) }),
    Object.freeze({ id: 'resonator', label: 'Resonator', params: Object.freeze({
        gap: 10, learn: 0.02, weightDecay: 0, autonomy: 0.98,
        original: 0.6, residual: 0, prediction: 0.6, freeze: false, hold: false
    }) }),
    Object.freeze({ id: 'hold', label: 'Hold', params: Object.freeze({
        gap: 10, learn: 0.02, weightDecay: 0, autonomy: 1,
        original: 0, residual: 0, prediction: 1, freeze: true, hold: true
    }) })
]);

class AdaptivePredictionEffectPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedChannelModes: Object.freeze(['mono', 'single', 'stereo-pair'])
    });

    static getSystemPresetGroups() {
        return [{ label: '', presets: ADAPTIVE_PREDICTION_EFFECT_SYSTEM_PRESETS.map(preset => ({ ...preset })) }];
    }

    static getPresetComparisonExcludedKeys() {
        return ['resetToken'];
    }

    constructor() {
        super('Adaptive Prediction', 'Learns audio predictions to extract residuals or create evolving resonance');
        this.gap = 1;
        this.learn = 0.02;
        this.weightDecay = 0;
        this.autonomy = 0;
        this.original = 0;
        this.residual = 1;
        this.prediction = 0;
        this.freeze = false;
        this.hold = false;
        this.resetToken = 0;
        this._finiteWeightDecay = 10;
        this.temporalCapability = 'must-process';
        this.executionState = { state: 'pending', reason: null };
        this.predictionFault = false;
        this.registerProcessor('return data;');
    }

    get decayInfinite() {
        return this.weightDecay === 0;
    }

    get learningFrozen() {
        return this.freeze || this.hold;
    }

    getTemporalCapability() {
        return this.enabled !== false ? 'must-process' : 'reset-on-resume';
    }

    onMessage(message) {
        if (message?.pluginId !== this.id ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        if (message.type === 'dspExecutionState') {
            super.onMessage(message);
            this.executionState = { state: message.state, reason: message.reason || null };
        } else if (message.type === 'adaptivePredictionFault') {
            this.predictionFault = message.latched === true;
        } else {
            return;
        }
        this._renderStatus();
    }

    _renderStatus() {
        if (!this._statusElement) return;
        let text = '';
        if (this.executionState.state === 'bypassed') {
            if (this.executionState.reason === 'unsupportedChannelMode') {
                text = 'Adaptive Prediction is bypassed. Select one channel or a stereo pair in its routing settings.';
            }
        }
        if (!text && this.predictionFault) {
            text = 'Adaptive Prediction encountered a processing problem. Press Reset, then play audio to learn again.';
        }
        this._statusElement.textContent = text;
        this._statusElement.hidden = !text;
    }

    getParameters() {
        return {
            ...super.getParameters(),
            gap: this.gap, learn: this.learn, weightDecay: this.weightDecay,
            autonomy: this.autonomy, original: this.original, residual: this.residual,
            prediction: this.prediction, freeze: this.freeze, hold: this.hold,
            resetToken: this.resetToken
        };
    }

    getSerializableParameters() {
        const parameters = super.getSerializableParameters();
        delete parameters.resetToken;
        return parameters;
    }

    setParameters(params = {}) {
        if (!params || typeof params !== 'object') return;
        super._setValidatedParameters(params);
        const ranges = {
            gap: [0, 500], learn: [0, 0.1], autonomy: [0, 1],
            original: [-2, 2], residual: [-2, 2], prediction: [-2, 2]
        };
        for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
            if (params[key] !== undefined) {
                this[key] = this.parseFiniteNumber(params[key], minimum, maximum, this[key]);
            }
        }
        if (params.weightDecay !== undefined) {
            const value = this.parseFiniteNumber(params.weightDecay, 0, 60, this.weightDecay);
            this.weightDecay = value === 0 ? 0 : (value < 0.5 ? 0.5 : value);
            if (this.weightDecay > 0) this._finiteWeightDecay = this.weightDecay;
        }
        if (params.freeze !== undefined) this.freeze = Boolean(params.freeze);
        if (params.hold !== undefined) this.hold = Boolean(params.hold);
        if (params.resetToken !== undefined) {
            this.resetToken = Math.floor(this.parseFiniteNumber(params.resetToken, 0, 16777215, this.resetToken));
        }
        this.updateParameters();
        this.syncUIControls();
    }

    resetLearning() {
        this.resetToken = this.resetToken >= 16777215 ? 0 : this.resetToken + 1;
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui adaptive-prediction-effect-ui';
        const columns = document.createElement('div');
        columns.className = 'ape-parameters';
        const predictionControls = document.createElement('div');
        const mixControls = document.createElement('div');
        columns.appendChild(predictionControls);
        columns.appendChild(mixControls);
        container.appendChild(columns);

        this._parameterRows = new Map();
        const addParameter = (parent, key, label, min, max, step, unit = '', toDisplay = null) => {
            const row = this.createParameterControl(label, min, max, step,
                toDisplay ? toDisplay(this[key]) : this[key],
                value => this.setParameters({ [key]: value }), unit, key, toDisplay);
            this._parameterRows.set(key, row);
            parent.appendChild(row);
        };
        addParameter(predictionControls, 'gap', 'Gap', 0, 500, 0.1, 'ms');
        addParameter(predictionControls, 'learn', 'Learn', 0, 0.1, 0.001);
        addParameter(predictionControls, 'weightDecay', 'Weight Decay', 0.5, 60, 0.5, 's',
            value => value === 0 ? this._finiteWeightDecay : value);
        this._infinityRow = this.createCheckboxControl('Infinity', this.decayInfinite,
            checked => this.setParameters({ weightDecay: checked ? 0 : this._finiteWeightDecay }), 'decayInfinite');
        predictionControls.appendChild(this._infinityRow);
        addParameter(predictionControls, 'autonomy', 'Autonomy', 0, 1, 0.01, '',
            value => this.hold ? 1 : value);
        addParameter(mixControls, 'original', 'Original', -2, 2, 0.01);
        addParameter(mixControls, 'residual', 'Residual', -2, 2, 0.01);
        addParameter(mixControls, 'prediction', 'Prediction', -2, 2, 0.01);

        this._freezeRow = this.createCheckboxControl('Freeze', this.learningFrozen,
            checked => this.setParameters({ freeze: checked }), 'learningFrozen');
        mixControls.appendChild(this._freezeRow);
        mixControls.appendChild(this.createCheckboxControl('Hold', this.hold,
            checked => this.setParameters({ hold: checked }), 'hold'));
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'analog-meter-reset-button';
        resetButton.textContent = 'Reset';
        resetButton.title = 'Clear learned predictions and audio history';
        resetButton.addEventListener('click', () => this.resetLearning());
        container.appendChild(resetButton);

        const holdHint = document.createElement('p');
        holdHint.className = 'ape-hold-hint';
        holdHint.textContent = 'Hold: learning is frozen and Autonomy is 1. The sound can continue to evolve.';
        container.appendChild(holdHint);
        this._holdHint = holdHint;
        const status = document.createElement('div');
        status.className = 'plugin-execution-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        container.appendChild(status);
        this._statusElement = status;
        this._renderStatus();
        this.registerUIRefresh(() => this._syncControlAvailability());
        this._syncControlAvailability();
        return container;
    }

    _syncControlAvailability() {
        if (!this._parameterRows) return;
        const setDisabled = (row, disabled) => {
            row.classList.toggle('parameter-disabled', disabled);
            row.querySelectorAll('input').forEach(input => { input.disabled = disabled; });
        };
        const learningStopped = this.learningFrozen;
        setDisabled(this._parameterRows.get('learn'), learningStopped);
        setDisabled(this._parameterRows.get('weightDecay'), learningStopped || this.decayInfinite);
        setDisabled(this._infinityRow, learningStopped);
        setDisabled(this._parameterRows.get('autonomy'), this.hold);
        setDisabled(this._freezeRow, this.hold);
        this._holdHint.hidden = !this.hold;
    }
}

window.AdaptivePredictionEffectPlugin = AdaptivePredictionEffectPlugin;
