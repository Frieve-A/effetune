import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES,
  DSP_PIPELINE_DESCRIPTOR_NODE_BYTES,
  DSP_PIPELINE_DESCRIPTOR_VERSION,
  DspPipelineDescriptorError,
  buildDspPipelineDescriptor,
  buildDspPipelineNodes,
  decodeDspChannelSpec,
  decodeDspPipelineDescriptor,
  encodeDspChannelSpec,
  encodeDspPipelineDescriptor,
  isValidEncodedChannelSpec
} from '../../js/audio/dsp-pipeline-descriptor.js';

class SectionPlugin {
  constructor(enabled) {
    this.enabled = enabled;
  }
}

class VolumePlugin {
  constructor(id, options = {}) {
    this.id = id;
    this.enabled = options.enabled ?? true;
    this.inputBus = options.inputBus;
    this.outputBus = options.outputBus;
    this.channel = options.channel;
    this.parameters = options.parameters || {};
  }
}

test('channel codec matches every host routing representation', () => {
  const cases = [
    [null, -1], [undefined, -1], ['A', -2], ['L', 0], ['R', 1],
    ['1', 0], ['2', 1], ['3', 2], ['8', 7], ['34', 17], ['56', 18], ['78', 19]
  ];
  for (const [channel, encoded] of cases) {
    assert.equal(encodeDspChannelSpec(channel), encoded);
    assert.equal(isValidEncodedChannelSpec(encoded), true);
  }
  assert.equal(decodeDspChannelSpec(-2), 'A');
  assert.equal(decodeDspChannelSpec(-1), null);
  assert.equal(decodeDspChannelSpec(0), 'L');
  assert.equal(decodeDspChannelSpec(1), 'R');
  assert.equal(decodeDspChannelSpec(2), '3');
  assert.equal(decodeDspChannelSpec(16), null);
  assert.equal(decodeDspChannelSpec(17), '34');
  assert.equal(decodeDspChannelSpec(18), '56');
  assert.equal(decodeDspChannelSpec(19), '78');
  assert.equal(isValidEncodedChannelSpec(8), false);
  assert.throws(() => encodeDspChannelSpec(''), DspPipelineDescriptorError);
  assert.throws(() => encodeDspChannelSpec('bad'), DspPipelineDescriptorError);
  assert.throws(() => decodeDspChannelSpec(20), DspPipelineDescriptorError);

  for (const encoded of [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19]) {
    const canonical = encoded === 16 ? -1 : encoded;
    assert.equal(encodeDspChannelSpec(decodeDspChannelSpec(encoded)), canonical);
  }
});

test('descriptor encoder writes the exact little-endian ABI record layout', () => {
  const descriptor = encodeDspPipelineDescriptor([
    {
      instanceId: 0x12345678,
      enabled: true,
      inputBus: 2,
      outputBus: 4,
      channel: '34',
      sectionGate: false
    }
  ]);
  assert.equal(descriptor.byteLength, DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES + DSP_PIPELINE_DESCRIPTOR_NODE_BYTES);
  assert.deepEqual([...descriptor], [
    1, 0, 0, 0,
    1, 0, 0, 0,
    0x78, 0x56, 0x34, 0x12,
    1, 2, 4, 17, 0, 0, 0, 0
  ]);
  assert.deepEqual(decodeDspPipelineDescriptor(descriptor), {
    version: DSP_PIPELINE_DESCRIPTOR_VERSION,
    nodes: [{
      instanceId: 0x12345678,
      enabled: 1,
      inputBus: 2,
      outputBus: 4,
      channelSpec: 17,
      sectionGate: 0
    }]
  });

  const wrapped = new Uint8Array(descriptor.byteLength + 4);
  wrapped.set(descriptor, 2);
  assert.equal(decodeDspPipelineDescriptor(wrapped.subarray(2, -2)).nodes.length, 1);
  assert.equal(decodeDspPipelineDescriptor(encodeDspPipelineDescriptor([])).nodes.length, 0);
});

test('pipeline builder keeps enabled and section gate semantics independent', () => {
  const before = new VolumePlugin('before', { inputBus: 1, outputBus: 2, channel: 'L' });
  const disabled = new VolumePlugin('disabled', { enabled: false });
  const gated = new VolumePlugin('gated', { channel: 'R' });
  const active = new VolumePlugin('active', {
    parameters: { inputBus: 3, outputBus: 4, channel: 'A' }
  });
  const pipeline = [
    before,
    disabled,
    new SectionPlugin(false),
    gated,
    new SectionPlugin(true),
    active
  ];
  const ids = new Map([['before', 1], ['disabled', 2], ['gated', 3], ['active', 4]]);
  const options = {
    getInstanceId: plugin => ids.get(plugin.id),
    getParameters: plugin => plugin.parameters
  };

  assert.deepEqual(buildDspPipelineNodes(pipeline, options), [
    { instanceId: 1, enabled: true, inputBus: 1, outputBus: 2, channel: 'L', sectionGate: true },
    { instanceId: 2, enabled: false, inputBus: 0, outputBus: 0, channel: null, sectionGate: true },
    { instanceId: 3, enabled: true, inputBus: 0, outputBus: 0, channel: 'R', sectionGate: false },
    { instanceId: 4, enabled: true, inputBus: 3, outputBus: 4, channel: 'A', sectionGate: true }
  ]);
  assert.deepEqual(buildDspPipelineNodes(pipeline, { ...options, omitInactive: true }), [
    { instanceId: 1, enabled: true, inputBus: 1, outputBus: 2, channel: 'L', sectionGate: true },
    { instanceId: 4, enabled: true, inputBus: 3, outputBus: 4, channel: 'A', sectionGate: true }
  ]);
  const decoded = decodeDspPipelineDescriptor(buildDspPipelineDescriptor(pipeline, options));
  assert.equal(decoded.nodes.length, 4);
  assert.equal(decoded.nodes[2].sectionGate, 0);
});

test('descriptor validation rejects values the native decoder cannot accept', () => {
  const validNode = {
    instanceId: 1,
    enabled: true,
    inputBus: 0,
    outputBus: 0,
    channel: null,
    sectionGate: true
  };
  assert.throws(() => encodeDspPipelineDescriptor(null), /must be an array/);
  assert.throws(() => encodeDspPipelineDescriptor([null]), /must be an object/);
  assert.throws(() => encodeDspPipelineDescriptor([{ ...validNode, instanceId: 0 }]), /nonzero uint32/);
  assert.throws(() => encodeDspPipelineDescriptor([{ ...validNode, enabled: 'yes' }]), /boolean/);
  assert.throws(() => encodeDspPipelineDescriptor([{ ...validNode, inputBus: 5 }]), /input bus/);
  assert.throws(() => encodeDspPipelineDescriptor([{ ...validNode, outputBus: -1 }]), /output bus/);
  assert.throws(() => encodeDspPipelineDescriptor([{ ...validNode, channelSpec: 8 }]), /channel specifier/);
  assert.throws(() => encodeDspPipelineDescriptor([{ ...validNode, sectionGate: 2 }]), /section gate/);
  assert.throws(() => encodeDspPipelineDescriptor([validNode, validNode]), /Duplicate/);
  assert.throws(
    () => encodeDspPipelineDescriptor(Array.from({ length: 129 }, (_, index) => ({
      ...validNode,
      instanceId: index + 1
    }))),
    /exceeds 128/
  );
});

test('descriptor decoder rejects malformed headers, records, padding, and duplicates', () => {
  const makeDescriptor = () => encodeDspPipelineDescriptor([{
    instanceId: 1,
    enabled: true,
    inputBus: 0,
    outputBus: 1,
    channel: 'A',
    sectionGate: true
  }]);
  const mutate = callback => {
    const bytes = makeDescriptor();
    callback(bytes, new DataView(bytes.buffer));
    return bytes;
  };

  assert.throws(() => decodeDspPipelineDescriptor({}), /ArrayBuffer/);
  assert.throws(() => decodeDspPipelineDescriptor(new Uint8Array(7)), /header is truncated/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate((_bytes, view) => view.setUint32(0, 2, true))), /version/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate((_bytes, view) => view.setUint32(4, 129, true))), /exceeds 128/);
  assert.throws(() => decodeDspPipelineDescriptor(makeDescriptor().subarray(0, -1)), /length/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate(bytes => { bytes[12] = 2; })), /enabled/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate(bytes => { bytes[13] = 5; })), /input bus/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate(bytes => { bytes[15] = 8; })), /channel specifier/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate(bytes => { bytes[16] = 2; })), /section gate/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate(bytes => { bytes[17] = 1; })), /padding/);
  assert.throws(() => decodeDspPipelineDescriptor(mutate((_bytes, view) => view.setUint32(8, 0, true))), /nonzero uint32/);

  const duplicate = encodeDspPipelineDescriptor([
    { instanceId: 1, enabled: true, inputBus: 0, outputBus: 0, channel: null, sectionGate: true },
    { instanceId: 2, enabled: true, inputBus: 0, outputBus: 0, channel: null, sectionGate: true }
  ]);
  new DataView(duplicate.buffer).setUint32(20, 1, true);
  assert.throws(() => decodeDspPipelineDescriptor(duplicate), /Duplicate/);
});

test('pipeline builder validates its callbacks before emitting native bytes', () => {
  assert.throws(() => buildDspPipelineNodes(null, { getInstanceId() {} }), /Pipeline must be an array/);
  assert.throws(() => buildDspPipelineNodes([], {}), /getInstanceId/);
});
