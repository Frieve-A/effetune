function createMacPlaybackPower({ powerSaveBlocker, getConfig, recordDiagnosticEvent }) {
  let blockerId = null;

  function stop(reason) {
    if (blockerId === null) return;
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
    recordDiagnosticEvent?.('appNap', { state: 'released', reason });
  }

  function update(active) {
    if (active !== true || getConfig()?.powerSaving?.mode !== 'continuous') {
      stop(active !== true ? 'playbackInactive' : 'powerSavingEnabled');
      return;
    }
    if (blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
      recordDiagnosticEvent?.('appNap', { state: 'started' });
    }
  }

  function refreshConfig() {
    if (getConfig()?.powerSaving?.mode !== 'continuous') stop('powerSavingEnabled');
  }

  function status() { return { appSuspensionBlocked: blockerId !== null }; }
  return { update, refreshConfig, stop, status };
}

module.exports = { createMacPlaybackPower };
