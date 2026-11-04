import { buildDspPipelineNodes, encodeDspChannelSpec } from './dsp-pipeline-descriptor.js';

// Internal export graph. Each channel retains its ordered bus sum until a plugin
// replaces it in place or adds its selected output to a different bus.
export function buildOfflineGraphDescriptor(pipeline, channelCount, options) {
    const chain = buildDspPipelineNodes(pipeline, { ...options, omitInactive: true });
    const endpoint = 0xffffffff;
    const buses = Array.from({ length: 5 }, (_, bus) =>
        Array.from({ length: channelCount }, () => bus === 0 ? [endpoint] : []));
    const nodes = [], edges = [];
    const connect = (channels, destination, first = 0, count = channelCount) => {
        const sources = new Map();
        for (let channel = first; channel < first + count; channel++) {
            // A source can occur more than once in an additive bus.
            const occurrences = new Map();
            for (const source of channels[channel]) {
                const occurrence = occurrences.get(source) ?? 0;
                occurrences.set(source, occurrence + 1);
                const key = `${source}:${occurrence}`;
                const edge = sources.get(key) ?? { source, destination, mask: 0 };
                edge.mask |= 1 << channel;
                sources.set(key, edge);
            }
        }
        edges.push(...sources.values());
    };
    for (const node of chain) {
        const spec = encodeDspChannelSpec(node.channel);
        const first = spec >= 16 ? (spec - 16) * 2 : spec >= 0 ? spec : 0;
        const count = spec === -2 ? channelCount : spec === -1 || spec >= 16 ? 2 : 1;
        if (first + count > channelCount) continue;
        const index = nodes.length;
        nodes.push({ ...node, channelSpec: spec });
        connect(buses[node.inputBus], index, first, count);
        for (let channel = first; channel < first + count; channel++) {
            if (node.inputBus === node.outputBus) buses[node.outputBus][channel] = [index];
            else buses[node.outputBus][channel].push(index);
        }
    }
    connect(buses[0], endpoint);
    const strings = [];
    let stringBytes = 0;
    const string = text => {
        const bytes = new TextEncoder().encode(text);
        const result = [stringBytes, bytes.length];
        stringBytes += bytes.length;
        strings.push(bytes);
        return result;
    };
    const nodeNames = nodes.map((_, index) => string(`n${String(index).padStart(4, '0')}`));
    const edgeNames = edges.map((_, index) => string(`e${String(index).padStart(6, '0')}`));
    const group = string('pipeline');
    const tableBytes = 32 + nodes.length * 24 + edges.length * 40;
    const bytes = new Uint8Array(tableBytes + stringBytes);
    const view = new DataView(bytes.buffer);
    const u32 = (offset, value) => view.setUint32(offset, value, true);
    u32(0, 0x464f5445); u32(4, 1); u32(8, nodes.length);
    u32(12, edges.length); u32(16, stringBytes);
    nodes.forEach((node, index) => {
        const offset = 32 + index * 24;
        u32(offset, node.instanceId);
        u32(offset + 4, nodeNames[index][0]); u32(offset + 8, nodeNames[index][1]);
        u32(offset + 12, 1);
        view.setInt32(offset + 16, node.channelSpec, true);
    });
    edges.forEach((edge, index) => {
        const offset = 32 + nodes.length * 24 + index * 40;
        u32(offset, edge.source); u32(offset + 4, edge.destination);
        u32(offset + 8, edgeNames[index][0]); u32(offset + 12, edgeNames[index][1]);
        u32(offset + 16, group[0]); u32(offset + 20, group[1]);
        view.setFloat32(offset + 24, 1, true); u32(offset + 36, edge.mask);
    });
    let offset = tableBytes;
    for (const value of strings) { bytes.set(value, offset); offset += value.length; }
    return bytes;
}
