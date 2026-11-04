const lyricsFilesByAudioFile = new WeakMap();

export function attachLyricsFiles(audioFiles, lrcFiles) {
    if (!lrcFiles.length) return;
    for (const file of audioFiles) lyricsFilesByAudioFile.set(file, lrcFiles);
}

export function getLyricsFiles(file) {
    return lyricsFilesByAudioFile.get(file) ?? [];
}

const artworkFilesByAudioFile = new WeakMap();

export function attachArtworkFiles(audioFiles, artworkFiles) {
    if (!artworkFiles.length) return;
    for (const file of audioFiles) artworkFilesByAudioFile.set(file, artworkFiles);
}

export function getArtworkFiles(file) {
    return artworkFilesByAudioFile.get(file) ?? [];
}
