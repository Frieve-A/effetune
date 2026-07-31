"""Decoded analyzer telemetry records."""

from __future__ import annotations

from dataclasses import dataclass
import math
import struct
from typing import Literal


@dataclass(frozen=True, slots=True)
class TelemetryFrame:
    """Common metadata for a decoded analyzer observation."""

    kind: Literal["level", "oscilloscope", "spectrum", "spectrogram", "stereo"]
    effect_type: str
    effect_id: str | None
    effect_index: int
    sequence: int
    dropped: int


@dataclass(frozen=True, slots=True)
class LevelTelemetryChannel:
    peak: float
    rms: float
    clipped: bool


@dataclass(frozen=True, slots=True)
class LevelTelemetryFrame(TelemetryFrame):
    channels: tuple[LevelTelemetryChannel, ...]


@dataclass(frozen=True, slots=True)
class OscilloscopeTelemetryFrame(TelemetryFrame):
    sample_rate: float
    capture_sample_count: int
    trigger_offset: int
    triggered: bool
    encoding: Literal["samples", "minMax"]
    sample_indices: tuple[int, ...]
    values: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class SpectrumTelemetryFrame(TelemetryFrame):
    sample_rate: float
    points: int
    bins_truncated: bool
    current_db: tuple[float, ...]
    peak_db: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class SpectrogramTelemetryFrame(TelemetryFrame):
    sample_rate: float
    time_seconds: float
    points: int
    intensities: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class StereoTelemetryFrame(TelemetryFrame):
    sample_rate: float
    discontinuity: bool
    samples: tuple[tuple[float, float], ...]
    envelope: tuple[float, ...]
    correlation: float
    balance: float
    peak_left: float
    peak_right: float


_ANALYZER_FRAMES = {
    "LevelMeter": (1, 1),
    "Oscilloscope": (3, 2),
    "SpectrumAnalyzer": (4, 1),
    "Spectrogram": (5, 1),
    "StereoMeter": (6, 2),
}


def _common(
    kind: str,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> dict[str, object]:
    effect_type, effect_id, effect_index = node
    return {
        "kind": kind,
        "effect_type": effect_type,
        "effect_id": effect_id,
        "effect_index": effect_index,
        "sequence": sequence,
        "dropped": dropped,
    }


def _decode_level(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) < 16:
        return None
    channel_count = struct.unpack_from("<I", payload)[0]
    if not 1 <= channel_count <= 8 or len(payload) != 8 + channel_count * 8:
        return None
    clip_flags = struct.unpack_from("<I", payload, 4 + channel_count * 8)[0]
    if clip_flags & ~((1 << channel_count) - 1):
        return None
    channels = []
    for channel in range(channel_count):
        peak, rms = struct.unpack_from("<ff", payload, 4 + channel * 8)
        if not math.isfinite(peak) or peak < 0 or not math.isfinite(rms) or rms < 0:
            return None
        channels.append(LevelTelemetryChannel(peak, rms, bool(clip_flags & (1 << channel))))
    return LevelTelemetryFrame(
        **_common("level", node, sequence, dropped),
        channels=tuple(channels),
    )


def _decode_oscilloscope(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) < 20:
        return None
    sample_rate, capture_count, trigger_offset, bucket_count = struct.unpack_from(
        "<fIIH", payload
    )
    encoding = payload[14]
    flags = payload[15]
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or not 1 <= capture_count <= 65536
        or trigger_offset >= capture_count
        or flags & ~1
    ):
        return None
    if encoding == 0:
        if bucket_count != 0 or capture_count > 2048 or len(payload) != 16 + capture_count * 4:
            return None
        values = struct.unpack_from(f"<{capture_count}f", payload, 16)
        if any(not math.isfinite(value) for value in values):
            return None
        return OscilloscopeTelemetryFrame(
            **_common("oscilloscope", node, sequence, dropped),
            sample_rate=sample_rate,
            capture_sample_count=capture_count,
            trigger_offset=trigger_offset,
            triggered=bool(flags & 1),
            encoding="samples",
            sample_indices=tuple(range(capture_count)),
            values=values,
        )
    if (
        encoding != 1
        or capture_count <= 2048
        or bucket_count != 512
        or len(payload) != 16 + bucket_count * 18
    ):
        return None
    sample_indices: list[int] = []
    values_list: list[float] = []

    def append(sample_index: int, value: float) -> bool:
        if sample_indices and sample_indices[-1] == sample_index:
            return values_list[-1] == value
        sample_indices.append(sample_index)
        values_list.append(value)
        return True

    for bucket in range(bucket_count):
        begin = bucket * capture_count // bucket_count
        end = (bucket + 1) * capture_count // bucket_count
        first, minimum, maximum, last = struct.unpack_from("<ffff", payload, 16 + bucket * 18)
        minimum_offset, maximum_offset = struct.unpack_from("<BB", payload, 32 + bucket * 18)
        bucket_length = end - begin
        if (
            any(not math.isfinite(value) for value in (first, minimum, maximum, last))
            or minimum > maximum
            or not minimum <= first <= maximum
            or not minimum <= last <= maximum
            or minimum_offset >= bucket_length
            or maximum_offset >= bucket_length
        ):
            return None
        minimum_index = begin + minimum_offset
        maximum_index = begin + maximum_offset
        if not append(begin, first):
            return None
        ordered = (
            ((minimum_index, minimum), (maximum_index, maximum))
            if minimum_index <= maximum_index
            else ((maximum_index, maximum), (minimum_index, minimum))
        )
        if any(not append(index, value) for index, value in ordered):
            return None
        if not append(end - 1, last):
            return None
    return OscilloscopeTelemetryFrame(
        **_common("oscilloscope", node, sequence, dropped),
        sample_rate=sample_rate,
        capture_sample_count=capture_count,
        trigger_offset=trigger_offset,
        triggered=bool(flags & 1),
        encoding="minMax",
        sample_indices=tuple(sample_indices),
        values=tuple(values_list),
    )


def _decode_spectrum(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) < 28:
        return None
    sample_rate, bin_count, points, flags = struct.unpack_from("<fIHH", payload)
    full_bin_count = (1 << (points - 1)) + 1 if 8 <= points <= 14 else 0
    truncated = bool(flags & 1)
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or not full_bin_count
        or flags & ~1
        or len(payload) != 12 + bin_count * 8
        or (
            points == 14
            and (not truncated or bin_count != 8190 or full_bin_count - bin_count != 3)
        )
        or (points != 14 and (truncated or bin_count != full_bin_count))
    ):
        return None
    current = struct.unpack_from(f"<{bin_count}f", payload, 12)
    peaks = struct.unpack_from(f"<{bin_count}f", payload, 12 + bin_count * 4)
    if any(not math.isfinite(value) for value in current + peaks):
        return None
    return SpectrumTelemetryFrame(
        **_common("spectrum", node, sequence, dropped),
        sample_rate=sample_rate,
        points=points,
        bins_truncated=truncated,
        current_db=current,
        peak_db=peaks,
    )


def _decode_spectrogram(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) != 268:
        return None
    sample_rate, time_seconds, cell_count, points = struct.unpack_from("<ffHH", payload)
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or not math.isfinite(time_seconds)
        or cell_count != 256
        or not 8 <= points <= 14
    ):
        return None
    return SpectrogramTelemetryFrame(
        **_common("spectrogram", node, sequence, dropped),
        sample_rate=sample_rate,
        time_seconds=time_seconds,
        points=points,
        intensities=tuple(payload[12:268]),
    )


def _decode_stereo(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) < 1464:
        return None
    sample_rate, sample_count, flags = struct.unpack_from("<fHH", payload)
    expected_bytes = 8 + sample_count * 8 + 360 * 4 + 16
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or sample_count > 8000
        or flags & ~1
        or len(payload) != expected_bytes
    ):
        return None
    flat_samples = struct.unpack_from(f"<{sample_count * 2}f", payload, 8)
    if any(not math.isfinite(value) for value in flat_samples):
        return None
    samples = tuple(zip(flat_samples[::2], flat_samples[1::2], strict=True))
    envelope_offset = 8 + sample_count * 8
    envelope = struct.unpack_from("<360f", payload, envelope_offset)
    if any(not math.isfinite(value) or value < 0 for value in envelope):
        return None
    correlation, balance, peak_left, peak_right = struct.unpack_from(
        "<ffff", payload, envelope_offset + 360 * 4
    )
    if (
        not math.isfinite(correlation)
        or not -1 <= correlation <= 1
        or not math.isfinite(balance)
        or not math.isfinite(peak_left)
        or peak_left < 0
        or not math.isfinite(peak_right)
        or peak_right < 0
    ):
        return None
    return StereoTelemetryFrame(
        **_common("stereo", node, sequence, dropped),
        sample_rate=sample_rate,
        discontinuity=bool(flags & 1),
        samples=samples,
        envelope=envelope,
        correlation=correlation,
        balance=balance,
        peak_left=peak_left,
        peak_right=peak_right,
    )


_DECODERS = {
    1: _decode_level,
    3: _decode_oscilloscope,
    4: _decode_spectrum,
    5: _decode_spectrogram,
    6: _decode_stereo,
}


def _decode_telemetry_packet(
    packet: bytes,
    nodes_by_tap: dict[int, tuple[str, str | None, int]],
    initial_dropped: int,
) -> tuple[list[TelemetryFrame], int]:
    view = memoryview(packet)
    frames: list[TelemetryFrame] = []
    offset = 0
    pending_dropped = initial_dropped
    while offset < len(view):
        if len(view) - offset < 16:
            break
        frame_type, version, tap_id, sequence, payload_bytes = struct.unpack_from(
            "<HHIIH", view, offset
        )
        frame_bytes = (16 + payload_bytes + 3) & ~3
        if frame_bytes > len(view) - offset:
            break
        node = nodes_by_tap.get(tap_id)
        expected = _ANALYZER_FRAMES.get(node[0]) if node else None
        if expected == (frame_type, version):
            decoded = _DECODERS[frame_type](
                view[offset + 16 : offset + 16 + payload_bytes],
                node,
                sequence,
                pending_dropped,
            )
            if decoded is not None:
                frames.append(decoded)
                pending_dropped = 0
        offset += frame_bytes
    return frames, pending_dropped


__all__ = [
    "LevelTelemetryChannel",
    "LevelTelemetryFrame",
    "OscilloscopeTelemetryFrame",
    "SpectrogramTelemetryFrame",
    "SpectrumTelemetryFrame",
    "StereoTelemetryFrame",
    "TelemetryFrame",
]
