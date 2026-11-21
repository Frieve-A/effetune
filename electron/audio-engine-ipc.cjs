'use strict';

function registerAudioEngineIpc({ipcMain, MessageChannelMain, host, getMainWindow, loadDriver}) {
  let owner = null;
  let generation = 0;
  const listeners = [];
  const clearOwner = () => {
    ++generation;
    for (const [name, listener] of listeners) owner?.removeListener(name, listener);
    listeners.length = 0;
    owner = null;
    return host.stop();
  };
  const trusted = event => {
    const contents = getMainWindow()?.webContents;
    return contents && event.sender === contents && event.senderFrame === contents.mainFrame;
  };
  const stop = () => { void clearOwner(); };
  const methods = {
    async start(event, driver, token) {
      if (typeof token !== 'string' || !/^[\da-f-]{36}$/i.test(token)) return {ok:false};
      const closed = clearOwner();
      const serial = generation;
      owner = event.sender;
      const frame = event.senderFrame;
      const navigate = (_event, _url, same, main) => { if (main && !same) stop(); };
      listeners.push(['destroyed', stop], ['render-process-gone', stop], ['did-start-navigation', navigate]);
      for (const [name, listener] of listeners) owner.on(name, listener);
      await closed;
      if (serial !== generation) return {ok:false};
      const control = new MessageChannelMain(), feed = new MessageChannelMain();
      try {
        await host.start(driver, control.port1, feed.port1);
        if (serial !== generation || frame !== owner?.mainFrame) throw new Error('Audio engine owner changed');
        owner.postMessage('audio-engine:ports', token, [control.port2, feed.port2]);
        return {ok:true};
      } catch (error) {
        control.port2.close();
        feed.port2.close();
        if (serial === generation) await clearOwner();
        host.diagnostic('Could not start audio engine:', error);
        return {ok:false,reason:'unavailable'};
      }
    },
    stop: clearOwner,
    async list(_event, driver) {
      try { return {ok:true,...await host.list(driver)}; }
      catch { return {ok:false,inputs:[],outputs:[]}; }
    }
  };
  const cached = event => { event.returnValue = trusted(event) ? loadDriver() : 'standard'; };
  ipcMain.on('audio-engine:startup-driver', cached);
  for (const [name, handler] of Object.entries(methods))
    ipcMain.handle(`audio-engine:${name}`, (event, ...args) => trusted(event) ? handler(event,...args) : {ok:false});
  return async () => {
    ipcMain.removeListener('audio-engine:startup-driver', cached);
    for (const name of Object.keys(methods)) ipcMain.removeHandler(`audio-engine:${name}`);
    return clearOwner();
  };
}
module.exports = {registerAudioEngineIpc};
