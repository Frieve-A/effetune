(() => {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const noteFrequency = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
    const nearestSemitone = (frequency, a4 = 440) =>
        noteFrequency(Math.round(69 + 12 * Math.log2(frequency / a4)), a4);

    function frequencyToPosition(frequency, length, min, max, scale = 'log', orientation = 'x') {
        const fraction = scale === 'linear' ? (frequency - min) / (max - min)
            : Math.log(frequency / min) / Math.log(max / min);
        return (orientation === 'y' ? 1 - fraction : fraction) * length;
    }

    function positionToFrequency(position, length, min, max, scale = 'log', orientation = 'x') {
        const fraction = clamp(position / length, 0, 1);
        const value = orientation === 'y' ? 1 - fraction : fraction;
        return scale === 'linear' ? min + value * (max - min) : min * (max / min) ** value;
    }

    function noteAxisKeys(mn, mx, length) {
        const rowHeight = length / (mx - mn + 1);
        const whiteClasses = [0, 2, 4, 5, 7, 9, 11];
        const keys = [];
        // White keys may extend into the visible range from the adjoining octave.
        for (let midi = Math.floor(mn / 12) * 12; midi <= Math.ceil((mx + 1) / 12) * 12; midi++) {
            const pitchClass = (midi % 12 + 12) % 12;
            const whiteIndex = whiteClasses.indexOf(pitchClass);
            const black = whiteIndex < 0;
            if (black && (midi < mn || midi > mx)) continue;
            const start = clamp((midi - mn) * rowHeight, 0, length);
            const end = clamp((midi - mn + 1) * rowHeight, 0, length);
            const whiteStart = clamp((midi - pitchClass - mn) * rowHeight + whiteIndex * 12 * rowHeight / 7, 0, length);
            const whiteEnd = clamp((midi - pitchClass - mn) * rowHeight + (whiteIndex + 1) * 12 * rowHeight / 7, 0, length);
            if (!black && whiteEnd <= whiteStart) continue;
            keys.push({ midi, black, start, end, whiteStart, whiteEnd });
        }
        return keys;
    }

    // Piano key proportions in millimetres: 23.5 mm white-key pitch and 150 mm white keys
    // with 95 mm black keys. The default length is half of a real piano (lengthScale 2 is
    // the real ratio). Black keys fill their semitone, as wide as the white keys' back parts.
    const KEYBOARD_DEPTH_PER_OCTAVE = 150 / (7 * 23.5) / 2;
    const BLACK_KEY_DEPTH_RATIO = 95 / 150;

    // Keyboard depth for an axis on which one octave spans octaveLength. The depth is
    // limited to half of the cross-axis length so extreme zoom still leaves a plot.
    function keyboardDepths(octaveLength, crossLength, lengthScale = 1) {
        const depth = octaveLength * KEYBOARD_DEPTH_PER_OCTAVE * lengthScale;
        const gutter = depth < crossLength / 2 ? depth : crossLength / 2;
        return { gutter, blackDepth: gutter * BLACK_KEY_DEPTH_RATIO };
    }

    // Shading applies once black keys are at least this long in CSS pixels; smaller
    // keyboards keep the flat keys, whose details would not be visible anyway.
    const KEY_SHADING_MIN_BLACK_DEPTH = 12;
    const darken = alpha => 'rgba(0, 0, 0, ' + alpha + ')'; // theme-allow: Fixed shading on self-painted piano keys.
    const lighten = alpha => 'rgba(255, 255, 255, ' + alpha + ')'; // theme-allow: Fixed highlight on self-painted piano keys.

    // Shades a flat-painted keyboard so it reads as real keys. The caller paints the white
    // keys and their gaps first; drawBlackKeys paints the flat black keys, which lie over the
    // black-key shadows drawn here. `along` is the canvas axis ('x' or 'y') the keys run
    // along; their depth grows from the roll boundary at `edge` toward the player. Keys are
    // [start, end, press] along `along`.
    // Unpressed keys share one gradient per layer, so the cost stays close to flat; only
    // pressed keys add fills. A pressed key (press 0-1) sinks: its shading moves toward the
    // player, so its front edge drops out of view, and it darkens as it tilts away from the light.
    function shadeKeyboard(ctx, { along, edge, length, gutter, blackDepth, dpr }, blackKeys, drawBlackKeys,
        whiteKeys = []) {
        const pressOf = key => key[2] > 0.05 ? (key[2] < 1 ? key[2] : 1) : 0;
        if (blackDepth < KEY_SHADING_MIN_BLACK_DEPTH * dpr) {
            drawBlackKeys();
            return;
        }
        // Adds a rectangle given along the keys and in depth from the roll boundary,
        // clipped to the keyboard.
        const rect = (start, end, depthEnd, depthStart = 0) => {
            const low = start > 0 ? start : 0;
            const high = end < length ? end : length;
            const near = depthStart > 0 ? depthStart : 0;
            const far = depthEnd < gutter ? depthEnd : gutter;
            if (high <= low || far <= near) return;
            if (along === 'x') ctx.rect(low, edge + near, high - low, far - near);
            else ctx.rect(edge + near, low, far - near, high - low);
        };
        const fillRects = (style, addRects) => {
            ctx.fillStyle = style;
            ctx.beginPath();
            addRects();
            ctx.fill();
        };
        // Fills a gradient running in depth from `near` to `far`. Stops are [offset, released
        // tone, pressed tone]; a tone above 0 lightens and one below 0 darkens by its
        // magnitude, blended by the press amount.
        const fillDepthGradient = (near, far, stops, press, addRects) => {
            const gradient = along === 'x'
                ? ctx.createLinearGradient(0, edge + near, 0, edge + far)
                : ctx.createLinearGradient(edge + near, 0, edge + far, 0);
            for (const [offset, released, pressed] of stops) {
                const tone = released + (pressed - released) * press;
                gradient.addColorStop(offset, tone < 0 ? darken(-tone) : lighten(tone));
            }
            fillRects(gradient, addRects);
        };
        const released = keys => keys.filter(key => pressOf(key) === 0);
        const pressed = keys => keys.filter(key => pressOf(key) > 0);
        const lip = gutter * 0.04 > 1.5 * dpr ? gutter * 0.04 : 1.5 * dpr;
        const shadow = blackDepth * 0.05 > dpr ? blackDepth * 0.05 : dpr;
        const slope = blackDepth * 0.1;
        // White keys: shade under the roll edge and a rounded front lip, which a pressed key
        // pushes out of view.
        const whiteStops = depth => [
            [0, -0.3, -0.3], [0.05, -0.08, -0.12], [0.5, 0, -0.08],
            [1 - 2 * lip / depth, -0.04, -0.16], [1 - lip / depth, 0.35, -0.2], [1, -0.3, -0.3]
        ];
        fillDepthGradient(0, gutter, whiteStops(gutter), 0, () => {
            if (!whiteKeys.length) rect(0, length, gutter);
            else for (const [start, end] of released(whiteKeys)) rect(start, end, gutter);
        });
        for (const key of pressed(whiteKeys)) {
            const press = pressOf(key);
            const depth = gutter + 2 * lip * press;
            fillDepthGradient(0, depth, whiteStops(depth), press, () => rect(key[0], key[1], gutter));
        }
        // A key sunk below a neighbour shows the neighbour's side wall, as wide as the
        // height difference between the two keys.
        if (pressed(whiteKeys).length) {
            const sorted = [...whiteKeys].sort((a, b) => a[0] - b[0]);
            // Keys without a touching neighbour (at either end) count as unpressed neighbours.
            const wall = (key, neighbour, gap) => {
                const width = shadow * (pressOf(key) - (neighbour && gap < 1 ? pressOf(neighbour) : 0));
                return width > 0.5 * dpr ? width : 0;
            };
            fillDepthGradient(0, gutter, [[0, -0.04, -0.04], [1, -0.22, -0.22]], 0, () => {
                sorted.forEach((key, index) => {
                    const previous = sorted[index - 1];
                    const next = sorted[index + 1];
                    const left = wall(key, previous, previous ? key[0] - previous[1] : 0);
                    const right = wall(key, next, next ? next[0] - key[1] : 0);
                    if (left) rect(key[0], key[0] + left, gutter);
                    if (right) rect(key[1] - right, key[1], gutter);
                });
            });
        }
        // Like the UI's box-shadows, the black-key shadow falls straight down the screen,
        // whatever rotation or flip the caller applied. The inverse transform maps the
        // screen-down vector into keyboard space.
        const matrix = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
        const determinant = matrix ? matrix.a * matrix.d - matrix.b * matrix.c : 1;
        const downX = matrix ? -matrix.c / determinant : 0;
        const downY = matrix ? matrix.a / determinant : 1;
        const downScale = shadow / Math.hypot(downX, downY);
        const shiftAlong = (along === 'x' ? downX : downY) * downScale;
        const shiftDepth = (along === 'x' ? downY : downX) * downScale;
        // A wide faint layer under a tight one approximates a soft shadow without a blur.
        for (const [grow, alpha] of [[shadow, 0.1], [0, 0.12]]) {
            fillRects(darken(alpha), () => {
                for (const key of blackKeys) {
                    // A pressed black key sits closer to the white keys, so its shadow tightens.
                    const lift = 1 - 0.6 * pressOf(key);
                    const offsetAlong = shiftAlong * lift;
                    const offsetDepth = shiftDepth * lift;
                    const spread = grow * lift;
                    rect(key[0] + offsetAlong - spread, key[1] + offsetAlong + spread,
                        blackDepth + offsetDepth + spread, offsetDepth - spread);
                }
            });
        }
        drawBlackKeys();
        // Black keys: darker sides, a lit sloping front end, and a raised top face. Like a
        // pressed white key, a pressed black key pushes its sloping front out of view.
        const shadeBlackKeys = (keys, press) => {
            if (!keys.length) return;
            const depth = blackDepth + 0.8 * slope * press;
            const front = 1 - slope / depth;
            fillDepthGradient(0, depth, [
                [0, -0.25, -0.25], [front, -0.1, -0.2], [front + 0.001, 0.28, 0.08], [1, 0.08, -0.1]
            ], press, () => {
                for (const [start, end] of keys) rect(start, end, blackDepth);
            });
            fillDepthGradient(0, depth, [[0, 0.04, 0.02], [front, 0.2, 0.08]], press, () => {
                for (const [start, end] of keys) {
                    const inset = (end - start) * 0.15;
                    if (inset >= 0.5 * dpr) rect(start + inset, end - inset, depth - slope);
                }
            });
        };
        shadeBlackKeys(released(blackKeys), 0);
        for (const key of pressed(blackKeys)) shadeBlackKeys([key], pressOf(key));
    }

    function hitKey(keys, along, across, gutter, blackDepth) {
        if (across < 0 || across > gutter) return null;
        if (across <= blackDepth) {
            const black = keys.find(key => key.black && along >= key.start && along <= key.end);
            if (black) return black;
        }
        return keys.find(key => !key.black && along >= key.whiteStart && along <= key.whiteEnd) || null;
    }

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
        ['SubSynthPlugin', ['sub-synth-graph', 5, 1000]],
        ['GroupDelayEqPlugin', ['group-delay-eq-graph-container', 20, 20000]],
        ['ExciterPlugin', ['exciter-hpf-graph', 20, 20000]],
        ['DSD64IMDSimulatorPlugin', ['dsd64-imd-df-graph', 0, 20000]],
        ['GroupDelayPEQPlugin', ['group-delay-peq-graph', 10, 40000, 20]],
        ['SpectrumAnalyzerPlugin', ['graph-container', 20, 40000]],
        ['ChromaSpiralPlugin', ['graph-container', 0, 0]],
        ['SpectrogramPlugin', ['graph-container', 20, 40000]],
        ['NoteSpectrogramPlugin', ['graph-container', 0, 0]],
        ['PitchMeterPlugin', ['graph-container', 0, 0]],
        ['PhaseSelectEqPlugin', ['graph-container', 20, 40000]],
        ['TonalBalanceEQPlugin', ['graph-container', 0, 0]]
    ].map(([name, [graph, minFreq, maxFreq, inset = 0]]) => [name, {
        plotSelector: `.${graph}${inset ? '' : ' canvas'}`,
        ...(inset ? { mountSelector: `.${graph}` } : {}),
        minFreq, maxFreq, inset, scale: 'log', orientation: 'x',
        axisCheck: inset ? { ownerOf: plugin => plugin, freqToXName: 'freqToX' }
            : [`Math.log10(${minFreq})`, `Math.log10(${maxFreq})`]
    }]));
    targets.get('RoomEqPlugin').ownerOf = plugin => plugin._additionalEqEditor;
    targets.get('RoomEqPlugin').axisCheck.ownerOf = targets.get('RoomEqPlugin').ownerOf;
    targets.get('RoomEqPlugin').isActive = plugin => !plugin._responseView || plugin._responseView === 'frequency';
    targets.get('FiveBandDynamicEQ').axisCheck = ['const minFreq = 10;', 'const maxFreq = 40000;'];
    targets.get('DSD64IMDSimulatorPlugin').scale = 'linear';
    targets.get('DSD64IMDSimulatorPlugin').axisCheck = ['freq / fMax', 'const fMax = 20000;'];

    targets.get('ChromaSpiralPlugin').axisCheck = ['getSpiralGeometry(width, height, dpr)', 'static spiralPoint('];
    targets.get('ChromaSpiralPlugin').axis = (plugin, box) => {
        const { inner, pitch, midiLow, midiEnd } = plugin.getSpiralGeometry(box.width, box.height);
        return {
            orientation: 'polar', length: pitch > 0 ? box.width : 0, crossLength: box.height, gutter: 0,
            pointToFreq(x, y) {
                const dx = x - box.width / 2;
                const dy = y - box.height / 2;
                const phase = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
                // Select the closest turn at this angle; pitch stays continuous between notes.
                const turn = Math.round((Math.hypot(dx, dy) - inner) / pitch - phase);
                return noteFrequency(clamp(midiLow + (turn + phase) * 12, midiLow - 0.5, midiEnd));
            },
            toPoint(frequency) {
                const midi = 69 + 12 * Math.log2(frequency / 440);
                const point = plugin.constructor.spiralPoint(midi, midiLow, inner, pitch);
                return { x: box.width / 2 + point.x, y: box.height / 2 + point.y };
            }
        };
    };

    for (const name of ['SpectrumAnalyzerPlugin', 'SpectrogramPlugin']) {
        const vertical = name === 'SpectrogramPlugin';
        const target = targets.get(name);
        target.axisCheck = ['getKeyboardGeometry(length)', 'keyboardDepths(', '_DISPLAY_FREQ / '];
        target.axis = (plugin, box) => {
            const orientation = vertical ? 'y' : 'x';
            const length = vertical ? box.height : box.width;
            const crossLength = vertical ? box.width : box.height;
            const { gutter, blackDepth } = plugin.kb
                ? keyboardDepths(length / Math.log2(40000 / 20), crossLength, plugin.displayOptions?.keyboardLength)
                : { gutter: 0, blackDepth: 0 };
            const scale = plugin.sc === 'linear' ? 'linear' : 'log';
            return {
                orientation, length, crossLength, gutter, blackDepth, a4: 440,
                keys: gutter ? plugin.getKeyboardGeometry(length) : null,
                toPos: frequency => vertical ? plugin.freqToY(frequency) / 255 * length : plugin.frequencyToX(frequency, length),
                toFreq: position => positionToFrequency(position, length, 20, 40000, scale, orientation)
            };
        };
    }
    for (const name of ['NoteSpectrogramPlugin', 'PitchMeterPlugin']) {
        const target = targets.get(name);
        target.axisCheck = ['12 * rowHeight / 7', "this.ly === 'Horizontal'"];
        target.axis = (plugin, box) => {
            const orientation = plugin.ly === 'Horizontal' ? 'x' : 'y';
            const length = orientation === 'x' ? box.width : box.height;
            const crossLength = orientation === 'x' ? box.height : box.width;
            const a4 = name === 'PitchMeterPlugin' ? plugin.rf : 440;
            const rowHeight = length / (plugin.mx - plugin.mn + 1);
            const keys = noteAxisKeys(plugin.mn, plugin.mx, length);
            if (orientation === 'y') {
                for (const key of keys) {
                    [key.start, key.end] = [length - key.end, length - key.start];
                    [key.whiteStart, key.whiteEnd] = [length - key.whiteEnd, length - key.whiteStart];
                }
            }
            return {
                orientation, length, crossLength, a4, keys, rowHeight,
                ...keyboardDepths(12 * rowHeight, crossLength, plugin.displayOptions?.keyboardLength),
                toPos(frequency) {
                    const midi = 69 + 12 * Math.log2(frequency / a4);
                    const position = (midi - plugin.mn + 0.5) * rowHeight;
                    return orientation === 'x' ? position : length - position;
                },
                toFreq(position) {
                    const along = orientation === 'x' ? position : length - position;
                    return noteFrequency(clamp(Math.floor(along / rowHeight) + plugin.mn, plugin.mn, plugin.mx), a4);
                }
            };
        };
    }
    targets.get('TonalBalanceEQPlugin').axisCheck = ['freqToX: frequency =>', 'xToFreq: x =>'];
    targets.get('TonalBalanceEQPlugin').axis = (plugin, box) => ({
        orientation: 'x', length: box.width, crossLength: box.height, gutter: 0,
        // The target-adjust editor uses the canvas's band-centre axis.
        toPos: frequency => plugin._adjustEditor.freqToX(frequency) / 100 * box.width,
        toFreq: position => plugin._adjustEditor.xToFreq(clamp(position / box.width, 0, 1) * 100)
    });
    targets.get('PhaseSelectEqPlugin').axisCheck = ['_frequencyToY(frequency)', '_yToFrequency(y)', 'this.sampleRate * 0.49'];
    targets.get('PhaseSelectEqPlugin').axis = (plugin, box) => ({
        orientation: 'y', length: box.height, crossLength: box.width, gutter: 0,
        toPos: frequency => plugin._frequencyToY(frequency),
        toFreq: position => plugin._yToFrequency(position)
    });

    function getAxis(plugin, target, box) {
        if (target.axis) return target.axis(plugin, box);
        const length = box.width;
        const owner = target.ownerOf ? target.ownerOf(plugin) : plugin;
        return {
            orientation: 'x', length, crossLength: box.height, gutter: 0,
            toPos: frequency => target.inset ? owner.freqToX(frequency) * length / 100
                : frequencyToPosition(frequency, length, target.minFreq, target.maxFreq, target.scale),
            toFreq: position => Math.max(0.01, positionToFrequency(position, length, target.minFreq, target.maxFreq, target.scale))
        };
    }

    function pruneDetached(instances) {
        const pipeline = window.pipelineManager?.audioManager?.pipeline || window.audioManager?.pipeline;
        if (!pipeline) return;
        const ids = new Set(pipeline.map(plugin => plugin.id));
        for (const [id, instance] of instances) if (!ids.has(id)) instance.dispose();
    }

    window.FrequencyAxis = { targets, getAxis, pruneDetached, frequencyToPosition,
        positionToFrequency, nearestSemitone, noteFrequency, noteAxisKeys, keyboardDepths, shadeKeyboard, hitKey };
})();
