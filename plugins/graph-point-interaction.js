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

if (typeof window !== 'undefined') {
    window.GraphDragAxisLock = GraphDragAxisLock;
    window.PeqMarkerWheel = PeqMarkerWheel;
}
