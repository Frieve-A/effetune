import {
    PIPELINE_ANALYZER_MLS_LENGTHS,
    PIPELINE_ANALYZER_TSP_LENGTHS
} from './mls.js';

const MAX_OUTPUT_SLOTS = 4;
const NARROW_LAYOUT_QUERY = '(max-width: 1180px)';
const DEFAULT_GRAPH_SIZE = Object.freeze({ width: 1024, height: 480 });
const SIGNAL_TYPES = Object.freeze(['mls', 'tsp', 'impulse']);
const GRAPH_VIEWS = Object.freeze([
    'frequency',
    'phase',
    'minimumGroupDelay',
    'excessGroupDelay',
    'impulse'
]);

const DEFAULT_MEASUREMENT_SETTINGS = Object.freeze({
    signalType: 'mls',
    levelDb: -12,
    sequenceLength: 65535,
    stabilizationPeriods: 12,
    averagingPeriods: 2
});
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
    smoothingOct: 0.17,
    impulseRangeMs: 6
});

const FALLBACK_TEXT = Object.freeze({
    title: 'Pipeline Analyzer',
    open: 'Open Pipeline Analyzer',
    close: 'Close Pipeline Analyzer',
    collapse: 'Collapse Analyzer',
    expand: 'Expand Analyzer',
    input: 'Input',
    output: 'Output',
    outputs: 'Outputs',
    outputNumber: 'Output {number}',
    addOutput: 'Add Output',
    deleteOutput: 'Delete Output {number}',
    speakerResponse: 'Speaker response',
    measurementPoint: 'Measurement point',
    noSpeakerIr: 'No speaker IR',
    selectPoint: 'Select a measurement point',
    refreshMeasurements: 'Refresh measurements',
    auto: 'Auto',
    measurementSettings: 'Measurement settings',
    signal: 'Signal',
    signalMls: 'MLS',
    signalTsp: 'TSP',
    signalImpulse: 'Unit Impulse',
    level: 'Level',
    sequenceLength: 'Sequence Length',
    stabilizationPeriods: 'Stabilization Periods',
    averagingPeriods: 'Averages',
    currentSupport: 'Current support: {samples} samples ({seconds} s)',
    stabilizationTime: 'Stabilization time: {seconds} s',
    totalStimulusTime: 'Total stimulus time: {seconds} s',
    recommendedSequenceLength: 'Recommended length: {samples} samples',
    recommendedStabilization: 'Recommended stabilization: {periods} periods ({seconds} s)',
    impulseCapture: 'Capture: {samples} samples ({seconds} s)',
    frequency: 'Frequency',
    phase: 'Phase',
    graphSelection: 'Graph',
    minimumGroupDelay: 'Min Group Delay',
    excessGroupDelay: 'Excess Group Delay',
    impulse: 'Impulse',
    smoothingOct: 'Smoothing (oct):',
    impulseRange: 'Impulse Range (ms):',
    graph: 'Pipeline response graph',
    channel: 'Channel {channel}',
    channelShort: 'Ch {channel}',
    total: 'Total'
});

function replaceTokens(text, params = {}) {
    return String(text).replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

function createElement(documentRef, tagName, className = '') {
    const element = documentRef.createElement(tagName);
    element.className = className;
    return element;
}

function svgElement(documentRef, tagName, attributes = {}) {
    const element = documentRef.createElementNS('http://www.w3.org/2000/svg', tagName);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    return element;
}

function createStrokeIcon(documentRef, pathData) {
    const icon = svgElement(documentRef, 'svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        draggable: 'false'
    });
    const path = svgElement(documentRef, 'path', { d: pathData });
    icon.appendChild(path);
    return { icon, path };
}

function finitePoint(point) {
    if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
    return { x: Number(point?.x), y: Number(point?.y) };
}

function curvePath(points, bounds) {
    let path = '';
    let drawing = false;
    for (const source of Array.isArray(points) ? points : []) {
        const point = finitePoint(source);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            drawing = false;
            continue;
        }
        const x = bounds.left + Math.min(1, Math.max(0, point.x)) * bounds.width;
        const y = bounds.top + point.y * bounds.height;
        path += `${drawing ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
        drawing = true;
    }
    return path;
}

function clampInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const integer = Math.round(number);
    return integer < minimum ? minimum : integer > maximum ? maximum : integer;
}

function clampNumber(value, minimum, maximum, fallback, decimals) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const clamped = number < minimum ? minimum : number > maximum ? maximum : number;
    const scale = 10 ** decimals;
    return Math.round(clamped * scale) / scale;
}

function normalizeDisplaySettings(settings = {}) {
    return {
        smoothingOct: clampNumber(settings.smoothingOct, 0.02, 1, DEFAULT_DISPLAY_SETTINGS.smoothingOct, 2),
        impulseRangeMs: clampNumber(settings.impulseRangeMs, 1, 50, DEFAULT_DISPLAY_SETTINGS.impulseRangeMs, 1)
    };
}

// MLS needs its 2^n-1 periods; TSP and Unit Impulse both work on power-of-two lengths.
function sequenceLengthsForSignal(signalType) {
    return signalType === 'mls'
        ? PIPELINE_ANALYZER_MLS_LENGTHS
        : PIPELINE_ANALYZER_TSP_LENGTHS;
}

function normalizeMeasurementSettings(settings = {}) {
    const signalType = SIGNAL_TYPES.includes(settings.signalType)
        ? settings.signalType
        : DEFAULT_MEASUREMENT_SETTINGS.signalType;
    const allowedLengths = sequenceLengthsForSignal(signalType);
    return {
        signalType,
        levelDb: clampInteger(settings.levelDb, -60, 0, DEFAULT_MEASUREMENT_SETTINGS.levelDb),
        sequenceLength: allowedLengths.includes(settings.sequenceLength)
            ? settings.sequenceLength
            : signalType === 'mls' ? DEFAULT_MEASUREMENT_SETTINGS.sequenceLength : 65536,
        stabilizationPeriods: clampInteger(
            settings.stabilizationPeriods,
            1,
            32,
            DEFAULT_MEASUREMENT_SETTINGS.stabilizationPeriods
        ),
        averagingPeriods: clampInteger(
            settings.averagingPeriods,
            1,
            8,
            DEFAULT_MEASUREMENT_SETTINGS.averagingPeriods
        )
    };
}

function sequenceLengthForSignal(sequenceLength, signalType) {
    if (signalType === 'mls') {
        if (PIPELINE_ANALYZER_MLS_LENGTHS.includes(sequenceLength)) return sequenceLength;
        if (PIPELINE_ANALYZER_TSP_LENGTHS.includes(sequenceLength)) return sequenceLength - 1;
        return DEFAULT_MEASUREMENT_SETTINGS.sequenceLength;
    }
    if (PIPELINE_ANALYZER_TSP_LENGTHS.includes(sequenceLength)) return sequenceLength;
    if (PIPELINE_ANALYZER_MLS_LENGTHS.includes(sequenceLength)) return sequenceLength + 1;
    return 65536;
}

function normalizeOutput(output = {}, fallbackChannel = 0) {
    return {
        channel: Number.isInteger(output.channel) ? output.channel : fallbackChannel,
        measurementId: typeof output.measurementId === 'string' && output.measurementId ? output.measurementId : null,
        pointId: typeof output.pointId === 'string' && output.pointId ? output.pointId : null
    };
}

function formatSeconds(value) {
    if (!Number.isFinite(value)) return '';
    if (value >= 10) return value.toFixed(1);
    if (value >= 1) return value.toFixed(2);
    return value.toFixed(3);
}

export class PipelineAnalyzerUI {
    constructor({
        documentRef = globalThis.document,
        windowRef = globalThis.window,
        onOpenChange = null,
        onConfigurationChange = null,
        onRefreshMeasurements = null
    } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.onOpenChange = onOpenChange;
        this.onConfigurationChange = onConfigurationChange;
        this.onRefreshMeasurements = onRefreshMeasurements;
        this.button = documentRef?.getElementById?.('pipelineAnalyzerButton') || null;
        this.panel = documentRef?.getElementById?.('pipelineAnalyzerPanel') || null;
        this.pipeline = documentRef?.getElementById?.('pipeline') || null;
        this.pipelineList = documentRef?.getElementById?.('pipelineList') || null;
        this.mainContainer = this.pipeline?.parentNode || documentRef?.querySelector?.('.main-container') || null;
        this.audioFormat = null;
        this.measurements = [];
        this.measurementStoreAvailable = true;
        this.result = null;
        this.measuring = false;
        this.graphSize = { ...DEFAULT_GRAPH_SIZE };
        this.curvePaths = new Map();
        this.legendValues = new Map();
        this.highlightedCurveId = null;
        this.cursorPosition = null;
        this.open = false;
        this.collapsed = false;
        this.updatingControls = false;
        this.outputElements = [];
        this.configuration = {
            inputChannel: 0,
            graphView: 'frequency',
            autoRefresh: true,
            outputs: [normalizeOutput()],
            measurementSettings: normalizeMeasurementSettings(),
            displaySettings: normalizeDisplaySettings()
        };
        this.handleToggle = () => this.setOpen(!this.open, { notify: true });
        this.handleResize = () => this.syncPlacement();

        if (!this.panel || !this.button) return;
        this.build();
        this.button.addEventListener('click', this.handleToggle);
        this.window?.addEventListener?.('resize', this.handleResize);
        this.layoutObserver = typeof this.window?.ResizeObserver === 'function' && this.mainContainer
            ? new this.window.ResizeObserver(() => this.syncPlacement())
            : null;
        this.layoutObserver?.observe?.(this.mainContainer);
        this.graphResizeObserver = typeof this.window?.ResizeObserver === 'function'
            ? new this.window.ResizeObserver(() => this.syncGraphSize())
            : null;
        this.graphResizeObserver?.observe?.(this.graphShell);
        this.graphResizeObserver?.observe?.(this.graphSvg);
        this.setOpen(!this.panel.hidden, { notify: false });
        this.syncPlacement();
    }

    t(key, fallback, params = {}) {
        return replaceTokens(fallback ?? FALLBACK_TEXT[key] ?? key, params);
    }

    build() {
        this.panel.replaceChildren();
        this.panel.classList.add('pipeline-analyzer-panel');
        this.panel.setAttribute('aria-labelledby', 'pipelineAnalyzerTitle');

        const header = createElement(this.document, 'div', 'pipeline-analyzer-header');
        this.title = createElement(this.document, 'h2', 'pipeline-analyzer-title');
        this.title.id = 'pipelineAnalyzerTitle';
        const actions = createElement(this.document, 'div', 'pipeline-analyzer-header-actions');
        this.collapseButton = createElement(this.document, 'button', 'pipeline-analyzer-icon-button pipeline-analyzer-collapse');
        this.collapseButton.type = 'button';
        this.collapseButton.setAttribute('aria-controls', 'pipelineAnalyzerBody');
        const collapseIcon = createStrokeIcon(this.document, 'M6 15l6-6 6 6');
        this.collapseIcon = collapseIcon.icon;
        this.collapseIconPath = collapseIcon.path;
        this.collapseButton.appendChild(collapseIcon.icon);
        this.collapseButton.addEventListener('click', () => this.setCollapsed(!this.collapsed));
        this.closeButton = createElement(this.document, 'button', 'pipeline-analyzer-icon-button pipeline-analyzer-close');
        this.closeButton.type = 'button';
        this.closeButton.appendChild(createStrokeIcon(this.document, 'M6 6l12 12M18 6L6 18').icon);
        this.closeButton.addEventListener('click', () => this.setOpen(false, { notify: true }));
        actions.append(this.collapseButton, this.closeButton);
        header.append(this.title, actions);

        this.body = createElement(this.document, 'div', 'pipeline-analyzer-body');
        this.body.id = 'pipelineAnalyzerBody';
        const controls = createElement(this.document, 'div', 'pipeline-analyzer-controls');

        const inputLabel = createElement(this.document, 'label', 'pipeline-analyzer-field');
        this.inputCaption = createElement(this.document, 'span');
        this.inputSelect = createElement(this.document, 'select');
        this.inputSelect.id = 'pipelineAnalyzerInput';
        this.inputSelect.addEventListener('change', () => {
            this.configuration.inputChannel = Number(this.inputSelect.value);
            this.emitConfigurationChange();
        });
        inputLabel.append(this.inputCaption, this.inputSelect);
        controls.appendChild(inputLabel);

        this.settingsDetails = createElement(this.document, 'details', 'pipeline-analyzer-settings');
        this.settingsSummary = createElement(this.document, 'summary');
        this.settingsBody = createElement(this.document, 'div', 'pipeline-analyzer-settings-body');
        this.signalSelect = this.buildSelectField('signal', this.settingsBody, value => {
            this.configuration.measurementSettings.sequenceLength = sequenceLengthForSignal(
                this.configuration.measurementSettings.sequenceLength,
                value
            );
            this.configuration.measurementSettings.signalType = value;
            this.renderMeasurementSettings();
            this.emitConfigurationChange();
        });
        this.signalSelect.append(
            this.createOption('mls', this.t('signalMls')),
            this.createOption('tsp', this.t('signalTsp')),
            this.createOption('impulse', this.t('signalImpulse'))
        );
        const levelField = this.buildNumberField('level', -60, 0, value => {
            this.configuration.measurementSettings.levelDb = clampInteger(value, -60, 0, -12);
            this.renderMeasurementSettings();
            this.emitConfigurationChange();
        }, 'dBFS');
        this.levelInput = levelField.input;
        this.settingsBody.appendChild(levelField.label);
        this.sequenceSelect = this.buildSelectField('sequenceLength', this.settingsBody, value => {
            this.configuration.measurementSettings.sequenceLength = Number(value);
            this.renderMeasurementSettings();
            this.emitConfigurationChange();
        });
        const stabilizationField = this.buildNumberField('stabilizationPeriods', 1, 32, value => {
            this.configuration.measurementSettings.stabilizationPeriods = clampInteger(value, 1, 32, 12);
            this.renderMeasurementSettings();
            this.emitConfigurationChange();
        });
        this.stabilizationInput = stabilizationField.input;
        this.settingsBody.appendChild(stabilizationField.label);
        const averagingField = this.buildNumberField('averagingPeriods', 1, 8, value => {
            this.configuration.measurementSettings.averagingPeriods = clampInteger(value, 1, 8, 2);
            this.renderMeasurementSettings();
            this.emitConfigurationChange();
        });
        this.averagingInput = averagingField.input;
        this.settingsBody.appendChild(averagingField.label);
        this.measurementTiming = createElement(this.document, 'div', 'pipeline-analyzer-timing');
        this.settingsBody.appendChild(this.measurementTiming);
        this.settingsDetails.append(this.settingsSummary, this.settingsBody);
        controls.appendChild(this.settingsDetails);

        this.routesSection = createElement(this.document, 'section', 'pipeline-analyzer-routes');
        const routesHeader = createElement(this.document, 'div', 'pipeline-analyzer-routes-header');
        this.routesTitle = createElement(this.document, 'h3');
        this.addOutputButton = createElement(this.document, 'button', 'pipeline-analyzer-secondary-button pipeline-analyzer-add-output');
        this.addOutputButton.type = 'button';
        this.addOutputLabel = createElement(this.document, 'span');
        this.addOutputButton.append(createStrokeIcon(this.document, 'M12 5.5v13M5.5 12h13').icon, this.addOutputLabel);
        this.addOutputButton.addEventListener('click', () => this.addOutput());
        routesHeader.append(this.routesTitle, this.addOutputButton);
        this.routesList = createElement(this.document, 'div', 'pipeline-analyzer-route-list');
        const measurementActions = createElement(this.document, 'div', 'pipeline-analyzer-measurement-actions');
        this.refreshButton = createElement(this.document, 'button', 'pipeline-analyzer-secondary-button');
        this.refreshButton.type = 'button';
        this.refreshButton.addEventListener('click', () => this.onRefreshMeasurements?.());
        this.autoRefreshLabel = createElement(this.document, 'label', 'pipeline-analyzer-auto-refresh');
        this.autoRefreshInput = createElement(this.document, 'input');
        this.autoRefreshInput.type = 'checkbox';
        this.autoRefreshInput.id = 'pipelineAnalyzerAutoRefresh';
        this.autoRefreshInput.addEventListener('change', () => {
            this.configuration.autoRefresh = this.autoRefreshInput.checked;
            this.emitConfigurationChange();
        });
        this.autoRefreshText = createElement(this.document, 'span');
        this.autoRefreshLabel.append(this.autoRefreshInput, this.autoRefreshText);
        measurementActions.append(this.refreshButton, this.autoRefreshLabel);
        this.routesSection.append(routesHeader, this.routesList, measurementActions);
        controls.appendChild(this.routesSection);
        this.body.appendChild(controls);

        this.graphSection = createElement(this.document, 'section', 'pipeline-analyzer-graph-section');
        this.graphShell = createElement(this.document, 'div', 'pipeline-analyzer-graph-shell');
        this.graphSvg = svgElement(this.document, 'svg', {
            class: 'pipeline-analyzer-graph',
            viewBox: `0 0 ${DEFAULT_GRAPH_SIZE.width} ${DEFAULT_GRAPH_SIZE.height}`,
            preserveAspectRatio: 'none',
            role: 'img'
        });
        this.hoverSvg = svgElement(this.document, 'svg', {
            class: 'pipeline-analyzer-hover-overlay',
            viewBox: `0 0 ${DEFAULT_GRAPH_SIZE.width} ${DEFAULT_GRAPH_SIZE.height}`,
            preserveAspectRatio: 'none',
            'aria-hidden': 'true'
        });
        this.graphSpinner = createElement(this.document, 'div', 'pipeline-analyzer-spinner-overlay');
        this.graphSpinner.hidden = true;
        this.graphSpinner.setAttribute('aria-hidden', 'true');
        this.graphSpinner.appendChild(createElement(
            this.document,
            'span',
            'loading-spinner pipeline-analyzer-spinner'
        ));
        this.graphShell.addEventListener('pointermove', event => this.updateCursorReadout(event));
        this.graphShell.addEventListener('pointerleave', () => this.clearCursorReadout());
        this.viewGroup = createElement(
            this.document,
            'div',
            'pipeline-analyzer-view-switcher parameter-row radio-group'
        );
        this.viewGroup.setAttribute('role', 'radiogroup');
        this.viewLabel = createElement(this.document, 'label');
        this.viewGroup.appendChild(this.viewLabel);
        this.viewInputs = new Map();
        for (const [index, value] of GRAPH_VIEWS.entries()) {
            const option = createElement(
                this.document,
                'span',
                'pipeline-analyzer-view-option'
            );
            const label = createElement(this.document, 'label');
            const input = createElement(this.document, 'input');
            input.type = 'radio';
            input.id = `pipelineAnalyzerGraphView${index}`;
            input.name = 'pipelineAnalyzerGraphView';
            input.value = value;
            input.setAttribute('autocomplete', 'off');
            label.htmlFor = input.id;
            input.addEventListener('change', () => {
                if (!input.checked) return;
                this.configuration.graphView = value;
                this.clearCursorReadout();
                this.renderDisplaySettings();
                this.renderGraph();
                this.emitConfigurationChange();
            });
            option.append(input, label);
            this.viewGroup.appendChild(option);
            this.viewInputs.set(value, { input, text: label });
        }
        this.legend = createElement(this.document, 'div', 'pipeline-analyzer-legend');
        this.cursorX = createElement(this.document, 'span', 'pipeline-analyzer-legend-cursor-x');
        this.legend.appendChild(this.cursorX);
        this.graphShell.append(
            this.graphSvg,
            this.hoverSvg,
            this.legend,
            this.graphSpinner
        );
        this.displayControls = {
            smoothingOct: this.buildDisplaySettingControl({
                key: 'smoothingOct',
                labelKey: 'smoothingOct',
                idPrefix: 'pipelineAnalyzerSmoothing',
                minimum: 0.02,
                maximum: 1,
                step: 0.01
            }),
            impulseRangeMs: this.buildDisplaySettingControl({
                key: 'impulseRangeMs',
                labelKey: 'impulseRange',
                idPrefix: 'pipelineAnalyzerImpulseRange',
                minimum: 1,
                maximum: 50,
                step: 0.1
            })
        };
        this.displayControl = createElement(this.document, 'div', 'pipeline-analyzer-display-controls');
        this.displayControl.append(
            this.displayControls.smoothingOct.row,
            this.displayControls.impulseRangeMs.row
        );
        this.graphSection.append(this.viewGroup, this.displayControl, this.graphShell);
        this.body.appendChild(this.graphSection);
        this.panel.append(header, this.body);
        this.refreshTexts();
        this.renderControls();
    }

    buildSelectField(key, parent, onChange) {
        const label = createElement(this.document, 'label', 'pipeline-analyzer-field');
        const caption = createElement(this.document, 'span');
        caption.dataset.textKey = key;
        const select = createElement(this.document, 'select');
        select.addEventListener('change', () => onChange(select.value));
        label.append(caption, select);
        parent.appendChild(label);
        return select;
    }

    buildNumberField(key, minimum, maximum, onChange, unit = '') {
        const label = createElement(this.document, 'label', 'pipeline-analyzer-field');
        const caption = createElement(this.document, 'span');
        caption.dataset.textKey = key;
        const control = createElement(this.document, 'span', 'pipeline-analyzer-number-control');
        const input = createElement(this.document, 'input');
        input.type = 'number';
        input.min = String(minimum);
        input.max = String(maximum);
        input.step = '1';
        input.addEventListener('change', () => onChange(input.value));
        control.appendChild(input);
        if (unit) {
            const suffix = createElement(this.document, 'span', 'pipeline-analyzer-unit');
            suffix.textContent = unit;
            control.appendChild(suffix);
        }
        label.append(caption, control);
        return { label, input };
    }

    buildDisplaySettingControl({ key, labelKey, idPrefix, minimum, maximum, step }) {
        const row = createElement(this.document, 'div', 'parameter-row pipeline-analyzer-display-control');
        row.setAttribute('role', 'group');
        const label = createElement(this.document, 'label', 'pipeline-analyzer-display-label');
        const range = createElement(this.document, 'input');
        const number = createElement(this.document, 'input');
        const rangeId = `${idPrefix}Range`;
        const numberId = `${idPrefix}Number`;
        label.htmlFor = rangeId;
        range.type = 'range';
        range.id = rangeId;
        range.name = rangeId;
        range.min = String(minimum);
        range.max = String(maximum);
        range.step = String(step);
        range.setAttribute('autocomplete', 'off');
        number.type = 'number';
        number.id = numberId;
        number.name = numberId;
        number.min = String(minimum);
        number.max = String(maximum);
        number.step = String(step);
        number.setAttribute('autocomplete', 'off');
        range.addEventListener('input', () => {
            this.updateDisplaySetting(key, range.value, { displayCommit: false });
        });
        range.addEventListener('change', () => {
            this.updateDisplaySetting(key, range.value, { displayCommit: true });
        });
        number.addEventListener('input', () => {
            const text = number.value.trim();
            if (!text || !Number.isFinite(Number(text))) return;
            this.updateDisplaySetting(key, text, { displayCommit: false, preserveNumberText: true });
        });
        number.addEventListener('blur', () => {
            this.updateDisplaySetting(key, number.value, { displayCommit: true });
        });
        number.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            number.blur();
        });
        row.append(label, range, number);
        return { key, labelKey, row, label, range, number };
    }

    createOption(value, text) {
        const option = createElement(this.document, 'option');
        option.value = String(value);
        option.textContent = text;
        return option;
    }

    refreshTexts() {
        if (!this.panel) return;
        this.title.textContent = this.t('title');
        this.updateToggleText();
        this.closeButton.title = this.t('close');
        this.closeButton.setAttribute('aria-label', this.t('close'));
        this.inputCaption.textContent = this.t('input');
        this.settingsSummary.textContent = this.t('measurementSettings');
        for (const caption of this.settingsBody.querySelectorAll?.('[data-text-key]') || []) {
            caption.textContent = this.t(caption.dataset.textKey);
        }
        const signalOptions = this.signalSelect.children;
        if (signalOptions[0]) signalOptions[0].textContent = this.t('signalMls');
        if (signalOptions[1]) signalOptions[1].textContent = this.t('signalTsp');
        if (signalOptions[2]) signalOptions[2].textContent = this.t('signalImpulse');
        this.routesTitle.textContent = this.t('outputs');
        this.addOutputLabel.textContent = this.t('addOutput');
        this.addOutputButton.setAttribute('aria-label', this.t('addOutput'));
        this.refreshButton.textContent = this.t('refreshMeasurements');
        this.autoRefreshText.textContent = this.t('auto');
        this.viewGroup.setAttribute('aria-label', this.t('graphView', 'Response graph'));
        this.viewLabel.textContent = `${this.t('graphSelection')}:`;
        const viewKeys = {
            frequency: 'frequency',
            phase: 'phase',
            minimumGroupDelay: 'minimumGroupDelay',
            excessGroupDelay: 'excessGroupDelay',
            impulse: 'impulse'
        };
        for (const [value, view] of this.viewInputs) view.text.textContent = this.t(viewKeys[value]);
        this.renderDisplaySettings();
        this.graphSvg.setAttribute('aria-label', this.t('graph'));
        this.legend.setAttribute('aria-label', this.t('curves', 'Response curves'));
        this.updateCollapseText();
        this.updateMeasurementAvailability();
        this.renderControls();
        this.renderGraph();
    }

    setOpen(open, { notify = false } = {}) {
        if (!this.panel || !this.button) return;
        const returnFocus = !open && this.panel.contains(this.document.activeElement);
        this.open = Boolean(open);
        this.panel.hidden = !this.open;
        this.button.classList.toggle('active', this.open);
        this.button.setAttribute('aria-expanded', String(this.open));
        this.button.setAttribute('aria-pressed', String(this.open));
        this.updateToggleText();
        if (this.open) this.syncPlacement();
        else if (returnFocus) this.button.focus({ preventScroll: true });
        if (notify) this.onOpenChange?.(this.open);
    }

    setCollapsed(collapsed) {
        this.collapsed = Boolean(collapsed);
        this.panel?.classList.toggle('is-collapsed', this.collapsed);
        if (this.body) this.body.hidden = this.collapsed;
        this.updateCollapseText();
    }

    updateCollapseText() {
        if (!this.collapseButton) return;
        const text = this.t(this.collapsed ? 'expand' : 'collapse');
        this.collapseIconPath?.setAttribute('d', this.collapsed ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6');
        this.collapseButton.title = text;
        this.collapseButton.setAttribute('aria-label', text);
        this.collapseButton.setAttribute('aria-expanded', String(!this.collapsed));
    }

    updateToggleText() {
        if (!this.button) return;
        const text = this.t(this.open ? 'close' : 'open');
        this.button.title = text;
        this.button.setAttribute('aria-label', text);
    }

    isNarrowLayout() {
        if (this.document?.body?.classList?.contains('layout-mobile')) return true;
        return Boolean(this.window?.matchMedia?.(NARROW_LAYOUT_QUERY)?.matches);
    }

    syncPlacement() {
        if (!this.panel || !this.pipeline || !this.mainContainer || !this.pipelineList) return;
        const focused = this.panel.contains(this.document.activeElement) ? this.document.activeElement : null;
        const narrow = this.isNarrowLayout();
        if (narrow) {
            if (this.panel.parentNode !== this.pipeline || this.panel.nextSibling !== this.pipelineList) {
                this.pipeline.insertBefore(this.panel, this.pipelineList);
            }
        } else if (this.panel.parentNode !== this.mainContainer || this.panel.previousSibling !== this.pipeline) {
            this.mainContainer.insertBefore(this.panel, this.pipeline.nextSibling);
        }
        this.panel.classList.toggle('is-inline', narrow);
        focused?.focus?.({ preventScroll: true });
        this.syncGraphSize();
    }

    syncGraphSize() {
        if (!this.graphSvg) return;
        const rectangle = this.graphSvg.getBoundingClientRect?.();
        const width = Number(this.graphSvg.clientWidth) || Number(rectangle?.width) || DEFAULT_GRAPH_SIZE.width;
        const height = Number(this.graphSvg.clientHeight) || Number(rectangle?.height) || DEFAULT_GRAPH_SIZE.height;
        if (!(width > 0 && height > 0)) return;
        if (this.graphSize.width === width && this.graphSize.height === height) return;
        this.graphSize = { width, height };
        const viewBox = `0 0 ${width} ${height}`;
        this.graphSvg.setAttribute('viewBox', viewBox);
        this.hoverSvg?.setAttribute?.('viewBox', viewBox);
        this.renderGraph();
    }

    setAudioFormat(format) {
        const sampleRate = Number(format?.sampleRate);
        const channelCount = Number(format?.channelCount);
        this.audioFormat = Number.isFinite(sampleRate) && sampleRate > 0 &&
            Number.isInteger(channelCount) && channelCount >= 1 && channelCount <= 16
            ? Object.freeze({ sampleRate, channelCount })
            : null;
        this.renderControls();
    }

    setConfiguration(configuration = {}) {
        const focusToken = this.captureControlFocus();
        const activeDisplayControl = Object.values(this.displayControls || {})
            .find(control => this.document?.activeElement === control.number);
        const displayNumberText = activeDisplayControl
            ? { key: activeDisplayControl.key, value: activeDisplayControl.number.value }
            : null;
        const outputs = Array.isArray(configuration.outputs) && configuration.outputs.length > 0
            ? configuration.outputs.slice(0, MAX_OUTPUT_SLOTS)
            : [{}];
        this.configuration = {
            inputChannel: Number.isInteger(configuration.inputChannel) ? configuration.inputChannel : 0,
            graphView: GRAPH_VIEWS.includes(configuration.graphView)
                ? configuration.graphView
                : configuration.graphView === 'groupDelay' ? 'minimumGroupDelay' : 'frequency',
            autoRefresh: configuration.autoRefresh !== false,
            outputs: outputs.map((output, index) => normalizeOutput(output, index)),
            measurementSettings: normalizeMeasurementSettings(configuration.measurementSettings),
            displaySettings: normalizeDisplaySettings(configuration.displaySettings)
        };
        this.renderControls();
        if (displayNumberText) {
            this.displayControls[displayNumberText.key].number.value = displayNumberText.value;
        }
        this.renderGraph();
        this.restoreControlFocus(focusToken);
    }

    getConfiguration() {
        return {
            inputChannel: this.configuration.inputChannel,
            graphView: this.configuration.graphView,
            autoRefresh: this.configuration.autoRefresh,
            outputs: this.configuration.outputs.map(output => ({ ...output })),
            measurementSettings: { ...this.configuration.measurementSettings },
            displaySettings: { ...this.configuration.displaySettings }
        };
    }

    emitConfigurationChange(meta = { displayCommit: true }) {
        if (!this.updatingControls) this.onConfigurationChange?.(this.getConfiguration(), meta);
    }

    setMeasurements(measurements) {
        this.measurements = (Array.isArray(measurements) ? measurements : []).map(measurement => ({
            id: String(measurement?.id || ''),
            name: String(measurement?.name || this.t('measurement', 'Measurement')),
            points: (Array.isArray(measurement?.points) ? measurement.points : [])
                .filter(point => point?.hasIr !== false)
                .map((point, index) => ({
                    id: String(point?.id ?? point?.pointId ?? ''),
                    label: String(point?.label || point?.name || this.t('point', 'Point {point}', { point: index + 1 }))
                }))
        })).filter(measurement => measurement.id);
        this.updateMeasurementAvailability();
        this.renderControls();
    }

    setMeasurementStoreAvailable(available) {
        this.measurementStoreAvailable = available !== false;
        this.updateMeasurementAvailability();
        this.renderControls();
    }

    updateMeasurementAvailability() {
        this.refreshButton.disabled = false;
    }

    captureControlFocus() {
        const active = this.document?.activeElement;
        if (!active) return null;
        const fixedControls = [
            ['input', this.inputSelect],
            ['signal', this.signalSelect],
            ['level', this.levelInput],
            ['sequence', this.sequenceSelect],
            ['stabilization', this.stabilizationInput],
            ['averaging', this.averagingInput],
            ['smoothingRange', this.displayControls?.smoothingOct?.range],
            ['smoothingNumber', this.displayControls?.smoothingOct?.number],
            ['impulseRange', this.displayControls?.impulseRangeMs?.range],
            ['impulseNumber', this.displayControls?.impulseRangeMs?.number],
            ['addOutput', this.addOutputButton],
            ['refresh', this.refreshButton],
            ['autoRefresh', this.autoRefreshInput]
        ];
        for (const [kind, control] of fixedControls) {
            if (active === control) return { kind };
        }
        for (let index = 0; index < this.outputElements.length; index += 1) {
            for (const field of ['output', 'measurement', 'point', 'deleteButton']) {
                if (active === this.outputElements[index]?.[field]) return { kind: 'output', index, field };
            }
        }
        return null;
    }

    restoreControlFocus(token) {
        if (!token) return;
        const fixedControls = {
            input: this.inputSelect,
            signal: this.signalSelect,
            level: this.levelInput,
            sequence: this.sequenceSelect,
            stabilization: this.stabilizationInput,
            averaging: this.averagingInput,
            smoothingRange: this.displayControls?.smoothingOct?.range,
            smoothingNumber: this.displayControls?.smoothingOct?.number,
            impulseRange: this.displayControls?.impulseRangeMs?.range,
            impulseNumber: this.displayControls?.impulseRangeMs?.number,
            addOutput: this.addOutputButton,
            refresh: this.refreshButton,
            autoRefresh: this.autoRefreshInput
        };
        const control = token.kind === 'output'
            ? this.outputElements[Math.min(token.index, this.outputElements.length - 1)]?.[token.field]
            : fixedControls[token.kind];
        control?.focus?.({ preventScroll: true });
    }

    renderControls() {
        if (!this.inputSelect || this.updatingControls) return;
        this.updatingControls = true;
        try {
            this.renderInput();
            this.renderMeasurementSettings();
            this.renderOutputs();
            for (const [view, controls] of this.viewInputs) {
                controls.input.checked = view === this.configuration.graphView;
            }
            this.autoRefreshInput.checked = this.configuration.autoRefresh;
            this.renderDisplaySettings();
        } finally {
            this.updatingControls = false;
        }
    }

    renderDisplaySettings() {
        if (!this.displayControl) return;
        const view = this.configuration.graphView;
        const enabled = {
            smoothingOct: view === 'frequency' || view === 'phase' ||
                view === 'minimumGroupDelay' || view === 'excessGroupDelay',
            impulseRangeMs: view === 'impulse'
        };
        for (const control of Object.values(this.displayControls)) {
            const label = this.t(control.labelKey);
            const active = enabled[control.key];
            control.label.textContent = label;
            control.row.setAttribute('aria-label', label);
            control.row.classList.toggle('is-disabled', !active);
            for (const input of [control.range, control.number]) {
                input.value = String(this.configuration.displaySettings[control.key]);
                input.disabled = !active;
                input.setAttribute('aria-disabled', String(!active));
                input.setAttribute('aria-label', label);
            }
            this.syncRangeFill(control.range);
        }
    }

    updateDisplaySetting(key, value, { displayCommit, preserveNumberText = false }) {
        const control = this.displayControls[key];
        if (!control || control.range.disabled) return;
        const text = String(value).trim();
        const numeric = text ? Number(text) : Number.NaN;
        const nextValue = Number.isFinite(numeric)
            ? numeric
            : this.configuration.displaySettings[key];
        this.configuration.displaySettings = normalizeDisplaySettings({
            ...this.configuration.displaySettings,
            [key]: nextValue
        });
        if (preserveNumberText) {
            control.range.value = String(this.configuration.displaySettings[key]);
            this.syncRangeFill(control.range);
        } else {
            this.renderDisplaySettings();
        }
        this.emitConfigurationChange({ displayCommit: displayCommit === true });
    }

    syncRangeFill(input) {
        const minimum = Number(input?.min);
        const maximum = Number(input?.max);
        const value = Number(input?.value);
        const percent = maximum > minimum && Number.isFinite(value)
            ? ((value - minimum) / (maximum - minimum)) * 100
            : 0;
        const clamped = percent < 0 ? 0 : (percent > 100 ? 100 : percent);
        input?.style?.setProperty?.('--et-range-fill', `${clamped}%`);
    }

    renderInput() {
        this.inputSelect.replaceChildren();
        if (!this.audioFormat) {
            const unavailable = this.createOption('', '—');
            unavailable.disabled = true;
            this.inputSelect.appendChild(unavailable);
            this.inputSelect.disabled = true;
            return;
        }
        for (let channel = 0; channel < this.audioFormat.channelCount; channel += 1) {
            this.inputSelect.appendChild(this.createOption(channel, this.t('channel', undefined, { channel: channel + 1 })));
        }
        this.inputSelect.value = String(this.configuration.inputChannel);
        this.inputSelect.disabled = false;
    }

    renderMeasurementSettings() {
        const settings = this.configuration.measurementSettings;
        this.signalSelect.value = settings.signalType;
        this.levelInput.value = String(settings.levelDb);
        this.sequenceSelect.replaceChildren(...sequenceLengthsForSignal(settings.signalType).map(length =>
            this.createOption(length, String(length))
        ));
        this.sequenceSelect.value = String(settings.sequenceLength);
        this.stabilizationInput.value = String(settings.stabilizationPeriods);
        this.averagingInput.value = String(settings.averagingPeriods);
        const impulse = settings.signalType === 'impulse';
        this.sequenceSelect.disabled = false;
        this.sequenceSelect.setAttribute('aria-disabled', 'false');
        for (const control of [this.stabilizationInput, this.averagingInput]) {
            control.disabled = impulse;
            control.setAttribute('aria-disabled', String(impulse));
        }

        this.measurementTiming.replaceChildren();
        if (impulse) {
            if (this.audioFormat) {
                const row = createElement(this.document, 'div');
                row.textContent = this.t('impulseCapture', undefined, {
                    samples: settings.sequenceLength,
                    seconds: formatSeconds(settings.sequenceLength / this.audioFormat.sampleRate)
                });
                this.measurementTiming.appendChild(row);
            }
        } else if (this.audioFormat) {
            const sampleRate = this.audioFormat.sampleRate;
            const periodSeconds = settings.sequenceLength / sampleRate;
            const rows = [
                this.t('currentSupport', undefined, {
                    samples: settings.sequenceLength,
                    seconds: formatSeconds(periodSeconds)
                }),
                this.t('stabilizationTime', undefined, {
                    seconds: formatSeconds(settings.stabilizationPeriods * periodSeconds)
                }),
                this.t('totalStimulusTime', undefined, {
                    seconds: formatSeconds((settings.stabilizationPeriods + settings.averagingPeriods) * periodSeconds)
                })
            ];
            const metadata = this.currentMeasurementMetadata();
            if (Number.isInteger(metadata?.recommendedSequenceLength)) {
                rows.push(this.t('recommendedSequenceLength', undefined, { samples: metadata.recommendedSequenceLength }));
            }
            const recommended = Number(metadata?.recommendedStabilizationPeriods);
            if (Number.isFinite(recommended)) {
                rows.push(this.t('recommendedStabilization', undefined, {
                    periods: recommended,
                    seconds: formatSeconds(recommended * periodSeconds)
                }));
            }
            for (const text of rows) {
                const row = createElement(this.document, 'div');
                row.textContent = text;
                this.measurementTiming.appendChild(row);
            }
        }
    }

    currentMeasurementMetadata() {
        const resultSettings = this.result?.measurementSettings;
        if (!resultSettings) return null;
        const current = this.configuration.measurementSettings;
        for (const key of Object.keys(DEFAULT_MEASUREMENT_SETTINGS)) {
            if (resultSettings[key] !== current[key]) return null;
        }
        return this.result?.measurement || null;
    }

    renderOutputs() {
        this.routesList.replaceChildren();
        this.outputElements = [];
        const outputs = this.audioFormat ? this.configuration.outputs : this.configuration.outputs.slice(0, 1);
        const selectedChannels = new Set(outputs.map(output => output.channel));
        for (let index = 0; index < outputs.length; index += 1) {
            this.outputElements.push(this.buildOutputRow(outputs[index], index, selectedChannels, outputs.length));
        }
        const limit = this.audioFormat ? Math.min(MAX_OUTPUT_SLOTS, this.audioFormat.channelCount) : 0;
        this.addOutputButton.disabled = outputs.length >= limit;
    }

    buildOutputRow(outputState, index, selectedChannels, outputCount) {
        const row = createElement(this.document, 'fieldset', 'pipeline-analyzer-route');
        const legend = createElement(this.document, 'legend');
        legend.textContent = this.t('outputNumber', undefined, { number: index + 1 });
        row.appendChild(legend);

        const outputLabel = createElement(this.document, 'label', 'pipeline-analyzer-field');
        const outputCaption = createElement(this.document, 'span');
        outputCaption.textContent = this.t('output');
        const output = createElement(this.document, 'select');
        if (!this.audioFormat) {
            const unavailable = this.createOption('', '—');
            unavailable.disabled = true;
            output.appendChild(unavailable);
            output.disabled = true;
        } else {
            for (let channel = 0; channel < this.audioFormat.channelCount; channel += 1) {
                const option = this.createOption(channel, this.t('channel', undefined, { channel: channel + 1 }));
                option.disabled = channel !== outputState.channel && selectedChannels.has(channel);
                output.appendChild(option);
            }
            output.value = String(outputState.channel);
            output.addEventListener('change', () => {
                this.configuration.outputs[index].channel = Number(output.value);
                this.renderControls();
                this.outputElements[index]?.output?.focus?.({ preventScroll: true });
                this.emitConfigurationChange();
            });
        }
        outputLabel.append(outputCaption, output);

        const measurementLabel = createElement(this.document, 'label', 'pipeline-analyzer-field');
        const measurementCaption = createElement(this.document, 'span');
        measurementCaption.textContent = this.t('speakerResponse');
        const measurement = createElement(this.document, 'select');
        measurement.appendChild(this.createOption('', this.t('noSpeakerIr')));
        for (const saved of this.measurements) {
            if (saved.points.length === 0) continue;
            measurement.appendChild(this.createOption(saved.id, saved.name));
        }
        if (outputState.measurementId && !this.measurements.some(item => item.id === outputState.measurementId)) {
            const missing = this.createOption(outputState.measurementId, '—');
            missing.disabled = true;
            measurement.appendChild(missing);
        }
        measurement.value = outputState.measurementId || '';
        measurement.disabled = !this.audioFormat || (!this.measurementStoreAvailable && !outputState.measurementId);
        measurement.addEventListener('change', () => {
            const current = this.configuration.outputs[index];
            current.measurementId = measurement.value || null;
            current.pointId = null;
            this.renderControls();
            this.outputElements[index]?.measurement?.focus?.({ preventScroll: true });
            this.emitConfigurationChange();
        });
        measurementLabel.append(measurementCaption, measurement);

        const pointLabel = createElement(this.document, 'label', 'pipeline-analyzer-field');
        const pointCaption = createElement(this.document, 'span');
        pointCaption.textContent = this.t('measurementPoint');
        const point = createElement(this.document, 'select');
        point.appendChild(this.createOption('', this.t('selectPoint')));
        const saved = this.measurements.find(item => item.id === outputState.measurementId);
        for (const savedPoint of saved?.points || []) point.appendChild(this.createOption(savedPoint.id, savedPoint.label));
        if (outputState.pointId && !saved?.points.some(item => item.id === outputState.pointId)) {
            const missing = this.createOption(outputState.pointId, '—');
            missing.disabled = true;
            point.appendChild(missing);
        }
        point.value = outputState.pointId || '';
        point.disabled = !this.audioFormat || !this.measurementStoreAvailable || !outputState.measurementId;
        point.addEventListener('change', () => {
            this.configuration.outputs[index].pointId = point.value || null;
            this.emitConfigurationChange();
        });
        pointLabel.append(pointCaption, point);
        row.append(outputLabel, measurementLabel, pointLabel);

        let deleteButton = null;
        if (outputCount > 1) {
            deleteButton = createElement(this.document, 'button', 'pipeline-analyzer-icon-button pipeline-analyzer-delete-output');
            deleteButton.type = 'button';
            const deleteText = this.t('deleteOutput', undefined, { number: index + 1 });
            deleteButton.appendChild(createStrokeIcon(this.document, 'M6 6l12 12M18 6L6 18').icon);
            deleteButton.title = deleteText;
            deleteButton.setAttribute('aria-label', deleteText);
            deleteButton.addEventListener('click', () => this.deleteOutput(index));
            row.appendChild(deleteButton);
        }
        this.routesList.appendChild(row);
        return { row, output, measurement, point, deleteButton };
    }

    addOutput() {
        if (!this.audioFormat) return;
        const limit = Math.min(MAX_OUTPUT_SLOTS, this.audioFormat.channelCount);
        if (this.configuration.outputs.length >= limit) return;
        const used = new Set(this.configuration.outputs.map(output => output.channel));
        let channel = 0;
        while (used.has(channel) && channel < this.audioFormat.channelCount) channel += 1;
        if (channel >= this.audioFormat.channelCount) return;
        this.configuration.outputs.push(normalizeOutput({ channel }));
        this.renderControls();
        this.emitConfigurationChange();
        this.outputElements.at(-1)?.output?.focus?.({ preventScroll: true });
    }

    deleteOutput(index) {
        if (this.configuration.outputs.length <= 1) return;
        this.configuration.outputs.splice(index, 1);
        this.renderControls();
        this.emitConfigurationChange();
        const nextIndex = Math.min(index, this.outputElements.length - 1);
        this.outputElements[nextIndex]?.output?.focus?.({ preventScroll: true });
    }

    setResult(result, { stale = false } = {}) {
        this.result = result || null;
        this.setMeasuring(stale);
        this.clearCursorReadout();
        this.renderMeasurementSettings();
        this.renderGraph();
    }

    setMeasuring(measuring) {
        this.measuring = measuring === true;
        if (this.graphSpinner) this.graphSpinner.hidden = !this.measuring;
        this.graphSvg?.setAttribute?.('aria-busy', String(this.measuring));
    }

    currentView() {
        return this.result?.views?.[this.configuration.graphView] || null;
    }

    clearCursorReadout({ preservePosition = false } = {}) {
        if (!preservePosition) this.cursorPosition = null;
        if (this.cursorX) this.cursorX.textContent = '';
        for (const value of this.legendValues.values()) value.textContent = '';
        this.hoverSvg?.replaceChildren?.();
    }

    updateCursorReadout(event) {
        const rectangle = this.graphSvg?.getBoundingClientRect?.();
        if (!rectangle?.width || !rectangle?.height) return;
        const normalizedX = (Number(event?.clientX) - rectangle.left) / rectangle.width;
        if (!(Number.isFinite(normalizedX) && normalizedX >= 0 && normalizedX <= 1)) {
            this.clearCursorReadout();
            return;
        }
        this.cursorPosition = normalizedX;
        this.renderCursorReadout(normalizedX);
    }

    renderCursorReadout(normalizedX) {
        const curves = Array.isArray(this.currentView()?.curves) ? this.currentView().curves : [];
        const viewName = this.configuration.graphView;
        this.clearCursorReadout({ preservePosition: true });
        let cursorXValue = null;
        for (const curve of curves) {
            if (this.highlightedCurveId === 'before' && String(curve.id) === 'after') continue;
            const points = Array.isArray(curve.points) ? curve.points : [];
            let left = null;
            let right = null;
            for (const point of points) {
                if (!(Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
                    Number.isFinite(point?.xValue) && Number.isFinite(point?.yValue))) {
                    left = null;
                    continue;
                }
                if (point.x === normalizedX) {
                    left = point;
                    right = point;
                    break;
                }
                if (point.x > normalizedX) {
                    if (left) right = point;
                    break;
                }
                left = point;
            }
            if (!left || !right) continue;
            const span = right.x - left.x;
            const fraction = span > 0 ? (normalizedX - left.x) / span : 0;
            const y = left.y + (right.y - left.y) * fraction;
            const xValue = left.xValue + (right.xValue - left.xValue) * fraction;
            const yValue = left.yValue + (right.yValue - left.yValue) * fraction;
            if (!(Number.isFinite(y) && Number.isFinite(xValue) && Number.isFinite(yValue))) continue;
            if (cursorXValue === null) cursorXValue = xValue;
            const value = this.legendValues.get(String(curve.id));
            if (value) value.textContent = this.formatCursorY(viewName, yValue);
            this.hoverSvg.appendChild(svgElement(this.document, 'circle', {
                class: 'pipeline-analyzer-cursor-marker',
                cx: normalizedX * this.graphSize.width,
                cy: y * this.graphSize.height,
                r: 3.5,
                fill: curve.color
            }));
        }
        if (this.cursorX) this.cursorX.textContent = this.formatCursorX(viewName, cursorXValue);
    }

    applyLegendHighlight() {
        for (const [id, path] of this.curvePaths) {
            path.classList.remove('is-highlighted', 'is-hidden');
            if (id === 'after' && this.highlightedCurveId === 'before') path.classList.add('is-hidden');
        }
        if (!this.highlightedCurveId) return;
        const path = this.curvePaths.get(this.highlightedCurveId);
        if (!path) return;
        if (!path.dataset.originalIndex) {
            path.dataset.originalIndex = String(Array.from(this.graphSvg.children).indexOf(path));
        }
        path.classList.add('is-highlighted');
        this.graphSvg.appendChild(path);
    }

    clearLegendHighlight() {
        const highlightedId = this.highlightedCurveId;
        this.highlightedCurveId = null;
        const path = this.curvePaths.get(highlightedId);
        if (path) {
            path.classList.remove('is-highlighted');
            const originalIndex = Number(path.dataset.originalIndex);
            if (Number.isInteger(originalIndex) && originalIndex >= 0) {
                const sibling = this.graphSvg.children[originalIndex] || null;
                if (sibling !== path) this.graphSvg.insertBefore(path, sibling);
            }
            delete path.dataset.originalIndex;
        }
        this.curvePaths.get('after')?.classList.remove('is-hidden');
        if (Number.isFinite(this.cursorPosition)) this.renderCursorReadout(this.cursorPosition);
        else this.clearCursorReadout();
    }

    formatCursorX(viewName, value) {
        if (!Number.isFinite(value)) return '';
        if (viewName === 'impulse') return `${value.toFixed(2)} ms`;
        return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Math.round(value)} Hz`;
    }

    formatCursorY(viewName, value) {
        if (!Number.isFinite(value)) return '';
        if (viewName === 'frequency') return `${value.toFixed(1)} dB`;
        if (viewName === 'phase') return `${value.toFixed(0)}°`;
        if (viewName === 'minimumGroupDelay' || viewName === 'excessGroupDelay') {
            return `${value.toFixed(2)} ms`;
        }
        return value.toFixed(2);
    }

    renderGraph() {
        if (!this.graphSvg) return;
        const bounds = { left: 0, top: 0, ...this.graphSize };
        const view = this.currentView();
        const curves = Array.isArray(view?.curves) ? view.curves : [];
        this.graphSvg.replaceChildren();
        this.hoverSvg?.replaceChildren?.();
        this.legend.replaceChildren(this.cursorX);
        this.curvePaths.clear();
        this.legendValues.clear();

        const grid = svgElement(this.document, 'g', { class: 'pipeline-analyzer-grid', 'aria-hidden': 'true' });
        for (const tick of Array.isArray(view?.xTicks) ? view.xTicks : []) {
            const position = Number(tick.position);
            if (!(Number.isFinite(position) && position >= 0 && position <= 1)) continue;
            const x = bounds.left + position * bounds.width;
            grid.appendChild(svgElement(this.document, 'line', {
                x1: x,
                y1: bounds.top,
                x2: x,
                y2: bounds.top + bounds.height
            }));
        }
        for (const tick of Array.isArray(view?.yTicks) ? view.yTicks : []) {
            const position = Number(tick.position);
            if (!(Number.isFinite(position) && position >= 0 && position <= 1)) continue;
            const y = bounds.top + position * bounds.height;
            grid.appendChild(svgElement(this.document, 'line', {
                x1: bounds.left,
                y1: y,
                x2: bounds.left + bounds.width,
                y2: y
            }));
        }
        this.graphSvg.appendChild(grid);

        const axes = svgElement(this.document, 'g', { class: 'pipeline-analyzer-axes', 'aria-hidden': 'true' });
        for (const tick of Array.isArray(view?.xTicks) ? view.xTicks : []) {
            const position = Number(tick.position);
            const label = svgElement(this.document, 'text', {
                x: bounds.left + position * bounds.width,
                y: bounds.top + bounds.height - 4,
                'text-anchor': position <= 0 ? 'start' : position >= 1 ? 'end' : 'middle'
            });
            label.textContent = String(tick.label ?? '');
            axes.appendChild(label);
        }
        for (const tick of Array.isArray(view?.yTicks) ? view.yTicks : []) {
            const position = Number(tick.position);
            const tickY = bounds.top + position * bounds.height;
            const label = svgElement(this.document, 'text', {
                x: this.configuration.graphView === 'frequency'
                    ? bounds.left + bounds.width * 0.02
                    : bounds.left + 2,
                y: position <= 0
                    ? bounds.top + 5
                    : position >= 1 ? bounds.top + bounds.height - 5 : tickY,
                'text-anchor': 'start',
                'dominant-baseline': 'middle'
            });
            label.textContent = String(tick.label ?? '');
            axes.appendChild(label);
        }
        this.graphSvg.appendChild(axes);

        for (const curve of curves) {
            const id = String(curve.id ?? curve.label ?? 'curve');
            const pathData = curvePath(curve.points, bounds);
            if (pathData) {
                const path = svgElement(this.document, 'path', {
                    class: 'pipeline-analyzer-curve',
                    d: pathData,
                    stroke: curve.color || '#00ff00',
                    opacity: Number.isFinite(curve.opacity) ? curve.opacity : 1
                });
                this.graphSvg.appendChild(path);
                this.curvePaths.set(id, path);
            }
            const row = createElement(this.document, 'div', 'pipeline-analyzer-legend-row');
            row.dataset.curveId = id;
            row.style.color = curve.color || '#00ff00';
            row.style.opacity = String(Number.isFinite(curve.opacity) ? curve.opacity : 1);
            const swatch = createElement(this.document, 'span', 'pipeline-analyzer-legend-swatch');
            swatch.style.borderColor = curve.color || '#00ff00';
            swatch.setAttribute('aria-hidden', 'true');
            const label = createElement(this.document, 'span', 'pipeline-analyzer-legend-label');
            label.textContent = curve.label || id;
            const value = createElement(this.document, 'span', 'pipeline-analyzer-legend-value');
            this.legendValues.set(id, value);
            row.append(swatch, label, value);
            row.addEventListener('mouseenter', () => {
                this.highlightedCurveId = id;
                this.applyLegendHighlight();
                if (Number.isFinite(this.cursorPosition)) this.renderCursorReadout(this.cursorPosition);
                else this.clearCursorReadout({ preservePosition: true });
            });
            row.addEventListener('mouseleave', () => this.clearLegendHighlight());
            this.legend.appendChild(row);
        }

        this.applyLegendHighlight();
        if (Number.isFinite(this.cursorPosition)) this.renderCursorReadout(this.cursorPosition);
        else this.clearCursorReadout();
    }

    dispose() {
        this.button?.removeEventListener?.('click', this.handleToggle);
        this.window?.removeEventListener?.('resize', this.handleResize);
        this.layoutObserver?.disconnect?.();
        this.layoutObserver = null;
        this.graphResizeObserver?.disconnect?.();
        this.graphResizeObserver = null;
        this.panel?.replaceChildren?.();
    }
}

export { MAX_OUTPUT_SLOTS };
