import { MIDI_SYSTEM_RESET, MIDI_DRUM_MODE } from '../midi/smf-scheduler.js';

const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024;
const MIDI_EVENT_BYTES = 24;

export function packLiveMidi(message, nextSerial, toEngineFrame) {
  const {events,...wire} = message;
  const targeted = message.type === 'midiInputEvents';
  const size = targeted ? events.reduce((n,event) => n + 24 + 8 * event.targets.length,0) : events.length * 12;
  const attachment = new ArrayBuffer(size);
  const view = new DataView(attachment);
  let at = 0;
  for (const event of events) {
    const serial = targeted ? nextSerial() : event.noteId || 0;
    const flags = event.systemReset ? MIDI_SYSTEM_RESET : event.drumMode ? MIDI_DRUM_MODE : event.flags || 0;
    const note = event.systemReset || (flags === MIDI_SYSTEM_RESET ||
      ((event.status & 0xf0) === 0x90 && event.data2 > 0) ? serial : 0);
    const data = event.status | event.data1 << 8 | event.data2 << 16;
    view.setUint32(at,data,true);
    view.setUint32(at+4,flags,true);
    view.setUint32(at+8,note,true);
    at += 12;
    if (targeted) {
      view.setFloat64(at,toEngineFrame(event.frame),true);
      view.setUint32(at+8,event.targets.length,true);
      at += 12;
      for (const {id,token} of event.targets) {
        view.setUint32(at,id,true);
        view.setUint32(at+4,token,true);
        at += 8;
      }
    }
  }
  return {...wire,eventCount:events.length,attachment};
}

export function packInstrumentMessage(message) {
  const wire = {...message};
  const parts = [];
  let size = 0;
  const checkpoint = ({bytes,...metadata}) => {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_CHECKPOINT_BYTES)
      throw new RangeError('Invalid sampler checkpoint');
    const byteOffset = size;
    parts.push(bytes);
    size += bytes.byteLength;
    return {...metadata,byteOffset,byteLength:bytes.byteLength};
  };
  if (message.checkpoint) wire.checkpoint = checkpoint(message.checkpoint);
  if (message.checkpoints) wire.checkpoints = message.checkpoints.map(checkpoint);
  if (message.timeline) {
    const {duration,tempoMap = [],timeSignatures = [],events} = message.timeline;
    const tempoStart = events.length * MIDI_EVENT_BYTES;
    const meterStart = tempoStart + tempoMap.length * 20;
    const data = new Uint8Array(meterStart + timeSignatures.length * 24);
    const view = new DataView(data.buffer);
    for (const [index,event] of events.entries()) {
      const at = index * MIDI_EVENT_BYTES;
      view.setFloat64(at,event.seconds,true);
      view.setUint32(at+8,event.status,true);
      view.setUint32(at+12,event.data1,true);
      view.setUint32(at+16,event.data2 ?? 0,true);
      view.setUint16(at+20,event.systemReset || 0,true);
      view.setUint16(at+22,event.drumMode ? 1 : 0,true);
    }
    for (const [index,tempo] of tempoMap.entries()) {
      const at = tempoStart + 20 * index;
      view.setFloat64(at,tempo.seconds,true);
      view.setFloat64(at+8,tempo.quarter,true);
      view.setUint32(at+16,tempo.microsecondsPerQuarter,true);
    }
    for (const [index,meter] of timeSignatures.entries()) {
      const at = meterStart + 24 * index;
      view.setFloat64(at,meter.seconds,true);
      view.setFloat64(at+8,meter.quarter,true);
      view.setUint32(at+16,meter.numerator,true);
      view.setUint32(at+20,meter.denominator,true);
    }
    wire.timeline = {duration,eventsOffset:size,eventsCount:events.length,
      tempoOffset:size+tempoStart,tempoCount:tempoMap.length,meterOffset:size+meterStart,meterCount:timeSignatures.length};
    parts.push(data);
    size += data.byteLength;
  }
  if (parts.length === 1 && parts[0].byteOffset === 0 && parts[0].buffer.byteLength === size) {
    wire.attachment = parts[0].buffer;
  } else if (size) {
    const attachment = new Uint8Array(size);
    let start = 0;
    for (const part of parts) { attachment.set(part,start); start += part.byteLength; }
    wire.attachment = attachment.buffer;
  }
  return wire;
}

export function unpackCheckpoints(message) {
  const {attachment,...wire} = message;
  wire.checkpoints = message.checkpoints.map(({byteOffset,byteLength,...record}) => {
    if (!(attachment instanceof ArrayBuffer) || !Number.isSafeInteger(byteOffset) || byteOffset < 0 ||
        !Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_CHECKPOINT_BYTES ||
        byteLength > attachment.byteLength - byteOffset) throw new RangeError('Invalid sampler checkpoint');
    return {...record,bytes:new Uint8Array(attachment,byteOffset,byteLength)};
  });
  return wire;
}
