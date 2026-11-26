import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const serial = process.env.ANDROID_SERIAL;
assert(sdk && serial, 'Set ANDROID_HOME and ANDROID_SERIAL for the installed acceptance APKs.');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const args = ['shell', 'am', 'instrument', '-w'];
let recordWebView, matchWebView;
for (let index = 2; index < process.argv.length; index++) {
    const option = process.argv[index];
    const value = process.argv[++index];
    if (option === '--class' && value) args.push('-e', 'class', value);
    else if (option === '--arg' && value && value.includes('=')) {
        const separator = value.indexOf('=');
        args.push('-e', value.slice(0, separator), value.slice(separator + 1));
    } else if (option === '--record-webview' && value) recordWebView = value;
    else if (option === '--match-webview' && value) matchWebView = value;
    else throw new Error('Use --class <test class>, --arg <name=value>, --record-webview <file> or --match-webview <file>.');
}
args.push('com.frieve.effetune.development.test/androidx.test.runner.AndroidJUnitRunner');
const run = promisify(execFile);
const directory = path.join('out/android/acceptance', serial.replace(/[^a-zA-Z0-9_-]/g, '_'));
const device = (command, options) => run(adb, ['-s', serial, ...command], { windowsHide: true, timeout: 5000, ...options });

if (recordWebView || matchWebView) {
    assert(!(recordWebView && matchWebView), 'Record or match a WebView, one at a time.');
    const expected = matchWebView && JSON.parse(await readFile(matchWebView, 'utf8')).provider;
    if (matchWebView) assert(expected, 'The WebView reference does not identify a current provider.');
    const { stdout: properties } = await device(['shell', 'getprop ro.build.version.sdk; getprop ro.build.fingerprint']);
    const [api, fingerprint] = properties.trim().split(/\r?\n/);
    assert(/^\d+$/.test(api) && fingerprint, 'The emulator did not report its Android API and build fingerprint.');
    const deadline = performance.now() + 60_000;
    let provider;
    do {
        const { stdout } = await device(['shell', 'dumpsys', 'webviewupdate']);
        // The preferred provider can advance before the system actually switches.
        provider = stdout.match(/^\s*Current WebView package \(name, version\): \(([^,]+, [^)]+)\)/m)?.[1] ?? null;
        if (provider && (!expected || provider === expected)) break;
        await delay(1000);
    } while (performance.now() < deadline);
    const report = recordWebView || path.join(directory, `webview-api${api}.json`);
    await mkdir(path.dirname(report), { recursive: true });
    await writeFile(report, `${JSON.stringify({ api, fingerprint, provider }, null, 2)}\n`);
    console.log(`Android API ${api}, build ${fingerprint}, current WebView: ${provider ?? 'none'}`);
    assert(provider && (!expected || provider === expected), `The emulator did not select the expected WebView${expected ? ` (${expected})` : ''}.`);
}

const emulator = /^emulator-\d+$/.test(serial);
const started = emulator && await device(['shell', 'date', '+%s']).then(({ stdout }) => stdout.trim(), () => '');
const session = Date.now();
let output = '';
try {
    const result = await device(args, { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
    output = result.stdout + result.stderr;
    // Android's am instrument can exit successfully even when JUnit failed.
    assert(/^OK \(\d+ tests?\)\s*$/m.test(output)
        && !/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed/.test(output), 'Android instrumentation failed.');
} catch (error) {
    output ||= (error.stdout || '') + (error.stderr || '');
    process.exitCode = 1;
    console.error(error.message);
    if (/^\d+$/.test(started)) {
        try {
            // Restrict collection to device diagnostics and omit the application console.
            const { stdout } = await device(['logcat', '-s', '-d', '-t', `${started}.000`,
                'WebViewFactory:I', 'chromium:W', 'AndroidRuntime:E', 'ActivityManager:W', 'AAudio:W', 'AudioTrack:W'],
            { maxBuffer: 1024 * 1024 });
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, `logcat-${session}.log`), stdout);
        } catch {
            console.warn('Could not retain the test session Logcat.');
        }
    } else if (emulator) console.warn('Could not determine the device time for the test session Logcat.');
    if (error.killed) {
        await device(['shell', 'am', 'force-stop', 'com.frieve.effetune.development'], { timeout: 15000 }).catch(() => {});
    }
} finally {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `instrumentation-${session}.log`), output);
    console.log(output);
}
