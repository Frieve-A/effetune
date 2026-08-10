from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

import effetune
from effetune import presets
from effetune.assets import (
    MAX_ASSET_BYTES,
    coerce_asset_data,
    resolve_asset,
    resolve_topology,
)
from effetune.validation import validate_sample_rate


def _legacy_fixture() -> dict[str, object]:
    """Load the cross-language legacy import contract fixture."""
    return json.loads(
        (
            Path(__file__).resolve().parents[2]
            / "common"
            / "legacy-app-export-v1.fixture.json"
        ).read_text(encoding="utf-8")
    )


_TOPOLOGY_CODES = {
    "unspecified": 0,
    "mono": 1,
    "independent": 2,
    "trueStereo": 3,
    "matrix": 4,
}


def _eta1_payload(
    samples: np.ndarray,
    *,
    sample_rate: int = 48_000,
    topology: str = "mono",
    paths: tuple[tuple[int, int, int], ...] = (),
) -> bytes:
    planar = np.ascontiguousarray(samples, dtype="<f4")
    header = struct.pack(
        "<6I",
        0x31415445,
        planar.shape[0],
        planar.shape[1],
        sample_rate,
        _TOPOLOGY_CODES[topology],
        len(paths),
    ) + bytes(8)
    records = b"".join(struct.pack("<3I", *path) for path in paths)
    return header + records + planar.tobytes()


def _asset_entry(
    payload: bytes,
    samples: np.ndarray,
    *,
    topology: str,
    paths: tuple[tuple[int, int, int], ...] = (),
) -> dict[str, object]:
    format_data: dict[str, object] = {
        "formatTag": 1,
        "magic": "ETA1",
        "headerBytes": 32,
        "pathRecordBytes": 12,
        "reservedBytes": 8,
        "sampleType": "float32",
        "byteOrder": "little-endian",
        "layout": "planar",
        "channels": samples.shape[0],
        "frames": samples.shape[1],
        "sampleRate": 48_000,
        "topology": topology,
        "pathCount": len(paths),
    }
    if paths:
        format_data["paths"] = [
            {
                "inputSlot": input_slot,
                "outputSlot": output_slot,
                "irChannel": ir_channel,
            }
            for input_slot, output_slot, ir_channel in paths
        ]
    return {
        "id": "room",
        "kind": "impulseResponse",
        "reference": "room.eta1",
        "sha256": hashlib.sha256(payload).hexdigest(),
        "byteLength": len(payload),
        "format": format_data,
    }


def _bundle_manifest(entry: dict[str, object]) -> dict[str, object]:
    return {
        "version": 1,
        "chain": {
            "version": 1,
            "chain": [
                {
                    "id": "reverb",
                    "type": "IRReverb",
                    "parameters": {},
                    "assets": {"impulseResponse": "room"},
                }
            ],
        },
        "assets": [entry],
    }


class PresetAndAssetTests(unittest.TestCase):
    def test_bundle_and_nested_chain_reject_boolean_versions(self) -> None:
        with self.assertRaises(effetune.ValidationError):
            effetune.Bundle(
                {"version": True, "chain": {"version": 1, "chain": []}, "assets": []},
                Path("."),
            )
        with self.assertRaises(effetune.ValidationError):
            effetune.Bundle(
                {"version": 1, "chain": {"version": True, "chain": []}, "assets": []},
                Path("."),
            )

    def test_bundle_uses_an_immutable_private_manifest_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            samples = np.array([[1.0, 0.5]], dtype="<f4")
            payload = _eta1_payload(samples, topology="mono")
            (root / "room.eta1").write_bytes(payload)
            manifest = _bundle_manifest(
                _asset_entry(payload, samples, topology="mono")
            )
            bundle = effetune.Bundle(manifest, root)

            manifest["assets"][0]["reference"] = "missing.eta1"
            manifest["assets"][0]["sha256"] = "0" * 64
            manifest["chain"]["chain"][0]["assets"]["impulseResponse"] = "missing"
            public_manifest = bundle.manifest
            public_manifest["assets"][0]["reference"] = "also-missing.eta1"
            chain_document = bundle.chain_document
            chain_document["chain"][0]["assets"]["impulseResponse"] = "also-missing"

            np.testing.assert_array_equal(bundle.resolver("room").samples, samples)
            self.assertEqual(
                bundle.chain_document["chain"][0]["assets"]["impulseResponse"],
                "room",
            )

    def test_bundle_pack_is_deterministic_and_deduplicates_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            chain = {
                "version": 1,
                "chain": [
                    {
                        "type": "IRReverb",
                        "enabled": False,
                        "parameters": {},
                        "assets": {"impulseResponse": "z-room"},
                    },
                    {
                        "type": "IRReverb",
                        "parameters": {},
                        "assets": {"impulseResponse": "a-room"},
                    },
                ],
            }
            samples = np.array([[1.0, -0.25]], dtype=np.float32)
            assets = {
                "z-room": effetune.AssetData(samples, 48_000),
                "a-room": {"samples": samples, "sampleRate": 48_000},
            }

            first = effetune.Bundle.pack(root / "first", chain, assets)
            second = effetune.Bundle.pack(root / "second", chain, assets)

            self.assertEqual(
                (root / "first" / "bundle.json").read_bytes(),
                (root / "second" / "bundle.json").read_bytes(),
            )
            self.assertEqual(
                [entry["id"] for entry in first.manifest["assets"]],
                ["a-room", "z-room"],
            )
            references = {
                entry["reference"] for entry in first.manifest["assets"]
            }
            self.assertEqual(len(references), 1)
            self.assertEqual(len(list((root / "first" / "assets").iterdir())), 1)
            self.assertEqual(first.resolver("a-room").topology, "automatic")
            np.testing.assert_array_equal(
                first.resolver("a-room").samples,
                second.resolver("z-room").samples,
            )

    def test_mapping_asset_size_is_bounded_before_contiguous_copy(self) -> None:
        samples = np.lib.stride_tricks.as_strided(
            np.zeros(1, dtype=np.float32),
            shape=(1, MAX_ASSET_BYTES // np.dtype(np.float32).itemsize + 1),
            strides=(0, 0),
        )
        self.assertFalse(samples.flags.c_contiguous)
        self.assertGreater(samples.nbytes, MAX_ASSET_BYTES)

        with mock.patch(
            "effetune.assets.np.array",
            side_effect=AssertionError("oversize assets must not be copied"),
        ) as sample_copy:
            with self.assertRaisesRegex(effetune.AssetError, "32 MiB asset limit"):
                coerce_asset_data({"samples": samples, "sampleRate": 48_000})
        sample_copy.assert_not_called()

    def test_resolver_revalidates_mutated_asset_data(self) -> None:
        samples = np.ones((1, 2), dtype=np.float32)
        asset = effetune.AssetData(samples, 48_000, topology="mono")
        samples[0, 1] = np.nan

        with self.assertRaisesRegex(effetune.AssetError, "must all be finite"):
            resolve_asset("room", lambda _: asset, "IRReverb")

    def test_resolved_assets_own_samples_used_for_native_staging(self) -> None:
        expected_ir = np.array([[1.0, 0.5]], dtype=np.float32)
        impulse = np.zeros((1, 8), dtype=np.float32)
        impulse[0, 0] = 1.0
        for kind in ("AssetData", "mapping"):
            with self.subTest(kind=kind):
                source_samples = expected_ir.copy()
                value = (
                    effetune.AssetData(source_samples, 48_000, topology="mono")
                    if kind == "AssetData"
                    else {
                        "samples": source_samples,
                        "sampleRate": 48_000,
                        "topology": "mono",
                    }
                )
                resolved = resolve_asset("room", lambda _: value, "IRReverb")
                source_samples.fill(0.0)

                np.testing.assert_array_equal(resolved.samples, expected_ir)
                self.assertFalse(np.shares_memory(resolved.samples, source_samples))
                output = effetune.IRReverb(
                    assets={"impulseResponse": "room"},
                    channel_mode="mono",
                    latency=0,
                    wet_level=0,
                    dry_level=-96,
                ).process(
                    impulse,
                    sample_rate=48_000,
                    asset_resolver=lambda _: resolved,
                    block_size=8,
                )
                self.assertGreater(float(output[0, 0]), 0.9)
                self.assertGreater(float(output[0, 1]), 0.4)

    def test_bundle_pack_rejects_existing_missing_and_extra_destinations(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "bundle"
            destination.mkdir()
            chain = {
                "version": 1,
                "chain": [
                    {
                        "type": "IRReverb",
                        "parameters": {},
                        "assets": {"impulseResponse": "room"},
                    }
                ],
            }
            asset = effetune.AssetData(
                np.array([[1.0]], dtype=np.float32), 48_000
            )
            with self.assertRaises(effetune.ValidationError):
                effetune.Bundle.pack(destination, chain, {"room": asset})
            with self.assertRaisesRegex(effetune.AssetError, "missing assets"):
                effetune.Bundle.pack(root / "missing", chain, {})
            with self.assertRaisesRegex(effetune.AssetError, "unreferenced assets"):
                effetune.Bundle.pack(
                    root / "extra", chain, {"room": asset, "unused": asset}
                )
            self.assertFalse((root / "missing").exists())
            self.assertFalse((root / "extra").exists())

    def test_bundle_pack_preserves_explicit_matrix_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            paths = (
                effetune.ConvolutionPath(0, 0, 0),
                effetune.ConvolutionPath(1, 1, 0),
                effetune.ConvolutionPath(0, 2, 1),
                effetune.ConvolutionPath(1, 3, 1),
            )
            bundle = effetune.Bundle.pack(
                Path(temporary) / "matrix",
                {
                    "version": 1,
                    "chain": [
                        {
                            "type": "FIRCrossover",
                            "parameters": {},
                            "assets": {"impulseResponse": "filters"},
                        }
                    ],
                },
                {
                    "filters": effetune.AssetData(
                        np.ones((2, 1), dtype=np.float32),
                        48_000,
                        topology="matrix",
                        paths=paths,
                        input_count=2,
                    )
                },
            )
            resolved = bundle.resolver("filters")
            self.assertEqual(resolved.topology, "matrix")
            self.assertEqual(resolved.input_count, 2)
            self.assertEqual(resolved.paths, paths)

    def test_bundle_manifest_rejects_shared_noncanonical_eta1_metadata(self) -> None:
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "common"
                / "bundle-manifest-invalid-v1.fixture.json"
            ).read_text(encoding="utf-8")
        )
        for case in fixture["invalid"]:
            entry = {
                "id": "room",
                "kind": "impulseResponse",
                "reference": "room.eta1",
                "sha256": "0" * 64,
                "byteLength": case["byteLength"],
                "format": {
                    **fixture["baseFormat"],
                    **case["formatOverrides"],
                },
            }
            manifest = {
                "version": 1,
                "chain": {"version": 1, "chain": []},
                "assets": [entry],
            }
            with self.subTest(case=case["name"]), self.assertRaises(
                effetune.AssetError
            ):
                effetune.Bundle(manifest, Path("."))

    def test_matrix_routes_follow_the_shared_input_contract(self) -> None:
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "common"
                / "matrix-routes-v1.fixture.json"
            ).read_text(encoding="utf-8")
        )
        for case in fixture["valid"]:
            channels = max(path["irChannel"] for path in case["paths"]) + 1
            asset = effetune.AssetData(
                np.ones((channels, 1), dtype=np.float32),
                48_000,
                topology="matrix",
                paths=tuple(case["paths"]),
                input_count=len({path["inputSlot"] for path in case["paths"]}),
            )
            self.assertEqual(
                resolve_topology(asset, case["processingChannels"], "matrix"),
                "matrix",
            )
        for case in fixture["invalid"]:
            channels = max(path["irChannel"] for path in case["paths"]) + 1
            input_count = len({path["inputSlot"] for path in case["paths"]})
            if case["name"] == "input-gap":
                with self.assertRaises(effetune.AssetError):
                    effetune.AssetData(
                        np.ones((channels, 1), dtype=np.float32),
                        48_000,
                        topology="matrix",
                        paths=tuple(case["paths"]),
                        input_count=input_count,
                    )
            else:
                asset = effetune.AssetData(
                    np.ones((channels, 1), dtype=np.float32),
                    48_000,
                    topology="matrix",
                    paths=tuple(case["paths"]),
                    input_count=input_count,
                )
                with self.assertRaises(effetune.AssetError):
                    resolve_topology(
                        asset, case["processingChannels"], "matrix"
                    )

    def test_semantic_preset_materializes_defaults(self) -> None:
        chain = effetune.Chain.from_preset(
            {
                "version": 1,
                "chain": [{"type": "Compressor", "parameters": {"threshold": -18}}],
            }
        )
        self.assertEqual(chain.effects[0].parameters["threshold"], -18)
        self.assertEqual(chain.effects[0].parameters["ratio"], 2)

    def test_from_preset_does_not_guess_legacy_envelopes(self) -> None:
        with self.assertRaises(effetune.ValidationError):
            effetune.Chain.from_preset({"plugins": []})

    def test_legacy_short_keys_and_sections_are_explicitly_flattened(self) -> None:
        chain, report = effetune.Chain.from_legacy_preset(
            {
                "plugins": [
                    {"nm": "Section", "en": False},
                    {
                        "nm": "Compressor",
                        "en": True,
                        "ch": "A",
                        "th": -12,
                        "rt": 4,
                        "at": 5,
                        "rl": 100,
                        "kn": 3,
                        "gn": 0,
                    },
                ]
            }
        )
        self.assertFalse(chain.effects[0].enabled)
        self.assertEqual(chain.effects[0].parameters["ratio"], 4)
        self.assertTrue(report.warnings)

    def test_legacy_analyzer_frequency_scale_display_state_is_validated_and_discarded(
        self,
    ) -> None:
        for name in ("Spectrum Analyzer", "Spectrogram"):
            for scale in ("log", "linear"):
                with self.subTest(name=name, scale=scale):
                    chain, _ = effetune.Chain.from_legacy_preset(
                        {"pipeline": [{"name": name, "parameters": {"sc": scale}}]}
                    )
                    self.assertNotIn("sc", chain.effects[0].parameters)
            with self.subTest(name=name, scale="invalid"):
                with self.assertRaisesRegex(
                    effetune.ValidationError,
                    r"invalid frequency scale display state",
                ):
                    effetune.Chain.from_legacy_preset(
                        {
                            "pipeline": [
                                {"name": name, "parameters": {"sc": "invalid"}}
                            ]
                        }
                    )
            with self.subTest(name=name, parameter="mystery"):
                with self.assertRaises(effetune.ValidationError):
                    effetune.Chain.from_legacy_preset(
                        {
                            "pipeline": [
                                {
                                    "name": name,
                                    "parameters": {"sc": "log", "mystery": 1},
                                }
                            ]
                        }
                    )

    def test_legacy_null_channel_preserves_stereo_and_unsupported_routing_fails(self) -> None:
        chain, _ = effetune.Chain.from_legacy_preset(
            {
                "pipeline": [
                    {
                        "name": "Volume",
                        "enabled": True,
                        "channel": None,
                        "parameters": {"vl": -3},
                    }
                ]
            }
        )
        self.assertEqual(chain.effects[0].channel, "stereo")
        with self.assertRaises(effetune.ValidationError):
            effetune.Chain.from_legacy_preset(
                {"plugins": [{"nm": "Volume", "en": True, "ib": 1, "vl": 0}]}
            )

    def test_legacy_channel_spellings_match_the_javascript_importer(self) -> None:
        # The app's js/utils/serialization-utils.js normalizeChannel accepts the
        # 'All'/'Left'/'Right' spellings and the empty string, so real exported
        # presets contain them. These expectations are the values the JavaScript
        # binding's legacyChannel (dsp/bindings/js/src/preset.js) produces for the
        # same inputs; both bindings must accept exactly this input set.
        expected_from_javascript = {
            "A": "all",
            "All": "all",
            "all": "all",
            "L": "left",
            "Left": "left",
            "left": "left",
            "R": "right",
            "Right": "right",
            "right": "right",
            "stereo": "stereo",
            "": "stereo",
            "1": "1",
            "34": "34",
        }
        for legacy, expected in expected_from_javascript.items():
            with self.subTest(channel=legacy):
                chain, _ = effetune.Chain.from_legacy_preset(
                    {
                        "pipeline": [
                            {
                                "name": "Volume",
                                "enabled": True,
                                "channel": legacy,
                                "parameters": {"vl": -3},
                            }
                        ]
                    }
                )
                self.assertEqual(chain.effects[0].channel, expected)
                self.assertEqual(
                    chain.to_dict()["chain"][0]["channel"], expected
                )
        for rejected in ("LEFT", "Stereo", "9", "0", "12", 1, True):
            with self.subTest(channel=rejected):
                with self.assertRaises(effetune.ValidationError):
                    effetune.Chain.from_legacy_preset(
                        {"plugins": [{"nm": "Volume", "en": True, "vl": 0, "ch": rejected}]}
                    )

    def test_unknown_legacy_effect_and_fields_are_not_silently_dropped(self) -> None:
        with self.assertRaises(effetune.EffectError):
            effetune.Chain.from_legacy_preset(
                {"plugins": [{"nm": "Not An Effect", "en": True}]}
            )
        with self.assertRaises(effetune.ValidationError):
            effetune.Chain.from_legacy_preset(
                {"plugins": [{"nm": "Volume", "en": True, "vl": 0, "mystery": 1}]}
            )

    def test_legacy_non_string_effect_name_stays_inside_the_error_taxonomy(self) -> None:
        # from_legacy_preset() reads files the caller did not author, so a name that is
        # not a string has to surface as a library error rather than a raw TypeError.
        # The JavaScript binding reports the same inputs as ValidationError; the two
        # bindings agree that the import fails, not on which library error type it is.
        for name in (123, ["Volume"], {}, True, None):
            with self.subTest(name=name):
                with self.assertRaises(effetune.EffectError) as context:
                    effetune.Chain.from_legacy_preset(
                        {"pipeline": [{"name": name, "enabled": True, "parameters": {}}]}
                    )
                self.assertIn("legacy effect name", str(context.exception))

    def test_legacy_non_numeric_packed_values_report_validation_errors(self) -> None:
        # The inverse transforms are arithmetic; a value the app could never have written
        # must not leak the arithmetic's own TypeError. The JavaScript binding carries the
        # same guard in reverseTransform, because its coercion would otherwise turn null,
        # true or [] into a number instead of failing.
        cases = {
            "list": {"name": "Tilt EQ", "parameters": {"f0": [1, 2], "sl": 0}},
            "dict": {"name": "Simple Jitter", "parameters": {"rj": {}}},
            "str": {"name": "Tilt EQ", "parameters": {"f0": "x", "sl": 0}},
            "bool": {"name": "Tilt EQ", "parameters": {"f0": True, "sl": 0}},
            "null": {"name": "Simple Jitter", "parameters": {"rj": None}},
            "empty list": {"name": "Simple Jitter", "parameters": {"rj": []}},
        }
        for label, node in cases.items():
            with self.subTest(value=label):
                with self.assertRaisesRegex(
                    effetune.ValidationError, r"contains a non-numeric value"
                ):
                    effetune.Chain.from_legacy_preset(
                        {"pipeline": [{**node, "enabled": True}]}
                    )
        with self.assertRaisesRegex(
            effetune.ValidationError, r"contains a non-finite value"
        ):
            effetune.Chain.from_legacy_preset(
                {
                    "pipeline": [
                        {
                            "name": "Tilt EQ",
                            "enabled": True,
                            "parameters": {"f0": float("inf"), "sl": 0},
                        }
                    ]
                }
            )
        # A value on the wrong scale (Hz where the app stores a logarithm) overflows the
        # exponentiation instead of producing a nonsense number, and must be reported the
        # same way the JavaScript binding reports its Infinity.
        for overflowing in (1000, 1e9):
            with self.subTest(value=overflowing):
                with self.assertRaisesRegex(
                    effetune.ValidationError, r"contains an out-of-range value"
                ):
                    effetune.Chain.from_legacy_preset(
                        {
                            "pipeline": [
                                {
                                    "name": "Tilt EQ",
                                    "enabled": True,
                                    "parameters": {"f0": overflowing, "sl": 0},
                                }
                            ]
                        }
                    )
        # A value the app really does write keeps converting.
        chain, _ = effetune.Chain.from_legacy_preset(
            {
                "pipeline": [
                    {
                        "name": "Tilt EQ",
                        "enabled": True,
                        "parameters": {"f0": math.log(1000), "sl": 0},
                    }
                ]
            }
        )
        self.assertAlmostEqual(chain.effects[0].parameters["pivotFrequency"], 1000)

    def test_integer_literals_too_large_for_a_double_stay_inside_the_taxonomy(self) -> None:
        # JSON puts no bound on an integer literal, so json.loads keeps a 400-digit number
        # as an unbounded int. Every path that turns such a value into a double -- the
        # shared scalar validation, the legacy inverse transforms, the legacy meter-state
        # check and validate_sample_rate -- has to report it instead of raising the
        # OverflowError that float()/math.isfinite() would.
        huge = "1" + "0" * 400
        band = {"t": -24, "r": 2, "a": 10, "rl": 100, "k": 3, "g": 0, "gr": 0}
        # (1) shared scalar validation, reached from the semantic and the legacy path.
        for document in (
            f'{{"pipeline":[{{"name":"Volume","enabled":true,"parameters":{{"vl":{huge}}}}}]}}',
            f'{{"plugins":[{{"nm":"Volume","en":true,"vl":-{huge}}}]}}',
        ):
            with self.subTest(document=document[:40]):
                with self.assertRaisesRegex(
                    effetune.ValidationError, r"must be a finite number"
                ):
                    effetune.Chain.from_legacy_preset(json.loads(document))
        with self.assertRaisesRegex(effetune.ValidationError, r"must be a finite number"):
            effetune.Chain.from_preset(
                json.loads(
                    f'{{"version":1,"chain":[{{"type":"Volume",'
                    f'"parameters":{{"volume":{huge}}}}}]}}'
                )
            )
        # (2) the legacy inverse transforms.
        with self.assertRaisesRegex(
            effetune.ValidationError, r"contains an out-of-range value"
        ):
            effetune.Chain.from_legacy_preset(
                json.loads(
                    f'{{"pipeline":[{{"name":"Tilt EQ","enabled":true,'
                    f'"parameters":{{"f0":{huge},"sl":0}}}}]}}'
                )
            )
        # (3) the legacy object-array meter state.
        bands = json.dumps([band] * 5).replace('"gr": 0', f'"gr": {huge}', 1)
        with self.assertRaisesRegex(
            effetune.ValidationError, r"invalid meter display state"
        ):
            effetune.Chain.from_legacy_preset(
                json.loads(
                    f'{{"pipeline":[{{"name":"Multiband Compressor","enabled":true,'
                    f'"parameters":{{"bands":{bands}}}}}]}}'
                )
            )
        # (4) validate_sample_rate, which only a programmatic caller can reach.
        with self.assertRaisesRegex(
            effetune.ValidationError, r"sample_rate must be a positive finite number"
        ):
            validate_sample_rate(json.loads(huge))

    def test_legacy_section_accepts_the_same_structural_fields_as_other_nodes(self) -> None:
        # A Section node carries the same structural fields any other node does: the app's
        # long format assigns it an `id`, and its short format echoes the serializer's
        # structural keys into the node. Both are accepted by the JavaScript binding and
        # produce an empty chain there, so the Python binding must not reject them.
        for label, preset in {
            "long form id": {
                "pipeline": [
                    {
                        "name": "Section",
                        "enabled": True,
                        "parameters": {"cm": ""},
                        "id": "x",
                    }
                ]
            },
            "short form echoed keys": {
                "plugins": [
                    {
                        "nm": "Section",
                        "en": True,
                        "cm": "hi",
                        "ch": "L",
                        "ib": 0,
                        "ob": 0,
                        "pluginType": "SectionPlugin",
                    }
                ]
            },
        }.items():
            with self.subTest(form=label):
                chain, report = effetune.Chain.from_legacy_preset(preset)
                self.assertEqual(chain.to_dict(), {"version": 1, "chain": []})
                self.assertTrue(
                    any("flattened legacy Section" in warning for warning in report.warnings)
                )
        # Genuinely unknown Section fields are still reported.
        with self.assertRaisesRegex(
            effetune.ValidationError, r"legacy Section contains unsupported fields: mystery"
        ):
            effetune.Chain.from_legacy_preset(
                {"pipeline": [{"name": "Section", "enabled": True, "mystery": 1}]}
            )

    def test_legacy_importer_follows_shared_app_export_contract_fixture(self) -> None:
        fixture_path = (
            Path(__file__).resolve().parents[2]
            / "common"
            / "legacy-app-export-v1.fixture.json"
        )
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        chain, report = effetune.Chain.from_legacy_preset(fixture["preset"])
        self.assertTrue(
            any("discarded legacy preset metadata" in warning for warning in report.warnings)
        )
        self.assertTrue(any("flattened legacy Section" in warning for warning in report.warnings))
        for effect, expected in zip(chain.effects, fixture["expected"], strict=True):
            self.assertEqual(effect.id, expected.get("id"))
            self.assertEqual(effect.effect_type, expected["type"])
            self.assertEqual(effect.enabled, expected["enabled"])
            self.assertEqual(effect.channel, expected["channel"])
            if effect.effect_type == "TiltEQ":
                self.assertAlmostEqual(
                    effect.parameters["pivotFrequency"],
                    expected["parameters"]["pivotFrequency"],
                )
                self.assertEqual(
                    effect.parameters["slope"], expected["parameters"]["slope"]
                )
            else:
                self.assertEqual(
                    json.loads(json.dumps(effect.parameters)),
                    expected["parameters"],
                )
        with self.assertRaises(effetune.EffectError):
            effetune.Chain.from_legacy_preset(fixture["unknownEffect"])

    def test_numeric_app_display_names_resolve_to_semantic_effects(self) -> None:
        fixture = _legacy_fixture()
        aliases = fixture["displayNameAliases"]
        self.assertEqual(
            aliases,
            dict(presets._LEGACY_EFFECT_ALIASES_V1),
            "the Python alias table must match the shared cross-language fixture",
        )
        for display_name, effect_type in aliases.items():
            with self.subTest(display_name=display_name):
                try:
                    chain, _ = effetune.Chain.from_legacy_preset(
                        {"pipeline": [{"name": display_name, "parameters": {}}]}
                    )
                except effetune.EffectError as error:
                    # Effects the library drives from a precomputed impulse response
                    # resolve their display name but cannot be converted from an app
                    # preset at all; the report names the resolved semantic type.
                    self.assertIn(
                        f"{effect_type} cannot be imported from an EffeTune app preset",
                        str(error),
                        f"{display_name} did not resolve: {error}",
                    )
                else:
                    self.assertEqual(chain.effects[0].effect_type, effect_type)
        with self.assertRaises(effetune.EffectError):
            effetune.Chain.from_legacy_preset(
                {
                    "pipeline": [
                        {"name": fixture["unaliasedDisplayName"], "parameters": {}}
                    ]
                }
            )

    def test_app_preset_envelopes_are_reported_as_legacy_documents(self) -> None:
        for envelope in ("pipeline", "plugins"):
            with self.subTest(envelope=envelope):
                with self.assertRaisesRegex(
                    effetune.ValidationError,
                    r"EffeTune app preset field\(s\): "
                    + envelope
                    + r";.*Chain\.from_legacy_preset\(\)",
                ):
                    effetune.Chain.from_preset({envelope: []})
        with self.assertRaisesRegex(
            effetune.ValidationError, r"field\(s\): pipeline, plugins"
        ):
            effetune.Chain.from_preset({"pipeline": [], "plugins": []})

    def test_short_format_entries_report_the_supported_export_format(self) -> None:
        expected = (
            r"uses short-format keys \(nm/en\);.*"
            r"URL or clipboard are not supported\..*\.effetune_preset file \(long format\)"
        )
        with self.assertRaisesRegex(effetune.ValidationError, expected) as context:
            effetune.Chain.from_legacy_preset(
                {"pipeline": [{"nm": "Volume", "en": True, "vl": 0}]}
            )
        self.assertIn("legacy pipeline[0]", str(context.exception))
        with self.assertRaisesRegex(effetune.ValidationError, expected):
            effetune.Chain.from_legacy_preset([{"nm": "Volume", "en": True, "vl": 0}])
        # The recognized short-format envelope keeps working.
        chain, _ = effetune.Chain.from_legacy_preset(
            {"plugins": [{"nm": "Volume", "en": True, "vl": 0}]}
        )
        self.assertEqual(chain.effects[0].effect_type, "Volume")

    def test_legacy_composite_shapes_preserve_processing_parameters(self) -> None:
        compressor_bands = [
            {"t": -20, "r": 4, "a": 30, "rl": 150, "k": 6, "g": -1, "gr": 0},
            {"t": -22, "r": 3, "a": 20, "rl": 120, "k": 4, "g": 0, "gr": 0},
            {"t": -25, "r": 2.5, "a": 15, "rl": 80, "k": 4, "g": 1, "gr": 0},
            {"t": -28, "r": 2, "a": 10, "rl": 60, "k": 3, "g": 1.5, "gr": 0},
            {"t": -18, "r": 5, "a": 5, "rl": 40, "k": 2, "g": -2, "gr": 0},
        ]
        saturation_bands = [
            {"dr": 1.5, "bs": 0.1, "mx": 50, "gn": 0},
            {"dr": 2.0, "bs": 0.0, "mx": 60, "gn": 1},
            {"dr": 2.5, "bs": -0.1, "mx": 70, "gn": -1},
        ]
        resonators = [
            {"en": True, "fr": 6.86, "dc": 15, "lp": 7.19, "hp": 5.8, "gn": 0},
            {"en": True, "fr": 7.52, "dc": 12, "lp": 7.86, "hp": 6.48, "gn": -3},
            {"en": True, "fr": 7.99, "dc": 10, "lp": 8.33, "hp": 6.94, "gn": -6},
            {"en": False, "fr": 8.34, "dc": 8, "lp": 8.68, "hp": 7.29, "gn": -9},
            {"en": True, "fr": 8.75, "dc": 6, "lp": 9.08, "hp": 7.7, "gn": -12},
        ]
        chain, report = effetune.Chain.from_legacy_preset(
            {
                "pipeline": [
                    {"name": "Matrix", "parameters": {"mx": "0002p0311p1213"}},
                    {
                        "name": "Multiband Compressor",
                        "parameters": {
                            "f1": 100,
                            "f2": 500,
                            "f3": 2000,
                            "f4": 8000,
                            "bands": compressor_bands,
                        },
                    },
                    {
                        "name": "Multiband Saturation",
                        "parameters": {
                            "f1": 200,
                            "f2": 4000,
                            "bands": saturation_bands,
                        },
                    },
                    {
                        "name": "Modal Resonator",
                        "parameters": {
                            "en": False,
                            "rs": resonators,
                            "mx": 25,
                            "sr": 3,
                        },
                    },
                ]
            }
        )
        self.assertEqual(chain.effects[0].parameters["matrixRoutes"], "0002p0311p1213")
        self.assertEqual(
            list(chain.effects[1].parameters["threshold"]),
            [band["t"] for band in compressor_bands],
        )
        self.assertEqual(
            list(chain.effects[2].parameters["drive"]),
            [band["dr"] for band in saturation_bands],
        )
        self.assertFalse(chain.effects[3].enabled)
        self.assertEqual(
            list(chain.effects[3].parameters["resonatorEnabled"]),
            [resonator["en"] for resonator in resonators],
        )
        self.assertTrue(any("meter display state" in item for item in report.warnings))
        self.assertTrue(any("editor selection" in item for item in report.warnings))

    def test_dynamic_eq_app_band_shape_preserves_semantic_values(self) -> None:
        preset_path = (
            Path(__file__).resolve().parents[4]
            / "presets"
            / "processor"
            / "bbe.effetune_preset"
        )
        chain, _ = effetune.Chain.from_legacy_preset(preset_path)
        dynamic_eq = next(
            effect
            for effect in chain.effects
            if effect.effect_type == "FiveBandDynamicEQ"
        )
        self.assertEqual(
            list(dynamic_eq.parameters["enabledBands"]),
            [False, False, True, False, False],
        )
        self.assertAlmostEqual(
            dynamic_eq.parameters["frequency"][2], 2517.850823588333
        )
        self.assertAlmostEqual(dynamic_eq.parameters["ratio"][2], 0.8228108312679314)

    def test_structured_app_parameter_shapes_follow_the_shared_fixture(self) -> None:
        fixture = _legacy_fixture()["structuredParameters"]
        chain, _ = effetune.Chain.from_legacy_preset(fixture["preset"])
        self.assertEqual(len(chain.effects), len(fixture["expected"]))
        for effect, expected in zip(chain.effects, fixture["expected"], strict=True):
            with self.subTest(effect=expected["type"]):
                self.assertEqual(effect.effect_type, expected["type"])
                self.assertEqual(effect.enabled, expected["enabled"])
                self.assertEqual(effect.channel, expected["channel"])
                actual = {
                    name: list(value) if isinstance(value, tuple) else value
                    for name, value in effect.parameters.items()
                }
                self.assertEqual(actual, expected["parameters"])
        for case in fixture["invalid"]:
            with self.subTest(reason=case["reason"]):
                with self.assertRaisesRegex(
                    effetune.ValidationError, re.escape(case["message"])
                ):
                    effetune.Chain.from_legacy_preset(case["preset"])

    def test_echoed_structural_keys_are_dropped_from_legacy_parameters(self) -> None:
        # Mirrors the JavaScript binding's
        # "the app's echoed structural parameter keys are ignored" test.
        fixture = _legacy_fixture()["echoedStructuralKeys"]
        chain, _ = effetune.Chain.from_legacy_preset(fixture["preset"])
        self.assertEqual(len(chain.effects), len(fixture["expected"]))
        for effect, expected in zip(chain.effects, fixture["expected"], strict=True):
            with self.subTest(effect=expected["type"]):
                self.assertEqual(effect.effect_type, expected["type"])
                self.assertEqual(effect.enabled, expected["enabled"])
                self.assertEqual(effect.channel, expected["channel"])
                for name, value in expected["parameters"].items():
                    self.assertEqual(effect.parameters[name], value, name)

    def test_bare_array_presets_are_read_as_a_long_format_pipeline(self) -> None:
        # Mirrors the JavaScript binding's
        # "bare array presets are read as a long-format pipeline" test.
        fixture = _legacy_fixture()["bareArrayPipeline"]
        for source in (fixture["long"], json.dumps(fixture["long"])):
            chain, _ = effetune.Chain.from_legacy_preset(source)
            self.assertEqual(len(chain.effects), len(fixture["expected"]))
            for effect, expected in zip(chain.effects, fixture["expected"], strict=True):
                with self.subTest(effect=expected["type"]):
                    self.assertEqual(effect.effect_type, expected["type"])
                    self.assertEqual(effect.enabled, expected["enabled"])
                    self.assertEqual(effect.channel, expected["channel"])
                    for name, value in expected["parameters"].items():
                        self.assertEqual(effect.parameters[name], value, name)
        with self.assertRaisesRegex(
            effetune.ValidationError, re.escape(fixture["shortMessageIncludes"])
        ):
            effetune.Chain.from_legacy_preset(fixture["short"])

    def test_legacy_composite_shapes_reject_unknown_or_incomplete_members(self) -> None:
        with self.assertRaisesRegex(effetune.ValidationError, "exactly 3 band settings"):
            effetune.Chain.from_legacy_preset(
                {
                    "pipeline": [
                        {
                            "name": "Multiband Saturation",
                            "parameters": {
                                "bands": [
                                    {"dr": 1, "bs": 0, "mx": 100, "gn": 0},
                                ]
                            },
                        }
                    ]
                }
            )
        bands = [
            {"dr": 1, "bs": 0, "mx": 100, "gn": 0},
            {"dr": 1, "bs": 0, "mx": 100, "gn": 0},
            {"dr": 1, "bs": 0, "mx": 100, "gn": 0, "mystery": 1},
        ]
        with self.assertRaisesRegex(
            effetune.ValidationError, "unsupported or incomplete band settings"
        ):
            effetune.Chain.from_legacy_preset(
                {
                    "pipeline": [
                        {
                            "name": "Multiband Saturation",
                            "parameters": {"bands": bands},
                        }
                    ]
                }
            )

    def test_app_serializer_corpus_reaches_its_annotated_outcome(self) -> None:
        # The JavaScript binding drives the same corpus from this shared fixture, so
        # every plugin the app can export is covered in both languages.
        corpus = _legacy_fixture()["appSerializerCorpus"]
        self.assertEqual(len(corpus["entries"]), corpus["count"])
        counts: dict[str, int] = {}
        for entry in corpus["entries"]:
            label = f"{entry['displayName']} ({entry['variant']})"
            counts[entry["outcome"]] = counts.get(entry["outcome"], 0) + 1
            preset = {"pipeline": [entry["node"]]}
            with self.subTest(entry=label):
                if entry["outcome"] in ("imports", "flattened"):
                    chain, _ = effetune.Chain.from_legacy_preset(preset)
                    self.assertEqual(
                        [effect.effect_type for effect in chain.effects],
                        entry["types"],
                    )
                    for effect in chain.effects:
                        self.assertEqual(effect.channel, entry["channel"])
                    continue
                with self.assertRaises(effetune.EffeTuneError) as context:
                    effetune.Chain.from_legacy_preset(preset)
                self.assertEqual(
                    type(context.exception).__name__, entry["errorType"]
                )
                self.assertIn(entry["messageIncludes"], str(context.exception))
        self.assertEqual(counts, corpus["outcomeCounts"])

    def test_bundled_serial_presets_import_and_multibus_presets_explain_limit(
        self,
    ) -> None:
        corpus = _legacy_fixture()["bundledPresetCorpus"]
        preset_root = Path(__file__).resolve().parents[4] / "presets"
        preset_paths = sorted(preset_root.rglob("*.effetune_preset"))
        # The JavaScript binding drives the same corpus from this shared list.
        unsupported = {Path(entry) for entry in corpus["multiBus"]}
        self.assertEqual(len(preset_paths), corpus["count"])
        for preset_path in preset_paths:
            relative = preset_path.relative_to(preset_root)
            with self.subTest(preset=relative.as_posix()):
                if relative in unsupported:
                    with self.assertRaisesRegex(
                        effetune.ValidationError, "one serial effect chain"
                    ) as context:
                        effetune.Chain.from_legacy_preset(preset_path)
                    self.assertNotIn("bus-0", str(context.exception))
                    self.assertNotIn("index", str(context.exception))
                else:
                    chain, _ = effetune.Chain.from_legacy_preset(preset_path)
                    self.assertTrue(chain.effects)

    def test_bundle_verifies_canonical_eta1_mono_and_resolves_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            samples = np.array([[1.0, 0.5, 0.25]], dtype="<f4")
            payload = _eta1_payload(samples, topology="mono")
            (root / "room.eta1").write_bytes(payload)
            manifest = _bundle_manifest(
                _asset_entry(payload, samples, topology="mono")
            )
            (root / "bundle.json").write_text(json.dumps(manifest), encoding="utf-8")
            bundle = effetune.Bundle.load(root)
            asset = bundle.resolver("room")
            self.assertIsNotNone(asset)
            np.testing.assert_array_equal(asset.samples, samples)
            chain = effetune.Chain.from_preset(
                bundle.chain_document, asset_resolver=bundle.resolver
            )
            source = np.zeros((2, 512), dtype=np.float32)
            source[0, 0] = 1.0
            output = chain(source, 48_000)
            self.assertTrue(np.isfinite(output).all())

    def test_bundle_resolves_true_stereo_and_matrix_eta1(self) -> None:
        fixtures = (
            (
                "trueStereo",
                np.arange(8, dtype=np.float32).reshape(4, 2),
                (),
            ),
            (
                "matrix",
                np.arange(4, dtype=np.float32).reshape(2, 2),
                ((0, 0, 0), (1, 1, 1)),
            ),
        )
        for topology, samples, paths in fixtures:
            with self.subTest(topology=topology), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                payload = _eta1_payload(
                    samples, topology=topology, paths=paths
                )
                (root / "room.eta1").write_bytes(payload)
                manifest = _bundle_manifest(
                    _asset_entry(
                        payload, samples, topology=topology, paths=paths
                    )
                )
                (root / "bundle.json").write_text(
                    json.dumps(manifest), encoding="utf-8"
                )
                asset = effetune.Bundle.load(root).resolver("room")
                self.assertEqual(asset.topology, topology)
                np.testing.assert_array_equal(asset.samples, samples)
                if topology == "matrix":
                    self.assertEqual(asset.input_count, 2)
                    self.assertEqual(
                        [
                            (path.input_slot, path.output_slot, path.ir_channel)
                            for path in asset.paths
                        ],
                        list(paths),
                    )

    def test_bundle_rejects_eta1_hash_length_header_and_path_mismatches(self) -> None:
        samples = np.ones((2, 2), dtype=np.float32)
        paths = ((0, 0, 0), (1, 1, 1))
        original = _eta1_payload(samples, topology="matrix", paths=paths)
        cases: list[tuple[str, bytes, dict[str, object]]] = []

        bad_hash = _asset_entry(original, samples, topology="matrix", paths=paths)
        bad_hash["sha256"] = "0" * 64
        cases.append(("hash", original, bad_hash))

        bad_length = _asset_entry(original, samples, topology="matrix", paths=paths)
        bad_length["byteLength"] = len(original) - 4
        cases.append(("length", original, bad_length))

        bad_header_payload = bytearray(original)
        struct.pack_into("<I", bad_header_payload, 4, 1)
        bad_header = _asset_entry(
            bytes(bad_header_payload), samples, topology="matrix", paths=paths
        )
        cases.append(("header", bytes(bad_header_payload), bad_header))

        bad_path_payload = bytearray(original)
        struct.pack_into("<I", bad_path_payload, 32, 1)
        bad_path = _asset_entry(
            bytes(bad_path_payload), samples, topology="matrix", paths=paths
        )
        cases.append(("path", bytes(bad_path_payload), bad_path))

        for label, payload, entry in cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "room.eta1").write_bytes(payload)
                (root / "bundle.json").write_text(
                    json.dumps(_bundle_manifest(entry)), encoding="utf-8"
                )
                with self.assertRaises(effetune.AssetError):
                    effetune.Bundle.load(root).resolver("room")

    def test_bundle_reads_only_the_declared_length_plus_one(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            samples = np.ones((1, 1), dtype=np.float32)
            payload = _eta1_payload(samples, topology="mono")
            asset_path = root / "room.eta1"
            with asset_path.open("wb") as asset_file:
                asset_file.write(payload)
                asset_file.truncate(32 * 1024 * 1024 + 1)
            entry = _asset_entry(payload, samples, topology="mono")
            (root / "bundle.json").write_text(
                json.dumps(_bundle_manifest(entry)), encoding="utf-8"
            )
            with self.assertRaises(effetune.AssetError):
                effetune.Bundle.load(root).resolver("room")

    def test_ir_native_footprint_limit_is_reported_as_asset_error(self) -> None:
        samples = np.zeros((1, 2_000_000), dtype=np.float32)
        samples[0, 0] = 1.0
        chain = effetune.Chain(
            [
                effetune.IRReverb(
                    assets={"impulseResponse": "large"},
                    channel_mode="mono",
                )
            ]
        )
        with self.assertRaises(effetune.AssetError):
            chain.stream(
                48_000,
                channels=1,
                asset_resolver=lambda _: effetune.AssetData(
                    samples, 48_000, topology="mono"
                ),
            )

    def test_missing_wrong_and_nonfinite_assets_raise_asset_error(self) -> None:
        chain = effetune.Chain(
            [
                effetune.IRReverb(
                    assets={"impulseResponse": "room"},
                    wet_level=0,
                    dry_level=-96,
                )
            ]
        )
        source = np.zeros((2, 128), dtype=np.float32)
        with self.assertRaises(effetune.AssetError):
            chain(source, 48_000)
        with self.assertRaises(effetune.AssetError):
            chain(
                source,
                48_000,
                asset_resolver=lambda _: {"kind": "wrong", "samples": source, "sampleRate": 48000},
            )
        invalid = source.copy()
        invalid[0, 0] = np.inf
        with self.assertRaises(effetune.AssetError):
            chain(
                source,
                48_000,
                asset_resolver=lambda _: effetune.AssetData(invalid, 48000),
            )

    def test_disabled_ir_does_not_resolve_its_required_asset(self) -> None:
        resolver_calls = 0

        def resolver(_: str) -> effetune.AssetData:
            nonlocal resolver_calls
            resolver_calls += 1
            raise AssertionError("disabled assets must not be resolved")

        chain = effetune.Chain(
            [
                effetune.IRReverb(
                    enabled=False,
                    assets={"impulseResponse": "unused"},
                )
            ],
            asset_resolver=resolver,
        )
        source = np.ones((2, 16), dtype=np.float32)
        np.testing.assert_array_equal(chain(source, 48_000), source)
        self.assertEqual(resolver_calls, 0)


if __name__ == "__main__":
    unittest.main()
