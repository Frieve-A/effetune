import assert from 'node:assert/strict';
import test from 'node:test';
import { attachLyricsFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import { readMidiWrdBytes } from '../../js/ui/audio-player/midi-wrd-source.js';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { WebLibraryServiceCoordinator } from '../../js/library/operations/web-library-service-coordinator.js';
import { WebCatalogScanRuntime } from '../../js/library/scan/web-scan-runtime.js';
import { withGlobals, createConsoleHarness } from '../helpers/global-test-utils.mjs';

const midi = Uint8Array.from([
    77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    77, 84, 114, 107, 0, 0, 0, 12,
    0, 0x90, 60, 100, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0
]);

test('Web MIDI companions resolve the matching WRD without opening unrelated lyrics', async () => {
    const file = new File([midi], 'Song.mid'), lyrics = new File(['@START\nHello'], 'SONG.WRD');
    attachLyricsFiles([file], [new File(['wrong'], 'Other.wrd'), new File(['LRC'], 'Song.lrc'), lyrics]);
    await withGlobals({ window: {} }, async () => {
        assert.equal(new TextDecoder().decode(await readMidiWrdBytes({ file }, {})), '@START\nHello');
        assert.equal(await readMidiWrdBytes({ file: new File([midi], 'Other.mid') }, {}), null);
        assert.equal(await readMidiWrdBytes({ file: new File([], 'Song.musicxml') }, {}), null);
    });
});

test('MIDI library WRD requests use the existing permitted sibling resolver', async () => {
    const requests = [], lyrics = new File(['@START\nLibrary'], 'Song.wrd');
    await withGlobals({ window: {} }, async () => {
        const bytes = await readMidiWrdBytes({ file: new File([midi], 'Song.mid'), libraryTrackId: 'uid' }, {
            libraryOperationService: { resolveTrackSiblingFile: async request => { requests.push(request); return { file: lyrics }; } }
        });
        assert.equal(new TextDecoder().decode(bytes), '@START\nLibrary');
        assert.deepEqual(requests, [{ trackUid: 'uid', names: ['Song'], extension: 'wrd' }]);
    });
});

test('Web library WRD selection is limited to the MIDI basename in an already permitted directory', async () => {
    const track = { folderId: 'folder', relativePath: 'Album/Song.mid' };
    const file = new File(['Lyrics'], 'SONG.WRD');
    const requests = [];
    const runtime = {
        sessionSources: new Map(),
        handleStore: { get: async () => ({ kind: 'directory', values() {}, queryPermission: async () => 'granted' }) },
        filesystemFactory: () => ({
            listFileNames: async directory => { requests.push(directory); return ['SONG.WRD', 'Other.wrd', 'Song.lrc']; },
            getFile: async relativePath => { requests.push(relativePath); return file; }
        })
    };
    const service = {
        repository: { getTrackStorageIdentity: async () => track },
        sourceProvider: { resolveTrackSiblingFile: (...args) => WebCatalogScanRuntime.prototype.resolveTrackSiblingFile.call(runtime, ...args) }
    };
    const resolve = request => WebLibraryServiceCoordinator.prototype.resolveTrackSiblingFile.call(service, request);
    assert.equal((await resolve({ trackUid: 'uid', names: ['Other'], extension: 'wrd' })).file, file);
    assert.deepEqual(requests.splice(0), ['Album', 'Album/SONG.WRD']);
    runtime.handleStore.get = async () => ({ kind: 'directory', values() {}, queryPermission: async () => 'prompt' });
    assert.equal(await resolve({ trackUid: 'uid', names: ['Song'], extension: 'wrd' }), null);
    assert.deepEqual(requests, []);
    track.relativePath = 'Album/Song.mp3';
    assert.equal(await resolve({ trackUid: 'uid', names: ['Song'], extension: 'wrd' }), null);
    await assert.rejects(resolve({ trackUid: 'uid', names: ['Song'], extension: '../../secret' }), { code: 'invalidLyricsNames' });
});

test('MIDI preparation attaches WRD lyrics, and bad selected lyrics leave the MIDI playable with a useful notice', async () => {
    const notices = [];
    await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } },
        console: createConsoleHarness({ debug() {}, warn() {} }) }, async () => {
        const file = new File([midi], 'Song.mid');
        const owner = Object.assign({}, midiPlaybackMethods, {
            audioPlayer: { audioContext: { sampleRate: 48000 } }, loadTrackData: () => file.arrayBuffer()
        });
        attachLyricsFiles([file], [new File(['@START;\nHello'], 'Song.wrd')]);
        const timeline = await owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false);
        assert.equal(timeline.lyrics.source, 'wrd');
        assert.ok(timeline.lyrics.cues.some(cue => cue.text.includes('Hello')));
        attachLyricsFiles([file], [{ name: 'Song.wrd', size: 2, arrayBuffer: async () => { throw new Error('Unavailable'); } }]);
        const fallback = await owner.prepareMidiTrack({ file }, { byteLength: file.size }, () => false);
        assert.ok(fallback.events.some(event => event.status === 0x90));
        assert.equal(notices.at(-1)[0], 'midi.error.lyricsUnavailable');
    });
});
