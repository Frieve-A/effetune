// Keeps the latest media report from the embedded Browser page. Reports
// arrive only while the page plays through capture; null means none. A report
// without artworkUrl keeps the previous image.
export class BrowserMediaInfo {
    constructor(api) {
        this.report = null;
        this.unsubscribe = api?.onMedia?.(info => {
            if (info && !('artworkUrl' in info)) info = { ...info, artworkUrl: this.report?.info.artworkUrl ?? '' };
            this.report = info ? { info, receivedAt: performance.now() } : null;
        }) ?? null;
    }

    // Returns the report with its position advanced to `now` while playing.
    current(now = performance.now()) {
        if (!this.report) return null;
        const { info, receivedAt } = this.report;
        if (!info.playing || !Number.isFinite(info.position)) return info;
        let position = info.position + (now - receivedAt) / 1000 * (info.rate || 0);
        if (Number.isFinite(info.duration) && position > info.duration) position = info.duration;
        return { ...info, position: position < 0 ? 0 : position };
    }

    dispose() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.report = null;
    }
}
