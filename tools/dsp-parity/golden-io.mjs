import fs from 'node:fs/promises';
import path from 'node:path';

export const GOLDEN_FORMAT_VERSION = 1;
export const DEFAULT_GOLDEN_BUDGET_BYTES = 2 * 1024 * 1024;

const CASE_METADATA_PATTERN = /^case-\d+\.json$/;
const CASE_BINARY_PATTERN = /^case-\d+\.f32$/;

export class GoldenBudgetError extends Error {
  constructor(totalBytes, budgetBytes, entries) {
    const listing = entries
      .map(entry => `  ${entry.name}: ${entry.bytes.toLocaleString('en-US')} bytes`)
      .join('\n');
    super(
      `Golden output would use ${totalBytes.toLocaleString('en-US')} bytes, exceeding the ` +
      `${budgetBytes.toLocaleString('en-US')}-byte budget. Trim cases instead of raising the budget:\n${listing}`
    );
    this.name = 'GoldenBudgetError';
    this.totalBytes = totalBytes;
    this.budgetBytes = budgetBytes;
    this.entries = entries;
  }
}

export function encodeFloat32LE(values) {
  if (!(values instanceof Float32Array)) throw new TypeError('Golden samples must be a Float32Array');
  const buffer = Buffer.allocUnsafe(values.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index++) buffer.writeFloatLE(values[index], index * 4);
  return buffer;
}

export function decodeFloat32LE(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError('Golden binary data must be a Buffer or Uint8Array');
  }
  if (buffer.byteLength % 4 !== 0) throw new Error(`Golden binary length ${buffer.byteLength} is not divisible by 4`);
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const values = new Float32Array(view.byteLength / 4);
  for (let index = 0; index < values.length; index++) values[index] = view.readFloatLE(index * 4);
  return values;
}

export async function writeFloat32File(filePath, values) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, encodeFloat32LE(values));
}

export async function readFloat32File(filePath, expectedFloats = null) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`Unable to read golden samples ${filePath}: ${error.message}`, { cause: error });
  }
  const values = decodeFloat32LE(buffer);
  if (expectedFloats !== null && values.length !== expectedFloats) {
    throw new Error(`Golden sample count mismatch in ${filePath}: expected ${expectedFloats}, found ${values.length}`);
  }
  return values;
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function serializableCase(testCase) {
  const copy = { ...testCase };
  if (typeof copy.seed === 'bigint') copy.seed = `0x${copy.seed.toString(16)}`;
  return copy;
}

export function createGoldenArtifacts({ type, schemaTolerance = null, cases }) {
  return cases.map((entry, index) => {
    const number = String(index + 1).padStart(3, '0');
    const binaryName = `case-${number}.f32`;
    const metadataName = `case-${number}.json`;
    const binary = encodeFloat32LE(entry.output);
    const testCase = serializableCase(entry.testCase);
    const metadata = {
      formatVersion: GOLDEN_FORMAT_VERSION,
      type,
      id: testCase.id,
      stimulus: testCase.stimulus,
      sampleRate: testCase.sampleRate,
      channels: testCase.channels,
      frameCount: testCase.frames,
      blockSize: testCase.blockSize,
      channelMode: testCase.channelMode,
      channel: testCase.channel,
      caseIndex: testCase.caseIndex,
      seed: testCase.seed,
      params: testCase.params,
      events: testCase.events ?? [],
      asset: testCase.asset,
      tolerance: testCase.tolerance ?? schemaTolerance,
      toleranceNote: testCase.toleranceNote,
      performanceBudgetMs: testCase.performanceBudgetMs,
      jsEngineHash: entry.jsEngineHash,
      referenceEngine: entry.referenceEngine,
      referenceHash: entry.referenceHash,
      outputFloats: entry.output.length,
      byteLength: binary.byteLength,
      binary: binaryName
    };
    for (const key of Object.keys(metadata)) {
      if (metadata[key] === undefined) delete metadata[key];
    }
    return { metadataName, binaryName, metadata, metadataBuffer: jsonBuffer(metadata), binary };
  });
}

export function measureGoldenArtifacts(artifacts) {
  return artifacts.map(artifact => ({
    name: artifact.metadata.id,
    bytes: artifact.metadataBuffer.byteLength + artifact.binary.byteLength
  }));
}

export function enforceGoldenBudget(artifacts, budgetBytes = DEFAULT_GOLDEN_BUDGET_BYTES, extraBytes = 0) {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) throw new TypeError(`Invalid golden budget: ${budgetBytes}`);
  const entries = measureGoldenArtifacts(artifacts);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, extraBytes);
  if (totalBytes > budgetBytes) throw new GoldenBudgetError(totalBytes, budgetBytes, entries);
  return totalBytes;
}

export async function writeGoldenSet(outputDir, artifacts, {
  budgetBytes = DEFAULT_GOLDEN_BUDGET_BYTES,
  type = artifacts[0]?.metadata.type ?? null
} = {}) {
  const index = {
    formatVersion: GOLDEN_FORMAT_VERSION,
    type,
    cases: artifacts.map(artifact => artifact.metadataName)
  };
  const indexBuffer = jsonBuffer(index);
  const totalBytes = enforceGoldenBudget(artifacts, budgetBytes, indexBuffer.byteLength);
  await fs.mkdir(outputDir, { recursive: true });
  const expectedCaseFiles = new Set();
  for (const artifact of artifacts) {
    if (!CASE_METADATA_PATTERN.test(artifact.metadataName) ||
        !CASE_BINARY_PATTERN.test(artifact.binaryName)) {
      throw new Error(`Invalid golden artifact file names: ${artifact.metadataName}, ${artifact.binaryName}`);
    }
    if (expectedCaseFiles.has(artifact.metadataName) || expectedCaseFiles.has(artifact.binaryName)) {
      throw new Error(`Duplicate golden artifact file name in ${outputDir}`);
    }
    expectedCaseFiles.add(artifact.metadataName);
    expectedCaseFiles.add(artifact.binaryName);
  }
  await Promise.all(artifacts.flatMap(artifact => [
    fs.writeFile(path.join(outputDir, artifact.metadataName), artifact.metadataBuffer),
    fs.writeFile(path.join(outputDir, artifact.binaryName), artifact.binary)
  ]));
  const staleCaseFiles = (await fs.readdir(outputDir, { withFileTypes: true }))
    .filter(entry => (CASE_METADATA_PATTERN.test(entry.name) || CASE_BINARY_PATTERN.test(entry.name)) &&
      !expectedCaseFiles.has(entry.name));
  for (const entry of staleCaseFiles) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error(`Refusing to remove non-file stale golden artifact ${path.join(outputDir, entry.name)}`);
    }
    await fs.unlink(path.join(outputDir, entry.name));
  }
  await fs.writeFile(path.join(outputDir, 'index.json'), indexBuffer);
  return { totalBytes, caseCount: artifacts.length, index };
}

export async function readGoldenSet(goldenDir) {
  let names;
  try {
    names = await fs.readdir(goldenDir);
  } catch (error) {
    throw new Error(`Unable to read golden directory ${goldenDir}: ${error.message}`, { cause: error });
  }
  const indexPath = path.join(goldenDir, 'index.json');
  let index;
  try {
    index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse golden index ${indexPath}: ${error.message}`, { cause: error });
  }
  if (index.formatVersion !== GOLDEN_FORMAT_VERSION) {
    throw new Error(`Unsupported golden format ${index.formatVersion} in ${indexPath}`);
  }
  if (!Array.isArray(index.cases) || index.cases.length === 0) {
    throw new Error(`Golden index ${indexPath} must list at least one case`);
  }
  const metadataNames = [];
  const indexedMetadata = new Set();
  for (const metadataName of index.cases) {
    if (typeof metadataName !== 'string' || !CASE_METADATA_PATTERN.test(metadataName)) {
      throw new Error(`Golden index ${indexPath} contains invalid case name ${String(metadataName)}`);
    }
    if (indexedMetadata.has(metadataName)) {
      throw new Error(`Golden index ${indexPath} contains duplicate case ${metadataName}`);
    }
    indexedMetadata.add(metadataName);
    metadataNames.push(metadataName);
  }
  const directoryMetadata = names.filter(name => CASE_METADATA_PATTERN.test(name));
  const missingMetadata = metadataNames.filter(name => !directoryMetadata.includes(name));
  const extraMetadata = directoryMetadata.filter(name => !indexedMetadata.has(name));
  if (missingMetadata.length > 0 || extraMetadata.length > 0) {
    throw new Error(
      `Golden metadata/index mismatch in ${goldenDir}: ` +
      `missing [${missingMetadata.join(', ')}], extra [${extraMetadata.join(', ')}]`
    );
  }
  const cases = [];
  const binaryNames = new Set();
  for (const metadataName of metadataNames) {
    const metadataPath = path.join(goldenDir, metadataName);
    let metadata;
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch (error) {
      throw new Error(`Unable to parse golden metadata ${metadataPath}: ${error.message}`, { cause: error });
    }
    if (metadata.formatVersion !== GOLDEN_FORMAT_VERSION) {
      throw new Error(`Unsupported golden format ${metadata.formatVersion} in ${metadataPath}`);
    }
    if (index.type !== undefined && metadata.type !== index.type) {
      throw new Error(`Golden type mismatch in ${metadataPath}: expected ${index.type}, found ${metadata.type}`);
    }
    const binaryName = metadata.binary ?? metadataName.replace(/\.json$/, '.f32');
    if (typeof binaryName !== 'string' || !CASE_BINARY_PATTERN.test(binaryName)) {
      throw new Error(`Golden metadata ${metadataPath} contains invalid binary name ${String(binaryName)}`);
    }
    if (binaryNames.has(binaryName)) {
      throw new Error(`Golden metadata in ${goldenDir} contains duplicate binary ${binaryName}`);
    }
    binaryNames.add(binaryName);
    const binaryPath = path.join(goldenDir, binaryName);
    const expected = await readFloat32File(binaryPath, metadata.outputFloats);
    cases.push({ metadata, metadataPath, binaryPath, expected });
  }
  const directoryBinaries = names.filter(name => CASE_BINARY_PATTERN.test(name));
  const extraBinaries = directoryBinaries.filter(name => !binaryNames.has(name));
  if (extraBinaries.length > 0) {
    throw new Error(`Golden binary/index mismatch in ${goldenDir}: extra [${extraBinaries.join(', ')}]`);
  }
  return cases;
}
