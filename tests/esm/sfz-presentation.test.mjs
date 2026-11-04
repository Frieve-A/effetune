import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseSfz } from '../../js/sfz/parser.js';
import { prepareSfzPresentation } from '../../js/sfz/service.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
const parse = source => parseSfz({ selectedPath: 'bank/instrument.sfz', readText: async () => source,
  hasSample: () => true, onDiagnostic: null });

test('instrument presentation uses actual inherited groups and last declared image and control labels', async () => {
  const parsed = await parse('<control> image=first.png label_key60=Middle C label_cc1=Vibrato label_output0=Main\n' +
    'hint_ram_based=1 label_cc1=Modulation\n<global> image=last.png sw_lokey=24 sw_hikey=36\n' +
    '<group> group_label=Strings sw_last=24 sw_label=Legato\n<region> sample=a.wav\n' +
    '<region> sample=b.wav sw_last=26 sw_label=Pizzicato');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.diagnostics.excludedOpcodes, ['hint_ram_based']);
  assert.deepEqual(parsed.presentation, { keys: [{ index: 60, label: 'Middle C' }],
    controllers: [{ index: 1, label: 'Modulation' }], outputs: [{ index: 0, label: 'Main' }],
    groups: ['Strings'], switches: [{ first: 24, last: 24, label: 'Legato' }, { first: 26, last: 26, label: 'Pizzicato' }],
    image: 'bank/last.png' });
  const prepared = await prepareSfzPresentation(parsed, path => {
    assert.equal(path, 'bank/last.png'); return Uint8Array.of(1, 2, 3);
  });
  assert.equal(prepared.imageBlob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await prepared.imageBlob.arrayBuffer()), Uint8Array.of(1, 2, 3));
});

test('instrument image references stay inside the granted folder and missing images are useful errors', async () => {
  await assert.rejects(parse('<control> image=../../escape.png <region> sample=a.wav'), { code: 'prepare' });
  const parsed = await parse('<region> sample=a.wav image=missing.bmp');
  await assert.rejects(prepareSfzPresentation(parsed, () => null), /image could not be found.*complete folder/);
  await assert.rejects(parse('<control> label_key128=Outside <region> sample=a.wav'), { code: 'prepare' });
});

test('global master and region labels describe only effective playable scopes', async () => {
  const parsed = await parse('<global> global_label=Collection <master> master_label=Wind <group> group_label=Solo ' +
    '<region> sample=a.wav region_label=Flute <region> sample=b.wav region_label=Oboe ' +
    '<master> master_label=Strings <region> sample=c.wav region_label=Violin');
  assert.deepEqual(parsed.unsupportedOpcodes, []);
  assert.deepEqual(parsed.presentation.scopes, [{ scope: 'global', label: 'Collection' },
    { scope: 'master', label: 'Wind' }, { scope: 'region', label: 'Flute' }, { scope: 'region', label: 'Oboe' },
    { scope: 'master', label: 'Strings' }, { scope: 'region', label: 'Violin' }]);
  assert.deepEqual(parsed.presentation.groups, ['Solo']);
});

test('details render safe text and native-selected labels per channel, and release image URLs', () => {
  const document = createFakeDocument(), revoked = [];
  const createElement = document.createElement.bind(document);
  document.createElement = name => {
    const element = createElement(name);
    element.append = (...children) => children.forEach(child => element.appendChild(child));
    element.replaceChildren = (...children) => {
      for (const child of [...element.children]) element.removeChild(child);
      element.append(...children);
    };
    return element;
  };
  const window = { URL: { createObjectURL: () => 'blob:instrument', revokeObjectURL: value => revoked.push(value) } };
  class PluginBase { cleanup() {} }
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/sfz-instrument.js', import.meta.url), 'utf8'), { window, document, PluginBase });
  const plugin = new window.SFZInstrumentPlugin();
  plugin._resetLoadNotice = () => {};
  const details = plugin._createInstrumentDetails();
  assert.equal(details.hidden, true);
  plugin._setInstrumentPresentation({ keys: [{ index: 60, label: '<script>never markup</script>' }],
    switches: [{ first: 24, last: 24, label: 'Legato' }, { first: 26, last: 26, label: 'Pizzicato' }],
    imageBlob: new Blob([Uint8Array.of(1)]) });
  assert.equal(details.hidden, false);
  const definitions = details.children[1].children.at(-1);
  assert.equal(definitions.children[1].textContent, '<script>never markup</script>');
  assert.equal(plugin._currentSwitchLabels.hidden, true, 'No guessed active label before native observation');
  plugin._activeSwitches = [24, 26];
  plugin._renderActiveSwitchLabels();
  assert.equal(plugin._currentSwitchLabels.textContent, 'Keyswitch · Channel 1: Legato · Channel 2: Pizzicato');
  plugin.mc = 2; plugin._renderActiveSwitchLabels();
  assert.equal(plugin._currentSwitchLabels.textContent, 'Keyswitch · Channel 2: Pizzicato');
  plugin._setInstrumentPresentation(null);
  assert.deepEqual(revoked, ['blob:instrument']);
  assert.equal(details.hidden, true);
  plugin.cleanup();
});
