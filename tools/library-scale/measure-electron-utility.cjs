'use strict';

const { app, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { LibraryCatalogUtilityHost } = require('../../electron/library-catalog-utility-host.cjs');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('Invalid Electron reference arguments');
    result[name.slice(2)] = value;
  }
  return result;
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

async function seedCatalog(dbPath, audioRoot, fixture, options) {
  const host = await LibraryCatalogHost.open({ dbPath });
  const started = performance.now();
  try {
    await host.upsertFolders([{
      id: 'reference-folder',
      kind: 'electron',
      displayName: 'Reference Music',
      path: audioRoot,
      status: 'ok',
      lifecycleVersion: 1,
      scanGeneration: 0,
      addedAt: 1
    }]);
    for (const batch of fixture.referenceTrackBatches(options)) await host.upsertTracks(batch);
  } finally {
    await host.close();
  }
  return performance.now() - started;
}

async function measure(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const count = Number(args.count);
  const seed = Number(args.seed);
  const samples = Number(args.samples);
  if (!path.isAbsolute(args.output) || !path.isAbsolute(args.directory) ||
      !Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(seed) ||
      !Number.isSafeInteger(samples) || samples < 1) {
    throw new Error('Electron reference measurement arguments are invalid');
  }
  const fixture = await import(pathToFileURL(path.join(__dirname, 'reference-fixture.mjs')).href);
  fs.mkdirSync(args.directory, { recursive: true });
  const audioRoot = path.join(args.directory, 'audio');
  fs.mkdirSync(audioRoot, { recursive: true });
  const dbPath = path.join(args.directory, 'catalog.sqlite');
  const fixtureLoadMs = await seedCatalog(dbPath, audioRoot, fixture, { count, seed });

  const openUtility = () => LibraryCatalogUtilityHost.open({
      dbPath,
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getMainWindow: () => null,
      processFactory: modulePath => utilityProcess.fork(modulePath, [], {
        serviceName: 'EffeTune reference Music Library'
      })
    });
  const firstRowSamples = [];
  let utility = null;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    utility = await openUtility();
    const page = await utility.repository.queryTracks({
      query: '', sort: 'title', direction: 'asc', limit: 100
    });
    firstRowSamples.push(performance.now() - started);
    await utility.repository.releaseContext(page.contextToken);
    if (index < samples - 1) {
      await utility.close();
      utility = null;
    }
  }
  let output;
  try {
    const repository = utility.repository;
    const firstPageSamples = [];
    const rareSearchSamples = [];
    for (let index = 0; index < samples; index += 1) {
      let started = performance.now();
      const page = await repository.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 100 });
      firstPageSamples.push(performance.now() - started);
      await repository.releaseContext(page.contextToken);
      started = performance.now();
      const search = await repository.queryTracks({ query: 'Needle 0000997', sort: 'title', direction: 'asc', limit: 100 });
      rareSearchSamples.push(performance.now() - started);
      await repository.releaseContext(search.contextToken);
    }

    const context = await repository.createContext({
      query: '', sort: 'title', direction: 'asc', scope: null
    });
    const jumpSamples = [];
    for (const ordinal of [0, Math.floor(count / 2), Math.max(0, count - 100)]) {
      const started = performance.now();
      await repository.readContextPageAtOrdinal({ contextToken: context.contextToken, ordinal, limit: 100 });
      jumpSamples.push(performance.now() - started);
    }
    await repository.releaseContext(context.contextToken);
    const counts = await repository.getCounts();
    output = {
      adapterId: 'electron-library-catalog-utility-v1',
      production: true,
      fixture: { count, seed, digest: args.digest },
      runtime: {
        electron: process.versions.electron,
        node: process.versions.node,
        utilityProcessId: utility.child?.pid ?? null
      },
      metrics: {
        fixtureLoadMs,
        libraryFirstRowP95Ms: p95(firstRowSamples),
        commonQueryFirstPageP95Ms: p95(firstPageSamples),
        rareSearchFirstPageP95Ms: p95(rareSearchSamples),
        arbitraryJumpMaxMs: Math.max(...jumpSamples)
      },
      assertions: { catalogTrackCount: Number(counts.tracks) }
    };
  } finally {
    await utility.close();
  }
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

app.whenReady()
  .then(() => measure())
  .catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
