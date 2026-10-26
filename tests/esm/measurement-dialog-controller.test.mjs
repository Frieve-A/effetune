import assert from 'node:assert/strict';
import test from 'node:test';
import DialogController from '../../features/measurement/ui/dialog-controller.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function harness() {
  let focused;
  const elements = new Map(['confirmationDialog', 'confirmationMessage', 'confirmationCheckbox',
    'doNotWarnAgain', 'cancelBtn', 'notificationDialog', 'notificationMessage', 'notificationOkBtn'].map(id =>
    [id, { style: {}, checked: true, textContent: '', focus() { focused = id; } }]));
  const manager = { pendingAction: null, pendingDeleteId: null, pendingDeleteType: null };
  return { elements, manager, controller: new DialogController(manager), focused: () => focused,
    document: { getElementById: id => elements.get(id) } };
}

test('Escape cancels a measurement confirmation without executing the pending action', async () => {
  const h = harness();
  let executed = 0, prevented = 0, stopped = 0;
  h.manager.pendingAction = () => { executed += 1; };
  h.manager.pendingDeleteId = 'measurement-1';
  h.manager.pendingDeleteType = 'measurement';
  await withGlobals({ document: h.document }, () => {
    h.controller.showConfirmation('<b>Discard changes?</b>', false);
    assert.equal(h.elements.get('confirmationMessage').textContent, '<b>Discard changes?</b>');
    assert.equal(h.elements.get('confirmationCheckbox').style.display, 'none');
    assert.equal(h.elements.get('doNotWarnAgain').checked, false);
    assert.equal(h.focused(), 'cancelBtn');
    const dialog = h.elements.get('confirmationDialog');
    dialog.onkeydown({ key: 'Enter' });
    assert.equal(dialog.style.display, 'flex');
    dialog.onkeydown({ key: 'Escape', preventDefault() { prevented += 1; }, stopPropagation() { stopped += 1; } });
    assert.equal(dialog.style.display, 'none');
    assert.equal(executed, 0);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    assert.deepEqual(h.manager, { pendingAction: null, pendingDeleteId: null, pendingDeleteType: null });
  });
});

test('measurement notifications display literal text, focus OK, and close on Escape', async () => {
  const h = harness();
  await withGlobals({ document: h.document }, () => {
    h.controller.showNotification('<img src=x>');
    assert.equal(h.elements.get('notificationMessage').textContent, '<img src=x>');
    assert.equal(h.focused(), 'notificationOkBtn');
    const dialog = h.elements.get('notificationDialog');
    dialog.onkeydown({ key: 'Enter' });
    assert.equal(dialog.style.display, 'flex');
    let prevented = 0, stopped = 0;
    dialog.onkeydown({ key: 'Escape', preventDefault() { prevented += 1; }, stopPropagation() { stopped += 1; } });
    assert.equal(dialog.style.display, 'none');
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
  });
});
