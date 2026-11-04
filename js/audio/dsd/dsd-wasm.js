import { DSD_WASM_BASE64 } from './dsd-wasm.generated.js';
import { dsdError } from './dsd-parser.js';

let compiledModule;

// One immutable compiled module, with a private bounded memory for each decoder.
// Embedded bytes also work in bundled Workers, local-file Electron and Node.
export function createDsdWasmArena(layout) {
    try {
        compiledModule ??= new WebAssembly.Module(Uint8Array.from(atob(DSD_WASM_BASE64), char => char.charCodeAt(0)));
        const api = new WebAssembly.Instance(compiledModule).exports;
        let end = Number(api.__heap_base.value);
        const offsets = {};
        for (const [name, [Type, length]] of Object.entries(layout)) {
            end = Math.ceil(end / 8) * 8;
            offsets[name] = end;
            end += Type.BYTES_PER_ELEMENT * length;
        }
        const pages = Math.ceil(end / 65536);
        if (pages * 65536 > 20 * 1024 * 1024) throw new RangeError('DSD arena exceeds its memory budget');
        const extra = pages - api.memory.buffer.byteLength / 65536;
        if (extra > 0) api.memory.grow(extra);
        const views = Object.fromEntries(Object.entries(layout).map(([name, [Type, length]]) =>
            [name, new Type(api.memory.buffer, offsets[name], length)]));
        return { api, offsets, views };
    } catch (error) {
        console.error('[DSD] WebAssembly initialization failed:', error);
        throw dsdError('DSD_UNSUPPORTED', 'DSD decoding requires WebAssembly support');
    }
}
