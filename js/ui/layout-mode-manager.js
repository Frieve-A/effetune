export class LayoutModeManager {
    constructor({
        // The desktop layout (plugin list + pipeline) needs at least 1159px of
        // viewport width before horizontal scrolling kicks in, so tablets and
        // narrower windows get the mobile layout.
        mediaQuery = '(max-width: 1158px)',
        // Standalone (installed PWA) detection is tracked so UI such as the
        // install action can react to it; the layout itself is width-driven.
        installedQuery = '(display-mode: standalone)',
        windowRef = typeof window !== 'undefined' ? window : {},
        documentRef = typeof document !== 'undefined' ? document : { body: null }
    } = {}) {
        this.windowRef = windowRef;
        this.documentRef = documentRef;
        this.listeners = new Set();
        const stubQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
        this.query = this.windowRef.matchMedia
            ? this.windowRef.matchMedia(mediaQuery)
            : { ...stubQuery };
        this.installedMedia = this.windowRef.matchMedia
            ? this.windowRef.matchMedia(installedQuery)
            : { ...stubQuery };
        this.appliedMode = null;
        this.handleQueryChange = () => this.applyMode();

        for (const media of [this.query, this.installedMedia]) {
            if (typeof media.addEventListener === 'function') {
                media.addEventListener('change', this.handleQueryChange);
            } else if (typeof media.addListener === 'function') {
                media.addListener(this.handleQueryChange);
            }
        }

        // Installing from a browser tab fires `appinstalled` without changing
        // the current tab's display-mode, so re-evaluate the layout then too.
        if (typeof this.windowRef.addEventListener === 'function') {
            this.windowRef.addEventListener('appinstalled', this.handleQueryChange);
        }

        this.applyMode();
    }

    get isInstalled() {
        if (this.installedMedia?.matches) return true;
        // iOS Safari exposes standalone launches via navigator.standalone.
        return !!this.windowRef.navigator?.standalone;
    }

    get isElectron() {
        const integration = this.windowRef.electronIntegration;
        if (!integration) return false;
        if (typeof integration.isElectronEnvironment === 'function') {
            return !!integration.isElectronEnvironment();
        }
        return !!integration.isElectron;
    }

    get mode() {
        if (this.isElectron) return 'desktop';
        return this.query.matches ? 'mobile' : 'desktop';
    }

    get isMobile() {
        return this.mode === 'mobile';
    }

    applyMode() {
        const mode = this.mode;
        if (mode === this.appliedMode) return;

        this.appliedMode = mode;
        const body = this.documentRef.body;
        const root = this.documentRef.documentElement;
        if (body?.classList) {
            body.classList.toggle('layout-mobile', mode === 'mobile');
            body.classList.toggle('layout-desktop', mode === 'desktop');
        }
        if (root?.classList) {
            root.classList.toggle('layout-mobile', mode === 'mobile');
            root.classList.toggle('layout-desktop', mode === 'desktop');
        }

        for (const listener of this.listeners) {
            listener(mode);
        }
    }

    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    dispose() {
        for (const media of [this.query, this.installedMedia]) {
            if (typeof media.removeEventListener === 'function') {
                media.removeEventListener('change', this.handleQueryChange);
            } else if (typeof media.removeListener === 'function') {
                media.removeListener(this.handleQueryChange);
            }
        }
        if (typeof this.windowRef.removeEventListener === 'function') {
            this.windowRef.removeEventListener('appinstalled', this.handleQueryChange);
        }
        this.listeners.clear();
    }
}
