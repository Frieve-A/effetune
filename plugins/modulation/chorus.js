const CHORUS_MODES = Object.freeze(['Chorus', 'Stereo Chorus', 'Ensemble', 'Flanger', 'Vibrato']);
const CHORUS_STYLES = Object.freeze({
    'Classic Chorus': Object.freeze({ md: 'Chorus', rt: 0.8, dl: 12, dp: 3, vc: 3, ss: 60, fb: 0, mx: 45 }),
    'Stereo Chorus': Object.freeze({ md: 'Stereo Chorus', rt: 0.65, dl: 15, dp: 4, vc: 2, ss: 80, fb: 0, mx: 50 }),
    Ensemble: Object.freeze({ md: 'Ensemble', rt: 0.45, dl: 20, dp: 6, vc: 6, ss: 100, fb: 0, mx: 60 }),
    Flanger: Object.freeze({ md: 'Flanger', rt: 0.35, dl: 2.5, dp: 2, vc: 1, ss: 35, fb: 45, mx: 50 }),
    'Jet Flanger': Object.freeze({ md: 'Flanger', rt: 0.18, dl: 1.5, dp: 1.4, vc: 1, ss: 70, fb: -75, mx: 55 }),
    Vibrato: Object.freeze({ md: 'Vibrato', rt: 4.5, dl: 8, dp: 5, vc: 1, ss: 50, fb: 0, mx: 100 })
});

class ChorusPlugin extends PluginBase {
    static searchAliases = Object.freeze(['Stereo Chorus', 'Ensemble', 'Flanger', 'Vibrato']);
    static executionCapabilities = Object.freeze({
        jsFallbackCapacity: Object.freeze({
            maxJsFallbackSampleChannels: 96000
        })
    });
    static factoryStyles = CHORUS_STYLES;

    constructor() {
        super('Chorus', 'Adds moving delayed voices for chorus, ensemble, flanging, or vibrato');
        this.md = 'Chorus';
        this.rt = 0.8;
        this.dl = 12;
        this.dp = 3;
        this.vc = 3;
        this.ss = 60;
        this.fb = 0;
        this.mx = 45;
        this.style = 'Classic Chorus';
        this._modeRows = {};
        this._uiControls = null;
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            const TWO_PI = 6.283185307179586;
            const MAX_CHANNELS = 8;
            const MAX_VOICES = 6;
            const sampleRate = parameters.sampleRate;
            const blockSize = parameters.blockSize;
            const channelCount = parameters.channelCount;
            if (!(sampleRate > 0) || channelCount < 1 || channelCount > MAX_CHANNELS || blockSize < 1) return data;

            const bufferSize = Math.ceil(sampleRate * 0.052) + 4;
            if (!context.chorusBuffers || context.chorusBufferSize !== bufferSize) {
                context.chorusBuffers = new Float32Array(MAX_CHANNELS * bufferSize);
                context.chorusFeedback = new Float64Array(MAX_CHANNELS);
                context.chorusBufferSize = bufferSize;
                context.chorusPosition = 0;
                context.chorusPhase = 0;
                context.chorusVoicePhases = new Float64Array(MAX_VOICES);
                context.chorusChannels = channelCount;
                context.chorusMode = parameters.md;
                const initialVoices = Math.round(parameters.vc);
                context.chorusVoices = initialVoices < 1 ? 1 :
                    (initialVoices > MAX_VOICES ? MAX_VOICES : initialVoices);
                context.chorusPendingMode = context.chorusMode;
                context.chorusPendingVoices = context.chorusVoices;
                context.chorusTransition = 0;
                context.chorusTransitionPosition = 0;
                context.chorusSmoothed = new Float64Array([parameters.rt, parameters.dl,
                    parameters.dp < parameters.dl ? parameters.dp : parameters.dl,
                    parameters.ss, parameters.fb, parameters.mx]);
                context.chorusTargets = new Float64Array(6);
            } else if (context.chorusChannels !== channelCount) {
                context.chorusBuffers.fill(0);
                context.chorusFeedback.fill(0);
                context.chorusPosition = 0;
                context.chorusPhase = 0;
                context.chorusVoicePhases.fill(0);
                context.chorusChannels = channelCount;
            }

            const requestedMode = parameters.md;
            const roundedVoices = Math.round(parameters.vc);
            const requestedVoices = roundedVoices < 1 ? 1 :
                (roundedVoices > MAX_VOICES ? MAX_VOICES : roundedVoices);
            const voicesAffectWet = requestedMode === 'Chorus' || requestedMode === 'Ensemble' ||
                context.chorusMode === 'Chorus' || context.chorusMode === 'Ensemble';
            if ((requestedMode !== context.chorusMode ||
                (voicesAffectWet && requestedVoices !== context.chorusVoices)) &&
                context.chorusTransition === 0) {
                context.chorusPendingMode = requestedMode;
                context.chorusPendingVoices = requestedVoices;
                context.chorusTransition = 1;
                context.chorusTransitionPosition = 0;
            } else if (context.chorusTransition !== 0) {
                context.chorusPendingMode = requestedMode;
                context.chorusPendingVoices = requestedVoices;
            } else {
                context.chorusVoices = requestedVoices;
            }

            const smooth = context.chorusSmoothed;
            const targets = context.chorusTargets;
            targets[0] = parameters.rt;
            targets[1] = parameters.dl;
            targets[2] = parameters.dp < parameters.dl ? parameters.dp : parameters.dl;
            targets[3] = parameters.ss;
            targets[4] = parameters.fb;
            targets[5] = parameters.mx;
            const smoothing = 1 - Math.exp(-1 / (sampleRate * 0.005));
            const requestedTransitionLength = Math.ceil(sampleRate * 0.005);
            const transitionLength = requestedTransitionLength < 1 ? 1 : requestedTransitionLength;
            const buffers = context.chorusBuffers;
            const feedbackState = context.chorusFeedback;
            let position = context.chorusPosition;
            let phase = context.chorusPhase;
            const voicePhases = context.chorusVoicePhases;

            for (let frame = 0; frame < blockSize; ++frame) {
                for (let index = 0; index < smooth.length; ++index) {
                    smooth[index] += (targets[index] - smooth[index]) * smoothing;
                }
                const mode = context.chorusMode;
                const voiceCount = mode === 'Ensemble' ? context.chorusVoices :
                    (mode === 'Chorus' ? context.chorusVoices : (mode === 'Stereo Chorus' ? 2 : 1));
                const spread = mode === 'Chorus' ? 0 : smooth[3] * 0.01;
                const requestedFeedback = smooth[4] * 0.01;
                const feedback = mode === 'Flanger' ?
                    (requestedFeedback < -0.75 ? -0.75 :
                        (requestedFeedback > 0.75 ? 0.75 : requestedFeedback)) : 0;
                const mix = mode === 'Vibrato' ? 1 : smooth[5] * 0.01;
                let wetGate = 1;
                if (context.chorusTransition === 1) {
                    wetGate = 1 - context.chorusTransitionPosition / transitionLength;
                } else if (context.chorusTransition === 2) {
                    wetGate = context.chorusTransitionPosition / transitionLength;
                }

                for (let channel = 0; channel < channelCount; ++channel) {
                    const audioIndex = channel * blockSize + frame;
                    const dry = data[audioIndex];
                    const bufferOffset = channel * bufferSize;
                    const write = dry + feedbackState[channel] * feedback;
                    buffers[bufferOffset + position] = Number.isFinite(write) ? write : 0;
                    let wet = 0;
                    const pairSide = (channel & 1) === 1 ? 1 : 0;
                    for (let voice = 0; voice < voiceCount; ++voice) {
                        const voiceOffset = TWO_PI * voice / voiceCount;
                        const stereoOffset = pairSide * spread * Math.PI * 0.5;
                        const lfoPhase = mode === 'Ensemble' ? voicePhases[voice] : phase;
                        const lfo = Math.sin(lfoPhase + voiceOffset + stereoOffset);
                        const requestedDelayMs = smooth[1] + smooth[2] * lfo;
                        const delayMs = requestedDelayMs < 0.05 ? 0.05 : requestedDelayMs;
                        const requestedDelaySamples = delayMs * sampleRate * 0.001;
                        const delaySamples = requestedDelaySamples > bufferSize - 3 ?
                            bufferSize - 3 : requestedDelaySamples;
                        let read = position - delaySamples;
                        while (read < 0) read += bufferSize;
                        while (read >= bufferSize) read -= bufferSize;
                        const index1 = Math.floor(read);
                        const fraction = read - index1;
                        const index0 = index1 === 0 ? bufferSize - 1 : index1 - 1;
                        const index2 = index1 + 1 === bufferSize ? 0 : index1 + 1;
                        const index3 = index2 + 1 === bufferSize ? 0 : index2 + 1;
                        const y0 = buffers[bufferOffset + index0];
                        const y1 = buffers[bufferOffset + index1];
                        const y2 = buffers[bufferOffset + index2];
                        const y3 = buffers[bufferOffset + index3];
                        const c1 = 0.5 * (y2 - y0);
                        const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
                        const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
                        wet += ((c3 * fraction + c2) * fraction + c1) * fraction + y1;
                    }
                    wet /= voiceCount;
                    if (!Number.isFinite(wet) || (wet > -1e-30 && wet < 1e-30)) wet = 0;
                    feedbackState[channel] = wet;
                    data[audioIndex] = dry * (1 - mix * wetGate) + wet * mix * wetGate;
                }

                phase += TWO_PI * smooth[0] / sampleRate;
                if (phase >= TWO_PI) phase -= TWO_PI;
                if (mode === 'Ensemble') {
                    const voiceCenter = (voiceCount - 1) * 0.5;
                    const phaseStep = TWO_PI * smooth[0] / sampleRate;
                    for (let voice = 0; voice < voiceCount; ++voice) {
                        voicePhases[voice] += phaseStep * (1 + (voice - voiceCenter) * 0.03);
                        if (voicePhases[voice] >= TWO_PI) voicePhases[voice] -= TWO_PI;
                    }
                }
                ++position;
                if (position >= bufferSize) position = 0;

                if (context.chorusTransition !== 0) {
                    ++context.chorusTransitionPosition;
                    if (context.chorusTransitionPosition >= transitionLength) {
                        if (context.chorusTransition === 1) {
                            const wasFlanger = context.chorusMode === 'Flanger';
                            context.chorusMode = context.chorusPendingMode;
                            context.chorusVoices = context.chorusPendingVoices;
                            if (context.chorusMode === 'Ensemble') voicePhases.fill(phase);
                            if (wasFlanger || context.chorusMode === 'Flanger') feedbackState.fill(0);
                            context.chorusTransition = 2;
                            context.chorusTransitionPosition = 0;
                        } else {
                            context.chorusTransitionPosition = 0;
                            const voicesAffectNextWet = context.chorusPendingMode === 'Chorus' ||
                                context.chorusPendingMode === 'Ensemble' ||
                                context.chorusMode === 'Chorus' || context.chorusMode === 'Ensemble';
                            const topologyChanged = context.chorusPendingMode !== context.chorusMode ||
                                (voicesAffectNextWet &&
                                    context.chorusPendingVoices !== context.chorusVoices);
                            if (topologyChanged) {
                                context.chorusTransition = 1;
                            } else {
                                context.chorusVoices = context.chorusPendingVoices;
                                context.chorusTransition = 0;
                            }
                        }
                    }
                }
            }
            context.chorusPosition = position;
            context.chorusPhase = phase;
            return data;
        `);
    }

    getParameters() {
        return { ...super.getParameters(), md: this.md, rt: this.rt, dl: this.dl, dp: this.dp,
            vc: this.vc, ss: this.ss, fb: this.fb, mx: this.mx };
    }

    setParameters(params) {
        super._setValidatedParameters(params);
        const next = {
            md: params.md === undefined ? this.md : this.isAllowedEnum(params.md, CHORUS_MODES, this.md),
            rt: params.rt === undefined ? this.rt : this.parseFiniteNumber(params.rt, 0.05, 10, this.rt),
            dl: params.dl === undefined ? this.dl : this.parseFiniteNumber(params.dl, 0.5, 30, this.dl),
            dp: params.dp === undefined ? this.dp : this.parseFiniteNumber(params.dp, 0, 20, this.dp),
            vc: params.vc === undefined ? this.vc : Math.round(this.parseFiniteNumber(params.vc, 1, 6, this.vc)),
            ss: params.ss === undefined ? this.ss : this.parseFiniteNumber(params.ss, 0, 100, this.ss),
            fb: params.fb === undefined ? this.fb : this.parseFiniteNumber(params.fb, -75, 75, this.fb),
            mx: params.mx === undefined ? this.mx : this.parseFiniteNumber(params.mx, 0, 100, this.mx)
        };
        next.dp = Math.min(next.dp, next.dl);
        Object.assign(this, next);
        if (!params._styleApplication && Object.keys(params).some(key => ['md', 'rt', 'dl', 'dp', 'vc', 'ss', 'fb', 'mx'].includes(key))) {
            this.style = 'Custom';
        }
        this._syncVisibility();
        this._syncUI();
        this.updateParameters();
    }

    applyStyle(style) {
        if (style === 'Custom') {
            this.style = 'Custom';
            this._syncUI();
            return;
        }
        const values = CHORUS_STYLES[style];
        if (!values) return;
        this.setParameters({ ...values, _styleApplication: true });
        this.style = style;
        this._syncUI();
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
        for (const radio of row.querySelectorAll('input[type="radio"]')) {
            radio.checked = radio.value === value;
        }
    }

    _syncUI() {
        if (!this._uiControls) return;
        this._syncControl(this._uiControls.style, this.style);
        for (const key of ['md', 'rt', 'dl', 'dp', 'vc', 'ss', 'fb', 'mx']) {
            this._syncControl(this._uiControls[key], this[key]);
        }
    }

    _syncVisibility() {
        if (this._modeRows.voices) this._modeRows.voices.hidden = !['Chorus', 'Ensemble'].includes(this.md);
        if (this._modeRows.spread) {
            this._modeRows.spread.hidden = this.md === 'Chorus' || !this._channelSelectionHasPair();
        }
        if (this._modeRows.feedback) this._modeRows.feedback.hidden = this.md !== 'Flanger';
        if (this._modeRows.mix) this._modeRows.mix.hidden = this.md === 'Vibrato';
    }

    _channelSelectionHasPair() {
        return this.channel === null || this.channel === 'A' ||
            ['34', '56', '78'].includes(this.channel);
    }

    onChannelSelectionChanged() {
        this._syncVisibility();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'chorus-plugin-ui plugin-parameter-ui';
        this._uiControls = {};
        this._uiControls.style = this.createSelectControl('Style', [...Object.keys(CHORUS_STYLES), 'Custom'], this.style,
            value => this.applyStyle(value));
        this._uiControls.md = this.createRadioGroup('Mode', CHORUS_MODES, this.md,
            value => this.setParameters({ md: value }));
        this._uiControls.rt = this.createLogarithmicParameterControl('Rate', 0.05, 10, 0.01, this.rt,
            value => this.setParameters({ rt: value }), 'Hz');
        this._uiControls.dl = this.createParameterControl('Delay', 0.5, 30, 0.1, this.dl,
            value => this.setParameters({ dl: value }), 'ms');
        this._uiControls.dp = this.createParameterControl('Depth', 0, 20, 0.1, this.dp,
            value => this.setParameters({ dp: value }), 'ms');
        this._uiControls.vc = this.createParameterControl('Voices', 1, 6, 1, this.vc,
            value => this.setParameters({ vc: value }));
        this._uiControls.ss = this.createParameterControl('Stereo Spread', 0, 100, 1, this.ss,
            value => this.setParameters({ ss: value }), '%');
        this._uiControls.fb = this.createParameterControl('Feedback', -75, 75, 1, this.fb,
            value => this.setParameters({ fb: value }), '%');
        this._uiControls.mx = this.createParameterControl('Mix', 0, 100, 1, this.mx,
            value => this.setParameters({ mx: value }), '%');
        for (const key of ['style', 'md', 'rt', 'dl', 'dp', 'vc', 'ss', 'fb', 'mx']) {
            container.appendChild(this._uiControls[key]);
        }
        this._modeRows.voices = this._uiControls.vc;
        this._modeRows.spread = this._uiControls.ss;
        this._modeRows.feedback = this._uiControls.fb;
        this._modeRows.mix = this._uiControls.mx;
        this._syncVisibility();
        this._syncUI();
        return container;
    }
}

window.ChorusPlugin = ChorusPlugin;
