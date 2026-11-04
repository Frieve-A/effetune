// Lyrics use the song's seconds clock; they never create a second transport.
const dataCache = new WeakMap();

export function quarterToSeconds(timeline, quarter) {
    const map = timeline.tempoMap;
    let low = 0, high = map.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (map[middle].quarter <= quarter) low = middle + 1; else high = middle;
    }
    const tempo = map[Math.max(0, low - 1)];
    return tempo.seconds + (quarter - tempo.quarter) * tempo.microsecondsPerQuarter / 1000000;
}

/** Convert score syllables into the existing Lyrics line/word display contract. */
export function getMidiLyricsData(timeline, { part = '', verse = '' } = {}) {
    const lyrics = timeline?.lyrics;
    if (!lyrics?.cues?.length) return null;
    let selections = dataCache.get(lyrics);
    if (!selections) dataCache.set(lyrics, selections = new Map());
    const key = JSON.stringify([part, verse]);
    if (selections.has(key)) return selections.get(key);
    let cues = lyrics.cues;
    if (lyrics.source !== 'wrd') {
        part ||= cues[0].part;
        cues = cues.filter(cue => cue.part === part);
        verse ||= cues[0]?.verse;
        cues = cues.filter(cue => cue.verse === verse);
    }
    const lines = [];
    const midiText = lyrics.source === 'midi' || lyrics.source === 'kar';
    let paragraph = 0;
    if (lyrics.source === 'wrd') {
        for (const cue of cues) lines.push({ time: cue.seconds, text: cue.text });
    } else {
        let line = null, previous = null;
        const finish = () => { if (line) lines.push(line); line = null; previous = null; };
        for (const cue of cues) {
            if (!cue.text && cue.extend) {
                if (cue.endLine || cue.endParagraph) finish();
                continue;
            }
            if (line && (cue.breakBefore || cue.seconds - (previous?.endSeconds ?? cue.seconds) > 1 || line.text.length >= 80)) finish();
            if (midiText) {
                const clear = () => {
                    finish();
                    lines.push({ time: cue.seconds, text: '', paragraph: ++paragraph });
                };
                let text = cue.text;
                if (lyrics.source === 'kar' && (text.startsWith('/') || text.startsWith('\\'))) {
                    if (text[0] === '\\') clear(); else finish();
                    text = text.slice(1);
                }
                // MIDI CR starts a line; LF starts a paragraph. CRLF is one line break.
                for (const piece of text.split(/(\r\n|\r|\n)/)) {
                    if (piece === '\n') clear();
                    else if (piece === '\r' || piece === '\r\n') finish();
                    else if (piece) {
                        line ??= { time: cue.seconds, text: '', words: [], paragraph };
                        line.text += piece; line.words.push({ time: cue.seconds, text: piece });
                    }
                }
            } else if (cue.text) {
                line ??= { time: cue.seconds, text: '', words: [] };
                const cjkBoundary = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(line.text) ||
                    /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(cue.text);
                const join = line.text && !cjkBoundary && !['begin', 'middle'].includes(previous?.syllabic) ? ' ' : '';
                const word = join + cue.text;
                line.text += word; line.words.push({ time: cue.seconds, text: word });
            }
            previous = cue;
            if (cue.endLine || cue.endParagraph) finish();
        }
        finish();
        if (lines.length && timeline.duration > lines.at(-1).time) lines.push({ time: timeline.duration, text: '',
            ...(midiText ? { paragraph } : {}) });
    }
    const data = lines.length ? { synced: true, screen: lyrics.source === 'wrd', lines } : null;
    if (data && midiText && paragraph) {
        // Keep paragraph bounds outside the render loop, including timed empty clears.
        data.paragraphs = [];
        for (let index = 0; index < lines.length; index++) {
            const number = lines[index].paragraph;
            data.paragraphs[number] ??= { start: index, end: index };
            data.paragraphs[number].end = index;
        }
    }
    selections.set(key, data);
    return data;
}
