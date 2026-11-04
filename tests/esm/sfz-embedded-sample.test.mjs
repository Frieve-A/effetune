import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { decodeEmbeddedSfzSample } from '../../js/sfz/embedded-sample.js';
import { decodeSfzText } from '../../js/sfz/source.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { prepareSfzSamples, SfzLibraryService } from '../../js/sfz/service.js';
import { decodeSfzBank } from '../../js/sfz/bank.js';
import { NativeSfzLibraryService } from '../../js/sfz/native-service.js';
import { createSfzMemorySampleReader } from '../../js/sfz/sample-reader.js';

const ascii = text => new TextEncoder().encode(text);
function encodePayload(bytes) {
  const encoded = [];
  for (const byte of bytes) {
    const mapped = (byte + 42) & 255;
    if ([61, 0, 9, 10, 13, 36].includes(mapped)) encoded.push(61, (byte + 64) & 255);
    else encoded.push(mapped);
  }
  return Uint8Array.from([...encoded, 36]);
}
function source(payload, prefix = '<region> sample=embedded.wav') {
  return Uint8Array.from([...ascii(`${prefix}\n<sample> name=embedded.wav data=`), ...encodePayload(payload)]);
}
function wave() {
  const bytes = new Uint8Array(50), view = new DataView(bytes.buffer);
  bytes.set(ascii('RIFF')); bytes.set(ascii('WAVEfmt '), 8); bytes.set(ascii('data'), 36);
  view.setUint32(4, 42, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 6, true);
  view.setInt16(44, -32768, true); view.setInt16(46, 0, true); view.setInt16(48, 32767, true);
  return bytes;
}
const parse = bytes => parseSfz({ selectedPath: 'instrument.sfz', readText: async () => decodeSfzText(bytes),
  hasSample: () => false, onDiagnostic: null });

test('published byte alphabet preserves every byte through mixed text decoding', async () => {
  assert.deepEqual(decodeEmbeddedSfzSample('|spp$', 100), ascii('RIFF'));
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  const parsed = await parse(source(bytes));
  assert.deepEqual(parsed.embeddedSamples.get('embedded.wav'), bytes);
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.equal(parsed.regions.length, 1);
  assert.deepEqual(parsed.warnings, []);
});

test('binary payload opcode/comment/macro text is never executed as SFZ syntax', async () => {
  const encoded = '//fake\n<region> sample=other.wav\n#include "other.sfz"\n$';
  // The end-marker is the only terminator; comment and opcode tokens are bytes.
  const bytes = Uint8Array.from([...ascii('<region> sample=embedded.wav\n<sample> name=embedded.wav data='), ...ascii(encoded)]);
  const parsed = await parse(bytes);
  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.dependencies.length, 1);
  assert.ok(parsed.embeddedSamples.get('embedded.wav').length > 0);
  await assert.rejects(parse(ascii('<sample> name=a.wav data=|spp')), { code: 'prepare' });
});

test('embedded audio follows normal resident decoding and exact bounded range readers', async () => {
  const bytes = wave(), parsed = await parse(source(bytes));
  let calls = 0;
  const prepared = await prepareSfzSamples(parsed, () => assert.fail('No external sample read'), async buffer => {
    calls++; assert.deepEqual(new Uint8Array(buffer), bytes);
    return { sampleRate: 48000, channels: [Float32Array.of(-1, 0, 32767 / 32768)] };
  }, 1024 * 1024, null);
  assert.equal(calls, 1); assert.equal(prepared.regionCount, 1);
  const reader = await createSfzMemorySampleReader(parsed.embeddedSamples.get('embedded.wav'));
  assert.deepEqual(await reader.readRange(44, 6), bytes.slice(44));
  assert.match(reader.revision, /^[a-f0-9]{64}$/);
  await assert.rejects(reader.readRange(49, 2), { code: 'prepare' });
});

test('native granted bank prepares embedded audio without filesystem sample access', async () => {
  const id = 'a'.repeat(24), bytes = wave();
  let definition = source(bytes, `<region> sample=embedded.wav md5=${createHash('md5').update(bytes).digest('hex')}`);
  const entry = { id, name: 'instrument.sfz', selectedPath: 'instrument.sfz' };
  const service = new NativeSfzLibraryService({ apiVersion: 1,
    list: async () => ({ ok: true, data: [entry] }),
    readRelative: async ({ relativePath }) => {
      assert.equal(relativePath, 'instrument.sfz'); return { ok: true, data: definition };
    },
    statRelative: () => assert.fail('Embedded audio does not need a filesystem grant')
  }, { onDiagnostic: null });
  const prepared = await service.prepare(id, { decode: async buffer => {
    assert.deepEqual(new Uint8Array(buffer), bytes);
    return { sampleRate: 48000, channels: [Float32Array.of(-1, 0, 32767 / 32768)] };
  } });
  assert.equal(prepared.regionCount, 1);
  definition = source(bytes, `<region> sample=embedded.wav md5=${'0'.repeat(32)}`);
  await assert.rejects(service.prepare(id, { decode: () => assert.fail('Checksum failure precedes decoding') }),
    { code: 'sample-integrity' });
});

test('browser bank stores only the original embedded definition and reopens it', async () => {
  const files = new Map(), bytes = wave();
  const definition = source(bytes, `<region> sample=embedded.wav md5=${createHash('md5').update(bytes).digest('hex')}`);
  const backend = { read: async name => files.get(name) ?? null,
    writeAtomic: async (name, value) => { files.set(name, value.slice()); } };
  const service = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  const decode = async buffer => {
    assert.deepEqual(new Uint8Array(buffer), bytes);
    return { sampleRate: 48000, channels: [Float32Array.of(-1, 0, 32767 / 32768)] };
  };
  const entry = await service.importFolderFiles([{ name: 'instrument.sfz', size: definition.length,
    arrayBuffer: async () => definition.slice().buffer }], 'instrument.sfz', { decode });
  const bank = decodeSfzBank(files.get(`${entry.id}.sfzbank`));
  assert.deepEqual([...bank.files.keys()], ['instrument.sfz']);
  assert.deepEqual(bank.files.get('instrument.sfz'), definition);
  const reopened = await new SfzLibraryService(backend, { onDiagnostic: null }).open();
  assert.equal((await reopened.prepare(entry.id, { decode })).regionCount, 1);
  const invalid = source(bytes, `<region> sample=embedded.wav md5=${'0'.repeat(32)}`);
  await assert.rejects(service.importFolderFiles([{ name: 'invalid.sfz', size: invalid.length,
    arrayBuffer: async () => invalid.slice().buffer }], 'invalid.sfz',
  { decode: () => assert.fail('Checksum failure precedes decoding') }), { code: 'sample-integrity' });
});
