const MOBILE_ICONS = {
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M8 5.14a1 1 0 0 1 1.52-.85l10.5 6.86a1 1 0 0 1 0 1.7L9.52 19.71A1 1 0 0 1 8 18.86z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" draggable="false"><rect x="7" y="5" width="3.6" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.4"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M13 7.15a.8.8 0 0 0-1.25-.66l-7.2 5.05a.9.9 0 0 0 0 1.48l7.2 5.05A.8.8 0 0 0 13 17.4z"/><path d="M20 7.15a.8.8 0 0 0-1.25-.66l-6.2 4.45a.9.9 0 0 0 0 1.48l6.2 4.45A.8.8 0 0 0 20 17.4z"/></svg>',
    plus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    player: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" draggable="false"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    library: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" draggable="false"><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5"/><path d="M8 7h8M8 11h6M8 15h7"/></svg>',
    effects: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" draggable="false"><path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h3"/><path d="M11 12h9"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>'
};

const MOBILE_NAV_LABELS = {
    player: { key: 'ui.mobileNav.player', fallback: 'Player' },
    library: { key: 'ui.mobileNav.library', fallback: 'Library' },
    effects: { key: 'ui.mobileNav.effects', fallback: 'Effects' }
};

export class MobileNav {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.playerView = null;
        this.emptyPlayer = null;
        this.miniPlayer = null;
        this.nav = null;
        this.libraryView = null;
        this.libraryShell = null;
        this.libraryOpenRequestId = 0;
        this.fab = null;
        this.pluginListCloseButton = null;
        this.stateUnsubscribers = [];
        this.resumePrompt = null;
        this.resumePromptListeners = [];
        this.resumePromptAudioContext = null;
        this.resumePromptAudioStateHandler = null;
        this.restoreUpdateUITexts = null;
        this.installUpdateUITextsHook();
        this.unsubscribe = this.uiManager.layoutMode?.onChange(mode => this.applyMode(mode)) || null;
        this.applyMode(this.uiManager.layoutMode?.mode || 'desktop');
    }

    applyMode(mode) {
        if (mode === 'mobile') {
            this.ensureElements();
            this.mountAudioPlayer('mobile');
            const hasSharedPipeline = new URLSearchParams(window.location.search).has('p');
            const currentView = this.getCurrentView();
            this.setView(currentView === 'library' ? 'library' : (currentView === 'effects' || hasSharedPipeline ? 'effects' : 'player'));
            this.attachPlayerState();
            this.updateMiniPlayer();
            this.updatePlayerPlaceholder();
            this.updateAudioResumePrompt();
            return;
        }

        this.mountAudioPlayer('desktop');
        this.closePluginList();
        document.body.classList.remove('view-player', 'view-effects');
        this.removeMobileElements();
    }

    ensureElements() {
        if (!this.playerView) {
            this.playerView = document.createElement('div');
            this.playerView.id = 'mobilePlayerView';
            this.playerView.className = 'mobile-player-view';
            this.emptyPlayer = document.createElement('div');
            this.emptyPlayer.className = 'mobile-player-empty';
            this.emptyPlayer.innerHTML = `
                <div class="mobile-player-empty-title"></div>
                <button type="button" class="header-button mobile-open-music"></button>
            `;
            this.emptyPlayer.querySelector('.mobile-open-music')?.addEventListener('click', () => {
                document.getElementById('openMusicButton')?.click();
            });
            this.playerView.appendChild(this.emptyPlayer);
            this.resumePrompt = document.createElement('button');
            this.resumePrompt.type = 'button';
            this.resumePrompt.className = 'mobile-audio-resume-prompt';
            this.resumePrompt.addEventListener('click', () => this.resumeAudioContext());
            this.playerView.appendChild(this.resumePrompt);
            const mainContainer = document.querySelector('.main-container');
            mainContainer?.parentNode?.insertBefore(this.playerView, mainContainer);
        }

        if (!this.miniPlayer) {
            this.miniPlayer = document.createElement('div');
            this.miniPlayer.className = 'mobile-mini-player';
            const miniTrack = document.createElement('div');
            miniTrack.className = 'mobile-mini-track';
            const openMusicButton = document.createElement('button');
            openMusicButton.type = 'button';
            openMusicButton.className = 'mobile-mini-open-music';
            const playButton = document.createElement('button');
            playButton.type = 'button';
            playButton.className = 'mobile-mini-button mobile-mini-play';
            playButton.innerHTML = MOBILE_ICONS.play;
            const nextButton = document.createElement('button');
            nextButton.type = 'button';
            nextButton.className = 'mobile-mini-button mobile-mini-next';
            nextButton.innerHTML = MOBILE_ICONS.next;
            this.miniPlayer.appendChild(miniTrack);
            this.miniPlayer.appendChild(openMusicButton);
            this.miniPlayer.appendChild(playButton);
            this.miniPlayer.appendChild(nextButton);
            openMusicButton.addEventListener('click', () => {
                document.getElementById('openMusicButton')?.click();
            });
            playButton.addEventListener('click', () => {
                this.uiManager.audioPlayer?.togglePlayPause();
            });
            nextButton.addEventListener('click', () => {
                this.uiManager.audioPlayer?.playNext();
            });
            document.body.appendChild(this.miniPlayer);
        }

        if (!this.libraryShell) {
            this.libraryShell = document.createElement('div');
            this.libraryShell.id = 'mobileLibraryView';
            this.libraryShell.className = 'mobile-library-view';
            const mainContainer = document.querySelector('.main-container');
            mainContainer?.parentNode?.insertBefore(this.libraryShell, mainContainer);
            this.attachLibraryView();
        }

        if (!this.nav) {
            this.nav = document.createElement('nav');
            this.nav.className = 'mobile-bottom-nav';
            this.nav.setAttribute('aria-label', 'Primary mobile navigation');
            this.nav.innerHTML = `
                <button type="button" class="mobile-bottom-button" data-view="player" aria-label="Player">
                    <span class="mobile-bottom-button-icon">${MOBILE_ICONS.player}</span>
                    <span class="mobile-bottom-button-label">Player</span>
                </button>
                <button type="button" class="mobile-bottom-button" data-view="library" aria-label="Library">
                    <span class="mobile-bottom-button-icon">${MOBILE_ICONS.library}</span>
                    <span class="mobile-bottom-button-label">Library</span>
                </button>
                <button type="button" class="mobile-bottom-button" data-view="effects" aria-label="Effects">
                    <span class="mobile-bottom-button-icon">${MOBILE_ICONS.effects}</span>
                    <span class="mobile-bottom-button-label">Effects</span>
                </button>
            `;
            this.nav.addEventListener('click', event => {
                const button = event.target.closest('button[data-view]');
                if (button) {
                    this.setView(button.dataset.view, {
                        focusSearch: false,
                        returnFocus: button
                    });
                }
            });
            document.body.appendChild(this.nav);
            this.updateLabels();
        }

        if (!this.fab) {
            this.fab = document.createElement('button');
            this.fab.type = 'button';
            this.fab.className = 'mobile-plugin-fab';
            this.fab.innerHTML = MOBILE_ICONS.plus;
            this.fab.addEventListener('click', () => this.openPluginList());
            document.body.appendChild(this.fab);
        }

        if (!this.pluginListCloseButton) {
            this.pluginListCloseButton = document.createElement('button');
            this.pluginListCloseButton.type = 'button';
            this.pluginListCloseButton.className = 'mobile-plugin-list-close';
            this.pluginListCloseButton.innerHTML = MOBILE_ICONS.close;
            this.pluginListCloseButton.addEventListener('click', () => this.closePluginList());
            const pluginListElement = document.getElementById('pluginList');
            if (typeof pluginListElement?.prepend === 'function') {
                pluginListElement.prepend(this.pluginListCloseButton);
            }
        }

        if (this.resumePromptListeners.length === 0) {
            const refresh = () => this.updateAudioResumePrompt();
            document.addEventListener('pointerdown', refresh, { passive: true });
            document.addEventListener('keydown', refresh);
            document.addEventListener('visibilitychange', refresh);
            this.resumePromptListeners.push(
                () => document.removeEventListener('pointerdown', refresh),
                () => document.removeEventListener('keydown', refresh),
                () => document.removeEventListener('visibilitychange', refresh)
            );
        }

        this.updateLabels();
        this.observeAudioContextState();
    }

    setView(view, options = {}) {
        const nextView = view === 'library' ? 'library' : (view === 'effects' ? 'effects' : 'player');
        if (nextView === 'library' && !options.fromLibraryView) {
            return this.showLibraryViewFromNav(options);
        }
        if (nextView !== 'library' && !options.fromLibraryView) {
            this.cancelPendingLibraryOpen();
        }
        this.applyViewState(nextView, options);
        return undefined;
    }

    async showLibraryViewFromNav(options = {}) {
        const previousView = this.getCurrentView();
        const requestId = this.beginLibraryOpenRequest();
        try {
            const shown = await this.uiManager.showLibraryView?.({
                focusSearch: false,
                returnFocus: options.returnFocus,
                isCurrentRequest: () => this.isLibraryOpenRequestCurrent(requestId)
            });
            if (!this.isLibraryOpenRequestCurrent(requestId) || shown === false) return;
            this.applyViewState('library', { fromLibraryView: true });
        } catch (_) {
            if (this.isLibraryOpenRequestCurrent(requestId)) {
                this.applyViewState(previousView, { fromLibraryView: true });
            }
        }
    }

    beginLibraryOpenRequest() {
        this.libraryOpenRequestId = (this.libraryOpenRequestId || 0) + 1;
        return this.libraryOpenRequestId;
    }

    cancelPendingLibraryOpen() {
        this.libraryOpenRequestId = (this.libraryOpenRequestId || 0) + 1;
    }

    isLibraryOpenRequestCurrent(requestId) {
        return requestId === this.libraryOpenRequestId;
    }

    applyViewState(nextView, options = {}) {
        document.body.classList.toggle('view-player', nextView === 'player');
        document.body.classList.toggle('view-effects', nextView === 'effects');
        document.body.classList.toggle('view-library', nextView === 'library');
        this.nav?.querySelectorAll('button[data-view]').forEach(button => {
            const active = button.dataset.view === nextView;
            button.classList.toggle('active', active);
            if (active) {
                button.setAttribute('aria-current', 'page');
            } else {
                button.removeAttribute?.('aria-current');
            }
        });
        if (nextView === 'player') {
            this.closePluginList();
        }
        if (nextView === 'library' && !options.fromLibraryView) {
            this.uiManager.showLibraryView?.({
                focusSearch: options.focusSearch ?? false,
                returnFocus: options.returnFocus
            });
        }
        if (nextView !== 'library' && !options.fromLibraryView) {
            this.uiManager.hideLibraryView?.({
                returnFocus: options.returnFocus
            });
        }
        this.updateAudioResumePrompt();
    }

    getCurrentView() {
        if (document.body.classList.contains('view-library')) return 'library';
        if (document.body.classList.contains('view-effects')) return 'effects';
        return 'player';
    }

    getViewButton(view) {
        return Array.from(this.nav?.querySelectorAll?.('button[data-view]') || [])
            .find(button => button.dataset?.view === view) || null;
    }

    updateLabels() {
        this.nav?.setAttribute('aria-label', this.t('ui.mobileNav.primary', 'Primary mobile navigation'));
        this.nav?.querySelectorAll?.('button[data-view]').forEach(button => {
            const config = MOBILE_NAV_LABELS[button.dataset.view];
            if (!config) return;
            const label = this.t(config.key, config.fallback);
            button.setAttribute('aria-label', label);
            const labelElement = button.querySelector?.('.mobile-bottom-button-label');
            if (labelElement) labelElement.textContent = label;
        });
        const noTrackLabel = this.t('ui.mobileNav.noTrack', 'No track loaded');
        const openMusicText = this.t('ui.mobileNav.openMusic', 'Open Music');
        const openMusicTitle = this.t('ui.title.openMusic', 'Open music files');
        const playPauseLabel = this.t('ui.title.playPause', 'Play or pause');
        const nextTrackLabel = this.t('ui.title.nextTrack', 'Next track');
        const resumePlaybackLabel = this.t('ui.mobileNav.resumePlayback', 'Tap to start playback');
        const addEffectLabel = this.t('ui.mobileNav.addEffect', 'Add effect');
        const closeEffectListLabel = this.t('ui.mobileNav.closeEffectList', 'Close effect list');

        const emptyTitle = this.emptyPlayer?.querySelector?.('.mobile-player-empty-title');
        const emptyOpenMusic = this.emptyPlayer?.querySelector?.('.mobile-open-music');
        if (emptyTitle) emptyTitle.textContent = noTrackLabel;
        if (emptyOpenMusic) {
            emptyOpenMusic.textContent = openMusicText;
            emptyOpenMusic.title = openMusicTitle;
            emptyOpenMusic.setAttribute('aria-label', openMusicTitle);
        }
        if (this.resumePrompt) {
            this.resumePrompt.textContent = resumePlaybackLabel;
            this.resumePrompt.setAttribute('aria-label', resumePlaybackLabel);
        }
        const miniTrack = this.miniPlayer?.querySelector?.('.mobile-mini-track');
        const openMusic = this.miniPlayer?.querySelector?.('.mobile-mini-open-music');
        const play = this.miniPlayer?.querySelector?.('.mobile-mini-play');
        const next = this.miniPlayer?.querySelector?.('.mobile-mini-next');
        if (miniTrack && !this.hasMiniPlayerTrack()) miniTrack.textContent = noTrackLabel;
        if (openMusic) {
            openMusic.textContent = openMusicText;
            openMusic.title = openMusicTitle;
            openMusic.setAttribute('aria-label', openMusicTitle);
        }
        if (play) {
            play.title = playPauseLabel;
            play.setAttribute('aria-label', playPauseLabel);
        }
        if (next) {
            next.title = nextTrackLabel;
            next.setAttribute('aria-label', nextTrackLabel);
        }
        if (this.fab) {
            this.fab.title = addEffectLabel;
            this.fab.setAttribute('aria-label', addEffectLabel);
        }
        if (this.pluginListCloseButton) {
            this.pluginListCloseButton.title = closeEffectListLabel;
            this.pluginListCloseButton.setAttribute('aria-label', closeEffectListLabel);
        }
    }

    hasMiniPlayerTrack() {
        const state = this.uiManager.audioPlayer?.stateManager?.getStateSnapshot?.() || null;
        return Boolean(state?.currentTrackName || state?.currentTrack);
    }

    t(key, fallback) {
        const text = this.uiManager?.t?.(key);
        return text && text !== key ? text : fallback;
    }

    installUpdateUITextsHook() {
        if (typeof this.uiManager?.updateUITexts !== 'function' || this.uiManager.updateUITexts.__mobileNavLabelsPatched) {
            return;
        }
        const original = this.uiManager.updateUITexts;
        const patched = function(...args) {
            const result = original.apply(this, args);
            this.mobileNav?.updateLabels?.();
            this.mobileNav?.updateMiniPlayer?.();
            return result;
        };
        patched.__mobileNavLabelsPatched = true;
        this.uiManager.updateUITexts = patched;
        this.restoreUpdateUITexts = () => {
            if (this.uiManager.updateUITexts === patched) {
                this.uiManager.updateUITexts = original;
            }
        };
    }

    attachLibraryView() {
        this.libraryView = this.uiManager.libraryView || null;
        if (this.libraryShell && this.libraryView?.root && this.libraryView.root.parentNode !== this.libraryShell) {
            this.libraryShell.appendChild(this.libraryView.root);
        }
    }

    openPluginList() {
        document.getElementById('pluginList')?.classList.add('mobile-open');
    }

    closePluginList() {
        document.getElementById('pluginList')?.classList.remove('mobile-open');
    }

    mountAudioPlayer(mode) {
        this.uiManager.audioPlayer?.ui?.mountContainerForLayout?.(mode);
    }

    removeMobileElements() {
        this.resumePromptListeners.forEach(unsubscribe => unsubscribe());
        this.resumePromptListeners = [];
        this.detachAudioContextStateListener();

        this.restoreLibraryViewMount();
        this.playerView?.remove();
        this.libraryShell?.remove();
        this.miniPlayer?.remove();
        this.nav?.remove();
        this.fab?.remove();
        this.pluginListCloseButton?.remove();

        this.playerView = null;
        this.libraryView = null;
        this.libraryShell = null;
        this.emptyPlayer = null;
        this.resumePrompt = null;
        this.miniPlayer = null;
        this.nav = null;
        this.fab = null;
        this.pluginListCloseButton = null;
    }

    restoreLibraryViewMount() {
        const root = this.libraryView?.root;
        if (!root || root.parentNode !== this.libraryShell) return;
        const mainContainer = document.querySelector('.main-container');
        mainContainer?.parentNode?.insertBefore(root, mainContainer.nextSibling);
    }

    observeAudioContextState() {
        const audioContext = this.uiManager.audioManager?.audioContext || null;
        if (audioContext === this.resumePromptAudioContext) return;

        this.detachAudioContextStateListener();
        this.resumePromptAudioContext = audioContext;
        if (audioContext?.addEventListener) {
            this.resumePromptAudioStateHandler = () => this.updateAudioResumePrompt();
            audioContext.addEventListener('statechange', this.resumePromptAudioStateHandler);
        }
    }

    detachAudioContextStateListener() {
        if (this.resumePromptAudioContext?.removeEventListener && this.resumePromptAudioStateHandler) {
            this.resumePromptAudioContext.removeEventListener('statechange', this.resumePromptAudioStateHandler);
        }
        this.resumePromptAudioContext = null;
        this.resumePromptAudioStateHandler = null;
    }

    attachPlayerState() {
        const stateManager = this.uiManager.audioPlayer?.stateManager;
        if (!stateManager || this.attachedStateManager === stateManager) return;

        this.stateUnsubscribers.forEach(unsubscribe => unsubscribe());
        this.stateUnsubscribers = [];
        this.attachedStateManager = stateManager;

        const update = () => {
            this.updateMiniPlayer();
            this.updatePlayerPlaceholder();
        };
        const keys = ['currentTrack', 'currentTrackName', 'isPlaying', 'playlist'];
        keys.forEach(key => {
            stateManager.addListener(key, update);
            this.stateUnsubscribers.push(() => stateManager.removeListener(key, update));
        });
        update();
    }

    updatePlayerPlaceholder() {
        if (!this.emptyPlayer) return;
        const hasPlayerUI = !!this.uiManager.audioPlayer?.ui?.container;
        this.emptyPlayer.style.display = hasPlayerUI ? 'none' : '';
    }

    resumeAudioContext() {
        const audioContext = this.uiManager.audioManager?.audioContext;
        if (audioContext?.state === 'suspended') {
            const resumeResult = audioContext.resume?.();
            if (resumeResult?.finally) {
                resumeResult.finally(() => this.updateAudioResumePrompt());
            } else {
                this.updateAudioResumePrompt();
            }
        }
    }

    updateAudioResumePrompt() {
        if (!this.resumePrompt) return;
        this.observeAudioContextState();
        const isMobilePlayer = this.uiManager.layoutMode?.isMobile &&
            document.body.classList.contains('view-player');
        const isSuspended = this.uiManager.audioManager?.audioContext?.state === 'suspended';
        this.resumePrompt.hidden = !(isMobilePlayer && isSuspended);
    }

    updateMiniPlayer() {
        if (!this.miniPlayer) return;
        const state = this.uiManager.audioPlayer?.stateManager?.getStateSnapshot?.() || null;
        const trackName = state?.currentTrackName || state?.currentTrack?.name || this.t('ui.mobileNav.noTrack', 'No track loaded');
        const hasTrack = Boolean(state?.currentTrackName || state?.currentTrack);
        const title = this.miniPlayer.querySelector('.mobile-mini-track');
        const openMusic = this.miniPlayer.querySelector('.mobile-mini-open-music');
        const play = this.miniPlayer.querySelector('.mobile-mini-play');
        const next = this.miniPlayer.querySelector('.mobile-mini-next');
        if (title) title.textContent = trackName;
        if (openMusic) openMusic.hidden = hasTrack;
        if (play) {
            play.hidden = !hasTrack;
            play.innerHTML = state?.isPlaying ? MOBILE_ICONS.pause : MOBILE_ICONS.play;
        }
        if (next) next.hidden = !hasTrack;
    }

    dispose() {
        this.restoreUpdateUITexts?.();
        this.restoreUpdateUITexts = null;
        this.unsubscribe?.();
        this.stateUnsubscribers.forEach(unsubscribe => unsubscribe());
        this.stateUnsubscribers = [];
        this.attachedStateManager = null;
        this.mountAudioPlayer('desktop');
        this.removeMobileElements();
    }
}
