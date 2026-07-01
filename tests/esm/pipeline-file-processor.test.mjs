import assert from 'node:assert/strict';
import test from 'node:test';

import { FileProcessor } from '../../js/ui/pipeline/file-processor.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  _tokens() {
    return new Set(String(this.element.className || '').split(/\s+/).filter(Boolean));
  }

  _write(tokens) {
    this.element.className = [...tokens].join(' ');
  }

  add(token) {
    const tokens = this._tokens();
    tokens.add(token);
    this._write(tokens);
  }

  remove(token) {
    const tokens = this._tokens();
    tokens.delete(token);
    this._write(tokens);
  }

  contains(token) {
    return this._tokens().has(token);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = {};
    this.attributes = {};
    this.textContent = '';
    this._innerHTML = '';
    this.type = '';
    this.accept = '';
    this.multiple = false;
    this.value = '';
    this.files = [];
    this.href = '';
    this.download = '';
    this.clicked = false;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    if (value.includes('drop-message') && value.includes('progress-container')) {
      const dropMessage = this.ownerDocument.createElement('div');
      dropMessage.className = 'drop-message';
      const selectFiles = this.ownerDocument.createElement('span');
      selectFiles.className = 'select-files';
      dropMessage.appendChild(selectFiles);

      const progressContainer = this.ownerDocument.createElement('div');
      progressContainer.className = 'progress-container';
      progressContainer.style.display = 'none';
      const progressBarOuter = this.ownerDocument.createElement('div');
      progressBarOuter.className = 'progress-bar';
      const progress = this.ownerDocument.createElement('div');
      progress.className = 'progress';
      progressBarOuter.appendChild(progress);
      const progressText = this.ownerDocument.createElement('div');
      progressText.className = 'progress-text';
      const cancelButton = this.ownerDocument.createElement('button');
      cancelButton.className = 'cancel-button';
      progressContainer.appendChild(progressBarOuter);
      progressContainer.appendChild(progressText);
      progressContainer.appendChild(cancelButton);
      this.appendChild(dropMessage);
      this.appendChild(progressContainer);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (!this.eventListeners.has(type)) return;
    this.eventListeners.set(
      type,
      this.eventListeners.get(type).filter(candidate => candidate !== listener)
    );
  }

  click() {
    this.clicked = true;
    return this.dispatch('click');
  }

  dispatch(type, event = {}) {
    const eventObject = typeof event.preventDefault === 'function'
      ? event
      : createEvent(this, event);
    eventObject.target ??= this;
    const results = [];
    for (const listener of this.eventListeners.get(type) || []) {
      results.push(listener(eventObject));
    }
    return Promise.all(results);
  }

  contains(target) {
    let current = target;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1));
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

function createDocument() {
  const allElements = [];
  const document = {
    body: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, document);
      allElements.push(element);
      return element;
    },
    querySelectorAll(selector) {
      return allElements.filter(element => element.matches(selector));
    },
    querySelector(selector) {
      return document.querySelectorAll(selector)[0] || null;
    },
    allElements
  };
  document.body = document.createElement('body');
  document.body.className = '';
  return document;
}

function createEvent(target, options = {}) {
  return {
    target,
    relatedTarget: options.relatedTarget ?? null,
    dataTransfer: options.dataTransfer,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    }
  };
}

function createFile(name, options = {}) {
  return {
    name,
    type: options.type ?? '',
    content: options.content ?? 'audio',
    base64: options.base64 ?? 'YXVkaW8='
  };
}

function createBlob(size = 1024, options = {}) {
  return {
    size,
    base64: options.base64 ?? 'd2F2ZGF0YQ==',
    failRead: options.failRead ?? false
  };
}

function createDataTransfer(files) {
  return {
    types: ['Files'],
    dropEffect: '',
    files,
    items: files.map(file => ({
      kind: 'file',
      getAsFile: () => file
    }))
  };
}

class FakeFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.result = '';
  }

  readAsDataURL(blob) {
    if (blob.failRead) {
      this.onerror?.({ message: 'read failed' });
      return;
    }
    this.result = `data:application/octet-stream;base64,${blob.base64 || 'ZGF0YQ=='}`;
    this.onload?.();
  }
}

class FakeJSZip {
  constructor() {
    this.files = [];
  }

  file(name, blob) {
    this.files.push([name, blob]);
  }

  async generateAsync(options) {
    FakeJSZip.lastOptions = options;
    FakeJSZip.lastFiles = this.files;
    return createBlob(4096, { base64: 'emlw' });
  }
}

function createUIManager(calls) {
  return {
    t(key, params) {
      calls.push(['t', key, params ?? null]);
      return params ? `${key}:${JSON.stringify(params)}` : key;
    },
    setError(message, isError, params) {
      calls.push(['setError', message, isError ?? null, params ?? null]);
    },
    clearError() {
      calls.push(['clearError']);
    }
  };
}

function createProcessorHarness(options = {}) {
  const calls = [];
  const processed = options.processed ?? new Map();
  const audioManager = {
    isCancelled: false,
    async processAudioFile(file, progress) {
      calls.push(['processAudioFile', file.name]);
      progress?.(options.progressPercent ?? 50);
      const outcome = processed.has(file.name) ? processed.get(file.name) : createBlob(options.blobSize ?? 2048);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    cancelProcessing: options.noCancelProcessing ? undefined : () => calls.push(['cancelProcessing'])
  };
  const insertionIndicator = { style: { display: 'block' } };
  const pipelineManager = {
    audioManager,
    pluginListManager: {
      getInsertionIndicator() {
        calls.push(['getInsertionIndicator']);
        return insertionIndicator;
      }
    }
  };
  const processor = new FileProcessor(pipelineManager);
  const pipelineElement = document.createElement('div');
  processor.createFileDropArea(pipelineElement);
  processor.setupFileDropHandlers();
  return { processor, pipelineManager, audioManager, calls, pipelineElement, insertionIndicator };
}

async function withFileProcessorGlobals(options, callback) {
  const calls = [];
  const documentRef = createDocument();
  const createdUrls = [];
  const revokedUrls = [];
  const timeouts = [];
  const electronAPI = options.electronAPI;
  const windowRef = {
    uiManager: options.uiManager === false ? null : createUIManager(calls),
    electronIntegration: options.electronIntegration,
    electronAPI,
    JSZip: FakeJSZip,
    open(...args) {
      calls.push(['window.open', ...args]);
    }
  };
  if (options.showDirectoryPicker) {
    windowRef.showDirectoryPicker = options.showDirectoryPicker;
  }

  await withGlobals({
    document: documentRef,
    window: windowRef,
    FileReader: options.FileReader ?? FakeFileReader,
    JSZip: FakeJSZip,
    URL: {
      createObjectURL(blob) {
        const url = `blob:${createdUrls.length + 1}:${blob.size}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      }
    },
    setTimeout(callbackFn, delay) {
      timeouts.push({ callbackFn, delay });
      return timeouts.length;
    }
  }, async () => {
    await callback({
      calls,
      documentRef,
      windowRef,
      createdUrls,
      revokedUrls,
      timeouts,
      runTimeouts() {
        for (const timeout of timeouts) timeout.callbackFn();
      }
    });
  });
}

test('drop area creation and file inputs handle web, Electron, invalid, single, and multiple input', async () => {
  await withFileProcessorGlobals({}, async ({ calls }) => {
    const { processor, pipelineElement } = createProcessorHarness();
    const fileInput = document.body.querySelector('input');
    const selectFiles = processor.dropArea.querySelector('.select-files');
    await selectFiles.dispatch('click');
    assert.equal(fileInput.clicked, true);
    assert.equal(pipelineElement.querySelector('.file-drop-area'), processor.dropArea);

    fileInput.files = [createFile('bad.txt')];
    await fileInput.dispatch('change', { target: fileInput });
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Please select audio files'));

    fileInput.files = [createFile('one.wav')];
    await fileInput.dispatch('change', { target: fileInput });
    assert.equal(processor.downloadContainer.style.display, 'block');
    assert.equal(fileInput.value, '');

    fileInput.files = [createFile('one.wav'), createFile('two.flac')];
    await fileInput.dispatch('change', { target: fileInput });
    assert.equal(FakeJSZip.lastFiles.length, 2);
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showOpenDialog() {
        return { canceled: true, filePaths: [] };
      }
    }
  }, async () => {
    const { processor } = createProcessorHarness();
    assert.ok(processor.dropArea.innerHTML.includes('drop-message'));
    const fileInput = document.body.querySelector('input');
    fileInput.files = [createFile('one.wav'), createFile('two.wav')];
    await fileInput.dispatch('change', { target: fileInput });
    assert.equal(processor.progressContainer.style.display, 'none');
  });

  await withFileProcessorGlobals({ uiManager: false }, async () => {
    const { processor } = createProcessorHarness();
    processor._makeProgressCallback(0, 2)(25);
    assert.equal(processor.progressText.textContent, 'Processing file 1/2 (25%)');
  });
});

test('drag and drop handlers distinguish audio, preset, unsupported, and Electron drops', async () => {
  await withFileProcessorGlobals({}, async () => {
    const { processor, insertionIndicator } = createProcessorHarness();
    const audio = createFile('song.mp3');
    const preset = createFile('preset.effetune_preset');
    const text = createFile('note.txt');

    let event = await processor.dropArea.dispatch('dragenter', { dataTransfer: createDataTransfer([preset]) });
    assert.equal(event[0]?.prevented, undefined);
    event = createEvent(processor.dropArea, { dataTransfer: createDataTransfer([preset]) });
    await processor.dropArea.dispatch('dragenter', event);
    assert.equal(event.prevented, true);
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);

    event = createEvent(processor.dropArea, { dataTransfer: createDataTransfer([audio]) });
    await processor.dropArea.dispatch('dragenter', event);
    assert.equal(event.prevented, true);
    assert.equal(processor.dropArea.classList.contains('drag-active'), true);

    event = createEvent(processor.dropArea, { dataTransfer: createDataTransfer([preset]) });
    await processor.dropArea.dispatch('dragover', event);
    assert.equal(event.prevented, true);

    processor.dropArea.classList.add('drag-active');
    await processor.dropArea.dispatch('dragover', { dataTransfer: createDataTransfer([text]) });
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);

    document.body.classList.add('drag-over');
    event = createEvent(processor.dropArea, { dataTransfer: createDataTransfer([audio]) });
    await processor.dropArea.dispatch('dragover', event);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
    assert.equal(document.body.classList.contains('drag-over'), false);

    await processor.dropArea.dispatch('dragleave', { relatedTarget: processor.dropArea.querySelector('.select-files') });
    assert.equal(processor.dropArea.classList.contains('drag-active'), true);
    await processor.dropArea.dispatch('dragleave', { relatedTarget: document.body });
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);

    await processor.dropArea.dispatch('drop', {});
    await processor.dropArea.dispatch('drop', { dataTransfer: createDataTransfer([preset]) });
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);

    event = createEvent(processor.dropArea, { dataTransfer: createDataTransfer([audio]) });
    await processor.dropArea.dispatch('drop', event);
    assert.equal(event.stopped, true);
    assert.equal(insertionIndicator.style.display, 'none');

    await processor.dropArea.dispatch('drop', { dataTransfer: createDataTransfer([text]) });
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true }
  }, async () => {
    const { processor } = createProcessorHarness();
    processor.dropArea.classList.add('drag-active');
    await processor.dropArea.dispatch('dragenter', { dataTransfer: createDataTransfer([createFile('song.wav')]) });
    await processor.dropArea.dispatch('dragover', { dataTransfer: createDataTransfer([createFile('song.wav')]) });
    await processor.dropArea.dispatch('drop', { dataTransfer: createDataTransfer([createFile('song.wav')]) });
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);
  });
});

test('progress, cancellation, names, base64, and single-file processing update state consistently', async () => {
  await withFileProcessorGlobals({}, async ({ calls }) => {
    const { processor, calls: harnessCalls } = createProcessorHarness();
    processor.showProgress();
    assert.equal(processor.isCancelled, false);
    await processor.progressContainer.querySelector('.cancel-button').dispatch('click');
    assert.equal(processor.isCancelled, true);
    assert.ok(harnessCalls.some(call => call[0] === 'cancelProcessing'));
    assert.equal(processor.progressText.textContent, 'Processing canceled');

    const fallback = createProcessorHarness({ noCancelProcessing: true });
    fallback.processor.showProgress();
    await fallback.processor.progressContainer.querySelector('.cancel-button').dispatch('click');
    assert.equal(fallback.audioManager.isCancelled, true);

    assert.equal(processor.getProcessedFileName('track.name.wav'), 'track.name_effetuned.wav');
    assert.equal(await processor._blobToBase64(createBlob()), 'd2F2ZGF0YQ==');
    await assert.rejects(processor._blobToBase64(createBlob(1, { failRead: true })));

    await processor._processSingleFile(createFile('single.wav'));
    assert.equal(processor.progressBar.style.width, '100%');

    const canceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await canceled.processor._processSingleFile(createFile('cancel.wav'));
    assert.equal(canceled.processor.progressText.textContent, 'status.processingCanceled');

    processor.audioManager.processAudioFile = async () => {
      throw new Error('single failed');
    };
    await assert.rejects(processor._processSingleFile(createFile('error.wav')), /single failed/);
  });

  await withFileProcessorGlobals({ uiManager: false }, async () => {
    const { processor } = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await processor._processSingleFile(createFile('cancel.wav'));
    assert.equal(processor.progressText.textContent, 'Processing canceled');
  });
});

test('multiple-file processing handles Electron, FSA, cancellation, errors, and ZIP fallback', async () => {
  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showOpenDialog() {
        return { canceled: false, filePaths: ['C:/out'] };
      },
      async joinPaths(folder, name) {
        return `${folder}/${name}`;
      },
      async saveFile(path, base64) {
        return path.includes('bad') ? { success: false, error: 'save failed' } : { success: true, base64 };
      }
    }
  }, async ({ calls }) => {
    const { processor } = createProcessorHarness({
      processed: new Map([
        ['bad.wav', createBlob()],
        ['throw.wav', new Error('render failed')]
      ])
    });
    await processor._processMultipleFiles([createFile('ok.wav'), createFile('bad.wav'), createFile('throw.wav')]);
    assert.ok(processor.downloadContainer.querySelector('.download-link').innerHTML.includes('filesSavedToFolder'));
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToProcessFile'));

    const canceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await canceled.processor._processFilesToElectronFolder([createFile('cancel.wav')], 'C:/out');
    assert.equal(canceled.processor.progressText.textContent, 'status.processingCanceled');
    canceled.processor.isCancelled = true;
    await canceled.processor._processFilesToElectronFolder([createFile('skip.wav')], 'C:/out');
  });

  await withFileProcessorGlobals({
    showDirectoryPicker: async () => ({
      async getFileHandle(name) {
        return {
          async createWritable() {
            return {
              async write(blob) {
                if (name.includes('bad')) throw new Error('write failed');
                assert.ok(blob.size > 0);
              },
              async close() {}
            };
          }
        };
      }
    })
  }, async ({ calls }) => {
    const { processor } = createProcessorHarness();
    await processor._processMultipleFiles([createFile('ok.wav'), createFile('bad.wav')]);
    assert.ok(processor.downloadContainer.querySelector('.download-link').innerHTML.includes('filesSaved'));
    assert.ok(calls.some(call => call[0] === 'setError'));

    const canceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await canceled.processor._processFilesToFSADirectory([createFile('cancel.wav')], {
      async getFileHandle() {
        throw new Error('should not write');
      }
    });
    assert.equal(canceled.processor.progressText.textContent, 'status.processingCanceled');
    canceled.processor.isCancelled = true;
    await canceled.processor._processFilesToFSADirectory([createFile('skip.wav')], {
      async getFileHandle() {
        throw new Error('skipped');
      }
    });
  });

  await withFileProcessorGlobals({
    showDirectoryPicker: async () => {
      const error = new Error('abort');
      error.name = 'AbortError';
      throw error;
    }
  }, async () => {
    const { processor } = createProcessorHarness();
    await processor._processMultipleFiles([createFile('a.wav'), createFile('b.wav')]);
    assert.equal(processor.progressContainer.style.display, 'none');
  });

  await withFileProcessorGlobals({
    showDirectoryPicker: async () => {
      throw new Error('picker failed');
    }
  }, async () => {
    const { processor } = createProcessorHarness();
    await assert.rejects(processor._processMultipleFiles([createFile('a.wav'), createFile('b.wav')]), /picker failed/);
  });

  await withFileProcessorGlobals({}, async ({ calls }) => {
    const { processor } = createProcessorHarness({
      processed: new Map([
        ['bad.wav', new Error('zip render failed')]
      ])
    });
    await processor._processFilesWithJSZip([createFile('ok.wav'), createFile('bad.wav')]);
    assert.equal(processor.downloadContainer.style.display, 'block');
    assert.ok(calls.some(call => call[0] === 'setError'));

    const empty = createProcessorHarness({ processed: new Map([['bad.wav', new Error('zip render failed')]]) });
    await empty.processor._processFilesWithJSZip([createFile('bad.wav')]);
    assert.equal(empty.processor.downloadContainer.style.display, 'none');

    const canceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await canceled.processor._processFilesWithJSZip([createFile('cancel.wav')]);
    assert.equal(canceled.processor.progressText.textContent, 'status.processingCanceled');
    canceled.processor.isCancelled = true;
    await canceled.processor._processFilesWithJSZip([createFile('skip.wav')]);
  });
});

test('download links support web and Electron save flows', async () => {
  await withFileProcessorGlobals({}, async ({ createdUrls, revokedUrls, runTimeouts }) => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024 * 1024), 'song.wav');
    const link = processor.downloadContainer.querySelector('a');
    assert.equal(link.download, 'song_effetuned.wav');
    assert.equal(createdUrls.length, 1);
    await link.dispatch('click');
    runTimeouts();
    assert.deepEqual(revokedUrls, [link.href]);
  });

  await withFileProcessorGlobals({ uiManager: false }, async () => {
    const { processor } = createProcessorHarness();
    processor._showSavedMessage(2, 'C:/out');
    assert.ok(processor.downloadContainer.querySelector('.download-link').innerHTML.includes('2 file(s) saved to C:/out'));
    processor._showSavedMessage(1, null);
    assert.ok(processor.downloadContainer.querySelector('.download-link').innerHTML.includes('1 file(s) saved to selected folder'));
    processor.showDownloadLink(createBlob(1024), 'archive.zip', true);
    const link = processor.downloadContainer.querySelector('a');
    assert.equal(link.download, 'archive.zip');
  });

  const saveCalls = [];
  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showSaveDialog(options) {
        saveCalls.push(['showSaveDialog', options]);
        return { canceled: false, filePath: 'C:/song.wav' };
      },
      async saveFile(path, base64) {
        saveCalls.push(['saveFile', path, base64]);
        return { success: true };
      }
    }
  }, async ({ calls, runTimeouts }) => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024 * 1024), 'song.wav');
    const link = processor.downloadContainer.querySelector('a');
    await link.dispatch('click');
    await flushMicrotasks();
    assert.ok(saveCalls.some(call => call[0] === 'saveFile'));
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('File saved successfully')));
    runTimeouts();
    assert.ok(calls.some(call => call[0] === 'clearError'));
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showSaveDialog() {
        return { canceled: false, filePath: 'C:/fail.wav' };
      },
      async saveFile() {
        return { success: false, error: 'disk full' };
      }
    }
  }, async ({ calls }) => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024), 'song.wav');
    await processor.downloadContainer.querySelector('a').dispatch('click');
    await flushMicrotasks();
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('Failed to save file')));
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showSaveDialog() {
        return { canceled: false, filePath: 'C:/read-fail.wav' };
      },
      async saveFile() {
        return { success: true };
      }
    }
  }, async ({ calls }) => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024, { failRead: true }), 'song.wav');
    await processor.downloadContainer.querySelector('a').dispatch('click');
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('Error reading file')));
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showSaveDialog() {
        return { canceled: false, filePath: 'C:/throw.wav' };
      },
      saveFile() {
        throw new Error('save exploded');
      }
    }
  }, async ({ calls }) => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024), 'song.wav', true);
    await processor.downloadContainer.querySelector('a').dispatch('click');
    await flushMicrotasks();
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('Error saving file')));
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    electronAPI: {
      async showSaveDialog() {
        return { canceled: true };
      },
      async saveFile() {
        throw new Error('unused');
      }
    }
  }, async () => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024), 'song.wav');
    await processor.downloadContainer.querySelector('a').dispatch('click');
  });
});

test('processDroppedAudioFiles filters input, reports errors, cleans classes, and supports fallback UI text', async () => {
  await withFileProcessorGlobals({}, async ({ calls, documentRef }) => {
    const { processor } = createProcessorHarness();
    const stray = documentRef.createElement('div');
    stray.className = 'drag-active';
    documentRef.body.appendChild(stray);

    await processor.processDroppedAudioFiles(null);
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Please select audio files'));

    await processor.processDroppedAudioFiles([createFile('bad.txt'), createFile('ok.wav')]);
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);
    assert.equal(stray.classList.contains('drag-active'), false);

    const failing = createProcessorHarness({
      processed: new Map([['fail.wav', new Error('process failed')]])
    });
    await failing.processor.processDroppedAudioFiles([createFile('fail.wav')]);
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToProcessAudioFiles'));
  });

  await withFileProcessorGlobals({ uiManager: false }, async () => {
    const { processor } = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await processor.processDroppedAudioFiles([createFile('cancel.wav')]);
    assert.equal(processor.progressText.textContent, 'Processing canceled');
  });
});

test('untranslated UI and defensive file handling recover from fallbacks and catches', async () => {
  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    uiManager: false,
    electronAPI: {
      async showOpenDialog(options) {
        window.lastOpenDialogOptions = options;
        return { canceled: true, filePaths: [] };
      }
    }
  }, async () => {
    const { processor } = createProcessorHarness();
    assert.ok(processor.dropArea.innerHTML.includes('drop-message'));
    await processor._processMultipleFiles([createFile('one.wav'), createFile('two.wav')]);
    assert.equal(window.lastOpenDialogOptions.title, 'Select Output Folder');

    processor.showDownloadLink(createBlob(1024), 'song.wav');
    assert.ok(processor.downloadContainer.querySelector('a').innerHTML.includes('Save processed file'));
    processor.showDownloadLink(createBlob(2048), 'archive.zip', true);
    assert.ok(processor.downloadContainer.querySelector('a').innerHTML.includes('Save processed files'));
  });

  await withFileProcessorGlobals({ uiManager: false }, async () => {
    const { processor } = createProcessorHarness();
    await processor._processSingleFile(createFile('complete.wav'));
    assert.equal(processor.progressText.textContent, 'Processing complete');

    await processor._processFilesWithJSZip([createFile('one.wav'), createFile('two.wav')]);
    assert.equal(processor.progressText.textContent, 'Creating zip file...');

    processor.showDownloadLink(createBlob(1024), 'song.wav');
    assert.ok(processor.downloadContainer.querySelector('a').innerHTML.includes('Download processed file'));

    const electronCanceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await electronCanceled.processor._processFilesToElectronFolder([createFile('cancel.wav')], 'C:/out');
    assert.equal(electronCanceled.processor.progressText.textContent, 'Processing canceled');

    const fsaCanceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await fsaCanceled.processor._processFilesToFSADirectory([createFile('cancel.wav')], {
      async getFileHandle() {
        throw new Error('unused');
      }
    });
    assert.equal(fsaCanceled.processor.progressText.textContent, 'Processing canceled');

    const zipCanceled = createProcessorHarness({ processed: new Map([['cancel.wav', null]]) });
    await zipCanceled.processor._processFilesWithJSZip([createFile('cancel.wav')]);
    assert.equal(zipCanceled.processor.progressText.textContent, 'Processing canceled');
  });

  await withFileProcessorGlobals({}, async ({ calls }) => {
    const { processor } = createProcessorHarness({
      processed: new Map([['one.wav', new Error('input failed')]])
    });
    const fileInput = document.body.querySelector('input');
    fileInput.files = [createFile('one.wav')];
    await fileInput.dispatch('change', { target: fileInput });
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'error.failedToProcessAudioFiles'));

    await processor.processDroppedAudioFiles([createFile('one.wav'), createFile('two.wav')]);
    assert.equal(processor.downloadContainer.style.display, 'block');
  });

  await withFileProcessorGlobals({}, async () => {
    const { processor } = createProcessorHarness();
    const nonFileItem = { kind: 'string', getAsFile: () => null };
    let event = createEvent(processor.dropArea, {
      dataTransfer: {
        types: ['Files'],
        items: [nonFileItem],
        files: []
      }
    });
    await processor.dropArea.dispatch('dragenter', event);
    assert.equal(event.prevented, false);

    event = createEvent(processor.dropArea, {
      dataTransfer: {
        types: ['Files'],
        items: [nonFileItem],
        files: []
      }
    });
    await processor.dropArea.dispatch('dragover', event);
    assert.equal(processor.dropArea.classList.contains('drag-active'), false);
  });

  await withFileProcessorGlobals({
    electronIntegration: { isElectron: true },
    FileReader: class ThrowingFileReader {
      readAsDataURL() {
        throw new Error('reader exploded');
      }
    },
    electronAPI: {
      async showSaveDialog() {
        return { canceled: false, filePath: 'C:/throw.wav' };
      },
      async saveFile() {
        return { success: true };
      }
    }
  }, async ({ calls }) => {
    const { processor } = createProcessorHarness();
    processor.showDownloadLink(createBlob(1024), 'song.wav');
    await processor.downloadContainer.querySelector('a').dispatch('click');
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('Error saving file')));
  });

  await withFileProcessorGlobals({}, async () => {
    const { processor } = createProcessorHarness();
    await processor.processDroppedAudioFiles([{}, createFile('ok.wav')]);
    assert.equal(processor.downloadContainer.style.display, 'block');
  });
});
