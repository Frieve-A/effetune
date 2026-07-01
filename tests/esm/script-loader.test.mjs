import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCSS, loadScript } from '../../js/script-loader.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

async function withMutedConsole(method, callback) {
  const original = console[method];
  console[method] = () => {};
  try {
    return await callback();
  } finally {
    console[method] = original;
  }
}

function createDocumentHarness(failures = new Set()) {
  const appended = [];
  return {
    appended,
    document: {
      createElement(tagName) {
        return {
          tagName,
          rel: '',
          src: '',
          href: '',
          onload: null,
          onerror: null
        };
      },
      head: {
        appendChild(element) {
          appended.push(element);
          const url = element.src || element.href;
          queueMicrotask(() => {
            if (failures.has(url)) {
              element.onerror?.(new Error(`failed ${url}`));
            } else {
              element.onload?.();
            }
          });
        }
      }
    }
  };
}

test('loadScript loads script arrays in sequence and continues after failures', async () => {
  const harness = createDocumentHarness(new Set(['bad.js']));

  await withGlobals({ document: harness.document }, async () => {
    await withMutedConsole('error', async () => {
      await loadScript(['first.js', 'bad.js', 'last.js']);
    });
  });

  assert.deepEqual(harness.appended.map(element => element.src), ['first.js', 'bad.js', 'last.js']);
});

test('loadScript loads a single script and resolves on errors', async () => {
  const success = createDocumentHarness();
  await withGlobals({ document: success.document }, async () => {
    await loadScript('single.js');
  });
  assert.equal(success.appended[0].src, 'single.js');

  const failure = createDocumentHarness(new Set(['single-error.js']));
  await withGlobals({ document: failure.document }, async () => {
    await withMutedConsole('error', async () => {
      await loadScript('single-error.js');
    });
  });
  assert.equal(failure.appended[0].src, 'single-error.js');
});

test('loadCSS loads CSS arrays in parallel and continues after failures', async () => {
  const harness = createDocumentHarness(new Set(['bad.css']));

  await withGlobals({ document: harness.document }, async () => {
    await withMutedConsole('error', async () => {
      await loadCSS(['first.css', 'bad.css', 'last.css']);
    });
  });

  assert.deepEqual(harness.appended.map(element => [element.rel, element.href]), [
    ['stylesheet', 'first.css'],
    ['stylesheet', 'bad.css'],
    ['stylesheet', 'last.css']
  ]);
});

test('loadCSS loads a single stylesheet and resolves on errors', async () => {
  const success = createDocumentHarness();
  await withGlobals({ document: success.document }, async () => {
    await loadCSS('single.css');
  });
  assert.deepEqual([success.appended[0].rel, success.appended[0].href], ['stylesheet', 'single.css']);

  const failure = createDocumentHarness(new Set(['single-error.css']));
  await withGlobals({ document: failure.document }, async () => {
    await withMutedConsole('error', async () => {
      await loadCSS('single-error.css');
    });
  });
  assert.deepEqual([failure.appended[0].rel, failure.appended[0].href], ['stylesheet', 'single-error.css']);
});
