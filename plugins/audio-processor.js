// IMPORTANT: Do not add individual plugin implementations directly in this file.
// This file contains the core audio processing infrastructure.
// Plugin implementations should be created in their own files under the plugins directory.
// See docs/plugin-development.md for plugin development guidelines.

// __ETDSP_BINDING_INJECT_START__
const REQUIRED_FUNCTION_EXPORTS = [
    'malloc',
    'free',
    'et_abi_version',
    'et_build_flags',
    'et_kernel_count',
    'et_kernel_name',
    'et_kernel_params_hash',
    'et_kernel_param_bytes_capacity',
    'et_kernel_asset_capacity',
    'et_engine_memory_required',
    'et_engine_create',
    'et_engine_destroy',
    'et_engine_prepare',
    'et_engine_reset',
    'et_engine_set_telemetry_rate',
    'et_instance_create',
    'et_instance_destroy',
    'et_instance_reset',
    'et_instance_latency',
    'et_instance_set_tap',
    'et_instance_set_seed',
    'et_instance_set_params',
    'et_instance_set_param_bytes',
    'et_instance_asset_begin',
    'et_instance_asset_commit',
    'et_instance_asset_abort',
    'et_instance_asset_state',
    'et_instance_process',
    'et_instance_runtime_event',
    'et_arena_combined_ptr',
    'et_arena_bus_ptr',
    'et_arena_scratch_ptr',
    'et_scratch_ptr',
    'et_telemetry_staging_ptr',
    'et_telemetry_capacity',
    'et_telemetry_read',
    'et_pipeline_configure',
    'et_pipeline_latency',
    'et_pipeline_process'
];

const ET_OK = 0;
const ET_ERR_STATE = -2;
const SCRATCH_BYTES = 4096;
const WASI_ERRNO_SUCCESS = 0;

function defaultWarning(message) {
    if (globalThis.console?.warn) {
        globalThis.console.warn(message);
    }
}

function defaultDebugWrite(message) {
    if (globalThis.console?.error) {
        globalThis.console.error(message);
    }
}

function isArrayBuffer(value) {
    return value instanceof ArrayBuffer;
}

function toUint8View(value, label) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (isArrayBuffer(value)) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError(`${label} must be an ArrayBuffer or typed-array view`);
}

function decodeUtf8(bytes) {
    if (typeof TextDecoder === 'function') {
        return new TextDecoder().decode(bytes);
    }
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return text;
}

function encodeUtf8(text) {
    if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(text);
    }
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code > 0x7f) {
            throw new TypeError('A TextEncoder is required for non-ASCII DSP names');
        }
        bytes[i] = code;
    }
    return bytes;
}

function mergeImports(base, extra) {
    if (!extra) return base;
    const merged = { ...base };
    for (const [moduleName, imports] of Object.entries(extra)) {
        merged[moduleName] = { ...(base[moduleName] || {}), ...imports };
    }
    return merged;
}

class DspBindingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspBindingError';
    }
}

function createDspImports({
    getMemory = () => null,
    debug = false,
    debugWrite = defaultDebugWrite,
    onMemoryGrowth = () => {}
} = {}) {
    const fdWrite = (fd, iovPtr, iovCount, writtenPtr) => {
        const memory = getMemory();
        if (!memory?.buffer) return WASI_ERRNO_SUCCESS;

        let written = 0;
        const chunks = [];
        try {
            const data = new DataView(memory.buffer);
            for (let i = 0; i < iovCount; i++) {
                const entry = iovPtr + i * 8;
                const ptr = data.getUint32(entry, true);
                const length = data.getUint32(entry + 4, true);
                if (ptr + length > memory.buffer.byteLength) break;
                written += length;
                if (debug && length > 0) {
                    chunks.push(new Uint8Array(memory.buffer, ptr, length));
                }
            }
            if (writtenPtr + 4 <= memory.buffer.byteLength) {
                data.setUint32(writtenPtr, written, true);
            }
        } catch {
            return WASI_ERRNO_SUCCESS;
        }

        if (debug && chunks.length > 0 && (fd === 1 || fd === 2)) {
            const total = new Uint8Array(written);
            let offset = 0;
            for (const chunk of chunks) {
                total.set(chunk, offset);
                offset += chunk.length;
            }
            debugWrite(decodeUtf8(total));
        }
        return WASI_ERRNO_SUCCESS;
    };

    return {
        wasi_snapshot_preview1: {
            proc_exit(code) {
                throw new DspBindingError(`WASM requested proc_exit(${code})`);
            },
            fd_write: fdWrite,
            fd_close() {
                return WASI_ERRNO_SUCCESS;
            },
            fd_seek() {
                return WASI_ERRNO_SUCCESS;
            }
        },
        env: {
            emscripten_notify_memory_growth() {
                onMemoryGrowth();
            }
        }
    };
}

class DspEngineBinding {
    constructor(instance, {
        warning = defaultWarning,
        onUnexpectedMemoryGrowth = null
    } = {}) {
        this.instance = instance?.instance || instance;
        this.exports = this.instance?.exports;
        this.warning = warning;
        this.onUnexpectedMemoryGrowth = onUnexpectedMemoryGrowth;
        this.engine = 0;
        this.prepared = false;
        this.failed = false;
        this.memoryGrowthViolation = false;
        this.lastTelemetryDroppedFrames = 0;
        this._preparing = false;
        this._memoryBuffer = null;
        this._warned = new Set();
        this._arenaViews = null;
        this._arenaRanges = [];
        this._maxChannels = 0;
        this._maxFrames = 0;
        this._telemetryStagingPtr = 0;
        this._telemetryDroppedPtr = 0;
        this._telemetryCapacity = 0;

        this._validateExports();
        this.memory = this.exports.memory;
        this._refreshViews(true);
    }

    _validateExports() {
        if (!this.exports || typeof this.exports !== 'object') {
            throw new DspBindingError('WASM instance exports are unavailable');
        }
        if (!this.exports.memory?.buffer) {
            throw new DspBindingError('Missing WASM export: memory');
        }
        for (const name of REQUIRED_FUNCTION_EXPORTS) {
            if (typeof this.exports[name] !== 'function') {
                throw new DspBindingError(`Missing WASM export: ${name}`);
            }
        }
    }

    _warnOnce(key, message) {
        if (this._warned.has(key)) return;
        this._warned.add(key);
        this.warning(`[dsp-wasm] ${message}`);
    }

    _refreshViews(initial = false) {
        const buffer = this.memory.buffer;
        if (buffer === this._memoryBuffer) return false;

        const unexpected = !initial && !this._preparing && this._memoryBuffer !== null;
        this._memoryBuffer = buffer;
        this.u8 = new Uint8Array(buffer);
        this.f32 = new Float32Array(buffer);
        this.dataView = new DataView(buffer);
        this._arenaViews = null;
        this._arenaRanges = [];

        if (unexpected) {
            this.memoryGrowthViolation = true;
            this._warnOnce('memory-growth', 'memory.buffer changed outside engine preparation');
            if (typeof this.onUnexpectedMemoryGrowth === 'function') {
                this.onUnexpectedMemoryGrowth();
            }
        }
        return true;
    }

    handleMemoryGrowthNotification() {
        return this._refreshViews();
    }

    checkMemoryBuffer() {
        const changed = this._refreshViews();
        return changed && this.memoryGrowthViolation && !this._preparing;
    }

    _assertRange(ptr, byteLength, label) {
        if (!Number.isInteger(ptr) || ptr < 0 || !Number.isInteger(byteLength) || byteLength < 0 ||
            ptr > this._memoryBuffer.byteLength - byteLength) {
            throw new DspBindingError(`${label} points outside WASM memory`);
        }
    }

    _writeScratchString(text) {
        if (!this.engine || !this.prepared) {
            throw new DspBindingError('DSP engine has not been prepared');
        }
        const bytes = encodeUtf8(String(text));
        if (bytes.length + 1 > SCRATCH_BYTES) {
            throw new DspBindingError('DSP name exceeds the scratch-buffer capacity');
        }
        this._refreshViews();
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._assertRange(ptr, SCRATCH_BYTES, 'DSP scratch buffer');
        this.u8.fill(0, ptr, ptr + bytes.length + 1);
        this.u8.set(bytes, ptr);
        return ptr;
    }

    getAbiVersion() {
        return this.exports.et_abi_version() >>> 0;
    }

    getBuildFlags() {
        return this.exports.et_build_flags() >>> 0;
    }

    getKernelCount() {
        return this.exports.et_kernel_count() >>> 0;
    }

    getKernelName(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        this._refreshViews();
        const useEngineScratch = Boolean(this.engine && this.prepared);
        const ptr = useEngineScratch
            ? this.exports.et_scratch_ptr(this.engine) >>> 0
            : this.exports.malloc(SCRATCH_BYTES) >>> 0;
        if (!ptr) throw new DspBindingError('Unable to allocate kernel-name staging memory');
        try {
            this._refreshViews();
            this._assertRange(ptr, SCRATCH_BYTES, 'DSP kernel-name buffer');
            const length = this.exports.et_kernel_name(index, ptr, SCRATCH_BYTES);
            if (!Number.isInteger(length) || length < 0 || length >= SCRATCH_BYTES) {
                throw new DspBindingError(`Invalid kernel name length for index ${index}`);
            }
            return decodeUtf8(this.u8.subarray(ptr, ptr + length));
        } finally {
            if (!useEngineScratch) this.exports.free(ptr);
        }
    }

    getKernelParamsHash(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        return this.exports.et_kernel_params_hash(index) >>> 0;
    }

    getKernelParamBytesCapacity(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        return this.exports.et_kernel_param_bytes_capacity(index) >>> 0;
    }

    getKernelAssetCapacity(index, slot = 0) {
        if (!Number.isInteger(index) || index < 0 || index >= this.getKernelCount()) {
            throw new RangeError('Kernel index is out of range');
        }
        if (!Number.isInteger(slot) || slot < 0) {
            throw new RangeError('Asset slot is out of range');
        }
        return this.exports.et_kernel_asset_capacity(index, slot) >>> 0;
    }

    hasDesignFft() {
        return [
            'et_design_fft_create',
            'et_design_fft_destroy',
            'et_design_fft_input',
            'et_design_fft_output',
            'et_design_fft_forward',
            'et_design_fft_inverse'
        ].every(name => typeof this.exports[name] === 'function');
    }

    createDesignFft(size) {
        if (!this.hasDesignFft()) return 0;
        const preparing = this._preparing;
        this._preparing = true;
        try {
            return this.exports.et_design_fft_create(size >>> 0) >>> 0;
        } finally {
            this._refreshViews();
            this._preparing = preparing;
        }
    }

    destroyDesignFft(handle) {
        if (handle && this.hasDesignFft()) this.exports.et_design_fft_destroy(handle >>> 0);
    }

    getDesignFftInput(handle) {
        return this.exports.et_design_fft_input(handle >>> 0) >>> 0;
    }

    getDesignFftOutput(handle) {
        return this.exports.et_design_fft_output(handle >>> 0) >>> 0;
    }

    runDesignFft(handle, inverse = false) {
        const transform = inverse ? this.exports.et_design_fft_inverse : this.exports.et_design_fft_forward;
        return transform(handle >>> 0);
    }

    getCapabilities() {
        const kernels = [];
        const count = this.getKernelCount();
        for (let index = 0; index < count; index++) {
            kernels.push({
                name: this.getKernelName(index),
                hash: this.getKernelParamsHash(index),
                byteCapacity: this.getKernelParamBytesCapacity(index),
                assetCapacity: this.getKernelAssetCapacity(index),
                kernelIndex: index
            });
        }
        const buildFlags = this.getBuildFlags();
        return {
            abiVersion: this.getAbiVersion(),
            buildFlags,
            simd: (buildFlags & 1) !== 0,
            kernels
        };
    }

    memoryRequired(sampleRate, maxChannels, maxFrames, telemetryRingBytes) {
        return this.exports.et_engine_memory_required(
            sampleRate,
            maxChannels,
            maxFrames,
            telemetryRingBytes
        ) >>> 0;
    }

    createEngine() {
        if (this.engine) {
            throw new DspBindingError('DSP engine already exists');
        }
        const engine = this.exports.et_engine_create() >>> 0;
        if (!engine) {
            throw new DspBindingError('DSP engine creation failed');
        }
        this.engine = engine;
        return engine;
    }

    destroyEngine() {
        if (!this.engine) return;
        const engine = this.engine;
        this.engine = 0;
        this.prepared = false;
        this._arenaViews = null;
        this._arenaRanges = [];
        this.exports.et_engine_destroy(engine);
        this._telemetryStagingPtr = 0;
        this._telemetryDroppedPtr = 0;
        this._telemetryCapacity = 0;
    }

    prepare(sampleRate, maxChannels, maxFrames, telemetryRingBytes) {
        if (!this.engine) return ET_ERR_STATE;
        this.prepared = false;
        this._arenaViews = null;
        this._arenaRanges = [];
        this._telemetryStagingPtr = 0;
        this._telemetryDroppedPtr = 0;
        this._telemetryCapacity = 0;
        this._preparing = true;
        try {
            const status = this.exports.et_engine_prepare(
                this.engine,
                sampleRate,
                maxChannels,
                maxFrames,
                telemetryRingBytes
            );
            this._refreshViews();
            if (status === ET_OK) {
                this.prepared = true;
                this._maxChannels = maxChannels;
                this._maxFrames = maxFrames;
                this._telemetryStagingPtr = this.exports.et_telemetry_staging_ptr(this.engine) >>> 0;
                this._telemetryDroppedPtr = this.exports.et_scratch_ptr(this.engine) >>> 0;
                this._telemetryCapacity = this.exports.et_telemetry_capacity(this.engine) >>> 0;
                this._assertRange(
                    this._telemetryStagingPtr,
                    this._telemetryCapacity,
                    'Telemetry staging buffer'
                );
                this._assertRange(this._telemetryDroppedPtr, 4, 'Telemetry drop counter');
                this.getArenaViews();
            }
            return status;
        } finally {
            this._preparing = false;
        }
    }

    reset() {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_engine_reset(this.engine);
    }

    setTelemetryRate(rateHz) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_engine_set_telemetry_rate(this.engine, rateHz);
    }

    createInstance(typeName) {
        if (!this.engine || !this.prepared) return 0;
        const namePtr = this._writeScratchString(typeName);
        this._preparing = true;
        let instanceId = 0;
        try {
            instanceId = this.exports.et_instance_create(this.engine, namePtr) >>> 0;
        } finally {
            // Kernel prepare may grow memory at this control-rate lifecycle boundary.
            this._refreshViews();
            this._preparing = false;
        }
        if (instanceId) this.getArenaViews();
        return instanceId;
    }

    destroyInstance(instanceId) {
        if (!this.engine || !instanceId) return;
        this.exports.et_instance_destroy(this.engine, instanceId);
    }

    resetInstance(instanceId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_reset(this.engine, instanceId);
    }

    instanceLatency(instanceId) {
        if (!this.engine) return 0;
        return this.exports.et_instance_latency(this.engine, instanceId) >>> 0;
    }

    instanceSetTap(instanceId, tapId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_set_tap(this.engine, instanceId, tapId >>> 0);
    }

    instanceSetSeed(instanceId, seedLow, seedHigh = 0) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_set_seed(
            this.engine,
            instanceId,
            seedLow >>> 0,
            seedHigh >>> 0
        );
    }

    instanceSetParams(instanceId, packed, paramsHash, offsetFrames = 0) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        const values = packed instanceof Float32Array ? packed : Float32Array.from(packed || []);
        const byteLength = values.length * Float32Array.BYTES_PER_ELEMENT;
        if (byteLength > SCRATCH_BYTES) {
            throw new DspBindingError('Packed parameters exceed the scratch-buffer capacity');
        }
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, byteLength, 'Packed parameter block');
        new Float32Array(this._memoryBuffer, ptr, values.length).set(values);
        return this.exports.et_instance_set_params(
            this.engine,
            instanceId,
            ptr,
            values.length,
            paramsHash >>> 0,
            offsetFrames >>> 0
        );
    }

    instanceRuntimeEvent(instanceId) {
        if (!this.engine || !this.prepared) return null;
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, 12, 'Runtime event state');
        if (this.exports.et_instance_runtime_event(
            this.engine,
            instanceId,
            ptr
        ) !== ET_OK) {
            return null;
        }
        return {
            generation: this.dataView.getUint32(ptr, true),
            latched: this.dataView.getUint32(ptr + 4, true) !== 0,
            cause: this.dataView.getUint32(ptr + 8, true)
        };
    }

    instanceSetParamBytes(instanceId, packed, paramsHash, offsetFrames = 0) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        const values = toUint8View(packed, 'Structured parameter block');
        if (values.byteLength > SCRATCH_BYTES) {
            throw new DspBindingError('Structured parameters exceed the scratch-buffer capacity');
        }
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, values.byteLength, 'Structured parameter block');
        new Uint8Array(this._memoryBuffer, ptr, values.byteLength).set(values);
        return this.exports.et_instance_set_param_bytes(
            this.engine,
            instanceId,
            ptr,
            values.byteLength,
            paramsHash >>> 0,
            offsetFrames >>> 0
        );
    }

    instanceAssetBegin(instanceId, slot, {
        channels,
        frames,
        topology,
        headBlock,
        rateDivider,
        pathCount = 0,
        inputCount = 0,
        processingChannels = 1,
        byteSize,
        footprintBytes = byteSize
    }) {
        if (!this.engine || !this.prepared) return 0;
        this._preparing = true;
        try {
            const ptr = this.exports.et_instance_asset_begin(
                this.engine,
                instanceId,
                slot >>> 0,
                channels >>> 0,
                frames >>> 0,
                topology >>> 0,
                headBlock >>> 0,
                rateDivider >>> 0,
                pathCount >>> 0,
                inputCount >>> 0,
                processingChannels >>> 0,
                footprintBytes >>> 0,
                byteSize >>> 0
            ) >>> 0;
            this._refreshViews();
            if (ptr) this._assertRange(ptr, byteSize, 'Asset staging buffer');
            return ptr;
        } finally {
            this._preparing = false;
        }
    }

    instanceAssetCommit(instanceId, slot, byteSize, formatTag) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        return this.exports.et_instance_asset_commit(
            this.engine,
            instanceId,
            slot >>> 0,
            byteSize >>> 0,
            formatTag >>> 0
        );
    }

    instanceAssetAbort(instanceId, slot) {
        if (!this.engine || !this.prepared) return;
        this.exports.et_instance_asset_abort(this.engine, instanceId, slot >>> 0);
    }

    instanceAssetState(instanceId, slot) {
        if (!this.engine || !this.prepared) return 0;
        return this.exports.et_instance_asset_state(this.engine, instanceId, slot >>> 0) >>> 0;
    }

    instanceSetAsset(instanceId, slot, payload, beginInfo, formatTag = 1) {
        const bytes = toUint8View(payload, 'Asset payload');
        if (bytes.byteLength < 32) {
            throw new DspBindingError('Asset payload is smaller than its header');
        }
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const resolvedInfo = {
            ...beginInfo,
            channels: beginInfo?.channels ?? header.getUint32(4, true),
            frames: beginInfo?.frames ?? header.getUint32(8, true),
            topology: beginInfo?.topology ?? header.getUint32(16, true)
        };
        const ptr = this.instanceAssetBegin(instanceId, slot, {
            ...resolvedInfo,
            byteSize: bytes.byteLength
        });
        if (!ptr) return ET_ERR_STATE;
        this.u8.set(bytes, ptr);
        return this.instanceAssetCommit(instanceId, slot, bytes.byteLength, formatTag);
    }

    instanceProcess(instanceId, audioPtr, channelCount, frameCount, timeSeconds) {
        if (!this.engine) return ET_ERR_STATE;
        this._refreshViews();
        return this.exports.et_instance_process(
            this.engine,
            instanceId,
            audioPtr,
            channelCount,
            frameCount,
            timeSeconds
        );
    }

    arenaCombinedPtr() {
        if (!this.engine) return 0;
        return this.exports.et_arena_combined_ptr(this.engine) >>> 0;
    }

    arenaBusPtr(bus) {
        if (!this.engine) return 0;
        return this.exports.et_arena_bus_ptr(this.engine, bus) >>> 0;
    }

    arenaScratchPtr(which) {
        if (!this.engine) return 0;
        return this.exports.et_arena_scratch_ptr(this.engine, which) >>> 0;
    }

    scratchPtr() {
        if (!this.engine) return 0;
        return this.exports.et_scratch_ptr(this.engine) >>> 0;
    }

    _arenaView(ptr, floatLength, label) {
        this._assertRange(ptr, floatLength * Float32Array.BYTES_PER_ELEMENT, label);
        const view = new Float32Array(this._memoryBuffer, ptr, floatLength);
        this._arenaRanges.push({
            start: ptr,
            end: ptr + view.byteLength
        });
        return view;
    }

    getArenaViews() {
        if (!this.engine || !this.prepared) {
            throw new DspBindingError('DSP engine must be prepared before adopting arena views');
        }
        this._refreshViews();
        if (this._arenaViews?.buffer === this._memoryBuffer) return this._arenaViews;

        const floatLength = this._maxChannels * this._maxFrames;
        this._arenaRanges = [];
        const combinedPtr = this.arenaCombinedPtr();
        const combined = this._arenaView(combinedPtr, floatLength, 'Combined arena');
        const buses = new Map([[0, combined]]);
        const busOffsets = new Map([[0, combinedPtr]]);
        for (let bus = 1; bus <= 4; bus++) {
            const ptr = this.arenaBusPtr(bus);
            buses.set(bus, this._arenaView(ptr, floatLength, `Bus ${bus} arena`));
            busOffsets.set(bus, ptr);
        }

        const scratchNames = ['allChannels', 'mixing', 'stereo', 'mono'];
        const scratchLengths = [
            floatLength,
            floatLength,
            (this._maxChannels < 2 ? this._maxChannels : 2) * this._maxFrames,
            this._maxFrames
        ];
        const scratch = {};
        const scratchOffsets = {};
        for (let which = 0; which < scratchNames.length; which++) {
            const name = scratchNames[which];
            const ptr = this.arenaScratchPtr(which);
            scratch[name] = this._arenaView(ptr, scratchLengths[which], `${name} scratch arena`);
            scratchOffsets[name] = ptr;
        }

        this._arenaViews = {
            buffer: this._memoryBuffer,
            combined,
            buses,
            scratch,
            offsets: {
                combined: combinedPtr,
                buses: busOffsets,
                scratch: scratchOffsets
            }
        };
        return this._arenaViews;
    }

    pointerForArenaView(view) {
        if (!ArrayBuffer.isView(view) || view.buffer !== this._memoryBuffer) return null;
        const start = view.byteOffset;
        const end = start + view.byteLength;
        for (const range of this._arenaRanges) {
            if (start >= range.start && end <= range.end) return start;
        }
        return null;
    }

    telemetryRead(target) {
        if (!this.engine || !this.prepared) return 0;
        const targetView = toUint8View(target, 'Telemetry packet');
        const maxBytes = targetView.byteLength < this._telemetryCapacity
            ? targetView.byteLength
            : this._telemetryCapacity;
        if (maxBytes === 0) return 0;

        this._refreshViews();
        this.dataView.setUint32(this._telemetryDroppedPtr, 0, true);
        const bytes = this.exports.et_telemetry_read(
            this.engine,
            this._telemetryStagingPtr,
            maxBytes,
            this._telemetryDroppedPtr
        );
        this._refreshViews();
        if (!Number.isInteger(bytes) || bytes < 0 || bytes > maxBytes) {
            throw new DspBindingError('Telemetry reader returned an invalid byte count');
        }
        this.lastTelemetryDroppedFrames = this.dataView.getUint32(this._telemetryDroppedPtr, true);
        if (bytes > 0) {
            targetView.set(this.u8.subarray(this._telemetryStagingPtr, this._telemetryStagingPtr + bytes), 0);
        }
        return bytes;
    }

    pipelineConfigure(descriptor) {
        if (!this.engine) return ET_ERR_STATE;
        const bytes = toUint8View(descriptor, 'Pipeline descriptor');
        if (bytes.byteLength > SCRATCH_BYTES) {
            throw new DspBindingError('Pipeline descriptor exceeds the scratch-buffer capacity');
        }
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, bytes.byteLength, 'Pipeline descriptor');
        this.u8.set(bytes, ptr);
        this._preparing = true;
        let status = ET_ERR_STATE;
        try {
            status = this.exports.et_pipeline_configure(this.engine, ptr, bytes.byteLength);
        } finally {
            this._refreshViews();
            this._preparing = false;
        }
        this.getArenaViews();
        return status;
    }

    pipelineLatency() {
        if (!this.engine) return 0;
        return this.exports.et_pipeline_latency(this.engine) >>> 0;
    }

    pipelineProcess(channelCount, frameCount, timeSeconds, masterBypass = false) {
        if (!this.engine) return ET_ERR_STATE;
        this._refreshViews();
        return this.exports.et_pipeline_process(
            this.engine,
            channelCount,
            frameCount,
            timeSeconds,
            masterBypass ? 1 : 0
        );
    }

    graphCapabilities() {
        if (typeof this.exports.et_graph_capabilities !== 'function') return 0;
        return this.exports.et_graph_capabilities() >>> 0;
    }

    get graphSupported() {
        return Boolean(
            (this.graphCapabilities() & 1) !== 0 &&
            typeof this.exports.et_graph_configure === 'function' &&
            typeof this.exports.et_graph_latency === 'function' &&
            typeof this.exports.et_graph_process === 'function' &&
            typeof this.exports.et_graph_snapshot_size === 'function' &&
            typeof this.exports.et_graph_snapshot_copy === 'function' &&
            typeof this.exports.et_graph_read_diagnostic === 'function' &&
            typeof this.exports.et_graph_set_instance_params === 'function' &&
            typeof this.exports.et_graph_reset === 'function'
        );
    }

    graphConfigure(descriptor) {
        if (!this.engine || !this.prepared || !this.graphSupported) return ET_ERR_STATE;
        const bytes = toUint8View(descriptor, 'Graph descriptor');
        if (bytes.byteLength === 0) return ET_ERR_STATE;
        this._preparing = true;
        let ptr = 0;
        try {
            ptr = this.exports.malloc(bytes.byteLength) >>> 0;
            this._refreshViews();
            if (!ptr) return ET_ERR_STATE;
            this._assertRange(ptr, bytes.byteLength, 'Graph descriptor');
            this.u8.set(bytes, ptr);
            return this.exports.et_graph_configure(this.engine, ptr, bytes.byteLength);
        } finally {
            if (ptr) this.exports.free(ptr);
            this._refreshViews();
            this._preparing = false;
            if (this.engine && this.prepared) this.getArenaViews();
        }
    }

    graphLatency() {
        if (!this.engine || !this.graphSupported) return 0;
        return this.exports.et_graph_latency(this.engine) >>> 0;
    }

    graphProcess(channelCount, frameCount, timeSeconds) {
        if (!this.engine || !this.graphSupported) return ET_ERR_STATE;
        this._refreshViews();
        return this.exports.et_graph_process(
            this.engine,
            channelCount >>> 0,
            frameCount >>> 0,
            timeSeconds
        );
    }

    graphSetInstanceParams(instanceId, packed, paramsHash, changedIndex) {
        if (!this.engine || !this.graphSupported) return ET_ERR_STATE;
        const values = packed instanceof Float32Array ? packed : Float32Array.from(packed || []);
        const byteLength = values.length * Float32Array.BYTES_PER_ELEMENT;
        if (byteLength > SCRATCH_BYTES) {
            throw new DspBindingError('Packed Graph parameters exceed the scratch-buffer capacity');
        }
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, byteLength, 'Packed Graph parameter block');
        new Float32Array(this._memoryBuffer, ptr, values.length).set(values);
        return this.exports.et_graph_set_instance_params(
            this.engine,
            instanceId,
            ptr,
            values.length,
            paramsHash >>> 0,
            changedIndex >>> 0
        );
    }

    graphReset() {
        if (!this.engine || !this.graphSupported) return ET_ERR_STATE;
        return this.exports.et_graph_reset(this.engine);
    }

    graphSnapshot() {
        if (!this.engine || !this.graphSupported) return null;
        const byteLength = this.exports.et_graph_snapshot_size(this.engine) >>> 0;
        if (byteLength === 0) return new Uint8Array();
        let ptr = 0;
        this._preparing = true;
        try {
            ptr = this.exports.malloc(byteLength) >>> 0;
            this._refreshViews();
            if (!ptr) throw new DspBindingError('Unable to allocate the Graph snapshot buffer');
            this._assertRange(ptr, byteLength, 'Graph snapshot');
            const status = this.exports.et_graph_snapshot_copy(
                this.engine,
                ptr,
                byteLength
            );
            if (status !== ET_OK) {
                throw new DspBindingError('DSP Graph snapshot could not be read');
            }
            return new Uint8Array(this.u8.slice(ptr, ptr + byteLength));
        } finally {
            if (ptr) this.exports.free(ptr);
            this._refreshViews();
            this._preparing = false;
            if (this.engine && this.prepared) this.getArenaViews();
        }
    }

    graphDiagnostic() {
        if (!this.engine || !this.graphSupported) return null;
        const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
        this._refreshViews();
        this._assertRange(ptr, 24, 'Graph diagnostic');
        if (this.exports.et_graph_read_diagnostic(this.engine, ptr) !== ET_OK) return null;
        return {
            status: this.dataView.getInt32(ptr, true),
            kind: this.dataView.getUint32(ptr + 4, true),
            index: this.dataView.getUint32(ptr + 8, true),
            path: this.dataView.getUint32(ptr + 12, true),
            required: this.dataView.getUint32(ptr + 16, true),
            capacity: this.dataView.getUint32(ptr + 20, true)
        };
    }

    markFailed() {
        this.failed = true;
    }

    get live() {
        return Boolean(this.engine && this.prepared && !this.failed && !this.memoryGrowthViolation);
    }

    close() {
        this.destroyEngine();
    }
}

async function instantiateDspBinding(moduleOrBytes, {
    webAssembly = globalThis.WebAssembly,
    imports = null,
    debug = false,
    debugWrite = defaultDebugWrite,
    warning = defaultWarning,
    onUnexpectedMemoryGrowth = null
} = {}) {
    if (!webAssembly || typeof webAssembly.instantiate !== 'function') {
        throw new DspBindingError('WebAssembly.instantiate is unavailable');
    }

    let memory = null;
    let binding = null;
    let pendingGrowthNotification = false;
    const baseImports = createDspImports({
        getMemory: () => memory,
        debug,
        debugWrite,
        onMemoryGrowth: () => {
            if (binding) {
                binding.handleMemoryGrowthNotification();
            } else {
                pendingGrowthNotification = true;
            }
        }
    });
    const result = await webAssembly.instantiate(moduleOrBytes, mergeImports(baseImports, imports));
    const instance = result?.instance || result;
    memory = instance?.exports?.memory || null;
    binding = new DspEngineBinding(instance, { warning, onUnexpectedMemoryGrowth });
    if (pendingGrowthNotification) {
        binding.handleMemoryGrowthNotification();
    }
    return binding;
}
// __ETDSP_BINDING_INJECT_END__

const JS_FALLBACK_SAMPLE_CHANNEL_BUDGET = 96000;

const JS_FALLBACK_LATENCY_RESOLVERS = new Map([
    ['FrequencyShifterPlugin', sampleRate => {
        const hilbertStride = sampleRate <= 48000 ? 1 : (sampleRate <= 96000 ? 2 : 4);
        return 114 * hilbertStride;
    }]
]);

function resolveJsFallbackLatency(pluginType, sampleRate) {
    if (typeof pluginType !== 'string' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        return 0;
    }
    const resolver = JS_FALLBACK_LATENCY_RESOLVERS.get(pluginType);
    return resolver ? resolver(sampleRate) >>> 0 : 0;
}

function requiresWasmExecution(plugin) {
    return plugin?.executionCapabilities?.requiresWasm === true;
}

function jsFallbackCapacityLimit(plugin) {
    const capacity = plugin?.executionCapabilities?.jsFallbackCapacity;
    if (!capacity || typeof capacity !== 'object' ||
        !Number.isFinite(capacity.maxJsFallbackSampleChannels) ||
        capacity.maxJsFallbackSampleChannels <= 0) return null;
    return capacity.maxJsFallbackSampleChannels;
}

function jsFallbackSampleChannelCost(plugin, sampleRate, outputChannelCount) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
    const selection = workletChannelSelection(plugin.channel, outputChannelCount);
    const actualProcessingChannelCount = selection?.availableChannels === selection.requiredChannels
        ? selection.requiredChannels
        : 0;
    return sampleRate * actualProcessingChannelCount;
}

function workletChannelSelection(channel, outputChannelCount) {
    let mode;
    let firstChannel;
    let requiredChannels;
    switch (channel) {
        case 'A':
            mode = 'all';
            firstChannel = 0;
            requiredChannels = outputChannelCount;
            break;
        case 'L':
            mode = 'single';
            firstChannel = 0;
            requiredChannels = 1;
            break;
        case 'R':
            mode = 'single';
            firstChannel = 1;
            requiredChannels = 1;
            break;
        case null:
        case undefined:
            mode = outputChannelCount === 1 ? 'mono' : 'stereo-pair';
            firstChannel = 0;
            requiredChannels = outputChannelCount === 1 ? 1 : 2;
            break;
        case '34':
            mode = 'stereo-pair';
            firstChannel = 2;
            requiredChannels = 2;
            break;
        case '56':
            mode = 'stereo-pair';
            firstChannel = 4;
            requiredChannels = 2;
            break;
        case '78':
            mode = 'stereo-pair';
            firstChannel = 6;
            requiredChannels = 2;
            break;
        case '910':
        case '1112':
        case '1314':
        case '1516':
            mode = 'stereo-pair';
            firstChannel = Number(channel.slice(0, channel.length / 2)) - 1;
            requiredChannels = 2;
            break;
        default: {
            const parsedChannel = parseInt(channel, 10);
            if (isNaN(parsedChannel) || parsedChannel <= 0) return null;
            mode = 'single';
            firstChannel = parsedChannel - 1;
            requiredChannels = 1;
            break;
        }
    }
    const remainingChannels = outputChannelCount - firstChannel;
    const availableChannels = remainingChannels <= 0
        ? 0
        : (remainingChannels < requiredChannels ? remainingChannels : requiredChannels);
    return { mode, firstChannel, requiredChannels, availableChannels };
}

function workletRoutingSelection(channel, outputChannelCount, executionBypassed = false) {
    const selection = workletChannelSelection(channel, outputChannelCount);
    if (!selection) return null;
    if (selection.availableChannels === selection.requiredChannels) return selection;
    if (executionBypassed && selection.availableChannels === 1) {
        return {
            mode: 'single',
            firstChannel: selection.firstChannel,
            requiredChannels: 1,
            availableChannels: 1
        };
    }
    return null;
}

function pluginExecutionUnsupportedReason(plugin, sampleRate, outputChannelCount) {
    const capabilities = plugin?.executionCapabilities;
    if (!capabilities || typeof capabilities !== 'object') return null;
    if (Array.isArray(capabilities.supportedSampleRates) &&
        !capabilities.supportedSampleRates.includes(sampleRate)) {
        return 'unsupportedSampleRate';
    }
    if (Array.isArray(capabilities.supportedChannelModes)) {
        const selection = workletChannelSelection(plugin.channel, outputChannelCount);
        if (!selection ||
            !capabilities.supportedChannelModes.includes(selection.mode) ||
            selection.availableChannels !== selection.requiredChannels) {
            return 'unsupportedChannelMode';
        }
    }
    return null;
}
const FIR_CONVOLVER_PLUGIN_TYPES = new Set([
    'FIRCrossoverPlugin',
    'FiveBandFIRPEQPlugin',
    'GroupDelayEqPlugin',
    'GroupDelayPEQPlugin',
    'CrosstalkCancellationPlugin',
    'RoomEqPlugin'
]);
const ET_DSP_MAX_CHANNELS = 16;
const ET_DSP_MAX_FRAMES = 128;
const ET_DSP_ERR_ARGS = -1;
const ET_DSP_TELEMETRY_BYTES = 256 * 1024;
// Keep half of the 256 MiB module ceiling available for arenas, other kernels, and replacement probes.
const ET_DSP_ASSET_AGGREGATE_BUDGET_BYTES = 128 * 1024 * 1024;
const ET_DSP_FIR_REPLACEMENT_DRY_MODE = -1;
const ET_DSP_FIR_REPLACEMENT_DRY_READY = 1 << 16;
const ET_DSP_PACKET_POOL_SIZE = 3;
const ET_DSP_PIPELINE_FALLBACK = 0;
const ET_DSP_PIPELINE_PROCESSED = 1;
const ET_DSP_PIPELINE_ARENA_INVALID = -1;
const ET_DSP_PIPELINE_VERSION = 1;
const ET_DSP_PIPELINE_HEADER_BYTES = 8;
const ET_DSP_PIPELINE_NODE_BYTES = 12;
const ET_DSP_PIPELINE_MAX_NODES = 128;
const AUDIO_PROCESSING_OVERLOAD_HEARTBEAT_SECONDS = 1;
// Render headroom, in milliseconds, that the output buffer absorbs before a
// late quantum turns into an audible dropout. The deadline credit tracks that
// headroom, so a single quantum is never judged on its own: the wall clock here
// is coarse -- AudioWorkletGlobalScope does not expose performance, so
// audioProcessingClockNow() falls back to Date.now() with 1 ms granularity,
// the same order as one quantum budget (0.67 ms at 192 kHz, 1.33 ms at 96 kHz)
// -- and only accumulating the surplus/deficit averages that rounding out.
// The main thread reports the real figure from AudioContext.baseLatency; this
// is the fallback for when it is unavailable.
const AUDIO_PROCESSING_OVERLOAD_DEFAULT_HEADROOM_MS = 10;
// Below ~8 ms the 1 ms clock granularity starts to dominate the credit, and
// above ~20 ms the warning would trail the dropout it is meant to announce.
const AUDIO_PROCESSING_OVERLOAD_MIN_HEADROOM_MS = 8;
const AUDIO_PROCESSING_OVERLOAD_MAX_HEADROOM_MS = 20;
// WebAssembly has no FTZ/DAZ control register. This inaudible Nyquist component keeps floating
// point DSP state far above the subnormal range without biasing DC or the power-policy threshold.
const ET_DENORMAL_NOISE_AMPLITUDE = 1e-19;
const ET_DENORMAL_NOISE_POWER = ET_DENORMAL_NOISE_AMPLITUDE * ET_DENORMAL_NOISE_AMPLITUDE;
const ET_DENORMAL_NOISE_OUTPUT_LIMIT = 10 ** (-288 / 20);

class WorkletSampleDelayLine {
    constructor(channelCount, maximumDelaySamples) {
        this.channelCount = channelCount;
        this.length = maximumDelaySamples + 1;
        this.samples = new Float32Array(channelCount * this.length);
        this.writeIndices = new Uint32Array(channelCount);
    }

    reset() {
        this.samples.fill(0);
        this.writeIndices.fill(0);
    }

    processChannel(audio, offset, frameCount, channel, delaySamples) {
        if (delaySamples === 0 || channel >= this.channelCount) return;
        const length = this.length;
        const channelOffset = channel * length;
        let writeIndex = this.writeIndices[channel];
        for (let frame = 0; frame < frameCount; frame++) {
            this.samples[channelOffset + writeIndex] = audio[offset + frame];
            let readIndex = writeIndex - delaySamples;
            if (readIndex < 0) readIndex += length;
            audio[offset + frame] = this.samples[channelOffset + readIndex];
            writeIndex++;
            if (writeIndex === length) writeIndex = 0;
        }
        this.writeIndices[channel] = writeIndex;
    }
}

function encodeWorkletDspChannelSpec(channel, outputChannelCount = 2) {
    if (channel === null || channel === undefined) return outputChannelCount === 1 ? 0 : -1;
    if (channel === 'A') return -2;
    if (channel === 'L') return 0;
    if (channel === 'R') return 1;
    if (channel === '34') return 17;
    if (channel === '56') return 18;
    if (channel === '78') return 19;
    if (channel === '910') return 20;
    if (channel === '1112') return 21;
    if (channel === '1314') return 22;
    if (channel === '1516') return 23;
    if (typeof channel === 'string' && /^([1-9]|1[0-6])$/.test(channel)) return Number(channel) - 1;
    throw new TypeError(`Unsupported DSP pipeline channel: ${String(channel)}`);
}

function encodeWorkletDspPipeline(nodes, outputChannelCount = 2) {
    if (nodes.length > ET_DSP_PIPELINE_MAX_NODES) {
        throw new RangeError(`DSP pipeline exceeds ${ET_DSP_PIPELINE_MAX_NODES} nodes`);
    }
    const bytes = new Uint8Array(
        ET_DSP_PIPELINE_HEADER_BYTES + nodes.length * ET_DSP_PIPELINE_NODE_BYTES
    );
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ET_DSP_PIPELINE_VERSION, true);
    view.setUint32(4, nodes.length, true);
    const seenInstances = new Set();
    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (!Number.isInteger(node.instanceId) || node.instanceId <= 0 || node.instanceId > 0xffffffff ||
            seenInstances.has(node.instanceId)) {
            throw new TypeError(`Invalid DSP pipeline instance at node ${index}`);
        }
        if (!Number.isInteger(node.inputBus) || node.inputBus < 0 || node.inputBus > 4 ||
            !Number.isInteger(node.outputBus) || node.outputBus < 0 || node.outputBus > 4) {
            throw new TypeError(`Invalid DSP pipeline bus at node ${index}`);
        }
        seenInstances.add(node.instanceId);
        const offset = ET_DSP_PIPELINE_HEADER_BYTES + index * ET_DSP_PIPELINE_NODE_BYTES;
        view.setUint32(offset, node.instanceId, true);
        view.setUint8(offset + 4, 1);
        view.setUint8(offset + 5, node.inputBus);
        view.setUint8(offset + 6, node.outputBus);
        view.setInt8(offset + 7, encodeWorkletDspChannelSpec(node.channel, outputChannelCount));
        view.setUint8(offset + 8, 1);
    }
    return bytes;
}

class PluginProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.plugins = [];
        this.FADE_DURATION = 0.010; // 10ms fade for smoother transitions (Not used in process, but kept for context)
        this.currentFrame = 0;
        this.pluginProcessors = new Map();
        this.pluginContexts = new Map();
        this.processorRegistrationErrors = new Set();
        this.reportedMissingProcessors = new Set();
        this.reportedInvalidChannels = new Set();
        this.masterBypass = false;
        this.processingOverloadMonitoringEnabled = false;
        this.processingOverloadMonitoringStartFrame = Number.POSITIVE_INFINITY;
        this.processingOverloadHeadroomMs = AUDIO_PROCESSING_OVERLOAD_DEFAULT_HEADROOM_MS;
        this.processingOverloadCreditMs = AUDIO_PROCESSING_OVERLOAD_DEFAULT_HEADROOM_MS;
        this.processingOverloadActive = false;
        this.processingOverloadLastReportFrame = Number.NEGATIVE_INFINITY;
        this.pipelineCpuFrames = 0;
        this.pipelineCpuElapsedMs = 0;

        // WebAssembly DSP state. The legacy processor registry remains authoritative
        // until a parity-gated type has a live instance with current packed params.
        this.dspBinding = null;
        this.dspLive = false;
        this.dspSimd = false;
        this.dspEnabledTypes = new Set();
        this.wasmKernels = new Map();
        this.wasmInstances = new Map();
        this.dspInstanceEpoch = 0;
        this.dspAssetCache = new Map();
        this.dspAssetStates = new Map();
        this.dspAssetStateRevisions = new Map();
        this.dspAssetStateReplayEpochs = new Map();
        this.dspDeferredAssetStages = new Map();
        this.dspRuntimeFailures = new Map();
        this.dspFailedTypes = new Set();
        this.dspReportedFailures = new Set();
        this.dspPacketPool = [];
        this.dspTelemetryRateHz = null;
        this.dspSampleRate = globalThis.sampleRate;
        this.dspPendingInstanceDestroy = [];
        this.dspEngineNeedsCleanup = false;
        this.dspHybridInputBackup = new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES);
        this.dspInitGeneration = 0;
        this.dspPipelineReady = false;
        this.dspPipelinePluginCount = 0;
        this.dspPipelineLatencySamples = 0;
        this.dspPipelineLatencyCompensated = false;
        this.dspLatencyPlan = null;
        this.executionLatencySnapshot = new Map();
        this.jsFallbackAdmissions = new Map();
        this.jsFallbackSampleChannelCosts = new Map();
        this.jsFallbackSampleChannelBudget = JS_FALLBACK_SAMPLE_CHANNEL_BUDGET;
        this.jsFallbackRequiredSampleChannels = 0;
        this.jsFallbackAdmittedSampleChannels = 0;
        this.jsFallbackCapacityExceeded = false;
        this.jsFallbackIntrinsicCapacityExceeded = false;
        this.outputDelaySamples = 0;
        this.outputDelayLine = null;
        this.dspExecutionGeneration = 0;
        this.dspExecutionStates = new Map();
        this.dspExecutionRuntimeFallbacks = new Set();
        this.dspEnableTypesReceived = false;
        this.dspExecutionInitializing = false;

        // Audio configuration
        this.outputChannelCount = options?.processorOptions?.initialOutputChannelCount ?? 2;
        this.lowLatencyMode = options?.processorOptions?.lowLatencyMode ?? false;

        // Message control
        this.lastMessageTime = 0;
        this.messageQueue = new Map();
        this.spectrumTapRoute = new Set();
        this.spectrumTaps = new Set();
        this.spectrumTapState = new Map();
        this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16; // ms

        // Buffer management - blockSize will be updated in process
        this.blockSize = 128; // Default/initial block size
        this.combinedBuffer = null;
        // this.lastChannelCount = 0; // Not used in the provided process function

        // Bus management
        this.busBuffers = new Map(); // Map to store buffers for each bus
        this.usedBuses = new Set();
        this.MAX_BUSES = 4; // Maximum number of buses (Informational, not directly used in process optimization)

        // Buffer Pool for performance optimization
        this.bufferPool = this.createLegacyBufferPool();

        // Offline processing flag (Not used in process, but kept for context)
        // this.isOfflineProcessing = false;

        // Audio level monitoring for sleep mode
        this.audioLevelMonitoring = {
            lastInputActiveTime: 0,     // Last time input signal was detected
            lastOutputActiveTime: 0,    // Last time output signal was detected
            lastUserActivityTime: 0,    // Will be updated from main thread
            isSleepMode: false,
            SILENCE_THRESHOLD: -84,     // -84dB threshold for silence
            SILENCE_DURATION: 60,       // 60 seconds of silence before sleep
            // Cache the threshold in amplitude form
            _silenceThresholdAmplitude: Math.pow(10, -84 / 20)
        };

        // Explicit Web/PWA power protocol. It is disabled by default so the
        // Electron and rollout-off paths retain the legacy Sleep Mode above.
        // Detector arrays are allocated once; process() never grows them.
        const detectorChannelCapacity = ET_DSP_MAX_CHANNELS;
        this.powerPolicy = {
            enabled: false,
            state: 'active',
            processingDirective: 'full-process',
            workletGraphGeneration: 0,
            topologyRevision: 0,
            commandId: null,
            skipEpoch: null,
            hostResumeTerminal: null,
            arm: {
                state: 'disarmed',
                commandId: null,
                skipEpoch: null,
                armAfterRenderSequence: null
            },
            armStartFrame: null,
            lastPowerCommandId: -1,
            lastAcceptedSkipEpoch: -1,
            lastConsumedSkipEpoch: -1,
            inputSilentFrames: 0,
            outputSilentFrames: 0,
            silentSinceFrame: null,
            silenceFramesRequired: Math.round(globalThis.sampleRate * 60),
            silenceThresholdPower: Math.pow(10, -80 / 10),
            wakeFloorPower: Math.pow(10, -80 / 10),
            wakeOnAnyInput: false,
            exitThresholdPower: Math.pow(10, -74 / 10),
            ewmaAlpha: 1 - Math.exp(-128 / (globalThis.sampleRate * 2)),
            inputPowerEwma: 0,
            outputPowerEwma: 0,
            inputDcX: new Float64Array(detectorChannelCapacity),
            inputDcY: new Float64Array(detectorChannelCapacity),
            outputDcX: new Float64Array(detectorChannelCapacity),
            outputDcY: new Float64Array(detectorChannelCapacity),
            inputDetectorResult: new Float64Array(3),
            outputDetectorResult: new Float64Array(3),
            dcBlockerR: Math.exp(-2 * Math.PI * 5 / globalThis.sampleRate),
            monitoringFastWakeEligible: false,
            monitoringStaticCoverageValid: false,
            monitoringFastWakeBlockerReason: 'temporal-preparation-not-worklet-local',
            monitoringPreparationRequired: false,
            monitoringPreparationPending: false,
            temporalSkipEligible: false,
            temporalCapabilities: [],
            enabledPluginCount: 0,
            uiTelemetryEnabled: true,
            pendingObservationRequestId: null,
            pendingFirstRenderCommandId: null,
            renderSequence: 0,
            lastReportedInputActive: null,
            lastReportedOutputActive: null,
            lastHeartbeatFrame: 0,
            skippedFrameCount: 0,
            skippedFrameRemainder: 0,
            skipSampleRate: globalThis.sampleRate,
            pendingConfigWake: false,
            pendingPowerEventReason: null,
            emptyInputActive: false,
            activeFullProcessSettled: false,
            counters: {
                renderQuanta: 0,
                detectorQuanta: 0,
                fullProcessQuanta: 0,
                fullJsProcessQuanta: 0,
                fullWasmProcessQuanta: 0,
                monitoringQuanta: 0,
                bypassQuanta: 0,
                zeroOutputQuanta: 0,
                telemetryReads: 0,
                telemetryPosts: 0,
                monitoringRuntimeFailures: 0
            }
        };

        // Message handler
        this.port.onmessage = (event) => {
            const data = event.data;
            switch(data.type) {
                case 'setSpectrumTapRoute': {
                    const wasEmpty = this.spectrumTapRoute.size === 0;
                    if (data.enabled) this.spectrumTapRoute.add(data.pluginId);
                    else this.spectrumTapRoute.delete(data.pluginId);
                    // Visibility changes must never rebuild latency compensation.
                    if ((this.spectrumTapRoute.size === 0) !== wasEmpty) this.refreshDspPipeline();
                    break;
                }
                case 'setSpectrumTap':
                    if (data.enabled) {
                        this.spectrumTaps.add(data.pluginId);
                        const mode = data.mode === 'compare' ? 'compare' : 'after';
                        const state = this.spectrumTapState.get(data.pluginId);
                        if (!state || state.mode !== mode) {
                            this.spectrumTapState.set(data.pluginId, {
                                mode,
                                inputBuffer: mode === 'compare' ? new Float32Array(4096) : null,
                                outputBuffer: new Float32Array(4096),
                                position: 0
                            });
                        }
                    } else {
                        this.spectrumTaps.delete(data.pluginId);
                        this.spectrumTapState.delete(data.pluginId);
                    }
                    break;
                case 'updatePlugin':
                    this._invalidatePowerSkipForMutation();
                    this.updatePlugin(data.plugin);
                    break;
                case 'updatePlugins':
                    this._invalidatePowerSkipForMutation();
                    // this.isOfflineProcessing = data.isOfflineProcessing ?? false; // Store if needed elsewhere
                    this.masterBypass = data.masterBypass ?? false;
                    this.updatePlugins(data.plugins);
                    if (this.masterBypass) this.clearAudioProcessingOverload();
                    break;
                case 'setAudioProcessingOverloadMonitoring':
                    this.setAudioProcessingOverloadMonitoring(
                        data.enabled === true,
                        data.delaySeconds,
                        data.headroomMs
                    );
                    break;
                case 'updateAudioConfig':
                    this._invalidatePowerSkipForMutation();
                    let dspConfigurationChanged = false;
                    if (data.outputChannels !== undefined) {
                        if (data.outputChannels !== this.outputChannelCount) {
                            this.outputChannelCount = data.outputChannels;
                            // Invalidate combined buffer if channel count changes drastically
                            this.combinedBuffer = null;
                            dspConfigurationChanged = true;
                            console.log(`Audio config updated: output channels = ${this.outputChannelCount}`);
                        }
                    }
                    if (data.lowLatencyMode !== undefined) {
                        this.lowLatencyMode = data.lowLatencyMode;
                        this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16;
                    }
                    if (typeof data.sampleRate === 'number' && data.sampleRate > 0) {
                        if (data.sampleRate !== this.dspSampleRate) {
                            this.dspSampleRate = data.sampleRate;
                            dspConfigurationChanged = true;
                        }
                    }
                    if (dspConfigurationChanged) {
                        ++this.dspExecutionGeneration;
                        this.refreshDspPipeline();
                        this.publishWasmOnlyExecutionStates(true);
                    }
                    break;
                case 'dspModule':
                    this._invalidatePowerSkipForMutation();
                    this.initializeDsp(data);
                    break;
                case 'dspEnableTypes':
                    this._invalidatePowerSkipForMutation();
                    this.dspEnableTypesReceived = true;
                    this.dspEnabledTypes = new Set(
                        (Array.isArray(data.types) ? data.types : [])
                            .filter(type => !this.dspFailedTypes.has(type))
                    );
                    this.reconcileDspInstances();
                    this.refreshDspPipeline();
                    this.publishWasmOnlyExecutionStates();
                    break;
                case 'dspSetTelemetryRate':
                    if (typeof data.hz === 'number') {
                        this.dspTelemetryRateHz = data.hz;
                    }
                    if (this.dspLive && this.dspTelemetryRateHz !== null) {
                        const status = this.dspBinding.setTelemetryRate(this.dspTelemetryRateHz);
                        if (status !== 0) this.reportDspFailure('telemetry-rate', `status ${status}`);
                    }
                    break;
                case 'setPluginAsset':
                    this._invalidatePowerSkipForMutation();
                    this.setPluginAsset(data);
                    break;
                case 'clearPluginAsset':
                    this._invalidatePowerSkipForMutation();
                    this.clearPluginAsset(data);
                    break;
                case 'dspTelemetryReturn':
                    if (data.packet instanceof ArrayBuffer && this.dspPacketPool.length < ET_DSP_PACKET_POOL_SIZE) {
                        this.dspPacketPool.push(new Uint8Array(data.packet));
                    }
                    break;
                case 'dspCleanupFailed':
                    this.cleanupDspFailures();
                    break;
                case 'requestDspLatency':
                    this.port.postMessage({
                        type: 'dspLatencyResponse',
                        requestId: data.requestId,
                        samples: this.dspPipelineLatencySamples,
                        compensated: this.dspPipelineLatencyCompensated
                    });
                    break;
                case 'setOutputDelay':
                    this.setOutputDelay(data.samples);
                    this.port.postMessage({
                        type: 'outputDelaySet',
                        requestId: data.requestId,
                        samples: this.outputDelaySamples
                    });
                    break;
                case 'requestJsFallbackBudgetState':
                    this.publishJsFallbackBudgetState(data.requestId);
                    break;
                case 'configureJsFallbackBudget':
                    this.configureJsFallbackBudget(data);
                    break;
                case 'registerProcessor':
                    this._invalidatePowerSkipForMutation();
                    this.registerPluginProcessor(data.pluginType, data.processor);
                    break;
                case 'batchUpdatePlugins':
                    this._invalidatePowerSkipForMutation();
                    this.batchUpdatePlugins(data.plugins || []);
                    break;
                case 'addPlugin':
                    this._invalidatePowerSkipForMutation();
                    this.addPlugin(data.plugin, data.index);
                    break;
                case 'removePlugin':
                    this._invalidatePowerSkipForMutation();
                    this.removePlugin(data.pluginId);
                    break;
                case 'reorderPlugin':
                    this._invalidatePowerSkipForMutation();
                    this.reorderPlugin(data.fromIndex, data.toIndex);
                    break;
                case 'resetProcessingState':
                    this.resetConfiguredProcessingState(data.requestId);
                    break;
                case 'reset':
                    this._invalidatePowerSkipForMutation();
                    this.clearAudioProcessingOverload();
                    ++this.dspExecutionGeneration;
                    this.publishWasmOnlyExecutionStates(true, true);
                    this.destroyAllDspInstances();
                    if (this.dspLive) this.dspBinding.reset();
                    this.plugins = [];
                    this.pluginContexts.clear();
                    this.dspAssetCache.clear();
                    this.dspAssetStates.clear();
                    this.dspAssetStateRevisions.clear();
                    this.dspAssetStateReplayEpochs.clear();
                    this.dspDeferredAssetStages.clear();
                    this.masterBypass = false;
                    this.resetDspLatencyPlan();
                    this.setOutputDelay(0);
                    this.publishDspPipelineLatency(0, false);
                    break;
                case 'userActivity':
                    { // Block scope for const time
                        // Use performance.now() or a similar high-resolution timer if available and appropriate
                        // For AudioWorklet, using currentFrame / sampleRate is standard practice.
                        const time = this.currentFrame / globalThis.sampleRate;
                        const monitoring = this.audioLevelMonitoring;
                        monitoring.lastUserActivityTime = time;

                        if (monitoring.isSleepMode) {
                            console.log("User activity detected, exiting sleep mode.");
                            monitoring.isSleepMode = false;
                            this.port.postMessage({
                                type: 'sleepModeChanged',
                                isSleepMode: false
                            });
                        }
                    }
                    break;
                // Add a case to update SILENCE_THRESHOLD dynamically if needed
                case 'updateSilenceThreshold':
                    if (typeof data.threshold === 'number') {
                         this.audioLevelMonitoring.SILENCE_THRESHOLD = data.threshold;
                         this.audioLevelMonitoring._silenceThresholdAmplitude = Math.pow(10, data.threshold / 20);
                    }
                     break;
                case 'setLowLatencyMode':
                    this.lowLatencyMode = !!data.enabled;
                    this.MESSAGE_INTERVAL = this.lowLatencyMode ? 8 : 16;
                    break;
                case 'configurePowerPolicy':
                    this.configurePowerPolicy(data);
                    break;
                case 'setPowerProcessingState':
                    this.setPowerProcessingState(data);
                    break;
                case 'setUiTelemetryEnabled':
                    if (this._matchesPowerIdentity(data)) {
                        this.powerPolicy.uiTelemetryEnabled = data.enabled === true;
                        this.port.postMessage({
                            type: 'powerStateAck',
                            commandId: data.commandId ?? null,
                            workletGraphGeneration: this.powerPolicy.workletGraphGeneration,
                            topologyRevision: this.powerPolicy.topologyRevision,
                            renderSequence: this.powerPolicy.renderSequence,
                            uiTelemetryEnabled: this.powerPolicy.uiTelemetryEnabled
                        });
                    }
                    break;
                case 'requestPowerObservation':
                    if (this._matchesPowerIdentity(data)) {
                        this.powerPolicy.pendingObservationRequestId = data.observationRequestId ?? null;
                    }
                    break;
                case 'prepareTemporalStateAndResume':
                    this.prepareTemporalStateAndResume(data);
                    break;
            }
        };
    }

    _matchesPowerIdentity(data) {
        const power = this.powerPolicy;
        return data?.workletGraphGeneration === power.workletGraphGeneration &&
            data?.topologyRevision === power.topologyRevision;
    }

    _disarmAutomaticMonitoring() {
        const power = this.powerPolicy;
        power.arm.state = 'disarmed';
        power.arm.commandId = null;
        power.arm.skipEpoch = null;
        power.arm.armAfterRenderSequence = null;
        power.armStartFrame = null;
        power.monitoringPreparationPending = false;
    }

    _clearPowerSkipOwnership() {
        const power = this.powerPolicy;
        power.commandId = null;
        power.skipEpoch = null;
        power.hostResumeTerminal = null;
        power.skippedFrameCount = 0;
        power.skippedFrameRemainder = 0;
        power.lastConsumedSkipEpoch = -1;
        power.skipSampleRate = globalThis.sampleRate;
        this._disarmAutomaticMonitoring();
    }

    _invalidatePowerSkipForMutation() {
        const power = this.powerPolicy;
        if (!power?.enabled) return;
        power.state = 'active';
        power.processingDirective = 'full-process';
        power.temporalSkipEligible = false;
        power.temporalCapabilities = [];
        power.monitoringPreparationRequired = false;
        power.monitoringStaticCoverageValid = false;
        power.monitoringFastWakeEligible = false;
        power.monitoringFastWakeBlockerReason = 'temporal-preparation-not-worklet-local';
        power.pendingConfigWake = true;
        power.activeFullProcessSettled = false;
        this._clearPowerSkipOwnership();
        this._resetPowerSilenceWindow();
    }

    _resetPowerSilenceWindow() {
        const power = this.powerPolicy;
        power.inputSilentFrames = 0;
        power.outputSilentFrames = 0;
        power.silentSinceFrame = null;
        power.inputPowerEwma = 0;
        power.outputPowerEwma = 0;
    }

    _getEnabledPowerPluginIds() {
        const ids = [];
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin?.type === 'SectionPlugin') {
                sectionEnabled = plugin.enabled !== false;
                continue;
            }
            if (plugin?.enabled !== false && sectionEnabled) ids.push(plugin.id);
        }
        return ids;
    }

    _normalizeTemporalCapability(entry) {
        if (!entry || (entry.pluginId === null || entry.pluginId === undefined)) return null;
        const capability = entry.capability;
        if (capability === 'stateless') {
            return { pluginId: entry.pluginId, capability, descriptor: null };
        }
        if (capability === 'reset-on-resume') {
            const descriptor = entry.descriptor;
            if (descriptor !== null && descriptor !== undefined &&
                (descriptor.primitive !== 'canonical-reset' ||
                    !Number.isSafeInteger(descriptor.fixedOperations) ||
                    descriptor.fixedOperations < 1)) return null;
            return {
                pluginId: entry.pluginId,
                capability,
                descriptor: {
                    primitive: 'canonical-reset',
                    fixedOperations: descriptor?.fixedOperations || 1
                }
            };
        }
        if (capability !== 'age-by-skipped-frames') return null;
        const descriptor = entry.descriptor;
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
            stateFields.push({
                key: field.key,
                incrementPerFrame: field.incrementPerFrame,
                modulo
            });
        }
        return {
            pluginId: entry.pluginId,
            capability,
            descriptor: {
                primitive: 'analytic-age',
                fixedOperations: descriptor.fixedOperations,
                resetFallback: 'canonical-reset',
                stateFields
            }
        };
    }

    _resetTemporalPlugin(pluginId) {
        this.pluginContexts.delete(pluginId);
        const wasmInstance = this.wasmInstances.get(pluginId);
        if (!wasmInstance) return true;
        if (!this.dspBinding) return false;
        return this.dspBinding.resetInstance(wasmInstance.id) === 0;
    }

    resetConfiguredProcessingState(requestId = null) {
        let ok = true;
        let error = null;
        try {
            if (this.dspLive && this.dspBinding) {
                const status = this.dspBinding.reset();
                if (status !== 0) throw new Error(`DSP reset failed with status ${status}`);
            }
            this.pluginContexts.clear();
            this.currentFrame = 0;
            this.clearAudioProcessingOverload();
            this.audioLevelMonitoring.lastInputActiveTime = 0;
            this.audioLevelMonitoring.lastOutputActiveTime = 0;
            this.audioLevelMonitoring.lastUserActivityTime = 0;
            this.audioLevelMonitoring.isSleepMode = false;
            this.combinedBuffer?.fill(0);
            for (const buffer of this.busBuffers.values()) buffer.fill(0);
            for (const action of this.dspLatencyPlan?.nodeActions?.values() || []) {
                action.delayLine?.reset();
            }
            this.dspLatencyPlan?.outputDelayLine?.reset();
            this.outputDelayLine?.reset();
        } catch (resetError) {
            ok = false;
            error = resetError?.message || String(resetError);
            console.error(`Configured processing-state reset failed: ${error}`);
        }
        this.port.postMessage({
            type: 'processingStateReset',
            requestId,
            ok,
            ...(error && { error })
        });
    }

    _prepareAutomaticMonitoringState() {
        for (const entry of this.powerPolicy.temporalCapabilities) {
            if (entry.capability === 'stateless') continue;
            if (entry.capability !== 'reset-on-resume' ||
                entry.descriptor?.primitive !== 'canonical-reset' ||
                !this._resetTemporalPlugin(entry.pluginId)) return false;
        }
        return true;
    }

    _ageTemporalPlugin(entry, skippedFrameCount) {
        if (this.wasmInstances.has(entry.pluginId)) return false;
        const context = this.pluginContexts.get(entry.pluginId);
        if (!context) return true;
        const nextValues = [];
        for (const field of entry.descriptor.stateFields) {
            const current = context[field.key];
            if (!Number.isFinite(current)) return false;
            let next = current + skippedFrameCount * field.incrementPerFrame;
            if (!Number.isFinite(next)) return false;
            if (field.modulo !== null) {
                next -= Math.floor(next / field.modulo) * field.modulo;
                if (next < 0) next += field.modulo;
            }
            nextValues.push(next);
        }
        for (let index = 0; index < entry.descriptor.stateFields.length; index++) {
            context[entry.descriptor.stateFields[index].key] = nextValues[index];
        }
        return true;
    }

    _prepareTemporalCapabilities(skippedFrameCount, { ageBySkippedFrames }) {
        const power = this.powerPolicy;
        const capabilities = power.temporalCapabilities;
        const counts = {
            stateless: 0,
            resetOnResume: 0,
            agedBySkippedFrames: 0,
            mustProcess: 0
        };
        const actualIds = this._getEnabledPowerPluginIds();
        const actualIdSet = new Set(actualIds);
        const uniqueIds = new Set();
        let coverageValid = Number.isSafeInteger(skippedFrameCount) && skippedFrameCount >= 0 &&
            capabilities.length === power.enabledPluginCount &&
            actualIds.length === power.enabledPluginCount;
        for (const entry of capabilities) {
            const identity = entry?.pluginId;
            if (identity === null || identity === undefined || uniqueIds.has(identity) ||
                !actualIdSet.has(identity)) coverageValid = false;
            else uniqueIds.add(identity);
            if (entry.capability !== 'stateless' &&
                entry.capability !== 'reset-on-resume' &&
                entry.capability !== 'age-by-skipped-frames') coverageValid = false;
        }
        if (!coverageValid) {
            return {
                success: false,
                errorCode: 'temporal-prevalidated-coverage-mismatch',
                counts,
                coveredPluginCount: uniqueIds.size
            };
        }
        try {
            for (const entry of capabilities) {
                if (entry.capability === 'stateless') {
                    counts.stateless++;
                } else if (entry.capability === 'reset-on-resume' || !ageBySkippedFrames) {
                    if (!this._resetTemporalPlugin(entry.pluginId)) {
                        throw new Error('temporal reset failed');
                    }
                    counts.resetOnResume++;
                } else {
                    if (!this._ageTemporalPlugin(entry, skippedFrameCount)) {
                        throw new Error('temporal analytic age failed');
                    }
                    counts.agedBySkippedFrames++;
                }
            }
            return {
                success: true,
                errorCode: null,
                counts,
                coveredPluginCount: uniqueIds.size
            };
        } catch (_) {
            return {
                success: false,
                errorCode: 'temporal-preparation-runtime-failed',
                counts,
                coveredPluginCount: uniqueIds.size
            };
        }
    }

    configurePowerPolicy(data) {
        const power = this.powerPolicy;
        const enabled = data?.enabled === true;
        if (!enabled) {
            power.enabled = false;
            power.state = 'active';
            power.processingDirective = 'full-process';
            power.uiTelemetryEnabled = true;
            this._clearPowerSkipOwnership();
            return;
        }
        if (!Number.isInteger(data.workletGraphGeneration) || data.workletGraphGeneration < 0 ||
            !Number.isInteger(data.topologyRevision) || data.topologyRevision < 0) return;

        const powerIdentityCurrent =
            data.workletGraphGeneration === power.workletGraphGeneration &&
            data.topologyRevision === power.topologyRevision;
        const previousDirective = power.processingDirective;
        const previousHostSkipActive = power.commandId !== null && (
            previousDirective === 'force-monitoring' ||
            previousDirective === 'zero-output-transport' ||
            previousDirective === 'bypass-transport'
        );
        const hostGuardDirective = data.hostGuardDirective;
        const hostGuardRequested = hostGuardDirective === 'force-monitoring' ||
            hostGuardDirective === 'zero-output-transport' ||
            hostGuardDirective === 'bypass-transport';
        const hostGuardValid = hostGuardRequested &&
            Number.isSafeInteger(data.commandId) && data.commandId >= 0 &&
            Number.isSafeInteger(data.hostGuardSkipEpoch) && data.hostGuardSkipEpoch >= 0 &&
            (!powerIdentityCurrent ||
                data.commandId > power.lastPowerCommandId &&
                data.hostGuardSkipEpoch > power.lastAcceptedSkipEpoch);
        if (hostGuardRequested && !hostGuardValid) return;
        const preserveHostSkipFrames = hostGuardValid && data.preserveHostSkipState === true &&
            previousHostSkipActive && previousDirective === hostGuardDirective;
        const preservedSkippedFrameCount = power.skippedFrameCount;
        const preservedSkippedFrameRemainder = power.skippedFrameRemainder;
        const preservedSkipSampleRate = power.skipSampleRate;
        const preservedCommandId = power.commandId;
        const preservedSkipEpoch = power.skipEpoch;
        const preservedHostResumeTerminal = power.hostResumeTerminal;

        power.enabled = true;
        this.audioLevelMonitoring.isSleepMode = false;
        power.workletGraphGeneration = data.workletGraphGeneration;
        power.topologyRevision = data.topologyRevision;
        if (typeof data.uiTelemetryEnabled === 'boolean') {
            power.uiTelemetryEnabled = data.uiTelemetryEnabled;
        }
        const thresholdDb = Number.isFinite(data.silenceThresholdDb) ? data.silenceThresholdDb : -80;
        const wakeGainMarginDb = Number.isFinite(data.wakeGainMarginDb) ? data.wakeGainMarginDb : 0;
        const silenceSeconds = Number.isFinite(data.silenceDurationSeconds) && data.silenceDurationSeconds >= 0
            ? data.silenceDurationSeconds
            : 60;
        power.silenceThresholdPower = Math.pow(10, thresholdDb / 10);
        const wakeFloorDb = thresholdDb - wakeGainMarginDb;
        power.wakeFloorPower = Math.pow(10, wakeFloorDb / 10);
        power.wakeOnAnyInput = data.wakeOnAnyInput === true;
        power.exitThresholdPower = Math.pow(10, (thresholdDb + 6) / 10);
        power.silenceFramesRequired = Math.round(globalThis.sampleRate * silenceSeconds);
        const capabilities = Array.isArray(data.monitoringPreparationCapabilities)
            ? data.monitoringPreparationCapabilities
            : [];
        const normalizedCapabilities = [];
        let descriptorsValid = true;
        for (const capability of capabilities) {
            const normalized = this._normalizeTemporalCapability(capability);
            if (!normalized) {
                descriptorsValid = false;
                continue;
            }
            normalizedCapabilities.push(normalized);
        }
        power.temporalCapabilities = normalizedCapabilities;
        power.enabledPluginCount = Number.isSafeInteger(data.enabledPluginCount) &&
            data.enabledPluginCount >= 0 ? data.enabledPluginCount : 0;
        const actualPluginIds = this._getEnabledPowerPluginIds();
        const actualPluginIdSet = new Set(actualPluginIds);
        const capabilityIds = new Set();
        let exactCoverageValid = descriptorsValid &&
            normalizedCapabilities.length === power.enabledPluginCount &&
            actualPluginIds.length === power.enabledPluginCount;
        for (const capability of normalizedCapabilities) {
            if (capabilityIds.has(capability.pluginId) ||
                !actualPluginIdSet.has(capability.pluginId)) {
                exactCoverageValid = false;
                break;
            }
            capabilityIds.add(capability.pluginId);
        }
        let staticCoverageValid = exactCoverageValid;
        for (let index = 0; index < normalizedCapabilities.length; index++) {
            const capability = normalizedCapabilities[index];
            if (capability.capability !== 'stateless' &&
                (capability.capability !== 'reset-on-resume' ||
                    capability.descriptor?.primitive !== 'canonical-reset')) {
                staticCoverageValid = false;
                break;
            }
        }
        power.monitoringStaticCoverageValid = staticCoverageValid;
        power.monitoringPreparationRequired = normalizedCapabilities.some(
            capability => capability.capability === 'reset-on-resume'
        );
        power.monitoringFastWakeEligible = data.monitoringFastWakeEligible === true &&
            staticCoverageValid;
        power.monitoringFastWakeBlockerReason = power.monitoringFastWakeEligible
            ? null
            : (staticCoverageValid
                ? (data.monitoringFastWakeBlockerReason || 'temporal-preparation-not-worklet-local')
                : 'temporal-preparation-not-worklet-local');
        const temporalCoverageValid = exactCoverageValid &&
            normalizedCapabilities.every(capability => capability && (
                capability.capability === 'stateless' ||
                capability.capability === 'reset-on-resume' ||
                capability.capability === 'age-by-skipped-frames'
            ));
        power.temporalSkipEligible = data.temporalSkipEligible === true && temporalCoverageValid;
        power.ewmaAlpha = 1 - Math.exp(-128 / (globalThis.sampleRate * 2));
        power.dcBlockerR = Math.exp(-2 * Math.PI * 5 / globalThis.sampleRate);
        power.skipSampleRate = globalThis.sampleRate;
        power.pendingConfigWake = true;
        power.activeFullProcessSettled = false;
        this._resetPowerSilenceWindow();
        if (!powerIdentityCurrent) {
            power.lastPowerCommandId = -1;
            power.lastAcceptedSkipEpoch = -1;
        }
        if (hostGuardValid) {
            power.state = hostGuardDirective === 'force-monitoring' ? 'monitoring' : 'active';
            power.processingDirective = hostGuardDirective;
            power.commandId = data.commandId;
            power.skipEpoch = data.hostGuardSkipEpoch;
            power.lastPowerCommandId = data.commandId;
            power.lastAcceptedSkipEpoch = data.hostGuardSkipEpoch;
            power.hostResumeTerminal = null;
            power.skippedFrameCount = preserveHostSkipFrames
                ? preservedSkippedFrameCount
                : 0;
            power.skippedFrameRemainder = preserveHostSkipFrames
                ? preservedSkippedFrameRemainder
                : 0;
            power.skipSampleRate = preserveHostSkipFrames
                ? preservedSkipSampleRate
                : globalThis.sampleRate;
            this._disarmAutomaticMonitoring();
            power.pendingFirstRenderCommandId = data.commandId;
        } else if (powerIdentityCurrent && previousHostSkipActive) {
            power.state = previousDirective === 'force-monitoring' ? 'monitoring' : 'active';
            power.processingDirective = previousDirective;
            power.commandId = preservedCommandId;
            power.skipEpoch = preservedSkipEpoch;
            power.hostResumeTerminal = preservedHostResumeTerminal;
            power.skippedFrameCount = preservedSkippedFrameCount;
            power.skippedFrameRemainder = preservedSkippedFrameRemainder;
            power.skipSampleRate = preservedSkipSampleRate;
            this._disarmAutomaticMonitoring();
        } else {
            power.state = 'active';
            power.processingDirective = 'full-process';
            this._clearPowerSkipOwnership();
        }
        this.port.postMessage({
            type: 'powerStateAck',
            commandId: data.commandId ?? null,
            workletGraphGeneration: power.workletGraphGeneration,
            topologyRevision: power.topologyRevision,
            renderSequence: power.renderSequence,
            configured: true,
            skipEpoch: power.skipEpoch,
            state: power.state,
            processingDirective: power.processingDirective,
            monitoringFastWakeEligible: power.monitoringFastWakeEligible,
            monitoringFastWakeBlockerReason: power.monitoringFastWakeBlockerReason
        });
    }

    setPowerProcessingState(data) {
        const power = this.powerPolicy;
        if (!power.enabled || !this._matchesPowerIdentity(data)) return;
        const directive = data.processingDirective;
        if (directive !== 'full-process' && directive !== 'allow-automatic' &&
            directive !== 'force-monitoring' && directive !== 'bypass-transport' &&
            directive !== 'zero-output-transport') return;

        const deliberateSkipDirective = directive === 'force-monitoring' ||
            directive === 'bypass-transport' || directive === 'zero-output-transport';
        const skipOwnershipDirective = deliberateSkipDirective || directive === 'allow-automatic';
        const commandIdValid = Number.isSafeInteger(data.commandId) && data.commandId >= 0 &&
            data.commandId > power.lastPowerCommandId;
        const skipEpochValid = !skipOwnershipDirective ||
            Number.isSafeInteger(data.skipEpoch) && data.skipEpoch >= 0 &&
            data.skipEpoch > power.lastAcceptedSkipEpoch;
        if (!commandIdValid || !skipEpochValid) {
            this.port.postMessage({
                type: 'powerStateAck',
                commandId: data.commandId ?? null,
                skipEpoch: power.skipEpoch,
                workletGraphGeneration: power.workletGraphGeneration,
                topologyRevision: power.topologyRevision,
                processingDirective: power.processingDirective,
                state: power.state,
                renderSequence: power.renderSequence,
                armStartFrame: power.armStartFrame,
                automaticMonitoringArm: { ...power.arm },
                automaticArmAccepted: directive === 'allow-automatic' ? false : null,
                commandAccepted: false,
                commandRejectedReason: 'stale-power-command'
            });
            return;
        }
        power.lastPowerCommandId = data.commandId;
        const previousDirective = power.processingDirective;
        const enteringNewSkipEpoch = deliberateSkipDirective &&
            (previousDirective !== directive || power.skipEpoch !== data.skipEpoch);
        const hostSkipActive = power.commandId !== null && (
            previousDirective === 'force-monitoring' ||
            previousDirective === 'zero-output-transport' ||
            previousDirective === 'bypass-transport'
        );
        const preserveHostSkipState = data.preserveHostSkipState === true &&
            deliberateSkipDirective && hostSkipActive && previousDirective === directive;
        let automaticArmAccepted = null;
        let commandAccepted = false;
        let commandRejectedReason = 'unsafe-power-command';
        if (directive === 'full-process' && hostSkipActive) {
            commandRejectedReason = 'atomic-temporal-resume-required';
        } else if ((directive === 'allow-automatic' && !power.monitoringFastWakeEligible) ||
            ((directive === 'force-monitoring' || directive === 'zero-output-transport' ||
                directive === 'bypass-transport') && !power.temporalSkipEligible &&
                !preserveHostSkipState)) {
            power.state = 'active';
            power.processingDirective = 'full-process';
            this._clearPowerSkipOwnership();
        } else {
            power.processingDirective = directive;
            if (directive === 'force-monitoring') {
                power.state = 'monitoring';
                commandAccepted = true;
                if (enteringNewSkipEpoch) {
                    if (!preserveHostSkipState) {
                        power.skippedFrameCount = 0;
                        power.skippedFrameRemainder = 0;
                        power.skipSampleRate = globalThis.sampleRate;
                    }
                    power.hostResumeTerminal = null;
                }
                this._disarmAutomaticMonitoring();
            } else if (directive === 'allow-automatic') {
                power.state = 'active';
                const isFreshArm = data.state === 'active' && previousDirective === 'full-process' &&
                    power.activeFullProcessSettled &&
                    Number.isSafeInteger(data.armAfterRenderSequence) &&
                    power.renderSequence >= data.armAfterRenderSequence &&
                    power.monitoringStaticCoverageValid;
                if (isFreshArm) {
                    automaticArmAccepted = true;
                    commandAccepted = true;
                    power.arm.state = 'armed';
                    power.arm.commandId = data.commandId;
                    power.arm.skipEpoch = data.skipEpoch;
                    power.arm.armAfterRenderSequence = data.armAfterRenderSequence;
                    power.armStartFrame = this.currentFrame;
                    power.skipSampleRate = globalThis.sampleRate;
                    power.skippedFrameCount = 0;
                    power.skippedFrameRemainder = 0;
                    power.hostResumeTerminal = null;
                    this._resetPowerSilenceWindow();
                } else {
                    automaticArmAccepted = false;
                    power.processingDirective = 'full-process';
                    power.activeFullProcessSettled = false;
                    this._clearPowerSkipOwnership();
                }
            } else {
                power.state = 'active';
                commandAccepted = true;
                if (directive === 'full-process') {
                    power.activeFullProcessSettled = false;
                    this._clearPowerSkipOwnership();
                }
                if (enteringNewSkipEpoch &&
                    (directive === 'zero-output-transport' || directive === 'bypass-transport')) {
                    if (!preserveHostSkipState) {
                        power.skippedFrameCount = 0;
                        power.skippedFrameRemainder = 0;
                        power.skipSampleRate = globalThis.sampleRate;
                    }
                    power.hostResumeTerminal = null;
                }
                if (directive !== 'full-process') {
                    this._disarmAutomaticMonitoring();
                }
            }
        }
        if (commandAccepted) {
            if (skipOwnershipDirective) power.lastAcceptedSkipEpoch = data.skipEpoch;
            power.commandId = data.commandId;
            power.skipEpoch = skipOwnershipDirective ? data.skipEpoch : null;
        }
        power.pendingFirstRenderCommandId = data.commandId;
        this.port.postMessage({
            type: 'powerStateAck',
            commandId: data.commandId,
            skipEpoch: power.skipEpoch,
            workletGraphGeneration: power.workletGraphGeneration,
            topologyRevision: power.topologyRevision,
            processingDirective: power.processingDirective,
            state: power.state,
            renderSequence: power.renderSequence,
            armStartFrame: power.armStartFrame,
            automaticMonitoringArm: { ...power.arm },
            automaticArmAccepted,
            commandAccepted,
            commandRejectedReason: commandAccepted ? null : commandRejectedReason
        });
    }

    prepareTemporalStateAndResume(data) {
        const power = this.powerPolicy;
        if (!power.enabled || !this._matchesPowerIdentity(data)) return;
        const requestIdentityValid = data.origin === 'deliberate' &&
            data.ownerOperationId !== null && data.ownerOperationId !== undefined &&
            Number.isSafeInteger(data.commandId) && data.commandId >= 0 &&
            Number.isSafeInteger(data.skipEpoch) && data.skipEpoch >= 0 &&
            Number.isSafeInteger(data.resumeCommandId) && data.resumeCommandId >= 0 &&
            (Number.isSafeInteger(data.ackCommandId) ||
                typeof data.ackCommandId === 'string' && data.ackCommandId.length > 0);
        if (!requestIdentityValid) return;

        const terminal = power.hostResumeTerminal;
        if (terminal?.commandId === data.commandId && terminal.skipEpoch === data.skipEpoch) {
            if (terminal.state === 'acknowledged') {
                power.pendingFirstRenderCommandId = terminal.resumeCommandId;
            }
            this.port.postMessage({
                type: 'temporalStateResumed',
                ...terminal,
                ownerOperationId: data.ownerOperationId,
                ackCommandId: data.ackCommandId
            });
            return;
        }

        const hostSkipActive = power.processingDirective === 'force-monitoring' ||
            power.processingDirective === 'zero-output-transport' ||
            power.processingDirective === 'bypass-transport';
        const commandIdentityValid = hostSkipActive &&
            data.commandId === power.commandId && data.skipEpoch === power.skipEpoch &&
            data.resumeCommandId > power.lastPowerCommandId;
        if (!commandIdentityValid) return;
        power.lastPowerCommandId = data.resumeCommandId;

        const liveSkippedFrameCount = power.skippedFrameCount;
        const baseFrameCountValid = Number.isSafeInteger(liveSkippedFrameCount) &&
            liveSkippedFrameCount >= 0;
        const elapsedVerified = data.elapsedContinuity === 'verified' &&
            Number.isFinite(data.suspendedElapsedMs) && data.suspendedElapsedMs >= 0 &&
            Number.isFinite(data.resumeSampleRate) && data.resumeSampleRate > 0 &&
            data.resumeSampleRate === power.skipSampleRate &&
            data.resumeSampleRate === globalThis.sampleRate;
        const elapsedUnknown = data.elapsedContinuity === 'unknown' &&
            data.suspendedElapsedMs === 0;
        let derivedFrames = 0;
        if (elapsedVerified) {
            const exactFrames = data.suspendedElapsedMs * data.resumeSampleRate / 1000 +
                power.skippedFrameRemainder;
            derivedFrames = Math.floor(exactFrames);
        }
        const totalSkippedFrameCount = liveSkippedFrameCount + derivedFrames;
        const elapsedValid = baseFrameCountValid && (elapsedVerified || elapsedUnknown) &&
            Number.isSafeInteger(derivedFrames) && derivedFrames >= 0 &&
            Number.isSafeInteger(totalSkippedFrameCount) && totalSkippedFrameCount >= 0;
        const preparation = elapsedValid
            ? this._prepareTemporalCapabilities(totalSkippedFrameCount, {
                ageBySkippedFrames: elapsedVerified
            })
            : {
                success: false,
                errorCode: 'temporal-prevalidated-coverage-mismatch',
                counts: {
                    stateless: 0,
                    resetOnResume: 0,
                    agedBySkippedFrames: 0,
                    mustProcess: 0
                },
                coveredPluginCount: 0
            };
        const state = preparation.success ? 'acknowledged' : 'error';
        const result = {
            state,
            origin: 'deliberate',
            ownerOperationId: data.ownerOperationId ?? null,
            commandId: data.commandId ?? null,
            resumeCommandId: data.resumeCommandId,
            ackCommandId: data.ackCommandId ?? null,
            skipEpoch: data.skipEpoch ?? null,
            workletGraphGeneration: power.workletGraphGeneration,
            topologyRevision: power.topologyRevision,
            enabledPluginCount: power.enabledPluginCount,
            coveredPluginCount: preparation.coveredPluginCount,
            appliedPolicyCounts: preparation.counts,
            skippedFrameCount: state === 'acknowledged'
                ? totalSkippedFrameCount
                : power.skippedFrameCount,
            renderSequence: power.renderSequence,
            errorCode: preparation.errorCode,
            monitoringFastWakeEligible: preparation.success
                ? power.monitoringFastWakeEligible
                : false,
            monitoringFastWakeBlockerReason: preparation.success
                ? power.monitoringFastWakeBlockerReason
                : 'temporal-preparation-runtime-failed'
        };
        if (preparation.success) {
            power.state = 'active';
            power.processingDirective = 'full-process';
            power.activeFullProcessSettled = false;
            power.pendingConfigWake = false;
            this._clearPowerSkipOwnership();
            power.pendingFirstRenderCommandId = data.resumeCommandId;
            this._resetPowerSilenceWindow();
        } else {
            power.monitoringFastWakeEligible = false;
            power.monitoringFastWakeBlockerReason = 'temporal-preparation-runtime-failed';
            power.counters.monitoringRuntimeFailures++;
            power.pendingConfigWake = false;
        }
        power.hostResumeTerminal = {
            ...result,
            ownerOperationId: null,
            ackCommandId: null
        };
        this.port.postMessage({ type: 'temporalStateResumed', ...result });
    }

    async initializeDsp(data) {
        const generation = ++this.dspInitGeneration;
        this.port.postMessage({
            type: 'dspInitializing',
            ...(Number.isInteger(data?.token) ? { token: data.token } : {})
        });
        ++this.dspExecutionGeneration;
        this.dspExecutionInitializing = true;
        this.dspExecutionRuntimeFallbacks.clear();
        this.publishWasmOnlyExecutionStates(true);
        const moduleOrBytes = data?.module ?? data?.bytes;
        if (!moduleOrBytes) {
            this.dspExecutionInitializing = false;
            this.disableDspEngine();
            this.reportDspFailure('instantiate', 'module payload is missing');
            this.publishWasmOnlyExecutionStates(true);
            return;
        }

        this.disableDspEngine();
        let binding = null;
        try {
            binding = await instantiateDspBinding(moduleOrBytes, {
                onUnexpectedMemoryGrowth: () => {
                    this.failDspEngine('runtime', 'memory grew outside prepare');
                }
            });
            if (generation !== this.dspInitGeneration) {
                binding.close();
                return;
            }
            binding.createEngine();
            const status = binding.prepare(
                this.dspSampleRate || globalThis.sampleRate,
                ET_DSP_MAX_CHANNELS,
                ET_DSP_MAX_FRAMES,
                ET_DSP_TELEMETRY_BYTES
            );
            if (status !== 0) {
                binding.close();
                throw new Error(`prepare returned ${status}`);
            }

            const capabilities = binding.getCapabilities();
            this.dspBinding = binding;
            this.dspLive = true;
            if (this.dspTelemetryRateHz !== null) {
                const telemetryStatus = binding.setTelemetryRate(this.dspTelemetryRateHz);
                if (telemetryStatus !== 0) {
                    this.reportDspFailure('telemetry-rate', `status ${telemetryStatus}`);
                }
            }
            this.dspSimd = data.simd ?? capabilities.simd;
            this.wasmKernels = new Map(
                capabilities.kernels.map(kernel => [kernel.name, {
                    paramsHash: kernel.hash >>> 0,
                    byteCapacity: kernel.byteCapacity ?? 0,
                    assetCapacity: kernel.assetCapacity ?? 0
                }])
            );
            this.adoptDspArena();
            this.dspPacketPool = Array.from(
                { length: ET_DSP_PACKET_POOL_SIZE },
                () => new Uint8Array(ET_DSP_TELEMETRY_BYTES)
            );
            this.reconcileDspInstances();
            this.dspExecutionInitializing = false;
            this.refreshDspPipeline();
            this.publishWasmOnlyExecutionStates();
            this.port.postMessage({
                type: 'dspReady',
                abiVersion: capabilities.abiVersion,
                kernels: capabilities.kernels.map(kernel => ({
                    name: kernel.name,
                    hash: kernel.hash >>> 0,
                    byteCapacity: kernel.byteCapacity ?? 0,
                    assetCapacity: kernel.assetCapacity ?? 0
                })),
                simd: this.dspSimd
            });
        } catch (error) {
            if (generation !== this.dspInitGeneration) {
                try { binding?.close(); } catch (_) { /* stale initialization cleanup */ }
                return;
            }
            this.dspExecutionInitializing = false;
            this.disableDspEngine();
            this.reportDspFailure('instantiate', error?.message || String(error));
            this.publishWasmOnlyExecutionStates(true);
        }
    }

    createLegacyBufferPool() {
        const buses = new Map();
        for (let bus = 1; bus <= 4; bus++) {
            buses.set(bus, new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES));
        }
        return {
            combined: new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES),
            allChannels: new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES),
            stereo: new Float32Array(2 * ET_DSP_MAX_FRAMES),
            mono: new Float32Array(ET_DSP_MAX_FRAMES),
            mixing: new Float32Array(ET_DSP_MAX_CHANNELS * ET_DSP_MAX_FRAMES),
            buses
        };
    }

    adoptDspArena() {
        const arena = this.dspBinding.getArenaViews();
        this.bufferPool = {
            combined: arena.combined,
            allChannels: arena.scratch.allChannels,
            stereo: arena.scratch.stereo,
            mono: arena.scratch.mono,
            mixing: arena.scratch.mixing,
            buses: new Map(Array.from(arena.buses).filter(([bus]) => bus !== 0))
        };
        this.combinedBuffer = null;
    }

    disableDspEngine() {
        this.destroyAllDspInstances();
        this.dspDeferredAssetStages.clear();
        if (this.dspBinding) {
            try {
                this.dspBinding.close();
            } catch (error) {
                this.reportDspFailure('destroy', error?.message || String(error));
            }
        }
        this.dspBinding = null;
        this.dspLive = false;
        this.dspPipelineReady = false;
        this.wasmKernels.clear();
        this.dspPacketPool = [];
        this.dspPendingInstanceDestroy = [];
        this.dspEngineNeedsCleanup = false;
        this.bufferPool = this.createLegacyBufferPool();
        this.rebuildDspLatencyPlan();
    }

    failDspEngine(stage, error) {
        if (!this.dspLive) return;
        this.dspDeferredAssetStages.clear();
        this.dspLive = false;
        this.dspPipelineReady = false;
        this.wasmInstances.clear();
        this.dspPendingInstanceDestroy = [];
        this.dspEngineNeedsCleanup = true;
        this.bufferPool = this.createLegacyBufferPool();
        this.reportDspFailure(stage, error);
        for (const plugin of this.plugins) {
            if (requiresWasmExecution(plugin)) {
                this.dspExecutionRuntimeFallbacks.add(plugin.id);
            }
        }
        ++this.dspExecutionGeneration;
        this.rebuildDspLatencyPlan();
        this.publishWasmOnlyExecutionStates(true);
        this.port.postMessage({ type: 'dspCleanupNeeded' });
    }

    cleanupDspFailures() {
        if (this.dspEngineNeedsCleanup) {
            if (this.dspBinding) {
                try {
                    this.dspBinding.close();
                } catch (error) {
                    console.warn(`[dsp-wasm] Deferred engine cleanup failed: ${error?.message || String(error)}`);
                }
            }
            this.dspBinding = null;
            this.dspEngineNeedsCleanup = false;
            this.dspPendingInstanceDestroy = [];
            return;
        }
        if (!this.dspBinding) {
            this.dspPendingInstanceDestroy = [];
            return;
        }
        for (const instanceId of this.dspPendingInstanceDestroy) {
            this.dspBinding.destroyInstance(instanceId);
        }
        this.dspPendingInstanceDestroy = [];
    }

    reportDspFailure(stage, error) {
        const key = `${stage}:${error}`;
        if (this.dspReportedFailures.has(key)) return;
        this.dspReportedFailures.add(key);
        console.warn(`[dsp-wasm] ${stage} failed: ${error}`);
        this.port.postMessage({ type: 'dspFailed', stage, error: String(error) });
    }

    destroyAllDspInstances() {
        this.dspPipelineReady = false;
        if (this.dspBinding) {
            for (const entry of this.wasmInstances.values()) {
                this.dspBinding.destroyInstance(entry.id);
            }
        }
        this.wasmInstances.clear();
    }

    destroyDspInstance(pluginId) {
        this.dspPipelineReady = false;
        const entry = this.wasmInstances.get(pluginId);
        if (!entry) return;
        if (this.dspBinding) this.dspBinding.destroyInstance(entry.id);
        this.wasmInstances.delete(pluginId);
    }

    postTubeSimulatorRuntimeEvent(plugin, entry, force = false) {
        if (!plugin || plugin.type !== 'TubeSimulatorPlugin' || !entry?.id ||
            !this.dspBinding) return;
        const state = this.dspBinding.instanceRuntimeEvent(entry.id);
        if (!state) return;
        if (!force && entry.runtimeEventGeneration === state.generation) return;
        const causes = ['none', 'feedbackOscillation', 'processingSafetyFailure'];
        const cause = causes[state.cause];
        if (!cause || state.generation < 0 || state.generation > 0xffffffff) return;
        entry.runtimeEventGeneration = state.generation;
        this.port.postMessage({
            type: 'tubeSimulatorCircuitFault',
            pluginId: plugin.id,
            pluginType: plugin.type,
            instanceEpoch: entry.instanceEpoch,
            generation: state.generation,
            latched: state.latched,
            cause
        });
    }

    pollTubeSimulatorRuntimeEvents(force = false) {
        for (const plugin of this.plugins) {
            const entry = this.wasmInstances.get(plugin.id);
            if (entry?.ready) {
                this.postTubeSimulatorRuntimeEvent(plugin, entry, force);
            }
        }
    }

    reconcileDspInstances() {
        if (!this.dspLive) return false;
        const currentIds = new Set(this.plugins.map(plugin => plugin.id));
        for (const pluginId of this.dspAssetCache.keys()) {
            if (!currentIds.has(pluginId)) {
                this.dspAssetCache.delete(pluginId);
                this.dspAssetStates.delete(pluginId);
                this.dspAssetStateRevisions.delete(pluginId);
                this.dspAssetStateReplayEpochs.delete(pluginId);
            }
        }
        for (const [key, deferred] of this.dspDeferredAssetStages) {
            if (!currentIds.has(deferred.pluginId)) this.dspDeferredAssetStages.delete(key);
        }
        try {
            for (const pluginId of this.wasmInstances.keys()) {
                if (!currentIds.has(pluginId)) this.destroyDspInstance(pluginId);
            }
        } catch (error) {
            this.failDspEngine('reconcile', error?.message || String(error));
            return false;
        }
        let reconciled = true;
        for (const plugin of this.plugins) {
            if (!this.reconcileDspPluginSafely(plugin)) reconciled = false;
            if (!this.dspLive) break;
        }
        return reconciled;
    }

    reconcileDspPluginSafely(plugin) {
        try {
            this.reconcileDspPlugin(plugin);
            return true;
        } catch (error) {
            this.dspPipelineReady = false;
            if (this.dspLive) {
                this.runtimeFallback(
                    plugin,
                    `reconcile failed: ${error?.message || String(error)}`,
                    'reconcile'
                );
            }
            return false;
        }
    }

    reconcileDspPlugin(plugin) {
        if (!plugin) return;
        const kernel = this.wasmKernels.get(plugin.type);
        const eligible = this.dspLive && this.dspEnabledTypes.has(plugin.type) &&
            !this.dspFailedTypes.has(plugin.type) && kernel;
        let entry = this.wasmInstances.get(plugin.id);
        if (!eligible) {
            if (entry) this.destroyDspInstance(plugin.id);
            return;
        }
        if (entry && entry.type !== plugin.type) {
            this.destroyDspInstance(plugin.id);
            entry = null;
        }
        const wasReady = entry?.ready === true;
        if (!entry) {
            const previousMemory = this.bufferPool.combined?.buffer;
            let id = 0;
            try {
                id = this.dspBinding.createInstance(plugin.type);
            } finally {
                const currentMemory = this.dspBinding.memory?.buffer;
                if (currentMemory && previousMemory !== currentMemory) {
                    this.adoptDspArena();
                }
            }
            if (!id) {
                if (requiresWasmExecution(plugin)) {
                    this.dspExecutionRuntimeFallbacks.add(plugin.id);
                }
                this.reportDspFailure(`instance:${plugin.id}`, `unable to create ${plugin.type}`);
                return;
            }
            this.dspInstanceEpoch = (this.dspInstanceEpoch + 1) >>> 0;
            entry = {
                id,
                type: plugin.type,
                ready: false,
                instanceEpoch: this.dspInstanceEpoch,
                runtimeEventGeneration: null
            };
            this.wasmInstances.set(plugin.id, entry);
            const tapStatus = this.dspBinding.instanceSetTap(id, plugin.id >>> 0);
            if (tapStatus !== 0) {
                this.reportDspFailure(`instance:${plugin.id}`, `tap binding returned ${tapStatus}`);
            }
            this.postTubeSimulatorRuntimeEvent(plugin, entry, true);
        }

        if (plugin.wasmParams instanceof Float32Array && (plugin.wasmParamsHash >>> 0) === kernel.paramsHash) {
            const wasmParams = FIR_CONVOLVER_PLUGIN_TYPES.has(plugin.type) &&
                this.dspDeferredAssetStages.has(`${plugin.id}:0`)
                ? this.firReplacementDryParams(plugin.wasmParams)
                : plugin.wasmParams;
            const numericStatus = this.dspBinding.instanceSetParams(
                entry.id,
                wasmParams,
                plugin.wasmParamsHash >>> 0
            );
            let byteStatus = 0;
            if (numericStatus === 0 && kernel.byteCapacity > 0) {
                if (!(plugin.wasmParamBytes instanceof Uint8Array) ||
                    plugin.wasmParamBytes.byteLength > kernel.byteCapacity) {
                    byteStatus = ET_DSP_ERR_ARGS;
                } else {
                    byteStatus = this.dspBinding.instanceSetParamBytes(
                        entry.id,
                        plugin.wasmParamBytes,
                        plugin.wasmParamsHash >>> 0
                    );
                }
            }
            entry.ready = numericStatus === 0 && byteStatus === 0;
            if (requiresWasmExecution(plugin)) {
                if (entry.ready) {
                    this.dspExecutionRuntimeFallbacks.delete(plugin.id);
                } else {
                    this.dspExecutionRuntimeFallbacks.add(plugin.id);
                }
            }
            if (numericStatus !== 0) {
                this.reportDspFailure(
                    `instance:${plugin.id}`,
                    `set_params returned ${numericStatus}`
                );
            } else if (byteStatus !== 0) {
                this.reportDspFailure(
                    `instance:${plugin.id}`,
                    `set_param_bytes returned ${byteStatus}`
                );
            }
        } else {
            entry.ready = false;
        }
        if (!wasReady && entry.ready) this.restageDspAssets(plugin.id);
    }

    normalizeAssetOperationRevision(value) {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    normalizeAssetReplayEpoch(value) {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    postAssetState(
        pluginId,
        slot,
        state,
        operationRevision = null,
        force = false,
        replayEpoch = null
    ) {
        operationRevision = this.normalizeAssetOperationRevision(operationRevision);
        replayEpoch = this.normalizeAssetReplayEpoch(replayEpoch);
        let states = this.dspAssetStates.get(pluginId);
        if (!states) {
            states = new Map();
            this.dspAssetStates.set(pluginId, states);
        }
        let revisions = this.dspAssetStateRevisions.get(pluginId);
        if (!revisions) {
            revisions = new Map();
            this.dspAssetStateRevisions.set(pluginId, revisions);
        }
        let replayEpochs = this.dspAssetStateReplayEpochs.get(pluginId);
        if (!replayEpochs) {
            replayEpochs = new Map();
            this.dspAssetStateReplayEpochs.set(pluginId, replayEpochs);
        }
        if (!force && states.get(slot) === state && revisions.has(slot) &&
            revisions.get(slot) === operationRevision && replayEpochs.has(slot) &&
            replayEpochs.get(slot) === replayEpoch) return false;
        states.set(slot, state);
        revisions.set(slot, operationRevision);
        replayEpochs.set(slot, replayEpoch);
        this.port.postMessage({
            type: 'assetState',
            pluginId,
            slot,
            state,
            ...(operationRevision !== null && { operationRevision }),
            ...(replayEpoch !== null && { replayEpoch })
        });
        return true;
    }

    postAssetLoadRejected(
        pluginId,
        slot,
        reason,
        operationRevision = null,
        retention = {},
        replayEpoch = null
    ) {
        operationRevision = this.normalizeAssetOperationRevision(operationRevision);
        replayEpoch = this.normalizeAssetReplayEpoch(replayEpoch);
        const retainedOperationRevision = this.normalizeAssetOperationRevision(
            retention.retainedOperationRevision
        );
        const retainedReplayEpoch = this.normalizeAssetReplayEpoch(
            retention.retainedReplayEpoch
        );
        const retainedAssetState = Number.isInteger(retention.retainedAssetState)
            ? retention.retainedAssetState >>> 0
            : 0;
        const retainedStatus = retainedAssetState & 0xff;
        const residentRetained = retention.residentRetained === true &&
            retainedOperationRevision !== null && retainedStatus >= 1 && retainedStatus <= 3;
        const replayFailure = retention.replayFailure === true;
        this.port.postMessage({
            type: 'assetLoadRejected',
            pluginId,
            slot,
            reason,
            residentRetained,
            replayFailure,
            ...(residentRetained && { retainedOperationRevision }),
            ...(residentRetained && { retainedAssetState }),
            ...(residentRetained && retainedReplayEpoch !== null && { retainedReplayEpoch }),
            ...(operationRevision !== null && { operationRevision }),
            ...(replayEpoch !== null && { replayEpoch })
        });
    }

    pruneDspAssetSlot(pluginId, slot) {
        this.dspDeferredAssetStages.delete(`${pluginId}:${slot}`);
        const slots = this.dspAssetCache.get(pluginId);
        slots?.delete(slot);
        if (slots?.size === 0) this.dspAssetCache.delete(pluginId);
        const states = this.dspAssetStates.get(pluginId);
        states?.delete(slot);
        if (states?.size === 0) this.dspAssetStates.delete(pluginId);
        const revisions = this.dspAssetStateRevisions.get(pluginId);
        revisions?.delete(slot);
        if (revisions?.size === 0) this.dspAssetStateRevisions.delete(pluginId);
        const replayEpochs = this.dspAssetStateReplayEpochs.get(pluginId);
        replayEpochs?.delete(slot);
        if (replayEpochs?.size === 0) this.dspAssetStateReplayEpochs.delete(pluginId);
    }

    rejectDspAssetCandidate(
        pluginId,
        slot,
        reason,
        operationRevision,
        previousDescriptor = null,
        replayFailure = false,
        nativeAttempted = false,
        replayEpoch = null
    ) {
        const retainedOperationRevision = this.normalizeAssetOperationRevision(
            previousDescriptor?.operationRevision
        );
        const retainedReplayEpoch = this.normalizeAssetReplayEpoch(previousDescriptor?.replayEpoch);
        const previousState = this.dspAssetStates.get(pluginId)?.get(slot) ?? 0;
        const previousStateRevision = this.dspAssetStateRevisions.get(pluginId)?.get(slot);
        const entry = this.wasmInstances.get(pluginId);
        let nativeState = 0;
        if (entry && this.dspLive && this.dspBinding) {
            nativeState = this.dspBinding.instanceAssetState(entry.id, slot) >>> 0;
        }
        const metadataMatches = previousDescriptor !== null && retainedOperationRevision !== null &&
            previousStateRevision === retainedOperationRevision;
        const retainedAssetState = !replayFailure && metadataMatches
            ? (entry && this.dspLive && this.dspBinding
                ? nativeState
                : (!nativeAttempted ? 1 : 0))
            : 0;
        const retainedStatus = retainedAssetState & 0xff;
        const previousStatus = previousState & 0xff;
        const residentRetained = retainedStatus >= 1 && retainedStatus <= 3 &&
            (Boolean(entry) || previousStatus >= 1 && previousStatus <= 3);
        if (residentRetained) {
            this.dspAssetStates.get(pluginId)?.set(slot, retainedAssetState);
            this.dspAssetStateRevisions.get(pluginId)?.set(slot, retainedOperationRevision);
        } else {
            this.pruneDspAssetSlot(pluginId, slot);
        }
        this.postAssetLoadRejected(pluginId, slot, reason, operationRevision, {
            residentRetained,
            retainedOperationRevision,
            retainedAssetState,
            retainedReplayEpoch,
            replayFailure
        }, replayEpoch);
    }

    dspAssetFootprintBytes(excludedPluginId = null, excludedSlot = null) {
        let total = 0;
        for (const [pluginId, slots] of this.dspAssetCache) {
            for (const [slot, asset] of slots) {
                if (pluginId === excludedPluginId && slot === excludedSlot) continue;
                const deferred = this.dspDeferredAssetStages.get(`${pluginId}:${slot}`);
                total += deferred?.candidate?.footprintBytes ?? asset.footprintBytes;
            }
        }
        for (const deferred of this.dspDeferredAssetStages.values()) {
            if (deferred.pluginId === excludedPluginId && deferred.slot === excludedSlot) continue;
            if (this.dspAssetCache.get(deferred.pluginId)?.has(deferred.slot)) continue;
            total += deferred.candidate.footprintBytes;
        }
        return total;
    }

    setPluginAsset(data) {
        const pluginId = data?.pluginId;
        const slot = data?.slot >>> 0;
        const payload = data?.payload;
        const operationRevision = this.normalizeAssetOperationRevision(data?.operationRevision);
        const replayEpoch = this.normalizeAssetReplayEpoch(data?.replayEpoch);
        const invalidRevision = data?.operationRevision !== undefined && operationRevision === null;
        const invalidReplayEpoch = data?.replayEpoch !== undefined && replayEpoch === null;
        const previousDescriptor = Number.isInteger(pluginId)
            ? this.dspAssetCache.get(pluginId)?.get(slot) || null
            : null;
        if (!Number.isInteger(pluginId) || !(payload instanceof ArrayBuffer) || payload.byteLength < 32) {
            console.warn('[dsp-wasm] Ignored an invalid plugin asset payload.');
            if (Number.isInteger(pluginId)) {
                this.rejectDspAssetCandidate(
                    pluginId, slot, 'invalid-asset', operationRevision, previousDescriptor,
                    replayEpoch !== null, false, replayEpoch
                );
            }
            return;
        }
        const header = new DataView(payload);
        const channels = header.getUint32(4, true);
        const frames = header.getUint32(8, true);
        const topology = header.getUint32(16, true);
        const pathCount = data.pathCount >>> 0;
        const processingChannels = data.processingChannels >>> 0;
        const footprintBytes = data.footprintBytes;
        const pathBytes = topology === 4 ? pathCount * 12 : 0;
        const expectedBytes = 32 + pathBytes + channels * frames * 4;
        if (header.getUint32(0, true) !== 0x31415445 || channels === 0 || channels > ET_DSP_MAX_CHANNELS ||
            frames === 0 || topology > 4 || expectedBytes !== payload.byteLength ||
            processingChannels === 0 || processingChannels > ET_DSP_MAX_CHANNELS ||
            !Number.isSafeInteger(footprintBytes) || footprintBytes < payload.byteLength ||
            invalidRevision || invalidReplayEpoch) {
            console.warn('[dsp-wasm] Rejected a malformed plugin asset payload.');
            this.rejectDspAssetCandidate(
                pluginId, slot, 'invalid-asset', operationRevision, previousDescriptor,
                replayEpoch !== null, false, replayEpoch
            );
            return;
        }
        const aggregateFootprint =
            this.dspAssetFootprintBytes(pluginId, slot) + footprintBytes;
        if (aggregateFootprint > ET_DSP_ASSET_AGGREGATE_BUDGET_BYTES) {
            console.warn('[dsp-wasm] Plugin asset load exceeds the module asset budget.');
            this.rejectDspAssetCandidate(
                pluginId, slot, 'module-budget', operationRevision, previousDescriptor,
                replayEpoch !== null, false, replayEpoch
            );
            return;
        }
        const candidate = {
            payload: new Uint8Array(payload),
            beginInfo: {
                channels,
                frames,
                topology,
                headBlock: data.headBlock >>> 0,
                rateDivider: data.rateDivider >>> 0,
                pathCount,
                inputCount: data.inputCount >>> 0,
                processingChannels,
                footprintBytes
            },
            formatTag: data.formatTag >>> 0,
            footprintBytes,
            operationRevision,
            replayEpoch
        };
        if (this.shouldDeferDspAssetStage(pluginId, slot, candidate, previousDescriptor)) {
            if (!this.requestFirReplacementDry(pluginId)) {
                this.rejectDspAssetCandidate(
                    pluginId, slot, 'transition', operationRevision, previousDescriptor,
                    false, false, replayEpoch
                );
                return;
            }
            this.dspDeferredAssetStages.set(`${pluginId}:${slot}`, {
                pluginId,
                slot,
                candidate
            });
            if (this.isDspAssetWakeEligible(pluginId)) {
                this.audioLevelMonitoring.isSleepMode = false;
                this.powerPolicy.pendingConfigWake = true;
            }
            return;
        }
        this.commitDspAssetCandidate(pluginId, slot, candidate);
    }

    shouldDeferDspAssetStage(pluginId, slot, candidate, previousDescriptor) {
        if (candidate.replayEpoch !== null || !previousDescriptor) return false;
        const plugin = this.plugins.find(entry => entry.id === pluginId);
        if (!FIR_CONVOLVER_PLUGIN_TYPES.has(plugin?.type)) return false;
        const previousState = this.dspAssetStates.get(pluginId)?.get(slot) ?? 0;
        const previousRevision = this.dspAssetStateRevisions.get(pluginId)?.get(slot);
        return (previousState & 0xff) === 3 &&
            previousRevision === previousDescriptor.operationRevision;
    }

    firReplacementDryParams(params) {
        if (!(params instanceof Float32Array) || params.length < 1) return null;
        const dryParams = params.slice();
        dryParams[0] = ET_DSP_FIR_REPLACEMENT_DRY_MODE;
        return dryParams;
    }

    requestFirReplacementDry(pluginId) {
        const plugin = this.plugins.find(entry => entry.id === pluginId);
        const entry = this.wasmInstances.get(pluginId);
        const dryParams = this.firReplacementDryParams(plugin?.wasmParams);
        if (!FIR_CONVOLVER_PLUGIN_TYPES.has(plugin?.type) ||
            !entry || !this.dspLive || !this.dspBinding ||
            !dryParams) return false;
        return this.dspBinding.instanceSetParams(
            entry.id,
            dryParams,
            plugin.wasmParamsHash >>> 0
        ) === 0;
    }

    restoreFirParams(pluginId) {
        const plugin = this.plugins.find(entry => entry.id === pluginId);
        const entry = this.wasmInstances.get(pluginId);
        if (!FIR_CONVOLVER_PLUGIN_TYPES.has(plugin?.type) ||
            !entry || !this.dspLive || !this.dspBinding ||
            !(plugin.wasmParams instanceof Float32Array)) return;
        this.dspBinding.instanceSetParams(
            entry.id,
            plugin.wasmParams,
            plugin.wasmParamsHash >>> 0
        );
    }

    commitDspAssetCandidate(pluginId, slot, candidate) {
        const stageResult = this.stageDspAsset(pluginId, slot, candidate);
        if (stageResult === false) return;
        let slots = this.dspAssetCache.get(pluginId);
        if (!slots) {
            slots = new Map();
            this.dspAssetCache.set(pluginId, slots);
        }
        slots.set(slot, candidate);
        if (stageResult === null) {
            this.postAssetState(
                pluginId,
                slot,
                1,
                candidate.operationRevision,
                true,
                candidate.replayEpoch
            );
        }
        if (this.isDspAssetWakeEligible(pluginId)) {
            this.audioLevelMonitoring.isSleepMode = false;
            this.powerPolicy.pendingConfigWake = true;
        }
        return true;
    }

    flushDeferredDspAssetStages() {
        for (const [key, deferred] of this.dspDeferredAssetStages) {
            const entry = this.wasmInstances.get(deferred.pluginId);
            if (!entry || !this.dspLive || !this.dspBinding ||
                (this.dspBinding.instanceAssetState(entry.id, deferred.slot) &
                    ET_DSP_FIR_REPLACEMENT_DRY_READY) === 0) continue;
            this.dspDeferredAssetStages.delete(key);
            try {
                this.commitDspAssetCandidate(deferred.pluginId, deferred.slot, deferred.candidate);
            } finally {
                this.restoreFirParams(deferred.pluginId);
            }
        }
    }

    stageDspAsset(pluginId, slot, candidate = null) {
        const replayFailure = candidate === null || candidate?.replayEpoch !== null;
        const previousDescriptor = this.dspAssetCache.get(pluginId)?.get(slot) || null;
        const cached = candidate || this.dspAssetCache.get(pluginId)?.get(slot);
        const entry = this.wasmInstances.get(pluginId);
        if (!cached || !entry || !this.dspLive || !this.dspBinding) {
            return cached ? null : false;
        }
        const previousMemory = this.bufferPool.combined?.buffer;
        let status;
        try {
            status = this.dspBinding.instanceSetAsset(
                entry.id,
                slot,
                cached.payload,
                cached.beginInfo,
                cached.formatTag
            );
        } finally {
            if (this.dspBinding.memory?.buffer !== previousMemory) this.adoptDspArena();
        }
        if (status !== 0) {
            console.warn(`[dsp-wasm] Asset staging failed for plugin ${pluginId}, slot ${slot}.`);
            this.rejectDspAssetCandidate(
                pluginId,
                slot,
                'capacity',
                cached.operationRevision,
                previousDescriptor,
                replayFailure,
                true,
                cached.replayEpoch
            );
            this.refreshDspPipelineForLatencyChange();
            return false;
        }
        this.postAssetState(pluginId, slot,
            this.dspBinding.instanceAssetState(entry.id, slot), cached.operationRevision, true,
            cached.replayEpoch);
        this.refreshDspPipelineForLatencyChange();
        return true;
    }

    restageDspAssets(pluginId) {
        const slots = this.dspAssetCache.get(pluginId);
        if (!slots) return;
        for (const slot of slots.keys()) this.stageDspAsset(pluginId, slot);
    }

    clearPluginAsset(data) {
        const pluginId = data?.pluginId;
        const slot = data?.slot >>> 0;
        const operationRevision = this.normalizeAssetOperationRevision(data?.operationRevision);
        const replayEpoch = this.normalizeAssetReplayEpoch(data?.replayEpoch);
        if (!Number.isInteger(pluginId) ||
            (data?.operationRevision !== undefined && operationRevision === null) ||
            (data?.replayEpoch !== undefined && replayEpoch === null)) {
            return;
        }
        const deferredKey = `${pluginId}:${slot}`;
        const replacementDeferred = this.dspDeferredAssetStages.delete(deferredKey);
        if (replacementDeferred) this.restoreFirParams(pluginId);
        const slots = this.dspAssetCache.get(pluginId);
        slots?.delete(slot);
        if (slots?.size === 0) this.dspAssetCache.delete(pluginId);
        const entry = this.wasmInstances.get(pluginId);
        if (entry && this.dspBinding) this.dspBinding.instanceAssetAbort(entry.id, slot);
        this.postAssetState(pluginId, slot, 0, operationRevision, false, replayEpoch);
        this.refreshDspPipelineForLatencyChange();
    }

    isDspAssetWakeEligible(pluginId) {
        if (this.masterBypass) return false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                sectionEnabled = Boolean(plugin.enabled);
            } else if (plugin.id === pluginId) {
                return Boolean(plugin.enabled) && sectionEnabled;
            }
        }
        return false;
    }

    pollDspAssetStates() {
        let preparing = false;
        let changed = false;
        if (this.dspLive && this.dspBinding) {
            for (const [pluginId, slots] of this.dspAssetCache) {
                const entry = this.wasmInstances.get(pluginId);
                if (!entry) continue;
                const wakeEligible = this.isDspAssetWakeEligible(pluginId);
                for (const [slot, cached] of slots) {
                    const state = this.dspBinding.instanceAssetState(entry.id, slot);
                    if (this.postAssetState(
                        pluginId,
                        slot,
                        state,
                        cached.operationRevision,
                        false,
                        cached.replayEpoch
                    )) changed = true;
                    if ((state & 0xff) === 2 && wakeEligible) preparing = true;
                }
            }
        }
        if (preparing) {
            this.audioLevelMonitoring.isSleepMode = false;
            this.powerPolicy.pendingConfigWake = true;
        }
        if (changed) this.refreshDspPipelineForLatencyChange();
        return preparing;
    }

    captureJsFallbackAdmissions() {
        const admissions = new Map();
        const costs = new Map();
        const sampleRate = this.dspSampleRate || globalThis.sampleRate;
        let usedSampleChannels = 0;
        let intrinsicUsedSampleChannels = 0;
        let requiredSampleChannels = 0;
        let capacityExceeded = false;
        let intrinsicCapacityExceeded = false;
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            const capacityLimit = jsFallbackCapacityLimit(plugin);
            if (capacityLimit === null) continue;
            const entry = this.dspLive ? this.wasmInstances.get(plugin.id) : null;
            if (!plugin.enabled || (insideSection && !sectionEnabled) || entry?.ready) {
                admissions.set(plugin.id, true);
                costs.set(plugin.id, 0);
                continue;
            }
            const cost = jsFallbackSampleChannelCost(
                plugin,
                sampleRate,
                this.outputChannelCount
            );
            costs.set(plugin.id, cost);
            requiredSampleChannels += cost;
            const intrinsicAdmitted = intrinsicUsedSampleChannels + cost <= capacityLimit;
            if (intrinsicAdmitted) {
                intrinsicUsedSampleChannels += cost;
            } else {
                intrinsicCapacityExceeded = true;
            }
            const branchLimit = this.jsFallbackSampleChannelBudget < capacityLimit
                ? this.jsFallbackSampleChannelBudget
                : capacityLimit;
            const admitted = usedSampleChannels + cost <= branchLimit;
            admissions.set(plugin.id, admitted);
            if (admitted) {
                usedSampleChannels += cost;
            } else {
                capacityExceeded = true;
            }
        }
        this.jsFallbackSampleChannelCosts = costs;
        this.jsFallbackRequiredSampleChannels = requiredSampleChannels;
        this.jsFallbackAdmittedSampleChannels = usedSampleChannels;
        this.jsFallbackCapacityExceeded = capacityExceeded;
        this.jsFallbackIntrinsicCapacityExceeded = intrinsicCapacityExceeded;
        return admissions;
    }

    publishJsFallbackBudgetState(requestId) {
        this.refreshJsFallbackAdmissions();
        this.port.postMessage({
            type: 'jsFallbackBudgetState',
            requestId,
            budgetSampleChannels: this.jsFallbackSampleChannelBudget,
            requiredSampleChannels: this.jsFallbackRequiredSampleChannels,
            admittedSampleChannels: this.jsFallbackAdmittedSampleChannels,
            capacityExceeded: this.jsFallbackCapacityExceeded,
            intrinsicCapacityExceeded: this.jsFallbackIntrinsicCapacityExceeded,
            generation: this.dspExecutionGeneration
        });
    }

    configureJsFallbackBudget(data) {
        const requested = data?.budgetSampleChannels;
        if (!Number.isFinite(requested) || requested < 0) return;
        this.jsFallbackSampleChannelBudget = requested < JS_FALLBACK_SAMPLE_CHANNEL_BUDGET
            ? requested
            : JS_FALLBACK_SAMPLE_CHANNEL_BUDGET;
        ++this.dspExecutionGeneration;
        this.refreshDspPipeline();
        this.publishWasmOnlyExecutionStates(true);
        if (Number.isInteger(data.requestId)) {
            this.publishJsFallbackBudgetState(data.requestId);
        }
    }

    refreshJsFallbackAdmissions() {
        const admissions = this.captureJsFallbackAdmissions();
        const changed = !this.executionAdmissionSnapshotsEqual(
            this.jsFallbackAdmissions,
            admissions
        );
        this.jsFallbackAdmissions = admissions;
        return changed;
    }

    executionAdmissionSnapshotsEqual(left, right) {
        if (!(left instanceof Map) || left.size !== right.size) return false;
        for (const [pluginId, admitted] of right) {
            if (left.get(pluginId) !== admitted) return false;
        }
        return true;
    }

    isJsFallbackAdmitted(plugin) {
        return this.jsFallbackAdmissions.get(plugin.id) !== false;
    }

    captureExecutionLatencySnapshot() {
        const snapshot = new Map();
        const sampleRate = this.dspSampleRate || globalThis.sampleRate;
        for (const plugin of this.plugins) {
            if (this.isPluginExecutionBypassed(plugin)) continue;
            const entry = this.dspLive && this.dspBinding
                ? this.wasmInstances.get(plugin.id)
                : null;
            if (entry?.ready) {
                try {
                    snapshot.set(plugin.id, this.dspBinding.instanceLatency(entry.id) >>> 0);
                } catch (error) {
                    this.reportDspFailure(`latency:${plugin.id}`, error?.message || String(error));
                }
                continue;
            }
            const fallbackLatency = resolveJsFallbackLatency(plugin.type, sampleRate);
            if (fallbackLatency > 0) snapshot.set(plugin.id, fallbackLatency);
        }
        return snapshot;
    }

    executionLatencySnapshotsEqual(left, right) {
        if (!(left instanceof Map) || left.size !== right.size) return false;
        for (const [pluginId, samples] of right) {
            if (left.get(pluginId) !== samples) return false;
        }
        return true;
    }

    refreshDspPipelineForLatencyChange() {
        this.refreshJsFallbackAdmissions();
        const snapshot = this.captureExecutionLatencySnapshot();
        if (this.executionLatencySnapshotsEqual(this.executionLatencySnapshot, snapshot)) {
            return false;
        }
        if (this.dspPipelineReady) {
            this.refreshDspPipeline(snapshot);
        } else {
            this.rebuildDspLatencyPlan(snapshot);
        }
        return true;
    }

    refreshDspPipeline(latencySnapshot = null) {
        if (!(latencySnapshot instanceof Map)) {
            this.refreshJsFallbackAdmissions();
            latencySnapshot = this.captureExecutionLatencySnapshot();
        }
        this.dspPipelineReady = false;
        this.dspPipelinePluginCount = 0;
        this.rebuildDspLatencyPlan(latencySnapshot);
        if (!this.dspLive || !this.dspBinding) {
            return;
        }

        if (this.masterBypass) return;

        const nodes = [];
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            if (!plugin.enabled || (insideSection && !sectionEnabled)) continue;
            if (pluginExecutionUnsupportedReason(
                plugin,
                this.dspSampleRate,
                this.outputChannelCount
            )) return;

            const selection = workletRoutingSelection(
                plugin.channel,
                this.outputChannelCount
            );
            if (!selection) continue;

            const entry = this.wasmInstances.get(plugin.id);
            if (!entry?.ready) return;
            nodes.push({
                instanceId: entry.id,
                inputBus: plugin.inputBus,
                outputBus: plugin.outputBus,
                channel: plugin.channel
            });
        }

        try {
            const status = this.dspBinding.pipelineConfigure(
                encodeWorkletDspPipeline(nodes, this.outputChannelCount)
            );
            if (status !== 0) {
                this.reportDspFailure('pipeline-configure', `status ${status}`);
                return;
            }
            this.adoptDspArena();
            this.dspPipelinePluginCount = nodes.length;
            this.dspPipelineReady = this.spectrumTapRoute.size === 0;
            this.publishDspPipelineLatency(this.dspBinding.pipelineLatency(), true);
        } catch (error) {
            this.reportDspFailure('pipeline-configure', error?.message || String(error));
        }
    }

    publishDspPipelineLatency(samples, compensated = false) {
        const normalized = !this.masterBypass && Number.isInteger(samples) && samples > 0
            ? samples
            : 0;
        const normalizedCompensated = !this.masterBypass && compensated === true;
        if (normalized === this.dspPipelineLatencySamples &&
            normalizedCompensated === this.dspPipelineLatencyCompensated) return;
        this.dspPipelineLatencySamples = normalized;
        this.dspPipelineLatencyCompensated = normalizedCompensated;
        this.port.postMessage({
            type: 'dspLatency',
            samples: normalized,
            sampleRate: this.dspSampleRate || globalThis.sampleRate,
            compensated: normalizedCompensated
        });
    }

    resetDspLatencyPlan() {
        this.dspLatencyPlan = null;
    }

    rebuildDspLatencyPlan(latencySnapshot = null) {
        if (!(latencySnapshot instanceof Map)) {
            this.refreshJsFallbackAdmissions();
            latencySnapshot = this.captureExecutionLatencySnapshot();
        }
        this.resetDspLatencyPlan();
        this.executionLatencySnapshot = latencySnapshot;
        if (this.masterBypass) {
            this.publishDspPipelineLatency(0, false);
            return;
        }

        const channelCount = Number.isInteger(this.outputChannelCount) &&
            this.outputChannelCount > 0 && this.outputChannelCount <= ET_DSP_MAX_CHANNELS
            ? this.outputChannelCount
            : 0;
        if (channelCount === 0) {
            this.publishDspPipelineLatency(0, false);
            return;
        }

        const latency = Array.from({ length: 5 }, () => new Uint32Array(channelCount));
        const hasContent = Array.from({ length: 5 }, () => new Uint8Array(channelCount));
        hasContent[0].fill(1);
        const nodeActions = new Map();
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            if (!plugin.enabled || (insideSection && !sectionEnabled)) continue;
            const executionBypassed = this.isPluginExecutionBypassed(plugin);

            const inputBus = plugin.inputBus;
            const outputBus = plugin.outputBus;
            if (!Number.isInteger(inputBus) || inputBus < 0 || inputBus >= latency.length ||
                !Number.isInteger(outputBus) || outputBus < 0 || outputBus >= latency.length) {
                continue;
            }
            const selection = workletRoutingSelection(
                plugin.channel,
                channelCount,
                executionBypassed
            );
            if (!selection) continue;
            const pluginLatency = executionBypassed
                ? 0
                : (latencySnapshot.get(plugin.id) ?? 0);

            const targets = new Uint8Array(channelCount);
            const delays = new Uint32Array(channelCount);
            let maximumDelay = 0;
            const firstChannel = selection.firstChannel;
            const endChannel = firstChannel + selection.requiredChannels;
            for (let channel = firstChannel; channel < endChannel; channel++) {
                const inputLatency = hasContent[inputBus][channel] ? latency[inputBus][channel] : 0;
                const incomingLatency = inputLatency + pluginLatency;
                if (!Number.isSafeInteger(incomingLatency) || incomingLatency > 0xffffffff) {
                    console.error('DSP pipeline latency exceeds the supported sample range.');
                    this.publishDspPipelineLatency(0, false);
                    return;
                }
                if (inputBus === outputBus) {
                    latency[outputBus][channel] = incomingLatency;
                    hasContent[outputBus][channel] = 1;
                    continue;
                }
                if (!hasContent[outputBus][channel]) {
                    latency[outputBus][channel] = incomingLatency;
                    hasContent[outputBus][channel] = 1;
                    continue;
                }

                const destinationLatency = latency[outputBus][channel];
                if (destinationLatency < incomingLatency) {
                    const delay = incomingLatency - destinationLatency;
                    targets[channel] = 1;
                    delays[channel] = delay;
                    maximumDelay = delay > maximumDelay ? delay : maximumDelay;
                    latency[outputBus][channel] = incomingLatency;
                } else if (incomingLatency < destinationLatency) {
                    const delay = destinationLatency - incomingLatency;
                    targets[channel] = 2;
                    delays[channel] = delay;
                    maximumDelay = delay > maximumDelay ? delay : maximumDelay;
                }
            }
            if (maximumDelay > 0) {
                nodeActions.set(plugin.id, {
                    targets,
                    delays,
                    delayLine: new WorkletSampleDelayLine(channelCount, maximumDelay)
                });
            }
        }

        let totalSamples = 0;
        for (let channel = 0; channel < channelCount; channel++) {
            if (hasContent[0][channel] && latency[0][channel] > totalSamples) {
                totalSamples = latency[0][channel];
            }
        }
        const outputDelays = new Uint32Array(channelCount);
        let maximumOutputDelay = 0;
        for (let channel = 0; channel < channelCount; channel++) {
            outputDelays[channel] = totalSamples - (hasContent[0][channel] ? latency[0][channel] : 0);
            maximumOutputDelay = outputDelays[channel] > maximumOutputDelay
                ? outputDelays[channel]
                : maximumOutputDelay;
        }
        this.dspLatencyPlan = {
            nodeActions,
            outputDelays,
            outputDelayLine: maximumOutputDelay > 0
                ? new WorkletSampleDelayLine(channelCount, maximumOutputDelay)
                : null,
            totalSamples
        };
        this.publishDspPipelineLatency(totalSamples, this.dspLive || totalSamples > 0);
    }

    applyDspMergeCompensation(pluginId, processMode, pairStartChannel, singleChannelIndex,
        outputBuffer, incomingBuffer, channelCount, frameCount) {
        const action = this.dspLatencyPlan?.nodeActions.get(pluginId);
        if (!action) return;

        let firstChannel = 0;
        let routedChannels = channelCount;
        if (processMode === 'pair') {
            firstChannel = pairStartChannel;
            routedChannels = 2;
        } else if (processMode === 'single') {
            firstChannel = singleChannelIndex;
            routedChannels = 1;
        }
        for (let offset = 0; offset < routedChannels; offset++) {
            const channel = firstChannel + offset;
            const target = action.targets[channel];
            if (target === 1) {
                action.delayLine.processChannel(
                    outputBuffer,
                    channel * frameCount,
                    frameCount,
                    channel,
                    action.delays[channel]
                );
            } else if (target === 2) {
                action.delayLine.processChannel(
                    incomingBuffer,
                    offset * frameCount,
                    frameCount,
                    channel,
                    action.delays[channel]
                );
            }
        }
    }

    applyDspFinalOutputCompensation(mainBusBuffer, channelCount, frameCount) {
        const plan = this.dspLatencyPlan;
        if (!plan?.outputDelayLine) return;
        for (let channel = 0; channel < channelCount; channel++) {
            const delay = plan.outputDelays[channel];
            if (delay > 0) {
                plan.outputDelayLine.processChannel(
                    mainBusBuffer,
                    channel * frameCount,
                    frameCount,
                    channel,
                    delay
                );
            }
        }
    }

    setOutputDelay(samples) {
        const normalized = Number.isInteger(samples) && samples > 0 && samples <= 0xffffffff
            ? samples
            : 0;
        this.outputDelaySamples = normalized;
        this.outputDelayLine = normalized > 0
            ? new WorkletSampleDelayLine(this.outputChannelCount, normalized)
            : null;
    }

    applyOutputDelay(output, channelCount, frameCount) {
        if (!this.outputDelayLine || this.outputDelaySamples === 0) return;
        const channels = output.length < channelCount ? output.length : channelCount;
        for (let channel = 0; channel < channels; channel++) {
            this.outputDelayLine.processChannel(
                output[channel],
                0,
                frameCount,
                channel,
                this.outputDelaySamples
            );
        }
    }

    restoreDspPipelineInput(combinedBuffer, totalSize, input, channelCount, frameCount) {
        combinedBuffer.fill(0, 0, totalSize);
        const channelsToCopy = input.length < channelCount ? input.length : channelCount;
        for (let channel = 0; channel < channelsToCopy; channel++) {
            const source = input[channel];
            const offset = channel * frameCount;
            for (let frame = 0; frame < frameCount; frame++) {
                combinedBuffer[offset + frame] = source[frame];
            }
        }
    }

    snapshotDspHybridInput(processingBuffer, sampleCount) {
        for (let index = 0; index < sampleCount; index++) {
            this.dspHybridInputBackup[index] = processingBuffer[index];
        }
    }

    restoreDspHybridInput(processingBuffer, sampleCount) {
        for (let index = 0; index < sampleCount; index++) {
            processingBuffer[index] = this.dspHybridInputBackup[index];
        }
    }

    isDspArenaViewCurrent(view, expectedMemory, sampleCount) {
        if (!this.dspLive || !view || view.byteLength < sampleCount * Float32Array.BYTES_PER_ELEMENT) {
            return false;
        }
        if (!expectedMemory) return true;
        return this.dspBinding?.memory?.buffer === expectedMemory && view.buffer === expectedMemory;
    }

    bypassCurrentBlock(input, output, outputChannelCount, frameCount) {
        const channelsToWrite = output.length < outputChannelCount ? output.length : outputChannelCount;
        for (let channel = 0; channel < output.length; channel++) {
            const target = output[channel];
            if (channel < channelsToWrite && channel < input.length) {
                const source = input[channel];
                for (let frame = 0; frame < frameCount; frame++) {
                    target[frame] = source[frame];
                }
            } else {
                target.fill(0);
            }
        }
    }

    tryDspPipeline(combinedBuffer, totalSize, input, channelCount, frameCount, time) {
        if (!this.dspPipelineReady || !this.dspLive || channelCount > ET_DSP_MAX_CHANNELS ||
            frameCount !== ET_DSP_MAX_FRAMES) {
            return ET_DSP_PIPELINE_FALLBACK;
        }

        const expectedMemory = this.dspBinding.memory?.buffer;
        if (!this.isDspArenaViewCurrent(combinedBuffer, expectedMemory, totalSize)) {
            if (this.dspLive) this.failDspEngine('runtime', 'arena invalid before pipeline processing');
            return ET_DSP_PIPELINE_ARENA_INVALID;
        }

        let status = 0;
        let processError = null;
        try {
            status = this.dspBinding.pipelineProcess(channelCount, frameCount, time, false);
        } catch (error) {
            processError = error;
        }

        if (!this.isDspArenaViewCurrent(combinedBuffer, expectedMemory, totalSize)) {
            if (this.dspLive) this.failDspEngine('runtime', 'arena invalid during pipeline processing');
            return ET_DSP_PIPELINE_ARENA_INVALID;
        }
        if (status === 0 && !processError) {
            this.pollTubeSimulatorRuntimeEvents();
            return ET_DSP_PIPELINE_PROCESSED;
        }

        this.restoreDspPipelineInput(combinedBuffer, totalSize, input, channelCount, frameCount);
        this.dspPipelineReady = false;
        if (processError) {
            this.reportDspFailure('pipeline-process', processError?.message || String(processError));
        } else {
            this.reportDspFailure('pipeline-process', `status ${status}`);
        }
        return ET_DSP_PIPELINE_FALLBACK;
    }

    finishDspPipelineBlock(output, combinedBuffer, outputChannelCount, blockSize, sampleRate, time) {
        let insideSection = false;
        let sectionEnabled = true;
        for (const plugin of this.plugins) {
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                sectionEnabled = Boolean(plugin.enabled);
                continue;
            }
            if (!plugin.enabled || (insideSection && !sectionEnabled)) continue;
            let context = this.pluginContexts.get(plugin.id);
            if (!context) {
                context = {};
                this.pluginContexts.set(plugin.id, context);
            }
            if (context.reportedSampleRate !== sampleRate) {
                context.reportedSampleRate = sampleRate;
                this.port.postMessage({ pluginId: plugin.id, sampleRate });
            }
        }

        const channelsToWrite = output.length < outputChannelCount ? output.length : outputChannelCount;
        for (let channel = 0; channel < output.length; channel++) output[channel].fill(0);
        for (let channel = 0; channel < channelsToWrite; channel++) {
            const offset = channel * blockSize;
            const target = output[channel];
            for (let frame = 0; frame < blockSize; frame++) {
                target[frame] = combinedBuffer[offset + frame];
            }
        }
        this.applyOutputDelay(output, outputChannelCount, blockSize);

        const threshold = 2 * this.audioLevelMonitoring._silenceThresholdAmplitude;
        let hasOutputSignal = false;
        for (let channel = 0; channel < channelsToWrite && !hasOutputSignal; channel++) {
            const data = output[channel];
            let minimum = Infinity;
            let maximum = -Infinity;
            for (let index = 0; index < data.length; index++) {
                const value = data[index];
                if (value < minimum) minimum = value;
                if (value > maximum) maximum = value;
                if (maximum - minimum > threshold) {
                    hasOutputSignal = true;
                    break;
                }
            }
        }
        if (hasOutputSignal) this.audioLevelMonitoring.lastOutputActiveTime = time;
        this.pumpDspTelemetry();
    }

    runtimeFallback(plugin, error, stage = 'runtime') {
        this.dspPipelineReady = false;
        const entry = this.wasmInstances.get(plugin.id);
        if (entry) {
            entry.ready = false;
            this.wasmInstances.delete(plugin.id);
            this.dspPendingInstanceDestroy.push(entry.id);
        }
        const failures = (this.dspRuntimeFailures.get(plugin.type) || 0) + 1;
        this.dspRuntimeFailures.set(plugin.type, failures);
        if (requiresWasmExecution(plugin)) {
            this.dspExecutionRuntimeFallbacks.add(plugin.id);
        }
        this.reportDspFailure(`${stage}:${plugin.id}`, error);
        if (failures >= 3) {
            this.dspFailedTypes.add(plugin.type);
            this.dspEnabledTypes.delete(plugin.type);
            for (const candidate of this.plugins) {
                if (candidate.type !== plugin.type) continue;
                const candidateEntry = this.wasmInstances.get(candidate.id);
                if (candidateEntry) {
                    candidateEntry.ready = false;
                    this.wasmInstances.delete(candidate.id);
                    this.dspPendingInstanceDestroy.push(candidateEntry.id);
                }
            }
        }
        ++this.dspExecutionGeneration;
        this.rebuildDspLatencyPlan();
        this.publishWasmOnlyExecutionStates(true);
        this.port.postMessage({ type: 'dspCleanupNeeded' });
    }

    pumpDspTelemetry() {
        if (!this.dspLive || this.dspPacketPool.length === 0 ||
            (this.powerPolicy.enabled && !this.powerPolicy.uiTelemetryEnabled)) return;
        const packetView = this.dspPacketPool.pop();
        try {
            const bytes = this.dspBinding.telemetryRead(packetView);
            if (this.powerPolicy.enabled) this.powerPolicy.counters.telemetryReads++;
            if (bytes > 0) {
                const packet = packetView.buffer;
                this.port.postMessage({
                    type: 'dspTelemetry',
                    packet,
                    bytes,
                    droppedFrames: this.dspBinding.lastTelemetryDroppedFrames >>> 0
                }, [packet]);
                if (this.powerPolicy.enabled) this.powerPolicy.counters.telemetryPosts++;
            } else {
                this.dspPacketPool.push(packetView);
            }
        } catch (error) {
            this.dspPacketPool.push(packetView);
            this.failDspEngine('runtime', error?.message || String(error));
        }
    }

    registerPluginProcessor(pluginType, processorFunction) {
        try {
            // Compile function once during registration
            const compiledFunction = new Function('context', 'data', 'parameters', 'time',
                // Use strict mode for potentially better optimization and error checking
                `'use strict';
                 // Avoid 'with' statement as it's deprecated and hurts performance/optimization
                 // Instead, necessary context properties should be explicitly passed or accessed.
                 // Assuming 'context' holds necessary methods/properties directly.
                 try {
                     // The processor function string is directly embedded here
                     ${processorFunction}
                     // Ensure the function returns the processed data or modifies it in place
                     return data; // Or return modified data if the plugin creates a new buffer
                 } catch (error) {
                     console.error('Error in processor function (${pluginType}):', error);
                     // Return original data on error to prevent chain breakage
                     return data;
                 }`
            );
            this.pluginProcessors.set(pluginType, compiledFunction);
            this.processorRegistrationErrors.delete(pluginType);
            this.reportedMissingProcessors.delete(pluginType);
            // console.log(`Registered processor for type: ${pluginType}`);
        } catch (error) {
             console.error(`Failed to compile processor function for ${pluginType}:`, error);
             this.pluginProcessors.delete(pluginType);
             this.processorRegistrationErrors.add(pluginType);
        }
    }

    normalizePluginConfig(pluginConfig, previousPlugin = null) {
        const params = pluginConfig?.parameters ?? {};
        return {
            ...pluginConfig,
            inputBus: params.inputBus ?? pluginConfig?.inputBus ?? 0,
            outputBus: params.outputBus ?? pluginConfig?.outputBus ?? 0,
            channel: params.channel ?? pluginConfig?.channel ?? null,
            executionCapabilities: pluginConfig?.executionCapabilities ??
                previousPlugin?.executionCapabilities ?? null
        };
    }

    updatePlugin(pluginConfig) {
        if (!pluginConfig) return;
        ++this.dspExecutionGeneration;
        const index = this.plugins.findIndex(p => p.id === pluginConfig.id);
        if (index !== -1) {
            const normalizedPlugin = this.normalizePluginConfig(
                pluginConfig,
                this.plugins[index]
            );
            this.dspPipelineReady = false;
            try {
                this.plugins[index] = normalizedPlugin;
                this.reconcileDspPluginSafely(normalizedPlugin);
            } finally {
                this.refreshDspPipeline();
                this.publishWasmOnlyExecutionStates();
            }

            // console.log(`Updated plugin: ${pluginConfig.id}`);
        } else {
            // console.warn(`Plugin with id ${pluginConfig.id} not found for updating.`);
            // Optionally add the plugin if it's meant to be dynamic
            // this.plugins.push(pluginConfig);
            // this.updatePlugin(pluginConfig); // Re-run to normalize properties
        }
    }

    updatePlugins(pluginConfigs) {
        ++this.dspExecutionGeneration;
        const normalizedPlugins = pluginConfigs.map(p => this.normalizePluginConfig(p));
        this.dspPipelineReady = false;
        try {
            this.plugins = normalizedPlugins;
            const activeIds = new Set(normalizedPlugins.map(plugin => plugin.id));
            for (const ids of [this.spectrumTapRoute, this.spectrumTaps, this.spectrumTapState]) {
                for (const id of ids.keys()) {
                    if (!activeIds.has(id)) ids.delete(id);
                }
            }
            this.reconcileDspInstances();
        } finally {
            this.refreshDspPipeline();
            this.publishWasmOnlyExecutionStates();
        }
        // Clear contexts for plugins that might have been removed?
        // Or handle context cleanup based on removed IDs.
        // For simplicity, we keep existing contexts; they won't be used if plugin is gone.
        // console.log(`Updated plugin chain (${this.plugins.length} plugins)`);
    }

    batchUpdatePlugins(pluginConfigs) {
        for (const pluginConfig of pluginConfigs) {
            this.updatePlugin(pluginConfig);
        }
    }

    wasmOnlyExecutionState(plugin, engineStopped = false) {
        if (engineStopped) return { state: 'bypassed', reason: 'engineStopped' };
        const capacityExceeded = !this.isJsFallbackAdmitted(plugin);
        const entry = this.dspLive ? this.wasmInstances.get(plugin.id) : null;
        if (capacityExceeded) {
            if (entry?.ready) return { state: 'active', reason: null };
            return this.dspExecutionInitializing
                ? { state: 'pending', reason: null }
                : { state: 'bypassed', reason: 'jsFallbackCapacityExceeded' };
        }
        if (this.dspExecutionInitializing) return { state: 'pending', reason: null };
        if (this.dspFailedTypes.has(plugin.type)) {
            return { state: 'bypassed', reason: 'runtimeFallback' };
        }
        const executionUnsupportedReason = pluginExecutionUnsupportedReason(
            plugin,
            this.dspSampleRate,
            this.outputChannelCount
        );
        if (executionUnsupportedReason) {
            return { state: 'bypassed', reason: executionUnsupportedReason };
        }
        if (this.dspExecutionRuntimeFallbacks.has(plugin.id)) {
            return { state: 'bypassed', reason: 'runtimeFallback' };
        }
        if (!this.dspEnableTypesReceived) return { state: 'pending', reason: null };
        if (!this.dspEnabledTypes.has(plugin.type)) {
            return { state: 'bypassed', reason: 'rolloutDisabled' };
        }
        if (!this.dspLive || !this.wasmKernels.has(plugin.type)) {
            return { state: 'bypassed', reason: 'wasmUnavailable' };
        }
        return entry?.ready
            ? { state: 'active', reason: null }
            : { state: 'pending', reason: null };
    }

    isPluginExecutionBypassed(plugin) {
        if (!this.isJsFallbackAdmitted(plugin)) {
            const entry = this.dspLive ? this.wasmInstances.get(plugin.id) : null;
            if (!entry?.ready) return true;
        }
        return requiresWasmExecution(plugin)
            ? this.wasmOnlyExecutionState(plugin).state !== 'active'
            : pluginExecutionUnsupportedReason(
                plugin,
                this.dspSampleRate,
                this.outputChannelCount
            ) !== null;
    }

    publishWasmOnlyExecutionStates(force = false, engineStopped = false) {
        const activeIds = new Set();
        for (const plugin of this.plugins) {
            const reportsOptionalDspState = plugin?.wasmParams instanceof Float32Array;
            const reportsCapacityState = plugin?.executionCapabilities?.jsFallbackCapacity &&
                typeof plugin.executionCapabilities.jsFallbackCapacity === 'object';
            if (!requiresWasmExecution(plugin) && !reportsOptionalDspState &&
                !reportsCapacityState) continue;
            activeIds.add(plugin.id);
            const status = this.wasmOnlyExecutionState(plugin, engineStopped);
            const key = `${status.state}:${status.reason || ''}:${this.dspExecutionGeneration}`;
            if (!force && this.dspExecutionStates.get(plugin.id) === key) continue;
            this.dspExecutionStates.set(plugin.id, key);
            this.port.postMessage({
                type: 'dspExecutionState',
                pluginId: plugin.id,
                pluginType: plugin.type,
                state: status.state,
                reason: status.reason,
                jsFallbackSampleChannels: this.jsFallbackSampleChannelCosts.get(plugin.id) || 0,
                sampleRate: this.dspSampleRate || globalThis.sampleRate,
                generation: this.dspExecutionGeneration
            });
        }
        for (const pluginId of this.dspExecutionStates.keys()) {
            if (!activeIds.has(pluginId)) this.dspExecutionStates.delete(pluginId);
        }
    }

    addPlugin(pluginConfig, index) {
        if (!pluginConfig) return;
        ++this.dspExecutionGeneration;
        const existingIndex = this.plugins.findIndex(p => p.id === pluginConfig.id);
        const normalizedPlugin = this.normalizePluginConfig(
            pluginConfig,
            existingIndex === -1 ? null : this.plugins[existingIndex]
        );
        this.dspPipelineReady = false;
        if (existingIndex !== -1) {
            try {
                this.plugins[existingIndex] = normalizedPlugin;
                this.reconcileDspPluginSafely(normalizedPlugin);
            } finally {
                this.refreshDspPipeline();
                this.publishWasmOnlyExecutionStates();
            }
            return;
        }

        const insertIndex = Number.isInteger(index)
            ? (index < 0 ? 0 : (index > this.plugins.length ? this.plugins.length : index))
            : this.plugins.length;
        try {
            this.plugins.splice(insertIndex, 0, normalizedPlugin);
            this.reconcileDspPluginSafely(normalizedPlugin);
        } finally {
            this.refreshDspPipeline();
            this.publishWasmOnlyExecutionStates();
        }
    }

    removePlugin(pluginId) {
        const index = this.plugins.findIndex(p => p.id === pluginId);
        if (index === -1) return;
        ++this.dspExecutionGeneration;
        this.dspPipelineReady = false;
        try {
            this.plugins.splice(index, 1);
            this.pluginContexts.delete(pluginId);
            this.spectrumTapRoute.delete(pluginId);
            this.spectrumTaps.delete(pluginId);
            this.spectrumTapState.delete(pluginId);
            this.dspAssetCache.delete(pluginId);
            this.dspAssetStates.delete(pluginId);
            this.dspAssetStateRevisions.delete(pluginId);
            this.dspAssetStateReplayEpochs.delete(pluginId);
            for (const [key, deferred] of this.dspDeferredAssetStages) {
                if (deferred.pluginId === pluginId) this.dspDeferredAssetStages.delete(key);
            }
            try {
                this.destroyDspInstance(pluginId);
            } catch (error) {
                this.failDspEngine('reconcile', error?.message || String(error));
            }
        } finally {
            this.refreshDspPipeline();
            this.publishWasmOnlyExecutionStates();
        }
    }

    reorderPlugin(fromIndex, toIndex) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
        if (fromIndex < 0 || fromIndex >= this.plugins.length) return;
        const targetIndex = toIndex < 0 ? 0 : (toIndex >= this.plugins.length ? this.plugins.length - 1 : toIndex);
        this.dspPipelineReady = false;
        try {
            const [plugin] = this.plugins.splice(fromIndex, 1);
            this.plugins.splice(targetIndex, 0, plugin);
        } finally {
            this.refreshDspPipeline();
        }
    }

    _addDenormalNoise(audio, channelCount, frameCount, frameOrigin) {
        const first = (frameOrigin & 1) === 0
            ? ET_DENORMAL_NOISE_AMPLITUDE
            : -ET_DENORMAL_NOISE_AMPLITUDE;
        for (let channel = 0; channel < channelCount; channel++) {
            const offset = channel * frameCount;
            let noise = first;
            for (let frame = 0; frame < frameCount; frame++) {
                audio[offset + frame] += noise;
                noise = -noise;
            }
        }
    }

    _prepareDenormalProtectedInput(audio, channelCount, frameCount, frameOrigin, addNoise) {
        const first = (frameOrigin & 1) === 0
            ? ET_DENORMAL_NOISE_AMPLITUDE
            : -ET_DENORMAL_NOISE_AMPLITUDE;
        for (let channel = 0; channel < channelCount; channel++) {
            const offset = channel * frameCount;
            let noise = first;
            for (let frame = 0; frame < frameCount; frame++) {
                const sample = offset + frame;
                const input = audio[sample];
                const canonical = input >= -ET_DENORMAL_NOISE_OUTPUT_LIMIT &&
                    input <= ET_DENORMAL_NOISE_OUTPUT_LIMIT ? 0 : input;
                audio[sample] = addNoise ? canonical + noise : canonical;
                noise = -noise;
            }
        }
    }

    _measurePowerWithDcBlock(channels, previousX, previousY, blockSize, frameOrigin, result) {
        const power = this.powerPolicy;
        const channelCount = channels.length < previousX.length ? channels.length : previousX.length;
        let maximumChannelPower = 0;
        let maximumPeakPower = 0;
        let nonFiniteSeen = false;
        const r = power.dcBlockerR;
        for (let channel = 0; channel < channelCount; channel++) {
            const channelData = channels[channel];
            if (!channelData) continue;
            let xPrev = previousX[channel];
            let yPrev = previousY[channel];
            let channelSumSquares = 0;
            const frames = channelData.length < blockSize ? channelData.length : blockSize;
            let noise = (frameOrigin & 1) === 0
                ? ET_DENORMAL_NOISE_AMPLITUDE
                : -ET_DENORMAL_NOISE_AMPLITUDE;
            for (let frame = 0; frame < frames; frame++) {
                const x = channelData[frame];
                if (!Number.isFinite(x)) nonFiniteSeen = true;
                const finiteX = Number.isFinite(x) ? x : 0;
                const detectorX = finiteX + noise;
                let y = detectorX - xPrev + r * yPrev;
                if (!Number.isFinite(y)) {
                    nonFiniteSeen = true;
                    y = 0;
                }
                xPrev = detectorX;
                yPrev = y;
                const square = y * y;
                channelSumSquares += square;
                const rawSquare = finiteX * finiteX;
                if (rawSquare > maximumPeakPower) maximumPeakPower = rawSquare;
                noise = -noise;
            }
            previousX[channel] = xPrev;
            previousY[channel] = yPrev;
            const channelPower = frames > 0 ? channelSumSquares / frames : 0;
            if (channelPower > maximumChannelPower) maximumChannelPower = channelPower;
        }
        result[0] = maximumChannelPower;
        result[1] = maximumPeakPower;
        result[2] = nonFiniteSeen ? 1 : 0;
        return maximumChannelPower;
    }

    _copyPowerInput(input, output) {
        const channelsToCopy = input.length < output.length ? input.length : output.length;
        for (let channel = 0; channel < channelsToCopy; channel++) output[channel].set(input[channel]);
        for (let channel = channelsToCopy; channel < output.length; channel++) output[channel].fill(0);
    }

    _zeroPowerOutput(output) {
        for (let channel = 0; channel < output.length; channel++) output[channel].fill(0);
    }

    _beginPowerRender() {
        const power = this.powerPolicy;
        power.renderSequence++;
        power.counters.renderQuanta++;
        power.counters.detectorQuanta++;
    }

    _publishPowerObservation(inputActive, outputActive, eventReason = null) {
        const power = this.powerPolicy;
        const edgeChanged = power.lastReportedInputActive !== inputActive ||
            power.lastReportedOutputActive !== outputActive;
        const observationRequestId = power.pendingObservationRequestId;
        const heartbeatDue = this.currentFrame - power.lastHeartbeatFrame >= globalThis.sampleRate;
        if (!edgeChanged && observationRequestId === null && !heartbeatDue && !eventReason) return;

        const type = heartbeatDue && !edgeChanged && observationRequestId === null && !eventReason
            ? 'powerHeartbeat'
            : 'powerObservation';
        this.port.postMessage({
            type,
            observationRequestId,
            reason: eventReason,
            state: power.state,
            processingDirective: power.processingDirective,
            inputActive,
            outputActive,
            inputPower: power.inputPowerEwma,
            outputPower: power.outputPowerEwma,
            workletGraphGeneration: power.workletGraphGeneration,
            topologyRevision: power.topologyRevision,
            commandId: power.commandId,
            skipEpoch: power.skipEpoch,
            renderSequence: power.renderSequence,
            skippedFrameCount: power.skippedFrameCount,
            automaticMonitoringArm: { ...power.arm },
            monitoringFastWakeEligible: power.monitoringFastWakeEligible,
            monitoringFastWakeBlockerReason: power.monitoringFastWakeBlockerReason,
            counters: { ...power.counters }
        });
        power.lastReportedInputActive = inputActive;
        power.lastReportedOutputActive = outputActive;
        power.pendingObservationRequestId = null;
        if (heartbeatDue) power.lastHeartbeatFrame = this.currentFrame;
    }

    _finishPowerRender(
        inputPower,
        outputPower,
        blockSize,
        eventReason = null,
        fullDspRenderCompleted = true
    ) {
        const power = this.powerPolicy;
        const alpha = power.ewmaAlpha;
        const inputFinite = Number.isFinite(inputPower);
        const outputFinite = Number.isFinite(outputPower);
        if (inputFinite) {
            const detectorPower = inputPower + ET_DENORMAL_NOISE_POWER;
            power.inputPowerEwma += alpha * (detectorPower - power.inputPowerEwma);
        }
        if (outputFinite) {
            const detectorPower = outputPower + ET_DENORMAL_NOISE_POWER;
            power.outputPowerEwma += alpha * (detectorPower - power.outputPowerEwma);
        }
        const inputActive = !inputFinite || power.inputPowerEwma > power.silenceThresholdPower;
        const outputActive = !outputFinite || power.outputPowerEwma > power.silenceThresholdPower;

        if (inputActive || outputActive) {
            power.silentSinceFrame = null;
            power.monitoringPreparationPending = false;
        } else if (power.silentSinceFrame === null) {
            power.silentSinceFrame = this.currentFrame - blockSize;
        }

        const skipTransportRendered = power.processingDirective === 'force-monitoring' ||
            power.processingDirective === 'zero-output-transport' ||
            power.processingDirective === 'bypass-transport';
        if (power.pendingFirstRenderCommandId !== null &&
            (fullDspRenderCompleted || skipTransportRendered)) {
            this.port.postMessage({
                type: 'powerFirstRender',
                commandId: power.pendingFirstRenderCommandId,
                skipEpoch: power.skipEpoch,
                state: power.state,
                processingDirective: power.processingDirective,
                inputActive,
                outputActive,
                workletGraphGeneration: power.workletGraphGeneration,
                topologyRevision: power.topologyRevision,
                renderSequence: power.renderSequence,
                skippedFrameCount: power.skippedFrameCount
            });
            power.pendingFirstRenderCommandId = null;
        }

        if (fullDspRenderCompleted && power.arm.state === 'armed' &&
            power.processingDirective === 'allow-automatic') {
            power.inputSilentFrames = inputActive ? 0 : power.inputSilentFrames + blockSize;
            power.outputSilentFrames = outputActive ? 0 : power.outputSilentFrames + blockSize;
            if (!inputActive && !outputActive &&
                power.inputSilentFrames >= power.silenceFramesRequired &&
                power.outputSilentFrames >= power.silenceFramesRequired) {
                if (power.monitoringPreparationRequired &&
                    !power.monitoringPreparationPending) {
                    let prepared = false;
                    try {
                        prepared = this._prepareAutomaticMonitoringState();
                    } catch (_) {
                        prepared = false;
                    }
                    if (prepared) {
                        // The next full-process quantum recreates and warms any
                        // reset JS/WASM state before monitoring can begin.
                        power.monitoringPreparationPending = true;
                        eventReason = 'automatic-preparation';
                    } else {
                        power.monitoringFastWakeEligible = false;
                        power.monitoringFastWakeBlockerReason =
                            'temporal-preparation-runtime-failed';
                        power.counters.monitoringRuntimeFailures++;
                        power.processingDirective = 'full-process';
                        this._disarmAutomaticMonitoring();
                        eventReason = 'temporal-preparation-runtime-failed';
                    }
                } else {
                    power.monitoringPreparationPending = false;
                    power.state = 'monitoring';
                    power.processingDirective = 'allow-automatic';
                    power.arm.state = 'consumed';
                    power.lastConsumedSkipEpoch = power.arm.skipEpoch;
                    power.skippedFrameCount = 0;
                    power.skippedFrameRemainder = 0;
                    power.skipSampleRate = globalThis.sampleRate;
                    eventReason = 'automatic-silence';
                }
            }
        }
        if (eventReason === null && power.pendingPowerEventReason !== null) {
            eventReason = power.pendingPowerEventReason;
            power.pendingPowerEventReason = null;
        } else if (power.pendingConfigWake && eventReason === null) {
            power.pendingConfigWake = false;
            eventReason = 'config-wake';
        }
        if (fullDspRenderCompleted && power.state === 'active' &&
            power.processingDirective === 'full-process') {
            power.activeFullProcessSettled = true;
        }
        this._publishPowerObservation(inputActive, outputActive, eventReason);
    }

    _finishPowerFullProcess(input, output, inputPower, blockSize, forceDryOutput, runtime = 'js') {
        const power = this.powerPolicy;
        power.counters.fullProcessQuanta++;
        if (runtime === 'wasm') power.counters.fullWasmProcessQuanta++;
        else if (runtime === 'js') power.counters.fullJsProcessQuanta++;
        if (forceDryOutput) this._copyPowerInput(input, output);
        const outputPower = this._measurePowerWithDcBlock(
            output,
            power.outputDcX,
            power.outputDcY,
            blockSize,
            this.currentFrame - blockSize,
            power.outputDetectorResult
        );
        const safeOutputPower = power.outputDetectorResult[2] === 1
            ? Number.POSITIVE_INFINITY
            : outputPower;
        this._finishPowerRender(inputPower, safeOutputPower, blockSize);
    }

    clearAudioProcessingOverload() {
        this.processingOverloadCreditMs = this.processingOverloadHeadroomMs;
        if (!this.processingOverloadActive) return;
        this.processingOverloadActive = false;
        this.port.postMessage({ type: 'audioProcessingOverload', active: false });
    }

    setAudioProcessingOverloadMonitoring(enabled, delaySeconds = 0, headroomMs = 0) {
        this.processingOverloadMonitoringEnabled = enabled;
        this.processingOverloadHeadroomMs = Number.isFinite(headroomMs) && headroomMs > 0
            ? Math.min(
                AUDIO_PROCESSING_OVERLOAD_MAX_HEADROOM_MS,
                Math.max(AUDIO_PROCESSING_OVERLOAD_MIN_HEADROOM_MS, headroomMs)
            )
            : AUDIO_PROCESSING_OVERLOAD_DEFAULT_HEADROOM_MS;
        this.processingOverloadMonitoringStartFrame = enabled
            ? this.currentFrame + Math.ceil(
                globalThis.sampleRate * (
                    Number.isFinite(delaySeconds) && delaySeconds > 0 ? delaySeconds : 0
                )
            )
            : Number.POSITIVE_INFINITY;
        this.processingOverloadLastReportFrame = Number.NEGATIVE_INFINITY;
        this.clearAudioProcessingOverload();
    }

    isAudioProcessingOverloadMonitoringActive() {
        return this.processingOverloadMonitoringEnabled &&
            this.currentFrame >= this.processingOverloadMonitoringStartFrame;
    }

    audioProcessingClockNow() {
        const performanceRef = globalThis.performance;
        return typeof performanceRef?.now === 'function'
            ? performanceRef.now()
            : Date.now();
    }

    finishPipelineCpuMeasurement(startedAt, blockSize) {
        const sampleRate = globalThis.sampleRate;
        if (!Number.isFinite(startedAt) || !Number.isInteger(blockSize) || blockSize <= 0 ||
            !Number.isFinite(sampleRate) || sampleRate <= 0) return;

        const elapsedMs = this.audioProcessingClockNow() - startedAt;
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;

        this.pipelineCpuFrames += blockSize;
        this.pipelineCpuElapsedMs += elapsedMs;

        if (this.pipelineCpuFrames < sampleRate) return;

        const measuredAudioMs = this.pipelineCpuFrames * 1000 / sampleRate;
        this.port.postMessage({
            type: 'pipelineCpuUsage',
            average: this.pipelineCpuElapsedMs * 100 / measuredAudioMs
        });
        this.pipelineCpuFrames = 0;
        this.pipelineCpuElapsedMs = 0;
    }

    finishAudioProcessingDeadline(startedAt, blockSize, processedPlugin) {
        if (!this.isAudioProcessingOverloadMonitoringActive() ||
            !processedPlugin || this.masterBypass ||
            !Number.isFinite(startedAt)) {
            this.clearAudioProcessingOverload();
            return;
        }

        const elapsedMs = this.audioProcessingClockNow() - startedAt;
        const quantumMs = blockSize * 1000 / globalThis.sampleRate;
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;

        // Leaky bucket: a quantum finishing early refills the buffer headroom it
        // borrows from, a quantum running long drains it. Both ends are clamped
        // so recovery after a long stall stays bounded.
        const headroomMs = this.processingOverloadHeadroomMs;
        const creditMs = Math.min(
            headroomMs,
            Math.max(-headroomMs, this.processingOverloadCreditMs + quantumMs - elapsedMs)
        );
        this.processingOverloadCreditMs = creditMs;

        if (creditMs >= headroomMs) {
            // Headroom fully restored: the pipeline is comfortably in budget.
            if (this.processingOverloadActive) {
                this.processingOverloadActive = false;
                this.port.postMessage({ type: 'audioProcessingOverload', active: false });
            }
            return;
        }
        if (creditMs > 0) return;

        const heartbeatFrames = globalThis.sampleRate *
            AUDIO_PROCESSING_OVERLOAD_HEARTBEAT_SECONDS;
        if (!this.processingOverloadActive ||
            this.currentFrame - this.processingOverloadLastReportFrame >= heartbeatFrames) {
            this.processingOverloadActive = true;
            this.processingOverloadLastReportFrame = this.currentFrame;
            this.port.postMessage({ type: 'audioProcessingOverload', active: true });
        }
    }

    process(inputs, outputs, parameters) {
        const inputBlockSize = inputs?.[0]?.[0]?.length;
        const outputBlockSize = outputs?.[0]?.[0]?.length;
        const blockSize = inputBlockSize || outputBlockSize || 128;
        const startedAt = this.audioProcessingClockNow();
        const keepAlive = this.processPipeline(inputs, outputs, parameters);
        this.finishPipelineCpuMeasurement(startedAt, blockSize);
        return keepAlive;
    }

    // Optimized pipeline processing method
    processPipeline(inputs, outputs, parameters) {
        this.flushDeferredDspAssetStages();
        this.pollDspAssetStates();
        const input = inputs[0];
        const output = outputs[0];

        // --- 1. Basic Checks & Early Exit ---
        // Check if input/output streams exist and have data
        if (!input || !output || !input[0] || input[0].length === 0) {
            // If input is invalid/empty, zero out output to ensure silence and return.
            if (output && output.length > 0) {
                for (let i = 0; i < output.length; i++) {
                    // Ensure channel exists before filling
                    output[i]?.fill(0);
                }
            }
            if (this.powerPolicy.enabled) {
                const power = this.powerPolicy;
                const emptyBlockSize = output?.[0]?.length || 128;
                this._beginPowerRender();
                this.currentFrame += emptyBlockSize;
                const emptyInputReason = power.emptyInputActive ? null : 'empty-input';
                power.emptyInputActive = true;
                this._finishPowerRender(0, 0, emptyBlockSize, emptyInputReason, false);
            }
            // Keep processor alive, even with no input, as input might appear later.
            this.clearAudioProcessingOverload();
            return true;
        }

        // --- 2. Cache Frequently Accessed Properties & State ---
        const blockSize = input[0].length; // Critical: Block size from actual input buffer
        const currentFrame = this.currentFrame;
        const sampleRate = globalThis.sampleRate; // Standard way to get sample rate in AudioWorklet
        const audioLevelMonitoring = this.audioLevelMonitoring;
        const plugins = this.plugins; // Array of plugin configurations
        const pluginProcessors = this.pluginProcessors; // Map of compiled processor functions
        const pluginContexts = this.pluginContexts; // Map for plugin state/context
        const port = this.port; // For messaging back to the main thread
        const powerEnabled = this.powerPolicy.enabled;
        const masterBypass = this.masterBypass && !powerEnabled;
        let isSleepMode = powerEnabled ? false : audioLevelMonitoring.isSleepMode;
        // Get configured output channels, default to 2 if not set
        const outputChannelCount = this.outputChannelCount;
        // Use the cached amplitude threshold
        const silenceThresholdAmplitude = audioLevelMonitoring._silenceThresholdAmplitude;

        let powerInputPower = 0;
        if (powerEnabled) {
            const power = this.powerPolicy;
            power.emptyInputActive = false;
            this._beginPowerRender();
            powerInputPower = this._measurePowerWithDcBlock(
                input,
                power.inputDcX,
                power.inputDcY,
                blockSize,
                currentFrame,
                power.inputDetectorResult
            );
            const inputDetectorNonFinite = power.inputDetectorResult[2] === 1;
            if (inputDetectorNonFinite) powerInputPower = Number.POSITIVE_INFINITY;
            const directive = power.processingDirective;
            if (power.state === 'monitoring' || directive === 'force-monitoring') {
                const finiteGainWake = inputDetectorNonFinite ||
                    power.inputDetectorResult[1] > power.wakeFloorPower;
                const anyInputWake = power.wakeOnAnyInput &&
                    power.inputDetectorResult[1] > 0;
                const forceMonitoring = directive === 'force-monitoring';
                const inputActivity = finiteGainWake || anyInputWake;
                if (forceMonitoring) {
                    this._copyPowerInput(input, output);
                    power.counters.monitoringQuanta++;
                    power.skippedFrameCount += blockSize;
                    this.currentFrame += blockSize;
                    this._finishPowerRender(
                        powerInputPower,
                        powerInputPower,
                        blockSize,
                        inputActivity ? 'host-temporal-resume-required' : null
                    );
                    this.clearAudioProcessingOverload();
                    return true;
                }
                const wake = power.monitoringFastWakeEligible && inputActivity;
                if (!wake) {
                    this._copyPowerInput(input, output);
                    power.counters.monitoringQuanta++;
                    power.skippedFrameCount += blockSize;
                    this.currentFrame += blockSize;
                    this._finishPowerRender(powerInputPower, powerInputPower, blockSize);
                    this.clearAudioProcessingOverload();
                    return true;
                }
                const staticWakeIdentityValid = power.monitoringStaticCoverageValid &&
                    power.arm.state === 'consumed' &&
                    power.arm.skipEpoch === power.lastConsumedSkipEpoch &&
                    power.skipEpoch === power.lastConsumedSkipEpoch &&
                    power.skipSampleRate === globalThis.sampleRate;
                if (!staticWakeIdentityValid) {
                    power.state = 'active';
                    power.processingDirective = 'full-process';
                    power.monitoringFastWakeEligible = false;
                    power.monitoringFastWakeBlockerReason = 'temporal-preparation-runtime-failed';
                    power.counters.monitoringRuntimeFailures++;
                    this._disarmAutomaticMonitoring();
                    this._resetPowerSilenceWindow();
                    power.pendingConfigWake = false;
                    power.pendingPowerEventReason = 'temporal-preparation-runtime-failed';
                } else {
                    power.state = 'active';
                    power.processingDirective = 'full-process';
                    this._disarmAutomaticMonitoring();
                    this._resetPowerSilenceWindow();
                    power.pendingConfigWake = false;
                    power.pendingPowerEventReason = 'signal-wake';
                }
            } else if (directive === 'zero-output-transport') {
                this._zeroPowerOutput(output);
                power.counters.zeroOutputQuanta++;
                power.skippedFrameCount += blockSize;
                this.currentFrame += blockSize;
                this._finishPowerRender(powerInputPower, 0, blockSize);
                this.clearAudioProcessingOverload();
                return true;
            } else if (directive === 'bypass-transport') {
                this._copyPowerInput(input, output);
                power.counters.bypassQuanta++;
                power.skippedFrameCount += blockSize;
                this.currentFrame += blockSize;
                this._finishPowerRender(powerInputPower, powerInputPower, blockSize);
                this.clearAudioProcessingOverload();
                return true;
            }
        }

        // Evaluated after the power state machine so every full processing
        // path remains dry while master bypass is engaged, including the
        // automatic-monitoring arm and a monitoring-to-active wake block.
        const forceDryOutput = powerEnabled && this.masterBypass;

        if (this.dspLive) {
            if (this.dspBinding.checkMemoryBuffer()) {
                this.failDspEngine('runtime', 'memory.buffer identity changed');
            }
        }


        // --- 3. Calculate Current Time ---
        const time = currentFrame / sampleRate; // Time in seconds

        // --- 4. Input Level Monitoring & Sleep Mode Update ---
        // We treat a channel as silent only if its AC component (peak-to-peak
        // range with the DC offset removed) is below 2 * threshold. This
        // matters because some plugins (e.g. Exciter with a non-zero bias)
        // emit a constant DC component for a silent input, which would
        // otherwise be classified as "signal" and forever prevent sleep mode.
        let hasInputSignal = false;
        if (!powerEnabled) {
        const inputChannelsToCheck = Math.min(input.length, outputChannelCount);
        const acThreshold = 2 * silenceThresholdAmplitude;
        for (let channel = 0; channel < inputChannelsToCheck; channel++) {
            const channelData = input[channel];
            let cmin = Infinity, cmax = -Infinity;
            for (let i = 0; i < channelData.length; i++) {
                const v = channelData[i];
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
                if (cmax - cmin > acThreshold) break; // early exit
            }
            if (cmax - cmin > acThreshold) {
                hasInputSignal = true;
                break;
            }
        }

        if (hasInputSignal) {
            audioLevelMonitoring.lastInputActiveTime = time;
            if (isSleepMode) {
                // Exit sleep mode if needed
                isSleepMode = false;
                audioLevelMonitoring.isSleepMode = false;
                port.postMessage({ type: 'sleepModeChanged', isSleepMode: false });
                 console.log(`Input signal detected at ${time}s, exiting sleep mode.`);
            }
        } else {
            // Only check for entering sleep mode if currently NOT sleeping
            if (!isSleepMode) {
                const inputSilenceDuration = time - audioLevelMonitoring.lastInputActiveTime;
                const outputSilenceDuration = time - audioLevelMonitoring.lastOutputActiveTime;
                // Initialize lastUserActivityTime on the first run if it hasn't been set
                if (audioLevelMonitoring.lastUserActivityTime === 0) {
                    audioLevelMonitoring.lastUserActivityTime = time;
                }
                const userInactivityDuration = time - audioLevelMonitoring.lastUserActivityTime;
                const silenceDurationThreshold = audioLevelMonitoring.SILENCE_DURATION;

                // Check if all conditions for sleep are met
                if (inputSilenceDuration >= silenceDurationThreshold &&
                    outputSilenceDuration >= silenceDurationThreshold &&
                    userInactivityDuration >= silenceDurationThreshold)
                {
                    isSleepMode = true;
                    audioLevelMonitoring.isSleepMode = true;
                    port.postMessage({ type: 'sleepModeChanged', isSleepMode: true });
                    console.log(`Entering sleep mode at ${time}s due to inactivity.`);
                }
            }
        }
        }

        // --- 5. Master Bypass or Sleep Mode Handling ---
        if (masterBypass || isSleepMode) {
            const numInputChannels = input.length;
            const numOutputChannels = output.length;
            const channelsToCopy = Math.min(numInputChannels, numOutputChannels);

            // Copy input to output efficiently for matching channels
            for (let channel = 0; channel < channelsToCopy; channel++) {
                // Use Float32Array.prototype.set for fast block copy
                output[channel].set(input[channel]);
            }
            // Zero out any remaining output channels if output has more channels than input
            for (let channel = channelsToCopy; channel < numOutputChannels; channel++) {
                 output[channel].fill(0);
            }

            // IMPORTANT: Still need to advance the frame counter even when bypassed/sleeping
            this.currentFrame += blockSize;
            this.clearAudioProcessingOverload();
            return true; // Keep processor alive
        }

        const audioProcessingStartedAt = !this.masterBypass &&
            this.isAudioProcessingOverloadMonitoringActive()
            ? this.audioProcessingClockNow()
            : null;

        // --- 6. Update Processor State ---
        // this.blockSize = blockSize; // Update instance property if it's used elsewhere
        this.currentFrame += blockSize; // Advance frame counter


        // --- 7. Prepare Combined Multichannel Buffer (Optimized with Buffer Pool) ---
        const totalSize = blockSize * outputChannelCount;
        let combinedBuffer;
        
        // Use pre-allocated buffer pool for better performance
        if (outputChannelCount <= ET_DSP_MAX_CHANNELS && blockSize === ET_DSP_MAX_FRAMES) {
            // Use pre-allocated buffer from pool
            combinedBuffer = this.bufferPool.combined;
            // Zero out only the portion we'll use
            combinedBuffer.fill(0, 0, totalSize);
        } else {
            // Fallback to dynamic allocation for non-standard sizes
            if (!this.combinedBuffer || this.combinedBuffer.length !== totalSize) {
                this.combinedBuffer = new Float32Array(totalSize);
                console.log(`Reallocated combinedBuffer: ${outputChannelCount} channels, size ${totalSize}`);
            }
            combinedBuffer = this.combinedBuffer;
        }

        // Copy input data to the combined buffer. Channels beyond the configured
        // output width are intentionally dropped; missing channels remain silent.
        const inputChannelsToUse = Math.min(input.length, outputChannelCount);
        for (let i = 0; i < inputChannelsToUse; i++) {
            combinedBuffer.set(input[i], i * blockSize);
        }
        // Zero out remaining channels in the combined buffer if necessary
        if (outputChannelCount > inputChannelsToUse) {
            for (let i = inputChannelsToUse; i < outputChannelCount; i++) {
                // Calculate start and end indices for fill
                const offset = i * blockSize;
                // Use fill for efficiency
                combinedBuffer.fill(0, offset, offset + blockSize);
            }
        }

        // Admission is reset for each full-processing quantum. Every consumer
        // below reads the same ordered decision map, including a later
        // same-quantum WASM failure that rebuilds it before JavaScript fallback.
        if (this.refreshJsFallbackAdmissions()) {
            this.refreshDspPipelineForLatencyChange();
            this.publishWasmOnlyExecutionStates();
        }

        const dspPipelineResult = this.tryDspPipeline(
            combinedBuffer,
            totalSize,
            input,
            outputChannelCount,
            blockSize,
            time
        );
        if (dspPipelineResult === ET_DSP_PIPELINE_PROCESSED) {
            this.finishDspPipelineBlock(
                output,
                combinedBuffer,
                outputChannelCount,
                blockSize,
                sampleRate,
                time
            );
            if (powerEnabled) {
                this._finishPowerFullProcess(
                    input,
                    output,
                    powerInputPower,
                    blockSize,
                    forceDryOutput,
                    'wasm'
                );
            }
            this.finishAudioProcessingDeadline(
                audioProcessingStartedAt,
                blockSize,
                this.dspPipelinePluginCount > 0
            );
            return true;
        }
        if (dspPipelineResult === ET_DSP_PIPELINE_ARENA_INVALID) {
            this.bypassCurrentBlock(input, output, outputChannelCount, blockSize);
            if (powerEnabled) {
                this._finishPowerFullProcess(
                    input,
                    output,
                    powerInputPower,
                    blockSize,
                    forceDryOutput,
                    'none'
                );
            }
            this.clearAudioProcessingOverload();
            return true;
        }

        // --- 8. Bus Buffer Management ---
        const busBuffers = this.busBuffers; // Local reference
        busBuffers.clear(); // Clear previous buffers

        // Determine which buses are actively used by enabled plugins
        const usedBuses = this.usedBuses;
        usedBuses.clear();
        usedBuses.add(0); // Main bus (0) is implicitly used for input/output
        let activeSectionEnabled = true; // Tracks if the current section is active
        let insideSection = false; // Tracks if currently inside a section definition

        for (const plugin of plugins) {
            // Handle section start/end markers
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled; // Section is active if the plugin is enabled
                continue; // Section plugins don't process audio or use buses
            }

            // Skip processing logic for disabled plugins or plugins within a disabled section
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                continue;
            }

            // Add the input and output buses of this active plugin to the set
            // Access normalized properties directly
            usedBuses.add(plugin.inputBus);
            usedBuses.add(plugin.outputBus);
        }

        // Set the main bus (0) buffer to our prepared combinedBuffer
        busBuffers.set(0, combinedBuffer);

        // Allocate and zero-fill buffers for other used buses (Optimized with Buffer Pool)
        for (const busIndex of usedBuses) {
            if (busIndex !== 0) {
                let busBuffer;
                
                // Use pre-allocated buffer from pool if available
                if (outputChannelCount <= ET_DSP_MAX_CHANNELS && blockSize === ET_DSP_MAX_FRAMES && this.bufferPool.buses.has(busIndex)) {
                    busBuffer = this.bufferPool.buses.get(busIndex);
                    // Zero out only the portion we'll use
                    busBuffer.fill(0, 0, totalSize);
                } else {
                    // Fallback to dynamic allocation for non-standard sizes or bus indices
                    busBuffer = new Float32Array(totalSize);
                }
                
                busBuffers.set(busIndex, busBuffer);
            }
        }

        // --- 9. Process Audio Through Plugins ---
        // Reset section state for the processing loop
        activeSectionEnabled = true;
        insideSection = false;
        let lastMessageTime = this.lastMessageTime; // Cache for message throttling
        const messageQueue = this.messageQueue; // Cache message queue
        const MESSAGE_INTERVAL = this.MESSAGE_INTERVAL; // Cache interval
        let processedPlugin = false;
        const tapsActive = this.spectrumTaps.size !== 0;

        for (const plugin of plugins) {
            // Handle section start/end
            if (plugin.type === 'SectionPlugin') {
                insideSection = true;
                activeSectionEnabled = plugin.enabled;
                continue;
            }

            // Skip disabled or section-disabled plugins
            if (!plugin.enabled || (insideSection && !activeSectionEnabled)) {
                continue;
            }
            let executionBypassed = this.isPluginExecutionBypassed(plugin);

            // Get the compiled processor function for this plugin type
            // Unsupported execution modes still use the normal channel and bus
            // result path below so pass-through routing remains explicit.
            const processor = executionBypassed ? null : pluginProcessors.get(plugin.type);
            const wasmEntry = executionBypassed
                ? null
                : (this.dspLive ? this.wasmInstances.get(plugin.id) : null);
            if (!executionBypassed && !processor && !wasmEntry?.ready) {
                if (!this.reportedMissingProcessors.has(plugin.type)) {
                    this.reportedMissingProcessors.add(plugin.type);
                    console.warn(`Processor function not found for type: ${plugin.type}`);
                    port.postMessage({
                        type: 'processorMissing',
                        pluginId: plugin.id,
                        pluginType: plugin.type
                    });
                }
                for (let ch = 0; ch < output.length; ch++) {
                    output[ch].fill(0);
                }
                this.lastMessageTime = lastMessageTime;
                this.clearAudioProcessingOverload();
                return true;
            }

            // Get or initialize plugin state/context
            let pluginContext = pluginContexts.get(plugin.id);
            if (!pluginContext) {
                pluginContext = {}; // Initialize empty context
                pluginContexts.set(plugin.id, pluginContext);
            }
            if (pluginContext.reportedSampleRate !== sampleRate) {
                pluginContext.reportedSampleRate = sampleRate;
                port.postMessage({ pluginId: plugin.id, sampleRate });
            }
            // Determine input and output buses for this plugin
            const inputBus = plugin.inputBus; // Use normalized property
            const outputBus = plugin.outputBus; // Use normalized property

            // Get the corresponding buffers
            const inputBuffer = busBuffers.get(inputBus);
            const outputBuffer = busBuffers.get(outputBus);

            // Skip if buses are invalid (should not happen if usedBuses logic is correct)
            if (!inputBuffer || !outputBuffer) {
                 console.error(`Invalid bus index for plugin ${plugin.id}: inputBus=${inputBus}, outputBus=${outputBus}`);
                 continue;
            }

            // --- 9a. Channel Processing Logic ---
            const targetChannelSpec = plugin.channel; // Use normalized property (null, "A", "L", "R", "34", etc.)
            let processingBuffer; // The buffer data passed TO the plugin processor
            let resultTargetBuffer; // The buffer where the result should ultimately be written (usually outputBuffer)
            let numProcessingChannels = 0; // How many channels the plugin processor function expects
            let tempBuffer;       // Temporary buffer if needed for isolation/copying
            let processMode = 'skip'; // 'all', 'pair', 'single', 'skip'
            let pairStartChannel = -1; // Starting channel index (0-based) for pairs
            let singleChannelIndex = -1;// Channel index (0-based) for single channel

            // Use the same normalized selection as capability checks and full-pipeline routing.
            const channelSelection = workletRoutingSelection(
                targetChannelSpec,
                outputChannelCount,
                executionBypassed
            );
            if (!channelSelection) {
                // The specifier does not name any channel layout. Leave processMode
                // at 'skip' so the plugin is bypassed instead of throwing out of
                // process(), which would permanently disable this processor.
                const invalidChannelKey = `${plugin.id}:${targetChannelSpec}`;
                if (!this.reportedInvalidChannels.has(invalidChannelKey)) {
                    this.reportedInvalidChannels.add(invalidChannelKey);
                    console.warn(`Invalid channel specifier "${targetChannelSpec}" for plugin ${plugin.id}`);
                }
            } else {
                if (channelSelection.mode === 'all') {
                    processMode = 'all';
                    numProcessingChannels = channelSelection.requiredChannels;
                } else if (channelSelection.mode === 'stereo-pair') {
                    processMode = 'pair';
                    pairStartChannel = channelSelection.firstChannel;
                    numProcessingChannels = channelSelection.requiredChannels;
                } else {
                    processMode = 'single';
                    singleChannelIndex = channelSelection.firstChannel;
                    numProcessingChannels = 1;
                }
            }

            if (processMode === 'skip') continue; // Skip plugin if channel spec is invalid for current config

            // --- 9b. Prepare Buffers for Plugin Execution ---
             const requiresCopy = (inputBus !== outputBus) || (processMode === 'pair') || (processMode === 'single');

            if (processMode === 'all') {
                if (requiresCopy) {
                    // Use Buffer Pool for all-channel processing when possible (Optimized)
                    if (outputChannelCount <= ET_DSP_MAX_CHANNELS && blockSize === ET_DSP_MAX_FRAMES) {
                        // Use pre-allocated buffer from pool
                        tempBuffer = this.bufferPool.allChannels;
                        const totalSize = blockSize * outputChannelCount;
                        // Copy input data to the buffer
                        tempBuffer.set(inputBuffer.subarray(0, totalSize));
                    } else {
                        // Fallback to dynamic allocation for non-standard sizes
                        tempBuffer = new Float32Array(inputBuffer); // Full copy
                    }
                    processingBuffer = tempBuffer;
                } else {
                    // Process directly in the input/output buffer (which are the same)
                    processingBuffer = inputBuffer; // Reference, no copy
                }
                resultTargetBuffer = outputBuffer; // Result goes directly to the output bus buffer
            } else if (processMode === 'pair') {
                // Use pre-allocated stereo buffer for pair processing (Optimized)
                if (blockSize === 128) {
                    tempBuffer = this.bufferPool.stereo;
                    // Zero out the buffer before use
                    tempBuffer.fill(0);
                } else {
                    // Fallback for non-standard block sizes
                    const stereoSize = blockSize * 2;
                    tempBuffer = new Float32Array(stereoSize);
                }
                // Copy the selected pair from inputBuffer to the temporary stereo buffer efficiently
                tempBuffer.set(inputBuffer.subarray(pairStartChannel * blockSize, (pairStartChannel + 1) * blockSize), 0); // Ch 1
                tempBuffer.set(inputBuffer.subarray((pairStartChannel + 1) * blockSize, (pairStartChannel + 2) * blockSize), blockSize); // Ch 2
                processingBuffer = tempBuffer; // Plugin processes this temp buffer
                // Result will be written back from tempBuffer to the correct place in outputBuffer later
            } else if (processMode === 'single') {
                // Use pre-allocated mono buffer for single channel processing (Optimized)
                if (blockSize === 128) {
                    tempBuffer = this.bufferPool.mono;
                    // Zero out the buffer before use
                    tempBuffer.fill(0);
                } else {
                    // Fallback for non-standard block sizes
                    tempBuffer = new Float32Array(blockSize);
                }
                // Copy the selected channel from inputBuffer to the temporary mono buffer
                tempBuffer.set(inputBuffer.subarray(singleChannelIndex * blockSize, (singleChannelIndex + 1) * blockSize));
                processingBuffer = tempBuffer; // Plugin processes this temp buffer
                 // Result will be written back from tempBuffer later
            }

            const spectrumTap = tapsActive && this.spectrumTaps.has(plugin.id)
                ? this.spectrumTapState.get(plugin.id)
                : null;
            if (spectrumTap?.inputBuffer) {
                const scale = 1 / numProcessingChannels;
                let position = spectrumTap.position;
                for (let frame = 0; frame < blockSize; frame++) {
                    let sum = processingBuffer[frame];
                    for (let channel = 1; channel < numProcessingChannels; channel++) {
                        sum += processingBuffer[channel * blockSize + frame];
                    }
                    spectrumTap.inputBuffer[position] = sum * scale;
                    position = (position + 1) & 4095;
                }
            }

            // --- 9d. Execute Plugin Processor Function ---
            if (!executionBypassed) processedPlugin = true;
            let result = processingBuffer;
            let processedInWasm = false;
            if (!executionBypassed && wasmEntry?.ready && this.dspLive &&
                outputChannelCount <= ET_DSP_MAX_CHANNELS && blockSize === ET_DSP_MAX_FRAMES) {
                const sampleCount = numProcessingChannels * blockSize;
                const expectedMemory = this.dspBinding.memory?.buffer;
                if (!this.isDspArenaViewCurrent(processingBuffer, expectedMemory, sampleCount)) {
                    if (this.dspLive) this.failDspEngine('runtime', 'arena invalid before instance processing');
                    this.bypassCurrentBlock(input, output, outputChannelCount, blockSize);
                    if (powerEnabled) {
                        this._finishPowerFullProcess(
                            input,
                            output,
                            powerInputPower,
                            blockSize,
                            forceDryOutput,
                            'none'
                        );
                    }
                    this.clearAudioProcessingOverload();
                    return true;
                }
                const audioPtr = this.dspBinding.pointerForArenaView(processingBuffer);
                if (audioPtr !== null) {
                    this.snapshotDspHybridInput(processingBuffer, sampleCount);
                    let status = 0;
                    let processError = null;
                    try {
                        status = this.dspBinding.instanceProcess(
                            wasmEntry.id,
                            audioPtr,
                            numProcessingChannels,
                            blockSize,
                            time
                        );
                    } catch (error) {
                        processError = error;
                    }
                    if (!this.isDspArenaViewCurrent(processingBuffer, expectedMemory, sampleCount)) {
                        if (this.dspLive) this.failDspEngine('runtime', 'arena invalid during instance processing');
                        this.bypassCurrentBlock(input, output, outputChannelCount, blockSize);
                        if (powerEnabled) {
                            this._finishPowerFullProcess(
                                input,
                                output,
                                powerInputPower,
                                blockSize,
                                forceDryOutput,
                                'none'
                            );
                        }
                        this.clearAudioProcessingOverload();
                        return true;
                    }
                    if (status === 0 && !processError) {
                        processedInWasm = true;
                        this.postTubeSimulatorRuntimeEvent(plugin, wasmEntry);
                    } else {
                        this.restoreDspHybridInput(processingBuffer, sampleCount);
                        this.runtimeFallback(
                            plugin,
                            processError ? (processError?.message || String(processError)) : `process returned ${status}`
                        );
                        executionBypassed = this.isPluginExecutionBypassed(plugin);
                    }
                }
            }

            if (!executionBypassed && !requiresWasmExecution(plugin) &&
                !processedInWasm && processor) {
                // Preserve legacy clone-and-store semantics only when JavaScript runs.
                const context = { ...pluginContext, port };
                const processingParams = {
                    ...(plugin.parameters ?? {}),
                    id: plugin.id,
                    channelCount: numProcessingChannels,
                    blockSize,
                    sampleRate
                };
                try {
                    const addNoiseAfter = plugin.type === 'DynamicSaturationPlugin';
                    // Rebase the carrier at every stage so upstream gain cannot promote it into
                    // the audible signal path. Dynamic Saturation receives canonical silence and
                    // gets its carrier after the kernel to preserve its exact-silent equilibrium.
                    this._prepareDenormalProtectedInput(
                        processingBuffer,
                        numProcessingChannels,
                        blockSize,
                        currentFrame,
                        !addNoiseAfter
                    );
                    result = processor.call(context, context, processingBuffer, processingParams, time);
                    if (addNoiseAfter) {
                        this._addDenormalNoise(
                            result instanceof Float32Array ? result : processingBuffer,
                            numProcessingChannels,
                            blockSize,
                            currentFrame
                        );
                    }
                    pluginContexts.set(plugin.id, context);
                } catch(e) {
                    console.error(`Error executing plugin ${plugin.id} (${plugin.type}):`, e);
                    result = processingBuffer;
                }
            }


             // Determine the actual buffer containing the processed result
             // Plugins might modify `processingBuffer` in-place or return a new buffer instance.
             // Assume modification in-place unless result is a Float32Array.
             const finalResultBuffer = (result instanceof Float32Array) ? result : processingBuffer;

             if (!finalResultBuffer) continue; // Skip if result is invalid

             if (spectrumTap) {
                 const scale = 1 / numProcessingChannels;
                 for (let frame = 0; frame < blockSize; frame++) {
                     let sum = finalResultBuffer[frame];
                     for (let channel = 1; channel < numProcessingChannels; channel++) {
                         sum += finalResultBuffer[channel * blockSize + frame];
                     }
                     spectrumTap.outputBuffer[spectrumTap.position] = sum * scale;
                     spectrumTap.position = (spectrumTap.position + 1) & 4095;
                     if ((spectrumTap.position & 2047) === 0 &&
                         !(this.powerPolicy.enabled && !this.powerPolicy.uiTelemetryEnabled)) {
                         // Keep spectrum messages independent of plugin measurement throttling.
                         const outputBuffer = Float32Array.from(spectrumTap.outputBuffer);
                         const message = {
                             type: 'spectrumOverlay',
                             spectrumPluginId: plugin.id,
                             mode: spectrumTap.mode,
                             outputBuffer,
                             bufferPosition: spectrumTap.position,
                             sampleRate,
                             time: currentTime
                         };
                         const transfer = [outputBuffer.buffer];
                         if (spectrumTap.inputBuffer) {
                             const inputBuffer = Float32Array.from(spectrumTap.inputBuffer);
                             message.inputBuffer = inputBuffer;
                             transfer.unshift(inputBuffer.buffer);
                         }
                         port.postMessage(message, transfer);
                     }
                 }
             }

             // --- 9e. Apply Result to Output Bus Buffer ---
             if (inputBus !== outputBus) {
                 this.applyDspMergeCompensation(
                     plugin.id,
                     processMode,
                     pairStartChannel,
                     singleChannelIndex,
                     outputBuffer,
                     finalResultBuffer,
                     outputChannelCount,
                     blockSize
                 );
                 // Additive mixing: Add the processed result to the output buffer
                 if (processMode === 'all') {
                     // Optimized: Use dedicated mixing buffer for better performance
                     // Avoid read/write overlap issues with separate mixing buffer
                     if (outputChannelCount <= ET_DSP_MAX_CHANNELS && blockSize === ET_DSP_MAX_FRAMES) {
                         // Use dedicated pre-allocated mixing buffer from pool
                         const mixBuffer = this.bufferPool.mixing;
                         // Copy current output state to mixing buffer
                         mixBuffer.set(outputBuffer.subarray(0, totalSize));
                         // Add the processed result using optimized loop
                         for (let i = 0; i < totalSize; i++) {
                             mixBuffer[i] += finalResultBuffer[i];
                         }
                         // Copy mixed result back to output buffer
                         outputBuffer.set(mixBuffer.subarray(0, totalSize));
                     } else {
                         // Fallback for non-standard sizes - direct addition
                         for (let i = 0; i < totalSize; i++) {
                             outputBuffer[i] += finalResultBuffer[i];
                         }
                     }
                 } else if (processMode === 'pair') {
                     const offset1 = pairStartChannel * blockSize;
                     const offset2 = (pairStartChannel + 1) * blockSize;
                     // Optimized: Use subarray views and set() for channel processing
                     const ch1Output = outputBuffer.subarray(offset1, offset1 + blockSize);
                     const ch2Output = outputBuffer.subarray(offset2, offset2 + blockSize);
                     const ch1Input = finalResultBuffer.subarray(0, blockSize);
                     const ch2Input = finalResultBuffer.subarray(blockSize, blockSize * 2);
                     
                     // Add result using optimized loop (vectorizable)
                     for (let i = 0; i < blockSize; i++) {
                         ch1Output[i] += ch1Input[i]; // Add Ch1
                         ch2Output[i] += ch2Input[i]; // Add Ch2
                     }
                 } else if (processMode === 'single') {
                     const offset = singleChannelIndex * blockSize;
                     // Optimized: Use subarray view for better cache efficiency
                     const channelOutput = outputBuffer.subarray(offset, offset + blockSize);
                     
                     // Add result using optimized loop (vectorizable)
                     for (let i = 0; i < blockSize; i++) {
                         channelOutput[i] += finalResultBuffer[i];
                     }
                 }
             } else {
                 // Same input/output bus: Replace content in the output buffer
                 if (processMode === 'all') {
                     // If processing was done in-place (processingBuffer === outputBuffer) and result wasn't a new array,
                     // the outputBuffer is already updated.
                     // If a new buffer was returned by the plugin, copy it back.
                     if (finalResultBuffer !== outputBuffer) {
                         outputBuffer.set(finalResultBuffer);
                     }
                     // If requiresCopy was true (shouldn't be if inputBus === outputBus),
                     // this means tempBuffer was used, so copy finalResultBuffer back.
                     // This logic path needs careful review based on processor guarantees. Assuming direct modification or return.

                 } else if (processMode === 'pair') {
                     // Optimized: Copy the processed stereo pair using subarray views for better performance
                     const ch1Target = outputBuffer.subarray(pairStartChannel * blockSize, (pairStartChannel + 1) * blockSize);
                     const ch2Target = outputBuffer.subarray((pairStartChannel + 1) * blockSize, (pairStartChannel + 2) * blockSize);
                     
                     // Use set() for efficient block copy
                     ch1Target.set(finalResultBuffer.subarray(0, blockSize)); // Ch 1
                     ch2Target.set(finalResultBuffer.subarray(blockSize, blockSize * 2)); // Ch 2
                 } else if (processMode === 'single') {
                     // Optimized: Copy the processed mono channel using subarray view
                     const channelTarget = outputBuffer.subarray(singleChannelIndex * blockSize, (singleChannelIndex + 1) * blockSize);
                     channelTarget.set(finalResultBuffer);
                 }
             }


            // --- 9f. Handle Measurements & Message Throttling ---
            // Legacy JavaScript analyzers attach measurements to their result buffer.
            const measurements = result?.measurements;
            if (measurements) {
                if (this.powerPolicy.enabled && !this.powerPolicy.uiTelemetryEnabled) {
                    messageQueue.clear();
                    result.measurements = null;
                    continue;
                }
                const currentTimeMs = time * 1000;
                if (currentTimeMs - lastMessageTime >= MESSAGE_INTERVAL) {
                    // Drain queue first
                    if (messageQueue.size > 0) {
                        for (const [pluginId, data] of messageQueue) {
                            port.postMessage({ type: 'processBuffer', pluginId, ...data });
                        }
                        messageQueue.clear();
                    }
                    // Send current message immediately
                    port.postMessage({ type: 'processBuffer', pluginId: plugin.id, measurements });
                    lastMessageTime = currentTimeMs; // Update last sent time
                } else {
                    // Queue the message if interval hasn't passed
                    messageQueue.set(plugin.id, { measurements });
                }
                // Clear measurements after handling to avoid re-sending.
                result.measurements = null;
            }
        } // End of plugin processing loop

        // Update the instance's last message time state
        this.lastMessageTime = lastMessageTime;

        // --- 10. Final Output Generation ---
        const mainBusBuffer = busBuffers.get(0); // Get the final state of the main bus

        if (mainBusBuffer) {
            this.applyDspFinalOutputCompensation(
                mainBusBuffer,
                outputChannelCount,
                blockSize
            );
            // Determine the number of channels to actually copy to the physical output
            const outputChannelsToWrite = Math.min(output.length, outputChannelCount);

            // Optimization: Clear only the channels we are about to write?
            // Safer: Clear all physical output channels to prevent stale data.
            for (let ch = 0; ch < output.length; ch++) {
                output[ch].fill(0);
            }

            // Copy the processed data from the main bus to the physical output buffers
            for (let ch = 0; ch < outputChannelsToWrite; ch++) {
                const srcOffset = ch * blockSize;
                // Defensive check: ensure source offset is within bounds
                if (srcOffset < mainBusBuffer.length) {
                    // Use subarray and set for efficient block copy
                    output[ch].set(mainBusBuffer.subarray(srcOffset, Math.min(srcOffset + blockSize, mainBusBuffer.length)));
                } else {
                    // This case indicates a mismatch between outputChannelCount and mainBusBuffer size.
                    // Output channel will already be zeroed from the loop above.
                    console.warn(`Source offset ${srcOffset} out of bounds for mainBusBuffer (length ${mainBusBuffer.length}) when writing output channel ${ch}.`);
                }
            }
            this.applyOutputDelay(output, outputChannelCount, blockSize);
        } else {
            // Should not happen if bus 0 is always initialized. Fallback: zero out physical output.
            console.error("Main bus (0) buffer not found at the end of processing!");
            for (let ch = 0; ch < output.length; ch++) {
                output[ch].fill(0);
            }
        }


        // --- 11. Output Level Monitoring ---
        // Same AC-only check as input monitoring (see section 4) so that a
        // constant DC offset on the output (e.g. introduced by Exciter with
        // a non-zero bias) does not block sleep mode entry.
        let hasOutputSignal = false;
        const outputChannelsToCheck = Math.min(output.length, outputChannelCount);
        const outAcThreshold = 2 * silenceThresholdAmplitude;
        for (let channel = 0; channel < outputChannelsToCheck; channel++) {
            const channelData = output[channel];
            let cmin = Infinity, cmax = -Infinity;
            for (let i = 0; i < channelData.length; i++) {
                const v = channelData[i];
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
                if (cmax - cmin > outAcThreshold) break; // early exit
            }
            if (cmax - cmin > outAcThreshold) {
                hasOutputSignal = true;
                break;
            }
        }

        // Update last output active time if signal detected
        if (hasOutputSignal) {
            audioLevelMonitoring.lastOutputActiveTime = time;
        }

        this.pumpDspTelemetry();

        if (powerEnabled) {
            this._finishPowerFullProcess(
                input,
                output,
                powerInputPower,
                blockSize,
                forceDryOutput,
                'js'
            );
        }

        this.finishAudioProcessingDeadline(
            audioProcessingStartedAt,
            blockSize,
            processedPlugin
        );

        // --- 12. Return Status ---
        // Return true to keep the processor alive
        return true;
    }
}

class RealtimeOutputKeepaliveProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.active = true;
        this.port.onmessage = event => {
            if (event.data?.type === 'stop') this.active = false;
        };
    }

    process() {
        return this.active;
    }
}

// Ensure the processor is registered with the correct name
try {
    registerProcessor('plugin-processor', PluginProcessor);
} catch (error) {
    console.error("Failed to register PluginProcessor:", error);
    // Fallback or error handling
}

try {
    registerProcessor('realtime-output-keepalive-processor', RealtimeOutputKeepaliveProcessor);
} catch (error) {
    console.error("Failed to register RealtimeOutputKeepaliveProcessor:", error);
}
