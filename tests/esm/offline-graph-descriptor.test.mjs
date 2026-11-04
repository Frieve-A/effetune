import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfflineGraphDescriptor } from '../../js/audio/offline-graph-descriptor.js';

function evaluate(descriptor, input, gains) {
    const view = new DataView(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
    assert.equal(view.getUint32(0, true), 0x464f5445);
    const nodes = view.getUint32(8, true), edges = view.getUint32(12, true);
    const outputs = new Map([[0xffffffff, input]]);
    const mix = destination => {
        const result = input.map(() => 0);
        for (let edge = 0; edge < edges; edge++) {
            const offset = 32 + nodes * 24 + edge * 40;
            if (view.getUint32(offset + 4, true) !== destination) continue;
            const source = outputs.get(view.getUint32(offset, true));
            const mask = view.getUint32(offset + 36, true);
            result.forEach((_, channel) => { if (mask & (1 << channel)) result[channel] += source[channel]; });
        }
        return result;
    };
    for (let node = 0; node < nodes; node++) {
        const output = mix(node);
        const gain = gains[view.getUint32(32 + node * 24, true)];
        outputs.set(node, output.map(value => value * gain));
    }
    return mix(0xffffffff);
}

test('offline graph preserves partial channel replacement, additive side buses and untouched channels', () => {
    const pipeline = [
        { id: 1, enabled: true, channel: 'L', inputBus: 0, outputBus: 1 },
        { id: 2, enabled: true, channel: 'R', inputBus: 0, outputBus: 1 },
        { id: 3, enabled: true, channel: 'A', inputBus: 1, outputBus: 0 },
        { id: 4, enabled: true, channel: 'L', inputBus: 0, outputBus: 0 },
        { id: 5, enabled: true, channel: 'L', inputBus: 0, outputBus: 2 },
        { id: 6, enabled: true, channel: 'L', inputBus: 0, outputBus: 2 },
        { id: 7, enabled: true, channel: 'L', inputBus: 2, outputBus: 0 }
    ];
    const descriptor = buildOfflineGraphDescriptor(pipeline, 4, { getInstanceId: plugin => plugin.id });
    // Bus1=[4,12,0,0], main=[6,15,5,7], L replacement=18;
    // the two side sends produce 36+54, which is added back to main L.
    assert.deepEqual(evaluate(descriptor, [2, 3, 5, 7], { 1: 2, 2: 4, 3: 1, 4: 3, 5: 2, 6: 3, 7: 1 }),
        [108, 15, 5, 7]);
});

test('offline graph leaves a silent auxiliary input silent and omits disabled sections', () => {
    class SectionPlugin { constructor() { this.enabled = false; } }
    const pipeline = [
        { id: 1, enabled: true, channel: 'A', inputBus: 2, outputBus: 0 },
        new SectionPlugin(),
        { id: 2, enabled: true, channel: 'A', inputBus: 0, outputBus: 0 }
    ];
    const descriptor = buildOfflineGraphDescriptor(pipeline, 2, { getInstanceId: plugin => plugin.id });
    assert.deepEqual(evaluate(descriptor, [2, 3], { 1: 10, 2: 0 }), [2, 3]);
});
