class GraphDragAxisLock {
    static begin(owner, clientX, clientY) {
        owner._graphDragAxisLock = {
            startX: clientX,
            startY: clientY,
            lastX: clientX,
            lastY: clientY,
            shiftActive: false,
            axis: null
        };
    }

    // Returns the only value axis that should change while Shift is held.
    // "x" changes frequency; "y" changes the graph's vertical value.
    static resolve(owner, event) {
        const lock = owner._graphDragAxisLock;
        if (!lock) return null;
        if (!event?.shiftKey) {
            lock.axis = null;
            lock.shiftActive = false;
            if (Number.isFinite(event?.clientX)) lock.lastX = event.clientX;
            if (Number.isFinite(event?.clientY)) lock.lastY = event.clientY;
            return null;
        }
        if (!lock.shiftActive) {
            lock.startX = Number.isFinite(lock.lastX) ? lock.lastX : lock.startX;
            lock.startY = Number.isFinite(lock.lastY) ? lock.lastY : lock.startY;
            lock.shiftActive = true;
        }
        if (!lock.axis) {
            const xDistance = Math.abs(event.clientX - lock.startX);
            const yDistance = Math.abs(event.clientY - lock.startY);
            if (xDistance === 0 && yDistance === 0) return null;
            lock.axis = xDistance >= yDistance ? 'x' : 'y';
        }
        return lock.axis;
    }

    static end(owner) {
        owner._graphDragAxisLock = null;
    }
}

class GraphPlotArea {
    static from(container, margin = 20) {
        const rect = container?.getBoundingClientRect?.() ||
            { left: 0, top: 0, width: 0, height: 0 };
        const width = container?.clientWidth || rect.width;
        const height = container?.clientHeight || rect.height;
        const marginX = width > margin * 2 ? margin : 0;
        const marginY = height > margin * 2 ? margin : 0;
        const plotWidth = width - marginX * 2;
        const plotHeight = height - marginY * 2;
        const scaleX = width ? rect.width / width : 1;
        const scaleY = height ? rect.height / height : 1;
        return {
            left: rect.left + marginX * scaleX,
            top: rect.top + marginY * scaleY,
            width: (plotWidth > 0 ? plotWidth : width) * scaleX,
            height: (plotHeight > 0 ? plotHeight : height) * scaleY,
            leftPercent: width > 0 ? marginX / width * 100 : 0,
            topPercent: height > 0 ? marginY / height * 100 : 0,
            widthPercent: width > 0 ? (plotWidth > 0 ? plotWidth : width) / width * 100 : 100,
            heightPercent: height > 0 ? (plotHeight > 0 ? plotHeight : height) / height * 100 : 100
        };
    }
}

class PeqMarkerWheel {
    static nextQ(currentQ, deltaY, minimumQ, maximumQ) {
        const current = Number(currentQ);
        const minimum = Number(minimumQ);
        const maximum = Number(maximumQ);
        if (!Number.isFinite(current) || !Number.isFinite(deltaY) || deltaY === 0 ||
            !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
            return current;
        }

        const direction = deltaY < 0 ? 1 : -1;
        const scaled = current * Math.pow(2, direction / 12);
        let next = Math.round(scaled * 100) / 100;
        if (next === current) next = Math.round((current + direction * 0.01) * 100) / 100;
        return Math.max(minimum, Math.min(next, maximum));
    }

    static bind(marker, { getQ, setQ, minimumQ = 0.1, maximumQ }) {
        marker.addEventListener('wheel', event => {
            if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
            event.preventDefault();
            const current = getQ();
            const maximum = typeof maximumQ === 'function' ? maximumQ() : maximumQ;
            const next = PeqMarkerWheel.nextQ(current, event.deltaY, minimumQ, maximum);
            if (next !== current) setQ(next);
        }, { passive: false });
    }
}

// Keep the desktop band grid while showing one selected band on mobile.
class MobileBandSelector {
    static create(owner, controls, markers) {
        const panels = Array.from(controls.children);
        controls.classList.add('mobile-band-controls');
        const tabs = document.createElement('div');
        tabs.className = 'mobile-band-tabs';
        const buttons = panels.map((panel, index) => {
            panel.classList.add('mobile-band-panel');
            if (!panel.id) panel.id = `${owner.id}-mobile-band-${index}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-band-tab';
            button.textContent = String(index + 1);
            button.setAttribute('aria-label', `Band ${index + 1}`);
            button.setAttribute('aria-controls', panel.id);
            button.addEventListener('click', () => selectBand(index));
            markers[index].addEventListener('pointerdown', () => selectBand(index));
            tabs.appendChild(button);
            return button;
        });
        const selectBand = index => {
            owner._mobileSelectedBandIndex = index;
            panels.forEach((panel, band) => {
                const selected = band === index;
                panel.classList.toggle('mobile-band-selected', selected);
                buttons[band].classList.toggle('active', selected);
                buttons[band].setAttribute('aria-pressed', String(selected));
            });
        };
        selectBand(owner._mobileSelectedBandIndex ?? 0);
        return tabs;
    }
}

if (typeof window !== 'undefined') {
    window.GraphDragAxisLock = GraphDragAxisLock;
    window.GraphPlotArea = GraphPlotArea;
    window.PeqMarkerWheel = PeqMarkerWheel;
    window.MobileBandSelector = MobileBandSelector;
}
