import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { build } from 'esbuild';

// Intercept file requests so this test needs no local HTTP server.
const origin = 'https://effetune.test';
const scripts = new Map([
    '/js/audio/dsp-module-warmup.js',
    '/js/audio/dsp-module-warmup-worker.js',
    '/js/audio/dsp-engine-binding.js'
].map(path => [path, readFileSync(new URL(`../..${path}`, import.meta.url), 'utf8')]));

test('Rhythm Analyzer worker warm-up leaves first audio-worklet creation short and analysis pristine',
    { timeout: 120000 }, async t => {
        const browser = await chromium.launch({ headless: true });
        try {
            const bundle = await build({
                entryPoints: [fileURLToPath(new URL('../../js/audio/dsp-engine-binding.js', import.meta.url))],
                bundle: true, format: 'iife', globalName: 'WarmupBinding', write: false
            });
            for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
                const page = await browser.newPage();
                await page.route(`${origin}/**`, async route => {
                    const path = new URL(route.request().url()).pathname;
                    if (scripts.has(path)) {
                        await route.fulfill({ contentType: 'text/javascript', body: scripts.get(path) });
                    } else if (path === '/') {
                        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
                    } else await route.abort();
                });
                await page.goto(origin);
                const bytes = [...readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url))];
                const results = await page.evaluate(async ({ bytes, bindingSource }) => {
                    const { warmUpDspModule } = await import('/js/audio/dsp-module-warmup.js');
                    const module = await WebAssembly.compile(new Uint8Array(bytes));
                    const info = { module, moduleCloneable: true };
                    const results = [];
                    for (const sampleRate of [44100, 48000, 96000]) {
                        const prepared = await warmUpDspModule(info, sampleRate);
                        const context = new OfflineAudioContext(2, sampleRate * 18, sampleRate);
                        const source = `
                            ${bindingSource}
                            class Probe extends AudioWorkletProcessor {
                                constructor(options) {
                                    super();
                                    const instance = new WebAssembly.Instance(options.processorOptions.module,
                                        WarmupBinding.createDspImports());
                                    this.binding = new WarmupBinding.DspEngineBinding(instance);
                                    const b = this.binding;
                                    b.createEngine();
                                    b.prepare(sampleRate, 2, 128, 262144);
                                    const start = Date.now();
                                    this.id = b.createInstance('RhythmAnalyzerPlugin');
                                    this.createMs = Date.now() - start;
                                    b.instanceSetTap(this.id, 213);
                                    this.arena = b.getArenaViews();
                                    this.packet = new ArrayBuffer(262144);
                                    // Sample pristine state before the first 10.667 ms decoder tick.
                                    b.setTelemetryRate(240);
                                    const pristineBlocks = Math.ceil(sampleRate / (240 * 128));
                                    for (let block = 0; block < pristineBlocks; block++) {
                                        this.arena.combined.fill(0, 0, 256);
                                        b.instanceProcess(this.id, this.arena.offsets.combined, 2, 128, block * 128 / sampleRate);
                                    }
                                    const pristineBytes = b.telemetryRead(this.packet);
                                    this.pristineFrame = [...new Uint8Array(this.packet, 0, pristineBytes)];
                                    this.prerollFrames = pristineBlocks * 128;
                                    b.setTelemetryRate(60);
                                    this.maxBlockMs = 0;
                                    this.passthrough = true;
                                    this.blocks = 0;
                                    this.seed = 0x1234567;
                                    this.firstFrame = null;
                                }
                                process() {
                                    if (!this.id) return true;
                                    const b = this.binding, arena = this.arena;
                                    for (let i = 0; i < 128; i++) {
                                        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
                                        const time = (this.blocks * 128 + i) / sampleRate;
                                        const u = time % .25;
                                        const x = .12 * (this.seed / 2147483648 - 1) * Math.exp(-u / .012) +
                                            .7 * Math.sin(2 * Math.PI * 50 * u) * Math.exp(-u / .12);
                                        arena.combined[i] = arena.combined[128 + i] = x;
                                    }
                                    const expected = arena.combined.slice(0, 256);
                                    const start = Date.now();
                                    b.instanceProcess(this.id, arena.offsets.combined, 2, 128,
                                        (this.prerollFrames + this.blocks * 128) / sampleRate);
                                    this.maxBlockMs = Math.max(this.maxBlockMs, Date.now() - start);
                                    this.passthrough &&= expected.every((value, i) => Math.abs(value - arena.combined[i]) < 1e-18);
                                    if (this.blocks % 32 === 31) {
                                        const bytes = b.telemetryRead(this.packet);
                                        if (bytes && !this.firstFrame) this.firstFrame = [...new Uint8Array(this.packet, 0, bytes)];
                                    }
                                    if (++this.blocks === Math.ceil(sampleRate * 18 / 128)) {
                                        this.port.postMessage({ createMs: this.createMs, maxBlockMs: this.maxBlockMs,
                                            passthrough: this.passthrough, pristineFrame: this.pristineFrame,
                                            firstFrame: this.firstFrame });
                                    }
                                    return true;
                                }
                            }
                            registerProcessor('probe', Probe);
                        `;
                        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                        await context.audioWorklet.addModule(url);
                        URL.revokeObjectURL(url);
                        const node = new AudioWorkletNode(context, 'probe', { processorOptions: { module: prepared.module } });
                        const done = new Promise(resolve => { node.port.onmessage = ({ data }) => resolve(data); });
                        node.connect(context.destination);
                        await context.startRendering();
                        results.push({ sampleRate, ...await done });
                    }
                    return results;
                }, { bytes, bindingSource: bundle.outputFiles[0].text });
                const { parseTelemetryPacket } = await import('../../js/audio/telemetry-hub.js');
                for (const result of results) {
                    t.diagnostic(`${artifact} ${result.sampleRate} Hz: create ${result.createMs} ms, max block ${result.maxBlockMs} ms`);
                    // A generous regression ceiling avoids treating host scheduling noise as a DSP failure;
                    // the old synchronous 15.5 s warm-up takes over 200 ms on the reference host.
                    assert.ok(result.createMs < 50, `initial creation stalled for ${result.createMs} ms`);
                    assert.equal(result.passthrough, true);
                    const pristinePacket = Uint8Array.from(result.pristineFrame);
                    let pristine;
                    assert.equal(parseTelemetryPacket(pristinePacket, pristinePacket.byteLength,
                        frame => { pristine ??= frame; }).ok, true);
                    assert.ok(pristine, 'the live instance emits a pristine telemetry snapshot');
                    assert.equal(pristine.frameType, 28);
                    assert.equal(pristine.formatVersion, 4);
                    assert.equal(pristine.payload.getUint32(12, true), 0, 'no decoder tick or silence reset has run');
                    assert.equal(pristine.payload.getUint32(32, true), 0, 'no shown beat reaches the live instance');
                    assert.equal(pristine.payload.getFloat32(40, true), 0, 'no warm-up confidence reaches the live instance');
                    assert.equal(pristine.payload.getFloat32(44, true), 0, 'no warm-up committed period reaches the live instance');
                    assert.equal(pristine.payload.getUint32(28, true), 0, 'no warm-up event reaches the live instance');
                    assert.equal(pristine.payload.getUint32(1344, true), 0, 'no warm-up preview reaches the live instance');
                    const packet = Uint8Array.from(result.firstFrame);
                    let first;
                    assert.equal(parseTelemetryPacket(packet, packet.byteLength, frame => { first ??= frame; }).ok, true);
                    assert.ok(first.payload.getFloat32(16, true) < .2, 'analysis starts on the real input timeline');
                }
                await page.close();
            }
        } finally {
            await browser.close();
        }
    });
