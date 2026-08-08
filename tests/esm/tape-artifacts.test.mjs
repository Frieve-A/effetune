// Focused suite for the Tape Artifacts plugin, W-A and W-B only.
//
// Scope (implementation plan W-A / W-B; the plan is a local development
// document, not in the repository): the two things that changed — the hiss is
// now calibrated in the flux domain and rides the makeup, and Input Peak has
// been replaced by Record Level — plus the minimum safety matrix that any
// change to the sample loop has to clear. Everything the plugin already did is
// covered by the calibration verification scripts and is deliberately not
// duplicated here; the Cassette Artifacts suite is the deep one and this is
// not a copy of it.
//
// Checks: the parameter surface and its serialisation roundtrip, clamping,
// the floor's -1 dB/dB Record Level tracking against the status formula,
// output unity across Record Level, finiteness across the rate / channel /
// block matrix, and the status/UI surface the two controls present.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginBaseSource = await fs.readFile(
    path.join(repoRoot, 'plugins', 'plugin-base.js'), 'utf8');
const tapeSource = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'tape_artifacts.js'), 'utf8');

// --- minimal DOM double (the shape the Cassette Artifacts suite uses) ------
class FakeClassList {
    constructor(owner) { this.owner = owner; }
    add(...names) {
        const classes = new Set(this.owner.className.split(/\s+/).filter(Boolean));
        for (const name of names) classes.add(name);
        this.owner.className = [...classes].join(' ');
    }
    contains(name) { return this.owner.className.split(/\s+/).includes(name); }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.className = '';
        this.classList = new FakeClassList(this);
        this.style = { setProperty(name, value) { this[name] = value; } };
        this.attributes = new Map();
        this.dataset = {};
        this.textContent = '';
    }
    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    addEventListener(type, listener) { this[`on${type}`] = listener; }
    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'class') this.className = String(value);
    }
    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    querySelectorAll(selector) {
        const matches = element => (selector.startsWith('.')
            ? element.classList.contains(selector.slice(1))
            : element.tagName === selector.toUpperCase());
        const results = [];
        const visit = element => {
            for (const child of element.children) {
                if (matches(child)) results.push(child);
                visit(child);
            }
        };
        visit(this);
        return results;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeMutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
}

const sandbox = {
    window: {},
    console,
    setTimeout,
    clearTimeout,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    document: {
        body: new FakeElement('body'),
        documentElement: new FakeElement('html'),
        createElement: tagName => new FakeElement(tagName)
    }
};
sandbox.window.window = sandbox.window;
const vmContext = vm.createContext(sandbox);
vm.runInContext(pluginBaseSource, vmContext, { filename: 'plugin-base.js' });
vm.runInContext(tapeSource, vmContext, { filename: 'tape_artifacts.js' });
const Plugin = vm.runInContext('window.TapeArtifactsPlugin', vmContext);
assert.equal(typeof Plugin, 'function', 'window.TapeArtifactsPlugin must be registered');

const prototypeInstance = new Plugin();
// Host-realm compile proves the processor string is closure-free.
const processor = new Function('context', 'data', 'parameters', 'time',
    prototypeInstance.processorString);
// The hard-off threshold and the reference flux are read back out of the
// processor string rather than written down a second time, so the suite cannot
// disagree with the DSP about where the control ends.
const HISS_OFF_DB = Number(
    prototypeInstance.processorString.match(/const HISS_OFF_DB = (-?[\d.]+);/)[1]);
const HISS_REFERENCE_DB = -62.5; // TAPES.Standard BNIEC at 38.1 cm/s
const REFERENCE_FLUX = '320 nWb/m';

const PUBLIC_KEYS = ['sp', 'tp', 'bs', 'rl', 'wf', 'hs', 'og', 'mx'];

const defaultParams = (over = {}) => ({
    enabled: true, sp: '15', tp: 'Standard', bs: 0, rl: 6, wf: 0.16,
    hs: HISS_REFERENCE_DB, og: 0, mx: 100,
    blockSize: 128, channelCount: 2, sampleRate: 48000, ...over
});

function runBlocks(p, makeSample, totalFrames, ctx = { __seededRandom: () => 0.31 }) {
    const channels = p.channelCount;
    const out = Array.from({ length: channels }, () => new Float64Array(totalFrames));
    for (let b = 0; b * p.blockSize < totalFrames; b++) {
        const start = b * p.blockSize;
        const data = new Float32Array(p.blockSize * channels);
        for (let ch = 0; ch < channels; ch++) {
            for (let i = 0; i < p.blockSize; i++) {
                data[ch * p.blockSize + i] = makeSample(start + i, ch);
            }
        }
        const result = processor.call(null, ctx, data, p, start / p.sampleRate);
        const keep = Math.min(p.blockSize, totalFrames - start);
        for (let ch = 0; ch < channels; ch++) {
            for (let i = 0; i < keep; i++) out[ch][start + i] = result[ch * p.blockSize + i];
        }
    }
    return { out, ctx };
}

// A-weighted RMS in dBFS (full-scale sine RMS = 0 dB): the calibration
// ledger's noise convention, as a one-pole cascade of the IEC 61672 corners
// normalised at 1 kHz. This is the suite's own measuring instrument.
function aWeightedRmsDbfs(samples, sampleRate) {
    const sections = [];
    for (const frequency of [20.598997, 20.598997, 107.65265, 737.86223]) {
        const pole = Math.exp(-2 * Math.PI * frequency / sampleRate);
        sections.push({ b0: (1 + pole) * 0.5, b1: -(1 + pole) * 0.5, a1: -pole, z: 0 });
    }
    for (const frequency of [12194.217, 12194.217]) {
        const pole = Math.exp(-2 * Math.PI * frequency / sampleRate);
        sections.push({ b0: 1 - pole, b1: 0, a1: -pole, z: 0 });
    }
    const omega = 2 * Math.PI * 1000 / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    let magnitude = 1;
    for (const section of sections) {
        const numRe = section.b0 + section.b1 * cosine;
        const numIm = -section.b1 * sine;
        const denRe = 1 + section.a1 * cosine;
        const denIm = -section.a1 * sine;
        magnitude *= Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
    }
    const unityGain = 1 / magnitude;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        let value = samples[i];
        for (const section of sections) {
            const output = section.b0 * value + section.z;
            section.z = section.b1 * value - section.a1 * output;
            value = output;
        }
        value *= unityGain;
        sum += value * value;
    }
    const rms = Math.sqrt(sum / samples.length);
    return 20 * Math.log10(rms > 1e-30 ? rms / Math.SQRT1_2 : 1e-30);
}

// ==== W-B: the parameter surface ==========================================

test('tape artifacts exposes Record Level and no Input Peak', () => {
    const plugin = new Plugin();
    assert.equal(plugin.name, 'Tape Artifacts');
    const params = plugin.getParameters();
    assert.deepEqual(
        Object.keys(params).sort(),
        [...PUBLIC_KEYS, 'type', 'enabled'].sort());
    assert.equal('ip' in params, false, 'Input Peak must not exist in any form');
    assert.equal(typeof plugin.setIp, 'undefined', 'the Input Peak setter must be gone too');
    assert.equal(typeof plugin.setRl, 'function');

    assert.equal(params.sp, '15');
    assert.equal(params.tp, 'Standard');
    assert.equal(params.bs, 0);
    assert.equal(params.rl, 6);
    assert.equal(params.wf, 0.16);
    // W-A: Base Hiss is a flux now, and its default is the datasheet column
    // for the reference configuration read off verbatim.
    assert.equal(params.hs, HISS_REFERENCE_DB);
    assert.equal(params.og, 0);
    assert.equal(params.mx, 100);
});

test('get/set and serialisation roundtrips agree on every public key', () => {
    const source = new Plugin();
    source.setParameters({
        sp: '30', tp: 'Master', bs: -3.4, rl: 13.5, wf: 0.333,
        hs: -55.5, og: 4.5, mx: 55, enabled: false
    });
    const copy = new Plugin();
    copy.setParameters(source.getParameters());
    const a = source.getParameters();
    const b = copy.getParameters();
    for (const key of [...PUBLIC_KEYS, 'enabled']) {
        assert.ok(Object.is(a[key], b[key]), `get/set roundtrip must keep ${key}`);
    }

    const serialized = JSON.parse(JSON.stringify(source.getSerializableParameters()));
    assert.equal('ip' in serialized, false, 'the serialised form must not carry ip');
    assert.equal(serialized.rl, 13.5);
    const restored = new Plugin();
    restored.setSerializedParameters({ ...serialized, en: false });
    const c = restored.getParameters();
    for (const key of PUBLIC_KEYS) {
        assert.ok(Object.is(a[key], c[key]), `serialisation roundtrip must keep ${key}`);
    }
    assert.equal(c.enabled, false);
});

test('Record Level and Base Hiss clamp to their new ranges', () => {
    const plugin = new Plugin();
    plugin.setParameters({ rl: 99, hs: 0 });
    assert.equal(plugin.rl, 18);
    assert.equal(plugin.hs, -39);

    plugin.setParameters({ rl: -99, hs: -300 });
    assert.equal(plugin.rl, -12);
    assert.equal(plugin.hs, HISS_OFF_DB);
    assert.equal(HISS_OFF_DB, -89, 'the hard-off threshold is the bottom of the control');

    plugin.setParameters({ rl: NaN, hs: Infinity });
    assert.equal(plugin.rl, -12, 'non-finite values must keep the previous value');
    assert.equal(plugin.hs, HISS_OFF_DB);
});

// ==== safety ===============================================================

test('output stays finite across the rate, channel and block matrix', () => {
    const MIN_PARAMS = { sp: '7.5', tp: 'Standard', bs: -6, rl: -12, wf: 0, hs: HISS_OFF_DB, og: -24, mx: 1 };
    const MAX_PARAMS = { sp: '30', tp: 'Master', bs: 6, rl: 18, wf: 1, hs: -39, og: 24, mx: 100 };
    const tone = (n, ch) => 0.4 * Math.sin(2 * Math.PI * 997 * n / 48000 + ch);

    for (const patch of [{}, MIN_PARAMS, MAX_PARAMS]) {
        for (const sampleRate of [44100, 192000]) {
            for (const channelCount of [1, 6]) {
                for (const blockSize of [128, 2048]) {
                    const p = defaultParams({ ...patch, sampleRate, channelCount, blockSize });
                    const { out } = runBlocks(p, tone, blockSize * 3);
                    for (const channel of out) {
                        assert.ok(channel.every(Number.isFinite),
                            `${JSON.stringify(patch)} must stay finite at ${sampleRate} Hz `
                            + `/ ${channelCount}ch / block ${blockSize}`);
                    }
                }
            }
        }
    }
});

// ==== W-A: the floor is a flux, so it follows Record Level =================

test('the no-signal floor follows Record Level at -1 dB per dB', () => {
    // Every render draws the same noise sequence, so what separates two Record
    // Level settings is the makeup factor and nothing else: the relation is
    // exact rather than statistical and a short render resolves it.
    const SR = 96000;
    const total = 512 * 140; // ~0.75 s
    const warmup = Math.floor(0.25 * SR);
    const measure = rl => {
        const p = defaultParams({
            rl, wf: 0, hs: HISS_REFERENCE_DB, channelCount: 1, blockSize: 512, sampleRate: SR
        });
        const { out } = runBlocks(p, () => 0, total);
        return aWeightedRmsDbfs(out[0].subarray(warmup), SR);
    };
    const levels = [-12, 0, 6, 18];
    const floors = levels.map(measure);
    for (let i = 1; i < levels.length; i++) {
        const slope = (floors[i] - floors[i - 1]) / (levels[i] - levels[i - 1]);
        assert.ok(Math.abs(slope + 1) <= 0.02,
            `rl ${levels[i - 1]} → ${levels[i]}: the floor must move -1.000 dB/dB (got ${slope.toFixed(5)})`);
    }
    // And the status formula must state the same figure. The gate is the
    // calibration ledger's status-vs-render tolerance.
    for (let i = 0; i < levels.length; i++) {
        const plugin = new Plugin();
        plugin.setParameters({ hs: HISS_REFERENCE_DB, rl: levels[i] });
        const stated = plugin._effectiveHissDbFs();
        assert.ok(Math.abs(floors[i] - stated) <= 0.75,
            `rl ${levels[i]}: rendered ${floors[i].toFixed(2)} dBFS must match status ${stated.toFixed(2)} dBFS`);
    }
    // At rl +18 the makeup is exactly 0 dB, so the floor is the datasheet flux
    // itself: that is what makes Base Hiss readable straight off the column.
    assert.ok(Math.abs(floors[levels.indexOf(18)] - (HISS_REFERENCE_DB - 18)) <= 0.3,
        'at rl +18 the floor must land on the datasheet flux');
});

test('the Type and speed columns still ride on top of the Record Level term', () => {
    const SR = 48000;
    const total = 512 * 90;
    const warmup = Math.floor(0.25 * SR);
    const measure = over => {
        const p = defaultParams({
            wf: 0, hs: HISS_REFERENCE_DB, channelCount: 1, blockSize: 512, sampleRate: SR, ...over
        });
        const { out } = runBlocks(p, () => 0, total);
        return aWeightedRmsDbfs(out[0].subarray(warmup), SR);
    };
    // The published BNIEC column is not monotonic in speed, so the check is
    // that the offset is the column difference, not that it has a sign.
    const reference = measure({ rl: 6, sp: '15', tp: 'Standard' });
    for (const [sp, tp, expected] of [['7.5', 'Standard', -1.5], ['30', 'Standard', -2.0],
        ['15', 'Master', 0.5], ['30', 'Master', -3.5]]) {
        const offset = measure({ rl: 6, sp, tp }) - reference;
        assert.ok(Math.abs(offset - expected) <= 0.4,
            `${tp} / ${sp} ips must sit ${expected} dB off the reference (got ${offset.toFixed(3)})`);
        // The same offset must hold at another Record Level: the column and the
        // makeup are independent terms.
        const hot = measure({ rl: 18, sp, tp }) - measure({ rl: 18, sp: '15', tp: 'Standard' });
        assert.ok(Math.abs(hot - offset) <= 0.05,
            `${tp} / ${sp} ips: the column offset must not depend on Record Level`);
    }
});

test('the hard-off threshold silences the generator outright', () => {
    const p = defaultParams({
        rl: -12, wf: 0, hs: HISS_OFF_DB, channelCount: 1, blockSize: 512, sampleRate: 48000
    });
    const { out } = runBlocks(p, () => 0, 512 * 40);
    assert.ok(out[0].every(value => value === 0),
        'hs at the hard-off threshold must produce bit-zero silence at the loudest Record Level');
});

// ==== W-B: output unity ====================================================

test('the linear chain gain does not depend on Record Level', () => {
    // D-4: the makeup is the exact inverse of the input trim. Measured under
    // the saturator (a -80 dBFS tone), where the chain really is linear.
    const SR = 48000;
    const BLOCK = 512;
    const total = BLOCK * 75; // ~0.8 s
    const settle = Math.floor(0.4 * SR);
    const amp = Math.pow(10, -80 / 20);
    const steadyRms = rl => {
        const p = defaultParams({
            rl, wf: 0, hs: HISS_OFF_DB, channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const { out } = runBlocks(p, n => amp * Math.sin(2 * Math.PI * 1000 * n / SR), total);
        let sum = 0;
        for (const value of out[0].subarray(settle)) sum += value * value;
        return Math.sqrt(sum / (total - settle));
    };
    const gains = [-12, 0, 6, 18].map(rl => 20 * Math.log10(steadyRms(rl) / (amp / Math.SQRT2)));
    const spread = Math.max(...gains) - Math.min(...gains);
    assert.ok(spread < 0.001,
        `the small-signal gain must be Record Level invariant (spread ${spread.toExponential(2)} dB)`);
});

test('the modulation noise rides the recorded signal, not the operating point', () => {
    // W-A's other half, and the same gap the cassette suite had. The hiss
    // level is solved in the flux domain and carried out through the makeup;
    // the modulation index must NOT get that correction, because it is
    // already a ratio against the recorded signal. The header says so, and
    // nothing here held it — multiplying the index by the makeup as well left
    // this suite green.
    //
    // Silence cannot catch it: a multiplicative term is identically zero
    // there, and every other W-A check renders silence. So this drives a tone
    // and holds the TAPE FLUX constant while Record Level sweeps — amplitude
    // 10^(-rl/20) puts the tone on the operating point at every setting, and
    // therefore exceeds full scale at the coldest one, which is exactly what
    // holding the flux constant means.
    //
    // The measure is the near-carrier residual: remove the coherent carrier,
    // then band-pass the remainder around it. The modulation sidebands are a
    // few hundred Hz wide and survive; the hiss is spread over the whole band
    // and mostly does not.
    const SR = 96000;
    const BLOCK = 512;
    const total = BLOCK * 400;
    const nearCarrierDb = rl => {
        const amplitude = Math.pow(10, -rl / 20);
        const p = defaultParams({
            sp: '15', tp: 'Standard', bs: 0, rl, wf: 0, og: 0, mx: 100,
            channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const { out } = runBlocks(p, n => amplitude * Math.sin(2 * Math.PI * 1000 * n / SR), total);
        const from = total / 2;
        let re = 0;
        let im = 0;
        for (let n = from; n < total; n++) {
            const phase = 2 * Math.PI * 1000 * n / SR;
            re += out[0][n] * Math.cos(phase);
            im += out[0][n] * Math.sin(phase);
        }
        const count = total - from;
        re = 2 * re / count;
        im = 2 * im / count;
        const omega = 2 * Math.PI * 1000 / SR;
        const alpha = Math.sin(omega) * Math.sinh(Math.LN2 / 2 * 0.8 * omega / Math.sin(omega));
        const a0 = 1 + alpha;
        const b0 = alpha / a0;
        const a1 = -2 * Math.cos(omega) / a0;
        const a2 = (1 - alpha) / a0;
        let x1 = 0;
        let x2 = 0;
        let y1 = 0;
        let y2 = 0;
        let sum = 0;
        let counted = 0;
        for (let n = from; n < total; n++) {
            const phase = 2 * Math.PI * 1000 * n / SR;
            const input = out[0][n] - (re * Math.cos(phase) + im * Math.sin(phase));
            const y = b0 * input - b0 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = input;
            y2 = y1; y1 = y;
            if (n > from + SR / 10) { sum += y * y; counted++; }
        }
        return 20 * Math.log10(Math.sqrt(sum / counted) / (Math.hypot(re, im) / Math.SQRT2));
    };
    const ratios = [-12, 0, 6, 18].map(nearCarrierDb);
    const span = Math.max(...ratios) - Math.min(...ratios);
    assert.ok(span <= 0.2,
        `at a fixed tape flux the noise-to-carrier ratio must not move with Record Level `
        + `(span ${span.toFixed(4)} dB over -12..+18: ${ratios.map(v => v.toFixed(3)).join(', ')})`);
    // ...and it has to sit at the depth the tape's dcnDb column claims. The
    // invariance above is a shape property that a halved depth satisfies
    // perfectly; this is what pins the level.
    assert.ok(Math.abs(ratios[2] + 59.71) <= 1.5,
        `the near-carrier noise must sit at -59.71 dB against the carrier, which is what `
        + `Standard's 15 ips dcnDb renders (got ${ratios[2].toFixed(3)} dB)`);
});

// ==== status line and UI ===================================================

test('the status line states the Record Level convention and the flux units', () => {
    const plugin = new Plugin();
    const status = plugin._statusText();
    assert.equal(status,
        'Record Level +6.0 dB → tape peak +6.0 dB re 320 nWb/m at 0 dBFS in'
        + ' · Wow/Flutter Base 0.160% → 0.160% at 15 ips'
        + ' · Hiss Base -62.5 dB re 320 nWb/m → -68.5 dBFS at 15 ips, Standard');
    assert.equal(status.includes(REFERENCE_FLUX), true);
    assert.doesNotMatch(status, /dBFS at 0 dBFS/, 'Base Hiss is a flux, not a dBFS floor');

    const cut = new Plugin();
    cut.setParameters({ rl: -3.5 });
    assert.match(cut._statusText(), /^Record Level -3\.5 dB → tape peak -3\.5 dB re 320 nWb\/m at 0 dBFS in/,
        'a negative Record Level must read with its own sign');
    // The effective floor rises one for one as the machine is recorded colder.
    assert.match(cut._statusText(), /→ -59\.0 dBFS at 15 ips, Standard/);

    const off = new Plugin();
    off.setParameters({ hs: HISS_OFF_DB });
    assert.match(off._statusText(), /Hiss Base -89\.0 dB re 320 nWb\/m → off/);

    const master = new Plugin();
    master.setParameters({ sp: '30', tp: 'Master', rl: 18 });
    assert.match(master._statusText(), /→ -84\.0 dBFS at 30 ips, Master/);
});

test('the UI carries the Record Level slider and the flux-unit Hiss control', () => {
    const plugin = new Plugin();
    plugin.id = 1;
    const container = plugin.createUI();
    assert.ok(container.classList.contains('tape-artifacts-plugin-ui'));
    assert.ok(container.classList.contains('plugin-parameter-ui'));

    const sliders = new Map();
    for (const row of container.querySelectorAll('.parameter-row')) {
        const slider = row.querySelectorAll('input').find(el => el.type === 'range');
        if (slider) sliders.set(row.children[0].textContent, slider);
    }
    const expectRange = (label, min, max, step) => {
        const slider = sliders.get(label);
        assert.ok(slider, `missing control ${label}`);
        assert.equal(slider.min, min, `${label} min`);
        assert.equal(slider.max, max, `${label} max`);
        assert.equal(slider.step, step, `${label} step`);
    };
    expectRange('Bias (dB):', -6, 6, 0.1);
    expectRange('Record Level (dB):', -12, 18, 0.1);
    expectRange('Wow/Flutter (%):', 0, 1, 0.001);
    expectRange('Hiss (dB re 320 nWb/m):', HISS_OFF_DB, -39, 0.1);
    expectRange('Output (dB):', -24, 24, 0.1);
    expectRange('Mix (%):', 0, 100, 1);
    assert.equal(sliders.size, 6);
    assert.equal(sliders.has('Input Peak (dBFS):'), false, 'Input Peak must not be in the UI');

    // Moving Record Level must repaint the live status region.
    const status = container.children[container.children.length - 1];
    assert.equal(status.className, 'tape-artifacts-status');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.getAttribute('aria-atomic'), 'true');
    assert.equal(status.textContent, plugin._statusText());

    const recordLevel = sliders.get('Record Level (dB):');
    recordLevel.value = '12';
    recordLevel.oninput({ target: recordLevel });
    assert.equal(plugin.rl, 12);
    assert.match(status.textContent, /^Record Level \+12\.0 dB → tape peak \+12\.0 dB re 320 nWb\/m/);
    assert.match(status.textContent, /→ -74\.5 dBFS at 15 ips, Standard/);
});
