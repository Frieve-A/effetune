"""Minimal high-level Python API for the EffeTune DSP library Phase 0 PoC."""

from __future__ import annotations

import math

import numpy as np

from ._native import _NativeCompressor

_PARAMETER_RANGES = {
    "threshold": (-60.0, 0.0),
    "ratio": (0.5, 20.0),
    "attack": (0.1, 100.0),
    "release": (10.0, 1000.0),
    "knee": (0.0, 12.0),
    "gain": (-12.0, 12.0),
}


def _parameter(name: str, value: float) -> float:
    number = float(value)
    lower, upper = _PARAMETER_RANGES[name]
    if not math.isfinite(number) or number < lower or number > upper:
        raise ValueError(f"{name} must be between {lower:g} and {upper:g}")
    return number


class Compressor:
    """Offline compressor backed by the existing EffeTune C++ kernel."""

    def __init__(
        self,
        *,
        threshold: float = -24.0,
        ratio: float = 2.0,
        attack: float = 10.0,
        release: float = 100.0,
        knee: float = 3.0,
        gain: float = 0.0,
    ) -> None:
        self._native = _NativeCompressor(
            _parameter("threshold", threshold),
            _parameter("ratio", ratio),
            _parameter("attack", attack),
            _parameter("release", release),
            _parameter("knee", knee),
            _parameter("gain", gain),
        )

    def process(
        self,
        audio: np.ndarray,
        *,
        sample_rate: float,
        block_size: int = 128,
    ) -> np.ndarray:
        """Return a processed copy of planar float32 ``(channels, frames)`` audio."""
        if not isinstance(audio, np.ndarray):
            raise TypeError("audio must be a numpy.ndarray")
        if audio.dtype != np.float32:
            raise TypeError("audio dtype must be float32")
        if audio.ndim != 2:
            raise ValueError("audio shape must be (channels, frames)")
        if not audio.flags.c_contiguous:
            raise ValueError("audio must be C-contiguous planar data")
        if not isinstance(block_size, int) or isinstance(block_size, bool) or block_size <= 0:
            raise ValueError("block_size must be a positive integer")
        if not isinstance(sample_rate, (int, float)) or not math.isfinite(sample_rate) or sample_rate <= 0:
            raise ValueError("sample_rate must be a positive finite number")

        output = audio.copy(order="C")
        self._native.process_in_place(output, float(sample_rate), block_size)
        return output


__all__ = ["Compressor"]
