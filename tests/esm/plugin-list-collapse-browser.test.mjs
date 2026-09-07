import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(read('../../js/ui/plugin-list/collapse-manager.js')).toString('base64');
const css = read('../../effetune-theme.css') + read('../../effetune.css').replace('@import url("effetune-theme.css");', '');
const sidebarMarkup = read('../../effetune.html').split('<div class="main-container">')[1]
    .split('<div class="pipeline" id="pipeline">')[0];

test('plugin list and pull tab stay aligned throughout both toggle animations', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const zoom of [1, 1.5]) {
            const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
            await page.setContent(`<button id="sidebarButton">Toggle</button><div class="main-container">${sidebarMarkup}<div id="pipeline" class="pipeline" style="width:1100px;height:2000px">Pipeline</div></div>`);
            await page.addStyleTag({ content: css });
            await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
            await page.evaluate(async ({ moduleUrl, zoom }) => {
                document.body.style.zoom = zoom;
                const { CollapseManager } = await import(moduleUrl);
                const manager = Object.create(CollapseManager.prototype);
                Object.assign(manager, {
                    pluginList: document.querySelector('.plugin-list'),
                    pullTab: document.getElementById('pluginListPullTab'),
                    mainContainer: document.querySelector('.main-container'),
                    sidebarButton: document.getElementById('sidebarButton'),
                    isCollapsed: false
                });
                manager.setupPullTabFunctionality();
                manager.setupTouchSwipeFunctionality();
                window.collapseManager = manager;
                await new Promise(requestAnimationFrame);
                await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
                await new Promise(requestAnimationFrame);
            }, { moduleUrl, zoom });

            for (const button of ['sidebarButton', 'pluginListPullTab']) {
                const samples = await page.evaluate(async button => {
                    const pipeline = document.getElementById('pipeline');
                    const pipelineLeft = pipeline.getBoundingClientRect().left;
                    document.getElementById(button).click();
                    // The tab must stay attached even when the pipeline cannot move.
                    pipeline.getAnimations().forEach(animation => {
                        animation.pause();
                        animation.currentTime = 0;
                    });
                    const samples = [];
                    const start = performance.now();
                    do {
                        await new Promise(requestAnimationFrame);
                        samples.push({
                            listRight: document.querySelector('.plugin-list').getBoundingClientRect().right,
                            tabLeft: document.getElementById('pluginListPullTab').getBoundingClientRect().left,
                            pipelineLeft: pipeline.getBoundingClientRect().left,
                            expectedPipelineLeft: pipelineLeft
                        });
                    } while (performance.now() - start < 400);
                    pipeline.getAnimations().forEach(animation => animation.finish());
                    return samples;
                }, button);
                assert.ok(samples.some(sample => sample.listRight > 10 && sample.listRight < 250 * zoom),
                    'Must observe the moving list between its endpoints');
                for (const sample of samples) {
                    assert.ok(Math.abs(sample.listRight - sample.tabLeft) < 1.5,
                        `${button}, zoom ${zoom}: ${JSON.stringify(sample)}`);
                    assert.ok(Math.abs(sample.pipelineLeft - sample.expectedPipelineLeft) < 1.5);
                }
            }

            const verticalPositions = await page.evaluate(async () => {
                const tab = document.getElementById('pluginListPullTab');
                const before = tab.getBoundingClientRect().top;
                window.scrollTo(0, 400);
                await new Promise(requestAnimationFrame);
                return { before, after: tab.getBoundingClientRect().top, scrollY: window.scrollY,
                    listTop: document.querySelector('.plugin-list').getBoundingClientRect().top };
            });
            assert.ok(verticalPositions.scrollY > 0);
            assert.equal(verticalPositions.after, verticalPositions.before);
            assert.ok(Math.abs(verticalPositions.listTop - 20 * zoom) < 1.5);

            await page.addStyleTag({ content: read('../../effetune-mobile.css') });
            const mobile = await page.evaluate(() => {
                document.body.classList.add('layout-mobile');
                document.querySelector('.plugin-list').classList.add('mobile-open');
                const rect = document.querySelector('.plugin-list').getBoundingClientRect();
                return { shellDisplay: getComputedStyle(document.querySelector('.plugin-list-shell')).display,
                    top: rect.top, left: rect.left, width: rect.width, viewportWidth: innerWidth };
            });
            assert.equal(mobile.shellDisplay, 'contents');
            assert.equal(mobile.top, 0);
            assert.equal(mobile.left, 0);
            assert.ok(Math.abs(mobile.width - mobile.viewportWidth) < 1.5);
            await page.close();
        }
    } finally {
        await browser.close();
    }
});
