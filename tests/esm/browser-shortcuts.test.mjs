import assert from 'node:assert/strict';
import test from 'node:test';
import { browserShortcut } from '../../js/browser/shortcuts.js';

test('browser navigation shortcuts preserve application accelerators in the toolbar', () => {
    for (const [key, action] of [['F5', 'reload'], ['F6', 'address'], ['Escape', 'stop']]) {
        assert.equal(browserShortcut({ key }), action);
    }
    for (const [key, action] of [['ArrowLeft', 'back'], ['ArrowRight', 'forward'], ['Home', 'home']]) {
        assert.equal(browserShortcut({ key, alt: true }), action);
    }
    for (const modifier of ['control', 'meta']) {
        for (const [key, action] of [['l', 'address'], ['r', 'reload'], ['d', 'bookmarks']]) {
            const input = { key, [modifier]: true };
            assert.equal(browserShortcut(input), null);
            assert.equal(browserShortcut(input, true), action);
            assert.equal(browserShortcut({ ...input, shift: true }, true), null);
            assert.equal(browserShortcut({ ...input, alt: true }, true), null);
        }
    }
    assert.equal(browserShortcut({ key: '[', meta: true }, true), 'back');
    assert.equal(browserShortcut({ key: ']', meta: true }, true), 'forward');
    assert.equal(browserShortcut({ key: 'F5', isComposing: true }), null);
    for (const key of ['Backspace', 'Delete', ' ', 'F1', 'F11']) assert.equal(browserShortcut({ key }, true), null);
});
