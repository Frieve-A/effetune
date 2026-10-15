const lyricsFilesByAudioFile = new WeakMap();

export function attachLyricsFiles(audioFiles, lrcFiles) {
    if (!lrcFiles.length) return;
    for (const file of audioFiles) lyricsFilesByAudioFile.set(file, lrcFiles);
}

export function getLyricsFiles(file) {
    return lyricsFilesByAudioFile.get(file) ?? [];
}
