import { drawStyledText } from './visualizer-text.js';

const LABELS = { 'play-pause': 'Play / Pause', stop: 'Stop', previous: 'Previous track', next: 'Next track', shuffle: 'Shuffle', repeat: 'Repeat' };

// The icon and the hit region share the item's untransformed canvas coordinates.
export function drawPlaybackControl(ctx, item, w, h, scale, paint, playback = {}) {
    const p = item.params, action = p.action;
    const enabled = playback.enabled?.[action] === true;
    const active = (action === 'shuffle' && playback.shuffle) || (action === 'repeat' && playback.repeat && playback.repeat !== 'OFF');
    const pressed = enabled && playback.pressedId === item.id, hovered = enabled && playback.hoveredId === item.id;
    const border = Math.min(p.borderWidth * scale, w / 4, h / 4), inset = border / 2 + scale;
    const left = inset, top = inset, right = Math.max(left, w - inset), bottom = Math.max(top, h - inset);
    const radius = Math.min(p.radius * scale, (right - left) / 2, (bottom - top) / 2);
    const path = new Path2D();
    if (p.shape === 'ellipse') path.ellipse(w / 2, h / 2, (right - left) / 2, (bottom - top) / 2, 0, 0, Math.PI * 2);
    else path.roundRect(left, top, right - left, bottom - top, radius);
    ctx.save();
    ctx.globalAlpha = enabled || playback.editing ? 1 : .38;
    ctx.fillStyle = p.fill;
    const opacity = ctx.globalAlpha;
    ctx.globalAlpha *= p.fillOpacity;
    ctx.fill(path);
    ctx.globalAlpha = opacity;
    if (p.depth > 0 && p.fillOpacity > 0) {
        const sheen = ctx.createLinearGradient(0, 0, 0, h);
        sheen.addColorStop(0, `rgba(255,255,255,${p.depth * (pressed ? .04 : .28)})`); // theme-allow: Scene button gloss overlays the user-selected fill independently of the app theme.
        sheen.addColorStop(.48, 'rgba(255,255,255,0)'); // theme-allow: Transparent midpoint of the scene button gloss.
        sheen.addColorStop(1, `rgba(0,0,0,${p.depth * (pressed ? .12 : .42)})`); // theme-allow: Scene button depth shading overlays the user-selected fill.
        ctx.fillStyle = sheen; ctx.fill(path);
    }
    if (hovered || pressed) {
        ctx.fillStyle = pressed ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.09)'; ctx.fill(path); // theme-allow: Scene button interaction shading preserves the user-selected fill.
    }
    if (border > 0) {
        ctx.lineWidth = border; ctx.strokeStyle = active ? p.activeColor : p.border; ctx.stroke(path);
    }
    ctx.clip(path);
    const color = active ? p.activeColor : paint;
    const padding = Math.min(w, h) * .1;
    const label = p.label || playback.labels?.[action] || LABELS[action];
    const labelHeight = p.display === 'icon-label' ? Math.min(h * .3, item.style.fontSize * scale * 1.3) : 0;
    if (p.display !== 'label') {
        const size = Math.min(w - padding * 2, h - padding * 2 - labelHeight) * p.iconSize / 100;
        ctx.save();
        ctx.translate(w / 2, (h - labelHeight) / 2 + (pressed ? scale : 0));
        ctx.scale(size / 24, size / 24); ctx.translate(-12, -12);
        ctx.fillStyle = color; ctx.strokeStyle = color;
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        drawIcon(ctx, action, playback);
        ctx.restore();
    }
    if (p.display !== 'icon') {
        ctx.save();
        const y = p.display === 'icon-label' ? h - padding - labelHeight : padding;
        ctx.translate(padding, y);
        drawStyledText(ctx, label, item.style, Math.max(1, w - padding * 2),
            p.display === 'icon-label' ? labelHeight : Math.max(1, h - padding * 2), scale, color);
        ctx.restore();
    }
    if (playback.focusedId === item.id) {
        ctx.lineWidth = 3 * scale; ctx.strokeStyle = color;
        ctx.setLineDash([4 * scale, 3 * scale]); ctx.stroke(path);
    }
    ctx.restore();
    return { left, top, right, bottom, radius, ellipse: p.shape === 'ellipse' };
}

export function playbackControlContains(bounds, point) {
    const { left, top, right, bottom, radius, ellipse } = bounds;
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) return false;
    if (ellipse) return ((point.x - (left + right) / 2) / ((right - left) / 2)) ** 2 +
        ((point.y - (top + bottom) / 2) / ((bottom - top) / 2)) ** 2 <= 1;
    const dx = Math.max(left + radius - point.x, 0, point.x - right + radius);
    const dy = Math.max(top + radius - point.y, 0, point.y - bottom + radius);
    return dx * dx + dy * dy <= radius * radius;
}

function drawIcon(ctx, action, playback) {
    const triangle = (a, b, c) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.fill(); };
    if (action === 'play-pause') {
        if (playback.playing) { ctx.fillRect(5, 4, 5, 16); ctx.fillRect(14, 4, 5, 16); }
        else triangle([6, 3], [21, 12], [6, 21]);
    } else if (action === 'stop') {
        ctx.beginPath(); ctx.roundRect(4, 4, 16, 16, 2); ctx.fill();
    } else if (action === 'previous' || action === 'next') {
        if (action === 'previous') { ctx.translate(24, 0); ctx.scale(-1, 1); }
        triangle([3, 4], [17, 12], [3, 20]); ctx.fillRect(18, 4, 3, 16);
    } else if (action === 'shuffle') {
        ctx.stroke(new Path2D('M3 6h2c4 0 10 12 14 12h2m-4-4 4 4-4 4M3 18h2c2 0 4-3 6-6m2-3c2-2 4-3 6-3h2m-4-4 4 4-4 4'));
    } else if (action === 'repeat') {
        ctx.stroke(new Path2D('M20 9V8a3 3 0 0 0-3-3H4m4-4L4 5l4 4M4 15v1a3 3 0 0 0 3 3h13m-4-4 4 4-4 4'));
        if (playback.repeat === 'ONE') { ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('1', 12, 12); }
    }
}
