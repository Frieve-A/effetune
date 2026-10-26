const SPATIAL_MAPPER_PASS_THROUGH_PROCESSOR = 'return data;';
const SPATIAL_MAPPER_MATRIX_SIZE = 16;
const SPATIAL_MAPPER_MATRIX_LENGTH = SPATIAL_MAPPER_MATRIX_SIZE * SPATIAL_MAPPER_MATRIX_SIZE;
const SPATIAL_MAPPER_BAND_OPTIONS = Object.freeze(['8', '16', '24', '32', '48']);
const SPATIAL_MAPPER_COMPONENTS = Object.freeze([
    Object.freeze({ key: 'dm', label: 'Direct' }),
    Object.freeze({ key: 'fm', label: 'Diffuse' }),
    Object.freeze({ key: 'rm', label: 'Residual' })
]);

function createSpatialMapperMatrix(entries = [], identity = false) {
    const matrix = new Array(SPATIAL_MAPPER_MATRIX_LENGTH).fill(0);
    if (identity) {
        for (let channel = 0; channel < SPATIAL_MAPPER_MATRIX_SIZE; channel++) {
            matrix[channel * SPATIAL_MAPPER_MATRIX_SIZE + channel] = 1;
        }
    }
    for (const { out, in: input, gain } of entries) {
        matrix[out * SPATIAL_MAPPER_MATRIX_SIZE + input] = gain;
    }
    return Object.freeze(matrix);
}

const SPATIAL_MAPPER_IDENTITY_MATRIX = createSpatialMapperMatrix([], true);
const SPATIAL_MAPPER_ZERO_MATRIX = createSpatialMapperMatrix();

function createSpatialMapperPreset(id, label, values = {}) {
    return Object.freeze({
        id,
        label,
        params: Object.freeze({
            ic: 2,
            bd: '24',
            dr: 50,
            sp: 50,
            de: 50,
            ph: 50,
            ts: 50,
            ep: true,
            dm: SPATIAL_MAPPER_IDENTITY_MATRIX,
            fm: SPATIAL_MAPPER_IDENTITY_MATRIX,
            rm: SPATIAL_MAPPER_IDENTITY_MATRIX,
            ...values
        })
    });
}

const SPATIAL_MAPPER_SYSTEM_PRESETS = Object.freeze([
    createSpatialMapperPreset('transparent', 'Transparent'),
    createSpatialMapperPreset('stereo-enhance', 'Stereo Enhance', {
        dr: 25,
        sp: 65,
        de: 25,
        rm: createSpatialMapperMatrix([
            { out: 0, in: 0, gain: 1 },
            { out: 0, in: 1, gain: -0.4 },
            { out: 1, in: 0, gain: -0.4 },
            { out: 1, in: 1, gain: 1 }
        ])
    }),
    createSpatialMapperPreset('center-extract', 'Center Extract', {
        dr: 90,
        sp: 85,
        dm: createSpatialMapperMatrix([
            { out: 2, in: 0, gain: 0.7 },
            { out: 2, in: 1, gain: 0.7 }
        ])
    }),
    createSpatialMapperPreset('upmix-5-1', '5.1 Upmix', {
        dr: 70,
        sp: 75,
        de: 75,
        dm: createSpatialMapperMatrix([
            { out: 0, in: 0, gain: 1 },
            { out: 1, in: 1, gain: 1 },
            { out: 2, in: 0, gain: 0.7 },
            { out: 2, in: 1, gain: 0.7 }
        ]),
        fm: createSpatialMapperMatrix([
            { out: 4, in: 0, gain: 1 },
            { out: 5, in: 1, gain: 1 }
        ]),
        rm: createSpatialMapperMatrix([
            { out: 0, in: 0, gain: 1 },
            { out: 1, in: 1, gain: 1 }
        ])
    }),
    createSpatialMapperPreset('upmix-7-1-4', '7.1.4 Upmix', {
        dr: 70,
        sp: 75,
        de: 80,
        dm: createSpatialMapperMatrix([
            { out: 0, in: 0, gain: 1 },
            { out: 1, in: 1, gain: 1 },
            { out: 2, in: 0, gain: 0.7 },
            { out: 2, in: 1, gain: 0.7 }
        ]),
        fm: createSpatialMapperMatrix([
            { out: 4, in: 0, gain: 1 },
            { out: 5, in: 1, gain: 1 },
            { out: 6, in: 0, gain: 0.7 },
            { out: 7, in: 1, gain: 0.7 },
            { out: 8, in: 0, gain: 0.5 },
            { out: 9, in: 1, gain: 0.5 },
            { out: 10, in: 0, gain: 0.5 },
            { out: 11, in: 1, gain: 0.5 }
        ]),
        rm: createSpatialMapperMatrix([
            { out: 0, in: 0, gain: 1 },
            { out: 1, in: 1, gain: 1 }
        ])
    }),
    createSpatialMapperPreset('ambience-extract', 'Ambience Extract', {
        dr: 25,
        sp: 85,
        de: 90,
        dm: SPATIAL_MAPPER_ZERO_MATRIX,
        rm: SPATIAL_MAPPER_ZERO_MATRIX
    })
]);

class SpatialMapperPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    static getSystemPresetGroups() {
        return [{
            label: '',
            presets: SPATIAL_MAPPER_SYSTEM_PRESETS.map(preset => ({ ...preset }))
        }];
    }

    constructor() {
        super('Spatial Mapper', 'Separates and routes direct, diffuse, and residual spatial components');
        this.temporalCapability = 'reset-on-resume';
        this.ic = 2;
        this.bd = '24';
        this.dr = 50;
        this.sp = 50;
        this.de = 50;
        this.ph = 50;
        this.ts = 50;
        this.ep = true;
        this.dm = Array.from(SPATIAL_MAPPER_IDENTITY_MATRIX);
        this.fm = Array.from(SPATIAL_MAPPER_IDENTITY_MATRIX);
        this.rm = Array.from(SPATIAL_MAPPER_IDENTITY_MATRIX);
        this._selectedComponentKey = 'dm';
        this.registerProcessor(SPATIAL_MAPPER_PASS_THROUGH_PROCESSOR);
    }

    _normalizeMatrix(value) {
        if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
        const matrix = new Array(SPATIAL_MAPPER_MATRIX_LENGTH).fill(0);
        const count = value.length < SPATIAL_MAPPER_MATRIX_LENGTH ?
            value.length : SPATIAL_MAPPER_MATRIX_LENGTH;
        for (let index = 0; index < count; index++) {
            matrix[index] = this.parseFiniteNumber(value[index], -1, 1, 0);
        }
        return matrix;
    }

    setParameters(params = {}) {
        if (!params || typeof params !== 'object') return;
        if (params.ic !== undefined) {
            this.ic = Math.round(this.parseFiniteNumber(params.ic, 1, 16, this.ic));
        }
        if (params.bd !== undefined) {
            const bands = String(params.bd);
            if (SPATIAL_MAPPER_BAND_OPTIONS.includes(bands)) this.bd = bands;
        }
        if (params.dr !== undefined) this.dr = this.parseFiniteNumber(params.dr, 0, 100, this.dr);
        if (params.sp !== undefined) this.sp = this.parseFiniteNumber(params.sp, 0, 100, this.sp);
        if (params.de !== undefined) this.de = this.parseFiniteNumber(params.de, 0, 100, this.de);
        if (params.ph !== undefined) this.ph = this.parseFiniteNumber(params.ph, 0, 100, this.ph);
        if (params.ts !== undefined) this.ts = this.parseFiniteNumber(params.ts, 0, 100, this.ts);
        if (typeof params.ep === 'boolean') this.ep = params.ep;
        for (const key of ['dm', 'fm', 'rm']) {
            if (params[key] === undefined) continue;
            const matrix = this._normalizeMatrix(params[key]);
            if (matrix) this[key] = matrix;
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this.updateParameters();
        this._syncRoutingUI();
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            ic: this.ic,
            bd: this.bd,
            dr: this.dr,
            sp: this.sp,
            de: this.de,
            ph: this.ph,
            ts: this.ts,
            ep: this.ep,
            dm: this.dm.slice(),
            fm: this.fm.slice(),
            rm: this.rm.slice()
        };
    }

    // Width of the bus this plugin actually receives: only 'All' passes the whole
    // pipeline, a pair selection passes two channels and a single selection one.
    _routedChannelCount() {
        const count = Math.round(Number(this.getChannelCountForUI()));
        const pipeline = Number.isFinite(count) ? Math.min(Math.max(count, 1), SPATIAL_MAPPER_MATRIX_SIZE) : 2;
        if (this.channel === 'A') return pipeline;
        if (this.channel === null || this.channel === undefined ||
            /^(34|56|78|910|1112|1314|1516)$/.test(String(this.channel))) {
            return Math.min(pipeline, 2);
        }
        return 1;
    }

    _displayInputChannelCount() {
        return Math.min(this.ic, this._routedChannelCount());
    }

    onChannelSelectionChanged() {
        this._syncRoutingUI();
    }

    _setSelectedComponent(key) {
        if (!SPATIAL_MAPPER_COMPONENTS.some(component => component.key === key)) return;
        this._selectedComponentKey = key;
        this._syncRoutingUI();
    }

    _setMatrixCell(output, input, value) {
        const key = this._selectedComponentKey;
        const matrix = this[key].slice();
        matrix[output * SPATIAL_MAPPER_MATRIX_SIZE + input] =
            this.parseFiniteNumber(value, -1, 1, matrix[output * SPATIAL_MAPPER_MATRIX_SIZE + input]);
        this.setParameters({ [key]: matrix });
    }

    _syncRoutingUI() {
        if (!this._routingTableWrapper) return;
        const outputCount = this._routedChannelCount();
        if (this._routingInputCount !== this._displayInputChannelCount() ||
            this._routingOutputCount !== outputCount) {
            this._buildRoutingTable();
            return;
        }
        for (const component of SPATIAL_MAPPER_COMPONENTS) {
            const selected = component.key === this._selectedComponentKey;
            const tab = this._componentTabs?.get(component.key);
            if (!tab) continue;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = 0;
        }
        const matrix = this[this._selectedComponentKey];
        for (let output = 0; output < this._routingControls.length; output++) {
            for (let input = 0; input < this._routingControls[output].length; input++) {
                const { slider, numberInput } = this._routingControls[output][input];
                const value = matrix[output * SPATIAL_MAPPER_MATRIX_SIZE + input];
                if (!this.isHeldByUser(slider) && !this.isHeldByUser(numberInput)) {
                    slider.value = String(value);
                    numberInput.value = value.toFixed(2);
                    window.uiManager?.refreshRangeFillStyling?.(slider);
                }
                numberInput.classList.toggle('negative', value < 0);
            }
        }
    }

    _buildRoutingTable() {
        const inputCount = this._displayInputChannelCount();
        const outputCount = this._routedChannelCount();
        const table = document.createElement('table');
        table.className = 'spatial-mapper-routing-table';
        const head = document.createElement('thead');
        const body = document.createElement('tbody');
        const titleRow = document.createElement('tr');
        const corner = document.createElement('th');
        corner.className = 'spatial-mapper-sticky-corner';
        corner.textContent = 'Output';
        titleRow.appendChild(corner);
        const inputTitle = document.createElement('th');
        inputTitle.colSpan = inputCount;
        inputTitle.textContent = 'Input';
        titleRow.appendChild(inputTitle);
        head.appendChild(titleRow);

        const channelRow = document.createElement('tr');
        const channelCorner = document.createElement('th');
        channelCorner.className = 'spatial-mapper-sticky-corner';
        channelCorner.textContent = '';
        channelRow.appendChild(channelCorner);
        for (let input = 0; input < inputCount; input++) {
            const header = document.createElement('th');
            header.textContent = `Ch ${input + 1}`;
            channelRow.appendChild(header);
        }
        head.appendChild(channelRow);

        this._routingControls = Array.from({ length: outputCount }, () => []);
        const matrix = this[this._selectedComponentKey];
        for (let output = 0; output < outputCount; output++) {
            const row = document.createElement('tr');
            const header = document.createElement('th');
            header.className = 'spatial-mapper-sticky-row';
            header.textContent = `Ch ${output + 1}`;
            row.appendChild(header);
            for (let input = 0; input < inputCount; input++) {
                const cell = document.createElement('td');
                const index = output * SPATIAL_MAPPER_MATRIX_SIZE + input;
                const label = `Output ${output + 1} from Input ${input + 1}`;
                const control = this.createParameterControl(label, -1, 1, 0.01, matrix[index], value => {
                    this._setMatrixCell(output, input, value);
                });
                control.classList.toggle('spatial-mapper-routing-control', true);
                const [, slider, numberInput] = control.children;
                slider.setAttribute('aria-label', label);
                numberInput.setAttribute('aria-label', label);
                control.replaceChildren(slider, numberInput);
                cell.appendChild(control);
                row.appendChild(cell);
                this._routingControls[output].push({ slider, numberInput });
            }
            body.appendChild(row);
        }
        table.append(head, body);
        this._routingTableWrapper.replaceChildren(table);
        this._routingInputCount = inputCount;
        this._routingOutputCount = outputCount;
        this._syncRoutingUI();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui spatial-mapper-ui';
        const controls = document.createElement('section');
        controls.className = 'spatial-mapper-controls';
        controls.appendChild(this.createParameterControl(
            'Input Channels', 1, 16, 1, this.ic, value => this.setParameters({ ic: value }), 'ch', 'ic'));
        controls.appendChild(this.createSelectControl(
            'Analysis Bands', SPATIAL_MAPPER_BAND_OPTIONS.map(value => ({ value, label: value })),
            this.bd, value => this.setParameters({ bd: value }), 'bd'));
        controls.appendChild(this.createParameterControl(
            'Directness', 0, 100, 1, this.dr, value => this.setParameters({ dr: value }), '%', 'dr'));
        controls.appendChild(this.createParameterControl(
            'Separation', 0, 100, 1, this.sp, value => this.setParameters({ sp: value }), '%', 'sp'));
        controls.appendChild(this.createParameterControl(
            'Diffuse Extraction', 0, 100, 1, this.de, value => this.setParameters({ de: value }), '%', 'de'));
        controls.appendChild(this.createParameterControl(
            'Phase Sensitivity', 0, 100, 1, this.ph, value => this.setParameters({ ph: value }), '%', 'ph'));
        controls.appendChild(this.createParameterControl(
            'Temporal Smoothing', 0, 100, 1, this.ts, value => this.setParameters({ ts: value }), '%', 'ts'));
        controls.appendChild(this.createCheckboxControl(
            'Energy Preservation', this.ep, value => this.setParameters({ ep: value }), 'ep'));
        container.appendChild(controls);

        const routing = document.createElement('section');
        routing.className = 'spatial-mapper-routing';
        const heading = document.createElement('h3');
        heading.textContent = 'Component Routing';
        const tabs = document.createElement('div');
        tabs.className = 'spatial-mapper-tabs';
        tabs.setAttribute('role', 'tablist');
        this._componentTabs = new Map();
        for (const component of SPATIAL_MAPPER_COMPONENTS) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'spatial-mapper-tab';
            tab.setAttribute('data-parameter-control', 'view');
            tab.textContent = component.label;
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', () => this._setSelectedComponent(component.key));
            tabs.appendChild(tab);
            this._componentTabs.set(component.key, tab);
        }
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'spatial-mapper-routing-wrapper';
        this._routingTableWrapper = tableWrapper;
        routing.append(heading, tabs, tableWrapper);
        container.appendChild(routing);
        this._buildRoutingTable();
        this.registerUIRefresh(() => this._syncRoutingUI());
        return container;
    }
}

window.SpatialMapperPlugin = SpatialMapperPlugin;
