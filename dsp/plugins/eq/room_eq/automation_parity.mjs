import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { defaultParamsFromSchema } from '../../../../tools/dsp-parity/cases.mjs';
import { createReferenceSession } from '../../../../tools/dsp-parity/node-host.mjs';
import { runNativeCase } from '../../../../tools/dsp-parity/runners.mjs';
import { generateStimulus } from '../../../../tools/dsp-parity/stimuli.mjs';
import { compareAudio, formatComparison } from '../../../../tools/dsp-parity/tolerance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const runnerPath = process.argv[2];
if (!runnerPath) throw new Error('native runner path is required');

const schema = JSON.parse(fs.readFileSync(
  new URL('./params.json', import.meta.url), 'utf8'
));
const testCase = {
  id: 'paired-dry-channel-delay',
  stimulus: 'imp',
  sampleRate: 48000,
  frames: 1024,
  channels: 2,
  channelMode: 'stereo',
  channel: null,
  blockSize: 64,
  caseIndex: 9071,
  seed: 0x726f6f6dn,
  params: { ...defaultParamsFromSchema(schema), lt: '0', fd: 0, dy: 0, gn: 0 },
  events: [
    { frame: 128, params: { dy: 37 } },
    { frame: 512, params: { dy: 11, gn: -3 } }
  ],
  asset: null
};
const input = generateStimulus({
  id: testCase.stimulus,
  sampleRate: testCase.sampleRate,
  frames: testCase.frames,
  channels: testCase.channels,
  caseIndex: testCase.caseIndex,
  seed: testCase.seed
});
const session = await createReferenceSession(schema.type, {
  repoRoot,
  params: testCase.params,
  caseIndex: testCase.caseIndex,
  seed: testCase.seed
});
const reference = await session.process(input, testCase);
const native = await runNativeCase({
  type: schema.type,
  testCase,
  input,
  schema,
  runnerPath: path.resolve(runnerPath),
  repoRoot,
  allocations: false
});
const comparison = compareAudio(reference, native, schema.tolerance, {
  channels: testCase.channels,
  frames: testCase.frames
});
console.log(
  `${comparison.pass ? 'PASS' : 'FAIL'} ${schema.type}/${testCase.id}: ` +
  formatComparison(comparison)
);
if (!comparison.pass) process.exitCode = 1;
