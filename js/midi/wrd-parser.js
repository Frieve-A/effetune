import { quarterToSeconds } from './lyrics-timeline.js';

export const WRD_MAX_BYTES = 1024 * 1024;
const MAX_OPERATIONS = 100000, MAX_SCREEN_TEXT = 8 * 1024 * 1024;
const ESCAPE = String.fromCharCode(27);
const ansiSequence = new RegExp(`${ESCAPE}\\[[\\d;]*[A-Za-z]`, 'g');
let doubleByteCharacters;
export function wrdCharacterWidth(character) {
    if (!doubleByteCharacters) {
        // Unicode ranges alone miss Shift-JIS double-byte symbols such as ★.
        const bytes = [];
        for (let lead = 0x81; lead <= 0xfc; lead++) {
            if (lead > 0x9f && lead < 0xe0) continue;
            for (let trail = 0x40; trail <= 0xfc; trail++) {
                if (trail !== 0x7f) bytes.push(lead, trail, 0);
            }
        }
        doubleByteCharacters = new Set(new TextDecoder('shift_jis').decode(Uint8Array.from(bytes)).split('\0'));
        doubleByteCharacters.delete('\ufffd');
    }
    return doubleByteCharacters.has(character) || (character.codePointAt(0) >= 0x2e80 &&
        !(character >= '｡' && character <= 'ﾟ')) ? 2 : 1;
}
function fail() {
    throw Object.assign(new Error('This lyrics file is too large or damaged to read.'), { code: 'wrd-corrupt' });
}

function decode(input) {
    if (typeof input === 'string') { if (input.length > WRD_MAX_BYTES) fail(); return input; }
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength > WRD_MAX_BYTES) fail();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch {
        try { return new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
        catch { fail(); }
    }
}

/** Read MIMPI text/timing commands. Graphics, MIDI output and executable commands are inert. */
export function parseWrd(input, timeline) {
    const source = decode(input).replace(/^\ufeff/, '').split('\x1a', 1)[0];
    // WRD WAIT/REST steps are 1/48 of a quarter, independent of SMF division.
    const signatures = timeline.timeSignatures;
    const bars = [0];
    let signatureIndex = 0;
    const ensureBar = index => {
        if (!Number.isSafeInteger(index) || index < 0 || index > 100000) fail();
        while (bars.length <= index + 1) {
            const start = bars.at(-1);
            while (signatureIndex + 1 < signatures.length && signatures[signatureIndex + 1].quarter <= start + 1e-8) signatureIndex++;
            const signature = signatures[signatureIndex];
            bars.push(start + signature.numerator * 4 / signature.denominator);
        }
    };
    ensureBar(0);
    let quarter = 0, barIndex = 0, offset = 0, step = bars[1], charMode = false;
    const operations = [];
    const locateBar = () => {
        ensureBar(barIndex);
        while (quarter >= bars[barIndex + 1] - 1e-8) { ensureBar(++barIndex); }
        while (quarter < bars[barIndex] && barIndex > 0) barIndex--;
    };
    const advance = () => { quarter += step; if (!Number.isFinite(quarter) || quarter > 10000000) fail(); locateBar(); };
    const push = (type, value) => {
        if (operations.length >= MAX_OPERATIONS) fail();
        // MIMPI executes commands in source order, even when WAIT names an
        // earlier position. Reordering writes changes the shared text cursor.
        operations.push({ quarter: Math.max(quarter, operations.at(-1)?.quarter ?? 0), type, value });
    };
    const numeric = value => {
        const result = Number(value || 0);
        if (!Number.isFinite(result) || Math.abs(result) > 10000000) fail();
        return result;
    };
    for (const line of source.split(/\r\n|\n|\r/)) {
        if (line.startsWith('@') || line.startsWith('^')) {
            let cursor = 0, suppressStep = false;
            // Consume every token at its current position, never rescan malformed tails.
            const tokens = /\s*([@^])([a-z]+)(?:\(([^)@^]*)\)|[ \t]*([^@^;]*))?/igy;
            while (cursor < line.length) {
                if (line[cursor] === ';') { suppressStep = true; break; }
                tokens.lastIndex = cursor;
                const match = tokens.exec(line);
                if (!match) break;
                cursor = tokens.lastIndex;
                const name = match[2].toUpperCase(), argument = match[3] ?? match[4] ?? '';
                if (name === 'REM') continue;
                if (match[1] === '^') continue;
                const values = argument.split(/[,;]/).map(value => value.trim());
                if (name === 'WAIT' || name === 'REST') {
                    locateBar();
                    const target = name === 'WAIT' ? numeric(values[0]) + offset - 1 : barIndex + numeric(values[0]);
                    ensureBar(target);
                    barIndex = target;
                    quarter = bars[target] + Math.max(0, Math.min(numeric(values[1]) / 48, bars[target + 1] - bars[target]));
                    locateBar();
                } else if (name === 'OFFSET') offset = numeric(values[0]);
                else if (name === 'WMODE') {
                    const rate = numeric(values[0]);
                    if (rate < 0 || rate >= 256) fail();
                    step = rate === 0 ? bars[barIndex + 1] - bars[barIndex] : (rate + 1) / 24;
                    if (values.length > 1) charMode = numeric(values[1]) !== 0;
                } else if (['LOCATE', 'TCLS', 'TON', 'ESC'].includes(name)) push(name, argument);
                else if (name === 'END') {
                    const lastTempo = timeline.tempoMap.at(-1);
                    quarter = lastTempo.quarter + (timeline.duration - lastTempo.seconds) * 1000000 / lastTempo.microsecondsPerQuarter;
                    locateBar();
                }
            }
            if (!suppressStep) advance();
            continue;
        }
        const continued = line.endsWith(';'), value = continued ? line.slice(0, -1) : line;
        if (!charMode) push('text', value);
        else {
            const characters = Array.from(value);
            for (let index = 0; index < characters.length; index++) {
                let character = characters[index];
                if (character === '\\' && index + 1 < characters.length) character = characters[++index];
                else if (character === '|') {
                    character = '';
                    while (++index < characters.length && characters[index] !== '|') character += characters[index];
                } else if (character === '_') character = '';
                if (character) push('text', character);
                advance();
            }
        }
        if (!continued) { push('newline'); advance(); }
    }
    const rows = Array.from({ length: 25 }, () => Array(80).fill(' '));
    let x = 0, y = 0, visible = true, totalText = 0;
    const cues = [];
    const newline = () => {
        x = 0; y++;
        if (y === 25) { rows.shift(); rows.push(Array(80).fill(' ')); y = 24; }
    };
    const clear = (left = 0, top = 0, right = 79, bottom = 24, fill = ' ') => {
        for (let row = Math.max(0, top); row <= Math.min(24, bottom); row++) {
            for (let column = Math.max(0, left); column <= Math.min(79, right); column++) rows[row][column] = fill;
        }
    };
    const escape = value => {
        const command = /^([\d;]*)([A-Za-z])$/.exec(value.replace(ESCAPE, '').replace(/^\[/, ''));
        if (!command) return;
        const parameters = command[1].split(';').map(Number), count = parameters[0] || 1;
        if (command[2] === 'J') {
            if (parameters[0] === 2) clear();
            else if (parameters[0] === 1) { clear(0, 0, 79, y - 1); clear(0, y, x, y); }
            else { clear(x, y, 79, y); clear(0, y + 1, 79, 24); }
        } else if (command[2] === 'K') clear(parameters[0] === 0 ? x : 0, y, parameters[0] === 1 ? x : 79, y);
        else if (command[2] === 'H' || command[2] === 'f') { y = Math.max(0, Math.min(24, count - 1)); x = Math.max(0, Math.min(79, (parameters[1] || 1) - 1)); }
        else if (command[2] === 'A') y = Math.max(0, y - count);
        else if (command[2] === 'B') y = Math.min(24, y + count);
        else if (command[2] === 'C') x = Math.min(79, x + count);
        else if (command[2] === 'D') x = Math.max(0, x - count);
    };
    for (const operation of operations) {
        const seconds = quarterToSeconds(timeline, operation.quarter);
        if (seconds > timeline.duration) continue;
        const values = operation.value?.split(/[,;]/).map(value => Number(value.trim()));
        if (operation.type === 'LOCATE') {
            const reverse = operation.value.includes(';');
            x = Math.max(0, Math.min(79, (values[reverse ? 1 : 0] || 1) - 1));
            y = Math.max(0, Math.min(24, (values[reverse ? 0 : 1] || 1) - 1));
            continue;
        }
        if (operation.type === 'TCLS') clear((values[0] || 1) - 1, (values[1] || 1) - 1,
            (values[2] || 80) - 1, (values[3] || 25) - 1, values[5] ? String.fromCharCode(values[5]) : ' ');
        else if (operation.type === 'TON') visible = values[0] !== 0;
        else if (operation.type === 'ESC') escape(operation.value);
        else if (operation.type === 'newline') newline();
        else if (operation.type === 'text') {
            // Control bytes never reach the canvas or trigger external behavior.
            for (const character of operation.value.replace(ansiSequence, '')) {
                const code = character.codePointAt(0);
                if (code < 32 || code === 127) continue;
                const width = wrdCharacterWidth(character);
                if (x + width > 80) newline();
                rows[y][x++] = character;
                if (width === 2) rows[y][x++] = '';
            }
        }
        const text = visible ? rows.map(row => row.join('').trimEnd()).join('\n').trimEnd() : '';
        if (cues.at(-1)?.seconds === seconds) { totalText -= cues.at(-1).text.length; cues.pop(); }
        totalText += text.length;
        if (totalText > MAX_SCREEN_TEXT) fail();
        cues.push({ seconds, text, part: '', verse: '' });
    }
    for (let index = 0; index < cues.length; index++) cues[index].endSeconds = cues[index + 1]?.seconds ?? timeline.duration;
    if (cues.length && cues.at(-1).seconds < timeline.duration) cues.push({ seconds: timeline.duration, endSeconds: timeline.duration, text: '', part: '', verse: '' });
    return { source: 'wrd', cues };
}
