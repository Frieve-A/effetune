import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ASPECTS, ASPECT_FILES, FONT_FAMILIES, TEXT_DECORATION_DEFAULTS, METER_APPEARANCE_DEFAULTS, THEME_COLOR_ROLES, DEFAULT_THEME_COLORS, createDefaultLayout, createItem,
    layoutsEqual, normalizeEffect, normalizeLayout, normalizeParams, paletteModesForType, snapshotLayout, validateLayout,
    encodeLayoutShare, decodeLayoutShare, layoutShareParam, guitarAnalysis } from '../../js/visualizer/visualizer-model.js';
import { encodePipelineState } from '../../js/utils/pipeline-state-codec.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('layout share links round-trip without the background image and reject invalid payloads', async () => {
    const layout = createDefaultLayout();
    layout.background.image = 'data:image/png;base64,AAAA';
    const decoded = decodeLayoutShare(encodeLayoutShare(layout));
    assert.ok(validateLayout(decoded));
    assert.equal(decoded.background.image, null);
    assert.ok(layoutsEqual(decoded, { ...layout, background: { ...layout.background, image: null } }));
    await withGlobals({ console: { ...console, warn() {} } }, () => {
        assert.equal(decodeLayoutShare('not base64!'), null);
        assert.equal(decodeLayoutShare(encodePipelineState({ aspect: '16:9' })), null);
    });
    assert.equal(layoutShareParam('not a link'), null);
    assert.equal(layoutShareParam('https://effetune.frieve.com/effetune.html?p=abc'), null);
    assert.equal(layoutShareParam(' https://effetune.frieve.com/effetune.html?v=abc '), 'abc');
    assert.equal(layoutShareParam('https://www.youtube.com/watch?v=abc'), null);
});

test('original analyzer parameters and optional note octave mapping normalize in one place', () => {
    assert.deepEqual(normalizeParams('spectrum'), { dr: -96, pt: 12, sc: 'log-hq', kb: false, kl: 100, mf: 40000, dm: 'line', quantizeBars: true, bc: 48, ds: 1,
        orientation: 'horizontal', cf: 0, pk: true, ph: 0, pf: 1, sm: 0, gainDb: 0, showAxes: false, showAxisNumbers: false });
    assert.equal(createItem('spectrogram', 'new-spectrogram').params.sc, 'log-hq');
    assert.equal(createDefaultLayout().items[0].params.sc, 'log-hq');
    assert.equal(normalizeParams('spectrum', { sc: 'log' }).sc, 'log');
    assert.equal(normalizeParams('spectrum', { orientation: 'diagonal' }).orientation, 'horizontal');
    assert.deepEqual([100, 20400, 99999].map(mf => normalizeParams('spectrum', { mf }).mf), [1000, 20000, 40000]);
    assert.deepEqual(normalizeParams('spectrum', { orientation: 'vertical', dm: 'bar', sc: 'linear', pt: 10 }),
        { dr: -96, pt: 10, sc: 'linear', kb: false, kl: 100, mf: 40000, dm: 'bar', quantizeBars: true, bc: 48, ds: 1, orientation: 'vertical',
            cf: 0, pk: true, ph: 0, pf: 1, sm: 0, gainDb: 0, showAxes: false, showAxisNumbers: false });
    assert.equal(normalizeParams('spectrum', { dm: 'bar', quantizeBars: false }).quantizeBars, false);
    assert.deepEqual(['bc', 'ds'].map(key => normalizeParams('spectrum', { bc: 300, ds: 2.3 })[key]), [128, 2.5]);
    assert.equal(normalizeParams('spectrogram', { sc: 'linear' }).sc, 'linear');
    const savedLayout = createDefaultLayout();
    savedLayout.items[0].params.sc = 'log';
    Object.assign(savedLayout.items[0].params, { kb: true, showAxes: true, showAxisNumbers: true });
    const restored = normalizeLayout(savedLayout).items[0].params;
    assert.deepEqual([restored.sc, restored.kb, restored.showAxes, restored.showAxisNumbers], ['log', true, true, true]);
    assert.deepEqual(normalizeParams('spectrogram', { dr: -200, pt: 15, sc: 'log-hq', kb: true, kl: 250, gainDb: 30, showAxes: false, showAxisNumbers: true }),
        { dr: -144, pt: 14, sc: 'log-hq', kb: true, kl: 200, mf: 40000, gainDb: 24, showAxes: false, showAxisNumbers: true });
    assert.deepEqual(normalizeParams('stereo'),
        { wt: 0.1, gainDb: 0, pk: true, ph: 0, pf: 1, showCorrelation: true, showBalance: true, showAxes: false, showAxisNumbers: false });
    assert.deepEqual(normalizeParams('stereo', { showCorrelation: false, showBalance: false, pf: 0.1 }),
        { wt: 0.1, gainDb: 0, pk: true, ph: 0, pf: 1, showCorrelation: false, showBalance: false, showAxes: false, showAxisNumbers: false });
    const stereo = createItem('stereo', 'stereo');
    stereo.params.showCorrelation = false;
    stereo.params.showBalance = false;
    assert.deepEqual(normalizeLayout({ ...createDefaultLayout(), items: [stereo] }).items[0].params,
        normalizeParams('stereo', { showCorrelation: false, showBalance: false }));
    assert.deepEqual(normalizeParams('notes', { pr: 'High', ly: 'Vertical', vl: false, ts: 9, mn: 90, mx: 40 }),
        { pr: 'High', ly: 'Vertical', kb: false, kl: 100, vl: false, ts: 9, mn: 90, mx: 90, showAxes: false, showAxisNumbers: false });
    const notes = createItem('notes', 'notes');
    assert.equal(notes.params.kb, false);
    assert.equal(notes.palette.mode, 'solid');
    assert.equal(notes.palette.color, '#40dfff');
    assert.equal(normalizeParams('notes', { kb: true }).kb, true);
    assert.equal(notes.palette.mapping, 'range');
    notes.palette.mapping = 'octave';
    notes.palette.stops = Array.from({ length: 13 }, (_, index) => ({ pos: index / 12, color: '#123456' }));
    const normalizedNotes = normalizeLayout({ ...createDefaultLayout(), items: [notes] }).items[0];
    assert.equal(normalizedNotes.palette.mapping, 'octave');
    assert.equal(normalizedNotes.palette.stops.length, 13);
    assert.equal(validateLayout({ ...createDefaultLayout(), items: [notes] }), true);
});

test('item color modes preserve independent solid color and gradient settings', () => {
    for (const type of ['spectrum', 'notes', 'chroma']) {
        const item = createItem(type, type);
        assert.equal(item.palette.mode, 'solid');
        item.palette.color = '#abcdef';
        item.palette.mode = 'note-colors';
        item.palette.motion.mode = 'hue';
        item.palette.stops[0].color = '#123456';
        if (type === 'notes' || type === 'chroma') item.palette.mapping = 'octave';
        const restored = normalizeLayout({ ...createDefaultLayout(), items: [item] }).items[0];
        assert.equal(restored.palette.mode, 'note-colors');
        assert.equal(restored.palette.color, '#abcdef');
        assert.equal(restored.palette.stops[0].color, '#123456');
        assert.equal(restored.palette.motion.mode, 'hue');
        if (type === 'notes' || type === 'chroma') assert.equal(restored.palette.mapping, 'octave');
        else assert.equal(Object.hasOwn(restored.palette, 'mapping'), false);
        item.palette.mode = 'heatmap';
        assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [item] }).items[0].palette.mode,
            type === 'notes' ? 'solid' : 'heatmap');
    }
    const spectrogram = createItem('spectrogram', 'spectrogram');
    spectrogram.palette.mode = 'note-colors';
    assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [spectrogram] }).items[0].palette.mode,
        'solid');
    spectrogram.palette.mode = 'heatmap';
    assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [spectrogram] }).items[0].palette.mode,
        'heatmap');
    assert.deepEqual(paletteModesForType('spectrum'), ['solid', 'gradient', 'note-colors', 'heatmap']);
    assert.deepEqual(paletteModesForType('spectrogram'), ['solid', 'gradient', 'heatmap']);
    assert.deepEqual(paletteModesForType('notes'), ['solid', 'gradient', 'note-colors']);
    const stereo = createItem('stereo', 'stereo');
    stereo.palette.mode = 'note-colors';
    assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [stereo] }).items[0].palette.mode, 'solid');
    stereo.palette.mode = 'heatmap';
    assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [stereo] }).items[0].palette.mode, 'solid');
    const meter = createItem('level-meter', 'meter');
    assert.deepEqual(meter.params, { dr: -96, orientation: 'horizontal', showLevelValues: false, ds: 0,
        cf: 1, pk: true, ph: 1, pf: 1, showAxes: false, showAxisNumbers: false });
    assert.equal(meter.channel, null);
    assert.equal(meter.palette.mode, 'solid');
    meter.palette.mode = 'heatmap';
    meter.params.showAxes = true;
    const restoredMeter = normalizeLayout({ ...createDefaultLayout(), items: [meter] }).items[0];
    assert.equal(restoredMeter.palette.mode, 'heatmap');
    assert.equal(restoredMeter.params.showAxes, true);
    assert.deepEqual(normalizeParams('level-meter', { dr: -61, orientation: 'vertical', showLevelValues: true }),
        { dr: -61, orientation: 'vertical', showLevelValues: true, ds: 0, cf: 1, pk: true, ph: 1, pf: 1, showAxes: false, showAxisNumbers: false });
    assert.equal(normalizeParams('level-meter', { dr: -200 }).dr, -144);
    assert.equal(normalizeParams('level-meter', { dr: -20 }).dr, -48);
    assert.equal(normalizeParams('level-meter', { orientation: 'diagonal' }).orientation, 'horizontal');
    meter.palette.mode = 'note-colors';
    assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [meter] }).items[0].palette.mode, 'solid');
    for (const type of ['title', 'album', 'artist']) {
        const text = createItem(type, type);
        assert.equal(text.palette.mode, 'solid');
        text.palette.mode = 'gradient';
        assert.equal(normalizeLayout({ ...createDefaultLayout(), items: [text] }).items[0].palette.mode, 'gradient');
    }
    assert.equal(Object.hasOwn(createItem('artwork').palette, 'mode'), false);
});

test('Gradient direction survives presets and sharing while existing layouts keep frequency coloring', () => {
    for (const type of ['spectrum', 'spectrogram', 'notes', 'chroma', 'phase']) {
        const item = createItem(type, type);
        item.palette.mode = 'gradient';
        const layout = { ...createDefaultLayout(), items: [item] };
        assert.ok(validateLayout(layout));
        assert.equal(Object.hasOwn(decodeLayoutShare(encodeLayoutShare(layout)).items[0].palette, 'direction'), false);
        for (const direction of ['intensity', 'frequency', 'radial']) {
            item.palette.direction = direction;
            item.palette.angle = -45;
            assert.ok(validateLayout(layout));
            assert.equal(normalizeLayout(layout).items[0].palette.direction, direction);
            assert.equal(decodeLayoutShare(encodeLayoutShare(layout)).items[0].palette.direction, direction);
            assert.equal(decodeLayoutShare(encodeLayoutShare(layout)).items[0].palette.angle, -45);
        }
        item.palette.direction = 'diagonal';
        assert.equal(normalizeLayout(layout).items[0].palette.direction, 'frequency');
        assert.equal(validateLayout(layout), false);
    }
    for (const type of ['oscilloscope', 'stereo', 'level-meter', 'analog-meter', 'rhythm-analyzer', 'title', 'album', 'artist', 'text', 'shape']) {
        const item = createItem(type, type);
        const layout = { ...createDefaultLayout(), items: [item] };
        assert.ok(validateLayout(layout));
        assert.equal(Object.hasOwn(normalizeLayout(layout).items[0].palette, 'direction'), false);
        for (const direction of ['linear', 'radial']) {
            Object.assign(item.palette, { direction, angle: 90 });
            assert.ok(validateLayout(layout));
            const palette = decodeLayoutShare(encodeLayoutShare(layout)).items[0].palette;
            assert.equal(palette.direction, direction);
            assert.equal(palette.angle, 90);
        }
        item.palette.direction = 'intensity';
        assert.equal(normalizeLayout(layout).items[0].palette.direction, 'linear');
        assert.equal(validateLayout(layout), false);
        item.palette.direction = 'linear';
        item.palette.angle = 999;
        assert.equal(normalizeLayout(layout).items[0].palette.angle, 180);
        assert.equal(validateLayout(layout), false);
        item.palette.angle = NaN;
        assert.equal(normalizeLayout(layout).items[0].palette.angle, 0);
        assert.equal(validateLayout(layout), false);
    }
    const artwork = createItem('artwork');
    Object.assign(artwork.palette, { direction: 'linear', angle: 90 });
    const palette = normalizeLayout({ ...createDefaultLayout(), items: [artwork] }).items[0].palette;
    assert.equal(Object.hasOwn(palette, 'direction'), false);
    assert.equal(Object.hasOwn(palette, 'angle'), false);
});

test('Color motion reversal survives saving and sharing for item and effect palettes', () => {
    const layout = createDefaultLayout(), item = layout.items[0];
    item.effects = [normalizeEffect({ type: 'glow' })];
    layout.background.effects = [normalizeEffect({ type: 'flash' }, 'background')];
    const palettes = [item.palette, item.effects[0].palette, layout.background.effects[0].palette];
    assert.ok(validateLayout(layout));
    assert.ok(palettes.every(palette => !Object.hasOwn(palette.motion, 'reverse')));
    for (const mode of ['hue', 'scroll', 'none']) for (const reverse of [true, false]) {
        for (const palette of palettes) Object.assign(palette.motion, { mode, speed: .75, reverse });
        assert.ok(validateLayout(layout));
        for (const restored of [normalizeLayout(layout), decodeLayoutShare(encodeLayoutShare(layout))]) {
            const restoredItem = restored.items[0];
            for (const palette of [restoredItem.palette, restoredItem.effects[0].palette, restored.background.effects[0].palette])
                assert.deepEqual(palette.motion, { mode, speed: .75, reverse });
        }
    }
    item.palette.motion.reverse = 'yes';
    assert.equal(validateLayout(layout), false);
    assert.equal(normalizeLayout(layout).items[0].palette.motion.reverse, false);
});

test('Chroma defaults and octave bounds follow its native controls', () => {
    const chroma = createItem('chroma', 'chroma');
    assert.deepEqual(chroma.params, { dm: 0, lo: 1, hi: 7, ft: 3, lr: 24, df: -60, cf: 0,
        showAxes: false, showAxisNumbers: false });
    assert.equal(chroma.channel, null);
    assert.equal(chroma.palette.mapping, 'range');
    assert.deepEqual(normalizeParams('chroma', { dm: 2, lo: 8, hi: 2, ft: 2.74, lr: 100, df: -200 }),
        { dm: 0, lo: 8, hi: 8, ft: 2.5, lr: 96, df: -120, cf: 0,
            showAxes: false, showAxisNumbers: false });
});

test('Guitar defaults, bounds, and detection range follow the tuning, frets, and capo', () => {
    const guitar = createItem('guitar', 'guitar');
    assert.deepEqual(guitar.params, { tn: [40, 45, 50, 55, 59, 64], fm: 0, fx: 12, cp: 0, pm: 'all', lb: 'sharp',
        ro: -1, sk: 'none', th: 0.5, cf: 0.2, ly: 'Horizontal', fl: false, vs: false, rs: true, fb: true, mk: true, fn: true, sn: true });
    assert.deepEqual(guitarAnalysis(guitar.params), { mn: 40, mx: 76 });
    const params = normalizeParams('guitar', { tn: [28, 33, 200], fm: 9, fx: 3, cp: 20, pm: 'x', ro: 12, th: 1 });
    assert.deepEqual([params.tn, params.fm, params.fx, params.cp, params.pm, params.ro, params.th],
        [[28, 33, 108], 9, 9, 12, 'all', -1, 0.9]);
    // The capo raises the lowest note above the open strings.
    assert.deepEqual(guitarAnalysis({ tn: [28, 33, 38, 43], fm: 0, fx: 20, cp: 5 }), { mn: 33, mx: 63 });
});

test('Phase Map defaults, steps, and palettes follow Phase Select EQ', () => {
    const phase = createItem('phase', 'phase');
    assert.deepEqual(phase.params, { ax: 'phase', dr: -72, ml: -40, pe: 0.5, showAxes: false, showAxisNumbers: false });
    assert.equal(phase.channel, null);
    assert.deepEqual(normalizeParams('phase', { ax: 'depth', dr: -200, ml: -200, pe: 9 }),
        { ax: 'phase', dr: -96, ml: -120, pe: 2, showAxes: false, showAxisNumbers: false });
    assert.deepEqual(normalizeParams('phase', { ax: 'balance', dr: -40, ml: -47.6, pe: 0.26, showAxes: true }),
        { ax: 'balance', dr: -42, ml: -48, pe: 0.3, showAxes: true, showAxisNumbers: false });
    assert.deepEqual(paletteModesForType('phase'), ['solid', 'gradient', 'heatmap']);
    phase.params = { ax: 'balance', dr: -48, ml: -72, pe: 1.2, showAxes: true, showAxisNumbers: true };
    phase.palette.mode = 'heatmap';
    const layout = { ...createDefaultLayout(), items: [phase] };
    assert.equal(validateLayout(layout), true);
    const restored = decodeLayoutShare(encodeLayoutShare(layout)).items[0];
    assert.deepEqual(restored.params, phase.params);
    assert.equal(restored.palette.mode, 'heatmap');
    phase.params.pe = 0.25;
    assert.equal(validateLayout(layout), false);
    phase.palette.mode = 'note-colors';
    assert.equal(normalizeLayout(layout).items[0].palette.mode, 'solid');
});

test('Analog Meter defaults, steps, and axes follow the Analog Meter effect', () => {
    const meter = createItem('analog-meter', 'meter');
    assert.deepEqual(meter.params, { md: 'VU', it: 0.3, at: 5, rt: 1.5, rl: -14, rg: 40, sc: 0, ph: 1,
        ln: 0, tg: -23, ls: 0, ...METER_APPEARANCE_DEFAULTS, showAxes: true, showAxisNumbers: true });
    assert.deepEqual(normalizeParams('analog-meter', { md: 'Bar', it: 9, at: 0, rt: 2.345, rl: -14.6, rg: 90,
        sc: 3, ph: 0.26, ln: '1', tg: -50, ls: 2, showAxes: false }),
    { md: 'VU', it: 3, at: 1, rt: 2.35, rl: -15, rg: 60, sc: 0, ph: 0.3, ln: 0, tg: -36, ls: 0,
        ...METER_APPEARANCE_DEFAULTS, showAxes: false, showAxisNumbers: true });
    assert.deepEqual(paletteModesForType('analog-meter'), ['solid', 'gradient']);
    meter.params = { md: 'Loudness', it: 1.25, at: 7.5, rt: 2.33, rl: -18, rg: 50, sc: 1, ph: 2.5,
        ln: 1, tg: -16, ls: 1, ...METER_APPEARANCE_DEFAULTS, showAxes: true, showAxisNumbers: false };
    meter.palette.mode = 'gradient';
    const layout = { ...createDefaultLayout(), items: [meter] };
    assert.equal(validateLayout(layout), true);
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params, meter.params);
    meter.params.at = 7.55;
    assert.equal(validateLayout(layout), false);
});

test('Meter appearance persists in shares, accepts older layouts, and rejects invalid supplied values', () => {
    const meter = createItem('analog-meter', 'meter');
    Object.assign(meter.params, { dialCurvature: 0.35, dialSweep: 120, pivotOffset: 40, needleStart: 25,
        needleLength: 110, needleWidth: 1.5, needleTip: 'taper', arrowAspect: 2.5, hubSize: 6, showPercent: true,
        readoutUnit: 'percent', showSigns: true, faceShape: 'circle', faceOpacity: 1, vignette: 0.6 });
    const layout = { ...createDefaultLayout(), items: [meter] };
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0], meter);
    const old = structuredClone(layout);
    for (const key of Object.keys(METER_APPEARANCE_DEFAULTS)) delete old.items[0].params[key];
    assert.equal(validateLayout(old), true);
    assert.equal(normalizeLayout(old).items[0].params.dialCurvature, 1);
    for (const [key, value, expected] of [['dialCurvature', -1, 0], ['dialSweep', 999, 160],
        ['needleWidth', 0, 0.5], ['arrowAspect', 0, 0.25], ['hubSize', -1, 0],
        ['faceShape', 'triangle', 'rectangle'], ['vignette', 2, 1]]) {
        const invalid = structuredClone(layout);
        invalid.items[0].params[key] = value;
        assert.equal(validateLayout(invalid), false, key);
        assert.equal(normalizeLayout(invalid).items[0].params[key], expected);
    }
});

test('Saved meter hub switches migrate to an editable size', () => {
    const layout = { ...createDefaultLayout(), items: [createItem('analog-meter', 'meter')] };
    const params = layout.items[0].params;
    delete params.hubSize;
    delete params.arrowAspect;
    for (const visible of [false, true]) {
        params.showHub = visible;
        assert.equal(validateLayout(layout), true);
        const migrated = decodeLayoutShare(encodeLayoutShare(layout)).items[0].params;
        assert.equal(migrated.hubSize, visible ? 3 : 0);
        assert.equal(Object.hasOwn(migrated, 'showHub'), false);
        assert.equal(migrated.arrowAspect, 1);
        migrated.hubSize = 8;
        assert.equal(normalizeParams('analog-meter', migrated).hubSize, 8);
    }
    params.showHub = 'false';
    assert.equal(validateLayout(layout), false);
});

test('Rhythm Analyzer defaults and bounds follow the Rhythm Analyzer effect', () => {
    const rhythm = createItem('rhythm-analyzer', 'rhythm');
    assert.deepEqual(rhythm.params, { mn: 40, mx: 240, sp: 8, showBeat: true, showBpm: true, vt: false, vm: true, ve: false, vl: true, showAxes: true, showAxisNumbers: true });
    assert.deepEqual(normalizeParams('rhythm-analyzer', { mn: 250, mx: 60.4, sp: 5 }),
        { mn: 192, mx: 240, sp: 8, showBeat: true, showBpm: true, vt: false, vm: true, ve: false, vl: true, showAxes: true, showAxisNumbers: true });
    assert.deepEqual(normalizeParams('rhythm-analyzer', { mn: 10, mx: 900, sp: 12, showAxes: false }),
        { mn: 40, mx: 240, sp: 12, showBeat: true, showBpm: true, vt: false, vm: true, ve: false, vl: true, showAxes: false, showAxisNumbers: true });
    assert.deepEqual(normalizeParams('rhythm-analyzer', { mn: 40, mx: 240, sp: 8, vt: false, vm: false, ve: false, vl: false }),
        { mn: 40, mx: 240, sp: 8, showBeat: true, showBpm: true, vt: false, vm: false, ve: false, vl: false, showAxes: true, showAxisNumbers: true });
    assert.deepEqual(paletteModesForType('rhythm-analyzer'), ['solid', 'gradient']);
    rhythm.params = { mn: 60, mx: 180, sp: 12, showBeat: false, showBpm: true, vt: true, vm: false, ve: true, vl: false, showAxes: true, showAxisNumbers: true };
    rhythm.palette.mode = 'gradient';
    const layout = { ...createDefaultLayout(), items: [rhythm] };
    assert.equal(validateLayout(layout), true);
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params, rhythm.params);
    Object.assign(rhythm.style, { fontSize: 120, fontFamily: 'serif', align: 'right', verticalAlign: 'bottom', bold: true, outlineWidth: 2,
        beatSize: 75, beatLineWidth: 5, beatFillOpacity: .5, beatStrokeOpacity: .8, beatUsePalette: false, beatHoldTime: 50, beatDecayTime: 200,
        beatFillColor: '#123456', beatStrokeColor: '#abcdef', beatFitBpm: false });
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0], rhythm);
    const old = structuredClone(layout);
    delete old.items[0].params.showBeat;
    delete old.items[0].params.showBpm;
    old.items[0].style = {};
    assert.equal(validateLayout(old), true, 'Older Rhythm layouts still load');
    assert.equal(normalizeLayout(old).items[0].style.align, 'center');
    assert.equal(normalizeLayout(old).items[0].style.fontSize, 96);
    assert.equal(normalizeLayout(old).items[0].style.beatSize, 90);
    assert.equal(normalizeLayout(old).items[0].style.beatFitBpm, true);
    const previous = structuredClone(layout);
    for (const key of Object.keys(previous.items[0].style)) if (key.startsWith('beat')) delete previous.items[0].style[key];
    assert.equal(validateLayout(previous), true, 'Saved BPM typography remains valid without circle settings');
    const invalid = structuredClone(layout);
    Object.assign(invalid.items[0].style, { beatSize: 500, beatLineWidth: -2, beatFillOpacity: 2, beatStrokeOpacity: -1 });
    const normalized = normalizeLayout(invalid).items[0].style;
    assert.deepEqual([normalized.beatSize, normalized.beatLineWidth, normalized.beatFillOpacity, normalized.beatStrokeOpacity], [100, 0, 1, 0]);
    assert.equal(validateLayout(invalid), false);
    rhythm.params.sp = 5;
    assert.equal(validateLayout(layout), false);
});

test('Oscilloscope preserves its trigger and display settings in layouts', () => {
    const scope = createItem('oscilloscope', 'scope');
    assert.deepEqual(scope.params, { dt: 0.01, tm: 'Auto', tl: 0, te: 'Rising', ho: 0.0001,
        dl: 0, vo: 0, showAxes: false, showAxisNumbers: false });
    assert.deepEqual(paletteModesForType('oscilloscope'), ['solid', 'gradient']);
    scope.params = { dt: 0.1, tm: 'Normal', tl: -0.5, te: 'Falling', ho: 0.01,
        dl: -24, vo: 0.25, showAxes: true, showAxisNumbers: true };
    assert.deepEqual(normalizeLayout({ ...createDefaultLayout(), items: [scope] }).items[0].params, scope.params);
    assert.equal(validateLayout({ ...createDefaultLayout(), items: [scope] }), true);
    assert.deepEqual(normalizeParams('oscilloscope', { dt: 1, tm: 'invalid', tl: -2,
        te: 'invalid', ho: 0, dl: -200, vo: 2 }),
        { dt: 0.1, tm: 'Auto', tl: -1, te: 'Rising', ho: 0.0001, dl: -96, vo: 1,
            showAxes: false, showAxisNumbers: false });
});

test('Graph scale normalizes into range and always accompanies a layout', () => {
    assert.equal(createDefaultLayout().graphScale, 1);
    assert.equal(normalizeLayout({}).graphScale, 1);
    assert.equal(normalizeLayout({ graphScale: 0.1 }).graphScale, 0.5);
    assert.equal(normalizeLayout({ graphScale: 10 }).graphScale, 3);
    assert.equal(normalizeLayout({ graphScale: 1.234 }).graphScale, 1.25);
});

test('saved layouts accept only missing newly defaulted fields and retain strict supplied-value validation', () => {
    // The original default snapshot predates Graph Scale and analyzer ballistics.
    const original = {
        aspect: '16:9', background: { color: '#080d1c', image: null, effects: [] },
        items: [{ id: 'main-spectrum', type: 'spectrum', rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
            channel: null, flipX: false, flipY: false,
            palette: { stops: [{ pos: 0, color: '#40dfff' }], motion: { mode: 'none', speed: 0.25 }, mode: 'solid', color: '#40dfff' },
            params: { dr: -96, pt: 12, sc: 'log-hq', kb: false, dm: 'line', quantizeBars: true,
                orientation: 'horizontal', gainDb: 0, showAxes: false, showAxisNumbers: false }, style: {}, effects: [] }]
    };
    assert.equal(validateLayout(original), true);
    assert.deepEqual(normalizeLayout(original), createDefaultLayout());
    assert.deepEqual(decodeLayoutShare(encodePipelineState(original)), original);
    assert.equal(Object.hasOwn(original, 'graphScale'), false, 'Validation does not rewrite the input');
    for (const [type, keys] of Object.entries({
        spectrum: ['kl', 'cf', 'pk', 'ph', 'pf', 'sm', 'mf'], spectrogram: ['kl', 'mf'], notes: ['kl'],
        stereo: ['pk', 'ph', 'pf'], 'level-meter': ['cf', 'pk', 'ph', 'pf'], chroma: ['cf']
    })) {
        const layout = { ...createDefaultLayout(), items: [createItem(type, type)] };
        const saved = structuredClone(layout);
        delete saved.graphScale;
        for (const key of keys) delete saved.items[0].params[key];
        assert.equal(validateLayout(saved), true, type);
        assert.deepEqual(normalizeLayout(saved), layout);
        for (const key of keys) {
            for (const invalid of [null, undefined, 'invalid', key === 'pk' ? 0 : 999]) {
                const supplied = structuredClone(saved);
                supplied.items[0].params[key] = invalid;
                assert.equal(validateLayout(supplied), false, `${type}.${key}=${invalid}`);
            }
        }
        const missingOriginal = structuredClone(saved);
        delete missingOriginal.items[0].params.showAxes;
        assert.equal(validateLayout(missingOriginal), false, `${type} still requires original parameters`);
        saved.items[0].params.extra = 1;
        assert.equal(validateLayout(saved), false, 'Unknown fields remain invalid');
    }
    for (const invalid of [null, undefined, '1', 10, 1.234]) {
        assert.equal(validateLayout({ ...original, graphScale: invalid }), false, `graphScale=${invalid}`);
    }
});

test('released Notes layouts migrate only valid retired note counts on restore and sharing', () => {
    const layout = { ...createDefaultLayout(), items: [createItem('notes', 'saved-notes')] };
    // EffeTune v2.12.0 saved nc=8 with the other Notes defaults.
    layout.items[0].params = { pr: 'Semitone', ly: 'Horizontal', kb: false, kl: 100, vl: true,
        ts: 2, mn: 28, mx: 91, nc: 8, showAxes: false, showAxisNumbers: false };
    for (const count of [1, 8, 16]) {
        layout.items[0].params.nc = count;
        const saved = structuredClone(layout);
        assert.equal(validateLayout(layout), true, `released nc=${count}`);
        assert.deepEqual(layout, saved, 'validation does not rewrite the saved layout');
        // Encode the old payload directly: the current share encoder already strips nc.
        const shared = decodeLayoutShare(encodePipelineState(layout));
        assert.notEqual(shared, null);
        assert.deepEqual(normalizeLayout(shared), normalizeLayout(layout));
        assert.equal(Object.hasOwn(normalizeLayout(shared).items[0].params, 'nc'), false);
        assert.equal(Object.hasOwn(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params, 'nc'), false);
    }
    for (const count of [0, 17, 1.5, '8', null, undefined]) {
        layout.items[0].params.nc = count;
        assert.equal(validateLayout(layout), false, `invalid retired nc=${count}`);
    }
    layout.items[0].params.nc = 8;
    layout.items[0].params.extra = 1;
    assert.equal(validateLayout(layout), false, 'unknown fields remain invalid');
    delete layout.items[0].params.extra;
    layout.items[0].params.mn = 999;
    assert.equal(validateLayout(layout), false, 'other supplied values remain strict');
    const guitar = { ...createDefaultLayout(), items: [createItem('guitar', 'guitar')] };
    guitar.items[0].params.nc = 8;
    assert.equal(validateLayout(guitar), false, 'the retired field applies only to Notes');
});

test('Fall time, peak toggle, peak fall time, and smoothing normalize per type', () => {
    assert.deepEqual(normalizeParams('spectrum', { cf: 10, ph: 20, pf: 20, sm: 2 }),
        { ...normalizeParams('spectrum'), cf: 5, ph: 10, pf: 10, sm: 1 });
    assert.equal(normalizeParams('spectrum', { pk: false }).pk, false);
    assert.equal(normalizeParams('spectrum', { cf: 0.123 }).cf, 0.1);
    assert.equal(Object.hasOwn(normalizeParams('spectrogram'), 'cf'), false);
    assert.deepEqual(normalizeParams('level-meter', { cf: -5, ph: -5, pf: 0 }),
        { ...normalizeParams('level-meter'), cf: 0, ph: 0, pf: 0.1 });
    assert.equal(normalizeParams('level-meter', { pk: false }).pk, false);
    assert.equal(normalizeParams('chroma', { cf: 3.14 }).cf, 3.15);
    assert.equal(normalizeParams('stereo', { pk: false }).pk, false);
    assert.equal(Object.hasOwn(normalizeParams('analog-meter'), 'pk'), false);
});

test('visualizer layouts normalize unknown and out-of-range settings', () => {
    const input = createDefaultLayout();
    input.aspect = 'unknown';
    input.items[0].channel = 'A';
    input.items[0].rect = { x: -2, y: 0.9, w: 0.5, h: 0.8 };
    input.items[0].palette.stops = [{ pos: 4, color: 'bad' }];
    input.items[0].palette.color = 'bad';
    input.items[0].effects = [{ type: 'unknown' }, { type: 'glow', amount: 4,
        mod: { source: 'bass', depth: 8 } }];
    const layout = normalizeLayout(input);
    assert.equal(layout.aspect, '16:9');
    assert.equal(layout.items[0].channel, null);
    assert.equal(layout.items[0].rect.x, -2);
    assert.equal(layout.items[0].rect.y, 0.9);
    assert.equal(layout.items[0].rect.w, 0.5);
    assert.equal(layout.items[0].rect.h, 0.8);
    assert.deepEqual(layout.items[0].palette.stops, [{ pos: 1, color: '#40dfff' }]);
    assert.equal(layout.items[0].palette.color, '#40dfff');
    assert.equal(layout.items[0].effects.length, 1);
    assert.equal(layout.items[0].effects[0].amount, 1);
    assert.equal(layout.items[0].effects[0].mod.depth, 1);
    assert.equal(validateLayout(layout), true);
    assert.equal(validateLayout(input), false);
    assert.equal(createItem('title', 'name').style.fontFamily, 'sans-serif');
});

test('Trail Feedback zoom, rotation, and flow persist without invalidating older layouts', () => {
    const layout = createDefaultLayout();
    layout.items[0].effects = [normalizeEffect({ type: 'trail-feedback' })];
    assert.equal(Object.hasOwn(layout.items[0].effects[0], 'angle'), false);
    assert.equal(Object.hasOwn(layout.items[0].effects[0], 'zoom'), false);
    assert.equal(validateLayout(layout), true);
    layout.items[0].effects[0].zoom = -1.25;
    layout.items[0].effects[0].angle = -2.5;
    layout.items[0].effects[0].flowX = .65;
    layout.items[0].effects[0].flowY = -.4;
    assert.equal(normalizeLayout(layout).items[0].effects[0].angle, -2.5);
    assert.equal(normalizeLayout(layout).items[0].effects[0].zoom, -1.25);
    assert.equal(normalizeLayout(layout).items[0].effects[0].flowX, .65);
    assert.equal(normalizeLayout(layout).items[0].effects[0].flowY, -.4);
    assert.equal(validateLayout(layout), true);
    layout.items[0].effects[0].angle = -200;
    layout.items[0].effects[0].zoom = -20;
    layout.items[0].effects[0].flowX = 20;
    layout.items[0].effects[0].flowY = -20;
    assert.equal(normalizeLayout(layout).items[0].effects[0].angle, -3);
    assert.equal(normalizeLayout(layout).items[0].effects[0].zoom, -2);
    assert.equal(normalizeLayout(layout).items[0].effects[0].flowX, 1);
    assert.equal(normalizeLayout(layout).items[0].effects[0].flowY, -1);
});

test('Backplate settings default, clamp, and stay item-only', () => {
    const layout = createDefaultLayout();
    layout.items[0].effects = [normalizeEffect({ type: 'backplate' })];
    const { fill, fillOpacity, border, borderWidth, radius, margin, amount } = layout.items[0].effects[0];
    assert.deepEqual({ fill, fillOpacity, border, borderWidth, radius, margin, amount },
        { fill: '#000000', fillOpacity: 0.5, border: '#ffffff', borderWidth: 0, radius: 16, margin: 0, amount: 1 });
    assert.equal(validateLayout(layout), true);
    Object.assign(layout.items[0].effects[0], { fill: 'red', fillOpacity: 2, borderWidth: 99, radius: -5, margin: -300 });
    const restored = normalizeLayout(layout).items[0].effects[0];
    assert.deepEqual([restored.fill, restored.fillOpacity, restored.borderWidth, restored.radius, restored.margin], ['#000000', 1, 20, 0, -200]);
    assert.equal(validateLayout(layout), false);
    assert.equal(normalizeEffect({ type: 'backplate' }, 'background'), null);
});

test('text font choices and emphasis persist without affecting non-text items', () => {
    assert.equal(FONT_FAMILIES.length, 9);
    for (const type of ['title', 'album', 'artist']) {
        const item = createItem(type, type);
        assert.deepEqual([item.style.fontFamily, item.style.bold, item.style.italic], ['sans-serif', false, false]);
        item.style = { ...item.style, fontFamily: 'Georgia, "Times New Roman", serif', bold: true, italic: true };
        const restored = normalizeLayout({ ...createDefaultLayout(), items: [item] }).items[0];
        assert.deepEqual(restored.style, item.style);
    }
    const title = createItem('title', 'invalid-font');
    title.style.fontFamily = 'Unknown Local Font';
    title.style.bold = 'true';
    const normalized = normalizeLayout({ ...createDefaultLayout(), items: [title] }).items[0];
    assert.deepEqual([normalized.style.fontFamily, normalized.style.bold, normalized.style.italic], ['sans-serif', false, false]);
    assert.deepEqual(createItem('artwork', 'cover').style, { rounded: false });
});

test('text decorations are optional, persist when set, and clamp invalid values', () => {
    const title = createItem('title', 'decorated');
    assert.ok(validateLayout({ ...createDefaultLayout(), items: [title] }));
    title.style = { ...title.style, verticalAlign: 'bottom', textCase: 'upper', letterSpacing: 4,
        outlineWidth: 2.5, outlineColor: '#ffffff', shadowColor: '#102030', shadowOpacity: 0.4,
        shadowBlur: 8, shadowX: -3, shadowY: 5 };
    assert.ok(validateLayout({ ...createDefaultLayout(), items: [title] }));
    title.style = { ...title.style, verticalAlign: 'baseline', letterSpacing: 500, outlineColor: 'red', shadowOpacity: -1 };
    const normalized = normalizeLayout({ ...createDefaultLayout(), items: [title] }).items[0].style;
    assert.deepEqual([normalized.verticalAlign, normalized.letterSpacing, normalized.outlineColor, normalized.shadowOpacity],
        [TEXT_DECORATION_DEFAULTS.verticalAlign, 100, TEXT_DECORATION_DEFAULTS.outlineColor, 0]);
});

test('layout theme colors retain sparse compatibility and snapshot fixed Graphite defaults', () => {
    const layout = createDefaultLayout();
    assert.equal(Object.hasOwn(layout.background, 'themeColors'), false);
    assert.equal(THEME_COLOR_ROLES.length, 8);
    assert.equal(validateLayout(layout), true);
    assert.deepEqual(snapshotLayout(layout).background.themeColors, DEFAULT_THEME_COLORS);
    assert.equal(DEFAULT_THEME_COLORS['graph-grid-soft'], '#f6f8fb33');
    assert.equal(layoutsEqual(layout, snapshotLayout(layout)), true);
    layout.background.themeColors = {
        'graph-grid-subtle': '#123456', 'graph-grid-soft': '#456789', 'graph-base-soft': '#654321',
        'graph-label': '#abcdef', 'graph-label-soft': '#fedcba',
        'graph-trace': '#ffffff', 'text-primary': 'invalid'
    };
    const normalized = normalizeLayout(layout);
    assert.deepEqual(normalized.background.themeColors,
        { 'graph-base-soft': '#654321', 'graph-grid-subtle': '#123456', 'graph-grid-soft': '#456789',
            'graph-label': '#abcdef' });
    assert.equal(validateLayout(normalized), true);
    assert.equal(layoutsEqual(normalized, createDefaultLayout()), false);
    delete normalized.background.themeColors;
    assert.equal(Object.hasOwn(normalizeLayout(normalized).background, 'themeColors'), false);
    assert.equal(layoutsEqual(normalized, createDefaultLayout()), true);
    normalized.background.themeColors = { 'graph-grid-soft': '#12345633' };
    assert.equal(validateLayout(normalized), true);
    assert.equal(snapshotLayout(normalized).background.themeColors['graph-grid-soft'], '#12345633');
    assert.equal(validateLayout(snapshotLayout(normalized)), true);
});

test('system presets retain valid layouts for every aspect ratio', () => {
    let count = 0;
    const types = new Set();
    const names = ['Mastering Console', 'Spectral Studio', 'Harmony Lab', 'Phosphor Scope', 'Hi-Fi Deck', 'Vintage VU',
        'Now Playing', 'Neon Pulse', 'Phase Galaxy', 'Chroma Mandala'];
    // Featured designs ship only in the aspect ratios they were composed for, after the shared set.
    const featured = { '21:9': ['Fretboard', 'Power Amp'], '16:9': ['Power Amp', 'Beat Stage'], '4:3': [], '1:1': ['Round Dials'],
        '9:16': ['Fretboard', 'Round Dials', 'Beat Stage'] };
    for (const aspect of ASPECTS) {
        const presets = JSON.parse(readFileSync(new URL(`../../presets/visualizer/${ASPECT_FILES[aspect]}`, import.meta.url)));
        assert.deepEqual(Object.keys(presets), [...names, ...featured[aspect]]);
        const mastering = presets['Mastering Console'].items;
        const [right, left] = ['R', 'L'].map(channel => mastering.find(item => item.type === 'spectrum' && item.channel === channel));
        assert.deepEqual(left.rect, right.rect);
        assert.ok(mastering.some(item => item.type === 'level-meter' && item.params.showLevelValues));
        const nowPlaying = presets['Now Playing'].items;
        assert.equal(nowPlaying[0].type, 'artwork');
        assert.deepEqual(nowPlaying[0].rect, { x: 0, y: 0, w: 1, h: 1 });
        const [pulse, reflection] = presets['Neon Pulse'].items;
        assert.equal(reflection.flipY, true);
        const reflectionGap = reflection.rect.y - (pulse.rect.y + pulse.rect.h);
        assert.ok(reflectionGap >= 0 && reflectionGap < 0.01);
        for (const layout of Object.values(presets)) {
            count++;
            assert.equal(layout.aspect, aspect);
            assert.equal(validateLayout(layout), true);
            for (const item of layout.items) {
                types.add(item.type);
                for (const edge of [item.rect.x, item.rect.y, item.rect.x + item.rect.w, item.rect.y + item.rect.h]) {
                    assert.ok(edge >= 0 && edge <= 1 + 1e-9, `System preset ${aspect} ${item.type} leaves the frame: ${edge}`);
                }
            }
            assert.equal(layoutsEqual(layout, structuredClone(layout)), true);
            const edited = structuredClone(layout);
            edited.background.color = '#123456';
            assert.equal(layoutsEqual(layout, edited), false);
        }
    }
    assert.equal(count, 58);
    for (const type of ['spectrum', 'spectrogram', 'stereo', 'level-meter', 'analog-meter', 'notes', 'chroma', 'phase', 'guitar', 'rhythm-analyzer'])
        assert.equal(types.has(type), true);
});
