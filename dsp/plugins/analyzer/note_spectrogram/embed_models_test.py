"""Integrity checks for the build-time model reader."""

import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from embed_models import embed_model, read_model


class ModelEmbeddingTest(unittest.TestCase):
    def test_production_models(self):
        for name in ("learned_model", "fine_model", "octave_model"):
            with self.subTest(model=name):
                read_model(Path(__file__).with_name(name + ".json"))

    def test_invalid_data_is_rejected_before_outputs_are_created(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            path = root / "test_model.json"
            manifest = {
                "formatVersion": 1, "leafType": "float", "outputCount": 1,
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


if __name__ == "__main__":
    unittest.main()
