import { SFZ_SAMPLE_RANGE_MAX_BYTES } from '../sfz/sample-reader.js';

const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const RECORD_BYTES = { phdr: 38, pbag: 4, pmod: 10, pgen: 4, inst: 22, ibag: 4, imod: 10, igen: 4, shdr: 46 };
const ascii = bytes => new TextDecoder('windows-1252').decode(bytes).replace(/\0.*$/s, '');
const tag = bytes => String.fromCharCode(...bytes.subarray(0, 4));

export function sf2Error(detail) {
  const error = new Error('This SoundFont could not be loaded. Choose another sound source.');
  error.code = 'invalid-sf2';
  error.diagnostic = detail;
  return error;
}

// Only headers and bounded articulation tables are read here. Sample data stays
// in the granted reader, including when the RIFF extends beyond signed 32 bits.
export async function parseSf2(reader) {
  if (!Number.isSafeInteger(reader?.size) || reader.size < 12 || typeof reader.readRange !== 'function') {
    throw sf2Error('Invalid source reader');
  }
  let metadataBytes = 0, chunkCount = 0;
  const read = async (offset, length) => {
    if (!Number.isSafeInteger(offset + length) || offset < 0 || length < 0 || offset + length > reader.size ||
        metadataBytes + length > MAX_METADATA_BYTES) throw sf2Error('Metadata bounds exceeded');
    metadataBytes += length;
    const bytes = new Uint8Array(length);
    for (let at = 0; at < length; at += SFZ_SAMPLE_RANGE_MAX_BYTES) {
      const count = Math.min(SFZ_SAMPLE_RANGE_MAX_BYTES, length - at);
      const part = await reader.readRange(offset + at, count);
      if (!(part instanceof Uint8Array) || part.byteLength !== count) throw sf2Error('Short metadata read');
      bytes.set(part, at);
    }
    return bytes;
  };
  const chunks = async (start, end) => {
    const result = new Map();
    for (let offset = start; offset < end;) {
      if (++chunkCount > 4096 || end - offset < 8) throw sf2Error('Invalid chunk directory');
      const header = await read(offset, 8);
      const length = new DataView(header.buffer).getUint32(4, true);
      // MuseScore SF3 leaves an odd SMPL/LIST unpadded. The next real chunk
      // header distinguishes it from the conventional RIFF pad byte.
      let next = offset + 8 + length;
      if (length % 2 && next < end && (await read(next, 1))[0] === 0) next++;
      if (next > end) throw sf2Error('Chunk exceeds parent');
      let name = tag(header), dataOffset = offset + 8, dataLength = length;
      if (name === 'LIST') {
        if (length < 4) throw sf2Error('Short LIST chunk');
        name = tag(await read(dataOffset, 4)); dataOffset += 4; dataLength -= 4;
      }
      if (result.has(name)) throw sf2Error(`Duplicate chunk ${name}`);
      result.set(name, { offset: dataOffset, length: dataLength });
      offset = next;
    }
    return result;
  };
  const header = await read(0, 12);
  if (tag(header) !== 'RIFF' || tag(header.subarray(8)) !== 'sfbk' ||
      new DataView(header.buffer).getUint32(4, true) + 8 !== reader.size) throw sf2Error('Invalid RIFF sfbk size or type');
  const directory = await chunks(12, reader.size);
  const sections = {};
  for (const name of ['INFO', 'sdta', 'pdta']) {
    const entry = directory.get(name);
    if (!entry) throw sf2Error(`Missing ${name}`);
    sections[name] = await chunks(entry.offset, entry.offset + entry.length);
  }
  const info = {};
  let version;
  for (const [name, entry] of sections.INFO) {
    const bytes = await read(entry.offset, entry.length);
    if (name === 'ifil') {
      if (bytes.length !== 4) throw sf2Error('Invalid ifil');
      const view = new DataView(bytes.buffer);
      version = { major: view.getUint16(0, true), minor: view.getUint16(2, true) };
    } else info[name] = ascii(bytes);
  }
  if (!version || ![2, 3].includes(version.major) || ![0, 1, 4].includes(version.minor)) throw sf2Error('Unsupported SoundFont version');
  const smpl = sections.sdta.get('smpl'), sm24 = sections.sdta.get('sm24');
  if (!smpl || version.major === 2 && smpl.length % 2) throw sf2Error('Missing or invalid sample pool');
  const sampleFrames = Math.floor(smpl.length / 2);
  const sm24Offset = (version.major === 3 || version.minor >= 4) && sm24 &&
    (version.major === 3 || sm24.length === sampleFrames + sampleFrames % 2) ? sm24.offset : null;
  const tables = {};
  for (const [name, stride] of Object.entries(RECORD_BYTES)) {
    const entry = sections.pdta.get(name);
    if (!entry || entry.length % stride || entry.length / stride > 65536 ||
        entry.length < stride * (['phdr', 'inst', 'shdr'].includes(name) ? 2 : 1)) {
      throw sf2Error(`Invalid ${name} table`);
    }
    const bytes = await read(entry.offset, entry.length), view = new DataView(bytes.buffer);
    const records = [];
    for (let at = 0; at < bytes.length; at += stride) {
      const u16 = offset => view.getUint16(at + offset, true);
      const i16 = offset => view.getInt16(at + offset, true);
      const u32 = offset => view.getUint32(at + offset, true);
      const nameText = () => ascii(bytes.subarray(at, at + 20));
      if (name === 'phdr') records.push({ name: nameText(), program: u16(20), bank: u16(22), bag: u16(24), library: u32(26), genre: u32(30), morphology: u32(34) });
      else if (name === 'inst') records.push({ name: nameText(), bag: u16(20) });
      else if (name === 'shdr') records.push({ name: nameText(), start: u32(20), end: u32(24), loopStart: u32(28), loopEnd: u32(32),
        sampleRate: u32(36), originalPitch: view.getUint8(at + 40), pitchCorrection: view.getInt8(at + 41), sampleLink: u16(42), sampleType: u16(44) });
      else if (name.endsWith('bag')) records.push({ generator: u16(0), modulator: u16(2) });
      else if (name.endsWith('gen')) records.push({ operator: u16(0), amount: i16(2), unsignedAmount: u16(2) });
      else records.push({ source: u16(0), destination: u16(2), amount: i16(4), amountSource: u16(6), transform: u16(8) });
    }
    tables[name] = records;
  }
  const validateIndices = (records, field, terminal) => {
    let previous = 0;
    for (const record of records) {
      if (record[field] < previous || record[field] > terminal) throw sf2Error(`Invalid ${field} index`);
      previous = record[field];
    }
    if (previous !== terminal) throw sf2Error(`Invalid terminal ${field} index`);
  };
  for (const [headerName, prefix] of [['phdr', 'p'], ['inst', 'i']]) {
    const bags = tables[`${prefix}bag`];
    validateIndices(tables[headerName], 'bag', bags.length - 1);
    validateIndices(bags, 'generator', tables[`${prefix}gen`].length - 1);
    validateIndices(bags, 'modulator', tables[`${prefix}mod`].length - 1);
  }
  return { format: version.major === 3 ? 'sf3' : 'sf2', version, info, tables, smplOffset: smpl.offset,
    smplBytes: smpl.length, sm24Bytes: sm24?.length || 0, sm24Offset, sampleFrames, metadataBytes,
    presets: tables.phdr.slice(0, -1).map((preset, index) => ({ ...preset, index })) };
}
