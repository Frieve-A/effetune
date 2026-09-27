import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerHistory, layoutSnapshot } from '../../js/visualizer/visualizer-history.js';
import { createDefaultLayout, createItem, encodeLayoutShare, MAX_ITEMS } from '../../js/visualizer/visualizer-model.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function item(id, x, y, w = .2, h = .2) {
    const value = createItem('spectrum', id);
    value.rect = { x, y, w, h };
    return value;
}

// A view and editor wired together with the DOM, storage, and rendering stubbed out.
function setup(items = []) {
    const layout = createDefaultLayout();
    layout.items = items;
    const warnings = [];
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout, history: new VisualizerHistory(), undoButton: {}, redoButton: {}, cutButton: {}, copyButton: {},
        root: { contains: target => target?.inRoot === true },
        stage: { focus() {}, setPointerCapture() {} },
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) },
        applyLayout() {}, warn: (...args) => warnings.push(args)
    });
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view, open: true, selection: new Set(), anchor: null, gridDivisions: 0,
        marquee: { hidden: true, style: {} }, render() {}, updateSelection() {}
    });
    view.editor = editor;
    view.recordHistory();
    return { view, editor, layout, warnings };
}

const pointer = (x, y, extra = {}) => ({ target: { dataset: {}, closest: () => null }, clientX: x * 1000, clientY: y * 1000,
    pointerId: 1, preventDefault() {}, ...extra });
const ids = editor => [...editor.selection];
const flush = () => new Promise(resolve => setImmediate(resolve));
const rects = items => items.map(({ rect }) => [Math.round(rect.x * 1e9) / 1e9, Math.round(rect.y * 1e9) / 1e9]);

test('Visualizer history skips identical states, drops redo on a new edit, and caps its length', () => {
    const history = new VisualizerHistory();
    const layout = createDefaultLayout();
    layout.background.image = 'data:image/jpeg;base64,AAAA';
    history.record(layoutSnapshot(layout));
    history.record(layoutSnapshot(layout));
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].image, layout.background.image);
    assert.equal(JSON.parse(history.entries[0].json).background.image, null);
    layout.aspect = '4:3'; history.record(layoutSnapshot(layout));
    history.undo();
    layout.aspect = '1:1'; history.record(layoutSnapshot(layout));
    assert.equal(history.canRedo, false);
    assert.equal(history.entries.length, 2);
    for (let index = 0; index < 120; index++) { layout.background.color = `#0000${String(index).padStart(2, '0')}`; history.record(layoutSnapshot(layout)); }
    assert.equal(history.entries.length, 100);
    assert.equal(history.index, 99);
});

test('Drags, Alt+drag copies, and slider input each record one history entry when they end', async () => {
    const { view, editor, layout } = setup([item('a', .1, .1)]);
    editor.selection = new Set(['a']);
    editor.startDrag(pointer(.15, .15));
    for (const x of [.2, .25, .3]) editor.drag(pointer(x, .15));
    assert.equal(view.history.entries.length, 1);
    editor.endDrag();
    assert.equal(view.history.entries.length, 2);
    editor.startDrag(pointer(.35, .15, { altKey: true }));
    editor.drag(pointer(.4, .15)); editor.drag(pointer(.45, .2));
    editor.endDrag();
    assert.equal(layout.items.length, 2);
    assert.equal(view.history.entries.length, 3);
    const listeners = {};
    const element = () => ({ style: {}, dataset: {}, append() {}, appendChild() {}, setAttribute() {},
        addEventListener(type, listener) { (listeners[type] ||= []).push(listener); } });
    await withGlobals({ document: { createElement: element } }, () => {
        editor.root = { contains: () => false };
        const input = editor.field({ appendChild() {} }, 'Gain', 'range', 0, value => { layout.items[0].params.gainDb = value; editor.changed(); });
        for (const value of [1, 2, 3]) { input.value = value; listeners.input.forEach(listener => listener()); }
        assert.equal(view.history.entries.length, 3);
        listeners.change.forEach(listener => listener());
    });
    assert.equal(view.history.entries.length, 4);
    assert.equal(editor.inputActive, false);
});

test('Undo and Redo restore layouts without adding entries and prune the selection', () => {
    const { view, editor, layout } = setup([item('a', .1, .1)]);
    layout.items.push(item('b', .5, .5)); editor.selection = new Set(['a', 'b']); editor.anchor = 'b'; editor.changed(true);
    view.stepHistory('undo');
    assert.deepEqual(view.layout.items.map(value => value.id), ['a']);
    assert.deepEqual(ids(editor), ['a']);
    assert.equal(editor.anchor, null);
    assert.equal(view.history.entries.length, 2);
    view.stepHistory('redo');
    assert.deepEqual(view.layout.items.map(value => value.id), ['a', 'b']);
    assert.equal(view.redoButton.disabled, true);
    assert.equal(view.undoButton.disabled, false);
    const preset = createDefaultLayout(); preset.items = [item('c', 0, 0)];
    view.setLayout(preset);
    assert.deepEqual(ids(editor), []);
    view.stepHistory('undo');
    assert.deepEqual(view.layout.items.map(value => value.id), ['a', 'b']);
});

test('Ctrl+click toggles, Ctrl+A selects all, and a selection moves as a group', async () => {
    const { view, editor, layout } = setup([item('a', .1, .1), item('b', .5, .3), item('c', .7, .7)]);
    editor.startDrag(pointer(.15, .15));
    editor.endDrag();
    editor.startDrag(pointer(.55, .35, { ctrlKey: true }));
    assert.equal(editor.dragging, null);
    assert.deepEqual(ids(editor), ['a', 'b']);
    editor.startDrag(pointer(.55, .35, { metaKey: true }));
    assert.deepEqual(ids(editor), ['a']);
    await withGlobals({ document: { body: { classList: { contains: name => name === 'view-visualizer' } } } }, () => {
        view.onEditKeyDown({ key: 'a', ctrlKey: true, target: { inRoot: true, matches: () => false }, preventDefault() {} });
    });
    assert.deepEqual(ids(editor), ['a', 'b', 'c']);
    editor.selection = new Set(['a', 'b']);
    editor.startDrag(pointer(.55, .35));
    editor.drag(pointer(.6, .3));
    assert.deepEqual(rects(layout.items.slice(0, 2)), [[.15, .05], [.55, .25]]);
    editor.drag(pointer(.95, .35));
    assert.ok(Math.abs(layout.items[1].rect.x - .8) < 1e-9, 'the group stops at the right edge');
    assert.ok(Math.abs(layout.items[0].rect.x - .4) < 1e-9, 'relative placement is kept');
    editor.endDrag();
    assert.deepEqual(ids(editor), ['a', 'b']);
    editor.startDrag(pointer(.45, .15));
    editor.endDrag();
    assert.deepEqual(ids(editor), ['a'], 'clicking a selected item without moving selects only it');
    const stage = view.stage;
    editor.selection = new Set(['a', 'b']);
    editor.onStageKeyDown({ key: 'ArrowRight', target: stage, preventDefault() {} });
    assert.ok(Math.abs(layout.items[1].rect.x - .8) < 1e-9 && Math.abs(layout.items[0].rect.x - .4) < 1e-9);
    editor.onStageKeyDown({ key: 'ArrowLeft', target: stage, preventDefault() {} });
    assert.ok(Math.abs(layout.items[0].rect.x - .375) < 1e-9 && Math.abs(layout.items[1].rect.x - .775) < 1e-9);
});

test('Ctrl+D duplicates the selection as one entry after the frontmost item and respects the item limit', () => {
    const { view, editor, layout, warnings } = setup([item('a', .1, .1), item('b', .5, .3), item('c', .7, .7)]);
    editor.selection = new Set(['c', 'a']);
    const before = view.history.entries.length;
    editor.onStageKeyDown({ key: 'd', ctrlKey: true, target: view.stage, preventDefault() {}, stopPropagation() {} });
    assert.equal(view.history.entries.length, before + 1);
    assert.deepEqual(layout.items.slice(0, 3).map(value => value.id), ['a', 'b', 'c']);
    const copies = layout.items.slice(3);
    assert.deepEqual(ids(editor), copies.map(value => value.id));
    assert.deepEqual(rects(copies), [[.125, .125], [.725, .725]]);
    while (layout.items.length < MAX_ITEMS - 1) layout.items.push(item(`fill-${layout.items.length}`, 0, 0));
    const count = layout.items.length;
    editor.onStageKeyDown({ key: 'd', ctrlKey: true, target: view.stage, preventDefault() {}, stopPropagation() {} });
    assert.equal(layout.items.length, count);
    assert.equal(warnings.length, 1);
});

test('Delete removes every selected item from any non-text control, and Esc clears the selection', async () => {
    const { view, editor, layout } = setup([item('a', .1, .1), item('b', .5, .3), item('c', .7, .7)]);
    const press = (key, target, extra = {}) => {
        let prevented = false;
        view.onEditKeyDown({ key, target, preventDefault() { prevented = true; }, ...extra });
        return prevented;
    };
    await withGlobals({ document: { body: { classList: { contains: name => name === 'view-visualizer' } } } }, () => {
        editor.selection = new Set(['a', 'b']);
        assert.equal(press('Delete', { tagName: 'INPUT', type: 'text', inRoot: true }), false);
        assert.equal(layout.items.length, 3);
        assert.equal(press('Delete', { tagName: 'INPUT', type: 'range', inRoot: true }), true);
        assert.deepEqual(layout.items.map(value => value.id), ['c']);
        assert.deepEqual(ids(editor), []);
        assert.equal(press('Delete', { tagName: 'BUTTON', inRoot: true }), false, 'an empty selection leaves Delete alone');
        editor.selection = new Set(['c']);
        assert.equal(press('Escape', { inRoot: true }, { defaultPrevented: true }), false);
        assert.equal(press('Escape', { tagName: 'TEXTAREA', inRoot: true }), false);
        assert.equal(press('Escape', { inDialog: true }), false);
        assert.equal(press('Escape', { inRoot: true }), true);
        assert.deepEqual(ids(editor), []);
        layout.items.push(item('d', 0, 0)); view.changed();
        assert.equal(press('z', { tagName: 'INPUT', type: 'text', inRoot: true }, { ctrlKey: true }), false);
        assert.equal(press('z', { tagName: 'INPUT', type: 'range', inRoot: true }, { ctrlKey: true }), true);
        assert.deepEqual(view.layout.items.map(value => value.id), ['c']);
        editor.open = false;
        assert.equal(press('y', { tagName: 'INPUT', type: 'range', inRoot: true }, { ctrlKey: true }), false);
    });
});

test('Shift+click selects a range from the anchor and marquee selection adds fully enclosed items', () => {
    const { view, editor, layout } = setup([item('a', .1, .1), item('b', .5, .3), item('c', .7, .7), item('d', .1, .7)]);
    editor.startDrag(pointer(.55, .35, { shiftKey: true }));
    assert.deepEqual(ids(editor), ['b'], 'without an anchor Shift+click selects like a normal click');
    editor.endDrag();
    editor.startDrag(pointer(.75, .75, { shiftKey: true }));
    assert.equal(editor.dragging, null);
    assert.deepEqual(ids(editor), ['b', 'c']);
    assert.equal(editor.anchor, 'b');
    editor.startDrag(pointer(.15, .15, { shiftKey: true }));
    assert.deepEqual(ids(editor), ['a', 'b']);
    const entries = view.history.entries.length;
    editor.startDrag(pointer(.05, .05));
    assert.deepEqual(ids(editor), []);
    editor.drag(pointer(.75, .55));
    assert.equal(editor.marquee.hidden, false);
    assert.deepEqual(ids(editor), ['a', 'b']);
    editor.endDrag();
    assert.equal(editor.marquee.hidden, true);
    editor.startDrag(pointer(.05, .65, { ctrlKey: true }));
    editor.drag(pointer(.35, .95));
    editor.endDrag();
    assert.deepEqual(ids(editor), ['a', 'b', 'd']);
    assert.equal(view.history.entries.length, entries);
    assert.deepEqual(rects(layout.items), [[.1, .1], [.5, .3], [.7, .7], [.1, .7]]);
});

// Globals for the clipboard paths: the Visualizer view is showing and the Electron clipboard holds `clip.text`.
const clipboardGlobals = (clip, writes = true) => ({
    document: { body: { classList: { contains: name => name === 'view-visualizer' } } },
    window: { electronAPI: {
        writeClipboardText: async text => { if (writes) clip.text = text; return writes; },
        readClipboardText: async () => clip.text
    } },
    console: { ...console, error() {} }
});
const withMessages = view => {
    const messages = [];
    view.uiManager = { t: key => key, showTransientMessage: (message, isError) => messages.push([message, isError]) };
    return messages;
};

test('Copy and Paste insert independent copies one grid step away as one entry, and Ctrl+X cuts', async () => {
    const { view, editor, layout } = setup([item('a', .1, .1), item('b', .5, .3), item('c', .7, .7)]);
    const messages = withMessages(view);
    const clip = { text: '' };
    const press = (key, extra = {}) => {
        let prevented = false;
        view.onEditKeyDown({ key, ctrlKey: true, target: { inRoot: true, matches: () => false }, preventDefault() { prevented = true; }, ...extra });
        return prevented;
    };
    await withGlobals(clipboardGlobals(clip), async () => {
        assert.equal(press('c'), false, 'Copy with nothing selected is left to the browser');
        editor.selection = new Set(['a', 'b']);
        assert.equal(press('c'), true);
        await flush();
        assert.deepEqual(messages.at(-1), ['Copied the selected items.', false]);
        const entries = view.history.entries.length;
        assert.equal(await view.pasteFromClipboard(), true);
        assert.equal(view.history.entries.length, entries + 1);
        const copies = layout.items.slice(2, 4);
        assert.deepEqual(ids(editor), copies.map(value => value.id));
        assert.ok(copies.every(copy => !['a', 'b', 'c'].includes(copy.id)));
        assert.deepEqual(rects(copies), [[.125, .125], [.525, .325]]);
        copies[0].params.gainDb = 6;
        assert.equal(layout.items[0].params.gainDb, 0, 'copies do not share state with the originals');
        editor.selection = new Set(['c']);
        assert.equal(press('x'), true);
        await flush();
        assert.equal(layout.items.some(value => value.id === 'c'), false);
        assert.deepEqual(JSON.parse(clip.text).effetuneVisualizerItems.map(value => value.id), ['c']);
    });
});

test('Cut keeps the items when copying fails', async () => {
    const { view, editor, layout, warnings } = setup([item('a', .1, .1)]);
    withMessages(view);
    editor.selection = new Set(['a']);
    await withGlobals(clipboardGlobals({ text: '' }, false), () => editor.cutSelected());
    assert.deepEqual(layout.items.map(value => value.id), ['a']);
    assert.deepEqual(ids(editor), ['a']);
    assert.equal(warnings.at(-1)[0], 'visualizer.copyFailed');
});

test('Paste imports a share link in Edit and explains when there is nothing to paste', async () => {
    const { view, editor, warnings } = setup([item('a', .1, .1)]);
    const messages = withMessages(view);
    const shared = createDefaultLayout(); shared.items = [item('s', .2, .2)];
    const link = `https://frieve-a.github.io/effetune/effetune.html?v=${encodeLayoutShare(shared)}`;
    assert.equal(await view.importFromText(link), true);
    assert.deepEqual(view.layout.items.map(value => value.id), ['s']);
    assert.equal(messages.at(-1)[1], false);
    assert.equal(view.importFromText('plain text'), false);
    assert.equal(warnings.at(-1)[0], 'visualizer.pasteNothing');
    assert.equal(view.importFromText('{"effetuneVisualizerItems":[{"type":"unknown"}]}'), false);
    editor.open = false;
    assert.equal(view.importFromText('plain text'), false);
    assert.equal(warnings.at(-1)[0], 'visualizer.importLinkMissing');
});

test('A bulk edit changes only the edited value on every selected item of one type as one entry', () => {
    const { view, editor, layout } = setup([item('a', .1, .1), item('b', .5, .3), item('c', .7, .7)]);
    layout.items[1].params.dr = -60;
    editor.selection = new Set(['a', 'b']);
    editor.takeBaseline();
    const entries = view.history.entries.length;
    layout.items[0].params.gainDb = 6;
    layout.items[0].palette.color = '#ff0000';
    editor.changed();
    assert.equal(view.history.entries.length, entries + 1);
    assert.deepEqual(layout.items.map(value => value.params.gainDb), [6, 6, 0]);
    assert.equal(layout.items[1].palette.color, '#ff0000');
    assert.equal(layout.items[1].params.dr, -60, 'values that were not edited keep their own setting');
    assert.deepEqual(rects(layout.items.slice(0, 2)), [[.1, .1], [.5, .3]]);
    layout.items.push(createItem('title', 't'));
    editor.selection = new Set(['a', 't']);
    editor.takeBaseline();
    assert.equal(editor.baseline, null, 'mixed item types have no shared settings');
});

test('Pasting over a bulk selection does not copy the pasted values onto other items', () => {
    const { editor, layout } = setup([item('a', .1, .1), item('b', .5, .3)]);
    editor.selection = new Set(['a', 'b']);
    editor.takeBaseline();
    const sources = [item('x', .1, .5), item('y', .5, .5)];
    sources[0].params.gainDb = 9;
    assert.equal(editor.pasteItems(JSON.stringify({ effetuneVisualizerItems: sources })), true);
    assert.deepEqual(layout.items.map(value => value.params.gainDb), [0, 0, 9, 0]);
});

test('Reordering moves the whole selection and alignment uses the selection bounds', () => {
    const { view, editor, layout } = setup(['a', 'b', 'c', 'd'].map((id, index) => item(id, .1 * index, .2 * index, .1 + .05 * index, .1)));
    editor.selection = new Set(['a', 'c']);
    const order = kind => editor.reorderedItems(kind).map(value => value.id);
    assert.deepEqual(order('up'), ['a', 'c', 'b', 'd']);
    assert.deepEqual(order('down'), ['b', 'a', 'd', 'c']);
    assert.deepEqual(order('front'), ['b', 'd', 'a', 'c']);
    assert.deepEqual(order('back'), ['a', 'c', 'b', 'd']);
    const entries = view.history.entries.length;
    editor.align('right');
    assert.equal(view.history.entries.length, entries + 1);
    assert.deepEqual(rects([layout.items[0], layout.items[2]]), [[.3, 0], [.2, .4]]);
    editor.align('vcenter');
    assert.deepEqual(rects([layout.items[0], layout.items[2]]), [[.3, .2], [.2, .2]]);
    assert.deepEqual(rects([layout.items[1], layout.items[3]]), [[.1, .2], [.3, .6]]);
});
