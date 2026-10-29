import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { NetworkMusicHost } from '../../electron/network-music-host.cjs';
import { didl, didlItem, xml } from '../../electron/network-music-upnp.cjs';
import { parseCommentedJSON } from '../../js/utils/parse-commented-json.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../effetune.html');
const csp = html.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
const artwork = 'http://192.168.1.20/cover.png';
const header = html.slice(html.indexOf('    <div class="title-container">'), html.indexOf('    <div class="main-container">'));
const css = read('../../css/effetune-theme.css') +
  read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '') +
  read('../../css/effetune-mobile.css');

test('real header and sole Player retain their geometry and destination ownership', async () => {
  const discovery = new EventEmitter();
  discovery.close = () => {};
  discovery.devices = new Map([['room', {
    id: 'room', available: true,
    services: new Map(['Playlist', 'Time'].map(name => [`urn:av-openhome-org:service:${name}`, { type: `urn:av-openhome-org:service:${name}:1` }]))
  }]]);
  const ids = Buffer.alloc(8);
  ids.writeUInt32BE(8, 0); ids.writeUInt32BE(9, 4);
  const tracks = [{ id: 8, title: 'Remote song', artist: 'Artist', artwork }, { id: 9, title: 'Next song' }];
  const responses = {
    IdArray: { Array: ids.toString('base64'), Token: '1' }, TransportState: { Value: 'Playing' },
    Id: { Value: '8' }, Repeat: { Value: '0' }, Shuffle: { Value: '0' }, ProtocolInfo: { Value: 'http-get:*:audio/flac:*' },
    ReadList: { TrackList: `<TrackList>${tracks.map(track => `<Entry><Id>${track.id}</Id><Uri>http://192.168.1.20/${track.id}.flac</Uri><Metadata>${xml(didl([didlItem(track)]))}</Metadata></Entry>`).join('')}</TrackList>` },
    IdArrayChanged: { Value: '0' }, Time: { Seconds: '42', Duration: '180' }
  };
  const host = new NetworkMusicHost({
    getCatalog: async () => null, loadConfig: () => ({ networkMusicDeviceId: 'local' }), saveConfig() {},
    discovery, gateway: { close() {} }, invoke: async (_service, action) => responses[action]
  });
  let playerState;
  try { playerState = await host.getPlayerState({ playerId: 'room' }); }
  finally { await host.dispose(); }
  assert.equal(playerState.queue[0].artwork, artwork);
  assert.equal(playerState.queue[0].artworkUrl, undefined);
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      contents: `
        import { AudioPlayerUI } from './js/ui/audio-player/audio-player-ui.js';
        import { StateManager } from './js/ui/audio-player/state-manager.js';
        import { NetworkMusicController } from './js/network-music/controller.js';
        import { NetworkMusicView } from './js/network-music/view.js';
        const commands = [];
        const notifications = [];
        const messages = [];
        const local = { playbackManager: {}, contextManager: {} };
        local.stateManager = new StateManager(local);
        local.stateManager.updateState({ currentTrackName: 'Local song' });
        const uiManager = window.uiManager = {
          audioPlayer: local, layoutMode: { isMobile: document.body.classList.contains('layout-mobile') },
          t: key => 'JA:' + key, setError: (...args) => notifications.push(args),
          showTransientMessage: (...args) => messages.push(args)
        };
        window.electronAPI = { remoteClient: { getConnection: async () => ({ registered: false }) } };
        local.ui = new AudioPlayerUI(local);
        local.ui.createPlayerUI();
        const container = local.ui.container;
        const api = {
          networkMusicGetPlayerState: async () => (${JSON.stringify(playerState)}),
          networkMusicPlayerCommand: async request => commands.push(request),
          networkMusicPlayFiles: async request => commands.push(request)
        };
        const controller = uiManager.networkMusic = new NetworkMusicController({ api, uiManager });
        controller.applyState({ players: [{ id: 'room', name: 'Living room' }], libraries: [], sharing: {} });
        const view = uiManager.networkMusicView = new NetworkMusicView({ controller, uiManager });
        view.mount();
        document.getElementById('openMusicButton').addEventListener('click', () => controller.playFiles(['song.flac']));
        window.fixture = { local, controller, view, commands, notifications, messages, api, container };
      `
    },
    bundle: true, write: false, format: 'iife', platform: 'browser'
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    for (const width of [1280, 390]) {
      const mobile = width === 390;
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(artwork, route => route.fulfill({ contentType: 'image/png', body: readFileSync(new URL('../../images/icon_64x64.png', import.meta.url)) }));
      await page.setContent(`<!doctype html><html class="layout-${mobile ? 'mobile' : 'desktop'}"><head>${csp}</head><body class="layout-${mobile ? 'mobile' : 'desktop'}">${header}<div id="mobilePlayerView" class="mobile-player-view"></div><main class="main-container"></main></body></html>`);
      await page.addStyleTag({ content: css });
      await page.locator('#errorDisplay').evaluate(element => { element.textContent = ''; });
      await page.locator('.title-icon').evaluate((element, data) => { element.src = data; },
        `data:image/png;base64,${readFileSync(new URL('../../images/icon_64x64.png', import.meta.url)).toString('base64')}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => {
        fixture.api.networkMusicDiscover = () => new Promise(resolve => { fixture.completeDiscovery = resolve; });
      });
      await page.locator('.network-refresh-button').click();
      assert.deepEqual(await page.evaluate(() => fixture.messages), [], 'refresh feedback waits for discovery to succeed');
      await page.evaluate(() => fixture.completeDiscovery(fixture.controller.state));
      await page.waitForFunction(() => fixture.messages.length === 1);
      assert.deepEqual(await page.evaluate(() => fixture.messages), [['networkMusic.refreshStarted']]);
      await page.evaluate(() => { fixture.api.networkMusicDiscover = async () => { throw new Error('offline'); }; });
      await page.locator('.network-refresh-button').click();
      await page.waitForFunction(() => fixture.notifications.length === 1);
      assert.deepEqual(await page.evaluate(() => fixture.notifications), [['networkMusic.error', true]]);
      assert.equal(await page.evaluate(() => fixture.messages.length), 1, 'failed discovery must not show success feedback');
      await page.evaluate(() => { fixture.notifications.length = 0; });
      await page.selectOption('.network-playback-target select', 'room');
      await page.waitForFunction(() => document.querySelector('.track-name')?.textContent === 'Artist - Remote song');
      const renamedPlayer = await page.evaluate(() => {
        const { controller, view, commands } = fixture;
        const playback = view.playbackAdapter;
        const state = controller.playerStates.get('room');
        const generation = controller.playerGeneration;
        const commandCount = commands.length;
        controller.applyState({ ...controller.state, players: [{ ...controller.selectedPlayer, name: 'Bedroom PC' }] });
        return {
          selectedId: controller.selectedPlayerId,
          samePlayback: view.playbackAdapter === playback,
          sameState: controller.playerStates.get('room') === state,
          sameGeneration: controller.playerGeneration === generation,
          commandCountUnchanged: commands.length === commandCount
        };
      });
      assert.deepEqual(renamedPlayer, { selectedId: 'room', samePlayback: true, sameState: true,
        sameGeneration: true, commandCountUnchanged: true });
      assert.equal(await page.locator('.network-playback-target option:checked').textContent(), 'Bedroom PC');
      assert.equal(await page.locator('.network-effects').isVisible(), false);
      assert.equal(await page.locator('.network-playback-target option[value="local"]').textContent(), 'JA:networkMusic.local');
      if (!mobile) await page.evaluate(() => fixture.local.ui.setDesktopQueueExpanded(true));
      await page.waitForFunction(() => document.querySelector('.player-artwork-image')?.naturalWidth > 0);
      assert.equal(await page.locator('.player-artwork-image').getAttribute('src'), artwork);
      assert.equal(await page.locator('.player-artwork-image').isVisible(), true);
      await page.evaluate(() => {
        fixture.controller.playerStates.get('room').position = 58;
        fixture.controller.emit();
      });
      assert.equal(await page.locator('.time-display').innerText(), '00:58 / 03:00');
      assert.ok(Math.abs(Number(await page.locator('.seek-bar').inputValue()) - 58 / 180 * 100) < 0.1);
      assert.equal(await page.locator('.audio-player').count(), 1);
      assert.equal(await page.locator('.network-transport, .network-queue').count(), 0);
      assert.equal(await page.evaluate(() => fixture.local.ui.container === fixture.container), true);
      assert.equal(await page.locator('.audio-player').isVisible(), true);
      assert.equal(await page.locator('#openMusicButton').isEnabled(), true);
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        const title = document.createRange();
        title.selectNode(document.querySelector('h1').firstChild);
        return { select: rect('.network-playback-target select'), refresh: rect('.network-refresh-button'), open: rect('#openMusicButton'), heading: title.getBoundingClientRect().toJSON() };
      });
      if (process.env.NETWORK_MUSIC_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.NETWORK_MUSIC_SCREENSHOT_DIR}/network-player-${width}.png`, fullPage: true });
      }
      assert.ok(geometry.select.left >= 0 && geometry.open.right <= width);
      if (mobile) {
        assert.equal(geometry.select.height, geometry.open.height);
        assert.equal(geometry.refresh.height, geometry.open.height);
      }
      assert.equal(geometry.select.top + geometry.select.height / 2, geometry.open.top + geometry.open.height / 2);
      assert.equal(geometry.refresh.top + geometry.refresh.height / 2, geometry.open.top + geometry.open.height / 2);
      assert.ok(geometry.select.right < geometry.refresh.left);
      assert.ok(geometry.refresh.right < geometry.open.left);
      assert.ok(geometry.heading.bottom <= geometry.select.top || geometry.heading.right <= geometry.select.left,
        'the title and destination controls must not overlap');
      await page.locator('.network-playback-target select').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.network-refresh-button').evaluate(element => element === document.activeElement), true);
      assert.equal(await page.locator('.network-playback-target select').getAttribute('title'), 'Bedroom PC');
      assert.equal(await page.locator('.network-playback-target select').getAttribute('aria-label'), 'JA:networkMusic.player');
      assert.equal(await page.locator('.network-effects .pipeline-title, .network-effects form').count(), 0);
      await page.locator('.play-pause-button').click();
      await page.locator('#openMusicButton').click();
      assert.deepEqual(await page.evaluate(() => fixture.commands.map(command => [command.playerId, command.action || command.operationKind])), [['room', 'pause'], ['room', 'play']]);
      await page.evaluate(() => fixture.local.stateManager.updateState({ currentTrackName: 'Local changed' }));
      assert.equal(await page.locator('.track-name').innerText(), 'Artist - Remote song');
      if (process.env.NETWORK_MUSIC_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.NETWORK_MUSIC_SCREENSHOT_DIR}/network-player-${width}.png`, fullPage: true });
      }
      await page.selectOption('.network-playback-target select', 'local');
      await page.waitForFunction(() => document.querySelector('.track-name')?.textContent === 'Local changed');
      assert.equal(await page.evaluate(() => fixture.local.ui.container === fixture.container), true);
      await page.selectOption('.network-playback-target select', 'room');
      await page.waitForFunction(() => document.querySelector('.track-name')?.textContent === 'Artist - Remote song');
      await page.evaluate(() => {
        fixture.local.ui.setDesktopQueueExpanded(true);
        fixture.api.networkMusicPlayerCommand = async request => {
          fixture.commands.push(request);
          throw Object.assign(new Error('connection lost'), { code: 'unavailable' });
        };
      });
      await page.locator('.player-playlist-item').first().click();
      await page.waitForFunction(() => fixture.notifications.length === 1);
      await page.locator('.next-button').click();
      await page.waitForFunction(() => fixture.notifications.length === 2);
      await page.evaluate(() => { fixture.local.ui.audioPlayer.playNext(); });
      await page.waitForFunction(() => fixture.notifications.length === 3);
      await page.locator('.close-button').click();
      await page.waitForFunction(() => fixture.notifications.length === 4);
      assert.equal(await page.locator('.audio-player').isVisible(), true, 'a failed pause must keep the Player open');
      assert.equal(await page.locator('.close-button').isEnabled(), true);
      assert.deepEqual(await page.evaluate(() => fixture.notifications), Array(4).fill(['networkMusic.error', true]));
      assert.deepEqual(await page.evaluate(() => fixture.commands.slice(-4).map(command => command.action)), ['seekId', 'next', 'next', 'pause']);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});


test('network browsing uses the Music Library shell, rows and gestures while keeping source paging isolated', async () => {
  const tracks = [
    { id: 'one', trackUid: 'one', title: 'Morning Light', artist: 'The Quartet', album: 'Open Skies', genre: 'Jazz', trackNo: 1, durationSec: 223, resources: [{ protocolInfo: 'http-get:*:audio/flac:*' }] },
    { id: 'two', trackUid: 'two', title: 'Across the Water', artist: 'The Quartet', album: 'Open Skies', genre: 'Jazz', trackNo: 2, durationSec: 187, resources: [{ protocolInfo: 'http-get:*:audio/mpeg:*' }] },
    { id: 'three', trackUid: 'three', title: 'Evening in the City', artist: 'Maya Bennett', album: 'Nightfall', genre: 'Soul', trackNo: 3, durationSec: 264 }
  ];
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), contents: `
      import { LibraryView } from './js/ui/library/library-view.js';
      import { AudioPlayerUI } from './js/ui/audio-player/audio-player-ui.js';
      import { NetworkMusicView } from './js/network-music/view.js';
      import { NetworkMusicController } from './js/network-music/controller.js';
      const tracks = ${JSON.stringify(tracks)};
      const commands = [], requests = [], notifications = [];
      const uiManager = window.uiManager = { t: key => key, setError: (...args) => notifications.push(args) };
      const manager = {
        createContext: async () => 'context', releaseContext: async () => {},
        queryTracks: async () => ({ rows: tracks, totalCount: tracks.length, nextCursor: null }),
        queryEntities: async () => ({ rows: [], totalCount: 0, nextCursor: null }),
        getCounts: async () => ({ tracks: tracks.length, folders: 1 }), getTrack: async id => tracks.find(track => track.id === id),
        browseFolderChildren: async () => ({ children: [{ name: 'Albums', recursiveTrackCount: 3 }], hasMore: false, nodeExists: true }),
        performSelectionAction: async (...args) => commands.push(args)
      };
      const library = new LibraryView({ manager, uiManager });
      library.currentView = 'tracks';
      library.detail = { type: 'folderNode', folderId: 'music', path: '', title: 'Studio' };
      library.mount();
      const api = { networkMusicBrowse: async request => {
        requests.push(request);
        return { items: [{ id: 'albums', title: 'Albums', isContainer: true }, ...tracks], total: 4 };
      } };
      const controller = uiManager.networkMusic = new NetworkMusicController({ api, uiManager });
      controller.state.libraries = [{ id: 'studio', name: 'Studio', searchSupported: true }, { id: 'no-search', name: 'Archive', searchSupported: false }];
      controller.playItems = async (...args) => commands.push(args);
      const view = uiManager.networkMusicView = new NetworkMusicView({ controller, uiManager });
      view.mount();
      view.attachLibrary(library);
      window.fixture = { library, view, controller, api, manager, tracks, commands, requests, notifications, AudioPlayerUI };
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser'
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    for (const width of [1280, 390]) {
      const mobile = width === 390;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent(`<!doctype html><html class="layout-${mobile ? 'mobile' : 'desktop'}"><body class="view-library layout-${mobile ? 'mobile' : 'desktop'}">${html.slice(html.indexOf('    <div class="title-container">'), html.indexOf('    <script type="module" src="js/startup.js"'))}</body></html>`);
      await page.addStyleTag({ content: css + read('../../css/effetune-library.css') });
      // Supply the host width normally established by the live pipeline layout.
      if (!mobile) await page.locator('body').evaluate(element => { element.style.width = '100%'; element.style.boxSizing = 'border-box'; });
      await page.locator('#errorDisplay').evaluate(element => { element.textContent = ''; });
      await page.locator('.title-icon').evaluate((element, data) => { element.src = data; }, `data:image/png;base64,${readFileSync(new URL('../../images/icon_64x64.png', import.meta.url)).toString('base64')}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForFunction(() => fixture.library.pagedState?.phase === 'committed' && document.querySelector('.library-folder-directory-row'));
      await page.evaluate(() => { fixture.library.clearSelection(); fixture.library.refreshPagedSelectionState(); });
      const metrics = selector => page.locator(selector).first().evaluate(element => {
        const style = getComputedStyle(element);
        return { height: element.getBoundingClientRect().height, font: style.font, padding: style.padding, grid: style.gridTemplateColumns, background: style.background, border: style.border };
      });
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
      const original = {};
      for (const selector of ['.library-header', '.library-search', '.library-paged-row', '.library-folder-directory-row']) original[selector] = await metrics(`.library-main:not(.network-library-main) ${selector}`);
      const localMain = page.locator('.library-main:not(.network-library-main)');
      const originalContent = await localMain.locator('.library-content').boundingBox();
      const originalStatus = await localMain.locator('.library-status').boundingBox();
      await page.evaluate(() => { fixture.view.localPlaybackNotice.hidden = false; });
      const notice = await localMain.locator('.library-message').boundingBox();
      const contentWithNotice = await localMain.locator('.library-content').boundingBox();
      assert.equal((await metrics('.library-main:not(.network-library-main) .library-header')).height, original['.library-header'].height);
      assert.ok(Math.abs(contentWithNotice.y - originalContent.y - notice.height) < 1);
      assert.ok(Math.abs(originalContent.height - contentWithNotice.height - notice.height) < 1);
      assert.deepEqual(await localMain.locator('.library-status').boundingBox(), originalStatus);
      await page.evaluate(() => { fixture.view.localPlaybackNotice.hidden = true; });
      assert.deepEqual(await localMain.locator('.library-content').boundingBox(), originalContent);
      if (!mobile) {
        const librarySelect = await page.locator('.library-source select').boundingBox();
        const librarySearch = await page.locator('.library-main:not(.network-library-main) .library-search').boundingBox();
        assert.equal(librarySelect.y, librarySearch.y);
        assert.equal(librarySelect.height, librarySearch.height);
        const refresh = await page.locator('.network-refresh-button').boundingBox();
        const libraryRefresh = await page.locator('.library-main:not(.network-library-main) .library-rescan').boundingBox();
        assert.equal(refresh.width, libraryRefresh.width);
        assert.equal(refresh.height, libraryRefresh.height);
        assert.equal(await page.locator('.network-refresh-button svg').evaluate(element => element.outerHTML),
          await page.locator('.library-main:not(.network-library-main) .library-rescan svg').evaluate(element => element.outerHTML));
        assert.equal((await metrics('.network-refresh-button')).background,
          (await metrics('.library-main:not(.network-library-main) .library-rescan')).background);
        await page.locator('.network-refresh-button').hover();
        await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
        const refreshHover = (await metrics('.network-refresh-button')).background;
        await page.locator('.library-main:not(.network-library-main) .library-rescan').hover();
        assert.equal(refreshHover, (await metrics('.library-main:not(.network-library-main) .library-rescan')).background);
        await page.mouse.move(0, 0);
      }
      const screenshot = async name => {
        if (process.env.NETWORK_MUSIC_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.NETWORK_MUSIC_SCREENSHOT_DIR}/${name}-${width}.png`, fullPage: true });
      };
      await screenshot('library-local');
      if (process.env.NETWORK_MUSIC_SCREENSHOT_DIR) {
        await page.evaluate(() => {
          fixture.library.pagedController.toggleSelection('one', true, { ordinal: 0 });
          fixture.library.setPagedMobileSelectionActive(true);
          fixture.library.refreshPagedSelectionState();
        });
        await screenshot('library-local-selected');
        await page.evaluate(() => { fixture.library.clearSelection(); fixture.library.refreshPagedSelectionState(); });
      }
      await page.selectOption('.library-source select', 'studio');
      await page.waitForFunction(() => fixture.view.libraryRows?.length === 3);
      const renamedLibrary = await page.evaluate(() => {
        const { controller, view, requests } = fixture;
        const location = controller.libraryLocations.get('studio');
        const rows = view.libraryRows;
        const generation = controller.libraryGeneration;
        const requestCount = requests.length;
        controller.applyState({ ...controller.state,
          libraries: controller.state.libraries.map(library => library.id === 'studio'
            ? { ...library, name: 'Studio PC' } : library) });
        return {
          selectedId: controller.selectedLibraryId,
          sameLocation: controller.libraryLocations.get('studio') === location,
          sameRows: view.libraryRows === rows,
          sameGeneration: controller.libraryGeneration === generation,
          requestCountUnchanged: requests.length === requestCount
        };
      });
      assert.deepEqual(renamedLibrary, { selectedId: 'studio', sameLocation: true, sameRows: true,
        sameGeneration: true, requestCountUnchanged: true });
      assert.equal(await page.locator('.library-source option:checked').textContent(), 'Studio PC');
      assert.equal(await page.locator('.library-source option[value="local"]').textContent(), 'This device');
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
      for (const selector of ['.library-header', '.library-search', '.library-paged-row', '.library-folder-directory-row']) {
        const actual = await metrics(`.network-library-main ${selector}`);
        if (selector === '.library-folder-directory-row') { delete actual.grid; delete original[selector].grid; } // Network containers do not expose recursive track counts.
        assert.deepEqual(actual, original[selector], `${selector} must share the existing Library presentation at ${width}px`);
      }
      assert.equal(await page.locator('.network-library-main .library-track-title-text').allTextContents().then(items => items.join('|')), tracks.map(track => track.title).join('|'));
      assert.equal(await page.locator('.network-library-row, .network-library-title, .network-library-header').count(), 0);
      await screenshot('library-network');
      const row = page.locator('.network-library-main .library-paged-row').first();
      if (mobile) {
        await row.click();
        assert.equal(await page.evaluate(() => fixture.commands.length), 1);
        await row.dispatchEvent('touchstart');
        await page.waitForFunction(() => fixture.library.root.classList.contains('mobile-selection-mode'));
        await row.dispatchEvent('touchend');
      } else {
        await row.click();
        assert.equal(await page.evaluate(() => fixture.commands.length), 0);
      }
      assert.equal(await row.getAttribute('aria-selected'), 'true');
      await screenshot('library-network-selected');
      await row.locator('.library-paged-row-more').click();
      await page.locator('.library-context-menu button').nth(1).click();
      assert.equal(await page.evaluate(() => fixture.commands.at(-1)[1]), 'playNext');
      await page.locator('.network-library-main .library-paged-queue').click();
      assert.equal(await page.evaluate(() => fixture.commands.at(-1)[1]), 'queue');
      const shortcutStart = await page.evaluate(() => fixture.commands.length);
      for (const shortcut of ['Control+Enter', 'Meta+Enter', 'Shift+Enter', 'Control+Shift+Enter', 'Meta+Shift+Enter', 'Enter']) {
        await row.press(shortcut);
      }
      await page.waitForFunction(start => fixture.commands.length === start + 6, shortcutStart);
      assert.deepEqual(await page.evaluate(start => fixture.commands.slice(start).map(command => command[1]), shortcutStart),
        ['queue', 'queue', 'playNext', 'queue', 'queue', 'play'], 'modified Enter must never replace the queue with immediate playback');
      await page.evaluate(() => {
        fixture.controller.selectedPlayerId = 'room';
        fixture.controller.playerStates.set('room', { protocolInfo: 'http-get:*:audio/mpeg:*' });
        fixture.view.updateLibraryTrackActions();
      });
      assert.equal(await row.getAttribute('aria-disabled'), null);
      assert.equal(await row.locator('.library-paged-select').isDisabled(), true);
      assert.equal(await page.locator('.network-library-main .library-paged-play').isDisabled(), true);
      await page.evaluate(() => {
        fixture.library.root.classList.remove('mobile-selection-mode');
        fixture.notifications.length = 0;
      });
      const commandCount = await page.evaluate(() => fixture.commands.length);
      if (mobile) {
        await row.dispatchEvent('touchstart');
        await row.dispatchEvent('touchend');
        await row.click();
      }
      else await row.dblclick();
      assert.equal(await page.evaluate(() => fixture.notifications.length), 1);
      await row.press('Enter');
      assert.equal(await page.evaluate(() => fixture.notifications.length), 2);
      await row.locator('.library-paged-row-more').click();
      await page.locator('.library-context-menu button').first().click();
      assert.deepEqual(await page.evaluate(() => fixture.notifications), Array(3).fill(['networkMusic.unsupported', true]));
      assert.equal(await page.evaluate(() => fixture.commands.length), commandCount);
      if (mobile) {
        await page.evaluate(() => {
          fixture.tracks.forEach(track => { track.playable = false; });
          fixture.view.updateLibraryTrackActions();
        });
        const playAlbum = page.locator('.network-library-main .library-paged-play');
        assert.equal(await playAlbum.isEnabled(), true);
        await playAlbum.click();
        await page.waitForFunction(() => fixture.notifications.length === 4);
        assert.equal(await page.evaluate(() => fixture.commands.length), commandCount);
        await page.evaluate(() => fixture.tracks.forEach(track => { delete track.playable; }));
      }
      await page.evaluate(() => { fixture.controller.selectedPlayerId = 'local'; fixture.view.updateLibraryTrackActions(); });
      await page.locator('.network-library-main .library-folder-directory-row').click();
      await page.waitForFunction(() => document.querySelector('.network-library-main h2')?.textContent === 'Albums');
      await page.locator('.network-library-main .library-back').click();
      await page.waitForFunction(() => document.querySelector('.network-library-main h2')?.textContent === 'Studio PC');
      await page.locator('.network-library-main .library-content').focus();
      await page.keyboard.press('/');
      assert.equal(await page.locator('.network-library-main .library-search').evaluate(element => element === document.activeElement), true);
      const search = page.locator('.network-library-main .library-search');
      await page.evaluate(() => Object.assign(fixture.controller.libraryLocations.get('studio'), { start: 99, pageStarts: [0], scrollTop: 100 }));
      await search.fill('Morning');
      await page.waitForFunction(() => fixture.requests.at(-1).query === 'Morning');
      assert.deepEqual(await page.evaluate(() => {
        const location = fixture.controller.libraryLocations.get('studio');
        return [fixture.requests.at(-1).start, location.query, location.pageStarts, location.scrollTop];
      }), [0, 'Morning', [], 0]);
      // Escape invokes Chromium's native search-field clear and its input event.
      await search.press('Escape');
      assert.equal(await search.inputValue(), '');
      await page.waitForFunction(() => !fixture.requests.at(-1).query && fixture.controller.libraryLocations.get('studio').query === '');
      const beforeComposition = await page.evaluate(() => fixture.requests.length);
      await page.evaluate(async () => {
        const input = fixture.view.librarySearch;
        input.value = 'pending';
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        input.value = '朝';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
        await new Promise(resolve => setTimeout(resolve, 150));
      });
      assert.equal(await page.evaluate(() => fixture.requests.length), beforeComposition, 'IME must cancel the pending debounce and never submit an intermediate value');
      await search.dispatchEvent('compositionend', { data: '朝' });
      await page.waitForFunction(() => fixture.requests.at(-1).query === '朝');
      assert.equal(await page.evaluate(() => fixture.requests.length), beforeComposition + 1);
      const beforeSourceChange = await page.evaluate(() => fixture.requests.length);
      await page.evaluate(async () => {
        fixture.view.librarySearch.value = 'uncommitted';
        fixture.view.librarySearch.dispatchEvent(new InputEvent('input', { bubbles: true }));
        fixture.controller.selectLibrary('local');
        await new Promise(resolve => setTimeout(resolve, 150));
      });
      assert.equal(await page.evaluate(() => fixture.requests.length), beforeSourceChange, 'changing sources must retire the delayed search');
      assert.equal(await page.evaluate(() => fixture.controller.libraryLocations.get('studio').query), '朝');
      await page.selectOption('.library-source select', 'studio');
      await page.waitForFunction(() => fixture.view.libraryRows?.length === 3);
      await search.fill('Morning');
      await page.waitForFunction(() => fixture.requests.at(-1).query === 'Morning');
      // A late response from a different source cannot replace the current Library.
      await page.evaluate(() => {
        fixture.api.networkMusicBrowse = () => new Promise(resolve => { fixture.resolveBrowse = resolve; });
        fixture.pendingBrowse = fixture.view.renderLibrary();
      });
      await screenshot('library-network-loading');
      await page.selectOption('.library-source select', 'local');
      await page.evaluate(async () => { fixture.resolveBrowse({ items: [], total: 0 }); await fixture.pendingBrowse; });
      assert.equal(await page.locator('.library-main:not(.network-library-main)').isVisible(), true);
      await page.evaluate(() => { fixture.api.networkMusicBrowse = async () => { throw new Error('offline'); }; });
      await page.selectOption('.library-source select', 'studio');
      await page.waitForFunction(() => document.querySelector('.network-library-main .library-paged-error'));
      await screenshot('library-network-error');
      await page.evaluate(() => { fixture.api.networkMusicBrowse = async () => ({ items: [], total: 0 }); });
      await page.locator('.network-library-main .library-paged-retry').click();
      await page.waitForFunction(() => document.querySelector('.network-library-main .library-empty'));
      await screenshot('library-network-empty');
      // Servers may cap page sizes or omit totals; navigation follows returned entries.
      await page.evaluate(() => {
        Object.assign(fixture.controller.libraryLocations.get('studio'), { query: '', start: 0, pageStarts: [] });
        fixture.requests.length = 0;
        fixture.api.networkMusicBrowse = async request => {
          fixture.requests.push(request);
          return { total: 0, items: request.start < 6 ? fixture.tracks : [] };
        };
        return fixture.view.renderLibrary();
      });
      await page.locator('.network-library-main .library-pagination button').last().click();
      await page.waitForFunction(() => fixture.requests.at(-1).start === 3);
      await page.locator('.network-library-main .library-pagination button').last().click();
      await page.waitForFunction(() => fixture.requests.at(-1).start === 6);
      assert.equal(await page.locator('.network-library-main .library-pagination button').last().isDisabled(), true);
      await page.locator('.network-library-main .library-pagination button').first().click();
      await page.waitForFunction(() => fixture.requests.at(-1).start === 3);
      await page.selectOption('.library-source select', 'no-search');
      await page.waitForFunction(() => fixture.view.librarySearch.parentElement.hidden);
      assert.equal(await page.locator('.network-library-main .library-search').isVisible(), false);
      assert.equal(await page.locator('.network-library-main .library-sort-button').count(), 0);
      assert.equal(await page.locator('.network-library-nav button').count(), 0);
      // Rich sources advertise their catalog views; generic servers keep their native hierarchy.
      await page.evaluate(() => {
        const views = ['tracks', 'albums', 'artists', 'genres', 'subfolders', 'files', 'folders', 'recent', 'playlists'];
        const types = { albums: 'album.musicAlbum', artists: 'person.musicArtist', genres: 'genre.musicGenre',
          subfolders: 'storageFolder', folders: 'storageFolder', playlists: 'playlistContainer' };
        fixture.entities = Object.fromEntries(Object.entries(types).map(([view, type]) => [view, {
          id: `${view}-one`, title: view === 'albums' ? 'Open Skies' : view === 'folders' ? 'Studio' : view,
          isContainer: true, upnpClass: `object.container.${type}`, trackCount: 3, artist: 'The Quartet',
          ...(view === 'folders' ? { treeObjectId: 'folders-one', flatObjectId: 'folder-flat' } : {})
        }]));
        fixture.controller.state.libraries.push({ id: 'rich', name: 'Studio catalog', searchSupported: true,
          browseViews: views.map(id => ({ id, objectId: id })),
          sortCaps: ['dc:title', 'upnp:artist', 'upnp:album', 'upnp:genre', 'upnp:originalTrackNumber', 'res@duration', 'et:displayPath', 'et:addedAt'] });
        fixture.api.networkMusicBrowse = async request => {
          fixture.requests.push(request);
          const id = request.objectId;
          let items = fixture.entities[id] ? [fixture.entities[id]] : fixture.tracks.map(track => ({ ...track, displayPath: `Music/${track.title}.flac`, albumObjectId: 'albums-one', artistObjectId: 'artists-one' }));
          if (id === 'folders-one') items = [{ id: 'child', title: 'Live', isContainer: true, upnpClass: 'object.container.storageFolder', treeObjectId: 'child', flatObjectId: 'child-flat' }, fixture.tracks[0]];
          if (id === 'playlists-one') items = [fixture.tracks[0], fixture.tracks[1], fixture.tracks[0]].map((item, index) => ({ ...item, id: `${item.id}:entry-${index}` }));
          if (request.query) items = fixture.tracks.filter(item => item.title.includes(request.query));
          if (request.sortCriteria === '-dc:title') items = [...items].sort((a, b) => b.title.localeCompare(a.title));
          return { items, total: items.length };
        };
        fixture.controller.selectLibrary('rich');
      });
      await page.waitForFunction(() => fixture.view.libraryRows?.length === 3);
      assert.deepEqual(await page.locator('.network-library-nav [data-view]').evaluateAll(buttons => buttons.map(button => button.dataset.view)),
        ['tracks', 'albums', 'artists', 'genres', 'subfolders', 'files', 'folders', 'recent', 'playlists']);
      for (const [view, selector] of [
        ['albums', '.library-paged-media-card'], ['artists', '.library-paged-media-card'], ['genres', '.library-paged-media-card'],
        ['subfolders', '.library-paged-media-card'], ['files', '.library-file-row'], ['folders', '.library-paged-folder-main'],
        ['recent', '.library-track-title-text'], ['playlists', '.library-paged-media-card']
      ]) {
        await page.locator(`.network-library-nav [data-view="${view}"]`).click();
        await page.waitForFunction(view => fixture.requests.at(-1).objectId === view, view);
        assert.ok(await page.locator(`.network-library-main ${selector}`).count() > 0, `${view} must use its original Library view family`);
        await screenshot(`library-network-${view}`);
      }
      await page.locator('.network-library-main .library-paged-entity-open').click();
      await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'playlists-one');
      assert.deepEqual(await page.locator('.network-library-main .library-track-title-text').allTextContents(), ['Morning Light', 'Across the Water', 'Morning Light']);
      assert.equal(await page.locator('.network-library-main .library-sort-button, .network-library-main .library-playlist-controls').count(), 0);
      assert.deepEqual(await page.locator('.network-library-main .library-paged-row').evaluateAll(rows => rows.map(row => row.getAttribute('aria-selected'))), ['true', 'true', 'true']);
      await page.evaluate(() => fixture.view.selectLibraryTrack(0, true, { exclusive: true }));
      assert.deepEqual(await page.locator('.network-library-main .library-paged-row').evaluateAll(rows => rows.map(row => row.getAttribute('aria-selected'))), ['true', 'false', 'false']);
      // Pointer activation keeps the full context and starts at the clicked occurrence.
      await page.evaluate(() => fixture.view.libraryRows.forEach((_, index) => fixture.view.selectLibraryTrack(index, true)));
      const playlistRows = page.locator('.network-library-main .library-paged-row');
      const activationCount = await page.evaluate(() => fixture.commands.length);
      if (mobile) await playlistRows.nth(2).click();
      else await playlistRows.nth(2).dispatchEvent('dblclick');
      await page.waitForFunction(count => fixture.commands.length === count + 1, activationCount);
      assert.deepEqual(await page.evaluate(() => fixture.commands.at(-1).slice(0, 3)), [[
        { serverId: 'rich', trackId: 'one:entry-0' }, { serverId: 'rich', trackId: 'two:entry-1' }, { serverId: 'rich', trackId: 'one:entry-2' }
      ], 'play', 2]);
      await playlistRows.nth(1).press('Enter');
      assert.deepEqual(await page.evaluate(() => fixture.commands.at(-1).slice(0, 3)), [[{ serverId: 'rich', trackId: 'two:entry-1' }], 'play', 0]);
      if (mobile) {
        await playlistRows.first().dispatchEvent('touchstart');
        await page.waitForFunction(() => fixture.library.root.classList.contains('mobile-selection-mode'));
        await playlistRows.first().dispatchEvent('touchend');
      }
      await page.locator('.network-library-main .library-paged-play').click();
      assert.equal(await page.evaluate(() => fixture.commands.at(-1)[0].length), 3);
      await page.evaluate(() => {
        const { view, controller } = fixture;
        fixture.savedAudioPlayer = window.uiManager.audioPlayer;
        fixture.playbackState = { currentTrack: { meta: { networkLibrary: { serverId: 'rich', trackId: view.libraryRows[1].item.id } } } };
        window.uiManager.audioPlayer = { stateManager: { getStateSnapshot: () => fixture.playbackState } };
        fixture.playerUi = Object.create(fixture.AudioPlayerUI.prototype);
        fixture.playerUi.audioPlayer = window.uiManager.audioPlayer;
        controller.selectedPlayerId = 'local';
        fixture.playerUi.notifyLibraryNowPlaying();
      });
      assert.equal(await page.locator('.network-library-main .now-playing').getAttribute('data-track-id'), 'two:entry-1');
      assert.equal(await page.locator('.network-library-main .now-playing .library-now-playing-indicator').isVisible(), true);
      await page.evaluate(() => {
        fixture.playbackState.currentTrack.meta.networkLibrary.serverId = 'another-library';
        fixture.playerUi.notifyLibraryNowPlaying();
      });
      assert.equal(await page.locator('.network-library-main .now-playing').count(), 0);
      await page.evaluate(() => {
        fixture.view.libraryRows[0].item.resources = [{ uri: 'https://music.test/first.flac' }];
        fixture.playbackState.currentTrack = { meta: { openHomeQueueEntry: { uri: 'https://music.test/first.flac' } } };
        fixture.playerUi.notifyLibraryNowPlaying();
      });
      assert.equal(await page.locator('.network-library-main [aria-current="true"]').getAttribute('data-track-id'), 'one:entry-0');
      await page.evaluate(() => {
        fixture.controller.selectedPlayerId = 'room';
        fixture.view.libraryRows[0].item.mediaKeys = ['opaque-media-identity'];
        fixture.controller.playerStates.set('room', { currentId: 8, queue: [{ id: 8, mediaKeys: ['opaque-media-identity'] }] });
        fixture.view.refreshLibraryNowPlaying();
      });
      assert.equal(await page.locator('.network-library-main .now-playing').getAttribute('data-track-id'), 'one:entry-0');
      await page.evaluate(() => {
        fixture.controller.playerStates.get('room').currentId = 9;
        fixture.view.refreshLibraryNowPlaying();
      });
      assert.equal(await page.locator('.network-library-main .now-playing').count(), 0);
      await page.evaluate(() => {
        fixture.controller.selectedPlayerId = 'local';
        window.uiManager.audioPlayer = fixture.savedAudioPlayer;
      });
      assert.equal(await page.evaluate(() => fixture.commands.at(-1)[2]), 0);
      await playlistRows.nth(2).locator('.library-paged-row-more').click();
      await page.locator('.library-context-menu button').first().click();
      assert.equal(await page.evaluate(() => fixture.commands.at(-1)[2]), 2);
      await page.locator('.network-library-nav [data-view="folders"]').click();
      await page.locator('.network-library-main .library-paged-folder-main').click();
      await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'folders-one');
      await page.locator('.network-library-main .library-folder-view-toggle').click();
      await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'folder-flat');
      assert.equal(await page.locator('.network-library-main .library-folder-directory-row').count(), 0);
      await page.locator('.network-library-main .library-folder-view-toggle').click();
      await page.locator('.network-library-main .library-folder-directory-row').click();
      await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'child');
      await page.locator('.network-library-main .library-folder-breadcrumb').nth(1).click();
      await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'folders-one');
      await page.locator('.network-library-nav [data-view="tracks"]').click();
      if (mobile) await page.selectOption('.network-library-main .library-entity-sort-select', 'title:desc');
      else {
        await page.locator('.network-library-main [data-sort="title"]').click();
        await page.locator('.network-library-main [data-sort="title"]').click();
      }
      await page.waitForFunction(() => fixture.requests.at(-1).sortCriteria === '-dc:title');
      assert.deepEqual(await page.locator('.network-library-main .library-track-title-text').allTextContents(), ['Morning Light', 'Evening in the City', 'Across the Water']);
      if (!mobile) {
        await page.locator('.network-library-main .library-artist-link').first().click();
        await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'artists-one');
        assert.equal(await page.locator('.network-library-main .library-paged-detail-head').count(), 1);
      }
      await page.locator('.network-library-nav [data-view="albums"]').click();
      await page.locator('.network-library-main .library-paged-entity-open').click();
      await page.waitForFunction(() => fixture.requests.at(-1).objectId === 'albums-one');
      assert.equal(await page.locator('.network-library-main .library-paged-detail-head').count(), 1);
      assert.equal(await page.locator('.network-library-main .library-paged-select:checked').count(), 3);
      const albumPlayCount = await page.evaluate(() => fixture.commands.length);
      await page.locator('.network-library-main .library-paged-play').click();
      await page.waitForFunction(count => fixture.commands.length === count + 1, albumPlayCount);
      assert.equal(await page.evaluate(() => fixture.commands.at(-1)[0].length), 3);
      await page.evaluate(() => {
        fixture.originalBrowse = fixture.controller.api.networkMusicBrowse;
        fixture.controller.api.networkMusicBrowse = async request => {
          const result = await fixture.originalBrowse(request);
          await new Promise(resolve => { fixture.releaseBrowse = resolve; });
          return result;
        };
      });
      await page.locator('.network-library-main .library-paged-play').click();
      await page.waitForFunction(() => typeof fixture.releaseBrowse === 'function');
      const preparation = page.locator('.library-paged-action-toast').last();
      assert.equal(await preparation.getAttribute('role'), 'status');
      assert.equal(await preparation.isVisible(), true);
      await preparation.locator('.library-paged-action-toast-cancel').click();
      assert.match(await preparation.textContent(), /Cancelled/);
      await page.evaluate(() => {
        fixture.controller.api.networkMusicBrowse = fixture.originalBrowse;
        fixture.releaseBrowse();
      });
      await page.waitForFunction(() => fixture.view.playbackPreparation.state.terminalKind === 'cancelled');
      assert.equal(await page.evaluate(() => fixture.commands.length), albumPlayCount + 1);
      await page.locator('.network-library-main .library-search').fill('Morning');
      await page.waitForFunction(() => fixture.requests.at(-1).query === 'Morning');
      assert.equal(await page.evaluate(() => fixture.requests.at(-1).objectId), '0', 'search covers the selected library, independent of the open category');
      await page.locator('.network-library-main .library-search').fill('');
      await page.waitForFunction(() => !fixture.requests.at(-1).query && fixture.requests.at(-1).objectId === 'albums-one');
      const target = await page.evaluate(() => fixture.controller.selectedPlayerId);
      await page.locator('.network-library-main .library-back').click();
      await page.locator('.network-library-main .library-card-play').click();
      await page.waitForFunction(() => fixture.commands.at(-1)?.[0]?.length === 3);
      assert.equal(await page.evaluate(() => fixture.controller.selectedPlayerId), target);
      assert.equal(await page.locator('.network-library-main .library-paged-add-playlist, .network-library-main .library-paged-folder-rescan').count(), 0);
      const japanese = parseCommentedJSON(read('../../js/locales/ja.json5'));
      await page.evaluate(translations => {
        window.uiManager.t = (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', value), translations[key] || key);
        fixture.view.updateUITexts();
      }, japanese);
      await page.waitForFunction(label => document.querySelector('.network-library-nav [data-view="albums"] .library-nav-label').textContent === label, japanese['library.nav.albums']);
      assert.equal(await page.locator('.library-source option[value="local"]').textContent(), japanese['networkMusic.local']);
      assert.equal(await page.locator('.network-library-main .library-search').getAttribute('placeholder'), japanese['networkMusic.search'].replace('{name}', 'Studio catalog'));
      await page.locator('.network-library-main .library-paged-entity-open').click();
      await page.waitForFunction(() => fixture.view.libraryRows?.length === 3);
      assert.equal(await page.locator('.network-library-main .library-paged-play').innerText(), japanese['library.action.play']);
      assert.match(await page.locator('.network-library-main .library-paged-detail-head').innerText(), new RegExp(japanese['library.status.tracks']));
      await page.locator('.network-library-main .library-back').click();
      await page.evaluate(() => { window.uiManager.t = key => key; fixture.view.updateUITexts(); });
      // The real local renderer remains the presentation reference after extraction.
      await page.selectOption('.library-source select', 'local');
      await page.evaluate(() => {
        fixture.manager.queryEntities = async () => ({ rows: [{ albumKey: 'album', name: 'Open Skies', artist: 'The Quartet', trackCount: 3 }], totalCount: 1, nextCursor: null });
        fixture.library.navigateToView('albums');
      });
      await page.waitForFunction(() => document.querySelector('.library-main:not(.network-library-main) .library-paged-media-card'));
      const localCard = await metrics('.library-main:not(.network-library-main) .library-paged-media-card');
      await screenshot('library-local-albums');
      await page.selectOption('.library-source select', 'rich');
      await page.waitForFunction(() => document.querySelector('.network-library-main .library-paged-media-card'));
      assert.deepEqual(await metrics('.network-library-main .library-paged-media-card'), localCard, 'both sources must use the same card geometry and typography');
      if (process.env.NETWORK_MUSIC_SCREENSHOT_DIR) {
        await page.selectOption('.library-source select', 'local');
        await page.evaluate(() => {
          fixture.library.detail = null;
          fixture.library.searchQuery = 'Morning';
          fixture.library.searchInput.value = 'Morning';
          fixture.manager.queryTracks = async () => ({ rows: [], totalCount: 0, nextCursor: null });
          return fixture.library.render();
        });
        await page.waitForFunction(() => document.querySelector('.library-main:not(.network-library-main) .library-empty'));
        await screenshot('library-local-empty');
        await page.evaluate(() => {
          fixture.library.searchQuery = 'Night';
          fixture.library.searchInput.value = 'Night';
          fixture.manager.queryTracks = () => new Promise((_resolve, reject) => { fixture.rejectLocalBrowse = reject; });
          fixture.library.render();
        });
        await page.waitForFunction(() => fixture.rejectLocalBrowse && fixture.library.content.getAttribute('aria-busy') === 'true');
        await screenshot('library-local-loading');
        await page.evaluate(() => fixture.rejectLocalBrowse(new Error('offline')));
        await page.waitForFunction(() => document.querySelector('.library-main:not(.network-library-main) .library-paged-error'));
        await screenshot('library-local-error');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
