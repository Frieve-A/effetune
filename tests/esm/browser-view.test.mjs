import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserView } from '../../js/browser/browser-view.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function bookmarkHarness() {
    const events = [];
    const element = () => ({
        style: {}, dataset: {}, children: [], value: '',
        append(child) { this.children.push(child); },
        setAttribute() {}, addEventListener() {}, focus() {},
        remove() { events.push('removePopup'); },
        replaceChildren() { this.children = []; }, querySelector() { return null; }
    });
    const view = Object.assign(Object.create(BrowserView.prototype), {
        visible: true, root: element(), content: element(), bookmarkButton: element(),
        state: { title: 'Music', url: 'https://example.com', settings: { bookmarks: [] } },
        t: key => key,
        syncPresentation() { events.push(this.popup ? 'hideNative' : 'showNative'); return Promise.resolve(); }
    });
    return { view, events, document: { createElement: element } };
}

test('an older Browser command response cannot replace a newer published state', async () => {
    const view = Object.assign(Object.create(BrowserView.prototype), {
        state: {}, address: {}, back: {}, forward: {}, reload: {},
        labelButton() {}, renderStatus() {}
    });
    await withGlobals({ document: { activeElement: null } }, async () => {
        let finishCommand;
        const command = view.run(() => new Promise(resolve => { finishCommand = resolve; }));
        const completed = { ok: true, revision: 2, loading: false, url: 'https://example.com/music',
            captureActive: true, settings: { startPage: 'https://example.com/music' } };
        view.applyState(completed);
        finishCommand({ ok: true, revision: 1, loading: true, url: 'https://example.com/',
            captureActive: false, settings: { startPage: '' } });
        assert.equal(await command, true);
        assert.equal(view.state, completed);
        assert.equal(view.address.value, completed.url);
    });
});

test('bookmarks hide the native browser while open and restore it when closed', async () => {
    const harness = bookmarkHarness();
    await withGlobals({ document: harness.document }, async () => {
        harness.view.toggleBookmarks();
        assert.equal(harness.view.popup.className, 'preset-dialog browser-bookmarks');
        assert.deepEqual(harness.events, ['hideNative']);
        harness.view.closePopup();
        assert.deepEqual(harness.events, ['hideNative', 'removePopup', 'showNative']);
    });
});

test('the browser menu opens the configured or default start page even without a current page', async () => {
    for (const startPage of ['', 'https://example.com/start']) {
        const harness = bookmarkHarness();
        const { view, events } = harness;
        view.menuButton = harness.document.createElement();
        view.state.url = '';
        view.state.settings.startPage = startPage;
        const buttons = new Map();
        view.button = (parent, key, action) => {
            const button = { action, setAttribute() {} };
            buttons.set(key, button);
            return button;
        };
        view.input = { select() { events.push('capture'); return Promise.resolve(true); } };
        view.api = { async navigate(url) { events.push(url); return { url }; } };
        view.applyState = state => { view.state = state; };
        await withGlobals({ document: harness.document }, async () => {
            view.toggleMenu();
            assert.equal(buttons.get('home').disabled, false);
            assert.equal(buttons.get('external').disabled, true);
            assert.equal(buttons.get('start').disabled, true);
            assert.equal(buttons.get('clear').disabled, false);
            await buttons.get('home').action();
            assert.equal(view.popup, null);
            assert.deepEqual(events, ['hideNative', 'removePopup', 'showNative', 'capture',
                startPage || 'https://effetune.frieve.com/streaming/']);
        });
    }
});

test('the native browser hides while Settings is open and returns when it closes', async () => {
    let menuOpen = false;
    const presentations = [];
    const menu = { getClientRects: () => menuOpen ? [{}] : [] };
    const view = Object.assign(Object.create(BrowserView.prototype), {
        visible: true, root: { style: {} },
        content: { getBoundingClientRect: () => ({ x: 0, y: 100, width: 1000, height: 600 }) },
        api: { async setPresentation(value) { presentations.push(value); } }
    });
    await withGlobals({
        document: {
            hidden: false,
            body: { classList: { contains: value => value === 'view-browser' } },
            querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 50 }) }),
            querySelectorAll: selector => selector.includes('.settings-menu') ? [menu] : []
        },
        getComputedStyle: () => ({ visibility: 'visible' })
    }, async () => {
        await view.syncPresentation();
        menuOpen = true;
        await view.syncPresentation();
        menuOpen = false;
        await view.syncPresentation();
        assert.deepEqual(presentations.map(value => value.visible), [true, false, true]);
    });
});

test('Browser presentation includes CSS zoom and converts the header position without scaling bounds twice', async () => {
    let zoom = 1;
    const presentations = [];
    const view = Object.assign(Object.create(BrowserView.prototype), {
        visible: true, root: { style: {} },
        content: { getBoundingClientRect: () => ({ x: 0, y: 100, width: 1000, height: 600 }) },
        api: { async setPresentation(value) { presentations.push(value); } }
    });
    await withGlobals({
        document: {
            hidden: false, body: { classList: { contains: value => value === 'view-browser' } },
            querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 50 * zoom }) }),
            querySelectorAll: () => []
        },
        getComputedStyle: () => ({ zoom: String(zoom), visibility: 'visible' })
    }, async () => {
        await view.syncPresentation();
        zoom = 2;
        await view.syncPresentation();
        await view.syncPresentation();
        assert.equal(view.root.style.top, '50px');
        assert.deepEqual(presentations.map(value => value.zoomFactor), [1, 2]);
        assert.deepEqual(presentations[0].bounds, presentations[1].bounds);
    });
});

test('navigation starts capture synchronously, waits for it, and keeps capture failures visible', async () => {
    for (const captured of [true, false]) {
        const order = [];
        let finishCapture;
        const view = Object.assign(Object.create(BrowserView.prototype), {
            visible: true, state: {}, status: {}, t: key => key,
            input: { select() {
                order.push('capture');
                return new Promise(resolve => { finishCapture = resolve; });
            } },
            applyState(state) { this.state = state; this.renderStatus(); }
        });
        const result = view.navigate(() => { order.push('navigate'); return Promise.resolve({ url: 'https://example.com' }); });
        assert.deepEqual(order, ['capture']);
        await Promise.resolve();
        assert.deepEqual(order, ['capture']);
        view.inputStatus = captured ? 'active' : 'error';
        finishCapture(captured);
        assert.equal(await result, true);
        assert.deepEqual(order, ['capture', 'navigate']);
        assert.equal(view.status.hidden, captured);
        assert.equal(view.status.textContent, captured ? '' : 'error');
    }
});

test('normal browser audio states have no visible status', () => {
    const view = Object.assign(Object.create(BrowserView.prototype), {
        state: {}, status: {}, t: key => key
    });
    for (const state of ['active', 'acquiring', 'device', 'resume', undefined]) {
        view.inputStatus = state;
        view.renderStatus();
        assert.equal(view.status.hidden, true, String(state));
        assert.equal(view.status.textContent, '');
    }
    view.inputStatus = 'deviceError';
    view.renderStatus();
    assert.equal(view.status.hidden, false);
    assert.equal(view.status.textContent, 'deviceError');
});

test('browser commands preserve popup editing and cannot navigate a hidden browser', async () => {
    const calls = [];
    const view = Object.assign(Object.create(BrowserView.prototype), {
        visible: true, state: { canGoBack: true, canGoForward: false, loading: true },
        input: { select: async () => { calls.push('capture'); } },
        api: { back: async () => { calls.push('back'); return {}; }, stop: async () => { calls.push('stop'); return {}; } },
        applyState() {}
    });
    await view.handleCommand({ action: 'back' });
    await view.handleCommand({ action: 'forward' });
    await view.handleCommand({ action: 'stop' });
    assert.deepEqual(calls, ['capture', 'back', 'stop']);
    view.popup = {};
    await view.handleCommand({ action: 'back' });
    view.popup = null;
    view.visible = false;
    await view.handleCommand({ action: 'back' });
    assert.deepEqual(calls, ['capture', 'back', 'stop']);
});

test('clear site data hides the native view through confirmation and restores presentation on failure', async () => {
    const calls = [];
    const view = Object.assign(Object.create(BrowserView.prototype), {
        t: key => key,
        syncPresentation() { calls.push(this.confirming ? 'hidden' : 'restored'); return Promise.resolve(); },
        input: { async release() { calls.push('release'); throw new Error('release failed'); } }
    });
    await withGlobals({ window: { confirm: () => true } }, async () => {
        await assert.rejects(view.clearSiteData(), /release failed/);
    });
    assert.deepEqual(calls, ['hidden', 'release', 'restored']);
    assert.equal(view.confirming, false);
});

test('Close releases only browser capture and returns to Effect Pipeline without resetting the page', async () => {
    const calls = [];
    let finishRelease;
    const view = Object.assign(Object.create(BrowserView.prototype), {
        state: { url: 'https://example.com/current', settings: { startPage: 'https://example.com/start' } },
        loadedStartPage: true,
        closePopup(restoreFocus) { calls.push(['closePopup', restoreFocus]); },
        input: { release() { calls.push('release'); return new Promise(resolve => { finishRelease = resolve; }); } },
        uiManager: { showEffectPipelineView() { calls.push('effects'); return true; } }
    });
    const closing = view.close();
    assert.equal(view.close(), closing);
    assert.equal(await view.navigate(() => { throw new Error('Must not navigate while closing'); }), false);
    assert.deepEqual(calls, [['closePopup', false], 'release']);
    finishRelease(true);
    assert.equal(await closing, true);
    assert.deepEqual(calls, [['closePopup', false], 'release', 'effects']);
    assert.equal(view.state.url, 'https://example.com/current');
    assert.equal(view.loadedStartPage, true);
    assert.equal(view.closing, null);
});

test('Close cancels a pending show before it can start a page after capture release', async () => {
    let finishPresentation;
    let effects = false;
    const view = Object.assign(Object.create(BrowserView.prototype), {
        root: {}, state: { settings: { startPage: 'https://example.com/start' } },
        address: { focus() { assert.fail('Closed Browser must not regain focus'); } },
        closePopup() {},
        input: { release: async () => true },
        uiManager: { showEffectPipelineView() { effects = true; view.visible = false; return true; } },
        syncPresentation: () => new Promise(resolve => { finishPresentation = resolve; }),
        run() { assert.fail('Closed Browser must not load its start page'); }
    });
    const showing = view.show();
    await view.close();
    finishPresentation();
    await showing;
    assert.equal(effects, true);
});

test('navigation waiting for capture cannot run after Browser closes or hides', async () => {
    for (const action of ['close', 'hide']) {
        let finishCapture;
        const view = Object.assign(Object.create(BrowserView.prototype), {
            visible: true, root: {}, closePopup() {}, syncPresentation: async () => {},
            input: {
                select: () => new Promise(resolve => { finishCapture = resolve; }),
                release: async () => true
            },
            uiManager: { showEffectPipelineView() { view.hide(); return true; } },
            run() { assert.fail('Hidden Browser must not navigate after capture settles'); }
        });
        const navigating = view.navigate(() => {});
        await view[action]();
        finishCapture(false);
        assert.equal(await navigating, false);
    }
});

test('the initial page waits for capture and later visits preserve the current page', async () => {
    for (const captured of [true, false]) {
        for (const startPage of [undefined, '', 'https://example.com/start']) {
            const navigations = [];
            let finishCapture;
            let presented = false;
            const view = Object.assign(Object.create(BrowserView.prototype), {
                root: {}, state: { url: '', settings: { startPage } },
                address: { focus() {} }, closePopup() {}, syncPresentation: async () => { presented = true; },
                input: { release: async () => true },
                uiManager: { showEffectPipelineView() { view.hide(); return true; } },
                api: { navigate(url) { navigations.push(url); view.state.url = url; return Promise.resolve(view.state); } },
                run: action => action()
            });
            const showing = view.show(new Promise(resolve => { finishCapture = resolve; }));
            assert.equal(view.visible, true);
            assert.equal(view.root.hidden, false);
            assert.equal(presented, true);
            await Promise.resolve();
            assert.deepEqual(navigations, []);
            finishCapture(captured);
            await showing;
            const expectedStartPage = startPage || 'https://effetune.frieve.com/streaming/';
            assert.deepEqual(navigations, [expectedStartPage]);
            view.state.settings.startPage = 'https://example.com/new-start';
            view.state.url = 'https://example.com/current';
            await view.close();
            await view.show();
            assert.equal(view.state.url, 'https://example.com/current');
            assert.deepEqual(navigations, [expectedStartPage]);
        }
    }
});

test('HTTP and HTTPS pages enable Browser page actions while non-Web pages do not', () => {
    const view = Object.create(BrowserView.prototype);
    for (const url of ['http://example.com/', 'https://example.com/']) {
        view.state = { url };
        assert.equal(view.hasPage(), true);
    }
    for (const url of ['', 'about:blank', 'file:///private', 'spotify:track:x']) {
        view.state = { url };
        assert.equal(view.hasPage(), false);
    }
});

test('the shared bookmark editor limits long page titles to the persisted name limit', async () => {
    const view = Object.assign(Object.create(BrowserView.prototype), { t: key => key });
    await withGlobals({ document: { createElement: () => ({ setAttribute() {} }) } }, async () => {
        const title = 'A music page with a long title '.repeat(8);
        const input = view.nameInput(title);
        assert.equal(input.maxLength, 120);
        assert.equal(input.value, title.slice(0, 120));
        assert.equal(view.nameInput('My bookmark').value, 'My bookmark');
    });
});

test('Browser bookmark changes send only their patch and preserve independently saved settings', async () => {
    let sent;
    const view = Object.assign(Object.create(BrowserView.prototype), {
        state: { settings: { userAgent: 'Stale Browser', bookmarks: [], startPage: '' } },
        api: { async saveSettings(patch) { sent = patch; return { ok: true }; } },
        run(action) { return action(); }
    });
    const patch = { startPage: 'https://example.com/' };
    await view.saveSettings(patch);
    assert.deepEqual(sent, patch);
});

function ruleHarness({ selected = true, getPresets } = {}) {
    const loaded = [];
    const presets = { Music: { plugins: [{ nm: 'Volume' }] }, Speech: { plugins: [] } };
    const view = Object.assign(Object.create(BrowserView.prototype), {
        visible: false, input: { selected }, state: {
            url: 'https://example.com/music/one', settings: { urlRules: [
                { pattern: 'example.com/music/*', preset: 'Missing', enabled: true },
                { pattern: 'example.com/music/*', preset: 'Speech', enabled: false },
                { pattern: 'example.com/music/*', preset: 'Music', enabled: true },
                { pattern: 'example.com/*', preset: 'Speech', enabled: true }
            ] }
        },
        uiManager: { pipelineManager: { presetManager: {
            getLoadablePresets: getPresets || (async () => presets),
            async loadPreset(preset) { loaded.push(preset); return true; }
        } } },
        renderStatus() {}
    });
    return { view, loaded, presets };
}

test('Browser rules select the first available enabled preset in the background and preserve manual edits until the match changes', async () => {
    const { view, loaded, presets } = ruleHarness();
    await view.applyUrlRules();
    assert.deepEqual(loaded, [presets.Music]);
    await view.applyUrlRules();
    view.state.url = 'https://example.com/music/two?query=1#part';
    await view.applyUrlRules();
    assert.equal(loaded.length, 1);
    view.state.url = 'https://example.com/talk';
    await view.applyUrlRules();
    assert.deepEqual(loaded, [presets.Music, presets.Speech]);
    view.state.url = 'https://other.test/';
    await view.applyUrlRules();
    assert.equal(loaded.length, 2, 'an unmatched page keeps the current pipeline');
    view.state.url = 'https://example.com/music/one';
    await view.applyUrlRules();
    assert.equal(loaded.at(-1), presets.Music);
    view.state.settings.urlRules = [{ pattern: 'example.com/*', preset: 'Speech', enabled: true }];
    await view.applyUrlRules();
    assert.equal(loaded.at(-1), presets.Speech, 'saved rules apply to the current page');
});

test('Browser selection evaluates the existing page and ignores preset reads superseded by navigation or input release', async () => {
    const pending = [];
    const { view, loaded, presets } = ruleHarness({ selected: false,
        getPresets: () => new Promise(resolve => pending.push(resolve)) });
    await view.applyUrlRules();
    assert.equal(pending.length, 0);
    view.input.selected = true;
    const first = view.applyUrlRules();
    view.state.url = 'https://example.com/talk';
    const second = view.applyUrlRules();
    pending[1](presets);
    await second;
    pending[0](presets);
    await first;
    assert.deepEqual(loaded, [presets.Speech]);
    view.state.url = 'https://example.com/music/one';
    const released = view.applyUrlRules();
    view.input.selected = false;
    await view.applyUrlRules();
    pending[2](presets);
    await released;
    assert.equal(loaded.length, 1);
    view.input.selected = true;
    const resumed = view.applyUrlRules();
    pending[3](presets);
    await resumed;
    assert.deepEqual(loaded, [presets.Speech, presets.Music]);
});

test('Browser navigation stays available during a blind test without applying URL presets', async () => {
    const { view, loaded, presets } = ruleHarness();
    let blindActive = false;
    view.uiManager.isDoubleBlindActive = () => blindActive;
    await view.applyUrlRules();
    blindActive = true;
    view.visible = true;
    view.input.select = async () => true;
    view.address = {}; view.back = {}; view.forward = {}; view.reload = {};
    view.labelButton = () => {};
    view.api = { navigate: async url => ({ url, settings: view.state.settings }) };
    await withGlobals({ document: { activeElement: null } }, async () => {
        await view.handleCommand({ action: 'navigate', url: 'https://example.com/talk' });
        await view.applyUrlRules();
        assert.equal(view.state.url, 'https://example.com/talk');
        assert.deepEqual(loaded, [presets.Music]);
        assert.equal(view.matchedPresetKey, null);
        blindActive = false;
        await view.applyUrlRules();
        assert.deepEqual(loaded, [presets.Music, presets.Speech]);
    });
});

test('preset reads finishing after blind-test entry cannot apply or consume the URL match', async () => {
    let finishRead;
    const { view, loaded, presets } = ruleHarness({
        getPresets: () => new Promise(resolve => { finishRead = resolve; })
    });
    let blindActive = false;
    view.uiManager.isDoubleBlindActive = () => blindActive;
    const pending = view.applyUrlRules();
    blindActive = true;
    finishRead(presets);
    await pending;
    assert.deepEqual(loaded, []);
    assert.equal(view.matchedPresetKey, null);
    blindActive = false;
    const resumed = view.applyUrlRules();
    finishRead(presets);
    await resumed;
    assert.deepEqual(loaded, [presets.Music]);
});
