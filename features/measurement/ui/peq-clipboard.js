const PEQ_DESCRIPTORS = {
    five: {
        name: '5Band PEQ',
        frequencies: [100, 316, 1000, 3160, 10000],
        patterns: {
            3: '10101',
            4: '11011',
            5: '11111'
        }
    },
    fifteen: {
        name: '15Band PEQ',
        frequencies: [
            25, 40, 63, 100, 160, 250, 400, 630, 1000,
            1600, 2500, 4000, 6300, 10000, 16000
        ],
        patterns: {
            6: '001010101010100',
            7: '010101010101010',
            8: '101010101010101',
            9: '101011010110101',
            10: '101101101101101',
            11: '101110111011101',
            12: '110111101111011',
            13: '111011111110111',
            14: '111111101111111',
            15: '111111111111111'
        }
    }
};

export function buildPEQClipboardPayload(measurement, bandCount) {
    const descriptor = bandCount >= 6 ? PEQ_DESCRIPTORS.fifteen : PEQ_DESCRIPTORS.five;
    const pattern = descriptor.patterns[bandCount] || '1'.repeat(descriptor.frequencies.length);
    const sortedParameters = [...measurement.peqParameters]
        .sort((left, right) => left.frequency - right.frequency);
    const effect = { nm: descriptor.name, en: true };

    if (measurement.outputChannel === 'left') effect.ch = 'L';
    else if (measurement.outputChannel === 'right') effect.ch = 'R';

    let parameterIndex = 0;
    for (let index = 0; index < descriptor.frequencies.length; index += 1) {
        const enabled = pattern[index] === '1';
        const parameter = enabled && parameterIndex < sortedParameters.length &&
            parameterIndex < bandCount ? sortedParameters[parameterIndex++] : null;
        effect[`f${index}`] = parameter ? parameter.frequency : descriptor.frequencies[index];
        effect[`g${index}`] = parameter ? parameter.gain : 0;
        effect[`q${index}`] = parameter ? parameter.Q : 1;
        effect[`t${index}`] = 'pk';
        effect[`e${index}`] = enabled;
    }

    return JSON.stringify([effect], null, 2);
}

export async function copyPEQClipboardPayload(measurement, bandCount, writeText) {
    const payload = buildPEQClipboardPayload(measurement, bandCount);
    if (!await writeText(payload)) throw new Error('Clipboard write was rejected');
    return payload;
}
