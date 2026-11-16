// DOM of the four diagnosis result tabs. Each tab has the toolbar (Channel; Compare with on
// Diagnosis only) and the facts line, then its cards, one per row:
//   Diagnosis      the reading list ("What the measurement found"), chart E, the summary
//   Single Tones   charts T, T3, S
//   Harmonics      charts H, C
//   Level & Noise  charts A, D, B
// Every chart has Copy image; the summary has Copy summary as text. Channel, Band resolution,
// Even/Odd, Filter Length, chart S's View and Compare are shared by the four tabs; only the
// shown tab is rendered. The values come from distortion-diagnosis.js; the line charts use the
// shared renderer, the heat maps (chart C and chart S's Map view) are drawn here. Every chart
// reads its values at the pointer and from the keyboard through GraphReadout.
import i18n from '../i18n.js';
import {
    DISTORTION_FRAME,
    chartReadoutLegend,
    drawDistortionChart,
    drawLogFrequencyChart,
    emphasizeChartLegend,
    readChartAt
} from '../speaker-distortion-chart.js';
import { formatDb, hasFit } from '../speaker-distortion-figures.js';
import {
    RANGE_KEYS,
    RANGE_KINDS,
    RESOLUTIONS,
    autoRange,
    channelLabel,
    chartA,
    chartB,
    chartCCells,
    chartD,
    chartESpec,
    chartETexts,
    chartH,
    chartS,
    chartT,
    chartT3,
    compareOptions,
    defaultLength,
    factsLine,
    formatRange,
    isMatched,
    levelTicks,
    rangeBounds,
    rangeDefaults,
    rangedFrame,
    readingList,
    staticMapScale,
    summaryTable,
    summaryTsv
} from '../distortion-diagnosis.js';
import { copyTextToClipboard } from '../../../js/utils/clipboard-utils.js';
import { bindNumberInput, updateRangeFill } from '../../../js/ui/range-fill.js';
import { composeGraphImage, copyGraphImage, exportScale } from './graph-image-copy.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COPIED_MS = 5000;
const RESOLUTION_KEYS = { octave: 'analysis:diagBandOctave', third: 'analysis:diagBandThird', sixth: 'analysis:diagBandSixth' };
const LENGTH_KEYS = { short: 'analysis:diagShort', long: 'analysis:diagLong' };

const STATIC_VIEW_KEYS = { peaks: 'analysis:diagStaticPeaks', map: 'analysis:diagStaticMap' };

// Heat map layout: the frame of the shared renderer with room for the colour bar; wider labels widen a margin.
const HEAT_MARGIN = { left: 44, right: 64, top: 24, bottom: 40 };
const HEAT_X_TICKS = [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'],
    [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const HEAT_FONT = 11;
const HEAT_TEXT = 'fill: var(--sdc-text)';
const HEAT_GRID = 'stroke: var(--sdc-grid); stroke-width: 1';
const C_BAR_TICKS = [-30, -50, -70, -90];
const C_STOPS = [[-90, [0x44, 0x01, 0x54]], [-75, [0x3b, 0x52, 0x8b]], [-60, [0x21, 0x91, 0x8c]],
    [-45, [0x5e, 0xc9, 0x62]], [-30, [0xfd, 0xe7, 0x25]]];
const C_ORDERS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
// The frequency range of the heat maps and the default colour range of chart C.
const HEAT_FRAME = { xMin: 20, xMax: 10000 };
const C_RANGE = { ...HEAT_FRAME, yMin: -90, yMax: -30 };
// The level axis of each chart's display settings (RANGE_KINDS); chart S's Peaks and Map views share theirs.
const RANGE_KIND = { E: 'db', T: 'percent', T3: 'percent', H: 'percent', S: 'fine', C: 'dbr', A: 'db', D: 'db', B: 'db' };
const RESET_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true" focusable="false">'
    + '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
const S_LEVEL_TICKS = [[-100, '−100'], [-50, '−50'], [0, '0'], [50, '+50'], [100, '+100']];
const KEYBOARD_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const CSS_VARIABLE = /var\((--[\w-]+)\)/g;
// The acoustic graphs' Copy image icon (measurement.html).
const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.5 4h-5L7.5 7H4a2 2 '
    + '0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13.5" r="4"/></svg>';

const t = (key, params) => i18n.t(key, params) ?? key;
const language = () => document.documentElement.lang || 'en';

function element(tag, className = '', text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
}

function svgElement(tag, attrs, text = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    if (text !== null) node.textContent = text;
    return node;
}

// The viridis stops spread over the colour range min…max.
const cStops = (min, max) => C_STOPS.map(([v, c]) => [min + (v + 90) / 60 * (max - min), c]);

/** Viridis colour of a ratio in dBr, clamped to the colour range of `stops` (−90…−30 by default). */
export function heatColor(R, stops = C_STOPS) {
    const low = stops[0][0], high = stops[stops.length - 1][0];
    const v = R < low ? low : R > high ? high : R;
    let i = 1;
    while (i < stops.length - 1 && v > stops[i][0]) i++;
    const [v0, c0] = stops[i - 1];
    const [v1, c1] = stops[i];
    const f = (v - v0) / (v1 - v0);
    return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(', ')})`;
}

let heatCount = 0;

// The frequency frame of a heat map with the set frequencies of `override`.
const heatFrame = ({ xMin, xMax }) => rangedFrame(HEAT_FRAME,
    { ...(xMin === undefined ? {} : { xMin }), ...(xMax === undefined ? {} : { xMax }) }, 'hz');

/**
 * A heat map over `frame` (20 Hz-10 kHz by default) with a colour bar at the right, `width` x `height` px: chart C
 * and chart S's map. `map`: `frame` { xMin, xMax, xTicks? }; `extent` { xMin, xMax, yMin?, yMax? } of the cells
 * (null without one) for Auto range; `cells` [{ lo, hi, y0, y1, fill }] spanning frequencies and y units; `yMin`, `yMax`, `yTicks`
 * [[y, text]], `yTitle`; `levels` [y], the rows the keyboard steps through; `lines` [y], dashed across the
 * plot; `crisp` draws the cells without antialiased seams; `bar` { min, max, stops [[value, colour]], ticks
 * [[value, text]], unit }; `read(f, y)` returns the readout row there. Returns its plot, its rows in px and
 * its readout.
 */
function drawHeatMap(svg, map, width, height) {
    // Labels are about 0.6 em wide per character; the bar's labels start 28 px right of the plot.
    const textWidth = labels => Math.max(...labels.map(([, text]) => text.length)) * 0.6 * HEAT_FONT;
    const yLabelWidth = textWidth(map.yTicks);
    const barLabelWidth = textWidth(map.bar.ticks);
    const left = Math.max(HEAT_MARGIN.left, Math.ceil(yLabelWidth + 24));
    const right = width - Math.max(HEAT_MARGIN.right, Math.ceil(barLabelWidth + 30));
    const top = HEAT_MARGIN.top;
    const bottom = height - HEAT_MARGIN.bottom;
    const { xMin, xMax } = map.frame;
    const logSpan = Math.log10(xMax / xMin);
    const x = f => left + Math.log10(f / xMin) / logSpan * (right - left);
    const y = v => bottom - (v - map.yMin) / (map.yMax - map.yMin) * (bottom - top);
    // The cells are clipped to the plot, so a band reaching past its frequency range is cut at the border.
    const id = ++heatCount;
    const clipPath = svgElement('clipPath', { id: `diagnosisHeatClip${id}` });
    clipPath.appendChild(svgElement('rect', { x: left, y: top, width: right - left, height: bottom - top }));
    const cellGroup = svgElement('g', { 'clip-path': `url(#diagnosisHeatClip${id})` });
    if (map.crisp) cellGroup.setAttribute('shape-rendering', 'crispEdges');
    for (const cell of map.cells) {
        cellGroup.appendChild(svgElement('rect', { x: x(cell.lo), y: y(cell.y1), width: x(cell.hi) - x(cell.lo),
            height: y(cell.y0) - y(cell.y1), style: `fill: ${cell.fill}` }));
    }
    const nodes = [cellGroup];
    for (const [f, label] of map.frame.xTicks ?? HEAT_X_TICKS) {
        nodes.push(svgElement('line', { x1: x(f), y1: top, x2: x(f), y2: bottom, style: HEAT_GRID }));
        nodes.push(svgElement('text', { x: x(f), y: bottom + 14, 'font-size': HEAT_FONT, 'text-anchor': 'middle',
            style: HEAT_TEXT }, label));
    }
    for (const v of map.lines) {
        nodes.push(svgElement('line', { x1: left, y1: y(v), x2: right, y2: y(v),
            style: `${HEAT_GRID}; stroke-dasharray: 6 4` }));
    }
    for (const [v, label] of map.yTicks) {
        nodes.push(svgElement('text', { x: left - 4, y: y(v) + 4, 'font-size': HEAT_FONT, 'text-anchor': 'end',
            style: HEAT_TEXT }, label));
    }
    nodes.push(svgElement('rect', { x: left, y: top, width: right - left, height: bottom - top,
        style: 'fill: none; stroke: var(--sdc-grid); stroke-width: 1' }));
    nodes.push(svgElement('text', { x: (left + right) / 2, y: bottom + 32, 'font-size': 12, 'text-anchor': 'middle',
        style: HEAT_TEXT }, t('analysis:diagAxisFundamental')));
    nodes.push(svgElement('text', { x: 0, y: 0, 'font-size': 12, 'text-anchor': 'middle', style: HEAT_TEXT,
        transform: `translate(12 ${(top + bottom) / 2}) rotate(-90)` }, map.yTitle));

    // Colour bar: its maximum at the top, its minimum at the bottom.
    const { bar } = map;
    const barLeft = right + 12;
    const barWidth = 12;
    const barY = v => top + (bar.max - v) / (bar.max - bar.min) * (bottom - top);
    const gradient = svgElement('linearGradient', { id: `diagnosisHeatScale${id}`, x1: 0, y1: 1, x2: 0, y2: 0 });
    for (const [v, color] of bar.stops) {
        gradient.appendChild(svgElement('stop', { offset: (v - bar.min) / (bar.max - bar.min), style: `stop-color: ${color}` }));
    }
    const defs = svgElement('defs', {});
    defs.append(gradient, clipPath);
    nodes.push(defs);
    nodes.push(svgElement('rect', { x: barLeft, y: top, width: barWidth, height: bottom - top,
        style: `fill: url(#diagnosisHeatScale${id})` }));
    for (const [v, label] of bar.ticks) {
        nodes.push(svgElement('text', { x: barLeft + barWidth + 4, y: barY(v) + 4, 'font-size': HEAT_FONT,
            'text-anchor': 'start', style: HEAT_TEXT }, label));
    }
    nodes.push(svgElement('text', { x: barLeft + barWidth / 2, y: top - 8, 'font-size': HEAT_FONT, 'text-anchor': 'middle',
        style: HEAT_TEXT }, bar.unit));

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren(...nodes);
    return {
        plot: { left, top, width: right - left, height: bottom - top },
        levels: map.levels.map(y),
        extent: map.extent,
        read(px, py) {
            const f = xMin * 10 ** ((px - left) / (right - left) * logSpan);
            const v = map.yMin + (bottom - py) / (bottom - top) * (map.yMax - map.yMin);
            return { cursor: window.GraphReadout.format.frequency(f), rows: [map.read(f, v)] };
        }
    };
}

// The extent { xMin, xMax, yMin, yMax } of `cells` [{ lo, hi }] and their `value(cell)`s, null without cells.
function cellExtent(cells, value) {
    if (!cells.length) return null;
    const extent = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
    for (const cell of cells) {
        const v = value(cell);
        if (cell.lo < extent.xMin) extent.xMin = cell.lo;
        if (cell.hi > extent.xMax) extent.xMax = cell.hi;
        if (v < extent.yMin) extent.yMin = v;
        if (v > extent.yMax) extent.yMax = v;
    }
    return extent;
}

/**
 * Chart C as a heat map: one row per order 2 to 10, a cell per rule band; the readout gives the ratio in dBr.
 * The set display values `override` choose the frequencies and the colour range (yMin…yMax).
 */
function chartCMap(cells, override) {
    const { yMin, yMax } = { ...C_RANGE, ...override };
    const stops = cStops(yMin, yMax);
    const set = override.yMin !== undefined || override.yMax !== undefined;
    return {
        frame: heatFrame(override),
        extent: cellExtent(cells, cell => cell.R),
        cells: cells.map(cell => ({ lo: cell.lo, hi: cell.hi, y0: cell.order - 0.5, y1: cell.order + 0.5,
            fill: heatColor(cell.R, stops) })),
        yMin: 1.5,
        yMax: 10.5,
        yTicks: C_ORDERS.map(order => [order, String(order)]),
        yTitle: t('analysis:diagAxisOrder'),
        levels: C_ORDERS,
        lines: [],
        crisp: false,
        bar: { min: yMin, max: yMax, stops: stops.map(([v, c]) => [v, `rgb(${c.join(', ')})`]),
            ticks: set ? levelTicks(yMin, yMax) : C_BAR_TICKS.map(v => [v, String(v).replace('-', '−')]), unit: 'dBr' },
        // The cell under the cursor: its order and its ratio, a dash where no cell is shown.
        read(f, y) {
            const row = Math.round(y);
            const order = row > 10 ? 10 : row;
            const cell = cells.find(item => item.order === order && f >= item.lo && f < item.hi);
            return {
                label: `${t('analysis:diagAxisOrder')} ${order}`,
                color: cell ? heatColor(cell.R, stops) : 'transparent',
                value: cell ? `${window.GraphReadout.format.number(cell.R, 1)} dBr` : '—'
            };
        }
    };
}

/**
 * Chart S's map: a row per instantaneous level, each cell spanning halfway to its neighbours, so the edge rows
 * are half high and equal the peaks. The gain fades from the plot's background at 0 dB to --sdc-squash at
 * −range and to --sdc-stretch at +range with the share (|gain|/range)^0.5, which magnifies small gains; the
 * colour bar follows the same curve. A column inside the noise band has no cells. The set display values
 * `override` choose the frequencies and the gain range (staticMapScale).
 */
function staticMap({ levels, columns, scale: autoScale }, override) {
    const scale = staticMapScale(autoScale, override);
    const percents = levels.map(level => Math.round(100 * level));
    const half = (percents[1] - percents[0]) / 2;
    const fill = gain => {
        const share = Math.sqrt((gain < 0 ? -gain : gain) / scale.range);
        const percent = share > 1 ? 100 : Math.round(share * 1000) / 10;
        return `color-mix(in srgb, var(${gain < 0 ? '--sdc-squash' : '--sdc-stretch'}) ${percent}%, var(--sdc-bg))`;
    };
    // Bar stops every range/8, so the gradient traces the square-root share.
    const stops = Array.from({ length: 17 }, (_, i) => {
        const value = (i - 8) * scale.range / 8;
        return [value, fill(value)];
    });
    const cells = columns.flatMap(({ lo, hi, gains }) => (gains ?? []).flatMap((gain, i) => (gain === null ? [] : [{
        lo, hi, y0: i > 0 ? percents[i] - half : percents[i], y1: i < percents.length - 1 ? percents[i] + half : percents[i],
        fill: fill(gain) }])));
    const shown = columns.filter(column => column.gains);
    return {
        frame: heatFrame(override),
        extent: cellExtent(shown, () => 0),
        cells,
        yMin: percents[0],
        yMax: percents[percents.length - 1],
        yTicks: S_LEVEL_TICKS,
        yTitle: t('analysis:diagAxisInstantLevel'),
        levels: percents,
        lines: [0],
        crisp: true,
        bar: { min: -scale.range, max: scale.range, stops, ticks: scale.barTicks, unit: 'dB' },
        // The nearest level under the cursor and its gain; the noise floor or a dash where the column has none.
        read(f, y) {
            const step = Math.round((y - percents[0]) / (2 * half));
            const i = step < 0 ? 0 : step > percents.length - 1 ? percents.length - 1 : step;
            const percent = percents[i];
            const column = columns.find(item => f >= item.lo && f < item.hi);
            const gain = column?.gains?.[i] ?? null;
            return {
                label: `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${percent < 0 ? -percent : percent} %`,
                color: gain === null ? 'transparent' : fill(gain),
                value: !column ? '—' : column.gains ? formatDb(gain, '—', scale.readDecimals)
                    : t('analysis:diagLegendNoiseFloor')
            };
        }
    };
}

// Readout of a chart drawn by the shared renderer.
const readable = chart => ({ chart, plot: chart.plot, extent: chart.extent, read: x => readChartAt(chart, x) });

/**
 * The chart as shown, `width` x `height` CSS px, rasterised at `dpr` for Copy image. Its colours and font
 * are resolved from the page first: the image of an SVG sees neither the page's styles nor its fonts.
 */
async function rasterizeChart(svg, width, height, dpr) {
    const style = getComputedStyle(svg);
    const copy = svg.cloneNode(true);
    copy.removeAttribute('style');
    for (const [name, value] of [['xmlns', SVG_NS], ['width', width], ['height', height], ['font-family', style.fontFamily]]) {
        copy.setAttribute(name, value);
    }
    const markup = new XMLSerializer().serializeToString(copy)
        .replace(CSS_VARIABLE, (_, name) => style.getPropertyValue(name).trim());
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

export default class DistortionDiagnosisView {
    /**
     * `panels` maps each diagnosis tab id to its panel. `listMeasurements()` returns the
     * measurements saved on this device, `loadMeasurement(id)` one of them (or null),
     * `onExcludeRattle(hz)` hands a new Upper Limit to the measurement screen's refit and
     * `onSelectTab(tab)` selects another result tab.
     */
    constructor(panels, { listMeasurements, loadMeasurement, onExcludeRattle, onSelectTab }) {
        this.panels = panels;
        this.listMeasurements = listMeasurements;
        this.loadMeasurement = loadMeasurement;
        this.onExcludeRattle = onExcludeRattle;
        this.onSelectTab = onSelectTab;
        this.measurement = null;
        this.tab = null;
        this.channel = null;
        this.resolution = 'third';
        this.parity = 'even';
        this.staticView = 'peaks';
        this.length = null;
        this.compare = null;
        this.compareFailed = false;
        this.compareRequest = 0;
        this.copyTimer = null;
        // Display settings per chart key, kept for the window: the set values only, and whether each is open.
        this.ranges = {};
        this.displayOpen = {};
        this.charts = new Map();
        // The stylesheet sizes each chart like the acoustic graphs; a redraw fills the new size.
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) this.drawChart(entry.target, entry.contentRect.width, entry.contentRect.height);
        });
    }

    /** Shows `measurement` (or nothing) on diagnosis tab `tab`; Compare resets when the measurement changes. */
    show(measurement, tab) {
        // An unsaved measurement has no id; it is the same measurement only as the same record object.
        if ((measurement?.id ?? measurement) !== (this.measurement?.id ?? this.measurement)) {
            this.compare = null;
            this.compareFailed = false;
            this.compareRequest++;
            this.length = null;
        }
        this.measurement = measurement;
        this.tab = tab;
        this.render();
    }

    /** Selects the channel shown on all four tabs; the next render shows it. */
    selectChannel(index) {
        this.channel = index;
        this.length = null;
        // An unsaved measurement has no id, so the index check must come first to rule out "no Compare".
        if (this.compare?.index === index && this.compare.id === this.measurement?.id) this.compare = null;
    }

    /** Renders the shown tab only; the other panels are emptied, so nothing is drawn while hidden. */
    render() {
        this.resizeObserver.disconnect();
        this.charts.clear();
        clearTimeout(this.copyTimer);
        for (const panel of Object.values(this.panels)) panel.replaceChildren();
        const model = this.measurement?.speakerModel;
        const panel = this.panels[this.tab];
        if (!model || !panel) return;
        let entry = model.channels.find(channel => channel.index === this.channel);
        if (!entry) {
            entry = model.channels[0];
            this.channel = entry.index;
            this.length = null;
        }
        if (this.length === null || !hasFit(entry, this.length)) this.length = defaultLength(model, entry);
        const main = this.tab === 'diagnosis';
        const compared = main ? this.comparedChannel() : null;

        const nodes = [];
        const toolbar = this.toolbar(model, entry, main);
        if (toolbar.firstChild) nodes.push(toolbar);
        const header = !main ? null : this.compareFailed ? t('analysis:diagCompareLoadFailed')
            : compared ? t(isMatched(model, entry, compared.model, compared.entry)
                ? 'analysis:diagMatched' : 'analysis:diagNotMatched') : null;
        if (header) nodes.push(element('p', 'explanation-text diagnosis-compare-header', header));
        nodes.push(element('p', 'explanation-text diagnosis-facts', factsLine(model, entry, this.length, t, language())));

        // The subtitle of a copied image: the measurement, the channel and the chart's own settings.
        const subtitle = (...settings) => [this.measurement.name, channelLabel(entry), ...settings].filter(Boolean).join(' · ');
        const cards = this.tabCards(model, entry, compared, subtitle);
        if (cards.length) {
            const column = element('div', 'diagnosis-cards');
            column.append(...cards);
            nodes.push(column);
        }
        if (this.charts.size) nodes.push(element('p', 'explanation-text', t('analysis:readoutHelp')));
        if (!entry.diagnosis) nodes.push(element('p', 'empty-state', t('analysis:diagChannelFailed')));
        panel.replaceChildren(...nodes);
        for (const svg of this.charts.keys()) {
            this.drawChart(svg, svg.clientWidth, svg.clientHeight);
            this.resizeObserver.observe(svg);
        }
    }

    /** The cards of the shown tab; a channel without a diagnosis block keeps only chart E. */
    tabCards(model, entry, compared, subtitle) {
        if (this.tab === 'diagnosis') {
            const chartE = this.chartECard(model, entry, compared, subtitle);
            return entry.diagnosis
                ? [this.readingCard(model, entry), chartE, this.summaryCard(model, entry, compared)] : [chartE];
        }
        if (!entry.diagnosis) return [];
        // A chart drawn by the shared renderer, with the `control` { segment, setting } of its settings if any.
        const range = key => this.ranges[key] ?? {};
        const logChart = (key, { frame, items, note, warning }, control = null) => this.chartCard(key,
            (width, height) => readable(drawLogFrequencyChart(this.svgOf(key),
                { ...rangedFrame(frame, range(key), RANGE_KIND[key]), width, height }, items)),
            { note, warning, controls: control && this.chartControls(control.segment), subtitle: subtitle(control?.setting),
                range: rangeDefaults(frame, RANGE_KIND[key]) });
        // `map(override)` builds the heat map with the chart's set display values.
        const heatChart = (key, map, defaults, options) => this.chartCard(key,
            (width, height) => drawHeatMap(this.svgOf(key), map(range(key)), width, height),
            { ...options, crosshair: 'xy', range: defaults });
        // A chart in bands has the Band resolution control.
        const banded = () => ({ segment: this.resolutionSegment(), setting: t(RESOLUTION_KEYS[this.resolution]) });
        if (this.tab === 'diagnosisTones') {
            const spec = chartS(model, entry, t);
            const view = { segment: this.staticViewSegment(), setting: t(STATIC_VIEW_KEYS[this.staticView]) };
            const staticCard = this.staticView === 'peaks' ? logChart('S', spec, view)
                : heatChart('S', override => staticMap(spec.map, override), rangeDefaults(spec.frame, 'fine'),
                    { controls: this.chartControls(view.segment),
                    note: spec.items.find(item => item.kind === 'note')?.text ?? null,
                    caption: 'analysis:diagCaptionSMap', subtitle: subtitle(view.setting) });
            return [logChart('T', chartT(model, entry, t)), logChart('T3', chartT3(model, entry, t)), staticCard];
        }
        if (this.tab === 'diagnosisHarmonics') {
            const cells = chartCCells(model, entry);
            return [logChart('H', chartH(model, entry, this.resolution, t), banded()),
                heatChart('C', override => chartCMap(cells, override), C_RANGE, { subtitle: subtitle() })];
        }
        return [logChart('A', chartA(model, entry, t)), logChart('D', chartD(model, entry, t)),
            logChart('B', chartB(model, entry, this.resolution, t), banded())];
    }

    // ------------------------------------------------------------ toolbar

    /** Channel on every tab (with more than one channel); Compare with on the Diagnosis tab (`main`). */
    toolbar(model, entry, main) {
        const bar = element('div', 'diagnosis-toolbar');
        if (model.channels.length > 1) {
            bar.append(this.selectRow('analysis:diagChannel',
                model.channels.map(channel => ({ value: String(channel.index), text: channelLabel(channel) })),
                String(entry.index), value => {
                    this.selectChannel(Number(value));
                    this.render();
                }));
        }
        if (!main) return bar;
        const options = compareOptions(this.measurement, entry.index, this.listMeasurements(), t, language());
        const selected = options.findIndex(option => option.id === this.compare?.id && option.index === this.compare?.index);
        bar.append(this.selectRow('label:diagCompareWith',
            [{ value: '', text: t('analysis:diagCompareNone') },
                ...options.map((option, i) => ({ value: String(i), text: option.label }))],
            selected < 0 ? '' : String(selected),
            value => this.selectCompare(value === '' ? null : options[Number(value)])));
        return bar;
    }

    selectRow(labelKey, items, value, onChange) {
        const row = element('label', 'parameter-row diagnosis-control');
        const select = element('select');
        for (const item of items) {
            const option = element('option', '', item.text);
            option.value = item.value;
            select.append(option);
        }
        select.value = value;
        select.addEventListener('change', () => onChange(select.value));
        row.append(element('span', 'parameter-label-text', t(labelKey)), select);
        return row;
    }

    /** The control row above a chart. */
    chartControls(...segments) {
        const controls = element('div', 'diagnosis-chart-controls');
        controls.append(...segments);
        return controls;
    }

    /** Band resolution of charts E, H and B, one setting for all three. */
    resolutionSegment() {
        const label = t('label:diagBandResolution');
        return this.segment(label, RESOLUTIONS.map(value => ({ value, text: t(RESOLUTION_KEYS[value]) })),
            this.resolution, value => {
                this.resolution = value;
                this.render();
            }, label);
    }

    /** Chart S as the peak gains (Peaks) or as the gain at every instantaneous level (Map). */
    staticViewSegment() {
        return this.segment(t('label:diagStaticView'),
            Object.entries(STATIC_VIEW_KEYS).map(([value, key]) => ({ value, text: t(key) })),
            this.staticView, value => {
                this.staticView = value;
                this.render();
            });
    }

    segment(label, items, value, onSelect, title = '') {
        const group = element('div', 'diagnosis-segment');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        if (title) group.title = title;
        for (const item of items) {
            const button = element('button', '', item.text);
            button.type = 'button';
            button.disabled = Boolean(item.disabled);
            button.setAttribute('aria-pressed', String(item.value === value));
            button.addEventListener('click', () => {
                if (item.value !== value) onSelect(item.value);
            });
            group.append(button);
        }
        return group;
    }

    // ------------------------------------------------------------ compare

    /** The compared channel { label, model, entry }; channels of the shown measurement use its current data. */
    comparedChannel() {
        if (!this.compare) return null;
        if (this.compare.id !== this.measurement.id) return this.compare;
        const entry = this.measurement.speakerModel.channels.find(channel => channel.index === this.compare.index);
        return entry?.diagnosis ? { ...this.compare, model: this.measurement.speakerModel, entry } : null;
    }

    async selectCompare(option) {
        const request = ++this.compareRequest;
        this.compare = null;
        this.compareFailed = false;
        if (option) {
            try {
                const record = option.id === this.measurement.id ? this.measurement : await this.loadMeasurement(option.id);
                const entry = record?.speakerModel?.channels.find(channel => channel.index === option.index);
                if (!entry?.diagnosis) throw new Error(`Channel ${option.index} of measurement ${option.id} has no diagnosis data.`);
                if (request !== this.compareRequest) return;
                this.compare = { ...option, model: record.speakerModel, entry };
            } catch (error) {
                if (request !== this.compareRequest) return;
                console.error('Distortion Diagnosis: the measurement to compare with could not be loaded.', error);
                this.compareFailed = true;
            }
        }
        this.render();
    }

    // ------------------------------------------------------------ cards

    svgOf(key) {
        for (const [svg, chart] of this.charts) if (chart.key === key) return svg;
        return null;
    }

    drawChart(svg, width, height) {
        const chart = this.charts.get(svg);
        const size = { width: Math.round(width), height: Math.round(height) };
        if (!chart || !(size.width > 0 && size.height > 0)
            || (size.width === chart.width && size.height === chart.height)) return;
        Object.assign(chart, size);
        chart.drawn = chart.draw(size.width, size.height);
        // Auto range follows what is drawn, so it has nothing to fit without data.
        if (chart.auto) chart.auto.disabled = !chart.drawn.extent;
        // The readout legend starts at the plot's top, below a note that wraps above it.
        svg.parentElement.style.setProperty('--graph-readout-inset-top', `${chart.drawn.plot.top}px`);
        // A keyboard reading of the previous drawing no longer matches the cursor.
        chart.output.textContent = '';
        // Rebuilding the legend drops its hover targets, so it is rebuilt only when its entries change.
        const legend = chart.drawn.chart ? chartReadoutLegend(chart.drawn.chart) : [];
        const legendKey = JSON.stringify(legend);
        if (legendKey !== chart.legendKey) {
            chart.hovered = null;
            chart.readout?.setLegend(legend);
            chart.legendKey = legendKey;
        }
        // The redraw replaced the lines, so a hovered legend entry is emphasized again.
        chart.restore = emphasizeChartLegend(svg, chart.drawn.chart, chart.hovered);
        chart.readout?.refresh();
    }

    /** A hovered legend entry draws its lines thick and on top and hides the readout until the pointer leaves. */
    hoverLegend(svg, index) {
        const chart = this.charts.get(svg);
        const text = index === null ? null : chart?.drawn?.chart?.legend[index]?.text ?? null;
        if (!chart || text === chart.hovered) return;
        chart.restore?.();
        chart.hovered = text;
        chart.readout?.clear();
        chart.restore = emphasizeChartLegend(svg, chart.drawn.chart, text);
    }

    read(svg, x, y) {
        const chart = this.charts.get(svg);
        return chart?.drawn && chart.hovered === null ? chart.drawn.read(x, y) : null;
    }

    /** Arrow keys, Home and End move a keyboard cursor; a heat map's Up and Down step through its rows. */
    readByKeyboard(svg, event) {
        const chart = this.charts.get(svg);
        if (event.shiftKey || !KEYBOARD_KEYS.includes(event.key) || !chart?.drawn) return;
        event.preventDefault();
        const cursor = chart.keyboard;
        const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
        const clamp = value => (value < 0 ? 0 : value > 1 ? 1 : value);
        const { plot, levels } = chart.drawn;
        if (levels && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            cursor.level = clamp(cursor.level + direction / (levels.length - 1));
        } else {
            cursor.x = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : clamp(cursor.x + direction * 0.01);
        }
        const x = plot.left + plot.width * cursor.x;
        // A heat map is read at the middle of a row (from the bottom), the line charts at mid-height.
        const y = levels ? levels[Math.round(cursor.level * (levels.length - 1))] : plot.top + plot.height / 2;
        const point = window.GraphReadout?.fromSurface(svg, x, y);
        if (point) {
            svg.parentElement.dispatchEvent(new PointerEvent('pointermove', {
                clientX: point.x, clientY: point.y, pointerType: 'mouse', bubbles: true
            }));
        }
        const value = this.read(svg, x, y);
        chart.output.textContent = value
            ? `${value.cursor}: ${value.rows.map(item => `${item.label} ${item.value}`).join('; ')}` : '';
    }

    card(titleKey) {
        const card = element('section', 'diagnosis-card');
        const header = element('div', 'analysis-graph-header');
        header.append(element('h3', '', t(titleKey)));
        card.append(header);
        return card;
    }

    /**
     * A chart's card; `caption` replaces the chart's own caption key, a heat map sets `crosshair` 'xy'. `range`
     * holds the chart's default display values { xMin, xMax, yMin, yMax } for its display settings.
     */
    chartCard(key, draw, { controls = null, note = null, warning = false, subtitle = '', caption = null,
        crosshair = 'x', range } = {}) {
        const card = this.card(`analysis:diagTitle${key}`);
        card.dataset.chart = key;
        const actions = element('div', 'analysis-graph-actions');
        const copy = element('button', 'secondary-btn graph-copy-button');
        copy.type = 'button';
        copy.title = t('analysis:copyGraph');
        copy.innerHTML = COPY_ICON;
        copy.append(element('span', 'graph-copy-label', t('analysis:copyGraph')));
        const display = this.displaySettings(key, range);
        actions.append(display.auto, display.reset, copy);
        card.firstChild.append(actions);
        const status = element('p', 'analysis-image-status');
        status.setAttribute('role', 'status');
        card.append(status);
        if (controls) card.append(controls);
        const mount = element('div', 'diagnosis-chart-mount');
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'diagnosis-chart');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', t(`analysis:diagTitle${key}`));
        svg.setAttribute('tabindex', '0');
        svg.addEventListener('keydown', event => this.readByKeyboard(svg, event));
        mount.append(svg);
        const output = element('output', 'analysis-keyboard-readout');
        output.setAttribute('aria-live', 'polite');
        card.append(mount, output, display.details);
        if (note) card.append(element('p', `explanation-text${warning ? ' diagnosis-note-warning' : ''}`, note));
        card.append(element('p', 'explanation-text', t(caption ?? `analysis:diagCaption${key}`)));
        const readout = window.GraphReadout?.attach({
            mount,
            surface: svg,
            plot: () => this.charts.get(svg)?.drawn?.plot,
            read: (x, y) => this.read(svg, x, y),
            crosshair,
            onLegendHover: index => this.hoverLegend(svg, index)
        });
        this.charts.set(svg, {
            key, draw, width: 0, height: 0, drawn: null, readout, output, auto: display.auto,
            legendKey: '[]', hovered: null, restore: null, keyboard: { x: 0.5, level: 0.5 }
        });
        copy.addEventListener('click', () => this.copyChart(svg, subtitle, copy, status));
        return card;
    }

    /**
     * Display settings of chart `key`, as on the acoustic graphs: Auto range and Reset for the header and the
     * closed-by-default details below the chart with Frequency from/to and Level from/to, each a slider and a
     * number input. A change stores the set value (this.ranges) and redraws this chart only.
     */
    displaySettings(key, defaults) {
        const kind = RANGE_KIND[key];
        const current = () => ({ ...defaults, ...this.ranges[key] });
        const inputs = {};
        const sync = () => {
            const range = current();
            for (const name of RANGE_KEYS) {
                const { input, slider, toSlider } = inputs[name];
                input.applied.value = range[name];
                // The value being typed stays as typed.
                if (document.activeElement !== input) input.value = formatRange(input.kind, range[name]);
                slider.value = toSlider(range[name]);
                updateRangeFill(slider);
            }
        };
        const redraw = () => {
            sync();
            const svg = this.svgOf(key);
            const chart = this.charts.get(svg);
            if (!chart) return;
            const { width, height } = chart;
            chart.width = 0;
            this.drawChart(svg, width, height);
        };
        const set = (name, value) => {
            const [min, max] = rangeBounds(kind, current(), name);
            this.ranges[key] = { ...this.ranges[key], [name]: value < min ? min : value > max ? max : value };
            redraw();
        };

        const button = (className, title, content) => {
            const node = element('button', `secondary-btn ${className}`);
            node.type = 'button';
            node.title = title;
            if (!content) node.textContent = title;
            else {
                node.innerHTML = content;
                node.append(element('span', 'analysis-action-label', title));
            }
            return node;
        };
        const auto = button('analysis-auto-button', t('analysis:auto'));
        auto.addEventListener('click', () => {
            const extent = this.charts.get(this.svgOf(key))?.drawn?.extent;
            if (!extent) return;
            this.ranges[key] = autoRange(kind, extent);
            redraw();
        });
        const reset = button('analysis-reset-button', t('analysis:reset'), RESET_ICON);
        reset.addEventListener('click', () => {
            delete this.ranges[key];
            redraw();
        });

        const details = element('details', 'analysis-settings');
        details.open = Boolean(this.displayOpen[key]);
        details.addEventListener('toggle', () => { this.displayOpen[key] = details.open; });
        const grid = element('div', 'analysis-settings-grid plugin-parameter-ui');
        details.append(element('summary', '', t('analysis:display')), grid);
        for (const name of RANGE_KEYS) {
            const rowKind = name.startsWith('x') ? 'hz' : kind;
            const { min, max, unit, log, resolution } = RANGE_KINDS[rowKind];
            const toSlider = log ? v => 100 * Math.log(v / min) / Math.log(max / min) : v => v;
            const fromSlider = log ? p => min * (max / min) ** (p / 100) : p => p;
            const format = v => formatRange(rowKind, v);
            const row = element('div', 'parameter-row');
            const id = `diagnosis-${key}-${name}`;
            const label = element('label');
            label.id = `${id}-label`;
            label.htmlFor = `${id}-slider`;
            const text = element('span', 'parameter-label-text');
            text.append(element('span', '', t(`analysis:${name}`)), element('span', 'parameter-unit', ` (${unit})`),
                element('span', 'parameter-colon', ':'));
            label.append(text);
            label.title = label.textContent;
            const slider = element('input');
            slider.type = 'range';
            slider.id = `${id}-slider`;
            slider.min = log ? 0 : min;
            slider.max = log ? 100 : max;
            slider.step = 'any';
            const input = element('input');
            input.type = 'number';
            input.id = id;
            input.min = min;
            input.max = max;
            input.step = 'any';
            input.kind = rowKind;
            input.setAttribute('aria-labelledby', label.id);
            input.applied = bindNumberInput(input, slider, min, max, current()[name], value => set(name, value),
                toSlider, format, () => rangeBounds(kind, current(), name));
            slider.addEventListener('input', () => {
                const value = Number(format(fromSlider(Number(slider.value))));
                input.value = String(value);
                set(name, value);
            });
            slider.addEventListener('keydown', event => {
                if (!KEYBOARD_KEYS.includes(event.key)) return;
                event.preventDefault();
                const [low, high] = rangeBounds(kind, current(), name);
                const value = current()[name];
                const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
                let next = log ? Number(format(fromSlider(toSlider(value) + direction))) : value + direction * 10 * resolution(value);
                // A rounded log increment must still reach the next representable value.
                if (next === value) next += direction * resolution(value);
                if (event.key === 'Home') next = low;
                if (event.key === 'End') next = high;
                set(name, Number(format(next)));
            });
            row.append(label, slider, input);
            grid.append(row);
            inputs[name] = { input, slider, toSlider };
        }
        sync();
        return { auto, reset, details };
    }

    /** Copy image, as on the acoustic graphs: the chart as shown, under its title, subtitle and legend. */
    async copyChart(svg, subtitle, button, status) {
        const chart = this.charts.get(svg);
        if (!chart?.drawn) return;
        button.disabled = true;
        status.textContent = '';
        const { width, height } = chart;
        const dpr = exportScale(width, height);
        const style = getComputedStyle(svg);
        const resolve = value => value.replace(CSS_VARIABLE, (_, name) => style.getPropertyValue(name).trim());
        const legend = (chart.drawn.chart?.legend ?? []).map(entry => (entry.square
            ? { text: entry.text, color: resolve(entry.style.fill), opacity: entry.style['fill-opacity'], fill: true }
            : { text: entry.text, color: resolve(entry.style.stroke),
                dash: entry.style['stroke-dasharray']?.split(' ').map(Number) ?? [] }));
        // The image is handed over while the click is still being handled; the clipboard waits for it.
        const image = rasterizeChart(svg, width, height, dpr).then(graph => composeGraphImage(graph,
            { width, height, dpr, title: t(`analysis:diagTitle${chart.key}`), subtitle, legend }));
        try {
            await copyGraphImage(image);
            status.textContent = t('analysis:imageCopied');
        } catch (error) {
            console.error('Graph image copy failed:', error);
            status.textContent = t(error.code === 'unsupported' ? 'analysis:imageCopyUnavailable'
                : error.code === 'denied' ? 'analysis:imageCopyDenied' : 'analysis:imageCopyFailed');
        } finally {
            button.disabled = false;
        }
    }

    chartECard(model, entry, compared, subtitle) {
        const controls = this.chartControls(this.segment(t('analysis:diagAxis'), [
            { value: 'even', text: t('analysis:diagEven') },
            { value: 'odd', text: t('analysis:diagOdd') }
        ], this.parity, value => {
            this.parity = value;
            this.render();
        }), this.resolutionSegment());
        const fitted = hasFit(entry, 'short') || hasFit(entry, 'long');
        if (fitted) {
            controls.append(this.segment(t('analysis:diagFilterLength'), ['short', 'long'].map(value => ({
                value,
                text: value === model.recommendedLength
                    ? t('analysis:diagRecommended', { length: t(LENGTH_KEYS[value]) }) : t(LENGTH_KEYS[value]),
                disabled: !hasFit(entry, value)
            })), this.length, value => {
                this.length = value;
                this.render();
            }, t('analysis:diagLengthTooltip')));
        }
        const spec = chartESpec(model, entry, { length: this.length, parity: this.parity, resolution: this.resolution });
        const texts = chartETexts(t, compared?.label ?? null);
        const compare = compared ? { channel: compared.entry, length: this.length } : null;
        return this.chartCard('E',
            (width, height) => readable(drawDistortionChart(this.svgOf('E'), { ...spec, width, height, texts, compare,
                frame: rangedFrame(DISTORTION_FRAME, this.ranges.E ?? {}, RANGE_KIND.E) })),
            { controls, note: fitted ? null : t('analysis:diagNoFit'), range: rangeDefaults(DISTORTION_FRAME, RANGE_KIND.E),
                subtitle: subtitle(
                fitted ? `${t('analysis:diagFilterLength')}: ${t(LENGTH_KEYS[this.length])}` : null,
                t(this.parity === 'even' ? 'analysis:diagEven' : 'analysis:diagOdd'), t(RESOLUTION_KEYS[this.resolution])) });
    }

    summaryCard(model, entry, compared) {
        const table = summaryTable(model, entry, this.length, t,
            compared ? { model: compared.model, entry: compared.entry } : null);
        const card = this.card('analysis:diagTitleSum');
        card.classList.add('diagnosis-summary');
        const actions = element('div', 'analysis-graph-actions');
        const copy = element('button', 'secondary-btn diagnosis-copy', t('button:diagCopySummary'));
        copy.type = 'button';
        actions.append(copy);
        card.firstChild.append(actions);
        const status = element('p', 'analysis-image-status');
        status.setAttribute('role', 'status');
        copy.addEventListener('click', async () => {
            const text = summaryTsv(model, entry, table, t,
                { name: this.measurement.name, language: language(), comparedName: compared?.label ?? null });
            const copied = await copyTextToClipboard(text);
            clearTimeout(this.copyTimer);
            status.textContent = t(copied ? 'analysis:diagCopied' : 'analysis:diagCopyFailed');
            if (copied) this.copyTimer = setTimeout(() => { status.textContent = ''; }, COPIED_MS);
            else console.error('Distortion Diagnosis: the summary could not be written to the clipboard.');
        });
        card.append(status, this.summaryTableElement(table));
        for (const line of table.lines) card.append(element('p', 'explanation-text', line));
        return card;
    }

    summaryTableElement(table) {
        const tableElement = element('table', 'diagnosis-table');
        const headRow = element('tr');
        for (const head of table.heads) {
            const cell = element('th', '', head);
            cell.setAttribute('scope', 'col');
            headRow.append(cell);
        }
        const thead = element('thead');
        thead.append(headRow);
        const tbody = element('tbody');
        for (const row of table.rows) {
            const tr = element('tr');
            const name = element('th', '', row.name);
            name.setAttribute('scope', 'row');
            tr.append(name);
            row.cells.forEach((cell, i) => {
                const td = element('td');
                td.dataset.label = table.heads[i + 1];
                td.append(element('span', '', cell.text));
                if (cell.compared) td.append(element('span', `diagnosis-compare ${cell.compared.cls}`, cell.compared.text));
                tr.append(td);
            });
            const change = element('td', '', row.change.text);
            change.dataset.label = table.heads[4];
            const kind = element('td', '', row.kind);
            kind.dataset.label = table.heads[5];
            tr.append(change, kind);
            tbody.append(tr);
        }
        tableElement.append(thead, tbody);
        return tableElement;
    }

    readingCard(model, entry) {
        const card = this.card('analysis:diagReadingTitle');
        card.classList.add('diagnosis-reading');
        card.append(element('p', 'explanation-text', t('analysis:diagReadingNote')));
        const list = element('ul', 'diagnosis-reading-list');
        for (const item of readingList(model, entry, t)) {
            const li = element('li');
            const heading = element('p', 'diagnosis-reading-obs');
            heading.append(element('strong', '', item.obs));
            if (item.tag) {
                heading.append(' ', element('span', `speaker-distortion-tag ${item.tag}`,
                    t(item.tag === 'on' ? 'analysis:diagTagCorrectable' : 'analysis:diagTagNotCorrectable')));
            }
            li.append(heading);
            if (item.text) li.append(element('p', 'explanation-text', item.text));
            if (item.muted) li.append(element('p', 'explanation-text', item.muted));
            // The finding's buttons share one wrapping row; the evidence button is marked as a move to another tab.
            const actions = element('div', 'diagnosis-reading-actions');
            const action = (className, text, onClick) => {
                const button = element('button', className, text);
                button.type = 'button';
                button.addEventListener('click', onClick);
                actions.append(button);
            };
            if (item.button) action('secondary-btn', item.button.text, () => this.onExcludeRattle(item.button.hz));
            if (item.tab) {
                action('secondary-btn diagnosis-goto', t('button:diagShowEvidence', { tab: t(`analysis:${item.tab}`) }),
                    () => this.onSelectTab(item.tab));
            }
            if (actions.firstChild) li.append(actions);
            list.append(li);
        }
        card.append(list);
        return card;
    }
}
