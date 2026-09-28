import { createLayer, drawBackplates, paletteGradient, VisualizerEffects } from './visualizer-effects.js';

import { createAnalyzerDisplay } from './visualizer-analyzer-display.js';
import { REFERENCE_WIDTH, TEXT_DECORATION_DEFAULTS } from './visualizer-model.js';

const ANALYZER_TYPES = new Set(['spectrum', 'spectrogram', 'oscilloscope', 'stereo', 'notes', 'chroma', 'level-meter', 'phase', 'analog-meter']);

export class VisualizerRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.layers = new Map();
        this.effects = new VisualizerEffects();
        this.images = new Map();
        this.quality = 0;
        this.cost = 0;
        this.qualityFrames = 0;
    }

    image(url) {
        if (!url) return null;
        let image = this.images.get(url);
        if (!image) { image = new Image(); image.src = url; this.images.set(url, image); }
        return image.complete && image.naturalWidth ? image : null;
    }

    dispose() {
        for (const state of this.layers.values()) state.display?.dispose();
        this.layers.clear();
    }

    draw(layout, sources, metadata, time, { editing = false, quality = 'auto' } = {}) {
        const start = performance.now();
        const stage = this.canvas, ctx = stage.getContext('2d');
        if (!ctx || !stage.width || !stage.height) return;
        // Graphics scale with the output width on the 1280-wide basis, so a layout looks
        // the same at any resolution. Analyzer graphics additionally follow Graph Scale.
        const stageScale = stage.width / REFERENCE_WIDTH;
        const graphScale = stageScale * (layout.graphScale ?? 1);
        if (quality === 'high') this.quality = 0;
        if (quality === 'low') this.quality = 3;
        ctx.clearRect(0, 0, stage.width, stage.height);
        const modulators = sources.getModulators();
        const alive = new Set(['background']);
        const background = { id: 'background', type: 'background', rect: { x: 0, y: 0, w: 1, h: 1 }, ...layout.background };
        const imageUrls = new Set([layout.background.image, metadata?.artwork?.[0]?.src]);
        for (const url of this.images.keys()) if (!imageUrls.has(url)) this.images.delete(url);
        for (const item of [background, ...layout.items]) {
            const image = this.image(item.type === 'background' ? item.image : item.type === 'artwork' ? metadata?.artwork?.[0]?.src : null);
            // An absent cover has no visual layer or effect history, even while editing.
            if (item.type === 'artwork' && !image) continue;
            alive.add(item.id);
            const width = Math.max(1, Math.round(stage.width * item.rect.w));
            const height = Math.max(1, Math.round(stage.height * item.rect.h));
            let state = this.layers.get(item.id);
            if (!state || state.type !== item.type) {
                state?.display?.dispose();
                state = { type: item.type, canvas: createLayer(width, height), signature: '', frame: null, image: null };
                this.layers.set(item.id, state);
            } else if (state.canvas.width !== width || state.canvas.height !== height) {
                state.canvas.width = width; state.canvas.height = height;
                state.signature = '';
            }
            const frame = sources.getFrame(item.id);
            const text = ['title', 'album', 'artist'].includes(item.type) ? metadata?.[item.type] : null;
            // Image identity is checked separately; never copy data URLs into a
            // per-frame signature, including the artwork metadata of other items.
            const signature = JSON.stringify([item.type, item.rect, item.channel,
                item.palette, item.style, item.effects, item.color, text, editing]);
            const changed = state.signature !== signature || state.frame !== frame || state.image !== image ||
                Boolean(item.palette?.mode === 'gradient' && item.palette.motion.mode !== 'none');
            if (ANALYZER_TYPES.has(item.type)) {
                state.display ||= createAnalyzerDisplay(item, state.canvas, sources);
                state.display?.draw(item, time, width / graphScale, layout.background.themeColors);
            } else if (changed) {
                this.drawItem(state, item, metadata, image, time, editing);
                state.signature = signature; state.frame = frame; state.image = image;
            }
            const signal = state.display?.signalCanvas;
            const flipCanvas = !ANALYZER_TYPES.has(item.type);
            const output = this.effects.apply(item.id, signal || state.canvas, item.effects, time, modulators, this.quality,
                changed || !flipCanvas, flipCanvas && item.flipX, flipCanvas && item.flipY, stageScale);
            drawBackplates(ctx, item.rect.x * stage.width, item.rect.y * stage.height, width, height,
                item.effects, time, modulators, stageScale);
            if (state.display?.underlayCanvas) ctx.drawImage(state.display.underlayCanvas,
                item.rect.x * stage.width, item.rect.y * stage.height, width, height);
            ctx.save();
            ctx.globalAlpha = output.opacity;
            ctx.translate((item.rect.x + item.rect.w / 2) * stage.width, (item.rect.y + item.rect.h / 2) * stage.height);
            ctx.scale(flipCanvas && item.flipX ? -1 : 1, flipCanvas && item.flipY ? -1 : 1);
            const paddingX = output.paddingX || 0, paddingY = output.paddingY || 0;
            ctx.drawImage(output.canvas, -width / 2 - paddingX, -height / 2 - paddingY, width + paddingX * 2, height + paddingY * 2);
            ctx.restore();
            if (signal) ctx.drawImage(state.canvas, (item.rect.x + item.rect.w / 2) * stage.width - width / 2,
                (item.rect.y + item.rect.h / 2) * stage.height - height / 2, width, height);
            for (const label of state.display?.overflowLevelValues || []) {
                ctx.save();
                const { text, x: labelX, y: labelY, ...style } = label;
                Object.assign(ctx, style);
                const metrics = ctx.measureText(text);
                const minX = metrics.actualBoundingBoxLeft ?? (label.textAlign === 'right' ? metrics.width : metrics.width / 2);
                const maxX = stage.width - (metrics.actualBoundingBoxRight ?? (label.textAlign === 'right' ? 0 : metrics.width / 2));
                const x = (item.rect.x + item.rect.w / 2) * stage.width - width / 2 + labelX;
                const y = (item.rect.y + item.rect.h / 2) * stage.height - height / 2 + labelY;
                const draw = method => {
                    if (minX > maxX) {
                        ctx.textAlign = 'center';
                        ctx[method](text, stage.width / 2, y, Math.max(1, stage.width - 2));
                    } else ctx[method](text, Math.max(minX, Math.min(maxX, x)), y);
                };
                draw('strokeText');
                draw('fillText');
                ctx.restore();
            }
        }
        for (const [id, state] of this.layers) if (!alive.has(id)) { state.display?.dispose(); this.layers.delete(id); }
        this.effects.prune(alive);
        if (quality === 'auto') {
            this.cost = this.cost * .95 + (performance.now() - start) * .05;
            if (++this.qualityFrames >= 120) {
                if (this.cost > 12 && this.quality < 3) this.quality++;
                else if (this.cost < 5 && this.quality > 0) this.quality--;
                this.qualityFrames = 0;
            }
        }
    }

    drawItem(state, item, metadata, image, time, editing) {
        const canvas = state.canvas, ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (item.type === 'background') {
            ctx.fillStyle = item.color; ctx.fillRect(0, 0, w, h);
            if (image) this.drawCover(ctx, image, w, h);
        } else if (item.type === 'artwork') {
            if (image) {
                ctx.save();
                if (item.style.rounded) { ctx.beginPath(); ctx.roundRect(0, 0, w, h, Math.min(w, h) * .06); ctx.clip(); }
                this.drawCover(ctx, image, w, h); ctx.restore();
            }
        } else if (['title', 'album', 'artist'].includes(item.type)) {
            const style = { ...TEXT_DECORATION_DEFAULTS, ...item.style };
            const raw = metadata?.[item.type] || (editing ? { title: 'Track title', album: 'Album', artist: 'Artist' }[item.type] : '');
            const text = style.textCase === 'upper' ? raw.toUpperCase() : style.textCase === 'lower' ? raw.toLowerCase() : raw;
            const scale = this.canvas.width / REFERENCE_WIDTH, outline = style.outlineWidth * scale, spacing = style.letterSpacing * scale;
            ctx.save();
            ctx.fillStyle = item.palette.mode === 'solid' ? item.palette.color : paletteGradient(ctx, item.palette, w, time);
            ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize * scale}px ${style.fontFamily || 'sans-serif'}`;
            ctx.letterSpacing = `${spacing}px`;
            ctx.textAlign = style.align;
            ctx.textBaseline = style.verticalAlign;
            // Keep the outline inside the item box; letter spacing also trails the last glyph.
            const x = style.align === 'center' ? (w + spacing) / 2 : style.align === 'right' ? w - outline + spacing : outline;
            const y = style.verticalAlign === 'top' ? outline : style.verticalAlign === 'bottom' ? h - outline : h / 2;
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
                ctx.strokeText(text, x, y, maxWidth);
                ctx.shadowColor = 'transparent';
            }
            ctx.fillText(text, x, y, maxWidth);
            ctx.restore();
        }
    }

    drawCover(ctx, image, w, h) {
        const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
        const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
        ctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }

}
