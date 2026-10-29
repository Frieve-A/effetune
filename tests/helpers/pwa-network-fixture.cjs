'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { createNetworkLibraryFixture } = require('./network-music-library-fixture.cjs');
const { OpenHomeControlHost, CHANNELS: PLAYER } = require('../../electron/openhome-control-host.cjs');
const { OpenHomeMediaGateway } = require('../../electron/openhome-media-gateway.cjs');
const { RemoteControlHost, CHANNELS: EFFECTS } = require('../../electron/remote-control-host.cjs');
const { LocalOpenHomePlayer, PWA_ORIGIN } = require('../../electron/pwa-network-host.cjs');

async function createPwaNetworkFixture({ origin = PWA_ORIGIN, env = {} } = {}) {
  const library = await createNetworkLibraryFixture({ libraryId: `uuid:${crypto.randomUUID()}` });
  let remote; let playerHost; let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await remote?.dispose(); await playerHost?.dispose(); await library.close();
  };
  try {
    let config = { openHomeRemoteControl: false, openHomeDeviceId: crypto.randomUUID(), openHomeFriendlyName: 'PWA Fixture' };
    const sidecar = new EventEmitter();
    sidecar.starts = 0; sidecar.snapshots = []; sidecar.responses = [];
    sidecar.getStatus = () => ({ state: sidecar.starts ? 'ready' : 'stopped', available: true });
    sidecar.start = async () => { sidecar.starts++; return true; };
    sidecar.stop = async () => {};
    sidecar.publishState = state => { sidecar.snapshots.push(state); return true; };
    sidecar.respond = (requestId, result) => { sidecar.responses.push({ requestId, result }); return true; };
    sidecar.reject = () => true;
    const gateway = new OpenHomeMediaGateway();
    const queue = []; const actions = []; let nextId = 1; let revision = 0;
    const state = { transportState: 'Stopped', currentId: 0, repeat: false, shuffle: false, seconds: 0, duration: 10 };
    const effects = { pipeline: [{ nm: 'Volume', en: true, vl: 0 }], masterBypass: false };
    const snapshot = () => {
      const bytes = Buffer.alloc(queue.length * 4); queue.forEach((track, index) => bytes.writeUInt32BE(track.id, index * 4));
      return { ...state, tracksMax: 4096, idArray: bytes.toString('base64'), idArrayToken: revision };
    };
    const window = { isDestroyed: () => false, webContents: { send(channel, request) {
      if (channel === PLAYER.reset) { queueMicrotask(() => playerHost.handleRendererResetAck({ resetId: request.resetId, ok: true })); return; }
      if (channel === EFFECTS.request) {
        if (request.message.op === 'params') effects.pipeline[0].vl = request.message.params.vl;
        queueMicrotask(() => remote.handleRendererResponse({ requestId: request.requestId, ok: true, snapshot: effects })); return;
      }
      if (channel !== PLAYER.action) return;
      actions.push(request);
      queueMicrotask(async () => {
        const args = request.args; let result = {};
        try {
          switch (request.action) {
            case 'PlayItems': {
              const tracks = await Promise.all(args.items.map(async item => {
                const track = await library.serverHost.resolveTrack(item);
                return { id: nextId++, uri: track.uri, metadata: track.metadata,
                  ...(item.serverId === 'local' ? { libraryTrackId: item.trackId } : {}) };
              }));
              if (args.operationKind === 'play') queue.length = 0;
              const index = args.operationKind === 'playNext'
                ? Math.max(0, queue.findIndex(track => track.id === state.currentId) + 1) : queue.length;
              queue.splice(index, 0, ...tracks);
              revision++;
              if (args.operationKind === 'play') {
                state.currentId = tracks[args.startIndex].id;
                state.transportState = 'Playing';
              }
              break;
            }
            case 'Snapshot': result = snapshot(); break;
            case 'ReadList': result = { tracks: args.idList.map(id => queue.find(track => track.id === id)).filter(Boolean) }; break;
            case 'Insert': {
              const track = { id: nextId++, uri: args.uri, metadata: args.metadata };
              const index = args.afterId ? queue.findIndex(entry => entry.id === args.afterId) + 1 : 0;
              queue.splice(index, 0, track); revision++; result = { newId: track.id }; break;
            }
            case 'DeleteAll': queue.length = 0; state.currentId = 0; revision++; break;
            case 'DeleteId': { const index = queue.findIndex(track => track.id === args.id); if (index >= 0) queue.splice(index, 1); revision++; break; }
            case 'SeekId': state.currentId = args.id; break;
            case 'SeekSecondAbsolute': state.seconds = args.seconds; break;
            case 'Play': state.transportState = 'Playing'; break;
            case 'Pause': state.transportState = 'Paused'; break;
            case 'Stop': state.transportState = 'Stopped'; break;
            case 'SetRepeat': state.repeat = args.repeat; break;
            case 'SetShuffle': state.shuffle = args.shuffle; break;
            default: break;
          }
          playerHost.handleRendererResponse({ requestId: request.requestId, ok: true, result });
          playerHost.publishState(snapshot());
          } catch (error) {
          playerHost.handleRendererResponse({ requestId: request.requestId, ok: false,
            error: { code: error.code || 'unavailable', message: error.message } });
        }
      });
    } } };
    playerHost = new OpenHomeControlHost({ sidecar, gateway, getMainWindow: () => window, loadConfig: () => config, saveConfig: value => { config = value; return true; }, setAppConfig() {} });
    const player = new LocalOpenHomePlayer(playerHost);
    library.serverHost.localPlayer = player;
    remote = new RemoteControlHost({
      app: { getVersion: () => 'test' }, getMainWindow: () => window,
      config: { loadConfig: () => config, saveConfig: value => { config = value; return true; } },
      networkMusic: library.serverHost, localPlayer: player, pwaOrigin: origin,
      env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_TOKEN: 'pwa-test-control-token', ...env }, argv: [], log() {}
    });
    remote.bindWithFallback = server => new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    await playerHost.setRendererReady(); remote.rendererReady = true;
    if (!await remote.start()) throw new Error('Fixture could not start');
    const base = `${remote.secure ? 'https' : 'http'}://127.0.0.1:${remote.port}`;
    return { ...library, remote, player, playerHost, sidecar, gateway, queue, actions, effects, base, origin, snapshot, close };
  } catch (error) { await close(); throw error; }
}

module.exports = { createPwaNetworkFixture };
