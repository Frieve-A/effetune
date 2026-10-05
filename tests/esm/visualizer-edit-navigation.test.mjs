import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultLayout, createItem, decodeLayoutShare, encodeLayoutShare, layoutsEqual,
    MAX_ITEM_SIZE, MIN_ITEM_SIZE, normalizeLayout, snapshotLayout, validateLayout } from '../../js/visualizer/visualizer-model.js';
import { VisualizerHistory, layoutSnapshot, snapshotLayout as restoreHistory } from '../../js/visualizer/visualizer-history.js';
import { VisualizerPresetStore } from '../../js/visualizer/visualizer-preset-store.js';
import { validateItemShape } from '../../js/user-data-backup/portable.js';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerRenderer } from '../../js/visualizer/visualizer-renderer.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function offFrameLayout() {
    const layout = createDefaultLayout();
    layout.items = [
        { x: -0.125, y: 0.8, w: 0.6, h: 0.4 },
        { x: 1.2, y: -0.4, w: 0.2, h: 0.6 },
        { x: -1.1, y: 1.3, w: 0.3, h: 0.2 }
    ].map((rect, index) => ({ ...createItem('shape', `off-frame-${index}`), rect }));
    return layout;
}

test('Off-frame rectangles survive normalization, snapshots, JSON, and share links', () => {
    const layout = offFrameLayout();
    const expected = layout.items.map(({ rect }) => rect);
    assert.equal(validateLayout(layout), true);
    for (const restored of [normalizeLayout(layout), snapshotLayout(layout),
        normalizeLayout(JSON.parse(JSON.stringify(layout))), decodeLayoutShare(encodeLayoutShare(layout))]) {
        assert.deepEqual(restored.items.map(({ rect }) => rect), expected);
        assert.equal(validateLayout(restored), true);
        assert.equal(layoutsEqual(restored, layout), true);
    }
    const different = structuredClone(layout);
    different.items[0].rect.x = 0;
    assert.equal(layoutsEqual(layout, different), false, 'Off-frame placement is part of the layout');
});

test('Rectangle normalization keeps finite positions and bounds size independently of the frame edges', () => {
    const layout = offFrameLayout();
    for (const [key, invalid, expected] of [
        ['x', Infinity, 0.1], ['y', NaN, 0.1], ['w', Infinity, 0.8], ['h', -Infinity, 0.8],
        ['w', 0, MIN_ITEM_SIZE], ['h', -1, MIN_ITEM_SIZE], ['w', 2, MAX_ITEM_SIZE], ['h', 2, MAX_ITEM_SIZE]
    ]) {
        const invalidLayout = structuredClone(layout);
        invalidLayout.items[0].rect[key] = invalid;
        assert.equal(validateLayout(invalidLayout), false, `${key}=${invalid}`);
        const restored = normalizeLayout(invalidLayout);
        assert.equal(restored.items[0].rect[key], expected);
        assert.equal(validateLayout(restored), true);
    }
});

test('Current layouts, named presets, and backup restoration retain off-frame placement', async () => {
    const stores = { current: new Map(), presets: new Map() };
    const store = new VisualizerPresetStore();
    store.request = async (name, _mode, action) => action({
        get: key => stores[name].get(key),
        put: (value, key) => stores[name].set(key, structuredClone(value)),
        add: (value, key) => stores[name].set(key, structuredClone(value)),
        getAllKeys: () => [...stores[name].keys()]
    });
    const layout = offFrameLayout(), expected = snapshotLayout(layout);
    store.saveCurrent(layout);
    await store.flushCurrent();
    assert.deepEqual(await store.loadCurrent(), expected);
    await store.saveUserPreset('Cropped', layout);
    assert.deepEqual(await store.getUserPreset('Cropped'), expected);
    const [{ name, layout: backup }] = await store.readBackupSnapshot();
    assert.equal(name, 'Cropped');
    assert.deepEqual(backup, expected);
    assert.doesNotThrow(() => validateItemShape({ id: 'off-frame-backup', kind: 'visualizer', name: 'Restored', data: backup }));
    await store.appendUserPreset('Restored', JSON.parse(JSON.stringify(backup)));
    assert.deepEqual(await store.getUserPreset('Restored'), expected);
});

test('Undo and Redo restore rectangles outside the frame', () => {
    const history = new VisualizerHistory(), layout = createDefaultLayout();
    history.record(layoutSnapshot(layout));
    layout.items = offFrameLayout().items;
    history.record(layoutSnapshot(layout));
    assert.deepEqual(normalizeLayout(restoreHistory(history.undo())), createDefaultLayout());
    assert.deepEqual(normalizeLayout(restoreHistory(history.redo())), layout);
});

function classList(...initial) {
    const values = new Set(initial);
    return {
        contains: value => values.has(value),
        add: (...names) => names.forEach(name => values.add(name)),
        toggle(value, active) { if (active) values.add(value); else values.delete(value); },
        remove: value => values.delete(value)
    };
}

function setupViewport(bodyZoom = 1) {
    const layout = createDefaultLayout();
    const saved = [], captures = [];
    const stage = { style: {}, classList: classList(), dataset: {}, closest: () => null,
        focus() {}, setPointerCapture: id => captures.push(id) };
    const stageHost = { classList: classList(), setPointerCapture: id => captures.push(id),
        getBoundingClientRect: () => ({ left: 40, top: 60, width: 1280 * bodyZoom, height: 800 * bodyZoom }) };
    const canvas = { width: 1280, height: 720, getBoundingClientRect() {
        const host = stageHost.getBoundingClientRect();
        return { left: host.left + parseFloat(stage.style.left) * bodyZoom,
            top: host.top + parseFloat(stage.style.top) * bodyZoom,
            width: parseFloat(stage.style.width) * bodyZoom, height: parseFloat(stage.style.height) * bodyZoom };
    } };
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout, stage, stageHost, canvas, history: new VisualizerHistory(),
        undoButton: {}, redoButton: {}, cutButton: {}, copyButton: {},
        root: { classList: classList(), contains: target => target?.inRoot === true },
        sources: { setLayout() {} }, store: { saveCurrent: value => saved.push(snapshotLayout(value)) },
        uiManager: { showTransientMessage() {} }, warn() {}
    });
    view.t = (_key, fallback) => fallback;
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view, open: true, zoom: 1, panX: 0, panY: 0, fitted: true,
        zoomOutput: {}, zoomOutButton: {}, zoomInButton: {}, viewportControls: {},
        navigation: {}, root: {}, gridDivisions: 0, selection: new Set(),
        marquee: { hidden: true, style: {} }, render() {}, updateSelection() {}
    });
    view.editor = editor;
    view.recordHistory();
    editor.updateViewport(1280, 800);
    return { editor, view, layout, saved, captures };
}

const pointer = (editor, x, y, extra = {}) => {
    const rect = editor.view.canvas.getBoundingClientRect();
    return { target: editor.view.stage, clientX: rect.left + x * rect.width,
        clientY: rect.top + y * rect.height, pointerId: 1, button: 0,
        preventDefault() { this.prevented = true; }, ...extra };
};
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} !== ${expected}`);
const body = zoom => ({ style: { zoom: String(zoom) }, classList: classList('view-visualizer') });

test('Zoom remains anchored to the cursor through body zoom and Fit recenters without editing the layout', async () => {
    for (const bodyZoom of [1, 1.5]) await withGlobals({ document: { body: body(bodyZoom) } }, () => {
        const { editor, view, layout, saved } = setupViewport(bodyZoom);
        const before = structuredClone(layout), history = structuredClone(view.history.entries);
        editor.panBy(85, -55);
        const cursor = pointer(editor, 0.32, 0.68), point = editor.point(cursor);
        editor.zoomAt(2, cursor.clientX, cursor.clientY);
        near(editor.point(cursor).x, point.x, 'Cursor X anchor');
        near(editor.point(cursor).y, point.y, 'Cursor Y anchor');
        editor.zoomAt(100);
        assert.equal(editor.zoom, 4);
        editor.zoomAt(0.01);
        assert.equal(editor.zoom, 0.1);
        editor.fitViewport();
        assert.equal(editor.fitted, true);
        assert.equal(editor.panX, 0);
        assert.equal(editor.panY, 0);
        assert.ok(parseFloat(view.stage.style.width) < 1280);
        assert.deepEqual(layout, before);
        assert.deepEqual(view.history.entries, history);
        assert.deepEqual(saved, []);
        assert.deepEqual([view.canvas.width, view.canvas.height], [1280, 720]);
    });
});

test('Wheel navigation supports two-axis scrolling, Shift, zoom, and leaves playback wheel handling alone', async () => {
    await withGlobals({ document: { body: body(1.5) } }, () => {
        const { editor, saved } = setupViewport(1.5);
        const wheel = extra => ({ ...pointer(editor, 0.4, 0.6), deltaX: 0, deltaY: 0, deltaMode: 0,
            stopPropagation() { this.stopped = true; }, ...extra });
        const scroll = wheel({ deltaX: 30, deltaY: 60 });
        editor.onViewportWheel(scroll);
        assert.equal(scroll.prevented, true);
        assert.equal(scroll.stopped, true);
        near(editor.panX, -20, 'Horizontal trackpad pan');
        near(editor.panY, -40, 'Vertical trackpad pan');
        editor.onViewportWheel(wheel({ deltaY: 45, shiftKey: true }));
        near(editor.panX, -50, 'Shift scroll horizontal pan');
        near(editor.panY, -40, 'Shift scroll leaves vertical pan');
        const zoom = editor.zoom, cursor = wheel({ deltaY: -100, ctrlKey: true }), anchor = editor.point(cursor);
        editor.onViewportWheel(cursor);
        assert.ok(editor.zoom > zoom);
        near(editor.point(cursor).x, anchor.x, 'Wheel X anchor');
        near(editor.point(cursor).y, anchor.y, 'Wheel Y anchor');
        const duringDrag = wheel({ deltaY: -100, ctrlKey: true }), currentZoom = editor.zoom;
        editor.dragging = {};
        editor.onViewportWheel(duringDrag);
        assert.equal(duringDrag.prevented, true, 'A wheel gesture during editing cannot zoom the browser');
        assert.equal(duringDrag.stopped, true, 'The page zoom handler cannot consume an active editing gesture');
        assert.equal(editor.zoom, currentZoom);
        editor.dragging = null;
        editor.open = false;
        const playback = wheel({ deltaY: 30 });
        editor.onViewportWheel(playback);
        assert.equal(playback.prevented, undefined);
        assert.equal(playback.stopped, undefined);
        assert.deepEqual(saved, []);
    });
});

test('Space and middle-button drag pan over a selected item without moving it or recording history', async () => {
    await withGlobals({ document: { body: body(1.5) } }, () => {
        for (const mode of ['space', 'middle']) {
            const { editor, view, layout, saved, captures } = setupViewport(1.5);
            editor.selection = new Set(['main-spectrum']);
            const before = structuredClone(layout);
            if (mode === 'space') editor.onStageKeyDown({ key: ' ', code: 'Space', target: view.stage, preventDefault() {} });
            const start = pointer(editor, 0.5, 0.5, { button: mode === 'middle' ? 1 : 0 });
            editor.startDrag(start);
            assert.ok(editor.panning);
            assert.equal(editor.dragging, undefined);
            editor.drag({ ...start, clientX: start.clientX + 150, clientY: start.clientY - 75, pointerId: 2 });
            assert.equal(editor.panX, 0, 'A second pointer does not control the active pan');
            editor.drag({ ...start, clientX: start.clientX + 150, clientY: start.clientY - 75 });
            near(editor.panX, 100, `${mode} horizontal pan`);
            near(editor.panY, -50, `${mode} vertical pan`);
            editor.endDrag();
            editor.setHandTool(false);
            assert.equal(editor.panning, null);
            assert.equal(editor.handTool, false);
            assert.deepEqual([...editor.selection], ['main-spectrum']);
            assert.deepEqual(captures, [1]);
            assert.deepEqual(layout, before);
            assert.equal(view.history.entries.length, 1);
            assert.deepEqual(saved, []);
        }
    });
});

test('Edit navigation keys work without a selection and preserve shortcuts in text controls', async () => {
    await withGlobals({ document: { body: body(1) } }, () => {
        const { editor, view, saved } = setupViewport();
        const press = (key, target = view.stage, extra = {}) => {
            const event = { key, target, preventDefault() { this.prevented = true; }, ...extra };
            editor.onStageKeyDown(event);
            return event.prevented === true;
        };
        const fit = editor.zoom;
        assert.equal(press('+'), true);
        near(editor.zoom, fit * 1.25, 'Zoom key');
        assert.equal(press('-'), true);
        near(editor.zoom, fit, 'Zoom out key');
        editor.panBy(80, 40);
        assert.equal(press('0'), true);
        assert.equal(editor.panX, 0);
        assert.equal(editor.panY, 0);
        for (const key of ['+', '-', '0', ' ']) assert.equal(press(key, { tagName: 'INPUT', type: 'text' }), false);
        assert.equal(press('+', view.stage, { ctrlKey: true }), false);
        assert.equal(press('0', view.stage, { metaKey: true }), false);
        editor.open = false;
        assert.equal(press('+'), false);
        assert.equal(view.history.entries.length, 1);
        assert.deepEqual(saved, []);
    });
});

test('Zoomed group dragging and resizing use design coordinates and can cross every frame edge', async () => {
    for (const zoom of [0.5, 2]) await withGlobals({ document: { body: body(1.5) } }, () => {
        const { editor, view, layout, saved } = setupViewport(1.5);
        editor.zoomAt(zoom);
        editor.panBy(40, -35);
        layout.items = [
            { ...createItem('shape', 'first'), rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
            { ...createItem('shape', 'second'), rect: { x: 0.65, y: 0.1, w: 0.2, h: 0.2 } }
        ];
        editor.selection = new Set(['first', 'second']);
        editor.gridDivisions = 40;
        const first = layout.items[0];
        editor.beginDrag(first, layout.items, { x: 0.15, y: 0.15 });
        editor.drag(pointer(editor, -0.202, 0.353));
        for (const [index, x] of [-0.25, 0.3].entries()) {
            near(layout.items[index].rect.x, x, 'Snapped group X');
            near(layout.items[index].rect.y, 0.3, 'Snapped group Y');
        }
        assert.equal(view.history.entries.length, 1);
        editor.endDrag();
        assert.equal(view.history.entries.length, 2);
        for (const [index, x] of [-0.25, 0.3].entries()) {
            near(saved.at(-1).items[index].rect.x, x, 'Saved group X');
            near(saved.at(-1).items[index].rect.y, 0.3, 'Saved group Y');
        }
        for (const [corner, start, end, expected] of [
            ['nw', { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, [-0.2, -0.3], { x: -0.2, y: -0.3, w: 0.5, h: 0.6 }],
            ['se', { x: 0.8, y: 0.8, w: 0.2, h: 0.2 }, [1.25, 1.35], { x: 0.8, y: 0.8, w: 0.45, h: 0.55 }]
        ]) {
            first.rect = { ...start };
            editor.beginDrag(first, [first], { x: corner === 'nw' ? start.x : start.x + start.w,
                y: corner === 'nw' ? start.y : start.y + start.h }, corner);
            editor.drag(pointer(editor, ...end));
            for (const key of Object.keys(expected)) near(first.rect[key], expected[key], `${corner} ${key}`);
            assert.equal(validateLayout(layout), true);
            editor.endDrag();
        }
    });
});

test('Off-frame marquee selection, nudge, clipboard copies, and paste preserve relative geometry', async () => {
    const clipboard = { text: '' };
    await withGlobals({ document: { body: body(1) }, window: { electronAPI: {
        writeClipboardText: async text => { clipboard.text = text; return true; }
    } } }, async () => {
        const { editor, view } = setupViewport();
        view.layout = offFrameLayout();
        editor.startDrag(pointer(editor, -0.2, 0.7));
        editor.drag(pointer(editor, 0.6, 1.3));
        editor.endDrag();
        assert.deepEqual([...editor.selection], ['off-frame-0']);
        assert.equal(view.history.entries.length, 1, 'Selection is not a layout edit');
        editor.selection = new Set(['off-frame-0', 'off-frame-1']);
        editor.onStageKeyDown({ key: 'ArrowLeft', target: view.stage, preventDefault() {} });
        near(view.layout.items[0].rect.x, -0.15, 'Negative-position nudge');
        near(view.layout.items[1].rect.x, 1.175, 'Outside-position nudge');
        editor.view.commitPending();
        const expected = structuredClone(editor.selectedItems());
        assert.equal(await editor.copySelected(), true);
        assert.deepEqual(JSON.parse(clipboard.text).effetuneVisualizerItems, expected);
        const entries = view.history.entries.length;
        assert.equal(editor.pasteItems(clipboard.text), true);
        const copies = editor.selectedItems();
        assert.equal(view.history.entries.length, entries + 1);
        assert.deepEqual(copies.map(({ rect }) => [rect.x, rect.y]), [[-0.125, 0.825], [1.2, -0.375]]);
        assert.ok(copies.every(copy => !expected.some(source => source.id === copy.id)));
        copies[0].palette.color = '#abcdef';
        assert.equal(view.layout.items[0].palette.color, expected[0].palette.color);
        assert.equal(validateLayout(view.layout), true);
    });
});

test('Portrait editing caps the render surface while playback and clean feed keep their normal resolution', async () => {
    await withGlobals({ document: { body: body(1) }, window: { devicePixelRatio: 2 }, requestAnimationFrame: () => 1 }, () => {
        const { editor, view, layout } = setupViewport();
        const draws = [];
        view.visible = true;
        view.status = {};
        view.sources.getStatus = () => 'ready';
        view.metadata = () => null;
        view.renderer = { quality: 0, draw: (...args) => draws.push(args) };
        view.canvas.getContext = () => ({ clearRect() {}, drawImage() {} });
        layout.aspect = '9:16';
        editor.updateViewport(1280, 800);
        editor.zoomAt(4);
        view.frame(0);
        near(parseFloat(view.stage.style.width), 5120, 'Full CSS zoom width');
        near(parseFloat(view.stage.style.height), 5120 * 16 / 9, 'Full CSS zoom height');
        assert.deepEqual([view.canvas.width, view.canvas.height], [2304, 4096]);
        assert.equal(draws.at(-1).at(-1).editing, true);
        editor.setOpen(false);
        view.frame(16);
        near(parseFloat(view.stage.style.width), 450, 'Playback width fits the viewport');
        assert.deepEqual([view.canvas.width, view.canvas.height], [900, 1600]);
        assert.equal(draws.at(-1).at(-1).editing, false);
        assert.equal(view.stage.style.left, '');
        assert.equal(view.stage.style.top, '');
        editor.setOpen(true);
        assert.equal(editor.fitted, true);
        assert.equal(editor.panX, 0);
        assert.equal(editor.panY, 0);
        editor.zoomAt(4);
        view.feed = { visible: true, canvas: { width: 1920, height: 1080 } };
        view.frame(32);
        assert.deepEqual([view.canvas.width, view.canvas.height], [1920, 1080]);
        assert.deepEqual([view.feed.canvas.width, view.feed.canvas.height], [1920, 1080]);
    });
});

test('Level Meter labels follow items outside either frame edge and keep in-frame labels readable', () => {
    for (const [x, width, labelX, expectedX] of [
        [-0.2, 0.02, 0, -160], [1.1, 0.02, 16, 896],
        [-0.01, 0.05, 4, -4], [0.98, 0.05, 20, 804],
        [0, 0.02, -2, 31.5], [0.98, 0.02, 32, 798.5]
    ]) {
        const labels = [];
        const context = { clearRect() {}, fillRect() {}, save() {}, restore() {},
            translate() {}, scale() {}, drawImage() {},
            measureText: () => ({ width: 33, actualBoundingBoxLeft: 31.5, actualBoundingBoxRight: 1.5 }),
            strokeText(text, left, top) { labels.push(['stroke', text, left, top]); },
            fillText(text, left, top) { labels.push(['fill', text, left, top]); }
        };
        const canvas = { width: 800, height: 400, getContext: () => context };
        const renderer = new VisualizerRenderer(canvas);
        renderer.effects = { apply: (_id, input) => ({ canvas: input, opacity: 1 }), prune() {} };
        renderer.layers.set('background', { type: 'background', canvas, signature: '', frame: null, image: null });
        const item = createItem('level-meter', 'edge-meter');
        item.rect = { x, y: 0.25, w: width, h: 0.5 };
        Object.assign(item.params, { orientation: 'vertical', showLevelValues: true });
        renderer.layers.set(item.id, { type: item.type,
            canvas: { width: Math.round(800 * width), height: 200 },
            display: { draw() {}, overflowLevelValues: [
                { text: '-3.0', x: labelX, y: 32, textAlign: 'right' }
            ] }
        });
        const layout = { ...createDefaultLayout(), items: [item] };
        renderer.draw(layout, { getModulators: () => ({}), getFrame: () => null }, null, 0, { quality: 'high' });
        assert.equal(labels.length, 2);
        assert.deepEqual(labels.map(label => label.slice(0, 2)), [['stroke', '-3.0'], ['fill', '-3.0']]);
        for (const [, , left, top] of labels) {
            near(left, expectedX, `Meter label X at item ${x}`);
            near(top, 132, 'Meter label Y');
        }
    }
});
