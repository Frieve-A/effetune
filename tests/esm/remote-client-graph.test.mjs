import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'js/remote/remote-client.js');

// Relative module specifiers written as string literals: static imports,
// re-exports and import("...") calls.
const specifier = /(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s*[^'"()]*?\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g;

function crawl(start) {
    const files = new Map();
    const visit = file => {
        if (files.has(file)) return;
        const text = fs.readFileSync(file, 'utf8');
        files.set(file, text);
        for (const match of text.matchAll(specifier)) {
            if (match[2].startsWith('.')) visit(path.resolve(path.dirname(file), match[2]));
        }
    };
    visit(start);
    return files;
}

const forbiddenModules = [
    'js/app.js',
    'js/ui-manager.js',
    'js/electron-integration.js',
    'js/audio/audio-context-manager.js'
];
// APIs that do not exist in an insecure context (plain http on a LAN address).
const forbiddenApis = [/crypto\.randomUUID/, /crypto\.subtle/, /navigator\.locks/, /getDirectory\(/];

test('the remote client page imports nothing that needs audio, Electron or a secure context', () => {
    const files = crawl(entry);
    assert.ok(files.size > 20, 'the crawl found the editor modules');
    for (const [file, text] of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        assert.ok(!forbiddenModules.includes(rel), `${rel} must not be reachable`);
        for (const pattern of forbiddenApis) {
            assert.ok(!pattern.test(text), `${rel} uses ${pattern}`);
        }
    }
});

test('the remote client does not import from the Chrome extension folder', () => {
    for (const file of crawl(entry).keys()) {
        assert.ok(!path.relative(root, file).startsWith('extension'), file);
    }
});

test('remote.html is a plain page: same-origin scripts only and no inline code', () => {
    const html = fs.readFileSync(path.join(root, 'remote.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.match(html, /script-src 'self'(?!\s+['"]?(unsafe|https))/);
    assert.ok(!/unsafe-eval/.test(html));
    // The server's header pins connect-src to its exact host; the meta policy only has to let a ws: URL
    // through (WebKit does not count ws:// as 'self'), and policies intersect.
    assert.match(html, /connect-src 'self' ws:(?=[;"])/);
    assert.ok(!/connect-src[^;"]*(https?:|\*)/.test(html), 'the meta policy opens nothing beyond ws:');
    for (const tag of html.matchAll(/<script\b([^>]*)>/g)) {
        assert.match(tag[1], /\bsrc="/, `inline script: ${tag[0]}`);
    }
    assert.match(html, /<script type="module" src="js\/remote\/remote-client\.js">/);
});

// The generator's list, not the committed sw-precache.js: that file is regenerated at release.
const { collectPrecacheUrls } = createRequire(import.meta.url)('../../scripts/generate-sw-precache.js');

test('every file the page loads is in the precache list the desktop host serves', () => {
    const listed = new Set(collectPrecacheUrls(root));
    assert.ok(listed.has('remote.html'));
    assert.ok(listed.has('css/effetune-remote.css'));
    const html = fs.readFileSync(path.join(root, 'remote.html'), 'utf8');
    for (const match of html.matchAll(/(?:href|src)="([^":]+)"/g)) {
        assert.ok(listed.has(match[1]), `${match[1]} is not precached`);
    }
    for (const file of crawl(entry).keys()) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        assert.ok(listed.has(rel), `${rel} is not precached`);
    }
});
