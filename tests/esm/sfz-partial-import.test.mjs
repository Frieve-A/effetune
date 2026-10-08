import test from 'node:test';
import assert from 'node:assert/strict';
import { SfzLibraryService } from '../../js/sfz/service.js';
import { decodeSfzBank } from '../../js/sfz/bank.js';

const encode = text => new TextEncoder().encode(text);

test('sample-aware invalid regions retain usable Web regions with additive warnings after cold loading', async () => {
  const stored = new Map();
  const backend = { async read(name) { return stored.get(name) || null; },
    async writeAtomic(name, bytes) { stored.set(name, bytes.slice()); } };
  const file = (name, text) => ({ name, size: encode(text).length,
    arrayBuffer: async () => encode(text).buffer });
  const diagnostics = [];
  const service = await new SfzLibraryService(backend, { onDiagnostic: detail => diagnostics.push(detail) }).open();
  const decode = () => ({ sampleRate: 44100, channels: [new Float32Array(8)] });
  const definition = '<region> sample=tone.wav key=60\n<region> sample=tone.wav key=61 end=99\n' +
    '<region> sample=tone.wav key=62 loop_mode=loop_continuous loop_end=99\n' +
    '<region> sample=tone.wav key=63 pan=101';
  const entry = await service.importFolderFiles([file('test.sfz', definition), file('tone.wav', 'audio')],
    'test.sfz', { decode });
  assert.equal(entry.regionCount, 1);
  const cached = await service.prepare(entry.id, { decode });
  const cold = await (await new SfzLibraryService(backend, { onDiagnostic: null }).open()).prepare(entry.id, { decode });
  assert.equal(cold.regionCount, 1);
  assert.deepEqual(cached.warnings, [{ code: 'invalid-regions', count: 3 }]);
  assert.deepEqual(cold.warnings, cached.warnings);
  assert.deepEqual(cold.descriptor.payload, cached.descriptor.payload);
  assert.equal(new Float32Array(cached.descriptor.payload, 64)[4], 60);
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].invalidRegions.length, 1);
  assert.equal(diagnostics[1].invalidRegions.length, 2);
  assert.match(diagnostics[1].invalidRegions[0], /tone.wav:.*playback/);
  assert.match(diagnostics[1].invalidRegions[1], /tone.wav:.*loop points/);
  await assert.rejects(service.importFolderFiles([file('invalid.sfz', definition.slice(definition.indexOf('\n') + 1)),
    file('tone.wav', 'audio')], 'invalid.sfz', { decode }), error => error.code === 'prepare');
  assert.equal((await service.list()).length, 1);
});

test('Web include expansion respects the selected load budget before reading samples or saving a bank', async () => {
  const reads = [];
  const backend = { async read() { return null; }, async writeAtomic() { assert.fail('No bank should be saved'); } };
  const files = Array.from({ length: 17 }, (_, index) => {
    const bytes = encode(index === 16 ? '<region> sample=tone.wav key=60'
      : `#include "${index + 1}.sfz"\n#include "${index + 1}.sfz"`);
    return { name: `${index}.sfz`, size: bytes.length,
      async arrayBuffer() { reads.push(index); return bytes.buffer; } };
  });
  const service = await new SfzLibraryService(backend, { getMaxBytes: () => 1024, onDiagnostic: null }).open();
  await assert.rejects(service.importFolderFiles(files, '0.sfz', {
    decode() { assert.fail('No sample should be decoded'); }
  }), error => error.code === 'too-large');
  assert.ok(reads.length <= 17);
});

test('partial CC import reads and stores only the selected layer and prepares it identically after reopening', async () => {
  const stored = new Map();
  const backend = {
    async read(name) { return stored.get(name) || null; },
    async writeAtomic(name, bytes) { stored.set(name, bytes.slice()); },
    async remove(name) { stored.delete(name); }
  };
  const reads = [];
  const file = (name, bytes) => ({ name, size: bytes.length, webkitRelativePath: `Instrument/${name}`,
    async arrayBuffer() { reads.push(name); return bytes.slice().buffer; } });
  const text = '<group> key=60\n<region> sample=off.wav hicc64=63\n' +
    '<region> sample=on.wav locc64=64\n<region> sample=release.wav trigger=release\n' +
    '<control> set_cc64=127';
  const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const decode = () => ({ sampleRate: 44100, channels: [new Float32Array([.1, .2, .3])] });
  const entry = await service.importFolderFiles([
    file('piano.sfz', encode(text)), file('off.wav', new Uint8Array([1])),
    file('on.wav', new Uint8Array([2])), file('release.wav', new Uint8Array([3]))
  ], 'piano.sfz', { decode });
  assert.equal(entry.regionCount, 1);
  assert.deepEqual(reads, ['piano.sfz', 'on.wav']);
  const bank = decodeSfzBank(stored.get(`${entry.id}.sfzbank`));
  assert.deepEqual([...bank.files.keys()], ['on.wav', 'piano.sfz']);
  assert.equal(new TextDecoder().decode(bank.files.get('piano.sfz')), text);
  const first = await service.prepare(entry.id, { decode });
  const reopened = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const second = await reopened.prepare(entry.id, { decode });
  assert.equal(second.regionCount, 1);
  assert.deepEqual(second.descriptor.payload, first.descriptor.payload);
  assert.deepEqual(first.warnings, [{ code: 'unsupported-regions', count: 1 }]);
  assert.deepEqual(second.warnings, first.warnings);
});

test('over-budget Web imports persist representative velocity and sequence mapping after reopening', async () => {
  const stored = new Map();
  const backend = { async read(name) { return stored.get(name) || null; },
    async writeAtomic(name, bytes) { stored.set(name, bytes.slice()); }, async remove(name) { stored.delete(name); } };
  const reads = [];
  const file = (name, bytes) => ({ name, size: bytes.length, webkitRelativePath: `Instrument/${name}`,
    async arrayBuffer() { reads.push(name); return bytes.slice().buffer; },
    slice(start, end) { return { arrayBuffer: async () => bytes.slice(start, end).buffer }; } });
  const wav = frames => {
    const bytes = new Uint8Array(44); const view = new DataView(bytes.buffer);
    bytes.set(encode('RIFF'), 0); bytes.set(encode('WAVEfmt '), 8); bytes.set(encode('data'), 36);
    view.setUint32(16, 16, true); view.setUint16(22, 1, true); view.setUint32(24, 44100, true);
    view.setUint16(32, 2, true); view.setUint32(40, frames * 2, true); return bytes;
  };
  const definition = '<group> lokey=60 hikey=61 lovel=0 hivel=64 seq_length=2\n' +
    '<region> sample=../samples/soft1.wav seq_position=1 lorand=0 hirand=.5\n' +
    '<region> sample=../samples/soft2.wav seq_position=2 lorand=.5 hirand=1\n' +
    '<group> lokey=60 hikey=61 lovel=65 hivel=127\n<region> sample=../samples/loud.wav\n' +
    '<region> sample=../samples/soft1.wav pan=101\n<region> sample=../samples/missing.wav\n' +
    '<region> sample=../samples/soft1.wav trigger=release';
  const service = await new SfzLibraryService(backend, { getMaxBytes: () => 2048, onDiagnostic: null }).open();
  const decode = () => ({ sampleRate: 44100, channels: [new Float32Array(300)] });
  const entry = await service.importFolderFiles([file('parts/piano.sfz', encode(definition)),
    file('samples/soft1.wav', wav(300)), file('samples/soft2.wav', wav(300)),
    file('samples/loud.wav', wav(2000))], 'parts/piano.sfz', { decode });
  assert.deepEqual(reads, ['parts/piano.sfz', 'samples/soft1.wav']);
  const bank = decodeSfzBank(stored.get(`${entry.id}.sfzbank`));
  assert.deepEqual([...bank.files.keys()], ['parts/piano.sfz', 'samples/soft1.wav']);
  const reloaded = await new SfzLibraryService(backend, { getMaxBytes: () => 2048, onDiagnostic: null }).open();
  const first = await service.prepare(entry.id, { decode });
  const second = await reloaded.prepare(entry.id, { decode });
  assert.deepEqual(new Uint8Array(second.descriptor.payload), new Uint8Array(first.descriptor.payload));
  assert.deepEqual(first.warnings, [{ code: 'invalid-regions', count: 1 },
    { code: 'missing-samples', count: 1 }, { code: 'reduced-bank', count: 1 },
    { code: 'unsupported-regions', count: 1 }]);
  assert.deepEqual(second.warnings, first.warnings);
  const table = new Float32Array(second.descriptor.payload, 64);
  assert.deepEqual([...table.slice(4, 12)], [60, 61, 1, 127, 0, 1, 1, 1]);
});

test('load warnings aggregate genuine omissions and keep normal static projections silent', async () => {
  const stored = new Map();
  const backend = { async read(name) { return stored.get(name) || null; },
    async writeAtomic(name, bytes) { stored.set(name, bytes.slice()); } };
  const file = (name, text) => ({ name, size: encode(text).length,
    arrayBuffer: async () => encode(text).buffer });
  const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const decode = () => ({ sampleRate: 44100, channels: [new Float32Array(8)] });
  const text = '<control> set_cc64=0\n<global> sw_default=c2 cutoff=200\n' +
    '<region> sample=tone.wav key=60 hicc64=63 sw_last=c2 loop_end=4294967295\n' +
    '<region> sample=tone.wav key=60 locc64=64\n<region> sample=tone.wav key=60 sw_last=d2\n' +
    '<region> sample=tone.wav key=60 trigger=release\n' +
    '<region> sample=missing.wav key=60\n<region> sample=tone.wav key=60 pan=101';
  const entry = await service.importFolderFiles([file('test.sfz', text), file('tone.wav', 'audio')], 'test.sfz', { decode });
  const cached = await service.prepare(entry.id, { decode });
  assert.deepEqual(cached.warnings, [
    { code: 'invalid-regions', count: 1 }, { code: 'loop-points-ignored', count: 1 },
    { code: 'missing-samples', count: 1 }, { code: 'unsupported-regions', count: 1 }
  ]);
  assert.equal(Object.hasOwn(cached.descriptor, 'warnings'), false);
  const cold = await (await new SfzLibraryService(backend, { onDiagnostic: null }).open()).prepare(entry.id, { decode });
  assert.deepEqual(cold.warnings, cached.warnings);
  const normal = text.slice(0, text.indexOf('<region> sample=tone.wav key=60 trigger'))
    .replace(' loop_end=4294967295', '');
  const clean = await service.importFolderFiles([file('normal.sfz', normal), file('tone.wav', 'audio')], 'normal.sfz', { decode });
  assert.equal((await service.prepare(clean.id, { decode })).warnings, undefined);
});

test('invalid-only samples retain their settings warning after Web storage and cold loading', async () => {
  const stored = new Map();
  const backend = { async read(name) { return stored.get(name) || null; },
    async writeAtomic(name, bytes) { stored.set(name, bytes.slice()); } };
  const reads = [];
  const file = (name, text) => ({ name, size: encode(text).length,
    async arrayBuffer() { reads.push(name); return encode(text).buffer; } });
  const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const decode = () => ({ sampleRate: 44100, channels: [new Float32Array(8)] });
  const entry = await service.importFolderFiles([
    file('test.sfz', '<region> sample=valid.wav key=60\n<region> sample=invalid.wav key=60 pan=101'),
    file('valid.wav', 'audio'), file('invalid.wav', 'audio')
  ], 'test.sfz', { decode });
  assert.deepEqual(reads, ['test.sfz', 'valid.wav']);
  assert.deepEqual([...decodeSfzBank(stored.get(`${entry.id}.sfzbank`)).files.keys()], ['test.sfz', 'valid.wav']);
  const cached = await service.prepare(entry.id, { decode });
  const cold = await (await new SfzLibraryService(backend, { onDiagnostic: null }).open()).prepare(entry.id, { decode });
  assert.deepEqual(cached.warnings, [{ code: 'invalid-regions', count: 1 }]);
  assert.deepEqual(cold.warnings, cached.warnings);
  assert.equal(cold.regionCount, 1);
});
