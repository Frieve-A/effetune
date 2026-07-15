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
    exclusions: ['track-500']
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
