import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

test('real canvas PNG preserves dimensions and pixels through a promise ClipboardItem without touching OS clipboard', { timeout: 30000 }, async () => {
    const source = await fs.readFile(new URL('../../features/measurement/ui/graph-image-copy.js', import.meta.url), 'utf8');
    const browser = await chromium.launch({ headless: true,
        ...(process.env.MEASUREMENT_BROWSER_CHANNEL ? { channel: process.env.MEASUREMENT_BROWSER_CHANNEL } : {}) });
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
        const page = await context.newPage();
        await page.goto('https://graph-image.test');
        const result = await page.evaluate(async sourceText => {
            const { copyGraphImage: copy } = await import('data:text/javascript;base64,' + btoa(sourceText));
            const canvas = document.createElement('canvas');
            canvas.width = 1600; canvas.height = 900;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1600, 900);
            ctx.fillStyle = '#ff0000'; ctx.fillRect(40, 80, 80, 80);
            ctx.fillStyle = '#000000'; ctx.font = '40px Arial'; ctx.fillText('Frequency Response', 40, 50);
            let captured, called = false;
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                write: async items => { called = true; captured = await items[0].getType('image/png'); }
            } });
            const pending = copy(canvas);
            const synchronousWrite = called;
            await pending;
            const bytes = new Uint8Array(await captured.arrayBuffer());
            const bitmap = await createImageBitmap(captured);
            const decoded = document.createElement('canvas'); decoded.width = bitmap.width; decoded.height = bitmap.height;
            const dc = decoded.getContext('2d'); dc.drawImage(bitmap, 0, 0); bitmap.close();
            return { synchronousWrite, signature: Array.from(bytes.slice(0, 8)), bytes: bytes.length,
                width: decoded.width, height: decoded.height,
                red: Array.from(dc.getImageData(60, 100, 1, 1).data), white: Array.from(dc.getImageData(1500, 800, 1, 1).data) };
        }, source);
        assert.equal(result.synchronousWrite, true);
        assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.ok(result.bytes > 1000);
        assert.equal(result.width, 1600); assert.equal(result.height, 900);
        assert.deepEqual(result.red, [255, 0, 0, 255]);
        assert.deepEqual(result.white, [255, 255, 255, 255]);
    } finally { await browser.close(); }
});
