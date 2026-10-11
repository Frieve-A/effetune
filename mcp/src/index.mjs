#!/usr/bin/env node
// stdio entry point: `npx -y effetune-mcp` with EFFETUNE_URL set to the pairing link.
// EFFETUNE_MCP_ALLOW_RAW=1 also offers raw_request. `effetune-mcp setup` registers the server
// in MCP clients (src/setup.mjs).

import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EffeTuneClient } from './client.mjs';
import { createServer } from './server.mjs';

const { name, version } = createRequire(import.meta.url)('../package.json');

if (process.argv[2] === 'setup') {
    const { runSetup } = await import('./setup.mjs');
    process.exit(await runSetup({ argv: process.argv.slice(3) }));
}

// The environment comes first: a link on the command line is visible to other local users.
const url = process.env.EFFETUNE_URL || process.argv[2];
const client = new EffeTuneClient({ url, clientName: name, clientVersion: version });
const server = createServer(client, { name, version, allowRaw: process.env.EFFETUNE_MCP_ALLOW_RAW === '1' });

await server.connect(new StdioServerTransport());
// stdout carries the protocol; diagnostics go to stderr.
console.error(`[${name}] ${version} ready${url ? '' : ' (EFFETUNE_URL is not set)'}`);
if (!process.env.EFFETUNE_URL && process.argv[2]) {
    console.error(`[${name}] the link was given on the command line, where other local users can read it; prefer EFFETUNE_URL`);
}

const shutdown = () => {
    client.close();
    process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
