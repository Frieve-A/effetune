const HEARTBEAT_INTERVAL_MS = 2000;

let heartbeatIntervalId = null;

function pingRendererWatchdog() {
    try {
        window.electronAPI.rendererPing();
    } catch (_) {
        // Fire-and-forget heartbeat.
    }
}

export function startRendererWatchdogHeartbeat(reason = 'renderer-page') {
    if (!window.electronAPI?.rendererPing) return;
    if (heartbeatIntervalId !== null) return;

    if (window.electronAPI.armRendererWatchdog) {
        window.electronAPI.armRendererWatchdog(reason).finally(() => {
            pingRendererWatchdog();
        });
    } else {
        pingRendererWatchdog();
    }

    heartbeatIntervalId = setInterval(pingRendererWatchdog, HEARTBEAT_INTERVAL_MS);
}

export function stopRendererWatchdogHeartbeat() {
    if (heartbeatIntervalId === null) return;
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
}
