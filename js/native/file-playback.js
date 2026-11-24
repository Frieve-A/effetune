const MAX_FILE_FRAMES = 8192;
const FILE_WINDOW_BYTES = 256 * 1024;
const FILE_LOOKAHEAD_SECONDS = 2;
// Half of the native FileFifo ring (2 s of 384 kHz stereo) in interleaved samples, so the
// lookahead of a track with more channels still leaves room for the following track.
const FILE_LOOKAHEAD_SAMPLES = 384000 * FILE_LOOKAHEAD_SECONDS * 2;

export class NativeFilePlayback {
  constructor(manager) {
    this.manager = manager;
    this.generation = 0;
    this.track = 0;
    this.current = null;
    this.next = null;
    this.pending = [];
  }

  get available() { return Boolean(this.manager.filePort && !this.manager.failed); }

  send(type, entry, fields) {
    this.manager.filePort.postMessage({type,generation:entry.generation,track:entry.track,...fields});
  }

  start(transport, frame, {gain, fadeIn, nextAfter}) {
    if (!this.available || nextAfter &&
        (this.current?.transport !== nextAfter || this.current.endFrame != null || this.next)) return null;
    if (!nextAfter) {
      if (this.current) this.flush(this.current);
      this.generation++;
      this.pending.length = 0;
      this.pendingBytes = 0;
      this.sent = 0;
      this.written = 0;
      this.queued = 0;
      this.snapshot = null;
      this.track = 0;
    }
    const {sampleRate,channelCount} = transport.metadata;
    const entry = {transport,generation:this.generation,track:++this.track,sampleRate,channelCount,frame};
    if (nextAfter) this.next = entry;
    else this.current = entry;
    this.send(nextAfter ? 'fileNext' : 'fileStart',entry,{sampleRate,channelCount,gain,startFrame:frame,fadeIn});
    return entry;
  }

  sendPcm(entry, record, offset) {
    if (entry !== this.current && (entry !== this.next || !entry.accepted || !this.current?.endSent)) return 0;
    const {sampleRate,channelCount} = entry;
    const frameBytes = channelCount * Float32Array.BYTES_PER_ELEMENT;
    const frames = Math.min(MAX_FILE_FRAMES,record.frameCount - offset,
      Math.floor((FILE_WINDOW_BYTES - this.pendingBytes) / frameBytes),
      Math.min(sampleRate * FILE_LOOKAHEAD_SECONDS, Math.floor(FILE_LOOKAHEAD_SAMPLES / channelCount)) -
        this.queued - (this.sent - this.written));
    if (frames <= 0) return 0;
    const attachment = new Float32Array(frames * channelCount);
    for (let channel = 0; channel < channelCount; ++channel) {
      attachment.set(new Float32Array(record.planes[channel]).subarray(offset,offset + frames),channel * frames);
    }
    const frame = record.startFrame + offset;
    this.send('feed',entry,{stream:'file',sourceFrame:frame,sampleRate,channelCount,frames,attachment:attachment.buffer});
    this.sent += frames;
    this.pendingBytes += attachment.byteLength;
    this.pending.push({end:this.sent,bytes:attachment.byteLength});
    return frames;
  }

  end(entry, totalFrames) {
    if ((entry !== this.current && (entry !== this.next || !entry.accepted)) || entry.endSent) return;
    entry.endSent = true;
    this.send('fileEnd',entry,{totalFrames});
    if (entry === this.current) this.next?.transport.scheduleAvailable();
  }

  setGain(entry, gain) {
    if (entry && (entry === this.current || entry === this.next)) this.send('fileGain',entry,{gain});
  }

  flush(entry) {
    if (entry !== this.current) return;
    entry.frame = this.position(entry);
    entry.flushed = true;
    if (this.available) this.send('fileFlush',entry);
    this.current = null;
    this.next = null;
  }

  cancel(entry) {
    if (!entry || entry.generation !== this.generation || !this.available) return Promise.resolve('cancelled');
    if (entry === this.current) return Promise.resolve('already-playing');
    if (entry !== this.next) return Promise.resolve('cancelled');
    if (!entry.cancellation) {
      entry.cancellation = this.manager.waitFor('fileCancelNextResult',data =>
        data.generation === entry.generation && data.track === entry.track).then(({detail}) => {
        entry.cancellation = null;
        if (detail.result === 'cancelled' && this.next === entry) this.next = null;
        return detail.result;
      });
      this.send('fileCancelNext',entry);
    }
    return entry.cancellation;
  }

  reserveNext({generation, track, accepted}) {
    const entry = this.next;
    if (!entry || entry.generation !== generation || entry.track !== track) return;
    if (!accepted) {
      // A pending cancel still owns the reservation until its reply.
      if (!entry.cancellation) this.next = null;
      entry.transport.rejectNativeFileReservation(entry);
      return;
    }
    entry.accepted = true;
    entry.transport.scheduleAvailable();
  }

  position(entry) {
    if (!entry) return 0;
    if (entry.flushed) return entry.frame;
    const clock = this.snapshot;
    if (!clock || clock.fileTrack !== entry.track) return entry.frame;
    const older = (clock.pipelineFrame - (clock.filePipelineFrame ?? clock.pipelineFrame)) /
      (this.manager.audioContext?.sampleRate || entry.sampleRate) * 1000;
    const elapsed = clock.fileRunning ? Math.min(20,Math.max(0,performance.now() - clock.time + older)) : 0;
    return Math.floor(clock.fileReadFrame + elapsed * entry.sampleRate / 1000);
  }

  ended(data) {
    if (data.generation !== this.generation) return;
    const entry = [this.current,this.next].find(item => item?.track === data.track);
    if (!entry) return;
    entry.frame = entry.transport.metadata.totalFrames;
    entry.endFrame = data.pipelineFrame;
  }

  update(clock) {
    if (!this.current || clock.fileGeneration !== this.generation) return;
    this.snapshot = clock;
    while (this.pending[0]?.end <= clock.fileWrittenFrames) this.pendingBytes -= this.pending.shift().bytes;
    this.written = clock.fileWrittenFrames;
    this.queued = clock.fileQueuedFrames;
    const gaps = clock.fileGaps || 0;
    const overflows = clock.fileOverflows || 0;
    const underruns = clock.fileUnderruns || 0;
    if (underruns > (this.underruns || 0)) console.warn('Native file playback underruns:',underruns);
    this.underruns = underruns;
    if (gaps > (this.gaps || 0) || overflows > (this.overflows || 0)) {
      this.gaps = gaps;
      this.overflows = overflows;
      this.recover();
      return;
    }
    if (this.current.endFrame != null && (!this.next || this.next.accepted && !this.next.cancellation) &&
        this.audibleFrame(clock) >= this.current.endFrame) {
      const previous = this.current;
      this.current = this.next;
      this.next = null;
      previous.transport.publishEnded();
    }
    this.current?.transport.scheduleAvailable();
    this.next?.transport.scheduleAvailable();
  }

  audibleFrame(clock) {
    const context = this.manager.audioContext;
    if (!context) return clock.pipelineFrame;
    return clock.pipelineFrame - this.manager._getDeviceLatencyFrames(context) -
      this.manager.getTotalPipelineLatencySamples();
  }

  recover() {
    const current = this.current;
    if (!current) return;
    const frame = this.snapshot?.fileTrack === current.track ? this.snapshot.fileReadFrame : current.frame;
    current.transport.onNativeFileRecovery?.(frame);
  }
}
