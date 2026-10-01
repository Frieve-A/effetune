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
        for name in ("learned_model", "fine_model", "octave_model"):
            with self.subTest(model=name):
                read_model(Path(__file__).parent.parent / "note_spectrogram" / (name + ".json"))

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

    def test_compaction_keeps_thresholds_and_bounds_leaf_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / "test_model.json"
            features, thresholds = (1, 0, 1), (0.25, -2.0, 0.5)
            leaves = (-1.0, 0.75, 0.001, 3.0)
            data = struct.pack("<3B1x3f4f", *features, *thresholds, *leaves)
            path.write_text(json.dumps({
                "formatVersion": 1, "thresholdType": "float", "leafType": "float",
                "outputCount": 1, "sha256": hashlib.sha256(data).hexdigest(),
                "constants": {"FeatureCount": 2, "TreeCount": 1, "Depth": 2,
                              "Scale": 1.0, "Bias": 0.0},
            }), encoding="utf-8")
            path.with_suffix(".bin").write_bytes(data)
            compact_model(path, int16_leaves=True)
            _, manifest, arrays, data = read_model(path)
            values = {array[0]: unpack_array(data, array) for array in arrays}
            self.assertEqual((manifest["thresholdType"], manifest["leafType"]),
                             ("index8", "int16"))
            self.assertEqual(tuple(values["borders"][values["border_offsets"][feature] + index]
                                   for feature, index in zip(values["features"],
                                                             values["thresholds"])),
                             thresholds)
            scale = values["leaf_scales"][0]
            for quantized, leaf in zip(values["leaves"], leaves):
                self.assertLessEqual(abs(quantized * scale - leaf), 0.5 * scale)


if __name__ == "__main__":
    unittest.main()
