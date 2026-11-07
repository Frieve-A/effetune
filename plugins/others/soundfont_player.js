const SOUNDFONT_MIDI_CHANNEL_COLORS = Object.freeze(Array.from({ length: 16 }, (_, channel) =>
    `hsl(${channel * 360 / 16}, 60%, 45%)`)); // theme-allow: Stable MIDI channel identity colors.
const SOUNDFONT_METER_FLOOR_DB = -48;

class SoundFontPlayerPlugin extends SFZInstrumentPlugin {
    constructor() {
        super('SoundFont Player', 'Plays MIDI songs through SoundFont and SFZ instruments');
        this.og = 0;
        this.registerProcessor('return data;');
        this.name = 'SoundFont Player';
        this.description = 'Plays MIDI songs through SoundFont and SFZ instruments';
        this.mc = 0;
        this.pl = 64;
        this.sq = 1;
        this.af = true;
        this._presetChannels = 16;
        this._mixerRows = [];
        this._mixerLevelFrame = null;
        this._mixerVisible = true;
        this._midiMeteringDesired = false;
        this._visualizerMidiMeteringConsumers = new Set();
        this._selectedTab = 'mixer';
        this._mixerColorMode = 'Normal';
        this._previewChannel = 0;
        this.temporalCapability = 'reset-on-resume';
    }

    getParameters() {
        return { ...PluginBase.prototype.getParameters.call(this), sf: this.sf,
            mc: this.mc, pl: this.pl, og: this.og, sq: this.sq, af: this.af };
    }

    getWorkletPluginData(parameters = this.getParameters()) {
        return { ...PluginBase.prototype.getWorkletPluginData.call(this,
            { ...parameters, pm: this._previewMidi, pc: this._previewChannel }),
            runtimeAssetErrorRevision: this._isCurrentWasmAssetOperation(0, this._runtimeAssetErrorRevision) ?
                this._runtimeAssetErrorRevision : -1 };
    }

    getVisualizerMidiMixerSnapshot() {
        this._ensureMixerTelemetrySubscription();
        const state = this._mixerState;
        if (!state || !this._mixerSubscription || !this.sf || this.enabled === false ||
            this._sectionEnabled === false || this.hasLocalAudio === false) return null;
        if (this._visualizerMixerFrame !== state) {
            this._visualizerMixerFrame = state;
            this._visualizerMixerState = Object.freeze({ voices: state.voices, limit: state.limit,
                channels: Object.freeze(state.channels.map(channel => Object.freeze({ ...channel,
                    notes: Object.freeze(Array.from(channel.notes)) }))) });
        }
        if (this._visualizerMixerPresetSource !== this._presets) {
            this._visualizerMixerPresetSource = this._presets;
            this._visualizerMixerPresets = Object.freeze(this._presets.map(({ bank, program, name }) =>
                Object.freeze({ bank, program, name })));
        }
        return Object.freeze({ state: this._visualizerMixerState,
            presets: this._visualizerMixerPresets, channelFilter: this.mc });
    }

    acquireVisualizerMidiMetering() {
        const consumer = {};
        this._visualizerMidiMeteringConsumers.add(consumer);
        this._ensureMixerTelemetrySubscription();
        this._updateMidiMetering();
        return () => {
            if (!this._visualizerMidiMeteringConsumers.delete(consumer)) return;
            this._updateMidiMetering();
        };
    }

    setParameters(params = {}) {
        if (params.mc !== undefined) {
            const mc = Math.round(this.parseFiniteNumber(params.mc, 0, 16, this.mc));
            if (mc !== this.mc) this._stopPreview();
            this.mc = mc;
        }
        for (const [key, min, max] of [['pl', 1, 1024], ['og', -60, 12]]) {
            if (params[key] !== undefined) this[key] = this.parseFiniteNumber(params[key], min, max, this[key]);
        }
        this.pl = Math.round(this.pl);
        if ([0, 1, 2].includes(params.sq)) this.sq = params.sq;
        if (typeof params.af === 'boolean') this.af = params.af;
        PluginBase.prototype._setValidatedParameters.call(this, params);
        if (typeof params.sf === 'string') {
            const id = /^[a-f0-9]{24}$/.test(params.sf) ? params.sf : '';
            if (id !== this.sf || this._importing) {
                if (id !== this.sf) {
                    this._clearPresetSelection();
                }
                this.sf = id;
                this._name = '';
                if (this.hasLocalAudio !== false) this._loadBank();
            }
        }
        this.updateParameters();
        this._renderStatus();
        if (!this.enabled) {
            this._stopPreview();
            this._clearVoiceDisplay();
        }
    }

    async createOfflineDspState() {
        const parameters = this.getParameters();
        const assets = new Map();
        if (parameters.sf) {
            const captured = this.getWasmAssets?.().get(0);
            if (captured?.externalAssetSignature === parameters.sf) {
                assets.set(0, { ...captured });
            } else {
                const bank = await (await this._getLibraryService()).prepare(parameters.sf, await this._getSfzPreparationOptions());
                if (!bank) throw new Error('Choose the sound source again before rendering.');
                this.validatePreparedSfzBank(bank, false);
                assets.set(0, { ...bank.descriptor, externalAssetSignature: parameters.sf,
                    externalAssetParameters: { sf: parameters.sf } });
            }
        }
        return { parameters, assets, offlineDspAssetRequired: Boolean(parameters.sf) };
    }

    _loadBank(...args) {
        this._preparation = null;
        this._sampleAvailable = null;
        return super._loadBank(...args);
    }

    createUI() {
        this._mixerObserver?.disconnect();
        if (this._midiMeteringVisibilityListener) {
            document.removeEventListener?.('visibilitychange', this._midiMeteringVisibilityListener);
        }
        const container = document.createElement('div');
        container.className = 'soundfont-player-plugin-ui plugin-parameter-ui';
        const row = document.createElement('div');
        row.className = 'parameter-row soundfont-bank-row local-audio-only';
        const button = (label, action) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = label;
            element.addEventListener('click', action);
            return element;
        };
        this._libraryButton = button('SoundFont Library…', () => this._openLibraryBrowser());
        this._selectedBankName = document.createElement('span');
        this._selectedBankName.className = 'soundfont-bank-name';
        this._clearButton = button('Clear', () => this.setParameters({ sf: '' }));
        row.append(this._libraryButton, this._selectedBankName, this._clearButton);
        this._status = document.createElement('div');
        this._status.className = 'room-eq-status';
        this._status.setAttribute('role', 'status');
        this._status.setAttribute('aria-live', 'polite');
        this._bankSummary = document.createElement('div');
        this._bankSummary.className = 'soundfont-bank-summary';
        const statusLine = document.createElement('div');
        statusLine.className = 'room-eq-status-line local-audio-only';
        this._preparationProgress = document.createElement('progress');
        this._preparationProgress.className = 'soundfont-preparation-progress';
        this._preparationProgress.setAttribute('aria-label', 'SoundFont preparation');
        statusLine.append(this._status, this._preparationProgress);
        container.appendChild(row);
        const tabPanel = document.createElement('div');
        tabPanel.className = 'room-eq-panel';
        const tabs = document.createElement('div'), panels = document.createElement('div');
        tabs.className = 'room-eq-tabs';
        tabs.setAttribute('role', 'tablist');
        panels.className = 'room-eq-tab-contents';
        const definitions = [['mixer', 'MIDI Mixer'], ['settings', 'Settings']];
        this._tabs = definitions.map(([key, label]) => {
            const tab = button(label, () => this._selectMixerTab(key));
            const panel = document.createElement('div');
            tab.className = 'room-eq-tab';
            tab.setAttribute('data-parameter-control', 'view');
            tab.id = `soundfont-${this.id}-${key}-tab`;
            panel.id = `soundfont-${this.id}-${key}-panel`;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', panel.id);
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', tab.id);
            panel.className = 'room-eq-tab-content plugin-parameter-ui';
            tabs.appendChild(tab);
            panels.appendChild(panel);
            return { key, tab, panel };
        });
        const [mixer, settings] = this._tabs.map(item => item.panel);
        this._createMixer(mixer);
        settings.appendChild(this._bankSummary);
        settings.append(this.createSelectControl('MIDI Channel',
            Array.from({ length: 17 }, (_, value) => ({ value, label: value === 0 ? 'All' : String(value) })),
            this.mc, value => this.setParameters({ mc: Number(value) }), 'mc'));
        for (const [key, label, min, max, step, unit, logarithmic] of [
            ['og', 'Instrument Level', -60, 12, 0.1, 'dB', false],
            ['pl', 'Max Voices', 1, 1024, 1, '', true]
        ]) settings.append(this.createParameterControl(label, min, max, step, this[key],
            value => this.setParameters({ [key]: value }), unit, key, null, logarithmic));
        settings.append(this.createCheckboxControl('Automatic Fallback', this.af,
            value => this.setParameters({ af: value }), 'af'));
        settings.append(this.createRadioGroup('Interpolation', [
            { value: 0, label: 'FIR (64 taps)' }, { value: 1, label: 'FIR (32 taps)' },
            { value: 2, label: 'Cubic (4 points)' }
        ], this.sq, value => this.setParameters({ sq: Number(value) }), 'sq'));
        settings.append(this.createRadioGroup('Color', [
            { value: 'Normal', label: 'Normal' }, { value: 'Rainbow', label: 'Note Colors' },
            { value: 'Channel', label: 'Channel Colors' }
        ], this._mixerColorMode, value => {
            this._mixerColorMode = value;
            this._renderMixer();
        }));
        settings.append(this._createInstrumentDetails());
        tabPanel.append(tabs, panels);
        container.append(tabPanel, statusLine);
        this._selectMixerTab(this._selectedTab);
        if (typeof IntersectionObserver === 'function') {
            this._mixerVisible = false;
            this._mixerObserver = new IntersectionObserver(entries => {
                this._mixerVisible = entries.some(entry => entry.isIntersecting);
                if (!this._mixerVisible) {
                    this._stopPreview();
                    this._resetMixerFlashes();
                }
                this._updateMidiMetering();
                if (this._mixerVisible) this._renderMixer();
            });
            this._mixerObserver.observe(mixer);
        }
        this._midiMeteringVisibilityListener = () => {
            this._updateMidiMetering();
            if (!document.hidden) this._renderMixer();
        };
        document.addEventListener?.('visibilitychange', this._midiMeteringVisibilityListener);
        this._updateMidiMetering();
        this._ensureMixerTelemetrySubscription();
        if (this.hasLocalAudio !== false) this._refreshBanks().catch(error => this._showError(error, false));
        this._renderStatus();
        return container;
    }

    _selectMixerTab(key) {
        this._selectedTab = key;
        if (key !== 'mixer') {
            this._resetMixerLevels();
            this._resetMixerFlashes();
        }
        for (const item of this._tabs || []) {
            const active = item.key === key;
            item.tab.className = `room-eq-tab ${active ? 'active' : ''}`;
            item.panel.className = `room-eq-tab-content plugin-parameter-ui ${active ? 'active' : ''}`;
            item.tab.setAttribute('aria-selected', String(active));
            item.panel.hidden = !active;
        }
        this._updateMidiMetering();
        if (key === 'mixer') this._renderMixer();
    }

    _updateMidiMetering() {
        const manager = window.audioManager || window.uiManager?.audioManager;
        const mixerVisible = this._mixerRows.length === 16 && this._selectedTab === 'mixer' && this._mixerVisible &&
            this.canRunAnimation?.() !== false;
        const wanted = !document.hidden && this.enabled !== false && this._sectionEnabled !== false &&
            this.hasLocalAudio !== false && !!this.sf &&
            (mixerVisible || this._visualizerMidiMeteringConsumers.size > 0);
        const previous = this._midiMeteringDesired;
        const previousManager = this._midiMeteringManager;
        if (wanted === previous && manager === previousManager) return;
        if (previous && previousManager && previousManager !== manager) {
            previousManager.setSoundFontMidiMetering?.(this, false);
        }
        this._midiMeteringDesired = wanted;
        this._midiMeteringManager = manager;
        if (manager && (wanted || previous)) manager.setSoundFontMidiMetering?.(this, wanted);
    }

    validatePreparedSfzBank(bank, updateSelection = true) {
        super.validatePreparedSfzBank(bank, updateSelection);
        if (!updateSelection) return;
        this._bankInfo = { sampleCount: bank.sampleCount, sourceBytes: bank.sourceBytes,
            memoryBytes: bank.descriptor?.footprintBytes, format: bank.format };
        this._renderBankSummary();
    }

    _clearPresetSelection() {
        super._clearPresetSelection();
        this._bankInfo = null;
        this._bankSourceBytes = null;
        this._preparation = null;
        this._clearVoiceDisplay();
        this._renderPresetSelection();
        this._renderBankSummary();
    }

    async _refreshBanks(generation) {
        const entries = await (await this._getLibraryService()).list();
        if (!this._selectedBankName || generation !== undefined && generation !== this._generation) return;
        const selected = entries.find(entry => entry.id === this.sf);
        this._name = selected?.name || this._name;
        this._bankSourceBytes = selected?.size;
        this._renderStatus();
    }

    _renderBankSummary() {
        if (!this._bankSummary) return;
        const manager = window.audioManager || window.uiManager?.audioManager;
        const metadata = manager?.getNativeMixerMetadata?.(this);
        const info = { sampleCount: metadata?.sampleCount ?? this._bankInfo?.sampleCount,
            sourceBytes: metadata?.sourceBytes ?? this._bankInfo?.sourceBytes,
            memoryBytes: metadata?.memoryBytes ?? this._bankInfo?.memoryBytes };
        const fields = [];
        if (Number.isSafeInteger(info?.sampleCount)) fields.push(`${info.sampleCount.toLocaleString()} ${info.sampleCount === 1 ? 'sample' : 'samples'}`);
        if (this._presets.length) {
            const count = new Set(this._presets.map(item => item.bank * 128 + item.program)).size;
            fields.push(`${count} ${count === 1 ? 'preset' : 'presets'}`);
        }
        const size = bytes => `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
        const sourceBytes = info?.sourceBytes ?? this._bankSourceBytes;
        if (sourceBytes > 0) fields.push(`${size(sourceBytes)} source`);
        if (info?.memoryBytes > 0) fields.push(`${size(info.memoryBytes)} playback memory`);
        this._bankSummary.textContent = fields.join(' · ');
        this._bankSummary.hidden = !this.sf || !fields.length;
    }

    _renderStatus() {
        super._renderStatus();
        this._ensureMixerTelemetrySubscription();
        this._renderBankSummary();
        if (!this._status) {
            this._updateMidiMetering();
            return;
        }
        const manager = window.audioManager || window.uiManager?.audioManager;
        const preparation = manager?.getSfzSamplePreparation?.(this);
        if (preparation && preparation !== this._observedPreparation) {
            this._observedPreparation = preparation;
            preparation.then(() => {
                if (this._observedPreparation === preparation) this._renderStatus();
            }, () => {
                if (this._observedPreparation === preparation) this._renderStatus();
            });
        }
        const phase = (this._wasmAssetStates?.get(0) || 0) & 0xff;
        const snapshot = manager?.getEffectiveActiveWasmAssetSnapshot?.(this, [0]);
        const metadata = manager?.getNativeMixerMetadata?.(this);
        const ready = metadata ? metadata.ready === true : phase === 3 && !preparation && (!snapshot || snapshot.ready === true);
        const error = this._errorMessage();
        this._mixerReady = ready && !this._pending && !error;
        const sampleAvailable = metadata?.sampleAvailable ?? this._sampleAvailable;
        const waiting = this._mixerReady && sampleAvailable === false;
        const limited = this._mixerReady && metadata?.limited === true;
        const playbackStatus = waiting ? 'Waiting for sample data…' : limited
            ? this._t('soundFontPlayer.status.limitedPreloading', 'Limited preloading. Some notes may start late.')
            : 'Ready to play.';
        this._status.textContent = error || (this.sf || this._pending ? ready && !this._pending
            ? playbackStatus : 'Preparing SoundFont and samples…' : 'Choose a SoundFont to play MIDI.');
        this._status.dataset.state = error ? 'error' : waiting || limited ? 'warning' : ready && !this._pending ? 'ready' : this.sf || this._pending ? 'preparing' : '';
        this._status.hidden = false;
        this._renderPreparationProgress(ready && !this._pending, error);
        this._updateMidiMetering();
        if (this._selectedBankName && this.sf && !this._name && (this._pending || !error)) {
            this._selectedBankName.textContent = 'SoundFont';
        }
        this._renderMixer();
    }

    onSfzPreparationProgress(progress) {
        if (progress.operationRevision !== undefined &&
            progress.operationRevision !== this.getWasmAssetOperationRevision?.(0)) return;
        if (progress.replayEpoch !== undefined &&
            progress.replayEpoch !== (this._wasmAssetLogicalReplayEpochs?.get(0) ?? null)) return;
        this._preparation = progress;
        if (progress.phase === 'error' && !this._error) this._error = 'prepare';
        this._renderStatus();
    }

    onSfzSampleAvailability({ available }) {
        this._sampleAvailable = available;
        this._renderStatus();
    }

    _renderPreparationProgress(ready, error) {
        const progress = this._preparationProgress;
        if (!progress) return;
        progress.hidden = !!error || ready || !this.sf && !this._pending;
        if (progress.hidden) return;
        const value = this._preparation;
        const phases = { metadata: 'Reading SoundFont information…', native: 'Preparing instrument…',
            prebuffer: 'Preparing sample cache…' };
        const label = phases[value?.phase] || 'Preparing SoundFont and samples…';
        const total = value?.totalBytes > 0 ? value.totalBytes : value?.totalCount;
        const completed = value?.totalBytes > 0 ? value.completedBytes : value?.completedCount;
        if (Number.isFinite(total) && total > 0 && Number.isFinite(completed) && completed >= 0) {
            progress.max = total;
            progress.value = Math.min(total, completed);
            const format = amount => value?.totalBytes > 0
                ? `${(amount / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
                : amount.toLocaleString();
            this._status.textContent = `${label} ${format(completed)} / ${format(total)}`;
        } else {
            progress.removeAttribute('value');
            this._status.textContent = label;
        }
    }

    _createMixer(container) {
        const meter = document.createElement('div');
        meter.className = 'soundfont-voice-meter';
        const label = document.createElement('span');
        label.textContent = 'Voices';
        this._voiceValue = document.createElement('strong');
        this._voiceBar = document.createElement('div');
        this._voiceBar.className = 'soundfont-voice-bar';
        meter.append(label, this._voiceValue, this._voiceBar);
        container.appendChild(meter);
        const scroll = document.createElement('div'), table = document.createElement('table');
        scroll.className = 'matrix-table-wrapper soundfont-mixer-scroll';
        table.className = 'matrix-table soundfont-mixer';
        table.setAttribute('aria-label', 'MIDI channel mixer');
        const columns = document.createElement('colgroup');
        for (const width of [3, 22, 33, 14, 4, 4, 4, 4, 4, 4, 4]) {
            const column = document.createElement('col');
            column.style.width = `${width}%`;
            columns.appendChild(column);
        }
        const head = document.createElement('thead'), body = document.createElement('tbody');
        const header = document.createElement('tr');
        header.className = 'soundfont-mixer-row soundfont-mixer-header';
        for (const text of ['Ch', 'Patch', 'Notes', 'Level', 'Vol.', 'Mute', 'Solo', 'Pan', 'EXP', 'Rev.', 'Cho.']) {
            const cell = document.createElement('th');
            cell.textContent = text;
            cell.scope = 'col';
            cell.className = `matrix-sticky-header${text === 'Ch' ? ' matrix-sticky-corner' : ''}`;
            header.appendChild(cell);
        }
        head.appendChild(header);
        table.append(columns, head, body);
        this._mixerRows = Array.from({ length: 16 }, (_, channel) => {
            const row = document.createElement('tr');
            row.className = 'soundfont-mixer-row';
            const number = document.createElement('th');
            number.scope = 'row';
            number.className = 'matrix-sticky-row soundfont-channel-number';
            number.textContent = String(channel + 1).padStart(2, '0');
            const patch = document.createElement('select');
            patch.setAttribute('aria-label', `Channel ${channel + 1} patch`);
            patch.addEventListener('change', () => {
                const key = Number(patch.value);
                if (Number.isInteger(key) && key >= 0) this._sendMixerAction({ type: 'program', channel,
                    bank: Math.floor(key / 128), program: key % 128 });
            });
            const keyboard = document.createElement('canvas');
            keyboard.width = 384;
            keyboard.height = 24;
            keyboard.dataset.channel = String(channel + 1);
            keyboard.style.touchAction = 'pan-y';
            keyboard.setAttribute('role', 'img');
            keyboard.setAttribute('aria-label', `Channel ${channel + 1} sounding notes`);
            const toggles = ['mute', 'solo'].map(type => {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'matrix-button';
                toggle.textContent = type === 'mute' ? 'M' : 'S';
                toggle.title = `Channel ${channel + 1} ${type}`;
                toggle.setAttribute('aria-label', toggle.title);
                toggle.setAttribute('aria-pressed', 'false');
                toggle.addEventListener('click', () => this._sendMixerAction({ type, channel,
                    value: toggle.getAttribute('aria-pressed') !== 'true' }));
                return toggle;
            });
            const knobs = [[7, 'Volume', 100], [10, 'Pan', 64], [11, 'Expression', 127],
                [91, 'Reverb', 40], [93, 'Chorus', 0]]
                .map(([controller, name, value]) => this._createMixerKnob(channel, controller, name, value));
            const level = document.createElement('div');
            level.className = 'soundfont-channel-level';
            level.setAttribute('role', 'img');
            level.setAttribute('aria-label', `Channel ${channel + 1} level`);
            const levelFill = document.createElement('span');
            levelFill.className = 'soundfont-channel-level-fill';
            const levelPeak = document.createElement('span');
            levelPeak.className = 'soundfont-channel-level-peak';
            level.append(levelFill, levelPeak);
            row.appendChild(number);
            for (const control of [patch, keyboard, level, knobs[0], ...toggles, ...knobs.slice(1)]) {
                const cell = document.createElement('td');
                cell.appendChild(control);
                row.appendChild(cell);
            }
            body.appendChild(row);
            return { row, patch, keyboard, level, mute: toggles[0], solo: toggles[1], knobs };
        });
        this._bindPreview(this._mixerRows.map(row => row.keyboard), {
            canStart: (event, canvas) => this._mixerChannelEnabled(Number(canvas.dataset.channel) - 1),
            update: (event, canvas) => this._previewMixerAt(event, canvas)
        });
        scroll.appendChild(table);
        container.appendChild(scroll);
        this._renderPresetSelection();
    }

    _createMixerKnob(channel, controller, name, value) {
        const knob = document.createElement('div'), indicator = document.createElement('span');
        knob.className = 'soundfont-mixer-knob';
        knob.tabIndex = 0;
        knob.setAttribute('role', 'slider');
        knob.setAttribute('aria-label', `Channel ${channel + 1} ${name}`);
        knob.setAttribute('aria-valuemin', '0');
        knob.setAttribute('aria-valuemax', '127');
        knob.appendChild(indicator);
        const set = next => {
            next = Math.max(0, Math.min(127, Math.round(next)));
            this._setMixerKnobValue(knob, next, controller);
            const action = { type: 'control', channel, controller, value: next };
            const drag = knob._mixerDrag;
            if (!drag) return this._sendMixerAction(action);
            const command = drag.command = {};
            return this._sendMixerAction(action, true).then(appliedFrame => {
                if (knob._mixerDrag !== drag || drag.command !== command) return;
                if (!Number.isSafeInteger(appliedFrame)) {
                    this._resetMixerKnobDrag(knob);
                    this._renderMixer();
                } else {
                    command.appliedFrame = appliedFrame;
                    if (drag.pointer === null) this._renderMixer();
                }
            });
        };
        const end = (event, keepCommand) => {
            const drag = knob._mixerDrag;
            if (drag?.pointer !== event.pointerId) return;
            if (keepCommand && drag.command) {
                drag.pointer = null;
                if (knob.hasPointerCapture?.(event.pointerId)) knob.releasePointerCapture(event.pointerId);
            } else this._resetMixerKnobDrag(knob);
            this._renderMixer();
        };
        knob.addEventListener('pointerdown', event => {
            if (event.button !== 0 || knob.getAttribute('aria-disabled') === 'true' ||
                knob._mixerDrag?.pointer != null) return;
            event.preventDefault();
            knob.focus();
            const drag = knob._mixerDrag ??= {};
            drag.pointer = event.pointerId;
            drag.startY = event.clientY;
            drag.startValue = Number(knob.getAttribute('aria-valuenow'));
            knob.setPointerCapture(event.pointerId);
        });
        knob.addEventListener('pointermove', event => {
            const drag = knob._mixerDrag;
            if (drag?.pointer === event.pointerId) return set(drag.startValue + drag.startY - event.clientY);
        });
        knob.addEventListener('pointerup', event => end(event, true));
        for (const type of ['pointercancel', 'lostpointercapture']) {
            knob.addEventListener(type, event => end(event, false));
        }
        knob.addEventListener('keydown', event => {
            if (knob.getAttribute('aria-disabled') === 'true') return;
            const current = Number(knob.getAttribute('aria-valuenow'));
            const next = { ArrowUp: current + 1, ArrowRight: current + 1, ArrowDown: current - 1,
                ArrowLeft: current - 1, PageUp: current + 10, PageDown: current - 10, Home: 0, End: 127 }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            set(next);
        });
        knob.addEventListener('dblclick', () => {
            if (knob.getAttribute('aria-disabled') !== 'true') set(value);
        });
        this._setMixerKnobValue(knob, value, controller);
        return knob;
    }

    _resetMixerKnobDrag(knob) {
        const pointer = knob._mixerDrag?.pointer;
        knob._mixerDrag = null;
        if (pointer != null && knob.hasPointerCapture?.(pointer)) knob.releasePointerCapture(pointer);
    }

    _resetMixerKnobDrags() {
        for (const row of this._mixerRows) for (const knob of row.knobs) this._resetMixerKnobDrag(knob);
    }

    _setMixerKnobValue(knob, value, controller) {
        if (knob.getAttribute('aria-valuenow') === String(value)) return;
        knob.setAttribute('aria-valuenow', String(value));
        const text = controller === 10 ? value === 64 ? 'Center' : value < 64 ? `${64 - value} left` : `${value - 64} right` : String(value);
        knob.setAttribute('aria-valuetext', text);
        knob.title = text;
        knob.children[0].style.transform = `rotate(${-135 + value / 127 * 270}deg)`;
    }

    async _sendMixerAction(action, reportAppliedFrame = false) {
        const manager = window.audioManager || window.uiManager?.audioManager;
        if (!this.enabled || this._sectionEnabled === false || this.hasLocalAudio === false ||
            !manager?.sendSoundFontMixerAction) return;
        try {
            return await manager.sendSoundFontMixerAction(this, action, reportAppliedFrame);
        } catch (error) {
            console.error('SoundFont mixer control could not be delivered:', error);
            if (this._status) {
                this._status.textContent = 'The mixer control could not be applied. Try again after the SoundFont is ready.';
                this._status.dataset.state = 'error';
            }
        }
    }

    _renderPresetSelection() {
        for (const [channel, row] of (this._mixerRows || []).entries()) {
            const data = this._mixerState?.channels[channel];
            const percussion = data?.presetIndex !== undefined && data.presetIndex !== 0xffff ? data.bank === 128 : channel === 9;
            if (row.presetMenu === this._presets && row.percussion === percussion) continue;
            row.presetMenu = this._presets;
            row.percussion = percussion;
            row.presets = this._presets.filter(preset => percussion ? preset.bank === 128 : preset.bank < 128);
            row.patch.replaceChildren();
            const keys = new Set();
            for (const preset of row.presets) {
                const key = preset.bank * 128 + preset.program;
                if (keys.has(key)) continue;
                keys.add(key);
                const option = document.createElement('option');
                option.value = String(key);
                option.textContent = `${preset.program + 1}. ${preset.name}${preset.bank ? ` · Bank ${preset.bank}` : ''}`;
                row.patch.appendChild(option);
            }
            const unknown = document.createElement('option');
            unknown.value = '-1';
            unknown.textContent = '—';
            row.patch.appendChild(unknown);
        }
    }

    _clearVoiceDisplay() {
        this._mixerState = null;
        this._resetMixerKnobDrags();
        this._resetMixerLevels();
        this._resetMixerFlashes();
        this._renderMixer();
    }

    _resetMixerLevels() {
        this._mixerLevelFrame = null;
        for (const row of this._mixerRows || []) {
            row.levelState = null;
            row.level.children[0].style.clipPath = 'inset(0 100% 0 0)';
            row.level.children[1].style.opacity = '0';
        }
    }

    _resetMixerFlashes() {
        for (const row of this._mixerRows || []) {
            row.flashValues = null;
            for (const control of [row.patch, ...row.knobs]) {
                control._soundFontFlash?.cancel();
                control._soundFontFlash = null;
            }
        }
    }

    _flashMixerControl(control) {
        if (!control.animate) return;
        if (control._soundFontFlash) {
            control._soundFontFlash.cancel();
            control._soundFontFlash.play();
        } else {
            control._soundFontFlash = control.animate([
                { boxShadow: '0 0 0 2px var(--et-accent)' },
                { boxShadow: '0 0 0 0 transparent' }
            ], { duration: 650, easing: 'ease-out' });
        }
    }

    onMessage(message) {
        this._ensureMixerTelemetrySubscription();
        super.onMessage(message);
    }

    _ensureMixerTelemetrySubscription() {
        const hub = window.dspTelemetryHub, tap = this.id;
        const revision = this.getWasmAssetOperationRevision?.(0);
        const replay = this._wasmAssetLogicalReplayEpochs?.get(0) ?? null;
        const previous = this._mixerSubscription;
        if (previous && previous.hub === hub && previous.tap === tap && previous.revision === revision &&
            previous.replay === replay && previous.port === hub?.port && previous.epoch === hub?.visualSyncEpoch) return;
        previous?.unsubscribe();
        this._mixerSubscription = null;
        this._mixerState = null;
        this._resetMixerKnobDrags();
        this._resetMixerLevels();
        this._resetMixerFlashes();
        if (!hub?.subscribe || !Number.isInteger(tap) || tap < 0 || tap > 0xffffffff) return;
        const subscription = { hub, tap, revision, replay, port: hub.port, epoch: hub.visualSyncEpoch };
        subscription.unsubscribe = hub.subscribe(tap, 35, frame => {
            if (this._mixerSubscription !== subscription || hub.port !== subscription.port ||
                hub.visualSyncEpoch !== subscription.epoch || this.getWasmAssetOperationRevision?.(0) !== revision ||
                (this._wasmAssetLogicalReplayEpochs?.get(0) ?? null) !== replay) return;
            this.handleMixerTelemetry(frame);
        });
        this._mixerSubscription = subscription;
    }

    handleMixerTelemetry(frame) {
        if (frame?.frameType !== 35 || frame.formatVersion !== 2 || frame.payload?.byteLength !== 584) return;
        const payload = frame.payload;
        const voices = payload.getUint16(0, true), limit = payload.getUint16(2, true);
        if (limit < 1 || limit > 1024 || voices > limit) return;
        const channels = [];
        for (let channel = 0; channel < 16; channel++) {
            const offset = 8 + channel * 32;
            const data = { bank: payload.getUint16(offset, true), program: payload.getUint8(offset + 2),
                volume: payload.getUint8(offset + 3), pan: payload.getUint8(offset + 4),
                expression: payload.getUint8(offset + 5), reverb: payload.getUint8(offset + 6),
                chorus: payload.getUint8(offset + 7), mute: !!(payload.getUint8(offset + 8) & 1),
                solo: !!(payload.getUint8(offset + 8) & 2),
                sourceProgram: payload.getUint8(offset + 9), presetIndex: payload.getUint16(offset + 10, true),
                voices: payload.getUint16(offset + 12, true), sourceBankMsb: payload.getUint8(offset + 14),
                sourceBankLsb: payload.getUint8(offset + 15),
                notes: new Uint8Array(16) };
            if (data.presetIndex !== 0xffff && (data.bank > 16383 || data.program > 127) || data.voices > voices ||
                [data.volume, data.pan, data.expression, data.reverb, data.chorus,
                    data.sourceProgram, data.sourceBankMsb, data.sourceBankLsb].some(value => value > 127)) return;
            for (let index = 0; index < 16; index++) data.notes[index] = payload.getUint8(offset + 16 + index);
            data.levelPeak = payload.getFloat32(520 + channel * 4, true);
            if (!Number.isFinite(data.levelPeak) || data.levelPeak < 0) return;
            channels.push(data);
        }
        this._mixerState = { voices, limit, channels, endFrame: frame.endFrame };
        this._renderPresetSelection();
        this._mixerLevelFrame = this._selectedTab === 'mixer' && this._mixerVisible && !document.hidden
            ? this._mixerState : null;
        if (this.canRunAnimation?.() !== false) this._renderMixer();
        else this.renderPowerUiOnce?.(() => this._renderMixer());
    }

    startAnimation() { this._updateMidiMetering(); this._renderMixer(); }
    stopAnimation() {
        this._updateMidiMetering();
        if (!this.enabled || this._sectionEnabled === false) {
            this._stopPreview();
            this._clearVoiceDisplay();
        }
    }

    _mixerControlsEnabled() {
        const manager = window.audioManager || window.uiManager?.audioManager;
        return this.enabled !== false && this._sectionEnabled !== false && !!this.sf && this._mixerReady &&
            this.hasLocalAudio !== false && !!manager?.sendSoundFontMixerAction && !!this._mixerState;
    }

    _mixerChannelEnabled(channel, controlsEnabled = this._mixerControlsEnabled()) {
        return controlsEnabled && (this.mc === 0 || this.mc === channel + 1);
    }

    _previewMixerAt(event, canvas) {
        const rect = canvas.getBoundingClientRect();
        const axis = window.FrequencyAxis;
        if (!rect.width || !rect.height || !axis) return;
        const x = Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width));
        const y = Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height));
        const midi = axis.hitKey(axis.noteAxisKeys(0, 127, canvas.width), x, y, 24, 15)?.midi;
        const channel = Number(canvas.dataset.channel) - 1;
        if (midi === undefined || (midi === this._previewMidi && channel === this._previewChannel)) return;
        this._previewMidi = midi;
        this._previewChannel = channel;
        this._sendPreview();
        this._renderMixer();
    }

    _stopPreview() {
        const sounding = this._previewMidi !== -1;
        super._stopPreview();
        if (sounding) this._renderMixer();
    }

    _renderMixer() {
        if (!this._mixerVisible || this._selectedTab !== 'mixer' || document.hidden) return;
        const midiGeneration = window.uiManager?.audioPlayer?.contextManager?.midiGeneration ?? null;
        if (this._flashMidiGeneration !== midiGeneration) {
            this._flashMidiGeneration = midiGeneration;
            this._resetMixerFlashes();
        }
        const state = this._mixerState;
        const active = this.enabled !== false && this._sectionEnabled !== false;
        const voices = active ? state?.voices ?? null : 0;
        const limit = state?.limit ?? this.pl;
        if (this._voiceValue) this._voiceValue.textContent = `${voices ?? '—'} / ${limit}`;
        if (this._voiceBar) this._voiceBar.style.backgroundSize = `${(voices ?? 0) / limit * 100}% 100%`;
        const controlsEnabled = this._mixerControlsEnabled();
        for (const [channel, row] of (this._mixerRows || []).entries()) {
            const data = state?.channels[channel];
            const enabled = this._mixerChannelEnabled(channel, controlsEnabled);
            row.row.dataset.filtered = String(this.mc !== 0 && this.mc !== channel + 1);
            row.patch.disabled = !enabled || !this._presets.length || !!this._pending;
            row.mute.disabled = row.solo.disabled = !enabled;
            for (const knob of row.knobs) {
                if (!enabled && knob._mixerDrag) this._resetMixerKnobDrag(knob);
                knob.setAttribute('aria-disabled', String(!enabled));
                knob.tabIndex = enabled ? 0 : -1;
            }
            if (data) {
                const key = data.bank * 128 + data.program;
                row.patch.value = data.presetIndex !== 0xffff && row.presets?.some(preset => preset.bank * 128 + preset.program === key) ? String(key) : '-1';
                row.patch.title = `MIDI bank ${data.sourceBankMsb}:${data.sourceBankLsb} · Program ${data.sourceProgram + 1}`;
                row.row.title = `Channel ${channel + 1} · ${data.voices} sounding voices`;
                row.mute.setAttribute('aria-pressed', String(data.mute));
                row.solo.setAttribute('aria-pressed', String(data.solo));
                row.mute.className = `matrix-button${data.mute ? ' active' : ''}`;
                row.solo.className = `matrix-button${data.solo ? ' active' : ''}`;
                for (const [index, [controller, value]] of [[7, data.volume], [10, data.pan], [11, data.expression],
                    [91, data.reverb], [93, data.chorus]].entries()) {
                    const knob = row.knobs[index];
                    const drag = knob._mixerDrag;
                    if (drag) {
                        if (drag.pointer !== null || (drag.command && !(state.endFrame > drag.command.appliedFrame))) continue;
                        knob._mixerDrag = null;
                    }
                    this._setMixerKnobValue(knob, value, controller);
                }
                const flashValues = [`${data.bank}:${data.program}:${data.presetIndex}`,
                    data.volume, data.pan, data.expression, data.reverb, data.chorus];
                if (row.flashValues) {
                    for (let index = 0; index < flashValues.length; index++) {
                        if (flashValues[index] !== row.flashValues[index]) {
                            this._flashMixerControl(index === 0 ? row.patch : row.knobs[index - 1]);
                        }
                    }
                }
                row.flashValues = flashValues;
            } else {
                row.flashValues = null;
                row.patch.value = '-1';
                row.patch.title = 'Waiting for channel state';
                row.mute.setAttribute('aria-pressed', 'false');
                row.solo.setAttribute('aria-pressed', 'false');
                row.mute.className = row.solo.className = 'matrix-button';
            }
            this._drawMixerKeyboard(row.keyboard, active ? data?.notes : null);
            this._drawMixerLevel(row, active && this._mixerLevelFrame === state ? data?.levelPeak : null, state);
        }
    }

    _drawMixerLevel(row, samplePeak, frame) {
        const now = performance.now() / 1000;
        const state = row.levelState || { level: SOUNDFONT_METER_FLOOR_DB, peak: SOUNDFONT_METER_FLOOR_DB, holdUntil: now, time: now, frame: null };
        const elapsed = Math.max(0, now - state.time);
        const fresh = frame && state.frame !== frame && Number.isFinite(samplePeak);
        const raw = fresh && samplePeak > 0 ? Math.max(SOUNDFONT_METER_FLOOR_DB, Math.min(0, 20 * Math.log10(samplePeak))) : SOUNDFONT_METER_FLOOR_DB;
        state.level = Math.max(raw, state.level - 20 * elapsed);
        if (raw > state.peak) {
            state.peak = raw;
            state.holdUntil = now + 1;
        } else if (now > state.holdUntil) {
            state.peak = Math.max(state.level, state.peak - 20 * Math.min(elapsed, now - state.holdUntil));
        }
        state.time = now;
        state.frame = frame;
        row.levelState = state;
        row.level.children[0].style.clipPath = `inset(0 ${100 - (state.level - SOUNDFONT_METER_FLOOR_DB) / -SOUNDFONT_METER_FLOOR_DB * 100}% 0 0)`;
        row.level.children[1].style.left = `${(state.peak - SOUNDFONT_METER_FLOOR_DB) / -SOUNDFONT_METER_FLOOR_DB * 100}%`;
        row.level.children[1].style.opacity = state.peak > SOUNDFONT_METER_FLOOR_DB ? '1' : '0';
    }

    _drawMixerKeyboard(canvas, notes) {
        const context = canvas.getContext?.('2d'), axis = window.FrequencyAxis, palette = window.ThemePalette;
        if (!context || !axis || !palette) return;
        const colors = [palette.get('graph-trace'), '#111', '#eee', palette.get('graph-label')]; // theme-allow: Self-painted piano keys use the same fixed key colors as SoundFont Note Player.
        const preview = Number(canvas.dataset.channel) - 1 === this._previewChannel ? this._previewMidi : -1;
        const previous = canvas._mixerKeyboard;
        if (previous?.mode === this._mixerColorMode && previous.preview === preview &&
            previous.colors.every((color, index) => color === colors[index]) &&
            (notes ? previous.notes && notes.every((value, index) => previous.notes[index] === value) : !previous.notes)) return;
        canvas._mixerKeyboard = { colors, mode: this._mixerColorMode, preview, notes: notes ? notes.slice() : null };
        const keys = axis.noteAxisKeys(0, 127, canvas.width);
        const pressed = midi => Boolean(notes?.[midi >> 3] & (1 << (midi & 7)));
        const sounding = [];
        for (let midi = 0; midi < 128; midi++) {
            if (pressed(midi)) sounding.push(`${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`);
        }
        canvas.setAttribute('aria-label', `Channel ${canvas.dataset.channel} sounding notes: ${sounding.length ? sounding.join(', ') : 'none'}`);
        context.clearRect(0, 0, canvas.width, canvas.height);
        for (const black of [false, true]) {
            for (const key of keys) {
                if (key.black !== black) continue;
                const start = black ? key.start : key.whiteStart;
                const end = black ? key.end : key.whiteEnd;
                let color = colors[black ? 1 : 2];
                if (pressed(key.midi)) {
                    const noteColor = this._mixerColorMode === 'Rainbow' ? window.NoteSpectrogramPlugin?.noteColor(key.midi) : null;
                    color = this._mixerColorMode === 'Channel'
                        ? SOUNDFONT_MIDI_CHANNEL_COLORS[Number(canvas.dataset.channel) - 1]
                        : noteColor ? `rgb(${noteColor.join(',')})` : colors[0]; // theme-allow: Reuse the shared note palette.
                }
                context.fillStyle = color;
                context.fillRect(start, 0, end - start, black ? 15 : 24);
                if (key.midi === preview) {
                    // Painting in key order lets the black keys cover the overlay of a white preview key.
                    context.globalAlpha = .55;
                    context.fillStyle = colors[0];
                    context.fillRect(start, 0, end - start, black ? 15 : 24);
                    context.globalAlpha = 1;
                }
                context.strokeStyle = colors[3];
                context.lineWidth = .5;
                context.strokeRect(start, 0, end - start, black ? 15 : 24);
            }
        }
        context.fillStyle = colors[1];
        context.font = '7px Arial';
        context.textAlign = 'center';
        for (const key of keys) {
            if (key.midi % 24 !== 0) continue;
            const text = `C${key.midi / 12 - 1}`, x = (key.whiteStart + key.whiteEnd) / 2;
            const half = context.measureText(text).width / 2;
            if (x >= half && x + half <= canvas.width) context.fillText(text, x, 23);
        }
    }

    cleanup() {
        this._visualizerMidiMeteringConsumers.clear();
        this._midiMeteringManager?.setSoundFontMidiMetering?.(this, false);
        this._midiMeteringManager = null;
        this._midiMeteringDesired = false;
        document.removeEventListener?.('visibilitychange', this._midiMeteringVisibilityListener);
        this._midiMeteringVisibilityListener = null;
        this._mixerSubscription?.unsubscribe();
        this._mixerSubscription = null;
        this._mixerObserver?.disconnect();
        this._mixerObserver = null;
        this._resetMixerKnobDrags();
        this._resetMixerFlashes();
        this._mixerRows = [];
        this._tabs = this._voiceValue = this._voiceBar = this._bankSummary = this._preparationProgress = null;
        this._observedPreparation = null;
        super.cleanup();
    }
}

window.SoundFontPlayerPlugin = SoundFontPlayerPlugin;
