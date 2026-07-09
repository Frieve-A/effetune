import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function getEffetuneHtml() {
  return fs.readFileSync(new URL('../../effetune.html', import.meta.url), 'utf8');
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
      }
    },
    URLSearchParams,
    JSON
  });

  return { calls, classes };
}

test('effetune.html applies the Web library startup class before the app module loads', () => {
  const webLibrary = runEarlyStartupViewScript();
  assert.equal(webLibrary.classes.has('view-library'), true);
  assert.deepEqual(webLibrary.calls, [['getItem', 'effetune_app_config']]);

  assert.equal(runEarlyStartupViewScript({ config: { startupView: 'effects' } }).classes.has('view-library'), false);
  assert.equal(runEarlyStartupViewScript({ search: '?p=shared' }).classes.has('view-library'), false);
  assert.equal(runEarlyStartupViewScript({ search: '?dbt=shared' }).classes.has('view-library'), false);

  const electronRun = runEarlyStartupViewScript({ electron: true });
  assert.equal(electronRun.classes.has('view-library'), false);
  assert.deepEqual(electronRun.calls, []);

  assert.equal(runEarlyStartupViewScript({ throwOnStorage: true }).classes.has('view-library'), false);
});

test('effetune.html permits blob artwork duplication fetches in connect-src', () => {
  const html = getEffetuneHtml();
  const cspMatch = html.match(/<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/);
  assert.ok(cspMatch, 'Missing Content-Security-Policy meta tag');

  const connectSrc = cspMatch[1]
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('connect-src '));

  assert.ok(connectSrc, 'Missing connect-src directive');
  assert.equal(connectSrc.split(/\s+/).includes('blob:'), true);
});
