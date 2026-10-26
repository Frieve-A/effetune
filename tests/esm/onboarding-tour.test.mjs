import { parseCommentedJSON } from '../../js/utils/parse-commented-json.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { OnboardingTour, TOUR_STEPS, shouldAutoStart } from '../../js/ui/onboarding-tour.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { createConsoleHarness, flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createHarness(mobile = false) {
    const document = createFakeDocument();
    const createElement = document.createElement.bind(document);
    document.createElement = tag => {
        const element = createElement(tag);
        element.focus = () => { document.activeElement = element; };
        element.blur = () => { document.activeElement = null; };
        element.contains = node => element === node || element.children.some(child => child.contains?.(node));
        element.remove = () => element.parentNode?.removeChild(element);
        element.getBoundingClientRect = () => ({ left: 100, top: 100, width: 360, height: 240, right: 460, bottom: 340 });
        element.getClientRects = () => [element.getBoundingClientRect()];
        element.scrollIntoView = () => {};
        return element;
    };
    const targets = new Map();
    document.querySelector = selector => targets.get(selector) || null;
    const listeners = new Map();
    const window = {
        innerWidth: mobile ? 390 : 1440, innerHeight: mobile ? 844 : 900,
        addEventListener: (event, callback) => listeners.set(event, callback),
        removeEventListener: event => listeners.delete(event)
    };
    const calls = [];
    let onLayoutChange;
    const uiManager = {
        t: (key, params) => params ? `${params.current} / ${params.total}` : key,
        layoutMode: { isMobile: mobile, onChange: callback => { onLayoutChange = callback; } },
        mobileNav: {
            setView: view => calls.push(['view', view]),
            openPluginList: () => calls.push(['open']),
            closePluginList: options => calls.push(['close', options])
        },
        pluginListManager: {
            collapseManager: {
                isCollapsed: true,
                togglePluginListCollapse() { this.isCollapsed = false; calls.push(['expand']); }
            }
        }
    };
    const saved = [];
    const tour = new OnboardingTour(uiManager, { saveConfig: async (...args) => { saved.push(args); return true; } });
    return { document, window, tour, uiManager, targets, calls, saved, listeners, changeLayout: () => onLayoutChange() };
}

async function withTour(mobile, callback) {
    const harness = createHarness(mobile);
    return withGlobals({ document: harness.document, window: harness.window }, async () => {
        try { await callback(harness); }
        finally { harness.tour.end(true); }
    });
}

test('automatic tour starts only after a new ordinary startup is ready', () => {
    const ready = { initialized: true };
    assert.equal(shouldAutoStart(ready), true);
    assert.equal(shouldAutoStart(), false);
    for (const patch of [
        { initialized: false }, { config: { onboardingTourShown: true } },
        { hasSavedPipelineState: true }, { miniPlayerTargetMode: true },
        { bodyClasses: ['view-library'] }, { bodyClasses: ['view-visualizer'] },
        { startupSearch: '?p=' }, { startupSearch: '?v=scene' }, { startupSearch: '?dbt=test' }
    ]) assert.equal(shouldAutoStart({ ...ready, ...patch }), false, JSON.stringify(patch));
    assert.equal(shouldAutoStart({ ...ready, bodyClasses: ['view-player'], startupSearch: '?other=value' }), true);
});

test('welcome records the shown state and buttons advance, return, and finish the tour', async () => {
    await withTour(false, async ({ tour, saved, document, calls, listeners }) => {
        tour.start();
        assert.equal(tour.isActive, true);
        assert.equal(tour.root.getAttribute('data-step'), 'welcome');
        assert.equal(tour.progress.textContent, '1 / 10');
        assert.equal(tour.steps.some(step => step.id === 'browser'), false);
        assert.equal(tour.backButton.hidden, true);
        assert.equal(tour.nextButton.textContent, 'tour.button.start');
        await flushMicrotasks();
        assert.deepEqual(saved, [[false, { onboardingTourShown: true }]]);
        await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.progress.textContent, '2 / 10');
        await tour.backButton.dispatchEvent('click');
        assert.equal(tour.progress.textContent, '1 / 10');
        for (let index = 1; index < tour.steps.length; index++) await tour.nextButton.dispatchEvent('click');
        assert.deepEqual(calls, [['expand']]);
        assert.equal(tour.nextButton.textContent, 'tour.button.done');
        await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.isActive, false);
        assert.equal(document.listenerCount('keydown'), 0);
        assert.equal(document.listenerCount('scroll'), 0);
        assert.equal(listeners.size, 0);
    });
});

test('Browser introduces streaming before Music Library when the built-in browser is available', async () => {
    await withTour(false, async ({ tour, window, document, targets }) => {
        window.electronAPI = { browser: {} };
        const browserButton = document.createElement('button');
        targets.set('#browserButton', browserButton);
        tour.start();
        assert.equal(tour.progress.textContent, '1 / 11');
        tour.showStep(tour.steps.findIndex(step => step.id === 'save'));
        await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.root.getAttribute('data-step'), 'browser');
        assert.equal(tour.target, browserButton);
        assert.equal(tour.spotlight.hidden, false);
        assert.equal(tour.title.textContent, 'tour.step.browser.title');
        assert.equal(tour.body.textContent, 'tour.step.browser.body');
        assert.equal(tour.progress.textContent, '8 / 11');
        await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.root.getAttribute('data-step'), 'views');
        assert.equal(tour.progress.textContent, '9 / 11');
        await tour.backButton.dispatchEvent('click');
        assert.equal(tour.root.getAttribute('data-step'), 'browser');
        for (let index = tour.stepIndex + 1; index < tour.steps.length; index++) await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.progress.textContent, '11 / 11');
        assert.equal(tour.nextButton.textContent, 'tour.button.done');
        await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.isActive, false);
    });
});

test('missing or hidden targets retain their step as a centered card and labels refresh', async () => {
    await withTour(false, async ({ tour, uiManager, targets, document }) => {
        tour.start();
        await tour.nextButton.dispatchEvent('click');
        assert.equal(tour.root.getAttribute('data-centered'), 'true');
        const hiddenTarget = document.createElement('button');
        hiddenTarget.getClientRects = () => [];
        targets.set('#openMusicButton', hiddenTarget);
        tour.showStep(1);
        assert.equal(tour.spotlight.hidden, true);
        const pipeline = document.createElement('div');
        targets.set('#pipeline', pipeline);
        tour.showStep(4);
        assert.equal(tour.target, pipeline);
        assert.equal(tour.spotlight.hidden, false);
        tour.showStep(1);
        uiManager.t = key => `translated ${key}`;
        tour.updateLabels();
        assert.equal(tour.body.textContent, 'translated tour.step.sound.body');
        assert.equal(tour.nextButton.textContent, 'translated tour.button.next');
        await tour.skipButton.dispatchEvent('click');
        assert.equal(tour.isActive, false);
    });
});

test('mobile prerequisites are restored when navigating backwards and the drawer closes on exit', async () => {
    await withTour(true, async ({ tour, calls, changeLayout }) => {
        tour.start();
        tour.showStep(1);
        assert.equal(tour.body.textContent, 'tour.step.sound.bodyMobile');
        assert.deepEqual(calls.slice(-2), [['view', 'player'], ['close', { immediate: true }]]);
        tour.showStep(3);
        assert.deepEqual(calls.slice(-2), [['view', 'effects'], ['open']]);
        await tour.backButton.dispatchEvent('click');
        assert.equal(tour.root.getAttribute('data-step'), 'effects');
        assert.deepEqual(calls.slice(-2), [['view', 'effects'], ['close', { immediate: true }]]);
        tour.showStep(3);
        tour.showStep(4);
        assert.deepEqual(calls.slice(-2), [['view', 'effects'], ['close', { immediate: true }]]);
        changeLayout();
        assert.equal(tour.isActive, false);
        assert.deepEqual(calls.at(-1), ['close', { immediate: true }]);
    });
});

test('keyboard focus cycles inside the tour and Escape restores the previous focus', async () => {
    await withTour(false, async ({ tour, document }) => {
        const previous = document.createElement('button');
        previous.isConnected = true;
        previous.focus();
        tour.start();
        let stopped = 0;
        let prevented = 0;
        const key = (key, shiftKey = false) => document.dispatchEvent('keydown', {
            key, shiftKey, preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++
        });
        await key('Tab');
        assert.equal(document.activeElement, tour.skipButton);
        await key('Tab', true);
        assert.equal(document.activeElement, tour.nextButton);
        await key('t');
        assert.equal(prevented, 3);
        await key('Enter');
        assert.equal(prevented, 3);
        await key('Escape');
        assert.equal(stopped, 5);
        assert.equal(tour.isActive, false);
        assert.equal(document.activeElement, previous);
    });
});

test('restarting replaces the current tour and storage failure leaves the tour usable', async () => {
    await withTour(false, async ({ tour, document }) => {
        const warnings = [];
        await withGlobals({ console: createConsoleHarness({ warn: (...args) => warnings.push(args) }) }, async () => {
            tour.saveConfig = async () => { throw new Error('storage unavailable'); };
            tour.start();
            tour.showStep(4);
            const previousRoot = tour.root;
            tour.start();
            await flushMicrotasks();
            await flushMicrotasks();
            assert.equal(previousRoot.parentNode, null);
            assert.equal(document.listenerCount('keydown'), 1);
            assert.equal(tour.root.getAttribute('data-step'), 'welcome');
            assert.equal(warnings.length, 2);
            assert.equal(tour.isActive, true);
        });
    });
});

test('every shipped language contains the tour text and progress placeholders', async () => {
    const keys = [
        'tour.menu', 'tour.progress',
        ...['start', 'skip', 'back', 'next', 'done'].map(action => `tour.button.${action}`),
        ...TOUR_STEPS.flatMap(step => [
            `tour.step.${step.id}.title`, `tour.step.${step.id}.body`,
            ...(step.mobileBody ? [`tour.step.${step.id}.bodyMobile`] : [])
        ])
    ];
    for (const locale of ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh']) {
        const source = await fs.readFile(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
        const translations = parseCommentedJSON(source);
        for (const key of keys) assert.equal(typeof translations[key], 'string', `${locale}: ${key}`);
        assert.ok(translations['tour.progress'].includes('{current}'), locale);
        assert.ok(translations['tour.progress'].includes('{total}'), locale);
    }
});
