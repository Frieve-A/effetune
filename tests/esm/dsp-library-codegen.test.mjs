import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadParamSpecs } from '../../scripts/gen-dsp-params.mjs';
import {
  EFFECT_CHANNELS,
  FROZEN_PARAM_DIRECTORIES,
  PUBLIC_EFFECT_TYPES,
  buildCatalog,
  contractDigests,
  generateOutputs,
  loadConvenienceExports,
  runGenerator,
  validateConvenienceExports,
  validateEffectOverlay,
  verifyContractDigests
} from '../../scripts/gen-dsp-library-bindings.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const generatedCatalogPath = path.join(
  repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.json'
);
const privateCatalogPath = path.join(
  repoRoot, 'dsp', 'bindings', 'generated', 'effects-v1.private.json'
);
const chainSchemaPath = path.join(
  repoRoot, 'dsp', 'bindings', 'schema', 'chain-v1.schema.json'
);
const bundleSchemaPath = path.join(
  repoRoot, 'dsp', 'bindings', 'schema', 'bundle-v1.schema.json'
);
const pythonPath = path.join(
  repoRoot, 'dsp', 'bindings', 'python', 'src', 'effetune', '_generated_effects.py'
);
const pythonStubPath = path.join(
  repoRoot, 'dsp', 'bindings', 'python', 'src', 'effetune', '_generated_effects.pyi'
);
const jsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'src', 'generated-effects.js'
);
const declarationsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'src', 'generated-effects.d.ts'
);
const convenienceExportsPath = path.join(
  repoRoot, 'dsp', 'bindings', 'js', 'convenience-exports-v0.1.json'
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function effectByType(catalog, type) {
  const effect = catalog.effects.find(candidate => candidate.type === type);
  assert.ok(effect, `missing ${type}`);
  return effect;
}

function parameterByName(effect, name) {
  const parameter = effect.parameters.find(candidate => candidate.name === name);
  assert.ok(parameter, `missing ${effect.type}.${name}`);
  return parameter;
}

test('frozen catalog selects every approved source-backed effect in canonical order', () => {
  const catalog = buildCatalog();
  assert.equal(catalog.version, 1);
  assert.deepEqual(catalog.effects.map(effect => effect.type), [...PUBLIC_EFFECT_TYPES]);
  assert.equal(catalog.effects.length, 76);

  const specs = new Map(Object.values(FROZEN_PARAM_DIRECTORIES).flatMap(directory =>
    loadParamSpecs(path.join(repoRoot, directory))
  ).map(spec => [spec.type, spec]));
  assert.equal(specs.size, 76);
  for (const effect of catalog.effects) {
    const spec = specs.get(effect.implementation.internalType);
    assert.ok(spec, `missing source metadata for ${effect.type}`);
    assert.equal(effect.implementation.source, spec.source);
    assert.equal(effect.implementation.layoutHash, spec.hash);
    assert.equal(effect.implementation.floatCount, spec.floatCount);
    assert.equal(
      effect.implementation.packedParameters.reduce(
        (count, parameter) => count + parameter.count,
        0
      ),
      spec.floatCount
    );
  }
});

test('semantic transforms, discrete values, seed tags, and IR slot mapping are frozen', () => {
  const catalog = readJson(generatedCatalogPath);

  const tilt = parameterByName(effectByType(catalog, 'TiltEQ'), 'pivotFrequency');
  assert.equal(tilt.unit, 'Hz');
  assert.equal(tilt.default, Math.exp(6.91));
  assert.equal(tilt.minimum, Math.exp(3));
  assert.equal(tilt.maximum, Math.exp(9.9));

  const errors = parameterByName(
    effectByType(catalog, 'DigitalErrorEmulator'), 'bitErrorRate'
  );
  assert.equal(errors.default, 1e-6);
  assert.equal(errors.minimum, 1e-12);
  assert.equal(errors.maximum, 1e-2);

  const jitter = parameterByName(
    effectByType(catalog, 'SimpleJitter'), 'rmsJitterNanoseconds'
  );
  assert.deepEqual(
    [jitter.minimum, jitter.default, jitter.maximum],
    [0.001, 100, 10_000_000]
  );

  assert.deepEqual(
    parameterByName(effectByType(catalog, 'BrickwallLimiter'), 'oversampling').values,
    [1, 2, 4, 8]
  );
  assert.deepEqual(
    parameterByName(effectByType(catalog, 'HiPassFilter'), 'slope').values,
    [0, -12, -24, -36, -48, -60, -72, -84, -96]
  );
  assert.deepEqual(
    parameterByName(effectByType(catalog, 'Exciter'), 'highPassSlope').values,
    [0, 6, 12]
  );
  assert.deepEqual(
    parameterByName(effectByType(catalog, 'Matrix'), 'matrixRoutes'),
    {
      name: 'matrixRoutes',
      type: 'string',
      count: 1,
      default: '0011',
      maximumLength: 3072,
      pattern: '^(?:p?[0-8][0-8])*$'
    }
  );

  for (const type of ['FifteenBandPEQ', 'FiveBandPEQ']) {
    const effect = effectByType(catalog, type);
    const count = type === 'FifteenBandPEQ' ? 15 : 5;
    assert.equal(parameterByName(effect, 'frequencies').count, count);
    assert.equal(parameterByName(effect, 'gains').count, count);
    assert.equal(parameterByName(effect, 'qValues').count, count);
    assert.equal(parameterByName(effect, 'enabledBands').count, count);
    assert.deepEqual(
      parameterByName(effect, 'filterTypes').values,
      ['peaking', 'lowPass', 'highPass', 'lowShelf', 'highShelf', 'bandPass', 'notch', 'allPass']
    );
  }

  const fm = effectByType(catalog, 'FMRadioSimulator');
  assert.deepEqual(
    fm.sampleRates,
    [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000]
  );
  assert.equal(fm.seeded, true);

  const dsd = effectByType(catalog, 'DSD64IMDSimulator');
  assert.equal(dsd.minimumSampleRate, 88200);
  assert.equal(dsd.effectiveDelaySamples, 63);
  assert.deepEqual(dsd.latency, { kind: 'zero' });

  const ir = effectByType(catalog, 'IRReverb');
  assert.equal(ir.assets.length, 1);
  assert.deepEqual(ir.assets[0], {
    name: 'impulseResponse',
    kind: 'impulseResponse',
    required: true
  });
  for (const type of ['FIRCrossover', 'FiveBandFIRPEQ', 'GroupDelayEQ', 'RoomEQ']) {
    assert.deepEqual(effectByType(catalog, type).assets, ir.assets);
  }
});

test('v0.1 named convenience exports exactly match the canonical catalog', () => {
  const catalog = buildCatalog();
  const manifest = loadConvenienceExports(convenienceExportsPath);
  const expectedTypes = catalog.effects.map(effect => effect.type);

  assert.deepEqual(manifest.exports.map(entry => entry.type), expectedTypes);
  assert.equal(catalog.effects.length, 76);
  assert.equal(manifest.exports.length, 76);
  for (const entry of manifest.exports) {
    assert.equal(entry.class, entry.type);
    assert.equal(entry.factory, `create${entry.type}`);
  }
  assert.equal(manifest.exports.some(entry => entry.type === 'DSD64IMDSimulator'), true);
  assert.deepEqual(validateConvenienceExports(catalog), manifest);

  const missingExport = structuredClone(manifest);
  missingExport.exports.pop();
  assert.throws(
    () => validateConvenienceExports(catalog, { manifest: missingExport }),
    /complete catalog/
  );
});

test('DSD effective-path metadata rejects invalid overlay values', () => {
  const source = 'test DSD overlay';
  const spec = loadParamSpecs(
    path.join(repoRoot, FROZEN_PARAM_DIRECTORIES.DSD64IMDSimulatorPlugin)
  )[0];
  const valid = {
    type: 'DSD64IMDSimulator',
    internalType: 'DSD64IMDSimulatorPlugin',
    minimumSampleRate: 88200,
    effectiveDelaySamples: 63
  };
  assert.doesNotThrow(() => validateEffectOverlay(valid, spec, source));

  for (const minimumSampleRate of [0, -1, 88200.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => validateEffectOverlay({ ...valid, minimumSampleRate }, spec, source),
      /minimumSampleRate must be a positive safe integer/
    );
  }
  for (const effectiveDelaySamples of [-1, 63.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => validateEffectOverlay({ ...valid, effectiveDelaySamples }, spec, source),
      /effectiveDelaySamples must be a non-negative safe integer/
    );
  }
});

test('public metadata is separated from the frozen private implementation mapping', () => {
  const publicCatalog = readJson(generatedCatalogPath);
  const privateCatalog = readJson(privateCatalogPath);
  const serializedPublic = JSON.stringify(publicCatalog);

  for (const privateToken of [
    'internalType', 'layoutHash', 'packedParameters', '"keys"', '"source"'
  ]) {
    assert.equal(serializedPublic.includes(privateToken), false, privateToken);
  }
  assert.deepEqual(publicCatalog.channels, [...EFFECT_CHANNELS]);
  assert.deepEqual(publicCatalog.contractDigests, contractDigests(buildCatalog()));
  assert.equal(privateCatalog.contractDigest, publicCatalog.contractDigests.privateLayoutSha256);
  assert.equal(privateCatalog.channelMapping.stereo, null);
  assert.equal(privateCatalog.channelMapping.all, 'A');
  assert.equal(Object.keys(privateCatalog.frozenGoldenIndexes).length, 76);
  for (const effect of buildCatalog().effects) {
    const source = effect.implementation.source;
    assert.equal(
      privateCatalog.frozenGoldenIndexes[source],
      path.posix.join(path.posix.dirname(source), 'golden', 'index.json')
    );
  }
  assert.equal(privateCatalog.effects.IRReverb.internalType, 'IRReverbPlugin');
  assert.deepEqual(privateCatalog.effects.IRReverb.assets, [{
    publicName: 'impulseResponse',
    slot: 0,
    format: 'ET_ASSET_F32_MULTICH',
    capacity: '32 MiB convolution cap'
  }]);
  assert.deepEqual(privateCatalog.effects.Matrix.structuredParameter, {
    publicName: 'matrixRoutes',
    key: 'mx',
    codec: 'matrix-routes-v1',
    maxItems: 1024,
    byteCapacity: 3076
  });

  const drifted = structuredClone(buildCatalog());
  const driftedParameter = drifted.effects
    .find(effect => effect.parameters.length > 0)
    .parameters[0];
  driftedParameter.default += 1;
  assert.throws(
    () => verifyContractDigests(drifted),
    /frozen v1 contract digest mismatch/
  );
});

test('public chain and bundle schemas exclude legacy representations', () => {
  const chain = readJson(chainSchemaPath);
  const bundle = readJson(bundleSchemaPath);
  const serializedChain = JSON.stringify(chain);

  for (const privateToken of [
    'internalType', 'layoutHash', 'packedParameters', '"keys"', '"pipeline"', '"plugins"'
  ]) {
    assert.equal(serializedChain.includes(privateToken), false, privateToken);
  }
  assert.equal(chain.additionalProperties, false);
  assert.deepEqual(chain.required, ['version', 'chain']);
  assert.equal(chain.properties.version.const, 1);
  assert.deepEqual(chain.$defs.channel.enum, [...EFFECT_CHANNELS]);
  assert.equal(chain.$defs.effect.oneOf.length, 76);
  for (const type of [
    'FIRCrossover',
    'FiveBandFIRPEQ',
    'GroupDelayEQ',
    'IRReverb',
    'RoomEQ'
  ]) {
    assert.deepEqual(chain.$defs[type].properties.assets.required, ['impulseResponse']);
  }
  assert.equal(
    chain.$defs.Matrix.properties.parameters.properties.matrixRoutes.maxLength,
    3072
  );
  assert.equal(
    chain.$defs.Matrix.properties.parameters.properties.matrixRoutes.pattern,
    '^(?:p?[0-8][0-8])*$'
  );
  assert.equal(
    Object.hasOwn(chain.$defs.Compressor.properties, 'assets'),
    false
  );

  assert.equal(bundle.additionalProperties, false);
  assert.deepEqual(bundle.required, ['version', 'chain', 'assets']);
  assert.equal(bundle.properties.assets.maxItems, 64);
  assert.equal(bundle.$defs.asset.properties.byteLength.maximum, 32 * 1024 * 1024);
  assert.equal(bundle.$defs.asset.properties.byteLength.minimum, 36);
  assert.equal(bundle.$defs.asset.properties.sha256.pattern, '^[0-9a-f]{64}$');
  const format = bundle.$defs.asset.properties.format;
  assert.equal(format.properties.formatTag.const, 1);
  assert.equal(format.properties.magic.const, 'ETA1');
  assert.equal(format.properties.headerBytes.const, 32);
  assert.equal(format.properties.pathRecordBytes.const, 12);
  assert.equal(format.properties.reservedBytes.const, 8);
  assert.equal(format.properties.sampleType.const, 'float32');
  assert.equal(format.properties.byteOrder.const, 'little-endian');
  assert.equal(format.properties.layout.const, 'planar');
  assert.deepEqual(
    format.properties.topology.enum,
    ['unspecified', 'mono', 'independent', 'trueStereo', 'matrix']
  );
  assert.equal(format.properties.paths.minItems, 1);
  assert.equal(format.properties.paths.maxItems, 8);
  assert.deepEqual(
    format.properties.paths.items.required,
    ['inputSlot', 'outputSlot', 'irChannel']
  );
  assert.equal(format.properties.paths.items.properties.inputSlot.maximum, 7);
  assert.equal(format.properties.paths.items.properties.outputSlot.maximum, 7);
  assert.equal(format.properties.paths.items.properties.irChannel.maximum, 7);
  assert.deepEqual(format.allOf[0].then.required, ['paths']);
  assert.equal(format.allOf[0].else.properties.pathCount.const, 0);
});

test('generated language surfaces expose all approved thin classes and typed factories', () => {
  const python = fs.readFileSync(pythonPath, 'utf8');
  const pythonStub = fs.readFileSync(pythonStubPath, 'utf8');
  const javascript = fs.readFileSync(jsPath, 'utf8');
  const declarations = fs.readFileSync(declarationsPath, 'utf8');

  assert.match(python, /from \._base import Effect/);
  assert.match(python, /^_EFFECT_IMPLEMENTATION = /m);
  assert.match(javascript, /import \{ Effect \} from '\.\/effect\.js';/);
  assert.match(javascript, /^export const _EFFECT_IMPLEMENTATION = /m);
  for (const type of PUBLIC_EFFECT_TYPES) {
    assert.match(python, new RegExp(`^class ${type}\\(Effect\\):`, 'm'));
    assert.match(javascript, new RegExp(`^export class ${type} extends Effect \\{`, 'm'));
    assert.match(
      declarations,
      new RegExp(`^export interface ${type}Options extends CommonEffectOptions \\{`, 'm')
    );
    assert.match(
      declarations,
      new RegExp(`^export declare function create${type}\\(`, 'm')
    );
  }
  assert.match(python, /frequencies=\(25, 40, 63,/);
  assert.match(
    python,
    /class IRReverb\(Effect\):[\s\S]*channel="all",\s+assets=None,\s+\):/
  );
  assert.doesNotMatch(
    python,
    /class Volume\(Effect\):[\s\S]*?assets=None[\s\S]*?class StereoBalance/
  );
  assert.match(
    pythonStub,
    /EffectChannel: TypeAlias = Literal\["all", "stereo", "left", "right", "1"/
  );
  assert.match(pythonStub, /class IRReverbAssets\(TypedDict\):\s+impulseResponse: str/);
  assert.match(
    pythonStub,
    /class IRReverb\(Effect\):[\s\S]*assets: IRReverbAssets,\s+\) -> None/
  );
  assert.match(pythonStub, /frequencies: tuple\[float, float, float,/);
  assert.match(declarations, /readonly filterTypes\?: readonly \[/);
  assert.match(
    declarations,
    /export interface IRReverbOptions[\s\S]*readonly assets: IRReverbAssets;/
  );
  assert.match(declarations, /constructor\(options: IRReverbOptions\);/);
  assert.match(
    declarations,
    /createIRReverb\(options: IRReverbOptions\): IRReverb;/
  );
  assert.match(
    declarations,
    /export interface VolumeOptions[\s\S]*readonly assets\?: never;/
  );
});

test('generic JavaScript factory requires options for every asset-bearing effect', () => {
  const catalog = buildCatalog();
  const declarations = fs.readFileSync(declarationsPath, 'utf8');
  const requiredAssetTypes = catalog.effects
    .filter(effect => effect.assets.length !== 0)
    .map(effect => effect.type);
  const union = declarations.match(/^type RequiredAssetEffectType = ([^;]+);$/m);

  assert.ok(union);
  assert.deepEqual(
    union[1].split(' | ').map(type => JSON.parse(type)),
    requiredAssetTypes
  );
  assert.deepEqual(requiredAssetTypes, [
    'FIRCrossover',
    'FiveBandFIRPEQ',
    'GroupDelayEQ',
    'RoomEQ',
    'IRReverb'
  ]);
  assert.equal(requiredAssetTypes.includes('Volume'), false);
  assert.match(
    declarations,
    /T extends RequiredAssetEffectType\s+\? \[options: EffectOptionsByType\[T\]\]\s+: \[options\?: EffectOptionsByType\[T\]\]/
  );
});

test('JavaScript declarations separate raw preset inputs from normalized chain output', () => {
  const declarations = fs.readFileSync(
    path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'index.d.ts'),
    'utf8'
  );
  const workletDeclarations = fs.readFileSync(
    path.join(repoRoot, 'dsp', 'bindings', 'js', 'src', 'worklet.d.ts'),
    'utf8'
  );
  assert.match(declarations, /export interface ChainEffectInput \{/);
  assert.match(
    declarations,
    /ChainEffectInput \{[\s\S]*readonly id\?: string;[\s\S]*readonly enabled\?: boolean;[\s\S]*readonly channel\?: EffectChannel;/
  );
  assert.match(
    declarations,
    /export interface ChainEffect \{[\s\S]*readonly id: string;[\s\S]*readonly enabled: boolean;[\s\S]*readonly channel: EffectChannel;/
  );
  assert.match(
    declarations,
    /parsePreset\([\s\S]*readonly \(Effect \| ChainEffectInput\)\[\][\s\S]*\): ChainDocument;/
  );
  assert.match(declarations, /isBundleDocument\(input: unknown\): boolean/);
  assert.match(workletDeclarations, /ChainDocumentInput/);
  assert.doesNotMatch(workletDeclarations, /readonly \(Effect \| object\)\[\]/);
});

test('generated files are byte-for-byte current', () => {
  const { catalog, stale } = runGenerator({ check: true });
  assert.deepEqual(stale, []);
  for (const [filePath, expected] of generateOutputs(catalog)) {
    assert.equal(fs.readFileSync(filePath, 'utf8'), expected);
  }
});
