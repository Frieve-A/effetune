const SFZ_TYPES = new Set(['SoundFontPlayerPlugin', 'SFZNotePlayerPlugin']);
const SFZ_CHECKPOINT_TIMEOUT_MS = 5000;

function channelOf(plugin) {
    const value = plugin?.getParameters?.()?.mc;
    return Number.isFinite(value) ? Math.round(Math.min(16, Math.max(0, value))) : 0;
}

export const audioManagerSfzRuntimeMethods = {
    setSoundFontMidiMetering(plugin, enabled) {
        if (plugin?.constructor?.name !== 'SoundFontPlayerPlugin' || typeof enabled !== 'boolean') return;
        this._soundFontMidiMeteringDesired ??= new WeakMap();
        this._soundFontMidiMeteringPlugins ??= new Set();
        this._soundFontMidiMeteringDesired.set(plugin, enabled);
        if (enabled) this._soundFontMidiMeteringPlugins.add(plugin);
        else this._soundFontMidiMeteringPlugins.delete(plugin);
        this.updateDspTelemetryRate?.();
        for (const node of this._getActiveDspWorklets()) {
            if (this._getSfzRuntimePlugin(node, plugin.id) !== plugin) continue;
            const identity = this._sfzRuntimeIdentities?.get(node)?.get(plugin.id);
            if (identity?.pluginRef?.deref() === plugin && Number.isInteger(identity.instanceEpoch)) {
                node.port.postMessage({ type: 'soundFontMidiMetering', pluginId: plugin.id,
                    instanceEpoch: identity.instanceEpoch, enabled });
            }
        }
    },

    async sendSoundFontMixerAction(plugin, action, reportAppliedFrame = false) {
        const node = [...this._getActiveDspWorklets()].find(node => this._getSfzRuntimePlugin(node, plugin?.id) === plugin);
        const identity = node && this._getSfzRuntimeAssetIdentity(node, plugin.id);
        const graph = this._audioGraphGeneration;
        const desired = plugin?.getWasmAssetOperationRevision?.(0);
        if (plugin?.constructor?.name !== 'SoundFontPlayerPlugin' || !node || plugin._pending ||
            desired != null && desired !== identity.token ||
            this.getSfzSamplePreparation(plugin, node) ||
            !this.getEffectiveActiveWasmAssetSnapshot(plugin, [0], { primaryWorklet: node }).ready) {
            throw new Error('Wait until the SoundFont is ready, then try again.');
        }
        const answer = await this._requestDspControl(node, 'soundFontMixerAction', 'soundFontMixerActionApplied',
            { pluginId: plugin.id, token: identity.token, replayEpoch: identity.replayEpoch, action }, 5000);
        const current = this._getSfzRuntimeAssetIdentity(node, plugin.id);
        if (graph !== this._audioGraphGeneration || this._getSfzRuntimePlugin(node, plugin.id) !== plugin ||
            current.token !== identity.token || current.replayEpoch !== identity.replayEpoch || answer?.ok !== true ||
            answer.checkpoints?.length && !this.storeSfzRuntimeCheckpoints(node, answer.checkpoints)) {
            throw new Error('The channel could not be updated. Wait until the SoundFont is ready and try again.');
        }
        return reportAppliedFrame ? answer.appliedFrame : true;
    },

    getNativeMixerMetadata(plugin, node = null) {
        node ??= [...this._getActiveDspWorklets()].find(node => this._getSfzRuntimePlugin(node, plugin?.id) === plugin);
        if (this._getSfzRuntimePlugin(node, plugin?.id) !== plugin) return null;
        const snapshot = this.getEffectiveActiveWasmAssetSnapshot?.(plugin, [0], { primaryWorklet: node });
        const asset = snapshot?.assets?.get(0);
        const availability = this._dspRuntimeEventsByNode?.get(node)?.get(plugin.id);
        const identity = this._sfzRuntimeIdentities?.get(node)?.get(plugin.id);
        const sampleAvailable = availability && availability.instanceEpoch === identity?.instanceEpoch
            ? availability.cause === 'available' : null;
        const stream = this._sfzSampleStreams?.get(node)?.get(plugin.id);
        const readiness = stream?.readiness;
        const cacheReady = !stream?.limited && !!readiness && readiness.scope !== 0 && readiness.pendingPages === 0 &&
            (readiness.scope !== 1 || readiness.readyAheadFrames > 0);
        const preparing = !!plugin._pending || !!this.getSfzSamplePreparation(plugin, node) || !!snapshot?.pendingSlots?.length ||
            !!stream && !stream.initialCacheReady && !stream.limited;
        return { ...plugin._soundFontMetadata, memoryBytes: asset?.footprintBytes ?? plugin._soundFontMetadata?.memoryBytes,
            sampleCacheBytes: asset?.sampleCacheBytes ?? null, sampleCacheSlots: asset?.sampleCacheSlots ?? null,
            metadataReady: !!plugin._soundFontMetadata, nativeReady: snapshot?.ready === true,
            ready: snapshot?.ready === true && !preparing && !plugin._error, preparing,
            sampleAvailable, cacheReady, streamReadiness: readiness ?? null, limited: stream?.limited === true,
            headroomFrames: sampleAvailable === false ? 0 : readiness?.scope === 1 ? readiness.readyAheadFrames : null };
    },

    _pruneSfzRuntimeTargets() {
        for (const [node, streams] of this._sfzSampleStreams ?? []) {
            if (this._isActiveDspWorklet(node)) continue;
            for (const pluginId of streams.keys()) this._stopSfzSampleStream(node, pluginId);
        }
        for (const map of [this._sfzRuntimeCheckpoints, this._sfzRuntimeIdentities,
            this._sfzRuntimeStartedByNode, this._sfzRuntimeStartFailures]) {
            for (const node of map?.keys() ?? []) if (!this._isActiveDspWorklet(node)) map.delete(node);
        }
    },

    hasSfzRuntimeToPreserve() {
        for (const node of this._getActiveDspWorklets()) {
            const members = this._wasmAssetMembershipByNode?.get(node)?.values() ??
                (this._getSfzRuntimeRole(node) === 'A' ? this.getCurrentPipeline?.() ?? this.pipeline ?? [] : []);
            if ([...members].some(plugin => SFZ_TYPES.has(plugin?.constructor?.name) && plugin.sf)) return true;
        }
        return false;
    },

    _getSfzRuntimeRole(node) {
        return this._parallelBranchForWorklet?.(node) ||
            (node === this._getPrimaryWorkletNode?.() || node === this.workletNode ? 'A' : null);
    },

    _getSfzRuntimePlugin(node, id) {
        if (!this._isActiveDspWorklet?.(node)) return null;
        const membership = this._wasmAssetMembershipByNode?.get(node);
        if (membership instanceof Map) return membership.get(id) ?? null;
        if (this._getSfzRuntimeRole(node) === 'B') return null;
        return (this.getCurrentPipeline?.() ?? this.pipeline ?? []).find(plugin => plugin.id === id) ?? null;
    },

    _getSfzRuntimeAssetIdentity(node, id) {
        const key = this._wasmAssetKey?.(id, 0) ?? `${id}:0`;
        return { token: this._wasmAssetExpectedRevisionsByNode?.get(node)?.get(key),
            replayEpoch: this._wasmAssetExpectedReplayEpochsByNode?.get(node)?.get(key) };
    },

    storeSfzRuntimeCheckpoints(node, records, { generation = null, position = null } = {}) {
        this._pruneSfzRuntimeTargets();
        if (!this._isActiveDspWorklet?.(node) || !Array.isArray(records)) return false;
        this._sfzRuntimeCheckpoints ??= new Map();
        const stored = new Map(this._sfzRuntimeCheckpoints.get(node) ?? []);
        const context = node.context ?? this.audioContext;
        for (const record of records) {
            const plugin = this._getSfzRuntimePlugin(node, record?.pluginId);
            const type = plugin?.constructor?.name;
            const { token, replayEpoch: replay } = this._getSfzRuntimeAssetIdentity(node, record?.pluginId);
            if (!plugin || !SFZ_TYPES.has(type) || record.type !== type ||
                !(record.bytes instanceof Uint8Array) || !record.bytes.byteLength ||
                record.bytes.byteLength > 32 * 1024 * 1024 ||
                !Number.isInteger(record.instanceId) || record.instanceId <= 0 ||
                record.sf !== plugin.sf || record.channel !== channelOf(plugin) ||
                (context?.sampleRate && record.sampleRate !== context.sampleRate) ||
                (token != null && token !== record.token) || (replay != null && replay !== record.replayEpoch)) return false;
            stored.set(record.pluginId, { record, plugin, context, generation, position,
                graph: this._audioGraphGeneration, role: this._getSfzRuntimeRole(node),
                branch: this._getSfzRuntimeRole(node) === 'B' ? this._parallelBranchSnapshot : null });
        }
        this._sfzRuntimeCheckpoints.set(node, stored);
        return true;
    },

    getSfzRuntimeCheckpoints(node) {
        this._pruneSfzRuntimeTargets();
        if (!this._isActiveDspWorklet?.(node)) return [];
        const stored = new Map();
        const migratingItems = new Set();
        if (this._sfzRuntimeMigration) {
            const role = this._getSfzRuntimeRole(node);
            const candidates = this._sfzRuntimeMigration.records.get(role);
            if (candidates && (role !== 'B' || this._sfzRuntimeMigration.branch === this._parallelBranchSnapshot)) {
                for (const [id, item] of candidates) { stored.set(id, item); migratingItems.add(item); }
            }
        }
        for (const [id, item] of this._sfzRuntimeCheckpoints?.get(node) ?? []) stored.set(id, item);
        const result = [];
        for (const item of stored?.values() ?? []) {
            const migrating = migratingItems.has(item);
            const { record, plugin } = item;
            const member = this._getSfzRuntimePlugin(node, record.pluginId);
            const { token, replayEpoch: replay } = this._getSfzRuntimeAssetIdentity(node, record.pluginId);
            if (member !== plugin || record.sf !== member?.sf || record.channel !== channelOf(member)) continue;
            if (!migrating && (item.context !== (node.context ?? this.audioContext) ||
                (token != null && token !== record.token) || (replay != null && replay !== record.replayEpoch))) continue;
            const identity = this._sfzRuntimeIdentities?.get(node)?.get(record.pluginId);
            if (!migrating && identity && (identity.instanceId !== record.instanceId ||
                (identity.instanceEpoch ?? 0) !== (record.instanceEpoch ?? 0))) continue;
            result.push(migrating ? { ...record, plannedMigration: true,
                sameContext: item.context === (node.context ?? this.audioContext) } : record);
        }
        return result;
    },

    clearSfzRuntimeCheckpoints({ types = [...SFZ_TYPES] } = {}) {
        const selected = new Set(types);
        for (const records of this._sfzRuntimeCheckpoints?.values() ?? []) {
            for (const [id, item] of records) if (selected.has(item.record.type)) records.delete(id);
        }
        for (const records of this._sfzRuntimeMigration?.records.values() ?? []) {
            for (const [id, item] of records) if (selected.has(item.record.type)) records.delete(id);
        }
    },

    beginSfzRuntimeGraphMigration() {
        const records = new Map();
        for (const [node, values] of this._sfzRuntimeCheckpoints ?? []) {
            if (!this._isActiveDspWorklet?.(node)) continue;
            const role = this._getSfzRuntimeRole(node);
            const valid = new Set(this.getSfzRuntimeCheckpoints(node).map(record => record.pluginId));
            if (role) records.set(role, new Map([...values].filter(([id]) => valid.has(id))));
        }
        this._sfzRuntimeMigration = { records, branch: this._parallelBranchSnapshot,
            graph: this._audioGraphGeneration };
    },

    finishSfzRuntimeGraphMigration() {
        this._sfzRuntimeMigration = null;
        for (const node of this._sfzRuntimeCheckpoints?.keys() ?? []) {
            if (!this._isActiveDspWorklet?.(node)) this._sfzRuntimeCheckpoints.delete(node);
        }
    },

    async captureSfzRuntimeCheckpoints({ nodes = [...this._getActiveDspWorklets()], reason = 'power', proof = null } = {}) {
        const generation = this._audioGraphGeneration;
        const results = await Promise.all(nodes.map(async node => {
            if (!this._isActiveDspWorklet(node)) return false;
            const members = this._wasmAssetMembershipByNode?.get(node)?.values() ??
                (this._getSfzRuntimeRole(node) === 'A' ? this.getCurrentPipeline?.() ?? this.pipeline ?? [] : []);
            if (![...members].some(plugin => SFZ_TYPES.has(plugin?.constructor?.name))) return true;
            const data = await this._requestDspControl(node, 'sfzCaptureCheckpoints', 'sfzCheckpoints',
                { reason, proof }, SFZ_CHECKPOINT_TIMEOUT_MS);
            return generation === this._audioGraphGeneration && data?.ok === true &&
                this.storeSfzRuntimeCheckpoints(node, data.checkpoints, { generation: data.generation, position: data.position });
        }));
        return generation === this._audioGraphGeneration && results.every(Boolean);
    },

    async startSfzRuntimeForAsset(node, data) {
        const plugin = this._getSfzRuntimePlugin(node, data.pluginId);
        if (!plugin || !SFZ_TYPES.has(plugin.constructor.name) || (data.state & 255) !== 3) return true;
        const expected = this._getSfzRuntimeAssetIdentity(node, plugin.id);
        if ((expected.token != null && expected.token !== data.operationRevision) ||
            (expected.replayEpoch != null && expected.replayEpoch !== data.replayEpoch)) return true;
        const checkpoint = this.getSfzRuntimeCheckpoints(node).find(record => record.pluginId === plugin.id);
        if (plugin.constructor.name === 'SoundFontPlayerPlugin' && !checkpoint) return true;
        this._sfzRuntimeStartedByNode ??= new Map();
        let started = this._sfzRuntimeStartedByNode.get(node);
        if (!started) this._sfzRuntimeStartedByNode.set(node, started = new Map());
        const identity = this._sfzRuntimeIdentities?.get(node)?.get(plugin.id);
        const stamp = started.get(plugin.id);
        if (stamp && stamp.token === data.operationRevision && stamp.replayEpoch === data.replayEpoch &&
            stamp.instanceId === identity?.instanceId && stamp.instanceEpoch === identity?.instanceEpoch) return true;
        this._sfzRuntimeStarts ??= new Set();
        this._sfzRuntimeStartFailures ??= new Map();
        let failures = this._sfzRuntimeStartFailures.get(node);
        if (!failures) this._sfzRuntimeStartFailures.set(node, failures = new Map());
        failures.delete(plugin.id);
        const generation = this._audioGraphGeneration;
        const request = this._requestDspControl(node, 'sfzStartRuntime', 'sfzRuntimeStarted',
            { pluginId: plugin.id, token: data.operationRevision ?? 0, checkpoint,
                deferStart: !!this._sfzRuntimeMigration }, SFZ_CHECKPOINT_TIMEOUT_MS).then(answer => {
            const currentAsset = this._getSfzRuntimeAssetIdentity(node, plugin.id);
            if (generation !== this._audioGraphGeneration || this._getSfzRuntimePlugin(node, plugin.id) !== plugin ||
                (currentAsset.token != null && currentAsset.token !== data.operationRevision) ||
                (currentAsset.replayEpoch != null && currentAsset.replayEpoch !== data.replayEpoch)) return null;
            const valid = answer?.ok === true && (!answer.checkpoints?.length || this.storeSfzRuntimeCheckpoints(node, answer.checkpoints));
            if (!valid) failures.set(plugin.id, { generation, plugin, token: data.operationRevision, replayEpoch: data.replayEpoch });
            else {
                const current = this._sfzRuntimeIdentities?.get(node)?.get(plugin.id);
                started.set(plugin.id, { token: data.operationRevision, replayEpoch: data.replayEpoch,
                    instanceId: current?.instanceId, instanceEpoch: current?.instanceEpoch });
            }
            return valid;
        });
        this._sfzRuntimeStarts.add(request);
        try {
            return await request;
        } finally { this._sfzRuntimeStarts.delete(request); }
    },

    async waitForSfzRuntimeStarts() {
        const results = await Promise.all([...this._sfzRuntimeStarts ?? []]);
        for (const [node, failures] of this._sfzRuntimeStartFailures ?? []) {
            for (const [id, failure] of failures) {
                const expected = this._getSfzRuntimeAssetIdentity(node, id);
                if (failure.generation === this._audioGraphGeneration && this._getSfzRuntimePlugin(node, id) === failure.plugin &&
                    (expected.token == null || expected.token === failure.token) &&
                    (expected.replayEpoch == null || expected.replayEpoch === failure.replayEpoch)) return false;
                failures.delete(id);
            }
        }
        return results.every(result => result !== false);
    },

    resumeSfzRuntimes() {
        for (const node of this._getActiveDspWorklets()) node.port.postMessage({ type: 'sfzResumeRuntime' });
    },

    async prepareSfzRuntimeGraphReset() {
        if (this._sfzRuntimeMigration) return;
        const player = globalThis.window?.uiManager?.audioPlayer?.contextManager;
        if (player?.midiTimeline) await player.prepareMidiGraphReset();
        if (!await this.captureSfzRuntimeCheckpoints({ reason: 'graph' })) {
            this.resumeSfzRuntimes();
            throw new Error('SFZ runtime state could not be preserved');
        }
        this.beginSfzRuntimeGraphMigration();
    },

    _handleSfzRuntimeMessage(node, data) {
        if (data.type === 'sfzStreamPagesPublished' || data.type === 'sfzStreamRequests' || data.type === 'sfzPreparationContext' || data.type === 'soundFontMixerActionApplied') {
            this._settleDspControlResponse(node, data);
            return true;
        }
        if (data.type === 'sfzStreamReadiness') {
            const stream = this._sfzSampleStreams?.get(node)?.get(data.pluginId);
            const plugin = this._getSfzRuntimePlugin(node, data.pluginId);
            const expected = this._getSfzRuntimeAssetIdentity(node, data.pluginId);
            if (!stream || !plugin || stream.generation !== data.generation || stream.operationRevision !== data.operationRevision ||
                (stream.replayEpoch ?? null) !== (data.replayEpoch ?? null) || expected.token !== data.operationRevision ||
                (expected.replayEpoch ?? null) !== (data.replayEpoch ?? null)) return true;
            const wasLimited = stream.limited === true;
            stream.readiness = data.readiness;
            stream.limited = data.limited === true;
            const snapshot = stream.readiness;
            const ready = !stream.limited && snapshot && snapshot.scope !== 0 && snapshot.pendingPages === 0 &&
                (snapshot.scope !== 1 || snapshot.readyAheadFrames > 0);
            if (!stream.initialCacheReady && !stream.limited || wasLimited !== stream.limited) {
                if (ready) stream.initialCacheReady = true;
                plugin.onSfzPreparationProgress?.({ phase: stream.limited ? 'limited' : ready ? 'ready' : 'prebuffer',
                    completedCount: snapshot ? snapshot.plannedPages - snapshot.pendingPages : 0,
                    totalCount: snapshot?.plannedPages ?? 0,
                    operationRevision: data.operationRevision, replayEpoch: data.replayEpoch ?? null });
            }
            return true;
        }
        if (data.type === 'sfzStreamReady') { void this._startSfzSampleStream(node, data); return true; }
        if (data.type === 'sfzStreamStop') { this._stopSfzSampleStream(node, data.pluginId, data.generation); return true; }
        if (data.type === 'sfzStreamPollNeeded') {
            const stream = this._sfzSampleStreams?.get(node)?.get(data.pluginId);
            if (stream?.generation === data.generation) void stream.poll?.();
            return true;
        }
        if (data.type === 'sfzRuntimeIdentity') {
            const plugin = this._getSfzRuntimePlugin(node, data.pluginId);
            if (!plugin) return true;
            this._sfzRuntimeIdentities ??= new Map();
            let identities = this._sfzRuntimeIdentities.get(node);
            if (!identities) this._sfzRuntimeIdentities.set(node, identities = new Map());
            identities.set(data.pluginId, { instanceId: data.instanceId, instanceEpoch: data.instanceEpoch ?? 0,
                token: data.token, pluginRef: new WeakRef(plugin) });
            if (plugin.constructor.name === 'SoundFontPlayerPlugin' &&
                this._soundFontMidiMeteringDesired?.get(plugin) === true) {
                node.port.postMessage({ type: 'soundFontMidiMetering', pluginId: data.pluginId,
                    instanceEpoch: data.instanceEpoch ?? 0, enabled: true });
            }
            return true;
        }
        if (data.type === 'sfzCheckpoints' || data.type === 'sfzRuntimeStarted') {
            this._settleDspControlResponse(node, data);
            return true;
        }
        if (data.type === 'sfzCheckpointNeeded') {
            void this.captureSfzRuntimeCheckpoints({ nodes: [node], reason: 'monitoring', proof: data.proof });
            return true;
        }
        return false;
    },

    hasSfzSampleStreaming() {
        const nodes = [...this._getActiveDspWorklets()];
        return nodes.length > 0 && nodes.every(node => this._dspCapabilitiesByNode?.get(node)?.sfzSampleStreaming === true);
    },

    async getSfzPreparationContext(plugin, node = this._getPrimaryWorkletNode(), timeline = undefined) {
        const graph = this._audioGraphGeneration;
        if (this._getSfzRuntimePlugin(node, plugin.id) !== plugin) return null;
        const response = await this._requestDspControl(node, 'sfzGetPreparationContext', 'sfzPreparationContext',
            { pluginId: plugin.id }, SFZ_CHECKPOINT_TIMEOUT_MS);
        if (!response?.ok || graph !== this._audioGraphGeneration ||
            this._getSfzRuntimePlugin(node, plugin.id) !== plugin) return null;
        const { sfzPreparationContext, sfzPlayerKind } = await import('../sfz/preparation-context.js');
        const playerKind = sfzPlayerKind(plugin.constructor.name);
        const active = sfzPreparationContext({ ...response.context, playerKind });
        if (timeline === undefined) return active;
        const candidate = sfzPreparationContext({ ...response.context, timeline, minimumPhysicalBpm: null, playerKind });
        const oldFloor = active.minimumPhysicalBpm, newFloor = candidate.minimumPhysicalBpm;
        return oldFloor > 0 && (newFloor === 0 || oldFloor < newFloor)
            ? sfzPreparationContext({ ...candidate, minimumPhysicalBpm: oldFloor }) : candidate;
    },

    async estimateSfzEffectPreparation(payload, context, formatTag = 1) {
        const info = this.dspModuleInfo;
        if (!info?.module) throw new Error('The instrument preparation module is unavailable');
        if (this._sfzEffectCost?.module !== info.module || this._sfzEffectCost.worker.closed) {
            this._sfzEffectCost?.worker.close();
            const { SfzEffectCost } = await import('../sfz/effect-cost.js');
            this._sfzEffectCost = { module: info.module, worker: new SfzEffectCost(info.bytes ?? info.module) };
        }
        return this._sfzEffectCost.worker.estimate(payload, context, formatTag);
    },

    getSfzSamplePreparation(plugin, node = this._getPrimaryWorkletNode()) {
        const stream = this._sfzSampleStreams?.get(node)?.get(plugin?.id);
        const expected = this._getSfzRuntimeAssetIdentity(node, plugin?.id);
        return stream?.preparing && this._getSfzRuntimePlugin(node, plugin.id) === plugin &&
            stream.operationRevision === expected.token && (stream.replayEpoch ?? null) === (expected.replayEpoch ?? null)
            ? stream.preparation : null;
    },

    _stopSfzSampleStream(node, pluginId, generation = null) {
        const streams = this._sfzSampleStreams?.get(node), stream = streams?.get(pluginId);
        if (!stream || generation !== null && generation !== stream.generation) return;
        stream.finishPreparation(false);
        streams.delete(pluginId); stream.provider?.close();
        for (const id of stream.requests || []) {
            const request = this._pendingDspControlRequests?.get(id);
            if (!request || request.workletNode !== node) continue;
            this._pendingDspControlRequests.delete(id); clearTimeout(request.timer); request.resolve(null);
        }
        if (!streams.size) this._sfzSampleStreams.delete(node);
    },

    async _startSfzSampleStream(node, data) {
        this._pruneSfzRuntimeTargets();
        const plugin = this._getSfzRuntimePlugin(node, data.pluginId);
        const descriptor = plugin?.getWasmAssetRevisionDescriptor?.(0, data.operationRevision, data.replayEpoch, node);
        const expected = this._getSfzRuntimeAssetIdentity(node, data.pluginId);
        if (typeof descriptor?.sampleProviderFactory !== 'function' || !Number.isSafeInteger(data.generation) || data.generation < 1 ||
            expected.token != null && expected.token !== data.operationRevision ||
            expected.replayEpoch != null && expected.replayEpoch !== data.replayEpoch) return;
        this._stopSfzSampleStream(node, data.pluginId);
        this._sfzSampleStreams ??= new Map();
        let streams = this._sfzSampleStreams.get(node);
        if (!streams) this._sfzSampleStreams.set(node, streams = new Map());
        const stream = { ...data, provider: null, requests: new Set(), preparing: true, polling: false, pollRequested: false };
        stream.preparation = new Promise(resolve => {
            stream.finishPreparation = ready => { stream.preparing = false; resolve(ready); };
        });
        streams.set(data.pluginId, stream);
        // Selection/expected revision may advance before a replacement is
        // accepted. The old provider lives until native retirement is posted.
        const current = () => streams.get(data.pluginId) === stream && this._getSfzRuntimePlugin(node, data.pluginId) === plugin;
        const progress = value => {
            const identity = this._getSfzRuntimeAssetIdentity(node, data.pluginId);
            const desired = plugin.getWasmAssetOperationRevision?.(0);
            if (!current() || desired != null && desired !== data.operationRevision ||
                identity.token !== data.operationRevision || (identity.replayEpoch ?? null) !== (data.replayEpoch ?? null)) return;
            plugin.onSfzPreparationProgress?.({ ...value, operationRevision: data.operationRevision,
                replayEpoch: data.replayEpoch ?? null });
        };
        const fail = error => {
            if (!current()) { this._stopSfzSampleStream(node, data.pluginId, data.generation); return; }
            console.error('SFZ sample streaming failed:', error);
            node.port.postMessage({ type: 'sfzStreamFailed', pluginId: data.pluginId, generation: data.generation });
            this._stopSfzSampleStream(node, data.pluginId, data.generation);
            plugin.onWasmAssetRejected?.(0, 'sample-read', data.operationRevision);
        };
        const request = async (type, replyType, payload) => {
            const pending = this._requestDspControl(node, type, replyType, payload, 5000);
            const id = this._dspControlRequestSequence;
            stream.requests.add(id);
            try { return await pending; } finally { stream.requests.delete(id); }
        };
        try {
            await descriptor.sampleProviderFactory({ generation: data.generation,
                onProvider: provider => { stream.provider = provider; if (!current()) provider.close(); },
                onProgress: progress,
                publish: async page => {
                    if (!current()) return false;
                    const answer = await request('sfzPublishPage', 'sfzStreamPagesPublished',
                        { pluginId: data.pluginId, operationRevision: data.operationRevision, replayEpoch: data.replayEpoch,
                            generation: data.generation, page });
                    return current() && answer?.ok === true;
                } });
            if (!current()) { this._stopSfzSampleStream(node, data.pluginId, data.generation); return; }
            if (stream.provider?.startSupply && typeof MessageChannel === 'function') {
                const { port1, port2 } = new MessageChannel();
                try {
                    stream.provider.worker.onSupplyError = fail;
                    const direct = await stream.provider.startSupply({ port: port1, pluginId: data.pluginId,
                        operationRevision: data.operationRevision, replayEpoch: data.replayEpoch });
                    if (!current()) { port2.close(); this._stopSfzSampleStream(node, data.pluginId, data.generation); return; }
                    if (direct) {
                        node.port.postMessage({ ...data, type: 'sfzAttachSupplyPort', port: port2 }, [port2]);
                        stream.finishPreparation(true);
                        progress({ phase: 'native' });
                        return;
                    }
                    port1.close(); port2.close();
                } catch (error) { port1.close(); port2.close(); throw error; }
            }
            stream.finishPreparation(true);
            progress({ phase: 'native' });
            stream.poll = async () => {
                stream.pollRequested = true;
                if (stream.polling) return;
                if (!current()) { this._stopSfzSampleStream(node, data.pluginId, data.generation); return; }
                stream.polling = true;
                try {
                    // Render-clock notifications remain deliverable when browser
                    // background timers are throttled. Coalesce notifications
                    // while decoding, retaining one follow-up after publication.
                    while (current() && stream.pollRequested) {
                        stream.pollRequested = false;
                        const answer = await request('sfzPollPages', 'sfzStreamRequests',
                            { pluginId: data.pluginId, generation: data.generation });
                        if (!current()) { this._stopSfzSampleStream(node, data.pluginId, data.generation); return; }
                        if (!answer?.ok) throw new Error('The sample request channel was closed');
                        await stream.provider.requestPages(answer.requests);
                    }
                } catch (error) { fail(error); }
                finally { stream.polling = false; }
            };
            void stream.poll();
        } catch (error) { fail(error); }
    }
};
