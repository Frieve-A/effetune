import assert from 'node:assert/strict';

export async function runMidiInputBrowserSmoke({ browser, baseURL }) {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        // Chromium's BlockMidiByDefault requests the stronger permission even when
        // the requested MIDIAccess excludes SysEx. The returned access must not enable it.
        await context.grantPermissions(['midi', 'midi-sysex'], { origin: new URL(baseURL).origin });
        await page.goto(`${baseURL}/tests/browser/midi-input-smoke.fixture.html`);
        await page.waitForFunction(() => typeof window.runMidiInputSmoke === 'function');
        const ports = await page.evaluate(async () => {
            if (!navigator.requestMIDIAccess) return { available: false };
            const permission = await navigator.permissions.query({ name: 'midi', sysex: false });
            let access;
            try { access = await navigator.requestMIDIAccess({ sysex: false }); }
            catch (error) { throw new Error(`${error.name}: MIDI permission=${permission.state}, secure=${isSecureContext}, origin=${location.origin}`); }
            return { available: true, inputs: access.inputs.size, outputs: access.outputs.size,
                sysexEnabled: access.sysexEnabled };
        });
        assert.equal(ports.available, true, 'Chromium exposes Web MIDI in the secure managed fixture');
        assert.equal(ports.sysexEnabled, false);
        const audio = [];
        for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
            const result = await page.evaluate(artifact => window.runMidiInputSmoke(artifact), artifact);
            assert.equal(result.suspended, 'suspended');
            assert.equal(result.running, 'running');
            assert.ok(result.peak > .01, 'queued port-boundary note reaches real AudioWorklet/native audio after resume');
            assert.equal(result.leases, 0);
            audio.push({ artifact, ...result });
        }
        return { ports, audio, inputBoundary: 'authored channel messages; no physical or virtual output port was opened' };
    } finally { await context.close(); }
}
