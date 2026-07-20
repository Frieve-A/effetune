import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appendExternalAssetWarning,
  appendExternalAssetWarningSnapshot,
  captureExternalAssetWarning,
  collectExternalAssetInfo,
  collectUniquePipelinePlugins,
  formatExternalAssetWarning,
  formatMissingExternalAssetSummary
} from '../../js/ui/pipeline/external-asset-info.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('pipeline plugin collection includes A, B, and current without identity duplicates', () => {
  const pluginA = { name: 'A' };
  const pluginB = { name: 'B' };
  const currentOnly = { name: 'Current' };
  assert.deepEqual(
    collectUniquePipelinePlugins([pluginA], undefined, [pluginB, pluginA], [currentOnly, pluginB]),
    [pluginA, pluginB, currentOnly]
  );
});

test('generic external asset info warns for shares and presets without serializing asset data', () => {
  const plugin = {
    externalAssetInfo: {
      missing: false,
      kind: 'IR',
      ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      protectedIds: [
        'aaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbb',
        'bbbbbbbbbbbbbbbbbbbbbbbb'
      ],
      names: ['Measured Hall']
    }
  };
  assert.deepEqual(collectExternalAssetInfo([plugin]), [{
    missing: false,
    pending: false,
    kind: 'IR',
    ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
    protectedIds: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'],
    names: ['Measured Hall']
  }]);
  assert.equal(
    formatExternalAssetWarning([plugin]),
    'This pipeline references external IR data (Measured Hall). Recipients must import the same files; they are not included.'
  );
  assert.equal(
    appendExternalAssetWarning('Preset saved.', [plugin]),
    'Preset saved. This pipeline references external IR data (Measured Hall). Recipients must import the same files; they are not included.'
  );
  assert.equal(JSON.stringify(collectExternalAssetInfo([plugin])).includes('bytes'), false);
  assert.doesNotMatch(formatExternalAssetWarning([plugin]), /bbbbbbbbbbbbbbbbbbbbbbbb/);
});

test('protection-only external asset info is retained for deletion without producing warnings', () => {
  const plugin = {
    externalAssetInfo: {
      ids: [],
      names: [],
      protectedIds: ['aaaaaaaaaaaaaaaaaaaaaaaa']
    }
  };
  assert.deepEqual(collectExternalAssetInfo([plugin]), [{
    missing: false,
    pending: false,
    kind: '',
    ids: [],
    protectedIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
    names: []
  }]);
  assert.equal(formatExternalAssetWarning([plugin]), '');
  assert.equal(formatMissingExternalAssetSummary([plugin]), '');
  assert.equal(appendExternalAssetWarning('Preset saved.', [plugin]), 'Preset saved.');
});

test('pending-only external asset info is retained without producing warnings', () => {
  const plugin = {
    externalAssetInfo: {
      pending: true,
      kind: 'IR',
      ids: [],
      names: [],
      protectedIds: []
    }
  };
  assert.deepEqual(collectExternalAssetInfo([plugin]), [{
    missing: false,
    pending: true,
    kind: 'IR',
    ids: [],
    protectedIds: [],
    names: []
  }]);
  assert.equal(formatExternalAssetWarning([plugin]), '');
  assert.equal(formatMissingExternalAssetSummary([plugin]), '');
  assert.equal(appendExternalAssetWarning('Preset saved.', [plugin]), 'Preset saved.');
});

test('captured external asset warnings remain tied to the serialized pipeline snapshot', () => {
  const plugin = {
    externalAssetInfo: {
      missing: false,
      kind: 'IR',
      ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
      names: ['Original Hall']
    }
  };
  const warning = captureExternalAssetWarning([plugin]);

  plugin.externalAssetInfo.names = ['Replacement Hall'];

  assert.equal(
    appendExternalAssetWarningSnapshot('Copied.', warning),
    'Copied. This pipeline references external IR data (Original Hall). Recipients must import the same files; they are not included.'
  );
  assert.equal(appendExternalAssetWarningSnapshot('Copied.', ''), 'Copied.');
});

test('missing external asset summary is generic, deduplicated, and singular or plural', () => {
  const missing = (kind, ids) => ({
    externalAssetInfo: { missing: true, kind, ids, protectedIds: ['protected-only'], names: [] }
  });
  assert.equal(
    formatMissingExternalAssetSummary([missing('IR', ['a']), missing('IR', ['a'])]),
    'One external file could not be found. Import it or choose a substitute in the effect.'
  );
  assert.equal(
    formatMissingExternalAssetSummary([missing('IR', ['a']), missing('Sample', ['b'])]),
    '2 external files could not be found. Import them or choose substitutes in the effects.'
  );
  assert.equal(formatMissingExternalAssetSummary([{ externalAssetInfo: null }]), '');
});

test('external asset messages use the UI translator with parameter substitution', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    uiManager: {
      t(key, params) {
        if (key === 'externalAsset.warningNamed') return `translated ${params.kinds} ${params.names}`;
        if (key === 'externalAsset.missing.many') return `translated ${params.count}`;
        return key;
      }
    }
  };
  try {
    const plugin = { externalAssetInfo: { missing: true, kind: 'IR', ids: ['a', 'b'], names: ['Hall'] } };
    assert.equal(formatExternalAssetWarning([plugin]), 'translated IR Hall');
    assert.equal(formatMissingExternalAssetSummary([plugin]), 'translated 2');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('Japanese named external asset warning controls spacing and punctuation', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'js', 'locales', 'ja.json5'), 'utf8');
  const template = source.match(/"externalAsset\.warningNamed":\s*"([^"]+)"/)?.[1];
  assert.ok(template);
  const previousWindow = globalThis.window;
  globalThis.window = {
    uiManager: {
      t(key, params) {
        if (key !== 'externalAsset.warningNamed') return key;
        return Object.entries(params).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          template
        );
      }
    }
  };
  try {
    const plugin = {
      externalAssetInfo: {
        missing: true,
        kind: 'IR',
        ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'],
        names: ['Missing Test IR']
      }
    };
    const warning = formatExternalAssetWarning([plugin]);
    assert.equal(
      warning,
      'このパイプラインは外部のIRデータ（Missing Test IR）を参照しています。ファイル本体は含まれないため、受け取った側でも同じファイルを取り込む必要があります。'
    );
    assert.doesNotMatch(warning, / \(/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('IR library modal source includes filename search, sort, badges, decay preview, and actions', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'js', 'ir-library', 'browser.js'), 'utf8');
  const css = await fs.readFile(path.join(repoRoot, 'plugins', 'reverb', 'ir_reverb.css'), 'utf8');
  for (const pattern of [
    /Search filenames/,
    /Recently imported/,
    /entry\.channels/,
    /entry\.topology/,
    /entry\.sampleRate/,
    /drawDecay/,
    /Load/,
    /Delete/,
    /service\.delete\(entry\.irId,\s*\{\s*isInUse:/s,
    /collectUniquePipelinePlugins/,
    /collectExternalAssetInfo/,
    /info\.ids\.includes\(irId\)/,
    /info\.protectedIds\.includes\(irId\)/
  ]) assert.match(source, pattern);
  assert.doesNotMatch(source, /\bactiveIds\b/);
  assert.doesNotMatch(source, /\bprompt\s*\(/);
  assert.doesNotMatch(source, /Open source|\bEdit\b/);
  assert.match(css, /\.ir-library-dialog/);
  assert.match(css, /\.ir-library-decay/);
  assert.match(css, /\.ir-library-controls input\[type="search"\],[^}]*background: var\(--et-input-gradient,/s);
  assert.match(css, /\.ir-library-dialog\s*\{[^}]*background: var\(--et-panel-gradient,/s);
  assert.match(css, /\.ir-library-entry\s*\{[^}]*background: var\(--et-card-gradient,/s);
  assert.match(css, /\.ir-reverb-ui button,\s*\.ir-library-dialog button\s*\{[^}]*background: var\(--et-control-gradient,/s);
  assert.doesNotMatch(css, /\.ir-reverb-ui\s*\{[^}]*\bgap:/s);
});
