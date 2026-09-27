const HISTORY_LIMIT = 100;

// The background image is held by reference so multi-megabyte data URIs are not copied into every entry.
export function layoutSnapshot(layout) {
    return {
        json: JSON.stringify({ ...layout, background: { ...layout.background, image: null } }),
        image: layout.background.image
    };
}

export function snapshotLayout(snapshot) {
    const layout = JSON.parse(snapshot.json);
    layout.background.image = snapshot.image;
    return layout;
}

export class VisualizerHistory {
    constructor() { this.entries = []; this.index = -1; }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.entries.length - 1; }
    record(snapshot) {
        const current = this.entries[this.index];
        if (current && current.json === snapshot.json && current.image === snapshot.image) return;
        this.entries.length = this.index + 1;
        this.entries.push(snapshot);
        if (this.entries.length > HISTORY_LIMIT) this.entries.shift();
        this.index = this.entries.length - 1;
    }
    undo() { return this.canUndo ? this.entries[--this.index] : null; }
    redo() { return this.canRedo ? this.entries[++this.index] : null; }
}
