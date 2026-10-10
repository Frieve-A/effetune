import assert from 'node:assert/strict';
import test from 'node:test';
import { openSfzLibraryBrowser } from '../../js/sfz/browser.js';
import { SfzLibraryService } from '../../js/sfz/service.js';
import { Element, flatten, byClass, button, rowName, deferred, nextTurn } from '../helpers/asset-library-browser.mjs';
import { withGlobals, createConsoleHarness } from '../helpers/global-test-utils.mjs';

const encode = text => new TextEncoder().encode(text);
const file = (name, text) => ({ name, size: encode(text).length,
  async arrayBuffer() { return encode(text).buffer; } });
const decode = () => ({ sampleRate: 48000, channels: [new Float32Array([0.1, 0.2, 0.3])] });
const input = (modal, type) => flatten(modal.element).find(node => node.tagName === 'INPUT' && node.type === type);
const rows = modal => byClass(modal.element, 'ir-library-entry');

async function harness(callback, window = {}) {
  const body = new Element('body');
  const document = { body, createElement: tag => new Element(tag) };
  return withGlobals({ document, window, console: createConsoleHarness({ error() {} }) }, () => callback(body));
}

async function library() {
  const files = new Map();
  return new SfzLibraryService({
    async read(name) { return files.get(name) || null; },
    async writeAtomic(name, bytes) { files.set(name, bytes.slice()); },
    async remove(name) { files.delete(name); }
  }, { onDiagnostic: null }).open();
}

test('SFZ library uses the IR layout without decay and filters, sorts, loads and bulk deletes', async () => {
  await harness(async body => {
    let entries = [
      { id: 'a'.repeat(24), name: 'Alpha.sfz', size: 1048576, fileCount: 8, regionCount: 12,
        importedAt: '2026-01-01T00:00:00Z' },
      { id: 'b'.repeat(24), name: 'Bravo.sfz', importedAt: '2026-02-01T00:00:00Z' },
      { id: 'c'.repeat(24), name: 'Cello.sfz', size: 512, fileCount: 1, regionCount: 1 }
    ];
    const removed = [];
    let loaded;
    const service = {
      async list() { return entries; },
      async readMetadata() { return { size: 2048, fileCount: 3, regionCount: 5 }; },
      async remove(id) { removed.push(id); entries = entries.filter(entry => entry.id !== id); }
    };
    const modal = openSfzLibraryBrowser({ service, onLoad: entry => { loaded = entry; },
      audioManager: { pipelineB: [{ externalAssetInfo: { kind: 'SFZ', ids: ['b'.repeat(24)] } }] } });
    await modal.render();
    await nextTurn();
    assert.equal(byClass(modal.element, 'ir-library-dialog').length, 1);
    assert.equal(flatten(modal.element).find(node => node.tagName === 'H2').textContent, 'SFZ Library');
    assert.equal(byClass(modal.element, 'ir-library-decay').length, 0);
    assert.deepEqual(rows(modal).map(rowName), ['Alpha.sfz', 'Bravo.sfz', 'Cello.sfz']);
    assert.equal(byClass(rows(modal)[0], 'ir-library-badge')[0].textContent, '1.0 MiB · Files: 8 · Regions: 12');
    assert.equal(byClass(rows(modal)[1], 'ir-library-badge')[0].textContent, '2.0 KiB · Files: 3 · Regions: 5');
    const search = input(modal, 'search');
    search.value = 'BRAVO';
    await search.dispatch('input');
    assert.deepEqual(rows(modal).map(rowName), ['Bravo.sfz']);
    const selectAll = button(modal.element, 'Select all');
    const deselectAll = button(modal.element, 'Deselect all');
    const selectionCount = byClass(modal.element, 'ir-library-selection-count')[0];
    await selectAll.click();
    assert.equal(selectionCount.textContent, '1 selected');
    assert.equal(byClass(rows(modal)[0], 'ir-library-entry-selection')[0].checked, true);
    assert.equal(selectAll.disabled, true);
    await deselectAll.click();
    assert.equal(selectionCount.textContent, '0 selected');
    assert.equal(byClass(rows(modal)[0], 'ir-library-entry-selection')[0].checked, false);
    search.value = 'missing';
    await search.dispatch('input');
    assert.equal(selectAll.disabled, true);
    assert.equal(deselectAll.disabled, true);
    search.value = '';
    await search.dispatch('input');
    const sort = flatten(modal.element).find(node => node.tagName === 'SELECT');
    sort.value = 'recent';
    await sort.dispatch('change');
    assert.deepEqual(rows(modal).map(rowName), ['Bravo.sfz', 'Alpha.sfz', 'Cello.sfz']);
    await selectAll.click();
    assert.equal(selectionCount.textContent, '3 selected');
    assert.equal(byClass(modal.element, 'ir-library-entry-selection').every(node => node.checked), true);
    await button(modal.element, 'Delete selected').click();
    assert.deepEqual(removed.sort(), ['a'.repeat(24), 'c'.repeat(24)]);
    assert.equal(byClass(modal.element, 'ir-library-status')[0].textContent, '2 deleted, 1 in use, 0 failed.');
    await button(rows(modal)[0], 'Load').click();
    assert.equal(loaded.id, 'b'.repeat(24));
    assert.equal(body.children.length, 0);
  }, { confirm: () => true });
});

test('SFZ library imports all instruments with their samples and retains successful partial imports', async () => {
  await harness(async () => {
    const service = await library();
    const modal = openSfzLibraryBrowser({ service, decode });
    const files = [file('Piano.sfz', '<region> sample=tone.wav key=60'),
      file('Synth.sfz', '<region> sample=*sine key=60'),
      file('Broken.sfz', '<region> sample=missing.wav'), file('tone.wav', 'audio')];
    const folder = flatten(modal.element).find(node => node.tagName === 'INPUT' && node.webkitdirectory);
    assert.equal(folder.accept, '', 'Folder selection must retain sample and include files');
    await button(modal.element, 'Import folder…').click();
    assert.equal(folder.clickCount, 1);
    folder.files = files;
    await folder.dispatch('change');
    assert.deepEqual(rows(modal).map(rowName), ['Piano.sfz', 'Synth.sfz']);
    assert.equal((await service.list()).length, 2);
    assert.equal(byClass(modal.element, 'ir-library-status')[0].textContent, '2 imported, 1 failed.');
    assert.match(byClass(rows(modal)[0], 'ir-library-badge')[0].textContent, /Files: 2 · Regions: 1/);
    const filesInput = flatten(modal.element).find(node => node.tagName === 'INPUT' && node.type === 'file' && !node.webkitdirectory);
    filesInput.files = [file('New.sfz', '<region> sample=*triangle key=61')];
    await filesInput.dispatch('change');
    assert.equal((await service.list()).length, 3);
    modal.dispose();
  });
});

test('SFZ library desktop file and folder actions register references without copying samples', async () => {
  await harness(async () => {
    const calls = [];
    let entries = [];
    const service = {
      async list() { return entries; },
      async selectFiles() { calls.push('files'); return entries = [{ id: 'a'.repeat(24), name: 'Piano.sfz' }]; },
      async selectFolder() { calls.push('folder'); return entries = [...entries, { id: 'b'.repeat(24), name: 'Cello.sfz' }]; },
      async readMetadata() { return { size: 2048, fileCount: 3, regionCount: 2 }; },
      importFolderFiles() { assert.fail('Native selections must not copy a bank'); }
    };
    const modal = openSfzLibraryBrowser({ service });
    await button(modal.element, 'Import files…').click();
    await button(modal.element, 'Import folder…').click();
    await nextTurn();
    assert.deepEqual(calls, ['files', 'folder']);
    assert.deepEqual(rows(modal).map(rowName), ['Cello.sfz', 'Piano.sfz']);
    assert.equal(byClass(rows(modal)[0], 'ir-library-badge')[0].textContent, '2.0 KiB · Files: 3 · Regions: 2');
    modal.dispose();
  });
});

test('SFZ library directory picker keeps relative files and cancellation stops after the admitted instrument', async () => {
  const directory = { async *entries() {
    for (const name of ['Alpha.sfz', 'Bravo.sfz']) yield [name, { kind: 'file',
      getFile: async () => file(name, '<region> sample=*sine key=60') }];
  } };
  await harness(async body => {
    const pending = deferred();
    const started = deferred();
    const imported = [];
    const service = {
      async list() { return imported; },
      async importFolderFiles(files, path) {
        assert.equal(files.length, 2);
        started.resolve();
        await pending.promise;
        const entry = { id: 'a'.repeat(24), name: path };
        imported.push(entry);
        return entry;
      }
    };
    const modal = openSfzLibraryBrowser({ service });
    const operation = button(modal.element, 'Import folder…').click();
    await started.promise;
    const closing = modal.close();
    assert.equal(body.children.length, 1);
    pending.resolve();
    await operation;
    await closing;
    assert.deepEqual(imported.map(entry => entry.name), ['Alpha.sfz']);
    assert.equal(body.children.length, 0);
  }, { showDirectoryPicker: async () => directory, confirm: () => true });
});

test('SFZ library asynchronous refresh ignores a stale listing and reports read failures plainly', async () => {
  await harness(async () => {
    const pending = deferred();
    let calls = 0;
    const service = { list() {
      if (++calls === 1) return pending.promise;
      if (calls > 2) throw new Error('private path and error');
      return Promise.resolve([{ id: 'b'.repeat(24), name: 'Current.sfz' }]);
    } };
    const modal = openSfzLibraryBrowser({ service });
    await modal.render();
    pending.resolve([{ id: 'a'.repeat(24), name: 'Stale.sfz' }]);
    await nextTurn();
    assert.deepEqual(rows(modal).map(rowName), ['Current.sfz']);
    await modal.render();
    assert.equal(byClass(modal.element, 'ir-library-status')[0].textContent,
      'The library could not be read. Please try again.');
    modal.dispose();
  });
});

test('SFZ metadata reads run one at a time and closing the library stops queued reads', async () => {
  await harness(async () => {
    const pending = deferred();
    const calls = [];
    const entries = ['a', 'b'].map(letter => ({ id: letter.repeat(24), name: `${letter}.sfz` }));
    const modal = openSfzLibraryBrowser({ service: {
      list: async () => entries,
      readMetadata(id) { calls.push(id); return pending.promise; }
    } });
    await modal.render();
    await nextTurn();
    assert.deepEqual(calls, ['a'.repeat(24)]);
    modal.dispose();
    pending.resolve({ size: 1024, fileCount: 2, regionCount: 1 });
    await nextTurn();
    assert.deepEqual(calls, ['a'.repeat(24)]);
  });
});
