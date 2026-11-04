const MIDI_EVENT_BYTES = 24;
const SFZ_STREAM_REQUEST_CAPACITY = 4096;
const SFZ_STREAM_REQUEST_BYTES = 24;
const SFZ_STREAM_PCM_BYTES = 4096 * 2 * 4;
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
    'et_instance_stream_boundary',
    'et_instance_latency',
    'et_instance_set_tap',
    'et_instance_set_analysis_source',
    'et_instance_set_seed',
    'et_instance_set_midi_channel_mix',
    'et_instance_stream_readiness',
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
    'et_pipeline_refresh_latency',
    'et_pipeline_reserve_latency',
    'et_pipeline_refresh_latency_realtime',
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

export class DspBindingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DspBindingError';
    }
}

export function createDspImports({
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
            clock_time_get(clockId, _precision, resultPtr) {
                // NKSP profiling uses system_clock; musical clocks remain render-frame based.
                if (clockId !== 0) return 28;
                const memory = getMemory();
                if (!memory?.buffer || !Number.isInteger(resultPtr) || resultPtr < 0 ||
                    resultPtr > memory.buffer.byteLength - 8) return 21;
                new DataView(memory.buffer).setBigUint64(resultPtr, BigInt(Date.now()) * 1000000n, true);
                return WASI_ERRNO_SUCCESS;
            },
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

export class DspEngineBinding {
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
        this._midiEventsPtr = 0;
        this._midiTransportPtr = 0;
        this._midiTransportPoints = null;
        this._midiTransportInstances = new Set();
        this._sfzStreamPtr = 0;

        this._validateExports();
        this.memory = this.exports.memory;
        this._refreshViews(true);
    }

    estimateSfzEffectPreparation(control, context, formatTag = 1, payloadBytes = control.byteLength) {
        if (this.engine || this.prepared) throw new DspBindingError('SFZ cost queries require a separate CONTROL binding');
        const estimate = this.exports.et_sample_player_preparation_bytes;
        if (typeof estimate !== 'function') throw new DspBindingError('The current DSP module cannot size instrument effects');
        const playerKind = context.playerKind === undefined ? 0 : context.playerKind;
        if (playerKind !== 0 && playerKind !== 1) throw new DspBindingError('Invalid instrument player kind');
        const bytes = toUint8View(control, 'Sample player preparation metadata');
        if (!bytes.byteLength || bytes.byteLength > 0xfffffff0 || !Number.isInteger(payloadBytes) ||
            payloadBytes < bytes.byteLength || payloadBytes > 0xffffffff) throw new DspBindingError('Invalid sample player preparation metadata');
        const wasPreparing = this._preparing;
        this._preparing = true;
        let pointer = 0;
        try {
            const resultOffset = Math.ceil(bytes.byteLength / 8) * 8;
            pointer = this.exports.malloc(resultOffset + 8) >>> 0;
            this._refreshViews();
            if (!pointer) throw new DspBindingError('Unable to allocate SFZ cost-query storage');
            this._assertRange(pointer, resultOffset + 8, 'Sample player preparation metadata');
            new Uint8Array(this.memory.buffer, pointer, bytes.byteLength).set(bytes);
            const resultPointer = pointer + resultOffset;
            const status = estimate(pointer, bytes.byteLength, payloadBytes, formatTag,
                context.sampleRate, context.processingChannels, context.maxFrames, context.minimumPhysicalBpm, resultPointer, playerKind);
            this._refreshViews();
            if (status !== 0) throw new DspBindingError('Instrument processing preparation geometry is invalid');
            const result = new DataView(this.memory.buffer, resultPointer, 8);
            const additionalBytes = result.getUint32(0, true) + result.getUint32(4, true) * 0x100000000;
            if (!Number.isSafeInteger(additionalBytes)) throw new DspBindingError('Instrument preparation memory exceeds the supported range');
            return additionalBytes;
        } finally {
            if (pointer) this.exports.free(pointer);
            this._refreshViews();
            this._preparing = wasPreparing;
        }
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
        const preparing = this._preparing;
        this._preparing = true;
        try {
            const engine = this.exports.et_engine_create() >>> 0;
            if (!engine) {
                throw new DspBindingError('DSP engine creation failed');
            }
            this.engine = engine;
            return engine;
        } finally {
            // Engine allocation is a control-rate boundary, before audio processing.
            this._refreshViews();
            this._preparing = preparing;
        }
    }

    destroyEngine() {
        if (!this.engine) return;
        if (this._midiTransportPtr) this.exports.free(this._midiTransportPtr);
        this._midiTransportPtr = 0;
        this._midiTransportPoints = null;
        this._midiTransportInstances.clear();
        if (this._midiEventsPtr) this.exports.free(this._midiEventsPtr);
        this._midiEventsPtr = 0;
        if (this._sfzStreamPtr) this.exports.free(this._sfzStreamPtr);
        this._sfzStreamPtr = 0;
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
                if (this.exports.et_instance_set_midi_events && !this._midiEventsPtr) {
                    this._midiEventsPtr = this.exports.malloc(4096 * MIDI_EVENT_BYTES) >>> 0;
                    this._refreshViews();
                    if (!this._midiEventsPtr) throw new DspBindingError('MIDI event storage could not be prepared');
                    this._assertRange(this._midiEventsPtr, 4096 * MIDI_EVENT_BYTES, 'MIDI event storage');
                }
                this.prepared = true;
                this._maxChannels = maxChannels;
                this._maxFrames = maxFrames;
                this._sampleRate = sampleRate;
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
            if (instanceId && typeName === 'SoundFontPlayerPlugin') {
                this._midiTransportInstances.add(instanceId);
                if (this._midiTransportPoints && this.exports.et_instance_set_midi_transport_map) {
                    const result = this.exports.et_instance_set_midi_transport_map(this.engine, instanceId,
                        this._midiTransportPtr, this._midiTransportPoints.length);
                    if (result !== ET_OK) {
                        this._midiTransportInstances.delete(instanceId);
                        this.exports.et_instance_destroy(this.engine, instanceId);
                        instanceId = 0;
                    }
                }
            }
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
        this._midiTransportInstances.delete(instanceId);
        this.exports.et_instance_destroy(this.engine, instanceId);
    }

    resetInstance(instanceId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_reset(this.engine, instanceId);
    }

    streamBoundaryInstance(instanceId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_stream_boundary(this.engine, instanceId);
    }

    instanceLatency(instanceId) {
        if (!this.engine) return 0;
        return this.exports.et_instance_latency(this.engine, instanceId) >>> 0;
    }

    instanceSetTap(instanceId, tapId) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_set_tap(this.engine, instanceId, tapId >>> 0);
    }

    instanceSetAnalysisSource(consumer, producer = 0) {
        if (!this.engine) return ET_ERR_STATE;
        return this.exports.et_instance_set_analysis_source(this.engine, consumer, producer);
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

    instanceSetMidiEvents(instanceId, events, generation, flags = 0, count = events.length) {
        if (!this.engine || !this.prepared || !this._midiEventsPtr ||
            !this.exports.et_instance_set_midi_events) return ET_ERR_STATE;
        const ptr = this._writeMidiEvents(events, count);
        return this.exports.et_instance_set_midi_events(this.engine, instanceId, ptr, count,
            generation >>> 0, flags >>> 0);
    }

    _writeMidiEvents(events, count, capacity = 4096, maxOffsetFrames = this._maxFrames) {
        if (!Number.isInteger(count) || count < 0 || count > events.length || count > capacity) throw new DspBindingError('MIDI event block exceeds its prepared capacity');
        this._refreshViews();
        const ptr = this._midiEventsPtr;
        for (let index = 0; index < count; index++) {
            const event = events[index];
            const offset = event.offsetFrames ?? 0;
            const renderFrame = event.renderFrame ?? 0;
            const reattackMarker = event.status === 0 && (event.flags === 4 || event.flags === 16 || event.flags === 32 || event.flags === 128) &&
                event.data1 === 0 && (event.data2 ?? 0) === 0 && (event.noteId ?? 0) === 0;
            const systemReset = event.status === 0 && event.flags === 8192 && [1, 2, 3].includes(event.noteId) &&
                event.data1 === 0 && (event.data2 ?? 0) === 0 && renderFrame === 0;
            const drumMode = event.status === 0 && event.flags === 16384 && event.data1 >= 0 && event.data1 < 16 &&
                event.data2 >= 0 && event.data2 <= 3 && (event.noteId ?? 0) === 0 && renderFrame === 0;
            if (!Number.isInteger(offset) || offset < 0 || offset >= maxOffsetFrames ||
                !Number.isSafeInteger(renderFrame) || renderFrame < 0 ||
                (!reattackMarker && !systemReset && !drumMode && (!Number.isInteger(event.status) || event.status < 0x80 || event.status > 0xef)) ||
                !Number.isInteger(event.data1) || event.data1 < 0 || event.data1 > 127 ||
                !Number.isInteger(event.data2 ?? 0) || (event.data2 ?? 0) < 0 || (event.data2 ?? 0) > 127) {
                throw new DspBindingError('MIDI event is outside the prepared event contract');
            }
            const address = ptr + index * MIDI_EVENT_BYTES;
            this.dataView.setUint32(address, offset, true);
            this.dataView.setUint32(address + 4,
                event.status | event.data1 << 8 | (event.data2 ?? 0) << 16, true);
            this.dataView.setUint32(address + 8, event.noteId >>> 0, true);
            this.dataView.setUint32(address + 12, event.flags >>> 0, true);
            this.dataView.setUint32(address + 16, renderFrame >>> 0, true);
            this.dataView.setUint32(address + 20, Math.floor(renderFrame / 0x100000000), true);
        }
        return ptr;
    }

    // Control-only: retain one upload for future instances and let each native
    // instrument own its immutable copy. Render calls update only the mapping.
    prepareMidiTransport(points = []) {
        if (!this.engine || !this.exports.et_instance_set_midi_transport_map) return;
        if (this._midiTransportPoints === points) return;
        if (points.length > 250002) throw new DspBindingError('MIDI musical map exceeds its prepared capacity');
        const preparing = this._preparing;
        this._preparing = true;
        let ptr = 0;
        try {
            if (points.length) {
                ptr = this.exports.malloc(points.length * 40) >>> 0;
                this._refreshViews();
                if (!ptr) throw new DspBindingError('MIDI musical map storage could not be prepared');
                this._assertRange(ptr, points.length * 40, 'MIDI musical map');
                for (let index = 0; index < points.length; index++) {
                    const point = points[index], address = ptr + index * 40;
                    this.dataView.setFloat64(address, point.seconds, true);
                    this.dataView.setFloat64(address + 8, point.ppq, true);
                    this.dataView.setFloat64(address + 16, point.barStartPpq, true);
                    this.dataView.setFloat64(address + 24, point.bpm, true);
                    this.dataView.setUint32(address + 32, point.numerator, true);
                    this.dataView.setUint32(address + 36, point.denominator, true);
                }
            }
            for (const id of this._midiTransportInstances) {
                if (this.exports.et_instance_set_midi_transport_map(this.engine, id, ptr, points.length) !== ET_OK) {
                    throw new DspBindingError('MIDI musical map could not be installed');
                }
            }
            if (this._midiTransportPtr) this.exports.free(this._midiTransportPtr);
            this._midiTransportPtr = ptr;
            this._midiTransportPoints = points;
            ptr = 0;
        } finally {
            if (ptr) this.exports.free(ptr);
            this._refreshViews();
            this._preparing = preparing;
        }
    }

    instanceSetMidiTransport(instanceId, frame, seconds, speed, duration, flags = 0) {
        if (!this.engine || !this.exports.et_instance_set_midi_transport) return ET_ERR_STATE;
        if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isFinite(seconds) || seconds < 0 ||
            !Number.isFinite(speed) || speed <= 0 || !Number.isFinite(duration) || duration < 0 ||
            !Number.isInteger(flags) || flags < 0 || flags > 7) {
            throw new DspBindingError('Invalid MIDI musical transport mapping');
        }
        return this.exports.et_instance_set_midi_transport(this.engine, instanceId, frame >>> 0,
            Math.floor(frame / 0x100000000), seconds, speed, duration, flags);
    }

    instanceSetMidiClock(instanceId, frame, generation, flags = 0) {
        if (!this.engine || !this.exports.et_instance_set_midi_clock) return ET_ERR_STATE;
        if (!Number.isSafeInteger(frame) || frame < 0) throw new DspBindingError('Invalid MIDI render clock');
        return this.exports.et_instance_set_midi_clock(this.engine, instanceId, frame >>> 0,
            Math.floor(frame / 0x100000000), generation >>> 0, flags >>> 0);
    }

    hasSfzSampleStreaming() {
        return typeof this.exports.et_sfz_stream_capability === 'function' &&
            this.exports.et_sfz_stream_capability() === 1 &&
            ['et_instance_stream_configure', 'et_instance_stream_take_requests', 'et_instance_stream_publish', 'et_instance_stream_prefetch']
                .every(name => typeof this.exports[name] === 'function');
    }

    configureSfzSampleStream(instanceId, generation) {
        if (!this.engine || !this.prepared || !this.hasSfzSampleStreaming()) return ET_ERR_STATE;
        if (!Number.isSafeInteger(generation) || generation < 1) throw new DspBindingError('Invalid sample cache generation');
        const preparing = this._preparing;
        this._preparing = true;
        try {
            const bytes = SFZ_STREAM_REQUEST_CAPACITY * SFZ_STREAM_REQUEST_BYTES + 4 + SFZ_STREAM_PCM_BYTES;
            if (!this._sfzStreamPtr) this._sfzStreamPtr = this.exports.malloc(bytes) >>> 0;
            this._refreshViews();
            if (!this._sfzStreamPtr) throw new DspBindingError('Sample stream storage could not be prepared');
            this._assertRange(this._sfzStreamPtr, bytes, 'Sample stream storage');
            return this.exports.et_instance_stream_configure(this.engine, instanceId,
                generation >>> 0, Math.floor(generation / 0x100000000));
        } finally { this._refreshViews(); this._preparing = preparing; }
    }

    // Control operations between render calls. The native cache and staging
    // buffers are allocated by configure, never by a sample request or publish.
    prefetchSfzSampleStream(instanceId, events, generation, windowFrames, flags = 0, count = events.length) {
        if (!this.engine || !this.prepared || !this._midiEventsPtr || !this.hasSfzSampleStreaming()) return ET_ERR_STATE;
        if (!Number.isInteger(generation) || generation < 0 || generation > 0xffffffff ||
            !Number.isInteger(windowFrames) || windowFrames < 1 || windowFrames > this._sampleRate * 2 ||
            ![0, 1, 2, 4, 5, 6, 13].includes(flags) || (flags === 2 || flags === 6) && count !== 0) throw new DspBindingError('Invalid sample prefetch window');
        const ptr = this._writeMidiEvents(events, count, 256, windowFrames);
        return this.exports.et_instance_stream_prefetch(this.engine, instanceId, ptr, count, generation, windowFrames, flags);
    }

    // CONTROL-only snapshot. Reuse the configured request scratch between
    // operations; no audio-block allocation or cache traversal is introduced.
    instanceStreamReadiness(instanceId) {
        if (!this.engine || !this._sfzStreamPtr) return null;
        const status = this.exports.et_instance_stream_readiness(this.engine, instanceId, this._sfzStreamPtr);
        this._refreshViews();
        if (status !== ET_OK) throw new DspBindingError('Sample readiness could not be observed');
        const pointer = this._sfzStreamPtr;
        const value = { generation: this.dataView.getUint32(pointer, true),
            scope: this.dataView.getUint32(pointer + 4, true),
            admittedFrames: this.dataView.getUint32(pointer + 8, true),
            readyAheadFrames: this.dataView.getUint32(pointer + 12, true),
            plannedPages: this.dataView.getUint32(pointer + 16, true),
            pendingPages: this.dataView.getUint32(pointer + 20, true) };
        if (value.scope > 3 || value.readyAheadFrames > value.admittedFrames || value.pendingPages > value.plannedPages)
            throw new DspBindingError('Invalid sample readiness snapshot');
        return value;
    }

    takeSfzSampleRequests(instanceId) {
        if (!this.engine || !this._sfzStreamPtr || !this.hasSfzSampleStreaming()) throw new DspBindingError('Sample streaming is unavailable');
        this._refreshViews();
        const countPtr = this._sfzStreamPtr + SFZ_STREAM_REQUEST_CAPACITY * SFZ_STREAM_REQUEST_BYTES;
        this.dataView.setUint32(countPtr, 0, true);
        const status = this.exports.et_instance_stream_take_requests(this.engine, instanceId,
            this._sfzStreamPtr, SFZ_STREAM_REQUEST_CAPACITY, countPtr);
        if (status !== ET_OK) throw new DspBindingError(`Sample requests failed: ${status}`);
        const count = this.dataView.getUint32(countPtr, true);
        if (count > SFZ_STREAM_REQUEST_CAPACITY) throw new DspBindingError('Invalid sample request count');
        const requests = [];
        for (let index = 0; index < count; index++) {
            const ptr = this._sfzStreamPtr + index * SFZ_STREAM_REQUEST_BYTES;
            const generation = this.dataView.getUint32(ptr, true) + this.dataView.getUint32(ptr + 4, true) * 0x100000000;
            const pageIndex = this.dataView.getUint32(ptr + 8, true) + this.dataView.getUint32(ptr + 12, true) * 0x100000000;
            if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(pageIndex) || this.dataView.getUint32(ptr + 20, true)) {
                throw new DspBindingError('Invalid sample request');
            }
            requests.push({ generation, pageIndex, sample: this.dataView.getUint32(ptr + 16, true) });
        }
        return requests;
    }

    publishSfzSamplePage(instanceId, { generation, sample, pageIndex, pcm, frames, channels, resident = false }) {
        if (!this.engine || !this._sfzStreamPtr || !this.hasSfzSampleStreaming()) return ET_ERR_STATE;
        if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isInteger(sample) || sample < 0 || sample >= 10000 ||
            !Number.isSafeInteger(pageIndex) || pageIndex < 0 || !Number.isInteger(frames) || frames < 1 || frames > 4096 ||
            (channels !== 1 && channels !== 2) || !(pcm instanceof Float32Array) || pcm.length !== frames * channels) {
            throw new DspBindingError('Invalid sample page');
        }
        this._refreshViews();
        const ptr = this._sfzStreamPtr + SFZ_STREAM_REQUEST_CAPACITY * SFZ_STREAM_REQUEST_BYTES + 4;
        this.u8.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), ptr);
        const preparing = this._preparing;
        this._preparing = true;
        try {
            return this.exports.et_instance_stream_publish(this.engine, instanceId, generation >>> 0,
                Math.floor(generation / 0x100000000), sample, pageIndex >>> 0, Math.floor(pageIndex / 0x100000000),
                ptr, frames, channels, resident ? 1 : 0);
        } finally {
            this._refreshViews();
            this._preparing = preparing;
        }
    }

    instanceMidiState(instanceId) {
        if (!this.engine || !this.exports.et_instance_midi_state) return 0;
        return this.exports.et_instance_midi_state(this.engine, instanceId) >>> 0;
    }

    instanceMidiClock(instanceId) {
        if (!this.engine || !this.exports.et_instance_midi_clock_low ||
            !this.exports.et_instance_midi_clock_high || !this.exports.et_instance_midi_generation) {
            throw new DspBindingError('MIDI checkpoint clock is unavailable');
        }
        const low = this.exports.et_instance_midi_clock_low(this.engine, instanceId) >>> 0;
        const high = this.exports.et_instance_midi_clock_high(this.engine, instanceId) >>> 0;
        const frame = high * 0x100000000 + low;
        if (!Number.isSafeInteger(frame)) throw new DspBindingError('MIDI checkpoint clock is invalid');
        return { frame, generation: this.exports.et_instance_midi_generation(this.engine, instanceId) >>> 0 };
    }

    _withMidiCheckpointBuffer(size, action) {
        if (!Number.isInteger(size) || size < 1 || size > 32 * 1024 * 1024) {
            throw new DspBindingError('MIDI checkpoint size is invalid');
        }
        const preparing = this._preparing;
        let ptr = 0;
        this._preparing = true;
        try {
            ptr = this.exports.malloc(size) >>> 0;
            this._refreshViews();
            if (!ptr) throw new DspBindingError('MIDI checkpoint storage is unavailable');
            this._assertRange(ptr, size, 'MIDI checkpoint storage');
            this._preparing = preparing;
            const result = action(ptr);
            this._refreshViews();
            return result;
        } finally {
            this._preparing = preparing;
            if (ptr) this.exports.free(ptr);
        }
    }

    instanceWriteMidiCheckpoint(instanceId) {
        if (!this.engine || !this.exports.et_instance_midi_checkpoint_size ||
            !this.exports.et_instance_write_midi_checkpoint) throw new DspBindingError('MIDI checkpoint capture is unavailable');
        const size = this.exports.et_instance_midi_checkpoint_size(this.engine, instanceId) >>> 0;
        return this._withMidiCheckpointBuffer(size, ptr => {
            if (this.exports.et_instance_write_midi_checkpoint(this.engine, instanceId, ptr, size) !== 0) {
                throw new DspBindingError('MIDI checkpoint capture failed');
            }
            return new Uint8Array(this.memory.buffer, ptr, size).slice();
        });
    }

    instanceReadMidiCheckpoint(instanceId, checkpoint) {
        if (!this.engine || !this.exports.et_instance_read_midi_checkpoint) {
            throw new DspBindingError('MIDI checkpoint restore is unavailable');
        }
        const bytes = toUint8View(checkpoint, 'MIDI checkpoint');
        return this._withMidiCheckpointBuffer(bytes.byteLength, ptr => {
            new Uint8Array(this.memory.buffer, ptr, bytes.byteLength).set(bytes);
            return this.exports.et_instance_read_midi_checkpoint(this.engine, instanceId, ptr, bytes.byteLength);
        });
    }

    instanceSetMidiChannelMix(instanceId, channel, action) {
        if (!this.engine || !this.exports.et_instance_set_midi_channel_mix) return ET_ERR_STATE;
        if (!Number.isInteger(channel) || channel < 0 || channel > 15 ||
            !Number.isInteger(action) || action < 0 || action > 3)
            throw new DspBindingError('Invalid MIDI channel mix');
        return this.exports.et_instance_set_midi_channel_mix(this.engine, instanceId, channel, action);
    }

    instanceSetMidiMetering(instanceId, enabled) {
        if (!this.engine || typeof this.exports.et_instance_set_midi_metering !== 'function') return ET_ERR_STATE;
        if (!Number.isInteger(instanceId) || instanceId < 1 || typeof enabled !== 'boolean')
            throw new DspBindingError('Invalid MIDI metering request');
        return this.exports.et_instance_set_midi_metering(this.engine, instanceId, enabled ? 1 : 0);
    }

    instanceSetMidiGain(instanceId, gain) {
        if (!this.engine || !this.exports.et_instance_set_midi_gain) return ET_ERR_STATE;
        if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new DspBindingError('Invalid MIDI song gain');
        return this.exports.et_instance_set_midi_gain(this.engine, instanceId, gain);
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
        footprintBytes = byteSize,
        preparationContext = null
    }) {
        if (!this.engine || !this.prepared) return 0;
        this._preparing = true;
        try {
            const begin = preparationContext ? this.exports.et_instance_asset_begin_ptr
                : this.exports.et_instance_asset_begin;
            if (typeof begin !== 'function') throw new DspBindingError('The current DSP module cannot prepare this instrument context');
            const args = [
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
            ];
            if (preparationContext) args.push(preparationContext.minimumPhysicalBpm);
            const ptr = begin(...args) >>> 0;
            this._refreshViews();
            if (ptr) this._assertRange(ptr, byteSize, 'Asset staging buffer');
            return ptr;
        } finally {
            this._preparing = false;
        }
    }

    instanceAssetCommit(instanceId, slot, byteSize, formatTag) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        const preparing = this._preparing;
        this._preparing = true;
        try {
            // CONTROL staging prepares the flat SFZ program/VM before render-time exchange.
            return this.exports.et_instance_asset_commit(
                this.engine, instanceId, slot >>> 0, byteSize >>> 0, formatTag >>> 0
            );
        } finally {
            this._refreshViews();
            this._preparing = preparing;
        }
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

    instanceProcessSpan(instanceId, audioPtr, channelCount, blockFrames, firstFrame, frameCount, timeSeconds) {
        if (!this.engine || !this.prepared) return ET_ERR_STATE;
        if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > this._maxChannels ||
            !Number.isInteger(blockFrames) || blockFrames < 1 || blockFrames > this._maxFrames ||
            !Number.isInteger(firstFrame) || firstFrame < 0 || !Number.isInteger(frameCount) ||
            frameCount < 0 || firstFrame + frameCount > blockFrames) {
            throw new RangeError('DSP instance span is outside the planar block');
        }
        this._refreshViews();
        this._assertRange(audioPtr, channelCount * blockFrames * 4, 'DSP instance span');
        const scratchPtr = this.scratchPtr();
        const scratch = scratchPtr / 4;
        const source = audioPtr / 4;
        const capacity = Math.floor(SCRATCH_BYTES / (channelCount * 4));
        for (let offset = 0; offset < frameCount; offset += capacity) {
            const count = Math.min(capacity, frameCount - offset);
            for (let channel = 0; channel < channelCount; channel++) {
                for (let i = 0; i < count; i++) {
                    this.f32[scratch + channel * count + i] =
                        this.f32[source + channel * blockFrames + firstFrame + offset + i];
                }
            }
            const status = this.instanceProcess(instanceId, scratchPtr, channelCount, count,
                timeSeconds + (firstFrame + offset) / this._sampleRate);
            if (status !== 0) return status;
            for (let channel = 0; channel < channelCount; channel++) {
                for (let i = 0; i < count; i++) {
                    this.f32[source + channel * blockFrames + firstFrame + offset + i] =
                        this.f32[scratch + channel * count + i];
                }
            }
        }
        return 0;
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

    pipelineRefreshLatency() {
        if (!this.engine) return ET_ERR_STATE;
        this._preparing = true;
        let status = ET_ERR_STATE;
        try {
            status = this.exports.et_pipeline_refresh_latency(this.engine);
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

    pipelineReserveLatency() {
        if (!this.engine) return ET_ERR_STATE;
        this._preparing = true;
        let status = ET_ERR_STATE;
        try {
            status = this.exports.et_pipeline_reserve_latency(this.engine);
        } finally {
            this._refreshViews();
            this._preparing = false;
        }
        this.getArenaViews();
        return status;
    }

    pipelineRefreshLatencyRealtime() {
        if (!this.engine) return ET_ERR_STATE;
        const status = this.exports.et_pipeline_refresh_latency_realtime(this.engine);
        this._refreshViews();
        return status;
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

    hasOfflineGraph() {
        return this.graphSupported && ['et_graph_configure_offline', 'et_graph_prepare_offline',
            'et_graph_process_offline'].every(name => typeof this.exports[name] === 'function');
    }

    graphPrepareOffline() {
        if (!this.engine || !this.prepared || !this.hasOfflineGraph()) return null;
        this._preparing = true;
        try {
            const ptr = this.exports.et_scratch_ptr(this.engine) >>> 0;
            const status = this.exports.et_graph_prepare_offline(this.engine, ptr, ptr + 4);
            this._refreshViews();
            if (status !== 0) throw new DspBindingError(`Offline graph preparation failed: ${status}`);
            const words = new Uint32Array(this._memoryBuffer, ptr, 2);
            return { low: words[0], high: words[1] };
        } finally {
            this._preparing = false;
            this.getArenaViews();
        }
    }

    graphProcessOffline(channelCount, frameCount, timeSeconds, generation) {
        if (!this.engine || !this.hasOfflineGraph() || !generation) return ET_ERR_STATE;
        this._refreshViews();
        return this.exports.et_graph_process_offline(this.engine, channelCount >>> 0,
            frameCount >>> 0, timeSeconds, generation.low >>> 0, generation.high >>> 0);
    }

    graphConfigureOffline(descriptor) {
        if (!this.hasOfflineGraph()) return ET_ERR_STATE;
        return this.graphConfigure(descriptor, true);
    }

    graphConfigure(descriptor, offline = false) {
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
            const configure = offline ? this.exports.et_graph_configure_offline : this.exports.et_graph_configure;
            return configure(this.engine, ptr, bytes.byteLength);
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

export async function instantiateDspBinding(moduleOrBytes, {
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

export { ET_OK, ET_ERR_STATE, REQUIRED_FUNCTION_EXPORTS };
