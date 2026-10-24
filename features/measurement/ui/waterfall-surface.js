const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const palette = name => globalThis.window?.ThemePalette?.get(name) || '#888'; // theme-allow: Neutral fallback only when ThemePalette is unavailable; the theme palette remains authoritative.
const tickCount = (a, b, spacing, maximum) => clamp(Math.floor(Math.hypot(a.x - b.x, a.y - b.y) / spacing), 1, maximum);

export const WATERFALL_VIEW_DEFAULTS = Object.freeze({ angle: 25, elevation: 28, zoom: 1 });

function normalizeView(view) {
    return {
        angle: ((Number(view.angle ?? 25) + 180) % 360 + 360) % 360 - 180,
        elevation: clamp(Number(view.elevation ?? 28), 10, 80),
        zoom: clamp(Number(view.zoom ?? 1), 0.6, 2.5)
    };
}

function selectedIndices(length, maximum) {
    const count = Math.min(length, maximum);
    return Array.from({ length: count }, (_, i) => Math.round(i * (length - 1) / (count - 1 || 1)));
}

// Keep the source samples separate from the view, so orbiting never reanalyzes audio.
export function buildWaterfallMesh(state) {
    const data = state.waterfall;
    const frequencies = data?.frequencies || [];
    const slices = data?.slices || [];
    const cycles = data?.depthUnit === 'cycles';
    const depthAt = slice => cycles ? slice.depth : (slice.depth ?? slice.time) * 1000;
    const available = [];
    for (let i = 0; i < frequencies.length; i++) {
        if (frequencies[i] >= state.xMin && frequencies[i] <= state.xMax) available.push(i);
    }
    const columns = selectedIndices(available.length, 192).map(index => available[index]);
    const rows = selectedIndices(slices.length, 80);
    let depthMin = Infinity;
    let depthMax = -Infinity;
    let peakLevel = -Infinity;
    const frequencyPeaks = state.normalization === 'frequency' ? new Float64Array(frequencies.length).fill(-Infinity) : null;
    for (const slice of slices) for (const index of available) {
        const depth = depthAt(slice, index);
        if (finite(depth) && finite(slice.levels[index])) {
            depthMin = Math.min(depthMin, depth);
            depthMax = Math.max(depthMax, depth);
            peakLevel = Math.max(peakLevel, slice.levels[index]);
            if (frequencyPeaks) frequencyPeaks[index] = Math.max(frequencyPeaks[index], slice.levels[index]);
        }
    }
    if (!finite(depthMin)) depthMin = 0;
    if (!(depthMax > depthMin)) depthMax = depthMin + 1;
    // Establish source peaks before decimation, including later-time maxima.
    // Global mode preserves spectral differences; frequency mode compares each decay to its own peak.
    // The shared levelOffset stays zero in modes without a common reference.
    const levelOffset = state.normalization === 'global' && finite(peakLevel) ? peakLevel : 0;
    const vertices = rows.map(row => columns.map(index => {
        const slice = slices[row];
        const depth = depthAt(slice, index);
        if (!finite(slice.levels[index]) || !finite(depth)) return null;
        const level = slice.levels[index] - (frequencyPeaks ? frequencyPeaks[index] : levelOffset);
        const frequency = frequencies[index];
        return {
            u: Math.log(frequency / state.xMin) / Math.log(state.xMax / state.xMin),
            v: clamp((level - state.yMin) / (state.yMax - state.yMin), 0, 1),
            w: (depth - depthMin) / (depthMax - depthMin),
            frequency, level, depth,
            time: cycles ? depth / frequency : depth / 1000,
            cycles: cycles ? depth : depth / 1000 * frequency
        };
    }));
    const triangles = [];
    for (let r = 1; r < rows.length; r++) for (let c = 1; c < columns.length; c++) {
        // Decimation must not conceal an invalid sample and bridge an unobserved gap.
        let valid = true;
        for (let sr = rows[r - 1]; sr <= rows[r] && valid; sr++) {
            for (let sc = columns[c - 1]; sc <= columns[c]; sc++) {
                if (!finite(slices[sr].levels[sc]) || !finite(depthAt(slices[sr], sc))) { valid = false; break; }
            }
        }
        if (!valid) continue;
        const a = vertices[r - 1][c - 1];
        const b = vertices[r - 1][c];
        const c0 = vertices[r][c - 1];
        const d = vertices[r][c];
        triangles.push([a, b, c0], [b, d, c0]);
    }
    return { triangles, depthMin, depthMax, depthUnit: cycles ? 'cycles' : 'ms', levelOffset };
}

export function projectWaterfallPoint(point, view, plot) {
    const azimuth = view.angle * Math.PI / 180;
    const elevation = view.elevation * Math.PI / 180;
    const x = (point.u - 0.5) * 2;
    const y = (point.v - 0.5) * 1.2;
    const z = (point.w - 0.5) * 1.25;
    const horizontal = x * Math.cos(azimuth) - z * Math.sin(azimuth);
    const forward = x * Math.sin(azimuth) + z * Math.cos(azimuth);
    // Fit the complete rotated volume, including its highest and lowest corners.
    const halfWidth = Math.abs(Math.cos(azimuth)) + 0.625 * Math.abs(Math.sin(azimuth));
    const halfHeight = (Math.abs(Math.sin(azimuth)) + 0.625 * Math.abs(Math.cos(azimuth))) * Math.sin(elevation) +
        0.6 * Math.cos(elevation);
    const scale = Math.min(plot.width / (2 * halfWidth), plot.height / (2 * halfHeight)) * view.zoom;
    return {
        ...point,
        x: plot.left + plot.width * 0.5 + horizontal * scale,
        y: plot.top + plot.height * 0.5 + (forward * Math.sin(elevation) - y * Math.cos(elevation)) * scale,
        distance: forward * Math.cos(elevation) + y * Math.sin(elevation)
    };
}

function barycentric(triangle, x, y) {
    const [a, b, c] = triangle;
    const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(determinant) < 1e-9) return null;
    const aWeight = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / determinant;
    const bWeight = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / determinant;
    return [aWeight, bWeight, 1 - aWeight - bWeight];
}

// A bounded software depth buffer avoids painter-order errors where ridges overlap.
// The same winning triangle supplies the displayed color and the pointer readout.
export function rasterizeWaterfallSurface(triangles, plot, resolution, colors, depthUnit = 'ms', contours = null, frequencyTicks = 0) {
    const width = Math.max(1, Math.ceil(plot.width * resolution));
    const height = Math.max(1, Math.ceil(plot.height * resolution));
    const pixels = new Uint8ClampedArray(width * height * 4);
    const owners = new Int32Array(width * height).fill(-1);
    const depths = new Float32Array(width * height).fill(-Infinity);
    for (let id = 0; id < triangles.length; id++) {
        const triangle = triangles[id];
        const [a, b, c] = triangle;
        const left = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - plot.left) * resolution));
        const right = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x, c.x) - plot.left) * resolution));
        const top = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - plot.top) * resolution));
        const bottom = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y, c.y) - plot.top) * resolution));
        const origin = barycentric(triangle, plot.left + (left + 0.5) / resolution, plot.top + (top + 0.5) / resolution);
        if (!origin) continue;
        const determinant = ((b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)) * resolution;
        const ax = (b.y - c.y) / determinant;
        const bx = (c.y - a.y) / determinant;
        const cx = -ax - bx;
        const ay = (c.x - b.x) / determinant;
        const by = (a.x - c.x) / determinant;
        const cy = -ay - by;
        // Constant-level intersections are lines within each projected triangle.
        // The gradient converts dB distance to pixel distance, giving contours
        // a consistent width while sharing the surface's depth test.
        const levelGradient = contours ? Math.hypot(ax * a.level + bx * b.level + cx * c.level,
            ay * a.level + by * b.level + cy * c.level) : 0;
        const frequencyGradient = frequencyTicks ? Math.hypot(ax * a.u + bx * b.u + cx * c.u,
            ay * a.u + by * b.u + cy * c.u) : 0;
        for (let y = top; y <= bottom; y++) {
            let wa = origin[0] + ay * (y - top);
            let wb = origin[1] + by * (y - top);
            let wc = origin[2] + cy * (y - top);
            for (let x = left; x <= right; x++, wa += ax, wb += bx, wc += cx) {
                if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
                const offset = y * width + x;
                const depth = wa * a.distance + wb * b.distance + wc * c.distance;
                if (depth < depths[offset]) continue;
                depths[offset] = depth;
                owners[offset] = id;
                const color = Math.round(clamp(wa * a.v + wb * b.v + wc * c.v, 0, 1) * 255) * 4;
                const pixel = offset * 4;
                pixels[pixel] = colors[color];
                pixels[pixel + 1] = colors[color + 1];
                pixels[pixel + 2] = colors[color + 2];
                pixels[pixel + 3] = 255;
                if (levelGradient > 1e-9) {
                    const level = wa * a.level + wb * b.level + wc * c.level;
                    const contour = Math.round(level / contours.step) * contours.step;
                    if (contour > contours.min && contour < contours.max) {
                        const distance = Math.abs(level - contour) / levelGradient;
                        const opacity = clamp(0.65 * resolution + 0.5 - distance, 0, 0.75);
                        for (let channel = 0; channel < 3; channel++) pixels[pixel + channel] *= 1 - opacity;
                    }
                }
                // Constant log-frequency lines follow the surface at the same
                // ticks as the axis. The winning face also owns these lines.
                if (frequencyGradient > 1e-9) {
                    const u = wa * a.u + wb * b.u + wc * c.u;
                    const tick = Math.round(u * frequencyTicks) / frequencyTicks;
                    const distance = Math.abs(u - tick) / frequencyGradient;
                    const opacity = clamp(0.6 * resolution + 0.5 - distance, 0, 0.65);
                    for (let channel = 0; channel < 3; channel++) pixels[pixel + channel] += (255 - pixels[pixel + channel]) * opacity;
                }
            }
        }
    }
    return { width, height, pixels, owners, triangles, plot, resolution, depthUnit };
}

export function pickWaterfallSurface(raster, x, y) {
    if (!raster) return null;
    const px = Math.floor((x - raster.plot.left) * raster.resolution);
    const py = Math.floor((y - raster.plot.top) * raster.resolution);
    if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) return null;
    const owner = raster.owners[py * raster.width + px];
    if (owner < 0) return null;
    const triangle = raster.triangles[owner];
    const weights = barycentric(triangle, raster.plot.left + (px + 0.5) / raster.resolution,
        raster.plot.top + (py + 0.5) / raster.resolution);
    const interpolate = key => triangle.reduce((sum, point, index) => sum + point[key] * weights[index], 0);
    const frequency = Math.exp(triangle.reduce((sum, point, index) => sum + Math.log(point.frequency) * weights[index], 0));
    const depth = interpolate('depth');
    const time = raster.depthUnit === 'cycles' ? depth / frequency : depth / 1000;
    return {
        x: raster.plot.left + (px + 0.5) / raster.resolution,
        y: raster.plot.top + (py + 0.5) / raster.resolution,
        frequency, level: interpolate('level'), time, cycles: time * frequency, depth
    };
}

export class WaterfallSurface {
    constructor(canvas, { onViewChange = () => {} } = {}) {
        this.canvas = canvas;
        this.onViewChange = onViewChange;
        this.view = { ...WATERFALL_VIEW_DEFAULTS };
        this.enabled = false;
        this.pointers = new Map();
        this.originalTouchAction = canvas.style.touchAction;
        this.originalCursor = canvas.style.cursor;
        this.handlers = {
            pointerdown: event => this.pointerDown(event),
            pointermove: event => this.pointerMove(event),
            pointerup: event => this.pointerUp(event),
            pointercancel: event => this.pointerUp(event),
            lostpointercapture: event => this.pointerUp(event),
            wheel: event => {
                if (!this.enabled) return;
                event.preventDefault();
                this.updateView({ zoom: this.view.zoom * Math.exp(-clamp(event.deltaY, -100, 100) * 0.002) });
            },
            keydown: event => {
                if (!this.enabled) return;
                const directions = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
                if (event.shiftKey && directions[event.key]) {
                    event.preventDefault();
                    const [angle, elevation] = directions[event.key];
                    this.updateView({ angle: this.view.angle + angle, elevation: this.view.elevation + elevation });
                } else if (event.shiftKey && event.key === 'Home') {
                    event.preventDefault(); this.resetView();
                } else if (['+', '=', '-', '_'].includes(event.key)) {
                    event.preventDefault();
                    this.updateView({ zoom: this.view.zoom * (['+', '='].includes(event.key) ? 1.1 : 1 / 1.1) });
                }
            }
        };
        for (const [name, handler] of Object.entries(this.handlers)) canvas.addEventListener(name, handler, { passive: false });
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.canvas.style.touchAction = enabled ? 'none' : this.originalTouchAction;
        this.canvas.style.cursor = enabled ? 'grab' : this.originalCursor;
        if (!enabled) {
            for (const id of this.pointers.keys()) if (this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
            this.pointers.clear();
            this.raster = null;
        }
    }

    updateView(patch) {
        this.view = normalizeView({ ...this.view, ...patch });
        this.onViewChange({ ...this.view });
    }

    resetView() { this.updateView(WATERFALL_VIEW_DEFAULTS); }

    pointerDown(event) {
        if (!this.enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.canvas.setPointerCapture?.(event.pointerId);
        this.canvas.style.cursor = 'grabbing';
        this.canvas.focus({ preventScroll: true });
    }

    pointerMove(event) {
        if (!this.enabled || !this.pointers.has(event.pointerId)) return;
        event.preventDefault();
        const before = this.pointers.get(event.pointerId);
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        const after = { x: event.clientX, y: event.clientY };
        this.pointers.set(event.pointerId, after);
        if (other) {
            const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
            const distance = Math.hypot(after.x - other.x, after.y - other.y);
            if (oldDistance > 2) this.updateView({ zoom: this.view.zoom * distance / oldDistance });
        } else {
            this.updateView({ angle: this.view.angle + (after.x - before.x) * 0.4,
                elevation: this.view.elevation - (after.y - before.y) * 0.3 });
        }
    }

    pointerUp(event) {
        this.pointers.delete(event.pointerId);
        if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
        this.canvas.style.cursor = this.enabled ? (this.pointers.size ? 'grabbing' : 'grab') : this.originalCursor;
    }

    draw(ctx, state, plot, { width = plot.left + plot.width, height = plot.top + plot.height, dpr = 1, exporting = false }) {
        const view = normalizeView(state);
        const key = [state.xMin, state.xMax, state.yMin, state.yMax, state.normalization].join('|');
        const mesh = this.data === state.waterfall && this.meshKey === key ? this.mesh : buildWaterfallMesh(state);
        if (!exporting) {
            this.view = view;
            this.mesh = mesh;
            this.data = state.waterfall;
            this.meshKey = key;
        }
        const buffer = exporting ? this.canvas.ownerDocument.createElement('canvas') :
            (this.buffer ||= this.canvas.ownerDocument.createElement('canvas'));
        const bufferCtx = buffer.getContext('2d');
        buffer.width = 256; buffer.height = 1;
        const gradient = bufferCtx.createLinearGradient(0, 0, 255, 0);
        const stops = ['accent', 'success', 'warning', 'danger'].map(palette);
        stops.forEach((color, index) => gradient.addColorStop(index / 3, color));
        bufferCtx.fillStyle = gradient; bufferCtx.fillRect(0, 0, 256, 1);
        const colors = bufferCtx.getImageData(0, 0, 256, 1).data;
        ctx.save(); ctx.font = '12px Arial';
        const left = Math.max(plot.left, ctx.measureText(`${state.yMin}`).width + 18, ctx.measureText(`${state.yMax}`).width + 18);
        const right = Math.max(35, ctx.measureText(`${Number(mesh.depthMax.toPrecision(3))} ${mesh.depthUnit}`).width + 18);
        const top = Math.max(plot.top, 52);
        const fittedPlot = { left, top, width: Math.max(1, width - left - right), height: Math.max(1, height - top - 44) };
        ctx.restore();
        const levelBottom = projectWaterfallPoint({ u: 0, v: 0, w: 0 }, view, fittedPlot);
        const levelTop = projectWaterfallPoint({ u: 0, v: 1, w: 0 }, view, fittedPlot);
        const count = clamp(Math.floor(Math.abs(levelBottom.y - levelTop.y) / 35), 2, 6);
        const roughStep = (state.yMax - state.yMin) / count;
        const magnitude = 10 ** Math.floor(Math.log10(roughStep));
        const step = [1, 2, 5, 10].find(value => value * magnitude >= roughStep) * magnitude;
        const contours = { min: state.yMin, max: state.yMax, step };
        const frequencyTicks = tickCount(projectWaterfallPoint({ u: 0, v: 0, w: 1 }, view, fittedPlot),
            projectWaterfallPoint({ u: 1, v: 0, w: 1 }, view, fittedPlot), 65, 5);
        const points = new Map();
        const projected = mesh.triangles.map(triangle => triangle.map(point => {
            if (!points.has(point)) points.set(point, projectWaterfallPoint(point, view, fittedPlot));
            return points.get(point);
        }));
        const viewport = { left: 0, top: 0, width, height };
        const resolution = exporting ? dpr : Math.min(dpr, 1.5, Math.sqrt(600000 / (width * height)));
        const raster = rasterizeWaterfallSurface(projected, viewport, resolution, colors, mesh.depthUnit, contours, frequencyTicks);
        if (!exporting) this.raster = raster;
        this.drawAxes(ctx, state, fittedPlot, stops, false, view, mesh, contours, frequencyTicks);
        buffer.width = raster.width; buffer.height = raster.height;
        const image = bufferCtx.createImageData(raster.width, raster.height);
        image.data.set(raster.pixels);
        bufferCtx.putImageData(image, 0, 0);
        ctx.drawImage(buffer, 0, 0, width, height);
        this.drawAxes(ctx, state, fittedPlot, stops, true, view, mesh, contours, frequencyTicks);
    }

    drawAxes(ctx, state, plot, stops, labelsOnly, view, mesh, contours, frequencyTicks) {
        const project = (u, v, w) => projectWaterfallPoint({ u, v, w }, view, plot);
        const line = (a, b) => {
            if (labelsOnly) return;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        };
        const label = (text, x, y) => {
            if (!labelsOnly) return;
            ctx.strokeStyle = palette('graph-base'); ctx.lineWidth = 3; ctx.lineJoin = 'round';
            ctx.strokeText(text, x, y);
            ctx.fillStyle = palette('graph-label-strong'); ctx.fillText(text, x, y);
        };
        ctx.save();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.strokeStyle = palette('graph-grid'); ctx.fillStyle = palette('graph-label-strong');
        ctx.font = '12px Arial';
        for (let i = 0; i <= frequencyTicks; i++) {
            const fraction = i / frequencyTicks;
            const front = project(fraction, 0, 1);
            line(project(fraction, 0, 0), front);
            const frequency = state.xMin * (state.xMax / state.xMin) ** fraction;
            ctx.textAlign = 'center';
            label(frequency >= 1000 ? `${Number((frequency / 1000).toPrecision(2))}k` : `${Math.round(frequency)}`, front.x, front.y + 18);
        }
        const depthTicks = tickCount(project(1, 0, 0), project(1, 0, 1), 60, 4);
        for (let i = 0; i <= depthTicks; i++) {
            const fraction = i / depthTicks;
            const depth = mesh.depthMin + (mesh.depthMax - mesh.depthMin) * fraction;
            line(project(0, 0, fraction), project(1, 0, fraction));
            const edge = project(1, 0, fraction);
            ctx.textAlign = 'left';
            label(`${Number(depth.toPrecision(3))} ${mesh.depthUnit}`, edge.x + 7, edge.y + 4);
        }
        for (let level = Math.ceil(state.yMin / contours.step) * contours.step; level <= state.yMax; level += contours.step) {
            const fraction = (level - state.yMin) / (state.yMax - state.yMin);
            line(project(0, fraction, 0), project(1, fraction, 0));
            const levelEdge = project(0, fraction, 0);
            ctx.textAlign = 'right';
            label(`${Number(level.toPrecision(3))}`, levelEdge.x - 7, levelEdge.y + 4);
        }
        line(project(0, 0, 0), project(0, 1, 0));
        const frequencyLabel = project(0.5, 0, 1);
        ctx.textAlign = 'center'; label('Hz', frequencyLabel.x, frequencyLabel.y + 35);
        ctx.textAlign = 'left'; label('dB', project(0, 1, 0).x - 20, project(0, 1, 0).y - 12);
        if (!labelsOnly) { ctx.restore(); return; }
        const colorWidth = Math.min(160, plot.width * 0.3);
        const gradient = ctx.createLinearGradient(plot.left, 0, plot.left + colorWidth, 0);
        stops.forEach((color, index) => gradient.addColorStop(index / 3, color));
        ctx.fillStyle = gradient; ctx.fillRect(plot.left, 8, colorWidth, 8);
        ctx.fillStyle = palette('graph-label-strong');
        ctx.textAlign = 'left'; ctx.fillText(`${state.yMin} dB`, plot.left, 29);
        ctx.textAlign = 'right'; ctx.fillText(`${state.yMax} dB`, plot.left + colorWidth, 29);
        ctx.restore();
    }

    read(x, y) { return pickWaterfallSurface(this.raster, x, y); }

    keyboardPoint(fraction) {
        const raster = this.raster;
        if (!raster) return null;
        // Select a visible sample near the requested horizontal position.
        const target = Math.round(clamp(fraction, 0, 1) * (raster.width - 1));
        for (let distance = 0; distance < raster.width; distance++) {
            for (const x of distance ? [target - distance, target + distance] : [target]) {
                if (x < 0 || x >= raster.width) continue;
                for (let y = Math.floor(raster.height / 2); y < raster.height + Math.floor(raster.height / 2); y++) {
                    const row = y % raster.height;
                    if (raster.owners[row * raster.width + x] >= 0) {
                        return this.read(raster.plot.left + (x + 0.5) / raster.resolution,
                            raster.plot.top + (row + 0.5) / raster.resolution);
                    }
                }
            }
        }
        return null;
    }

    destroy() {
        this.setEnabled(false);
        for (const [name, handler] of Object.entries(this.handlers)) this.canvas.removeEventListener(name, handler);
    }
}
