import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { createItem, createDefaultLayout, validateLayout, encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';
import { lyricsForItem, lyricsFrame } from '../../js/visualizer/visualizer-lyrics.js';

const score = () => ({ duration: 12, lyrics: { source: 'musicxml', parts: [{ id: 'Voice', name: 'Lead vocal' }], cues: [
    { seconds: 1, endSeconds: 2, part: 'Voice', verse: '1', text: 'First', endLine: true },
    { seconds: 5, endSeconds: 6, part: 'Voice', verse: '1', text: 'Later', endLine: true },
    { seconds: 1, endSeconds: 2, part: 'Voice', verse: '2', text: 'Second verse', endLine: true },
    { seconds: 1, endSeconds: 2, part: 'Choir', verse: '1', text: 'Choir', endLine: true }
] } });

test('MIDI Lyrics use the current processed presentation on late entry, pause, speed changes, seek and song changes', () => {
    let presentation = { timeline: score(), position: 5.4, speed: 2 };
    const state = { currentTrack: {}, isPlaying: true, isStopped: false, playbackSpeed: 2,
        currentTrackPosition: 9, currentTrackDuration: 12 };
    const fallback = { synced: true, lines: [{ time: 0, text: 'External' }] };
    const view = Object.assign(Object.create(VisualizerView.prototype), { hasLyrics: true,
        sources: { getMidiPresentation: () => presentation },
        uiManager: { audioPlayer: { ui: { container: {} }, stateManager: { getStateSnapshot: () => state },
            contextManager: { getCurrentPlaybackTime: () => 10 }, trackLyrics: { get: () => fallback } },
        audioManager: { getAudiblePlaybackPosition() { throw new Error('MIDI presentation must not be compensated twice'); } } } });
    const item = createItem('lyrics', 'words');
    const current = () => {
        const source = lyricsForItem(item, view.lyrics());
        const frame = lyricsFrame(item, source, false);
        return frame.rows[frame.current]?.text;
    };
    assert.equal(current(), 'Later', 'opening the visualizer mid-song reads the current frame');
    const initialData = view.lyrics().data;
    state.isPlaying = false;
    state.playbackSpeed = .5;
    assert.equal(current(), 'Later', 'paused presentation holds despite player/UI time');
    assert.equal(view.lyrics().data, initialData, 'data identity stays stable between frames');
    presentation.position = 1.5;
    assert.equal(current(), 'First', 'backward seek uses the new processed position');
    presentation.position = .5;
    assert.equal(current(), undefined, 'seek before the first cue clears the current line');
    presentation = { timeline: { duration: 12 }, position: 2 };
    assert.equal(current(), 'External', 'a MIDI without cue data retains external lyrics');
    view.uiManager.audioPlayer.trackLyrics.get = () => null;
    assert.equal(view.lyrics(), null, 'the previous song never leaks into a lyric-free song');
    presentation = null;
    state.currentTrack = null;
    assert.equal(view.lyrics(), null);
});

test('MusicXML part/verse controls preserve layouts and select independent item data', () => {
    const timeline = score();
    const item = createItem('lyrics', 'words'), fields = [];
    const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
        view: { sources: { getMidiPresentation: () => ({ timeline }) } }, t: (_key, fallback) => fallback,
        field(_parent, label, _kind, value, change, options) { fields.push({ label, value, change, options }); }, changed() {}
    });
    editor.parameters({}, item);
    assert.deepEqual(fields.find(field => field.label === 'Part').options.values,
        [['', 'Automatic'], ['Voice', 'Lead vocal'], ['Choir', 'Choir']]);
    assert.deepEqual(fields.find(field => field.label === 'Verse').options.values,
        [['', 'Automatic'], ['1', '1'], ['2', '2']]);
    fields.find(field => field.label === 'Verse').change('2');
    const source = { midiTimeline: timeline, time: 1.5, duration: 12 };
    assert.equal(lyricsForItem(item, source).data.lines[0].text, 'Second verse');
    fields.find(field => field.label === 'Part').change('Choir');
    assert.equal(item.params.lyricsVerse, '', 'changing parts resets the verse to its automatic choice');
    assert.equal(lyricsForItem(item, source).data.lines[0].text, 'Choir');
    const layout = { ...createDefaultLayout(), items: [item] };
    assert.equal(decodeLayoutShare(encodeLayoutShare(layout)).items[0].params.lyricsPart, 'Choir');
    delete item.params.lyricsPart; delete item.params.lyricsVerse;
    assert.equal(validateLayout(layout), true, 'existing Lyrics layouts migrate without losing compatibility');
});

test('WRD frames display only the current complete text screen and reconstruct after a backward seek', () => {
    const timeline = { duration: 8, lyrics: { source: 'wrd', cues: [
        { seconds: 1, text: 'First\nSecond' }, { seconds: 3, text: '' }, { seconds: 5, text: 'Last' }
    ] } };
    const item = createItem('lyrics', 'words');
    const frame = time => lyricsFrame(item, lyricsForItem(item, { midiTimeline: timeline, time, duration: 8 }), false);
    assert.equal(frame(1.5).screen, true);
    assert.equal(frame(1.5).rows[frame(1.5).current].text, 'First\nSecond');
    assert.equal(frame(3.5).rows[frame(3.5).current].text, '');
    assert.equal(frame(5.5).rows[frame(5.5).current].text, 'Last');
    assert.equal(frame(2).rows[frame(2).current].text, 'First\nSecond');
});
