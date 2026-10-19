import { TEXT_DECORATION_DEFAULTS } from './visualizer-model.js';
import { drawStyledText, measureStyledText } from './visualizer-text.js';
import { createLayer } from './visualizer-effects.js';

// Each wheel carries during the last visible unit before its own boundary.
// Time fields retain their real radix even when intermediate fields are hidden.
export function counterFrame(params, time, trackIndex = 0) {
    const seconds = Number.isFinite(time) ? Math.max(0, time) : 0;
    const tokens = [], fields = [];
    const frames = params.counterSubsecond === 'frames';
    const precision = frames ? params.counterFps : 10 ** params.counterDigits;
    const smallestUnit = params.counterFraction ? 1 / precision : params.counterSeconds ? 1
        : params.counterMinutes ? 60 : 3600;
    const ticks = seconds * (params.counterFraction ? precision : 1 / smallestUnit), wholeTicks = Math.floor(ticks);
    if (params.counterHours) fields.push({ unit: 3600, modulus: Infinity, width: 2 });
    if (params.counterMinutes) fields.push({ unit: 60, modulus: params.counterHours ? 60 : Infinity, width: 2 });
    if (params.counterSeconds) fields.push({ unit: 1, modulus: params.counterHours || params.counterMinutes ? 60 : Infinity, width: 2 });
    if (params.counterFraction) fields.push({ unit: 1 / precision, modulus: precision,
        width: frames ? Math.max(2, String(precision - 1).length) : params.counterDigits, fraction: true });
    const leadingField = fields.find(field => !field.fraction);
    if (leadingField) leadingField.width = params.counterWholeDigits ?? 2;
    if (params.counterIndex) {
        const index = Number.isFinite(trackIndex) ? Math.max(0, Math.floor(trackIndex)) : 0;
        for (const text of String(index).padStart(2, '0')) tokens.push({ text, next: text, previous: text, progress: 0, stationary: true });
        if (fields.length) tokens.push({ text: params.counterIndexSeparator });
    }
    fields.forEach((field, fieldIndex) => {
        if (fieldIndex) tokens.push({ text: field.fraction ? params.counterFractionSeparator : params.counterTimeSeparator });
        const fieldTicks = Math.round(field.unit / smallestUnit);
        const value = Math.floor(ticks / fieldTicks) % field.modulus;
        const text = String(value).padStart(field.width, field === leadingField && params.counterZeroPad === false ? ' ' : '0');
        for (let index = 0; index < text.length; index++) {
            const divisor = 10 ** (text.length - index - 1);
            const periodTicks = fieldTicks * divisor;
            const fieldPeriod = fieldTicks * field.modulus;
            const withinField = Number.isFinite(fieldPeriod) ? wholeTicks % fieldPeriod : wholeTicks;
            const untilCarry = Math.min(periodTicks - withinField % periodTicks, fieldPeriod - withinField);
            const progress = params.counterMotion === 'tape' && untilCarry === 1 ? ticks - wholeTicks : 0;
            const nextValue = (Math.floor(value / divisor) + 1) * divisor;
            const next = String(Math.floor((nextValue % field.modulus) / divisor) % 10);
            const previousValue = Number.isFinite(field.modulus)
                ? Math.floor(((Math.floor(value / divisor) * divisor - 1 + field.modulus) % field.modulus) / divisor) % 10
                : (Number(text[index]) + 9) % 10;
            const previous = text[index] === ' ' ? ' ' : String(previousValue);
            const period = (Math.min(nextValue, field.modulus) - Math.floor(value / divisor) * divisor) * field.unit;
            tokens.push({ text: text[index], next, previous, progress, period });
        }
    });
    return { text: tokens.map(token => token.text).join(''), tokens };
}

// The renderer keeps one state per item. Only continuous playback creates a
// transition; a seek, source change, reset or paused edit shows its value now.
export function animateCounterFrame(frame, params, descriptor, previousState = null) {
    const { time, trackIndex, external, playing = false, speed = 1, source, stamp } = descriptor;
    const format = JSON.stringify([params.counterMotion, params.counterDuration, params.counterWholeDigits,
        params.counterZeroPad, params.counterIndex, params.counterHours, params.counterMinutes,
        params.counterSeconds, params.counterFraction, params.counterDigits, params.counterSubsecond, params.counterFps, params.counterTimeSeparator,
        params.counterFractionSeparator, params.counterIndexSeparator]);
    const state = { frame, time, trackIndex, external, playing, speed, source, stamp, format, transitions: [] };
    if (!previousState || !['flip', 'crossfade'].includes(params.counterMotion)) return { frame, state };
    const elapsed = stamp - previousState.stamp, advance = time - previousState.time;
    const expected = elapsed * speed;
    const continuous = playing && previousState.playing && speed > 0 && speed === previousState.speed &&
        source === previousState.source && trackIndex === previousState.trackIndex && external === previousState.external &&
        format === previousState.format && frame.tokens.length === previousState.frame.tokens.length &&
        elapsed >= 0 && elapsed <= .5 && advance >= 0 && Math.abs(advance - expected) <= Math.max(.06, expected * .25);
    if (!continuous) return { frame, state };
    const tokens = frame.tokens.map((token, index) => {
        if (token.next === undefined || token.stationary) return token;
        const before = previousState.frame.tokens[index];
        let transition = previousState.transitions[index];
        if (token.text !== before.text) {
            // A faster digit replaces its previous transition instead of queuing
            // it. Sub-frame intervals stay still so fractional digits remain legible.
            const duration = Math.min((params.counterDuration ?? 150) / 1000, token.period / speed * .8);
            transition = duration >= 1 / 60 ? { from: before.text, start: stamp, duration } : null;
        }
        if (!transition) return token;
        const progress = (stamp - transition.start) / transition.duration;
        if (progress >= 1) return token;
        state.transitions[index] = transition;
        return { ...token, from: transition.from, transitionProgress: progress };
    });
    return { frame: { ...frame, tokens }, state };
}

// Text decoration and scene scaling match the other text items. Fixed-width
// digit cells prevent proportional fonts from shifting the remaining wheels.
export function drawCounter(ctx, item, frame, w, h, scale, paint, paintLayer = null) {
    if (!frame.tokens.length) return null;
    // Wheel transforms must not restart the palette at every digit. A pattern
    // can retain item-space coordinates while each glyph turns independently.
    if (typeof paint !== 'string') {
        paintLayer ||= createLayer(w, h);
        if (paintLayer.width !== w) paintLayer.width = w;
        if (paintLayer.height !== h) paintLayer.height = h;
        const palette = paintLayer.getContext('2d');
        palette.clearRect(0, 0, w, h);
        palette.fillStyle = paint; palette.fillRect(0, 0, w, h);
        paint = ctx.createPattern(paintLayer, 'no-repeat');
    }
    const alignPaint = () => { if (typeof paint !== 'string') paint.setTransform(ctx.getTransform().inverse()); };
    const style = { ...TEXT_DECORATION_DEFAULTS, ...item.style };
    const outline = style.outlineWidth * scale;
    const digitWidth = Math.max(...Array.from({ length: 10 }, (_, digit) => measureStyledText(ctx, String(digit),
        { ...style, letterSpacing: 0 }, scale))) + style.fontSize * scale * .16 + outline * 2;
    const spacing = Math.max(-digitWidth / 2, style.letterSpacing * scale);
    const widths = frame.tokens.map(token => token.next === undefined ? measureStyledText(ctx, token.text, style, scale) + outline * 2 : digitWidth);
    const naturalWidth = widths.reduce((sum, width) => sum + width, 0) + spacing * Math.max(0, widths.length - 1);
    const cellHeight = style.fontSize * scale * 1.5 + outline * 2;
    const fit = Math.min(1, w / Math.max(1, naturalWidth), h / cellHeight);
    const width = naturalWidth * fit, height = cellHeight * fit;
    const left = style.align === 'left' ? 0 : style.align === 'right' ? w - width : (w - width) / 2;
    const top = style.verticalAlign === 'top' ? 0 : style.verticalAlign === 'bottom' ? h - height : (h - height) / 2;
    const glyphStyle = { ...style, letterSpacing: 0, align: 'center', verticalAlign: 'middle' };
    const inactiveStyle = { ...glyphStyle, shadowOpacity: 0, outlineWidth: 0 };
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(fit, fit);
    let x = 0;
    frame.tokens.forEach((token, index) => {
        const cellWidth = widths[index];
        ctx.save();
        ctx.translate(x, 0);
        alignPaint();
        const digit = token.next !== undefined;
        if (digit && item.params.counterBoxes) {
            const border = (item.params.counterBoxWidth ?? 1) * scale;
            const radius = Math.min((item.params.counterBoxRadius || 0) * scale, cellWidth / 2, cellHeight / 2);
            ctx.beginPath();
            ctx.roundRect(border / 2, border / 2, Math.max(0, cellWidth - border), Math.max(0, cellHeight - border), radius);
            ctx.save();
            ctx.globalAlpha *= item.params.counterBoxOpacity || 0;
            ctx.fillStyle = item.params.counterBoxFill || '#000000'; ctx.fill(); // theme-allow: User-selected Counter digit-window fill fallback.
            ctx.restore();
            if (border > 0) {
                ctx.strokeStyle = item.params.counterBoxColor || '#808080'; // theme-allow: User-selected Counter digit-window border fallback.
                ctx.lineWidth = border; ctx.stroke();
            }
        }
        if (digit && item.params.counterBackgroundGlyphs && item.params.counterBackgroundGlyphs !== 'none') {
            const full = /EffeTune (?:Seven Segment|Dot Matrix)/.test(style.fontFamily) ? '\uE000' : '8';
            const background = item.params.counterBackgroundGlyphs === 'all' ? '0123456789' : full;
            ctx.save();
            ctx.globalAlpha *= item.params.counterBackgroundOpacity ?? .05;
            for (const glyph of background) drawStyledText(ctx, glyph, inactiveStyle, cellWidth, cellHeight, scale,
                item.params.counterBackgroundColor || '#808080'); // theme-allow: User-selected Counter background-glyph color fallback.
            ctx.restore();
        }
        const drawGlyph = glyph => {
            alignPaint();
            drawStyledText(ctx, glyph, glyphStyle, cellWidth, cellHeight, scale, paint);
        };
        if (digit && !token.stationary && item.params.counterMotion === 'tape') {
            ctx.beginPath(); ctx.rect(0, 0, cellWidth, cellHeight); ctx.clip();
            for (const [step, glyph] of [[-1, token.previous], [0, token.text], [1, token.next]]) {
                const angle = (step - token.progress) * Math.PI / 3;
                if (Math.abs(angle) >= Math.PI / 2) continue;
                ctx.save();
                ctx.translate(0, cellHeight / 2 + Math.sin(angle) * cellHeight * .65);
                ctx.scale(1, Math.cos(angle));
                alignPaint();
                drawStyledText(ctx, glyph, glyphStyle, cellWidth, cellHeight, scale, paint, undefined, undefined, -cellHeight / 2);
                ctx.restore();
            }
        } else if (token.from !== undefined && item.params.counterMotion === 'crossfade') {
            ctx.save(); ctx.globalAlpha *= 1 - token.transitionProgress; drawGlyph(token.from); ctx.restore();
            ctx.save(); ctx.globalAlpha *= token.transitionProgress; drawGlyph(token.text); ctx.restore();
        } else if (digit && item.params.counterMotion === 'flip') {
            const half = cellHeight / 2;
            const drawHalf = (glyph, lower, compression = 1, shade = 0, covered = 0) => {
                ctx.save();
                ctx.translate(0, half); ctx.scale(1, compression); ctx.translate(0, -half);
                ctx.beginPath(); ctx.rect(0, lower ? half * (1 + covered) : 0, cellWidth, half * (1 - covered)); ctx.clip();
                drawGlyph(glyph);
                if (shade > 0) {
                    ctx.fillStyle = `rgba(0,0,0,${shade})`; // theme-allow: Physical shadow on a flipping Counter digit.
                    ctx.fillRect(0, lower ? half : 0, cellWidth, half);
                }
                ctx.restore();
            };
            if (token.from !== undefined) {
                const progress = token.transitionProgress;
                const compression = Math.abs(Math.cos(progress * Math.PI));
                drawHalf(token.text, false, 1, 0, progress < .5 ? compression : 0);
                drawHalf(token.from, true, 1, 0, progress < .5 ? 0 : compression);
                if (progress < .5) drawHalf(token.from, false, compression, Math.sin(progress * Math.PI) * .3);
                else drawHalf(token.text, true, compression, Math.sin(progress * Math.PI) * .3);
            } else drawGlyph(token.text);
            ctx.fillStyle = 'rgba(0,0,0,.45)'; // theme-allow: Physical seam between Counter flip panels.
            ctx.fillRect(0, half - scale / 2, cellWidth, scale);
        } else drawGlyph(token.text);
        if (digit && item.params.counterBoxes && item.params.counterWindowShading) {
            const shade = ctx.createLinearGradient(0, 0, 0, cellHeight);
            shade.addColorStop(0, 'rgba(0,0,0,.6)'); shade.addColorStop(.25, 'rgba(0,0,0,0)'); // theme-allow: Physical shadow inside the Counter digit window.
            shade.addColorStop(.75, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.6)'); // theme-allow: Physical shadow inside the Counter digit window.
            ctx.fillStyle = shade;
            ctx.beginPath();
            ctx.roundRect(0, 0, cellWidth, cellHeight, Math.min((item.params.counterBoxRadius || 0) * scale, cellWidth / 2, cellHeight / 2));
            ctx.fill();
        }
        ctx.restore();
        x += cellWidth + spacing;
    });
    ctx.restore();
    return { left, right: left + width, top, bottom: top + height };
}
