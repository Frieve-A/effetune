import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const serial = process.env.ANDROID_SERIAL;
assert(sdk && serial, 'Set ANDROID_HOME and ANDROID_SERIAL for the API37 acceptance emulator.');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
let requests = 0;
const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'https://appassets.androidplatform.net');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.url !== '/pwa/v1/info' || request.headers.authorization !== 'Bearer fixture') {
        response.writeHead(401).end(); return;
    }
    requests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ hostId: 'android-lan-fixture', playerId: 'fixture-player',
        libraryId: 'fixture-library', name: 'Android LAN fixture', capabilities: { playback: true } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
    // 10.0.2.2 is a non-loopback peer from the emulator's network namespace.
    const url = `http://10.0.2.2:${server.address().port}`;
    await run(adb, ['-s', serial, 'shell', 'pm', 'revoke', 'com.frieve.effetune.development', 'android.permission.ACCESS_LOCAL_NETWORK'], { windowsHide: true });
    await run(adb, ['-s', serial, 'shell', 'pm', 'clear-permission-flags', 'com.frieve.effetune.development', 'android.permission.ACCESS_LOCAL_NETWORK', 'user-set', 'user-fixed'], { windowsHide: true });
    const result = await run(process.execPath, ['tools/android/test-device.mjs', '--class',
        'com.frieve.effetune.AndroidIntegrationRegressionTest#outboundLanPermissionIsIndependentOfRemoteServer', '--arg', `networkUrl=${url}`],
    { windowsHide: true, timeout: 310000, maxBuffer: 8 * 1024 * 1024 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    assert(requests > 0, 'The real peer did not receive the authenticated gateway request.');
} catch (error) {
    process.stdout.write(error.stdout || ''); process.stderr.write(error.stderr || '');
    throw error;
} finally { await new Promise(resolve => server.close(resolve)); }
