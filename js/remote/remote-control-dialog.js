import { closeStandardSelect, enableStandardSelects } from '../ui/standard-select.js';

export class RemoteControlDialog {
    constructor(win, api) {
        this.win = win;
        this.doc = win.document;
        this.api = api;
        this.overlay = null;
    }

    t(key, params) {
        return this.win.uiManager.t(`dialog.remoteControl.${key}`, params);
    }

    show() {
        if (this.overlay) {
            this.dialog.focus();
            return;
        }
        this.previousFocus = this.doc.activeElement;
        this.status = null;
        this.busy = false;
        this.selected = 0;
        const overlay = this.doc.createElement('div');
        overlay.className = 'modal-overlay remote-control-overlay';
        overlay.innerHTML = `
            <div class="remote-control-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-control-title" tabindex="-1">
                <h2 id="remote-control-title"></h2>
                <div class="remote-control-content">
                    <div class="checkbox-container">
                        <input type="checkbox" id="remote-control-enabled" disabled>
                        <label for="remote-control-enabled" id="remote-control-enabled-label"></label>
                    </div>
                    <p id="remote-control-status" class="remote-control-help" role="status" aria-live="polite"></p>
                    <ul id="remote-control-devices" class="remote-control-devices" hidden></ul>
                    <div id="remote-control-pairing" hidden>
                        <img id="remote-control-qr" class="remote-control-qr">
                        <div id="remote-control-network-field" class="remote-control-field" hidden>
                            <label for="remote-control-network" id="remote-control-network-label"></label>
                            <select id="remote-control-network" class="config-select"></select>
                        </div>
                        <div class="remote-control-field">
                            <label id="remote-control-link-label"></label>
                            <div id="remote-control-link" class="remote-control-link" tabindex="0" aria-labelledby="remote-control-link-label"></div>
                        </div>
                        <div class="dialog-buttons remote-control-actions">
                            <button type="button" id="remote-control-copy"></button>
                            <button type="button" id="remote-control-token"></button>
                        </div>
                    </div>
                    <div class="remote-control-field remote-control-join-section">
                        <label for="remote-control-join-input" id="remote-control-join-label"></label>
                        <div class="remote-control-join-row">
                            <input type="text" id="remote-control-join-input" spellcheck="false" autocomplete="off" placeholder="http://192.168.0.5:47300/?t=…">
                            <div class="dialog-buttons"><button type="button" id="remote-control-join"></button></div>
                        </div>
                    </div>
                    <p id="remote-control-error" class="remote-control-error" role="alert" hidden></p>
                </div>
                <div class="dialog-buttons remote-control-footer"><button type="button" id="remote-control-close"></button></div>
            </div>`;
        this.overlay = overlay;
        this.doc.body.appendChild(overlay);
        this.dialog = overlay.querySelector('[role="dialog"]');
        this.elements = Object.fromEntries([
            'title', 'enabled', 'enabled-label', 'status', 'devices', 'pairing', 'qr',
            'network-field', 'network', 'network-label', 'link-label', 'link', 'copy',
            'token', 'join-label', 'join-input', 'join', 'error', 'close'
        ].map(name => [name, this.doc.getElementById(`remote-control-${name}`)]));
        const el = this.elements;
        for (const [name, key] of Object.entries({
            title: 'title', 'enabled-label': 'enabled', 'network-label': 'network',
            'link-label': 'link', copy: 'copy', token: 'newToken', 'join-label': 'joinAnother', join: 'join'
        })) el[name].textContent = this.t(key);
        el.qr.alt = this.t('qrAlt');
        el.close.textContent = this.win.uiManager.t('dialog.config.close');
        enableStandardSelects(overlay);

        el.enabled.addEventListener('change', () => {
            const enabled = el.enabled.checked;
            void this.updateSettings(() => this.api.setEnabled(enabled));
        });
        el.token.addEventListener('click', () => this.updateSettings(() => this.api.regenerateToken()));
        el.network.addEventListener('change', () => {
            this.selected = Number(el.network.value);
            this.render();
        });
        el.copy.addEventListener('click', () => this.copyLink());
        el.join.addEventListener('click', () => this.join());
        el['join-input'].addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.join();
            }
        });
        el.close.addEventListener('click', () => this.close());
        overlay.addEventListener('click', event => { if (event.target === overlay) this.close(); });
        overlay.addEventListener('keydown', event => event.stopPropagation());
        this.handleKeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.close();
            } else if (event.key === 'Tab') {
                const controls = [...overlay.querySelectorAll('button, input, select, [tabindex="0"]')]
                    .filter(element => !element.disabled && element.getClientRects().length > 0);
                const first = controls[0];
                const last = controls.at(-1);
                if (event.shiftKey && (this.doc.activeElement === first || this.doc.activeElement === this.dialog)) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (this.doc.activeElement === last || this.doc.activeElement === this.dialog)) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        this.doc.addEventListener('keydown', this.handleKeydown, true);
        this.removeStatusListener = this.api.onStatus(status => {
            this.status = status;
            this.render();
        });
        this.render();
        this.dialog.focus();
        void this.updateSettings(() => this.api.getStatus());
    }

    render() {
        const el = this.elements;
        const s = this.status;
        el.enabled.checked = s?.enabled === true;
        el.enabled.disabled = this.busy || !s;
        el.token.disabled = this.busy || !s;
        el.copy.disabled = this.busy;
        el.join.disabled = this.busy;
        let text;
        if (!s) text = this.t('loading');
        else if (s.error) text = this.t('startFailed');
        else if (!s.enabled) text = this.t('off');
        else if (!s.running) text = this.t('starting');
        else {
            text = this.t('connected', { count: s.clients, port: s.port });
            if (!s.addresses.length) text += ` · ${this.t('noNetwork')}`;
        }
        el.status.textContent = text;
        el.status.classList.toggle('remote-control-error', !!s?.error);
        const devices = s?.running ? s.devices : [];
        el.devices.replaceChildren(...devices.map(device => {
            const item = this.doc.createElement('li');
            item.textContent = `${device.app || this.t('device')}${device.version ? ` ${device.version}` : ''}` +
                (device.address ? ` · ${device.address}` : '');
            return item;
        }));
        el.devices.hidden = devices.length === 0;
        const addresses = s?.addresses || [];
        el.pairing.hidden = !(s?.running && addresses.length);
        if (!addresses.length) return;
        if (this.selected >= addresses.length) this.selected = 0;
        el['network-field'].hidden = addresses.length < 2;
        el.network.replaceChildren(...addresses.map((address, index) => {
            const option = this.doc.createElement('option');
            option.value = String(index);
            option.textContent = `${address.address} (${address.name})`;
            option.selected = index === this.selected;
            return option;
        }));
        const current = addresses[this.selected];
        el.link.textContent = current.webUrl;
        if (current.webQr) el.qr.src = current.webQr;
        else el.qr.removeAttribute('src');
    }

    showError(key) {
        this.elements.error.textContent = this.t(key);
        this.elements.error.hidden = false;
    }

    updateSettings(task) {
        return this.run(task, 'updateFailed', status => { this.status = status; });
    }

    async run(task, errorKey, applyResult) {
        if (this.busy) return;
        const overlay = this.overlay;
        this.busy = true;
        this.elements.error.hidden = true;
        this.render();
        try {
            const result = await task();
            if (this.overlay === overlay) applyResult(result);
        } catch (error) {
            console.error('[remote] dialog action failed:', error);
            if (this.overlay === overlay) this.showError(errorKey);
        } finally {
            if (this.overlay === overlay) {
                this.busy = false;
                this.render();
            }
        }
    }

    copyLink() {
        return this.run(async () => {
            if (!await this.api.copyLink(this.selected)) throw new Error('copy failed');
        }, 'copyFailed', () => {
            this.elements.copy.textContent = this.t('copied');
            this.win.clearTimeout(this.copyTimer);
            this.copyTimer = this.win.setTimeout(() => {
                this.elements.copy.textContent = this.t('copy');
            }, 1500);
        });
    }

    join() {
        return this.run(async () => {
            const result = await this.api.join(this.elements['join-input'].value);
            if (!result?.ok) throw new Error(result?.error || 'join failed');
        }, 'joinFailed', () => { this.elements['join-input'].value = ''; });
    }

    close() {
        if (!this.overlay) return;
        closeStandardSelect(this.doc);
        this.removeStatusListener?.();
        this.doc.removeEventListener('keydown', this.handleKeydown, true);
        this.win.clearTimeout(this.copyTimer);
        this.overlay.remove();
        this.overlay = null;
        this.previousFocus?.focus();
    }
}
