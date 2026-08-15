import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createReferenceSession } from '../../../../tools/dsp-parity/node-host.mjs';

const nativeTestPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

function transitionState(session) {
  const state = session.inspectProcessorState();
  return {
    current: state.irPreDelayCurrent,
    target: state.irPreDelayTarget,
    step: state.irPreDelayStep,
    remaining: state.irPreDelayRemaining
  };
}

async function renderJsTrace(sampleRate, before, after) {
  const session = await createReferenceSession('IRReverbPlugin', {
    params: { pd: 0, dl: 0 },
    quiet: true
  });
  const trace = [];
  const processChunks = async chunks => {
    for (const frames of chunks) {
      await session.process(new Float32Array(frames), {
        sampleRate,
        frames,
        channels: 1,
        blockSize: frames
      });
      trace.push(transitionState(session));
    }
  };
  await processChunks([1]);
  session.plugin.setParameters({ pd: 10 });
  await processChunks(before);
  session.plugin.setParameters({ pd: 2 });
  await processChunks(after);
  return trace;
}

function renderNativeTrace(sampleRate, before, after) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-ir-automation-'));
  const tracePath = path.join(directory, 'trace.csv');
  try {
    const result = spawnSync(nativeTestPath, [
      '--automation-trace', tracePath,
      '--sample-rate', String(sampleRate),
      '--before', before.join(','),
      '--after', after.join(',')
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return fs.readFileSync(tracePath, 'utf8').trim().split(/\r?\n/).map(line => {
      const [current, target, step, remaining] = line.split(',').map(Number);
      return { current, target, step, remaining };
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function assertTraceEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} trace length`);
  for (let index = 0; index < actual.length; index++) {
    assert.equal(actual[index].remaining, expected[index].remaining,
      `${label} remaining at trace row ${index}`);
    for (const key of ['current', 'target', 'step']) {
      const scale = Math.max(1, Math.abs(expected[index][key]));
      assert.ok(Math.abs(actual[index][key] - expected[index][key]) <= scale * 1e-12,
        `${label} ${key} at trace row ${index}: ` +
          `${actual[index][key]} versus ${expected[index][key]}`);
    }
  }
}

test('IR Reverb production processor advances a retargetable five millisecond pre-delay', async () => {
  const session = await createReferenceSession('IRReverbPlugin', {
    params: { pd: 0, dl: 0 },
    quiet: true
  });
  const process = async (frames, events = []) => session.process(new Float32Array(frames), {
    sampleRate: 1000,
    frames,
    channels: 1,
    blockSize: frames,
    events
  });

  await process(1);
  await process(2, [{ frame: 0, params: { pd: 10 } }]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(session.inspectProcessorState())
      .filter(([key]) => key.startsWith('irPreDelay'))),
    {
      irPreDelayCurrent: 4,
      irPreDelayTarget: 10,
      irPreDelayStep: 2,
      irPreDelayRemaining: 3
    }
  );

  await process(1);
  assert.equal(session.inspectProcessorState().irPreDelayCurrent, 6);
  await process(2);
  const settled = session.inspectProcessorState();
  assert.equal(settled.irPreDelayCurrent, 10);
  assert.equal(settled.irPreDelayRemaining, 0);
});

if (nativeTestPath !== null) {
  test('IR Reverb JS and native pre-delay traces match for retargeted host partitions', async () => {
    for (const scenario of [
      { sampleRate: 1000, before: [2, 1], after: [1, 3, 1] },
      { sampleRate: 48000, before: [64, 13], after: [7, 128, 105] }
    ]) {
      const js = await renderJsTrace(scenario.sampleRate, scenario.before, scenario.after);
      const native = renderNativeTrace(
        scenario.sampleRate, scenario.before, scenario.after
      );
      assertTraceEqual(native, js, `${scenario.sampleRate} Hz`);
    }
  });
}
