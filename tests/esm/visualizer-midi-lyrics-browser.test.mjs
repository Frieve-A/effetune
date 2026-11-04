import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { parseSmf } from '../../js/midi/smf-parser.js';

// Execute production modules in the blank page without running an application server.
const moduleScript = path => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const names = [...source.matchAll(/^export (?:async )?(?:function|class|const|let) (\w+)/gm)].map(match => match[1]);
    return `Object.assign(window, (() => { ${source.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '')}\nreturn {${names.join(',')}}; })());`;
};

test('MIDI Lyrics paint current WRD pages and MusicXML parts through the real canvas renderer and inspector', async () => {
    const lyricTimeline = meta => {
        const event = (delta, value) => { const bytes = Buffer.from(value); return [...delta, 255, meta, bytes.length, ...bytes]; };
        const track = Buffer.from([
            ...event([0], meta === 1 ? '\\First' : 'First'),
            ...event([0x83, 0x60], meta === 1 ? '/Second' : '\rSecond'),
            ...event([0x83, 0x60], meta === 1 ? '\\' : '\n'),
            ...event([0x83, 0x60], 'Final'), 0x83, 0x60, 255, 47, 0
        ]);
        const header = Buffer.from('4d546864000000060000000101e04d54726b00000000', 'hex');
        header.writeUInt32BE(track.length, 18);
        return parseSmf(Buffer.concat([header, track]), { fileName: meta === 1 ? 'fixture.kar' : 'fixture.mid' });
    };
    const parsedLyrics = [lyricTimeline(1), lyricTimeline(5)];
    const installed = chromium.executablePath();
    const chrome = process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null;
    const browser = await chromium.launch({ headless: true,
        ...(!existsSync(installed) && chrome && existsSync(chrome) ? { executablePath: chrome } : {}) });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="inspector"></div><canvas width="1280" height="720"></canvas></body>');
        for (const path of ['../../js/visualizer/visualizer-model.js', '../../js/ui/range-fill.js',
            '../../js/library/metadata/lyrics.js', '../../js/midi/lyrics-timeline.js', '../../js/midi/wrd-parser.js',
            '../../js/visualizer/visualizer-text.js', '../../js/visualizer/visualizer-lyrics.js',
            '../../js/visualizer/visualizer-effects.js', '../../js/visualizer/visualizer-editor.js',
            '../../js/visualizer/visualizer-view.js', '../../js/visualizer/visualizer-renderer.js']) {
            await page.addScriptTag({ content: moduleScript(path) });
        }
        const result = await page.evaluate(parsedLyrics => {
            let fieldId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++fieldId) });
            const canvas = document.querySelector('canvas');
            const renderer = new VisualizerRenderer(canvas);
            const item = createItem('lyrics', 'words');
            Object.assign(item.params, { lyricsFadeIn: 0, lyricsFadeOut: 0, lyricsStepDuration: 0 });
            item.style.fontFamily = 'serif'; item.style.fontSize = 44; item.style.bold = true;
            item.palette = { ...item.palette, mode: 'gradient', stops: [{ pos: 0, color: '#ff6040' }, { pos: 1, color: '#4080ff' }] };
            item.flipX = item.flipY = true;
            const layout = { ...createDefaultLayout(), items: [item] };
            let midi = { position: 5.5, speed: 1, timeline: { duration: 8, lyrics: { source: 'wrd', cues: [
                { seconds: 1, text: 'First\nSecond' }, { seconds: 3, text: '' }, { seconds: 5, text: 'Final page' }
            ] } } };
            const state = { currentTrack: {}, currentTrackPosition: 0, isPlaying: true, isStopped: false };
            const sources = { getMidiPresentation: () => midi, getModulators: () => ({}), getFrame: () => null };
            const view = Object.assign(Object.create(VisualizerView.prototype), { hasLyrics: true, sources,
                uiManager: { audioPlayer: { ui: { container: {} }, stateManager: { getStateSnapshot: () => state } } } });
            const nativeText = CanvasRenderingContext2D.prototype.fillText;
            let painted = [];
            CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
                painted.push({ text, font: this.font, x: args[0], y: args[1], maxWidth: args[2] });
                return nativeText.call(this, text, ...args);
            };
            const draw = () => {
                painted = [];
                renderer.draw(layout, sources, null, 2000, { lyrics: view.lyrics() });
                const layer = renderer.layers.get('words')?.canvas;
                const pixels = layer?.getContext('2d').getImageData(0, 0, layer.width, layer.height).data || [];
                let ink = 0;
                for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) ink++;
                return { text: painted.map(row => row.text), fonts: painted.map(row => row.font), ink };
            };
            const late = draw();
            midi.position = 1.5;
            const seek = draw();
            midi.position = 3.5;
            const clear = draw();
            midi.position = 5.5; midi.speed = .5; state.isPlaying = false;
            const pause = draw();
            const held = draw();
            midi = { position: 1.5, timeline: { duration: 8, lyrics: { source: 'wrd', cues: [
                { seconds: 1, text: Array.from({ length: 25 }, (_, index) => `Row ${index + 1}`).join('\n') }
            ] } } };
            const fullPage = draw();
            const gridTimeline = { duration: 4, tempoMap: [{ quarter: 0, seconds: 0, microsecondsPerQuarter: 500000 }],
                timeSignatures: [{ quarter: 0, numerator: 4, denominator: 4 }] };
            gridTimeline.lyrics = parseWrd('@WMODE(23);\n@LOCATE(3,2);\nAあ★Z;\n@WAIT(2);\n@LOCATE(3,25);\nB;', gridTimeline);
            const gridItem = createItem('lyrics', 'grid');
            Object.assign(gridItem.style, { fontSize: 40, outlineWidth: 0, letterSpacing: 0 });
            const grid = time => {
                painted = [];
                const frame = lyricsFrame(gridItem, { data: getMidiLyricsData(gridTimeline), time }, false);
                drawLyrics(canvas.getContext('2d'), gridItem, frame, 640, 400, 1, '#ffffff');
                return painted.filter(glyph => glyph.text !== ' ');
            };
            const gridBefore = grid(.5), gridAfter = grid(2.5);
            const shadows = [0, 2].map(outlineWidth => {
                Object.assign(gridItem.style, { outlineWidth, outlineColor: '#ffffff', shadowColor: '#ff0000',
                    shadowOpacity: 1, shadowBlur: 0, shadowX: 10, shadowY: 10 });
                const render = (masked, shadow) => {
                    gridItem.style.shadowOpacity = shadow ? 1 : 0;
                    const target = document.createElement('canvas'); target.width = 640; target.height = 400;
                    const mask = masked ? target.cloneNode() : null;
                    const context = target.getContext('2d'), gradient = context.createLinearGradient(0, 0, 640, 0);
                    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(1, '#ffffff');
                    drawLyrics(context, gridItem, { screen: true, current: 0,
                        rows: [{ time: 0, text: '\n  I          I' }] }, 640, 400, 1, masked ? gradient : '#ffffff', mask);
                    return target.getContext('2d').getImageData(0, 0, 640, 400).data;
                };
                const plain = render(false, true), masked = render(true, true), unshadowed = render(true, false);
                let differences = 0, redShadowPixels = 0, plainRedPixels = 0, unshadowedRedPixels = 0;
                for (let index = 0; index < plain.length; index += 4) {
                    for (let channel = 0; channel < 4; channel++) if (plain[index + channel] !== masked[index + channel]) differences++;
                    if (masked[index] > 0 && masked[index + 1] === 0 && masked[index + 2] === 0) redShadowPixels++;
                    if (plain[index] > 0 && plain[index + 1] === 0 && plain[index + 2] === 0) plainRedPixels++;
                    if (unshadowed[index] > 0 && unshadowed[index + 1] === 0 && unshadowed[index + 2] === 0) unshadowedRedPixels++;
                }
                return { outlineWidth, differences, redShadowPixels, plainRedPixels, unshadowedRedPixels };
            });
            midi = { position: 5.5, timeline: { duration: 8, lyrics: { source: 'musicxml', cues: [
                { seconds: 1, endSeconds: 2, text: 'Old line', part: 'Voice', verse: '1', endLine: true },
                { seconds: 5, endSeconds: 7, text: 'Current line', part: 'Voice', verse: '1', endLine: true },
                { seconds: 1, endSeconds: 7, text: 'Verse two', part: 'Voice', verse: '2', endLine: true },
                { seconds: 1, endSeconds: 7, text: 'Choir part', part: 'Choir', verse: '1', endLine: true }
            ] } } };
            Object.assign(item.params, { lyricsView: 'line', lyricsNext: false, lyricsWordFill: false });
            const score = draw();
            const inspector = document.querySelector('#inspector');
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                root: inspector, view: { ...view, commitPending() {} }, changed() {}
            });
            editor.parameters(inspector, item);
            const control = name => [...inspector.querySelectorAll('.visualizer-field')]
                .find(row => row.querySelector('label')?.textContent === name)?.querySelector('select');
            const verse = control('Verse');
            verse.value = '2'; verse.dispatchEvent(new Event('change'));
            const secondVerse = draw();
            const part = control('Part');
            part.value = 'Choir'; part.dispatchEvent(new Event('change'));
            const choir = draw();
            const embedded = parsedLyrics.map(timeline => {
                midi = { position: .25, timeline };
                Object.assign(item.params, { lyricsPart: '', lyricsVerse: '', lyricsView: 'line', lyricsNext: false });
                const first = draw();
                midi.position = .75;
                const second = draw();
                midi.position = 1.25;
                const cleared = draw();
                midi.position = 1.75;
                const final = draw();
                midi.position = .25;
                const sought = draw();
                return { first, second, cleared, final, sought };
            });
            midi = { position: 0, timeline: { duration: 8 } };
            const empty = draw();
            return { late, seek, clear, pause, held, fullPage, gridBefore, gridAfter, shadows, score, secondVerse, choir, embedded, empty };
        }, parsedLyrics);
        assert.equal(result.late.text.join(''), 'Final page', 'the first painted frame opens at the processed position');
        assert.equal(result.seek.text.join(''), 'FirstSecond');
        assert.equal(result.clear.ink, 0, 'WRD clear removes the entire text page');
        assert.equal(result.pause.text.join(''), 'Final page');
        assert.deepEqual(result.held.text, [], 'paused frames reuse the held layer at any wall-clock time');
        assert.equal(result.fullPage.text.join(''), Array.from({ length: 25 }, (_, index) => `Row ${index + 1}`).join(''), 'full WRD text screens fit vertically inside the item');
        assert.ok(result.fullPage.fonts.every(font => Number(/([\d.]+)px/.exec(font)[1]) < 44));
        assert.deepEqual(result.gridBefore.map(({ text, x, y, maxWidth }) => [text, x, y, maxWidth]),
            [['A', 20, 24, 8], ['あ', 32, 24, 16], ['★', 48, 24, 16], ['Z', 60, 24, 8]],
            'half-width and double-byte glyphs occupy the original console cells with proportional fonts');
        assert.deepEqual(result.gridAfter.slice(0, 4), result.gridBefore, 'revealing the bottom row preserves earlier glyph positions and size');
        assert.deepEqual(result.gridAfter.at(-1), { text: 'B', font: result.gridBefore[0].font, x: 20, y: 392, maxWidth: 8 });
        for (const shadow of result.shadows) {
            if (shadow.outlineWidth) assert.equal(shadow.differences, 0, 'outlined text keeps its original shadow without adding a second fill shadow');
            assert.equal(shadow.redShadowPixels, shadow.plainRedPixels, 'plain and gradient fills retain the same shadow footprint');
            assert.ok(shadow.redShadowPixels > 0, 'the configured shadow is visible');
            assert.equal(shadow.unshadowedRedPixels, 0, 'disabling the shadow removes its pixels');
        }
        assert.deepEqual(result.score.text, ['Current line']);
        assert.deepEqual(result.secondVerse.text, ['Verse two']);
        assert.deepEqual(result.choir.text, ['Choir part']);
        for (const embedded of result.embedded) {
            assert.deepEqual(embedded.first.text, ['First']);
            assert.deepEqual(embedded.second.text, ['Second']);
            assert.equal(embedded.cleared.ink, 0, 'KAR and standard Lyric paragraph clears remove the text');
            assert.deepEqual(embedded.final.text, ['Final']);
            assert.deepEqual(embedded.sought.text, ['First']);
        }
        assert.equal(result.empty.ink, 0);
        assert.ok(result.late.ink > 100 && result.seek.ink > 100 && result.choir.ink > 100);
        assert.ok(result.late.fonts.every(font => /bold [\d.]+px serif/.test(font)));
    } finally { await browser.close(); }
});
