import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { DEFAULT_REPO_ROOT, findPluginDefinition } from './cases.mjs';
import { XorShift64, noiseSeedForCase } from './stimuli.mjs';

class NoopObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

function createElement(tagName = 'div') {
  const element = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); return child; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1024, height: 512 }; }
  };
  return element;
}

function createDocument() {
  const document = {
    createElement,
    createTextNode(text) { return { textContent: text }; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
  };
  document.body = createElement('body');
  document.head = createElement('head');
  return document;
}

function createSandbox({ quiet = true } = {}) {
  const errors = [];
  const describe = value => {
    if (value instanceof Error) return value.message;
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };
  const sandboxConsole = {
    log: quiet ? () => {} : console.log,
    info: quiet ? () => {} : console.info,
    warn: quiet ? () => {} : console.warn,
    error: (...args) => {
      errors.push(args.map(describe).join(' '));
      if (!quiet) console.error(...args);
    }
  };
  const document = createDocument();
  const window = {
    document,
    workletNode: null,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle() { return {}; },
    requestAnimationFrame(callback) { return setTimeout(() => callback(performance.now()), 16); },
    cancelAnimationFrame(handle) { clearTimeout(handle); }
  };
  window.window = window;
  const math = Object.create(Math);
  math.random = Math.random;
  const sandbox = {
    window,
    document,
    console: sandboxConsole,
    Math: math,
    performance,
    crypto: crypto.webcrypto,
    MutationObserver: NoopObserver,
    ResizeObserver: NoopObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob,
    errors
  };
  return sandbox;
}

async function readReferenceSources(definition, repoRoot) {
  const basePath = path.join(repoRoot, 'plugins', 'plugin-base.js');
  const pluginPath = path.join(repoRoot, 'plugins', `${definition.path}.js`);
  try {
    const [baseSource, pluginSource] = await Promise.all([
      fs.readFile(basePath, 'utf8'),
      fs.readFile(pluginPath, 'utf8')
    ]);
    return {
      basePath,
      pluginPath,
      baseSource: baseSource.replace(/\r\n?/g, '\n'),
      pluginSource: pluginSource.replace(/\r\n?/g, '\n')
    };
  } catch (error) {
    throw new Error(`Unable to load JS reference for ${definition.type}: ${error.message}`, { cause: error });
  }
}

export async function loadReferencePlugin(typeOrName, {
  repoRoot = DEFAULT_REPO_ROOT,
  quiet = true
} = {}) {
  const definition = await findPluginDefinition(typeOrName, repoRoot);
  const sources = await readReferenceSources(definition, repoRoot);
  const sandbox = createSandbox({ quiet });
  const context = vm.createContext(sandbox, { name: `dsp-parity:${definition.type}` });
  try {
    vm.runInContext(sources.baseSource, context, { filename: sources.basePath });
    vm.runInContext(sources.pluginSource, context, { filename: sources.pluginPath });
  } catch (error) {
    throw new Error(`Failed to evaluate JS reference ${definition.type}: ${error.message}`, { cause: error });
  }
  const PluginClass = sandbox.window[definition.type];
  if (typeof PluginClass !== 'function') {
    throw new Error(`Plugin file ${sources.pluginPath} did not register window.${definition.type}`);
  }
  // jsEngineHash covers the plugin source only, so edits to the shared
  // plugins/plugin-base.js do not churn every golden metadata file. Drift in
  // the shared base is guarded by dsp/plugins/golden-base-hash.json instead.
  const jsEngineHash = crypto.createHash('sha256')
    .update(sources.pluginSource)
    .digest('hex');
  const baseSourceHash = crypto.createHash('sha256')
    .update(sources.baseSource)
    .digest('hex');
  return { definition, PluginClass, sandbox, jsEngineHash, baseSourceHash };
}

function assertAudioShape(audio, frames, channels) {
  if (!(audio instanceof Float32Array)) throw new TypeError('Reference input must be a Float32Array');
  if (audio.length !== frames * channels) {
    throw new Error(`Reference input has ${audio.length} floats; expected ${frames * channels} (${channels} x ${frames})`);
  }
}

function copyBlock(input, frames, channels, startFrame, blockFrames) {
  const block = new Float32Array(channels * blockFrames);
  for (let channel = 0; channel < channels; channel++) {
    const sourceOffset = channel * frames + startFrame;
    block.set(input.subarray(sourceOffset, sourceOffset + blockFrames), channel * blockFrames);
  }
  return block;
}

function storeBlock(output, block, frames, channels, startFrame, blockFrames) {
  for (let channel = 0; channel < channels; channel++) {
    const targetOffset = channel * frames + startFrame;
    const sourceOffset = channel * blockFrames;
    output.set(block.subarray(sourceOffset, sourceOffset + blockFrames), targetOffset);
  }
}

function normalizeEvents(events = []) {
  return [...events].map(event => {
    if (!Number.isInteger(event.frame) || event.frame < 0) throw new Error(`Parameter event has invalid frame ${event.frame}`);
    return { frame: event.frame, params: { ...(event.params ?? {}) } };
  }).sort((left, right) => left.frame - right.frame);
}

export async function createReferenceSession(typeOrName, {
  repoRoot = DEFAULT_REPO_ROOT,
  params = {},
  caseIndex = 0,
  seed = noiseSeedForCase(caseIndex),
  quiet = true
} = {}) {
  const loaded = await loadReferencePlugin(typeOrName, { repoRoot, quiet });
  const rng = new XorShift64(seed);
  loaded.sandbox.Math.random = () => rng.nextFloat();
  let plugin;
  try {
    plugin = new loaded.PluginClass();
    plugin.id = `dsp-parity-${loaded.definition.type}`;
    if (typeof plugin.setParameters === 'function') plugin.setParameters(params);
  } catch (error) {
    throw new Error(`Failed to construct JS reference ${loaded.definition.type}: ${error.message}`, { cause: error });
  }
  if (typeof plugin.executeProcessor !== 'function' || !plugin.compiledFunction) {
    throw new Error(`JS reference ${loaded.definition.type} did not register an executable processor`);
  }
  const state = { __seededRandom: () => rng.nextFloat() };

  return {
    type: loaded.definition.type,
    definition: loaded.definition,
    jsEngineHash: loaded.jsEngineHash,
    baseSourceHash: loaded.baseSourceHash,
    plugin,
    async process(input, {
      sampleRate,
      frames,
      channels,
      blockSize = 128,
      channel = null,
      events = []
    }) {
      assertAudioShape(input, frames, channels);
      const output = new Float32Array(input.length);
      const parameterEvents = normalizeEvents(events);
      let eventIndex = 0;
      let startFrame = 0;
      while (startFrame < frames) {
        while (eventIndex < parameterEvents.length && parameterEvents[eventIndex].frame === startFrame) {
          plugin.setParameters(parameterEvents[eventIndex].params);
          eventIndex++;
        }
        const nextEventFrame = parameterEvents[eventIndex]?.frame ?? frames;
        let blockFrames = Math.min(blockSize, frames - startFrame);
        if (nextEventFrame > startFrame && nextEventFrame < startFrame + blockFrames) {
          blockFrames = nextEventFrame - startFrame;
        }
        if (nextEventFrame < startFrame) {
          throw new Error(`Parameter event at frame ${nextEventFrame} was not consumed`);
        }
        const block = copyBlock(input, frames, channels, startFrame, blockFrames);
        const pluginParams = typeof plugin.getParameters === 'function' ? plugin.getParameters() : {};
        const parameters = {
          ...pluginParams,
          type: loaded.definition.type,
          enabled: plugin.enabled !== false,
          channel,
          channelCount: channels,
          blockSize: blockFrames,
          sampleRate
        };
        state.sampleRate = sampleRate;
        state.currentFrame = startFrame;
        const errorsBefore = loaded.sandbox.errors.length;
        const processed = plugin.executeProcessor(state, block, parameters, startFrame / sampleRate);
        if (loaded.sandbox.errors.length > errorsBefore) {
          throw new Error(`JS reference ${loaded.definition.type} reported: ${loaded.sandbox.errors.at(-1)}`);
        }
        const result = ArrayBuffer.isView(processed) ? processed : block;
        if (result.length !== block.length) {
          throw new Error(`JS reference ${loaded.definition.type} returned ${result.length} floats for a ${block.length}-float block`);
        }
        storeBlock(output, result, frames, channels, startFrame, blockFrames);
        startFrame += blockFrames;
      }
      return output;
    }
  };
}

export async function executeReferenceCase(type, testCase, input, options = {}) {
  const session = await createReferenceSession(type, {
    ...options,
    params: testCase.params,
    caseIndex: testCase.caseIndex ?? 0,
    seed: testCase.seed ?? noiseSeedForCase(testCase.caseIndex ?? 0)
  });
  const output = await session.process(input, testCase);
  return { output, jsEngineHash: session.jsEngineHash, baseSourceHash: session.baseSourceHash };
}
