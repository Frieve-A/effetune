export const POWER_MUTATION_KINDS = Object.freeze([
    'input-install',
    'input-release',
    'route-topology-commit',
    'graph-replacement',
    'config-intent-commit'
]);

export const POWER_ACTIVITY_LEASE_MODES = Object.freeze([
    'force-active',
    'hold-current'
]);

export const POWER_HOLD_CURRENT_SCOPES = Object.freeze([
    'resource-mutation',
    'resource-neutral'
]);

const TOKEN_KEYS = Object.freeze([
    'policyGeneration',
    'inputGeneration',
    'topologyRevision',
    'workletGraphGeneration'
]);

const GUARD_KEYS = Object.freeze([
    'routeIntentRevision',
    'inputConfigRevision',
    'playerIntentGeneration'
]);

const INTENT_CHANGE_KEYS = GUARD_KEYS;
const MUTATION_REQUEST_KEYS = Object.freeze([
    'ownerOperationId',
    'mutationKind',
    'beforeTokens',
    'beforeGuards',
    'resourceSnapshot',
    'topologyChanged',
    'intentChanges'
]);

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, name) {
    if (!isPlainObject(value)) {
        throw new TypeError(`${name} must be a plain object`);
    }
}

function assertExactKeys(value, expectedKeys, name) {
    assertPlainObject(value, name);
    const actualKeys = Object.keys(value).sort();
    const sortedExpected = [...expectedKeys].sort();
    if (actualKeys.length !== sortedExpected.length ||
        actualKeys.some((key, index) => key !== sortedExpected[index])) {
        throw new TypeError(`${name} must contain exactly: ${sortedExpected.join(', ')}`);
    }
}

function assertAllowedKeys(value, allowedKeys, name) {
    assertPlainObject(value, name);
    const allowed = new Set(allowedKeys);
    const unexpected = Object.keys(value).filter(key => !allowed.has(key));
    if (unexpected.length > 0) {
        throw new TypeError(`${name} contains unsupported keys: ${unexpected.join(', ')}`);
    }
}

function assertSafeCounter(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a nonnegative safe integer`);
    }
}

function incrementCounter(value, delta, name) {
    const nextValue = value + delta;
    if (!Number.isSafeInteger(nextValue)) {
        throw new RangeError(`${name} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return nextValue;
}

function freezeRecord(record) {
    return Object.freeze(record);
}

function normalizeCounterRecord(value, keys, name) {
    assertExactKeys(value, keys, name);
    const normalized = {};
    for (const key of keys) {
        assertSafeCounter(value[key], `${name}.${key}`);
        normalized[key] = value[key];
    }
    return freezeRecord(normalized);
}

function recordsEqual(left, right, keys) {
    return keys.every(key => left[key] === right[key]);
}

function normalizeOwnerOperationId(value) {
    const isString = typeof value === 'string' && value.length > 0;
    const isInteger = Number.isSafeInteger(value) && value >= 0;
    if (!isString && !isInteger) {
        throw new TypeError('ownerOperationId must be a nonempty string or nonnegative safe integer');
    }
    return value;
}

function normalizeIntentChanges(value, mutationKind) {
    const defaults = {
        routeIntentRevision: false,
        inputConfigRevision: mutationKind === 'config-intent-commit',
        playerIntentGeneration: false
    };
    if (value === undefined) return freezeRecord(defaults);

    assertExactKeys(value, INTENT_CHANGE_KEYS, 'intentChanges');
    const normalized = {};
    for (const key of INTENT_CHANGE_KEYS) {
        if (typeof value[key] !== 'boolean') {
            throw new TypeError(`intentChanges.${key} must be boolean`);
        }
        normalized[key] = value[key];
    }

    if (mutationKind === 'graph-replacement' &&
        INTENT_CHANGE_KEYS.some(key => normalized[key])) {
        throw new TypeError('graph-replacement cannot change intent guards');
    }
    if (mutationKind === 'config-intent-commit' &&
        (!normalized.inputConfigRevision ||
            normalized.routeIntentRevision ||
            normalized.playerIntentGeneration)) {
        throw new TypeError('config-intent-commit must change only inputConfigRevision');
    }
    return freezeRecord(normalized);
}

function resolveTopologyDelta(mutationKind, topologyChanged) {
    if (topologyChanged !== undefined && typeof topologyChanged !== 'boolean') {
        throw new TypeError('topologyChanged must be boolean when provided');
    }

    if (mutationKind === 'route-topology-commit' || mutationKind === 'graph-replacement') {
        if (topologyChanged === false) {
            throw new TypeError(`${mutationKind} must change topologyRevision`);
        }
        return 1;
    }
    if (mutationKind === 'config-intent-commit') {
        if (topologyChanged === true) {
            throw new TypeError('config-intent-commit cannot change topologyRevision');
        }
        return 0;
    }
    return topologyChanged === true ? 1 : 0;
}

function getMutationDeltas(mutationKind, topologyChanged, intentChanges) {
    const topologyRevision = resolveTopologyDelta(mutationKind, topologyChanged);
    const tokenDeltas = {
        policyGeneration: 1,
        inputGeneration: 0,
        topologyRevision,
        workletGraphGeneration: 0
    };

    if (mutationKind === 'input-install' || mutationKind === 'input-release') {
        tokenDeltas.inputGeneration = 1;
    } else if (mutationKind === 'graph-replacement') {
        tokenDeltas.workletGraphGeneration = 1;
    }

    const guardDeltas = {};
    for (const key of GUARD_KEYS) {
        guardDeltas[key] = intentChanges[key] ? 1 : 0;
    }
    return {
        tokenDeltas: freezeRecord(tokenDeltas),
        guardDeltas: freezeRecord(guardDeltas)
    };
}

function applyDeltas(record, deltas, keys, name) {
    const next = {};
    for (const key of keys) {
        next[key] = incrementCounter(record[key], deltas[key], `${name}.${key}`);
    }
    return freezeRecord(next);
}

export function createPowerMutationTokens(values = {}) {
    assertAllowedKeys(values, TOKEN_KEYS, 'token values');
    const {
        policyGeneration = 0,
        inputGeneration = 0,
        topologyRevision = 0,
        workletGraphGeneration = 0
    } = values;
    return normalizeCounterRecord({
        policyGeneration,
        inputGeneration,
        topologyRevision,
        workletGraphGeneration
    }, TOKEN_KEYS, 'tokens');
}

export function createPowerIntentGuards(values = {}) {
    assertAllowedKeys(values, GUARD_KEYS, 'guard values');
    const {
        routeIntentRevision = 0,
        inputConfigRevision = 0,
        playerIntentGeneration = 0
    } = values;
    return normalizeCounterRecord({
        routeIntentRevision,
        inputConfigRevision,
        playerIntentGeneration
    }, GUARD_KEYS, 'guards');
}

export class PowerMutationCoordinator {
    #tokens;
    #guards;
    #resourceSnapshot;
    #mutationSequence;

    constructor({
        tokens = createPowerMutationTokens(),
        guards = createPowerIntentGuards(),
        resourceSnapshot = null,
        mutationSequence = 0
    } = {}) {
        this.#tokens = normalizeCounterRecord(tokens, TOKEN_KEYS, 'tokens');
        this.#guards = normalizeCounterRecord(guards, GUARD_KEYS, 'guards');
        assertSafeCounter(mutationSequence, 'mutationSequence');
        this.#mutationSequence = mutationSequence;
        this.#resourceSnapshot = resourceSnapshot;
    }

    getSnapshot() {
        return freezeRecord({
            tokens: this.#tokens,
            guards: this.#guards,
            resourceSnapshot: this.#resourceSnapshot,
            mutationSequence: this.#mutationSequence
        });
    }

    commitOwnedMutation(request) {
        assertAllowedKeys(request, MUTATION_REQUEST_KEYS, 'mutation request');
        for (const key of ['ownerOperationId', 'mutationKind', 'beforeTokens', 'beforeGuards', 'resourceSnapshot']) {
            if (!Object.prototype.hasOwnProperty.call(request, key)) {
                throw new TypeError(`mutation request.${key} is required`);
            }
        }

        const ownerOperationId = normalizeOwnerOperationId(request.ownerOperationId);
        const { mutationKind } = request;
        if (!POWER_MUTATION_KINDS.includes(mutationKind)) {
            throw new TypeError(`unsupported mutationKind: ${mutationKind}`);
        }

        const beforeTokens = normalizeCounterRecord(request.beforeTokens, TOKEN_KEYS, 'beforeTokens');
        const beforeGuards = normalizeCounterRecord(request.beforeGuards, GUARD_KEYS, 'beforeGuards');
        if (!recordsEqual(beforeTokens, this.#tokens, TOKEN_KEYS) ||
            !recordsEqual(beforeGuards, this.#guards, GUARD_KEYS)) {
            throw new Error('mutation owner expectations are stale');
        }

        if (mutationKind === 'config-intent-commit' &&
            request.resourceSnapshot !== this.#resourceSnapshot) {
            throw new TypeError('config-intent-commit must preserve resourceSnapshot identity');
        }

        const intentChanges = normalizeIntentChanges(request.intentChanges, mutationKind);
        const { tokenDeltas, guardDeltas } = getMutationDeltas(
            mutationKind,
            request.topologyChanged,
            intentChanges
        );
        const afterTokens = applyDeltas(beforeTokens, tokenDeltas, TOKEN_KEYS, 'afterTokens');
        const afterGuards = applyDeltas(beforeGuards, guardDeltas, GUARD_KEYS, 'afterGuards');
        const mutationSequence = incrementCounter(
            this.#mutationSequence,
            1,
            'mutationSequence'
        );

        const receipt = freezeRecord({
            ownerOperationId,
            mutationSequence,
            mutationKind,
            beforeTokens,
            afterTokens
        });
        const result = freezeRecord({
            receipt,
            beforeGuards,
            afterGuards,
            resourceSnapshot: request.resourceSnapshot
        });

        this.#tokens = afterTokens;
        this.#guards = afterGuards;
        this.#resourceSnapshot = request.resourceSnapshot;
        this.#mutationSequence = mutationSequence;
        return result;
    }
}

export class PowerActivityLeaseRegistry {
    #leases = new Map();
    #nextToken = 0;

    acquireLease(reason, { mode, scope = null } = {}) {
        if (typeof reason !== 'string' || reason.length === 0) {
            throw new TypeError('lease reason must be a nonempty string');
        }
        if (!POWER_ACTIVITY_LEASE_MODES.includes(mode)) {
            throw new TypeError(`unsupported lease mode: ${mode}`);
        }
        if (mode === 'hold-current') {
            if (!POWER_HOLD_CURRENT_SCOPES.includes(scope)) {
                throw new TypeError('hold-current leases require a valid scope');
            }
        } else if (scope !== null) {
            throw new TypeError('force-active leases do not accept a scope');
        }

        this.#nextToken = incrementCounter(this.#nextToken, 1, 'lease token');
        const token = this.#nextToken;
        this.#leases.set(token, freezeRecord({ token, reason, mode, scope }));
        let released = false;
        return () => {
            if (released) return false;
            released = true;
            return this.#leases.delete(token);
        };
    }

    clear() {
        const count = this.#leases.size;
        this.#leases.clear();
        return count;
    }

    getSnapshot() {
        const leases = [...this.#leases.values()];
        let forceActiveCount = 0;
        let holdCurrentCount = 0;
        let resourceMutationInProgress = false;
        for (const lease of leases) {
            if (lease.mode === 'force-active') {
                forceActiveCount += 1;
            } else {
                holdCurrentCount += 1;
                if (lease.scope === 'resource-mutation') {
                    resourceMutationInProgress = true;
                }
            }
        }
        return freezeRecord({
            forceActiveCount,
            holdCurrentCount,
            resourceMutationInProgress,
            leases: Object.freeze(leases)
        });
    }
}
