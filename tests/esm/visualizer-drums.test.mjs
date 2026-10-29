import assert from 'node:assert/strict';
import test from 'node:test';
import { DrumsDisplay } from '../../js/visualizer/visualizer-drums.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('Drums lights five independent lanes, ages batched hits, and ignores beat annotations', () => {
    let now = 1000;
    return withGlobals({ performance: { now: () => now }, window: {
        RhythmAnalyzerPlugin: class { parseTelemetryFrame(frame) { return frame.snapshot; } }
    } }, () => {
        const display = new DrumsDisplay();
        display.initializeDisplayState();
        const source = {};
        const snapshot = { displayMode: 'drums', generation: 1, frameCount: 0, hopSeconds: .01,
            drumLatencySeconds: .08, confidence: 0, events: [
                { identity: 'old', time: 1, band: 0, strength: 1 },
                ...[0, 1, 2, 3, 4].map(band => ({ identity: `hit-${band}`, time: 2 - band * .05, band, strength: .8 }))
            ] };
        display.handleTelemetry({ source, snapshot });
        const levels = [...display.stepLevels(now)];
        assert.ok(Math.abs(levels[0] - .8) < .0001);
        assert.ok(levels.every(value => value > 0));
        assert.ok(levels[0] > levels[1] && levels[1] > levels[2] && levels[2] > levels[3] && levels[3] > levels[4]);
        now += 200;
        display.handleTelemetry({ source, snapshot: { ...snapshot,
            events: snapshot.events.map(event => ({ ...event, annotated: true })) } });
        assert.ok(display.stepLevels(now)[0] < .1);
        now += 110;
        assert.deepEqual([...display.stepLevels(now)], [0, 0, 0, 0, 0]);
        // A new source can reuse generation and event IDs; a new generation clears old lights.
        display.handleTelemetry({ source: {}, snapshot });
        assert.ok(display.stepLevels(now)[0] > .7);
        const currentSource = display.telemetrySource;
        display.handleTelemetry({ source: currentSource, snapshot: { ...snapshot, generation: 2, events: [] } });
        assert.deepEqual([...display.stepLevels(now)], [0, 0, 0, 0, 0]);
        display.handleTelemetry({ source: currentSource, snapshot });
        assert.deepEqual([...display.stepLevels(now)], [0, 0, 0, 0, 0]);
    });
});

test('Drums does not flash old queued events when the source has an analysis clock', () => {
    return withGlobals({ performance: { now: () => 1000 }, window: {
        RhythmAnalyzerPlugin: class { parseTelemetryFrame(frame) { return frame.snapshot; } }
    } }, () => {
        const display = new DrumsDisplay();
        display.initializeDisplayState();
        display.handleTelemetry({ source: {}, snapshot: { displayMode: 'drums', generation: 1,
            frameCount: 1000, hopSeconds: .01, drumLatencySeconds: .08,
            events: [{ identity: 'old', time: 2, band: 0, strength: 1 }] } });
        assert.deepEqual([...display.stepLevels(1000)], [0, 0, 0, 0, 0]);
    });
});
