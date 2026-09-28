import { VisualizerRenderer } from './visualizer-renderer.js';

const FEED_FRAME_NAME = 'effetune-visualizer-feed';

// Draws the Visualizer into the Electron clean-feed window. The main process
// places that window on the chosen display and decides when it is shown.
export class VisualizerFeed {
    constructor(view) {
        this.view = view;
        this.visible = false;
        this.frameRequest = null;
        this.window = window.open('about:blank', FEED_FRAME_NAME);
        if (!this.window) return;
        const doc = this.window.document;
        doc.title = 'EffeTune Visualizer';
        doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden'; // theme-allow: Letterbox black of a video feed.
        this.canvas = doc.createElement('canvas');
        this.canvas.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)';
        doc.body.appendChild(this.canvas);
        this.renderer = new VisualizerRenderer(this.canvas);
    }

    get closed() { return !this.window || this.window.closed; }

    setVisible(visible) {
        this.visible = visible === true && !this.closed;
        if (this.visible && !this.frameRequest) this.frameRequest = this.window.requestAnimationFrame(time => this.frame(time));
    }

    frame(milliseconds) {
        this.frameRequest = null;
        if (!this.visible || this.closed) return;
        const { layout, sources } = this.view, feed = this.window;
        const [aw, ah] = layout.aspect.split(':').map(Number);
        const width = Math.min(feed.innerWidth, feed.innerHeight * aw / ah), height = width * ah / aw;
        this.canvas.style.width = `${Math.max(1, width)}px`; this.canvas.style.height = `${Math.max(1, height)}px`;
        const dpr = Math.min(feed.devicePixelRatio || 1, this.renderer.quality >= 3 ? 1 : 2);
        const cw = Math.max(1, Math.round(width * dpr)), ch = Math.max(1, Math.round(height * dpr));
        if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
        if (sources.getStatus() === 'ready') {
            this.renderer.draw(layout, sources, this.view.metadata(), milliseconds / 1000, { quality: this.view.quality });
        } else {
            this.canvas.getContext('2d').clearRect(0, 0, cw, ch);
        }
        this.frameRequest = feed.requestAnimationFrame(time => this.frame(time));
    }

    dispose() {
        this.visible = false;
        if (this.frameRequest && !this.closed) this.window.cancelAnimationFrame(this.frameRequest);
        this.frameRequest = null;
        this.renderer?.dispose();
        if (!this.closed) this.window.close();
    }
}
