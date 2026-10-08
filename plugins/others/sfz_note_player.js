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
        this.lo = this.md = this.hi = true;
        this.tm = 0;
        this.og = 0;
        this.temporalCapability = 'reset-on-resume';
        this._generation = 0;
        this._pending = null;
        this._importing = false;
        this._name = '';
        this._missing = false;
        this._error = '';
        this._errorVisible = false;
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
            os: this.os, lo: this.lo, md: this.md, hi: this.hi, tm: this.tm, og: this.og };
    }

    setParameters(params = {}) {
        super._setValidatedParameters(params);
        const ranges = { th: [0.01, 1], rd: [1, 96], nh: [0, 100], vf: [-96, 0], vc: [-60, 24],
            mn: [21, 108], mx: [21, 108], pl: [1, 128], dm: [0, 100], wm: [0, 100],
            os: [-2, 2], tm: [-100, 100], og: [-60, 12] };
        for (const [key, [min, max]] of Object.entries(ranges)) {
            if (params[key] !== undefined) {
                const value = this.parseFiniteNumber(params[key], min, max, this[key]);
                this[key] = ['mn', 'mx', 'pl', 'os'].includes(key) ? Math.round(value) : value;
            }
        }
        for (const key of ['lo', 'md', 'hi']) {
            if (typeof params[key] === 'boolean') this[key] = params[key];
        }
        if (this.mn > this.mx) this.mx = this.mn;
        if (this.vc < this.vf + 1) this.vc = this.vf + 1;
        if (typeof params.sf === 'string') {
            const next = /^[a-f0-9]{24}$/.test(params.sf) ? params.sf : '';
            if (next !== this.sf || this._importing) {
                this.sf = next;
                this._name = '';
                this._loadBank();
            } else {
                this._resetLoadNotice();
                this._errorVisible = false;
                this._renderStatus();
            }
        }
        this.updateParameters();
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
        this._resetLoadNotice();
        this._initialAssetLoad = manual;
        this._finishImportSelection?.(null);
        this._importing = false;
        const id = this.sf;
        this.clearWasmAsset(0);
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
            'unsupported-regions': 'Some sounds use playback conditions this effect does not support and were skipped.',
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
        if (this._bankSelect) this._bankSelect.value = this.sf;
        if (this._removeButton) this._removeButton.disabled = !this.sf || Boolean(this._pending);
    }

    async _refreshBanks(generation) {
        const entries = await (await this._getLibraryService()).list();
        if (!this._bankSelect || (generation !== undefined && generation !== this._generation)) return;
        this._bankSelect.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'None';
        this._bankSelect.appendChild(empty);
        for (const entry of entries) {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = entry.name;
            this._bankSelect.appendChild(option);
        }
        if (this.sf && !entries.some(entry => entry.id === this.sf)) {
            const missing = document.createElement('option');
            missing.value = this.sf;
            missing.textContent = this._t('sfzNotePlayer.missingBank', 'Missing SFZ');
            this._bankSelect.appendChild(missing);
        }
        this._renderStatus();
    }

    _chooseFolder() {
        return this._importFolder();
    }

    async _acceptFolder(files, module) {
        const paths = module.listSfzFolderFiles(files);
        return this._chooseInstrument(paths.map(path => ({ id: path, name: path })));
    }

    _chooseInstrument(entries) {
        if (!entries.length) throw Object.assign(new Error('No SFZ in folder'), { code: 'no-regions' });
        if (entries.length === 1) return entries[0].id;
        this._importChoices.replaceChildren();
        for (const entry of entries) {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = entry.name;
            this._importChoices.appendChild(option);
        }
        this._importRow.hidden = false;
        return this._waitImportSelection();
    }

    _waitImportSelection() {
        return new Promise(resolve => {
            this._finishImportSelection = value => {
                this._finishImportSelection = null;
                this._importRow.hidden = true;
                resolve(value);
            };
        });
    }

    _selectNativeFolder() {
        return this._selectBank(async (service, isCurrent) => {
            const entries = await service.selectFolder({ isCurrent });
            if (!isCurrent() || !entries) return null;
            const id = await this._chooseInstrument(entries);
            return isCurrent() ? entries.find(entry => entry.id === id) || null : null;
        });
    }

    _importFolder(files, path) {
        return this._selectBank(async (service, isCurrent) => {
            if (!files) {
                if (typeof window.showDirectoryPicker === 'function') {
                    const handle = await window.showDirectoryPicker();
                    if (!isCurrent()) return null;
                    const module = await import('../../js/sfz/service.js');
                    if (!isCurrent()) return null;
                    files = await module.enumerateSfzDirectory(handle, { isCurrent });
                } else {
                    const selection = this._waitImportSelection();
                    this._folderInput.click();
                    files = await selection;
                }
            }
            if (!isCurrent() || !files?.length) return null;
            if (!path) {
                const module = await import('../../js/sfz/service.js');
                if (!isCurrent()) return null;
                path = await this._acceptFolder(files, module);
            }
            if (!isCurrent() || !path) return null;
            return service.importFolderFiles(files, path, {
                decode: (bytes, rate) => this._decodeAudioData(bytes, rate)
            });
        });
    }

    async _selectBank(select) {
        this._resetLoadNotice();
        this._initialAssetLoad = true;
        this._finishImportSelection?.(null);
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
                this._name = '';
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
                    this._finishImportSelection?.(null);
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

    createUI() {
        const container = document.createElement('div');
        container.className = 'sfz-note-player-plugin-ui plugin-parameter-ui';
        const bankRow = document.createElement('div');
        bankRow.className = 'parameter-row sfz-bank-row';
        const label = document.createElement('label');
        label.textContent = 'SFZ:';
        this._bankSelect = document.createElement('select');
        this._bankSelect.id = `${this.id}-sfz-bank`;
        label.htmlFor = this._bankSelect.id;
        this._bankSelect.addEventListener('change', event => {
            const id = event.target.value;
            return this._selectBank(async () => ({ id }));
        });
        const button = (text, action) => {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = text;
            element.addEventListener('click', action);
            return element;
        };
        this._removeButton = button('Remove', async () => {
            try {
                await (await this._getLibraryService()).remove(this.sf);
                this.setParameters({ sf: '' });
                await this._refreshBanks();
            } catch (error) { this._showError(error); }
        });
        bankRow.append(label, this._bankSelect,
            window.electronAPI
                ? button('Select SFZ Folder…', () => this._selectNativeFolder())
                : button('Import Folder…', () => this._chooseFolder()),
            this._removeButton);
        this._folderInput = document.createElement('input');
        this._folderInput.type = 'file';
        this._folderInput.multiple = true;
        this._folderInput.setAttribute('webkitdirectory', '');
        this._folderInput.hidden = true;
        this._folderInput.addEventListener('change', () => {
            this._finishImportSelection?.(Array.from(this._folderInput.files || []));
            this._folderInput.value = '';
        });
        this._folderInput.addEventListener('cancel', () => this._finishImportSelection?.(null));
        this._status = document.createElement('div');
        this._status.className = 'sfz-bank-status';
        this._status.setAttribute('role', 'status');
        this._status.setAttribute('aria-live', 'polite');
        this._importRow = document.createElement('div');
        this._importRow.className = 'parameter-row sfz-bank-row';
        this._importRow.hidden = true;
        this._importChoices = document.createElement('select');
        this._importChoices.setAttribute('aria-label', 'SFZ');
        this._importRow.append(this._importChoices,
            button(window.electronAPI ? 'Select' : 'Import', () =>
                this._finishImportSelection?.(this._importChoices.value)));
        const controls = document.createElement('div');
        controls.className = 'sfz-controls analyzer-parameters';
        controls.append(bankRow, this._folderInput, this._importRow, this._status);
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
            ['og', 'Output Gain', -60, 12, 0.1, 'dB'],
            ['tm', 'Timing', -100, 100, 1, 'ms']
        ]) controls.appendChild(this.createParameterControl(labelText, min, max, step, this[key],
            value => this.setParameters({ [key]: value }), unit, key));
        controls.append(this._noteControl('Lowest Note', 'mn'), this._noteControl('Highest Note', 'mx'));
        container.appendChild(controls);
        this._refreshBanks().catch(error => this._showError(error, false));
        this._renderStatus();
        this._showLoadNotice();
        return container;
    }

    cleanup() {
        this._resetLoadNotice();
        ++this._generation;
        this._finishImportSelection?.(null);
        this._pending = null;
        this._importing = false;
        this._bankSelect = this._status = this._removeButton = null;
        super.cleanup();
    }
}

window.SFZNotePlayerPlugin = SFZNotePlayerPlugin;
