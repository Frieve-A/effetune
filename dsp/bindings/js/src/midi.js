import { ValidationError } from './errors.js';

function requireRange(value, maximum, name) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new ValidationError(`${name} must be an integer from 0 to ${maximum}.`);
  }
  return value;
}

function message(status, channel, data1, data2) {
  return [status | requireRange(channel, 15, 'MIDI channel'), data1, data2];
}

export function noteOn(channel, note, velocity) {
  return message(0x90, channel, requireRange(note, 127, 'Note'), requireRange(velocity, 127, 'Velocity'));
}

export function noteOff(channel, note, velocity = 0) {
  return message(0x80, channel, requireRange(note, 127, 'Note'), requireRange(velocity, 127, 'Velocity'));
}

export function controlChange(channel, controller, value) {
  return message(0xb0, channel, requireRange(controller, 127, 'Controller'),
    requireRange(value, 127, 'Controller value'));
}

// value14 is the unsigned 14-bit bend value; 8192 is the centre.
export function pitchBend(channel, value14) {
  requireRange(value14, 16383, 'Pitch bend');
  return message(0xe0, channel, value14 & 0x7f, value14 >> 7);
}

export function programChange(channel, program) {
  return message(0xc0, channel, requireRange(program, 127, 'Program'), 0);
}

// Internal: validates one MIDI message from stream events or the worklet and
// returns it as [status, data1, data2], or null for a well-formed message that
// MIDI-driven effects do not use (polyphonic/channel pressure and system
// messages), so raw Web MIDI data can be passed through unchanged. A two-byte
// program change gets a zero data2.
export function normalizeMidiMessage(midi, label) {
  const bytes = Array.isArray(midi) || (ArrayBuffer.isView(midi) && !(midi instanceof DataView))
    ? Array.from(midi)
    : null;
  if (bytes === null || bytes.length === 0 ||
      !bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new ValidationError(`${label} midi must be an array of MIDI bytes: [status, data1, data2].`);
  }
  const status = bytes[0];
  if (status < 0x80) {
    throw new ValidationError(`${label} midi must start with a status byte from 0x80 to 0xFF.`);
  }
  if (status >= 0xf0) return null;
  const kind = status & 0xf0;
  const twoByte = kind === 0xc0 || kind === 0xd0;
  if (bytes.length !== 3 && !(twoByte && bytes.length === 2)) {
    throw new ValidationError(
      `${label} midi must have ${twoByte ? 'two or three' : 'three'} bytes for status ${status}.`
    );
  }
  if (bytes[1] > 127 || (bytes.length === 3 && bytes[2] > 127)) {
    throw new ValidationError(`${label} midi data bytes must be from 0 to 127.`);
  }
  if (kind === 0xa0 || kind === 0xd0) return null;
  return [status, bytes[1], bytes[2] ?? 0];
}
