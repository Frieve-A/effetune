const text = value => Buffer.from(value, 'ascii');
const chunk = (name, data) => { const head = Buffer.alloc(8); head.write(name); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]); };
const list = (name, children) => chunk('LIST', Buffer.concat([text(name), ...children]));
const gen = (operator, amount) => { const b = Buffer.alloc(4); b.writeUInt16LE(operator); b.writeUInt16LE(amount & 65535, 2); return b; };
const bag = (generator, modulator = 0) => gen(generator, modulator);
const mod = (source, destination, amount, amountSource = 0, transform = 0) => {
  const b = Buffer.alloc(10); [source, destination, amount & 65535, amountSource, transform].forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b;
};
export function createSf2Fixture({ version = 4, sm24 = true, invalidIndex = false,
  presets = [{ name: 'Preset', bank: 0, program: 0 }], keyRange,
  sampleFrames = 64, sampleRate = 44100, loopStart = 8, loopEnd = 56, pcm16, modulators = [] } = {}) {
  const phdr = Buffer.alloc((presets.length + 1) * 38);
  presets.forEach((preset, index) => {
    const offset = index * 38;
    phdr.write(preset.name, offset, 20, 'ascii'); phdr.writeUInt16LE(preset.program, offset + 20);
    phdr.writeUInt16LE(preset.bank, offset + 22); phdr.writeUInt16LE(index * 2, offset + 24);
  });
  phdr.writeUInt16LE(presets.length * 2, presets.length * 38 + 24);
  const inst = Buffer.alloc(44); inst.write('Instrument'); inst.writeUInt16LE(2, 22 + 20);
  const shdr = Buffer.alloc(92); shdr.write('Sample'); shdr.writeUInt32LE(sampleFrames, 24); shdr.writeUInt32LE(loopStart, 28); shdr.writeUInt32LE(loopEnd, 32);
  shdr.writeUInt32LE(sampleRate, 36); shdr[40] = 60; shdr.writeUInt16LE(1, 44);
  const ifil = Buffer.from([2, 0, version, 0]);
  const tables = { phdr, pbag: Buffer.concat([...presets.flatMap((_, index) => [bag(index * 4), bag(index * 4 + 1)]),
    bag(presets.length * 4 + (invalidIndex ? 3 : 0))]),
    pmod: Buffer.alloc(10), pgen: Buffer.concat([...presets.flatMap(preset => [gen(48, 20),
      gen(43, keyRange ? keyRange[0] | keyRange[1] << 8 : 0x6440), gen(48, preset.attenuation ?? 40), gen(41, 0)]), gen(0, 0)]),
    inst, ibag: Buffer.concat([bag(0), bag(1, 1), bag(5, 2 + modulators.length)]),
    imod: Buffer.concat([mod(0x0502, 48, 100), mod(0x0502, 48, 0),
      ...modulators.map(value => mod(value.source, value.destination, value.amount, value.amountSource, value.transform)), Buffer.alloc(10)]),
    igen: Buffer.concat([gen(48, 70), gen(43, keyRange ? keyRange[0] | keyRange[1] << 8 : 0x5046),
      gen(48, 80), gen(54, 1), gen(53, 0), gen(0, 0)]), shdr };
  const sample = Buffer.alloc((sampleFrames + 46) * 2);
  if (pcm16) for (let frame = 0; frame < sampleFrames; frame++) sample.writeInt16LE(pcm16[frame], frame * 2);
  const data = [chunk('smpl', sample)]; if (sm24) data.push(chunk('sm24', Buffer.alloc(sampleFrames + 46)));
  return chunk('RIFF', Buffer.concat([text('sfbk'), list('INFO', [chunk('ifil', ifil), chunk('INAM', text('Test\0\0'))]),
    list('sdta', data), list('pdta', Object.entries(tables).map(([name, bytes]) => chunk(name, bytes)))]));
}

// Each key selects a distinct, long PCM waveform. Its loop begins beyond the
// first second so a sustained chord must keep fetching new pages.
export function createMultisampleSf2(keys, sampleFrames, {separatePrograms = false} = {}) {
  const programs = separatePrograms ? keys.length : 1;
  const phdr = Buffer.alloc((programs + 1) * 38), inst = Buffer.alloc((programs + 1) * 22);
  for (let i = 0; i < programs; i++) {
    phdr.write('Program ' + i, i * 38);
    phdr.writeUInt16LE(i, i * 38 + 20);
    phdr.writeUInt16LE(i, i * 38 + 24);
    inst.write('Key zones ' + i, i * 22);
    inst.writeUInt16LE(i, i * 22 + 20);
  }
  phdr.writeUInt16LE(programs, programs * 38 + 24);
  inst.writeUInt16LE(keys.length, programs * 22 + 20);
  const pcm = Buffer.alloc(keys.length * (sampleFrames + 46) * 2);
  const shdr = Buffer.alloc(46 * (keys.length + 1));
  const zones = [];
  keys.forEach((key, index) => {
    const start = index * (sampleFrames + 46), offset = index * 46;
    shdr.write('Key ' + key, offset);
    for (const [field, value] of [[20, start], [24, start + sampleFrames], [28, start + 65536],
      [32, start + sampleFrames - 64], [36, 48000]]) shdr.writeUInt32LE(value, offset + field);
    shdr[offset + 40] = key;
    shdr.writeUInt16LE(1, offset + 44);
    for (let frame = 0; frame < sampleFrames; ++frame)
      pcm.writeInt16LE(Math.round(4096 * Math.sin(frame * 2 * Math.PI / (40 + index * 3))), (start + frame) * 2);
    zones.push(gen(43, key | key << 8), gen(54, 1), gen(53, index));
  });
  const tables = { phdr, pbag: Buffer.concat(Array.from({length:programs + 1},(_,i) => bag(i))), pmod: Buffer.alloc(10),
    pgen: Buffer.concat([...Array.from({length:programs},(_,i) => gen(41, i)), gen(0, 0)]), inst,
    ibag: Buffer.concat(Array.from({ length: keys.length + 1 }, (_, i) => bag(i * 3))),
    imod: Buffer.alloc(10), igen: Buffer.concat([...zones, gen(0, 0)]), shdr };
  return chunk('RIFF', Buffer.concat([text('sfbk'), list('INFO', [chunk('ifil', Buffer.from([2, 0, 4, 0])),
    chunk('INAM', text('Polyphonic'))]), list('sdta', [chunk('smpl', pcm)]),
    list('pdta', Object.entries(tables).map(([name, bytes]) => chunk(name, bytes)))]));
}
