const FEISTEL_ROUNDS = 6;
export const MAX_TRANSPORT_SEQUENCE_ITEMS = 0x40000000;

export class ReversibleShufflePermutation {
  constructor(itemCount, seed = 0) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > MAX_TRANSPORT_SEQUENCE_ITEMS) {
      throw new RangeError(`itemCount must be an integer from 0 to ${MAX_TRANSPORT_SEQUENCE_ITEMS}`);
    }
    if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
    this.itemCount = itemCount;
    this.seed = seed;
    this.halfBits = itemCount <= 1 ? 1 : Math.ceil(Math.ceil(Math.log2(itemCount)) / 2);
    this.halfMask = (2 ** this.halfBits) - 1;
    this.roundKeys = Object.freeze(createRoundKeys(seed));
  }

  permute(ordinal) {
    this.validateOrdinal(ordinal);
    if (this.itemCount <= 1) return ordinal;
    let value = ordinal;
    do value = this.feistel(value, false); while (value >= this.itemCount);
    return value;
  }

  invert(shuffledOrdinal) {
    this.validateOrdinal(shuffledOrdinal);
    if (this.itemCount <= 1) return shuffledOrdinal;
    let value = shuffledOrdinal;
    do value = this.feistel(value, true); while (value >= this.itemCount);
    return value;
  }

  validateOrdinal(ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= this.itemCount) {
      throw new RangeError('ordinal is outside the playback sequence');
    }
  }

  feistel(value, inverse) {
    let left = Math.floor(value / (this.halfMask + 1));
    let right = value & this.halfMask;
    if (inverse) {
      for (let round = FEISTEL_ROUNDS - 1; round >= 0; round -= 1) {
        const previousRight = left;
        const previousLeft = (right ^ roundFunction(left, this.roundKeys[round], this.halfMask)) & this.halfMask;
        left = previousLeft;
        right = previousRight;
      }
    } else {
      for (let round = 0; round < FEISTEL_ROUNDS; round += 1) {
        const nextLeft = right;
        const nextRight = (left ^ roundFunction(right, this.roundKeys[round], this.halfMask)) & this.halfMask;
        left = nextLeft;
        right = nextRight;
      }
    }
    return left * (this.halfMask + 1) + right;
  }
}

export function shuffleEpochSeed(seed, epoch = 0) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(epoch)) {
    throw new RangeError('shuffle seed and epoch must be safe integers');
  }
  return Number(BigInt.asIntN(53, BigInt(seed) + (BigInt(epoch) * 0x9e3779b9n)));
}

export function canonicalOrdinalForTransport(segment, transportOrdinal, itemCount) {
  return createTransportOrdinalMapper(segment, itemCount)(transportOrdinal);
}

export function createTransportOrdinalMapper(segment, itemCount) {
  if (segment?.shuffleSeed == null) return transportOrdinal => transportOrdinal;
  const permutation = new ReversibleShufflePermutation(
    itemCount,
    shuffleEpochSeed(segment.shuffleSeed, segment.shuffleEpoch ?? 0)
  );
  const offset = segment.shuffleTransportOffset ?? 0;
  return transportOrdinal => permutation.permute((transportOrdinal + offset) % itemCount);
}

function createRoundKeys(seed) {
  const keys = [];
  let value = Number(BigInt.asUintN(32, BigInt(seed)));
  for (let round = 0; round < FEISTEL_ROUNDS; round += 1) {
    value = mix32(value + 0x9e3779b9 + round);
    keys.push(value);
  }
  return keys;
}

function roundFunction(value, key, mask) {
  return mix32((value ^ key) >>> 0) & mask;
}

function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}
