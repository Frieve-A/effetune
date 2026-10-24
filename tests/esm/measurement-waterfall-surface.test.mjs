import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWaterfallMesh, projectWaterfallPoint, rasterizeWaterfallSurface,
    pickWaterfallSurface, WaterfallSurface, WATERFALL_VIEW_DEFAULTS } from '../../features/measurement/ui/waterfall-surface.js';

const plot = { left: 0, top: 0, width: 100, height: 100 };
const colors = Uint8ClampedArray.from({ length: 1024 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4));
const state = waterfall => ({ waterfall, xMin: 100, xMax: 1000, yMin: -60, yMax: 0 });

test('default view puts increasing time toward the viewer and keeps level upward', () => {
    const back = projectWaterfallPoint({ u: 0.5, v: 0, w: 0 }, WATERFALL_VIEW_DEFAULTS, plot);
    const front = projectWaterfallPoint({ u: 0.5, v: 0, w: 1 }, WATERFALL_VIEW_DEFAULTS, plot);
    const high = projectWaterfallPoint({ u: 0.5, v: 1, w: 1 }, WATERFALL_VIEW_DEFAULTS, plot);
    assert.ok(front.y > back.y);
    assert.ok(front.distance > back.distance);
    assert.ok(high.y < front.y);
    const turned = projectWaterfallPoint({ u: 0.5, v: 0, w: 1 }, { ...WATERFALL_VIEW_DEFAULTS, angle: 180 }, plot);
    assert.ok(turned.distance < back.distance);
});

test('fitted projection contains every volume corner across aspect ratios and orbit angles', () => {
    for (const [width, height] of [[3056, 835], [1018, 664], [348, 340]]) {
        const bounds = { left: 60, top: 52, width, height };
        for (const angle of [25, -135, 90, 180]) for (const elevation of [10, 28, 80]) {
            const view = { angle, elevation, zoom: 1 };
            for (const u of [0, 1]) for (const v of [0, 1]) for (const w of [0, 1]) {
                const point = projectWaterfallPoint({ u, v, w }, view, bounds);
                assert.ok(point.x >= bounds.left - 1e-8 && point.x <= bounds.left + width + 1e-8);
                assert.ok(point.y >= bounds.top - 1e-8 && point.y <= bounds.top + height + 1e-8);
            }
        }
    }
});

test('mesh shares one level scale across slices and preserves missing cells', () => {
    const data = { frequencies: [100, 300, 1000], slices: [
        { time: 0, levels: [-10, -20, -30] },
        { time: 0.1, levels: [-20, -30, -40] },
        { time: 0.2, levels: [-30, null, -50] }
    ] };
    const mesh = buildWaterfallMesh(state(data));
    assert.equal(mesh.triangles.length, 4);
    assert.equal(mesh.depthMin, 0);
    assert.equal(mesh.depthMax, 200);
    for (const vertex of mesh.triangles.flat()) assert.equal(vertex.v, (vertex.level + 60) / 60);
    assert.ok(mesh.triangles.flat().every(point => point.time <= 0.1));
});

test('bounded mesh does not bridge a null sample skipped by frequency decimation', () => {
    const frequencies = Array.from({ length: 500 }, (_, i) => 100 * 10 ** (i / 499));
    const levels = frequencies.map(() => -20);
    levels[250] = null;
    const mesh = buildWaterfallMesh(state({ frequencies, slices: [{ time: 0, levels }, { time: 0.2, levels }] }));
    assert.ok(mesh.triangles.length <= 2 * 191);
    for (const triangle of mesh.triangles) {
        const minimum = Math.min(...triangle.map(point => point.frequency));
        const maximum = Math.max(...triangle.map(point => point.frequency));
        assert.ok(!(minimum < frequencies[250] && maximum > frequencies[250]));
    }
});

test('global normalization uses one finite source reference for ordinary and burst decay views', () => {
    for (const depthUnit of ['seconds', 'cycles']) {
        const data = { depthUnit, frequencies: [20, 100, 300, 1000, 20000], slices: [
            { depth: 0, levels: [80, 12, 6, -8, 90] },
            { depth: 0.1, levels: [70, 2, -4, -18, 80] },
            { depth: 0.2, levels: [60, -8, null, -28, 70] }
        ] };
        const original = structuredClone(data);
        const settings = state(data);
        const plain = buildWaterfallMesh(settings);
        const normalized = buildWaterfallMesh({ ...settings, normalization: 'global' });
        assert.equal(normalized.levelOffset, 12);
        assert.equal(normalized.triangles.length, plain.triangles.length);
        assert.equal(Math.max(...normalized.triangles.flat().map(point => point.level)), 0);
        normalized.triangles.flat().forEach((point, index) => {
            const source = plain.triangles.flat()[index];
            assert.equal(point.level, source.level - 12);
            assert.equal(point.v, (point.level + 60) / 60);
            assert.equal(point.frequency, source.frequency);
            assert.equal(point.depth, source.depth);
            assert.equal(point.time, source.time);
        });
        assert.deepEqual(data, original);
    }
    const frequencies = Array.from({ length: 500 }, (_, i) => 100 * 10 ** (i / 499));
    const levels = frequencies.map(() => -20);
    levels[250] = -5;
    const mesh = buildWaterfallMesh({ ...state({ frequencies,
        slices: [{ time: 0, levels }, { time: 0.2, levels }] }), normalization: 'global' });
    assert.equal(mesh.levelOffset, -5);
    assert.ok(mesh.triangles.flat().every(point => point.level === -15));
});

test('frequency normalization uses each actual temporal peak and preserves causal and tail gaps', () => {
    for (const depthUnit of [undefined, 'seconds', 'cycles']) {
        const data = { depthUnit, frequencies: [100, 200, 400, 800, 1000], slices: [
            { time: 0, depth: 0, levels: [null, 5, -10, null, null] },
            { time: 0.1, depth: 0.1, levels: [20, 15, -5, -25, null] },
            { time: 0.2, depth: 0.2, levels: [10, 0, -20, -15, null] },
            { time: 0.3, depth: 0.3, levels: [0, -10, null, -30, null] }
        ] };
        const original = structuredClone(data);
        const settings = { ...state(data), yMin: -100 };
        const plain = buildWaterfallMesh(settings);
        const global = buildWaterfallMesh({ ...settings, normalization: 'global' });
        const normalized = buildWaterfallMesh({ ...settings, normalization: 'frequency' });
        const peaks = new Map([[100, 20], [200, 15], [400, -5], [800, -15]]);
        assert.equal(normalized.levelOffset, 0);
        assert.equal(normalized.triangles.length, plain.triangles.length);
        const points = normalized.triangles.flat();
        points.forEach((point, index) => {
            const source = plain.triangles.flat()[index];
            assert.equal(point.level, source.level - peaks.get(point.frequency));
            assert.equal(point.v, (point.level + 100) / 100);
            assert.equal(point.depth, source.depth);
            assert.equal(point.time, source.time);
            assert.equal(point.cycles, source.cycles);
        });
        for (const frequency of peaks.keys()) {
            assert.equal(Math.max(...points.filter(point => point.frequency === frequency).map(point => point.level)), 0);
        }
        assert.ok(global.triangles.flat().filter(point => point.frequency === 800).every(point => point.level < 0));
        assert.ok(points.every(point => point.frequency !== 1000));
        assert.deepEqual(data, original);
    }
});

test('frequency peaks include time samples omitted by bounded display decimation', () => {
    const data = { frequencies: [100, 1000], slices: Array.from({ length: 161 }, (_, i) =>
        ({ time: i / 1000, levels: i === 80 ? [12, -5] : [-20, -30] })) };
    const mesh = buildWaterfallMesh({ ...state(data), normalization: 'frequency' });
    assert.equal(mesh.triangles.length, 2 * 79);
    assert.ok(mesh.triangles.flat().every(point => point.level === (point.frequency === 100 ? -32 : -25)));
});

function overlappingTriangle(distance, level, depth) {
    return [{ x: 10, y: 10, frequency: 100 }, { x: 90, y: 10, frequency: 1000 }, { x: 10, y: 90, frequency: 100 }]
        .map(point => ({ ...point, distance, level, depth, v: (level + 60) / 60 }));
}

test('color and readout both use the visible triangle, independent of draw order', () => {
    const rear = overlappingTriangle(-1, -50, 10);
    const front = overlappingTriangle(1, -10, 100);
    for (const triangles of [[rear, front], [front, rear]]) {
        const raster = rasterizeWaterfallSurface(triangles, plot, 1, colors);
        const point = pickWaterfallSurface(raster, 30, 30);
        assert.ok(Math.abs(point.level + 10) < 1e-10);
        assert.ok(Math.abs(point.time - 0.1) < 1e-10);
        assert.equal(raster.pixels[(30 * 100 + 30) * 4], Math.round(50 / 60 * 255));
        assert.equal(pickWaterfallSurface(raster, 95, 95), null);
        assert.equal(pickWaterfallSurface(raster, -1, 30), null);
    }
});

test('intersecting slopes choose the nearer face at each pixel, not a triangle average', () => {
    const sloped = overlappingTriangle(0, -10, 10);
    sloped[0].distance = -1; sloped[1].distance = 1; sloped[2].distance = -1;
    const flat = overlappingTriangle(0, -40, 100);
    const raster = rasterizeWaterfallSurface([sloped, flat], plot, 1, colors);
    assert.ok(Math.abs(pickWaterfallSurface(raster, 20, 20).level + 40) < 1e-10);
    assert.ok(Math.abs(pickWaterfallSurface(raster, 70, 15).level + 10) < 1e-10);
});

test('constant-dB contours follow level intersections and remain hidden behind nearer faces', () => {
    const slope = overlappingTriangle(0, -60, 10);
    slope[1].level = 0; slope[1].v = 1;
    const contours = { min: -60, max: 0, step: 15 };
    const plain = rasterizeWaterfallSurface([slope], plot, 1, colors);
    const lined = rasterizeWaterfallSurface([slope], plot, 1, colors, 'ms', contours);
    const pixel = (raster, x, y) => raster.pixels[(y * 100 + x) * 4];
    assert.ok(pixel(lined, 49, 20) < pixel(plain, 49, 20) * 0.5);
    assert.equal(pixel(lined, 45, 20), pixel(plain, 45, 20));
    assert.deepEqual(pickWaterfallSurface(lined, 49, 20), pickWaterfallSurface(plain, 49, 20));
    const front = overlappingTriangle(1, -30, 100);
    const flat = rasterizeWaterfallSurface([front], plot, 1, colors);
    for (const triangles of [[slope, front], [front, slope]]) {
        const hidden = rasterizeWaterfallSurface(triangles, plot, 1, colors, 'ms', contours);
        assert.deepEqual(hidden.pixels, flat.pixels);
    }
    assert.equal(lined.pixels[(95 * 100 + 95) * 4 + 3], 0);
});

test('frequency grid follows log-frequency intersections with surface occlusion and gaps', () => {
    const slope = overlappingTriangle(0, -30, 10);
    slope.forEach(point => { point.u = Math.log10(point.frequency / 100); });
    slope[2].u = 0.5;
    slope[2].frequency = Math.sqrt(100 * 1000);
    const plain = rasterizeWaterfallSurface([slope], plot, 1, colors);
    const lined = rasterizeWaterfallSurface([slope], plot, 1, colors, 'ms', null, 2);
    const pixel = (raster, x, y) => raster.pixels[(y * 100 + x) * 4];
    // The 316 Hz line slants with the surface instead of staying screen-vertical.
    assert.ok(pixel(lined, 44, 20) > pixel(plain, 44, 20) + 30);
    assert.ok(pixel(lined, 34, 40) > pixel(plain, 34, 40) + 30);
    assert.equal(pixel(lined, 44, 40), pixel(plain, 44, 40));
    assert.deepEqual(pickWaterfallSurface(lined, 44, 20), pickWaterfallSurface(plain, 44, 20));
    assert.equal(lined.pixels[(95 * 100 + 95) * 4 + 3], 0);
    const front = overlappingTriangle(1, -20, 100).map(point => ({ ...point, u: 0.25 }));
    const visible = rasterizeWaterfallSurface([front], plot, 1, colors, 'ms', null, 2);
    for (const triangles of [[slope, front], [front, slope]]) {
        const hidden = rasterizeWaterfallSurface(triangles, plot, 1, colors, 'ms', null, 2);
        assert.deepEqual(hidden.pixels, visible.pixels);
    }
});

test('cycles surfaces report time from the picked frequency and cycle depth', () => {
    const mesh = buildWaterfallMesh(state({ depthUnit: 'cycles', frequencies: [100, 1000],
        slices: [{ depth: 0, levels: [0, 0] }, { depth: 10, levels: [-20, -20] }] }));
    assert.equal(mesh.depthUnit, 'cycles');
    assert.equal(mesh.depthMax, 10);
    const last = mesh.triangles.flat().filter(point => point.depth === 10);
    assert.ok(last.some(point => point.time === 0.1));
    assert.ok(last.some(point => point.time === 0.01));
    const raster = rasterizeWaterfallSurface([overlappingTriangle(1, -10, 10)], plot, 1, colors, 'cycles');
    const point = pickWaterfallSurface(raster, 30, 30);
    assert.ok(Math.abs(point.time * point.frequency - 10) < 1e-10);
    assert.ok(Math.abs(point.cycles - 10) < 1e-10);
});

test('draw uses the canvas viewport, outlines labels, and exports full DPR without changing live state', () => {
    const labels = [];
    const drawn = [];
    const context = {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
        measureText: text => ({ width: text.length * 7 }), fillText() {},
        strokeText: (...args) => labels.push(args),
        createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
        getImageData: () => ({ data: colors }),
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData() {}, drawImage: canvas => drawn.push([canvas.width, canvas.height])
    };
    const canvas = { style: {}, addEventListener() {}, removeEventListener() {},
        ownerDocument: { createElement: () => ({ getContext: () => context }) } };
    const surface = new WaterfallSurface(canvas);
    const settings = { ...state({ frequencies: [100, 1000],
        slices: [{ time: 0, levels: [12, -8] }, { time: 0.2, levels: [-48, -38] }] }),
    ...WATERFALL_VIEW_DEFAULTS, zoom: 2.5 };
    const inner = { left: 60, top: 28, width: 348, height: 354 };
    surface.draw(context, settings, inner, { width: 430, height: 430, dpr: 2 });
    assert.deepEqual(surface.raster.plot, { left: 0, top: 0, width: 430, height: 430 });
    assert.ok(labels.some(([text]) => text === 'dB'));
    const raster = surface.raster;
    let outsideInner = false;
    for (let y = 0; y < raster.height && !outsideInner; y++) for (let x = 0; x < raster.width; x++) {
        if (raster.owners[y * raster.width + x] >= 0 &&
            (x / raster.resolution < inner.left || y / raster.resolution < inner.top)) outsideInner = true;
    }
    assert.equal(outsideInner, true);
    const unnormalizedMesh = surface.mesh;
    settings.normalization = 'global';
    surface.draw(context, settings, inner, { width: 430, height: 430, dpr: 2 });
    assert.notEqual(surface.mesh, unnormalizedMesh);
    assert.equal(surface.mesh.levelOffset, 12);
    assert.ok(surface.keyboardPoint(0.5).level <= 0);
    const globalMesh = surface.mesh;
    settings.normalization = 'frequency';
    surface.draw(context, settings, inner, { width: 430, height: 430, dpr: 2 });
    assert.notEqual(surface.mesh, globalMesh);
    assert.ok(surface.mesh.triangles.flat().filter(point => point.depth === 0).every(point => point.level === 0));
    assert.ok(surface.keyboardPoint(0.5).level <= 0);
    const live = { view: surface.view, raster: surface.raster, mesh: surface.mesh, meshKey: surface.meshKey,
        data: surface.data, buffer: surface.buffer };
    surface.draw(context, { ...settings, normalization: 'global', angle: 90 }, inner, { width: 430, height: 430, dpr: 3, exporting: true });
    assert.deepEqual(drawn.at(-1), [1290, 1290]);
    for (const [key, value] of Object.entries(live)) assert.equal(surface[key], value);
    settings.normalization = 'none';
    surface.draw(context, settings, inner, { width: 430, height: 430, dpr: 2 });
    assert.deepEqual(surface.mesh, unnormalizedMesh);
});

test('drag, pinch and keyboard change only view and reset reproduces the default', () => {
    const handlers = new Map();
    const captured = new Set();
    const canvas = { style: { touchAction: 'pan-y', cursor: '' },
        addEventListener: (name, handler) => handlers.set(name, handler),
        removeEventListener: name => handlers.delete(name), focus() {},
        setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
        releasePointerCapture: id => captured.delete(id) };
    const updates = [];
    const surface = new WaterfallSurface(canvas, { onViewChange: view => updates.push(view) });
    const event = patch => ({ preventDefault() {}, pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 10, ...patch });
    handlers.get('wheel')(event({ deltaY: -100 }));
    assert.equal(updates.length, 0);
    surface.setEnabled(true);
    handlers.get('pointerdown')(event());
    handlers.get('pointermove')(event({ clientX: 30, clientY: 20 }));
    assert.equal(updates.at(-1).angle, 33);
    assert.equal(updates.at(-1).elevation, 25);
    handlers.get('pointerdown')(event({ pointerId: 2, clientX: 60, clientY: 20 }));
    handlers.get('pointermove')(event({ pointerId: 2, clientX: 90, clientY: 20 }));
    assert.equal(updates.at(-1).zoom, 2);
    const count = updates.length;
    handlers.get('keydown')(event({ key: 'ArrowRight' }));
    assert.equal(updates.length, count);
    handlers.get('keydown')(event({ key: 'ArrowRight', shiftKey: true }));
    assert.equal(updates.at(-1).angle, 38);
    handlers.get('keydown')(event({ key: 'Home', shiftKey: true }));
    assert.deepEqual(updates.at(-1), WATERFALL_VIEW_DEFAULTS);
    surface.destroy();
    assert.equal(handlers.size, 0);
    assert.equal(captured.size, 0);
    assert.equal(canvas.style.touchAction, 'pan-y');
});
