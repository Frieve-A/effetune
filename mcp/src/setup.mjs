// `npx -y effetune-mcp setup`: checks a pairing link against the running app and
// registers this server in Claude Code, Codex and Claude Desktop.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { EffeTuneClient } from './client.mjs';

const SERVER_NAME = 'effetune';
const PACKAGE = 'effetune-mcp';
const CLIENTS = ['claude-code', 'codex', 'claude-desktop'];
const LABELS = { 'claude-code': 'Claude Code', codex: 'Codex', 'claude-desktop': 'Claude Desktop' };

const USAGE = `Usage: npx -y ${PACKAGE} setup [--url <pairing link>] [--client <${CLIENTS.join(',')}>] [--yes]

Checks the pairing link from EffeTune (Settings > Remote Control > Copy link) and registers
the "${SERVER_NAME}" MCP server in the chosen clients. --yes registers every client found and
replaces an existing "${SERVER_NAME}" entry without asking.`;

// The link ends up on a command line run through a shell (Windows .cmd shims), so it is
// rebuilt from parsed parts that cannot carry shell syntax.
export function canonicalLink(link) {
    let url;
    try {
        url = new URL(String(link || '').trim());
    } catch (_) {
        throw new Error('not a URL; paste the link from Settings > Remote Control > Copy link');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error(`unsupported scheme: ${url.protocol}`);
    }
    const token = url.searchParams.get('t') || '';
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(token)) throw new Error('the link carries no valid token (t=...)');
    if (!/^[A-Za-z0-9.:[\]-]+$/.test(url.host)) throw new Error(`unexpected host: ${url.host}`);
    const scheme = url.protocol === 'https:' || url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${scheme}//${url.host}/?t=${token}`;
}

export function launchCommand(platform) {
    // npx is a .cmd shim on Windows, which clients cannot start without a shell.
    return platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'npx', '-y', PACKAGE] }
        : { command: 'npx', args: ['-y', PACKAGE] };
}

export function claudeDesktopConfigPath({ platform, env, homedir }) {
    if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    return path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'Claude', 'claude_desktop_config.json');
}

function parseArgs(argv) {
    const args = { url: null, clients: null, yes: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
            return argv[++i];
        };
        if (arg === '--url') args.url = value();
        else if (arg === '--client') args.clients = value().split(',').map(s => s.trim()).filter(Boolean);
        else if (arg === '--yes' || arg === '-y') args.yes = true;
        else if (arg === '--help' || arg === '-h') args.help = true;
        else throw new Error(`unknown option: ${arg}`);
    }
    for (const client of args.clients || []) {
        if (!CLIENTS.includes(client)) throw new Error(`unknown client: ${client} (use ${CLIENTS.join(', ')})`);
    }
    return args;
}

function defaultRun(platform) {
    return (command, args) => {
        // Windows needs a shell for .cmd shims; every argument here is a constant or the
        // canonical link, which holds no shell syntax, so one joined line is safe.
        const result = platform === 'win32'
            ? spawnSync([command, ...args].join(' '), { encoding: 'utf8', shell: true, windowsHide: true })
            : spawnSync(command, args, { encoding: 'utf8' });
        return { status: result.error ? null : result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    };
}

async function defaultVerify(link) {
    const client = new EffeTuneClient({ url: link, clientName: `${PACKAGE} setup` });
    try {
        return await client.connect();
    } finally {
        client.close();
    }
}

// What each client is registered with, and how to show it to the user.
function cliRegistration(client, link, launch) {
    const binary = client === 'claude-code' ? 'claude' : 'codex';
    const add = client === 'claude-code'
        ? ['mcp', 'add', SERVER_NAME, '-s', 'user', '-e', `EFFETUNE_URL=${link}`, '--', launch.command, ...launch.args]
        : ['mcp', 'add', SERVER_NAME, '--env', `EFFETUNE_URL=${link}`, '--', launch.command, ...launch.args];
    const remove = client === 'claude-code' ? ['mcp', 'remove', SERVER_NAME, '-s', 'user'] : ['mcp', 'remove', SERVER_NAME];
    return { binary, add, remove, get: ['mcp', 'get', SERVER_NAME] };
}

export async function runSetup({
    argv = [],
    env = process.env,
    platform = process.platform,
    homedir = os.homedir(),
    run = defaultRun(platform),
    verify = defaultVerify,
    ask = null,
    log = message => console.log(message)
} = {}) {
    let rl = null;
    const question = ask || (async prompt => {
        rl ||= readline.createInterface({ input: process.stdin, output: process.stdout });
        return rl.question(prompt);
    });
    const confirm = async (prompt, yes) => yes || /^(y|yes|)$/i.test((await question(`${prompt} [Y/n] `)).trim());
    try {
        const args = parseArgs(argv);
        if (args.help) {
            log(USAGE);
            return 0;
        }

        // 1. The link, checked against the running app.
        const raw = args.url || env.EFFETUNE_URL || await question('Pairing link (EffeTune > Settings > Remote Control > Copy link): ');
        const link = canonicalLink(raw);
        let hello;
        try {
            hello = await verify(link);
        } catch (error) {
            log(`Could not reach EffeTune: ${error.message}`);
            log('Turn on Settings > Remote Control in EffeTune, copy the link again and rerun setup.');
            return 1;
        }
        log(`Connected to ${hello.appName || 'EffeTune'} ${hello.app || ''} on ${hello.host || 'the host'} (features: ${(hello.features || []).join(', ')})`);

        // 2. The clients to register in.
        const launch = launchCommand(platform);
        const desktopConfig = claudeDesktopConfigPath({ platform, env, homedir });
        const found = {
            'claude-code': run('claude', ['--version']).status === 0,
            codex: run('codex', ['--version']).status === 0,
            'claude-desktop': fs.existsSync(path.dirname(desktopConfig))
        };
        let chosen = args.clients;
        if (!chosen) {
            chosen = [];
            for (const client of CLIENTS.filter(c => found[c])) {
                if (await confirm(`Register in ${LABELS[client]}?`, args.yes)) chosen.push(client);
            }
            if (!CLIENTS.some(c => found[c])) log('No Claude Code, Codex or Claude Desktop installation was found.');
        }

        // 3. Register, replacing an existing entry only when allowed.
        let failed = 0;
        for (const client of chosen) {
            const label = LABELS[client];
            if (client === 'claude-desktop') {
                const outcome = await registerDesktop(desktopConfig, link, launch, { confirm, yes: args.yes, log });
                if (!outcome) failed++;
                continue;
            }
            const cli = cliRegistration(client, link, launch);
            if (!found[client]) {
                log(`${label}: the "${cli.binary}" command was not found. Run this once it is installed:`);
                log(`  ${cli.binary} ${cli.add.join(' ')}`);
                continue;
            }
            if (run(cli.binary, cli.get).status === 0) {
                if (!await confirm(`${label} already has "${SERVER_NAME}". Replace it?`, args.yes)) {
                    log(`${label}: kept the existing entry.`);
                    continue;
                }
                run(cli.binary, cli.remove);
            }
            const result = run(cli.binary, cli.add);
            if (result.status === 0) {
                log(`${label}: registered "${SERVER_NAME}".`);
            } else {
                failed++;
                log(`${label}: registration failed: ${(result.stderr || result.stdout).trim()}`);
            }
        }
        if (chosen.length) {
            log('The link (with its token) is now stored in those clients\' settings. After "New token" in EffeTune, rerun setup.');
            log('Restart the clients to load the server.');
        }
        return failed ? 1 : 0;
    } catch (error) {
        log(`setup: ${error.message}`);
        return 1;
    } finally {
        rl?.close();
    }
}

async function registerDesktop(file, link, launch, { confirm, yes, log }) {
    const label = LABELS['claude-desktop'];
    let config = {};
    let original = null;
    if (fs.existsSync(file)) {
        original = fs.readFileSync(file, 'utf8');
        try {
            config = original.trim() ? JSON.parse(original) : {};
        } catch (error) {
            log(`${label}: ${file} is not valid JSON (${error.message}); left unchanged.`);
            return false;
        }
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            log(`${label}: ${file} does not hold a JSON object; left unchanged.`);
            return false;
        }
    }
    const servers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
    if (Object.hasOwn(servers, SERVER_NAME) && !await confirm(`${label} already has "${SERVER_NAME}". Replace it?`, yes)) {
        log(`${label}: kept the existing entry.`);
        return true;
    }
    servers[SERVER_NAME] = { command: launch.command, args: launch.args, env: { EFFETUNE_URL: link } };
    config.mcpServers = servers;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (original !== null) fs.writeFileSync(`${file}.bak`, original);
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    log(`${label}: registered "${SERVER_NAME}" in ${file}${original !== null ? ` (previous file kept as ${path.basename(file)}.bak)` : ''}.`);
    return true;
}
