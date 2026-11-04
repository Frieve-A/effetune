import test from 'node:test';
import assert from 'node:assert/strict';
import { createItem, createDefaultLayout, normalizeLayout, validateLayout,
    encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { MidiMixerDisplay } from '../../js/visualizer/visualizer-midi-mixer.js';
import { midiChannelColor, midiChannelRgb } from '../../js/visualizer/visualizer-midi.js';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const event = (seconds, status, data1, data2, order) => ({ seconds, status, data1, data2, track: 0, order });
const timeline = { duration: 4, division: 480, secondsPerTick: null,
    events: [event(0, 0xc0, 4, 0, 0), event(0, 0xb0, 7, 92, 1), event(.1, 0x90, 60, 100, 2)],
    tempoMap: [{ tick: 0, seconds: 0, quarter: 0, microsecondsPerQuarter: 500000 }],
    timeSignatures: [{ tick: 0, seconds: 0, quarter: 0, numerator: 4, denominator: 4 }] };
const presentation = { hasMidi: true, timeline, position: .5, generation: 1, sourceGeneration: 1,
    presentationEpoch: 1, playing: true, paused: false, speed: 1 };

test('MIDI channel colors separate neighboring channels and wrap hue across all 16 channels', () => {
    const hues = [0, 112.5, 225, 337.5, 90, 202.5, 315, 67.5,
        180, 292.5, 45, 157.5, 270, 22.5, 135, 247.5];
    assert.deepEqual(hues.map((_, channel) => midiChannelColor(channel)),
        hues.map(hue => `hsl(${hue}, 60%, 55%)`));
    assert.equal(new Set(hues).size, 16);
    assert.deepEqual([0, 1, 15].map(midiChannelRgb), [[209, 71, 71], [89, 209, 71], [89, 71, 209]]);
    for (let channel = 1; channel < 16; channel++) {
        assert.equal((hues[channel] - hues[channel - 1] + 360) % 360, 112.5);
    }
});

test('MIDI keyboard uses the same channel color for projected and native sounding keys', () => {
    const display = new MidiMixerDisplay(null, null);
    const colors = [];
    const ctx = { fillRect() { colors.push(this.fillStyle); }, strokeRect() {} };
    const sounding = new Uint8Array(16);
    sounding[60 >> 3] |= 1 << (60 & 7);
    for (const channel of [0, 1, 15]) for (const native of [false, true]) {
        colors.length = 0;
        display.drawKeyboard(ctx, 0, 0, 750, 40, native ? sounding : null,
            [{ pitch: 60 }], 'channel', channel, '#ffffff');
        assert.deepEqual(colors.filter(color => color.startsWith('hsl(')), [midiChannelColor(channel)]);
    }
});

test('MIDI mixer item normalizes settings and round-trips its display choices', () => {
    const item = createItem('midi', 'midi');
    assert.equal(item.params.showState, false);
    assert.equal(Object.hasOwn(item.params, 'showKnobValues'), false);
    assert.equal(item.palette.color, '#ffffff');
    assert.deepEqual([item.params.knobValuePosition, item.params.knobSize,
        item.params.knobStyle, item.params.flashChanges], ['right', 100, 'filled', true]);
    assert.equal(item.params.levelMeter.dr, -48);
    item.params.channelStart = 5;
    item.params.channelEnd = 8;
    item.params.showControllers = false;
    item.params.keyboardColor = 'rainbow';
    item.params.knobValuePosition = 'right';
    item.params.knobSize = 150;
    item.params.knobStyle = 'outline';
    item.params.flashChanges = false;
    const layout = { ...createDefaultLayout(), items: [item] };
    assert.equal(validateLayout(layout), true);
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params, item.params);
    item.params.showState = true;
    assert.equal(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params.showState, true);
    item.params.channelEnd = 3;
    assert.equal(normalizeLayout(layout).items[0].params.channelEnd, 5);
    const oldLayout = normalizeLayout(layout);
    for (const key of ['knobValuePosition', 'knobSize', 'knobStyle', 'flashChanges', 'knobFillColor',
        'knobOutlineColor', 'knobIndicatorColor', 'keyboardActiveColor', 'flashColor', 'levelMeter', 'levelPalette']) {
        delete oldLayout.items[0].params[key];
    }
    assert.equal(validateLayout(oldLayout), true);
    assert.equal(normalizeLayout(oldLayout).items[0].params.knobValuePosition, 'right');
    const legacy = oldLayout.items[0].params;
    legacy.showKnobValues = false;
    legacy.knobValuePosition = 'below';
    assert.equal(validateLayout(oldLayout), true);
    assert.equal(normalizeLayout(oldLayout).items[0].params.knobValuePosition, 'none');
    legacy.showKnobValues = true;
    assert.equal(validateLayout(oldLayout), true);
    assert.equal(normalizeLayout(oldLayout).items[0].params.knobValuePosition, 'below');
    legacy.showKnobValues = 'false';
    assert.equal(validateLayout(oldLayout), false);
    for (const position of ['right', 'below', 'none']) {
        const current = createItem('midi', 'current');
        current.params.knobValuePosition = position;
        current.params.levelMeter = { ...current.params.levelMeter, dr: -120, ds: 3, orientation: 'vertical',
            cf: .5, ph: 2, pf: 3, showAxes: true, showAxisNumbers: true, showLevelValues: true };
        current.params.levelPalette.mode = 'heatmap';
        const saved = { ...createDefaultLayout(), items: [current] };
        assert.equal(validateLayout(saved), true);
        assert.deepEqual(decodeLayoutShare(encodeLayoutShare(saved)).items[0], current);
    }
});

test('MIDI mixer inspector exposes channel, column, keyboard color, and text controls', () => {
    const fields = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        t: (_key, fallback) => fallback,
        field(_parent, label, type, value, change, options) {
            const field = { label, type, value, change, options };
            fields.push(field);
            return field;
        },
        syncRangeField(field, value) { field.value = value; },
        group() { return {}; },
        palette(_parent, _palette, type) { assert.equal(type, 'level-meter'); },
        changed() {}
    });
    const item = createItem('midi', 'midi');
    item.params.channelEnd = 5;
    editor.parameters({}, item);
    for (const label of ['First channel', 'Last channel', 'Patch', 'Sounding notes', 'Level', 'Controllers',
        'Mute and Solo', 'Voices', 'Values', 'Knob size', 'Knob style', 'Knob fill', 'Knob outline',
        'Knob indicator', 'Flash on MIDI changes', 'Flash color', 'Keyboard color', 'Sounding key color',
        'Font', 'Text size', 'DB Range', 'Orientation', 'dB per Segment', 'Level values', 'Fall Time',
        'Peak', 'Peak Hold', 'Peak Fall Time', 'Axes and grid', 'Axis labels and numbers']) {
        assert.ok(fields.some(field => field.label === label), label);
    }
    const field = label => fields.find(field => field.label === label);
    assert.equal(fields.some(field => field.label === 'Knob values'), false);
    assert.deepEqual(field('Values').options.values.map(([value]) => value), ['right', 'below', 'none']);
    assert.equal(field('Keyboard color').options.values.at(-1)[1], 'Note Colors');
    fields[0].change(12);
    assert.equal(item.params.channelEnd, 12);
    field('Controllers').change(false);
    field('Values').change('none');
    field('Knob size').change(125);
    field('Knob style').change('outline');
    field('Flash on MIDI changes').change(false);
    field('Keyboard color').change('rainbow');
    field('Text size').change(18);
    field('DB Range').change(-96);
    field('Knob fill').change('#123456');
    assert.deepEqual([item.params.showControllers, item.params.knobValuePosition, item.params.knobSize,
        item.params.knobStyle, item.params.flashChanges, item.params.keyboardColor, item.params.fontSize],
    [false, 'none', 125, 'outline', false, 'rainbow', 18]);
    assert.equal(item.params.levelMeter.dr, -96);
    assert.equal(item.params.knobFillColor, '#123456');
});

test('MIDI mixer requests measured levels only while visible and releases its lease', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    globalThis.window = {};
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    let acquired = 0, released = 0;
    class SoundFontPlayerPlugin {
        constructor() { this.enabled = true; this.sf = 'font'; }
        acquireVisualizerMidiMetering() { acquired++; return () => { released++; }; }
        getVisualizerMidiMixerSnapshot() { return { state: { voices: 0, limit: 64, channels: [] }, presets: [], channelFilter: 0 }; }
    }
    const plugin = new SoundFontPlayerPlugin();
    const manager = { getCurrentPipeline: () => [plugin], setVisualizerSources() {} };
    const sources = new VisualizerSources(manager, () => presentation);
    try {
        const item = createItem('midi', 'midi');
        sources.setLayout({ items: [item] });
        assert.equal(acquired, 0);
        sources.setVisible(true);
        assert.equal(acquired, 1);
        assert.equal(sources.getFrame(item.id).channels[0].cc[7], 92);
        assert.ok(sources.getSoundFontMixer()?.state);
        assert.equal(acquired, 1);
        sources.setVisible(false);
        assert.equal(released, 1);
        sources.setVisible(true);
        assert.equal(acquired, 2);
        sources.setLayout({ items: [] });
        assert.equal(released, 2);
    } finally {
        sources.dispose();
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('MIDI mixer follows the first enabled SoundFont Player through pipeline changes', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    globalThis.window = {};
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const leases = [];
    class SoundFontPlayerPlugin {
        constructor(name, peak) {
            this.name = name; this.sf = name; this.enabled = true; this.leases = 0;
            this.snapshotAvailable = true; this.snapshotCalls = 0;
            this.snapshot = { state: { voices: 1, limit: 64, channels: [{ bank: 0, program: 0,
                presetIndex: 0, volume: 100, pan: 64, expression: 127, reverb: 40, chorus: 0,
                notes: new Uint8Array(16), voices: 1, levelPeak: peak }] },
            presets: [{ bank: 0, program: 0, name }], channelFilter: 0 };
        }
        acquireVisualizerMidiMetering() {
            this.leases++; leases.push(`acquire ${this.name}`);
            return () => { this.leases--; leases.push(`release ${this.name}`); };
        }
        getVisualizerMidiMixerSnapshot() { this.snapshotCalls++; return this.snapshotAvailable ? this.snapshot : null; }
    }
    class SectionPlugin { constructor(enabled) { this.enabled = enabled; } }
    const first = new SoundFontPlayerPlugin('first', .5);
    const second = new SoundFontPlayerPlugin('second', .01);
    const third = new SoundFontPlayerPlugin('third', .1);
    let pipeline = [first, second, third];
    const sources = new VisualizerSources({ getCurrentPipeline: () => pipeline,
        setVisualizerSources() {} }, () => presentation);
    const text = [], ctx = { clearRect() {}, fillRect() {}, strokeRect() {}, fillText(value) { text.push(String(value)); },
        beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
        save() {}, restore() {}, translate() {}, scale() {} };
    const item = createItem('midi', 'midi');
    item.params.channelEnd = 1;
    const display = new MidiMixerDisplay({ width: 960, height: 360, getContext: () => ctx }, sources);
    const draw = expected => {
        text.length = 0;
        display.draw(item, 0, 960, {});
        assert.equal(sources.midiMixerTarget?.name ?? null, expected);
        for (const plugin of [first, second, third]) {
            assert.equal(plugin.leases, plugin.name === expected ? 1 : 0);
            assert.equal(text.includes(plugin.name), plugin.name === expected);
        }
    };
    try {
        sources.setLayout({ items: [item] });
        sources.setVisible(true);
        draw('first');
        assert.ok(text.includes('Notes'));
        assert.equal(text.includes('Sounding notes'), false);
        assert.ok(display.meterRows[0].ballistics.cur[0] > -7);
        first.snapshotAvailable = false;
        assert.equal(sources.getSoundFontMixer(), null);
        assert.equal(second.snapshotCalls, 0, 'no fallback when the selected player has no fresh data');
        first.snapshotAvailable = true;
        first.sf = null;
        draw(null);
        assert.equal(display.meterRows[0], null);
        assert.ok(text.includes('Program 5'), 'unloaded first enabled player uses raw MIDI patch');
        assert.equal(second.snapshotCalls, 0, 'an unloaded enabled player still owns the selection');
        first.sf = 'first';
        draw('first');
        first.enabled = false;
        draw('second');
        assert.ok(Math.abs(display.meterRows[0].ballistics.cur[0] + 40) < .001,
            'the previous player level and held peak must not carry into the new player');
        assert.ok(Math.abs(display.meterRows[0].ballistics.peak[0] + 40) < .001);
        assert.deepEqual(leases.slice(-2), ['release first', 'acquire second']);
        first.enabled = true;
        draw('first');
        pipeline = [third, second, first];
        draw('third');
        pipeline.shift();
        draw('second');
        pipeline = [new SectionPlugin(false), first, new SectionPlugin(true), third, second];
        draw('third');
        third.enabled = false;
        draw('second');
        second.enabled = false;
        draw(null);
        assert.ok(text.includes('Program 5') && text.includes('92') && text.includes('—'));
        assert.equal(display.meterRows[0], null, 'all disabled clears measured levels');
        assert.ok(sources.getFrame(item.id).channels[0].notes.some(note => note.pitch === 60),
            'raw MIDI held notes survive loss of the instrument source');
        pipeline = [];
        draw(null);
        pipeline = [first];
        draw('first');
        pipeline = [second];
        second.enabled = true;
        draw('second');
        assert.deepEqual(leases.slice(-2), ['release first', 'acquire second'],
            'changing the current pipeline releases the previous pipeline before acquiring the new one');
    } finally {
        sources.dispose();
        assert.equal(second.leases, 0);
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('MIDI mixer paints projected controls without inventing channel audio levels', () => {
    const text = [], transforms = [];
    const ctx = { clearRect() {}, fillRect() {}, strokeRect() {}, fillText(value) { text.push(String(value)); },
        beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
        save() {}, restore() {}, translate(...args) { transforms.push(['translate', ...args]); },
        scale(...args) { transforms.push(['scale', ...args]); } };
    const canvas = { width: 960, height: 360, getContext: () => ctx };
    const item = createItem('midi', 'midi');
    item.params.channelEnd = 1;
    const source = {};
    const snapshot = { sourceKind: 'midi', source, playing: true,
        channels: [{ program: 4, cc: Object.assign(new Uint8Array(128), { 7: 92, 10: 64, 11: 127 }),
            notes: [{ pitch: 60 }] }] };
    const sources = { getFrame: () => snapshot, getSoundFontMixer: () => null };
    const display = new MidiMixerDisplay(canvas, sources);
    assert.equal(display.draw(item, 0, 960, {}), true);
    assert.ok(text.includes('Program 5'));
    assert.ok(text.includes('92'));
    assert.ok(text.includes('—'));
    item.flipX = true;
    item.flipY = true;
    display.draw(item, 0, 960, {});
    assert.deepEqual(transforms.slice(-2), [['translate', 960, 360], ['scale', -1, -1]]);
});

test('MIDI mixer names the effective SoundFont preset when a requested bank is missing', () => {
    const display = new MidiMixerDisplay(null, null);
    const resolved = { bank: 0, program: 0, presetIndex: 3,
        sourceBankMsb: 12, sourceBankLsb: 0, sourceProgram: 6 };
    assert.equal(display.patchName(resolved, null, [{ bank: 0, program: 0, name: 'Fallback Piano' }]),
        'Fallback Piano');
    assert.equal(display.patchName(resolved, null, []), 'Program 1');
    assert.equal(display.patchName({ ...resolved, presetIndex: 0xffff }, null, []),
        'Bank 12:0 · Program 7');
});

test('instant-fall MIDI meters retain a measurement between animation frames and follow the next sample', () => {
    const ctx = { fillRect() {}, fillText() {} };
    const display = new MidiMixerDisplay(null, null);
    const item = createItem('midi', 'midi');
    const params = { ...item.params.levelMeter, cf: 0, pk: false };
    const frame = {};
    const draw = (peak, currentFrame) => display.drawLevel(ctx, 0, 0, 100, 10, peak, currentFrame, 0,
        params, item.params.levelPalette, 0, 1, '#ffffff', {});
    draw(.5, frame);
    const first = display.meterRows[0].ballistics.cur[0];
    draw(.5, frame);
    draw(.5, frame);
    assert.equal(display.meterRows[0].ballistics.cur[0], first,
        '120 Hz animation does not clear a 60 Hz measurement on intervening frames');
    draw(.25, {});
    assert.ok(display.meterRows[0].ballistics.cur[0] < first);
    draw(0, {});
    assert.equal(display.meterRows[0].ballistics.cur[0], -144);
    draw(undefined, null);
    assert.equal(display.meterRows[0], null, 'source loss clears the measured meter');
});

test('MIDI level values and peaks stop at -144 dB through silence and recover on new sound', async () => {
    let now = 0;
    await withGlobals({ performance: { now: () => now } }, () => {
        for (const pk of [false, true]) {
            const text = [], ctx = { fillRect() {}, fillText(value) { text.push(value); } };
            const display = new MidiMixerDisplay(null, null);
            const item = createItem('midi', 'midi');
            const params = { ...item.params.levelMeter, dr: -48, cf: 1, ph: .5, pf: 1, pk, showLevelValues: true };
            const draw = samplePeak => {
                display.drawLevel(ctx, 0, 0, 100, 10, samplePeak, {}, 0,
                    params, item.params.levelPalette, 0, 1, '#ffffff', {});
                return text.at(-1);
            };
            assert.equal(draw(0), '-144.0 dB', 'zero amplitude (-Infinity dB) starts at the numeric floor');
            assert.equal(draw(.5), '-6.0 dB');
            now += 1000;
            draw(0);
            assert.ok(display.meterRows[0].ballistics.cur[0] > -144, 'configured fall continues above the floor');
            now += 20000;
            assert.equal(draw(0), '-144.0 dB');
            now += 20000;
            assert.equal(draw(1e-10), '-144.0 dB', 'finite levels below the floor also stop at -144');
            const meter = display.meterRows[0];
            assert.equal(meter.raw[0], -144);
            assert.equal(meter.ballistics.cur[0], -144, 'internal current remains bounded during long silence');
            if (pk) assert.equal(meter.ballistics.peak[0], -144, 'peak decay also stops at the current floor');
            assert.equal(draw(.25), '-12.0 dB', 'a new sound attacks immediately after long silence');
        }
    });
});

test('a new MIDI score waits for a fresh SoundFont mixer frame', () => {
    const text = [], ctx = { clearRect() {}, fillRect() {}, strokeRect() {}, fillText(value) { text.push(String(value)); },
        beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
        save() {}, restore() {}, translate() {}, scale() {} };
    const canvas = { width: 960, height: 360, getContext: () => ctx };
    const item = createItem('midi', 'midi');
    item.params.channelEnd = 1;
    const snapshot = { sourceKind: 'midi', source: {}, playing: true, channels: [] };
    const oldState = { voices: 5, limit: 64, channels: [{ sourceProgram: 2, sourceBankMsb: 0,
        sourceBankLsb: 0, presetIndex: 0xffff, volume: 100, pan: 64, expression: 127,
        reverb: 40, chorus: 0, mute: false, solo: false, voices: 5, notes: new Uint8Array(16), levelPeak: .4 }] };
    let mixerState = oldState;
    const sources = { getFrame: () => snapshot,
        getSoundFontMixer: () => ({ state: mixerState, presets: [], channelFilter: 0 }) };
    const display = new MidiMixerDisplay(canvas, sources);
    display.draw(item, 0, 960, {});
    assert.ok(text.includes('Voices 5/64'));
    snapshot.source = {};
    text.length = 0;
    display.draw(item, 0, 960, {});
    assert.equal(text.includes('Voices 5/64'), false);
    mixerState = { ...oldState, voices: 0 };
    text.length = 0;
    display.draw(item, 0, 960, {});
    assert.ok(text.includes('Voices 0/64'));
});

test('MIDI change flash follows channel values without flashing initial, disabled, or replacement state', () => {
    const strokes = [];
    const ctx = { clearRect() {}, fillRect() {}, strokeRect(...args) { strokes.push({ args, alpha: this.globalAlpha }); },
        fillText() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
        save() {}, restore() {}, translate() {}, scale() {}, globalAlpha: 1 };
    const canvas = { width: 960, height: 240, getContext: () => ctx };
    const item = createItem('midi', 'midi');
    Object.assign(item.params, { channelEnd: 1, showKeyboard: false, showLevel: false, showVoices: false });
    const snapshot = { sourceKind: 'midi', source: {}, playing: true, channels: [] };
    const channel = { bank: 0, program: 0, presetIndex: 0, volume: 100, pan: 64,
        expression: 127, reverb: 40, chorus: 0 };
    let presets = [], state = { voices: 0, limit: 64, channels: [channel] };
    const sources = { getFrame: () => snapshot,
        getSoundFontMixer: () => ({ state, presets, channelFilter: 0 }) };
    const display = new MidiMixerDisplay(canvas, sources);
    display.draw(item, 1, 960, {});
    assert.equal(strokes.length, 0, 'first frame establishes a baseline');
    state = { ...state, channels: [{ ...channel, program: 1, volume: 110 }] };
    display.draw(item, 1.1, 960, {});
    assert.equal(strokes.length, 1, 'only the changed patch draws a rectangular flash');
    assert.equal(display.flashRows[0].times[1], 1.1, 'changed volume knob flashes');
    assert.equal(display.flashRows[0].times[2], -Infinity, 'unchanged pan knob stays quiet');
    strokes.length = 0;
    display.draw(item, 1.8, 960, {});
    assert.equal(strokes.length, 0, 'flash decays within 650 ms');
    item.params.flashChanges = false;
    state = { ...state, channels: [{ ...channel, volume: 90 }] };
    display.draw(item, 2, 960, {});
    assert.equal(strokes.length, 0, 'flash can be disabled');
    item.params.flashChanges = true;
    display.draw(item, 2.1, 960, {});
    assert.equal(strokes.length, 0, 'enabling flash does not replay an old change');
    presets = [];
    state = { ...state, channels: [{ ...channel, volume: 120 }] };
    display.draw(item, 2.2, 960, {});
    assert.equal(strokes.length, 0, 'a replacement SoundFont establishes a new baseline');
    snapshot.source = {};
    state = { ...state, channels: [{ ...channel, program: 8 }] };
    display.draw(item, 2.3, 960, {});
    assert.equal(strokes.length, 0, 'a replacement score establishes a new baseline');
    const projected = { program: 4, cc: new Uint8Array(128) };
    projected.cc[7] = 100;
    snapshot.channels = [projected];
    state = null;
    display.draw(item, 2.4, 960, {});
    assert.equal(strokes.length, 0, 'switching to MIDI-only state establishes a baseline');
    projected.program = 5;
    projected.cc[7] = 110;
    display.draw(item, 2.5, 960, {});
    assert.equal(strokes.length, 1, 'MIDI-only program changes flash Patch');
    assert.equal(display.flashRows[0].times[1], 2.5, 'MIDI-only CC changes flash the matching knob');
});
