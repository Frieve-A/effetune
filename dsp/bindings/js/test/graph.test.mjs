import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  Graph,
  IRReverb,
  createChain,
  createGraph,
  createSendReturnGraphDocument,
  createVolume,
  createWetDryGraphDocument,
  encodeEta1,
  graphDocumentFromChain,
  normalizeGraphDocument
} from '../dist/index.js';
import {
  _normalizeGraphInput,
  graphVisualizationSnapshot
} from '../dist/graph-document.js';
import { normalizeChainDocument } from '../dist/semantics.js';
import { effectiveNodeIds, graphCompileError } from '../dist/graph-engine.js';

const fixture = JSON.parse(await readFile(
  new URL('../../common/graph-v1-contract.fixture.json', import.meta.url),
  'utf8'
));

test('Graph v1 shared documents normalize and reject with stable diagnostics', () => {
  for (const entry of fixture.valid) {
    const document = normalizeGraphDocument(entry.document);
    assert.equal(document.version, 1, entry.name);
    assert.deepEqual(document.nodes.map(node => node.id), [...document.nodes.map(node => node.id)].sort());
    for (const edge of document.edges) {
      assert.equal(typeof edge.gain, 'number');
      assert.equal(typeof edge.mute, 'boolean');
      assert.equal(typeof edge.mixGroup, 'string');
      assert.equal(typeof edge.solo, 'boolean');
    }
  }
  for (const entry of fixture.invalid.filter(entry => entry.streamChannels === undefined)) {
    assert.throws(
      () => normalizeGraphDocument(entry.document),
      error => error.code === entry.code && error.path === entry.path,
      entry.name
    );
  }
});

test('a muted solo edge suppresses a normal edge in the same destination group', async () => {
  const entry = fixture.valid.find(candidate =>
    candidate.name === 'muted-solo-suppresses-normal-edge'
  );
  const document = normalizeGraphDocument(entry.document);
  assert.deepEqual([...effectiveNodeIds(document)], entry.expectedEffectiveNodeIds);

  const graph = await createGraph(document, { variant: 'baseline' });
  let stream;
  try {
    stream = await graph.stream({ sampleRate: 48_000, channels: 2, blockSize: 8 });
    const output = await stream.process([
      new Float32Array(8).fill(1),
      new Float32Array(8).fill(1)
    ]);
    assert.ok(output.every(channel => channel.every(sample => sample === entry.expectedOutput)));
    assert.equal(stream.compileSnapshot.silence, true);
    assert.deepEqual(stream.compileSnapshot.effectiveSchedule, entry.expectedEffectiveNodeIds);
    assert.deepEqual(
      stream.compileSnapshot.edges.filter(edge => edge.active).map(edge => edge.id),
      entry.expectedActiveEdgeIds
    );
  } finally {
    stream?.close();
    graph.close();
  }
});

test('Graph stream channel errors identify the original node', async t => {
  const cases = [
    { name: 'right in mono', channel: 'right', channels: 1, nodeId: 'z-right' },
    { name: 'third channel in stereo', channel: '3', channels: 2, nodeId: 'z-third' }
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const graph = await createGraph({
        version: 1,
        input: { id: 'input' },
        output: { id: 'output' },
        nodes: [
          {
            id: entry.nodeId,
            type: 'Volume',
            channel: entry.channel,
            parameters: { volume: 0 }
          },
          { id: 'a-volume', type: 'Volume', parameters: { volume: 0 } }
        ],
        edges: [
          { id: 'in', source: 'input', destination: entry.nodeId },
          { id: 'middle', source: entry.nodeId, destination: 'a-volume' },
          { id: 'out', source: 'a-volume', destination: 'output' }
        ]
      }, { variant: 'baseline' });
      try {
        await assert.rejects(
          graph.stream({ sampleRate: 48_000, channels: entry.channels }),
          error => error instanceof Error &&
            error.code === 'GRAPH_DOCUMENT_CHANNEL' &&
            error.path === '/nodes/0/channel' &&
            error.nodeId === entry.nodeId
        );
      } finally {
        graph.close();
      }
    });
  }
});

test('Graph checks sample-rate support only for enabled effective nodes', async t => {
  const cases = [
    { name: 'disabled node', enabled: false, mute: false, rejects: false },
    { name: 'dormant node', enabled: true, mute: true, rejects: false },
    { name: 'effective node', enabled: true, mute: false, rejects: true }
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const graph = await createGraph({
        version: 1,
        input: { id: 'input' },
        output: { id: 'output' },
        nodes: [{
          id: 'tube',
          type: 'TubeSimulator',
          enabled: entry.enabled,
          parameters: {}
        }],
        edges: [
          { id: 'in', source: 'input', destination: 'tube' },
          { id: 'out', source: 'tube', destination: 'output', mute: entry.mute }
        ]
      }, { variant: 'baseline' });
      let stream;
      try {
        if (entry.rejects) {
          await assert.rejects(
            graph.stream({ sampleRate: 32_000, channels: 2 }),
            error => error.name === 'ValidationError' &&
              /does not support a sample rate of 32000 Hz/.test(error.message)
          );
        } else {
          stream = await graph.stream({ sampleRate: 32_000, channels: 2 });
        }
      } finally {
        stream?.close();
        graph.close();
      }
    });
  }
});

test('Graph IDs use Unicode scalar length and mix groups are non-empty', () => {
  const emoji128 = '😀'.repeat(128);
  const document = normalizeGraphDocument({
    version: 1,
    input: { id: emoji128 },
    output: { id: 'output' },
    nodes: [],
    edges: []
  });
  assert.equal(Array.from(document.input.id).length, 128);
  assert.throws(
    () => normalizeGraphDocument({
      version: 1,
      input: { id: `${emoji128}😀` },
      output: { id: 'output' },
      nodes: [],
      edges: []
    }),
    error => error.code === 'GRAPH_DOCUMENT_ID' && error.path === '/input/id'
  );

  const serial = structuredClone(fixture.valid.find(entry => entry.name === 'serial').document);
  serial.edges[0].mixGroup = '';
  assert.throws(
    () => normalizeGraphDocument(serial),
    error => error.code === 'GRAPH_DOCUMENT_EDGE_CONTROL' &&
      error.path === '/edges/0/mixGroup'
  );
});

test('Graph node failures name the field that caused them', () => {
  const base = node => ({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [node],
    edges: [
      { id: 'in', source: 'input', destination: 'node' },
      { id: 'out', source: 'node', destination: 'output' }
    ]
  });
  const rejects = (node, expected) => assert.throws(
    () => normalizeGraphDocument(base(node)),
    error => error.name === expected.name && error.code === expected.code &&
      error.path === expected.path && error.nodeId === 'node',
    expected.path
  );

  // A rejected IRReverb.channelMode value is a parameter failure even though its
  // message mentions a channel.
  rejects({
    id: 'node',
    type: 'IRReverb',
    parameters: {
      channelMode: 'quadraphonic', latency: 0, convolutionRate: 'auto',
      wetLevel: 0, dryLevel: 0, preDelay: 0
    },
    assets: { impulseResponse: 'room-ir' }
  }, {
    name: 'ValidationError',
    code: 'GRAPH_DOCUMENT_PARAMETER',
    path: '/nodes/0/parameters/channelMode'
  });
  rejects({ id: 'node', type: 'Volume', parameters: { volume: 99 } }, {
    name: 'ValidationError',
    code: 'GRAPH_DOCUMENT_PARAMETER',
    path: '/nodes/0/parameters/volume'
  });
  rejects({ id: 'node', type: 'Volume', parameters: { gain: 0 } }, {
    name: 'ValidationError',
    code: 'GRAPH_DOCUMENT_PARAMETER',
    path: '/nodes/0/parameters/gain'
  });
  rejects({ id: 'node', type: 'Volume', channel: 'surround', parameters: { volume: 0 } }, {
    name: 'ValidationError',
    code: 'GRAPH_DOCUMENT_CHANNEL',
    path: '/nodes/0/channel'
  });
  rejects({ id: 'node', type: 'NotAnEffect', parameters: {} }, {
    name: 'EffectError',
    code: 'GRAPH_DOCUMENT_REFERENCE',
    path: '/nodes/0/type'
  });
});

test('Graph node asset failures keep AssetError and gain a document location', () => {
  const base = node => ({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [node],
    edges: [
      { id: 'in', source: 'input', destination: 'node' },
      { id: 'out', source: 'node', destination: 'output' }
    ]
  });
  const zeroLatencyIr = assets => ({
    id: 'node',
    type: 'IRReverb',
    parameters: {
      channelMode: 'automatic', latency: 0, convolutionRate: 'auto',
      wetLevel: 0, dryLevel: 0, preDelay: 0
    },
    ...(assets === undefined ? {} : { assets })
  });
  const rejects = (node, label) => assert.throws(
    () => normalizeGraphDocument(base(node)),
    error => error.name === 'AssetError' &&
      error.code === 'GRAPH_DOCUMENT_REFERENCE' &&
      error.path === '/nodes/0/assets' && error.nodeId === 'node',
    label
  );
  rejects(
    { id: 'node', type: 'Volume', parameters: { volume: 0 }, assets: { impulseResponse: 'x' } },
    'assets on an effect that declares none'
  );
  rejects(zeroLatencyIr(undefined), 'missing required assets');
  rejects(zeroLatencyIr({ bogus: 'x' }), 'unknown asset name');
  rejects(zeroLatencyIr({ impulseResponse: '' }), 'empty asset reference');
});

test('every Graph recipe rejects a positive-latency IRReverb with one message', () => {
  const wetPlusDryIr = {
    id: 'node',
    type: 'IRReverb',
    parameters: {
      channelMode: 'automatic', latency: 128, convolutionRate: 'auto',
      wetLevel: 0, dryLevel: 0, preDelay: 0
    },
    assets: { impulseResponse: 'room-ir' }
  };
  const expected =
    'IRReverb must be wet-only in a Graph; turn dryEnabled off or set dryLevel to -96 dB ' +
    '(the parameter minimum), then use the external dry edge.';
  const builders = [
    ['wetDry', () => createWetDryGraphDocument(wetPlusDryIr)],
    ['sendReturn', () => createSendReturnGraphDocument(wetPlusDryIr)],
    ['fromChain', () => graphDocumentFromChain({ version: 1, chain: [wetPlusDryIr] })]
  ];
  for (const [label, build] of builders) {
    assert.throws(
      build,
      error => error.name === 'ValidationError' &&
        error.code === 'GRAPH_UNSUPPORTED_CAPABILITY' &&
        error.path === '/nodes/0/parameters/dryLevel' &&
        error.nodeId === 'node' && error.message === expected,
      label
    );
  }
  const wetOnlyIr = {
    ...wetPlusDryIr,
    parameters: { ...wetPlusDryIr.parameters, dryLevel: -96 }
  };
  assert.doesNotThrow(() => createSendReturnGraphDocument(wetOnlyIr));
  const dryDisabledIr = {
    ...wetPlusDryIr,
    parameters: { ...wetPlusDryIr.parameters, dryEnabled: false }
  };
  assert.doesNotThrow(() => createSendReturnGraphDocument(dryDisabledIr));
});

test('Graph recipes reject a non-effect before deriving a node id', () => {
  for (const input of ['Volume', 5, null, ['Volume']]) {
    for (const build of [createWetDryGraphDocument, createSendReturnGraphDocument]) {
      assert.throws(
        () => build(input),
        error => error.name === 'ValidationError' &&
          error.code === 'GRAPH_DOCUMENT_REFERENCE' && error.path === '/nodes/0',
        JSON.stringify(input)
      );
    }
  }

  // A falsy explicit id is a caller mistake, not a request for the default id.
  for (const build of [createWetDryGraphDocument, createSendReturnGraphDocument]) {
    assert.throws(
      () => build({ id: '', type: 'Volume', parameters: { volume: 0 } }),
      error => error.code === 'GRAPH_DOCUMENT_ID' && error.path === '/nodes/0/id'
    );
    assert.throws(
      () => build({ id: 'kept', type: 'Volume', parameters: { volume: 0 } }, { nodeId: '' }),
      error => error.code === 'GRAPH_DOCUMENT_ID' && error.path === '/nodes/0/id'
    );
  }
});

test('Graph document errors speak Graph vocabulary and leave Chain wording alone', () => {
  assert.throws(
    () => normalizeGraphDocument({
      version: 1,
      input: { id: 'input' },
      output: { id: 'output' },
      nodes: [{ id: 'node', type: 'Volume', parameters: { volume: 0 }, bogus: 1 }],
      edges: [
        { id: 'in', source: 'input', destination: 'node' },
        { id: 'out', source: 'node', destination: 'output' }
      ]
    }),
    error => error.message === 'Graph node node has an unsupported field: bogus' &&
      error.code === 'GRAPH_DOCUMENT_REFERENCE' && error.path === '/nodes/0'
  );
  assert.throws(
    () => normalizeChainDocument({
      version: 1,
      chain: [{ type: 'Volume', parameters: { volume: 0 }, bogus: 1 }]
    }),
    error => error.message === 'Chain entry 0 has an unsupported field: bogus'
  );
  assert.throws(
    () => normalizeChainDocument([{ type: 'Volume' }]),
    error => error.message === 'Chain entry 0 requires a parameters object.'
  );
});

test('native invalid diagnostics map to stable document errors', () => {
  const state = _normalizeGraphInput(
    fixture.valid.find(entry => entry.name === 'serial').document
  );
  const invalidId = graphCompileError(-8, {
    kind: 1,
    index: 0,
    path: 2
  }, state);
  assert.equal(invalidId.name, 'ValidationError');
  assert.equal(invalidId.code, 'GRAPH_DOCUMENT_ID');
  assert.equal(invalidId.path, '/nodes/0/id');
  assert.equal(invalidId.nodeId, 'volume');

  const cycle = graphCompileError(-9, {
    kind: 2,
    index: 0,
    path: 13
  }, state);
  assert.equal(cycle.name, 'ValidationError');
  assert.equal(cycle.code, 'GRAPH_DOCUMENT_CYCLE');
  assert.equal(cycle.edgeId, 'input-volume');

  const irState = _normalizeGraphInput(
    fixture.valid.find(entry => entry.name === 'wet-dry-ir-diamond').document
  );
  const unsupported = graphCompileError(-13, { kind: 1, index: 0, path: 5 }, irState);
  assert.equal(unsupported.name, 'ValidationError');
  assert.equal(unsupported.code, 'GRAPH_UNSUPPORTED_CAPABILITY');
  assert.equal(unsupported.path, '/nodes/0/parameters/dryLevel');
  assert.equal(unsupported.nodeId, 'wet');
  assert.match(unsupported.message, /wet-only/);

  const planMemory = graphCompileError(-3, {}, irState);
  assert.equal(planMemory.name, 'EffeTuneRuntimeError');
  assert.equal(planMemory.code, 'GRAPH_PLAN_MEMORY');
});

test('Graph recipes expand to ordinary canonical edges', () => {
  const volume = createVolume({ id: 'return-level', volume: -3 });
  const sendReturn = createSendReturnGraphDocument(volume, { send: 0.25 });
  assert.deepEqual(sendReturn.edges.map(edge => edge.id), ['main', 'return', 'send']);
  assert.equal(sendReturn.edges.find(edge => edge.id === 'send').gain, 0.25);

  assert.throws(
    () => createWetDryGraphDocument({
      id: 'wet',
      type: 'IRReverb',
      parameters: {
        channelMode: 'automatic', latency: 128, convolutionRate: 'auto',
        wetLevel: 0, dryLevel: 0, preDelay: 0
      },
      assets: { impulseResponse: 'room-ir' }
    }),
    error => error.code === 'GRAPH_UNSUPPORTED_CAPABILITY' &&
      error.path === '/nodes/0/parameters/dryLevel'
  );

  assert.doesNotThrow(() => createWetDryGraphDocument({
    id: 'zero-latency-wet',
    type: 'IRReverb',
    parameters: {
      channelMode: 'automatic', latency: 0, convolutionRate: 'auto',
      wetLevel: 0, dryLevel: 0, preDelay: 0
    },
    assets: { impulseResponse: 'room-ir' }
  }));
});

test('disabled positive-latency IRReverb bypasses Graph ADC eligibility', () => {
  const disabledIr = {
    id: 'disabled-ir',
    type: 'IRReverb',
    enabled: false,
    parameters: {
      channelMode: 'automatic', latency: 128, convolutionRate: 'auto',
      wetLevel: 0, dryLevel: 0, preDelay: 0
    },
    assets: { impulseResponse: 'room-ir' }
  };
  const direct = normalizeGraphDocument({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [disabledIr],
    edges: [
      { id: 'in', source: 'input', destination: 'disabled-ir' },
      { id: 'out', source: 'disabled-ir', destination: 'output' }
    ]
  });
  assert.equal(direct.nodes[0].enabled, false);
  assert.equal(graphDocumentFromChain({ version: 1, chain: [disabledIr] }).nodes[0].enabled, false);
  assert.equal(createWetDryGraphDocument(disabledIr).nodes[0].enabled, false);

  assert.throws(
    () => graphDocumentFromChain({
      version: 1,
      chain: [{ ...disabledIr, enabled: true }]
    }),
    error => error.code === 'GRAPH_UNSUPPORTED_CAPABILITY' &&
      error.path === '/nodes/0/parameters/dryLevel'
  );
});

test('Graph recipe edge IDs avoid global identifier collisions deterministically', () => {
  const implicitReturn = createSendReturnGraphDocument({
    type: 'Volume',
    parameters: { volume: 0 }
  });
  assert.equal(implicitReturn.nodes[0].id, 'return');
  assert.deepEqual(implicitReturn.edges.map(edge => edge.id), ['main', 'return-2', 'send']);

  const sendReturn = createSendReturnGraphDocument({
    id: 'return',
    type: 'Volume',
    parameters: { volume: 0 }
  }, { inputId: 'main', outputId: 'send' });
  assert.equal(sendReturn.input.id, 'main');
  assert.equal(sendReturn.output.id, 'send');
  assert.equal(sendReturn.nodes[0].id, 'return');
  assert.deepEqual(sendReturn.edges.map(edge => edge.id), ['main-2', 'return-2', 'send-2']);

  const wetDry = createWetDryGraphDocument({
    id: 'dry',
    type: 'Volume',
    parameters: { volume: 0 }
  }, { inputId: 'wet-input', outputId: 'wet-output' });
  assert.equal(wetDry.input.id, 'wet-input');
  assert.equal(wetDry.output.id, 'wet-output');
  assert.equal(wetDry.nodes[0].id, 'dry');
  assert.deepEqual(wetDry.edges.map(edge => edge.id), ['dry-2', 'wet-input-2', 'wet-output-2']);
});

test('visualization joins compile states without pruning structural entries', () => {
  const entry = fixture.valid.find(candidate => candidate.name === 'serial');
  const document = normalizeGraphDocument(entry.document);
  const snapshot = graphVisualizationSnapshot(document, {
    nodes: document.nodes.map(node => ({
      id: node.id,
      effective: false,
      dormant: true,
      disabledBypass: false
    })),
    edges: document.edges.map((edge, index) => ({
      id: edge.id,
      active: false,
      suppressed: index === 0,
      dormant: index !== 0
    }))
  });
  assert.equal(snapshot.nodes.length, document.nodes.length + 2);
  assert.equal(snapshot.nodes.find(node => node.kind === 'effect').state, 'dormant');
  assert.equal(snapshot.edges.length, document.edges.length);
  assert.equal(snapshot.edges[0].state, 'suppressed');
});

test('structuralSnapshot exposes the document, topological order, and adjacency', async () => {
  const entry = fixture.valid.find(candidate => candidate.name === 'serial');
  const graph = await createGraph(entry.document);
  const snapshot = graph.structuralSnapshot();
  assert.deepEqual(Object.keys(snapshot), ['document', 'topologicalOrder', 'incoming', 'outgoing']);
  assert.deepEqual(snapshot.document, graph.toJSON());
  assert.deepEqual(snapshot.topologicalOrder, ['volume']);
  assert.deepEqual(snapshot.incoming, {
    input: [],
    volume: ['input-volume'],
    output: ['volume-output']
  });
  assert.deepEqual(snapshot.outgoing, {
    input: ['input-volume'],
    volume: ['volume-output'],
    output: []
  });
  assert.ok(Object.isFrozen(snapshot));
  graph.close();
});

test('structuralSnapshot preserves object-prototype Graph IDs as own adjacency keys', async () => {
  const graph = await createGraph({
    version: 1,
    input: { id: '__proto__' },
    output: { id: 'constructor' },
    nodes: [],
    edges: [{ id: 'toString', source: '__proto__', destination: 'constructor' }]
  });
  const snapshot = graph.structuralSnapshot();
  assert.ok(Object.hasOwn(snapshot.incoming, '__proto__'));
  assert.ok(Object.hasOwn(snapshot.outgoing, 'constructor'));
  assert.deepEqual(snapshot.incoming.__proto__, []);
  assert.deepEqual(snapshot.outgoing.__proto__, ['toString']);
  assert.deepEqual(snapshot.incoming.constructor, ['toString']);
  assert.deepEqual(snapshot.outgoing.constructor, []);
  graph.close();
});

test('Graph asset resolution is deferred to effective streams and inherited from Chain', async () => {
  let dormantResolutions = 0;
  const dormantEffect = new IRReverb({
    id: 'room',
    assets: { impulseResponse: 'room-ir' },
    latency: 0,
    dryLevel: 0
  }).toJSON();
  const dormant = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [dormantEffect],
    edges: [
      { id: 'in', source: 'input', destination: 'room' },
      { id: 'out', source: 'room', destination: 'output', mute: true }
    ]
  }, {
    variant: 'baseline',
    assetResolver() {
      dormantResolutions++;
      throw new Error('dormant asset must not resolve');
    }
  });
  assert.equal(dormantResolutions, 0);
  const dormantStream = await dormant.stream({ sampleRate: 48000, channels: 2, blockSize: 8 });
  const dormantOutput = await dormantStream.process([
    Float32Array.of(1, 1),
    Float32Array.of(1, 1)
  ]);
  assert.deepEqual(dormantOutput.map(channel => Array.from(channel)), [[0, 0], [0, 0]]);
  assert.equal(dormantResolutions, 0);
  dormantStream.close();
  dormant.close();

  const payload = encodeEta1({
    channels: [Float32Array.of(1)],
    sampleRate: 48000,
    topology: 'mono'
  });
  let chainResolutions = 0;
  const chain = await createChain([new IRReverb({
    id: 'resolved-room',
    assets: { impulseResponse: 'room-ir' },
    channelMode: 'mono',
    latency: 0,
    convolutionRate: 'full',
    dryLevel: -96
  })], {
    variant: 'baseline',
    assetResolver() {
      chainResolutions++;
      return payload;
    }
  });
  const inherited = await Graph.fromChain(chain);
  const inheritedStream = await inherited.stream({
    sampleRate: 48000,
    channels: 1,
    blockSize: 8
  });
  assert.equal(chainResolutions, 1);
  inheritedStream.close();
  inherited.close();
  chain.close();
});

test('Graph keeps equal session seeds while assigning stable ordinals to two IR nodes', async () => {
  const ir = new Float32Array(131072);
  ir[0] = 1;
  const payload = encodeEta1({
    channels: [ir, ir],
    sampleRate: 48000,
    topology: 'independent'
  });
  const room = id => new IRReverb({
    id,
    assets: { impulseResponse: 'room-ir' },
    channelMode: 'independent',
    latency: 128,
    convolutionRate: 'full',
    dryEnabled: false,
    dryLevel: -96
  }).toJSON();
  const graph = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [room('first-room'), room('second-room')],
    edges: [
      { id: 'first-in', source: 'input', destination: 'first-room' },
      { id: 'first-out', source: 'first-room', destination: 'output' },
      { id: 'second-in', source: 'input', destination: 'second-room' },
      { id: 'second-out', source: 'second-room', destination: 'output' }
    ]
  }, {
    variant: 'baseline',
    assetResolver: () => payload
  });
  const open = () => graph.stream({
    sampleRate: 48000,
    channels: 2,
    blockSize: 128,
    seed: 0x12345678
  });
  const first = await open();
  try {
    assert.equal(first._session.seed, 0x12345678);
    assert.deepEqual(
      first._session.nodes.map(node => node.instanceId & 0xffff),
      [1, 2]
    );
    first.reset();
  } finally {
    first.close();
  }
  const rebuilt = await open();
  try {
    assert.equal(rebuilt._session.seed, 0x12345678);
    assert.deepEqual(
      rebuilt._session.nodes.map(node => node.instanceId & 0xffff),
      [1, 2]
    );
  } finally {
    rebuilt.close();
    graph.close();
  }
});

test('Graph asset preparation failures name the node whose asset failed', async () => {
  const document = {
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [new IRReverb({
      id: 'room',
      assets: { impulseResponse: 'room-ir' },
      channelMode: 'mono',
      latency: 0,
      convolutionRate: 'full',
      dryLevel: -96
    }).toJSON()],
    edges: [
      { id: 'in', source: 'input', destination: 'room' },
      { id: 'out', source: 'room', destination: 'output' }
    ]
  };
  const openStream = async assetResolver => {
    const graph = await createGraph(document, { variant: 'baseline', assetResolver });
    try {
      const stream = await graph.stream({ sampleRate: 48000, channels: 1, blockSize: 8 });
      stream.close();
    } finally {
      graph.close();
    }
  };
  const rejects = async (label, assetResolver) => {
    await assert.rejects(
      openStream(assetResolver),
      error => error.name === 'AssetError' &&
        error.code === 'GRAPH_INSTANCE_PREPARE' &&
        error.path === '/nodes/0/assets' && error.nodeId === 'room',
      label
    );
  };
  const payloadAt = sampleRate => encodeEta1({
    channels: [Float32Array.of(1)],
    sampleRate,
    topology: 'mono'
  });
  await rejects('no resolver', undefined);
  await rejects('resolver throws', () => { throw new Error('boom'); });
  await rejects('resolver returns nothing', () => null);
  await rejects('resolver returns non-binary data', () => ({ nope: true }));
  await rejects('impulse response at the wrong rate', () => payloadAt(44100));
  await openStream(() => payloadAt(48000));

  // The Chain entry point keeps its plain AssetError: the Graph diagnostics are Graph-only.
  await assert.rejects(
    createChain([new IRReverb({
      id: 'room',
      assets: { impulseResponse: 'room-ir' },
      channelMode: 'mono',
      latency: 0,
      convolutionRate: 'full',
      dryLevel: -96
    })], { variant: 'baseline' }),
    error => error.name === 'AssetError' && error.code === undefined &&
      error.path === undefined && error.nodeId === undefined
  );
});

test('GraphStream uses Graph-owned safe updates and reset with joined visualization', async () => {
  const nodeId = '😀'.repeat(128);
  const node = { ...createVolume({ volume: -6 }).toJSON(), id: nodeId };
  const graph = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [node],
    edges: [
      { id: 'input-edge', source: 'input', destination: nodeId },
      { id: 'output-edge', source: nodeId, destination: 'output' }
    ]
  }, { variant: 'baseline' });
  const stream = await graph.stream({ sampleRate: 48000, channels: 2, blockSize: 64 });
  const input = [new Float32Array(64).fill(1), new Float32Array(64).fill(1)];
  const initial = await stream.process(input);
  const initialGain = 10 ** (-6 / 20);
  assert.ok(initial.every(channel => channel.every(sample => Math.abs(sample - initialGain) < 1e-5)));
  const visual = stream.visualizationSnapshot();
  const visualNode = visual.nodes.find(entry => entry.kind === 'effect');
  assert.equal(visualNode.id, nodeId);
  assert.equal(visualNode.effective, true);
  assert.equal(visualNode.dormant, false);
  assert.equal(visualNode.disabledBypass, false);
  assert.equal(visualNode.state, 'effective');

  stream.setParam(nodeId, 'volume', -12);
  const updated = await stream.process(input);
  const updatedGain = 10 ** (-12 / 20);
  assert.ok(updated.every(channel => channel.every(sample => Math.abs(sample - updatedGain) < 1e-5)));
  stream.reset();
  const reset = await stream.process(input);
  assert.deepEqual(reset.map(channel => Array.from(channel)), initial.map(channel => Array.from(channel)));
  stream.close();
  graph.close();
});

test('effective instance capacity fails before native instance creation', async () => {
  const nodes = Array.from({ length: 97 }, (_, index) =>
    createVolume({ id: `node-${String(index).padStart(3, '0')}` }).toJSON()
  );
  const edges = nodes.map((node, index) => ({
    id: `edge-${String(index).padStart(3, '0')}`,
    source: index === 0 ? 'input' : nodes[index - 1].id,
    destination: node.id
  }));
  edges.push({ id: 'edge-097', source: nodes.at(-1).id, destination: 'output' });
  const graph = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes,
    edges
  }, { variant: 'baseline' });
  await assert.rejects(
    graph.stream({ sampleRate: 48000, channels: 2 }),
    error => error.code === 'GRAPH_CAPACITY' &&
      error.path === '/nodes/96' && error.nodeId === 'node-096'
  );
  graph.close();
});

test('structural node and edge capacity fail before native preparation', async () => {
  const nodes = Array.from({ length: 129 }, (_, index) =>
    createVolume({ id: `node-${String(index).padStart(3, '0')}` }).toJSON()
  );
  const edges = nodes.map((node, index) => ({
    id: `edge-${String(index).padStart(3, '0')}`,
    source: index === 0 ? 'input' : nodes[index - 1].id,
    destination: node.id
  }));
  edges.push({ id: 'edge-129', source: nodes.at(-1).id, destination: 'output' });
  const deep = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes,
    edges
  }, { variant: 'baseline' });
  await assert.rejects(
    deep.stream({ sampleRate: 48000, channels: 2 }),
    error => error.code === 'GRAPH_CAPACITY' && error.path === '/nodes/128' &&
      error.nodeId === 'node-128' && /structural node capacity \(128\)/.test(error.message)
  );
  deep.close();

  const wide = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [],
    edges: Array.from({ length: 513 }, (_, index) => ({
      id: `edge-${String(index).padStart(3, '0')}`,
      source: 'input',
      destination: 'output'
    }))
  }, { variant: 'baseline' });
  await assert.rejects(
    wide.stream({ sampleRate: 48000, channels: 2 }),
    error => error.code === 'GRAPH_CAPACITY' && error.path === '/edges/512' &&
      error.edgeId === 'edge-512' && /edge capacity \(512\)/.test(error.message)
  );
  wide.close();
});

test('GraphStream separates unknown, dormant, and rejected parameter updates', async () => {
  const graph = await createGraph({
    version: 1,
    input: { id: 'input' },
    output: { id: 'output' },
    nodes: [
      { ...createVolume({ volume: -6 }).toJSON(), id: 'a' },
      { ...createVolume({ volume: -6 }).toJSON(), id: 'b' },
      { ...createVolume({ volume: -6 }).toJSON(), id: 'c', enabled: false },
      { ...createVolume({ volume: -6 }).toJSON(), id: 'd', enabled: false }
    ],
    edges: [
      { id: 'a-in', source: 'input', destination: 'a' },
      { id: 'a-out', source: 'a', destination: 'output' },
      { id: 'b-in', source: 'input', destination: 'b' },
      { id: 'b-out', source: 'b', destination: 'output', mute: true },
      { id: 'c-in', source: 'input', destination: 'c' },
      { id: 'c-out', source: 'c', destination: 'output' },
      { id: 'd-in', source: 'input', destination: 'd' },
      { id: 'd-out', source: 'd', destination: 'output', mute: true }
    ]
  }, { variant: 'baseline' });
  const stream = await graph.stream({ sampleRate: 48000, channels: 2, blockSize: 8 });
  try {
    const dormant = stream.compileSnapshot.nodes.find(node => node.id === 'b');
    assert.equal(dormant.dormant, true);
    assert.equal(dormant.scheduleIndex, null);
    assert.equal(dormant.bufferSlot, null);
    const effective = stream.compileSnapshot.nodes.find(node => node.id === 'a');
    assert.equal(typeof effective.scheduleIndex, 'number');
    assert.equal(typeof effective.bufferSlot, 'number');

    assert.throws(
      () => stream.setParam('missing', 'volume', -6),
      error => error.name === 'ValidationError' &&
        error.code === 'GRAPH_DOCUMENT_REFERENCE' && error.nodeId === 'missing' &&
        /unknown Graph node/i.test(error.message)
    );
    assert.throws(
      () => stream.setParam('b', 'volume', -6),
      error => error.code === 'GRAPH_RECONFIGURATION_REQUIRED' &&
        error.path === '/nodes/1' && error.nodeId === 'b'
    );
    assert.throws(
      () => stream.setParam('c', 'volume', -6),
      error => error.code === 'GRAPH_RECONFIGURATION_REQUIRED' && error.path === '/nodes/2' &&
        error.nodeId === 'c' && /disabled and bypassed/.test(error.message)
    );
    // Enabling a dormant node would not make it effective, so it keeps the routing wording.
    assert.equal(stream.compileSnapshot.nodes.find(entry => entry.id === 'd').dormant, true);
    assert.throws(
      () => stream.setParam('d', 'volume', -6),
      error => error.code === 'GRAPH_RECONFIGURATION_REQUIRED' && error.path === '/nodes/3' &&
        error.nodeId === 'd' && /is not effective/.test(error.message)
    );
    assert.throws(
      () => stream.setParam('a', 'volume', 99),
      error => error.code === 'GRAPH_DOCUMENT_PARAMETER' &&
        error.path === '/nodes/0/parameters/volume' && error.nodeId === 'a'
    );
    assert.throws(
      () => stream.setParam('a', 'gain', 0),
      error => error.code === 'GRAPH_DOCUMENT_PARAMETER' &&
        error.path === '/nodes/0/parameters/gain' && error.nodeId === 'a'
    );
  } finally {
    stream.close();
    graph.close();
  }
});

test('a serial Graph with identity edges converts explicitly to Chain v1', async () => {
  const entry = fixture.valid.find(candidate => candidate.name === 'serial');
  const graph = await createGraph(entry.document);
  const chain = graph.toChain();
  assert.equal(chain.version, 1);
  assert.deepEqual(chain.chain.map(effect => effect.id), graph.toJSON().nodes.map(node => node.id));
  graph.close();

  const branched = await createGraph(createSendReturnGraphDocument(createVolume({ id: 'return-level' })));
  assert.throws(
    () => branched.toChain(),
    error => error.code === 'GRAPH_DOCUMENT_CONNECTIVITY'
  );
  branched.close();
});

test('empty Graph is a detached zero-latency identity stream', async () => {
  const graph = await createGraph(fixture.valid[0].document);
  assert.ok(graph instanceof Graph);
  const serialized = graph.toJSON();
  serialized.input.id = 'changed';
  assert.equal(graph.toJSON().input.id, 'input');
  const stream = await graph.stream({ sampleRate: 48_000, channels: 2 });
  const input = [Float32Array.of(1, 2), Float32Array.of(3, 4)];
  const output = await stream.process(input);
  assert.deepEqual(output.map(channel => Array.from(channel)), input.map(channel => Array.from(channel)));
  assert.notEqual(output[0], input[0]);
  assert.equal(stream.latencySamples, 0);
  assert.equal(stream.compileSnapshot.identity, true);
  stream.close();
  graph.close();
});

test('GraphStream rejects options and scheduled events without advancing state', async () => {
  const graph = await createGraph(fixture.valid[0].document);
  const stream = await graph.stream({ sampleRate: 48_000, channels: 2 });
  const input = [Float32Array.of(1, 2), Float32Array.of(3, 4)];
  try {
    for (const options of [undefined, {}, { events: [] }]) {
      await assert.rejects(
        stream.process(input, options),
        error => error.name === 'ValidationError' && /scheduled events/.test(error.message)
      );
    }
    const output = await stream.process(input);
    assert.deepEqual(
      output.map(channel => Array.from(channel)),
      input.map(channel => Array.from(channel))
    );
  } finally {
    stream.close();
    graph.close();
  }
});

test('pan presence is rejected when opening a non-stereo Graph stream', async () => {
  const entry = fixture.invalid.find(candidate => candidate.name === 'pan-on-mono-stream');
  const graph = await createGraph(entry.document);
  await assert.rejects(
    graph.stream({ sampleRate: 48_000, channels: entry.streamChannels }),
    error => error.code === entry.code && error.path === entry.path
  );
  graph.close();
});
