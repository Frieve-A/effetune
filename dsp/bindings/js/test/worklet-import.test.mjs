import assert from 'node:assert/strict';
import test from 'node:test';

test('worklet entry imports without browser globals and exposes the wrapper', async () => {
  const module = await import('../dist/worklet.js');
  assert.equal(typeof module.EffeTuneNode.create, 'function');
});

test('package processor registers its package-owned processor', async () => {
  const priorProcessor = globalThis.AudioWorkletProcessor;
  const priorRegister = globalThis.registerProcessor;
  const priorSampleRate = globalThis.sampleRate;
  let registration;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  };
  globalThis.registerProcessor = (name, Processor) => {
    registration = { name, Processor };
  };
  globalThis.sampleRate = 48000;
  try {
    await import(`../dist/worklet-processor.js?test=${Date.now()}`);
    assert.equal(registration.name, 'effetune-dsp-processor');
    assert.equal(typeof registration.Processor, 'function');
  } finally {
    if (priorProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = priorProcessor;
    if (priorRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = priorRegister;
    if (priorSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = priorSampleRate;
  }
});

test('worklet protocol restores public errors and reset restores the initial document', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  class FakeAudioWorkletNode extends EventTarget {
    constructor() {
      super();
      this.port = {
        messages: [],
        postMessage: message => this.port.messages.push(message),
        start() {},
        onmessage: null
      };
    }

    disconnect() {}
  }
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const [{ EffeTuneNode }, { AssetError, ValidationError }] = await Promise.all([
      import(`../dist/worklet.js?protocol=${Date.now()}`),
      import('../dist/index.js')
    ]);
    const document = {
      version: 1,
      chain: [{
        id: 'gain',
        type: 'Volume',
        enabled: true,
        channel: 'all',
        parameters: { volume: -6 }
      }]
    };
    const node = new EffeTuneNode({}, 2, document, 42);
    const update = node.setParam('gain', 'volume', -12);
    await Promise.resolve();
    const updateCommand = node.port.messages.at(-1);
    node._handleMessage({
      type: 'commandResult',
      commandId: updateCommand.commandId,
      ok: true
    });
    await update;
    assert.equal(node._document.chain[0].parameters.volume, -12);

    const reset = node.reset();
    await Promise.resolve();
    const resetCommand = node.port.messages.at(-1);
    node._handleMessage({
      type: 'commandResult',
      commandId: resetCommand.commandId,
      ok: true
    });
    await reset;
    assert.equal(node._document.chain[0].parameters.volume, -6);

    const command = node._command({ type: 'test' });
    const commandMessage = node.port.messages.at(-1);
    node._handleMessage({
      type: 'commandResult',
      commandId: commandMessage.commandId,
      ok: false,
      errorType: 'ValidationError',
      message: 'invalid'
    });
    await assert.rejects(command, ValidationError);
    node.close();

    const failed = new EffeTuneNode({}, 2, document, 42);
    const ready = failed._waitUntilReady();
    failed._handleMessage({
      type: 'initializationError',
      errorType: 'AssetError',
      message: 'missing asset'
    });
    await assert.rejects(ready, AssetError);
    failed.close();
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});

test('worklet rejects asset reconfiguration before posting a native command', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  class FakeAudioWorkletNode extends EventTarget {
    constructor() {
      super();
      this.port = {
        messages: [],
        postMessage: message => this.port.messages.push(message),
        start() {},
        onmessage: null
      };
    }

    disconnect() {}
  }
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const [{ EffeTuneNode }, { ValidationError }] = await Promise.all([
      import(`../dist/worklet.js?asset-reconfiguration=${Date.now()}`),
      import('../dist/index.js')
    ]);
    const cases = [
      ['FIRCrossover', ['bandCount', 'latencyMode', 'filterDelaySamples']],
      ['FiveBandFIRPEQ', ['latencyMode', 'filterDelaySamples']],
      ['GroupDelayEQ', ['latencyMode', 'filterDelaySamples']],
      ['IRReverb', ['channelMode', 'latency', 'convolutionRate']],
      ['RoomEQ', ['latencyMode', 'filterDelaySamples']]
    ];
    const document = {
      version: 1,
      chain: cases.map(([type], index) => ({
        id: `effect-${index}`,
        type,
        enabled: true,
        channel: 'all',
        parameters: {}
      }))
    };
    const node = new EffeTuneNode({}, 2, document, 42);
    for (const [index, [type, parameters]] of cases.entries()) {
      for (const parameter of parameters) {
        await assert.rejects(
          node.setParam(`effect-${index}`, parameter, null),
          error => error instanceof ValidationError &&
            error.message.includes(`${type}.${parameter}`) &&
            error.message.includes('cannot be updated while a stream is open')
        );
      }
    }
    assert.equal(node.port.messages.length, 0);
    assert.ok(node._document.chain.every(effect =>
      Object.keys(effect.parameters).length === 0
    ));
    node.close();
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});

test('worklet telemetry callbacks run on the node side with opt-in lifetime', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  class FakeAudioWorkletNode extends EventTarget {
    constructor() {
      super();
      this.port = {
        messages: [],
        postMessage: message => this.port.messages.push(message),
        start() {},
        onmessage: null
      };
    }

    disconnect() {}
  }
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const { EffeTuneNode } = await import(`../dist/worklet.js?telemetry=${Date.now()}`);
    const document = {
      version: 1,
      chain: [{
        id: 'meter',
        type: 'LevelMeter',
        enabled: true,
        channel: 'all',
        parameters: {}
      }]
    };
    const node = new EffeTuneNode({}, 2, document, 42);
    const received = [];
    const callback = frame => received.push(frame);
    const unsubscribe = node.subscribe(callback);
    assert.deepEqual(node.port.messages.at(-1), {
      type: 'setTelemetryEnabled',
      enabled: true
    });

    const packet = new ArrayBuffer(256 * 1024);
    const view = new DataView(packet);
    view.setUint16(0, 1, true);
    view.setUint16(2, 1, true);
    view.setUint32(4, 1, true);
    view.setUint32(8, 7, true);
    view.setUint16(12, 24, true);
    view.setUint32(16, 2, true);
    view.setFloat32(20, 0.5, true);
    view.setFloat32(24, 0.25, true);
    view.setFloat32(28, 0.75, true);
    view.setFloat32(32, 0.5, true);
    view.setUint32(36, 2, true);
    node._handleMessage({ type: 'telemetry', packet, bytes: 40, dropped: 3 });
    assert.equal(received.length, 1);
    assert.equal(received[0].kind, 'level');
    assert.equal(received[0].effectId, 'meter');
    assert.equal(received[0].sequence, 7);
    assert.equal(received[0].dropped, 3);
    assert.equal(received[0].channels[1].clipped, true);
    assert.equal(node.droppedTelemetryFrames, 3);
    assert.equal(node.port.messages.at(-1).type, 'telemetryReturn');

    assert.equal(unsubscribe(), true);
    assert.deepEqual(node.port.messages.at(-1), {
      type: 'setTelemetryEnabled',
      enabled: false
    });
    assert.equal(node.unsubscribe(callback), false);
    node.close();
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});

test('worklet validates unavailable mono channel selections before loading the processor', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage() {}, start() {}, onmessage: null };
    }
  };
  try {
    const [{ EffeTuneNode }, { ValidationError }] = await Promise.all([
      import(`../dist/worklet.js?channels=${Date.now()}`),
      import('../dist/index.js')
    ]);
    await assert.rejects(
      EffeTuneNode.create(
        { sampleRate: 48000 },
        {
          version: 1,
          chain: [{
            type: 'Volume',
            channel: 'right',
            parameters: {}
          }]
        },
        { channels: 1 }
      ),
      ValidationError
    );
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});

test('worklet module failures are public runtime errors and failed loads are retryable', async () => {
  const [{ EffeTuneNode }, { EffeTuneRuntimeError }] = await Promise.all([
    import(`../dist/worklet.js?module-failure=${Date.now()}`),
    import('../dist/index.js')
  ]);
  for (const synchronous of [true, false]) {
    let calls = 0;
    const context = {
      sampleRate: 48000,
      audioWorklet: {
        addModule() {
          calls++;
          if (synchronous) throw new Error('sync module failure');
          return Promise.reject(new Error('async module failure'));
        }
      }
    };
    await assert.rejects(EffeTuneNode.create(context, []), EffeTuneRuntimeError);
    await assert.rejects(EffeTuneNode.create(context, []), EffeTuneRuntimeError);
    assert.equal(calls, 2);
  }
});

test('worklet mutations serialize document calculation, commands, commits, and recovery', async () => {
  const priorNode = globalThis.AudioWorkletNode;
  class FakeAudioWorkletNode extends EventTarget {
    constructor() {
      super();
      this.port = {
        messages: [],
        postMessage: message => this.port.messages.push(message),
        start() {},
        onmessage: null
      };
    }

    disconnect() {}
  }
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const [{ EffeTuneNode }, { ValidationError }] = await Promise.all([
      import(`../dist/worklet.js?mutations=${Date.now()}`),
      import('../dist/index.js')
    ]);
    const document = {
      version: 1,
      chain: [{
        id: 'compressor',
        type: 'Compressor',
        enabled: true,
        channel: 'all',
        parameters: { threshold: -24, ratio: 2 }
      }]
    };
    const node = new EffeTuneNode({}, 2, document, 42);
    const first = node.setParam('compressor', 'threshold', -12);
    const second = node.setParam('compressor', 'ratio', 4);
    await Promise.resolve();
    assert.equal(node.port.messages.length, 1);
    node._handleMessage({
      type: 'commandResult',
      commandId: node.port.messages[0].commandId,
      ok: false,
      errorType: 'ValidationError',
      message: 'rejected'
    });
    await assert.rejects(first, ValidationError);
    await Promise.resolve();
    assert.equal(node.port.messages.length, 2);
    node._handleMessage({
      type: 'commandResult',
      commandId: node.port.messages[1].commandId,
      ok: true
    });
    await second;
    assert.equal(node._document.chain[0].parameters.threshold, -24);
    assert.equal(node._document.chain[0].parameters.ratio, 4);

    const update = node.setParam('compressor', 'threshold', -6);
    const reset = node.reset();
    await Promise.resolve();
    const updateCommand = node.port.messages.at(-1);
    node._handleMessage({
      type: 'commandResult',
      commandId: updateCommand.commandId,
      ok: true
    });
    await update;
    await Promise.resolve();
    const resetCommand = node.port.messages.at(-1);
    assert.equal(resetCommand.type, 'reset');
    node._handleMessage({
      type: 'commandResult',
      commandId: resetCommand.commandId,
      ok: true
    });
    await reset;
    assert.equal(node._document.chain[0].parameters.threshold, -24);
    assert.equal(node._document.chain[0].parameters.ratio, 2);
    node.close();
  } finally {
    if (priorNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = priorNode;
  }
});
