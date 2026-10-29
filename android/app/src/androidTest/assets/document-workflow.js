(async () => {
    const base = 'https://appassets.androidplatform.net/assets/web/';
    const { getAndroidBridge, base64ToBytes } = await import(base + 'js/android/bridge.js');
    const { AndroidDocuments } = await import(base + 'js/android/documents.js');
    const { AndroidDocumentFile } = await import(base + 'js/android/library-io.js');
    const { AudioEncoder } = await import(base + 'js/audio/audio-encoder.js');
    const { parseBlob } = await import(base + 'js/vendor/music-metadata-browser.mjs');
    const { UserDataBackupService } = await import(base + 'js/user-data-backup/service.js');
    const { createUserDataBackupAdapter } = await import(base + 'js/user-data-backup/adapters.js');
    const { MAX_BACKUP_BYTES } = await import(base + 'js/user-data-backup/portable.js');
    const bridge = getAndroidBridge(), documents = new AndroidDocuments(bridge);
    const check = (value, message) => { if (!value) throw new Error(message); };
    window.__workflow = {
        async libraryLyrics(root) {
            for (const [name, text] of [['second.lrc', '[00:00.00]Library second lyric'], ['First.lrc', '[00:00.00]Library cue lyric']]) {
                const record = await bridge.request('documents.create', { uri: root, name });
                await documents.write(record.uri, new Blob([text]));
            }
            const library = await window.uiManager.ensureLibraryManager();
            check(library, 'Music Library did not initialize');
            const added = await library.addFolder({ handle: { kind: 'directory', androidUri: root, name: 'Android lyrics fixture' } });
            localStorage.setItem('android-lyrics-folder', added.folder.id);
            const contextToken = await library.createContext({ endpoint: 'tracks', scope: { folderId: added.folder.id } });
            const page = await library.queryTracks({ contextToken, limit: 100 });
            const physical = page.rows.find(row => row.title === 'second');
            const cue = page.rows.find(row => row.title === 'First');
            check(physical && cue, 'Scanned music/CUE rows missing: ' + JSON.stringify(page.rows.map(row => row.title)));
            const player = window.uiManager.audioPlayer;
            const tracks = [];
            for (const row of [physical, cue]) {
                const source = await library.client.resolveSequenceEntrySource({ trackUid: row.trackUid });
                tracks.push({ ...source, libraryTrackId: row.trackUid, name: row.title,
                    meta: { title: row.title, artist: row.artist } });
            }
            await player.contextManager.replaceNativeQueue({ tracks, index: 0 });
            await window.__workflow.selectedLibraryLyrics(physical.trackUid, 'Library second lyric');
            await player.contextManager.command('select', { index: 1 });
            await window.__workflow.selectedLibraryLyrics(cue.trackUid, 'Library cue lyric');
            localStorage.setItem('android-lyrics-track', cue.trackUid);
            return { lyrics: true };
        },
        async selectedLibraryLyrics(id, text) {
            const player = window.uiManager.audioPlayer;
            const deadline = performance.now() + 10000;
            while (performance.now() < deadline) {
                const track = player.stateManager.getStateSnapshot().currentTrack;
                if (track?.libraryTrackId === id && track.file) {
                    const data = player.trackLyrics.get(track);
                    if (data?.lines?.some(line => line.text === text)) return { lyrics: true };
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Selected library lyrics unavailable: ' + JSON.stringify({ id, current: player.stateManager.getStateSnapshot().currentTrack?.libraryTrackId, data: player.trackLyrics.data }));
        },
        async restoredLibraryLyrics() {
            return window.__workflow.selectedLibraryLyrics(localStorage.getItem('android-lyrics-track'), 'Library cue lyric');
        },
        async cleanupLibraryLyrics() {
            const folderId = localStorage.getItem('android-lyrics-folder');
            if (folderId) await (await window.uiManager.ensureLibraryManager()).removeFolder({ folderId });
            localStorage.removeItem('android-lyrics-folder'); localStorage.removeItem('android-lyrics-track');
            return { done: true };
        },
        async musicSelection(root) {
            const context = new OfflineAudioContext(2, 48000, 48000);
            const encoded = await new AudioEncoder().encode(context.createBuffer(2, 48000, 48000), { format: 'wav', sampleRate: 48000, wavSampleFormat: 'pcm16' });
            for (const [name, content] of [['selection.wav', encoded.blob], ['second.wav', encoded.blob],
                ['selection.cue', new Blob(['FILE "selection.wav" WAVE\n TRACK 01 AUDIO\n TITLE "First"\n INDEX 01 00:00:00\n TRACK 02 AUDIO\n TITLE "Second"\n INDEX 01 00:00:30\n'])],
                ['selection.lrc', new Blob(['[00:00.00]Fixture lyric\n'])]]) {
                const record = await bridge.request('documents.create', { uri: root, name });
                await documents.write(record.uri, content);
            }
            const wait = async predicate => {
                const deadline = performance.now() + 10000;
                while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
                check(predicate(), 'Open Music selection did not finish: ' + JSON.stringify({
                    playback: window.audioManager.snapshot.playback,
                    selectedPlayer: window.uiManager.networkMusic?.selectedPlayerId
                }));
            };
            document.getElementById('openMusicButton').click();
            await wait(() => window.audioManager.snapshot.playback.queueLength === 2 && window.audioManager.snapshot.playback.source?.title === 'selection.wav');
            document.getElementById('openMusicButton').click();
            await wait(() => window.audioManager.snapshot.playback.queueLength === 2 && window.audioManager.snapshot.playback.source?.region);
            const { getLyricsFiles } = await import(base + 'js/ui/audio-player/lyrics-file-links.js');
            const tracks = window.uiManager.audioPlayer.contextManager.nativeTracks;
            check(tracks.length === 2 && tracks[1].startFrame > 0, 'CUE regions were not retained');
            check(getLyricsFiles(tracks[0].file).length === 1, 'Selected LRC sidecar was lost');
            await window.uiManager.audioPlayer.contextManager.command('select', { index: 0 });
            await window.uiManager.audioPlayer.contextManager.stop();
            return { lyrics: true };
        },
        async restoredLyrics() {
            const player = window.uiManager.audioPlayer;
            const deadline = performance.now() + 10000;
            while (!player.stateManager.getStateSnapshot().currentTrack?.file && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
            const track = player.stateManager.getStateSnapshot().currentTrack;
            check(track.startFrame === 0 && track.endFrame === 30 && track.durationSec === 0.4, 'Restored CUE timing changed');
            const lyrics = await player.trackLyrics.load(track);
            check(JSON.stringify(lyrics).includes('Fixture lyric'), 'Restored CUE lyrics did not resolve their granted companion');
            return { lyrics: true };
        },
        async pick() {
            const root = await documents.pick({ kind: 'tree' });
            const permission = await bridge.request('documents.permission', { uri: root.uri });
            check(permission.granted, 'Picker did not retain the real provider grant');
            return root;
        },
        async ranges(root) {
            const record = await bridge.request('documents.create', { uri: root, name: 'ranges.bin' });
            const expected = Uint8Array.from({ length: 300000 }, (_, i) => i % 251);
            await documents.write(record.uri, expected);
            const middle = await bridge.request('documents.read', { uri: record.uri, offset: 262000, length: 4096 });
            check(base64ToBytes(middle.data).every((value, index) => value === expected[262000 + index]), 'URI range mismatch');
            const mediaUrl = 'https://appassets.androidplatform.net/media?uri=' + encodeURIComponent(record.uri);
            const response = await fetch(mediaUrl, { headers: { Range: 'bytes=262000-266095' } }).catch(error => {
                throw new Error(`Granted media fetch failed at ${location.href} (${document.baseURI}): ${error}`);
            });
            check(response.status === 206 && response.headers.get('Content-Range') === 'bytes 262000-266095/300000', 'Media range metadata mismatch');
            check(new Uint8Array(await response.arrayBuffer()).every((value, index) => value === expected[262000 + index]), 'Media range bytes mismatch');
            const nested = await bridge.request('documents.create', { uri: root, name: 'samples', mimeType: 'vnd.android.document/directory' });
            const sample = await bridge.request('documents.create', { uri: nested.uri, name: 'sample.wav' });
            await documents.write(sample.uri, new Uint8Array([1, 2, 3]));
            const resolved = await bridge.request('documents.resolve', { treeUri: root, relativePath: 'samples/sample.wav' });
            check(resolved.uri === sample.uri, 'Relative sample reference changed');
            const first = await bridge.request('documents.list', { uri: root, limit: 1 });
            const second = await bridge.request('documents.list', { uri: root, limit: 1, offset: first.nextOffset });
            check(first.entries.length === 1 && second.entries.length === 1 && first.entries[0].uri !== second.entries[0].uri, 'Provider pagination mismatch');
            return { uri: record.uri, sample: sample.uri };
        },
        async exportFormat(root, format, quality, cancel = false) {
            const context = new OfflineAudioContext(2, 4800, 48000);
            const input = context.createBuffer(2, 4800, 48000);
            for (let channel = 0; channel < 2; channel++) {
                const data = input.getChannelData(channel);
                for (let i = 0; i < data.length; i++) data[i] = 0.25 * Math.sin(2 * Math.PI * 1000 * i / 48000);
            }
            const encoded = await new AudioEncoder().encode(input, { format: 'wav', sampleRate: 48000, wavSampleFormat: 'pcm16' });
            const inputRecord = await bridge.request('documents.create', { uri: root, name: `input-${format}-${quality}.wav`, mimeType: 'audio/wav' });
            await documents.write(inputRecord.uri, encoded.blob);
            const source = new AndroidDocumentFile(await bridge.request('documents.stat', { uri: inputRecord.uri }));
            const second = new File([encoded.blob], `second-${format}-${quality}.wav`, { type: 'audio/wav' });
            const manager = window.audioManager, processor = window.pipelineManager.fileProcessor;
            const previous = manager.pipeline;
            const volume = window.pluginManager.createPlugin('Volume', { audioHostActive: false }); volume.setParameters({ vl: -6 });
            manager.pipeline = [volume]; processor.isCancelled = false;
            const writes = [], settings = { format, sampleRate: 48000, wavSampleFormat: quality, flacSampleFormat: quality };
            try {
                await processor._processFilesToDirectory([source, second], async (name, blob) => {
                    const record = await bridge.request('documents.create', { uri: root, name: (cancel ? 'cancel-' : '') + name,
                        mimeType: format === 'wav' ? 'audio/wav' : 'audio/flac' });
                    await documents.write(record.uri, blob);
                    const file = new AndroidDocumentFile(await bridge.request('documents.stat', { uri: record.uri }));
                    const bytes = await file.arrayBuffer(), view = new DataView(bytes);
                    const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, 4));
                    check(magic === (format === 'wav' ? 'RIFF' : 'fLaC'), 'Export container mismatch');
                    if (format === 'wav') check(view.getUint16(34, true) === (quality === 'pcm16' ? 16 : quality === 'pcm24' ? 24 : 32), 'WAV sample format mismatch');
                    const metadata = await parseBlob(new Blob([bytes], { type: blob.type }), { duration: true });
                    check(metadata.format.bitsPerSample === (quality === 'pcm16' ? 16 : quality === 'pcm24' ? 24 : 32), 'Export bit depth mismatch');
                    const decoded = await context.decodeAudioData(bytes.slice(0));
                    let peak = 0; for (const sample of decoded.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
                    check(decoded.numberOfChannels === 2 && decoded.sampleRate === 48000 && decoded.length === 4800, 'Export audio metadata mismatch');
                    check(Math.abs(peak - 0.25 * Math.pow(10, -6 / 20)) < 0.001, 'Offline DSP gain mismatch');
                    writes.push(record.uri);
                    if (cancel) processor.isCancelled = true;
                }, settings);
                check(writes.length === (cancel ? 1 : 2), 'Batch export failed or cancellation wrote another file');
                return { format, quality, writes: writes.length, progress: processor.progressBar.style.width };
            } finally { manager.pipeline = previous; processor.isCancelled = false; volume.cleanup?.(); }
        },
        async backup(root, name) {
            const item = { key: `pipeline:${name}`, id: name, kind: 'pipeline', name,
                data: { plugins: [{ nm: 'Volume', en: true, vl: -6 }] } };
            const source = new UserDataBackupService({ adapter: { readSnapshot: async () => ({ items: [item], unavailable: [] }) } });
            const catalog = await source.listBackup(), backup = await source.createBackup(catalog, [item.key]);
            const record = await bridge.request('documents.create', { uri: root, name: name + '.effetune_backup' });
            await documents.write(record.uri, backup.blob);
            const target = new UserDataBackupService({ adapter: createUserDataBackupAdapter({ presetManager: window.pipelineManager.presetManager }) });
            const file = new AndroidDocumentFile(await bridge.request('documents.stat', { uri: record.uri }));
            const opened = await target.openBackup(file), plan = await target.planRestore(opened, opened.items.map(item => item.key));
            try {
                const restored = await target.restore(plan);
                check(restored.added.length === 1 && restored.failed.length === 0, 'Backup restore did not persist preset');
                check((await window.pipelineManager.presetManager.readBackupSnapshot())[name].plugins[0].vl === -6, 'Backup preset payload changed');
            } finally { await window.pipelineManager.presetManager.deletePreset(name); }
            let rejected = false;
            try { await target.openBackup({ size: MAX_BACKUP_BYTES + 1, arrayBuffer: () => { throw new Error('Oversized input was read'); } }); }
            catch (error) { rejected = !String(error).includes('Oversized input was read'); }
            check(rejected, 'Backup size limit must reject before reading');
            const temporary = await bridge.request('documents.createTemporary', { name: name + '.effetune_backup' });
            await documents.write(temporary.uri, backup.blob);
            await bridge.request('documents.share', { uri: temporary.uri, mimeType: 'application/octet-stream' });
            return { uri: record.uri, sharedUri: temporary.uri, size: backup.blob.size, name };
        },
        async video(uri) {
            const track = { uri, name: 'tone.mp4', type: 'video/mp4' };
            await window.uiManager.createAudioPlayer([], false);
            const player = window.uiManager.audioPlayer;
            await player.loadFiles([track], false);
            await player.contextManager.pause();
            await player.contextManager.seek(0.1);
            player.ui.updateVideoPresentation();
            const deadline = performance.now() + 8000;
            while ((!player.ui.video.ready || !player.ui.video.element?.videoWidth) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
            const video = player.ui.video.element;
            check(video?.videoWidth === 128 && video.videoHeight === 96, 'SAF video frames did not decode');
            check(video.muted && video.src.startsWith('https://appassets.androidplatform.net/media?uri='), 'Video must use the muted granted URI display path');
            player.ui.refreshVideoPlayback();
            await new Promise(resolve => setTimeout(resolve, 150));
            const nativePosition = window.audioManager.getAudiblePlaybackPosition(99);
            check(Math.abs(video.currentTime - nativePosition) < 0.03, 'Paused video did not follow native seek position');
            check(!player.audioElement || (player.audioElement.paused && !player.audioElement.currentSrc), 'A second browser audio source was started');
            await player.contextManager.play();
            await new Promise(resolve => setTimeout(resolve, 80));
            await player.contextManager.pause();
            const advanced = window.audioManager.snapshot.playback.position > nativePosition;
            await player.contextManager.stop();
            check(advanced, 'Native video soundtrack clock did not advance');
            return { width: video.videoWidth, height: video.videoHeight, muted: video.muted, advanced };
        }
    };
    return { ready: true };
})()
