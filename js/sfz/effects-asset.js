import { compileSfzEffects, packSfzEffects } from './effects.js';
import { SFZ_MOD_LAYOUT } from './modulation-schema.js';

// Consume the existing parser's inherited regions and ordered headers. Path
// normalization belongs to that parser, including its current default_path.
export function compileSfzEffectHeaders(regions, headers) {
    const authored = headers.some(header => header.name === 'effect' || header.name === 'midi') ||
        regions.some(region => Object.keys(region.opcodes ?? region).some(key => /^(?:output|effect[1-4])$/.test(key)));
    return authored ? compileSfzEffects(regions, headers) : null;
}

export function effectSamplePaths(plan) {
    return [...new Set(plan?.nodes.filter(node => node.impulse !== undefined).map(node => node.impulse) ?? [])].sort();
}

// MODv4 extends the existing v3 header by two words; every original section
// retains its meaning and is followed by one complete FXv1 section.
export function packSfzEffectModulation(modulationBytes, plan, resolveImpulse) {
    if (!plan) return modulationBytes;
    if (!(modulationBytes instanceof Uint8Array) || modulationBytes.byteLength % 4 ||
        modulationBytes.byteLength < SFZ_MOD_LAYOUT.HeaderWords * 4) throw new Error('Invalid SFZ modulation section.');
    const original = new DataView(modulationBytes.buffer, modulationBytes.byteOffset, modulationBytes.byteLength);
    if (original.getUint32(0, true) !== 0x31525453 || original.getUint32(4, true) !== 3 ||
        SFZ_MOD_LAYOUT.HeaderWords !== 14 || original.getUint32(8, true) !== plan.regions.length)
        throw new Error('Invalid SFZ modulation section.');
    const effects = packSfzEffects(plan, resolveImpulse);
    const fxOffset = modulationBytes.byteLength / 4 + 2;
    const bytes = new Uint8Array(modulationBytes.byteLength + 8 + effects.byteLength);
    bytes.set(modulationBytes.subarray(0, 56));
    bytes.set(modulationBytes.subarray(56), 64);
    bytes.set(effects, fxOffset * 4);
    const output = new DataView(bytes.buffer);
    output.setUint32(4, 4, true);
    for (const index of [5, 6, 7, 8, 10]) output.setUint32(index * 4, original.getUint32(index * 4, true) + 2, true);
    output.setUint32(56, fxOffset, true);
    output.setUint32(60, effects.byteLength / 4, true);
    return bytes;
}
