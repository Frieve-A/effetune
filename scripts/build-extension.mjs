import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const zipModule = { exports: {} };
vm.runInNewContext(await fs.readFile(path.join(root, 'js/vendor/jszip-3.10.1.min.js'), 'utf8'),
    { module: zipModule, exports: zipModule.exports, setImmediate, Buffer, Uint8Array, ArrayBuffer });
const JSZip = zipModule.exports;
const output = path.join(root, 'out', 'extension');
const define = { __EFFECTUNE_WASM_ONLY__: 'true' };

function staticSource(source, filename) {
    if (filename === 'plugins/lofi/cassette_artifacts.js') {
        const literal = source.match(/const CASSETTE_ARTIFACTS_REFERENCE_PROCESSOR = (`[\s\S]*?`);/);
        if (!literal) throw new Error('Cassette reference processor was not found');
        const body = vm.runInNewContext(source.slice(0, literal.index) + literal[1], Object.create(null), { timeout: 1000 });
        const expression = /new Function\('context', 'data', 'parameters', 'time',\s*CASSETTE_ARTIFACTS_REFERENCE_PROCESSOR\)/;
        if (!expression.test(source)) throw new Error('Cassette status simulation entry changed');
        source = source.replace(expression, () => `function(context, data, parameters, time) {${body}}`);
    }
    return source;
}

async function walk(directory) {
    const result = [];
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) result.push(...await walk(relative));
        else result.push(relative);
    }
    return result;
}

export async function buildExtension() {
    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
    manifest.version = packageJson.version;
    const definitions = await fs.readFile(path.join(root, 'plugins/plugins.txt'), 'utf8');
    const pluginPaths = [...definitions.matchAll(/^([^#\[\s][^:\n]+):[^\n]*\|/gm)].map(match => `plugins/${match[1]}`);
    const scripts = new Set([
        'extension/service-worker.js', 'extension/offscreen.js', 'extension/editor.js', 'extension/popup.js',
        'plugins/plugin-base.js', 'plugins/graph-point-interaction.js', 'plugins/spectrum-overlay.js', 'plugins/theme-palette.js',
        'plugins/audio-processor.js', ...pluginPaths.map(filename => `${filename}.js`)
    ]);
    const plugin = {
        name: 'extension-static-dsp',
        setup(build) {
            build.onLoad({ filter: /\.js$/ }, async args => ({
                contents: staticSource(await fs.readFile(args.path, 'utf8'), path.relative(root, args.path).replaceAll('\\', '/')),
                loader: 'js'
            }));
        }
    };
    // Include the application import graph and the workers addressed by URL.
    let previousSize;
    do {
        previousSize = scripts.size;
        const graph = await esbuild.build({ absWorkingDir: root, entryPoints: [...scripts],
            bundle: true, write: false, outdir: 'out/extension-analysis', format: 'esm',
            platform: 'browser', target: 'chrome116', metafile: true, define, plugins: [plugin], logLevel: 'silent' });
        for (const filename of Object.keys(graph.metafile.inputs)) scripts.add(filename.replaceAll('\\', '/'));
        for (const filename of [...scripts]) {
            const source = await fs.readFile(path.join(root, filename), 'utf8');
            for (const match of source.matchAll(/new URL\(\s*['"]([^'"]+\.js)['"]\s*,\s*import\.meta\.url/g)) {
                scripts.add(path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[1])));
            }
        }
    } while (scripts.size !== previousSize);
    const files = new Map();
    for (const filename of [...scripts].sort()) {
        const source = staticSource(await fs.readFile(path.join(root, filename), 'utf8'), filename);
        const transformed = await esbuild.transform(source, { loader: 'js', target: 'chrome116', define,
            minifySyntax: true, keepNames: true, legalComments: 'none' });
        if (/\bnew\s+Function\s*\(|\beval\s*\(/.test(transformed.code)) {
            throw new Error(`Dynamic JavaScript compilation is forbidden in the extension: ${filename}`);
        }
        files.set(filename, Buffer.from(transformed.code));
    }
    const materials = [
        ...(await walk('extension')).filter(filename => /\.(html|css)$/.test(filename)),
        ...(await walk('plugins')).filter(filename => filename.endsWith('.css')),
        ...(await walk('js/locales')),
        ...(await walk('presets')),
        'plugins/plugins.txt', 'plugins/dsp/effetune-dsp.wasm', 'plugins/dsp/effetune-dsp.simd.wasm',
        'plugins/dsp/effetune-dsp.meta.json', 'effetune.css', 'effetune-theme.css', 'effetune-mobile.css', 'pipeline-analyzer.css',
        'images/icon_192x192.png', 'images/icon_64x64.png', 'LICENSE'
    ];
    for (const filename of materials) files.set(filename, await fs.readFile(path.join(root, filename)));
    files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    // Replace only this build's generated directory.
    if (path.resolve(output) !== path.resolve(root, 'out', 'extension')) throw new Error('Invalid extension output');
    await fs.rm(output, { recursive: true, force: true });
    const zip = new JSZip();
    const date = new Date('2020-01-01T00:00:00Z');
    for (const [filename, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        await fs.mkdir(path.dirname(path.join(output, filename)), { recursive: true });
        await fs.writeFile(path.join(output, filename), bytes);
        zip.file(filename, bytes, { date, createFolders: false });
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const archive = path.join(root, 'out', `effetune-extension-${manifest.version}.zip`);
    await fs.writeFile(archive, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    console.log(`Extension: ${output}\nPackage: ${archive}\nFiles: ${files.size}\nSHA-256: ${sha256}`);
    return { output, archive, sha256, files: [...files.keys()] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildExtension();
