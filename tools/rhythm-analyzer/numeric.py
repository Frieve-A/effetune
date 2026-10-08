"""Ordered scalar arithmetic for the shipped T48M beat path.

Numba compiles these scalar loops with fastmath disabled. It does not replace the
reference with a BLAS, torch, CUDA, or reassociated convolution implementation.
"""
import hashlib
import math
from pathlib import Path

import numpy as np
from numba import njit

MODEL_SHA256 = "98219a84553a0a365dc8a5c6b5325cad3cd2ef2d6cdf80dcaaebc12e97948f5d"
MODEL_BYTES = 266494
SR, HOP = 24000, 256
FPS, DT = SR / HOP, HOP / SR
LATENCY = 1024 / (2 * SR)
T0 = DT - LATENCY
CHANNELS, INPUTS, OUTPUTS, LAYERS, TAPS = 48, 500, 63, 9, 5
RING_ROWS = (TAPS - 1) * ((1 << LAYERS) - 1) + LAYERS


@njit(fastmath=False)
def half_code(value):
    """Float32 to binary16, integer round-to-nearest-even, including subnormals."""
    bits = np.float32(value).view(np.uint32)
    sign, a = (bits >> 16) & 0x8000, bits & 0x7fffffff
    if a >= 0x7f800000:
        return np.uint16(sign | (0x7e00 if a > 0x7f800000 else 0x7c00))
    if a >= 0x477ff000:
        return np.uint16(sign | 0x7c00)
    if a >= 0x38800000:
        return np.uint16(sign | ((a - 0x38000000 + 0xfff + ((a >> 13) & 1)) >> 13))
    if a <= 0x33000000:
        return np.uint16(sign)
    shift = 126 - (a >> 23)
    m = (a & 0x7fffff) | 0x800000
    q, rest, midpoint = m >> shift, m & ((1 << shift) - 1), 1 << (shift - 1)
    return np.uint16(sign | (q + (rest > midpoint or (rest == midpoint and (q & 1)))))


@njit(fastmath=False)
def half_value(code):
    """Exact binary16 decoding; finite half subnormals become normal float32."""
    h = np.uint32(code)
    sign = (h & 0x8000) << 16
    exponent = h & 0x7c00
    if exponent == 0:
        small = np.float32(np.int32(h & 0x3ff)) * np.float32(2.0 ** -24)
        bits = np.float32(small).view(np.uint32) | sign
    elif exponent == 0x7c00:
        bits = sign | 0x7f800000 | ((h & 0x3ff) << 13)
    else:
        bits = sign | (((h & 0x7fff) << 13) + (112 << 23))
    return np.uint32(bits).view(np.float32)


@njit(fastmath=False)
def encode_half(values):
    result = np.empty(values.size, np.uint16)
    flat = values.reshape(values.size)
    for i in range(values.size):
        result[i] = half_code(flat[i])
    return result


@njit(fastmath=False)
def decode_half(codes):
    result = np.empty(codes.size, np.float32)
    flat = codes.reshape(codes.size)
    for i in range(codes.size):
        result[i] = half_value(flat[i])
    return result


@njit(fastmath=False)
def portable_exp(value):
    if math.isnan(value):
        return value
    if value < -745.2:
        return 0.0
    if value > 709.8:
        return math.inf
    index = math.floor(value * 1.4426950408889634074 + 0.5)
    remainder = (value - index * 6.93147180369123816490e-1) - index * 1.90821492927058770002e-10
    series = 1.0 / 6227020800.0
    for denominator in (479001600.0, 39916800.0, 3628800.0, 362880.0, 40320.0,
                        5040.0, 720.0, 120.0, 24.0, 6.0, 2.0, 1.0, 1.0):
        series = series * remainder + 1.0 / denominator
    return math.ldexp(series, int(index))


@njit(fastmath=False)
def portable_log(value):
    if math.isnan(value):
        return value
    if value < 0.0:
        return math.nan
    if value == 0.0:
        return -math.inf
    mantissa, exponent = math.frexp(value)
    if mantissa < 0.70710678118654752440:
        mantissa *= 2.0
        exponent -= 1
    s = (mantissa - 1.0) / (mantissa + 1.0)
    square = s * s
    series = 1.0 / 25.0
    for denominator in (23.0, 21.0, 19.0, 17.0, 15.0, 13.0, 11.0, 9.0, 7.0, 5.0, 3.0, 1.0):
        series = series * square + 1.0 / denominator
    return (exponent * 6.93147180369123816490e-1 + 2.0 * s * series) + exponent * 1.90821492927058770002e-10


@njit(fastmath=False)
def portable_sincos(value):
    index = math.floor(value * 0.63661977236758134308 + 0.5)
    r = value - index * 1.57079632673412561417
    r -= index * 6.07710050650619224932e-11
    r -= index * 2.02226624879595063154e-21
    quadrant = int(index) & 3
    square = r * r
    s = -1.0 / 355687428096000.0
    s = s * square + 1.0 / 1307674368000.0
    s = s * square - 1.0 / 6227020800.0
    s = s * square + 1.0 / 39916800.0
    s = s * square - 1.0 / 362880.0
    s = s * square + 1.0 / 5040.0
    s = s * square - 1.0 / 120.0
    s = s * square + 1.0 / 6.0
    sine = r - r * square * s
    c = -1.0 / 6402373705728000.0
    c = c * square + 1.0 / 20922789888000.0
    c = c * square - 1.0 / 87178291200.0
    c = c * square + 1.0 / 479001600.0
    c = c * square - 1.0 / 3628800.0
    c = c * square + 1.0 / 40320.0
    c = c * square - 1.0 / 720.0
    c = c * square + 1.0 / 24.0
    c = c * square - 0.5
    cosine = 1.0 + square * c
    if quadrant == 0:
        return sine, cosine
    if quadrant == 1:
        return cosine, -sine
    if quadrant == 2:
        return -sine, -cosine
    return -cosine, sine


# The atan/atan2 polynomials are derived from fdlibm 5.3.
# Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
# Developed at SunSoft, a Sun Microsystems, Inc. business.
# Permission to use, copy, modify, and distribute this software is freely
# granted, provided that this notice is preserved.
ATAN_HI = np.array([0x3fddac670561bb4f, 0x3fe921fb54442d18, 0x3fef730bd281f69b,
                    0x3ff921fb54442d18], np.uint64).view(np.float64)
ATAN_LO = np.array([0x3c7a2b7f222f65e2, 0x3c81a62633145c07, 0x3c7007887af0cbbd,
                    0x3c91a62633145c07], np.uint64).view(np.float64)
ATAN_T = np.array([0x3fd555555555550d, 0xbfc999999998ebc4, 0x3fc24924920083ff,
                  0xbfbc71c6fe231671, 0x3fb745cdc54c206e, 0xbfb3b0f2af749a6d,
                  0x3fb10d66a0d03d51, 0xbfadde2d52defd9a, 0x3fa97b4b24760deb,
                  0xbfa2b4442c6a6c2f, 0x3f90ad3ae322da11], np.uint64).view(np.float64)


@njit(fastmath=False)
def portable_atan(x):
    bits = np.float64(x).view(np.uint64)
    hx = np.int32(bits >> 32)
    ix = hx & 0x7fffffff
    index = -1
    if ix >= 0x44100000:
        if ix > 0x7ff00000 or (ix == 0x7ff00000 and (bits & 0xffffffff) != 0):
            return x + x
        return ATAN_HI[3] + ATAN_LO[3] if hx > 0 else -ATAN_HI[3] - ATAN_LO[3]
    if ix < 0x3fdc0000:
        if ix < 0x3e200000:
            return x
    else:
        x = -x if hx < 0 else x
        if ix < 0x3ff30000:
            if ix < 0x3fe60000:
                index, x = 0, (2.0 * x - 1.0) / (2.0 + x)
            else:
                index, x = 1, (x - 1.0) / (x + 1.0)
        elif ix < 0x40038000:
            index, x = 2, (x - 1.5) / (1.0 + 1.5 * x)
        else:
            index, x = 3, -1.0 / x
    z, w = x * x, (x * x) * (x * x)
    s1 = z * (ATAN_T[0] + w * (ATAN_T[2] + w * (ATAN_T[4] + w * (ATAN_T[6] + w * (ATAN_T[8] + w * ATAN_T[10])))))
    s2 = w * (ATAN_T[1] + w * (ATAN_T[3] + w * (ATAN_T[5] + w * (ATAN_T[7] + w * ATAN_T[9]))))
    if index < 0:
        return x - x * (s1 + s2)
    result = ATAN_HI[index] - ((x * (s1 + s2) - ATAN_LO[index]) - x)
    return -result if hx < 0 else result


@njit(fastmath=False)
def portable_atan2(y, x):
    bx, by = np.float64(x).view(np.uint64), np.float64(y).view(np.uint64)
    hx, hy = np.int32(bx >> 32), np.int32(by >> 32)
    ix, iy = hx & 0x7fffffff, hy & 0x7fffffff
    lx, ly = np.uint32(bx), np.uint32(by)
    pi4, pi2, pi, pi_lo = ATAN_HI[1], ATAN_HI[3], 3.141592653589793, 1.2246467991473532e-16
    if math.isnan(x) or math.isnan(y):
        return x + y
    if bx == 0x3ff0000000000000:
        return portable_atan(y)
    quadrant = (1 if hy < 0 else 0) | (2 if hx < 0 else 0)
    if (iy | ly) == 0:
        return y if quadrant < 2 else (pi if quadrant == 2 else -pi)
    if (ix | lx) == 0:
        return -pi2 if hy < 0 else pi2
    if ix == 0x7ff00000:
        if iy == 0x7ff00000:
            return (pi4, -pi4, 3.0 * pi4, -3.0 * pi4)[quadrant]
        return (0.0, -0.0, pi, -pi)[quadrant]
    if iy == 0x7ff00000:
        return -pi2 if hy < 0 else pi2
    k = (iy - ix) >> 20
    if k > 60:
        z = pi2 + .5 * pi_lo
    elif hx < 0 and k < -60:
        z = 0.0
    else:
        z = portable_atan(abs(y / x))
    if quadrant == 0:
        return z
    if quadrant == 1:
        return -z
    if quadrant == 2:
        return pi - (z - pi_lo)
    return (z - pi_lo) - pi


@njit(fastmath=False)
def elu(value):
    return value if value > np.float32(0.0) else np.float32(portable_exp(np.float64(value)) - 1.0)


def tensor_layout():
    result = [("mu", (INPUTS,), "<f4"), ("sd", (INPUTS,), "<f4"),
              ("inp.weight", (CHANNELS, INPUTS), "<u2"), ("inp.bias", (CHANNELS,), "<u2")]
    for layer in range(LAYERS):
        result.extend([(f"convs.{layer}.weight", (CHANNELS, CHANNELS, TAPS), "<u2"),
                       (f"convs.{layer}.bias", (CHANNELS,), "<u2")])
    result.extend([("out.weight", (OUTPUTS, CHANNELS), "<u2"), ("out.bias", (OUTPUTS,), "<u2")])
    return result


def read_model(path):
    blob = Path(path).read_bytes()
    if len(blob) != MODEL_BYTES or hashlib.sha256(blob).hexdigest() != MODEL_SHA256:
        raise ValueError("The input is not the frozen T48M binary export.")
    result, offset = {}, 0
    for name, shape, dtype in tensor_layout():
        count = math.prod(shape)
        result[name] = np.frombuffer(blob, dtype=dtype, count=count, offset=offset).reshape(shape).copy()
        offset += count * np.dtype(dtype).itemsize
    return result


class Tcn:
    def __init__(self, tensors):
        self.mu, self.sd = tensors["mu"], tensors["sd"]
        self.inw = decode_half(tensors["inp.weight"]).reshape(CHANNELS, INPUTS).T.copy()
        self.inb = decode_half(tensors["inp.bias"])
        self.convw = np.stack([decode_half(tensors[f"convs.{l}.weight"])
                               .reshape(CHANNELS, CHANNELS, TAPS).transpose(1, 2, 0)
                               for l in range(LAYERS)])
        self.convb = np.stack([decode_half(tensors[f"convs.{l}.bias"]) for l in range(LAYERS)])
        self.outw = decode_half(tensors["out.weight"]).reshape(OUTPUTS, CHANNELS).T.copy()
        self.outb = decode_half(tensors["out.bias"])
        self.reset()

    def reset(self):
        self.ring = np.zeros((RING_ROWS, CHANNELS), np.uint16)
        self.head = np.zeros(LAYERS, np.int64)

    def run(self, features):
        return tcn_run(np.asarray(features, np.float32), self.mu, self.sd, self.inw, self.inb,
                       self.convw, self.convb, self.outw, self.outb, self.ring, self.head)


@njit(fastmath=False)
def tcn_run(features, mu, sd, inw, inb, convw, convb, outw, outb, ring, heads):
    ticks = features.shape[0]
    logits = np.empty((ticks, OUTPUTS), np.float32)
    beat = np.empty((ticks, 2), np.float32)
    tempo = np.empty((ticks, 61), np.float32)
    h, y = np.empty(CHANNELS, np.float32), np.empty(CHANNELS, np.float32)
    for tick in range(ticks):
        for o in range(CHANNELS):
            h[o] = inb[o]
        for c in range(INPUTS):
            x = np.float32(np.float32(features[tick, c] - mu[c]) / sd[c])
            for o in range(CHANNELS):
                product = np.float32(inw[c, o] * x)
                h[o] = np.float32(h[o] + product)
        offset = 0
        for l in range(LAYERS):
            dilation, rows, head = 1 << l, 4 * (1 << l) + 1, heads[l]
            for c in range(CHANNELS):
                ring[offset + head, c] = half_code(h[c])
            for o in range(CHANNELS):
                y[o] = convb[l, o]
            for c in range(CHANNELS):
                for tap in range(TAPS):
                    row = offset + ((head + rows - (4 - tap) * dilation) % rows)
                    x = half_value(ring[row, c])
                    for o in range(CHANNELS):
                        product = np.float32(convw[l, c, tap, o] * x)
                        y[o] = np.float32(y[o] + product)
            for o in range(CHANNELS):
                h[o] = np.float32(h[o] + elu(y[o]))
            heads[l] = 0 if head + 1 == rows else head + 1
            offset += rows
        for o in range(OUTPUTS):
            logits[tick, o] = outb[o]
        for c in range(CHANNELS):
            x = elu(h[c])
            for o in range(OUTPUTS):
                product = np.float32(outw[c, o] * x)
                logits[tick, o] = np.float32(logits[tick, o] + product)
        for o in range(2):
            beat[tick, o] = np.float32(1.0 / (1.0 + portable_exp(-np.float64(logits[tick, o]))))
        top = logits[tick, 2]
        for o in range(3, OUTPUTS):
            if logits[tick, o] > top:
                top = logits[tick, o]
        e, total = np.empty(61, np.float64), 0.0
        for o in range(61):
            e[o] = portable_exp(np.float64(logits[tick, o + 2]) - np.float64(top))
            total += e[o]
        for o in range(61):
            tempo[tick, o] = half_value(half_code(np.float32(e[o] / total)))
    return logits, beat, tempo


def fft_twiddles():
    twiddle = np.empty((2048, 2), np.float64)
    for k in range(2048):
        sine, cosine = portable_sincos(6.283185307179586 * k / 4096.0)
        twiddle[k] = cosine, -sine
    return twiddle


@njit(fastmath=False)
def real_magnitudes(frame, window, twiddle):
    n, m = frame.size, frame.size // 2
    re, im = np.empty(m, np.float64), np.empty(m, np.float64)
    for i in range(m):
        re[i] = float(np.float32(frame[2 * i] * window[2 * i]))
        im[i] = float(np.float32(frame[2 * i + 1] * window[2 * i + 1]))
    j = 0
    for i in range(1, m):
        bit = m >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]
    length = 2
    while length <= m:
        half, step = length // 2, 4096 // length
        for i in range(0, m, length):
            for k in range(half):
                wr, wi = twiddle[k * step]
                a, b = i + k, i + k + half
                xr, xi = re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr
                re[b], im[b] = re[a] - xr, im[a] - xi
                re[a], im[a] = re[a] + xr, im[a] + xi
        length <<= 1
    result = np.empty(n // 2 + 1, np.float32)
    result[0], result[m] = np.float32(abs(re[0] + im[0])), np.float32(abs(re[0] - im[0]))
    step = 2048 // m
    for k in range(1, m):
        zr, zi, cr, ci = re[k], im[k], re[m - k], -im[m - k]
        er, ei, oddr, oddi = (zr + cr) * .5, (zi + ci) * .5, (zr - cr) * .5, (zi - ci) * .5
        wr, wi = twiddle[k * step]
        xr, xi = er + (wr * oddi + wi * oddr), ei - (wr * oddr - wi * oddi)
        result[k] = np.float32(math.sqrt(xr * xr + xi * xi))
    return result


@njit(fastmath=False)
def feature_group(audio, window, bands, weights, twiddle):
    ticks = audio.size // HOP
    output = np.empty((ticks, bands.shape[0]), np.float32)
    frame = np.empty(window.size, np.float32)
    for tick in range(ticks):
        start = (tick + 1) * HOP - window.size
        for i in range(window.size):
            frame[i] = audio[start + i] if start + i >= 0 else np.float32(0.0)
        magnitudes = real_magnitudes(frame, window, twiddle)
        for band in range(bands.shape[0]):
            first, count, offset = bands[band]
            total = np.float32(0.0)
            for i in range(count):
                product = np.float32(magnitudes[first + i] * weights[offset + i])
                total = np.float32(total + product)
            output[tick, band] = np.float32(portable_log(float(np.float32(1.0) + total)) / 2.302585092994046)
    return output


def features(audio, tables):
    groups = []
    twiddle = fft_twiddles()
    for n in (512, 1024, 2048):
        groups.append(feature_group(np.asarray(audio, np.float32), tables[f"hann{n}"],
                                    tables[f"bands{n}"], tables["weights"], twiddle))
    logs = np.concatenate(groups, axis=1)
    delta = np.empty_like(logs)
    delta[0] = logs[0]
    delta[1:] = np.maximum(logs[1:] - logs[:-1], np.float32(0.0))
    return np.concatenate((logs, delta), axis=1)
