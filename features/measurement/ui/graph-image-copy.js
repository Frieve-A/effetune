const palette = name => window.ThemePalette?.get(name) || '#888'; // theme-allow: Neutral fallback only when ThemePalette is unavailable; the theme palette remains authoritative.

function copyError(code, cause) {
    return Object.assign(new Error(code, { cause }), { code });
}

/** Scale of an exported graph of `width` x `height` CSS px: about 1600 px wide, at least 2x, at most 4096 px. */
export function exportScale(width, height) {
    return Math.min(4096 / Math.max(width, height), Math.max(2, 1600 / width));
}

/**
 * The export canvas: `title`, the `subtitle` wrapped to the width and the `legend` entries above `graph`, an image
 * of the graph's `width` x `height` CSS px drawn at `dpr`, all on the theme's graph background. A legend entry is
 * { text, color, dash } (a line, `dash` a canvas dash array) or { text, color, opacity, fill: true } (a square).
 */
export function composeGraphImage(graph, { width, height, dpr, title, subtitle = '', legend = [] }) {
    const image = document.createElement('canvas');
    const ctx = image.getContext('2d');
    ctx.font = '12px Arial';
    const subtitleLines = [''];
    for (const character of subtitle) {
        const index = subtitleLines.length - 1;
        if (ctx.measureText(subtitleLines[index] + character).width > width - 40) subtitleLines.push(character);
        else subtitleLines[index] += character;
    }
    let x = 20; let line = 0;
    const entries = legend.map(entry => {
        const entryWidth = 42 + ctx.measureText(entry.text).width;
        if (x > 20 && x + entryWidth > width - 20) { x = 20; line++; }
        const placed = { ...entry, x, line }; x += entryWidth; return placed;
    });
    const legendTop = 48 + subtitleLines.length * 16;
    const headerHeight = legendTop + (entries.length ? (line + 1) * 22 : 0);
    image.width = Math.round(width * dpr); image.height = Math.round(height * dpr) + Math.round(headerHeight * dpr);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = palette('graph-base'); ctx.fillRect(0, 0, width, height + headerHeight);
    ctx.fillStyle = palette('graph-label-strong'); ctx.font = 'bold 19px Arial';
    ctx.fillText(title, 20, 26, width - 40);
    ctx.fillStyle = palette('graph-label'); ctx.font = '12px Arial';
    subtitleLines.forEach((text, index) => ctx.fillText(text, 20, 47 + index * 16));
    for (const entry of entries) {
        const y = legendTop + entry.line * 22;
        if (entry.fill) {
            ctx.globalAlpha = entry.opacity ?? 1; ctx.fillStyle = entry.color;
            ctx.fillRect(entry.x + 3, y - 6, 12, 12); ctx.globalAlpha = 1;
        } else {
            ctx.strokeStyle = entry.color; ctx.lineWidth = 2; ctx.setLineDash(entry.dash ?? []);
            ctx.beginPath(); ctx.moveTo(entry.x, y); ctx.lineTo(entry.x + 18, y); ctx.stroke();
        }
        ctx.fillStyle = palette('graph-label'); ctx.fillText(entry.text, entry.x + 24, y + 4);
    }
    ctx.drawImage(graph, 0, headerHeight, width, height);
    return image;
}

// The caller supplies the clean, fully composed export canvas, or a promise of it when the graph is rasterised
// asynchronously. Keep clipboard invocation in the click's task by passing pending PNG data to ClipboardItem.
export async function copyGraphImage(source) {
    const bridge = globalThis.window?.electronAPI;
    const nativeWrite = typeof bridge?.writeClipboardImage === 'function';
    const clipboard = globalThis.navigator?.clipboard;
    const Item = globalThis.ClipboardItem;
    if (!nativeWrite && (typeof clipboard?.write !== 'function' || typeof Item !== 'function' ||
        (typeof Item.supports === 'function' && !Item.supports('image/png')))) {
        throw copyError('unsupported');
    }
    let encodingFailure;
    const encode = canvas => new Promise((resolve, reject) => {
        const fail = cause => { encodingFailure = copyError('encoding', cause); reject(encodingFailure); };
        try {
            if (!(canvas?.width > 0 && canvas?.height > 0) || typeof canvas.toBlob !== 'function') {
                fail();
                return;
            }
            canvas.toBlob(blob => {
                if (blob?.type === 'image/png' && blob.size > 0) resolve(blob);
                else fail();
            }, 'image/png');
        } catch (error) { fail(error); }
    });
    const png = typeof source?.then === 'function'
        ? source.then(encode, cause => { encodingFailure = copyError('encoding', cause); throw encodingFailure; })
        : encode(source);
    // Permission rejection may occur before the clipboard consumes the data.
    // Handle that abandoned promise without changing the caller's error result.
    png.catch(() => {});
    try {
        if (nativeWrite) {
            const bytes = new Uint8Array(await (await png).arrayBuffer());
            if (await bridge.writeClipboardImage(bytes) !== true) throw copyError('failed');
        } else {
            await clipboard.write([new Item({ 'image/png': png })]);
        }
    } catch (error) {
        if (encodingFailure) throw encodingFailure;
        if (error?.code === 'failed') throw error;
        throw copyError(error?.name === 'NotAllowedError' ? 'denied' : 'failed', error);
    }
}
