function getDefaultWindow() {
    return typeof window !== 'undefined' ? window : {};
}

export function isAudioWarmupDocument(windowRef = getDefaultWindow()) {
    return windowRef.document?.documentElement?.dataset?.effetuneStartup === 'audio-warmup';
}

export async function loadFullApplication({
    importApplication = () => import('./app.js')
} = {}) {
    return importApplication();
}

export function presentStartupFailure({
    error,
    windowRef = getDefaultWindow(),
    logger = console
} = {}) {
    try {
        logger.error('Application startup failed:', error);

        // Translation services may be part of the module graph that failed to load,
        // so use the existing pre-rendered message display with a standalone fallback.
        const errorDisplay = windowRef.document?.getElementById?.('errorDisplay');
        if (errorDisplay) {
            errorDisplay.textContent = 'EffeTune could not start. Reload the app and try again.';
            errorDisplay.classList?.toggle?.('error-message', true);
        }
    } finally {
        windowRef.document?.documentElement?.classList?.remove?.('app-starting');
    }
}

export async function startRenderer({
    windowRef = getDefaultWindow(),
    logger = console,
    isAudioWarmup = isAudioWarmupDocument,
    warmUpAudioOutput = async options => {
        const module = await import('./audio/startup-audio-warmup.js');
        return module.warmUpAudioOutput(options);
    },
    loadApplication = loadFullApplication
} = {}) {
    const audioWarmup = isAudioWarmup(windowRef);
    windowRef.isFirstLaunchConfirmed = audioWarmup;
    windowRef.isFirstLaunch = audioWarmup;

    if (audioWarmup) {
        try {
            await warmUpAudioOutput({ windowRef, logger });
        } catch (error) {
            logger.warn('Startup audio warm-up could not be completed:', error);
        }
        return 'audio-warmup';
    }

    await loadApplication({ windowRef, logger });
    return 'application';
}

if (typeof window !== 'undefined' && !window.__EFFECTUNE_DISABLE_STARTUP_AUTO_START__) {
    try {
        await startRenderer();
    } catch (error) {
        presentStartupFailure({ error });
    }
}
