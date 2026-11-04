import { paletteGradient } from './visualizer-effects.js';
import { DEFAULT_THEME_COLORS } from './visualizer-model.js';

const COLUMNS = ['Channel', 'Bar:Beat:Tick', 'Type', 'Contents'];

function eventBound(rows, time, upper) {
    let first = 0, end = rows.length;
    while (first < end) {
        const middle = (first + end) >>> 1;
        if (rows[middle].seconds < time || (upper && rows[middle].seconds === time)) first = middle + 1;
        else end = middle;
    }
    return first;
}

// A boundary between timestamp groups keeps past rows above and future rows below
// the clock. Simultaneous events share the current instant, preserving file order.
export function midiEventListFrame(rows, time, rowHeight, height, headerHeight, scrollMode = 'row') {
    time = Number.isFinite(time) ? Math.max(0, time) : 0;
    const next = eventBound(rows, time, true), current = eventBound(rows, time, false);
    let cursor;
    if (current < next) cursor = (current + next - 1) / 2;
    else if (scrollMode !== 'smooth') cursor = next - .5;
    else if (!next) cursor = rows.length ? -(rows[0].seconds - time) : 0;
    else if (next === rows.length) cursor = next - 1 + time - rows[next - 1].seconds;
    else cursor = next - 1 + (time - rows[next - 1].seconds) / (rows[next].seconds - rows[next - 1].seconds);
    const center = height / 2;
    return { cursor, center, current, next,
        first: Math.max(0, Math.ceil(cursor + (headerHeight - center) / rowHeight - .5)),
        end: Math.min(rows.length, Math.floor(cursor + (height - center) / rowHeight + .5) + 1) };
}

export class MidiEventListDisplay {
    constructor(canvas, sources) {
        this.canvas = canvas;
        this.sources = sources;
    }

    dispose() {}

    draw(item, time, cssWidth, theme) {
        const ctx = this.canvas.getContext('2d');
        const { width, height } = this.canvas;
        const data = this.sources.getMidiEventList?.();
        const rows = data?.rows || [];
        const scale = cssWidth > 0 ? width / cssWidth : 1;
        const fontSize = item.params.fontSize * scale;
        const rowHeight = Math.max(1, fontSize * item.params.rowSpacing);
        const headerHeight = Math.min(height / 3, Math.max(fontSize * 1.8, 22 * scale));
        const frame = midiEventListFrame(rows, data?.position, rowHeight, height, headerHeight, item.params.scrollMode);
        const swatch = role => theme?.[role] ?? DEFAULT_THEME_COLORS[role];
        const accent = item.palette.mode === 'gradient'
            ? paletteGradient(ctx, item.palette, width, time, false, height) : item.palette.color;
        const padding = Math.min(5 * scale, fontSize * .3);
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(item.flipX ? width : 0, item.flipY ? height : 0);
        ctx.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
        ctx.fillStyle = swatch('graph-bg-deep');
        ctx.fillRect(0, 0, width, height);
        ctx.font = `${fontSize}px ${item.params.fontFamily}`;
        const measure = text => ctx.measureText(text).width;
        // Reserve a readable ordinary MIDI message, then share extra space among all four columns.
        const preferred = ['Channel', 'Bar:Beat:Tick', 'Channel Pressure', 'C♯-1 (127) Vel 127']
            .map(text => measure(text) + padding * 2);
        const total = preferred.reduce((sum, value) => sum + value, 0);
        const edges = [0];
        for (const value of preferred) edges.push(edges.at(-1) + (total <= width
            ? value + (width - total) / 4 : value * width / total));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const cell = (text, column, y, fields = null, align = 'left') => {
            const left = edges[column], cellWidth = edges[column + 1] - left;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left + padding, y - rowHeight / 2, Math.max(1, cellWidth - padding * 2), rowHeight);
            ctx.clip();
            ctx.fillStyle = accent;
            if (fields) {
                let x = left + padding;
                for (const field of fields) {
                    const size = measure(field.sample);
                    ctx.textAlign = field.align;
                    ctx.fillText(field.text, x + (field.align === 'right' ? size : 0), y);
                    x += size;
                }
            } else {
                ctx.textAlign = align;
                ctx.fillText(text, align === 'right' ? edges[column + 1] - padding : left + padding, y);
            }
            ctx.restore();
        };
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, headerHeight, width, height - headerHeight);
        ctx.clip();
        for (let index = frame.first; index < frame.end; index++) {
            const row = rows[index], y = frame.center + (index - frame.cursor) * rowHeight;
            const current = index >= frame.current && index < frame.next;
            if (index % 2 || current) {
                ctx.globalAlpha = current ? .2 : .4;
                ctx.fillStyle = current ? accent : swatch('graph-base-soft');
                ctx.fillRect(0, y - rowHeight / 2, width, rowHeight);
                ctx.globalAlpha = 1;
            }
            cell(row.channel === null ? '—' : String(row.channel), 0, y, null, 'right');
            const position = row.position.split(':');
            cell(row.position, 1, y, position.flatMap((text, index) => [
                ...(index ? [{ text: ':', sample: ':', align: 'left' }] : []),
                { text, sample: ['999', '99', '999'][index], align: 'right' }
            ]));
            cell(row.type, 2, y);
            cell(row.content, 3, y, row.contentFields);
        }
        ctx.globalAlpha = .65;
        ctx.fillStyle = accent;
        // Mark the clock at the margins so an exact-time row stays readable.
        const markerWidth = Math.max(1, padding * .65);
        ctx.fillRect(0, frame.center, markerWidth, Math.max(1, scale));
        ctx.fillRect(width - markerWidth, frame.center, markerWidth, Math.max(1, scale));
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = swatch('graph-base-soft');
        ctx.fillRect(0, 0, width, headerHeight);
        COLUMNS.forEach((label, column) => cell(label, column, headerHeight / 2));
        ctx.restore();
    }
}
