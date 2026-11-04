import { isMidiFile, parseSmf, parseSmfAsync, SMF_MAX_BYTES } from './smf-parser.js';
import { parseMusicXmlFile } from './musicxml-parser.js';
import { parseWrd } from './wrd-parser.js';

export const SCORE_MAX_BYTES = SMF_MAX_BYTES;
export const SCORE_EXTENSIONS = Object.freeze(['mid', 'midi', 'kar', 'musicxml', 'xml', 'mxl']);

export function isMusicXmlFile(value) {
    const name = typeof value === 'string' ? value : value?.name ?? value?.fileName ?? value?.path ?? '';
    const path = /^[a-z][a-z\d+.-]*:\/\//i.test(name) ? name.split(/[?#]/, 1)[0] : name;
    return /\.(?:musicxml|xml|mxl)$/i.test(path) || /\.(?:musicxml|xml|mxl)$/i.test(path.split(/[?#]/, 1)[0]);
}

export function isScoreFile(value) { return isMidiFile(value) || isMusicXmlFile(value); }

export async function parseScoreData(input, options = {}) {
    const { wrdBytes, ...scoreOptions } = options;
    const result = isMusicXmlFile(options.fileName) ? await parseMusicXmlFile(input, scoreOptions) : parseSmf(input, scoreOptions);
    if (wrdBytes != null && !isMusicXmlFile(options.fileName)) {
        try {
            const lyrics = parseWrd(wrdBytes, result);
            if (lyrics.cues.some(cue => cue.text)) result.lyrics = lyrics;
        }
        catch (error) { console.warn('Unable to read WRD lyrics:', error); result.lyricsWarning = 'wrd-unreadable'; }
    }
    return result;
}

export async function parseScoreAsync(input, { signal, ...options } = {}) {
    if (!isMusicXmlFile(options.fileName) && options.wrdBytes == null) return parseSmfAsync(input, { signal, ...options });
    signal?.throwIfAborted();
    const buffer = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    const type = isMusicXmlFile(options.fileName) ? 'musicxml' : 'midi';
    if (buffer.byteLength > SCORE_MAX_BYTES) {
        throw Object.assign(new Error('This score file is too large to open.'), { code: `${type}-too-large` });
    }
    if (typeof Worker === 'undefined') return parseScoreData(buffer, { signal, ...options });
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./score-worker.js', import.meta.url), { type: 'module' });
        const finish = (error, result) => {
            signal?.removeEventListener('abort', abort);
            worker.terminate();
            if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(signal.reason ?? new DOMException('Canceled', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => data.error
            ? finish(Object.assign(new Error(data.error.message), { code: data.error.code })) : finish(null, data.result);
        worker.onerror = () => finish(Object.assign(new Error('This score file could not be read.'), { code: `${type}-corrupt` }));
        worker.postMessage({ buffer, options }, [buffer]);
    });
}
