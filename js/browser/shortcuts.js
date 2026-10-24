export function browserShortcut({ key, control = false, meta = false, alt = false, shift = false, isComposing = false }, page = false) {
    if (isComposing) return null;
    key = String(key).toLowerCase();
    if (!control && !meta && !shift) {
        if (alt) return { arrowleft: 'back', arrowright: 'forward', home: 'home' }[key] || null;
        return { f5: 'reload', f6: 'address', escape: 'stop' }[key] || null;
    }
    if (page && !alt && !shift && control !== meta) {
        if (meta && key === '[') return 'back';
        if (meta && key === ']') return 'forward';
        return { l: 'address', r: 'reload', d: 'bookmarks' }[key] || null;
    }
    return null;
}
