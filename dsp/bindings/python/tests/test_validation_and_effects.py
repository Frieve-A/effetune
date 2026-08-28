from __future__ import annotations

import unittest
import importlib.metadata
import json
from pathlib import Path

import numpy as np

import effetune
from effetune._generated_effects import EFFECT_CLASSES, EFFECT_METADATA
from effetune.validation import pack_parameter_bytes, pack_parameters


class ValidationAndEffectsTests(unittest.TestCase):
    def test_sixteen_channel_single_and_pair_selections(self) -> None:
        selections = [(str(index + 1), index, 1) for index in range(8, 16)]
        selections += [("910", 8, 2), ("1112", 10, 2), ("1314", 12, 2), ("1516", 14, 2)]
        for channel, start, count in selections:
            with self.subTest(channel=channel):
                output = effetune.Volume(volume=-6, channel=channel).process(
                    np.ones((16, 8), dtype=np.float32), sample_rate=48000,
                )
                expected = np.ones((16, 8), dtype=np.float32)
                expected[start:start + count] = 10 ** (-6 / 20)
                np.testing.assert_allclose(output, expected, atol=1e-6, rtol=0)

    def test_runtime_version_matches_wheel_and_package_manifests(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        npm_data = json.loads(
            (repository_root / "dsp" / "bindings" / "js" / "package.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(effetune.__version__, importlib.metadata.version("effetune"))
        self.assertEqual(effetune.__version__, npm_data["version"])

    def test_unknown_generated_factory_type_uses_public_effect_error(self) -> None:
        with self.assertRaises(effetune.EffectError):
            effetune._generated_effects.create_effect("NotAnEffect")

    def test_generated_catalog_imports_and_constructs_all_approved_classes(self) -> None:
        self.assertEqual(len(EFFECT_CLASSES), 92)
        self.assertEqual(len(EFFECT_METADATA["effects"]), 92)
        asset_effects = {
            "FIRCrossover",
            "FiveBandFIRPEQ",
            "GroupDelayEQ",
            "GroupDelayPEQ",
            "IRReverb",
            "RoomEQ",
        }
        for name, effect_class in EFFECT_CLASSES.items():
            effect = (
                effect_class(assets={"impulseResponse": "room"})
                if name in asset_effects
                else effect_class()
            )
            self.assertEqual(effect.type, name)

    def test_public_catalog_mutation_does_not_change_runtime_metadata(self) -> None:
        self.assertIsNot(effetune.EFFECT_METADATA, EFFECT_METADATA)
        public_volume = next(
            entry
            for entry in effetune.EFFECT_METADATA["effects"]
            if entry["type"] == "Volume"
        )
        internal_volume = next(
            entry for entry in EFFECT_METADATA["effects"] if entry["type"] == "Volume"
        )
        public_maximum = public_volume["parameters"][0]["maximum"]
        try:
            public_volume["parameters"][0]["maximum"] = -100
            self.assertEqual(internal_volume["parameters"][0]["maximum"], 24)
            self.assertEqual(effetune.Volume(volume=0).parameters["volume"], 0)
        finally:
            public_volume["parameters"][0]["maximum"] = public_maximum

    def test_parameter_validation_is_semantic_and_finite(self) -> None:
        with self.assertRaises(effetune.ValidationError):
            effetune.Compressor(ratio=21)
        with self.assertRaises(effetune.ValidationError):
            effetune.Compressor(threshold=float("nan"))
        with self.assertRaises(effetune.ValidationError):
            effetune.FiveBandPEQ(gains=(0, 0))
        with self.assertRaises(effetune.ValidationError):
            effetune.HardClipping(mode="unknown")

    def test_phaser_stage_choices_are_preserved_and_odd_values_are_rejected(self) -> None:
        for stages in (2, 4, 6, 8, 10, 12):
            with self.subTest(stages=stages):
                self.assertEqual(
                    effetune.Phaser(stages=stages).parameters["stages"], stages
                )
                chain = effetune.Chain.from_preset(
                    {
                        "version": 1,
                        "chain": [
                            {
                                "type": "Phaser",
                                "parameters": {"stages": stages},
                            }
                        ],
                    }
                )
                self.assertEqual(chain.effects[0].parameters["stages"], stages)

        for stages in (3, 5, 7, 9, 11):
            with self.subTest(stages=stages):
                with self.assertRaises(effetune.ValidationError):
                    effetune.Phaser(stages=stages)
                with self.assertRaises(effetune.ValidationError):
                    effetune.Chain.from_preset(
                        {
                            "version": 1,
                            "chain": [
                                {
                                    "type": "Phaser",
                                    "parameters": {"stages": stages},
                                }
                            ],
                        }
                    )

    def test_chain_version_and_effect_channel_fail_with_validation_errors(self) -> None:
        with self.assertRaises(effetune.ValidationError):
            effetune.Chain.from_preset({"version": True, "chain": []})
        for channel in (None, 1, [], {}):
            with self.subTest(channel=channel), self.assertRaises(effetune.ValidationError):
                effetune.Volume(channel=channel)

    def test_ir_asset_reference_is_required(self) -> None:
        with self.assertRaises(effetune.AssetError):
            effetune.IRReverb()
        with self.assertRaises(effetune.AssetError):
            effetune.IRReverb(
                assets={"impulseResponse": "room", "unknown": "room"}
            )
        with self.assertRaises(effetune.AssetError):
            effetune.Chain.from_preset(
                {
                    "version": 1,
                    "chain": [
                        {
                            "type": "Volume",
                            "parameters": {},
                            "assets": {"impulseResponse": "room"},
                        }
                    ],
                }
            )

    def test_block_size_has_a_dedicated_bounded_contract(self) -> None:
        audio = np.zeros((1, 1), dtype=np.float32)
        chain = effetune.Chain()
        for value in (1, 16_384):
            with self.subTest(valid=value):
                np.testing.assert_array_equal(
                    chain.process(audio, sample_rate=48_000, block_size=value),
                    audio,
                )
                with chain.stream(
                    48_000, channels=1, block_size=value
                ) as stream:
                    np.testing.assert_array_equal(stream.process(audio), audio)
        for value in (True, 0, 16_385, 1.5):
            with self.subTest(invalid=value):
                with self.assertRaises(effetune.ValidationError):
                    chain.process(audio, sample_rate=48_000, block_size=value)
                with self.assertRaises(effetune.ValidationError):
                    chain.stream(48_000, channels=1, block_size=value)

    def test_audio_contract_rejects_dtype_shape_and_nonfinite_values(self) -> None:
        effect = effetune.Volume()
        with self.assertRaises(effetune.ValidationError):
            effect.process(np.zeros((1, 8), dtype=np.float64), sample_rate=48_000)
        with self.assertRaises(effetune.ValidationError):
            effect.process(np.zeros(8, dtype=np.float32), sample_rate=48_000)
        audio = np.zeros((1, 8), dtype=np.float32)
        audio[0, 3] = np.nan
        with self.assertRaises(effetune.ValidationError):
            effect.process(audio, sample_rate=48_000)

    def test_audio_contract_hints_only_for_likely_interleaved_shapes(self) -> None:
        effect = effetune.Volume()
        likely_interleaved = np.zeros((32, 2), dtype=np.float32)
        with self.assertRaisesRegex(
            effetune.ValidationError,
            r"np\.ascontiguousarray\(audio\.T, dtype=np\.float32\)",
        ):
            effect.process(likely_interleaved, sample_rate=48_000)

        true_seventeen_channel = np.zeros((17, 32), dtype=np.float32)
        with self.assertRaises(effetune.ValidationError) as caught:
            effect.process(true_seventeen_channel, sample_rate=48_000)
        self.assertEqual(str(caught.exception), "audio supports at most 16 channels")

        planar = np.zeros((2, 256), dtype=np.float32)
        frame_slice = planar[:, 0:128]
        self.assertFalse(frame_slice.flags.c_contiguous)
        expected = (
            "audio must be C-contiguous planar data; frame-direction slices such as "
            "audio[:, start:stop] are non-contiguous views, so pass "
            "np.ascontiguousarray(block)"
        )
        with self.assertRaises(effetune.ValidationError) as caught:
            effect.process(frame_slice, sample_rate=48_000)
        self.assertEqual(str(caught.exception), expected)
        with effetune.Chain([effetune.Volume()]).stream(
            48_000, channels=2, block_size=128
        ) as stream:
            with self.assertRaises(effetune.ValidationError) as caught:
                stream.process(frame_slice)
            self.assertEqual(str(caught.exception), expected)
            np.testing.assert_array_equal(
                stream.process(np.ascontiguousarray(frame_slice)),
                np.zeros((2, 128), dtype=np.float32),
            )

    def test_seed_is_strict_uint32(self) -> None:
        audio = np.zeros((1, 8), dtype=np.float32)
        chain = effetune.Chain()
        for value in (True, -1, 2**32, 1.5):
            with self.subTest(value=value), self.assertRaises(effetune.ValidationError):
                chain.process(audio, sample_rate=48_000, seed=value)

    def test_duplicate_explicit_ids_are_rejected(self) -> None:
        with self.assertRaises(effetune.ValidationError):
            effetune.Chain(
                [effetune.Volume(id="same"), effetune.Compressor(id="same")]
            )

    @staticmethod
    def _parameter_index(effect_type: str, parameter: str) -> int:
        """Locate a parameter in the packed layout by name.

        The packed order follows the catalog, so a parameter added ahead of an
        existing one shifts every index behind it. Resolving the position here
        keeps these assertions about the encoding rather than about the layout.
        """
        effect = next(
            entry
            for entry in EFFECT_METADATA["effects"]
            if entry["type"] == effect_type
        )
        return next(
            index
            for index, item in enumerate(effect["parameters"])
            if item["name"] == parameter
        )

    def test_string_encoded_map_values_pack_as_enum_indexes(self) -> None:
        fm_50, _, _ = pack_parameters(
            effetune.FMRadioSimulator(emphasis="50us")
        )
        fm_75, _, _ = pack_parameters(
            effetune.FMRadioSimulator(emphasis="75us")
        )
        ir, _, _ = pack_parameters(
            effetune.IRReverb(
                assets={"impulseResponse": "room"},
                channel_mode="mono",
                latency=128,
            )
        )
        emphasis = self._parameter_index("FMRadioSimulator", "emphasis")
        channel_mode = self._parameter_index("IRReverb", "channelMode")
        latency = self._parameter_index("IRReverb", "latency")
        self.assertEqual(float(fm_50[emphasis]), 0.0)
        self.assertEqual(float(fm_75[emphasis]), 1.0)
        self.assertEqual(float(ir[channel_mode]), 1.0)
        self.assertEqual(float(ir[latency]), 1.0)

    def test_matrix_routes_pack_into_the_structured_parameter_contract(self) -> None:
        packed = pack_parameter_bytes(effetune.Matrix(matrix_routes="00p1223"))
        np.testing.assert_array_equal(
            packed,
            np.array([1, 0, 3, 0, 0, 0, 0, 1, 2, 1, 2, 3, 0], dtype=np.uint8),
        )
        fixture = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "common"
                / "matrix-routes-v1.fixture.json"
            ).read_text(encoding="utf-8")
        )["routeStrings"]
        definition = next(
            entry
            for entry in EFFECT_METADATA["effects"]
            if entry["type"] == "Matrix"
        )["parameters"][0]
        self.assertEqual(definition["name"], "matrixRoutes")
        self.assertEqual(definition["pattern"], fixture["pattern"])
        for routes in fixture["valid"]:
            with self.subTest(valid=routes):
                self.assertEqual(
                    effetune.Matrix(matrix_routes=routes).parameters["matrixRoutes"],
                    routes,
                )
        for routes in fixture["invalid"]:
            with self.subTest(invalid=routes):
                with self.assertRaises(effetune.ValidationError) as rejected:
                    effetune.Matrix(matrix_routes=routes)
                self.assertEqual(
                    str(rejected.exception),
                    "Matrix.matrixRoutes has an invalid format; expected a string "
                    "matching ^(?:p?[0-9a-f][0-9a-f])*$ (for example '0011')",
                )
        np.testing.assert_array_equal(
            pack_parameter_bytes(effetune.Matrix(matrix_routes="abpff")),
            np.array([1, 0, 2, 0, 10, 11, 0, 15, 15, 1], dtype=np.uint8),
        )
        dense_routes = "".join(f"{source:x}{destination:x}" for source in range(16) for destination in range(16))
        dense_packed = pack_parameter_bytes(effetune.Matrix(matrix_routes=dense_routes))
        np.testing.assert_array_equal(dense_packed[:4], np.array([1, 0, 0, 1], dtype=np.uint8))
        self.assertEqual(len(dense_packed), 4 + 256 * 3)
        out_of_range = pack_parameter_bytes(effetune.Matrix(matrix_routes="88"))
        np.testing.assert_array_equal(
            out_of_range,
            np.array([1, 0, 1, 0, 8, 8, 0], dtype=np.uint8),
        )
        source = np.ones((2, 8), dtype=np.float32)
        output = effetune.Matrix(matrix_routes="88").process(
            source, sample_rate=48_000
        )
        np.testing.assert_array_equal(output, np.zeros_like(source))
        chain = effetune.Chain(
            [effetune.Matrix(id="matrix", matrix_routes="88")]
        )
        with chain.stream(48_000, channels=2, block_size=8) as stream:
            with self.assertRaises(effetune.ValidationError):
                stream.process(
                    source,
                    events=[
                        {
                            "frame": 0,
                            "effectId": "matrix",
                            "parameters": {"matrixRoutes": "0011p"},
                        }
                    ],
                )
            np.testing.assert_array_equal(
                stream.process(source), np.zeros_like(source)
            )
        self.assertIsNone(pack_parameter_bytes(effetune.Volume()))
        with self.assertRaises(effetune.ValidationError):
            pack_parameter_bytes(effetune.Matrix(matrix_routes="00" * 1025))

    def test_static_link_dependency_licenses_are_packaged(self) -> None:
        package = Path(effetune.__file__).resolve().parent
        pffft = package / "licenses" / "PFFFT-LICENSE.txt"
        nanobind = package / "licenses" / "NANOBIND-LICENSE.txt"
        self.assertIn("University Corporation for Atmospheric", pffft.read_text("utf-8"))
        self.assertIn("Wenzel Jakob", nanobind.read_text("utf-8"))


if __name__ == "__main__":
    unittest.main()
