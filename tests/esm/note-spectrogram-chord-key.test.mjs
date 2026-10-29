import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { parseTelemetryPacket } from '../../js/audio/telemetry-hub.js';

const source = fs.readFileSync(new URL('../../plugins/analyzer/note_spectrogram.js', import.meta.url), 'utf8');
const readoutSource = fs.readFileSync(new URL('../../plugins/graph-readout.js', import.meta.url), 'utf8');
const width = 1024;
function plugin() {
  class PluginBase {
    constructor() { this.enabled = true; this._sectionEnabled = true; }
    registerProcessor() {}
    updateParameters() {}
    parseFiniteNumber(value, minimum, maximum, fallback) {
      return Number.isFinite(Number(value)) ? Math.max(minimum, Math.min(maximum, Number(value))) : fallback;
    }
  }
  const window = {};
  vm.runInNewContext(readoutSource, { window });
  installThemePaletteStub(window);
  vm.runInNewContext(source, { PluginBase, window, performance: { now: () => 0 } });
  const instance = new window.NoteSpectrogramPlugin();
  instance.setParameters({ ck: true });
  return instance;
}
function pitch(frameIndex, { generation = 1, hopSeconds = .02 } = {}) {
  const payload = new DataView(new ArrayBuffer(9192));
  payload.setFloat32(0, 48000, true);
  payload.setFloat32(4, 1 + frameIndex * hopSeconds, true);
  payload.setUint16(8, 440, true);
  payload.setUint16(10, 21, true);
  payload.setFloat32(12, hopSeconds, true);
  payload.setUint32(16, frameIndex, true);
  payload.setUint32(20, 5, true);
  payload.setUint32(24, generation, true);
  return { frameType: 24, formatVersion: 6, payload };
}
function chord(frameIndex, { generation = 1, immediate = [0, 0, 0], confirmed = [9, 1, 9], local = 21, overall = 0, confirmedProbability = 1 } = {}) {
  const payload = new DataView(new ArrayBuffer(32));
  payload.setFloat32(0, 48000, true);
  payload.setFloat32(4, 1 + frameIndex * .02, true);
  payload.setFloat32(8, .02, true);
  payload.setUint32(12, generation, true);
  payload.setUint32(16, frameIndex, true);
  [...immediate, ...confirmed, local, overall].forEach((value, index) => payload.setUint8(20 + index, value));
  payload.setFloat32(28, confirmedProbability, true);
  return { frameType: 32, formatVersion: 1, payload };
}
function drawContext() {
  const texts = [], outlines = [], events = [], bars = [], rotations = [];
  const saved = [];
  return { texts, outlines, events, bars, rotations, globalAlpha: 1, tx: 0, ty: 0,
    save() {
      saved.push(Object.fromEntries(['globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'tx', 'ty']
        .map(key => [key, this[key]])));
    },
    restore() { Object.assign(this, saved.pop()); },
    beginPath() {}, rect() {}, clip() {},
    translate(x, y) { this.tx += x; this.ty += y; },
    rotate(angle) { rotations.push(angle); },
    strokeText(value, x, y, maxWidth) {
      events.push(['stroke', value]);
      outlines.push({ value, x: this.tx + x, y: this.ty + y, maxWidth,
        alpha: this.globalAlpha, color: this.strokeStyle, width: this.lineWidth, join: this.lineJoin });
    },
    fillText(value, x, y, maxWidth) {
      events.push(['fill', value]);
      texts.push({ value, x: this.tx + x, y: this.ty + y, maxWidth,
        alpha: this.globalAlpha, color: this.fillStyle, font: this.font, metrics: this.measureText(value) });
    },
    fillRect(x, y, w, h) { bars.push({ x, y, w, h, alpha: this.globalAlpha, color: this.fillStyle }); },
    measureText(value) {
      const size = Number(this.font.match(/(\d+)px/)[1]);
      const width = value.length * size * .6;
      return { width, actualBoundingBoxLeft: this.textAlign === 'right' ? width : 0,
        actualBoundingBoxRight: this.textAlign === 'right' ? 0 : width,
        actualBoundingBoxAscent: size * .5, actualBoundingBoxDescent: size * .25 };
    }
  };
}

test('chord telemetry parses model probability and rejects malformed or obsolete payloads', () => {
  const p = plugin();
  const unavailable = p.parseChordKeyTelemetryFrame(chord(11, { local: 255, overall: 255 }));
  assert.equal(unavailable.localKey, null);
  assert.equal(unavailable.overallKey, null);
  p.handleTelemetry(pitch(0));
  p.handleChordKeyTelemetry(chord(11, { local: 255, overall: 255 }));
  assert.equal(p.confirmedChords[0], 'Am', 'unavailable keys preserve the confirmed chord');
  assert.equal(p.localKey, null);
  assert.equal(p.overallKey, null);
  assert.equal(p.parseChordKeyTelemetryFrame(chord(12, { local: 25 })), null);
  for (const probability of [0, .5, 1]) {
    assert.equal(p.parseChordKeyTelemetryFrame(chord(1, { confirmedProbability: probability })).confirmedProbability, probability);
  }
  for (const probability of [NaN, Infinity, -.1, 1.1]) {
    assert.equal(p.parseChordKeyTelemetryFrame(chord(1, { confirmedProbability: probability })), null);
  }
  const obsolete = chord(1);
  obsolete.payload = new DataView(obsolete.payload.buffer, 0, 28);
  assert.equal(p.parseChordKeyTelemetryFrame(obsolete), null);
});

test('chord telemetry formats all qualities, inversions and key labels', () => {
  const p = plugin();
  p.handleTelemetry(pitch(0));
  const suffixes = ['', 'm', 'dim', 'aug', 'maj7', 'm7', '7', 'dim7', 'm7b5', 'sus2', 'sus4'];
  for (let quality = 0; quality < suffixes.length; quality++) {
    p.columnFrames[0] = quality;
    p.handleChordKeyTelemetry(chord(quality + 11, { confirmed: [1, quality, 5] }));
    assert.equal(p.confirmedChords[0], `C#${suffixes[quality]}/F`);
  }
  p.canvas = { width: 300, height: 200 };
  const context = drawContext();
  p._drawKeys(context, 300, 200);
  assert.deepEqual(context.texts.map(text => text.value), ['Key: A minor']);
  p.handleChordKeyTelemetry(chord(30, { local: 24, overall: 255 }));
  context.texts.length = 0;
  p._drawKeys(context, 300, 200);
  assert.deepEqual(context.texts, []);
  assert.equal(p._layoutKey(context, 300, 200), null);
});

test('supported delayed chords update every retained column and the hover readout', () => {
  const p = plugin();
  for (let frame = 0; frame <= 14; frame++) {
    p.handleTelemetry(pitch(frame));
    p.handleChordKeyTelemetry(chord(frame));
  }
  const columns = [...p.columnFrames].flatMap((frame, column) => frame === 2 ? [column] : []);
  assert.ok(columns.length > 1);
  for (const column of columns) {
    assert.equal(p.confirmedChords[column], 'Am');
  }
  assert.ok(!p.frameRecords.some(record => record.frameIndex === 2), 'confirmed result outlives the pitch revision window');
  const column = columns[0];
  p._readoutFrame = { valid: true, horizontal: false, canvasWidth: width, rollWidth: width,
    rowHeight: 10, columnWidth: 1, scrollPhase: 0, phaseOffset: 0, split: 0, palette: { trace: [0, 255, 0] } };
  const readout = () => p._readNote(column + .5, 5).rows.find(row => row.label === 'Chord')?.value;
  assert.equal(readout(), 'Am');
  p.confirmedChords[column] = '';
  assert.equal(readout(), 'No chord');
  p.confirmedChords[column] = null;
  assert.equal(readout(), undefined, 'Unknown chords do not fall back to provisional names');
});

test('Note Spectrogram preserves continuous confirmed names at low and fluctuating model probability', () => {
  for (const fluctuating of [false, true]) {
    const p = plugin();
    p.handleTelemetry(pitch(0));
    p.columnFrames.fill(0xffffffff);
    // A stable two-second decoded chord must not become separate 20 ms fragments.
    for (let index = 0; index < 100; index++) {
      p.columnFrames.fill(index, Math.round(index * width / 100), Math.round((index + 1) * width / 100));
      p.handleChordKeyTelemetry(chord(index + 11, {
        immediate: [7, 6, 7], confirmed: [0, 0, 0],
        confirmedProbability: fluctuating && index % 2 ? .54 : .36, overall: 7
      }));
    }
    assert.ok(p.confirmedChords.every(value => value === 'C'), 'Model probability does not punch holes in decoded history');
    p.canvas = { width, height: 200 };
    p.writeColumn = 0;
    const context = drawContext();
    p._drawChordLane(context, 400, 400 / width, 0, false);
    assert.deepEqual(context.texts.map(text => text.value), ['C']);
    assert.equal(context.bars.length, width);
    p._readoutFrame = { valid: true, horizontal: false, canvasWidth: width, rollWidth: width,
      rowHeight: 10, columnWidth: 1, scrollPhase: 0, phaseOffset: 0, split: 0, palette: { trace: [0, 255, 0] } };
    assert.equal(p._readNote(50, 5).rows.find(row => row.label === 'Chord')?.value, 'C');
    p.columnFrames.fill(100, 0, 100);
    p.handleChordKeyTelemetry(chord(111, { confirmed: [255, 255, 255], confirmedProbability: .1, overall: 7 }));
    assert.equal(p._readNote(50, 5).rows.find(row => row.label === 'Chord')?.value, 'No chord');
    assert.equal(p.overallKey, 7, 'Chord probability does not change key detection');
  }
});

test('all column assignment paths discard stale chord values, including a full history wrap', () => {
  for (const hopSeconds of [.0001, .02]) {
    const p = plugin();
    p.handleTelemetry(pitch(0, { hopSeconds }));
    p.confirmedChords.fill('stale');
    p.handleTelemetry(pitch(1, { hopSeconds }));
    const owned = [...p.columnFrames].flatMap((frame, column) => frame !== 0xffffffff ? [column] : []);
    const latest = (p.writeColumn + width - 1) % width;
    assert.equal(p.confirmedChords[latest], null);
    if (hopSeconds === .02) for (const column of owned.filter(column => column > 0)) {
      assert.equal(p.confirmedChords[column], null);
    }
  }
  const p = plugin();
  for (let frame = 0; frame < 220; frame++) {
    p.handleTelemetry(pitch(frame));
    if (frame < 100) p.handleChordKeyTelemetry(chord(frame));
  }
  assert.ok(p.columnSerial > width * 2);
  assert.ok(p.confirmedChords.every(value => value === null));
});

test('generation changes and ck off clear chord/key state and reject old results', () => {
  const p = plugin();
  p.handleTelemetry(pitch(0));
  p.handleChordKeyTelemetry(chord(11));
  assert.equal(p.confirmedChords[0], 'Am');
  p.handleTelemetry(pitch(0, { generation: 2 }));
  p.handleChordKeyTelemetry(chord(2));
  assert.ok(p.confirmedChords.every(value => value === null));
  assert.equal(p.overallKey, null);
  p.handleChordKeyTelemetry(chord(2, { generation: 2 }));
  p.setParameters({ ck: false });
  p.handleChordKeyTelemetry(chord(3, { generation: 2 }));
  assert.ok(p.confirmedChords.every(value => value === null));
  const context = drawContext();
  p._drawChordLane(context, width, 1, 0, false);
  p._drawKeys(context, 300, 200);
  assert.equal(context.bars.length, 0);
  assert.equal(context.texts.length, 0);
});

test('chord lane labels each supported run once and stays upright in both layouts', () => {
  for (const horizontal of [false, true]) {
    const p = plugin();
    p.canvas = { width: 300, height: 200 };
    p.confirmedChords.fill('Cmaj7', 0, 150);
    p.confirmedChords.fill('Am', 200, 300);
    p.confirmedChords[300] = '';
    const context = drawContext();
    p._drawChordLane(context, width, 1, 0, horizontal);
    assert.deepEqual(context.texts.map(text => [text.value, text.alpha]), [['Am', 1], ['Cmaj7', 1]]);
    assert.ok(context.texts.every(text => text.font === 'bold 28px Arial'));
    assert.deepEqual(context.rotations, horizontal ? [-Math.PI / 2, -Math.PI / 2] : []);
  }
});

test('Note Colors uses the chord root for names and duration bars, including inversions', () => {
  const p = plugin();
  p.canvas = { width: 400, height: 300 };
  for (let root = 0; root < 12; root++) {
    p.clearChordKeyHistory();
    p.activeGeneration = 1;
    p.columnFrames.fill(10, 100, 200);
    p.handleChordKeyTelemetry(chord(21, { confirmed: [root, 8, (root + 7) % 12] }));
    for (const mode of ['Rainbow', 'Normal', 'Instrument3', 'Instrument9']) {
      p.cl = mode;
      const context = drawContext();
      p._drawChordLane(context, width, 1, 0, true);
      const expected = mode === 'Rainbow' ? `rgb(${p.constructor.noteColor(root).join(', ')})` : 'stub:graph-label';
      assert.equal(context.texts[0].color, expected);
      assert.equal(context.texts[0].alpha, 1);
      const indicator = context.bars.find(bar => bar.h === 2);
      assert.equal(indicator.color, expected);
      assert.equal(indicator.alpha, 1);
    }
  }
});

test('large chord labels fit both layouts and omit names that cannot fit their own short intervals', () => {
  for (const dpr of [1, 2]) {
    for (const horizontal of [false, true]) {
      const p = plugin();
      p.graphDpr = dpr;
      p.canvas = { width: 300 * dpr, height: 200 * dpr };
      const rollWidth = (horizontal ? 160 : 260) * dpr;
      p.confirmedChords.fill('C', 0, 340);
      p.confirmedChords.fill('Am', 340, 360);
      p.confirmedChords.fill('C#m7b5/G#', 360);
      const context = drawContext();
      p._drawChordLane(context, rollWidth, rollWidth / width, .75, horizontal);
      assert.equal(context.texts[0].value, 'C#m7b5/G#');
      assert.ok(!context.texts.some(text => text.value === 'Am'), 'newest label wins when names would overlap');
      for (const text of context.texts) {
        const measuredWidth = Math.min(text.value.length * 28 * dpr * .6, text.maxWidth);
        if (horizontal) {
          assert.ok(text.x - text.metrics.actualBoundingBoxAscent >= 0);
          assert.ok(text.x + text.metrics.actualBoundingBoxDescent <= rollWidth);
          assert.ok(text.y + measuredWidth <= p.canvas.width);
        } else {
          assert.ok(text.x >= 0);
          assert.ok(text.x + measuredWidth <= rollWidth);
        }
      }
      assert.equal(context.bars.filter(bar => bar.h === 2 * dpr).length, width, 'duration bars remain for every chord');
    }
  }
});

test('the local Key is large, transparent, root-colored and lower-left in either layout', () => {
  for (const dpr of [1, 2]) {
    for (const horizontal of [false, true]) {
      const p = plugin();
      p.graphDpr = dpr;
      p.cl = 'Rainbow';
      p.localKey = 0;
      const graphWidth = (horizontal ? 300 : 260) * dpr;
      const graphHeight = (horizontal ? 160 : 200) * dpr;
      for (const key of [1, 13]) {
        p.localKey = key;
        const context = drawContext();
        p._drawKeys(context, graphWidth, graphHeight);
        assert.equal(context.texts.length, 1);
        const [text] = context.texts;
        assert.equal(text.value, key === 1 ? 'Key: D♭ major' : 'Key: C# minor');
        assert.equal(text.font, `bold ${28 * dpr}px Arial`);
        assert.equal(text.x, 12 * dpr);
        assert.equal(text.y, graphHeight - 24 * dpr);
        assert.equal(text.maxWidth, graphWidth - 24 * dpr);
        assert.equal(text.color, `rgb(${p.constructor.noteColor(1).join(', ')})`);
        assert.equal(context.bars.length, 0, 'Key must not paint a background over the spectrogram');
      }
      p.cl = 'Normal';
      p.localKey = 1;
      const context = drawContext();
      p._drawKeys(context, graphWidth, graphHeight);
      assert.equal(context.texts[0].color, 'stub:graph-label');
    }
  }
});

test('unknown Key removes both its text and chord collision obstacle, and known Key restores both', () => {
  for (const dpr of [1, 2]) {
    const p = plugin();
    p.graphDpr = dpr;
    p.canvas = { width: 200 * dpr, height: 200 * dpr };
    p.activeGeneration = 1;
    p.confirmedChords.fill('C#m7b5/G#', 768, 928);
    const rollWidth = 160 * dpr;
    for (const [frame, key] of [255, 0, 255, 13].entries()) {
      p.handleChordKeyTelemetry(chord(frame, { local: key, overall: 255 }));
      const context = drawContext();
      p._drawChordLane(context, rollWidth, rollWidth / width, 0, true);
      p._drawKeys(context, p.canvas.width, rollWidth);
      if (key === 255) {
        assert.equal(p._layoutKey(context, p.canvas.width, rollWidth), null);
        assert.deepEqual(context.texts.map(text => text.value), ['C#m7b5/G#'],
          'an invisible Key must not reserve the space needed by this chord interval');
      } else {
        assert.ok(p._layoutKey(context, p.canvas.width, rollWidth));
        assert.deepEqual(context.texts.map(text => text.value),
          [key === 0 ? 'Key: C major' : 'Key: C# minor'],
          'the visible Key must restore its collision obstacle');
      }
    }
  }
});

test('cumulative key signatures spell retained chords and hover pitches without changing their identity', () => {
  const p = plugin();
  p.activeGeneration = 1;
  p.canvas = { width: 400, height: 300 };
  p.confirmedChords.fill('C#m7b5/A#');
  p._readoutFrame = { valid: true, horizontal: false, canvasWidth: width, rollWidth: width,
    rowHeight: 10, columnWidth: 1, scrollPhase: 0, phaseOffset: 0, split: 0, palette: { trace: [0, 255, 0] } };
  p.mx = 70;
  const readout = () => p._readNote(.5, 5);
  assert.ok(readout().cursor.startsWith('A#4 +0¢'));
  const cases = [
    { local: 7, overall: 5, chord: 'D♭m7b5/B♭', note: 'B♭4 +0¢' },
    { local: 24, overall: 5, chord: 'D♭m7b5/B♭', note: 'B♭4 +0¢' },
    { local: 5, overall: 7, chord: 'C#m7b5/A#', note: 'A#4 +0¢' }
  ];
  for (const [frame, expected] of cases.entries()) {
    p.handleChordKeyTelemetry(chord(frame, expected));
    const context = drawContext();
    p._drawChordLane(context, 400, 400 / width, 0, false);
    p._drawKeys(context, 400, 300);
    assert.equal(context.texts[0].value, expected.chord);
    assert.equal(context.texts[1]?.value, expected.local === 24 ? undefined : expected.local === 5 ? 'Key: F major' : 'Key: G major');
    assert.equal(readout().rows.find(row => row.label === 'Chord').value, expected.chord);
    assert.ok(readout().cursor.startsWith(expected.note));
    assert.ok(p.confirmedChords.every(value => value === 'C#m7b5/A#'), 'history retains canonical roots and bass');
  }
  p.handleChordKeyTelemetry(chord(3, { overall: 6 }));
  assert.equal(p._noteReadout(65.25), 'E#4 +25¢', 'diatonic E# follows the F# major signature');
  assert.equal(p._noteReadout(64.75), 'E#4 −25¢', 'existing cent readouts are preserved');
  p.handleTelemetry(pitch(0, { generation: 2 }));
  assert.equal(p._noteReadout(70), 'A#4 +0¢', 'source generation reset restores initial sharp spelling');
  assert.equal(p._layoutKey(drawContext(), 400, 300), null);
});

test('Key captions choose conventional major and minor signatures with deterministic enharmonic ties', () => {
  const p = plugin();
  const major = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];
  const minor = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B♭', 'B'];
  for (let key = 0; key < 24; key++) {
    p.localKey = key;
    const context = drawContext();
    p._drawKeys(context, 400, 300);
    assert.equal(context.texts[0].value, `Key: ${(key < 12 ? major : minor)[key % 12]} ${key < 12 ? 'major' : 'minor'}`);
  }
});

test('shared chord and Key rendering preserves the display palette without painting text backgrounds', () => {
  for (const transparent of [undefined, false, true]) for (const horizontal of [false, true]) {
    const p = plugin();
    p.activeGeneration = 1;
    p.canvas = { width: 400, height: 300 };
    p.displayOptions = { transparent, chordKeyColor: root => [root, 20, 30],
      noteColor: () => { throw new Error('Categorical roots must not call the absolute-pitch/intensity palette'); } };
    const empty = drawContext();
    p._drawChordLane(empty, 260, 260 / width, 0, horizontal);
    assert.equal(empty.bars.length, 0, 'an empty graph must not paint a chord background');
    p.confirmedChords.fill('A#/D');
    p.handleChordKeyTelemetry(chord(0, { local: 7, overall: 5 }));
    const context = drawContext();
    p._drawChordLane(context, 260, 260 / width, 0, horizontal);
    p._drawKeys(context, 400, 260);
    assert.deepEqual(context.texts.map(text => [text.value, text.color]),
      [['B♭/D', 'rgb(10, 20, 30)'], ['Key: G major', 'rgb(7, 20, 30)']]);
    assert.ok(context.bars.every(bar => bar.h === 2 && bar.color === 'rgb(10, 20, 30)'),
      'only colored duration bars may be painted, never lane or label backgrounds');
  }
});

test('chord and Key outlines use the current graph background behind each fill at every DPR', () => {
  for (const dpr of [1, 2]) for (const horizontal of [false, true]) {
    const p = plugin();
    p.graphDpr = dpr;
    p.canvas = { width: 400 * dpr, height: 300 * dpr };
    p.confirmedChords.fill('C');
    p.localKey = 0;
    let background = 'rgb(7, 11, 20)';
    p.displayOptions = { transparent: true, chordKeyColor: () => [255, 120, 40],
      themePalette: { get: role => role === 'graph-bg-deep' ? background : 'rgb(0, 0, 0)' } };
    for (const color of [background, 'rgb(250, 250, 250)']) {
      background = color;
      const context = drawContext();
      p._drawChordLane(context, 260 * dpr, 260 * dpr / width, 0, horizontal);
      p._drawKeys(context, 400 * dpr, 260 * dpr);
      assert.equal(context.outlines.length, 2);
      assert.deepEqual(context.events, [['stroke', 'C'], ['fill', 'C'], ['stroke', 'Key: C major'], ['fill', 'Key: C major']]);
      for (const [index, outline] of context.outlines.entries()) {
        const fill = context.texts[index];
        assert.equal(outline.color, color);
        assert.equal(outline.width, 2 * dpr);
        assert.equal(outline.join, 'round');
        for (const property of ['value', 'x', 'y', 'maxWidth', 'alpha']) assert.equal(outline[property], fill[property]);
        assert.equal(fill.color, 'rgb(255, 120, 40)');
      }
      assert.ok(context.bars.every(bar => bar.h === 2 * dpr), 'outlines add no filled text panel');
      const key = context.texts[1], bounds = p._layoutKey(context, 400 * dpr, 260 * dpr).bounds;
      assert.equal(bounds.x, key.x - dpr);
      assert.equal(bounds.y, key.y - key.metrics.actualBoundingBoxAscent - dpr);
    }
  }
});

test('the oldest horizontal chord matches the right ink inset without padding or crossing later intervals', () => {
  for (const dpr of [1, 2]) {
    const p = plugin();
    p.graphDpr = dpr;
    p.canvas = { width: 300 * dpr, height: 200 * dpr };
    const rollWidth = 160 * dpr;
    const columnWidth = rollWidth / width;
    const context = drawContext();
    const measure = context.measureText;
    context.measureText = function(value) {
      const metrics = measure.call(this, value);
      return { ...metrics, actualBoundingBoxRight: this.textAlign === 'right' ? 1.25 * dpr : metrics.actualBoundingBoxRight };
    };
    p.confirmedChords.fill('A7', 0, 340);
    p.confirmedChords.fill('Dm7', 340);
    p._drawChordLane(context, rollWidth, columnWidth, .75, true);
    const oldest = context.texts.find(text => text.value === 'A7');
    const next = context.texts.find(text => text.value === 'Dm7');
    assert.ok(oldest && next);
    const topInset = oldest.x - oldest.metrics.actualBoundingBoxAscent - dpr;
    const rightInset = oldest.y - oldest.metrics.actualBoundingBoxRight - dpr;
    assert.equal(topInset, rightInset, 'actual glyph ink must have equal outer top and right margins');
    assert.equal(topInset, (6 - 1.25) * dpr, 'the new outline retains the prior outer ink inset');
    const boundary = (340 - .75) * columnWidth;
    assert.ok(oldest.x + oldest.metrics.actualBoundingBoxDescent + dpr <= boundary);
    assert.equal(next.x - next.metrics.actualBoundingBoxAscent - dpr, boundary,
      'only the plot edge receives padding; later chord labels retain their interval start');

    p.confirmedChords.fill('Dm7');
    p.confirmedChords.fill('A7', 0, 160);
    context.texts.length = 0;
    p._drawChordLane(context, rollWidth, columnWidth, 0, true);
    assert.deepEqual(context.texts.map(text => text.value), ['Dm7'],
      'omit an oldest label whose inset would push its glyphs across the chord boundary');
    assert.equal(context.texts[0].x - context.texts[0].metrics.actualBoundingBoxAscent - dpr, 160 * columnWidth);
  }
});

test('large horizontal chord names remain readable when the instrument legend is painted over the same graph', () => {
  for (const dpr of [1, 2]) {
    const p = plugin();
    p.graphDpr = dpr;
    p.cl = 'Instrument3';
    p.ly = 'Horizontal';
    p.canvas = { width: 300 * dpr, height: 200 * dpr };
    const rollWidth = 160 * dpr;
    p.confirmedChords.fill('C#m7b5/G#');
    const context = drawContext();
    p._drawChordLane(context, rollWidth, rollWidth / width, 0, true);
    assert.equal(context.texts.length, 1, 'the sustained chord still has room beside or below the legend');
    const [label] = context.texts;
    assert.equal(label.font, `bold ${28 * dpr}px Arial`);
    const textWidth = Math.min(label.value.length * 28 * dpr * .6, label.maxWidth);
    const chordBounds = { left: p.canvas.width - label.y - textWidth - dpr, right: p.canvas.width - label.y + dpr,
      top: label.x - label.metrics.actualBoundingBoxAscent - dpr,
      bottom: label.x + label.metrics.actualBoundingBoxDescent + dpr };
    const beforeLegend = context.bars.length;
    p._drawTimbreLegend(context, p.canvas.width, rollWidth);
    assert.deepEqual(context.texts.slice(1).map(text => text.value), ['Vocal', 'Bass', 'Other']);
    for (const rectangle of context.bars.slice(beforeLegend)) {
      assert.ok(chordBounds.right <= rectangle.x || chordBounds.left >= rectangle.x + rectangle.w ||
        chordBounds.bottom <= rectangle.y || chordBounds.top >= rectangle.y + rectangle.h,
      'a legend rectangle must not obscure any part of the large chord name');
    }
    p.confirmedChords.fill('G', 150);
    const shortRunContext = drawContext();
    p._drawChordLane(shortRunContext, rollWidth, rollWidth / width, 0, true);
    assert.ok(!shortRunContext.texts.some(text => text.value === 'C#m7b5/G#'),
      'a chord must not move into the following G interval to avoid the legend');
  }
});

test('a recent chord remains visibly inside its own interval beside the transparent lower-left Key', () => {
  const p = plugin();
  p.canvas = { width: 640, height: 300 };
  p.ly = 'Horizontal';
  p.cl = 'Rainbow';
  p.localKey = 0;
  p.confirmedChords.fill('C', 0, 900);
  p.confirmedChords.fill('G', 900, 1000);
  const rollWidth = 260;
  const context = drawContext();
  p._drawChordLane(context, rollWidth, rollWidth / width, 0, true);
  p._drawKeys(context, p.canvas.width, rollWidth);
  const recent = context.texts.find(text => text.value === 'G');
  assert.ok(recent, 'the recent G interval has readable room and must retain its name');
  assert.equal(recent.font, 'bold 28px Arial');
  assert.equal(recent.alpha, 1);
  assert.equal(recent.color, `rgb(${p.constructor.noteColor(7).join(', ')})`);
  const recentBounds = { left: p.canvas.width - recent.y - recent.metrics.actualBoundingBoxLeft - 1,
    right: p.canvas.width - recent.y + recent.metrics.actualBoundingBoxRight + 1,
    top: recent.x - recent.metrics.actualBoundingBoxAscent - 1,
    bottom: recent.x + recent.metrics.actualBoundingBoxDescent + 1 };
  assert.ok(recentBounds.top >= 900 * rollWidth / width, 'G must not be painted in the preceding C interval');
  assert.ok(recentBounds.bottom <= 1000 * rollWidth / width, 'G must remain within its own duration bar');
  const key = context.texts.find(text => text.value === 'Key: C major');
  assert.ok(key);
  assert.ok(recentBounds.left >= key.x + key.metrics.actualBoundingBoxRight + 1,
    'Key and G share vertical space without colliding horizontally');
});

for (const variant of ['baseline', 'simd']) {
  test(`Note Spectrogram ${variant} chord/key labels exactly match the fixed audio reference`, async () => {
    const fixtureRoot = new URL('../../dsp/plugins/analyzer/note_spectrogram/fixtures/', import.meta.url);
    const metadata = JSON.parse(fs.readFileSync(new URL('chord-key.json', fixtureRoot), 'utf8'));
    const inputBytes = fs.readFileSync(new URL('chord-key-input.f32', fixtureRoot));
    const reference = fs.readFileSync(new URL('chord-key-reference.bin', fixtureRoot));
    const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256(inputBytes), metadata.inputSha256);
    assert.equal(sha256(reference), metadata.referenceSha256);
    assert.equal(reference.length, metadata.frames * 8);
    const input = new Float32Array(inputBytes.buffer.slice(inputBytes.byteOffset, inputBytes.byteOffset + inputBytes.byteLength));
    assert.equal(input.length, metadata.samples);
    const filename = variant === 'simd' ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
    const override = process.env[variant === 'simd' ? 'EFFETUNE_NS_SIMD_WASM' : 'EFFETUNE_NS_BASELINE_WASM'];
    const binding = await instantiateDspBinding(fs.readFileSync(override || new URL(`../../plugins/dsp/${filename}`, import.meta.url)));
    binding.createEngine();
    try {
      assert.equal(binding.prepare(metadata.sampleRate, metadata.channels, metadata.blockSize, 262144), 0);
      const id = binding.createInstance('NoteSpectrogramPlugin');
      assert.ok(id);
      assert.equal(binding.instanceSetTap(id, metadata.tapId), 0);
      assert.equal(binding.setTelemetryRate(metadata.telemetryRate), 0);
      const packer = DSP_PARAM_PACKERS.get('NoteSpectrogramPlugin');
      assert.equal(binding.instanceSetParams(id, packer.pack({}), packer.hash), 0);
      const packet = new Uint8Array(262144);
      let row = 0;
      const render = expectChords => {
        for (let offset = 0; offset < input.length; offset += metadata.blockSize) {
          const { combined, offsets } = binding.getArenaViews();
          combined.set(input.subarray(offset, offset + metadata.blockSize));
          assert.equal(binding.instanceProcess(id, offsets.combined, metadata.channels,
            metadata.blockSize, offset / metadata.sampleRate), 0);
          const bytes = binding.telemetryRead(packet);
          assert.equal(binding.lastTelemetryDroppedFrames, 0);
          assert.equal(parseTelemetryPacket(packet, bytes, frame => {
            if (frame.frameType !== 32) return;
            assert.ok(expectChords, 'ck off must not emit chord/key telemetry');
            assert.equal(frame.formatVersion, 1);
            assert.equal(frame.payload.byteLength, 32);
            const probability = frame.payload.getFloat32(28, true);
            assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1);
            assert.equal(frame.payload.getUint32(16, true), row);
            assert.deepEqual(Array.from(new Uint8Array(frame.payload.buffer, frame.payload.byteOffset + 20, 8)),
              Array.from(reference.subarray(row * 8, (row + 1) * 8)), `${variant} chord/key row ${row}`);
            row++;
          }).ok, true);
        }
      };
      render(false);
      assert.equal(binding.instanceSetParams(id, packer.pack(metadata.params), packer.hash), 0);
      render(true);
      assert.equal(row, metadata.telemetryFrames);
      assert.equal(binding.instanceSetParams(id, packer.pack({ ...metadata.params, ck: false }), packer.hash), 0);
      render(false);
    } finally {
      binding.destroyEngine();
    }
  });
}
