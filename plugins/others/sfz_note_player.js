class SFZNotePlayerPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor() {
        super('SFZ Note Player', 'Plays an imported SFZ instrument from detected notes');
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
        this.temporalCapability = 'reset-on-resume';
        this._generation = 0;
        this._pending = null;
        this._importing = false;
        this._name = '';
        this._missing = false;
        this._error = '';
        this._errorVisible = false;
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

    _t(key, fallback, params = {}) {
        const translated = window.uiManager?.t?.(key, params);
        const text = translated && translated !== key ? translated : fallback;
        return Object.entries(params).reduce((value, [name, replacement]) =>
            value.replaceAll(`{${name}}`, String(replacement)), text);
    }

    getParameters() {
        return { ...super.getParameters(), sf: this.sf, th: this.th, rd: this.rd, nh: this.nh, vf: this.vf,
            vc: this.vc, mn: this.mn, mx: this.mx, pl: this.pl, dm: this.dm, wm: this.wm,
            os: this.os, ss: this.ss, lo: this.lo, md: this.md, hi: this.hi, tm: this.tm, og: this.og, cl: this.cl };
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
        if (this.mn > this.mx) this.mx = this.mn;
        if (this.vc < this.vf + 1) this.vc = this.vf + 1;
        if (typeof params.sf === 'string') {
            const next = /^[a-f0-9]{24}$/.test(params.sf) ? params.sf : '';
            if (next !== this.sf || this._importing) {
                this.sf = next;
                this._name = '';
                if (this.hasLocalAudio !== false) this._loadBank();
            } else {
                this._resetLoadNotice();
                this._errorVisible = false;
                this._renderStatus();
            }
        }
        this.updateParameters();
        this.ensureDspTelemetrySubscription();
        if (!this.enabled) this._clearVoiceDisplay();
        this.drawGraph();
    }

    get externalAssetInfo() {
        if (!this.sf && !this._pending) return null;
        return { kind: 'SFZ', ids: this.sf ? [this.sf] : [],
            names: this.sf ? [this._name || 'SFZ'] : [], missing: this._missing,
            pending: Boolean(this._pending), assetSignature: this.sf,
            protectedIds: this.sf ? [this.sf] : [] };
    }

    get offlineDspAssetRequired() { return Boolean(this.sf || this._pending); }
    get offlineDspAssetErrorMessageKey() { return 'sfzNotePlayer.error.prepare'; }

    async resolveOfflineDspAssetRequirement() {
        while (this._pending) await this._pending;
        return { required: this.offlineDspAssetRequired };
    }

    async _getLibraryService() {
        if (window.sfzLibraryService) return window.sfzLibraryService;
        const module = await import('../../js/sfz/service.js');
        return module.getDefaultSfzLibraryService();
    }

    async _decodeAudioData(bytes, sampleRateHint) {
        const engineContext = window.workletNode?.context || window.audioContext ||
            window.uiManager?.audioManager?.audioContext;
        const rate = sampleRateHint || engineContext?.sampleRate || 48000;
        const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Context) throw new Error('Audio decoding is unavailable');
        const context = new Context(2, 1, rate);
        const buffer = await context.decodeAudioData(bytes.slice(0));
        if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || buffer.length < 1) {
            throw new Error('Unsupported SFZ sample channel layout');
        }
        return { sampleRate: buffer.sampleRate, channels: Array.from(
            { length: buffer.numberOfChannels }, (_, channel) =>
                new Float32Array(buffer.getChannelData(channel))) };
    }

    _loadBank(generation = ++this._generation, manual = false) {
        this._stopPreview();
        this._resetLoadNotice();
        this._initialAssetLoad = manual;
        this._importing = false;
        const id = this.sf;
        this.clearWasmAsset(0);
        this._clearVoiceDisplay();
        this._missing = false;
        this._error = '';
        this._errorVisible = false;
        if (!id) {
            this._initialAssetLoad = false;
            this._pending = null;
            this._renderStatus();
            return;
        }
        const pending = (async () => {
            try {
                const service = await this._getLibraryService();
                const prepared = await service.prepare(id, {
                    decode: (bytes, rate) => this._decodeAudioData(bytes, rate)
                });
                if (generation !== this._generation) return;
                this._missing = !prepared;
                if (prepared) {
                    this._name = prepared.name;
                    this._loadWarnings = this._warningMessage(prepared.warnings);
                    this.setWasmAsset(0, { ...prepared.descriptor, externalAssetSignature: id });
                } else {
                    this._errorVisible = Boolean(this._initialAssetLoad);
                    this._finishInitialAssetLoad(false);
                }
            } catch (error) {
                if (generation === this._generation) {
                    this._showError(error, Boolean(this._initialAssetLoad));
                    if (this._error) this._finishInitialAssetLoad(false);
                }
            } finally {
                if (generation === this._generation) {
                    this._pending = null;
                    this._renderStatus();
                }
            }
        })();
        this._pending = pending;
        this._renderStatus();
        return pending;
    }

    _showError(error, visible = true) {
        if (error?.code === 'cancelled' || error?.name === 'AbortError') return;
        console.error('SFZ Note Player could not load the bank:', error);
        this._error = error?.code === 'too-large' ? 'tooLarge' :
            (error?.code === 'no-regions' ? 'noRegions' :
                (error?.code === 'storage' ? 'storage' : 'prepare'));
        this._errorVisible = visible;
        this._renderStatus();
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (slot !== 0 || (this._isCurrentWasmAssetOperation &&
            !this._isCurrentWasmAssetOperation(slot, operationRevision))) return;
        console.error('SFZ Note Player asset rejected:', reason);
        this._error = reason === 'module-budget' || reason === 'capacity' ? 'tooLarge' : 'prepare';
        this._errorVisible = Boolean(this._initialAssetLoad);
        this._renderStatus();
        this._finishInitialAssetLoad(false);
    }

    onWasmAssetState(slot, state, operationRevision) {
        if (slot !== 0 || !this._isCurrentWasmAssetOperation(slot, operationRevision)) return;
        const phase = state & 0xff;
        if (phase === 4) {
            console.error('SFZ Note Player asset preparation failed:', state);
            this._error = 'prepare';
            this._errorVisible = Boolean(this._initialAssetLoad);
        }
        if (phase === 3) this._error = '';
        this._renderStatus();
        if (phase === 3 || phase === 4) this._finishInitialAssetLoad(phase === 3);
    }

    _finishInitialAssetLoad(success) {
        if (!this._initialAssetLoad) return;
        this._initialAssetLoad = false;
        this._queueLoadNotice(success ? this._loadWarnings : this._errorMessage());
        this._loadWarnings = '';
    }

    _errorMessage() {
        const errors = {
            tooLarge: 'This SFZ exceeds the size limit. Increase SFZ size limit in Config → General, or choose a smaller SFZ.',
            noRegions: 'No playable samples were found. Choose another SFZ.',
            storage: 'The SFZ library could not be accessed. Check file permissions and available storage space, then try again.',
            prepare: 'The SFZ could not be loaded. Check that its sample files are available, or choose another SFZ.'
        };
        return this._error
            ? this._t(`sfzNotePlayer.error.${this._error}`, errors[this._error])
            : this._missing ? this._t('sfzNotePlayer.error.missing',
                'The selected SFZ could not be found. Choose it again or choose another SFZ.') : '';
    }

    _warningMessage(warnings = []) {
        const messages = {
            'loop-points-ignored': 'Unused loop settings were adjusted so this SFZ could be loaded.',
            'invalid-regions': 'Some sounds had invalid settings and were skipped.',
            'missing-samples': 'Some sample files could not be found. The available sounds were loaded.',
            'envelope-times-adjusted': 'Some sound fade times were invalid and were adjusted so this SFZ could be loaded.',
            'reduced-bank': 'A smaller selection of sounds was loaded to fit the size limit while keeping every note. Increase SFZ size limit for more detail.'
        };
        return [...new Set(warnings.map(warning => warning.code))]
            .filter(code => messages[code])
            .map(code => this._t(`sfzNotePlayer.warning.${code}`, messages[code])).join('\n\n');
    }

    _resetLoadNotice() {
        this._closeLoadNotice?.();
        this._loadNotice = '';
        this._loadNoticeShown = false;
        this._initialAssetLoad = false;
        this._loadWarnings = '';
    }

    _queueLoadNotice(message) {
        if (!message || this._loadNotice) return;
        this._loadNotice = message;
        this._showLoadNotice();
    }

    _showLoadNotice() {
        if (!this._status || !this._loadNotice || this._loadNoticeShown) return;
        this._loadNoticeShown = true;
        const previousFocus = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay sfz-load-notice-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'sfz-load-notice';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', 'SFZ Note Player');
        const title = document.createElement('h2');
        title.textContent = 'SFZ Note Player';
        const message = document.createElement('p');
        message.textContent = this._loadNotice;
        const buttons = document.createElement('div');
        buttons.className = 'dialog-buttons';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = this._t('dialog.config.close', 'Close');
        const onKey = event => {
            if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') this._closeLoadNotice?.();
                else close.focus?.();
            }
        };
        this._closeLoadNotice = () => {
            document.removeEventListener('keydown', onKey, true);
            overlay.parentNode?.removeChild(overlay);
            this._closeLoadNotice = null;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
        close.addEventListener('click', () => this._closeLoadNotice?.());
        buttons.appendChild(close);
        dialog.append(title, message, buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKey, true);
        close.focus?.();
    }

    _renderStatus() {
        if (!this._status) return;
        this._status.textContent = this._errorVisible ? this._errorMessage() : '';
        this._status.hidden = !this._status.textContent;
        this._status.dataset.state = this._status.hidden ? '' : 'error';
        if (this._selectedBankName) this._selectedBankName.textContent = this.sf
            ? this._name || this._t('sfzNotePlayer.missingBank', 'Missing SFZ') : 'None';
        if (this._clearButton) this._clearButton.disabled = !this.sf || Boolean(this._pending);
    }

    async _refreshBanks(generation) {
        const entries = await (await this._getLibraryService()).list();
        if (!this._selectedBankName || (generation !== undefined && generation !== this._generation)) return;
        this._name = entries.find(entry => entry.id === this.sf)?.name || this._name;
        this._renderStatus();
    }

    async _openLibraryBrowser() {
        if (this._libraryBrowser) {
            this._libraryBrowser.element.querySelector('input[type="search"]')?.focus();
            return;
        }
        const button = this._libraryButton;
        if (!button || button.disabled) return;
        button.disabled = true;
        try {
            const [browser, service] = await Promise.all([
                import('../../js/sfz/browser.js'), this._getLibraryService()
            ]);
            if (button !== this._libraryButton) return;
            this._libraryBrowser = browser.openSfzLibraryBrowser({
                service,
                returnFocus: button,
                decode: (bytes, rate) => this._decodeAudioData(bytes, rate),
                audioManager: window.uiManager?.audioManager,
                onLoad: entry => this._selectBank(async () => entry),
                onClose: () => { this._libraryBrowser = null; }
            });
        } catch (error) {
            if (button === this._libraryButton) this._showError(error);
        } finally {
            button.disabled = false;
        }
    }

    async _selectBank(select) {
        this._resetLoadNotice();
        this._initialAssetLoad = true;
        const generation = ++this._generation;
        this._importing = true;
        this._error = '';
        this._errorVisible = false;
        const isCurrent = () => generation === this._generation;
        const pending = Promise.resolve().then(async () => {
            try {
                if (!isCurrent()) return;
                const service = await this._getLibraryService();
                if (!isCurrent()) return;
                const entry = await select(service, isCurrent);
                if (!isCurrent() || !entry) return;
                this.sf = entry.id;
                this._name = entry.name || '';
                const preparation = this._loadBank(generation, true);
                this.updateParameters();
                await preparation;
                if (generation !== this._generation) return;
                await this._refreshBanks(generation);
            } catch (error) {
                if (generation === this._generation) {
                    this._showError(error, Boolean(this._initialAssetLoad));
                    if (this._error) this._finishInitialAssetLoad(false);
                }
            } finally {
                if (generation === this._generation && this._pending === pending) {
                    this._pending = null;
                    this._importing = false;
                    this._initialAssetLoad = false;
                    this._renderStatus();
                }
            }
        });
        this._pending = pending;
        this._renderStatus();
        return pending;
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
        if (this.audioHostActive === false || !window.workletNode) return;
        const message = { type: 'updatePlugin', plugin: this.getWorkletPluginData() };
        const audio = window.pipelineManager?.audioManager || window.audioManager;
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
                if (event.defaultPrevented || event.button !== 0 || this._previewPointerId !== null ||
                    !this.enabled || this._sectionEnabled === false || this.hasLocalAudio === false ||
                    this.audioHostActive === false || !window.workletNode || !this.getWasmAssets().has(0)) return;
                event.preventDefault();
                this._previewPointerId = event.pointerId;
                canvas.setPointerCapture(event.pointerId);
                const audio = window.pipelineManager?.audioManager || window.audioManager;
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
        canvas?.setAttribute('aria-label', `Sounding SFZ notes and decaying velocity bars. ${voiceText}`);
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
        label.textContent = 'SFZ:';
        const button = (text, action) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = text;
            element.addEventListener('click', action);
            return element;
        };
        this._libraryButton = button('SFZ Library…', () => this._openLibraryBrowser());
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
        controls.append(bankRow, this._status);
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
        ]) controls.appendChild(this.createParameterControl(labelText, min, max, step, this[key],
            value => this.setParameters({ [key]: value }), unit, key));
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
        super.cleanup();
    }
}

window.SFZNotePlayerPlugin = SFZNotePlayerPlugin;
