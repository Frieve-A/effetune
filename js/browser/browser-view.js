import { BrowserInputController } from '../audio/browser-input-controller.js';

const DEFAULT_START_PAGE = 'https://effetune.frieve.com/streaming/';

const ICONS = {
    back: '<path d="m14 6-6 6 6 6"/>',
    forward: '<path d="m10 6 6 6-6 6"/>',
    reload: '<path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    go: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    bookmarks: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    rename: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
    remove: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    save: '<path d="m5 12 4 4L19 6"/>',
    cancel: '<path d="m6 6 12 12M6 18 18 6"/>'
};

export class BrowserView {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.api = window.electronAPI.browser;
        this.visible = false;
        this.state = { settings: { bookmarks: [], startPage: '' } };
        this.root = document.createElement('section');
        this.root.id = 'browserView';
        this.root.hidden = true;
        const toolbar = document.createElement('div');
        toolbar.className = 'browser-toolbar';
        this.root.append(toolbar);
        this.back = this.button(toolbar, 'back', () => this.navigate(() => this.api.back()));
        this.forward = this.button(toolbar, 'forward', () => this.navigate(() => this.api.forward()));
        this.reload = this.button(toolbar, 'reload', () => this.state.loading ? this.run(() => this.api.stop()) : this.navigate(() => this.api.reload()));
        this.address = document.createElement('input');
        this.address.type = 'text';
        this.address.className = 'browser-address';
        this.address.autocomplete = 'off';
        this.address.spellcheck = false;
        this.address.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.address.blur();
                void this.navigate(() => this.api.navigate(this.address.value));
            } else if (event.key === 'Escape') {
                this.address.value = this.state.url || '';
                this.address.blur();
            }
        });
        toolbar.append(this.address);
        this.button(toolbar, 'go', () => { this.address.blur(); return this.navigate(() => this.api.navigate(this.address.value)); });
        this.bookmarkButton = this.button(toolbar, 'bookmarks', () => this.toggleBookmarks());
        this.bookmarkButton.setAttribute('aria-haspopup', 'dialog');
        this.bookmarkButton.setAttribute('aria-expanded', 'false');
        this.menuButton = this.button(toolbar, 'menu', () => this.toggleMenu());
        this.menuButton.setAttribute('aria-haspopup', 'menu');
        this.menuButton.setAttribute('aria-expanded', 'false');
        this.button(toolbar, 'close', () => this.close());
        this.status = document.createElement('p');
        this.status.className = 'browser-status';
        this.status.setAttribute('role', 'alert');
        this.status.hidden = true;
        this.root.append(this.status);
        this.content = document.createElement('div');
        this.content.className = 'browser-content';
        this.root.append(this.content);
        document.body.append(this.root);
        this.input = new BrowserInputController(uiManager.audioManager, this.api, state => {
            this.inputStatus = state;
            this.renderStatus();
        });
        this.unsubscribe = this.api.onState(state => this.applyState(state));
        this.unsubscribeFocus = this.api.onFocusAddress?.(() => {
            this.closePopup(false);
            this.address.focus();
            this.address.select();
        });
        this.resize = new ResizeObserver(() => this.syncPresentation());
        this.resize.observe(this.content);
        this.observer = new MutationObserver(() => this.syncPresentation());
        this.observer.observe(document.body, { subtree: true, childList: true,
            attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
        this.windowResize = () => this.syncPresentation();
        this.outsidePointer = event => {
            if (this.popup && !this.popup.contains(event.target) && !this.popupAnchor.contains(event.target)) {
                this.closePopup(false);
            }
        };
        document.addEventListener('pointerdown', this.outsidePointer);
        window.addEventListener('resize', this.windowResize);
        document.addEventListener('visibilitychange', this.windowResize);
        window.addEventListener('pagehide', () => {
            this.unsubscribe?.();
            this.unsubscribeFocus?.();
            this.input.unsubscribe?.();
            this.resize.disconnect();
            this.observer.disconnect();
            document.removeEventListener('pointerdown', this.outsidePointer);
            window.removeEventListener('resize', this.windowResize);
            document.removeEventListener('visibilitychange', this.windowResize);
        }, { once: true });
        this.updateUITexts();
        void this.run(() => this.api.getState());
    }

    t(key) { return this.uiManager.t(`browser.${key}`); }

    button(parent, key, action, { icon = true, className = 'header-button browser-icon-button' } = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        this.labelButton(button, key, icon);
        button.addEventListener('click', async () => {
            try {
                await action();
            } catch (error) {
                console.error('Browser action failed:', error);
                this.actionError = 'actionError';
                this.renderStatus();
            }
        });
        parent.append(button);
        return button;
    }

    labelButton(button, key, icon = true) {
        button.dataset.browserLabel = key;
        button.dataset.browserIcon = String(icon);
        button.title = this.t(key);
        button.setAttribute('aria-label', this.t(key));
        if (icon) {
            button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
        } else button.textContent = this.t(key);
    }

    updateUITexts() {
        this.root.setAttribute('aria-label', this.uiManager.t('dialog.config.browser.title'));
        for (const button of this.root.querySelectorAll('[data-browser-label]')) {
            this.labelButton(button, button.dataset.browserLabel, button.dataset.browserIcon === 'true');
        }
        this.address.placeholder = this.t('address');
        this.address.setAttribute('aria-label', this.t('address'));
        // Reopen popup text on the next activation, without discarding edits during translation updates.
        this.renderStatus();
    }

    renderStatus() {
        const inputError = ['error', 'deviceError'].includes(this.inputStatus) ? this.inputStatus : null;
        const pageError = this.state.error ? (this.state.error === 'captureEnded' ? 'error' : 'pageError') : null;
        const key = this.actionError || inputError || pageError;
        this.status.textContent = key ? this.t(key) : '';
        this.status.hidden = !key;
    }

    navigate(action) {
        if (this.closing) return Promise.resolve(false);
        // Capture must begin on the navigation gesture, before any asynchronous work.
        const capture = this.input.select();
        // Navigation can replace the frame while its capture tracks are still starting.
        return capture.then(() => this.visible === false || this.closing ? false : this.run(action));
    }

    async run(action, errorKey = 'pageError') {
        try {
            const state = await action();
            if (state.ok === false) {
                this.actionError = errorKey;
                this.renderStatus();
                return false;
            }
            this.actionError = null;
            this.applyState(state);
            return true;
        } catch (error) {
            console.error('Browser action failed:', error);
            this.actionError = errorKey;
            this.renderStatus();
            return false;
        }
    }

    applyState(state) {
        if (!state || state.ok === false) return;
        if (state.revision < this.state.revision) return;
        this.state = state;
        if (document.activeElement !== this.address) this.address.value = state.url || '';
        this.back.disabled = !state.canGoBack;
        this.forward.disabled = !state.canGoForward;
        this.labelButton(this.reload, state.loading ? 'stop' : 'reload');
        this.renderStatus();
    }

    openPopup(anchor, className, role, label) {
        this.closePopup(false);
        const popup = document.createElement('div');
        popup.className = className;
        popup.setAttribute('role', role);
        popup.setAttribute('aria-label', this.t(label));
        this.popup = popup;
        this.popupAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');
        popup.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.closePopup();
            }
            if (role === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...popup.querySelectorAll('button:not(:disabled)')];
                const index = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }
        });
        popup.addEventListener('focusout', event => {
            if (event.relatedTarget && !popup.contains(event.relatedTarget) && event.relatedTarget !== anchor) {
                this.closePopup(false);
            }
        });
        this.root.append(popup);
        void this.syncPresentation();
        return popup;
    }

    closePopup(restoreFocus = true) {
        if (!this.popup) return;
        const anchor = this.popupAnchor;
        this.popup.remove();
        this.popup = null;
        this.popupAnchor = null;
        anchor.setAttribute('aria-expanded', 'false');
        if (restoreFocus) anchor.focus();
        void this.syncPresentation();
    }

    toggleMenu() {
        if (this.popupAnchor === this.menuButton) { this.closePopup(); return; }
        const popup = this.openPopup(this.menuButton, 'settings-menu show browser-menu', 'menu', 'menu');
        for (const [key, action] of [
            ['external', () => this.run(() => this.api.openExternal(), 'actionError')],
            ['start', () => this.saveSettings({ startPage: this.state.url })],
            ['clear', () => this.clearSiteData()]
        ]) {
            const button = this.button(popup, key, async () => {
                this.closePopup();
                await action();
            }, { icon: false, className: 'settings-menu-item' });
            button.setAttribute('role', 'menuitem');
            button.disabled = key !== 'clear' && !this.hasPage();
        }
        popup.querySelector('button:not(:disabled)')?.focus();
    }

    hasPage() { return /^https?:\/\//i.test(this.state.url || ''); }

    toggleBookmarks() {
        if (this.popupAnchor === this.bookmarkButton) { this.closePopup(); return; }
        const dialog = this.openPopup(this.bookmarkButton, 'preset-dialog browser-bookmarks', 'dialog', 'bookmarks');
        const header = document.createElement('div');
        header.className = 'preset-dialog-header';
        const title = document.createElement('span');
        title.textContent = this.t('bookmarks');
        header.append(title);
        this.button(header, 'close', () => this.closePopup(), { className: 'routing-dialog-close preset-dialog-close browser-icon-button' });
        dialog.append(header);
        const content = document.createElement('div');
        content.className = 'preset-dialog-content';
        const saveRow = document.createElement('form');
        saveRow.className = 'preset-dialog-save-row';
        const name = this.nameInput(this.state.title || this.state.url || '');
        name.className = 'preset-dialog-name-input';
        name.disabled = !this.hasPage();
        saveRow.append(name);
        const save = async () => {
            if (!name.value.trim() || !this.hasPage() || add.disabled) return;
            add.disabled = true;
            if (await this.saveSettings({ bookmarks: [...this.state.settings.bookmarks, { name: name.value.trim(), url: this.state.url }] })) {
                this.renderBookmarks(list);
            }
            add.disabled = !name.value.trim() || !this.hasPage();
        };
        const add = this.button(saveRow, 'add', save);
        const updateSave = () => { add.disabled = !name.value.trim() || !this.hasPage(); };
        name.addEventListener('input', updateSave);
        saveRow.addEventListener('submit', event => { event.preventDefault(); void save(); });
        updateSave();
        content.append(saveRow);
        const list = document.createElement('div');
        list.className = 'preset-dialog-section';
        content.append(list);
        dialog.append(content);
        this.renderBookmarks(list);
        (list.querySelector('button') || name).focus();
    }

    nameInput(value) {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 120;
        input.value = value.slice(0, 120);
        input.placeholder = this.t('name');
        input.setAttribute('aria-label', this.t('name'));
        return input;
    }

    renderBookmarks(list) {
        list.replaceChildren();
        const bookmarks = this.state.settings.bookmarks;
        if (!bookmarks.length) {
            const empty = document.createElement('div');
            empty.className = 'preset-dialog-empty';
            empty.textContent = this.t('emptyBookmarks');
            list.append(empty);
        }
        for (const [index, bookmark] of bookmarks.entries()) {
            const row = document.createElement('div');
            row.className = 'preset-dialog-user-row browser-bookmark-row';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'preset-dialog-user-preset';
            open.textContent = bookmark.name;
            open.title = bookmark.url;
            open.addEventListener('click', () => {
                this.closePopup();
                void this.navigate(() => this.api.navigate(bookmark.url));
            });
            row.append(open);
            this.button(row, 'rename', () => this.renameBookmark(list, row, index));
            const remove = this.button(row, 'remove', async () => {
                remove.disabled = true;
                const next = [...this.state.settings.bookmarks];
                next.splice(index, 1);
                if (await this.saveSettings({ bookmarks: next })) {
                    this.renderBookmarks(list);
                    (list.querySelector('button') || this.popup?.querySelector('input'))?.focus();
                } else remove.disabled = false;
            });
            list.append(row);
        }
    }

    renameBookmark(list, row, index) {
        const bookmark = this.state.settings.bookmarks[index];
        row.replaceChildren();
        const name = this.nameInput(bookmark.name);
        name.className = 'preset-dialog-rename-input';
        row.append(name);
        const finish = async () => {
            if (!name.value.trim() || save.disabled) return;
            save.disabled = true;
            const bookmarks = [...this.state.settings.bookmarks];
            bookmarks[index] = { ...bookmark, name: name.value.trim() };
            if (await this.saveSettings({ bookmarks })) {
                this.renderBookmarks(list);
                list.querySelectorAll('.preset-dialog-user-preset')[index]?.focus();
            } else save.disabled = false;
        };
        const save = this.button(row, 'save', finish);
        this.button(row, 'cancel', () => {
            this.renderBookmarks(list);
            list.querySelectorAll('.preset-dialog-user-preset')[index]?.focus();
        });
        name.addEventListener('input', () => { save.disabled = !name.value.trim(); });
        name.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); void finish(); }
            else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.renderBookmarks(list);
                list.querySelectorAll('.preset-dialog-user-preset')[index]?.focus();
            }
        });
        name.focus();
        name.select();
    }

    async show(capture) {
        this.visible = true;
        this.root.hidden = false;
        await this.syncPresentation();
        // Present the capture target first, then keep its frame stable until tracks start.
        await capture;
        if (!this.visible || this.closing) return;
        this.address.focus();
        if (!this.loadedStartPage) {
            this.loadedStartPage = true;
            await this.run(() => this.api.navigate(this.state.settings?.startPage || DEFAULT_START_PAGE));
        }
    }

    close() {
        if (this.closing) return this.closing;
        this.closePopup(false);
        this.closing = (async () => {
            if (await this.input.release() !== true) return false;
            return this.uiManager.showEffectPipelineView();
        })().finally(() => { this.closing = null; });
        return this.closing;
    }

    hide() {
        this.visible = false;
        this.closePopup(false);
        this.root.hidden = true;
        void this.syncPresentation();
    }

    syncPresentation() {
        const zoomFactor = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
        const header = document.querySelector('.title-container');
        const top = header?.getBoundingClientRect().bottom || 0;
        const topStyle = `${top / zoomFactor}px`;
        if (this.root.style.top !== topStyle) this.root.style.top = topStyle;
        const modal = [...document.querySelectorAll('.settings-menu, .modal-overlay, .dialog-overlay, [role="dialog"], dialog[open]')]
            .some(node => node !== this.root && node.getClientRects().length > 0 &&
                getComputedStyle(node).visibility !== 'hidden');
        const visible = this.visible && document.body.classList.contains('view-browser') &&
            !document.body.classList.contains('layout-mini-player') && !document.hidden && !modal && !this.confirming;
        const rect = this.content.getBoundingClientRect();
        const presentation = { visible, zoomFactor, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        const key = JSON.stringify(presentation);
        if (key === this.presentationKey) return Promise.resolve();
        this.presentationKey = key;
        return this.api.setPresentation(presentation).catch(error => {
            this.presentationKey = null;
            console.error('Browser presentation failed:', error);
        });
    }

    saveSettings(patch) {
        return this.run(() => this.api.saveSettings(patch), 'actionError');
    }

    async clearSiteData() {
        this.confirming = true;
        await this.syncPresentation();
        try {
            if (window.confirm(this.t('confirmClear'))) {
                await this.input.release({ keepSelection: true });
                await this.run(() => this.api.clearSiteData(), 'actionError');
            }
        } finally {
            this.confirming = false;
            this.presentationKey = null;
            await this.syncPresentation();
        }
    }
}
