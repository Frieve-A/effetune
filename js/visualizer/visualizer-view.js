import { createDefaultLayout, normalizeLayout, layoutsEqual, encodeLayoutShare, decodeLayoutShare, layoutShareParam } from './visualizer-model.js';
import { createShareUrl } from '../utils/pipeline-state-codec.js';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard-utils.js';
import { VisualizerPresetStore } from './visualizer-preset-store.js';
import { VisualizerSources } from './visualizer-sources.js';
import { VisualizerRenderer } from './visualizer-renderer.js';
import { VisualizerFeed } from './visualizer-feed.js';
import { VisualizerEditor } from './visualizer-editor.js';
import { VisualizerHistory, layoutSnapshot, snapshotLayout } from './visualizer-history.js';

// Undo, Redo, and Delete stay available on range, color, select, and button controls.
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);
const isTextEntry = target => !!target && (target.isContentEditable || target.tagName === 'TEXTAREA' ||
    (target.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.has(target.type)));

export class VisualizerView {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.layout = createDefaultLayout();
        this.store = new VisualizerPresetStore({ onError: () => this.notice('visualizer.saveFailed', 'Your layout could not be saved. Check that browser storage is available and try again.') });
        this.sources = new VisualizerSources(uiManager.audioManager);
        this.currentPresetName = '';
        this.quality = localStorage.getItem('effetune_visualizer_quality') || 'auto';
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
        this.renderer = new VisualizerRenderer(this.canvas);
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
        this.stage.addEventListener('pointermove', () => this.showControls());
        this.stage.addEventListener('pointerdown', () => this.showControls());
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
            const [saved, systems] = await Promise.all([this.store.loadCurrent(), this.store.loadSystemPresets()]);
            this.systems = systems;
            this.setLayout(saved || Object.values(systems['16:9'])[0]);
        } catch (error) { this.fail(error); this.sources.setLayout(this.layout); }
    }
    setLayout(layout) {
        this.commitPending();
        this.replaceLayout(normalizeLayout(layout));
        this.recordHistory();
    }
    // Shared by setLayout and Undo/Redo; restored snapshots skip normalization so redo entries survive.
    replaceLayout(layout) {
        this.layout = layout;
        this.editor.resetForLayout();
        this.applyLayout();
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
    applyLayout() {
        this.sources.setLayout(this.layout);
        this.store.saveCurrent(this.layout);
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
        clearTimeout(this.controlsTimer);
        cancelAnimationFrame(this.frameRequest); this.frameRequest = null;
        this.sources.setVisible(!!this.feed?.visible);
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
        this.sources.setVisible(visible || !!this.feed?.visible);
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
        const snapshot = player?.stateManager?.getStateSnapshot();
        return snapshot?.currentTrack ? player.mediaSessionManager?.buildMetadata(snapshot) : null;
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
        // While the clean feed is shown, it renders once and this view shows the same pixels at the feed resolution.
        const feed = state === 'ready' && this.feed?.visible ? this.feed.canvas : null;
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
            if (feed) {
                const ctx = this.canvas.getContext('2d');
                ctx.clearRect(0, 0, cw, ch);
                ctx.drawImage(feed, 0, 0);
            } else {
                this.renderer.draw(this.layout, this.sources, this.metadata(), milliseconds / 1000, { editing: this.editor.open, quality: this.quality });
            }
        } else {
            this.canvas.getContext('2d').clearRect(0, 0, cw, ch);
            this.status.hidden = false;
            this.status.textContent = state === 'disabled' ? this.t('visualizer.disabled', 'Enable WebAssembly DSP in Config to use Visualizer.') : this.t('visualizer.unavailable', 'Visualizer is unavailable. Reload the app to try again.');
        }
        this.frameRequest = requestAnimationFrame(time => this.frame(time));
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
