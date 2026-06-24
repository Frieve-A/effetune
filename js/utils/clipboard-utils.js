/**
 * Clipboard helpers that work across EffeTune's environments.
 *
 * The Electron permission handler denies the async Clipboard API on file://
 * pages (navigator.clipboard.writeText throws NotAllowedError), and non-secure
 * web contexts may not expose it either. copyTextToClipboard() tries the modern
 * API first and falls back to a hidden textarea + execCommand('copy'), which
 * needs no clipboard permission.
 */

/**
 * Copy text to the clipboard.
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} Whether the copy succeeded
 */
export async function copyTextToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (err) {
        // Permission denied / unavailable - fall through to the legacy path.
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (err) {
        console.error('[clipboard] copy failed:', err);
        return false;
    }
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
        if (window.electronAPI && typeof window.electronAPI.readClipboardText === 'function') {
            const text = await window.electronAPI.readClipboardText();
            if (typeof text === 'string') return text;
        }
    } catch (err) {
        // Fall through to the web Clipboard API.
    }

    try {
        if (navigator.clipboard && navigator.clipboard.readText) {
            return await navigator.clipboard.readText();
        }
    } catch (err) {
        console.error('[clipboard] read failed:', err);
    }
    return '';
}
