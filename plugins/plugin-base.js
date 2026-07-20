// IMPORTANT: Do not add individual plugin implementations directly in this file.
// This file contains the base plugin class that all plugins should extend.
// Plugin implementations should be created in their own files under the plugins directory.
// See docs/plugin-development.md for plugin development guidelines.

// Keep only the latest fallback pair when no live delivery owns a descriptor.
// Active delivery retention is bounded separately per worklet and slot.
const MAX_PENDING_WASM_ASSET_REVISIONS = 2;

class PluginBase {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.enabled = true;
        // Whether the section the plugin belongs to is enabled. The pipeline
        // updates this when the user toggles a Section's ON button; used
        // together with `enabled` to decide whether the plugin's redraw loop
        // (startAnimation/stopAnimation) should run.
        this._sectionEnabled = true;
        this._powerUiEnabled = true;
        // Unknown plugin state is conservatively reset across a skipped span.
        // Same-quantum Monitoring still requires an explicit static descriptor.
        this.temporalCapability = 'reset-on-resume';
        this.monitoringPreparationDescriptor = null;
        this.powerGainUpperBoundDb = null;
        this.id = null; // Will be set by createPlugin
        this.errorState = null; // Holds error state
        this.inputBus = null; // Input bus (null = default Main bus, index 0)
        this.outputBus = null; // Output bus (null = default Main bus, index 0)
        this.channel = null; // Channel processing: null ('All'), 'Left', 'Right'
        this._lastUpdatedChannel = this.channel;
        this._responsiveGraphDisposers = new Set();
        this._wasmAssets = new Map();
        this._wasmAssetStates = new Map();
        this._wasmAssetStateRevisions = new Map();
        this._wasmAssetRevision = 0;
        this._wasmAssetOperationRevisions = new Map();
        this._wasmAssetOperationCounters = new Map();
        this._wasmAssetDeliveries = new Map();
        this._wasmAssetAcknowledgedDescriptors = new Map();
        this._wasmAssetAcknowledgedReplayEpochs = new Map();
        this._wasmAssetLogicalReplayEpochs = new Map();
        this._wasmAssetReplayEpochCounters = new WeakMap();
        this._wasmAssetPendingPredecessors = new Map();
        this._wasmAssetRevisionDescriptors = new Map();
        this._wasmAssetResidentDescriptors = new Map();
        this._wasmAssetChangeListeners = new Set();
        this._wasmAssetSnapshotChangeListeners = new Set();
        this._wasmAssetTargetResolver = null;
        this._wasmAssetOperationObserver = null;

        // Intercept every prototype startAnimation() entry, including direct
        // IntersectionObserver callbacks, so they cannot bypass the common gate.
        const unrestrictedStartAnimation = this.startAnimation;
        if (typeof unrestrictedStartAnimation === 'function') {
            this._unrestrictedStartAnimation = unrestrictedStartAnimation;
            this.startAnimation = (...args) => {
                if (!this.canRunAnimation()) return undefined;
                return unrestrictedStartAnimation.apply(this, args);
            };
        }

        // Message control properties
        this.lastUpdateTime = 0;
        this.UPDATE_INTERVAL = 16; // Minimum update interval in ms
        this.pendingUpdate = null;
        this._pendingTimeoutId = null; // Stores the timeout ID for queued updates

        // Processor storage
        this.processorString = null;
        this.compiledFunction = null;

        // Flag to track message handler registration
        this._hasMessageHandler = false;
        this._messageHandlerWorkletNode = null;
        this._messageHandlerObserver = null;

        // Bind _handleMessage only once for performance
        this._boundHandleMessage = this._handleMessage.bind(this);

        // If workletNode exists, set up the message handler immediately
        if (window.workletNode) {
            this._setupMessageHandler();
        }

        // Observe mutations to detect when workletNode becomes available
        this._messageHandlerObserver = new MutationObserver(() => {
            if (window.workletNode && !this._hasMessageHandler) {
                this._setupMessageHandler();
                this._messageHandlerObserver?.disconnect();
                this._messageHandlerObserver = null;
            }
        });
        this._messageHandlerObserver.observe(document, {
            attributes: true,
            childList: true,
            subtree: true
        });
    }

    _setupMessageHandler() {
        const currentWorkletNode = window.workletNode;
        if (!currentWorkletNode?.port) {
            return;
        }

        if (this._messageHandlerWorkletNode === currentWorkletNode && this._hasMessageHandler) {
            return;
        }

        if (this._messageHandlerWorkletNode?.port && this._hasMessageHandler) {
            try {
                this._messageHandlerWorkletNode.port.removeEventListener('message', this._boundHandleMessage);
            } catch (error) {
                // Ignore stale port cleanup failures.
            }
            this.dropWasmAssetTarget(this._messageHandlerWorkletNode);
            this._wasmAssetAcknowledgedDescriptors.clear();
            this._wasmAssetAcknowledgedReplayEpochs.clear();
            this._wasmAssetLogicalReplayEpochs.clear();
            this._wasmAssetPendingPredecessors.clear();
        }

        currentWorkletNode.port.addEventListener('message', this._boundHandleMessage);
        this._messageHandlerWorkletNode = currentWorkletNode;
        this._hasMessageHandler = true;
    }
    
    _disposeResponsiveGraphs() {
        if (!this._responsiveGraphDisposers) return;
        const disposers = Array.from(this._responsiveGraphDisposers);
        this._responsiveGraphDisposers.clear();
        for (const dispose of disposers) {
            try {
                dispose();
            } catch (error) {
                console.warn(`[${this.name}] Failed to dispose responsive graph:`, error);
            }
        }
    }

    _handleMessage(event) {
        const sourcePort = event?.currentTarget || event?.target;
        if (this._messageHandlerWorkletNode !== window.workletNode ||
            (sourcePort && sourcePort !== this._messageHandlerWorkletNode?.port)) {
            return;
        }
        if (event.data.pluginId === this.id) {
            if (event.data.type === 'assetState') {
                const slot = event.data.slot >>> 0;
                const operationRevision = event.data.operationRevision;
                const replayEpoch = this._normalizeWasmAssetReplayEpoch(event.data.replayEpoch);
                const inflight = this._wasmAssetDeliveries.get(this._messageHandlerWorkletNode)
                    ?.get(slot)?.inflight;
                const acknowledged = this._wasmAssetAcknowledgedDescriptors.get(slot);
                const transportRelevant =
                    this._isInflightWasmAssetOperation(
                        this._messageHandlerWorkletNode,
                        slot,
                        operationRevision,
                        replayEpoch
                    ) || acknowledged?.operationRevision === operationRevision &&
                        (this._wasmAssetAcknowledgedReplayEpochs.get(slot) ?? null) === replayEpoch;
                const logicalCurrent = this._isCurrentWasmAssetOperation(slot, operationRevision) &&
                    (this._wasmAssetLogicalReplayEpochs.get(slot) ?? null) === replayEpoch;
                if (!transportRelevant && !logicalCurrent) return;
                this.acknowledgeWasmAssetOperation(
                    this._messageHandlerWorkletNode,
                    slot,
                    operationRevision,
                    replayEpoch
                );
                if (inflight?.trackState === false && !logicalCurrent) return;
                this._recordWasmAssetResidency(
                    slot,
                    event.data.state,
                    operationRevision
                );
                if (!logicalCurrent) return;
                this._wasmAssetStates.set(slot, event.data.state >>> 0);
                this._wasmAssetStateRevisions.set(slot, operationRevision);
                if ((event.data.state & 0xff) === 3) {
                    this._wasmAssetPendingPredecessors.delete(slot);
                    this._pruneWasmAssetRevisionDescriptors(slot, operationRevision);
                }
                this.onWasmAssetState(slot, event.data.state >>> 0, operationRevision);
            } else if (event.data.type === 'assetLoadRejected') {
                const slot = event.data.slot >>> 0;
                const operationRevision = event.data.operationRevision;
                const replayEpoch = this._normalizeWasmAssetReplayEpoch(event.data.replayEpoch);
                const inflight = this._wasmAssetDeliveries.get(this._messageHandlerWorkletNode)
                    ?.get(slot)?.inflight;
                const acknowledged = this._wasmAssetAcknowledgedDescriptors.get(slot);
                const transportRelevant =
                    this._isInflightWasmAssetOperation(
                        this._messageHandlerWorkletNode,
                        slot,
                        operationRevision,
                        replayEpoch
                    ) || acknowledged?.operationRevision === operationRevision &&
                        (this._wasmAssetAcknowledgedReplayEpochs.get(slot) ?? null) === replayEpoch;
                const logicalCurrent = this._isCurrentWasmAssetOperation(slot, operationRevision) &&
                    (this._wasmAssetLogicalReplayEpochs.get(slot) ?? null) === replayEpoch;
                const recordedState = this._wasmAssetStateRevisions.get(slot) === operationRevision
                    ? this._wasmAssetStates.get(slot)
                    : null;
                const logicalPreparation = logicalCurrent && Number.isInteger(recordedState) &&
                    (recordedState & 0xff) >= 1 && (recordedState & 0xff) < 3;
                const replayFailure = event.data.replayFailure === true;
                if (!transportRelevant && !logicalPreparation && !(logicalCurrent && replayFailure)) {
                    return;
                }
                this.acknowledgeWasmAssetOperation(
                    this._messageHandlerWorkletNode,
                    slot,
                    operationRevision,
                    replayEpoch
                );
                if (inflight?.trackState === false && !logicalCurrent) return;
                const reportedRetainedState = Number.isInteger(event.data.retainedAssetState)
                    ? event.data.retainedAssetState >>> 0
                    : 0;
                const reportedRetainedStatus = reportedRetainedState & 0xff;
                const reportedRetainedRevision = event.data.retainedOperationRevision;
                if (event.data.replayFailure !== true && event.data.residentRetained === true &&
                    reportedRetainedStatus >= 1 && reportedRetainedStatus <= 3) {
                    this._recordWasmAssetResidency(
                        slot,
                        reportedRetainedState,
                        reportedRetainedRevision
                    );
                } else {
                    this._clearWasmAssetResidentDescriptor(slot);
                }
                if (!logicalCurrent) {
                    if (this._wasmAssetAcknowledgedDescriptors.get(slot)?.operationRevision ===
                        operationRevision) {
                        this._wasmAssetAcknowledgedDescriptors.delete(slot);
                        this._wasmAssetAcknowledgedReplayEpochs.delete(slot);
                    }
                    return;
                }
                const retainedOperationRevision = event.data.retainedOperationRevision;
                const retainedReplayEpoch = this._normalizeWasmAssetReplayEpoch(
                    event.data.retainedReplayEpoch
                );
                const retainedAssetState = Number.isInteger(event.data.retainedAssetState)
                    ? event.data.retainedAssetState >>> 0
                    : 0;
                const retainedStatus = retainedAssetState & 0xff;
                const retainedDescriptor = this._getWasmAssetRevisionDescriptor(
                    slot,
                    retainedOperationRevision
                );
                const residentRetained = event.data.residentRetained === true &&
                    replayFailure === false && retainedStatus >= 1 && retainedStatus <= 3 &&
                    Number.isSafeInteger(retainedOperationRevision) && retainedOperationRevision > 0 &&
                    retainedDescriptor?.operationRevision === retainedOperationRevision;
                this._wasmAssetPendingPredecessors.delete(slot);
                if (residentRetained) {
                    this._wasmAssets.set(slot, retainedDescriptor);
                    this._wasmAssetStates.set(slot, retainedAssetState);
                    this._wasmAssetStateRevisions.set(slot, retainedOperationRevision);
                } else {
                    this._wasmAssets.delete(slot);
                    this._wasmAssetStates.delete(slot);
                    this._wasmAssetStateRevisions.delete(slot);
                    this._wasmAssetLogicalReplayEpochs.delete(slot);
                }
                this.onWasmAssetRejected(slot, event.data.reason, operationRevision, {
                    residentRetained,
                    replayFailure,
                    ...(residentRetained && {
                        retainedOperationRevision,
                        retainedAssetState
                    }),
                    ...(residentRetained && retainedReplayEpoch !== null && {
                        retainedReplayEpoch
                    })
                });
                const retainedAfterCallback = residentRetained &&
                    this._wasmAssets.get(slot) === retainedDescriptor;
                if (retainedAfterCallback) {
                    this._wasmAssetOperationRevisions.set(slot, retainedOperationRevision);
                    if (retainedReplayEpoch === null) {
                        this._wasmAssetLogicalReplayEpochs.delete(slot);
                    } else {
                        this._wasmAssetLogicalReplayEpochs.set(slot, retainedReplayEpoch);
                    }
                    if (retainedStatus < 3) {
                        this._wasmAssetPendingPredecessors.set(slot, {
                            candidateRevision: retainedOperationRevision
                        });
                    }
                    this._pruneWasmAssetRevisionDescriptors(slot, retainedOperationRevision);
                } else if (!residentRetained) {
                    this._clearWasmAssetRevisionDescriptors(slot);
                }
                if (this._wasmAssetAcknowledgedDescriptors.get(slot)?.operationRevision ===
                    operationRevision) {
                    this._wasmAssetAcknowledgedDescriptors.delete(slot);
                    this._wasmAssetAcknowledgedReplayEpochs.delete(slot);
                }
                if (!residentRetained || retainedAfterCallback) this._notifyWasmAssetChange();
            }
            const currentTime = performance.now();
            if (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
                // Process immediately if enough time has passed
                this.onMessage(event.data);
                this.lastUpdateTime = currentTime;
                this.pendingUpdate = null;
                if (this._pendingTimeoutId !== null) {
                    clearTimeout(this._pendingTimeoutId);
                    this._pendingTimeoutId = null;
                }
            } else {
                // Queue update by overwriting any existing pending update
                this.pendingUpdate = event.data;
                // Schedule a timeout only if one is not already pending
                if (this._pendingTimeoutId === null) {
                    const timeUntilNextUpdate = this.UPDATE_INTERVAL - (currentTime - this.lastUpdateTime);
                    this._pendingTimeoutId = setTimeout(() => {
                        if (this.pendingUpdate) {
                            this.onMessage(this.pendingUpdate);
                            this.lastUpdateTime = performance.now();
                            this.pendingUpdate = null;
                        }
                        this._pendingTimeoutId = null;
                    }, timeUntilNextUpdate);
                }
            }
        }
    }

    // Default message handler (can be overridden by subclasses)
    onMessage(message) {
        // Default implementation does nothing
    }

    onWasmAssetState(slot, state, operationRevision) {
        // Asset-aware plugins may override this to update their status display.
    }

    onWasmAssetRejected(slot, reason, operationRevision, retention = {}) {
        // Asset-aware plugins may override this to show a load rejection notice.
    }

    onWasmAssetResidency(slot, state, operationRevision, descriptor) {
        // Asset-aware plugins may override this to pin revision-specific state.
    }

    _nextWasmAssetOperationRevision(slot) {
        const current = this._wasmAssetOperationCounters.get(slot) || 0;
        const next = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
        this._wasmAssetOperationCounters.set(slot, next);
        this._wasmAssetOperationRevisions.set(slot, next);
        return next;
    }

    _isCurrentWasmAssetOperation(slot, operationRevision) {
        return Number.isSafeInteger(operationRevision) && operationRevision > 0 &&
            this._wasmAssetOperationRevisions.get(slot) === operationRevision;
    }

    _normalizeWasmAssetReplayEpoch(value) {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    _nextWasmAssetReplayEpoch(workletNode) {
        const current = this._wasmAssetReplayEpochCounters.get(workletNode) || 0;
        const next = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
        this._wasmAssetReplayEpochCounters.set(workletNode, next);
        return next;
    }

    _isInflightWasmAssetOperation(workletNode, slot, operationRevision, replayEpoch = null) {
        return Number.isSafeInteger(operationRevision) && operationRevision > 0 &&
            this._wasmAssetDeliveries.get(workletNode)?.get(slot)?.inflight?.operationRevision ===
                operationRevision &&
            (this._wasmAssetDeliveries.get(workletNode)?.get(slot)?.inflight?.replayEpoch ?? null) ===
                this._normalizeWasmAssetReplayEpoch(replayEpoch);
    }

    getWasmAssetOperationRevision(slot) {
        return this._wasmAssetOperationRevisions.get(slot) ?? null;
    }

    getWasmAssetDeliveryRevisions(slot) {
        const revisions = new Set(this._wasmAssetRevisionDescriptors.get(slot)?.keys() || []);
        const residentRevision = this._wasmAssetResidentDescriptors.get(slot)
            ?.descriptor?.operationRevision;
        if (Number.isSafeInteger(residentRevision)) revisions.add(residentRevision);
        const acknowledgedRevision = this._wasmAssetAcknowledgedDescriptors.get(slot)
            ?.operationRevision;
        if (Number.isSafeInteger(acknowledgedRevision)) revisions.add(acknowledgedRevision);
        return revisions;
    }

    _rememberWasmAssetRevisionDescriptor(slot, descriptor) {
        let descriptors = this._wasmAssetRevisionDescriptors.get(slot);
        if (!descriptors) {
            descriptors = new Map();
            this._wasmAssetRevisionDescriptors.set(slot, descriptors);
        }
        descriptors.set(descriptor.operationRevision, descriptor);
        while (descriptors.size > MAX_PENDING_WASM_ASSET_REVISIONS) {
            descriptors.delete(descriptors.keys().next().value);
        }
    }

    _getWasmAssetRevisionDescriptor(slot, operationRevision) {
        if (!Number.isSafeInteger(operationRevision) || operationRevision <= 0) return null;
        const resident = this._wasmAssetResidentDescriptors.get(slot);
        if (resident && resident.descriptor?.operationRevision === operationRevision) {
            return resident.descriptor;
        }
        const acknowledged = this._wasmAssetAcknowledgedDescriptors.get(slot);
        if (acknowledged?.operationRevision === operationRevision) return acknowledged;
        return this._wasmAssetRevisionDescriptors.get(slot)?.get(operationRevision) || null;
    }

    _recordWasmAssetResidency(slot, state, operationRevision) {
        const normalizedState = Number.isInteger(state) ? state >>> 0 : 0;
        const status = normalizedState & 0xff;
        if (status < 1 || status > 3 ||
            !Number.isSafeInteger(operationRevision) || operationRevision <= 0) {
            if (status === 0 || status === 4) this._clearWasmAssetResidentDescriptor(slot);
            return false;
        }
        const descriptor = this._getWasmAssetRevisionDescriptor(slot, operationRevision) ||
            (this._wasmAssets.get(slot)?.operationRevision === operationRevision
                ? this._wasmAssets.get(slot)
                : null);
        if (!descriptor) return false;
        this._wasmAssetResidentDescriptors.set(slot, { descriptor, state: normalizedState });
        if (this._wasmAssetAcknowledgedDescriptors.get(slot) === descriptor) {
            this._wasmAssetAcknowledgedDescriptors.delete(slot);
            this._wasmAssetAcknowledgedReplayEpochs.delete(slot);
        }
        this.onWasmAssetResidency(slot, normalizedState, operationRevision, descriptor);
        return true;
    }

    _pinPotentialWasmAssetResident(slot, descriptor) {
        if (!descriptor || this._wasmAssetResidentDescriptors.has(slot)) return;
        this._wasmAssetResidentDescriptors.set(slot, { descriptor, state: 1 });
        this.onWasmAssetResidency(slot, 1, descriptor.operationRevision, descriptor);
    }

    _clearWasmAssetResidentDescriptor(slot) {
        if (!this._wasmAssetResidentDescriptors.delete(slot)) return false;
        this.onWasmAssetResidency(slot, 0, null, null);
        return true;
    }

    _pruneWasmAssetRevisionDescriptors(slot, retainedOperationRevision) {
        const descriptors = this._wasmAssetRevisionDescriptors.get(slot);
        const retained = descriptors?.get(retainedOperationRevision) ||
            this._getWasmAssetRevisionDescriptor(slot, retainedOperationRevision);
        if (!retained) {
            this._wasmAssetRevisionDescriptors.delete(slot);
            return;
        }
        this._wasmAssetRevisionDescriptors.set(
            slot,
            new Map([[retainedOperationRevision, retained]])
        );
    }

    _clearWasmAssetRevisionDescriptors(slot) {
        this._wasmAssetRevisionDescriptors.delete(slot);
    }

    _refreshWasmAssetRevisionDescriptors(slot) {
        const descriptors = [];
        for (const deliveries of this._wasmAssetDeliveries.values()) {
            const delivery = deliveries.get(slot);
            if (delivery?.inflight?.type === 'set' &&
                !descriptors.includes(delivery.inflight.descriptor)) {
                descriptors.push(delivery.inflight.descriptor);
            }
            if (delivery?.queued?.type === 'set' &&
                !descriptors.includes(delivery.queued.descriptor)) {
                descriptors.push(delivery.queued.descriptor);
            }
            if (delivery?.deferredReplay?.type === 'set' &&
                !descriptors.includes(delivery.deferredReplay.descriptor)) {
                descriptors.push(delivery.deferredReplay.descriptor);
            }
        }
        const current = this._wasmAssets.get(slot);
        if (current && !descriptors.includes(current)) descriptors.push(current);
        if (!descriptors.length) {
            this._wasmAssetRevisionDescriptors.delete(slot);
            return;
        }
        this._wasmAssetRevisionDescriptors.set(
            slot,
            new Map(descriptors.map(descriptor =>
                [descriptor.operationRevision, descriptor]))
        );
    }

    _postWasmAssetClear(workletNode, slot, operationRevision, replayEpoch = null) {
        if (!workletNode?.port || !Number.isInteger(this.id)) return false;
        replayEpoch = this._normalizeWasmAssetReplayEpoch(replayEpoch);
        this._observeWasmAssetOperation(workletNode, slot, operationRevision, 0, replayEpoch);
        workletNode.port.postMessage({
            type: 'clearPluginAsset',
            pluginId: this.id,
            slot,
            operationRevision,
            ...(replayEpoch !== null && { replayEpoch })
        });
        return true;
    }

    _startWasmAssetDelivery(workletNode, slot, request) {
        if (!workletNode?.port) return false;
        let deliveries = this._wasmAssetDeliveries.get(workletNode);
        if (!deliveries) {
            deliveries = new Map();
            this._wasmAssetDeliveries.set(workletNode, deliveries);
        }
        deliveries.set(slot, {
            inflight: request,
            queued: null,
            deferredReplay: null
        });
        const logicalTarget = workletNode === this._messageHandlerWorkletNode ||
            workletNode === window.workletNode;
        const trackLogicalState = request.trackState !== false;
        if (logicalTarget && trackLogicalState && request.type === 'set') {
            this._wasmAssetPendingPredecessors.set(slot, {
                candidateRevision: request.operationRevision
            });
        } else if (logicalTarget && trackLogicalState) {
            this._wasmAssetPendingPredecessors.delete(slot);
        }
        this._refreshWasmAssetRevisionDescriptors(slot);
        if (request.type === 'set') {
            this._postWasmAsset(workletNode, slot, request.descriptor, request.replayEpoch);
        } else {
            this._postWasmAssetClear(
                workletNode,
                slot,
                request.operationRevision,
                request.replayEpoch
            );
        }
        return true;
    }

    _queueWasmAssetDelivery(workletNode, slot, request) {
        const delivery = this._wasmAssetDeliveries.get(workletNode)?.get(slot);
        if (!delivery?.inflight) return this._startWasmAssetDelivery(workletNode, slot, request);
        if (request.trackState === false && delivery.queued?.trackState !== false) {
            delivery.deferredReplay = request;
        } else {
            if (request.trackState !== false && delivery.queued?.trackState === false) {
                delivery.deferredReplay = delivery.queued;
            }
            delivery.queued = request;
        }
        this._refreshWasmAssetRevisionDescriptors(slot);
        return true;
    }

    acknowledgeWasmAssetOperation(workletNode, slot, operationRevision, replayEpoch = null) {
        const deliveries = this._wasmAssetDeliveries.get(workletNode);
        const delivery = deliveries?.get(slot);
        replayEpoch = this._normalizeWasmAssetReplayEpoch(replayEpoch);
        if (delivery?.inflight?.operationRevision !== operationRevision ||
            (delivery.inflight.replayEpoch ?? null) !== replayEpoch) return false;
        const logicalTarget = workletNode === this._messageHandlerWorkletNode ||
            workletNode === window.workletNode;
        const trackLogicalState = delivery.inflight.trackState !== false;
        if (logicalTarget && trackLogicalState && delivery.inflight.type === 'set') {
            this._wasmAssetAcknowledgedDescriptors.set(slot, delivery.inflight.descriptor);
            if (replayEpoch === null) this._wasmAssetAcknowledgedReplayEpochs.delete(slot);
            else this._wasmAssetAcknowledgedReplayEpochs.set(slot, replayEpoch);
        }
        if (logicalTarget && trackLogicalState) {
            const pending = this._wasmAssetPendingPredecessors.get(slot);
            if (pending?.candidateRevision === operationRevision) {
                this._wasmAssetPendingPredecessors.delete(slot);
            }
        }
        const queued = delivery.queued;
        const deferredReplay = delivery.deferredReplay;
        deliveries.delete(slot);
        if (!deliveries.size) this._wasmAssetDeliveries.delete(workletNode);
        this._refreshWasmAssetRevisionDescriptors(slot);
        if (queued) {
            this._startWasmAssetDelivery(workletNode, slot, queued);
            if (deferredReplay) {
                this._wasmAssetDeliveries.get(workletNode).get(slot).queued = deferredReplay;
                this._refreshWasmAssetRevisionDescriptors(slot);
            }
        } else if (deferredReplay) {
            this._startWasmAssetDelivery(workletNode, slot, deferredReplay);
        }
        return true;
    }

    setWasmAsset(slot, descriptor) {
        if (!Number.isInteger(slot) || slot < 0 || !(descriptor?.payload instanceof ArrayBuffer)) {
            throw new TypeError('A WASM asset requires a non-negative slot and an ArrayBuffer payload');
        }
        const normalized = {
            formatTag: descriptor.formatTag ?? 1,
            headBlock: descriptor.headBlock ?? 128,
            rateDivider: descriptor.rateDivider ?? 1,
            pathCount: descriptor.pathCount ?? 0,
            inputCount: descriptor.inputCount ?? 0,
            processingChannels: descriptor.processingChannels ?? 1,
            footprintBytes: descriptor.footprintBytes,
            ...(typeof descriptor.externalAssetSignature === 'string' && {
                externalAssetSignature: descriptor.externalAssetSignature
            }),
            payload: descriptor.payload.slice(0)
        };
        if (!Number.isSafeInteger(normalized.footprintBytes) ||
            normalized.footprintBytes < descriptor.payload.byteLength) {
            throw new TypeError('A WASM asset footprint must cover the payload with a safe integer byte count');
        }
        this._pinPotentialWasmAssetResident(slot, this._wasmAssets.get(slot));
        this._wasmAssetLogicalReplayEpochs.delete(slot);
        normalized.operationRevision = this._nextWasmAssetOperationRevision(slot);
        this._wasmAssets.set(slot, normalized);
        this._wasmAssetStates.set(slot, 1);
        this._wasmAssetStateRevisions.set(slot, normalized.operationRevision);
        this._notifyWasmAssetChange();
        const request = {
            type: 'set',
            operationRevision: normalized.operationRevision,
            descriptor: normalized
        };
        for (const workletNode of this._resolveWasmAssetTargetWorklets()) {
            this._queueWasmAssetDelivery(workletNode, slot, request);
        }
        this._refreshWasmAssetRevisionDescriptors(slot);
        return normalized.operationRevision;
    }

    _postWasmAsset(workletNode, slot, descriptor, replayEpoch = null) {
        if (!workletNode?.port || !Number.isInteger(this.id)) return false;
        const payload = descriptor.payload.slice(0);
        replayEpoch = this._normalizeWasmAssetReplayEpoch(replayEpoch);
        this._observeWasmAssetOperation(
            workletNode,
            slot,
            descriptor.operationRevision,
            1,
            replayEpoch
        );
        workletNode.port.postMessage({
            type: 'setPluginAsset',
            pluginId: this.id,
            slot,
            formatTag: descriptor.formatTag,
            headBlock: descriptor.headBlock,
            rateDivider: descriptor.rateDivider,
            pathCount: descriptor.pathCount,
            inputCount: descriptor.inputCount,
            processingChannels: descriptor.processingChannels,
            footprintBytes: descriptor.footprintBytes,
            operationRevision: descriptor.operationRevision,
            ...(replayEpoch !== null && { replayEpoch }),
            payload
        }, [payload]);
        return true;
    }

    replayWasmAssetsTo(workletNode, { trackState = false, assets = null } = {}) {
        if (!workletNode?.port || !Number.isInteger(this.id)) return [];
        if (trackState && workletNode === window.workletNode) {
            this._setupMessageHandler();
        }
        const replayedSlots = [];
        const descriptors = assets instanceof Map ? assets : this._wasmAssets;
        for (const [slot, descriptor] of descriptors) {
            const replayEpoch = this._nextWasmAssetReplayEpoch(workletNode);
            if (trackState) {
                const deliveries = this._wasmAssetDeliveries.get(workletNode);
                deliveries?.delete(slot);
                if (deliveries && !deliveries.size) this._wasmAssetDeliveries.delete(workletNode);
                this._wasmAssetAcknowledgedDescriptors.delete(slot);
                this._wasmAssetAcknowledgedReplayEpochs.delete(slot);
                this._wasmAssetLogicalReplayEpochs.set(slot, replayEpoch);
                this._wasmAssetPendingPredecessors.set(slot, {
                    candidateRevision: descriptor.operationRevision
                });
                this._rememberWasmAssetRevisionDescriptor(slot, descriptor);
                this._wasmAssetStates.set(slot, 1);
                this._wasmAssetStateRevisions.set(slot, descriptor.operationRevision);
                this.onWasmAssetState(slot, 1, descriptor.operationRevision);
            }
            const request = {
                type: 'set',
                operationRevision: descriptor.operationRevision,
                replayEpoch,
                descriptor,
                trackState
            };
            const posted = trackState
                ? this._startWasmAssetDelivery(workletNode, slot, request)
                : this._queueWasmAssetDelivery(workletNode, slot, request);
            if (posted) {
                replayedSlots.push(slot);
            }
        }
        return replayedSlots;
    }

    clearWasmAsset(slot) {
        if (!Number.isInteger(slot) || slot < 0) {
            throw new TypeError('A WASM asset requires a non-negative slot');
        }
        this._clearWasmAssetResidentDescriptor(slot);
        this._wasmAssetLogicalReplayEpochs.delete(slot);
        const operationRevision = this._nextWasmAssetOperationRevision(slot);
        const removed = this._wasmAssets.delete(slot);
        this._wasmAssetStates.delete(slot);
        this._wasmAssetStateRevisions.delete(slot);
        if (removed) this._notifyWasmAssetChange();
        const request = {
            type: 'clear',
            operationRevision
        };
        let targetCount = 0;
        for (const workletNode of this._resolveWasmAssetTargetWorklets()) {
            if (this._queueWasmAssetDelivery(workletNode, slot, request)) targetCount++;
        }
        this._refreshWasmAssetRevisionDescriptors(slot);
        return targetCount;
    }

    getWasmAssets() {
        return new Map(this._wasmAssets);
    }

    getWasmAssetRevision() {
        return this._wasmAssetRevision;
    }

    addWasmAssetChangeListener(listener) {
        if (typeof listener !== 'function') return () => {};
        this._wasmAssetChangeListeners.add(listener);
        return () => this._wasmAssetChangeListeners.delete(listener);
    }

    addWasmAssetSnapshotChangeListener(listener) {
        if (typeof listener !== 'function') return () => {};
        this._wasmAssetSnapshotChangeListeners.add(listener);
        return () => this._wasmAssetSnapshotChangeListeners.delete(listener);
    }

    setWasmAssetTargetResolver(resolver) {
        if (typeof resolver !== 'function') {
            const slots = new Set();
            for (const deliveries of this._wasmAssetDeliveries.values()) {
                for (const slot of deliveries.keys()) slots.add(slot);
            }
            this._wasmAssetDeliveries.clear();
            this._wasmAssetPendingPredecessors.clear();
            for (const slot of slots) this._refreshWasmAssetRevisionDescriptors(slot);
        }
        this._wasmAssetTargetResolver = typeof resolver === 'function' ? resolver : null;
    }

    dropWasmAssetTarget(workletNode) {
        const deliveries = this._wasmAssetDeliveries.get(workletNode);
        if (!deliveries) return false;
        this._wasmAssetDeliveries.delete(workletNode);
        if (workletNode === this._messageHandlerWorkletNode || workletNode === window.workletNode) {
            this._wasmAssetPendingPredecessors.clear();
            this._wasmAssetAcknowledgedDescriptors.clear();
            this._wasmAssetAcknowledgedReplayEpochs.clear();
            this._wasmAssetLogicalReplayEpochs.clear();
        }
        for (const slot of deliveries.keys()) this._refreshWasmAssetRevisionDescriptors(slot);
        return true;
    }

    setWasmAssetOperationObserver(observer) {
        this._wasmAssetOperationObserver = typeof observer === 'function' ? observer : null;
    }

    _observeWasmAssetOperation(workletNode, slot, operationRevision, state, replayEpoch = null) {
        try {
            this._wasmAssetOperationObserver?.(
                workletNode,
                slot,
                operationRevision,
                state,
                this._normalizeWasmAssetReplayEpoch(replayEpoch)
            );
        } catch (error) {
            console.warn(`[${this.name}] WASM asset operation observer failed:`, error);
        }
    }

    _resolveWasmAssetTargetWorklets() {
        if (this._wasmAssetTargetResolver) {
            const resolved = this._wasmAssetTargetResolver(this);
            return Array.isArray(resolved) ? [...new Set(resolved.filter(node => node?.port))] : [];
        }
        return window.workletNode?.port ? [window.workletNode] : [];
    }

    _notifyWasmAssetChange() {
        this._wasmAssetRevision++;
        for (const listener of [...this._wasmAssetChangeListeners]) {
            try {
                listener(this._wasmAssetRevision);
            } catch (error) {
                console.warn(`[${this.name}] WASM asset change listener failed:`, error);
            }
        }
        this._notifyWasmAssetSnapshotChange();
    }

    _notifyWasmAssetSnapshotChange() {
        for (const listener of [...this._wasmAssetSnapshotChangeListeners]) {
            try {
                listener();
            } catch (error) {
                console.warn(`[${this.name}] WASM asset snapshot listener failed:`, error);
            }
        }
    }

    // Default process function (can be overridden by subclasses)
    process(context, data, parameters, time) {
        return data;
    }

    // Compile the processor function using the stored processor string.
    // The 'with' statement is maintained to preserve functionality.
    _compileProcessor(processorStr) {
        try {
            return new Function('context', 'data', 'parameters', 'time', `
                with (context) {
                    const result = (function() {
                        ${processorStr}
                    })();
                    return result;
                }
            `);
        } catch (error) {
            console.error('Failed to compile processor:', {
                type: this.constructor.name,
                error: error.message
            });
            return null;
        }
    }

    // Register the processor function with the audio worklet and store it for offline processing.
    registerProcessor(processorFunction) {
        this.processorString = processorFunction.toString();
        this.compiledFunction = this._compileProcessor(this.processorString);

        if (window.workletNode) {
            this._setupMessageHandler();
            window.workletNode.port.postMessage({
                type: 'registerProcessor',
                pluginType: this.constructor.name,
                processor: this.processorString,
                process: this.process.toString()
            });
        }
    }

    // Execute the compiled processor function for offline processing.
    executeProcessor(context, data, parameters, time) {
        if (!this.compiledFunction) {
            console.warn('No compiled function available for plugin:', this.name);
            return data;
        }
        try {
            return this.compiledFunction.call(null, context, data, parameters, time);
        } catch (error) {
            console.error('Failed to execute processor:', {
                type: this.constructor.name,
                error: error.message
            });
            return data;
        }
    }

    // Update plugin parameters via the worklet.
    updateParameters() {
        const previousChannel = this._lastUpdatedChannel;
        this._lastUpdatedChannel = this.channel;
        if (previousChannel !== this.channel && typeof this.onChannelSelectionChanged === 'function') {
            this.onChannelSelectionChanged(previousChannel, this.channel);
        }
        this._notifyWasmAssetSnapshotChange();
        if (window.workletNode) {
            const parameters = this.getParameters();
            
            window.workletNode.port.postMessage({
                type: 'updatePlugin',
                plugin: this.getWorkletPluginData(parameters)
            });
            if (window.uiManager) {
                window.uiManager.updateURL();
            }
        }
    }

    // Build the control-rate payload shared by direct, bulk, and DBT worklet updates.
    getWorkletPluginData(parameters = this.getParameters()) {
        const type = this.constructor.name;
        const payload = {
            id: this.id,
            type,
            enabled: this.enabled,
            parameters,
            inputBus: this.inputBus,
            outputBus: this.outputBus,
            channel: this.channel
        };
        const packer = window.dspParamPackers?.get(type);
        if (!packer) return payload;

        try {
            const wasmParams = packer.pack(parameters);
            if (!(wasmParams instanceof Float32Array)) {
                throw new TypeError('parameter packer did not return Float32Array');
            }
            let wasmParamBytes = null;
            if (typeof packer.packBytes === 'function') {
                wasmParamBytes = packer.packBytes(parameters);
                if (!(wasmParamBytes instanceof Uint8Array) ||
                    wasmParamBytes.byteLength > packer.byteCapacity) {
                    throw new TypeError('structured parameter packer returned an invalid byte block');
                }
            }
            payload.wasmParams = wasmParams;
            payload.wasmParamsHash = packer.hash >>> 0;
            if (wasmParamBytes) payload.wasmParamBytes = wasmParamBytes;
            this._dspPackingFailed = false;
        } catch (error) {
            if (!this._dspPackingFailed) {
                console.warn(`[dsp-wasm] Parameter packing failed for ${type}; using the JS path.`, error);
                this._dspPackingFailed = true;
            }
        }
        return payload;
    }

    // Get current parameters; can be overridden by subclasses.
    getParameters() {
        return {
            type: this.constructor.name,
            id: this.id,
            enabled: this.enabled,
            ...(this.inputBus !== null && { inputBus: this.inputBus }),
            ...(this.outputBus !== null && { outputBus: this.outputBus }),
            ...(this.channel !== null && { channel: this.channel })
        };
    }

    // Return serializable parameters for URL state using a deep copy.
    getSerializableParameters() {
        const params = this.getParameters();
        const serializedParams = JSON.parse(JSON.stringify(params));
        // Remove internal properties that should not be serialized
        const { type, id, inputBus, outputBus, channel, ...cleanParams } = serializedParams;
        
        // Add input and output bus with short names if they exist
        if (inputBus !== undefined) {
            cleanParams.ib = inputBus;
        }
        if (outputBus !== undefined) {
            cleanParams.ob = outputBus;
        }
        // Add channel with short name if it exists and is not default (Stereo which is null)
        if (channel !== null && channel !== undefined) {
            cleanParams.ch = channel;
        }
        
        return cleanParams;
    }

    get externalAssetInfo() {
        return null;
    }

    // Set parameters from a serialized state.
    setSerializedParameters(params) {
        const { nm, en, id, ib, ob, ch, ...pluginParams } = params;
        const parameters = {
            type: this.constructor.name,
            enabled: en,
            ...(id !== undefined && { id }),
            ...(ib !== undefined && { inputBus: ib }),
            ...(ob !== undefined && { outputBus: ob }),
            ...(ch !== undefined && { channel: ch }),
            ...pluginParams
        };
        this.setParameters(parameters);
    }

    // Set parameters (must be implemented by subclasses).
    setParameters(params) {
        try {
            this._validateParameters(params);
            this._setValidatedParameters(params);
        } catch (error) {
            this._handleError('Parameter Error', error.message);
        }
    }

    // Validate parameters (can be overridden by subclasses).
    _validateParameters(params) {
        if (params === null || typeof params !== 'object') {
            throw new Error('Parameters must be an object');
        }
    }

    parseFiniteNumber(value, min, max, previous) {
        let numericValue;
        if (typeof value === 'number') {
            numericValue = value;
        } else if (typeof value === 'string') {
            const trimmedValue = value.trim();
            if (trimmedValue === '') {
                return Number.isFinite(previous) ? previous : min;
            }
            numericValue = Number(trimmedValue);
        } else {
            return Number.isFinite(previous) ? previous : min;
        }

        if (!Number.isFinite(numericValue)) {
            return Number.isFinite(previous) ? previous : min;
        }
        if (numericValue < min) return min;
        if (numericValue > max) return max;
        return numericValue;
    }

    isAllowedEnum(value, allowed, previous) {
        return allowed.includes(value) ? value : previous;
    }

    // Apply validated parameters (must be implemented by subclasses).
    _setValidatedParameters(params) {
        // Set common parameters
        if (params.enabled !== undefined) {
            this.enabled = Boolean(params.enabled);
        }
        
        // Set bus parameters
        if (params.inputBus !== undefined) {
            this.inputBus = params.inputBus;
        }
        if (params.outputBus !== undefined) {
            this.outputBus = params.outputBus;
        }
        if (params.channel !== undefined) {
            this.channel = params.channel;
        }
        
        // Subclasses must override this method to handle their specific parameters
        // but should call super._setValidatedParameters(params) to handle common parameters
    }

    // Handle errors by storing error state and updating the error UI.
    _handleError(type, message) {
        this.errorState = {
            type: type,
            message: message,
            timestamp: Date.now()
        };
        this._updateErrorUI();
        console.error(`[${this.name}] ${type}: ${message}`);
    }

    // Update the error UI display.
    _updateErrorUI() {
        const container = document.getElementById(`plugin-${this.id}`);
        if (!container) return;

        const existingError = container.querySelector('.plugin-error');
        if (existingError) {
            existingError.remove();
        }
        if (this.errorState) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'plugin-error';
            errorDiv.innerHTML = `
                <div class="error-header">${this.errorState.type}</div>
                <div class="error-message">${this.errorState.message}</div>
                <div class="error-timestamp">${new Date(this.errorState.timestamp).toLocaleTimeString()}</div>
            `;
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                    this.errorState = null;
                }
            }, 5000);
            container.appendChild(errorDiv);
        }
    }

    // Helper function to create slider/number input parameter controls
    createParameterControl(label, min, max, step, value, setter, unit = '') {
        const row = document.createElement('div');
        row.className = 'parameter-row';

        const paramName = label.toLowerCase().replace(/\s+/g, '-');
        const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
        const valueId = `${this.id}-${this.name}-${paramName}-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}${unit ? ' (' + unit + ')' : ''}:`;
        labelEl.htmlFor = sliderId;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.autocomplete = "off";

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.id = valueId;
        valueInput.name = valueId;
        valueInput.min = min;
        valueInput.max = max;
        valueInput.step = step;
        valueInput.value = value;
        valueInput.autocomplete = "off";

        slider.addEventListener('input', (e) => {
            // Use setter directly, assuming it handles parseFloat if needed
            setter(parseFloat(e.target.value));
            valueInput.value = e.target.value; // Keep number input synced
        });

        valueInput.addEventListener('input', (e) => {
            // Allow typing slightly outside bounds temporarily before clamping on blur/enter
            // Use setter immediately, assuming it handles parseFloat if needed
            const val = parseFloat(e.target.value) || 0; // Use 0 as fallback for invalid input
            setter(val); // Update internal value immediately
            // Update slider thumb, clamping it within bounds
            slider.value = Math.max(min, Math.min(max, val));
        });

        // Clamp value on blur or Enter key press for the number input
         const clampAndUpdate = (e) => {
            const val = parseFloat(e.target.value) || 0; // Use 0 as fallback
            const clampedVal = Math.max(min, Math.min(max, val));
            // Only update if the value was actually clamped
            if (clampedVal !== val) {
                setter(clampedVal); // Ensure internal state matches clamped value
                e.target.value = clampedVal; // Update display
                slider.value = clampedVal;   // Update slider thumb
            } else if (isNaN(val)) { // Handle NaN case explicitly
                 setter(min); // Or some default fallback like min
                 e.target.value = min;
                 slider.value = min;
            }
         };
         valueInput.addEventListener('blur', clampAndUpdate);
         valueInput.addEventListener('keydown', (e) => {
             if (e.key === 'Enter') {
                 clampAndUpdate(e);
                 e.preventDefault(); // Prevent form submission if inside a form
             }
         });


        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueInput);

        return row;
    }

    // Helper function to create logarithmic slider/number input parameter controls
    // The slider displays logarithmically but the actual value remains linear
    createLogarithmicParameterControl(label, min, max, step, value, setter, unit = '') {
        const row = document.createElement('div');
        row.className = 'parameter-row';

        const paramName = label.toLowerCase().replace(/\s+/g, '-');
        const sliderId = `${this.id}-${this.name}-${paramName}-slider`;
        const valueId = `${this.id}-${this.name}-${paramName}-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}${unit ? ' (' + unit + ')' : ''}:`;
        labelEl.htmlFor = sliderId;

        // Logarithmic conversion functions
        const logMin = Math.log10(min);
        const logMax = Math.log10(max);
        const logRange = logMax - logMin;

        // Convert linear value to logarithmic slider position (0-100)
        const linearToLogSlider = (linearValue) => {
            const logValue = Math.log10(linearValue);
            return ((logValue - logMin) / logRange) * 100;
        };

        // Convert logarithmic slider position (0-100) to linear value
        const logSliderToLinear = (sliderPos) => {
            const logValue = logMin + (sliderPos / 100) * logRange;
            return Math.pow(10, logValue);
        };

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = 0;
        slider.max = 100;
        slider.step = 0.1;
        slider.value = linearToLogSlider(value);
        slider.autocomplete = "off";

        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.id = valueId;
        valueInput.name = valueId;
        valueInput.min = min;
        valueInput.max = max;
        valueInput.step = step;
        valueInput.value = value.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
        valueInput.autocomplete = "off";

        slider.addEventListener('input', (e) => {
            const linearValue = logSliderToLinear(parseFloat(e.target.value));
            setter(linearValue);
            valueInput.value = linearValue.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
        });

        valueInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || min;
            const clampedVal = Math.max(min, Math.min(max, val));
            setter(clampedVal);
            e.target.value = clampedVal.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
            slider.value = linearToLogSlider(clampedVal);
        });

        // Clamp value on blur or Enter key press for the number input
        const clampAndUpdate = (e) => {
            const val = parseFloat(e.target.value) || min;
            const clampedVal = Math.max(min, Math.min(max, val));
            if (clampedVal !== val) {
                setter(clampedVal);
                e.target.value = clampedVal.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
                slider.value = linearToLogSlider(clampedVal);
            } else if (isNaN(val)) {
                setter(min);
                e.target.value = min.toFixed(step < 0.1 ? 2 : (step < 1 ? 1 : 0));
                slider.value = linearToLogSlider(min);
            }
        };
        valueInput.addEventListener('blur', clampAndUpdate);
        valueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clampAndUpdate(e);
                e.preventDefault();
            }
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueInput);

        return row;
    }

    createSelectControl(label, options, value, setter) {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const selectId = `${this.id}-${this.name}-${paramName}-select`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        labelEl.htmlFor = selectId;

        const select = document.createElement('select');
        select.id = selectId;
        select.name = selectId;
        select.autocomplete = 'off';

        options.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = typeof option === 'string' ? option : option.value;
            optionEl.textContent = typeof option === 'string' ? option : option.label;
            select.appendChild(optionEl);
        });
        select.value = value;
        select.addEventListener('change', event => setter(event.target.value));

        row.appendChild(labelEl);
        row.appendChild(select);
        return row;
    }

    createCheckboxControl(label, checked, setter) {
        const row = document.createElement('div');
        row.className = 'parameter-row checkbox-row';
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const checkboxId = `${this.id}-${this.name}-${paramName}-checkbox`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        labelEl.htmlFor = checkboxId;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = checkboxId;
        checkbox.name = checkboxId;
        checkbox.checked = !!checked;
        checkbox.autocomplete = 'off';
        checkbox.addEventListener('change', event => setter(event.target.checked));

        row.appendChild(labelEl);
        row.appendChild(checkbox);
        return row;
    }

    createRadioGroup(label, options, value, setter) {
        const row = document.createElement('div');
        row.className = 'parameter-row radio-group';
        const paramName = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const groupName = `${this.id}-${this.name}-${paramName}`;

        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}:`;
        row.appendChild(labelEl);

        options.forEach((option, index) => {
            const optionValue = typeof option === 'string' ? option : option.value;
            const optionLabel = typeof option === 'string' ? option : option.label;
            const radioId = `${groupName}-${index}`;

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = radioId;
            radio.name = groupName;
            radio.value = optionValue;
            radio.checked = optionValue === value;
            radio.autocomplete = 'off';
            radio.addEventListener('change', event => {
                if (event.target.checked) setter(event.target.value);
            });

            const radioLabel = document.createElement('label');
            radioLabel.htmlFor = radioId;
            radioLabel.textContent = optionLabel;

            row.appendChild(radio);
            row.appendChild(radioLabel);
        });

        return row;
    }

    createGraphContainer({ maxWidth = 1024, canvasWidth, canvasHeight, className } = {}) {
        const container = document.createElement('div');
        container.className = className ? `graph-container ${className}` : 'graph-container';
        container.style.width = '100%';
        container.style.maxWidth = `${maxWidth}px`;
        container.style.position = 'relative';

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
        container.appendChild(canvas);

        return { container, canvas };
    }

    createResponsiveGraph({ maxWidth = 1024, aspectRatio = '2.5 / 1', mobileAspectRatio = null, className, onResize } = {}) {
        const container = document.createElement('div');
        container.className = className
            ? `graph-container responsive-graph-container ${className}`
            : 'graph-container responsive-graph-container';
        container.style.width = '100%';
        container.style.maxWidth = `${maxWidth}px`;
        container.style.position = 'relative';
        container.style.aspectRatio = aspectRatio;
        if (mobileAspectRatio) {
            if (typeof container.style.setProperty === 'function') {
                container.style.setProperty('--mobile-aspect-ratio', mobileAspectRatio);
            } else {
                container.style['--mobile-aspect-ratio'] = mobileAspectRatio;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        container.appendChild(canvas);

        let disposed = false;
        let observer = null;
        let windowResizeHandler = null;

        const resize = () => {
            if (disposed) return;
            const rect = container.getBoundingClientRect();
            const cssWidth = rect.width || container.clientWidth || 0;
            const cssHeight = rect.height || container.clientHeight || 0;
            if (!cssWidth || !cssHeight) return;

            const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
            const width = Math.max(1, Math.round(cssWidth * dpr));
            const height = Math.max(1, Math.round(cssHeight * dpr));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;

            onResize?.({ canvas, cssWidth, cssHeight, dpr });
        };

        const ResizeObserverClass = typeof ResizeObserver !== 'undefined'
            ? ResizeObserver
            : (typeof window !== 'undefined' ? window.ResizeObserver : null);
        if (typeof ResizeObserverClass === 'function') {
            observer = new ResizeObserverClass(resize);
            observer.observe(container);
        } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            windowResizeHandler = resize;
            window.addEventListener('resize', windowResizeHandler);
        }

        const scheduleInitialResize = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : null);
        if (scheduleInitialResize) {
            scheduleInitialResize(resize);
        } else {
            setTimeout(resize, 0);
        }

        const dispose = () => {
            if (disposed) return;
            disposed = true;
            this._responsiveGraphDisposers?.delete(dispose);
            observer?.disconnect();
            observer = null;
            if (windowResizeHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('resize', windowResizeHandler);
            }
            windowResizeHandler = null;
        };

        this._responsiveGraphDisposers?.add(dispose);
        return { container, canvas, resize, dispose };
    }

    getGraphCoords(canvas, ev) {
        const rect = canvas.getBoundingClientRect();
        const touch = ev.touches?.[0] || ev.changedTouches?.[0];
        const clientX = ev.clientX ?? touch?.clientX ?? rect.left;
        const clientY = ev.clientY ?? touch?.clientY ?? rect.top;
        const rectWidth = rect.width || canvas.width || 1;
        const rectHeight = rect.height || canvas.height || 1;
        return {
            x: (clientX - rect.left) * (canvas.width / rectWidth),
            y: (clientY - rect.top) * (canvas.height / rectHeight)
        };
    }

    bindGraphPointer(element, { onDragStart, onDragMove, onDragEnd, onTap } = {}) {
        let activePointerId = null;
        let startX = 0;
        let startY = 0;
        let startEvent = null;
        let dragging = false;
        const tapThreshold = 8;
        element.style.touchAction = 'none';

        const onPointerDown = event => {
            if (activePointerId !== null || event.isPrimary === false) return;
            activePointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            startEvent = event;
            dragging = false;
            element.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        };

        const onPointerMove = event => {
            if (activePointerId !== event.pointerId) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (!dragging && distance >= tapThreshold) {
                dragging = true;
                onDragStart?.(startEvent || event);
            }
            if (dragging) {
                onDragMove?.(event);
                event.preventDefault();
            }
        };

        const finishPointer = event => {
            if (activePointerId !== event.pointerId) return;
            element.releasePointerCapture?.(event.pointerId);
            if (dragging) {
                onDragEnd?.(event);
            } else {
                onTap?.(event);
            }
            activePointerId = null;
            startEvent = null;
            dragging = false;
            event.preventDefault();
        };

        const cancelPointer = event => {
            if (activePointerId !== event.pointerId) return;
            element.releasePointerCapture?.(event.pointerId);
            if (dragging) {
                onDragEnd?.(event);
            }
            activePointerId = null;
            startEvent = null;
            dragging = false;
            event.preventDefault();
        };

        element.addEventListener('pointerdown', onPointerDown);
        element.addEventListener('pointermove', onPointerMove);
        element.addEventListener('pointerup', finishPointer);
        element.addEventListener('pointercancel', cancelPointer);

        return () => {
            element.removeEventListener('pointerdown', onPointerDown);
            element.removeEventListener('pointermove', onPointerMove);
            element.removeEventListener('pointerup', finishPointer);
            element.removeEventListener('pointercancel', cancelPointer);
        };
    }

    // Intelligently place the freq/gain text labels attached to graph markers
    // (e.g. the PEQ family) so they do not collide with each other, do not sit
    // on top of other markers, and never spill outside the graph box.
    //
    // Each label element is expected to be absolutely positioned inside its
    // marker (the marker being its offsetParent). We try a set of candidate
    // offsets around the marker in a preference order, score each by how much
    // it overlaps already-placed labels / other markers and how far it had to
    // be clamped to stay inside the box, then commit the best one.
    //
    // @param {Object} opts
    // @param {Array}  opts.items  - [{ el, cx, cy }] label element + marker centre (px, container-local)
    // @param {number} opts.width  - graph container width (px)
    // @param {number} opts.height - graph container height (px)
    // @param {string} [opts.axis='horizontal'] - preferred side: 'horizontal' (left/right) or 'vertical' (top/bottom)
    // @param {number} [opts.radius=14] - marker radius (px), border box
    // @param {number} [opts.gap=6]     - gap between marker edge and label (px)
    layoutMarkerLabels({ items, width, height, axis = 'horizontal', radius = 14, gap = 6 } = {}) {
        if (!items || !items.length || !width || !height) return;

        // Pass 1: batch-read every label's rendered size (avoids layout thrash).
        const labels = items.map(it => {
            const el = it.el;
            return { el, cx: it.cx, cy: it.cy, w: el ? el.offsetWidth : 0, h: el ? el.offsetHeight : 0 };
        });
        const markers = labels.map(l => ({ cx: l.cx, cy: l.cy, r: radius }));

        const overlap = (a, b) => {
            const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
            const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
            return ox * oy;
        };

        const placed = [];
        // Pass 2: place and write inline styles for every label.
        for (let i = 0; i < labels.length; i++) {
            const { el, cx, cy, w, h } = labels[i];
            if (!el || !w || !h) continue;

            const d = radius + gap;          // straight offset (E/W/N/S)
            const dd = radius * 0.7 + gap;    // diagonal offset (corners)
            const dirs = {
                E:  { x: cx + d,      y: cy - h / 2 },
                W:  { x: cx - d - w,  y: cy - h / 2 },
                N:  { x: cx - w / 2,  y: cy - d - h },
                S:  { x: cx - w / 2,  y: cy + d },
                NE: { x: cx + dd,     y: cy - dd - h },
                NW: { x: cx - dd - w, y: cy - dd - h },
                SE: { x: cx + dd,     y: cy + dd },
                SW: { x: cx - dd - w, y: cy + dd }
            };
            // Prefer pushing the label toward the OUTSIDE of the graph (away
            // from the centre) so labels fan out to the edges instead of
            // bunching up in the middle. H/V are the outward directions for
            // this marker; Hi/Vi the inward fallbacks. Straight up/down (N/S)
            // and straight left/right (E/W) are always candidates.
            const H = cx < width / 2 ? 'W' : 'E';
            const Hi = H === 'W' ? 'E' : 'W';
            const V = cy < height / 2 ? 'N' : 'S';
            const Vi = V === 'N' ? 'S' : 'N';
            const diag = (v, h) => v + h; // 'N'/'S' + 'W'/'E' -> NE/NW/SE/SW
            let order;
            if (axis === 'vertical') {
                // Straight out along the vertical axis first, then fan sideways.
                order = [V, diag(V, H), H, diag(V, Hi), Hi, diag(Vi, H), Vi, diag(Vi, Hi)];
            } else {
                // Straight out along the horizontal axis first, then fan up/down.
                order = [H, diag(V, H), V, diag(Vi, H), Vi, diag(V, Hi), Hi, diag(Vi, Hi)];
            }

            let best = null;
            let bestScore = Infinity;
            for (let k = 0; k < order.length; k++) {
                const cand = dirs[order[k]];
                const bx = Math.max(0, Math.min(cand.x, width - w));
                const by = Math.max(0, Math.min(cand.y, height - h));
                const moved = Math.abs(bx - cand.x) + Math.abs(by - cand.y);
                const box = { x: bx, y: by, w, h };
                // Keep the label as close to its marker as possible: distance
                // from marker centre to label centre is the main cost, so a
                // straight N/S/E/W spot (nearer) always beats a diagonal one
                // (farther) when both are collision-free. The outward-order
                // rank (k) is only a gentle tie-breaker between similar spots,
                // never enough to override a genuinely closer placement.
                const dx = (bx + w / 2) - cx;
                const dy = (by + h / 2) - cy;
                let score = Math.sqrt(dx * dx + dy * dy) + moved + k * 1.5;
                // Penalise overlap with EVERY marker, including this label's own
                // marker: near the top/bottom edge a straight up/down candidate
                // gets clamped back inside and would otherwise land on top of its
                // marker. Counting self-overlap pushes it out to the side (E/W)
                // or the opposite (down/up) side instead.
                for (let m = 0; m < markers.length; m++) {
                    const mk = markers[m];
                    score += overlap(box, { x: mk.cx - mk.r, y: mk.cy - mk.r, w: mk.r * 2, h: mk.r * 2 }) * 4;
                }
                for (let p = 0; p < placed.length; p++) {
                    score += overlap(box, placed[p]) * 5;
                }
                if (score < bestScore) { bestScore = score; best = box; }
            }
            if (!best) continue;
            placed.push(best);

            // Convert container-local box top-left into marker-relative offsets.
            // The label's offsetParent is the marker; its containing block origin
            // sits half a marker-width in from the marker centre.
            const parent = el.offsetParent;
            const halfW = parent ? parent.clientWidth / 2 : 12;
            const halfH = parent ? parent.clientHeight / 2 : 12;
            el.style.left = `${best.x - (cx - halfW)}px`;
            el.style.top = `${best.y - (cy - halfH)}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.transform = 'none';
            el.style.textAlign = 'center';
        }
    }

    // Create UI elements for the plugin (must be implemented by subclasses).
    createUI() {
        // Default implementation returns an empty container
        return document.createElement('div');
    }

    // Cleanup resources (should be overridden by subclasses).
    cleanup() {
        this._disposeResponsiveGraphs();
        const clearSlots = new Set(this._wasmAssets.keys());
        for (const deliveries of this._wasmAssetDeliveries.values()) {
            for (const slot of deliveries.keys()) clearSlots.add(slot);
        }
        this._wasmAssetDeliveries.clear();
        this._wasmAssetPendingPredecessors.clear();
        this._wasmAssetAcknowledgedDescriptors.clear();
        this._wasmAssetAcknowledgedReplayEpochs.clear();
        this._wasmAssetLogicalReplayEpochs.clear();
        for (const slot of clearSlots) this.clearWasmAsset(slot);
        this._wasmAssetStates.clear();
        this._wasmAssetStateRevisions.clear();

        if (this._messageHandlerObserver) {
            this._messageHandlerObserver.disconnect();
            this._messageHandlerObserver = null;
        }

        if (this._messageHandlerWorkletNode?.port && this._hasMessageHandler) {
            try {
                this._messageHandlerWorkletNode.port.removeEventListener('message', this._boundHandleMessage);
            } catch (error) {
                // Ignore stale port cleanup failures.
            }
        }
        this._messageHandlerWorkletNode = null;
        this._hasMessageHandler = false;
        this._wasmAssetChangeListeners.clear();
        this._wasmAssetSnapshotChangeListeners.clear();
        this._wasmAssetDeliveries.clear();
        this._wasmAssetAcknowledgedDescriptors.clear();
        this._wasmAssetAcknowledgedReplayEpochs.clear();
        this._wasmAssetLogicalReplayEpochs.clear();
        this._wasmAssetPendingPredecessors.clear();
        this._wasmAssetRevisionDescriptors.clear();
        this._wasmAssetResidentDescriptors.clear();
        this._wasmAssetOperationCounters.clear();
        this._wasmAssetOperationRevisions.clear();
        this._wasmAssetTargetResolver = null;
        this._wasmAssetOperationObserver = null;

        if (this._pendingTimeoutId !== null) {
            clearTimeout(this._pendingTimeoutId);
            this._pendingTimeoutId = null;
        }
        this.pendingUpdate = null;
    }

    // Enable or disable the plugin.
    //
    // When a plugin exposes startAnimation()/stopAnimation() (used by
    // analyzer-style plugins to drive a per-frame canvas redraw), pause that
    // loop while the plugin is effectively disabled (either by its own ON
    // button or by its enclosing Section being OFF). Previously the redraw
    // loop kept running at the display refresh rate even when disabled,
    // which wasted main-thread CPU on low-power hardware.
    setEnabled(enabled) {
        if (this.enabled !== enabled) {
            this.enabled = enabled;
            this.updateParameters();
            this._refreshAnimationState();
        }
    }

    // Called from the pipeline UI when the enclosing Section is toggled.
    // Stops the redraw loop while the section is OFF and starts it again
    // when the section comes back ON (provided the plugin itself is also
    // enabled).
    _setSectionEnabled(sectionEnabled) {
        sectionEnabled = sectionEnabled !== false;
        if (this._sectionEnabled !== sectionEnabled) {
            this._sectionEnabled = sectionEnabled;
            this._refreshAnimationState();
        }
    }

    // Start or stop the redraw loop to match the current effective-enabled
    // state. Plugins that do not expose startAnimation/stopAnimation are
    // unaffected.
    _refreshAnimationState() {
        if (typeof this.startAnimation !== 'function' ||
            typeof this.stopAnimation !== 'function') {
            return;
        }
        if (this.canRunAnimation()) {
            this.startAnimation();
        } else {
            this.stopAnimation();
        }
    }

    canRunAnimation() {
        return this.enabled !== false && this._sectionEnabled !== false && this._powerUiEnabled !== false;
    }

    requestPowerAnimationFrame(callback, counterKind = 'plugin') {
        if (!this.canRunAnimation() || typeof requestAnimationFrame !== 'function') return null;
        return requestAnimationFrame(timestamp => {
            if (!this.canRunAnimation()) {
                this.animationFrameId = null;
                return;
            }
            const audioManager = typeof window !== 'undefined' ? window.audioManager : null;
            audioManager?.incrementPowerDiagnostic?.('pluginVisualRafCallbacks');
            if (counterKind === 'analyzer') {
                audioManager?.incrementPowerDiagnostic?.('analyzerRafCallbacks');
            }
            callback(timestamp);
        });
    }

    renderPowerUiOnce(callback) {
        if (typeof callback !== 'function' || this.enabled === false ||
            this._sectionEnabled === false || this.canRunAnimation()) return false;
        callback();
        return true;
    }

    setPowerUiEnabled(enabled) {
        const next = enabled !== false;
        if (this._powerUiEnabled === next) return;
        this._powerUiEnabled = next;
        this._refreshAnimationState();
    }

    getTemporalCapability() {
        return this.temporalCapability;
    }

    getPowerGainUpperBoundDb() {
        return this.powerGainUpperBoundDb;
    }

    // Create channel select control for plugin UI
    createChannelSelectControl() {
        const row = document.createElement('div');
        row.className = 'parameter-row channel-select-row';
        
        const label = document.createElement('label');
        label.textContent = 'Channel:';
        
        const select = document.createElement('select');
        select.id = `${this.id}-channel-select`;
        
        // Get output channel count from audio context
        let outputChannelCount = 2;
        if (window.audioContext && window.audioContext.destination) {
            outputChannelCount = window.audioContext.destination.channelCount || 2;
        }
        
        // Add channel options
        const options = [
            { value: '', text: 'Stereo' }, // Default now renamed to 'Stereo' - processes first 2 channels only
            { value: 'A', text: 'All' },   // New option - process all available channels
            { value: 'L', text: 'Left' },  // Process left channel only
            { value: 'R', text: 'Right' }  // Process right channel only
        ];
        
        // Add channel pair options if output channel count is high enough
        if (outputChannelCount >= 4) {
            options.push({ value: '34', text: '3+4' });
        }
        if (outputChannelCount >= 6) {
            options.push({ value: '56', text: '5+6' });
        }
        if (outputChannelCount >= 8) {
            options.push({ value: '78', text: '7+8' });
        }
        
        // Add individual channel options based on output channel count
        for (let i = 3; i <= Math.min(outputChannelCount, 8); i++) {
            options.push({ value: String(i), text: `Ch ${i}` });
        }
        
        // Create option elements
        options.forEach(option => {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.text;
            if (this.channel === option.value) {
                optionEl.selected = true;
            }
            select.appendChild(optionEl);
        });
        
        // Add event listener
        select.addEventListener('change', (e) => {
            this.channel = e.target.value === '' ? null : e.target.value;
            this.updateParameters();
        });
        
        row.appendChild(label);
        row.appendChild(select);
        
        return row;
    }
}
