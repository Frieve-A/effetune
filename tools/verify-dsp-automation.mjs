import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runAutomationEventParity } from './dsp-parity/automation-events.mjs';
import { isMain } from './dsp-parity/cli.mjs';
import { defaultNativeRunnerPath } from './dsp-parity/runners.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function usage() {
  return [
    'Usage: node tools/verify-dsp-automation.mjs --allocation-runner <debug-runner> [options]',
    '  --native-runner <file>     native parity runner for direct output checks',
    '  --allocation-runner <file> Debug native parity runner for the guarded dense sweep',
    '  --ir-native-test <file>    IR Reverb native test executable',
    '  --help                     show this help'
  ].join('\n');
}

export function parseVerificationArguments(argv = process.argv.slice(2), env = process.env) {
  const value = name => {
    const index = argv.indexOf(name);
    if (index < 0) return null;
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error(`${name} requires a file path`);
    }
    return argv[index + 1];
  };
  if (argv.includes('--help')) return { help: true };
  const allocationRunner = value('--allocation-runner') ??
    env.EFFETUNE_DSP_ALLOCATION_RUNNER ?? null;
  if (!allocationRunner) {
    throw new Error(
      '--allocation-runner is required and must name a Debug native parity runner'
    );
  }
  return {
    help: false,
    nativeRunner: value('--native-runner') ?? env.EFFETUNE_DSP_NATIVE_RUNNER ?? null,
    allocationRunner,
    irNativeTest: value('--ir-native-test')
  };
}

export function guardedParityOptions(allocationRunnerPath) {
  return { runnerPath: allocationRunnerPath, allocations: true };
}

function requireFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${description} is unavailable at ${filePath}. Build native DSP tests first.`);
  }
}

function run(name, script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed`);
  }
}

function nativeTestExecutable(runnerPath, name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return path.join(path.dirname(runnerPath), `${name}${suffix}`);
}

export async function main(argv = process.argv.slice(2), env = process.env, io = console) {
  const args = parseVerificationArguments(argv, env);
  if (args.help) {
    io.log(usage());
    return;
  }
  const runnerPath = path.resolve(
    repoRoot,
    args.nativeRunner ?? defaultNativeRunnerPath(repoRoot)
  );
  const allocationRunnerPath = path.resolve(
    repoRoot,
    args.allocationRunner
  );
  const irNativeTest = path.resolve(
    repoRoot,
    args.irNativeTest ??
      nativeTestExecutable(runnerPath, 'effetune_dsp_ir_reverb_tests')
  );
  requireFile(runnerPath, 'Native DSP parity runner');
  requireFile(allocationRunnerPath, 'Debug native DSP parity runner');
  requireFile(irNativeTest, 'IR Reverb native test runner');

  run('Generated DSP parameter freshness', 'scripts/gen-dsp-params.mjs', ['--check']);
  run('Automation catalog contracts', 'tests/esm/dsp-automation-catalog.test.mjs');
  run('Mixed automation partition contracts', 'tools/dsp-parity/automation-mixed.test.mjs');
  await runAutomationEventParity(guardedParityOptions(allocationRunnerPath));
  run('Room EQ direct automation parity',
    'dsp/plugins/eq/room_eq/automation_parity.mjs', [runnerPath]);
  run('IR Reverb direct automation trace parity',
    'dsp/plugins/reverb/ir_reverb/automation_test.mjs', [irNativeTest]);
  io.log('DSP automation verification passed.');
}

if (isMain(import.meta.url)) {
  main().catch(error => {
    console.error(`DSP automation verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
