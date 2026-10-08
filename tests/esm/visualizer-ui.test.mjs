import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { VisualizerRenderer } from '../../js/visualizer/visualizer-renderer.js';
import { VisualizerHistory } from '../../js/visualizer/visualizer-history.js';
import { VisualizerPresetStore } from '../../js/visualizer/visualizer-preset-store.js';
import { createDefaultLayout, createItem, snapshotLayout, validateLayout } from '../../js/visualizer/visualizer-model.js';
import { UIManager } from '../../js/ui-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function classes(...initial) {
    const values = new Set(initial);
    return {
        contains: value => values.has(value),
        add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)),
        toggle(name, value) { if (value) values.add(name); else values.delete(name); }
    };
}

test('Layout shortcuts and paste belong to Visualizer controls and leave external dialog controls alone', async () => {
    const body = { classList: classes('view-visualizer') };
    const control = (tagName, type, inRoot = false) => ({ tagName, type, inRoot,
        matches: () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName) });
    await withGlobals({ document: { body } }, () => {
        const setup = () => {
            const saved = [], actions = [];
            const view = Object.assign(Object.create(VisualizerView.prototype), {
                root: { contains: target => target?.inRoot === true }, layout: createDefaultLayout(),
                history: new VisualizerHistory(), undoButton: {}, redoButton: {}, cutButton: {}, copyButton: {},
                stage: { style: {} }, sources: { setLayout() {} }, store: { saveCurrent: layout => saved.push(snapshotLayout(layout)) }
            });
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                view, open: true, selection: new Set(['main-spectrum']),
                render() {}, updateSelection() {},
                cutSelected: () => actions.push('cut'), copySelected: () => actions.push('copy')
            });
            view.editor = editor;
            view.recordHistory();
            const press = (target, key, modifiers = {}) => {
                let prevented = false;
                view.onEditKeyDown({ target, key, ...modifiers, preventDefault() { prevented = true; } });
                return prevented;
            };
            return { view, editor, saved, actions, press };
        };
        for (const target of [control('INPUT', 'checkbox'), control('BUTTON')]) {
            const { view, editor, saved, actions, press } = setup();
            const before = structuredClone(view.layout), history = structuredClone(view.history.entries);
            for (const key of ['Delete', 'Escape']) assert.equal(press(target, key), false);
            for (const modifier of ['ctrlKey', 'metaKey']) for (const key of ['z', 'y', 'a', 'x', 'c']) {
                assert.equal(press(target, key, { [modifier]: true }), false);
            }
            assert.equal(view.acceptsPaste({ target }), false);
            assert.deepEqual(view.layout, before);
            assert.deepEqual(view.history.entries, history);
            assert.equal(view.history.index, 0);
            assert.deepEqual([...editor.selection], ['main-spectrum']);
            assert.deepEqual(saved, []);
            assert.deepEqual(actions, []);
        }
        for (const target of [control('INPUT', 'range', true), control('SELECT', undefined, true),
            control('BUTTON', undefined, true), control('DIV', undefined, true), body]) {
            const { view, saved, press } = setup();
            assert.equal(press(target, 'Delete'), true);
            assert.equal(view.layout.items.length, 0);
            assert.equal(view.history.entries.length, 2);
            assert.equal(saved.length, 1);
            assert.equal(saved[0].items.length, 0);
        }
        for (const target of [control('INPUT', 'range', true), control('SELECT', undefined, true), control('BUTTON', undefined, true)]) {
            const { view, actions, press } = setup();
            view.stepHistory = direction => actions.push(direction);
            assert.equal(press(target, 'z', { ctrlKey: true }), true);
            assert.equal(press(target, 'y', { metaKey: true }), true);
            assert.deepEqual(actions, ['undo', 'redo']);
        }
        for (const target of [control('BUTTON', undefined, true), control('DIV', undefined, true), body]) {
            const { view, actions, press } = setup();
            assert.equal(press(target, 'a', { ctrlKey: true }), true);
            assert.equal(press(target, 'x', { ctrlKey: true }), true);
            assert.equal(press(target, 'c', { metaKey: true }), true);
            assert.equal(view.acceptsPaste({ target }), true);
            assert.deepEqual(actions, ['cut', 'copy']);
        }
    });
});

test('Notes and Chroma range edits preserve the requested endpoint for every selected item', async () => {
    await withGlobals({ window: {} }, () => {
        for (const [type, low, high, lowLabel, highLabel, cases] of [
            ['notes', 'mn', 'mx', 'Lowest note', 'Highest note', [
                ['high', [28, 91], [100, 108], 80, [28, 80], [80, 80]],
                ['low', [28, 91], [21, 40], 80, [80, 91], [80, 80]],
                ['high', [100, 108], [28, 91], 80, [80, 80], [28, 80]],
                ['low', [21, 40], [28, 91], 80, [80, 80], [80, 91]]
            ]],
            ['chroma', 'lo', 'hi', 'Lowest Octave', 'Highest Octave', [
                ['high', [1, 7], [8, 9], 6, [1, 6], [6, 6]],
                ['low', [1, 7], [1, 2], 6, [6, 7], [6, 6]],
                ['high', [8, 9], [1, 7], 6, [6, 6], [1, 6]],
                ['low', [1, 2], [1, 7], 6, [6, 6], [6, 7]]
            ]],
            ['rhythm-analyzer', 'mn', 'mx', 'Min BPM', 'Max BPM', [
                ['high', [40, 240], [150, 240], 100, [40, 100], [80, 100]],
                ['low', [40, 180], [40, 50], 180, [180, 225], [180, 225]]
            ]]
        ]) for (const [endpoint, firstRange, otherRange, value, expectedFirst, expectedOther] of cases) {
            for (const multiple of [false, true]) {
                const first = createItem(type, 'first'), other = createItem(type, 'other');
                [first.params[low], first.params[high]] = firstRange;
                [other.params[low], other.params[high]] = otherRange;
                const layout = { ...createDefaultLayout(), items: [first, other] }, fields = new Map(), saved = [];
                const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                    selection: new Set(multiple ? ['first', 'other'] : ['first']),
                    view: { layout, changed() { saved.push(snapshotLayout(layout)); } },
                    t: (_key, fallback) => fallback,
                    field(_parent, label, _kind, current, change) {
                        const field = { value: current, change };
                        fields.set(label, field); return field;
                    },
                    syncRangeField(input, value) { input.value = value; },
                    updateSelection() {}
                });
                editor.takeBaseline();
                editor.parameters({}, first);
                fields.get(endpoint === 'low' ? lowLabel : highLabel).change(value);
                assert.deepEqual([first.params[low], first.params[high]], expectedFirst, `${type} first ${endpoint}`);
                assert.deepEqual([other.params[low], other.params[high]], multiple ? expectedOther : otherRange, `${type} target ${endpoint}`);
                assert.equal(validateLayout(layout), true);
                assert.deepEqual(saved[0].items.map(item => item.params), layout.items.map(item => item.params), 'Saving preserves both ranges');
            }
        }
    });
});

test('Gradient controls rotate each linear basis and keep its angle while radial colors hide it', async () => {
    await withGlobals({ document: { createElement: () => ({ appendChild() {}, setAttribute() {} }) } }, () => {
        const fields = [], changes = [];
        const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
            t: (_key, fallback) => fallback,
            group: () => ({ appendChild() {} }),
            field(_parent, label, type, value, change, options) {
                fields.push({ label, type, value, change, options }); return { value };
            },
            button: () => ({ setAttribute() {} }),
            changed: render => changes.push(render)
        });
        const render = item => { fields.length = 0; editor.palette({}, item.palette, item.type); };
        for (const type of ['spectrum', 'spectrogram', 'notes', 'chroma', 'phase']) {
            const item = createItem(type, type);
            render(item);
            assert.equal(fields.some(field => field.label === 'Gradient direction'), false);
            item.palette.mode = 'gradient';
            item.palette.mapping = 'octave';
            render(item);
            const direction = fields.find(field => field.label === 'Gradient direction');
            assert.equal(direction.type, 'radio');
            assert.equal(direction.value, 'frequency');
            assert.deepEqual(direction.options.values, [['frequency', 'Frequency'], ['intensity', 'Intensity'], ['radial', 'Radial']]);
            const angle = fields.find(field => field.label === 'Gradient angle (°)');
            assert.equal(angle.value, 0);
            assert.equal(angle.options.min, -180);
            assert.equal(angle.options.max, 180);
            angle.change(45);
            assert.equal(item.palette.angle, 45);
            direction.change('intensity');
            render(item);
            assert.equal(fields.find(field => field.label === 'Gradient direction').value, 'intensity');
            assert.equal(fields.some(field => field.label === 'Color mapping'), false);
            assert.equal(fields.find(field => field.label === 'Gradient angle (°)').value, 45);
            assert.equal(item.palette.mapping, 'octave');
            fields.find(field => field.label === 'Gradient direction').change('radial');
            render(item);
            assert.equal(fields.some(field => field.label === 'Color mapping'), false);
            assert.equal(fields.some(field => field.label === 'Gradient angle (°)'), false);
            assert.equal(item.palette.angle, 45);
            assert.equal(item.palette.mapping, 'octave');
            fields.find(field => field.label === 'Gradient direction').change('frequency');
            render(item);
            assert.equal(fields.some(field => field.label === 'Color mapping'), type === 'notes' || type === 'chroma');
            assert.equal(item.palette.mapping, 'octave');
        }
        for (const type of ['oscilloscope', 'stereo', 'level-meter', 'analog-meter', 'rhythm-analyzer', 'title', 'album', 'artist', 'text', 'shape']) {
            const item = createItem(type, type); render(item);
            fields.find(field => field.label === 'Color mode').change('gradient'); render(item);
            const direction = fields.find(field => field.label === 'Gradient direction');
            assert.equal(direction.value, 'linear');
            assert.deepEqual(direction.options.values, [['linear', 'Linear'], ['radial', 'Radial']]);
            fields.find(field => field.label === 'Gradient angle (°)').change(-90);
            assert.equal(item.palette.angle, -90);
            assert.equal(changes.at(-1), undefined, 'Angle updates keep the inspector controls in place');
            direction.change('radial'); render(item);
            assert.equal(fields.some(field => field.label === 'Gradient angle (°)'), false);
            assert.equal(item.palette.angle, -90);
            fields.find(field => field.label === 'Gradient direction').change('linear'); render(item);
            assert.equal(fields.find(field => field.label === 'Gradient angle (°)').value, -90);
        }
        fields.length = 0;
        editor.palette({}, createItem('spectrum').palette);
        assert.equal(fields.some(field => field.label === 'Gradient direction'), false, 'Effects keep their own palettes');
        assert.equal(fields.some(field => field.label === 'Gradient angle (°)'), false);
    });
});

test('Reverse gradient reflects custom stop positions and preserves motion for items and effects', async () => {
    await withGlobals({ document: { createElement: () => ({ appendChild() {} }) } }, () => {
        for (const itemType of ['spectrum', null]) {
            const palette = { mode: 'gradient', direction: 'radial', stops: [
                { pos: 0, color: '#000000' }, { pos: .2, color: '#ff0000' },
                { pos: .6, color: '#00ff00' }, { pos: .6, color: '#0000ff' }, { pos: .9, color: '#ffffff' }
            ], motion: { mode: 'scroll', speed: .75, reverse: true } };
            const actions = new Map(), changes = [];
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                t: (_key, fallback) => fallback, group: () => ({ appendChild() {} }),
                field: () => ({ value: 'gold' }),
                button(_parent, label, action) { actions.set(label, action); return { setAttribute() {} }; },
                changed: structural => changes.push(structural)
            });
            editor.palette({}, palette, itemType);
            actions.get('Reverse gradient')();
            assert.deepEqual(palette.stops, [
                { pos: .1, color: '#ffffff' }, { pos: .4, color: '#0000ff' },
                { pos: .4, color: '#00ff00' }, { pos: .8, color: '#ff0000' }, { pos: 1, color: '#000000' }
            ]);
            assert.deepEqual(palette.motion, { mode: 'scroll', speed: .75, reverse: true });
            assert.equal(palette.direction, 'radial');
            assert.deepEqual(changes, [true]);
        }
    });
});

test('Hue and Scroll share a reversal setting without changing speed or gradient stops', async () => {
    await withGlobals({ document: { createElement: () => ({ appendChild() {} }) } }, () => {
        for (const itemType of ['spectrum', null]) {
            const palette = createItem('spectrum').palette;
            palette.mode = 'gradient';
            const stops = structuredClone(palette.stops), fields = new Map();
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                t: (_key, fallback) => fallback, group: () => ({ appendChild() {} }),
                field(_parent, label, type, value, change) {
                    fields.set(label, { type, value, change }); return { value };
                },
                button: () => ({ setAttribute() {} }), changed() {}
            });
            const render = () => { fields.clear(); editor.palette({}, palette, itemType); };
            render();
            assert.equal(fields.has('Reverse color motion'), false);
            fields.get('Color motion').change('hue'); render();
            assert.equal(fields.get('Reverse color motion').type, 'checkbox');
            assert.equal(fields.get('Reverse color motion').value, false);
            fields.get('Reverse color motion').change(true);
            fields.get('Color motion').change('scroll'); render();
            assert.equal(fields.get('Reverse color motion').value, true);
            fields.get('Color motion').change('none'); render();
            assert.equal(fields.has('Reverse color motion'), false);
            fields.get('Color motion').change('hue'); render();
            assert.equal(fields.get('Reverse color motion').value, true);
            fields.get('Reverse color motion').change(false);
            assert.deepEqual(palette.motion, { mode: 'hue', speed: .25, reverse: false });
            assert.deepEqual(palette.stops, stops);
        }
    });
});

test('Phase Map edits its axis, level range, reference floor, and persistence without an input gain', () => {
    const fields = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (_key, fallback) => fallback,
        field(_parent, label, type, value, change, options) { fields.push({ label, type, value, change, options }); },
        changed() {}
    });
    const item = createItem('phase', 'phase');
    editor.parameters({}, item);
    assert.deepEqual(fields.map(field => field.label),
        ['X Axis', 'DB Range', 'Reference Floor', 'Persistence', 'Axes and grid', 'Axis labels and numbers']);
    const [axis, range, floor, persistence] = fields;
    assert.deepEqual(axis.options.values, [['phase', 'Phase'], ['balance', 'Balance']]);
    assert.deepEqual([range.options.min, range.options.max, range.options.step], [-96, -24, 6]);
    assert.deepEqual([floor.value, floor.options.min, floor.options.max, floor.options.step], [-40, -120, -24, 1]);
    assert.deepEqual([persistence.options.min, persistence.options.max, persistence.options.step], [0.1, 2, 0.1]);
    assert.equal(persistence.options.unit, 's');
    axis.change('balance');
    assert.equal(item.params.ax, 'balance');
});

test('Rhythm Analyzer edits its tempo range and span', () => {
    const fields = [], changes = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (key, fallback) => fallback,
        field(_parent, label, type, value, change, options) { fields.push({ label, type, value, change, options }); },
        changed: render => changes.push(render)
    });
    const item = createItem('rhythm-analyzer', 'rhythm');
    editor.parameters({}, item);
    assert.deepEqual(fields.map(field => field.label), ['Min BPM', 'Max BPM', 'Span (beats)',
        'Beat', 'BPM', 'Tempogram', 'Timing lanes', 'Echo rows', 'Beat lens',
        'Axes and grid', 'Axis labels and numbers']);
    const [minimum, maximum, span, beat, bpm, tempogram, timingLanes, echoRows, beatLens] = fields;
    assert.deepEqual([minimum.options.min, minimum.options.max, maximum.options.min, maximum.options.max], [40, 192, 50, 240]);
    assert.equal(maximum.options.unit, 'BPM');
    assert.deepEqual(span.options.values.map(([value]) => value), ['4', '6', '8', '12', '16']);
    span.change('12');
    assert.equal(item.params.sp, 12);
    assert.deepEqual(changes, [false], 'Span does not rebuild the panel');

    assert.deepEqual([tempogram.type, timingLanes.type, echoRows.type, beatLens.type],
        ['checkbox', 'checkbox', 'checkbox', 'checkbox']);
    assert.deepEqual([tempogram.value, timingLanes.value, echoRows.value, beatLens.value], [false, true, false, true]);
    assert.deepEqual([beat.type, bpm.type, beat.value, bpm.value], ['checkbox', 'checkbox', true, true]);
    beat.change(false);
    bpm.change(false);
    assert.deepEqual([item.params.showBeat, item.params.showBpm], [false, false]);
    tempogram.change(true);
    timingLanes.change(false);
    echoRows.change(true);
    beatLens.change(false);
    assert.deepEqual([item.params.vt, item.params.vm, item.params.ve, item.params.vl], [true, false, true, false]);
    assert.deepEqual(changes, [false, false, false, false, false, false, false], 'Panel toggles do not rebuild the panel');
});

test('Rhythm Analyzer circle settings edit size, border, opacity, colors and BPM fitting', () => {
    const fields = [], changes = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (_key, fallback) => fallback,
        group: (_parent, label) => label,
        field(parent, label, type, value, change, options) { fields.push({ parent, label, type, value, change, options }); },
        changed: render => changes.push(render)
    });
    const item = createItem('rhythm-analyzer', 'rhythm');
    editor.textStyle({}, item.style, item.type);
    const circle = fields.filter(field => field.parent === 'Beat circle');
    assert.deepEqual(circle.map(field => field.label), ['Circle size', 'Border width', 'Fill opacity', 'Beat hold time', 'Beat decay time', 'Border opacity',
        'Use palette colors', 'Fill color', 'Border color', 'Fit BPM inside circle']);
    assert.equal(circle[0].options.unit, '%');
    assert.deepEqual([circle[2].options.unit, circle[2].options.scale], ['%', 100]);
    assert.equal(circle[3].options.unit, 'ms');
    assert.equal(circle[4].options.unit, 'ms');
    assert.equal(circle[7].options.disabled, true);
    circle[0].change(60);
    circle[1].change(4);
    circle[2].change(.5);
    circle[3].change(50);
    circle[4].change(200);
    circle[5].change(.7);
    circle[6].change(false);
    circle[7].change('#123456');
    circle[8].change('#abcdef');
    circle[9].change(false);
    assert.deepEqual([item.style.beatSize, item.style.beatLineWidth, item.style.beatFillOpacity, item.style.beatStrokeOpacity,
        item.style.beatUsePalette, item.style.beatFillColor, item.style.beatStrokeColor, item.style.beatFitBpm, item.style.beatHoldTime, item.style.beatDecayTime],
    [60, 4, .5, .7, false, '#123456', '#abcdef', false, 50, 200]);
    assert.equal(changes[6], true, 'Changing palette use refreshes the color controls');
    fields.length = 0;
    editor.textStyle({}, item.style, item.type);
    assert.equal(fields.find(field => field.label === 'Fill color').options.disabled, false);
});

test('Rhythm Analyzer beat lens checkbox uses a distinct label key from the Notes volume checkbox', () => {
    const seenKeys = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (key, fallback) => { seenKeys.push(key); return fallback; },
        field(_parent, label, type, value, change, options) { this.fields = this.fields || []; this.fields.push({ label, type, value, change, options }); },
        changed() {}
    });
    const item = createItem('rhythm-analyzer', 'rhythm');
    editor.parameters({}, item);
    assert.ok(seenKeys.includes('visualizer.param.beatLens'), 'lens checkbox must use the beatLens label key');
    assert.ok(!seenKeys.includes('visualizer.param.vl'), 'lens checkbox must not reuse the vl label key (Notes Volume)');
});

test('Fall time, smoothing, and the Peak toggle appear per type and hide Peak Hold/Fall Time when Peak is off', async () => {
    await withGlobals({ window: {} }, () => {
    const fields = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (_key, fallback) => fallback,
        field(_parent, label, type, value, change, options) { fields.push({ label, type, value, change, options }); },
        group: () => ({}),
        changed() {}
    });
    const render = item => { fields.length = 0; editor.parameters({}, item); };

    const spectrum = createItem('spectrum', 'spectrum');
    render(spectrum);
    assert.ok(fields.some(field => field.label === 'Smoothing'));
    assert.ok(fields.some(field => field.label === 'Fall Time'));
    assert.ok(fields.some(field => field.label === 'Peak'));
    assert.ok(fields.some(field => field.label === 'Peak Hold'));
    assert.ok(fields.some(field => field.label === 'Peak Fall Time'));
    fields.find(field => field.label === 'Peak').change(false);
    assert.equal(spectrum.params.pk, false);
    render(spectrum);
    assert.equal(fields.some(field => field.label === 'Peak Hold'), false);
    assert.equal(fields.some(field => field.label === 'Peak Fall Time'), false);

    const levelMeter = createItem('level-meter', 'level-meter');
    render(levelMeter);
    assert.ok(fields.some(field => field.label === 'Fall Time'));
    assert.ok(fields.some(field => field.label === 'Peak'));
    assert.ok(fields.some(field => field.label === 'Peak Hold'));
    assert.ok(fields.some(field => field.label === 'Peak Fall Time'));
    fields.find(field => field.label === 'Peak').change(false);
    render(levelMeter);
    assert.equal(fields.some(field => field.label === 'Peak Hold'), false);
    assert.equal(fields.some(field => field.label === 'Peak Fall Time'), false);

    const stereo = createItem('stereo', 'stereo');
    render(stereo);
    assert.ok(fields.some(field => field.label === 'Peak'));
    assert.ok(fields.some(field => field.label === 'Peak Hold'));
    assert.ok(fields.some(field => field.label === 'Peak Fall Time'));
    assert.equal(fields.some(field => field.label === 'Fall Time'), false);
    assert.equal(fields.some(field => field.label === 'Smoothing'), false);

    const chroma = createItem('chroma', 'chroma');
    render(chroma);
    assert.ok(fields.some(field => field.label === 'Fall Time'));
    assert.equal(fields.some(field => field.label === 'Peak'), false);

    for (const multiple of [false, true]) {
        const analogMeter = createItem('analog-meter', 'analog-meter');
        const otherMeter = createItem('analog-meter', 'other-meter');
        Object.assign(editor, {
            selection: new Set(multiple ? [analogMeter.id, otherMeter.id] : [analogMeter.id]),
            view: { layout: { items: [analogMeter, otherMeter] }, changed() {} },
            changed: VisualizerEditor.prototype.changed,
            render: () => render(analogMeter),
            updateSelection() {}
        });
        editor.takeBaseline();
        render(analogMeter);
        assert.equal(fields.some(field => field.label === 'Peak'), false, 'Analog Meter uses Peak Hold = 0 as its off switch instead');
        assert.equal(fields.some(field => field.label === 'Arrow tip aspect ratio'), false);
        const hub = fields.find(field => field.label === 'Pivot hub size');
        assert.equal(hub.type, 'range');
        assert.equal(hub.options.min, 0);
        hub.change(0);
        assert.equal(analogMeter.params.hubSize, 0);
        fields.find(field => field.label === 'Needle tip').change('arrow');
        assert.equal(analogMeter.params.needleTip, 'arrow');
        assert.equal(otherMeter.params.needleTip, multiple ? 'arrow' : 'line');
        assert.ok(fields.some(field => field.label === 'Arrow tip aspect ratio'), 'Selecting Arrow immediately shows its aspect ratio');
        fields.find(field => field.label === 'Arrow tip aspect ratio').change(2.5);
        assert.equal(analogMeter.params.arrowAspect, 2.5);
        if (multiple) assert.equal(otherMeter.params.arrowAspect, 2.5);
        for (const tip of ['taper', 'line']) {
            fields.find(field => field.label === 'Needle tip').change(tip);
            assert.equal(analogMeter.params.needleTip, tip);
            assert.equal(otherMeter.params.needleTip, multiple ? tip : 'line');
            assert.equal(fields.some(field => field.label === 'Arrow tip aspect ratio'), false, 'Leaving Arrow immediately hides its aspect ratio');
            fields.find(field => field.label === 'Needle tip').change('arrow');
            assert.ok(fields.some(field => field.label === 'Arrow tip aspect ratio'));
        }
    }
    });
});

test('The Graph scale slider updates the layout and is undoable', async () => {
    await withGlobals({ document: { createElement: () => ({ appendChild() {}, setAttribute() {}, classList: { add() {}, toggle() {} } }) } }, () => {
        const fields = [], changes = [];
        const layout = createDefaultLayout();
        const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
            t: (_key, fallback) => fallback,
            group: () => ({ appendChild() {}, classList: { add() {}, toggle() {} } }),
            field(_parent, label, type, value, change, options) {
                fields.push({ label, type, value, change, options }); return { value, disabled: false };
            },
            button: () => ({ setAttribute() {}, classList: { add() {}, toggle() {} } }),
            changed: () => changes.push(true),
            navigationContent: { replaceChildren() {} },
            root: { replaceChildren() {}, appendChild() {} },
            view: { layout },
            selection: new Set(),
            gridDivisions: 0
        });
        editor.render();
        const scale = fields.find(field => field.label === 'Graph scale');
        assert.ok(scale, 'Graph scale field is present');
        assert.equal(scale.type, 'range');
        assert.equal(scale.value, 1);
        assert.deepEqual([scale.options.min, scale.options.max, scale.options.step], [0.5, 3, 0.05]);
        assert.equal(scale.options.unit, '×');
        scale.change(2);
        assert.equal(layout.graphScale, 2);
        assert.deepEqual(changes, [true]);
    });
});

test('Static background and artwork reuse layers without copying image data each frame', async () => {
    const context = { clearRect() {}, save() {}, translate() {}, scale() {}, drawImage() {}, restore() {} };
    const canvas = { width: 1280, height: 720, getContext: () => context };
    const layout = createDefaultLayout();
    layout.background.image = `data:image/jpeg;base64,${'a'.repeat(2 * 1024 * 1024)}`;
    layout.items = [createItem('artwork', 'art'), createItem('title', 'title')];
    const metadata = { title: 'First', artwork: [{ src: `data:image/jpeg;base64,${'b'.repeat(2 * 1024 * 1024)}` }] };
    const sources = { getModulators: () => ({ level: 0, bass: 0 }), getFrame: () => null };
    const renderer = new VisualizerRenderer(canvas);
    const images = new Map([[layout.background.image, {}], [metadata.artwork[0].src, {}]]);
    renderer.image = url => images.get(url) || null;
    const drawn = [];
    renderer.drawItem = (_state, item) => drawn.push(item.id);
    await withGlobals({ document: { createElement: () => ({ width: 1, height: 1, getContext: () => context }) } }, () => {
        renderer.draw(layout, sources, metadata, 0);
        renderer.draw(layout, sources, structuredClone(metadata), 1);
        assert.deepEqual(drawn, ['background', 'art', 'title']);
        for (const state of renderer.layers.values()) assert.ok(state.signature.length < 2048);
        metadata.title = 'Second';
        renderer.draw(layout, sources, metadata, 2);
        assert.equal(drawn.at(-1), 'title');
        assert.equal(drawn.length, 4);
        metadata.artwork[0].src = 'file:///new-cover.jpg';
        images.set(metadata.artwork[0].src, {});
        renderer.draw(layout, sources, metadata, 3);
        assert.equal(drawn.at(-1), 'art');
        assert.equal(drawn.length, 5);
    });
});

test('Missing artwork hides its decorations and returns only after an image loads', async () => {
    const composed = [];
    const context = { clearRect() {}, save() {}, translate() {}, scale() {}, restore() {},
        fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, clip() {}, drawImage() {} };
    const stage = { width: 1280, height: 720, getContext: () => ({ ...context, drawImage: image => composed.push(image) }) };
    const layout = createDefaultLayout();
    const artwork = createItem('artwork', 'art');
    artwork.effects = ['flash', 'trail'].map(type => ({ type, enabled: true, amount: .5,
        palette: artwork.palette, mod: { source: 'none', depth: 0, speed: 0 } }));
    layout.items = [artwork];
    const sources = { getModulators: () => ({}), getFrame: () => null };
    const renderer = new VisualizerRenderer(stage), applied = [];
    const apply = renderer.effects.apply.bind(renderer.effects);
    renderer.effects.apply = (...args) => { applied.push(args[0]); return apply(...args); };
    class ArtworkImage { complete = false; naturalWidth = 0; naturalHeight = 0; }
    await withGlobals({ Image: ArtworkImage, document: { createElement: () => ({ getContext: () => context }) } }, () => {
        const draw = (metadata, visible) => {
            composed.length = 0; applied.length = 0;
            renderer.draw(layout, sources, metadata, 1, { editing: true });
            assert.deepEqual(applied, visible ? ['background', 'art'] : ['background']);
            assert.equal(composed.length, visible ? 2 : 1);
            assert.equal(renderer.layers.has('art'), visible);
            assert.equal(renderer.effects.states.has('art'), visible);
        };
        draw(null, false);
        const metadata = { artwork: [{ src: 'cover-a' }] };
        draw(metadata, false);
        const first = renderer.images.get('cover-a');
        Object.assign(first, { complete: true, naturalWidth: 100, naturalHeight: 100 });
        draw(metadata, true);
        const oldHistory = renderer.effects.states.get('art');
        assert.equal(oldHistory.history.size, 1);
        draw({ artwork: [] }, false);
        assert.equal(renderer.images.has('cover-a'), false);
        metadata.artwork[0].src = 'cover-b';
        draw(metadata, false);
        const second = renderer.images.get('cover-b');
        second.complete = true;
        draw(metadata, false); // Failed images complete with no natural dimensions.
        Object.assign(second, { naturalWidth: 100, naturalHeight: 100 });
        draw(metadata, true);
        assert.notEqual(renderer.effects.states.get('art'), oldHistory);
        metadata.artwork[0].src = 'cover-c';
        draw(metadata, false);
    });
});

test('Glow margins extend beyond the item while final placement keeps its center and flips', async () => {
    const draws = [], translations = [], scales = [];
    const context = { clearRect() {}, save() {}, restore() {},
        translate: (...args) => translations.push(args), scale: (...args) => scales.push(args),
        drawImage: (...args) => draws.push(args) };
    const stage = { width: 1280, height: 720, getContext: () => context };
    const layout = createDefaultLayout(), item = createItem('title', 'title');
    item.rect = { x: .2, y: .1, w: .25, h: .5 }; item.flipX = item.flipY = true;
    layout.items = [item];
    const sources = { getModulators: () => ({}), getFrame: () => null };
    const renderer = new VisualizerRenderer(stage);
    renderer.drawItem = () => {};
    let padding = true;
    renderer.effects.apply = (id, canvas) => ({ canvas, opacity: 1, scale: 1.2, x: .1, y: -.1,
        ...(id === item.id && padding ? { paddingX: 20 * stage.width / 1280, paddingY: 10 * stage.height / 720 } : {}) });
    await withGlobals({ document: { createElement: () => ({ getContext: () => context }) } }, () => {
        for (const pixelRatio of [1, 2]) {
            stage.width = 1280 * pixelRatio; stage.height = 720 * pixelRatio;
            for (const quality of ['high', 'low']) {
                for (padding of [true, false]) {
                    renderer.draw(layout, sources, { title: 'Track' }, 1, { quality });
                    const width = 320 * pixelRatio, height = 360 * pixelRatio;
                    const px = padding ? 20 * pixelRatio : 0, py = padding ? 10 * pixelRatio : 0;
                    assert.deepEqual(draws.at(-1).slice(1), [-width / 2 - px, -height / 2 - py, width + 2 * px, height + 2 * py]);
                    assert.equal(renderer.layers.get(item.id).canvas.width, width);
                    assert.equal(renderer.layers.get(item.id).canvas.height, height);
                    assert.ok(Math.abs(translations.at(-1)[0] - .325 * stage.width) < 1e-9);
                    assert.ok(Math.abs(translations.at(-1)[1] - .35 * stage.height) < 1e-9);
                    assert.deepEqual(scales.at(-1), [-1, -1]);
                }
            }
        }
    });
});

test('Visualizer dragging and corner resizing use artboard coordinates under body zoom', () => {
    const item = { rect: { x: .1, y: .2, w: .4, h: .3 } };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 500 }) } },
        gridDivisions: 40, changed() {}
    });
    editor.beginDrag(item, [item], { x: .1, y: .2 });
    editor.drag({ clientX: 400, clientY: 300 });
    assert.deepEqual(item.rect, { x: .3, y: .5, w: .4, h: .3 });
    editor.beginDrag(item, [item], { x: .7, y: .8 }, 'se');
    editor.drag({ clientX: 2100, clientY: 1050 });
    assert.equal(item.rect.x + item.rect.w, 1.3);
    assert.equal(item.rect.y + item.rect.h, 1.5);
});

test('Visualizer side handles snap the moved edge while keeping the opposite edge fixed', () => {
    const item = { rect: { x: .103, y: .207, w: .397, h: .293 } };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) } },
        gridDivisions: 40, changed() {}
    });
    for (const [side, moved, expected] of [
        ['n', 'top', .275], ['e', 'right', .55], ['s', 'bottom', .55], ['w', 'left', .175]
    ]) {
        const before = { x: .103, y: .207, w: .397, h: .293 };
        item.rect = { ...before };
        editor.beginDrag(item, [item], { x: 0, y: 0 }, side);
        editor.drag({ clientX: 60, clientY: 60 });
        const edge = { left: item.rect.x, top: item.rect.y,
            right: item.rect.x + item.rect.w, bottom: item.rect.y + item.rect.h };
        assert.ok(Math.abs(edge[moved] - expected) < 1e-9, side);
        for (const fixed of side === 'n' || side === 's' ? ['left', 'right', side === 'n' ? 'bottom' : 'top'] :
            ['top', 'bottom', side === 'e' ? 'left' : 'right']) {
            const original = { left: before.x, top: before.y, right: before.x + before.w, bottom: before.y + before.h };
            assert.ok(Math.abs(edge[fixed] - original[fixed]) < 1e-9, `${side} moved ${fixed}`);
        }
    }
});

test('Visualizer snapping follows the selected grid division and Alt places items freely', () => {
    const item = { rect: { x: .1, y: .1, w: .2, h: .2 } };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) } },
        gridDivisions: 8, changed() {}
    });
    const drag = (corner, altKey = false) => {
        item.rect = { x: .1, y: .1, w: .2, h: .2 };
        editor.beginDrag(item, [item], { x: 0, y: 0 }, corner);
        editor.drag({ clientX: 53, clientY: 53, altKey });
    };
    drag(null);
    assert.deepEqual([item.rect.x, item.rect.y], [.125, .125]);
    drag(null, true);
    assert.ok(Math.abs(item.rect.x - .153) < 1e-9 && Math.abs(item.rect.y - .153) < 1e-9);
    drag('se', true);
    assert.ok(Math.abs(item.rect.x + item.rect.w - .353) < 1e-9);
    assert.equal(editor.gridStep(), 1 / 8);
});

test('Title, album, and artist use their saved font family, bold, and italic on Canvas', () => {
    const font = [];
    const context = { clearRect() {}, save() {}, restore() {}, createLinearGradient: () => ({ addColorStop() {} }),
        fillText() { font.push(this.font); } };
    const renderer = new VisualizerRenderer({ width: 1280 });
    const state = { canvas: { width: 320, height: 80, getContext: () => context } };
    for (const type of ['title', 'album', 'artist']) {
        const item = createItem(type, type);
        item.style = { ...item.style, fontFamily: 'Georgia, "Times New Roman", serif', bold: true, italic: true };
        renderer.drawItem(state, item, { [type]: 'Text' }, null, 0, false);
    }
    assert.deepEqual(font, Array(3).fill('italic bold 36px Georgia, "Times New Roman", serif'));
    const plain = createItem('title', 'plain');
    renderer.drawItem(state, plain, { title: 'Text' }, null, 0, false);
    assert.equal(font.at(-1), '36px sans-serif');
});

test('Text outline casts the shadow once and the fill sits on top inside the item box', () => {
    const calls = [];
    const context = { clearRect() {}, save() {}, restore() {},
        strokeText(text, x, y) { calls.push(['stroke', text, x, y, this.lineWidth, this.shadowColor, this.textBaseline]); },
        fillText(text, x, y) { calls.push(['fill', text, x, y, this.shadowColor]); } };
    const renderer = new VisualizerRenderer({ width: 640 });
    const item = createItem('title', 'decorated');
    item.style = { ...item.style, align: 'right', verticalAlign: 'bottom', textCase: 'upper',
        outlineWidth: 4, shadowColor: '#000000', shadowOpacity: 1, shadowY: 2 };
    renderer.drawItem({ canvas: { width: 320, height: 80, getContext: () => context } }, item, { title: 'Text' }, null, 0, false);
    assert.deepEqual(calls, [['stroke', 'TEXT', 318, 78, 4, '#000000ff', 'bottom'], ['fill', 'TEXT', 318, 78, 'transparent']]);
});

test('Stage arrow keys move the selected item by one grid step beyond the canvas edges', () => {
    const stage = {}, item = createItem('spectrum', 'move');
    item.rect = { x: .103, y: .2, w: .4, h: .3 };
    let changes = 0;
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        open: true, selection: new Set([item.id]), view: { stage, layout: { items: [item] } },
        changed() { changes++; }
    });
    const press = (key, target = stage, modifiers = {}) => {
        let prevented = false;
        editor.onStageKeyDown({ key, target, ...modifiers, preventDefault() { prevented = true; } });
        return prevented;
    };
    assert.equal(press('ArrowRight'), true);
    assert.equal(item.rect.x, .128);
    assert.equal(press('ArrowUp'), true);
    assert.equal(item.rect.y, .175);
    assert.equal(press('ArrowRight', {}), false);
    assert.equal(press('ArrowRight', stage, { ctrlKey: true }), false);
    assert.equal(changes, 2);
    item.rect.x = .59;
    press('ArrowRight'); press('ArrowRight');
    assert.equal(item.rect.x, .64);
    editor.open = false;
    assert.equal(press('ArrowLeft'), false);
    assert.equal(changes, 4);
});

test('Stage Ctrl+D duplicates a selected item above it with independent settings', () => {
    const stage = {}, source = createItem('spectrum', 'source'), upper = createItem('title', 'upper');
    source.rect = { x: .1, y: .2, w: .4, h: .3 };
    source.effects = [{ type: 'glow', palette: { stops: [{ pos: 0, color: '#123456' }] } }];
    const items = [source, upper];
    let changes = 0, prevented = 0;
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        open: true, selection: new Set([source.id]), view: { stage, layout: { items } },
        changed() { changes++; }
    });
    const press = (target, modifiers = {}) => editor.onStageKeyDown({ key: 'd', target, ...modifiers,
        preventDefault() { prevented++; }, stopPropagation() {} });
    press({}, { ctrlKey: true });
    assert.equal(items.length, 2);
    press(stage, { ctrlKey: true });
    const copy = items[1];
    assert.equal(prevented, 1);
    assert.equal(changes, 1);
    assert.deepEqual(items.map(item => item.id), [source.id, copy.id, upper.id]);
    assert.notEqual(copy.id, source.id);
    assert.deepEqual([copy.rect.x, copy.rect.y], [.125, .225]);
    copy.palette.stops[0].color = '#abcdef';
    copy.params.pt = 8;
    copy.effects[0].palette.stops[0].color = '#ffffff';
    assert.notEqual(copy.palette.stops[0].color, source.palette.stops[0].color);
    assert.notEqual(copy.params.pt, source.params.pt);
    assert.notEqual(copy.effects[0].palette.stops[0].color, source.effects[0].palette.stops[0].color);
    editor.selection = new Set([source.id]); source.rect.x = .6;
    press(stage, { metaKey: true });
    assert.equal(items[1].rect.x, .625);
});

test('Alt body drag duplicates once on movement and resize handles keep the original', () => {
    const source = createItem('spectrum', 'source');
    source.rect = { x: .1, y: .1, w: .4, h: .4 };
    const items = [source];
    const stage = { dataset: {}, closest: () => null, focus() {}, setPointerCapture() {} };
    let changes = 0;
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        open: true, selection: new Set([source.id]), gridDivisions: 0,
        view: { stage, layout: { items }, commitPending() {}, canvas: { getBoundingClientRect: () =>
            ({ left: 0, top: 0, width: 1000, height: 1000 }) } },
        render() {}, updateSelection() {}, changed() { changes++; }
    });
    const down = target => editor.startDrag({ target, altKey: true, clientX: 150, clientY: 150,
        pointerId: 1, preventDefault() {} });
    down(stage); editor.endDrag();
    assert.equal(items.length, 1);
    down(stage);
    editor.drag({ clientX: 200, clientY: 175 });
    editor.drag({ clientX: 225, clientY: 175 });
    assert.equal(items.length, 2);
    assert.deepEqual(source.rect, { x: .1, y: .1, w: .4, h: .4 });
    assert.ok(Math.abs(items[1].rect.x - .175) < 1e-9 && Math.abs(items[1].rect.y - .125) < 1e-9);
    assert.deepEqual([...editor.selection], [items[1].id]);
    assert.equal(changes, 3);
    editor.endDrag();
    editor.selection = new Set([source.id]);
    down({ dataset: { corner: 'e' }, closest: () => null });
    editor.drag({ clientX: 175, clientY: 150 });
    assert.equal(items.length, 2);
    assert.ok(Math.abs(source.rect.w - .425) < 1e-9);
});

test('Editing shows every item boundary and keeps the selected boundary in sync with movement', async () => {
    const element = () => ({
        children: [], style: {}, dataset: {}, classList: classes(),
        appendChild(child) { this.children.push(child); },
        replaceChildren(...children) { this.children = children; },
        addEventListener() {}, setAttribute() {}
    });
    const layout = createDefaultLayout();
    layout.items = [createItem('artwork', 'empty-art'), createItem('title', 'title')];
    const title = layout.items[1];
    title.rect = { x: .1, y: .2, w: .3, h: .2 };
    const view = { layout, stage: element(), root: element(), changed() {}, commitPending() {}, updateEditButtons() {},
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) } };
    await withGlobals({ document: { createElement: element }, localStorage: { getItem: () => null } }, () => {
        const editor = new VisualizerEditor(view);
        editor.render = () => {};
        editor.setOpen(true);
        assert.equal(editor.itemBounds.hidden, false);
        assert.deepEqual(editor.itemBounds.children.map(node => node.dataset.itemId), ['empty-art', 'title']);
        assert.equal(editor.overlay.hidden, true);
        editor.selection = new Set([title.id]); editor.updateSelection();
        assert.deepEqual(editor.itemBounds.children.map(node => node.dataset.itemId), ['empty-art']);
        assert.equal(editor.overlay.hidden, false);
        assert.equal(editor.overlay.children.length, 8);
        editor.beginDrag(title, [title], { x: .1, y: .2 });
        editor.drag({ clientX: 250, clientY: 200 });
        assert.equal(editor.overlay.style.left, '25%');
        assert.equal(editor.overlay.style.top, '40%');
        editor.endDrag();
        editor.clearSelection(); editor.updateSelection();
        const titleBoundary = editor.itemBounds.children.find(node => node.dataset.itemId === title.id);
        assert.equal(titleBoundary.style.left, '25%');
        assert.equal(titleBoundary.style.top, '40%');
        layout.items.splice(0, 1); editor.changed(true);
        assert.deepEqual(editor.itemBounds.children.map(node => node.dataset.itemId), ['title']);
        editor.setOpen(false);
        assert.equal(editor.itemBounds.hidden, true);
        assert.equal(editor.overlay.hidden, true);
        assert.equal(editor.itemBounds.children.length, 0);
    });
});

test('Visualizer Back exits the expanded stage then restores the previous mobile view', async () => {
    const calls = [], classList = classes('view-visualizer', 'visualizer-expanded');
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        expanded: true, historyDepth: 2, previousMobileView: 'library',
        expandButton: { setAttribute() {} }, showControls() {},
        uiManager: {
            t: key => key,
            hideVisualizerView(options) { calls.push(['hide', options]); classList.remove('view-visualizer'); },
            mobileNav: { setView(value) { calls.push(['view', value]); } }
        }
    });
    await withGlobals({ document: { body: { classList } } }, () => {
        view.popState({ state: { effetuneVisualizer: 1 } });
        assert.equal(view.expanded, false);
        assert.equal(classList.contains('view-visualizer'), true);
        view.popState({ state: {} });
        assert.deepEqual(calls, [['hide', { fromHistory: true }], ['view', 'library']]);
    });
});

test('Mobile Visualizer reload reuses normal and expanded history entries for Back', async () => {
    for (const depth of [1, 2]) {
        const calls = [], classList = classes('view-visualizer');
        const history = {
            state: { effetuneVisualizer: depth, effetuneReflectedPipeline: 'local' },
            pushState(...args) { calls.push(['push', ...args]); }
        };
        await withGlobals({ document: { body: { classList } }, history }, () => {
            let view;
            // Each reload creates a fresh view while the browser retains the same history entry.
            for (let reload = 0; reload < 2; reload++) {
                view = Object.assign(Object.create(VisualizerView.prototype), {
                    expanded: false, historyDepth: 0,
                    expandButton: { setAttribute() {} }, showControls() {}, updateVisibility() {}, setEditing() {},
                    uiManager: {
                        layoutMode: { isMobile: true }, t: key => key,
                        hideVisualizerView(options) { calls.push(['hide', options]); classList.remove('view-visualizer'); },
                        mobileNav: { getCurrentView: () => 'visualizer', setView: value => calls.push(['view', value]) }
                    }
                });
                view.show();
                assert.equal(view.historyDepth, depth);
                assert.equal(view.expanded, depth === 2);
                assert.equal(classList.contains('visualizer-expanded'), depth === 2);
                assert.deepEqual(calls, []);
            }
            if (depth === 2) {
                view.popState({ state: { effetuneVisualizer: 1, effetuneReflectedPipeline: 'local' } });
                assert.equal(view.expanded, false);
                assert.equal(view.historyDepth, 1);
                assert.equal(classList.contains('view-visualizer'), true);
                assert.deepEqual(calls, []);
            }
            view.popState({ state: { effetuneReflectedPipeline: 'local' } });
            assert.equal(view.historyDepth, 0);
            assert.equal(classList.contains('view-visualizer'), false);
            assert.deepEqual(calls, [['hide', { fromHistory: true }], ['view', 'player']]);
        });
    }
});

test('Visualizer stops sources and animation when host visibility changes', async () => {
    const calls = [], classList = classes('view-visualizer');
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        sources: { hostHidden: true, setVisible: visible => calls.push(visible) },
        frameRequest: 7, uiManager: { audioManager: {}, isDoubleBlindActive: () => false }
    });
    await withGlobals({ document: { body: { classList }, hidden: false }, cancelAnimationFrame: id => calls.push(id), requestAnimationFrame: () => 8 }, () => {
        view.updateVisibility();
        assert.deepEqual(calls, [false, 7]);
        assert.equal(view.frameRequest, null);
        view.sources.hostHidden = false;
        view.updateVisibility();
        assert.equal(view.frameRequest, 8);
        assert.equal(view.visible, true);
    });
});

test('Hiding the main Visualizer preserves feed sources until the feed closes', async () => {
    const published = [], cancelled = [], classList = classes('view-visualizer');
    const audioManager = {
        telemetryHub: { subscribe: () => () => {} },
        setVisualizerSources: sources => published.push(sources)
    };
    await withGlobals({
        window: {},
        document: { body: { classList }, hidden: false, addEventListener() {}, removeEventListener() {} },
        cancelAnimationFrame: id => cancelled.push(id)
    }, () => {
        const sources = new VisualizerSources(audioManager);
        const feed = { visible: true, dispose() { this.visible = false; } };
        const view = Object.assign(Object.create(VisualizerView.prototype), {
            sources, feed, visible: true, frameRequest: 7,
            uiManager: { audioManager, isDoubleBlindActive: () => false },
            setEditing() {}, setExpanded() {}
        });
        try {
            sources.setLayout({ items: [{ id: 'meter', type: 'analog-meter', params: { md: 'Loudness' } }] });
            sources.setVisible(true);
            const source = [...sources.sources.values()][0];
            const identity = source.identity;
            const reading = source.frame = { program: { integrated: -23, integratedSeconds: 60 } };
            const tapId = published.at(-1)[0].tapId;
            published.length = 0;
            view.hide();
            classList.remove('view-visualizer');
            view.updateVisibility();
            assert.equal(view.visible, false);
            assert.equal(view.frameRequest, null);
            assert.deepEqual(cancelled, [7]);
            assert.ok(published.every(records => records.length === 1 && records[0].tapId === tapId));
            assert.equal(source.identity, identity);
            assert.equal(source.frame, reading);
            view.setFeedState({ open: false, visible: false });
            assert.equal(view.feed, null);
            assert.equal(sources.active, false);
            assert.deepEqual(published.at(-1), []);
        } finally {
            sources.dispose();
        }
    });
});

test('Changing view while the current Visualizer layout loads cancels that open', async () => {
    let resolve;
    const initialized = new Promise(done => { resolve = done; });
    const manager = Object.assign(Object.create(UIManager.prototype), {
        isDoubleBlindActive: () => false,
        visualizerView: { initialized, hide() {}, show() { throw new Error('Stale view opened'); } },
        hideLibraryView() {}, updateViewSwitchButtons() {}
    });
    await withGlobals({ document: { body: { classList: classes() } } }, async () => {
        const pending = manager.showVisualizerView();
        manager.showEffectPipelineView();
        resolve();
        assert.equal(await pending, false);
    });
});

test('Visualizer preset rename collisions preserve the existing layout on the next save', async () => {
    let provider;
    const stores = { current: new Map(), presets: new Map() };
    const store = new VisualizerPresetStore();
    store.initialize = async () => ({
        transaction(name) {
            const values = stores[name];
            let pending = 0, aborted = false;
            const transaction = {
                abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()); },
                objectStore() {
                    const request = action => {
                        pending++;
                        const result = {};
                        queueMicrotask(() => {
                            result.result = action();
                            result.onsuccess?.();
                            if (--pending === 0 && !aborted) queueMicrotask(() => transaction.oncomplete?.());
                        });
                        return result;
                    };
                    return {
                        get: key => request(() => structuredClone(values.get(key))),
                        getAllKeys: () => request(() => [...values.keys()]),
                        put: (value, key) => request(() => values.set(key, structuredClone(value))),
                        add: (value, key) => request(() => values.set(key, structuredClone(value))),
                        delete: key => request(() => values.delete(key))
                    };
                }
            };
            return transaction;
        }
    });
    const original = createDefaultLayout(), existing = createDefaultLayout();
    original.background.color = '#123456';
    existing.background.color = '#654321';
    await store.saveUserPreset('Original', original);
    await store.saveUserPreset('Existing', existing);
    const existingSaved = await store.getUserPreset('Existing');
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout: createDefaultLayout(), currentPresetName: '',
        systems: { '16:9': { Default: createDefaultLayout() } }, store,
        history: new VisualizerHistory(), sources: { setLayout() {} }, stage: { style: {} },
        editor: { open: false, selection: new Set(), resetForLayout() {}, updateSelection() {} },
        undoButton: {}, redoButton: {}, cutButton: {}, copyButton: {},
        uiManager: { pipelineManager: { core: { pluginPresetDialog: {
            show(value) { provider = value; }
        } } } }
    });
    try {
        await view.openPresets();
        assert.equal(provider.getPresetContext(), view);
        assert.equal(provider.getActiveSystemPresetId(), '16:9/Default');
        assert.equal(provider.getSystemPresetGroups()[0].presets[0].id, provider.getActiveSystemPresetId());
        assert.deepEqual(await provider.listUserPresetNames(), ['Original', 'Existing']);
        assert.equal(await provider.applyUserPreset('Original'), true);
        assert.deepEqual(view.layout, snapshotLayout(original));
        assert.equal(provider.getActiveSystemPresetId(), '');
        view.layout.background.color = '#abcdef';
        view.changed();
        const edited = snapshotLayout(view.layout);
        assert.equal(provider.getActiveSystemPresetId(), '');

        assert.equal(await provider.renameUserPreset('Original', 'Existing'), false);
        assert.equal(provider.getActiveSystemPresetId(), '');
        assert.deepEqual(await provider.listUserPresetNames(), ['Original', 'Existing']);
        assert.equal(await provider.saveUserPreset(provider.getDefaultSaveName()), true);
        assert.deepEqual(await store.getUserPreset('Existing'), existingSaved);
        assert.deepEqual(await store.getUserPreset('Original'), edited);
        assert.equal(provider.getActiveUserPresetName(), 'Original');
        assert.equal(provider.getDefaultSaveName(), 'Original');
        assert.deepEqual(await provider.listUserPresetNames(), ['Original', 'Existing']);

        assert.equal(await provider.renameUserPreset('Original', 'Renamed'), true);
        assert.equal(provider.getActiveUserPresetName(), 'Renamed');
        assert.equal(provider.getDefaultSaveName(), 'Renamed');
        view.layout.background.color = '#fedcba';
        view.changed();
        assert.equal(await provider.saveUserPreset(provider.getDefaultSaveName()), true);
        assert.equal(await store.getUserPreset('Original'), null);
        assert.deepEqual(await store.getUserPreset('Renamed'), snapshotLayout(view.layout));
        assert.deepEqual(await store.getUserPreset('Existing'), existingSaved);
        assert.deepEqual(await provider.listUserPresetNames(), ['Existing', 'Renamed']);

        assert.equal(await provider.deleteUserPresets(['Renamed']), true);
        assert.equal(provider.getActiveUserPresetName(), '');
        assert.equal(provider.getDefaultSaveName(), '');
        assert.deepEqual(await provider.listUserPresetNames(), ['Existing']);
        assert.deepEqual(await store.getUserPreset('Existing'), existingSaved);
    } finally {
        await store.flushCurrent();
    }
});

test('Visualizer Share copies a v link and shared links replace the layout only when valid', async () => {
    const messages = [];
    let copied = '';
    const layout = createDefaultLayout();
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout, currentPresetName: 'Mine', initialized: Promise.resolve(), status: { hidden: true, textContent: '' },
        setLayout(value) { this.layout = value; },
        uiManager: { t: key => key, showTransientMessage: (...args) => messages.push(args), setError: (...args) => messages.push(args) }
    });
    await withGlobals({ window: { electronAPI: { writeClipboardText: async text => { copied = text; return true; } } } }, async () => {
        await view.share();
    });
    const encoded = new URL(copied).searchParams.get('v');
    assert.equal(copied.startsWith('https://effetune.frieve.com/effetune.html?v='), true);
    assert.equal(messages.at(-1)[0], 'success.urlCopied');

    await withGlobals({ console: { ...console, warn() {} } }, async () => {
        assert.equal(await view.importShared('broken'), false);
    });
    assert.equal(view.layout, layout);
    assert.equal(view.currentPresetName, 'Mine');
    assert.equal(view.noticeActive, true);
    assert.equal(view.status.hidden, false);

    assert.equal(await view.importShared(encoded), true);
    assert.notEqual(view.layout, layout);
    assert.deepEqual(view.layout, { ...layout, background: { ...layout.background, themeColors: view.layout.background.themeColors } });
    assert.equal(view.currentPresetName, '');
    assert.equal(view.noticeActive, false);
});
