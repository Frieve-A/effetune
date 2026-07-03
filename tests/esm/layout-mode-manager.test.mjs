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

test('LayoutModeManager applies mobile and desktop body classes', () => {
  const classList = createClassList();
  const rootClassList = createClassList();
  const query = createMatchMedia(true);
  const manager = new LayoutModeManager({
    windowRef: { matchMedia: () => query },
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
