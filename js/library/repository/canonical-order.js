import { assertRepositoryContract } from './contract-errors.js';

export const ENTITY_KINDS = Object.freeze([
  'track',
  'album',
  'artist',
  'genre',
  'folder',
  'subfolder',
  'playlist'
]);

export const CANONICAL_VALUE_TYPES = Object.freeze([
  'text',
  'number',
  'boolean',
  'bytes'
]);

const TUPLE_VALUE_FIELDS = Object.freeze(['type', 'nullRank', 'value']);

export function createCanonicalOrderDescriptor({
  id,
  endpoint,
  fields,
  stableIdField,
  entityKind,
  allowedEntityKinds = entityKind ? [entityKind] : ENTITY_KINDS,
  stableIdDirection = 'asc',
  entityKindDirection = 'asc'
}) {
  assertNonEmptyString(id, 'Order descriptor id');
  assertNonEmptyString(endpoint, 'Order descriptor endpoint');
  assertNonEmptyString(stableIdField, 'Order descriptor stableIdField');
  assertRepositoryContract(Array.isArray(fields) && fields.length > 0, 'invalidOrderDescriptor', 'Order descriptor requires sort fields');

  const normalizedFields = fields.map((field, index) => normalizeSortField(field, index));
  const normalizedKinds = normalizeEntityKinds(allowedEntityKinds);
  if (entityKind !== undefined) {
    assertRepositoryContract(normalizedKinds.length === 1 && normalizedKinds[0] === entityKind, 'invalidOrderDescriptor', 'A fixed entityKind must be the only allowed kind');
  }
  assertDirection(stableIdDirection, 'stableIdDirection');
  assertDirection(entityKindDirection, 'entityKindDirection');

  const descriptor = {
    id,
    endpoint,
    fields: Object.freeze(normalizedFields),
    stableIdField,
    entityKind: entityKind || null,
    allowedEntityKinds: Object.freeze(normalizedKinds),
    stableIdDirection,
    entityKindDirection
  };

  return Object.freeze({
    ...descriptor,
    buildTuple: row => buildCanonicalTuple(descriptor, row),
    compareTuples: (left, right) => compareCanonicalTuples(descriptor, left, right),
    compareRows: (left, right) => compareCanonicalTuples(
      descriptor,
      buildCanonicalTuple(descriptor, left),
      buildCanonicalTuple(descriptor, right)
    ),
    createKeysetPredicate: (cursorTuple, continuation) => createKeysetPredicate(descriptor, cursorTuple, continuation),
    validateTuple: tuple => validateCanonicalTuple(descriptor, tuple)
  });
}

export function buildCanonicalTuple(descriptor, row) {
  assertRepositoryContract(row && typeof row === 'object', 'invalidOrderRow', 'Ordered row must be an object');
  const tuple = descriptor.fields.map(field => encodeSortValue(row[field.field], field));
  const stableEntityId = row[descriptor.stableIdField];
  assertNonEmptyString(stableEntityId, `Stable entity ID field ${descriptor.stableIdField}`);
  const entityKind = descriptor.entityKind || row.entityKind;
  assertRepositoryContract(descriptor.allowedEntityKinds.includes(entityKind), 'invalidEntityKind', 'Row entity kind is not valid for this endpoint', {
    entityKind,
    allowed: descriptor.allowedEntityKinds
  });
  tuple.push(Object.freeze({ type: 'uid', nullRank: 0, value: stableEntityId }));
  tuple.push(Object.freeze({ type: 'entityKind', nullRank: 0, value: entityKind }));
  return Object.freeze(tuple);
}

export function validateCanonicalTuple(descriptor, tuple) {
  const expectedLength = descriptor.fields.length + 2;
  assertRepositoryContract(Array.isArray(tuple) && tuple.length === expectedLength, 'invalidCursorTuple', 'Cursor tuple has the wrong number of components', {
    actual: Array.isArray(tuple) ? tuple.length : null,
    expected: expectedLength
  });

  descriptor.fields.forEach((field, index) => validateSortComponent(tuple[index], field, index));
  validateTieComponent(tuple[tuple.length - 2], 'uid', value => typeof value === 'string' && value.length > 0);
  validateTieComponent(tuple[tuple.length - 1], 'entityKind', value => descriptor.allowedEntityKinds.includes(value));
  return tuple;
}

export function compareCanonicalTuples(descriptor, left, right) {
  validateCanonicalTuple(descriptor, left);
  validateCanonicalTuple(descriptor, right);

  for (let index = 0; index < descriptor.fields.length; index += 1) {
    const result = compareSortComponents(left[index], right[index], descriptor.fields[index]);
    if (result !== 0) return result;
  }

  const stableIdResult = comparePrimitive(left[left.length - 2].value, right[right.length - 2].value);
  if (stableIdResult !== 0) return applyDirection(stableIdResult, descriptor.stableIdDirection);
  const kindResult = ENTITY_KINDS.indexOf(left[left.length - 1].value) - ENTITY_KINDS.indexOf(right[right.length - 1].value);
  return applyDirection(Math.sign(kindResult), descriptor.entityKindDirection);
}

export function createKeysetPredicate(descriptor, cursorTuple, continuation) {
  validateCanonicalTuple(descriptor, cursorTuple);
  assertRepositoryContract(continuation === 'after' || continuation === 'before', 'invalidContinuation', 'Continuation must be after or before');
  return rowOrTuple => {
    const tuple = Array.isArray(rowOrTuple) ? rowOrTuple : buildCanonicalTuple(descriptor, rowOrTuple);
    const comparison = compareCanonicalTuples(descriptor, tuple, cursorTuple);
    return continuation === 'after' ? comparison > 0 : comparison < 0;
  };
}

function normalizeSortField(field, index) {
  assertRepositoryContract(field && typeof field === 'object' && !Array.isArray(field), 'invalidOrderDescriptor', `Sort field ${index} must be an object`);
  const actual = Object.keys(field).sort();
  const allowed = ['direction', 'field', 'nulls', 'type'];
  assertRepositoryContract(actual.every(key => allowed.includes(key)), 'invalidOrderDescriptor', `Sort field ${index} has unknown properties`);
  assertNonEmptyString(field.field, `Sort field ${index} name`);
  assertRepositoryContract(CANONICAL_VALUE_TYPES.includes(field.type), 'invalidOrderDescriptor', `Sort field ${index} has an unknown type`);
  const direction = field.direction || 'asc';
  const nulls = field.nulls || 'last';
  assertDirection(direction, `Sort field ${index} direction`);
  assertRepositoryContract(nulls === 'first' || nulls === 'last', 'invalidOrderDescriptor', `Sort field ${index} nulls must be first or last`);
  return Object.freeze({ field: field.field, type: field.type, direction, nulls });
}

function normalizeEntityKinds(kinds) {
  assertRepositoryContract(Array.isArray(kinds) && kinds.length > 0, 'invalidOrderDescriptor', 'Order descriptor requires allowed entity kinds');
  const unique = [...new Set(kinds)];
  assertRepositoryContract(unique.length === kinds.length && unique.every(kind => ENTITY_KINDS.includes(kind)), 'invalidOrderDescriptor', 'Order descriptor contains an invalid entity kind');
  return unique;
}

function encodeSortValue(value, field) {
  const isNull = value === null || value === undefined;
  if (!isNull) validateTypedValue(value, field.type, 'invalidOrderRow');
  return Object.freeze({
    type: field.type,
    nullRank: isNull === (field.nulls === 'last') ? 1 : 0,
    value: isNull ? null : normalizeTypedValue(value, field.type)
  });
}

function validateSortComponent(component, field, index) {
  assertExactTupleValue(component, index);
  assertRepositoryContract(component.type === field.type, 'invalidCursorTuple', `Cursor tuple component ${index} has the wrong type`);
  const isNull = component.value === null;
  const expectedNullRank = isNull === (field.nulls === 'last') ? 1 : 0;
  assertRepositoryContract(component.nullRank === expectedNullRank, 'invalidCursorTuple', `Cursor tuple component ${index} has the wrong null rank`);
  if (!isNull) validateTypedValue(component.value, field.type, 'invalidCursorTuple');
}

function validateTieComponent(component, type, validateValue) {
  assertExactTupleValue(component, type);
  assertRepositoryContract(component.type === type && component.nullRank === 0 && validateValue(component.value), 'invalidCursorTuple', `Cursor tuple ${type} tie-breaker is invalid`);
}

function assertExactTupleValue(component, index) {
  assertRepositoryContract(component && typeof component === 'object' && !Array.isArray(component), 'invalidCursorTuple', `Cursor tuple component ${index} must be an object`);
  const actual = Object.keys(component).sort();
  const expected = [...TUPLE_VALUE_FIELDS].sort();
  assertRepositoryContract(actual.length === expected.length && actual.every((field, fieldIndex) => field === expected[fieldIndex]), 'invalidCursorTuple', `Cursor tuple component ${index} has unknown or missing fields`);
}

function validateTypedValue(value, type, code) {
  let valid = false;
  if (type === 'text') valid = typeof value === 'string';
  if (type === 'number') valid = typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') valid = typeof value === 'boolean';
  if (type === 'bytes') valid = typeof value === 'string' && /^[A-Za-z0-9_-]*$/.test(value);
  assertRepositoryContract(valid, code, `Value does not match canonical type ${type}`);
}

function normalizeTypedValue(value, type) {
  if (type === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function compareSortComponents(left, right, field) {
  if (left.nullRank !== right.nullRank) return left.nullRank - right.nullRank;
  if (left.value === null) return 0;
  return applyDirection(comparePrimitive(left.value, right.value), field.direction);
}

function comparePrimitive(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function applyDirection(value, direction) {
  return direction === 'desc' ? -value : value;
}

function assertDirection(direction, field) {
  assertRepositoryContract(direction === 'asc' || direction === 'desc', 'invalidOrderDescriptor', `${field} must be asc or desc`);
}

function assertNonEmptyString(value, field) {
  assertRepositoryContract(typeof value === 'string' && value.length > 0, 'invalidOrderDescriptor', `${field} must be a non-empty string`);
}
