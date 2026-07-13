import { instantiateDspBinding } from './dsp-engine-binding.js';

export const EXPECTED_ABI_VERSION = 1;

// A minimal module whose only function returns a v128.const value.
export const SIMD_PROBE_BYTES = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
    0x03, 0x02, 0x01, 0x00,
    0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x0b
]);

const moduleCache = new Map();

function defaultWarning(message) {
    if (globalThis.console?.warn) {
        globalThis.console.warn(message);
    }
}

function warn(warning, message) {
    warning(`[dsp-wasm] ${message}`);
}

function joinAssetPath(basePath, relativePath) {
    const base = String(basePath || '');
    if (!base) return relativePath;
    if (base === '/') return `/${relativePath}`;
    return `${base.replace(/\/$/, '')}/${relativePath}`;
}

function assertResponse(response, url) {
    if (!response || response.ok === false) {
        const status = response?.status ? ` (${response.status})` : '';
        throw new Error(`Failed to fetch ${url}${status}`);
    }
    return response;
}

async function readJsonResponse(response, url) {
    assertResponse(response, url);
    if (typeof response.json === 'function') return response.json();
    if (typeof response.text === 'function') return JSON.parse(await response.text());
    throw new Error(`Response for ${url} cannot be read as JSON`);
}

async function readBinaryResponse(response, url) {
    assertResponse(response, url);
    if (typeof response.arrayBuffer !== 'function') {
        throw new Error(`Response for ${url} cannot be read as an ArrayBuffer`);
    }
    const bytes = await response.arrayBuffer();
    if (!(bytes instanceof ArrayBuffer)) {
        throw new Error(`Response for ${url} did not return an ArrayBuffer`);
    }
    return bytes;
}

function normalizeKernel(kernel, index) {
    if (!kernel || typeof kernel.name !== 'string' || kernel.name.length === 0) {
        throw new Error(`Invalid DSP metadata kernel at index ${index}`);
    }
    if (!Number.isInteger(kernel.hash) || kernel.hash < 0 || kernel.hash > 0xffffffff) {
        throw new Error(`Invalid DSP parameter hash for ${kernel.name}`);
    }
    const byteCapacity = kernel.byteCapacity ?? 0;
    if (!Number.isInteger(byteCapacity) || byteCapacity < 0 || byteCapacity > 4096) {
        throw new Error(`Invalid DSP structured parameter capacity for ${kernel.name}`);
    }
    return { name: kernel.name, hash: kernel.hash >>> 0, byteCapacity };
}

export function validateDspMeta(meta) {
    if (!meta || typeof meta !== 'object') throw new Error('DSP metadata is not an object');
    if (!Number.isInteger(meta.abiVersion) || meta.abiVersion < 0) {
        throw new Error('DSP metadata has an invalid ABI version');
    }
    if (!Array.isArray(meta.kernels)) throw new Error('DSP metadata kernels must be an array');

    const seen = new Set();
    const kernels = meta.kernels.map((kernel, index) => {
        const normalized = normalizeKernel(kernel, index);
        if (seen.has(normalized.name)) throw new Error(`Duplicate DSP kernel ${normalized.name}`);
        seen.add(normalized.name);
        return normalized;
    });
    return { ...meta, abiVersion: meta.abiVersion >>> 0, kernels };
}

export function detectSimdSupport(webAssembly = globalThis.WebAssembly) {
    if (!webAssembly || typeof webAssembly.validate !== 'function') return false;
    try {
        return webAssembly.validate(SIMD_PROBE_BYTES);
    } catch {
        return false;
    }
}

export function detectWasmExceptionHandlingSupport(webAssembly = globalThis.WebAssembly) {
    return Boolean(
        webAssembly
        && typeof webAssembly.Tag === 'function'
        && typeof webAssembly.Exception === 'function'
    );
}

export function canCloneWasmModule(module, structuredCloneImpl = globalThis.structuredClone) {
    if (typeof structuredCloneImpl !== 'function') return false;
    try {
        structuredCloneImpl(module);
        return true;
    } catch {
        return false;
    }
}

function reconcileKernels(meta, capabilities, warning) {
    const available = new Map(capabilities.kernels.map(kernel => [kernel.name, kernel]));
    const compatible = [];
    for (const kernel of meta.kernels) {
        const actual = available.get(kernel.name);
        if (actual && (actual.hash >>> 0) === kernel.hash &&
            (actual.byteCapacity ?? 0) === kernel.byteCapacity) {
            compatible.push(kernel);
        } else {
            const reason = actual === undefined
                ? 'is absent from the module'
                : 'has a parameter layout mismatch';
            warn(warning, `${kernel.name} ${reason}; disabling its WASM path`);
        }
    }
    return { ...meta, kernels: compatible };
}

function findHash(generatedModule, typeName) {
    const candidates = [
        `${typeName}_PARAMS_HASH`,
        `${typeName}ParamsHash`,
        `${typeName.toUpperCase()}_PARAMS_HASH`
    ];
    for (const name of candidates) {
        if (Number.isInteger(generatedModule?.[name])) return generatedModule[name] >>> 0;
    }
    return null;
}

function normalizePackerCollection(collection) {
    if (collection instanceof Map) return collection;
    if (collection && typeof collection === 'object') return new Map(Object.entries(collection));
    return null;
}

export function createDspParamPackers(generatedModule, kernels = null, warning = defaultWarning) {
    const kernelHashes = kernels
        ? new Map(kernels.map(kernel => [kernel.name, kernel.hash >>> 0]))
        : null;
    const kernelByteCapacities = kernels
        ? new Map(kernels.map(kernel => [kernel.name, kernel.byteCapacity ?? 0]))
        : null;
    const packers = new Map();
    const declared = normalizePackerCollection(
        generatedModule?.DSP_PARAM_PACKERS ||
        generatedModule?.dspParamPackers ||
        generatedModule?.PARAM_PACKERS
    );

    if (declared) {
        for (const [typeName, value] of declared) {
            const pack = typeof value === 'function' ? value : value?.pack;
            const packBytes = typeof value?.packBytes === 'function' ? value.packBytes : null;
            const byteCapacity = Number.isInteger(value?.byteCapacity) ? value.byteCapacity : 0;
            const hash = Number.isInteger(value?.hash) ? value.hash >>> 0 : findHash(generatedModule, typeName);
            if (typeof pack !== 'function' || hash === null) continue;
            if (kernelHashes && (kernelHashes.get(typeName) !== hash ||
                kernelByteCapacities.get(typeName) !== byteCapacity)) {
                warn(warning, `${typeName} generated parameter layout does not match the loaded kernel`);
                continue;
            }
            packers.set(typeName, {
                pack,
                hash,
                ...(packBytes ? { packBytes, byteCapacity } : {})
            });
        }
        return packers;
    }

    for (const [exportName, pack] of Object.entries(generatedModule || {})) {
        const match = /^pack(.+)Params$/.exec(exportName);
        if (!match || typeof pack !== 'function') continue;
        const typeName = match[1];
        const hash = findHash(generatedModule, typeName);
        if (hash === null) continue;
        if (kernelHashes && kernelHashes.get(typeName) !== hash) {
            warn(warning, `${typeName} generated parameter layout does not match the loaded kernel`);
            continue;
        }
        packers.set(typeName, { pack, hash });
    }
    return packers;
}

export function publishDspParamPackers(generatedModule, {
    target = globalThis.window,
    kernels = null,
    warning = defaultWarning
} = {}) {
    const packers = createDspParamPackers(generatedModule, kernels, warning);
    if (target && (typeof target === 'object' || typeof target === 'function')) {
        target.dspParamPackers = packers;
    }
    return packers;
}

async function importGeneratedParamPackers() {
    try {
        return await import('./dsp-params.generated.js');
    } catch {
        return null;
    }
}

async function loadAndValidate({
    basePath,
    fetchImpl,
    webAssembly,
    structuredCloneImpl,
    expectedAbiVersion,
    instantiateImpl,
    warning,
    paramPackersModule,
    publishTarget
}) {
    const simd = detectSimdSupport(webAssembly);
    const artifactName = simd ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
    const artifactUrl = joinAssetPath(basePath, `plugins/dsp/${artifactName}`);
    const metaUrl = joinAssetPath(basePath, 'plugins/dsp/effetune-dsp.meta.json');

    const [binaryResponse, metaResponse] = await Promise.all([
        fetchImpl(artifactUrl),
        fetchImpl(metaUrl)
    ]);
    const [bytes, rawMeta] = await Promise.all([
        readBinaryResponse(binaryResponse, artifactUrl),
        readJsonResponse(metaResponse, metaUrl)
    ]);
    const meta = validateDspMeta(rawMeta);
    if (meta.abiVersion !== expectedAbiVersion) {
        throw new Error(`Metadata ABI ${meta.abiVersion} does not match host ABI ${expectedAbiVersion}`);
    }
    if (!webAssembly || typeof webAssembly.compile !== 'function') {
        throw new Error('WebAssembly.compile is unavailable');
    }
    const module = await webAssembly.compile(bytes);

    let binding = null;
    let capabilities;
    try {
        binding = await instantiateImpl(module, { webAssembly, warning });
        capabilities = binding.getCapabilities();
    } finally {
        binding?.close();
    }
    if (capabilities.abiVersion !== expectedAbiVersion) {
        throw new Error(`Module ABI ${capabilities.abiVersion} does not match host ABI ${expectedAbiVersion}`);
    }
    if (capabilities.simd !== simd) {
        throw new Error(`Module SIMD flag does not match selected artifact ${artifactName}`);
    }

    const compatibleMeta = reconcileKernels(meta, capabilities, warning);
    const generated = paramPackersModule === undefined
        ? await importGeneratedParamPackers()
        : paramPackersModule;
    const paramPackers = publishDspParamPackers(generated, {
        target: publishTarget,
        kernels: compatibleMeta.kernels,
        warning
    });

    return {
        module,
        bytes,
        moduleCloneable: canCloneWasmModule(module, structuredCloneImpl),
        simd,
        meta: compatibleMeta,
        paramPackers
    };
}

export async function loadDspModule({
    basePath = '',
    fetchImpl = globalThis.fetch,
    webAssembly = globalThis.WebAssembly,
    structuredCloneImpl = globalThis.structuredClone,
    expectedAbiVersion = EXPECTED_ABI_VERSION,
    instantiateImpl = instantiateDspBinding,
    warning = defaultWarning,
    paramPackersModule,
    publishTarget = globalThis.window,
    cache = true
} = {}) {
    if (typeof fetchImpl !== 'function') {
        warn(warning, 'fetch is unavailable; using the JavaScript DSP path');
        return null;
    }

    if (!detectWasmExceptionHandlingSupport(webAssembly)) {
        warn(warning, 'WebAssembly exception handling is unavailable; using the JavaScript DSP path');
        return null;
    }

    const simd = detectSimdSupport(webAssembly);
    const artifactName = simd ? 'effetune-dsp.simd.wasm' : 'effetune-dsp.wasm';
    const cacheKey = `${basePath}|${artifactName}|${expectedAbiVersion}`;
    if (cache && moduleCache.has(cacheKey)) return moduleCache.get(cacheKey);

    const loadPromise = loadAndValidate({
        basePath,
        fetchImpl,
        webAssembly,
        structuredCloneImpl,
        expectedAbiVersion,
        instantiateImpl,
        warning,
        paramPackersModule,
        publishTarget
    }).catch(error => {
        if (cache) moduleCache.delete(cacheKey);
        warn(warning, `load failed: ${error?.message || String(error)}; using the JavaScript DSP path`);
        return null;
    });
    if (cache) moduleCache.set(cacheKey, loadPromise);
    return loadPromise;
}

export function clearDspModuleCache() {
    moduleCache.clear();
}

export function instantiateDsp(moduleOrBytes, options) {
    return instantiateDspBinding(moduleOrBytes, options);
}
