// The slice of the app's UIManager that the pipeline editor and the plugins
// reach for (window.uiManager), for the browser client that does not load the
// full UIManager (it would pull in audio, library and Electron code). Same
// approach as the Chrome extension's pipeline editor.

import { LayoutModeManager } from '../ui/layout-mode-manager.js';
import { resolveLanguagePreference } from '../language-options.js';

function parseJson5Object(text) {
    return JSON.parse(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
}

async function fetchLocale(locale, fetchImpl) {
    try {
        const response = await fetchImpl(`js/locales/${locale}.json5`);
        return response.ok ? parseJson5Object(await response.text()) : {};
    } catch (error) {
        console.warn(`[remote] translations for ${locale} could not be loaded`, error);
        return {};
    }
}

// English is always loaded as the fallback for keys a translation lacks.
export async function loadTranslations({ fetchImpl = globalThis.fetch.bind(globalThis), language } = {}) {
    const locale = resolveLanguagePreference('auto', language);
    const english = await fetchLocale('en', fetchImpl);
    const translations = locale === 'en' ? english : await fetchLocale(locale, fetchImpl);
    return { locale, english, translations };
}

function substitute(text, params) {
    return Object.entries(params || {}).reduce(
        (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
        text
    );
}

export function createRemoteUiManager({ locale = 'en', translations, english, showMessage, hideMessage }) {
    const lookup = key => translations[key] || english[key] || key;
    const manager = {
        translations,
        englishTranslations: english,
        userLanguage: locale,
        expandedPlugins: new Set(),
        layoutMode: new LayoutModeManager(),
        debugChannelCount: 2,
        t(key, params = {}) {
            return substitute(lookup(key), params);
        },
        updateURL() {},
        updatePipelineToggleButton() {},
        updateLoadingProgress() {},
        refreshRangeFillStyling() { manager.rangeFill?.refresh?.(); },
        clearError() { hideMessage(); },
        isDoubleBlindActive() { return false; },
        getLocalizedDocPath(path) { return path; },
        showTransientMessage(key, isError = false, params = {}, duration = 3000) {
            const fallback = isError ? 'Something went wrong. Try again.' : '';
            const text = translations[key] || english[key] || (key.includes(' ') ? key : fallback);
            showMessage(substitute(text, params), !isError, duration);
        },
        setError(key, isError = key.startsWith('error.'), params = {}) {
            const text = translations[key] || english[key] || 'Something went wrong. Your pipeline was kept. Try again.';
            showMessage(substitute(text, params), !isError);
        }
    };
    return manager;
}

const ICONS = Object.freeze({
    add: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
});

// Mobile layout: a round button opens the effect list over the pipeline.
export class RemoteMobileShell {
    constructor({ documentRef = globalThis.document, translate = (_key, fallback) => fallback } = {}) {
        this.document = documentRef;
        this.translate = translate;
        this.fab = null;
        this.closeButton = null;
    }

    applyMode(mode) {
        if (mode === 'mobile') this.ensureElements();
        else this.removeElements();
    }

    ensureElements() {
        if (!this.fab) {
            const label = this.translate('ui.mobileNav.addEffect', 'Add effect');
            this.fab = this.document.createElement('button');
            this.fab.type = 'button';
            this.fab.className = 'mobile-plugin-fab';
            this.fab.setAttribute('aria-label', label);
            this.fab.title = label;
            this.fab.innerHTML = ICONS.add;
            this.fab.addEventListener('click', () => this.openPluginList());
            this.document.body.appendChild(this.fab);
        }
        if (!this.closeButton) {
            const label = this.translate('ui.mobileNav.closeEffectList', 'Close effect list');
            this.closeButton = this.document.createElement('button');
            this.closeButton.type = 'button';
            this.closeButton.className = 'mobile-plugin-list-close';
            this.closeButton.setAttribute('aria-label', label);
            this.closeButton.title = label;
            this.closeButton.innerHTML = ICONS.close;
            this.closeButton.addEventListener('click', () => this.closePluginList());
            this.document.getElementById('pluginList')?.prepend(this.closeButton);
        }
    }

    openPluginList() { this.document.getElementById('pluginList')?.classList.add('mobile-open'); }
    closePluginList() { this.document.getElementById('pluginList')?.classList.remove('mobile-open'); }
    setView() {}

    removeElements() {
        this.closePluginList();
        this.fab?.remove();
        this.closeButton?.remove();
        this.fab = null;
        this.closeButton = null;
    }

    dispose() { this.removeElements(); }
}
