import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const script = file => readFileSync(new URL(`../../js/${file}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');

test('MIDI event list draws ordered columns, a central clock and past/future rows through playback and seek', async () => {
    const systemChrome = process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null;
    const browser = await chromium.launch({ headless: true,
        ...(systemChrome && existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><canvas width="1000" height="400"></canvas><div id="inspector"></div>');
        await page.addScriptTag({ content: `{ ${script('midi/event-list')}; window.getMidiEventList = getMidiEventList; }` });
        for (const file of ['visualizer/visualizer-model', 'visualizer/visualizer-effects', 'ui/range-fill',
            'visualizer/visualizer-editor', 'visualizer/visualizer-midi-event-list', 'visualizer/visualizer-renderer']) {
            await page.addScriptTag({ content: script(file) });
        }
        const result = await page.evaluate(() => {
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const item = createItem('midi-event-list', 'events');
            const defaultColor = item.palette.color;
            item.params.scrollMode = 'smooth';
            item.rect = { x: 0, y: 0, w: 1, h: 1 };
            const inspector = document.querySelector('#inspector');
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                root: inspector, view: { commitPending() {} }, changed() {}
            });
            editor.parameters(inspector, item);
            const fontSize = [...inspector.querySelectorAll('.visualizer-field')]
                .find(row => row.querySelector('label')?.textContent.startsWith('Text size')).querySelector('input');
            fontSize.value = 18;
            fontSize.dispatchEvent(new Event('input'));
            const layout = { ...createDefaultLayout(), items: [item] };
            let rows = [0, 2, 2, 2, 10].map((seconds, index) => ({ seconds, channel: index + 1,
                position: `1:${index + 1}:0`, type: 'Note On', content: `Event ${index}` }));
            let position = 0;
            const sources = { getModulators: () => ({}), getFrame: () => null,
                getMidiEventList: () => ({ rows, position }) };
            const canvas = document.querySelector('canvas'), renderer = new VisualizerRenderer(canvas);
            const originalText = CanvasRenderingContext2D.prototype.fillText;
            const originalFill = CanvasRenderingContext2D.prototype.fillRect;
            let text = [], lines = [];
            CanvasRenderingContext2D.prototype.fillText = function(value, x, y, ...rest) {
                text.push({ value, x, y, align: this.textAlign, color: this.fillStyle, width: this.measureText(value).width });
                return originalText.call(this, value, x, y, ...rest);
            };
            CanvasRenderingContext2D.prototype.fillRect = function(x, y, w, h) {
                if (w <= 5 && h === 1 && y === 200) lines.push({ x, y, w });
                return originalFill.call(this, x, y, w, h);
            };
            const draw = (seconds, wallTime) => {
                position = seconds; text = []; lines = [];
                renderer.draw(layout, sources, {}, wallTime);
                return { text: text.slice(), lines: lines.slice() };
            };
            const frames = [0, .5, 1, 1.999, 2, 2.001, 5, 9, 10, 1, 1]
                .map((seconds, index) => ({ seconds, ...draw(seconds, index * 100) }));
            item.params.scrollMode = 'row';
            const rowFrames = [.5, 1, 1.999, 2, 2.001, 5, 9].map(seconds => draw(seconds, seconds * 100));
            rows = [{ seconds: 0, channel: null, position: '1:1:0', type: 'Tempo', content: 'New song' }];
            const replacement = draw(0, 1200);
            const pixels = canvas.getContext('2d').getImageData(0, 0, 1000, 400).data;
            let opaque = 0;
            for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 0) opaque++;
            renderer.dispose();
            const numericRows = getMidiEventList({ division: 480, timeSignatures: [], displayEvents: [
                { type: 'midi', status: 0x90, data1: 0, data2: 1, seconds: 0, tick: 1 },
                { type: 'midi', status: 0x90, data1: 61, data2: 12, seconds: 1, tick: 12 },
                { type: 'midi', status: 0x90, data1: 127, data2: 127, seconds: 2, tick: 123 }
            ] });
            const numeric = [];
            for (const [width, family] of [[390, 'monospace'], [1000, 'Georgia, "Times New Roman", serif']]) {
                canvas.width = width;
                item.params.fontFamily = family; item.params.fontSize = 11;
                item.palette.color = '#12ab34';
                const display = new MidiEventListDisplay(canvas, { getMidiEventList: () => ({ rows: numericRows, position: 1 }) });
                text = [];
                display.draw(item, 10, width, {});
                numeric.push({ width, text: text.slice() });
            }
            return { frames, rowFrames, numeric, defaultColor, replacement, opaque, fontSize: 18,
                labels: [...inspector.querySelectorAll('label')].map(label => label.textContent) };
        });
        assert.equal(result.fontSize, 18);
        assert.deepEqual(result.labels, ['Scroll mode', 'Font', 'Text size(px):', 'Row spacing(%):']);
        assert.equal(result.defaultColor, '#ffffff');
        for (const frame of result.frames) {
            assert.ok(frame.text.every(entry => entry.color === '#ffffff'));
            const headers = frame.text.filter(entry => ['Channel', 'Bar:Beat:Tick', 'Type', 'Contents'].includes(entry.value));
            assert.deepEqual(headers.map(entry => entry.value), ['Channel', 'Bar:Beat:Tick', 'Type', 'Contents']);
            assert.ok(headers.every((entry, index) => !index || entry.x > headers[index - 1].x));
            assert.equal(frame.lines.length, 2);
            assert.equal(frame.lines[0].x, 0);
            assert.equal(frame.lines[1].x + frame.lines[1].w, 1000);
            for (const entry of frame.text.filter(entry => entry.value.startsWith('Event '))) {
                const eventTime = [0, 2, 2, 2, 10][Number(entry.value.slice(6))];
                if (eventTime < frame.seconds) assert.ok(entry.y < 200);
                if (eventTime > frame.seconds) assert.ok(entry.y > 200);
            }
        }
        const eventY = (frame, name) => frame.text.find(entry => entry.value === name).y;
        assert.ok(eventY(result.frames[1], 'Event 1') > eventY(result.frames[2], 'Event 1'));
        assert.ok(eventY(result.frames[6], 'Event 4') > eventY(result.frames[7], 'Event 4'));
        assert.deepEqual(result.frames[9].text, result.frames[10].text, 'paused position ignores elapsed wall clock');
        assert.deepEqual(result.frames[2].text, result.frames[9].text, 'seeking backward restores the same frame');
        const current = result.frames[4].text.filter(entry => /^Event [123]$/.test(entry.value));
        assert.deepEqual(current.map(entry => entry.value), ['Event 1', 'Event 2', 'Event 3']);
        assert.equal(current[1].y, 200);
        assert.ok(result.replacement.text.some(entry => entry.value === 'New song'));
        assert.equal(result.replacement.text.some(entry => entry.value.startsWith('Event ')), false);
        assert.ok(result.opaque > 300000);
        assert.deepEqual(result.rowFrames[0].text, result.rowFrames[1].text);
        assert.deepEqual(result.rowFrames[1].text, result.rowFrames[2].text);
        assert.deepEqual(result.rowFrames[4].text, result.rowFrames[5].text);
        assert.deepEqual(result.rowFrames[5].text, result.rowFrames[6].text);
        assert.notDeepEqual(result.rowFrames[2].text, result.rowFrames[3].text);
        for (const frame of result.numeric) {
            assert.ok(frame.text.every(entry => entry.color === '#12ab34'));
            const contentsX = frame.text.find(entry => entry.value === 'Contents').x;
            const rows = [0, 1, 2].map(index => frame.text.filter(entry => entry.y === 200 + (index - 1) * 16.5));
            for (const offset of [0, 1, 2]) {
                const anchors = rows.map(entries => entries.filter(entry => entry.x > contentsX && entry.align === 'right')[offset].x);
                assert.ok(anchors.every(anchor => anchor === anchors[0]), `numeric field ${offset} aligns at ${frame.width}px`);
            }
            const tickAnchors = rows.map(entries => entries.filter(entry => entry.x < contentsX && entry.align === 'right')[3].x);
            assert.ok(tickAnchors.every(anchor => anchor === tickAnchors[0]));
            const rightmost = Math.max(...rows[0].filter(entry => entry.x > contentsX).map(entry =>
                entry.x + (entry.align === 'right' ? 0 : entry.width)));
            assert.ok(rightmost < frame.width, `ordinary MIDI message fits at ${frame.width}px`);
            assert.ok((frame.width - contentsX) / frame.width < .45, 'contents width is balanced across four columns');
        }
    } finally { await browser.close(); }
});
