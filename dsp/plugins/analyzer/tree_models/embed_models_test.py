"""Integrity checks for the build-time model reader."""

import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from compact_model import compact_model
from embed_models import embed_model, read_model, unpack_array


class ModelEmbeddingTest(unittest.TestCase):
    def test_production_models(self):
        for folder, names in (
                ("note_spectrogram", ("learned_model", "fine_model", "octave_model")),
                ("rhythm_analyzer", ("g2_level", "g2_hazard", "rhythm_d_low", "rhythm_d_mid",
                                     "rhythm_d_high"))):
            for name in names:
                with self.subTest(model=name):
                    read_model(Path(__file__).parent.parent / folder / (name + ".json"))

    def test_invalid_data_is_rejected_before_outputs_are_created(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            path = root / "test_model.json"
            manifest = {
                "formatVersion": 1, "thresholdType": "float", "leafType": "float",
                "outputCount": 1,
                "constants": {"FeatureCount": 2, "TreeCount": 1, "Depth": 1,
                              "Scale": 1.0, "Bias": 0.0},
            }
            valid = struct.pack("<B3xfff", 1, 0.5, -1.0, 1.0)
            for data, hash_data, expected in (
                (valid[:-1], valid[:-1], "byte count"),
                (valid, valid + b"x", "SHA-256"),
                (bytes([2]) + valid[1:], bytes([2]) + valid[1:], "forbidden feature"),
                (valid[:4] + struct.pack("<f", float("nan")) + valid[8:],
                 valid[:4] + struct.pack("<f", float("nan")) + valid[8:], "non-finite"),
            ):
                with self.subTest(error=expected):
                    manifest["sha256"] = hashlib.sha256(hash_data).hexdigest()
                    path.write_text(json.dumps(manifest), encoding="utf-8")
                    path.with_suffix(".bin").write_bytes(data)
                    with self.assertRaisesRegex(ValueError, expected):
                        embed_model(path, root / "generated", "coff-x64")
                    self.assertFalse((root / "generated").exists())

    def test_unsupported_layout_combinations_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / "test_model.json"
            for layout, threshold_type, leaf_type, expected in (
                ("heap", "index8", "int16", "layout"),
                ("oblivious", "float", "int8", "threshold type"),
                ("oblivious", "index8", "float", "leaf type"),
                (None, "index8", "int8", "leaf type"),
            ):
                with self.subTest(error=expected, layout=layout):
                    manifest = {"formatVersion": 1, "thresholdType": threshold_type,
                                "leafType": leaf_type, "outputCount": 1, "borderCount": 1,
                                "constants": {"FeatureCount": 1, "TreeCount": 1, "Depth": 1,
                                              "Scale": 1.0, "Bias": 0.0}}
                    if layout:
                        manifest["layout"] = layout
                    path.write_text(json.dumps(manifest), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, expected):
                        read_model(path)

    @staticmethod
    def write_float_heap(path, features, thresholds, leaves):
        data = struct.pack("<3B1x3f4f", *features, *thresholds, *leaves)
        path.write_text(json.dumps({
            "formatVersion": 1, "thresholdType": "float", "leafType": "float",
            "outputCount": 1, "sha256": hashlib.sha256(data).hexdigest(),
            "constants": {"FeatureCount": 2, "TreeCount": 1, "Depth": 2,
                          "Scale": 1.0, "Bias": 0.0},
        }), encoding="utf-8")
        path.with_suffix(".bin").write_bytes(data)

    def assert_compaction(self, path, layout, leaf_type, splits, leaves):
        _, manifest, arrays, data = read_model(path)
        values = {array[0]: unpack_array(data, array) for array in arrays}
        self.assertEqual((manifest.get("layout"), manifest["thresholdType"], manifest["leafType"]),
                         (layout, "index8", leaf_type))
        self.assertEqual(tuple(zip(values["features"],
                                   (values["borders"][values["border_offsets"][feature] + index]
                                    for feature, index in zip(values["features"],
                                                              values["thresholds"])))),
                         splits)
        scale = values["leaf_scales"][0]
        for quantized, leaf in zip(values["leaves"], leaves):
            self.assertLessEqual(abs(quantized * scale - leaf), 0.5 * scale)

    def test_compaction_keeps_thresholds_and_bounds_leaf_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / "test_model.json"
            features, thresholds = (1, 0, 1), (0.25, -2.0, 0.5)
            leaves = (-1.0, 0.75, 0.001, 3.0)
            self.write_float_heap(path, features, thresholds, leaves)
            compact_model(path, leaves="int16")
            self.assert_compaction(path, None, "int16", tuple(zip(features, thresholds)), leaves)
            with self.assertRaisesRegex(ValueError, "not symmetric"):
                compact_model(path, oblivious=True)

    def test_unloadable_compaction_leaves_source_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / "test_model.json"
            self.write_float_heap(path, (1, 0, 0), (0.25, -2.0, -2.0), (-1.0, 0.75, 0.001, 3.0))
            source = (path.read_bytes(), path.with_suffix(".bin").read_bytes())
            for options, expected in (({"oblivious": True}, "int8 or int16 leaves"),
                                      ({"leaves": "int8"}, "oblivious layout")):
                with self.subTest(options=options):
                    with self.assertRaisesRegex(ValueError, expected):
                        compact_model(path, **options)
                    self.assertEqual((path.read_bytes(), path.with_suffix(".bin").read_bytes()),
                                     source)

    def test_oblivious_compaction_maps_heap_levels_to_leaf_bits(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / "test_model.json"
            leaves = (-1.0, 0.75, 0.001, 3.0)
            self.write_float_heap(path, (1, 0, 0), (0.25, -2.0, -2.0), leaves)
            compact_model(path, oblivious=True, leaves="int8")
            # The deepest heap level is oblivious split 0, the low bit of the leaf index.
            self.assert_compaction(path, "oblivious", "int8", ((0, -2.0), (1, 0.25)), leaves)


if __name__ == "__main__":
    unittest.main()
