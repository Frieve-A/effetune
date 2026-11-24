'use strict';

const FAILURE_WINDOW_MS = 60_000;
const FAILURE_LIMIT = 3;
const GPU_FAILURE_REASONS = new Set([
  'abnormal-exit', 'crashed', 'integrity-failure', 'launch-failed'
]);

function initializeGpuAcceleration({ app, config, queueRestart, isQuitting = () => false,
  now = Date.now, onDiagnostic = console.error, onChildProcessGone }) {
  const startupConfig = config.loadConfig();
  const enabled = startupConfig?.hardwareAcceleration !== false;
  if (!enabled) app.disableHardwareAcceleration();

  const saveSoftwareFallback = () => config.saveConfig({
    ...config.loadConfig(), hardwareAcceleration: false, graphicsFallbackPending: true
  });

  let recentFailures = [];
  let recoveryQueued = false;
  app.on('child-process-gone', (_event, details) => {
    onChildProcessGone?.(details);
    if (details?.type !== 'GPU' || !GPU_FAILURE_REASONS.has(details.reason)) return;
    onDiagnostic('[graphics] GPU process failure:', details.reason, details.exitCode);
    if (!enabled || recoveryQueued || isQuitting()) return;

    const time = now();
    recentFailures = recentFailures.filter(previous => time - previous < FAILURE_WINDOW_MS);
    recentFailures.push(time);
    if (recentFailures.length < FAILURE_LIMIT) return;

    if (!saveSoftwareFallback()) {
      onDiagnostic('[graphics] Could not save the software-rendering fallback.');
      return;
    }

    recoveryQueued = true;
    // Renderer config writes during shutdown can carry the old GPU setting.
    app.once('will-quit', () => {
      if (!saveSoftwareFallback()) {
        onDiagnostic('[graphics] Could not preserve the software-rendering fallback.');
      }
    });
    onDiagnostic('[graphics] Repeated GPU failures; restarting with hardware acceleration off.');
    try {
      queueRestart(app);
      app.quit();
    } catch (error) {
      onDiagnostic('[graphics] Automatic restart failed:', error);
    }
  });

  return { fallbackPending: !enabled && startupConfig?.graphicsFallbackPending === true };
}

module.exports = { initializeGpuAcceleration };
