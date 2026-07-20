const IR_ID_HEX_LENGTH = 24;

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('IR source data must be binary.');
}

function toHex(bytes) {
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

async function digestBytes(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle?.digest) {
    throw new Error('SHA-256 is unavailable.');
  }
  return new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', asBytes(bytes)));
}

export async function sha256IrBytes(bytes, cryptoProvider = globalThis.crypto) {
  return toHex(await digestBytes(bytes, cryptoProvider));
}

export async function identifySingleIr(bytes, cryptoProvider = globalThis.crypto) {
  const sha256 = await sha256IrBytes(bytes, cryptoProvider);
  return Object.freeze({ irId: sha256.slice(0, IR_ID_HEX_LENGTH), sha256 });
}

export async function identifyPairedIr(leftBytes, rightBytes, cryptoProvider = globalThis.crypto) {
  const [leftDigest, rightDigest] = await Promise.all([
    digestBytes(leftBytes, cryptoProvider),
    digestBytes(rightBytes, cryptoProvider)
  ]);
  const composition = new Uint8Array(leftDigest.byteLength + rightDigest.byteLength);
  composition.set(leftDigest);
  composition.set(rightDigest, leftDigest.byteLength);
  const pairDigest = await digestBytes(composition, cryptoProvider);
  return Object.freeze({
    irId: toHex(pairDigest).slice(0, IR_ID_HEX_LENGTH),
    leftSha256: toHex(leftDigest),
    rightSha256: toHex(rightDigest)
  });
}
