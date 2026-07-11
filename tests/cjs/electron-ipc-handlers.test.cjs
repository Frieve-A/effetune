const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const {
  createTempDir,
  loadFreshModule,
  withPatchedPropertyAsync
} = require('../helpers/cjs-module-utils.cjs');

async function withModuleLoadStubAsync(stubs, callback) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await callback();
  } finally {
    Module._load = originalLoad;
  }
}

function createIpcMain() {
  return {
    handlers: new Map(),
    listeners: new Map(),
    handle(channel, handler) {
      this.handlers.set(channel, handler);
    },
    on(channel, listener) {
      this.listeners.set(channel, listener);
    }
  };
}

function createMainWindow(calls, options = {}) {
  const webContents = {
    sent: [],
    inputEvents: [],
    send(channel, ...args) {
      calls.push(['webContents.send', channel, ...args]);
      this.sent.push([channel, ...args]);
    },
    sendInputEvent(event) {
      calls.push(['webContents.sendInputEvent', event]);
      this.inputEvents.push(event);
    },
    executeJavaScript(script) {
      calls.push(['webContents.executeJavaScript', script]);
      if (options.rejectJavaScript) {
        return Promise.reject(options.rejectJavaScriptValue ?? new Error('script failed'));
      }
      return Promise.resolve(options.scriptResult ?? [
        { deviceId: 'mic1', kind: 'audioinput', label: '' },
        { deviceId: 'speaker1', kind: 'audiooutput', label: 'Speaker' },
        { deviceId: 'camera1', kind: 'videoinput', label: 'Camera' }
      ]);
    },
    session: {
      async clearPermissionOverrides(optionsArg) {
        calls.push(['session.clearPermissionOverrides', optionsArg]);
        if (options.rejectPermissionClear) throw new Error('clear failed');
      }
    }
  };

  return {
    webContents,
    reload() {
      calls.push(['window.reload']);
      if (options.throwReload) throw new Error('reload failed');
    },
    loadFile(file) {
      calls.push(['window.loadFile', file]);
      if (options.throwLoadFile) throw new Error('load failed');
    },
    isDestroyed() {
      return Boolean(options.destroyed);
    },
    destroy() {
      calls.push(['window.destroy']);
    }
  };
}

function menuFromTemplate(template) {
  const convert = item => ({
    ...item,
    submenu: Array.isArray(item.submenu)
      ? { items: item.submenu.map(convert) }
      : item.submenu
  });
  return {
    template,
    items: template.map(convert)
  };
}

function clickMenu(menu) {
  for (const section of menu.template) {
    for (const item of section.submenu || []) {
      if (typeof item.click === 'function') {
        item.click();
      }
    }
  }
}

function createMenuTemplate() {
  const items = (count, prefix) => Array.from({ length: count }, (_, index) => ({
    label: `${prefix}-${index}`,
    enabled: index % 2 === 0
  }));
  return {
    file: { label: 'File X', submenu: items(14, 'file') },
    edit: { label: 'Edit X', submenu: items(9, 'edit') },
    view: { label: 'View X', submenu: items(10, 'view') },
    settings: { label: 'Settings X', submenu: items(4, 'settings') },
    help: { label: 'Help X', submenu: items(5, 'help') }
  };
}

function createHarness(options = {}) {
  const calls = [];
  const ipcMain = createIpcMain();
  const tempDir = createTempDir('effetune-ipc-handlers');
  let mainWindow = Object.prototype.hasOwnProperty.call(options, 'mainWindow')
    ? options.mainWindow
    : createMainWindow(calls, options.mainWindowOptions);
  let applicationMenu = null;
  let triggerClose = options.triggerClose ?? (() => calls.push(['triggerClose']));
  let updateTrayMenuTemplate = options.updateTrayMenuTemplate ?? (template => calls.push(['updateTrayMenuTemplate', template]));
  const statusQueue = [...(options.microphoneStatuses ?? ['granted'])];
  const shellFailures = [...(options.shellFailures ?? [])];
  const savePipelineResults = [...(options.savePipelineResults ?? [])];

  const electron = {
    app: {
      getPath(name) {
        calls.push(['app.getPath', name]);
        return path.join(tempDir, name);
      },
      setLoginItemSettings(settings) {
        calls.push(['app.setLoginItemSettings', settings]);
      },
      relaunch(optionsArg) {
        calls.push(['app.relaunch', optionsArg]);
        if (options.throwRelaunch) throw new Error('relaunch failed');
      },
      exit(code) {
        calls.push(['app.exit', code]);
        if (options.throwExit) throw new Error('exit failed');
      },
      quit() {
        calls.push(['app.quit']);
      }
    },
    clipboard: {
      text: 'clipboard text',
      readText() {
        return this.text;
      },
      writeText(text) {
        this.text = text;
      }
    },
    ipcMain,
    shell: {
      async openExternal(url) {
        calls.push(['shell.openExternal', url]);
        const next = shellFailures.shift();
        if (next) throw next;
      }
    },
    systemPreferences: {
      async getMediaAccessStatus(kind) {
        calls.push(['systemPreferences.getMediaAccessStatus', kind]);
        const next = statusQueue.length ? statusQueue.shift() : 'granted';
        if (next instanceof Error) throw next;
        return next;
      },
      async askForMediaAccess(kind) {
        calls.push(['systemPreferences.askForMediaAccess', kind]);
        if (options.askMediaResult instanceof Error) throw options.askMediaResult;
        return options.askMediaResult ?? true;
      }
    },
    Menu: {
      buildFromTemplate(template) {
        calls.push(['Menu.buildFromTemplate', template]);
        if (options.throwBuildMenu) throw new Error('build menu failed');
        return menuFromTemplate(template);
      },
      setApplicationMenu(menu) {
        calls.push(['Menu.setApplicationMenu', menu]);
        if (options.throwSetMenu) throw new Error('set menu failed');
        applicationMenu = menu;
      },
      getApplicationMenu() {
        calls.push(['Menu.getApplicationMenu']);
        if (options.throwGetMenu) throw new Error('get menu failed');
        return applicationMenu;
      }
    }
  };

  const constants = {
    AUTO_RESTART_FLAG: '--auto-restart',
    setMainWindow(window) {
      mainWindow = window;
    },
    getMainWindow() {
      return mainWindow;
    },
    getIsFirstLaunch() {
      return options.isFirstLaunch ?? true;
    },
    getCommandLinePresetFile() {
      return options.commandLinePresetFile ?? 'startup.effetune_preset';
    },
    setAppConfig(config) {
      calls.push(['constants.setAppConfig', config]);
    },
    getAppVersion() {
      return options.appVersion ?? '1.2.3';
    },
    clearCloseTimeout() {
      calls.push(['constants.clearCloseTimeout']);
    },
    getTriggerClose() {
      return triggerClose;
    },
    getUpdateTrayMenuTemplate() {
      return updateTrayMenuTemplate;
    },
    setUpdateTrayMenuTemplate(fn) {
      updateTrayMenuTemplate = fn;
    }
  };

  const config = {
    loadConfig() {
      calls.push(['config.loadConfig']);
      if (options.throwLoadConfig) throw new Error('load config failed');
      return options.config ?? { autoLaunch: false, keep: true };
    },
    saveConfig(configArg) {
      calls.push(['config.saveConfig', configArg]);
      if (options.throwSaveConfig) throw new Error('save config failed');
    }
  };

  const fileHandlers = {
    getUserDataPath() {
      calls.push(['fileHandlers.getUserDataPath']);
      return tempDir;
    },
    joinPaths(basePath, ...parts) {
      calls.push(['fileHandlers.joinPaths', basePath, ...parts]);
      return path.join(basePath, ...parts);
    },
    fileExists(filePath) {
      calls.push(['fileHandlers.fileExists', filePath]);
      return fs.existsSync(filePath);
    },
    async showSaveDialog(dialogOptions) {
      calls.push(['fileHandlers.showSaveDialog', dialogOptions]);
      return { canceled: false, filePath: 'save.wav' };
    },
    async showOpenDialog(dialogOptions) {
      calls.push(['fileHandlers.showOpenDialog', dialogOptions]);
      return { canceled: false, filePaths: ['open.wav'] };
    },
    async saveFile(filePath, content) {
      calls.push(['fileHandlers.saveFile', filePath, content]);
      return { success: true };
    },
    async readFile(filePath, binary) {
      calls.push(['fileHandlers.readFile', filePath, binary]);
      return { success: true, content: 'data' };
    },
    async readFileAsBuffer(filePath) {
      calls.push(['fileHandlers.readFileAsBuffer', filePath]);
      return { success: true, content: 'base64' };
    },
    async getFilePath(fileInfo) {
      calls.push(['fileHandlers.getFilePath', fileInfo]);
      return 'one.wav';
    },
    async getFilePaths(filesInfo) {
      calls.push(['fileHandlers.getFilePaths', filesInfo]);
      return ['one.wav', 'two.wav'];
    },
    async handleDroppedFilesWithPaths(filePaths) {
      calls.push(['fileHandlers.handleDroppedFilesWithPaths', filePaths]);
      return filePaths;
    },
    async handleDroppedFiles(filesInfo) {
      calls.push(['fileHandlers.handleDroppedFiles', filesInfo]);
      return filesInfo;
    },
    async handleDroppedPresetFile(fileInfo) {
      calls.push(['fileHandlers.handleDroppedPresetFile', fileInfo]);
      return fileInfo;
    },
    async savePipelineStateToFile(pipelineState) {
      calls.push(['fileHandlers.savePipelineStateToFile', pipelineState]);
      const next = savePipelineResults.length ? savePipelineResults.shift() : { success: true };
      if (next instanceof Error) throw next;
      return next;
    }
  };

  const main = {
    sendPendingUpdateInfo() {
      calls.push(['main.sendPendingUpdateInfo']);
      if (options.throwSendPendingUpdateInfo) throw new Error('pending failed');
    },
    getPendingUpdateInfo() {
      calls.push(['main.getPendingUpdateInfo']);
      if (options.throwGetPendingUpdateInfo) throw new Error('get pending failed');
      return options.pendingUpdateInfo ?? { version: '2.0.0' };
    },
    async checkForUpdates() {
      calls.push(['main.checkForUpdates']);
      if (options.throwCheckForUpdates) throw new Error('check failed');
    }
  };

  return {
    calls,
    constants,
    electron,
    fileHandlers,
    get applicationMenu() {
      return applicationMenu;
    },
    ipcMain,
    main,
    setMainWindow(window) {
      mainWindow = window;
    },
    setTriggerClose(fn) {
      triggerClose = fn;
    },
    setUpdateTrayMenuTemplate(fn) {
      updateTrayMenuTemplate = fn;
    },
    stubs: {
      electron,
      './constants': constants,
      './config': config,
      './file-handlers': fileHandlers,
      './file-handlers.js': fileHandlers,
      './main': main
    },
    tempDir
  };
}

async function withHarness(options, callback) {
  const harness = createHarness(options);
  const timer = (fn, delay) => {
    harness.calls.push(['setTimeout', delay]);
    fn();
    return 1;
  };

  try {
    return await withPatchedPropertyAsync(process, 'platform', options.platform ?? process.platform, async () =>
      withPatchedPropertyAsync(console, 'error', (...args) => {
        harness.calls.push(['console.error', ...args]);
      }, async () =>
        withPatchedPropertyAsync(global, 'setTimeout', timer, async () =>
          withModuleLoadStubAsync(harness.stubs, async () => {
            const moduleUnderTest = loadFreshModule('../../electron/ipc-handlers.js');
            return callback({ ...harness, moduleUnderTest });
          })
        )
      )
    );
  } finally {
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  }
}

async function invokeAllDelegates(handlers) {
  assert.deepEqual(await handlers.get('show-save-dialog')({}, { title: 'save' }), { canceled: false, filePath: 'save.wav' });
  assert.deepEqual(await handlers.get('show-open-dialog')({}, { title: 'open' }), { canceled: false, filePaths: ['open.wav'] });
  assert.deepEqual(await handlers.get('save-file')({}, 'a.txt', 'content'), { success: true });
  assert.deepEqual(await handlers.get('read-file')({}, 'a.txt', true), { success: true, content: 'data' });
  assert.deepEqual(await handlers.get('read-file-as-buffer')({}, 'a.bin'), { success: true, content: 'base64' });
  assert.equal(handlers.get('joinPaths')({}, 'a', 'b', 'c'), path.join('a', 'b', 'c'));
  assert.equal(handlers.get('fileExists')({}, 'missing'), false);
  assert.equal(await handlers.get('get-file-path')({}, { name: 'one' }), 'one.wav');
  assert.deepEqual(await handlers.get('get-file-paths')({}, [{ name: 'one' }]), ['one.wav', 'two.wav']);
  assert.deepEqual(await handlers.get('handle-dropped-files-with-paths')({}, ['a.wav']), ['a.wav']);
  assert.deepEqual(await handlers.get('handle-dropped-files')({}, [{ name: 'a.wav' }]), [{ name: 'a.wav' }]);
  assert.deepEqual(await handlers.get('handle-dropped-preset-file')({}, { name: 'a.effetune_preset' }), { name: 'a.effetune_preset' });
  assert.deepEqual(await handlers.get('save-pipeline-state-to-file')({}, { pipeline: [] }), { success: true });
}

test('registers core handlers and delegates file, config, update, path, and URL work', async () => {
  await withHarness({}, async ({ calls, electron, ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.setMainWindow(createMainWindow(calls));
    moduleUnderTest.simulateKeyboardShortcut('K', ['control']);
    moduleUnderTest.registerIpcHandlers();

    const { handlers, listeners } = ipcMain;
    assert.equal(handlers.get('get-first-launch-flag')(), true);
    assert.equal(handlers.get('get-command-line-preset-file')(), 'startup.effetune_preset');
    listeners.get('update-available')({}, { version: '2.0.0' });
    assert.deepEqual(handlers.get('renderer-ready-for-updates')(), { success: true });
    assert.deepEqual(handlers.get('get-update-info')(), { version: '2.0.0' });
    assert.deepEqual(await handlers.get('force-check-for-updates')(), { success: true });

    await invokeAllDelegates(handlers);

    assert.equal(await handlers.get('request-microphone-access')(), true);
    assert.deepEqual(await handlers.get('get-audio-devices')(), {
      success: true,
      devices: [
        { deviceId: 'mic1', kind: 'audioinput', label: '' },
        { deviceId: 'speaker1', kind: 'audiooutput', label: 'Speaker' },
        { deviceId: 'camera1', kind: 'videoinput', label: 'Camera' }
      ]
    });

    assert.deepEqual(await handlers.get('save-audio-preferences')({}, { outputDeviceId: 'speaker1' }), { success: true });
    assert.equal(fs.existsSync(path.join(tempDir, 'audio-preferences.json')), true);
    assert.deepEqual(await handlers.get('load-audio-preferences')(), {
      success: true,
      preferences: { outputDeviceId: 'speaker1' }
    });

    assert.deepEqual(await handlers.get('save-config')({}, { autoLaunch: true }), { success: true });
    assert.deepEqual(await handlers.get('load-config')(), { success: true, config: { autoLaunch: false, keep: true } });
    assert.equal(handlers.get('get-app-version')(), '1.2.3');
    assert.equal(handlers.get('getPath')({}, 'userData'), tempDir);
    assert.equal(handlers.get('getPath')({}, 'documents'), path.join(tempDir, 'documents'));

    assert.deepEqual(await handlers.get('open-external-url')({}, 'docs/intro.md#top'), { success: true });
    assert.deepEqual(await handlers.get('open-external-url')({}, '/docs/'), { success: true });
    assert.deepEqual(await handlers.get('open-external-url')({}, 'https://example.test/page'), { success: true });
    assert.equal(electron.shell.openExternal instanceof Function, true);
    assert.equal(calls.some(call => call[0] === 'app.setLoginItemSettings'), true);
  });
});

test('save-file refuses to write the library folder mirror', async () => {
  await withHarness({}, async ({ calls, ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const mirrorPath = path.join(tempDir, 'subdir', '..', 'library-folders.json');

    const result = await ipcMain.handlers.get('save-file')({}, mirrorPath, '{}');

    assert.equal(result.success, false);
    assert.match(result.error, /library-folders\.json/);
    assert.equal(calls.some(call =>
      call[0] === 'fileHandlers.saveFile' &&
      path.resolve(call[1]) === path.resolve(mirrorPath)
    ), false);
  });
});

test('save-file blocks settings-dir writes and Windows alias bypasses of the mirror guard', async () => {
  await withHarness({}, async ({ calls, ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const saveFileWasCalledFor = filePath => calls.some(call =>
      call[0] === 'fileHandlers.saveFile' &&
      call[1] === filePath
    );
    const deniedPaths = [
      path.join(tempDir, 'library-folders.json'),
      path.join(tempDir, 'library-folders.json') + '::$DATA',
      path.join(tempDir, 'library-folders.json.'),
      path.join(tempDir, 'LIBRAR~1.JSO'),
      path.join(tempDir, 'evil.txt'),
      path.join(tempDir, 'sub', 'library-folders.json')
    ];

    for (const deniedPath of deniedPaths) {
      const result = await ipcMain.handlers.get('save-file')({}, deniedPath, '{}');
      assert.equal(result.success, false);
      assert.match(result.error, /library-folders\.json/);
      assert.equal(saveFileWasCalledFor(deniedPath), false);
    }

    const presetsPath = path.join(tempDir, 'effetune_presets.json');
    const playerStatePath = path.join(tempDir, 'player-state.json');
    const outsidePath = path.join(path.dirname(tempDir), `effetune-outside-${path.basename(tempDir)}.txt`);

    assert.deepEqual(await ipcMain.handlers.get('save-file')({}, presetsPath, '{}'), { success: true });
    assert.deepEqual(await ipcMain.handlers.get('save-file')({}, playerStatePath, '{}'), { success: true });
    assert.deepEqual(await ipcMain.handlers.get('save-file')({}, outsidePath, 'outside'), { success: true });
    assert.equal(saveFileWasCalledFor(presetsPath), true);
    assert.equal(saveFileWasCalledFor(playerStatePath), true);
    assert.equal(saveFileWasCalledFor(outsidePath), true);
  });
});

test('save-file canonicalizes an existing settings ancestor for missing nested targets', async () => {
  await withHarness({ platform: 'linux' }, async ({ calls, ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const resolvedSettingsDir = path.resolve(tempDir);
    const canonicalSettingsDir = path.join(
      path.dirname(resolvedSettingsDir),
      `canonical-${path.basename(resolvedSettingsDir)}`
    );
    const missingPath = path.join(tempDir, 'missing', 'nested', 'library-folders.json');
    const originalRealpathSync = fs.realpathSync;

    await withPatchedPropertyAsync(fs, 'realpathSync', filePath => {
      const resolvedPath = path.resolve(filePath);
      if (resolvedPath === resolvedSettingsDir) return canonicalSettingsDir;
      if (resolvedPath.startsWith(`${resolvedSettingsDir}${path.sep}`)) {
        const error = new Error(`ENOENT: no such file or directory, realpath '${filePath}'`);
        error.code = 'ENOENT';
        throw error;
      }
      return originalRealpathSync(filePath);
    }, async () => {
      const result = await ipcMain.handlers.get('save-file')({}, missingPath, '{}');
      assert.equal(result.success, false);
      assert.match(result.error, /library-folders\.json/);
      assert.equal(calls.some(call => call[0] === 'fileHandlers.saveFile'), false);
    });
  });
});

test('save-file canonicalizes a missing settings directory from its existing ancestor', async () => {
  await withHarness({ platform: 'linux' }, async ({ calls, ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const resolvedSettingsDir = path.resolve(tempDir);
    const resolvedSettingsParent = path.dirname(resolvedSettingsDir);
    const canonicalSettingsParent = path.join(
      path.dirname(resolvedSettingsParent),
      `canonical-${path.basename(resolvedSettingsParent)}`
    );
    const missingPath = path.join(tempDir, 'missing', 'nested', 'library-folders.json');
    const originalRealpathSync = fs.realpathSync;

    await withPatchedPropertyAsync(fs, 'realpathSync', filePath => {
      const resolvedPath = path.resolve(filePath);
      if (resolvedPath === resolvedSettingsParent) return canonicalSettingsParent;
      if (resolvedPath === resolvedSettingsDir || resolvedPath.startsWith(`${resolvedSettingsDir}${path.sep}`)) {
        const error = new Error(`ENOENT: no such file or directory, realpath '${filePath}'`);
        error.code = 'ENOENT';
        throw error;
      }
      return originalRealpathSync(filePath);
    }, async () => {
      const result = await ipcMain.handlers.get('save-file')({}, missingPath, '{}');
      assert.equal(result.success, false);
      assert.match(result.error, /library-folders\.json/);
      assert.equal(calls.some(call => call[0] === 'fileHandlers.saveFile'), false);
    });
  });
});

test('IPC handlers recover from update, permission, config, preference, relaunch, close, and dropped-file failures', async () => {
  await withHarness({
    platform: 'linux',
    throwGetPendingUpdateInfo: true,
    throwCheckForUpdates: true,
    throwLoadConfig: true,
    throwRelaunch: true,
    savePipelineResults: [{ success: false, error: 'save failed' }, new Error('save threw')],
    shellFailures: [new Error('open failed')],
    microphoneStatuses: [new Error('status failed'), 'prompt', 'prompt'],
    askMediaResult: false
  }, async ({ calls, constants, ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    const { handlers, listeners } = ipcMain;

    assert.equal(handlers.get('get-update-info')(), null);
    assert.deepEqual(await handlers.get('force-check-for-updates')(), { success: false, error: 'check failed' });
    assert.deepEqual(await handlers.get('open-external-url')({}, 'bad'), { success: false, error: 'open failed' });
    assert.deepEqual(await handlers.get('load-config')(), { success: false, error: 'load config failed' });
    assert.deepEqual(await handlers.get('request-microphone-access')(), true);

    assert.deepEqual(await handlers.get('clear-microphone-permission')(), { success: false, error: 'status failed' });
    assert.deepEqual(await handlers.get('clear-microphone-permission')(), { success: true });
    constants.setMainWindow(null);
    assert.deepEqual(await handlers.get('clear-microphone-permission')(), { success: false, error: 'Main window not available' });
    assert.deepEqual(handlers.get('reload-window')(), { success: false, error: 'Main window not available' });
    assert.deepEqual(handlers.get('navigate-to-main')(), { success: false, error: 'Main window not available' });
    assert.deepEqual(await handlers.get('load-preset-from-tray')({}, 'Preset'), { success: false, error: 'Main window not available' });

    const fallbackWin = createMainWindow(calls);
    constants.setMainWindow(fallbackWin);
    let triggerCount = 0;
    constants.clearCloseTimeout();
    constants.setMainWindow(fallbackWin);
    listeners.get('pipeline-state-for-close')({}, { name: 'first' });
    await Promise.resolve();
    listeners.get('pipeline-state-for-close')({}, { name: 'second' });
    await Promise.resolve();
    constants.setMainWindow(fallbackWin);
    moduleUnderTest.setMainWindow(fallbackWin);
    constants.getTriggerClose = () => {
      triggerCount++;
      throw new Error('trigger failed');
    };
    listeners.get('pipeline-state-for-close')({}, { name: 'third' });
    await Promise.resolve();
    assert.equal(triggerCount > 0, true);
    assert.equal(calls.some(call => call[0] === 'window.destroy'), true);

    assert.throws(() => handlers.get('relaunch-app')(), /relaunch failed/);

    listeners.get('files-dropped')({}, ['/tmp/a.wav', '/tmp/b.txt', '/tmp/c.FLAC']);
    constants.setMainWindow(null);
    listeners.get('files-dropped')({}, ['/tmp/a.wav']);
  });
});

test('IPC handlers manage menus, tray presets, documentation, default menu creation, and application-menu reads', async () => {
  await withHarness({}, async ({ calls, constants, electron, ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const { handlers, listeners } = ipcMain;

    const updateResult = handlers.get('update-application-menu')({}, createMenuTemplate());
    assert.deepEqual(updateResult, { success: true });
    const translatedMenu = electron.Menu.getApplicationMenu();
    assert.equal(translatedMenu.template[2].submenu[6].accelerator, 'CommandOrControl+E');
    assert.equal(translatedMenu.template[2].submenu[7].accelerator, 'CommandOrControl+L');
    clickMenu(translatedMenu);
    await Promise.resolve();

    const appMenu = handlers.get('get-application-menu')();
    assert.equal(appMenu.file.label, 'File X');

    assert.deepEqual(handlers.get('hide-application-menu')(), { success: true });
    assert.equal(handlers.get('get-application-menu')(), null);
    assert.deepEqual(handlers.get('restore-default-menu')(), { success: true });
    const defaultMenu = electron.Menu.getApplicationMenu();
    assert.equal(defaultMenu.template[2].submenu[6].accelerator, 'CommandOrControl+E');
    assert.equal(defaultMenu.template[2].submenu[7].accelerator, 'CommandOrControl+L');
    clickMenu(defaultMenu);
    await Promise.resolve();

    assert.deepEqual(handlers.get('navigate-to-main')(), { success: true });
    assert.deepEqual(handlers.get('update-tray-menu')({}, { items: ['A'] }), { success: true });
    constants.setUpdateTrayMenuTemplate(null);
    assert.deepEqual(handlers.get('update-tray-menu')({}, { items: ['B'] }), {
      success: false,
      error: 'updateTrayMenuTemplate function not available'
    });
    constants.setUpdateTrayMenuTemplate(() => {
      throw new Error('tray failed');
    });
    assert.deepEqual(handlers.get('update-tray-menu')({}, { items: ['C'] }), { success: false, error: 'tray failed' });

    assert.deepEqual(await handlers.get('load-preset-from-tray')({}, 'Preset A'), { success: true });
    fs.writeFileSync(path.join(tempDir, 'effetune_presets.json'), JSON.stringify({ Zebra: {}, Alpha: {} }));
    assert.deepEqual(await handlers.get('get-user-presets-for-tray')(), { success: true, presets: ['Alpha', 'Zebra'] });
    fs.rmSync(path.join(tempDir, 'effetune_presets.json'));
    assert.deepEqual(await handlers.get('get-user-presets-for-tray')(), { success: true, presets: [] });
    fs.writeFileSync(path.join(tempDir, 'effetune_presets.json'), '{bad');
    const badPresets = await handlers.get('get-user-presets-for-tray')();
    assert.equal(badPresets.success, false);
    assert.match(badPresets.error, /Expected property name|JSON/);
    assert.deepEqual(badPresets.presets, []);

    assert.deepEqual(await handlers.get('open-documentation')({}, '/docs/readme.md#intro'), { success: true });
    assert.deepEqual(await handlers.get('open-documentation')({}, 'https://example.test/docs'), { success: true });
    listeners.get('files-dropped')({}, ['/tmp/a.mp3', '/tmp/b.txt']);
    assert.equal(calls.some(call => call[0] === 'webContents.send' && call[1] === 'audio-files-dropped'), true);
  });
});

test('IPC handlers recover from menu, tray preset, menu read, navigation, docs, and audio-device errors', async () => {
  await withHarness({
    throwBuildMenu: true,
    throwGetMenu: true,
    mainWindowOptions: { rejectJavaScript: true, throwLoadFile: true },
    shellFailures: [new Error('doc failed')],
    microphoneStatuses: ['granted']
  }, async ({ constants, ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    const { handlers } = ipcMain;

    assert.deepEqual(handlers.get('update-application-menu')({}, createMenuTemplate()), {
      success: false,
      error: 'build menu failed'
    });
    assert.equal(handlers.get('get-application-menu')(), null);
    assert.deepEqual(handlers.get('hide-application-menu')(), { success: true });
    assert.deepEqual(handlers.get('restore-default-menu')(), { success: false, error: 'build menu failed' });
    assert.deepEqual(handlers.get('navigate-to-main')(), { success: false, error: 'build menu failed' });
    assert.deepEqual(await handlers.get('open-documentation')({}, '/docs/readme.md'), { success: false, error: 'doc failed' });

    constants.setMainWindow({ webContents: null });
    assert.deepEqual(await handlers.get('load-preset-from-tray')({}, 'Preset'), {
      success: false,
      error: 'Main window not available'
    });
  });

  await withHarness({ mainWindowOptions: { rejectJavaScript: true }, microphoneStatuses: ['granted'] }, async ({ ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    assert.deepEqual(await ipcMain.handlers.get('get-audio-devices')(), { success: false, error: 'script failed' });
  });

  await withHarness({ microphoneStatuses: ['prompt'] }, async ({ calls, ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    assert.equal((await ipcMain.handlers.get('get-audio-devices')()).success, true);
    assert.equal(calls.some(call => call[0] === 'systemPreferences.askForMediaAccess'), false);
  });
});

test('IPC handlers manage macOS microphone access and audio preference edge cases', async () => {
  await withHarness({ platform: 'darwin', microphoneStatuses: ['granted', 'prompt', new Error('mic failed')] }, async ({ ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    const handler = ipcMain.handlers.get('request-microphone-access');
    assert.equal(await handler(), true);
    assert.equal(await handler(), true);
    assert.equal(await handler(), false);
  });

  await withHarness({}, async ({ ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const handlers = ipcMain.handlers;

    fs.rmSync(tempDir, { recursive: true, force: true });
    assert.deepEqual(await handlers.get('save-audio-preferences')({}, { sampleRate: 48000 }), { success: true });
    fs.rmSync(path.join(tempDir, 'audio-preferences.json'), { force: true });
    assert.deepEqual(await handlers.get('load-audio-preferences')(), { success: true, preferences: null });

    fs.writeFileSync(path.join(tempDir, 'audio-preferences.json'), '{bad');
    const loadResult = await handlers.get('load-audio-preferences')();
    assert.equal(loadResult.success, false);
    assert.match(loadResult.error, /Expected property name|JSON/);
  });

  await withHarness({ throwSaveConfig: true }, async ({ ipcMain, moduleUnderTest, tempDir }) => {
    moduleUnderTest.registerIpcHandlers();
    const handlers = ipcMain.handlers;
    fs.mkdirSync(path.join(tempDir, 'audio-preferences.json'));
    const savePrefs = await handlers.get('save-audio-preferences')({}, { sampleRate: 44100 });
    assert.equal(savePrefs.success, false);
    assert.match(savePrefs.error, /EISDIR|directory|illegal operation/i);
    assert.deepEqual(await handlers.get('save-config')({}, { autoLaunch: false }), { success: false, error: 'save config failed' });
  });
});

test('IPC handlers report menu click rejections and recover from IPC errors', async () => {
  await withHarness({ mainWindowOptions: { rejectJavaScript: true } }, async ({ electron, ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    assert.deepEqual(ipcMain.handlers.get('update-application-menu')({}, createMenuTemplate()), { success: true });
    clickMenu(electron.Menu.getApplicationMenu());
    await Promise.resolve();

    moduleUnderTest.createMenu();
    clickMenu(electron.Menu.getApplicationMenu());
    await Promise.resolve();
  });

  await withHarness({ throwSetMenu: true }, async ({ ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    assert.deepEqual(ipcMain.handlers.get('hide-application-menu')(), { success: false, error: 'set menu failed' });
  });

  await withHarness({}, async ({ ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    const badWin = {
      webContents: {
        send() {
          throw new Error('send failed');
        }
      }
    };
    moduleUnderTest.setMainWindow(badWin);
    assert.deepEqual(await ipcMain.handlers.get('load-preset-from-tray')({}, 'Preset'), { success: false, error: 'send failed' });
    ipcMain.listeners.get('files-dropped')({}, null);
  });

  await withHarness({}, async ({ ipcMain, moduleUnderTest }) => {
    moduleUnderTest.registerIpcHandlers();
    const win = createMainWindow([]);
    moduleUnderTest.setMainWindow(win);
    assert.deepEqual(ipcMain.handlers.get('reload-window')(), { success: true });
    moduleUnderTest.setMainWindow(null);
    moduleUnderTest.simulateKeyboardShortcut('K');
  });

  await withHarness({ mainWindowOptions: { rejectJavaScript: true, rejectJavaScriptValue: 'plain script failure' } }, async ({ electron, moduleUnderTest }) => {
    moduleUnderTest.createMenu();
    clickMenu(electron.Menu.getApplicationMenu());
    await Promise.resolve();
  });
});
