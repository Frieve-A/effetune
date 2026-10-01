import { ASPECTS, ITEM_TYPES, VISUAL_TYPES, TEXT_STYLE_TYPES, GRADIENT_DIRECTION_TYPES, MAX_ITEMS, MAX_EFFECTS, RHYTHM_SPANS, EFFECT_CATALOG, FONT_FAMILIES, TEXT_DECORATION_DEFAULTS, RHYTHM_BEAT_STYLE_DEFAULTS, THEME_COLOR_ROLES, DEFAULT_THEME_COLORS, DEFAULT_TRACE_COLOR, createItem, isRecord, normalizeEffect, normalizeLayout, paletteModesForType } from './visualizer-model.js';
import { GRADIENT_PRESETS } from './visualizer-palette-presets.js';
import { copyTextToClipboard } from '../utils/clipboard-utils.js';
import { clampMenuToViewport } from '../ui/library/library-view-shared.js';

// Identifies copied Visualizer items in clipboard text.
const CLIPBOARD_KEY = 'effetuneVisualizerItems';
// Mac turns Ctrl+click into a secondary click, so Cmd+click selects behind there, as in Illustrator.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const selectsBehind = event => (IS_MAC ? event.metaKey : event.ctrlKey) && !event.shiftKey;

const ACTION_ICONS = {
    up: ['move-up-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M12 8l5.4 8.8H6.6z"/></svg>'],
    down: ['move-down-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M12 16l5.4-8.8H6.6z"/></svg>'],
    front: ['header-button bring-to-front-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.5"/><rect x="9" y="9" width="10" height="10" rx="1.5" fill="currentColor"/></svg>'],
    back: ['header-button send-to-back-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M6.5 5h7A1.5 1.5 0 0 1 15 6.5V9h-4.5A1.5 1.5 0 0 0 9 10.5V15H6.5A1.5 1.5 0 0 1 5 13.5v-7A1.5 1.5 0 0 1 6.5 5z" fill="currentColor"/><rect x="9" y="9" width="10" height="10" rx="1.5"/></svg>'],
    delete: ['delete-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>'],
    left: ['header-button align-left-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/></svg>'],
    hcenter: ['header-button align-hcenter-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>'],
    right: ['header-button align-right-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/></svg>'],
    top: ['header-button align-top-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/></svg>'],
    vcenter: ['header-button align-vcenter-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>'],
    bottom: ['header-button align-bottom-button', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/></svg>']
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
// Every choice is divisible by 4 so the quarter guide lines stay on the snap grid.
const GRID_DIVISIONS = [4, 8, 20, 40, 80];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiNoteName = midi => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const round = value => Math.round(value * 1000000) / 1000000;
// Catalog choices are listed alphabetically by their displayed name.
const byLabel = values => values.sort((a, b) => a[1].localeCompare(b[1]));
// Copies every value of source that differs from base onto target. Nested objects are compared key by key,
// so one changed parameter leaves the others alone; arrays such as effects or color stops are copied whole.
const copyChanges = (source, base, target, skip = []) => {
    for (const [key, value] of Object.entries(source)) {
        if (skip.includes(key)) continue;
        if (isRecord(value) && isRecord(base?.[key]) && isRecord(target[key])) copyChanges(value, base[key], target[key]);
        else if (JSON.stringify(value) !== JSON.stringify(base?.[key])) target[key] = structuredClone(value);
    }
};
const RANGE_ENDPOINTS = { notes: ['mn', 'mx'], chroma: ['lo', 'hi'], 'rhythm-analyzer': ['mn', 'mx'] };
// The Rhythm Analyzer keeps Max BPM >= 1.25 x Min BPM so the tempo search range stays
// non-degenerate (see normalizeParams).
const RANGE_MIN_RATIO = { 'rhythm-analyzer': 1.25 };
// Keep the edited endpoint and move its partner only when the range would invert or become
// narrower than the type's minimum ratio.
const adjustRangeEndpoint = (item, key) => {
    const endpoints = Object.hasOwn(RANGE_ENDPOINTS, item.type) ? RANGE_ENDPOINTS[item.type] : [];
    const [low, high] = endpoints, ratio = RANGE_MIN_RATIO[item.type] ?? 1, params = item.params;
    if (!endpoints.includes(key) || params[high] >= params[low] * ratio) return null;
    if (key === low) params[high] = Math.ceil(params[low] * ratio);
    else params[low] = Math.floor(params[high] / ratio);
    return key === low ? high : low;
};
const rectStyle = rect => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
// Bounding box of the given items in normalized stage units.
const itemsBox = items => ({
    x0: Math.min(...items.map(({ rect }) => rect.x)), y0: Math.min(...items.map(({ rect }) => rect.y)),
    x1: Math.max(...items.map(({ rect }) => rect.x + rect.w)), y1: Math.max(...items.map(({ rect }) => rect.y + rect.h))
});

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
        // Selected item ids; empty means Background.
        this.selection = new Set();
        const divisions = Number(localStorage.getItem('effetune_visualizer_grid_divisions'));
        this.gridDivisions = GRID_DIVISIONS.includes(divisions) ? divisions : 0;
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
        this.marquee = document.createElement('div');
        this.marquee.className = 'visualizer-marquee';
        this.marquee.hidden = true;
        view.stage.appendChild(this.marquee);
        view.stage.addEventListener('pointerdown', event => this.startDrag(event));
        view.stage.addEventListener('pointermove', event => this.drag(event));
        view.stage.addEventListener('pointerup', () => this.endDrag());
        view.stage.addEventListener('pointercancel', () => this.endDrag());
        view.stage.addEventListener('contextmenu', event => this.openContextMenu(event));
        view.stage.tabIndex = -1;
        view.stage.addEventListener('keydown', event => this.onStageKeyDown(event));
        view.stage.addEventListener('keyup', () => this.view.commitPending());
    }

    t(key, fallback) { return this.view.t(key, fallback); }
    setOpen(open) {
        this.open = open;
        if (!open) this.closeContextMenu();
        this.navigation.hidden = !open;
        this.root.hidden = !open;
        this.view.stage.classList.toggle('editing', open);
        this.updateGrid();
        this.view.stage.tabIndex = open ? 0 : -1;
        this.view.root.classList.toggle('is-editing', open);
        if (open) this.render();
        this.updateSelection();
    }
    // Off keeps free placement; arrow and Ctrl+D steps then use the default division.
    gridStep() { return 1 / (this.gridDivisions || 40); }
    updateGrid() {
        this.view.stage.classList.toggle('show-grid', this.open && this.gridDivisions > 0);
        if (this.gridDivisions) this.view.stage.style.setProperty('--visualizer-grid-cell', `${100 / this.gridDivisions}%`);
    }
    // Drags and slider input are continuous; their history entry is recorded when they end.
    changed(structural = false, continuing = false, rangeEndpoint = null) {
        this.applyBulkEdit(rangeEndpoint);
        this.view.changed(continuing || !!this.dragging || !!this.inputActive);
        if (structural) this.render();
        this.updateSelection();
    }
    refresh() { this.render(); this.updateSelection(); }
    // With several items of one type selected, the panel edits the first one and its changes are copied to the others.
    // The baseline id guards against a selection that changed after the baseline was taken, such as after a paste.
    applyBulkEdit(rangeEndpoint = null) {
        const [first, ...others] = this.selectedItems();
        if (first && this.baseline?.id === first.id) {
            const endpoints = Object.hasOwn(RANGE_ENDPOINTS, first.type) ? RANGE_ENDPOINTS[first.type] : [];
            const changedEndpoints = endpoints.filter(key => (!rangeEndpoint || key === rangeEndpoint) &&
                first.params[key] !== this.baseline.copy.params[key]);
            const partner = endpoints.includes(rangeEndpoint) ? endpoints.find(key => key !== rangeEndpoint) : null;
            // The first item's partner may have moved to keep its own range valid. Each
            // other item keeps its partner unless the requested endpoint crosses it.
            const source = partner ? { ...first, params: { ...first.params, [partner]: this.baseline.copy.params[partner] } } : first;
            for (const item of others) {
                copyChanges(source, this.baseline.copy, item, ['id', 'type', 'rect']);
                for (const key of changedEndpoints) adjustRangeEndpoint(item, key);
            }
        }
        this.takeBaseline();
    }
    takeBaseline() {
        const selected = this.selectedItems();
        this.baseline = selected.length > 1 && selected.every(item => item.type === selected[0].type)
            ? { id: selected[0].id, copy: structuredClone(selected[0]) } : null;
    }
    // Front and back move the selection as a group; up and down swap each selected item with its unselected neighbor.
    // Returns null when the order would not change.
    reorderedItems(kind) {
        const items = this.view.layout.items, chosen = item => this.selection.has(item.id);
        let next;
        if (kind === 'front') next = [...items.filter(item => !chosen(item)), ...items.filter(chosen)];
        else if (kind === 'back') next = [...items.filter(chosen), ...items.filter(item => !chosen(item))];
        else {
            next = [...items];
            if (kind === 'up') {
                for (let i = 1; i < next.length; i++) if (chosen(next[i]) && !chosen(next[i - 1])) [next[i - 1], next[i]] = [next[i], next[i - 1]];
            } else {
                for (let i = next.length - 2; i >= 0; i--) if (chosen(next[i]) && !chosen(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
            }
        }
        return next.every((value, index) => value === items[index]) ? null : next;
    }
    applyOrder(next) {
        this.view.layout.items.splice(0, this.view.layout.items.length, ...next);
        this.changed(true);
    }
    // Every item moves inside the selection bounds, so no snapping or clamping is needed.
    align(kind) {
        const items = this.selectedItems(), box = itemsBox(items);
        for (const { rect } of items) {
            if (kind === 'left') rect.x = box.x0;
            else if (kind === 'hcenter') rect.x = round((box.x0 + box.x1 - rect.w) / 2);
            else if (kind === 'right') rect.x = round(box.x1 - rect.w);
            else if (kind === 'top') rect.y = box.y0;
            else if (kind === 'vcenter') rect.y = round((box.y0 + box.y1 - rect.h) / 2);
            else rect.y = round(box.y1 - rect.h);
        }
        this.changed();
    }
    selectedItems() { return this.view.layout.items.filter(item => this.selection.has(item.id)); }
    clearSelection() { this.selection = new Set(); }
    deselectAll() { this.clearSelection(); this.refresh(); }
    selectAll() { this.selection = new Set(this.view.layout.items.map(item => item.id)); this.refresh(); }
    // Items under the point, frontmost first.
    itemsAt(point) {
        return this.view.layout.items.filter(({ rect }) => point.x >= rect.x && point.y >= rect.y &&
            point.x <= rect.x + rect.w && point.y <= rect.y + rect.h).reverse();
    }
    // Picks the item a click selects. Ctrl+click steps from the frontmost selected item under the pointer
    // to the one behind it and wraps to the front; with nothing there selected it starts behind the front item.
    clickTarget(hits, event) {
        if (!selectsBehind(event) || !hits.length) return hits[0];
        const current = hits.findIndex(item => this.selection.has(item.id));
        return hits[(Math.max(current, 0) + 1) % hits.length];
    }
    // Applies an item click and returns whether a drag may start from it.
    clickItem(id, event, toggle = event.shiftKey) {
        if (toggle) {
            if (!this.selection.delete(id)) this.selection.add(id);
            return false;
        }
        if (selectsBehind(event) || !this.selection.has(id)) this.selection = new Set([id]);
        return true;
    }
    // Drops gestures and selected ids that no longer match a replaced layout.
    resetForLayout() {
        this.dragging = null;
        this.marqueeStart = null;
        this.marquee.hidden = true;
        const ids = new Set(this.view.layout.items.map(item => item.id));
        for (const id of this.selection) if (!ids.has(id)) this.selection.delete(id);
    }
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
        const continuous = kind === 'range' || kind === 'color';
        input.addEventListener(continuous ? 'input' : 'change', () => {
            const next = kind === 'checkbox' ? input.checked : kind === 'range' || kind === 'number' ? Number(input.value) : kind === 'file' ? input.files[0] : input.value;
            if (output) output.textContent = options.format(next);
            // Slider and color input streams become one history entry, recorded on change.
            this.inputActive = continuous;
            try { action(next); } finally { this.inputActive = false; }
        });
        if (continuous) input.addEventListener('change', () => this.view.commitPending());
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
        const textItem = TEXT_STYLE_TYPES.includes(item.type);
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
        this.field(scene, this.t('visualizer.graphScale', 'Graph scale'), 'range', layout.graphScale, value => { layout.graphScale = value; this.changed(); },
            { min: 0.5, max: 3, step: 0.05, format: value => `×${value.toFixed(2)}` });
        this.field(scene, this.t('visualizer.grid', 'Snap to grid'), 'select', String(this.gridDivisions), value => {
            this.gridDivisions = Number(value);
            localStorage.setItem('effetune_visualizer_grid_divisions', value);
            this.updateGrid();
        }, { values: [['0', this.t('visualizer.paramChoice.Off', 'Off')], ...GRID_DIVISIONS.map(value => [String(value), `${value} × ${value}`])] });
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
        const add = this.field(addRow, this.t('visualizer.item', 'Item'), 'select', 'spectrum', () => {}, { values: byLabel(ITEM_TYPES.map(type => [type, this.t(`visualizer.type.${type}`, type)])) });
        const addItem = this.button(addRow, this.t('visualizer.add', 'Add'), () => {
            if (layout.items.length >= MAX_ITEMS) return;
            const item = createItem(add.value);
            if (item.type !== 'artwork') item.palette.color = DEFAULT_TRACE_COLOR;
            layout.items.push(item); this.selection = new Set([item.id]); this.changed(true);
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
            const option = this.button(list, label, event => {
                // The list has nothing behind an item, so Ctrl+click toggles there like Shift+click.
                if (id) this.clickItem(id, event, event.shiftKey || event.ctrlKey || event.metaKey); else this.clearSelection();
                this.refresh();
                if (id) this.view.stage.focus({ preventScroll: true });
            });
            const active = id ? this.selection.has(id) : this.selection.size === 0;
            option.className = 'player-playlist-item';
            option.classList.toggle('active', active);
            option.setAttribute('aria-pressed', String(active));
        }
        const selected = this.selectedItems();
        const [item] = selected, single = selected.length === 1;
        this.takeBaseline();
        const header = document.createElement('div');
        header.className = 'visualizer-item-header';
        this.root.appendChild(header);
        const heading = document.createElement('h2');
        heading.className = 'visualizer-item-name plugin-name';
        heading.textContent = single
            ? `${layout.items.indexOf(item) + 1}. ${this.t(`visualizer.type.${item.type}`, item.type)}`
            : selected.length ? this.t('visualizer.selectedCount', '{count} items selected').replace('{count}', selected.length)
                : this.t('visualizer.background', 'Background');
        heading.title = heading.textContent;
        header.appendChild(heading);
        if (!selected.length) {
            this.effects(this.root, layout.background.effects, 'background');
            return;
        }
        const order = document.createElement('div'); order.className = 'visualizer-editor-actions'; header.appendChild(order);
        for (const [kind, key, fallback] of [['up', 'moveUp', 'Move up'], ['down', 'moveDown', 'Move down'],
            ['front', 'front', 'Bring to front'], ['back', 'back', 'Send to back']]) {
            const next = this.reorderedItems(kind);
            this.iconButton(order, kind, this.t(`visualizer.${key}`, fallback), () => this.applyOrder(next)).disabled = !next;
        }
        this.iconButton(order, 'delete', this.t('visualizer.delete', 'Delete'), () => this.deleteSelected());
        if (!single) {
            const alignment = document.createElement('div');
            alignment.className = 'visualizer-align-actions';
            this.root.appendChild(alignment);
            for (const [kind, fallback] of [['left', 'Align left edges'], ['hcenter', 'Align horizontal centers'], ['right', 'Align right edges'],
                ['top', 'Align top edges'], ['vcenter', 'Align vertical centers'], ['bottom', 'Align bottom edges']]) {
                this.iconButton(alignment, kind, this.t(`visualizer.align.${kind}`, fallback), () => this.align(kind));
            }
            // Mixed item types have no shared settings to show.
            if (!this.baseline) return;
            const note = document.createElement('p');
            note.className = 'visualizer-bulk-note';
            note.textContent = this.t('visualizer.bulkEditNote', 'Showing the settings of the first selected item. Changes apply to all selected items.');
            this.root.appendChild(note);
        }
        const properties = this.group(this.root, this.t('visualizer.properties', 'Properties'));
        if (VISUAL_TYPES.includes(item.type)) {
            const channels = [['', '1–2'], ['L', 'L'], ['R', 'R'], ...Array.from({ length: 7 }, (_, i) => [`${i * 2 + 3}${i * 2 + 4}`, `${i * 2 + 3}–${i * 2 + 4}`]), ...Array.from({ length: 16 }, (_, i) => [`${i + 1}`, `${i + 1}`])];
            this.field(properties, this.t('visualizer.channel', 'Channel'), 'select', item.channel || '', value => { item.channel = value || null; this.changed(); }, { values: channels });
        }
        this.styleToggles(properties, item);
        if (VISUAL_TYPES.includes(item.type)) this.parameters(properties, item);
        if (item.type === 'artwork') this.field(properties, this.t('visualizer.style.rounded', 'Rounded corners'), 'checkbox',
            item.style.rounded, value => { item.style.rounded = value; this.changed(); });
        else if (TEXT_STYLE_TYPES.includes(item.type)) this.textStyle(properties, item.style, item.type);
        if (item.type !== 'artwork') this.palette(this.root, item.palette, item.type);
        this.effects(this.root, item.effects, 'item', item.type);
    }

    textStyle(parent, style, type = null) {
        const value = key => style[key] ?? TEXT_DECORATION_DEFAULTS[key] ?? RHYTHM_BEAT_STYLE_DEFAULTS[key];
        const set = key => next => { style[key] = next; this.changed(); };
        const label = (key, fallback) => this.t(`visualizer.style.${key}`, fallback);
        const select = (group, key, fallback, values) => this.field(group, label(key, fallback), 'select', value(key), set(key),
            { values: values.map(([entry, name]) => [entry, this.t(`visualizer.value.${entry}`, name)]) });
        const range = (group, key, fallback, min, max, step = 1, format = String) => this.field(group, label(key, fallback), 'range', value(key), set(key),
            { min, max, step, format });
        if (type === 'rhythm-analyzer') {
            const circle = this.group(parent, label('beatCircle', 'Beat circle'));
            const percent = next => `${Math.round(next * 100)}%`;
            range(circle, 'beatSize', 'Circle size', 10, 100, 1, next => `${next}%`);
            range(circle, 'beatLineWidth', 'Border width', 0, 20, 0.5);
            range(circle, 'beatFillOpacity', 'Fill opacity', 0, 1, 0.01, percent);
            range(circle, 'beatHoldTime', 'Beat hold time', 0, 1000, 10, next => `${next} ms`);
            range(circle, 'beatDecayTime', 'Beat decay time', 10, 2000, 10, next => `${next} ms`);
            range(circle, 'beatStrokeOpacity', 'Border opacity', 0, 1, 0.01, percent);
            this.field(circle, label('beatUsePalette', 'Use palette colors'), 'checkbox', value('beatUsePalette'), next => {
                style.beatUsePalette = next; this.changed(true);
            });
            for (const [key, fallback] of [['beatFillColor', 'Fill color'], ['beatStrokeColor', 'Border color']]) {
                this.field(circle, label(key, fallback), 'color', value(key), set(key), { disabled: value('beatUsePalette') });
            }
            this.field(circle, label('beatFitBpm', 'Fit BPM inside circle'), 'checkbox', value('beatFitBpm'), set('beatFitBpm'));
        }
        select(parent, 'fontFamily', 'Font', FONT_FAMILIES);
        range(parent, 'fontSize', 'Text size', 8, 200);
        select(parent, 'align', 'Alignment', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]);
        select(parent, 'verticalAlign', 'Vertical alignment', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]);
        range(parent, 'letterSpacing', 'Letter spacing', -20, 100);
        select(parent, 'textCase', 'Case', [['none', 'None'],['upper', 'UPPERCASE'], ['lower', 'lowercase']]);
        const outline = this.group(parent, this.t('visualizer.style.outline', 'Outline'));
        range(outline, 'outlineWidth', 'Width', 0, 20, 0.5);
        this.field(outline, this.t('visualizer.color', 'Color'), 'color', value('outlineColor'), set('outlineColor'));
        const shadow = this.group(parent, this.t('visualizer.style.shadow', 'Shadow'));
        this.field(shadow, this.t('visualizer.color', 'Color'), 'color', value('shadowColor'), set('shadowColor'));
        this.field(shadow, label('shadowOpacity', 'Opacity'), 'range', value('shadowOpacity'), set('shadowOpacity'),
            { min: 0, max: 1, step: 0.01, format: next => `${Math.round(next * 100)}%` });
        range(shadow, 'shadowBlur', 'Blur', 0, 50);
        range(shadow, 'shadowX', 'Offset X', -50, 50);
        range(shadow, 'shadowY', 'Offset Y', -50, 50);
    }

    parameters(parent, item) {
        const params = item.params;
        const analogMeter = item.type === 'analog-meter';
        const rhythm = item.type === 'rhythm-analyzer';
        const update = (key, value) => {
            params[key] = key === 'pt' || (item.type === 'chroma' && key === 'dm') ||
                (analogMeter && ['sc', 'ln', 'ls'].includes(key)) || (rhythm && key === 'sp') ? Number(value) : value;
            // Mode and PPM Scale decide which Analog Meter parameters apply; Peak toggles Peak Hold/Fall Time.
            this.changed((analogMeter && (key === 'md' || key === 'sc')) || key === 'pk');
        };
        const select = (key, label, values) => this.field(parent, this.t(`visualizer.param.${key}`, label), 'select', params[key], value => update(key, value), { values });
        const orientation = () => select('orientation', 'Orientation', [
            ['horizontal', this.t('visualizer.paramChoice.Horizontal', 'Horizontal')],
            ['vertical', this.t('visualizer.paramChoice.Vertical', 'Vertical')]
        ]);
        const range = (key, label, min, max, step, format) => this.field(parent, this.t(`visualizer.param.${key}`, label), 'range', params[key], value => update(key, value), { min, max, step, format });
        const check = (key, label) => this.field(parent, this.t(`visualizer.param.${key}`, label), 'checkbox', params[key], value => update(key, value));
        // Integer range endpoints; an endpoint dragged past its partner carries the partner along.
        const rangePair = (entries, format) => {
            const sliders = {};
            for (const [key, label, min, max, labelKey = key] of entries) {
                sliders[key] = this.field(parent, this.t(`visualizer.param.${labelKey}`, label), 'range', params[key], value => {
                    params[key] = value;
                    const otherKey = adjustRangeEndpoint(item, key);
                    if (otherKey) {
                        sliders[otherKey].value = params[otherKey];
                        sliders[otherKey].nextElementSibling.textContent = format(params[otherKey]);
                        window.uiManager?.refreshRangeFillStyling?.(sliders[otherKey]);
                    }
                    this.changed(false, false, key);
                }, { min, max, step: 1, format });
            }
        };
        // Bar segment size in dB; 0 draws continuous bars.
        const stepFormat = value => value > 0 ? `${value.toFixed(1)} dB` : this.t('visualizer.value.continuous', 'Continuous');
        // Peak Hold and Peak Fall Time only matter while the peak indicator (pk) is shown.
        const peakControls = (fallMin = 0.1) => {
            check('pk', 'Peak');
            if (params.pk) {
                range('ph', 'Peak Hold', 0, 10, 0.1, value => `${value.toFixed(1)} s`);
                range('pf', 'Peak Fall Time', fallMin, 10, 0.1, value => `${value.toFixed(1)} s`);
            }
        };
        if (item.type === 'spectrum' || item.type === 'spectrogram') {
            range('dr', 'DB Range', -144, -48, 1, value => `${value} dB`);
            select('pt', 'Points', Array.from({ length: 7 }, (_, index) => [String(index + 8), String(2 ** (index + 8))]));
            select('sc', 'Frequency Scale', [['log', this.t('visualizer.paramChoice.log', 'Log')], ['log-hq', this.t('visualizer.paramChoice.log-hq', 'Log (HQ)')], ['linear', this.t('visualizer.paramChoice.linear', 'Linear')]]);
            check('kb', 'Keyboard');
            // 100% is half the length of real piano keys; 200% is the real proportion.
            range('kl', 'Keyboard Length', 50, 200, 5, value => `${value}%`);
            range('mf', 'Max Frequency', 1000, 40000, 1000, value => `${value / 1000} kHz`);
            if (item.type === 'spectrum') {
                // Bar-only controls toggle in place, so dragging a slider never rebuilds the panel.
                const disabled = () => ({ bars: params.dm !== 'bar', quantize: params.dm !== 'bar' || params.ds === 0 });
                let bands, segment, quantize;
                const syncBarFields = () => {
                    const state = disabled();
                    bands.disabled = segment.disabled = state.bars;
                    quantize.disabled = state.quantize;
                };
                this.field(parent, this.t('visualizer.param.dm', 'Display'), 'select', params.dm, value => {
                    update('dm', value);
                    syncBarFields();
                }, { values: [['line', this.t('visualizer.paramChoice.line', 'Line')],
                    ['bar', this.t('visualizer.paramChoice.bar', 'Bar')]] });
                bands = this.field(parent, this.t('visualizer.param.bc', 'Bands'), 'range', params.bc,
                    value => update('bc', value), { min: 8, max: 128, step: 1, format: String, disabled: disabled().bars });
                segment = this.field(parent, this.t('visualizer.param.ds', 'dB per Segment'), 'range', params.ds, value => {
                    update('ds', value);
                    syncBarFields();
                }, { min: 0, max: 12, step: 0.5, format: stepFormat, disabled: disabled().bars });
                quantize = this.field(parent, this.t('visualizer.param.quantizeBars', 'Quantize'),
                    'checkbox', params.quantizeBars, value => update('quantizeBars', value),
                    { disabled: disabled().quantize });
                orientation();
                range('sm', 'Smoothing', 0, 1, 0.01, value => `${value.toFixed(2)} oct`);
                range('cf', 'Fall Time', 0, 5, 0.05, value => `${value.toFixed(2)} s`);
                peakControls();
            }
        } else if (item.type === 'stereo') {
            range('wt', 'Window', 0.01, 1, 0.001, value => `${Math.round(value * 1000)} ms`);
            peakControls(1);
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
            range('ds', 'dB per Segment', 0, 12, 0.5, stepFormat);
            check('showLevelValues', 'Level values');
            range('cf', 'Fall Time', 0, 5, 0.05, value => `${value.toFixed(2)} s`);
            peakControls();
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
                    const otherKey = adjustRangeEndpoint(item, key);
                    if (otherKey) {
                        noteSliders[otherKey].value = midi;
                        noteSliders[otherKey].nextElementSibling.textContent = midiNoteName(midi);
                        window.uiManager?.refreshRangeFillStyling?.(noteSliders[otherKey]);
                    }
                    this.changed(false, false, key);
                }, { min: 21, max: 108, step: 1, format: midiNoteName });
            }
            range('nc', 'Regular Note Limit', 1, 16, 1, value => String(value));
            check('kb', 'Keyboard');
            // 100% is half the length of real piano keys; 200% is the real proportion.
            range('kl', 'Keyboard Length', 50, 200, 5, value => `${value}%`);
        } else if (item.type === 'chroma') {
            select('dm', 'Display', [['0', this.t('visualizer.value.dots', 'Dots')], ['1', this.t('visualizer.value.fill', 'Fill')]]);
            rangePair([['lo', 'Lowest Octave', 1, 8], ['hi', 'Highest Octave', 1, 9]], value => String(value));
            range('ft', 'Frequency Tilt', -6, 6, 0.5, value => `${value} dB/oct`);
            range('lr', 'Level Range', 6, 96, 1, value => `${value} dB`);
            range('df', 'Display Floor', -120, -24, 1, value => `${value} dB`);
            range('cf', 'Fall Time', 0, 5, 0.05, value => `${value.toFixed(2)} s`);
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
        } else if (rhythm) {
            rangePair([['mn', 'Min BPM', 40, 192, 'bpmMin'], ['mx', 'Max BPM', 50, 240, 'bpmMax']],
                value => `${value} BPM`);
            select('sp', 'Span (beats)', RHYTHM_SPANS.map(value => [String(value), String(value)]));
            check('showBeat', 'Beat');
            check('showBpm', 'BPM');
            check('vt', 'Tempogram');
            check('vm', 'Timing lanes');
            check('ve', 'Echo rows');
            // 'vl' already labels the Notes item's Volume checkbox; the lens checkbox uses its own label key.
            this.field(parent, this.t('visualizer.param.beatLens', 'Beat lens'), 'checkbox', params.vl, value => update('vl', value));
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
            { values: byLabel(GRADIENT_PRESETS.map(({ id, name }) => [id, name])) });
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
        const types = byLabel(Object.entries(EFFECT_CATALOG)
            .filter(([type, entry]) => entry.allowedOn.includes(target) && (type !== 'ken-burns' || target === 'background' || itemType === 'artwork'))
            .map(([key, entry]) => [key, this.t(`visualizer.effect.${key}`, entry.label)]));
        const addRow = document.createElement('div');
        addRow.className = 'visualizer-select-action-row'; group.appendChild(addRow);
        const chooser = this.field(addRow, this.t('visualizer.effect', 'Effect'), 'select', types[0][0], () => {}, { values: types });
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
            if (effect.type === 'backplate') {
                const set = key => value => { effect[key] = value; this.changed(); };
                const percent = value => `${Math.round(value * 100)}%`;
                this.field(block, this.t('visualizer.backplateFill', 'Fill color'), 'color', effect.fill, set('fill'), { disabled: !effect.enabled });
                this.field(block, this.t('visualizer.backplateFillOpacity', 'Fill opacity'), 'range', effect.fillOpacity, set('fillOpacity'),
                    { min: 0, max: 1, step: .01, format: percent, disabled: !effect.enabled });
                this.field(block, this.t('visualizer.backplateBorder', 'Border color'), 'color', effect.border, set('border'), { disabled: !effect.enabled });
                this.field(block, this.t('visualizer.backplateBorderWidth', 'Border width'), 'range', effect.borderWidth, set('borderWidth'),
                    { min: 0, max: 20, step: .5, format: String, disabled: !effect.enabled });
                this.field(block, this.t('visualizer.backplateRadius', 'Corner radius'), 'range', effect.radius, set('radius'),
                    { min: 0, max: 200, step: 1, format: String, disabled: !effect.enabled });
                this.field(block, this.t('visualizer.backplateMargin', 'Margin'), 'range', effect.margin, set('margin'),
                    { min: -200, max: 200, step: 1, format: String, disabled: !effect.enabled });
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
        // Secondary clicks, including Ctrl+click on Mac, are left to the context menu.
        if (!this.open || event.button > 0 || (IS_MAC && event.ctrlKey) || event.target.closest('button')) return;
        const point = this.point(event);
        const corner = event.target.dataset.corner;
        const hit = corner ? this.selectedItems()[0] : this.clickTarget(this.itemsAt(point), event);
        // Shift+click only toggles the selection; it never starts a drag.
        if (hit && !corner && !this.clickItem(hit.id, event)) { this.refresh(); return; }
        this.view.stage.focus({ preventScroll: true });
        event.preventDefault(); this.view.stage.setPointerCapture(event.pointerId);
        if (!hit) {
            if (!event.shiftKey) this.clearSelection();
            this.marqueeStart = { point, base: new Set(this.selection) };
            this.refresh();
            return;
        }
        this.refresh();
        this.beginDrag(hit, corner ? [hit] : this.selectedItems(), point, corner, event.altKey === true && !corner);
    }
    beginDrag(grabbed, items, point, corner = null, duplicateOnMove = false) {
        this.dragging = { items, grabbed, point, rect: { ...grabbed.rect }, corner, moved: false,
            starts: items.map(item => ({ ...item.rect })), box: itemsBox(items), duplicateOnMove };
    }
    drag(event) {
        if (this.marqueeStart) { this.updateMarquee(event); return; }
        if (!this.dragging) return;
        const { point, rect, corner, box, starts } = this.dragging;
        const current = this.point(event), dx = current.x - point.x, dy = current.y - point.y;
        if (dx === 0 && dy === 0) return;
        this.dragging.moved = true;
        if (this.dragging.duplicateOnMove) {
            const copies = this.insertCopies(this.dragging.items, false);
            if (!copies) { this.dragging = null; return; }
            this.dragging.grabbed = copies[this.dragging.items.indexOf(this.dragging.grabbed)];
            this.dragging.items = copies;
            this.dragging.duplicateOnMove = false;
        }
        // Holding Alt at any point of the drag places the item freely.
        const divisions = event.altKey ? 0 : this.gridDivisions;
        const snap = value => divisions ? Math.round(value * divisions) / divisions : value;
        const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
        if (!corner) {
            // The grabbed item snaps; the whole selection shares its offset and stays inside the stage.
            const x = clamp(snap(rect.x + dx), rect.x - box.x0, 1 - box.x1 + rect.x);
            const y = clamp(snap(rect.y + dy), rect.y - box.y0, 1 - box.y1 + rect.y);
            this.dragging.items.forEach((item, index) => {
                const start = starts[index];
                item.rect.x = clamp(x + (start.x - rect.x), 0, 1 - start.w);
                item.rect.y = clamp(y + (start.y - rect.y), 0, 1 - start.h);
            });
        } else {
            const item = this.dragging.grabbed;
            const left = corner.includes('w') ? clamp(snap(rect.x + dx), 0, rect.x + rect.w - .02) : rect.x;
            const top = corner.includes('n') ? clamp(snap(rect.y + dy), 0, rect.y + rect.h - .02) : rect.y;
            const right = corner.includes('e') ? clamp(snap(rect.x + rect.w + dx), left + .02, 1) : rect.x + rect.w;
            const bottom = corner.includes('s') ? clamp(snap(rect.y + rect.h + dy), top + .02, 1) : rect.y + rect.h;
            item.rect = { x: left, y: top, w: right - left, h: bottom - top };
        }
        this.changed();
    }
    endDrag() {
        if (this.marqueeStart) { this.marqueeStart = null; this.marquee.hidden = true; }
        const dragging = this.dragging;
        this.dragging = null;
        // Clicking a selected item without moving it selects only that item.
        if (dragging && !dragging.moved && !dragging.corner && this.selection.size > 1) {
            this.selection = new Set([dragging.grabbed.id]);
            this.refresh();
        }
        this.view.commitPending();
    }
    // Marquee selection changes only the selection, so it records no history.
    updateMarquee(event) {
        const start = this.marqueeStart.point, current = this.point(event);
        const clamp = value => Math.max(0, Math.min(1, value));
        const x0 = clamp(Math.min(start.x, current.x)), x1 = clamp(Math.max(start.x, current.x));
        const y0 = clamp(Math.min(start.y, current.y)), y1 = clamp(Math.max(start.y, current.y));
        this.marquee.hidden = false;
        Object.assign(this.marquee.style, rectStyle({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
        const next = new Set(this.marqueeStart.base);
        for (const { id, rect } of this.view.layout.items) {
            if (rect.x >= x0 && rect.y >= y0 && rect.x + rect.w <= x1 && rect.y + rect.h <= y1) next.add(id);
        }
        if (next.size === this.selection.size && [...next].every(id => this.selection.has(id))) return;
        this.selection = next;
        this.refresh();
    }
    // Shared by Ctrl+D, Alt+drag, and Paste: inserts deep copies after the frontmost selected item and selects them.
    insertCopies(sources, offset) {
        const items = this.view.layout.items;
        if (items.length + sources.length > MAX_ITEMS) {
            this.view.warn('visualizer.itemLimit', 'A layout can have up to {max} items. Delete some items, then try again.', { max: MAX_ITEMS });
            return null;
        }
        const step = this.gridStep(), box = itemsBox(sources);
        const shift = (low, high) => high + step <= 1 ? step : -Math.min(step, low);
        const dx = shift(box.x0, box.x1), dy = shift(box.y0, box.y1);
        const copies = sources.map(item => {
            const copy = structuredClone(item);
            copy.id = createItem(item.type).id;
            if (offset) { copy.rect.x = round(copy.rect.x + dx); copy.rect.y = round(copy.rect.y + dy); }
            return copy;
        });
        const last = items.findLastIndex(item => this.selection.has(item.id));
        items.splice(last < 0 ? items.length : last + 1, 0, ...copies);
        this.selection = new Set(copies.map(copy => copy.id));
        this.changed(true);
        return copies;
    }
    async copySelected() {
        const items = this.selectedItems();
        if (!items.length) return false;
        if (!await copyTextToClipboard(JSON.stringify({ [CLIPBOARD_KEY]: items }))) {
            console.error('Failed to copy Visualizer items');
            this.view.warn('visualizer.copyFailed', 'The selected items could not be copied. Try again.');
            return false;
        }
        this.view.uiManager.showTransientMessage(this.t('visualizer.itemsCopied', 'Copied the selected items.'), false, {}, 3000);
        return true;
    }
    // Deletes only after the copy succeeds, and deletes the items that were copied.
    async cutSelected() {
        const ids = new Set(this.selection);
        if (!await this.copySelected()) return;
        this.selection = ids;
        this.deleteSelected();
    }
    // Returns false when the text holds no Visualizer items.
    pasteItems(text) {
        let items;
        try { items = JSON.parse(text)?.[CLIPBOARD_KEY]; } catch { return false; }
        items = normalizeLayout({ items }).items;
        if (!items.length) return false;
        this.insertCopies(items, true);
        return true;
    }
    deleteSelected() {
        const items = this.view.layout.items;
        if (!this.selection.size) return;
        for (let index = items.length - 1; index >= 0; index--) if (this.selection.has(items[index].id)) items.splice(index, 1);
        this.clearSelection();
        this.changed(true);
    }
    // Right-clicking an unselected item selects it first; a selected item or empty space keeps the selection.
    openContextMenu(event) {
        if (!this.open || event.target.closest('button')) return;
        event.preventDefault();
        // A touch long press that already moved belongs to the drag or marquee.
        if (this.dragging?.moved || (this.marqueeStart && !this.marquee.hidden)) return;
        this.dragging = null; this.marqueeStart = null;
        const hit = this.itemsAt(this.point(event))[0];
        if (hit && !this.selection.has(hit.id)) this.selection = new Set([hit.id]);
        this.refresh();
        const { history } = this.view, none = !this.selection.size;
        const front = this.reorderedItems('front'), back = this.reorderedItems('back');
        this.showContextMenu(event, [
            [this.t('ui.title.undo', 'Undo'), !history.canUndo, () => this.view.stepHistory('undo')],
            [this.t('ui.title.redo', 'Redo'), !history.canRedo, () => this.view.stepHistory('redo')],
            null,
            [this.t('visualizer.cut', 'Cut items'), none, () => this.cutSelected()],
            [this.t('visualizer.copy', 'Copy items'), none, () => this.copySelected()],
            [this.t('visualizer.paste', 'Paste items'), false, () => this.view.pasteFromClipboard()],
            [this.t('visualizer.duplicate', 'Duplicate'), none, () => this.insertCopies(this.selectedItems(), true)],
            [this.t('visualizer.delete', 'Delete'), none, () => this.deleteSelected()],
            null,
            [this.t('visualizer.selectAll', 'Select all'), !this.view.layout.items.length, () => this.selectAll()],
            null,
            [this.t('visualizer.front', 'Bring to front'), !front, () => this.applyOrder(front)],
            [this.t('visualizer.back', 'Send to back'), !back, () => this.applyOrder(back)]
        ]);
    }
    // Entries are [label, disabled, action] or null for a separator.
    showContextMenu(event, entries) {
        this.closeContextMenu();
        const menu = document.createElement('div');
        menu.className = 'visualizer-context-menu';
        menu.setAttribute('role', 'menu');
        for (const entry of entries) {
            if (!entry) { menu.appendChild(document.createElement('hr')); continue; }
            const [label, disabled, action] = entry;
            const button = this.button(menu, label, () => { this.closeContextMenu(true); action(); });
            button.setAttribute('role', 'menuitem');
            button.disabled = disabled;
        }
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        document.body.appendChild(menu);
        clampMenuToViewport(menu);
        const dismiss = pointerEvent => { if (!menu.contains(pointerEvent.target)) this.closeContextMenu(); };
        const blur = () => this.closeContextMenu();
        menu.addEventListener('keydown', keyEvent => {
            const items = [...menu.querySelectorAll('button:not(:disabled)')];
            const step = { ArrowDown: 1, ArrowUp: -1 }[keyEvent.key];
            if (keyEvent.key === 'Escape') this.closeContextMenu(true);
            else if (step) items[(items.indexOf(document.activeElement) + step + items.length) % items.length]?.focus();
            else return;
            keyEvent.preventDefault(); keyEvent.stopPropagation();
        });
        document.addEventListener('pointerdown', dismiss, true);
        window.addEventListener('blur', blur);
        this.contextMenu = { menu, dismiss, blur };
        menu.querySelector('button:not(:disabled)')?.focus();
    }
    // Focus returns to the stage when the menu closes from the keyboard or runs an action.
    closeContextMenu(restoreFocus = false) {
        if (!this.contextMenu) return;
        document.removeEventListener('pointerdown', this.contextMenu.dismiss, true);
        window.removeEventListener('blur', this.contextMenu.blur);
        this.contextMenu.menu.remove();
        this.contextMenu = null;
        if (restoreFocus) this.view.stage.focus({ preventScroll: true });
    }
    onStageKeyDown(event) {
        if (!this.open || event.target !== this.view.stage || !this.selection.size) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'd') {
            event.preventDefault(); event.stopPropagation();
            this.insertCopies(this.selectedItems(), true);
            return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!offset) return;
        event.preventDefault();
        const items = this.selectedItems(), step = this.gridStep();
        const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
        // Every item moves by the same amount, limited so the whole selection stays inside the stage.
        const box = itemsBox(items);
        const dx = clamp(offset[0] * step, -box.x0, 1 - box.x1), dy = clamp(offset[1] * step, -box.y0, 1 - box.y1);
        for (const { rect } of items) {
            rect.x = clamp(round(rect.x + dx), 0, 1 - rect.w);
            rect.y = clamp(round(rect.y + dy), 0, 1 - rect.h);
        }
        // Key repeat merges into one history entry, recorded on keyup.
        this.changed(false, true);
    }
    updateSelection() {
        const selected = this.open ? this.selectedItems() : [];
        const item = selected.length === 1 ? selected[0] : null;
        this.itemBounds.hidden = !this.open;
        this.itemBounds.replaceChildren(...(this.open ? this.view.layout.items.filter(value => value !== item) : []).map(value => {
            const bounds = document.createElement('div');
            bounds.dataset.itemId = value.id;
            bounds.classList.toggle('selected', this.selection.has(value.id));
            Object.assign(bounds.style, rectStyle(value.rect));
            return bounds;
        }));
        this.overlay.hidden = !item;
        if (item) Object.assign(this.overlay.style, rectStyle(item.rect));
        this.view.updateEditButtons();
    }
}
