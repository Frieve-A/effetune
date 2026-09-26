import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerRenderer } from '../../js/visualizer/visualizer-renderer.js';
import { createDefaultLayout, createItem } from '../../js/visualizer/visualizer-model.js';
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

test('Gradient direction appears for frequency graphs and keeps octave settings when switching to intensity', async () => {
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
            assert.deepEqual(direction.options.values, [['frequency', 'Frequency'], ['intensity', 'Intensity']]);
            direction.change('intensity');
            render(item);
            assert.equal(fields.find(field => field.label === 'Gradient direction').value, 'intensity');
            assert.equal(fields.some(field => field.label === 'Color mapping'), false);
            assert.equal(item.palette.mapping, 'octave');
            fields.find(field => field.label === 'Gradient direction').change('frequency');
            render(item);
            assert.equal(fields.some(field => field.label === 'Color mapping'), type === 'notes' || type === 'chroma');
            assert.equal(item.palette.mapping, 'octave');
        }
        for (const type of ['oscilloscope', 'stereo', 'level-meter', 'title']) {
            const item = createItem(type, type); item.palette.mode = 'gradient'; render(item);
            assert.equal(fields.some(field => field.label === 'Gradient direction'), false);
        }
        fields.length = 0;
        editor.palette({}, createItem('spectrum').palette);
        assert.equal(fields.some(field => field.label === 'Gradient direction'), false, 'Effects keep their own palettes');
        assert.deepEqual(changes, Array(10).fill(true));
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
    assert.equal(persistence.options.format(1.2), '1.2 s');
    axis.change('balance');
    assert.equal(item.params.ax, 'balance');
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
                    renderer.draw(layout, sources, { title: 'Track' }, 1, { quality, pixelRatio });
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

test('Visualizer dragging and corner resizing stay normalized under body zoom', () => {
    const item = { rect: { x: .1, y: .2, w: .4, h: .3 } };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 500 }) } },
        grid: true, changed() {},
        dragging: { item, point: { x: .1, y: .2 }, rect: { ...item.rect }, corner: null }
    });
    editor.drag({ clientX: 400, clientY: 300 });
    assert.deepEqual(item.rect, { x: .3, y: .5, w: .4, h: .3 });
    editor.dragging = { item, point: { x: .7, y: .8 }, rect: { ...item.rect }, corner: 'se' };
    editor.drag({ clientX: 2100, clientY: 1050 });
    assert.equal(item.rect.x + item.rect.w, 1);
    assert.equal(item.rect.y + item.rect.h, 1);
});

test('Visualizer side handles snap the moved edge while keeping the opposite edge fixed', () => {
    const item = { rect: { x: .103, y: .207, w: .397, h: .293 } };
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) } },
        grid: true, changed() {}
    });
    for (const [side, moved, expected] of [
        ['n', 'top', .275], ['e', 'right', .55], ['s', 'bottom', .55], ['w', 'left', .175]
    ]) {
        const before = { x: .103, y: .207, w: .397, h: .293 };
        item.rect = { ...before };
        editor.dragging = { item, point: { x: 0, y: 0 }, rect: before, corner: side };
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

test('Title, album, and artist use their saved font family, bold, and italic on Canvas', () => {
    const font = [];
    const context = { clearRect() {}, createLinearGradient: () => ({ addColorStop() {} }),
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

test('Stage arrow keys move the selected item by one grid step within the canvas', () => {
    const stage = {}, item = createItem('spectrum', 'move');
    item.rect = { x: .103, y: .2, w: .4, h: .3 };
    let changes = 0;
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        open: true, selection: item.id, view: { stage, layout: { items: [item] } },
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
    assert.equal(item.rect.x, .6);
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
        open: true, selection: source.id, view: { stage, layout: { items } },
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
    editor.selection = source.id; source.rect.x = .6;
    press(stage, { metaKey: true });
    assert.equal(items[1].rect.x, .575);
});

test('Alt body drag duplicates once on movement and resize handles keep the original', () => {
    const source = createItem('spectrum', 'source');
    source.rect = { x: .1, y: .1, w: .4, h: .4 };
    const items = [source];
    const stage = { dataset: {}, closest: () => null, focus() {}, setPointerCapture() {} };
    let changes = 0;
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        open: true, selection: source.id, grid: false,
        view: { stage, layout: { items }, canvas: { getBoundingClientRect: () =>
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
    assert.equal(editor.selection, items[1].id);
    assert.equal(changes, 3);
    editor.endDrag();
    editor.selection = source.id;
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
    const view = { layout, stage: element(), root: element(), changed() {},
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) } };
    await withGlobals({ document: { createElement: element }, localStorage: { getItem: () => null } }, () => {
        const editor = new VisualizerEditor(view);
        editor.render = () => {};
        editor.setOpen(true);
        assert.equal(editor.itemBounds.hidden, false);
        assert.deepEqual(editor.itemBounds.children.map(node => node.dataset.itemId), ['empty-art', 'title']);
        assert.equal(editor.overlay.hidden, true);
        editor.selection = title.id; editor.updateSelection();
        assert.deepEqual(editor.itemBounds.children.map(node => node.dataset.itemId), ['empty-art']);
        assert.equal(editor.overlay.hidden, false);
        assert.equal(editor.overlay.children.length, 8);
        editor.dragging = { item: title, point: { x: .1, y: .2 }, rect: { ...title.rect }, corner: null };
        editor.drag({ clientX: 250, clientY: 200 });
        assert.equal(editor.overlay.style.left, '25%');
        assert.equal(editor.overlay.style.top, '40%');
        editor.endDrag();
        editor.selection = null; editor.updateSelection();
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
