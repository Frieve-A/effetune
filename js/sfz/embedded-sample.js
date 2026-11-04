// Byte encoding published at https://sfzformat.com/headers/sample/.
// This implementation is authored independently from its linked encoder code.
export function embeddedSfzRanges(text) {
  const ranges = [];
  let quote = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"') quote = !quote;
    if (quote) continue;
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index + 2); index = end < 0 ? text.length : end; continue;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2); index = end < 0 ? text.length : end + 1; continue;
    }
    if (text[index] !== '<' || text.slice(index, index + 8).toLowerCase() !== '<sample>') continue;
    const header = /^<sample>\s+name\s*=\s*("[^"]*"|[^<>\r\n]+?)\s+data\s*=/i.exec(text.slice(index));
    if (!header) continue;
    const dataStart = index + header[0].length, end = text.indexOf('$', dataStart);
    if (end < 0) throw Object.assign(new Error('An embedded instrument sample is incomplete.'), { code: 'prepare' });
    ranges.push({ start: index, dataStart, end: end + 1 });
    index = end;
  }
  return ranges;
}

export function decodeEmbeddedSfzSample(encoded, maxBytes) {
  // The encoded payload is never larger than its bounded source definition.
  const bytes = new Uint8Array(Math.min(encoded.length, maxBytes));
  let length = 0;
  for (let index = 0; index < encoded.length; index++) {
    let value = encoded.charCodeAt(index);
    if (value === 36) return bytes.slice(0, length);
    if (value === 13 || value === 10) continue;
    if (value > 255 || length >= maxBytes) throw Object.assign(new Error('An embedded instrument sample could not be decoded.'), { code: 'prepare' });
    if (value === 61) {
      value = encoded.charCodeAt(++index);
      if (!Number.isInteger(value) || value > 255 || value === 36) throw Object.assign(new Error('An embedded instrument sample is incomplete.'), { code: 'prepare' });
      bytes[length++] = (value + 192) & 255;
    } else bytes[length++] = (value + 214) & 255;
  }
  throw Object.assign(new Error('An embedded instrument sample is incomplete.'), { code: 'prepare' });
}
