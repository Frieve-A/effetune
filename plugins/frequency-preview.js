(() => {
    const axes = window.FrequencyAxis;
    const instances = new Map();
    let session = null;

    function stop() {
        if (!session) return;
        const previous = session;
        session = null;
        if (previous.frame !== null) cancelAnimationFrame(previous.frame);
        previous.audio?.setFrequencyPreview(null);
        if (previous.instance.mount.hasPointerCapture(previous.pointerId)) {
            previous.instance.mount.releasePointerCapture(previous.pointerId);
        }
        previous.instance.draw();
    }

    class FrequencyPreviewInstance {
        constructor(plugin, target, plot, mount) {
            Object.assign(this, { plugin, target, plot, mount });
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'frequency-preview-canvas';
            this.canvas.setAttribute('aria-hidden', 'true');
            Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2' });
            this.previousPosition = mount.style.position;
            if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
            this.previousTouchAction = mount.style.touchAction;
            this.resize();
            if (this.axis.orientation === 'polar') {
                mount.style.touchAction = 'none';
            } else if (this.axis.orientation === 'x' && getComputedStyle(mount).touchAction !== 'none') {
                mount.style.touchAction = 'pan-y';
            }
            mount.appendChild(this.canvas);
            this.listeners = {
                pointerdown: event => this.start(event),
                pointermove: event => {
                    if (session?.instance !== this || event.pointerId !== session.pointerId) return;
                    session.point = { x: event.clientX, y: event.clientY };
                    if (session.frame === null) {
                        session.frame = requestAnimationFrame(() => {
                            if (session?.instance !== this) return;
                            session.frame = null;
                            this.update();
                        });
                    }
                },
                pointerup: event => this.end(event),
                pointercancel: event => this.end(event),
                lostpointercapture: event => this.end(event)
            };
            for (const [type, listener] of Object.entries(this.listeners)) mount.addEventListener(type, listener);
            this.observer = new ResizeObserver(() => {
                this.resize();
                if (session?.instance === this) this.update();
            });
            this.observer.observe(mount);
            if (plot !== mount) this.observer.observe(plot);
        }

        resize() {
            const rect = this.mount.getBoundingClientRect();
            const style = getComputedStyle(this.mount);
            const layoutWidth = parseFloat(style.width) || this.mount.offsetWidth || this.mount.clientWidth || rect.width;
            const layoutHeight = parseFloat(style.height) || this.mount.offsetHeight || this.mount.clientHeight || rect.height;
            const scaleX = rect.width / layoutWidth || 1;
            const scaleY = rect.height / layoutHeight || 1;
            const inset = this.target.inset;
            this.box = inset ? { left: rect.left + inset * scaleX, top: rect.top + inset * scaleY,
                width: Math.max(0, rect.width - 2 * inset * scaleX),
                height: Math.max(0, rect.height - 2 * inset * scaleY) }
                : this.plot.getBoundingClientRect();
            this.axis = axes.getAxis(this.plugin, this.target, this.box);
            const { left, top, width, height } = this.box;
            // Pointer and graph drawing use viewport pixels; CSS positioning uses layout pixels.
            Object.assign(this.canvas.style, { left: `${(left - rect.left) / scaleX - this.mount.clientLeft}px`,
                top: `${(top - rect.top) / scaleY - this.mount.clientTop}px` });
            this.canvas.style.setProperty('width', `${width / scaleX}px`, 'important');
            this.canvas.style.setProperty('height', `${height / scaleY}px`, 'important');
            this.dpr = window.devicePixelRatio || 1;
            this.canvas.width = Math.round(width * this.dpr);
            this.canvas.height = Math.round(height * this.dpr);
            this.draw();
        }

        start(event) {
            if (event.defaultPrevented ||
                (event.button !== 0 && event.pointerType !== 'touch' && event.pointerType !== 'pen') ||
                event.target.closest('button, input, select, textarea, a, [class*="-marker"]') ||
                (this.target.isActive && !this.target.isActive(this.plugin))) return;
            this.resize();
            if (this.axis.length <= 0 || this.axis.crossLength <= this.axis.gutter) return;
            stop();
            const audio = window.pipelineManager?.audioManager || window.audioManager;
            session = { instance: this, audio, pointerId: event.pointerId, frame: null,
                point: { x: event.clientX, y: event.clientY }, frequency: null, sound: null };
            this.mount.setPointerCapture(event.pointerId);
            event.preventDefault();
            this.update();
        }

        end(event) {
            if (session?.instance === this && session.pointerId === event.pointerId) stop();
        }

        update() {
            if (session?.instance !== this) return;
            if (this.target.isActive && !this.target.isActive(this.plugin)) { stop(); return; }
            // Read current geometry so scrolling and changed graph settings stay aligned.
            this.resize();
            const axis = this.axis;
            const horizontal = axis.orientation === 'x';
            const along = Math.max(0, Math.min(axis.length,
                horizontal ? session.point.x - this.box.left : session.point.y - this.box.top));
            const across = (horizontal ? session.point.y - this.box.top : session.point.x - this.box.left)
                - (axis.crossLength - axis.gutter);
            let frequency = axis.pointToFreq
                ? axis.pointToFreq(session.point.x - this.box.left, session.point.y - this.box.top)
                : axis.toFreq(along);
            if (axis.gutter) {
                const key = axes.hitKey(axis.keys, along, across, axis.gutter, axis.blackDepth);
                frequency = key ? axes.noteFrequency(key.midi, axis.a4) : axes.nearestSemitone(frequency, axis.a4);
            }
            const sound = !this.target.pitchPreview && !axis.gutter &&
                window.appConfig?.frequencyPreviewSound === 'bandpassNoise' ? 'bandpassNoise' : 'sine';
            if (frequency !== session.frequency || sound !== session.sound) {
                session.frequency = frequency;
                session.sound = sound;
                session.audio?.setFrequencyPreview(frequency, sound);
            }
            this.draw();
        }

        draw() {
            const ctx = this.canvas.getContext('2d');
            ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            ctx.clearRect(0, 0, this.box.width, this.box.height);
            if (session?.instance !== this || session.frequency === null) return;
            const axis = this.axis;
            const horizontal = axis.orientation === 'x';
            const rect = (start, across, length, depth, clear = false) => {
                const args = horizontal ? [start, across, length, depth] : [across, start, depth, length];
                ctx[clear ? 'clearRect' : 'fillRect'](...args);
            };
            ctx.fillStyle = ctx.strokeStyle = window.ThemePalette?.get('graph-trace') || '';
            if (axis.toPoint) {
                const point = axis.toPoint(session.frequency);
                ctx.globalAlpha = 1;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
                ctx.stroke();
                return;
            }
            const position = axis.toPos(session.frequency);
            if (!axis.gutter) {
                ctx.globalAlpha = 1;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(horizontal ? position : 0, horizontal ? 0 : position);
                ctx.lineTo(horizontal ? position : axis.crossLength, horizontal ? axis.crossLength : position);
                ctx.stroke();
                return;
            }
            const midi = Math.round(69 + 12 * Math.log2(session.frequency / axis.a4));
            const key = axis.keys.find(candidate => candidate.midi === midi);
            const p1 = axis.toPos(session.frequency / 2 ** (1 / 24));
            const p2 = axis.toPos(session.frequency * 2 ** (1 / 24));
            const start = Math.max(0, Math.min(p1, p2));
            const end = Math.min(axis.length, Math.max(p1, p2));
            ctx.globalAlpha = 0.22;
            rect(start, 0, end - start, axis.crossLength - axis.gutter);
            if (!key) return;
            const edge = axis.crossLength - axis.gutter;
            ctx.globalAlpha = 0.55;
            if (key.black) {
                rect(key.start, edge, key.end - key.start, axis.blackDepth);
            } else {
                rect(key.whiteStart, edge, key.whiteEnd - key.whiteStart, axis.gutter);
                for (const black of axis.keys) {
                    if (black.black && black.end > key.whiteStart && black.start < key.whiteEnd) {
                        rect(black.start, edge, black.end - black.start, axis.blackDepth, true);
                    }
                }
            }
            ctx.globalAlpha = 1;
        }

        dispose() {
            if (session?.instance === this) stop();
            for (const [type, listener] of Object.entries(this.listeners)) this.mount.removeEventListener(type, listener);
            this.observer.disconnect();
            this.canvas.remove();
            this.mount.style.position = this.previousPosition;
            this.mount.style.touchAction = this.previousTouchAction;
            if (instances.get(this.plugin.id) === this) instances.delete(this.plugin.id);
        }
    }

    window.addEventListener('blur', stop);
    window.addEventListener('pagehide', stop);
    // A removed capture target delivers lostpointercapture to the document.
    document.addEventListener('lostpointercapture', event => {
        if (session?.pointerId === event.pointerId &&
            !session.instance.mount.hasPointerCapture(event.pointerId)) stop();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    window.FrequencyPreview = {
        attach(plugin, uiRoot) {
            axes.pruneDetached(instances);
            instances.get(plugin.id)?.dispose();
            const target = axes.targets.get(plugin.constructor.name);
            if (!target) return null;
            const plot = uiRoot.querySelector(target.plotSelector);
            const mount = target.mountSelector ? uiRoot.querySelector(target.mountSelector) : plot?.parentElement;
            if (!plot || !mount) return null;
            const instance = new FrequencyPreviewInstance(plugin, target, plot, mount);
            instances.set(plugin.id, instance);
            return instance;
        },
        detach(pluginId) { instances.get(pluginId)?.dispose(); },
        stop
    };
})();
