import { lyricsLineAt } from '../library/metadata/lyrics.js';
import { drawStyledText, measureStyledText, TEXT_LINE_HEIGHT } from './visualizer-text.js';

const identities = new WeakMap();
let nextIdentity = 1;
const clamp = value => Math.max(0, Math.min(1, value));
const ADVANCE_SECONDS = 0.18;
const stepProgress = (time, start, gap, duration) => {
    if (duration === 0) return 1;
    const u = clamp((time - start) / Math.min(duration, gap || duration));
    return u * u * (3 - 2 * u);
};

// Whole-item opacity follows audible playback position, independently of row timing.
export function lyricsOpacity(item, lyrics, editing) {
    if (editing) return 1;
    if (lyrics?.isStopped || !lyrics?.data?.lines.length) return 0;
    const fadeIn = item.params.lyricsFadeIn ?? 0, fadeOut = item.params.lyricsFadeOut ?? 0;
    const head = fadeIn > 0 ? clamp(lyrics.time / fadeIn) : 1;
    const tail = fadeOut > 0 && lyrics.duration > 0 ? clamp((lyrics.duration - lyrics.time) / fadeOut) : 1;
    return Math.min(head, tail);
}

export function lyricsFrame(item, lyrics, editing) {
    const data = lyrics?.data;
    if (!data?.lines.length) return { rows: [], placeholder: editing, key: editing ? 'placeholder' : 'empty' };
    if (!identities.has(data)) identities.set(data, nextIdentity++);
    const { lines, synced } = data, params = item.params;
    const t = lyrics.time - params.lyricsOffset;
    const current = synced ? lyricsLineAt(lines, t) : -1;
    const list = !synced || params.lyricsView === 'list';
    const horizontal = list && params.lyricsMotion.endsWith('-horizontal');
    const stepDuration = list && ['step', 'step-horizontal'].includes(params.lyricsMotion)
        ? params.lyricsStepDuration ?? ADVANCE_SECONDS : ADVANCE_SECONDS;
    // Without a remaining time boundary, hold a fitted line instead of an
    // unreadable off-screen ticker. Earlier synced lines still use their next cue.
    const ticker = horizontal && params.lyricsMotion === 'smooth-horizontal' &&
        (synced ? current < lines.length - 1 || !lines.at(-1).text || lyrics.duration > lines.at(-1).time : lyrics.duration > 0);
    let p = current, fill = null;
    if (!synced) {
        if (horizontal && params.lyricsMotion === 'step-horizontal' && lyrics.duration > 0) {
            const gap = lyrics.duration / lines.length;
            const index = Math.min(lines.length - 1, Math.floor(clamp(t / lyrics.duration) * lines.length));
            p = index - 1 + stepProgress(t, index * gap, gap, stepDuration);
        } else p = lyrics.duration > 0 ? clamp(t / lyrics.duration) * (lines.length - 1) : 0;
    }
    else if (list && (params.lyricsMotion === 'smooth' || ticker)) {
        if (current < lines.length - 1) {
            const start = current < 0 ? 0 : lines[current].time;
            const gap = lines[current + 1].time - start;
            p += gap > 0 ? clamp((t - start) / gap) : 0;
        }
    } else if (current >= 0) {
        const gap = current < lines.length - 1 ? lines[current + 1].time - lines[current].time
            : list && lyrics.duration > lines[current].time ? lyrics.duration - lines[current].time : stepDuration;
        p = current - 1 + stepProgress(t, lines[current].time, gap, stepDuration);
    }
    const words = lines[current]?.words;
    if (synced && params.lyricsWordFill && words?.length) {
        const word = lyricsLineAt(words, t);
        fill = 0;
        for (let i = 0; i < word; i++) fill += words[i].text.length;
        if (word >= 0) {
            const end = words[word + 1]?.time ?? lines[current + 1]?.time ?? lyrics.duration;
            const fraction = end > words[word].time ? clamp((t - words[word].time) / (end - words[word].time)) : 1;
            fill += words[word].text.length * fraction;
        }
    }
    const progress = !ticker ? 0 : !synced ? clamp(t / lyrics.duration)
        : current === lines.length - 1 && lyrics.duration > lines.at(-1).time
            ? clamp((t - lines.at(-1).time) / (lyrics.duration - lines.at(-1).time)) : 0;
    return { rows: lines, p, current, fill, list, synced, next: params.lyricsNext, horizontal, ticker, progress,
        key: JSON.stringify([identities.get(data), params, current, Math.round(p * 1000), fill === null ? null : Math.round(fill * 100), Math.round(progress * 1000)]) };
}

export function drawLyrics(ctx, item, frame, w, h, scale, fill, glyphMask, measurements = {}) {
    // Native fillText(maxWidth) compresses gradients along with the glyphs.
    // Paint the glyph mask in item coordinates, then color only its alpha.
    const paintFill = glyphMask ? (text, x, y, maxWidth) => {
        const mask = glyphMask.getContext('2d');
        mask.clearRect(0, 0, w, h);
        for (const key of ['font', 'letterSpacing', 'textAlign', 'textBaseline', 'direction', 'fontKerning',
            'fontStretch', 'fontVariantCaps', 'textRendering']) mask[key] = ctx[key];
        mask.fillStyle = '#ffffff'; // theme-allow: Alpha mask; source-in replaces its RGB with the text fill.
        mask.fillText(text, x, y, maxWidth);
        mask.globalCompositeOperation = 'source-in';
        mask.fillStyle = fill;
        mask.fillRect(0, 0, w, h);
        mask.globalCompositeOperation = 'source-over';
        ctx.drawImage(glyphMask, 0, 0);
    } : undefined;
    if (frame.placeholder) {
        drawStyledText(ctx, 'Lyrics', item.style, w, h, scale, fill, undefined, undefined, 0, paintFill);
        return;
    }
    if (!frame.rows.length) return;
    const rowHeight = item.style.fontSize * scale * TEXT_LINE_HEIGHT;
    const lineAdvance = rowHeight * (item.params.lyricsLineSpacing ?? 1);
    const blockHeight = rowHeight + (!frame.list && frame.next ? lineAdvance : 0);
    const align = item.style.verticalAlign || 'middle';
    const anchor = frame.list && !frame.horizontal ? rowHeight / 2 + (h - rowHeight) * (item.params.lyricsPosition ?? 50) / 100
        : align === 'top' ? rowHeight / 2 : align === 'bottom' ? h - blockHeight + rowHeight / 2
        : (h - blockHeight + rowHeight) / 2;
    const style = { ...item.style, verticalAlign: 'middle' };
    let positions, widths, scroll = 0;
    if (frame.horizontal) {
        const anchorX = w * (item.params.lyricsPosition ?? 50) / 100;
        const key = JSON.stringify([item.style, scale, w, lineAdvance, frame.ticker]);
        if (measurements.rows !== frame.rows || measurements.key !== key) {
            const outline = (item.style.outlineWidth ?? 0) * scale;
            widths = frame.rows.map(row => {
                const width = Math.max(1, measureStyledText(ctx, row.text, style, scale) + outline * 2);
                return frame.ticker ? width : Math.min(w, width);
            });
            let x = 0;
            positions = widths.map(width => { const position = x; x += width + lineAdvance; return position; });
            Object.assign(measurements, { rows: frame.rows, key, widths, positions,
                lastText: frame.rows.findLastIndex(row => row.text.length > 0) });
        }
        ({ widths, positions } = measurements);
        if (frame.ticker) {
            const last = widths.length - 1;
            // A terminal clear row must not cut off the preceding line's tail.
            const point = index => positions[index] + (index > measurements.lastText ? anchorX : 0);
            if (!frame.synced) scroll = (positions[last] + widths[last] + anchorX) * frame.progress;
            else if (frame.current === last) scroll = point(last) + (anchorX + widths[last]) * frame.progress;
            else if (frame.current >= 0) scroll = point(frame.current) +
                (point(frame.current + 1) - point(frame.current)) * (frame.p - frame.current);
            scroll -= anchorX;
            style.align = 'left';
        } else {
            const alignment = item.style.align === 'right' ? 1 : item.style.align === 'center' ? .5 : 0;
            const point = index => index < 0 ? widths[0] * alignment - widths[0] - lineAdvance
                : positions[index] + widths[index] * alignment;
            const current = Math.max(-1, Math.min(widths.length - 1, Math.floor(frame.p)));
            scroll = point(current) + (point(Math.min(current + 1, widths.length - 1)) - point(current)) *
                (frame.p - current) - anchorX;
        }
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const first = frame.horizontal ? 0 : frame.list ? Math.max(0, Math.ceil(frame.p - (anchor + rowHeight) / lineAdvance)) : Math.max(0, frame.current - 1);
    const last = frame.horizontal ? frame.rows.length - 1 : frame.list ? Math.min(frame.rows.length - 1, Math.floor(frame.p + (h - anchor + rowHeight) / lineAdvance))
        : Math.min(frame.rows.length - 1, frame.current + (frame.next ? 1 : 0));
    for (let index = first; index <= last; index++) {
        if (!frame.list && index < frame.current && frame.p >= frame.current) continue;
        const x = frame.horizontal ? positions[index] - scroll : 0;
        const rowWidth = frame.horizontal ? widths[index] : w;
        if (frame.horizontal && (x + rowWidth < 0 || x > w)) continue;
        const y = frame.horizontal ? anchor : anchor + (index - frame.p) * lineAdvance;
        const rowTop = y - rowHeight / 2;
        const active = frame.synced && index === frame.current;
        ctx.save();
        // Keep paint coordinates in the item box; translating a row also translates its gradient.
        ctx.globalAlpha *= !frame.synced || (active && frame.fill === null) ? 1 : 0.35;
        const measured = drawStyledText(ctx, frame.rows[index].text, style, rowWidth, rowHeight, scale, fill,
            undefined, active && frame.fill !== null ? frame.fill : undefined, rowTop, paintFill, x);
        if (measured?.filled > 0) {
            ctx.save();
            ctx.beginPath(); ctx.rect(measured.left, rowTop, measured.filled, rowHeight); ctx.clip();
            ctx.globalAlpha /= 0.35;
            drawStyledText(ctx, frame.rows[index].text, style, rowWidth, rowHeight, scale, fill, undefined, undefined, rowTop, paintFill, x);
            ctx.restore();
        }
        ctx.restore();
    }
    ctx.restore();
}
