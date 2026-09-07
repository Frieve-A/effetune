export const CHANNEL_COLORS = Object.freeze([
    '#4e79a7', // theme-allow: Channel and response identity colors.
    '#f28e2b', // theme-allow: Channel and response identity colors.
    '#e15759', // theme-allow: Channel and response identity colors.
    '#76b7b2', // theme-allow: Channel and response identity colors.
    '#59a14f', // theme-allow: Channel and response identity colors.
    '#edc949', // theme-allow: Channel and response identity colors.
    '#af7aa1', // theme-allow: Channel and response identity colors.
    '#ff9da7' // theme-allow: Channel and response identity colors.
]);

export function channelColor(channel, outputChannels = []) {
    const index = outputChannels.indexOf(channel);
    return CHANNEL_COLORS[index >= 0 ? index % CHANNEL_COLORS.length : 0];
}
