import { instantiateDspBinding, ET_OK } from './internal/dsp-engine-binding.js';
import { getEffectImplementation } from './catalog.js';
import { prepareConvolutionAsset } from './assets.js';
import { AssetError, EffeTuneError, EffeTuneRuntimeError, ValidationError } from './errors.js';
import { channelRange, packEffect } from './semantics.js';
import { TELEMETRY_RING_BYTES } from './telemetry.js';
import { GRAPH_V1_CAPACITY } from './generated-graph-contract.js';

const GRAPH_MAGIC = 0x31475445;
const SNAPSHOT_MAGIC = 0x31535445;
const ENDPOINT = 0xffffffff;
const UNASSIGNED_SLOT = 0xffffffff;

function requireOk(status, operation) {
  if (status !== ET_OK) throw new EffeTuneRuntimeError(`DSP ${operation} failed.`);
}

function instancePrepareError(state, effect, message, cause) {
  return new EffeTuneRuntimeError(message, {
    code: 'GRAPH_INSTANCE_PREPARE',
    path: `/nodes/${state.originalNodeIndexes.get(effect.id)}`,
    nodeId: effect.id,
    cause
  });
}

function channelSpec(channel) {
  if (channel === 'all') return -2;
  if (channel === 'stereo') return -1;
  if (channel === 'left' || channel === '1') return 0;
  if (channel === 'right' || channel === '2') return 1;
  if (/^[3-8]$/.test(channel)) return Number(channel) - 1;
  return { '34': 17, '56': 18, '78': 19 }[channel];
}

export function effectiveNodeIds(document) {
  const soloGroups = new Set(
    document.edges.filter(edge => edge.solo).map(
      edge => `${edge.destination}\0${edge.mixGroup}`
    )
  );
  const active = document.edges.filter(edge =>
    !edge.mute && (!soloGroups.has(`${edge.destination}\0${edge.mixGroup}`) || edge.solo)
  );
  const incoming = new Map();
  for (const edge of active) {
    const edges = incoming.get(edge.destination) ?? [];
    edges.push(edge);
    incoming.set(edge.destination, edges);
  }
  const result = new Set();
  const visited = new Set([document.output.id]);
  const queue = [document.output.id];
  while (queue.length > 0) {
    for (const edge of incoming.get(queue.shift()) ?? []) {
      if (document.nodes.some(node => node.id === edge.source)) result.add(edge.source);
      if (!visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return result;
}

function appendString(chunks, offsets, value) {
  const bytes = new TextEncoder().encode(value);
  const offset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(bytes);
  offsets.push({ offset, length: bytes.length });
}

export function encodeGraphDescriptor(document, instanceIds, assetNodeIds = new Set()) {
  const strings = [];
  const nodeStrings = [];
  const edgeStrings = [];
  for (const node of document.nodes) appendString(strings, nodeStrings, node.id);
  for (const edge of document.edges) {
    const fields = [];
    appendString(strings, fields, edge.id);
    appendString(strings, fields, edge.mixGroup);
    edgeStrings.push(fields);
  }
  const stringBytes = strings.reduce((sum, chunk) => sum + chunk.length, 0);
  const nodeOffset = 32;
  const edgeOffset = nodeOffset + document.nodes.length * 24;
  const stringOffset = edgeOffset + document.edges.length * 40;
  const bytes = new Uint8Array(stringOffset + stringBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GRAPH_MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, document.nodes.length, true);
  view.setUint32(12, document.edges.length, true);
  view.setUint32(16, stringBytes, true);
  const nodeIndexes = new Map(document.nodes.map((node, index) => [node.id, index]));
  for (const [index, node] of document.nodes.entries()) {
    const offset = nodeOffset + index * 24;
    const string = nodeStrings[index];
    let flags = 0;
    if (node.enabled) {
      flags = 1;
      if (assetNodeIds.has(node.id)) flags |= 2;
      if (node.type !== 'IRReverb' || node.parameters.dryEnabled === false ||
          node.parameters.dryLevel <= -96) flags |= 4;
    }
    view.setUint32(offset, instanceIds.get(node.id) ?? 0, true);
    view.setUint32(offset + 4, string.offset, true);
    view.setUint32(offset + 8, string.length, true);
    view.setUint32(offset + 12, flags, true);
    view.setInt32(offset + 16, channelSpec(node.channel), true);
  }
  for (const [index, edge] of document.edges.entries()) {
    const offset = edgeOffset + index * 40;
    const [id, mixGroup] = edgeStrings[index];
    let flags = (edge.mute ? 1 : 0) | (edge.solo ? 2 : 0);
    if (Object.hasOwn(edge, 'pan')) flags |= 4;
    view.setUint32(offset, edge.source === document.input.id
      ? ENDPOINT : nodeIndexes.get(edge.source), true);
    view.setUint32(offset + 4, edge.destination === document.output.id
      ? ENDPOINT : nodeIndexes.get(edge.destination), true);
    view.setUint32(offset + 8, id.offset, true);
    view.setUint32(offset + 12, id.length, true);
    view.setUint32(offset + 16, mixGroup.offset, true);
    view.setUint32(offset + 20, mixGroup.length, true);
    view.setFloat32(offset + 24, edge.gain, true);
    view.setFloat32(offset + 28, edge.pan ?? 0, true);
    view.setUint32(offset + 32, flags, true);
  }
  let cursor = stringOffset;
  for (const chunk of strings) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return bytes;
}

function vector(view, offset, channels) {
  return Array.from({ length: channels }, (_, index) => view.getUint32(offset + index * 4, true));
}

function optionalSlot(value) {
  return value === UNASSIGNED_SLOT ? null : value;
}

export function decodeGraphSnapshot(bytes, document) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 128) {
    throw new EffeTuneRuntimeError('DSP returned an invalid Graph compile snapshot.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SNAPSHOT_MAGIC || view.getUint32(4, true) !== 1) {
    throw new EffeTuneRuntimeError('DSP returned an unsupported Graph compile snapshot.');
  }
  const nodeCount = view.getUint32(8, true);
  const edgeCount = view.getUint32(12, true);
  const scheduleCount = view.getUint32(16, true);
  const channels = view.getUint32(20, true);
  const nodeBytes = view.getUint32(40, true);
  const edgeBytes = view.getUint32(44, true);
  const scheduleOffset = view.getUint32(48, true);
  const nodesOffset = view.getUint32(52, true);
  const edgesOffset = view.getUint32(56, true);
  const totalBytes = view.getUint32(60, true);
  if (nodeCount !== document.nodes.length || edgeCount !== document.edges.length ||
      channels < 1 || channels > 8 || nodeBytes !== 128 || edgeBytes !== 48 ||
      totalBytes !== bytes.byteLength) {
    throw new EffeTuneRuntimeError('DSP returned an inconsistent Graph compile snapshot.');
  }
  const schedule = Array.from({ length: scheduleCount }, (_, index) =>
    document.nodes[view.getUint32(scheduleOffset + index * 4, true)]?.id
  );
  const nodes = document.nodes.map((node, index) => {
    const offset = nodesOffset + index * nodeBytes;
    const flags = view.getUint32(offset, true);
    return {
      id: node.id,
      effective: (flags & 1) !== 0,
      dormant: (flags & 2) !== 0,
      enabled: (flags & 4) !== 0,
      disabledBypass: (flags & 8) !== 0,
      scheduleIndex: optionalSlot(view.getUint32(offset + 4, true)),
      bufferSlot: optionalSlot(view.getUint32(offset + 8, true)),
      processingGroup: {
        firstChannel: view.getUint32(offset + 16, true),
        channelCount: view.getUint32(offset + 20, true)
      },
      kernelLatency: view.getUint32(offset + 24, true),
      inputLatency: vector(view, offset + 32, channels),
      outputLatency: vector(view, offset + 64, channels),
      preNodeCompensation: vector(view, offset + 96, channels)
    };
  });
  const edges = document.edges.map((edge, index) => {
    const offset = edgesOffset + index * edgeBytes;
    const flags = view.getUint32(offset, true);
    return {
      id: edge.id,
      active: (flags & 1) !== 0,
      suppressed: (flags & 2) !== 0,
      dormant: (flags & 4) !== 0,
      fanInCompensation: vector(view, offset + 16, channels)
    };
  });
  const flags = view.getUint32(36, true);
  return Object.freeze({
    version: 1,
    identity: (flags & 1) !== 0,
    silence: (flags & 2) !== 0,
    effectiveSchedule: schedule,
    nodes,
    edges,
    outputLatency: vector(view, 64, channels),
    outputCompensation: vector(view, 96, channels),
    latencySamples: view.getUint32(28, true),
    capacity: {
      bufferSlots: view.getUint32(24, true),
      workspaceBytes: view.getUint32(32, true)
    }
  });
}

const STATUS_CODES = new Map([
  [-9, 'GRAPH_DOCUMENT_CYCLE'],
  [-10, 'GRAPH_DOCUMENT_CONNECTIVITY'],
  [-11, 'GRAPH_CAPACITY'],
  [-14, 'GRAPH_INSTANCE_PREPARE'],
  [-12, 'GRAPH_LATENCY_OVERFLOW'],
  [-13, 'GRAPH_UNSUPPORTED_CAPABILITY'],
  [-3, 'GRAPH_PLAN_MEMORY']
]);
const NODE_PATHS = new Map([[2, '/id'], [3, ''], [4, '/assets'], [5, ''], [6, '/channel']]);
const EDGE_PATHS = new Map([[7, '/id'], [8, '/source'], [9, '/destination'], [10, '/gain'], [11, '/pan'], [12, '']]);

function invalidGraphCode(diagnostic) {
  if (diagnostic?.path === 2 || diagnostic?.path === 7) return 'GRAPH_DOCUMENT_ID';
  if (diagnostic?.path === 6) return 'GRAPH_DOCUMENT_CHANNEL';
  if (diagnostic?.path === 8 || diagnostic?.path === 9 || diagnostic?.path === 1) {
    return 'GRAPH_DOCUMENT_REFERENCE';
  }
  if (diagnostic?.path === 10 || diagnostic?.path === 11 || diagnostic?.path === 12) {
    return 'GRAPH_DOCUMENT_EDGE_CONTROL';
  }
  if (diagnostic?.path === 3 || diagnostic?.path === 4) return 'GRAPH_INSTANCE_PREPARE';
  if (diagnostic?.path === 5) return 'GRAPH_UNSUPPORTED_CAPABILITY';
  if (diagnostic?.path === 15) return 'GRAPH_CAPACITY';
  if (diagnostic?.path === 16 || diagnostic?.path === 18) return 'GRAPH_LATENCY_OVERFLOW';
  if (diagnostic?.path === 17) return 'GRAPH_PLAN_MEMORY';
  return 'GRAPH_DOCUMENT_REFERENCE';
}

export function graphCompileError(status, diagnostic, state) {
  const code = status === -8
    ? invalidGraphCode(diagnostic)
    : STATUS_CODES.get(status) ?? 'GRAPH_PLAN_MEMORY';
  let path = '';
  let nodeId;
  let edgeId;
  let nodeType;
  if (diagnostic?.kind === 1) {
    const node = state.document.nodes[diagnostic.index];
    nodeId = node?.id;
    nodeType = node?.type;
    const original = state.originalNodeIndexes.get(nodeId);
    path = `/nodes/${original ?? diagnostic.index}${NODE_PATHS.get(diagnostic.path) ?? ''}`;
    if (code === 'GRAPH_UNSUPPORTED_CAPABILITY' && node?.type === 'IRReverb') {
      path = `/nodes/${original ?? diagnostic.index}/parameters/dryLevel`;
    }
  } else if (diagnostic?.kind === 2) {
    const edge = state.document.edges[diagnostic.index];
    edgeId = edge?.id;
    const original = state.originalEdgeIndexes.get(edgeId);
    path = `/edges/${original ?? diagnostic.index}${EDGE_PATHS.get(diagnostic.path) ?? ''}`;
    if (diagnostic.path === 12 && edge?.mixGroup === '') path += '/mixGroup';
  }
  // A hand-written document that trips an unsupported capability is the same caller
  // mistake the recipe builders reject up front, so it reports the same error type and
  // the same remedy instead of a generic "could not be prepared" runtime failure.
  const unsupported = code === 'GRAPH_UNSUPPORTED_CAPABILITY';
  const ErrorType = code.startsWith('GRAPH_DOCUMENT_') || unsupported
    ? ValidationError
    : EffeTuneRuntimeError;
  let message = 'The DSP Graph could not be prepared.';
  if (unsupported) {
    message = nodeType === 'IRReverb'
      ? 'IRReverb must be wet-only in a Graph; turn dryEnabled off or set dryLevel to -96 dB (the parameter minimum), then use the external dry edge.'
      : 'The DSP Graph requires a capability this build does not support.';
  }
  return new ErrorType(message, { code, path, nodeId, edgeId });
}

export async function createGraphEngineSession(artifact, state, resolvedAssets, {
  sampleRate,
  channels,
  maxFrames,
  seed
}) {
  let binding;
  const nodes = [];
  try {
    const maximumNodes = GRAPH_V1_CAPACITY.maxStructuralNodes;
    if (state.document.nodes.length > maximumNodes) {
      const overflow = state.document.nodes.find(
        node => state.originalNodeIndexes.get(node.id) === maximumNodes
      );
      throw new EffeTuneRuntimeError(
        `The DSP Graph exceeds the structural node capacity (${maximumNodes}).`,
        { code: 'GRAPH_CAPACITY', path: `/nodes/${maximumNodes}`, nodeId: overflow?.id }
      );
    }
    const maximumEdges = GRAPH_V1_CAPACITY.maxEdges;
    if (state.document.edges.length > maximumEdges) {
      const overflow = state.document.edges.find(
        edge => state.originalEdgeIndexes.get(edge.id) === maximumEdges
      );
      throw new EffeTuneRuntimeError(
        `The DSP Graph exceeds the edge capacity (${maximumEdges}).`,
        { code: 'GRAPH_CAPACITY', path: `/edges/${maximumEdges}`, edgeId: overflow?.id }
      );
    }
    const effective = effectiveNodeIds(state.document);
    const effectiveNodes = state.document.nodes.filter(
      effect => effect.enabled && effective.has(effect.id)
    );
    if (effectiveNodes.length > GRAPH_V1_CAPACITY.maxEffectiveInstances) {
      const effect = effectiveNodes[GRAPH_V1_CAPACITY.maxEffectiveInstances];
      throw new EffeTuneRuntimeError('The DSP Graph exceeds the effective instance capacity.', {
        code: 'GRAPH_CAPACITY',
        path: `/nodes/${state.originalNodeIndexes.get(effect.id)}`,
        nodeId: effect.id
      });
    }
    binding = await instantiateDspBinding(artifact.module ?? artifact.bytes ?? artifact, {
      warning: () => {}
    });
    if (!binding.graphSupported) {
      throw new EffeTuneRuntimeError('This DSP artifact does not support Graph v1.', {
        code: 'GRAPH_UNSUPPORTED_CAPABILITY', path: ''
      });
    }
    binding.createEngine();
    requireOk(binding.prepare(sampleRate, channels, maxFrames, TELEMETRY_RING_BYTES), 'preparation');
    requireOk(binding.setTelemetryRate(0), 'telemetry configuration');
    const instanceIds = new Map();
    const assetNodeIds = new Set();
    let tapId = 1;
    for (const [nodeIndex, effect] of state.document.nodes.entries()) {
      if (!effect.enabled || !effective.has(effect.id)) continue;
      const packed = packEffect(effect);
      const instanceId = binding.createInstance(packed.internalType);
      if (!instanceId) {
        throw instancePrepareError(state, effect, `Unable to create ${effect.type}.`);
      }
      instanceIds.set(effect.id, instanceId);
      requireOk(binding.instanceSetTap(instanceId, tapId), `${effect.type} telemetry mapping`);
      requireOk(binding.instanceSetSeed(instanceId, seed), `${effect.type} seed configuration`);
      requireOk(binding.instanceSetParams(instanceId, packed.values, packed.hash), `${effect.type} parameter configuration`);
      if (packed.bytes) requireOk(binding.instanceSetParamBytes(instanceId, packed.bytes, packed.hash), `${effect.type} structured parameter configuration`);
      const implementation = getEffectImplementation(effect.type);
      if (implementation.assets?.length) {
        assetNodeIds.add(effect.id);
        let prepared;
        try {
          prepared = prepareConvolutionAsset(effect, resolvedAssets, { sampleRate, engineChannels: channels });
        } catch (error) {
          if (error instanceof AssetError) {
            throw new AssetError(error.message, {
              code: 'GRAPH_INSTANCE_PREPARE',
              path: `/nodes/${state.originalNodeIndexes.get(effect.id)}/assets`,
              nodeId: effect.id,
              cause: error
            });
          }
          throw error;
        }
        const slot = implementation.assets.find(asset => asset.publicName === 'impulseResponse')?.slot ?? 0;
        if (binding.instanceSetAsset(
          instanceId,
          slot,
          prepared.payload,
          prepared.beginInfo,
          prepared.formatTag
        ) !== ET_OK) {
          throw new EffeTuneRuntimeError(`${effect.type} asset could not be prepared.`, {
            code: 'GRAPH_INSTANCE_PREPARE',
            path: `/nodes/${state.originalNodeIndexes.get(effect.id)}/assets`,
            nodeId: effect.id
          });
        }
        const warmupFrames = 128;
        const silence = binding.getArenaViews().scratch.allChannels.subarray(0, prepared.beginInfo.processingChannels * warmupFrames);
        const silencePtr = binding.pointerForArenaView(silence);
        let assetState = binding.instanceAssetState(instanceId, slot);
        const maximumWarmupBlocks = Math.ceil(2 * sampleRate / warmupFrames);
        for (let block = 0; (assetState & 0xff) === 2 && block < maximumWarmupBlocks; block++) {
          silence.fill(0);
          requireOk(binding.instanceProcess(instanceId, silencePtr, prepared.beginInfo.processingChannels, warmupFrames, block * warmupFrames / sampleRate), `${effect.type} asset prewarming`);
          assetState = binding.instanceAssetState(instanceId, slot);
        }
        if ((assetState & 0xff) !== 3) {
          throw new EffeTuneRuntimeError(`${effect.type} asset did not become active.`, {
            code: 'GRAPH_INSTANCE_PREPARE',
            path: `/nodes/${state.originalNodeIndexes.get(effect.id)}/assets`,
            nodeId: effect.id
          });
        }
        requireOk(binding.resetInstance(instanceId), `${effect.type} post-prewarm reset`);
        requireOk(binding.instanceSetSeed(instanceId, seed), `${effect.type} post-prewarm seed reset`);
        requireOk(binding.instanceSetParams(instanceId, packed.values, packed.hash), `${effect.type} post-prewarm parameter reset`);
        if (packed.bytes) requireOk(binding.instanceSetParamBytes(instanceId, packed.bytes, packed.hash), `${effect.type} post-prewarm structured parameter reset`);
      }
      nodes.push({
        effectId: effect.id,
        effectType: effect.type,
        nodeIndex,
        instanceId,
        tapId: tapId++,
        range: channelRange(effect.channel, channels),
        initialValues: new Float32Array(packed.values),
        initialBytes: packed.bytes ? new Uint8Array(packed.bytes) : null,
        hash: packed.hash
      });
    }
    const descriptor = encodeGraphDescriptor(state.document, instanceIds, assetNodeIds);
    const status = binding.graphConfigure(descriptor);
    if (status !== ET_OK) throw graphCompileError(status, binding.graphDiagnostic(), state);
    const snapshot = decodeGraphSnapshot(binding.graphSnapshot(), state.document);
    return new GraphEngineSession(binding, nodes, snapshot, { channels, maxFrames, seed });
  } catch (error) {
    binding?.close();
    if (error instanceof EffeTuneError) throw error;
    throw new EffeTuneRuntimeError('Unable to create the DSP Graph processing state.', { cause: error });
  }
}

export class GraphEngineSession {
  constructor(binding, nodes, snapshot, { channels, maxFrames, seed }) {
    this.binding = binding;
    this.nodes = nodes;
    this.snapshot = snapshot;
    this.channels = channels;
    this.maxFrames = maxFrames;
    this.seed = seed;
    this.closed = false;
    this.arena = binding.getArenaViews().combined;
    this.arenaByteOffset = this.arena.byteOffset;
    this.fullChannelViews = Array.from({ length: channels }, (_, channel) =>
      this.arena.subarray(channel * maxFrames, (channel + 1) * maxFrames)
    );
  }

  get latencySamples() {
    if (this.closed) throw new EffeTuneRuntimeError('DSP Graph processing state is closed.');
    return this.binding.graphLatency();
  }

  process(input, output, offset, frameCount, sampleRate, timeFrame = offset) {
    if (this.closed) throw new EffeTuneRuntimeError('DSP Graph processing state is closed.');
    for (let channel = 0; channel < this.channels; channel++) {
      const target = frameCount === this.maxFrames
        ? this.fullChannelViews[channel]
        : this.arena.subarray(channel * frameCount, (channel + 1) * frameCount);
      target.set(input[channel].subarray(offset, offset + frameCount));
    }
    requireOk(this.binding.graphProcess(this.channels, frameCount, timeFrame / sampleRate), 'Graph processing');
    for (let channel = 0; channel < this.channels; channel++) {
      const source = frameCount === this.maxFrames
        ? this.fullChannelViews[channel]
        : this.arena.subarray(channel * frameCount, (channel + 1) * frameCount);
      output[channel].set(source, offset);
    }
  }

  setPacked(effectId, values, hash, changedIndex) {
    const node = this.nodes.find(entry => entry.effectId === effectId);
    if (!node) throw new ValidationError(`Graph node ${effectId} is not effective.`, {
      code: 'GRAPH_RECONFIGURATION_REQUIRED', nodeId: effectId
    });
    return this.binding.graphSetInstanceParams(node.instanceId, values, hash, changedIndex);
  }

  hasEffectiveNode(effectId) {
    return this.nodes.some(entry => entry.effectId === effectId);
  }

  reset() {
    requireOk(this.binding.graphReset(), 'Graph reset');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.binding.close();
  }
}
