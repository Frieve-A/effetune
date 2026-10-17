import { createLayer, drawBackplates, paletteGradient, VisualizerEffects, applyEdgeFade, effectAmount, animatedEffects } from './visualizer-effects.js';

import { drawStyledText } from './visualizer-text.js';
import { lyricsFrame, lyricsOpacity, drawLyrics } from './visualizer-lyrics.js';
import { createAnalyzerDisplay } from './visualizer-analyzer-display.js';
import { REFERENCE_WIDTH } from './visualizer-model.js';

const ANALYZER_TYPES = new Set(['spectrum', 'spectrogram', 'oscilloscope', 'stereo', 'notes', 'guitar', 'chroma', 'level-meter', 'phase', 'analog-meter', 'rhythm-analyzer']);

// Returns the [x, y, width, height] that places an image or video frame in a w x h box.
function fitRect(image, w, h, fit) {
    const sw = image.videoWidth || image.naturalWidth, sh = image.videoHeight || image.naturalHeight;
    if (fit === 'stretch') return [0, 0, w, h];
    const scale = fit === 'contain' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
    const iw = sw * scale, ih = sh * scale;
    return [(w - iw) / 2, (h - ih) / 2, iw, ih];
}

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

    draw(layout, sources, metadata, time, { editing = false, quality = 'auto', lyrics = null, video = null } = {}) {
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
            const artwork = item.type === 'artwork' || (item.type === 'video' && !video && item.style.artworkFallback);
            const image = item.type === 'video' && video ? video
                : this.image(item.type === 'background' ? item.image : artwork ? metadata?.artwork?.[0]?.src : null);
            // An absent picture has no visual layer or effect history, even while editing.
            if ((item.type === 'artwork' || item.type === 'video') && !image) continue;
            const videoTime = video && image === video ? video.currentTime : null;
            const lyricFrame = item.type === 'lyrics' ? lyricsFrame(item, lyrics, editing) : null;
            const lyricOpacity = lyricFrame ? lyricsOpacity(item, lyrics, editing) : 1;
            if (lyricFrame && (!lyricOpacity || (!lyricFrame.rows.length && !lyricFrame.placeholder))) continue;
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
            const text = lyricFrame ? lyricFrame.key : item.type === 'text' ? item.params.text : ['title', 'album', 'artist'].includes(item.type) ? metadata?.[item.type] : null;
            // Image identity is checked separately; never copy data URLs into a
            // per-frame signature, including the artwork metadata of other items.
            const signature = JSON.stringify([item.type, item.rect, item.channel,
                item.palette, item.style, item.effects, item.color, item.flipX, item.flipY, text, editing]);
            let changed = state.signature !== signature || state.frame !== frame || state.image !== image || state.videoTime !== videoTime ||
                Boolean(item.palette?.mode === 'gradient' && item.palette.motion.mode !== 'none');
            if (ANALYZER_TYPES.has(item.type)) {
                state.display ||= createAnalyzerDisplay(item, state.canvas, sources);
                const rendered = state.display?.draw(item, time, width / graphScale, layout.background.themeColors, stageScale);
                changed = state.signature !== signature || state.image !== image || rendered !== false;
                state.signature = signature; state.frame = frame; state.image = image;
            } else if (changed) {
                this.drawItem(state, item, metadata, image, time, editing, lyricFrame);
                state.signature = signature; state.frame = frame; state.image = image; state.videoTime = videoTime;
            }
            const signal = state.display?.signalCanvas;
            const flipCanvas = !ANALYZER_TYPES.has(item.type);
            const output = this.effects.apply(item.id, signal || state.canvas, item.effects, time, modulators, this.quality,
                changed, flipCanvas && item.flipX, flipCanvas && item.flipY, stageScale,
                { width: stage.width, height: stage.height,
                    centerX: (item.rect.x + item.rect.w / 2) * stage.width,
                    centerY: (item.rect.y + item.rect.h / 2) * stage.height });
            const fades = item.effects.filter(effect => effect.enabled && effect.type === 'edge-fade')
                .map(effect => ({ effect, amount: effectAmount(effect, time, modulators) })).filter(entry => entry.amount > 0);
            let target = ctx, repaint = true;
            const isolate = fades.length || lyricOpacity < 1;
            let composite;
            if (isolate) {
                // Temporal fades retain decorations outside the item. Only Edge Fade
                // clips the composite to the item rectangle.
                const cw = fades.length ? width : stage.width, ch = fades.length ? height : stage.height;
                if (fades.length) {
                    state.fadeLayer ||= createLayer(cw, ch);
                    state.fadeMask ||= createLayer(cw, ch);
                    composite = state.fadeLayer;
                } else composite = state.lyricsLayer ||= createLayer(cw, ch);
                const resized = composite.width !== cw || composite.height !== ch;
                if (resized) {
                    composite.width = cw; composite.height = ch;
                    if (fades.length) { state.fadeMask.width = cw; state.fadeMask.height = ch; }
                }
                repaint = changed || resized || Boolean(lyricFrame) || animatedEffects(item.effects);
                target = composite.getContext('2d');
                if (repaint) {
                    target.clearRect(0, 0, cw, ch);
                    target.save();
                    if (fades.length) target.translate(-item.rect.x * stage.width, -item.rect.y * stage.height);
                }
            }
            if (repaint) {
                const ctx = target;
                drawBackplates(ctx, item.rect.x * stage.width, item.rect.y * stage.height, width, height,
                    item.effects, time, modulators, stageScale);
                if (state.display?.underlayCanvas) ctx.drawImage(state.display.underlayCanvas,
                    item.rect.x * stage.width, item.rect.y * stage.height, width, height);
                ctx.save();
                ctx.globalAlpha = output.opacity;
                ctx.translate((item.rect.x + item.rect.w / 2) * stage.width, (item.rect.y + item.rect.h / 2) * stage.height);
                ctx.scale(flipCanvas && item.flipX ? -1 : 1, flipCanvas && item.flipY ? -1 : 1);
                const paddingX = output.paddingX || 0, paddingY = output.paddingY || 0;
                const bounds = output.bounds || { x: -width / 2 - paddingX, y: -height / 2 - paddingY,
                    w: width + paddingX * 2, h: height + paddingY * 2 };
                if (state.lyricsMeasurements?.hits?.length) {
                    // Retain the actual source-to-stage geometry, including effects and flips.
                    const originX = fades.length ? item.rect.x * stage.width : 0;
                    const originY = fades.length ? item.rect.y * stage.height : 0;
                    const matrix = new DOMMatrix().translate(originX, originY).multiply(ctx.getTransform())
                        .translate(bounds.x, bounds.y).scale(bounds.w / output.canvas.width, bounds.h / output.canvas.height);
                    state.lyricsTransform = (output.inputTransform ? matrix.multiply(output.inputTransform) : matrix).inverse();
                    state.lyricsClipped = Boolean(fades.length || !output.bounds);
                }
                ctx.drawImage(output.canvas, bounds.x, bounds.y, bounds.w, bounds.h);
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
                        // Off-frame labels follow their item and clip naturally at the scene edge.
                        if (item.rect.x < 0 || item.rect.x + item.rect.w > 1) ctx[method](text, x, y);
                        else if (minX > maxX) {
                            ctx.textAlign = 'center';
                            ctx[method](text, stage.width / 2, y, Math.max(1, stage.width - 2));
                        } else ctx[method](text, Math.max(minX, Math.min(maxX, x)), y);
                    };
                    draw('strokeText');
                    draw('fillText');
                    ctx.restore();
                }
            }
            if (isolate) {
                if (repaint) {
                    target.restore();
                    for (const { effect, amount } of fades) applyEdgeFade(target, state.fadeMask, effect, amount);
                }
                ctx.save();
                ctx.globalAlpha *= lyricOpacity;
                ctx.drawImage(composite, fades.length ? item.rect.x * stage.width : 0, fades.length ? item.rect.y * stage.height : 0);
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

    // Returns the playback time of the synced lyric row drawn under a normalized stage point, or null.
    lyricsSeekTime(layout, x, y) {
        for (const item of layout.items.toReversed()) {
            const state = item.type === 'lyrics' ? this.layers.get(item.id) : null;
            const hits = state?.lyricsMeasurements?.hits;
            if (!hits?.length || !state.lyricsTransform) continue;
            if (state.lyricsClipped && (x < item.rect.x || x > item.rect.x + item.rect.w ||
                y < item.rect.y || y > item.rect.y + item.rect.h)) continue;
            const { x: px, y: py } = state.lyricsTransform.transformPoint({ x: x * this.canvas.width, y: y * this.canvas.height });
            if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || px > state.canvas.width || py < 0 || py > state.canvas.height) continue;
            const hit = hits.find(row => px >= row.left && px <= row.right && py >= row.top && py <= row.bottom);
            if (hit) return hit.time;
        }
        return null;
    }

    drawItem(state, item, metadata, image, time, editing, lyricFrame) {
        const canvas = state.canvas, ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (item.type === 'background') {
            ctx.fillStyle = item.color; ctx.fillRect(0, 0, w, h);
            if (image) ctx.drawImage(image, ...fitRect(image, w, h, 'cover'));
        } else if (item.type === 'artwork' || item.type === 'video') {
            if (image) {
                const [x, y, iw, ih] = fitRect(image, w, h, item.type === 'video' ? item.style.fit : 'cover');
                // Round the visible picture, which is smaller than the item when fitted inside.
                const cx = Math.max(0, x), cy = Math.max(0, y), cw = Math.min(w, x + iw) - cx, ch = Math.min(h, y + ih) - cy;
                ctx.save();
                if (item.style.rounded) { ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, Math.min(cw, ch) * .06); ctx.clip(); }
                ctx.drawImage(image, x, y, iw, ih); ctx.restore();
            }
        } else if (['title', 'album', 'artist', 'text'].includes(item.type)) {
            const raw = item.type === 'text' ? item.params.text
                : metadata?.[item.type] || (editing ? { title: 'Track title', album: 'Album', artist: 'Artist' }[item.type] : '');
            drawStyledText(ctx, raw, item.style, w, h, this.canvas.width / REFERENCE_WIDTH,
                item.palette.mode === 'solid' ? item.palette.color : paletteGradient(ctx, item.palette, w, time, false, h));
        } else if (item.type === 'lyrics') {
            if (item.palette.mode === 'gradient') {
                state.glyphMask ||= createLayer(w, h);
                if (state.glyphMask.width !== w) state.glyphMask.width = w;
                if (state.glyphMask.height !== h) state.glyphMask.height = h;
            }
            drawLyrics(ctx, item, lyricFrame, w, h, this.canvas.width / REFERENCE_WIDTH,
                item.palette.mode === 'solid' ? item.palette.color : paletteGradient(ctx, item.palette, w, time, false, h),
                item.palette.mode === 'gradient' ? state.glyphMask : null, state.lyricsMeasurements ||= {});
        } else if (item.type === 'shape') {
            this.drawShape(ctx, item, w, h, time);
        }
    }

    drawShape(ctx, item, w, h, time) {
        const style = item.style, scale = this.canvas.width / REFERENCE_WIDTH;
        const border = Math.min(style.borderWidth * scale, w / 2, h / 2);
        const inset = border / 2, width = w - border, height = h - border;
        const paint = item.palette.mode === 'solid' ? item.palette.color : paletteGradient(ctx, item.palette, w, time, false, h);
        ctx.save();
        ctx.beginPath();
        if (style.shape === 'ellipse') {
            ctx.ellipse(w / 2, h / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        } else if (style.shape === 'triangle') {
            ctx.moveTo(w / 2, inset); ctx.lineTo(w - inset, h - inset); ctx.lineTo(inset, h - inset); ctx.closePath();
        } else if (style.shape === 'line') {
            ctx.moveTo(inset, h / 2); ctx.lineTo(w - inset, h / 2);
        } else {
            ctx.roundRect(inset, inset, width, height, Math.min(style.radius * scale, width / 2, height / 2));
        }
        if (style.shape !== 'line' && style.fillOpacity > 0) {
            ctx.globalAlpha = style.fillOpacity; ctx.fillStyle = paint; ctx.fill();
        }
        if (border > 0 && style.borderOpacity > 0) {
            ctx.globalAlpha = style.borderOpacity;
            ctx.strokeStyle = style.shape === 'line' ? paint : style.borderColor;
            ctx.lineWidth = border; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        }
        ctx.restore();
    }

}
