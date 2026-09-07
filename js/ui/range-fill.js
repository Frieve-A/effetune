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
    input.style?.setProperty?.('--et-range-fill', `${clamped}%`);
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
