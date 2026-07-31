import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pythonRoot = path.join(repoRoot, 'dsp', 'bindings', 'python', 'src');
const generatedJsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'src', 'generated-effects.js'
);
const jsBasePath = path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'effect.js');
const jsIndexDeclarationsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'src', 'index.d.ts'
);
const jsWorkletDeclarationsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'src', 'worklet.d.ts'
);

test('JavaScript declarations expose only supported construction and guards', () => {
  const indexDeclarations = fs.readFileSync(jsIndexDeclarationsPath, 'utf8');
  const workletDeclarations = fs.readFileSync(jsWorkletDeclarationsPath, 'utf8');

  assert.match(
    indexDeclarations,
    /export declare class Chain \{\s+private constructor\(\);/
  );
  assert.match(
    workletDeclarations,
    /export declare class EffeTuneNode extends AudioWorkletNode \{\s+private constructor\(\);/
  );
  assert.match(
    indexDeclarations,
    /export declare function isBundleDocument\(input: unknown\): boolean;/
  );
  assert.doesNotMatch(
    indexDeclarations,
    /isBundleDocument\(input: unknown\): input is BundleDocument/
  );
});

test('generated Python classes import through the real package runtime', t => {
  const script = [
    'from effetune import AssetError, IRReverb, Volume',
    'from effetune._generated_effects import EFFECT_METADATA, _EFFECT_IMPLEMENTATION',
    'volume = Volume(channel="78")',
    'assert volume.channel == "78"',
    'try:',
    '    Volume(channel="unknown")',
    'except ValueError:',
    '    pass',
    'else:',
    '    raise AssertionError("unknown channels must be rejected")',
    'assert "implementation" not in EFFECT_METADATA["effects"][0]',
    'dsd = next(effect for effect in EFFECT_METADATA["effects"] if effect["type"] == "DSD64IMDSimulator")',
    'assert dsd["minimumSampleRate"] == 88200',
    'assert dsd["effectiveDelaySamples"] == 63',
    'assert dsd["latency"] == {"kind": "zero"}',
    'assert _EFFECT_IMPLEMENTATION["Volume"]["internalType"] == "VolumePlugin"',
    'try:',
    '    IRReverb()',
    'except AssetError:',
    '    pass',
    'else:',
    '    raise AssertionError("IRReverb without assets must fail at the public asset boundary")',
    'ir = IRReverb(assets={"impulseResponse": "room"})',
    'assert ir.assets == {"impulseResponse": "room"}'
  ].join('\n');
  const result = spawnSync('python', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: pythonRoot
    }
  });
  if (result.error?.code === 'ENOENT') {
    t.skip('Python is not available');
    return;
  }
  if (result.status !== 0 &&
      /ModuleNotFoundError: No module named ['"]numpy['"]/.test(result.stderr)) {
    t.skip('NumPy is not available');
    return;
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('generated JavaScript classes import through the real runtime', async t => {
  if (!fs.existsSync(jsBasePath)) {
    t.skip('JavaScript runtime worker has not produced effect.js yet');
    return;
  }
  const generated = await import(`${pathToFileURL(generatedJsPath).href}?smoke=1`);
  const volume = new generated.Volume({ channel: '78' });
  assert.equal(volume.channel, '78');
  assert.throws(() => new generated.Volume({ channel: 'unknown' }), /Unsupported effect channel/);
  assert.equal(Object.hasOwn(generated.EFFECT_METADATA.effects[0], 'implementation'), false);
  const dsd = generated.EFFECT_METADATA.effects.find(
    effect => effect.type === 'DSD64IMDSimulator'
  );
  assert.equal(dsd.minimumSampleRate, 88200);
  assert.equal(dsd.effectiveDelaySamples, 63);
  assert.deepEqual(dsd.latency, { kind: 'zero' });
  assert.equal(generated._EFFECT_IMPLEMENTATION.Volume.internalType, 'VolumePlugin');
  assert.throws(() => new generated.IRReverb(), /requires an assets object/);
  const ir = new generated.IRReverb({
    assets: {
      impulseResponse: 'room'
    }
  });
  assert.deepEqual(ir.assets, {
    impulseResponse: 'room'
  });
});
