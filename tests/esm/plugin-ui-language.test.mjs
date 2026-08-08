import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginsRoot = path.join(repoRoot, 'plugins');

async function javascriptFiles(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return javascriptFiles(entryPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
    }));
    return nested.flat();
}

test('effect plugin UI does not depend on the app language', async () => {
    const languageDependencies = [
        /uiManager\s*\??\.\s*t\s*(?:\?\.\s*)?\(/,
        /uiManager\s*\??\.\s*userLanguage/,
        /navigator\.language/,
        /documentElement\.lang/
    ];

    for (const file of await javascriptFiles(pluginsRoot)) {
        const source = await fs.readFile(file, 'utf8');
        for (const dependency of languageDependencies) {
            assert.doesNotMatch(source, dependency,
                `${path.relative(repoRoot, file)} must keep its effect UI in English`);
        }
    }
});
