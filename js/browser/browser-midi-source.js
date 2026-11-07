import { recognizeMidiSystemReset, recognizeMidiDrumMode } from '../midi/system-reset.js';
import { musicPlayerOwnsMidi } from '../midi/live-input.js';

const SOURCE_KEY = 'browser';
const PENDING_CAPACITY = 4096;

// Feeds MIDI sent by the embedded Browser page to the app's live MIDI input.
// The page owns the live input from its first event until its page lifetime
// ends, claiming it again with its next event if another source replaced it;
// replacing the input session releases its sounding notes. A shown
// Music Player owns live input, as in MidiLiveInput: it ends the page's claim,
// and the page claims again with its next event after the player detaches.
export class BrowserMidiSource {
    constructor(audioManager, api) {
        this.audioManager = audioManager;
        this.pending = [];
        this.timer = null;
        this.claimed = false;
        this.previousSource = null;
        this.unsubscribe = api?.onMidi?.(message => this.receive(message)) ?? null;
        const power = audioManager?.powerPolicyController;
        this.unsubscribePower = power?.subscribe(() => { if (musicPlayerOwnsMidi(power)) this.release(); }) ?? null;
    }

    receive(message) {
        if (message?.reset) { this.release(); return; }
        const events = Array.isArray(message?.events) ? message.events : [];
        if (!events.length) return;
        // Ownership follows the live input itself: an automatic source change
        // (player detach restore, device reconnect) or a device selection may
        // have replaced the claim, so the active page claims again.
        if (!this.claimed || this.audioManager.getLiveMidiInputSource() !== SOURCE_KEY) {
            this.release();
            this.previousSource = this.audioManager.getLiveMidiInputSource();
            this.audioManager.setLiveMidiInputSource(SOURCE_KEY);
            // The claim fails while the Music Player is attached; retry with the next event.
            this.claimed = this.audioManager.getLiveMidiInputSource() === SOURCE_KEY;
            if (!this.claimed) return;
        }
        const now = performance.now();
        for (const { data, delay } of events) {
            if (this.pending.length >= PENDING_CAPACITY) {
                console.error('Browser MIDI exceeded the bounded scheduling queue');
                break;
            }
            const event = { data, timeStamp: now + delay };
            // Keep time order; equal times stay in arrival order.
            let index = this.pending.length;
            while (index > 0 && this.pending[index - 1].timeStamp > event.timeStamp) index--;
            this.pending.splice(index, 0, event);
        }
        this.schedule();
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = null;
        const now = performance.now();
        let count = 0;
        while (count < this.pending.length && this.pending[count].timeStamp <= now) count++;
        for (const event of this.pending.splice(0, count)) this.enqueue(event);
        if (this.pending.length) this.timer = setTimeout(() => this.schedule(), this.pending[0].timeStamp - now);
    }

    enqueue({ data, timeStamp }) {
        const systemReset = recognizeMidiSystemReset(data);
        const drumMode = recognizeMidiDrumMode(data);
        if (systemReset || drumMode) {
            this.audioManager.enqueueLiveMidiInput({ data: new Uint8Array([0, drumMode?.channel ?? 0, drumMode?.mode ?? 0]),
                ...(systemReset ? { systemReset } : { drumMode }), timeStamp, sourceKey: SOURCE_KEY });
        } else if (data[0] < 0xf0) {
            this.audioManager.enqueueLiveMidiInput({ data: new Uint8Array(data), timeStamp, sourceKey: SOURCE_KEY });
        }
    }

    release() {
        clearTimeout(this.timer);
        this.timer = null;
        this.pending.length = 0;
        if (!this.claimed) return;
        this.claimed = false;
        // Another source may already have taken over. While the Music Player is
        // attached, restoring ends the session; the hardware input returns on detach.
        if (this.audioManager.getLiveMidiInputSource() === SOURCE_KEY)
            this.audioManager.setLiveMidiInputSource(this.previousSource);
    }

    dispose() {
        this.unsubscribe?.();
        this.unsubscribePower?.();
        this.unsubscribe = this.unsubscribePower = null;
        this.release();
    }
}
