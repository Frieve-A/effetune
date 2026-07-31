from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np


_RUNNER_PATH = (
    Path(__file__).resolve().parents[2] / "acceptance" / "python_golden_runner.py"
)
_SPEC = importlib.util.spec_from_file_location("effetune_python_golden_runner", _RUNNER_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_RUNNER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_RUNNER)
_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class GoldenComparatorTests(unittest.TestCase):
    def test_frozen_inventory_uses_all_generated_indexes(self) -> None:
        cases = _RUNNER.discover_cases(_REPOSITORY_ROOT)
        self.assertEqual(len(cases), 690)
        self.assertEqual(len({case["publicType"] for case in cases}), 76)

    def test_public_pattern_metadata_identifies_only_binding_invalid_case(
        self,
    ) -> None:
        cases = _RUNNER.discover_cases(_REPOSITORY_ROOT)
        invalid = [
            (
                f"{case['publicType']}/{case['metadata']['id']}",
                _RUNNER.expected_validation_rejection(case),
            )
            for case in cases
            if _RUNNER.expected_validation_rejection(case) is not None
        ]
        self.assertEqual(
            invalid,
            [
                (
                    "Matrix/malformed-routes-are-dropped",
                    {
                        "parameter": "matrixRoutes",
                        "reason": "pattern-mismatch",
                    },
                )
            ],
        )

    def test_discovery_reads_only_generated_frozen_index_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            generated = root / "dsp" / "bindings" / "generated"
            included = root / "dsp" / "plugins" / "included" / "golden"
            excluded = root / "dsp" / "plugins" / "excluded" / "golden"
            generated.mkdir(parents=True)
            included.mkdir(parents=True)
            excluded.mkdir(parents=True)
            (generated / "effects-v1.private.json").write_text(
                json.dumps(
                    {
                        "effects": {
                            "Volume": {"internalType": "VolumePlugin"}
                        },
                        "frozenGoldenIndexes": {
                            "dsp/plugins/included/params.json":
                                "dsp/plugins/included/golden/index.json"
                        },
                    }
                ),
                encoding="utf-8",
            )
            (generated / "effects-v1.json").write_text(
                json.dumps({"effects": [{"type": "Volume"}]}),
                encoding="utf-8",
            )
            (included / "index.json").write_text(
                json.dumps(
                    {"type": "VolumePlugin", "cases": ["case.json"]}
                ),
                encoding="utf-8",
            )
            (included / "case.json").write_text(
                json.dumps({"binary": "case.f32"}),
                encoding="utf-8",
            )
            (included / "case.f32").write_bytes(b"\0\0\0\0")
            (excluded / "index.json").write_text(
                "{ malformed duplicate",
                encoding="utf-8",
            )

            cases = _RUNNER.discover_cases(root)
            self.assertEqual(len(cases), 1)
            self.assertEqual(cases[0]["publicType"], "Volume")
            self.assertEqual(cases[0]["metadataPath"], included / "case.json")

            for invalid in (
                ["../case.json"],
                ["/case.json"],
                [r"C:\case.json"],
                ["nested/case.json"],
                [r"nested\case.json"],
                ["case.json", "case.json"],
            ):
                with self.subTest(metadata=invalid):
                    (included / "index.json").write_text(
                        json.dumps({"type": "VolumePlugin", "cases": invalid}),
                        encoding="utf-8",
                    )
                    with self.assertRaises(RuntimeError):
                        _RUNNER.discover_cases(root)

            (included / "index.json").write_text(
                json.dumps({"type": "VolumePlugin", "cases": ["case.json"]}),
                encoding="utf-8",
            )
            for invalid in (
                "../case.f32",
                "/case.f32",
                r"C:\case.f32",
                "nested/case.f32",
                r"nested\case.f32",
            ):
                with self.subTest(binary=invalid):
                    (included / "case.json").write_text(
                        json.dumps({"binary": invalid}),
                        encoding="utf-8",
                    )
                    with self.assertRaises(RuntimeError):
                        _RUNNER.discover_cases(root)

            (included / "case.json").write_text(
                json.dumps({"binary": "case.f32"}), encoding="utf-8"
            )
            (included / "case-2.json").write_text(
                json.dumps({"binary": "case.f32"}), encoding="utf-8"
            )
            (included / "index.json").write_text(
                json.dumps(
                    {
                        "type": "VolumePlugin",
                        "cases": ["case.json", "case-2.json"],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(RuntimeError):
                _RUNNER.discover_cases(root)

    def test_nonfinite_reference_and_actual_samples_fail(self) -> None:
        finite = np.array([0.0, 1.0], dtype=np.float32)
        for value in (np.nan, np.inf, -np.inf):
            with self.subTest(reference=value):
                reference = finite.copy()
                reference[1] = value
                result = _RUNNER.compare(reference, finite, {"abs": 1})
                self.assertFalse(result["pass"])
                self.assertEqual(result["reason"], "non-finite-reference")
                self.assertEqual(result["firstOffendingIndex"], 1)
            with self.subTest(actual=value):
                actual = finite.copy()
                actual[1] = value
                result = _RUNNER.compare(finite, actual, {"abs": 1})
                self.assertFalse(result["pass"])
                self.assertEqual(result["reason"], "non-finite-actual")
                self.assertEqual(result["firstOffendingIndex"], 1)

    def test_spectral_policy_compares_channel_magnitudes_in_decibels(self) -> None:
        frames = 1024
        phase = np.arange(frames, dtype=np.float64)
        reference = np.sin(2 * np.pi * 32 * phase / frames).astype(np.float32)
        reference = reference.reshape(1, -1)
        exact = _RUNNER.compare(
            reference.reshape(-1),
            reference,
            {"policy": "spectral", "db": 0.001, "fftSize": frames},
        )
        self.assertTrue(exact["pass"])
        self.assertEqual(exact["policy"], "spectral")
        changed = _RUNNER.compare(
            reference.reshape(-1),
            reference * np.float32(1.25),
            {"policy": "spectral", "db": 0.5, "fftSize": frames},
        )
        self.assertFalse(changed["pass"])
        self.assertGreater(changed["maxDbError"], 1)


if __name__ == "__main__":
    unittest.main()
