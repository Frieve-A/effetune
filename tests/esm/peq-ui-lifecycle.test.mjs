import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const graphPointInteractionSource = fs.readFileSync(
  new URL('../../plugins/graph-point-interaction.js', import.meta.url),
  'utf8'
);

function loadGraphPointInteractions() {
  const context = { window: {} };
  vm.runInNewContext(graphPointInteractionSource, context);
  return context.window;
}

function loadGraphDragAxisLock() {
  return loadGraphPointInteractions().GraphDragAxisLock;
}

function loadPeqClass(relativePath, className, calls, contextOverrides = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.id = 'peq-test';
      this.enabled = true;
    }

    registerProcessor(processor) {
      this.processor = processor;
    }

    updateParameters() {}

    getParameters() {
      return { type: this.constructor.name, enabled: this.enabled };
    }

    cleanup() {
      calls.push(['superCleanup']);
    }
  }

  const context = {
    PluginBase,
    window: {},
    document: {
      removeEventListener(type, listener) {
        calls.push(['removeEventListener', type, listener]);
      }
    },
    console,
    Math,
    setTimeout
  };
  Object.assign(context, contextOverrides);

  vm.runInNewContext(
    `${graphPointInteractionSource}\n${source}\nthis.LoadedClass = ${className};`,
    context
  );
  return context.LoadedClass;
}

function assertPointerListenersSurviveDragEnd(relativePath, className) {
  const calls = [];
  const PluginClass = loadPeqClass(relativePath, className, calls);
  const plugin = new PluginClass();
  const cleanupPointer = () => calls.push(['cleanupPointer']);
  const mouseMove = () => {};
  const mouseUp = () => {};
  plugin.markers = [{
    classList: {
      remove(className) {
        calls.push(['markerClassRemove', className]);
      }
    }
  }];
  plugin.activeDragMarker = 0;
  plugin.hasMoved = true;
  plugin.boundEventListeners = [cleanupPointer];
  plugin.boundMouseMoveHandler = mouseMove;
  plugin.boundMouseUpHandler = mouseUp;

  plugin.handleDragEnd();

  assert.equal(plugin.activeDragMarker, null);
  assert.equal(plugin.hasMoved, false);
  assert.deepEqual(plugin.boundEventListeners, [cleanupPointer]);
  assert.equal(calls.some(call => call[0] === 'cleanupPointer'), false);
  assert.deepEqual(calls.filter(call => call[0] === 'removeEventListener'), [
    ['removeEventListener', 'mousemove', mouseMove],
    ['removeEventListener', 'mouseup', mouseUp]
  ]);

  plugin.cleanup();

  assert.deepEqual(calls.filter(call => call[0] === 'cleanupPointer'), [['cleanupPointer']]);
  assert.equal(plugin.boundEventListeners.length, 0);
  assert.ok(calls.some(call => call[0] === 'superCleanup'));
}

function createMarker(classPrefix, calls) {
  const markerText = { className: '', style: {}, innerHTML: '' };
  return {
    style: {},
    dataset: {},
    classList: {
      toggle(className, enabled) {
        calls.push(['markerClassToggle', className, enabled]);
      }
    },
    querySelector(selector) {
      return selector === `.${classPrefix}-marker-text` ? markerText : null;
    },
    markerText
  };
}

function assertPeqUsesInsetPlotArea(relativePath, className, bandCount, classPrefix) {
  const calls = [];
  const PluginClass = loadPeqClass(relativePath, className, calls);
  const plugin = new PluginClass();
  const marker = createMarker(classPrefix, calls);
  plugin.uiCreated = true;
  plugin.graphContainer = {
    clientWidth: 1024,
    clientHeight: 480,
    getBoundingClientRect() {
      return { left: 100, top: 50, width: 1024, height: 480 };
    }
  };
  plugin.markers = Array.from({ length: bandCount }, (_, index) => index === 0 ? marker : null);
  plugin.f0 = 10;
  plugin.g0 = 0;
  plugin.e0 = true;
  plugin.t0 = 'pk';

  plugin.updateMarkers();

  assert.equal(marker.style.left, '1.953125%');
  assert.ok(Math.abs(parseFloat(marker.style.top) - 50) < 1e-9);

  let updatedBand = null;
  plugin.activeDragMarker = 0;
  plugin.hasMoved = true;
  plugin.setBand = (bandIndex, freq, gain) => {
    updatedBand = { bandIndex, freq, gain };
  };
  plugin.updateMarkers = () => calls.push(['updateMarkers']);
  plugin.updateResponse = () => calls.push(['updateResponse']);
  plugin.setUIBandValues = bandIndex => calls.push(['setUIBandValues', bandIndex]);

  plugin.handleDragMove({
    clientX: 100 + 20 + ((1024 - 40) * 0.5),
    clientY: 50 + 20 + ((480 - 40) * 0.25)
  });

  assert.equal(updatedBand.bandIndex, 0);
  assert.ok(Math.abs(updatedBand.freq - plugin.xToFreq(50)) < 1e-9);
  assert.equal(updatedBand.gain, 10);
  assert.ok(calls.some(call => call[0] === 'updateMarkers'));
  assert.ok(calls.some(call => call[0] === 'updateResponse'));
  assert.ok(calls.some(call => call[0] === 'setUIBandValues' && call[1] === 0));
}

function assertPeqRedrawsOnResize(relativePath, className) {
  const calls = [];
  let observer = null;
  let observedTarget = null;
  class FakeResizeObserver {
    constructor(callback) {
      observer = this;
      this.callback = callback;
      calls.push(['resizeObserverCreated']);
    }

    observe(target) {
      observedTarget = target;
      calls.push(['resizeObserve', target]);
    }

    disconnect() {
      calls.push(['resizeDisconnect']);
    }
  }

  const PluginClass = loadPeqClass(relativePath, className, calls, { ResizeObserver: FakeResizeObserver });
  const plugin = new PluginClass();
  const graphContainer = {
    clientWidth: 640,
    clientHeight: 300,
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight };
    }
  };
  let markerUpdates = 0;
  let responseUpdates = 0;
  plugin.uiCreated = true;
  plugin.updateMarkers = () => { markerUpdates += 1; };
  plugin.updateResponse = () => { responseUpdates += 1; };

  plugin.observeGraphResize(graphContainer);

  assert.equal(observedTarget, graphContainer);
  observer.callback([{ contentRect: { width: 640, height: 300 } }]);
  assert.equal(markerUpdates, 1);
  assert.equal(responseUpdates, 1);

  observer.callback([{ contentRect: { width: 640, height: 300 } }]);
  assert.equal(markerUpdates, 1);
  assert.equal(responseUpdates, 1);

  graphContainer.clientWidth = 375;
  graphContainer.clientHeight = 176;
  observer.callback([{ contentRect: { width: 375, height: 176 } }]);
  assert.equal(markerUpdates, 2);
  assert.equal(responseUpdates, 2);

  plugin.cleanup();

  assert.deepEqual(calls.filter(call => call[0] === 'resizeDisconnect'), [['resizeDisconnect']]);
  assert.ok(calls.some(call => call[0] === 'superCleanup'));
}

function assertPeqShiftAxisLock(relativePath, className) {
  const calls = [];
  const PluginClass = loadPeqClass(relativePath, className, calls);
  const plugin = new PluginClass();
  plugin.graphContainer = {
    clientWidth: 1000,
    clientHeight: 500,
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    }
  };
  plugin.activeDragMarker = 0;
  plugin.hasMoved = true;
  plugin.f0 = 1000;
  plugin.g0 = 4;
  plugin.updateMarkers = () => {};
  plugin.updateResponse = () => {};
  plugin.setUIBandValues = () => {};
  let updatedBand = null;
  plugin.setBand = (bandIndex, frequency, gain) => {
    updatedBand = { bandIndex, frequency, gain };
  };

  plugin._graphDragAxisLock = { startX: 500, startY: 250, axis: null };
  plugin.handleDragMove({ clientX: 800, clientY: 300, shiftKey: true });
  assert.equal(updatedBand.bandIndex, 0);
  assert.notEqual(updatedBand.frequency, 1000);
  assert.equal(updatedBand.gain, 4);

  plugin._graphDragAxisLock = { startX: 500, startY: 250, axis: null };
  plugin.handleDragMove({ clientX: 530, clientY: 80, shiftKey: true });
  assert.equal(updatedBand.frequency, 1000);
  assert.notEqual(updatedBand.gain, 4);
}

function assertResponseGraphRedrawsOnResize(relativePath, className) {
  const calls = [];
  let observer = null;
  let observedTarget = null;
  class FakeResizeObserver {
    constructor(callback) {
      observer = this;
      this.callback = callback;
    }

    observe(target) {
      observedTarget = target;
    }

    disconnect() {
      calls.push(['resizeDisconnect']);
    }
  }

  const PluginClass = loadPeqClass(relativePath, className, calls, { ResizeObserver: FakeResizeObserver });
  const plugin = new PluginClass();
  const graphContainer = {
    clientWidth: 640,
    clientHeight: 300,
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight };
    }
  };
  let responseUpdates = 0;
  plugin.updateResponse = () => { responseUpdates += 1; };

  plugin.observeGraphResize(graphContainer);

  assert.equal(observedTarget, graphContainer);
  observer.callback([{ contentRect: { width: 640, height: 300 } }]);
  assert.equal(responseUpdates, 1);

  observer.callback([{ contentRect: { width: 640, height: 300 } }]);
  assert.equal(responseUpdates, 1);

  graphContainer.clientWidth = 375;
  graphContainer.clientHeight = 176;
  observer.callback([{ contentRect: { width: 375, height: 176 } }]);
  assert.equal(responseUpdates, 2);

  plugin.cleanup();

  assert.deepEqual(calls.filter(call => call[0] === 'resizeDisconnect'), [['resizeDisconnect']]);
  assert.ok(calls.some(call => call[0] === 'superCleanup'));
}

test('FiveBand PEQ keeps marker pointer listeners after a drag ends', () => {
  assertPointerListenersSurviveDragEnd('../../plugins/eq/five_band_peq.js', 'FiveBandPEQPlugin');
});

test('PEQ graph drag axis lock follows the initial dominant Shift direction', () => {
  const GraphDragAxisLock = loadGraphDragAxisLock();
  const owner = {};
  GraphDragAxisLock.begin(owner, 100, 100);

  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 140, clientY: 110, shiftKey: true
  }), 'x');
  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 110, clientY: 180, shiftKey: true
  }), 'x');

  assert.equal(GraphDragAxisLock.resolve(owner, { clientX: 110, clientY: 180 }), null);
  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 110, clientY: 180, shiftKey: true
  }), null);
  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 110, clientY: 210, shiftKey: true
  }), 'y');

  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 150, clientY: 185, shiftKey: false
  }), null);
  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 160, clientY: 205, shiftKey: true
  }), 'y');

  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 160, clientY: 205, shiftKey: false
  }), null);
  assert.equal(GraphDragAxisLock.resolve(owner, {
    clientX: 190, clientY: 215, shiftKey: true
  }), 'x');

  GraphDragAxisLock.end(owner);
  assert.equal(owner._graphDragAxisLock, null);
});

test('PEQ marker wheel changes Q proportionally and respects a dynamic limit', () => {
  const { PeqMarkerWheel } = loadGraphPointInteractions();
  let wheelHandler = null;
  let listenerOptions = null;
  let q = 1;
  let maximumQ = 10;
  const marker = {
    addEventListener(type, handler, options) {
      assert.equal(type, 'wheel');
      wheelHandler = handler;
      listenerOptions = options;
    }
  };
  PeqMarkerWheel.bind(marker, {
    getQ: () => q,
    maximumQ: () => maximumQ,
    setQ: value => { q = value; }
  });

  let prevented = false;
  wheelHandler({ deltaY: -100, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(q, 1.06);
  assert.equal(listenerOptions.passive, false);

  wheelHandler({ deltaY: 100, preventDefault() {} });
  assert.equal(q, 1);

  q = 2;
  maximumQ = 2;
  wheelHandler({ deltaY: -100, preventDefault() {} });
  assert.equal(q, 2);
});

test('all draggable PEQ point graphs bind Q adjustment to marker wheel events', () => {
  for (const path of [
    '../../plugins/eq/five_band_peq.js',
    '../../plugins/eq/fifteen_band_peq.js',
    '../../plugins/eq/five_band_fir_peq.js',
    '../../plugins/eq/group_delay_peq.js',
    '../../plugins/eq/room_eq.js'
  ]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /PeqMarkerWheel\.bind\(marker,/);
  }
});

test('FifteenBand PEQ keeps marker pointer listeners after a drag ends', () => {
  assertPointerListenersSurviveDragEnd('../../plugins/eq/fifteen_band_peq.js', 'FifteenBandPEQPlugin');
});

test('FiveBand PEQ aligns markers and drag with the inset SVG plot area', () => {
  assertPeqUsesInsetPlotArea('../../plugins/eq/five_band_peq.js', 'FiveBandPEQPlugin', 5, 'five-band-peq');
});

test('FifteenBand PEQ aligns markers and drag with the inset SVG plot area', () => {
  assertPeqUsesInsetPlotArea('../../plugins/eq/fifteen_band_peq.js', 'FifteenBandPEQPlugin', 15, 'fifteen-band-peq');
});

test('FiveBand PEQ Shift-drag changes only frequency or gain', () => {
  assertPeqShiftAxisLock('../../plugins/eq/five_band_peq.js', 'FiveBandPEQPlugin');
});

test('FifteenBand PEQ Shift-drag changes only frequency or gain', () => {
  assertPeqShiftAxisLock('../../plugins/eq/fifteen_band_peq.js', 'FifteenBandPEQPlugin');
});

test('FifteenBand PEQ resolves mobile graph taps to the nearest band without toggling enable state', () => {
  const calls = [];
  const PluginClass = loadPeqClass('../../plugins/eq/fifteen_band_peq.js', 'FifteenBandPEQPlugin', calls);
  const plugin = new PluginClass();
  plugin.uiCreated = false;
  plugin.graphContainer = {
    clientWidth: 375,
    clientHeight: 281,
    getBoundingClientRect() {
      return { left: 10, top: 20, width: this.clientWidth, height: this.clientHeight };
    }
  };

  const targetBand = 8;
  const plotArea = plugin.getGraphPlotArea();
  const clientX = plotArea.left + (plugin.freqToX(plugin[`f${targetBand}`]) / 100) * plotArea.width;
  const clientY = plotArea.top + (plugin.gainToY(plugin[`g${targetBand}`]) / 100) * plotArea.height;
  const enabledBefore = plugin[`e${targetBand}`];
  const selectedBand = plugin.selectNearestBandFromGraphPoint(clientX, clientY);

  assert.equal(selectedBand, targetBand);
  assert.equal(plugin.currentBandIndex, targetBand);
  assert.equal(plugin[`e${targetBand}`], enabledBefore);
});

test('FiveBand PEQ redraws markers and response when the graph is resized', () => {
  assertPeqRedrawsOnResize('../../plugins/eq/five_band_peq.js', 'FiveBandPEQPlugin');
});

test('FifteenBand PEQ redraws markers and response when the graph is resized', () => {
  assertPeqRedrawsOnResize('../../plugins/eq/fifteen_band_peq.js', 'FifteenBandPEQPlugin');
});

test('Earphone Cable Simulator redraws its SVG response when the graph is resized', () => {
  assertResponseGraphRedrawsOnResize('../../plugins/eq/earphone_cable_sim.js', 'EarphoneCableSimPlugin');
});
