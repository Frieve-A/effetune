function createMacPlaybackPower({ powerSaveBlocker, getConfig }) {
  let blockerId = null;

  function stop() {
    if (blockerId !== null) powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }

  function update(active) {
    if (active !== true || getConfig()?.powerSaving?.mode !== 'continuous') {
      stop();
      return;
    }
    if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  }

  function refreshConfig() {
    if (getConfig()?.powerSaving?.mode !== 'continuous') stop();
  }

  function status() { return { appSuspensionBlocked: blockerId !== null }; }
  return { update, refreshConfig, stop, status };
}

module.exports = { createMacPlaybackPower };
