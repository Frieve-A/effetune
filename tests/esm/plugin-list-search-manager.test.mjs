import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchManager } from '../../js/ui/plugin-list/search-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? '';
    this.className = options.className ?? '';
    this.textContent = options.textContent ?? '';
    this.value = options.value ?? '';
    this.style = {};
    this.dataset = options.dataset ?? {};
    this.children = [];
    this.childNodes = options.childNodes ?? [];
    this.parentNode = null;
    this.removed = false;
    this.listeners = new Map();
    this.classToggles = [];
    this.focusCount = 0;
    this.selectCount = 0;
    this.clickCount = 0;
    this.classList = {
      toggle: (className, force) => {
        this.classToggles.push([className, force]);
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
        this.className = [...classes].join(' ');
      }
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    this.removed = true;
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  focus() {
    this.focusCount++;
  }

  select() {
    this.selectCount++;
  }

  click() {
    this.clickCount++;
    this.dispatchEvent('click');
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(type, event = {}) {
    const eventObject = { target: this, ...event };
    return (this.listeners.get(type) || []).map(listener => listener(eventObject));
  }

  hasClass(className) {
    return this.className.split(/\s+/).includes(className);
  }

  matches(selector) {
    if (selector === this.tagName.toLowerCase()) return true;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.category-row[data-category="')) {
      const category = selector.slice('.category-row[data-category="'.length, -2);
      return this.hasClass('category-row') && this.dataset.category === category;
    }
    if (selector.startsWith('.')) return this.hasClass(selector.slice(1));
    return false;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function createDocument(elements) {
  return {
    getElementById(id) {
      return elements.get(id) ?? null;
    }
  };
}

function createControls(options = {}) {
  const elements = new Map();
  const ids = [
    'effectSearchButton',
    'effectSearchInput',
    'availableEffectsTitle',
    'tabSwitcher',
    'effectsTab',
    'systemPresetsTab',
    'userPresetsTab'
  ];

  for (const id of ids) {
    elements.set(id, new FakeElement('button', { id }));
  }

  elements.get('effectSearchInput').tagName = 'INPUT';
  elements.get('effectSearchInput').value = options.searchValue ?? '';

  if (options.clearButton !== false) {
    elements.set('effectSearchClearButton', new FakeElement('button', { id: 'effectSearchClearButton' }));
  }

  return {
    elements,
    searchButton: elements.get('effectSearchButton'),
    searchInput: elements.get('effectSearchInput'),
    clearButton: elements.get('effectSearchClearButton') ?? null,
    tabSwitcher: elements.get('tabSwitcher'),
    effectsTab: elements.get('effectsTab'),
    systemPresetsTab: elements.get('systemPresetsTab'),
    userPresetsTab: elements.get('userPresetsTab')
  };
}

function createWindow(calls, options = {}) {
  return {
    uiManager: Object.prototype.hasOwnProperty.call(options, 'uiManager')
      ? options.uiManager
      : {
          t(key, data) {
            calls.push(['translate', key, data]);
            return `${key}:${data.count}`;
          }
        },
    listeners: new Map(),
    addEventListener(type, listener, optionsArg) {
      calls.push(['windowAddEventListener', type, optionsArg]);
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push(listener);
    },
    dispatchEvent(type, event = {}) {
      return (this.listeners.get(type) || []).map(listener => listener(event));
    }
  };
}

function createPluginListManager(pluginList, calls) {
  return {
    pluginList,
    initPluginList() {
      calls.push(['initPluginList']);
    },
    initSystemPresetList() {
      calls.push(['initSystemPresetList']);
    },
    initUserPresetList() {
      calls.push(['initUserPresetList']);
    },
    updateCategoryVisibility(category) {
      calls.push(['updateCategoryVisibility', category]);
    }
  };
}

async function withSearchGlobals(options, callback) {
  const calls = [];
  const controls = createControls(options.controls);
  const windowRef = createWindow(calls, options.windowOptions);
  const timeouts = [];

  await withGlobals({
    document: createDocument(controls.elements),
    window: windowRef,
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timeouts.push(fn);
      return timeouts.length;
    }
  }, async () => callback({ calls, controls, windowRef, timeouts }));
}

function createPluginList(options = {}) {
  const pluginList = new FakeElement('div', { id: 'pluginList' });
  if (options.content !== false) {
    pluginList.appendChild(new FakeElement('div', { className: 'plugin-list-content' }));
  }
  if (options.count !== false) {
    pluginList.appendChild(new FakeElement('div', { id: 'effectCount' }));
  }
  return pluginList;
}

function createCategoryRow(options = {}) {
  const row = new FakeElement('div', {
    className: 'category-row',
    dataset: { category: options.category ?? 'category' }
  });

  if (options.title !== false) {
    const title = new FakeElement('h3', { textContent: options.title ?? 'Category' });
    if (options.indicator !== false) {
      title.appendChild(new FakeElement('span', { className: 'collapse-indicator', textContent: '>' }));
    }
    row.appendChild(title);
  }

  if (options.rightColumn !== false) {
    const rightColumn = new FakeElement('div', { className: 'right-column-content' });
    if (options.items !== false) {
      const itemContainer = new FakeElement('div', { className: 'plugin-category-items' });
      for (const name of options.itemNames ?? []) {
        itemContainer.appendChild(new FakeElement('div', {
          className: 'plugin-item',
          childNodes: [{ textContent: ` ${name} ` }]
        }));
      }
      rightColumn.appendChild(itemContainer);
    }
    if (options.count !== false) {
      rightColumn.appendChild(new FakeElement('span', { className: 'category-effects-count' }));
    }
    row.appendChild(rightColumn);
  }

  return row;
}

function getContent(pluginList) {
  return pluginList.querySelector('.plugin-list-content');
}

test('search controls toggle input state, clear text, and handle keyboard search shortcuts', async () => {
  await withSearchGlobals({
    controls: { searchValue: 'warm' }
  }, async ({ calls, controls, windowRef, timeouts }) => {
    const pluginList = createPluginList({ content: false, count: false });
    const manager = new SearchManager(createPluginListManager(pluginList, calls));
    const appliedFilters = [];
    manager.applySearchFilter = value => appliedFilters.push(value);

    controls.searchButton.click();
    assert.equal(manager.isSearchActive, true);
    assert.equal(controls.tabSwitcher.style.display, 'none');
    assert.equal(controls.searchInput.style.display, 'block');
    assert.equal(controls.searchInput.focusCount, 1);
    assert.equal(controls.searchInput.selectCount, 1);
    assert.deepEqual(controls.clearButton.classToggles.at(-1), ['visible', true]);

    controls.searchInput.value = 'gain';
    controls.searchInput.dispatchEvent('input', { target: controls.searchInput });
    assert.deepEqual(appliedFilters, ['gain']);

    controls.clearButton.click();
    assert.equal(controls.searchInput.value, '');
    assert.deepEqual(appliedFilters.at(-1), '');
    assert.equal(controls.searchInput.focusCount, 2);

    controls.searchInput.dispatchEvent('keydown', { key: 'ArrowDown' });
    assert.equal(manager.isSearchActive, true);

    controls.searchInput.dispatchEvent('keydown', { key: 'Escape' });
    assert.equal(manager.isSearchActive, false);
    assert.equal(controls.tabSwitcher.style.display, '');
    assert.equal(controls.searchInput.style.display, 'none');
    assert.deepEqual(appliedFilters.at(-1), '');

    windowRef.uiManager = { layoutMode: { isMobile: true } };
    controls.searchButton.click();
    controls.searchButton.click();
    assert.equal(controls.tabSwitcher.style.display, '');

    const keydown = windowRef.listeners.get('keydown')[0];
    const keyEvent = {
      ctrlKey: true,
      metaKey: false,
      key: 'f',
      preventDefault() {
        calls.push(['preventDefault']);
      },
      stopPropagation() {
        calls.push(['stopPropagation']);
      }
    };
    keydown(keyEvent);
    assert.equal(manager.isSearchActive, true);
    assert.ok(calls.some(call => call[0] === 'preventDefault'));
    assert.ok(calls.some(call => call[0] === 'stopPropagation'));

    keydown({ ...keyEvent, ctrlKey: false, metaKey: true });
    assert.equal(manager.isSearchActive, false);
    assert.deepEqual(calls.filter(call => call[0] === 'setTimeout').at(-1), ['setTimeout', 0]);
    timeouts.pop()();
    assert.equal(manager.isSearchActive, true);

    keydown({ ...keyEvent, ctrlKey: false, metaKey: false });
    assert.equal(manager.isSearchActive, true);
    keydown({ ...keyEvent, key: 'g' });
    assert.equal(manager.isSearchActive, true);
  });
});

test('tab switching clears old content, initializes each tab, and ignores guarded tab clicks', async () => {
  await withSearchGlobals({}, async ({ calls, controls }) => {
    const pluginList = createPluginList();
    const content = pluginList.querySelector('.plugin-list-content');
    const count = pluginList.querySelector('#effectCount');
    const manager = new SearchManager(createPluginListManager(pluginList, calls));

    controls.systemPresetsTab.click();
    assert.equal(manager.currentTab, 'systemPresets');
    assert.equal(content.removed, true);
    assert.equal(count.removed, true);
    assert.deepEqual(calls.filter(call => call[0].startsWith('init')), [['initSystemPresetList']]);
    assert.deepEqual(controls.systemPresetsTab.classToggles.at(-1), ['active', true]);

    controls.systemPresetsTab.click();
    assert.deepEqual(calls.filter(call => call[0].startsWith('init')), [['initSystemPresetList']]);

    manager.isSearchActive = true;
    controls.userPresetsTab.click();
    assert.equal(manager.currentTab, 'systemPresets');

    manager.isSearchActive = false;
    controls.userPresetsTab.click();
    controls.effectsTab.click();
    assert.deepEqual(calls.filter(call => call[0].startsWith('init')), [
      ['initSystemPresetList'],
      ['initUserPresetList'],
      ['initPluginList']
    ]);

    manager.switchToTab('unknown');
    assert.equal(manager.currentTab, 'unknown');
    assert.deepEqual(calls.filter(call => call[0].startsWith('init')), [
      ['initSystemPresetList'],
      ['initUserPresetList'],
      ['initPluginList']
    ]);
  });
});

test('search filtering dispatches by tab and works without an optional clear button', async () => {
  await withSearchGlobals({
    controls: { clearButton: false }
  }, async ({ calls }) => {
    const manager = new SearchManager(createPluginListManager(createPluginList({ content: false }), calls));
    const callsByFilter = [];
    manager.filterPlugins = value => callsByFilter.push(['plugins', value]);
    manager.filterPresets = value => callsByFilter.push(['presets', value]);

    manager.updateSearchClearButton();
    manager.applySearchFilter('eq');
    manager.currentTab = 'systemPresets';
    manager.applySearchFilter('system');
    manager.currentTab = 'userPresets';
    manager.applySearchFilter('user');
    manager.currentTab = 'other';
    manager.applySearchFilter('ignored');

    assert.deepEqual(callsByFilter, [
      ['plugins', 'eq'],
      ['presets', 'system'],
      ['presets', 'user']
    ]);
  });
});

test('filterPlugins matches plugin names and categories, restores collapsed state, and updates counts', async () => {
  await withSearchGlobals({}, async ({ calls, windowRef }) => {
    const pluginList = createPluginList();
    const content = getContent(pluginList);
    const dynamics = createCategoryRow({
      category: 'dynamics',
      title: 'Dynamics',
      itemNames: ['Compressor', 'Limiter']
    });
    const equalizers = createCategoryRow({
      category: 'eq',
      title: 'Equalizers',
      itemNames: ['Tone']
    });
    const delays = createCategoryRow({
      category: 'delay',
      title: 'Delay',
      itemNames: ['Echo']
    });
    const noRightColumn = createCategoryRow({ category: 'missing-right', rightColumn: false });
    const noTitle = createCategoryRow({ category: 'missing-title', title: false, itemNames: ['Hidden'] });
    const noItems = createCategoryRow({ category: 'missing-items', items: false });
    const noDecorations = createCategoryRow({
      category: 'nodecor',
      title: 'No Decoration',
      itemNames: ['Plain'],
      count: false,
      indicator: false
    });
    for (const row of [dynamics, equalizers, delays, noRightColumn, noTitle, noItems, noDecorations]) {
      content.appendChild(row);
    }

    const manager = new SearchManager(createPluginListManager(pluginList, calls));

    manager.filterPlugins('compress');
    assert.equal(dynamics.style.display, '');
    assert.equal(dynamics.querySelectorAll('.plugin-item')[0].style.display, '');
    assert.equal(dynamics.querySelectorAll('.plugin-item')[1].style.display, 'none');
    assert.equal(dynamics.querySelector('.plugin-category-items').style.display, 'flex');
    assert.equal(dynamics.querySelector('.category-effects-count').style.display, 'none');
    assert.equal(dynamics.querySelector('.collapse-indicator').textContent, '\u2335');
    assert.equal(delays.style.display, 'none');
    assert.equal(delays.querySelector('.plugin-category-items').style.display, 'none');
    assert.equal(pluginList.querySelector('#effectCount').textContent, 'ui.effectsFound:1');

    manager.filterPlugins('equal');
    assert.equal(equalizers.style.display, '');
    assert.equal(equalizers.querySelectorAll('.plugin-item')[0].style.display, '');
    assert.equal(pluginList.querySelector('#effectCount').textContent, 'ui.effectsFound:1');

    manager.filterPlugins('plain');
    assert.equal(noDecorations.style.display, '');
    assert.equal(noDecorations.querySelector('.plugin-category-items').style.display, 'flex');

    manager.filterPlugins('');
    assert.deepEqual(calls.filter(call => call[0] === 'updateCategoryVisibility'), [
      ['updateCategoryVisibility', 'dynamics'],
      ['updateCategoryVisibility', 'eq'],
      ['updateCategoryVisibility', 'delay'],
      ['updateCategoryVisibility', 'nodecor']
    ]);
    assert.equal(pluginList.querySelector('#effectCount').textContent, 'ui.effectsAvailable:5');

    windowRef.uiManager = null;
    manager.filterPlugins('limiter');
    assert.equal(pluginList.querySelector('#effectCount').textContent, '1 effects found');

    manager.filterPlugins('');
    assert.equal(pluginList.querySelector('#effectCount').textContent, '5 effects available');

    windowRef.uiManager = {};
    manager.filterPlugins('tone');
    assert.equal(pluginList.querySelector('#effectCount').textContent, '1 effects found');

    pluginList.querySelector('#effectCount').remove();
    manager.filterPlugins('compressor');

    const emptyPluginList = createPluginList({ content: false });
    const emptyManager = new SearchManager(createPluginListManager(emptyPluginList, calls));
    emptyManager.filterPlugins('anything');
  });
});

test('filterPresets matches preset names and categories, restores categories, and updates count text', async () => {
  await withSearchGlobals({}, async ({ calls }) => {
    const pluginList = createPluginList();
    const content = getContent(pluginList);
    const headphone = createCategoryRow({
      category: 'headphone',
      title: 'Headphone',
      itemNames: ['Open Back', 'Closed Back']
    });
    const room = createCategoryRow({
      category: 'room',
      title: 'Room',
      itemNames: ['Near Field']
    });
    const noMatch = createCategoryRow({
      category: 'vinyl',
      title: 'Vinyl',
      itemNames: ['Archive']
    });
    const noRightColumn = createCategoryRow({ category: 'preset-missing-right', rightColumn: false });
    const noTitle = createCategoryRow({ category: 'preset-missing-title', title: false, itemNames: ['Hidden'] });
    const noItems = createCategoryRow({ category: 'preset-missing-items', items: false });
    const noDecorations = createCategoryRow({
      category: 'preset-nodecor',
      title: 'Plain Presets',
      itemNames: ['Bare'],
      count: false,
      indicator: false
    });
    for (const row of [headphone, room, noMatch, noRightColumn, noTitle, noItems, noDecorations]) {
      content.appendChild(row);
    }

    const manager = new SearchManager(createPluginListManager(pluginList, calls));

    manager.filterPresets('open');
    assert.equal(headphone.style.display, '');
    assert.equal(headphone.querySelectorAll('.plugin-item')[0].style.display, '');
    assert.equal(headphone.querySelectorAll('.plugin-item')[1].style.display, 'none');
    assert.equal(headphone.querySelector('.plugin-category-items').style.display, 'flex');
    assert.equal(headphone.querySelector('.category-effects-count').style.display, 'none');
    assert.equal(headphone.querySelector('.collapse-indicator').textContent, '\u2335');
    assert.equal(noMatch.style.display, 'none');
    assert.equal(noMatch.querySelector('.plugin-category-items').style.display, 'none');
    assert.equal(pluginList.querySelector('#effectCount').textContent, '1 presets found');

    manager.filterPresets('room');
    assert.equal(room.style.display, '');
    assert.equal(room.querySelectorAll('.plugin-item')[0].style.display, '');
    assert.equal(pluginList.querySelector('#effectCount').textContent, '1 presets found');

    manager.filterPresets('bare');
    assert.equal(noDecorations.style.display, '');
    assert.equal(noDecorations.querySelector('.plugin-category-items').style.display, 'flex');

    manager.filterPresets('');
    assert.deepEqual(calls.filter(call => call[0] === 'updateCategoryVisibility'), [
      ['updateCategoryVisibility', 'headphone'],
      ['updateCategoryVisibility', 'room'],
      ['updateCategoryVisibility', 'vinyl'],
      ['updateCategoryVisibility', 'preset-nodecor']
    ]);
    assert.equal(pluginList.querySelector('#effectCount').textContent, '5 presets available');

    pluginList.querySelector('#effectCount').remove();
    manager.filterPresets('open');

    const emptyPluginList = createPluginList({ content: false });
    const emptyManager = new SearchManager(createPluginListManager(emptyPluginList, calls));
    emptyManager.filterPresets('anything');
  });
});
