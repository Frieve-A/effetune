/**
 * Space key guard.
 *
 * Browsers scroll the page when Space is pressed and the focused element does
 * not consume the key. EffeTune never navigates with that scroll, and hosts
 * embedding this UI (for example the VST wrapper, which forwards unused keys to
 * the DAW) need Space to stay free for their own transport shortcuts. The guard
 * therefore cancels the browser default everywhere except where Space still has
 * a real meaning: typing into a text field and activating a focused control.
 *
 * Only the native default is cancelled. Application keydown handlers still run,
 * so any in-app Space behavior keeps working.
 */

// Native controls whose Space default is typing or activation, not scrolling.
const SPACE_ACTIVATABLE_TAGS = new Set(['button', 'select', 'summary', 'textarea', 'option']);
// Input types that ignore Space, so cancelling their default loses nothing.
const SPACE_INERT_INPUT_TYPES = new Set(['range', 'hidden']);

function getTagName(target) {
    return String(target?.tagName || '').toLowerCase();
}

function getInputType(target) {
    return String(target?.type || target?.getAttribute?.('type') || 'text').toLowerCase();
}

/**
 * Check whether a keydown event is a plain Space press.
 * Modified presses (Ctrl/Alt/Meta) and IME composition are left untouched.
 * @param {KeyboardEvent} event - Keydown event to inspect
 * @returns {boolean} True when the event is an unmodified Space press
 */
export function isPlainSpaceKeyEvent(event) {
    if (!event) return false;
    if (event.isComposing === true || event.keyCode === 229) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return event.key === ' ' || event.key === 'Spacebar';
}

/**
 * Check whether the event target needs the browser's Space default.
 * @param {EventTarget} target - Event target of the keydown event
 * @returns {boolean} True when Space types text or activates the control
 */
export function needsSpaceDefault(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tagName = getTagName(target);
    if (tagName === 'input') {
        return !SPACE_INERT_INPUT_TYPES.has(getInputType(target));
    }
    return SPACE_ACTIVATABLE_TAGS.has(tagName);
}

/**
 * Cancel the browser's Space default when the target does not need it.
 * @param {KeyboardEvent} event - Keydown event to handle
 * @returns {boolean} True when the default was cancelled
 */
export function handleSpaceKeyDown(event) {
    if (!isPlainSpaceKeyEvent(event)) return false;
    if (needsSpaceDefault(event.target)) return false;
    event.preventDefault?.();
    return true;
}

/**
 * Install the guard on a document.
 * The listener runs in the capture phase so a handler that stops propagation
 * cannot leave the scroll default in place.
 * @param {Document} documentRef - Document to attach the listener to
 * @returns {() => void} Function that removes the listener
 */
export function installSpaceKeyGuard(documentRef = globalThis.document) {
    if (typeof documentRef?.addEventListener !== 'function') {
        return () => {};
    }
    const handler = event => {
        handleSpaceKeyDown(event);
    };
    documentRef.addEventListener('keydown', handler, true);
    return () => {
        documentRef.removeEventListener?.('keydown', handler, true);
    };
}
