import { PluginPresetStore } from './plugin-preset-store.js';

const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function t(key, fallback) {
    return window.uiManager ? window.uiManager.t(key) : fallback;
}

function normalizeName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name && !RESERVED_NAMES.has(name) ? name : '';
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function presetValuesEqual(current, expected) {
    if (current === expected) return true;
    if (!current || !expected || typeof current !== 'object' || typeof expected !== 'object') {
        return false;
    }
    if (Array.isArray(current) || Array.isArray(expected)) {
        return Array.isArray(current) && Array.isArray(expected) &&
            current.length === expected.length &&
            current.every((value, index) => presetValuesEqual(value, expected[index]));
    }
    const currentKeys = Object.keys(current);
    const expectedKeys = Object.keys(expected);
    return currentKeys.length === expectedKeys.length &&
        expectedKeys.every(key => Object.hasOwn(current, key) &&
            presetValuesEqual(current[key], expected[key]));
}

export class PluginPresetProvider {
    constructor(pipelineCore, plugin, store = new PluginPresetStore()) {
        this.pipelineCore = pipelineCore;
        this.plugin = plugin;
        this.store = store;
        this.errorKeys = {
            save: 'error.failedToSavePluginPreset',
            delete: 'error.failedToDeletePluginPreset'
        };
    }

    getTitleKey() {
        return 'ui.title.effectPresets';
    }

    getSystemPresetGroups() {
        const getGroups = this.plugin.constructor?.getSystemPresetGroups;
        return typeof getGroups === 'function' ? getGroups.call(this.plugin.constructor) : [];
    }

    getActiveSystemPresetId() {
        if (typeof this.plugin.getActiveSystemPresetId === 'function') {
            return this.plugin.getActiveSystemPresetId() || '';
        }
        if (typeof this.plugin.getParameters !== 'function') return '';
        const parameters = this.plugin.getParameters();
        const excludedKeys = new Set(
            this.plugin.constructor?.getPresetComparisonExcludedKeys?.() || []
        );
        for (const group of this.getSystemPresetGroups()) {
            for (const preset of group.presets || []) {
                const matches = Object.entries(preset.params || {}).every(([key, value]) =>
                    excludedKeys.has(key) || key === 'type' || key === 'enabled' ||
                    presetValuesEqual(parameters[key], value)
                );
                if (matches) return preset.id;
            }
        }
        return '';
    }

    getActiveUserPresetName() {
        return '';
    }

    getPresetContext() {
        return this.plugin;
    }

    getDefaultSaveName() {
        return '';
    }

    isAttachedToPipeline() {
        const pipeline = this.pipelineCore.audioManager?.pipeline;
        return !Array.isArray(pipeline) || pipeline.includes(this.plugin);
    }

    async listUserPresetNames() {
        return Object.keys(await this.store.getForPlugin(this.plugin.name));
    }

    async applySystemPreset(id) {
        const groups = this.getSystemPresetGroups() || [];
        const preset = groups.flatMap(group => group.presets || []).find(item => item.id === id);
        if (!preset) return false;
        return this.applyParameters(() => {
            if (typeof this.plugin.applySystemPreset === 'function') {
                return this.plugin.applySystemPreset(id) !== false;
            }
            this.plugin.setParameters(clone(preset.params));
            return true;
        });
    }

    async applyUserPreset(name) {
        const presets = await this.store.getForPlugin(this.plugin.name);
        if (!Object.hasOwn(presets, name)) return false;
        return this.applyParameters(() => {
            const parameters = clone(presets[name]);
            if (typeof this.plugin.setSerializedParameters === 'function') {
                this.plugin.setSerializedParameters(parameters);
            } else {
                this.plugin.setParameters(parameters);
            }
            return true;
        });
    }

    applyParameters(apply) {
        if (!this.isAttachedToPipeline()) return false;
        const historyManager = this.pipelineCore.pipelineManager?.historyManager;
        const applyAndUpdate = () => {
            const applied = apply();
            if (!applied) return false;
            this.pipelineCore.updateWorkletPlugin(this.plugin);
            this.plugin.syncUIControls?.();
            return true;
        };
        const applied = historyManager
            ? historyManager.withHistorySuppressed(applyAndUpdate)
            : applyAndUpdate();
        if (!applied) return false;
        historyManager?.saveState();
        return true;
    }

    async saveUserPreset(name) {
        if (!this.isAttachedToPipeline()) return false;
        const params = clone(this.plugin.getSerializableParameters());
        delete params.enabled;
        delete params.ib;
        delete params.ob;
        delete params.ch;
        return this.store.save(this.plugin.name, name, params);
    }

    renameUserPreset(oldName, newName) {
        return this.store.rename(this.plugin.name, oldName, newName);
    }

    deleteUserPresets(names) {
        return this.store.remove(this.plugin.name, names);
    }
}

export class PluginPresetDialog {
    constructor(pipelineCore) {
        this.pipelineCore = pipelineCore;
        this.store = new PluginPresetStore();
        this.closeHandler = null;
        this.closeHandlerTimer = null;
        this.generation = 0;
        this.renderRevision = 0;
        this.lastPresetByContext = new WeakMap();
        this.activeProvider = null;
    }

    showPlugin(plugin, anchorButton, options) {
        return this.show(new PluginPresetProvider(this.pipelineCore, plugin, this.store), anchorButton, options);
    }

    async show(provider, anchorButton, { focusSaveName = false } = {}) {
        this.close();
        this.activeProvider = provider;
        const generation = this.generation;

        const dialog = document.createElement('div');
        dialog.className = 'preset-dialog';
        dialog.tabIndex = -1;
        dialog.appendChild(this.createHeader(provider));

        const content = document.createElement('div');
        content.className = 'preset-dialog-content';
        dialog.appendChild(content);

        const saveRow = document.createElement('div');
        saveRow.className = 'preset-dialog-save-row';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'preset-dialog-name-input';
        nameInput.placeholder = t('ui.pluginPresets.namePlaceholder', 'Preset name');
        nameInput.value = provider.getDefaultSaveName?.() || '';
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'header-button save-button preset-dialog-save-button';
        saveButton.title = t('ui.pluginPresets.save', 'Save');
        saveButton.setAttribute('aria-label', t('ui.pluginPresets.save', 'Save'));
        saveButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false" aria-hidden="true"><path d="M15.2 3.5a2 2 0 0 1 1.4.6l3.3 3.3a2 2 0 0 1 .6 1.4V18.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M16.5 20.5v-6a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v6"/><path d="M8 3.5v3.2a1 1 0 0 0 1 1h5"/></svg>';
        const updateSaveState = () => {
            saveButton.disabled = !normalizeName(nameInput.value);
        };
        const save = async () => {
            const name = normalizeName(nameInput.value);
            if (!name) return;
            const saved = await provider.saveUserPreset(name);
            if (!saved) {
                this.reportError(provider, provider.errorKeys.save);
                return;
            }
            await this.renderContent(content, provider, generation, saveRow);
        };
        nameInput.addEventListener('input', updateSaveState);
        nameInput.addEventListener('keydown', async event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await save();
            }
        });
        saveButton.addEventListener('click', save);
        updateSaveState();
        saveRow.appendChild(nameInput);
        saveRow.appendChild(saveButton);

        document.body.appendChild(dialog);
        this.pipelineCore.routingDialog.positionDialog(dialog, anchorButton);
        await this.renderContent(content, provider, generation, saveRow);
        if (generation !== this.generation || document.querySelector('.preset-dialog') !== dialog) return dialog;
        this.setupCloseHandler(dialog, anchorButton, generation);
        this.setupKeyboardNavigation(dialog, content, provider, generation, saveRow);

        if (focusSaveName) {
            nameInput.focus();
            nameInput.select();
        } else if (!this.focusInitialPreset(content, provider)) {
            dialog.focus({ preventScroll: true });
        }
        return dialog;
    }

    createHeader(provider) {
        const header = document.createElement('div');
        header.className = 'preset-dialog-header';
        header.textContent = t(provider.getTitleKey(), 'Effect Presets');
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'routing-dialog-close preset-dialog-close';
        closeButton.textContent = '✕';
        closeButton.title = t('ui.title.close', 'Close');
        closeButton.addEventListener('click', () => this.close());
        header.appendChild(closeButton);
        return header;
    }

    isActiveContent(content, generation) {
        const dialog = document.querySelector('.preset-dialog');
        return generation === this.generation && dialog?.contains(content);
    }

    async renderContent(content, provider, generation, saveRow = null) {
        if (!this.isActiveContent(content, generation)) return;
        const revision = ++this.renderRevision;
        const sections = [];
        const systemGroups = provider.getSystemPresetGroups?.();
        if (Array.isArray(systemGroups) && systemGroups.length > 0) {
            const section = this.createSection(t('ui.title.systemPresets', 'System Presets'));
            const activeId = provider.getActiveSystemPresetId?.() || '';
            for (const group of systemGroups) {
                if (group.label) {
                    const heading = document.createElement('div');
                    heading.className = 'preset-dialog-group-title';
                    heading.textContent = group.label;
                    section.appendChild(heading);
                }
                for (const preset of group.presets || []) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'preset-dialog-system-preset';
                    button.setAttribute('data-preset-kind', 'system');
                    button.setAttribute('data-preset-key', preset.id);
                    if (preset.id === activeId) button.classList.add('active');
                    button.textContent = preset.label;
                    button.addEventListener('click', async () => {
                        await this.activatePreset(
                            content,
                            provider,
                            generation,
                            saveRow,
                            'system',
                            preset.id
                        );
                    });
                    section.appendChild(button);
                }
            }
            sections.push(section);
        }

        const userSection = this.createSection(t('ui.title.userPresets', 'User Presets'));
        if (saveRow) userSection.appendChild(saveRow);
        const names = (await provider.listUserPresetNames()).slice().sort((a, b) => a.localeCompare(b));
        if (names.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'preset-dialog-empty';
            empty.textContent = t('ui.pluginPresets.noUserPresets', 'No saved presets');
            userSection.appendChild(empty);
        } else {
            const selected = new Set();
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'preset-dialog-delete-button';
            deleteButton.textContent = t('ui.pluginPresets.deleteSelected', 'Delete Selected');
            deleteButton.disabled = true;

            for (const name of names) {
                userSection.appendChild(this.createUserPresetRow(
                    provider,
                    content,
                    generation,
                    name,
                    selected,
                    deleteButton,
                    saveRow
                ));
            }

            deleteButton.addEventListener('click', async () => {
                const namesToDelete = [...selected];
                if (namesToDelete.length === 0) return;
                const message = t('ui.pluginPresets.confirmDeleteSelected', 'Delete the selected presets?');
                if (!window.confirm(message)) return;
                const deleted = await provider.deleteUserPresets(namesToDelete);
                if (!deleted) {
                    this.reportError(provider, provider.errorKeys.delete);
                    return;
                }
                await this.renderContent(content, provider, generation, saveRow);
            });
            userSection.appendChild(deleteButton);
        }
        sections.push(userSection);
        if (!this.isActiveContent(content, generation) || revision !== this.renderRevision) return;
        content.textContent = '';
        for (const section of sections) content.appendChild(section);
    }

    createSection(title) {
        const section = document.createElement('section');
        section.className = 'preset-dialog-section';
        const heading = document.createElement('h3');
        heading.textContent = title;
        section.appendChild(heading);
        return section;
    }

    createUserPresetRow(provider, content, generation, name, selected, deleteButton, saveRow) {
        const row = document.createElement('div');
        row.className = 'preset-dialog-user-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', name);
        checkbox.addEventListener('click', event => event.stopPropagation());
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selected.add(name);
            else selected.delete(name);
            deleteButton.disabled = selected.size === 0;
        });
        const nameButton = document.createElement('button');
        nameButton.type = 'button';
        nameButton.className = 'preset-dialog-user-preset';
        nameButton.setAttribute('data-preset-kind', 'user');
        nameButton.setAttribute('data-preset-key', name);
        nameButton.textContent = name;
        nameButton.addEventListener('click', async () => {
            await this.activatePreset(content, provider, generation, saveRow, 'user', name);
        });
        const renameButton = document.createElement('button');
        renameButton.type = 'button';
        renameButton.className = 'preset-dialog-rename-button';
        renameButton.title = t('ui.pluginPresets.rename', 'Rename');
        renameButton.textContent = '✎';
        renameButton.addEventListener('click', event => {
            event.stopPropagation();
            this.beginRename(row, provider, content, generation, name, saveRow);
        });
        row.appendChild(checkbox);
        row.appendChild(nameButton);
        row.appendChild(renameButton);
        return row;
    }

    getPresetButtons(content) {
        return Array.from(content.querySelectorAll(
            '.preset-dialog-system-preset, .preset-dialog-user-preset'
        ));
    }

    getPresetContext(provider) {
        const context = provider.getPresetContext?.() || provider;
        return context && (typeof context === 'object' || typeof context === 'function')
            ? context
            : provider;
    }

    focusPreset(content, kind, key) {
        if (!kind || key === undefined || key === null || key === '') return false;
        const button = this.getPresetButtons(content).find(candidate =>
            candidate.getAttribute('data-preset-kind') === kind &&
            candidate.getAttribute('data-preset-key') === String(key)
        );
        if (!button) return false;
        button.focus({ preventScroll: true });
        button.scrollIntoView?.({ block: 'nearest' });
        return true;
    }

    focusInitialPreset(content, provider) {
        const context = this.getPresetContext(provider);
        const lastPreset = this.lastPresetByContext.get(context);
        const candidates = [
            lastPreset,
            { kind: 'user', key: provider.getActiveUserPresetName?.() || '' },
            { kind: 'system', key: provider.getActiveSystemPresetId?.() || '' }
        ];
        return candidates.some(candidate =>
            candidate && this.focusPreset(content, candidate.kind, candidate.key)
        );
    }

    async activatePreset(content, provider, generation, saveRow, kind, key) {
        const applied = kind === 'system'
            ? await provider.applySystemPreset(key)
            : await provider.applyUserPreset(key);
        if (applied === false) return false;

        this.lastPresetByContext.set(this.getPresetContext(provider), { kind, key: String(key) });
        await this.renderContent(content, provider, generation, saveRow);
        this.focusPreset(content, kind, key);
        return true;
    }

    setupKeyboardNavigation(dialog, content, provider, generation, saveRow) {
        let navigationQueue = Promise.resolve();
        dialog.addEventListener('keydown', async event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;

            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            navigationQueue = navigationQueue.then(async () => {
                const buttons = this.getPresetButtons(content);
                if (buttons.length === 0) return;

                const focusedIndex = buttons.indexOf(document.activeElement);
                const activeIndex = buttons.findIndex(button => button.classList.contains('active'));
                const currentIndex = focusedIndex >= 0 ? focusedIndex : activeIndex;
                const nextIndex = currentIndex >= 0
                    ? (currentIndex + direction + buttons.length) % buttons.length
                    : direction > 0 ? 0 : buttons.length - 1;
                const nextButton = buttons[nextIndex];
                await this.activatePreset(
                    content,
                    provider,
                    generation,
                    saveRow,
                    nextButton.getAttribute('data-preset-kind'),
                    nextButton.getAttribute('data-preset-key')
                );
            });
            await navigationQueue;
        });
    }

    beginRename(row, provider, content, generation, oldName, saveRow) {
        row.textContent = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'preset-dialog-rename-input';
        input.value = oldName;
        let settled = false;
        const finish = async save => {
            if (settled) return;
            settled = true;
            if (save) {
                const newName = normalizeName(input.value);
                if (newName) {
                    const renamed = await provider.renameUserPreset(oldName, newName);
                    if (!renamed) this.reportError(provider, provider.errorKeys.save);
                }
            }
            await this.renderContent(content, provider, generation, saveRow);
        };
        input.addEventListener('keydown', async event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await finish(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                await finish(false);
            }
        });
        input.addEventListener('blur', () => finish(true));
        row.appendChild(input);
        input.focus();
        input.select();
    }

    reportError(provider, key) {
        if (provider.handlesErrors || !window.uiManager) return;
        window.uiManager.showTransientMessage(key, true, {}, 3000);
    }

    setupCloseHandler(dialog, anchorButton, generation) {
        this.closeHandlerTimer = setTimeout(() => {
            this.closeHandlerTimer = null;
            if (generation !== this.generation || document.querySelector('.preset-dialog') !== dialog) return;
            this.closeHandler = event => {
                if (!dialog.contains(event.target) && !anchorButton?.contains?.(event.target)) this.close();
            };
            document.addEventListener('click', this.closeHandler);
        }, 100);
    }

    closeIfPluginDetached() {
        if (this.activeProvider?.isAttachedToPipeline?.() === false) this.close();
    }

    close() {
        this.generation += 1;
        this.renderRevision += 1;
        this.activeProvider = null;
        document.querySelector('.preset-dialog')?.remove();
        if (this.closeHandlerTimer !== null) {
            clearTimeout(this.closeHandlerTimer);
            this.closeHandlerTimer = null;
        }
        if (this.closeHandler) {
            document.removeEventListener('click', this.closeHandler);
            this.closeHandler = null;
        }
    }
}
