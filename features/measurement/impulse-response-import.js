import FFT from '../../js/utils/measurement-dsp/fft.js';
import { detectOnset } from '../../js/utils/measurement-dsp/onset.js';
import {
    createLogFrequencyGrid,
    smoothFrequencyResponse
} from '../../js/utils/measurement-dsp/smoothing.js';
import {
    IR_LIBRARY_MAX_ORIGINAL_BYTES,
    requireBoundedDecodedIrHeader,
    requireBoundedDecodedIrPcm,
    requireBoundedIrBytes
} from '../../js/ir-library/ir-library-limits.js';
import { isWavIrAudio, parseIrAudioHeader } from '../../js/ir-library/audio-header-metadata.js';
import { recalculateAverages } from './measurement-model.js';
import { MeasurementImportError } from './dataStorage.js';

const MAX_ANALYSIS_FFT_SIZE = 2 ** 18;
const MIN_ANALYSIS_FFT_SIZE = 2 ** 14;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20000;
const OUTPUT_CHANNELS = ['left', 'right', '2', '3', '4', '5', '6', '7'];

function analysisFftSize(sampleCount) {
    const boundedLength = Math.min(sampleCount, MAX_ANALYSIS_FFT_SIZE);
    return Math.min(
        MAX_ANALYSIS_FFT_SIZE,
        Math.max(MIN_ANALYSIS_FFT_SIZE, 2 ** Math.ceil(Math.log2(boundedLength)))
    );
}

function peakMagnitude(samples) {
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
        if (!Number.isFinite(samples[index])) throw new TypeError('Impulse response audio is invalid');
        const magnitude = Math.abs(samples[index]);
        if (magnitude > peak) peak = magnitude;
    }
    return peak;
}

export function frequencyResponseFromImpulseResponse(samples, sampleRate, onsetIndex = 0) {
    if (!(samples instanceof Float32Array) || samples.length === 0 ||
        !Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new TypeError('Impulse response audio is invalid');
    }

    // Removing leading silence changes only the time origin. Retain a short preroll for
    // phase-oriented consumers while keeping the display FFT focused on the actual IR.
    const analysisStart = Math.max(0, onsetIndex - 4096);
    const available = samples.length - analysisStart;
    const fftSize = analysisFftSize(available);
    const input = new Float64Array(fftSize);
    input.set(samples.subarray(analysisStart, analysisStart + fftSize));
    const spectrum = new FFT(fftSize).realTransform(input);
    const maxFrequency = Math.min(MAX_FREQUENCY, sampleRate / 2);
    if (!(maxFrequency > MIN_FREQUENCY)) return [];

    const frequencies = createLogFrequencyGrid(MIN_FREQUENCY, maxFrequency, 0.01);
    const response = frequencies.map(frequency => {
        const bin = Math.min(
            spectrum.real.length - 1,
            Math.max(1, Math.round(frequency * fftSize / sampleRate))
        );
        const magnitude = Math.hypot(spectrum.real[bin], spectrum.imag[bin]);
        return [frequency, 20 * Math.log10(magnitude + 1e-12)];
    });
    return smoothFrequencyResponse(response, 0.005);
}

export function createImpulseResponseMeasurement({
    id,
    name,
    channels,
    sampleRate,
    timestamp = new Date().toISOString()
}) {
    requireBoundedDecodedIrPcm({ channels, sampleRate });
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) {
        throw new TypeError('Imported measurement identity is invalid');
    }

    const analyzed = channels.map(samples => {
        const onsetIndex = detectOnset(samples, sampleRate);
        const peak = peakMagnitude(samples);
        return {
            samples,
            onsetIndex,
            peakDb: 20 * Math.log10(peak + 1e-12),
            frequencyResponse: frequencyResponseFromImpulseResponse(samples, sampleRate, onsetIndex)
        };
    });
    const sweepMaxFreq = Math.min(MAX_FREQUENCY, sampleRate / 2);
    const measurement = {
        id,
        name: name.trim(),
        timestamp,
        outputChannel: channels.length === 1 ? 'all' : 'multi',
        ...(channels.length > 1 ? { outputChannels: OUTPUT_CHANNELS.slice(0, channels.length) } : {}),
        sampleRate,
        sweepBandLimited: sweepMaxFreq < MAX_FREQUENCY,
        sweepMinFreq: MIN_FREQUENCY,
        sweepMaxFreq,
        points: [],
        nextPointId: channels.length === 1 ? 1 : channels.length + 1,
        correctionLowFreq: MIN_FREQUENCY,
        correctionHighFreq: sweepMaxFreq,
        smoothing: 0.3,
        eqBandCount: 5,
        imported: true,
        importTimestamp: timestamp
    };
    const records = [];

    if (channels.length === 1) {
        const result = analyzed[0];
        measurement.points.push({
            pointId: 0,
            name: name.trim(),
            timestamp,
            frequencyResponse: result.frequencyResponse,
            ir: {
                stored: true,
                length: result.samples.length,
                sampleRate,
                onsetIndex: result.onsetIndex,
                peakDb: result.peakDb
            }
        });
        records.push({
            measurementId: id,
            pointId: 0,
            sampleRate,
            onsetIndex: result.onsetIndex,
            prerollSamples: result.onsetIndex,
            refScale: 1,
            peakDb: result.peakDb,
            data: result.samples
        });
    } else {
        const outputChannels = measurement.outputChannels;
        measurement.points.push({
            pointId: 0,
            name: name.trim(),
            timestamp,
            channels: analyzed.map((result, index) => {
                const channel = outputChannels[index];
                const irId = index + 1;
                records.push({
                    measurementId: id,
                    pointId: irId,
                    channel,
                    sampleRate,
                    onsetIndex: result.onsetIndex,
                    prerollSamples: result.onsetIndex,
                    refScale: 1,
                    peakDb: result.peakDb,
                    data: result.samples
                });
                return {
                    channel,
                    frequencyResponse: result.frequencyResponse,
                    irId,
                    ir: {
                        stored: true,
                        length: result.samples.length,
                        sampleRate,
                        onsetIndex: result.onsetIndex,
                        peakDb: result.peakDb
                    }
                };
            })
        });
    }

    recalculateAverages(measurement);
    return { measurement, records };
}

async function decodeWithAudioContext(arrayBuffer, header, AudioContextClass) {
    if (typeof AudioContextClass !== 'function') {
        throw new Error('Audio decoding is unavailable');
    }
    const context = new AudioContextClass({ sampleRate: header.sampleRate });
    try {
        const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
        const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
            new Float32Array(audioBuffer.getChannelData(index))
        );
        return { channels, sampleRate: audioBuffer.sampleRate };
    } finally {
        try {
            await context.close?.();
        } catch (error) {
            console.warn('Impulse-response decoder context could not be closed:', error);
        }
    }
}

export async function decodeImpulseResponseWav(arrayBuffer, dependencies = {}) {
    requireBoundedIrBytes(arrayBuffer, IR_LIBRARY_MAX_ORIGINAL_BYTES, 'Impulse response WAV');
    if (!isWavIrAudio(arrayBuffer)) throw new TypeError('The selected file is not a WAV file');
    const header = parseIrAudioHeader(arrayBuffer);
    requireBoundedDecodedIrHeader(header, 'Impulse response WAV');
    const decode = dependencies.decode || (bytes => decodeWithAudioContext(
        bytes,
        header,
        dependencies.AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext
    ));
    const decoded = await decode(arrayBuffer);
    requireBoundedDecodedIrPcm(decoded);
    return decoded;
}

export async function importImpulseResponseWav(file, dataStorage, dependencies = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw new TypeError('Impulse response file is invalid');
    }
    if (dataStorage?.irPersistenceAvailable === false) {
        throw new MeasurementImportError('storage');
    }
    if (Number.isSafeInteger(file.size) && file.size > IR_LIBRARY_MAX_ORIGINAL_BYTES) {
        throw new MeasurementImportError('size');
    }
    const decoded = await decodeImpulseResponseWav(await file.arrayBuffer(), dependencies);
    const baseName = String(file.name || '').replace(/\.wav$/i, '').trim() || 'Impulse Response';
    const id = dataStorage.generateId();
    const result = createImpulseResponseMeasurement({ id, name: baseName, ...decoded });
    try {
        await dataStorage.addMeasurement(
            result.measurement,
            result.records,
            { requireImpulseResponses: true }
        );
    } catch (error) {
        throw new MeasurementImportError('storage', error);
    }
    return id;
}
