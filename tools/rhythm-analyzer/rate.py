"""Scalar FIR reference for the beat-only delay-compensated 24 kHz grid."""
import numpy as np
from numba import njit


@njit(fastmath=False)
def decimate(audio, coefficients, factor):
    half = (coefficients.size - 1) // 2
    count = max(0, (audio.size - 1 - half) // factor + 1)
    output = np.empty(count, np.float32)
    for sample in range(count):
        newest = half + sample * factor
        total = 0.0
        for tap in range(min(newest + 1, coefficients.size)):
            total += coefficients[tap] * np.float64(audio[newest - tap])
        output[sample] = np.float32(total)
    return output
