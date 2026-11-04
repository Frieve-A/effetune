class SFZInstrumentPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor(name, description) {
        super(name, description);
        this.sf = '';
        this._generation = 0;
        this._pending = null;
        this._nativeHydration = null;
        this._importing = false;
        this._name = '';
        this._missing = false;
        this._error = '';
        this._errorVisible = false;
        this._activeAssetRevision = null;
        this._runtimeAssetErrorRevision = null;
        this.sp0 = -1;
        this._presets = [];
        this._presetChannels = 1;
        this._presetChannel = 0;
        this._presetDefaultLabel = 'Default';
        this._instrumentPresentation = null;
        this._instrumentImageUrl = null;
        this._activeSwitches = null;
    }

    _t(key, fallback, params = {}) {
        const translated = window.uiManager?.t?.(key, params);
        const text = translated && translated !== key ? translated : fallback;
        return Object.entries(params).reduce((value, [name, replacement]) =>
            value.replaceAll(`{${name}}`, String(replacement)), text);
    }

    get externalAssetInfo() {
        if (!this.sf && !this._pending) return null;
        return { kind: 'SFZ', ids: this.sf ? [this.sf] : [],
            names: this.sf ? [this._name || 'SoundFont'] : [], missing: this._missing,
            pending: Boolean(this._pending), assetSignature: this.sf,
            protectedIds: this.sf ? [this.sf] : [] };
    }

    get offlineDspAssetRequired() { return Boolean(this.sf || this._pending); }
    get offlineDspAssetErrorMessageKey() {
        return this._error === 'unsupportedRuntime' ? 'sfzNotePlayer.error.unsupportedRuntime' : 'sfzNotePlayer.error.prepare';
    }

    getExternalAssetParameters() { return { sf: this.sf }; }

    hydrateExternalAsset(_definition, mutationOptions) {
        // Native playback already owns the bank; materialize samples only for offline rendering.
        this._nativeHydration = mutationOptions;
    }

    async resolveOfflineDspAssetRequirement() {
        if (this._nativeHydration) this._loadBank(++this._generation, false, this._nativeHydration);
        while (this._pending) await this._pending;
        return { required: this.offlineDspAssetRequired };
    }

    async _getLibraryService() {
        if (window.sfzLibraryService) return window.sfzLibraryService;
        const module = await import('../js/sfz/service.js');
        return module.getDefaultSfzLibraryService();
    }

    async _getSfzPreparationOptions() {
        const options = { decode: (bytes, rate) => this._decodeAudioData(bytes, rate) };
        const generation = this._generation;
        options.onPreparationProgress = progress => {
            if (this._generation !== generation) return;
            this.onSfzPreparationProgress?.({ ...progress,
                operationRevision: this.getWasmAssetOperationRevision?.(0),
                replayEpoch: this._wasmAssetLogicalReplayEpochs?.get(0) ?? null });
        };
        const manager = window.audioManager || window.uiManager?.audioManager;
        await manager?.waitForDspActivationBeforeOutput?.();
        if (manager?.hasSfzSampleStreaming?.()) {
            options.prepareStreamedBank = (await import('../js/sfz/streamed-bank.js')).prepareStreamedSfzBank;
            options.prepareSoundFontBank = (await import('../js/sf2/asset.js')).prepareSoundFontBank;
        }
        const timeline = window.uiManager?.audioPlayer?.contextManager?.midiTimeline ?? null;
        const context = await manager?.getSfzPreparationContext?.(this, undefined, timeline);
        if (context) {
            options.preparationContext = context;
            options.estimateEffectBytes = (payload, preparation, formatTag) =>
                manager.estimateSfzEffectPreparation(payload, preparation, formatTag);
        }
        return options;
    }

    async prepareSfzForContext(context, node, isCurrent = null, beforeReplay = null, { waitReady = true } = {}) {
        const previous = this.getWasmAssets?.().get(0);
        if (!previous || this._runtimeAssetErrorRevision === previous.operationRevision) return true;
        const revision = previous.operationRevision;
        const current = () => isCurrent?.() !== false && this.getWasmAssetOperationRevision(0) === revision;
        const manager = window.audioManager || window.uiManager?.audioManager;
        const { prepareSfzAssetForContext } = await import('../js/sfz/preparation-context.js');
        const { getSfzMaxBytes } = await import('../js/sfz/limits.js');
        const budget = getSfzMaxBytes(window.appConfig?.sfzMaxSizeMiB);
        const estimate = (payload, preparation, formatTag) => manager.estimateSfzEffectPreparation(payload, preparation, formatTag);
        const descriptor = await prepareSfzAssetForContext(previous, context, budget, estimate);
        if (!current()) return false;
        if (descriptor === previous) return true;
        if (await beforeReplay?.() === false || !current()) return false;
        const snapshot = manager.getEffectiveActiveWasmAssetSnapshot?.(this, [0], { primaryWorklet: node });
        const replayEpoch = this.reprepareWasmAssetContext(0, descriptor, node, { operationRevision: revision,
            isCurrent: current, replacePending: snapshot?.ready !== true });
        if (!replayEpoch) return false;
        if (!waitReady) return current();
        const result = await manager.waitForEffectiveActiveWasmAssets(this, [0], { primaryWorklet: node,
            getPreparation: () => manager.getSfzSamplePreparation(this, node) });
        return current() && result.ready === true && !result.stale &&
            manager._getSfzRuntimeAssetIdentity(node, this.id).replayEpoch === replayEpoch;
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

    _loadBank(generation = ++this._generation, manual = false, mutationOptions) {
        this._nativeHydration = null;
        this._stopPreview?.();
        this._resetLoadNotice();
        this._initialAssetLoad = manual;
        this._importing = false;
        const id = this.sf;
        if (!mutationOptions?.nativeHydration) this.clearWasmAsset(0);
        this._clearVoiceDisplay?.();
        this._missing = false;
        this._error = '';
        this._errorVisible = false;
        this._activeAssetRevision = null;
        this._runtimeAssetErrorRevision = null;
        this._setInstrumentPresentation(null);
        this._soundFontMetadata = null;
        this.onSfzPreparationProgress?.({ phase: 'metadata' });
        if (!id) {
            this._initialAssetLoad = false;
            this._pending = null;
            this._renderStatus();
            return;
        }
        const pending = (async () => {
            try {
                const service = await this._getLibraryService();
                let prepared = await service.prepare(id, { ...await this._getSfzPreparationOptions(),
                    isCurrent: () => generation === this._generation && mutationOptions?.isCurrent?.() !== false });
                if (generation !== this._generation || mutationOptions?.isCurrent?.() === false) return;
                this._missing = !prepared;
                if (prepared) {
                    const current = () => generation === this._generation && mutationOptions?.isCurrent?.() !== false;
                    const manager = window.audioManager || window.uiManager?.audioManager;
                    const player = window.uiManager?.audioPlayer?.contextManager;
                    while (current()) {
                        const generation = player?.midiGeneration;
                        const timeline = player?.midiPreparation?.timeline ?? player?.midiTimeline;
                        const context = await manager?.getSfzPreparationContext?.(this, undefined, timeline);
                        if (!current()) return;
                        if (context) {
                            const { prepareSfzAssetForContext } = await import('../js/sfz/preparation-context.js');
                            const { getSfzMaxBytes } = await import('../js/sfz/limits.js');
                            const descriptor = await prepareSfzAssetForContext(prepared.descriptor, context,
                                getSfzMaxBytes(window.appConfig?.sfzMaxSizeMiB),
                                (payload, context, formatTag) => manager.estimateSfzEffectPreparation(payload, context, formatTag));
                            if (!current()) return;
                            prepared = { ...prepared, descriptor };
                        }
                        if (generation === player?.midiGeneration) break;
                    }
                    if (prepared.descriptor?.unsupportedRuntime?.length) {
                        (await import('../js/sfz/runtime-support.js')).requireSfzRuntimeSupport(prepared.descriptor);
                    }
                    this._soundFontMetadata = { sampleCount: prepared.sampleCount, sourceBytes: prepared.sourceBytes,
                        presetCount: prepared.presets?.length ?? 0, regionCount: prepared.regionCount,
                        format: prepared.format ?? 'sfz', memoryBytes: prepared.descriptor.footprintBytes };
                    this._name = prepared.name;
                    this._loadWarnings = this._warningMessage(prepared.warnings);
                    this.onSfzPreparationProgress?.({ phase: 'native' });
                    const commit = () => {
                        this.validatePreparedSfzBank?.(prepared);
                        this.setWasmAsset(0, { ...prepared.descriptor,
                            externalAssetSignature: id, externalAssetParameters: { sf: id } });
                    };
                    if (mutationOptions && window.audioManager?.withMutationOptions) {
                        await window.audioManager.withMutationOptions(mutationOptions, commit);
                    } else commit();
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
        console.error('SFZ instrument could not load the bank:', error);
        if (this._runtimeAssetErrorRevision !== null) return;
        this._error = error?.code === 'sample-codec-unavailable' ? 'unsupportedCodec' :
            error?.code === 'unsupported-runtime' ? 'unsupportedRuntime' : error?.code === 'too-large' ? 'tooLarge' :
            (error?.code === 'no-regions' ? 'noRegions' :
                (error?.code === 'storage' ? 'storage' : 'prepare'));
        this._errorVisible = visible;
        this.onSfzPreparationProgress?.({ phase: 'error' });
        this._renderStatus();
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (slot !== 0 || (this._isCurrentWasmAssetOperation &&
            !this._isCurrentWasmAssetOperation(slot, operationRevision))) return;
        console.error('SFZ instrument asset rejected:', reason);
        if (this._runtimeAssetErrorRevision === operationRevision && reason !== 'sample-read') return;
        this._error = reason === 'sample-read' ? 'sampleRead' :
            reason === 'module-budget' || reason === 'capacity' ? 'tooLarge' : 'prepare';
        if (reason === 'sample-read') this._runtimeAssetErrorRevision = operationRevision;
        this._errorVisible = reason === 'sample-read' || Boolean(this._initialAssetLoad);
        this.onSfzPreparationProgress?.({ phase: 'error', operationRevision });
        this._renderStatus();
        this._finishInitialAssetLoad(false);
    }

    onWasmAssetState(slot, state, operationRevision) {
        if (slot !== 0 || !this._isCurrentWasmAssetOperation(slot, operationRevision)) return;
        const phase = state & 0xff;
        if (this._runtimeAssetErrorRevision !== operationRevision) this._runtimeAssetErrorRevision = null;
        if (phase === 4) {
            console.error('SFZ Note Player asset preparation failed:', state);
            const playbackFailed = this._activeAssetRevision === operationRevision ||
                this._runtimeAssetErrorRevision === operationRevision;
            if (this._error !== 'sampleRead') this._error = playbackFailed ? 'playback' : 'prepare';
            if (playbackFailed) this._runtimeAssetErrorRevision = operationRevision;
            this._errorVisible = playbackFailed || this._error === 'sampleRead' || Boolean(this._initialAssetLoad);
        }
        if (phase === 3) {
            this._activeAssetRevision = operationRevision;
            if (this._runtimeAssetErrorRevision === null) this._error = '';
        }
        const manager = window.audioManager || window.uiManager?.audioManager;
        if (phase !== 3 || !manager?.getSfzSamplePreparation?.(this)) {
            this.onSfzPreparationProgress?.({ phase: phase === 4 ? 'error' : phase === 3 ? 'ready' : 'native',
                operationRevision, replayEpoch: this._wasmAssetLogicalReplayEpochs?.get(0) ?? null });
        }
        this._ensureSwitchTelemetrySubscription();
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
            unsupportedCodec: 'This browser cannot play compressed SoundFonts. Use a browser with Vorbis decoding support or choose an SF2 SoundFont.',
            unsupportedRuntime: 'This instrument uses features that are not available in this version. Choose another SoundFont.',
            tooLarge: 'This SoundFont exceeds the size limit. Increase SoundFont size limit in Config → General, or choose a smaller SoundFont.',
            noRegions: 'No playable samples were found. Choose another SoundFont.',
            storage: 'The SoundFont library could not be accessed. Check file permissions and available storage space, then try again.',
            sampleRead: 'Instrument playback stopped because sample data could not be loaded. Check that the source files are available. For large instruments, try a faster local drive or fewer simultaneous notes.',
            playback: 'The instrument stopped because it could not continue playing. Load it again or choose another instrument.',
            prepare: 'The SoundFont could not be loaded. Check that its sample files are available, or choose another SoundFont.'
        };
        return this._error
            ? this._t(`sfzNotePlayer.error.${this._error}`, errors[this._error])
            : this._missing ? this._t('sfzNotePlayer.error.missing',
                'The selected SoundFont could not be found. Choose it again or choose another SoundFont.') : '';
    }

    _warningMessage(warnings = []) {
        const messages = {
            'loop-points-ignored': 'Unused loop settings were adjusted so this SoundFont could be loaded.',
            'invalid-regions': 'Some sounds had invalid settings and were skipped.',
            'missing-samples': 'Some sample files could not be found. The available sounds were loaded.',
            'envelope-times-adjusted': 'Some sound fade times were invalid and were adjusted so this SoundFont could be loaded.',
            'reduced-bank': 'A smaller selection of sounds was loaded to fit the size limit while keeping every note. Increase SoundFont size limit for more detail.'
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
        dialog.setAttribute('aria-label', this.name);
        const title = document.createElement('h2');
        title.textContent = this.name;
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
        this._ensureSwitchTelemetrySubscription();
        this._renderPresetSelection();
        this._renderActiveSwitchLabels();
        if (!this._status) return;
        this._status.textContent = this._errorVisible || this._runtimeAssetErrorRevision !== null ? this._errorMessage() : '';
        this._status.hidden = !this._status.textContent;
        this._status.dataset.state = this._status.hidden ? '' : 'error';
        if (this._selectedBankName) this._selectedBankName.textContent = this.sf
            ? this._name || this._t('sfzNotePlayer.missingBank', 'Missing SoundFont') : 'None';
        if (this._clearButton) this._clearButton.disabled = !this.sf || Boolean(this._pending);
    }

    _clearPresetSelection() {
        for (let channel = 0; channel < this._presetChannels; channel++) this[`sp${channel}`] = -1;
        this._presets = [];
    }

    validatePreparedSfzBank(bank, updateSelection = true) {
        if (bank.descriptor?.unsupportedOpcodes?.length || bank.descriptor?.incomplete) {
            console.error('SoundFont requires a complete instrument:', {
                unsupportedOpcodes: bank.descriptor.unsupportedOpcodes,
                incomplete: bank.descriptor.incomplete
            });
            const error = new Error('This instrument uses features that are not available in this version. Choose another SoundFont.');
            error.code = 'unsupported-runtime';
            throw error;
        }
        if (!updateSelection) return;
        this._setInstrumentPresentation(bank.presentation ?? null);
        this._presets = ['sf2', 'sf3'].includes(bank.format) ? (bank.presets || []).filter(preset => preset.bank <= 128 && preset.program <= 127) : [];
        const keys = new Set(this._presets.map(preset => preset.bank * 128 + preset.program));
        for (let channel = 0; channel < this._presetChannels; channel++) {
            if (!keys.has(this[`sp${channel}`])) this[`sp${channel}`] = -1;
        }
        this.updateParameters();
        this._renderPresetSelection();
    }

    _setInstrumentPresentation(presentation) {
        if (this._instrumentImageUrl) window.URL.revokeObjectURL(this._instrumentImageUrl);
        this._instrumentImageUrl = null;
        this._instrumentPresentation = presentation;
        this._activeSwitches = null;
        if (presentation?.imageBlob) this._instrumentImageUrl = window.URL.createObjectURL(presentation.imageBlob);
        this._renderInstrumentDetails();
        this._ensureSwitchTelemetrySubscription();
    }

    onMessage(message) {
        this._ensureSwitchTelemetrySubscription();
        super.onMessage(message);
    }

    _ensureSwitchTelemetrySubscription() {
        const hub = window.dspTelemetryHub, tap = this.id;
        const revision = this.getWasmAssetOperationRevision?.(0);
        const replay = this._wasmAssetLogicalReplayEpochs?.get(0) ?? null;
        const active = this._instrumentPresentation?.switches?.length > 0 &&
            (this._wasmAssetStates?.get(0) & 0xff) === 3 && Number.isSafeInteger(revision) && revision > 0;
        const previous = this._switchSubscription;
        if (active && previous?.hub === hub && previous.tap === tap && previous.revision === revision &&
            previous.replay === replay && previous.port === hub?.port && previous.epoch === hub?.visualSyncEpoch) return;
        previous?.unsubscribe();
        this._switchSubscription = null;
        this._activeSwitches = null;
        this._renderActiveSwitchLabels();
        if (!active || !hub?.subscribe || !Number.isInteger(tap) || tap < 0 || tap > 0xffffffff) return;
        const subscription = { hub, tap, revision, replay, port: hub.port, epoch: hub.visualSyncEpoch };
        subscription.unsubscribe = hub.subscribe(tap, 34, frame => {
            if (this._switchSubscription !== subscription || !this.enabled || this._sectionEnabled === false ||
                (this._wasmAssetStates?.get(0) & 0xff) !== 3 || this.getWasmAssetOperationRevision?.(0) !== revision ||
                (this._wasmAssetLogicalReplayEpochs?.get(0) ?? null) !== replay || hub.port !== subscription.port ||
                hub.visualSyncEpoch !== subscription.epoch || frame.frameType !== 34 || frame.formatVersion !== 1 ||
                frame.payload?.byteLength !== 32) return;
            const keys = Array.from({ length: 16 }, (_, channel) => frame.payload.getInt16(channel * 2, true));
            if (keys.some(key => key < -1 || key > 127)) return;
            this._activeSwitches = keys;
            this._renderActiveSwitchLabels();
        });
        this._switchSubscription = subscription;
    }

    _createInstrumentDetails() {
        const container = document.createElement('div');
        container.className = 'sfz-instrument-details';
        this._instrumentDetails = container;
        this._renderInstrumentDetails();
        return container;
    }

    _renderInstrumentDetails() {
        const container = this._instrumentDetails;
        if (!container) return;
        container.replaceChildren();
        this._currentSwitchLabels = null;
        const data = this._instrumentPresentation;
        container.hidden = !data || !this._instrumentImageUrl &&
            !['keys', 'controllers', 'outputs', 'groups', 'scopes', 'switches'].some(key => data[key]?.length);
        if (container.hidden) return;
        this._currentSwitchLabels = document.createElement('div');
        this._currentSwitchLabels.setAttribute('role', 'status');
        container.appendChild(this._currentSwitchLabels);
        const details = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = 'Instrument Details';
        details.appendChild(summary);
        if (this._instrumentImageUrl) {
            const image = document.createElement('img');
            image.src = this._instrumentImageUrl;
            image.alt = this._name || 'Instrument';
            image.style.maxWidth = '100%';
            image.style.height = 'auto';
            details.appendChild(image);
        }
        const labels = document.createElement('dl');
        const add = (name, value) => {
            const term = document.createElement('dt'), description = document.createElement('dd');
            term.textContent = name; description.textContent = value;
            labels.append(term, description);
        };
        for (const { index, label } of data.keys || []) add(`Key ${index}`, label);
        for (const { index, label } of data.controllers || []) add(`CC ${index}`, label);
        for (const { index, label } of data.outputs || []) add(`Output ${index + 1}`, label);
        for (const label of data.groups || []) add('Group', label);
        for (const { scope, label } of data.scopes || []) add(scope[0].toUpperCase() + scope.slice(1), label);
        for (const { first, last, label } of data.switches || []) add(`Keyswitch ${first === last ? first : `${first}–${last}`}`, label);
        details.appendChild(labels);
        container.appendChild(details);
        this._renderActiveSwitchLabels();
    }

    _renderActiveSwitchLabels() {
        if (!this._currentSwitchLabels) return;
        const values = [];
        for (const [channel, key] of (this._activeSwitches || []).entries()) {
            if (key < 0 || this.mc > 0 && channel !== this.mc - 1) continue;
            const names = this._instrumentPresentation?.switches?.filter(item => key >= item.first && key <= item.last).map(item => item.label);
            if (names?.length) values.push(`Channel ${channel + 1}: ${[...new Set(names)].join(', ')}`);
        }
        this._currentSwitchLabels.textContent = values.length ? `Keyswitch · ${values.join(' · ')}` : '';
        this._currentSwitchLabels.hidden = !values.length;
    }

    _createPresetControl() {
        const row = this.createSelectControl('Preset', [{ value: -1, label: this._presetDefaultLabel }], -1,
            value => this.setParameters({ [`sp${this._presetChannel}`]: Number(value) }));
        this._presetSelect = row.querySelector('select');
        this._presetRow = row;
        this._presetMenu = null;
        return row;
    }

    _renderPresetSelection() {
        if (!this._presetSelect) return;
        if (this._presetMenu !== this._presets) {
            this._presetMenu = this._presets;
            this._presetSelect.replaceChildren();
            const keys = new Set();
            for (const preset of [{ bank: -1, program: 0, name: this._presetDefaultLabel }, ...this._presets]) {
                const key = preset.bank < 0 ? -1 : preset.bank * 128 + preset.program;
                if (keys.has(key)) continue;
                keys.add(key);
                const option = document.createElement('option');
                option.value = key;
                option.textContent = key < 0 ? preset.name : `Bank ${preset.bank} · ${preset.program + 1}. ${preset.name}`;
                this._presetSelect.appendChild(option);
            }
        }
        this._presetSelect.value = String(this[`sp${this._presetChannel}`]);
        this._presetSelect.disabled = !this._presets.length || Boolean(this._pending);
        if (this._presetRow && this._presetChannels === 1) this._presetRow.style.display = this._presets.length ? '' : 'none';
        if (this._presetChannelSelect) this._presetChannelSelect.disabled = !this._presets.length;
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
                import('../js/sfz/browser.js'), this._getLibraryService()
            ]);
            if (button !== this._libraryButton) return;
            this._libraryBrowser = browser.openSfzLibraryBrowser({
                service,
                returnFocus: button,
                ...await this._getSfzPreparationOptions(),
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
        this._activeAssetRevision = null;
        this._runtimeAssetErrorRevision = null;
        const isCurrent = () => generation === this._generation;
        const pending = Promise.resolve().then(async () => {
            try {
                if (!isCurrent()) return;
                const service = await this._getLibraryService();
                if (!isCurrent()) return;
                const entry = await select(service, isCurrent);
                if (!isCurrent() || !entry) return;
                if (entry.id !== this.sf) this._clearPresetSelection();
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

    cleanup() {
        this._setInstrumentPresentation(null);
        this._instrumentDetails = this._currentSwitchLabels = null;
        this._presetSelect = this._presetChannelSelect = this._presetMenu = this._presetRow = null;
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

window.SFZInstrumentPlugin = SFZInstrumentPlugin;
