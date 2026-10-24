function copyError(code, cause) {
    return Object.assign(new Error(code, { cause }), { code });
}

// The caller supplies the clean, fully composed export canvas. Keep clipboard
// invocation in the click's task by passing pending PNG data to ClipboardItem.
export async function copyGraphImage(canvas) {
    const bridge = globalThis.window?.electronAPI;
    const nativeWrite = typeof bridge?.writeClipboardImage === 'function';
    const clipboard = globalThis.navigator?.clipboard;
    const Item = globalThis.ClipboardItem;
    if (!nativeWrite && (typeof clipboard?.write !== 'function' || typeof Item !== 'function' ||
        (typeof Item.supports === 'function' && !Item.supports('image/png')))) {
        throw copyError('unsupported');
    }
    if (!(canvas?.width > 0 && canvas?.height > 0) || typeof canvas.toBlob !== 'function') {
        throw copyError('encoding');
    }
    let encodingFailure;
    const png = new Promise((resolve, reject) => {
        const fail = cause => { encodingFailure = copyError('encoding', cause); reject(encodingFailure); };
        try {
            canvas.toBlob(blob => {
                if (blob?.type === 'image/png' && blob.size > 0) resolve(blob);
                else fail();
            }, 'image/png');
        } catch (error) { fail(error); }
    });
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
