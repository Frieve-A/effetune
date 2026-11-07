const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { loadFreshModule, withModuleLoadStub, withPatchedProperty } = require('../helpers/cjs-module-utils.cjs');

function loadPreload(midiFilesEnabled = false) {
  const scripts = [];
  const ipcSends = [];
  const electron = {
    contextBridge: { executeInMainWorld(value) { scripts.push(value); } },
    ipcRenderer: {
      send: (...args) => ipcSends.push(args),
      sendSync: channel => channel === 'browser:midi-files-enabled' && midiFilesEnabled
    }
  };
  const document = { addEventListener() {} };
  withPatchedProperty(globalThis, 'ResizeObserver', class { observe() {} disconnect() {} }, () =>
    withPatchedProperty(globalThis, 'document', document, () =>
      withModuleLoadStub({ electron }, () => loadFreshModule('../../electron/browser-preload.js'))));
  return { script: scripts[0], scripts, ipcSends };
}

// Runs the serialized shim in a fresh context, as executeInMainWorld does.
function page(protocol = 'https:') {
  const { script, ipcSends } = loadPreload();
  const posts = [];
  class Navigator {}
  class Permissions {
    query(descriptor) { return Promise.resolve({ name: descriptor.name, state: 'prompt', receiver: this }); }
  }
  const navigator = new Navigator();
  navigator.permissions = new Permissions();
  const context = {
    location: { protocol }, navigator,
    performance: { now: () => 50 },
    EventTarget, DOMException, queueMicrotask
  };
  vm.runInNewContext(`(${script.func})(post)`, { ...context, post: value => posts.push(JSON.parse(JSON.stringify(value))) });
  assert.equal(script.args.length, 1);
  script.args[0]({ clear: true });
  assert.deepEqual(ipcSends, [['browser:midi', { clear: true }]]);
  return { navigator: context.navigator, posts };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('virtual Web MIDI exposes one connected EffeTune output and no inputs', async () => {
  const { navigator } = page();
  const access = await navigator.requestMIDIAccess();
  assert.equal(access.sysexEnabled, false);
  assert.equal((await navigator.requestMIDIAccess({ sysex: true })).sysexEnabled, true);
  assert.equal(access.inputs.size, 0);
  assert.equal(access.outputs.size, 1);
  assert.equal(access.onstatechange, null);
  assert.equal(typeof access.addEventListener, 'function');
  const [output] = access.outputs.values();
  assert.equal(access.outputs.get(output.id), output);
  assert.deepEqual([...access.outputs].map(([id]) => id), [output.id]);
  const visited = [];
  access.outputs.forEach((port, id, map) => visited.push([port, id, map]));
  assert.deepEqual(visited, [[output, output.id, access.outputs]]);
  assert.deepEqual([output.name, output.manufacturer, output.type, output.state, output.connection],
    ['EffeTune', 'EffeTune', 'output', 'connected', 'closed']);
  assert.equal(await output.open(), output);
  assert.equal(output.connection, 'open');
  await output.close();
  assert.equal(output.connection, 'closed');
  output.send([0x90, 60, 100]);
  assert.equal(output.connection, 'open');
});

test('MIDI permission queries report the virtual grant and other queries are unchanged', async () => {
  const { navigator } = page();
  assert.equal(navigator.permissions.query.name, 'query');
  for (const descriptor of [{ name: 'midi' }, { name: 'midi', sysex: true }]) {
    const status = await navigator.permissions.query(descriptor);
    assert.deepEqual([status.name, status.state, status.onchange], ['midi', 'granted', null]);
    status.onchange = () => {};
    status.addEventListener('change', () => {});
  }
  const other = await navigator.permissions.query({ name: 'camera' });
  assert.deepEqual([other.state, other.receiver], ['prompt', navigator.permissions]);
});

test('virtual MIDI output splits, validates, schedules and batches messages per task', async () => {
  const { navigator, posts } = page();
  const sysex = await navigator.requestMIDIAccess({ sysex: true });
  const [output] = (await navigator.requestMIDIAccess()).outputs.values();
  const [sysexOutput] = sysex.outputs.values();
  output.send(Uint8Array.of(0x90, 60, 100, 0xf8, 0xc0, 5, 0xf6, 0xf1, 3), 200);
  output.send([0x80, 60, 0], 10);
  sysexOutput.send([0xf0, 1, 0xfe, 2, 0xf7, 0xb0, 64, 0]);
  assert.deepEqual(posts, []);
  await flush();
  assert.deepEqual(posts, [[
    { data: [0x90, 60, 100], delay: 150 }, { data: [0xc0, 5], delay: 150 },
    { data: [0x80, 60, 0], delay: 0 },
    { data: [0xf0, 1, 2, 0xf7], delay: 0 }, { data: [0xb0, 64, 0], delay: 0 }
  ]]);
  for (const data of [[0x90, 60], [60, 100], [0x90, 60, 100, 61, 100], [0x90, 60, 0x80], [0x90, 256, 1], [0x90, -1, 1],
    [0xf7], [0xf4], [0xf9], [0xf0, 1], [0x90, 255.5, 1], 7, null]) {
    assert.throws(() => sysexOutput.send(data), { name: 'TypeError' }, JSON.stringify(data));
  }
  assert.throws(() => output.send([0x90, 60, 100], NaN), { name: 'TypeError' });
  assert.throws(() => output.send([0xf0, 1, 0xf7]), error => error.name === 'InvalidAccessError');
  output.send([0x90, 61, 100]);
  output.send([]);
  output.send(new Array(300).fill([0x90, 62, 100]).flat());
  await flush();
  assert.deepEqual(posts.slice(1).map(batch => batch.length), [256, 45]);
  output.send([0x90, 63, 100]);
  output.clear();
  await flush();
  assert.deepEqual(posts.at(-1), { clear: true });
  // WebIDL unsigned long conversion: fractions truncate, non-finite values become 0.
  output.send([0x90, 60.9, 99.5]);
  output.send([0x80, NaN, '1.5']);
  await flush();
  assert.deepEqual(posts.at(-1), [{ data: [0x90, 60, 99], delay: 0 }, { data: [0x80, 0, 1], delay: 0 }]);
});

test('virtual MIDI is installed only in HTTP, HTTPS and file pages', () => {
  assert.equal(typeof page('https:').navigator.requestMIDIAccess, 'function');
  assert.equal(typeof page('file:').navigator.requestMIDIAccess, 'function');
  assert.equal(page('about:').navigator.requestMIDIAccess, undefined);
});

test('MIDI file hook is installed only when enabled', () => {
  assert.equal(loadPreload().scripts.length, 2);
  const { scripts, ipcSends } = loadPreload(true);
  assert.equal(scripts.length, 3);
  scripts[1].args[0]({ bytes: Uint8Array.of(1), name: 'a.mid' });
  assert.deepEqual(ipcSends, [['browser:midi-file', { bytes: Uint8Array.of(1), name: 'a.mid' }]]);
});

test('MIDI file hook offers Standard MIDI File responses without changing them', async () => {
  const { scripts } = loadPreload(true);
  const midi = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
  const posts = [];
  const context = vm.createContext({ midi, URL, location: { protocol: 'https:' }, post: value => posts.push({ bytes: [...value.bytes], name: value.name }) });
  const run = code => vm.runInContext(code, context);
  run(`
    class FakeBlob {
      constructor(bytes) { this.data = Uint8Array.from(bytes); this.size = this.data.length; }
      slice(start, end) { return new FakeBlob(this.data.slice(start, end)); }
      async text() { return String.fromCharCode(...this.data); }
      async arrayBuffer() { return this.data.slice().buffer; }
    }
    class Response {
      constructor(bytes, url) { this.data = Uint8Array.from(bytes); this.url = url; }
      async arrayBuffer() { return this.data.slice().buffer; }
      async bytes() { return this.data.slice(); }
      async blob() { return new FakeBlob(this.data); }
    }
    class XMLHttpRequest {
      addEventListener(type, listener) { this.listener = listener; }
      send() { this.sent = true; return 'sent'; }
      load(responseType, response, responseText) {
        Object.assign(this, { responseType, response, responseText, responseURL: 'https://example.com/x/' + responseType + '.mid' });
        this.listener.call(this);
      }
    }
    Object.assign(globalThis, { FakeBlob, Response, XMLHttpRequest });
  `);
  run(`(${scripts[1].func})(post)`);
  const buffer = await run(`new Response(midi, 'https://example.com/a/My%20Song.mid?x=1').arrayBuffer()`);
  assert.deepEqual([...new Uint8Array(buffer)], midi);
  await run(`new Response(midi, 'https://example.com/play.php').bytes()`);
  const blob = await run(`new Response(midi, 'https://example.com/b.mid').blob()`);
  assert.equal(blob.size, midi.length);
  await run(`new Response([1, ...midi.slice(1)], 'https://example.com/bad.mid').arrayBuffer()`);
  await run(`new Response(midi.slice(0, 13), 'https://example.com/short.mid').arrayBuffer()`);
  await run(`new Response([], 'https://example.com/empty').blob()`);
  const xhr = (type, response, text) => run(`(() => {
    const request = new XMLHttpRequest();
    const result = request.send();
    request.load(${JSON.stringify(type)}, ${response}, ${JSON.stringify(text ?? '')});
    return result;
  })()`);
  assert.equal(xhr('arraybuffer', 'Uint8Array.from(midi).buffer'), 'sent');
  xhr('blob', 'new FakeBlob(midi)');
  xhr('', 'null', String.fromCharCode(...midi.slice(0, 8), 0xf700, ...midi.slice(9)));
  xhr('text', 'null', 'MThd broken � text');
  xhr('json', '{}');
  await flush(); await flush();
  assert.deepEqual(posts.map(post => post.name).sort(), ['.mid', 'My Song.mid', 'arraybuffer.mid', 'b.mid', 'blob.mid', 'play.php']);
  assert.ok(posts.every(post => post.bytes.length === midi.length && post.bytes.every((byte, index) => byte === midi[index])));
});
