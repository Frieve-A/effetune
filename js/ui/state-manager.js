import { createUserDataBackupAdapter } from '../user-data-backup/adapters.js';
import { openUserDataBackupDialog } from '../user-data-backup/dialog.js';
import { UserDataBackupService } from '../user-data-backup/service.js';

export class StateManager {
    constructor(audioManager, showNotification = null) {
        this.audioManager = audioManager;
        this.showNotification = showNotification;
        
        // UI elements
        this.errorDisplay = document.getElementById('errorDisplay');
        this.resetButton = document.getElementById('resetButton');
        this.settingsMenuButton = document.getElementById('settingsMenuButton');
        this.settingsMenu = document.getElementById('settingsMenu');
        this.installAppElement = document.getElementById('installAppElement');
        this.installAppButton = document.getElementById('installAppButton');
        this.configSettingsButton = document.getElementById('configSettingsButton');
        this.tourSettingsButton = document.getElementById('tourSettingsButton');
        this.audioConfigSettingsButton = document.getElementById('audioConfigSettingsButton');
        this.benchmarkSettingsButton = document.getElementById('benchmarkSettingsButton');
        this.measurementSettingsButton = document.getElementById('measurementSettingsButton');
        this.backupRestoreSettingsButton = document.getElementById('backupRestoreSettingsButton');
        this.resetAudioSettingsButton = document.getElementById('resetAudioSettingsButton');
        this.shareButton = document.getElementById('shareButton');
        this.sampleRate = document.getElementById('sampleRate');
        this.installCompleted = this.isInstalledDisplayMode();
        this.nativeInstallUnavailable = false;
        
        this.updateLabels();
        
        this.initEventListeners();
    }

    initEventListeners() {
        this.resetButton?.addEventListener('click', () => this.openAudioConfig());
        this.installAppButton?.addEventListener('click', () => this.runMenuAction(() => this.installApp()));
        this.installAppElement?.addEventListener?.('validationstatuschanged', event => {
            if (event?.target?.invalidReason) {
                this.nativeInstallUnavailable = true;
                this.updateInstallAvailability();
            }
        });
        this.audioConfigSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openAudioConfig()));
        this.configSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openConfig()));
        this.tourSettingsButton?.addEventListener('click', () => this.runMenuAction(() => window.uiManager.startOnboardingTour()));
        this.benchmarkSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openFeaturePage('features/effetune_bench.html')));
        this.measurementSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openFeaturePage('features/measurement/measurement.html')));
        this.backupRestoreSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.openBackupRestore()));
        this.resetAudioSettingsButton?.addEventListener('click', () => this.runMenuAction(() => this.resetAudio()));

        this.settingsMenuButton?.addEventListener('click', event => {
            event?.stopPropagation?.();
            this.toggleSettingsMenu();
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

        // The install prompt is captured in the page head; keep the menu item in
        // sync with its availability.
        window.addEventListener?.('pwa-install-available', () => {
            this.installCompleted = false;
            this.updateInstallAvailability();
        });
        const markInstallCompleted = () => {
            this.installCompleted = true;
            this.updateInstallAvailability();
        };
        window.addEventListener?.('pwa-install-completed', markInstallCompleted);
        window.addEventListener?.('appinstalled', markInstallCompleted);
        this.updateInstallAvailability();
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

    supportsNativeInstallElement() {
        return typeof window !== 'undefined' && 'HTMLInstallElement' in window;
    }

    isInstalledDisplayMode() {
        const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
        const iosStandalone = typeof navigator !== 'undefined' && navigator.standalone;
        return Boolean(standaloneMedia?.matches || iosStandalone);
    }

    updateLabels() {
        if (this.resetButton) {
            this.resetButton.hidden = true;
        }
        const isElectron = this.isElectronEnvironment();
        const settingsLabel = this.translate('menu.settings', 'Settings');
        if (this.settingsMenuButton) {
            this.settingsMenuButton.title = settingsLabel;
            this.settingsMenuButton.setAttribute?.('aria-label', settingsLabel);
        }
        if (this.installAppButton) {
            this.installAppButton.textContent = this.translate('menu.settings.install', 'Install App');
        }
        if (this.configSettingsButton) {
            this.configSettingsButton.textContent = this.translate('dialog.config.title', 'Config');
        }
        if (this.tourSettingsButton) {
            this.tourSettingsButton.textContent = this.translate('tour.menu', 'Take the tour');
        }
        if (this.audioConfigSettingsButton) {
            this.audioConfigSettingsButton.textContent = this.translate('dialog.audioConfig.title', 'Audio Configuration');
        }
        if (this.benchmarkSettingsButton) {
            this.benchmarkSettingsButton.textContent = this.translate('menu.settings.performanceBenchmark', 'Performance Benchmark');
            this.benchmarkSettingsButton.hidden = isElectron;
        }
        if (this.measurementSettingsButton) {
            this.measurementSettingsButton.textContent = this.translate('menu.settings.frequencyResponseMeasurement', 'Acoustic Measurement');
            this.measurementSettingsButton.hidden = isElectron;
        }
        if (this.backupRestoreSettingsButton) {
            this.backupRestoreSettingsButton.textContent = this.translate('menu.settings.backupRestore', 'Backup / Restore');
        }
        if (this.resetAudioSettingsButton) {
            this.resetAudioSettingsButton.textContent = this.translate('ui.resetButton', 'Reset Audio');
        }
    }

    runMenuAction(action) {
        this.closeSettingsMenu();
        return action();
    }

    updateInstallAvailability() {
        if (!this.installAppElement && !this.installAppButton) return;
        const canOfferInstall = !this.isElectronEnvironment() &&
            !this.installCompleted &&
            !this.isInstalledDisplayMode();
        const canUseNativeInstall = canOfferInstall &&
            this.supportsNativeInstallElement() &&
            this.installAppElement &&
            !this.nativeInstallUnavailable;
        const canUseDeferredPrompt = canOfferInstall && Boolean(window.deferredInstallPrompt);

        if (this.installAppElement) {
            this.installAppElement.hidden = !canUseNativeInstall;
        }
        if (this.installAppButton) {
            this.installAppButton.hidden = canUseNativeInstall || !canUseDeferredPrompt;
        }
    }

    async installApp() {
        const promptEvent = window.deferredInstallPrompt;
        if (!promptEvent) return;
        // The prompt can only be used once; drop the reference and hide the item
        // regardless of the user's choice.
        window.deferredInstallPrompt = null;
        this.updateInstallAvailability();
        try {
            promptEvent.prompt();
            await promptEvent.userChoice;
        } catch (error) {
            console.warn('Install prompt failed:', error);
        }
    }

    toggleSettingsMenu() {
        if (!this.settingsMenu) return;
        if (this.settingsMenu.hidden) this.settingsMenu.hidden = false;
        this.settingsMenu.classList.toggle('show');
    }

    closeSettingsMenu() {
        this.settingsMenu?.classList.remove('show');
    }

    openAudioConfig() {
        if (typeof window.electronIntegration?.showAudioConfigDialog === 'function') {
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
        if (typeof window.app?.openFeaturePage === 'function') {
            return window.app.openFeaturePage(path);
        }
        window.uiManager?.flushPipelineStateToLocalStorage?.();
        window.location.href = path;
    }

    openBackupRestore() {
        const uiManager = window.uiManager;
        const adapter = createUserDataBackupAdapter({
            presetManager: uiManager?.pipelineManager?.presetManager,
            irLibrary: window.irLibraryService
        });
        const service = new UserDataBackupService({
            adapter,
            appVersion: document.getElementById('app-version')?.textContent || 'unknown'
        });
        return openUserDataBackupDialog({
            service,
            translate: (key, fallback, params) => {
                const translated = uiManager?.t?.(key, params);
                return translated && translated !== key ? translated : fallback.replace(
                    /\{([^}]+)\}/g,
                    (match, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : match
                );
            },
            onRestored: async () => {
                uiManager?.pluginListManager?.refreshPresetsIfVisible?.();
                await this.refreshMeasurementConsumers();
                window.electronIntegration?.updateTrayMenu?.(true);
            }
        });
    }

    refreshMeasurementConsumers() {
        const consumers = (this.audioManager?.pipeline || []).filter(plugin =>
            (plugin?.name === 'Room EQ' || plugin?.name === 'Crosstalk Cancellation') &&
            typeof plugin._refreshMeasurements === 'function');
        return Promise.all(consumers.map(plugin => plugin._refreshMeasurements(false)));
    }

    async resetAudio() {
        if (typeof this.audioManager?.reset === 'function') {
            const resettingMessage = this.translate('status.resettingAudio', 'Resetting audio...');
            const resettingNotice = this.notify(resettingMessage);
            const result = await this.audioManager.reset(null);
            if (result) {
                console.error('Audio reset failed:', result);
                this.notify(this.translate(
                    'error.audioResetFailed',
                    'Audio could not be reset. Check your audio devices and try again.'
                ), true);
            } else {
                resettingNotice.clear();
            }
            return;
        }
        this.setError(this.translate('status.reloading', 'Reloading...'));
        window.location.reload();
    }

    notify(message, isError = false) {
        if (typeof this.showNotification === 'function') {
            const notice = this.showNotification(message, isError);
            if (typeof notice?.clear === 'function') return notice;
        }

        this.setError(message, isError);
        return {
            clear: () => {
                if (this.errorDisplay.textContent === message) this.clearError();
            }
        };
    }

    setError(message, isError = false) {
        this.errorDisplay.textContent = message;
        this.errorDisplay.classList.toggle('error-message', isError);
    }

    clearError() {
        this.errorDisplay.textContent = '';
        this.errorDisplay.classList.remove('error-message');
    }

    // Call this method after audio context is initialized
    initAudio() {
        if (this.audioManager.audioContext) {
            this.sampleRate.textContent = `${this.audioManager.audioContext.sampleRate} Hz`;
        }
    }
}
