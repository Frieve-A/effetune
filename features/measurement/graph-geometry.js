export function createGraphGeometry({
    width,
    height,
    padding,
    minFrequency,
    maxFrequency,
    minValue,
    maxValue
}) {
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;
    const minLogFrequency = Math.log10(minFrequency);
    const logFrequencyRange = Math.log10(maxFrequency) - minLogFrequency;
    const valueRange = maxValue - minValue;

    return {
        frequencyToX(frequency) {
            return padding.left + graphWidth *
                (Math.log10(frequency) - minLogFrequency) / logFrequencyRange;
        },
        xToFrequency(x) {
            return 10 ** (minLogFrequency +
                ((x - padding.left) / graphWidth) * logFrequencyRange);
        },
        valueToY(value) {
            return padding.top + graphHeight - graphHeight * (value - minValue) / valueRange;
        },
        yToValue(y) {
            return maxValue - ((y - padding.top) / graphHeight) * valueRange;
        }
    };
}
