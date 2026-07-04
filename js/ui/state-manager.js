export class StateManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        
        // UI elements
        this.errorDisplay = document.getElementById('errorDisplay');
        this.resetButton = document.getElementById('resetButton');
        this.settingsMenuButton = document.getElementById('settingsMenuButton');
        this.settingsMenu = document.getElementById('settingsMenu');
        this.configSettingsButton = document.getElementById('configSettingsButton');
        this.audioConfigSettingsButton = document.getElementById('audioConfigSettingsButton');
        this.benchmarkSettingsButton = document.getElementById('benchmarkSettingsButton');
        this.measurementSettingsButton = document.getElementById('measurementSettingsButton');
        this.resetAudioSettingsButton = document.getElementById('resetAudioSettingsButton');
        this.shareButton = document.getElementById('shareButton');
        this.sampleRate = document.getElementById('sampleRate');
        
        this.updateLabels();
        
        this.initEventListeners();
    }

    initEventListeners() {
        this.resetButton?.addEventListener('click', () => this.openAudioConfig());
        this.audioConfigSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openAudioConfig()));
        this.configSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openConfig()));
        this.benchmarkSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openFeaturePage('features/effetune_bench.html')));
        this.measurementSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openFeaturePage('features/measurement/measurement.html')));
        this.resetAudioSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.resetAudio()));

        this.settingsMenuButton?.addEventListener('click', event => {
            event?.stopPropagation?.();
            if (this.isElectronEnvironment()) {
                this.closeSettingsMenu();
                this.openAudioConfig();
            } else {
                this.toggleSettingsMenu();
            }
        });

        if (this.settingsMenu && typeof document.addEventListener === 'function') {
            document.addEventListener('click', event => {
                if (event?.target === this.settingsMenuButton || event?.target === this.settingsMenu) {
                    return;
                }
                this.closeSettingsMenu();
            });
            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    this.closeSettingsMenu();
                }
            });
        }
    }

    translate(key, fallback) {
        const translated = window.uiManager?.t ? window.uiManager.t(key) : '';
        return translated && translated !== key ? translated : fallback;
    }

    isElectronEnvironment() {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
        return Boolean(
            window.electronAPI ||
            window.electronIntegration?.isElectron ||
            window.electronIntegration?.isElectronEnvironment?.() ||
            userAgent.includes(' electron/')
        );
    }

    updateLabels() {
        if (this.resetButton) {
            this.resetButton.hidden = true;
        }
        const isElectron = this.isElectronEnvironment();
        const settingsLabel = isElectron
            ? this.translate('ui.configAudioButton', 'Config Audio')
            : this.translate('menu.settings', 'Settings');
        if (this.settingsMenuButton) {
            this.settingsMenuButton.title = settingsLabel;
            this.settingsMenuButton.setAttribute?.('aria-label', settingsLabel);
        }
        if (this.settingsMenu) {
            this.settingsMenu.hidden = isElectron;
            if (isElectron) {
                this.closeSettingsMenu();
            }
        }
        if (this.configSettingsButton) {
            this.configSettingsButton.textContent = this.translate('dialog.config.title', 'Config');
        }
        if (this.audioConfigSettingsButton) {
            this.audioConfigSettingsButton.textContent = this.translate('dialog.audioConfig.title', 'Audio Configuration');
        }
        if (this.benchmarkSettingsButton) {
            this.benchmarkSettingsButton.textContent = this.translate('menu.settings.performanceBenchmark', 'Performance Benchmark');
        }
        if (this.measurementSettingsButton) {
            this.measurementSettingsButton.textContent = this.translate('menu.settings.frequencyResponseMeasurement', 'Frequency Response Measurement');
        }
        if (this.resetAudioSettingsButton) {
            this.resetAudioSettingsButton.textContent = this.translate('ui.resetButton', 'Reset Audio');
        }
    }

    runMenuAction(action) {
        this.closeSettingsMenu();
        return action();
    }

    toggleSettingsMenu() {
        if (!this.settingsMenu) return;
        this.settingsMenu.classList.toggle('show');
    }

    closeSettingsMenu() {
        this.settingsMenu?.classList.remove('show');
    }

    openAudioConfig() {
        if (typeof window.electronIntegration?.showAudioConfigDialog === 'function') {
            this.setError(this.translate('status.configuringAudio', 'Configuring audio devices...'));
            window.electronIntegration.showAudioConfigDialog();
            return;
        }

        this.setError(this.translate('status.reloading', 'Reloading...'));
        window.location.reload();
    }

    openConfig() {
        if (typeof window.electronIntegration?.showConfigDialog === 'function') {
            window.electronIntegration.showConfigDialog();
        }
    }

    openFeaturePage(path) {
        window.location.href = path;
    }

    async resetAudio() {
        if (typeof this.audioManager?.reset === 'function') {
            this.setError(this.translate('status.resettingAudio', 'Resetting audio...'));
            const result = await this.audioManager.reset(null);
            if (result) {
                this.setError(result, true);
            } else {
                this.clearError();
            }
            return;
        }
        this.setError(this.translate('status.reloading', 'Reloading...'));
        window.location.reload();
    }

    setError(message, isError = false) {
        this.errorDisplay.textContent = message;
        this.errorDisplay.classList.toggle('error-message', isError);
    }

    clearError() {
        this.errorDisplay.textContent = '';
    }

    // Call this method after audio context is initialized
    initAudio() {
        if (this.audioManager.audioContext) {
            this.sampleRate.textContent = `${this.audioManager.audioContext.sampleRate} Hz`;
        }
    }
}
