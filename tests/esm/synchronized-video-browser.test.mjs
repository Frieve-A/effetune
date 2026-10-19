import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const source = readFileSync(new URL('../../js/ui/audio-player/synchronized-video.js', import.meta.url), 'utf8')
    .replace('export class SynchronizedVideo', 'window.SynchronizedVideo = class SynchronizedVideo');
const moduleScript = file => readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const fixtures = Object.fromEntries(['outgoing', 'incoming'].map(name => [name,
    readFileSync(new URL(`../fixtures/video-handoff/${name}.webm`, import.meta.url)).toString('base64')]));
let browser;
test.before(async () => {
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
});
test.after(async () => { await browser?.close(); });

async function createPage(t) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.addScriptTag({ content: source });
    await page.evaluate(fixtures => {
        const sources = Object.fromEntries(Object.entries(fixtures).map(([name, data]) => [name,
            new Blob([Uint8Array.from(atob(data), value => value.charCodeAt(0))], { type: 'video/webm' })]));
        const wait = async predicate => {
            const deadline = performance.now() + 5000;
            while (!predicate()) {
                if (performance.now() >= deadline) throw new Error('Video did not reach the expected state.');
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        };
        const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const pixel = video => {
            context.clearRect(0, 0, 160, 90);
            context.drawImage(video, 0, 0);
            return [...context.getImageData(80, 45, 1, 1).data];
        };
        const create = async () => {
            const display = new window.SynchronizedVideo(); display.setEnabled(true); display.setActive(true);
            const snapshot = { generation: 1, source: sources.outgoing, resetToken: 0, naturalEnd: null, contextTime: 0 };
            display.setPresentation(snapshot);
            await wait(() => display.ready);
            const video = display.element;
            video.currentTime = 1.5;
            await wait(() => !video.seeking);
            return { display, snapshot, video };
        };
        const tail = (snapshot, video, targetAtEnd) => ({ generation: 1, source: snapshot.source,
            endPosition: video.duration, playbackSpeed: 1, targetAtEnd, contextTimeAtEnd: 0 });
        const sample = (display, returned) => ({
            // The player attaches element; Visualizer draws frame's return value.
            player: pixel(display.element), visualizer: pixel(returned), seeking: returned.seeking
        });
        window.videoProbe = { sources, wait, tick, pixel, create, tail, sample };
    }, fixtures);
    return page;
}

const yellow = ([r, g, b, a]) => r > 200 && g > 200 && b < 50 && a === 255;
const green = ([r, g, b, a]) => r < 50 && g > 200 && b < 50 && a === 255;

test('Visualizer repaints the decoded picture after a paused seek completes', async t => {
    const page = await createPage(t);
    for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
        await page.addScriptTag({ content: moduleScript(file) });
    }
    const result = await page.evaluate(async () => {
        const { create, wait, tick, pixel } = window.videoProbe;
        const { display, video } = await create();
        const canvas = createLayer(160, 90), renderer = new VisualizerRenderer(canvas);
        const item = createItem('video', 'video');
        item.rect = { x: 0, y: 0, w: 1, h: 1 };
        const layout = { ...createDefaultLayout(), items: [item] };
        const sources = { getModulators: () => ({}), getFrame: () => null };
        const draw = target => {
            renderer.draw(layout, sources, null, 0, { video: display.frame(target, 1, false) });
            return [...canvas.getContext('2d').getImageData(80, 45, 1, 1).data];
        };
        try {
            display.frame(0, 1, false);
            await wait(() => !video.seeking && video.readyState >= 2);
            const before = draw(0);
            draw(1.5);
            const seeking = video.seeking;
            await wait(() => !video.seeking && video.readyState >= 2);
            const decoded = pixel(video), after = draw(1.5);
            for (let i = 0; i < 5; i++) { await tick(); draw(1.5); }
            return { before, seeking, decoded, after, settled: draw(1.5), paused: video.paused };
        } finally {
            renderer.dispose();
            display.setEnabled(false);
        }
    });
    const [r, g, b, a] = result.before;
    assert.ok(r < 50 && g < 50 && b > 200 && a === 255, 'The initial rendered picture is blue.');
    assert.equal(result.seeking, true, 'The renderer draws once while the paused seek is still decoding.');
    assert.ok(yellow(result.decoded), 'The decoder has the yellow target picture.');
    assert.deepEqual(result.after, result.decoded, 'The first completed draw replaces the old picture.');
    assert.deepEqual(result.settled, result.decoded, 'The paused target picture remains visible.');
    assert.equal(result.paused, true);
});

test('An ended display retains the final picture while the terminal audible tail finishes', async t => {
    const page = await createPage(t);
    const result = await page.evaluate(async () => {
        const { create, wait, tick, tail, sample, pixel } = window.videoProbe;
        const { display, snapshot, video } = await create();
        try {
            await video.play();
            await wait(() => video.ended);
            const before = pixel(video), samples = [], start = performance.now();
            display.setPresentation({ ...snapshot, naturalEnd: tail(snapshot, video, video.duration - .05) });
            let returned = display.frame(-.6, 1, false);
            samples.push(sample(display, returned));
            for (let i = 0; i < 12; i++) {
                await tick();
                samples.push(sample(display, returned));
                display.setPresentation({ ...snapshot, contextTime: (performance.now() - start) / 1000 });
                returned = display.frame(-.6, 1, false);
                samples.push(sample(display, returned));
            }
            return { before, samples, paused: video.paused, needsFrame: display.needsFrame };
        } finally { display.setEnabled(false); }
    });
    assert.ok(yellow(result.before), 'The native decoder really reached its yellow final picture.');
    for (const sample of result.samples) {
        assert.ok(yellow(sample.player) && yellow(sample.visualizer), JSON.stringify(sample));
    }
    assert.equal(result.paused, true);
    assert.equal(result.needsFrame, false);
});

test('An ended outgoing decoder never replays its beginning before the next video handoff', async t => {
    const page = await createPage(t);
    const result = await page.evaluate(async () => {
        const { create, wait, tick, tail, sample, sources } = window.videoProbe;
        const { display, snapshot, video } = await create();
        try {
            await video.play();
            await wait(() => video.ended);
            const incoming = { ...snapshot, generation: 2, source: sources.incoming,
                naturalEnd: tail(snapshot, video, video.duration - .05) };
            display.setPresentation(incoming);
            await wait(() => display.pending?.ready);
            const samples = [], start = performance.now();
            let returned = display.frame(.4, 1, true);
            samples.push(sample(display, returned));
            for (let i = 0; i < 18; i++) {
                await tick();
                samples.push(sample(display, returned));
                const elapsed = (performance.now() - start) / 1000;
                display.setPresentation({ ...incoming, contextTime: elapsed });
                returned = display.frame(.4 + elapsed, 1, true);
                samples.push(sample(display, returned));
            }
            return samples;
        } finally { display.setEnabled(false); }
    });
    assert.ok(yellow(result[0].player));
    assert.ok(result.some(sample => green(sample.player)), 'The next decoded video must eventually appear.');
    for (const sample of result) {
        assert.ok((yellow(sample.player) || green(sample.player)) &&
            (yellow(sample.visualizer) || green(sample.visualizer)), JSON.stringify(sample));
    }
});

for (const target of [.24, .4]) {
    test(`A delayed incoming video first appears with decoded target pixels at ${target} seconds`, async t => {
        const page = await createPage(t);
        const result = await page.evaluate(async target => {
            const { create, wait, tick, tail, sample, sources } = window.videoProbe;
            const { display, snapshot, video } = await create();
            try {
                const incoming = { ...snapshot, generation: 2, source: sources.incoming, contextTime: 1,
                    naturalEnd: tail(snapshot, video, 1.5) };
                display.setPresentation(incoming);
                await wait(() => display.pending?.ready);
                const samples = [], start = performance.now();
                let returned = display.frame(target, 1, true);
                samples.push({ ...sample(display, returned), incoming: returned !== video });
                for (let i = 0; i < 18; i++) {
                    await tick();
                    const elapsed = (performance.now() - start) / 1000;
                    display.setPresentation({ ...incoming, contextTime: 1 + elapsed });
                    returned = display.frame(target + elapsed, 1, true);
                    samples.push({ ...sample(display, returned), incoming: returned !== video });
                }
                return samples;
            } finally { display.setEnabled(false); }
        }, target);
        assert.ok(result.some(sample => sample.incoming), 'The next decoded video must eventually appear.');
        for (const sample of result) {
            const expected = sample.incoming ? green : yellow;
            assert.ok(expected(sample.player) && expected(sample.visualizer), JSON.stringify(sample));
            if (sample.incoming) assert.equal(sample.seeking, false, 'The visible incoming frame must already be decoded.');
        }
    });
}
