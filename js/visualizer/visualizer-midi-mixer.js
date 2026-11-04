import { paletteGradient } from './visualizer-effects.js';
import { DEFAULT_THEME_COLORS } from './visualizer-model.js';
import { createBallistics, stepBallistics } from './visualizer-ballistics.js';
import { midiChannelColor } from './visualizer-midi.js';

const CONTROLLERS = [['Vol.', 'volume', 7], ['Pan', 'pan', 10], ['EXP', 'expression', 11],
    ['Rev.', 'reverb', 91], ['Cho.', 'chorus', 93]];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const FLASH_SECONDS = .65;

const swatch = (theme, role) => theme?.[role] ?? DEFAULT_THEME_COLORS[role];
const noteColor = pitch => {
    const rgb = globalThis.window?.NoteSpectrogramPlugin?.noteColor?.(pitch);
    return rgb ? `rgb(${rgb.join(',')})` : `hsl(${pitch % 12 * 30}, 85%, 58%)`; // theme-allow: Pitch classes use distinct hues to identify notes.
};

export class MidiMixerDisplay {
    constructor(canvas, sources) {
        this.canvas = canvas;
        this.sources = sources;
        this.previousSource = null;
        this.previousMixerState = null;
        this.previousPresets = null;
        this.waitForMixerState = null;
        this.meterRows = [];
        this.flashRows = [];
    }

    dispose() {}

    draw(item, time, cssWidth, theme) {
        const ctx = this.canvas.getContext('2d');
        const { width, height } = this.canvas;
        const snapshot = this.sources.getFrame(item.id);
        const mixer = snapshot?.sourceKind === 'midi' && (snapshot.playing || snapshot.paused)
            ? this.sources.getSoundFontMixer() : null;
        // A new score must receive a new mixer frame before reusing instrument data.
        if (snapshot?.source !== this.previousSource) {
            this.waitForMixerState = this.previousMixerState;
            this.previousSource = snapshot?.source;
            this.meterRows = [];
            this.flashRows = [];
        }
        // The snapshot keeps this array stable until the SoundFont or player changes.
        if (mixer?.presets !== this.previousPresets) {
            this.previousPresets = mixer?.presets;
            this.meterRows = [];
            this.flashRows = [];
        }
        if (mixer?.state) this.previousMixerState = mixer.state;
        const state = mixer?.state !== this.waitForMixerState ? mixer?.state : null;
        const params = item.params;
        const first = params.channelStart - 1, last = params.channelEnd;
        const rows = last - first;
        const scale = cssWidth > 0 ? width / cssWidth : 1;
        const headerHeight = Math.min(35 * scale, Math.max(16 * scale, height / (rows + 1)));
        const rowHeight = Math.max(1, (height - headerHeight) / rows);
        const fontSize = Math.max(7 * scale, Math.min(params.fontSize * scale, headerHeight * .54, rowHeight * .56));
        const accent = item.palette.mode === 'gradient'
            ? paletteGradient(ctx, item.palette, width, time, false, height) : item.palette.color;
        const columns = [['Ch', .055, 'channel']];
        if (params.showPatch) columns.push(['Patch', .19, 'patch']);
        if (params.showKeyboard) columns.push(['Notes', .31, 'keyboard']);
        if (params.showLevel) columns.push(['Level', .10, 'level']);
        if (params.showVoices) columns.push([state ? `Voices ${state.voices}/${state.limit}` : 'Voices', .10, 'voices']);
        if (params.showControllers) columns.push(...CONTROLLERS.map(([label, key]) => [label, .065, key]));
        if (params.showState) columns.push(['Mute', .06, 'mute'], ['Solo', .06, 'solo']);
        const sum = columns.reduce((total, column) => total + column[1], 0);
        const edges = [0];
        for (const [, weight] of columns) edges.push(edges.at(-1) + width * weight / sum);
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(item.flipX ? width : 0, item.flipY ? height : 0);
        ctx.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
        ctx.fillStyle = swatch(theme, 'graph-bg-deep');
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = swatch(theme, 'graph-base-soft');
        ctx.fillRect(0, 0, width, headerHeight);
        ctx.font = `${fontSize}px ${params.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = accent;
        for (let index = 0; index < columns.length; index++) {
            const [label] = columns[index], left = edges[index], right = edges[index + 1];
            ctx.fillText(label, left + 3, headerHeight / 2, Math.max(1, right - left - 6));
        }
        const hasMixer = !!state;
        for (let channel = first; channel < last; channel++) {
            const row = channel - first, top = headerHeight + row * rowHeight;
            const projected = snapshot?.channels?.[channel];
            const data = state?.channels?.[channel];
            const flashValues = data ? [`${data.bank}:${data.program}:${data.presetIndex}`,
                data.volume, data.pan, data.expression, data.reverb, data.chorus]
                : projected ? [`${projected.cc[0]}:${projected.cc[32]}:${projected.program}`,
                    ...CONTROLLERS.map(([, , controller]) => projected.cc[controller])] : null;
            const flashMode = data ? 'mixer' : 'projected';
            const previous = this.flashRows[channel];
            const flashTimes = previous?.mode === flashMode ? previous.times : Array(6).fill(-Infinity);
            if (flashValues && previous?.mode === flashMode && params.flashChanges) {
                for (let index = 0; index < flashValues.length; index++) {
                    if (flashValues[index] !== previous.values[index]) flashTimes[index] = time;
                }
            }
            if (!params.flashChanges) flashTimes.fill(-Infinity);
            this.flashRows[channel] = flashValues ? { mode: flashMode, values: flashValues, times: flashTimes } : null;
            const filtered = hasMixer && mixer.channelFilter && mixer.channelFilter !== channel + 1;
            if (row % 2 === 1) {
                ctx.globalAlpha = .45;
                ctx.fillStyle = swatch(theme, 'graph-base-soft');
                ctx.fillRect(0, top, width, rowHeight);
                ctx.globalAlpha = 1;
            }
            if (filtered) ctx.globalAlpha = .45;
            for (let index = 0; index < columns.length; index++) {
                const [, , key] = columns[index], left = edges[index], right = edges[index + 1];
                const controller = CONTROLLERS.find(([, name]) => name === key);
                const flashIndex = key === 'patch' ? 0 : controller ? CONTROLLERS.indexOf(controller) + 1 : -1;
                const elapsed = flashIndex < 0 ? Infinity : time - flashTimes[flashIndex];
                const flash = params.flashChanges && elapsed >= 0 && elapsed < FLASH_SECONDS
                    ? (1 - elapsed / FLASH_SECONDS) ** 2 : 0;
                if (key === 'keyboard') {
                    this.drawKeyboard(ctx, left + 2, top + 3, right - left - 4, rowHeight - 6,
                        data?.notes, snapshot?.playing || snapshot?.paused ? projected?.notes : [],
                        params.keyboardColor, channel, params.keyboardActiveColor);
                } else if (key === 'level') {
                    this.drawLevel(ctx, left + 3, top + 3, right - left - 6, rowHeight - 6,
                        data?.levelPeak, state, channel, params.levelMeter, params.levelPalette, time, scale, accent, theme);
                } else if (controller) {
                    this.drawKnob(ctx, left, top, right - left, rowHeight,
                        data?.[key] ?? projected?.cc?.[controller[2]], accent, theme, scale, params, flash);
                } else {
                    let value;
                    if (key === 'channel') value = String(channel + 1).padStart(2, '0');
                    else if (key === 'patch') value = this.patchName(data, projected, mixer?.presets);
                    else if (key === 'mute' || key === 'solo') value = data ? (data[key] ? 'On' : 'Off') : '—';
                    else if (key === 'voices') value = data ? String(data.voices) : '—';
                    else value = '—';
                    if (key === 'patch' && flash) this.drawFlash(ctx, left, top, right - left, rowHeight,
                        flash, params.flashColor, scale);
                    ctx.fillStyle = accent;
                    const numeric = key === 'voices';
                    ctx.textAlign = numeric ? 'right' : 'left';
                    const textX = numeric ? (left + right) / 2 + this.numericWidth(ctx, scale) / 2 : left + 3;
                    ctx.fillText(value, numeric ? Math.min(right - 3, textX) : textX,
                        top + rowHeight / 2, Math.max(1, right - left - 6));
                    ctx.textAlign = 'left';
                }
            }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        return true;
    }

    patchName(data, projected, presets) {
        if (data) {
            if (data.presetIndex !== 0xffff) {
                const preset = presets?.find(entry => entry.bank === data.bank && entry.program === data.program);
                if (preset) return preset.name;
                return `${data.bank ? `Bank ${data.bank} · ` : ''}Program ${data.program + 1}`;
            }
            const bank = data.sourceBankMsb || data.sourceBankLsb
                ? `Bank ${data.sourceBankMsb}:${data.sourceBankLsb} · ` : '';
            return `${bank}Program ${data.sourceProgram + 1}`;
        }
        if (!projected) return '—';
        const bank = projected.cc[0] || projected.cc[32]
            ? `Bank ${projected.cc[0]}:${projected.cc[32]} · ` : '';
        return `${bank}Program ${projected.program + 1}`;
    }

    drawLevel(ctx, x, y, width, height, samplePeak, frame, channel, params, palette, time, scale, textColor, theme) {
        if (!(width > 0 && height > 0)) return;
        ctx.fillStyle = swatch(theme, 'graph-base-soft');
        ctx.fillRect(x, y, width, height);
        if (!Number.isFinite(samplePeak)) {
            this.meterRows[channel] = null;
            ctx.fillStyle = textColor;
            ctx.fillText('—', x + 2, y + height / 2, Math.max(1, width - 4));
            return;
        }
        const now = performance.now() / 1000;
        const previous = this.meterRows[channel];
        const meter = previous && !!previous.ballistics.peak === params.pk ? previous
            : { ballistics: createBallistics(1, params.pk), raw: new Float64Array(1), frame: null, time: now };
        const elapsed = Math.max(0, now - meter.time);
        // A repeated telemetry snapshot has no new measurement; retain its last raw
        // level so instant fall does not blink between audio and animation frames.
        if (frame !== meter.frame) meter.raw[0] = samplePeak > 0 ? Math.max(-144, Math.min(0, 20 * Math.log10(samplePeak))) : -144;
        stepBallistics(meter.ballistics, meter.raw, elapsed, params.cf, params.ph, params.pf);
        meter.frame = frame;
        meter.time = now;
        this.meterRows[channel] = meter;
        const vertical = params.orientation === 'vertical';
        const level = meter.ballistics.cur[0], peak = meter.ballistics.peak?.[0];
        const fraction = db => Math.max(0, Math.min(1, (db - params.dr) / -params.dr));
        const labelHeight = params.showAxisNumbers && !vertical ? Math.min(height * .4, 10 * scale) : 0;
        const barY = y, barHeight = height - labelHeight;
        const length = vertical ? barHeight : width;
        const rect = (start, extent, color) => {
            ctx.fillStyle = color;
            if (vertical) ctx.fillRect(x, barY + barHeight - start - extent, width, extent);
            else ctx.fillRect(x + start, barY, extent, barHeight);
        };
        let style = palette.color;
        if (palette.mode === 'gradient') {
            ctx.save();
            ctx.translate(x, barY);
            style = paletteGradient(ctx, palette, width, time, vertical, barHeight);
            ctx.restore();
        } else if (palette.mode === 'heatmap') {
            const lut = globalThis.window?.SpectrogramPlugin?.getHeatmapLuts?.().rgba;
            if (lut) {
                style = ctx.createLinearGradient(x, barY + (vertical ? barHeight : 0), x + (vertical ? 0 : width), barY);
                for (let index = 0; index < 256; index++) {
                    const offset = index * 4;
                    style.addColorStop(index / 255, `rgba(${lut[offset]},${lut[offset + 1]},${lut[offset + 2]},${lut[offset + 3] / 255})`);
                }
            }
        }
        const segment = params.ds > 0 ? length * params.ds / -params.dr : 0;
        const currentLength = fraction(level) * length;
        if (segment) {
            const count = Math.floor(currentLength / segment);
            for (let index = 0; index < count; index++) rect(index * segment + scale / 2, Math.max(0, segment - scale), style);
        } else rect(0, currentLength, style);
        if (params.pk && fraction(peak) > 0) {
            const position = fraction(peak) * length;
            if (segment) {
                const block = Math.min(Math.ceil(position / segment), Math.floor(length / segment));
                if (block > 0) rect((block - 1) * segment + scale / 2, Math.max(0, segment - scale), style);
            } else rect(Math.max(0, position - 2 * scale), Math.min(position, 2 * scale), textColor);
        }
        for (let index = 0; index <= 4; index++) {
            const position = index * length / 4;
            if (params.showAxes) rect(Math.min(position, length - scale / 2), scale / 2, swatch(theme, 'graph-grid-strong'));
            if (params.showAxisNumbers && (!vertical || index === 0 || index === 4)) {
                ctx.textAlign = vertical || index === 0 ? 'left' : index === 4 ? 'right' : 'center';
                ctx.fillStyle = textColor;
                ctx.fillText(String(Math.round(params.dr * (1 - index / 4))), vertical ? x + scale : x + width * index / 4,
                    vertical ? y + Math.max(4 * scale, Math.min(height - 4 * scale, height - position))
                        : y + height - labelHeight / 2, Math.max(1, width / (vertical ? 1 : 5)));
            }
        }
        if (params.showLevelValues) {
            const value = params.pk ? peak : level;
            ctx.textAlign = 'right';
            ctx.fillStyle = textColor;
            ctx.fillText(`${value.toFixed(1)} dB`, x + width - 2 * scale,
                barY + barHeight / 2, Math.max(1, width - 4 * scale));
        }
        ctx.textAlign = 'left';
    }

    numericWidth(ctx, scale) {
        return ctx.measureText ? Math.max(...Array.from('0123456789', digit => ctx.measureText(digit).width)) * 3 : 21 * scale;
    }

    drawFlash(ctx, x, y, width, height, intensity, accent, scale) {
        const alpha = ctx.globalAlpha;
        ctx.globalAlpha = alpha * intensity * .25;
        ctx.fillStyle = accent;
        ctx.fillRect(x + scale, y + scale, Math.max(0, width - 2 * scale), Math.max(0, height - 2 * scale));
        ctx.globalAlpha = alpha * intensity;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, scale);
        ctx.strokeRect(x + scale, y + scale, Math.max(0, width - 2 * scale), Math.max(0, height - 2 * scale));
        ctx.globalAlpha = alpha;
    }

    drawKnob(ctx, x, y, width, height, value, accent, theme, scale, params, flash) {
        if (!Number.isFinite(value)) {
            ctx.fillStyle = accent;
            ctx.textAlign = 'center';
            ctx.fillText('—', x + width / 2, y + height / 2, width);
            ctx.textAlign = 'left';
            return;
        }
        const showValue = params.knobValuePosition !== 'none';
        const valueRight = showValue && params.knobValuePosition === 'right';
        const valueWidth = valueRight ? Math.min(this.numericWidth(ctx, scale), width * .48) : 0;
        const gap = valueRight ? Math.min(3 * scale, width * .05) : 0;
        const centerY = y + height * (showValue && !valueRight ? .4 : .5);
        const radius = Math.max(1, Math.min(
            Math.min(width * .23, height * (showValue && !valueRight ? .25 : .38), 10 * scale)
                * params.knobSize / 100,
            (width - valueWidth - gap - 4 * scale) / 2,
            centerY - y - 2 * scale, y + height - centerY - 2 * scale,
            width / 2 - 2 * scale));
        // Center the complete knob and fixed three-digit value box as one group.
        const groupWidth = radius * 2 + gap + valueWidth;
        const centerX = x + (width - groupWidth) / 2 + radius;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        if (params.knobStyle === 'filled') {
            ctx.fillStyle = params.knobFillColor;
            ctx.fill();
        }
        ctx.strokeStyle = params.knobOutlineColor;
        ctx.lineWidth = Math.max(.5, scale * .75);
        ctx.stroke();
        const angle = (-135 + Math.max(0, Math.min(127, value)) / 127 * 270) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.sin(angle) * radius * .3, centerY - Math.cos(angle) * radius * .3);
        ctx.lineTo(centerX + Math.sin(angle) * radius * .82, centerY - Math.cos(angle) * radius * .82);
        ctx.strokeStyle = params.knobIndicatorColor;
        ctx.lineWidth = Math.max(1, scale * 1.5);
        ctx.stroke();
        if (flash) {
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * flash;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius + Math.max(1, scale * 1.5), 0, Math.PI * 2);
            ctx.strokeStyle = params.flashColor;
            ctx.lineWidth = Math.max(1, scale * 2);
            ctx.stroke();
            ctx.globalAlpha = alpha;
        }
        if (showValue) {
            ctx.textAlign = valueRight ? 'right' : 'center';
            ctx.fillStyle = accent;
            ctx.fillText(String(value), valueRight ? x + (width + groupWidth) / 2 : centerX,
                valueRight ? centerY : y + height * .82, Math.max(1, valueRight ? valueWidth : width - 4 * scale));
        }
        ctx.textAlign = 'left';
    }

    drawKeyboard(ctx, x, y, width, height, sounding, held, mode, channel, accent) {
        if (height <= 0 || width <= 0) return;
        const pressed = pitch => sounding
            ? !!(sounding[pitch >> 3] & (1 << (pitch & 7)))
            : !!held?.some(note => note.pitch === pitch);
        const positions = [];
        let whiteCount = 0;
        for (let pitch = 0; pitch < 128; pitch++) {
            positions[pitch] = whiteCount;
            if (!BLACK_KEYS.has(pitch % 12)) whiteCount++;
        }
        const keyWidth = width / whiteCount;
        for (const black of [false, true]) for (let pitch = 0; pitch < 128; pitch++) {
            if (BLACK_KEYS.has(pitch % 12) !== black) continue;
            const keyX = x + positions[pitch] * keyWidth - (black ? keyWidth * .3 : 0);
            const keySize = black ? keyWidth * .6 : keyWidth;
            const keyHeight = black ? height * .62 : height;
            ctx.fillStyle = pressed(pitch) ? mode === 'channel' ? midiChannelColor(channel)
                : mode === 'rainbow' ? noteColor(pitch) : accent
                : black ? '#111111' : '#eeeeee'; // theme-allow: Piano key colors match the SoundFont mixer.
            ctx.fillRect(keyX, y, keySize, keyHeight);
            ctx.strokeStyle = '#777777'; // theme-allow: Key outlines stay visible on the fixed piano colors.
            ctx.lineWidth = .5;
            ctx.strokeRect(keyX, y, keySize, keyHeight);
        }
    }
}
