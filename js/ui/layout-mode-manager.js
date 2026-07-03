export class LayoutModeManager {
    constructor({
        mediaQuery = '(max-width: 767px)',
        windowRef = typeof window !== 'undefined' ? window : {},
        documentRef = typeof document !== 'undefined' ? document : { body: null }
    } = {}) {
        this.windowRef = windowRef;
        this.documentRef = documentRef;
        this.listeners = new Set();
        this.query = this.windowRef.matchMedia
            ? this.windowRef.matchMedia(mediaQuery)
            : { matches: false, addEventListener() {}, removeEventListener() {} };
        this.appliedMode = null;
        this.handleQueryChange = () => this.applyMode();

        if (typeof this.query.addEventListener === 'function') {
            this.query.addEventListener('change', this.handleQueryChange);
        } else if (typeof this.query.addListener === 'function') {
            this.query.addListener(this.handleQueryChange);
        }

        this.applyMode();
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
        if (typeof this.query.removeEventListener === 'function') {
            this.query.removeEventListener('change', this.handleQueryChange);
        } else if (typeof this.query.removeListener === 'function') {
            this.query.removeListener(this.handleQueryChange);
        }
        this.listeners.clear();
    }
}
