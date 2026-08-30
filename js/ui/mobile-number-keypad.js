const NUMBER_INPUT_SELECTOR = '.plugin-parameter-ui input[type="number"]';

function createEvent(documentRef, type, bubbles) {
    const EventClass = documentRef.defaultView?.Event || globalThis.Event;
    return new EventClass(type, { bubbles });
}

function isDigit(key) {
    return typeof key === 'string' && /^[0-9]$/.test(key);
}

function splitSign(buffer) {
    return buffer.startsWith('-')
        ? { sign: '-', magnitude: buffer.slice(1) }
        : { sign: '', magnitude: buffer };
}

function appendDigit(buffer, digit) {
    const { sign, magnitude } = splitSign(buffer);
    if (magnitude === '0') {
        return digit === '0' ? `${sign}0` : `${sign}${digit}`;
    }
    return `${buffer}${digit}`;
}

export function editMobileNumberBuffer(state, key) {
    const current = {
        buffer: String(state?.buffer ?? ''),
        replaceOnNextDigit: state?.replaceOnNextDigit === true
    };

    if (isDigit(key)) {
        if (current.replaceOnNextDigit) {
            const { sign } = splitSign(current.buffer);
            return { buffer: `${sign}${key}`, replaceOnNextDigit: false };
        }
        return {
            buffer: appendDigit(current.buffer, key),
            replaceOnNextDigit: false
        };
    }

    if (key === 'decimal') {
        if (current.replaceOnNextDigit) {
            const { sign } = splitSign(current.buffer);
            return { buffer: `${sign}0.`, replaceOnNextDigit: false };
        }
        if (current.buffer.includes('.')) return current;
        return {
            buffer: current.buffer === '' || current.buffer === '-'
                ? `${current.buffer}0.`
                : `${current.buffer}.`,
            replaceOnNextDigit: false
        };
    }

    if (key === 'toggle-sign') {
        return {
            buffer: current.buffer.startsWith('-')
                ? current.buffer.slice(1)
                : `-${current.buffer}`,
            replaceOnNextDigit: current.replaceOnNextDigit
        };
    }

    if (key === 'clear') {
        return { buffer: '', replaceOnNextDigit: false };
    }

    if (key === 'backspace') {
        return {
            buffer: current.replaceOnNextDigit ? '' : current.buffer.slice(0, -1),
            replaceOnNextDigit: false
        };
    }

    return current;
}

export function normalizeMobileNumberBuffer(buffer) {
    const text = String(buffer ?? '');
    if (text === '' || text === '-' || text === '.' || text === '-.') {
        return null;
    }
    const value = Number(text);
    return Number.isFinite(value) ? String(value) : null;
}

export function commitMobileNumberInput(input, buffer, documentRef = globalThis.document) {
    const normalized = normalizeMobileNumberBuffer(buffer);
    if (!input || normalized === null || !documentRef) return false;

    input.value = normalized;
    input.dispatchEvent(createEvent(documentRef, 'input', true));
    input.dispatchEvent(createEvent(documentRef, 'change', true));
    input.dispatchEvent(createEvent(documentRef, 'blur', false));
    return true;
}

function readInputLabel(input, fallback) {
    const directLabel = input.labels?.[0]?.textContent;
    const rowLabel = input.closest?.('.parameter-row')?.querySelector?.('label')?.textContent;
    const ariaLabel = input.getAttribute?.('aria-label');
    return String(directLabel || rowLabel || ariaLabel || fallback).replace(/:\s*$/, '');
}

function readRange(input) {
    const minimum = input.min === '' ? null : Number(input.min);
    const maximum = input.max === '' ? null : Number(input.max);
    return {
        minimum: Number.isFinite(minimum) ? String(input.min) : null,
        maximum: Number.isFinite(maximum) ? String(input.max) : null
    };
}

export class MobileNumberKeypad {
    constructor({
        documentRef = globalThis.document,
        isEnabled = () => documentRef?.body?.classList?.contains?.('layout-mobile'),
        translate = (_key, fallback) => fallback
    } = {}) {
        this.documentRef = documentRef;
        this.isEnabled = isEnabled;
        this.translate = translate;
        this.target = null;
        this.state = { buffer: '', replaceOnNextDigit: false };
        this.root = null;
        this.dialog = null;
        this.title = null;
        this.display = null;
        this.rangeHint = null;
        this.signButton = null;
        this.okButton = null;
        this.cancelButton = null;
        this.numberButtons = [];
        this.originalReadOnly = false;
        this.originalInputMode = null;

        this.onPointerDown = event => {
            if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
            if (!this.isEligibleInput(event.target)) return;
            event.preventDefault();
            this.open(event.target);
        };
        this.onClick = event => {
            if (!this.isEligibleInput(event.target)) return;
            event.preventDefault();
            this.open(event.target);
        };
        this.onFocusIn = event => {
            if (!this.isEligibleInput(event.target)) return;
            this.open(event.target);
            event.target.blur?.();
        };
        this.onKeyDown = event => {
            if (!this.target) return;
            const key = event.key;
            const consume = () => {
                event.preventDefault();
                event.stopPropagation?.();
            };
            if (key === 'Tab') {
                const buttons = Array.from(this.dialog?.querySelectorAll?.('button') || [])
                    .filter(button => !button.disabled);
                if (buttons.length > 0) {
                    const activeIndex = buttons.indexOf(this.documentRef?.activeElement);
                    const direction = event.shiftKey ? -1 : 1;
                    const nextIndex = activeIndex < 0
                        ? (event.shiftKey ? buttons.length - 1 : 0)
                        : (activeIndex + direction + buttons.length) % buttons.length;
                    consume();
                    buttons[nextIndex]?.focus?.({ preventScroll: true });
                }
                return;
            }
            if (key === 'Escape') {
                consume();
                this.cancel();
                return;
            }
            if (key === 'Backspace') {
                consume();
                this.edit('backspace');
                return;
            }
            if (key === '.' || key === ',') {
                consume();
                this.edit('decimal');
                return;
            }
            if (key === '-' && !this.state.buffer.startsWith('-')) {
                if (this.signButton?.disabled) return;
                consume();
                this.edit('toggle-sign');
                return;
            }
            if (key === '+' && this.state.buffer.startsWith('-')) {
                consume();
                this.edit('toggle-sign');
                return;
            }
            if (isDigit(key)) {
                consume();
                this.edit(key);
            }
        };

        this.documentRef?.addEventListener?.('pointerdown', this.onPointerDown, {
            capture: true,
            passive: false
        });
        this.documentRef?.addEventListener?.('click', this.onClick, true);
        this.documentRef?.addEventListener?.('focusin', this.onFocusIn, true);
        this.documentRef?.addEventListener?.('keydown', this.onKeyDown, true);
    }

    isEligibleInput(target) {
        return Boolean(
            this.isEnabled?.() &&
            target?.matches?.(NUMBER_INPUT_SELECTOR) &&
            !target.disabled &&
            !target.readOnly
        );
    }

    buildView() {
        if (this.root || !this.documentRef?.createElement || !this.documentRef?.body) return;

        const root = this.documentRef.createElement('div');
        root.className = 'mobile-number-keypad-overlay';
        root.hidden = true;

        const dialog = this.documentRef.createElement('div');
        dialog.className = 'mobile-number-keypad';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'mobileNumberKeypadTitle');

        const title = this.documentRef.createElement('div');
        title.className = 'mobile-number-keypad-title';
        title.id = 'mobileNumberKeypadTitle';

        const display = this.documentRef.createElement('output');
        display.className = 'mobile-number-keypad-display';
        display.setAttribute('aria-live', 'polite');

        const rangeHint = this.documentRef.createElement('div');
        rangeHint.className = 'mobile-number-keypad-range';

        const keys = this.documentRef.createElement('div');
        keys.className = 'mobile-number-keypad-keys';

        const keyDefinitions = [
            ['clear', 'C'], ['toggle-sign', '±'], ['backspace', '⌫'],
            ['7', '7'], ['8', '8'], ['9', '9'],
            ['4', '4'], ['5', '5'], ['6', '6'],
            ['1', '1'], ['2', '2'], ['3', '3'],
            ['0', '0'], ['decimal', '.']
        ];
        for (const [key, text] of keyDefinitions) {
            const button = this.createButton(text, () => this.edit(key));
            button.dataset.key = key;
            if (key === '0') button.classList.add('mobile-number-keypad-zero');
            keys.appendChild(button);
            if (isDigit(key)) this.numberButtons.push(button);
            if (key === 'toggle-sign') this.signButton = button;
        }

        const actions = this.documentRef.createElement('div');
        actions.className = 'mobile-number-keypad-actions';
        this.cancelButton = this.createButton('', () => this.cancel());
        this.cancelButton.classList.add('mobile-number-keypad-cancel');
        this.okButton = this.createButton('OK', () => this.commit());
        this.okButton.classList.add('mobile-number-keypad-ok');
        actions.appendChild(this.cancelButton);
        actions.appendChild(this.okButton);

        dialog.appendChild(title);
        dialog.appendChild(display);
        dialog.appendChild(rangeHint);
        dialog.appendChild(keys);
        dialog.appendChild(actions);
        root.appendChild(dialog);
        root.addEventListener('pointerdown', event => {
            if (event.target !== root) return;
            event.preventDefault();
            this.cancel();
        });
        this.documentRef.body.appendChild(root);

        this.root = root;
        this.dialog = dialog;
        this.title = title;
        this.display = display;
        this.rangeHint = rangeHint;
        this.updateLabels();
    }

    createButton(text, activate) {
        const button = this.documentRef.createElement('button');
        button.type = 'button';
        button.className = 'mobile-number-keypad-button';
        button.textContent = text;
        button.addEventListener('pointerdown', event => {
            if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
            event.preventDefault();
            activate();
        });
        button.addEventListener('click', event => {
            if (event.detail !== 0) {
                event.preventDefault();
                return;
            }
            activate();
        });
        return button;
    }

    updateLabels() {
        if (!this.root) return;
        const fallbackTitle = this.translate('ui.mobileNumberKeypad.title', 'Enter value');
        this.cancelButton.textContent = this.translate('ui.cancelButton', 'Cancel');
        this.cancelButton.setAttribute('aria-label', this.cancelButton.textContent);
        this.okButton.textContent = 'OK';
        this.okButton.setAttribute('aria-label', 'OK');

        const labels = {
            clear: this.translate('ui.mobileNumberKeypad.clear', 'Clear'),
            'toggle-sign': this.translate('ui.mobileNumberKeypad.toggleSign', 'Change sign'),
            backspace: this.translate('ui.mobileNumberKeypad.backspace', 'Backspace'),
            decimal: this.translate('ui.mobileNumberKeypad.decimalPoint', 'Decimal point')
        };
        for (const [key, label] of Object.entries(labels)) {
            const button = this.root.querySelector?.(`[data-key="${key}"]`);
            button?.setAttribute?.('aria-label', label);
        }
        if (this.target) {
            this.title.textContent = readInputLabel(this.target, fallbackTitle);
            this.updateRangeHint();
        } else {
            this.title.textContent = fallbackTitle;
        }
    }

    open(input) {
        if (!input || !this.isEnabled?.()) return;
        if (this.target && this.target !== input) this.cancel();
        this.buildView();
        if (!this.root) return;

        this.target = input;
        this.originalReadOnly = input.readOnly === true;
        this.originalInputMode = input.getAttribute?.('inputmode') ?? null;
        input.readOnly = true;
        input.setAttribute?.('inputmode', 'none');
        input.classList?.add?.('mobile-number-keypad-target');

        this.state = {
            buffer: String(input.value ?? ''),
            replaceOnNextDigit: String(input.value ?? '') !== ''
        };
        this.root.hidden = false;
        this.documentRef.body?.classList?.add?.('mobile-number-keypad-open');
        this.updateLabels();
        this.updateDisplay();
        this.numberButtons[0]?.focus?.({ preventScroll: true });
    }

    updateRangeHint() {
        if (!this.target || !this.rangeHint) return;
        const { minimum, maximum } = readRange(this.target);
        const minimumNumber = minimum === null ? null : Number(minimum);
        this.signButton.disabled = minimumNumber !== null && minimumNumber >= 0;
        if (minimum === null && maximum === null) {
            this.rangeHint.hidden = true;
            this.rangeHint.textContent = '';
            return;
        }

        this.rangeHint.hidden = false;
        if (minimum !== null && maximum !== null) {
            this.rangeHint.textContent = this.translate(
                'ui.mobileNumberKeypad.range',
                'Allowed range: {min} to {max}'
            ).replace('{min}', minimum).replace('{max}', maximum);
        } else if (minimum !== null) {
            this.rangeHint.textContent = `≥ ${minimum}`;
        } else {
            this.rangeHint.textContent = `≤ ${maximum}`;
        }
    }

    edit(key) {
        if (!this.target) return;
        if (key === 'toggle-sign' && this.signButton?.disabled) return;
        this.state = editMobileNumberBuffer(this.state, key);
        this.updateDisplay();
    }

    updateDisplay() {
        if (!this.display) return;
        this.display.textContent = this.state.buffer || '\u00a0';
        this.okButton.disabled = normalizeMobileNumberBuffer(this.state.buffer) === null;
        this.display.classList?.toggle?.('is-preset', this.state.replaceOnNextDigit);
    }

    restoreTargetState() {
        const input = this.target;
        if (!input) return null;
        input.readOnly = this.originalReadOnly;
        if (this.originalInputMode === null) {
            input.removeAttribute?.('inputmode');
        } else {
            input.setAttribute?.('inputmode', this.originalInputMode);
        }
        input.classList?.remove?.('mobile-number-keypad-target');
        return input;
    }

    commit() {
        if (!this.target) return false;
        if (normalizeMobileNumberBuffer(this.state.buffer) === null) return false;
        const input = this.restoreTargetState();
        if (this.documentRef?.contains?.(input) === false) {
            this.close();
            return false;
        }
        const committed = commitMobileNumberInput(input, this.state.buffer, this.documentRef);
        if (committed) this.close();
        return committed;
    }

    cancel() {
        if (!this.target) return;
        this.restoreTargetState();
        this.close();
    }

    close() {
        this.documentRef?.activeElement?.blur?.();
        if (this.root) this.root.hidden = true;
        this.documentRef?.body?.classList?.remove?.('mobile-number-keypad-open');
        this.target = null;
        this.state = { buffer: '', replaceOnNextDigit: false };
        this.originalReadOnly = false;
        this.originalInputMode = null;
    }

    dispose() {
        this.cancel();
        this.documentRef?.removeEventListener?.('pointerdown', this.onPointerDown, true);
        this.documentRef?.removeEventListener?.('click', this.onClick, true);
        this.documentRef?.removeEventListener?.('focusin', this.onFocusIn, true);
        this.documentRef?.removeEventListener?.('keydown', this.onKeyDown, true);
        this.root?.remove?.();
        this.root = null;
    }
}
