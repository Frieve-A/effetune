import { detectSimdSupport } from './internal/dsp-wasm-loader.js';
import { instantiateDspBinding } from './internal/dsp-engine-binding.js';
import { getEffectCatalog, getEffectImplementation } from './catalog.js';
import { EffeTuneRuntimeError, ValidationError } from './errors.js';

const EXPECTED_ABI_VERSION = 1;
const cache = new Map();

function resourceUrl(value, fallback) {
  if (value instanceof URL) return value;
  if (value === undefined) return fallback;
  try {
    return new URL(String(value), import.meta.url);
  } catch (error) {
    throw new ValidationError(`Invalid DSP resource URL: ${String(value)}`, { cause: error });
  }
}

async function readFileUrl(url, binary) {
  try {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile(url);
    return binary
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data.toString('utf8');
  } catch (error) {
    throw new EffeTuneRuntimeError(`Unable to read packaged DSP resource ${url.pathname}.`, { cause: error });
  }
}

async function fetchResource(url, fetchImpl, binary) {
  if (url.protocol === 'file:') return readFileUrl(url, binary);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError(`Unsupported DSP resource URL scheme: ${url.protocol}`);
  }
  if (url.protocol === 'http:') {
    const moduleUrl = new URL(import.meta.url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!local && url.origin !== moduleUrl.origin) {
      throw new ValidationError('Cross-origin DSP resources must use HTTPS.');
    }
  }
  if (typeof fetchImpl !== 'function') {
    throw new EffeTuneRuntimeError('fetch is required to load DSP resources in this environment.');
  }
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new EffeTuneRuntimeError(`Unable to load DSP resource ${url}.`, { cause: error });
  }
  if (!response?.ok) {
    throw new EffeTuneRuntimeError(`Unable to load DSP resource ${url} (HTTP ${response?.status ?? 'error'}).`);
  }
  try {
    return await (binary ? response.arrayBuffer() : response.text());
  } catch (error) {
    throw new EffeTuneRuntimeError(`Unable to read DSP resource ${url}.`, { cause: error });
  }
}

function selectVariant(requested, webAssembly) {
  if (!['auto', 'baseline', 'simd'].includes(requested)) {
    throw new ValidationError('variant must be auto, baseline, or simd.');
  }
  const supported = detectSimdSupport(webAssembly);
  if (requested === 'simd' && !supported) {
    throw new EffeTuneRuntimeError('This WebAssembly runtime does not support SIMD.');
  }
  return requested === 'auto' ? (supported ? 'simd' : 'baseline') : requested;
}

function validateMeta(meta) {
  if (!meta || meta.abiVersion !== EXPECTED_ABI_VERSION || !Array.isArray(meta.kernels)) {
    throw new EffeTuneRuntimeError('The packaged DSP metadata is incompatible.');
  }
  return new Map(meta.kernels.map(kernel => [kernel.name, kernel]));
}

function validateCapabilities(capabilities, kernels, variant) {
  if (capabilities.abiVersion !== EXPECTED_ABI_VERSION) {
    throw new EffeTuneRuntimeError('The packaged DSP module uses an incompatible ABI.');
  }
  if (capabilities.simd !== (variant === 'simd')) {
    throw new EffeTuneRuntimeError(`The packaged ${variant} DSP artifact has inconsistent build flags.`);
  }
  const available = new Map(capabilities.kernels.map(kernel => [kernel.name, kernel]));
  for (const effect of getEffectCatalog().effects) {
    const implementation = getEffectImplementation(effect.type);
    const meta = kernels.get(implementation.internalType);
    const actual = available.get(implementation.internalType);
    if (!meta || !actual ||
        (meta.hash >>> 0) !== (implementation.layoutHash >>> 0) ||
        (actual.hash >>> 0) !== (implementation.layoutHash >>> 0)) {
      throw new EffeTuneRuntimeError(`${effect.type} is incompatible with the packaged DSP artifact.`);
    }
  }
}

async function loadUncached({
  variant,
  webAssembly,
  fetchImpl,
  wasmUrl,
  simdWasmUrl,
  metaUrl
}) {
  if (!webAssembly || typeof webAssembly.compile !== 'function') {
    throw new EffeTuneRuntimeError('WebAssembly is unavailable.');
  }
  const selected = selectVariant(variant, webAssembly);
  const baselineDefault = new URL('./assets/effetune-dsp.wasm', import.meta.url);
  const simdDefault = new URL('./assets/effetune-dsp.simd.wasm', import.meta.url);
  const metadataDefault = new URL('./assets/effetune-dsp.meta.json', import.meta.url);
  const selectedUrl = selected === 'simd'
    ? resourceUrl(simdWasmUrl, simdDefault)
    : resourceUrl(wasmUrl, baselineDefault);
  const resolvedMetaUrl = resourceUrl(metaUrl, metadataDefault);

  const [bytes, metaText] = await Promise.all([
    fetchResource(selectedUrl, fetchImpl, true),
    fetchResource(resolvedMetaUrl, fetchImpl, false)
  ]);
  let meta;
  try {
    meta = JSON.parse(metaText);
  } catch (error) {
    throw new EffeTuneRuntimeError('The packaged DSP metadata is not valid JSON.', { cause: error });
  }
  const kernels = validateMeta(meta);
  let module;
  try {
    module = await webAssembly.compile(bytes);
  } catch (error) {
    throw new EffeTuneRuntimeError(`Unable to compile the packaged ${selected} DSP artifact.`, { cause: error });
  }

  let binding;
  try {
    binding = await instantiateDspBinding(module, { webAssembly, warning: () => {} });
    validateCapabilities(binding.getCapabilities(), kernels, selected);
  } catch (error) {
    if (error instanceof EffeTuneRuntimeError) throw error;
    throw new EffeTuneRuntimeError(`Unable to initialize the packaged ${selected} DSP artifact.`, { cause: error });
  } finally {
    binding?.close();
  }
  return { variant: selected, module, bytes, meta };
}

export async function loadDspArtifact(options = {}) {
  const webAssembly = options.webAssembly ?? globalThis.WebAssembly;
  const variant = selectVariant(options.variant ?? 'auto', webAssembly);
  const wasmUrl = variant === 'simd' ? options.simdWasmUrl : options.wasmUrl;
  const key = options.cache === false ||
      options.fetch !== undefined ||
      options.webAssembly !== undefined
    ? null
    : [
        variant,
        String(wasmUrl ?? ''),
        String(options.metaUrl ?? ''),
        options.fetch === undefined ? 'default-fetch' : 'custom-fetch'
      ].join('|');
  if (key && cache.has(key)) return cache.get(key);
  const promise = loadUncached({
    variant,
    webAssembly,
    fetchImpl: options.fetch ?? globalThis.fetch,
    wasmUrl: options.wasmUrl,
    simdWasmUrl: options.simdWasmUrl,
    metaUrl: options.metaUrl
  });
  if (key) cache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    if (key) cache.delete(key);
    throw error;
  }
}

export function clearArtifactCache() {
  cache.clear();
}
