const MENU_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" draggable="false"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const PROCESS_AUDIO_LABEL = 'Process Audio File with Effects';

export class MobileMenu {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.button = null;
        this.panel = null;
        this.backdrop = null;
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
            this.button.title = 'Menu';
            this.button.setAttribute('aria-label', 'Menu');
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
            this.panel.appendChild(this.createAction('Open Music', () => document.getElementById('openMusicButton')?.click()));
            this.panel.appendChild(this.createAction(PROCESS_AUDIO_LABEL, () => this.processAudioFilesWithEffects()));
            this.panel.appendChild(this.createAction('Use audio input', () => this.uiManager.enableAudioInput?.()));
            this.panel.appendChild(this.createAction('Reset Audio', () => document.getElementById('resetButton')?.click()));
            this.panel.appendChild(this.createAction('Share', () => document.getElementById('shareButton')?.click()));
            this.panel.appendChild(this.createAction("What's this app?", () => document.getElementById('whatsThisLink')?.click()));
            document.body.appendChild(this.panel);
        }
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

    processAudioFilesWithEffects() {
        const electronIntegration = globalThis.window?.electronIntegration;
        if (typeof electronIntegration?.processAudioFiles === 'function') {
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
    }

    dispose() {
        this.unsubscribe?.();
        this.removeElements();
    }
}
