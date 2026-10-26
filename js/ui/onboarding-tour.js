import { saveConfig as persistConfig } from '../electron/config-store.js';
import { runExitMotion } from './motion.js';

export const TOUR_STEPS = [
    { id: 'welcome' },
    { id: 'sound', target: '#openMusicButton', mobileTarget: '#mobilePlayerView .mobile-open-music', mobileBody: true, view: 'player' },
    { id: 'effects', target: '#pluginList', mobileTarget: '.mobile-plugin-fab', mobileBody: true, expand: true },
    { id: 'presets', target: '#systemPresetsTab', mobileBody: true, expand: true, drawer: true },
    { id: 'item', target: '#pipelineList .pipeline-item:first-child', fallbackTarget: '#pipeline' },
    { id: 'bypass', target: '.master-toggle' },
    { id: 'save', target: '#pipelinePresetButton' },
    { id: 'browser', target: '#browserButton' },
    { id: 'views', target: '#openLibraryButton', mobileTarget: '.mobile-bottom-button[data-view="library"]', mobileBody: true },
    { id: 'settings', target: '#settingsMenuButton', mobileTarget: '.mobile-menu-button', mobileBody: true },
    { id: 'help', target: '#whatsThisLink', mobileTarget: null, mobileBody: true }
];

export function shouldAutoStart({
    config = {}, startupSearch = '', bodyClasses = [], miniPlayerTargetMode = false,
    hasSavedPipelineState = false, initialized = false
} = {}) {
    const params = new URLSearchParams(startupSearch);
    const classes = new Set(bodyClasses);
    return initialized && config?.onboardingTourShown !== true && !hasSavedPipelineState &&
        !['p', 'v', 'dbt'].some(key => params.has(key)) &&
        !classes.has('view-library') && !classes.has('view-visualizer') && !miniPlayerTargetMode;
}

function element(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

export class OnboardingTour {
    constructor(uiManager, { saveConfig = persistConfig } = {}) {
        this.uiManager = uiManager;
        this.saveConfig = saveConfig;
        this.root = null;
        this.stepIndex = 0;
        this.onPosition = () => this.position();
        this.onKeyDown = event => this.handleKeyDown(event);
        this.uiManager.layoutMode.onChange(() => this.end());
    }

    get isActive() {
        return this.root !== null;
    }

    start() {
        this.end(true);
        this.mobile = this.uiManager.layoutMode.isMobile;
        this.steps = TOUR_STEPS.filter(step => step.id !== 'browser' || window.electronAPI?.browser);
        this.previousFocus = document.activeElement;
        this.root = element('div', 'onboarding-tour');
        this.root.setAttribute('data-mobile', String(this.mobile));
        const exitMotion = globalThis.getComputedStyle?.(document.body)?.getPropertyValue('--et-motion-exit');
        if (exitMotion) this.root.style.setProperty('--et-motion-exit', exitMotion);
        this.spotlight = element('div', 'onboarding-tour-spotlight');
        this.spotlight.setAttribute('aria-hidden', 'true');
        this.card = element('section', 'onboarding-tour-card');
        this.card.setAttribute('role', 'dialog');
        this.card.setAttribute('aria-modal', 'true');
        this.card.setAttribute('aria-labelledby', 'onboardingTourTitle');
        this.card.setAttribute('aria-describedby', 'onboardingTourBody');
        this.title = element('h2', 'onboarding-tour-title');
        this.title.id = 'onboardingTourTitle';
        this.body = element('p', 'onboarding-tour-body');
        this.body.id = 'onboardingTourBody';
        this.progress = element('p', 'onboarding-tour-progress');
        this.progress.setAttribute('aria-live', 'polite');
        const actions = element('div', 'onboarding-tour-actions');
        this.skipButton = this.createButton('skip', () => this.end());
        this.backButton = this.createButton('back', () => this.showStep(this.stepIndex - 1));
        this.nextButton = this.createButton('next', () => {
            if (this.stepIndex === this.steps.length - 1) this.end();
            else this.showStep(this.stepIndex + 1);
        });
        for (const button of [this.skipButton, this.backButton, this.nextButton]) actions.appendChild(button);
        for (const node of [this.title, this.body, this.progress, actions]) this.card.appendChild(node);
        this.root.appendChild(this.spotlight);
        this.root.appendChild(this.card);
        const blockBackgroundScroll = event => {
            if (!this.card.contains(event.target)) event.preventDefault();
        };
        this.root.addEventListener('wheel', blockBackgroundScroll, { passive: false });
        this.root.addEventListener('touchmove', blockBackgroundScroll, { passive: false });
        // A sibling of body shares viewport coordinates without Electron's body zoom.
        document.documentElement.appendChild(this.root);
        document.addEventListener('keydown', this.onKeyDown, true);
        document.addEventListener('scroll', this.onPosition, true);
        document.addEventListener('transitionend', this.onPosition, true);
        window.addEventListener('resize', this.onPosition);
        this.showStep(0);
        Promise.resolve().then(() => this.saveConfig(
            Boolean(window.electronIntegration?.isElectron), { onboardingTourShown: true }
        )).then(saved => {
            if (saved === false) console.warn('Failed to save onboarding tour status.');
        }).catch(error => console.warn('Failed to save onboarding tour status:', error));
    }

    createButton(action, callback) {
        const button = element('button', `onboarding-tour-${action}`);
        button.type = 'button';
        button.addEventListener('click', callback);
        return button;
    }

    showStep(index) {
        if (!this.isActive || index < 0 || index >= this.steps.length) return;
        this.stepIndex = index;
        const step = this.steps[index];
        this.root.setAttribute('data-step', step.id);
        if (this.mobile) {
            if (step.id !== 'welcome') this.uiManager.mobileNav.setView(step.view || 'effects');
            if (step.drawer) this.uiManager.mobileNav.openPluginList();
            else this.uiManager.mobileNav.closePluginList({ immediate: true });
        } else if (step.expand) {
            const collapse = this.uiManager.pluginListManager.collapseManager;
            if (collapse.isCollapsed) collapse.togglePluginListCollapse();
        }
        const selector = this.mobile && 'mobileTarget' in step ? step.mobileTarget : step.target;
        this.target = selector ? document.querySelector(selector) : null;
        if (!this.target && step.fallbackTarget) this.target = document.querySelector(step.fallbackTarget);
        this.target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        this.updateLabels();
        this.nextButton.focus();
    }

    updateLabels() {
        if (!this.isActive) return;
        const step = this.steps[this.stepIndex];
        this.title.textContent = this.uiManager.t(`tour.step.${step.id}.title`);
        this.body.textContent = this.uiManager.t(`tour.step.${step.id}.${this.mobile && step.mobileBody ? 'bodyMobile' : 'body'}`);
        this.progress.textContent = this.uiManager.t('tour.progress', { current: this.stepIndex + 1, total: this.steps.length });
        this.skipButton.textContent = this.uiManager.t('tour.button.skip');
        this.backButton.textContent = this.uiManager.t('tour.button.back');
        this.backButton.hidden = this.stepIndex === 0;
        const next = this.stepIndex === 0 ? 'start' : this.stepIndex === this.steps.length - 1 ? 'done' : 'next';
        this.nextButton.textContent = this.uiManager.t(`tour.button.${next}`);
        this.position();
    }

    position() {
        if (!this.isActive) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const rect = this.target?.getClientRects().length ? this.target.getBoundingClientRect() : null;
        this.spotlight.hidden = !rect;
        this.root.setAttribute('data-centered', String(!rect));
        if (rect) {
            Object.assign(this.spotlight.style, {
                left: `${rect.left - 6}px`, top: `${rect.top - 6}px`,
                width: `${rect.width + 12}px`, height: `${rect.height + 12}px`
            });
        }
        const cardRect = this.card.getBoundingClientRect();
        const margin = 16;
        let left = (width - cardRect.width) / 2;
        let top = (height - cardRect.height) / 2;
        if (rect) {
            if (this.mobile) top = rect.top + rect.height / 2 > height / 2 ? margin : height - cardRect.height - margin;
            else {
                left = rect.left;
                top = rect.bottom + margin;
                if (top + cardRect.height > height - margin) top = rect.top - cardRect.height - margin;
            }
        }
        this.card.style.left = `${Math.max(margin, Math.min(left, width - cardRect.width - margin))}px`;
        this.card.style.top = `${Math.max(margin, Math.min(top, height - cardRect.height - margin))}px`;
    }

    handleKeyDown(event) {
        if (!this.isActive) return;
        event.stopImmediatePropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            this.end();
        } else if (event.key === 'Tab') {
            event.preventDefault();
            const buttons = [this.skipButton, this.backButton, this.nextButton].filter(button => !button.hidden);
            const index = buttons.indexOf(document.activeElement);
            buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        } else if (event.key !== 'Enter' || !this.card.contains(document.activeElement)) {
            event.preventDefault();
        }
    }

    end(immediate = false) {
        if (!this.isActive) return;
        const root = this.root;
        this.root = null;
        document.removeEventListener('keydown', this.onKeyDown, true);
        document.removeEventListener('scroll', this.onPosition, true);
        document.removeEventListener('transitionend', this.onPosition, true);
        window.removeEventListener('resize', this.onPosition);
        if (this.mobile) this.uiManager.mobileNav.closePluginList({ immediate: true });
        if (immediate) root.remove();
        else runExitMotion(root, () => root.remove());
        if (this.previousFocus?.isConnected) this.previousFocus.focus();
        this.target = null;
    }
}
