import assert from 'node:assert/strict';
import test from 'node:test';

import dataStorage from '../../features/measurement/dataStorage.js';
import GraphRenderer from '../../features/measurement/ui/graph-renderer.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createElement() {
  const listeners = new Map();
  return {
    children: [],
    className: '',
    dataset: {},
    hidden: false,
    style: {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { listeners.get(type)?.({ type }); }
  };
}

test('selected channel correction and corrected response use the displayed channel frequency grid', async t => {
  const originalGetMeasurement = dataStorage.getMeasurementById;
  const measurement = {
    id: 'selected-grid', outputChannels: ['left', '2'], points: [{}],
    averageFrequencyResponse: [[100, 0], [1600, 0]],
    channelResponses: [{ channel: '2', averageFrequencyResponse: [[1500, 1], [1800, 3]], maxSignalLevel: -12 }],
    sweepBand: { mode: 'perChannel', common: { minFreq: 20, maxFreq: 20000 },
      perChannel: [{ channel: '2', minFreq: 1500, maxFreq: 1800 }] },
    peqParameters: [{ frequency: 1650, gain: -1, Q: 2 }]
  };
  dataStorage.getMeasurementById = () => measurement;
  t.after(() => { dataStorage.getMeasurementById = originalGetMeasurement; });
  const context = { fillRect() {} };
  const controls = {
    resultsGraph: { width: 800, height: 400, getContext: () => context },
    showOriginal: { checked: false }, showCorrection: { checked: true },
    showCorrected: { checked: true }, smoothing: { value: '0.3' }
  };
  const grids = [];
  const renderer = new GraphRenderer({
    selectedMeasurementId: measurement.id,
    measurementDisplay: { selectedChannel: '2', selectedPointIndex: 'all' },
    graphColors: { correction: 'orange', corrected: 'green' },
    correctionHandler: {
      drawFrequencyMarkers() {},
      generateCorrectionCurve(parameters, grid) {
        assert.strictEqual(parameters, measurement.peqParameters);
        grids.push(grid);
        return grid.map(([frequency]) => [frequency, -1]);
      }
    }
  });
  renderer.drawFrequencyGrid = () => {};
  const drawn = [];
  renderer.drawGraph = (_context, response, color) => drawn.push({ response, color });
  await withGlobals({
    document: { getElementById: id => controls[id] || null },
    window: { app: { audioUtils: { smoothFrequencyResponse: response => response } } }
  }, async () => {
    renderer.updateResultsGraph();
    assert.equal(grids.length, 2);
    assert.ok(grids.every(grid => grid === measurement.channelResponses[0].averageFrequencyResponse));
    assert.deepEqual(drawn, [
      { color: 'orange', response: [[1500, -1], [1800, -1]] },
      { color: 'green', response: [[1500, -2], [1800, 0]] }
    ]);
  });
});

test('multichannel point legend separates hovered curves and leaves impulse loading idle', async t => {
  const originalGetMeasurement = dataStorage.getMeasurementById;
  const legend = createElement();
  const context = {
    canvas: { width: 800, height: 400 },
    fillStyle: '',
    font: '',
    textAlign: '',
    fillRect() {},
    fillText() {}
  };
  const canvas = { width: 800, height: 400, getContext: () => context };
  const controls = {
    showOriginal: { checked: true },
    showCorrection: { checked: false },
    showCorrected: { checked: false },
    smoothing: { value: '0.3' },
    resultsGraph: canvas,
    resultsChannelLegend: legend
  };
  const multichannel = {
    id: 'multi',
    outputChannel: 'multi',
    outputChannels: ['left', '2'],
    sweepMinFreq: 20,
    sweepMaxFreq: 20000,
    averageFrequencyResponse: [[100, 0], [1000, 0]],
    maxSignalLevel: -12,
    channelResponses: [
      { channel: 'left', averageFrequencyResponse: [[100, -1], [1000, 1]], maxSignalLevel: -12 },
      { channel: '2', averageFrequencyResponse: [[100, 1], [1000, -1]], maxSignalLevel: -11 }
    ],
    points: [{
      pointId: 1,
      channels: [
        { channel: 'left', frequencyResponse: [[100, -1], [1000, 1]], maxSignalLevel: -12 },
        { channel: '2', frequencyResponse: [[100, 1], [1000, -1]], maxSignalLevel: -11 }
      ]
    }]
  };
  const single = {
    id: 'single',
    averageFrequencyResponse: [[100, 0], [1000, 0]],
    points: [{ pointId: 1, frequencyResponse: [[100, 0], [1000, 0]], maxSignalLevel: -12 }]
  };
  let currentMeasurement = multichannel;
  dataStorage.getMeasurementById = () => currentMeasurement;
  t.after(() => { dataStorage.getMeasurementById = originalGetMeasurement; });

  const measurementDisplay = { selectedPointIndex: 0, selectedChannel: 'all' };
  const uiManager = {
    selectedMeasurementId: 'multi',
    measurementDisplay,
    graphColors: { original: '#fff', correction: '#0f0', corrected: '#f0f' },
    correctionHandler: { drawFrequencyMarkers() {}, generateCorrectionCurve() { return []; } }
  };
  const renderer = new GraphRenderer(uiManager);
  const drawn = [];
  let impulseUpdates = 0;
  renderer.drawFrequencyGrid = () => {};
  renderer.drawGraph = (_ctx, _response, color) => drawn.push(color);
  renderer.updateImpulseResponseGraph = () => { impulseUpdates += 1; };

  await withGlobals({
    document: {
      createElement,
      getElementById: id => controls[id] || null
    },
    window: { app: { audioUtils: { smoothFrequencyResponse: response => response } } }
  }, async () => {
    renderer.updateResultsGraph(0);
    assert.equal(legend.hidden, false);
    assert.equal(legend.children.length, 2);
    assert.equal(drawn.length, 2);

    drawn.length = 0;
    renderer.updateResultsGraph();
    assert.equal(legend.hidden, false);
    assert.equal(legend.children.length, 2);
    assert.equal(drawn.length, 2);

    drawn.length = 0;
    renderer.updateResultsGraph('all');
    assert.equal(legend.hidden, true);
    assert.equal(drawn.length, 1);

    drawn.length = 0;
    renderer.updateResultsGraph();
    assert.equal(legend.hidden, false);
    assert.equal(legend.children.length, 2);
    assert.equal(drawn.length, 2);

    drawn.length = 0;
    legend.children[0].dispatch('mouseenter');
    assert.equal(renderer.hoveredChannel, 'left');
    assert.equal(drawn.length, 1);
    assert.equal(impulseUpdates, 0);

    drawn.length = 0;
    legend.children[0].dispatch('mouseleave');
    assert.equal(renderer.hoveredChannel, null);
    assert.equal(drawn.length, 2);

    measurementDisplay.selectedChannel = 'left';
    drawn.length = 0;
    renderer.updateResultsGraph(0);
    assert.equal(legend.hidden, true);
    assert.equal(drawn.length, 1);

    measurementDisplay.selectedChannel = 'all';
    measurementDisplay.selectedPointIndex = 'all';
    renderer.updateResultsGraph('all');
    assert.equal(legend.hidden, true);

    currentMeasurement = single;
    uiManager.selectedMeasurementId = 'single';
    measurementDisplay.selectedPointIndex = 0;
    renderer.updateResultsGraph(0);
    assert.equal(legend.hidden, true);
  });
});
