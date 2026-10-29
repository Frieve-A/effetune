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
        this.hdrCanvas = doc.createElement('canvas');
        this.hdrCanvas.style.cssText = `${this.canvas.style.cssText};pointer-events:none`;
        this.hdrCanvas.hidden = true;
        this.hdrCanvas.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(this.hdrCanvas);
        this.renderer = new VisualizerRenderer(this.canvas, { hdrCanvas: this.hdrCanvas });
        view.createPlaybackControls(doc.body, this);
        this.canvas.addEventListener('pointerdown', event => view.beginPlaybackInteraction(event, this));
        this.canvas.addEventListener('pointerup', event => view.finishSeekPointer(event, this));
        this.canvas.addEventListener('click', event => {
            if (!view.activatePlaybackControl(event, this)) view.resetCounterAt(event, this.canvas, this.renderer);
        });
        this.canvas.addEventListener('pointermove', event => {
            view.movePlaybackPointer(event, this);
            view.moveSeekPointer(event, this);
            const control = view.playbackControlAt(event, this);
            this.playbackHoveredId = control?.id;
            this.canvas.style.cursor = control || view.seekBarAt(event, this) || view.counterAt(event, this.canvas, this.renderer) !== null ? 'pointer' : '';
        });
        this.canvas.addEventListener('pointercancel', () => { view.clearPlaybackPointer(this); view.cancelSeekPointer(this); });
        this.canvas.addEventListener('lostpointercapture', () => view.cancelSeekPointer(this));
        this.canvas.addEventListener('pointerleave', event => view.leavePlaybackPointer(event, this));
    }

    get closed() { return !this.window || this.window.closed; }

    setVisible(visible) {
        this.visible = visible === true && !this.closed;
        this.view.syncPlaybackControls(this, this.view.playback(undefined, this), this.visible);
        if (this.visible && !this.frameRequest) this.frameRequest = this.window.requestAnimationFrame(time => this.frame(time));
    }

    frame(milliseconds) {
        this.frameRequest = null;
        if (!this.visible || this.closed) return;
        const { layout, sources } = this.view, feed = this.window;
        const [aw, ah] = layout.aspect.split(':').map(Number);
        const width = Math.min(feed.innerWidth, feed.innerHeight * aw / ah), height = width * ah / aw;
        this.canvas.style.width = `${Math.max(1, width)}px`; this.canvas.style.height = `${Math.max(1, height)}px`;
        this.hdrCanvas.style.width = this.canvas.style.width; this.hdrCanvas.style.height = this.canvas.style.height;
        const dpr = Math.min(feed.devicePixelRatio || 1, this.renderer.quality >= 3 ? 1 : 2);
        const cw = Math.max(1, Math.round(width * dpr)), ch = Math.max(1, Math.round(height * dpr));
        if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
        const playback = this.view.playback(undefined, this), ready = sources.getStatus() === 'ready';
        this.view.syncPlaybackControls(this, playback, ready);
        if (ready) {
            this.renderer.draw(layout, sources, this.view.metadata(), milliseconds / 1000, { quality: this.view.quality, hdr: this.view.hdr, lyrics: this.view.lyrics(), video: this.view.videoFrame(), counters: this.view.counters(), playback });
        } else {
            this.renderer.clear();
        }
        this.frameRequest = feed.requestAnimationFrame(time => this.frame(time));
    }

    dispose() {
        this.view.cancelSeekPointer?.(this);
        this.visible = false;
        if (this.frameRequest && !this.closed) this.window.cancelAnimationFrame(this.frameRequest);
        this.frameRequest = null;
        this.renderer?.dispose();
        if (!this.closed) this.window.close();
    }
}
