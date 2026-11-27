import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import {builtExecutableDirectory, executableNames, requireExecutableEnv} from '../../tools/audio-engine-session.mjs';

export async function waitForNativeObservation(read, matches, {
  timeout = 8000, polling = 80, description = 'Native audio observation'
} = {}) {
  const deadline = performance.now() + timeout;
  let observation;
  // Playwright's waitForFunction checks the predicate result before awaiting it.
  do {
    observation = await read();
    if (matches(observation)) return observation;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(polling,remaining));
  } while (performance.now() < deadline);
  assert.fail(`${description} timed out. Last observation: ${JSON.stringify(observation)}`);
}

export async function launchNativeAudioFixture(t, {pipeline = [], config = {}, preferences = {}} = {}) {
  const binaries = Object.values(executableNames(process.platform,process.arch)).filter(Boolean);
  if (binaries.some(name => !existsSync(path.join(builtExecutableDirectory(),name)))) {
    const reason = 'Build the native audio driver before running this test.';
    if (process.env[requireExecutableEnv] === '1') assert.fail(reason);
    t.skip(reason);
    return null;
  }
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(),'effetune-native-audio-')));
  let application;
  t.after(async () => {
    try { await application?.close(); }
    finally { await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  });
  await Promise.all([
    writeFile(path.join(profile,'config.json'),JSON.stringify({
      language:'en',onboardingTourShown:true,checkForUpdatesOnStartup:false,...config
    })),
    writeFile(path.join(profile,'audio-preferences.json'),JSON.stringify({
      audioDriver:process.platform === 'win32' ? 'wasapi' : 'miniaudio',
      inputDeviceId:'__effetune_no_audio_input__',outputDeviceId:'default',sampleRate:48000,
      useWasmDsp:true,...preferences
    })),
    writeFile(path.join(profile,'pipeline-state.json'),JSON.stringify(pipeline))
  ]);
  const main = fileURLToPath(new URL('./desktop-browser-electron-main.cjs',import.meta.url));
  application = await electron.launch({args:[main,`--user-data-dir=${profile}`],
    env:{...process.env,EFFETUNE_AUDIO_ENGINE_NULL:'1',EFFETUNE_BROWSER_TEST_NATIVE_INPUT:'0'}});
  const isMain = win => win.url().includes('effetune.html');
  let page;
  for (let i = 0; i < 300 && !page; ++i) {
    page = application.windows().find(isMain);
    if (!page) await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.ok(page,'EffeTune main window must open');
  await page.waitForFunction(() => window.app?.initialized &&
    (window.audioManager.isDspReady() || window.audioManager.failed),null,{timeout:30000});
  const startupError = await page.evaluate(() => {
    const manager = window.audioManager;
    return manager.isDspReady() ? null : manager.engineLifetime.signal.reason?.message || manager.outputErrorKey;
  });
  assert.equal(startupError,null,'Native audio fixture startup failed: ' + startupError);
  return {application,page,profile};
}
