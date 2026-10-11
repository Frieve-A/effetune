import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { bindNumberInput } from '../../js/ui/range-fill.js';
import { describeEffect, describeEffects } from '../../js/remote/effect-describe.js';

const [baseSource, volumeSource] = await Promise.all([
    fs.readFile(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../plugins/basics/volume.js', import.meta.url), 'utf8')
]);

class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.className = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener() {}
    setAttribute(name, value) { this[name] = value; }
}

// A hand-written effect that exercises every recorded helper, a key no helper
// names, and a key whose widget shows a scaled view of the stored value.
const sampleSource = `
class SampleDescribePlugin extends PluginBase {
    constructor() {
        super('Sample', 'test effect');
        this.fq = 1000; this.md = 'A'; this.on = true; this.ty = 'x'; this.gn = 0.5; this.lv = 0.2; this.cv = [1, 2];
    }
    getParameters() {
        return { type: this.constructor.name, enabled: this.enabled,
            fq: this.fq, md: this.md, on: this.on, ty: this.ty, gn: this.gn, lv: this.lv, cv: this.cv };
    }
    createUI() {
        const c = document.createElement('div');
        c.appendChild(this.createLogarithmicParameterControl('Freq', 20, 20000, 1, this.fq, () => {}, 'Hz', 'fq'));
        c.appendChild(this.createSelectControl('Mode', ['A', { value: 'B', label: 'Bee' }], this.md, () => {}, 'md'));
        c.appendChild(this.createCheckboxControl('On', this.on, () => {}, 'on'));
        c.appendChild(this.createRadioGroup('Type', ['x', 'y'], this.ty, () => {}, 'ty'));
        c.appendChild(this.createParameterControl('Gain', -100, 100, 1, this.gn * 100, () => {}, '%', 'gn', v => v * 100));
        c.appendChild(this.createParameterControl('Level', 0, 1, 0.01, this.lv, () => {}, '', 'lv'));
        return c;
    }
}
window.SampleDescribePlugin = SampleDescribePlugin;
class BrokenUiPlugin extends PluginBase {
    constructor() { super('Broken', 'test effect'); this.vl = 3; }
    getParameters() { return { type: this.constructor.name, enabled: this.enabled, vl: this.vl }; }
    createUI() { throw new Error('no ui here'); }
}
window.BrokenUiPlugin = BrokenUiPlugin;
class CatalogDescribePlugin extends PluginBase {
    constructor() {
        super('Catalog', 'test effect');
        this.f0 = 100; this.f1 = 200; this.bands = [{ t: -20, r: 4 }, { t: -10, r: 2 }]; this.m = [false, false];
        this.lv = [0, 0]; this.gn = 0.5; this.cm = 'note'; this.zz = 1;
    }
    getParameters() {
        return { type: this.constructor.name, enabled: this.enabled, f0: this.f0, f1: this.f1, bands: this.bands,
            m: this.m, lv: this.lv, gn: this.gn, cm: this.cm, zz: this.zz };
    }
    createUI() {
        const c = document.createElement('div');
        c.appendChild(this.createParameterControl('Gain', -100, 100, 1, this.gn * 100, () => {}, '%', 'gn', v => v * 100));
        return c;
    }
}
window.CatalogDescribePlugin = CatalogDescribePlugin;
`;

function loadClasses() {
    const window = {};
    const context = vm.createContext({
        bindEffeTuneNumberInput: bindNumberInput,
        window,
        document: { createElement: tag => new Element(tag) },
        MutationObserver: class { observe() {} disconnect() {} },
        console, setTimeout, clearTimeout
    });
    vm.runInContext(`${baseSource}\n${volumeSource}\n${sampleSource}`, context);
    return window;
}

// The wire format is JSON; it also strips the vm realm from arrays built by plugins.
const wire = value => JSON.parse(JSON.stringify(value));

function fakePluginManager(classes, categories = {}) {
    let nextId = 1;
    return {
        pluginClasses: classes,
        effectCategories: categories,
        createPlugin(name) {
            const plugin = new classes[name]();
            plugin.id = nextId++;
            return plugin;
        }
    };
}

test('Volume is described with its short key, default and slider range', () => {
    const window = loadClasses();
    const manager = fakePluginManager({ Volume: window.VolumePlugin });
    const described = wire(describeEffect(manager, 'Volume'));
    assert.equal(described.nm, 'Volume');
    assert.equal(described.uiError, undefined);
    assert.deepEqual(described.params, [{
        key: 'vl', type: 'number', default: 0, source: 'ui',
        control: 'number', label: 'Volume', min: -60, max: 24, step: 0.1, unit: 'dB', scale: 'linear', scaled: false
    }]);
});

test('every PluginBase helper is recorded and hand-built keys keep only default and type', () => {
    const window = loadClasses();
    const manager = fakePluginManager({ Sample: window.SampleDescribePlugin });
    const byKey = Object.fromEntries(wire(describeEffect(manager, 'Sample')).params.map(p => [p.key, p]));
    assert.deepEqual(Object.keys(byKey).sort(), ['cv', 'fq', 'gn', 'lv', 'md', 'on', 'ty']);
    assert.equal(byKey.fq.scale, 'log');
    assert.equal(byKey.fq.unit, 'Hz');
    assert.deepEqual(byKey.md.options, [{ value: 'A', label: 'A' }, { value: 'B', label: 'Bee' }]);
    assert.equal(byKey.md.control, 'select');
    assert.equal(byKey.ty.control, 'select');
    assert.equal(byKey.on.control, 'checkbox');
    assert.equal(byKey.on.type, 'boolean');
    assert.equal(byKey.gn.scaled, true);
    assert.equal(byKey.lv.scaled, false);
    assert.deepEqual(byKey.cv, { key: 'cv', type: 'array', default: [1, 2] });
});

test('recording stays on the throwaway instance', () => {
    const window = loadClasses();
    const manager = fakePluginManager({ Volume: window.VolumePlugin });
    describeEffect(manager, 'Volume');
    const fresh = new window.VolumePlugin();
    assert.equal(Object.hasOwn(fresh, 'createParameterControl'), false);
});

test('describeEffects sorts effects, adds categories and survives a failing UI or constructor', () => {
    const window = loadClasses();
    const manager = fakePluginManager({
        Volume: window.VolumePlugin,
        Broken: window.BrokenUiPlugin,
        Throws: class { constructor() { throw new Error('boom'); } }
    }, { Basics: { description: 'Basic', plugins: ['Volume'] } });
    const effects = wire(describeEffects(manager));
    assert.deepEqual(effects.map(e => e.nm), ['Broken', 'Throws', 'Volume']);
    assert.equal(effects[0].uiError, true);
    assert.deepEqual(effects[0].params, [{ key: 'vl', type: 'number', default: 3 }]);
    assert.equal(effects[1].error, 'boom');
    assert.equal(effects[2].category, 'Basics');
});

const d = (fields) => ({ element: 0, containerKey: '', memberKey: '', kind: 'float', normalization: 'linear', step: 1, unit: '', ...fields });
const HINTS = { CatalogDescribePlugin: { cm: { format: 'text', label: 'Comment' }, f0: { format: 'ignored' } } };
const CATALOG = {
    CatalogDescribePlugin: [
        d({ key: 'f', element: 0, minimum: 20, maximum: 20000, unit: 'Hz', title: 'Frequency', normalization: 'log' }),
        d({ key: 'f', element: 1, minimum: 20, maximum: 20000, unit: 'Hz', title: 'Frequency', normalization: 'log' }),
        d({ key: 't', element: 0, containerKey: 'bands', memberKey: 't', minimum: -60, maximum: 0, title: 'Threshold' }),
        d({ key: 't', element: 1, containerKey: 'bands', memberKey: 't', minimum: -60, maximum: 0, title: 'Threshold' }),
        d({ key: 'r', element: 0, containerKey: 'bands', memberKey: 'r', minimum: 1, maximum: 20, title: 'Ratio', kind: 'int' }),
        d({ key: 'r', element: 1, containerKey: 'bands', memberKey: 'r', minimum: 1, maximum: 10, title: 'Ratio', kind: 'int' }),
        d({ key: 'm', element: 0, containerKey: 'm', kind: 'bool', title: 'Mute' }),
        d({ key: 'm', element: 1, containerKey: 'm', kind: 'bool', title: 'Mute' }),
        d({ key: 'lv', element: 0, kind: 'enum', values: ['a', 'b'], title: 'Level' }),
        d({ key: 'lv', element: 1, kind: 'enum', values: ['a', 'b'], title: 'Level' }),
        d({ key: 'gn', minimum: 0, maximum: 1, title: 'Gain' })
    ]
};

test('keys without a helper control are described from the DSP catalog, then from the parameter hints', () => {
    const window = loadClasses();
    const manager = fakePluginManager({ Catalog: window.CatalogDescribePlugin });
    const byKey = Object.fromEntries(wire(describeEffect(manager, 'Catalog', { catalog: CATALOG, hints: HINTS })).params.map(p => [p.key, p]));
    const frequency = { control: 'number', label: 'Frequency', min: 20, max: 20000, step: 1, unit: 'Hz', scale: 'log' };
    assert.deepEqual(byKey.f0, { key: 'f0', type: 'number', default: 100, source: 'catalog', ...frequency });
    assert.deepEqual(byKey.f1, { key: 'f1', type: 'number', default: 200, source: 'catalog', ...frequency });
    assert.deepEqual(byKey.bands.members.t, { control: 'number', label: 'Threshold', min: -60, max: 0, step: 1, unit: '', scale: 'linear' });
    assert.deepEqual(byKey.bands.members.r.map(r => r.max), [20, 10]);
    assert.equal(byKey.bands.members.r[0].integer, true);
    assert.deepEqual(byKey.m.items, { control: 'checkbox', label: 'Mute' });
    assert.deepEqual(byKey.lv.items.options, [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }]);
    assert.equal(byKey.gn.source, 'ui');
    assert.deepEqual(byKey.gn.value, { min: 0, max: 1 });
    assert.deepEqual(byKey.cm, { key: 'cm', type: 'string', default: 'note', source: 'hint', format: 'text', label: 'Comment' });
    assert.deepEqual(byKey.zz, { key: 'zz', type: 'number', default: 1 });
});
