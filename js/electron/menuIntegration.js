/**
 * Menu integration module for EffeTune
 * Provides application menu functionality when running in Electron
 */

/**
 * Update the tray menu with translated labels
 * This method is called when translations are loaded
 * @param {boolean} isElectron - Whether running in Electron environment
 */
export async function updateTrayMenu(isElectron) {
  if (!isElectron || !window.uiManager) return;
  
  try {
    // Get the t function from UIManager
    const t = window.uiManager.t.bind(window.uiManager);
    
    // Get user presets for tray menu
    let userPresets = [];
    try {
      const presetsResult = await window.electronAPI.getUserPresetsForTray();
      if (presetsResult.success) {
        userPresets = presetsResult.presets;
      }
    } catch (error) {
      console.error('Error getting user presets for tray:', error);
    }
    
    // Create a tray menu template with translated labels and presets
    const trayMenuTemplate = {
      presets: { label: t('trayMenuPresets'), items: userPresets },
      open: { label: t('trayMenuOpen') },
      quit: { label: t('trayMenuQuit') }
    };
    
    // Send the tray menu template to the main process to update the tray menu
    window.electronAPI.updateTrayMenu(trayMenuTemplate)
      .then(result => {
        if (!result.success) {
          console.error('Failed to update tray menu:', result.error);
        }
      })
      .catch(error => {
        console.error('Error updating tray menu:', error);
      });
  } catch (error) {
    console.error('Error creating tray menu template:', error);
  }
}

/**
 * Update the application menu with translated labels
 * This method is called when translations are loaded
 * @param {boolean} isElectron - Whether running in Electron environment
 */
export async function updateApplicationMenu(isElectron) {
  if (!isElectron || !window.uiManager) return;
  
  try {
    // Get the t function from UIManager
    const t = window.uiManager.t.bind(window.uiManager);

    // Determine gating state for the Double Blind Test:
    //  - File (except Open music file / Quit) and all Edit items are disabled
    //    while the test is open.
    //  - The Double Blind Test entry can always be opened (a saved test can be
    //    recalled from inside it); it is only disabled while already open.
    const dbtActive = !!(window.uiManager && window.uiManager.isDoubleBlindActive && window.uiManager.isDoubleBlindActive());
    const editEnabled = !dbtActive;

    // The main process owns menu structure and actions. The renderer only
    // supplies translated labels and current item state by stable ID.
    const menuState = {
      'menu.file': { label: t('menu.file') },
      'file.save': { label: t('menu.file.save'), enabled: !dbtActive },
      'file.saveAs': { label: t('menu.file.saveAs'), enabled: !dbtActive },
      'file.openMusicFile': { label: t('menu.file.openMusicFile'), enabled: true },
      'file.addMusicFolder': { label: t('menu.file.addMusicFolder'), enabled: true },
      'file.rescanLibrary': { label: t('menu.file.rescanLibrary'), enabled: true },
      'file.processAudioFiles': { label: t('menu.file.processAudioFiles'), enabled: !dbtActive },
      'file.exportPreset': { label: t('menu.file.exportPreset'), enabled: !dbtActive },
      'file.importPreset': { label: t('menu.file.importPreset'), enabled: !dbtActive },
      'file.doubleBlindTest': { label: t('menu.doubleBlindTest'), enabled: !dbtActive },
      'file.quit': { label: t('menu.file.quit'), enabled: true },
      'menu.edit': { label: t('menu.edit') },
      'edit.undo': { label: t('menu.edit.undo'), enabled: editEnabled },
      'edit.redo': { label: t('menu.edit.redo'), enabled: editEnabled },
      'edit.cut': { label: t('menu.edit.cut'), enabled: editEnabled },
      'edit.copy': { label: t('menu.edit.copy'), enabled: editEnabled },
      'edit.paste': { label: t('menu.edit.paste'), enabled: editEnabled },
      'edit.delete': { label: t('menu.edit.delete'), enabled: editEnabled },
      'edit.selectAll': { label: t('menu.edit.selectAll'), enabled: editEnabled },
      'menu.view': { label: t('menu.view') },
      'view.reload': { label: t('menu.view.reload') },
      'view.resetZoom': { label: t('menu.view.resetZoom') },
      'view.zoomIn': { label: t('menu.view.zoomIn') },
      'view.zoomOut': { label: t('menu.view.zoomOut') },
      'view.effectPipeline': { label: t('menu.view.effectPipeline') },
      'view.musicLibrary': { label: t('menu.view.musicLibrary') },
      'view.pipelineAnalyzer': {
        label: t('menu.view.pipelineAnalyzer'),
        checked: (window.uiManager.isPipelineAnalyzerOpen?.() ??
          window.uiManager.pipelineAnalyzerController?.state?.open) === true
      },
      'toggle-fullscreen': { label: t('menu.view.toggleFullscreen') },
      'view.miniPlayer': { label: t('menu.view.miniPlayer') },
      'menu.settings': { label: t('menu.settings') },
      'settings.config': { label: t('menu.settings.config') },
      'settings.audioDevices': { label: t('menu.settings.audioDevices') },
      'settings.performanceBenchmark': { label: t('menu.settings.performanceBenchmark') },
      'settings.frequencyResponseMeasurement': { label: t('menu.settings.frequencyResponseMeasurement') },
      'menu.help': { label: t('menu.help') },
      'help.help': { label: t('menu.help.help') },
      'help.discord': { label: 'Discord' },
      'help.support': { label: t('menu.help.support') },
      'help.about': { label: t('menu.help.about') }
    };
    
    // Send the menu template to the main process to update the application menu
    window.electronAPI.updateApplicationMenu(menuState)
      .then(result => {
        if (!result.success) {
          console.error('Failed to update application menu:', result.error);
        }
      })
      .catch(error => {
        console.error('Error updating application menu:', error);
      });
    
    // Also update the tray menu when updating the application menu
    await updateTrayMenu(isElectron);
  } catch (error) {
    console.error('Error creating menu template:', error);
  }
}
