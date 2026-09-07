import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = await fs.readFile(new URL('../../plugins/theme-palette.js', import.meta.url), 'utf8');

function createPalette(globals = {}) {
  const context = vm.createContext({ window: {}, ...globals });
  vm.runInContext(source, context);
  return context.window.ThemePalette;
}

function createProbeHarness() {
  const probes = [];
  let reads = 0;
  let computed = 'rgb(1, 2, 3)';
  const palette = createPalette({
    document: {
      createElement: () => ({ style: {} }),
      documentElement: { appendChild: probe => probes.push(probe) }
    },
    getComputedStyle(probe) {
      assert.equal(probe, probes[0]);
      reads += 1;
      return { color: computed };
    }
  });
  return { palette, probes, reads: () => reads, setColor: value => { computed = value; } };
}

test('theme palette is harmless without a DOM or computed styles', () => {
  for (const globals of [{}, { document: {} }, { getComputedStyle() {} },
    { document: { documentElement: {} } }]) {
    const palette = createPalette(globals);
    assert.equal(palette.get('graph-trace'), '');
    assert.doesNotThrow(() => palette.refresh());
  }
});

test('theme palette resolves RGB and sRGB probe values to canvas RGBA colors', () => {
  const h = createProbeHarness();
  for (const [input, expected] of [
    ['rgb(1, 2, 3)', 'rgba(1, 2, 3, 1)'],
    ['rgba(1, 2, 3, 0.5)', 'rgba(1, 2, 3, 0.5)'],
    ['color(srgb 0 0.5 1)', 'rgba(0, 127.5, 255, 1)'],
    ['color(srgb 0 0.5 1 / 0.25)', 'rgba(0, 127.5, 255, 0.25)']
  ]) {
    h.setColor(input);
    h.palette.refresh();
    assert.equal(h.palette.get('graph-trace'), expected);
  }
  assert.equal(h.probes.length, 1);
  assert.equal(h.probes[0].style.color, 'var(--et-graph-trace)');
  assert.equal(h.probes[0].style.display, 'none');
});

test('theme palette caches each token until refresh and reuses its single probe', () => {
  const h = createProbeHarness();
  assert.equal(h.palette.get('graph-trace'), 'rgba(1, 2, 3, 1)');
  h.setColor('rgb(4, 5, 6)');
  assert.equal(h.palette.get('graph-trace'), 'rgba(1, 2, 3, 1)');
  assert.equal(h.reads(), 1);
  assert.equal(h.palette.get('graph-label'), 'rgba(4, 5, 6, 1)');
  assert.equal(h.reads(), 2);
  h.palette.refresh();
  assert.equal(h.palette.get('graph-trace'), 'rgba(4, 5, 6, 1)');
  assert.equal(h.reads(), 3);
  assert.equal(h.probes.length, 1);
});

test('drawing consumers use optional access to the palette', async () => {
  const violations = [];
  for (const root of ['plugins', 'js', 'features']) {
    for (const entry of await fs.readdir(path.join(repoRoot, root), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(repoRoot, absolute).replaceAll('\\', '/');
      if (relative.startsWith('plugins/dsp/') || relative.startsWith('js/vendor/') ||
        relative === 'plugins/theme-palette.js') continue;
      const lines = (await fs.readFile(absolute, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (line.includes('ThemePalette.get(') && !line.includes('?.get(')) violations.push(`${relative}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(violations, []);
});

test('theme palette stub is scoped to the supplied window', () => {
  const windowLike = {};
  const palette = installThemePaletteStub(windowLike);
  assert.equal(windowLike.ThemePalette, palette);
  assert.equal(palette.get('graph-trace'), 'stub:graph-trace');
  assert.doesNotThrow(() => palette.refresh());
  assert.equal(globalThis.ThemePalette, undefined);
});
