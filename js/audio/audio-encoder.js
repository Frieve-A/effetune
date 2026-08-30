import {
  getOfflineOutputFormat,
  normalizeOfflineOutputSettings,
  validateOfflineOutputChannels
} from './offline-output-settings.js';

const MAX_WAV_DATA_SIZE = 0xffffffff - 36;
const WAV_ASYNC_CHUNK_FRAMES = 16 * 1024;
const FLAC_PCM16_CHUNK_FRAMES = 16 * 1024;

function createOutputError(userMessageKey, message, cause, userMessageValues = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.userMessageKey = userMessageKey;
  if (userMessageValues) error.userMessageValues = userMessageValues;
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw createOutputError('status.processingCanceled', 'Offline output encoding was canceled');
}

function reportProgress(callback, phase, progress = null) {
  callback?.({ phase, progress });
}

function getWavBytesPerSample(sampleFormat) {
  return sampleFormat === 'pcm16' ? 2 : sampleFormat === 'pcm24' ? 3 : 4;
}

function getResampledFrameCount(length, inputSampleRate, outputSampleRate) {
  const outputLength = Math.round(length * outputSampleRate / inputSampleRate);
  if (!Number.isSafeInteger(outputLength) || outputLength < 1) {
    throw createOutputError(
      'error.offlineOutput.rateConversionFailed',
      'Invalid resampling output length'
    );
  }
  return outputLength;
}

function validateWavDataSize(numberOfChannels, length, sampleFormat) {
  const dataSize = length * numberOfChannels * getWavBytesPerSample(sampleFormat);
  if (!Number.isSafeInteger(dataSize) || dataSize < 0 || dataSize > MAX_WAV_DATA_SIZE) {
    throw createOutputError('error.offlineOutput.invalidOutput', 'WAV output is too large');
  }
  return dataSize;
}

/**
 * Validates output constraints using decoded input metadata before DSP rendering.
 * The returned frame count uses the same calculation as the actual resampler.
 */
export function preflightOfflineOutput(audioBuffer, settings) {
  const normalized = normalizeOfflineOutputSettings(settings);
  const definition = validateOfflineOutputChannels(normalized, audioBuffer?.numberOfChannels);
  const outputLength = getResampledFrameCount(
    audioBuffer?.length,
    audioBuffer?.sampleRate,
    normalized.sampleRate
  );
  if (normalized.format === 'wav') {
    validateWavDataSize(
      audioBuffer.numberOfChannels,
      outputLength,
      normalized.wavSampleFormat
    );
  }
  return { definition, normalized, outputLength };
}

function quantizePcm16(raw) {
  const sample = raw < -1 ? -1 : raw > 1 ? 1 : raw;
  return Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
}

function createWavEncoding(audioBuffer, sampleFormat) {
  const formatCode = sampleFormat === 'float32' ? 3 : 1;
  const bitsPerSample = sampleFormat === 'pcm16' ? 16 : sampleFormat === 'pcm24' ? 24 : 32;
  const bytesPerSample = bitsPerSample / 8;
  const numChannels = audioBuffer.numberOfChannels;
  const samples = audioBuffer.length;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = validateWavDataSize(numChannels, samples, sampleFormat);

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatCode, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return {
    buffer,
    view,
    bytesPerSample,
    numChannels,
    samples,
    channels: Array.from(
      { length: numChannels },
      (_, channel) => audioBuffer.getChannelData(channel)
    )
  };
}

function writeWavFrames(wav, sampleFormat, startFrame, endFrame) {
  let offset = 44 + startFrame * wav.numChannels * wav.bytesPerSample;
  for (let frame = startFrame; frame < endFrame; frame++) {
    for (let channel = 0; channel < wav.numChannels; channel++) {
      const raw = wav.channels[channel][frame];
      const sample = raw < -1 ? -1 : raw > 1 ? 1 : raw;
      if (sampleFormat === 'pcm16') {
        wav.view.setInt16(offset, quantizePcm16(raw), true);
      } else if (sampleFormat === 'pcm24') {
        const integer = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff) & 0xffffff;
        wav.view.setUint8(offset, integer & 0xff);
        wav.view.setUint8(offset + 1, (integer >> 8) & 0xff);
        wav.view.setUint8(offset + 2, (integer >> 16) & 0xff);
      } else {
        wav.view.setFloat32(offset, raw, true);
      }
      offset += wav.bytesPerSample;
    }
  }
}

/** Handles final-rate conversion and offline audio encoding. */
export class AudioEncoder {
  constructor({
    loadVendor = () => import('../vendor/offline-audio-encoders.mjs'),
    createOfflineContext = (channels, length, sampleRate) =>
      new OfflineAudioContext(channels, length, sampleRate)
  } = {}) {
    this.loadVendor = loadVendor;
    this.createOfflineContext = createOfflineContext;
  }

  /** Legacy-compatible 24-bit WAV encoder. */
  encodeWAV(audioBuffer) {
    return this.encodeWav(audioBuffer, 'pcm24');
  }

  encodeWav(audioBuffer, sampleFormat) {
    const wav = createWavEncoding(audioBuffer, sampleFormat);
    writeWavFrames(wav, sampleFormat, 0, wav.samples);
    return new Blob([wav.buffer], { type: 'audio/wav' });
  }

  async encodeWavAsync(audioBuffer, sampleFormat, { signal } = {}) {
    throwIfAborted(signal);
    const wav = createWavEncoding(audioBuffer, sampleFormat);
    for (let startFrame = 0; startFrame < wav.samples; startFrame += WAV_ASYNC_CHUNK_FRAMES) {
      throwIfAborted(signal);
      const endFrame = Math.min(startFrame + WAV_ASYNC_CHUNK_FRAMES, wav.samples);
      writeWavFrames(wav, sampleFormat, startFrame, endFrame);
      if (endFrame < wav.samples) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    throwIfAborted(signal);
    return new Blob([wav.buffer], { type: 'audio/wav' });
  }

  async resampleAudioBuffer(audioBuffer, targetSampleRate, { signal, onProgress } = {}) {
    if (audioBuffer.sampleRate === targetSampleRate) return audioBuffer;
    throwIfAborted(signal);
    const outputLength = getResampledFrameCount(
      audioBuffer.length,
      audioBuffer.sampleRate,
      targetSampleRate
    );
    reportProgress(onProgress, 'resampling', 0);
    try {
      const context = this.createOfflineContext(
        audioBuffer.numberOfChannels,
        outputLength,
        targetSampleRate
      );
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);
      source.start();
      const rendered = await context.startRendering();
      throwIfAborted(signal);
      if (!rendered || rendered.length !== outputLength ||
          rendered.numberOfChannels !== audioBuffer.numberOfChannels) {
        throw new Error('Unexpected resampling result');
      }
      reportProgress(onProgress, 'resampling', 1);
      return rendered;
    } catch (error) {
      if (error?.userMessageKey) throw error;
      throw createOutputError(
        'error.offlineOutput.rateConversionFailed',
        'Offline output sample-rate conversion failed',
        error
      );
    }
  }

  async encode(audioBuffer, settings, { onProgress, signal } = {}) {
    const { definition, normalized } = preflightOfflineOutput(audioBuffer, settings);
    throwIfAborted(signal);
    const outputBuffer = await this.resampleAudioBuffer(audioBuffer, normalized.sampleRate, {
      signal,
      onProgress
    });
    throwIfAborted(signal);
    reportProgress(onProgress, 'encoding', 0);

    const blob = normalized.format === 'wav'
      ? await this.encodeWavAsync(outputBuffer, normalized.wavSampleFormat, { signal })
      : await this.encodeFlac(outputBuffer, normalized, { signal });
    throwIfAborted(signal);
    if (!(blob instanceof Blob) || blob.size === 0 || blob.type !== definition.mimeType) {
      throw createOutputError('error.offlineOutput.invalidOutput', 'Encoder produced invalid output');
    }
    reportProgress(onProgress, 'encoding', 1);
    return {
      blob,
      format: normalized.format,
      extension: definition.extension,
      mimeType: definition.mimeType,
      sampleRate: normalized.sampleRate,
      numberOfChannels: outputBuffer.numberOfChannels
    };
  }

  async encodeFlac(audioBuffer, settings, { signal } = {}) {
    let vendor;
    try {
      vendor = await this.loadVendor();
    } catch (error) {
      console.error('Failed to load offline audio codec assets:', error);
      throw createOutputError(
        'error.offlineOutput.codecAssetsUnavailable',
        'Offline audio codec assets could not be loaded',
        error
      );
    }
    throwIfAborted(signal);

    const target = new vendor.BufferTarget();
    const format = new vendor.FlacOutputFormat();
    const output = new vendor.Output({ format, target });
    const pcm16 = settings.flacSampleFormat === 'pcm16';
    const source = pcm16
      ? new vendor.AudioSampleSource({ codec: 'flac' })
      : new vendor.AudioBufferSource({ codec: 'flac' });
    output.addAudioTrack(source);

    const abort = () => {
      output.cancel().catch(error => console.warn('Failed to cancel offline audio encoding:', error));
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await output.start();
      throwIfAborted(signal);
      if (pcm16) {
        await this.addFlacPcm16Samples(vendor, source, audioBuffer, { signal });
      } else {
        await source.add(audioBuffer);
      }
      throwIfAborted(signal);
      await output.finalize();
      if (!target.buffer || target.buffer.byteLength === 0) {
        throw createOutputError('error.offlineOutput.invalidOutput', 'Encoder produced an empty output buffer');
      }
      return new Blob([target.buffer], { type: getOfflineOutputFormat(settings.format).mimeType });
    } catch (error) {
      await output.cancel().catch(() => {});
      if (error?.userMessageKey) throw error;
      console.error('Offline audio encoding failed:', {
        format: settings.format,
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels,
        error
      });
      throw createOutputError(
        'error.offlineOutput.encoderInitializationFailed',
        'Offline audio encoding failed',
        error
      );
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async addFlacPcm16Samples(vendor, source, audioBuffer, { signal } = {}) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const channels = Array.from(
      { length: numberOfChannels },
      (_, channel) => audioBuffer.getChannelData(channel)
    );
    for (let startFrame = 0; startFrame < audioBuffer.length; startFrame += FLAC_PCM16_CHUNK_FRAMES) {
      throwIfAborted(signal);
      const endFrame = Math.min(startFrame + FLAC_PCM16_CHUNK_FRAMES, audioBuffer.length);
      const frameCount = endFrame - startFrame;
      const data = new ArrayBuffer(frameCount * numberOfChannels * 2);
      const view = new DataView(data);
      let offset = 0;
      for (let frame = startFrame; frame < endFrame; frame++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          view.setInt16(offset, quantizePcm16(channels[channel][frame]), true);
          offset += 2;
        }
      }
      const sample = new vendor.AudioSample({
        data,
        format: 's16',
        numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        timestamp: startFrame / audioBuffer.sampleRate
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
      if (endFrame < audioBuffer.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
}
