"""Prepared SoundFont banks (ETSF1) for SoundFont Player."""

from __future__ import annotations

import os
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .errors import AssetError, ValidationError

_ETSF_MAGIC = 0x46535445  # "ETSF"
_ETSF_VERSION = 1
_HEADER = struct.Struct("<4I")
_PAYLOAD_MAGIC = 0x31415445
# The native player needs the 32-byte payload header plus a control block of at
# least 56 bytes; word 12 of the payload holds the control block's word count.
_MIN_CONTROL_BYTES = 56
_MAX_SAMPLES = 65536
_MAX_PAGES = 32768
_PAGE_FRAMES = 4096
_SOURCE_SUFFIXES = frozenset((".sf2", ".sf3", ".sfz"))
_PREPARE_HINT = (
    "Prepare it first with `npx -p @effetune/dsp effetune-soundfont prepare in.sf2 out.etsf`, "
    "then load the .etsf file."
)


# eq=False: the PCM arrays have no single truth value, so pages and banks compare
# and hash by identity.
@dataclass(frozen=True, eq=False)
class SoundFontPage:
    """One resident sample page: interleaved float32 PCM."""

    sample: int
    page_index: int
    frames: int
    channels: int
    pcm: np.ndarray


@dataclass(frozen=True, eq=False)
class SoundFontBank:
    """A SoundFont bank prepared by `effetune-soundfont prepare` (ETSF1 format)."""

    payload: bytes
    pages: tuple[SoundFontPage, ...] = ()

    @classmethod
    def load(cls, source: str | os.PathLike[str] | bytes | bytearray | memoryview) -> SoundFontBank:
        """Load a prepared .etsf bank from a file path or from its bytes."""
        if isinstance(source, (str, os.PathLike)):
            path = Path(source)
            if path.suffix.lower() in _SOURCE_SUFFIXES:
                raise AssetError(
                    f"{path.name} is a SoundFont source file, which Python cannot load directly. "
                    + _PREPARE_HINT
                )
            try:
                data = path.read_bytes()
            except OSError as error:
                raise AssetError(f"The SoundFont bank file {path.name} could not be read.") from error
        elif isinstance(source, (bytes, bytearray, memoryview)):
            data = bytes(source)
        else:
            raise ValidationError("A SoundFont bank must be given as a file path or as bytes.")
        return _parse(data)


def _invalid() -> AssetError:
    return AssetError("The SoundFont bank file is damaged or is not an EffeTune SoundFont bank.")


def _parse(data: bytes) -> SoundFontBank:
    if data[:4] == b"RIFF" and data[8:12] == b"sfbk":
        raise AssetError("This is a SoundFont source file, which Python cannot load directly. " + _PREPARE_HINT)
    if len(data) < _HEADER.size or _HEADER.unpack_from(data)[0] != _ETSF_MAGIC:
        raise _invalid()
    _, version, payload_bytes, page_count = _HEADER.unpack_from(data)
    if version != _ETSF_VERSION:
        raise AssetError(
            "This SoundFont bank was prepared for a different format version. "
            "Prepare it again with this version of EffeTune DSP."
        )
    end = _HEADER.size + payload_bytes
    if (
        payload_bytes < _MIN_CONTROL_BYTES
        or payload_bytes % 4
        or end > len(data)
        or page_count > _MAX_PAGES
    ):
        raise _invalid()
    magic, payload_version, float_count = struct.unpack_from("<3I", data, _HEADER.size)
    (control_words,) = struct.unpack_from("<I", data, _HEADER.size + 48)
    if (
        magic != _PAYLOAD_MAGIC
        or payload_version != 1
        or 32 + float_count * 4 != payload_bytes
        or not _MIN_CONTROL_BYTES <= 32 + control_words * 4 <= payload_bytes
    ):
        raise _invalid()
    pages = []
    offset, previous = end, (-1, -1)
    for _ in range(page_count):
        if offset + 16 > len(data):
            raise _invalid()
        sample, page_index, frames, channels = struct.unpack_from("<4I", data, offset)
        offset += 16
        count = frames * channels
        if (
            sample >= _MAX_SAMPLES
            or (sample, page_index) <= previous
            or not 1 <= frames <= _PAGE_FRAMES
            or channels not in (1, 2)
            or offset + count * 4 > len(data)
        ):
            raise _invalid()
        pcm = np.frombuffer(data, dtype="<f4", count=count, offset=offset).astype(np.float32)
        pcm.flags.writeable = False
        pages.append(SoundFontPage(sample, page_index, frames, channels, pcm))
        offset += count * 4
        previous = (sample, page_index)
    if offset != len(data):
        raise _invalid()
    return SoundFontBank(data[_HEADER.size : end], tuple(pages))


__all__ = ["SoundFontBank", "SoundFontPage"]
