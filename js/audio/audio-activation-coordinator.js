const DEFAULT_FRESH_RENDER_TIMEOUT_MS = 1500;

function createActivationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isNonNegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function canonicalize(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Activation descriptors cannot contain non-finite numbers');
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    throw new TypeError('Activation descriptors must contain JSON values only');
}

function deepFreeze(value) {
    if (value && (typeof value === 'object' || Array.isArray(value)) && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function normalizeResourceKeys(resourceKeys) {
    if (!Array.isArray(resourceKeys)) return [];
    return [...new Set(resourceKeys.map(value => String(value)).filter(Boolean))].sort();
}

function normalizeIntentDescriptor(input) {
    if (!input || (input.intentKind !== 'config' && input.intentKind !== 'player')) {
        throw new TypeError('intentKind must be "config" or "player"');
    }
    if (!input.intentIdentity || typeof input.intentIdentity !== 'object') {
        throw new TypeError('intentIdentity is required');
    }
    const backend = input.intentKind === 'player' ? input.backend : 'none';
    if (!['buffer-source', 'html-media', 'none'].includes(backend)) {
        throw new TypeError('Unsupported activation backend');
    }
    return Object.freeze({
        descriptorVersion: 1,
        intentKind: input.intentKind,
        intentIdentity: structuredCloneJson(input.intentIdentity),
        resumeKind: input.intentKind === 'player'
            ? (input.resumeKind || 'player-only-play')
            : 'none',
        backend,
        requiredResourceKeys: normalizeResourceKeys(input.requiredResourceKeys),
        activationAffectingConfig: structuredCloneJson(input.activationAffectingConfig || {})
    });
}

function structuredCloneJson(value) {
    return JSON.parse(canonicalize(value));
}

function normalizeGraphSnapshot(snapshot, activeNodes) {
    const candidate = snapshot || {};
    const binding = {
        audioGraphGeneration: candidate.audioGraphGeneration,
        workletGraphGeneration: candidate.workletGraphGeneration,
        topologyRevision: candidate.topologyRevision,
        nodes: [...new Set((activeNodes || []).filter(Boolean))]
    };
    for (const key of ['audioGraphGeneration', 'workletGraphGeneration', 'topologyRevision']) {
        if (!isNonNegativeSafeInteger(binding[key])) {
            throw createActivationError(
                'activation-graph-identity-unavailable',
                `The current audio graph is missing ${key}.`
            );
        }
    }
    if (binding.nodes.length === 0) {
        throw createActivationError(
            'activation-worklet-unavailable',
            'No active AudioWorklet is available for a fresh-render proof.'
        );
    }
    return binding;
}

function sameNodeSet(left, right) {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(node => rightSet.has(node));
}

function sameGraphBinding(left, right) {
    return !!left && !!right &&
        left.audioGraphGeneration === right.audioGraphGeneration &&
        left.workletGraphGeneration === right.workletGraphGeneration &&
        left.topologyRevision === right.topologyRevision &&
        sameNodeSet(left.nodes, right.nodes);
}

/**
 * Session-local coordinator for audio mutations that must not become public
 * until the candidate is bound to the current graph and has rendered once.
 */
export class AudioActivationCoordinator {
    constructor(options = {}) {
        this.getGraphSnapshot = options.getGraphSnapshot;
        this.getActiveWorklets = options.getActiveWorklets;
        this.broadcast = options.broadcast;
        this.setTimeoutFn = options.setTimeoutFn || globalThis.setTimeout?.bind(globalThis);
        this.clearTimeoutFn = options.clearTimeoutFn || globalThis.clearTimeout?.bind(globalThis);
        this.freshRenderTimeoutMs = options.freshRenderTimeoutMs ?? DEFAULT_FRESH_RENDER_TIMEOUT_MS;
        this.stageGeneration = 0;
        this.observationSequence = 0;
        this.currentStage = null;
        this.activeStage = null;
        this.latestObservations = new Map();
        this.renderWaiters = new Map();
        this.queue = Promise.resolve();
    }

    isSupported() {
        return typeof this.getGraphSnapshot === 'function' &&
            typeof this.getActiveWorklets === 'function' &&
            typeof this.broadcast === 'function';
    }

    async stageIntent(input) {
        const generation = ++this.stageGeneration;
        const descriptor = normalizeIntentDescriptor(input);
        const stage = {
            generation,
            descriptor,
            activationIdentity: null,
            candidateIntentIdentity: null,
            baseGraph: this._captureGraphBinding({ allowUnavailable: true }),
            binding: null,
            state: 'staging',
            errorCode: null
        };
        this.currentStage = stage;
        this._cancelSupersededRenderWaiters(generation);

        try {
            // Canonical structural identities: deep-frozen JSON structures that
            // are directly comparable with a deep-equal check, replacing the
            // previous SHA-256 digests (which nothing ever compared).
            stage.activationIdentity = deepFreeze({
                resumeKind: descriptor.resumeKind,
                backend: descriptor.backend,
                requiredResourceKeys: [...descriptor.requiredResourceKeys],
                playerIntentGeneration: descriptor.intentKind === 'player'
                    ? descriptor.intentIdentity.playerIntentGeneration
                    : null,
                activationAffectingConfig: structuredCloneJson(descriptor.activationAffectingConfig)
            });
            stage.candidateIntentIdentity = deepFreeze(structuredCloneJson(descriptor));
            stage.state = this.currentStage === stage ? 'staged' : 'stale';
            return stage;
        } catch (error) {
            stage.state = 'failed';
            stage.errorCode = error?.code || 'activation-identity-failed';
            if (this.currentStage === stage) this.currentStage = null;
            throw error;
        }
    }

    activate(stage, callbacks = {}) {
        const run = () => this._activateNow(stage, callbacks);
        const result = this.queue.then(run, run);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    async _activateNow(stage, callbacks) {
        let candidate;
        try {
            this._assertCurrentStage(stage);
            candidate = typeof callbacks.acquire === 'function'
                ? await callbacks.acquire(stage)
                : null;
            this._assertCurrentStage(stage);
            if (callbacks.isCandidateCurrent?.(candidate, stage) === false) {
                throw createActivationError(
                    'activation-candidate-stale',
                    'The staged audio resource no longer matches its source.'
                );
            }

            const binding = this._captureGraphBinding();
            stage.binding = binding;
            stage.state = 'awaiting-fresh-render';
            const rendered = await this._waitForFreshFullRender(stage, binding);
            if (!rendered) {
                throw createActivationError(
                    this.currentStage === stage
                        ? 'activation-fresh-render-timeout'
                        : 'activation-generation-stale',
                    'The staged audio resource did not produce a current full-process render.'
                );
            }

            this._assertCurrentStage(stage);
            this._assertCurrentBinding(binding);
            if (callbacks.isCandidateCurrent?.(candidate, stage) === false) {
                throw createActivationError(
                    'activation-candidate-stale',
                    'The staged audio resource changed before activation.'
                );
            }

            if (typeof callbacks.prepare === 'function') {
                await callbacks.prepare(candidate, stage);
                this._assertCurrentStage(stage);
                this._assertCurrentBinding(binding);
                if (callbacks.isCandidateCurrent?.(candidate, stage) === false) {
                    throw createActivationError(
                        'activation-candidate-stale',
                        'The staged audio resource changed before publication.'
                    );
                }
            }

            let value = candidate;
            if (typeof callbacks.commit === 'function') {
                value = callbacks.commit(candidate, stage);
                if (value && typeof value.then === 'function') {
                    throw new TypeError('The staged activation commit must be synchronous');
                }
            }
            stage.state = 'active';
            this.activeStage = stage;
            return { activated: true, stage, value };
        } catch (error) {
            stage.state = this.currentStage === stage ? 'failed' : 'stale';
            stage.errorCode = error?.code || 'activation-failed';
            if (typeof callbacks.cleanup === 'function') {
                try {
                    await callbacks.cleanup(candidate, stage, error);
                } catch (_) {
                    // Cleanup failure cannot turn an unverified candidate into active state.
                }
            }
            return { activated: false, stage, error };
        }
    }

    recordWorkletEvent(data, workletNode) {
        if (!data || !workletNode ||
            (data.type !== 'powerObservation' && data.type !== 'powerFirstRender')) {
            return false;
        }
        if (isNonNegativeSafeInteger(data.renderSequence)) {
            this.latestObservations.set(workletNode, {
                workletGraphGeneration: data.workletGraphGeneration,
                topologyRevision: data.topologyRevision,
                renderSequence: data.renderSequence,
                state: data.state,
                processingDirective: data.processingDirective
            });
        }
        const waiter = this.renderWaiters.get(data.observationRequestId);
        if (!waiter) return true;
        if (!waiter.expectedNodes.has(workletNode)) return true;

        const baseline = waiter.baselines.get(workletNode) ?? -1;
        const matches = data.workletGraphGeneration === waiter.binding.workletGraphGeneration &&
            data.topologyRevision === waiter.binding.topologyRevision &&
            data.state === 'active' &&
            data.processingDirective === 'full-process' &&
            isNonNegativeSafeInteger(data.renderSequence) &&
            data.renderSequence > baseline;
        if (!matches) {
            this._settleRenderWaiter(waiter, false);
            return true;
        }
        waiter.seenNodes.add(workletNode);
        if (waiter.seenNodes.size === waiter.expectedNodes.size) {
            this._settleRenderWaiter(waiter, true);
        }
        return true;
    }

    getActiveDescriptor() {
        if (!this.activeStage) return null;
        return {
            generation: this.activeStage.generation,
            descriptor: this.activeStage.descriptor,
            activationIdentity: this.activeStage.activationIdentity,
            candidateIntentIdentity: this.activeStage.candidateIntentIdentity,
            binding: this.activeStage.binding
        };
    }

    _captureGraphBinding({ allowUnavailable = false } = {}) {
        try {
            return normalizeGraphSnapshot(
                this.getGraphSnapshot?.(),
                this.getActiveWorklets?.()
            );
        } catch (error) {
            if (allowUnavailable) return null;
            throw error;
        }
    }

    _assertCurrentStage(stage) {
        if (!stage || this.currentStage !== stage || stage.generation !== this.stageGeneration ||
            (stage.state !== 'staged' && stage.state !== 'awaiting-fresh-render')) {
            throw createActivationError(
                'activation-generation-stale',
                'A newer staged audio activation superseded this candidate.'
            );
        }
    }

    _assertCurrentBinding(binding) {
        const current = this._captureGraphBinding();
        if (!sameGraphBinding(binding, current)) {
            throw createActivationError(
                'activation-graph-stale',
                'The audio graph changed before the staged activation could commit.'
            );
        }
    }

    _waitForFreshFullRender(stage, binding) {
        const requestId = `activation-${stage.generation}-${++this.observationSequence}`;
        const expectedNodes = new Set(binding.nodes);
        const baselines = new Map();
        for (const node of expectedNodes) {
            const observation = this.latestObservations.get(node);
            const matchesBinding = observation?.workletGraphGeneration === binding.workletGraphGeneration &&
                observation?.topologyRevision === binding.topologyRevision;
            baselines.set(node, matchesBinding ? observation.renderSequence : -1);
        }
        return new Promise(resolve => {
            const waiter = {
                requestId,
                stageGeneration: stage.generation,
                binding,
                expectedNodes,
                baselines,
                seenNodes: new Set(),
                resolve,
                timer: null
            };
            waiter.timer = this.setTimeoutFn?.(() => {
                this._settleRenderWaiter(waiter, false);
            }, this.freshRenderTimeoutMs);
            this.renderWaiters.set(requestId, waiter);
            this.broadcast({
                type: 'requestPowerObservation',
                observationRequestId: requestId,
                workletGraphGeneration: binding.workletGraphGeneration,
                topologyRevision: binding.topologyRevision
            });
        });
    }

    _settleRenderWaiter(waiter, result) {
        if (this.renderWaiters.get(waiter.requestId) !== waiter) return;
        this.renderWaiters.delete(waiter.requestId);
        this.clearTimeoutFn?.(waiter.timer);
        waiter.resolve(result);
    }

    _cancelSupersededRenderWaiters(currentGeneration) {
        for (const waiter of this.renderWaiters.values()) {
            if (waiter.stageGeneration !== currentGeneration) {
                this._settleRenderWaiter(waiter, false);
            }
        }
    }
}

export function canonicalizeActivationDescriptor(value) {
    return canonicalize(value);
}
