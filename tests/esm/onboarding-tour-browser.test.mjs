import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { encodePipelineState } from '../../js/utils/pipeline-state-codec.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://effetune.test';
const contentTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.json5': 'application/json',
    '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png'
};
const steps = ['welcome', 'sound', 'effects', 'presets', 'item', 'bypass', 'save', 'views', 'settings', 'help'];
const targets = {
    sound: '#openMusicButton', effects: '#pluginList', presets: '#systemPresetsTab',
    item: '#pipelineList .pipeline-item:first-child', bypass: '.master-toggle',
    save: '#pipelinePresetButton', views: '#openLibraryButton', settings: '#settingsMenuButton', help: '#whatsThisLink'
};
const mobileTargets = {
    ...targets, sound: '#mobilePlayerView .mobile-open-music', effects: '.mobile-plugin-fab',
    views: '.mobile-bottom-button[data-view="library"]', settings: '.mobile-menu-button', help: null
};

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function openPage(browser, { mobile = false, config = {}, savedPipeline, search = '', localeGate } = {}) {
    const page = await browser.newPage({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ config, savedPipeline, inputDeviceId }) => {
        window.EFFECTUNE_DEV_SERVER = true;
        localStorage.setItem('effetune_app_config', JSON.stringify({
            language: 'en', pipelineStartup: 'default', ...config
        }));
        localStorage.setItem('effetune_audio_preferences', JSON.stringify({
            inputDeviceId, useWasmDsp: false
        }));
        if (savedPipeline !== undefined) localStorage.setItem('effetune_pipeline_state', savedPipeline);
        let app;
        Object.defineProperty(window, 'app', {
            configurable: true,
            get: () => app,
            set(value) {
                app = value;
                const checkTour = value.maybeStartOnboardingTour;
                value.maybeStartOnboardingTour = async function (...args) {
                    window.__tourStartupBody = [...document.body.classList];
                    const result = await checkTour.apply(this, args);
                    window.__tourStartupSettled = true;
                    return result;
                };
            }
        });
    }, { config, savedPipeline, inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID });
    await page.route(`${origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (localeGate && pathname === '/js/locales/ja.json5') {
            localeGate.requested.resolve();
            await localeGate.release.promise;
        }
        const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return route.fulfill({ status: 403, body: '' });
        }
        try {
            await route.fulfill({
                contentType: contentTypes[path.extname(file)] || 'application/octet-stream',
                body: await fs.readFile(file)
            });
        } catch {
            await route.fulfill({ status: 404, body: '' });
        }
    });
    await page.goto(`${origin}/effetune.html${search}`, { waitUntil: 'commit' });
    return { page, errors };
}

async function ready(page) {
    await page.waitForFunction(() => window.app?.initialized === true && window.__tourStartupSettled === true);
}

async function settleLayout(page) {
    await page.evaluate(async () => {
        const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await frames();
        await Promise.all(document.getAnimations()
            .filter(animation => animation instanceof CSSTransition)
            .map(animation => animation.finished.catch(() => {})));
        await frames();
    });
}

async function assertStep(page, step, mobile) {
    await page.waitForFunction(step => document.querySelector('.onboarding-tour')?.dataset.step === step, step);
    await settleLayout(page);
    const selector = (mobile ? mobileTargets : targets)[step];
    const geometry = await page.evaluate(selector => {
        const tour = document.querySelector('.onboarding-tour');
        const card = tour.querySelector('.onboarding-tour-card').getBoundingClientRect();
        const target = selector ? document.querySelector(selector) : null;
        const spotlight = tour.querySelector('.onboarding-tour-spotlight').getBoundingClientRect();
        const rect = target?.getBoundingClientRect();
        return {
            centered: tour.dataset.centered,
            progress: tour.querySelector('.onboarding-tour-progress').textContent,
            title: tour.querySelector('h2').textContent,
            body: tour.querySelector('.onboarding-tour-body').textContent,
            cardInsideViewport: card.left >= 0 && card.top >= 0 && card.right <= innerWidth && card.bottom <= innerHeight,
            targetVisible: target ? target.getClientRects().length > 0 : false,
            containsTarget: !!rect && spotlight.left <= rect.left && spotlight.top <= rect.top &&
                spotlight.right >= rect.right && spotlight.bottom >= rect.bottom,
            drawerOpen: document.getElementById('pluginList').classList.contains('mobile-open'),
            drawerInert: document.getElementById('pluginList').inert,
            effectsView: document.body.classList.contains('view-effects'),
            playerView: document.body.classList.contains('view-player')
        };
    }, selector || null);
    assert.equal(geometry.progress, `${steps.indexOf(step) + 1} / 10`);
    assert.ok(geometry.title && !geometry.title.startsWith('tour.'));
    assert.ok(geometry.body && !geometry.body.startsWith('tour.'));
    assert.equal(geometry.cardInsideViewport, true, `${step} card must fit on screen`);
    assert.equal(geometry.centered, String(!selector));
    if (selector) {
        assert.equal(geometry.targetVisible, true, `${step} target must be visible`);
        assert.equal(geometry.containsTarget, true, `${step} spotlight must contain its target after transitions`);
    }
    if (mobile && step === 'sound') assert.equal(geometry.playerView, true);
    if (mobile && step === 'presets') {
        assert.equal(geometry.drawerOpen, true);
        assert.equal(geometry.drawerInert, false);
    }
    if (mobile && ['effects', 'item'].includes(step)) {
        assert.equal(geometry.drawerOpen, false);
        assert.equal(geometry.effectsView, true);
    }
}

for (const mobile of [false, true]) {
    test(`${mobile ? 'mobile' : 'desktop'} first-run tour guides every step and reopens from its menu`, { timeout: 60_000 }, async () => {
        const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
        try {
            const { page, errors } = await openPage(browser, { mobile });
            await ready(page);
            await page.waitForFunction(() => new URLSearchParams(location.search).has('p'));
            assert.equal(await page.evaluate(() => new URLSearchParams(location.search).has('p')), true);
            if (mobile) assert.equal(await page.evaluate(() => window.__tourStartupBody.includes('view-player')), true);
            for (const step of steps) {
                await assertStep(page, step, mobile);
                if (mobile && step === 'effects') {
                    await page.keyboard.press('Tab');
                    assert.equal(await page.evaluate(() => document.activeElement.closest('.onboarding-tour-card') !== null), true);
                    await page.keyboard.press('Shift+Tab');
                    const capturesPointer = await page.locator('.mobile-plugin-fab').evaluate(target => {
                        const rect = target.getBoundingClientRect();
                        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
                            .closest('.onboarding-tour') !== null;
                    });
                    assert.equal(capturesPointer, true);
                }
                if (mobile && step === 'presets') {
                    await page.locator('.onboarding-tour-back').click();
                    await assertStep(page, 'effects', true);
                    await page.locator('.onboarding-tour-next').click();
                    await assertStep(page, 'presets', true);
                }
                await page.locator('.onboarding-tour-next').click();
            }
            await page.locator('.onboarding-tour').waitFor({ state: 'detached' });
            const config = await page.evaluate(async () => {
                const { loadWebAppConfig } = await import('/js/electron/webSettingsStorage.js');
                return loadWebAppConfig();
            });
            assert.equal(config.onboardingTourShown, true);
            if (mobile) {
                assert.equal(await page.evaluate(() => document.body.classList.contains('view-effects')), true);
                await page.locator('.mobile-menu-button').click();
                await page.getByRole('menuitem', { name: 'Take the tour', exact: true }).click();
            } else {
                await page.locator('#settingsMenuButton').click();
                await page.locator('#tourSettingsButton').click();
            }
            await assertStep(page, 'welcome', mobile);
            await page.locator('.onboarding-tour-skip').click();
            await page.locator('.onboarding-tour').waitFor({ state: 'detached' });
            assert.deepEqual(errors, []);
        } finally {
            await browser.close();
        }
    });
}

test('tour keyboard focus, language, zoom, and layout changes work in the real app', { timeout: 60_000 }, async () => {
    const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        const { page, errors } = await openPage(browser, { config: { onboardingTourShown: true } });
        await ready(page);
        await page.locator('#settingsMenuButton').focus();
        await page.evaluate(() => window.uiManager.startOnboardingTour());
        await assertStep(page, 'welcome', false);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'onboarding-tour-skip');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'onboarding-tour-next');
        const before = await page.evaluate(() => window.audioManager.currentPipeline);
        await page.keyboard.press('t');
        assert.equal(await page.evaluate(() => window.audioManager.currentPipeline), before);
        await page.keyboard.press('Enter');
        await assertStep(page, 'sound', false);
        await page.evaluate(() => window.uiManager.setLanguagePreference('ja'));
        assert.equal(await page.locator('.onboarding-tour-title').textContent(), 'まずは音を再生');
        await page.evaluate(() => { document.body.style.zoom = '1.25'; window.dispatchEvent(new Event('resize')); });
        await assertStep(page, 'sound', false);
        await page.keyboard.press('Escape');
        await page.locator('.onboarding-tour').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'settingsMenuButton');
        await page.evaluate(() => { document.body.style.zoom = ''; });
        await page.evaluate(() => window.uiManager.startOnboardingTour());
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.onboarding-tour').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.body.classList.contains('layout-mobile')), true);
        await page.evaluate(() => window.uiManager.startOnboardingTour());
        assert.equal(await page.locator('.onboarding-tour').getAttribute('data-mobile'), 'true');
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('.onboarding-tour').waitFor({ state: 'detached' });
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

const savedPipeline = encodePipelineState([{ nm: 'Volume', en: true, vl: -6 }]);
for (const scenario of [
    { name: 'saved pipeline restoration', savedPipeline, config: { pipelineStartup: undefined } },
    { name: 'saved empty pipeline with default startup', savedPipeline: encodePipelineState([]) },
    { name: 'shared pipeline startup', search: `?p=${encodeURIComponent(savedPipeline)}` },
    { name: 'previously shown tour', config: { onboardingTourShown: true } }
]) {
    test(`${scenario.name} does not automatically show the tour`, { timeout: 45_000 }, async () => {
        const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
        try {
            const { page, errors } = await openPage(browser, scenario);
            await ready(page);
            assert.equal(await page.locator('.onboarding-tour').count(), 0);
            assert.deepEqual(errors, []);
        } finally {
            await browser.close();
        }
    });
}

test('first-run tour waits for localization and opens in the selected language', { timeout: 45_000 }, async () => {
    const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const localeGate = { requested: deferred(), release: deferred() };
    try {
        const { page, errors } = await openPage(browser, { config: { language: 'ja' }, localeGate });
        await localeGate.requested.promise;
        assert.equal(await page.locator('.onboarding-tour').count(), 0);
        assert.notEqual(await page.evaluate(() => window.app?.initialized), true);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-starting')), true);
        localeGate.release.resolve();
        await ready(page);
        assert.equal(await page.locator('.onboarding-tour-title').textContent(), 'EffeTune へようこそ');
        await page.keyboard.press('Escape');
        await page.locator('.onboarding-tour').waitFor({ state: 'detached' });
        assert.deepEqual(errors, []);
    } finally {
        localeGate.release.resolve();
        await browser.close();
    }
});
