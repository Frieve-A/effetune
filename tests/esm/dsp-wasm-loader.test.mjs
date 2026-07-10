import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_ABI_VERSION,
  SIMD_PROBE_BYTES,
  canCloneWasmModule,
  clearDspModuleCache,
  createDspParamPackers,
  detectSimdSupport,
  detectWasmExceptionHandlingSupport,
  loadDspModule,
  publishDspParamPackers,
  validateDspMeta
} from '../../js/audio/dsp-wasm-loader.js';

function createLoaderHarness(options = {}) {
  const requests = [];
  const compiled = [];
  const warnings = [];
  let closed = 0;
  const meta = options.meta || {
    abiVersion: 1,
    kernels: [{ name: 'VolumePlugin', hash: 100 }],
    sizes: { baseline: 4, simd: 4 }
  };
  const bytes = new Uint8Array([0, 97, 115, 109]).buffer;
  const module = { moduleId: options.moduleId || 'compiled-module' };
  const webAssembly = options.webAssembly || {
    Tag: class {},
    Exception: class {},
    validate() {
      if (options.validateThrows) throw new Error('validate failed');
      return options.simd ?? false;
    },
    async compile(value) {
      compiled.push(value);
      if (options.compileError) throw new Error('compile failed');
      return module;
    }
  };
  const fetchImpl = options.fetchImpl || (async url => {
    requests.push(url);
    if (url.endsWith('.json')) {
      return options.metaResponse || { ok: true, async json() { return meta; } };
    }
    return options.binaryResponse || { ok: true, async arrayBuffer() { return bytes; } };
  });
  const instantiateImpl = options.instantiateImpl || (async () => ({
    getCapabilities() {
      return options.capabilities || {
        abiVersion: 1,
        buildFlags: options.simd ? 1 : 0,
        simd: options.simd ?? false,
        kernels: meta.kernels.map((kernel, kernelIndex) => ({ ...kernel, kernelIndex }))
      };
    },
    close() {
      closed += 1;
    }
  }));
  return {
    requests,
    compiled,
    warnings,
    module,
    bytes,
    webAssembly,
    fetchImpl,
    instantiateImpl,
    get closed() { return closed; },
    options: {
      basePath: '/app/',
      fetchImpl,
      webAssembly,
      instantiateImpl,
      structuredCloneImpl: options.cloneFails ? () => { throw new Error('clone failed'); } : value => value,
      warning: message => warnings.push(message),
      paramPackersModule: options.paramPackersModule ?? null,
      publishTarget: options.publishTarget ?? {},
      cache: options.cache ?? false
    }
  };
}

test('SIMD detection validates a real minimal module and tolerates unavailable engines', () => {
  assert.equal(WebAssembly.validate(SIMD_PROBE_BYTES), true);
  assert.equal(detectSimdSupport(WebAssembly), true);
  assert.equal(detectSimdSupport(null), false);
  assert.equal(detectSimdSupport({ validate() { throw new Error('unsupported'); } }), false);
  assert.equal(detectSimdSupport({ validate: null }), false);
  assert.equal(EXPECTED_ABI_VERSION, 1);
});

test('Wasm exception handling detection requires the legacy EH JavaScript API', () => {
  assert.equal(detectWasmExceptionHandlingSupport({ Tag: class {}, Exception: class {} }), true);
  assert.equal(detectWasmExceptionHandlingSupport({ Tag: class {} }), false);
  assert.equal(detectWasmExceptionHandlingSupport({ Exception: class {} }), false);
  assert.equal(detectWasmExceptionHandlingSupport(null), false);
});

test('metadata validation normalizes hashes and rejects ambiguous capability lists', () => {
  const source = { abiVersion: 1, kernels: [{ name: 'VolumePlugin', hash: 0xffffffff }], note: 'kept' };
  assert.deepEqual(validateDspMeta(source), {
    ...source,
    kernels: [{ name: 'VolumePlugin', hash: 0xffffffff, byteCapacity: 0 }]
  });
  assert.throws(() => validateDspMeta(null), /not an object/);
  assert.throws(() => validateDspMeta({ abiVersion: '1', kernels: [] }), /ABI version/);
  assert.throws(() => validateDspMeta({ abiVersion: 1, kernels: {} }), /must be an array/);
  assert.throws(() => validateDspMeta({ abiVersion: 1, kernels: [null] }), /kernel at index/);
  assert.throws(
    () => validateDspMeta({ abiVersion: 1, kernels: [{ name: 'A', hash: -1 }] }),
    /parameter hash/
  );
  assert.throws(
    () => validateDspMeta({ abiVersion: 1, kernels: [{ name: 'A', hash: 1 }, { name: 'A', hash: 1 }] }),
    /Duplicate DSP kernel/
  );
  assert.throws(
    () => validateDspMeta({ abiVersion: 1, kernels: [{ name: 'A', hash: 1, byteCapacity: 4097 }] }),
    /parameter capacity/
  );
});

test('parameter packer publication accepts generated maps and named exports', () => {
  const pack = params => Float32Array.of(params.vl);
  const warnings = [];
  const declared = createDspParamPackers({
    DSP_PARAM_PACKERS: new Map([
      ['VolumePlugin', { pack, hash: 100 }],
      ['BadPlugin', { pack, hash: 3 }],
      ['IgnoredPlugin', { hash: 4 }]
    ])
  }, [
    { name: 'VolumePlugin', hash: 100 },
    { name: 'BadPlugin', hash: 2 }
  ], message => warnings.push(message));
  assert.deepEqual([...declared.keys()], ['VolumePlugin']);
  assert.equal(declared.get('VolumePlugin').pack({ vl: 0.5 })[0], 0.5);
  assert.equal(warnings.length, 1);

  const matrixBytes = () => Uint8Array.of(1, 0, 0, 0);
  const structured = createDspParamPackers({
    DSP_PARAM_PACKERS: new Map([[
      'MatrixPlugin',
      { pack: () => new Float32Array(0), packBytes: matrixBytes, hash: 7, byteCapacity: 3076 }
    ]])
  }, [{ name: 'MatrixPlugin', hash: 7, byteCapacity: 3076 }]);
  assert.equal(structured.get('MatrixPlugin').byteCapacity, 3076);
  assert.deepEqual([...structured.get('MatrixPlugin').packBytes({})], [1, 0, 0, 0]);
  assert.equal(createDspParamPackers({
    DSP_PARAM_PACKERS: new Map([[
      'MatrixPlugin',
      { pack, packBytes: matrixBytes, hash: 7, byteCapacity: 4 }
    ]])
  }, [{ name: 'MatrixPlugin', hash: 7, byteCapacity: 3076 }]).size, 0);

  const target = {};
  const inferred = publishDspParamPackers({
    packVolumePluginParams: pack,
    VolumePlugin_PARAMS_HASH: 100,
    packNoHashParams: pack,
    unrelated: true
  }, { target, kernels: [{ name: 'VolumePlugin', hash: 100 }] });
  assert.equal(target.dspParamPackers, inferred);
  assert.deepEqual([...inferred.keys()], ['VolumePlugin']);
  assert.equal(createDspParamPackers(null).size, 0);
});

test('loader selects SIMD, verifies capabilities, publishes packers, and reuses its cache', async () => {
  clearDspModuleCache();
  const target = {};
  const pack = () => Float32Array.of(1);
  const harness = createLoaderHarness({
    simd: true,
    cache: true,
    publishTarget: target,
    meta: {
      abiVersion: 1,
      kernels: [
        { name: 'VolumePlugin', hash: 100 },
        { name: 'StalePlugin', hash: 200 }
      ]
    },
    capabilities: {
      abiVersion: 1,
      buildFlags: 1,
      simd: true,
      kernels: [
        { name: 'VolumePlugin', hash: 100, kernelIndex: 0 },
        { name: 'StalePlugin', hash: 201, kernelIndex: 1 }
      ]
    },
    paramPackersModule: {
      DSP_PARAM_PACKERS: new Map([
        ['VolumePlugin', { pack, hash: 100 }],
        ['StalePlugin', { pack, hash: 200 }]
      ])
    }
  });

  const first = await loadDspModule(harness.options);
  const second = await loadDspModule(harness.options);
  assert.equal(first, second);
  assert.equal(first.module, harness.module);
  assert.equal(first.bytes, harness.bytes);
  assert.equal(first.moduleCloneable, true);
  assert.equal(first.simd, true);
  assert.deepEqual(first.meta.kernels, [
    { name: 'VolumePlugin', hash: 100, byteCapacity: 0 }
  ]);
  assert.deepEqual([...first.paramPackers.keys()], ['VolumePlugin']);
  assert.equal(target.dspParamPackers, first.paramPackers);
  assert.equal(harness.requests.filter(url => url.endsWith('.simd.wasm')).length, 1);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.compiled.length, 1);
  assert.equal(harness.closed, 1);
  assert.ok(harness.warnings.some(message => message.includes('StalePlugin')));
});

test('loader retains bytes and records whether the compiled module is a clone candidate', async () => {
  const baseline = createLoaderHarness({ cloneFails: true });
  const baselineInfo = await loadDspModule(baseline.options);
  assert.equal(baselineInfo.bytes, baseline.bytes);
  assert.equal(baselineInfo.moduleCloneable, false);
  assert.ok(baseline.requests.some(url => url.endsWith('/effetune-dsp.wasm')));

  const debug = createLoaderHarness({ simd: true, cloneFails: true });
  const debugInfo = await loadDspModule({ ...debug.options, debug: true });
  assert.equal(debugInfo.simd, false);
  assert.equal(debugInfo.bytes, debug.bytes);
  assert.equal(debugInfo.moduleCloneable, false);
  assert.ok(debug.requests.some(url => url.endsWith('/effetune-dsp.debug.wasm')));
  assert.equal(canCloneWasmModule(debug.module, null), false);
  assert.equal(canCloneWasmModule(debug.module, value => value), true);
  assert.equal(canCloneWasmModule(debug.module, () => { throw new Error('no clone'); }), false);
});

test('loader converts fetch, metadata, compile, and instantiation failures to JS-only sessions', async t => {
  const cases = [
    {
      name: 'binary response failure',
      configure: { binaryResponse: { ok: false, status: 404 } }
    },
    {
      name: 'unreadable metadata',
      configure: { metaResponse: { ok: true } }
    },
    {
      name: 'metadata ABI mismatch',
      configure: { meta: { abiVersion: 2, kernels: [] } }
    },
    {
      name: 'compile rejection',
      configure: { compileError: true }
    },
    {
      name: 'module ABI mismatch',
      configure: { capabilities: { abiVersion: 2, buildFlags: 0, simd: false, kernels: [] } }
    },
    {
      name: 'artifact flag mismatch',
      configure: {
        simd: true,
        capabilities: { abiVersion: 1, buildFlags: 0, simd: false, kernels: [] }
      }
    },
    {
      name: 'instantiate rejection',
      configure: { instantiateImpl: async () => { throw new Error('instantiate failed'); } }
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const harness = createLoaderHarness(entry.configure);
      const result = await loadDspModule(harness.options);
      assert.equal(result, null);
      assert.ok(harness.warnings.some(message => message.startsWith('[dsp-wasm] load failed:')));
    });
  }

  const warnings = [];
  assert.equal(await loadDspModule({ fetchImpl: null, warning: message => warnings.push(message) }), null);
  assert.match(warnings[0], /fetch is unavailable/);
});

test('loader skips fetch and compilation when Wasm exception handling is unavailable', async () => {
  const harness = createLoaderHarness();
  delete harness.webAssembly.Tag;
  delete harness.webAssembly.Exception;

  assert.equal(await loadDspModule(harness.options), null);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.compiled.length, 0);
  assert.match(harness.warnings[0], /exception handling is unavailable/);
});

test('unsupported EH calls are not cached before a supported call', async () => {
  clearDspModuleCache();
  const harness = createLoaderHarness({ cache: true });
  delete harness.webAssembly.Tag;
  delete harness.webAssembly.Exception;

  assert.equal(await loadDspModule(harness.options), null);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.compiled.length, 0);

  harness.webAssembly.Tag = class {};
  harness.webAssembly.Exception = class {};
  const info = await loadDspModule(harness.options);
  assert.equal(info.module, harness.module);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.compiled.length, 1);
  clearDspModuleCache();
});

test('unsupported EH calls cannot reuse a previously cached supported module', async () => {
  clearDspModuleCache();
  const harness = createLoaderHarness({ cache: true });
  const info = await loadDspModule(harness.options);
  assert.equal(info.module, harness.module);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.compiled.length, 1);

  delete harness.webAssembly.Tag;
  delete harness.webAssembly.Exception;
  assert.equal(await loadDspModule(harness.options), null);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.compiled.length, 1);
  assert.ok(harness.warnings.some(message => /exception handling is unavailable/.test(message)));
  clearDspModuleCache();
});

test('failed cached loads are evicted so a later attempt can recover', async () => {
  clearDspModuleCache();
  let attempts = 0;
  const harness = createLoaderHarness({ cache: true });
  const fetchImpl = async url => {
    attempts += 1;
    if (attempts <= 2) throw new Error('temporary failure');
    return harness.fetchImpl(url);
  };
  const options = { ...harness.options, fetchImpl, cache: true };
  assert.equal(await loadDspModule(options), null);
  assert.ok(await loadDspModule(options));
  assert.equal(attempts, 4);
});
