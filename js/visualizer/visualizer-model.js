import { encodePipelineState, decodePipelineState } from '../utils/pipeline-state-codec.js';

export const ASPECTS = ['16:9', '21:9', '4:3', '1:1', '9:16'];
export const ASPECT_FILES = Object.freeze({
    '16:9': '16x9.json', '21:9': '21x9.json', '4:3': '4x3.json',
    '1:1': '1x1.json', '9:16': '9x16.json'
});

export const NOTE_TEXT_TYPES = ['key', 'chord'];
export const VISUAL_TYPES = ['spectrum', 'spectrogram', 'oscilloscope', 'stereo', 'level-meter', 'notes', ...NOTE_TEXT_TYPES, 'guitar', 'drums', 'chroma', 'phase', 'analog-meter', 'rhythm-analyzer'];
// Analyzer graphics (ticks, lines, labels, peak marks) are drawn in these 1280-wide units,
// so the same geometry looks identical regardless of the output canvas size or window scale.
export const REFERENCE_WIDTH = 1280;
export const GRADIENT_DIRECTION_TYPES = ['spectrum', 'spectrogram', 'notes', 'guitar', 'chroma', 'phase'];
export const META_TEXT_TYPES = ['title', 'album', 'artist', 'track-info'];
export const META_TYPES = ['artwork', 'video', ...META_TEXT_TYPES];
// Picture items show the playing track's artwork or video frames and have no palette.
export const PICTURE_TYPES = ['artwork', 'video'];
export const VIDEO_FITS = ['contain', 'cover', 'stretch'];
export const TEXT_STYLE_TYPES = [...META_TEXT_TYPES, ...NOTE_TEXT_TYPES, 'text', 'lyrics', 'counter', 'rhythm-analyzer', 'playback-control'];
export const ITEM_TYPES = [...VISUAL_TYPES, ...META_TYPES, 'text', 'lyrics', 'counter', 'shape', 'playback-control', 'seek-bar'];
export const SEEK_APPEARANCES = Object.freeze({
    slim: { thickness: 3, showThumb: false },
    classic: { thickness: 6, showThumb: true, thumbSize: 16 },
    bold: { thickness: 14, showThumb: true, thumbSize: 24 }
});
export const PLAYBACK_ACTIONS = ['play-pause', 'stop', 'previous', 'next', 'shuffle', 'repeat'];
export const PLAYBACK_APPEARANCES = Object.freeze({
    minimal: { fillOpacity: 0, borderWidth: 0, depth: 0 },
    glass: { fill: '#182331', fillOpacity: .92, border: '#71859b', borderWidth: 1, radius: 18, depth: .35 }, // theme-allow: Editable scene button colors.
    raised: { fill: '#30343b', fillOpacity: 1, border: '#8b929d', borderWidth: 1.5, radius: 12, depth: .8 } // theme-allow: Editable scene button colors.
});
export const SHAPES = ['rectangle', 'ellipse', 'triangle', 'line'];
export const MAX_TEXT_LENGTH = 4096;
export const MAX_ITEMS = 64;
export const MAX_EFFECTS = 16;
export const MIN_ITEM_SIZE = 0.02;
export const MAX_ITEM_SIZE = 1;
// Rhythm Analyzer Span (beats) choices, same as the effect.
export const RHYTHM_SPANS = Object.freeze([4, 6, 8, 12, 16]);
// Guitar open-string MIDI notes in physical string order, from the thickest string's side.
export const GUITAR_TUNINGS = Object.freeze({
    standard: [40, 45, 50, 55, 59, 64], 'drop-d': [38, 45, 50, 55, 59, 64],
    'half-step-down': [39, 44, 49, 54, 58, 63], 'd-standard': [38, 43, 48, 53, 57, 62],
    'drop-c': [36, 43, 48, 53, 57, 62], dadgad: [38, 45, 50, 55, 57, 62],
    'open-g': [38, 43, 50, 55, 59, 62], 'open-d': [38, 45, 50, 54, 57, 62], 'open-e': [40, 47, 52, 56, 59, 64],
    '7-string': [35, 40, 45, 50, 55, 59, 64], '8-string': [30, 35, 40, 45, 50, 55, 59, 64],
    bass: [28, 33, 38, 43], 'bass-drop-d': [26, 33, 38, 43],
    'bass-5': [23, 28, 33, 38, 43], 'bass-6': [23, 28, 33, 38, 43, 48],
    ukulele: [67, 60, 64, 69]
});
// Scale guide intervals in semitones above the root.
export const GUITAR_SCALES = Object.freeze({
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], 'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
    'major-pentatonic': [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10]
});
// Detection range for the notes a fretboard can sound.
export const guitarAnalysis = params => {
    const mn = Math.min(108, Math.min(...params.tn) + Math.max(params.fm, params.cp));
    return { mn, mx: Math.max(mn, Math.min(108, Math.max(...params.tn) + params.fx)) };
};
export const FONT_FAMILIES = Object.freeze([
    ['sans-serif', 'Sans-serif'], ['serif', 'Serif'], ['monospace', 'Monospace'],
    ['system-ui', 'System UI'], ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Verdana, Geneva, sans-serif', 'Verdana'], ['Georgia, "Times New Roman", serif', 'Georgia'],
    ['"Courier New", Courier, monospace', 'Courier New'], ['cursive', 'Cursive']
]);
export const COUNTER_DIGIT_FONTS = Object.freeze([
    ['"EffeTune Seven Segment", monospace', 'Seven Segment', 'visualizer.fontSevenSegment'],
    ['"EffeTune Dot Matrix", monospace', 'Dot Matrix', 'visualizer.fontDotMatrix'],
    ['"EffeTune Wire Digits", monospace', 'Wire Digits', 'visualizer.fontWireDigits']
]);
export const COUNTER_FONT_FAMILIES = Object.freeze([...FONT_FAMILIES, ...COUNTER_DIGIT_FONTS]);
// Appearance presets leave the Counter's content and formatting choices intact.
export const COUNTER_APPEARANCES = Object.freeze([
    ['mechanical', 'Mechanical', { font: 'monospace', color: '#eee7d4', motion: 'tape', fill: '#181818', border: '#656565', shading: true }], // theme-allow: Fixed, user-selectable Counter scene colors.
    ['led', 'Red LED', { font: COUNTER_DIGIT_FONTS[0][0], color: '#ff3028', fill: '#180403', border: '#54201b', background: 'full', ghost: '#ff3028', glow: .28 }], // theme-allow: Fixed, user-selectable Counter scene colors.
    ['vfd', 'Blue-green VFD', { font: COUNTER_DIGIT_FONTS[0][0], color: '#80ffe1', fill: '#031b19', border: '#23524b', background: 'full', ghost: '#80ffe1', glow: .22 }], // theme-allow: Fixed, user-selectable Counter scene colors.
    ['lcd', 'Classic LCD', { font: COUNTER_DIGIT_FONTS[0][0], color: '#263729', fill: '#b2bea0', border: '#59664e', background: 'full', ghost: '#263729' }], // theme-allow: Fixed, user-selectable Counter scene colors.
    ['dots', 'Dot Matrix', { font: COUNTER_DIGIT_FONTS[1][0], color: '#ffc45b', fill: '#1c1003', border: '#60461d', background: 'full', ghost: '#ffc45b', glow: .12 }], // theme-allow: Fixed, user-selectable Counter scene colors.
    ['flip', 'Flip', { font: 'monospace', color: '#ffffff', motion: 'flip', fill: '#202124', border: '#55565a', shading: true }], // theme-allow: Fixed, user-selectable Counter scene colors.
    ['nixie', 'Nixie', { font: COUNTER_DIGIT_FONTS[2][0], color: '#ff9b42', motion: 'crossfade', fill: '#1c0c04', border: '#775036', background: 'all', ghost: '#c57943', glow: .3 }] // theme-allow: Fixed, user-selectable Counter scene colors.
]);

export function applyCounterAppearance(item, key) {
    const preset = COUNTER_APPEARANCES.find(([id]) => id === key)?.[2];
    if (item.type !== 'counter' || !preset) return false;
    Object.assign(item.params, {
        counterMotion: preset.motion || 'static', counterDuration: 150,
        counterBackgroundGlyphs: preset.background || 'none', counterBackgroundOpacity: .05,
        counterBackgroundColor: preset.ghost || preset.color,
        counterBoxes: true, counterBoxColor: preset.border, counterBoxWidth: 1,
        counterBoxFill: preset.fill, counterBoxOpacity: 1, counterBoxRadius: 3,
        counterWindowShading: !!preset.shading
    });
    Object.assign(item.style, { fontFamily: preset.font, bold: false, italic: false,
        outlineWidth: 0, shadowColor: preset.color, shadowOpacity: preset.glow ? .8 : 0,
        shadowBlur: preset.glow ? Math.round(6 + preset.glow * 24) : 0,
        shadowX: 0, shadowY: 0, letterSpacing: 2 });
    item.palette = itemPalette('counter', { mode: 'solid', color: preset.color,
        stops: [{ pos: 0, color: preset.color }] });
    item.effects = item.effects.filter(effect => effect.type !== 'glow');
    return true;
}
export const THEME_COLOR_ROLES = Object.freeze([
    'graph-bg-deep', 'graph-base-soft', 'graph-grid-subtle', 'graph-grid-soft', 'graph-grid-strong',
    'graph-label', 'text-primary', 'graph-trace-tertiary'
]);
// Graphite defaults from css/effetune-theme.css; the soft grid retains its 20% alpha.
export const DEFAULT_THEME_COLORS = Object.freeze({
    'graph-bg-deep': '#000000', 'graph-base-soft': '#232323', // theme-allow: Fixed Visualizer Graphite defaults.
    'graph-grid-subtle': '#323233', 'graph-grid-soft': '#f6f8fb33', // theme-allow: Fixed Visualizer Graphite defaults.
    'graph-grid-strong': '#555657', 'graph-label': '#666666', // theme-allow: Fixed Visualizer Graphite defaults.
    'text-primary': '#f6f8fb', 'graph-trace-tertiary': '#7f8081' // theme-allow: Fixed Visualizer Graphite defaults.
});
export const DEFAULT_TRACE_COLOR = '#00ff00'; // theme-allow: Fixed Visualizer Graphite trace.
export const EFFECT_CATALOG = Object.freeze({
    opacity: { label: 'Opacity', defaultAmount: 1, allowedOn: ['item', 'background'] },
    glow: { label: 'Glow', defaultAmount: 0.5, allowedOn: ['item'] },
    outline: { label: 'Outline', defaultAmount: 0.5, allowedOn: ['item'] },
    blur: { label: 'Blur', defaultAmount: 0.3, allowedOn: ['item', 'background'] },
    'color-adjust': { label: 'Color Adjust', defaultAmount: 1, allowedOn: ['item', 'background'] },
    'color-map': { label: 'Color Map', defaultAmount: 1, allowedOn: ['item', 'background'] },
    trail: { label: 'Trail', defaultAmount: 0.5, allowedOn: ['item'] },
    transform: { label: 'Transform', defaultAmount: 1, allowedOn: ['item', 'background'] },
    'scale-pulse': { label: 'Scale Pulse', defaultAmount: 0.4, allowedOn: ['item'] },
    symmetry: { label: 'Symmetry', defaultAmount: 0.5, allowedOn: ['item'] },
    shake: { label: 'Shake', defaultAmount: 0.4, allowedOn: ['item'] },
    'trail-feedback': { label: 'Trail Feedback', defaultAmount: 0.4, allowedOn: ['item'] },
    particles: { label: 'Particles', defaultAmount: 0.5, allowedOn: ['item'] },
    'ken-burns': { label: 'Ken Burns', defaultAmount: 0.4, allowedOn: ['item', 'background'] },
    flash: { label: 'Flash', defaultAmount: 0.5, allowedOn: ['background'] },
    backplate: { label: 'Backplate', defaultAmount: 1, allowedOn: ['item'] },
    'edge-fade': { label: 'Edge Fade', defaultAmount: 1, allowedOn: ['item'] }
});

// Shared slider bounds and defaults keep imported layouts consistent with the editor.
export const TRANSFORM_PARAMETERS = Object.freeze([
    { key: 'scaleX', label: 'Horizontal scale', initial: 100, min: 0, max: 300, unit: '%' },
    { key: 'scaleY', label: 'Vertical scale', initial: 100, min: 0, max: 300, unit: '%' },
    { key: 'angle', label: 'Rotation angle (°)', initial: 0, min: -180, max: 180, unit: '°' },
    { key: 'offsetX', label: 'Horizontal offset', initial: 0, min: -100, max: 100, unit: '%' },
    { key: 'offsetY', label: 'Vertical offset', initial: 0, min: -100, max: 100, unit: '%' },
    { key: 'skewX', label: 'Horizontal skew (°)', initial: 0, min: -60, max: 60, unit: '°' },
    { key: 'skewY', label: 'Vertical skew (°)', initial: 0, min: -60, max: 60, unit: '°' }
]);

export const COLOR_ADJUST_PARAMETERS = Object.freeze([
    { key: 'brightness', label: 'Brightness', initial: 0, min: -1, max: 1, step: .01, unit: '%', scale: 100 },
    { key: 'contrast', label: 'Contrast', initial: 1, min: 0, max: 3, step: .01, unit: '%', scale: 100 },
    { key: 'saturation', label: 'Saturation', initial: 1, min: 0, max: 3, step: .01, unit: '%', scale: 100 },
    { key: 'hue', label: 'Hue', initial: 0, min: -180, max: 180, step: 1, unit: '°' },
    { key: 'inputBlack', label: 'Input black', initial: 0, min: 0, max: .99, step: .01, unit: '%', scale: 100, group: 'levels' },
    { key: 'inputWhite', label: 'Input white', initial: 1, min: .01, max: 1, step: .01, unit: '%', scale: 100, group: 'levels' },
    { key: 'gamma', label: 'Gamma', initial: 1, min: .1, max: 4, step: .01, group: 'levels' },
    { key: 'outputBlack', label: 'Output black', initial: 0, min: 0, max: 1, step: .01, unit: '%', scale: 100, group: 'levels' },
    { key: 'outputWhite', label: 'Output white', initial: 1, min: 0, max: 1, step: .01, unit: '%', scale: 100, group: 'levels' },
    { key: 'temperature', label: 'Temperature', initial: 0, min: -1, max: 1, step: .01, unit: '%', scale: 100, group: 'whiteBalance' },
    { key: 'tint', label: 'Tint', initial: 0, min: -1, max: 1, step: .01, unit: '%', scale: 100, group: 'whiteBalance' }
]);

const CHANNELS = new Set([null, 'L', 'R', ...Array.from({ length: 7 }, (_, i) => `${2 * i + 3}${2 * i + 4}`),
    ...Array.from({ length: 16 }, (_, i) => `${i + 1}`)]);
export const MOD_SOURCES = ['none', 'time', 'level', 'bass', 'mid', 'treble', 'beat', 'width'];
const DEFAULT_PALETTE = { stops: [{ pos: 0, color: '#40dfff' }], motion: { mode: 'none', speed: 0.25 } }; // theme-allow: Editable scene palette default.
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const choice = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const number = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

const METER_APPEARANCE_RULES = {
    dialCurvature: value => Math.round(number(value, 1, 0, 1) * 100) / 100,
    dialSweep: value => Math.round(number(value, 100, 30, 160)),
    pivotOffset: value => Math.round(number(value, 0, 0, 100)),
    needleStart: value => Math.round(number(value, 0, 0, 90)),
    needleLength: value => Math.round(number(value, 102, 50, 120)),
    needleWidth: value => Math.round(number(value, 2, 0.5, 8) * 2) / 2,
    needleTip: value => choice(value, ['line', 'taper', 'arrow'], 'line'),
    arrowAspect: value => Math.round(number(value, 1, 0.25, 4) * 20) / 20,
    hubSize: value => Math.round(number(value, 3, 0, 20) * 2) / 2,
    showReadout: value => value !== false,
    showChannel: value => value !== false,
    showMode: value => value !== false,
    showSigns: value => value === true,
    positiveLabels: value => value === true,
    showPercent: value => value === true,
    readoutUnit: value => choice(value, ['scale', 'percent'], 'scale'),
    showRedZone: value => value !== false,
    faceShape: value => choice(value, ['rectangle', 'ellipse', 'circle'], 'rectangle'),
    faceColor: value => color(value, '#f4dfa5'), // theme-allow: Editable meter face color.
    faceOpacity: value => Math.round(number(value, 0, 0, 1) * 100) / 100,
    faceBorderColor: value => color(value, '#332b20'), // theme-allow: Editable meter face border.
    faceBorderWidth: value => Math.round(number(value, 0, 0, 20) * 2) / 2,
    vignette: value => Math.round(number(value, 0, 0, 1) * 100) / 100
};
export const METER_APPEARANCE_DEFAULTS = Object.freeze(Object.fromEntries(
    Object.entries(METER_APPEARANCE_RULES).map(([key, rule]) => [key, rule(undefined)])));

export function normalizePalette(value, maxStops = 8) {
    const input = isRecord(value) ? value : {};
    const stops = Array.isArray(input.stops) ? input.stops.slice(0, maxStops).map(stop => ({
        pos: number(stop?.pos, 0, 0, 1), color: color(stop?.color, '#40dfff') // theme-allow: Editable scene palette fallback.
    })).sort((a, b) => a.pos - b.pos) : [];
    return {
        stops: stops.length ? stops : structuredClone(DEFAULT_PALETTE.stops),
        motion: {
            mode: choice(input.motion?.mode, ['none', 'hue', 'scroll'], 'none'),
            speed: number(input.motion?.speed, 0.25, 0, 4),
            ...(Object.hasOwn(input.motion ?? {}, 'reverse') ? { reverse: input.motion.reverse === true } : {})
        }
    };
}

export function normalizeEffect(value, target = 'item') {
    if (!isRecord(value) || !EFFECT_CATALOG[value.type]?.allowedOn.includes(target)) return null;
    const adjustment = value.type === 'color-adjust' ? Object.fromEntries(COLOR_ADJUST_PARAMETERS.map(({ key, initial, min, max }) =>
        [key, number(value[key], initial, min, max)])) : null;
    if (adjustment) adjustment.inputWhite = Math.max(adjustment.inputWhite, Number((adjustment.inputBlack + .01).toFixed(12)));
    return {
        type: value.type,
        enabled: value.enabled !== false,
        amount: number(value.amount, EFFECT_CATALOG[value.type].defaultAmount, 0, 1),
        ...(adjustment ? { ...adjustment, invert: value.invert === true } : {}),
        ...(value.type === 'color-map' ? {
            steps: value.steps === 0 || !Number.isFinite(value.steps) ? 0 : Math.round(number(value.steps, 0, 2, 16)),
            threshold: number(value.threshold, .5, 0, 1)
        } : {}),
        ...(value.type === 'edge-fade' ? {
            shape: choice(value.shape, ['rectangle', 'circle'], 'rectangle'),
            top: number(value.top, 0.1, 0, 1),
            bottom: number(value.bottom, 0.1, 0, 1),
            left: number(value.left, 0, 0, 1),
            right: number(value.right, 0, 0, 1),
            circleWidth: number(value.circleWidth, 0.2, 0, 1)
        } : {}),
        ...(value.type === 'transform' ? Object.fromEntries(TRANSFORM_PARAMETERS.map(({ key, initial, min, max }) =>
            [key, number(value[key], initial, min, max)])) : {}),
        ...(value.type === 'trail-feedback' && Object.hasOwn(value, 'angle')
            ? { angle: number(value.angle, 1.15, -3, 3) } : {}),
        ...(value.type === 'trail-feedback' && Object.hasOwn(value, 'flowX')
            ? { flowX: number(value.flowX, 0, -1, 1) } : {}),
        ...(value.type === 'trail-feedback' && Object.hasOwn(value, 'flowY')
            ? { flowY: number(value.flowY, 0, -1, 1) } : {}),
        ...(value.type === 'trail-feedback' && Object.hasOwn(value, 'zoom')
            ? { zoom: number(value.zoom, 2, -2, 2) } : {}),
        // Border width and corner radius use the same 1280-pixel-wide units as text sizes.
        ...(value.type === 'backplate' ? {
            fill: color(value.fill, '#000000'), // theme-allow: Editable backplate fill default.
            fillOpacity: Math.round(number(value.fillOpacity, 0.5, 0, 1) * 100) / 100,
            border: color(value.border, '#ffffff'), // theme-allow: Editable backplate border default.
            borderWidth: Math.round(number(value.borderWidth, 0, 0, 20) * 2) / 2,
            radius: Math.round(number(value.radius, 16, 0, 200)),
            // Positive margins extend the plate beyond the item; negative ones shrink it inside.
            margin: Math.round(number(value.margin, 0, -200, 200))
        } : {}),
        palette: normalizePalette(value.palette ?? (value.type === 'color-map' ? {
            stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] // theme-allow: Editable grayscale Color Map default.
        } : undefined)),
        mod: {
            source: choice(value.mod?.source, MOD_SOURCES, 'none'),
            depth: number(value.mod?.depth, 0, 0, 1),
            speed: number(value.mod?.speed, 1, 0, 8)
        }
    };
}

function normalizeEffects(values, target) {
    return (Array.isArray(values) ? values : []).slice(0, MAX_EFFECTS)
        .map(value => normalizeEffect(value, target)).filter(Boolean);
}

// Text decorations are optional keys so layouts saved without them stay valid; absent keys
// use TEXT_DECORATION_DEFAULTS. Lengths use the same 1280-pixel-wide units as fontSize.
const TEXT_DECORATION_RULES = {
    verticalAlign: value => choice(value, ['top', 'middle', 'bottom'], 'middle'),
    textCase: value => choice(value, ['none', 'upper', 'lower'], 'none'),
    letterSpacing: value => Math.round(number(value, 0, -20, 100)),
    outlineWidth: value => Math.round(number(value, 0, 0, 20) * 2) / 2,
    outlineColor: value => color(value, '#000000'), // theme-allow: Editable text outline default.
    shadowColor: value => color(value, '#000000'), // theme-allow: Editable text shadow default.
    shadowOpacity: value => Math.round(number(value, 0.6, 0, 1) * 100) / 100,
    shadowBlur: value => Math.round(number(value, 0, 0, 50)),
    shadowX: value => Math.round(number(value, 0, -50, 50)),
    shadowY: value => Math.round(number(value, 0, -50, 50))
};
export const TEXT_DECORATION_DEFAULTS = Object.freeze(Object.fromEntries(
    Object.entries(TEXT_DECORATION_RULES).map(([key, rule]) => [key, rule(undefined)])));

const RHYTHM_BEAT_STYLE_RULES = {
    beatSize: value => Math.round(number(value, 90, 10, 100)),
    beatLineWidth: value => Math.round(number(value, 2, 0, 20) * 2) / 2,
    beatFillOpacity: value => Math.round(number(value, 0.3, 0, 1) * 100) / 100,
    beatHoldTime: value => Math.round(number(value, 0, 0, 1000) / 10) * 10,
    beatDecayTime: value => Math.round(number(value, 90, 10, 2000) / 10) * 10,
    beatStrokeOpacity: value => Math.round(number(value, 1, 0, 1) * 100) / 100,
    beatUsePalette: value => value !== false,
    beatFillColor: value => color(value, '#40dfff'), // theme-allow: Editable beat fill default.
    beatStrokeColor: value => color(value, '#40dfff'), // theme-allow: Editable beat border default.
    beatFitBpm: value => value !== false
};
export const RHYTHM_BEAT_STYLE_DEFAULTS = Object.freeze(Object.fromEntries(
    Object.entries(RHYTHM_BEAT_STYLE_RULES).map(([key, rule]) => [key, rule(undefined)])));

function normalizeStyle(type, input) {
    const style = isRecord(input) ? input : {};
    if (TEXT_STYLE_TYPES.includes(type)) return {
        fontSize: number(style.fontSize, type === 'rhythm-analyzer' ? 96 : 36, 8, 200),
        fontFamily: choice(style.fontFamily, (type === 'counter' ? COUNTER_FONT_FAMILIES : FONT_FAMILIES).map(([family]) => family), type === 'counter' ? 'monospace' : 'sans-serif'),
        bold: style.bold === true,
        italic: style.italic === true,
        align: choice(style.align, ['left', 'center', 'right'], ['rhythm-analyzer', 'lyrics', 'counter', 'playback-control'].includes(type) ? 'center' : 'left'),
        ...(type === 'rhythm-analyzer' ? { outlineWidth: 2,
            ...Object.fromEntries(Object.entries(RHYTHM_BEAT_STYLE_RULES).map(([key, rule]) => [key, rule(style[key])])) } : {}),
        ...Object.fromEntries(Object.entries(TEXT_DECORATION_RULES)
            .filter(([key]) => Object.hasOwn(style, key)).map(([key, rule]) => [key, rule(style[key])]))
    };
    if (type === 'artwork') return { rounded: style.rounded === true };
    if (type === 'video') return {
        fit: choice(style.fit, VIDEO_FITS, 'contain'),
        rounded: style.rounded === true,
        artworkFallback: style.artworkFallback !== false
    };
    if (type === 'shape') return {
        shape: choice(style.shape, SHAPES, 'rectangle'),
        fillOpacity: Math.round(number(style.fillOpacity, 1, 0, 1) * 100) / 100,
        borderColor: color(style.borderColor, '#ffffff'), // theme-allow: Editable shape border default.
        borderWidth: Math.round(number(style.borderWidth, 2, 0, 20) * 2) / 2,
        borderOpacity: Math.round(number(style.borderOpacity, 1, 0, 1) * 100) / 100,
        radius: Math.round(number(style.radius, 0, 0, 200))
    };
    return {};
}

export function normalizeParams(type, input) {
    if (type === 'seek-bar') {
        const params = isRecord(input) ? input : {};
        return {
            thickness: number(params.thickness, 6, 2, 40),
            rounding: params.rounding !== false,
            trackColor: color(params.trackColor, '#71859b'), // theme-allow: Editable seek track color.
            trackOpacity: number(params.trackOpacity, .35, 0, 1),
            showThumb: params.showThumb !== false,
            thumbSize: number(params.thumbSize, 16, 6, 64),
            thumbColor: color(params.thumbColor, '#ffffff'), // theme-allow: Editable seek thumb color.
            thumbShape: choice(params.thumbShape, ['circle', 'square', 'diamond', 'bar'], 'circle'),
            thumbBorderWidth: Math.round(number(params.thumbBorderWidth, 0, 0, 8) * 2) / 2,
            thumbBorderColor: color(params.thumbBorderColor, '#182331') // theme-allow: Editable seek thumb border.
        };
    }
    if (type === 'playback-control') {
        const params = isRecord(input) ? input : {};
        return {
            action: choice(params.action, PLAYBACK_ACTIONS, 'play-pause'),
            display: choice(params.display, ['icon', 'icon-label', 'label'], 'icon'),
            label: typeof params.label === 'string' ? params.label.replace(/[\r\n\t]/g, ' ').slice(0, 80) : '',
            shape: choice(params.shape, ['rectangle', 'ellipse'], 'rectangle'),
            fill: color(params.fill, '#182331'), // theme-allow: Editable scene button fill.
            fillOpacity: number(params.fillOpacity, .92, 0, 1),
            border: color(params.border, '#71859b'), // theme-allow: Editable scene button border.
            borderWidth: number(params.borderWidth, 1, 0, 12),
            radius: number(params.radius, 18, 0, 200),
            iconSize: number(params.iconSize, 45, 15, 85),
            depth: number(params.depth, .35, 0, 1),
            activeColor: color(params.activeColor, '#6fe3ff') // theme-allow: Editable active control color.
        };
    }
    if (type === 'counter') {
        const params = isRecord(input) ? input : {};
        const separator = (key, fallback) => typeof params[key] === 'string' ? params[key].replace(/[\r\n\t]/g, '').slice(0, 8) : fallback;
        return {
            counterIndex: params.counterIndex === true,
            counterHours: params.counterHours !== false,
            counterMinutes: params.counterMinutes !== false,
            counterSeconds: params.counterSeconds !== false,
            counterFraction: params.counterFraction !== false,
            counterSubsecond: choice(params.counterSubsecond, ['milliseconds', 'frames'], 'milliseconds'),
            counterFps: Math.round(number(params.counterFps, 30, 1, 120)),
            counterDigits: Math.round(number(params.counterDigits, 3, 1, 4)),
            counterTimeSeparator: separator('counterTimeSeparator', ':'),
            counterFractionSeparator: separator('counterFractionSeparator', '.'),
            counterIndexSeparator: separator('counterIndexSeparator', ' '),
            counterMotion: choice(params.counterMotion, ['static', 'tape', 'flip', 'crossfade'], 'static'),
            counterDuration: number(params.counterDuration, 150, 0, 1000),
            counterWholeDigits: Math.round(number(params.counterWholeDigits, 2, 1, 8)),
            counterZeroPad: params.counterZeroPad !== false,
            counterBackgroundGlyphs: choice(params.counterBackgroundGlyphs, ['none', 'full', 'all'], 'none'),
            counterBackgroundOpacity: number(params.counterBackgroundOpacity, .05, 0, 1),
            counterBackgroundColor: color(params.counterBackgroundColor, '#808080'), // theme-allow: Editable digit backdrop.
            counterBoxes: params.counterBoxes === true,
            counterBoxColor: color(params.counterBoxColor, '#808080'), // theme-allow: Editable digit border.
            counterBoxWidth: number(params.counterBoxWidth, 1, 0, 10),
            counterBoxFill: color(params.counterBoxFill, '#000000'), // theme-allow: Editable digit window.
            counterBoxOpacity: number(params.counterBoxOpacity, 0, 0, 1),
            counterBoxRadius: number(params.counterBoxRadius, 0, 0, 20),
            counterWindowShading: params.counterWindowShading === true
        };
    }
    if (type === 'lyrics') {
        const params = isRecord(input) ? input : {};
        return {
            lyricsView: choice(params.lyricsView, ['list', 'line'], 'list'),
            lyricsNext: params.lyricsNext !== false,
            lyricsMotion: choice(params.lyricsMotion, ['step', 'smooth', 'step-horizontal', 'smooth-horizontal'], 'step'),
            lyricsStepDuration: Math.round(number(params.lyricsStepDuration, 0.18, 0, 2) * 100) / 100,
            lyricsPosition: Math.round(number(params.lyricsPosition, 50, 0, 100)),
            lyricsLineSpacing: Math.round(number(params.lyricsLineSpacing, 1, 0.5, 3) * 100) / 100,
            lyricsWordFill: params.lyricsWordFill !== false,
            lyricsOffset: Math.round(number(params.lyricsOffset, 0, -10, 10) * 100) / 100,
            lyricsFadeIn: Math.round(number(params.lyricsFadeIn, 1, 0, 10) * 10) / 10,
            lyricsFadeOut: Math.round(number(params.lyricsFadeOut, 3, 0, 10) * 10) / 10
        };
    }
    const params = isRecord(input) ? input : {};
    if (type === 'text') return { text: typeof params.text === 'string' ? params.text.slice(0, MAX_TEXT_LENGTH) : 'Text' };
    const axes = {
        showAxes: params.showAxes === true,
        showAxisNumbers: params.showAxisNumbers === true
    };
    if (type === 'spectrum' || type === 'spectrogram') return {
        dr: Math.round(number(params.dr, -96, -144, -48)),
        pt: Math.round(number(params.pt, 12, 8, 14)),
        sc: choice(params.sc, ['log', 'log-hq', 'linear'], 'log-hq'),
        kb: params.kb === true,
        kl: Math.round(number(params.kl, 100, 50, 200)),
        // Top of the frequency axis in Hz; the bottom stays at 20 Hz.
        mf: Math.round(number(params.mf, 40000, 1000, 40000) / 1000) * 1000,
        ...(type === 'spectrum' ? {
            dm: choice(params.dm, ['line', 'bar'], 'line'),
            quantizeBars: params.quantizeBars !== false,
            // Bar mode: band count and dB per segment (0 = continuous bars).
            bc: Math.round(number(params.bc, 48, 8, 128)),
            ds: Math.round(number(params.ds, 1, 0, 12) * 2) / 2,
            orientation: choice(params.orientation, ['horizontal', 'vertical'], 'horizontal'),
            // Fall times are "seconds to fall 20 dB" (0 = instant); pk is the current/peak-hold
            // display toggle, and ph/pf only matter while it is on.
            cf: Math.round(number(params.cf, 0, 0, 5) * 20) / 20,
            pk: params.pk !== false,
            ph: Math.round(number(params.ph, 0, 0, 10) * 10) / 10,
            pf: Math.round(number(params.pf, 1, 0.1, 10) * 10) / 10,
            sm: Math.round(number(params.sm, 0, 0, 1) * 100) / 100
        } : {}),
        gainDb: Math.round(number(params.gainDb, 0, -24, 24)), ...axes
    };
    if (type === 'stereo') return { wt: Math.round(number(params.wt, 0.1, 0.01, 1) * 1000) / 1000,
        gainDb: Math.round(number(params.gainDb, 0, -24, 24)), pk: params.pk !== false,
        // The DSP envelope already falls 20 dB/s, so slower peak falls are the only ones possible.
        ph: Math.round(number(params.ph, 0, 0, 10) * 10) / 10,
        pf: Math.round(number(params.pf, 1, 1, 10) * 10) / 10,
        showCorrelation: params.showCorrelation !== false, showBalance: params.showBalance !== false, ...axes };
    if (type === 'oscilloscope') return {
        dt: Math.round(number(params.dt, 0.01, 0.001, 10) * 1000) / 1000,
        tm: choice(params.tm, ['Auto', 'Normal', 'Off'], 'Auto'),
        tl: Math.round(number(params.tl, 0, -1, 1) * 100) / 100,
        te: choice(params.te, ['Rising', 'Falling'], 'Rising'),
        ho: Math.round(number(params.ho, 0.0001, 0.0001, 0.01) * 10000) / 10000,
        dl: Math.round(number(params.dl, 0, -96, 0)),
        vo: Math.round(number(params.vo, 0, -1, 1) * 100) / 100, ...axes
    };
    if (type === 'level-meter') return {
        dr: Math.round(number(params.dr, -96, -144, -48)),
        orientation: choice(params.orientation, ['horizontal', 'vertical'], 'horizontal'),
        showLevelValues: params.showLevelValues === true,
        // dB per segment; 0 draws continuous bars.
        ds: Math.round(number(params.ds, 0, 0, 12) * 2) / 2,
        // Defaults match today's fixed ballistics (FALL_RATE = 20 <=> cf = 1.0, etc.).
        cf: Math.round(number(params.cf, 1, 0, 5) * 20) / 20,
        pk: params.pk !== false,
        ph: Math.round(number(params.ph, 1, 0, 10) * 10) / 10,
        pf: Math.round(number(params.pf, 1, 0.1, 10) * 10) / 10, ...axes
    };
    if (type === 'notes') {
        const mn = Math.round(number(params.mn, 28, 21, 108));
        return {
            pr: choice(params.pr, ['Semitone', 'High'], 'Semitone'),
            ly: choice(params.ly, ['Horizontal', 'Vertical'], 'Horizontal'),
            kb: params.kb === true,
            kl: Math.round(number(params.kl, 100, 50, 200)),
            vl: params.vl !== false,
            ck: params.ck === true,
            ts: Math.round(number(params.ts, 2, 1, 10)),
            mn, mx: Math.max(mn, Math.round(number(params.mx, 91, 21, 108))), ...axes
        };
    }
    if (type === 'drums') return {
        yaw: Math.round(number(params.yaw, 0, -180, 180)),
        elevation: Math.round(number(params.elevation, 25, 5, 80)),
        shellColor: color(params.shellColor, '#a33128'), // theme-allow: Editable drum material color.
        cymbalColor: color(params.cymbalColor, '#d8af58'), // theme-allow: Editable cymbal material color.
        hardwareColor: color(params.hardwareColor, '#bcc6d0'), // theme-allow: Editable metal material color.
        headColor: color(params.headColor, '#e8e5dc') // theme-allow: Editable drumhead material color.
    };
    if (type === 'guitar') {
        const fm = Math.round(number(params.fm, 0, 0, 24));
        const tuning = Array.isArray(params.tn) && params.tn.length >= 1 && params.tn.length <= 10 ? params.tn : GUITAR_TUNINGS.standard;
        return {
            tn: tuning.map(open => Math.round(number(open, 40, 21, 108))),
            fm, fx: Math.max(fm, Math.round(number(params.fx, 12, 0, 24))),
            cp: Math.round(number(params.cp, 0, 0, 12)),
            // Positions can follow individual pitches or voice the detected chord.
            pm: choice(params.pm, ['all', 'shape', 'shape-dim', 'chord'], 'all'),
            lb: choice(params.lb, ['none', 'sharp', 'flat', 'detected', 'interval'], 'sharp'),
            // Root pitch class; -1 follows the lowest sounding note.
            ro: choice(params.ro, [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], -1),
            sk: choice(params.sk, ['none', ...Object.keys(GUITAR_SCALES)], 'none'),
            th: Math.round(number(params.th, 0.5, 0.1, 0.9) * 100) / 100,
            cf: Math.round(number(params.cf, 0.2, 0, 2) * 20) / 20,
            ly: choice(params.ly, ['Horizontal', 'Vertical'], 'Horizontal'),
            // Fretless places each note at its continuous pitch on the fret line.
            fl: params.fl === true,
            // Size by Volume scales each dot by its note's volume.
            vs: params.vs === true,
            rs: params.rs !== false, fb: params.fb !== false, mk: params.mk !== false, fn: params.fn !== false, sn: params.sn !== false
        };
    }
    if (type === 'chroma') {
        const lo = Math.round(number(params.lo, 1, 1, 8));
        return {
            dm: choice(params.dm, [0, 1], 0), lo,
            hi: Math.max(lo, Math.round(number(params.hi, 7, 1, 9))),
            ft: Math.round(number(params.ft, 3, -6, 6) * 2) / 2,
            lr: Math.round(number(params.lr, 24, 6, 96)),
            df: Math.round(number(params.df, -60, -120, -24)),
            cf: Math.round(number(params.cf, 0, 0, 5) * 20) / 20, ...axes
        };
    }
    if (type === 'phase') return {
        ax: choice(params.ax, ['phase', 'balance'], 'phase'),
        dr: Math.round(number(params.dr, -72, -96, -24) / 6) * 6,
        ml: Math.round(number(params.ml, -40, -120, -24)),
        pe: Math.round(number(params.pe, 0.5, 0.1, 2) * 10) / 10, ...axes
    };
    // Same keys, ranges, and steps as the Analog Meter effect. A needle cannot be read
    // without its dial, so this type alone shows axes and numbers by default.
    if (type === 'analog-meter') return {
        md: choice(params.md, ['VU', 'PPM', 'RMS', 'Sample Peak', 'True Peak', 'Loudness', 'Custom'], 'VU'),
        it: Math.round(number(params.it, 0.3, 0.05, 3) * 100) / 100,
        at: Math.round(number(params.at, 5, 1, 20) * 10) / 10,
        rt: Math.round(number(params.rt, 1.5, 0.1, 5) * 100) / 100,
        rl: Math.round(number(params.rl, -14, -30, 0)),
        rg: Math.round(number(params.rg, 40, 20, 60)),
        sc: choice(params.sc, [0, 1, 2], 0),
        ph: Math.round(number(params.ph, 1, 0, 10) * 10) / 10,
        ln: choice(params.ln, [0, 1], 0),
        tg: Math.round(number(params.tg, -23, -36, -10)),
        ls: choice(params.ls, [0, 1], 0),
        de: choice(params.de, ['Average Rectified', 'RMS', 'Sample Peak', 'True Peak'], 'Average Rectified'),
        nr: Math.round(number(params.nr, 300, 1, 3000)),
        os: Math.round(number(params.os, 1.25, 0, 25) * 20) / 20,
        dc: choice(params.dc, [0, 1, 2, 3, 4], 0),
        ...Object.fromEntries(Object.entries(METER_APPEARANCE_RULES).map(([key, rule]) =>
            [key, rule(key === 'hubSize' && params[key] === undefined && params.showHub === false ? 0 : params[key])])),
        showAxes: params.showAxes !== false,
        showAxisNumbers: params.showAxisNumbers !== false
    };
    // Rhythm analysis controls match the effect. Axes and their labels start on;
    // the beat circle and BPM have independent visibility controls.
    if (type === 'rhythm-analyzer') {
        const mn = Math.round(number(params.mn, 40, 40, 192));
        return {
            // Max BPM >= 1.25 x Min BPM keeps the tempo search range non-degenerate (same rule as the effect).
            mn, mx: Math.max(Math.ceil(mn * 1.25), Math.round(number(params.mx, 240, 50, 240))),
            dm: choice(params.dm, ['band', 'drums'], 'band'),
            sp: choice(params.sp, RHYTHM_SPANS, 8),
            showBeat: params.showBeat !== false,
            showBpm: params.showBpm !== false,
            // Panel toggles: tempogram strip, main lanes, echo rows, beat lens. Lanes and lens shown by default (same as the effect).
            vt: params.vt === true,
            vm: params.vm !== false,
            ve: params.ve === true,
            vl: params.vl !== false,
            showAxes: params.showAxes !== false,
            showAxisNumbers: params.showAxisNumbers !== false
        };
    }
    return {};
}

export function paletteModesForType(type) {
    if (PICTURE_TYPES.includes(type)) return [];
    if (type === 'drums') return ['solid'];
    const modes = ['solid', 'gradient'];
    if (['spectrum', 'notes', 'guitar', 'chroma'].includes(type)) modes.push('note-colors');
    if (['spectrum', 'spectrogram', 'chroma', 'level-meter', 'phase'].includes(type)) modes.push('heatmap');
    return modes;
}

function itemPalette(type, value) {
    const octave = type === 'notes' || type === 'guitar' || type === 'chroma';
    const palette = normalizePalette(value, octave ? 13 : 8);
    if (!PICTURE_TYPES.includes(type)) {
        palette.mode = choice(value?.mode, paletteModesForType(type), 'solid');
        palette.color = color(value?.color, '#40dfff'); // theme-allow: Editable scene palette fallback.
    }
    if (octave) palette.mapping = choice(value?.mapping, ['range', 'octave'], 'range');
    // Optional keys preserve the native coloring of layouts saved without a direction or angle.
    if (!PICTURE_TYPES.includes(type)) {
        const frequency = GRADIENT_DIRECTION_TYPES.includes(type);
        if (value?.direction !== undefined)
            palette.direction = choice(value.direction, frequency ? ['frequency', 'intensity', 'radial'] : ['linear', 'radial'],
                frequency ? 'frequency' : 'linear');
        if (value?.angle !== undefined) palette.angle = number(value.angle, 0, -180, 180);
    }
    return palette;
}

export function createItem(type, id = globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
    if (!ITEM_TYPES.includes(type)) throw new TypeError('Unknown visualizer item type');
    return {
        id, type, rect: type === 'playback-control' ? { x: .45, y: .75, w: .1, h: .14 }
            : NOTE_TEXT_TYPES.includes(type) ? { x: .1, y: .1, w: .4, h: .12 }
            : type === 'seek-bar' ? { x: .2, y: .9, w: .6, h: .06 } : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, channel: null,
        flipX: false, flipY: false, palette: itemPalette(type), params: normalizeParams(type), style: normalizeStyle(type), effects: []
    };
}

export function createDefaultLayout() {
    return {
        aspect: '16:9', graphScale: 1, background: { color: '#080d1c', image: null, effects: [] }, // theme-allow: Editable scene background default.
        items: [createItem('spectrum', 'main-spectrum')]
    };
}

export function normalizeLayout(value) {
    const input = isRecord(value) ? value : {};
    const background = isRecord(input.background) ? input.background : {};
    const themeColors = Object.fromEntries(THEME_COLOR_ROLES.flatMap(role =>
        typeof background.themeColors?.[role] === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(background.themeColors[role])
            ? [[role, background.themeColors[role]]] : []));
    const seen = new Set();
    const items = (Array.isArray(input.items) ? input.items : []).slice(0, MAX_ITEMS).flatMap((raw, index) => {
        if (!isRecord(raw) || !ITEM_TYPES.includes(raw.type)) return [];
        const base = createItem(raw.type, `item-${index + 1}`);
        const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 128 ? raw.id : base.id;
        if (seen.has(id)) return [];
        seen.add(id);
        const rect = isRecord(raw.rect) ? raw.rect : {};
        const w = number(rect.w, base.rect.w, MIN_ITEM_SIZE, MAX_ITEM_SIZE);
        const h = number(rect.h, base.rect.h, MIN_ITEM_SIZE, MAX_ITEM_SIZE);
        return [{
            id, type: raw.type,
            rect: { x: number(rect.x, base.rect.x, -Infinity, Infinity), y: number(rect.y, base.rect.y, -Infinity, Infinity), w, h },
            channel: VISUAL_TYPES.includes(raw.type) && CHANNELS.has(raw.channel) ? raw.channel : null,
            flipX: raw.flipX === true, flipY: raw.flipY === true,
            palette: itemPalette(raw.type, raw.palette), params: normalizeParams(raw.type, raw.params), style: normalizeStyle(raw.type, raw.style),
            effects: normalizeEffects(raw.effects, 'item')
        }];
    });
    return {
        aspect: choice(input.aspect, ASPECTS, '16:9'),
        graphScale: Math.round(number(input.graphScale, 1, 0.5, 3) * 20) / 20,
        background: {
            color: color(background.color, '#080d1c'), // theme-allow: Editable scene background fallback.
            image: typeof background.image === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(background.image)
                ? background.image : null,
            effects: normalizeEffects(background.effects, 'background'),
            ...(Object.keys(themeColors).length ? { themeColors } : {})
        },
        items
    };
}

export function validateLayout(value) {
    if (!isRecord(value) || !ASPECTS.includes(value.aspect) || !isRecord(value.background) ||
        !Array.isArray(value.items) || value.items.length > MAX_ITEMS) return false;
    if (value.background.image !== null &&
        (typeof value.background.image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(value.background.image))) return false;
    const same = (a, b) => {
        if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
            a.length === b.length && a.every((entry, index) => same(entry, b[index]));
        if (isRecord(a) || isRecord(b)) return isRecord(a) && isRecord(b) &&
            Object.keys(a).length === Object.keys(b).length &&
            Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
        return a === b;
    };
    // Added fields may be absent and valid retired fields may be migrated in older
    // layouts. Other supplied values must still match strict normalization.
    const addedParams = {
        spectrum: ['kl', 'cf', 'pk', 'ph', 'pf', 'sm', 'bc', 'ds', 'mf'], spectrogram: ['kl', 'mf'], notes: ['kl', 'ck'],
        stereo: ['pk', 'ph', 'pf'], 'level-meter': ['cf', 'pk', 'ph', 'pf', 'ds'], chroma: ['cf'],
        'analog-meter': ['de', 'nr', 'os', 'dc', ...Object.keys(METER_APPEARANCE_DEFAULTS)],
        'rhythm-analyzer': ['showBeat', 'showBpm', 'dm']
    };
    const comparable = {
        ...value,
        graphScale: Object.hasOwn(value, 'graphScale') ? value.graphScale : 1,
        items: value.items.map(item => {
            if (!isRecord(item) || !isRecord(item.params) || !Object.hasOwn(addedParams, item.type)) return item;
            const params = { ...item.params }, defaults = normalizeParams(item.type);
            if (item.type === 'analog-meter' && typeof params.showHub === 'boolean') {
                if (!Object.hasOwn(params, 'hubSize')) params.hubSize = params.showHub ? 3 : 0;
                delete params.showHub;
            }
            // Released Notes layouts stored this count before detection stopped using it.
            if (item.type === 'notes' && Number.isInteger(params.nc) && params.nc >= 1 && params.nc <= 16) delete params.nc;
            for (const key of addedParams[item.type]) if (!Object.hasOwn(params, key)) params[key] = defaults[key];
            // Rhythm layouts saved before BPM text styling have an empty style.
            const style = item.type === 'rhythm-analyzer' && isRecord(item.style)
                ? { ...normalizeStyle(item.type), ...item.style } : item.style;
            return { ...item, params, style };
        })
    };
    return same(comparable, normalizeLayout(value));
}

export function layoutsEqual(a, b) {
    return JSON.stringify(snapshotLayout(a)) === JSON.stringify(snapshotLayout(b));
}

export function snapshotLayout(value) {
    const layout = normalizeLayout(value);
    layout.background.themeColors = { ...DEFAULT_THEME_COLORS, ...layout.background.themeColors };
    return layout;
}

// Share links omit the background image because data URIs are too large for a URL.
export function encodeLayoutShare(layout) {
    const snapshot = snapshotLayout(layout);
    snapshot.background.image = null;
    return encodePipelineState(snapshot);
}

export function decodeLayoutShare(encoded) {
    try {
        const layout = decodePipelineState(encoded);
        if (validateLayout(layout)) return layout;
        console.warn('Visualizer share link contains an invalid layout.');
    } catch (error) {
        console.warn('Visualizer share link could not be decoded:', error);
    }
    return null;
}

// Only EffeTune share links (see createShareUrl) carry a layout; other sites may use `v` too.
export function layoutShareParam(text) {
    try {
        const url = new URL(String(text).trim());
        return url.pathname.endsWith('/effetune.html') ? url.searchParams.get('v') : null;
    } catch {
        return null;
    }
}
