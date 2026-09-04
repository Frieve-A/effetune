import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function getEffetuneHtml() {
  return fs.readFileSync(new URL('../../effetune.html', import.meta.url), 'utf8');
}

function getCspDirective(name) {
  const html = getEffetuneHtml();
  const cspMatch = html.match(/<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/);
  assert.ok(cspMatch, 'Missing Content-Security-Policy meta tag');
  return cspMatch[1]
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name} `));
}

function getEarlyStartupViewScript() {
  const html = getEffetuneHtml();
  const markerIndex = html.indexOf('Apply the Web startup view preference');
  assert.notEqual(markerIndex, -1, 'Missing early startup view script marker');
  const scriptStart = html.lastIndexOf('<script>', markerIndex);
  const scriptEnd = html.indexOf('</script>', markerIndex);
  assert.notEqual(scriptStart, -1, 'Missing early startup view script start');
  assert.notEqual(scriptEnd, -1, 'Missing early startup view script end');
  return html.slice(scriptStart + '<script>'.length, scriptEnd);
}

function runEarlyStartupViewScript({
  search = '',
  config = { startupView: 'library' },
  electron = false,
  throwOnStorage = false
} = {}) {
  const classes = new Set();
  const calls = [];
  const stylesheets = [];
  const windowRef = {
    location: { search },
    localStorage: {
      getItem(key) {
        calls.push(['getItem', key]);
        if (throwOnStorage) throw new Error('storage unavailable');
        return config === undefined ? null : JSON.stringify(config);
      }
    }
  };
  if (electron) windowRef.electronAPI = {};

  vm.runInNewContext(getEarlyStartupViewScript(), {
    window: windowRef,
    document: {
      body: {
        classList: {
          add(className) {
            classes.add(className);
          }
        }
      },
      head: {
        appendChild(element) {
          stylesheets.push(element.href);
          return element;
        }
      },
      createElement(tagName) {
        return { tagName, rel: '', href: '' };
      }
    },
    URLSearchParams,
    JSON
  });

  return { calls, classes, stylesheets };
}

test('effetune.html applies the Web library startup class before the app module loads', () => {
  const webLibrary = runEarlyStartupViewScript();
  assert.equal(webLibrary.classes.has('view-library'), true);
  assert.deepEqual(webLibrary.calls, [['getItem', 'effetune_app_config']]);
  // Without the library stylesheet the class cannot hide the effect pipeline.
  assert.deepEqual(webLibrary.stylesheets, ['effetune-library.css']);

  assert.deepEqual(runEarlyStartupViewScript({ config: { startupView: 'effects' } }).stylesheets, []);

  assert.equal(runEarlyStartupViewScript({ config: { startupView: 'effects' } }).classes.has('view-library'), false);
  assert.equal(runEarlyStartupViewScript({ search: '?p=shared' }).classes.has('view-library'), false);
  assert.equal(runEarlyStartupViewScript({ search: '?dbt=shared' }).classes.has('view-library'), false);
  // app.js keeps the effect pipeline for a transient restore, so hiding it here
  // would leave neither view on screen.
  assert.equal(runEarlyStartupViewScript({
    search: '?mode=compact&restorePipeline=transient'
  }).classes.has('view-library'), false);

  const electronRun = runEarlyStartupViewScript({ electron: true });
  assert.equal(electronRun.classes.has('view-library'), false);
  assert.deepEqual(electronRun.calls, []);

  assert.equal(runEarlyStartupViewScript({ throwOnStorage: true }).classes.has('view-library'), false);
});

test('effetune.html permits blob artwork duplication fetches in connect-src', () => {
  const connectSrc = getCspDirective('connect-src');
  assert.ok(connectSrc, 'Missing connect-src directive');
  assert.equal(connectSrc.split(/\s+/).includes('blob:'), true);
});

test('effetune.html permits media only from its existing sources and the OpenHome loopback gateway', () => {
  const mediaSrc = getCspDirective('media-src');
  assert.ok(mediaSrc, 'Missing media-src directive');
  assert.deepEqual(mediaSrc.split(/\s+/), [
    'media-src',
    "'self'",
    'blob:',
    'data:',
    'http://127.0.0.1:*'
  ]);
});
