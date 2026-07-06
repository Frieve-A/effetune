const MENU_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" draggable="false"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const PROCESS_AUDIO_LABEL = 'Process Audio Files with Effects...';

export class MobileMenu {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.button = null;
        this.panel = null;
        this.backdrop = null;
        this.localizedActions = [];
        this.unsubscribe = this.uiManager.layoutMode?.onChange(() => this.sync()) || null;
        this.sync();
    }

    sync() {
        if (this.uiManager.layoutMode?.isMobile) {
            this.ensureElements();
            return;
        }
        this.removeElements();
    }

    ensureElements() {
        if (!this.button) {
            this.button = document.createElement('button');
            this.button.type = 'button';
            this.button.className = 'header-button mobile-menu-button';
            const menuLabel = this.translate('menu.settings', 'Menu');
            this.button.title = menuLabel;
            this.button.setAttribute('aria-label', menuLabel);
            this.button.innerHTML = MENU_ICON;
            this.button.addEventListener('click', () => this.toggle());
            const titleContainer = document.querySelector('.title-container');
            titleContainer?.appendChild(this.button);
        }

        if (!this.backdrop) {
            this.backdrop = document.createElement('div');
            this.backdrop.className = 'mobile-menu-backdrop';
            this.backdrop.addEventListener('click', () => this.close());
            document.body.appendChild(this.backdrop);
        }

        if (!this.panel) {
            this.panel = document.createElement('div');
            this.panel.className = 'mobile-overflow-menu';
            this.panel.setAttribute('role', 'menu');
            this.panel.appendChild(this.createLocalizedAction('menu.file.openMusicFile', 'Open music file...', () => document.getElementById('openMusicButton')?.click()));
            this.panel.appendChild(this.createLocalizedAction('menu.file.processAudioFiles', PROCESS_AUDIO_LABEL, () => this.processAudioFilesWithEffects()));
            this.panel.appendChild(this.createLocalizedAction('dialog.config.title', 'Config', () => this.uiManager.stateManager?.openConfig?.()));
            this.panel.appendChild(this.createLocalizedAction('dialog.audioConfig.title', 'Audio Configuration', () => this.uiManager.stateManager?.openAudioConfig?.()));
            this.panel.appendChild(this.createLocalizedAction('menu.settings.performanceBenchmark', 'Performance Benchmark', () => this.uiManager.stateManager?.openFeaturePage?.('features/effetune_bench.html')));
            this.panel.appendChild(this.createLocalizedAction('menu.settings.frequencyResponseMeasurement', 'Frequency Response Measurement', () => this.uiManager.stateManager?.openFeaturePage?.('features/measurement/measurement.html')));
            this.panel.appendChild(this.createLocalizedAction('ui.resetButton', 'Reset Audio', () => this.uiManager.stateManager?.resetAudio?.()));
            this.panel.appendChild(this.createLocalizedAction('ui.shareButton', 'Share', () => document.getElementById('shareButton')?.click()));
            this.panel.appendChild(this.createLocalizedAction('ui.whatsThisApp', "What's this app?", () => document.getElementById('whatsThisLink')?.click()));
            document.body.appendChild(this.panel);
        }
        this.updateLabels();
    }

    createAction(label, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mobile-overflow-menu-item';
        button.setAttribute('role', 'menuitem');
        button.textContent = label;
        button.addEventListener('click', () => {
            this.close();
            action();
        });
        return button;
    }

    createLocalizedAction(key, fallback, action) {
        const button = this.createAction(this.translate(key, fallback), action);
        this.localizedActions.push({ button, key, fallback });
        return button;
    }

    translate(key, fallback) {
        const translated = this.uiManager?.t ? this.uiManager.t(key) : '';
        return translated && translated !== key ? translated : fallback;
    }

    updateLabels() {
        const menuLabel = this.translate('menu.settings', 'Menu');
        if (this.button) {
            this.button.title = menuLabel;
            this.button.setAttribute?.('aria-label', menuLabel);
        }
        this.localizedActions.forEach(({ button, key, fallback }) => {
            button.textContent = this.translate(key, fallback);
        });
    }

    processAudioFilesWithEffects() {
        const electronIntegration = globalThis.window?.electronIntegration;
        const isElectron = electronIntegration?.isElectronEnvironment?.() || electronIntegration?.isElectron;
        if (isElectron && typeof electronIntegration?.processAudioFiles === 'function') {
            electronIntegration.processAudioFiles();
            return;
        }

        const fileProcessor = this.uiManager.pipelineManager?.fileProcessor;
        const selectFiles = fileProcessor?.dropArea?.querySelector?.('.select-files') ||
            document.querySelector?.('.file-drop-area .select-files');
        selectFiles?.click?.();
    }

    toggle() {
        if (this.panel?.classList.contains('mobile-open')) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.ensureElements();
        this.panel.classList.add('mobile-open');
        this.backdrop.classList.add('mobile-open');
    }

    close() {
        this.panel?.classList.remove('mobile-open');
        this.backdrop?.classList.remove('mobile-open');
    }

    removeElements() {
        this.close();
        this.button?.remove();
        this.panel?.remove();
        this.backdrop?.remove();
        this.button = null;
        this.panel = null;
        this.backdrop = null;
        this.localizedActions = [];
    }

    dispose() {
        this.unsubscribe?.();
        this.removeElements();
    }
}
