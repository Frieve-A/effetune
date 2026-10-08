// Apply valid typing immediately without rewriting partial input. Blur or Enter
// clamps the value, restores invalid input, and formats the committed number.
export function bindNumberInput(valueInput, slider, min, max, initialValue, setter, toSlider, format) {
    const initial = parseFloat(initialValue);
    const applied = { value: Number.isFinite(initial) ? initial : min };

    valueInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!(val >= min && val <= max)) return;
        slider.value = toSlider(val);
        setter(val);
        applied.value = val;
    });

    const commit = (e) => {
        const val = parseFloat(e.target.value);
        const finiteVal = Number.isFinite(val) ? val : applied.value;
        const clampedVal = finiteVal < min ? min : (finiteVal > max ? max : finiteVal);
        e.target.value = format(clampedVal);
        slider.value = toSlider(clampedVal);
        if (clampedVal !== applied.value) {
            setter(clampedVal);
            applied.value = clampedVal;
        }
    };
    valueInput.addEventListener('blur', commit);
    valueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            commit(e);
            e.preventDefault(); // Prevent form submission if inside a form
        }
    });
    return applied;
}

// Effect plugins are classic scripts; both loaders evaluate this module first.
globalThis.bindEffeTuneNumberInput = bindNumberInput;

export function updateRangeFill(input) {
    if (!input?.matches?.('input[type="range"]')) return;

    const minimum = input.min === '' ? 0 : Number(input.min);
    const maximum = input.max === '' ? 100 : Number(input.max);
    const value = Number(input.value);
    const span = maximum - minimum;
    const percent = span > 0 && Number.isFinite(value)
        ? ((value - minimum) / span) * 100
        : 0;
    const clamped = percent < 0 ? 0 : (percent > 100 ? 100 : percent);
    const explicitOrigin = Number.parseFloat(input.dataset?.rangeFillOrigin);
    const origin = Number.isFinite(explicitOrigin)
        ? explicitOrigin
        : (minimum < 0 && maximum > 0 ? 0 : minimum);
    const originPercent = span > 0 ? ((origin - minimum) / span) * 100 : 0;
    const clampedOrigin = originPercent < 0 ? 0 : (originPercent > 100 ? 100 : originPercent);
    input.style?.setProperty?.('--et-range-fill', `${clamped}%`);
    input.style?.setProperty?.('--et-range-origin', `${clampedOrigin}%`);
}

export function refreshRangeFills(root) {
    if (!root) return;
    if (root.matches?.('input[type="range"]')) {
        updateRangeFill(root);
        return;
    }
    root.querySelectorAll?.('input[type="range"]').forEach(updateRangeFill);
}

export function installRangeFillStyling(documentRef = document) {
    const refresh = (root = documentRef) => refreshRangeFills(root);
    const refreshFromEvent = event => {
        const root = event.target?.closest?.('.plugin-parameter-ui') ??
            event.target?.closest?.('.parameter-row') ?? event.target;
        refresh(root);
    };

    refresh();
    for (const type of ['input', 'change', 'click', 'dblclick']) {
        documentRef.addEventListener?.(type, refreshFromEvent);
    }

    let observer = null;
    if (typeof MutationObserver !== 'undefined' && documentRef.body) {
        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) refresh(node);
            }
        });
        observer.observe(documentRef.body, { childList: true, subtree: true });
    }

    return {
        refresh,
        dispose() {
            for (const type of ['input', 'change', 'click', 'dblclick']) {
                documentRef.removeEventListener?.(type, refreshFromEvent);
            }
            observer?.disconnect();
        }
    };
}
