import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createDefaultLayout, normalizeEffect, normalizeLayout, validateLayout,
    encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';

test('Transform defaults are neutral and its affine controls persist in layouts and share links', () => {
    const effect = normalizeEffect({ type: 'transform' });
    assert.equal(effect.amount, 1);
    for (const [key, expected] of Object.entries({ scaleX: 100, scaleY: 100, angle: 0,
        offsetX: 0, offsetY: 0, skewX: 0, skewY: 0 })) assert.equal(effect[key], expected);
    const layout = normalizeLayout(createDefaultLayout());
    Object.assign(effect, { scaleX: 140, scaleY: 75, angle: -30, offsetX: 20, offsetY: -10,
        skewX: 15, skewY: -25, mod: { source: 'bass', depth: .5, speed: 1 } });
    layout.items[0].effects = [effect];
    layout.background.effects = [normalizeEffect({ type: 'transform', scaleX: 120 }, 'background')];
    assert.equal(validateLayout(layout), true);
    const restored = normalizeLayout(layout), shared = decodeLayoutShare(encodeLayoutShare(layout));
    for (const copy of [restored, shared]) {
        assert.equal(validateLayout(copy), true);
        assert.deepEqual(copy.items[0].effects, layout.items[0].effects);
        assert.deepEqual(copy.background.effects, layout.background.effects);
    }
    const bounded = normalizeEffect({ type: 'transform', scaleX: -20, scaleY: 400, angle: -400,
        offsetX: 200, offsetY: -200, skewX: 100, skewY: -100 });
    for (const [key, expected] of Object.entries({ scaleX: 0, scaleY: 300, angle: -180,
        offsetX: 100, offsetY: -100, skewX: 60, skewY: -60 })) assert.equal(bounded[key], expected);
    assert.equal(normalizeEffect({ type: 'transform', scaleX: Infinity }).scaleX, 100);
    assert.equal(normalizeEffect({ type: 'transform', angle: NaN }).angle, 0);
});

test('Transform sliders edit both selected items, display units, and disable with the effect', async () => {
    const layout = createDefaultLayout(), first = layout.items[0], second = structuredClone(first);
    first.effects = [normalizeEffect({ type: 'transform' })];
    second.id = 'second'; second.effects = structuredClone(first.effects); layout.items.push(second);
    const fields = [], node = () => ({ classList: { add() {}, toggle() {} }, appendChild() {},
        insertBefore() {}, setAttribute() {}, firstElementChild: {} });
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { layout, changed() {} }, selection: new Set([first.id, second.id]), baseline: structuredClone(first),
        t: (_key, fallback) => fallback, group: node, button: node, iconButton: node, updateSelection() {},
        field(_parent, label, type, value, change, options) { fields.push({ label, type, value, change, options }); return { value }; }
    });
    await withGlobals({ document: { createElement: node } }, () => {
        editor.effects(node(), first.effects, 'item', 'spectrum');
        const scale = fields.find(field => field.label === 'Horizontal scale');
        const rotation = fields.find(field => field.label === 'Rotation angle (°)');
        assert.equal(scale.type, 'range');
        assert.equal(scale.options.format(100), '100%');
        assert.equal(rotation.options.format(-30), '-30°');
        assert.ok(fields[0].options.values.some(([type]) => type === 'transform'));
        scale.change(145); rotation.change(-30);
        assert.ok(layout.items.every(item => item.effects[0].scaleX === 145 && item.effects[0].angle === -30));
        first.effects[0].enabled = false; fields.length = 0;
        editor.effects(node(), first.effects, 'item', 'spectrum');
        const sliders = fields.filter(field => field.type === 'range');
        assert.equal(sliders.length, 10);
        assert.ok(sliders.every(field => field.options.disabled));
        fields.length = 0;
        editor.effects(node(), [], 'background');
        assert.ok(fields[0].options.values.some(([type]) => type === 'transform'));
    });
});
