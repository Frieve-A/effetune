/**
 * DoubleBlindTest - A/B/X blind listening test for the two effect pipelines.
 *
 * Mirrors the behaviour of Frieve Sound ABX Tester, adapted to EffeTune:
 *  - The two "samples" under test are pipeline A and pipeline B (no audio URIs).
 *  - Playback is left entirely to EffeTune (internal player or external stream);
 *    this controller only switches the active pipeline and records the verdicts.
 *  - "Switch to A / B / X" route the live audio through the mapped pipeline,
 *    fading out -> swapping -> waiting -> fading in so the swap stays silent.
 *
 * While the test is open the whole effect pipeline display is detached from the
 * DOM, URL reflection is suppressed and pipeline switching shortcuts/paste are
 * disabled, so the listener cannot tell which pipeline is currently playing.
 */

import {
    getSerializablePluginStateShort,
    applySerializedState
} from '../../utils/serialization-utils.js';
import {
    encodePipelineState,
    decodePipelineState
} from '../../utils/pipeline-state-codec.js';
import { copyTextToClipboard } from '../../utils/clipboard-utils.js';

const CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// Save / delete glyphs reuse the exact markup of the Effect Preset buttons.
const SAVE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M15.2 3.5a2 2 0 0 1 1.4.6l3.3 3.3a2 2 0 0 1 .6 1.4V18.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M16.5 20.5v-6a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v6"/><path d="M8 3.5v3.2a1 1 0 0 0 1 1h5"/></svg>';
const DELETE_ICON = CLOSE_ICON;

const FADE_SECONDS = 0.05;   // master fade duration on exit
const DIP_FADE = 0.04;       // fade out / fade in time for each switch press
const DIP_MS = 90;           // time from press to fade-in start (silent dip)

export class DoubleBlindTest {
    constructor(uiManager) {
        this.uiManager = uiManager;
        this.audioManager = uiManager.audioManager;
        this.pluginManager = uiManager.pluginManager;

        this.active = false;
        this.container = null;
        this.els = {};

        this._savedCurrentPipeline = 'A';
        this._switchSeq = 0;             // guards rapid presses' delayed fade-ins
        this._mainContainer = null;
        this._savedMainChildren = null;

        this._resetTestState();
    }

    t(key, params) {
        return this.uiManager.t(key, params);
    }

    isActive() {
        return this.active;
    }

    /** Both pipelines must hold at least one plugin for the test to be available. */
    static abValid(audioManager) {
        const a = audioManager?.pipelineA;
        const b = audioManager?.pipelineB;
        return Array.isArray(a) && a.length > 0 && Array.isArray(b) && b.length > 0;
    }

    _resetTestState() {
        this.testType = 'ABX';       // 'ABX' | 'ABPREF'
        this.testName = '';          // describes what difference is being tested
        this.testCount = 20;
        this.localName = '';
        this.name = '';
        this.correctCount = 0;       // ABX: correct identifications
        this.totalCount = 0;
        this.prefACount = 0;         // ABPREF: trials where physical A was preferred
        this.startTime = 0;
        this.timeSpent = 0;
        this.restoredFromURI = false;
        this.testRunning = false;
        this._activeLabel = null;    // 'A' | 'B' | 'X'
        this._aIsPhysicalA = true;   // does on-screen label A map to physical pipeline A?
        this._xIsA = true;           // does X match on-screen label A?
    }

    // ===================================================================== //
    //  Entry points                                                         //
    // ===================================================================== //

    /**
     * Open the test panel for a fresh test (menu / shortcut entry).
     * The panel can always be opened - a saved test can be recalled from here -
     * so this no longer requires both pipelines to be present. If Pipeline B is
     * missing, a warning is shown and the start buttons stay disabled.
     */
    enterFresh() {
        if (this.active) return;
        this._resetTestState();
        this._enter();
        this._showConfigScreen();
        this.updateTexts();
        this._updateStartAvailability();
        this._loadTestList().catch(() => {});
    }

    /**
     * Restore both pipelines from a Double Blind Test share payload and open the
     * panel. Used by the web URL loader and by paste handling.
     * @param {string} encoded - base64 payload from the `dbt` URL parameter
     * @returns {boolean} success
     */
    restoreFromShare(encoded) {
        if (this.active) return false;
        let obj;
        try {
            if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) {
                throw new Error('Invalid base64 characters in dbt parameter');
            }
            obj = decodePipelineState(encoded);
        } catch (err) {
            console.error('[DoubleBlindTest] Failed to decode share payload:', err);
            return false;
        }
        if (!obj || !Array.isArray(obj.pA) || !Array.isArray(obj.pB)) {
            console.error('[DoubleBlindTest] Share payload missing pipelines');
            return false;
        }

        const buildPipeline = (states) => states.flatMap((state) => {
            try {
                const plugin = this.pluginManager.createPlugin(state.nm);
                if (!plugin) return [];
                applySerializedState(plugin, state);
                if (plugin.updateParameters) plugin.updateParameters();
                this.uiManager.expandedPlugins.add(plugin);
                return plugin;
            } catch (error) {
                console.warn(`[DoubleBlindTest] Failed to create plugin '${state.nm}':`, error);
                return [];
            }
        });

        const pluginsA = buildPipeline(obj.pA);
        const pluginsB = buildPipeline(obj.pB);
        if (pluginsA.length === 0 || pluginsB.length === 0) {
            console.error('[DoubleBlindTest] Restored pipelines are empty');
            return false;
        }

        this.audioManager.pipelineA = pluginsA;
        this.audioManager.pipelineB = pluginsB;
        // Default the live pipeline to A; switching during the test re-routes it.
        this.audioManager.setCurrentPipeline('A', true);

        this._resetTestState();
        this.testType = (obj.tT === 'ABPREF') ? 'ABPREF' : 'ABX';
        this.testName = obj.tn || '';
        this.testCount = Math.max(1, parseInt(obj.tc, 10) || 20);
        this.name = obj.n || '';
        this.correctCount = obj.cC || 0;
        this.totalCount = obj.tC || 0;
        this.prefACount = obj.pa || 0;
        this.timeSpent = obj.ts || 0;
        this.restoredFromURI = true;

        this._enter();
        this._showConfigScreen();
        this._applyConfigToInputs();
        this._updateStartAvailability();
        this._loadTestList(this.testName).catch(() => {});

        // A completed shared result is shown read-only (no re-share).
        if (this.totalCount > 0 && this.totalCount === this.testCount) {
            this._displayResult();
        }
        this.updateTexts();
        return true;
    }

    // ===================================================================== //
    //  Mode lifecycle                                                       //
    // ===================================================================== //

    _enter() {
        this.active = true;
        this._savedCurrentPipeline = this.audioManager.currentPipeline || 'A';
        this._applyGating(true);
        this._buildPanel();
        // While the test is running, the A / B / X keys switch the active sample
        // exactly as if the matching switch button had been pressed.
        this._keydownHandler = (e) => this._onKeyDown(e);
        document.addEventListener('keydown', this._keydownHandler);
        this._refreshNativeMenu();
    }

    /** Close the test and restore the normal UI. */
    exit() {
        if (!this.active) return;
        this.active = false;

        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }

        // Tear down the parallel pipelines and make sure output is audible again.
        try { this.audioManager.disableParallelPipelines(); } catch (_) { /* ignore */ }
        try { this.audioManager.fadeInOutput(FADE_SECONDS); } catch (_) { /* ignore */ }

        this._removePanel();
        this._applyGating(false);

        // Restore the pre-test active pipeline.
        try {
            this.audioManager.setCurrentPipeline(this._savedCurrentPipeline || 'A', true);
            this.uiManager.updatePipelineToggleButton();
            this.uiManager.pipelineManager.updatePipelineUI();
        } catch (_) { /* ignore */ }

        this._refreshNativeMenu();
    }

    _applyGating(on) {
        const ui = this.uiManager;
        if (on) {
            ui.urlReflectionEnabled = false;
            // Strip any pipeline params so nothing about the pipelines leaks via URL.
            try {
                window.history.replaceState({}, '', window.location.origin + window.location.pathname);
            } catch (_) { /* ignore (e.g. file:// in Electron) */ }
            this._detachPipelineUI();
        } else {
            this._reattachPipelineUI();
            ui.urlReflectionEnabled = true;
            try { ui.updateURL(); } catch (_) { /* ignore */ }
        }
    }

    /** Remove the entire effect-pipeline display from the DOM (not just hide it). */
    _detachPipelineUI() {
        this._mainContainer = document.querySelector('.main-container');
        if (!this._mainContainer) return;

        // The body is `width: max-content`, so the full-width Player and Double
        // Blind Test panels normally take their width from the pipeline area
        // (.main-container). Once we empty + hide it that reference is gone and
        // the panels would collapse, so pin the body's min-width to the pipeline
        // width that was on screen, keeping both panels exactly as wide. Mobile
        // layout is already viewport constrained, so a desktop min-width would
        // create horizontal overflow if the panel is opened after a resize.
        const pipelineWidth = Math.round(this._mainContainer.getBoundingClientRect().width);
        const isMobileLayout = !!window.uiManager?.layoutMode?.isMobile ||
            document.body.classList.contains('layout-mobile');
        if (pipelineWidth > 0 && !isMobileLayout) {
            this._savedBodyMinWidth = document.body.style.minWidth;
            document.body.style.minWidth = pipelineWidth + 'px';
        }

        this._savedMainChildren = Array.from(this._mainContainer.childNodes);
        // Keep the .main-container element itself (the player insert logic relies
        // on querySelector('.main-container')) but empty + hide it so the
        // pipeline content is gone from the DOM entirely.
        this._mainContainer.replaceChildren();
        this._savedMainDisplay = this._mainContainer.style.display;
        this._mainContainer.style.display = 'none';
    }

    _reattachPipelineUI() {
        if (this._mainContainer) {
            if (this._savedMainChildren) {
                this._mainContainer.append(...this._savedMainChildren);
            }
            this._mainContainer.style.display = this._savedMainDisplay || '';
        }
        // Restore the body's original min-width.
        if (this._savedBodyMinWidth !== undefined) {
            document.body.style.minWidth = this._savedBodyMinWidth;
            this._savedBodyMinWidth = undefined;
        }
        this._mainContainer = null;
        this._savedMainChildren = null;
    }

    _refreshNativeMenu() {
        if (this.uiManager.refreshApplicationMenu) {
            this.uiManager.refreshApplicationMenu();
        }
    }

    // ===================================================================== //
    //  Panel construction                                                   //
    // ===================================================================== //

    _buildPanel() {
        const container = document.createElement('div');
        container.className = 'double-blind-test';
        container.innerHTML = `
            <div class="dbt-header">
                <h2>Double Blind Test</h2>
                <button class="player-button dbt-close-button" type="button">${CLOSE_ICON}</button>
            </div>

            <div class="dbt-config">
                <div class="dbt-result hidden">
                    <div class="dbt-result-testname"></div>
                    <h3 class="dbt-result-title"></h3>
                    <div class="dbt-result-answers"></div>
                    <div class="dbt-result-time"></div>
                    <div class="dbt-result-pvalue"></div>
                    <div class="dbt-result-conclusion"></div>
                    <button class="header-button dbt-share-button" type="button"></button>
                    <p class="dbt-share-explanation"></p>
                </div>

                <div class="dbt-config-form">
                    <label class="dbt-testname-label"></label>
                    <div class="dbt-testname-row">
                        <div class="select-container">
                            <input type="text" class="preset-select dbt-testname-input" list="dbtTestList" />
                            <button type="button" class="input-clear-button preset-clear-button dbt-testname-clear" aria-label="Clear test name">&times;</button>
                        </div>
                        <datalist id="dbtTestList"></datalist>
                        <button class="header-button save-button dbt-test-save-button" type="button">${SAVE_ICON}</button>
                        <button class="header-button delete-preset-button dbt-test-delete-button" type="button">${DELETE_ICON}</button>
                    </div>

                    <label class="dbt-name-label"></label>
                    <input class="dbt-name-input" type="text" />

                    <label class="dbt-count-label"></label>
                    <div class="dbt-count-row">
                        <input class="dbt-count-input" type="number" min="1" value="20" />
                        <input class="dbt-count-range" type="range" min="5" max="50" value="20" />
                    </div>

                    <div class="dbt-start-buttons">
                        <button class="header-button dbt-start-abx" type="button"></button>
                        <button class="header-button dbt-start-abpref" type="button"></button>
                    </div>
                    <div class="dbt-b-warning hidden"></div>
                    <div class="dbt-config-share-row">
                        <button class="header-button dbt-config-share-button" type="button"></button>
                    </div>
                    <div class="dbt-config-error hidden"></div>
                    <ul class="dbt-config-info"></ul>
                </div>
            </div>

            <div class="dbt-test hidden">
                <div class="dbt-switch-buttons">
                    <button class="header-button dbt-switch-a" type="button"></button>
                    <button class="header-button dbt-switch-b" type="button"></button>
                    <button class="header-button dbt-switch-x" type="button"></button>
                </div>
                <div class="dbt-listening"></div>
                <div class="dbt-samplerate"></div>
                <p class="dbt-instruction"></p>
                <div class="dbt-vote-buttons">
                    <button class="header-button dbt-vote-a" type="button"></button>
                    <button class="header-button dbt-vote-b" type="button"></button>
                </div>
                <h3 class="dbt-progress"></h3>
                <div class="dbt-progress-container">
                    <div class="dbt-progress-bar"></div>
                </div>
                <ul class="dbt-test-info"></ul>
            </div>
        `;

        const q = (sel) => container.querySelector(sel);
        this.els = {
            close: q('.dbt-close-button'),
            config: q('.dbt-config'),
            configForm: q('.dbt-config-form'),
            test: q('.dbt-test'),
            result: q('.dbt-result'),
            resultTitle: q('.dbt-result-title'),
            resultAnswers: q('.dbt-result-answers'),
            resultTime: q('.dbt-result-time'),
            resultPvalue: q('.dbt-result-pvalue'),
            resultConclusion: q('.dbt-result-conclusion'),
            resultTestName: q('.dbt-result-testname'),
            shareBtn: q('.dbt-share-button'),
            shareExplanation: q('.dbt-share-explanation'),
            testNameLabel: q('.dbt-testname-label'),
            testNameInput: q('.dbt-testname-input'),
            testNameClear: q('.dbt-testname-clear'),
            testList: q('#dbtTestList'),
            testSaveBtn: q('.dbt-test-save-button'),
            testDeleteBtn: q('.dbt-test-delete-button'),
            bWarning: q('.dbt-b-warning'),
            nameLabel: q('.dbt-name-label'),
            nameInput: q('.dbt-name-input'),
            configShareBtn: q('.dbt-config-share-button'),
            countLabel: q('.dbt-count-label'),
            countInput: q('.dbt-count-input'),
            countRange: q('.dbt-count-range'),
            startAbx: q('.dbt-start-abx'),
            startAbpref: q('.dbt-start-abpref'),
            configError: q('.dbt-config-error'),
            configInfo: q('.dbt-config-info'),
            switchA: q('.dbt-switch-a'),
            switchB: q('.dbt-switch-b'),
            switchX: q('.dbt-switch-x'),
            listening: q('.dbt-listening'),
            sampleRate: q('.dbt-samplerate'),
            instruction: q('.dbt-instruction'),
            voteA: q('.dbt-vote-a'),
            voteB: q('.dbt-vote-b'),
            progress: q('.dbt-progress'),
            progressBar: q('.dbt-progress-bar'),
            testInfo: q('.dbt-test-info')
        };

        // --- listeners ---
        this.els.close.addEventListener('click', () => this.exit());
        this.els.startAbx.addEventListener('click', () => this._startTest('ABX'));
        this.els.startAbpref.addEventListener('click', () => this._startTest('ABPREF'));
        this.els.shareBtn.addEventListener('click', () => this._share());
        this.els.configShareBtn.addEventListener('click', () => this._share());

        this.els.testNameInput.addEventListener('input', () => {
            this.testName = this.els.testNameInput.value;
            this._updateTestNameClear();
            this._updateStartAvailability();
        });
        // Clear the test name with the x button or the ESC key (like Effect Preset).
        this.els.testNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.els.testNameInput.value = '';
                this.testName = '';
                this._updateTestNameClear();
                this._updateStartAvailability();
            }
        });
        this.els.testNameClear.addEventListener('click', () => {
            this.els.testNameInput.value = '';
            this.testName = '';
            this._updateTestNameClear();
            this._updateStartAvailability();
            this.els.testNameInput.focus();
        });
        // Save / recall / delete named tests (like Effect Presets).
        this.els.testSaveBtn.addEventListener('click', () => {
            const name = this.els.testNameInput.value.trim();
            if (name) this._saveTest(name);
        });
        this.els.testDeleteBtn.addEventListener('click', async () => {
            const name = this.els.testNameInput.value.trim();
            const tests = await this._getTests();
            if (name && tests[name] && confirm(this.t('dbt.deleteConfirm'))) {
                this._deleteTest(name);
            }
        });
        this.els.testNameInput.addEventListener('change', async () => {
            const name = this.els.testNameInput.value.trim();
            this.testName = name;
            const tests = await this._getTests();
            if (tests[name]) this._loadTest(name);
        });
        this.els.nameInput.addEventListener('input', () => {
            this.localName = this.els.nameInput.value;
        });
        this.els.countInput.addEventListener('input', () => {
            this.els.countRange.value = this.els.countInput.value;
            this.uiManager.refreshRangeFillStyling?.(this.els.countRange);
        });
        this.els.countRange.addEventListener('input', () => {
            this.els.countInput.value = this.els.countRange.value;
        });

        this.els.switchA.addEventListener('click', () => this._switchToLabel('A'));
        this.els.switchB.addEventListener('click', () => this._switchToLabel('B'));
        this.els.switchX.addEventListener('click', () => this._switchToLabel('X'));
        this.els.voteA.addEventListener('click', () => this._vote('A'));
        this.els.voteB.addEventListener('click', () => this._vote('B'));

        this.container = container;

        // Insert into the DOM: at the top, below the player if one is present.
        const mainContainer = document.querySelector('.main-container');
        const player = document.querySelector('.audio-player');
        if (player && player.parentNode) {
            player.parentNode.insertBefore(container, player.nextSibling);
        } else if (mainContainer && mainContainer.parentNode) {
            mainContainer.parentNode.insertBefore(container, mainContainer);
        } else {
            document.body.appendChild(container);
        }
    }

    _removePanel() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.els = {};
    }

    _showConfigScreen() {
        if (!this.els.config) return;
        this.els.config.classList.remove('hidden');
        this.els.test.classList.add('hidden');
    }

    _showTestScreen() {
        this.els.config.classList.add('hidden');
        this.els.test.classList.remove('hidden');
    }

    _applyConfigToInputs() {
        if (!this.els.nameInput) return;
        this.els.testNameInput.value = this.testName || '';
        this.els.countInput.value = this.testCount;
        this.els.countRange.value = (this.testCount >= 5 && this.testCount <= 50) ? this.testCount : 20;
        this.uiManager.refreshRangeFillStyling?.(this.els.countRange);
        this.els.nameInput.value = '';
        this._updateTestNameClear();
    }

    /** Show the test-name clear (x) button only when the field has text. */
    _updateTestNameClear() {
        if (this.els.testNameClear && this.els.testNameInput) {
            this.els.testNameClear.classList.toggle('visible', this.els.testNameInput.value.length > 0);
        }
    }

    /**
     * Reflect what is currently possible:
     *  - Start buttons need both pipelines (otherwise the Pipeline B warning shows).
     *  - Share buttons need both pipelines AND a test name, so the shared test is
     *    meaningful and recallable; otherwise nothing useful could be copied.
     */
    _updateStartAvailability() {
        const valid = DoubleBlindTest.abValid(this.audioManager);
        if (this.els.startAbx) this.els.startAbx.disabled = !valid;
        if (this.els.startAbpref) this.els.startAbpref.disabled = !valid;
        if (this.els.bWarning) this.els.bWarning.classList.toggle('hidden', valid);

        const canShare = valid && (this.testName || '').trim().length > 0;
        if (this.els.configShareBtn) this.els.configShareBtn.disabled = !canShare;
        if (this.els.shareBtn) this.els.shareBtn.disabled = !canShare;
    }

    // ===================================================================== //
    //  Saved tests (named A/B + settings, stored like Effect Presets)       //
    // ===================================================================== //

    async _getTests() {
        try {
            if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
                const appPath = await window.electronAPI.getPath('userData');
                const filePath = await window.electronAPI.joinPaths(appPath, 'effetune_dbt_tests.json');
                if (!(await window.electronAPI.fileExists(filePath))) return {};
                const result = await window.electronAPI.readFile(filePath);
                if (!result.success) throw new Error(result.error);
                return JSON.parse(result.content);
            }
            const json = localStorage.getItem('effetune_dbt_tests');
            return json ? JSON.parse(json) : {};
        } catch (err) {
            console.error('[DoubleBlindTest] Failed to load saved tests:', err);
            return {};
        }
    }

    async _persistTests(tests) {
        if (window.electronAPI && window.electronIntegration && window.electronIntegration.isElectron) {
            const appPath = await window.electronAPI.getPath('userData');
            const filePath = await window.electronAPI.joinPaths(appPath, 'effetune_dbt_tests.json');
            await window.electronAPI.saveFile(filePath, JSON.stringify(tests, null, 2));
        } else {
            localStorage.setItem('effetune_dbt_tests', JSON.stringify(tests));
        }
    }

    async _loadTestList(preserve = null) {
        const datalist = this.els.testList;
        if (!datalist) return;
        const current = preserve !== null ? preserve : (this.els.testNameInput?.value || '');
        datalist.innerHTML = '';
        const tests = await this._getTests();
        Object.keys(tests).sort().forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            datalist.appendChild(opt);
        });
        if (this.els.testNameInput) this.els.testNameInput.value = current;
        this._updateTestNameClear();
    }

    async _saveTest(name) {
        try {
            const tests = await this._getTests();
            const tc = parseInt(this.els.countInput.value, 10);
            tests[name] = {
                v: 1,
                tc: (isNaN(tc) || tc < 1) ? this.testCount : tc,
                pA: (this.audioManager.pipelineA || []).map(getSerializablePluginStateShort),
                pB: (this.audioManager.pipelineB || []).map(getSerializablePluginStateShort)
            };
            await this._persistTests(tests);
            this.testName = name;
            await this._loadTestList(name);
            this.uiManager.setError(this.t('dbt.testSaved', { name }), false);
            setTimeout(() => this.uiManager.clearError(), 3000);
        } catch (err) {
            console.error('[DoubleBlindTest] Failed to save test:', err);
            this.uiManager.setError(this.t('dbt.testSaveFailed'), true);
            setTimeout(() => this.uiManager.clearError(), 3000);
        }
    }

    async _deleteTest(name) {
        try {
            const tests = await this._getTests();
            if (!tests[name]) return;
            delete tests[name];
            await this._persistTests(tests);
            await this._loadTestList('');
            this.uiManager.setError(this.t('dbt.testDeleted', { name }), false);
            setTimeout(() => this.uiManager.clearError(), 3000);
        } catch (err) {
            console.error('[DoubleBlindTest] Failed to delete test:', err);
            this.uiManager.setError(this.t('dbt.testDeleteFailed'), true);
            setTimeout(() => this.uiManager.clearError(), 3000);
        }
    }

    /** Recall a saved test: restore both pipelines and settings, then resume. */
    async _loadTest(name) {
        const tests = await this._getTests();
        const t = tests[name];
        if (!t) return;

        const buildPipeline = (states) => (states || []).flatMap((state) => {
            try {
                const plugin = this.pluginManager.createPlugin(state.nm);
                if (!plugin) return [];
                applySerializedState(plugin, state);
                if (plugin.updateParameters) plugin.updateParameters();
                this.uiManager.expandedPlugins.add(plugin);
                return plugin;
            } catch (error) {
                console.warn(`[DoubleBlindTest] Failed to create plugin '${state.nm}':`, error);
                return [];
            }
        });

        const pluginsA = buildPipeline(t.pA);
        const pluginsB = buildPipeline(t.pB);
        this.audioManager.pipelineA = pluginsA;
        this.audioManager.pipelineB = pluginsB.length ? pluginsB : null;
        this.audioManager.setCurrentPipeline('A', true);

        this.testName = name;
        this.testCount = Math.max(1, parseInt(t.tc, 10) || 20);
        this._applyConfigToInputs();
        this._updateStartAvailability();

        this.uiManager.setError(this.t('dbt.testLoaded', { name }), false);
        setTimeout(() => this.uiManager.clearError(), 3000);
    }

    // ===================================================================== //
    //  Localised text                                                       //
    // ===================================================================== //

    updateTexts() {
        if (!this.container) return;
        const e = this.els;

        if (e.close) e.close.title = this.t('dbt.close');
        if (e.testNameLabel) e.testNameLabel.textContent = this.t('dbt.testName');
        if (e.testNameInput) {
            e.testNameInput.placeholder = this.t('dbt.testNamePlaceholder');
            e.testNameInput.title = this.t('dbt.testNameTitle');
        }
        // Save / Delete are icon buttons (SVG); only set their tooltips.
        if (e.testSaveBtn) e.testSaveBtn.title = this.t('dbt.save');
        if (e.testDeleteBtn) e.testDeleteBtn.title = this.t('dbt.delete');
        if (e.testNameClear) e.testNameClear.title = this.t('dbt.clearTestName');
        if (e.bWarning) e.bWarning.textContent = this.t('dbt.bWarning');
        this._updateTestNameClear();
        if (e.nameLabel) e.nameLabel.textContent = this.t('dbt.yourName');
        if (e.nameInput) e.nameInput.placeholder = this.t('dbt.anonymous');
        if (e.countLabel) e.countLabel.textContent = this.t('dbt.numberOfTests');
        if (e.startAbx) e.startAbx.textContent = this.t('dbt.startABX');
        if (e.startAbpref) e.startAbpref.textContent = this.t('dbt.startABPref');
        if (e.shareBtn) e.shareBtn.textContent = this.t('dbt.share');
        if (e.configShareBtn) e.configShareBtn.textContent = this.t('dbt.share');
        if (e.shareExplanation) e.shareExplanation.textContent = this.t('dbt.shareExplanation');

        if (e.configInfo) {
            e.configInfo.innerHTML = '';
            [this.t('dbt.info.config1'), this.t('dbt.info.config2'), this.t('dbt.info.config3')]
                .forEach((line) => {
                    const li = document.createElement('li');
                    li.textContent = line;
                    e.configInfo.appendChild(li);
                });
        }

        if (e.switchA) e.switchA.textContent = this.t('dbt.switchToA');
        if (e.switchB) e.switchB.textContent = this.t('dbt.switchToB');
        if (e.switchX) e.switchX.textContent = this.t('dbt.switchToX');

        if (this.testType === 'ABPREF') {
            if (e.voteA) e.voteA.textContent = this.t('dbt.preferA');
            if (e.voteB) e.voteB.textContent = this.t('dbt.preferB');
            if (e.instruction) e.instruction.textContent = this.t('dbt.instructionABPref');
        } else {
            if (e.voteA) e.voteA.textContent = this.t('dbt.voteXisA');
            if (e.voteB) e.voteB.textContent = this.t('dbt.voteXisB');
            if (e.instruction) e.instruction.textContent = this.t('dbt.instructionABX');
        }

        if (e.testInfo) {
            const lines = (this.testType === 'ABPREF')
                ? [this.t('dbt.info.test1'), this.t('dbt.info.test2'), this.t('dbt.info.testPref')]
                : [this.t('dbt.info.test1'), this.t('dbt.info.test2'), this.t('dbt.info.testAbx')];
            e.testInfo.innerHTML = '';
            lines.forEach((line) => {
                const li = document.createElement('li');
                li.textContent = line;
                e.testInfo.appendChild(li);
            });
        }

        this._updateSampleRateText();
    }

    _updateSampleRateText() {
        if (!this.els.sampleRate) return;
        const ctx = this.audioManager?.audioContext;
        if (ctx && ctx.sampleRate) {
            this.els.sampleRate.textContent = this.t('dbt.sampleRate', { rate: ctx.sampleRate });
        } else {
            this.els.sampleRate.textContent = '';
        }
    }

    // ===================================================================== //
    //  Test flow                                                            //
    // ===================================================================== //

    _startTest(type) {
        // Both pipelines are required to run a test (Pipeline B may be missing
        // when the panel is opened just to recall a saved test).
        if (!DoubleBlindTest.abValid(this.audioManager)) {
            this._updateStartAvailability();
            return;
        }
        const tc = parseInt(this.els.countInput.value, 10);
        this.els.configError.classList.add('hidden');
        if (isNaN(tc) || tc < 1) {
            this.els.configError.textContent = this.t('dbt.error.invalidConfig');
            this.els.configError.classList.remove('hidden');
            return;
        }

        this.testType = type;
        this.testCount = tc;
        this.name = '';
        this.correctCount = 0;
        this.totalCount = 0;
        this.prefACount = 0;
        this.startTime = Date.now();
        this.timeSpent = 0;
        this.restoredFromURI = false;
        this.testRunning = true;

        this.els.result.classList.add('hidden');
        this._showTestScreen();
        this.updateTexts();

        // Run both pipelines in parallel for the duration of the test so that
        // switching is a glitch-free, constant-CPU cross-fade.
        Promise.resolve(this.audioManager.enableParallelPipelines('A')).catch((err) =>
            console.warn('[DoubleBlindTest] Failed to enable parallel pipelines:', err));

        this._nextTrial();
    }

    _nextTrial() {
        if (this.totalCount >= this.testCount) {
            this._finishTest();
            return;
        }
        // Hide the X switch button for preference tests.
        this.els.switchX.style.display = (this.testType === 'ABX') ? '' : 'none';

        const current = this.totalCount + 1;
        this.els.progress.textContent = this.t('dbt.progress', { current, total: this.testCount });
        this.els.progressBar.style.width = ((this.totalCount / this.testCount) * 100) + '%';
        this.els.listening.textContent = '';
        this._activeLabel = null;

        // Randomise the label -> pipeline mapping for this trial.
        this._aIsPhysicalA = Math.random() < 0.5;
        this._xIsA = Math.random() < 0.5;
        this._updateSampleRateText();
    }

    /** Resolve which physical pipeline ('A'|'B') an on-screen label routes to. */
    _physicalFor(label) {
        if (label === 'A') return this._aIsPhysicalA ? 'A' : 'B';
        if (label === 'B') return this._aIsPhysicalA ? 'B' : 'A';
        // X follows whichever label it matches this trial.
        return this._physicalFor(this._xIsA ? 'A' : 'B');
    }

    /**
     * Keyboard shortcuts during a running test: A / B / X (or 1 / 2 / 3 on the
     * top row or numpad) switch the active sample, mirroring a click on the
     * matching switch button, while Q / W cast the vote (X-matches-A / Prefer-A
     * and the B equivalents). Ignored while a text field is focused or when a
     * modifier key is held, so they don't interfere with typing the tester's
     * name or normal browser/OS shortcuts.
     */
    _onKeyDown(e) {
        if (!this.active || !this.testRunning) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.repeat) return;

        const target = e.target;
        if (target) {
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
        }

        // Q / W cast the vote for A / B, mirroring a click on the vote buttons.
        switch (e.key) {
            case 'q': case 'Q': e.preventDefault(); this._vote('A'); return;
            case 'w': case 'W': e.preventDefault(); this._vote('B'); return;
        }

        // Accept both the A/B/X letters and the 1/2/3 keys (top-row and numpad,
        // which both report '1'/'2'/'3' in e.key) so the active sample can be
        // switched without moving the hand across the keyboard.
        let label = null;
        switch (e.key) {
            case 'a': case 'A': case '1': label = 'A'; break;
            case 'b': case 'B': case '2': label = 'B'; break;
            case 'x': case 'X': case '3': label = 'X'; break;
            default: return;
        }
        // X is only meaningful in ABX tests; let _switchToLabel reject it otherwise.
        if (label === 'X' && this.testType !== 'ABX') return;

        e.preventDefault();
        this._switchToLabel(label);
    }

    _switchToLabel(label) {
        if (!this.testRunning) return;
        if (label === 'X' && this.testType !== 'ABX') return;

        this._activeLabel = label;
        this.els.listening.textContent = this.t('dbt.listeningTo', { label });
        this._highlightSwitch(label);

        // Always fade the master output out, swap, and fade back in on EVERY
        // press - including re-selecting the current sample (A->A, B->B). The
        // identical dip means the listener cannot tell from the audio whether a
        // switch actually happened, so pressing the same button can't be used to
        // cheat. Both pipelines keep running in parallel during the dip, so the
        // selected branch is already in steady state (no dynamics/CPU tell).
        const seq = ++this._switchSeq;
        const am = this.audioManager;
        try { am.fadeOutOutput(DIP_FADE); } catch (_) { /* ignore */ }
        am.setBlindSelection(this._physicalFor(label), DIP_FADE);
        setTimeout(() => {
            if (seq !== this._switchSeq || !this.active || !this.testRunning) return;
            try { am.fadeInOutput(DIP_FADE); } catch (_) { /* ignore */ }
        }, DIP_MS);
    }

    _highlightSwitch(label) {
        const map = { A: this.els.switchA, B: this.els.switchB, X: this.els.switchX };
        Object.values(map).forEach((btn) => btn && btn.classList.remove('active'));
        if (map[label]) map[label].classList.add('active');
    }

    _vote(label) {
        if (!this.testRunning) return;

        if (this.testType === 'ABX') {
            // Correct when the chosen label matches the label X was assigned to.
            const correct = (label === 'A') ? this._xIsA : !this._xIsA;
            if (correct) this.correctCount++;
        } else {
            // Preference: record which physical pipeline was preferred.
            if (this._physicalFor(label) === 'A') this.prefACount++;
        }
        this.totalCount++;
        this._nextTrial();
    }

    _finishTest() {
        this.timeSpent = this.startTime ? (Date.now() - this.startTime) : this.timeSpent;
        this.testRunning = false;
        this.name = this.localName || this.t('dbt.anonymous');
        // Stop the parallel pipelines now that switching is over, and make sure
        // the master output is restored (a switch dip may have been in progress).
        this._switchSeq++;
        try { this.audioManager.disableParallelPipelines(); } catch (_) { /* ignore */ }
        try { this.audioManager.fadeInOutput(FADE_SECONDS); } catch (_) { /* ignore */ }
        this._showConfigScreen();
        this._displayResult();
    }

    // ===================================================================== //
    //  Result + sharing                                                     //
    // ===================================================================== //

    _displayResult() {
        const e = this.els;
        e.result.classList.remove('hidden');

        // Show the test name (what difference was tested), if provided.
        if (e.resultTestName) {
            if (this.testName) {
                e.resultTestName.textContent = this.t('dbt.result.testLabel', { name: this.testName });
                e.resultTestName.classList.remove('hidden');
            } else {
                e.resultTestName.textContent = '';
                e.resultTestName.classList.add('hidden');
            }
        }
        // The result has its own share button; hide the config-page one to avoid
        // showing two identical buttons.
        if (e.configShareBtn) e.configShareBtn.classList.add('hidden');

        const total = this.totalCount;
        if (this.testType === 'ABX') {
            const percent = total === 0 ? 0 : ((this.correctCount / total) * 100).toFixed(1);
            e.resultTitle.textContent = this.t('dbt.result.abxTitle', { name: this.name, percent });
            e.resultAnswers.textContent = this.t('dbt.result.correctAnswers', { correct: this.correctCount, total });

            const pVal = this._binomialOneSided(this.correctCount, total);
            if (pVal < 0.05) {
                e.resultPvalue.textContent = this.t('dbt.result.significantP', { p: pVal.toFixed(4) });
                e.resultConclusion.textContent = this.t('dbt.result.abxSignificant', { name: this.name });
            } else {
                e.resultPvalue.textContent = this.t('dbt.result.notSignificantP', { p: pVal.toFixed(4) });
                e.resultConclusion.textContent = this.t('dbt.result.abxNotSignificant', { name: this.name });
            }
        } else {
            const countA = this.prefACount;
            const countB = total - countA;
            const preferred = countA >= countB ? 'A' : 'B';
            const prefCount = Math.max(countA, countB);
            const percent = total === 0 ? 0 : ((prefCount / total) * 100).toFixed(1);
            e.resultTitle.textContent = this.t('dbt.result.abprefTitle', { name: this.name, percent, pipeline: preferred });
            e.resultAnswers.textContent = this.t('dbt.result.preferenceCount', { pipeline: preferred, count: prefCount, total });

            const pVal = this._binomialTwoSided(prefCount, total);
            if (pVal < 0.05) {
                e.resultPvalue.textContent = this.t('dbt.result.significantP', { p: pVal.toFixed(4) });
                e.resultConclusion.textContent = this.t('dbt.result.abprefSignificant', { name: this.name, pipeline: preferred });
            } else {
                e.resultPvalue.textContent = this.t('dbt.result.notSignificantP', { p: pVal.toFixed(4) });
                e.resultConclusion.textContent = this.t('dbt.result.abprefNotSignificant', { name: this.name });
            }
        }

        const ms = this.timeSpent;
        const s = Math.floor(ms / 1000) % 60;
        const m = Math.floor(ms / 1000 / 60);
        e.resultTime.textContent = this.t('dbt.result.totalTime', { minutes: m, seconds: String(s).padStart(2, '0') });

        // A restored, already-completed result is read-only (no re-share).
        if (this.restoredFromURI) {
            e.shareBtn.classList.add('hidden');
            e.shareExplanation.classList.add('hidden');
        } else {
            e.shareBtn.classList.remove('hidden');
            e.shareExplanation.classList.remove('hidden');
        }
        // Disable the result share button unless a test name is also set.
        this._updateStartAvailability();
    }

    _buildSharePayload() {
        return {
            v: 1,
            n: this.name,
            tn: this.testName,
            tT: this.testType,
            tc: this.testCount,
            cC: this.correctCount,
            tC: this.totalCount,
            pa: this.prefACount,
            ts: this.timeSpent,
            pA: (this.audioManager.pipelineA || []).map(getSerializablePluginStateShort),
            pB: (this.audioManager.pipelineB || []).map(getSerializablePluginStateShort)
        };
    }

    async _share() {
        const encoded = encodePipelineState(this._buildSharePayload());
        const url = new URL('https://effetune.frieve.com/effetune.html');
        url.searchParams.set('dbt', encoded);
        const text = url.toString();

        const ok = await copyTextToClipboard(text);
        if (ok) {
            this.uiManager.setError(this.t('dbt.copySuccess'), false);
            setTimeout(() => this.uiManager.clearError(), 3000);
        } else {
            this.uiManager.setError(this.t('dbt.copyFailure'), true);
        }
    }

    // ===================================================================== //
    //  Statistics                                                           //
    // ===================================================================== //

    _binomialOneSided(k, n) {
        if (n === 0) return 1;
        let p = 0;
        for (let i = k; i <= n; i++) {
            p += this._binomialCoeff(n, i) * Math.pow(0.5, n);
        }
        return Math.min(1, p);
    }

    _binomialTwoSided(k, n) {
        if (n === 0) return 1;
        // k is the larger of the two counts (>= n/2); double the upper tail.
        return Math.min(1, 2 * this._binomialOneSided(k, n));
    }

    _binomialCoeff(n, k) {
        // Multiplicative form keeps the magnitude small and is exact for n<=~1000.
        if (k < 0 || k > n) return 0;
        k = Math.min(k, n - k);
        let result = 1;
        for (let i = 0; i < k; i++) {
            result = result * (n - i) / (i + 1);
        }
        return result;
    }
}
