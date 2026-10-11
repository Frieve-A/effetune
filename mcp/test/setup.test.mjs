// setup never touches the real CLIs or the user's settings here: commands go to a
// recorder and Claude Desktop's config lives in a temporary home.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalLink, claudeDesktopConfigPath, launchCommand, runSetup } from '../src/setup.mjs';

const LINK = 'http://192.168.1.10:47300/?t=0123abcd';
const HELLO = { appName: 'EffeTune', app: '2.13.0', host: 'studio', features: ['sync1', 'describe1'] };

function harness(t, { installed = ['claude', 'codex'], existing = [], failAdd = [], answers = [], desktop = true, platform = 'linux' } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-mcp-setup-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const env = { XDG_CONFIG_HOME: path.join(home, '.config') };
    const desktopFile = claudeDesktopConfigPath({ platform, env, homedir: home });
    if (desktop) fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
    const calls = [];
    const registered = new Set(existing);
    const run = (command, args) => {
        calls.push([command, ...args].join(' '));
        if (!installed.includes(command)) return { status: null, stdout: '', stderr: '' };
        if (args[0] === '--version') return { status: 0, stdout: '1.0', stderr: '' };
        const key = `${command}`;
        if (args[1] === 'get') return { status: registered.has(key) ? 0 : 1, stdout: '', stderr: '' };
        if (args[1] === 'remove') { registered.delete(key); return { status: 0, stdout: '', stderr: '' }; }
        if (args[1] === 'add') {
            if (failAdd.includes(command)) return { status: 1, stdout: '', stderr: 'boom' };
            if (registered.has(key)) return { status: 1, stdout: '', stderr: 'already exists' };
            registered.add(key);
            return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'unexpected' };
    };
    const asked = [];
    const ask = async prompt => { asked.push(prompt); return answers.length ? answers.shift() : ''; };
    const logs = [];
    const go = (argv, overrides = {}) => runSetup({
        argv, env, platform, homedir: home, run, ask, log: line => logs.push(line),
        verify: async link => { assert.equal(link, LINK); return HELLO; }, ...overrides
    });
    return { go, calls, asked, logs, desktopFile, registered };
}

test('links are rebuilt from parsed parts so no shell syntax reaches a command line', () => {
    assert.equal(canonicalLink(' http://192.168.1.10:47300/?t=0123abcd#x '), LINK);
    assert.equal(canonicalLink('ws://[fe80::1]:47300/?t=abc'), 'http://[fe80::1]:47300/?t=abc');
    assert.equal(canonicalLink('http://host.local:47300/remote?x=1&t=abc'), 'http://host.local:47300/?t=abc');
    for (const bad of ['http://h:1/?t=abc%26calc', 'http://h:1/?t=a"b', 'http://h:1/?t=', 'file:///etc/passwd', 'calc & x']) {
        assert.throws(() => canonicalLink(bad), bad);
    }
});

test('the launch command goes through cmd on Windows only', () => {
    assert.deepEqual(launchCommand('win32'), { command: 'cmd', args: ['/c', 'npx', '-y', 'effetune-mcp'] });
    assert.deepEqual(launchCommand('darwin'), { command: 'npx', args: ['-y', 'effetune-mcp'] });
});

test('--yes registers in every client found, keeping the rest of the Desktop config', async t => {
    const h = harness(t);
    fs.writeFileSync(h.desktopFile, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
    assert.equal(await h.go(['--url', LINK, '--yes']), 0);
    assert.ok(h.calls.includes(`claude mcp add effetune -s user -e EFFETUNE_URL=${LINK} -- npx -y effetune-mcp`));
    assert.ok(h.calls.includes(`codex mcp add effetune --env EFFETUNE_URL=${LINK} -- npx -y effetune-mcp`));
    const config = JSON.parse(fs.readFileSync(h.desktopFile, 'utf8'));
    assert.equal(config.theme, 'dark');
    assert.deepEqual(config.mcpServers.other, { command: 'x' });
    assert.deepEqual(config.mcpServers.effetune, { command: 'npx', args: ['-y', 'effetune-mcp'], env: { EFFETUNE_URL: LINK } });
    assert.ok(fs.existsSync(`${h.desktopFile}.bak`));
    assert.deepEqual(h.asked, []);
    assert.ok(h.logs.some(line => line.includes('Connected to EffeTune 2.13.0 on studio')));
});

test('without --yes each client is asked, and an existing entry is replaced only when confirmed', async t => {
    // Asked in order: Claude Code? yes, Codex? no, Desktop? yes, then replace Claude Code's? no.
    const h = harness(t, { existing: ['claude'], answers: ['y', 'n', 'y', 'n'] });
    assert.equal(await h.go(['--url', LINK]), 0);
    assert.equal(h.calls.some(c => c.startsWith('claude mcp add') || c.startsWith('claude mcp remove')), false);
    assert.equal(h.calls.some(c => c.startsWith('codex mcp add')), false);
    assert.ok(fs.existsSync(h.desktopFile));
    assert.ok(h.logs.includes('Claude Code: kept the existing entry.'));
});

test('a replaced CLI entry is removed before it is added again', async t => {
    const h = harness(t, { existing: ['codex'], desktop: false });
    assert.equal(await h.go(['--url', LINK, '--client', 'codex', '--yes']), 0);
    const remove = h.calls.indexOf('codex mcp remove effetune');
    assert.ok(remove >= 0 && remove < h.calls.findIndex(c => c.startsWith('codex mcp add')));
});

test('the link is asked for when neither --url nor EFFETUNE_URL gives it', async t => {
    const h = harness(t, { answers: [LINK], desktop: false, installed: [] });
    assert.equal(await h.go([]), 0);
    assert.match(h.asked[0], /Pairing link/);
    assert.ok(h.logs.includes('No Claude Code, Codex or Claude Desktop installation was found.'));
});

test('an unreachable app or a bad link stops before anything is registered', async t => {
    const h = harness(t);
    assert.equal(await h.go(['--url', LINK, '--yes'], { verify: async () => { throw new Error('EffeTune refused the token (4401)'); } }), 1);
    assert.ok(h.logs.some(line => line.includes('refused the token')));
    assert.equal(await h.go(['--url', 'http://h:1/?t=a&calc', '--yes']), 1);
    assert.equal(h.calls.some(c => c.includes(' mcp add ')), false);
    assert.equal(fs.existsSync(h.desktopFile), false);
});

test('a missing CLI prints the command, a broken Desktop config is left alone, failures set the exit code', async t => {
    const h = harness(t, { installed: ['codex'], failAdd: ['codex'] });
    fs.writeFileSync(h.desktopFile, '{ not json');
    assert.equal(await h.go(['--url', LINK, '--client', 'claude-code,codex,claude-desktop']), 1);
    assert.ok(h.logs.includes(`  claude mcp add effetune -s user -e EFFETUNE_URL=${LINK} -- npx -y effetune-mcp`));
    assert.ok(h.logs.some(line => line.startsWith('Codex: registration failed: boom')));
    assert.equal(fs.readFileSync(h.desktopFile, 'utf8'), '{ not json');
    assert.equal(fs.existsSync(`${h.desktopFile}.bak`), false);
});

test('unknown options and clients are refused', async t => {
    const h = harness(t);
    assert.equal(await h.go(['--url', LINK, '--client', 'chatgpt']), 1);
    assert.ok(h.logs.some(line => line.includes('unknown client: chatgpt')));
    assert.equal(await h.go(['--bogus']), 1);
});
