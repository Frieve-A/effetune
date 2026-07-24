/**
 * Dependency-free radix-2 FFT used by measurement capture and Room EQ design.
 * The complex API is kept compatible with the measurement feature's original FFT.
 */
const planCache = new Map();

export default class FFT {
    constructor(size) {
        if (!Number.isSafeInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
            throw new TypeError('FFT size must be a power of two');
        }
        this.size = size;
        const cached = planCache.get(size);
        if (cached) {
            this.cosTable = cached.cosTable;
            this.sinTable = cached.sinTable;
            this.reverseTable = cached.reverseTable;
            this.radices = cached.radices;
            return;
        }
        this.cosTable = new Float32Array(size);
        this.sinTable = new Float32Array(size);
        this.reverseTable = new Uint32Array(size);
        let bits = Math.log2(size);
        this.radices = [];
        if (bits % 2 === 1) {
            this.radices.push(2);
            bits -= 1;
        }
        while (bits > 0) {
            this.radices.push(4);
            bits -= 2;
        }
        for (let index = 0; index < size; index += 1) {
            let value = index;
            const digits = new Uint8Array(this.radices.length);
            for (let digit = 0; digit < this.radices.length; digit += 1) {
                digits[digit] = value % this.radices[digit];
                value = Math.floor(value / this.radices[digit]);
            }
            let reversed = 0;
            let multiplier = 1;
            for (let digit = this.radices.length - 1; digit >= 0; digit -= 1) {
                reversed += digits[digit] * multiplier;
                multiplier *= this.radices[digit];
            }
            this.reverseTable[index] = reversed;
        }
        for (let index = 0; index < size; index += 1) {
            const angle = -2 * Math.PI * index / size;
            this.cosTable[index] = Math.cos(angle);
            this.sinTable[index] = Math.sin(angle);
        }
        planCache.set(size, {
            cosTable: this.cosTable,
            sinTable: this.sinTable,
            reverseTable: this.reverseTable,
            radices: this.radices
        });
    }

    transform(realOut, imagOut, realIn, imagIn) {
        const size = this.size;
        const sourceReal = realOut === realIn || imagOut === realIn ? Float64Array.from(realIn) : realIn;
        const sourceImag = imagIn && (realOut === imagIn || imagOut === imagIn)
            ? Float64Array.from(imagIn)
            : imagIn;
        for (let index = 0; index < size; index += 1) {
            const reversed = this.reverseTable[index];
            realOut[index] = sourceReal[reversed];
            imagOut[index] = sourceImag ? sourceImag[reversed] : 0;
        }
        let completed = 1;
        for (const radix of this.radices) {
            const length = completed * radix;
            const step = size / length;
            for (let start = 0; start < size; start += length) {
                for (let offset = 0; offset < completed; offset += 1) {
                    const first = start + offset;
                    const aReal = realOut[first];
                    const aImag = imagOut[first];
                    const twiddleIndex = offset * step;
                    const second = first + completed;
                    const bSourceReal = realOut[second];
                    const bSourceImag = imagOut[second];
                    const bCosine = this.cosTable[twiddleIndex];
                    const bSine = this.sinTable[twiddleIndex];
                    const bReal = bSourceReal * bCosine - bSourceImag * bSine;
                    const bImag = bSourceReal * bSine + bSourceImag * bCosine;
                    if (radix === 2) {
                        realOut[first] = aReal + bReal;
                        imagOut[first] = aImag + bImag;
                        realOut[second] = aReal - bReal;
                        imagOut[second] = aImag - bImag;
                        continue;
                    }
                    const third = second + completed;
                    const cSourceReal = realOut[third];
                    const cSourceImag = imagOut[third];
                    const cCosine = this.cosTable[twiddleIndex * 2];
                    const cSine = this.sinTable[twiddleIndex * 2];
                    const cReal = cSourceReal * cCosine - cSourceImag * cSine;
                    const cImag = cSourceReal * cSine + cSourceImag * cCosine;
                    const fourth = third + completed;
                    const dSourceReal = realOut[fourth];
                    const dSourceImag = imagOut[fourth];
                    const dCosine = this.cosTable[twiddleIndex * 3];
                    const dSine = this.sinTable[twiddleIndex * 3];
                    const dReal = dSourceReal * dCosine - dSourceImag * dSine;
                    const dImag = dSourceReal * dSine + dSourceImag * dCosine;
                    realOut[first] = aReal + bReal + cReal + dReal;
                    imagOut[first] = aImag + bImag + cImag + dImag;
                    realOut[second] = aReal + bImag - cReal - dImag;
                    imagOut[second] = aImag - bReal - cImag + dReal;
                    realOut[third] = aReal - bReal + cReal - dReal;
                    imagOut[third] = aImag - bImag + cImag - dImag;
                    realOut[fourth] = aReal - bImag - cReal + dImag;
                    imagOut[fourth] = aImag + bReal - cImag - dReal;
                }
            }
            completed = length;
        }
    }

    inverseTransform(realOut, imagOut, realIn, imagIn) {
        const size = this.size;
        const sourceReal = realOut === realIn ? Float64Array.from(realIn) : realIn;
        const sourceImag = imagOut === imagIn ? Float64Array.from(imagIn) : imagIn;
        const conjugated = new Float64Array(size);
        for (let index = 0; index < size; index += 1) conjugated[index] = -(sourceImag[index] || 0);
        this.transform(realOut, imagOut, sourceReal, conjugated);
        for (let index = 0; index < size; index += 1) {
            realOut[index] /= size;
            imagOut[index] = -imagOut[index] / size;
        }
    }

    /**
     * Transform real input and return the non-redundant spectrum.
     */
    realTransform(input) {
        const half = this.size / 2;
        const packedReal = new Float64Array(half);
        const packedImag = new Float64Array(half);
        for (let index = 0; index < half; index += 1) {
            packedReal[index] = input[index * 2] ?? 0;
            packedImag[index] = input[index * 2 + 1] ?? 0;
        }
        const halfFft = new FFT(half);
        const transformedReal = new Float64Array(half);
        const transformedImag = new Float64Array(half);
        halfFft.transform(transformedReal, transformedImag, packedReal, packedImag);
        const real = new Float64Array(half + 1);
        const imag = new Float64Array(half + 1);
        for (let index = 0; index <= half; index += 1) {
            const wrapped = index % half;
            const mirrored = (half - wrapped) % half;
            const aReal = transformedReal[wrapped];
            const aImag = transformedImag[wrapped];
            const bReal = transformedReal[mirrored];
            const bImag = -transformedImag[mirrored];
            const differenceReal = aReal - bReal;
            const differenceImag = aImag - bImag;
            const cosine = this.cosTable[index];
            const sine = this.sinTable[index];
            const rotatedReal = differenceReal * cosine - differenceImag * sine;
            const rotatedImag = differenceReal * sine + differenceImag * cosine;
            real[index] = 0.5 * (aReal + bReal + rotatedImag);
            imag[index] = 0.5 * (aImag + bImag - rotatedReal);
        }
        return { real, imag };
    }

    inverseRealTransform(realHalf, imagHalf = new Float64Array(realHalf.length)) {
        const real = new Float64Array(this.size);
        const imag = new Float64Array(this.size);
        const half = this.size / 2;
        for (let index = 0; index <= half; index += 1) {
            real[index] = realHalf[index] || 0;
            imag[index] = imagHalf[index] || 0;
        }
        for (let index = 1; index < half; index += 1) {
            real[this.size - index] = real[index];
            imag[this.size - index] = -imag[index];
        }
        const output = new Float64Array(this.size);
        this.inverseTransform(output, imag, real, imag);
        return output;
    }
}
