// Focused suite for the Cassette Artifacts plugin (plan W-7).
//
// Scope (implementation plan §5 W-7; the plan is a local development
// document, not in the repository): parameter
// roundtrip, bit-exact early returns, finite safety across the rate /
// channel / block matrix, NR behaviour (distinct modes, click-free mode
// switch, status-consistent quiet floor), seeded determinism and
// block-split independence, the wet-latency ledger, the hard-off
// controls, and the UI/status/ARIA surface. The heavy statistical
// calibration checks live in the W-2..W-6 verification scripts and are
// deliberately not duplicated here; every render below is short.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginBaseSource = await fs.readFile(
    path.join(repoRoot, 'plugins', 'plugin-base.js'), 'utf8');
const cassetteSource = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'cassette_artifacts.js'), 'utf8');
const cassetteCss = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'cassette_artifacts.css'), 'utf8');
const tapeCss = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'tape_artifacts.css'), 'utf8');

// --- minimal DOM double (same shape the codec-simulator UI suite uses) -----
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
vm.runInContext(cassetteSource, vmContext, { filename: 'cassette_artifacts.js' });
const Plugin = vm.runInContext('window.CassetteArtifactsPlugin', vmContext);
assert.equal(typeof Plugin, 'function', 'window.CassetteArtifactsPlugin must be registered');

const prototypeInstance = new Plugin();
// Host-realm compile proves the processor string is closure-free.
const processor = new Function('context', 'data', 'parameters', 'time',
    prototypeInstance.processorString);
// The serialized calibration table inside the processor string is the same
// module-scope object the UI reads; the tests read it back from the string.
const CAL = JSON.parse(prototypeInstance.processorString.match(/const CAL = (\{.*\});/)[1]);

const PUBLIC_KEYS = ['dg', 'tp', 'nr', 'bs', 'rl', 'wf', 'hs', 'dp', 'az', 'dl', 'og', 'mx'];
const GRADES = Object.keys(CAL.GRADES);
const HISS_OFF = -92; // dB re 250 nWb/m, the bottom of the control

const defaultParams = (over = {}) => ({
    enabled: true, dg: CAL.GRADE_DEFAULT, tp: 'Type I', nr: 'Dolby B', bs: 0, rl: 9,
    wf: CAL.W_REF, hs: Math.round(CAL.H_II * 10) / 10, dp: CAL.D_DEFAULT,
    az: CAL.AZ_DEFAULT_ARCMIN, dl: 0, og: 0, mx: 100,
    blockSize: 128, channelCount: 2, sampleRate: 48000, ...over
});

function runBlocks(p, makeSample, totalFrames,
    ctx = { __seededRandom: () => 0.42 }, onBlock = null) {
    const channels = p.channelCount;
    const out = Array.from({ length: channels }, () => new Float64Array(totalFrames));
    for (let b = 0; b * p.blockSize < totalFrames; b++) {
        const start = b * p.blockSize;
        if (onBlock) onBlock(p, start, ctx);
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

// A-weighted RMS in dBFS (full-scale sine RMS = 0 dB), the ledger's noise
// convention: IEC 61672 analytic corners from the shared calibration table
// as a one-pole cascade, unity-normalised at 1 kHz. This is the test's own
// measuring instrument for the floor checks.
function aWeightedRmsDbfs(samples, sampleRate) {
    const weighting = CAL.A_WEIGHTING;
    const sections = [];
    for (const frequency of [weighting.F1, weighting.F1, weighting.F2, weighting.F3]) {
        const pole = Math.exp(-2 * Math.PI * frequency / sampleRate);
        sections.push({ b0: (1 + pole) * 0.5, b1: -(1 + pole) * 0.5, a1: -pole, z: 0 });
    }
    for (const frequency of [weighting.F4, weighting.F4]) {
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
        magnitude *= Math.sqrt((numRe * numRe + numIm * numIm)
            / (denRe * denRe + denIm * denIm));
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

// ==== parameters: surface, roundtrip, validation ===========================

test('cassette artifacts exposes exactly the planned parameter surface', () => {
    const plugin = new Plugin();
    assert.equal(plugin.name, 'Cassette Artifacts');
    const params = plugin.getParameters();
    assert.deepEqual(
        Object.keys(params).sort(),
        [...PUBLIC_KEYS, 'type', 'enabled'].sort());
    assert.equal('sp' in params, false, 'the open-reel speed control must not exist');
    assert.equal('ip' in params, false,
        'Input Peak is gone: Record Level replaced it outright, with no compatibility path');
    // Defaults: a mass-market deck with a Type I tape in it (W-E). The point
    // of the change is that the artifacts are present at the shipped
    // settings — a Dragon with a metal tape at a cold operating point showed
    // the user nothing until they went looking.
    assert.equal(params.dg, 'Consumer');
    assert.equal(params.tp, 'Type I');
    assert.equal(params.nr, 'Dolby B');
    assert.equal(params.bs, 0);
    assert.equal(params.rl, 9);
    assert.equal(params.wf, CAL.W_REF);
    assert.equal(params.hs, Math.round(CAL.H_II * 10) / 10);
    assert.equal(params.dp, CAL.D_DEFAULT);
    assert.equal(params.az, CAL.AZ_DEFAULT_ARCMIN);
    assert.equal(params.dl, 0);
    assert.equal(params.og, 0);
    assert.equal(params.mx, 100);
    // Defaults that were settled by adjudication have to be pinned to
    // literals, not read back from the table the implementation reads. The
    // three assertions above that compare against CAL are tautologies on
    // their own — they say the getter returns the table, which it must, but
    // say nothing about what the table holds.
    assert.equal(CAL.H_II, -60.5, 'H_II is the TDK SA bias-noise column, dB re 250 nWb/m');
    assert.equal(CAL.AZ_DEFAULT_ARCMIN, 2.0,
        'the static azimuth default is the ledger anchor, +2.0 arcmin');
    assert.equal(CAL.D_DEFAULT, 2.0, 'the dropout default is 2.0 events/min');
    assert.equal(CAL.W_REF, 0.20,
        'the wow/flutter default is 0.20 %: the mass-market deck window, and the only '
        + 'value that keeps a cassette from measuring steadier than an open-reel machine');
});

test('get/set and serialisation roundtrips agree on every public key', () => {
    const source = new Plugin();
    source.setParameters({
        dg: 'Portable', tp: 'Type IV', nr: 'Dolby C', bs: -3.4, rl: -4.5, wf: 0.333,
        hs: -77.5, dp: 12.5, az: -3.7, dl: 1.8, og: 4.5, mx: 55, enabled: false
    });
    const copy = new Plugin();
    copy.setParameters(source.getParameters());
    const a = source.getParameters();
    const b = copy.getParameters();
    for (const key of [...PUBLIC_KEYS, 'enabled']) {
        assert.ok(Object.is(a[key], b[key]), `get/set roundtrip must keep ${key}`);
    }

    const serialized = JSON.parse(JSON.stringify(source.getSerializableParameters()));
    const restored = new Plugin();
    restored.setSerializedParameters({ ...serialized, en: false });
    const c = restored.getParameters();
    for (const key of PUBLIC_KEYS) {
        assert.ok(Object.is(a[key], c[key]), `serialisation roundtrip must keep ${key}`);
    }
    assert.equal(c.enabled, false);
});

test('invalid enums fall back, numbers clamp, and sp is rejected', () => {
    const plugin = new Plugin();
    plugin.setParameters({ tp: 'Type III', nr: 'dbx', dg: 'Studio', sp: '15' });
    assert.equal(plugin.tp, 'Type I');
    assert.equal(plugin.nr, 'Dolby B');
    assert.equal(plugin.dg, 'Consumer', 'an unknown Deck Grade falls back to the default');
    assert.equal(plugin.sp, undefined);

    plugin.setParameters({
        bs: 99, rl: 500, wf: 2, hs: -300, dp: 1e9, az: 99, dl: 50, og: -99, mx: 250
    });
    assert.equal(plugin.bs, 6);
    assert.equal(plugin.rl, 18);
    assert.equal(plugin.wf, 1);
    assert.equal(plugin.hs, HISS_OFF);
    assert.equal(plugin.dp, CAL.D_MAX);
    assert.equal(plugin.az, CAL.AZ_MAX_ARCMIN);
    assert.equal(plugin.dl, 3);
    assert.equal(plugin.og, -24);
    assert.equal(plugin.mx, 100);

    plugin.setParameters({ rl: -500, az: -99, dl: -50 });
    assert.equal(plugin.rl, -12);
    assert.equal(plugin.az, -CAL.AZ_MAX_ARCMIN, 'Azimuth is signed: both ends must clamp');
    assert.equal(plugin.dl, -3, 'Dolby Level Error is signed too');

    plugin.setParameters({ bs: NaN, rl: Infinity, wf: 'noise', az: NaN, dl: 'hot' });
    assert.equal(plugin.bs, 6, 'non-finite values must keep the previous value');
    assert.equal(plugin.rl, -12);
    assert.equal(plugin.wf, 1);
    assert.equal(plugin.az, -CAL.AZ_MAX_ARCMIN);
    assert.equal(plugin.dl, -3);
});

test('temporal capability follows enabled and mix', () => {
    const plugin = new Plugin();
    assert.equal(plugin.getTemporalCapability(), 'must-process');
    plugin.setParameters({ mx: 0 });
    assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
    plugin.setParameters({ mx: 100, enabled: false });
    assert.equal(plugin.getTemporalCapability(), 'reset-on-resume');
});

// ==== bit-exact early returns ==============================================

test('enabled=false and mx=0 are bit-exact, stateless and latency-free', () => {
    for (const patch of [{ enabled: false }, { mx: 0 }]) {
        const p = defaultParams(patch);
        const input = new Float32Array(p.blockSize * p.channelCount);
        for (let i = 0; i < input.length; i++) {
            input[i] = 0.25 * Math.sin(2 * Math.PI * 997 * i / p.sampleRate);
        }
        input[7] = -0; // signed zero must survive bit-for-bit
        input[19] = 0;
        const reference = input.slice();
        const ctx = { __seededRandom: () => 0.42 };
        const out = processor.call(null, ctx, input, p, 0);
        assert.equal(out.length, reference.length);
        for (let i = 0; i < reference.length; i++) {
            assert.ok(Object.is(out[i], reference[i]),
                `sample ${i} must be identical for ${JSON.stringify(patch)}`);
        }
        // Identity mapping in the very same block: zero latency by
        // construction, and no processing state may have been created.
        assert.equal(ctx.cassetteArtifacts, undefined);
    }
});

// ==== finite safety matrix =================================================

test('output stays finite across the rate, channel and block matrix', () => {
    // Both ends of every control at once, including both ends of the Deck
    // Grade: the Grade moves the trim budget, the record bandwidth, the LF
    // boost ceiling and the azimuth wobble sigma together, and Portable's
    // 4 arcmin wobble against a +-6 arcmin static azimuth is the worst case
    // the delay ring and the deviation clamp have to survive.
    const MIN_PARAMS = {
        dg: 'Reference', tp: 'Type I', nr: 'Off', bs: -6, rl: -12, wf: 0, hs: HISS_OFF,
        dp: 0, az: -CAL.AZ_MAX_ARCMIN, dl: -3, og: -24, mx: 1
    };
    const MAX_PARAMS = {
        dg: 'Portable', tp: 'Type IV', nr: 'Dolby C', bs: 6, rl: 18, wf: 1, hs: -42,
        dp: CAL.D_MAX, az: CAL.AZ_MAX_ARCMIN, dl: 3, og: 24, mx: 100
    };
    const tone = (n, ch) => 0.4 * Math.sin(2 * Math.PI * 997 * n / 48000 + ch);

    for (const sampleRate of [44100, 48000, 88200, 96000, 176400, 192000]) {
        for (const channelCount of [1, 2, 6]) {
            for (const blockSize of [128, 512, 2048]) {
                const p = defaultParams({ sampleRate, channelCount, blockSize });
                const { out } = runBlocks(p, tone, blockSize * 2);
                for (const channel of out) {
                    assert.ok(channel.every(Number.isFinite),
                        `default params must stay finite at ${sampleRate} Hz / ${channelCount}ch / block ${blockSize}`);
                }
            }
        }
    }
    for (const patch of [MIN_PARAMS, MAX_PARAMS]) {
        for (const sampleRate of [44100, 192000]) {
            for (const channelCount of [1, 6]) {
                for (const blockSize of [128, 2048]) {
                    const p = defaultParams({ ...patch, sampleRate, channelCount, blockSize });
                    const { out } = runBlocks(p, tone, blockSize * 3);
                    for (const channel of out) {
                        assert.ok(channel.every(Number.isFinite),
                            `${JSON.stringify(patch)} must stay finite at ${sampleRate} Hz / ${channelCount}ch / block ${blockSize}`);
                    }
                }
            }
        }
    }
});

test('a NaN/Infinity burst on one channel recovers and pollutes nothing', () => {
    const p = defaultParams({ blockSize: 256, channelCount: 2 });
    const ctx = { __seededRandom: () => 0.42 };
    const tone = i => 0.25 * Math.sin(2 * Math.PI * 997 * i / p.sampleRate);

    const clean = () => {
        const data = new Float32Array(p.blockSize * 2);
        for (let ch = 0; ch < 2; ch++) {
            for (let i = 0; i < p.blockSize; i++) data[ch * p.blockSize + i] = tone(i);
        }
        return data;
    };
    const warm = processor.call(null, ctx, clean(), p, 0);
    let cleanPeak = 0;
    for (const value of warm.subarray(0, p.blockSize)) {
        cleanPeak = Math.max(cleanPeak, Math.abs(value));
    }

    const burst = clean();
    burst[3] = NaN;
    burst[64] = Infinity;
    burst[130] = -Infinity; // channel 0 burst only
    const dirtyOut = processor.call(null, ctx, burst, p, 0);
    const channelB = dirtyOut.subarray(p.blockSize);
    assert.ok(channelB.every(Number.isFinite),
        'the clean channel must stay finite through the other channel\'s burst');

    let out = null;
    for (let b = 0; b < 4; b++) out = processor.call(null, ctx, clean(), p, 0);
    assert.ok(out.every(Number.isFinite), 'the burst channel must recover to finite output');
    // R5b F-22: "finite" alone is not recovery. Without the processor's
    // non-finite input guard every recursive state latches NaN, the output
    // clamp turns each NaN into 0, and the burst channel is permanently
    // silent — all-finite, and audibly dead. So the level has to come back
    // too, against the same clean block measured before the burst.
    let burstPeak = 0;
    for (const value of out.subarray(0, p.blockSize)) {
        burstPeak = Math.max(burstPeak, Math.abs(value));
    }
    assert.ok(burstPeak >= 0.5 * cleanPeak,
        `the burst channel must recover its level, not just finiteness `
        + `(peak ${burstPeak.toExponential(3)} against the pre-burst ${cleanPeak.toExponential(3)})`);
});

// ==== azimuth application rule =============================================

test('the azimuth L/R lag rides channels 0 and 1 only', () => {
    // Plan §3: the head's azimuth error costs in-track magnitude on every
    // track, but the inter-track time lag only exists between the two tracks
    // of one stereo pair. So channel 0 leads and channel 1 trails by half the
    // lag, every further channel keeps the common read position, and a mono
    // render is magnitude-only — identical to one of those common-position
    // channels. Applying the lag everywhere instead moves the mono render off
    // that reference by 7.6e-2 at the impulse peak, which is what this checks.
    // The azimuth angle moves every sample now, but it moves identically for
    // every channel and every render at a given seed — the head is one piece
    // of metal and the draw happens outside the channel loop — so the rule
    // this case states is unchanged and still exactly checkable.
    const impulse = n => (n === 100 ? 1 : 0);
    const render = channelCount => runBlocks(
        defaultParams({
            channelCount, wf: 0, hs: HISS_OFF, dp: 0, nr: 'Off', az: 2,
            blockSize: 512, sampleRate: 96000
        }), impulse, 2048).out;
    const six = render(6);
    const mono = render(1)[0];
    for (let i = 0; i < 2048; i++) {
        for (const ch of [3, 4, 5]) {
            assert.ok(Object.is(six[2][i], six[ch][i]),
                `channels 2..5 must share the common read position (ch ${ch}, sample ${i})`);
        }
        assert.ok(Object.is(mono[i], six[2][i]),
            `mono must be magnitude-only, like a common-position channel (sample ${i})`);
    }
    assert.ok(six[0].some((v, i) => v !== six[1][i]),
        'channels 0 and 1 must carry the inter-track lag');
});

test('the Azimuth control is signed: its sign says which channel leads', () => {
    // The in-track magnitude loss goes as theta squared, so it cannot tell
    // the two signs apart — but the inter-track lag reverses outright, and
    // that is the whole reason the control is signed rather than a magnitude
    // (plan D-8).
    //
    // Measured on the Reference Grade, where the azimuth servo holds the
    // angle still (wobble sigma 0) and theta is exactly the control. There
    // the stronger form of the property holds bit-for-bit: -az IS +az with
    // the channels swapped. On a drifting Grade it would not, and should not
    // — the wobble rides on top of the static angle as theta = az + w(t),
    // not as sign(az)(|az| + w(t)), so a head sitting at -4 arcmin is a
    // different head from one at +4, not its mirror image (measured: the two
    // differ by 4e-5 on Consumer).
    const SR = 96000;
    const impulse = n => (n === 100 ? 1 : 0);
    const render = az => runBlocks(
        defaultParams({
            az, channelCount: 2, wf: 0, hs: HISS_OFF, dp: 0, nr: 'Off',
            dg: 'Reference', blockSize: 512, sampleRate: SR
        }), impulse, 2048).out;
    // Energy centroid of the impulse response: a robust sub-sample arrival
    // time that does not care about the magnitude loss.
    const centroid = channel => {
        let weighted = 0;
        let total = 0;
        for (let n = 0; n < 2048; n++) {
            const energy = channel[n] * channel[n];
            weighted += n * energy;
            total += energy;
        }
        return weighted / total;
    };
    const positivePair = render(4);
    const negativePair = render(-4);
    const lagSamples = pair => centroid(pair[0]) - centroid(pair[1]);
    // dt = s tan(theta) / v; the split is +-dt/2, so the pair separation is
    // the full dt. At 4 arcmin and 96 kHz that is 2.11 samples.
    const expected = CAL.TRACK_CENTER_SPACING_M * Math.tan(4 / 60 * Math.PI / 180)
        / CAL.SPEED_MPS * SR;
    const positive = lagSamples(positivePair);
    const negative = lagSamples(negativePair);
    assert.ok(Math.abs(positive + expected) < 0.05,
        `az > 0 must put channel 0 ahead by dt = ${expected.toFixed(3)} samples `
        + `(measured ${positive.toFixed(3)})`);
    assert.ok(Math.abs(negative - expected) < 0.05,
        `az < 0 must reverse it (measured ${negative.toFixed(3)})`);
    // The exact form, available because this Grade does not drift.
    let worst = 0;
    for (let i = 0; i < 2048; i++) {
        worst = Math.max(worst,
            Math.abs(positivePair[0][i] - negativePair[1][i]),
            Math.abs(positivePair[1][i] - negativePair[0][i]));
    }
    assert.ok(worst === 0,
        `on a servo-held head -az must be +az with the channels swapped, exactly `
        + `(worst |diff| ${worst.toExponential(2)})`);
    // ...and az = 0 is perfect alignment: no lag at all, both channels equal.
    const aligned = render(0);
    for (let i = 0; i < 2048; i++) {
        assert.ok(Object.is(aligned[0][i], aligned[1][i]),
            `az = 0 must leave the two channels identical (sample ${i})`);
    }
});

test('the Dolby Level Error is signed: plus is bright, minus is dull', () => {
    // The half of the axis a quality grade cannot express (plan D-7). The
    // tape's own mistracking only ever darkens; a playback deck calibrated
    // hot decodes with too little cut and the result is brighter and hissier.
    // Measured at a mid level, where a compander mistracks at all — at the
    // operating point both halves are slid out and agree, and in the deep
    // quiet both are at the end of their travel and agree again.
    const SR = 48000;
    const BLOCK = 512;
    const total = BLOCK * 90;
    const level = Math.pow(10, -35 / 20);
    const gainDb = (dl, frequency) => {
        const p = defaultParams({
            dg: 'Consumer', tp: 'Type II', nr: 'Dolby B', bs: 0, rl: 9, dl,
            wf: 0, hs: HISS_OFF, dp: 0, az: 0,
            channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => level * Math.sin(2 * Math.PI * frequency * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
        let re = 0;
        let im = 0;
        for (let n = total / 2; n < total; n++) {
            re += out[0][n] * Math.cos(2 * Math.PI * frequency * n / SR);
            im += out[0][n] * Math.sin(2 * Math.PI * frequency * n / SR);
        }
        return 20 * Math.log10(2 * Math.hypot(re, im) / (total / 2) / level);
    };
    const tilt = dl => gainDb(dl, 8000) - gainDb(dl, 1000);
    const dull = tilt(-3);
    const neutral = tilt(0);
    const bright = tilt(3);
    assert.ok(dull < neutral && neutral < bright,
        `the HF tilt must rise with dl (dull ${dull.toFixed(3)}, neutral `
        + `${neutral.toFixed(3)}, bright ${bright.toFixed(3)} dB)`);
    assert.ok(bright - dull > 1,
        `and the span must be audible-scale (got ${(bright - dull).toFixed(3)} dB over dl -3..+3)`);
});

test('the Deck Grade is a monotone quality axis, and owns only the knobless mechanisms', () => {
    // The membership rule (plan D-8): a quantity belongs to the Grade only if
    // it is a monotone quality axis. This checks the consequence — every
    // column really is ordered — and the other half of the rule, that
    // choosing a Grade never touches a control the user owns.
    const columns = GRADES.map(name => CAL.GRADES[name]);
    const ordered = (pick, direction) => columns.every((column, i) =>
        i === 0 || Math.sign(pick(column) - pick(columns[i - 1])) === direction);
    assert.ok(ordered(c => c.trimMaxDb, -1), 'the trim budget must fall Reference -> Portable');
    assert.ok(ordered(c => c.recordBandwidthHz, -1), 'the record bandwidth must fall');
    assert.ok(ordered(c => c.lfBoostMaxDb, -1), 'the LF boost ceiling must fall');
    assert.ok(ordered(c => c.azWobbleArcmin, 1), 'the azimuth wobble must grow');
    assert.ok(ordered(c => c.contactLengthM, -1), 'the head contact length must fall');
    assert.equal(columns[0].azWobbleArcmin, 0,
        'the Reference class is an azimuth-servo machine (NAAC): it does not drift, '
        + 'and that is what makes a fully deterministic deck reachable from the controls');
    assert.ok(ordered(c => c.headBumpDb, 1), 'the contour lobe must grow');
    assert.ok(columns.every(c => c.contourLobes >= 2 && c.contourLobes <= 3));

    // Choosing a Grade must not silently rewrite wf / hs / dp / rl / az / dl:
    // those have their own controls, and a Grade that edited them would throw
    // the user's settings away.
    const plugin = new Plugin();
    plugin.setParameters({ wf: 0.37, hs: -55.5, dp: 7.5, rl: -4, az: -2.5, dl: 1.5 });
    const before = plugin.getParameters();
    for (const grade of GRADES) {
        plugin.setParameters({ dg: grade });
        const after = plugin.getParameters();
        for (const key of ['wf', 'hs', 'dp', 'rl', 'az', 'dl', 'tp', 'nr', 'bs']) {
            assert.equal(after[key], before[key],
                `choosing ${grade} must not touch ${key}`);
        }
    }

    // And it does change the sound, in the documented direction: a better
    // Grade must pass more 12 kHz.
    const SR = 96000;
    const BLOCK = 512;
    const total = BLOCK * 100;
    const hf = grade => {
        const p = defaultParams({
            dg: grade, tp: 'Type II', nr: 'Off', bs: 0, rl: 18, wf: 0,
            hs: HISS_OFF, dp: 0, az: 0, channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => 1e-3 * Math.sin(2 * Math.PI * 12000 * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
        let sum = 0;
        for (let n = total / 2; n < total; n++) sum += out[0][n] * out[0][n];
        return 20 * Math.log10(Math.sqrt(sum / (total / 2)));
    };
    const levels = GRADES.map(hf);
    assert.ok(levels.every((v, i) => i === 0 || v < levels[i - 1]),
        `12 kHz must fall monotonically Reference -> Portable (${levels.map(v => v.toFixed(2)).join(' > ')} dBFS)`);
});

test('every Grade meets its own published band edges, high and low', () => {
    // trimMaxDb and lfBoostMaxDb are the two central W-E results, four values
    // each, and both are SOLVED per Grade rather than chosen. Until this case
    // existed only the Consumer columns were pinned anywhere in the
    // repository (through the frozen response row): the other three could be
    // rewritten to any values at all and, as long as the table ordering held,
    // the suite stayed green. The solvers that produced them are local
    // development files, so nothing else carries the result forward.
    //
    // Both ends are checked. The HF edge is the -3 dB point trimMaxDb was
    // solved against. The LF end is probed at a FIXED 20 Hz rather than at
    // each Grade's own corner: deriving the probe frequency from the column
    // under test would move the probe and the pole together and measure
    // nothing. 20 Hz separates the four Grades by 1.4 to 4.7 dB, so a 1 dB
    // error in lfBoostMaxDb moves it well outside the tolerance.
    //
    // Conditions match the solver exactly — including az = +2 arcmin, which
    // is load-bearing: solving at az = 0 moves the HF answer by 4-5 %. It is
    // written as a literal, not read from CAL.AZ_DEFAULT_ARCMIN: the solve
    // was performed at this angle, so it is a frozen CONDITION of the result,
    // and taking it from the same table the implementation reads would let a
    // change of default silently invalidate the solve and the check together.
    const SR = 96000;
    const BLOCK = 512;
    const total = BLOCK * 500;
    const AMPLITUDE = 1e-3;
    //             Grade        HF edge   HF dB    20 Hz dB
    const EDGES = [
        ['Reference', 18000, -3.001, -1.428],
        ['Hi-Fi', 14000, -2.960, -2.118],
        ['Consumer', 10000, -2.950, -2.983],
        ['Portable', 6500, -2.947, -4.656]
    ];
    const gainDb = (dg, frequency) => {
        const p = defaultParams({
            dg, tp: 'Type II', nr: 'Off', bs: 0, rl: 9, wf: 0, hs: HISS_OFF,
            dp: 0, az: 2, dl: 0,
            channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => AMPLITUDE * Math.sin(2 * Math.PI * frequency * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
        let re = 0;
        let im = 0;
        for (let n = total / 2; n < total; n++) {
            re += out[0][n] * Math.cos(2 * Math.PI * frequency * n / SR);
            im += out[0][n] * Math.sin(2 * Math.PI * frequency * n / SR);
        }
        return 20 * Math.log10(2 * Math.hypot(re, im) / (total / 2) / AMPLITUDE);
    };
    for (const [dg, edge, expectedHf, expectedLf] of EDGES) {
        const reference = gainDb(dg, 1000);
        const hf = gainDb(dg, edge) - reference;
        assert.ok(Math.abs(hf + 3) <= 0.3,
            `${dg} must be -3.0 +-0.3 dB at its ${edge} Hz band edge (got ${hf.toFixed(3)} dB)`);
        assert.ok(Math.abs(hf - expectedHf) <= 0.3,
            `${dg} HF edge must stay on the solved ${expectedHf} dB (got ${hf.toFixed(3)} dB)`);
        const lf = gainDb(dg, 20) - reference;
        assert.ok(Math.abs(lf - expectedLf) <= 0.3,
            `${dg} must sit at ${expectedLf} dB at 20 Hz, which is what its LF boost `
            + `ceiling buys (got ${lf.toFixed(3)} dB)`);
    }
});

test('the azimuth in-track loss keeps its shape at every host rate', () => {
    // R1-01's two invariants, as assertions. The defect that was fixed was
    // not a wrong number: the loss was a 2-tap FIR, whose smear is pinned to
    // one sample = 1/fs seconds, while the loss it models is pinned to
    // tau_a = w theta / v seconds. So its REACHABLE RANGE moved with the host
    // rate — at 192 kHz every angle from 3 arcmin up produced identical
    // output, which killed the top of the Azimuth control and collapsed the
    // Grade wobble column onto one value.
    //
    // Both checks below fix PROPERTIES, not calibrated values. A re-solve of
    // trimMaxDb, a different corner constant, a finer table — all of those
    // move the numbers and leave these standing. Freezing measured values
    // here instead would have to be redone at every calibration change, which
    // is exactly how this guard came to be missing the first time.
    const SR_LIST = [44100, 96000, 192000];
    const BLOCK = 512;
    const total = BLOCK * 300;
    const AMPLITUDE = 1e-3;

    // (1) The control still resolves at its top end, at every rate. The
    // servo Grade holds theta at exactly the control, so this is the loss
    // curve itself and nothing else.
    const lossDb = (az, frequency, sampleRate) => {
        const render = angle => {
            const p = defaultParams({
                dg: 'Reference', tp: 'Type II', nr: 'Off', bs: 0, rl: 9, wf: 0,
                hs: HISS_OFF, dp: 0, az: angle, dl: 0,
                channelCount: 1, blockSize: BLOCK, sampleRate
            });
            const tone = n => AMPLITUDE * Math.sin(2 * Math.PI * frequency * n / sampleRate);
            const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
            let re = 0;
            let im = 0;
            for (let n = total / 2; n < total; n++) {
                re += out[0][n] * Math.cos(2 * Math.PI * frequency * n / sampleRate);
                im += out[0][n] * Math.sin(2 * Math.PI * frequency * n / sampleRate);
            }
            return 20 * Math.log10(2 * Math.hypot(re, im) / (total / 2) / AMPLITUDE);
        };
        return render(az) - render(0);
    };
    for (const sampleRate of SR_LIST) {
        const atFive = lossDb(5, 16000, sampleRate);
        const atSix = lossDb(6, 16000, sampleRate);
        assert.ok(atFive - atSix >= 0.2,
            `${sampleRate} Hz: the last arcmin of Azimuth travel must still change the `
            + `16 kHz loss by at least 0.2 dB (5' ${atFive.toFixed(3)} dB, `
            + `6' ${atSix.toFixed(3)} dB, step ${(atFive - atSix).toFixed(3)} dB)`);
    }

    // (2) The Grade wobble column stays ordered at the HIGHEST rate, which is
    // where the old form died completely. Measured as the short-time level
    // spread of a steady tone — the audible consequence of the wobble, not
    // the sigma constant, so a re-tuned ladder still passes as long as the
    // Grades remain distinguishable.
    const WOBBLE_SR = 192000;
    const WOBBLE_BLOCK = 1024;
    const wobbleSpread = dg => {
        const frames = Math.round(6 * WOBBLE_SR / WOBBLE_BLOCK) * WOBBLE_BLOCK;
        const p = defaultParams({
            dg, tp: 'Type II', nr: 'Off', bs: 0, rl: 9, wf: 0, hs: HISS_OFF,
            dp: 0, az: 2, dl: 0,
            channelCount: 1, blockSize: WOBBLE_BLOCK, sampleRate: WOBBLE_SR
        });
        const tone = n => 0.05 * Math.sin(2 * Math.PI * 12000 * n / WOBBLE_SR);
        const { out } = runBlocks(p, tone, frames, { __seededRandom: () => 0.42 });
        const window = Math.round(0.05 * WOBBLE_SR);
        const levels = [];
        for (let start = WOBBLE_SR; start + window < frames; start += window) {
            let sum = 0;
            for (let i = 0; i < window; i++) sum += out[0][start + i] * out[0][start + i];
            levels.push(10 * Math.log10(sum / window));
        }
        const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
        return Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
    };
    const spreads = ['Hi-Fi', 'Consumer', 'Portable'].map(wobbleSpread);
    for (let i = 1; i < spreads.length; i++) {
        assert.ok(spreads[i] > spreads[i - 1] * 1.3,
            `at ${WOBBLE_SR} Hz the Grade wobble ladder must stay separated `
            + `(Hi-Fi / Consumer / Portable = ${spreads.map(v => v.toFixed(4)).join(' / ')} dB sd; `
            + `under these conditions the shipped build gives 0.1304 / 0.2918 / 0.6948, `
            + `ratios 2.24 and 2.38, and the pre-R1-01 2-tap form gives `
            + `0.0588 / 0.0619 / 0.0702, ratios 1.05 and 1.13)`);
    }
});

test('the IEC 3180 us flux boost sits ahead of the saturator, not behind it', () => {
    // W-C's whole reason for existing, and the one part of it no amplitude
    // measurement can see. The record-side LF boost is a linear section: move
    // it downstream of the saturator and the frequency response is
    // identical — the source says so itself — so the frozen response row and
    // both band edges stay green while the behaviour the boost was added for
    // disappears.
    //
    // What changes is WHEN the low end runs out of tape. Ahead of the
    // saturator, 30 Hz arrives carrying the standard's extra flux and hits
    // the ceiling before the midrange does. Behind it, the boost is applied
    // to an already-saturated signal and the low end gives LAST.
    //
    // The check is a sign-and-order one, not a frozen value: it survives a
    // re-solve of lfBoostMaxDb or a re-fit of headroomDb, both of which move
    // the margin. Measured at the shipped default Grade: +1.86 dB. With the
    // boost moved downstream: -0.56 dB, at every Grade, with the Grade
    // spread gone as well.
    const SR = 96000;
    const BLOCK = 512;
    const total = BLOCK * 300;
    const gainDb = (frequency, amplitude) => {
        const p = defaultParams({
            dg: 'Consumer', tp: 'Type II', nr: 'Off', bs: 0, rl: 9, wf: 0,
            hs: HISS_OFF, dp: 0, az: 2, dl: 0,
            channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => amplitude * Math.sin(2 * Math.PI * frequency * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
        let re = 0;
        let im = 0;
        for (let n = total / 2; n < total; n++) {
            re += out[0][n] * Math.cos(2 * Math.PI * frequency * n / SR);
            im += out[0][n] * Math.sin(2 * Math.PI * frequency * n / SR);
        }
        return 20 * Math.log10(2 * Math.hypot(re, im) / (total / 2) / amplitude);
    };
    // Compression = how much gain is lost going from a small signal to a
    // full-scale one. Positive, and bigger where the tape gives out sooner.
    const compressionDb = frequency => gainDb(frequency, 0.01) - gainDb(frequency, 1.0);
    const low = compressionDb(30);
    const mid = compressionDb(1000);
    assert.ok(low - mid > 0.5,
        `deep bass must reach the ceiling before the midrange does: 30 Hz compresses `
        + `${low.toFixed(3)} dB against ${mid.toFixed(3)} dB at 1 kHz `
        + `(margin ${(low - mid).toFixed(3)} dB; with the boost downstream of the `
        + `saturator this is -0.56 dB — the sign reverses)`);
});

test('the modulation noise rides the recorded signal, not the operating point', () => {
    // W-A's other half. The hiss level is solved in the flux domain and
    // carried out through the makeup; the modulation index must NOT get that
    // same correction, because it is already a ratio against the recorded
    // signal — (makeup*s)(1+n) = makeup*(s(1+n)). The source states this in
    // three places and nothing in the repository held it: multiplying the
    // index by the makeup too left both suites green.
    //
    // It could not be caught before because every W-A check renders SILENCE,
    // and a multiplicative term is identically zero there. So this case
    // drives a tone and holds the TAPE FLUX constant while Record Level
    // sweeps — amplitude 10^(-rl/20) puts the tone on the operating point at
    // every setting. The probe therefore exceeds full scale at the coldest
    // Record Level, which is not an accident: that is what holding the flux
    // constant means when the trim is 12 dB colder.
    //
    // The measure is the near-carrier residual: subtract the coherent
    // carrier, then band-pass what is left to the carrier's neighbourhood.
    // Modulation noise is a sideband spread of a few hundred Hz (the
    // correlation corner is 253 Hz), so it survives that band-pass nearly
    // intact, while the hiss — spread across the whole band — mostly does
    // not. That is what makes the figure track dcnDb instead of the floor.
    const SR = 96000;
    const BLOCK = 512;
    const total = BLOCK * 400;
    const nearCarrierDb = rl => {
        const amplitude = Math.pow(10, -rl / 20);
        const p = defaultParams({
            dg: 'Consumer', tp: 'Type I', nr: 'Off', bs: 0, rl, wf: 0,
            hs: CAL.H_II, dp: 0, az: 0, dl: 0, og: 0, mx: 100,
            channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => amplitude * Math.sin(2 * Math.PI * 1000 * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
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
        // 2-pole band-pass, 1 kHz centre, 800 Hz wide.
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
    const ratios = [-12, 0, 9, 18].map(nearCarrierDb);
    const span = Math.max(...ratios) - Math.min(...ratios);
    assert.ok(span <= 0.2,
        `at a fixed tape flux the noise-to-carrier ratio must not move with Record Level `
        + `(span ${span.toFixed(4)} dB over -12..+18: ${ratios.map(v => v.toFixed(3)).join(', ')}; `
        + `scaling the modulation index by the makeup too gives 22.9 dB here)`);
    // ...and it has to sit at the depth the Type's dcnDb column claims. The
    // invariance above is a shape property and a halved modulation depth
    // satisfies it perfectly; this is what pins the level.
    assert.ok(Math.abs(ratios[2] + 47.99) <= 1.5,
        `the near-carrier noise must sit at -47.99 dB against the carrier, which is what `
        + `Type I's dcnDb of ${CAL.TYPES['Type I'].dcnDb} dB renders (got ${ratios[2].toFixed(3)} dB; `
        + `halving the modulation depth gives about -51.9)`);
});

// ==== ideal-condition small-signal response ================================

test('the ideal-condition small-signal response sits on the frozen row', () => {
    // R5b F-23. Every statistical W-2..W-6 verification script is a local
    // development artifact, so nothing inside the repository pins the shape
    // of the linear chain. This row does: 60 dB under the operating point the
    // deck is linear, so its magnitude response is a fixed curve. It is the
    // only in-repository guard on
    //   - the record/reproduce EQ pair being the *exact* inverse,
    //   - the azimuth section's in-track magnitude loss (a one-pole matched
    //     to the sinc's curvature, tabulated over |theta|),
    //   - the head contour, now three alternating lobes rather than one bump,
    //   - the IEC 3180 us pair, whose deliberate ASYMMETRY is the whole low
    //     end of the deck (the 20 Hz point is here for that: implement that
    //     pair as an exact inverse the way the 70/120 us pair is and 20 Hz
    //     moves by more than 3 dB),
    // plus the head-alignment trim budget that scales the loss poles.
    //
    // The deck is no longer strictly time-invariant — the azimuth angle moves
    // every sample — so this row is the response of ONE seeded trajectory
    // over one fixed window rather than a pure LTI curve. That is deliberate:
    // it pins the azimuth family's RNG consumption order as well as the
    // filter shapes.
    //
    // Conditions, frozen with this row: Deck Grade Consumer, Type II, NR Off,
    // bs 0, rl +18 (trim = makeup = 1), wf 0, hs -92 (hard off), dp 0,
    // az +2 arcmin, dl 0, og 0, mx 100, mono, 96 kHz, block 512, ~0.44 s
    // render, seed 0.42, single-bin DFT over the settled second half, tone
    // amplitude 1e-3.
    const SR = 96000;
    const BLOCK = 512;
    const TOTAL = BLOCK * 80;
    const AMPLITUDE = 1e-3;
    const FROZEN = [
        [20, -3.349], [50, 1.094], [100, 0.476], [1000, -0.024],
        [5000, -0.791], [10000, -3.041], [16000, -7.862]
    ];
    for (const [frequency, expected] of FROZEN) {
        const p = defaultParams({
            dg: 'Consumer', tp: 'Type II', nr: 'Off', bs: 0, rl: 18, wf: 0,
            hs: HISS_OFF, dp: 0, az: 2, dl: 0,
            og: 0, mx: 100, channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => AMPLITUDE * Math.sin(2 * Math.PI * frequency * n / SR);
        const { out } = runBlocks(p, tone, TOTAL, { __seededRandom: () => 0.42 });
        let re = 0;
        let im = 0;
        for (let n = TOTAL / 2; n < TOTAL; n++) {
            re += out[0][n] * Math.cos(2 * Math.PI * frequency * n / SR);
            im += out[0][n] * Math.sin(2 * Math.PI * frequency * n / SR);
        }
        const gainDb = 20 * Math.log10(
            2 * Math.hypot(re, im) / (TOTAL / 2) / AMPLITUDE);
        assert.ok(Math.abs(gainDb - expected) <= 0.1,
            `${frequency} Hz must sit at the frozen ${expected.toFixed(3)} dB `
            + `+-0.1 dB (got ${gainDb.toFixed(3)} dB)`);
    }
});

test('the linear chain gain does not depend on Record Level', () => {
    // D-4, and the one contract this suite had no way to catch. The only
    // other test that pins an ABSOLUTE gain is the frozen row above, and its
    // conditions put it at rl = +18 — the single point where
    // inputTrimGain = makeupGain = 1, so the trim/makeup pair could be broken
    // (moved to the output, applied twice, dropped) and the row would not
    // move. Every other test that touches the signal path measures a ratio at
    // one Record Level, which cancels a linear gain error exactly.
    //
    // That matters beyond this suite: the native port's parity goldens are
    // generated from this JS reference, so a gain error invisible here would
    // be inherited rather than caught.
    //
    // -80 dBFS is 62 dB under the reference flux even at the hottest Record
    // Level, so the saturator is strictly linear and the only thing being
    // measured is the trim/makeup pair.
    const SR = 96000;
    const BLOCK = 512;
    const total = BLOCK * 200;
    const amplitude = 1e-4; // -80 dBFS
    const gainDb = rl => {
        const p = defaultParams({
            dg: 'Reference', tp: 'Type II', nr: 'Off', bs: 0, rl, wf: 0,
            hs: HISS_OFF, dp: 0, az: 0, dl: 0, og: 0, mx: 100,
            channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const tone = n => amplitude * Math.sin(2 * Math.PI * 1000 * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
        let re = 0;
        let im = 0;
        for (let n = total / 2; n < total; n++) {
            re += out[0][n] * Math.cos(2 * Math.PI * 1000 * n / SR);
            im += out[0][n] * Math.sin(2 * Math.PI * 1000 * n / SR);
        }
        return 20 * Math.log10(2 * Math.hypot(re, im) / (total / 2) / amplitude);
    };
    const gains = [-12, -6, 0, 6, 9, 12, 18].map(gainDb);
    const spread = Math.max(...gains) - Math.min(...gains);
    assert.ok(spread < 1e-3,
        `Record Level must not change the linear gain (spread ${spread.toExponential(3)} dB `
        + `over -12..+18: ${gains.map(v => v.toFixed(6)).join(', ')})`);
});

// ==== hard-off controls ====================================================

test('wf=0, hs at the bottom, dp=0 and Reference together disable every random artifact family', () => {
    // The strong determinism gate. W-D added a fourth stochastic family — the
    // azimuth wobble — so the settings that reach a fully deterministic deck
    // now include the Deck Grade: Reference is the azimuth-servo class (the
    // Dragon's NAAC), and its wobble sigma is exactly 0. The servo is the
    // reason, not the arithmetic; a machine that measures its own azimuth
    // continuously does not drift.
    const p = () => defaultParams({
        dg: 'Reference', wf: 0, hs: HISS_OFF, dp: 0, channelCount: 2, blockSize: 512
    });
    const tone = (n, ch) => 0.3 * Math.sin(2 * Math.PI * 1103 * n / 48000 + ch);
    const total = 512 * 24;
    const runA = runBlocks(p(), tone, total, { __seededRandom: () => 0.42 });
    const runB = runBlocks(p(), tone, total, { __seededRandom: () => 0.77 });
    for (let ch = 0; ch < 2; ch++) {
        for (let i = 0; i < total; i++) {
            assert.ok(Object.is(runA.out[ch][i], runB.out[ch][i]),
                `all-off output must be seed-invariant (ch ${ch}, sample ${i})`);
        }
    }

    // Each family's hard off, asserted directly as well: seed invariance is
    // the consequence, but these are the properties a native port has to
    // reproduce one by one.
    const stateA = runA.ctx.cassetteArtifacts;
    assert.equal(stateA.flutterA, 0, 'wf=0 must never advance the flutter chain');
    assert.equal(stateA.flutterB, 0, 'wf=0 must never advance the flutter chain');
    assert.equal(stateA.dropoutBudget, -1, 'dp=0 must never draw a dropout deadline');
    const runLong = runBlocks(p(), tone, total * 3, { __seededRandom: () => 0.42 });
    assert.equal(runLong.ctx.cassetteArtifacts.rngNoise, stateA.rngNoise,
        'hs at the bottom must never draw the noise stream, however long the render');
    assert.equal(runLong.ctx.cassetteArtifacts.rngDropout, stateA.rngDropout,
        'dp=0 must never draw the dropout stream, however long the render');
    assert.equal(runLong.ctx.cassetteArtifacts.rngAzimuth, stateA.rngAzimuth,
        'a Grade with no wobble must never draw the azimuth stream either');

    // ...and the noise family is live again the moment hs rises above off.
    const noisy = runBlocks(
        defaultParams({
            dg: 'Reference', wf: 0, hs: CAL.H_II, dp: 0, channelCount: 2, blockSize: 512
        }),
        tone, total, { __seededRandom: () => 0.42 });
    assert.notEqual(noisy.ctx.cassetteArtifacts.rngNoise, stateA.rngNoise,
        'hs above the off threshold must draw the noise stream');
    assert.ok(noisy.out[0].some((v, i) => v !== runA.out[0][i]),
        'hs above the off threshold must inject noise');
});

test('the azimuth wobble is live, seeded and bounded on the Grades that specify one', () => {
    // The other side of the case above: on every Grade below Reference the
    // head does drift, so with all three of the older families off the output
    // is still seed-dependent — and it is the azimuth stream that carries it.
    const p = () => defaultParams({
        dg: 'Consumer', wf: 0, hs: HISS_OFF, dp: 0, az: 2, channelCount: 2,
        blockSize: 512, sampleRate: 96000
    });
    const tone = (n, ch) => 0.3 * Math.sin(2 * Math.PI * 8000 * n / 96000 + ch);
    const total = 512 * 40;
    const seedA = runBlocks(p(), tone, total, { __seededRandom: () => 0.42 });
    const seedB = runBlocks(p(), tone, total, { __seededRandom: () => 0.77 });
    assert.notEqual(seedA.ctx.cassetteArtifacts.rngAzimuth,
        seedB.ctx.cassetteArtifacts.rngAzimuth);
    assert.ok(seedA.out[0].some((v, i) => v !== seedB.out[0][i]),
        'two seeds must give two different azimuth trajectories');
    // Bounded, though: the wobble is a stationary process with a 4 sigma
    // clamp, so the two renders stay close in level however long they run.
    const rms = channel => {
        let sum = 0;
        for (let i = total / 2; i < total; i++) sum += channel[i] * channel[i];
        return Math.sqrt(sum / (total / 2));
    };
    const difference = 20 * Math.log10(rms(seedA.out[0]) / rms(seedB.out[0]));
    assert.ok(Math.abs(difference) < 1,
        `the wobble must be bounded, not a walk (seed-to-seed level difference `
        + `${difference.toFixed(3)} dB at 8 kHz)`);
    // And the Grade really is what owns it: Reference draws nothing.
    const reference = runBlocks(
        defaultParams({
            dg: 'Reference', wf: 0, hs: HISS_OFF, dp: 0, az: 2, channelCount: 2,
            blockSize: 512, sampleRate: 96000
        }), tone, total, { __seededRandom: () => 0.42 });
    assert.equal(reference.ctx.cassetteArtifacts.azWobbleA, 0);
    assert.equal(reference.ctx.cassetteArtifacts.azWobbleB, 0);
});

test('dp=0 and dp>0 are bit-identical ahead of the first dropout deadline', () => {
    // dp has a non-zero default now, so both ends are stated explicitly.
    const p0 = defaultParams({ blockSize: 128, dp: 0 });
    const p30 = defaultParams({ blockSize: 128, dp: 20 });
    const tone = n => 0.25 * Math.sin(2 * Math.PI * 997 * n / 48000);
    const run0 = runBlocks(p0, tone, 128 * 6);
    const run30 = runBlocks(p30, tone, 128 * 6);
    for (let ch = 0; ch < 2; ch++) {
        for (let i = 0; i < 128 * 6; i++) {
            assert.ok(Object.is(run0.out[ch][i], run30.out[ch][i]),
                'the scheduler must colour nothing before an event fires');
        }
    }
    // dp=0 is a hard off: the reserved dropout stream is never consumed.
    assert.equal(run0.ctx.cassetteArtifacts.dropoutBudget, -1);
    assert.ok(run30.ctx.cassetteArtifacts.dropoutBudget >= 0,
        'dp>0 must draw its deadline from the reserved dropout stream');
    assert.notEqual(run30.ctx.cassetteArtifacts.rngDropout,
        run0.ctx.cassetteArtifacts.rngDropout);
});

// ==== NR: distinct modes, click-free switch, status-consistent floor =======

test('Off, Dolby B and Dolby C produce three distinct outputs', () => {
    const tone = n => 0.02 * Math.sin(2 * Math.PI * 5000 * n / 48000);
    const total = 512 * 24;
    const render = nr => runBlocks(
        defaultParams({ nr, wf: 0, dp: 0, channelCount: 1, blockSize: 512 }),
        tone, total).out[0];
    const off = render('Off');
    const dolbyB = render('Dolby B');
    const dolbyC = render('Dolby C');
    assert.ok(off.some((v, i) => v !== dolbyB[i]), 'Off and Dolby B must differ');
    assert.ok(off.some((v, i) => v !== dolbyC[i]), 'Off and Dolby C must differ');
    assert.ok(dolbyB.some((v, i) => v !== dolbyC[i]), 'Dolby B and Dolby C must differ');
});

test('an NR mode switch crossfades without a click, at any block size', () => {
    const SR = 48000;
    const amp = Math.pow(10, -20 / 20);
    const tone = n => amp * Math.sin(2 * Math.PI * 1000 * n / SR);
    const switchAt = 20480; // a boundary of both block sizes below
    const total = 48640;
    let fadeSeen = false;
    const switcher = (params, n, ctx) => {
        params.nr = n >= switchAt ? 'Dolby C' : 'Off';
        if (n > switchAt && ctx.cassetteArtifacts && ctx.cassetteArtifacts.dolbyFade > 0) {
            fadeSeen = true;
        }
    };

    const run512 = runBlocks(defaultParams({ nr: 'Off', channelCount: 1, blockSize: 512 }),
        tone, total, { __seededRandom: () => 0.42 }, switcher).out[0];
    assert.ok(fadeSeen, 'the ~20 ms crossfade counter must engage after the switch');

    let maxPre = 0;
    for (let i = Math.floor(0.1 * SR); i < switchAt; i++) {
        maxPre = Math.max(maxPre, Math.abs(run512[i] - run512[i - 1]));
    }
    let maxPost = 0;
    for (let i = switchAt; i < switchAt + Math.floor(0.06 * SR); i++) {
        maxPost = Math.max(maxPost, Math.abs(run512[i] - run512[i - 1]));
    }
    assert.ok(maxPost <= 1.5 * maxPre,
        `the switch must not click (post/pre adjacent-delta ratio ${(maxPost / maxPre).toFixed(3)})`);

    // The fade counter runs in samples, so the very same switch rendered at
    // a different block size must be sample-identical (this also proves the
    // switch consumes no RNG).
    const run160 = runBlocks(defaultParams({ nr: 'Off', channelCount: 1, blockSize: 160 }),
        tone, total, { __seededRandom: () => 0.42 },
        (params, n) => { params.nr = n >= switchAt ? 'Dolby C' : 'Off'; }).out[0];
    let worst = 0;
    for (let i = 0; i < total; i++) worst = Math.max(worst, Math.abs(run512[i] - run160[i]));
    assert.ok(worst <= 1e-12,
        `the switch must be block-size independent (worst |diff| ${worst.toExponential(2)})`);
});

test('the no-signal floor follows the status formula for Type and NR', () => {
    // The status formula is now hs + (typeFloor - H_II) - rl - quieting: the
    // hiss level is solved in the flux domain and carried out through the
    // makeup, so every dB of Record Level is a dB of signal-to-noise. The
    // grid below therefore includes two Record Levels, and the rl axis is
    // what would have shown nothing at all before W-A.
    const SR = 48000;
    const hs = Math.round(CAL.H_II * 10) / 10;
    const measureFloor = over => {
        const p = defaultParams({
            wf: 0, dp: 0, hs, channelCount: 1, blockSize: 512, sampleRate: SR, ...over
        });
        const total = 512 * 235; // ~2.5 s
        const { out } = runBlocks(p, () => 0, total, { __seededRandom: () => 0.31 });
        return aWeightedRmsDbfs(out[0].subarray(SR / 2), SR); // ~0.5 s warm-up
    };
    const statusFloor = over => {
        const plugin = new Plugin();
        plugin.setParameters({ tp: 'Type II', hs, ...over });
        return plugin._effectiveHissDbFs();
    };

    const cases = [
        { tp: 'Type II', nr: 'Off', rl: 0 },   // the Base itself: floor == hs
        { tp: 'Type I', nr: 'Off', rl: 0 },    // the Type column difference
        { tp: 'Type II', nr: 'Off', rl: 12 },  // the Record Level term
        { tp: 'Type II', nr: 'Dolby B', rl: 9 },
        { tp: 'Type II', nr: 'Dolby C', rl: 9 }
    ];
    const measured = new Map();
    for (const parameters of cases) {
        const rendered = measureFloor(parameters);
        const status = statusFloor(parameters);
        measured.set(parameters.nr + parameters.tp + parameters.rl, rendered);
        assert.ok(Math.abs(rendered - status) <= 1.0,
            `${parameters.tp}/${parameters.nr}/rl=${parameters.rl}: measured `
            + `${rendered.toFixed(2)} dBFS must match status ${status.toFixed(2)} dBFS`);
    }
    // The headline W-A result, stated as its own assertion: 12 dB of Record
    // Level is 12 dB of floor. Before W-A this difference was exactly zero.
    const floorMoves = measured.get('OffType II0') - measured.get('OffType II12');
    assert.ok(Math.abs(floorMoves - 12) <= 0.2,
        `the floor must follow Record Level 1 dB/dB (12 dB of rl moved it ${floorMoves.toFixed(2)} dB)`);
    const measuredB = measured.get('Dolby BType II9');
    const measuredC = measured.get('Dolby CType II9');
    measured.set('OffType II', measureFloor({ tp: 'Type II', nr: 'Off', rl: 9 }));
    measured.set('Dolby BType II', measuredB);
    measured.set('Dolby CType II', measuredC);
    // The NR on/off floor difference is the decoder's real quieting: it must
    // be a reduction, and the status formula above already pinned its size.
    assert.ok(measured.get('OffType II') - measured.get('Dolby BType II') > 0.5,
        'Dolby B must lower the no-signal floor');
    assert.ok(measured.get('OffType II') - measured.get('Dolby CType II') > 0.5,
        'Dolby C must lower the no-signal floor');
});

test('the no-signal floor follows the status formula at the HOST rate too', () => {
    // R3 F-15. The check above renders at 48 kHz, which used to be the fixed
    // rate the status simulation itself ran at, so the two sides moved
    // together and the simulation rate was invisible to the suite. The
    // quieting term is not rate-invariant (the injected hiss keeps an
    // ultrasonic tail that grows with the rate and the Dolby detector is
    // wideband), and EffeTune warns below 88.2 kHz, so the rate that matters
    // is the host's. This case therefore declares a 96 kHz engine and renders
    // at 96 kHz; a simulation pinned to any other rate fails it.
    //
    // Type I / Dolby C is the most rate-sensitive corner of the matrix. The
    // tolerance is the calibration ledger's status-vs-render gate.
    const SR = 96000;
    const hs = Math.round(CAL.H_II * 10) / 10;
    const previousContext = sandbox.window.audioContext;
    sandbox.window.audioContext = { sampleRate: SR };
    try {
        for (const parameters of [
            { tp: 'Type I', nr: 'Dolby C', rl: -12, dl: 0 },
            { tp: 'Type II', nr: 'Dolby B', rl: 9, dl: 2.5 }
        ]) {
            const p = defaultParams({
                wf: 0, dp: 0, hs, channelCount: 1, blockSize: 512, sampleRate: SR,
                ...parameters
            });
            const total = 512 * 470; // ~2.5 s
            const { out } = runBlocks(p, () => 0, total, { __seededRandom: () => 0.31 });
            const rendered = aWeightedRmsDbfs(out[0].subarray(SR / 2), SR); // ~0.5 s warm-up

            const plugin = new Plugin();
            plugin.setParameters({ hs, ...parameters });
            const status = plugin._effectiveHissDbFs();

            assert.ok(Math.abs(rendered - status) <= 0.75,
                `${parameters.tp}/${parameters.nr}/rl=${parameters.rl} at ${SR} Hz: `
                + `measured ${rendered.toFixed(2)} dBFS must match status `
                + `${status.toFixed(2)} dBFS (err ${(rendered - status).toFixed(3)} dB)`);
        }
    } finally {
        sandbox.window.audioContext = previousContext;
    }
});

test('the status simulation follows the engine rate and caches per rate', () => {
    // R3 F-15, the cheap half: the rendered check above pins the figure at one
    // host rate, this pins the mechanism. The measured quieting term really
    // does move with the rate, so a simulation that follows the engine must
    // produce a different figure at each declared rate, and the cache — which
    // is module-scope and shared by every instance — must not serve one
    // rate's measurement for another.
    //
    // The probe is a hiss level well above the Base rather than an extreme
    // Record Level: after W-A the quieting term is rl-invariant by
    // construction (the injected floor and the decoder's reference scale
    // together), so rl is no longer a way to reach the rate-sensitive corner.
    // Overrunning the Dolby reference with `hs` is.
    const hs = -45;
    const previousContext = sandbox.window.audioContext;
    const effectiveFloor = () => {
        const plugin = new Plugin();
        plugin.setParameters({ tp: 'Type I', nr: 'Dolby C', hs, rl: 0 });
        return plugin._effectiveHissDbFs();
    };
    try {
        sandbox.window.audioContext = { sampleRate: 48000 };
        const at48k = effectiveFloor();
        sandbox.window.audioContext = { sampleRate: 96000 };
        const at96k = effectiveFloor();
        sandbox.window.audioContext = { sampleRate: 192000 };
        const at192k = effectiveFloor();
        sandbox.window.audioContext = undefined;
        const fallback = effectiveFloor();
        sandbox.window.audioContext = { sampleRate: 48000 };
        const at48kAgain = effectiveFloor();

        assert.ok(Math.abs(at96k - at48k) > 0.5,
            `the 96 kHz figure (${at96k.toFixed(2)}) must differ from the 48 kHz one `
            + `(${at48k.toFixed(2)}): the simulation must follow the engine`);
        assert.ok(Math.abs(at192k - at96k) > 0.25,
            `the 192 kHz figure (${at192k.toFixed(2)}) must differ from the 96 kHz `
            + `one (${at96k.toFixed(2)})`);
        assert.equal(at48kAgain, at48k,
            'stepping back to a rate already measured must return that rate\'s figure: '
            + 'the cache is per rate');
        // RS-30. With no engine to ask, the figure must be the one for the
        // project's reference rate — not for 48 kHz, which is a rate this
        // application actively warns against. Getting this wrong is invisible
        // in a live session and wrong in every headless one, which is how it
        // reached the published documentation.
        assert.equal(fallback, at96k,
            `with no engine the figure must be the 96 kHz one (got ${fallback.toFixed(2)} `
            + `against ${at96k.toFixed(2)}); a 48 kHz fallback reads 0.19 dB low on Dolby B `
            + 'and 0.50 dB high on Dolby C');
    } finally {
        sandbox.window.audioContext = previousContext;
    }
});

test('the status floor agrees with a settled render with no engine present', () => {
    // RS-30. The two existing floor-vs-status cases both declare an audio
    // context, so both only ever exercised the path where the simulation can
    // ask the engine what rate it is running at. The headless path — no
    // engine, fall back to a constant — was never checked against a render,
    // and that is precisely the path anything generating documentation or
    // running offline takes. It was reporting the quieting for a 48 kHz deck.
    //
    // The whole Type x NR grid, because the error was not uniform: the
    // quieting term moves in OPPOSITE directions with rate for the two Dolby
    // modes, so a wrong rate reads low on B and high on C. Checking one mode
    // would have missed half of it, and checking their average would have
    // missed all of it.
    const SR = 96000;
    const BLOCK = 512;
    const hs = Math.round(CAL.H_II * 10) / 10;
    const previousContext = sandbox.window.audioContext;
    // No engine: this is the configuration under test.
    sandbox.window.audioContext = undefined;
    try {
        for (const tp of ['Type I', 'Type II', 'Type IV']) {
            for (const nr of ['Off', 'Dolby B', 'Dolby C']) {
                const p = defaultParams({
                    tp, nr, rl: 0, dl: 0, hs, wf: 0, dp: 0, az: 0, bs: 0,
                    channelCount: 1, blockSize: BLOCK, sampleRate: SR
                });
                // ~2.6 s, settled: the quieting term is stable from 0.26 s on.
                const total = BLOCK * 490;
                const { out } = runBlocks(p, () => 0, total, { __seededRandom: () => 0.31 });
                const rendered = aWeightedRmsDbfs(out[0].subarray(SR / 2), SR);

                const plugin = new Plugin();
                plugin.setParameters({ tp, nr, rl: 0, dl: 0, hs });
                const status = plugin._effectiveHissDbFs();

                assert.ok(Math.abs(rendered - status) <= 0.3,
                    `${tp}/${nr} with no engine: status ${status.toFixed(2)} dBFS must match `
                    + `a settled ${SR} Hz render ${rendered.toFixed(2)} dBFS `
                    + `(err ${(rendered - status).toFixed(3)} dB; a 48 kHz fallback puts `
                    + 'Dolby C 0.5 dB out here, with the opposite sign to Dolby B)');
            }
        }
    } finally {
        sandbox.window.audioContext = previousContext;
    }
});

test('the NR matched round trip holds on tones and is Record Level invariant', () => {
    // The central B/C contract (plan §1): encoder and decoder are matched,
    // so under ideal conditions the NR on/off steady-state transfer
    // difference on a tone is near zero at low/mid frequencies, small and
    // frozen at HF, and — because the decoder's detector reference maps
    // through the exact inverse makeup (plan F-1) — independent of the
    // operating point.
    //
    // Measurement conditions: Deck Grade Consumer, Type II, bs=0, wf=0,
    // hs=-92 (hard off), dp=0, az=0, dl=0, og=0, mx=100, mono, 48 kHz,
    // block 512, 0.8 s render, RMS over the final 0.4 s, tone level 20 dB
    // under the tape's operating point (levelDb = -rl - 20, so the tone sits
    // at the same place ON THE TAPE at every Record Level — which is what
    // "invariant" has to mean for a compander).
    const SR = 48000;
    const BLOCK = 512;
    const total = BLOCK * 75; // ~0.8 s
    const settle = Math.floor(0.4 * SR);
    const rms = samples => {
        let sum = 0;
        for (const value of samples) sum += value * value;
        return Math.sqrt(sum / samples.length);
    };
    const steadyRms = (nr, freqHz, rl) => {
        const p = defaultParams({
            dg: 'Consumer', tp: 'Type II', nr, bs: 0, rl, wf: 0, hs: HISS_OFF,
            dp: 0, az: 0, dl: 0, og: 0,
            mx: 100, channelCount: 1, blockSize: BLOCK, sampleRate: SR
        });
        const amp = Math.pow(10, (-rl - 20) / 20);
        const tone = n => amp * Math.sin(2 * Math.PI * freqHz * n / SR);
        const { out } = runBlocks(p, tone, total, { __seededRandom: () => 0.42 });
        return rms(out[0].subarray(settle));
    };
    // Frozen figures measured under exactly these conditions:
    //   1 kHz:  B-Off -0.0008 dB, C-Off -0.0077 dB (both ~0: matched pair)
    //   5 kHz:  B-Off -0.1460 dB, C-Off -1.4570 dB — the HF tape-compression
    //           mistracking residue. It is real-deck behaviour and kept by
    //           design; W-D's Dolby Level Error is what opens the other side
    //           of it, the side the tape alone can never reach.
    const FROZEN_5K = { 'Dolby B': -0.1460, 'Dolby C': -1.4570 };
    for (const nr of ['Dolby B', 'Dolby C']) {
        const diffs = {};
        for (const rl of [0, 18]) {
            const diff1k = 20 * Math.log10(steadyRms(nr, 1000, rl) / steadyRms('Off', 1000, rl));
            const diff5k = 20 * Math.log10(steadyRms(nr, 5000, rl) / steadyRms('Off', 5000, rl));
            assert.ok(Math.abs(diff1k) <= 0.1,
                `${nr} rl=${rl}: 1 kHz round trip must be matched within 0.1 dB (got ${diff1k.toFixed(4)} dB)`);
            assert.ok(Math.abs(diff5k - FROZEN_5K[nr]) <= 0.5,
                `${nr} rl=${rl}: 5 kHz residue must sit at the frozen ${FROZEN_5K[nr]} dB +-0.5 dB (got ${diff5k.toFixed(4)} dB)`);
            diffs[rl] = { diff1k, diff5k };
        }
        // plan F-1: the same difference at every Record Level.
        assert.ok(Math.abs(diffs[0].diff1k - diffs[18].diff1k) < 0.05,
            `${nr}: 1 kHz round-trip difference must be Record Level invariant`);
        assert.ok(Math.abs(diffs[0].diff5k - diffs[18].diff5k) < 0.05,
            `${nr}: 5 kHz round-trip difference must be Record Level invariant`);
    }
});

// ==== determinism ==========================================================

test('seeded renders are reproducible and block-split independent', () => {
    // The azimuth wobble is the reason this case matters more than it used
    // to. Its coefficient is re-solved every sample rather than once per
    // block, which is the only form that survives block splitting: a
    // per-block update would make the output depend on where the host chose
    // to cut the stream, and interpolating between block endpoints would
    // leave a residue to click on. Both the biggest Grade wobble and the
    // largest dropout rate are exercised.
    const total = 512 * 140; // ~1.5 s
    const music = (n, ch) => 0.3 * Math.sin(2 * Math.PI * 997 * n / 48000 + ch)
        + 0.1 * Math.sin(2 * Math.PI * 3001 * n / 48000);
    for (const over of [
        { dp: CAL.D_MAX, dg: 'Consumer', az: 2 },
        { dp: CAL.D_MAX, dg: 'Portable', az: -6, wf: 0.5 }
    ]) {
        const p = blockSize => defaultParams({ ...over, blockSize, channelCount: 2 });
        const a = runBlocks(p(512), music, total, { __seededRandom: () => 0.42 }).out;
        const b = runBlocks(p(512), music, total, { __seededRandom: () => 0.42 }).out;
        const c = runBlocks(p(128), music, total, { __seededRandom: () => 0.42 }).out;
        for (let ch = 0; ch < 2; ch++) {
            for (let i = 0; i < total; i++) {
                assert.ok(Object.is(a[ch][i], b[ch][i]),
                    `same seed must reproduce bit-identically (${over.dg}, ch ${ch}, sample ${i})`);
                assert.ok(Object.is(a[ch][i], c[ch][i]),
                    `block split must not change the output (${over.dg}, ch ${ch}, sample ${i})`);
            }
        }
    }
});

// ==== wet latency ==========================================================

test('the aligned dry tap sits at the ledger latency at every rate', () => {
    // Rate-by-rate wet latency ledger (w4-measurements.md §5):
    // base transport delay + 2x oversampler group delay (11 samples).
    //
    // W-D opened the azimuth up to +-6 arcmin plus a Grade-sized wobble, and
    // the ledger is unchanged by it: the inter-track lag is a symmetric
    // +-dt/2 split, so the pair's MEAN delay does not move, and a mono render
    // (which is what this measures) carries no lag at all. The case runs at
    // the worst legal settings to prove it.
    const LATENCY_LEDGER = { 44100: 165, 48000: 179, 96000: 347, 192000: 683 };
    for (const [rateKey, expected] of Object.entries(LATENCY_LEDGER)) {
        const sampleRate = Number(rateKey);
        const total = expected + 4096;
        let lcg = 0x2545f491;
        const input = new Float32Array(total);
        for (let i = 0; i < total; i++) {
            lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
            input[i] = (lcg / 4294967296 - 0.5) * 0.5;
        }
        const makeSample = n => (n < total ? input[n] : 0);
        const render = mx => runBlocks(
            defaultParams({
                mx, sampleRate, channelCount: 1, blockSize: 512,
                dg: 'Portable', az: CAL.AZ_MAX_ARCMIN, wf: 1
            }),
            makeSample, total, { __seededRandom: () => 0.42 }).out[0];
        const out100 = render(100);
        const out50 = render(50);
        // out = dry + mix * (wet - dry), and both renders share the seed, so
        // 2 * out(50%) - out(100%) recovers the delay-aligned dry tap.
        let worst = 0;
        for (let n = expected + 256; n < total; n++) {
            const dry = 2 * out50[n] - out100[n];
            worst = Math.max(worst, Math.abs(dry - input[n - expected]));
        }
        assert.ok(worst <= 1e-6,
            `${sampleRate} Hz: dry tap must sit ${expected} samples back (worst err ${worst.toExponential(2)})`);
    }
});

// ==== transport ring capacity ==============================================

// The worst-case |theta| the delay ring and the deviation clamp have to budget
// for: the Azimuth control's own limit plus the largest Grade's clamped wobble.
// Both constants below are the processor's, restated here rather than read from
// it, because they are the *conditions* of the budget.
const AZ_WOBBLE_CLAMP_SIGMA = 4;
const ARCMIN_TO_RADIANS = Math.PI / (180 * 60);
const maxGradeWobbleArcmin = () => GRADES.reduce(
    (worst, name) => Math.max(worst, CAL.GRADES[name].azWobbleArcmin), 0);
const azMaxHalfDelaySamples = sampleRate => 0.5 * CAL.TRACK_CENTER_SPACING_M / CAL.SPEED_MPS
    * sampleRate * (CAL.AZ_MAX_ARCMIN + AZ_WOBBLE_CLAMP_SIGMA * maxGradeWobbleArcmin())
    * ARCMIN_TO_RADIANS;

test('the transport ring is sized per host rate and holds the calibrated wow peak', () => {
    // R2-A. The ring has to hold the base delay, the deepest wow excursion, the
    // azimuth lag and the cubic interpolator's reach, and every one of those is
    // proportional to the host rate — so ONE ring length is a fixed length in
    // seconds at exactly one rate. It used to be a bare 2048, sized for
    // 192 kHz; at the 352.8 and 384 kHz the application offers
    // (js/electron/audioIntegration.js) the capacity term of the deviation
    // clamp then became a CEILING ON WOW rather than a safety net — from
    // wf ≈ 0.62 % up at 384 kHz the 0.42 Hz hub term flat-topped every cycle,
    // and the discontinuity in the delay's derivative at each clamp entry and
    // exit is an audible step in pitch.
    //
    // Two things are checked, and the first one is a hard compatibility
    // condition rather than a quality bar: every rate up to and including
    // 192 kHz must still get exactly 2048, because DELAY_MASK enters every ring
    // index and every shipped parity golden was generated against that mask.
    const T = CAL.TRANSPORT;
    assert.equal(T.PEAK_DEVIATION_SECONDS, 0.002861,
        'the ring is sized from the measured max |delay deviation| at wf = 1.000 %, '
        + '2.861 ms (w4-solve.mjs, 44.1-192 kHz x 5 seeds x 60 s)');
    assert.equal(T.RING_MIN_LENGTH, 2048,
        'the floor is the length every shipped golden at 192 kHz and below was generated with');
    assert.equal(T.RING_MAX_LENGTH, 4096,
        'the cap is the native kernel\'s fixed ring capacity (kRingMaxLength in '
        + 'dsp/plugins/lofi/cassette_artifacts/kernel.cpp)');

    // The ring itself, read back out of the processor's own state rather than
    // recomputed: one 64-frame block is enough to create it.
    const ringLength = sampleRate => {
        const ctx = { __seededRandom: () => 0.42 };
        runBlocks(defaultParams({
            sampleRate, channelCount: 2, blockSize: 64, dg: 'Portable',
            az: CAL.AZ_MAX_ARCMIN, wf: 1
        }), () => 0, 64, ctx);
        return ctx.cassetteArtifacts.delayBuffers[0].length;
    };

    for (const sampleRate of [44100, 48000, 88200, 96000, 176400, 192000]) {
        assert.equal(ringLength(sampleRate), 2048,
            `${sampleRate} Hz must keep the 2048-sample ring: the mask derived from it enters `
            + 'every delay index, so any other length silently invalidates every parity golden');
    }
    for (const sampleRate of [352800, 384000]) {
        assert.equal(ringLength(sampleRate), 4096,
            `${sampleRate} Hz needs the larger ring: base + calibrated peak deviation + azimuth `
            + 'lag + margin does not fit in 2048 there');
    }

    // And the point of the sizing: at every rate the application offers, the
    // deviation clamp must sit ABOVE the calibrated wf = 1 % peak, so it stays
    // the safety net for the flutter tail instead of bounding the wow.
    for (const sampleRate of [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000]) {
        const length = ringLength(sampleRate);
        const base = Math.round(T.BASE_SECONDS * sampleRate);
        const azimuthLag = azMaxHalfDelaySamples(sampleRate);
        const peak = T.PEAK_DEVIATION_SECONDS * sampleRate;
        // The two limits the processor's clamp is the minimum of.
        const writePointerRoom = base - 4 - azimuthLag;
        const ringCapacityRoom = length - 3 - base - azimuthLag;
        const maxDeviation = Math.min(writePointerRoom, ringCapacityRoom);
        assert.ok(maxDeviation > peak,
            `${sampleRate} Hz: the deviation clamp must stay above the calibrated wf = 1 % peak `
            + `of ${peak.toFixed(1)} samples (ring ${length}, write-pointer room `
            + `${writePointerRoom.toFixed(1)}, capacity room ${ringCapacityRoom.toFixed(1)}, `
            + `clamp ${maxDeviation.toFixed(1)}); at or below the peak it is a ceiling on wow, `
            + 'not a safety net');
    }
});

test('the kernel\'s azimuth wobble ceiling matches the largest Grade in the table', () => {
    // R2-B. The JavaScript derives this by scanning CAL.GRADES; the native
    // kernel cannot, so it carries a hand-copied literal. That literal is not a
    // calibration figure — it sizes kAzThetaMaxRadians, which is what both the
    // transport deviation clamp and the ring sizing subtract as the inter-track
    // lag budget. Raising any Grade's azWobbleArcmin without raising it too
    // leaves the kernel's clamp too generous (azHalfDelayScale is 0.528 samples
    // per arcmin at 192 kHz, so one arcmin is most of the write-pointer
    // margin), which is a memory-safety defect rather than a drift in sound.
    const KERNEL_AZ_MAX_WOBBLE_ARCMIN = 4.0;
    assert.equal(maxGradeWobbleArcmin(), KERNEL_AZ_MAX_WOBBLE_ARCMIN,
        'constexpr double kAzMaxWobbleArcmin in '
        + 'dsp/plugins/lofi/cassette_artifacts/kernel.cpp must equal '
        + `max(CAL.GRADES[*].azWobbleArcmin) = ${maxGradeWobbleArcmin()} arcmin; it is currently `
        + `${KERNEL_AZ_MAX_WOBBLE_ARCMIN}. Update the kernel constant and this literal together.`);
});

// ==== status line and UI ===================================================

test('the status line reports Base to effective per the plan wording', () => {
    const plugin = new Plugin();
    // The NR term is measured, and the readout only states a figure once the
    // measurement for that key exists (R3 F-16), so take it synchronously
    // here rather than depending on another test having warmed the cache.
    plugin._effectiveHissDbFs();
    const status = plugin._statusText();
    // Record Level is a static segment, not a meter (plan D-6): what it has
    // to say is the convention, because the number alone does not tell you
    // that the reference is a 0 dBFS peak.
    assert.match(status,
        /Record Level \+9\.0 dB → tape peak \+9\.0 dB re 250 nWb\/m at 0 dBFS in/);
    // The speed label comes from the calibration table, and this readout is
    // now the only place the transport speed is stated at all.
    assert.match(status, /Wow\/Flutter Base 0\.200% → 0\.200% at 4\.76 cm\/s \(1⅞ ips\)/);
    assert.ok(status.includes(`at ${CAL.SPEED_LABEL}`),
        'the printed speed must be the table\'s label, not a literal that can drift');
    // The Hiss Base is in the tape's unit, the arrow's target in dBFS: they
    // are different quantities now and the line has to say which is which.
    assert.match(status, /Hiss Base -60\.5 dB re 250 nWb\/m → -\d+\.\d dBFS, Type I, Dolby B/);

    // Record Level moves the effective floor 1 dB/dB, and the readout has to
    // follow, because that is the whole point of W-A.
    const hot = new Plugin();
    hot.setParameters({ rl: 15 });
    hot._effectiveHissDbFs();
    const quiet = new Plugin();
    quiet.setParameters({ rl: 3 });
    quiet._effectiveHissDbFs();
    const floorOf = text => Number(text.match(/→ (-?\d+\.\d) dBFS/)[1]);
    assert.ok(Math.abs((floorOf(quiet._statusText()) - floorOf(hot._statusText())) - 12) <= 0.05,
        'the status floor must move 12 dB for 12 dB of Record Level');

    const off = new Plugin();
    off.setParameters({ hs: HISS_OFF, nr: 'Off' });
    assert.match(off._statusText(), /Hiss Base -92\.0 dB re 250 nWb\/m → off/);
    assert.doesNotMatch(off._statusText(), /NR Off/,
        'the NR label belongs to the audible-hiss readout only');

    const nrOff = new Plugin();
    nrOff.setParameters({ nr: 'Off' });
    assert.match(nrOff._statusText(), /, Type I, NR Off/);

    const typed = new Plugin();
    typed.setParameters({ tp: 'Type IV', nr: 'Dolby C' });
    assert.match(typed._statusText(), /, Type IV, Dolby C/);

    const cold = new Plugin();
    cold.setParameters({ rl: -7.5 });
    assert.match(cold._statusText(),
        /Record Level -7\.5 dB → tape peak -7\.5 dB re 250 nWb\/m at 0 dBFS in/,
        'a negative Record Level must not gain a stray plus sign');
});

test('an unmeasured NR key reads "measuring" instead of another key\'s figure', async () => {
    // R3 F-16, generalised by R5 F-21. The NR term is measured off the
    // interaction path, so between a change and its measurement there is
    // nothing exact to show. Reusing the last figure across an NR mode change
    // (or reusing the initial 0, which reads as "NR Off, no quieting") put a
    // settled-looking value 8-18 dB out into an aria-live region. Reusing it
    // across the level axis was worth up to 4.79 dB (R4 F-20) and across `hs`
    // more than 12 dB where the hiss overruns the Dolby reference. So the
    // rule is the simple one: the cached figure for the exact key, or
    // "measuring…". Any key already measured — including one stepped back
    // to — still paints immediately.
    //
    // W-A retired the Record Level axis from the key and W-D put the Dolby
    // Level Error in its place. That is not bookkeeping: rl no longer moves
    // the measured term at all (the injected floor and the decoder's
    // reference scale together), so an rl drag is now free, while dl moves it
    // on purpose and therefore has to miss.
    //
    // The tail of this case is the R2 F-14 / R4 F-17 regression gate: a real
    // drag must not push its intermediate keys through the ~78 ms renderer,
    // and removal from the pipeline must cancel the pending measurement.
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const floorOf = text => {
        const match = text.match(/→ (-?\d+\.\d) dBFS/);
        return match ? Number(match[1]) : null;
    };
    const settle = async plugin => {
        for (let i = 0; i < 40 && /measuring/.test(plugin.statusElement.textContent); i++) {
            await sleep(50);
        }
        return plugin.statusElement.textContent;
    };

    const plugin = new Plugin();
    plugin.updateParameters = () => {};
    plugin.statusElement = new FakeElement('div');
    try {
        // A key no other test touches, so the cache really is cold: this is
        // the first paint an opened UI sees.
        plugin.setParameters({ tp: 'Type IV', nr: 'Dolby B', hs: -57.3 });
        assert.match(plugin.statusElement.textContent,
            /Hiss Base -57\.3 dB re 250 nWb\/m → measuring…, Type IV, Dolby B/,
            'a cold key must not state a figure it has not measured');
        const settledB = floorOf(await settle(plugin));
        assert.ok(settledB !== null, 'the measurement must replace "measuring…" with a figure');

        // R5 F-21: hs is part of the key, so an hs step is an ordinary cache
        // miss and must not present the previous step's figure either.
        plugin.setParameters({ hs: -57.4 });
        assert.match(plugin.statusElement.textContent,
            /Hiss Base -57\.4 dB re 250 nWb\/m → measuring…, Type IV, Dolby B/,
            'an hs step must not present the previous hs value\'s figure');
        const settledHs = floorOf(await settle(plugin));
        assert.ok(Math.abs(settledHs - (settledB - 0.1)) <= 0.5,
            `one hs step must move the floor with the Base value (${settledB} vs ${settledHs})`);

        // Stepping back onto a key that has been measured is a cache hit, so
        // it paints that key's figure at once rather than "measuring…" again.
        plugin.setParameters({ hs: -57.3 });
        assert.doesNotMatch(plugin.statusElement.textContent, /measuring/,
            'a key already in the cache must paint its figure immediately');
        assert.equal(floorOf(plugin.statusElement.textContent), settledB,
            'and it must be the figure that key measured before');
        assert.equal(plugin._nrQuietingTimer, null,
            'a cache hit must not schedule a measurement at all');

        // W-A: Record Level is NOT part of the key any more, because it
        // cannot move the measured term. An rl jump must therefore be a cache
        // HIT — it repaints instantly with the same quieting figure — while
        // the effective floor still moves, through the exact "- rl" term.
        const beforeRl = floorOf(plugin.statusElement.textContent);
        plugin.setParameters({ rl: 15 });
        assert.doesNotMatch(plugin.statusElement.textContent, /measuring/,
            'a Record Level change must not force a re-measurement');
        assert.ok(Math.abs((beforeRl - floorOf(plugin.statusElement.textContent)) - 6) <= 0.05,
            'but the effective floor must still follow it 1 dB/dB');
        plugin.setParameters({ rl: 9 });

        // W-D: the Dolby Level Error takes the axis rl vacated, and it is a
        // real miss.
        plugin.setParameters({ dl: -2.4 });
        assert.match(plugin.statusElement.textContent,
            /→ measuring…, Type IV, Dolby B/,
            'a Dolby Level Error jump must not present the previous dl\'s figure');
        const settledDl = floorOf(await settle(plugin));
        assert.ok(settledDl !== null,
            'the measurement must replace "measuring…" after a dl jump too');

        // An NR mode change must not carry the figure across.
        plugin.setParameters({ nr: 'Dolby C' });
        assert.match(plugin.statusElement.textContent,
            /→ measuring…, Type IV, Dolby C/,
            'a mode change must not show the previous mode\'s figure');
        const settledC = floorOf(await settle(plugin));
        assert.ok(settledC < settledDl - 5,
            `Dolby C must settle well below Dolby B (${settledC} vs ${settledDl})`);

        // Coming back from Off, where the exact term is 0, must not present
        // that 0 as this mode's measurement either.
        plugin.setParameters({ nr: 'Off' });
        assert.match(plugin.statusElement.textContent, /→ -\d+\.\d dBFS, Type IV, NR Off/,
            'NR Off is exact and needs no measurement');
        plugin.setParameters({ nr: 'Dolby C', dl: 1.7 });
        assert.match(plugin.statusElement.textContent, /→ measuring…, Type IV, Dolby C/,
            'a cold key entered from Off must not show the un-quieted floor');
        assert.ok(floorOf(await settle(plugin)) !== null);

        // R2 F-14 / R4 F-17. Eight drag steps at the ~20 ms cadence of real
        // slider input events, against the 150 ms trailing-edge debounce:
        // every step must push the pending measurement ahead of itself, so
        // the renderer — and therefore the cache — sees at most the odd step
        // on a stalled machine, never one render per step. A 0 ms timer
        // coalesces only within one task and would render seven of the eight.
        const cache = vm.runInContext('CASSETTE_ARTIFACTS_STATUS_STATE', vmContext).cache;
        const measuredBefore = cache.size;
        for (let step = 0; step < 8; step++) {
            if (step > 0) await sleep(20);
            plugin.setParameters({ dl: -3 + step * 0.1 });
        }
        const rendered = cache.size - measuredBefore;
        assert.ok(rendered <= 3,
            `a drag must not render its intermediate keys (${rendered} of 8 steps reached the renderer)`);
        // The last step just landed, so its measurement is still pending, and
        // removal must cancel it rather than leave it to rewrite a detached
        // status element ~78 ms later.
        assert.notEqual(plugin._nrQuietingTimer, null,
            'the final drag step must leave one measurement pending');
        plugin.cleanup();
        assert.equal(plugin._nrQuietingTimer, null,
            'cleanup() must cancel the pending measurement');
    } finally {
        plugin.cleanup();
    }
});

test('the UI carries the radio groups, sliders and ARIA status, and states the speed once', () => {
    const plugin = new Plugin();
    plugin.id = 1;
    const container = plugin.createUI();
    assert.ok(container.classList.contains('cassette-artifacts-plugin-ui'));
    assert.ok(container.classList.contains('plugin-parameter-ui'));

    // The fixed transport speed is stated exactly once, in the status line's
    // Wow/Flutter readout. It used to head the panel as a separate fixed row
    // as well; two statements of one constant is one place for them to
    // disagree and a row of screen for no information.
    const statusRows = container.querySelectorAll('.cassette-artifacts-status');
    assert.equal(statusRows.length, 1, 'exactly one status row: the live one at the bottom');
    assert.equal(container.children[0], container.querySelectorAll('.radio-group')[0],
        'the panel now opens on the Deck Grade, not on a fixed speed row');
    assert.equal(CAL.SPEED_LABEL, '4.76 cm/s (1⅞ ips)');
    assert.match(plugin._statusText(), /at 4\.76 cm\/s \(1⅞ ips\)/,
        'and the surviving statement carries the full label the removed row had');

    // Deck Grade, Tape Type and Noise Reduction are radio groups, in that
    // order: the machine, then the medium, then the noise reduction.
    const groups = container.querySelectorAll('.radio-group');
    assert.equal(groups.length, 3);
    const [gradeGroup, typeGroup, nrGroup] = groups;
    assert.equal(gradeGroup.children[0].textContent, 'Deck Grade:');
    assert.equal(typeGroup.children[0].textContent, 'Tape Type:');
    assert.equal(nrGroup.children[0].textContent, 'Noise Reduction:');
    const radioValues = group => group.querySelectorAll('input')
        .filter(el => el.type === 'radio').map(el => el.value);
    assert.deepEqual(radioValues(gradeGroup),
        ['Reference', 'Hi-Fi', 'Consumer', 'Portable']);
    assert.deepEqual(radioValues(gradeGroup), GRADES,
        'the Deck Grade options come from the calibration table, not a second list');
    assert.deepEqual(radioValues(typeGroup), ['Type I', 'Type II', 'Type IV']);
    assert.deepEqual(radioValues(nrGroup), ['Off', 'Dolby B', 'Dolby C']);

    // The numeric controls carry the plan §2 ranges.
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
    // RS-18: the unit is spelled out, because "dB" alone would read as a trim
    // and this number is the tape's own datasheet figure.
    expectRange('Hiss (dB re 250 nWb/m):', HISS_OFF, -42, 0.1);
    expectRange('Dropouts (events/min):', 0, CAL.D_MAX, 0.1);
    expectRange('Azimuth (arcmin):', -CAL.AZ_MAX_ARCMIN, CAL.AZ_MAX_ARCMIN, 0.1);
    expectRange('Dolby Level Error (dB):', -3, 3, 0.1);
    expectRange('Output (dB):', -24, 24, 0.1);
    expectRange('Mix (%):', 0, 100, 1);
    assert.equal(sliders.size, 9);
    assert.equal(sliders.has('Input Peak (dBFS):'), false,
        'Input Peak must be gone from the UI, not merely renamed');

    // The last line is the polite live status region.
    const status = container.children[container.children.length - 1];
    assert.equal(status.className, 'cassette-artifacts-status');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.getAttribute('aria-atomic'), 'true');
    assert.equal(status.textContent, plugin._statusText());

    // Selecting a Type through the radio group refreshes the live status.
    const typeIV = typeGroup.querySelectorAll('input')
        .find(el => el.type === 'radio' && el.value === 'Type IV');
    typeIV.checked = true;
    typeIV.onchange({ target: typeIV });
    assert.equal(plugin.tp, 'Type IV');
    assert.match(status.textContent, /, Type IV, /);
});

test('the cassette status CSS mirrors the Tape Artifacts mobile rules', () => {
    assert.equal(cassetteCss,
        tapeCss.replaceAll('tape-artifacts', 'cassette-artifacts'),
        'cassette_artifacts.css must be the Tape Artifacts CSS with the class renamed');
    assert.match(cassetteCss, /body\.layout-mobile \.cassette-artifacts-status \{[^}]*width: 100%;/,
        'the mobile layout must keep the full-width status rule');
});
