import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const serial = process.env.ANDROID_SERIAL;
assert(sdk && serial, 'Set ANDROID_HOME and ANDROID_SERIAL for the installed acceptance APKs.');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const args = ['-s', serial, 'shell', 'am', 'instrument', '-w'];
for (let index = 2; index < process.argv.length; index++) {
    const option = process.argv[index];
    const value = process.argv[++index];
    if (option === '--class' && value) args.push('-e', 'class', value);
    else if (option === '--arg' && value && value.includes('=')) {
        const separator = value.indexOf('=');
        args.push('-e', value.slice(0, separator), value.slice(separator + 1));
    } else throw new Error('Use --class <test class> or --arg <name=value>.');
}
args.push('com.frieve.effetune.development.test/androidx.test.runner.AndroidJUnitRunner');
const run = promisify(execFile);
let output = '';
try {
    const result = await run(adb, args, { windowsHide: true, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
    output = result.stdout + result.stderr;
    // Android's am instrument can exit successfully even when JUnit failed.
    assert(/^OK \(\d+ tests?\)\s*$/m.test(output)
        && !/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed/.test(output), 'Android instrumentation failed.');
} catch (error) {
    output ||= (error.stdout || '') + (error.stderr || '');
    if (error.killed) {
        await run(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'com.frieve.effetune.development'],
            { windowsHide: true, timeout: 15000 }).catch(() => {});
    }
    process.exitCode = 1;
    console.error(error.message);
} finally {
    const directory = path.join('out/android/acceptance', serial.replace(/[^a-zA-Z0-9_-]/g, '_'));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `instrumentation-${Date.now()}.log`), output);
    console.log(output);
}
