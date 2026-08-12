import { loadDspArtifact } from './artifacts.js';
import { resolveChainAssets } from './assets.js';
import { AssetError, StateError, ValidationError } from './errors.js';
import { createGraphEngineSession, effectiveNodeIds } from './graph-engine.js';
import {
  _normalizeGraphInput,
  chainDocumentFromGraph,
  cloneGraphDocument,
  createSendReturnGraphDocument,
  createWetDryGraphDocument,
  graphDocumentFromChain,
  graphStructuralSnapshot,
  graphVisualizationSnapshot
} from './graph-document.js';
import {
  channelRange,
  packEffect,
  setEffectParameter,
  validateEffectSampleRate,
  validateSampleRate,
  validateSeed
} from './semantics.js';

const STREAM_SAFE_PARAMETERS = new Map([
  ['Volume', new Set(['volume'])]
]);

function validateAudio(audio) {
  if (!Array.isArray(audio) || audio.length < 1 || audio.length > 8) {
    throw new ValidationError('Audio must be an array containing between 1 and 8 Float32Array channels.');
  }
  const frames = audio[0] instanceof Float32Array ? audio[0].length : -1;
  for (const channel of audio) {
    if (!(channel instanceof Float32Array) || channel.length !== frames) {
      throw new ValidationError('Audio channels must be equally sized Float32Array values.');
    }
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new ValidationError('Audio samples must all be finite.');
    }
  }
  return { channels: audio.length, frames };
}

function validateBlockSize(value = 128) {
  if (!Number.isInteger(value) || value < 1 || value > 16384) {
    throw new ValidationError('blockSize must be an integer from 1 to 16384.');
  }
  return value;
}

function validateChannels(channels) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new ValidationError('channels must be an integer from 1 to 8.');
  }
  return channels;
}

function validateLayout(state, sampleRate, channels) {
  const effective = effectiveNodeIds(state.document);
  for (const node of state.document.nodes) {
    if (node.enabled && effective.has(node.id)) validateEffectSampleRate(node, sampleRate);
    try {
      channelRange(node.channel, channels);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(error.message, {
          code: 'GRAPH_DOCUMENT_CHANNEL',
          path: `/nodes/${state.originalNodeIndexes.get(node.id)}/channel`,
          nodeId: node.id,
          cause: error
        });
      }
      throw error;
    }
  }
  if (channels !== 2) {
    const edge = state.document.edges.find(candidate => Object.hasOwn(candidate, 'pan'));
    if (edge) {
      throw new ValidationError('Edge pan is supported only for stereo Graph streams.', {
        code: 'GRAPH_DOCUMENT_CHANNEL',
        path: `/edges/${state.originalEdgeIndexes.get(edge.id)}/pan`,
        edgeId: edge.id
      });
    }
  }
}

function reconfigurationRequired(state, node, parameterName) {
  const index = state.originalNodeIndexes.get(node.id);
  return new ValidationError(
    `${node.type}.${parameterName} cannot be updated while a Graph stream is open; create a new stream.`,
    {
      code: 'GRAPH_RECONFIGURATION_REQUIRED',
      path: `/nodes/${index}/parameters/${parameterName}`,
      nodeId: node.id
    }
  );
}

function validateStreamUpdate(state, node, parameterName, value) {
  if (node.type === 'IRReverb' && parameterName === 'dryLevel') {
    if (node.parameters.latency === 0 ||
        (node.parameters.dryLevel <= -96 && value <= -96)) return 4;
    throw reconfigurationRequired(state, node, parameterName);
  }
  if (!STREAM_SAFE_PARAMETERS.get(node.type)?.has(parameterName)) {
    throw reconfigurationRequired(state, node, parameterName);
  }
  return 0;
}

function replaceNode(state, index, node) {
  const nodes = [...state.document.nodes];
  nodes[index] = node;
  return { ...state, document: { ...state.document, nodes } };
}

function identitySnapshot(channels) {
  return Object.freeze({
    version: 1,
    identity: true,
    silence: false,
    effectiveSchedule: [],
    nodes: [],
    edges: [],
    outputLatency: Array(channels).fill(0),
    outputCompensation: Array(channels).fill(0),
    latencySamples: 0,
    capacity: { bufferSlots: 0, workspaceBytes: 0 }
  });
}

export class GraphStream {
  constructor(state, session, { sampleRate, channels, blockSize }) {
    this._initialState = state;
    this._state = { ...state, document: cloneGraphDocument(state.document) };
    this._session = session;
    this._sampleRate = sampleRate;
    this._channels = channels;
    this._blockSize = blockSize;
    this._processedFrames = 0;
    this._closed = false;
    this._compileSnapshot = session?.snapshot ?? identitySnapshot(channels);
  }

  _assertOpen() {
    if (this._closed) throw new StateError('The Graph stream is closed.');
  }

  get graph() {
    this._assertOpen();
    return cloneGraphDocument(this._state.document);
  }

  get latencySamples() {
    this._assertOpen();
    return this._session?.latencySamples ?? 0;
  }

  get compileSnapshot() {
    this._assertOpen();
    return cloneGraphDocument(this._compileSnapshot);
  }

  visualizationSnapshot() {
    this._assertOpen();
    return graphVisualizationSnapshot(this._state, this._compileSnapshot);
  }

  setParam(nodeId, parameterName, value) {
    this._assertOpen();
    const index = this._state.document.nodes.findIndex(node => node.id === nodeId);
    if (index < 0) {
      throw new ValidationError(`Unknown Graph node: ${nodeId}`, {
        code: 'GRAPH_DOCUMENT_REFERENCE', path: '', nodeId
      });
    }
    const node = this._state.document.nodes[index];
    const originalIndex = this._state.originalNodeIndexes.get(nodeId);
    if (this._session && !this._session.hasEffectiveNode(nodeId)) {
      // Enabling a node only helps when its edges already reach the main output, so a dormant
      // node keeps the routing wording even when it is also disabled.
      const dormant = this._compileSnapshot.nodes.find(entry => entry.id === nodeId)?.dormant ?? false;
      throw new ValidationError(
        !node.enabled && !dormant
          ? `Graph node ${nodeId} is disabled and bypassed; enable it and create a new stream.`
          : `Graph node ${nodeId} is not effective; create a new stream to change it.`,
        {
          code: 'GRAPH_RECONFIGURATION_REQUIRED',
          path: `/nodes/${originalIndex}`,
          nodeId
        }
      );
    }
    let updated;
    try {
      updated = setEffectParameter(node, parameterName, value);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(error.message, {
          code: 'GRAPH_DOCUMENT_PARAMETER',
          path: `/nodes/${originalIndex}/parameters/${parameterName}`,
          nodeId,
          cause: error
        });
      }
      throw error;
    }
    const changedIndex = validateStreamUpdate(
      this._state, node, parameterName, updated.parameters[parameterName]
    );
    const packed = packEffect(updated);
    const status = this._session?.setPacked(nodeId, packed.values, packed.hash, changedIndex);
    if (status !== undefined && status !== 0) {
      throw reconfigurationRequired(this._state, node, parameterName);
    }
    this._state = replaceNode(this._state, index, updated);
    return this;
  }

  async process(audio, ...unexpected) {
    this._assertOpen();
    if (unexpected.length !== 0) {
      throw new ValidationError(
        'GraphStream.process() does not accept options or scheduled events.'
      );
    }
    const layout = validateAudio(audio);
    if (layout.channels !== this._channels) {
      throw new ValidationError(`Audio has ${layout.channels} channel(s); this Graph stream requires ${this._channels}.`);
    }
    const output = audio.map(channel => new Float32Array(channel));
    if (!this._session || layout.frames === 0) return output;
    for (let offset = 0; offset < layout.frames; offset += this._blockSize) {
      const frameCount = Math.min(this._blockSize, layout.frames - offset);
      this._session.process(audio, output, offset, frameCount, this._sampleRate, this._processedFrames + offset);
    }
    this._processedFrames += layout.frames;
    return output;
  }

  reset() {
    this._assertOpen();
    this._session?.reset();
    this._state = { ...this._initialState, document: cloneGraphDocument(this._initialState.document) };
    this._processedFrames = 0;
    return this;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._session?.close();
    this._session = null;
  }
}

export class Graph {
  constructor(state, resolvedAssets, artifact, artifactOptions, assetResolver) {
    this._state = state;
    this._resolvedAssets = resolvedAssets;
    this._artifact = artifact;
    this._artifactOptions = artifactOptions;
    this._assetResolver = assetResolver;
    this._closed = false;
  }

  static async fromChain(chain, options = {}) {
    const inherited = chain?._resolvedAssets instanceof Map
      ? new Map(chain._resolvedAssets)
      : new Map();
    return createGraph(graphDocumentFromChain(chain?.preset ?? chain), {
      ...(chain?._artifactOptions ?? {}),
      ...options,
      _resolvedAssets: inherited
    });
  }

  static async load(input, options = {}) {
    return createGraph(input, options);
  }

  static wetDry(effect, options = {}) {
    return createWetDryGraphDocument(effect, options);
  }

  static sendReturn(effect, options = {}) {
    return createSendReturnGraphDocument(effect, options);
  }

  _assertOpen() {
    if (this._closed) throw new StateError('The Graph is closed.');
  }

  toJSON() {
    this._assertOpen();
    return cloneGraphDocument(this._state.document);
  }

  serialize(space = 0) {
    return JSON.stringify(this.toJSON(), null, space);
  }

  toChain() {
    this._assertOpen();
    return chainDocumentFromGraph(this._state);
  }

  get nodes() {
    return this.toJSON().nodes;
  }

  get edges() {
    return this.toJSON().edges;
  }

  getNode(id) {
    this._assertOpen();
    const node = this._state.document.nodes.find(candidate => candidate.id === id);
    return node ? cloneGraphDocument(node) : null;
  }

  getEdge(id) {
    this._assertOpen();
    const edge = this._state.document.edges.find(candidate => candidate.id === id);
    return edge ? cloneGraphDocument(edge) : null;
  }

  incoming(id) {
    this._assertOpen();
    return (this._state.incoming.get(id) ?? []).map(cloneGraphDocument);
  }

  outgoing(id) {
    this._assertOpen();
    return (this._state.outgoing.get(id) ?? []).map(cloneGraphDocument);
  }

  structuralSnapshot() {
    this._assertOpen();
    return graphStructuralSnapshot(this._state);
  }

  visualizationSnapshot() {
    this._assertOpen();
    return graphVisualizationSnapshot(this._state);
  }

  async _resolveEffectiveAssets(state) {
    const effective = effectiveNodeIds(state.document);
    const unresolved = state.document.nodes.filter(node =>
      node.enabled && effective.has(node.id) && node.assets && !this._resolvedAssets.has(node.id)
    );
    // Resolving one node at a time keeps the failing node identifiable; resolveChainAssets is
    // already sequential, so this costs nothing.
    for (const node of unresolved) {
      let resolved;
      try {
        resolved = await resolveChainAssets(
          { version: 1, chain: [node] },
          { assetResolver: this._assetResolver }
        );
      } catch (error) {
        if (error instanceof AssetError) {
          throw new AssetError(error.message, {
            code: 'GRAPH_INSTANCE_PREPARE',
            path: `/nodes/${state.originalNodeIndexes.get(node.id)}/assets`,
            nodeId: node.id,
            cause: error
          });
        }
        throw error;
      }
      for (const [nodeId, assets] of resolved) this._resolvedAssets.set(nodeId, assets);
    }
  }

  async _artifactForCurrentDocument() {
    if (this._state.document.nodes.length === 0 && this._state.document.edges.length === 0) return null;
    if (!this._artifact) this._artifact = await loadDspArtifact(this._artifactOptions);
    return this._artifact;
  }

  async stream({ sampleRate, channels = 2, blockSize = 128, seed = 0 } = {}) {
    this._assertOpen();
    const rate = validateSampleRate(sampleRate);
    const channelCount = validateChannels(channels);
    const framesPerBlock = validateBlockSize(blockSize);
    const normalizedSeed = validateSeed(seed);
    validateLayout(this._state, rate, channelCount);
    const artifact = await this._artifactForCurrentDocument();
    const state = {
      ...this._state,
      document: cloneGraphDocument(this._state.document)
    };
    await this._resolveEffectiveAssets(state);
    const session = artifact
      ? await createGraphEngineSession(artifact, state, this._resolvedAssets, {
          sampleRate: rate,
          channels: channelCount,
          maxFrames: Math.max(128, framesPerBlock),
          seed: normalizedSeed
        })
      : null;
    return new GraphStream(state, session, {
      sampleRate: rate,
      channels: channelCount,
      blockSize: framesPerBlock
    });
  }

  async latencySamples(options = {}) {
    const stream = await this.stream(options);
    try {
      return stream.latencySamples;
    } finally {
      stream.close();
    }
  }

  async process(audio, { sampleRate, seed = 0, blockSize = 128 } = {}) {
    this._assertOpen();
    const layout = validateAudio(audio);
    const stream = await this.stream({
      sampleRate,
      channels: layout.channels,
      blockSize,
      seed
    });
    try {
      return await stream.process(audio);
    } finally {
      stream.close();
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._artifact = null;
    this._resolvedAssets.clear();
  }
}

export async function createGraph(input, options = {}) {
  const state = _normalizeGraphInput(input);
  const resolvedAssets = new Map(options._resolvedAssets ?? []);
  const artifactOptions = {
    variant: options.variant,
    wasmUrl: options.wasmUrl,
    simdWasmUrl: options.simdWasmUrl,
    metaUrl: options.metaUrl,
    fetch: options.fetch,
    webAssembly: options.webAssembly,
    cache: options.cache
  };
  const artifact = state.document.nodes.length === 0 && state.document.edges.length === 0
    ? null
    : await loadDspArtifact(artifactOptions);
  return new Graph(state, resolvedAssets, artifact, artifactOptions, options.assetResolver);
}
