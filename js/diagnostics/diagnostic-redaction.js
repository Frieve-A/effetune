// Keep stack locations within known app assets, including a trailing line and column.
function assetLocation(value, origin) {
    const normalized = value.replaceAll('\\', '/');
    const position = normalized.match(/:\d+(?::\d+)?$/)?.[0] || '';
    const location = (position ? normalized.slice(0, -position.length) : normalized).split(/[?#]/, 1)[0];
    let path;
    if (/^(?:file:|[a-z]:\/|\/)/i.test(location) && location.includes('/app.asar/')) {
        path = location.split('/app.asar/').pop();
    } else if (/^https?:/i.test(location) && origin) {
        try {
            const url = new URL(location);
            const base = new URL('.', origin);
            if (url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
                path = url.pathname.slice(base.pathname.length);
            }
        } catch { /* Unknown URL shape. */ }
    }
    return /^(?:effetune\.html|(?:js|plugins|features|electron)\/[\w./-]+\.(?:m?js|cjs|html|wasm))$/.test(path)
        ? path + position : null;
}

const LOCATION_START = /(\b(?:https?|file|ftp|wss?):\/\/|\b(?:blob|data|content):)|\b[a-z]:[\\/]|\\\\[^\\\s"']+\\|(?<![\w/:])\/(?=[\w.-]+\/)/gi;
function locationEnd(text, match, isUrl) {
    const before = text[match.index - 1];
    const closing = { '(': ')', '[': ']', '"': '"', "'": "'", '<': '>' }[before];
    let end = match.index + match[0].length;
    // Filesystem names can contain spaces, apostrophes and apparent file
    // extensions in the middle of a component. Redact through the end of the
    // line when prose cannot be distinguished from the path. URLs end at whitespace.
    while (end < text.length && !(isUrl ? /[\s"<>]/ : /[\r\n]/).test(text[end])) end++;
    if (closing) {
        const line = text.slice(match.index, end);
        const delimiter = line.lastIndexOf(closing);
        if (delimiter >= 0 && /^[\s)\]},;.!]*$/.test(line.slice(delimiter + 1))) {
            return match.index + delimiter;
        }
    }
    return end;
}

const SIMPLE_RULES = [
    [/(?<![\w.%+-])[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, '<email>'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
    [/(?<![\w:])(?:[\da-f]{0,4}:){2,7}[\da-f]{0,4}(?![\w:])/gi, '<ip>'],
    [/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b|\b[\da-f]{16,}\b/gi, '<id>']
];

function replaceRanges(text, ranges) {
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    let result = '';
    let end = 0;
    for (const range of ranges) {
        if (range.start >= end) {
            result += text.slice(end, range.start) + range.replacement;
        }
        end = Math.max(end, range.end);
    }
    return result + text.slice(end);
}

export function redactDiagnosticText(text, dictionary = [], origin = globalThis.location?.href) {
    if (typeof text !== 'string' || !text) return text;
    const ranges = [];
    for (const [word, replacement] of dictionary) {
        if (!word) continue;
        let start = text.indexOf(word);
        while (start !== -1) {
            const end = start + word.length;
            const quote = text[start - 1];
            if (word.length >= 3 || text === word || ((quote === '"' || quote === "'") && text[end] === quote)) {
                ranges.push({ start, end, replacement });
            }
            start = text.indexOf(word, end);
        }
    }
    const locations = new RegExp(LOCATION_START);
    let location;
    while ((location = locations.exec(text))) {
        const isUrl = Boolean(location[1]);
        const end = locationEnd(text, location, isUrl);
        const value = text.slice(location.index, end);
        ranges.push({ start: location.index, end, replacement: assetLocation(value, origin) || (isUrl ? '<url>' : '<path>') });
        locations.lastIndex = end;
    }
    for (const [pattern, replacement] of SIMPLE_RULES) {
        for (const match of text.matchAll(pattern)) {
            ranges.push({ start: match.index, end: match.index + match[0].length, replacement });
        }
    }
    return ranges.length ? replaceRanges(text, ranges) : text;
}

// A name may already have passed the main-process rules or a JSON-string boundary.
export function addDiagnosticWord(dictionary, word, type, origin) {
    if (typeof word !== 'string' || !word.trim() || (type === 'id' && ['default', 'none'].includes(word))) return;
    for (const form of [word, JSON.stringify(word).slice(1, -1)]) {
        dictionary.set(form, `<${type}>`);
        const redacted = redactDiagnosticText(form, [], origin);
        if (redacted !== form && !/^<\w+>$/.test(redacted)) dictionary.set(redacted, `<${type}>`);
    }
}
