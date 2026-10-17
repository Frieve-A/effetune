const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { AlacPlaybackSource, probeAlac } = require('../../electron/alac-playback-source.cjs');

function box(type, ...contents) {
  const payload = Buffer.concat(contents);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function mp4(bitDepth, { codec = 'alac', version = 0, wave = false } = {}) {
  const description = Buffer.alloc(version === 1 ? 44 : version === 2 ? 64 : 28);
  description.writeUInt16BE(1, 6);
  description.writeUInt16BE(version, 8);
  description.writeUInt16BE(2, 16);
  // The generic sampleSize is deliberately different from the magic cookie.
  description.writeUInt16BE(16, 18);
  description.writeUInt32BE(44100 * 65536, 24);
  const config = Buffer.alloc(28);
  config.writeUInt32BE(4096, 4);
  config[9] = bitDepth;
  config[13] = 2;
  config.writeUInt32BE(44100, 24);
  let cookie = codec === 'alac' ? box('alac', config) : Buffer.alloc(0);
  if (wave) cookie = box('wave', cookie);
  const stsd = Buffer.alloc(8);
  stsd.writeUInt32BE(1, 4);
  let container = box('stsd', stsd, box(codec, description, cookie));
  for (const type of ['stbl', 'minf', 'mdia', 'trak', 'moov']) container = box(type, container);
  return Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0M4A ')), container]);
}

async function probeBuffer(bytes, reads = []) {
  return probeAlac({
    async read(target, offset, length, position) {
      reads.push([position, length]);
      return { bytesRead: bytes.copy(target, offset, position, position + length) };
    }
  }, bytes.length);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fakeExecutor({ hold = false, fail = false } = {}) {
  const calls = [];
  const started = deferred();
  const executeFile = (executable, args, callback) => {
    const call = { executable, args, killed: false };
    calls.push(call);
    call.finish = () => callback(fail ? new Error('afconvert test failure') : null);
    void fs.writeFile(args[5], Buffer.from('converted PCM')).then(() => {
      started.resolve(call);
      if (!hold) call.finish();
    }, callback);
    return { kill(signal) {
      call.killed = signal;
      queueMicrotask(() => callback(new Error('afconvert killed')));
    } };
  };
  return { executeFile, calls, started: started.promise };
}

async function setup(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-alac-test-')));
  const converter = new AlacPlaybackSource({ platform: 'darwin', tempRoot: root, ...options });
  t.after(async () => {
    await converter.dispose();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  async function source(name, bytes = mp4(24)) {
    const filePath = path.join(root, name);
    await fs.writeFile(filePath, bytes);
    return filePath;
  }
  return { root, converter, source };
}

test('probe identifies ALAC config depths and ignores AAC and media payloads', async () => {
  for (const depth of [16, 24, 20, 32]) {
    assert.deepEqual(await probeBuffer(mp4(depth)), { bitDepth: depth });
  }
  assert.deepEqual(await probeBuffer(mp4(24, { version: 1, wave: true })), { bitDepth: 24 });
  assert.deepEqual(await probeBuffer(mp4(32, { version: 2 })), { bitDepth: 32 });
  const media = box('mdat', mp4(32));
  const bytes = Buffer.concat([media, mp4(16, { codec: 'mp4a' })]);
  const reads = [];
  assert.equal(await probeBuffer(bytes, reads), null);
  assert.ok(reads.every(([position]) => position < 8 || position >= media.length));
});

test('probe honors extended sizes, zero-sized boxes and malformed box bounds', async () => {
  const movie = mp4(24);
  const extended = Buffer.alloc(16);
  extended.writeUInt32BE(1);
  extended.write('free', 4);
  extended.writeBigUInt64BE(24n, 8);
  assert.deepEqual(await probeBuffer(Buffer.concat([extended, Buffer.alloc(8), movie])), { bitDepth: 24 });
  const toEnd = Buffer.from(movie.subarray(movie.readUInt32BE(0)));
  // The moov after ftyp consumes the rest of the file.
  toEnd.writeUInt32BE(0);
  assert.deepEqual(await probeBuffer(toEnd), { bitDepth: 24 });
  const malformed = box('moov', Buffer.alloc(8));
  malformed.writeUInt32BE(0xffffffff, 8);
  assert.equal(await probeBuffer(malformed), null);
  assert.equal(await probeBuffer(Buffer.from([0, 0, 0])), null);
});

test('prepare maps depth to shell-free afconvert arguments and publishes only the renamed output', async t => {
  const fake = fakeExecutor();
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  for (const [depth, format] of [[16, 'LEI16'], [24, 'LEI24'], [20, 'LEI24'], [32, 'LEI32']]) {
    const input = await source(`music & ${depth}.m4a`, mp4(depth));
    const result = await converter.prepare(input);
    assert.equal(result.success, true);
    assert.equal(result.converted, true);
    assert.equal(path.extname(result.path), '.wav');
    assert.equal(result.byteLength, Buffer.byteLength('converted PCM'));
    const call = fake.calls.at(-1);
    assert.equal(call.executable, '/usr/bin/afconvert');
    assert.deepEqual(call.args, ['-f', 'WAVE', '-d', format, input, `${result.path}.tmp`]);
    assert.equal((await fs.readFile(result.path)).toString(), 'converted PCM');
    await assert.rejects(fs.stat(call.args[5]), { code: 'ENOENT' });
  }
  assert.equal(new Set(fake.calls.map(call => path.dirname(call.args[5]))).size, 1);
});

test('AAC and non-MP4 inputs pass through with canonical paths without conversion', async t => {
  const fake = fakeExecutor();
  const { root, converter, source } = await setup(t, { executeFile: fake.executeFile });
  for (const [name, bytes] of [['aac.M4A', mp4(24, { codec: 'mp4a' })], ['plain.wav', mp4(24)]]) {
    const input = await source(name, bytes);
    assert.deepEqual(await converter.prepare(path.join(root, 'unused', '..', name)), {
      success: true, path: input, byteLength: bytes.length, converted: false
    });
  }
  assert.equal(fake.calls.length, 0);
  assert.equal((await fs.readdir(root)).length, 2);
});

test('AAC passes through after moov even with more than 4096 trailing top-level boxes', async t => {
  const fake = fakeExecutor();
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const bytes = Buffer.concat([
    mp4(16, { codec: 'mp4a' }),
    ...Array.from({ length: 4098 }, (_, index) => box(index % 2 === 0 ? 'moof' : 'mdat'))
  ]);
  const input = await source('fragmented.m4a', bytes);
  assert.deepEqual(await converter.prepare(input), {
    success: true, path: input, byteLength: bytes.length, converted: false
  });
  assert.equal(fake.calls.length, 0);
});

test('concurrent requests share one conversion and cannot observe a partial WAV', { timeout: 10000 }, async t => {
  const fake = fakeExecutor({ hold: true });
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const input = await source('shared.mp4');
  let completed = false;
  const first = converter.prepare(input).then(result => { completed = true; return result; });
  const second = converter.prepare(input);
  const call = await fake.started;
  assert.equal(completed, false);
  assert.equal((await fs.readFile(call.args[5])).toString(), 'converted PCM');
  await assert.rejects(fs.stat(call.args[5].slice(0, -4)), { code: 'ENOENT' });
  call.finish();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(await converter.prepare(input), a);
  assert.equal(fake.calls.length, 1);
});

test('cache keeps four outputs, refreshes LRU on hits and invalidates changed source identity', async t => {
  const fake = fakeExecutor();
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const inputs = [];
  const results = [];
  for (let index = 0; index < 4; index++) {
    inputs.push(await source(`${index}.m4a`));
    results.push(await converter.prepare(inputs[index]));
  }
  assert.deepEqual(await converter.prepare(inputs[0]), results[0]);
  const fifth = await converter.prepare(await source('4.m4a'));
  await assert.rejects(fs.stat(results[1].path), { code: 'ENOENT' });
  await fs.stat(results[0].path);
  assert.equal((await fs.readdir(path.dirname(fifth.path))).length, 4);
  await fs.appendFile(inputs[0], box('free', Buffer.alloc(8)));
  const changed = await converter.prepare(inputs[0]);
  assert.notEqual(changed.path, results[0].path);
  const previousStats = await fs.stat(inputs[0]);
  await fs.utimes(inputs[0], previousStats.atime, new Date(previousStats.mtimeMs + 2000));
  assert.notEqual((await converter.prepare(inputs[0])).path, changed.path);
  assert.equal(fake.calls.length, 7);
});

test('concurrent conversions evict without deleting the same output twice', async t => {
  const fake = fakeExecutor();
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const inputs = await Promise.all(Array.from({ length: 8 }, (_, index) => source(`${index}.m4a`)));
  const results = await Promise.all(inputs.map(input => converter.prepare(input)));
  assert.ok(results.every(result => result.success));
  assert.equal((await fs.readdir(path.dirname(results[0].path))).length, 4);
});

test('ALAC outside macOS returns the platform code while AAC passes through', async t => {
  const fake = fakeExecutor();
  const { converter, source } = await setup(t, { platform: 'win32', executeFile: fake.executeFile });
  assert.deepEqual(await converter.prepare(await source('lossless.m4a')), {
    success: false, code: 'alacRequiresMacDesktop'
  });
  assert.equal((await converter.prepare(await source('aac.mp4', mp4(16, { codec: 'mp4a' })))).converted, false);
  assert.equal(fake.calls.length, 0);
});

test('invalid input, unavailable files and unsupported ALAC depths return contract codes', async t => {
  t.mock.method(console, 'error', () => {});
  const fake = fakeExecutor();
  const { root, converter, source } = await setup(t, { executeFile: fake.executeFile });
  for (const input of [null, {}, '', 'bad\0path']) {
    assert.deepEqual(await converter.prepare(input), { success: false, code: 'invalidPlaybackSource' });
  }
  for (const input of [root, path.join(root, 'missing.m4a')]) {
    assert.deepEqual(await converter.prepare(input), { success: false, code: 'playbackSourceUnavailable' });
  }
  assert.deepEqual(await converter.prepare(await source('unsupported.m4a', mp4(12))), {
    success: false, code: 'alacConversionFailed'
  });
  assert.equal(fake.calls.length, 0);
});

test('conversion failure cleans partial output and can be retried', async t => {
  t.mock.method(console, 'error', () => {});
  const fake = fakeExecutor({ fail: true });
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const input = await source('failure.m4a');
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await converter.prepare(input), { success: false, code: 'alacConversionFailed' });
    assert.deepEqual(await fs.readdir(path.dirname(fake.calls.at(-1).args[5])), []);
  }
  assert.equal(fake.calls.length, 2);
});

test('dispose kills in-flight conversion and removes the per-run directory', { timeout: 10000 }, async t => {
  t.mock.method(console, 'error', () => {});
  const fake = fakeExecutor({ hold: true });
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const input = await source('pending.m4a');
  const pending = converter.prepare(input);
  const call = await fake.started;
  await converter.dispose();
  assert.equal(call.killed, 'SIGKILL');
  assert.deepEqual(await pending, { success: false, code: 'alacConversionFailed' });
  await assert.rejects(fs.stat(path.dirname(call.args[5])), { code: 'ENOENT' });
  await converter.dispose();
  assert.deepEqual(await converter.prepare(input), { success: false, code: 'playbackSourceUnavailable' });
});

test('dispose removes cached WAVs and prevents a pending probe from launching conversion', async t => {
  const fake = fakeExecutor();
  const { converter, source } = await setup(t, { executeFile: fake.executeFile });
  const input = await source('cached.m4a');
  const result = await converter.prepare(input);
  const pending = converter.prepare(input);
  await converter.dispose();
  assert.deepEqual(await pending, { success: false, code: 'playbackSourceUnavailable' });
  await assert.rejects(fs.stat(path.dirname(result.path)), { code: 'ENOENT' });
  assert.equal(fake.calls.length, 1);
});

function pcmWav(bitsPerSample) {
  const channels = 2;
  const sampleRate = 44100;
  const bytesPerSample = bitsPerSample / 8;
  const samples = Array.from({ length: 4096 }, (_, index) => {
    const max = 2 ** (bitsPerSample - 1) - 1;
    return [-max - 1, max, -1, 0, 1, (index * 7919) % max, -((index * 3571) % max)][index % 8];
  });
  const data = Buffer.alloc(samples.length * bytesPerSample);
  samples.forEach((sample, index) => data.writeIntLE(sample, index * bytesPerSample, bytesPerSample));
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function parsePcmWav(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format;
  let data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= bytes.length);
    if (type === 'fmt ') {
      const tag = bytes.readUInt16LE(start);
      assert.ok(tag === 1 || tag === 0xfffe);
      if (tag === 0xfffe) assert.equal(bytes.readUInt32LE(start + 24), 1);
      format = {
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14)
      };
    }
    if (type === 'data') data = bytes.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  assert.ok(format && data);
  const width = format.bitsPerSample / 8;
  const samples = Array.from({ length: data.length / width }, (_, index) => data.readIntLE(index * width, width));
  return { ...format, samples };
}

for (const bits of [16, 24]) {
  test(`real afconvert ALAC ${bits}-bit roundtrip preserves integer samples, rate and channels`, {
    skip: process.platform !== 'darwin', timeout: 30000
  }, async t => {
    const { root, converter, source } = await setup(t, { platform: process.platform });
    const original = pcmWav(bits);
    const input = await source(`pcm-${bits}.wav`, original);
    const encoded = path.join(root, `alac-${bits}.m4a`);
    await promisify(execFile)('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'alac', input, encoded], {
      timeout: 15000, killSignal: 'SIGKILL'
    });
    const result = await converter.prepare(encoded);
    assert.equal(result.success, true);
    assert.equal(result.converted, true);
    assert.deepEqual(parsePcmWav(await fs.readFile(result.path)), parsePcmWav(original));
  });
}
