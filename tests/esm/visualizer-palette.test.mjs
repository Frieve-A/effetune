import assert from 'node:assert/strict';
import test from 'node:test';
import { paletteColor, scrollingPaletteStops } from '../../js/visualizer/visualizer-effects.js';

test('Reversing Hue runs the color cycle backward from the same starting color', () => {
    const palette = { stops: [{ pos: 0, color: '#ff0000' }], motion: { mode: 'hue', speed: 1 } };
    const reverse = { ...palette, motion: { ...palette.motion, reverse: true } };
    assert.equal(paletteColor(reverse, 0, 0), paletteColor(palette, 0, 0));
    assert.notEqual(paletteColor(reverse, 0, Math.PI), paletteColor(palette, 0, Math.PI));
    for (const time of [1, 3, 10]) assert.equal(paletteColor(reverse, 0, time), paletteColor(palette, 0, -time));
});

test('Reversing Scroll moves sampled colors and gradient stops backward across the loop boundary', () => {
    const palette = { stops: [{ pos: 0, color: '#000000' }, { pos: .5, color: '#ffffff' },
        { pos: 1, color: '#000000' }], motion: { mode: 'scroll', speed: 1 } };
    const reverse = { ...palette, motion: { ...palette.motion, reverse: true } };
    assert.equal(paletteColor(palette, .25, 2.5), 'rgb(255,255,255)');
    assert.equal(paletteColor(reverse, .25, 2.5), 'rgb(0,0,0)');
    assert.equal(paletteColor(reverse, .75, 2.5), 'rgb(255,255,255)');
    for (const [gradient, peak] of [[palette, .25], [reverse, .75]])
        assert.deepEqual(scrollingPaletteStops(gradient, 2.5).filter(stop => stop.color.every(value => value === 255))
            .map(stop => stop.pos), [peak]);
    for (const time of [0, .1, 9.9, 10, 10.1, 12.5]) {
        const stops = scrollingPaletteStops(reverse, time);
        assert.deepEqual(stops, scrollingPaletteStops(palette, -time));
        assert.ok(stops.every(stop => stop.pos >= 0 && stop.pos <= 1 &&
            stop.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255)));
        for (const position of [0, .25, .75, 1])
            assert.equal(paletteColor(reverse, position, time), paletteColor(palette, position, -time));
    }
});
