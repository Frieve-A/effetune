import {
  cloneRollingCandidateSource,
  getRollingPcmProfile,
  hasResidentCanonicalSource,
  RollingPcmAdmissionLedger,
  ROLLING_COMPRESSED_SOURCE_BYTE_CAP,
  ROLLING_PCM_LIVE_MEMORY_CATEGORIES,
  ROLLING_PCM_PROTOCOL_VERSION
} from './rolling-pcm-policy.js';
import {
  createRollingPcmEnvelope,
  RollingPcmCommand,
  RollingPcmEvent,
  validateRollingPcmEnvelope,
  validateRollingPcmFragment,
  validateRollingPcmSlab
} from './rolling-pcm-protocol.js';
import {
  normalizePcm16WaveFillTarget,
  normalizePcm16WaveSeekFrame,
  PCM16_STEREO_44100_TO_96000_PROFILE,
  planPcm16WaveFragment,
  sourceToOutputFrames
} from './rolling-pcm-core.js';

const DEFAULT_WORKER_URL = new URL('../../vendor/rolling-pcm-decoder-worker.mjs', import.meta.url);
const DISPOSE_TIMEOUT_MS = 1000;
let transportSequence = 0;

export class RollingPcmTransport {
  constructor(audioContext, {
    workerFactory = url => new Worker(url, { type: 'module' }),
    workerUrl = DEFAULT_WORKER_URL,
    profileId,
    channelCountHint = 2,
    reservationLedger = null,
    reservationRole = 'candidate',
    preparationOwner = null,
    sourceReacquirer = null,
    onEnded = null,
    onFailure = null
  } = {}) {
    if (!audioContext || typeof audioContext.createGain !== 'function' ||
        typeof audioContext.createBuffer !== 'function' ||
        typeof audioContext.createBufferSource !== 'function') {
      throw new TypeError('RollingPcmTransport requires an AudioContext');
    }
    this.audioContext = audioContext;
    this.workerFactory = workerFactory;
    this.workerUrl = workerUrl;
    this.profileId = profileId;
    this.channelCountHint = channelCountHint;
    this.profile = getRollingPcmProfile(
      audioContext.sampleRate,
      channelCountHint,
      profileId
    );
    if (!this.profile) throw new RangeError('No rolling PCM memory profile matches this context');
    // Admission is intentionally conservative until READY supplies the real channel count.
    this.reservationProfile = this.profile;
    this.onEnded = typeof onEnded === 'function' ? onEnded : null;
    this.onFailure = typeof onFailure === 'function' ? onFailure : null;
    this.reservationLedger = reservationLedger instanceof RollingPcmAdmissionLedger
      ? reservationLedger
      : new RollingPcmAdmissionLedger();
    this.reservationRole = reservationRole;
    this.preparationOwner = preparationOwner;
    this.sourceReacquirer = typeof sourceReacquirer === 'function' ? sourceReacquirer : null;
    this.reservationOwner = Object.freeze({ transportId: `reservation-${transportSequence + 1}` });
    this.reservationHeld = false;
    this.transportId = `rolling-pcm-${++transportSequence}`;
    this.segmentId = 'current';
    this.generation = 0;
    this.bus = audioContext.createGain();
    this.bus.gain.value = 1;
    this.worker = null;
    this.metadata = null;
    this.queue = [];
    this.scheduled = new Set();
    this.waiters = new Set();
    this.playing = false;
    this.prepared = false;
    this.disposed = false;
    this.disposing = false;
    this.disposePromise = null;
    this.cleanupBarrier = Promise.resolve();
    this.failed = false;
    this.terminalGeneration = null;
    this.failureCleanupPromise = null;
    this.seekSequence = 0;
    this.pendingSeek = null;
    this.sourceSnapshot = null;
    this.decoderContract = null;
    this.decoderEnded = false;
    this.positionFrame = 0;
    this.anchorFrame = 0;
    this.anchorContextTime = 0;
    this.lastReceivedFrame = 0;
    this.lastSlabId = 0;
    this.lastFillTarget = 0;
    this.nodeGeneration = 0;
    this.endPublished = false;
    this.diagnostics = {
      protocolVersion: ROLLING_PCM_PROTOCOL_VERSION,
      maxLivePcmBytes: 0,
      livePcmBytes: 0,
      liveAudioBuffers: 0,
      liveSourceNodes: 0,
      maxLiveSourceNodes: 0,
      liveWorkers: 0,
      liveHandlers: 0,
      liveTimers: 0,
      liveObjectUrls: 0,
      liveFragmentInputBytes: 0,
      maxFragmentInputBytes: 0,
      maxFragmentDecodedPcmBytes: 0,
      staleMessages: 0,
      underruns: 0,
      disposeCount: 0,
      terminateCount: 0
    };
  }

  get sourceNode() {
    return this.bus;
  }

  async prepare(snapshot, {
    segmentId = 'current',
    minimumHeadFrames = null,
    startFrame = null,
    startTimeSec = null,
    outputSampleRate = null,
    decoderProfile = null,
    resamplerProfile = null,
    sourceOverride = null
  } = {}) {
    if (this.disposed) throw new Error('Rolling PCM transport is disposed');
    if (this.prepared) return this.metadata;
    if (!Number.isSafeInteger(snapshot?.byteLength) || snapshot.byteLength < 0 ||
        snapshot.byteLength > ROLLING_COMPRESSED_SOURCE_BYTE_CAP) {
      throw codedError('compressed-source-budget');
    }
    const requestedDecoderContract = outputSampleRate !== null || decoderProfile !== null ||
      resamplerProfile !== null;
    const decoderContract = requestedDecoderContract
      ? normalizeDecoderContract({ outputSampleRate, decoderProfile, resamplerProfile })
      : null;
    if (requestedDecoderContract && !decoderContract) {
      throw codedError('partial-decode-profile-unsupported');
    }
    if (decoderContract && decoderContract.outputSampleRate !== this.audioContext.sampleRate) {
      throw codedError('decoded-format-ineligible');
    }
    const reservedPcmBytes = this.reservationRole === 'next'
      ? this.profile.nextPcmByteCap
      : this.profile.currentPcmByteCap;
    // Only a canonical snapshot that keeps its own compressed bytes alive overlaps with the
    // candidate copy. A path-backed snapshot re-reads the file and transfers it to the worker,
    // so the peak is one copy and charging a second one would reject admissible tracks.
    const canonicalCompressedBytes = hasResidentCanonicalSource(snapshot) ? snapshot.byteLength : 0;
    if (!this.reservationLedger.reserve(this.reservationOwner, this.reservationRole, {
      canonicalIdentity: snapshot.canonicalIdentity ?? snapshot,
      canonicalCompressedBytes,
      workerCompressedBytes: snapshot.byteLength,
      pcmBytes: reservedPcmBytes,
      inFlightBytes: this.profile.slabFrames * this.channelCountHint *
        Float32Array.BYTES_PER_ELEMENT
    }, this.reservationProfile)) {
      throw codedError('rolling-admission-rejected');
    }
    this.reservationHeld = true;
    let source;
    try {
      source = sourceOverride === null
        ? await acquireRollingCandidateSource(snapshot, this.sourceReacquirer)
        : takeRollingCandidateSourceOverride(snapshot, sourceOverride);
    } catch (error) {
      this.releaseReservation();
      throw error;
    }
    if (this.disposed || this.disposing) {
      this.releaseReservation();
      throw codedError('transport-disposed');
    }
    if (!source) {
      this.releaseReservation();
      throw codedError('canonical-source-ineligible');
    }
    if (decoderContract && source.kind !== 'bytes') {
      this.releaseReservation();
      throw codedError('canonical-source-ineligible');
    }
    this.decoderContract = decoderContract;
    this.sourceSnapshot = snapshot;
    this.segmentId = String(segmentId || 'current');
    this.generation++;
    const ids = this.ids();
    let worker;
    try {
      worker = this.workerFactory(this.workerUrl);
    } catch (error) {
      await this.dispose();
      throw error;
    }
    if (!worker || typeof worker.postMessage !== 'function') {
      await this.dispose();
      throw codedError('worker-unavailable');
    }
    this.worker = worker;
    worker.onmessage = event => this.handleWorkerMessage(event.data);
    worker.onerror = event => {
      event?.preventDefault?.();
      this.fail('worker-crashed');
    };
    this.diagnostics.liveWorkers = 1;
    this.diagnostics.liveHandlers = 2;
    const ready = this.waitFor(message => message.type === RollingPcmEvent.READY);
    const open = createRollingPcmEnvelope(RollingPcmCommand.OPEN, ids, {
      sourceKind: source.kind,
      source: source.kind === 'blob' ? source.blob : source.bytes,
      slabFrames: this.profile.slabFrames,
      freePoolPerSizeClass: this.profile.freePoolPerSizeClass,
      ...(decoderContract ?? {})
    });
    try {
      worker.postMessage(open, source.kind === 'bytes' ? [source.bytes] : []);
      if (source.reacquired === true &&
          !this.reservationLedger.transferSourceOwnership(
            this.reservationOwner,
            this.reservationProfile
          )) {
        throw codedError('rolling-source-transfer-invalid');
      }
    } catch (error) {
      await this.dispose();
      throw error;
    }
    let readyMessage;
    try {
      readyMessage = await ready;
    } catch (error) {
      await this.dispose();
      throw error;
    }
    if (!isValidReadyMessage(readyMessage, decoderContract) ||
        (decoderContract && readyMessage.sourceByteLength !== snapshot.byteLength)) {
      await this.dispose();
      throw codedError('metadata-invalid');
    }
    this.metadata = Object.freeze({
      sampleRate: readyMessage.sampleRate,
      sourceSampleRate: readyMessage.sourceSampleRate ?? readyMessage.sampleRate,
      outputSampleRate: readyMessage.outputSampleRate ?? readyMessage.sampleRate,
      channelCount: readyMessage.channelCount,
      durationSec: readyMessage.durationSec,
      sourceTotalFrames: readyMessage.sourceTotalFrames ?? readyMessage.totalFrames,
      totalFrames: readyMessage.totalFrames,
      containerMimeType: readyMessage.containerMimeType,
      codec: readyMessage.codec,
      decoderConfigCodec: readyMessage.decoderConfigCodec,
      decoderConfigVerified: readyMessage.decoderConfigVerified,
      sourceByteLength: readyMessage.sourceByteLength ?? null,
      workerCompressedBytes: readyMessage.workerCompressedBytes ?? null,
      dataOffset: readyMessage.dataOffset ?? null,
      dataByteLength: readyMessage.dataByteLength ?? null,
      bitsPerSample: readyMessage.bitsPerSample ?? null,
      blockAlign: readyMessage.blockAlign ?? null,
      decoderProfile: readyMessage.decoderProfile ?? null,
      resamplerProfile: readyMessage.resamplerProfile ?? null
    });
    if (this.metadata.sampleRate !== this.audioContext.sampleRate ||
        this.metadata.channelCount < 1 || this.metadata.channelCount > 2) {
      await this.dispose();
      throw codedError('decoded-format-ineligible');
    }
    const actualProfile = getRollingPcmProfile(
      this.metadata.sampleRate,
      this.metadata.channelCount,
      this.profile.id
    );
    if (!actualProfile) {
      await this.dispose();
      throw codedError('memory-profile-unavailable');
    }
    this.profile = actualProfile;
    let initialFrame = Number.isSafeInteger(startFrame)
      ? startFrame
      : Number.isFinite(startTimeSec)
        ? Math.round(Math.max(0, Math.min(startTimeSec, this.metadata.durationSec)) *
          this.metadata.sampleRate)
        : 0;
    if (!Number.isSafeInteger(initialFrame) || initialFrame < 0 ||
        initialFrame > this.metadata.totalFrames) {
      await this.dispose();
      throw codedError('seek-frame-invalid');
    }
    try {
      if (initialFrame > 0) {
        const normalizedSeek = decoderContract
          ? normalizePcm16WaveSeekFrame(
              initialFrame,
              this.metadata.sourceTotalFrames
            )
          : null;
        if (decoderContract && !normalizedSeek) throw codedError('seek-frame-invalid');
        this.generation++;
        const adoptedFrame = normalizedSeek?.adoptedOutputFrame ?? initialFrame;
        this.positionFrame = adoptedFrame;
        this.lastReceivedFrame = adoptedFrame;
        this.lastSlabId = 0;
        this.lastFillTarget = adoptedFrame;
        this.decoderEnded = adoptedFrame === this.metadata.totalFrames;
        const seekReady = this.waitFor(message => message.type === RollingPcmEvent.QUEUE_STATE &&
          message.sentFrame === adoptedFrame && (!decoderContract ||
            (message.requestedFrame === initialFrame &&
              message.sourceFrame === normalizedSeek.sourceFrame &&
              message.adoptedFrame === adoptedFrame)));
        this.post(RollingPcmCommand.SEEK, { frame: initialFrame });
        await seekReady;
        initialFrame = adoptedFrame;
      }
      const headFrames = Number.isSafeInteger(minimumHeadFrames)
        ? minimumHeadFrames
        : this.profile.nextMinimumHeadFrames;
      const initialTargetFrame = checkedFrameTarget(
        initialFrame,
        headFrames,
        this.metadata.totalFrames
      );
      if (initialTargetFrame === null) throw codedError('fill-target-invalid');
      await this.fillTo(initialTargetFrame);
      if (this.lastReceivedFrame < initialTargetFrame) {
        throw codedError('minimum-head-not-resident');
      }
    } catch (error) {
      await this.dispose();
      throw error;
    }
    this.prepared = true;
    return this.metadata;
  }

  connect(destination) {
    this.bus.connect(destination);
    return this;
  }

  disconnect() {
    try { this.bus.disconnect(); } catch (_) { /* already disconnected */ }
  }

  activate({ when = this.audioContext.currentTime, frame = this.positionFrame } = {}) {
    if (!this.prepared || this.disposed || this.failed || !this.metadata) return false;
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > this.metadata.totalFrames ||
        !Number.isFinite(when)) return false;
    if (this.playing) return true;
    this.positionFrame = frame;
    this.anchorFrame = frame;
    this.anchorContextTime = when;
    this.playing = true;
    this.endPublished = false;
    this.scheduleAvailable();
    this.requestAhead();
    if (frame === this.metadata.totalFrames) this.publishEnded();
    return true;
  }

  pause() {
    if (this.disposed || this.failed) return false;
    this.seekSequence++;
    void this.cancelPendingSeek();
    const frame = this.getPositionFrame();
    this.playing = false;
    this.positionFrame = frame;
    this.anchorFrame = frame;
    this.anchorContextTime = this.audioContext.currentTime;
    this.stopScheduledNodes({ retainFromFrame: frame });
    return true;
  }

  async stop() {
    if (this.disposed) return;
    this.playing = false;
    this.positionFrame = 0;
    await this.dispose();
  }

  async seek(frame, { resume = this.playing } = {}) {
    if (!this.metadata || this.disposed || this.failed) return false;
    const target = Number.isFinite(frame)
      ? Math.max(0, Math.min(Math.round(frame), this.metadata.totalFrames))
      : 0;
    const operationId = ++this.seekSequence;
    await this.cancelPendingSeek();
    await this.waitForCleanupBarrier();
    if (operationId !== this.seekSequence || this.disposed || this.failed) return false;
    const candidate = new RollingPcmTransport(this.audioContext, {
      workerFactory: this.workerFactory,
      workerUrl: this.workerUrl,
      profileId: this.profile.id,
      channelCountHint: this.metadata.channelCount,
      reservationLedger: this.reservationLedger,
      reservationRole: 'candidate',
      sourceReacquirer: this.sourceReacquirer
    });
    this.pendingSeek = { operationId, candidate };
    try {
      await candidate.prepare(this.sourceSnapshot, {
        segmentId: `seek-${operationId}`,
        minimumHeadFrames: this.profile.nextMinimumHeadFrames,
        startFrame: target,
        ...(this.decoderContract ?? {})
      });
      if (this.pendingSeek?.operationId !== operationId || this.disposed || this.failed ||
          candidate.failed || !candidate.prepared) {
        await candidate.dispose();
        return false;
      }
      if (!candidate.promoteReservation(this)) {
        await candidate.dispose();
        return false;
      }
      this.pendingSeek = null;
      const adoptedFrame = candidate.positionFrame;
      this.adoptPreparedSeekCandidate(candidate, adoptedFrame);
      if (resume === true && !this.activate({ frame: adoptedFrame })) return false;
      return Object.freeze({ adoptedFrame });
    } catch (error) {
      await candidate.dispose();
      return false;
    } finally {
      // Single exit for the reservation this call owns: every failing branch
      // disposes the candidate, so a surviving pendingSeek would pin a disposed
      // transport and block the gapless transition gate until the next seek.
      if (this.pendingSeek?.operationId === operationId) this.pendingSeek = null;
    }
  }

  getPositionFrame() {
    if (!this.metadata) return 0;
    if (!this.playing) return this.positionFrame;
    const elapsedFrames = Math.floor(
      (this.audioContext.currentTime - this.anchorContextTime) * this.metadata.sampleRate
    );
    return Math.max(this.anchorFrame, Math.min(
      this.anchorFrame + elapsedFrames,
      this.metadata.totalFrames
    ));
  }

  get currentTime() {
    return this.metadata ? this.getPositionFrame() / this.metadata.sampleRate : 0;
  }

  dispose() {
    if (this.disposed) return Promise.resolve();
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.performDispose();
    return this.disposePromise;
  }

  async performDispose() {
    this.disposing = true;
    this.seekSequence++;
    const pendingSeekCleanup = this.cancelPendingSeek();
    this.playing = false;
    if (this.terminalGeneration === null) this.terminalGeneration = ++this.generation;
    else this.generation = this.terminalGeneration;
    this.stopScheduledNodes();
    this.releaseQueuedBuffers();
    this.rejectWaiters(codedError('transport-disposed'));
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      let disposedAck = null;
      try {
        disposedAck = this.waitFor(
          message => message.type === RollingPcmEvent.DISPOSED,
          DISPOSE_TIMEOUT_MS
        );
        worker.postMessage(createRollingPcmEnvelope(
          RollingPcmCommand.DISPOSE,
          this.ids()
        ));
        await disposedAck;
      } catch (_) {
        this.diagnostics.terminateCount++;
      } finally {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate?.();
        this.diagnostics.liveHandlers = 0;
        this.diagnostics.liveWorkers = 0;
      }
    }
    await pendingSeekCleanup;
    await this.waitForCleanupBarrier();
    this.disconnect();
    this.bus = null;
    this.sourceSnapshot = null;
    this.sourceReacquirer = null;
    this.decoderContract = null;
    this.diagnostics.liveFragmentInputBytes = 0;
    this.preparationOwner = null;
    this.onEnded = null;
    this.onFailure = null;
    this.prepared = false;
    this.disposed = true;
    this.disposing = false;
    this.diagnostics.disposeCount++;
    this.releaseReservation();
  }

  getDiagnosticSnapshot() {
    return Object.freeze({
      ...this.diagnostics,
      inFlightBytes: this.diagnostics.liveFragmentInputBytes,
      liveMemoryCategories: this.getLiveMemoryCategories(),
      queuedAudioBuffers: this.queue.length,
      scheduledSourceNodes: this.scheduled.size,
      generation: this.generation,
      prepared: this.prepared,
      playing: this.playing,
      failed: this.failed
    });
  }

  getLiveMemoryCategories() {
    const categories = Object.fromEntries(
      ROLLING_PCM_LIVE_MEMORY_CATEGORIES.map(key => [key, 0])
    );
    const reservation = this.reservationLedger.entries.get(this.reservationOwner);
    categories.canonicalCompressedBytes = reservation?.canonicalCompressedBytes ?? 0;
    categories.workerCompressedBytes = this.diagnostics.liveWorkers > 0
      ? (this.metadata?.workerCompressedBytes ?? 0)
      : 0;
    categories.mainStagingSlabBytes = this.diagnostics.liveFragmentInputBytes;
    const queuedBytes = this.queue.reduce(
      (total, record) => total + (record.released ? 0 : record.bytes),
      0
    );
    const scheduledBytes = [...this.scheduled].reduce(
      (total, scheduled) => total + (scheduled.released ? 0 : scheduled.record.bytes),
      0
    );
    if (this.reservationRole === 'next') {
      categories.preparedNextAudioBufferBytes = queuedBytes + scheduledBytes;
    } else if (this.reservationLedger.getRole(this.reservationOwner) === 'retired') {
      categories.retiredCleanupPendingBytes = queuedBytes + scheduledBytes;
    } else {
      categories.queuedAudioBufferBytes = queuedBytes;
      categories.scheduledAudioBufferBytes = scheduledBytes;
    }
    return Object.freeze(categories);
  }

  handleWorkerMessage(message) {
    // While failing or disposing only the DISPOSED acknowledgement matters; a
    // Worker ERROR raised by its own teardown must not turn dispose into fail().
    if (this.disposed ||
        ((this.failed || this.disposing) && message?.type !== RollingPcmEvent.DISPOSED)) return;
    if (!validateRollingPcmEnvelope(message, {
      expectedTransportId: this.transportId,
      expectedGeneration: this.generation,
      expectedSegmentId: this.segmentId
    })) {
      this.diagnostics.staleMessages++;
      return;
    }
    if (message.type === RollingPcmEvent.ERROR) {
      this.fail(typeof message.code === 'string' ? message.code : 'decoder-failed');
      return;
    }
    if (message.type === RollingPcmEvent.FRAGMENT) {
      void this.acceptFragment(message);
      return;
    }
    if (message.type === RollingPcmEvent.SLAB) {
      if (this.decoderContract) {
        this.fail('fragment-protocol-invalid');
        return;
      }
      if (!validateRollingPcmSlab(message, {
        expectedTransportId: this.transportId,
        expectedGeneration: this.generation,
        expectedSegmentId: this.segmentId,
        maxFrames: this.profile.slabFrames
      }) || message.slabId !== this.lastSlabId + 1 ||
          message.startFrame !== this.lastReceivedFrame || !this.metadata ||
          message.channelCount !== this.metadata.channelCount) {
        this.fail('slab-protocol-invalid');
        return;
      }
      this.acceptSlab(message);
    } else if (message.type === RollingPcmEvent.SEGMENT_END) {
      if (!Number.isSafeInteger(message.totalFrames) ||
          message.totalFrames !== this.metadata?.totalFrames) {
        this.fail('segment-length-mismatch');
        return;
      }
      this.decoderEnded = true;
      if (this.playing && this.scheduled.size === 0 && this.queue.length === 0) {
        if (this.getPositionFrame() >= message.totalFrames) this.publishEnded();
        else this.fail('underrun');
      }
    } else if (message.type === RollingPcmEvent.QUEUE_STATE) {
      const invalidSentFrame = this.decoderContract
        ? message.sentFrame > this.lastReceivedFrame
        : message.sentFrame !== this.lastReceivedFrame;
      if (!Number.isSafeInteger(message.sentFrame) || message.sentFrame < 0) {
        this.fail('queue-state-frame-invalid');
        return;
      }
      if (invalidSentFrame) {
        this.fail('queue-state-frame-mismatch');
        return;
      }
      if (typeof message.ended !== 'boolean') {
        this.fail('queue-state-ended-invalid');
        return;
      }
      if (this.playing && this.scheduled.size === 0 && this.queue.length === 0 &&
          !this.decoderEnded) {
        this.fail('underrun');
        return;
      }
    }
    this.resolveWaiters(message);
  }

  async acceptFragment(message) {
    const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
    const plan = this.metadata ? planPcm16WaveFragment({
      sourceTotalFrames: this.metadata.sourceTotalFrames,
      outputStartFrame: message.outputStartFrame,
      outputFrameCount: message.outputFrameCount,
      profile
    }) : null;
    if (!this.decoderContract || !plan ||
        !validateRollingPcmFragment(message, {
          expectedTransportId: this.transportId,
          expectedGeneration: this.generation,
          expectedSegmentId: this.segmentId,
          maxFragmentBytes: profile.maxFragmentByteLength,
          maxOutputFrames: profile.logicalOutputFrames
        }) || message.fragmentId !== this.lastSlabId + 1 ||
        message.outputStartFrame !== this.lastReceivedFrame ||
        message.sourceSampleRate !== profile.sourceSampleRate ||
        message.outputSampleRate !== profile.outputSampleRate ||
        message.channelCount !== profile.channelCount ||
        message.decoderProfile !== profile.codec ||
        message.resamplerProfile !== profile.id ||
        !sameFragmentPlan(message, plan)) {
      this.fail('fragment-protocol-invalid');
      return;
    }
    const acceptedIds = this.ids();
    const inputBytes = message.fragmentBytes.byteLength;
    this.diagnostics.liveFragmentInputBytes = inputBytes;
    if (inputBytes > this.diagnostics.maxFragmentInputBytes) {
      this.diagnostics.maxFragmentInputBytes = inputBytes;
    }
    try {
      const decoded = await decodeAudioData(this.audioContext, message.fragmentBytes);
      if (!this.matchesIds(acceptedIds) || this.disposed || this.failed) {
        // Once the ids moved on (seek adoption, fail, dispose) the staging
        // counter already belongs to the successor generation; only a result
        // that is still ours may release it.
        if (this.matchesIds(acceptedIds)) this.diagnostics.liveFragmentInputBytes = 0;
        return;
      }
      const decodedBytes = decoded?.length * decoded?.numberOfChannels *
        Float32Array.BYTES_PER_ELEMENT;
      if (!decoded || decoded.sampleRate !== profile.outputSampleRate ||
          decoded.numberOfChannels !== profile.channelCount ||
          decoded.length !== message.decodedOutputFrameCount ||
          !Number.isSafeInteger(decodedBytes) || decodedBytes > profile.maxDecodedPcmBytes ||
          message.cropStartFrame + message.outputFrameCount > decoded.length) {
        throw codedError('fragment-decode-invalid');
      }
      if (decodedBytes > this.diagnostics.maxFragmentDecodedPcmBytes) {
        this.diagnostics.maxFragmentDecodedPcmBytes = decodedBytes;
      }
      const audioBuffer = this.audioContext.createBuffer(
        profile.channelCount,
        message.outputFrameCount,
        profile.outputSampleRate
      );
      for (let channel = 0; channel < profile.channelCount; channel += 1) {
        audioBuffer.copyToChannel(decoded.getChannelData(channel).subarray(
          message.cropStartFrame,
          message.cropStartFrame + message.outputFrameCount
        ), channel);
      }
      const bytes = message.outputFrameCount * profile.channelCount *
        Float32Array.BYTES_PER_ELEMENT;
      this.queue.push({
        audioBuffer,
        startFrame: message.outputStartFrame,
        frameCount: message.outputFrameCount,
        bytes
      });
      this.lastSlabId = message.fragmentId;
      this.lastReceivedFrame += message.outputFrameCount;
      this.diagnostics.liveAudioBuffers++;
      this.diagnostics.livePcmBytes += bytes;
      if (this.diagnostics.livePcmBytes > this.diagnostics.maxLivePcmBytes) {
        this.diagnostics.maxLivePcmBytes = this.diagnostics.livePcmBytes;
      }
      this.diagnostics.liveFragmentInputBytes = 0;
      this.post(RollingPcmCommand.RECYCLE, {
        fragmentId: message.fragmentId,
        fragmentToken: message.fragmentToken
      });
      const pcmByteCap = this.reservationRole === 'next'
        ? this.profile.nextPcmByteCap
        : this.profile.currentPcmByteCap;
      if (this.diagnostics.livePcmBytes > pcmByteCap) {
        this.fail('pcm-budget-exceeded');
        return;
      }
      if (this.playing) this.scheduleAvailable();
      this.resolveWaiters(message);
    } catch (error) {
      // A decode that fails after its generation was replaced or while the
      // transport is being torn down is a stale result, not a live failure.
      const current = this.matchesIds(acceptedIds);
      if (current) this.diagnostics.liveFragmentInputBytes = 0;
      if (!current || this.disposed || this.disposing) return;
      this.fail(typeof error?.code === 'string' ? error.code : 'fragment-decode-failed');
    }
  }

  acceptSlab(message) {
    const audioBuffer = this.audioContext.createBuffer(
      message.channelCount,
      message.frameCount,
      this.metadata.sampleRate
    );
    for (let channel = 0; channel < message.channelCount; channel++) {
      audioBuffer.copyToChannel(new Float32Array(message.planes[channel]), channel);
    }
    const bytes = message.frameCount * message.channelCount * Float32Array.BYTES_PER_ELEMENT;
    this.queue.push({
      audioBuffer,
      startFrame: message.startFrame,
      frameCount: message.frameCount,
      bytes
    });
    this.lastSlabId = message.slabId;
    this.lastReceivedFrame += message.frameCount;
    this.diagnostics.liveAudioBuffers++;
    this.diagnostics.livePcmBytes += bytes;
    if (this.diagnostics.livePcmBytes > this.diagnostics.maxLivePcmBytes) {
      this.diagnostics.maxLivePcmBytes = this.diagnostics.livePcmBytes;
    }
    this.post(RollingPcmCommand.RECYCLE, {
      slabId: message.slabId,
      planes: message.planes
    }, message.planes);
    const pcmByteCap = this.reservationRole === 'next'
      ? this.profile.nextPcmByteCap
      : this.profile.currentPcmByteCap;
    if (this.diagnostics.livePcmBytes > pcmByteCap) {
      this.fail('pcm-budget-exceeded');
      return;
    }
    if (this.playing) this.scheduleAvailable();
    this.resolveWaiters(message);
  }

  scheduleAvailable() {
    if (!this.playing || this.disposed || this.failed || !this.metadata) return;
    while (this.queue.length > 0 && this.scheduled.size < this.profile.sourceNodeCap) {
      const record = this.queue.shift();
      const recordEnd = record.startFrame + record.frameCount;
      if (recordEnd <= this.positionFrame) {
        this.releaseBufferRecord(record);
        continue;
      }
      const offsetFrames = this.positionFrame > record.startFrame
        ? this.positionFrame - record.startFrame
        : 0;
      const audibleStartFrame = record.startFrame + offsetFrames;
      const when = this.anchorContextTime +
        (audibleStartFrame - this.anchorFrame) / this.metadata.sampleRate;
      const liveContextTime = this.audioContext.currentTime;
      const hasContinuousCoverage = [...this.scheduled].some(scheduled => {
        const scheduledStartFrame = Math.max(scheduled.record.startFrame, this.anchorFrame);
        const scheduledStartTime = this.anchorContextTime +
          (scheduledStartFrame - this.anchorFrame) / this.metadata.sampleRate;
        const scheduledEndTime = this.anchorContextTime +
          (scheduled.record.startFrame + scheduled.record.frameCount - this.anchorFrame) /
            this.metadata.sampleRate;
        return scheduledStartTime <= liveContextTime && scheduledEndTime > liveContextTime;
      });
      if (audibleStartFrame > this.anchorFrame && when < liveContextTime &&
          !hasContinuousCoverage) {
        this.releaseBufferRecord(record);
        this.fail('underrun');
        return;
      }
      const source = this.audioContext.createBufferSource();
      const generation = this.nodeGeneration;
      source.buffer = record.audioBuffer;
      source.connect(this.bus);
      const scheduled = { source, record, generation, released: false };
      this.scheduled.add(scheduled);
      this.diagnostics.liveSourceNodes++;
      if (this.diagnostics.liveSourceNodes > this.diagnostics.maxLiveSourceNodes) {
        this.diagnostics.maxLiveSourceNodes = this.diagnostics.liveSourceNodes;
      }
      source.onended = () => this.handleSourceEnded(scheduled);
      source.start(when, offsetFrames / this.metadata.sampleRate);
    }
    this.requestAhead();
  }

  handleSourceEnded(scheduled) {
    if (scheduled.released) return;
    this.scheduled.delete(scheduled);
    scheduled.source.onended = null;
    try { scheduled.source.disconnect(); } catch (_) { /* already disconnected */ }
    scheduled.released = true;
    this.diagnostics.liveSourceNodes--;
    this.releaseBufferRecord(scheduled.record);
    if (!this.playing || scheduled.generation !== this.nodeGeneration || this.failed) return;
    this.positionFrame = scheduled.record.startFrame + scheduled.record.frameCount;
    this.scheduleAvailable();
    if (this.scheduled.size === 0 && this.queue.length === 0) {
      if (this.decoderEnded && this.positionFrame >= this.metadata.totalFrames) this.publishEnded();
      else if (!this.decoderEnded) this.fail('underrun');
    }
  }

  requestAhead() {
    if (!this.worker || !this.metadata || this.decoderEnded || this.failed || this.disposed) return;
    const aheadFrames = this.reservationRole === 'next'
      ? this.profile.nextMinimumHeadFrames
      : this.profile.currentHighWaterFrames;
    const target = Math.min(
      this.metadata.totalFrames,
      this.getPositionFrame() + aheadFrames
    );
    if (target <= this.lastFillTarget) return;
    this.requestFill(target);
  }

  fillTo(targetFrame) {
    if (!this.worker || !Number.isSafeInteger(targetFrame)) {
      return Promise.reject(codedError('fill-target-invalid'));
    }
    const resident = () => this.lastReceivedFrame >= targetFrame || this.decoderEnded;
    if (resident()) return Promise.resolve();
    // The waiter is created only after the request that can satisfy it was
    // posted: an early reject would otherwise orphan it until its timeout.
    if (targetFrame > this.lastFillTarget && !this.requestFill(targetFrame)) {
      return Promise.reject(codedError('worker-post-failed'));
    }
    // A Worker that answers the request inline has already delivered every
    // frame by the time the request returns; a waiter registered now would
    // only ever expire, because waiters are evaluated on arriving messages.
    if (resident()) return Promise.resolve();
    return this.waitFor(resident).then(() => undefined);
  }

  requestFill(targetFrame) {
    if (!this.worker || !Number.isSafeInteger(targetFrame) ||
        targetFrame < this.lastReceivedFrame || targetFrame > this.metadata.totalFrames) {
      return false;
    }
    const requestedTarget = targetFrame;
    if (this.decoderContract) {
      targetFrame = normalizePcm16WaveFillTarget(
        this.lastReceivedFrame,
        requestedTarget,
        this.metadata.sourceTotalFrames
      );
      if (targetFrame === null) return false;
    }
    const previousTarget = this.lastFillTarget;
    this.lastFillTarget = targetFrame;
    if (this.post(RollingPcmCommand.FILL, { targetFrame })) return true;
    this.lastFillTarget = previousTarget;
    return false;
  }

  stopScheduledNodes({ retainFromFrame = null } = {}) {
    this.nodeGeneration++;
    const retained = [];
    for (const scheduled of [...this.scheduled]) {
      this.scheduled.delete(scheduled);
      scheduled.source.onended = null;
      try { scheduled.source.stop(); } catch (_) { /* already ended */ }
      try { scheduled.source.disconnect(); } catch (_) { /* already disconnected */ }
      if (!scheduled.released) {
        scheduled.released = true;
        this.diagnostics.liveSourceNodes--;
        const recordEnd = scheduled.record.startFrame + scheduled.record.frameCount;
        if (Number.isSafeInteger(retainFromFrame) && recordEnd > retainFromFrame &&
            !scheduled.record.released) {
          retained.push(scheduled.record);
        } else {
          this.releaseBufferRecord(scheduled.record);
        }
      }
    }
    if (retained.length > 0) {
      this.queue.push(...retained);
      this.queue.sort((left, right) => left.startFrame - right.startFrame);
    }
  }

  releaseQueuedBuffers() {
    for (const record of this.queue.splice(0)) this.releaseBufferRecord(record);
  }

  releaseBufferRecord(record) {
    if (!record || record.released) return;
    record.released = true;
    this.diagnostics.liveAudioBuffers--;
    this.diagnostics.livePcmBytes -= record.bytes;
  }

  fail(reason) {
    if (this.failed || this.disposed || this.disposing) return;
    this.failed = true;
    this.terminalGeneration = ++this.generation;
    this.seekSequence++;
    this.playing = false;
    this.prepared = false;
    void this.cancelPendingSeek();
    if (reason === 'underrun') this.diagnostics.underruns++;
    this.stopScheduledNodes();
    this.releaseQueuedBuffers();
    this.rejectWaiters(codedError(reason));
    const failure = Object.freeze({ reason, diagnostics: this.getDiagnosticSnapshot() });
    this.onFailure?.(failure);
    this.failureCleanupPromise = this.dispose();
  }

  publishEnded() {
    if (this.endPublished || this.failed || this.disposed) return;
    this.endPublished = true;
    this.playing = false;
    this.positionFrame = this.metadata.totalFrames;
    this.onEnded?.();
  }

  post(type, payload = {}, transfer = []) {
    if (!this.worker) return false;
    try {
      this.worker.postMessage(createRollingPcmEnvelope(type, this.ids(), payload), transfer);
      return true;
    } catch (_) {
      this.fail('worker-post-failed');
      return false;
    }
  }

  ids() {
    return {
      transportId: this.transportId,
      generation: this.generation,
      segmentId: this.segmentId
    };
  }

  matchesIds(ids) {
    return ids?.transportId === this.transportId && ids?.generation === this.generation &&
      ids?.segmentId === this.segmentId;
  }

  promoteReservation(previousTransport = null) {
    if (!this.reservationHeld) return false;
    const previousOwner = previousTransport?.reservationHeld
      ? previousTransport.reservationOwner
      : null;
    if (!this.reservationLedger.promote(
      this.reservationOwner,
      previousOwner,
      this.reservationProfile
    )) return false;
    this.reservationRole = 'current';
    if (this.playing) this.requestAhead();
    return true;
  }

  canPromoteReservation(previousTransport = null) {
    if (!this.reservationHeld) return false;
    const previousOwner = previousTransport?.reservationHeld
      ? previousTransport.reservationOwner
      : null;
    return this.reservationLedger.canPromote(
      this.reservationOwner,
      previousOwner,
      this.reservationProfile
    );
  }

  cancelPendingSeek() {
    const pending = this.pendingSeek;
    this.pendingSeek = null;
    return pending?.candidate
      ? this.trackCleanup(pending.candidate.dispose())
      : Promise.resolve();
  }

  supersedePendingSeek() {
    this.seekSequence++;
    return this.cancelPendingSeek();
  }

  adoptPreparedSeekCandidate(candidate, target) {
    const oldWorker = this.worker;
    const oldIds = this.ids();
    const oldReservationOwner = this.reservationOwner;
    this.playing = false;
    this.stopScheduledNodes();
    this.releaseQueuedBuffers();
    this.rejectWaiters(codedError('seek-generation-replaced'));

    this.worker = candidate.worker;
    candidate.worker = null;
    this.worker.onmessage = event => this.handleWorkerMessage(event.data);
    this.worker.onerror = event => {
      event?.preventDefault?.();
      this.fail('worker-crashed');
    };
    this.transportId = candidate.transportId;
    this.segmentId = candidate.segmentId;
    this.generation = candidate.generation;
    this.metadata = candidate.metadata;
    this.decoderContract = candidate.decoderContract;
    this.reservationProfile = candidate.reservationProfile;
    this.queue = candidate.queue;
    candidate.queue = [];
    this.lastReceivedFrame = candidate.lastReceivedFrame;
    this.lastSlabId = candidate.lastSlabId;
    this.lastFillTarget = candidate.lastFillTarget;
    this.decoderEnded = candidate.decoderEnded;
    this.diagnostics.liveFragmentInputBytes = candidate.diagnostics.liveFragmentInputBytes;
    candidate.diagnostics.liveFragmentInputBytes = 0;
    this.positionFrame = target;
    this.anchorFrame = target;
    this.endPublished = false;
    this.reservationOwner = candidate.reservationOwner;
    this.reservationHeld = true;
    this.reservationRole = 'current';
    candidate.reservationHeld = false;
    this.diagnostics.liveWorkers = oldWorker ? 2 : 1;
    this.diagnostics.liveHandlers = oldWorker ? 4 : 2;
    this.diagnostics.liveAudioBuffers = candidate.diagnostics.liveAudioBuffers;
    this.diagnostics.livePcmBytes = candidate.diagnostics.livePcmBytes;
    this.diagnostics.maxLivePcmBytes = Math.max(
      this.diagnostics.maxLivePcmBytes,
      candidate.diagnostics.maxLivePcmBytes
    );
    candidate.disconnect();
    candidate.disposed = true;
    candidate.diagnostics.liveWorkers = 0;
    candidate.diagnostics.liveHandlers = 0;
    candidate.diagnostics.liveAudioBuffers = 0;
    candidate.diagnostics.livePcmBytes = 0;
    this.trackCleanup(disposeDetachedWorker(oldWorker, oldIds).finally(() => {
      if (!this.disposed) {
        this.diagnostics.liveWorkers = 1;
        this.diagnostics.liveHandlers = 2;
      }
      this.reservationLedger.release(oldReservationOwner);
    }));
  }

  releaseReservation() {
    if (!this.reservationHeld) return;
    this.reservationHeld = false;
    this.reservationLedger.release(this.reservationOwner);
  }

  trackCleanup(cleanup) {
    const prior = this.cleanupBarrier;
    const tracked = Promise.allSettled([prior, Promise.resolve(cleanup)]).then(() => undefined);
    this.cleanupBarrier = tracked;
    return tracked;
  }

  async waitForCleanupBarrier() {
    let barrier;
    do {
      barrier = this.cleanupBarrier;
      await barrier;
    } while (barrier !== this.cleanupBarrier);
  }

  waitFor(predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timeoutId: null };
      waiter.timeoutId = setTimeout(() => {
        this.waiters.delete(waiter);
        waiter.timeoutId = null;
        this.diagnostics.liveTimers--;
        reject(codedError('worker-response-timeout'));
      }, timeoutMs);
      this.diagnostics.liveTimers++;
      this.waiters.add(waiter);
    });
  }

  resolveWaiters(message) {
    for (const waiter of [...this.waiters]) {
      let matched = false;
      try { matched = waiter.predicate(message) === true; } catch (error) {
        this.waiters.delete(waiter);
        this.clearWaiterTimer(waiter);
        waiter.reject(error);
        continue;
      }
      if (!matched) continue;
      this.waiters.delete(waiter);
      this.clearWaiterTimer(waiter);
      waiter.resolve(message);
    }
  }

  rejectWaiters(error) {
    for (const waiter of this.waiters) {
      this.clearWaiterTimer(waiter);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  clearWaiterTimer(waiter) {
    if (waiter.timeoutId === null) return;
    clearTimeout(waiter.timeoutId);
    waiter.timeoutId = null;
    this.diagnostics.liveTimers--;
  }
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeDecoderContract({ outputSampleRate, decoderProfile, resamplerProfile }) {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  if (outputSampleRate !== profile.outputSampleRate ||
      decoderProfile !== profile.codec || resamplerProfile !== profile.id) {
    return null;
  }
  return Object.freeze({ outputSampleRate, decoderProfile, resamplerProfile });
}

function takeRollingCandidateSourceOverride(snapshot, sourceOverride) {
  if (sourceOverride?.kind !== 'bytes' ||
      !(sourceOverride.bytes instanceof ArrayBuffer) ||
      sourceOverride.bytes.byteLength !== snapshot?.byteLength) {
    return null;
  }
  return Object.freeze({ kind: 'bytes', bytes: sourceOverride.bytes });
}

async function acquireRollingCandidateSource(snapshot, sourceReacquirer) {
  const cloned = cloneRollingCandidateSource(snapshot);
  if (cloned) return cloned;
  if (typeof sourceReacquirer !== 'function') return null;
  const bytes = await sourceReacquirer(snapshot);
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== snapshot?.byteLength) return null;
  return Object.freeze({ kind: 'bytes', bytes, reacquired: true });
}

function isValidReadyMessage(message, decoderContract = null) {
  if (!message || message.type !== RollingPcmEvent.READY ||
      !Number.isSafeInteger(message.sampleRate) || message.sampleRate <= 0 ||
      !Number.isSafeInteger(message.channelCount) || message.channelCount < 1 ||
      message.channelCount > 2 || !Number.isFinite(message.durationSec) ||
      message.durationSec < 0 || !Number.isSafeInteger(message.totalFrames) ||
      message.totalFrames < 0 || typeof message.containerMimeType !== 'string' ||
      message.containerMimeType.length === 0 || message.decoderConfigVerified !== true ||
      (message.decoderConfigCodec !== null && typeof message.decoderConfigCodec !== 'string')) {
    return false;
  }
  if (message.codec !== null && typeof message.codec !== 'string') return false;
  const hasSourceOutputMetadata = message.sourceSampleRate !== undefined ||
    message.outputSampleRate !== undefined || message.sourceTotalFrames !== undefined ||
    message.sourceByteLength !== undefined || message.dataOffset !== undefined ||
    message.dataByteLength !== undefined || message.bitsPerSample !== undefined ||
    message.blockAlign !== undefined || message.decoderProfile !== undefined ||
    message.resamplerProfile !== undefined;
  if (!decoderContract) {
    return !hasSourceOutputMetadata &&
      message.totalFrames === Math.ceil(message.durationSec * message.sampleRate);
  }
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  const authoritativeTotalFrames = sourceToOutputFrames(
    message.sourceTotalFrames,
    profile,
    'floor'
  );
  return Number.isSafeInteger(message.sourceSampleRate) &&
    Number.isSafeInteger(message.outputSampleRate) &&
    Number.isSafeInteger(message.sourceTotalFrames) && message.sourceTotalFrames > 0 &&
    Number.isSafeInteger(message.sourceByteLength) && message.sourceByteLength > 0 &&
    Number.isSafeInteger(message.workerCompressedBytes) &&
    message.workerCompressedBytes === message.sourceByteLength &&
    Number.isSafeInteger(message.dataOffset) && message.dataOffset >= 44 &&
    Number.isSafeInteger(message.dataByteLength) && message.dataByteLength > 0 &&
    Number.isSafeInteger(message.bitsPerSample) && message.bitsPerSample === 16 &&
    Number.isSafeInteger(message.blockAlign) && message.blockAlign === 4 &&
    message.dataByteLength === message.sourceTotalFrames * message.blockAlign &&
    message.dataOffset + message.dataByteLength <= message.sourceByteLength &&
    message.sourceSampleRate === profile.sourceSampleRate &&
    message.outputSampleRate === decoderContract.outputSampleRate &&
    message.sampleRate === message.outputSampleRate &&
    message.channelCount === profile.channelCount &&
    message.decoderProfile === decoderContract.decoderProfile &&
    message.resamplerProfile === decoderContract.resamplerProfile &&
    message.totalFrames === authoritativeTotalFrames &&
    durationMatchesOutputFrames(
      message.durationSec,
      authoritativeTotalFrames,
      message.outputSampleRate
    );
}

function durationMatchesOutputFrames(durationSec, totalFrames, outputSampleRate) {
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 0 ||
      !Number.isSafeInteger(outputSampleRate) || outputSampleRate <= 0) return false;
  const exactDuration = totalFrames / outputSampleRate;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(exactDuration)) * 4;
  return Math.abs(durationSec - exactDuration) <= tolerance;
}

function sameFragmentPlan(message, plan) {
  return message.fragmentSourceStartFrame === plan.fragmentSourceStartFrame &&
    message.fragmentSourceFrameCount === plan.fragmentSourceFrameCount &&
    message.logicalSourceStartFrame === plan.logicalSourceStartFrame &&
    message.logicalSourceFrameCount === plan.logicalSourceFrameCount &&
    message.outputStartFrame === plan.outputStartFrame &&
    message.outputFrameCount === plan.outputFrameCount &&
    message.cropStartFrame === plan.cropStartFrame &&
    message.decodedOutputFrameCount === plan.decodedOutputFrameCount &&
    message.fragmentBytes.byteLength === plan.fragmentByteLength;
}

function decodeAudioData(audioContext, source) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = callback => value => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const onSuccess = settle(resolve);
    const onFailure = settle(reject);
    try {
      const result = audioContext.decodeAudioData(source, onSuccess, onFailure);
      if (result && typeof result.then === 'function') result.then(onSuccess, onFailure);
    } catch (error) {
      onFailure(error);
    }
  });
}

function checkedFrameTarget(startFrame, headFrames, totalFrames) {
  if (!Number.isSafeInteger(startFrame) || startFrame < 0 ||
      !Number.isSafeInteger(headFrames) || headFrames < 0 ||
      !Number.isSafeInteger(totalFrames) || totalFrames < startFrame) return null;
  if (headFrames > Number.MAX_SAFE_INTEGER - startFrame) return null;
  const target = startFrame + headFrames;
  return target < totalFrames ? target : totalFrames;
}

async function disposeDetachedWorker(worker, ids) {
  if (!worker) return;
  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate?.();
      resolve();
    };
    const timeoutId = setTimeout(finish, DISPOSE_TIMEOUT_MS);
    worker.onmessage = event => {
      if (validateRollingPcmEnvelope(event.data, {
        expectedTransportId: ids.transportId,
        expectedGeneration: ids.generation + 1,
        expectedSegmentId: ids.segmentId
      }) && event.data.type === RollingPcmEvent.DISPOSED) finish();
    };
    worker.onerror = finish;
    try {
      worker.postMessage(createRollingPcmEnvelope(RollingPcmCommand.DISPOSE, {
        ...ids,
        generation: ids.generation + 1
      }));
    } catch (_) {
      finish();
    }
  });
}
