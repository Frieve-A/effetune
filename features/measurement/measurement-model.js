import { INDIVIDUAL_CHANNELS } from './audio-utils/channel-selection.js';

export function resolveSweepBand(config, channel, sampleRate, sweepLength,
    outputChannelCount = config?.outputChannelCount ?? INDIVIDUAL_CHANNELS.length) {
    const setting = config?.sweepBand;
    const bandLimited = setting ? setting.mode !== 'off' : config?.sweepBandLimited !== false;
    const fftLength = 2 ** Math.ceil(Math.log2(Number(sweepLength) || 65536));
    if (!bandLimited) {
        return {
            minFreq: sampleRate / fftLength,
            maxFreq: (fftLength / 2 - 1) * sampleRate / fftLength,
            bandLimited: false
        };
    }
    if (channel === 'all' && setting?.mode === 'perChannel') {
        const bands = resolveOutputSweepBands(config, sampleRate, sweepLength, outputChannelCount);
        return {
            minFreq: Math.min(...bands.map(band => band.minFreq)),
            maxFreq: Math.max(...bands.map(band => band.maxFreq)),
            bandLimited: true
        };
    }
    const band = (setting?.mode === 'perChannel'
        ? setting.perChannel?.find(entry => entry.channel === channel) : null) ||
        setting?.common || { minFreq: config?.sweepMinFreq, maxFreq: config?.sweepMaxFreq };
    const nyquistLimit = Math.max(2, Math.floor(sampleRate / 2) - 1);
    const minFreq = Math.max(1, Math.min(Number(band.minFreq) || 20, nyquistLimit - 1));
    const maxFreq = Math.max(minFreq + 1, Math.min(Number(band.maxFreq) || 20000, nyquistLimit));
    return { minFreq, maxFreq, bandLimited: true };
}

export function resolveOutputSweepBands(config, sampleRate, sweepLength,
    outputChannelCount = config?.outputChannelCount ?? INDIVIDUAL_CHANNELS.length) {
    return INDIVIDUAL_CHANNELS.slice(0, outputChannelCount).map(channel => ({
        channel, ...resolveSweepBand(config, channel, sampleRate, sweepLength)
    }));
}

export function resolveResponseSweepBand(measurement, channel = 'all') {
    const sampleRate = measurement.sampleRate || 48000;
    const channels = channel !== 'all' ? [channel]
        : isMultiChannelMeasurement(measurement) ? measurement.outputChannels
        : [measurement.outputChannel || 'all'];
    const bands = channels.map(token => resolveSweepBand(
        measurement, token, sampleRate, measurement.sweepLength
    ));
    return {
        minFreq: Math.min(...bands.map(band => band.minFreq)),
        maxFreq: Math.max(...bands.map(band => band.maxFreq)),
        bandLimited: bands[0].bandLimited
    };
}

function validResponse(response) {
    return Array.isArray(response) && response.length > 0;
}

function averageResponses(responses) {
    const valid = responses.filter(validResponse);
    if (valid.length === 0) return [];
    const differentGrids = valid.some(response => response.some((point, index) =>
        index < valid[0].length && point?.[0] !== valid[0][index]?.[0]));
    if (differentGrids) {
        const frequencies = [...new Set(valid.flatMap(response => response.map(point => point[0])))]
            .filter(frequency => Number.isFinite(frequency) && frequency > 0)
            .sort((a, b) => a - b);
        const positions = valid.map(() => 0);
        const average = [];
        for (const frequency of frequencies) {
            let sum = 0;
            let count = 0;
            for (let channel = 0; channel < valid.length; channel++) {
                const response = valid[channel];
                // A limited sweep contains no measurement outside its own band.
                if (frequency < response[0][0] || frequency > response.at(-1)[0]) continue;
                while (positions[channel] + 1 < response.length &&
                    response[positions[channel] + 1][0] <= frequency) positions[channel] += 1;
                const lower = response[positions[channel]];
                const upper = response[positions[channel] + 1] || lower;
                const magnitude = lower[0] === frequency ? lower[1] : lower[1] +
                    (upper[1] - lower[1]) * Math.log(frequency / lower[0]) / Math.log(upper[0] / lower[0]);
                if (!Number.isFinite(magnitude)) continue;
                sum += magnitude;
                count += 1;
            }
            if (count) average.push([frequency, sum / count]);
        }
        return average;
    }
    const length = valid.reduce((minimum, response) => Math.min(minimum, response.length), Infinity);
    const average = [];
    for (let index = 0; index < length; index += 1) {
        let sum = 0;
        let count = 0;
        let frequency;
        for (const response of valid) {
            const point = response[index];
            if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
            if (frequency === undefined) frequency = point[0];
            sum += point[1];
            count += 1;
        }
        if (count > 0) average.push([frequency, sum / count]);
    }
    return average;
}

function averageLevels(values) {
    const finite = values.filter(Number.isFinite);
    if (finite.length === 0) return undefined;
    return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function isMultiChannelMeasurement(measurement) {
    return Array.isArray(measurement?.outputChannels) && measurement.outputChannels.length > 1;
}

export function recalculateAverages(measurement) {
    const points = Array.isArray(measurement.points) ? measurement.points : [];
    if (!isMultiChannelMeasurement(measurement)) {
        measurement.averageFrequencyResponse = averageResponses(points.map(point => point.frequencyResponse));
        const maxSignalLevel = averageLevels(points.map(point => point.maxSignalLevel));
        if (maxSignalLevel === undefined) delete measurement.maxSignalLevel;
        else measurement.maxSignalLevel = maxSignalLevel;
        return measurement;
    }

    const entries = [];
    const allResponses = [];
    const allLevels = [];
    for (const channel of measurement.outputChannels) {
        const channelEntries = points
            .map(point => point.channels?.find(entry => entry.channel === channel))
            .filter(Boolean);
        const averageFrequencyResponse = averageResponses(
            channelEntries.map(entry => entry.frequencyResponse)
        );
        const maxSignalLevel = averageLevels(channelEntries.map(entry => entry.maxSignalLevel));
        const summary = { channel, averageFrequencyResponse };
        if (maxSignalLevel !== undefined) summary.maxSignalLevel = maxSignalLevel;
        entries.push(summary);
        allResponses.push(...channelEntries.map(entry => entry.frequencyResponse));
        allLevels.push(...channelEntries.map(entry => entry.maxSignalLevel));
    }
    measurement.channelResponses = entries;
    measurement.averageFrequencyResponse = averageResponses(allResponses);
    const maxSignalLevel = averageLevels(allLevels);
    if (maxSignalLevel === undefined) delete measurement.maxSignalLevel;
    else measurement.maxSignalLevel = maxSignalLevel;
    return measurement;
}

export function collectStoredIrKeyIds(point) {
    if (Array.isArray(point?.channels)) {
        return point.channels
            .filter(entry => entry.ir?.stored === true && Number.isSafeInteger(entry.irId))
            .map(entry => entry.irId);
    }
    return point?.ir?.stored === true && Number.isSafeInteger(point.pointId) ? [point.pointId] : [];
}

export function collectPointIrKeyIds(point) {
    if (Array.isArray(point?.channels)) {
        return point.channels
            .filter(entry => Number.isSafeInteger(entry.irId))
            .map(entry => entry.irId);
    }
    return Number.isSafeInteger(point?.pointId) ? [point.pointId] : [];
}

export function resolveIrRecordTarget(measurement, recordPointId) {
    const points = Array.isArray(measurement?.points) ? measurement.points : [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        if (!isMultiChannelMeasurement(measurement) && point.pointId === recordPointId) {
            return { pointIndex, channel: null };
        }
        for (const entry of point.channels || []) {
            if (entry.irId === recordPointId) return { pointIndex, channel: entry.channel };
        }
    }
    return null;
}

export function resolveIrRecordKey(measurement, pointIndex = 'all', channelToken = null) {
    const points = Array.isArray(measurement?.points) ? measurement.points : [];
    if (!isMultiChannelMeasurement(measurement)) {
        const candidates = pointIndex === 'all' ? points : [points[pointIndex]];
        for (const point of candidates) {
            if (Number.isSafeInteger(point?.pointId) && point.ir?.stored === true) {
                return { pointIndex: points.indexOf(point), channel: null, irKey: point.pointId };
            }
        }
        return null;
    }

    const pointCandidates = pointIndex === 'all'
        ? points.map((point, index) => ({ point, index }))
        : [{ point: points[pointIndex], index: pointIndex }];
    for (const candidate of pointCandidates) {
        if (!candidate.point) continue;
        for (const channel of measurement.outputChannels) {
            if (channelToken && channelToken !== 'all' && channel !== channelToken) continue;
            const entry = candidate.point.channels?.find(value => value.channel === channel);
            if (Number.isSafeInteger(entry?.irId) && entry.ir?.stored === true) {
                return { pointIndex: candidate.index, channel, irKey: entry.irId };
            }
        }
    }
    return null;
}

export function collectCalibrationIrCandidates(measurement) {
    const points = Array.isArray(measurement?.points) ? measurement.points : [];
    const candidates = [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        if (!Number.isSafeInteger(point?.pointId)) continue;
        if (!isMultiChannelMeasurement(measurement)) {
            if (point.ir?.stored === true) {
                candidates.push({ pointIndex, pointId: point.pointId, channel: null, irKey: point.pointId });
            }
            continue;
        }
        for (const entry of point.channels || []) {
            if (entry?.ir?.stored === true && Number.isSafeInteger(entry.irId)) {
                candidates.push({
                    pointIndex,
                    pointId: point.pointId,
                    channel: entry.channel,
                    irKey: entry.irId
                });
            }
        }
    }
    return candidates;
}

export function resolveCalibrationIrCandidate(measurement, sourcePointId, sourceChannel = null) {
    return collectCalibrationIrCandidates(measurement).find(candidate =>
        candidate.pointId === sourcePointId && candidate.channel === sourceChannel
    ) || null;
}

export function averagePointAcrossChannels(point) {
    const channels = Array.isArray(point?.channels) ? point.channels : [];
    return {
        frequencyResponse: averageResponses(channels.map(entry => entry.frequencyResponse)),
        maxSignalLevel: averageLevels(channels.map(entry => entry.maxSignalLevel))
    };
}

export function resolveDisplayedResponse(measurement, pointIndex = null, channelToken = null) {
    const allPoints = pointIndex === null || pointIndex === undefined || pointIndex === 'all';
    const allChannels = channelToken === null || channelToken === undefined || channelToken === 'all';
    if (!isMultiChannelMeasurement(measurement)) {
        const source = allPoints ? measurement : measurement.points?.[pointIndex];
        return source ? {
            frequencyResponse: allPoints ? source.averageFrequencyResponse : source.frequencyResponse,
            maxSignalLevel: source.maxSignalLevel
        } : null;
    }
    if (allPoints) {
        const source = allChannels
            ? measurement
            : measurement.channelResponses?.find(entry => entry.channel === channelToken);
        return source ? {
            frequencyResponse: source.averageFrequencyResponse,
            maxSignalLevel: source.maxSignalLevel
        } : null;
    }
    const point = measurement.points?.[pointIndex];
    if (!point) return null;
    if (allChannels) return averagePointAcrossChannels(point);
    const entry = point.channels?.find(value => value.channel === channelToken);
    return entry ? {
        frequencyResponse: entry.frequencyResponse,
        maxSignalLevel: entry.maxSignalLevel
    } : null;
}

export function resolveDisplayedChannelCurves(measurement, pointIndex) {
    if (!isMultiChannelMeasurement(measurement) || !Number.isInteger(pointIndex)) return null;
    const point = measurement.points?.[pointIndex];
    if (!point) return null;
    return measurement.outputChannels.map(channel => point.channels?.find(entry => entry.channel === channel))
        .filter(Boolean)
        .map(entry => ({
            channel: entry.channel,
            frequencyResponse: entry.frequencyResponse,
            maxSignalLevel: entry.maxSignalLevel
        }));
}

export function visibleChannelCurves(curves, hoveredChannel = null) {
    if (!Array.isArray(curves)) return [];
    return hoveredChannel ? curves.filter(curve => curve.channel === hoveredChannel) : curves;
}

export function aggregateLevelWarnings(curves) {
    const low = [];
    const high = [];
    for (const curve of curves || []) {
        if (!Number.isFinite(curve.maxSignalLevel)) continue;
        if (curve.maxSignalLevel <= -36) low.push(curve.channel);
        if (curve.maxSignalLevel > -1) high.push(curve.channel);
    }
    return { low, high };
}

function impulseMetadata(result) {
    if (!result?.irValid || !(result.impulseResponse instanceof Float32Array)) return null;
    return {
        stored: true,
        length: result.impulseResponse.length,
        sampleRate: result.sampleRate,
        onsetIndex: result.onsetIndex,
        peakDb: result.peakDb,
        sweepLimited: result.sweepLimited
    };
}

export function mergeChannelRedoResult(point, records, channelToken, result, allocateId) {
    const current = point.channels?.find(entry => entry.channel === channelToken);
    if (!current) throw new Error(`The channel ${channelToken} is not part of this point.`);
    const ir = impulseMetadata(result);
    const irId = ir ? (Number.isSafeInteger(current.irId) ? current.irId : allocateId()) : null;
    const replacement = {
        channel: channelToken,
        frequencyResponse: result.frequencyResponse,
        maxSignalLevel: result.maxSignalLevel,
        ...(ir ? { irId, ir } : {})
    };
    const nextPoint = {
        ...point,
        channels: point.channels.map(entry => entry.channel === channelToken ? replacement : entry)
    };
    const nextRecords = (records || []).filter(record => record.pointId !== current.irId);
    if (ir) {
        nextRecords.push({
            measurementId: records?.[0]?.measurementId,
            pointId: irId,
            channel: channelToken,
            sampleRate: result.sampleRate,
            onsetIndex: result.onsetIndex,
            prerollSamples: result.prerollSamples,
            refScale: result.refScale,
            peakDb: result.peakDb,
            data: result.impulseResponse
        });
    }
    return { point: nextPoint, records: nextRecords };
}

export { averageResponses };
