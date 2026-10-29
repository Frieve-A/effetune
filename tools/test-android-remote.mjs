import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EffeTuneClient } from '../mcp/src/client.mjs';
const instrument = process.argv.includes('--instrument');
const run = promisify(execFile);
let url = process.argv.slice(2).find(value => !value.startsWith('--')) || 'http://127.0.0.1:47319/?t=android-contract-test';
let child, completed, adb, forward;
const serial = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
if (instrument) {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error('Set ANDROID_HOME to the SDK used for the installed test APK.');
    adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    const { stdout } = await run(adb, [...serial, 'forward', 'tcp:0', 'tcp:47319'], { windowsHide: true });
    forward = `tcp:${stdout.trim()}`;
    url = `http://127.0.0.1:${stdout.trim()}/?t=android-contract-test`;
    child = spawn(adb, [...serial, 'shell', 'am', 'instrument', '-w', '-e', 'pairedMcp', 'true', '-e', 'class',
        'com.frieve.effetune.AndroidMcpEndpointTest', 'com.frieve.effetune.development.test/androidx.test.runner.AndroidJUnitRunner'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data.toString()).slice(-32768); });
    completed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => code === 0 && /OK \(1 test\)/.test(output) ? resolve() : reject(new Error(`Android MCP instrumentation failed: ${output}`)));
    });
    completed.catch(() => {});
}
const client = new EffeTuneClient({ url, requestTimeoutMs: 5000 });
let before;
try {
    const deadline = Date.now() + 45000;
    for (;;) {
        try { await client.connect(); break; }
        catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.equal(client.hasFeature('music1'), true);
    assert.equal(client.hasFeature('savePreset'), false);
    before = (await client.send({ op: 'get' })).data;
    assert.ok(before.effects.includes('Volume'));
    await client.send({ op: 'chain', pipeline: [{ nm: 'Volume', en: true, vl: -6 }] });
    let state = (await client.send({ op: 'get' })).data;
    assert.equal(state.pipeline[0].vl, -6);
    await client.send({ op: 'params', index: 0, params: { vl: -9 } });
    state = (await client.send({ op: 'get' })).data; assert.equal(state.pipeline[0].vl, -9);
    await client.send({ op: 'history', dir: 'undo' });
    state = (await client.send({ op: 'get' })).data; assert.equal(state.pipeline[0].vl, -6);
    await client.send({ op: 'history', dir: 'redo' });
    state = (await client.send({ op: 'get' })).data; assert.equal(state.pipeline[0].vl, -9);
    await client.send({ op: 'bypass', on: true });
    assert.equal((await client.send({ op: 'get' })).data.masterBypass, true);
    const playback = (await client.send({ op: 'getPlayback', playerId: 'local' })).data;
    assert.equal(playback.ok, true); assert.equal(playback.result.playerId, 'local');
    const devices = (await client.send({ op: 'listMusicDevices' })).data;
    assert.equal(devices.result.libraries[0].available, false);
    await assert.rejects(client.send({ op: 'listPresets' }), /renderer-unavailable/);
    console.log('Existing MCP client: Android native get/chain/params/bypass/undo/redo/music state and renderer-unavailable passed.');
} finally {
    try {
        if (client.isOpen()) {
            try {
                if (before) {
                    await client.send({ op: 'chain', pipeline: before.pipeline });
                    await client.send({ op: 'bypass', on: before.masterBypass });
                }
            } finally { await client.send({ op: 'testFinish' }).catch(() => {}); }
        }
    } finally {
        client.close();
        if (instrument) {
            let timer;
            try { await Promise.race([completed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Android MCP instrumentation cleanup timed out')), 65000); })]); }
            finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); await run(adb, [...serial, 'forward', '--remove', forward], { windowsHide: true }); }
        }
    }
}
