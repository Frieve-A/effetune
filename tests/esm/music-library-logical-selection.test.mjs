import assert from 'node:assert/strict';
import test from 'node:test';

import { LogicalSelection } from '../../js/ui/library/logical-selection.js';

test('logical all selection remains compact and records only exclusions', () => {
  const selection = new LogicalSelection('context-1');
  selection.selectAll();
  selection.setSelected('track-removed', false);

  assert.equal(selection.isSelected('track-visible'), true);
  assert.equal(selection.isSelected('track-removed'), false);
  assert.deepEqual(selection.toDescriptor(), {
    mode: 'all',
    contextToken: 'context-1',
    exclusions: ['track-removed']
  });
});

test('logical range selection keeps endpoints and bounded exclusions', () => {
  const selection = new LogicalSelection('context-2');
  selection.selectRange('track-100', 'track-900000');
  selection.setSelected('track-500', false);

  assert.equal(selection.isSelected('track-500', { inRange: true }), false);
  assert.equal(selection.isSelected('track-600', { inRange: true }), true);
  assert.equal(selection.isSelected('track-outside'), false);
  assert.deepEqual(selection.toDescriptor(), {
    mode: 'range',
    contextToken: 'context-2',
    startUid: 'track-100',
    endUid: 'track-900000',
    exclusions: ['track-500'],
    inclusions: []
  });
});

test('logical range selection keeps bounded inclusions outside the range', () => {
  const selection = new LogicalSelection('context-range-inclusions');
  selection.selectRange('track-10', 'track-20', { startOrdinal: 10, endOrdinal: 20 });
  selection.setSelected('track-30', true, { ordinal: 30 });
  selection.setSelected('track-15', false, { ordinal: 15 });

  assert.equal(selection.isSelected('track-30', { ordinal: 30 }), true);
  assert.equal(selection.isSelected('track-15', { ordinal: 15 }), false);
  assert.deepEqual(selection.getProjection({ totalCount: 100 }), {
    hasAny: true,
    selectedCount: 11
  });
  assert.deepEqual(selection.toDescriptor(), {
    mode: 'range',
    contextToken: 'context-range-inclusions',
    startUid: 'track-10',
    endUid: 'track-20',
    exclusions: ['track-15'],
    inclusions: ['track-30']
  });
});

test('logical selection projection reports all-selected counts without materializing rows', () => {
  const selection = new LogicalSelection('context-projection');
  selection.selectAll();
  selection.setSelected('track-1', false);
  selection.setSelected('track-2', false);

  assert.deepEqual(selection.getProjection({ totalCount: 2 }), {
    hasAny: false,
    selectedCount: 0
  });
  assert.deepEqual(selection.getProjection({ totalCount: 1_000_000 }), {
    hasAny: true,
    selectedCount: 999_998
  });
});

test('logical explicit selection rejects sparse payloads above the shared limit', () => {
  const selection = new LogicalSelection('context-3');
  for (let index = 0; index < 4096; index += 1) {
    selection.setSelected(`track-${index}`, true);
  }
  assert.equal(selection.toDescriptor().trackUids.length, 4096);
  assert.throws(
    () => selection.setSelected('track-over-limit', true),
    error => error?.code === 'selectionTooLarge'
  );
  assert.equal(selection.toDescriptor().trackUids.length, 4096);
});

test('logical explicit selection follows visible ordinals instead of click order', () => {
  const selection = new LogicalSelection('context-visible-order');
  selection.setSelected('track-30', true, { ordinal: 30 });
  selection.setSelected('track-10', true, { ordinal: 10 });
  selection.setSelected('track-20', true, { ordinal: 20 });

  assert.deepEqual(selection.toDescriptor().trackUids, [
    'track-10',
    'track-20',
    'track-30'
  ]);
  assert.equal(selection.getSelectedOrdinal('track-20', 20), 1);
});

test('logical selection converts absolute positions to selection-relative ordinals', () => {
  const all = new LogicalSelection('context-all-relative');
  all.selectAll();
  all.setSelected('track-2', false, { ordinal: 2 });
  all.setSelected('track-7', false, { ordinal: 7 });
  assert.equal(all.getSelectedOrdinal('track-9', 9), 7);

  const range = new LogicalSelection('context-range-relative');
  range.selectRange('track-10', 'track-20', { startOrdinal: 10, endOrdinal: 20 });
  range.setSelected('track-12', false, { ordinal: 12 });
  range.setSelected('track-5', true, { ordinal: 5 });
  assert.equal(range.getSelectedOrdinal('track-15', 15), 5);

  const occurrences = new LogicalSelection('context-playlist-occurrences');
  occurrences.setSelected('item-key-30', true, { ordinal: 30 });
  occurrences.setSelected('item-key-10', true, { ordinal: 10 });
  assert.equal(occurrences.getSelectedOrdinal('item-key-30', 30), 1);
});

test('logical selection can clear a query-bound selection', () => {
  const selection = new LogicalSelection('context-4');
  selection.selectAll();
  selection.setSelected('track-a', false);
  selection.clear();

  assert.deepEqual(selection.toDescriptor(), {
    mode: 'explicit',
    contextToken: 'context-4',
    trackUids: []
  });
});
