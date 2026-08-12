import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..', '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || path.basename(npmCli) !== 'npm-cli.js') {
  throw new Error('npm_execpath does not identify npm-cli.js.');
}
const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-npm-install-')));
const installRoot = path.join(temporaryRoot, 'consumer');
const npmEnvironment = {
  ...process.env,
  npm_config_cache: path.join(temporaryRoot, 'cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false'
};

try {
  await mkdir(installRoot);
  await run(process.execPath, [
    npmCli,
    'pack',
    '--pack-destination',
    temporaryRoot
  ], {
    cwd: packageRoot,
    maxBuffer: 16 * 1024 * 1024,
    env: npmEnvironment
  });
  const tarballs = (await readdir(temporaryRoot)).filter(file => file.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error('npm pack did not create exactly one package archive.');
  const archive = path.join(temporaryRoot, tarballs[0]);
  await run(process.execPath, [
    npmCli,
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    '--prefix',
    installRoot,
    archive
  ], {
    cwd: installRoot,
    maxBuffer: 16 * 1024 * 1024,
    env: npmEnvironment
  });

  const smoke = [
    "import('@effetune/dsp').then(async m => {",
    "  if (m.EFFECT_TYPES.length !== 90) throw new Error('catalog mismatch');",
    "  if (m.EFFECT_CATALOG.channels.length !== 15) throw new Error('catalog channels missing');",
    "  for (const type of m.EFFECT_TYPES) {",
    "    const factoryName = `create${type}`;",
    "    if (typeof m[type] !== 'function') throw new Error(`missing class ${type}`);",
    "    if (typeof m[factoryName] !== 'function') throw new Error(`missing factory ${factoryName}`);",
    "  }",
    "  const eta1 = m.encodeEta1({channels: [Float32Array.of(1)], sampleRate: 48000, topology: 'mono'});",
    "  if (!(eta1 instanceof ArrayBuffer) || eta1.byteLength !== 36) throw new Error('ETA1 encoding failed');",
    "  const chain = await m.createChain({version: 1, chain: [{type: 'Compressor', parameters: {threshold: -18}}]}, {variant: 'baseline'});",
    "  const input = [new Float32Array(128).fill(1)];",
    "  const output = await chain.process(input, {sampleRate: 48000});",
    "  chain.close();",
    "  if (output.length !== 1 || output[0].length !== 128 || output[0][127] === 1) throw new Error('preset execution failed');",
    "  const sameAudio = (left, right) => left.length === right.length && left.every((channel, index) => channel.length === right[index].length && channel.every((value, frame) => value === right[index][frame]));",
    "  const modulationInput = [Float32Array.from({length: 512}, (_, index) => Math.sin(index * 0.071) * 0.4), Float32Array.from({length: 512}, (_, index) => Math.cos(index * 0.053) * 0.3)];",
    "  const canonicalizeModulation = (type, parameters) => { const values = {...parameters}; if (type === 'AutoFilter' && values.minimumFrequency > values.maximumFrequency) [values.minimumFrequency, values.maximumFrequency] = [values.maximumFrequency, values.minimumFrequency]; else if (type === 'Chorus' && values.depth > values.delay) values.depth = values.delay; else if (type === 'FrequencyShifter' && values.minimumShift > values.maximumShift) [values.minimumShift, values.maximumShift] = [values.maximumShift, values.minimumShift]; return values; };",
    "  const modulationCases = [",
    "    ['AutoFilter', {minimumFrequency: 8000, maximumFrequency: 200}, {minimumFrequency: 200, maximumFrequency: 8000}, {minimumFrequency: 100, maximumFrequency: 9000}],",
    "    ['Chorus', {delay: 0.5, depth: 20}, {delay: 0.5, depth: 0.5}, {delay: 10, depth: 0.25}],",
    "    ['FrequencyShifter', {minimumShift: 900, maximumShift: 20}, {minimumShift: 20, maximumShift: 900}, {minimumShift: 10, maximumShift: 1000}]",
    "  ];",
    "  for (const [type, supplied, canonical, updates] of modulationCases) {",
    "    const id = `${type}-installed`;",
    "    const named = await m.createChain([new m[type]({id, ...supplied})], {variant: 'baseline'});",
    "    const serialized = await m.createChain(JSON.stringify({version: 1, chain: [{id, type, parameters: supplied}]}), {variant: 'baseline'});",
    "    const reference = await m.createChain({version: 1, chain: [{id, type, parameters: canonical}]}, {variant: 'baseline'});",
    "    const expected = await reference.process(modulationInput, {sampleRate: 48000, blockSize: 64});",
    "    if (JSON.stringify(named.preset) !== JSON.stringify(serialized.preset) || Object.entries(supplied).some(([name, value]) => named.effects[0].parameters[name] !== value) || !sameAudio(await named.process(modulationInput, {sampleRate: 48000, blockSize: 64}), expected) || !sameAudio(await serialized.process(modulationInput, {sampleRate: 48000, blockSize: 64}), expected)) throw new Error(`${type} installed cross-field paths failed`);",
    "    for (const ordered of [Object.entries(supplied), Object.entries(supplied).reverse()]) {",
    "      const eventChain = await m.createChain([new m[type]({id})], {variant: 'baseline'});",
    "      const eventStream = await eventChain.stream({sampleRate: 48000, channels: 2, blockSize: 64});",
    "      const actual = await eventStream.process(modulationInput, {events: ordered.map(([name, value]) => ({frame: 0, effectId: id, parameters: {[name]: value}}))});",
    "      if (!sameAudio(actual, expected) || JSON.stringify(eventStream.preset) !== JSON.stringify(reference.preset) || JSON.stringify(eventStream.effects) !== JSON.stringify(reference.effects)) throw new Error(`${type} installed event merge failed`);",
    "      eventStream.close();",
    "      eventChain.close();",
    "    }",
    "    for (const surface of ['setParam', 'event']) {",
    "      for (const names of [Object.keys(updates), Object.keys(updates).reverse()]) {",
    "        const candidate = await m.createChain(JSON.stringify({version: 1, chain: [{id, type, parameters: supplied}]}), {variant: 'baseline'});",
    "        const candidateStream = await candidate.stream({sampleRate: 48000, channels: 2, blockSize: 64});",
    "        const sequentialReference = await m.createChain({version: 1, chain: [{id, type, parameters: canonical}]}, {variant: 'baseline'});",
    "        const referenceStream = await sequentialReference.stream({sampleRate: 48000, channels: 2, blockSize: 64});",
    "        const steps = [[names[0], supplied[names[0]]], [names[1], supplied[names[1]]], [names[0], updates[names[0]]], [names[1], updates[names[1]]]];",
    "        let effective = {...canonical}; const raw = {...supplied}; let verifiedRoundTrip = false;",
    "        for (const [name, value] of steps) {",
    "          raw[name] = value; effective = canonicalizeModulation(type, {...effective, [name]: value});",
    "          const referenceOutput = await referenceStream.process(modulationInput, {events: [{frame: 0, effectId: id, parameters: effective}]});",
    "          let candidateOutput;",
    "          if (surface === 'setParam') { candidateStream.setParam(id, name, value); candidateOutput = await candidateStream.process(modulationInput); }",
    "          else candidateOutput = await candidateStream.process(modulationInput, {events: [{frame: 0, effectId: id, parameters: {[name]: value}}]});",
    "          if (!sameAudio(candidateOutput, referenceOutput) || JSON.stringify(candidateStream.preset) !== JSON.stringify(referenceStream.preset) || JSON.stringify(candidateStream.effects) !== JSON.stringify(referenceStream.effects) || Object.keys(supplied).some(parameterName => candidateStream.effects[0].parameters[parameterName] !== effective[parameterName])) throw new Error(`${type} installed sequential ${surface} state failed for ${names.join(',')}`);",
    "          const rawDiffersFromEffective = Object.keys(supplied).some(parameterName => raw[parameterName] !== effective[parameterName]);",
    "          if (!verifiedRoundTrip && rawDiffersFromEffective) {",
    "            const exposedPreset = candidateStream.preset; exposedPreset.chain[0].enabled = false;",
    "            if (!candidateStream.preset.chain[0].enabled) throw new Error(`${type} installed stream preset was not cloned`);",
    "            const snapshot = candidateStream.preset;",
    "            const restored = await m.createChain(snapshot, {variant: 'baseline'});",
    "            const restoredStream = await restored.stream({sampleRate: 48000, channels: 2, blockSize: 64});",
    "            const expectedState = await m.createChain(referenceStream.preset, {variant: 'baseline'});",
    "            if (JSON.stringify(restored.preset) !== JSON.stringify(snapshot) || JSON.stringify(restored.effects) !== JSON.stringify(snapshot.chain) || JSON.stringify(restoredStream.preset) !== JSON.stringify(snapshot) || JSON.stringify(restoredStream.effects) !== JSON.stringify(snapshot.chain) || !sameAudio(await restoredStream.process(modulationInput), await expectedState.process(modulationInput, {sampleRate: 48000, blockSize: 64}))) throw new Error(`${type} installed stream preset round trip failed`);",
    "            restoredStream.close(); restored.close(); expectedState.close(); verifiedRoundTrip = true;",
    "          }",
    "        }",
    "        if (!verifiedRoundTrip) throw new Error(`${type} installed stream preset round trip was not exercised`);",
    "        candidateStream.close(); referenceStream.close(); candidate.close(); sequentialReference.close();",
    "      }",
    "    }",
    "    named.close(); serialized.close(); reference.close();",
    "  }",
    "  const shifter = await m.createChain([new m.FrequencyShifter()], {variant: 'baseline'});",
    "  for (const [sampleRate, expected] of [[48000, 114], [96000, 228], [192000, 456]]) {",
    "    if (await shifter.latencySamples({sampleRate, channels: 2}) !== expected) throw new Error(`installed FrequencyShifter latency failed at ${sampleRate}`);",
    "    const stream = await shifter.stream({sampleRate, channels: 2, blockSize: 64});",
    "    if (stream.latencySamples !== expected) throw new Error(`installed FrequencyShifter stream latency failed at ${sampleRate}`);",
    "    stream.close();",
    "  }",
    "  shifter.close();",
    "  const graphDocument = {version: 1, input: {id: 'input'}, output: {id: 'output'}, nodes: [{id: 'level', type: 'Volume', parameters: {volume: -6}}], edges: [{id: 'in', source: 'input', destination: 'level'}, {id: 'out', source: 'level', destination: 'output'}]};",
    "  for (const variant of ['baseline', 'simd']) {",
    "    const graph = await m.createGraph(graphDocument, {variant});",
    "    const stream = await graph.stream({sampleRate: 48000, channels: 1, blockSize: 64});",
    "    const block = [new Float32Array(64).fill(1)];",
    "    const first = await stream.process(block);",
    "    if (first[0].length !== 64 || !(first[0][0] > 0 && first[0][0] < 1)) throw new Error(`${variant} Graph first block failed`);",
    "    stream.setParam('level', 'volume', -12);",
    "    const updated = await stream.process(block);",
    "    if (!(updated[0][0] > 0 && updated[0][0] < first[0][0])) throw new Error(`${variant} Graph update failed`);",
    "    stream.reset();",
    "    const replay = await stream.process(block);",
    "    if (Math.abs(replay[0][0] - first[0][0]) > 1e-6) throw new Error(`${variant} Graph reset failed`);",
    "    const snapshot = stream.visualizationSnapshot();",
    "    if (!snapshot.nodes.some(node => node.id === 'level' && node.state === 'effective') || snapshot.edges.length !== 2) throw new Error(`${variant} Graph snapshot failed`);",
    "    stream.close();",
    "    graph.close();",
    "  }",
    "  const irPayload = m.encodeEta1({channels: [Float32Array.of(1)], sampleRate: 48000, topology: 'mono'});",
    "  let graphAssetResolutions = 0;",
    "  const assetGraph = await m.createGraph({version: 1, input: {id: 'input'}, output: {id: 'output'}, nodes: [{id: 'room', type: 'IRReverb', parameters: {channelMode: 'mono', latency: 0, convolutionRate: 'full', wetLevel: 0, dryLevel: -96, preDelay: 0}, assets: {impulseResponse: 'tiny-ir'}}], edges: [{id: 'in', source: 'input', destination: 'room'}, {id: 'out', source: 'room', destination: 'output'}]}, {variant: 'baseline', assetResolver: reference => { if (reference !== 'tiny-ir') throw new Error('unexpected Graph asset'); graphAssetResolutions++; return irPayload; }});",
    "  const assetStream = await assetGraph.stream({sampleRate: 48000, channels: 1, blockSize: 64});",
    "  const assetOutput = await assetStream.process([Float32Array.of(1, ...new Float32Array(63))]);",
    "  if (graphAssetResolutions !== 1 || !Number.isFinite(assetOutput[0][0])) throw new Error('Graph asset prewarm failed');",
    "  assetStream.close();",
    "  assetGraph.close();",
    "  const generated = await import('@effetune/dsp');",
    "  new generated.Compressor({threshold: -12});",
    "  const catalog = await import('@effetune/dsp/catalog');",
    "  if (catalog.EFFECT_CATALOG.effects.length !== 90) throw new Error('catalog subpath failed');",
    "})"
  ].join('\n');
  await run(process.execPath, ['--input-type=module', '--eval', smoke], {
    cwd: installRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  await run(process.execPath, [
    path.join(repositoryRoot, 'tools', 'dsp-parity', 'graph-v1.mjs'),
    '--api',
    path.join(installRoot, 'node_modules', '@effetune', 'dsp', 'dist', 'index.js')
  ], {
    cwd: installRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  console.log('Temporary npm install plus baseline/SIMD Chain and Graph execution verified.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
