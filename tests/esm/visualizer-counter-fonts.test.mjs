import assert from 'node:assert/strict';
import test from 'node:test';
import { COUNTER_DIGIT_FONTS, FONT_FAMILIES, COUNTER_APPEARANCES, applyCounterAppearance,
    createDefaultLayout, createItem, normalizeLayout, encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { VisualizerRenderer } from '../../js/visualizer/visualizer-renderer.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('Counter fonts are selectable and survive normalization/sharing only on Counter items', () => {
    for (const [family] of COUNTER_DIGIT_FONTS) {
        const item = createItem('counter', 'clock');
        item.style.fontFamily = family;
        const layout = { ...createDefaultLayout(), items: [item] };
        assert.equal(decodeLayoutShare(encodeLayoutShare(layout)).items[0].style.fontFamily, family);
        for (const type of ['text', 'lyrics', 'title', 'rhythm-analyzer']) {
            item.type = type;
            assert.equal(normalizeLayout(layout).items[0].style.fontFamily, 'sans-serif');
        }
    }
    for (const type of ['counter', 'text']) {
        const fields = [];
        const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
            t: (_, fallback) => fallback, field: (...args) => fields.push(args), group: parent => parent
        });
        editor.textStyle({}, createItem(type).style, type);
        const choices = fields.find(([, label]) => label === 'Font')[5].values;
        assert.equal(choices.length, FONT_FAMILIES.length + (type === 'counter' ? COUNTER_DIGIT_FONTS.length : 0));
    }
});

test('Counter appearance presets preserve time formatting and unrelated effects without accumulating Glow', () => {
    const item = createItem('counter', 'clock');
    Object.assign(item.params, { counterHours: false, counterWholeDigits: 3, counterZeroPad: false,
        counterDigits: 4, counterSubsecond: 'frames', counterFps: 24, counterTimeSeparator: '-', counterFractionSeparator: ',' });
    const content = structuredClone(item.params);
    const transform = { type: 'transform', enabled: true, angle: 20 };
    item.effects.push(transform);
    for (const [key] of COUNTER_APPEARANCES) {
        assert.equal(applyCounterAppearance(item, key), true);
        applyCounterAppearance(item, key);
        assert.equal(item.effects[0], transform);
        assert.ok(item.effects.filter(effect => effect.type === 'glow').length <= 1);
        for (const parameter of ['counterHours', 'counterWholeDigits', 'counterZeroPad', 'counterDigits',
            'counterSubsecond', 'counterFps', 'counterTimeSeparator', 'counterFractionSeparator']) assert.equal(item.params[parameter], content[parameter]);
        const roundtrip = decodeLayoutShare(encodeLayoutShare({ ...createDefaultLayout(), items: [item] })).items[0];
        assert.deepEqual(roundtrip.params, item.params);
        assert.equal(roundtrip.style.fontFamily, item.style.fontFamily);
    }
});

test('Loading Counter digits invalidates stopped layers and tolerates missing font APIs', async () => {
    const renderer = new VisualizerRenderer({});
    const [family] = COUNTER_DIGIT_FONTS[0];
    const counter = { type: 'counter', signature: 'paused' }, title = { type: 'title', signature: 'cached' };
    renderer.layers.set('clock', counter); renderer.layers.set('title', title);
    await withGlobals({ document: {} }, () => renderer.loadCounterFont(family));
    let complete, calls = 0;
    await withGlobals({ document: { fonts: { load(font, text) {
        calls++;
        assert.equal(font, `16px ${family}`); assert.equal(text, '0123456789');
        return new Promise(resolve => { complete = resolve; });
    } } } }, async () => {
        renderer.loadCounterFont(family); renderer.loadCounterFont(family);
        assert.equal(counter.signature, 'paused');
        complete([{}]);
        await Promise.resolve();
        assert.equal(counter.signature, '');
        assert.equal(title.signature, 'cached');
        assert.equal(calls, 1);
    });
});
