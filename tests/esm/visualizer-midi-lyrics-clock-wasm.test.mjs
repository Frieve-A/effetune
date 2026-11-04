import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMusicXml } from '../../js/midi/musicxml-parser.js';
import { parseWrd } from '../../js/midi/wrd-parser.js';
import { EventManager } from '../../js/audio/event-manager.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { createItem } from '../../js/visualizer/visualizer-model.js';
import { lyricsForItem, lyricsFrame } from '../../js/visualizer/visualizer-lyrics.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { compileAcceptanceInstrument } from '../helpers/sfz-native-acceptance.mjs';

test('Lyrics follow completed native MIDI samples across Sync, speed, seek, pause and song changes',
    { timeout: 30000 }, async () => {
        const asset = await compileAcceptanceInstrument('<region> sample=tone.wav key=60 loop_mode=loop_continuous');
        asset.operationRevision = 1;
        const h = await createNativeSamplerWorklet();
        const previous = { window: globalThis.window, document: globalThis.document };
        globalThis.window = {};
        globalThis.document = createFakeDocument();
        let sources;
        try {
            await h.initialize('SoundFontPlayerPlugin', asset);
            const { owner, state } = createNativeMidiPlaybackOwner(h);
            const notes = ['Hel', 'lo', 'Later', 'line', 'Next', 'line', 'Final', 'line']
                .map((text, index) => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>` +
                    `<lyric number="1"><syllabic>${index === 0 ? 'begin' : 'single'}</syllabic><text>${text}</text>` +
                    `${index % 2 ? '<end-line/>' : ''}</lyric></note>`).join('');
            const score = parseMusicXml('<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name>' +
                '</score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes>' +
                '<direction><sound tempo="120"/></direction>' + notes + '</measure></part></score-partwise>');
            owner.midiTimeline = score;
            Object.assign(state, { currentTrack: {}, isPlaying: true, isPaused: false });
            Object.assign(h.context, { baseLatency: .02 });
            Object.assign(h.manager, { contextManager: { audioContext: h.context }, dspPipelineLatencySamples: 480,
                _appliedOutputDelayFrames: new Map([[h.node, 0]]), eventManager: new EventManager(h.manager) });
            owner.postMidiTransport(true, 0);
            const advanceTo = async position => {
                await h.waitFor(() => owner.getCurrentMidiTime() >= position);
                const receipt = h.messages.findLast(message => message.type === 'midiPosition');
                assert.equal(receipt.generation, owner.midiGeneration);
                assert.equal(owner.getCurrentMidiTime(), receipt.position);
            };
            await advanceTo(.3);
            // Enter after playback has advanced; the view reads the production owner,
            // never a hand-written presentation snapshot or AudioContext extrapolation.
            sources = new VisualizerSources(h.manager, () => owner.getMidiPresentation());
            const view = Object.assign(Object.create(VisualizerView.prototype), { hasLyrics: true, sources,
                uiManager: { audioManager: h.manager, audioPlayer: { ui: { container: {} },
                    stateManager: { getStateSnapshot: () => state } } } });
            const item = createItem('lyrics', 'words');
            const current = () => {
                const lyrics = view.lyrics();
                const frame = lyricsFrame(item, lyricsForItem(item, lyrics), false);
                return { lyrics, frame, text: frame.rows[frame.current]?.text };
            };
            const first = current();
            assert.equal(first.text, 'Hello');
            assert.ok(first.frame.fill > 0 && first.frame.fill < 3, 'first syllable advances after late entry');
            assert.ok(Math.abs(first.lyrics.time - (owner.getCurrentMidiTime() - .03)) < 1e-9,
                'pipeline and device latency are compensated once');
            const id = h.processor.wasmInstances.get(7).id;
            const clock = h.binding.instanceMidiClock(id).frame;
            h.advanceContextWithoutProcessing(4800000);
            assert.equal(h.binding.instanceMidiClock(id).frame, clock);
            assert.equal(current().frame.key, first.frame.key, 'context jumps cannot advance words without processing');
            h.render(); await Promise.resolve();
            assert.equal(h.binding.instanceMidiClock(id).frame, clock + 128);
            await advanceTo(.7);
            assert.ok(current().frame.fill > 3, 'the second syllable advances from later native receipts');

            for (const enabled of [true, false]) {
                assert.equal(await h.manager.setVisualSyncEnabled(enabled), true);
                assert.equal(h.processor.visualSyncEnabled, enabled);
                await advanceTo(enabled ? 1.2 : 2.2);
                assert.equal(current().text, enabled ? 'Later line' : 'Next line');
            }
            state.playbackSpeed = 2;
            owner.setMidiPlaybackSpeed();
            await advanceTo(2.7);
            assert.ok(current().frame.fill > 4, 'word timing follows speed-adjusted completed samples');
            assert.ok(Math.abs(current().lyrics.time - (owner.getCurrentMidiTime() - .06)) < 1e-9);

            const settle = async promise => {
                let done = false;
                promise.finally(() => { done = true; }).catch(() => {});
                await h.waitFor(() => done);
                return promise;
            };
            await settle(owner.seekMidi(.25));
            await advanceTo(.35);
            assert.equal(current().text, 'Hello', 'backward seek reconstructs the current line');
            await settle(owner.pauseMidi());
            const paused = current();
            const pausedClock = h.binding.instanceMidiClock(id).frame;
            for (let block = 0; block < 40; block++) { h.render(); await Promise.resolve(); }
            assert.equal(current().frame.key, paused.frame.key);
            assert.equal(h.binding.instanceMidiClock(id).frame, pausedClock, 'paused native song clock holds');

            owner.midiTimeline = { ...score, lyrics: parseWrd('@WAIT(1,0);\nNew song;\n@WAIT(1,48);\n@TCLS()@LOCATE(1,1);\nSecond page;', score) };
            owner.activeSourceGeneration++;
            Object.assign(state, { currentTrack: {}, isPlaying: true, isPaused: false, playbackSpeed: 1 });
            owner.postMidiTransport(true, 0);
            await advanceTo(.2);
            assert.equal(current().frame.screen, true);
            assert.equal(current().text, 'New song');
            await advanceTo(.7);
            assert.equal(current().text, 'Second page', 'new WRD pages keep following native processing');
            owner.midiTimeline = { ...score, lyrics: undefined };
            owner.activeSourceGeneration++;
            owner.postMidiTransport(true, 0);
            await advanceTo(.2);
            assert.equal(view.lyrics(), null, 'a lyric-free song cannot retain the preceding screen');
            assert.equal(h.errors.length, 0, h.errors.join('; '));
        } finally {
            sources?.dispose();
            await h.close();
            globalThis.window = previous.window;
            globalThis.document = previous.document;
        }
    });
