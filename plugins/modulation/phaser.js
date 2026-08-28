const PHASER_MODES = Object.freeze(['Classic', 'Barber-pole']);
const PHASER_DIRECTIONS = Object.freeze(['Up', 'Down']);
const PHASER_SYSTEM_PRESETS = Object.freeze([
    Object.freeze({ id: 'classic-phaser', label: 'Classic Phaser', params: Object.freeze({ md: 'Classic', rt: 0.5, cf: 1000, rg: 3, st: 6, fb: 20, sp: 90, dr: 'Up', mx: 50 }) }),
    Object.freeze({ id: 'deep-phaser', label: 'Deep Phaser', params: Object.freeze({ md: 'Classic', rt: 0.25, cf: 700, rg: 4.5, st: 12, fb: 55, sp: 30, dr: 'Up', mx: 55 }) }),
    Object.freeze({ id: 'stereo-phaser', label: 'Stereo Phaser', params: Object.freeze({ md: 'Classic', rt: 0.65, cf: 1200, rg: 3.5, st: 8, fb: 25, sp: 120, dr: 'Up', mx: 50 }) }),
    Object.freeze({ id: 'barber-pole-up', label: 'Barber-pole Up', params: Object.freeze({ md: 'Barber-pole', rt: 0.35, cf: 1000, rg: 5, st: 8, fb: 30, sp: 60, dr: 'Up', mx: 55 }) }),
    Object.freeze({ id: 'barber-pole-down', label: 'Barber-pole Down', params: Object.freeze({ md: 'Barber-pole', rt: 0.35, cf: 1000, rg: 5, st: 8, fb: 30, sp: 60, dr: 'Down', mx: 55 }) })
]);
class PhaserPlugin extends PluginBase {
    static searchAliases = Object.freeze(['Barber-pole Phaser', 'Barber Pole Phaser']);
    static executionCapabilities = Object.freeze({
        jsFallbackCapacity: Object.freeze({
            maxJsFallbackSampleChannels: 96000
        })
    });
    static getSystemPresetGroups() {
        return [{ label: '', presets: PHASER_SYSTEM_PRESETS.map(preset => ({ ...preset })) }];
    }

    constructor() {
        super('Phaser', 'Creates moving peaks and notches with classic or continuous barber-pole sweeps');
        this.md = 'Classic';
        this.rt = 0.5;
        this.cf = 1000;
        this.rg = 3;
        this.st = 6;
        this.fb = 20;
        this.sp = 90;
        this.dr = 'Up';
        this.mx = 50;
        this._directionRow = null;
        this._uiControls = null;
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            const TWO_PI = 6.283185307179586;
            const PI = 3.141592653589793;
            const MAX_CHANNELS = 16;
            const MAX_STAGES = 12;
            const BARBER_VOICES = 3;
            const sampleRate = parameters.sampleRate;
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            if (!(sampleRate > 0) || channelCount < 1 || channelCount > MAX_CHANNELS || blockSize < 1) return data;

            if (!context.phaserState) {
                context.phaserState = new Float64Array(MAX_CHANNELS * BARBER_VOICES * MAX_STAGES);
                context.phaserFeedback = new Float64Array(MAX_CHANNELS);
                context.phaserPhase = 0;
                context.phaserChannels = channelCount;
                context.phaserMode = parameters.md;
                const initialStages = Math.round(parameters.st / 2) * 2;
                context.phaserStages = initialStages < 2 ? 2 :
                    (initialStages > MAX_STAGES ? MAX_STAGES : initialStages);
                context.phaserDirection = parameters.dr;
                context.phaserPendingMode = context.phaserMode;
                context.phaserPendingStages = context.phaserStages;
                context.phaserPendingDirection = context.phaserDirection;
                context.phaserTransition = 0;
                context.phaserTransitionPosition = 0;
                context.phaserSmoothed = new Float64Array([parameters.rt, parameters.cf,
                    parameters.rg, parameters.fb, parameters.sp, parameters.mx]);
                context.phaserTargets = new Float64Array(6);
            } else if (context.phaserChannels !== channelCount) {
                context.phaserState.fill(0);
                context.phaserFeedback.fill(0);
                context.phaserPhase = 0;
                context.phaserChannels = channelCount;
            }

            const roundedStages = Math.round(parameters.st / 2) * 2;
            const requestedStages = roundedStages < 2 ? 2 :
                (roundedStages > MAX_STAGES ? MAX_STAGES : roundedStages);
            const directionAffectsWet = parameters.md === 'Barber-pole' ||
                context.phaserMode === 'Barber-pole';
            const discreteChanged = parameters.md !== context.phaserMode ||
                requestedStages !== context.phaserStages ||
                (directionAffectsWet && parameters.dr !== context.phaserDirection);
            if (discreteChanged && context.phaserTransition === 0) {
                context.phaserPendingMode = parameters.md;
                context.phaserPendingStages = requestedStages;
                context.phaserPendingDirection = parameters.dr;
                context.phaserTransition = 1;
                context.phaserTransitionPosition = 0;
            } else if (context.phaserTransition !== 0) {
                context.phaserPendingMode = parameters.md;
                context.phaserPendingStages = requestedStages;
                context.phaserPendingDirection = parameters.dr;
            } else {
                context.phaserDirection = parameters.dr;
            }

            const state = context.phaserState;
            const feedbackState = context.phaserFeedback;
            const smooth = context.phaserSmoothed;
            const targets = context.phaserTargets;
            targets[0] = parameters.rt;
            targets[1] = parameters.cf;
            targets[2] = parameters.rg;
            targets[3] = parameters.fb;
            targets[4] = parameters.sp;
            targets[5] = parameters.mx;
            const smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
            const requestedTransitionLength = Math.ceil(sampleRate * 0.005);
            const transitionLength = requestedTransitionLength < 1 ? 1 : requestedTransitionLength;
            const maximumFrequency = sampleRate * 0.45;
            let phase = context.phaserPhase;
            let mode = context.phaserMode;
            let stages = context.phaserStages;
            let direction = context.phaserDirection;
            let transition = context.phaserTransition;
            let transitionPosition = context.phaserTransitionPosition;

            for (let frame = 0; frame < blockSize; ++frame) {
                smooth[0] += (targets[0] - smooth[0]) * smoothing;
                smooth[1] += (targets[1] - smooth[1]) * smoothing;
                smooth[2] += (targets[2] - smooth[2]) * smoothing;
                smooth[3] += (targets[3] - smooth[3]) * smoothing;
                smooth[4] += (targets[4] - smooth[4]) * smoothing;
                smooth[5] += (targets[5] - smooth[5]) * smoothing;
                const requestedFeedback = smooth[3] * 0.01;
                const feedback = requestedFeedback < -0.9 ? -0.9 :
                    (requestedFeedback > 0.9 ? 0.9 : requestedFeedback);
                const mix = smooth[5] * 0.01;
                let wetGate = 1;
                if (transition === 1) {
                    wetGate = 1 - transitionPosition / transitionLength;
                } else if (transition === 2) {
                    wetGate = transitionPosition / transitionLength;
                }

                for (let channel = 0; channel < channelCount; ++channel) {
                    const audioIndex = channel * blockSize + frame;
                    const dry = data[audioIndex];
                    const input = dry + feedbackState[channel] * feedback;
                    if (!Number.isFinite(input)) {
                        const firstVoice = channel * BARBER_VOICES;
                        const activeVoices = mode === 'Classic' ? 1 : BARBER_VOICES;
                        for (let voice = 0; voice < activeVoices; ++voice) {
                            const base = (firstVoice + voice) * MAX_STAGES;
                            state.fill(0, base, base + stages);
                        }
                        feedbackState[channel] = 0;
                        data[audioIndex] = dry * (1 - mix * wetGate);
                        continue;
                    }
                    const sideOffset = (channel & 1) === 1 ? smooth[4] / 360 : 0;
                    let wet = 0;
                    if (mode === 'Classic') {
                        const sweep = Math.sin(phase + sideOffset * TWO_PI);
                        let frequency = smooth[1] * 2 ** (0.5 * smooth[2] * sweep);
                        frequency = frequency < 20 ? 20 :
                            (frequency > maximumFrequency ? maximumFrequency : frequency);
                        const tangent = Math.tan(PI * frequency / sampleRate);
                        const rawCoefficient = (tangent - 1) / (tangent + 1);
                        const coefficient = rawCoefficient < -0.999 ? -0.999 :
                            (rawCoefficient > 0.999 ? 0.999 : rawCoefficient);
                        const base = channel * BARBER_VOICES * MAX_STAGES;
                        wet = input;
                        for (let stage = 0; stage < stages; ++stage) {
                            const memory = state[base + stage];
                            const output = coefficient * wet + memory;
                            let nextMemory = wet - coefficient * output;
                            if (nextMemory > -1e-30 && nextMemory < 1e-30) nextMemory = 0;
                            state[base + stage] = nextMemory;
                            wet = output;
                        }
                    } else {
                        let weightSum = 0;
                        for (let voice = 0; voice < BARBER_VOICES; ++voice) {
                            let sweepPosition = phase / TWO_PI + sideOffset + voice / BARBER_VOICES;
                            sweepPosition -= Math.floor(sweepPosition);
                            if (direction === 'Down') sweepPosition = 1 - sweepPosition;
                            let frequency = smooth[1] * 2 ** (smooth[2] * (sweepPosition - 0.5));
                            frequency = frequency < 20 ? 20 :
                                (frequency > maximumFrequency ? maximumFrequency : frequency);
                            const tangent = Math.tan(PI * frequency / sampleRate);
                            const rawCoefficient = (tangent - 1) / (tangent + 1);
                            const coefficient = rawCoefficient < -0.999 ? -0.999 :
                                (rawCoefficient > 0.999 ? 0.999 : rawCoefficient);
                            const windowSample = Math.sin(PI * sweepPosition);
                            const weight = windowSample * windowSample;
                            const base = (channel * BARBER_VOICES + voice) * MAX_STAGES;
                            let voiceWet = input;
                            for (let stage = 0; stage < stages; ++stage) {
                                const memory = state[base + stage];
                                const output = coefficient * voiceWet + memory;
                                let nextMemory = voiceWet - coefficient * output;
                                if (nextMemory > -1e-30 && nextMemory < 1e-30) nextMemory = 0;
                                state[base + stage] = nextMemory;
                                voiceWet = output;
                            }
                            wet += voiceWet * weight;
                            weightSum += weight;
                        }
                        wet /= weightSum < 1e-9 ? 1e-9 : weightSum;
                    }
                    if (!Number.isFinite(wet)) wet = 0;
                    feedbackState[channel] = wet;
                    data[audioIndex] = dry * (1 - mix * wetGate) + wet * mix * wetGate;
                }

                phase += TWO_PI * smooth[0] / sampleRate;
                if (phase >= TWO_PI) phase -= TWO_PI;
                if (transition !== 0) {
                    ++transitionPosition;
                    if (transitionPosition >= transitionLength) {
                        if (transition === 1) {
                            mode = context.phaserPendingMode;
                            stages = context.phaserPendingStages;
                            direction = context.phaserPendingDirection;
                            state.fill(0);
                            feedbackState.fill(0);
                            transition = 2;
                            transitionPosition = 0;
                        } else {
                            transitionPosition = 0;
                            const directionAffectsNextWet = context.phaserPendingMode === 'Barber-pole' ||
                                mode === 'Barber-pole';
                            const topologyChanged = context.phaserPendingMode !== mode ||
                                context.phaserPendingStages !== stages ||
                                (directionAffectsNextWet &&
                                    context.phaserPendingDirection !== direction);
                            if (topologyChanged) {
                                transition = 1;
                            } else {
                                direction = context.phaserPendingDirection;
                                transition = 0;
                            }
                        }
                    }
                }
            }
            context.phaserPhase = phase;
            context.phaserMode = mode;
            context.phaserStages = stages;
            context.phaserDirection = direction;
            context.phaserTransition = transition;
            context.phaserTransitionPosition = transitionPosition;
            return data;
        `);
    }

    getParameters() {
        return { ...super.getParameters(), md: this.md, rt: this.rt, cf: this.cf, rg: this.rg,
            st: this.st, fb: this.fb, sp: this.sp, dr: this.dr, mx: this.mx };
    }

    setParameters(params) {
        super._setValidatedParameters(params);
        const stages = params.st === undefined ? this.st :
            Math.round(this.parseFiniteNumber(params.st, 2, 12, this.st) / 2) * 2;
        this.md = params.md === undefined ? this.md : this.isAllowedEnum(params.md, PHASER_MODES, this.md);
        this.rt = params.rt === undefined ? this.rt : this.parseFiniteNumber(params.rt, 0.05, 10, this.rt);
        this.cf = params.cf === undefined ? this.cf : this.parseFiniteNumber(params.cf, 80, 8000, this.cf);
        this.rg = params.rg === undefined ? this.rg : this.parseFiniteNumber(params.rg, 0, 6, this.rg);
        this.st = Math.max(2, Math.min(12, stages));
        this.fb = params.fb === undefined ? this.fb : this.parseFiniteNumber(params.fb, -90, 90, this.fb);
        this.sp = params.sp === undefined ? this.sp : this.parseFiniteNumber(params.sp, 0, 180, this.sp);
        this.dr = params.dr === undefined ? this.dr : this.isAllowedEnum(params.dr, PHASER_DIRECTIONS, this.dr);
        this.mx = params.mx === undefined ? this.mx : this.parseFiniteNumber(params.mx, 0, 100, this.mx);
        this._syncVisibility();
        this._syncUI();
        this.updateParameters();
    }

    _syncControl(row, value) {
        if (!row) return;
        const select = row.querySelector('select');
        if (select) {
            select.value = value;
            return;
        }
        const range = row.querySelector('input[type="range"]');
        const number = row.querySelector('input[type="number"]');
        if (number) number.value = String(value);
        if (range?.dataset.rangeFineMin) {
            const minimum = Number(range.dataset.rangeFineMin);
            const maximum = Number(range.dataset.rangeFineMax);
            range.value = String((Math.log10(value) - Math.log10(minimum)) /
                (Math.log10(maximum) - Math.log10(minimum)) * 100);
        } else if (range) {
            range.value = String(value);
        }
        if (range) window.uiManager?.refreshRangeFillStyling?.(range);
        for (const radio of row.querySelectorAll('input[type="radio"]')) {
            radio.checked = radio.value === value;
        }
    }

    _syncUI() {
        if (!this._uiControls) return;
        for (const key of ['md', 'rt', 'cf', 'rg', 'st', 'fb', 'sp', 'dr', 'mx']) {
            this._syncControl(this._uiControls[key], this[key]);
        }
    }

    _syncVisibility() {
        if (this._directionRow) this._directionRow.hidden = this.md !== 'Barber-pole';
        if (!this._uiControls?.sp) return;
        const stereoPhaseDisabled = !this._channelSelectionHasPair();
        const stereoPhaseRange = this._uiControls.sp.querySelector('input[type="range"]');
        const stereoPhaseValue = this._uiControls.sp.querySelector('input[type="number"]');
        if (stereoPhaseRange) stereoPhaseRange.disabled = stereoPhaseDisabled;
        if (stereoPhaseValue) stereoPhaseValue.disabled = stereoPhaseDisabled;
    }

    _channelSelectionHasPair() {
        return this.channel === null || this.channel === 'A' ||
            ['34', '56', '78', '910', '1112', '1314', '1516'].includes(this.channel);
    }

    onChannelSelectionChanged() {
        this._syncVisibility();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'phaser-plugin-ui plugin-parameter-ui';
        this._uiControls = {};
        this._uiControls.md = this.createRadioGroup('Mode', PHASER_MODES, this.md,
            value => this.setParameters({ md: value }), 'md');
        this._uiControls.rt = this.createLogarithmicParameterControl('Rate', 0.05, 10, 0.01, this.rt,
            value => this.setParameters({ rt: value }), 'Hz', 'rt');
        this._uiControls.cf = this.createLogarithmicParameterControl('Center Frequency', 80, 8000, 1, this.cf,
            value => this.setParameters({ cf: value }), 'Hz', 'cf');
        this._uiControls.rg = this.createParameterControl('Range', 0, 6, 0.1, this.rg,
            value => this.setParameters({ rg: value }), 'octaves', 'rg');
        this._uiControls.st = this.createParameterControl('Stages', 2, 12, 2, this.st,
            value => this.setParameters({ st: value }), '', 'st');
        this._uiControls.fb = this.createParameterControl('Feedback', -90, 90, 1, this.fb,
            value => this.setParameters({ fb: value }), '%', 'fb');
        this._uiControls.sp = this.createParameterControl('Stereo Phase', 0, 180, 1, this.sp,
            value => this.setParameters({ sp: value }), 'degrees', 'sp');
        this._uiControls.dr = this.createRadioGroup('Direction', PHASER_DIRECTIONS, this.dr,
            value => this.setParameters({ dr: value }), 'dr');
        this._uiControls.mx = this.createParameterControl('Mix', 0, 100, 1, this.mx,
            value => this.setParameters({ mx: value }), '%', 'mx');
        for (const key of ['md', 'rt', 'cf', 'rg', 'st', 'fb', 'sp', 'dr', 'mx']) {
            container.appendChild(this._uiControls[key]);
        }
        this._directionRow = this._uiControls.dr;
        this._syncVisibility();
        this._syncUI();
        return container;
    }
}

window.PhaserPlugin = PhaserPlugin;
