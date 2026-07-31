"""EffeTune bundle v1 manifest loading."""

from __future__ import annotations

import copy
import hashlib
import json
import struct
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from .assets import AssetData, MAX_ASSET_BYTES, coerce_asset_data
from .errors import AssetError, ValidationError
from .validation import validate_chain_document

_ETA1_HEADER_BYTES = 32
_ETA1_PATH_BYTES = 12
_ETA1_MAGIC = 0x31415445
_TOPOLOGY_CODES = {
    "unspecified": 0,
    "mono": 1,
    "independent": 2,
    "trueStereo": 3,
    "matrix": 4,
}


class Bundle:
    """A semantic chain plus bounded directory-backed IR assets."""

    def __init__(self, manifest: Mapping[str, Any], base_directory: Path) -> None:
        if not isinstance(manifest, Mapping) or set(manifest) != {"version", "chain", "assets"}:
            raise ValidationError("bundle manifest requires only version, chain, and assets")
        if isinstance(manifest["version"], bool) or manifest["version"] != 1:
            raise ValidationError("bundle manifest version must be 1")
        snapshot = copy.deepcopy(dict(manifest))
        validate_chain_document(snapshot["chain"])
        entries = snapshot["assets"]
        if not isinstance(entries, list) or len(entries) > 64:
            raise AssetError("bundle assets must be an array with at most 64 entries")
        self._manifest = snapshot
        self.base_directory = base_directory.resolve()
        self._entries: dict[str, Mapping[str, Any]] = {}
        for entry in entries:
            self._validate_entry(entry)
            asset_id = entry["id"]
            if asset_id in self._entries:
                raise AssetError(f"duplicate bundle asset id: {asset_id}")
            self._entries[asset_id] = entry
        referenced = {
            reference
            for node in snapshot["chain"]["chain"]
            for reference in node.get("assets", {}).values()
        }
        missing = sorted(referenced - set(self._entries))
        if missing:
            raise AssetError(f"bundle chain references missing assets: {', '.join(missing)}")

    @classmethod
    def load(cls, source: str | Path) -> "Bundle":
        path = Path(source)
        manifest_path = path / "bundle.json" if path.is_dir() else path
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise ValidationError(f"could not read bundle manifest: {manifest_path}") from error
        return cls(manifest, manifest_path.parent)

    @classmethod
    def pack(
        cls,
        destination: str | Path,
        chain: Mapping[str, Any],
        assets: Mapping[str, AssetData | Mapping[str, Any]],
    ) -> "Bundle":
        """Write a deterministic directory bundle and return its verified view."""
        if not isinstance(chain, Mapping):
            raise ValidationError("bundle chain must be a Chain v1 document")
        if not isinstance(assets, Mapping):
            raise AssetError("bundle assets must be an object")

        effects = validate_chain_document(chain)
        canonical_chain = {
            "version": 1,
            "chain": [effect.to_dict() for effect in effects],
        }
        referenced = {
            reference
            for effect in effects
            for reference in effect.assets.values()
        }
        supplied = set(assets)
        if any(not isinstance(asset_id, str) for asset_id in supplied):
            raise AssetError("bundle asset IDs must be strings")
        missing = sorted(referenced - supplied)
        extra = sorted(supplied - referenced)
        if missing:
            raise AssetError(f"bundle chain references missing assets: {', '.join(missing)}")
        if extra:
            raise AssetError(f"bundle contains unreferenced assets: {', '.join(extra)}")
        if len(supplied) > 64:
            raise AssetError("bundle assets must contain at most 64 entries")

        payloads: dict[str, bytes] = {}
        entries: list[dict[str, Any]] = []
        for asset_id in sorted(supplied):
            try:
                asset = coerce_asset_data(assets[asset_id])
                payload, format_data = _encode_eta1(asset)
            except AssetError as error:
                raise AssetError(f"bundle asset {asset_id!r}: {error}") from error
            digest = hashlib.sha256(payload).hexdigest()
            reference = f"assets/{digest}.eta1"
            payloads.setdefault(reference, payload)
            entries.append(
                {
                    "id": asset_id,
                    "kind": "impulseResponse",
                    "reference": reference,
                    "sha256": digest,
                    "byteLength": len(payload),
                    "format": format_data,
                }
            )

        manifest = {
            "version": 1,
            "chain": canonical_chain,
            "assets": entries,
        }
        destination_path = Path(destination)
        if destination_path.exists():
            raise ValidationError(f"bundle destination already exists: {destination_path}")
        try:
            destination_path.mkdir()
            if payloads:
                (destination_path / "assets").mkdir()
                for reference, payload in sorted(payloads.items()):
                    (destination_path / reference).write_bytes(payload)
            (destination_path / "bundle.json").write_text(
                json.dumps(
                    manifest,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
        except OSError as error:
            raise ValidationError(
                f"could not write bundle destination: {destination_path}"
            ) from error
        return cls.load(destination_path)

    @property
    def manifest(self) -> Mapping[str, Any]:
        return copy.deepcopy(self._manifest)

    @property
    def chain_document(self) -> Mapping[str, Any]:
        return copy.deepcopy(self._manifest["chain"])

    def resolver(self, reference: str) -> AssetData | None:
        entry = self._entries.get(reference)
        if entry is None:
            return None
        path = self._resolve_reference(entry["reference"])
        try:
            with path.open("rb") as asset_file:
                payload = asset_file.read(entry["byteLength"] + 1)
        except OSError as error:
            raise AssetError(f"could not read bundle asset {reference!r}") from error
        if len(payload) != entry["byteLength"]:
            raise AssetError(f"bundle asset {reference!r} byteLength does not match")
        digest = hashlib.sha256(payload).hexdigest()
        if digest != entry["sha256"]:
            raise AssetError(f"bundle asset {reference!r} sha256 does not match")
        format_data = entry["format"]
        header = struct.unpack_from("<6I", payload)
        expected_header = (
            _ETA1_MAGIC,
            format_data["channels"],
            format_data["frames"],
            format_data["sampleRate"],
            _TOPOLOGY_CODES[format_data["topology"]],
            format_data["pathCount"],
        )
        if header != expected_header or payload[24:_ETA1_HEADER_BYTES] != bytes(8):
            raise AssetError(f"bundle asset {reference!r} ETA1 header does not match")
        paths = tuple(format_data.get("paths", ()))
        for index, path_data in enumerate(paths):
            actual = struct.unpack_from(
                "<3I", payload, _ETA1_HEADER_BYTES + index * _ETA1_PATH_BYTES
            )
            expected = (
                path_data["inputSlot"],
                path_data["outputSlot"],
                path_data["irChannel"],
            )
            if actual != expected:
                raise AssetError(
                    f"bundle asset {reference!r} ETA1 path records do not match"
                )
        sample_offset = _ETA1_HEADER_BYTES + len(paths) * _ETA1_PATH_BYTES
        samples = np.frombuffer(
            payload,
            dtype="<f4",
            count=format_data["channels"] * format_data["frames"],
            offset=sample_offset,
        ).reshape(format_data["channels"], format_data["frames"])
        if not np.isfinite(samples).all():
            raise AssetError(f"bundle asset {reference!r} contains a non-finite sample")
        topology = format_data["topology"]
        input_count = (
            len({path_data["inputSlot"] for path_data in paths})
            if topology == "matrix"
            else None
        )
        return AssetData(
            samples=np.ascontiguousarray(samples, dtype=np.float32),
            sample_rate=format_data["sampleRate"],
            topology="automatic" if topology == "unspecified" else topology,
            paths=paths,
            input_count=input_count,
        )

    def _resolve_reference(self, reference: str) -> Path:
        if not isinstance(reference, str) or not reference:
            raise AssetError("bundle asset reference must be a non-empty relative path")
        candidate = (self.base_directory / reference).resolve()
        try:
            candidate.relative_to(self.base_directory)
        except ValueError as error:
            raise AssetError("bundle asset reference escapes the bundle directory") from error
        return candidate

    @staticmethod
    def _validate_entry(entry: Any) -> None:
        required = {"id", "kind", "reference", "sha256", "byteLength", "format"}
        if not isinstance(entry, Mapping) or set(entry) != required:
            raise AssetError("each bundle asset requires id, kind, reference, sha256, byteLength, format")
        if not isinstance(entry["id"], str) or not entry["id"] or len(entry["id"]) > 128:
            raise AssetError("bundle asset id must be a non-empty string")
        if entry["kind"] != "impulseResponse":
            raise AssetError("bundle asset kind must be 'impulseResponse'")
        if (
            not isinstance(entry["reference"], str)
            or not entry["reference"]
            or len(entry["reference"]) > 2048
        ):
            raise AssetError(
                "bundle asset reference must be a non-empty string of at most 2048 characters"
            )
        if (
            not isinstance(entry["sha256"], str)
            or len(entry["sha256"]) != 64
            or any(character not in "0123456789abcdef" for character in entry["sha256"])
        ):
            raise AssetError("bundle asset sha256 must be 64 lowercase hexadecimal characters")
        byte_length = entry["byteLength"]
        if (
            isinstance(byte_length, bool)
            or not isinstance(byte_length, int)
            or not 36 <= byte_length <= MAX_ASSET_BYTES
        ):
            raise AssetError("bundle asset byteLength must be between 36 and 33554432")
        fmt = entry["format"]
        required_format = {
            "formatTag",
            "magic",
            "headerBytes",
            "pathRecordBytes",
            "reservedBytes",
            "sampleType",
            "byteOrder",
            "layout",
            "channels",
            "frames",
            "sampleRate",
            "topology",
            "pathCount",
        }
        optional_format = {"paths"}
        if (
            not isinstance(fmt, Mapping)
            or not required_format <= set(fmt)
            or set(fmt) - (required_format | optional_format)
        ):
            raise AssetError("bundle asset format is invalid")
        if (
            isinstance(fmt["formatTag"], bool)
            or fmt["formatTag"] != 1
            or fmt["magic"] != "ETA1"
            or isinstance(fmt["headerBytes"], bool)
            or fmt["headerBytes"] != _ETA1_HEADER_BYTES
            or isinstance(fmt["pathRecordBytes"], bool)
            or fmt["pathRecordBytes"] != _ETA1_PATH_BYTES
            or isinstance(fmt["reservedBytes"], bool)
            or fmt["reservedBytes"] != 8
            or fmt["sampleType"] != "float32"
            or fmt["byteOrder"] != "little-endian"
            or fmt["layout"] != "planar"
        ):
            raise AssetError("bundle assets must use the ETA1 planar little-endian float32 format")
        if (
            isinstance(fmt["channels"], bool)
            or not isinstance(fmt["channels"], int)
            or not 1 <= fmt["channels"] <= 8
            or isinstance(fmt["frames"], bool)
            or not isinstance(fmt["frames"], int)
            or not 1 <= fmt["frames"] <= 8_388_600
            or isinstance(fmt["sampleRate"], bool)
            or not isinstance(fmt["sampleRate"], int)
            or not 1 <= fmt["sampleRate"] <= 0xFFFFFFFF
        ):
            raise AssetError("bundle asset format dimensions or sampleRate are invalid")
        topology = fmt["topology"]
        if topology not in _TOPOLOGY_CODES:
            raise AssetError("bundle asset topology is unsupported")
        path_count = fmt["pathCount"]
        if isinstance(path_count, bool) or not isinstance(path_count, int):
            raise AssetError("bundle asset pathCount must be an integer")
        if topology == "matrix":
            paths = fmt.get("paths")
            if (
                not isinstance(paths, list)
                or not 1 <= len(paths) <= 8
                or path_count != len(paths)
            ):
                raise AssetError("matrix bundle assets require 1 to 8 paths")
            for path in paths:
                if not isinstance(path, Mapping) or set(path) != {
                    "inputSlot",
                    "outputSlot",
                    "irChannel",
                }:
                    raise AssetError("matrix bundle paths must contain exact path fields")
                for name, maximum in (
                    ("inputSlot", 7),
                    ("outputSlot", 7),
                    ("irChannel", fmt["channels"] - 1),
                ):
                    value = path[name]
                    if (
                        isinstance(value, bool)
                        or not isinstance(value, int)
                        or not 0 <= value <= maximum
                    ):
                        raise AssetError("matrix bundle paths contain an invalid slot")
            input_slots = {path["inputSlot"] for path in paths}
            if input_slots != set(range(len(input_slots))):
                raise AssetError(
                    "matrix bundle inputSlot values must form a contiguous range "
                    "starting at 0"
                )
        elif path_count != 0 or "paths" in fmt:
            raise AssetError("bundle asset paths are only valid for matrix topology")
        expected_bytes = (
            _ETA1_HEADER_BYTES
            + path_count * _ETA1_PATH_BYTES
            + fmt["channels"] * fmt["frames"] * 4
        )
        if expected_bytes != byte_length:
            raise AssetError("bundle asset byteLength does not match its ETA1 format")


def _encode_eta1(asset: AssetData) -> tuple[bytes, dict[str, Any]]:
    if int(asset.sample_rate) > 0xFFFFFFFF:
        raise AssetError("sample_rate exceeds the ETA1 uint32 limit")
    topology = "unspecified" if asset.topology == "automatic" else asset.topology
    paths = tuple(asset.paths)
    byte_length = (
        _ETA1_HEADER_BYTES
        + len(paths) * _ETA1_PATH_BYTES
        + asset.samples.nbytes
    )
    if byte_length > MAX_ASSET_BYTES:
        raise AssetError("encoded ETA1 payload exceeds the 32 MiB asset limit")
    header = struct.pack(
        "<6I8x",
        _ETA1_MAGIC,
        asset.samples.shape[0],
        asset.samples.shape[1],
        int(asset.sample_rate),
        _TOPOLOGY_CODES[topology],
        len(paths),
    )
    path_bytes = b"".join(
        struct.pack("<3I", path.input_slot, path.output_slot, path.ir_channel)
        for path in paths
    )
    samples = np.asarray(asset.samples, dtype="<f4", order="C").tobytes(order="C")
    format_data: dict[str, Any] = {
        "formatTag": 1,
        "magic": "ETA1",
        "headerBytes": _ETA1_HEADER_BYTES,
        "pathRecordBytes": _ETA1_PATH_BYTES,
        "reservedBytes": 8,
        "sampleType": "float32",
        "byteOrder": "little-endian",
        "layout": "planar",
        "channels": asset.samples.shape[0],
        "frames": asset.samples.shape[1],
        "sampleRate": int(asset.sample_rate),
        "topology": topology,
        "pathCount": len(paths),
    }
    if topology == "matrix":
        format_data["paths"] = [
            {
                "inputSlot": path.input_slot,
                "outputSlot": path.output_slot,
                "irChannel": path.ir_channel,
            }
            for path in paths
        ]
    return header + path_bytes + samples, format_data


__all__ = ["Bundle"]
