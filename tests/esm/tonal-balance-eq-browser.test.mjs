import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
// The app's stylesheets and palette; 'paper' is the light theme, the default theme is dark.
const STYLES = [
    read('../../css/effetune-theme.css'),
    read('../../css/effetune.css').replace(/@import[^;]*;/g, ''),
    read('../../css/effetune-mobile.css'),
    read('../../plugins/graph-readout.css'),
    read('../../plugins/eq/room_eq.css'),
    read('../../plugins/eq/tonal_balance_eq.css')
];
// The plugin builds its Target adjust editor from Room EQ's, which needs the graph point helpers.
const SCRIPTS = ['plugins/theme-palette.js', 'plugins/plugin-base.js', 'plugins/graph-readout.js',
    'plugins/graph-point-interaction.js', 'plugins/eq/room_eq.js', 'plugins/eq/tonal_balance_eq.js'];
const THEMES = { light: 'paper', dark: null };

// Page-side helpers: a frame-29 builder with a tilted target (upperShift raises it from band 20 up, mu replaces it),
// a wavy measured spectrum and bands 1..38 inside Low-High, and an ink counter against the graph background.
const PAGE_HELPERS = `
window.buildTonalFrame = ({ targetIndex = 0, stateFlags = 15, makeup = 1.5, loudness = -18, upperShift = 0, mu = null } = {}) => {
    const payload = new DataView(new ArrayBuffer(1564));
    payload.setFloat32(0, 48000, true);
    payload.setUint16(4, 41, true);
    payload.setUint16(6, 128, true);
    payload.setUint8(8, stateFlags);
    payload.setUint8(9, targetIndex);
    payload.setFloat32(12, loudness, true);
    payload.setFloat32(16, makeup, true);
    payload.setUint32(20, 500, true);
    for (let band = 0; band < 41; band++) {
        const octave = Math.log2((10 ** ((band + 1) / 21.4) - 1) * 1000 / 4.37 / 1000);
        // Band 40 lies above High and holds residue far below the rest (a lossy cutoff).
        payload.setFloat32(24 + 4 * band, band === 40 ? -30 : 70 - 3 * octave + 4 * Math.sin(band / 3), true);
        payload.setFloat32(188 + 4 * band, 0.9, true);
        payload.setFloat32(352 + 4 * band, band < 20 ? 0.8 : 0.4, true);
        payload.setFloat32(680 + 4 * band, mu ? mu[band] : -1.5 * octave + (band >= 20 ? upperShift : 0), true);
        payload.setFloat32(844 + 4 * band, 2, true);
        payload.setUint8(1008 + band, 4 | 8 | (band >= 1 && band <= 38 ? 16 : 0));
    }
    for (let index = 0; index < 128; index++) payload.setFloat32(1052 + 4 * index, makeup + 3 * Math.sin(index / 12), true);
    return { frameType: 29, formatVersion: 1, payload };
};
window.countInk = (context, width, height, background) => {
    const data = context.getImageData(0, 0, width, height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== background[0] || data[i + 1] !== background[1] || data[i + 2] !== background[2]) ink++;
    }
    return ink;
};
`;

async function openPage(browser, width, theme) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const mobile = width < 768 ? ' class="layout-mobile"' : '';
    const dataTheme = THEMES[theme] ? ` data-theme="${THEMES[theme]}"` : '';
    // The host stands in for the pipeline column: 1024 px of content on desktop, the full width on mobile.
    const host = width < 768 ? '100%' : '1024px';
    await page.setContent(`<!doctype html><html${mobile}${dataTheme}><body${mobile}><div id="host" style="width:${host}"></div></body></html>`);
    for (const content of STYLES) await page.addStyleTag({ content });
    await page.addScriptTag({ content: read('../../js/ui/range-fill.js').replace(/^export /gm, '') });
    for (const path of SCRIPTS) await page.addScriptTag({ content: read(`../../${path}`) });
    await page.addScriptTag({ content: PAGE_HELPERS });
    return page;
}

test('Tonal Balance EQ lays out its controls and graph at desktop and mobile widths in both themes', { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const width of [1280, 375]) {
            for (const theme of ['light', 'dark']) {
                const page = await openPage(browser, width, theme);
                const result = await page.evaluate(async () => {
                    const plugin = new window.TonalBalanceEQPlugin();
                    plugin.id = 1;
                    const ui = plugin.createUI();
                    document.getElementById('host').appendChild(ui);
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    // Every graph colour is a theme palette role as defined, so the draw never dims it with globalAlpha.
                    const alphaDescriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha');
                    const alphas = new Set();
                    Object.defineProperty(CanvasRenderingContext2D.prototype, 'globalAlpha', {
                        ...alphaDescriptor,
                        set(value) { alphas.add(value); alphaDescriptor.set.call(this, value); }
                    });
                    plugin.handleTelemetry(window.buildTonalFrame());
                    Object.defineProperty(CanvasRenderingContext2D.prototype, 'globalAlpha', alphaDescriptor);
                    const { width, height } = plugin.canvas;
                    const frame = plugin._readoutFrame;
                    const view = frame.view;
                    const readAt = frequency => plugin._readGraph(
                        (Math.log10(frequency) - TONAL_BALANCE_EQ_LOG_MIN) / TONAL_BALANCE_EQ_LOG_SPAN * width);
                    const corrected = [...view.measured].filter((value, band) => Number.isFinite(view.lift[band]));
                    const plotted = [view.targetLow, view.targetHigh, corrected, view.response]
                        .flatMap(values => [...values].filter(Number.isFinite));
                    const background = window.ThemePalette.get('graph-bg-deep').match(/[\d.]+/g).map(Number);
                    const rect = plugin.canvas.getBoundingClientRect();
                    const outsideWindow = element => element.getBoundingClientRect().right > window.innerWidth;
                    const averagingTimeText = ui.querySelector('.tonal-balance-eq-averaging-time-value');
                    const resetRect = ui.querySelector('.analog-meter-reset-button').getBoundingClientRect();
                    const copyRect = ui.querySelector('.tonal-balance-eq-copy-peq-button').getBoundingClientRect();
                    return {
                        copyBesideReset: copyRect.top === resetRect.top && copyRect.left > resetRect.right &&
                            copyRect.right <= window.innerWidth,
                        width,
                        alphas: [...alphas],
                        cssWidth: rect.width,
                        canvasInside: rect.left >= 0 && rect.right <= window.innerWidth,
                        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
                        rowsOverflow: [...ui.querySelectorAll('.parameter-row')]
                            .filter(row => row.getBoundingClientRect().right > window.innerWidth ||
                                [...row.children].some(child => child.getBoundingClientRect().right > window.innerWidth))
                            .length,
                        adjustControlsOverflow: [...ui.querySelectorAll('.room-eq-additional-eq-controls *')]
                            .filter(outsideWindow).length,
                        markersInside: [...ui.querySelectorAll('.room-eq-additional-eq-marker')].every(marker => {
                            const box = marker.getBoundingClientRect();
                            const x = (box.left + box.right) / 2;
                            const y = (box.top + box.bottom) / 2;
                            return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
                        }),
                        averagingTimeBoxWidth: averagingTimeText.getBoundingClientRect().width,
                        ink: window.countInk(plugin.canvasCtx, width, height, background),
                        withheldBands: [...view.lift].filter(value => value > 0).length,
                        inRange: plotted.every(value => value <= plugin.dbTop && value >= plugin.dbBottom),
                        dbBottom: plugin.dbBottom,
                        cursor: readAt(1000).cursor,
                        rows: readAt(1000).rows.map(row => [row.label, row.value]),
                        outside: readAt(20000).rows.find(row => row.label === 'Measured').value,
                        targetOptions: [...ui.querySelector('.analyzer-parameters select').options].map(option => option.value)
                    };
                });
                const label = `${width}px ${theme}`;
                assert.deepEqual(result.alphas, [], label);
                assert.ok(result.ink > 5000, label);
                assert.ok(result.canvasInside, label);
                assert.ok(result.copyBesideReset, label);
                assert.ok(result.pageOverflow <= 0, label);
                assert.equal(result.rowsOverflow, 0, label);
                assert.equal(result.adjustControlsOverflow, 0, label);
                assert.ok(result.markersInside, label);
                assert.ok(result.averagingTimeBoxWidth >= 70 && result.averagingTimeBoxWidth <= 90, label);
                assert.ok(result.withheldBands > 5, label);
                assert.ok(result.inRange, label);
                assert.ok(result.dbBottom >= -24, label);
                assert.equal(result.cursor, '1.00 kHz', label);
                assert.deepEqual(result.rows.map(row => row[0]),
                    ['Target', 'Target adjust', 'Measured', 'EQ response', 'Withheld lift', 'Presence', 'Make-up gain', 'Loudness'], label);
                for (const [, value] of result.rows.slice(0, 4)) assert.match(value, /^[+−]\d+\.\d dB$/, label);
                assert.match(result.rows[4][1], /^≈\d+\.\d dB$/, label);
                assert.equal(result.rows[5][1], '80%', label);
                assert.equal(result.rows[6][1], '+1.5 dB', label);
                assert.equal(result.rows[7][1], '−18.0 LKFS', label);
                assert.equal(result.outside, '—', label);
                assert.deepEqual(result.targetOptions, ['All', 'Classical', 'Electronic', 'Pop', 'Rock', 'Tilt'], label);
                if (width === 375) assert.ok(result.cssWidth <= 375, label);
                else assert.equal(result.cssWidth, 1024, label);
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
});

test('Tonal Balance EQ greys only the correction controls at Amount 0, maps Averaging Time to ∞ and resets', { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await openPage(browser, 1280, 'dark');
        const result = await page.evaluate(async () => {
            const plugin = new window.TonalBalanceEQPlugin();
            plugin.id = 1;
            const posted = [];
            window.workletNode = { port: { postMessage: message => posted.push(message) } };
            const ui = plugin.createUI();
            document.getElementById('host').appendChild(ui);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rows = () => Object.fromEntries([...ui.querySelectorAll('.parameter-row')].map(row => [
                row.querySelector('label').textContent,
                row.classList.contains('parameter-disabled') || [...row.querySelectorAll('input')].some(input => input.disabled)
            ]));
            const out = { initial: rows() };
            plugin.setParameters({ am: 0 });
            out.silent = rows();
            plugin.setParameters({ am: 1 });
            out.restored = rows();

            const slider = ui.querySelector('input[id$="-averaging-time-slider"]');
            const text = ui.querySelector('.tonal-balance-eq-averaging-time-value');
            out.averagingTimeDefault = [text.value, plugin.at];
            slider.value = '100';
            slider.dispatchEvent(new Event('input'));
            out.averagingTimeTop = [text.value, plugin.at];
            slider.value = '0';
            slider.dispatchEvent(new Event('input'));
            out.averagingTimeBottom = [text.value, plugin.at];
            text.value = '10';
            text.dispatchEvent(new Event('change'));
            out.averagingTimeTyped = [text.value, plugin.at, Number(slider.value).toFixed(1)];
            text.value = 'inf';
            text.dispatchEvent(new Event('change'));
            out.averagingTimeTypedInfinite = [text.value, plugin.at, slider.value];
            plugin.at = 3;
            plugin.syncUIControls();
            out.averagingTimeRefreshed = [text.value, Number(slider.value).toFixed(1)];

            const copyPeq = ui.querySelector('.tonal-balance-eq-copy-peq-button');
            out.copyDisabled = [copyPeq.disabled];
            // Withheld lift: per band, and drawn (its base and its height above that base at the curve samples).
            const withheld = () => {
                const { lift, curves } = plugin._readoutFrame.view;
                return {
                    lift: [...lift],
                    base: [...curves.withheldLow],
                    height: [...curves.withheldHigh].map((high, index) => high - curves.withheldLow[index])
                };
            };
            // Largest distance of a drawn curve from its band value at a band centre, or from the
            // range of the two neighbouring band values between centres (Infinity if a band is not drawn).
            const curveError = (values, curve) => {
                const xs = TONAL_BALANCE_EQ_CURVE_LOG_FREQS;
                const centres = TONAL_BALANCE_EQ_BAND_LOG_FREQS;
                let error = 0;
                let band = 0;
                xs.forEach((x, index) => {
                    while (band < 40 && centres[band + 1] <= x) band++;
                    const y = curve[index];
                    if (x === centres[band] && Number.isFinite(values[band]) && !Number.isFinite(y)) error = Infinity;
                    if (!Number.isFinite(y)) return;
                    const other = x === centres[band] ? values[band] : values[band + 1];
                    const low = values[band] < other ? values[band] : other;
                    const high = values[band] < other ? other : values[band];
                    const distance = y < low ? low - y : y > high ? y - high : 0;
                    if (distance > error) error = distance;
                });
                return error;
            };
            plugin.handleTelemetry(window.buildTonalFrame());
            out.hadReading = plugin.reading !== null;
            out.copyDisabled.push(copyPeq.disabled);
            const atOnePercent = withheld();
            plugin.setParameters({ am: 0 });
            out.copyDisabled.push(copyPeq.disabled);
            const atZero = withheld();
            out.edgeAtAmountZero = [...plugin._readoutFrame.view.curves.withheldEdge].some(Number.isFinite);
            plugin.setParameters({ am: 100 });
            out.copyDisabled.push(copyPeq.disabled);
            const atFull = withheld();
            // The base is the drawn EQ response line (linear on the 128-point grid).
            const { view } = plugin._readoutFrame;
            const drawn = atFull.base.flatMap((base, index) => (Number.isFinite(base) ? [index] : []));
            out.withheld = {
                corrected: atFull.lift.filter(Number.isFinite).length,
                lifted: atFull.lift.filter(lift => lift > 0.1).length,
                baseError: Math.max(...drawn.map(index => Math.abs(atFull.base[index] -
                    window.GraphReadout.seriesValueAt(TONAL_BALANCE_EQ_GRID_LOG_FREQS, view.response, TONAL_BALANCE_EQ_CURVE_LOG_FREQS[index])))),
                minHeight: Math.min(...drawn.map(index => atFull.height[index])),
                zeroAtAmountZero: drawn.every(index => atZero.height[index] === 0),
                scaleError: Math.max(...drawn.map(index => Math.abs(atOnePercent.height[index] - atFull.height[index] / 100)))
            };
            out.curveErrors = [
                curveError(view.target, view.curves.target),
                curveError(view.measured, view.curves.measured),
                curveError(atFull.lift, atFull.height)
            ];
            ui.querySelector('.analog-meter-reset-button').click();
            out.posted = posted.filter(message => message.type === 'resetPluginState');
            out.readingAfterReset = plugin.reading;
            out.copyDisabled.push(copyPeq.disabled);

            plugin.setParameters({ tg: 'Rock' });
            plugin.handleTelemetry(window.buildTonalFrame({ targetIndex: 0 }));
            out.staleTargetDropped = plugin.reading === null;
            plugin.handleTelemetry(window.buildTonalFrame({ targetIndex: 4, stateFlags: 11 }));
            out.loudnessPending = plugin._readGraph(100).rows.find(row => row.label === 'Loudness').value;
            out.shortFrame = window.TonalBalanceEQPlugin.parseTelemetryFrame(
                { frameType: 29, formatVersion: 1, payload: new DataView(new ArrayBuffer(1560)) });
            plugin.cleanup();
            return out;
        });
        const all = {
            'Target:': false, 'Slope (dB/oct):': false, 'Corner (Hz):': false, 'Amount (%):': false, 'Range (dB):': false, 'Smoothing (oct):': false, 'Averaging Time (s):': false,
            'Low (Hz):': false, 'High (Hz):': false, 'Average SPL (dB):': false
        };
        assert.deepEqual(result.initial, all);
        assert.deepEqual(result.silent,
            { ...all, 'Range (dB):': true, 'Smoothing (oct):': true, 'Low (Hz):': true, 'High (Hz):': true });
        assert.deepEqual(result.restored, all);
        assert.deepEqual(result.averagingTimeDefault, ['30.0', 30]);
        assert.deepEqual(result.averagingTimeTop, ['∞', 100]);
        assert.deepEqual(result.averagingTimeBottom, ['0.1', 0.1]);
        assert.deepEqual(result.averagingTimeTyped, ['10.0', 10, '66.7']);
        assert.deepEqual(result.averagingTimeTypedInfinite, ['∞', 100, '100']);
        assert.deepEqual(result.averagingTimeRefreshed, ['3.0', '49.2']);
        assert.ok(result.hadReading);
        // Withheld lift: on the drawn EQ response, never negative, height proportional to Amount.
        assert.equal(result.withheld.corrected, 38);
        assert.ok(result.withheld.lifted > 5);
        assert.ok(result.withheld.baseError < 1e-9, `base error ${result.withheld.baseError}`);
        assert.ok(result.withheld.minHeight >= 0, `min height ${result.withheld.minHeight}`);
        assert.ok(result.withheld.zeroAtAmountZero);
        assert.equal(result.edgeAtAmountZero, false);
        assert.ok(result.withheld.scaleError < 1e-9, `scale error ${result.withheld.scaleError}`);
        // Drawn curves: through every band value, never beyond the two neighbouring band values.
        for (const error of result.curveErrors) assert.ok(error < 1e-9, `curve error ${error}`);
        assert.deepEqual(result.posted, [{ type: 'resetPluginState', pluginId: 1 }]);
        assert.equal(result.readingAfterReset, null);
        // Copy as PEQ: no curve, curve, Amount 0, Amount back, after Reset.
        assert.deepEqual(result.copyDisabled, [true, false, true, false, true]);
        assert.ok(result.staleTargetDropped);
        assert.equal(result.loudnessPending, '—');
        assert.equal(result.shortFrame, null);
        await page.close();
    } finally {
        await browser.close();
    }
});

test('Tonal Balance EQ copies its EQ curve as a pasteable 5Band PEQ', { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        // Serve the repository so the plugin's lazy imports of the PEQ fitter resolve as in the app.
        await page.route('http://effetune.test/**', route => {
            const path = new URL(route.request().url()).pathname;
            if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
            return route.fulfill({ contentType: 'text/javascript', body: read(`../..${path}`) });
        });
        await page.goto('http://effetune.test/');
        await page.addScriptTag({ content: read('../../js/ui/range-fill.js').replace(/^export /gm, '') });
        for (const path of SCRIPTS) {
            await page.addScriptTag({ url: `http://effetune.test/${path}` });
        }
        await page.addScriptTag({ content: PAGE_HELPERS });
        const result = await page.evaluate(async () => {
            let copied = null;
            const messages = [];
            window.electronAPI = { writeClipboardText: async text => { copied = text; return true; } };
            window.uiManager = {
                showTransientMessage: key => messages.push(key),
                setError: key => messages.push(key)
            };
            const plugin = new window.TonalBalanceEQPlugin();
            plugin.id = 1;
            document.body.appendChild(plugin.createUI());
            plugin.handleTelemetry(window.buildTonalFrame());
            document.querySelector('.tonal-balance-eq-copy-peq-button').click();
            for (let wait = 0; wait < 200 && messages.length === 0; wait++) await new Promise(resolve => setTimeout(resolve, 25));
            return { copied, messages, lo: plugin.lo, hi: plugin.hi };
        });
        assert.deepEqual(result.messages, ['success.settingsCopied']);
        const [state, ...rest] = JSON.parse(result.copied);
        assert.equal(rest.length, 0);
        assert.equal(state.nm, '5Band PEQ');
        assert.equal(state.ch, undefined);
        for (let band = 0; band < 5; band++) {
            assert.equal(state[`t${band}`], 'pk');
            assert.equal(state[`e${band}`], true);
        }
        // The PEQ follows the graphed curve's shape (6 dB peak to peak) around its average level over Low-High.
        const { peqResponse } = await import('../../features/measurement/peq-calculator/filter-response.js');
        const freqs = Array.from({ length: 128 }, (_, index) => 20 * 1000 ** (index / 127));
        const fitted = freqs.map(() => 0);
        for (let band = 0; band < 5; band++) {
            peqResponse(freqs, state[`f${band}`], state[`g${band}`], state[`q${band}`]).forEach((db, index) => { fitted[index] += db; });
        }
        const inRange = freqs.map((_, index) => index).filter(index => freqs[index] >= result.lo && freqs[index] <= result.hi);
        const curve = freqs.map((_, index) => Math.fround(1.5 + 3 * Math.sin(index / 12)));
        const mean = inRange.reduce((sum, index) => sum + curve[index], 0) / inRange.length;
        const maxError = Math.max(...inRange.map(index => Math.abs(fitted[index] - (curve[index] - mean))));
        assert.ok(maxError < 1.5, `max fit error ${maxError.toFixed(2)} dB`);
        await page.close();
    } finally {
        await browser.close();
    }
});

test('Tonal Balance EQ edits its Target adjust bands on the graph and draws the adjusted target', { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await openPage(browser, 1280, 'dark');
        const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // Built while hidden, as in a collapsed pipeline entry, then shown.
        await page.evaluate(() => {
            const host = document.getElementById('host');
            host.style.display = 'none';
            const plugin = window.plugin = new window.TonalBalanceEQPlugin();
            plugin.id = 1;
            window.workletNode = { port: { postMessage() {} } };
            host.appendChild(plugin.createUI());
            // Per band: the handle centre, its offset from the canvas mapping, and the band values.
            window.handleState = () => {
                const rect = plugin.canvas.getBoundingClientRect();
                const span = plugin.dbTop - plugin.dbBottom;
                return [...document.querySelectorAll('.room-eq-additional-eq-marker')].map((marker, band) => {
                    const box = marker.getBoundingClientRect();
                    const x = (box.left + box.right) / 2;
                    const y = (box.top + box.bottom) / 2;
                    return {
                        x,
                        y,
                        dx: x - rect.left - (Math.log10(plugin['fa' + band]) - TONAL_BALANCE_EQ_LOG_MIN) / TONAL_BALANCE_EQ_LOG_SPAN * rect.width,
                        dy: y - rect.top - (plugin.dbTop - plugin['ga' + band]) / span * rect.height,
                        enabled: plugin['ea' + band],
                        f: plugin['fa' + band],
                        g: plugin['ga' + band],
                        q: plugin['qa' + band]
                    };
                });
            };
            // The colours stroked during one redraw, and the Target adjust colour as the canvas spells it.
            window.strokedColours = () => {
                const context = plugin.canvasCtx;
                const stroked = new Set();
                const stroke = context.stroke;
                context.stroke = function (...args) {
                    stroked.add(this.strokeStyle);
                    return stroke.apply(this, args);
                };
                plugin.drawGraph();
                context.stroke = stroke;
                context.strokeStyle = window.ThemePalette.get('graph-trace-secondary');
                return { stroked: [...stroked], adjust: context.strokeStyle };
            };
        });
        await frames();
        await page.evaluate(() => { document.getElementById('host').style.display = ''; });
        await frames();
        const shown = await page.evaluate(() => window.handleState());
        for (const handle of shown) {
            assert.ok(Math.abs(handle.dx) <= 1 && Math.abs(handle.dy) <= 1, JSON.stringify(handle));
            assert.equal(handle.q, 0.7);
        }

        // Drag band 3 right and up; the dB range holds during the drag.
        const range = () => page.evaluate(() => [window.plugin.dbTop, window.plugin.dbBottom]);
        const before = await range();
        await page.mouse.move(shown[2].x, shown[2].y);
        await page.mouse.down();
        for (let step = 1; step <= 5; step++) await page.mouse.move(shown[2].x + 20 * step, shown[2].y - 10 * step);
        await page.mouse.up();
        const dragged = await page.evaluate(() => window.handleState());
        const expected = await page.evaluate(({ x, y }) => {
            const { plugin } = window;
            const rect = plugin.canvas.getBoundingClientRect();
            return {
                f: 10 ** (TONAL_BALANCE_EQ_LOG_MIN + (x - rect.left) / rect.width * TONAL_BALANCE_EQ_LOG_SPAN),
                g: plugin.dbTop - (y - rect.top) / rect.height * (plugin.dbTop - plugin.dbBottom)
            };
        }, { x: shown[2].x + 100, y: shown[2].y - 50 });
        assert.deepEqual(await range(), before);
        assert.ok(Math.abs(dragged[2].f / expected.f - 1) < 0.01, `${dragged[2].f} vs ${expected.f}`);
        assert.ok(Math.abs(dragged[2].g - expected.g) < 0.1, `${dragged[2].g} vs ${expected.g}`);
        assert.ok(Math.abs(dragged[2].dx) <= 1 && Math.abs(dragged[2].dy) <= 1, JSON.stringify(dragged[2]));

        // The wheel over a handle changes its Q, typing sets a gain, a right-click turns a band off.
        await page.mouse.move(dragged[0].x, dragged[0].y);
        await page.mouse.wheel(0, -100);
        await page.fill('[id="1-room-eq-additional-eq-band-3-gain"]', '3.5');
        await page.mouse.click(dragged[4].x, dragged[4].y, { button: 'right' });
        const edited = await page.evaluate(() => window.handleState());
        assert.ok(edited[0].q > shown[0].q, `Q ${edited[0].q}`);
        assert.equal(edited[3].g, 3.5);
        assert.equal(edited[4].enabled, false);

        // With no frame the adjust curve is drawn and read out.
        const noFrame = await page.evaluate(() => {
            const { plugin } = window;
            const x = (Math.log10(plugin.fa3) - TONAL_BALANCE_EQ_LOG_MIN) / TONAL_BALANCE_EQ_LOG_SPAN * plugin.canvas.width;
            return {
                reading: plugin.reading,
                colours: window.strokedColours(),
                rows: plugin._readGraph(x).rows.map(row => [row.label, row.value])
            };
        });
        assert.equal(noFrame.reading, null);
        assert.ok(noFrame.colours.stroked.includes(noFrame.colours.adjust), JSON.stringify(noFrame.colours));
        assert.equal(noFrame.rows.length, 1);
        assert.equal(noFrame.rows[0][0], 'Target adjust');
        assert.match(noFrame.rows[0][1], /^\+\d+\.\d dB$/);

        // Dragging a handle to the top edge grows the dB range once released.
        const [top] = await range();
        const canvasTop = await page.evaluate(() => window.plugin.canvas.getBoundingClientRect().top);
        await page.mouse.move(edited[1].x, edited[1].y);
        await page.mouse.down();
        for (let step = 1; step <= 5; step++) await page.mouse.move(edited[1].x, edited[1].y + (canvasTop - 20 - edited[1].y) * step / 5);
        const duringDrag = await page.evaluate(() => [window.plugin.dbTop, window.plugin.ga1]);
        await page.mouse.up();
        const [released] = await range();
        assert.deepEqual(duringDrag, [top, top]);
        assert.ok(released > top, `${released} vs ${top}`);

        // A handle placed under the legend stays on top of it, so it can still be grabbed.
        const underLegend = await page.evaluate(() => {
            const { plugin } = window;
            const saved = { ea4: plugin.ea4, fa4: plugin.fa4, ga4: plugin.ga4 };
            const row = document.querySelector('.graph-readout-legend .graph-readout-row').getBoundingClientRect();
            const rect = plugin.canvas.getBoundingClientRect();
            const span = plugin.dbTop - plugin.dbBottom;
            plugin.setParameters({
                ea4: true,
                fa4: 10 ** (TONAL_BALANCE_EQ_LOG_MIN + ((row.left + row.right) / 2 - rect.left) / rect.width * TONAL_BALANCE_EQ_LOG_SPAN),
                ga4: plugin.dbTop - ((row.top + row.bottom) / 2 - rect.top) / rect.height * span
            });
            const refresh = () => {
                plugin._adjustEditor.syncFrom(plugin._adjustBands(), plugin._engineSampleRate());
                plugin.drawGraph();
            };
            refresh();
            const marker = document.querySelectorAll('.room-eq-additional-eq-marker')[4];
            const box = marker.getBoundingClientRect();
            const x = (box.left + box.right) / 2;
            const y = (box.top + box.bottom) / 2;
            const legend = document.querySelector('.graph-readout-legend').getBoundingClientRect();
            const result = {
                overlaps: x >= legend.left && x <= legend.right && y >= legend.top && y <= legend.bottom,
                topmost: marker.contains(document.elementFromPoint(x, y))
            };
            plugin.setParameters(saved);
            refresh();
            return result;
        });
        assert.ok(underLegend.overlaps, 'the handle sits inside the legend box');
        assert.ok(underLegend.topmost, 'the handle is the topmost element at its centre');

        // A frame with a reshaped target moves the drawn Target; Slope and Corner show only for Tilt.
        const frameResult = await page.evaluate(() => {
            const { plugin } = window;
            plugin.handleTelemetry(window.buildTonalFrame());
            // The drawn Target of band 30 against band 10.
            const step = () => plugin._readoutFrame.view.target[30] - plugin._readoutFrame.view.target[10];
            const flat = step();
            plugin.handleTelemetry(window.buildTonalFrame({ upperShift: 2 }));
            const visible = () => ['ts', 'tc'].map(key => plugin.parameterRows[key].offsetParent !== null);
            const out = { shift: step() - flat, allVisible: visible() };
            plugin.setParameters({ tg: 'Tilt' });
            out.tiltVisible = visible();
            plugin.handleTelemetry(window.buildTonalFrame({ targetIndex: 5 }));
            out.tiltDrawn = plugin.reading !== null && plugin._readoutFrame.view !== null;
            // A Tilt target summed over each band's FFT bins as the kernel does (N = 4096 at 48 kHz,
            // rectangular 1-ERB bin sets) draws as its broken line in per-hertz density: its distance
            // from 10 log10 T(centre) is the same for every band whose bins lie on one side of Corner.
            const binHz = 48000 / 4096;
            const tilt = frequency => frequency <= plugin.tc ? 1 : (frequency / plugin.tc) ** (plugin.ts / 3);
            const deviation = [];
            const mu = Array.from({ length: 41 }, (_, band) => {
                const centre = (10 ** ((band + 1) / 21.4) - 1) * 1000 / 4.37;
                const half = 12.35 * (4.37 * centre / 1000 + 1);
                const begin = Math.ceil((centre - half) / binHz);
                const end = Math.ceil((centre + half) / binHz);
                let sum = 0;
                for (let k = begin; k < end; k++) sum += tilt(k * binHz);
                if (begin * binHz > plugin.tc || (end - 1) * binHz <= plugin.tc) deviation.push([band, 10 * Math.log10(tilt(centre))]);
                return 10 * Math.log10(sum);
            });
            plugin.handleTelemetry(window.buildTonalFrame({ targetIndex: 5, mu }));
            const { target } = plugin._readoutFrame.view;
            const distances = deviation.map(([band, expected]) => target[band] - expected);
            out.tiltSpread = Math.max(...distances) - Math.min(...distances);
            out.tiltBands = distances.length;
            plugin.cleanup();
            return out;
        });
        assert.ok(Math.abs(frameResult.shift - 2) < 1e-4, `${frameResult.shift}`);
        assert.deepEqual(frameResult.allVisible, [false, false]);
        assert.deepEqual(frameResult.tiltVisible, [true, true]);
        assert.ok(frameResult.tiltDrawn);
        assert.ok(frameResult.tiltBands > 30 && frameResult.tiltSpread < 0.2, `${frameResult.tiltBands} ${frameResult.tiltSpread}`);
        await page.close();
    } finally {
        await browser.close();
    }
});
