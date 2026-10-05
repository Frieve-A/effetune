// Applies sync-ops (see sync-ops.mjs) to the live plugin pipeline. Shared by the
// host renderer (answering "edit" from clients) and the browser client
// (reconciling the editor with the host's state), so both mutate the model the
// same way the local UI does: plugin-list-manager's add, the selection
// manager's delete, the master toggle, the preset loader's state restore.

import { applySerializedState, getSerializablePluginStateShort } from '../utils/serialization-utils.js';
import { MAX_STAGES, resolvePosition, validateOps } from './sync-ops.mjs';

// Stage ids: an opaque id per plugin instance, a "<prefix>.<n>" string. The
// host uses "h", every browser client a random "c<8 chars>" prefix, so ids
// proposed by different participants never collide.
export function createIdRegistry(prefix) {
    const ids = new WeakMap();
    let counter = 0;
    return {
        prefix,
        idOf(plugin) {
            let id = ids.get(plugin);
            if (id === undefined) {
                counter += 1;
                id = `${prefix}.${counter}`;
                ids.set(plugin, id);
            }
            return id;
        },
        setId(plugin, id) { ids.set(plugin, id); },
        hasId(plugin) { return ids.has(plugin); }
    };
}

export function randomClientPrefix(cryptoRef = globalThis.crypto) {
    const bytes = new Uint8Array(6);
    cryptoRef.getRandomValues(bytes);
    let text = '';
    for (const byte of bytes) text += (byte % 36).toString(36);
    return `c${text}`;
}

// Parameter edit of one plugin: same semantics as the "params" op (the keys
// of the short state) plus `d`, the optional keys that became unset.
export function applyParamsToPlugin(plugin, params, unset = []) {
    if (unset.some(key => key !== 'ib' && key !== 'ob' && key !== 'ch')) {
        // Let the plugin restore omitted parameters using its preset semantics.
        const state = { ...getSerializablePluginStateShort(plugin), ...params };
        for (const key of unset) delete state[key];
        applySerializedState(plugin, state);
    } else {
        const { nm, en, ib, ob, ch, ...rest } = params;
        if (Object.keys(rest).length > 0) plugin.setParameters(rest);
        if (typeof en === 'boolean') plugin.setEnabled(en);
        if (ib !== undefined) plugin.inputBus = ib;
        if (ob !== undefined) plugin.outputBus = ob;
        if (ch !== undefined) plugin.channel = ch === '' ? null : ch;
    }
    for (const key of unset) {
        if (key === 'ib') plugin.inputBus = null;
        else if (key === 'ob') plugin.outputBus = null;
        else if (key === 'ch') plugin.channel = null;
    }
}

// Mirrors the master toggle click handler in pipeline-core.js.
export function applyMasterBypass(win, on) {
    const core = win.pipelineManager.core;
    core.enabled = !on;
    const toggle = core.masterToggle || win.document.querySelector('.toggle-button.master-toggle');
    toggle?.classList.toggle('off', on);
    core.workletSync.updateMasterBypass(on);
    core.updateAllPluginDisplayState?.();
}

function requireModel(win) {
    const { audioManager, pipelineManager, pluginManager } = win;
    if (!audioManager || !pipelineManager || !pluginManager) throw new Error('app-not-ready');
    return { audioManager, pipelineManager, pluginManager };
}

export function validateEdit(win, ops, { isHost = false } = {}) {
    const { audioManager, pluginManager } = requireModel(win);
    const result = validateOps(ops, {
        isAvailable: nm => pluginManager.isPluginAvailable(nm),
        currentLength: audioManager.pipeline.length
    });
    // Host-assigned ids come from a counter the host owns; a client may not claim them.
    if (result.ok && isHost && ops.some(op => op.t === 'ins' && op.id.startsWith('h.'))) {
        return { ok: false, error: 'invalid-op' };
    }
    return result;
}

// Applies an already validated batch to the live pipeline array, in place.
//   registry: { idOf, setId }  stage ids of this participant
//   recycle:  pair a `del` with a later `ins` of the same effect and keep the
//             plugin instance (new id, state re-applied) instead of rebuilding
// Returns { skipped, structural, touched } for finishBatch().
export function applyOpsToPipeline(win, ops, { registry, recycle = false }) {
    const { audioManager, pipelineManager, pluginManager } = requireModel(win);
    const pipeline = audioManager.pipeline;
    const expanded = pipelineManager.expandedPlugins;
    const selected = pipelineManager.selectedPlugins;
    const ids = pipeline.map(plugin => registry.idOf(plugin));
    const skipped = [];
    const touched = new Set();
    let structural = false;

    // del -> ins pairs of the same effect within this batch.
    const pairedDel = new Map(); // ins op index -> del op index
    const recyclable = new Map(); // del op index -> plugin taken out of the pipeline
    if (recycle) {
        const used = new Set();
        ops.forEach((op, j) => {
            if (op.t !== 'ins') return;
            for (let i = 0; i < j; i += 1) {
                if (ops[i].t !== 'del' || used.has(i)) continue;
                const plugin = pipeline[ids.indexOf(ops[i].id)];
                if (plugin && plugin.name === op.item.nm) {
                    used.add(i);
                    pairedDel.set(j, i);
                    break;
                }
            }
        });
    }
    const pairedDels = new Set(pairedDel.values());

    const release = plugin => {
        if (typeof plugin.cleanup === 'function') plugin.cleanup();
        expanded.delete(plugin);
        selected.delete(plugin);
    };

    ops.forEach((op, opIndex) => {
        switch (op.t) {
            case 'set': {
                const index = ids.indexOf(op.id);
                if (index < 0) { skipped.push(opIndex); return; }
                applyParamsToPlugin(pipeline[index], op.p, op.d);
                touched.add(pipeline[index]);
                return;
            }
            case 'ins': {
                if (ids.includes(op.id) || pipeline.length >= MAX_STAGES) { skipped.push(opIndex); return; }
                let plugin = null;
                const delIndex = pairedDel.get(opIndex);
                if (delIndex !== undefined) {
                    plugin = recyclable.get(delIndex) || null;
                    recyclable.delete(delIndex);
                }
                if (plugin) {
                    // applySerializedState only writes the keys the item carries, so
                    // whatever the old instance had set (buses, channel, enabled)
                    // would survive in a new stage that omits them. Start from the
                    // state createPlugin() gives.
                    plugin.inputBus = null;
                    plugin.outputBus = null;
                    plugin.channel = null;
                    if (op.item.en === undefined && typeof plugin.setEnabled === 'function') plugin.setEnabled(true);
                    applySerializedState(plugin, op.item);
                } else {
                    plugin = pluginManager.createPlugin(op.item.nm);
                    applySerializedState(plugin, op.item);
                    expanded.add(plugin);
                }
                registry.setId(plugin, op.id);
                const position = resolvePosition(ids, op.after, op.at);
                ids.splice(position, 0, op.id);
                pipeline.splice(position, 0, plugin);
                structural = true;
                return;
            }
            case 'del': {
                const index = ids.indexOf(op.id);
                if (index < 0) { skipped.push(opIndex); return; }
                const [plugin] = pipeline.splice(index, 1);
                ids.splice(index, 1);
                if (pairedDels.has(opIndex)) recyclable.set(opIndex, plugin);
                else release(plugin);
                touched.delete(plugin);
                structural = true;
                return;
            }
            case 'mov': {
                const index = ids.indexOf(op.id);
                if (index < 0 || op.after === op.id) { skipped.push(opIndex); return; }
                const [plugin] = pipeline.splice(index, 1);
                ids.splice(index, 1);
                const position = resolvePosition(ids, op.after, op.at);
                ids.splice(position, 0, op.id);
                pipeline.splice(position, 0, plugin);
                structural = true;
                return;
            }
            case 'bypass':
                applyMasterBypass(win, op.on);
                return;
            default:
                skipped.push(opIndex);
        }
    });
    // A paired plugin whose insert was skipped never came back.
    for (const plugin of recyclable.values()) release(plugin);
    return { skipped, structural, touched };
}

// Brings the UI, the worklet and (on the host) the history in line after a batch.
//   saveHistory / scheduleHistorySave: host-only hooks; the client passes none
export function finishBatch(win, result, { saveHistory = null, scheduleHistorySave = null } = {}) {
    const { pipelineManager } = requireModel(win);
    const core = pipelineManager.core;
    if (result.structural) {
        core.updatePipelineUI();
        core.updateWorkletPlugins();
        saveHistory?.();
        win.uiManager?.updateURL?.();
        return;
    }
    for (const plugin of result.touched) {
        core.updateWorkletPlugin(plugin);
        plugin.syncUIControls?.();
    }
    if (result.touched.size > 0) {
        core.updateAllPluginDisplayState?.();
        win.uiManager?.updateURL?.();
        scheduleHistorySave?.();
    }
}
