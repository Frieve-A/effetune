import { assertRepositoryContract } from './contract-errors.js';

export function coalesceInvalidations(...inputEvents) {
  const events = inputEvents.length === 1 && Array.isArray(inputEvents[0]) ? inputEvents[0] : inputEvents;
  if (events.length === 0) {
    return { catalogVersion: 0, changedScopes: [], scopeVersions: {}, counts: {} };
  }

  let catalogVersion = 0;
  const changedScopes = [];
  const changedScopeSet = new Set();
  const latestByScope = new Map();

  events.forEach((event, eventIndex) => {
    validateInvalidation(event);
    catalogVersion = Math.max(catalogVersion, event.catalogVersion);
    for (const scope of event.changedScopes) {
      if (!changedScopeSet.has(scope)) {
        changedScopeSet.add(scope);
        changedScopes.push(scope);
      }
      const scopeVersion = event.scopeVersions[scope];
      const current = latestByScope.get(scope);
      if (!current || scopeVersion > current.scopeVersion || (scopeVersion === current.scopeVersion && eventIndex > current.eventIndex)) {
        latestByScope.set(scope, {
          scopeVersion,
          count: event.counts[scope],
          eventIndex
        });
      }
    }
  });

  const scopeVersions = {};
  const counts = {};
  for (const scope of changedScopes) {
    const latest = latestByScope.get(scope);
    scopeVersions[scope] = latest.scopeVersion;
    counts[scope] = latest.count;
  }
  return { catalogVersion, changedScopes, scopeVersions, counts };
}

function validateInvalidation(event) {
  assertRepositoryContract(isPlainObject(event), 'invalidInvalidation', 'Invalidation event must be an object');
  const actual = Object.keys(event).sort();
  const expected = ['catalogVersion', 'changedScopes', 'counts', 'scopeVersions'];
  assertRepositoryContract(actual.length === expected.length && actual.every((field, index) => field === expected[index]), 'invalidInvalidation', 'Invalidation event has unknown or missing fields');
  assertRepositoryContract(Number.isSafeInteger(event.catalogVersion) && event.catalogVersion >= 0, 'invalidInvalidation', 'Invalidation catalogVersion must be a non-negative integer');
  assertRepositoryContract(Array.isArray(event.changedScopes) && new Set(event.changedScopes).size === event.changedScopes.length, 'invalidInvalidation', 'Invalidation changedScopes must be a unique array');
  assertRepositoryContract(isPlainObject(event.scopeVersions) && isPlainObject(event.counts), 'invalidInvalidation', 'Invalidation scopeVersions and counts must be objects');
  for (const scope of event.changedScopes) {
    assertRepositoryContract(typeof scope === 'string' && scope.length > 0, 'invalidInvalidation', 'Invalidation scope must be a non-empty string');
    assertRepositoryContract(Number.isSafeInteger(event.scopeVersions[scope]) && event.scopeVersions[scope] >= 0, 'invalidInvalidation', `Invalidation scope ${scope} requires a non-negative version`);
    assertRepositoryContract(Object.hasOwn(event.counts, scope), 'invalidInvalidation', `Invalidation scope ${scope} requires a count`);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
