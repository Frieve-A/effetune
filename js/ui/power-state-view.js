import { validatePowerSnapshot } from '../audio/power-snapshot.js';

function getDefaultDocument() {
    return typeof document !== 'undefined'
        ? document
        : { querySelectorAll() { return []; } };
}

function getSnapshotFromEvent(eventOrSnapshot) {
    const detail = eventOrSnapshot?.detail ?? eventOrSnapshot;
    const candidate = detail?.snapshot ?? detail;
    return validatePowerSnapshot(candidate) ? candidate : null;
}

function defaultTranslate(key, fallback) {
    return fallback || key;
}

function translateWithFallback(translate, key, fallback) {
    const translated = translate?.(key, fallback);
    return typeof translated === 'string' && translated && translated !== key
        ? translated
        : fallback;
}

function normalizeElements(value) {
    if (!value) return [];
    if (typeof value[Symbol.iterator] === 'function' && typeof value !== 'string') {
        return Array.from(value).filter(Boolean);
    }
    return [value];
}

function requiresResumeAction(snapshot) {
    return snapshot?.manualResumeRequired === true ||
        snapshot?.resourceHealth === 'blocked' ||
        snapshot?.transitionError?.recoverable === true;
}

function isInputOnlyResume(snapshot) {
    return snapshot?.manualResumeRequired === true &&
        snapshot?.resourceHealth !== 'blocked' &&
        snapshot?.transitionError?.recoverable !== true &&
        snapshot?.transportDemand === true &&
        snapshot?.effectiveState !== 'SUSPENDED';
}

/**
 * Binds power recovery to ordinary menu actions without adding a status row,
 * banner, overlay, or other layout-affecting message surface.
 */
export class PowerStateView {
    constructor({
        eventSource,
        documentRef = getDefaultDocument(),
        translate = defaultTranslate,
        onResume = null,
        actionResolver = null
    } = {}) {
        this.eventSource = eventSource;
        this.documentRef = documentRef;
        this.translate = translate;
        this.onResume = onResume;
        this.actionResolver = actionResolver || (() =>
            this.documentRef.querySelectorAll?.('[data-power-resume-action]') || []);
        this.snapshot = null;
        this.locallyBusy = false;
        this.disposed = false;
        this.resumeAttempt = 0;
        this.boundActions = new Set();
        this.handlePowerStateChanged = eventOrSnapshot => {
            if (this.disposed) return;
            const snapshot = getSnapshotFromEvent(eventOrSnapshot);
            if (!snapshot) return;
            this.snapshot = snapshot;
            this.render();
        };
        this.handleResumeClick = () => this.resume();

        this.eventSource?.addEventListener?.('powerStateChanged', this.handlePowerStateChanged);
        this.eventSource?.addEventListener?.('powerResumeRequired', this.handlePowerStateChanged);
    }

    setTranslator(translate) {
        this.translate = typeof translate === 'function' ? translate : defaultTranslate;
        this.render();
    }

    redrawLanguage() {
        this.render();
    }

    refreshActions() {
        this.render();
    }

    refreshSlots() {
        this.refreshActions();
    }

    resolveActions() {
        const current = new Set(normalizeElements(this.actionResolver?.()));
        for (const action of this.boundActions) {
            if (!current.has(action)) {
                action.removeEventListener?.('click', this.handleResumeClick);
                this.boundActions.delete(action);
            }
        }
        for (const action of current) {
            if (!this.boundActions.has(action) &&
                action.dataset?.powerResumeExternalHandler !== 'true') {
                action.addEventListener?.('click', this.handleResumeClick);
                this.boundActions.add(action);
            }
        }
        return current;
    }

    render() {
        if (this.disposed) return;
        const show = requiresResumeAction(this.snapshot);
        const label = isInputOnlyResume(this.snapshot)
            ? translateWithFallback(
                this.translate,
                'dialog.config.powerSaving.resumeInput',
                'Resume microphone input'
            )
            : translateWithFallback(
                this.translate,
                'dialog.config.powerSaving.resume',
                'Resume audio processing'
            );
        for (const action of this.resolveActions()) {
            action.hidden = !show;
            action.disabled = show && (this.locallyBusy || typeof this.onResume !== 'function');
            action.setAttribute?.('aria-busy', this.locallyBusy ? 'true' : 'false');
            if (action.textContent !== label) action.textContent = label;
        }
    }

    async resume() {
        if (this.disposed || this.locallyBusy || typeof this.onResume !== 'function' ||
            !requiresResumeAction(this.snapshot)) {
            return;
        }
        const attempt = ++this.resumeAttempt;
        const snapshot = this.snapshot;
        this.locallyBusy = true;
        this.render();
        let failed = false;
        try {
            await this.onResume(snapshot);
        } catch {
            failed = true;
        } finally {
            if (attempt === this.resumeAttempt) this.locallyBusy = false;
            if (!this.disposed) {
                this.render();
                if (failed) this.boundActions.values().next().value?.focus?.();
            }
        }
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.resumeAttempt++;
        this.eventSource?.removeEventListener?.('powerStateChanged', this.handlePowerStateChanged);
        this.eventSource?.removeEventListener?.('powerResumeRequired', this.handlePowerStateChanged);
        for (const action of normalizeElements(this.actionResolver?.())) action.hidden = true;
        for (const action of this.boundActions) {
            action.removeEventListener?.('click', this.handleResumeClick);
        }
        this.boundActions.clear();
        this.snapshot = null;
    }
}
