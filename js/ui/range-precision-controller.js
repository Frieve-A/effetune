const DEFAULT_PIXELS_PER_STEP = 4;
const installedControllers = new WeakMap();

function readFiniteNumber(value, fallback) {
    if (value === '' || value === undefined || value === null) {
        return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function readStep(value) {
    if (value === 'any') {
        return null;
    }
    const step = readFiniteNumber(value, 1);
    return step > 0 ? step : null;
}

function decimalPlaces(value) {
    const text = String(value).toLowerCase();
    const [coefficient, exponentText] = text.split('e');
    const exponent = Number(exponentText || 0);
    const fractionLength = coefficient.includes('.')
        ? coefficient.length - coefficient.indexOf('.') - 1
        : 0;
    return exponent < 0
        ? fractionLength - exponent
        : (fractionLength > exponent ? fractionLength - exponent : 0);
}

function formatValue(value, step, min, startValue) {
    const precision = Math.min(
        12,
        Math.max(
            decimalPlaces(step),
            decimalPlaces(min),
            decimalPlaces(startValue)
        )
    );
    return String(Number(value.toFixed(precision)));
}

function createControlEvent(documentRef, type) {
    const EventClass = documentRef.defaultView?.Event || globalThis.Event;
    return new EventClass(type, { bubbles: true });
}

function resolveFineDrag(slider, documentRef) {
    const targetId = slider.dataset?.rangeFineTarget;
    const target = targetId
        ? documentRef.getElementById?.(targetId)
        : slider;
    if (!target) {
        return null;
    }

    const min = readFiniteNumber(
        slider.dataset?.rangeFineMin,
        readFiniteNumber(target.min, readFiniteNumber(slider.min, 0))
    );
    const max = readFiniteNumber(
        slider.dataset?.rangeFineMax,
        readFiniteNumber(target.max, readFiniteNumber(slider.max, 100))
    );
    const step = readStep(
        slider.dataset?.rangeFineStep || target.step || slider.step
    );
    const startValue = readFiniteNumber(target.value, NaN);
    if (!step || !Number.isFinite(startValue) || max <= min) {
        return null;
    }

    return { target, min, max, step, startValue };
}

function isVerticalSlider(slider) {
    if (slider.classList?.contains?.('vertical-slider')) {
        return true;
    }
    const rect = slider.getBoundingClientRect?.();
    return Boolean(rect && rect.height > rect.width);
}

function pointerCoordinate(event, vertical) {
    return vertical ? -event.clientY : event.clientX;
}

/**
 * Enables Shift+drag fine adjustment for every range input under a document.
 * Native dragging remains unchanged unless Shift is held when dragging starts.
 */
export function installRangePrecisionControl(
    documentRef = globalThis.document,
    { pixelsPerStep = DEFAULT_PIXELS_PER_STEP } = {}
) {
    if (!documentRef?.addEventListener) {
        return () => {};
    }

    const existing = installedControllers.get(documentRef);
    if (existing) {
        return existing.dispose;
    }

    const movementPerStep = readFiniteNumber(pixelsPerStep, DEFAULT_PIXELS_PER_STEP);
    const safePixelsPerStep = movementPerStep > 0
        ? movementPerStep
        : DEFAULT_PIXELS_PER_STEP;
    let session = null;

    const finish = (event, dispatchChange) => {
        if (!session || event.pointerId !== session.pointerId) {
            return;
        }

        event.preventDefault();
        if (dispatchChange && session.changed) {
            session.target.dispatchEvent(createControlEvent(documentRef, 'change'));
        }
        session.slider.style.cursor = session.previousCursor;
        try {
            session.slider.releasePointerCapture?.(session.pointerId);
        } catch (_) {
            // Pointer capture may already be released after cancellation.
        }
        session = null;
    };

    const onPointerDown = event => {
        const slider = event.target;
        if (
            session ||
            event.shiftKey !== true ||
            event.isPrimary === false ||
            (event.button !== undefined && event.button !== 0) ||
            slider?.disabled ||
            !slider?.matches?.('input[type="range"]')
        ) {
            return;
        }

        const fineDrag = resolveFineDrag(slider, documentRef);
        if (!fineDrag) {
            return;
        }

        const vertical = isVerticalSlider(slider);
        session = {
            ...fineDrag,
            slider,
            pointerId: event.pointerId,
            startCoordinate: pointerCoordinate(event, vertical),
            vertical,
            lastStepCount: 0,
            lastValue: fineDrag.startValue,
            changed: false,
            previousCursor: slider.style.cursor
        };

        slider.style.cursor = vertical ? 'ns-resize' : 'ew-resize';
        slider.focus?.({ preventScroll: true });
        try {
            slider.setPointerCapture?.(event.pointerId);
        } catch (_) {
            // Delegated document events still keep fine dragging functional.
        }
        event.preventDefault();
    };

    const onPointerMove = event => {
        if (!session || event.pointerId !== session.pointerId) {
            return;
        }

        event.preventDefault();
        const distance = pointerCoordinate(event, session.vertical) - session.startCoordinate;
        const stepCount = Math.trunc(distance / safePixelsPerStep);
        if (stepCount === session.lastStepCount) {
            return;
        }
        session.lastStepCount = stepCount;

        const proposed = session.startValue + stepCount * session.step;
        const clamped = proposed < session.min
            ? session.min
            : (proposed > session.max ? session.max : proposed);
        const value = Number(formatValue(
            clamped,
            session.step,
            session.min,
            session.startValue
        ));
        if (value === session.lastValue) {
            return;
        }

        session.lastValue = value;
        session.changed = true;
        session.target.value = formatValue(
            value,
            session.step,
            session.min,
            session.startValue
        );
        session.target.dispatchEvent(createControlEvent(documentRef, 'input'));
    };

    const onPointerUp = event => finish(event, true);
    const onPointerCancel = event => finish(event, false);

    documentRef.addEventListener('pointerdown', onPointerDown, true);
    documentRef.addEventListener('pointermove', onPointerMove, true);
    documentRef.addEventListener('pointerup', onPointerUp, true);
    documentRef.addEventListener('pointercancel', onPointerCancel, true);

    const dispose = () => {
        documentRef.removeEventListener('pointerdown', onPointerDown, true);
        documentRef.removeEventListener('pointermove', onPointerMove, true);
        documentRef.removeEventListener('pointerup', onPointerUp, true);
        documentRef.removeEventListener('pointercancel', onPointerCancel, true);
        if (session) {
            session.slider.style.cursor = session.previousCursor;
            session = null;
        }
        installedControllers.delete(documentRef);
    };

    installedControllers.set(documentRef, { dispose });
    return dispose;
}
