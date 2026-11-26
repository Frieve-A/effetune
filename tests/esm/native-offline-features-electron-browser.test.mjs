import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {AudioEncoder} from '../../js/audio/audio-encoder.js';
import {launchNativeAudioFixture} from '../helpers/native-audio-electron.mjs';

const pipeline = [
  {name:'Analog Meter',enabled:true,parameters:{}},
  {name:'Volume',enabled:true,parameters:{vl:-6}}
];

async function openMenuItem(application,id) {
  await application.evaluate(({Menu},id) => {
    const item = Menu.getApplicationMenu().getMenuItemById(id);
    if (!item?.enabled) throw new Error('Application menu item unavailable: ' + id);
    item.click();
  },id);
}

test('Acoustic Measurement opens the current native pipeline from the desktop menu', {timeout:60000}, async t => {
  const fixture = await launchNativeAudioFixture(t,{pipeline});
  if (!fixture) return;
  const {application,page} = fixture;
  await openMenuItem(application,'settings.frequencyResponseMeasurement');
  await page.waitForURL('**/measurement/measurement.html');
  await page.locator('#newMeasurementBtn').click();
  await page.locator('#measureFrequencyResponseBtn').click();
  await page.locator('#effectPipeline').selectOption('current');
  assert.equal(await page.locator('#sampleRate').isDisabled(),true);
  assert.equal(await page.locator('#outputChannelCount').isDisabled(),true);
  assert.deepEqual(await page.evaluate(() => {
    const handoff = window.app.measurementController.pipelineHandoff;
    return [document.querySelector('#sampleRate').value,document.querySelector('#outputChannelCount').value,
      handoff.pluginNames,WebAssembly.validate(handoff.snapshot.dsp.bytes)];
  }),['48000','2',['Analog Meter','Volume'],true]);
  await page.locator('#back-button').click();
  await page.waitForURL('**/effetune.html');
  await page.waitForFunction(() => window.app?.initialized && window.audioManager.isDspReady());
  assert.deepEqual(await page.evaluate(() => window.audioManager.getCurrentPipeline().map(p => p.name)),
    ['Analog Meter','Volume']);
});

for (const format of ['wav','flac']) {
  test(`native file processing saves a decodable ${format.toUpperCase()} with the selected gain`, {timeout:60000}, async t => {
    const fixture = await launchNativeAudioFixture(t,{pipeline,
      config:{offlineOutput:{format,sampleRate:48000,wavSampleFormat:'pcm24',flacSampleFormat:'pcm24'}}});
    if (!fixture) return;
    const {application,page} = fixture;
    const exportDirectory = await realpath(await mkdtemp(path.join(os.tmpdir(),'effetune-export-')));
    t.after(() => rm(exportDirectory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
    const length = 24000, sampleRate = 48000;
    const channels = [.4,.2].map((amplitude,ch) => Float32Array.from({length},
      (_,i) => amplitude * Math.sin(2 * Math.PI * (ch + 1) * 1000 * i / sampleRate)));
    const input = await new AudioEncoder().encodeWav({numberOfChannels:2,sampleRate,length,
      getChannelData:ch => channels[ch]},'pcm24');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.file-drop-area .select-files').click();
    await (await chooser).setFiles({name:'stereo.wav',mimeType:'audio/wav',buffer:Buffer.from(await input.arrayBuffer())});
    const outputPath = path.join(exportDirectory,'stereo_effetuned.' + format);
    await application.evaluate(({dialog},savePath) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => {
        dialog.showSaveDialog = original;
        return {canceled:false,filePath:savePath};
      };
    },outputPath);
    await page.locator('.file-drop-area a.download-link').click();
    const deadline = Date.now() + 10000;
    while (!await stat(outputPath).catch(() => null) && Date.now() < deadline) await delay(50);
    const saved = await readFile(outputPath);
    assert.equal(saved.subarray(0,4).toString(),format === 'wav' ? 'RIFF':'fLaC');
    const decoded = await page.evaluate(async base64 => {
      const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
      const audio = await window.audioManager.audioContext.decodeAudioData(buffer);
      const rms = Array.from({length:audio.numberOfChannels}, (_,ch) => {
        const samples = audio.getChannelData(ch).subarray(4800,19200);
        return Math.sqrt(samples.reduce((sum,v) => sum + v*v,0) / samples.length);
      });
      return {sampleRate:audio.sampleRate,frames:audio.length,rms};
    },saved.toString('base64'));
    assert.equal(decoded.sampleRate,sampleRate);
    assert.ok(decoded.frames >= length);
    assert.equal(decoded.rms.length,2);
    decoded.rms.forEach((rms,ch) => {
      const gainDb = 20 * Math.log10(rms * Math.SQRT2 / [.4,.2][ch]);
      assert.ok(Math.abs(gainDb + 6) < .02,`Channel ${ch + 1} gain was ${gainDb} dB`);
    });
  });
}

test('Performance Benchmark reports measured throughput on the Native page', {timeout:120000}, async t => {
  const fixture = await launchNativeAudioFixture(t,{pipeline});
  if (!fixture) return;
  const {application,page} = fixture;
  // Playback uses the fixture's realtime null device. The benchmark supplies its own render clock.
  await application.evaluate(() => { delete process.env.EFFETUNE_AUDIO_ENGINE_NULL; });
  await openMenuItem(application,'settings.performanceBenchmark');
  const diagnostics = [];
  page.on('console',entry => {
    if (entry.type() === 'warning' || entry.type() === 'error') diagnostics.push(entry.text());
  });
  await page.waitForURL('**/features/effetune_bench.html');
  await page.locator('#dsp-mode').selectOption('native');
  assert.equal(await page.locator('#run-score').isEnabled(),true);
  // Limit this UI regression to one shipped workload. Keep the real plugin and timer.
  await page.evaluate(() => {
    const fetchAsset = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetchAsset(...args);
      if (!String(args[0]).endsWith('/plugins/plugins.txt')) return response;
      const lines = (await response.text()).split('\n');
      return new Response(lines.filter((line,index) => index <= lines.indexOf('[plugins]') ||
        line.startsWith('eq/room_eq:')).join('\n'));
    };
  });
  await page.locator('#run-benchmarks').click();
  const cells = page.locator('#benchmark-table-container tbody tr').getByRole('cell');
  await cells.first().waitFor({timeout:90000});
  const [,effect,implementation,samples,factor,,note] = await cells.allTextContents();
  assert.equal(effect,'Room EQ');
  assert.match(implementation,/^Native/);
  assert.ok(Number(samples.replaceAll(',','')) > 0 && Number(factor) > 0,
    `No benchmark result: ${note}. ${diagnostics.join('\n')}`);
});
