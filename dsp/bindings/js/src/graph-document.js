import { Effect } from './effect.js';
import { AssetError, EffectError, ValidationError, validationDetail } from './errors.js';
import { normalizeChainDocument } from './semantics.js';

const ROOT_KEYS = new Set(['version', 'input', 'output', 'nodes', 'edges']);
const ENDPOINT_KEYS = new Set(['id']);
const EDGE_KEYS = new Set([
  'id', 'source', 'destination', 'gain', 'mute', 'pan', 'mixGroup', 'solo'
]);
const textEncoder = new TextEncoder();

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function graphError(message, { code, path = '', nodeId, edgeId, cause } = {}) {
  return new ValidationError(message, { code, path, nodeId, edgeId, cause });
}

function utf8Compare(left, right) {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

export function cloneGraphDocument(document) {
  return cloneValue(document);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function unicodeScalarLength(value) {
  let length = 0;
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return -1;
    length++;
  }
  return length;
}

function validateId(value, path) {
  const length = typeof value === 'string' ? unicodeScalarLength(value) : -1;
  if (length < 1 || length > 128) {
    throw graphError('Graph IDs must contain between 1 and 128 Unicode scalar values.', {
      code: 'GRAPH_DOCUMENT_ID',
      path
    });
  }
  return value;
}

function normalizeEndpoint(value, path) {
  if (!isRecord(value)) {
    throw graphError('Graph endpoints must be objects.', {
      code: 'GRAPH_DOCUMENT_REFERENCE', path
    });
  }
  for (const key of Object.keys(value)) {
    if (!ENDPOINT_KEYS.has(key)) {
      throw graphError(`Graph endpoint has an unsupported field: ${key}`, {
        code: 'GRAPH_DOCUMENT_REFERENCE', path: `${path}/${key}`
      });
    }
  }
  return { id: validateId(value.id, `${path}/id`) };
}

// Chain validation tags its ValidationError/EffectError/AssetError with the structured cause so a
// Graph node failure lands on the field the caller actually got wrong instead of a
// message-regexp guess. The thrown class is preserved so the Chain and Graph entry points
// report the same category for the same mistake.
function graphNodeError(error, path, nodeId) {
  const detail = validationDetail(error);
  const kind = detail?.kind ?? (error instanceof AssetError ? 'assets' : undefined);
  let code = 'GRAPH_DOCUMENT_REFERENCE';
  let suffix = '';
  if (kind === 'channel') {
    code = 'GRAPH_DOCUMENT_CHANNEL';
    suffix = '/channel';
  } else if (kind === 'parameter') {
    code = 'GRAPH_DOCUMENT_PARAMETER';
    suffix = detail?.parameter === undefined ? '' : `/parameters/${detail.parameter}`;
  } else if (kind === 'type') {
    suffix = '/type';
  } else if (kind === 'assets') {
    suffix = '/assets';
  }
  const ErrorType = error instanceof AssetError ? AssetError
    : error instanceof EffectError ? EffectError
      : ValidationError;
  return new ErrorType(error.message, {
    code, path: `${path}${suffix}`, nodeId, cause: error
  });
}

function normalizeNode(value, index) {
  const path = `/nodes/${index}`;
  if (!isRecord(value)) {
    throw graphError(`Graph node ${index} must be an object.`, {
      code: 'GRAPH_DOCUMENT_REFERENCE', path
    });
  }
  const id = validateId(value.id, `${path}/id`);
  try {
    const normalized = normalizeChainDocument({
      version: 1,
      chain: [{ ...value, id: `graph-node-${index + 1}` }]
    }, { entryLabel: `Graph node ${id}` }).chain[0];
    return { ...normalized, id };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof EffectError ||
        error instanceof AssetError) {
      throw graphNodeError(error, path, value.id);
    }
    throw error;
  }
}

function finiteNumber(value, minimum, maximum, label, path, edgeId) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw graphError(`${label} must be a finite number from ${minimum} to ${maximum}.`, {
      code: 'GRAPH_DOCUMENT_EDGE_CONTROL', path, edgeId
    });
  }
  return value;
}

function normalizeEdge(value, index) {
  const path = `/edges/${index}`;
  if (!isRecord(value)) {
    throw graphError(`Graph edge ${index} must be an object.`, {
      code: 'GRAPH_DOCUMENT_REFERENCE', path
    });
  }
  for (const key of Object.keys(value)) {
    if (!EDGE_KEYS.has(key)) {
      throw graphError(`Graph edge ${index} has an unsupported field: ${key}`, {
        code: 'GRAPH_DOCUMENT_EDGE_CONTROL', path: `${path}/${key}`
      });
    }
  }
  const id = validateId(value.id, `${path}/id`);
  const source = validateId(value.source, `${path}/source`);
  const destination = validateId(value.destination, `${path}/destination`);
  const gain = finiteNumber(value.gain ?? 1, 0, 4, 'Edge gain', `${path}/gain`, id);
  const mute = value.mute ?? false;
  const solo = value.solo ?? false;
  if (typeof mute !== 'boolean') {
    throw graphError('Edge mute must be boolean.', {
      code: 'GRAPH_DOCUMENT_EDGE_CONTROL', path: `${path}/mute`, edgeId: id
    });
  }
  if (typeof solo !== 'boolean') {
    throw graphError('Edge solo must be boolean.', {
      code: 'GRAPH_DOCUMENT_EDGE_CONTROL', path: `${path}/solo`, edgeId: id
    });
  }
  const mixGroup = value.mixGroup ?? 'default';
  const mixGroupLength = typeof mixGroup === 'string' ? unicodeScalarLength(mixGroup) : -1;
  if (mixGroupLength < 1 || mixGroupLength > 128) {
    throw graphError('Edge mixGroup must contain between 1 and 128 Unicode scalar values.', {
      code: 'GRAPH_DOCUMENT_EDGE_CONTROL', path: `${path}/mixGroup`, edgeId: id
    });
  }
  let pan;
  if (Object.hasOwn(value, 'pan')) {
    pan = finiteNumber(value.pan, -1, 1, 'Edge pan', `${path}/pan`, id);
  }
  return {
    id,
    source,
    destination,
    gain,
    mute,
    ...(pan === undefined ? {} : { pan }),
    mixGroup,
    solo
  };
}

function validateUniqueIds(input, output, nodes, edges, nodeIndexes, edgeIndexes) {
  const seen = new Map();
  const add = (id, path) => {
    const previous = seen.get(id);
    if (previous !== undefined) {
      throw graphError(`Duplicate Graph id: ${id}`, {
        code: 'GRAPH_DOCUMENT_ID', path
      });
    }
    seen.set(id, path);
  };
  add(input.id, '/input/id');
  add(output.id, '/output/id');
  for (const node of nodes) add(node.id, `/nodes/${nodeIndexes.get(node.id)}/id`);
  for (const edge of edges) add(edge.id, `/edges/${edgeIndexes.get(edge.id)}/id`);
}

function structuralOrder(input, output, nodes, edges, nodeIndexes, edgeIndexes) {
  const nodeIds = new Set(nodes.map(node => node.id));
  const targets = new Set([input.id, output.id, ...nodeIds]);
  const incomingCount = new Map(nodes.map(node => [node.id, 0]));
  const outgoingNodes = new Map(nodes.map(node => [node.id, []]));
  const outgoing = new Map([...targets].map(id => [id, []]));
  const incoming = new Map([...targets].map(id => [id, []]));

  for (const edge of edges) {
    const path = `/edges/${edgeIndexes.get(edge.id)}`;
    if (!targets.has(edge.source) || !targets.has(edge.destination)) {
      const field = !targets.has(edge.source) ? 'source' : 'destination';
      throw graphError(`Graph edge ${edge.id} references an unknown endpoint.`, {
        code: 'GRAPH_DOCUMENT_REFERENCE', path: `${path}/${field}`, edgeId: edge.id
      });
    }
    if (edge.source === output.id || edge.destination === input.id) {
      const field = edge.source === output.id ? 'source' : 'destination';
      throw graphError('The main input is source-only and the main output is destination-only.', {
        code: 'GRAPH_DOCUMENT_REFERENCE', path: `${path}/${field}`, edgeId: edge.id
      });
    }
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.destination).push(edge);
    if (nodeIds.has(edge.source) && nodeIds.has(edge.destination)) {
      outgoingNodes.get(edge.source).push(edge.destination);
      incomingCount.set(edge.destination, incomingCount.get(edge.destination) + 1);
    }
  }

  const visitState = new Map(nodes.map(node => [node.id, 0]));
  const visit = id => {
    visitState.set(id, 1);
    for (const edge of outgoing.get(id)) {
      if (!nodeIds.has(edge.destination)) continue;
      if (visitState.get(edge.destination) === 1) {
        throw graphError('Graph nodes and edges must form an acyclic graph.', {
          code: 'GRAPH_DOCUMENT_CYCLE',
          path: `/edges/${edgeIndexes.get(edge.id)}`,
          edgeId: edge.id
        });
      }
      if (visitState.get(edge.destination) === 0) visit(edge.destination);
    }
    visitState.set(id, 2);
  };
  for (const node of nodes) {
    if (visitState.get(node.id) === 0) visit(node.id);
  }

  const ready = nodes.filter(node => incomingCount.get(node.id) === 0).map(node => node.id);
  ready.sort(utf8Compare);
  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(id);
    for (const destination of outgoingNodes.get(id).sort(utf8Compare)) {
      const count = incomingCount.get(destination) - 1;
      incomingCount.set(destination, count);
      if (count === 0) {
        ready.push(destination);
        ready.sort(utf8Compare);
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('Internal Graph topological ordering failure.');

  if (nodes.length !== 0 || edges.length !== 0) {
    const forward = new Set([input.id]);
    const queue = [input.id];
    while (queue.length > 0) {
      for (const edge of outgoing.get(queue.shift())) {
        if (!forward.has(edge.destination)) {
          forward.add(edge.destination);
          queue.push(edge.destination);
        }
      }
    }
    const backward = new Set([output.id]);
    queue.push(output.id);
    while (queue.length > 0) {
      for (const edge of incoming.get(queue.shift())) {
        if (!backward.has(edge.source)) {
          backward.add(edge.source);
          queue.push(edge.source);
        }
      }
    }
    const disconnectedNode = nodes.find(node => !forward.has(node.id) || !backward.has(node.id));
    if (disconnectedNode) {
      throw graphError(`Graph node ${disconnectedNode.id} is not on a main input-output path.`, {
        code: 'GRAPH_DOCUMENT_CONNECTIVITY',
        path: `/nodes/${nodeIndexes.get(disconnectedNode.id)}`,
        nodeId: disconnectedNode.id
      });
    }
    const disconnectedEdge = edges.find(
      edge => !forward.has(edge.source) || !backward.has(edge.destination)
    );
    if (disconnectedEdge) {
      throw graphError(`Graph edge ${disconnectedEdge.id} is not on a main input-output path.`, {
        code: 'GRAPH_DOCUMENT_CONNECTIVITY',
        path: `/edges/${edgeIndexes.get(disconnectedEdge.id)}`,
        edgeId: disconnectedEdge.id
      });
    }
    if (!forward.has(output.id)) {
      throw graphError('Graph does not connect the main input to the main output.', {
        code: 'GRAPH_DOCUMENT_CONNECTIVITY', path: ''
      });
    }
  }
  return { order, incoming, outgoing };
}

export function _normalizeGraphInput(input) {
  let source = input;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (error) {
      throw graphError('Graph input is not valid JSON.', {
        code: 'GRAPH_DOCUMENT_REFERENCE', path: '', cause: error
      });
    }
  }
  if (!isRecord(source)) {
    throw graphError('A Graph must be a version 1 Graph document.', {
      code: 'GRAPH_DOCUMENT_REFERENCE', path: ''
    });
  }
  for (const key of Object.keys(source)) {
    if (!ROOT_KEYS.has(key)) {
      throw graphError(`Unsupported Graph document field: ${key}`, {
        code: 'GRAPH_DOCUMENT_REFERENCE', path: `/${key}`
      });
    }
  }
  if (source.version !== 1) {
    throw graphError('Only Graph document version 1 is supported.', {
      code: 'GRAPH_DOCUMENT_REFERENCE', path: '/version'
    });
  }
  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
    throw graphError('Graph document nodes and edges must be arrays.', {
      code: 'GRAPH_DOCUMENT_REFERENCE', path: ''
    });
  }
  const inputEndpoint = normalizeEndpoint(source.input, '/input');
  const outputEndpoint = normalizeEndpoint(source.output, '/output');
  const originalNodes = source.nodes.map(normalizeNode);
  const originalEdges = source.edges.map(normalizeEdge);
  const nodeIndexes = new Map(originalNodes.map((node, index) => [node.id, index]));
  const edgeIndexes = new Map(originalEdges.map((edge, index) => [edge.id, index]));
  validateUniqueIds(
    inputEndpoint, outputEndpoint, originalNodes, originalEdges, nodeIndexes, edgeIndexes
  );
  const structural = structuralOrder(
    inputEndpoint, outputEndpoint, originalNodes, originalEdges, nodeIndexes, edgeIndexes
  );
  const nodes = [...originalNodes].sort((a, b) => utf8Compare(a.id, b.id));
  const edges = [...originalEdges].sort((a, b) => utf8Compare(a.id, b.id));
  return {
    document: { version: 1, input: inputEndpoint, output: outputEndpoint, nodes, edges },
    originalNodeIndexes: nodeIndexes,
    originalEdgeIndexes: edgeIndexes,
    structuralOrder: structural.order,
    incoming: structural.incoming,
    outgoing: structural.outgoing
  };
}

export function normalizeGraphDocument(input) {
  return cloneGraphDocument(_normalizeGraphInput(input).document);
}

export function graphStructuralSnapshot(normalized) {
  const state = normalized.document ? normalized : _normalizeGraphInput(normalized);
  const ids = [state.document.input.id, ...state.document.nodes.map(node => node.id), state.document.output.id];
  const incoming = Object.fromEntries(ids.map(id => [
    id,
    (state.incoming.get(id) ?? []).map(edge => edge.id).sort(utf8Compare)
  ]));
  const outgoing = Object.fromEntries(ids.map(id => [
    id,
    (state.outgoing.get(id) ?? []).map(edge => edge.id).sort(utf8Compare)
  ]));
  return deepFreeze({
    document: cloneGraphDocument(state.document),
    topologicalOrder: [...state.structuralOrder],
    incoming,
    outgoing
  });
}

export function graphVisualizationSnapshot(normalized, compileSnapshot = null) {
  const state = normalized.document ? normalized : _normalizeGraphInput(normalized);
  const compiledNodes = new Map(
    (compileSnapshot?.nodes ?? []).map(node => [node.id, node])
  );
  const compiledEdges = new Map(
    (compileSnapshot?.edges ?? []).map(edge => [edge.id, edge])
  );
  return deepFreeze({
    version: 1,
    nodes: [
      { id: state.document.input.id, kind: 'input' },
      ...state.document.nodes.map(node => {
        const compiled = compiledNodes.get(node.id);
        return {
          id: node.id,
          kind: 'effect',
          effectType: node.type,
          enabled: node.enabled,
          ...(compiled ? {
            effective: compiled.effective,
            dormant: compiled.dormant,
            disabledBypass: compiled.disabledBypass
          } : {}),
          state: compiled?.disabledBypass ? 'disabled-bypass'
            : compiled?.effective ? 'effective'
              : compiled?.dormant ? 'dormant'
                : node.enabled ? 'structural' : 'disabled-bypass'
        };
      }),
      { id: state.document.output.id, kind: 'output' }
    ],
    edges: state.document.edges.map(edge => {
      const compiled = compiledEdges.get(edge.id);
      return {
        id: edge.id,
        source: edge.source,
        destination: edge.destination,
        ...(compiled ? {
          active: compiled.active,
          suppressed: compiled.suppressed,
          dormant: compiled.dormant
        } : {}),
        state: compiled?.suppressed ? 'suppressed'
          : compiled?.dormant ? 'dormant'
            : compiled?.active ? 'effective' : 'structural'
      };
    })
  });
}

function availableId(preferred, used) {
  let id = preferred;
  for (let suffix = 2; used.has(id); suffix++) id = `${preferred}-${suffix}`;
  used.add(id);
  return id;
}

export function graphDocumentFromChain(chainInput) {
  const chain = normalizeChainDocument(chainInput);
  for (const [index, node] of chain.chain.entries()) {
    if (node.enabled && node.type === 'IRReverb' &&
        node.parameters.latency > 0 && node.parameters.dryEnabled !== false &&
        node.parameters.dryLevel > -96) {
      throw graphError(
        'IRReverb must be wet-only in a Graph; turn dryEnabled off or set dryLevel to -96 dB (the parameter minimum), then use the external dry edge.',
        {
          code: 'GRAPH_UNSUPPORTED_CAPABILITY',
          path: `/nodes/${index}/parameters/dryLevel`,
          nodeId: node.id
        }
      );
    }
  }
  const used = new Set(chain.chain.map(effect => effect.id));
  const inputId = availableId('main-input', used);
  const outputId = availableId('main-output', used);
  const edges = [];
  let source = inputId;
  for (const [index, node] of chain.chain.entries()) {
    const id = availableId(`route-${index + 1}`, used);
    edges.push({ id, source, destination: node.id });
    source = node.id;
  }
  if (chain.chain.length > 0) {
    edges.push({
      id: availableId(`route-${chain.chain.length + 1}`, used),
      source,
      destination: outputId
    });
  }
  return normalizeGraphDocument({
    version: 1,
    input: { id: inputId },
    output: { id: outputId },
    nodes: chain.chain,
    edges
  });
}

export function chainDocumentFromGraph(graphInput) {
  const state = graphInput?.document ? graphInput : _normalizeGraphInput(graphInput);
  const { document } = state;
  const identityEdge = edge => edge.gain === 1 && !edge.mute && !edge.solo &&
    edge.mixGroup === 'default' && (edge.pan === undefined || edge.pan === 0);
  if (!document.edges.every(identityEdge)) {
    throw graphError('Only a serial Graph with identity edge controls can be converted to a Chain.', {
      code: 'GRAPH_DOCUMENT_CONNECTIVITY', path: '/edges'
    });
  }
  if (document.nodes.length === 0 && document.edges.length === 0) {
    return { version: 1, chain: [] };
  }
  const bySource = new Map();
  for (const edge of document.edges) {
    if (bySource.has(edge.source)) {
      throw graphError('Only a serial Graph can be converted to a Chain.', {
        code: 'GRAPH_DOCUMENT_CONNECTIVITY',
        path: `/edges/${state.originalEdgeIndexes.get(edge.id)}`,
        edgeId: edge.id
      });
    }
    bySource.set(edge.source, edge);
  }
  const nodesById = new Map(document.nodes.map(node => [node.id, node]));
  const chain = [];
  const visited = new Set();
  let source = document.input.id;
  while (source !== document.output.id) {
    const edge = bySource.get(source);
    if (!edge || visited.has(edge.id)) {
      throw graphError('Only a serial Graph can be converted to a Chain.', {
        code: 'GRAPH_DOCUMENT_CONNECTIVITY', path: ''
      });
    }
    visited.add(edge.id);
    if (edge.destination === document.output.id) {
      source = document.output.id;
      break;
    }
    const node = nodesById.get(edge.destination);
    if (!node) {
      throw graphError('Only a serial Graph can be converted to a Chain.', {
        code: 'GRAPH_DOCUMENT_CONNECTIVITY', path: ''
      });
    }
    chain.push(cloneValue(node));
    source = node.id;
  }
  if (visited.size !== document.edges.length || chain.length !== document.nodes.length) {
    throw graphError('Only a serial Graph can be converted to a Chain.', {
      code: 'GRAPH_DOCUMENT_CONNECTIVITY', path: ''
    });
  }
  return { version: 1, chain };
}

function recipeEffect(effect, nodeId, defaultId) {
  const value = effect instanceof Effect ? effect.toJSON() : cloneValue(effect);
  if (!isRecord(value)) {
    throw graphError('A Graph recipe effect must be an Effect or effect document.', {
      code: 'GRAPH_DOCUMENT_REFERENCE', path: '/nodes/0'
    });
  }
  return { ...value, id: nodeId ?? value.id ?? defaultId };
}

// Every Graph recipe rejects a positive-latency IRReverb that still mixes its own dry signal,
// because the Graph plans delay compensation around a wet-only node.
function requireWetOnlyIRReverb(node) {
  if (node.enabled && node.type === 'IRReverb' &&
      node.parameters?.latency > 0 && node.parameters?.dryEnabled !== false &&
      node.parameters?.dryLevel > -96) {
    throw graphError(
      'IRReverb must be wet-only in a Graph; turn dryEnabled off or set dryLevel to -96 dB (the parameter minimum), then use the external dry edge.',
      {
        code: 'GRAPH_UNSUPPORTED_CAPABILITY',
        path: '/nodes/0/parameters/dryLevel',
        nodeId: node.id
      }
    );
  }
}

export function createWetDryGraphDocument(effect, {
  wet = 1,
  dry = 1,
  nodeId,
  inputId = 'input',
  outputId = 'output'
} = {}) {
  const node = normalizeNode(recipeEffect(effect, nodeId, 'wet'), 0);
  requireWetOnlyIRReverb(node);
  const used = new Set([inputId, outputId, node.id]);
  const dryId = availableId('dry', used);
  const wetInputId = availableId('wet-input', used);
  const wetOutputId = availableId('wet-output', used);
  return normalizeGraphDocument({
    version: 1,
    input: { id: inputId },
    output: { id: outputId },
    nodes: [node],
    edges: [
      { id: dryId, source: inputId, destination: outputId, gain: dry, mixGroup: 'main' },
      { id: wetInputId, source: inputId, destination: node.id },
      { id: wetOutputId, source: node.id, destination: outputId, gain: wet, mixGroup: 'main' }
    ]
  });
}

export function createSendReturnGraphDocument(effect, {
  send = 1,
  returnGain = 1,
  nodeId,
  inputId = 'input',
  outputId = 'output'
} = {}) {
  const node = normalizeNode(recipeEffect(effect, nodeId, 'return'), 0);
  requireWetOnlyIRReverb(node);
  const used = new Set([inputId, outputId, node.id]);
  const mainId = availableId('main', used);
  const sendId = availableId('send', used);
  const returnId = availableId('return', used);
  return normalizeGraphDocument({
    version: 1,
    input: { id: inputId },
    output: { id: outputId },
    nodes: [node],
    edges: [
      { id: mainId, source: inputId, destination: outputId, mixGroup: 'main' },
      { id: sendId, source: inputId, destination: node.id, gain: send },
      { id: returnId, source: node.id, destination: outputId, gain: returnGain, mixGroup: 'main' }
    ]
  });
}
