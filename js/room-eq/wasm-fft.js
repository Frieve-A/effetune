import { instantiateDsp, loadDspModule } from '../audio/dsp-wasm-loader.js';

const ET_OK = 0;

export class WasmRoomEqFftBackend {
    constructor(binding) {
        this.binding = binding;
        this.handles = new Map();
    }

    _handle(size) {
        const cached = this.handles.get(size);
        if (cached) return cached;
        const handle = this.binding.createDesignFft(size);
        if (!handle) throw new Error(`WASM FFT setup failed for ${size} samples`);
        const record = {
            handle,
            input: this.binding.getDesignFftInput(handle),
            output: this.binding.getDesignFftOutput(handle)
        };
        if (!record.input || !record.output) {
            this.binding.destroyDesignFft(handle);
            throw new Error('WASM FFT buffers are unavailable');
        }
        this.handles.set(size, record);
        if (this.handles.size > 4) {
            const [oldestSize, oldest] = this.handles.entries().next().value;
            this.binding.destroyDesignFft(oldest.handle);
            this.handles.delete(oldestSize);
        }
        return record;
    }

    _view(pointer, size) {
        return new Float32Array(this.binding.memory.buffer, pointer, size);
    }

    realTransform(input) {
        const size = input.length;
        const record = this._handle(size);
        this._view(record.input, size).set(input);
        if (this.binding.runDesignFft(record.handle, false) !== ET_OK) {
            throw new Error('WASM FFT forward transform failed');
        }
        const packed = this._view(record.output, size);
        const real = new Float64Array(size / 2 + 1);
        const imag = new Float64Array(size / 2 + 1);
        real[0] = packed[0];
        real[size / 2] = packed[1];
        for (let bin = 1; bin < size / 2; bin += 1) {
            real[bin] = packed[bin * 2];
            imag[bin] = packed[bin * 2 + 1];
        }
        return { real, imag };
    }

    inverseRealTransform(real, imag, size) {
        const record = this._handle(size);
        const packed = this._view(record.input, size);
        packed.fill(0);
        packed[0] = real[0] || 0;
        packed[1] = real[size / 2] || 0;
        for (let bin = 1; bin < size / 2; bin += 1) {
            packed[bin * 2] = real[bin] || 0;
            packed[bin * 2 + 1] = imag[bin] || 0;
        }
        if (this.binding.runDesignFft(record.handle, true) !== ET_OK) {
            throw new Error('WASM FFT inverse transform failed');
        }
        return Float64Array.from(this._view(record.output, size));
    }

    close() {
        for (const record of this.handles.values()) this.binding.destroyDesignFft(record.handle);
        this.handles.clear();
        this.binding.close();
    }
}

export async function createWasmRoomEqFftBackend() {
    const basePath = new URL('../../', import.meta.url).href;
    const loaded = await loadDspModule({ basePath, publishTarget: null });
    if (!loaded?.module) return null;
    const binding = await instantiateDsp(loaded.module);
    if (!binding.hasDesignFft()) {
        binding.close();
        return null;
    }
    return new WasmRoomEqFftBackend(binding);
}
