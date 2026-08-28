"""Command-line interface for deterministic file rendering."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from .assets import AssetData, MAX_ASSET_BYTES
from .bundle import Bundle
from .chain import Chain
from .errors import AssetError, EffeTuneError, ValidationError
from .presets import read_json_source


_SUBTYPE_PRECISION_BITS = {
    "PCM_S8": 8,
    "PCM_U8": 8,
    "PCM_16": 16,
    "PCM_24": 24,
    "PCM_32": 32,
    "FLOAT": 32,
    "DOUBLE": 64,
}


def _warn_render_fidelity(
    input_subtype: str | None,
    output_path: Path,
    peak: float,
    *,
    subtype_was_explicit: bool = False,
) -> None:
    """Report silent precision loss and clipping introduced by the written file.

    The precision warning exists to surface an *implicit* loss caused by the
    default output subtype, so it is suppressed when ``--subtype`` selected the
    output format: that loss is the caller's own explicit choice and the advice
    to "pass --subtype" would contradict what they already did. The clipping
    warning is independent of who chose the subtype and always applies.
    """

    try:
        output_subtype = sf.info(output_path).subtype
    except (OSError, RuntimeError, TypeError, ValueError):
        return
    input_bits = _SUBTYPE_PRECISION_BITS.get(input_subtype or "")
    output_bits = _SUBTYPE_PRECISION_BITS.get(output_subtype or "")
    if (
        not subtype_was_explicit
        and input_bits is not None
        and output_bits is not None
        and input_bits > output_bits
    ):
        print(
            f"effetune: warning: {input_subtype} input written as {output_subtype} "
            "output; precision is reduced. Pass --subtype to keep more precision.",
            file=sys.stderr,
        )
    if peak > 1.0 and (output_subtype or "").startswith("PCM_"):
        decibels = 20.0 * float(np.log10(peak))
        print(
            f"effetune: warning: rendered peak {peak:.6f} ({decibels:+.2f} dBFS) "
            f"exceeds full scale; samples were clipped by the {output_subtype} output.",
            file=sys.stderr,
        )


def _chain_argument(value: str) -> dict[str, Any]:
    document = read_json_source(value)
    if isinstance(document, list):
        document = {"version": 1, "chain": document}
    if not isinstance(document, dict):
        raise ValidationError("--chain must contain a chain object or effect array")
    return document


def _render(args: argparse.Namespace) -> int:
    if args.preset:
        preset = Path(args.preset)
        chain = (
            Chain.from_bundle(preset)
            if preset.is_dir() or preset.name == "bundle.json"
            else Chain.from_preset(preset)
        )
    else:
        chain = Chain.from_preset(_chain_argument(args.chain))
    try:
        with sf.SoundFile(args.input) as audio_file:
            input_subtype = audio_file.subtype
            sample_rate = audio_file.samplerate
            audio = audio_file.read(dtype="float32", always_2d=True)
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise ValidationError(f"could not decode input audio: {args.input}") from error
    planar = np.ascontiguousarray(audio.T, dtype=np.float32)
    output = chain.process(planar, sample_rate=sample_rate)
    peak = float(np.max(np.abs(output))) if output.size else 0.0
    try:
        sf.write(args.output, output.T, sample_rate, subtype=args.subtype)
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise ValidationError(f"could not encode output audio: {args.output}") from error
    _warn_render_fidelity(
        input_subtype,
        args.output,
        peak,
        subtype_was_explicit=args.subtype is not None,
    )
    return 0


def _validate_chain(args: argparse.Namespace) -> int:
    Chain.from_preset(args.document)
    print("valid Chain v1")
    return 0


def _inspect_preset(args: argparse.Namespace) -> int:
    document = Chain.from_preset(args.document).to_dict()
    print(json.dumps(document, indent=2, ensure_ascii=False))
    return 0


def _bundle_pack(args: argparse.Namespace) -> int:
    assets: dict[str, AssetData] = {}
    for specification in args.asset:
        if "=" not in specification:
            raise ValidationError("--asset must use REF=FILE")
        reference, filename = specification.split("=", 1)
        if not reference or not filename:
            raise ValidationError("--asset must use non-empty REF=FILE values")
        if reference in assets:
            raise AssetError(f"duplicate bundle asset id: {reference}")
        try:
            with sf.SoundFile(Path(filename)) as audio_file:
                channels = audio_file.channels
                frames = audio_file.frames
                sample_rate = audio_file.samplerate
                if not 1 <= channels <= 16 or frames < 1 or sample_rate <= 0:
                    raise AssetError(
                        "impulse-response audio must have 1 to 16 channels, "
                        "at least one frame, and a positive sample rate"
                    )
                if 32 + channels * frames * 4 > MAX_ASSET_BYTES:
                    raise AssetError(
                        "encoded ETA1 payload exceeds the 32 MiB asset limit"
                    )
                audio = audio_file.read(dtype="float32", always_2d=True)
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise ValidationError(f"could not decode impulse response: {filename}") from error
        assets[reference] = AssetData(
            np.ascontiguousarray(audio.T, dtype=np.float32),
            sample_rate,
            topology="automatic",
        )
    chain = Chain.from_preset(args.document).to_dict()
    Bundle.pack(args.destination, chain, assets)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="effetune")
    subcommands = parser.add_subparsers(dest="command", required=True)

    render = subcommands.add_parser("render", help="render an audio file")
    render.add_argument("input", type=Path)
    render.add_argument("output", type=Path)
    source = render.add_mutually_exclusive_group(required=True)
    source.add_argument("--preset", type=Path)
    source.add_argument("--chain")
    render.add_argument("--subtype")
    render.set_defaults(handler=_render)

    chain = subcommands.add_parser("chain", help="work with Chain v1 documents")
    chain_commands = chain.add_subparsers(dest="chain_command", required=True)
    validate = chain_commands.add_parser("validate", help="validate a Chain v1 document")
    validate.add_argument("document")
    validate.set_defaults(handler=_validate_chain)

    preset = subcommands.add_parser("preset", help="inspect semantic presets")
    preset_commands = preset.add_subparsers(dest="preset_command", required=True)
    inspect = preset_commands.add_parser("inspect", help="print a materialized preset")
    inspect.add_argument("document")
    inspect.set_defaults(handler=_inspect_preset)

    bundle = subcommands.add_parser("bundle", help="work with asset bundles")
    bundle_commands = bundle.add_subparsers(dest="bundle_command", required=True)
    pack = bundle_commands.add_parser("pack", help="pack a Chain v1 document and IR files")
    pack.add_argument("document")
    pack.add_argument("destination", type=Path)
    pack.add_argument("--asset", action="append", default=[], metavar="REF=FILE")
    pack.set_defaults(handler=_bundle_pack)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except EffeTuneError as error:
        print(f"effetune: {error}", file=sys.stderr)
        return 2


__all__ = ["build_parser", "main"]
