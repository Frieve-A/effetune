const DEFAULT_PIXELS_PER_STEP = 4;
const TOUCH_DRAG_THRESHOLD = 8;
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

function resolveRangeDrag(slider, documentRef, fine) {
    const targetId = fine ? slider.dataset?.rangeFineTarget : null;
    const target = targetId
        ? documentRef.getElementById?.(targetId)
        : slider;
    if (!target) {
        return null;
    }

    const min = readFiniteNumber(
        fine ? slider.dataset?.rangeFineMin : undefined,
        readFiniteNumber(target.min, readFiniteNumber(slider.min, 0))
    );
    const max = readFiniteNumber(
        fine ? slider.dataset?.rangeFineMax : undefined,
        readFiniteNumber(target.max, readFiniteNumber(slider.max, 100))
    );
    const step = readStep(
        (fine ? slider.dataset?.rangeFineStep : null) || target.step || slider.step
    );
    const startValue = readFiniteNumber(target.value, NaN);
    if (!step || !Number.isFinite(startValue) || max <= min) {
        return null;
    }

    return { target, min, max, step, startValue };
}

// A programmatic drag sets the value, so an inbound UI sync needs an
// explicit claim to know the control is being operated. Measured in Chromium:
// the dragged slider does stay `:active`, but pointerdown is default-prevented
// so no compatibility mouse events fire, and for a logarithmic control the
// driven target is a separate number input that is neither `:active` nor
// focused. Flag both ends so the claim never rests on engine-specific `:active`
// behaviour.
function setDragActive(session, active) {
    for (const element of [session.slider, session.target]) {
        if (!element?.dataset) continue;
        if (active) {
            element.dataset.rangeFineActive = '1';
        } else {
            delete element.dataset.rangeFineActive;
        }
    }
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
 * Enables Shift+drag fine adjustment and mobile effect slider touch dragging.
 * Mobile horizontal touch drags adjust from the current value after movement.
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
    let nativeTouch = null;

    // Range controls also update on touchstart, independently of pointerdown.
    // Intercept those native writes before plugin handlers run, while leaving
    // touchstart uncancelled so the browser can still scroll vertically.
    const onNativeInput = event => {
        if (event.isTrusted !== true || event.target !== nativeTouch?.slider) return;
        nativeTouch.slider.value = nativeTouch.value;
        event.stopImmediatePropagation();
    };
    const onTouchEnd = event => {
        if (event.target !== nativeTouch?.slider) return;
        // The pointer handler already commits; prevent the native touch commit.
        event.preventDefault();
        nativeTouch = null;
    };

    const finish = (event, dispatchChange) => {
        if (!session || event.pointerId !== session.pointerId) {
            return;
        }

        if (session.dragging) event.preventDefault();
        setDragActive(session, false);
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
            event.isPrimary === false ||
            (event.button !== undefined && event.button !== 0) ||
            slider?.disabled ||
            !slider?.matches?.('input[type="range"]')
        ) {
            return;
        }

        const vertical = isVerticalSlider(slider);
        const touchDrag = event.shiftKey !== true && event.pointerType === 'touch' && !vertical &&
            documentRef.body?.classList?.contains?.('layout-mobile') && slider.closest?.('.plugin-parameter-ui');
        if (event.shiftKey !== true && !touchDrag) return;
        const rangeDrag = resolveRangeDrag(slider, documentRef, !touchDrag);
        const width = touchDrag ? slider.getBoundingClientRect().width : 0;
        if (!rangeDrag || (touchDrag && width <= 0)) {
            return;
        }

        session = {
            ...rangeDrag,
            slider,
            pointerId: event.pointerId,
            startCoordinate: pointerCoordinate(event, vertical),
            startY: event.clientY,
            vertical,
            touchDrag: Boolean(touchDrag),
            width,
            dragging: !touchDrag,
            lastStepCount: 0,
            lastValue: rangeDrag.startValue,
            changed: false,
            previousCursor: slider.style.cursor
        };
        nativeTouch = touchDrag ? { slider, value: String(slider.value) } : null;

        setDragActive(session, true);
        slider.style.cursor = vertical ? 'ns-resize' : 'ew-resize';
        if (!touchDrag) slider.focus?.({ preventScroll: true });
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

        const distance = pointerCoordinate(event, session.vertical) - session.startCoordinate;
        if (!session.dragging) {
            const verticalDistance = event.clientY - session.startY;
            if (Math.abs(distance) < TOUCH_DRAG_THRESHOLD && Math.abs(verticalDistance) < TOUCH_DRAG_THRESHOLD) return;
            if (Math.abs(verticalDistance) >= Math.abs(distance)) {
                finish(event, false);
                return;
            }
            session.dragging = true;
            session.slider.focus?.({ preventScroll: true });
        }
        event.preventDefault();

        let proposed;
        if (session.touchDrag) {
            const value = session.startValue + distance * (session.max - session.min) / session.width;
            proposed = session.min + Math.round((value - session.min) / session.step) * session.step;
        } else {
            const stepCount = Math.trunc(distance / safePixelsPerStep);
            if (stepCount === session.lastStepCount) return;
            session.lastStepCount = stepCount;
            proposed = session.startValue + stepCount * session.step;
        }

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
        if (nativeTouch) nativeTouch.value = nativeTouch.slider.value;
    };

    const onPointerUp = event => finish(event, true);
    const onPointerCancel = event => finish(event, false);

    documentRef.addEventListener('pointerdown', onPointerDown, true);
    documentRef.addEventListener('pointermove', onPointerMove, true);
    documentRef.addEventListener('pointerup', onPointerUp, true);
    documentRef.addEventListener('pointercancel', onPointerCancel, true);
    documentRef.addEventListener('input', onNativeInput, true);
    documentRef.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    documentRef.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: false });

    const dispose = () => {
        documentRef.removeEventListener('pointerdown', onPointerDown, true);
        documentRef.removeEventListener('pointermove', onPointerMove, true);
        documentRef.removeEventListener('pointerup', onPointerUp, true);
        documentRef.removeEventListener('pointercancel', onPointerCancel, true);
        documentRef.removeEventListener('input', onNativeInput, true);
        documentRef.removeEventListener('touchend', onTouchEnd, true);
        documentRef.removeEventListener('touchcancel', onTouchEnd, true);
        nativeTouch = null;
        if (session) {
            setDragActive(session, false);
            session.slider.style.cursor = session.previousCursor;
            session = null;
        }
        installedControllers.delete(documentRef);
    };

    installedControllers.set(documentRef, { dispose });
    return dispose;
}
