import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const LOCALES = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
const PAGED_KEYS = [
  'library.paged.loading', 'library.paged.loadFailed', 'library.paged.retry',
  'library.paged.selectAllResults', 'library.paged.selectionStale',
  'library.paged.reselect', 'library.paged.selectionTooLarge',
  'library.paged.reselectFailed', 'library.paged.playlistVersionUnavailable',
  'library.paged.serviceUnavailable', 'library.paged.selectTrack',
  'library.paged.previous', 'library.paged.next', 'library.paged.page',
  'library.job.action.operation', 'library.job.action.play',
  'library.job.action.playNext', 'library.job.action.queue',
  'library.job.action.addToPlaylist', 'library.job.action.importPlaylist',
  'library.job.waiting', 'library.job.cancelling',
  'library.job.phase.received', 'library.job.phase.snapshotting',
  'library.job.phase.materializing', 'library.job.phase.ready',
  'library.job.phase.cancel_requested', 'library.job.phase.committing',
  'library.job.terminal.succeeded', 'library.job.terminal.failed',
  'library.job.terminal.cancelled', 'library.job.terminal.interrupted',
  'library.job.progressKnown', 'library.job.progressUnknown',
  'library.queue.previousPage', 'library.queue.nextPage', 'library.queue.trackNumber',
  'library.error.actionFailed', 'error.playbackCommandFailed'
];

function readValues(locale) {
  const source = readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8');
  const values = new Map();
  for (const match of source.matchAll(/^\s*"([^"]+)"\s*:\s*"((?:\\.|[^"])*)"\s*,?\s*$/gm)) {
    values.set(match[1], match[2]);
  }
  return values;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
}

test('paged Library, durable job, and queue strings have locale and placeholder parity', () => {
  const english = readValues('en');
  for (const locale of LOCALES) {
    const values = readValues(locale);
    for (const key of PAGED_KEYS) {
      assert.ok(values.get(key), `${locale} is missing ${key}`);
      assert.deepEqual(placeholders(values.get(key)), placeholders(english.get(key)), `${locale} placeholder mismatch for ${key}`);
    }
  }
});
