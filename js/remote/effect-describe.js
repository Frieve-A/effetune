// Parameter descriptions for the remote `describeEffects` op ("describe1").
// Nothing here is hand-maintained per effect. Every key of an effect's short
// state is described from the first of these sources that knows it:
//   ui      - a throwaway instance builds its UI once while the shared PluginBase
//             control helpers are recorded;
//   catalog - the generated DSP automation catalog (dsp/plugins/*/params.json);
//   hint    - js/remote/parameter-hints.js, for keys that only a graph or a
//             hand-built widget edits in a JS-only effect.
// A key no source knows is still listed with its default value and type.

import { DSP_AUTOMATION_CATALOG } from '../audio/dsp-params.generated.js';
import { getSerializablePluginStateShort } from '../utils/serialization-utils.js';
import { PARAMETER_HINTS } from './parameter-hints.js';

// Keys every stage carries, described once in docs/remote-v1.md.
const COMMON_KEYS = new Set(['nm', 'en']);

function optionList(options) {
    if (!Array.isArray(options)) return undefined;
    return options.map(option => (typeof option === 'object' && option !== null
        ? { value: option.value, label: String(option.label ?? option.value) }
        : { value: option, label: String(option) }));
}

// helper name -> (args) => [modelKey, description]
const RECORDERS = {
    createParameterControl: ([label, min, max, step, , , unit = '', modelKey = null, toDisplay = null, logarithmic = false]) =>
        [modelKey, { control: 'number', label, min, max, step, unit, scale: logarithmic ? 'log' : 'linear', scaled: !!toDisplay }],
    createLogarithmicParameterControl: ([label, min, max, step, , , unit = '', modelKey = null, toDisplay = null]) =>
        [modelKey, { control: 'number', label, min, max, step, unit, scale: 'log', scaled: !!toDisplay }],
    createSelectControl: ([label, options, , , modelKey = null]) =>
        [modelKey, { control: 'select', label, options: optionList(options) }],
    createRadioGroup: ([label, options, , , modelKey = null]) =>
        [modelKey, { control: 'select', label, options: optionList(options) }],
    createCheckboxControl: ([label, , , modelKey = null]) =>
        [modelKey, { control: 'checkbox', label }]
};

function valueType(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

function recordControls(plugin) {
    const controls = new Map();
    for (const [helper, recorder] of Object.entries(RECORDERS)) {
        const original = plugin[helper];
        if (typeof original !== 'function') continue;
        // Shadow the prototype method on this instance only.
        plugin[helper] = function (...args) {
            try {
                const [modelKey, description] = recorder(args);
                if (typeof modelKey === 'string' && !controls.has(modelKey)) controls.set(modelKey, description);
            } catch (_) { /* recording never breaks the UI build */ }
            return original.apply(this, args);
        };
    }
    return controls;
}

// ---- catalog -------------------------------------------------------------

function fromDescriptor(d) {
    const label = d.title;
    if (d.kind === 'bool') return { control: 'checkbox', label };
    if (d.kind === 'enum') return { control: 'select', label, options: optionList(d.values) };
    return {
        control: 'number', label, min: d.minimum, max: d.maximum, step: d.step, unit: d.unit || '',
        scale: d.normalization === 'log' ? 'log' : 'linear', ...(d.kind === 'int' ? { integer: true } : {})
    };
}

// One description when every element shares it, else one per element.
function perElement(descriptors) {
    const list = [...descriptors].sort((a, b) => a.element - b.element).map(fromDescriptor);
    const first = JSON.stringify(list[0]);
    return list.every(item => JSON.stringify(item) === first) ? { items: list[0] } : { elements: list };
}

function groupBy(list, keyOf) {
    const map = new Map();
    for (const item of list) {
        const key = keyOf(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}

function fromCatalog(descriptors, key, value) {
    if (!descriptors?.length) return null;
    // Arrays: a container (`bands` of objects, or `m` of values) or a counted field.
    const contained = descriptors.filter(d => d.containerKey === key);
    if (contained.length) {
        if (contained.every(d => d.memberKey)) {
            const members = {};
            for (const [member, list] of groupBy(contained, d => d.memberKey)) {
                const described = perElement(list);
                members[member] = described.items || described.elements;
            }
            return { members };
        }
        return perElement(contained);
    }
    const direct = descriptors.filter(d => !d.containerKey && d.key === key);
    if (Array.isArray(value) && direct.length) return perElement(direct);
    if (direct.length) return fromDescriptor(direct.find(d => d.element === 0) || direct[0]);
    // A counted field flattened into numbered keys: `f` element 2 is `f2`.
    const numbered = descriptors.find(d => !d.containerKey && `${d.key}${d.element}` === key);
    return numbered ? fromDescriptor(numbered) : null;
}

// ---- describe ------------------------------------------------------------

function describeKey(key, value, { controls, hints, descriptors }) {
    const base = { key, type: valueType(value), default: value };
    const ui = controls.get(key);
    const catalog = fromCatalog(descriptors, key, value);
    if (ui) {
        // A scaled control shows a converted view; the catalog knows the stored range.
        const stored = ui.scaled && catalog?.control === 'number' ? { value: { min: catalog.min, max: catalog.max } } : {};
        return { ...base, source: 'ui', ...ui, ...stored };
    }
    if (catalog) return { ...base, source: 'catalog', ...catalog };
    const hint = hints && Object.hasOwn(hints, key) ? hints[key] : null;
    if (hint) return { ...base, source: 'hint', ...hint };
    return base;
}

export function describeEffect(pluginManager, name, { catalog = DSP_AUTOMATION_CATALOG, hints = PARAMETER_HINTS } = {}) {
    const plugin = pluginManager.createPlugin(name, { audioHostActive: false });
    // Defaults first: building the UI must not be able to change them.
    const state = getSerializablePluginStateShort(plugin);
    const parameterHints = hints?.[plugin.constructor?.name];
    const resolvedHints = typeof parameterHints === 'function' ? parameterHints(plugin) : parameterHints;
    const controls = recordControls(plugin);
    let ui = true;
    try {
        plugin.createUI();
    } catch (_) {
        ui = false;
    } finally {
        try { plugin.cleanup?.(); } catch (_) { /* best effort */ }
    }
    const sources = {
        controls,
        hints: resolvedHints || null,
        descriptors: catalog?.[plugin.constructor?.name] || null
    };
    const params = [];
    for (const [key, value] of Object.entries(state)) {
        if (COMMON_KEYS.has(key)) continue;
        params.push(describeKey(key, value, sources));
    }
    return { nm: name, params, ...(ui ? {} : { uiError: true }) };
}

function categoryOf(effectCategories) {
    const map = new Map();
    for (const [category, entry] of Object.entries(effectCategories || {})) {
        for (const nm of entry?.plugins || []) map.set(nm, category);
    }
    return map;
}

export function describeEffects(pluginManager, options) {
    const categories = categoryOf(pluginManager.effectCategories);
    const effects = [];
    for (const name of Object.keys(pluginManager.pluginClasses || {}).sort()) {
        const category = categories.get(name);
        try {
            effects.push({ ...describeEffect(pluginManager, name, options), ...(category ? { category } : {}) });
        } catch (error) {
            effects.push({ nm: name, ...(category ? { category } : {}), params: [], error: String(error?.message || error) });
        }
    }
    return effects;
}
