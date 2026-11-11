import { isAndroidHost } from './android/bridge.js';
import { installAndroidFileDownloads } from './android/file-downloads.js';
import { WebUpdateManager } from './web-update-manager.js';

function getDefaultWindow() {
    return typeof window !== 'undefined' ? window : {};
}

export function registerPipelineStateCloseHandler(
    getPipelineStateForSave,
    fadeOutOutput,
    electronAPI = getDefaultWindow().electronAPI,
    releaseAudioInput = () => getDefaultWindow().audioManager?.ioManager?.releaseAudioInput?.({ reason: 'close' })
) {
    if (electronAPI && electronAPI.onRequestPipelineStateForClose) {
        electronAPI.onRequestPipelineStateForClose(async () => {
            // Silence the output before the window closes.
            await fadeOutOutput();
            // Release the capture before the main process persists state so a
            // loopback capture (which mutes the Windows default output) ends
            // with the window instead of lingering until the process exits.
            releaseAudioInput();
            const pipelineState = getPipelineStateForSave();
            electronAPI.sendPipelineStateForClose(pipelineState);
        });
    }
}

export function registerTrayPresetListener({
    electronAPI = getDefaultWindow().electronAPI,
    electronBridge = getDefaultWindow().electronIntegration,
    windowRef = getDefaultWindow(),
    logger = console
} = {}) {
    if (electronAPI && electronBridge && electronBridge.isElectron) {
        electronAPI.onIPC('load-preset-from-tray', (presetName) => {
            if (
                windowRef.app &&
                windowRef.app.initialized &&
                windowRef.pipelineManager &&
                windowRef.pipelineManager.presetManager
            ) {
                windowRef.pipelineManager.presetManager.loadPreset(presetName).catch(error => {
                    logger.error('Error loading preset from tray:', error);
                });
            } else {
                windowRef.pendingTrayPresetName = presetName;
            }
        });
    }
}

export function createAndInitializeApp(AppClass, {
    windowRef = getDefaultWindow(),
    logger = console,
    onInitialized = null
} = {}) {
    const app = new AppClass();
    windowRef.app = app;

    const initialization = Promise.resolve(app.initialize()).catch(error => {
        logger.error('Failed to initialize app:', error);
    });
    if (typeof onInitialized === 'function') void initialization.then(onInitialized);

    return app;
}

export function isDevelopmentServer(windowRef = getDefaultWindow()) {
    return windowRef.EFFECTUNE_DEV_SERVER === true;
}

export function unregisterDevelopmentServiceWorkers(windowRef = getDefaultWindow(), logger = console) {
    const serviceWorker = windowRef.navigator?.serviceWorker;
    if (!serviceWorker?.getRegistrations) return;

    serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(error => {
            logger.warn('Development service worker cleanup failed:', error);
        });
}

export function startApplication({
    AppClass,
    firstLaunchPromise,
    startHeartbeat,
    registerTrayPresetListenerFn = registerTrayPresetListener,
    createAndInitializeAppFn = createAndInitializeApp,
    loadInitialConfigFn = null,
    windowRef = getDefaultWindow(),
    logger = console
} = {}) {
    startHeartbeat('main-page');
    installAndroidFileDownloads(windowRef);
    registerTrayPresetListenerFn({
        electronAPI: windowRef.electronAPI,
        electronBridge: windowRef.electronIntegration,
        windowRef,
        logger
    });

    const start = isFirstLaunch => {
        windowRef.isFirstLaunchConfirmed = isFirstLaunch;
        windowRef.isFirstLaunch = isFirstLaunch;
        let onInitialized;
        registerServiceWorker(windowRef, logger, new Promise(resolve => { onInitialized = resolve; }));
        const createApp = () => createAndInitializeAppFn(AppClass, { windowRef, logger, onInitialized });
        if (typeof loadInitialConfigFn === 'function') {
            return Promise.resolve(loadInitialConfigFn({ windowRef, logger }))
                .catch(error => {
                    logger.warn('Failed to load initial app config:', error);
                })
                .then(createApp);
        }
        return Promise.resolve(createApp());
    };

    return firstLaunchPromise.then(start).catch(error => {
        logger.error('Failed to check first launch status:', error);
        return start(false);
    });
}

// The update manager exists from startup so the app can report readiness to it,
// but registration waits until the app has initialized and the page is idle:
// installing a release downloads the whole precache, which must not compete
// with application startup.
export function registerServiceWorker(
    windowRef = getDefaultWindow(),
    logger = console,
    appInitialized = Promise.resolve()
) {
    const isElectron = windowRef.electronIntegration?.isElectronEnvironment?.() ||
        windowRef.electronIntegration?.isElectron;
    if (isElectron || isAndroidHost(windowRef) || !windowRef.navigator?.serviceWorker) return;
    if (isDevelopmentServer(windowRef)) {
        unregisterDevelopmentServiceWorkers(windowRef, logger);
        return;
    }
    const manager = windowRef.webUpdateManager || new WebUpdateManager(windowRef, logger);
    windowRef.webUpdateManager = manager;
    const register = () => {
        windowRef.navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .then(registration => manager.attach(registration))
            .catch(error => {
                logger.warn('Service worker registration failed:', error);
            });
    };
    const registerWhenIdle = () => {
        if (typeof windowRef.requestIdleCallback === 'function') {
            windowRef.requestIdleCallback(register, { timeout: 5000 });
        } else {
            setTimeout(register, 1000);
        }
    };
    void Promise.resolve(appInitialized).then(registerWhenIdle, registerWhenIdle);
}
