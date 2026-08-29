(() => {
    const FFT_POINTS = 12;
    const FFT_SIZE = 1 << FFT_POINTS;
    const DYNAMIC_RANGE_DB = -96;
    const POWER_FLOOR = 1e-24;
    const NUMERIC_FLOOR_DB = 10 * Math.log10(POWER_FLOOR);
    const CORRECTION_AC = 10 * Math.log10(16);
    const CORRECTION_DC = 10 * Math.log10(4);
    const instances = new Map();
    const sessionEnabled = new Map();

    const targets = new Map([
        ['BandPassFilterPlugin', ['band-pass-filter-graph', 10, 40000]],
        ['CombFilterPlugin', ['comb-filter-graph', 1, 40000]],
        ['FifteenBandGEQPlugin', ['fifteen-band-geq-graph-container', 20, 20000]],
        ['HiPassFilterPlugin', ['hi-pass-filter-graph', 10, 40000]],
        ['LoPassFilterPlugin', ['lo-pass-filter-graph', 10, 40000]],
        ['LoudnessEqualizerPlugin', ['loudness-equalizer-graph', 20, 20000]],
        ['NarrowRangePlugin', ['narrow-range-graph', 20, 40000]],
        ['TiltEQPlugin', ['tilt-eq-graph-container', 20, 20000]],
        ['ToneControlPlugin', ['tone-control-graph-container', 20, 20000]],
        ['ChannelDividerPlugin', ['channel-divider-graph', 10, 40000]],
        ['FIRCrossoverPlugin', ['fir-crossover-graph', 10, 40000]],
        ['FiveBandDynamicEQ', ['fbdyn-graph', 10, 40000]],
        ['FiveBandPEQPlugin', ['five-band-peq-graph', 10, 40000, 20]],
        ['FifteenBandPEQPlugin', ['fifteen-band-peq-graph', 10, 40000, 20]],
        ['FiveBandFIRPEQPlugin', ['five-band-fir-peq-graph', 10, 40000, 20]],
        ['RoomEqPlugin', ['room-eq-additional-eq-graph', 10, 40000, 20]],
        ['EarphoneCableSimPlugin', ['earphone-cable-sim-graph', 10, 40000, 20]],
        ['SubSynthPlugin', ['sub-synth-graph', 5, 1000]]
    ].map(([name, [graph, minFreq, maxFreq, inset = 0]]) => [name, {
        plotSelector: `.${graph}${inset ? '' : ' canvas'}`,
        ...(inset ? { mountSelector: `.${graph}` } : {}),
        minFreq, maxFreq, inset,
        tickFontSize: inset ? 10 : 12,
        axisFontSize: inset ? 10 : 14
    }]));

    for (const [name, target] of targets) {
        if (target.inset) {
            target.axisCheck = {
                ownerOf: name === 'RoomEqPlugin' ? plugin => plugin._additionalEqEditor : plugin => plugin,
                freqToXName: 'freqToX'
            };
        } else {
            target.axisCheck = [`Math.log10(${target.minFreq})`, `Math.log10(${target.maxFreq})`];
        }
    }
    targets.get('FiveBandDynamicEQ').axisCheck = ['const minFreq = 10;', 'const maxFreq = 40000;'];
    targets.get('FiveBandDynamicEQ').axisFontSize = 13;
    for (const name of ['ChannelDividerPlugin', 'FIRCrossoverPlugin', 'SubSynthPlugin']) {
        targets.get(name).tickFontSize = 11;
        targets.get(name).axisFontSize = 13;
    }
    // Keep controls inside the plot and clear of existing top-right controls.
    for (const name of ['FifteenBandPEQPlugin', 'FiveBandFIRPEQPlugin', 'RoomEqPlugin']) {
        targets.get(name).toggleAnchor = {
            top: 'auto', bottom: 'calc(var(--spectrum-overlay-inset, 0px) + 6px)'
        };
    }

    let fftWorkspace;
    function analyze(buffer, bufferPosition, sampleRate) {
        if (buffer.length !== FFT_SIZE || !(sampleRate > 0)) return null;
        if (!fftWorkspace) {
            const real = new Float32Array(FFT_SIZE);
            const imag = new Float32Array(FFT_SIZE);
            const window = new Float32Array(FFT_SIZE);
            const cos = new Float32Array(FFT_SIZE);
            const sin = new Float32Array(FFT_SIZE);
            const reverse = new Uint16Array(FFT_SIZE);
            for (let i = 0; i < FFT_SIZE; i++) {
                const angle = 2 * Math.PI / FFT_SIZE * i;
                window[i] = 0.5 * (1 - Math.cos(angle));
                cos[i] = Math.cos(angle);
                sin[i] = -Math.sin(angle);
                let bits = i;
                for (let bit = 0; bit < FFT_POINTS; bit++, bits >>= 1) {
                    reverse[i] = (reverse[i] << 1) | (bits & 1);
                }
            }
            fftWorkspace = { real, imag, window, cos, sin, reverse };
        }
        const { real, imag, window, cos, sin, reverse } = fftWorkspace;
        imag.fill(0);
        for (let i = 0; i < FFT_SIZE; i++) {
            real[reverse[i]] = buffer[(bufferPosition + i) & (FFT_SIZE - 1)] * window[i];
        }
        // Match Spectrum Analyzer's Float32 butterflies and per-stage normalization.
        for (let stage = 1, size = 2; size <= FFT_SIZE; stage++, size <<= 1) {
            const half = size >> 1;
            const shift = FFT_POINTS - stage;
            for (let i = 0; i < FFT_SIZE; i += size) {
                for (let j = i, k = 0; j < i + half; j++, k++) {
                    const index = k << shift;
                    const tr = real[j + half] * cos[index] - imag[j + half] * sin[index];
                    const ti = real[j + half] * sin[index] + imag[j + half] * cos[index];
                    real[j + half] = (real[j] - tr) * 0.5;
                    imag[j + half] = (imag[j] - ti) * 0.5;
                    real[j] = (real[j] + tr) * 0.5;
                    imag[j] = (imag[j] + ti) * 0.5;
                }
            }
        }
        const spectrum = new Float32Array(FFT_SIZE >> 1);
        for (let i = 0; i < spectrum.length; i++) {
            const db = 10 * Math.log10(real[i] * real[i] + imag[i] * imag[i] + POWER_FLOOR) +
                (i === 0 ? CORRECTION_DC : CORRECTION_AC);
            spectrum[i] = db;
        }
        return spectrum;
    }

    class SpectrumOverlayInstance {
        constructor(plugin, mount, target) {
            this.plugin = plugin;
            this.mount = mount;
            this.target = target;
            mount.style.setProperty('--spectrum-overlay-inset', `${target.inset}px`);
            this.enabled = false;
            this.visible = true;
            this.active = false;
            this.disposed = false;
            this.node = null;
            this.animationId = null;
            this.retryTimer = null;
            this.canvas = null;
            this.pending = null;
            this.levels = null;
            this.lastReceived = 0;
            this.lastFrame = 0;
            this.onMessage = event => this.onSpectrumMessage(event.data);
            this.onFrame = () => {
                this.animationId = null;
                if (this.disposed || !this.enabled) return;
                this.lastFrame = performance.now();
                this._sync();
                if (this.active) this._draw();
            };
            this.button = document.createElement('button');
            this.button.type = 'button';
            this.button.className = 'spectrum-overlay-toggle';
            this.button.innerHTML = '<svg viewBox="0 0 22 22" aria-hidden="true"><path fill="currentColor" d="M2 7h2v12H2z M6 12h2v7H6z M10 3h2v16h-2z M14 14h2v5h-2z M18 10h2v9h-2z"/></svg>';
            Object.assign(this.button.style, target.toggleAnchor);
            this.button.addEventListener('mousedown', event => event.stopPropagation());
            this.button.addEventListener('pointerdown', event => event.stopPropagation());
            this.button.addEventListener('click', () => this.toggle());
            this._updateButton();
            mount.appendChild(this.button);
        }

        _updateButton() {
            const label = this.enabled ? 'Hide spectrum' : 'Show spectrum';
            this.button.setAttribute('aria-pressed', String(this.enabled));
            this.button.setAttribute('aria-label', label);
            this.button.title = label;
        }

        _post(type, enabled) {
            this.node?.port.postMessage({ type, pluginId: this.plugin.id, enabled });
        }

        _ensureNode() {
            if (this.disposed) return;
            const node = window.workletNode || null;
            if (node === this.node) return;
            this.node?.port.removeEventListener('message', this.onMessage);
            if (this.active) this._post('setSpectrumTap', false);
            this.active = false;
            this.pending = null;
            this.node = node;
            if (this.enabled && node) {
                node.port.addEventListener('message', this.onMessage);
                this._post('setSpectrumTapRoute', true);
            }
        }

        enable() {
            if (this.disposed || this.enabled) return;
            this.enabled = true;
            sessionEnabled.set(this.plugin.id, true);
            this._updateButton();
            this._createCanvas();
            this._sync();
        }

        disable() {
            if (this.disposed || !this.enabled) return;
            this.enabled = false;
            sessionEnabled.delete(this.plugin.id);
            this._updateButton();
            this._sync();
            this._post('setSpectrumTapRoute', false);
            this._releaseDisplay();
        }

        toggle() {
            if (this.enabled) this.disable();
            else this.enable();
        }

        _suspend() {
            this.visible = false;
            this._sync();
        }

        _resume() {
            this.visible = true;
            this._sync();
        }

        _sync() {
            if (this.disposed) return;
            this._ensureNode();
            const frequencyView = this._isFrequencyView();
            let active = this.enabled && this.visible && !!this.node &&
                this.plugin.canRunAnimation() && frequencyView;
            if (active && this.animationId === null) {
                this.animationId = this.plugin.requestPowerAnimationFrame(this.onFrame, 'analyzer');
                if (this.animationId === null) active = false;
            }
            if (!active && this.animationId !== null) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
            if (active !== this.active) {
                this._post('setSpectrumTap', active);
                this.active = active;
                if (!active) this.pending = null;
            }
            if (this.enabled && this.retryTimer === null) {
                // PluginBase can swallow an already queued frame when its UI gate closes.
                // No external resume notification exists; poll only while intent is ON.
                this.retryTimer = setTimeout(() => {
                    this.retryTimer = null;
                    if (this.disposed || !this.enabled) return;
                    if (this.animationId !== null && performance.now() - this.lastFrame >= 250) {
                        cancelAnimationFrame(this.animationId);
                        this.animationId = null;
                    }
                    this._sync();
                }, 250);
            }
        }

        _isFrequencyView() {
            return this.plugin.constructor.name !== 'RoomEqPlugin' ||
                !this.plugin._responseView || this.plugin._responseView === 'frequency';
        }

        _createCanvas() {
            if (this.canvas) return;
            const canvas = this.canvas = document.createElement('canvas');
            canvas.className = 'spectrum-overlay-canvas';
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.inset = `${this.target.inset}px`;
            this.mount.appendChild(canvas);
            this.resizeObserver = new ResizeObserver(entries => {
                if (this.disposed || !this.canvas) return;
                const { width, height } = entries[0].contentRect;
                const dpr = window.devicePixelRatio || 1;
                const pixelWidth = Math.round(width * dpr);
                const pixelHeight = Math.round(height * dpr);
                if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
                if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
                this._drawScale(canvas.getContext('2d'));
            });
            this.resizeObserver.observe(canvas);
            this.intersectionObserver = new IntersectionObserver(entries => {
                if (this.disposed || !this.enabled) return;
                if (entries[0].isIntersecting) this._resume();
                else this._suspend();
            }, { threshold: 0 });
            this.intersectionObserver.observe(this.mount);
        }

        onSpectrumMessage(data) {
            if (!this.active || data.type !== 'spectrumOverlay' ||
                data.spectrumPluginId !== this.plugin.id) return;
            this.pending = data;
            this.lastReceived = performance.now();
        }

        _draw() {
            if (this.pending) {
                const { buffer, bufferPosition, sampleRate } = this.pending;
                this.levels = analyze(buffer, bufferPosition, sampleRate);
                this.sampleRate = sampleRate;
                this.pending = null;
            }
            const canvas = this.canvas;
            const ctx = canvas.getContext('2d');
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            if (!width || !height) return;
            if (!this.levels) {
                this._drawScale(ctx);
                return;
            }
            if (performance.now() - this.lastReceived > 500) {
                for (let i = 0; i < this.levels.length; i++) {
                    const faded = this.levels[i] - 4;
                    this.levels[i] = faded < NUMERIC_FLOOR_DB ? NUMERIC_FLOOR_DB : faded;
                }
            }
            const { minFreq, maxFreq } = this.target;
            const logMin = Math.log10(minFreq);
            const logRange = Math.log10(maxFreq) - logMin;
            ctx.beginPath();
            let started = false;
            for (let i = 1; i < this.levels.length; i++) {
                const frequency = i * this.sampleRate / FFT_SIZE;
                if (frequency < minFreq) continue;
                if (frequency > maxFreq) break;
                const x = width * (Math.log10(frequency) - logMin) / logRange;
                const level = this.levels[i] > 0 ? 0 : this.levels[i];
                const y = height * level / DYNAMIC_RANGE_DB;
                if (!started) {
                    let startLevel = level;
                    if (i > 1 && frequency > minFreq) {
                        const previousFrequency = (i - 1) * this.sampleRate / FFT_SIZE;
                        const previousLevel = this.levels[i - 1] > 0 ? 0 : this.levels[i - 1];
                        const fraction = (logMin - Math.log10(previousFrequency)) /
                            (Math.log10(frequency) - Math.log10(previousFrequency));
                        startLevel = previousLevel + (level - previousLevel) * fraction;
                    }
                    // Below the first positive bin, extend its level without inventing resolution.
                    ctx.moveTo(0, height * startLevel / DYNAMIC_RANGE_DB);
                    started = true;
                }
                ctx.lineTo(x, y);
            }
            if (started) {
                ctx.strokeStyle = 'rgba(140,190,255,0.55)';
                ctx.lineWidth = window.devicePixelRatio || 1;
                ctx.stroke();
            }
            this._drawScale(ctx);
        }

        _drawScale(ctx) {
            const { width, height } = this.canvas;
            if (!width || !height) return;
            const dpr = window.devicePixelRatio || 1;
            const { tickFontSize, axisFontSize } = this.target;
            ctx.font = `${tickFontSize * dpr}px Arial`;
            ctx.fillStyle = 'rgba(140,190,255,0.8)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let level = -24; level > DYNAMIC_RANGE_DB; level -= 24) {
                ctx.fillText(String(level), width - (axisFontSize + 8) * dpr, height * level / DYNAMIC_RANGE_DB);
            }
            ctx.font = `${axisFontSize * dpr}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.save();
            ctx.translate(width - 4 * dpr, height / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Level (dBFS)', 0, 0);
            ctx.restore();
        }

        _releaseDisplay() {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
            this.resizeObserver?.disconnect();
            this.intersectionObserver?.disconnect();
            this.resizeObserver = null;
            this.intersectionObserver = null;
            this.node?.port.removeEventListener('message', this.onMessage);
            this.node = null;
            this.canvas?.remove();
            this.canvas = null;
            this.pending = null;
            this.levels = null;
            this.visible = true;
        }

        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            if (this.active) this._post('setSpectrumTap', false);
            this.active = false;
            if (this.animationId !== null) cancelAnimationFrame(this.animationId);
            this.animationId = null;
            this._releaseDisplay();
            this.button.remove();
            this.mount.style.removeProperty('--spectrum-overlay-inset');
            if (instances.get(this.plugin.id) === this) instances.delete(this.plugin.id);
        }
    }

    window.SpectrumOverlay = {
        TARGETS: targets,
        analyze,
        attach(plugin, uiRoot) {
            const pipeline = window.pipelineManager?.audioManager?.pipeline || window.audioManager?.pipeline;
            if (pipeline) {
                const ids = new Set(pipeline.map(item => item.id));
                for (const [id, instance] of instances) {
                    if (!ids.has(id)) {
                        instance.dispose();
                    }
                }
            }
            instances.get(plugin.id)?.dispose();
            const target = targets.get(plugin.constructor.name);
            if (!target) return null;
            const plot = uiRoot.querySelector(target.plotSelector);
            const mount = target.mountSelector ? uiRoot.querySelector(target.mountSelector) : plot?.parentElement;
            if (!plot || !mount) {
                console.warn(`Spectrum overlay graph not found for ${plugin.constructor.name}`);
                return null;
            }
            const instance = new SpectrumOverlayInstance(plugin, mount, target);
            instances.set(plugin.id, instance);
            if (sessionEnabled.get(plugin.id)) instance.enable();
            return instance;
        },
        detach(pluginId) {
            instances.get(pluginId)?.dispose();
        }
    };
})();
