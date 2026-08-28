export const CHANNEL_COLORS = Object.freeze([
    '#4e79a7',
    '#f28e2b',
    '#e15759',
    '#76b7b2',
    '#59a14f',
    '#edc949',
    '#af7aa1',
    '#ff9da7'
]);

export function channelColor(channel, outputChannels = []) {
    const index = outputChannels.indexOf(channel);
    return CHANNEL_COLORS[index >= 0 ? index % CHANNEL_COLORS.length : 0];
}
