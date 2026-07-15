function getDefaultWindow() {
    return typeof window !== 'undefined' ? window : {};
}

export function registerPipelineStateCloseHandler(getPipelineStateForSave, electronAPI = getDefaultWindow().electronAPI) {
    if (electronAPI && electronAPI.onRequestPipelineStateForClose) {
        electronAPI.onRequestPipelineStateForClose(() => {
            const pipelineState = getPipelineStateForSave();
            electronAPI.sendPipelineStateForClose(pipelineState);
        });
    }
}

export function createFirstLaunchPromise(electronAPI = getDefaultWindow().electronAPI) {
    if (electronAPI && electronAPI.isFirstLaunch) {
        try {
            return Promise.resolve(electronAPI.isFirstLaunch()).catch(() => false);
        } catch (error) {
            return Promise.resolve(false);
        }
    }

    return Promise.resolve(false);
}

export function applyFirstLaunchStatus(isFirstLaunch, style, windowRef = getDefaultWindow()) {
    if (!isFirstLaunch) {
        if (style && style.parentNode) {
            style.parentNode.removeChild(style);
        }
    } else if (style) {
        style.id = 'first-launch-style';
    }

    windowRef.isFirstLaunchConfirmed = isFirstLaunch;
    windowRef.isFirstLaunch = isFirstLaunch;
}

export function applyFirstLaunchError(error, style, {
    windowRef = getDefaultWindow(),
    logger = console
} = {}) {
    logger.error('Error checking launch status:', error);
    if (style && style.parentNode) {
        style.parentNode.removeChild(style);
    }
    windowRef.isFirstLaunchConfirmed = false;
    windowRef.isFirstLaunch = false;
}

export function handleFirstLaunchPromise(promise, style, options = {}) {
    return promise.then(isFirstLaunch => {
        applyFirstLaunchStatus(isFirstLaunch, style, options.windowRef);
    }).catch(error => {
        applyFirstLaunchError(error, style, options);
    });
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
    logger = console
} = {}) {
    const app = new AppClass();
    windowRef.app = app;

    const initializeResult = app.initialize();
    if (initializeResult && typeof initializeResult.catch === 'function') {
        initializeResult.catch(error => {
            logger.error('Failed to initialize app:', error);
        });
    }

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
    registerTrayPresetListenerFn({
        electronAPI: windowRef.electronAPI,
        electronBridge: windowRef.electronIntegration,
        windowRef,
        logger
    });

    const start = isFirstLaunch => {
        windowRef.isFirstLaunchConfirmed = isFirstLaunch;
        windowRef.isFirstLaunch = isFirstLaunch;
        registerServiceWorker(windowRef, logger);
        if (typeof loadInitialConfigFn === 'function') {
            return Promise.resolve(loadInitialConfigFn({ windowRef, logger }))
                .catch(error => {
                    logger.warn('Failed to load initial app config:', error);
                })
                .then(() => createAndInitializeAppFn(AppClass, { windowRef, logger }));
        }
        return Promise.resolve(createAndInitializeAppFn(AppClass, { windowRef, logger }));
    };

    return firstLaunchPromise.then(start).catch(error => {
        logger.error('Failed to check first launch status:', error);
        return start(false);
    });
}

export function registerServiceWorker(windowRef = getDefaultWindow(), logger = console) {
    const isElectron = windowRef.electronIntegration?.isElectronEnvironment?.() ||
        windowRef.electronIntegration?.isElectron;
    if (isElectron || !windowRef.navigator?.serviceWorker) return;
    if (isDevelopmentServer(windowRef)) {
        unregisterDevelopmentServiceWorkers(windowRef, logger);
        return;
    }
    const register = () => {
        windowRef.navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => {
            logger.warn('Service worker registration failed:', error);
        });
    };
    if (windowRef.document?.readyState === 'complete') {
        register();
    } else {
        windowRef.addEventListener?.('load', register, { once: true });
    }
}
