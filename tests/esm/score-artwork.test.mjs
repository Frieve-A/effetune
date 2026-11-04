import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readScoreArtwork } from '../../js/ui/audio-player/score-artwork-source.js';
import { attachArtworkFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import { isTrackCoverRelativePath, selectCueCoverFileName } from '../../js/library/metadata/cue-cover.js';
import { WebArtworkExtractor } from '../../js/library/artwork/web-artwork-extractor.js';
import { WebSessionFileSource } from '../../js/library/scan/web-session-file-source.js';
import ingress from '../../electron/local-playback-ingress.cjs';

test('score artwork names and external claims stay limited to sibling JPEG images', () => {
    for (const extension of ['mid', 'midi', 'kar', 'musicxml', 'xml', 'mxl']) {
        const source = `Album/song.${extension}`;
        assert.equal(selectCueCoverFileName(['folder.jpg', 'COVER.JPG', 'song.png'], source), 'COVER.JPG');
        assert.equal(isTrackCoverRelativePath(null, source, 'Album/FOLDER.JPG'), true);
        for (const cover of ['Other/cover.jpg', 'Album/../cover.jpg', 'Album/front.jpg', 'Album/cover.png']) {
            assert.equal(isTrackCoverRelativePath(null, source, cover), false);
        }
    }
    assert.equal(isTrackCoverRelativePath(null, 'song.mp3', 'cover.jpg'), false);
});

test('score player prioritizes the selected sibling image and preserves existing or library artwork', async () => {
    const file = new File(['score'], 'song.mid');
    const cover = new File([new Uint8Array([1, 2])], 'COVER.JPG');
    const folder = new File([new Uint8Array([3])], 'folder.jpg');
    attachArtworkFiles([file], [folder, cover]);
    assert.deepEqual((await readScoreArtwork({ file })).data, new Uint8Array([1, 2]));
    assert.equal(await readScoreArtwork({ file, meta: { picture: {} } }), null);
    assert.equal(await readScoreArtwork({ file, meta: { artworkUrl: 'blob:existing' } }), null);
    assert.equal(await readScoreArtwork({ file, libraryTrackId: 'library-track' }), null);
    attachArtworkFiles([file], [folder]);
    assert.deepEqual((await readScoreArtwork({ file })).data, new Uint8Array([3]));
});

test('score library Web artwork uses only its permitted session directory without parsing audio tags', async () => {
    const session = new WebSessionFileSource({ entries: [
        { relativePath: 'Album/song.kar', file: new File(['score'], 'song.kar') },
        { relativePath: 'Other/cover.jpg', file: new File(['wrong'], 'cover.jpg') },
        { relativePath: 'Album/FOLDER.JPG', file: new File(['image'], 'FOLDER.JPG', { lastModified: 123 }) }
    ] });
    const extractor = new WebArtworkExtractor({ filesystem: session.createAdapter(),
        parse() { throw new Error('Score must not enter the audio tag parser'); },
        createBitmap: async () => ({ width: 1, height: 1, close() {} }) });
    const resolved = await extractor.resolveSource({ source: { canonicalSourceIdentity: 'Album/song.kar' }, maxRawBytes: 1024 });
    assert.equal(resolved.canonicalSourceIdentity, 'Album/FOLDER.JPG');
    assert.equal(resolved.externalArtworkStat.size, 5);
    extractor.discard({ claim: resolved });
});

test('native score artwork reads actual sibling files in priority order and rejects oversized images', async t => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'score-artwork-')));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
    const source = path.join(root, 'song.mid');
    await writeFile(source, 'score');
    await writeFile(path.join(root, 'folder.jpg'), 'folder');
    await writeFile(path.join(root, 'COVER.JPG'), 'cover');
    assert.equal(Buffer.from((await ingress.readScoreCover(source)).data).toString(), 'cover');
    await rm(path.join(root, 'COVER.JPG'));
    assert.equal(Buffer.from((await ingress.readScoreCover(source)).data).toString(), 'folder');
    const handle = await open(path.join(root, 'folder.jpg'), 'r+');
    try { await handle.truncate(20 * 1024 * 1024 + 1); } finally { await handle.close(); }
    assert.equal(await ingress.readScoreCover(source), null);
});
