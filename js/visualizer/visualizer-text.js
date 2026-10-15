import { TEXT_DECORATION_DEFAULTS } from './visualizer-model.js';

export const TEXT_LINE_HEIGHT = 1.2;

const textContent = (raw, style) => style.textCase === 'upper' ? raw.toUpperCase() : style.textCase === 'lower' ? raw.toLowerCase() : raw;
const setTextFont = (ctx, style, scale) => {
    ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize * scale}px ${style.fontFamily || 'sans-serif'}`;
    ctx.letterSpacing = `${style.letterSpacing * scale}px`;
};

export function measureStyledText(ctx, raw, inputStyle, scale) {
    const style = { ...TEXT_DECORATION_DEFAULTS, ...inputStyle };
    ctx.save();
    setTextFont(ctx, style, scale);
    const width = Math.max(...textContent(raw, style).split(/\r\n|\r|\n/).map(line => ctx.measureText(line).width));
    ctx.restore();
    return width;
}

// Shared typography for metadata, decoration text, and the Rhythm Analyzer BPM overlay.
export function drawStyledText(ctx, raw, inputStyle, w, h, scale, fillStyle, fitRadius, filledCharacters, offsetY = 0, paintFill, offsetX = 0) {
    const style = { ...TEXT_DECORATION_DEFAULTS, ...inputStyle };
    const text = textContent(raw, style);
    ctx.save();
    ctx.fillStyle = fillStyle;
    if (fitRadius !== undefined) {
        setTextFont(ctx, style, scale);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(text);
        // Fit the whole outlined text rectangle inside the circle, allowing for the
        // vertical extent around the middle baseline and the trailing letter spacing.
        const halfWidth = Math.max(metrics.width / 2, Math.abs(metrics.actualBoundingBoxLeft || 0),
            Math.abs(metrics.actualBoundingBoxRight || 0)) + (Math.abs(style.letterSpacing) / 2 + style.outlineWidth) * scale;
        const halfHeight = Math.max(Math.abs(metrics.actualBoundingBoxAscent || 0),
            Math.abs(metrics.actualBoundingBoxDescent || 0), style.fontSize * scale * 0.65) + style.outlineWidth * scale;
        const radius = Math.hypot(halfWidth, halfHeight);
        if (radius > fitRadius) scale *= fitRadius / radius;
    }
    const outline = style.outlineWidth * scale, spacing = style.letterSpacing * scale;
    setTextFont(ctx, style, scale);
    ctx.textAlign = style.align;
    ctx.textBaseline = style.verticalAlign;
    // Keep the outline inside the item box; letter spacing also trails the last glyph.
    const x = offsetX + (style.align === 'center' ? (w + spacing) / 2 : style.align === 'right' ? w - outline + spacing : outline);
    const lines = text.split(/\r\n|\r|\n/), lineHeight = style.fontSize * scale * TEXT_LINE_HEIGHT;
    const lineSpan = (lines.length - 1) * lineHeight;
    const y = offsetY + (style.verticalAlign === 'top' ? outline : style.verticalAlign === 'bottom' ? h - outline - lineSpan : (h - lineSpan) / 2);
    const maxWidth = Math.max(1, w - outline * 2);
    if (style.shadowOpacity > 0 && (style.shadowBlur || style.shadowX || style.shadowY)) {
        ctx.shadowColor = `${style.shadowColor}${Math.round(style.shadowOpacity * 255).toString(16).padStart(2, '0')}`;
        ctx.shadowBlur = style.shadowBlur * scale;
        ctx.shadowOffsetX = style.shadowX * scale;
        ctx.shadowOffsetY = style.shadowY * scale;
    }
    if (outline > 0) {
        // The fill covers the inner half of the stroke, so double it; only the
        // outline casts the shadow to avoid a doubled, darker shadow.
        ctx.strokeStyle = style.outlineColor;
        ctx.lineWidth = outline * 2;
        ctx.lineJoin = 'round';
        lines.forEach((line, index) => ctx.strokeText(line, x, y + index * lineHeight, maxWidth));
        ctx.shadowColor = 'transparent';
    }
    lines.forEach((line, index) => {
        if (paintFill) paintFill(line, x, y + index * lineHeight, maxWidth);
        else ctx.fillText(line, x, y + index * lineHeight, maxWidth);
    });
    let fill;
    if (filledCharacters !== undefined) {
        const width = ctx.measureText(text).width;
        const count = Math.max(0, Math.min(raw.length, filledCharacters));
        const prefix = raw.slice(0, Math.floor(count));
        const prefixWidth = ctx.measureText(textContent(prefix, style)).width;
        const nextWidth = ctx.measureText(textContent(raw.slice(0, Math.ceil(count)), style)).width;
        const drawnWidth = Math.min(width, maxWidth);
        fill = { left: x - (style.align === 'center' ? drawnWidth / 2 : style.align === 'right' ? drawnWidth : 0),
            filled: width > 0 ? drawnWidth * (prefixWidth + (nextWidth - prefixWidth) * (count % 1)) / width : 0 };
    }
    ctx.restore();
    return fill;
}
