export const DSP_PIPELINE_DESCRIPTOR_VERSION = 1;
export const DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES = 8;
export const DSP_PIPELINE_DESCRIPTOR_NODE_BYTES = 12;
export const DSP_PIPELINE_MAX_NODES = 128;
export const DSP_PIPELINE_MAX_BUS = 4;

export class DspPipelineDescriptorError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspPipelineDescriptorError';
    }
}

function asBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new DspPipelineDescriptorError('Descriptor must be an ArrayBuffer or typed-array view');
}

function requireUint32(value, label, { allowZero = true } = {}) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff || (!allowZero && value === 0)) {
        throw new DspPipelineDescriptorError(`${label} must be ${allowZero ? 'a' : 'a nonzero'} uint32`);
    }
    return value >>> 0;
}

function requireFlag(value, label) {
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    throw new DspPipelineDescriptorError(`${label} must be boolean or 0/1`);
}

function requireBus(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > DSP_PIPELINE_MAX_BUS) {
        throw new DspPipelineDescriptorError(`${label} must be an integer from 0 to ${DSP_PIPELINE_MAX_BUS}`);
    }
    return value;
}

export function isValidEncodedChannelSpec(value) {
    return value === -2 || value === -1 ||
        (Number.isInteger(value) && value >= 0 && value <= 7) ||
        (Number.isInteger(value) && value >= 16 && value <= 19);
}

export function encodeDspChannelSpec(channel) {
    if (channel === null || channel === undefined) return -1;
    if (channel === 'A') return -2;
    if (channel === 'L') return 0;
    if (channel === 'R') return 1;
    if (channel === '34') return 17;
    if (channel === '56') return 18;
    if (channel === '78') return 19;
    if (typeof channel === 'string' && /^[1-8]$/.test(channel)) {
        return Number(channel) - 1;
    }
    throw new DspPipelineDescriptorError(`Unsupported channel specifier: ${String(channel)}`);
}

export function decodeDspChannelSpec(channelSpec) {
    if (!isValidEncodedChannelSpec(channelSpec)) {
        throw new DspPipelineDescriptorError(`Invalid encoded channel specifier: ${String(channelSpec)}`);
    }
    if (channelSpec === -2) return 'A';
    if (channelSpec === -1) return null;
    if (channelSpec === 16) return null;
    if (channelSpec === 0) return 'L';
    if (channelSpec === 1) return 'R';
    if (channelSpec >= 16) return String((channelSpec - 16) * 2 + 1) + String((channelSpec - 16) * 2 + 2);
    return String(channelSpec + 1);
}

function normalizeNode(node, index) {
    if (!node || typeof node !== 'object') {
        throw new DspPipelineDescriptorError(`Pipeline node ${index} must be an object`);
    }
    const channelSpec = node.channelSpec === undefined
        ? encodeDspChannelSpec(node.channel)
        : node.channelSpec;
    if (!isValidEncodedChannelSpec(channelSpec)) {
        throw new DspPipelineDescriptorError(`Pipeline node ${index} has an invalid channel specifier`);
    }
    return {
        instanceId: requireUint32(node.instanceId ?? node.instance, `Pipeline node ${index} instance`, { allowZero: false }),
        enabled: requireFlag(node.enabled, `Pipeline node ${index} enabled`),
        inputBus: requireBus(node.inputBus, `Pipeline node ${index} input bus`),
        outputBus: requireBus(node.outputBus, `Pipeline node ${index} output bus`),
        channelSpec,
        sectionGate: requireFlag(node.sectionGate, `Pipeline node ${index} section gate`)
    };
}

export function encodeDspPipelineDescriptor(nodes) {
    if (!Array.isArray(nodes)) throw new DspPipelineDescriptorError('Pipeline nodes must be an array');
    if (nodes.length > DSP_PIPELINE_MAX_NODES) {
        throw new DspPipelineDescriptorError(`Pipeline exceeds ${DSP_PIPELINE_MAX_NODES} nodes`);
    }

    const normalized = nodes.map(normalizeNode);
    const seenInstances = new Set();
    for (const node of normalized) {
        if (seenInstances.has(node.instanceId)) {
            throw new DspPipelineDescriptorError(`Duplicate pipeline instance ${node.instanceId}`);
        }
        seenInstances.add(node.instanceId);
    }

    const bytes = new Uint8Array(
        DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES + normalized.length * DSP_PIPELINE_DESCRIPTOR_NODE_BYTES
    );
    const view = new DataView(bytes.buffer);
    view.setUint32(0, DSP_PIPELINE_DESCRIPTOR_VERSION, true);
    view.setUint32(4, normalized.length, true);
    for (let index = 0; index < normalized.length; index++) {
        const node = normalized[index];
        const offset = DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES + index * DSP_PIPELINE_DESCRIPTOR_NODE_BYTES;
        view.setUint32(offset, node.instanceId, true);
        view.setUint8(offset + 4, node.enabled);
        view.setUint8(offset + 5, node.inputBus);
        view.setUint8(offset + 6, node.outputBus);
        view.setInt8(offset + 7, node.channelSpec);
        view.setUint8(offset + 8, node.sectionGate);
    }
    return bytes;
}

export function decodeDspPipelineDescriptor(descriptor) {
    const bytes = asBytes(descriptor);
    if (bytes.byteLength < DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES) {
        throw new DspPipelineDescriptorError('Descriptor header is truncated');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(0, true);
    const nodeCount = view.getUint32(4, true);
    if (version !== DSP_PIPELINE_DESCRIPTOR_VERSION) {
        throw new DspPipelineDescriptorError(`Unsupported descriptor version ${version}`);
    }
    if (nodeCount > DSP_PIPELINE_MAX_NODES) {
        throw new DspPipelineDescriptorError(`Descriptor exceeds ${DSP_PIPELINE_MAX_NODES} nodes`);
    }
    const expectedBytes = DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES + nodeCount * DSP_PIPELINE_DESCRIPTOR_NODE_BYTES;
    if (bytes.byteLength !== expectedBytes) {
        throw new DspPipelineDescriptorError('Descriptor length does not match its node count');
    }

    const nodes = [];
    const seenInstances = new Set();
    for (let index = 0; index < nodeCount; index++) {
        const offset = DSP_PIPELINE_DESCRIPTOR_HEADER_BYTES + index * DSP_PIPELINE_DESCRIPTOR_NODE_BYTES;
        const instanceId = view.getUint32(offset, true);
        const enabled = view.getUint8(offset + 4);
        const inputBus = view.getUint8(offset + 5);
        const outputBus = view.getUint8(offset + 6);
        const channelSpec = view.getInt8(offset + 7);
        const sectionGate = view.getUint8(offset + 8);
        if (view.getUint8(offset + 9) !== 0 || view.getUint8(offset + 10) !== 0 ||
            view.getUint8(offset + 11) !== 0) {
            throw new DspPipelineDescriptorError(`Pipeline node ${index} has nonzero padding`);
        }
        const node = normalizeNode({ instanceId, enabled, inputBus, outputBus, channelSpec, sectionGate }, index);
        if (seenInstances.has(node.instanceId)) {
            throw new DspPipelineDescriptorError(`Duplicate pipeline instance ${node.instanceId}`);
        }
        seenInstances.add(node.instanceId);
        nodes.push(node);
    }
    return { version, nodes };
}

function isSectionPlugin(plugin) {
    return plugin?.constructor?.name === 'SectionPlugin';
}

export function buildDspPipelineNodes(pipeline, {
    getInstanceId,
    getParameters = () => ({}),
    omitInactive = false
} = {}) {
    if (!Array.isArray(pipeline)) throw new DspPipelineDescriptorError('Pipeline must be an array');
    if (typeof getInstanceId !== 'function') {
        throw new DspPipelineDescriptorError('getInstanceId must be a function');
    }

    let insideSection = false;
    let sectionEnabled = true;
    const nodes = [];
    for (const plugin of pipeline) {
        if (isSectionPlugin(plugin)) {
            insideSection = true;
            sectionEnabled = Boolean(plugin.enabled);
            continue;
        }

        const enabled = Boolean(plugin?.enabled);
        const sectionGate = !insideSection || sectionEnabled;
        if (omitInactive && (!enabled || !sectionGate)) continue;
        const parameters = getParameters(plugin) || {};
        nodes.push({
            instanceId: getInstanceId(plugin),
            enabled,
            inputBus: parameters.inputBus ?? plugin?.inputBus ?? 0,
            outputBus: parameters.outputBus ?? plugin?.outputBus ?? 0,
            channel: parameters.channel ?? plugin?.channel ?? null,
            sectionGate
        });
    }
    return nodes;
}

export function buildDspPipelineDescriptor(pipeline, options) {
    return encodeDspPipelineDescriptor(buildDspPipelineNodes(pipeline, options));
}
