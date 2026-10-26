const installedWindows = new WeakSet();
const controlSelector = 'input, select, textarea, button, [contenteditable], [data-parameter-control]';

export function flashParameterLock(item) {
    const button = item?.querySelector('.lock-button');
    if (!button) return;
    button.classList.remove('lock-feedback');
    void button.offsetWidth;
    button.classList.add('lock-feedback');
}

// Capture before the document-level slider, select and mobile keypad handlers.
// Passive graph events and controls explicitly marked as views remain available.
export function installParameterEditLock(windowRef = globalThis.window) {
    if (!windowRef?.addEventListener || installedWindows.has(windowRef)) return;
    installedWindows.add(windowRef);

    const blockEdit = event => {
        const ui = event.target?.closest?.('.plugin-ui[data-parameters-locked="true"]');
        if (!ui) return;
        const control = event.target.closest(controlSelector);
        if (!control || !ui.contains(control) || control.dataset.parameterControl === 'view') return;
        if (event.type === 'focusin') {
            event.stopImmediatePropagation();
            return;
        }
        if (event.type === 'keydown' && (
            event.key === 'Tab' || event.key === 'Escape' ||
            ((event.ctrlKey || event.metaKey) && ['a', 'c'].includes(event.key.toLowerCase()))
        )) return;
        if (event.type === 'contextmenu' && control.dataset.parameterControl !== 'edit') return;

        event.preventDefault();
        // Custom graph editors honor cancellation while passive readouts still receive the event.
        if (control.dataset.parameterControl !== 'edit') event.stopImmediatePropagation();
        flashParameterLock(ui.closest('.pipeline-item'));
    };
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick',
        'focusin', 'keydown', 'beforeinput', 'input', 'change', 'paste', 'cut', 'drop', 'dragstart', 'wheel', 'contextmenu']) {
        windowRef.addEventListener(type, blockEdit, { capture: true, passive: false });
    }
}
