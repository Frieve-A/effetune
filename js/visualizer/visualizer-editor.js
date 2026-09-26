import { ASPECTS, ITEM_TYPES, VISUAL_TYPES, GRADIENT_DIRECTION_TYPES, MAX_ITEMS, MAX_EFFECTS, EFFECT_CATALOG, FONT_FAMILIES, THEME_COLOR_ROLES, DEFAULT_THEME_COLORS, DEFAULT_TRACE_COLOR, createItem, normalizeEffect, paletteModesForType } from './visualizer-model.js';
import { GRADIENT_PRESETS } from './visualizer-palette-presets.js';

const ACTION_ICONS = {
    up: ['move-up-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M12 8l5.4 8.8H6.6z"/></svg>'],
    down: ['move-down-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M12 16l5.4-8.8H6.6z"/></svg>'],
    front: ['bring-to-front-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5"/><rect x="9" y="9" width="10" height="10" rx="1.5" fill="currentColor"/></svg>'],
    back: ['send-to-back-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M6.5 5h7A1.5 1.5 0 0 1 15 6.5V9h-4.5A1.5 1.5 0 0 0 9 10.5V15H6.5A1.5 1.5 0 0 1 5 13.5v-7A1.5 1.5 0 0 1 6.5 5z" fill="currentColor"/><rect x="9" y="9" width="10" height="10" rx="1.5"/></svg>'],
    delete: ['delete-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>']
};
const STYLE_ICONS = {
    flipX: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M8 6 2 12l6 6V6zm8 0 6 6-6 6V6z"/></svg>',
    flipY: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M6 8l6-6 6 6H6zm0 8 6 6 6-6H6z"/></svg>',
    bold: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z"/></svg>',
    italic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6M4 20h6M17 4 7 20"/></svg>'
};
const THEME_COLOR_LABELS = {
    'graph-bg-deep': 'Graph base', 'graph-base-soft': 'Soft graph fill', 'graph-grid-subtle': 'Fine grid',
    'graph-grid-soft': 'Soft grid', 'graph-grid-strong': 'Major grid', 'graph-label': 'Graph labels',
    'text-primary': 'Axis titles', 'graph-trace-tertiary': 'Meter ticks'
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiNoteName = midi => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

export class VisualizerEditor {
    constructor(view) {
        this.view = view;
        this.navigation = document.createElement('aside');
        this.navigation.className = 'visualizer-editor visualizer-editor-navigation';
        this.navigation.hidden = true;
        this.navigationContent = document.createElement('div');
        this.navigation.appendChild(this.navigationContent);
        this.root = document.createElement('aside');
        this.root.className = 'visualizer-editor visualizer-editor-inspector plugin-parameter-ui';
        this.root.hidden = true;
        this.selection = null;
        this.grid = localStorage.getItem('effetune_visualizer_grid') === 'true';
        this.itemBounds = document.createElement('div');
        this.itemBounds.className = 'visualizer-item-bounds';
        this.itemBounds.hidden = true;
        this.itemBounds.setAttribute('aria-hidden', 'true');
        view.stage.appendChild(this.itemBounds);
        this.overlay = document.createElement('div');
        this.overlay.className = 'visualizer-selection';
        this.overlay.hidden = true;
        for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
            const handle = document.createElement('span');
            handle.className = `visualizer-handle ${corner}`;
            handle.dataset.corner = corner;
            this.overlay.appendChild(handle);
        }
        view.stage.appendChild(this.overlay);
        view.stage.addEventListener('pointerdown', event => this.startDrag(event));
        view.stage.addEventListener('pointermove', event => this.drag(event));
        view.stage.addEventListener('pointerup', () => this.endDrag());
        view.stage.addEventListener('pointercancel', () => this.endDrag());
        view.stage.tabIndex = -1;
        view.stage.addEventListener('keydown', event => this.onStageKeyDown(event));
    }

    t(key, fallback) { return this.view.t(key, fallback); }
    setOpen(open) {
        this.open = open;
        this.navigation.hidden = !open;
        this.root.hidden = !open;
        this.view.stage.classList.toggle('editing', open);
        this.view.stage.classList.toggle('show-grid', open && this.grid);
        this.view.stage.tabIndex = open ? 0 : -1;
        this.view.root.classList.toggle('is-editing', open);
        if (open) this.render();
        this.updateSelection();
    }
    changed(structural = false) { this.view.changed(); if (structural) this.render(); this.updateSelection(); }
    button(parent, label, action) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label;
        button.addEventListener('click', action); parent.appendChild(button); return button;
    }
    iconButton(parent, kind, label, action) {
        const button = this.button(parent, '', action);
        const [className, svg] = ACTION_ICONS[kind];
        button.className = className;
        button.innerHTML = svg;
        button.title = label;
        button.setAttribute('aria-label', label);
        return button;
    }
    field(parent, label, kind, value, action, options = {}) {
        const inInspector = this.root.contains(parent);
        if (kind === 'radio') {
            const group = document.createElement('div');
            group.className = `visualizer-radio${inInspector ? ' parameter-row radio-group' : ''}`;
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', label);
            const title = document.createElement('span');
            title.className = 'visualizer-radio-title'; title.textContent = label;
            group.appendChild(title);
            const choices = document.createElement('div');
            choices.className = 'visualizer-radio-options'; group.appendChild(choices);
            const name = `visualizer-${crypto.randomUUID()}`;
            for (const entry of options.values) {
                const row = document.createElement('span'), input = document.createElement('input');
                row.className = 'radio-option';
                input.type = 'radio'; input.name = name; input.value = Array.isArray(entry) ? entry[0] : entry;
                input.id = `${name}-${choices.childElementCount}`;
                input.checked = input.value === value; input.disabled = options.disabled === true;
                input.addEventListener('change', () => { if (input.checked) action(input.value); });
                const caption = document.createElement('label');
                caption.htmlFor = input.id; caption.textContent = Array.isArray(entry) ? entry[1] : entry;
                row.append(input, caption); choices.appendChild(row);
            }
            parent.appendChild(group);
            return group;
        }
        const row = document.createElement('div');
        row.className = `visualizer-field${inInspector ? ' parameter-row' : ''}${kind === 'checkbox' ? ' checkbox-row' : ''}`;
        const name = document.createElement('label'); name.textContent = label;
        const input = document.createElement(kind === 'select' ? 'select' : 'input');
        input.id = `visualizer-${crypto.randomUUID()}`; name.htmlFor = input.id;
        if (kind === 'select') {
            for (const entry of options.values) {
                const option = document.createElement('option');
                option.value = Array.isArray(entry) ? entry[0] : entry;
                option.textContent = Array.isArray(entry) ? entry[1] : entry;
                input.appendChild(option);
            }
        } else input.type = kind;
        for (const key of ['min', 'max', 'step', 'accept', 'disabled']) if (options[key] !== undefined) input[key] = options[key];
        if (kind === 'checkbox') input.checked = value; else input.value = value;
        const output = kind === 'range' && options.format ? document.createElement('output') : null;
        if (output) output.textContent = options.format(value);
        input.addEventListener(kind === 'range' || kind === 'color' ? 'input' : 'change', () => {
            const next = kind === 'checkbox' ? input.checked : kind === 'range' || kind === 'number' ? Number(input.value) : kind === 'file' ? input.files[0] : input.value;
            if (output) output.textContent = options.format(next);
            action(next);
        });
        row.append(name, input); if (output) row.appendChild(output); parent.appendChild(row); return input;
    }
    group(parent, title) {
        const group = document.createElement('section');
        group.className = 'visualizer-section';
        const heading = document.createElement(parent.classList?.contains('visualizer-section') ? 'h4' : 'h3');
        heading.className = 'visualizer-section-title'; heading.textContent = title;
        group.appendChild(heading); parent.appendChild(group); return group;
    }

    styleToggles(parent, item) {
        const label = this.t('visualizer.styleControls', 'Style');
        const row = document.createElement('div');
        row.className = 'visualizer-field parameter-row visualizer-style-row';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', label);
        const caption = document.createElement('span');
        caption.textContent = label;
        const controls = document.createElement('div');
        controls.className = 'visualizer-style-toggles';
        const textItem = ['title', 'album', 'artist'].includes(item.type);
        for (const key of textItem ? ['flipX', 'flipY', 'bold', 'italic'] : ['flipX', 'flipY']) {
            const target = key === 'bold' || key === 'italic' ? item.style : item;
            const name = this.t(key === 'bold' || key === 'italic' ? `visualizer.style.${key}` : `visualizer.${key}`,
                { flipX: 'Flip horizontally', flipY: 'Flip vertically', bold: 'Bold', italic: 'Italic' }[key]);
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.style = key;
            button.innerHTML = STYLE_ICONS[key];
            button.title = name;
            button.setAttribute('aria-label', name);
            button.setAttribute('aria-pressed', String(!!target[key]));
            button.addEventListener('click', () => {
                target[key] = !target[key];
                button.setAttribute('aria-pressed', String(target[key]));
                this.changed();
            });
            controls.appendChild(button);
        }
        row.append(caption, controls);
        parent.appendChild(row);
    }

    render() {
        this.navigationContent.replaceChildren();
        this.root.replaceChildren();
        const layout = this.view.layout;
        const scene = this.group(this.navigationContent, this.t('visualizer.layout', 'Layout'));
        this.field(scene, this.t('visualizer.aspect', 'Aspect ratio'), 'select', layout.aspect, value => { layout.aspect = value; this.changed(); }, { values: ASPECTS });
        this.field(scene, this.t('visualizer.grid', 'Snap to grid'), 'checkbox', this.grid, value => { this.grid = value; localStorage.setItem('effetune_visualizer_grid', String(value)); this.view.stage.classList.toggle('show-grid', value); });
        const bg = this.group(this.navigationContent, this.t('visualizer.background', 'Background'));
        this.field(bg, this.t('visualizer.color', 'Color'), 'color', layout.background.color, value => { layout.background.color = value; this.changed(); });
        this.field(bg, this.t('visualizer.image', 'Image'), 'file', '', file => this.importImage(file), { accept: 'image/png,image/jpeg,image/webp' });
        this.button(bg, this.t('visualizer.removeImage', 'Remove image'), () => { layout.background.image = null; this.changed(); });
        const theme = this.group(bg, this.t('visualizer.themeColors', 'Theme colors'));
        theme.classList.add('visualizer-theme-colors');
        for (const role of THEME_COLOR_ROLES) {
            const color = layout.background.themeColors?.[role] ?? DEFAULT_THEME_COLORS[role];
            this.field(theme, this.t(`visualizer.themeColor.${role}`, THEME_COLOR_LABELS[role]), 'color',
                color.slice(0, 7), value => {
                    layout.background.themeColors ||= {};
                    layout.background.themeColors[role] = value + color.slice(7);
                    this.changed();
                });
        }
        this.button(theme, this.t('visualizer.resetThemeColors', 'Use default colors'), () => {
            delete layout.background.themeColors;
            this.changed(true);
        });
        const addRow = document.createElement('div');
        addRow.className = 'visualizer-select-action-row visualizer-navigation-add-row'; scene.appendChild(addRow);
        const add = this.field(addRow, this.t('visualizer.item', 'Item'), 'select', 'spectrum', () => {}, { values: ITEM_TYPES.map(type => [type, this.t(`visualizer.type.${type}`, type)]) });
        const addItem = this.button(addRow, this.t('visualizer.add', 'Add'), () => {
            if (layout.items.length >= MAX_ITEMS) return;
            const item = createItem(add.value);
            if (item.type !== 'artwork') item.palette.color = DEFAULT_TRACE_COLOR;
            layout.items.push(item); this.selection = item.id; this.changed(true);
        });
        addItem.disabled = layout.items.length >= MAX_ITEMS;
        const items = this.group(this.navigationContent, this.t('visualizer.items', 'Items'));
        const list = document.createElement('div');
        list.className = 'visualizer-item-list';
        list.setAttribute('role', 'group');
        list.setAttribute('aria-label', this.t('visualizer.items', 'Items'));
        items.appendChild(list);
        for (const [id, label] of [['', this.t('visualizer.background', 'Background')],
            ...layout.items.map((value, index) => [value.id, `${index + 1}. ${this.t(`visualizer.type.${value.type}`, value.type)}`])]) {
            const option = this.button(list, label, () => {
                this.selection = id || null;
                this.render(); this.updateSelection();
                if (id) this.view.stage.focus({ preventScroll: true });
            });
            option.className = 'player-playlist-item';
            option.classList.toggle('active', (this.selection || '') === id);
            option.setAttribute('aria-pressed', String((this.selection || '') === id));
        }
        const item = layout.items.find(value => value.id === this.selection);
        const header = document.createElement('div');
        header.className = 'visualizer-item-header';
        this.root.appendChild(header);
        const heading = document.createElement('h2');
        heading.className = 'visualizer-item-name plugin-name';
        heading.textContent = item
            ? `${layout.items.indexOf(item) + 1}. ${this.t(`visualizer.type.${item.type}`, item.type)}`
            : this.t('visualizer.background', 'Background');
        heading.title = heading.textContent;
        header.appendChild(heading);
        if (!item) {
            this.effects(this.root, layout.background.effects, 'background');
            return;
        }
        const order = document.createElement('div'); order.className = 'visualizer-editor-actions'; header.appendChild(order);
        const index = layout.items.indexOf(item);
        const move = target => {
            layout.items.splice(index, 1); layout.items.splice(target, 0, item); this.changed(true);
        };
        const up = this.iconButton(order, 'up', this.t('visualizer.moveUp', 'Move up'), () => move(index - 1));
        up.disabled = index === 0;
        const down = this.iconButton(order, 'down', this.t('visualizer.moveDown', 'Move down'), () => move(index + 1));
        down.disabled = index === layout.items.length - 1;
        const front = this.iconButton(order, 'front', this.t('visualizer.front', 'Bring to front'), () => move(layout.items.length - 1));
        front.disabled = down.disabled;
        const back = this.iconButton(order, 'back', this.t('visualizer.back', 'Send to back'), () => move(0));
        back.disabled = up.disabled;
        this.iconButton(order, 'delete', this.t('visualizer.delete', 'Delete'), () => this.deleteSelected());
        const properties = this.group(this.root, this.t('visualizer.properties', 'Properties'));
        if (VISUAL_TYPES.includes(item.type)) {
            const channels = [['', '1–2'], ['L', 'L'], ['R', 'R'], ...Array.from({ length: 7 }, (_, i) => [`${i * 2 + 3}${i * 2 + 4}`, `${i * 2 + 3}–${i * 2 + 4}`]), ...Array.from({ length: 16 }, (_, i) => [`${i + 1}`, `${i + 1}`])];
            this.field(properties, this.t('visualizer.channel', 'Channel'), 'select', item.channel || '', value => { item.channel = value || null; this.changed(); }, { values: channels });
        }
        this.styleToggles(properties, item);
        if (VISUAL_TYPES.includes(item.type)) this.parameters(properties, item);
        const styles = item.type === 'artwork' ? { rounded: true } : VISUAL_TYPES.includes(item.type) ? {} : {
            fontFamily: FONT_FAMILIES.map(([family]) => family), fontSize: 36,
            align: ['left', 'center', 'right']
        };
        const fontLabels = Object.fromEntries(FONT_FAMILIES);
        for (const [key, values] of Object.entries(styles)) {
            this.field(properties, this.t(`visualizer.style.${key}`, key === 'bold' ? 'Bold' : key === 'italic' ? 'Italic' : key), Array.isArray(values) ? 'select' : typeof values === 'boolean' ? 'checkbox' : 'range', item.style[key], value => { item.style[key] = value; this.changed(); }, Array.isArray(values) ? { values: values.map(value => [value, this.t(`visualizer.value.${value}`, fontLabels[value] || value)]) } : { min: 8, max: 200, step: 1 });
        }
        if (item.type !== 'artwork') this.palette(this.root, item.palette, item.type);
        this.effects(this.root, item.effects, 'item', item.type);
    }

    parameters(parent, item) {
        const params = item.params;
        const analogMeter = item.type === 'analog-meter';
        const update = (key, value) => {
            params[key] = key === 'pt' || (item.type === 'chroma' && key === 'dm') ||
                (analogMeter && ['sc', 'ln', 'ls'].includes(key)) ? Number(value) : value;
            // Mode and PPM Scale decide which Analog Meter parameters apply, so rebuild the panel.
            this.changed(analogMeter && (key === 'md' || key === 'sc'));
        };
        const select = (key, label, values) => this.field(parent, this.t(`visualizer.param.${key}`, label), 'select', params[key], value => update(key, value), { values });
        const orientation = () => select('orientation', 'Orientation', [
            ['horizontal', this.t('visualizer.paramChoice.Horizontal', 'Horizontal')],
            ['vertical', this.t('visualizer.paramChoice.Vertical', 'Vertical')]
        ]);
        const range = (key, label, min, max, step, format) => this.field(parent, this.t(`visualizer.param.${key}`, label), 'range', params[key], value => update(key, value), { min, max, step, format });
        const check = (key, label) => this.field(parent, this.t(`visualizer.param.${key}`, label), 'checkbox', params[key], value => update(key, value));
        if (item.type === 'spectrum' || item.type === 'spectrogram') {
            range('dr', 'DB Range', -144, -48, 1, value => `${value} dB`);
            select('pt', 'Points', Array.from({ length: 7 }, (_, index) => [String(index + 8), String(2 ** (index + 8))]));
            select('sc', 'Frequency Scale', [['log', this.t('visualizer.paramChoice.log', 'Log')], ['log-hq', this.t('visualizer.paramChoice.log-hq', 'Log (HQ)')], ['linear', this.t('visualizer.paramChoice.linear', 'Linear')]]);
            check('kb', 'Keyboard');
            if (item.type === 'spectrum') {
                let quantize;
                this.field(parent, this.t('visualizer.param.dm', 'Display'), 'select', params.dm, value => {
                    update('dm', value);
                    quantize.disabled = value !== 'bar';
                }, { values: [['line', this.t('visualizer.paramChoice.line', 'Line')],
                    ['bar', this.t('visualizer.paramChoice.bar', 'Bar')]] });
                quantize = this.field(parent, this.t('visualizer.param.quantizeBars', 'Quantize'),
                    'checkbox', params.quantizeBars, value => update('quantizeBars', value),
                    { disabled: params.dm !== 'bar' });
                orientation();
            }
        } else if (item.type === 'stereo') {
            range('wt', 'Window', 0.01, 1, 0.001, value => `${Math.round(value * 1000)} ms`);
            check('showCorrelation', 'Correlation');
            check('showBalance', 'Balance');
        } else if (item.type === 'oscilloscope') {
            range('dt', 'Display Time', 0.001, 0.1, 0.001, value => `${Math.round(value * 1000)} ms`);
            select('tm', 'Trigger Mode', ['Auto', 'Normal', 'Off'].map(value =>
                [value, this.t(`visualizer.paramChoice.${value}`, value)]));
            range('tl', 'Trigger Level', -1, 1, 0.01, value => value.toFixed(2));
            select('te', 'Trigger Edge', ['Rising', 'Falling'].map(value =>
                [value, this.t(`visualizer.paramChoice.${value}`, value)]));
            range('ho', 'Holdoff', 0.0001, 0.01, 0.0001, value => `${(value * 1000).toFixed(1)} ms`);
            range('dl', 'Display Level', -96, 0, 1, value => `${value} dB`);
            range('vo', 'Vertical Offset', -1, 1, 0.01, value => value.toFixed(2));
        } else if (item.type === 'level-meter') {
            range('dr', 'DB Range', -144, -48, 1, value => `${value} dB`);
            orientation();
            check('showLevelValues', 'Level values');
        } else if (item.type === 'notes') {
            select('pr', 'Pitch Resolution', [['Semitone', this.t('visualizer.paramChoice.Semitone', '1/12 Octave')], ['High', this.t('visualizer.paramChoice.High', 'High (1/60 Octave)')]]);
            select('ly', 'Layout', [['Horizontal', this.t('visualizer.paramChoice.Horizontal', 'Horizontal')], ['Vertical', this.t('visualizer.paramChoice.Vertical', 'Vertical')]]);
            check('vl', 'Volume');
            range('ts', 'Time Span', 1, 10, 1, value => `${value} s`);
            const noteSliders = {};
            for (const [key, label] of [['mn', 'Lowest note'], ['mx', 'Highest note']]) {
                noteSliders[key] = this.field(parent, this.t(`visualizer.param.${key}`, label), 'range', params[key], value => {
                    const midi = Math.max(21, Math.min(108, Math.round(value)));
                    params[key] = midi;
                    const otherKey = key === 'mn' ? 'mx' : 'mn';
                    if (key === 'mn' ? params.mx < midi : params.mn > midi) {
                        params[otherKey] = midi;
                        noteSliders[otherKey].value = midi;
                        noteSliders[otherKey].nextElementSibling.textContent = midiNoteName(midi);
                        window.uiManager?.refreshRangeFillStyling?.(noteSliders[otherKey]);
                    }
                    this.changed();
                }, { min: 21, max: 108, step: 1, format: midiNoteName });
            }
            range('nc', 'Regular Note Limit', 1, 16, 1, value => String(value));
            check('kb', 'Keyboard');
        } else if (item.type === 'chroma') {
            select('dm', 'Display', [['0', this.t('visualizer.value.dots', 'Dots')], ['1', this.t('visualizer.value.fill', 'Fill')]]);
            const octaveSliders = {};
            for (const [key, label, min, max] of [['lo', 'Lowest Octave', 1, 8], ['hi', 'Highest Octave', 1, 9]]) {
                octaveSliders[key] = this.field(parent, this.t(`visualizer.param.${key}`, label), 'range', params[key], value => {
                    params[key] = value;
                    const otherKey = key === 'lo' ? 'hi' : 'lo';
                    if (key === 'lo' ? params.hi < value : params.lo > value) {
                        params[otherKey] = value;
                        octaveSliders[otherKey].value = value;
                        octaveSliders[otherKey].nextElementSibling.textContent = String(value);
                        window.uiManager?.refreshRangeFillStyling?.(octaveSliders[otherKey]);
                    }
                    this.changed();
                }, { min, max, step: 1, format: value => String(value) });
            }
            range('ft', 'Frequency Tilt', -6, 6, 0.5, value => `${value} dB/oct`);
            range('lr', 'Level Range', 6, 96, 1, value => `${value} dB`);
            range('df', 'Display Floor', -120, -24, 1, value => `${value} dB`);
        } else if (item.type === 'phase') {
            select('ax', 'X Axis', [['phase', this.t('visualizer.paramChoice.phase', 'Phase')],
                ['balance', this.t('visualizer.paramChoice.balance', 'Balance')]]);
            range('dr', 'DB Range', -96, -24, 6, value => `${value} dB`);
            range('ml', 'Reference Floor', -120, -24, 1, value => `${value} dB`);
            range('pe', 'Persistence', 0.1, 2, 0.1, value => `${value.toFixed(1)} s`);
        } else if (analogMeter) {
            // Before the effect script loads every parameter is shown; the next rebuild hides inactive ones.
            const active = key => window.AnalogMeterPlugin?.isParameterActive(key, params) ?? true;
            const choices = labels => labels.map((label, index) => [String(index),
                this.t(`visualizer.paramChoice.${label.replace(/ /g, '-').replace('+', '')}`, label)]);
            select('md', 'Mode', ['VU', 'PPM', 'RMS', 'Sample Peak', 'True Peak', 'Loudness'].map(value =>
                [value, this.t(`visualizer.paramChoice.${value.replace(/ /g, '-')}`, value)]));
            if (active('it')) range('it', 'Integration', 0.05, 3, 0.01, value => `${value.toFixed(2)} s`);
            if (active('at')) range('at', 'Attack', 1, 20, 0.1, value => `${value.toFixed(1)} ms`);
            if (active('rt')) range('rt', 'Release', 0.1, 5, 0.01, value => `${value.toFixed(2)} s`);
            if (active('rl')) range('rl', 'Reference', -30, 0, 1, value => `${value} dBFS`);
            if (active('rg')) range('rg', 'Range', 20, 60, 1, value => `${value} dB`);
            if (active('sc')) this.field(parent, this.t('visualizer.param.meterScale', 'PPM Scale'), 'select',
                params.sc, value => update('sc', value), { values: choices(['DIN', 'BBC', 'dB']) });
            if (active('ph')) range('ph', 'Peak Hold', 0, 10, 0.1, value => `${value.toFixed(1)} s`);
            if (active('ln')) select('ln', 'Needle', choices(['Momentary', 'Short-term']));
            if (active('tg')) range('tg', 'Target', -36, -10, 1, value => `${value} LUFS`);
            if (active('ls')) select('ls', 'Scale', choices(['EBU +9', 'EBU +18']));
        }
        if (['spectrum', 'spectrogram', 'stereo'].includes(item.type)) range('gainDb', 'Input gain', -24, 24, 1, value => `${value > 0 ? '+' : ''}${value} dB`);
        check('showAxes', 'Axes and grid');
        check('showAxisNumbers', 'Axis labels and numbers');
    }

    palette(parent, palette, itemType = null) {
        const group = this.group(parent, this.t('visualizer.palette', 'Palette'));
        const octave = itemType === 'notes' || itemType === 'chroma';
        if (itemType) {
            const labels = {
                solid: this.t('visualizer.solid', 'Solid'),
                gradient: this.t('visualizer.gradient', 'Gradient'),
                'note-colors': this.t('visualizer.noteColors', 'Note Colors'),
                heatmap: this.t('visualizer.heatmap', 'Heatmap')
            };
            const modes = paletteModesForType(itemType).map(mode => [mode, labels[mode]]);
            this.field(group, this.t('visualizer.colorMode', 'Color mode'), 'select', palette.mode, value => {
                palette.mode = value; this.changed(true);
            }, { values: modes });
            if (palette.mode === 'solid') {
                this.field(group, this.t('visualizer.color', 'Color'), 'color', palette.color,
                    value => { palette.color = value; this.changed(); });
                return;
            }
            if (palette.mode !== 'gradient') return;
        }
        if (GRADIENT_DIRECTION_TYPES.includes(itemType)) {
            this.field(group, this.t('visualizer.gradientDirection', 'Gradient direction'), 'radio', palette.direction ?? 'frequency', value => {
                palette.direction = value; this.changed(true);
            }, { values: [
                ['frequency', this.t('visualizer.gradientDirection.frequency', 'Frequency')],
                ['intensity', this.t('visualizer.gradientDirection.intensity', 'Intensity')]
            ] });
        }
        const presetRow = document.createElement('div');
        presetRow.className = 'visualizer-select-action-row'; group.appendChild(presetRow);
        const choices = this.field(presetRow, this.t('visualizer.gradient', 'Gradient'), 'select', '', () => {},
            { values: GRADIENT_PRESETS.map(({ id, name }) => [id, name]) });
        this.button(presetRow, this.t('visualizer.apply', 'Apply'), () => {
            const colors = GRADIENT_PRESETS.find(entry => entry.id === choices.value).colors;
            palette.stops = colors.map((color, i) => ({ pos: colors.length === 1 ? 0 : i / (colors.length - 1), color }));
            if (octave) palette.mapping = 'range';
            this.changed(true);
        });
        if (octave && palette.direction !== 'intensity') this.field(group, this.t('visualizer.paletteMapping', 'Color mapping'), 'radio', palette.mapping, value => { palette.mapping = value; this.changed(true); }, { values: ['range', 'octave'].map(value => [value, this.t(`visualizer.paletteMapping.${value}`, value === 'range' ? 'Full range' : 'One octave')]) });
        palette.stops.forEach((stop, index) => {
            const row = document.createElement('div'); row.className = 'visualizer-stop'; group.appendChild(row);
            const colorRow = document.createElement('div'); colorRow.className = 'visualizer-stop-color-row'; row.appendChild(colorRow);
            this.field(colorRow, this.t('visualizer.color', 'Color'), 'color', stop.color, value => { stop.color = value; this.changed(); });
            const remove = this.button(colorRow, '−', () => { palette.stops.splice(index, 1); this.changed(true); });
            remove.disabled = palette.stops.length === 1;
            remove.setAttribute('aria-label', this.t('visualizer.removeStop', 'Remove color stop'));
            this.field(row, this.t('visualizer.position', 'Position'), 'range', stop.pos, value => { stop.pos = value; this.changed(); }, { min: 0, max: 1, step: .01 });
        });
        const addRow = document.createElement('div');
        addRow.className = 'visualizer-add-stop-row'; group.appendChild(addRow);
        const add = this.button(addRow, this.t('visualizer.addStop', 'Add color stop'), () => { palette.stops.push({ pos: 1, color: '#ffffff' }); this.changed(true); }); // theme-allow: Editable scene palette stop default.
        add.disabled = palette.stops.length >= (octave ? 13 : 8);
        this.field(group, this.t('visualizer.motion', 'Color motion'), 'radio', palette.motion.mode, value => { palette.motion.mode = value; this.changed(true); }, { values: ['none', 'hue', 'scroll'].map(value => [value, this.t(`visualizer.value.${value}`, value)]) });
        this.field(group, this.t('visualizer.speed', 'Speed'), 'range', palette.motion.speed, value => { palette.motion.speed = value; this.changed(); }, { min: 0, max: 4, step: .05, disabled: palette.motion.mode === 'none' });
    }

    effects(parent, effects, target, itemType) {
        const group = this.group(parent, this.t('visualizer.effects', 'Effects'));
        const types = Object.entries(EFFECT_CATALOG).filter(([type, entry]) => entry.allowedOn.includes(target) && (type !== 'ken-burns' || target === 'background' || itemType === 'artwork'));
        const addRow = document.createElement('div');
        addRow.className = 'visualizer-select-action-row'; group.appendChild(addRow);
        const chooser = this.field(addRow, this.t('visualizer.effect', 'Effect'), 'select', types[0][0], () => {}, { values: types.map(([key, entry]) => [key, this.t(`visualizer.effect.${key}`, entry.label)]) });
        const addEffect = this.button(addRow, this.t('visualizer.add', 'Add'), () => {
            if (effects.length >= MAX_EFFECTS) return;
            effects.push(normalizeEffect({ type: chooser.value }, target)); this.changed(true);
        });
        addEffect.disabled = effects.length >= MAX_EFFECTS;
        effects.forEach((effect, index) => {
            const effectName = this.t(`visualizer.effect.${effect.type}`, EFFECT_CATALOG[effect.type].label);
            const block = this.group(group, effectName);
            const heading = block.firstElementChild;
            const headingRow = document.createElement('div'); headingRow.className = 'visualizer-effect-heading';
            block.insertBefore(headingRow, heading);
            const toggle = this.button(headingRow, 'ON', () => { effect.enabled = !effect.enabled; this.changed(true); });
            toggle.classList.add('toggle-button'); toggle.classList.toggle('off', !effect.enabled);
            toggle.setAttribute('aria-pressed', String(effect.enabled));
            toggle.setAttribute('aria-label', `${this.t('ui.title.enableEffect', 'Enable or disable effect')}: ${effectName}`);
            headingRow.appendChild(heading);
            const actions = document.createElement('div');
            actions.className = 'visualizer-effect-actions'; headingRow.appendChild(actions);
            const up = this.iconButton(actions, 'up', this.t('visualizer.moveUp', 'Move up'), () => { [effects[index - 1], effects[index]] = [effects[index], effects[index - 1]]; this.changed(true); });
            up.disabled = index === 0;
            const down = this.iconButton(actions, 'down', this.t('visualizer.moveDown', 'Move down'), () => { [effects[index + 1], effects[index]] = [effects[index], effects[index + 1]]; this.changed(true); });
            down.disabled = index === effects.length - 1;
            this.iconButton(actions, 'delete', this.t('visualizer.delete', 'Delete'), () => { effects.splice(index, 1); this.changed(true); });
            this.field(block, this.t('visualizer.amount', 'Amount'), 'range', effect.amount, value => { effect.amount = value; this.changed(); }, { min: 0, max: 1, step: .01, disabled: !effect.enabled });
            if (effect.type === 'trail-feedback') {
                this.field(block, this.t('visualizer.feedbackZoom', 'Zoom'), 'range', effect.zoom ?? 2,
                    value => { effect.zoom = value; this.changed(); },
                    { min: -2, max: 2, step: .05, format: value => `${value}%`, disabled: !effect.enabled });
                this.field(block, this.t('visualizer.feedbackAngle', 'Rotation angle (°)'), 'range', effect.angle ?? 1.15,
                    value => { effect.angle = value; this.changed(); },
                    { min: -3, max: 3, step: .05, format: value => `${value}°`, disabled: !effect.enabled });
                for (const [axis, key, label] of [['X', 'flowX', 'Horizontal flow'], ['Y', 'flowY', 'Vertical flow']]) {
                    this.field(block, this.t(`visualizer.feedback${axis}`, label), 'range', effect[key] ?? 0,
                        value => { effect[key] = value; this.changed(); },
                        { min: -1, max: 1, step: .05, format: value => `${value}%`, disabled: !effect.enabled });
                }
            }
            this.field(block, this.t('visualizer.modulation', 'Modulation'), 'radio', effect.mod.source, value => { effect.mod.source = value; this.changed(true); }, { values: ['none', 'time', 'level', 'bass'].map(value => [value, this.t(`visualizer.value.${value}`, value)]), disabled: !effect.enabled });
            this.field(block, this.t('visualizer.depth', 'Depth'), 'range', effect.mod.depth, value => { effect.mod.depth = value; this.changed(); }, { min: 0, max: 1, step: .01, disabled: !effect.enabled || effect.mod.source === 'none' });
            this.field(block, this.t('visualizer.speed', 'Speed'), 'range', effect.mod.speed, value => { effect.mod.speed = value; this.changed(); }, { min: 0, max: 8, step: .1, disabled: !effect.enabled || effect.mod.source !== 'time' });
            if (['glow', 'outline', 'particles', 'flash'].includes(effect.type)) this.palette(block, effect.palette);
        });
    }

    async importImage(file) {
        if (!file) return;
        const url = URL.createObjectURL(file);
        try {
            const image = new Image(); image.src = url; await image.decode();
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 2560 / image.naturalWidth, 2560 / image.naturalHeight);
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL('image/jpeg', .85);
            const layout = { ...this.view.layout, background: { ...this.view.layout.background, image: imageData } };
            if (new TextEncoder().encode(JSON.stringify(layout)).length > 8 * 1024 * 1024) throw new Error('Visualizer image exceeds the backup size limit');
            this.view.layout.background.image = imageData; this.changed();
        } catch (error) { console.error('Visualizer image import failed:', error); this.view.notice('visualizer.imageFailed', 'This image could not be opened. Try a smaller PNG, JPEG, or WebP image.'); }
        finally { URL.revokeObjectURL(url); }
    }

    point(event) {
        const rect = this.view.canvas.getBoundingClientRect();
        // Both pointer coordinates and the rendered rectangle are viewport units,
        // including Electron body zoom, so the normalized ratio cancels zoom.
        return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    }
    startDrag(event) {
        if (!this.open || event.target.closest('button')) return;
        const point = this.point(event);
        const corner = event.target.dataset.corner;
        const item = corner ? this.view.layout.items.find(value => value.id === this.selection) : [...this.view.layout.items].reverse().find(value => point.x >= value.rect.x && point.y >= value.rect.y && point.x <= value.rect.x + value.rect.w && point.y <= value.rect.y + value.rect.h);
        this.selection = item?.id || null; this.render(); this.updateSelection();
        if (!item) return;
        this.view.stage.focus({ preventScroll: true });
        event.preventDefault(); this.view.stage.setPointerCapture(event.pointerId);
        this.dragging = { item, point, rect: { ...item.rect }, corner,
            duplicateOnMove: event.altKey === true && !corner };
    }
    drag(event) {
        if (!this.dragging) return;
        const { point, rect, corner } = this.dragging;
        const current = this.point(event), dx = current.x - point.x, dy = current.y - point.y;
        if (this.dragging.duplicateOnMove && (dx !== 0 || dy !== 0)) {
            const copy = this.duplicateItem(this.dragging.item);
            if (!copy) { this.dragging = null; return; }
            this.dragging.item = copy;
            this.dragging.duplicateOnMove = false;
        }
        const item = this.dragging.item;
        const snap = value => this.grid ? Math.round(value * 40) / 40 : value;
        const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
        if (!corner) { item.rect.x = clamp(snap(rect.x + dx), 0, 1 - rect.w); item.rect.y = clamp(snap(rect.y + dy), 0, 1 - rect.h); }
        else {
            const left = corner.includes('w') ? clamp(snap(rect.x + dx), 0, rect.x + rect.w - .02) : rect.x;
            const top = corner.includes('n') ? clamp(snap(rect.y + dy), 0, rect.y + rect.h - .02) : rect.y;
            const right = corner.includes('e') ? clamp(snap(rect.x + rect.w + dx), left + .02, 1) : rect.x + rect.w;
            const bottom = corner.includes('s') ? clamp(snap(rect.y + rect.h + dy), top + .02, 1) : rect.y + rect.h;
            item.rect = { x: left, y: top, w: right - left, h: bottom - top };
        }
        this.changed();
    }
    endDrag() { this.dragging = null; }
    duplicateItem(item, offset = false) {
        const items = this.view.layout.items;
        if (items.length >= MAX_ITEMS) return null;
        const copy = structuredClone(item);
        copy.id = createItem(item.type).id;
        if (offset) {
            const shift = (position, size) => position + 1 / 40 <= 1 - size
                ? position + 1 / 40 : Math.max(0, position - 1 / 40);
            copy.rect.x = Math.round(shift(item.rect.x, item.rect.w) * 1000000) / 1000000;
            copy.rect.y = Math.round(shift(item.rect.y, item.rect.h) * 1000000) / 1000000;
        }
        items.splice(items.indexOf(item) + 1, 0, copy);
        this.selection = copy.id;
        this.changed(true);
        return copy;
    }
    deleteSelected() {
        const index = this.view.layout.items.findIndex(value => value.id === this.selection);
        if (index < 0) return;
        this.view.layout.items.splice(index, 1);
        this.selection = null;
        this.changed(true);
    }
    onStageKeyDown(event) {
        if (!this.open || event.target !== this.view.stage) return;
        const item = this.view.layout.items.find(value => value.id === this.selection);
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd' && item) {
            event.preventDefault(); event.stopPropagation();
            this.duplicateItem(item, true);
            return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'Delete' && this.view.layout.items.some(value => value.id === this.selection)) {
            event.preventDefault(); event.stopPropagation();
            this.deleteSelected();
            return;
        }
        const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!offset) return;
        if (!item) return;
        event.preventDefault();
        const clamp = (value, size) => Math.max(0, Math.min(1 - size, Math.round(value * 1000000) / 1000000));
        item.rect.x = clamp(item.rect.x + offset[0] / 40, item.rect.w);
        item.rect.y = clamp(item.rect.y + offset[1] / 40, item.rect.h);
        this.changed();
    }
    updateSelection() {
        const item = this.view.layout.items.find(value => value.id === this.selection);
        const rectStyle = rect => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
        this.itemBounds.hidden = !this.open;
        this.itemBounds.replaceChildren(...(this.open ? this.view.layout.items.filter(value => value.id !== this.selection) : []).map(value => {
            const bounds = document.createElement('div');
            bounds.dataset.itemId = value.id;
            Object.assign(bounds.style, rectStyle(value.rect));
            return bounds;
        }));
        this.overlay.hidden = !this.open || !item;
        if (!item) return;
        Object.assign(this.overlay.style, rectStyle(item.rect));
    }
}
