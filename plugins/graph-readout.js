/*
 * GraphReadout: shared cursor readout for plugin graphs.
 *
 * const readout = window.GraphReadout?.attach({
 *     mount,        // element that hosts the overlay and receives pointer events. When the graph
 *                   // uses FrequencyPreview, pass the same mount element (it captures the pointer there).
 *     surface,      // the drawn canvas/svg element, or () => element when the surface changes per view
 *     plot(point),  // optional: -> {left, top, width, height} plot rect in surface units (default: the
 *                   // whole surface); point = {x, y} of the pointer in surface units (lets panel layouts
 *                   // return the panel under the pointer, or null outside every panel)
 *     read(x, y),   // -> null | { cursor: string, rows: [{label, color, value, y?}], at?: {x, y}, crosshair? }
 *                   // x, y, rows[].y and at are in surface units; value is a preformatted string
 *                   // (use GraphReadout.format); color is a CSS color, e.g. 'var(--et-graph-trace)'.
 *                   // A row with a finite y gets a dot at (at?.x ?? x, y) when that lies inside the plot;
 *                   // crosshair lines stay inside the plot; a result crosshair overrides the option for that
 *                   // point (e.g. 'none' over a keyboard gutter). Return null when nothing was drawn.
 *     avoid(),      // optional: -> [{left, top, width, height}] extra occupied rects in surface units
 *     crosshair,    // 'x' | 'y' | 'xy' | 'none' (default 'x')
 *     legend,       // optional persistent legend [{label, color, opacity?}]; values fill in on hover
 *     onLegendHover // optional (index | null) callback for persistent legend rows
 * });
 * readout.refresh();        // call at every exit of the draw function; re-reads only while active
 * readout.clear();          // hide (view/mode switches)
 * readout.setLegend(items); // replace persistent legend items
 *
 * Helpers: GraphReadout.format.{frequency, db(v, {signed}), time(ms), note(f, a4), degrees, number(v, digits),
 * percent(ratio)}; pathValueAt(svgPath, x) -> y | null for 'M x,y L x,y' polylines;
 * seriesValueAt(xs, ys, x) -> y | null for series sampled at ascending xs;
 * historyValueAt(times, values, t, edgeValue) -> value | NaN for time-stamped histories;
 * columnValueAt(values, x) -> value | null for per-pixel-column arrays;
 * toSurface(surface, clientX, clientY) / fromSurface(surface, x, y) convert between client px and surface units.
 *
 * Surface units: canvas = canvas.width/height pixels (same as PluginBase.getGraphCoords);
 * svg = viewBox units. Canvases drawn under setTransform(dpr) must multiply their CSS-unit
 * geometry by that dpr in plot/avoid/rows[].y/at and divide x, y by it inside read.
 * Pointer handling is passive: no preventDefault, pointer capture, or touch-action changes.
 * Values and the cursor render as a prefix, a fixed-width sign slot, a right-aligned last number and a unit, and
 * the panel and columns keep their widest size while shown, so live updates do not jitter.
 */
(() => {
    const MARGIN = 4;
    const COMPACT_WIDTH = 240;
    const TOUCH_HIDE_MS = 2000;
    const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
    const AVOID_SELECTOR = 'button, select, input, [class*="-marker"], [data-graph-readout-avoid]';
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const MINUS = '−';
    const DASH = '—';

    // Signs follow the rounded text, so values that round to zero never show '−0.0'.
    const signed = text => (Number(text) < 0 ? MINUS + text.slice(1) : `+${text.replace('-', '')}`);
    const unsigned = text => (Number(text) < 0 ? MINUS + text.slice(1) : text.replace('-', ''));

    const format = {
        frequency(f) {
            if (!Number.isFinite(f)) return DASH;
            if (f < 100) return `${f.toFixed(1)} Hz`;
            if (f < 1000) return `${f.toFixed(0)} Hz`;
            if (f < 10000) return `${(f / 1000).toFixed(2)} kHz`;
            return `${(f / 1000).toFixed(1)} kHz`;
        },
        db(v, options = {}) {
            if (v === -Infinity) return `${MINUS}∞ dB`;
            if (!Number.isFinite(v)) return DASH;
            const text = v.toFixed(1);
            return `${options.signed ? signed(text) : unsigned(text)} dB`;
        },
        time(ms) {
            if (!Number.isFinite(ms)) return DASH;
            const magnitude = ms < 0 ? -ms : ms;
            if (magnitude < 10) return `${unsigned(ms.toFixed(2))} ms`;
            if (magnitude < 1000) return `${unsigned(ms.toFixed(1))} ms`;
            return `${unsigned((ms / 1000).toFixed(2))} s`;
        },
        note(f, a4 = 440) {
            if (!(f > 0) || !Number.isFinite(f)) return DASH;
            const midi = 69 + 12 * Math.log2(f / a4);
            const nearest = Math.round(midi);
            const cents = Math.round((midi - nearest) * 100);
            const name = `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
            return `${name} ${cents < 0 ? MINUS + -cents : `+${cents}`}¢`;
        },
        degrees(v) {
            return Number.isFinite(v) ? `${unsigned(v.toFixed(0))}°` : DASH;
        },
        number(v, digits = 2) {
            return Number.isFinite(v) ? unsigned(v.toFixed(digits)) : DASH;
        },
        percent(v) {
            return Number.isFinite(v) ? `${unsigned((v * 100).toFixed(0))}%` : DASH;
        }
    };

    // Path points split into moveTo-separated {xs, ys} segments, cached per path data string.
    const pathCache = new WeakMap();
    function pathSegments(path) {
        const d = path.getAttribute('d') || '';
        const cached = pathCache.get(path);
        if (cached?.d === d) return cached.segments;
        const segments = [];
        let segment = null;
        for (const match of d.matchAll(/([ML])\s*(-?[\d.]+(?:e[-+]?\d+)?)[\s,]+(-?[\d.]+(?:e[-+]?\d+)?)/gi)) {
            if (match[1].toUpperCase() === 'M' || !segment) {
                segment = { xs: [], ys: [] };
                segments.push(segment);
            }
            segment.xs.push(Number(match[2]));
            segment.ys.push(Number(match[3]));
        }
        pathCache.set(path, { d, segments });
        return segments;
    }

    // Linear interpolation of a series sampled at ascending xs at x; null outside [xs[0], xs[last]]
    // or next to a non-finite value. A zero-width step takes its first value.
    function seriesValueAt(xs, ys, x) {
        let high = xs.length - 1;
        if (!(x >= xs[0] && x <= xs[high])) return null;
        let low = 0;
        while (high - low > 1) {
            const middle = (low + high) >> 1;
            if (xs[middle] <= x) low = middle;
            else high = middle;
        }
        const x0 = xs[low];
        const span = xs[high] - x0;
        const t = span > 0 ? (x - x0) / span : 0;
        const y0 = ys[low];
        const y1 = t > 0 ? ys[high] : y0;
        return Number.isFinite(y0) && Number.isFinite(y1) ? y0 + t * (y1 - y0) : null;
    }

    // Linear interpolation of an SVG polyline path at x; null outside the drawn range or across a moveTo gap.
    function pathValueAt(path, x) {
        for (const { xs, ys } of pathSegments(path)) {
            if (x >= xs[0] && x <= xs[xs.length - 1]) return seriesValueAt(xs, ys, x);
        }
        return null;
    }

    // Value of a history (values sampled at ascending times, in seconds) at time t: edgeValue at or
    // after the newest finite sample, linear inside a gap of at most 1 s, NaN elsewhere.
    function historyValueAt(times, values, t, edgeValue) {
        let newest = values.length - 1;
        while (newest >= 0 && !(Number.isFinite(values[newest]) && Number.isFinite(times[newest]))) newest--;
        if (newest < 0) return NaN;
        if (t >= times[newest]) return edgeValue;
        for (let i = newest; i > 0; i--) {
            const t0 = times[i - 1];
            if (!(t0 <= t)) continue;
            const t1 = times[i];
            const v0 = values[i - 1];
            const v1 = values[i];
            if (!Number.isFinite(v0) || !Number.isFinite(v1) || !(t1 - t0 <= 1)) return NaN;
            return t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v1;
        }
        return NaN;
    }

    // Linear interpolation of per-pixel-column values (index = canvas x) at x; null outside the
    // columns or next to a non-finite value.
    function columnValueAt(values, x) {
        if (!(x >= 0 && x <= values.length - 1)) return null;
        const index = Math.floor(x);
        const fraction = x - index;
        const v0 = values[index];
        const v1 = fraction > 0 ? values[index + 1] : v0;
        return Number.isFinite(v0) && Number.isFinite(v1) ? v0 + (v1 - v0) * fraction : null;
    }

    const intersection = (a, b) => {
        const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        return width > 0 && height > 0 ? width * height : 0;
    };

    // Pure placement: area/bounds/occupied are rects in mount CSS px; size = {width, height}.
    function place({ area, size, occupied = [], bounds, previous = null }) {
        const right = area.left + area.width - MARGIN - size.width;
        const bottom = area.top + area.height - MARGIN - size.height;
        const left = area.left + MARGIN;
        const top = area.top + MARGIN;
        const clamp = (value, max) => Math.max(0, Math.min(max, value));
        const candidates = CORNERS.map(corner => {
            const rect = {
                left: clamp(corner.endsWith('right') ? right : left, bounds.width - size.width),
                top: clamp(corner.startsWith('top') ? top : bottom, bounds.height - size.height),
                width: size.width,
                height: size.height
            };
            const overlap = occupied.reduce((sum, other) => sum + intersection(rect, other), 0);
            return { corner, left: rect.left, top: rect.top, overlap };
        });
        const kept = candidates.find(candidate => candidate.corner === previous && candidate.overlap === 0);
        const chosen = kept || candidates.find(candidate => candidate.overlap === 0)
            || candidates.reduce((best, candidate) => (candidate.overlap < best.overlap ? candidate : best));
        return { corner: chosen.corner, left: chosen.left, top: chosen.top };
    }

    // Size of the surface in its own drawing units (canvas pixels or viewBox units).
    function surfaceSize(surface, rect) {
        if (typeof surface.width === 'number') return { width: surface.width, height: surface.height };
        const box = surface.viewBox?.baseVal;
        return box?.width > 0 && box?.height > 0
            ? { width: box.width, height: box.height, x: box.x, y: box.y }
            : { width: rect.width, height: rect.height };
    }

    function toSurface(surface, clientX, clientY) {
        const rect = surface.getBoundingClientRect();
        const size = surfaceSize(surface, rect);
        return {
            x: (size.x || 0) + (clientX - rect.left) * size.width / rect.width,
            y: (size.y || 0) + (clientY - rect.top) * size.height / rect.height
        };
    }

    function fromSurface(surface, x, y) {
        const rect = surface.getBoundingClientRect();
        const size = surfaceSize(surface, rect);
        return {
            x: rect.left + (x - (size.x || 0)) * rect.width / size.width,
            y: rect.top + (y - (size.y || 0)) * rect.height / size.height
        };
    }

    const element = (className, parent, hidden = true) => {
        const node = document.createElement('div');
        node.className = className;
        if (hidden) node.setAttribute('aria-hidden', 'true');
        parent?.appendChild(node);
        return node;
    };

    const setText = (node, text) => {
        if (node.textContent !== text) node.textContent = text;
    };

    // Splits a formatted value into prefix, sign, last number and unit, e.g.
    // 'in −12.0 dB' -> 'in ', '−', '12.0', ' dB' and '1.25 kHz · −135°' -> '1.25 kHz · ', '−', '135', '°'.
    const VALUE_PARTS = /^(.*?)([−+-]?)(\d[\d.]*|∞)(\D*)$/;

    // Renders a value as [prefix][sign slot][number][unit] spans so the CSS can keep the sign slot
    // at a constant width and the number right-aligned (the decimal point stays put while it changes).
    // Text without a number (e.g. '—') goes into the number span.
    function setValue(node, text) {
        if (node.dataset.value === text) return;
        node.dataset.value = text;
        if (!text) {
            node.replaceChildren();
            return;
        }
        if (!node.firstChild) {
            const sign = document.createElement('span');
            sign.className = 'graph-readout-sign';
            sign.append(document.createElement('span'));
            const [prefix, number, unit] = ['prefix', 'number', 'unit'].map(part => {
                const span = document.createElement('span');
                span.className = `graph-readout-${part}`;
                return span;
            });
            node.append(prefix, sign, number, unit);
        }
        const [, prefix, sign, number, unit] = VALUE_PARTS.exec(text) || ['', '', '', text, ''];
        setText(node.children[0], prefix);
        setText(node.children[1].firstChild, sign);
        setText(node.children[2], number);
        setText(node.children[3], unit);
    }

    function attach(options) {
        const { mount } = options;
        const crosshair = options.crosshair || 'x';
        const root = element('graph-readout', mount, false);
        const area = element('graph-readout-area', root);
        const lineX = element('graph-readout-line-x', root);
        const lineY = element('graph-readout-line-y', root);
        const dots = element('graph-readout-dots', root);
        const box = element('graph-readout-box', root);
        const boxCursor = element('graph-readout-cursor', box);
        const boxRows = element('graph-readout-rows', box);
        let legend = null;
        let legendCursor = null;
        let pointer = null;
        let active = false;
        let pressed = false;
        let corner = null;
        let frame = 0;
        let hideTimer = 0;
        let positioned = false;
        // Elements whose min-width holds the widest value seen while the readout is shown.
        const held = new Set();

        const resolveSurface = () => (typeof options.surface === 'function' ? options.surface() : options.surface);

        function ensurePositioned() {
            if (positioned || !mount.isConnected) return;
            positioned = true;
            const position = getComputedStyle(mount).position;
            if (!position || position === 'static') mount.style.position = 'relative';
        }

        function buildRow(parent, item) {
            const row = element('graph-readout-row', parent, false);
            // The series color marks only the swatch (and the dot); the text keeps the label color.
            element('graph-readout-swatch', row, false).style.color = item.color;
            const label = document.createElement('span');
            const value = document.createElement('span');
            label.className = 'graph-readout-label';
            value.className = 'graph-readout-value';
            label.textContent = item.label;
            row.append(label, value);
            if (item.opacity !== undefined) row.style.opacity = String(item.opacity);
            return row;
        }

        function setLegend(items) {
            legend?.remove();
            legend = null;
            if (!items?.length) return;
            legend = element('graph-readout-legend', root, false);
            legendCursor = element('graph-readout-cursor', legend);
            items.forEach((item, index) => {
                const row = buildRow(legend, item);
                row.dataset.label = item.label;
                if (options.onLegendHover) {
                    row.addEventListener('mouseenter', () => options.onLegendHover(index));
                    row.addEventListener('mouseleave', () => options.onLegendHover(null));
                }
            });
            if (active) render();
        }

        function hide() {
            root.classList.remove('graph-readout-active');
            corner = null;
            for (const node of held) node.style.minWidth = '';
            held.clear();
            if (!legend) return;
            setValue(legendCursor, '');
            for (const value of legend.querySelectorAll('.graph-readout-value')) setValue(value, '');
        }

        // Keeps the panel and its number/unit columns from shrinking while values update, so the
        // box edge and the decimal points do not jitter; hide() releases the widths.
        function holdWidths(panel, scale) {
            const nodes = [panel, ...panel.querySelectorAll('.graph-readout-prefix, .graph-readout-number, .graph-readout-unit')];
            const widths = nodes.map(node => node.getBoundingClientRect().width / scale);
            nodes.forEach((node, index) => {
                if (parseFloat(node.style.minWidth || 0) >= widths[index]) return;
                node.style.minWidth = `${widths[index]}px`;
                held.add(node);
            });
        }

        function clear() {
            active = false;
            pressed = false;
            clearTimeout(hideTimer);
            cancelAnimationFrame(frame);
            frame = 0;
            hide();
        }

        const toLocal = (clientX, clientY, mountRect, scale) => ({
            x: (clientX - mountRect.left) / scale - mount.clientLeft,
            y: (clientY - mountRect.top) / scale - mount.clientTop
        });

        function rectToLocal(rect, mountRect, scale) {
            const origin = toLocal(rect.left, rect.top, mountRect, scale);
            return { left: origin.x, top: origin.y, width: rect.width / scale, height: rect.height / scale };
        }

        function surfaceRectToLocal(surface, rect, mountRect, scale) {
            const a = fromSurface(surface, rect.left, rect.top);
            const b = fromSurface(surface, rect.left + rect.width, rect.top + rect.height);
            return rectToLocal({ left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }, mountRect, scale);
        }

        function occupiedRects(surface, local, mountRect, scale) {
            const rects = [];
            for (const node of mount.querySelectorAll(AVOID_SELECTOR)) {
                if (root.contains(node)) continue;
                let rect = node.getBoundingClientRect();
                if (node.matches('[class*="-marker"]')) {
                    for (const child of node.querySelectorAll('*')) {
                        const inner = child.getBoundingClientRect();
                        if (!inner.width || !inner.height) continue;
                        const leftEdge = Math.min(rect.left, inner.left);
                        const topEdge = Math.min(rect.top, inner.top);
                        rect = {
                            left: leftEdge,
                            top: topEdge,
                            width: Math.max(rect.left + rect.width, inner.left + inner.width) - leftEdge,
                            height: Math.max(rect.top + rect.height, inner.top + inner.height) - topEdge
                        };
                    }
                }
                if (rect.width && rect.height) rects.push(rectToLocal(rect, mountRect, scale));
            }
            for (const rect of options.avoid?.() || []) rects.push(surfaceRectToLocal(surface, rect, mountRect, scale));
            if (pointer.pointerType === 'touch') {
                rects.push({ left: local.x - 40, top: local.y - 40, width: 80, height: mount.clientHeight - local.y + 40 });
            } else {
                rects.push({ left: local.x - 12, top: local.y - 12, width: 24, height: 24 });
            }
            return rects;
        }

        function fillRows(parent, rows) {
            if (legend) {
                const values = new Map(rows.map(row => [row.label, row.value]));
                for (const row of parent.children) {
                    if (row.dataset.label === undefined) continue;
                    setValue(row.lastChild, values.get(row.dataset.label) ?? '');
                }
                return;
            }
            const key = rows.map(row => row.label).join('\n');
            if (parent.dataset.key !== key) {
                parent.replaceChildren();
                parent.dataset.key = key;
                for (const row of rows) buildRow(parent, row);
            }
            rows.forEach((row, index) => {
                const node = parent.children[index];
                node.firstChild.style.color = row.color;
                setValue(node.lastChild, row.value);
            });
        }

        function render() {
            frame = 0;
            const surface = active && pointer && mount.isConnected ? resolveSurface() : null;
            const surfaceRect = surface?.getBoundingClientRect();
            if (!surfaceRect?.width || !surfaceRect.height) return hide();
            const point = toSurface(surface, pointer.clientX, pointer.clientY);
            const plot = options.plot ? options.plot(point) : { left: 0, top: 0, ...surfaceSize(surface, surfaceRect) };
            const inPlot = (x, y) => x >= plot.left && x <= plot.left + plot.width
                && y >= plot.top && y <= plot.top + plot.height;
            const result = plot && inPlot(point.x, point.y) ? options.read(point.x, point.y) : null;
            if (!result) return hide();

            const mountRect = mount.getBoundingClientRect();
            const scale = mount.offsetWidth ? mountRect.width / mount.offsetWidth : 1;
            const plotLocal = surfaceRectToLocal(surface, plot, mountRect, scale);
            const at = result.at || point;
            const atValid = Number.isFinite(at.x) && Number.isFinite(at.y);
            const anchor = atValid ? fromSurface(surface, at.x, at.y) : { x: pointer.clientX, y: pointer.clientY };
            const anchorLocal = toLocal(anchor.x, anchor.y, mountRect, scale);
            const clampTo = (value, start, span) => (value < start ? start : value > start + span ? start + span : value);
            // FrequencyPreview captures the pointer on the mount while it plays; hide the second crosshair.
            const previewing = mount.hasPointerCapture?.(pointer.pointerId);
            const lines = result.crosshair ?? crosshair;
            const showX = !previewing && lines.includes('x');
            const showY = !previewing && lines.includes('y');
            lineX.style.cssText = showX ? `left:${clampTo(anchorLocal.x, plotLocal.left, plotLocal.width)}px;top:${plotLocal.top}px;height:${plotLocal.height}px` : 'display:none';
            lineY.style.cssText = showY ? `top:${clampTo(anchorLocal.y, plotLocal.top, plotLocal.height)}px;left:${plotLocal.left}px;width:${plotLocal.width}px` : 'display:none';

            // Dots only for points that exist and lie inside the plot.
            const dotRows = atValid ? result.rows.filter(row => Number.isFinite(row.y) && inPlot(at.x, row.y)) : [];
            while (dots.children.length > dotRows.length) dots.lastChild.remove();
            while (dots.children.length < dotRows.length) element('graph-readout-dot', dots, false);
            dotRows.forEach((row, index) => {
                const dot = fromSurface(surface, at.x, row.y);
                const local = toLocal(dot.x, dot.y, mountRect, scale);
                dots.children[index].style.cssText = `left:${local.x}px;top:${local.y}px;background:${row.color}`;
            });

            root.classList.add('graph-readout-active');
            root.classList.toggle('graph-readout-compact', plotLocal.width < COMPACT_WIDTH);
            if (legend) {
                setValue(legendCursor, result.cursor);
                fillRows(legend, result.rows);
                holdWidths(legend, scale);
                return;
            }
            setValue(boxCursor, result.cursor);
            fillRows(boxRows, result.rows);
            holdWidths(box, scale);
            const areaRect = rectToLocal(area.getBoundingClientRect(), mountRect, scale);
            const areaLeft = Math.max(plotLocal.left, areaRect.left);
            const areaTop = Math.max(plotLocal.top, areaRect.top);
            const placed = place({
                area: {
                    left: areaLeft,
                    top: areaTop,
                    width: Math.min(plotLocal.left + plotLocal.width, areaRect.left + areaRect.width) - areaLeft,
                    height: Math.min(plotLocal.top + plotLocal.height, areaRect.top + areaRect.height) - areaTop
                },
                size: { width: box.offsetWidth, height: box.offsetHeight },
                occupied: occupiedRects(surface, toLocal(pointer.clientX, pointer.clientY, mountRect, scale), mountRect, scale),
                bounds: { width: mount.clientWidth, height: mount.clientHeight },
                previous: corner
            });
            corner = placed.corner;
            box.style.left = `${placed.left}px`;
            box.style.top = `${placed.top}px`;
        }

        function schedule(event) {
            ensurePositioned();
            pointer = { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType, pointerId: event.pointerId };
            active = true;
            if (!frame) frame = requestAnimationFrame(render);
        }

        mount.addEventListener('pointermove', event => {
            if (event.pointerType !== 'touch' || pressed) schedule(event);
        });
        mount.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'touch') return schedule(event);
            pressed = true;
            clearTimeout(hideTimer);
            schedule(event);
        });
        mount.addEventListener('pointerup', event => {
            if (event.pointerType !== 'touch') return;
            pressed = false;
            clearTimeout(hideTimer);
            hideTimer = setTimeout(clear, TOUCH_HIDE_MS);
        });
        mount.addEventListener('pointercancel', clear);
        mount.addEventListener('pointerleave', event => {
            if (event.pointerType !== 'touch') clear();
        });

        setLegend(options.legend);
        return {
            refresh() {
                ensurePositioned();
                if (active) render();
            },
            clear,
            setLegend
        };
    }

    window.GraphReadout = { attach, format, pathValueAt, seriesValueAt, historyValueAt, columnValueAt, place, toSurface, fromSurface };
})();
