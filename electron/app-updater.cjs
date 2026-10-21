const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/Frieve-A/effetune/releases/download';

function createAppUpdater({
  app,
  platform = process.platform,
  isMsix = process.windowsStore === true,
  env = process.env,
  releaseDownloadBaseUrl = RELEASE_DOWNLOAD_BASE_URL,
  loadUpdater = () => require('electron-updater').autoUpdater
}) {
  let updater;
  let downloadPromise;
  let targetTag = null;

  // The update metadata is read from one pinned desktop release. The newest
  // release of the repository is unusable as a feed because DSP library
  // releases are published to the same repository and carry no metadata.
  function setTargetRelease(tag) {
    targetTag = typeof tag === 'string' && tag ? tag : null;
  }

  function isSupported() {
    return !isMsix && platform === 'win32' && app.isPackaged === true && !env.PORTABLE_EXECUTABLE_DIR;
  }

  function downloadUpdate() {
    if (!isSupported()) {
      return Promise.reject(new Error('In-app updates are unavailable for this installation'));
    }
    if (downloadPromise) return downloadPromise;
    if (!targetTag) {
      return Promise.reject(new Error('No desktop release is pinned for installation'));
    }

    const tag = targetTag;
    downloadPromise = (async () => {
      if (!updater) {
        updater = loadUpdater();
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.logger = console;
      }
      // GitHub release assets reject multiple ranges in one request, which the
      // differential download of the generic provider would otherwise use.
      updater.setFeedURL({
        provider: 'generic',
        url: `${releaseDownloadBaseUrl}/${tag}/`,
        useMultipleRangeRequest: false
      });
      const result = await updater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        throw new Error('No update is available');
      }
      await updater.downloadUpdate();
      // Start the installer only after normal service and window shutdown.
      app.once('quit', () => updater.install(true, true));
    })().catch(error => {
      downloadPromise = null;
      throw error;
    });
    return downloadPromise;
  }

  return { isSupported, setTargetRelease, downloadUpdate };
}

module.exports = { createAppUpdater };
