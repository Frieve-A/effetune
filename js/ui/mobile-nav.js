const MOBILE_ICONS = {
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M8 5.14a1 1 0 0 1 1.52-.85l10.5 6.86a1 1 0 0 1 0 1.7L9.52 19.71A1 1 0 0 1 8 18.86z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" draggable="false"><rect x="7" y="5" width="3.6" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.4"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M13 7.15a.8.8 0 0 0-1.25-.66l-7.2 5.05a.9.9 0 0 0 0 1.48l7.2 5.05A.8.8 0 0 0 13 17.4z"/><path d="M20 7.15a.8.8 0 0 0-1.25-.66l-6.2 4.45a.9.9 0 0 0 0 1.48l6.2 4.45A.8.8 0 0 0 20 17.4z"/></svg>',
    plus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" draggable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    player: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" draggable="false"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    effects: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" draggable="false"><path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h3"/><path d="M11 12h9"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>'
};

export class MobileNav {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.playerView = null;
        this.emptyPlayer = null;
        this.miniPlayer = null;
        this.nav = null;
        this.fab = null;
        this.pluginListCloseButton = null;
        this.stateUnsubscribers = [];
        this.resumePrompt = null;
        this.resumePromptListeners = [];
        this.resumePromptAudioContext = null;
        this.resumePromptAudioStateHandler = null;
        this.unsubscribe = this.uiManager.layoutMode?.onChange(mode => this.applyMode(mode)) || null;
        this.applyMode(this.uiManager.layoutMode?.mode || 'desktop');
    }

    applyMode(mode) {
        if (mode === 'mobile') {
            this.ensureElements();
            this.mountAudioPlayer('mobile');
            const hasSharedPipeline = new URLSearchParams(window.location.search).has('p');
            this.setView(document.body.classList.contains('view-effects') || hasSharedPipeline ? 'effects' : 'player');
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
                <div class="mobile-player-empty-title">No track loaded</div>
                <button type="button" class="header-button mobile-open-music">Open Music</button>
            `;
            this.emptyPlayer.querySelector('.mobile-open-music')?.addEventListener('click', () => {
                document.getElementById('openMusicButton')?.click();
            });
            this.playerView.appendChild(this.emptyPlayer);
            this.resumePrompt = document.createElement('button');
            this.resumePrompt.type = 'button';
            this.resumePrompt.className = 'mobile-audio-resume-prompt';
            this.resumePrompt.textContent = 'Tap to start playback';
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
            miniTrack.textContent = 'No track loaded';
            const openMusicButton = document.createElement('button');
            openMusicButton.type = 'button';
            openMusicButton.className = 'mobile-mini-open-music';
            openMusicButton.title = 'Open music files';
            openMusicButton.setAttribute('aria-label', 'Open music files');
            openMusicButton.textContent = 'Open Music';
            const playButton = document.createElement('button');
            playButton.type = 'button';
            playButton.className = 'mobile-mini-button mobile-mini-play';
            playButton.title = 'Play or pause';
            playButton.setAttribute('aria-label', 'Play or pause');
            playButton.innerHTML = MOBILE_ICONS.play;
            const nextButton = document.createElement('button');
            nextButton.type = 'button';
            nextButton.className = 'mobile-mini-button mobile-mini-next';
            nextButton.title = 'Next track';
            nextButton.setAttribute('aria-label', 'Next track');
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

        if (!this.nav) {
            this.nav = document.createElement('nav');
            this.nav.className = 'mobile-bottom-nav';
            this.nav.setAttribute('aria-label', 'Primary mobile navigation');
            this.nav.innerHTML = `
                <button type="button" class="mobile-bottom-button" data-view="player" aria-label="Player">
                    <span class="mobile-bottom-button-icon">${MOBILE_ICONS.player}</span>
                    <span class="mobile-bottom-button-label">Player</span>
                </button>
                <button type="button" class="mobile-bottom-button" data-view="effects" aria-label="Effects">
                    <span class="mobile-bottom-button-icon">${MOBILE_ICONS.effects}</span>
                    <span class="mobile-bottom-button-label">Effects</span>
                </button>
            `;
            this.nav.addEventListener('click', event => {
                const button = event.target.closest('button[data-view]');
                if (button) this.setView(button.dataset.view);
            });
            document.body.appendChild(this.nav);
        }

        if (!this.fab) {
            this.fab = document.createElement('button');
            this.fab.type = 'button';
            this.fab.className = 'mobile-plugin-fab';
            this.fab.title = 'Add effect';
            this.fab.setAttribute('aria-label', 'Add effect');
            this.fab.innerHTML = MOBILE_ICONS.plus;
            this.fab.addEventListener('click', () => this.openPluginList());
            document.body.appendChild(this.fab);
        }

        if (!this.pluginListCloseButton) {
            this.pluginListCloseButton = document.createElement('button');
            this.pluginListCloseButton.type = 'button';
            this.pluginListCloseButton.className = 'mobile-plugin-list-close';
            this.pluginListCloseButton.title = 'Close';
            this.pluginListCloseButton.setAttribute('aria-label', 'Close effect list');
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

        this.observeAudioContextState();
    }

    setView(view) {
        const nextView = view === 'effects' ? 'effects' : 'player';
        document.body.classList.toggle('view-player', nextView === 'player');
        document.body.classList.toggle('view-effects', nextView === 'effects');
        this.nav?.querySelectorAll('button[data-view]').forEach(button => {
            button.classList.toggle('active', button.dataset.view === nextView);
        });
        if (nextView === 'player') {
            this.closePluginList();
        }
        this.updateAudioResumePrompt();
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

        this.playerView?.remove();
        this.miniPlayer?.remove();
        this.nav?.remove();
        this.fab?.remove();
        this.pluginListCloseButton?.remove();

        this.playerView = null;
        this.emptyPlayer = null;
        this.resumePrompt = null;
        this.miniPlayer = null;
        this.nav = null;
        this.fab = null;
        this.pluginListCloseButton = null;
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
        const trackName = state?.currentTrackName || state?.currentTrack?.name || 'No track loaded';
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
        this.unsubscribe?.();
        this.stateUnsubscribers.forEach(unsubscribe => unsubscribe());
        this.stateUnsubscribers = [];
        this.attachedStateManager = null;
        this.mountAudioPlayer('desktop');
        this.removeMobileElements();
    }
}
