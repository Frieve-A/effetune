import { TEXT_DECORATION_DEFAULTS } from './visualizer-model.js';

// Shared typography for metadata, decoration text, and the Rhythm Analyzer BPM overlay.
export function drawStyledText(ctx, raw, inputStyle, w, h, scale, fillStyle, fitRadius) {
    const style = { ...TEXT_DECORATION_DEFAULTS, ...inputStyle };
    const text = style.textCase === 'upper' ? raw.toUpperCase() : style.textCase === 'lower' ? raw.toLowerCase() : raw;
    ctx.save();
    ctx.fillStyle = fillStyle;
    if (fitRadius !== undefined) {
        ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize * scale}px ${style.fontFamily || 'sans-serif'}`;
        ctx.letterSpacing = `${style.letterSpacing * scale}px`;
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
    ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize * scale}px ${style.fontFamily || 'sans-serif'}`;
    ctx.letterSpacing = `${spacing}px`;
    ctx.textAlign = style.align;
    ctx.textBaseline = style.verticalAlign;
    // Keep the outline inside the item box; letter spacing also trails the last glyph.
    const x = style.align === 'center' ? (w + spacing) / 2 : style.align === 'right' ? w - outline + spacing : outline;
    const lines = text.split(/\r\n|\r|\n/), lineHeight = style.fontSize * scale * 1.2;
    const lineSpan = (lines.length - 1) * lineHeight;
    const y = style.verticalAlign === 'top' ? outline : style.verticalAlign === 'bottom' ? h - outline - lineSpan : (h - lineSpan) / 2;
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
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight, maxWidth));
    ctx.restore();
}
