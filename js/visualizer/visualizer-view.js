import { createDefaultLayout, normalizeLayout, layoutsEqual, encodeLayoutShare, decodeLayoutShare, layoutShareParam } from './visualizer-model.js';
import { createShareUrl } from '../utils/pipeline-state-codec.js';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard-utils.js';
import { VisualizerPresetStore } from './visualizer-preset-store.js';
import { VisualizerSources } from './visualizer-sources.js';
import { VisualizerRenderer } from './visualizer-renderer.js';
import { VisualizerEditor } from './visualizer-editor.js';

export class VisualizerView {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.layout = createDefaultLayout();
        this.store = new VisualizerPresetStore({ onError: () => this.notice('visualizer.saveFailed', 'Your layout could not be saved. Check that browser storage is available and try again.') });
        this.sources = new VisualizerSources(uiManager.audioManager);
        this.currentPresetName = '';
        this.quality = localStorage.getItem('effetune_visualizer_quality') || 'auto';
        this.historyDepth = 0;
        this.root = document.createElement('section');
        this.root.id = 'visualizerView';
        this.root.setAttribute('aria-label', 'Visualizer');
        this.root.innerHTML = '<div class="visualizer-toolbar"><button type="button" class="visualizer-edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5L16 3zm-3 3 5 5"/></svg><span></span></button><button type="button" class="visualizer-presets"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span></span></button><button type="button" class="visualizer-share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg><span></span></button><button type="button" class="visualizer-import"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg><span></span></button><label class="visualizer-quality-label"><span></span><select class="visualizer-quality"></select></label></div><div class="visualizer-workspace"><div class="visualizer-stage-host"><div class="visualizer-stage"><canvas></canvas><button type="button" class="visualizer-expand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg></button></div><p class="visualizer-status" role="status" hidden></p></div></div>';
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
        // Labels also serve as the accessible name when the mobile toolbar shows icons only.
        for (const [button, label] of [
            [this.editButton, 'Edit'],
            [this.presetButton, this.t('ui.title.visualizerPresets', 'Visualizer Presets')],
            [this.shareButton, this.t('visualizer.share', 'Share')],
            [this.importButton, this.t('visualizer.importLink', 'Import Link')]
        ]) {
            button.querySelector('span').textContent = label;
            button.title = label;
            button.setAttribute('aria-label', label);
        }
        this.shareButton.addEventListener('click', () => this.share());
        this.importButton.addEventListener('click', () => readTextFromClipboard().then(text => this.importFromText(text)));
        this.expandButton = this.root.querySelector('.visualizer-expand');
        this.stageHost.appendChild(this.expandButton);
        this.updateExpandButtonLabel();
        this.expandButton.addEventListener('click', () => this.setExpanded(!this.expanded));
        this.stage.addEventListener('pointermove', () => this.showControls());
        this.stage.addEventListener('pointerdown', () => this.showControls());
        this.stageHost.addEventListener('pointermove', () => this.showControls());
        this.stageHost.addEventListener('pointerdown', () => this.showControls());
        this.toolbar = this.root.querySelector('.visualizer-toolbar');
        this.qualityLabel = this.root.querySelector('.visualizer-quality-label');
        this.qualityLabel.querySelector('span').textContent = this.t('visualizer.quality', 'Quality');
        const quality = this.qualityLabel.querySelector('select');
        for (const value of ['auto', 'high', 'low']) {
            const option = document.createElement('option'); option.value = value; option.textContent = this.t(`visualizer.quality.${value}`, value); quality.appendChild(option);
        }
        quality.value = this.quality;
        quality.addEventListener('change', () => { this.quality = quality.value; localStorage.setItem('effetune_visualizer_quality', quality.value); });
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
            readTextFromClipboard().then(text => this.importFromText(text));
        });
        document.addEventListener('paste', event => {
            if (!this.acceptsPaste(event)) return;
            event.preventDefault();
            this.importFromText(event.clipboardData?.getData('text/plain') || '');
        });
        window.addEventListener('popstate', event => this.popState(event));
        this.initialized = this.initialize();
    }

    t(key, fallback) { const value = this.uiManager.t(key); return value && value !== key ? value : fallback; }
    notice(key, fallback) { this.noticeText = this.t(key, fallback); this.status.textContent = this.noticeText; this.status.hidden = false; this.noticeActive = true; }
    fail(error) { console.error('Visualizer operation failed:', error); this.notice('visualizer.loadFailed', 'Visualizer could not be opened. Try again.'); }
    async initialize() {
        try {
            const [saved, systems] = await Promise.all([this.store.loadCurrent(), this.store.loadSystemPresets()]);
            this.systems = systems;
            this.setLayout(saved || Object.values(systems['16:9'])[0]);
        } catch (error) { this.fail(error); this.sources.setLayout(this.layout); }
    }
    setLayout(layout) {
        this.layout = normalizeLayout(layout);
        this.changed();
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
    acceptsPaste(event) {
        const target = event.target;
        return document.body.classList.contains('view-visualizer') &&
            !(target?.isContentEditable || target?.matches?.('input, textarea, select'));
    }
    importFromText(text) {
        const encoded = layoutShareParam(text);
        if (encoded) return this.importShared(encoded);
        this.uiManager.showTransientMessage(this.t('visualizer.importLinkMissing', 'No Visualizer link was found. Copy a Visualizer share link, then try again.'), true, {}, 5000);
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
    changed() {
        this.sources.setLayout(this.layout);
        this.store.saveCurrent(this.layout);
        this.stage.style.aspectRatio = this.layout.aspect.replace(':', '/');
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
        this.sources.setVisible(false);
        if (!mini && this.historyDepth && !fromHistory) {
            const depth = this.historyDepth; this.historyDepth = 0; this.ignorePopState = true; history.go(-depth);
        }
    }
    setEditing(open) {
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
        this.sources.setVisible(visible);
        if (visible && !this.frameRequest) this.frameRequest = requestAnimationFrame(time => this.frame(time));
        if (!visible && this.frameRequest) { cancelAnimationFrame(this.frameRequest); this.frameRequest = null; }
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
        if (this.editor.open && document.body.classList.contains('layout-mobile') && !cover) {
            const gutter = 24;
            // Compare the canvas at its unguttered size so the margin does not flip each frame.
            const fullWidth = rect.width / zoom + (hasGutters ? gutter * 2 : 0);
            const fullHeight = rect.height / zoom + (hasGutters ? gutter * 2 / aspect : 0);
            const canvasHeight = Math.min(fullHeight, fullWidth / aspect);
            const bottom = this.uiManager.mobileNav?.nav?.getBoundingClientRect().top ?? window.innerHeight;
            const needsGutters = fullWidth - canvasHeight * aspect < gutter * 2 &&
                rect.top + window.scrollY + (fullHeight + canvasHeight) * zoom / 2 >= bottom;
            if (needsGutters !== hasGutters) {
                this.stageHost.classList.toggle('scroll-gutters', needsGutters);
                stageRect = this.stageHost.getBoundingClientRect();
            }
        } else if (hasGutters) {
            this.stageHost.classList.remove('scroll-gutters');
            stageRect = this.stageHost.getBoundingClientRect();
        }
        const availableWidth = stageRect.width / zoom, availableHeight = stageRect.height / zoom;
        const width = cover ? Math.max(availableWidth, availableHeight * aspect) : Math.min(availableWidth, availableHeight * aspect);
        const height = width / aspect;
        this.stage.style.width = `${Math.max(1, width)}px`; this.stage.style.height = `${Math.max(1, height)}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, this.renderer.quality >= 3 ? 1 : 2);
        const cw = Math.max(1, Math.round(width * dpr)), ch = Math.max(1, Math.round(height * dpr));
        if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
        const state = this.sources.getStatus();
        if (state === 'ready') {
            // Restore the notice text that the unavailable status may have replaced before audio was ready.
            if (!this.noticeActive) this.status.hidden = true;
            else if (this.status.textContent !== this.noticeText) this.status.textContent = this.noticeText;
            const player = this.uiManager.audioPlayer;
            const snapshot = player?.stateManager?.getStateSnapshot();
            const metadata = snapshot?.currentTrack ? player.mediaSessionManager?.buildMetadata(snapshot) : null;
            this.renderer.draw(this.layout, this.sources, metadata, milliseconds / 1000, { editing: this.editor.open, quality: this.quality, pixelRatio: dpr });
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
            renameUserPreset: async (oldName, newName) => { const result = await this.store.renameUserPreset(oldName, newName); if (this.currentPresetName === oldName) this.currentPresetName = newName; return result; },
            deleteUserPresets: async names => { const result = await this.store.deleteUserPresets(names); if (names.includes(this.currentPresetName)) this.currentPresetName = ''; return result; },
            errorKeys: { save: 'error.failedToSavePreset', delete: 'error.failedToDeletePreset' }
        };
        return this.uiManager.pipelineManager.core.pluginPresetDialog.show(provider, this.presetButton);
    }
}
