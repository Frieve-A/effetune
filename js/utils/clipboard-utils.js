/**
 * Clipboard helpers that work across EffeTune's environments.
 *
 * Electron file:// pages use the native clipboard exposed by the preload
 * bridge. Browser builds try a synchronous copy command before the async
 * Clipboard API because permission-denied async writes can consume the user
 * activation that the synchronous copy path needs.
 */

function copyTextWithSelection(text) {
    if (typeof document === 'undefined') {
        return false;
    }

    let textarea = null;
    const activeElement = document.activeElement;
    const selection = document.getSelection ? document.getSelection() : null;
    const ranges = [];

    try {
        if (!document.body || typeof document.execCommand !== 'function') {
            return false;
        }

        if (selection) {
            for (let i = 0; i < selection.rangeCount; i++) {
                ranges.push(selection.getRangeAt(i).cloneRange());
            }
        }

        textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '-9999px';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
            textarea.focus({ preventScroll: true });
        } catch (err) {
            textarea.focus();
        }
        textarea.select();
        return document.execCommand('copy');
    } catch (err) {
        return false;
    } finally {
        if (textarea && textarea.parentNode) {
            textarea.parentNode.removeChild(textarea);
        }

        if (selection) {
            try {
                selection.removeAllRanges();
                ranges.forEach(range => selection.addRange(range));
            } catch (err) {
                // Best-effort restoration only; copying can still fall back.
            }
        }

        if (activeElement && typeof activeElement.focus === 'function') {
            try {
                activeElement.focus({ preventScroll: true });
            } catch (err) {
                try {
                    activeElement.focus();
                } catch (focusErr) {
                    // Best-effort restoration only; copying can still fall back.
                }
            }
        }
    }
}

/**
 * Copy text to the clipboard.
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} Whether the copy succeeded
 */
export async function copyTextToClipboard(text) {
    try {
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null;
        if (electronAPI && typeof electronAPI.writeClipboardText === 'function') {
            if (await electronAPI.writeClipboardText(text)) {
                return true;
            }
        }
    } catch (err) {
        // Fall through to browser clipboard paths.
    }

    if (copyTextWithSelection(text)) {
        return true;
    }

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (err) {
        console.error('[clipboard] copy failed:', err);
    }
    return false;
}

/**
 * Read text from the clipboard.
 *
 * In Electron, navigator.clipboard.readText is denied on file:// pages, so we
 * prefer Electron's native clipboard exposed via the preload bridge. The web
 * Clipboard API is used as a fallback for the browser build.
 * @returns {Promise<string>} The clipboard text, or '' if it could not be read
 */
export async function readTextFromClipboard() {
    try {
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null;
        if (electronAPI && typeof electronAPI.readClipboardText === 'function') {
            const text = await electronAPI.readClipboardText();
            if (typeof text === 'string') return text;
        }
    } catch (err) {
        // Fall through to the web Clipboard API.
    }

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        }
    } catch (err) {
        console.error('[clipboard] read failed:', err);
    }
    return '';
}
