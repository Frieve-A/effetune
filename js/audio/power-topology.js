export const TEMPORAL_CAPABILITIES = Object.freeze([
    'stateless',
    'reset-on-resume',
    'age-by-skipped-frames',
    'must-process'
]);

export const MONITORING_FAST_WAKE_BLOCKERS = Object.freeze([
    'temporal-preparation-not-worklet-local',
    'temporal-preparation-unbounded',
    'temporal-preparation-allocating',
    'temporal-must-process',
    'temporal-preparation-runtime-failed'
]);

const ZERO_OUTPUT_PROOF_KINDS = new Set([
    'final-output-gain-zero',
    'post-dominating-mute'
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function isIdentity(value) {
    return Number.isSafeInteger(value) && value >= 0 ||
        typeof value === 'string' && value.length > 0;
}

function normalizeBus(bus) {
    return bus === null || bus === undefined ? 0 : bus;
}

function getPluginType(plugin) {
    return typeof plugin?.type === 'string'
        ? plugin.type
        : plugin?.constructor?.name || null;
}

function normalizeAnalyticAgeDescriptor(descriptor) {
    if (!descriptor || descriptor.primitive !== 'analytic-age' ||
        descriptor.allocationFree !== true ||
        descriptor.parameterTimeline !== 'topology-invalidates-skip' ||
        descriptor.resetFallback !== 'canonical-reset' ||
        !Array.isArray(descriptor.stateFields) || descriptor.stateFields.length === 0 ||
        !Number.isSafeInteger(descriptor.fixedOperations) ||
        descriptor.fixedOperations !== descriptor.stateFields.length) return null;

    const keys = new Set();
    const stateFields = [];
    for (const field of descriptor.stateFields) {
        if (!field || typeof field.key !== 'string' || field.key.length === 0 ||
            keys.has(field.key) || !Number.isFinite(field.incrementPerFrame)) return null;
        const modulo = field.modulo === null || field.modulo === undefined
            ? null
            : field.modulo;
        if (modulo !== null && (!Number.isFinite(modulo) || modulo <= 0)) return null;
        keys.add(field.key);
        stateFields.push(Object.freeze({
            key: field.key,
            incrementPerFrame: field.incrementPerFrame,
            modulo
        }));
    }
    return Object.freeze({
        primitive: 'analytic-age',
        allocationFree: true,
        fixedOperations: descriptor.fixedOperations,
        parameterTimeline: 'topology-invalidates-skip',
        resetFallback: 'canonical-reset',
        stateFields: Object.freeze(stateFields)
    });
}

export function normalizeTemporalPreparationDescriptor(capability, descriptor) {
    if (capability === 'stateless') return null;
    if (capability === 'reset-on-resume') {
        if (descriptor === null || descriptor === undefined) {
            return Object.freeze({
                primitive: 'canonical-reset',
                allocationFree: false,
                fixedOperations: 1
            });
        }
        if (descriptor.primitive !== 'canonical-reset' ||
            !Number.isSafeInteger(descriptor.fixedOperations) || descriptor.fixedOperations < 1) {
            return null;
        }
        return Object.freeze({
            primitive: 'canonical-reset',
            allocationFree: descriptor.allocationFree === true,
            fixedOperations: descriptor.fixedOperations
        });
    }
    if (capability === 'age-by-skipped-frames') {
        return normalizeAnalyticAgeDescriptor(descriptor);
    }
    return null;
}

/**
 * Freeze the graph facts used by both the zero-output proof and wake bound.
 * The caller must set finalOutputGainPostDominatesAllOutputs only for the
 * application-owned Worklet -> final gain -> physical outputs topology.
 */
export function createPowerTopologySnapshot({
    topologyRevision,
    workletGraphGeneration,
    plugins = [],
    masterBypass = false,
    physicalOutputCount = 1,
    finalOutputGain = null,
    finalOutputGainPostDominatesAllOutputs = false,
    hasPostGainInjection = true,
    parallelPipelineActive = false
} = {}) {
    if (!Number.isSafeInteger(topologyRevision) || topologyRevision < 0 ||
        !Number.isSafeInteger(workletGraphGeneration) || workletGraphGeneration < 0 ||
        !Number.isSafeInteger(physicalOutputCount) || physicalOutputCount < 1) return null;

    const physicalOutputIds = [];
    for (let index = 0; index < physicalOutputCount; index++) {
        physicalOutputIds.push(`physical-output-${index}`);
    }
    const pluginTopology = (Array.isArray(plugins) ? plugins : []).map((plugin, index) => ({
        pluginId: isIdentity(plugin?.id) ? plugin.id : `pipeline-${index}`,
        type: getPluginType(plugin),
        enabled: plugin?.enabled !== false,
        inputBus: normalizeBus(plugin?.inputBus),
        outputBus: normalizeBus(plugin?.outputBus),
        section: getPluginType(plugin) === 'SectionPlugin'
    }));
    return deepFreeze({
        topologyRevision,
        workletGraphGeneration,
        physicalOutputIds,
        plugins: pluginTopology,
        masterBypass: masterBypass === true,
        finalOutputGain: Number.isFinite(finalOutputGain) ? finalOutputGain : null,
        finalOutputGainPostDominatesAllOutputs:
            finalOutputGainPostDominatesAllOutputs === true,
        hasPostGainInjection: hasPostGainInjection !== false,
        parallelPipelineActive: parallelPipelineActive === true
    });
}

function createZeroOutputProof(snapshot, proven, proofKind, reason) {
    return deepFreeze({
        proven,
        topologyRevision: snapshot.topologyRevision,
        workletGraphGeneration: snapshot.workletGraphGeneration,
        proofKind,
        coveredPhysicalOutputIds: proven ? [...snapshot.physicalOutputIds] : [],
        reason
    });
}

/** Derive a structural zero-output proof from one immutable topology snapshot. */
export function getZeroOutputProof(topologySnapshot) {
    const snapshot = topologySnapshot;
    if (!snapshot || !Object.isFrozen(snapshot) || !Array.isArray(snapshot.physicalOutputIds) ||
        snapshot.physicalOutputIds.length === 0) return null;
    if (!snapshot.finalOutputGainPostDominatesAllOutputs || snapshot.hasPostGainInjection) {
        return createZeroOutputProof(snapshot, false, null, 'unproven-output-topology');
    }
    if (snapshot.finalOutputGain === 0) {
        return createZeroOutputProof(
            snapshot,
            true,
            'final-output-gain-zero',
            null
        );
    }
    if (snapshot.masterBypass || snapshot.parallelPipelineActive) {
        return createZeroOutputProof(snapshot, false, null, 'mute-path-bypassed');
    }

    let sectionEnabled = true;
    const reachable = [];
    for (const plugin of snapshot.plugins) {
        if (plugin.section) {
            sectionEnabled = plugin.enabled;
            continue;
        }
        if (plugin.enabled && sectionEnabled) reachable.push(plugin);
    }
    const serialMainBus = reachable.every(plugin =>
        plugin.inputBus === 0 && plugin.outputBus === 0);
    const lastPlugin = reachable.at(-1);
    if (serialMainBus && lastPlugin?.type === 'MutePlugin') {
        return createZeroOutputProof(snapshot, true, 'post-dominating-mute', null);
    }
    return createZeroOutputProof(snapshot, false, null, serialMainBus
        ? 'no-post-dominating-zero-stage'
        : 'unproven-bus-routing');
}

export function isCurrentZeroOutputProof(proof, topologySnapshot) {
    if (!proof || proof.proven !== true || !topologySnapshot ||
        proof.topologyRevision !== topologySnapshot.topologyRevision ||
        proof.workletGraphGeneration !== topologySnapshot.workletGraphGeneration ||
        !ZERO_OUTPUT_PROOF_KINDS.has(proof.proofKind) ||
        !Array.isArray(proof.coveredPhysicalOutputIds) ||
        proof.coveredPhysicalOutputIds.length !== topologySnapshot.physicalOutputIds.length) {
        return false;
    }
    const covered = new Set(proof.coveredPhysicalOutputIds);
    return covered.size === proof.coveredPhysicalOutputIds.length &&
        topologySnapshot.physicalOutputIds.every(outputId => covered.has(outputId));
}

export function amplitudeFromDb(db) {
    return Number.isFinite(db) ? Math.pow(10, db / 20) : Infinity;
}

export function dbFromAmplitude(amplitude) {
    if (amplitude === 0) return -Infinity;
    return Number.isFinite(amplitude) && amplitude > 0
        ? 20 * Math.log10(amplitude)
        : Infinity;
}

export function sumAbsoluteCoefficients(coefficients) {
    if (!Array.isArray(coefficients)) return Infinity;
    let sum = 0;
    for (const coefficient of coefficients) {
        if (!Number.isFinite(coefficient)) return Infinity;
        const magnitude = coefficient < 0 ? -coefficient : coefficient;
        sum += magnitude;
    }
    return sum;
}

export function computeMatrixAmplitudeBound(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return Infinity;
    let largestRow = 0;
    for (const row of rows) {
        const rowBound = sumAbsoluteCoefficients(row);
        if (!Number.isFinite(rowBound)) return Infinity;
        if (rowBound > largestRow) largestRow = rowBound;
    }
    return largestRow;
}

export function computeParallelAmplitudeBound(branchBounds) {
    if (!Array.isArray(branchBounds)) return Infinity;
    let sum = 0;
    for (const bound of branchBounds) {
        if (!Number.isFinite(bound) || bound < 0) return Infinity;
        sum += bound;
    }
    return sum;
}

/**
 * Compute a graph-wide linear amplitude upper bound. Each edge is
 * {from,to,coefficient}; each node may specify a non-negative gain bound.
 */
export function computeGraphAmplitudeBound({ inputNodeIds, nodes, edges, physicalOutputNodeIds }) {
    if (!Array.isArray(inputNodeIds) || !Array.isArray(nodes) ||
        !Array.isArray(edges) || !Array.isArray(physicalOutputNodeIds)) {
        return { finite: false, amplitude: Infinity, db: Infinity, reason: 'invalid-topology' };
    }
    const nodeMap = new Map();
    const incoming = new Map();
    for (const node of nodes) {
        if (!node || typeof node.id !== 'string' || nodeMap.has(node.id)) {
            return { finite: false, amplitude: Infinity, db: Infinity, reason: 'invalid-node' };
        }
        const gain = node.gain === undefined ? 1 : node.gain;
        if (!Number.isFinite(gain) || gain < 0) {
            return { finite: false, amplitude: Infinity, db: Infinity, reason: 'unbounded-node' };
        }
        nodeMap.set(node.id, { ...node, gain });
        incoming.set(node.id, []);
    }
    for (const edge of edges) {
        if (!nodeMap.has(edge?.from) || !nodeMap.has(edge?.to) ||
            !Number.isFinite(edge.coefficient)) {
            return { finite: false, amplitude: Infinity, db: Infinity, reason: 'unbounded-edge' };
        }
        incoming.get(edge.to).push(edge);
    }
    const inputSet = new Set(inputNodeIds);
    const memo = new Map();
    const visiting = new Set();
    const visit = nodeId => {
        if (memo.has(nodeId)) return memo.get(nodeId);
        if (visiting.has(nodeId)) return Infinity;
        const node = nodeMap.get(nodeId);
        if (!node) return Infinity;
        visiting.add(nodeId);
        let inputBound = inputSet.has(nodeId) ? 1 : 0;
        for (const edge of incoming.get(nodeId)) {
            const upstream = visit(edge.from);
            if (!Number.isFinite(upstream)) {
                inputBound = Infinity;
                break;
            }
            const coefficient = edge.coefficient < 0 ? -edge.coefficient : edge.coefficient;
            inputBound += upstream * coefficient;
        }
        visiting.delete(nodeId);
        const result = inputBound * node.gain;
        memo.set(nodeId, result);
        return result;
    };

    let amplitude = 0;
    for (const outputId of physicalOutputNodeIds) {
        const outputBound = visit(outputId);
        if (!Number.isFinite(outputBound)) {
            return { finite: false, amplitude: Infinity, db: Infinity, reason: 'cycle-or-unbounded-path' };
        }
        if (outputBound > amplitude) amplitude = outputBound;
    }
    return { finite: true, amplitude, db: dbFromAmplitude(amplitude), reason: null };
}

function getTemporalCapability(plugin) {
    const declared = typeof plugin?.getTemporalCapability === 'function'
        ? plugin.getTemporalCapability()
        : plugin?.temporalCapability;
    return TEMPORAL_CAPABILITIES.includes(declared) ? declared : 'must-process';
}

export function getReachableEnabledPlugins(plugins) {
    if (!Array.isArray(plugins)) return [];
    const enabled = [];
    let sectionEnabled = true;
    for (const plugin of plugins) {
        if (plugin?.constructor?.name === 'SectionPlugin') {
            sectionEnabled = plugin.enabled !== false;
            continue;
        }
        if (plugin?.enabled !== false && sectionEnabled) enabled.push(plugin);
    }
    return enabled;
}

export function analyzeTemporalCapabilities(plugins) {
    const enabled = getReachableEnabledPlugins(plugins);
    const capabilities = enabled.map((plugin, index) => {
        const capability = getTemporalCapability(plugin);
        const sourceDescriptor = plugin.monitoringPreparationDescriptor || null;
        return {
            pluginId: plugin.id ?? `pipeline-${index}`,
            capability,
            descriptor: normalizeTemporalPreparationDescriptor(capability, sourceDescriptor)
        };
    });
    if (capabilities.some(item => item.capability === 'must-process')) {
        return {
            capabilities,
            temporalSkipEligible: false,
            monitoringFastWakeEligible: false,
            blockerReason: 'temporal-must-process'
        };
    }
    const identities = new Set();
    for (const item of capabilities) {
        if (!isIdentity(item.pluginId) || identities.has(item.pluginId)) {
            return {
                capabilities,
                temporalSkipEligible: false,
                monitoringFastWakeEligible: false,
                blockerReason: 'temporal-preparation-not-worklet-local'
            };
        }
        identities.add(item.pluginId);
        if (item.capability === 'age-by-skipped-frames' && !item.descriptor) {
            return {
                capabilities,
                temporalSkipEligible: false,
                monitoringFastWakeEligible: false,
                blockerReason: 'temporal-preparation-not-worklet-local'
            };
        }
    }
    for (const item of capabilities) {
        if (item.capability === 'stateless') continue;
        const descriptor = item.descriptor;
        if (!descriptor || descriptor.primitive !== 'canonical-reset' ||
            descriptor.allocationFree !== true) {
            return {
                capabilities,
                temporalSkipEligible: true,
                monitoringFastWakeEligible: false,
                blockerReason: 'temporal-preparation-not-worklet-local'
            };
        }
        if (!Number.isInteger(descriptor.fixedOperations) || descriptor.fixedOperations < 0) {
            return {
                capabilities,
                temporalSkipEligible: true,
                monitoringFastWakeEligible: false,
                blockerReason: 'temporal-preparation-unbounded'
            };
        }
    }
    return {
        capabilities,
        temporalSkipEligible: true,
        monitoringFastWakeEligible: true,
        blockerReason: null
    };
}

export function computeLinearPipelineWakeBound(plugins, channelFanIn = 1) {
    if (!Number.isFinite(channelFanIn) || channelFanIn < 0) {
        return { finite: false, amplitude: Infinity, db: Infinity, reason: 'invalid-fan-in' };
    }
    let amplitude = channelFanIn;
    for (const plugin of Array.isArray(plugins) ? plugins : []) {
        if (plugin?.enabled === false || plugin?.constructor?.name === 'SectionPlugin') continue;
        let gainDb;
        if (typeof plugin.getPowerGainUpperBoundDb === 'function') {
            gainDb = plugin.getPowerGainUpperBoundDb();
        } else {
            gainDb = plugin.powerGainUpperBoundDb;
        }
        if (!Number.isFinite(gainDb)) {
            return { finite: false, amplitude: Infinity, db: Infinity, reason: 'unbounded-plugin' };
        }
        amplitude *= amplitudeFromDb(gainDb);
    }
    return { finite: true, amplitude, db: dbFromAmplitude(amplitude), reason: null };
}

export function computeRuntimePipelineGraphBound({
    plugins,
    masterBypass = false,
    outputGainUpperBound = 1,
    physicalOutputCount = 1
} = {}) {
    if (!Number.isSafeInteger(physicalOutputCount) || physicalOutputCount < 1 ||
        !Number.isFinite(outputGainUpperBound) || outputGainUpperBound < 0) {
        return { finite: false, amplitude: Infinity, db: Infinity, reason: 'invalid-topology' };
    }

    const nodes = [{ id: 'routed-input', gain: 1 }];
    const edges = [];
    let previousNodeId = 'routed-input';
    if (!masterBypass) {
        const enabled = getReachableEnabledPlugins(plugins);
        for (let index = 0; index < enabled.length; index++) {
            const plugin = enabled[index];
            const inputBus = plugin.inputBus ?? 0;
            const outputBus = plugin.outputBus ?? 0;
            if (inputBus !== 0 || outputBus !== 0) {
                return {
                    finite: false,
                    amplitude: Infinity,
                    db: Infinity,
                    reason: 'unbounded-routing'
                };
            }
            const gainDb = typeof plugin.getPowerGainUpperBoundDb === 'function'
                ? plugin.getPowerGainUpperBoundDb()
                : plugin.powerGainUpperBoundDb;
            if (!Number.isFinite(gainDb)) {
                return {
                    finite: false,
                    amplitude: Infinity,
                    db: Infinity,
                    reason: 'unbounded-plugin'
                };
            }
            const matrix = typeof plugin.getPowerChannelMatrix === 'function'
                ? plugin.getPowerChannelMatrix()
                : plugin.powerChannelMatrix;
            const matrixBound = matrix === undefined || matrix === null
                ? 1
                : computeMatrixAmplitudeBound(matrix);
            if (!Number.isFinite(matrixBound)) {
                return {
                    finite: false,
                    amplitude: Infinity,
                    db: Infinity,
                    reason: 'unbounded-channel-matrix'
                };
            }
            const nodeId = `plugin-${index}`;
            nodes.push({ id: nodeId, gain: amplitudeFromDb(gainDb) * matrixBound });
            edges.push({ from: previousNodeId, to: nodeId, coefficient: 1 });
            previousNodeId = nodeId;
        }
    }

    nodes.push({ id: 'output-gain', gain: outputGainUpperBound });
    edges.push({ from: previousNodeId, to: 'output-gain', coefficient: 1 });
    const physicalOutputNodeIds = [];
    for (let index = 0; index < physicalOutputCount; index++) {
        const outputId = `physical-output-${index}`;
        physicalOutputNodeIds.push(outputId);
        nodes.push({ id: outputId, gain: 1 });
        edges.push({ from: 'output-gain', to: outputId, coefficient: 1 });
    }
    return computeGraphAmplitudeBound({
        inputNodeIds: ['routed-input'],
        nodes,
        edges,
        physicalOutputNodeIds
    });
}
