import {
    getRequiredOutputChannelCount,
    MeasurementOutputError
} from './output-routing.js';

const INDIVIDUAL_CHANNELS = Object.freeze(['left', 'right', '2', '3', '4', '5', '6', '7']);
const CHANNEL_ORDER = new Map(INDIVIDUAL_CHANNELS.map((channel, index) => [channel, index]));

function canonicalChannelToken(value) {
    const token = String(value);
    if (token === 'both') return 'all';
    if (token === '0') return 'left';
    if (token === '1') return 'right';
    if (token === 'all' || CHANNEL_ORDER.has(token)) return token;
    throw new MeasurementOutputError(`Unsupported measurement output channel: ${token}`);
}

export function normalizeOutputChannelSelection(value) {
    const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    const channels = [...new Set(source.map(canonicalChannelToken))];
    const individual = channels.filter(channel => channel !== 'all');
    if (individual.length === 0) return ['all'];
    individual.sort((left, right) => CHANNEL_ORDER.get(left) - CHANNEL_ORDER.get(right));
    return individual;
}

export function resolveCheckboxToggle(previousSelection, token, checked) {
    const channel = canonicalChannelToken(token);
    const previous = normalizeOutputChannelSelection(previousSelection);
    if (checked && channel === 'all') return ['all'];

    const next = new Set(previous.filter(value => value !== 'all'));
    if (checked) next.add(channel);
    else next.delete(channel);
    return normalizeOutputChannelSelection([...next]);
}

export function selectionFromConfig(config = {}) {
    return normalizeOutputChannelSelection(
        Array.isArray(config.outputChannels) ? config.outputChannels : config.outputChannel
    );
}

export function isMultiChannelSelection(selection) {
    return normalizeOutputChannelSelection(selection).length > 1;
}

export function nextRotationChannel(selection, currentToken) {
    const channels = normalizeOutputChannelSelection(selection);
    const current = (() => {
        try {
            return canonicalChannelToken(currentToken);
        } catch (_) {
            return null;
        }
    })();
    const index = channels.indexOf(current);
    return index < 0 ? channels[0] : channels[(index + 1) % channels.length];
}

export function channelIndexOf(token) {
    const channel = canonicalChannelToken(token);
    if (channel === 'all') return null;
    return CHANNEL_ORDER.get(channel);
}

export function channelLabelKey(token) {
    const index = channelIndexOf(token);
    return index === null ? 'option:all' : index === 0 ? 'option:left' : index === 1 ? 'option:right' : `option:ch${index + 1}`;
}

export function channelDisplayLabel(token) {
    const index = channelIndexOf(token);
    return index === null ? 'All Channels' : `Ch ${index + 1}`;
}

export function peqChannelTokenFor(token) {
    const channel = canonicalChannelToken(token);
    if (channel === 'left') return 'L';
    if (channel === 'right') return 'R';
    if (CHANNEL_ORDER.has(channel)) return String(Number(channel) + 1);
    throw new MeasurementOutputError(`A PEQ channel cannot be created for ${channel}`);
}

export function maxRequiredChannelCount(selection) {
    const channels = normalizeOutputChannelSelection(selection);
    if (channels.length < 2 || channels.includes('all')) {
        throw new MeasurementOutputError('An explicit output width requires multiple individual channels.');
    }
    return channels.reduce(
        (maximum, channel) => Math.max(maximum, getRequiredOutputChannelCount(channel)),
        2
    );
}

export { INDIVIDUAL_CHANNELS };
