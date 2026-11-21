'use strict';

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024;
const VERSION = 1;
const UNSUPPORTED_CPU = 78;
const kinds = Object.freeze({ control: 1, feed: 2, telemetry: 3, network: 4 });

function encodeFrame(kind, message, attachment = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(message));
  const size = 5 + json.length + attachment.byteLength;
  if (size > MAX_FRAME_BYTES) throw new RangeError('Audio engine frame is too large');
  const bytes = Buffer.allocUnsafe(4 + size);
  bytes.writeUInt32LE(size, 0);
  bytes[4] = kind;
  bytes.writeUInt32LE(json.length, 5);
  bytes.set(json, 9);
  bytes.set(attachment, 9 + json.length);
  return bytes;
}

function *instrumentFrames(message, attachment) {
  if (attachment.byteLength > MAX_ATTACHMENT_BYTES) throw new RangeError('Instrument data is too large');
  for (let offset = 0; offset < attachment.byteLength; offset += CHUNK_BYTES) {
    yield encodeFrame(kinds.control,{type:'attachmentPart',offset,
      ...(offset === 0 && {byteLength:attachment.byteLength,message})},attachment.subarray(offset,offset + CHUNK_BYTES));
  }
}

function frameReader(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  let chunk = Buffer.alloc(0), offset = 0;
  async function read(length, allowEnd) {
    const bytes = Buffer.allocUnsafe(length);
    let copied = 0;
    while (copied < length) {
      if (offset === chunk.length) {
        const next = await iterator.next();
        if (next.done) {
          if (allowEnd && !copied) return null;
          throw new Error('Truncated audio engine frame');
        }
        chunk = next.value;
        offset = 0;
      }
      const count = Math.min(length - copied, chunk.length - offset);
      chunk.copy(bytes, copied, offset, offset + count);
      copied += count;
      offset += count;
    }
    return bytes;
  }
  async function next() {
    const prefix = await read(4, true);
    if (!prefix) return null;
    const length = prefix.readUInt32LE();
    if (length < 5 || length > MAX_FRAME_BYTES) throw new Error('Invalid audio engine frame length');
    const body = await read(length, false);
    const kind = body[0], end = 5 + body.readUInt32LE(1);
    if (kind < 1 || kind > 4 || end > body.length) throw new Error('Invalid audio engine frame header');
    const message = JSON.parse(body.toString('utf8', 5, end));
    if (!message || Array.isArray(message) || typeof message !== 'object') throw new Error('Invalid audio engine message');
    return { kind, message, attachment: body.subarray(end) };
  }
  return async () => {
    let part = await next();
    if (part?.message.type !== 'attachmentPart') return part;
    const {message,byteLength} = part.message;
    if (!['sfzCheckpoints','midiCheckpoints','sfzRuntimeStarted','soundFontMixerActionApplied',
      'midiTransport','sfzStartRuntime'].includes(message?.type) ||
        !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_ATTACHMENT_BYTES)
      throw new Error('Invalid instrument attachment');
    const attachment = Buffer.allocUnsafe(byteLength);
    let offset = 0;
    for (;;) {
      if (part?.kind !== kinds.control || part.message.type !== 'attachmentPart' || part.message.offset !== offset ||
          !part.attachment.length || part.attachment.length > byteLength-offset) throw new Error('Invalid instrument chunk');
      part.attachment.copy(attachment,offset);
      offset += part.attachment.length;
      if (offset === byteLength) return {kind:kinds.control,message,attachment};
      part = await next();
    }
  };
}

module.exports = { MAX_FRAME_BYTES, CHUNK_BYTES, VERSION, UNSUPPORTED_CPU, kinds, encodeFrame, frameReader, instrumentFrames };
