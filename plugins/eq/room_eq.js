const ROOM_EQ_ADDITIONAL_EQ_BANDS = [100, 316, 1000, 3160, 10000];
const ROOM_EQ_ADDITIONAL_EQ_FILTER_TYPES = [
    { id: 'pk', name: 'Peaking' },
    { id: 'ls', name: 'LowShelv' },
    { id: 'hs', name: 'HighShel' }
];
const ROOM_EQ_PHASE_LOW_MIN = 20;
const ROOM_EQ_PHASE_LOW_MAX = 20000;
const ROOM_EQ_GROUP_DELAY_LIMITS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const ROOM_EQ_GRAPH_FREQUENCY_TICKS =
    [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const ROOM_EQ_RESPONSE_HIDDEN_CLASS = 'room-eq-response-hidden';

class RoomEqAdditionalEqEditor {
    constructor({
        host,
        id,
        sampleRate = 96000,
        bands = [],
        baseResponse = null,
        correctionLowFrequency = 20,
        correctionHighFrequency = 20000,
        onChange
    } = {}) {
        this.host = host;
        this.id = id;
        this._sampleRate = sampleRate;
        this.baseResponse = baseResponse;
        this.onChange = onChange;
        this.uiCreated = false;
        this.activeDragMarker = null;
        this.bandCheckboxes = [];
        this.syncFrom(bands, sampleRate, {
            lowFrequency: correctionLowFrequency,
            highFrequency: correctionHighFrequency
        });
    }

    syncFrom(bands, sampleRate = this._sampleRate, {
        lowFrequency = this.correctionLowFrequency,
        highFrequency = this.correctionHighFrequency
    } = {}) {
        this._sampleRate = sampleRate;
        this.correctionLowFrequency = lowFrequency;
        this.correctionHighFrequency = highFrequency;
        ROOM_EQ_ADDITIONAL_EQ_BANDS.forEach((frequency, index) => {
            const band = bands?.[index] || {};
            this['f' + index] = band.frequency ?? frequency;
            this['g' + index] = band.gain ?? 0;
            this['q' + index] = band.q ?? 1;
            this['t' + index] = band.type ?? 'pk';
            this['e' + index] = band.enabled ?? true;
        });
        if (!this.uiCreated) return;
        this.setUIValues();
        this.updateMarkers();
        this.updateResponse();
    }

    syncBaseResponse(response) {
        this.baseResponse = response;
        if (this.uiCreated) this.updateResponse();
    }

    setBand(index, frequency, gain, q, type, enabled) {
        if (frequency !== undefined) {
            this['f' + index] = Math.max(20, Math.min(parseFloat(frequency), 20000));
        }
        if (gain !== undefined) {
            this['g' + index] = Math.max(-20, Math.min(parseFloat(gain), 20));
        }
        if (type !== undefined) this['t' + index] = type;
        if (q !== undefined) {
            const maxQ = ['ls', 'hs'].includes(this['t' + index]) ? 2 : 10;
            this['q' + index] = Math.max(0.1, Math.min(parseFloat(q), maxQ));
        } else if (type !== undefined && ['ls', 'hs'].includes(type)) {
            this['q' + index] = Math.min(this['q' + index], 2);
        }
        if (enabled !== undefined) this['e' + index] = enabled;
        this.onChange?.(ROOM_EQ_ADDITIONAL_EQ_BANDS.map((_, bandIndex) => ({
            frequency: this['f' + bandIndex],
            gain: this['g' + bandIndex],
            q: this['q' + bandIndex],
            type: this['t' + bandIndex],
            enabled: this['e' + bandIndex]
        })));
    }

    toggleBandEnabled(index) {
        this.setBand(index, undefined, undefined, undefined, undefined, !this['e' + index]);
        if (this.bandCheckboxes[index]) {
            this.bandCheckboxes[index].checked = this['e' + index];
        }
        this.updateMarkers();
        this.updateResponse();
    }

    createUI() {
        this.disconnectGraphResizeObserver();
        const container = document.createElement('div');
        container.className = 'room-eq-additional-eq-ui';
        container.id = `room-eq-additional-eq-container-${this.id}`;

        const graphContainer = document.createElement('div');
        graphContainer.className = 'graph-container';
        graphContainer.style.margin = '10px auto';

        const graph = document.createElement('div');
        graph.className = 'room-eq-additional-eq-graph';
        graph.id = `room-eq-additional-eq-graph-${this.id}`;

        const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gridSvg.setAttribute('class', 'room-eq-additional-eq-grid');
        gridSvg.setAttribute('width', '100%');
        gridSvg.setAttribute('height', '100%');
        for (const frequency of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
            const x = this.freqToX(frequency);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${x}%`);
            line.setAttribute('x2', `${x}%`);
            line.setAttribute('y1', '0');
            line.setAttribute('y2', '100%');
            gridSvg.appendChild(line);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', `${x}%`);
            text.setAttribute('y', '95%');
            text.setAttribute('text-anchor', 'middle');
            text.textContent = frequency >= 1000 ? `${frequency / 1000}k` : frequency;
            gridSvg.appendChild(text);
        }
        for (const gain of [-18, -12, -6, 0, 6, 12, 18]) {
            const y = this.gainToY(gain);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '0');
            line.setAttribute('x2', '100%');
            line.setAttribute('y1', `${y}%`);
            line.setAttribute('y2', `${y}%`);
            gridSvg.appendChild(line);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', '2%');
            text.setAttribute('y', `${y}%`);
            text.setAttribute('dominant-baseline', 'middle');
            text.textContent = `${gain}dB`;
            gridSvg.appendChild(text);
        }
        graph.appendChild(gridSvg);

        const responseSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        responseSvg.setAttribute('class', 'room-eq-additional-eq-response');
        responseSvg.setAttribute('width', '100%');
        responseSvg.setAttribute('height', '100%');
        responseSvg.setAttribute('preserveAspectRatio', 'none');
        graph.appendChild(responseSvg);

        const markers = [];
        for (let index = 0; index < ROOM_EQ_ADDITIONAL_EQ_BANDS.length; index += 1) {
            const marker = document.createElement('div');
            marker.className = 'room-eq-additional-eq-marker';
            marker.textContent = index + 1;
            marker.id = `room-eq-additional-eq-marker-${this.id}-${index}`;
            marker.dataset.pluginId = this.id;
            marker.dataset.band = index;

            const markerText = document.createElement('div');
            markerText.className = 'room-eq-additional-eq-marker-text';
            marker.appendChild(markerText);
            graph.appendChild(marker);
            markers.push(marker);

            const handleDragStart = (clientX, clientY) => {
                this.activeDragMarker = index;
                marker.classList.add('active');
                const bandUI = container.querySelector(
                    `.room-eq-additional-eq-band[data-band="${index}"]`
                );
                bandUI?.classList.add('active');
                this.initialDragX = clientX;
                this.initialDragY = clientY;
                this.hasMoved = false;
            };
            let suppressTapUntil = 0;
            const now = () => (
                typeof performance !== 'undefined' && performance.now
                    ? performance.now()
                    : Date.now()
            );
            const cleanupPointer = this.host.bindGraphPointer(marker, {
                onDragStart: event => handleDragStart(event.clientX, event.clientY),
                onDragMove: event => this.handleDragMove({
                    clientX: event.clientX,
                    clientY: event.clientY,
                    targetContainer: graph,
                    targetBand: index
                }),
                onDragEnd: () => this.handleDragEnd(),
                onTap: () => {
                    if (suppressTapUntil && now() < suppressTapUntil) {
                        suppressTapUntil = 0;
                        return;
                    }
                    if (window.uiManager?.layoutMode?.isMobile) this.toggleBandEnabled(index);
                }
            });
            this.boundEventListeners = this.boundEventListeners || [];
            this.boundEventListeners.push(cleanupPointer);
            marker.addEventListener('contextmenu', event => {
                event.preventDefault();
                suppressTapUntil = now() + 700;
                this.toggleBandEnabled(index);
            });
        }

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'room-eq-additional-eq-controls';
        for (let index = 0; index < ROOM_EQ_ADDITIONAL_EQ_BANDS.length; index += 1) {
            controlsContainer.appendChild(this._createBandControls(index));
        }

        graphContainer.appendChild(graph);
        container.appendChild(graphContainer);
        container.appendChild(controlsContainer);
        this.graphContainer = graph;
        this.responseSvg = responseSvg;
        this.markers = markers;
        this.uiContainer = container;
        this.observeGraphResize(graph);
        this.uiCreated = true;
        this.setUIValues();
        setTimeout(() => {
            this.updateMarkers();
            this.updateResponse();
        }, 0);
        return container;
    }

    _createBandControls(index) {
        const bandControls = document.createElement('div');
        bandControls.className = 'room-eq-additional-eq-band';
        bandControls.dataset.band = index;

        const labelContainer = document.createElement('label');
        labelContainer.className = 'room-eq-additional-eq-band-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'room-eq-additional-eq-band-checkbox';
        checkbox.id = `${this.id}-room-eq-additional-eq-band-${index}-checkbox`;
        checkbox.name = checkbox.id;
        checkbox.checked = this['e' + index];
        checkbox.autocomplete = 'off';
        this.bandCheckboxes[index] = checkbox;
        checkbox.addEventListener('change', () => {
            this.setBand(index, undefined, undefined, undefined, undefined, checkbox.checked);
            this.updateMarkers();
            this.updateResponse();
        });
        labelContainer.appendChild(checkbox);
        labelContainer.appendChild(document.createTextNode(`Band ${index + 1}`));

        const typeRow = document.createElement('div');
        typeRow.className = 'room-eq-additional-eq-type-row';
        const typeSelectId = `${this.id}-room-eq-additional-eq-band-${index}-type`;
        const typeLabel = document.createElement('label');
        typeLabel.className = 'room-eq-additional-eq-type-label';
        typeLabel.textContent = 'Type:';
        typeLabel.htmlFor = typeSelectId;
        const typeSelect = document.createElement('select');
        typeSelect.className = 'room-eq-additional-eq-filter-type';
        typeSelect.id = typeSelectId;
        typeSelect.name = typeSelectId;
        typeSelect.autocomplete = 'off';
        for (const type of ROOM_EQ_ADDITIONAL_EQ_FILTER_TYPES) {
            const option = document.createElement('option');
            option.value = type.id;
            option.textContent = type.name;
            typeSelect.appendChild(option);
        }
        typeSelect.value = this['t' + index];
        typeRow.appendChild(typeLabel);
        typeRow.appendChild(typeSelect);

        const qRow = document.createElement('div');
        qRow.className = 'room-eq-additional-eq-q-row';
        const qSliderId = `${this.id}-room-eq-additional-eq-band-${index}-q-slider`;
        const qLabel = document.createElement('div');
        qLabel.className = 'room-eq-additional-eq-q-label';
        qLabel.textContent = 'Q:';
        const qSlider = document.createElement('input');
        qSlider.type = 'range';
        qSlider.className = 'room-eq-additional-eq-q-slider';
        qSlider.id = qSliderId;
        qSlider.name = qSliderId;
        qSlider.min = 0.1;
        qSlider.step = 0.01;
        qSlider.autocomplete = 'off';
        const qText = document.createElement('input');
        qText.type = 'number';
        qText.className = 'room-eq-additional-eq-q-text';
        qText.id = `${this.id}-room-eq-additional-eq-band-${index}-q-text`;
        qText.name = qText.id;
        qText.min = 0.1;
        qText.step = 0.01;
        qText.autocomplete = 'off';
        qRow.appendChild(qLabel);
        qRow.appendChild(qSlider);
        qRow.appendChild(qText);

        const syncQControls = () => {
            const maxQ = ['ls', 'hs'].includes(this['t' + index]) ? 2 : 10;
            qSlider.max = maxQ;
            qText.max = maxQ;
            qSlider.value = parseFloat(this['q' + index]).toFixed(2);
            qText.value = parseFloat(this['q' + index]).toFixed(2);
        };
        typeSelect.addEventListener('change', () => {
            this.setBand(index, undefined, undefined, parseFloat(qSlider.value), typeSelect.value);
            syncQControls();
            this.updateResponse();
            this.updateMarkers();
        });
        const updateQ = value => {
            this.setBand(index, undefined, undefined, parseFloat(value), typeSelect.value);
            syncQControls();
            this.updateResponse();
            this.updateMarkers();
        };
        qSlider.addEventListener('input', () => updateQ(qSlider.value));
        qText.addEventListener('input', () => updateQ(qText.value));
        qText.addEventListener('change', syncQControls);

        const freqRow = document.createElement('div');
        freqRow.className = 'room-eq-additional-eq-freq-row';
        const freqLabel = document.createElement('label');
        freqLabel.className = 'room-eq-additional-eq-freq-label';
        freqLabel.textContent = 'Freq (Hz):';
        const freqText = document.createElement('input');
        freqText.type = 'number';
        freqText.className = 'room-eq-additional-eq-freq-text';
        freqText.id = `${this.id}-room-eq-additional-eq-band-${index}-freq`;
        freqText.name = freqText.id;
        freqText.min = 20;
        freqText.max = 20000;
        freqText.step = 1;
        freqText.autocomplete = 'off';
        freqLabel.htmlFor = freqText.id;
        freqText.addEventListener('input', () => {
            this.setBand(index, parseFloat(freqText.value));
            this.updateResponse();
            this.updateMarkers();
        });
        freqText.addEventListener('change', () => {
            freqText.value = parseFloat(this['f' + index]).toFixed(0);
            this.updateResponse();
            this.updateMarkers();
        });
        freqRow.appendChild(freqLabel);
        freqRow.appendChild(freqText);

        const gainRow = document.createElement('div');
        gainRow.className = 'room-eq-additional-eq-gain-row';
        const gainLabel = document.createElement('label');
        gainLabel.className = 'room-eq-additional-eq-gain-label';
        gainLabel.textContent = 'Gain (dB):';
        const gainText = document.createElement('input');
        gainText.type = 'number';
        gainText.className = 'room-eq-additional-eq-gain-text';
        gainText.id = `${this.id}-room-eq-additional-eq-band-${index}-gain`;
        gainText.name = gainText.id;
        gainText.min = -20;
        gainText.max = 20;
        gainText.step = 0.1;
        gainText.autocomplete = 'off';
        gainLabel.htmlFor = gainText.id;
        gainText.addEventListener('input', () => {
            this.setBand(index, undefined, parseFloat(gainText.value));
            this.updateResponse();
            this.updateMarkers();
        });
        gainText.addEventListener('change', () => {
            gainText.value = parseFloat(this['g' + index]).toFixed(1);
            this.updateResponse();
            this.updateMarkers();
        });
        gainRow.appendChild(gainLabel);
        gainRow.appendChild(gainText);

        bandControls.appendChild(labelContainer);
        bandControls.appendChild(typeRow);
        bandControls.appendChild(qRow);
        bandControls.appendChild(freqRow);
        bandControls.appendChild(gainRow);
        syncQControls();
        return bandControls;
    }

    setUIValues() {
        if (!this.uiCreated || !this.uiContainer) return;
        for (let index = 0; index < ROOM_EQ_ADDITIONAL_EQ_BANDS.length; index += 1) {
            this.setUIBandValues(index);
            const bandControl = this.uiContainer.querySelector(
                `.room-eq-additional-eq-band[data-band="${index}"]`
            );
            const checkbox = bandControl?.querySelector('.room-eq-additional-eq-band-checkbox');
            if (checkbox) checkbox.checked = this['e' + index];
        }
    }

    setUIBandValues(index) {
        if (!this.uiCreated || !this.uiContainer) return;
        const bandControl = this.uiContainer.querySelector(
            `.room-eq-additional-eq-band[data-band="${index}"]`
        );
        if (!bandControl) return;
        const typeSelect = bandControl.querySelector('.room-eq-additional-eq-filter-type');
        const qSlider = bandControl.querySelector('.room-eq-additional-eq-q-slider');
        const qText = bandControl.querySelector('.room-eq-additional-eq-q-text');
        const freqText = bandControl.querySelector('.room-eq-additional-eq-freq-text');
        const gainText = bandControl.querySelector('.room-eq-additional-eq-gain-text');
        if (typeSelect) typeSelect.value = this['t' + index];
        const maxQ = ['ls', 'hs'].includes(this['t' + index]) ? 2 : 10;
        if (qSlider) {
            qSlider.max = maxQ;
            qSlider.value = parseFloat(this['q' + index]).toFixed(2);
        }
        if (qText) {
            qText.max = maxQ;
            qText.value = parseFloat(this['q' + index]).toFixed(2);
        }
        if (freqText) freqText.value = parseFloat(this['f' + index]).toFixed(0);
        if (gainText) gainText.value = parseFloat(this['g' + index]).toFixed(1);
    }

    freqToX(frequency) {
        const value = Math.max(10, Math.min(frequency, 40000));
        return (Math.log10(value) - Math.log10(10)) /
            (Math.log10(40000) - Math.log10(10)) * 100;
    }

    xToFreq(xPercent) {
        return Math.pow(
            10,
            Math.log10(10) + xPercent / 100 * (Math.log10(40000) - Math.log10(10))
        );
    }

    gainToY(gain) {
        return 50 - gain / 20 * 50;
    }

    yToGain(yPercent) {
        return -(yPercent - 50) / 50 * 20;
    }

    observeGraphResize(container) {
        this.disconnectGraphResizeObserver();
        if (!container) return;
        this.lastGraphSize = { width: 0, height: 0 };
        const handleResize = () => {
            const rect = container.getBoundingClientRect?.() || { width: 0, height: 0 };
            const width = container.clientWidth || rect.width;
            const height = container.clientHeight || rect.height;
            if (!width || !height) return;
            if (this.lastGraphSize.width === width && this.lastGraphSize.height === height) return;
            this.lastGraphSize = { width, height };
            this.updateMarkers();
            this.updateResponse();
        };
        const ResizeObserverClass = typeof ResizeObserver !== 'undefined'
            ? ResizeObserver
            : typeof window !== 'undefined' ? window.ResizeObserver : null;
        if (typeof ResizeObserverClass === 'function') {
            this.graphResizeObserver = new ResizeObserverClass(handleResize);
            this.graphResizeObserver.observe(container);
        } else if (typeof window !== 'undefined' &&
            typeof window.addEventListener === 'function') {
            window.addEventListener('resize', handleResize);
            this.graphResizeWindowListener = handleResize;
        }
    }

    disconnectGraphResizeObserver() {
        this.graphResizeObserver?.disconnect();
        this.graphResizeObserver = null;
        if (this.graphResizeWindowListener && typeof window !== 'undefined' &&
            typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', this.graphResizeWindowListener);
        }
        this.graphResizeWindowListener = null;
        this.lastGraphSize = null;
    }

    getGraphPlotArea(container = this.graphContainer) {
        const margin = 20;
        const rect = container?.getBoundingClientRect?.() ||
            { left: 0, top: 0, width: 0, height: 0 };
        const width = container?.clientWidth || rect.width;
        const height = container?.clientHeight || rect.height;
        const marginX = width > margin * 2 ? margin : 0;
        const marginY = height > margin * 2 ? margin : 0;
        const plotWidth = width - marginX * 2;
        const plotHeight = height - marginY * 2;
        return {
            left: rect.left + marginX,
            top: rect.top + marginY,
            width: plotWidth > 0 ? plotWidth : width,
            height: plotHeight > 0 ? plotHeight : height,
            leftPercent: width > 0 ? marginX / width * 100 : 0,
            topPercent: height > 0 ? marginY / height * 100 : 0,
            widthPercent: width > 0 ? (plotWidth > 0 ? plotWidth : width) / width * 100 : 100,
            heightPercent: height > 0 ? (plotHeight > 0 ? plotHeight : height) / height * 100 : 100
        };
    }

    updateMarkers() {
        if (!this.markers || !this.graphContainer || !this.uiCreated) return;
        const plotArea = this.getGraphPlotArea();
        const graphWidth = this.graphContainer.clientWidth;
        const graphHeight = this.graphContainer.clientHeight;
        if (!graphWidth || !graphHeight) return;
        const labelItems = [];
        for (let index = 0; index < ROOM_EQ_ADDITIONAL_EQ_BANDS.length; index += 1) {
            const marker = this.markers[index];
            if (!marker) continue;
            const frequency = this['f' + index];
            const gain = this['g' + index];
            const x = this.freqToX(frequency);
            const y = this.gainToY(gain);
            const xPos = plotArea.leftPercent + x / 100 * plotArea.widthPercent;
            const yPos = plotArea.topPercent + y / 100 * plotArea.heightPercent;
            marker.style.left = `${xPos}%`;
            marker.style.top = `${yPos}%`;
            marker.classList.toggle('disabled', !this['e' + index]);
            const label = marker.querySelector('.room-eq-additional-eq-marker-text');
            if (!label) continue;
            label.className = 'room-eq-additional-eq-marker-text';
            const displayFrequency = frequency >= 1000
                ? `${(frequency / 1000).toFixed(1)}k`
                : frequency.toFixed(0);
            label.innerHTML = `${displayFrequency}Hz<br>${gain.toFixed(1)}dB`;
            labelItems.push({
                el: label,
                cx: xPos / 100 * graphWidth,
                cy: yPos / 100 * graphHeight
            });
        }
        this.host?.layoutMarkerLabels?.({
            items: labelItems,
            width: graphWidth,
            height: graphHeight,
            axis: 'horizontal'
        });
    }

    calculateBandResponse(frequency, bandFrequency, bandGain, bandQ, bandType) {
        const sampleRate = this._sampleRate || 96000;
        const w0 = 2 * Math.PI * bandFrequency / sampleRate;
        const w = 2 * Math.PI * frequency / sampleRate;
        const q = Math.max(0.1, ['ls', 'hs'].includes(bandType) ? Math.min(bandQ, 2) : bandQ);
        const alpha = Math.sin(w0) / (2 * q);
        const cosw0 = Math.cos(w0);
        const amplitude = Math.pow(10, bandGain / 40);
        let b0;
        let b1;
        let b2;
        let a0;
        let a1;
        let a2;
        if (Math.abs(bandGain) < 0.01) {
            b0 = 1;
            b1 = 0;
            b2 = 0;
            a0 = 1;
            a1 = 0;
            a2 = 0;
        } else if (bandType === 'pk') {
            b0 = 1 + alpha * amplitude;
            b1 = -2 * cosw0;
            b2 = 1 - alpha * amplitude;
            a0 = 1 + alpha / amplitude;
            a1 = -2 * cosw0;
            a2 = 1 - alpha / amplitude;
        } else {
            const sqrtAmplitude = Math.sqrt(amplitude);
            const shelfAlpha = 2 * sqrtAmplitude * alpha;
            if (bandType === 'ls') {
                b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosw0 + shelfAlpha);
                b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosw0);
                b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosw0 - shelfAlpha);
                a0 = (amplitude + 1) + (amplitude - 1) * cosw0 + shelfAlpha;
                a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosw0);
                a2 = (amplitude + 1) + (amplitude - 1) * cosw0 - shelfAlpha;
            } else {
                b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosw0 + shelfAlpha);
                b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosw0);
                b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosw0 - shelfAlpha);
                a0 = (amplitude + 1) - (amplitude - 1) * cosw0 + shelfAlpha;
                a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosw0);
                a2 = (amplitude + 1) - (amplitude - 1) * cosw0 - shelfAlpha;
            }
        }
        if (Math.abs(a0) <= 1e-8) return 0;
        const inverseA0 = 1 / a0;
        b0 *= inverseA0;
        b1 *= inverseA0;
        b2 *= inverseA0;
        a1 *= inverseA0;
        a2 *= inverseA0;
        const cosw = Math.cos(w);
        const sinw = Math.sin(w);
        const cos2w = 2 * cosw * cosw - 1;
        const sin2w = 2 * sinw * cosw;
        const numeratorReal = b0 + b1 * cosw + b2 * cos2w;
        const numeratorImaginary = -b1 * sinw - b2 * sin2w;
        const denominatorReal = 1 + a1 * cosw + a2 * cos2w;
        const denominatorImaginary = -a1 * sinw - a2 * sin2w;
        const denominatorMagnitudeSquared =
            denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary;
        if (denominatorMagnitudeSquared < 1e-18) return -Infinity;
        const numeratorMagnitudeSquared =
            numeratorReal * numeratorReal + numeratorImaginary * numeratorImaginary;
        const magnitude = Math.sqrt(numeratorMagnitudeSquared / denominatorMagnitudeSquared);
        return 20 * Math.log10(Math.max(1e-9, magnitude));
    }

    updateResponse() {
        if (!this.responseSvg?.clientWidth || !this.responseSvg.clientHeight || !this.uiCreated) {
            return;
        }
        const width = this.responseSvg.clientWidth;
        const height = this.responseSvg.clientHeight;
        this.responseSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        this.responseSvg.setAttribute('preserveAspectRatio', 'none');
        const pointCount = Math.max(200, width / 2);
        const frequencies = Array.from(
            { length: pointCount + 1 },
            (_, index) => 10 * Math.pow(4000, index / pointCount)
        );
        const equalizerDb = frequencies.map(frequency => {
            let totalGainDb = 0;
            for (let band = 0; band < ROOM_EQ_ADDITIONAL_EQ_BANDS.length; band += 1) {
                if (!this['e' + band] || Math.abs(this['g' + band]) < 0.01) continue;
                totalGainDb += this.calculateBandResponse(
                    frequency,
                    this['f' + band],
                    this['g' + band],
                    this['q' + band],
                    this['t' + band]
                );
            }
            return totalGainDb;
        });
        const baseFrequencies = this.baseResponse?.frequencies;
        const interpolate = values => {
            if (!(baseFrequencies?.length > 1 && baseFrequencies.length === values?.length)) {
                return null;
            }
            let upper = 1;
            return frequencies.map(frequency => {
                while (upper < baseFrequencies.length && baseFrequencies[upper] < frequency) {
                    upper += 1;
                }
                if (frequency <= baseFrequencies[0]) return values[0];
                if (upper >= baseFrequencies.length) return values[values.length - 1];
                const lowFrequency = baseFrequencies[upper - 1];
                const highFrequency = baseFrequencies[upper];
                const fraction = Math.log(frequency / lowFrequency) /
                    Math.log(highFrequency / lowFrequency);
                return values[upper - 1] + fraction * (values[upper] - values[upper - 1]);
            });
        };
        const measuredDb = interpolate(this.baseResponse?.measuredDb);
        const correctionDb = interpolate(this.baseResponse?.correctionDb);
        while (this.responseSvg.firstChild) {
            this.responseSvg.removeChild(this.responseSvg.firstChild);
        }

        const appendPath = (values, className, stroke) => {
            const pathData = values.map((gain, index) => {
                const x = this.freqToX(frequencies[index]) * width / 100;
                const y = this.gainToY(gain) * height / 100;
                return `${index ? 'L' : 'M'} ${x.toFixed(2)},${y.toFixed(2)}`;
            });
            if (!pathData.length) return;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData.join(' '));
            path.setAttribute('class', className);
            path.setAttribute('stroke', stroke);
            path.setAttribute('stroke-width', '1');
            path.setAttribute('fill', 'none');
            this.responseSvg.appendChild(path);
        };

        if (correctionDb) {
            const totalCorrectionDb = correctionDb.map(
                (gain, index) => gain + equalizerDb[index]
            );
            let normalizedMeasuredDb = measuredDb;
            if (measuredDb) {
                const normalizationGainDb = Number.isFinite(this.baseResponse?.normalizationGainDb)
                    ? this.baseResponse.normalizationGainDb
                    : 0;
                normalizedMeasuredDb = measuredDb.map(gain => gain - normalizationGainDb);
                appendPath(
                    normalizedMeasuredDb,
                    'room-eq-measured-response-path',
                    '#b0b0b0'
                );
            }
            appendPath(correctionDb, 'room-eq-base-response-path', '#80c080');
            appendPath(totalCorrectionDb, 'room-eq-combined-response-path', '#00ff00');
            if (normalizedMeasuredDb) {
                appendPath(
                    normalizedMeasuredDb.map((gain, index) => gain + totalCorrectionDb[index]),
                    'room-eq-corrected-response-path',
                    '#ffffff'
                );
            }
        }

        for (const [frequency, className] of [
            [this.correctionLowFrequency, 'room-eq-correction-low-boundary'],
            [this.correctionHighFrequency, 'room-eq-correction-high-boundary']
        ]) {
            if (!Number.isFinite(frequency)) continue;
            const x = this.freqToX(frequency) * width / 100;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', `room-eq-correction-boundary ${className}`);
            line.setAttribute('x1', x.toFixed(2));
            line.setAttribute('x2', x.toFixed(2));
            line.setAttribute('y1', '0');
            line.setAttribute('y2', String(height));
            this.responseSvg.appendChild(line);
        }
    }

    handleDragMove({ clientX, clientY, targetContainer, targetBand }) {
        if (this.activeDragMarker === null) return;
        if (!this.hasMoved) {
            if (Math.abs(clientX - this.initialDragX) < 3 &&
                Math.abs(clientY - this.initialDragY) < 3) return;
            this.hasMoved = true;
        }
        const plotArea = this.getGraphPlotArea(targetContainer || this.graphContainer);
        const x = Math.max(0, Math.min(1, (clientX - plotArea.left) / plotArea.width));
        const y = Math.max(0, Math.min(1, (clientY - plotArea.top) / plotArea.height));
        this.setBand(targetBand ?? this.activeDragMarker, this.xToFreq(x * 100), this.yToGain(y * 100));
        this.updateMarkers();
        this.updateResponse();
        this.setUIBandValues(targetBand ?? this.activeDragMarker);
    }

    handleDragEnd() {
        if (this.activeDragMarker === null) return;
        this.markers?.[this.activeDragMarker]?.classList.remove('active');
        this.uiContainer?.querySelector(
            `.room-eq-additional-eq-band[data-band="${this.activeDragMarker}"]`
        )?.classList.remove('active');
        this.activeDragMarker = null;
        this.hasMoved = false;
    }

    dispose() {
        this.disconnectGraphResizeObserver();
        if (Array.isArray(this.boundEventListeners)) {
            for (const cleanup of this.boundEventListeners) cleanup();
            this.boundEventListeners = [];
        }
        this.activeDragMarker = null;
        this.uiCreated = false;
        this.uiContainer = null;
        this.graphContainer = null;
        this.responseSvg = null;
        this.markers = null;
        this.baseResponse = null;
        this.host = null;
    }
}

class RoomEqPlugin extends PluginBase {
    static createAdditionalEqEditor(options) {
        return new RoomEqAdditionalEqEditor(options);
    }

    constructor() {
        super('Room EQ', 'FIR room correction using saved frequency-response measurements');
        this.pm = 'min';
        this.tp = 32768;
        this.lt = '128';
        this.sm = 0.17;
        this.fl = 20;
        this.fh = 16000;
        this.dw = 6;
        this.pa = true;
        this.pl = 500;
        this.le = false;
        this.mb = 6;
        this.cr = 100;
        this.pr = 100;
        this.rp = 0;
        this.gn = 0;
        this.eqBands = [100, 316, 1000, 3160, 10000].map(frequency => ({
            frequency,
            gain: 0,
            q: 1,
            type: 'pk',
            enabled: true
        }));
        this.measurementId = '';
        this.measurementName = '';
        this.delayMs = 0;
        this.measurementResolved = false;
        this.temporalCapability = 'reset-on-resume';
        this.offlineDspAssetErrorMessageKey = 'roomEq.error.design';
        this._sampleRate = this._getEngineSampleRate();
        this._outputChannelCount = this._getEngineChannelCount();
        this._runtimePromise = null;
        this._designer = null;
        this._measurementStore = null;
        this._designTimer = null;
        this._designGeneration = 0;
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._lastDesign = null;
        this._assetState = 0;
        this._disposed = false;
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this._latencyElement = null;
        this._measurementRow = null;
        this._additionalEqEditor = null;
        this._phaseCorrectionControl = null;
        this._phaseLowControl = null;
        this._lowFrequencyPhaseExtensionControl = null;
        this._referencePointSelect = null;
        this._responseView = 'frequency';
        this._responseViewElements = null;
        this._beforeLegendHover = null;
        this._responseHoverCleanup = null;
        this._pathPointCache = new WeakMap();
        this._groupDelayAxisLimit = ROOM_EQ_GROUP_DELAY_LIMITS_MS[0];
        this._impulseTimeAxis = null;
        this._visibilityHandler = () => {
            if (!this._disposed && document.visibilityState === 'visible') {
                this._refreshMeasurements(true);
            }
        };
        globalThis.document?.addEventListener?.('visibilitychange', this._visibilityHandler);
        this.registerProcessor('return data;');
    }

    _t(_key, fallback, params = {}) {
        return Object.entries(params).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            fallback
        );
    }

    _qualityWarningMessage(code) {
        const messages = {
            filterAccuracy: [
                'roomEq.warning.filterAccuracy',
                'The Room EQ filter may be inaccurate. Increase Taps or Smoothing.'
            ],
            impulseResponseRequired: [
                'roomEq.error.directPhaseRequiresIr',
                'Correction needs impulse-response data for the selected measurement. Choose Minimum or Linear, or select a measurement with IR data.'
            ],
            lowFrequencyPhaseExtensionLimited: [
                'roomEq.warning.lowFrequencyPhaseExtensionLimited',
                'Low-frequency phase extension was limited by the measurement or settings. Room EQ used the available measurement window and, when necessary, reduced or skipped the correction; the rest of the filter remains active.'
            ]
        };
        const message = messages[code];
        if (!message) {
            console.warn('Unknown Room EQ quality warning:', code);
            return this._t(...messages.filterAccuracy);
        }
        return this._t(...message);
    }

    _qualityWarningForDesign(result) {
        const existingWarning = result.qualityWarnings?.[0];
        if (existingWarning) return existingWarning;
        const extensionBandExists = this.fl < Math.min(
            this._phaseLowDisplayFrequency(),
            this.fh,
            this._sampleRate * 0.45
        );
        const lowPhaseLimited = this.le && this.pm === 'full' && this.pr > 0 &&
            result.diagnostics?.lowFrequencyPhaseExtension?.some(diagnostic =>
                diagnostic?.state === 'reduced' ||
                diagnostic?.state === 'disabled' && (
                    diagnostic.reason === 'firEnergy' ||
                    diagnostic.reason === 'groupDelay' ||
                    diagnostic.reason === 'dftWorkBudget' ||
                    diagnostic.reason === 'insufficientData' && extensionBandExists
                ));
        return lowPhaseLimited ? 'lowFrequencyPhaseExtensionLimited' : undefined;
    }

    process(context, data) {
        return data;
    }

    _getEngineSampleRate() {
        const value = this._sampleRate || window.workletNode?.context?.sampleRate ||
            window.audioContext?.sampleRate || window.uiManager?.audioManager?.audioContext?.sampleRate;
        return Number.isFinite(value) && value > 0 ? value : 48000;
    }

    _getEngineChannelCount() {
        const candidates = [
            this._outputChannelCount,
            window.workletNode?.channelCount,
            window.audioManager?.outputChannelCount,
            window.uiManager?.audioManager?.outputChannelCount
        ];
        return candidates.find(value => Number.isInteger(value) && value >= 1 && value <= 8) || 2;
    }

    _packedParameters({ sampleRate = this._sampleRate } = {}) {
        return {
            ...super.getParameters(),
            lt: this.lt,
            fd: this.pm === 'min' ? 0 : this.tp / 2,
            gn: this.gn,
            dy: Math.round(this.delayMs * sampleRate / 1000)
        };
    }

    getParameters(options = {}) {
        const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
            ? options.sampleRate
            : this._sampleRate;
        const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
            options.outputChannelCount >= 1 && options.outputChannelCount <= 8
            ? options.outputChannelCount
            : this._outputChannelCount;
        if (options.commitSampleRate &&
            (sampleRate !== this._sampleRate || outputChannelCount !== this._outputChannelCount)) {
            this._sampleRate = sampleRate;
            this._outputChannelCount = outputChannelCount;
            this._syncAdditionalEqEditor();
            this._scheduleDesign(0);
        }
        return {
            ...this._packedParameters({ sampleRate }),
            pm: this.pm,
            tp: this.tp,
            sm: this.sm,
            fl: this.fl,
            fh: this.fh,
            dw: this.dw,
            pa: this.pa,
            pl: this.pl,
            le: this.le,
            mb: this.mb,
            cr: this.cr,
            pr: this.pr,
            rp: this.rp,
            bs: this.eqBands.map(band => ({ ...band })),
            ms: this.measurementId,
            mn: this.measurementName
        };
    }

    getSerializableParameters() {
        const serialized = super.getSerializableParameters();
        delete serialized.fd;
        delete serialized.dy;
        serialized.dl = this.delayMs;
        return serialized;
    }

    setParameters(params = {}) {
        const previous = this._designSignature();
        const previousLatency = this.lt;
        super._setValidatedParameters(params);
        if (['min', 'lin', 'full'].includes(params.pm)) this.pm = params.pm;
        const taps = Number(params.tp);
        if ([8192, 16384, 32768, 65536, 131072].includes(taps)) this.tp = taps;
        if (['0', '128', '256', '512', '1024'].includes(String(params.lt))) this.lt = String(params.lt);
        if (params.sm !== undefined) this.sm = this.parseFiniteNumber(params.sm, 0.02, 1, this.sm);
        if (params.fl !== undefined) this.fl = this.parseFiniteNumber(params.fl, 20, 1000, this.fl);
        if (params.fh !== undefined) this.fh = this.parseFiniteNumber(params.fh, 1000, 20000, this.fh);
        if (params.dw !== undefined) this.dw = this.parseFiniteNumber(params.dw, 1, 50, this.dw);
        if (params.pa !== undefined) {
            const auto = params.pa === true || params.pa === 1 ||
                params.pa === 'true' || params.pa === '1';
            if (this.pa && !auto && params.pl === undefined) {
                this.pl = Math.round(this._automaticPhaseLowFrequency());
            }
            this.pa = auto;
        }
        if (params.pl !== undefined) {
            this.pl = Math.round(this.parseFiniteNumber(
                params.pl,
                ROOM_EQ_PHASE_LOW_MIN,
                ROOM_EQ_PHASE_LOW_MAX,
                this.pl
            ));
        }
        if (!this.pa) {
            this.pl = Math.max(this.pl, this._manualPhaseLowMinimumFrequency());
        }
        if (params.le !== undefined) {
            this.le = params.le === true || params.le === 1 ||
                params.le === 'true' || params.le === '1';
        }
        if (params.mb !== undefined) this.mb = this.parseFiniteNumber(params.mb, 0, 18, this.mb);
        if (params.cr !== undefined) {
            this.cr = Math.round(this.parseFiniteNumber(params.cr, 0, 100, this.cr));
        }
        if (params.pr !== undefined) {
            this.pr = Math.round(this.parseFiniteNumber(params.pr, 0, 100, this.pr));
        }
        if (params.rp !== undefined) {
            const referencePoint = Number(params.rp);
            this.rp = Number.isSafeInteger(referencePoint) && referencePoint >= 0
                ? referencePoint
                : 0;
        }
        if (params.gn !== undefined) this.gn = this.parseFiniteNumber(params.gn, -12, 12, this.gn);
        if (Array.isArray(params.bs)) {
            this.eqBands = this.eqBands.map((band, index) => this._validatedBand(params.bs[index], band));
        }
        let legacyIndex = -1;
        for (let index = 0; index < 8; index += 1) {
            const id = params[`ms${index}`] ?? params.ms?.[index];
            if (legacyIndex < 0 && typeof id === 'string' && id) legacyIndex = index;
        }
        const measurementId = typeof params.ms === 'string'
            ? params.ms
            : legacyIndex >= 0 ? params[`ms${legacyIndex}`] ?? params.ms?.[legacyIndex] : undefined;
        const measurementName = typeof params.mn === 'string'
            ? params.mn
            : legacyIndex >= 0 ? params[`mn${legacyIndex}`] ?? params.mn?.[legacyIndex] : undefined;
        if (typeof measurementId === 'string') this.measurementId = measurementId.slice(0, 160);
        if (typeof measurementName === 'string') this.measurementName = measurementName.slice(0, 160);
        const delay = params.dl ?? (legacyIndex >= 0 ? params[`dy${legacyIndex}`] : params.dy0);
        if (delay !== undefined) this.delayMs = this.parseFiniteNumber(delay, 0, 20, this.delayMs);
        this._updatePowerGainBound();
        this.updateParameters();
        const next = this._designSignature();
        if (previous !== next) this._scheduleDesign(150);
        else if (previousLatency !== this.lt && this._lastDesign) this._stageDesign(this._lastDesign);
        this._syncAdditionalEqEditor();
        this._syncPhaseCorrectionControl();
        this._renderStatus();
    }

    _validatedBand(candidate, fallback) {
        if (!candidate) return { ...fallback };
        return {
            frequency: this.parseFiniteNumber(candidate.frequency, 20, 20000, fallback.frequency),
            gain: this.parseFiniteNumber(candidate.gain, -20, 20, fallback.gain),
            q: this.parseFiniteNumber(candidate.q, 0.1, 10, fallback.q),
            type: ['pk', 'ls', 'hs'].includes(candidate.type) ? candidate.type : fallback.type,
            enabled: candidate.enabled === undefined ? fallback.enabled : Boolean(candidate.enabled)
        };
    }

    _designSignature() {
        return JSON.stringify([
            this.pm, this.tp, this.sm, this.fl, this.fh, this.dw, this.pa, this.pl,
            this.le, this.mb, this.cr, this.pr, this.rp,
            this.eqBands, this.measurementId, this._sampleRate, this._outputChannelCount, this.channel
        ]);
    }

    onChannelSelectionChanged() {
        this._scheduleDesign(0);
    }

    _syncAdditionalEqEditor() {
        this._additionalEqEditor?.syncFrom(this.eqBands, this._sampleRate, {
            lowFrequency: this.fl,
            highFrequency: this.fh
        });
    }

    _syncPhaseCorrectionControl() {
        const disabled = this.pm !== 'full';
        const inputs = this._phaseCorrectionControl?.querySelectorAll?.('input') || [];
        for (const input of inputs) input.disabled = disabled;
        if (this._referencePointSelect) this._referencePointSelect.disabled = disabled;
        if (this._lowFrequencyPhaseExtensionControl) {
            this._lowFrequencyPhaseExtensionControl.checked = this.le;
            this._lowFrequencyPhaseExtensionControl.disabled = disabled;
        }
        this._syncPhaseLowControl();
    }

    _automaticPhaseLowFrequency() {
        return Math.max(this.fl, 3000 / this.dw);
    }

    _phaseLowDisplayFrequency() {
        return this.pa ? this._automaticPhaseLowFrequency() : this.pl;
    }

    _manualPhaseLowMinimumFrequency() {
        return Math.max(ROOM_EQ_PHASE_LOW_MIN, Math.ceil(1000 / this.dw));
    }

    _syncPhaseLowControl() {
        const control = this._phaseLowControl;
        if (!control) return;
        const value = Math.max(
            ROOM_EQ_PHASE_LOW_MIN,
            Math.min(ROOM_EQ_PHASE_LOW_MAX, this._phaseLowDisplayFrequency())
        );
        const logMin = Math.log10(ROOM_EQ_PHASE_LOW_MIN);
        const logRange = Math.log10(ROOM_EQ_PHASE_LOW_MAX) - logMin;
        control.slider.value = (Math.log10(value) - logMin) / logRange * 100;
        window.uiManager?.refreshRangeFillStyling?.(control.slider);
        control.valueInput.value = String(Math.round(value));
        control.valueInput.min = String(this._manualPhaseLowMinimumFrequency());
        control.auto.checked = this.pa;
        const unavailable = this.pm !== 'full';
        control.auto.disabled = unavailable;
        control.slider.disabled = unavailable || this.pa;
        control.valueInput.disabled = unavailable || this.pa;
    }

    _createPhaseLowControl() {
        const row = this.createLogarithmicParameterControl(
            this._t('roomEq.parameter.phaseLow', 'Phase Low'),
            ROOM_EQ_PHASE_LOW_MIN,
            ROOM_EQ_PHASE_LOW_MAX,
            1,
            this._phaseLowDisplayFrequency(),
            value => this.setParameters({ pl: value }),
            'Hz'
        );
        row.classList.add('room-eq-phase-low-row');
        const [slider, valueInput] = row.querySelectorAll('input');
        const autoLabel = document.createElement('label');
        autoLabel.className = 'room-eq-phase-low-auto';
        const auto = document.createElement('input');
        auto.type = 'checkbox';
        auto.id = `room-eq-phase-low-auto-${this.id}`;
        auto.name = auto.id;
        auto.autocomplete = 'off';
        auto.addEventListener('change', () => {
            this.setParameters({
                pa: auto.checked,
                ...(!auto.checked && { pl: Math.round(this._automaticPhaseLowFrequency()) })
            });
        });
        autoLabel.htmlFor = auto.id;
        autoLabel.append(
            auto,
            document.createTextNode(this._t('roomEq.option.auto', 'Auto'))
        );
        row.insertBefore(autoLabel, valueInput);
        this._phaseLowControl = { slider, valueInput, auto };
        slider.addEventListener('input', () => this._syncPhaseLowControl());
        valueInput.addEventListener('input', () => this._syncPhaseLowControl());
        this._syncPhaseLowControl();
        return row;
    }

    _renderReferencePoints(measurement, allowFallback = true) {
        const select = this._referencePointSelect;
        if (!select) return false;
        select.replaceChildren();
        const consensus = document.createElement('option');
        consensus.value = '0';
        consensus.textContent = this._t(
            'roomEq.reference.consensus',
            'Consensus (all points)'
        );
        select.appendChild(consensus);

        const validValues = new Set([0]);
        const points = Array.isArray(measurement?.points) ? measurement.points : [];
        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];
            const pointId = Number.isSafeInteger(point?.pointId) && point.pointId >= 0
                ? point.pointId
                : index;
            const value = pointId + 1;
            if (validValues.has(value)) continue;
            validValues.add(value);
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = typeof point?.name === 'string' && point.name.trim()
                ? point.name.trim()
                : this._t('roomEq.reference.point', 'Point {index}', { index: index + 1 });
            select.appendChild(option);
        }

        const fellBack = allowFallback && !validValues.has(this.rp);
        if (fellBack) this.rp = 0;
        select.value = validValues.has(this.rp) ? String(this.rp) : '0';
        return fellBack;
    }

    _syncCorrectionPreview() {
        const preview = this._lastDesign?.previews?.find(Boolean);
        this._additionalEqEditor?.syncBaseResponse(preview ? {
            frequencies: preview.frequencies,
            measuredDb: preview.measuredDb,
            correctionDb: preview.baseCorrectionDb,
            normalizationGainDb: preview.referenceLevelDb
        } : null);
    }

    async _getRuntime() {
        if (!this._runtimePromise) {
            this._runtimePromise = Promise.all([
                import('../../js/measurement-store/client.js'),
                import('../../js/room-eq/designer.js'),
                import('../../js/room-eq/design-core.js'),
                import('../../js/ir-library/ir-asset-payload.js'),
                import('../../js/ir-library/ir-plugin-contract.js')
            ]).then(([store, designer, design, payload, contract]) => ({
                ...store,
                ...designer,
                ...design,
                ...payload,
                ...contract
            }));
        }
        return this._runtimePromise;
    }

    async _getMeasurementStore(refresh = false) {
        const runtime = await this._getRuntime();
        if (this._disposed) return null;
        if (!this._measurementStore) {
            const openedStore = await runtime.openMeasurementStore();
            if (this._disposed) {
                await openedStore?.close?.();
                return null;
            }
            if (this._measurementStore) await openedStore?.close?.();
            else this._measurementStore = openedStore;
        }
        if (refresh) {
            const store = this._measurementStore;
            await store?.refresh();
            if (this._disposed || store !== this._measurementStore) return null;
        }
        return this._measurementStore;
    }

    async _sourcesFor(store, isCurrent = () => !this._disposed, measurementId = this.measurementId) {
        const measurement = measurementId ? await store?.getMeasurement(measurementId) : null;
        if (!isCurrent()) return null;
        const storedImpulses = measurement ? await store.getImpulseResponses(measurementId) : [];
        if (!isCurrent()) return null;
        const points = Array.isArray(measurement?.points) ? measurement.points : [];
        const impulsesByPoint = new Map((storedImpulses || []).map(impulse => [
            impulse?.pointId,
            impulse
        ]));
        const orderedImpulses = points.map(point => impulsesByPoint.get(point?.pointId));
        const hasCompleteImpulseSet = points.length > 0 && orderedImpulses.every(impulse =>
            ArrayBuffer.isView(impulse?.data) && impulse.data.BYTES_PER_ELEMENT === 4 &&
            impulse.data.length > 0
        );
        return {
            sources: [measurement ? {
                measurement,
                impulses: hasCompleteImpulseSet ? orderedImpulses : []
            } : null],
            resolved: Boolean(measurement?.averageFrequencyResponse?.length),
            supportsFullPhase: !measurementId || Boolean(measurement && hasCompleteImpulseSet)
        };
    }

    _rejectUnavailableFullPhase(resolved) {
        if (this._disposed) return false;
        this.measurementResolved = resolved;
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._lastDesign = null;
        this._syncCorrectionPreview();
        this._assetState = 0;
        this.clearWasmAsset(0);
        this._updatePowerGainBound(null);
        this.updateParameters();
        this._renderMeasurement();
        this._setStatus(this._t('roomEq.error.directPhaseRequiresIr',
            'Correction needs impulse-response data for the selected measurement. Choose Minimum or Linear, or select a measurement with IR data.'), 'error');
        return false;
    }

    _designConfig(sampleRate = this._sampleRate) {
        return {
            sampleRate,
            taps: this.tp,
            phase: this.pm,
            smoothing: this.sm,
            lowFrequency: this.fl,
            highFrequency: this.fh,
            directWindowMs: this.dw,
            phaseLowFrequency: this.pa ? null : this.pl,
            lowFrequencyPhaseExtension: this.pm === 'full' && this.le,
            maxBoostDb: this.mb,
            correctionAmount: this.cr / 100,
            phaseCorrectionAmount: this.pr / 100,
            referencePoint: this.rp,
            eqBands: this.eqBands.map(band => ({ ...band }))
        };
    }

    _scheduleDesign(delay = 150) {
        if (this._disposed) return;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        const generation = ++this._designGeneration;
        this._designPending = true;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this.updateParameters();
        this._setStatus(this._t('roomEq.status.designing', 'Designing correction filters…'), 'preparing');
        this._designTimer = setTimeout(() => {
            if (this._disposed || generation !== this._designGeneration) return;
            this._designTimer = null;
            this._designAndStage(generation);
        }, delay);
    }

    _settleMissingMeasurement(generation) {
        if (this._disposed || generation !== this._designGeneration) return false;
        this.measurementResolved = false;
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._lastDesign = null;
        this._syncCorrectionPreview();
        this._assetState = 0;
        this.clearWasmAsset(0);
        this._updatePowerGainBound(null);
        this.updateParameters();
        this._renderMeasurement();
        this._setStatus(this._t(
            'roomEq.measurement.missing',
            'Measurement not found: {name}',
            { name: this.measurementName || this.measurementId }
        ), 'warning');
        this._renderStatus();
        return false;
    }

    async _designAndStage(generation) {
        try {
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!this.measurementId) {
                if (this._disposed || generation !== this._designGeneration) return false;
                this.measurementResolved = false;
                this._designPending = false;
                this._designStaged = false;
                this._lastDesign = null;
                this._syncCorrectionPreview();
                this._assetState = 0;
                this.clearWasmAsset(0);
                this._updatePowerGainBound(null);
                this.updateParameters();
                this._renderMeasurement();
                this._setStatus(this._t('roomEq.status.select',
                    'Assign a saved measurement to begin.'), '');
                return true;
            }
            const runtime = await this._getRuntime();
            if (this._disposed || generation !== this._designGeneration) return false;
            const store = await this._getMeasurementStore(true);
            if (this._disposed || generation !== this._designGeneration) return false;
            if (!store) return this._settleMissingMeasurement(generation);
            const sourceState = await this._sourcesFor(
                store,
                () => !this._disposed && generation === this._designGeneration
            );
            if (this._disposed || generation !== this._designGeneration || !sourceState) return false;
            const { sources, resolved, supportsFullPhase } = sourceState;
            if (!resolved) return this._settleMissingMeasurement(generation);
            this.measurementResolved = resolved;
            if (this.pm === 'full' && supportsFullPhase !== true) {
                return this._rejectUnavailableFullPhase(resolved);
            }
            if (!this._designer) {
                const designer = runtime.createRoomEqDesigner();
                if (this._disposed || generation !== this._designGeneration) {
                    designer?.close?.();
                    return false;
                }
                this._designer = designer;
            }
            const designer = this._designer;
            const result = await designer.design(this._designConfig(), sources);
            if (this._disposed || generation !== this._designGeneration || designer !== this._designer) {
                return false;
            }
            if (this.pm === 'full' && result.supportsFullPhase !== true) {
                return this._rejectUnavailableFullPhase(resolved);
            }
            this._lastDesign = result;
            this._syncCorrectionPreview();
            if (!await this._stageDesign(result, generation)) return false;
            if (this._disposed || generation !== this._designGeneration) return false;
            this._renderMeasurement();
            const warning = this._qualityWarningForDesign(result);
            this._candidateWarning = warning ? this._qualityWarningMessage(warning) : null;
            this._setStatus(this._t('roomEq.status.designing', 'Designing correction filters…'),
                'preparing');
            return true;
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration) return false;
            console.error('Room EQ design failed:', error);
            this._designPending = false;
            this._designStaged = false;
            this.updateParameters();
            this._setStatus(this._t('roomEq.error.design',
                'The Room EQ filters could not be designed. Try fewer taps or reselect the measurements.'), 'error');
            return false;
        }
    }

    async _stageDesign(result, generation = this._designGeneration) {
        try {
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            this._designPending = true;
            this._designStaged = false;
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._assetState = 1;
            this.updateParameters();
            const runtime = await this._getRuntime();
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            const channels = runtime.selectedIrChannelCount(this.channel, this._outputChannelCount);
            const footprintBytes = runtime.estimateIrKernelCommitFootprint({
                frames: this.tp,
                assetChannels: 1,
                topology: runtime.IR_ASSET_TOPOLOGY.mono,
                processingChannels: channels,
                headBlock: Number(this.lt)
            });
            const operationRevision = this.setWasmAsset(0, {
                payload: result.payload,
                formatTag: 1,
                headBlock: Number(this.lt),
                rateDivider: 1,
                pathCount: 0,
                inputCount: 0,
                processingChannels: channels,
                footprintBytes,
                externalAssetSignature: this._externalAssetSignature()
            });
            if (this._disposed || generation !== this._designGeneration || result !== this._lastDesign) {
                return false;
            }
            this._candidateAssetRevision = operationRevision;
            this._updatePowerGainBound(result.payload, channels);
            this._renderStatus();
            return true;
        } catch (error) {
            if (this._disposed || generation !== this._designGeneration) return false;
            console.error('Room EQ asset staging failed:', error);
            this._designPending = false;
            this._designStaged = false;
            this._candidateAssetRevision = null;
            this.updateParameters();
            this._setStatus(this._t('roomEq.error.design',
                'The Room EQ filters could not be designed. Try fewer taps or reselect the measurements.'), 'error');
            return false;
        }
    }

    _externalAssetSignature({ sampleRate = this._sampleRate, outputChannelCount = this._outputChannelCount } = {}) {
        return JSON.stringify([
            1, this.measurementId, this._designConfig(sampleRate), this.lt, this.channel, outputChannelCount
        ]);
    }

    _updatePowerGainBound(payload = this._lastDesign?.payload) {
        if (!(payload instanceof ArrayBuffer) || payload.byteLength < 32 + this.tp * 4) {
            this.powerGainUpperBoundDb = this.gn;
            return;
        }
        const samples = new Float32Array(payload, 32);
        let sum = 0;
        for (let index = 0; index < this.tp; index += 1) {
            const value = samples[index];
            sum += value < 0 ? -value : value;
        }
        this.powerGainUpperBoundDb = this.gn + 20 * Math.log10(sum > 1 ? sum : 1);
    }

    get externalAssetInfo() {
        if (!this.measurementId) return null;
        return {
            missing: !this.measurementResolved,
            pending: this._designPending,
            ids: [this.measurementId],
            names: [this.measurementName || 'Measurement'],
            kind: 'Measurement',
            assetSignature: this._externalAssetSignature()
        };
    }

    get offlineDspAssetRequired() {
        return this.isOfflineDspAssetRequired();
    }

    isOfflineDspAssetRequired() {
        return Boolean(this.measurementId);
    }

    _offlineStaleError() {
        const error = new Error('Room EQ settings changed during offline filter preparation.');
        error.userMessageKey = this.offlineDspAssetErrorMessageKey;
        return error;
    }

    async resolveOfflineDspAssetRequirement({ isCurrent = () => true } = {}) {
        const generation = this._designGeneration;
        const measurementId = this.measurementId;
        const operationCurrent = () => !this._disposed && isCurrent() &&
            generation === this._designGeneration;
        if (!operationCurrent()) throw this._offlineStaleError();
        if (!measurementId) {
            return { required: false, generation, measurementId, sourceState: null };
        }
        const store = await this._getMeasurementStore(true);
        if (!operationCurrent()) throw this._offlineStaleError();
        if (!store) {
            return { required: false, generation, measurementId, sourceState: null };
        }
        const sourceState = await this._sourcesFor(store, operationCurrent, measurementId);
        if (!operationCurrent() || !sourceState) throw this._offlineStaleError();
        return {
            required: sourceState.resolved === true,
            generation,
            measurementId,
            sourceState
        };
    }

    async createOfflineDspState({
        sampleRate,
        outputChannelCount,
        isCurrent = () => true,
        offlineDspAssetRequirement = null
    } = {}) {
        const snapshot = {
            generation: this._designGeneration,
            measurementId: this.measurementId,
            config: this._designConfig(sampleRate),
            latency: this.lt,
            channel: this.channel,
            delayMs: this.delayMs,
            gainDb: this.gn,
            baseParameters: { ...super.getParameters() }
        };
        const operationCurrent = () => !this._disposed && isCurrent() &&
            snapshot.generation === this._designGeneration;
        const parametersFor = () => ({
            ...snapshot.baseParameters,
            lt: snapshot.latency,
            fd: snapshot.config.phase === 'min' ? 0 : snapshot.config.taps / 2,
            gn: snapshot.gainDb,
            dy: Math.round(snapshot.delayMs * sampleRate / 1000)
        });
        const bypassState = () => ({
            parameters: parametersFor(),
            assets: new Map(),
            offlineDspAssetRequired: false
        });
        if (!operationCurrent()) throw this._offlineStaleError();
        const requirement = offlineDspAssetRequirement ||
            await this.resolveOfflineDspAssetRequirement({ isCurrent: operationCurrent });
        if (!operationCurrent() || requirement.generation !== snapshot.generation ||
            requirement.measurementId !== snapshot.measurementId) {
            throw this._offlineStaleError();
        }
        if (requirement.required !== true) return bypassState();
        const { sources, supportsFullPhase } = requirement.sourceState;
        const runtime = await this._getRuntime();
        if (!operationCurrent()) throw this._offlineStaleError();
        if (snapshot.config.phase === 'full' && supportsFullPhase !== true) {
            const error = new Error(
                'Correction needs impulse-response data for the selected measurement.'
            );
            error.userMessageKey = 'roomEq.error.directPhaseRequiresIr';
            throw error;
        }
        const designer = runtime.createRoomEqDesigner();
        let designed;
        try {
            designed = await designer.design(snapshot.config, sources);
        } finally {
            designer.close();
        }
        if (!operationCurrent()) throw this._offlineStaleError();
        if (snapshot.config.phase === 'full' && designed.supportsFullPhase !== true) {
            const error = new Error(
                'Correction design did not have impulse-response data for the selected measurement.'
            );
            error.userMessageKey = 'roomEq.error.directPhaseRequiresIr';
            throw error;
        }
        const processingChannels = runtime.selectedIrChannelCount(snapshot.channel, outputChannelCount);
        const footprintBytes = runtime.estimateIrKernelCommitFootprint({
            frames: snapshot.config.taps,
            assetChannels: 1,
            topology: runtime.IR_ASSET_TOPOLOGY.mono,
            processingChannels,
            headBlock: Number(snapshot.latency)
        });
        return {
            parameters: parametersFor(),
            assets: new Map([[0, {
                payload: designed.payload,
                formatTag: 1,
                headBlock: Number(snapshot.latency),
                rateDivider: 1,
                pathCount: 0,
                inputCount: 0,
                processingChannels,
                footprintBytes,
                warmupSamples: Number(snapshot.latency) +
                    (snapshot.config.phase === 'min' ? 0 : snapshot.config.taps / 2),
                externalAssetSignature: JSON.stringify([
                    1,
                    snapshot.measurementId,
                    snapshot.config,
                    snapshot.latency,
                    snapshot.channel,
                    outputChannelCount
                ])
            }]]),
            offlineDspAssetRequired: true
        };
    }

    onWasmAssetState(slot, state, operationRevision) {
        if (this._disposed || slot !== 0 || !this._isCurrentWasmAssetOperation(slot, operationRevision)) {
            return;
        }
        const status = state & 0xff;
        const isCandidate = operationRevision === this._candidateAssetRevision;
        const isEffective = operationRevision === this._effectiveAssetRevision;
        if ((!isCandidate && status !== 4) || (!isCandidate && !isEffective)) return;
        this._assetState = status;
        if (status === 3) {
            this._designPending = false;
            this._designStaged = true;
            this._effectiveAssetRevision = operationRevision;
            this._candidateAssetRevision = null;
            this.updateParameters();
            this._setStatus(this._candidateWarning ||
                this._t('roomEq.status.ready', 'Room EQ filters are ready.'),
            this._candidateWarning ? 'warning' : 'ready');
            this._candidateWarning = null;
        } else if (status === 4) {
            this._designPending = false;
            this._designStaged = false;
            this._candidateAssetRevision = null;
            this._effectiveAssetRevision = null;
            this._candidateWarning = null;
            this.updateParameters();
            this._setStatus(this._t('roomEq.error.design',
                'The Room EQ filters could not be prepared. Try fewer taps or a higher latency.'), 'error');
        }
        this._renderStatus();
    }

    onWasmAssetRejected(slot, reason, operationRevision) {
        if (this._disposed || slot !== 0 || operationRevision !== this._candidateAssetRevision) return;
        console.warn('Room EQ asset admission rejected:', reason);
        this._designPending = false;
        this._designStaged = false;
        this._candidateAssetRevision = null;
        this._effectiveAssetRevision = null;
        this._candidateWarning = null;
        this._assetState = 4;
        this.updateParameters();
        this._setStatus(this._t('roomEq.error.design',
            'The Room EQ filters could not be prepared. Try fewer taps or a higher latency.'), 'error');
        this._renderStatus();
    }

    onMessage(message) {
        if (this._disposed || message.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const messages = {
            unsupportedSampleRate: ['roomEq.error.unsupportedSampleRate',
                'This sample rate is not supported. Room EQ is bypassed.'],
            wasmUnavailable: ['roomEq.error.wasmUnavailable',
                'WASM audio processing is unavailable. Room EQ is bypassed.'],
            rolloutDisabled: ['roomEq.error.rolloutDisabled',
                'DSP processing is disabled. Room EQ is bypassed.'],
            runtimeFallback: ['roomEq.error.runtimeFallback',
                'Audio processing was interrupted. Room EQ is bypassed.']
        };
        const entry = messages[this.executionState.reason];
        return entry ? this._t(entry[0], entry[1]) : '';
    }

    async _refreshMeasurements(scheduleDesign = false) {
        if (this._disposed) return;
        const store = await this._getMeasurementStore(true);
        if (this._disposed) return;
        await this._renderMeasurement();
        if (this._disposed) return;
        if (store && scheduleDesign && this.measurementId) this._scheduleDesign(0);
    }

    _setStatus(message, state = '') {
        if (this._disposed) return;
        this._statusMessage = message;
        this._statusState = state;
        this._renderStatusMessage();
    }

    _renderStatusMessage() {
        if (this._disposed) return;
        if (this._statusElement) {
            const executionMessage = this._executionStatusText();
            this._statusElement.textContent = executionMessage || this._statusMessage || '';
            this._statusElement.dataset.state = executionMessage ? 'error' : this._statusState || '';
        }
    }

    _renderStatus() {
        if (this._disposed || !this._latencyElement) return;
        const hasFilter = Boolean(this._lastDesign) && Boolean(this.measurementId);
        const samples = hasFilter ? Number(this.lt) + (this.pm === 'min' ? 0 : this.tp / 2) : 0;
        const milliseconds = samples * 1000 / this._sampleRate;
        const assetLabels = ['bypass', 'staged', 'preparing', 'active', 'error'];
        this._latencyElement.textContent = this._t(
            'roomEq.status.details',
            '{samples} samples / {milliseconds} ms · {resolution} Hz · {asset}',
            {
                samples,
                milliseconds: milliseconds.toFixed(1),
                resolution: (this._sampleRate / this.tp).toFixed(1),
                asset: assetLabels[this._assetState] || 'bypass'
            }
        );
    }

    async _renderMeasurement() {
        const row = this._measurementRow;
        if (this._disposed || !row) return;
        const store = await this._getMeasurementStore();
        if (this._disposed || row !== this._measurementRow) return;
        const measurements = store?.listMeasurements?.() || [];
        const selected = this.measurementId;
        const selectedMeasurement = selected && typeof store?.getMeasurement === 'function'
            ? await store.getMeasurement(selected)
            : null;
        if (this._disposed || row !== this._measurementRow || this.measurementId !== selected) return;
        row.select.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = this._t('roomEq.measurement.none', 'No measurement');
        row.select.appendChild(empty);
        for (const measurement of measurements) {
            const option = document.createElement('option');
            option.value = measurement.id;
            option.textContent = `${measurement.name} · ${measurement.pointCount} pt${measurement.hasIr ? ' · IR' : ''}`;
            row.select.appendChild(option);
        }
        row.select.value = selected;
        if (selected && !measurements.some(measurement => measurement.id === selected)) {
            const missing = document.createElement('option');
            missing.value = selected;
            missing.textContent = this._t('roomEq.measurement.missing', 'Measurement not found: {name}', {
                name: this.measurementName || selected
            });
            row.select.appendChild(missing);
            row.select.value = selected;
        }
        row.status.textContent = !selected ? '—' : this.measurementResolved ? 'OK' :
            this._t('roomEq.status.missing', 'Missing');
        row.status.dataset.state = selected && !this.measurementResolved ? 'warning' : 'ready';
        if (this._renderReferencePoints(selectedMeasurement)) {
            this.updateParameters();
            if (selected) this._scheduleDesign(0);
        }
    }

    _createResponseViewControls(editor) {
        const graph = editor?.graphContainer;
        if (!graph) return;
        const controls = document.createElement('div');
        controls.className = 'room-eq-response-view-controls';
        controls.setAttribute('role', 'radiogroup');
        controls.setAttribute('aria-label', this._t('roomEq.graph.view', 'Response graph'));
        const inputs = {};
        for (const option of [
            {
                value: 'frequency',
                label: this._t('roomEq.graph.frequency', 'Frequency')
            },
            {
                value: 'phase',
                label: this._t('roomEq.graph.phase', 'Phase')
            },
            {
                value: 'groupDelay',
                label: this._t('roomEq.graph.groupDelay', 'Group Delay')
            },
            {
                value: 'impulse',
                label: this._t('roomEq.graph.impulse', 'Impulse')
            }
        ]) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `room-eq-response-view-${this.id}`;
            input.value = option.value;
            input.checked = this._responseView === option.value;
            input.autocomplete = 'off';
            input.addEventListener('change', () => {
                if (input.checked) this._setResponseView(option.value);
            });
            label.append(input, document.createTextNode(option.label));
            controls.appendChild(label);
            inputs[option.value] = input;
        }

        const overlays = {
            phase: this._createResponseOverlay(
                'room-eq-phase',
                this._t('roomEq.graph.phaseResponse', 'Phase Response'),
                this._t(
                    'roomEq.graph.phaseUnavailable',
                    'Phase data is unavailable because this measurement has no impulse response.'
                )
            ),
            groupDelay: this._createResponseOverlay(
                'room-eq-group-delay',
                this._t('roomEq.graph.groupDelayResponse', 'Group Delay Response'),
                this._t(
                    'roomEq.graph.groupDelayUnavailable',
                    'Group delay is unavailable because this measurement has no impulse response.'
                )
            ),
            impulse: this._createResponseOverlay(
                'room-eq-impulse',
                this._t('roomEq.graph.impulseResponse', 'Impulse Response'),
                this._t(
                    'roomEq.graph.impulseUnavailable',
                    'Impulse-response data is unavailable for this measurement.'
                )
            )
        };

        const hoverOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        hoverOverlay.setAttribute('class', 'room-eq-hover-overlay');
        hoverOverlay.setAttribute('width', '100%');
        hoverOverlay.setAttribute('height', '100%');
        hoverOverlay.setAttribute('preserveAspectRatio', 'none');

        const legend = document.createElement('div');
        legend.className = 'room-eq-response-legend';
        const cursorReadout = document.createElement('span');
        cursorReadout.className = 'room-eq-response-legend-cursor';
        legend.appendChild(cursorReadout);
        const legendItems = [];
        for (const { className, labelText, views } of [
            {
                className: 'room-eq-response-legend-room',
                labelText: 'Room EQ',
                views: { frequency: { selector: '.room-eq-base-response-path' } }
            },
            {
                className: 'room-eq-response-legend-total',
                labelText: 'Total EQ',
                views: { frequency: { selector: '.room-eq-combined-response-path' } }
            },
            {
                className: 'room-eq-response-legend-before',
                labelText: 'Before',
                views: {
                    frequency: { selector: '.room-eq-measured-response-path' },
                    phase: {
                        selector: '.room-eq-phase-before',
                        hidden: '.room-eq-phase-after'
                    },
                    groupDelay: {
                        selector: '.room-eq-group-delay-before',
                        hidden: '.room-eq-group-delay-after'
                    },
                    impulse: {
                        selector: '.room-eq-impulse-before',
                        hidden: '.room-eq-impulse-after'
                    }
                }
            },
            {
                className: 'room-eq-response-legend-after',
                labelText: 'After',
                views: {
                    frequency: { selector: '.room-eq-corrected-response-path' },
                    phase: { selector: '.room-eq-phase-after' },
                    groupDelay: { selector: '.room-eq-group-delay-after' },
                    impulse: { selector: '.room-eq-impulse-after' }
                }
            }
        ]) {
            const item = document.createElement('span');
            item.className = `room-eq-response-legend-item ${className}`;
            const swatch = document.createElement('span');
            swatch.className = 'room-eq-response-legend-swatch';
            swatch.setAttribute('aria-hidden', 'true');
            const value = document.createElement('span');
            value.className = 'room-eq-response-legend-value';
            item.append(swatch, document.createTextNode(labelText), value);
            legendItems.push({ views, value });
            const emphasis = { restore: null };
            item.addEventListener('mouseenter', () => {
                emphasis.restore?.();
                const view = this._responseView;
                const container = overlays[view]?.response || editor.responseSvg;
                const selector = views[view]?.selector || null;
                const hiddenSelector = views[view]?.hidden || null;
                emphasis.restore = this._emphasizeResponsePath(
                    container,
                    selector,
                    hiddenSelector
                );
                if (hiddenSelector) {
                    this._beforeLegendHover = {
                        owner: item,
                        view,
                        container,
                        selector,
                        hiddenSelector,
                        emphasis
                    };
                }
            });
            item.addEventListener('mouseleave', () => {
                emphasis.restore?.();
                emphasis.restore = null;
                if (this._beforeLegendHover?.owner === item) {
                    this._beforeLegendHover = null;
                }
            });
            legend.appendChild(item);
        }

        for (const overlay of Object.values(overlays)) {
            graph.append(overlay.grid, overlay.response, overlay.unavailable);
        }
        graph.append(hoverOverlay, legend, controls);
        this._responseViewElements = {
            graph,
            controls,
            legend,
            inputs,
            overlays,
            hoverOverlay,
            cursorReadout,
            legendItems
        };
        this._bindResponseHover(graph);
        this._setResponseView(this._responseView);
    }

    _bindResponseHover(graph) {
        this._responseHoverCleanup?.();
        const move = event => this._updateResponseHover(event);
        const leave = () => this._clearResponseHover();
        graph.addEventListener('mousemove', move);
        graph.addEventListener('mouseleave', leave);
        this._responseHoverCleanup = () => {
            graph.removeEventListener('mousemove', move);
            graph.removeEventListener('mouseleave', leave);
        };
    }

    _responseHoverContainer(view) {
        return view === 'frequency'
            ? this._additionalEqEditor?.responseSvg
            : this._responseViewElements?.overlays?.[view]?.response;
    }

    // Reads the drawn polyline so every view shares one readout path, whatever the
    // curve was built from.
    _pathValueAtX(path, x) {
        let points = this._pathPointCache.get(path);
        if (!points) {
            points = [];
            for (const [, pointX, pointY] of
                (path.getAttribute('d') || '').matchAll(
                    /[ML] (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g
                )) {
                points.push([Number(pointX), Number(pointY)]);
            }
            this._pathPointCache.set(path, points);
        }
        if (points.length < 2 || x < points[0][0] ||
            x > points[points.length - 1][0]) {
            return null;
        }
        let low = 0;
        let high = points.length - 1;
        while (high - low > 1) {
            const middle = (low + high) >> 1;
            if (points[middle][0] <= x) low = middle;
            else high = middle;
        }
        const span = points[high][0] - points[low][0];
        return span > 0
            ? points[low][1] +
                (x - points[low][0]) / span * (points[high][1] - points[low][1])
            : points[low][1];
    }

    _formatHoverFrequency(x, width) {
        const frequency = this._additionalEqEditor.xToFreq(x / width * 100);
        return frequency >= 1000
            ? `${(frequency / 1000).toFixed(2)} kHz`
            : `${frequency.toFixed(0)} Hz`;
    }

    _formatHoverCursor(view, x, width) {
        if (view !== 'impulse') return this._formatHoverFrequency(x, width);
        const axis = this._impulseTimeAxis;
        if (!axis) return '';
        const time = axis.startMs + x / width * (axis.durationMs - axis.startMs);
        return `${time.toFixed(2)} ms`;
    }

    _formatHoverValue(view, y, height) {
        const position = y / height;
        if (view === 'frequency') {
            return `${this._additionalEqEditor.yToGain(position * 100).toFixed(1)} dB`;
        }
        if (view === 'phase') return `${(180 - position * 360).toFixed(0)}°`;
        if (view === 'groupDelay') {
            const limit = this._groupDelayAxisLimit;
            return `${(limit - position * 2 * limit).toFixed(2)} ms`;
        }
        return ((0.5 - position) * 2).toFixed(2);
    }

    _updateResponseHover(event) {
        const elements = this._responseViewElements;
        if (!elements) return;
        const view = this._responseView;
        const container = this._responseHoverContainer(view);
        const width = container?.clientWidth;
        const height = container?.clientHeight;
        const rect = container?.getBoundingClientRect?.();
        if (!width || !height || !rect) return this._clearResponseHover();
        const x = event.clientX - rect.left;
        if (!(x >= 0 && x <= width)) return this._clearResponseHover();
        const { hoverOverlay } = elements;
        hoverOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
        hoverOverlay.replaceChildren();
        elements.cursorReadout.textContent = this._formatHoverCursor(view, x, width);
        for (const { views, value } of elements.legendItems) {
            const selector = views[view]?.selector;
            const matched = selector ? container.querySelector(selector) : null;
            // A legend hover hides the competing curve; a hidden curve reads as absent.
            const path = matched?.classList?.contains?.(ROOM_EQ_RESPONSE_HIDDEN_CLASS)
                ? null
                : matched;
            const y = path ? this._pathValueAtX(path, x) : null;
            value.textContent = y === null ? '' : this._formatHoverValue(view, y, height);
            if (y === null) continue;
            const dot = this._appendResponseSvgElement(hoverOverlay, 'circle', {
                class: 'room-eq-hover-dot',
                cx: x.toFixed(2),
                cy: y.toFixed(2),
                r: 3.5
            });
            const stroke = path.getAttribute('stroke') ||
                globalThis.getComputedStyle?.(path)?.stroke;
            if (stroke) dot.setAttribute('fill', stroke);
        }
    }

    _clearResponseHover() {
        const elements = this._responseViewElements;
        if (!elements) return;
        elements.hoverOverlay.replaceChildren();
        elements.cursorReadout.textContent = '';
        for (const { value } of elements.legendItems) value.textContent = '';
    }

    _createResponseOverlay(className, ariaLabel, unavailableText) {
        const grid = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        grid.setAttribute('class', `${className}-grid`);
        grid.setAttribute('width', '100%');
        grid.setAttribute('height', '100%');
        const response = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        response.setAttribute('class', `${className}-response`);
        response.setAttribute('width', '100%');
        response.setAttribute('height', '100%');
        response.setAttribute('preserveAspectRatio', 'none');
        response.setAttribute('aria-label', ariaLabel);
        const unavailable = document.createElement('div');
        unavailable.className = `${className}-unavailable`;
        unavailable.textContent = unavailableText;
        return { grid, response, unavailable };
    }

    _setResponseView(view) {
        this._responseView = ['frequency', 'phase', 'groupDelay', 'impulse'].includes(view)
            ? view
            : 'frequency';
        const elements = this._responseViewElements;
        if (!elements) return;
        elements.graph.classList.toggle(
            'room-eq-phase-view',
            this._responseView === 'phase'
        );
        elements.graph.classList.toggle(
            'room-eq-group-delay-view',
            this._responseView === 'groupDelay'
        );
        elements.graph.classList.toggle(
            'room-eq-impulse-view',
            this._responseView === 'impulse'
        );
        for (const [value, input] of Object.entries(elements.inputs)) {
            input.checked = value === this._responseView;
        }
        this._clearResponseHover();
        if (this._responseView === 'phase') this._drawPhaseResponse();
        else if (this._responseView === 'groupDelay') this._drawGroupDelayResponse();
        else if (this._responseView === 'impulse') this._drawImpulseResponse();
        else {
            this._additionalEqEditor?.updateMarkers();
            this._additionalEqEditor?.updateResponse();
        }
    }

    _appendResponseSvgElement(parent, name, attributes, text = '') {
        const element = document.createElementNS('http://www.w3.org/2000/svg', name);
        for (const [key, value] of Object.entries(attributes)) {
            element.setAttribute(key, String(value));
        }
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    _emphasizeResponsePath(container, selector, hiddenSelector = null) {
        const path = selector ? container?.querySelector?.(selector) : null;
        if (!path) return null;
        const hiddenPath = hiddenSelector
            ? container.querySelector(hiddenSelector)
            : null;
        const originalNextSibling = path.nextSibling;
        path.classList.add('room-eq-response-highlighted');
        hiddenPath?.classList.add(ROOM_EQ_RESPONSE_HIDDEN_CLASS);
        container.appendChild(path);
        return () => {
            path.classList.remove('room-eq-response-highlighted');
            hiddenPath?.classList.remove(ROOM_EQ_RESPONSE_HIDDEN_CLASS);
            if (path.parentNode !== container) return;
            if (originalNextSibling?.parentNode === container) {
                container.insertBefore(path, originalNextSibling);
            } else {
                container.appendChild(path);
            }
        };
    }

    _applyBeforeLegendHover(view, container = null) {
        const hover = this._beforeLegendHover;
        if (!hover || hover.view !== view ||
            (container && hover.container !== container)) {
            return;
        }
        hover.emphasis.restore?.();
        hover.emphasis.restore = this._emphasizeResponsePath(
            hover.container,
            hover.selector,
            hover.hiddenSelector
        );
    }

    _frequencyCurvePath(frequencies, values, width, height, limit, breakStep = 0) {
        if (!frequencies?.length || frequencies.length !== values?.length ||
            width <= 0 || height <= 0) {
            return '';
        }
        const path = [];
        let previousValue = null;
        for (let index = 0; index < values.length; index += 1) {
            const frequency = frequencies[index];
            const value = values[index];
            if (!Number.isFinite(frequency) || !Number.isFinite(value)) {
                previousValue = null;
                continue;
            }
            const boundedValue = value < -limit ? -limit : value > limit ? limit : value;
            const x = this._additionalEqEditor.freqToX(frequency) * width / 100;
            const y = (limit - boundedValue) / (2 * limit) * height;
            const command = previousValue === null || (breakStep > 0 &&
                Math.abs(boundedValue - previousValue) > breakStep) ? 'M' : 'L';
            path.push(`${command} ${x.toFixed(2)},${y.toFixed(2)}`);
            previousValue = boundedValue;
        }
        return path.join(' ');
    }

    _phasePath(frequencies, phases, width, height) {
        return this._frequencyCurvePath(frequencies, phases, width, height, 180, 180);
    }

    // Prepares a frequency-axis overlay and returns its pixel size, or null when the
    // graph is not laid out yet.
    _prepareFrequencyGraph(view) {
        const overlay = this._responseViewElements?.overlays?.[view];
        if (!overlay) return null;
        const { grid, response } = overlay;
        const width = response.clientWidth;
        const height = response.clientHeight;
        if (!width || !height) return null;
        grid.replaceChildren();
        response.replaceChildren();
        this._applyBeforeLegendHover(view, response);
        grid.setAttribute('viewBox', `0 0 ${width} ${height}`);
        grid.setAttribute('preserveAspectRatio', 'none');
        response.setAttribute('viewBox', `0 0 ${width} ${height}`);
        for (const frequency of ROOM_EQ_GRAPH_FREQUENCY_TICKS) {
            const x = this._additionalEqEditor.freqToX(frequency) * width / 100;
            this._appendResponseSvgElement(grid, 'line', {
                x1: x,
                x2: x,
                y1: 0,
                y2: height
            });
            this._appendResponseSvgElement(grid, 'text', {
                x,
                y: height - 4,
                'text-anchor': 'middle'
            }, frequency >= 1000 ? `${frequency / 1000}k` : String(frequency));
        }
        return { ...overlay, width, height };
    }

    _appendVerticalAxis(grid, width, height, limit, values, format) {
        for (const value of values) {
            const y = (limit - value) / (2 * limit) * height;
            this._appendResponseSvgElement(grid, 'line', {
                x1: 0,
                x2: width,
                y1: y,
                y2: y
            });
            this._appendResponseSvgElement(grid, 'text', {
                x: 2,
                y: value === limit ? 5 : value === -limit ? height - 5 : y,
                'dominant-baseline': 'middle'
            }, format(value));
        }
    }

    _drawPhaseResponse() {
        if (this._responseView !== 'phase') return;
        const graph = this._prepareFrequencyGraph('phase');
        if (!graph) return;
        const { grid, response, unavailable, width, height } = graph;
        this._appendVerticalAxis(grid, width, height, 180,
            [180, 90, 0, -90, -180], value => `${value}°`);

        const preview = this._lastDesign?.previews?.find(Boolean);
        const phasePreview = preview?.phaseResponse;
        const hasPreview = preview?.frequencies?.length > 1 &&
            preview.frequencies.length === phasePreview?.before?.length &&
            phasePreview.before.length === phasePreview.after?.length;
        unavailable.hidden = hasPreview;
        if (!hasPreview) return;
        for (const [phases, className] of [
            [phasePreview.before, 'room-eq-phase-before'],
            [phasePreview.after, 'room-eq-phase-after']
        ]) {
            const pathData = this._phasePath(
                preview.frequencies,
                phases,
                width,
                height
            );
            if (!pathData) continue;
            this._appendResponseSvgElement(response, 'path', {
                d: pathData,
                class: className
            });
        }
        this._applyBeforeLegendHover('phase', response);
    }

    // Group delay spans differ by orders of magnitude between measurements, so the
    // axis is scaled to a round limit that covers all but the sharpest excursions.
    _groupDelayLimit(curves) {
        const magnitudes = [];
        for (const values of curves) {
            for (const value of values) {
                if (Number.isFinite(value)) magnitudes.push(value < 0 ? -value : value);
            }
        }
        if (!magnitudes.length) return ROOM_EQ_GROUP_DELAY_LIMITS_MS[0];
        magnitudes.sort((first, second) => first - second);
        const bound = magnitudes[Math.min(
            magnitudes.length - 1,
            Math.floor(magnitudes.length * 0.95)
        )];
        return ROOM_EQ_GROUP_DELAY_LIMITS_MS.find(limit => limit >= bound) ||
            ROOM_EQ_GROUP_DELAY_LIMITS_MS[ROOM_EQ_GROUP_DELAY_LIMITS_MS.length - 1];
    }

    _drawGroupDelayResponse() {
        if (this._responseView !== 'groupDelay') return;
        const graph = this._prepareFrequencyGraph('groupDelay');
        if (!graph) return;
        const { grid, response, unavailable, width, height } = graph;
        const preview = this._lastDesign?.previews?.find(Boolean);
        const groupDelayPreview = preview?.groupDelayResponse;
        const hasPreview = preview?.frequencies?.length > 1 &&
            preview.frequencies.length === groupDelayPreview?.before?.length &&
            groupDelayPreview.before.length === groupDelayPreview.after?.length;
        const limit = hasPreview
            ? this._groupDelayLimit([groupDelayPreview.before, groupDelayPreview.after])
            : ROOM_EQ_GROUP_DELAY_LIMITS_MS[0];
        this._groupDelayAxisLimit = limit;
        this._appendVerticalAxis(grid, width, height, limit,
            [limit, limit / 2, 0, -limit / 2, -limit],
            value => `${Number(value.toFixed(1))} ms`);
        unavailable.hidden = hasPreview;
        if (!hasPreview) return;
        for (const [delays, className] of [
            [groupDelayPreview.before, 'room-eq-group-delay-before'],
            [groupDelayPreview.after, 'room-eq-group-delay-after']
        ]) {
            const pathData = this._frequencyCurvePath(
                preview.frequencies,
                delays,
                width,
                height,
                limit
            );
            if (!pathData) continue;
            this._appendResponseSvgElement(response, 'path', {
                d: pathData,
                class: className
            });
        }
        this._applyBeforeLegendHover('groupDelay', response);
    }

    _waveformPath(samples, width, height, peak, left = 0) {
        if (!samples?.length || width <= 0 || height <= 0 || peak <= 0) return '';
        const yFor = value => (height * (0.5 - value / (2 * peak))).toFixed(2);
        const plotWidth = Math.max(0, width - left);
        const columns = Math.max(1, Math.floor(width));
        if (samples.length <= columns * 2) {
            return Array.from(samples, (value, index) => {
                const x = samples.length === 1
                    ? left
                    : left + index * plotWidth / (samples.length - 1);
                return `${index ? 'L' : 'M'} ${x.toFixed(2)},${yFor(value)}`;
            }).join(' ');
        }
        const points = [];
        for (let column = 0; column < columns; column += 1) {
            const start = Math.floor(column * samples.length / columns);
            const end = Math.max(start + 1,
                Math.floor((column + 1) * samples.length / columns));
            let minimum = samples[start];
            let maximum = samples[start];
            let minimumIndex = start;
            let maximumIndex = start;
            for (let index = start + 1; index < end; index += 1) {
                const value = samples[index];
                if (value < minimum) {
                    minimum = value;
                    minimumIndex = index;
                }
                if (value > maximum) {
                    maximum = value;
                    maximumIndex = index;
                }
            }
            const x = columns === 1
                ? left
                : left + column * plotWidth / (columns - 1);
            const ordered = minimumIndex < maximumIndex
                ? [minimum, maximum]
                : [maximum, minimum];
            for (const value of ordered) {
                points.push(`${points.length ? 'L' : 'M'} ${x.toFixed(2)},${yFor(value)}`);
            }
        }
        return points.join(' ');
    }

    _impulseTimeTicks(startMs, endMs) {
        const spanMs = endMs - startMs;
        const intervals = [0.5, 1, 5, 10];
        const interval = intervals.find(value => spanMs / value <= 10) ||
            intervals[intervals.length - 1];
        const ticks = [];
        const firstTick = Math.floor(startMs / interval) + 1;
        for (let index = firstTick; index * interval < endMs; index += 1) {
            ticks.push(index * interval);
        }
        return { interval, ticks };
    }

    _drawImpulseResponse() {
        const overlay = this._responseViewElements?.overlays?.impulse;
        if (!overlay || this._responseView !== 'impulse') return;
        const { grid: impulseGrid, response: impulseResponse, unavailable } = overlay;
        const width = impulseResponse.clientWidth;
        const height = impulseResponse.clientHeight;
        if (!width || !height) return;
        impulseGrid.replaceChildren();
        impulseResponse.replaceChildren();
        this._applyBeforeLegendHover('impulse', impulseResponse);
        impulseGrid.setAttribute('viewBox', `0 0 ${width} ${height}`);
        impulseGrid.setAttribute('preserveAspectRatio', 'none');
        impulseResponse.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const preview = this._lastDesign?.previews?.find(Boolean)?.impulseResponse;
        const startMs = preview?.startMs ?? -2;
        const durationMs = preview?.durationMs || Math.max(5, this.dw);
        this._impulseTimeAxis = { startMs, durationMs };
        const timePlotLeft = 0;
        const timePlotWidth = width - timePlotLeft;
        const timeToX = time =>
            timePlotLeft + (time - startMs) / (durationMs - startMs) * timePlotWidth;
        const { interval: timeTickInterval, ticks: timeTicks } =
            this._impulseTimeTicks(startMs, durationMs);
        for (let index = 0; index < timeTicks.length; index += 1) {
            const time = timeTicks[index];
            const x = timeToX(time);
            this._appendResponseSvgElement(impulseGrid, 'line', {
                x1: x,
                x2: x,
                y1: 0,
                y2: height
            });
            const digits = timeTickInterval < 1 ? 1 : 0;
            this._appendResponseSvgElement(impulseGrid, 'text', {
                x,
                y: height - 4,
                'text-anchor': 'middle'
            }, `${time.toFixed(digits)}${index === timeTicks.length - 1 ? ' ms' : ''}`);
        }
        for (const [value, label] of [[0.25, '0.5'], [0.5, '0'], [0.75, '-0.5']]) {
            const y = value * height;
            this._appendResponseSvgElement(impulseGrid, 'line', {
                x1: 0,
                x2: width,
                y1: y,
                y2: y
            });
            this._appendResponseSvgElement(impulseGrid, 'text', {
                x: 2,
                y,
                'dominant-baseline': 'middle'
            }, label);
        }

        const hasPreview = preview?.before?.length > 1 &&
            preview.before.length === preview.after?.length;
        unavailable.hidden = hasPreview;
        if (!hasPreview) return;
        let peak = 0;
        for (const samples of [preview.before, preview.after]) {
            for (const value of samples) {
                const magnitude = value < 0 ? -value : value;
                if (magnitude > peak) peak = magnitude;
            }
        }
        peak = peak > 1e-12 ? peak : 1;
        for (const [samples, className] of [
            [preview.before, 'room-eq-impulse-before'],
            [preview.after, 'room-eq-impulse-after']
        ]) {
            const pathData = this._waveformPath(
                samples,
                width,
                height,
                peak,
                timePlotLeft
            );
            if (!pathData) continue;
            this._appendResponseSvgElement(impulseResponse, 'path', {
                d: pathData,
                class: className
            });
        }
        this._applyBeforeLegendHover('impulse', impulseResponse);
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui room-eq-ui';
        const measurementRow = document.createElement('div');
        measurementRow.className = 'parameter-row room-eq-measurement-row';
        const measurementLabel = document.createElement('label');
        const measurementSelect = document.createElement('select');
        measurementSelect.id = `room-eq-measurement-${this.id}`;
        measurementLabel.htmlFor = measurementSelect.id;
        measurementLabel.textContent = this._t('roomEq.parameter.measurement', 'Measurement');
        measurementSelect.addEventListener('change', () => {
            const option = measurementSelect.selectedOptions[0];
            this.setParameters({
                ms: measurementSelect.value,
                mn: measurementSelect.value ? option?.textContent || '' : '',
                rp: 0
            });
        });
        const measurementStatus = document.createElement('span');
        measurementStatus.className = 'room-eq-measurement-status';
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'room-eq-refresh';
        refresh.textContent = this._t('roomEq.action.refresh', 'Refresh measurements');
        refresh.addEventListener('click', () => this._refreshMeasurements(true));
        measurementRow.append(measurementLabel, measurementSelect, measurementStatus, refresh);
        this._measurementRow = { select: measurementSelect, status: measurementStatus };
        container.appendChild(measurementRow);

        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.delay', 'Delay'),
            0, 20, 0.01, this.delayMs, value => this.setParameters({ dl: value }), 'ms'));

        container.appendChild(this.createRadioGroup(this._t('roomEq.parameter.phase', 'Phase'), [
            { value: 'min', label: this._t('roomEq.phase.minimum', 'Minimum') },
            { value: 'lin', label: this._t('roomEq.phase.linear', 'Linear') },
            { value: 'full', label: this._t('roomEq.phase.direct', 'Correction') }
        ], this.pm, value => this.setParameters({ pm: value })));
        container.appendChild(this.createSelectControl(this._t('roomEq.parameter.taps', 'Taps'),
            [8192, 16384, 32768, 65536, 131072].map(value => ({ value: String(value), label: String(value) })),
            String(this.tp), value => this.setParameters({ tp: Number(value) })));
        container.appendChild(this.createSelectControl(this._t('roomEq.parameter.latency', 'Latency'),
            [0, 128, 256, 512, 1024].map(value => ({ value: String(value), label: `${value} samples` })),
            this.lt, value => this.setParameters({ lt: value })));
        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.smoothing', 'Smoothing'),
            0.02, 1, 0.01, this.sm, value => this.setParameters({ sm: value }), 'oct'));
        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.low', 'Correction Low'),
            20, 1000, 1, this.fl, value => this.setParameters({ fl: value }), 'Hz'));
        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.high', 'Correction High'),
            1000, 20000, 10, this.fh, value => this.setParameters({ fh: value }), 'Hz'));
        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.directWindow', 'Direct Window'),
            1, 50, 0.1, this.dw, value => this.setParameters({ dw: value }), 'ms'));
        container.appendChild(this._createPhaseLowControl());
        const lowFrequencyPhaseExtensionControl = this.createCheckboxControl(
            this._t(
                'roomEq.parameter.lowFrequencyPhaseExtension',
                'Low-frequency Phase Extension'
            ),
            this.le,
            value => this.setParameters({ le: value })
        );
        this._lowFrequencyPhaseExtensionControl =
            lowFrequencyPhaseExtensionControl.querySelector('input');
        container.appendChild(lowFrequencyPhaseExtensionControl);
        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.maxBoost', 'Max Boost'),
            0, 18, 0.1, this.mb, value => this.setParameters({ mb: value }), 'dB'));
        container.appendChild(this.createParameterControl(
            this._t('roomEq.parameter.levelCorrection', 'Level Correction'),
            0, 100, 1, this.cr, value => this.setParameters({ cr: value }), '%'));
        const phaseCorrectionControl = this.createParameterControl(
            this._t('roomEq.parameter.phaseCorrection', 'Phase Correction'),
            0, 100, 1, this.pr, value => this.setParameters({ pr: value }), '%');
        this._phaseCorrectionControl = phaseCorrectionControl;
        this._syncPhaseCorrectionControl();
        container.appendChild(phaseCorrectionControl);
        const referencePointRow = document.createElement('div');
        referencePointRow.className = 'parameter-row';
        const referencePointLabel = document.createElement('label');
        const referencePointSelect = document.createElement('select');
        referencePointSelect.id = `room-eq-reference-point-${this.id}`;
        referencePointLabel.htmlFor = referencePointSelect.id;
        referencePointLabel.textContent = this._t(
            'roomEq.parameter.referencePoint',
            'Reference Point'
        );
        referencePointSelect.addEventListener('change', () => {
            this.setParameters({ rp: Number(referencePointSelect.value) });
        });
        referencePointRow.append(referencePointLabel, referencePointSelect);
        this._referencePointSelect = referencePointSelect;
        this._renderReferencePoints(null, false);
        this._syncPhaseCorrectionControl();
        container.appendChild(referencePointRow);
        container.appendChild(this.createParameterControl(this._t('roomEq.parameter.gain', 'Gain'),
            -12, 12, 0.1, this.gn, value => this.setParameters({ gn: value }), 'dB'));

        this._additionalEqEditor?.dispose();
        this._responseViewElements = null;
        this._additionalEqEditor = RoomEqPlugin.createAdditionalEqEditor({
            host: this,
            id: `${this.id}-room-eq`,
            sampleRate: this._sampleRate,
            bands: this.eqBands,
            baseResponse: null,
            correctionLowFrequency: this.fl,
            correctionHighFrequency: this.fh,
            onChange: bands => this.setParameters({ bs: bands })
        });
        const updateResponse = this._additionalEqEditor.updateResponse.bind(
            this._additionalEqEditor
        );
        this._additionalEqEditor.updateResponse = () => {
            updateResponse();
            this._drawPhaseResponse();
            this._drawGroupDelayResponse();
            this._drawImpulseResponse();
        };
        this._syncCorrectionPreview();
        container.appendChild(this._additionalEqEditor.createUI());
        this._createResponseViewControls(this._additionalEqEditor);

        const statusLine = document.createElement('div');
        statusLine.className = 'room-eq-status-line';
        const status = document.createElement('div');
        status.className = 'room-eq-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        this._statusElement = status;
        const latency = document.createElement('div');
        latency.className = 'room-eq-latency';
        this._latencyElement = latency;
        statusLine.append(status, latency);
        container.appendChild(statusLine);
        this._setStatus(this._statusMessage || this._t('roomEq.status.select',
            'Assign a saved measurement to begin.'), this._statusState);
        this._renderStatus();
        this._refreshMeasurements(false);
        return container;
    }

    cleanup() {
        if (this._disposed) return;
        this._disposed = true;
        ++this._designGeneration;
        if (this._designTimer !== null) clearTimeout(this._designTimer);
        this._designTimer = null;
        this._designPending = false;
        this._designer?.close();
        this._measurementStore?.close();
        globalThis.document?.removeEventListener?.('visibilitychange', this._visibilityHandler);
        this._designer = null;
        this._measurementStore = null;
        this._measurementRow = null;
        this._beforeLegendHover?.emphasis.restore?.();
        this._beforeLegendHover = null;
        this._responseHoverCleanup?.();
        this._responseHoverCleanup = null;
        this._additionalEqEditor?.dispose();
        this._additionalEqEditor = null;
        this._responseViewElements = null;
        this._phaseCorrectionControl = null;
        this._phaseLowControl = null;
        this._lowFrequencyPhaseExtensionControl = null;
        this._referencePointSelect = null;
        this._statusElement = null;
        this._latencyElement = null;
        super.cleanup();
    }
}

window.RoomEqPlugin = RoomEqPlugin;
