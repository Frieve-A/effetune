import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const css = ['effetune.css', 'effetune-mobile.css'].map(file =>
    readFileSync(new URL('../../css/' + file, import.meta.url), 'utf8').replace(/^@import .*\r?\n/gm, '')
).join('\n');

test('Mobile Effects and DBT keep their controls clear of the FAB and pipeline stats', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 721, height: 336 }, isMobile: true, hasTouch: true });
        await page.setContent([
            '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">',
            '<body class="layout-mobile view-effects"><header class="title-container" style="min-height: 144px">EffeTune</header>',
            '<div class="main-container"><div class="pipeline" id="pipeline">',
            '<button class="pipeline-toggle-button">ON</button><div id="pipelineList"></div>',
            '<div id="pipelineStats"><div>CPU: Avg 0.0%</div><div>Total Delay: 128 samples</div></div>',
            '<div class="file-drop-area file-processing-active"><button>Cancel</button></div></div></div>',
            '<button class="mobile-plugin-fab">+</button><div class="mobile-mini-player"></div><nav class="mobile-bottom-nav"></nav>'
        ].join(''));
        await page.addStyleTag({ content: css + '* { transition: none !important; }' });

        const fab = page.locator('.mobile-plugin-fab');
        for (const direction of ['ltr', 'rtl']) {
            await page.locator('html').evaluate((root, dir) => { root.dir = dir; }, direction);
            const pipelineBox = await page.locator('#pipeline').boundingBox();
            const fabBox = await fab.boundingBox();
            assert.ok(direction === 'ltr'
                ? pipelineBox.x >= fabBox.x + fabBox.width
                : pipelineBox.x + pipelineBox.width <= fabBox.x, direction);
        }
        await page.setViewportSize({ width: 320, height: 640 });
        const stats = await page.locator('#pipelineStats').boundingBox();
        const processing = await page.locator('.file-processing-active').boundingBox();
        assert.ok(stats.y + stats.height <= processing.y);

        await page.locator('.main-container').evaluate(main => {
            main.style.display = 'none';
            main.insertAdjacentHTML('beforebegin', '<div class="double-blind-test"><div style="height: 600px"></div>' +
                '<div class="dbt-config-error">Could not start the test.</div></div>');
        });
        assert.equal(await fab.isVisible(), false);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const error = await page.locator('.dbt-config-error').boundingBox();
        const miniPlayer = await page.locator('.mobile-mini-player').boundingBox();
        assert.ok(error.y >= 0 && error.y + error.height <= miniPlayer.y);
        await page.locator('.double-blind-test').evaluate(panel => panel.remove());
        assert.equal(await fab.isVisible(), true);
    } finally {
        await browser.close();
    }
});

test('Mobile Player reserves room for the header actions above the playback card', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
        await page.setContent([
            '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">',
            '<body class="layout-mobile view-player"><header class="title-container">',
            '<h1><span>Frieve<br>EffeTune</span></h1><div class="header-buttons">',
            '<div class="network-playback-target"><select class="network-select"><option>This device</option></select></div>',
            '<button class="header-button">Cast</button><button class="header-button" id="openMusicButton">Open</button>',
            '<button class="header-button" id="visualizerButton">View</button></div></header>',
            '<div class="mobile-player-view"><article class="audio-player"><h2>Player</h2>',
            '<div class="player-controls" style="min-height: 750px"></div></article></div>'
        ].join(''));
        await page.addStyleTag({ content: css + 'body.layout-mobile h1, .audio-player h2 { font-size: 26px; }' });
        const card = await page.locator('.audio-player').boundingBox();
        const target = await page.locator('.network-playback-target').boundingBox();
        const buttons = page.locator('.header-buttons > button');
        for (const button of await buttons.all()) {
            const box = await button.boundingBox();
            assert.ok(box.y >= target.y + target.height);
            assert.ok(box.y + box.height <= card.y);
        }
    } finally {
        await browser.close();
    }
});

test('Mobile Network Output picker uses the available viewport width under its trigger', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
        await page.setContent([
            '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">',
            '<body class="layout-mobile"><header class="title-container">',
            '<button class="network-output-button" type="button" style="width: 40px" popovertarget="networkOutputPicker">Out</button>',
            '<div class="network-output-picker" id="networkOutputPicker" popover><label><input type="checkbox">This device</label></div>',
            '</header>'
        ].join(''));
        await page.addStyleTag({ content: css });
        for (const width of [320, 412]) {
            await page.setViewportSize({ width, height: 640 });
            const trigger = page.locator('.network-output-button');
            const picker = page.locator('#networkOutputPicker');
            await trigger.click();
            const box = await picker.boundingBox();
            const triggerBox = await trigger.boundingBox();
            assert.equal(box.width, Math.min(360, width - 16));
            assert.ok(box.x >= 8 && box.x + box.width <= width - 8);
            assert.ok(box.y >= triggerBox.y + triggerBox.height);
            await page.keyboard.press('Escape');
        }
    } finally {
        await browser.close();
    }
});
