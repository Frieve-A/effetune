function decimalStep(roughStep, finerSteps = 0) {
    const factors = [1, 2, 5];
    let exponent = Math.floor(Math.log10(roughStep));
    let index = factors.findIndex(value => value * 10 ** exponent >= roughStep * (1 - 1e-12));
    if (index < 0) { index = 0; exponent++; }
    for (let i = 0; i < finerSteps; i++) {
        if (index === 0) { index = factors.length - 1; exponent--; }
        else index--;
    }
    return Number((factors[index] * 10 ** exponent).toPrecision(12));
}

export function finerDecimalStep(step, count = 1) {
    return decimalStep(step, count);
}

// Linear axes share zero-anchored intervals, including waterfall contours.
export function createLinearTicks(min, max, intervals, family = 'decimal') {
    const roughStep = (max - min) / Math.max(1, intervals);
    const threshold = roughStep * (1 - 1e-12);
    let step;
    if (family === 'decibels' && roughStep >= 0.1) {
        step = [0.1, 0.2, 0.5, 1, 3, 6, 12, 24].find(value => value >= threshold);
        if (!step) step = 24 * 2 ** Math.ceil(Math.log2(threshold / 24));
    } else {
        step = decimalStep(roughStep);
    }
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const first = Math.ceil(min / step - 1e-10);
    const last = Math.floor(max / step + 1e-10);
    // A short, offset axis still needs an in-range tick to show its scale.
    if (first > last) return createLinearTicks(min, max, Math.max(1, intervals) * 2, family);
    const ticks = [];
    for (let index = first; index <= last; index++) {
        const value = Number((index * step).toFixed(decimals));
        ticks.push({ value, label: String(value) });
    }
    return { step, ticks };
}

export function createFrequencyTicks(min, max, length) {
    const ticks = [];
    for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.floor(Math.log10(max)); exponent++) {
        for (const multiple of [1, 2, 5]) {
            const value = Number((multiple * 10 ** exponent).toPrecision(12));
            if (value < min || value > max) continue;
            const fraction = Math.log(value / min) / Math.log(max / min);
            if (ticks.length && (fraction - ticks.at(-1).fraction) * length < 65) continue;
            ticks.push({ value, fraction, label: value >= 1000 ? `${value / 1000}k` : String(value) });
        }
    }
    return ticks;
}
