// Starts the real desktop app with Remote Control on and checks `describeEffects`
// against every effect it loads: each key of each effect must be described, and
// the ranges written by hand (js/remote/parameter-hints.js) must match what the effect clamps to.

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright';
import WebSocket from 'ws';

const repoRoot = path.resolve('.');
const PORT = 47395;
const TOKEN = 'tok-real-app-describe';

function request(op) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?t=${TOKEN}`);
        const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout waiting for ${op}`)); }, 60_000);
        ws.on('error', reject);
        ws.on('open', () => ws.send(JSON.stringify({ op, seq: 1 })));
        ws.on('message', data => {
            const message = JSON.parse(data.toString());
            if (message.seq !== 1) return;
            if (message.op === 'ack' && !message.ok) reject(new Error(message.error));
            if (message.op !== 'ack') {
                clearTimeout(timer);
                ws.close();
                resolve(message);
            }
        });
    });
}

async function waitForServer(deadlineMs = 30_000) {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
        try {
            return await request('hello');
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
}

async function mainWindow(application) {
    const deadline = Date.now() + 30_000;
    for (;;) {
        for (const page of application.windows()) {
            const ready = await page.evaluate(() => !!window.pluginManager?.pluginClasses).catch(() => false);
            if (ready) return page;
        }
        if (Date.now() > deadline) throw new Error('main window did not load its plugins');
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

test('the real app describes every key of every effect and hand-written ranges match the clamps', { timeout: 120_000 }, async () => {
    const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-remote-describe-')));
    let application = null;
    try {
        application = await electron.launch({
            args: [repoRoot, `--user-data-dir=${path.join(profile, 'profile')}`],
            env: {
                ...process.env,
                ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
                EFFETUNE_REMOTE: '1',
                EFFETUNE_REMOTE_PORT: String(PORT),
                EFFETUNE_REMOTE_TOKEN: TOKEN
            },
            timeout: 30_000
        });
        const initialHello = await waitForServer();
        assert.ok(initialHello.features.includes('describe1'));
        const { effects } = await request('describeEffects');
        const hello = await request('hello');
        assert.deepEqual(effects.map(e => e.nm), [...hello.effects].sort());

        assert.deepEqual(effects.filter(e => e.error || e.uiError).map(e => e.nm), []);
        const undescribed = effects.flatMap(e => e.params.filter(p => !p.source).map(p => `${e.nm}.${p.key}`));
        assert.deepEqual(undescribed, []);

        // Push each hinted number past both ends and read back what the effect kept.
        const hinted = effects.flatMap(e => e.params
            .filter(p => p.source === 'hint' && p.control === 'number' && Number.isFinite(p.min) && Number.isFinite(p.max)
                && !/not clamped/i.test(p.description || ''))
            .map(p => ({ nm: e.nm, key: p.key, min: p.min, max: p.max, minKey: p.minKey })));
        const page = await mainWindow(application);
        const outside = await page.evaluate(entries => entries.flatMap(({ nm, key, min, max, minKey }) => {
            const span = Math.max(1, max - min);
            const stateOf = plugin => plugin.getSerializableParameters?.() || plugin.getParameters();
            // `minKey`: the lower end follows another key's value (default state here).
            let lowEnd = min;
            if (minKey) {
                const plugin = window.pluginManager.createPlugin(nm);
                lowEnd = Math.max(min, stateOf(plugin)[minKey]);
                plugin.cleanup?.();
            }
            const kept = value => {
                const plugin = window.pluginManager.createPlugin(nm);
                plugin.setParameters({ [key]: value });
                // The same state the remote API reports (getSerializablePluginStateShort).
                const result = stateOf(plugin)[key];
                plugin.cleanup?.();
                return result;
            };
            const low = kept(min - span);
            const high = kept(max + span);
            // Both ends must be reached exactly, so a hint can be neither wider nor narrower.
            const near = (v, end) => typeof v === 'number' && Math.abs(v - end) <= 1e-9 * Math.max(1, Math.abs(end));
            return near(low, lowEnd) && near(high, max) ? [] : [`${nm}.${key} [${lowEnd}, ${max}] kept ${low} / ${high}`];
        }), hinted);
        assert.deepEqual(outside, []);
    } finally {
        await application?.close();
        await rm(profile, { recursive: true, force: true });
    }
});
