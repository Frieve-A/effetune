import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [baseSource, effectSource] = await Promise.all([
    fs.readFile(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../plugins/resonator/adaptive_prediction_effect.js', import.meta.url), 'utf8')
]);

class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.listeners = new Map();
        this.className = '';
        this.classList = {
            toggle: (name, enabled) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                if (enabled) classes.add(name); else classes.delete(name);
                this.className = [...classes].join(' ');
            }
        };
    }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    setAttribute(name, value) { this[name] = value; }
    matches() { return false; }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [
            ...(child.tagName.toLowerCase() === selector ? [child] : []),
            ...child.querySelectorAll(selector)
        ]);
    }
}

function effect() {
    const window = {};
    const context = vm.createContext({
        window,
        document: { createElement: tag => new Element(tag) },
        MutationObserver: class { observe() {} disconnect() {} },
        console, setTimeout, clearTimeout
    });
    vm.runInContext(`${baseSource}\n${effectSource}`, context);
    const plugin = new window.AdaptivePredictionEffectPlugin();
    plugin.id = 11;
    return plugin;
}

function inputs(plugin, key) {
    return plugin._parameterRows.get(key).querySelectorAll('input');
}

test('APE Hold preserves independent settings and refreshes controls after external changes', () => {
    const plugin = effect();
    plugin.createUI();
    plugin.setParameters({ autonomy: 0.45, weightDecay: 20, hold: true });
    assert.equal(plugin.autonomy, 0.45);
    assert.equal(plugin.freeze, false);
    for (const key of ['autonomy', 'learn', 'weightDecay']) {
        assert.ok(inputs(plugin, key).every(input => input.disabled));
    }
    assert.equal(plugin._freezeRow.querySelectorAll('input')[0].disabled, true);
    assert.equal(plugin._freezeRow.querySelectorAll('input')[0].checked, true);
    assert.equal(Number(inputs(plugin, 'autonomy')[1].value), 1);
    assert.equal(plugin._holdHint.hidden, false);
    plugin.setParameters({ hold: false });
    assert.equal(plugin.autonomy, 0.45);
    assert.equal(plugin.freeze, false);
    assert.equal(plugin._freezeRow.querySelectorAll('input')[0].checked, false);
    assert.ok(inputs(plugin, 'autonomy').every(input => !input.disabled));
    assert.equal(Number(inputs(plugin, 'autonomy')[1].value), 0.45);
    assert.ok(inputs(plugin, 'weightDecay').every(input => !input.disabled));
    assert.equal(plugin._holdHint.hidden, true);
    plugin.setParameters({ freeze: true });
    assert.ok(inputs(plugin, 'learn').every(input => input.disabled));
    assert.ok(inputs(plugin, 'autonomy').every(input => !input.disabled));
});

test('APE Infinity retains the last finite decay and follows restored parameters', () => {
    const plugin = effect();
    plugin.createUI();
    plugin.setParameters({ weightDecay: 20 });
    const checkbox = plugin._infinityRow.querySelectorAll('input')[0];
    checkbox.checked = true;
    checkbox.listeners.get('change')({ target: checkbox });
    assert.equal(plugin.weightDecay, 0);
    assert.equal(Number(inputs(plugin, 'weightDecay')[1].value), 20);
    assert.ok(inputs(plugin, 'weightDecay').every(input => input.disabled));
    checkbox.checked = false;
    checkbox.listeners.get('change')({ target: checkbox });
    assert.equal(plugin.weightDecay, 20);
    plugin.setParameters({ weightDecay: 0 });
    assert.equal(checkbox.checked, true);
    const rebuilt = plugin.createUI();
    assert.ok(rebuilt);
    assert.equal(plugin._infinityRow.querySelectorAll('input')[0].checked, true);
    assert.ok(inputs(plugin, 'weightDecay').every(input => input.disabled));
});

test('APE Reset is transient and invalid numeric parameters preserve current values', () => {
    const plugin = effect();
    plugin.setParameters({ gap: 9, learn: 0.04, original: -0.5, resetToken: 16777215 });
    plugin.resetLearning();
    assert.equal(plugin.resetToken, 0);
    plugin.resetLearning();
    assert.equal(plugin.getParameters().resetToken, 1);
    assert.equal(plugin.getSerializableParameters().resetToken, undefined);
    assert.equal(plugin.gap, 9);
    assert.equal(plugin.original, -0.5);
    plugin.setParameters({ gap: NaN, learn: Infinity, original: '' });
    assert.equal(plugin.gap, 9);
    assert.equal(plugin.learn, 0.04);
    assert.equal(plugin.original, -0.5);
    assert.equal(plugin.getTemporalCapability(), 'must-process');
    plugin.setParameters({ enabled: false });
    assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
});

test('APE reports only validated execution and fault events and waits for confirmed reset recovery', () => {
    const plugin = effect();
    plugin.createUI();
    const send = overrides => plugin.onMessage({
        type: 'adaptivePredictionFault', pluginId: 11,
        pluginType: 'AdaptivePredictionEffectPlugin', validated: true,
        latched: true, cause: 'numericalFailure', ...overrides
    });
    send({ validated: false });
    send({ pluginId: 12 });
    assert.equal(plugin._statusElement.hidden, true);
    send({});
    assert.match(plugin._statusElement.textContent, /Press Reset/);
    plugin.resetLearning();
    assert.match(plugin._statusElement.textContent, /Press Reset/);
    send({ latched: false, cause: 'none' });
    assert.equal(plugin._statusElement.hidden, true);
    send({ type: 'dspExecutionState', state: 'bypassed', reason: 'unsupportedChannelMode' });
    assert.match(plugin._statusElement.textContent, /one channel or a stereo pair/);
    send({ type: 'dspExecutionState', state: 'active', reason: null });
    assert.equal(plugin._statusElement.hidden, true);
});
