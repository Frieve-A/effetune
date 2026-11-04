export const DSP_BYTES_READY_TIMEOUT_MS = 3000;

export const audioManagerWasmAssetMethods = {
    _wasmAssetKey(pluginId, slot) {
        return `${pluginId}:${slot}`;
    },

    _configureWasmAssetTargetResolver(plugin) {
        if (typeof plugin?.setWasmAssetTargetResolver !== 'function') return;
        if (!(this._wasmAssetResolverPlugins instanceof WeakSet)) {
            this._wasmAssetResolverPlugins = new WeakSet();
        }
        if (this._wasmAssetResolverPlugins.has(plugin)) return;
        plugin.setWasmAssetTargetResolver(() => this._getWasmAssetTargetWorklets(plugin));
        plugin.setWasmAssetOperationObserver?.((
            workletNode,
            slot,
            operationRevision,
            state,
            replayEpoch
        ) => {
            this._expectWasmAssetOperation(
                workletNode,
                plugin.id,
                slot,
                operationRevision,
                state,
                replayEpoch
            );
        });
        this._wasmAssetResolverPlugins.add(plugin);
    },

    _configureOwnedPipelineWasmAssetResolvers() {
        for (const pipeline of [this.pipelineA, this.pipelineB]) {
            if (!Array.isArray(pipeline)) continue;
            for (const plugin of pipeline) this._configureWasmAssetTargetResolver(plugin);
        }
    },

    _getWasmAssetTargetWorklets(plugin) {
        const targets = [];
        if (!(this._wasmAssetMembershipByNode instanceof Map)) return targets;
        for (const [workletNode, membership] of this._wasmAssetMembershipByNode) {
            if (!this._isActiveDspWorklet(workletNode) || !(membership instanceof Map)) continue;
            if ([...membership.values()].some(member => member === plugin)) targets.push(workletNode);
        }
        return targets;
    },

    _pruneWasmAssetStatesForPlugin(workletNode, pluginId) {
        const states = this._wasmAssetStatesByNode?.get(workletNode);
        const prefix = `${pluginId}:`;
        if (states instanceof Map) {
            for (const key of states.keys()) {
                if (key.startsWith(prefix)) states.delete(key);
            }
        }
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(workletNode);
        if (revisions instanceof Map) {
            for (const key of revisions.keys()) {
                if (key.startsWith(prefix)) revisions.delete(key);
            }
        }
        const replayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(workletNode);
        if (replayEpochs instanceof Map) {
            for (const key of replayEpochs.keys()) {
                if (key.startsWith(prefix)) replayEpochs.delete(key);
            }
        }
    },

    _normalizedWasmAssetOperationRevision(value) {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    },

    _normalizedWasmAssetReplayEpoch(value) {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    },

    _expectWasmAssetOperation(
        workletNode,
        pluginId,
        slot,
        operationRevision,
        state = 1,
        replayEpoch = null
    ) {
        if (!this._isActiveDspWorklet(workletNode) || !Number.isInteger(pluginId)) return false;
        if (!(this._wasmAssetExpectedReplayEpochsByNode instanceof Map)) {
            this._wasmAssetExpectedReplayEpochsByNode = new Map();
        }
        const key = this._wasmAssetKey(pluginId, slot);
        let states = this._wasmAssetStatesByNode.get(workletNode);
        if (!(states instanceof Map)) {
            states = new Map();
            this._wasmAssetStatesByNode.set(workletNode, states);
        }
        let revisions = this._wasmAssetExpectedRevisionsByNode.get(workletNode);
        if (!(revisions instanceof Map)) {
            revisions = new Map();
            this._wasmAssetExpectedRevisionsByNode.set(workletNode, revisions);
        }
        let replayEpochs = this._wasmAssetExpectedReplayEpochsByNode.get(workletNode);
        if (!(replayEpochs instanceof Map)) {
            replayEpochs = new Map();
            this._wasmAssetExpectedReplayEpochsByNode.set(workletNode, replayEpochs);
        }
        states.set(key, state >>> 0);
        revisions.set(key, this._normalizedWasmAssetOperationRevision(operationRevision));
        replayEpochs.set(key, this._normalizedWasmAssetReplayEpoch(replayEpoch));
        this._checkPendingSignedExternalAssetRequests();
        return true;
    },

    syncPrimaryWasmAssetMembership(pipeline = this.pipeline) {
        const primaryWorklet = this._getPrimaryWorkletNode();
        if (!primaryWorklet?.port) return false;
        return this._syncWasmAssetMembership(primaryWorklet, pipeline, {
            trackState: true
        }) !== null;
    },

    getEffectiveActiveWasmAssetSnapshot(plugin, slots = null, options = {}) {
        const primaryWorklet = options.primaryWorklet ?? this._getPrimaryWorkletNode();
        const requestedSlots = Array.isArray(slots)
            ? [...new Set(slots.filter(slot => Number.isInteger(slot) && slot >= 0))]
            : [...(plugin?.getWasmAssets?.().keys?.() || [])];
        const assets = new Map();
        const revisions = new Map();
        const rejectedCandidates = new Map();
        const pendingSlots = [];
        const missingSlots = [];
        const membership = this._wasmAssetMembershipByNode?.get(primaryWorklet);
        const states = this._wasmAssetStatesByNode?.get(primaryWorklet);
        const expectedRevisions = this._wasmAssetExpectedRevisionsByNode?.get(primaryWorklet);
        const expectedReplayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(primaryWorklet);
        const desiredAssets = plugin?.getWasmAssets?.() || new Map();
        const ownsPrimarySlot = Number.isInteger(plugin?.id) &&
            membership?.get(plugin.id) === plugin;

        for (const slot of requestedSlots) {
            const key = this._wasmAssetKey(plugin?.id, slot);
            const state = states?.get(key);
            const status = Number.isInteger(state) ? (state >>> 0) & 0xff : 0;
            const operationRevision = expectedRevisions?.get(key);
            const replayEpoch = expectedReplayEpochs?.get(key) ?? null;
            const rejection = plugin?.getWasmAssetLastRejection?.(slot);
            if (rejection) rejectedCandidates.set(slot, rejection);

            if (ownsPrimarySlot && status === 3 &&
                Number.isSafeInteger(operationRevision) && operationRevision > 0) {
                const descriptor = plugin?.getWasmAssetRevisionDescriptor?.(
                    slot,
                    operationRevision
                );
                if (descriptor?.payload instanceof ArrayBuffer) {
                    assets.set(slot, descriptor);
                    revisions.set(slot, Object.freeze({ operationRevision, replayEpoch }));
                    continue;
                }
            }

            const desired = desiredAssets.get(slot);
            const desiredRevision = desired?.operationRevision;
            const expectedDesired = ownsPrimarySlot && desired &&
                (!Number.isSafeInteger(desiredRevision) || operationRevision === desiredRevision);
            if (status === 1 || status === 2 || (status === 0 && expectedDesired)) {
                pendingSlots.push(slot);
            } else {
                missingSlots.push(slot);
            }
        }

        return Object.freeze({
            primaryWorklet,
            assets,
            revisions,
            rejectedCandidates,
            pendingSlots: Object.freeze(pendingSlots),
            missingSlots: Object.freeze(missingSlots),
            ready: pendingSlots.length === 0 && missingSlots.length === 0,
            stale: false,
            timedOut: false
        });
    },

    waitForEffectiveActiveWasmAssets(plugin, slots = null, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : DSP_BYTES_READY_TIMEOUT_MS;
        const primaryWorklet = options.primaryWorklet ?? this._getPrimaryWorkletNode();
        const explicitTarget = options.primaryWorklet != null;
        const generation = this._audioGraphGeneration;
        const targetIsCurrent = () => explicitTarget
            ? this._isActiveDspWorklet(primaryWorklet) &&
                this._wasmAssetMembershipByNode?.get(primaryWorklet)?.get(plugin?.id) === plugin
            : primaryWorklet === this._getPrimaryWorkletNode();
        const evaluate = () => this.getEffectiveActiveWasmAssetSnapshot(
            plugin,
            slots,
            { primaryWorklet }
        );
        const initial = evaluate();
        if (!targetIsCurrent()) return Promise.resolve(Object.freeze({ ...initial, ready: false, stale: true }));
        if (initial.ready) return Promise.resolve(initial);

        return new Promise(resolve => {
            let settled = false;
            let timer = null;
            let unsubscribePlugin = () => {};
            const onGraphRebuilt = () => settle({
                ...evaluate(),
                ready: false,
                stale: true
            });
            const onParallelInvalidated = () => {
                if (primaryWorklet !== this._getPrimaryWorkletNode()) onGraphRebuilt();
                else check();
            };
            const settle = result => {
                if (settled) return;
                settled = true;
                if (timer !== null) clearTimeout(timer);
                unsubscribePlugin();
                this.removeEventListener('audioGraphRebuilt', onGraphRebuilt);
                if (explicitTarget) {
                    this.removeEventListener('pipelineChanged', check);
                    this.removeEventListener('parallelInvalidated', onParallelInvalidated);
                }
                resolve(Object.freeze(result));
            };
            const check = () => {
                if (generation !== this._audioGraphGeneration ||
                    !targetIsCurrent()) {
                    onGraphRebuilt();
                    return;
                }
                const snapshot = evaluate();
                if (snapshot.ready) settle(snapshot);
            };
            const subscribe = plugin?.addWasmAssetSnapshotChangeListener;
            unsubscribePlugin = typeof subscribe === 'function'
                ? subscribe.call(plugin, check)
                : () => {};
            this.addEventListener('audioGraphRebuilt', onGraphRebuilt);
            if (explicitTarget) {
                this.addEventListener('pipelineChanged', check);
                this.addEventListener('parallelInvalidated', onParallelInvalidated);
            }
            const startTimer = () => {
                timer = setTimeout(async () => {
                    timer = null;
                    // A streamed source owns its bounded worker and page ACK
                    // lifecycle. Wait for that preparation before applying the
                    // normal short deadline to the native ACTIVE notification.
                    const preparation = options.getPreparation?.();
                    if (preparation) {
                        const ready = await preparation;
                        if (settled) return;
                        check();
                        if (settled) return;
                        if (!ready) settle({ ...evaluate(), ready: false });
                        else startTimer();
                    } else settle({ ...evaluate(), ready: false, timedOut: true });
                }, timeoutMs);
            };
            startTimer();
            check();
        });
    },

    _syncWasmAssetMembership(workletNode, pipeline, options = {}) {
        const generation = options.generation ?? this._audioGraphGeneration;
        if (generation !== this._audioGraphGeneration || !this._isActiveDspWorklet(workletNode)) {
            return null;
        }
        if (!(this._wasmAssetMembershipByNode instanceof Map)) {
            this._wasmAssetMembershipByNode = new Map();
        }
        const previous = this._wasmAssetMembershipByNode.get(workletNode) || new Map();
        const next = new Map();
        const added = [];
        for (const plugin of Array.isArray(pipeline) ? pipeline : []) {
            if (!Number.isInteger(plugin?.id)) continue;
            this._configureWasmAssetTargetResolver(plugin);
            next.set(plugin.id, plugin);
            if (previous.get(plugin.id) !== plugin) added.push(plugin);
        }
        for (const [pluginId, plugin] of previous) {
            if (next.get(pluginId) !== plugin) this._pruneWasmAssetStatesForPlugin(workletNode, pluginId);
        }
        this._wasmAssetMembershipByNode.set(workletNode, next);
        const expected = options.replayNew === false ? new Set() : this._replayPipelineWasmAssets(workletNode, added, {
            generation,
            trackState: options.trackState === true
        });
        this._syncLiveMidiInputTargets?.();
        return expected;
    },

    _replayPipelineWasmAssets(workletNode, pipeline, options = {}) {
        const generation = options.generation ?? this._audioGraphGeneration;
        if (generation !== this._audioGraphGeneration || !this._isActiveDspWorklet(workletNode)) {
            return null;
        }
        if (!(this._wasmAssetStatesByNode instanceof Map)) {
            this._wasmAssetStatesByNode = new Map();
        }
        if (!(this._wasmAssetExpectedRevisionsByNode instanceof Map)) {
            this._wasmAssetExpectedRevisionsByNode = new Map();
        }
        if (!(this._wasmAssetExpectedReplayEpochsByNode instanceof Map)) {
            this._wasmAssetExpectedReplayEpochsByNode = new Map();
        }
        const plugins = Array.isArray(pipeline) ? pipeline : [];
        const readinessPlugins = new Set(
            Array.isArray(options.assetReadinessPlugins)
                ? options.assetReadinessPlugins
                : plugins
        );
        const expected = new Set();
        for (const plugin of plugins) {
            if (!Number.isInteger(plugin?.id) || typeof plugin.getWasmAssets !== 'function') continue;
            const assets = options.assetMaps?.get(plugin) || plugin.getWasmAssets();
            this._pruneWasmAssetStatesForPlugin(workletNode, plugin.id);
            for (const [slot, descriptor] of assets) {
                const key = this._wasmAssetKey(plugin.id, slot);
                if (readinessPlugins.has(plugin)) expected.add(key);
                this._expectWasmAssetOperation(
                    workletNode,
                    plugin.id,
                    slot,
                    descriptor?.operationRevision,
                    1
                );
            }
        }
        let states = this._wasmAssetStatesByNode.get(workletNode);
        if (!(states instanceof Map)) {
            states = new Map();
            this._wasmAssetStatesByNode.set(workletNode, states);
        }
        for (const plugin of plugins) {
            if (typeof plugin?.replayWasmAssetsTo !== 'function') continue;
            if (generation !== this._audioGraphGeneration || !this._isActiveDspWorklet(workletNode)) {
                return null;
            }
            const assets = options.assetMaps?.get(plugin) || plugin.getWasmAssets?.();
            plugin.replayWasmAssetsTo(workletNode, {
                trackState: options.trackState === true,
                ...(assets instanceof Map && { assets })
            });
        }
        return expected;
    },

    async _prepareWasmAssetMapsForTarget(workletNode, pipeline, { assetMaps = null,
        generation = this._audioGraphGeneration } = {}) {
        const topology = this._topologyRevision;
        const token = this._dspReadyTokens?.get(workletNode);
        const current = () => generation === this._audioGraphGeneration && topology === this._topologyRevision &&
            token === this._dspReadyTokens?.get(workletNode) && this._isActiveDspWorklet(workletNode);
        const prepared = new Map(), changed = new Set();
        const { prepareSfzAssetForContext } = await import('../sfz/preparation-context.js');
        const { getSfzMaxBytes } = await import('../sfz/limits.js');
        const budget = getSfzMaxBytes(globalThis.window?.appConfig?.sfzMaxSizeMiB);
        const timeline = globalThis.window?.uiManager?.audioPlayer?.contextManager?.midiTimeline ?? null;
        for (const plugin of pipeline) {
            if (!current()) return null;
            const assets = assetMaps?.get(plugin) ?? plugin.getWasmAssets?.() ?? new Map();
            if (!['SoundFontPlayerPlugin', 'SFZNotePlayerPlugin'].includes(plugin.constructor.name) || !assets.size) {
                prepared.set(plugin, assets); continue;
            }
            const context = await this.getSfzPreparationContext(plugin, workletNode, timeline);
            if (!context || !current()) return null;
            const next = new Map();
            for (const [slot, descriptor] of assets) {
                const materialized = await prepareSfzAssetForContext(descriptor, context, budget,
                    (payload, context, formatTag) => this.estimateSfzEffectPreparation(payload, context, formatTag));
                if (!current() || this._wasmAssetMembershipByNode.get(workletNode)?.get(plugin.id) !== plugin) return null;
                next.set(slot, materialized);
                if (materialized !== descriptor) changed.add(plugin);
            }
            prepared.set(plugin, next);
        }
        return { assetMaps: prepared, changed };
    },

    _settleWasmAssetReadyRequest(workletNode, result) {
        const request = this._pendingWasmAssetReadyRequests?.get(workletNode);
        if (!request) return;
        if (request.timer !== null) clearTimeout(request.timer);
        this._pendingWasmAssetReadyRequests.delete(workletNode);
        request.resolve(result);
    },

    _cancelPendingWasmAssetReadyRequests() {
        if (!(this._pendingWasmAssetReadyRequests instanceof Map)) return;
        for (const workletNode of [...this._pendingWasmAssetReadyRequests.keys()]) {
            this._settleWasmAssetReadyRequest(workletNode, false);
        }
    },

    _areWasmAssetsActive(workletNode, expected) {
        const states = this._wasmAssetStatesByNode?.get(workletNode);
        if (!(states instanceof Map)) return false;
        let allActive = true;
        for (const key of expected) {
            const state = (states.get(key) || 0) & 0xff;
            if (state === 4) return false;
            if (state !== 3) allActive = false;
        }
        return allActive ? true : null;
    },

    _captureWasmAssetExpectations(workletNode, expected) {
        if (expected.size === 0) return new Map();
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(workletNode);
        const replayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(workletNode);
        if (!(revisions instanceof Map) || !(replayEpochs instanceof Map)) return null;
        const captured = new Map();
        for (const key of expected) {
            if (!revisions.has(key) || !replayEpochs.has(key)) return null;
            captured.set(key, {
                operationRevision: revisions.get(key),
                replayEpoch: replayEpochs.get(key)
            });
        }
        return captured;
    },

    _areWasmAssetExpectationsActive(workletNode, captured) {
        if (!(captured instanceof Map)) return false;
        const states = this._wasmAssetStatesByNode?.get(workletNode);
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(workletNode);
        const replayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(workletNode);
        if (!(states instanceof Map) || !(revisions instanceof Map) ||
            !(replayEpochs instanceof Map)) return captured.size === 0;
        for (const [key, expected] of captured) {
            if (revisions.get(key) !== expected.operationRevision ||
                replayEpochs.get(key) !== expected.replayEpoch ||
                ((states.get(key) || 0) & 0xff) !== 3) {
                return false;
            }
        }
        return true;
    },

    _waitForWasmAssetsActive(
        workletNode,
        expected,
        generation = this._audioGraphGeneration,
        timeoutMs = DSP_BYTES_READY_TIMEOUT_MS
    ) {
        if (expected.size === 0) return Promise.resolve(true);
        if (generation !== this._audioGraphGeneration || !this._isActiveDspWorklet(workletNode)) {
            return Promise.resolve(false);
        }
        const current = this._areWasmAssetsActive(workletNode, expected);
        if (current !== null) return Promise.resolve(current);
        if (timeoutMs <= 0) return Promise.resolve(false);
        if (!(this._pendingWasmAssetReadyRequests instanceof Map)) {
            this._pendingWasmAssetReadyRequests = new Map();
        }
        this._settleWasmAssetReadyRequest(workletNode, false);
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const request = { expected, generation, timer: null, resolve, promise };
        request.timer = setTimeout(() => {
            if (this._pendingWasmAssetReadyRequests.get(workletNode) !== request) return;
            this._settleWasmAssetReadyRequest(workletNode, false);
        }, timeoutMs);
        this._pendingWasmAssetReadyRequests.set(workletNode, request);
        return promise;
    },

    _updateWasmAssetState(
        workletNode,
        pluginId,
        slot,
        state,
        operationRevision,
        replayEpoch = null,
        transportAcknowledged = false
    ) {
        if (!transportAcknowledged) {
            this._wasmAssetMembershipByNode?.get(workletNode)?.get(pluginId)
                ?.acknowledgeWasmAssetOperation?.(
                    workletNode,
                    slot,
                    operationRevision,
                    replayEpoch
                );
        }
        const states = this._wasmAssetStatesByNode?.get(workletNode);
        if (!(states instanceof Map)) return;
        const key = this._wasmAssetKey(pluginId, slot);
        if (!states.has(key)) return;
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(workletNode);
        if (!(revisions instanceof Map) || !revisions.has(key)) return;
        const replayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(workletNode);
        if (!(replayEpochs instanceof Map) || !replayEpochs.has(key)) return;
        const expectedRevision = revisions.get(key);
        const expectedReplayEpoch = replayEpochs.get(key);
        if (expectedRevision === null
            ? operationRevision !== undefined
            : operationRevision !== expectedRevision) return;
        if (this._normalizedWasmAssetReplayEpoch(replayEpoch) !== expectedReplayEpoch) return;
        states.set(key, state >>> 0);
        this._checkPendingSignedExternalAssetRequests();
        const request = this._pendingWasmAssetReadyRequests?.get(workletNode);
        if (!request || request.generation !== this._audioGraphGeneration ||
            !this._isActiveDspWorklet(workletNode)) return;
        const ready = this._areWasmAssetsActive(workletNode, request.expected);
        if (ready === false && this._parallelPreparing && this._parallelDspBarrier) {
            for (const node of this._parallelDspBarrier.workletNodes) {
                this._settleWasmAssetReadyRequest(node, false);
            }
        } else if (ready !== null) {
            this._settleWasmAssetReadyRequest(workletNode, ready);
        }
    },

    _updateWasmAssetRejection(workletNode, data) {
        this._wasmAssetMembershipByNode?.get(workletNode)?.get(data?.pluginId)
            ?.acknowledgeWasmAssetOperation?.(
                workletNode,
                data?.slot,
                data?.operationRevision,
                data?.replayEpoch
            );
        const states = this._wasmAssetStatesByNode?.get(workletNode);
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(workletNode);
        const replayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(workletNode);
        if (!(states instanceof Map) || !(revisions instanceof Map) ||
            !(replayEpochs instanceof Map)) return;
        const key = this._wasmAssetKey(data?.pluginId, data?.slot);
        if (!states.has(key) || !revisions.has(key) || !replayEpochs.has(key)) return;
        const expectedRevision = revisions.get(key);
        const expectedReplayEpoch = replayEpochs.get(key);
        if (expectedRevision === null
            ? data?.operationRevision !== undefined
            : data?.operationRevision !== expectedRevision) return;
        if (this._normalizedWasmAssetReplayEpoch(data?.replayEpoch) !== expectedReplayEpoch) return;
        const retainedOperationRevision = this._normalizedWasmAssetOperationRevision(
            data?.retainedOperationRevision
        );
        const retainedReplayEpoch = this._normalizedWasmAssetReplayEpoch(
            data?.retainedReplayEpoch
        );
        const retainedAssetState = Number.isInteger(data?.retainedAssetState)
            ? data.retainedAssetState >>> 0
            : 0;
        const retainedStatus = retainedAssetState & 0xff;
        const replayFailure = data?.replayFailure === true;
        if (!replayFailure && expectedRevision !== null && data?.residentRetained === true &&
            retainedOperationRevision !== null && retainedStatus >= 1 && retainedStatus <= 3) {
            revisions.set(key, retainedOperationRevision);
            replayEpochs.set(key, retainedReplayEpoch);
            this._updateWasmAssetState(
                workletNode,
                data.pluginId,
                data.slot,
                retainedAssetState,
                retainedOperationRevision,
                retainedReplayEpoch,
                true
            );
            return;
        }
        this._updateWasmAssetState(
            workletNode,
            data.pluginId,
            data.slot,
            4,
            data?.operationRevision,
            data?.replayEpoch,
            true
        );
    },
    _capturePendingSignedExternalAssetRequests(workletNode, pipeline) {
        const requests = new Map();
        const states = this._wasmAssetStatesByNode?.get(workletNode);
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(workletNode);
        for (const plugin of Array.isArray(pipeline) ? pipeline : []) {
            const info = plugin?.externalAssetInfo;
            const requestedSignature = typeof info?.assetSignature === 'string'
                ? info.assetSignature
                : null;
            if (info?.missing === true) return false;
            if (info?.pending === true) {
                requests.set(plugin, {
                    awaitingPending: true,
                    requestedFromPending: true,
                    requestedSignature
                });
                continue;
            }
            if (requestedSignature === null || !Array.isArray(info?.ids) || info.ids.length === 0) {
                continue;
            }
            const assets = plugin?.getWasmAssets?.();
            const settled = assets instanceof Map && assets.size > 0 &&
                [...assets].every(([slot, descriptor]) => {
                    const key = this._wasmAssetKey(plugin.id, slot);
                    return descriptor?.externalAssetSignature === requestedSignature &&
                        revisions?.get(key) === this._normalizedWasmAssetOperationRevision(
                            descriptor?.operationRevision
                        ) && ((states?.get(key) || 0) & 0xff) === 3;
                });
            if (!settled) requests.set(plugin, {
                awaitingPending: false,
                requestedFromPending: false,
                requestedSignature
            });
        }
        return requests;
    },

    _evaluateSignedExternalAssetRequest(request) {
        if (!request || request.generation !== this._audioGraphGeneration ||
            !this._isActiveDspWorklet(request.workletNode)) {
            return false;
        }
        const states = this._wasmAssetStatesByNode?.get(request.workletNode);
        const revisions = this._wasmAssetExpectedRevisionsByNode?.get(request.workletNode);
        const replayEpochs = this._wasmAssetExpectedReplayEpochsByNode?.get(request.workletNode);
        let pending = false;
        for (const [plugin, pendingRequest] of request.requests) {
            const info = plugin?.externalAssetInfo;
            if (info?.missing === true) return false;
            if (info?.pending === true) {
                pending = true;
                continue;
            }
            if (pendingRequest.awaitingPending) {
                if (!Array.isArray(info?.ids) || info.ids.length === 0 ||
                    typeof info?.assetSignature !== 'string') {
                    return false;
                }
                pendingRequest.awaitingPending = false;
                pendingRequest.requestedSignature = info.assetSignature;
            }
            const requestedSignature = pendingRequest.requestedSignature;
            if (typeof requestedSignature !== 'string' || info?.assetSignature !== requestedSignature) {
                return false;
            }
            const assets = plugin?.getWasmAssets?.();
            if (!(assets instanceof Map) || assets.size === 0 ||
                [...assets.values()].some(
                    descriptor => descriptor?.externalAssetSignature !== requestedSignature
                )) {
                if (pendingRequest.requestedFromPending === true) return false;
                pending = true;
                continue;
            }
            for (const [slot, descriptor] of assets) {
                const key = this._wasmAssetKey(plugin.id, slot);
                const revision = this._normalizedWasmAssetOperationRevision(
                    descriptor?.operationRevision
                );
                const state = (states?.get(key) || 0) & 0xff;
                if (state === 4) return false;
                if (revisions?.get(key) !== revision || !replayEpochs?.has(key) || state !== 3) {
                    pending = true;
                }
            }
        }
        return pending ? null : true;
    },

    _settleSignedExternalAssetRequest(request, result) {
        if (!request || request.settled) return;
        request.settled = true;
        if (request.timer !== null) clearTimeout(request.timer);
        for (const unsubscribe of request.unsubscribes) unsubscribe();
        this._pendingSignedExternalAssetRequests?.delete(request);
        request.resolve(result);
    },

    _checkPendingSignedExternalAssetRequests() {
        if (!(this._pendingSignedExternalAssetRequests instanceof Set)) return;
        for (const request of [...this._pendingSignedExternalAssetRequests]) {
            const result = this._evaluateSignedExternalAssetRequest(request);
            if (result !== null) this._settleSignedExternalAssetRequest(request, result);
        }
    },

    _cancelPendingSignedExternalAssetRequests() {
        if (!(this._pendingSignedExternalAssetRequests instanceof Set)) return;
        for (const request of [...this._pendingSignedExternalAssetRequests]) {
            this._settleSignedExternalAssetRequest(request, false);
        }
    },

    _waitForSignedExternalAssetsOnPrimary(workletNode, pipeline, deadline) {
        const requests = this._capturePendingSignedExternalAssetRequests(workletNode, pipeline);
        if (requests === false) return false;
        if (requests.size === 0) return true;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        if (!(this._pendingSignedExternalAssetRequests instanceof Set)) {
            this._pendingSignedExternalAssetRequests = new Set();
        }
        for (const plugin of requests.keys()) this._configureWasmAssetTargetResolver(plugin);
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const request = {
            workletNode,
            requests,
            generation: this._audioGraphGeneration,
            settled: false,
            timer: null,
            unsubscribes: [],
            resolve,
            promise
        };
        const check = () => {
            const result = this._evaluateSignedExternalAssetRequest(request);
            if (result !== null) this._settleSignedExternalAssetRequest(request, result);
        };
        for (const plugin of requests.keys()) {
            request.unsubscribes.push(plugin.addWasmAssetChangeListener?.(check) || (() => {}));
            request.unsubscribes.push(
                plugin.addWasmAssetSnapshotChangeListener?.(check) || (() => {})
            );
        }
        request.timer = setTimeout(() => {
            this._settleSignedExternalAssetRequest(request, false);
        }, remaining);
        this._pendingSignedExternalAssetRequests.add(request);
        check();
        return promise;
    },

    _waitForPendingExternalAssetDescriptors(pipeline, deadline) {
        const plugins = new Set(
            (Array.isArray(pipeline) ? pipeline : []).filter(
                plugin => plugin?.externalAssetInfo?.pending === true
            )
        );
        if (plugins.size === 0) return true;
        const generation = this._audioGraphGeneration;
        const evaluate = () => {
            if (generation !== this._audioGraphGeneration) return false;
            let pending = false;
            for (const plugin of plugins) {
                const info = plugin?.externalAssetInfo;
                if (info?.missing === true) return false;
                if (info?.pending === true) {
                    pending = true;
                    continue;
                }
                if (!Array.isArray(info?.ids) || info.ids.length === 0 ||
                    typeof info?.assetSignature !== 'string') {
                    return false;
                }
                const assets = plugin?.getWasmAssets?.();
                if (!(assets instanceof Map) || assets.size === 0 ||
                    [...assets.values()].some(
                        descriptor => descriptor?.externalAssetSignature !== info.assetSignature
                    )) {
                    return false;
                }
            }
            return pending ? null : true;
        };
        const initial = evaluate();
        if (initial !== null) return initial;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        if (!(this._pendingWasmAssetDescriptorRequests instanceof Set)) {
            this._pendingWasmAssetDescriptorRequests = new Set();
        }
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const request = {
            settled: false,
            timer: null,
            unsubscribes: [],
            resolve,
            promise
        };
        const check = () => {
            if (request.settled) return;
            const result = evaluate();
            if (result !== null) this._settleWasmAssetDescriptorRequest(request, result);
        };
        for (const plugin of plugins) {
            request.unsubscribes.push(plugin.addWasmAssetChangeListener?.(check) || (() => {}));
            request.unsubscribes.push(
                plugin.addWasmAssetSnapshotChangeListener?.(check) || (() => {})
            );
        }
        request.timer = setTimeout(() => {
            this._settleWasmAssetDescriptorRequest(request, false);
        }, remaining);
        this._pendingWasmAssetDescriptorRequests.add(request);
        check();
        return promise;
    },
    _settleWasmAssetDescriptorRequest(request, result) {
        if (!request || request.settled) return;
        request.settled = true;
        if (request.timer !== null) clearTimeout(request.timer);
        for (const unsubscribe of request.unsubscribes) unsubscribe();
        this._pendingWasmAssetDescriptorRequests?.delete(request);
        request.resolve(result);
    },

    _cancelPendingWasmAssetDescriptorRequests() {
        if (!(this._pendingWasmAssetDescriptorRequests instanceof Set)) return;
        for (const request of [...this._pendingWasmAssetDescriptorRequests]) {
            this._settleWasmAssetDescriptorRequest(request, false);
        }
    },
};
