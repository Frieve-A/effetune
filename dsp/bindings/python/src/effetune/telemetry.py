"""Decoded analyzer telemetry records."""

from __future__ import annotations

from dataclasses import dataclass
import math
import struct
from typing import Literal


@dataclass(frozen=True, slots=True)
class TelemetryFrame:
    """Common metadata for a decoded analyzer observation."""

    kind: Literal[
        "analogMeter",
        "level",
        "noteSpectrogram",
        "oscilloscope",
        "pitch",
        "rhythmAnalyzer",
        "spectrum",
        "spectrumHq",
        "spectrogram",
        "spectrogramHq",
        "stereo",
        "tonalBalance",
    ]
    effect_type: str
    effect_id: str | None
    effect_index: int
    sequence: int
    dropped: int


@dataclass(frozen=True, slots=True)
class AnalogMeterTelemetryChannel:
    """Needle and maximum dB, or channel Momentary and Short-term LUFS in Loudness mode."""

    needle_db: float
    max_db: float


@dataclass(frozen=True, slots=True)
class AnalogMeterTelemetryProgram:
    """Program loudness; integrated and lra are 0 until their validity flags are set."""

    momentary: float
    short_term: float
    integrated: float
    lra: float
    max_true_peak: float
    integrated_seconds: float


@dataclass(frozen=True, slots=True)
class AnalogMeterTelemetryFrame(TelemetryFrame):
    mode: int
    channel_count: int
    integrated_valid: bool
    lra_valid: bool
    channels: tuple[AnalogMeterTelemetryChannel, ...]
    program: AnalogMeterTelemetryProgram | None


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
class NoteSpectrogramRevision:
    age: Literal[2, 4, 8]
    levels: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class NoteSpectrogramTelemetryFrame(TelemetryFrame):
    sample_rate: float
    time_seconds: float
    first_midi: Literal[21]
    hop_seconds: float
    frame_index: int
    divisions_per_semitone: Literal[5]
    generation: int
    revision_age: Literal[0, 8]
    levels: tuple[float, ...]
    volume_db: tuple[float, ...]
    revised_levels: tuple[float, ...] | None
    revisions: tuple[NoteSpectrogramRevision, ...]


@dataclass(frozen=True, slots=True)
class PitchMeterTelemetryFrame(TelemetryFrame):
    sample_rate: float
    time_seconds: float
    hop_seconds: float
    frame_index: int
    generation: int
    f0_hz: float
    midi: float
    cents: float
    confidence: float
    level_db: float
    voiced: bool


@dataclass(frozen=True, slots=True)
class RhythmAnalyzerTelemetryEvent:
    """One rhythm event; its time is ``(frame + fraction)`` envelope frames, bias-corrected."""

    frame: int
    fraction: float
    lock_epoch: int
    beat_index: int
    beat_fraction: float
    period_seconds: float
    strength: float
    band: int
    unlocked: bool
    flags: int = 0


@dataclass(frozen=True, slots=True)
class RhythmAnalyzerTelemetryBeat:
    """A revisable beat in the current best display path."""

    frame: int
    fraction: float
    beat_index: int


@dataclass(frozen=True, slots=True)
class RhythmAnalyzerTelemetryFrame(TelemetryFrame):
    sample_rate: float
    generation: int
    envelope_hop_samples: int
    envelope_frame_count: int
    time_seconds: float
    latency_seconds: float
    dropped_events: int
    locked: bool
    lock_epoch: int
    confidence: float
    period_seconds: float
    next_beat_frame: int
    next_beat_fraction: float
    next_beat_index: int
    comb_best_bpm: float
    tempogram: tuple[float, ...]
    events: tuple[RhythmAnalyzerTelemetryEvent, ...]
    preview_period_seconds: float = 0.0
    preview_beats: tuple[RhythmAnalyzerTelemetryBeat, ...] = ()


@dataclass(frozen=True, slots=True)
class SpectrogramTelemetryFrame(TelemetryFrame):
    sample_rate: float
    time_seconds: float
    points: int
    intensities: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class SpectrumHqTelemetryFrame(TelemetryFrame):
    sample_rate: float
    points: int
    hop: int
    generation: int
    capture_end: int
    frame_index: int
    cell_count: int
    min_frequency: float
    max_frequency: float
    first_valid_index: int
    valid_cell_count: int
    current_db: tuple[float, ...]
    peak_db: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class SpectrogramHqTelemetryFrame(TelemetryFrame):
    sample_rate: float
    points: int
    hop: int
    generation: int
    capture_end: int
    frame_index: int
    cell_count: int
    min_frequency: float
    max_frequency: float
    first_valid_index: int
    valid_cell_count: int
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


@dataclass(frozen=True, slots=True)
class TonalBalanceEQTelemetryFrame(TelemetryFrame):
    """Measured band levels, active target and applied response (41 bands, 128 points)."""

    sample_rate: float
    target_index: int
    absolute_gate: bool
    relative_gate: bool
    loudness_valid: bool
    target_valid: bool
    loudness_lkfs: float
    makeup_db: float
    gated_hop_count: int
    level_db: tuple[float, ...]
    persistence: tuple[float, ...]
    presence: tuple[float, ...]
    command_db: tuple[float, ...]
    target_mu_db: tuple[float, ...]
    target_sigma_db: tuple[float, ...]
    band_flags: tuple[int, ...]
    response_db: tuple[float, ...]


_ANALYZER_FRAMES = {
    "AnalogMeter": (27, (1,)),
    "ChromaSpiral": (4, (2,)),
    "LevelMeter": (1, (1,)),
    "NoteSpectrogram": (24, (5,)),
    "Oscilloscope": (3, (2,)),
    "PitchMeter": (26, (1,)),
    "RhythmAnalyzer": (28, (1, 3, 4)),
    "SpectrumAnalyzer": (4, (1, 2)),
    "Spectrogram": (5, (1, 2)),
    "StereoMeter": (6, (2,)),
    "TonalBalanceEQ": (29, (1,)),
}

_MULTIRES_HQ_MIN_FREQUENCY = 20.0
_MULTIRES_HQ_MAX_FREQUENCY = 40_000.0
_MULTIRES_HQ_SPECTRUM_CELLS = 2048
_MULTIRES_HQ_SPECTROGRAM_CELLS = 256
_PITCH_METER_MIN_DETECTED_MIDI = 20.5
_PITCH_METER_MAX_DETECTED_MIDI = 108.5
_ANALOG_METER_LOUDNESS_MODE = 5
_ANALOG_METER_MIN_DB = -240.0
_RHYTHM_ANALYZER_PAYLOAD_BYTES = 1344
_RHYTHM_ANALYZER_TEMPOGRAM_BINS = 192
_RHYTHM_ANALYZER_MAX_EVENTS = 16
_TONAL_BALANCE_PAYLOAD_BYTES = 1564
_TONAL_BALANCE_BANDS = 41
_TONAL_BALANCE_GRID_POINTS = 128


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
    if not 1 <= channel_count <= 16 or len(payload) != 8 + channel_count * 8:
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


def _decode_multires_hq(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
    frame_type: int,
) -> TelemetryFrame | None:
    if len(payload) < 48:
        return None
    (
        sample_rate,
        points,
        flags,
        hop,
        generation,
        capture_end,
        frame_index,
        cell_count,
        min_frequency,
        max_frequency,
        first_valid_index,
        valid_cell_count,
    ) = struct.unpack_from("<fHHIIQIIffII", payload)
    is_spectrum = frame_type == 4
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or not 8 <= points <= 14
        or flags != 0
        or generation == 0
    ):
        return None
    expected_cell_count = (
        _MULTIRES_HQ_SPECTRUM_CELLS
        if is_spectrum
        else _MULTIRES_HQ_SPECTROGRAM_CELLS
    )
    size = 1 << points
    expected_hop = (
        max(size // 2, math.ceil(sample_rate / 30))
        if is_spectrum
        else size // 2
    )
    if (
        cell_count != expected_cell_count
        or hop != expected_hop
        or min_frequency != _MULTIRES_HQ_MIN_FREQUENCY
        or max_frequency != _MULTIRES_HQ_MAX_FREQUENCY
    ):
        return None
    expected_first_valid_index = cell_count
    expected_valid_cell_count = 0
    log_step = math.log(
        _MULTIRES_HQ_MAX_FREQUENCY / _MULTIRES_HQ_MIN_FREQUENCY
    ) / (cell_count - 1)
    for index in range(cell_count):
        ascending = index if is_spectrum else cell_count - 1 - index
        frequency = (
            _MULTIRES_HQ_MAX_FREQUENCY
            if ascending == cell_count - 1
            else _MULTIRES_HQ_MIN_FREQUENCY * math.exp(ascending * log_step)
        )
        if frequency <= sample_rate * 0.5:
            if expected_first_valid_index == cell_count:
                expected_first_valid_index = index
            expected_valid_cell_count += 1
    if expected_valid_cell_count == 0:
        expected_first_valid_index = 0
    value_bytes = cell_count * 8 if is_spectrum else cell_count
    if (
        first_valid_index != expected_first_valid_index
        or valid_cell_count != expected_valid_cell_count
        or len(payload) != 48 + value_bytes
    ):
        return None
    metadata = {
        "sample_rate": sample_rate,
        "points": points,
        "hop": hop,
        "generation": generation,
        "capture_end": capture_end,
        "frame_index": frame_index,
        "cell_count": cell_count,
        "min_frequency": min_frequency,
        "max_frequency": max_frequency,
        "first_valid_index": first_valid_index,
        "valid_cell_count": valid_cell_count,
    }
    if is_spectrum:
        current_db = struct.unpack_from(f"<{cell_count}f", payload, 48)
        peak_db = struct.unpack_from(f"<{cell_count}f", payload, 48 + cell_count * 4)
        if any(not math.isfinite(value) for value in current_db + peak_db):
            return None
        return SpectrumHqTelemetryFrame(
            **_common("spectrumHq", node, sequence, dropped),
            **metadata,
            current_db=current_db,
            peak_db=peak_db,
        )
    return SpectrogramHqTelemetryFrame(
        **_common("spectrogramHq", node, sequence, dropped),
        **metadata,
        intensities=tuple(payload[48:]),
    )


def _decode_note_spectrogram(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) != 8840:
        return None
    (
        sample_rate,
        time_seconds,
        pitch_count,
        first_midi,
        hop_seconds,
        frame_index,
        divisions,
        generation,
        revision_age,
    ) = struct.unpack_from("<ffHHfIIII", payload)
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or not math.isfinite(time_seconds)
        or time_seconds < 0
        or pitch_count != 440
        or first_midi != 21
        or not math.isfinite(hop_seconds)
        or hop_seconds <= 0
        or divisions != 5
        or generation == 0
        or revision_age not in (0, 8)
    ):
        return None
    levels = struct.unpack_from("<440f", payload, 32)
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in levels):
        return None
    volume_db = struct.unpack_from("<440f", payload, 32 + 440 * 4)
    if any(not math.isfinite(value) for value in volume_db):
        return None
    revisions = []
    for expected_age, age_offset, levels_offset in ((2, 5312, 5316), (4, 7076, 7080), (8, 28, 3552)):
        age = struct.unpack_from("<I", payload, age_offset)[0]
        if age not in (0, expected_age):
            return None
        if age == 0:
            continue
        revised = struct.unpack_from("<440f", payload, levels_offset)
        if any(not math.isfinite(value) or not 0 <= value <= 1 for value in revised):
            return None
        revisions.append(NoteSpectrogramRevision(age=age, levels=revised))
    revised_levels = next((revision.levels for revision in revisions if revision.age == 8), None)
    return NoteSpectrogramTelemetryFrame(
        **_common("noteSpectrogram", node, sequence, dropped),
        sample_rate=sample_rate,
        time_seconds=time_seconds,
        first_midi=first_midi,
        hop_seconds=hop_seconds,
        frame_index=frame_index,
        divisions_per_semitone=divisions,
        generation=generation,
        revision_age=revision_age,
        levels=levels,
        volume_db=volume_db,
        revised_levels=revised_levels,
        revisions=tuple(revisions),
    )


def _decode_pitch_meter(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) != 44:
        return None
    (
        sample_rate,
        time_seconds,
        hop_seconds,
        frame_index,
        generation,
        f0_hz,
        midi,
        cents,
        confidence,
        level_db,
        flags,
        reserved,
    ) = struct.unpack_from("<fffIIfffffHH", payload)
    voiced = bool(flags & 1)
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or not math.isfinite(time_seconds)
        or time_seconds < 0
        or not math.isfinite(hop_seconds)
        or hop_seconds <= 0
        or generation == 0
        or not all(
            math.isfinite(value)
            for value in (f0_hz, midi, cents, confidence, level_db)
        )
        or not 0 <= confidence <= 1
        or flags & ~1
        or reserved != 0
        or (
            voiced
            and (
                f0_hz <= 0
                or midi < _PITCH_METER_MIN_DETECTED_MIDI
                or midi > _PITCH_METER_MAX_DETECTED_MIDI
                or not -50 <= cents <= 50
            )
        )
        or (
            not voiced
            and (f0_hz != 0 or midi != 0 or cents != 0 or confidence != 0)
        )
    ):
        return None
    return PitchMeterTelemetryFrame(
        **_common("pitch", node, sequence, dropped),
        sample_rate=sample_rate,
        time_seconds=time_seconds,
        hop_seconds=hop_seconds,
        frame_index=frame_index,
        generation=generation,
        f0_hz=f0_hz,
        midi=midi,
        cents=cents,
        confidence=confidence,
        level_db=level_db,
        voiced=voiced,
    )


def _decode_analog_meter(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) < 12:
        return None
    mode, channel_count, flags = struct.unpack_from("<BBH", payload)
    loudness = mode == _ANALOG_METER_LOUDNESS_MODE
    program_offset = 4 + channel_count * 8
    if (
        mode > _ANALOG_METER_LOUDNESS_MODE
        or not 1 <= channel_count <= 16
        or flags & ~(3 if loudness else 0)
        or len(payload) != program_offset + (24 if loudness else 0)
    ):
        return None

    def is_level(value: float) -> bool:
        return math.isfinite(value) and value >= _ANALOG_METER_MIN_DB

    values = struct.unpack_from(f"<{channel_count * 2}f", payload, 4)
    if not all(is_level(value) for value in values):
        return None
    channels = tuple(
        AnalogMeterTelemetryChannel(needle_db=needle_db, max_db=max_db)
        for needle_db, max_db in zip(values[::2], values[1::2], strict=True)
    )
    integrated_valid = bool(flags & 1)
    lra_valid = bool(flags & 2)
    program = None
    if loudness:
        (
            momentary,
            short_term,
            integrated,
            lra,
            max_true_peak,
            integrated_seconds,
        ) = struct.unpack_from("<6f", payload, program_offset)
        if (
            not all(is_level(value) for value in (momentary, short_term, max_true_peak))
            or not math.isfinite(integrated_seconds)
            or integrated_seconds < 0
            or (not is_level(integrated) if integrated_valid else integrated != 0)
            or (not (math.isfinite(lra) and lra >= 0) if lra_valid else lra != 0)
        ):
            return None
        program = AnalogMeterTelemetryProgram(
            momentary=momentary,
            short_term=short_term,
            integrated=integrated,
            lra=lra,
            max_true_peak=max_true_peak,
            integrated_seconds=integrated_seconds,
        )
    return AnalogMeterTelemetryFrame(
        **_common("analogMeter", node, sequence, dropped),
        mode=mode,
        channel_count=channel_count,
        integrated_valid=integrated_valid,
        lra_valid=lra_valid,
        channels=channels,
        program=program,
    )


def _decode_rhythm_analyzer(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
    version: int = 1,
) -> TelemetryFrame | None:
    if len(payload) != (1496 if version == 4 else _RHYTHM_ANALYZER_PAYLOAD_BYTES):
        return None
    (
        sample_rate,
        generation,
        envelope_hop_samples,
        envelope_frame_count,
        time_seconds,
        latency_seconds,
        dropped_events,
        event_count,
        tracker_flags,
        lock_epoch,
        confidence,
        period_seconds,
        next_beat_frame,
        next_beat_fraction,
        next_beat_index,
        comb_best_bpm,
    ) = struct.unpack_from("<fIIIffIIIIffIfIf", payload)
    locked = bool(tracker_flags & 1)
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or generation == 0
        or envelope_hop_samples == 0
        or not math.isfinite(time_seconds)
        or not math.isfinite(latency_seconds)
        or latency_seconds < 0
        or event_count > _RHYTHM_ANALYZER_MAX_EVENTS
        or tracker_flags & ~1
        or not math.isfinite(confidence)
        or confidence < 0
        or not math.isfinite(comb_best_bpm)
        or comb_best_bpm < 0
        or (
            version == 1 and locked
            and (
                not (math.isfinite(period_seconds) and period_seconds > 0)
                or not 0 <= next_beat_fraction < 1
            )
        )
        or (
            version == 1 and not locked
            and (
                period_seconds != 0
                or next_beat_frame != 0
                or next_beat_fraction != 0
                or next_beat_index != 0
            )
        )
    ):
        return None
    if version >= 3 and not (
        confidence <= 1 and math.isfinite(period_seconds) and period_seconds >= 0
        and 0 <= next_beat_fraction < 1
    ):
        return None
    tempogram = struct.unpack_from(f"<{_RHYTHM_ANALYZER_TEMPOGRAM_BINS}f", payload, 64)
    if not all(0 <= value <= 1 for value in tempogram):
        return None
    events = []
    for index in range(event_count):
        (
            frame,
            fraction,
            event_epoch,
            beat_index,
            beat_fraction,
            event_period,
            strength,
            band,
            flags,
            reserved,
        ) = struct.unpack_from("<IfIifffBBH", payload, 832 + index * 32)
        beat = flags in (2, 4, 5)
        if (
            not 0 <= fraction < 1
            or not 0 <= beat_fraction < 1
            or not (math.isfinite(event_period) and event_period >= 0)
            or not math.isfinite(strength)
            or (strength < 0 if version >= 3 and beat else strength <= 0)
            or (version == 1 and (band > 2 or flags & ~1))
            or (version >= 3 and (
                flags > 5 or strength > 1
                or (band != 0 or beat_fraction != 0 if beat else band > 2)
                or (flags in (0, 2, 3, 4) and event_period == 0)
            ))
            or reserved != 0
        ):
            return None
        events.append(
            RhythmAnalyzerTelemetryEvent(
                frame=frame - (1 << 32) if flags == 5 and frame >= (1 << 31) else frame,
                fraction=fraction,
                lock_epoch=event_epoch,
                beat_index=beat_index,
                beat_fraction=beat_fraction,
                period_seconds=event_period,
                strength=strength,
                band=band,
                unlocked=flags == 1,
                flags=flags,
            )
        )
    preview_beats = []
    preview_period_seconds = 0.0
    if version == 4:
        count, preview_period_seconds = struct.unpack_from("<If", payload, 1344)
        if (count > 12 or not math.isfinite(preview_period_seconds) or preview_period_seconds < 0
                or (count > 0 and preview_period_seconds == 0)):
            return None
        for index in range(count):
            frame, fraction, beat_index = struct.unpack_from("<ifi", payload, 1352 + 12 * index)
            previous = preview_beats[-1] if preview_beats else None
            if not 0 <= fraction < 1 or (previous and (
                frame + fraction <= previous.frame + previous.fraction
                or beat_index != previous.beat_index + 1
            )):
                return None
            preview_beats.append(RhythmAnalyzerTelemetryBeat(frame, fraction, beat_index))
    return RhythmAnalyzerTelemetryFrame(
        **_common("rhythmAnalyzer", node, sequence, dropped),
        sample_rate=sample_rate,
        generation=generation,
        envelope_hop_samples=envelope_hop_samples,
        envelope_frame_count=envelope_frame_count,
        time_seconds=time_seconds,
        latency_seconds=latency_seconds,
        dropped_events=dropped_events,
        locked=locked,
        lock_epoch=lock_epoch,
        confidence=confidence,
        period_seconds=period_seconds,
        next_beat_frame=next_beat_frame,
        next_beat_fraction=next_beat_fraction,
        next_beat_index=next_beat_index,
        comb_best_bpm=comb_best_bpm,
        tempogram=tempogram,
        events=tuple(events),
        preview_period_seconds=preview_period_seconds,
        preview_beats=tuple(preview_beats),
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


def _decode_tonal_balance(
    payload: memoryview,
    node: tuple[str, str | None, int],
    sequence: int,
    dropped: int,
) -> TelemetryFrame | None:
    if len(payload) != _TONAL_BALANCE_PAYLOAD_BYTES:
        return None
    (
        sample_rate,
        band_count,
        grid_count,
        state_flags,
        target_index,
        reserved,
        loudness_lkfs,
        makeup_db,
        gated_hop_count,
    ) = struct.unpack_from("<fHHBBHffI", payload)
    loudness_valid = bool(state_flags & 4)
    bands = _TONAL_BALANCE_BANDS

    def floats(offset: int, count: int = bands) -> tuple[float, ...]:
        return struct.unpack_from(f"<{count}f", payload, offset)

    level_db = floats(24)
    persistence = floats(188)
    presence = floats(352)
    command_db = floats(516)
    target_mu_db = floats(680)
    target_sigma_db = floats(844)
    band_flags = tuple(payload[1008 : 1008 + bands])
    response_db = floats(1052, _TONAL_BALANCE_GRID_POINTS)
    if (
        not math.isfinite(sample_rate)
        or sample_rate <= 0
        or band_count != bands
        or grid_count != _TONAL_BALANCE_GRID_POINTS
        or state_flags & ~15
        or reserved != 0
        or (not math.isfinite(loudness_lkfs) if loudness_valid else loudness_lkfs != 0)
        or not math.isfinite(makeup_db)
        or any(payload[1049:1052])
        or not all(
            math.isfinite(value)
            for values in (level_db, command_db, target_mu_db, response_db)
            for value in values
        )
        or not all(0 <= value <= 1 for value in persistence + presence)
        or not all(0 <= value < math.inf for value in target_sigma_db)
        or any(flags & ~31 for flags in band_flags)
    ):
        return None
    return TonalBalanceEQTelemetryFrame(
        **_common("tonalBalance", node, sequence, dropped),
        sample_rate=sample_rate,
        target_index=target_index,
        absolute_gate=bool(state_flags & 1),
        relative_gate=bool(state_flags & 2),
        loudness_valid=loudness_valid,
        target_valid=bool(state_flags & 8),
        loudness_lkfs=loudness_lkfs,
        makeup_db=makeup_db,
        gated_hop_count=gated_hop_count,
        level_db=level_db,
        persistence=persistence,
        presence=presence,
        command_db=command_db,
        target_mu_db=target_mu_db,
        target_sigma_db=target_sigma_db,
        band_flags=band_flags,
        response_db=response_db,
    )


_DECODERS = {
    1: _decode_level,
    3: _decode_oscilloscope,
    4: _decode_spectrum,
    5: _decode_spectrogram,
    6: _decode_stereo,
    24: _decode_note_spectrogram,
    26: _decode_pitch_meter,
    27: _decode_analog_meter,
    28: _decode_rhythm_analyzer,
    29: _decode_tonal_balance,
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
        if expected and expected[0] == frame_type and version in expected[1]:
            payload = view[offset + 16 : offset + 16 + payload_bytes]
            decoded = (
                _decode_multires_hq(
                    payload, node, sequence, pending_dropped, frame_type
                )
                if version == 2 and frame_type in (4, 5)
                else _decode_rhythm_analyzer(payload, node, sequence, pending_dropped, version)
                if frame_type == 28
                else _DECODERS[frame_type](
                    payload, node, sequence, pending_dropped
                )
            )
            if decoded is not None:
                frames.append(decoded)
                pending_dropped = 0
        offset += frame_bytes
    return frames, pending_dropped


__all__ = [
    "AnalogMeterTelemetryChannel",
    "AnalogMeterTelemetryFrame",
    "AnalogMeterTelemetryProgram",
    "LevelTelemetryChannel",
    "LevelTelemetryFrame",
    "NoteSpectrogramTelemetryFrame",
    "NoteSpectrogramRevision",
    "OscilloscopeTelemetryFrame",
    "PitchMeterTelemetryFrame",
    "RhythmAnalyzerTelemetryEvent",
    "RhythmAnalyzerTelemetryBeat",
    "RhythmAnalyzerTelemetryFrame",
    "SpectrogramTelemetryFrame",
    "SpectrogramHqTelemetryFrame",
    "SpectrumTelemetryFrame",
    "SpectrumHqTelemetryFrame",
    "StereoTelemetryFrame",
    "TelemetryFrame",
    "TonalBalanceEQTelemetryFrame",
]
