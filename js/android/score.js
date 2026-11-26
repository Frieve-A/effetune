import { isScoreFile, parseScoreAsync, SCORE_MAX_BYTES } from '../midi/score-file.js';
import { MIDI_SYSTEM_RESET, MIDI_DRUM_MODE, midiTransportPoints, validateMidiSchedule } from '../midi/smf-scheduler.js';
import { readMidiWrdBytes } from '../ui/audio-player/midi-wrd-source.js';
import { readScoreArtwork } from '../ui/audio-player/score-artwork-source.js';
import { MidiFileOutput } from '../midi/midi-file-output.js';
import { recognizeMidiSystemReset } from '../midi/system-reset.js';

export function scoreName(track) {
    return [track.file?.name, track.fileName, track.sourceFileName, track.name, track.path, track.uri,
        track.url, track.mediaSource, track.meta?.fileName].find(name => typeof name === 'string' && isScoreFile(name));
}

export async function readAndroidScore(track, uri, context) {
    const name = scoreName(track);
    const size = track.file?.size ?? track.byteLength;
    if (size > SCORE_MAX_BYTES) throw Object.assign(new RangeError('Score exceeds size limit'), {
        code: /\.(xml|mxl|musicxml)$/i.test(name) ? 'musicxml-too-large' : 'midi-too-large'
    });
    let bytes;
    if (uri.startsWith('content:')) bytes = await context.documents.read(uri, { maximumBytes: SCORE_MAX_BYTES });
    else {
        const response = await fetch(uri, { headers: track.headers });
        if (!response.ok) throw new Error('Score download failed');
        const reader = response.body.getReader(), chunks = [];
        let length = 0;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > SCORE_MAX_BYTES) {
                await reader.cancel();
                throw Object.assign(new RangeError('Score exceeds size limit'), {
                    code: /\.(xml|mxl|musicxml)(?:[?#]|$)/i.test(name) ? 'musicxml-too-large' : 'midi-too-large' });
            }
            chunks.push(value);
        }
        bytes = await new Blob(chunks).arrayBuffer();
    }
    let wrdBytes;
    try { wrdBytes = await readMidiWrdBytes(track, context.audioPlayer); }
    catch (error) { console.debug('MIDI lyrics unavailable:', error); }
    const timeline = await parseScoreAsync(bytes, { fileName: name, wrdBytes, languageHints: context.getMetadataRepairHints?.() });
    validateMidiSchedule(timeline, context.audioManager.getNativeSampleRate());
    try { timeline.picture = await readScoreArtwork(track); }
    catch (error) { console.debug('Score artwork unavailable:', error); }
    return timeline;
}

// The queue stores a small reference. Only the selected song's scheduler data is resident in the Service.
export function packAndroidScore(timeline) {
    const points = midiTransportPoints(timeline);
    let outputBytes = 0;
    for (const event of timeline.events) if (event.status) outputBytes += (event.status & 0xe0) === 0xc0 ? 14 : 15;
    for (const event of timeline.sysex ?? []) outputBytes += 12 + event.data.length;
    const data = new DataView(new ArrayBuffer(16 + 20 * timeline.events.length + 40 * points.length + outputBytes));
    let offset = 0;
    const uint = value => { data.setUint32(offset, value, true); offset += 4; };
    const double = value => { data.setFloat64(offset, value, true); offset += 8; };
    uint(timeline.events.length); uint(points.length); double(timeline.duration);
    for (const [index, event] of timeline.events.entries()) {
        double(event.seconds);
        uint(event.status | event.data1 << 8 | (event.data2 || 0) << 16);
        uint(event.systemReset || ((event.status & 0xf0) === 0x90 && event.data2 ? index + 1 : 0));
        uint(event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : 0);
    }
    for (const point of points) {
        double(point.seconds); double(point.ppq); double(point.barStartPpq); double(point.bpm);
        uint(point.numerator); uint(point.denominator);
    }
    // Record the same ordered wire messages as desktop, including raw SysEx. The Service
    // timestamps them against the shared scheduler while the page is backgrounded.
    const output = { send(bytes, milliseconds) {
        double(milliseconds / 1000);
        uint(bytes.length | (recognizeMidiSystemReset(bytes) ? 0x80000000 : 0));
        new Uint8Array(data.buffer, offset, bytes.length).set(bytes);
        offset += bytes.length;
    } };
    const mirror = new MidiFileOutput({ getOutput: () => output, getClockOffset: () => 0, now: () => 0 });
    mirror.start(timeline, { position: 0, speed: 1, anchorTime: 0, generation: 1 });
    mirror.pump(1, true);
    return data.buffer;
}
