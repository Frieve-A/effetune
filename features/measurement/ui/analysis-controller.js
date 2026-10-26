import dataStorage from '../dataStorage.js';
import i18n from '../i18n.js';
import audioUtils from '../audio-utils/index.js';
import { channelDisplayLabel } from '../audio-utils/channel-selection.js';
import { CHANNEL_COLORS, channelColor } from '../channel-colors.js';
import { resolveAnalysisRecord, getAnalysisCapabilities, getValidHarmonicAnalysis, resolveDisplayedResponse,
    resolveDisplayedChannelCurves, resolveResponseSweepBand, aggregateLevelWarnings } from '../measurement-model.js';
import { responseReferenceDb } from '../response-normalization.js';
import { findImpulsePeak, getImpulseTimeBounds, clampImpulseView } from './impulse-response-plot.js';
import { AnalysisPlot, distortionValue } from './analysis-plot.js';
import { copyGraphImage } from './graph-image-copy.js';
import { WATERFALL_VIEW_DEFAULTS } from './waterfall-surface.js';
import { bindNumberInput, updateRangeFill } from '../../../js/ui/range-fill.js';
import { MAX_ANALYSIS_WINDOW_SAMPLES, BURST_TAU_CYCLES, BURST_FREQUENCY_COUNT, BURST_MINIMUM_SLICES,
    analysisFrequencyLimit } from '../../../js/utils/measurement-dsp/analysis.js';

export const ANALYSIS_DEFAULTS = {
    frequency: { xMin: 20, xMax: 20000, yMin: -24, yMax: 24, smoothing: 0.3,
        normalize: true, reference: 0, source: 'saved', before: 2, after: 100, window: 'tukey' },
    impulse: { xMin: -2, xMax: 30, yMin: -1.05, yMax: 1.05, normalize: true,
        db: false, origin: 0, before: 2, after: 100, window: 'tukey' },
    distortion: { xMin: 20, xMax: 20000, yMin: 0, yMax: 10, unit: '%',
        h2: true, h3: true, h4: true, h5: true, h6: true, h7: true, h8: true, h9: true, h10: true,
        thd: true, harmonicLimit: 3, maxOrder: 3, before: 2, after: 20, window: 'tukey' },
    waterfall: { xMin: 20, xMax: 20000, yMin: -60, yMax: 0, start: 0, end: 300,
        length: 100, rise: 5, window: 'tukey', smoothing: 0.1, mode: 'waterfall', normalization: 'none',
        depthUnit: 'cycles', startCycles: 0, endCycles: 30, ...WATERFALL_VIEW_DEFAULTS }
};

const labels = {
    imageCopyDenied: 'Clipboard access was denied. Allow clipboard access and try again.',
    copyGraph: 'Copy image', imageCopied: 'Graph image copied.', imageCopyFailed: 'The image could not be copied. Try again.',
    imageCopyUnavailable: 'Image copying is unavailable in this browser. Use the desktop app or a browser that supports image copying.',
    frequency: 'Frequency Response', impulse: 'Impulse Response', distortion: 'Distortion',
    waterfall: 'Waterfall (3D)', details: 'Measurement Details', display: 'Display settings',
    xMin: 'Frequency from', xMax: 'Frequency to', yMin: 'Level from', yMax: 'Level to',
    smoothing: 'Display smoothing (σ)', normalize: 'Relative normalization', reference: 'Reference level',
    normalization: 'Normalization', normalizationNone: 'None',
    normalizationGlobal: 'Overall peak = 0 dB', normalizationFrequency: 'Each frequency peak = 0 dB',
    source: 'Response source', saved: 'Saved response', reanalysis: 'Windowed IR',
    before: 'Window before onset', after: 'Window after onset', window: 'Window shape',
    tukey: 'Tapered', hann: 'Hann', rectangular: 'Rectangular', auto: 'Auto range', reset: 'Reset',
    fromTime: 'Time from', toTime: 'Time to', peak: 'Normalize to peak', db: 'Amplitude in dB',
    origin: 'Display time origin', unit: 'Unit', maxOrder: 'THD highest order',
    harmonicLimit: 'Highest displayed harmonic', displayedOrders: 'Displayed harmonics: 2–{order}',
    higherHarmonics: 'Higher harmonics require a new measurement.',
    start: 'First slice', end: 'Last slice', length: 'Window length', rise: 'Left rise time',
    angle: 'View rotation', zoom: 'View zoom', elevation: 'View elevation', mode: 'Analysis mode',
    waterfallMode: 'Waterfall', burstMode: 'Burst Decay', depthUnit: 'Depth axis', time: 'Time', cycles: 'Cycles',
    resetView: 'Reset view', orbitHelp: 'Drag to rotate. Use the wheel or + / − to zoom. Shift + arrow keys rotate; Shift + Home resets the view.',
    burstNote: 'Burst Decay uses fixed 1/3-octave Gaussian tone bursts. Height and color show the same relative dB level. Cycles correspond to different times at different frequencies. The estimate assumes silence before the saved response begins; unavailable late values are not shown.', correction: 'Correction', export: 'Export measurement (JSON)',
    unavailable: 'This measurement has no impulse response. Import a measurement file containing an impulse response.',
    noDistortion: 'This measurement has no usable distortion data. Make a new measurement.',
    distortionWarning: 'These distortion results may be inaccurate.',
    distortionClipping: 'The recording was too loud and clipped. Lower the playback level or input gain, then measure again.',
    distortionInconsistent: 'The repeated recordings did not agree. Keep the microphone and speakers still, reduce background noise, and measure again.',
    distortionClockDrift: 'Playback and recording timing changed between repetitions. Check the audio-device setup and measure again.',
    distortionOverlap: 'The response did not decay enough to separate the harmonics. Increase Requested sweep length and measure again.',
    distortionBand: 'The sweep frequency range was too narrow for reliable distortion results. Widen the sweep range and measure again.',
    distortionQualityUnknown: 'Check the recording setup and measure again.',
    processing: 'Calculating…', failed: 'This analysis is unavailable with these settings. Adjust the window or select another measurement.',
    combined: 'Combined output of all speakers', sourceNote: 'Display settings do not change the saved measurement or correction settings.',
    smoothingNote: 'Zero adds no smoothing. Existing processing in a saved response cannot be undone. The width is Gaussian σ in octaves.',
    distortionNote: 'Relative distortion of the complete playback and recording path. Microphone and interface calibration are not applied.',
    waterfallNote: 'Surface height and color show the same relative dB level. The default view places 0 ms at the back and later times toward the front. Only complete recorded windows are shown.',
    impulseNote: 'Time is relative to the saved onset. The outline marks the analysis window. Display changes do not change WAV export.',
    readoutHelp: 'Point or touch the graph to read values. Focus the graph and use the arrow keys for keyboard reading.',
    available: 'Available', notAvailable: 'Unavailable', acquisition: 'Source', sampleRate: 'Actual sample rate',
    timeReference: 'Time reference', relative: 'Relative to onset', observed: 'Saved time interval',
    calibration: 'Calibration', relativeLevel: 'Relative level; no absolute SPL calibration',
    windowLimits: 'Window limited to the recorded samples', thdOrders: 'THD includes orders 2–{order}'
};

export const analysisText = key => i18n.t(`analysis:${key}`) || labels[key] || key;
const byId = id => document.getElementById(id);
const MIN_PERCENT_LEVEL = 1e-7;

class AnalysisWorkerClient {
    constructor() { this.serial = 0; this.pending = new Map(); }
    run(type, record, settings) {
        if (!this.worker) {
            this.worker = new Worker(new URL('../../../js/utils/measurement-dsp/analysis-worker.js', import.meta.url), { type: 'module' });
            this.worker.addEventListener('message', ({ data }) => {
                const pending = this.pending.get(data.id);
                if (!pending) return;
                this.pending.delete(data.id);
                if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
            });
            this.worker.addEventListener('error', error => {
                for (const pending of this.pending.values()) pending.reject(error);
                this.pending.clear();
                this.worker.terminate(); this.worker = null;
            });
        }
        const id = ++this.serial;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, record, settings });
        });
    }
    dispose() {
        this.worker?.terminate(); this.worker = null;
        for (const pending of this.pending.values()) pending.reject(new Error('Analysis cancelled'));
        this.pending.clear();
    }
}

export default class AnalysisController {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.activeTab = 'frequency';
        this.settings = structuredClone(ANALYSIS_DEFAULTS);
        this.generation = 0;
        this.readyGeneration = null;
        this.copySnapshots = {};
        this.cache = new Map();
        this.worker = new AnalysisWorkerClient();
        this.controls = {};
        this.plots = {};
        this.previousRecord = null;
        this.analysisSelection = { point: 'all', channel: 'all' };
    }

    initialize() {
        const tabs = [...document.querySelectorAll('[data-analysis-tab]')];
        tabs.forEach((button, index) => {
            button.addEventListener('click', () => this.selectTab(button.dataset.analysisTab));
            button.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
                    (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next].focus(); this.selectTab(tabs[next].dataset.analysisTab);
            });
        });
        for (const tab of Object.keys(ANALYSIS_DEFAULTS)) {
            this.createControls(tab);
            byId(`${tab}CopyGraph`).addEventListener('click', () => this.copyImage(tab));
            this.plots[tab] = new AnalysisPlot(byId(tab === 'frequency' ? 'resultsGraph' : tab === 'impulse' ? 'impulseResponseGraph' : `${tab}AnalysisGraph`), byId(`${tab}AnalysisReadout`), view => {
                Object.assign(this.settings.waterfall, view); this.syncControls('waterfall'); this.draw();
            });
        }
        byId('exportAnalysisJson').addEventListener('click', () =>
            this.uiManager.measurementDisplay.exportMeasurement(this.uiManager.selectedMeasurementId));
        byId('exportImpulseResponseWav').addEventListener('click', () => this.uiManager.graphRenderer.exportImpulseResponseWav());
        byId('impulseResponseZoomIn').addEventListener('click', () => this.zoomImpulse(0.5));
        byId('impulseResponseZoomOut').addEventListener('click', () => this.zoomImpulse(2));
        byId('impulseResponseScroll').addEventListener('input', event => {
            if (!this.record) return;
            const s = this.settings.impulse;
            const duration = s.xMax - s.xMin;
            const [minimum] = this.controlRange('impulse', 'xMin'), [, maximum] = this.controlRange('impulse', 'xMax');
            this.setImpulseView(minimum + s.origin + Math.max(0, maximum - minimum - duration) * Number(event.target.value) / 1000, duration);
        });
        const canvas = this.plots.impulse.canvas;
        canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoomImpulse(event.deltaY < 0 ? 0.8 : 1.25); }, { passive: false });
        canvas.addEventListener('pointerdown', event => {
            const plot = this.plots.impulse, state = plot.state;
            if (event.button !== 0 || !this.record || !state || !plot.plot) return;
            this.drag = { x: event.clientX, start: state.xMin + state.origin, duration: state.xMax - state.xMin,
                width: plot.plot.width * canvas.getBoundingClientRect().width / plot.width };
            canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointermove', event => {
            if (!this.drag) return;
            const start = this.drag.start - (event.clientX - this.drag.x) / this.drag.width * this.drag.duration;
            this.setImpulseView(start, this.drag.duration);
        });
        const endDrag = () => { this.drag = null; };
        canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
        this.resizeObserver = new ResizeObserver(() => {
            const plot = this.plots[this.activeTab];
            if (!plot) return;
            const { width, height } = plot.canvas.getBoundingClientRect();
            if (width !== plot.width || height !== plot.height || (window.devicePixelRatio || 1) !== plot.dpr) this.draw();
        });
        this.resizeObserver.observe(byId('measurementResults'));
        this.themeObserver = new MutationObserver(() => { window.ThemePalette?.refresh(); this.draw(); });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
        for (const name of Object.values(dataStorage.EVENTS)) document.addEventListener(name, () => {
            this.cache.clear(); this.previousRecord = null; this.loadedRecordKey = null; this.refresh();
        });
        window.addEventListener('pagehide', () => { this.worker.dispose(); this.resizeObserver.disconnect(); this.themeObserver.disconnect(); });
    }

    async copyImage(tab) {
        const plot = this.plots[tab];
        const snapshot = this.copySnapshots[tab];
        if (!snapshot || snapshot.state !== plot?.state) return;
        const button = byId(`${tab}CopyGraph`); const status = byId(`${tab}CopyGraphStatus`);
        button.disabled = true; status.textContent = '';
        try {
            await copyGraphImage(plot.renderImage(snapshot));
            if (this.copySnapshots[tab] === snapshot) status.textContent = analysisText('imageCopied');
        } catch (error) {
            console.error('Graph image copy failed:', error);
            if (this.copySnapshots[tab] === snapshot) status.textContent = analysisText(error.code === 'unsupported' ? 'imageCopyUnavailable' : error.code === 'denied' ? 'imageCopyDenied' : 'imageCopyFailed');
        } finally {
            if (this.copySnapshots[tab] === snapshot) button.disabled = false;
        }
    }

    createControls(tab) {
        const host = byId(`${tab}AnalysisSettings`);
        const controls = this.controls[tab] = {};
        host.classList.add('plugin-parameter-ui');
        const add = (key, title, unit = '', options = null, type = 'number') => {
            const row = document.createElement('div'); row.className = 'parameter-row';
            const label = document.createElement('label');
            const name = document.createElement('span'); name.textContent = analysisText(title);
            if (labels[title]) name.dataset.i18n = `analysis:${title}`;
            const suffix = document.createElement('span'); suffix.className = 'parameter-unit';
            suffix.textContent = unit ? ` (${unit})` : '';
            const colon = document.createElement('span'); colon.className = 'parameter-colon'; colon.textContent = ':';
            const text = document.createElement('span'); text.className = 'parameter-label-text';
            name.dataset.i18nLabel = ''; text.append(name, suffix, colon); label.append(text); label.title = label.textContent;
            const input = document.createElement(options ? 'select' : 'input');
            input.id = `analysis-${tab}-${key}`; label.htmlFor = input.id;
            if (options) for (const [value, name] of options) {
                const option = document.createElement('option'); option.value = value;
                option.textContent = labels[name] ? analysisText(name) : name;
                if (labels[name]) option.dataset.i18n = `analysis:${name}`;
                input.append(option);
            } else input.type = type;
            row.append(label); controls[key] = input;
            const apply = value => {
                if (typeof value === 'number' && input.format) value = Number(input.format(value));
                const s = this.settings[tab]; s[key] = key === 'maxOrder' ? Number(value) : value;
                if (key === 'unit') { s.yMin = value === 'dBr' ? -80 : 0; s.yMax = value === 'dBr' ? 0 : 10; }
                if (key === 'db') { s.yMin = value ? -100 : -1.05; s.yMax = value ? 0 : 1.05; }
                this.validateSettings(tab); this.syncControls(tab);
                const viewOnly = /^h\d+$/.test(key) || ['angle', 'elevation', 'zoom', 'xMin', 'xMax', 'yMin', 'yMax', 'unit', 'db', 'origin', 'normalize', 'normalization', 'reference', 'thd'].includes(key);
                if (viewOnly && !(tab === 'waterfall' && s.mode === 'burst' && ['xMin', 'xMax'].includes(key))) this.draw();
                else this.refresh();
            };
            if (type === 'number' && !options) {
                const slider = document.createElement('input'); slider.type = 'range'; slider.id = `${input.id}-slider`;
                label.htmlFor = slider.id; input.setAttribute('aria-labelledby', label.id = `${input.id}-label`);
                const [min, max, step] = this.controlRange(tab, key);
                for (const element of [input, slider]) { element.min = min; element.max = max; element.step = step; }
                input.slider = slider; input.unitLabel = suffix;
                input.sliderRange = () => tab === 'distortion' && ['yMin', 'yMax'].includes(key) && this.settings.distortion.unit === '%'
                    ? [0, 180, 0.01, true] : this.controlRange(tab, key);
                input.toSlider = value => {
                    const [min, max, , logarithmic] = input.sliderRange();
                    if (!logarithmic || max <= min) return value;
                    const positiveMin = min > 0 ? min : tab === 'distortion' && ['yMin', 'yMax'].includes(key) ? MIN_PERCENT_LEVEL : 0.001;
                    const start = min > 0 ? 0 : 0.1;
                    return value <= 0 ? 0 : start + (100 - start) * Math.log(Math.max(positiveMin, value) / positiveMin) / Math.log(max / positiveMin);
                };
                const fromSlider = position => {
                    const [min, max, , logarithmic] = input.sliderRange();
                    if (!logarithmic || max <= min) return position;
                    const positiveMin = min > 0 ? min : tab === 'distortion' && ['yMin', 'yMax'].includes(key) ? MIN_PERCENT_LEVEL : 0.001;
                    const start = min > 0 ? 0 : 0.1;
                    return min === 0 && position <= 0 ? 0 : positiveMin * (max / positiveMin) ** ((Math.max(start, position) - start) / (100 - start));
                };
                input.format = value => this.formatControlValue(tab, key, Number(value));
                input.applied = bindNumberInput(input, slider, min, max, this.settings[tab][key], apply, input.toSlider, input.format,
                    () => this.controlRange(tab, key));
                slider.addEventListener('input', () => { const value = Number(input.format(fromSlider(Number(slider.value)))); input.value = String(value); apply(value); });
                slider.addEventListener('keydown', event => {
                    const [min, max, step, logarithmic] = this.controlRange(tab, key);
                    if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const current = Number(input.format(this.settings[tab][key])), direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
                    let value = current + direction * step;
                    if (!logarithmic) value = Math.max(Number(input.min), Math.min(Number(input.max), value));
                    if (logarithmic && max > min) {
                        value = Number(input.format(fromSlider(Math.max(0, Math.min(100, input.toSlider(current) + direction)))));
                        // A rounded log increment must still reach the next representable value.
                        if (value === current) value += direction * this.controlResolution(tab, key, current);
                    }
                    if (event.key === 'Home') value = min;
                    if (event.key === 'End') value = max;
                    apply(Number(input.format(Math.max(min, Math.min(max, value)))));
                });
                const commit = () => {
                    const value = this.settings[tab][key];
                    input.value = input.format(value); input.applied.value = value;
                    slider.value = input.toSlider(value); updateRangeFill(slider);
                };
                input.addEventListener('blur', commit);
                input.addEventListener('keydown', event => { if (event.key === 'Enter') commit(); });
                row.append(slider);
            }
            row.append(input); host.append(row);
            if (type !== 'number' || options) input.addEventListener('change', () => {
                const value = type === 'checkbox' ? input.checked : options ? input.value : Number(input.value);
                if (typeof value === 'number' && !Number.isFinite(value)) { this.syncControls(tab); return; }
                apply(value);
            });
        };
        add('xMin', tab === 'impulse' ? 'fromTime' : 'xMin', tab === 'impulse' ? 'ms' : 'Hz');
        add('xMax', tab === 'impulse' ? 'toTime' : 'xMax', tab === 'impulse' ? 'ms' : 'Hz');
        add('yMin', 'yMin'); add('yMax', 'yMax');
        if (tab === 'frequency') {
            add('smoothing', 'smoothing', 'oct.'); add('normalize', 'normalize', '', null, 'checkbox');
            add('reference', 'reference', 'dB'); add('source', 'source', '', [['saved', 'saved'], ['ir', 'reanalysis']]);
        }
        if (tab === 'impulse') {
            add('normalize', 'peak', '', null, 'checkbox'); add('db', 'db', '', null, 'checkbox'); add('origin', 'origin', 'ms');
        }
        if (tab === 'distortion') {
            add('unit', 'unit', '', [['%', '%'], ['dBr', 'dBr']]);
            add('harmonicLimit', 'harmonicLimit');
            for (let order = 2; order <= 10; order++) add(`h${order}`, `H${order}`, '', null, 'checkbox');
            add('thd', 'THD', '', null, 'checkbox');
            add('maxOrder', 'maxOrder', '', [['2', '2'], ['3', '3']]);
            const note = document.createElement('p'); note.id = 'distortionHarmonicsNote';
            note.className = 'explanation-text'; note.dataset.i18n = 'analysis:higherHarmonics';
            note.textContent = analysisText('higherHarmonics'); host.append(note);
        }
        if (tab === 'waterfall') {
            add('mode', 'mode', '', [['waterfall', 'waterfallMode'], ['burst', 'burstMode']]);
            add('normalization', 'normalization', '', [['none', 'normalizationNone'], ['global', 'normalizationGlobal'], ['frequency', 'normalizationFrequency']]);
            add('depthUnit', 'depthUnit', '', [['seconds', 'time'], ['cycles', 'cycles']]);
            for (const key of ['start', 'end', 'length', 'rise']) add(key, key, 'ms');
            add('startCycles', 'start', analysisText('cycles')); add('endCycles', 'end', analysisText('cycles'));
            add('smoothing', 'smoothing', 'oct.'); add('angle', 'angle', '°');
            add('elevation', 'elevation', '°'); add('zoom', 'zoom', '×');
        } else { add('before', 'before', 'ms'); add('after', 'after', 'ms'); }
        add('window', 'window', '', [['tukey', 'tukey'], ['hann', 'hann'], ['rectangular', 'rectangular']]);
        for (const action of (tab === 'waterfall' ? ['auto', 'resetView', 'reset'] : ['auto', 'reset'])) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn';
            if (action === 'reset') {
                button.classList.add('analysis-reset-button');
                button.title = analysisText(action); button.dataset.i18nTitle = `analysis:${action}`;
                button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
                const label = document.createElement('span'); label.className = 'analysis-action-label';
                label.textContent = analysisText(action); label.dataset.i18n = `analysis:${action}`; button.append(label);
            } else {
                button.textContent = analysisText(action); button.dataset.i18n = `analysis:${action}`;
                if (action === 'auto') {
                    button.classList.add('analysis-auto-button'); button.id = `${tab}AutoRange`; button.disabled = true;
                }
                if (action === 'resetView') button.classList.add('analysis-view-reset-button');
            }
            button.addEventListener('click', () => {
                if (action === 'resetView') { Object.assign(this.settings.waterfall, WATERFALL_VIEW_DEFAULTS); this.syncControls(tab); this.draw(); }
                else if (action === 'auto') this.autoRange(tab); else this.reset(tab);
            });
            byId(`${tab}AnalysisActions`).insertBefore(button, byId(`${tab}CopyGraph`));
        }
        this.syncControls(tab);
    }

    controlResolution(tab, key, value) {
        if (['yMin', 'yMax'].includes(key)) {
            const s = this.settings[tab];
            if ((tab === 'distortion' && s.unit === '%') || (tab === 'impulse' && !s.db)) {
                const peak = s.normalize ? 1 : (this.impulsePeak ?? findImpulsePeak(this.record?.data)) / (this.record?.refScale || 1);
                return value === 0 ? tab === 'distortion' ? MIN_PERCENT_LEVEL : 10 ** (Math.floor(Math.log10(peak)) - 3)
                    : Math.abs(value) < 1 ? 10 ** (Math.floor(Math.log10(Math.abs(value))) - 2) : 0.01;
            }
            return 0.1;
        }
        if (key === 'reference' || key.endsWith('Cycles') || ['angle', 'elevation'].includes(key)) return 0.1;
        if (key === 'origin') return 0.001;
        if (['before', 'after', 'length', 'rise'].includes(key)) return Math.abs(value) < 1 ? 0.001 : 0.01;
        if ((tab === 'impulse' && ['xMin', 'xMax'].includes(key)) || ['start', 'end', 'zoom', 'smoothing'].includes(key)) return 0.01;
        return 1;
    }

    formatControlValue(tab, key, value) {
        const s = this.settings[tab];
        if (['yMin', 'yMax'].includes(key) && ((tab === 'distortion' && s.unit === '%') || (tab === 'impulse' && !s.db)) && value !== 0 && Math.abs(value) < 1) {
            return String(Number(value.toPrecision(3)));
        }
        return String(Number(value.toFixed(Math.max(0, -Math.round(Math.log10(this.controlResolution(tab, key, value)))))));
    }

    controlRange(tab, key) {
        const [min, max, nominalStep, logarithmic] = this.controlDomain(tab, key);
        // Keep sample-derived limits inside the precision that the number field can represent.
        const minResolution = this.controlResolution(tab, key, min), maxResolution = this.controlResolution(tab, key, max);
        const lower = Number((Math.ceil(min / minResolution - 1e-8) * minResolution).toPrecision(12)) + 0;
        const upper = Number((Math.floor(max / maxResolution + 1e-8) * maxResolution).toPrecision(12)) + 0;
        return [Math.min(lower, upper), upper, nominalStep, ...(logarithmic === undefined ? [] : [logarithmic])];
    }

    controlDomain(tab, key) {
        const s = this.settings[tab];
        const bounds = getImpulseTimeBounds(this.record) || { minMs: -10, maxMs: 1000, samplePeriodMs: 0.01 };
        const samplePeriod = this.record?.sampleRate ? 1000 / this.record.sampleRate : bounds.samplePeriodMs;
        const sampleRate = 1000 / samplePeriod;
        const minimumWindow = (Math.floor(sampleRate / analysisFrequencyLimit(sampleRate)) + 1) * samplePeriod;
        const secondFrequency = s.xMax * (s.xMin / s.xMax) ** (1 / (BURST_FREQUENCY_COUNT - 1));
        const burstLastCenter = bounds.maxMs - samplePeriod - 4 * BURST_TAU_CYCLES * 1000 / secondFrequency;
        // Two adjacent frequencies and depths must retain support even after the worker reduces slice density.
        const burstLatestStart = ((BURST_MINIMUM_SLICES - 1) * burstLastCenter - bounds.maxMs) / (BURST_MINIMUM_SLICES - 2);
        if (key === 'harmonicLimit') return [2, this.capabilities?.distortion ? Math.min(10, this.record.harmonicAnalysis.orders.length) : 3, 1];
        if (['xMin', 'xMax'].includes(key)) {
            if (tab === 'impulse') {
                // Viewport edges include all observed samples; only display padding may extend beyond them.
                const minimum = Math.floor((bounds.minMs - s.origin) * 100) / 100;
                const maximum = Math.ceil((bounds.maxMs - s.origin) * 100) / 100;
                return key === 'xMin' ? [minimum, maximum - 0.01, 0.1] : [s.xMin + 0.01, maximum, 0.1];
            }
            const burst = tab === 'waterfall' && s.mode === 'burst';
            const nyquist = (this.record?.sampleRate || this.measurement?.sampleRate || 48000) / 2;
            const maximum = Math.floor(burst ? nyquist / 2 ** (1 / 6) : nyquist);
            return key === 'xMin' ? [burst ? 10 : 1, maximum - 1, 1, true] : [s.xMin + 1, maximum, 1, true];
        }
        if (['yMin', 'yMax'].includes(key)) {
            const percent = tab === 'distortion' && s.unit === '%';
            const amplitude = tab === 'impulse' && !s.db;
            const maximum = amplitude ? s.normalize ? 2 : 2 * (this.impulsePeak ?? findImpulsePeak(this.record?.data)) / (this.record?.refScale || 1) : 180;
            const minimum = percent ? 0 : -maximum;
            const minimumStep = this.controlResolution(tab, key, s[key]);
            const step = percent || amplitude ? Math.min(1, 10 ** Math.floor(Math.log10(Math.max(minimumStep, Math.abs(s[key]) / 10 || (s.yMax - s.yMin) / 100)))) : 1;
            return key === 'yMin' ? [minimum, maximum - this.controlResolution(tab, key, maximum), step, percent]
                : [s.yMin + this.controlResolution(tab, key, s.yMin), maximum, step, percent];
        }
        if (key === 'reference') return [-180, 180, 0.1];
        if (key === 'smoothing') return [0, 1, 0.01];
        if (key === 'angle') return [-180, 180, 1];
        if (key === 'elevation') return [10, 80, 1];
        if (key === 'zoom') return [0.6, 2.5, 0.1];
        if (key === 'origin') return [bounds.minMs, bounds.maxMs, 0.01];
        if (key.endsWith('Cycles')) return key === 'startCycles'
            ? [0, Math.max(0, Math.min(99.9, Math.floor(((BURST_MINIMUM_SLICES - 1) * burstLastCenter * secondFrequency / 1000 - 100) /
                (BURST_MINIMUM_SLICES - 2) * 10) / 10)), 0.1]
            : [s.startCycles + 0.1, 100, 0.1];
        if (key === 'before' || key === 'after') {
            const selected = tab === 'distortion' && this.capabilities?.distortion
                ? this.record.harmonicAnalysis.orders.slice(0, s.harmonicLimit).filter(order => order.validMaxFrequency > order.validMinFrequency) : [];
            const available = selected.length ? Math.min(...selected.map(order => (key === 'before' ? order.onsetIndex : order.data.length - order.onsetIndex) * 1000 / this.record.sampleRate))
                : key === 'before' ? -bounds.minMs : bounds.maxMs;
            const reservedSamples = key === 'before' ? 2 : Math.round(s.before / samplePeriod);
            // Round duration caps down to displayed precision so converting back cannot exceed the sample budget.
            const maximum = Math.min(available, Math.floor((MAX_ANALYSIS_WINDOW_SAMPLES - reservedSamples) * samplePeriod * 1000) / 1000);
            const availableAfter = selected.length ? Math.min(...selected.map(order => (order.data.length - order.onsetIndex) * 1000 / this.record.sampleRate)) : bounds.maxMs;
            const minimum = key === 'before' ? availableAfter < 2 * samplePeriod ? samplePeriod : 0
                : Math.min(Math.max(0.1, 2 * samplePeriod), maximum);
            return [minimum, maximum, key === 'before' ? 0.1 : 1, true];
        }
        if (key === 'start') return [0, Math.max(0, s.mode === 'burst' ? Math.floor(burstLatestStart * 1000) / 1000 : bounds.maxMs - minimumWindow - samplePeriod), 0.1];
        if (key === 'end') return [s.start + Math.max(0.01, s.mode === 'waterfall' ? samplePeriod : 0.01), bounds.maxMs, 0.1];
        if (key === 'length') {
            const maximum = Math.min(bounds.maxMs - s.start - samplePeriod, Math.floor(MAX_ANALYSIS_WINDOW_SAMPLES * samplePeriod * 1000) / 1000);
            return [Math.min(minimumWindow, maximum), maximum, 1, true];
        }
        if (key === 'rise') return [0, s.length, 0.1, true];
        return [0, 1, 0.01];
    }

    validateSettings(tab) {
        const s = this.settings[tab];
        if (tab === 'distortion') {
            const orders = this.capabilities?.distortion ? this.record.harmonicAnalysis.orders : [];
            s.harmonicLimit = Math.max(2, Math.min(Math.min(10, orders.length || 3), Math.round(s.harmonicLimit)));
            s.maxOrder = Math.max(2, Math.min(s.harmonicLimit, Math.round(s.maxOrder)));
        }
        // Validate dependencies first so every control uses the same live domain as its number binding.
        for (const key of ['origin', 'xMin', 'xMax', 'yMin', 'yMax', 'reference', 'smoothing', 'before', 'after',
            'start', 'end', 'length', 'rise', 'startCycles', 'endCycles', 'angle', 'elevation', 'zoom']) {
            if (!(key in s)) continue;
            const [min, max] = this.controlRange(tab, key);
            s[key] = Math.max(min, Math.min(max, Number.isFinite(s[key]) ? s[key] : ANALYSIS_DEFAULTS[tab][key]));
            if (!['angle', 'elevation', 'zoom'].includes(key)) s[key] = Number(this.formatControlValue(tab, key, s[key]));
            if (tab === 'distortion' && s.unit === '%' && ['yMin', 'yMax'].includes(key) && s[key] > 0 && s[key] < MIN_PERCENT_LEVEL) s[key] = MIN_PERCENT_LEVEL;
        }
    }

    syncControls(tab) {
        const s = this.settings[tab];
        if (tab === 'distortion') {
            const control = this.controls[tab]?.maxOrder;
            if (control && control.options.length !== s.harmonicLimit - 1) {
                control.replaceChildren(...Array.from({ length: s.harmonicLimit - 1 }, (_, index) => {
                    const option = document.createElement('option'); option.value = option.textContent = String(index + 2);
                    return option;
                }));
            }
            const limit = this.controls[tab]?.harmonicLimit;
            const maximum = this.capabilities?.distortion ? Math.min(10, this.record.harmonicAnalysis.orders.length) : 3;
            if (limit) { limit.max = maximum; limit.slider.max = maximum; }
            const note = byId('distortionHarmonicsNote');
            if (note) note.hidden = !this.capabilities?.distortion || maximum >= 10;
        }
        for (const [key, control] of Object.entries(this.controls[tab] || {})) {
            if (control.type === 'checkbox') control.checked = s[key];
            else if (document.activeElement !== control || key === 'harmonicLimit' || key === 'maxOrder') control.value = control.format ? control.format(s[key]) : s[key];
            if (control.slider) {
                const [min, max, step] = this.controlRange(tab, key);
                const current = Number(control.format(s[key]));
                // Native stepping is relative to min. Align that grid to the current fraction without changing its increment.
                control.min = Number((current - Math.floor((current - min) / step + 1e-8) * step).toPrecision(12));
                control.max = Number((current + Math.floor((max - current) / step + 1e-8) * step).toPrecision(12));
                control.step = step;
                const [sliderMin, sliderMax, , logarithmic] = control.sliderRange();
                control.slider.min = logarithmic && sliderMax > sliderMin ? 0 : sliderMin;
                control.slider.max = logarithmic && sliderMax > sliderMin ? 100 : sliderMax;
                control.slider.step = step === 1 && key === 'harmonicLimit' ? 1 : 'any';
                control.slider.dataset.rangeFineTarget = control.id;
                control.slider.dataset.rangeFineStep = String(step);
                control.slider.setAttribute('aria-valuetext', control.format(s[key]));
                control.slider.value = control.toSlider(s[key]); control.applied.value = s[key]; updateRangeFill(control.slider);
            }
            if (key === 'yMin' || key === 'yMax') {
                control.unitLabel.textContent = ` (${tab === 'distortion' ? s.unit : tab === 'impulse' && !s.db ? '×' : 'dB'})`;
                const label = control.unitLabel.closest('label'); label.title = label.textContent;
            }
            if (tab === 'distortion' && /^h\d+$/.test(key)) control.closest('.parameter-row').hidden = Number(key.slice(1)) > s.harmonicLimit;
            if (tab === 'frequency' && ['before', 'after', 'window'].includes(key)) {
                control.disabled = s.source !== 'ir'; if (control.slider) control.slider.disabled = control.disabled;
            }
            if (tab === 'frequency' && key === 'reference') {
                control.disabled = s.normalize; control.slider.disabled = s.normalize;
            }
            if (tab === 'waterfall') {
                const burst = s.mode === 'burst';
                const hidden = key === 'depthUnit' ? !burst : ['startCycles', 'endCycles'].includes(key) ? !burst || s.depthUnit !== 'cycles' :
                    ['start', 'end'].includes(key) ? burst && s.depthUnit === 'cycles' : ['length', 'rise', 'smoothing', 'window'].includes(key) && burst;
                control.closest('.parameter-row').hidden = Boolean(hidden);
            }
        }
        if (tab === 'waterfall') {
            const note = byId('waterfallAnalysisNote');
            if (note) { note.dataset.i18n = `analysis:${s.mode === 'burst' ? 'burstNote' : 'waterfallNote'}`; note.textContent = analysisText(s.mode === 'burst' ? 'burstNote' : 'waterfallNote'); }
        }
    }

    selectTab(tab) {
        if (tab === this.activeTab) return;
        const display = this.uiManager.measurementDisplay;
        if (this.activeTab === 'frequency') this.analysisSelection = { point: display.selectedPointIndex, channel: display.selectedChannel };
        this.activeTab = tab;
        document.querySelectorAll('[data-analysis-tab]').forEach(button => {
            const selected = button.dataset.analysisTab === tab;
            button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
            button.classList.toggle('active', selected);
        });
        document.querySelectorAll('[data-analysis-panel]').forEach(panel => { panel.hidden = panel.dataset.analysisPanel !== tab; });
        for (const [name, plot] of Object.entries(this.plots)) { plot.readout?.clear(); plot.surface?.setEnabled(name === tab); }
        this.refresh();
    }

    async refresh() {
        const generation = ++this.generation;
        this.readyGeneration = null;
        this.uiManager.graphRenderer.impulseResponse = null;
        byId('exportImpulseResponseWav').disabled = true;
        this.syncImpulseScroll();
        this.copySnapshots = {};
        for (const tab of Object.keys(this.plots)) {
            byId(`${tab}AutoRange`).disabled = true;
            byId(`${tab}CopyGraph`).disabled = true;
            byId(`${tab}CopyGraphStatus`).textContent = '';
        }
        if (this.worker.pending.size) this.worker.dispose();
        const measurement = dataStorage.getMeasurementById(this.uiManager.selectedMeasurementId);
        if (!measurement) {
            this.currentPlotState = null;
            for (const [tab, plot] of Object.entries(this.plots)) {
                plot.clear(); byId(`${tab}AnalysisConditions`).textContent = ''; this.showMessage(tab, '');
            }
            return;
        }
        const display = this.uiManager.measurementDisplay;
        if (this.measurementId !== measurement.id) {
            this.measurementId = measurement.id; this.previousRecord = null; this.cache.clear();
            this.analysisSelection = { point: 'all', channel: 'all' };
        }
        const tab = this.activeTab;
        const selection = tab === 'frequency' ? { point: display.selectedPointIndex, channel: display.selectedChannel } : this.analysisSelection;
        const target = resolveAnalysisRecord(measurement, selection.point, selection.channel, this.previousRecord);
        if (tab !== 'frequency' && target) {
            selection.point = target.pointIndex;
            selection.channel = target.channel || 'all';
            this.previousRecord = target;
        }
        this.targetKey = JSON.stringify([measurement.id, selection.point, selection.channel]);
        if (this.plots[tab]) {
            const keepCompletedPlot = this.plots[tab].state?.targetKey === this.targetKey;
            if (!keepCompletedPlot) {
                this.plots[tab].clear(); this.currentPlotState = null;
                byId(`${tab}AnalysisConditions`).textContent = '';
            }
            this.showMessage(tab, keepCompletedPlot ? '' : analysisText('processing'), true);
        }
        document.querySelectorAll('.point-item').forEach(item => {
            item.classList.toggle('selected', String(selection.point) === item.dataset.index);
            if (item.dataset.index === 'all') item.setAttribute('aria-disabled', String(tab !== 'frequency'));
        });
        document.querySelectorAll('.channel-filter-button').forEach(button => {
            button.classList.toggle('selected', button.dataset.channel === selection.channel);
            if (button.dataset.channel === 'all') button.disabled = tab !== 'frequency';
        });
        this.measurement = measurement;
        byId('resultTitle').textContent = measurement.name;
        this.displayed = resolveDisplayedResponse(measurement, selection.point, selection.channel);
        if (tab === 'frequency') this.updateLevelWarnings();
        let record;
        try {
            record = target ? await dataStorage.getImpulseResponse(measurement.id, target.irKey) : null;
        } catch (error) {
            if (generation !== this.generation) return;
            console.error('Measurement record loading failed:', error);
            if (this.plots[tab]) {
                this.currentPlotState = null;
                byId(`${tab}AnalysisConditions`).textContent = '';
                this.plots[tab].clear(); this.showMessage(tab, analysisText('failed'));
            }
            return;
        }
        if (generation !== this.generation) return;
        this.record = record; this.target = target;
        this.impulsePeak = findImpulsePeak(record?.data);
        this.capabilities = getAnalysisCapabilities(record, this.displayed?.frequencyResponse);
        byId('exportImpulseResponseWav').disabled = !this.capabilities.impulse;
        const recordKey = target ? `${measurement.id}:${target.irKey}` : null;
        if (recordKey !== this.loadedRecordKey && this.capabilities.impulse) {
            this.loadedRecordKey = recordKey;
            const { start, end, length, rise } = this.waterfallDefaults(record);
            Object.assign(this.settings.waterfall, { start, end, length, rise });
            this.syncControls('waterfall');
            this.settings.distortion.before = ANALYSIS_DEFAULTS.distortion.before;
            this.settings.distortion.after = ANALYSIS_DEFAULTS.distortion.after;
        }
        for (const name of Object.keys(ANALYSIS_DEFAULTS)) { this.validateSettings(name); this.syncControls(name); }
        this.uiManager.graphRenderer.impulseResponse = record;
        const concreteFrequency = display.selectedPointIndex !== 'all' &&
            (!measurement.outputChannels?.length || display.selectedChannel !== 'all');
        this.controls.frequency.source.options[1].disabled = !this.capabilities.impulse || !concreteFrequency;
        if (this.settings.frequency.source === 'ir' && this.controls.frequency.source.options[1].disabled) {
            this.settings.frequency.source = 'saved'; this.syncControls('frequency');
        }
        byId('analysisTarget').textContent = target && tab !== 'frequency'
            ? `${measurement.points[target.pointIndex].name || `${target.pointIndex + 1}`} · ${target.combinedOutput ? analysisText('combined') : target.channel ? channelDisplayLabel(target.channel) : channelDisplayLabel(measurement.outputChannel)}` : '';
        this.updateDetails();
        if (tab === 'details') return;
        const usable = tab === 'frequency' ? this.capabilities.frequency : this.capabilities[tab];
        this.plots[tab].mount.hidden = !usable;
        this.analysisResult = null;
        if (!usable) {
            this.currentPlotState = null;
            byId(`${tab}AnalysisConditions`).textContent = '';
            this.plots[tab].clear();
            this.showMessage(tab, analysisText(tab === 'distortion' ? 'noDistortion' : 'unavailable'));
            return;
        }
        if (tab === 'impulse' || (tab === 'frequency' && this.settings.frequency.source === 'saved')) {
            this.readyGeneration = generation; this.showMessage(tab, ''); this.draw(); return;
        }
        const s = this.settings[tab];
        const settings = { beforeSeconds: s.before / 1000, afterSeconds: s.after / 1000, window: s.window,
            harmonicLimit: s.harmonicLimit, maxOrder: s.maxOrder, smoothing: tab === 'frequency' ? 0 : s.smoothing, startSeconds: s.start / 1000, endSeconds: s.end / 1000,
            windowSeconds: s.length / 1000, riseSeconds: s.rise == null ? undefined : s.rise / 1000, maxSlices: 48 };
        const type = tab === 'waterfall' && s.mode === 'burst' ? 'burst' : tab;
        if (type === 'burst') Object.assign(settings, { depthUnit: s.depthUnit, startCycles: s.startCycles, endCycles: s.endCycles, minFrequency: s.xMin, maxFrequency: s.xMax });
        const key = JSON.stringify([measurement.id, target.irKey, record.harmonicAnalysis?.version, type, settings]);
        try {
            let result = this.cache.get(key);
            if (!result) {
                result = await this.worker.run(type, record, settings);
                if (generation !== this.generation) return;
                if (this.cache.size >= 12) this.cache.delete(this.cache.keys().next().value);
                this.cache.set(key, result);
            }
            if (generation !== this.generation) return;
            this.analysisResult = result;
            this.readyGeneration = generation;
            this.showMessage(tab, ''); this.draw();
        } catch (error) {
            if (generation !== this.generation) return;
            console.error('Measurement analysis failed:', error);
            this.currentPlotState = null;
            byId(`${tab}AnalysisConditions`).textContent = '';
            this.plots[tab].clear(); this.showMessage(tab, analysisText('failed'));
        }
    }

    updateLevelWarnings() {
        const display = this.uiManager.measurementDisplay;
        const channels = display.selectedChannel === 'all' ?
            resolveDisplayedChannelCurves(this.measurement, display.selectedPointIndex) : null;
        const warnings = aggregateLevelWarnings(channels || [{ ...this.displayed, channel: display.selectedChannel }]);
        const messages = [];
        for (const [kind, key] of [['low', 'signalTooLow'], ['high', 'signalTooHigh']]) {
            if (!warnings[kind].length) continue;
            messages.push(channels ? i18n.t(`warning:${key}Channels`).replace('{channels}', warnings[kind].map(channelDisplayLabel).join(', ')) :
                i18n.t(`warning:${key}`));
        }
        const element = byId('frequencyLevelWarning');
        element.textContent = messages.join(' · ');
        element.hidden = !messages.length;
    }

    distortionQualityWarning() {
        const harmonic = this.capabilities.impulse && getValidHarmonicAnalysis(this.record);
        if (!harmonic || harmonic.quality.valid) return '';
        const messages = [
            ['clipping', 'distortionClipping'],
            ['inconsistent-capture', 'distortionInconsistent'],
            ['clock-drift', 'distortionClockDrift'],
            ['overlapping-tail', 'distortionOverlap'],
            ['insufficient-harmonic-band', 'distortionBand']
        ].filter(([reason]) => harmonic.quality.reasons.includes(reason))
            .map(([, key]) => analysisText(key));
        return [analysisText('distortionWarning'),
            ...(messages.length ? messages : [analysisText('distortionQualityUnknown')])].join(' ');
    }

    showMessage(tab, message, busy = message === analysisText('processing')) {
        byId(`${tab}AnalysisStatus`).textContent = message;
        byId(`${tab}AnalysisStatus`).hidden = !message;
        byId(`${tab}AnalysisPanel`).setAttribute('aria-busy', String(busy));
    }

    frequencySeries() {
        const measurement = this.measurement;
        const s = this.settings.frequency;
        const display = this.uiManager.measurementDisplay;
        const response = s.source === 'ir' ? this.analysisResult?.frequencyResponse : this.displayed?.frequencyResponse;
        if (!response?.length) return [];
        const band = resolveResponseSweepBand(measurement, display.selectedChannel);
        const reference = s.normalize ? responseReferenceDb(response, band.minFreq, band.maxFreq) : s.reference;
        const process = points => {
            const shifted = points.map(([frequency, db]) => [frequency, db - reference]);
            return s.smoothing > 0 ? audioUtils.smoothFrequencyResponse(shifted, s.smoothing) : shifted;
        };
        const series = [];
        if (byId('showOriginal').checked) {
            const channels = s.source === 'saved' && display.selectedChannel === 'all' ?
                resolveDisplayedChannelCurves(measurement, display.selectedPointIndex) || [] : [];
            if (channels.length) for (const curve of channels) series.push({ label: channelDisplayLabel(curve.channel),
                color: channelColor(curve.channel, measurement.outputChannels), points: process(curve.frequencyResponse) });
            else series.push({ label: i18n.t('label:showOriginal') || 'Original Response',
                color: this.uiManager.graphColors.original, points: process(response) });
        }
        if (measurement.peqParameters?.length) {
            const correction = this.uiManager.correctionHandler.generateCorrectionCurve(measurement.peqParameters, response);
            if (byId('showCorrection').checked) series.push({ label: i18n.t('label:showCorrection') || 'Correction EQ',
                color: this.uiManager.graphColors.correction, points: correction });
            if (byId('showCorrected').checked) {
                const gains = new Map(correction);
                series.push({ label: i18n.t('label:showCorrected') || 'Corrected Response', color: this.uiManager.graphColors.corrected,
                    points: process(response).map(([frequency, db]) => [frequency, db + (gains.get(frequency) || 0)]) });
            }
        }
        return series;
    }

    draw() {
        const tab = this.activeTab;
        this.syncImpulseScroll();
        if (this.readyGeneration !== this.generation) return;
        if (!this.measurement || tab === 'details' || !this.plots[tab]) return;
        if (!this.capabilities?.[tab]) return;
        const s = this.settings[tab];
        let state = { ...s, type: tab, unit: 'dB', series: [], targetKey: this.targetKey };
        if (tab === 'frequency') {
            state.series = this.frequencySeries();
            const low = byId('targetLowFreqSlider');
            const high = byId('targetHighFreqSlider');
            if (low && high) state.frequencyMarkers = [
                this.uiManager.correctionHandler.logSliderToValue(low.value, 20, 1000),
                this.uiManager.correctionHandler.logSliderToValue(high.value, 1000, 20000)
            ];
        }
        if (tab === 'impulse') {
            if (!this.capabilities?.impulse) return;
            state = { ...state, logX: false, record: this.record, unit: s.db ? 'dB' : '×', peakNormalized: s.normalize,
                windowBefore: Math.min(s.before, this.record.onsetIndex * 1000 / this.record.sampleRate),
                windowAfter: Math.min(s.after, (this.record.data.length - this.record.onsetIndex) * 1000 / this.record.sampleRate),
                series: [{ label: analysisText('impulse'), color: this.uiManager.graphColors.original }] };
            byId('impulseResponseRange').textContent = `${s.xMin.toFixed(2)}–${s.xMax.toFixed(2)} ms`;
        }
        if (tab === 'distortion') {
            if (!this.analysisResult) return;
            const data = this.analysisResult;
            state.unit = s.unit;
            // Temporarily hide quality warnings in every presentation; retain the diagnostic helper and stored flags.
            const showQualityWarnings = false;
            const warning = showQualityWarnings ? this.distortionQualityWarning() : '';
            state.qualityWarning = warning ? analysisText('distortionWarning') : '';
            this.showMessage(tab, warning);
            const colors = [this.uiManager.graphColors.correction, this.uiManager.graphColors.corrected, ...CHANNEL_COLORS];
            state.series = data.series.filter(series => s[`h${series.order}`]).map(series => ({
                label: `H${series.order}`, color: colors[series.order - 2],
                points: data.frequencies.map((frequency, i) => [frequency, distortionValue(series.ratios[i], s.unit)])
            }));
            if (s.thd) state.series.unshift({ label: `THD (2–${data.maxOrder})`, color: this.uiManager.graphColors.original,
                points: data.frequencies.map((frequency, i) => [frequency, distortionValue(data.thd[i], s.unit)]) });
        }
        if (tab === 'waterfall') {
            if (!this.analysisResult) return;
            state.waterfall = this.analysisResult; state.depthUnit = s.mode === 'burst' ? s.depthUnit : 'seconds';
            state.series = [{ label: analysisText(s.mode === 'burst' ? 'burstMode' : 'waterfall'), color: this.uiManager.graphColors.original }];
        }
        this.currentPlotState = state;
        if (this.plots[tab].draw(state) === false) {
            this.currentPlotState = null;
            delete this.copySnapshots[tab];
            byId(`${tab}AutoRange`).disabled = true;
            byId(`${tab}CopyGraph`).disabled = true;
            byId(`${tab}CopyGraphStatus`).textContent = '';
            byId(`${tab}AnalysisConditions`).textContent = '';
            this.showMessage(tab, analysisText('failed'));
            return;
        }
        if (tab === 'waterfall') this.showMessage(tab, '');
        const conditions = byId(`${tab}AnalysisConditions`);
        conditions.textContent = tab === 'frequency' ? `${analysisText(s.source === 'ir' ? 'reanalysis' : 'saved')} · σ ${s.smoothing} oct. · ${analysisText('relativeLevel')}` :
            tab === 'impulse' ? `${analysisText('relative')} · ${analysisText('windowLimits')}` :
                tab === 'distortion' ? `${analysisText('displayedOrders').replace('{order}', s.harmonicLimit)} · ${analysisText('thdOrders').replace('{order}', s.maxOrder)} · ${s.unit}` :
                    s.mode === 'burst' ? `${analysisText('burstMode')} · 1/3 oct.` :
                    `${analysisText('length')}: ${Number(s.length.toFixed(2))} ms · Δf ${Number((this.analysisResult?.resolutionHz || 0).toPrecision(3))} Hz`;
        if (tab === 'waterfall' && s.normalization !== 'none') {
            conditions.textContent += ` · ${analysisText(s.normalization === 'global' ? 'normalizationGlobal' : 'normalizationFrequency')}`;
        }
        if (state.qualityWarning) conditions.textContent += ` · ${state.qualityWarning}`;
        const display = this.uiManager.measurementDisplay;
        const point = display.selectedPointIndex === 'all' ? i18n.t('option:allChannelsAverage') :
            this.measurement.points[display.selectedPointIndex]?.name || `Point ${Number(display.selectedPointIndex) + 1}`;
        const channel = display.selectedChannel === 'all' ? i18n.t('option:allChannelsAverage') : channelDisplayLabel(display.selectedChannel);
        const selection = tab === 'frequency' ? `${point} · ${channel}` : byId('analysisTarget').textContent;
        this.copySnapshots[tab] = {
            state,
            title: analysisText(tab === 'waterfall' && s.mode === 'burst' ? 'burstMode' : tab),
            subtitle: [this.measurement.name, selection, conditions.textContent].filter(Boolean).join(' · ')
        };
        byId(`${tab}CopyGraph`).disabled = false;
        byId(`${tab}AutoRange`).disabled = false;
    }

    syncImpulseScroll() {
        const slider = byId('impulseResponseScroll');
        if (!slider) return;
        const bounds = this.readyGeneration === this.generation && this.capabilities?.impulse
            ? getImpulseTimeBounds(this.record) : null;
        const s = this.settings.impulse;
        const minimum = bounds ? this.controlRange('impulse', 'xMin')[0] : 0;
        const maximum = bounds ? this.controlRange('impulse', 'xMax')[1] : 0;
        const available = maximum - minimum - (s.xMax - s.xMin);
        slider.disabled = !(available > 0);
        slider.value = available > 0
            ? Math.max(0, Math.min(1000, (s.xMin - minimum) / available * 1000)) : 0;
        updateRangeFill(slider);
    }

    autoRange(tab) {
        const s = this.settings[tab];
        const state = this.currentPlotState;
        const unit = tab === 'distortion' ? s.unit : tab === 'impulse' && !s.db ? '×' : 'dB';
        if (this.readyGeneration !== this.generation || tab !== this.activeTab || !state || state.type !== tab ||
            state.targetKey !== this.targetKey || state.unit !== unit ||
            ['source', 'normalize', 'reference', 'smoothing', 'normalization'].some(key => state[key] !== s[key])) return;
        if (tab === 'impulse' && this.record) {
            s.xMin = this.controlRange('impulse', 'xMin')[0]; s.xMax = this.controlRange('impulse', 'xMax')[1];
            const peak = s.normalize ? 1 : findImpulsePeak(this.record.data) / (this.record.refScale || 1);
            s.yMin = s.db ? -100 : -peak * 1.05; s.yMax = s.db ? 20 * Math.log10(peak) + 3 : peak * 1.05;
        } else if (tab === 'waterfall' && this.record) {
            const bounds = getImpulseTimeBounds(this.record);
            s.start = Math.max(0, bounds.minMs); s.end = bounds.maxMs;
            s.length = Math.min(s.length, Math.max(0.1, (bounds.maxMs - s.start) / 2));
            s.rise = Math.min(s.rise, s.length / 2);
        } else {
            const points = state.series.flatMap(series => series.points || []).filter(([, value]) => Number.isFinite(value));
            if (points.length) {
                s.xMin = Math.max(1, Math.min(...points.map(([x]) => x)));
                s.xMax = Math.max(...points.map(([x]) => x));
                const minimum = Math.min(...points.map(([, y]) => y));
                const maximum = Math.max(...points.map(([, y]) => y));
                const ratio = tab === 'distortion' && s.unit === '%';
                const margin = ratio ? Math.max(MIN_PERCENT_LEVEL, Math.max(Math.abs(minimum), Math.abs(maximum), maximum - minimum) * 0.1)
                    : Math.max(0.01, (maximum - minimum) * 0.1);
                s.yMin = minimum - margin; s.yMax = maximum + margin;
            }
        }
        for (const key of ['yMin', 'yMax']) {
            const resolution = this.controlResolution(tab, key, s[key]);
            s[key] = (key === 'yMin' ? Math.floor(s[key] / resolution) : Math.ceil(s[key] / resolution)) * resolution;
        }
        this.validateSettings(tab); this.syncControls(tab); this.refresh();
    }

    waterfallDefaults(record) {
        const defaults = structuredClone(ANALYSIS_DEFAULTS.waterfall);
        const bounds = record && getImpulseTimeBounds(record);
        if (bounds) {
            defaults.start = Math.max(0, bounds.minMs);
            defaults.end = Math.min(defaults.end, bounds.maxMs);
            defaults.length = Math.min(defaults.length, Math.max(2000 / record.sampleRate, (defaults.end - defaults.start) / 2));
            defaults.rise = Math.min(defaults.rise, defaults.length / 4);
        }
        return defaults;
    }

    reset(tab) {
        this.settings[tab] = tab === 'waterfall' ? this.waterfallDefaults(this.record) : structuredClone(ANALYSIS_DEFAULTS[tab]);
        this.validateSettings(tab);
        this.syncControls(tab); this.refresh();
    }

    zoomImpulse(factor) {
        if (!this.record) return;
        const s = this.settings.impulse;
        const oldDuration = s.xMax - s.xMin;
        this.setImpulseView(s.xMin + s.origin + oldDuration * (1 - factor) / 2, oldDuration * factor);
    }

    setImpulseView(startMs, durationMs) {
        const bounds = getImpulseTimeBounds(this.record);
        if (!bounds) return;
        const s = this.settings.impulse;
        const [minimum] = this.controlRange('impulse', 'xMin'), [, maximum] = this.controlRange('impulse', 'xMax');
        const view = clampImpulseView(startMs, durationMs, { ...bounds, minMs: minimum + s.origin, maxMs: maximum + s.origin });
        s.xMin = view.startMs - s.origin; s.xMax = s.xMin + view.durationMs;
        this.validateSettings('impulse');
        this.syncControls('impulse'); this.draw();
    }

    updateDetails() {
        const body = byId('analysisDetails'); body.replaceChildren();
        const rows = [[analysisText('acquisition'), this.record?.harmonicAnalysis ? 'ESS' : this.measurement.acquisitionMethod === 'wav' ? 'WAV' : 'TSP / ' + analysisText('saved')]];
        if (this.record) {
            const bounds = getImpulseTimeBounds(this.record);
            rows.push([analysisText('sampleRate'), `${this.record.sampleRate} Hz`],
                [analysisText('timeReference'), analysisText('relative')],
                [analysisText('observed'), bounds ? `${bounds.minMs.toFixed(2)} … ${bounds.maxMs.toFixed(2)} ms` : '—'],
                [analysisText('calibration'), analysisText('relativeLevel')]);
        }
        for (const tab of ['frequency', 'impulse', 'distortion', 'waterfall']) rows.push([
            analysisText(tab), analysisText(this.capabilities?.[tab] ? 'available' : 'notAvailable')
        ]);
        for (const [label, value] of rows) {
            const row = document.createElement('tr');
            const heading = document.createElement('th'); heading.textContent = label;
            const cell = document.createElement('td'); cell.textContent = value;
            row.append(heading, cell); body.append(row);
        }
    }
}
