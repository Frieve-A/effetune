import assert from 'node:assert/strict';
import test from 'node:test';

import { LayoutModeManager } from '../../js/ui/layout-mode-manager.js';

function createClassList() {
  const classes = new Set();
  return {
    classes,
    toggle(name, enabled) {
      if (enabled) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createMatchMedia(matches = false) {
  const listeners = new Set();
  const query = {
    matches,
    addEventListener(type, listener) {
      if (type === 'change') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') listeners.delete(listener);
    },
    setMatches(nextMatches) {
      this.matches = nextMatches;
      for (const listener of listeners) {
        listener({ matches: nextMatches });
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
  return query;
}

function createWindow(queries) {
  return {
    matchMedia(queryString) {
      return queries[queryString];
    }
  };
}

test('LayoutModeManager applies mobile and desktop body classes when installed', () => {
  const classList = createClassList();
  const rootClassList = createClassList();
  const query = createMatchMedia(true);
  // Installed (standalone) so the layout follows the width media query.
  const installedQuery = createMatchMedia(true);
  const manager = new LayoutModeManager({
    windowRef: createWindow({
      '(max-width: 1158px)': query,
      '(display-mode: standalone)': installedQuery
    }),
    documentRef: { body: { classList }, documentElement: { classList: rootClassList } }
  });

  assert.equal(manager.mode, 'mobile');
  assert.equal(manager.isMobile, true);
  assert.equal(classList.contains('layout-mobile'), true);
  assert.equal(classList.contains('layout-desktop'), false);
  assert.equal(rootClassList.contains('layout-mobile'), true);
  assert.equal(rootClassList.contains('layout-desktop'), false);

  const modes = [];
  manager.onChange(mode => modes.push(mode));
  query.setMatches(false);

  assert.deepEqual(modes, ['desktop']);
  assert.equal(manager.mode, 'desktop');
  assert.equal(classList.contains('layout-mobile'), false);
  assert.equal(classList.contains('layout-desktop'), true);
  assert.equal(rootClassList.contains('layout-mobile'), false);
  assert.equal(rootClassList.contains('layout-desktop'), true);

  manager.dispose();
  assert.equal(query.listenerCount(), 0);
  assert.equal(installedQuery.listenerCount(), 0);
});

test('LayoutModeManager stays width-driven even when the PWA is not installed', () => {
  const classList = createClassList();
  const rootClassList = createClassList();
  // Wide viewport and not installed -> desktop layout.
  const query = createMatchMedia(false);
  const installedQuery = createMatchMedia(false);
  const manager = new LayoutModeManager({
    windowRef: createWindow({
      '(max-width: 1158px)': query,
      '(display-mode: standalone)': installedQuery
    }),
    documentRef: { body: { classList }, documentElement: { classList: rootClassList } }
  });

  assert.equal(manager.isInstalled, false);
  assert.equal(manager.mode, 'desktop');
  assert.equal(classList.contains('layout-desktop'), true);

  // Narrowing the viewport still switches to mobile.
  const modes = [];
  manager.onChange(mode => modes.push(mode));
  query.setMatches(true);

  assert.deepEqual(modes, ['mobile']);
  assert.equal(manager.mode, 'mobile');
  assert.equal(classList.contains('layout-mobile'), true);

  manager.dispose();
});

test('LayoutModeManager treats iOS standalone launches as installed', () => {
  const classList = createClassList();
  const query = createMatchMedia(false);
  const installedQuery = createMatchMedia(false);
  const windowRef = createWindow({
    '(max-width: 1158px)': query,
    '(display-mode: standalone)': installedQuery
  });
  windowRef.navigator = { standalone: true };
  const manager = new LayoutModeManager({
    windowRef,
    documentRef: { body: { classList } }
  });

  assert.equal(manager.isInstalled, true);
  assert.equal(manager.mode, 'desktop');
});

test('LayoutModeManager keeps Electron in desktop mode', () => {
  const classList = createClassList();
  const query = createMatchMedia(true);
  const manager = new LayoutModeManager({
    windowRef: {
      matchMedia: () => query,
      electronIntegration: { isElectronEnvironment: () => true }
    },
    documentRef: { body: { classList } }
  });

  assert.equal(manager.mode, 'desktop');
  assert.equal(manager.isMobile, false);
  assert.equal(classList.contains('layout-desktop'), true);
  assert.equal(classList.contains('layout-mobile'), false);
});
