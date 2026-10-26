const SAMPLE_RATE = 44100;
const CHANNEL_COUNT = 2;
const MAX_PACKET_FRAMES = 4096;
const MAX_REORDER_PACKETS = 32;
const MAX_REORDER_FRAMES = 22050;
const MAX_GAP_FRAMES = 4410;
const REORDER_WAIT_MS = 40;

function parseL16RtpPacket(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > 65507 || bytes[0] >>> 6 !== 2 ||
      (bytes[1] & 127) !== 96) return null;
  let offset = 12 + (bytes[0] & 15) * 4;
  let end = bytes.length;
  if (offset > end) return null;
  if (bytes[0] & 16) {
    if (offset + 4 > end) return null;
    offset += 4 + bytes.readUInt16BE(offset + 2) * 4;
  }
  if (bytes[0] & 32) {
    const padding = bytes[end - 1];
    if (!padding || padding > end - offset) return null;
    end -= padding;
  }
  const length = end - offset;
  if (length <= 0 || length % 4 || length / 4 > MAX_PACKET_FRAMES) return null;
  return {
    sequence: bytes.readUInt16BE(2), timestamp: bytes.readUInt32BE(4), ssrc: bytes.readUInt32BE(8),
    frameCount: length / 4, payload: bytes.subarray(offset, end)
  };
}

class L16RtpReceiver {
  constructor({ onPcm, onReset = () => {}, onDiagnostic = () => {} } = {}) {
    this.onPcm = onPcm;
    this.onReset = onReset;
    this.onDiagnostic = onDiagnostic;
    this.reset();
  }

  reset() {
    this.ssrc = null;
    this.sequence = null;
    this.timestamp = null;
    this.packets = new Map();
    this.queuedFrames = 0;
    this.framePosition = 0;
    this.waitSince = null;
  }

  push(bytes, now = Date.now()) {
    const packet = parseL16RtpPacket(bytes);
    if (!packet) { this.onDiagnostic('invalid-rtp'); return false; }
    if (this.ssrc !== null && packet.ssrc !== this.ssrc) return false;
    if (this.ssrc === null) {
      this.ssrc = packet.ssrc;
      this.sequence = packet.sequence;
      this.timestamp = packet.timestamp;
    }
    const distance = (packet.sequence - this.sequence + 65536) % 65536;
    if (distance >= 32768 || this.packets.has(packet.sequence)) return false;
    if (distance >= MAX_REORDER_PACKETS || this.queuedFrames + packet.frameCount > MAX_REORDER_FRAMES) {
      this.packets.clear();
      this.queuedFrames = 0;
      this.sequence = packet.sequence;
      this.timestamp = packet.timestamp;
      this.onReset(this.framePosition);
      this.onDiagnostic('rtp-rebuffer');
    }
    // Keep a bounded copy: the UDP buffer cannot retain unrelated packet storage.
    packet.payload = Buffer.from(packet.payload);
    this.packets.set(packet.sequence, packet);
    this.queuedFrames += packet.frameCount;
    this.drain(now);
    return true;
  }

  flush(now = Date.now()) {
    if (!this.packets.size || this.waitSince === null || now - this.waitSince < REORDER_WAIT_MS) return;
    let closest;
    let distance = 65536;
    for (const packet of this.packets.values()) {
      const candidate = (packet.sequence - this.sequence + 65536) % 65536;
      if (candidate < distance) { distance = candidate; closest = packet; }
    }
    this.sequence = closest.sequence;
    this.onDiagnostic('rtp-packet-loss');
    this.drain(now);
  }

  drain(now) {
    let packet;
    while ((packet = this.packets.get(this.sequence))) {
      this.packets.delete(this.sequence);
      this.queuedFrames -= packet.frameCount;
      const gap = (packet.timestamp - this.timestamp) | 0;
      if (gap > 0 && gap <= MAX_GAP_FRAMES) {
        this.emit(gap, null);
      } else if (gap !== 0) {
        this.onReset(this.framePosition);
        this.onDiagnostic('rtp-clock-discontinuity');
      }
      this.emit(packet.frameCount, packet.payload);
      this.sequence = (packet.sequence + 1) & 65535;
      this.timestamp = (packet.timestamp + packet.frameCount) >>> 0;
    }
    this.waitSince = this.packets.size ? this.waitSince ?? now : null;
  }

  emit(frameCount, payload) {
    // Silence concealment is split into the same bounded frame size as data.
    for (let offset = 0; offset < frameCount; offset += MAX_PACKET_FRAMES) {
      const count = frameCount - offset < MAX_PACKET_FRAMES ? frameCount - offset : MAX_PACKET_FRAMES;
      const left = new Float32Array(count), right = new Float32Array(count);
      if (payload) for (let frame = 0; frame < count; frame += 1) {
        left[frame] = payload.readInt16BE((offset + frame) * 4) / 32768;
        right[frame] = payload.readInt16BE((offset + frame) * 4 + 2) / 32768;
      }
      this.onPcm({ startFrame: this.framePosition, frameCount: count, planes: [left.buffer, right.buffer] });
      this.framePosition += count;
    }
  }
}

module.exports = { SAMPLE_RATE, CHANNEL_COUNT, MAX_PACKET_FRAMES, MAX_REORDER_FRAMES,
  MAX_GAP_FRAMES, REORDER_WAIT_MS, parseL16RtpPacket, L16RtpReceiver };
