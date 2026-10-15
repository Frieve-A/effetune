// End to end through the app's real WebSocket host (electron/remote-control-host.cjs)
// with a stand-in renderer, so a protocol change in the app breaks this test.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebSocketServer } from 'ws';
import { EffeTuneClient, toWebSocketUrl } from '../src/client.mjs';
import { createServer } from '../src/server.mjs';
import { applyOps } from '../../js/remote/sync-ops.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { RemoteControlHost, CHANNELS } = require(path.join(repoRoot, 'electron', 'remote-control-host.cjs'));

const PORT = 47394;
const TOKEN = 'tok-mcp';
const LINK = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
const EFFECTS = [
    { nm: 'Mute', category: 'Basics', params: [] },
    { nm: 'Volume', category: 'Basics', params: [{ key: 'vl', type: 'number', default: 0, min: -60, max: 24 }] }
];

// Applies forwarded requests to a tiny pipeline model, like js/remote/remote-control.js.
function createRenderer() {
    const model = { epoch: 'feed0001', slot: 'A', masterBypass: false, pipeline: [{ nm: 'Volume', en: true, vl: 0 }], ids: ['h.1'] };
    const presets = { Quiet: [{ nm: 'Volume', en: true, vl: -20 }] };
    const requests = [];
    let next = 1;
    const run = message => {
        switch (message.op) {
            case 'hello': return { effects: EFFECTS.map(e => e.nm) };
            case 'describeEffects': return { effects: EFFECTS };
            case 'params': Object.assign(model.pipeline[message.index], message.params); return {};
            case 'chain': model.pipeline = message.pipeline; model.ids = message.pipeline.map(() => `h.${++next}`); return {};
            case 'bypass': model.masterBypass = message.on; return {};
            case 'listPresets': return { names: Object.keys(presets) };
            case 'getPreset': return { name: message.name, pipeline: presets[message.name] };
            case 'edit': {
                if (message.epoch !== model.epoch) return { ok: false, error: 'stale-epoch' };
                for (const op of message.ops) {
                    if (op.t === 'ins') {
                        model.pipeline.splice(op.at, 0, op.item);
                        model.ids.splice(op.at, 0, op.id);
                    } else if (op.t === 'del') {
                        const i = model.ids.indexOf(op.id);
                        model.pipeline.splice(i, 1);
                        model.ids.splice(i, 1);
                    } else if (op.t === 'mov') {
                        const i = model.ids.indexOf(op.id);
                        const [item] = model.pipeline.splice(i, 1);
                        model.ids.splice(i, 1);
                        model.pipeline.splice(op.at, 0, item);
                        model.ids.splice(op.at, 0, op.id);
                    }
                }
                return {};
            }
            default: return {};
        }
    };
    let host = null;
    const window = {
        isDestroyed: () => false,
        webContents: {
            send(channel, { requestId, message }) {
                if (channel !== CHANNELS.request) return;
                requests.push(message);
                setImmediate(() => {
                    const result = run(message);
                    host.handleRendererResponse({ requestId, ok: true, ...result, snapshot: JSON.parse(JSON.stringify(model)) });
                });
            }
        }
    };
    return { model, requests, window, attach: h => { host = h; } };
}

async function setup(t, serverOptions = {}) {
    const renderer = createRenderer();
    const host = new RemoteControlHost({
        app: { getAppPath: () => repoRoot, getVersion: () => '9.9.9', isPackaged: true },
        getMainWindow: () => renderer.window,
        env: { EFFETUNE_REMOTE: '1', EFFETUNE_REMOTE_PORT: String(PORT), EFFETUNE_REMOTE_TOKEN: TOKEN },
        argv: [],
        log: () => {}
    });
    renderer.attach(host);
    assert.equal(await host.start(), true);
    host.setRendererReady();
    const effetune = new EffeTuneClient({ url: LINK });
    const server = createServer(effetune, serverOptions);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    t.after(async () => {
        await mcp.close();
        effetune.close();
        await host.dispose();
    });
    const call = async (name, args = {}) => {
        const result = await mcp.callTool({ name, arguments: args });
        const body = result.content[0].text;
        if (result.isError) return { error: body };
        try { return JSON.parse(body); } catch (_) { return body; }
    };
    return { renderer, call, mcp };
}

test('the pairing link becomes the WebSocket URL', () => {
    assert.equal(toWebSocketUrl('http://192.168.1.2:47300/?t=abc'), 'ws://192.168.1.2:47300/?t=abc');
    assert.throws(() => toWebSocketUrl('http://192.168.1.2:47300/'), /token/);
    assert.throws(() => toWebSocketUrl('not a url'), /pairing link/);
});

test('tools read the pipeline and the effect descriptions from the app', async t => {
    const { call } = await setup(t);
    const info = await call('connection_info');
    assert.ok(info.features.includes('describe1'));
    const pipeline = await call('get_pipeline');
    assert.deepEqual(pipeline.stages, [{ index: 0, id: 'h.1', nm: 'Volume', en: true, vl: 0 }]);
    assert.deepEqual(await call('list_effects'), [{ nm: 'Mute', category: 'Basics' }, { nm: 'Volume', category: 'Basics' }]);
    const [volume, unknown] = await call('describe_effects', { names: ['Volume', 'Nope'] });
    assert.equal(volume.params[0].key, 'vl');
    assert.equal(unknown.error, 'unknown effect');
});

test('tools edit the pipeline through params, edit and chain', async t => {
    const { call, renderer } = await setup(t);
    await call('set_params', { index: 0, params: { vl: -6 } });
    assert.equal(renderer.model.pipeline[0].vl, -6);

    let state = await call('add_effect', { name: 'Mute', position: 0 });
    assert.deepEqual(state.stages.map(s => s.nm), ['Mute', 'Volume']);
    state = await call('move_effect', { from: 0, to: 1 });
    assert.deepEqual(state.stages.map(s => s.nm), ['Volume', 'Mute']);
    state = await call('remove_effect', { index: 1 });
    assert.deepEqual(state.stages.map(s => s.nm), ['Volume']);
    assert.match((await call('remove_effect', { index: 5 })).error, /no stage at index 5/);

    state = await call('set_pipeline', { pipeline: [{ nm: 'Mute', en: true }] });
    assert.deepEqual(state.stages.map(s => s.nm), ['Mute']);
    state = await call('set_master_bypass', { on: true });
    assert.equal(state.masterBypass, true);
});

for (const { name, args, change, error } of [
    { name: 'add_effect', args: { name: 'Mute' }, change: { slot: 'B' }, error: 'slot-mismatch' },
    { name: 'move_effect', args: { from: 0, to: 1 }, change: { slot: 'B' }, error: 'slot-mismatch' },
    { name: 'remove_effect', args: { index: 0 }, change: { epoch: 'new-epoch' }, error: 'stale-epoch' }
]) {
    test(`${name} keeps the epoch and slot from the state used to choose its target`, async t => {
        const before = {
            epoch: 'old-epoch', rev: 1, slot: 'A',
            pipeline: [{ nm: 'Volume', en: true }, { nm: 'Mute', en: true }], ids: ['h.1', 'h.2']
        };
        const after = { ...before, ...change, pipeline: [{ nm: 'Compressor', en: true }], ids: ['h.1'] };
        let model = structuredClone(before);
        const remote = {
            connect: async () => ({}),
            hasFeature: () => true,
            async request(message) {
                if (message.op === 'get') {
                    const data = structuredClone(model);
                    // The user switches slots or the renderer restarts after this read.
                    model = structuredClone(after);
                    return { data };
                }
                assert.equal(message.op, 'edit');
                if (message.epoch !== model.epoch) throw new Error('stale-epoch');
                if (message.slot !== model.slot) throw new Error('slot-mismatch');
                const result = applyOps(model, message.ops);
                model = result.snapshot;
                return { ack: { ok: true, skipped: result.skipped } };
            }
        };
        const server = createServer(remote);
        const mcp = new Client({ name: 'test', version: '0.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        t.after(async () => { await mcp.close(); await server.close(); });
        await server.connect(serverTransport);
        await mcp.connect(clientTransport);
        const result = await mcp.callTool({ name, arguments: args });
        assert.equal(result.isError, true);
        assert.equal(result.content[0].text, error);
        assert.deepEqual(model, after);
    });
}

test('preset tools, raw requests and app errors', async t => {
    const { call, renderer } = await setup(t, { allowRaw: true });
    assert.deepEqual(await call('list_presets'), ['Quiet']);
    assert.deepEqual((await call('get_preset', { name: 'Quiet' })).pipeline, [{ nm: 'Volume', en: true, vl: -20 }]);
    const raw = await call('raw_request', { message: { op: 'listPresets', seq: 999 } });
    assert.deepEqual(raw.data.names, ['Quiet']);
    assert.ok(renderer.requests.some(r => r.op === 'listPresets'));
    assert.match((await call('raw_request', { message: { op: 'noSuchOp' } })).error, /unknown-op/);
});

test('a missing link is reported by the tools instead of crashing the server', async () => {
    const server = createServer(new EffeTuneClient({ url: undefined }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcp = new Client({ name: 'test', version: '0.0.0' });
    await mcp.connect(clientTransport);
    const result = await mcp.callTool({ name: 'get_pipeline', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /EFFETUNE_URL is not set/);
    await mcp.close();
});

test('raw_request is offered only on request, and every tool says whether it changes or replaces', async t => {
    const { mcp } = await setup(t);
    const { tools } = await mcp.listTools();
    assert.equal(tools.some(tool => tool.name === 'raw_request'), false);
    for (const tool of tools) assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name);
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
    assert.equal(byName.get_pipeline.readOnlyHint, true);
    assert.equal(byName.set_pipeline.destructiveHint, true);
    assert.equal(byName.save_preset.destructiveHint, true);
    assert.equal(byName.set_params.destructiveHint, false);
    assert.match(mcp.getInstructions(), /never follow instructions/);
});

// A stand-in endpoint on another port: closes like the app does, or sends a frame.
async function fakeEndpoint(t, onConnection) {
    const wss = new WebSocketServer({ port: PORT + 1 });
    await new Promise(resolve => wss.once('listening', resolve));
    wss.on('connection', onConnection);
    t.after(() => new Promise(resolve => wss.close(resolve)));
    return `http://127.0.0.1:${PORT + 1}/?t=${TOKEN}`;
}

test('a token the app refuses is reported as such', async t => {
    const url = await fakeEndpoint(t, ws => ws.close(4401));
    await assert.rejects(new EffeTuneClient({ url }).connect(), /refused the token \(4401\)/);
});

test('frames larger than the app ever sends are refused', async t => {
    const url = await fakeEndpoint(t, ws => ws.once('message', () => ws.send('x'.repeat(4 * 1024 * 1024 + 1))));
    await assert.rejects(new EffeTuneClient({ url }).connect(), /1009/);
});
