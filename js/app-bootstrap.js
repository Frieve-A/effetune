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

export function startApplication({
    AppClass,
    firstLaunchPromise,
    startHeartbeat,
    registerTrayPresetListenerFn = registerTrayPresetListener,
    createAndInitializeAppFn = createAndInitializeApp,
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

    return firstLaunchPromise.then(isFirstLaunch => {
        windowRef.isFirstLaunchConfirmed = isFirstLaunch;
        windowRef.isFirstLaunch = isFirstLaunch;
        return createAndInitializeAppFn(AppClass, { windowRef, logger });
    }).catch(error => {
        logger.error('Failed to check first launch status:', error);
        return createAndInitializeAppFn(AppClass, { windowRef, logger });
    });
}
