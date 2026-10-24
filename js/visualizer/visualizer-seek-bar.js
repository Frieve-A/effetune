export function drawSeekBar(ctx, item, w, h, scale, paint, playback = {}) {
    const p = item.params, enabled = playback.seekEnabled === true;
    const thumbRadius = p.showThumb ? Math.min(p.thumbSize * scale / 2, h / 2 - scale, w / 4) : 0;
    const thickness = Math.min(p.thickness * scale, h - 2 * scale);
    const inset = Math.max(thumbRadius, thickness / 2) + scale;
    const left = Math.min(inset, w / 2), right = Math.max(left, w - inset), y = h / 2;
    const position = playback.seekingId === item.id ? playback.seekPosition : playback.position;
    const ratio = playback.duration > 0 ? Math.max(0, Math.min(1, (position || 0) / playback.duration)) : playback.editing ? .4 : 0;
    const x = left + (right - left) * ratio;
    const track = new Path2D();
    track.roundRect(left, y - thickness / 2, right - left, thickness, p.rounding ? thickness / 2 : 0);
    ctx.save();
    ctx.globalAlpha = enabled || playback.editing ? 1 : .38;
    const opacity = ctx.globalAlpha;
    ctx.fillStyle = p.trackColor; ctx.globalAlpha *= p.trackOpacity; ctx.fill(track);
    ctx.globalAlpha = opacity;
    ctx.save();
    ctx.clip(track); ctx.fillStyle = paint; ctx.fillRect(left, y - thickness / 2, x - left, thickness);
    ctx.restore();
    if (thumbRadius > 0) {
        ctx.beginPath();
        if (p.thumbShape === 'square') ctx.rect(x - thumbRadius, y - thumbRadius, thumbRadius * 2, thumbRadius * 2);
        else if (p.thumbShape === 'diamond') {
            ctx.moveTo(x, y - thumbRadius); ctx.lineTo(x + thumbRadius, y);
            ctx.lineTo(x, y + thumbRadius); ctx.lineTo(x - thumbRadius, y); ctx.closePath();
        } else if (p.thumbShape === 'bar') {
            ctx.roundRect(x - thumbRadius * .3, y - thumbRadius, thumbRadius * .6, thumbRadius * 2,
                Math.min(thumbRadius * .3, 1.5 * scale));
        } else ctx.arc(x, y, thumbRadius, 0, Math.PI * 2);
        ctx.fillStyle = p.thumbColor; ctx.fill();
        if (p.thumbBorderWidth > 0) {
            // Clip the doubled stroke to keep the border inside the unchanged thumb envelope.
            ctx.save(); ctx.clip();
            ctx.lineWidth = Math.min(p.thumbBorderWidth * scale, thumbRadius) * 2;
            ctx.strokeStyle = p.thumbBorderColor; ctx.lineJoin = 'round'; ctx.stroke();
            ctx.restore();
        }
    }
    if (playback.focusedId === item.id) {
        ctx.strokeStyle = paint; ctx.lineWidth = scale;
        ctx.setLineDash([3 * scale, 3 * scale]);
        ctx.strokeRect(scale, scale, Math.max(0, w - scale * 2), Math.max(0, h - scale * 2));
    }
    ctx.restore();
    const hitHeight = Math.min(h, Math.max(32 * scale, thumbRadius * 2, thickness));
    return { left, right, top: y - hitHeight / 2, bottom: y + hitHeight / 2 };
}
