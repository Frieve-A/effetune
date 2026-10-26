import { createDefaultLayout, normalizeLayout, layoutsEqual, encodeLayoutShare, decodeLayoutShare, layoutShareParam } from './visualizer-model.js';
import { createShareUrl } from '../utils/pipeline-state-codec.js';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard-utils.js';
import { VisualizerPresetStore } from './visualizer-preset-store.js';
import { VisualizerSources } from './visualizer-sources.js';
import { VisualizerRenderer } from './visualizer-renderer.js';
import { SynchronizedVideo } from '../ui/audio-player/synchronized-video.js';
import { formatTrackInformation, getTrackInformation } from '../ui/audio-player/track-information.js';
import { hasPlaybackRegionDescriptor } from '../ui/audio-player/playback-region.js';
import { VisualizerFeed } from './visualizer-feed.js';
import { VisualizerEditor } from './visualizer-editor.js';
import { VisualizerHistory, layoutSnapshot, snapshotLayout } from './visualizer-history.js';

// Undo, Redo, and Delete stay available on range, color, select, and button controls.
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
const isTextEntry = target => !!target && (target.isContentEditable || target.tagName === 'TEXTAREA' ||
    (target.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.has(target.type)));
const PLAYBACK_METHODS = { 'play-pause': 'togglePlayPause', stop: 'stop', previous: 'playPrevious', next: 'playNext',
    shuffle: 'toggleShuffleMode', repeat: 'toggleRepeatMode' };

export class VisualizerView {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.layout = createDefaultLayout();
        this.hasLyrics = false;
        this.store = new VisualizerPresetStore({ onError: () => this.notice('visualizer.saveFailed', 'Your layout could not be saved. Check that browser storage is available and try again.') });
        this.sources = new VisualizerSources(uiManager.audioManager);
        this.video = new SynchronizedVideo();
        this.currentPresetName = '';
        this.quality = localStorage.getItem('effetune_visualizer_quality') || 'auto';
        this.hdr = localStorage.getItem('effetune_visualizer_hdr') === 'true';
        this.historyDepth = 0;
        this.history = new VisualizerHistory();
        this.root = document.createElement('section');
        this.root.id = 'visualizerView';
        this.root.setAttribute('aria-label', 'Visualizer');
        this.root.innerHTML = '<div class="visualizer-toolbar"><button type="button" class="header-button visualizer-edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3zm-3 3 5 5"/></svg><span></span></button><div class="pipeline-header-right"><div class="pipeline-toolbar-group"><button type="button" class="header-button undo-button">↶</button><button type="button" class="header-button redo-button">↷</button></div><div class="pipeline-toolbar-group"><button type="button" class="header-button cut-button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.7 20 19.5"/><path d="M20 4.5 8.2 16.3"/><path d="M11.5 12 13 13.2"/></svg></button><button type="button" class="header-button copy-button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M4.5 15.5A2 2 0 0 1 3 13.5v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 1.9"/></svg></button><button type="button" class="header-button paste-button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h2"/></svg></button></div></div><button type="button" class="header-button visualizer-presets"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span></span></button><button type="button" class="header-button visualizer-share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg><span></span></button><button type="button" class="header-button visualizer-import"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg><span></span></button><label class="visualizer-quality-label"><span></span><select class="visualizer-quality"></select></label></div><div class="visualizer-workspace"><div class="visualizer-stage-host"><div class="visualizer-stage"><canvas></canvas><button type="button" class="visualizer-expand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg></button></div><p class="visualizer-status" role="status" hidden></p></div></div>';
        const main = document.querySelector('.main-container');
        main?.parentNode.insertBefore(this.root, main.nextSibling);
        this.stageHost = this.root.querySelector('.visualizer-stage-host');
        this.stage = this.root.querySelector('.visualizer-stage');
        this.canvas = this.stage.querySelector('canvas');
        this.status = this.root.querySelector('.visualizer-status');
        this.hdrCanvas = document.createElement('canvas');
        this.hdrCanvas.className = 'visualizer-hdr-canvas';
        this.hdrCanvas.hidden = true;
        this.hdrCanvas.setAttribute('aria-hidden', 'true');
        this.stage.appendChild(this.hdrCanvas);
        this.renderer = new VisualizerRenderer(this.canvas, { hdrCanvas: this.hdrCanvas });
        this.editor = new VisualizerEditor(this);
        const workspace = this.root.querySelector('.visualizer-workspace');
        workspace.insertBefore(this.editor.navigation, this.stageHost);
        workspace.appendChild(this.editor.root);
        this.presetButton = this.root.querySelector('.visualizer-presets');
        this.presetButton.addEventListener('click', () => this.openPresets().catch(error => this.fail(error)));
        this.editButton = this.root.querySelector('.visualizer-edit');
        this.editButton.addEventListener('click', () => this.setEditing(!this.editor.open));
        this.shareButton = this.root.querySelector('.visualizer-share');
        this.importButton = this.root.querySelector('.visualizer-import');
        [this.undoButton, this.redoButton, this.cutButton, this.copyButton, this.pasteButton] =
            ['undo', 'redo', 'cut', 'copy', 'paste'].map(name => this.root.querySelector(`.${name}-button`));
        this.undoButton.addEventListener('click', () => this.stepHistory('undo'));
        this.redoButton.addEventListener('click', () => this.stepHistory('redo'));
        this.cutButton.addEventListener('click', () => this.editor.cutSelected());
        this.copyButton.addEventListener('click', () => this.editor.copySelected());
        this.pasteButton.addEventListener('click', () => this.pasteFromClipboard());
        this.updateEditButtons();
        this.shareButton.addEventListener('click', () => this.share());
        this.importButton.addEventListener('click', () => this.pasteFromClipboard());
        this.expandButton = this.root.querySelector('.visualizer-expand');
        this.stageHost.appendChild(this.expandButton);
        this.expandButton.addEventListener('click', () => this.setExpanded(!this.expanded));
        this.createPlaybackControls(this.stage);
        this.stage.addEventListener('pointermove', event => {
            this.showControls();
            this.movePlaybackPointer(event);
            this.moveSeekPointer(event);
            const control = this.playbackControlAt(event);
            this.playbackHoveredId = control?.id;
            this.stage.classList.toggle('lyrics-seekable', !!control || !!this.seekBarAt(event) || this.lyricsSeekTime(event) !== null || this.counterAt(event) !== null);
        });
        this.stage.addEventListener('pointerdown', event => { this.showControls(); this.beginPlaybackInteraction(event); });
        this.stage.addEventListener('pointerup', event => this.finishSeekPointer(event));
        this.stage.addEventListener('click', event => { if (!this.activatePlaybackControl(event) && !this.resetCounterAt(event)) this.seekToLyrics(event); });
        this.stage.addEventListener('pointercancel', () => { this.clearPlaybackPointer(); this.cancelSeekPointer(); });
        this.canvas.addEventListener('lostpointercapture', () => this.cancelSeekPointer());
        this.stage.addEventListener('pointerleave', () => { this.playbackHoveredId = null; this.clearPlaybackPointer(); });
        this.stageHost.addEventListener('pointermove', () => this.showControls());
        this.stageHost.addEventListener('pointerdown', () => this.showControls());
        this.toolbar = this.root.querySelector('.visualizer-toolbar');
        this.qualityLabel = this.root.querySelector('.visualizer-quality-label');
        const quality = this.qualityLabel.querySelector('select');
        for (const value of ['auto', 'high', 'low']) {
            const option = document.createElement('option'); option.value = value; quality.appendChild(option);
        }
        quality.value = this.quality;
        quality.addEventListener('change', () => { this.quality = quality.value; localStorage.setItem('effetune_visualizer_quality', quality.value); });
        this.updateUITexts();
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); this.updateVisibility(); });
        window.electronAPI?.onWindowVisibilityChanged?.(() => this.updateVisibility());
        window.addEventListener('pagehide', () => this.flush());
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.expanded) { event.preventDefault(); event.stopPropagation(); this.setExpanded(false); }
        }, true);
        // Electron reads the native clipboard on Ctrl+V; browsers use the paste event to avoid a permission prompt.
        document.addEventListener('keydown', event => {
            if (!(event.ctrlKey || event.metaKey) || event.key?.toLowerCase() !== 'v' ||
                typeof window.electronAPI?.readClipboardText !== 'function' || !this.acceptsPaste(event)) return;
            event.preventDefault();
            this.pasteFromClipboard();
        });
        document.addEventListener('keydown', event => this.onEditKeyDown(event));
        document.addEventListener('paste', event => {
            if (!this.acceptsPaste(event)) return;
            event.preventDefault();
            this.importFromText(event.clipboardData?.getData('text/plain') || '');
        });
        window.addEventListener('popstate', event => this.popState(event));
        this.initialized = this.initialize();
    }

    t(key, fallback) { const value = this.uiManager.t(key); return value && value !== key ? value : fallback; }
    updateUITexts() {
        this.root.setAttribute('aria-label', this.t('ui.title.visualizer', 'Visualizer'));
        // Labels also serve as the accessible name when the mobile toolbar shows icons only.
        for (const [button, label] of [
            [this.editButton, 'Edit'],
            [this.presetButton, this.t('ui.title.visualizerPresets', 'Visualizer Presets')],
            [this.shareButton, this.t('visualizer.share', 'Share')],
            [this.importButton, this.t('visualizer.importLink', 'Import Link')],
            [this.undoButton, this.t('ui.title.undo', 'Undo')],
            [this.redoButton, this.t('ui.title.redo', 'Redo')],
            [this.cutButton, this.t('visualizer.cut', 'Cut items')],
            [this.copyButton, this.t('visualizer.copy', 'Copy items')],
            [this.pasteButton, this.t('visualizer.paste', 'Paste items')]
        ]) {
            const span = button.querySelector('span');
            if (span) span.textContent = label;
            button.title = label;
            button.setAttribute('aria-label', label);
        }
        this.qualityLabel.querySelector('span').textContent = this.t('visualizer.quality', 'Quality');
        for (const option of this.qualityLabel.querySelector('select').options) {
            option.textContent = this.t(`visualizer.quality.${option.value}`, option.value);
        }
        this.updateExpandButtonLabel();
        this.editor.updateUITexts();
        if (this.noticeMessage) {
            const previousText = this.noticeText;
            this.noticeText = this.t(this.noticeMessage.key, this.noticeMessage.fallback);
            if (this.noticeActive && this.status.textContent === previousText) this.status.textContent = this.noticeText;
        }
    }
    notice(key, fallback) {
        this.noticeMessage = { key, fallback };
        this.noticeText = this.t(key, fallback);
        this.status.textContent = this.noticeText; this.status.hidden = false; this.noticeActive = true;
    }
    fail(error) { console.error('Visualizer operation failed:', error); this.notice('visualizer.loadFailed', 'Visualizer could not be opened. Try again.'); }
    async initialize() {
        try {
            let layout = await this.store.loadCurrent();
            if (!layout) {
                this.systems = await this.store.loadSystemPresets();
                layout = Object.values(this.systems['16:9'])[0];
            }
            // Keep the original stored data until an explicit edit, including fields
            // or items this version cannot restore. Startup is a read-only operation.
            this.replaceLayout(normalizeLayout(layout), false);
            this.recordHistory();
        } catch (error) { this.fail(error); this.sources.setLayout(this.layout); }
    }
    setLayout(layout) {
        this.commitPending();
        this.replaceLayout(normalizeLayout(layout));
        this.recordHistory();
    }
    // Shared by setLayout and Undo/Redo; restored snapshots skip normalization so redo entries survive.
    replaceLayout(layout, persist = true) {
        this.layout = layout;
        this.editor.resetForLayout();
        this.applyLayout(persist);
        if (this.editor.open) this.editor.render();
        this.editor.updateSelection();
    }
    async share() {
        const revision = this.shareRevision = (this.shareRevision || 0) + 1;
        const copied = await copyTextToClipboard(createShareUrl('v', encodeLayoutShare(this.layout)));
        if (revision !== this.shareRevision) return;
        if (!copied) {
            console.error('Failed to copy Visualizer share link');
            this.uiManager.setError('error.failedToCopyUrl', true);
            return;
        }
        this.uiManager.showTransientMessage(this.layout.background.image
            ? this.t('visualizer.shareCopiedWithoutImage', 'Link copied to clipboard. The background image is not included in the link.')
            : 'success.urlCopied', false, {}, 3000);
    }
    acceptsLayoutEvent(event) {
        return document.body.classList.contains('view-visualizer') &&
            (this.root.contains(event.target) || event.target === document.body);
    }
    acceptsPaste(event) {
        const target = event.target;
        return this.acceptsLayoutEvent(event) &&
            !(target?.isContentEditable || target?.matches?.('input, textarea, select'));
    }
    pasteFromClipboard() { return readTextFromClipboard().then(text => this.importFromText(text)); }
    // Shared by every paste path: a share link replaces the layout; in Edit, copied items are inserted.
    importFromText(text) {
        const encoded = layoutShareParam(text);
        if (encoded) return this.importShared(encoded);
        if (!this.editor.open) this.warn('visualizer.importLinkMissing', 'No Visualizer link was found. Copy a Visualizer share link, then try again.');
        else if (this.editor.pasteItems(text)) return true;
        else this.warn('visualizer.pasteNothing', 'There are no Visualizer items or link to paste. Copy some items or a Visualizer share link, then try again.');
        return false;
    }
    async importShared(encoded) {
        await this.initialized;
        const layout = decodeLayoutShare(encoded);
        if (!layout) {
            this.notice('visualizer.importFailed', 'This Visualizer link could not be read. It may be incomplete or made with a newer version of EffeTune. Copy the whole link again, or update EffeTune.');
            return false;
        }
        this.noticeActive = false;
        this.setLayout(layout);
        this.currentPresetName = '';
        this.uiManager.showTransientMessage(this.t('visualizer.importSucceeded', 'Loaded the Visualizer layout from the link.'), false, {}, 3000);
        return true;
    }
    warn(key, fallback, params = {}) { this.uiManager.showTransientMessage(this.t(key, fallback), true, params, 5000); }
    // Continuous edits (drags, slider input, arrow-key repeat) are recorded once when they end.
    changed(continuing = false) {
        this.applyLayout();
        if (continuing) this.historyPending = true;
        else this.recordHistory();
    }
    applyLayout(persist = true) {
        this.hasLyrics = this.layout.items.some(item => item.type === 'lyrics');
        this.counters();
        this.video.setEnabled(this.layout.items.some(item => item.type === 'video'));
        this.sources.setLayout(this.layout);
        if (persist) this.store.saveCurrent(this.layout);
        this.stage.style.aspectRatio = this.layout.aspect.replace(':', '/');
    }
    recordHistory() {
        this.historyPending = false;
        this.history.record(layoutSnapshot(this.layout));
        this.updateEditButtons();
    }
    commitPending() { if (this.historyPending) this.recordHistory(); }
    stepHistory(direction) {
        this.commitPending();
        const snapshot = this.history[direction]();
        if (snapshot) this.replaceLayout(snapshotLayout(snapshot));
        this.updateEditButtons();
    }
    // Paste stays enabled because the clipboard is read only when it is used.
    updateEditButtons() {
        this.undoButton.disabled = !this.history.canUndo;
        this.redoButton.disabled = !this.history.canRedo;
        this.cutButton.disabled = this.copyButton.disabled = !this.editor.selection.size;
    }
    onEditKeyDown(event) {
        if (!this.editor.open || !this.acceptsLayoutEvent(event) || event.altKey) return;
        const command = event.ctrlKey || event.metaKey, key = event.key?.toLowerCase();
        let action;
        if (command && !event.shiftKey && (key === 'z' || key === 'y')) {
            if (!isTextEntry(event.target)) action = () => this.stepHistory(key === 'z' ? 'undo' : 'redo');
        } else if (command && !event.shiftKey && (key === 'a' || key === 'x' || key === 'c')) {
            // Cut and Copy with nothing selected leave the key to the browser.
            if (this.acceptsPaste(event) && (key === 'a' || this.editor.selection.size)) {
                action = { a: () => this.editor.selectAll(), x: () => this.editor.cutSelected(), c: () => this.editor.copySelected() }[key];
            }
        } else if (!command && !event.shiftKey && this.editor.selection.size && !isTextEntry(event.target)) {
            if (event.key === 'Delete') action = () => this.editor.deleteSelected();
            else if (event.key === 'Escape' && !event.defaultPrevented) action = () => this.editor.deselectAll();
        }
        if (!action) return;
        event.preventDefault();
        action();
    }
    flush() { void this.store.flushCurrent().catch(error => { console.error('Visualizer save failed:', error); this.notice('visualizer.saveFailed', 'Your layout could not be saved. Check that browser storage is available and try again.'); }); }
    show() {
        this.noticeActive = false;
        if (this.uiManager.layoutMode?.isMobile && this.historyDepth === 0) {
            this.previousMobileView ||= this.uiManager.mobileNav?.getCurrentView() || 'player';
            const depth = history.state?.effetuneVisualizer;
            if (depth === 1 || depth === 2) {
                this.historyDepth = depth;
                this.setExpanded(depth === 2, { fromHistory: true });
            } else {
                this.historyDepth = 1;
                history.pushState({ ...history.state, effetuneVisualizer: 1 }, '');
            }
        }
        this.updateVisibility(); this.showControls();
    }
    hide({ mini = false, fromHistory = false } = {}) {
        this.setEditing(false);
        this.setExpanded(false, { fromHistory: true });
        this.visible = false;
        if (this.playbackControls) this.syncPlaybackControls(this, this.playback(), false);
        clearTimeout(this.controlsTimer);
        cancelAnimationFrame(this.frameRequest); this.frameRequest = null;
        this.sources.setVisible(!!this.feed?.visible);
        this.video.setActive(!!this.feed?.visible);
        if (!mini && this.historyDepth && !fromHistory) {
            const depth = this.historyDepth; this.historyDepth = 0; this.ignorePopState = true; history.go(-depth);
        }
    }
    setEditing(open) {
        if (!open) this.commitPending();
        this.editor.setOpen(open);
        if (open) this.editor.navigation.insertBefore(this.qualityLabel, this.editor.navigationContent);
        else this.toolbar.appendChild(this.qualityLabel);
        this.editButton.setAttribute('aria-pressed', String(open));
        this.syncPlaybackControls();
        if (this.feed) this.syncPlaybackControls(this.feed);
    }
    setHdrEnabled(enabled) {
        this.hdr = enabled === true;
        this.renderer.setHdrEnabled(this.hdr);
        this.feed?.renderer?.setHdrEnabled(this.hdr);
    }
    updateExpandButtonLabel() {
        const label = this.expanded
            ? this.t('visualizer.restore', 'Restore Visualizer size')
            : this.t('visualizer.expand', 'Fill app window');
        this.expandButton.title = label;
        this.expandButton.setAttribute('aria-label', label);
        this.expandButton.setAttribute('aria-pressed', String(!!this.expanded));
    }
    setExpanded(expanded, { fromHistory = false } = {}) {
        if (this.expanded === expanded) return;
        this.expanded = expanded;
        document.body.classList.toggle('visualizer-expanded', expanded);
        this.updateExpandButtonLabel();
        if (expanded) {
            this.setEditing(false);
            if (this.uiManager.layoutMode?.isMobile && !fromHistory) { this.historyDepth++; history.pushState({ ...history.state, effetuneVisualizer: this.historyDepth }, ''); }
        } else if (this.historyDepth > 1 && !fromHistory) {
            this.historyDepth--; this.ignorePopState = true; history.back();
        }
        this.showControls();
    }
    prepareMiniPlayer() { this.setEditing(false); this.setExpanded(false); }
    popState(event) {
        if (this.ignorePopState) { this.ignorePopState = false; return; }
        if (!document.body.classList.contains('view-visualizer')) return;
        const depth = event.state?.effetuneVisualizer || 0;
        this.historyDepth = depth;
        if (depth === 1) this.setExpanded(false, { fromHistory: true });
        else if (!depth) {
            this.uiManager.hideVisualizerView({ fromHistory: true });
            this.uiManager.mobileNav?.setView(this.previousMobileView === 'visualizer' ? 'player' : this.previousMobileView || 'player');
        }
    }
    showControls() {
        this.stageHost.classList.add('show-controls');
        clearTimeout(this.controlsTimer);
        this.controlsTimer = setTimeout(() => this.stageHost.classList.remove('show-controls'), 2500);
    }
    updateVisibility() {
        const hostHidden = this.sources.hostHidden ?? this.uiManager.audioManager.powerPolicyController?.hostHidden;
        const visible = document.body.classList.contains('view-visualizer') && !document.hidden && !hostHidden && !this.uiManager.isDoubleBlindActive();
        this.visible = visible;
        if (this.playbackControls) this.syncPlaybackControls(this, this.playback(), visible);
        this.sources.setVisible(visible || !!this.feed?.visible);
        this.video.setActive(visible || !!this.feed?.visible);
        if (visible && !this.frameRequest) this.frameRequest = requestAnimationFrame(time => this.frame(time));
        if (!visible && this.frameRequest) { cancelAnimationFrame(this.frameRequest); this.frameRequest = null; }
    }
    setFeedState({ open = false, visible = false } = {}) {
        if (this.feed && (!open || this.feed.closed)) { this.feed.dispose(); this.feed = null; }
        if (open && !this.feed) this.feed = new VisualizerFeed(this);
        this.feed?.setVisible(visible);
        this.updateVisibility();
    }
    metadata() {
        const player = this.uiManager.audioPlayer;
        // OpenHome can retain the player and its last track after the UI closes.
        if (!player?.ui?.container) return null;
        const snapshot = player?.stateManager?.getStateSnapshot();
        if (!snapshot?.currentTrack && !snapshot?.liveInputActive) return null;
        const metadata = player.mediaSessionManager?.buildMetadata(snapshot);
        if (!metadata) return null;
        const information = snapshot.liveInputActive ? snapshot.liveInputInformation
            : getTrackInformation(snapshot.currentTrack, metadata);
        return { ...metadata, 'track-info': formatTrackInformation(information,
            (key, fallback) => this.t(key, fallback), snapshot.liveInputActive ? 'AirPlay' : '') };
    }
    lyrics() {
        const player = this.uiManager.audioPlayer;
        if (!this.hasLyrics || !player?.ui?.container || !player.trackLyrics) return null;
        const snapshot = player.stateManager.getStateSnapshot();
        if (!snapshot.currentTrack) return null;
        const data = player.trackLyrics.get(snapshot.currentTrack);
        if (!data) return null;
        const position = snapshot.isPlaying ? player.contextManager.getCurrentPlaybackTime() : snapshot.currentTrackPosition;
        return { data, time: this.uiManager.audioManager.getAudiblePlaybackPosition(position, snapshot.playbackSpeed),
            duration: snapshot.currentTrackDuration, isStopped: snapshot.isStopped };
    }
    playbackTarget() { return this.uiManager.getPlaybackTarget?.() ?? this.uiManager.audioPlayer; }
    playbackLabels(playing, repeat) {
        return {
            'play-pause': this.t(playing ? 'visualizer.playback.pause' : 'visualizer.playback.play', playing ? 'Pause' : 'Play'),
            stop: this.t('ui.title.stop', 'Stop'), previous: this.t('ui.title.prevTrack', 'Previous track'),
            next: this.t('ui.title.nextTrack', 'Next track'), shuffle: this.t('ui.title.shuffle', 'Toggle shuffle'),
            repeat: this.t(`visualizer.playback.repeat${repeat === 'ONE' ? 'One' : repeat === 'ALL' ? 'All' : 'Off'}`, `Repeat ${repeat.toLowerCase()}`)
        };
    }
    playback(target = this.playbackTarget(), owner = this) {
        const state = target?.ui?.container ? target.stateManager?.getStateSnapshot?.() : null;
        const present = !!state;
        const available = !!state && state.controlsEnabled !== false &&
            (target.isRemote || state.liveInputActive || !!state.currentTrack || state.playlistLength > 0);
        const enabled = Object.fromEntries(Object.entries(PLAYBACK_METHODS).map(([action, method]) => {
            const receiver = action === 'shuffle' || action === 'repeat' ? target?.playbackManager : target;
            const capability = action === 'play-pause' ? (state?.isPlaying ? 'pause' : 'play') : action;
            return [action, !!available && typeof receiver?.[method] === 'function' &&
                (!state.transportCapabilities || state.transportCapabilities[capability] === true) &&
                !(action === 'shuffle' && state.repeatMode === 'ONE')];
        }));
        const duration = Number.isFinite(state?.currentTrackDuration) && state.currentTrackDuration > 0 ? state.currentTrackDuration : 0;
        const currentTime = state?.isPlaying ? target.contextManager?.getCurrentPlaybackTime?.() : state?.currentTrackPosition;
        const position = Math.max(0, Math.min(duration, Number.isFinite(currentTime) ? currentTime : 0));
        const seek = this.seekGesture || owner.seekGesture || this.feed?.seekGesture;
        return { available: present, playing: !!state?.isPlaying, stopped: !state || !!state.isStopped,
            shuffle: !!state?.shuffleMode, repeat: state?.repeatMode || 'OFF', enabled,
            position, duration, seekEnabled: !!available && duration > 0 && state.seekBarEnabled === true &&
                typeof target.contextManager?.seek === 'function' && (!state.transportCapabilities || state.transportCapabilities.seek === true),
            seekingId: seek?.id, seekPosition: seek ? seek.value * duration : undefined,
            labels: this.playbackLabels(!!state?.isPlaying, state?.repeatMode || 'OFF'),
            focusedId: this.playbackFocusedId || owner.playbackFocusedId || this.feed?.playbackFocusedId,
            hoveredId: this.playbackHoveredId || owner.playbackHoveredId || this.feed?.playbackHoveredId,
            pressedId: this.playbackPressedId || owner.playbackPressedId || this.feed?.playbackPressedId };
    }
    runPlaybackAction(action) {
        const target = this.playbackTarget();
        if (this.editor.open || !this.playback(target).enabled[action]) return Promise.resolve(false);
        const receiver = action === 'shuffle' || action === 'repeat' ? target.playbackManager : target;
        const command = () => receiver[PLAYBACK_METHODS[action]]();
        // The shared executor invokes local commands on the click stack, preserving the audio gesture.
        return target.playbackManager.runPlaybackCommand(command);
    }
    playbackItemAt(event, owner = this) {
        if (this.editor.open || !this.playback().available || event.target?.closest?.('button, input')) return null;
        const rect = owner.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return owner.renderer.playbackItemAt?.(this.layout,
            (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height) ?? null;
    }
    playbackControlAt(event, owner = this) {
        const hit = this.playbackItemAt(event, owner);
        return hit?.action ? hit : null;
    }
    beginPlaybackInteraction(event, owner = this) {
        const hit = this.playbackItemAt(event, owner);
        if (!this.beginSeekPointer(event, owner, hit && 'value' in hit ? hit : null)) {
            this.beginCounterPointer(event);
            this.beginPlaybackPointer(event, owner, hit?.action ? hit : null);
        }
    }
    beginPlaybackPointer(event, owner = this, hit = this.playbackControlAt(event, owner)) {
        if (event.button > 0) hit = null;
        owner.playbackPointer = { x: event.clientX, y: event.clientY, id: hit?.id, editing: this.editor.open };
        owner.playbackPressedId = hit?.id;
    }
    clearPlaybackPointer(owner = this) { owner.playbackPointer = null; owner.playbackPressedId = null; }
    movePlaybackPointer(event, owner = this) {
        const start = owner.playbackPointer;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
            start.moved = true;
            owner.playbackPressedId = null;
        }
    }
    activatePlaybackControl(event, owner = this) {
        if (owner.seekClick) { owner.seekClick = false; return true; }
        const start = owner.playbackPointer, hit = this.playbackControlAt(event, owner);
        this.clearPlaybackPointer(owner);
        if (!hit) return false;
        // Consume disabled controls too, so a control cannot seek lyrics or reset a counter behind it.
        if (!event.defaultPrevented && start?.id === hit.id && !start.editing && !start.moved &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) {
            void this.runPlaybackAction(hit.action);
        }
        return true;
    }
    seekBarAt(event, owner = this) {
        const hit = this.playbackItemAt(event, owner);
        return hit && 'value' in hit ? hit : null;
    }
    seekPlayback(value, expectedTarget = this.playbackTarget(), expectedTrack = expectedTarget?.stateManager?.getStateSnapshot?.().currentTrack) {
        const target = this.playbackTarget(), playback = this.playback(target);
        if (this.editor.open || !playback.seekEnabled || !Number.isFinite(value) || target !== expectedTarget ||
            target.stateManager.getStateSnapshot().currentTrack !== expectedTrack) return Promise.resolve(false);
        return target.playbackManager.runPlaybackCommand(() => {
            target.resumeAudioContextInGesture?.();
            return target.contextManager.seek(Math.max(0, Math.min(1, value)) * playback.duration);
        });
    }
    beginSeekPointer(event, owner = this, hit = this.seekBarAt(event, owner)) {
        if (owner.seekGesture) return true;
        owner.seekClick = false;
        if (event.button > 0) return false;
        if (!hit) return false;
        owner.seekClick = true;
        if (!this.playback().seekEnabled) return true;
        const target = this.playbackTarget();
        owner.seekGesture = { id: hit.id, value: hit.value, pointerId: event.pointerId, target,
            track: target.stateManager.getStateSnapshot().currentTrack };
        owner.canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault?.();
        return true;
    }
    moveSeekPointer(event, owner = this) {
        const seek = owner.seekGesture;
        if (!seek || seek.pointerId !== event.pointerId) return;
        const rect = owner.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const value = owner.renderer.seekBarValue(this.layout, seek.id,
            (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        if (Number.isFinite(value)) seek.value = Math.max(0, Math.min(1, value));
    }
    finishSeekPointer(event, owner = this) {
        const seek = owner.seekGesture;
        if (!seek || seek.pointerId !== event.pointerId) return;
        this.moveSeekPointer(event, owner);
        this.cancelSeekPointer(owner);
        void this.seekPlayback(seek.value, seek.target, seek.track);
    }
    cancelSeekPointer(owner = this) {
        const seek = owner.seekGesture;
        owner.seekGesture = null;
        if (seek && owner.canvas.hasPointerCapture?.(seek.pointerId)) owner.canvas.releasePointerCapture(seek.pointerId);
    }
    createPlaybackControls(host, owner = this) {
        const group = host.ownerDocument.createElement('div');
        group.className = 'visualizer-playback-accessibility';
        // Native buttons preserve Tab, Enter, and Space activation; focus is drawn on the canvas item.
        group.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
        host.appendChild(group);
        owner.playbackControls = group;
        owner.playbackButtons = new Map();
    }
    syncPlaybackControls(owner = this, playback = this.playback(undefined, owner), active = true) {
        if (!owner.playbackControls) return;
        const shown = playback.available && !this.editor.open && active;
        if (!shown) {
            owner.playbackFocusedId = null;
            owner.playbackHoveredId = null;
            this.clearPlaybackPointer(owner);
            this.cancelSeekPointer(owner);
        }
        const items = shown ? this.layout.items.filter(item => item.type === 'playback-control' || item.type === 'seek-bar') : [];
        if (owner.canvas?.style) owner.canvas.style.touchAction = items.some(item => item.type === 'seek-bar') ? 'none' : '';
        const ids = new Set(items.map(item => item.id));
        if (owner.seekGesture && (!ids.has(owner.seekGesture.id) || !playback.seekEnabled)) this.cancelSeekPointer(owner);
        for (const [id, button] of owner.playbackButtons) {
            if (!ids.has(id)) { button.remove(); owner.playbackButtons.delete(id); }
        }
        for (const item of items) {
            const range = item.type === 'seek-bar';
            let button = owner.playbackButtons.get(item.id);
            if (!button) {
                button = owner.playbackControls.ownerDocument.createElement(range ? 'input' : 'button');
                button.type = range ? 'range' : 'button';
                button.addEventListener('focus', () => { owner.playbackFocusedId = item.id; this.showControls(); });
                button.addEventListener('blur', () => { if (owner.playbackFocusedId === item.id) owner.playbackFocusedId = null; });
                button.addEventListener('click', event => {
                    event.stopPropagation();
                    const current = this.layout.items.find(value => value.id === item.id);
                    if (current && !range) void this.runPlaybackAction(current.params.action);
                });
                if (range) {
                    button.min = '0'; button.step = '1';
                    button.addEventListener('keydown', event => event.stopPropagation());
                    button.addEventListener('change', () => void this.seekPlayback(Number(button.value) / Number(button.max)));
                }
                owner.playbackButtons.set(item.id, button);
            }
            const action = item.params.action;
            if (range) {
                button.setAttribute('aria-label', this.t('visualizer.type.seek-bar', 'Seek Bar'));
                button.max = String(playback.duration || 1);
                button.value = String(playback.position);
                button.setAttribute('aria-valuetext', [playback.position, playback.duration].map(seconds =>
                    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`).join(' / '));
                button.disabled = !playback.seekEnabled;
            } else {
                if (button.textContent !== playback.labels[action]) button.textContent = playback.labels[action];
                button.disabled = !playback.enabled[action];
            }
            if (action === 'shuffle') button.setAttribute('aria-pressed', String(playback.shuffle));
            else button.removeAttribute('aria-pressed');
            // Append only when the layout order changed, keeping keyboard focus stable during playback.
            const index = items.indexOf(item);
            if (owner.playbackControls.children[index] !== button) owner.playbackControls.insertBefore(button, owner.playbackControls.children[index] || null);
        }
        if (!ids.has(owner.playbackFocusedId) || this.editor.open || !active) owner.playbackFocusedId = null;
    }
    counters(now = performance.now()) {
        const items = this.layout.items.filter(item => item.type === 'counter');
        this.counterOrigins ||= new Map();
        const ids = new Set(items.map(item => item.id));
        for (const id of this.counterOrigins.keys()) if (!ids.has(id)) this.counterOrigins.delete(id);
        if (!items.length) return new Map();
        const player = this.uiManager.audioPlayer;
        const snapshot = player?.ui?.container ? player.stateManager.getStateSnapshot() : null;
        const live = snapshot?.liveInputActive === true;
        const external = !snapshot?.currentTrack && !live;
        const position = external ? 0 : snapshot.isPlaying ? player.contextManager.getCurrentPlaybackTime() : snapshot.currentTrackPosition;
        return new Map(items.map(item => {
            if (!this.counterOrigins.has(item.id)) this.counterOrigins.set(item.id, now);
            return [item.id, {
                time: external ? Math.max(0, (now - this.counterOrigins.get(item.id)) / 1000) : Math.max(0, position || 0),
                trackIndex: external || live ? 0 : Math.max(0, snapshot.currentTrackIndex + 1), external,
                playing: external || !!snapshot.isPlaying,
                speed: external ? 1 : snapshot.playbackSpeed || 1,
                source: external ? this.counterOrigins.get(item.id) : live ? player.airPlayPlayback : snapshot.currentTrack,
                stamp: now / 1000
            }];
        }));
    }
    resetCounter(id, now = performance.now()) {
        if (!this.counters(now).get(id)?.external) return false;
        this.counterOrigins.set(id, now);
        return true;
    }
    beginCounterPointer(event) {
        this.counterPointerStart = { x: event.clientX, y: event.clientY, editing: this.editor.open };
    }
    counterAt(event, canvas = this.canvas, renderer = this.renderer) {
        if (this.editor.open || event.target?.closest?.('button')) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const id = renderer.counterAt(this.layout, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        return id && this.counters().get(id)?.external ? id : null;
    }
    resetCounterAt(event, canvas = this.canvas, renderer = this.renderer) {
        const start = this.counterPointerStart;
        this.counterPointerStart = null;
        if (event.defaultPrevented || start?.editing || (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5)) return false;
        const id = this.counterAt(event, canvas, renderer);
        return id !== null && this.resetCounter(id);
    }
    // Click-to-seek uses the renderer that drew the visible pixels; Edit keeps clicks for item selection.
    lyricsSeekTime(event) {
        if (this.editor.open || !this.hasLyrics || event.target.closest?.('button')) return null;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return this.renderer.lyricsSeekTime(this.layout, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    }
    seekToLyrics(event) {
        const time = this.lyricsSeekTime(event), player = this.uiManager.audioPlayer;
        if (time === null || !player?.contextManager || !player.stateManager.getStateSnapshot().seekBarEnabled) return;
        player.resumeAudioContextInGesture?.();
        player.contextManager.seek(Math.max(0, time));
    }
    frame(milliseconds) {
        this.frameRequest = null;
        if (!this.visible) return;
        const rect = this.stageHost.getBoundingClientRect();
        const zoom = parseFloat(document.body.style.zoom) || 1;
        const [aw, ah] = this.layout.aspect.split(':').map(Number), aspect = aw / ah;
        const cover = this.expanded || document.body.classList.contains('layout-mini-player');
        let stageRect = rect;
        const hasGutters = this.stageHost.classList.contains('scroll-gutters');
        // The entire editing viewport handles touch gestures; page scrolling needs space outside it.
        const needsGutters = !!this.editor.open && document.body.classList.contains('layout-mobile') && !cover;
        if (needsGutters !== hasGutters) {
            this.stageHost.classList.toggle('scroll-gutters', needsGutters);
            stageRect = this.stageHost.getBoundingClientRect();
        }
        const availableWidth = stageRect.width / zoom, availableHeight = stageRect.height / zoom;
        const editSize = this.editor.open ? this.editor.updateViewport?.(availableWidth, availableHeight) : null;
        const width = editSize?.width ?? (cover ? Math.max(availableWidth, availableHeight * aspect) : Math.min(availableWidth, availableHeight * aspect));
        const height = editSize?.height ?? width / aspect;
        this.stage.style.width = `${Math.max(1, width)}px`; this.stage.style.height = `${Math.max(1, height)}px`;
        const state = this.sources.getStatus();
        const playback = this.playback();
        this.syncPlaybackControls(this, playback, state === 'ready');
        // Edit has its own previews; only presentation can share the clean feed composition.
        const feed = !this.editor.open && state === 'ready' && this.feed?.visible ? this.feed.canvas : null;
        const dpr = Math.min(window.devicePixelRatio || 1, this.renderer.quality >= 3 ? 1 : 2);
        // Edit zoom enlarges the CSS artboard independently of raster size. Cap its longest
        // raster edge so portrait artboards at 400% cannot allocate enormous effect layers.
        const renderScale = this.editor.open ? Math.min(dpr, 4096 / width, 4096 / height) : dpr;
        const cw = feed ? feed.width : Math.max(1, Math.round(width * renderScale)), ch = feed ? feed.height : Math.max(1, Math.round(height * renderScale));
        if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
        if (state === 'ready') {
            // Restore the notice text that the unavailable status may have replaced before audio was ready.
            if (!this.noticeActive) this.status.hidden = true;
            else if (this.status.textContent !== this.noticeText) this.status.textContent = this.noticeText;
            if (!feed || !this.renderer.copyFrom(this.feed.renderer, { hdr: this.hdr })) {
                this.renderer.draw(this.layout, this.sources, this.metadata(), milliseconds / 1000, { editing: this.editor.open, quality: this.quality, hdr: this.hdr, lyrics: this.lyrics(), video: this.videoFrame(), counters: this.counters(), playback });
            }
        } else {
            this.renderer.clear();
            this.status.hidden = false;
            this.status.textContent = state === 'disabled' ? this.t('visualizer.disabled', 'Enable WebAssembly DSP in Config to use Visualizer.') : this.t('visualizer.unavailable', 'Visualizer is unavailable. Reload the app to try again.');
        }
        this.frameRequest = requestAnimationFrame(time => this.frame(time));
    }
    videoFrame() {
        if (!this.video.enabled || !this.video.active) return null;
        const player = this.uiManager.audioPlayer;
        // OpenHome can retain the player and its last track after the UI closes.
        const snapshot = player?.ui?.container ? player.stateManager?.getStateSnapshot() : null;
        if (!snapshot) {
            this.video.load(null);
            return null;
        }
        const track = snapshot?.currentTrack;
        const source = track && !hasPlaybackRegionDescriptor(track) ? track.mediaSource ?? track.file ?? track.path ?? null : null;
        const playable = (source instanceof Blob || (typeof source === 'string' && source)) &&
            [track.path, track.file?.name, track.name, typeof source === 'string' ? source : source.name]
                .some(name => typeof name === 'string' && /\.(3gp|m4v|mkv|mov|mp4|webm)(?:[?#].*)?$/i.test(name));
        const presentation = player?.contextManager?.getVideoPresentation?.();
        if (presentation) this.video.setPresentation(hasPlaybackRegionDescriptor(track)
            ? { ...presentation, source: null } : presentation);
        else this.video.load(playable ? (source instanceof Blob ? source : player.contextManager.getMediaElementSourceUrl(source)) : null);
        const position = snapshot.isPlaying ? player.contextManager.getCurrentPlaybackTime() : snapshot.currentTrackPosition;
        const target = this.uiManager.audioManager.getAudiblePlaybackPosition(position, snapshot.playbackSpeed);
        return this.video.frame(target, snapshot.playbackSpeed, snapshot.isPlaying);
    }
    async openPresets() {
        this.systems ||= await this.store.loadSystemPresets();
        const groups = Object.entries(this.systems).map(([aspect, entries]) => ({ label: aspect, presets: Object.entries(entries).map(([name, layout]) => ({ id: `${aspect}/${name}`, label: name, layout })) }));
        const all = groups.flatMap(group => group.presets);
        const provider = {
            getTitleKey: () => 'ui.title.visualizerPresets', getSystemPresetGroups: () => groups,
            getActiveSystemPresetId: () => all.find(preset => layoutsEqual(preset.layout, this.layout))?.id || '',
            getActiveUserPresetName: () => this.currentPresetName, getDefaultSaveName: () => this.currentPresetName,
            getPresetContext: () => this,
            listUserPresetNames: () => this.store.listUserPresetNames(),
            applySystemPreset: id => { const preset = all.find(value => value.id === id); if (!preset) return false; this.setLayout(preset.layout); this.currentPresetName = ''; return true; },
            applyUserPreset: async name => { const layout = await this.store.getUserPreset(name); if (!layout) return false; this.setLayout(layout); this.currentPresetName = name; return true; },
            saveUserPreset: async name => { await this.store.saveUserPreset(name, this.layout); this.currentPresetName = name; return true; },
            renameUserPreset: async (oldName, newName) => { const result = await this.store.renameUserPreset(oldName, newName); if (result && this.currentPresetName === oldName) this.currentPresetName = newName; return result; },
            deleteUserPresets: async names => { const result = await this.store.deleteUserPresets(names); if (names.includes(this.currentPresetName)) this.currentPresetName = ''; return result; },
            errorKeys: { save: 'error.failedToSavePreset', delete: 'error.failedToDeletePreset' }
        };
        return this.uiManager.pipelineManager.core.pluginPresetDialog.show(provider, this.presetButton);
    }
}
