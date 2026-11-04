class SFZNotePlayerPlugin extends SFZInstrumentPlugin {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor() {
        super('SoundFont Note Player', 'Plays detected notes with SF2 SoundFonts and SFZ instruments');
        this.sf = '';
        this.th = 0.75;
        this.rd = 40;
        this.nh = 50;
        this.vf = -60;
        this.vc = -10;
        this.mn = 28;
        this.mx = 91;
        this.pl = 32;
        this.dm = 20;
        this.wm = 100;
        this.os = 0;
        this.ss = 0;
        this.lo = this.md = this.hi = true;
        this.tm = 0;
        this.og = 0;
        this.cl = 'Normal';
        this.dt = 'Classic';
        this.temporalCapability = 'reset-on-resume';
        this._voiceCounts = new Uint16Array(128);
        this._velocities = new Float32Array(128);
        this._activeVoices = 0;
        this._voiceFrameTime = null;
        this._previewMidi = -1;
        this._previewVelocity = 100;
        this._previewPointerId = null;
        this.animationFrameId = null;
        this.isVisible = false;
        this._boundTelemetry = frame => this.handleTelemetry(frame);
        this.registerProcessor('return data;');
    }

    getParameters() {
        return { ...super.getParameters(), sf: this.sf, th: this.th, rd: this.rd, nh: this.nh, vf: this.vf,
            vc: this.vc, mn: this.mn, mx: this.mx, pl: this.pl, dm: this.dm, wm: this.wm,
            os: this.os, ss: this.ss, lo: this.lo, md: this.md, hi: this.hi, tm: this.tm, og: this.og, cl: this.cl,
            dt: this.dt, sp0: this.sp0 };
    }

    getWorkletPluginData(parameters = this.getParameters()) {
        return super.getWorkletPluginData({ ...parameters,
            pm: this._previewMidi, pv: this._previewVelocity });
    }

    setParameters(params = {}) {
        if (params.enabled === false || params.mn !== undefined || params.mx !== undefined) this._stopPreview();
        super._setValidatedParameters(params);
        const ranges = { th: [0.01, 1], rd: [1, 96], nh: [0, 100], vf: [-96, 0], vc: [-60, 24],
            mn: [21, 108], mx: [21, 108], pl: [1, 128], dm: [0, 100], wm: [0, 100],
            os: [-2, 2], ss: [-6, 6], tm: [-100, 100], og: [-60, 12] };
        for (const [key, [min, max]] of Object.entries(ranges)) {
            if (params[key] !== undefined) {
                const value = this.parseFiniteNumber(params[key], min, max, this[key]);
                this[key] = ['mn', 'mx', 'pl', 'os', 'ss'].includes(key) ? Math.round(value) : value;
            }
        }
        for (const key of ['lo', 'md', 'hi']) {
            if (typeof params[key] === 'boolean') this[key] = params[key];
        }
        if (params.cl === 'Normal' || params.cl === 'Rainbow') this.cl = params.cl;
        if (params.dt === 'Classic' || params.dt === 'Event') this.dt = params.dt;
        this._syncDetectionControls();
        if (this.mn > this.mx) this.mx = this.mn;
        if (this.vc < this.vf + 1) this.vc = this.vf + 1;
        if (typeof params.sf === 'string') {
            const next = /^[a-f0-9]{24}$/.test(params.sf) ? params.sf : '';
            if (next !== this.sf || this._importing) {
                if (next !== this.sf) this._clearPresetSelection();
                this.sf = next;
                this._name = '';
                if (this.hasLocalAudio !== false) this._loadBank();
            } else {
                this._resetLoadNotice();
                this._errorVisible = false;
                this._renderStatus();
            }
        }
        if (params.sp0 !== undefined) this.sp0 = Math.round(this.parseFiniteNumber(params.sp0, -1, 8388607, this.sp0));
        this._renderPresetSelection();
        this.updateParameters();
        this.ensureDspTelemetrySubscription();
        if (!this.enabled) this._clearVoiceDisplay();
        this.drawGraph();
    }

    _noteControl(label, key) {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = `${this.id}-sfz-${key}`;
        slider.min = 21;
        slider.max = 108;
        slider.step = 1;
        slider.value = this[key];
        const labelElement = document.createElement('label');
        labelElement.textContent = `${label}:`;
        labelElement.htmlFor = slider.id;
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.readOnly = true;
        valueInput.className = 'sfz-note-value';
        const noteName = midi => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#',
            'G', 'G#', 'A', 'A#', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
        valueInput.value = noteName(this[key]);
        slider.addEventListener('input', event => {
            this.setParameters({ [key]: Number(event.target.value) });
            valueInput.value = noteName(this[key]);
        });
        this._registerUIControl(key, [slider], value => {
            slider.value = value;
            valueInput.value = noteName(value);
            window.uiManager?.refreshRangeFillStyling?.(slider);
        });
        row.append(labelElement, slider, valueInput);
        return row;
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        if (hub === this._telemetryHub && tapId === this._telemetryTapId && this._telemetryUnsubscribe) return;
        this._telemetryUnsubscribe?.();
        this._telemetryUnsubscribe = null;
        this._telemetryHub = null;
        this._telemetryTapId = null;
        if (!hub?.subscribe || !Number.isInteger(tapId) || tapId < 0 || tapId > 0xffffffff) return;
        this._telemetryUnsubscribe = hub.subscribe(tapId, 30, this._boundTelemetry);
        this._telemetryHub = hub;
        this._telemetryTapId = tapId;
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        super.onMessage(message);
    }

    handleTelemetry(frame) {
        if (!this.enabled || this._sectionEnabled === false || frame?.frameType !== 30 ||
            frame.formatVersion !== 1 || frame.payload?.byteLength !== 1028) return;
        const payload = frame.payload;
        const total = payload.getUint16(0, true);
        const limit = payload.getUint16(2, true);
        if (limit < 1 || limit > 128 || total > limit) return;
        let counted = 0;
        for (let midi = 0; midi < 128; midi++) {
            const count = payload.getUint16(4 + midi * 8, true);
            const velocity = payload.getFloat32(8 + midi * 8, true);
            if (count > total || !Number.isFinite(velocity) || velocity < 0 || velocity > 1 ||
                (count === 0 && velocity !== 0)) return;
            counted += count;
        }
        if (counted !== total) return;
        const now = performance.now();
        const elapsed = this._voiceFrameTime === null ? 0 : Math.max(0, now - this._voiceFrameTime) / 1000;
        const decay = Math.exp(-elapsed);
        for (let midi = 0; midi < 128; midi++) {
            const count = payload.getUint16(4 + midi * 8, true);
            this._voiceCounts[midi] = count;
            this._velocities[midi] = count > 0
                ? payload.getFloat32(8 + midi * 8, true)
                : this._velocities[midi] * decay;
        }
        this._activeVoices = total;
        this._voiceFrameTime = now;
        this.renderPowerUiOnce?.(() => this.drawGraph());
    }

    _clearVoiceDisplay() {
        this._voiceCounts.fill(0);
        this._velocities.fill(0);
        this._activeVoices = 0;
        this._voiceFrameTime = null;
        this.drawGraph();
    }

    startAnimation() {
        if (this.animationFrameId !== null || !this.isVisible || !this.canRunAnimation()) return;
        const animate = now => {
            this.drawGraph(now);
            this.animationFrameId = this.requestPowerAnimationFrame(animate);
        };
        animate();
    }

    stopAnimation() {
        if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
        if (!this.enabled || this._sectionEnabled === false) this._stopPreview();
        if (!this.canRunAnimation()) this._clearVoiceDisplay();
    }

    _graphLayout() {
        const { width, height } = this.canvas;
        const axis = window.FrequencyAxis;
        const keys = axis.noteAxisKeys(this.mn, this.mx, width);
        const { gutter, blackDepth } = axis.keyboardDepths(12 * width / (this.mx - this.mn + 1), height);
        return { keys, gutter, blackDepth, edge: height - gutter };
    }

    _previewAt(event) {
        const canvas = this.canvas;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height || !window.FrequencyAxis) return;
        const x = Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width));
        const y = Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height));
        const { keys, gutter, blackDepth, edge } = this._graphLayout();
        const keyboard = y >= edge;
        const key = keyboard ? window.FrequencyAxis.hitKey(keys, x, y - edge, gutter, blackDepth) : null;
        const midi = keyboard ? key?.midi : Math.min(this.mx, this.mn + Math.floor(x / canvas.width * (this.mx - this.mn + 1)));
        if (midi === undefined || midi === this._previewMidi) return;
        this._previewMidi = midi;
        this._previewVelocity = keyboard ? 100 : Math.max(1, Math.round(127 * (1 - y / edge)));
        this._sendPreview();
    }

    _sendPreview() {
        const audio = window.pipelineManager?.audioManager || window.audioManager;
        if (this.audioHostActive === false || (!window.workletNode && !audio?.isAndroid)) return;
        const message = { type: 'updatePlugin', plugin: this.getWorkletPluginData() };
        if (audio?.commitPowerTopologyMutation) {
            audio.commitPowerTopologyMutation(message, { reason: 'sfz-note-preview' });
        } else window.workletNode.port.postMessage(message);
    }

    _stopPreview() {
        const pointerId = this._previewPointerId;
        this._previewPointerId = null;
        if (this._previewMidi !== -1) {
            this._previewMidi = -1;
            this._sendPreview();
        }
        if (pointerId !== null && this.canvas?.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
        this._releasePreviewLease?.();
        this._releasePreviewLease = null;
    }

    _bindPreview() {
        const canvas = this.canvas;
        const stop = () => this._stopPreview();
        const end = event => {
            if (event.pointerId === this._previewPointerId) stop();
        };
        const listeners = {
            pointerdown: event => {
                const audio = window.pipelineManager?.audioManager || window.audioManager;
                const ready = audio?.hasNativePluginAsset?.(this, 0) ??
                    Boolean(window.workletNode && this.getWasmAssets().has(0));
                if (event.defaultPrevented || event.button !== 0 || this._previewPointerId !== null ||
                    !this.enabled || this._sectionEnabled === false || this.hasLocalAudio === false ||
                    this.audioHostActive === false || !ready) return;
                event.preventDefault();
                this._previewPointerId = event.pointerId;
                canvas.setPointerCapture(event.pointerId);
                const power = audio?.powerPolicyController;
                if (power?.started) this._releasePreviewLease = power.acquireLease('sfz-note-preview', { mode: 'force-active' });
                this._previewAt(event);
            },
            pointermove: event => {
                if (event.pointerId !== this._previewPointerId) return;
                event.preventDefault();
                this._previewAt(event);
            },
            pointerup: end,
            pointercancel: end,
            lostpointercapture: end
        };
        const visibility = () => { if (document.hidden) stop(); };
        for (const [type, listener] of Object.entries(listeners)) canvas.addEventListener(type, listener);
        window.addEventListener('blur', stop);
        document.addEventListener('visibilitychange', visibility);
        this._disposePreview = () => {
            stop();
            for (const [type, listener] of Object.entries(listeners)) canvas.removeEventListener(type, listener);
            window.removeEventListener('blur', stop);
            document.removeEventListener('visibilitychange', visibility);
        };
    }

    drawGraph(now) {
        const canvas = this.canvas;
        const voiceValue = `${this._activeVoices} / ${this.pl}`;
        const voiceText = `Voices: ${voiceValue}`;
        canvas?.setAttribute('aria-label', `Sounding notes and decaying velocity bars. ${voiceText}`);
        const context = this.canvasCtx;
        const axis = window.FrequencyAxis;
        const palette = window.ThemePalette;
        if (!canvas || !context || !axis || !palette) return;
        now ??= performance.now();
        const { width, height } = canvas;
        const dpr = this.graphDpr || 1;
        const isNarrow = width / dpr < 500;
        const minimum = this.mn;
        const maximum = this.mx;
        const { keys, gutter, blackDepth, edge } = this._graphLayout();
        const elapsed = this._voiceFrameTime === null ? 0 : Math.max(0, now - this._voiceFrameTime) / 1000;
        const decay = Math.exp(-elapsed);
        const background = palette.get('graph-bg-deep');
        const trace = palette.get('graph-trace');
        const traceRgb = trace.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (!traceRgb || traceRgb.length !== 3) return;
        const light = background.match(/[\d.]+/g)?.slice(0, 3).every(value => Number(value) > 127);
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.strokeStyle = palette.get('graph-grid-subtle');
        context.lineWidth = dpr;
        for (const velocity of [32, 64, 96]) {
            const y = edge * (1 - velocity / 127);
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(width, y);
            context.stroke();
        }
        const whiteKeys = [];
        const blackKeys = [];
        const keyColor = (color, base, press) =>
            `rgb(${color.map(channel => Math.round(base + (channel - base) * press)).join(',')})`; // theme-allow: Theme trace or shared note colors blended with self-painted piano keys.
        for (const key of keys) {
            const { midi, black, start, end, whiteStart, whiteEnd } = key;
            const press = this._voiceCounts[midi] ? 1 : 0;
            const color = this.cl === 'Rainbow' ? window.NoteSpectrogramPlugin?.noteColor(midi) ?? traceRgb : traceRgb;
            if (black) {
                blackKeys.push([start, end, press, keyColor(color, 17, press)]);
            } else {
                context.fillStyle = keyColor(color, light ? 255 : 238, press);
                context.fillRect(whiteStart, edge, whiteEnd - whiteStart, gutter);
                context.strokeStyle = palette.get('graph-label');
                context.lineWidth = dpr;
                context.strokeRect(whiteStart, edge, whiteEnd - whiteStart, gutter);
                whiteKeys.push([whiteStart, whiteEnd, press]);
            }
            const barHeight = edge * this._velocities[midi] * decay;
            if (end > start && barHeight >= .5 * dpr) {
                const barWidth = Math.max(dpr, end - start - dpr);
                context.fillStyle = this.cl === 'Rainbow' ? `rgb(${color.join(',')})` : trace; // theme-allow: Shared semantic note colors or active theme trace.
                context.fillRect(start + dpr / 2, edge - barHeight, barWidth, barHeight);
            }
        }
        axis.shadeKeyboard(context, { along: 'x', edge, length: width, gutter, blackDepth, dpr }, blackKeys, () => {
            for (const [start, end, , color] of blackKeys) {
                context.fillStyle = color;
                context.fillRect(start, edge, end - start, blackDepth);
            }
        }, whiteKeys);
        context.fillStyle = '#111'; // theme-allow: Fixed text color only on self-painted piano keys.
        context.font = `${Math.min(9 * dpr, width / (maximum - minimum + 1))}px Arial`;
        context.textAlign = 'center';
        for (const key of keys) {
            if (key.midi % 12 !== 0) continue;
            context.fillText(`C${key.midi / 12 - 1}`, (key.whiteStart + key.whiteEnd) / 2, height - 3 * dpr);
        }
        context.fillStyle = palette.get('text-primary');
        context.font = `${(isNarrow ? 13 : 14) * dpr}px Arial`;
        context.textAlign = 'center';
        context.textBaseline = 'alphabetic';
        context.save();
        context.translate((isNarrow ? 18 : 20) * dpr, edge / 2);
        context.rotate(-Math.PI / 2);
        context.fillText('Velocity', 0, 0);
        context.restore();
        context.fillStyle = palette.get('graph-label');
        context.font = `${(isNarrow ? 11 : 12) * dpr}px Arial`;
        context.textAlign = 'right';
        for (const velocity of [32, 64, 96]) {
            const y = edge * (1 - velocity / 127) + 6 * dpr;
            if (y < 12 * dpr || y > edge) continue;
            context.fillText(`${velocity}`, (isNarrow ? 46 : 80) * dpr, y);
        }
        context.strokeStyle = background;
        context.lineWidth = 2 * dpr;
        context.lineJoin = 'round';
        const valueX = width - 4 * dpr;
        // Reserve the maximum voice count's digit width so the label stays in place.
        const digits = '8'.repeat(String(this.pl).length);
        const labelX = valueX - context.measureText(` ${digits} / ${this.pl}`).width;
        for (const [text, x] of [['Voices:', labelX], [voiceValue, valueX]]) {
            context.strokeText(text, x, 16 * dpr);
            context.fillText(text, x, 16 * dpr);
        }
    }

    _syncDetectionControls() {
        for (const control of [this._thresholdControl, this._retriggerControl]) {
            for (const input of control?.querySelectorAll('input') ?? []) {
                input.disabled = this.dt === 'Event';
            }
        }
    }

    createUI() {
        this._disposePreview?.();
        this.stopAnimation();
        this.observer?.disconnect();
        this.resizeGraphDisposer?.();
        this.ensureDspTelemetrySubscription();
        const container = document.createElement('div');
        container.className = 'sfz-note-player-plugin-ui plugin-parameter-ui';
        const bankRow = document.createElement('div');
        bankRow.className = 'parameter-row sfz-bank-row local-audio-only';
        const label = document.createElement('label');
        label.textContent = 'SoundFont:';
        const button = (text, action) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = text;
            element.addEventListener('click', action);
            return element;
        };
        this._libraryButton = button('SoundFont Library…', () => this._openLibraryBrowser());
        this._libraryButton.id = `${this.id}-sfz-library`;
        this._selectedBankName = document.createElement('span');
        this._selectedBankName.className = 'sfz-selected-bank';
        this._clearButton = button('Clear', () => this.setParameters({ sf: '' }));
        this._clearButton.className = 'sfz-clear-button';
        bankRow.append(label, this._libraryButton, this._selectedBankName, this._clearButton);
        this._status = document.createElement('div');
        this._status.className = 'sfz-bank-status local-audio-only';
        this._status.setAttribute('role', 'status');
        this._status.setAttribute('aria-live', 'polite');
        const controls = document.createElement('div');
        controls.className = 'sfz-controls analyzer-parameters';
        controls.append(bankRow, this._status, this._createPresetControl());
        controls.appendChild(this.createRadioGroup('Detection', [
            { value: 'Classic', label: 'Classic (Low Latency)' }, { value: 'Event', label: 'Event (+140 ms)' }
        ], this.dt, value => this.setParameters({ dt: value }), 'dt'));
        controls.appendChild(this.createRadioGroup('Color', [
            { value: 'Normal', label: 'Normal' }, { value: 'Rainbow', label: 'Note Colors' }
        ], this.cl, value => this.setParameters({ cl: value }), 'cl'));
        for (const [key, label] of [['hi', 'Highest'], ['md', 'Middle'], ['lo', 'Lowest']]) {
            controls.appendChild(this.createCheckboxControl(label, this[key],
                value => this.setParameters({ [key]: value }), key));
        }
        for (const [key, labelText, min, max, step, unit] of [
            ['th', 'Threshold', 0.01, 1, 0.01, ''],
            ['rd', 'Retrigger Drop', 1, 96, 1, 'dB'],
            ['nh', 'Note Hold', 0, 100, 1, 'ms'],
            ['vf', 'Velocity 1 Level', -96, 0, 0.1, 'dB'],
            ['vc', 'Velocity 127 Level', -60, 24, 0.1, 'dB'],
            ['pl', 'Max Voices', 1, 128, 1, ''],
            ['dm', 'Dry', 0, 100, 1, '%'], ['wm', 'Wet', 0, 100, 1, '%'],
            ['os', 'Octave', -2, 2, 1, ''],
            ['ss', 'Sample Shift', -6, 6, 1, ''],
            ['og', 'Output Gain', -60, 12, 0.1, 'dB'],
            ['tm', 'Timing', -100, 100, 1, 'ms']
        ]) {
            const control = this.createParameterControl(labelText, min, max, step, this[key],
                value => this.setParameters({ [key]: value }), unit, key);
            if (key === 'rd') this._retriggerControl = control;
            if (key === 'th') this._thresholdControl = control;
            controls.appendChild(control);
        }
        this._syncDetectionControls();
        controls.append(this._noteControl('Lowest Note', 'mn'), this._noteControl('Highest Note', 'mx'));
        container.appendChild(controls);
        const display = document.createElement('div');
        display.className = 'sfz-voice-display local-audio-only';
        const graph = this.createResponsiveGraph({
            maxWidth: 1024, aspectRatio: '5 / 1', mobileAspectRatio: '3 / 1',
            onResize: ({ canvas, dpr }) => {
                this.canvas = canvas;
                this.graphDpr = dpr;
                this.canvasCtx = canvas.getContext('2d', { alpha: false });
                this.drawGraph();
            }
        });
        this.canvas = graph.canvas;
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
        this.resizeGraphDisposer = graph.dispose;
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', 'Sounding SFZ notes and decaying velocity bars');
        this._bindPreview();
        display.appendChild(graph.container);
        container.appendChild(display);
        container.appendChild(this._createInstrumentDetails());
        this.drawGraph();
        this.isVisible = typeof IntersectionObserver !== 'function';
        if (typeof IntersectionObserver === 'function') {
            this.observer = new IntersectionObserver(entries => {
                this.isVisible = entries.some(entry => entry.isIntersecting);
                if (this.isVisible) this.startAnimation();
                else {
                    this._stopPreview();
                    this.stopAnimation();
                }
            });
            this.observer.observe(this.canvas);
        } else this.startAnimation();
        if (this.hasLocalAudio !== false) this._refreshBanks().catch(error => this._showError(error, false));
        this._renderStatus();
        this._showLoadNotice();
        return container;
    }

    cleanup() {
        this._disposePreview?.();
        this._disposePreview = null;
        this.stopAnimation();
        this.observer?.disconnect();
        this.observer = null;
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this._telemetryUnsubscribe?.();
        this._telemetryUnsubscribe = this._telemetryHub = this._telemetryTapId = null;
        this.canvas = this.canvasCtx = null;
        this.isVisible = false;
        this._clearVoiceDisplay();
        this._resetLoadNotice();
        ++this._generation;
        this._pending = null;
        this._importing = false;
        this._libraryBrowser?.dispose();
        this._libraryBrowser = null;
        this._libraryButton = this._selectedBankName = this._status = this._clearButton = null;
        this._retriggerControl = null;
        this._thresholdControl = null;
        super.cleanup();
    }
}

window.SFZNotePlayerPlugin = SFZNotePlayerPlugin;
