import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { VisualizerRenderer } from '../../js/visualizer/visualizer-renderer.js';
import { VisualizerHistory } from '../../js/visualizer/visualizer-history.js';
import { VisualizerPresetStore } from '../../js/visualizer/visualizer-preset-store.js';
import { createDefaultLayout, createItem, normalizeEffect, snapshotLayout, validateLayout, PLAYBACK_APPEARANCES, SEEK_APPEARANCES } from '../../js/visualizer/visualizer-model.js';
import { UIManager } from '../../js/ui-manager.js';
import { lyricsFrame, drawLyrics, lyricsOpacity } from '../../js/visualizer/visualizer-lyrics.js';
import { parseLrc } from '../../js/library/metadata/lyrics.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function classes(...initial) {
    const values = new Set(initial);
    return {
        contains: value => values.has(value),
        add: (...names) => names.forEach(name => values.add(name)),
        remove: (...names) => names.forEach(name => values.delete(name)),
        toggle(name, value) { if (value) values.add(name); else values.delete(name); }
    };
}

test('playback accessibility controls follow edited actions and cancel removed or hidden seek gestures', async () => {
    const document = createFakeDocument();
    const createElement = document.createElement.bind(document);
    document.createElement = tag => {
        const element = createElement(tag);
        element.removeAttribute = name => { delete element.attributes[name]; };
        element.remove = () => element.parentNode?.removeChild(element);
        element.insertBefore = (child, next) => {
            child.parentNode?.removeChild(child);
            const index = next ? element.children.indexOf(next) : element.children.length;
            element.children.splice(index, 0, child);
            child.parentNode = element;
        };
        return element;
    };
    const actions = [], seeks = [], released = [];
    let shown = 0, stopped = 0;
    const buttonItem = { id: 'transport', type: 'playback-control', params: { action: 'shuffle' } };
    const rangeItem = { id: 'position', type: 'seek-bar', params: {} };
    const playback = { available: true, seekEnabled: true, duration: 120, position: 30,
        shuffle: true, labels: { shuffle: 'Shuffle', next: 'Next' }, enabled: { shuffle: true, next: true } };
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        editor: { open: false }, layout: { items: [buttonItem, rangeItem] },
        canvas: { style: {}, hasPointerCapture: () => true, releasePointerCapture: id => released.push(id) },
        showControls: () => shown++, runPlaybackAction: action => actions.push(action),
        seekPlayback: value => seeks.push(value), t: (_key, fallback) => fallback
    });
    view.createPlaybackControls(document.body);
    view.syncPlaybackControls(view, playback);
    const button = view.playbackButtons.get('transport'), range = view.playbackButtons.get('position');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(range.getAttribute('aria-valuetext'), '0:30 / 2:00');
    await button.dispatchEvent('focus');
    assert.equal(view.playbackFocusedId, 'transport');
    assert.equal(shown, 1);
    // Replacing a layout item must not leave its original action captured by the listener.
    view.layout.items = [rangeItem, { ...buttonItem, params: { action: 'next' } }];
    view.syncPlaybackControls(view, playback);
    assert.equal(view.playbackButtons.get('transport'), button);
    assert.deepEqual(view.playbackControls.children, [range, button]);
    assert.equal(button.hasAttribute('aria-pressed'), false);
    assert.equal(view.playbackFocusedId, 'transport');
    const event = { stopPropagation() { stopped++; } };
    await button.dispatchEvent('click', event);
    assert.deepEqual(actions, ['next']);
    await range.dispatchEvent('focus');
    await button.dispatchEvent('blur');
    assert.equal(view.playbackFocusedId, 'position');
    await range.dispatchEvent('keydown', event);
    range.value = '90';
    await range.dispatchEvent('change');
    assert.deepEqual(seeks, [0.75]);
    assert.equal(stopped, 2);
    view.seekGesture = { id: 'position', pointerId: 7 };
    view.layout.items = [view.layout.items[1]];
    view.syncPlaybackControls(view, playback);
    assert.deepEqual(released, [7]);
    assert.equal(view.seekGesture, null);
    assert.equal(view.playbackFocusedId, null);
    assert.equal(view.canvas.style.touchAction, '');
    assert.equal(range.parentNode, null);
    view.layout.items.push(rangeItem);
    view.syncPlaybackControls(view, playback);
    view.seekGesture = { id: 'position', pointerId: 8 };
    view.playbackPointer = { id: 'transport' };
    view.playbackHoveredId = 'transport';
    view.syncPlaybackControls(view, playback, false);
    assert.deepEqual(released, [7, 8]);
    assert.equal(view.playbackPointer, null);
    assert.equal(view.playbackHoveredId, null);
    assert.equal(view.playbackButtons.size, 0);
    assert.equal(view.playbackControls.children.length, 0);
});

test('seek gestures release capture without seeking a replacement track or player', async () => {
    const seeks = [], released = [], captures = [];
    let track = {}, resumed = 0;
    const player = {
        stateManager: { getStateSnapshot: () => ({ currentTrack: track }) },
        playbackManager: { runPlaybackCommand: async command => command() },
        resumeAudioContextInGesture: () => resumed++, contextManager: { seek: value => seeks.push(value) }
    };
    let target = player;
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        editor: { open: false }, layout: {}, playbackTarget: () => target,
        playback: () => ({ seekEnabled: true, duration: 200 }),
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
            setPointerCapture: id => captures.push(id), hasPointerCapture: () => true,
            releasePointerCapture: id => released.push(id) },
        renderer: { seekBarValue: (_layout, _id, x) => x }
    });
    const event = { button: 0, pointerId: 4, clientX: 75, clientY: 10, preventDefault() {} };
    const begin = () => view.beginSeekPointer(event, view, { id: 'seek', value: 0.2 });
    begin();
    view.finishSeekPointer({ ...event, pointerId: 99 });
    assert.ok(view.seekGesture);
    track = {};
    view.finishSeekPointer(event);
    assert.deepEqual(seeks, []);
    assert.equal(view.seekGesture, null);
    begin();
    target = { ...player };
    view.finishSeekPointer(event);
    assert.deepEqual(seeks, []);
    begin();
    view.finishSeekPointer(event);
    await Promise.resolve();
    assert.deepEqual(seeks, [150]);
    assert.equal(resumed, 1);
    assert.deepEqual(captures, [4, 4, 4]);
    assert.deepEqual(released, [4, 4, 4]);
});

test('startup restores local layouts independently of system presets and never overwrites storage', async () => {
    for (const state of ['saved', 'empty', 'read-failure', 'preset-failure']) {
        const saved = createDefaultLayout();
        saved.background.color = '#123456';
        delete saved.items[0].params.showAxes;
        const writes = [], failures = [];
        let fetches = 0;
        const view = Object.assign(Object.create(VisualizerView.prototype), {
            layout: createDefaultLayout(),
            store: {
                async loadCurrent() {
                    if (state === 'read-failure') throw new Error('Read failed');
                    return state === 'saved' ? saved : null;
                },
                async loadSystemPresets() {
                    fetches++;
                    if (state !== 'empty') throw new Error('Fetch failed');
                    return { '16:9': { Default: saved } };
                },
                saveCurrent: layout => writes.push(snapshotLayout(layout))
            },
            editor: { resetForLayout() {}, updateSelection() {} },
            sources: { setLayout() {} }, video: { setEnabled() {} },
            stage: { style: {} }, counters() {}, recordHistory() {},
            fail: error => failures.push(error)
        });
        await view.initialize();
        assert.equal(fetches, ['empty', 'preset-failure'].includes(state) ? 1 : 0);
        assert.equal(failures.length, state.endsWith('failure') ? 1 : 0);
        assert.deepEqual(writes, []);
        if (!state.endsWith('failure')) {
            assert.equal(view.layout.background.color, '#123456');
            assert.equal(validateLayout(view.layout), true);
            view.layout.background.color = '#abcdef';
            view.changed();
            assert.equal(writes.length, 1);
            assert.equal(writes[0].background.color, '#abcdef');
        }
    }
});

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
                stage: { style: {} }, sources: { setLayout() {} }, video: { setEnabled() {}, setActive() {}, frame: () => null }, store: { saveCurrent: layout => saved.push(snapshotLayout(layout)) }
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

async function withPlaybackPropertyEditor(type, callback, { items = [createItem(type, 'control')], fullRender = false } = {}) {
    const document = createFakeDocument();
    const createElement = document.createElement.bind(document);
    document.createElement = tag => {
        const element = createElement(tag);
        element.append = (...children) => children.forEach(child => element.appendChild(child));
        element.replaceChildren = (...children) => {
            for (const child of [...element.children]) element.removeChild(child);
            element.append(...children);
        };
        element.contains = child => {
            for (; child; child = child.parentNode) if (child === element) return true;
            return false;
        };
        element.classList = classes();
        element.dataset = {};
        return element;
    };
    const root = document.createElement('div');
    const fields = new Map(), saved = [];
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout: { ...createDefaultLayout(), items },
        history: new VisualizerHistory(), undoButton: {}, redoButton: {}, cutButton: {}, copyButton: {},
        stage: { style: {} }, sources: { setLayout() {} }, video: { setEnabled() {} }, counters() {},
        store: { saveCurrent: layout => saved.push(snapshotLayout(layout)) }
    });
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view, root, navigationContent: document.createElement('div'), gridDivisions: 0,
        open: true, selection: new Set(items.map(item => item.id)), t: (_key, fallback) => fallback,
        updateSelection() {}, resetForLayout() {},
        field(parent, label, ...args) {
            const input = VisualizerEditor.prototype.field.call(this, parent, label, ...args);
            fields.set(label, input);
            return input;
        },
        render() {
            fields.clear();
            if (fullRender) return VisualizerEditor.prototype.render.call(this);
            root.replaceChildren();
            this[type === 'seek-bar' ? 'seekParameters' : 'playbackParameters'](root, view.layout.items[0]);
            this.takeBaseline();
        }
    });
    view.editor = editor;
    const change = async (label, value) => {
        const input = fields.get(label);
        if (input.type === 'checkbox') input.checked = value;
        else input.value = String(value);
        if (input.type === 'range' || input.type === 'color') await input.dispatchEvent('input');
        await input.dispatchEvent('change');
    };
    await withGlobals({ document }, async () => {
        view.recordHistory();
        editor.render();
        await callback({ view, fields, saved, change, document });
    });
}

test('Playback appearance and label edits persist and Undo restores the previous control settings', async () => {
    await withPlaybackPropertyEditor('playback-control', async ({ view, fields, saved, change }) => {
        await change('Appearance', 'raised');
        assert.equal(saved.at(-1).items[0].params.depth, .8);
        await change('Action', 'next');
        await change('Content', 'label');
        assert.equal(fields.has('Icon size'), false);
        assert.equal(fields.has('Custom label'), true);
        await change('Button shape', 'ellipse');
        assert.equal(fields.has('Corner radius'), false);
        const opacity = fields.get('Fill opacity');
        const number = view.editor.rangeControls.get(opacity).valueInput;
        number.value = '23';
        await number.dispatchEvent('input');
        assert.equal(Number(opacity.value), .23, 'The number field converts percent to the stored opacity');
        assert.equal(view.historyPending, true);
        await number.dispatchEvent('blur');
        assert.equal(view.historyPending, false);
        assert.equal(saved.at(-1).items[0].params.fillOpacity, .23);
        const previous = snapshotLayout(view.layout);
        await change('Custom label', 'Next song');
        assert.equal(saved.at(-1).items[0].params.action, 'next');
        assert.equal(saved.at(-1).items[0].params.label, 'Next song');
        view.stepHistory('undo');
        assert.deepEqual(view.layout.items, previous.items);
        view.stepHistory('redo');
        assert.equal(view.layout.items[0].params.label, 'Next song');
        assert.equal(validateLayout(saved.at(-1)), true);
    });
});

test('Seek appearance and thumb controls preserve saved settings through visibility changes and Undo', async () => {
    await withPlaybackPropertyEditor('seek-bar', async ({ view, fields, saved, change }) => {
        await change('Appearance', 'slim');
        assert.equal(fields.has('Thumb color'), false);
        assert.equal(saved.at(-1).items[0].params.thickness, 3);
        await change('Show thumb', true);
        assert.equal(fields.has('Thumb color'), true);
        await change('Thumb border width', 0);
        assert.equal(fields.get('Thumb border color').disabled, true);
        await change('Thumb border width', 2);
        assert.equal(fields.get('Thumb border color').disabled, false);
        await change('Thumb shape', 'diamond');
        const previous = snapshotLayout(view.layout);
        const historyIndex = view.history.index;
        const color = fields.get('Thumb color');
        color.value = '#abcdef';
        await color.dispatchEvent('input');
        color.value = '#123456';
        await color.dispatchEvent('input');
        assert.equal(view.history.index, historyIndex, 'Continuous color input stays one pending edit');
        await color.dispatchEvent('change');
        assert.equal(view.history.index, historyIndex + 1);
        assert.equal(saved.at(-1).items[0].params.thumbShape, 'diamond');
        assert.equal(saved.at(-1).items[0].params.thumbColor, '#123456');
        view.stepHistory('undo');
        assert.deepEqual(view.layout.items, previous.items);
        view.stepHistory('redo');
        assert.equal(view.layout.items[0].params.thumbColor, '#123456');
        assert.equal(validateLayout(saved.at(-1)), true);
    });
});

for (const [type, appearances, chosen, previous] of [
    ['playback-control', PLAYBACK_APPEARANCES, 'glass', 'minimal'],
    ['seek-bar', SEEK_APPEARANCES, 'classic', 'bold']
]) test(`${type} Appearance applies every preset key to all selected controls as one undoable edit`, async () => {
    const first = createItem(type, 'first'), second = createItem(type, 'second');
    Object.assign(first.params, appearances[chosen]);
    Object.assign(second.params, appearances[previous]);
    if (type === 'playback-control') {
        Object.assign(first.params, { action: 'next', label: 'Next song', shape: 'ellipse' });
        Object.assign(second.params, { action: 'stop', label: 'Stop here', shape: 'rectangle', fill: '#123456' });
    } else {
        Object.assign(first.params, { thumbShape: 'diamond', thumbColor: '#123456' });
        Object.assign(second.params, { thumbShape: 'bar', thumbColor: '#abcdef' });
    }
    second.rect = { x: .2, y: .3, w: .4, h: .15 };
    await withPlaybackPropertyEditor(type, async ({ view, saved, change }) => {
        const before = snapshotLayout(view.layout), expected = snapshotLayout(view.layout);
        for (const item of expected.items) Object.assign(item.params, appearances[chosen]);
        const historyIndex = view.history.index;
        await change('Appearance', chosen);
        assert.deepEqual(snapshotLayout(view.layout), expected, 'Preset keys apply even when the first control already has their values');
        assert.deepEqual(saved.at(-1), expected, 'Saving retains each control action, label, placement and non-preset styling');
        assert.equal(view.history.index, historyIndex + 1);
        view.stepHistory('undo');
        assert.deepEqual(snapshotLayout(view.layout), before);
        view.stepHistory('redo');
        assert.deepEqual(snapshotLayout(view.layout), expected);
        assert.deepEqual(saved.at(-1), expected);
        assert.equal(validateLayout(saved.at(-1)), true);
    }, { items: [first, second] });
});

test('Add creates player controls with factory colors and the full inspector follows content and history', async () => {
    await withPlaybackPropertyEditor('playback-control', async ({ view, fields, saved, change }) => {
        const add = async type => {
            const select = fields.get('Item');
            select.value = type;
            const button = select.parentNode.parentNode.children.find(child => child.tagName === 'BUTTON');
            await button.dispatchEvent('click');
            const item = view.layout.items.at(-1);
            assert.equal(item.type, type);
            assert.deepEqual(item.palette, createItem(type, 'factory').palette);
            assert.deepEqual(saved.at(-1), snapshotLayout(view.layout));
        };
        await add('playback-control');
        assert.equal(fields.has('Icon size'), true);
        assert.equal(fields.has('Font'), false);
        await change('Content', 'icon-label');
        assert.equal(fields.has('Font'), true);
        assert.equal(fields.has('Text size'), true);
        const withLabel = snapshotLayout(view.layout);
        await change('Content', 'icon');
        assert.equal(fields.has('Font'), false);
        view.stepHistory('undo');
        assert.deepEqual(snapshotLayout(view.layout), withLabel);
        assert.equal(fields.has('Font'), true);
        view.stepHistory('redo');
        assert.equal(fields.has('Font'), false);
        const beforeSeek = snapshotLayout(view.layout);
        await add('seek-bar');
        const both = snapshotLayout(view.layout);
        assert.deepEqual(both.items.map(item => item.type), ['playback-control', 'seek-bar']);
        assert.equal(fields.has('Thumb shape'), true);
        view.stepHistory('undo');
        assert.deepEqual(snapshotLayout(view.layout), beforeSeek);
        view.stepHistory('redo');
        assert.deepEqual(snapshotLayout(view.layout), both);
        assert.deepEqual(saved.at(-1), both);
        assert.equal(validateLayout(saved.at(-1)), true);
    }, { items: [], fullRender: true });
});

test('Item and background modulation dropdowns select audio sources and reserve Speed for Time', async () => {
    const element = () => ({ appendChild() {}, insertBefore() {}, setAttribute() {}, classList: classes(), firstElementChild: {} });
    await withGlobals({ document: { createElement: element } }, () => {
        const fields = new Map(), changes = [];
        const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
            t: (_key, fallback) => fallback, group: element, button: element, iconButton: element,
            field(_parent, label, kind, value, change, options) {
                fields.set(label, { kind, value, change, options }); return { value };
            },
            changed: render => changes.push(render)
        });
        for (const target of ['item', 'background']) {
            const effect = normalizeEffect({ type: 'opacity' }, target);
            const render = () => editor.effects({}, [effect], target, 'text');
            render();
            assert.equal(fields.get('Modulation').kind, 'select');
            assert.deepEqual(fields.get('Modulation').options.values.map(([value]) => value),
                ['none', 'time', 'level', 'bass', 'mid', 'treble', 'beat', 'width']);
            for (const source of ['mid', 'treble', 'beat', 'width', 'time', 'none']) {
                fields.get('Modulation').change(source);
                render();
                assert.equal(effect.mod.source, source);
                assert.equal(fields.get('Modulation').value, source);
                assert.equal(fields.get('Depth').options.disabled, source === 'none');
                assert.equal(fields.get('Speed').options.disabled, source !== 'time');
                assert.equal(changes.at(-1), true);
            }
            effect.enabled = false;
            render();
            assert.equal(fields.get('Modulation').options.disabled, true);
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

test('Drums edits camera angles and material colors without axis controls', () => {
    const fields = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (_key, fallback) => fallback,
        field(parent, label, type, value, change, options) { fields.push({ label, type, value, change, options }); },
        changed() {}
    });
    const item = createItem('drums', 'kit');
    editor.parameters({}, item);
    assert.deepEqual(fields.map(field => field.label), ['Viewing angle', 'Elevation', 'Shell color',
        'Cymbal color', 'Hardware color', 'Drumhead color']);
    fields[0].change(90);
    fields[2].change('#123456');
    assert.equal(item.params.yaw, 90);
    assert.equal(item.params.shellColor, '#123456');
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
    assert.deepEqual(fields.map(field => field.label), ['Display', 'Min BPM', 'Max BPM', 'Span (beats)',
        'Beat', 'BPM', 'Tempogram', 'Timing lanes', 'Echo rows', 'Beat lens',
        'Axes and grid', 'Axis labels and numbers']);
    const [displayMode, minimum, maximum, span, beat, bpm, tempogram, timingLanes, echoRows, beatLens] = fields;
    assert.deepEqual(displayMode.options.values, [['band', 'Frequency bands'], ['drums', 'Drums']]);
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

test('Key and Chord appear in the item picker with channel and text controls', async () => {
    const element = () => ({ classList: classes(), dataset: {}, append() {}, appendChild() {}, replaceChildren() {},
        addEventListener() {}, setAttribute() {} });
    await withGlobals({ document: { createElement: element } }, () => {
        for (const type of ['key', 'chord']) {
            const item = createItem(type, type), fields = new Map();
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                view: { layout: { ...createDefaultLayout(), items: [item] } },
                root: element(), navigationContent: element(), selection: new Set([type]),
                t: (_key, fallback) => fallback, group: element, button: element,
                field(_parent, label, kind, value, change, options) {
                    const field = { kind, value, change, options };
                    fields.set(label, field);
                    return field;
                },
                changed() {}, palette() {}, effects() {}
            });
            editor.render();
            assert.ok(fields.get('Item').options.values.some(([value]) => value === type));
            assert.equal(fields.get('Channel').kind, 'select');
            assert.equal(fields.get('Font').kind, 'select');
            assert.equal(fields.get('Text size').kind, 'range');
            assert.ok(fields.has('Vertical alignment'));
            assert.ok(!fields.has('Axes and grid'));
            assert.ok(!fields.has('Axis labels and numbers'));
            fields.get('Channel').change('R');
            fields.get('Text size').change(72);
            assert.equal(item.channel, 'R');
            assert.equal(item.style.fontSize, 72);
        }
    });
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

test('Custom Analog Meter keeps detector, dial, and appearance controls in place while disabling unused settings', async () => {
    const context = vm.createContext({ window: {}, PluginBase: class {} });
    vm.runInContext(await readFile(new URL('../../plugins/analyzer/analog_meter.js', import.meta.url), 'utf8'), context);
    await withGlobals({ window: { AnalogMeterPlugin: context.window.AnalogMeterPlugin } }, () => {
        const fields = new Map();
        const item = createItem('analog-meter', 'custom');
        item.params.md = 'Custom';
        const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
            t: (_key, fallback) => fallback,
            group: () => ({}),
            field(_parent, label, type, value, change, options = {}) {
                fields.set(label, { type, value, change, options });
            },
            changed() { render(); }
        });
        const render = () => { fields.clear(); editor.parameters({}, item); };
        render();
        const labels = [...fields.keys()];
        assert.equal(fields.get('Integration').options.disabled, true);
        assert.equal(fields.get('Release').options.disabled, true);
        assert.equal(fields.get('Range').options.disabled, true);
        assert.equal(fields.get('Reference').options.disabled, false);
        assert.equal(fields.get('Secondary % scale').options.disabled, false);
        assert.equal(fields.get('Arrow tip aspect ratio').options.disabled, true);
        fields.get('Detector').change('RMS');
        assert.deepEqual([...fields.keys()], labels);
        assert.equal(fields.get('Integration').options.disabled, false);
        fields.get('Integration').change(1.25);
        fields.get('Detector').change('True Peak');
        assert.equal(fields.get('Integration').options.disabled, true);
        assert.equal(fields.get('Release').options.disabled, false);
        assert.equal(fields.get('Integration').value, 1.25);
        fields.get('Secondary % scale').change(true);
        fields.get('Reading unit').change('percent');
        fields.get('Dial').change('4');
        assert.equal(item.params.dc, 4);
        assert.deepEqual([...fields.keys()], labels);
        assert.equal(fields.get('Reference').options.disabled, true);
        assert.equal(fields.get('Range').options.disabled, false);
        assert.equal(fields.get('Secondary % scale').options.disabled, true);
        assert.equal(fields.get('Reading unit').options.disabled, true);
        fields.get('Needle tip').change('arrow');
        assert.equal(fields.get('Arrow tip aspect ratio').options.disabled, false);
        fields.get('Arrow tip aspect ratio').change(2.5);
        fields.get('Needle tip').change('line');
        assert.deepEqual([...fields.keys()], labels);
        assert.equal(fields.get('Arrow tip aspect ratio').options.disabled, true);
        assert.equal(fields.get('Arrow tip aspect ratio').value, 2.5);
        fields.get('Dial').change('0');
        assert.equal(fields.get('Secondary % scale').options.disabled, false);
        assert.equal(fields.get('Secondary % scale').value, true);
        assert.equal(fields.get('Reading unit').value, 'percent');
        fields.get('Mode').change('PPM');
        assert.equal(fields.has('Detector'), false);
        assert.equal(fields.has('Integration'), false);
        assert.equal(fields.has('Secondary % scale'), false);
        assert.equal(fields.has('Arrow tip aspect ratio'), false);
        assert.equal(fields.get('Release').options.disabled, false);
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

test('Lyrics redraw on line advances and reuse held step layers', async () => {
    const context = { clearRect() {}, save() {}, translate() {}, scale() {}, drawImage() {}, restore() {} };
    const canvas = { width: 1280, height: 720, getContext: () => context };
    const layout = { ...createDefaultLayout(), items: [createItem('lyrics', 'lyrics')] };
    Object.assign(layout.items[0].params, { lyricsFadeIn: 0, lyricsFadeOut: 0 });
    const sources = { getModulators: () => ({}), getFrame: () => null };
    const data = { synced: true, lines: [{ time: 1, text: 'First' }, { time: 3, text: 'Second' }] };
    const renderer = new VisualizerRenderer(canvas), drawn = [];
    renderer.drawItem = (_state, item) => drawn.push(item.id);
    await withGlobals({ document: { createElement: () => ({ getContext: () => context }) } }, () => {
        const draw = time => renderer.draw(layout, sources, null, time, { lyrics: { data, time, duration: 5 } });
        draw(1.3); draw(2);
        assert.deepEqual(drawn, ['background', 'lyrics']);
        draw(3.1); draw(3.3); draw(4);
        assert.deepEqual(drawn, ['background', 'lyrics', 'lyrics', 'lyrics']);
        renderer.draw(layout, sources, null, 4);
        assert.equal(renderer.layers.has('lyrics'), false);
        assert.equal(drawn.length, 4);
        renderer.draw(layout, sources, null, 4, { editing: true });
        assert.equal(drawn.at(-1), 'lyrics');
    });
});

test('Horizontal Lyrics repaint during scrolling through the last cue and reuse held step glyphs', async () => {
    const context = { clearRect() {}, save() {}, translate() {}, scale() {}, drawImage() {}, restore() {} };
    const canvas = { width: 1280, height: 720, getContext: () => context };
    const sources = { getModulators: () => ({}), getFrame: () => null };
    const data = { synced: true, lines: [{ time: 0, text: 'First' }, { time: 3, text: 'Last' }] };
    await withGlobals({ document: { createElement: () => ({ getContext: () => context }) } }, () => {
        for (const motion of ['step-horizontal', 'smooth-horizontal']) {
            const item = createItem('lyrics', 'lyrics');
            Object.assign(item.params, { lyricsMotion: motion, lyricsFadeIn: 0, lyricsFadeOut: 0 });
            const renderer = new VisualizerRenderer(canvas), drawn = [];
            renderer.drawItem = (_state, value) => drawn.push(value.id);
            const draw = time => renderer.draw({ ...createDefaultLayout(), items: [item] }, sources, null, time,
                { lyrics: { data, time, duration: 6 } });
            draw(1); draw(2);
            assert.equal(drawn.filter(id => id === 'lyrics').length, motion === 'step-horizontal' ? 1 : 2);
            draw(4); draw(5);
            assert.equal(drawn.filter(id => id === 'lyrics').length, motion === 'step-horizontal' ? 2 : 4);
            renderer.dispose();
        }
    });
});

test('Lyrics whole-item opacity immediately follows playback position across loading, seeking, and track changes', () => {
    const item = createItem('lyrics', 'lyrics');
    item.params.lyricsOffset = 5;
    const old = { synced: false, lines: [{ text: 'Old' }] }, next = { synced: false, lines: [{ text: 'New' }] };
    const source = (time, data = old, duration = 20) => ({ data, time, duration, isStopped: false });
    const opacity = lyrics => lyricsOpacity(item, lyrics, false);
    assert.equal(opacity(source(0)), 0);
    assert.equal(opacity(source(.5)), .5);
    assert.equal(opacity(source(1)), 1);
    assert.equal(opacity(source(17)), 1);
    assert.equal(opacity(source(18.5)), .5);
    assert.equal(opacity(source(20)), 0);
    assert.equal(opacity(source(0, next)), 0);
    assert.equal(opacity(source(.5, next)), .5);
    assert.equal(lyricsFrame(item, source(.5, next), false).rows[0].text, 'New');
    assert.equal(opacity(source(8, null)), 0);
    assert.equal(opacity(source(8, next)), 1); // Late arrival catches up immediately.
    assert.equal(opacity(source(18.5, next)), .5);
    assert.equal(opacity(source(8, next)), 1); // Seeking retains no previous envelope.
    assert.equal(opacity(source(.5, next)), .5);
    assert.equal(opacity(source(.5, next)), .5); // Paused position holds opacity.
    assert.equal(opacity(source(8, next, 0)), 1); // Unknown duration disables the tail envelope.
    assert.equal(opacity({ ...source(8), isStopped: true }), 0);
    assert.equal(opacity(null), 0);
    assert.equal(lyricsOpacity(item, null, true), 1);
    item.params.lyricsFadeIn = item.params.lyricsFadeOut = 0;
    assert.equal(opacity(source(0)), 1);
    assert.equal(opacity(source(20)), 1);
});

test('Lyrics display only an editing placeholder without data and keep unsynced text unhighlighted', () => {
    const item = createItem('lyrics', 'lyrics'), drawn = [];
    const ctx = { save() {}, restore() {}, translate() {}, beginPath() {}, rect() {}, clip() {}, globalAlpha: 1,
        fillText: text => drawn.push(text), measureText: text => ({ width: text.length * 10 }) };
    drawLyrics(ctx, item, lyricsFrame(item, null, false), 300, 100, 1, '#fff');
    assert.deepEqual(drawn, []);
    drawLyrics(ctx, item, lyricsFrame(item, null, true), 300, 100, 1, '#fff');
    assert.deepEqual(drawn, ['Lyrics']);
    const data = { synced: false, lines: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }] };
    const frame = lyricsFrame(item, { data, time: 5, duration: 10 }, false);
    assert.equal(frame.p, 1);
    assert.equal(frame.current, -1);
    assert.equal(frame.fill, null);
    assert.equal(frame.list, true);
});

test('Lyrics horizontal steps share vertical easing and scroll through the final line while Single line stays vertical', () => {
    const item = createItem('lyrics', 'lyrics');
    const data = { synced: true, lines: [{ time: 1, text: 'First' }, { time: 3, text: 'Last' }] };
    const frame = time => lyricsFrame(item, { data, time, duration: 5 }, false);
    item.params.lyricsMotion = 'smooth-horizontal';
    assert.equal(frame(2).horizontal, true);
    assert.equal(frame(2).p, .5);
    assert.equal(frame(4).progress, .5);
    assert.notEqual(frame(4).key, frame(4.1).key);
    item.params.lyricsMotion = 'step-horizontal';
    const horizontalMidpoint = frame(1.09).p;
    item.params.lyricsMotion = 'step';
    assert.equal(frame(1.09).p, horizontalMidpoint);
    item.params.lyricsMotion = 'step-horizontal';
    assert.ok(Math.abs(horizontalMidpoint + .5) < 1e-9);
    assert.equal(frame(2.9).p, 0);
    assert.equal(frame(3).p, 0);
    assert.ok(Math.abs(frame(3.09).p - .5) < 1e-9);
    assert.equal(frame(3.18).p, 1);
    const unsynced = { synced: false, lines: data.lines.map(({ text }) => ({ text })) };
    assert.equal(lyricsFrame(item, { data: unsynced, time: 2.4, duration: 5 }, false).p, 0);
    assert.equal(lyricsFrame(item, { data: unsynced, time: 2.5, duration: 5 }, false).p, 0);
    assert.ok(Math.abs(lyricsFrame(item, { data: unsynced, time: 2.59, duration: 5 }, false).p - .5) < 1e-9);
    assert.equal(lyricsFrame(item, { data: unsynced, time: 2.68, duration: 5 }, false).p, 1);
    const later = { data: unsynced, time: 15, duration: 20 };
    assert.equal(lyricsFrame(item, later, false).p, 1);
    assert.equal(lyricsOpacity(item, later, false), 1);
    assert.equal(lyricsFrame(item, { ...later, time: 20 }, false).p, 1);
    item.params.lyricsMotion = 'smooth-horizontal';
    assert.equal(lyricsFrame(item, { data: unsynced, time: 2.9, duration: 0 }, false).ticker, false);
    item.params.lyricsMotion = 'step-horizontal';
    item.params.lyricsView = 'line';
    assert.equal(frame(2).horizontal, false);
    assert.equal(frame(2).p, 0);
});

test('Lyrics step transition duration applies equally to vertical and horizontal lists and caps at the next cue', () => {
    const item = createItem('lyrics', 'lyrics');
    const data = { synced: true, lines: [{ time: 1, text: 'First' }, { time: 3, text: 'Second' }, { time: 3.5, text: 'Third' }] };
    const frame = time => lyricsFrame(item, { data, time, duration: 8 }, false);
    for (const motion of ['step', 'step-horizontal']) {
        item.params.lyricsMotion = motion;
        item.params.lyricsStepDuration = 0;
        assert.equal(frame(3).p, 1);
        item.params.lyricsStepDuration = .18;
        assert.ok(Math.abs(frame(3.09).p - .5) < 1e-9);
        item.params.lyricsStepDuration = 2;
        assert.equal(frame(2).p, -.5);
        assert.equal(frame(3.25).p, .5); // A shorter cue interval caps the requested duration.
        item.params.lyricsView = 'line';
        assert.equal(frame(3.18).p, 1); // Single line retains its existing transition.
        item.params.lyricsView = 'list';
    }
});

test('Lyrics word fill and item offset follow content timing', () => {
    const item = createItem('lyrics', 'lyrics');
    const data = { synced: true, lines: [{ time: 1, text: 'One Two', words: [
        { time: 1, text: 'One ' }, { time: 2, text: 'Two' }] }, { time: 3, text: 'Next' }] };
    assert.equal(lyricsFrame(item, { data, time: -0.1, duration: 5 }, false).current, -1);
    const frame = lyricsFrame(item, { data, time: 1.5, duration: 5 }, false);
    assert.equal(frame.fill, 2);
    item.params.lyricsOffset = 1;
    assert.equal(lyricsFrame(item, { data, time: 1.5, duration: 5 }, false).current, -1);
});

test('Lyrics list position moves the current row from top to bottom and leaves single-line alignment intact', () => {
    const item = createItem('lyrics', 'lyrics'), drawn = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, globalAlpha: 1,
        fillText: (text, _x, y) => drawn.push({ text, y }) };
    const frame = { rows: [{ text: 'Before' }, { text: 'Now' }, { text: 'Next' }], list: true,
        next: true, synced: true, current: 1, p: 1, fill: null };
    const currentY = position => {
        drawn.length = 0;
        item.params.lyricsPosition = position;
        drawLyrics(ctx, item, frame, 400, 300, 1, '#fff');
        return drawn.find(row => row.text === 'Now').y;
    };
    assert.ok(Math.abs(currentY(0) - 21.6) < 1e-10);
    assert.equal(currentY(50), 150);
    assert.ok(Math.abs(currentY(100) - 278.4) < 1e-10);
    frame.list = false;
    item.style.verticalAlign = 'top';
    assert.equal(currentY(0), currentY(100));
    item.style.verticalAlign = 'bottom';
    assert.ok(Math.abs(currentY(0) - 235.2) < 1e-10);
});

test('Clicking a drawn synced Lyrics row returns its cue time plus the item offset', () => {
    const item = createItem('lyrics', 'lyrics'), measurements = {};
    Object.assign(item, { rect: { x: .5, y: 0, w: .5, h: 1 }, flipX: true });
    item.params.lyricsOffset = .5;
    const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText() {}, globalAlpha: 1 };
    const frame = { rows: [{ time: 1, text: 'Before' }, { time: 3, text: 'Now' }, { time: 4, text: '' }], list: true,
        next: true, synced: true, current: 1, p: 1, fill: null };
    drawLyrics(ctx, item, frame, 400, 300, 1, '#fff', null, measurements);
    const renderer = new VisualizerRenderer({ width: 800, height: 300 });
    renderer.layers.set('lyrics', { canvas: { width: 400, height: 300 }, lyricsMeasurements: measurements,
        hitClipped: true, hitTransform: { transformPoint: ({ x, y }) => ({ x: 800 - x, y }) } });
    const layout = { items: [item] };
    assert.equal(renderer.lyricsSeekTime(layout, .9, .5), 3.5);
    assert.equal(renderer.lyricsSeekTime(layout, .6, .5), 3.5); // Flip X mirrors the item box.
    assert.equal(renderer.lyricsSeekTime(layout, .4, .5), null);
    assert.deepEqual(measurements.hits.map(row => row.time), [1.5, 3.5]); // Empty clear rows are not seek targets.
    drawLyrics(ctx, item, { ...frame, synced: false }, 400, 300, 1, '#fff', null, measurements);
    assert.equal(renderer.lyricsSeekTime(layout, .9, .5), null);
});

test('Enhanced LRC word fill reaches the explicit word end before the next line', () => {
    const item = createItem('lyrics', 'lyrics');
    const data = parseLrc('[00:01]<00:01>Hello<00:02>\n[00:10]Next');
    assert.equal(lyricsFrame(item, { data, time: 1.5, duration: 12 }, false).fill, 2.5);
    assert.equal(lyricsFrame(item, { data, time: 2, duration: 12 }, false).fill, 5);
    assert.equal(lyricsFrame(item, { data, time: 9, duration: 12 }, false).fill, 5);
});

test('Lyrics line spacing changes the stride while keeping glyph size, list position, and word clipping fixed', () => {
    const item = createItem('lyrics'), drawn = [], clips = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, clip() {}, globalAlpha: 1,
        rect: (...bounds) => clips.push(bounds), measureText: text => ({ width: text.length * 10 }),
        fillText(text, _x, y) { drawn.push({ text, y, font: this.font }); } };
    const frame = { rows: [{ text: 'Before' }, { text: 'Now' }, { text: 'Next' }], list: true,
        next: true, synced: true, current: 1, p: 1, fill: 1.5 };
    const draw = (spacing, position = 50) => {
        drawn.length = 0; clips.length = 0;
        Object.assign(item.params, { lyricsLineSpacing: spacing, lyricsPosition: position });
        drawLyrics(ctx, item, frame, 400, 300, 1, '#fff');
        return { current: drawn.find(row => row.text === 'Now'), next: drawn.find(row => row.text === 'Next'),
            wordClip: clips.at(-1) };
    };
    for (const spacing of [.5, 1, 2]) {
        const result = draw(spacing);
        assert.equal(result.current.y, 150);
        assert.equal(result.current.font, '36px sans-serif');
        assert.ok(Math.abs(result.next.y - result.current.y - 43.2 * spacing) < 1e-10);
        assert.ok(Math.abs(result.wordClip[1] - 128.4) < 1e-10);
        assert.ok(Math.abs(result.wordClip[3] - 43.2) < 1e-10);
        assert.ok(Math.abs(draw(spacing, 0).current.y - 21.6) < 1e-10);
        assert.ok(Math.abs(draw(spacing, 100).current.y - 278.4) < 1e-10);
    }
    frame.list = false;
    item.style.verticalAlign = 'middle';
    const single = draw(2);
    assert.ok(Math.abs(single.current.y - 106.8) < 1e-10);
    assert.ok(Math.abs(single.next.y - 193.2) < 1e-10);
    frame.next = false;
    assert.equal(draw(2).current.y, 150);
});

test('Lyrics word fill clips the drawn width after casing, letter spacing, and line compression', async () => {
    const { drawStyledText } = await import('../../js/visualizer/visualizer-text.js');
    const ctx = { save() {}, restore() {}, fillText() {},
        measureText(text) { return { width: text.length * (10 + parseFloat(this.letterSpacing)) }; } };
    const item = createItem('lyrics', 'lyrics');
    const measured = drawStyledText(ctx, 'aß', { ...item.style, align: 'right', textCase: 'upper', letterSpacing: 2 },
        20, 50, 1, '#fff', undefined, 1.5);
    assert.equal(measured.left, 2);
    assert.ok(Math.abs(measured.filled - 40 / 3) < 1e-10);
});

test('Missing artwork hides its decorations and returns only after an image loads', async () => {
    const composed = [];
    const context = { clearRect() {}, save() {}, translate() {}, scale() {}, restore() {},
        getTransform: () => ({ translate() { return this; }, scale() { return this; } }),
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

test('Visualizer resize handles preserve proportions with Shift and resize from the center with Ctrl or Cmd', () => {
    const item = { rect: {} };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 500 }) } },
        gridDivisions: 0, changed() {}
    });
    const before = { x: .2, y: .25, w: .4, h: .2 };
    const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, label);
    for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const horizontal = corner.includes('w') || corner.includes('e');
        const vertical = corner.includes('n') || corner.includes('s');
        for (const modifiers of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true },
            { shiftKey: true, ctrlKey: true }]) {
            for (const [dx, dy] of [[.04, .04], [.08, .01], [-.04, -.04]]) {
                item.rect = { ...before };
                const point = { x: .4, y: .35 };
                editor.beginDrag(item, [item], point, corner);
                editor.drag({ clientX: 100 + (point.x + (corner.includes('w') ? -dx : horizontal ? dx : 0)) * 1000,
                    clientY: 50 + (point.y + (corner.includes('n') ? -dy : vertical ? dy : 0)) * 500, ...modifiers });
                const centered = modifiers.ctrlKey || modifiers.metaKey;
                const factor = centered ? 2 : 1;
                if (modifiers.shiftKey) {
                    near(item.rect.w / item.rect.h, before.w / before.h, `${corner} proportions`);
                    const change = horizontal && (!vertical || Math.abs(dx / before.w) > Math.abs(dy / before.h))
                        ? dx / before.w : dy / before.h;
                    near(item.rect.w, before.w * (1 + change * factor), `${corner} proportional width`);
                } else {
                    near(item.rect.w, before.w + (horizontal ? dx * factor : 0), `${corner} width`);
                    near(item.rect.h, before.h + (vertical ? dy * factor : 0), `${corner} height`);
                }
                if (centered || !horizontal) near(item.rect.x + item.rect.w / 2, .4, `${corner} horizontal center`);
                else near(corner.includes('w') ? item.rect.x + item.rect.w : item.rect.x,
                    corner.includes('w') ? .6 : .2, `${corner} opposite horizontal edge`);
                if (centered || !vertical) near(item.rect.y + item.rect.h / 2, .35, `${corner} vertical center`);
                else near(corner.includes('n') ? item.rect.y + item.rect.h : item.rect.y,
                    corner.includes('n') ? .45 : .25, `${corner} opposite vertical edge`);
            }
        }
    }
});

test('Visualizer resize modifiers change during a drag and respect snapping and proportional size limits', () => {
    const item = { rect: { x: .1, y: .2, w: .2, h: .1 } };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) } },
        gridDivisions: 8, changed() {}
    });
    const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, label);
    editor.beginDrag(item, [item], { x: .3, y: .25 }, 'e');
    for (const [modifiers, expected] of [
        [{}, { x: .1, y: .2, w: .275, h: .1 }],
        [{ ctrlKey: true }, { x: .025, y: .2, w: .35, h: .1 }],
        [{ ctrlKey: true, shiftKey: true }, { x: .025, y: .1625, w: .35, h: .175 }],
        [{ ctrlKey: true, shiftKey: true, altKey: true }, { x: .047, y: .1735, w: .306, h: .153 }],
        [{ shiftKey: true, altKey: true }, { x: .1, y: .18675, w: .253, h: .1265 }],
        [{}, { x: .1, y: .2, w: .275, h: .1 }]
    ]) {
        editor.drag({ clientX: 353, clientY: 125, ...modifiers });
        for (const key of ['x', 'y', 'w', 'h']) near(item.rect[key], expected[key], `${JSON.stringify(modifiers)} ${key}`);
    }
    editor.gridDivisions = 0;
    for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        for (const [delta, width, height] of [[-2, .04, .02], [2, 1, .5]]) {
            item.rect = { x: .2, y: .25, w: .4, h: .2 };
            editor.beginDrag(item, [item], { x: .4, y: .35 }, corner);
            editor.drag({ clientX: (.4 + (corner.includes('w') ? -delta : corner.includes('e') ? delta : 0)) * 1000,
                clientY: (.35 + (corner.includes('n') ? -delta : corner.includes('s') ? delta : 0)) * 500,
                ctrlKey: true, shiftKey: true });
            near(item.rect.w, width, `${corner} limited width`);
            near(item.rect.h, height, `${corner} limited height`);
            near(item.rect.x + item.rect.w / 2, .4, `${corner} limited horizontal center`);
            near(item.rect.y + item.rect.h / 2, .35, `${corner} limited vertical center`);
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

test('Visualizer video keeps track selection and audible timing when using the shared decoder', () => {
    const loads = [], frames = [];
    const state = { currentTrack: { path: '/music/movie.mp4' }, currentTrackPosition: 4, playbackSpeed: 2, isPlaying: true };
    const player = { ui: { container: {} }, stateManager: { getStateSnapshot: () => state },
        contextManager: { getCurrentPlaybackTime: () => 8, getMediaElementSourceUrl: path => `file://${path}` } };
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        uiManager: { audioPlayer: player, audioManager: { getAudiblePlaybackPosition: (time, speed) => time - 0.4 * speed } },
        video: { enabled: true, active: true, load: source => loads.push(source), frame: (...args) => { frames.push(args); return loads.at(-1) ? 'picture' : null; } }
    });
    assert.equal(view.videoFrame(), 'picture');
    assert.equal(loads.at(-1), 'file:///music/movie.mp4');
    assert.deepEqual(frames.at(-1), [7.2, 2, true]);
    state.isPlaying = false;
    view.videoFrame();
    assert.deepEqual(frames.at(-1), [3.2, 2, false]);
    state.currentTrack = { path: '/music/audio.mp3' };
    assert.equal(view.videoFrame(), null);
    assert.equal(loads.at(-1), null);
    state.currentTrack = { path: '/music/movie.mp4' };
    player.ui.container = null;
    assert.equal(view.videoFrame(), null);
    assert.equal(loads.at(-1), null);
});

test('Visualizer stops sources and animation when host visibility changes', async () => {
    const calls = [], classList = classes('view-visualizer');
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        sources: { hostHidden: true, setVisible: visible => calls.push(visible) }, video: { setEnabled() {}, setActive() {}, frame: () => null },
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
            sources, feed, visible: true, frameRequest: 7, video: { setEnabled() {}, setActive() {}, frame: () => null },
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

test('Visualizer system presets prioritize the current viewport proportions each time the dialog opens', async () => {
    const aspects = ['16:9', '21:9', '4:3', '1:1', '9:16'];
    const systems = Object.fromEntries(aspects.map(aspect => [aspect, {
        Default: { ...createDefaultLayout(), aspect },
        Alternative: { ...createDefaultLayout(), aspect, items: [] }
    }]));
    let provider, loads = 0;
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout: systems['16:9'].Default,
        store: { async loadSystemPresets() { loads++; return systems; } },
        uiManager: { pipelineManager: { core: { pluginPresetDialog: {
            show(value) { provider = value; }
        } } } }
    });
    for (const [width, height, expected] of [
        [1920, 1080, ['16:9', '21:9', '4:3', '1:1', '9:16']],
        [390, 844, ['9:16', '1:1', '4:3', '16:9', '21:9']],
        [1200, 1000, ['4:3', '1:1', '16:9', '21:9', '9:16']],
        [2560, 1080, ['21:9', '16:9', '4:3', '1:1', '9:16']]
    ]) {
        await withGlobals({ window: { innerWidth: width, innerHeight: height } }, () => view.openPresets());
        const groups = provider.getSystemPresetGroups();
        assert.deepEqual(groups.map(group => group.label), expected, `${width} × ${height}`);
        for (const group of groups) {
            assert.deepEqual(group.presets.map(preset => preset.label), ['Default', 'Alternative']);
            for (const preset of group.presets) {
                assert.equal(preset.id, `${group.label}/${preset.label}`);
                assert.equal(preset.layout, systems[group.label][preset.label]);
            }
        }
        assert.equal(provider.getActiveSystemPresetId(), '16:9/Default');
        assert.deepEqual(Object.keys(systems), aspects);
    }
    assert.equal(loads, 1);
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
        history: new VisualizerHistory(), sources: { setLayout() {} }, video: { setEnabled() {}, setActive() {}, frame: () => null }, stage: { style: {} },
        editor: { open: false, selection: new Set(), resetForLayout() {}, updateSelection() {} },
        undoButton: {}, redoButton: {}, cutButton: {}, copyButton: {},
        uiManager: { pipelineManager: { core: { pluginPresetDialog: {
            show(value) { provider = value; }
        } } } }
    });
    try {
        await withGlobals({ window: { innerWidth: 1280, innerHeight: 720 } }, () => view.openPresets());
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
