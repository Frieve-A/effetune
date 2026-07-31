import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  AssetError,
  IRReverb,
  createChain,
  encodeEta1
} from '../dist/index.js';
import {
  buildIrAssetPayload,
  IR_ASSET_TOPOLOGY
} from '../dist/internal/ir-asset-payload.js';

test('encodeEta1 emits bounded canonical planar payloads', () => {
  const payload = encodeEta1({
    channels: [
      Float32Array.of(1, 0.5),
      Float32Array.of(-1, -0.5)
    ],
    sampleRate: 48000,
    topology: 'matrix',
    paths: [
      { inputSlot: 0, outputSlot: 1, irChannel: 0 },
      { inputSlot: 1, outputSlot: 0, irChannel: 1 }
    ]
  });
  const view = new DataView(payload);
  assert.equal(view.getUint32(0, true), 0x31415445);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), 2);
  assert.equal(view.getUint32(12, true), 48000);
  assert.equal(view.getUint32(16, true), IR_ASSET_TOPOLOGY.matrix);
  assert.equal(view.getUint32(20, true), 2);
  assert.equal(view.getUint32(32, true), 0);
  assert.equal(view.getUint32(36, true), 1);
  assert.equal(view.getUint32(40, true), 0);
  assert.equal(view.getFloat32(56, true), 1);
  assert.equal(view.getFloat32(60, true), 0.5);
  assert.equal(view.getFloat32(64, true), -1);
  assert.equal(view.getFloat32(68, true), -0.5);
});

test('encodeEta1 rejects invalid public payload shapes with AssetError', () => {
  const channel = Float32Array.of(1);
  const invalid = [
    null,
    { channels: [], sampleRate: 48000 },
    { channels: [channel, Float32Array.of(1, 2)], sampleRate: 48000 },
    { channels: [Float32Array.of(Number.NaN)], sampleRate: 48000 },
    { channels: [channel], sampleRate: 0 },
    { channels: [channel], sampleRate: 48000, topology: 1 },
    { channels: [channel], sampleRate: 48000, topology: 'mono', paths: [] },
    {
      channels: [channel],
      sampleRate: 48000,
      topology: 'matrix',
      paths: [{ inputSlot: 1, outputSlot: 0, irChannel: 0 }]
    },
    {
      channels: [channel],
      sampleRate: 48000,
      topology: 'matrix',
      paths: [{ inputSlot: 0, outputSlot: 8, irChannel: 0 }]
    }
  ];
  for (const options of invalid) {
    assert.throws(() => encodeEta1(options), AssetError);
  }
  assert.throws(
    () => encodeEta1({
      channels: [new Float32Array((32 * 1024 * 1024 - 32) / 4 + 1)],
      sampleRate: 48000
    }),
    AssetError
  );
});

function bundleFor(payload, overrides = {}) {
  const bytes = new Uint8Array(payload);
  return {
    version: 1,
    chain: {
      version: 1,
      chain: [
        new IRReverb({
          id: 'room',
          assets: { impulseResponse: 'ir' },
          channelMode: 'mono',
          latency: 128,
          convolutionRate: 'full',
          wetLevel: -6,
          dryLevel: 0
        }).toJSON()
      ]
    },
    assets: [{
      id: 'ir',
      kind: 'impulseResponse',
      reference: 'memory:ir',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      format: {
        formatTag: 1,
        magic: 'ETA1',
        headerBytes: 32,
        pathRecordBytes: 12,
        reservedBytes: 8,
        sampleType: 'float32',
        byteOrder: 'little-endian',
        layout: 'planar',
        channels: 1,
        frames: 4,
        sampleRate: 48000,
        topology: 'mono',
        pathCount: 0
      },
      ...overrides
    }]
  };
}

function streamedResponse(chunks, { contentLength = null, onCancel = () => {} } = {}) {
  return {
    ok: true,
    headers: {
      get(name) {
        return name === 'content-length' && contentLength !== null
          ? String(contentLength)
          : null;
      }
    },
    body: {
      getReader() {
        let index = 0;
        return {
          async read() {
            return index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined };
          },
          async cancel() {
            onCancel();
          }
        };
      },
      async cancel() {
        onCancel();
      }
    },
    async arrayBuffer() {
      throw new Error('stream reader must be used');
    }
  };
}

function reusedTinyChunkResponse(
  payload,
  { contentLength = null, onCancel = () => {} } = {}
) {
  const chunk = new Uint8Array(1);
  let index = 0;
  return {
    ok: true,
    headers: {
      get(name) {
        return name === 'content-length' && contentLength !== null
          ? String(contentLength)
          : null;
      }
    },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= payload.byteLength) {
              return { done: true, value: undefined };
            }
            chunk[0] = payload[index++];
            return { done: false, value: chunk };
          },
          async cancel() {
            onCancel();
          }
        };
      },
      async cancel() {
        onCancel();
      }
    },
    async arrayBuffer() {
      throw new Error('stream reader must be used');
    }
  };
}

test('bundle resolver verifies SHA-256 and prewarms an ETA1 IR asset', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0.5, 0.25, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  const bundle = bundleFor(payload);
  const chain = await createChain(bundle, {
    variant: 'baseline',
    assetResolver(reference, descriptor) {
      assert.equal(reference, 'memory:ir');
      assert.equal(descriptor.id, 'ir');
      return payload;
    }
  });
  await chain.prewarm({ sampleRate: 48000, channels: 1 });
  const output = await chain.process([Float32Array.of(1, 0, 0, 0)], {
    sampleRate: 48000
  });
  assert.equal(output[0].length, 4);
  chain.close();
});

test('bundle resolution uses a deeply frozen manifest snapshot', async () => {
  const paths = [{ inputSlot: 0, outputSlot: 0, irChannel: 0 }];
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0.5, 0.25, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.matrix,
    paths
  });
  const bundle = bundleFor(payload, {
    format: {
      formatTag: 1,
      magic: 'ETA1',
      headerBytes: 32,
      pathRecordBytes: 12,
      reservedBytes: 8,
      sampleType: 'float32',
      byteOrder: 'little-endian',
      layout: 'planar',
      channels: 1,
      frames: 4,
      sampleRate: 48000,
      topology: 'matrix',
      pathCount: 1,
      paths
    }
  });
  bundle.chain.chain[0].parameters.channelMode = 'matrix';
  let release;
  let descriptor;
  const pending = createChain(bundle, {
    assetResolver(_reference, entry) {
      descriptor = entry;
      return new Promise(resolve => {
        release = () => resolve(payload);
      });
    }
  });

  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.format), true);
  assert.equal(Object.isFrozen(descriptor.format.paths), true);
  assert.equal(Object.isFrozen(descriptor.format.paths[0]), true);
  bundle.assets[0].reference = 'mutated';
  bundle.assets[0].sha256 = '0'.repeat(64);
  bundle.assets[0].format.paths[0].irChannel = 7;
  release();

  const chain = await pending;
  chain.close();
});

test('bundle resolver rejects hash, header, and size mismatches explicitly', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0, 0, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  const badHash = bundleFor(payload);
  badHash.assets[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    createChain(badHash, { assetResolver: () => payload }),
    AssetError
  );

  const badHeader = payload.slice(0);
  new DataView(badHeader).setUint32(4, 2, true);
  const malformed = bundleFor(badHeader);
  await assert.rejects(
    createChain(malformed, { assetResolver: () => badHeader }),
    AssetError
  );

  const oversized = bundleFor(payload, { byteLength: 32 * 1024 * 1024 + 1 });
  await assert.rejects(
    createChain(oversized, { assetResolver: () => payload }),
    AssetError
  );
});

test('bundle resolver rejects a direct byte-length mismatch before copying', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0, 0, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  const mismatched = new Uint8Array(payload.byteLength + 4);
  mismatched.set(new Uint8Array(payload));
  const NativeUint8Array = globalThis.Uint8Array;
  let defensiveCopies = 0;
  class TrackingUint8Array extends NativeUint8Array {
    constructor(...args) {
      super(...args);
      if (args.length === 1 && args[0] instanceof TrackingUint8Array) {
        defensiveCopies++;
      }
    }
  }

  try {
    await assert.rejects(
      createChain(bundleFor(payload), {
        assetResolver() {
          globalThis.Uint8Array = TrackingUint8Array;
          return mismatched;
        }
      }),
      AssetError
    );
  } finally {
    globalThis.Uint8Array = NativeUint8Array;
  }
  assert.equal(defensiveCopies, 0);
});

test('bundle validates every manifest format and chain reference before resolution', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0, 0, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  let resolverCalls = 0;
  const wrongFormula = bundleFor(payload, { byteLength: payload.byteLength + 4 });
  await assert.rejects(
    createChain(wrongFormula, {
      assetResolver: () => {
        resolverCalls++;
        return payload;
      }
    }),
    AssetError
  );
  assert.equal(resolverCalls, 0);

  const unusedInvalid = bundleFor(payload);
  unusedInvalid.assets.push({
    ...unusedInvalid.assets[0],
    id: 'unused',
    format: { ...unusedInvalid.assets[0].format, magic: 'wrong' }
  });
  await assert.rejects(
    createChain(unusedInvalid, { assetResolver: () => payload }),
    AssetError
  );

  const disabledMissing = bundleFor(payload);
  disabledMissing.chain.chain[0].enabled = false;
  disabledMissing.chain.chain[0].assets.impulseResponse = 'missing';
  await assert.rejects(
    createChain(disabledMissing, {
      assetResolver: () => {
        resolverCalls++;
        return payload;
      }
    }),
    AssetError
  );
  assert.equal(resolverCalls, 0);
});

test('bundle manifest rejects shared non-canonical public ETA1 metadata', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../common/bundle-manifest-invalid-v1.fixture.json', import.meta.url),
    'utf8'
  ));
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  for (const entry of fixture.invalid) {
    const bundle = bundleFor(payload);
    bundle.assets[0].byteLength = entry.byteLength;
    bundle.assets[0].format = {
      ...fixture.baseFormat,
      ...entry.formatOverrides
    };
    await assert.rejects(
      createChain(bundle, { assetResolver: () => payload }),
      AssetError,
      entry.name
    );
  }
});

test('matrix topology requires exact bounded path records', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1), Float32Array.of(1)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.matrix,
    paths: [{ inputSlot: 0, outputSlot: 0, irChannel: 0 }]
  });
  const bundle = bundleFor(payload);
  bundle.assets[0].format = {
    ...bundle.assets[0].format,
    channels: 2,
    frames: 1,
    topology: 'matrix',
    pathCount: 1,
    paths: [{ inputSlot: 0, outputSlot: 0, irChannel: 2 }]
  };
  await assert.rejects(
    createChain(bundle, { assetResolver: () => payload }),
    AssetError
  );
});

test('matrix input routes follow the shared contiguous and processing-channel contract', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../common/matrix-routes-v1.fixture.json', import.meta.url),
    'utf8'
  ));
  for (const entry of fixture.invalid) {
    const channels = Math.max(...entry.paths.map(path => path.irChannel)) + 1;
    const payload = buildIrAssetPayload({
      channels: Array.from({ length: channels }, () => Float32Array.of(1)),
      sampleRate: 48000,
      topology: IR_ASSET_TOPOLOGY.matrix,
      paths: entry.paths
    });
    const bundle = bundleFor(payload);
    bundle.chain.chain[0].parameters.channelMode = 'matrix';
    bundle.assets[0].format = {
      ...bundle.assets[0].format,
      channels,
      frames: 1,
      topology: 'matrix',
      pathCount: entry.paths.length,
      paths: entry.paths
    };
    if (entry.name === 'input-gap') {
      await assert.rejects(
        createChain(bundle, { assetResolver: () => payload }),
        AssetError
      );
    } else {
      const chain = await createChain(bundle, { assetResolver: () => payload });
      await assert.rejects(
        chain.prewarm({ sampleRate: 48000, channels: entry.processingChannels }),
        AssetError
      );
      chain.close();
    }
  }
});

test('resolver Response body failures preserve the public asset boundary', async () => {
  await assert.rejects(
    createChain([
      new IRReverb({ assets: { impulseResponse: 'unreadable' } })
    ], {
      assetResolver: () => ({
        ok: true,
        arrayBuffer() {
          throw new Error('body read failed');
        }
      })
    }),
    AssetError
  );
});

test('resolver Response accepts exact declared length from tiny stream chunks', async () => {
  const payload = new Uint8Array(buildIrAssetPayload({
    channels: [Float32Array.of(1, 0.5, 0.25, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  }));
  const chain = await createChain(bundleFor(payload), {
    assetResolver: () => reusedTinyChunkResponse(payload, {
      contentLength: payload.byteLength
    })
  });
  chain.close();
});

test('resolver Response accepts many reused tiny chunks without a declared length', async () => {
  const samples = new Float32Array(4096);
  samples[0] = 1;
  const payload = new Uint8Array(buildIrAssetPayload({
    channels: [samples],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  }));
  const chain = await createChain([
    new IRReverb({
      assets: { impulseResponse: 'memory:tiny-stream' },
      channelMode: 'mono',
      latency: 128,
      convolutionRate: 'full'
    })
  ], {
    assetResolver: () => reusedTinyChunkResponse(payload)
  });
  chain.close();
});

test('resolver Response reads are bounded and cancel on declared or streamed overflow', async () => {
  let declaredCancelled = 0;
  let arrayBufferCalls = 0;
  await assert.rejects(
    createChain([
      new IRReverb({ assets: { impulseResponse: 'declared-large' } })
    ], {
      assetResolver: () => ({
        ok: true,
        headers: { get: () => String(32 * 1024 * 1024 + 1) },
        body: {
          async cancel() {
            declaredCancelled++;
          }
        },
        async arrayBuffer() {
          arrayBufferCalls++;
          throw new Error('must not allocate');
        }
      })
    }),
    AssetError
  );
  assert.equal(declaredCancelled, 1);
  assert.equal(arrayBufferCalls, 0);

  const payload = new Uint8Array(buildIrAssetPayload({
    channels: [Float32Array.of(1, 0.5, 0.25, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  }));
  const bundle = bundleFor(payload);
  let mismatchedCancelled = 0;
  await assert.rejects(
    createChain(bundle, {
      assetResolver: () => streamedResponse([payload], {
        contentLength: payload.byteLength - 1,
        onCancel: () => { mismatchedCancelled++; }
      })
    }),
    AssetError
  );
  assert.equal(mismatchedCancelled, 1);

  await assert.rejects(
    createChain(bundle, {
      assetResolver: () => streamedResponse([
        payload.subarray(0, payload.byteLength - 1)
      ])
    }),
    AssetError
  );

  let streamedCancelled = 0;
  let readIndex = 0;
  await assert.rejects(
    createChain(bundle, {
      assetResolver: () => ({
        ok: true,
        headers: { get: () => null },
        body: {
          getReader() {
            return {
              async read() {
                const chunks = [payload, Uint8Array.of(0)];
                return readIndex < chunks.length
                  ? { done: false, value: chunks[readIndex++] }
                  : { done: true, value: undefined };
              },
              async cancel() {
                streamedCancelled++;
              }
            };
          }
        },
        async arrayBuffer() {
          throw new Error('stream reader must be used');
        }
      })
    }),
    AssetError
  );
  assert.equal(streamedCancelled, 1);
});

test('resolver Response fallback refuses an unbounded arrayBuffer call', async () => {
  let arrayBufferCalls = 0;
  await assert.rejects(
    createChain([
      new IRReverb({ assets: { impulseResponse: 'unbounded' } })
    ], {
      assetResolver: () => ({
        ok: true,
        headers: { get: () => null },
        body: null,
        async arrayBuffer() {
          arrayBufferCalls++;
          return new ArrayBuffer(32 * 1024 * 1024 + 1);
        }
      })
    }),
    AssetError
  );
  assert.equal(arrayBufferCalls, 0);

  await assert.rejects(
    createChain([
      new IRReverb({ assets: { impulseResponse: 'false-small-header' } })
    ], {
      assetResolver: () => ({
        ok: true,
        headers: { get: () => '4' },
        body: {},
        async arrayBuffer() {
          arrayBufferCalls++;
          return new ArrayBuffer(32 * 1024 * 1024 + 1);
        }
      })
    }),
    AssetError
  );
  assert.equal(arrayBufferCalls, 0);
});

test('non-bundle resolvers infer ETA1 metadata from common binary response types', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0.5, 0.25, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  const values = [
    payload,
    payload.slice(0),
    new Response(payload)
  ];
  for (const value of values) {
    const chain = await createChain([
      new IRReverb({
        assets: { impulseResponse: 'memory:ir' },
        channelMode: 'mono',
        latency: 128,
        convolutionRate: 'full'
      })
    ], {
      variant: 'baseline',
      assetResolver: () => value
    });
    await chain.prewarm({ sampleRate: 48000, channels: 1 });
    chain.close();
  }
});

test('non-bundle ETA1 inference rejects malformed headers and path slots', async () => {
  const malformed = new Uint8Array(32);
  new DataView(malformed.buffer).setUint32(0, 0x31415445, true);
  await assert.rejects(
    createChain([
      new IRReverb({ assets: { impulseResponse: 'bad' } })
    ], { assetResolver: () => malformed }),
    AssetError
  );

  const matrix = buildIrAssetPayload({
    channels: [Float32Array.of(1)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.matrix,
    paths: [{ inputSlot: 0, outputSlot: 0, irChannel: 0 }]
  });
  new DataView(matrix).setUint32(32, 8, true);
  await assert.rejects(
    createChain([
      new IRReverb({ assets: { impulseResponse: 'bad-slot' } })
    ], { assetResolver: () => matrix }),
    AssetError
  );
});

test('engine preparation preserves public asset error classification', async () => {
  const payload = buildIrAssetPayload({
    channels: [Float32Array.of(1, 0.5, 0.25, 0)],
    sampleRate: 48000,
    topology: IR_ASSET_TOPOLOGY.mono
  });
  const chain = await createChain([
    new IRReverb({
      assets: { impulseResponse: 'memory:ir' },
      channelMode: 'mono',
      convolutionRate: 'full'
    })
  ], {
    variant: 'baseline',
    assetResolver: () => payload
  });
  await assert.rejects(
    chain.prewarm({ sampleRate: 96000, channels: 1 }),
    AssetError
  );
  chain.close();
});
