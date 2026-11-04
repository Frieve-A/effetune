import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = path => read(path).replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');

test('MIDI item draws all 16 channels at two sizes and exposes working inspector controls', async () => {
    const installed = chromium.executablePath();
    const systemChrome = process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null;
    const browser = await chromium.launch({ headless: true,
        ...(!existsSync(installed) && systemChrome && existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="inspector"></div><canvas id="mixer"></canvas></body>');
        for (const path of ['../../js/visualizer/visualizer-model.js',
            '../../js/visualizer/visualizer-effects.js', '../../js/ui/range-fill.js',
            '../../js/visualizer/visualizer-ballistics.js',
            '../../js/visualizer/visualizer-editor.js', '../../js/visualizer/visualizer-midi-mixer.js']) {
            await page.addScriptTag({ content: script(path) });
        }
        const result = await page.evaluate(() => {
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const item = createItem('midi', 'midi');
            const inspector = document.querySelector('#inspector');
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                root: inspector,
                view: { commitPending() {}, sources: { getMidiPresentation: () => ({ hasMidi: true }) } },
                changed() {}
            });
            editor.parameters(inspector, item);
            editor.palette(inspector, item.palette, item.type);
            const levelGroup = [...inspector.querySelectorAll('section')]
                .find(section => section.firstElementChild?.textContent === 'Level Meter');
            const outerPalette = [...inspector.children]
                .find(section => section.firstElementChild?.textContent === 'Palette');
            const meterColor = levelGroup.querySelector('input[type="color"]');
            const textColor = outerPalette.querySelector('input[type="color"]');
            const initialTextColor = item.palette.color;
            meterColor.value = '#123456';
            meterColor.dispatchEvent(new Event('input'));
            const afterMeterColor = { meter: item.params.levelPalette.color, text: item.palette.color };
            textColor.value = '#abcdef';
            textColor.dispatchEvent(new Event('input'));
            const paletteGroups = {
                meterHeadings: [...levelGroup.querySelectorAll('.visualizer-section-title')].map(node => node.textContent),
                meterLabels: [...levelGroup.querySelectorAll('label')].map(node => node.textContent),
                textHeading: outerPalette.firstElementChild.textContent,
                afterMeterColor, afterTextColor: { meter: item.params.levelPalette.color, text: item.palette.color },
                meterBeforeText: !!(meterColor.compareDocumentPosition(textColor) & Node.DOCUMENT_POSITION_FOLLOWING)
            };
            item.palette.color = initialTextColor;
            const control = label => [...inspector.querySelectorAll('.visualizer-field')]
                .find(row => row.querySelector('label')?.textContent.startsWith(label))?.querySelector('input, select');
            const labels = [...inspector.querySelectorAll('.visualizer-field label')].map(label => label.textContent);
            const values = { initial: control('Values').value,
                choices: [...control('Values').options].map(option => [option.value, option.textContent]) };
            control('First channel').value = '5';
            control('First channel').dispatchEvent(new Event('input'));
            control('Controllers').checked = false;
            control('Controllers').dispatchEvent(new Event('change'));
            control('Keyboard color').value = 'rainbow';
            control('Keyboard color').dispatchEvent(new Event('change'));
            const saved = snapshotLayout({ ...createDefaultLayout(), items: [item] }).items[0].params;
            item.params.channelStart = 1;
            item.params.channelEnd = 16;
            item.params.showControllers = true;
            item.params.knobValuePosition = 'right';
            item.params.knobSize = 150;
            item.params.knobStyle = 'outline';
            item.params.keyboardColor = 'normal';
            const channels = Array.from({ length: 16 }, (_, channel) => ({ program: channel,
                cc: new Uint8Array(128), notes: [{ pitch: 60 + channel }] }));
            const snapshot = { sourceKind: 'midi', source: {}, playing: true, channels };
            let mixer = null;
            const sources = { getFrame: () => snapshot, getSoundFontMixer: () => mixer };
            const canvas = document.querySelector('#mixer');
            const display = new MidiMixerDisplay(canvas, sources);
            const counts = [];
            for (const scale of [1, 2]) {
                canvas.width = 960 * scale;
                canvas.height = 540 * scale;
                display.draw(item, 0, 960, {});
                const ctx = canvas.getContext('2d');
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const rowHeight = (canvas.height - 35 * scale) / 16;
                const perRow = Array.from({ length: 16 }, (_, row) => {
                    const start = Math.floor(35 * scale + row * rowHeight);
                    const end = Math.floor(35 * scale + (row + 1) * rowHeight);
                    let bright = 0;
                    for (let y = start; y < end; y++) for (let x = 0; x < canvas.width; x++) {
                        const offset = (y * canvas.width + x) * 4;
                        if (pixels[offset + 1] > 180 && pixels[offset + 2] > 180 && pixels[offset] < 130) bright++;
                    }
                    return bright;
                });
                counts.push(perRow);
            }
            const ctxBeforeFlip = canvas.getContext('2d');
            const beforeFlip = ctxBeforeFlip.getImageData(0, 0, canvas.width, canvas.height).data;
            item.flipX = item.flipY = true;
            display.draw(item, 0, 960, {});
            const afterFlip = ctxBeforeFlip.getImageData(0, 0, canvas.width, canvas.height).data;
            let brightBefore = 0, brightMirrored = 0;
            for (let y = 0; y < canvas.height; y += 4) for (let x = 0; x < canvas.width; x += 4) {
                const index = (y * canvas.width + x) * 4;
                if (!(beforeFlip[index + 1] > 180 && beforeFlip[index + 2] > 180 && beforeFlip[index] < 130)) continue;
                brightBefore++;
                const mirror = ((canvas.height - y - 1) * canvas.width + canvas.width - x - 1) * 4;
                if (afterFlip[mirror + 1] > 180 && afterFlip[mirror + 2] > 180 && afterFlip[mirror] < 130) brightMirrored++;
            }
            item.flipX = item.flipY = false;
            item.params.channelStart = item.params.channelEnd = 8;
            item.params.showControllers = true;
            canvas.width = 400;
            canvas.height = 200;
            const notes = new Uint8Array(16);
            notes[60 >> 3] |= 1 << (60 & 7);
            mixer = { state: { voices: 1, limit: 64,
                channels: Array.from({ length: 16 }, (_, channel) => ({ bank: 0, program: 4,
                    sourceProgram: 4, presetIndex: 0, volume: 90, pan: 64, expression: 127,
                    reverb: 40, chorus: 0, mute: false, solo: false, voices: channel === 7 ? 1 : 0,
                    notes, levelPeak: channel === 7 ? .5 : 0 })) },
                presets: [{ bank: 0, program: 4, name: 'Electric Piano' }], channelFilter: 0 };
            snapshot.source = {};
            const ctx = canvas.getContext('2d');
            const drawText = ctx.fillText.bind(ctx);
            const drawRect = ctx.fillRect.bind(ctx);
            const drawArc = ctx.arc.bind(ctx);
            const drawMove = ctx.moveTo.bind(ctx);
            const drawLine = ctx.lineTo.bind(ctx);
            const labelsDrawn = [];
            const keys = [], knobs = [], moves = [], lines = [], knobValues = [];
            ctx.fillText = (value, ...args) => {
                labelsDrawn.push(String(value));
                if (['90', '64', '127', '40', '0'].includes(String(value))) knobValues.push({ value: String(value), x: args[0] });
                drawText(value, ...args);
            };
            ctx.fillRect = (...args) => {
                if (ctx.fillStyle === '#eeeeee' || ctx.fillStyle === '#111111')
                    keys.push({ color: ctx.fillStyle, x: args[0], y: args[1], width: args[2], height: args[3] });
                drawRect(...args);
            };
            ctx.arc = (...args) => { knobs.push({ x: args[0], y: args[1], radius: args[2] }); drawArc(...args); };
            ctx.moveTo = (...args) => { moves.push(args); drawMove(...args); };
            ctx.lineTo = (...args) => { lines.push(args); drawLine(...args); };
            display.draw(item, 0, 400, {});
            item.params.knobValuePosition = 'none';
            const beforeHidden = labelsDrawn.length;
            display.draw(item, .1, 400, {});
            const hiddenValues = labelsDrawn.slice(beforeHidden).filter(value => ['90', '64', '127', '40', '0'].includes(value));
            ctx.fillText = drawText;
            ctx.fillRect = drawRect;
            ctx.arc = drawArc;
            ctx.moveTo = drawMove;
            ctx.lineTo = drawLine;
            return { labels, values, saved, counts, labelsDrawn, brightBefore, brightMirrored, paletteGroups,
                whiteKeys: keys.filter(key => key.color === '#eeeeee'),
                blackKeys: keys.filter(key => key.color === '#111111'), knobs, moves, lines,
                knobValues, hiddenValues };
        });
        assert.deepEqual(result.paletteGroups.meterHeadings, ['Level Meter']);
        assert.ok(result.paletteGroups.meterLabels.some(label => label.startsWith('DB Range')));
        assert.ok(result.paletteGroups.meterLabels.some(label => label.startsWith('Color mode')));
        assert.equal(result.paletteGroups.textHeading, 'Palette');
        assert.deepEqual(result.paletteGroups.afterMeterColor, { meter: '#123456', text: '#ffffff' });
        assert.deepEqual(result.paletteGroups.afterTextColor, { meter: '#123456', text: '#abcdef' });
        assert.equal(result.paletteGroups.meterBeforeText, true, 'meter color precedes the outer text palette in tab order');
        assert.ok(result.labels.some(label => label.startsWith('Keyboard color')));
        assert.deepEqual(result.values, { initial: 'right', choices: [['right', 'Right'], ['below', 'Below'],
            ['none', 'None (knobs only)']] });
        assert.deepEqual([result.saved.channelStart, result.saved.showControllers, result.saved.keyboardColor],
            [5, false, 'rainbow']);
        for (const counts of result.counts) assert.ok(counts.every(count => count > 0),
            `all 16 rows have highlighted notes: ${counts}`);
        assert.ok(result.labelsDrawn.includes('Electric Piano'));
        assert.ok(result.labelsDrawn.includes('Voices 1/64'));
        assert.ok(!result.labelsDrawn.includes('Mute') && !result.labelsDrawn.includes('Solo'));
        assert.equal(result.whiteKeys.length, 148);
        assert.equal(result.blackKeys.length, 106);
        assert.ok(result.whiteKeys[0].x < result.blackKeys[0].x &&
            result.blackKeys[0].x < result.whiteKeys[1].x);
        assert.ok(result.whiteKeys[1].x < result.blackKeys[1].x &&
            result.blackKeys[1].x < result.whiteKeys[2].x);
        assert.ok(result.whiteKeys[3].x < result.blackKeys[2].x &&
            result.blackKeys[2].x < result.whiteKeys[4].x,
        'E and F have no black key between them');
        assert.ok(result.blackKeys[0].width < result.whiteKeys[0].width &&
            result.blackKeys[0].height < result.whiteKeys[0].height);
        assert.equal(result.knobs.length, 10);
        assert.equal(result.moves.length, 10);
        assert.equal(result.lines.length, 10);
        assert.deepEqual(result.hiddenValues, []);
        assert.equal(result.knobValues.length, 5);
        assert.ok(result.knobValues.every((value, index) => value.x > result.knobs[index].x + result.knobs[index].radius),
            'right-side values clear their largest knobs');
        assert.ok(result.knobs.slice(0, 5).every(knob => knob.x - knob.radius > 0 && knob.x + knob.radius < 400),
            'largest knobs fit inside the canvas');
        assert.ok(result.lines[2][0] > result.knobs[2].x && result.lines[2][1] > result.knobs[2].y,
            'maximum Expression points right and down');
        assert.ok(result.lines[4][0] < result.knobs[4].x && result.lines[4][1] > result.knobs[4].y,
            'minimum Chorus points left and down');
        assert.ok(result.brightBefore > 10 && result.brightMirrored / result.brightBefore > .85,
            'horizontal and vertical flips move highlighted notes to mirrored pixels');
    } finally { await browser.close(); }
});

test('MIDI canvas centers aligned numeric groups, separates knob colors, and customizes measured meters', async () => {
    const installed = chromium.executablePath();
    const systemChrome = process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null;
    const browser = await chromium.launch({ headless: true,
        ...(!existsSync(installed) && systemChrome && existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><canvas width="960" height="300"></canvas>');
        for (const path of ['../../js/visualizer/visualizer-model.js', '../../js/visualizer/visualizer-effects.js',
            '../../js/visualizer/visualizer-ballistics.js', '../../js/visualizer/visualizer-midi-mixer.js']) {
            await page.addScriptTag({ content: script(path) });
        }
        const result = await page.evaluate(() => {
            const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
            const item = createItem('midi', 'midi');
            const params = { ...item.params, knobFillColor: '#123456', knobOutlineColor: '#abcdef',
                knobIndicatorColor: '#fe1234' };
            const display = new MidiMixerDisplay(canvas, null);
            const texts = [], arcs = [], strokes = [];
            const fillText = ctx.fillText.bind(ctx), arc = ctx.arc.bind(ctx), stroke = ctx.stroke.bind(ctx);
            ctx.fillText = (value, x, y, ...rest) => {
                texts.push({ value: String(value), x, y, align: ctx.textAlign, color: ctx.fillStyle });
                fillText(value, x, y, ...rest);
            };
            ctx.arc = (x, y, radius, ...rest) => { arcs.push({ x, y, radius }); arc(x, y, radius, ...rest); };
            ctx.stroke = () => { strokes.push(ctx.strokeStyle); stroke(); };
            ctx.font = '16px Arial';
            for (const value of [7, 64, 127]) display.drawKnob(ctx, 20, 10, 100, 60, value, '#e157a0', {}, 1, params, 0);
            const numeric = texts.splice(0), knobArcs = arcs.splice(0);
            const sample = () => [...ctx.getImageData(Math.round(knobArcs[0].x), 45, 1, 1).data].slice(0, 3);
            const filled = sample();
            ctx.fillStyle = '#232323'; ctx.fillRect(0, 0, 150, 90);
            display.drawKnob(ctx, 20, 10, 100, 60, 7, '#e157a0', {}, 1, { ...params, knobStyle: 'outline' }, 0);
            const outlined = sample();
            texts.length = 0;
            const channels = [7, 64, 127].map(voices => ({ bank: 0, program: 0, presetIndex: 0,
                voices, volume: 1, pan: 2, expression: 3, reverb: 4, chorus: 5,
                levelPeak: .25, notes: new Uint8Array(16) }));
            item.params.channelEnd = 3;
            item.params.showKeyboard = false;
            item.palette.color = '#e157a0';
            display.sources = { getFrame: () => ({ sourceKind: 'midi', source: 'score', playing: true, channels: [] }),
                getSoundFontMixer: () => ({ state: { voices: 198, limit: 256, channels },
                    presets: [{ bank: 0, program: 0, name: 'Piano' }] }) };
            display.draw(item, 0, 960, {});
            const listText = texts.splice(0);
            const rects = [], fillRect = ctx.fillRect.bind(ctx);
            ctx.fillRect = (x, y, width, height) => {
                rects.push({ x, y, width, height, color: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : 'gradient' });
                fillRect(x, y, width, height);
            };
            const meter = { ...params.levelMeter, dr: -96, cf: 0, pk: false, ds: 6 };
            const palette = { ...params.levelPalette, mode: 'gradient',
                stops: [{ pos: 0, color: '#00ff00' }, { pos: 1, color: '#ff0000' }] };
            display.drawLevel(ctx, 10, 100, 160, 20, .5, {}, 0, meter, palette, 0, 1, '#e157a0', {});
            const segmented = rects.splice(0);
            display.drawLevel(ctx, 200, 100, 20, 100, .5, {}, 0,
                { ...meter, orientation: 'vertical', ds: 0, pk: true, showLevelValues: true, showAxes: true,
                    showAxisNumbers: true }, { ...palette, mode: 'solid', color: '#20a050' }, 0, 1, '#e157a0', {});
            const vertical = rects.splice(0), meterText = texts.splice(0);
            const lut = new Uint8Array(256 * 4);
            for (let i = 0; i < 256; i++) { lut[i * 4] = i; lut[i * 4 + 3] = 255; }
            window.SpectrogramPlugin = { getHeatmapLuts: () => ({ rgba: lut }) };
            display.drawLevel(ctx, 300, 100, 160, 20, .5, {}, 0, meter,
                { ...palette, mode: 'heatmap' }, 0, 1, '#e157a0', {});
            return { numeric, knobArcs, filled, outlined, strokes, listText, segmented, vertical, meterText,
                heatmap: rects.some(rect => rect.color === 'gradient') };
        });
        assert.ok(result.numeric.every(text => text.align === 'right' && text.x === result.numeric[0].x));
        for (const [index, knob] of result.knobArcs.entries()) {
            assert.ok(Math.abs((knob.x - knob.radius + result.numeric[index].x) / 2 - 70) < .001,
                'knob plus reserved three-digit box stays centered');
        }
        assert.deepEqual(result.filled, [18, 52, 86]);
        assert.deepEqual(result.outlined, [35, 35, 35]);
        assert.ok(result.strokes.includes('#abcdef') && result.strokes.includes('#fe1234'));
        assert.ok(result.listText.every(text => text.color === '#e157a0'), 'palette colors every header and row text');
        const voices = result.listText.filter(text => ['7', '64', '127'].includes(text.value));
        assert.equal(voices.length, 3);
        assert.ok(voices.every(text => text.align === 'right' && text.x === voices[0].x));
        assert.equal(result.segmented.filter(rect => rect.color === 'gradient').length, 14);
        assert.ok(result.vertical.some(rect => rect.color === '#20a050' && rect.height > 90 && rect.width === 20));
        assert.ok(result.meterText.some(text => text.value.endsWith(' dB')));
        assert.ok(result.meterText.some(text => text.value === '-96') && result.meterText.some(text => text.value === '0'));
        assert.equal(result.heatmap, true);
    } finally { await browser.close(); }
});
