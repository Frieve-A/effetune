import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadProcessorPrototype() {
  const source = await fs.readFile(path.join(repoRoot, 'plugins', 'audio-processor.js'), 'utf8');
  const processors = new Map();
  const sandbox = {
    AudioWorkletProcessor: class {},
    registerProcessor: (name, ProcessorClass) => processors.set(name, ProcessorClass),
    sampleRate: 48000,
    currentTime: 0,
    currentFrame: 0,
    console
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'audio-processor.js' });
  const ProcessorClass = [...processors.values()].find(
    candidate => typeof candidate.prototype.isDisplayDspExecutionBypassed === 'function'
  );
  assert.ok(ProcessorClass);
  return ProcessorClass.prototype;
}

test('hidden-window display bypass keeps a Rhythm Analyzer whose metronome click is on', async () => {
  const prototype = await loadProcessorPrototype();
  const processor = Object.create(prototype);
  processor.powerPolicy = { displayDspBypassed: true };
  const rhythm = ck => ({ id: 1, type: 'RhythmAnalyzerPlugin', enabled: true, parameters: { ck } });

  assert.equal(processor.isDisplayDspExecutionBypassed(rhythm(false)), true);
  assert.equal(processor.isDisplayDspExecutionBypassed(rhythm(true)), false);

  processor.plugins = [rhythm(true)];
  assert.equal(processor.hasActiveDisplayDspExecutionBypass(), false);
  processor.plugins = [rhythm(false)];
  assert.equal(processor.hasActiveDisplayDspExecutionBypass(), true);
});
