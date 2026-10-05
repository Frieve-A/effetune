import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join(repoRoot, 'plugins', 'analyzer', 'rhythm_analyzer.js');
const PERIOD = 0.5;
// Every panel shown, for the layout tests that need them all.
const ALL_PANELS = { vt: true, vm: true, ve: true, vl: true };
// 48 kHz with a 480-sample hop: 10 ms per analysis frame, 50 frames per beat at 120 BPM.
const FRAMES_PER_BEAT = 50;

// Values created inside the vm context have foreign prototypes; compare their plain JSON form.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

class PluginBase {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.enabled = true;
        this._sectionEnabled = true;
    }

    registerProcessor(processor) { this.processor = processor; }
    _setupMessageHandler() {}
    onMessage() {}
    updateParameters() {}
    cleanup() {}

    parseFiniteNumber(value, minimum, maximum, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return number < minimum ? minimum : (number > maximum ? maximum : number);
    }
}

async function loadPlugin(globals = {}) {
    const source = await fs.readFile(pluginPath, 'utf8');
    const warnings = [];
    // The wall clock the tempogram scrolls with between telemetry frames, in ms.
    const clock = { now: 1000 };
    const context = vm.createContext({
        PluginBase,
        performance: { now: () => clock.now },
        window: { GraphReadout: { format: { number: (value, digits) => value.toFixed(digits), time: String, percent: String } } },
        console: { warn: (...args) => warnings.push(args), log() {}, error() {} },
        Object, Math, Number, Array, Float32Array, Float64Array, Uint8Array, Set, Map, String, Infinity,
        ...globals
    });
    vm.runInContext(source, context, { filename: pluginPath });
    const plugin = new context.window.RhythmAnalyzerPlugin();
    plugin.id = 7;
    return { plugin, warnings, clock };
}

// Builds a frame-28 telemetry frame (contract section 3). The next beat is due at this frame unless given.
function buildFrame({
    generation = 1, frameCount, nextBeatFrame = frameCount, locked = true, lockEpoch = 1, period = PERIOD,
    nextBeatIndex = 0, nextBeatFraction = 0, combBestBpm = 120, events = [], size = 1344
}) {
    const payload = new DataView(new ArrayBuffer(size));
    if (size !== 1344) return { frameType: 28, formatVersion: 1, payload };
    payload.setFloat32(0, 48000, true);
    payload.setUint32(4, generation, true);
    payload.setUint32(8, 480, true);
    payload.setUint32(12, frameCount, true);
    payload.setFloat32(16, frameCount * 0.01, true);
    payload.setUint32(28, events.length, true);
    payload.setUint32(32, locked ? 1 : 0, true);
    payload.setUint32(36, lockEpoch, true);
    payload.setFloat32(40, locked ? 0.3 : 0.05, true);
    payload.setFloat32(44, locked ? period : 0, true);
    payload.setUint32(48, nextBeatFrame, true);
    payload.setFloat32(52, nextBeatFraction, true);
    payload.setUint32(56, nextBeatIndex, true);
    payload.setFloat32(60, combBestBpm, true);
    events.forEach((event, slot) => {
        const base = 832 + 32 * slot;
        const beat = Math.floor(event.x);
        const frame = event.frame ?? 0;
        payload.setUint32(base, Math.floor(frame), true);
        payload.setFloat32(base + 4, frame - Math.floor(frame), true);
        payload.setUint32(base + 8, event.epoch ?? lockEpoch, true);
        payload.setInt32(base + 12, event.unlocked ? 0 : beat, true);
        payload.setFloat32(base + 16, event.unlocked ? 0 : event.x - beat, true);
        payload.setFloat32(base + 20, event.unlocked ? 0 : period, true);
        payload.setFloat32(base + 24, event.strength ?? 1, true);
        payload.setUint8(base + 28, event.band);
        payload.setUint8(base + 29, event.unlocked ? 1 : 0);
    });
    return { frameType: 28, formatVersion: 1, payload };
}

// Feeds one frame per tracker beat (0.5 s), each carrying the onsets of the beat that just ended.
function feed(plugin, events, options = {}) {
    plugin.testFrame ??= 1;
    const first = Math.floor(events[0].x);
    const last = Math.floor(events[events.length - 1].x);
    for (let beat = first; beat <= last; beat++) {
        plugin.testFrame += FRAMES_PER_BEAT;
        const chunk = events.filter(event => Math.floor(event.x) === beat).map(event => ({
            ...event,
            frame: plugin.testFrame - FRAMES_PER_BEAT * (beat + 1 - event.x)
        }));
        plugin.handleTelemetry(buildFrame({
            frameCount: plugin.testFrame, nextBeatIndex: beat + 1, events: chunk, ...options
        }));
    }
}

// One pattern per bar of 4 beats: onsets as [band, beat offset in the bar].
function pattern(bars, onsets, firstBar = 0) {
    const events = [];
    for (let bar = firstBar; bar < firstBar + bars; bar++) {
        for (const [band, offset] of onsets) events.push({ band, x: bar * 4 + offset });
    }
    return events.sort((a, b) => a.x - b.x);
}

// Kick on 1 and 3, snare 10 ms late on 2 and 4, straight eighth hi-hats.
const BACKBEAT = [
    [0, 0], [0, 2], [1, 1.02], [1, 3.02],
    ...Array.from({ length: 8 }, (_, index) => [2, index / 2])
];

// Lens rows: slot-1 marks under the band labels, and offsets whose values sit below their marks.
const LENS_ROWS = [[2, 0, -25], [1, 0, -12], [0, 0, 0], [2, 1, 8], [1, 3, -6], [0, 3, 22], [0, 5, -18]]
    .map(([band, slot, offset]) => ({ band, slot, mean: offset, offset, sd: 4, count: 20 }));

// Ring index of the stored onset of a band at tracker position x in the given epoch.
function eventAt(plugin, band, x, epoch = 1) {
    const u = x + plugin.segments.get(epoch).offset;
    for (let serial = plugin.eventSerial - 1; serial >= 0; serial--) {
        const index = serial % plugin.eventU.length;
        if (plugin.eventBand[index] === band && Math.abs(plugin.eventU[index] - u) < 1e-3) return index;
    }
    throw new Error(`no onset at band ${band}, x ${x}`);
}

// A 2D context that accepts every drawing call and records the drawn text and the stroked line segments. A
// rotated line is recorded at the point it was translated to.
function fakeContext() {
    const texts = [];
    const segments = [];
    let path = [];
    let point = null;
    let origin = null;
    const target = {
        texts,
        segments,
        measureText: text => ({ width: 6 * String(text).length }),
        translate: (x, y) => {
            origin = [x, y];
        },
        restore: () => {
            origin = null;
        },
        fillText: (value, x, y) => {
            texts.push({
                value: String(value), x: origin ? origin[0] : x, y: origin ? origin[1] : y, rotated: origin !== null,
                size: parseFloat(target.font), align: target.textAlign, baseline: target.textBaseline
            });
        },
        beginPath: () => {
            path = [];
        },
        moveTo: (x, y) => {
            point = [x, y];
        },
        lineTo: (x, y) => {
            path.push({ x0: point[0], y0: point[1], x1: x, y1: y });
            point = [x, y];
        },
        stroke: () => segments.push(...path.map(segment => ({ ...segment, lineWidth: target.lineWidth })))
    };
    return new Proxy(target, {
        get: (object, key) => (key in object ? object[key] : () => {}),
        set: (object, key, value) => {
            object[key] = value;
            return true;
        }
    });
}

// Box of a recorded text: about 0.55 em per character, one em high around the middle of the line.
function textBox(text) {
    const length = 0.55 * text.size * text.value.length;
    const start = text.align === 'center' ? -length / 2 : text.align === 'right' ? -length : 0;
    const middle = text.baseline === 'alphabetic' ? -0.35 * text.size : 0;
    const half = text.size / 2;
    return text.rotated
        ? { value: text.value, left: text.x + middle - half, right: text.x + middle + half, top: text.y - start - length, bottom: text.y - start }
        : { value: text.value, left: text.x + start, right: text.x + start + length, top: text.y + middle - half, bottom: text.y + middle + half };
}

const clearOf = (box, other) => box.right <= other.left || other.right <= box.left || box.bottom <= other.top || other.bottom <= box.top;

function drawOnce(plugin, width, height, context = fakeContext(), showText = true) {
    plugin.drawGroove(context, {
        width, height, palette: { label: '#000', strongGrid: '#111', subtleGrid: '#222' },
        showText, showAxes: true, text: context,
        drawSignal: (target, draw) => draw(target), markerColor: () => '#333'
    });
    return plugin._readoutFrame;
}

test('parseTelemetryFrame accepts the contract layout and rejects malformed frames once', async () => {
    const { plugin, warnings } = await loadPlugin();
    const snapshot = plugin.parseTelemetryFrame(buildFrame({
        frameCount: 10, events: [{ band: 1, x: 3.02, frame: 7.25 }]
    }));
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].position.toFixed(4), '3.0200');
    assert.equal(snapshot.events[0].beatFraction.toFixed(4), '0.0200');
    assert.ok(Math.abs(snapshot.events[0].time - 0.0725) < 1e-9);
    assert.equal(plugin.parseTelemetryFrame(buildFrame({ frameCount: 10, size: 1340 })), null);
    const badBand = buildFrame({ frameCount: 10, events: [{ band: 1, x: 1 }] });
    badBand.payload.setUint8(832 + 28, 3);
    assert.equal(plugin.parseTelemetryFrame(badBand), null);
    assert.equal(plugin.parseTelemetryFrame({ ...badBand, frameType: 26 }), null);
    assert.equal(warnings.length, 1);
});

test('timing is relative to the recent beats and the lens reports offset, swing and jitter', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(16, BACKBEAT));
    assert.ok(Math.abs(plugin.eventDeviation[eventAt(plugin, 1, 61.02)] - 10) < 0.01);
    assert.ok(Math.abs(plugin.eventDeviation[eventAt(plugin, 0, 62)]) < 0.01);
    assert.equal(plugin.eventSlot[eventAt(plugin, 2, 61.5)], 3);
    const lens = plugin.lensSummary();
    const mid = lens.rows.filter(row => row.band === 1);
    assert.equal(mid.length, 1);
    assert.equal(mid[0].slot, 0);
    assert.ok(Math.abs(mid[0].offset - 10) < 0.01);
    for (const row of lens.rows.filter(entry => entry.band !== 1)) assert.ok(Math.abs(row.offset) < 0.01);
    assert.ok(lens.jitter < 0.01, `jitter ${lens.jitter}`);
    assert.ok(Math.abs(lens.swing - 1) < 1e-4);
});

test('a common late offset is treated as latency, not groove', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(8, [[0, 0.04], [2, 0.54]]));
    assert.ok(Math.abs(plugin.eventRawDeviation[eventAt(plugin, 0, 28.04)] - 20) < 0.01);
    assert.ok(Math.abs(plugin.eventDeviation[eventAt(plugin, 0, 28.04)]) < 0.01);
    assert.ok(Math.abs(plugin.eventDeviation[eventAt(plugin, 0, 0.04)] - 20) < 0.01, 'no reference before 4 onsets');
});

test('an epoch whose onsets sit on thirds switches to the triplet grid', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(4, [[2, 0], [2, 1 / 3], [2, 2 / 3], [2, 1], [2, 4 / 3], [2, 5 / 3]]));
    const segment = plugin.segments.get(1);
    assert.ok(segment.triplet > segment.straight);
    assert.equal(plugin.eventSlot[eventAt(plugin, 2, 12 + 2 / 3)], 4);
    assert.ok(Math.abs(plugin.eventDeviation[eventAt(plugin, 2, 12 + 2 / 3)]) < 0.01);
});

test('onsets absent one and two spans earlier are marked new, and the span is re-evaluated', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, [...pattern(8, BACKBEAT), ...pattern(4, [[0, 0], [0, 1.5], [1, 1], [1, 3]], 8)]);
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 4)], 0, 'no ring within one span of the lock');
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 28)], 0);
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 33.5)], 1);
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 37.5)], 1);
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 36)], 0);
    plugin.setParameters({ sp: 4 });
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 33.5)], 1);
    assert.equal(plugin.eventNovel[eventAt(plugin, 0, 37.5)], 0);
});

test('lens marks and spread ease toward updated values between telemetry frames and match the readout', async () => {
    const { plugin, clock } = await loadPlugin();
    let summary = { rows: [{ band: 1, slot: 3, offset: 0, sd: 4, count: 20 }], swing: 1, jitter: 4 };
    plugin.lensSummary = () => summary;
    drawOnce(plugin, 900, 600);
    summary = { rows: [{ band: 1, slot: 3, offset: 20, sd: 10, count: 20 }], swing: 1, jitter: 10 };
    assert.equal(drawOnce(plugin, 900, 600).lensSummary.rows[0].offset, 0, 'a new value does not jump at the same time');
    clock.now += 100;
    const context = fakeContext();
    const frame = drawOnce(plugin, 900, 600, context);
    const row = frame.lensSummary.rows[0];
    const weight = 1 - Math.exp(-0.5);
    assert.ok(Math.abs(row.offset - 20 * weight) < 1e-10);
    assert.ok(Math.abs(row.sd - (4 + 6 * weight)) < 1e-10);
    const { lens } = frame;
    const x = lens.left + 3.5 * lens.width / 6 + row.offset * 0.42 * lens.width / 6 / 30;
    assert.ok(context.segments.some(line => line.lineWidth === 2 && line.x0 === x && line.x1 === x), 'the tick uses the eased offset');
    const readout = plugin._readRhythm(lens.left + 3.5 * lens.width / 6, lens.top + lens.height / 2);
    assert.equal(readout.rows[0].value, `+${row.offset.toFixed(1)} ms ± ${row.sd.toFixed(1)} ms`);
    assert.equal(summary.rows[0].offset, 20, 'drawing leaves the analysis untouched');
    assert.equal(summary.rows[0].sd, 10);
    // A changing target starts from the current display, without restarting from the old target.
    summary = { ...summary, rows: [{ ...summary.rows[0], offset: -10, sd: 2 }] };
    clock.now += 100;
    const next = drawOnce(plugin, 900, 600).lensSummary.rows[0];
    assert.ok(Math.abs(next.offset - (row.offset + weight * (-10 - row.offset))) < 1e-10);
    assert.ok(Math.abs(next.sd - (row.sd + weight * (2 - row.sd))) < 1e-10);
});

test('lens easing has the same settling time at different drawing rates', async () => {
    for (const frames of [12, 36, 86]) {
        const { plugin, clock } = await loadPlugin();
        let offset = -20;
        plugin.lensSummary = () => ({ rows: [{ band: 2, slot: 0, offset, sd: 3, count: 10 }], swing: 1, jitter: 3 });
        drawOnce(plugin, 900, 600);
        offset = 20;
        let previous = -20;
        for (let step = 1; step <= frames; step++) {
            clock.now = 1000 + 600 * step / frames;
            const current = drawOnce(plugin, 900, 600).lensSummary.rows[0].offset;
            assert.ok(current > previous && current < offset, 'the mark approaches without overshooting');
            previous = current;
        }
        assert.ok(Math.abs(previous - (20 - 40 * Math.exp(-3))) < 1e-10);
    }
});

test('lens easing discards old cells after missing data, a new epoch or a reset', async () => {
    const { plugin, clock } = await loadPlugin();
    plugin.handleTelemetry(buildFrame({ frameCount: 10 }));
    let summary = { rows: [{ band: 1, slot: 0, offset: -20, sd: 5, count: 10 }], swing: 1, jitter: 5 };
    plugin.lensSummary = () => summary;
    drawOnce(plugin, 900, 600);
    summary = { rows: [], swing: NaN, jitter: NaN };
    same(drawOnce(plugin, 900, 600).lensSummary.rows, []);
    summary = { rows: [{ band: 1, slot: 0, offset: 20, sd: 2, count: 10 }], swing: 1, jitter: 2 };
    assert.equal(drawOnce(plugin, 900, 600).lensSummary.rows[0].offset, 20);
    summary = null;
    assert.equal(drawOnce(plugin, 900, 600).lensSummary, null);
    summary = { rows: [{ band: 1, slot: 0, offset: -10, sd: 6, count: 10 }], swing: 1, jitter: 6 };
    assert.equal(drawOnce(plugin, 900, 600).lensSummary.rows[0].offset, -10);
    plugin.handleTelemetry(buildFrame({ frameCount: 20, lockEpoch: 2 }));
    summary.rows[0].offset = 15;
    clock.now += 10;
    assert.equal(drawOnce(plugin, 900, 600).lensSummary.rows[0].offset, 15, 'a new lock starts fresh');
    plugin.clearHistory();
    summary.rows[0].offset = -15;
    assert.equal(drawOnce(plugin, 900, 600).lensSummary.rows[0].offset, -15);
});

test('a new lock epoch re-aligns without moving the beat clock back and restarts the lens', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(16, BACKBEAT));
    const before = plugin.beatClock;
    const oldEnd = plugin.segments.get(1).endU;
    // The new epoch counts beats from 100 and is a quarter beat later.
    feed(plugin, pattern(1, [[0, 0.25], [1, 1.25]], 25), { lockEpoch: 2 });
    const segment = plugin.segments.get(2);
    assert.equal(segment.reanchor, true);
    assert.equal(segment.startU, oldEnd);
    assert.ok(plugin.beatClock >= before);
    same(plugin.lensSummary().rows, []);
    assert.equal(drawOnce(plugin, 900, 600).valid, true);
    const clock = plugin.beatClock;
    drawOnce(plugin, 900, 600);
    assert.equal(plugin.beatClock, clock, 'drawing never advances the clock');
});

test('while searching the clock runs at the held period and onsets are placed untimed', async () => {
    const { plugin } = await loadPlugin();
    const palette = { label: '#000' };
    assert.equal(plugin._headerItems(null, palette, () => '#333')[0][1].text, 'searching');
    feed(plugin, pattern(4, BACKBEAT));
    const clock = plugin.beatClock;
    const offset = plugin.segments.get(1).offset;
    feed(plugin, pattern(2, [[0, 0.5], [2, 1.25]], 4).map(event => ({ ...event, unlocked: true })), { locked: false });
    assert.ok(Math.abs(plugin.beatClock - clock - 6) < 1e-9);
    assert.equal(plugin.openSegment, null);
    assert.equal(plugin.lensSummary(), null);
    const index = plugin.eventSerial - 1;
    assert.equal(plugin.eventTimed[index], 0);
    assert.ok(Math.abs(plugin.eventU[index] - (21.25 + offset)) < 1e-4);
    assert.equal(plugin._headerItems(null, palette, () => '#333')[0][1].text, '(120 BPM held)  searching');
    const frame = drawOnce(plugin, 375, 500);
    assert.equal(frame.valid, true);
    assert.ok(frame.lens.top > frame.main.top, 'portrait canvases stack the lens below');
});

test('span snaps to the nearest supported value', async () => {
    const { plugin } = await loadPlugin();
    assert.equal(plugin.sp, 8);
    for (const [input, expected] of [['12', 12], [13, 12], [100, 16], [1, 4], [10, 8], ['x', 8]]) {
        plugin.setParameters({ sp: input });
        assert.equal(plugin.sp, expected, `sp ${input}`);
        plugin.setParameters({ sp: 8 });
    }
    same(Object.keys(plugin.getParameters()), ['type', 'enabled', 'mn', 'mx', 'ck', 'sp', 'vt', 'vm', 've', 'vl']);
});

test('Max BPM stays at least 1.25 x Min BPM and only a changed range restarts the analysis', async () => {
    const { plugin } = await loadPlugin();
    let restarts = 0;
    const begin = plugin.beginTelemetryEpoch;
    plugin.beginTelemetryEpoch = function () {
        restarts++;
        return begin.call(this);
    };
    const range = () => [plugin.mn, plugin.mx];
    plugin.setParameters({ mn: 100, mx: 110 });
    assert.deepEqual(range(), [100, 125]);
    plugin.setParameters({ mn: 160 });
    assert.deepEqual(range(), [160, 200], 'a Min BPM edit raises Max BPM');
    plugin.setParameters({ mx: 150 });
    assert.deepEqual(range(), [120, 150], 'an in-range Max BPM edit lowers Min BPM');
    plugin.setParameters({ mn: 60, mx: 240 });
    restarts = 0;
    // The number box sends every typed prefix of '180'; clamped prefixes raise Max BPM and keep Min BPM.
    assert.deepEqual(['1', '18', '180'].map(value => {
        plugin.setParameters({ mx: value });
        return range();
    }), [[60, 75], [60, 75], [60, 180]]);
    assert.equal(restarts, 2, 'the unchanged pair after "18" does not restart');
    plugin.setParameters({ mn: 60, sp: 4 });
    assert.equal(restarts, 2, 'a span change keeps the analysis');
});

test('a newer generation keeps the history and continues its frames and epochs, and an older one is ignored', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(16, BACKBEAT), { generation: 5 });
    const stored = plugin.eventSerial;
    plugin.handleTelemetry(buildFrame({ generation: 4, frameCount: plugin.testFrame + 10 }));
    assert.equal(plugin.eventSerial, stored);
    const lastFrame = plugin.lastFrameCount;
    const clock = plugin.beatClock;
    // The kernel restarts its frames and lock epochs; epoch 1 of the new generation is a new segment.
    plugin.handleTelemetry(buildFrame({ generation: 6, frameCount: 3, events: [{ band: 0, x: 0.5, frame: 1 }] }));
    assert.equal(plugin.activeGeneration, 6);
    assert.equal(plugin.eventSerial, stored + 1);
    assert.equal(plugin.lastFrameCount, lastFrame + 3);
    assert.ok(plugin.beatClock >= clock);
    assert.equal(plugin.segments.size, 2);
    const index = stored % plugin.eventU.length;
    assert.equal(plugin.eventEpoch[index], 2 ** 32 + 1);
    assert.equal(plugin.eventTimed[index], 1);
});

test('a new telemetry source restarts the generation fence', async () => {
    const { plugin } = await loadPlugin();
    const first = {};
    plugin.handleTelemetry({ ...buildFrame({ generation: 9, frameCount: 5 }), source: first });
    plugin.handleTelemetry({ ...buildFrame({ generation: 9, frameCount: 55, events: [{ band: 0, x: 0 }] }), source: first });
    assert.equal(plugin.eventSerial, 1);
    plugin.handleTelemetry({ ...buildFrame({ generation: 1, frameCount: 3 }), source: {} });
    assert.equal(plugin.activeGeneration, 1);
    assert.equal(plugin.eventSerial, 0);
});

test('the click and the panel toggles default as specified and keep the history', async () => {
    const { plugin } = await loadPlugin();
    same(plugin.getParameters(), {
        type: 'RhythmAnalyzerPlugin', enabled: true, mn: 40, mx: 240, ck: false, sp: 8, vt: false, vm: true, ve: false, vl: true
    });
    const bare = Object.create(Object.getPrototypeOf(plugin));
    bare.initializeDisplayState();
    same({ ck: bare.ck, vt: bare.vt, vm: bare.vm, ve: bare.ve, vl: bare.vl }, { ck: false, vt: false, vm: true, ve: false, vl: true });
    feed(plugin, pattern(8, BACKBEAT));
    const stored = plugin.eventSerial;
    plugin.setParameters({ ck: 1, vt: 0, vm: false, ve: '', vl: false });
    same({ ck: plugin.ck, vt: plugin.vt, vm: plugin.vm, ve: plugin.ve, vl: plugin.vl },
        { ck: true, vt: false, vm: false, ve: false, vl: false });
    assert.equal(plugin.eventSerial, stored);
    assert.ok(plugin.lensSummary());
});

test('only enabled panels are laid out and read out, reflowed below the header', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(8, BACKBEAT));
    const names = [['strip', 'vt'], ['main', 'vm'], ['echo', 've'], ['lens', 'vl']];
    for (const [width, height] of [[900, 600], [375, 700]]) {
        for (let mask = 0; mask < 16; mask++) {
            const label = `${width}x${height} mask ${mask}`;
            const enabled = Object.fromEntries(names.map(([, key], bit) => [key, Boolean(mask & (1 << bit))]));
            plugin.setParameters(enabled);
            const frame = drawOnce(plugin, width, height);
            assert.equal(frame.valid, true, label);
            same(names.map(([name]) => Boolean(frame[name])), names.map(([, key]) => enabled[key]));
            const headerBottom = Math.max(...frame.header.map(rect => rect.top + rect.height));
            frame.panels.forEach((panel, index) => {
                assert.ok(panel.left >= 0 && panel.top >= headerBottom, label);
                assert.ok(panel.left + panel.width <= width && panel.top + panel.height <= height + 1e-6, label);
                for (const other of frame.panels.slice(index + 1)) {
                    assert.ok(panel.left + panel.width <= other.left || other.left + other.width <= panel.left ||
                        panel.top + panel.height <= other.top || other.top + other.height <= panel.top, `${label} overlap`);
                }
            });
            assert.equal(frame.views.length > 0, enabled.vm || enabled.ve, label);
            if (!mask) assert.equal(plugin._readRhythm(width / 2, height - 10), null, 'header only');
        }
    }
    plugin.setParameters({ vt: true, vm: true, ve: true, vl: true });
    assert.equal(drawOnce(plugin, 375, 700).strip.height, 90, 'a narrow canvas keeps the tempogram tall enough for its labels');
    plugin.setParameters({ vt: false, vm: false, ve: false, vl: true });
    assert.ok(drawOnce(plugin, 900, 600).lens.width > 800, 'the lens takes the full width without the lanes');
    plugin.setParameters({ vt: true, vm: true, ve: true, vl: true });
    const full = drawOnce(plugin, 900, 600);
    assert.equal(full.lens.top, full.main.top, 'the landscape lens sits beside the lanes');
    plugin.setParameters({ vt: false, ve: false });
    const aligned = drawOnce(plugin, 900, 600);
    assert.ok(aligned.lens.top === aligned.main.top && aligned.lens.height === aligned.main.height,
        'beside the lanes alone the lens rows line up with the lane rows');
    plugin.setParameters({ vt: true, ve: true });
    // The lanes show the newest window, so the echo rows then start one window back.
    assert.equal(full.views.find(view => view.echo).uRight, plugin.beatClock - plugin.sp);
    plugin.setParameters({ vm: false });
    assert.equal(drawOnce(plugin, 900, 600).views[0].uRight, plugin.beatClock, 'without the lanes the newest window stays');
});

test('on a narrow canvas the lens band labels and offset values stay clear of the marks', async () => {
    const { plugin } = await loadPlugin();
    plugin.setParameters(ALL_PANELS);
    feed(plugin, pattern(8, BACKBEAT));
    plugin.lensSummary = () => ({ rows: LENS_ROWS, swing: 1, jitter: 5 });
    // A 359x479 item on a 359- and a 434-px canvas: at the second scale the lens floor is not an exact float sum.
    for (const [vm, canvasWidth] of [[true, 359], [false, 359], [true, 434]]) {
        plugin.setParameters({ vm });
        const dpr = canvasWidth / 359;
        Object.assign(plugin, { graphCssWidth: 359, graphDpr: dpr });
        const context = fakeContext();
        const { lens } = drawOnce(plugin, canvasWidth, Math.round(479 * dpr), context);
        const inLens = (x, y) => x >= lens.left && x <= lens.left + lens.width && y >= lens.top && y <= lens.top + lens.height;
        const boxes = context.texts.filter(text => inLens(text.x, text.y) && /^(High|Mid|Low|[+−]\d+)$/.test(text.value)).map(textBox);
        const marks = context.segments.filter(segment => segment.lineWidth === 2 * dpr && segment.x0 === segment.x1 && inLens(segment.x0, segment.y0));
        assert.equal(marks.length, LENS_ROWS.length, `vm ${vm} canvas ${canvasWidth}`);
        assert.equal(boxes.filter(box => /^[HML]/.test(box.value)).length, 3, `vm ${vm} canvas ${canvasWidth}`);
        assert.ok(boxes.some(box => /\d/.test(box.value)), `vm ${vm} canvas ${canvasWidth} draws offset values`);
        for (const box of boxes) {
            for (const mark of marks) {
                const clear = box.right <= mark.x0 - mark.lineWidth / 2 || box.left >= mark.x0 + mark.lineWidth / 2 ||
                    box.bottom <= Math.min(mark.y0, mark.y1) || box.top >= Math.max(mark.y0, mark.y1);
                assert.ok(clear, `vm ${vm} canvas ${canvasWidth}: '${box.value}' touches the mark at x ${mark.x0.toFixed(1)}`);
            }
        }
    }
});

test('the timing lanes show their guide values beside the band names in an ordinary item', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(8, BACKBEAT));
    const context = fakeContext();
    const { main } = drawOnce(plugin, 900, 500, context);
    // The band names and guide values drawn over the lanes.
    const boxes = context.texts.filter(text => text.y >= main.top && text.y <= main.top + main.height && /^(High|Mid|Low|[+−]20)$/.test(text.value))
        .map(textBox);
    same(['+20', '−20'].map(value => boxes.filter(box => box.value === value).length), [3, 3]);
    boxes.forEach((box, index) => {
        for (const other of boxes.slice(index + 1)) assert.ok(clearOf(box, other), `'${box.value}' overlaps '${other.value}'`);
    });
});

test('a timing lane shows both its guide values or neither, also in small items', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(8, BACKBEAT));
    for (const [width, height, panels] of [[900, 500, {}], [240, 240, { ve: false }], [160, 600, {}]]) {
        plugin.setParameters({ ve: true, ...panels });
        const context = fakeContext();
        const { main } = drawOnce(plugin, width, height, context);
        const item = `${width}x${height} ${JSON.stringify(panels)}`;
        const guides = context.texts.filter(text => text.y >= main.top && text.y <= main.top + main.height && /^[+−]20$/.test(text.value));
        // The lane a value belongs to: the three lanes share the main panel's height.
        for (let lane = 0; lane < 3; lane++) {
            const inLane = guides.filter(text => Math.floor((text.y - main.top) / (main.height / 3)) === lane).map(text => text.value).sort();
            assert.ok(inLane.length === 0 || (inLane.length === 2 && inLane[0] !== inLane[1]), `${item} lane ${lane}: ${inLane.join(' ')}`);
        }
    }
});

test('in small items every text over the graph is legible and clear of the other texts', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(8, BACKBEAT));
    plugin.lensSummary = () => ({ rows: LENS_ROWS, swing: 1, jitter: 5 });
    for (const [width, height, panels] of [[240, 240, {}], [240, 240, { vt: false, ve: false }], [260, 200, {}], [320, 180, {}], [200, 300, {}]]) {
        plugin.setParameters({ vt: true, ve: true, ...panels });
        const context = fakeContext();
        drawOnce(plugin, width, height, context);
        const item = `${width}x${height} ${JSON.stringify(panels)}`;
        // The header is laid out on its own; every other text is drawn over the graph, at 11 px or more.
        const texts = context.texts.filter(text => text.baseline !== 'top');
        for (const text of texts) assert.ok(text.size >= 0.8 * 11, `${item}: '${text.value}' at ${text.size.toFixed(1)} px`);
        const boxes = texts.map(textBox);
        boxes.forEach((box, index) => {
            for (const other of boxes.slice(index + 1)) assert.ok(clearOf(box, other), `${item}: '${box.value}' overlaps '${other.value}'`);
        });
    }
});

test('a lens too short for its text rows drops them and never draws outside its rect', async () => {
    const { plugin } = await loadPlugin();
    feed(plugin, pattern(8, BACKBEAT));
    plugin.lensSummary = () => ({ rows: LENS_ROWS, swing: 1, jitter: 5 });
    const context = fakeContext();
    const drawLens = plugin._drawLens;
    let drawn;
    plugin._drawLens = (target, rect, ...rest) => {
        const before = { texts: context.texts.length, segments: context.segments.length };
        drawLens.call(plugin, target, rect, ...rest);
        drawn = { rect, texts: context.texts.slice(before.texts), segments: context.segments.slice(before.segments) };
    };
    for (const [width, height, vt] of [[240, 140, true], [160, 240, true], [120, 200, true], [120, 200, false]]) {
        context.texts.length = context.segments.length = 0;
        plugin.setParameters({ vt, vm: true, ve: true, vl: true });
        drawOnce(plugin, width, height, context);
        const { rect, texts, segments } = drawn;
        const item = `${width}x${height} vt ${vt}`;
        assert.ok(segments.length > 0, `${item} still draws the lens`);
        const inside = (x, y) => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
        for (const { x0, y0, x1, y1 } of segments) assert.ok(inside(x0, y0) && inside(x1, y1), `${item}: line outside the lens`);
        for (const text of texts) assert.ok(inside(text.x, text.y), `${item}: '${text.value}' outside the lens`);
    }
});

test('the header layout does not move as its values change width', async () => {
    const { plugin } = await loadPlugin();
    const layout = () => JSON.parse(JSON.stringify(drawOnce(plugin, 900, 600).header));
    const searching = layout();
    feed(plugin, pattern(8, BACKBEAT), { combBestBpm: 69 });
    same(layout(), searching);
    feed(plugin, pattern(1, BACKBEAT, 8), { combBestBpm: 216 });
    same(layout(), searching);
});

test('High is on top in lanes, echo rows, lens and readout', async () => {
    const { plugin } = await loadPlugin();
    plugin.setParameters(ALL_PANELS);
    feed(plugin, pattern(16, BACKBEAT));
    const frame = drawOnce(plugin, 900, 600);
    const main = frame.views.find(view => !view.echo);
    for (const view of [main, frame.views.find(view => view.echo)]) {
        const high = plugin._eventPoint(eventAt(plugin, 2, 62), view).y;
        const mid = plugin._eventPoint(eventAt(plugin, 1, 61.02), view).y;
        const low = plugin._eventPoint(eventAt(plugin, 0, 62), view).y;
        assert.ok(high < mid && mid < low, `${high} ${mid} ${low}`);
    }
    const point = plugin._eventPoint(eventAt(plugin, 2, 62), main);
    assert.equal(plugin._readRhythm(point.x, point.y).rows[0].label, 'High');
    const lens = plugin._readRhythm(frame.lens.left + 1, frame.lens.top + frame.lens.height / 2);
    same(lens.rows.map(row => row.label), ['High', 'Mid', 'Low']);
});

test('the beat LED lights at each predicted beat, fades within 90 ms and is hollow while searching', async () => {
    const { plugin } = await loadPlugin();
    const palette = { label: '#000', strongGrid: '#111' };
    const at = (frameCount, nextBeatFrame, locked = true) =>
        plugin.handleTelemetry(buildFrame({ frameCount, nextBeatFrame, locked,
            nextBeatIndex: Math.round((nextBeatFrame - 60) / 50) }));
    const near = (expected) => assert.ok(Math.abs(plugin.ledLevel - expected) < 1e-4, `${plugin.ledLevel} vs ${expected}`);
    at(10, 60);
    near(0);
    at(60, 110);
    near(1);
    at(65, 110);
    near(1 - 0.05 / 0.09);
    at(70, 110);
    near(0);
    // A beat passed between two frames lights the lamp from its predicted time.
    at(112, 160);
    near(1 - 0.02 / 0.09);
    drawOnce(plugin, 900, 600);
    drawOnce(plugin, 900, 600);
    near(1 - 0.02 / 0.09);
    assert.equal(plugin._headerItems(null, palette, () => '#333')[0][0].lamp, true);
    at(113, 160, false);
    near(0);
    const hollow = plugin._headerItems(null, palette, () => '#333')[0][0];
    same({ level: hollow.level, color: hollow.color }, { level: null, color: '#111' });
});

test('a small backward move of the predicted beat does not relight the LED for the same beat', async () => {
    const { plugin } = await loadPlugin();
    const at = (frameCount, nextBeatFrame, locked = true) =>
        plugin.handleTelemetry(buildFrame({ frameCount, nextBeatFrame, locked,
            nextBeatIndex: Math.round((nextBeatFrame - 60) / 50) }));
    const near = (expected) => assert.ok(Math.abs(plugin.ledLevel - expected) < 1e-4, `${plugin.ledLevel} vs ${expected}`);
    // Prime the lamp: first crossing lights the beat at 0.60 s.
    at(10, 60);
    at(60, 110);
    near(1);
    // A genuine next beat, one full period later, is a real relight.
    at(111, 112);
    near(1 - 0.01 / 0.09);
    // The kernel then re-reports the same beat only 0.02 s later (a phase correction well
    // inside the half-period guard, like the metronome click uses) instead of a real next beat
    // a full period away. The LED must keep fading from the beat it already lit, not relight.
    at(113, 114);
    near(1 - 0.03 / 0.09);
});

test('late beat identities light on arrival without repeating a corrected beat or searching candidates', async () => {
    const { plugin } = await loadPlugin();
    const at = (frameCount, nextBeatFrame, nextBeatFraction, nextBeatIndex, options = {}) =>
        plugin.handleTelemetry(buildFrame({ frameCount, nextBeatFrame, nextBeatFraction, nextBeatIndex, ...options }));
    at(9, 10, 0.2, 0);
    at(11, 60, 0.2, 1);
    at(59, 60, 0.2, 1);
    assert.equal(plugin.ledLevel, 0);
    // The correction moves 0.602 s to 0.598 s and advances the official beat identity.
    at(60, 109, 0.8, 2);
    assert.equal(plugin.ledBeat, 0.6);
    assert.equal(plugin.ledLevel, 1);
    at(61, 109, 0.8, 2);
    assert.ok(Math.abs(plugin.ledLevel - (1 - 0.01 / 0.09)) < 1e-6);
    at(63, 62, 0.2, 1);
    assert.equal(plugin.ledBeat, 0.6, 'the same identity cannot replay after a correction');
    at(70, 120, 0, 3, { locked: false });
    assert.equal(plugin.ledLevel, 0);
    at(110, 160, 0, 1, { lockEpoch: 2 });
    assert.equal(plugin.ledLevel, 1, 'a late first confirmed beat in a new epoch is shown');
    at(111, 161, 0, 1, { lockEpoch: 3 });
    assert.equal(plugin.ledBeat, 1.1, 'the half-period guard also covers epoch changes');
});

test('a beat arriving after its entire LED fade starts a visible pulse on arrival', async () => {
    const { plugin } = await loadPlugin();
    const at = (frameCount, nextBeatFrame, nextBeatFraction, nextBeatIndex) =>
        plugin.handleTelemetry(buildFrame({ frameCount, nextBeatFrame, nextBeatFraction, nextBeatIndex }));
    at(9, 10, 0.2, 0);
    at(11, 60, 0.2, 1);
    at(59, 60, 0.2, 1);
    assert.equal(plugin.ledLevel, 0);
    at(80, 109, 0.8, 2);
    assert.equal(plugin.ledBeat, 0.8);
    assert.equal(plugin.ledLevel, 1);
    at(81, 109, 0.8, 2);
    assert.equal(plugin.ledBeat, 0.8, 'repeated telemetry does not restart the late pulse');
    assert.ok(Math.abs(plugin.ledLevel - (1 - 0.01 / 0.09)) < 1e-6);
});

test('the tempogram scrolls smoothly between frames, stops after two columns and reads out as drawn', async () => {
    // A canvas for the tempogram image, so its draw calls are made.
    const document = {
        createElement: () => ({
            getContext: () => ({ createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {} })
        })
    };
    const { plugin, clock } = await loadPlugin({ document });
    plugin.setParameters(ALL_PANELS);
    // A frame every 30 ms carrying 3 hops (0.24 column), each with its own tempo.
    const send = index => {
        clock.now = 1000 + 30 * index;
        plugin.handleTelemetry(buildFrame({ frameCount: 1 + 3 * index, period: 0.5 + 0.01 * index }));
    };
    for (let index = 0; index < 5; index++) send(index);
    const width = 900;
    const read = frame => {
        const { strip } = frame;
        const x = strip.left + 158.3 / 160 * strip.width;
        const readout = plugin._readRhythm(x, strip.top + strip.height / 2);
        return { adopted: readout.rows[1].value, time: Number(readout.cursor.split(' · ')[1]) };
    };
    // Just before the next frame the newest column has aged 0.96 + 0.24 columns.
    clock.now = 1150;
    const before = drawOnce(plugin, width, 600);
    assert.ok(Math.abs(before.scroll - 1.2) < 1e-4, `scroll ${before.scroll}`);
    const early = read(before);
    // That frame advances the head one column; the same point shows the same column at the same time.
    send(5);
    const context = fakeContext();
    const images = [];
    const rects = [];
    context.drawImage = (...args) => images.push(args);
    context.rect = (...args) => rects.push(args);
    const after = drawOnce(plugin, width, 600, context);
    assert.ok(Math.abs(after.scroll - 0.2) < 1e-4, `scroll ${after.scroll}`);
    const late = read(after);
    assert.equal(late.adopted, early.adopted);
    assert.ok(Math.abs(late.time - early.time) < 1e-3 && Math.abs(early.time + 150) < 1e-3, `${early.time} -> ${late.time}`);
    const xOf = step => after.strip.left + (step + 0.5 - after.scroll) / 160 * after.strip.width;
    assert.ok(context.segments.some(({ x0, x1 }) => Math.abs(x0 - xOf(158)) < 1e-6 && Math.abs(x1 - xOf(159)) < 1e-6),
        'the adopted line is drawn with the same scroll');
    // Right of the newest column, the image holds that column and the lines hold its value up to the strip's edge.
    const right = after.strip.left + after.strip.width;
    const hold = images.find(args => args.length === 9);
    assert.ok(hold && hold[1] === 159 && hold[3] === 1, 'the newest image column is stretched');
    // The hold starts where the history is clipped, at the whole pixel under the newest column's right edge, so the
    // newest column is never drawn twice.
    const holdLeft = Math.floor(xOf(159) + after.strip.width / 320);
    assert.ok(hold[5] === holdLeft && Math.abs(hold[5] + hold[7] - right) < 1e-6, `held image ${hold[5]} + ${hold[7]}`);
    assert.ok(rects.some(([x, , w]) => x === after.strip.left && x + w === holdLeft), 'the history is clipped at the hold');
    assert.ok(context.segments.some(({ x0, y0, x1, y1, lineWidth }) =>
        lineWidth === 2 && Math.abs(x0 - xOf(159)) < 1e-6 && x1 === right && y0 === y1), 'the adopted line reaches the right edge');
    // Without telemetry the scroll stops two columns (0.25 s) after the last frame.
    clock.now = 5000;
    const stalled = drawOnce(plugin, width, 600);
    assert.ok(Math.abs(stalled.scroll - 2.2) < 1e-4, `scroll ${stalled.scroll}`);
    // The held area right of the newest column reads as that column.
    const { strip } = stalled;
    const edge = plugin._readRhythm(strip.left + strip.width, strip.top + strip.height / 2);
    assert.ok(Math.abs(Number(edge.cursor.split(' · ')[1]) + stalled.scroll * 125) < 1e-3, edge.cursor);
});

test('in a small portrait item the narrow panel minimums leave the timing lanes and echo rows a real share', async () => {
    const { plugin } = await loadPlugin();
    plugin.setParameters(ALL_PANELS);
    feed(plugin, pattern(8, BACKBEAT));
    const { main, echo, views } = drawOnce(plugin, 240, 320);
    const echoRows = views.filter(view => view.echo);
    assert.ok(main.height >= 20, `timing lanes ${main.height.toFixed(1)} px`);
    assert.ok(echoRows.length >= 4 && echo.height / echoRows.length >= 6, `echo rows ${(echo.height / echoRows.length).toFixed(1)} px`);
    // The tempogram's minimum is only for its labels, so without them it keeps just its share.
    const { strip } = drawOnce(plugin, 240, 320, fakeContext(), false);
    assert.ok(strip.height < 60, `unlabelled tempogram ${strip.height.toFixed(1)} px`);
});
