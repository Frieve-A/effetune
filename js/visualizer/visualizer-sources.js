import { TelemetryFrameType } from '../audio/telemetry-hub.js';
import { getDspRolloutConfig } from '../audio/dsp-rollout.js';
import { guitarAnalysis } from './visualizer-model.js';

const SOURCE_TYPES = Object.freeze({
    spectrum: { type: 'SpectrumAnalyzerPlugin', frameType: TelemetryFrameType.TAP_SPECTRUM,
        parse: 'parseDspSpectrumTelemetryFrame' },
    spectrogram: { type: 'SpectrogramPlugin', frameType: TelemetryFrameType.TAP_SPECTROGRAM_COL,
        parse: 'parseDspSpectrogramTelemetryFrame' },
    oscilloscope: { type: 'OscilloscopePlugin', frameType: TelemetryFrameType.TAP_SCOPE_SNAPSHOT,
        parse: 'parseDspScopeTelemetryFrame' },
    stereo: { type: 'StereoMeterPlugin', frameType: TelemetryFrameType.TAP_STEREO_FIELD,
        parse: 'parseDspStereoFieldTelemetryFrame' },
    'level-meter': { type: 'LevelMeterPlugin', frameType: TelemetryFrameType.TAP_LEVEL,
        parse: 'parseDspLevelTelemetryFrame' },
    notes: { type: 'NoteSpectrogramPlugin', frameType: 24,
        parse: 'parseTelemetryFrame' },
    guitar: { type: 'NoteSpectrogramPlugin', frameType: 24,
        parse: 'parseTelemetryFrame' },
    chroma: { type: 'ChromaSpiralPlugin', frameType: TelemetryFrameType.TAP_SPECTRUM },
    phase: { type: 'PhaseSelectEqPlugin', frameType: 20 },
    'analog-meter': { type: 'AnalogMeterPlugin', frameType: TelemetryFrameType.TAP_ANALOG_METER },
    'rhythm-analyzer': { type: 'RhythmAnalyzerPlugin', frameType: 28, parse: 'parseTelemetryFrame' }
});

const usesAudioModulation = (effects, modulator) => Array.isArray(effects) &&
    effects.some(effect => effect?.enabled !== false &&
        (effect?.mod?.source === modulator ||
            (modulator === 'bass' && effect?.type === 'particles')));

const MODULATION_RANGE_DB = 24;
const MODULATION_REFERENCE_HOLD_SECONDS = 1;
const MODULATION_REFERENCE_RELEASE_DB_PER_SECOND = 20;
const MODULATION_FLOOR_DB = { level: -60, bass: -66, mid: -66, treble: -66 };
const MODULATION_RELEASE_SECONDS = { level: 0.18, bass: 0.25, mid: 0.25, treble: 0.25 };
const MODULATION_ANALYZERS = { level: 'level-meter', bass: 'spectrum', mid: 'spectrum',
    treble: 'spectrum', beat: 'rhythm-analyzer', width: 'stereo' };
const MODULATION_BANDS = { bass: [20, 150], mid: [150, 2000], treble: [2000, 20000] };
const createModulator = () => ({ value: 0, reference: null, hold: 0, lastTime: null });

function updateModulator(state, rms, type, now) {
    const elapsed = state.lastTime === null ? 0 : Math.max(0, now - state.lastTime);
    state.lastTime = now;
    const level = rms > 0 ? 20 * Math.log10(rms) : -240;
    if (state.reference === null || level >= state.reference) {
        state.reference = level;
        state.hold = MODULATION_REFERENCE_HOLD_SECONDS;
    } else {
        const decayTime = Math.max(0, elapsed - state.hold);
        state.hold = Math.max(0, state.hold - elapsed);
        state.reference = Math.max(level,
            state.reference - MODULATION_REFERENCE_RELEASE_DB_PER_SECOND * decayTime);
    }
    const lower = Math.max(MODULATION_FLOOR_DB[type], state.reference - MODULATION_RANGE_DB);
    const normalized = Math.max(0, Math.min(1, (level - lower) / MODULATION_RANGE_DB));
    state.value = normalized >= state.value ? normalized :
        normalized + (state.value - normalized) * Math.exp(-elapsed / MODULATION_RELEASE_SECONDS[type]);
}

function analysisSettings(type, input = {}) {
    // Chroma chooses its HQ resolution in the kernel; Level Meter and Phase Map
    // have no analysis controls. Their display settings do not affect source lifetime.
    if (type === 'chroma' || type === 'level-meter' || type === 'phase') return { params: {}, gainDb: 0 };
    // The dial is calibrated in dBFS/LUFS, so no gain applies. Mode and ballistics keys
    // are always included, whatever the mode; ln also feeds the visual-sync delay rule.
    if (type === 'analog-meter') return { params: {
        md: input.md ?? 'VU', it: input.it ?? 0.3, at: input.at ?? 5, rt: input.rt ?? 1.5, ln: input.ln ?? 0,
        de: input.de ?? 'Average Rectified', nr: input.nr ?? 300, os: input.os ?? 1.25
    }, gainDb: 0 };
    // Only the BPM range affects analysis; the display settings never restart the source.
    if (type === 'rhythm-analyzer') return { params: { mn: input.mn ?? 40, mx: input.mx ?? 240 }, gainDb: 0 };
    // The fretboard's tuning, fret range, and capo decide the detected notes.
    if (type === 'guitar') return { params: guitarAnalysis(input), gainDb: 0 };
    const gainDb = type === 'notes' ? 0 :
        Number.isFinite(input.gainDb) ? Math.max(-24, Math.min(24, Math.round(input.gainDb))) : 0;
    if (type === 'spectrum' || type === 'spectrogram') {
        const hq = input.sc === 'log-hq';
        const params = { pt: input.pt ?? 12, sc: hq ? 'log-hq' : 'log', hq };
        params.dr = type === 'spectrogram' ? input.dr ?? -96 : -96;
        return { params, gainDb };
    }
    if (type === 'stereo') return { params: { wt: input.wt ?? 0.1 }, gainDb };
    if (type === 'oscilloscope') return { params: {
        dt: input.dt ?? 0.01, tm: input.tm ?? 'Auto', tl: input.tl ?? 0,
        te: input.te ?? 'Rising', ho: input.ho ?? 0.0001
    }, gainDb: 0 };
    return { params: { mn: input.mn ?? 28, mx: input.mx ?? 91 }, gainDb: 0 };
}

const sourceKey = (type, channel, params, gainDb) =>
    JSON.stringify([SOURCE_TYPES[type].type, channel, params, gainDb]);

export class VisualizerSources {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.layout = null;
        this.visible = false;
        this.active = false;
        this.nextTapId = 0xf0000000;
        this.sources = new Map();
        this.itemKeys = new Map();
        this.itemSubscribers = new Map();
        this.modulators = Object.fromEntries(Object.keys(MODULATION_ANALYZERS).map(type => [type, createModulator()]));
        this.modulatorKeys = {};
        this.hostHidden = null;
        this._onVisibilityChange = () => this._publish();
        this._onDspReady = () => { if (this.active) this._publish(true); };
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        this.audioManager.addEventListener?.('dspReady', this._onDspReady);
        this._stopHostVisibility = window.electronAPI?.onWindowVisibilityChanged?.(snapshot => {
            if (typeof snapshot?.hidden === 'boolean') {
                this.hostHidden = snapshot.hidden;
                this._publish();
            }
        });
        void window.electronAPI?.getWindowVisibility?.().then(snapshot => {
            if (typeof snapshot?.hidden === 'boolean' && this.hostHidden === null) {
                this.hostHidden = snapshot.hidden;
                this._publish();
            }
        }).catch(error => console.warn('Unable to read Visualizer window visibility.', error));
    }

    setLayout(layout) {
        this.layout = layout;
        const wanted = new Map();
        const itemKeys = new Map();
        for (const item of layout?.items || []) {
            const definition = SOURCE_TYPES[item?.type];
            if (!definition) continue;
            const channel = item.channel ?? null;
            const { params, gainDb } = analysisSettings(item.type, item.params);
            const key = sourceKey(item.type, channel, params, gainDb);
            wanted.set(key, { definition, channel, params, gainDb });
            itemKeys.set(item.id, key);
        }
        const needsModulator = type => usesAudioModulation(layout?.background?.effects, type) ||
            (layout?.items || []).some(item => usesAudioModulation(item.effects, type));
        for (const [modulator, type] of Object.entries(MODULATION_ANALYZERS)) {
            const settings = analysisSettings(type);
            const key = needsModulator(modulator) ? sourceKey(type, null, settings.params, settings.gainDb) : null;
            if (key) wanted.set(key, { definition: SOURCE_TYPES[type], channel: null, ...settings });
            if (this.modulatorKeys[modulator] !== key) this.modulators[modulator] = createModulator();
            this.modulatorKeys[modulator] = key;
        }
        this.itemKeys = itemKeys;
        for (const [key, source] of this.sources) {
            if (wanted.has(key)) continue;
            source.unsubscribe();
            this.sources.delete(key);
        }
        for (const [key, { definition, channel, params, gainDb }] of wanted) {
            if (this.sources.has(key)) continue;
            const tapId = this.nextTapId++;
            const source = { tapId, key, definition, channel, params, gainDb,
                identity: {}, wasActive: false,
                itemIds: new Set(), frame: null, unsubscribe: null };
            this._subscribe(source);
            this.sources.set(key, source);
        }
        for (const source of this.sources.values()) source.itemIds.clear();
        for (const [itemId, key] of itemKeys) this.sources.get(key)?.itemIds.add(itemId);
        this._publish();
    }

    subscribeItem(itemId, callback) {
        let callbacks = this.itemSubscribers.get(itemId);
        if (!callbacks) {
            callbacks = new Set();
            this.itemSubscribers.set(itemId, callbacks);
        }
        callbacks.add(callback);
        return () => {
            callbacks.delete(callback);
            if (callbacks.size === 0) this.itemSubscribers.delete(itemId);
        };
    }

    setVisible(visible) {
        this.visible = visible === true;
        this._publish();
    }

    _subscribe(source) {
        const tapId = source.tapId;
        source.unsubscribe = this.audioManager.telemetryHub.subscribe(tapId,
            source.definition.frameType, (frame, producer) => {
                if (source.tapId === tapId) this._receive(source, frame, producer);
            });
    }

    _publish(workletRestarted = false) {
        const active = this.visible && !document.hidden &&
            !(this.hostHidden ?? this.audioManager.powerPolicyController?.hostHidden);
        if (active) {
            for (const source of this.sources.values()) {
                if (source.wasActive && (!this.active || workletRestarted)) {
                    // A resumed or reinitialized instance starts its frame counters
                    // over, so give its stream a fresh tap and display identity.
                    source.unsubscribe();
                    source.tapId = this.nextTapId++;
                    source.identity = {};
                    this._subscribe(source);
                }
                source.wasActive = true;
            }
        }
        this.active = active;
        this.audioManager.setVisualizerSources(this.active ? [...this.sources.values()].map(source => ({
            tapId: source.tapId, type: source.definition.type,
            params: source.params, channel: source.channel, gainDb: source.gainDb
        })) : []);
        if (!this.active || workletRestarted) {
            for (const source of this.sources.values()) source.frame = null;
            for (const type of Object.keys(this.modulators)) this.modulators[type] = createModulator();
        }
    }

    _receive(source, frame, producer) {
        if (!this.active || this.sources.get(source.key) !== source) return;
        const delivered = Object.freeze({ ...frame, source: source.identity });
        const definition = source.definition;
        const snapshot = window[definition.type]?.prototype?.[definition.parse]?.(delivered);
        if (snapshot) source.frame = snapshot;
        const now = performance.now() / 1000;
        const modulates = type => snapshot && this.modulatorKeys[type] === source.key;
        if (modulates('level')) {
            let rms = 0;
            for (const channel of snapshot.channels || []) if (channel.rms > rms) rms = channel.rms;
            updateModulator(this.modulators.level, rms, 'level', now);
        }
        for (const [type, [minimum, maximum]] of Object.entries(MODULATION_BANDS)) {
            if (!modulates(type)) continue;
            const bins = snapshot.current;
            if (bins?.length) {
                const binWidth = (snapshot.sampleRate || 48000) / (2 ** (snapshot.points || 12));
                const first = Math.max(1, type === 'bass' ? Math.ceil(minimum / binWidth) : Math.floor(minimum / binWidth) + 1);
                const end = Math.min(bins.length, Math.floor(maximum / binWidth) + 1);
                let power = 0;
                for (let index = first; index < end; index++) power += 10 ** (bins[index] / 10);
                // The analyzer's Hann-window correction makes summed bin power
                // about three times the corresponding time-domain mean square.
                updateModulator(this.modulators[type], Math.sqrt(power / 3), type, now);
            }
        }
        if (modulates('width')) this.modulators.width.value = 1 - Math.abs(snapshot.correlation);
        if (modulates('beat')) {
            const state = this.modulators.beat;
            // Forward detections track the current beat grid ahead of committed history.
            const beat = snapshot.previewBeats?.at(-1) || snapshot.forwardBeats?.at(-1);
            state.period = beat?.periodSeconds || snapshot.periodSeconds;
            if (snapshot.confidence === 0 && snapshot.strongestBpm === 0) state.period = 0;
            const anchor = beat?.time ?? (snapshot.anchorFrame + snapshot.anchorFraction) * snapshot.hopSeconds;
            state.phase = state.period > 0 ? (snapshot.frameCount * snapshot.hopSeconds - anchor) / state.period : 0;
            state.lastTime = now;
        }
        for (const itemId of source.itemIds) {
            for (const callback of this.itemSubscribers.get(itemId) || []) callback(delivered, producer);
        }
    }

    getFrame(itemId) {
        return this.sources.get(this.itemKeys.get(itemId))?.frame ?? null;
    }

    getModulators() {
        const beat = this.modulators.beat;
        // Evaluate the beat between telemetry frames so every rendered frame moves smoothly.
        beat.value = beat.period > 0 ? (1 + Math.cos(2 * Math.PI *
            (beat.phase + Math.max(0, performance.now() / 1000 - beat.lastTime) / beat.period))) / 2 : 0;
        return Object.fromEntries(Object.entries(this.modulators).map(([type, state]) => [type, state.value]));
    }

    getStatus() {
        const preference = window.audioPreferences || window.electronIntegration?.audioPreferences || {};
        const rollout = getDspRolloutConfig({ preference, location: window.location });
        if (preference.useWasmDsp === false || rollout.forceOff) return 'disabled';
        return this.audioManager.isDspReady?.() ? 'ready' : 'unavailable';
    }

    dispose() {
        this.setVisible(false);
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this.audioManager.removeEventListener?.('dspReady', this._onDspReady);
        this._stopHostVisibility?.();
        for (const source of this.sources.values()) source.unsubscribe();
        this.sources.clear();
        this.itemSubscribers.clear();
    }
}
