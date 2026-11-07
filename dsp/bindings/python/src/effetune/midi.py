"""MIDI message helpers for MIDI-driven effects such as SoundFont Player.

Each helper returns one ``[status, data1, data2]`` message for the ``midi`` key of
a ``Stream.process`` event. That key also accepts raw MIDI bytes.
"""

from __future__ import annotations

from numbers import Integral
from typing import Any

from .errors import ValidationError

def _require_range(value: Any, maximum: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral) or not 0 <= value <= maximum:
        raise ValidationError(f"{name} must be an integer from 0 to {maximum}.")
    return int(value)


def _message(status: int, channel: int, data1: int, data2: int) -> list[int]:
    return [status | _require_range(channel, 15, "MIDI channel"), data1, data2]


def note_on(channel: int, note: int, velocity: int) -> list[int]:
    return _message(
        0x90, channel, _require_range(note, 127, "Note"), _require_range(velocity, 127, "Velocity")
    )


def note_off(channel: int, note: int, velocity: int = 0) -> list[int]:
    return _message(
        0x80, channel, _require_range(note, 127, "Note"), _require_range(velocity, 127, "Velocity")
    )


def control_change(channel: int, controller: int, value: int) -> list[int]:
    return _message(
        0xB0,
        channel,
        _require_range(controller, 127, "Controller"),
        _require_range(value, 127, "Controller value"),
    )


def pitch_bend(channel: int, value14: int) -> list[int]:
    """``value14`` is the unsigned 14-bit bend value; 8192 is the centre."""
    value = _require_range(value14, 16383, "Pitch bend")
    return _message(0xE0, channel, value & 0x7F, value >> 7)


def program_change(channel: int, program: int) -> list[int]:
    return _message(0xC0, channel, _require_range(program, 127, "Program"), 0)


def _normalize_message(midi: Any, label: str) -> tuple[int, int, int] | None:
    """Validate one event's MIDI bytes and return ``(status, data1, data2)``.

    Returns ``None`` for a well-formed message that MIDI-driven effects do not use
    (polyphonic/channel pressure and system messages), so raw MIDI input can be
    passed through unchanged. A two-byte program change gets a zero ``data2``.
    """
    if (
        not isinstance(midi, (list, tuple, bytes, bytearray))
        or len(midi) == 0
        or not all(
            not isinstance(value, bool) and isinstance(value, Integral) and 0 <= value <= 255
            for value in midi
        )
    ):
        raise ValidationError(f"{label} midi must be an array of MIDI bytes: [status, data1, data2].")
    data = [int(value) for value in midi]
    status = data[0]
    if status < 0x80:
        raise ValidationError(f"{label} midi must start with a status byte from 0x80 to 0xFF.")
    if status >= 0xF0:
        return None
    kind = status & 0xF0
    two_byte = kind in (0xC0, 0xD0)
    if len(data) != 3 and not (two_byte and len(data) == 2):
        expected = "two or three" if two_byte else "three"
        raise ValidationError(f"{label} midi must have {expected} bytes for status {status}.")
    if any(value > 127 for value in data[1:]):
        raise ValidationError(f"{label} midi data bytes must be from 0 to 127.")
    if kind in (0xA0, 0xD0):
        return None
    return status, data[1], data[2] if len(data) == 3 else 0


__all__ = ["control_change", "note_off", "note_on", "pitch_bend", "program_change"]
