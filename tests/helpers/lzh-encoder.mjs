// Independent fixture writer. The bit stream, match search and prefix tables are built from source data.
class Writer {
  bytes = [];
  count = 0;
  write(value, width) {
    for (let i = width - 1; i >= 0; i--) {
      if ((this.count & 7) === 0) this.bytes.push(0);
      this.bytes[this.count >>> 3] |= ((value >>> i) & 1) << (7 - (this.count & 7));
      this.count++;
    }
  }
}

function greedyTokens(data, dictionary) {
  const tokens = [];
  for (let i = 0; i < data.length;) {
    let length = 2, distance;
    for (let j = i - 1; j >= Math.max(0, i - dictionary); j--) {
      let n = 0;
      while (n < 256 && i + n < data.length && data[j + n] === data[i + n]) n++;
      if (n > length) { length = n; distance = i - j; }
      if (n === 256) break;
    }
    if (distance) {
      const position = distance - 1;
      tokens.push({ char: length + 253, slot: position ? 32 - Math.clz32(position) : 0, position });
      i += length;
    } else tokens.push({ char: data[i++] });
  }
  return tokens;
}

function codebook(values) {
  const frequencies = new Map();
  for (const value of values) frequencies.set(value, (frequencies.get(value) || 0) + 1);
  if (frequencies.size <= 1) return { single: values[0] ?? 0, emit() {} };
  let lengths;
  for (let floor = 1; ; floor *= 2) {
    const nodes = [...frequencies].map(([symbol, weight]) => ({ symbols: [symbol], weight: Math.max(floor, weight) }));
    lengths = Array(Math.max(...frequencies.keys()) + 1).fill(0);
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.weight - b.weight);
      const [a, b] = nodes.splice(0, 2);
      const symbols = [...a.symbols, ...b.symbols];
      for (const symbol of symbols) lengths[symbol]++;
      nodes.push({ symbols, weight: a.weight + b.weight });
    }
    if (Math.max(...lengths) <= 16) break;
  }
  const codes = [];
  let next = 0;
  for (let depth = 1; depth <= 16; depth++) {
    next *= 2;
    lengths.forEach((length, i) => { if (length === depth) codes[i] = next++; });
  }
  return { lengths, emit(writer, symbol) { writer.write(codes[symbol], lengths[symbol]); } };
}

function writeDescription(writer, tree, width, temporary) {
  if (tree.single !== undefined) {
    writer.write(0, width);
    writer.write(tree.single, width);
    return;
  }
  writer.write(tree.lengths.length, width);
  tree.lengths.forEach((length, i) => {
    writer.write(Math.min(7, length), 3);
    if (length >= 7) {
      for (let j = 7; j < length; j++) writer.write(1, 1);
      writer.write(0, 1);
    }
    if (temporary && i === 2) writer.write(0, 2);
  });
}

function compress(data, method) {
  if (method === 'lh0') return data;
  const exponent = { lh4: 12, lh5: 13, lh6: 15, lh7: 16 }[method];
  const tokens = greedyTokens(data, 2 ** exponent), writer = new Writer();
  for (let offset = 0; offset < tokens.length; offset += 65535) {
    const block = tokens.slice(offset, offset + 65535);
    const characters = codebook(block.map(t => t.char)), positions = codebook(block.flatMap(t => t.slot === undefined ? [] : [t.slot]));
    // Encode a zero length with the one-zero symbol. No zero-run optimization is needed for fixtures.
    const description = (characters.lengths || []).map(n => n ? n + 2 : 0);
    const temporary = codebook(description);
    writer.write(block.length, 16);
    writeDescription(writer, temporary, 5, true);
    writer.write(description.length, 9);
    if (!description.length) writer.write(characters.single, 9);
    for (const symbol of description) temporary.emit(writer, symbol);
    writeDescription(writer, positions, exponent > 13 ? 5 : 4, false);
    for (const token of block) {
      characters.emit(writer, token.char);
      if (token.slot !== undefined) {
        positions.emit(writer, token.slot);
        if (token.slot > 1) writer.write(token.position, token.slot - 1);
      }
    }
  }
  return Buffer.from(writer.bytes);
}

function checksum(data) {
  let v = 0;
  for (const byte of data) for (let bit = 0; bit < 8; bit++) {
    const low = (v ^ (byte >> bit)) & 1;
    v >>>= 1;
    if (low) v ^= 40961;
  }
  return v;
}

export function lzh(entries, { method = 'lh5', level = 2 } = {}) {
  const result = [];
  for (const [label, value] of entries) {
    const data = Buffer.from(value), name = Buffer.from(label), packed = compress(data, method);
    const split = name.lastIndexOf(47);
    const base = level === 0 ? name : name.subarray(split + 1);
    const ext = [];
    if (level === 2) ext.push([0, Buffer.alloc(2)], [1, base]);
    if (level && split >= 0) ext.push([2, Buffer.from(name.subarray(0, split + 1)).map(c => c === 47 ? 255 : c)]);
    const extraSize = ext.reduce((n, [, bytes]) => n + 3 + bytes.length, 0);
    const basicSize = level === 2 ? 26 : 24 + base.length + (level === 1 ? 3 : 0);
    const header = Buffer.alloc(basicSize + extraSize);
    if (level === 2) header.writeUInt16LE(header.length);
    else header[0] = basicSize - 2;
    header.write('-' + method + '-', 2);
    header.writeUInt32LE(packed.length + (level === 1 ? extraSize : 0), 7);
    header.writeUInt32LE(data.length, 11);
    header[19] = 32;
    header[20] = level;
    if (level === 2) {
      header.writeUInt16LE(checksum(data), 21);
      header[23] = 85;
    } else {
      header[21] = base.length;
      base.copy(header, 22);
      header.writeUInt16LE(checksum(data), 22 + base.length);
      if (level === 1) header[24 + base.length] = 85;
    }
    let cursor = basicSize - 2;
    for (const [type, bytes] of ext) {
      header.writeUInt16LE(bytes.length + 3, cursor);
      header[cursor + 2] = type;
      bytes.copy(header, cursor + 3);
      cursor += bytes.length + 3;
    }
    if (level === 2) header.writeUInt16LE(checksum(header), 27);
    else header[1] = header.subarray(2, basicSize).reduce((sum, n) => sum + n, 0) & 255;
    result.push(header, packed);
  }
  return Buffer.concat([...result, Buffer.alloc(1)]);
}
