// A selection-only view of the host library. Audio and file operations stay on the host.
export function createRemoteIrLibrary(session, selectEntry) {
    return {
        readOnly: true,
        async list({ query = '', sort = 'filename' } = {}) {
            const { items = [] } = await session.request({ op: 'listIRs', includePairs: true }, 'irs');
            const entries = items.map(item => ({
                irId: item.id,
                fileLabel: item.name,
                channels: item.channels,
                sampleRate: item.sampleRate,
                frames: item.frames,
                topology: item.topology,
                importedAt: item.importedAt
            })).filter(entry => entry.fileLabel.toLowerCase().includes(query.toLowerCase()));
            return entries.sort(sort === 'recent'
                ? (a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || ''))
                : (a, b) => a.fileLabel.localeCompare(b.fileLabel));
        },
        selectEntry
    };
}
