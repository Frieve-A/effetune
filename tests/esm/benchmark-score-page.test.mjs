import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { PluginManager } from '../../js/plugin-manager.js';
import {
  BENCHMARK_DSP_MODES,
  configureFirBenchmarkWorkload
} from '../../features/effetune-benchmark.js';
import * as scoreModule from '../../features/effetune-benchmark-score.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';

const html = readFileSync(new URL('../../features/effetune_bench.html', import.meta.url), 'utf8');
const pageScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import[\s\S]*?;\s*$/gm, '');
const { BENCHMARK_SCORE_EFFECTS, BENCHMARK_SCORE_PROTOCOL } = scoreModule;

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

function textOf(element) {
  return [element.textContent, ...element.children.map(textOf)].join(' ');
}

function createHarness({ variant = 'simd', useWasmDsp = true, missing = null, fail = null } = {}) {
  const document = createFakeDocument();
  document.body.innerHTML = html;
  const enhance = element => {
    element.append = (...children) => children.forEach(child => element.appendChild(child));
    element.replaceChildren = (...children) => {
      for (const child of [...element.children]) element.removeChild(child);
      element.append(...children);
    };
    element.classList = { add() {}, remove() {} };
    element.querySelectorAll = selector => {
      const parts = selector.toUpperCase().split(' ');
      return descendants(element).filter(child => {
        if (child.tagName !== parts.at(-1)) return false;
        if (parts.length === 1) return true;
        let parent = child.parentNode;
        while (parent && parent !== element) {
          if (parent.tagName === parts[0]) return true;
          parent = parent.parentNode;
        }
        return false;
      });
    };
    return element;
  };
  document.allElements.forEach(enhance);
  const createElement = document.createElement.bind(document);
  document.createElement = tagName => enhance(createElement(tagName));
  const events = {};
  const runtimes = [];
  const calls = [];
  const clipboard = [];
  let clock = 0;
  const pluginClasses = Object.fromEntries(BENCHMARK_SCORE_EFFECTS.map(({ name }) => [name, class {
    constructor() { this.name = name; }
    setParameters(parameters) { calls.push(['parameters', name, parameters]); }
    cleanup() { calls.push(['cleanup', name]); }
  }]));
  const context = vm.createContext({
    ...scoreModule,
    BENCHMARK_DSP_MODES,
    configureFirBenchmarkWorkload,
    BENCHMARK_SCORE_REFERENCE: {
      machine: '<reference PC>',
      effects: Object.fromEntries(BENCHMARK_SCORE_EFFECTS.map(({ name }) => [name, 1]))
    },
    PluginManager,
    document,
    Float32Array,
    window: {
      location: { href: 'https://example.test/features/effetune_bench.html' },
      addEventListener(type, callback) { events[type] = callback; }
    },
    startRendererWatchdogHeartbeat() {},
    loadAudioPreferences: async () => ({ useWasmDsp }),
    copyTextToClipboard: async text => { clipboard.push(text); return true; },
    alert() {},
    console: { error(...args) { calls.push(['error', ...args]); } },
    setTimeout(callback) { callback(); },
    performance: { now: () => (clock += 50) },
    createDspBenchmarkRuntime: async options => {
      calls.push(['runtime', options.sampleRate]);
      const usesWasm = options.mode !== BENCHMARK_DSP_MODES.JAVASCRIPT;
      const runtime = {
        options,
        variant: usesWasm ? variant : BENCHMARK_DSP_MODES.JAVASCRIPT,
        label: usesWasm
          ? (variant === 'simd' ? 'WebAssembly (SIMD)' : 'WebAssembly (baseline)')
          : 'JavaScript',
        usesWasm,
        sessions: [],
        closed: false,
        supportsPlugin: type => type !== missing,
        createPluginSession(plugin, settings) {
          const session = { settings, blocks: [], closed: false };
          runtime.sessions.push(session);
          calls.push(['session', plugin.name]);
          return {
            prepareAssets() { calls.push(['prepare', plugin.name]); },
            process(input, time) {
              if (plugin.name === fail) throw new Error('Internal DSP details');
              session.blocks.push({ input, time });
            },
            close() { session.closed = true; calls.push(['close-session', plugin.name]); }
          };
        },
        close() { runtime.closed = true; calls.push(['close-runtime', options.sampleRate]); }
      };
      runtimes.push(runtime);
      return runtime;
    }
  });
  vm.runInContext(pageScript, context, { filename: 'effetune_bench.html' });
  context.pluginClasses = pluginClasses;
  vm.runInContext(`
    TestPluginManager.prototype.loadPlugins = async function () {
      this.pluginClasses = pluginClasses;
      return {
        pluginClasses,
        pluginDefinitions: new Map(Object.keys(pluginClasses).map(name => [name, { category: 'Test' }]))
      };
    };
    const scoreTestManager = new TestPluginManager();
    scoreTestManager.pluginClasses = pluginClasses;
  `, context);
  return {
    context, document, events, calls, runtimes, clipboard,
    run: code => vm.runInContext(code, context),
    panel: () => document.getElementById('benchmark-score'),
    scorePass: mode => vm.runInContext(
      `runScorePass({ dspMode: '${mode}', preference: {}, manager: scoreTestManager })`, context)
  };
}

test('score panel, imports and controls preserve the English-only page contract', () => {
  assert.ok(html.indexOf('id="benchmark-status"') < html.indexOf('id="benchmark-score"'));
  assert.ok(html.indexOf('id="benchmark-score"') < html.indexOf('id="progress-container"'));
  assert.ok(html.indexOf('id="benchmark-score"') < html.indexOf('id="benchmark-table-container"'));
  assert.match(html, /from '\.\/effetune-benchmark-score\.js'/);
  assert.match(html, /from '\.\/benchmark-score-reference\.js'/);
  assert.match(html, /configureFirBenchmarkWorkload/);
  assert.match(html, /id="run-score"[^>]*>Score Only<\/button>/);
  assert.match(html, /EffeTune Score/);
  assert.doesNotMatch(html, /100 = reference PC/);
  assert.doesNotMatch(html, /renderBenchmarkScore\('…', benchmarkStatus\.textContent\)/);
  assert.match(html, /variant !== 'simd'/);
  assert.doesNotMatch(html, /data-i18n|benchmark-page-i18n/);
});

test('initial JavaScript preference and engine changes immediately gate score display and controls', async () => {
  const h = createHarness({ useWasmDsp: false });
  await h.events.load();
  assert.equal(h.document.getElementById('run-score').disabled, true);
  assert.equal(h.panel().children.length, 1);
  assert.equal(textOf(h.panel()).trim(), 'EffeTune Score requires WebAssembly (SIMD) processing.');
  assert.equal(h.runtimes.length, 0);
  const select = h.document.getElementById('dsp-mode');
  select.value = BENCHMARK_DSP_MODES.WEBASSEMBLY;
  await select.dispatchEvent('change');
  assert.equal(h.document.getElementById('run-score').disabled, false);
  assert.match(textOf(h.panel()), /Run Benchmarks to measure the score\./);
});

test('JavaScript creates no score runtime and baseline closes without processing any blocks', async () => {
  const h = createHarness({ variant: 'baseline' });
  await h.scorePass(BENCHMARK_DSP_MODES.JAVASCRIPT);
  assert.equal(h.runtimes.length, 0);
  await h.scorePass(BENCHMARK_DSP_MODES.WEBASSEMBLY);
  h.run('setBenchmarkRunning(false)');
  assert.equal(h.runtimes.length, 1);
  assert.equal(h.runtimes[0].sessions.length, 0);
  assert.equal(h.runtimes[0].closed, true);
  assert.equal(h.document.getElementById('run-score').disabled, true);
  assert.equal(h.panel().children.length, 1);
  assert.equal(h.run('benchmarkScoreText()'), '');
});

test('score warmup and repetitions reuse one session and preserve cyclic input order and numeric RTF', async () => {
  const h = createHarness();
  const result = await h.run(`(async () => {
    const runtime = await createDspBenchmarkRuntime({ sampleRate: BENCHMARK_SCORE_PROTOCOL.sampleRate });
    const audioBuffer = Float32Array.from({ length: 512 }, (_, index) => index);
    return measureScoreRtf(runtime, scoreTestManager.createPlugin('Delay'), audioBuffer);
  })()`);
  const [session] = h.runtimes[0].sessions;
  assert.equal(h.runtimes[0].sessions.length, 1);
  assert.equal(session.settings.channelCount, BENCHMARK_SCORE_PROTOCOL.channelCount);
  assert.equal(session.closed, true);
  assert.equal(session.blocks.length, 3 + 5 * BENCHMARK_SCORE_PROTOCOL.repetitions);
  assert.equal(h.calls.filter(([type]) => type === 'prepare').length, 1);
  session.blocks.forEach(({ input, time }, index) => {
    assert.equal(input.length, 256);
    assert.equal(input[0], (index % 2) * 256);
    assert.equal(time, index * BENCHMARK_SCORE_PROTOCOL.blockSize / BENCHMARK_SCORE_PROTOCOL.sampleRate);
    if (index > 0) assert.notEqual(input, session.blocks[index - 1].input);
  });
  assert.equal(result, Math.round(5 * BENCHMARK_SCORE_PROTOCOL.blockSize / 0.35) /
    BENCHMARK_SCORE_PROTOCOL.sampleRate);
});

test('complete SIMD score uses the fixed protocol, renders all effects and can be copied without details', async () => {
  const h = createHarness();
  h.document.getElementById('sample-rate').value = '48000';
  await h.scorePass(BENCHMARK_DSP_MODES.WEBASSEMBLY);
  assert.equal(h.runtimes[0].options.sampleRate, BENCHMARK_SCORE_PROTOCOL.sampleRate);
  assert.equal(h.runtimes[0].options.blockSize, BENCHMARK_SCORE_PROTOCOL.blockSize);
  assert.equal(h.runtimes[0].sessions.length, BENCHMARK_SCORE_EFFECTS.length);
  assert.ok(h.runtimes[0].sessions.every(session => session.closed));
  assert.equal(h.runtimes[0].closed, true);
  assert.match(textOf(h.panel()), /Score v1 · WebAssembly \(SIMD\) · 96kHz \/ 2ch \/ 128 frames/);
  assert.doesNotMatch(textOf(h.panel()), /reference PC/);
  const breakdown = h.panel().children.find(child => child.className === 'benchmark-score-breakdown');
  assert.equal(breakdown.children.length, BENCHMARK_SCORE_EFFECTS.length);
  for (const { name, parameters } of BENCHMARK_SCORE_EFFECTS) {
    assert.ok(textOf(breakdown).includes(name));
    if (parameters) assert.ok(h.calls.some(call => call[0] === 'parameters' && call[1] === name));
  }
  const copy = descendants(h.panel()).find(child => child.tagName === 'BUTTON');
  await copy.dispatchEvent('click');
  assert.match(h.clipboard[0], /^EffeTune Score v1\t/);
  assert.ok(h.clipboard[0].includes('Pitch Shifter HQ\t'));
});

test('unavailable or failed effects suppress partial scores and preserve cleanup and plain-language errors', async () => {
  for (const options of [{ missing: 'BitCrusherPlugin' }, { fail: 'Delay' }]) {
    const h = createHarness(options);
    await h.scorePass(BENCHMARK_DSP_MODES.WEBASSEMBLY);
    assert.match(textOf(h.panel()), /N\/A/);
    assert.doesNotMatch(textOf(h.panel()), /Internal DSP details/);
    assert.equal(h.run('benchmarkScoreText()'), '');
    assert.ok(h.runtimes[0].sessions.every(session => session.closed));
    assert.equal(h.runtimes[0].closed, true);
    assert.equal(descendants(h.panel()).some(child => child.tagName === 'BUTTON'), false);
  }
});

test('Score Only preserves detail results and restores every control after loading fails', async () => {
  const h = createHarness();
  await h.events.load();
  const details = h.document.getElementById('benchmark-table-container');
  details.textContent = 'Existing detailed results';
  h.context.observedDisabled = [];
  h.run(`TestPluginManager.prototype.loadPlugins = async function () {
    for (const id of ['run-benchmarks', 'run-score', 'sample-rate', 'dsp-mode']) {
      observedDisabled.push(document.getElementById(id).disabled);
    }
    throw new Error('Plugin script unavailable');
  };`);
  await h.run('runScoreOnly()');
  assert.equal(details.textContent, 'Existing detailed results');
  assert.match(textOf(h.panel()), /N\/A/);
  assert.equal(h.runtimes.length, 0);
  assert.deepEqual(h.context.observedDisabled, [true, true, true, true]);
  for (const id of ['run-benchmarks', 'run-score', 'sample-rate', 'dsp-mode']) {
    assert.equal(h.document.getElementById(id).disabled, false);
  }
});

test('full benchmarks close their fixed score runtime before creating the selected-rate detail runtime', async () => {
  const h = createHarness();
  await h.events.load();
  h.document.getElementById('sample-rate').value = '48000';
  await h.run('runBenchmarks()');
  assert.deepEqual(h.runtimes.map(runtime => runtime.options.sampleRate), [96000, 48000]);
  assert.ok(h.calls.findIndex(call => call[0] === 'close-runtime' && call[1] === 96000) <
    h.calls.findIndex(call => call[0] === 'runtime' && call[1] === 48000));
  assert.ok(h.runtimes.every(runtime => runtime.closed));
  const details = h.document.getElementById('benchmark-table-container');
  assert.equal(descendants(details).filter(element => element.tagName === 'TABLE').length, 1);
  const copy = descendants(details).find(element =>
    element.className === 'copy-benchmark-result-button');
  await copy.dispatchEvent('click');
  assert.match(h.clipboard[0], /^EffeTune Score v1\t/);
  assert.ok(h.clipboard[0].includes('Category\tEffect\tImplementation\tSamples/sec'));
  h.document.getElementById('dsp-mode').value = BENCHMARK_DSP_MODES.JAVASCRIPT;
  await h.document.getElementById('dsp-mode').dispatchEvent('change');
  await copy.dispatchEvent('click');
  assert.match(h.clipboard[1], /^Category\tEffect\tImplementation\tSamples\/sec/);
});

test('JavaScript detail benchmarks skip FIR effects that require convolution assets', async () => {
  const h = createHarness({ useWasmDsp: false });
  await h.events.load();
  h.run(`
    pluginClasses = Object.fromEntries([
      'FIR Crossover',
      '5Band FIR PEQ',
      'Group Delay EQ',
      'Group Delay PEQ'
    ].map(name => [name, class {
      constructor() { this.name = name; }
      getParameters() { return {}; }
    }]));
  `);

  await h.run('runBenchmarks()');

  assert.equal(h.runtimes.length, 1);
  assert.equal(h.runtimes[0].usesWasm, false);
  assert.equal(h.runtimes[0].sessions.length, 0);
  const details = h.document.getElementById('benchmark-table-container');
  const rows = descendants(details).filter(element => element.tagName === 'TR').slice(1);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.children[3].textContent, 'N/A');
    assert.match(row.children[6].textContent, /requires WebAssembly DSP/);
  }
});

test('benchmark result headers sort every column and toggle ascending and descending order', async () => {
  const h = createHarness();
  const table = h.run(`createBenchmarkResultsTable([
    {
      category: 'Utility', name: 'Effect 10', implementation: 'JavaScript',
      samplesPerSecond: 2000, speedupFactor: '2.0', skipped: false, note: 'Beta'
    },
    {
      category: 'Equalizer', name: 'Effect 2', implementation: 'WebAssembly',
      samplesPerSecond: 1000, speedupFactor: '4.0', skipped: false, note: 'Alpha'
    },
    {
      category: 'Other', name: 'Unavailable', implementation: 'JavaScript',
      samplesPerSecond: null, speedupFactor: null, skipped: true, note: ''
    }
  ])`);
  const [thead, tbody] = table.children;
  const headers = thead.children[0].children;
  const buttons = headers.map(header => header.children[0]);
  const firstColumn = () => tbody.children.map(row => row.children[0].textContent);

  assert.equal(buttons.length, 7);
  assert.ok(headers.every(header => header.getAttribute('aria-sort') === 'none'));

  await buttons[0].dispatchEvent('click');
  assert.deepEqual(firstColumn(), ['Equalizer', 'Other', 'Utility']);
  assert.equal(headers[0].getAttribute('aria-sort'), 'ascending');
  assert.match(buttons[0].children[1].innerHTML, /M12 19V5/);

  await buttons[0].dispatchEvent('click');
  assert.deepEqual(firstColumn(), ['Utility', 'Other', 'Equalizer']);
  assert.equal(headers[0].getAttribute('aria-sort'), 'descending');
  assert.match(buttons[0].children[1].innerHTML, /M12 5v14/);

  for (const button of buttons.slice(1)) {
    await button.dispatchEvent('click');
  }
  assert.equal(headers[6].getAttribute('aria-sort'), 'ascending');
  assert.ok(headers.slice(0, 6).every(header => header.getAttribute('aria-sort') === 'none'));

  await buttons[3].dispatchEvent('click');
  assert.deepEqual(
    tbody.children.map(row => row.children[3].textContent),
    ['1,000', '2,000', 'N/A']
  );
});
