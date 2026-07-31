from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import soundfile as sf

import effetune
from effetune.cli import main


class CliTests(unittest.TestCase):
    def test_render_validate_and_inspect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.wav"
            output = root / "output.wav"
            preset = root / "preset.json"
            audio = np.linspace(-0.5, 0.5, 256, dtype=np.float32)
            sf.write(source, audio, 48_000, subtype="FLOAT")
            preset.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "chain": [
                            {
                                "type": "Volume",
                                "parameters": {"volume": -6},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(main(["chain", "validate", str(preset)]), 0)
            self.assertEqual(
                main(["render", str(source), str(output), "--preset", str(preset)]),
                0,
            )
            rendered, sample_rate = sf.read(output, dtype="float32")
            self.assertEqual(sample_rate, 48_000)
            self.assertEqual(rendered.shape, audio.shape)
            self.assertFalse(np.array_equal(rendered, audio))
            self.assertEqual(sf.info(output).subtype, "PCM_16")

    def test_render_supports_explicit_output_subtypes_without_tracebacks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.wav"
            output = root / "output.wav"
            invalid_output = root / "invalid.wav"
            preset = root / "preset.json"
            audio = np.linspace(-0.5, 0.5, 257, dtype=np.float32)
            sf.write(source, audio, 48_000, subtype="FLOAT")
            preset.write_text(
                json.dumps({"version": 1, "chain": []}), encoding="utf-8"
            )

            self.assertEqual(
                main(
                    [
                        "render",
                        str(source),
                        str(output),
                        "--preset",
                        str(preset),
                        "--subtype",
                        "FLOAT",
                    ]
                ),
                0,
            )
            info = sf.info(output)
            self.assertEqual(info.subtype, "FLOAT")
            self.assertEqual(info.samplerate, 48_000)
            self.assertEqual(info.channels, 1)
            self.assertEqual(info.frames, audio.size)
            rendered, _ = sf.read(output, dtype="float32")
            np.testing.assert_array_equal(rendered, audio)

            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                result = main(
                    [
                        "render",
                        str(source),
                        str(invalid_output),
                        "--preset",
                        str(preset),
                        "--subtype",
                        "NOT_A_SUBTYPE",
                    ]
                )
            self.assertEqual(result, 2)
            self.assertIn("could not encode output audio", errors.getvalue())
            self.assertNotIn("Traceback", errors.getvalue())

    def test_preset_inspect_materializes_canonical_defaults(self) -> None:
        inspected = io.StringIO()
        with contextlib.redirect_stdout(inspected):
            self.assertEqual(
                main(
                    [
                        "preset",
                        "inspect",
                        '{"version":1,"chain":[{"type":"Volume",'
                        '"parameters":{"volume":-6}}]}',
                    ]
                ),
                0,
            )
        self.assertEqual(
            json.loads(inspected.getvalue()),
            {
                "version": 1,
                "chain": [
                    {
                        "type": "Volume",
                        "enabled": True,
                        "channel": "all",
                        "parameters": {"volume": -6},
                    }
                ],
            },
        )

    def test_bundle_pack_decodes_ir_audio_and_writes_a_loadable_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            document = root / "chain.json"
            impulse = root / "room.wav"
            destination = root / "packed"
            document.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "chain": [
                            {
                                "type": "IRReverb",
                                "parameters": {},
                                "assets": {"impulseResponse": "room"},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            samples = np.array(
                [[1.0, 0.5], [-0.25, 0.125]],
                dtype=np.float32,
            )
            sf.write(impulse, samples, 48_000, subtype="FLOAT")

            self.assertEqual(
                main(
                    [
                        "bundle",
                        "pack",
                        str(document),
                        str(destination),
                        "--asset",
                        f"room={impulse}",
                    ]
                ),
                0,
            )
            asset = effetune.Bundle.load(destination).resolver("room")
            self.assertEqual(asset.sample_rate, 48_000)
            self.assertEqual(asset.topology, "automatic")
            np.testing.assert_array_equal(asset.samples, samples.T)

    def test_render_accepts_bundle_directories_and_manifests_for_all_ir_effects(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            effect_types = (
                "FIRCrossover",
                "FiveBandFIRPEQ",
                "GroupDelayEQ",
                "IRReverb",
                "RoomEQ",
            )
            for index, effect_type in enumerate(effect_types):
                with self.subTest(effect_type=effect_type):
                    channels = 4 if effect_type == "FIRCrossover" else 2
                    source = np.zeros((channels, 4096), dtype=np.float32)
                    source[0, 0] = 0.5
                    source[1, 0] = -0.25
                    if effect_type == "FIRCrossover":
                        asset = effetune.AssetData(
                            np.array(
                                [[0.75, 0.2], [0.35, -0.1]], dtype=np.float32
                            ),
                            48_000,
                            topology="matrix",
                            paths=(
                                effetune.ConvolutionPath(0, 0, 0),
                                effetune.ConvolutionPath(1, 1, 0),
                                effetune.ConvolutionPath(0, 2, 1),
                                effetune.ConvolutionPath(1, 3, 1),
                            ),
                            input_count=2,
                        )
                        parameters = {
                            "latencyMode": "0",
                            "filterDelaySamples": 0,
                            "bandCount": 2,
                        }
                    else:
                        asset = effetune.AssetData(
                            np.array([[0.75, 0.2]], dtype=np.float32),
                            48_000,
                            topology="mono",
                        )
                        parameters = (
                            {
                                "channelMode": "mono",
                                "latency": 0,
                                "convolutionRate": "full",
                                "wetLevel": 0,
                                "dryLevel": -96,
                                "preDelay": 0,
                            }
                            if effect_type == "IRReverb"
                            else {"latencyMode": "0", "filterDelaySamples": 0}
                        )
                    document = {
                        "version": 1,
                        "chain": [
                            {
                                "type": effect_type,
                                "parameters": parameters,
                                "assets": {"impulseResponse": "room"},
                            }
                        ],
                    }
                    bundle = root / f"bundle-{index}"
                    effetune.Bundle.pack(bundle, document, {"room": asset})
                    input_path = root / f"input-{index}.wav"
                    output_path = root / f"output-{index}.wav"
                    sf.write(input_path, source.T, 48_000, subtype="FLOAT")
                    preset = bundle if index % 2 == 0 else bundle / "bundle.json"

                    self.assertEqual(
                        main(
                            [
                                "render",
                                str(input_path),
                                str(output_path),
                                "--preset",
                                str(preset),
                            ]
                        ),
                        0,
                    )
                    rendered, sample_rate = sf.read(
                        output_path, dtype="float32", always_2d=True
                    )
                    self.assertEqual(sample_rate, 48_000)
                    self.assertEqual(rendered.shape, source.T.shape)
                    self.assertTrue(np.isfinite(rendered).all())
                    self.assertGreater(float(np.max(np.abs(rendered))), 1e-7)

    def test_bundle_pack_rejects_oversize_ir_from_metadata_before_decode(self) -> None:
        audio_file = mock.MagicMock()
        audio_file.__enter__.return_value = audio_file
        audio_file.channels = 8
        audio_file.frames = 1_048_576
        audio_file.samplerate = 48_000
        audio_file.read.side_effect = AssertionError("oversize audio must not be decoded")
        document = json.dumps(
            {
                "version": 1,
                "chain": [
                    {
                        "type": "IRReverb",
                        "parameters": {},
                        "assets": {"impulseResponse": "room"},
                    }
                ],
            }
        )

        with tempfile.TemporaryDirectory() as temporary:
            errors = io.StringIO()
            with (
                mock.patch("effetune.cli.sf.SoundFile", return_value=audio_file),
                mock.patch("effetune.cli.sf.read") as legacy_read,
                contextlib.redirect_stderr(errors),
            ):
                result = main(
                    [
                        "bundle",
                        "pack",
                        document,
                        str(Path(temporary) / "packed"),
                        "--asset",
                        "room=oversize.wav",
                    ]
                )

        self.assertEqual(result, 2)
        self.assertIn("encoded ETA1 payload exceeds", errors.getvalue())
        audio_file.read.assert_not_called()
        legacy_read.assert_not_called()

    def test_bundle_pack_reports_invalid_duplicate_and_unmatched_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            impulse = root / "room.wav"
            sf.write(
                impulse,
                np.array([1.0], dtype=np.float32),
                48_000,
                subtype="FLOAT",
            )
            document = json.dumps(
                {
                    "version": 1,
                    "chain": [
                        {
                            "type": "IRReverb",
                            "parameters": {},
                            "assets": {"impulseResponse": "room"},
                        }
                    ],
                }
            )
            cases = (
                (["--asset", "invalid"], "REF=FILE"),
                (
                    [
                        "--asset",
                        f"room={impulse}",
                        "--asset",
                        f"room={impulse}",
                    ],
                    "duplicate bundle asset id",
                ),
                ([], "missing assets"),
                (
                    [
                        "--asset",
                        f"room={impulse}",
                        "--asset",
                        f"unused={impulse}",
                    ],
                    "unreferenced assets",
                ),
            )
            for index, (asset_arguments, message) in enumerate(cases):
                with self.subTest(message=message):
                    errors = io.StringIO()
                    with contextlib.redirect_stderr(errors):
                        result = main(
                            [
                                "bundle",
                                "pack",
                                document,
                                str(root / f"packed-{index}"),
                                *asset_arguments,
                            ]
                        )
                    self.assertEqual(result, 2)
                    self.assertIn(message, errors.getvalue())
                    self.assertNotIn("Traceback", errors.getvalue())

    def test_render_reports_unsupported_output_format_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.wav"
            output = root / "output.unsupported"
            preset = root / "preset.json"
            sf.write(source, np.zeros(32, dtype=np.float32), 48_000)
            preset.write_text(
                json.dumps({"version": 1, "chain": []}), encoding="utf-8"
            )
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                result = main(
                    ["render", str(source), str(output), "--preset", str(preset)]
                )
            self.assertEqual(result, 2)
            self.assertIn("could not encode output audio", errors.getvalue())
            self.assertNotIn("Traceback", errors.getvalue())

    def test_preset_inspect_reports_invalid_documents_with_exit_two(self) -> None:
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            result = main(
                [
                    "preset",
                    "inspect",
                    '{"version":1,"chain":[{"type":"Volume","parameters":{"unknown":1}}]}',
                ]
            )
        self.assertEqual(result, 2)
        self.assertIn("unknown fields", errors.getvalue())
        self.assertNotIn("Traceback", errors.getvalue())

    def test_non_string_channels_report_validation_errors_without_tracebacks(self) -> None:
        for channel in (None, 1, [], {}):
            with self.subTest(channel=channel):
                document = {
                    "version": 1,
                    "chain": [{"type": "Volume", "channel": channel, "parameters": {}}],
                }
                errors = io.StringIO()
                with contextlib.redirect_stderr(errors):
                    result = main(["chain", "validate", json.dumps(document)])
                self.assertEqual(result, 2)
                self.assertIn("effect channel must be one of", errors.getvalue())
                self.assertNotIn("Traceback", errors.getvalue())


class RenderFidelityWarningTests(unittest.TestCase):
    def _render(
        self,
        root: Path,
        *,
        input_subtype: str,
        amplitude: float = 0.5,
        volume: float = -6.0,
        output_subtype: str | None = None,
    ) -> tuple[int, str, str]:
        source = root / f"input-{input_subtype}-{amplitude}-{volume}.wav"
        output = root / f"output-{input_subtype}-{amplitude}-{volume}.wav"
        preset = root / "preset.json"
        audio = np.linspace(-amplitude, amplitude, 256, dtype=np.float32)
        sf.write(source, audio, 48_000, subtype=input_subtype)
        preset.write_text(
            json.dumps(
                {
                    "version": 1,
                    "chain": [{"type": "Volume", "parameters": {"volume": volume}}],
                }
            ),
            encoding="utf-8",
        )
        arguments = ["render", str(source), str(output), "--preset", str(preset)]
        if output_subtype is not None:
            arguments += ["--subtype", output_subtype]
        out = io.StringIO()
        errors = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(errors):
            result = main(arguments)
        return result, out.getvalue(), errors.getvalue()

    def test_precision_reducing_inputs_warn_on_stderr_only(self) -> None:
        for input_subtype in ("PCM_24", "PCM_32", "FLOAT", "DOUBLE"):
            with self.subTest(input_subtype=input_subtype):
                with tempfile.TemporaryDirectory() as temporary:
                    result, out, errors = self._render(
                        Path(temporary), input_subtype=input_subtype
                    )
                self.assertEqual(result, 0)
                self.assertEqual(out, "")
                self.assertIn(
                    f"{input_subtype} input written as PCM_16 output; "
                    "precision is reduced. Pass --subtype to keep more precision.",
                    errors,
                )
                self.assertEqual(errors.count("warning"), 1)
                self.assertNotIn("Traceback", errors)

    def test_explicitly_requested_narrower_subtypes_do_not_warn_about_precision(
        self,
    ) -> None:
        # Passing --subtype makes the precision loss the caller's own choice, so
        # advising them to "pass --subtype" would contradict what they just did.
        cases = (("PCM_24", "PCM_16"), ("FLOAT", "PCM_24"), ("DOUBLE", "PCM_16"))
        for input_subtype, output_subtype in cases:
            with self.subTest(input_subtype=input_subtype, output_subtype=output_subtype):
                with tempfile.TemporaryDirectory() as temporary:
                    result, out, errors = self._render(
                        Path(temporary),
                        input_subtype=input_subtype,
                        output_subtype=output_subtype,
                    )
                self.assertEqual(result, 0)
                self.assertEqual(out, "")
                self.assertEqual(errors, "")

    def test_explicitly_requested_narrower_subtypes_still_report_clipping(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, out, errors = self._render(
                Path(temporary),
                input_subtype="PCM_24",
                amplitude=0.9,
                volume=6.0,
                output_subtype="PCM_16",
            )
        self.assertEqual(result, 0)
        self.assertEqual(out, "")
        self.assertNotIn("precision is reduced", errors)
        self.assertIn("samples were clipped by the PCM_16 output.", errors)
        self.assertEqual(errors.count("warning"), 1)
        self.assertEqual(len(errors.strip().splitlines()), 1)

    def test_matching_or_wider_output_subtypes_stay_silent(self) -> None:
        cases = (("PCM_16", None), ("PCM_24", "PCM_24"), ("FLOAT", "FLOAT"))
        for input_subtype, output_subtype in cases:
            with self.subTest(input_subtype=input_subtype):
                with tempfile.TemporaryDirectory() as temporary:
                    result, out, errors = self._render(
                        Path(temporary),
                        input_subtype=input_subtype,
                        output_subtype=output_subtype,
                    )
                self.assertEqual(result, 0)
                self.assertEqual(out, "")
                self.assertEqual(errors, "")

    def test_output_above_full_scale_reports_clipping_on_stderr_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, out, errors = self._render(
                Path(temporary),
                input_subtype="PCM_16",
                amplitude=0.9,
                volume=6.0,
            )
        self.assertEqual(result, 0)
        self.assertEqual(out, "")
        self.assertIn("rendered peak 1.79", errors)
        self.assertIn("dBFS) exceeds full scale;", errors)
        self.assertIn("samples were clipped by the PCM_16 output.", errors)
        self.assertEqual(errors.count("warning"), 1)
        self.assertNotIn("Traceback", errors)

    def test_output_above_full_scale_is_silent_for_float_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, out, errors = self._render(
                Path(temporary),
                input_subtype="PCM_16",
                amplitude=0.9,
                volume=6.0,
                output_subtype="FLOAT",
            )
        self.assertEqual(result, 0)
        self.assertEqual(out, "")
        self.assertEqual(errors, "")

    def test_in_range_output_reports_no_clipping(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, out, errors = self._render(
                Path(temporary), input_subtype="PCM_16", amplitude=0.9, volume=-6.0
            )
        self.assertEqual(result, 0)
        self.assertEqual(out, "")
        self.assertEqual(errors, "")

    def test_precision_and_clipping_warnings_are_reported_together(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, out, errors = self._render(
                Path(temporary), input_subtype="PCM_24", amplitude=0.9, volume=6.0
            )
        self.assertEqual(result, 0)
        self.assertEqual(out, "")
        self.assertIn("PCM_24 input written as PCM_16 output", errors)
        self.assertIn("samples were clipped by the PCM_16 output.", errors)
        self.assertEqual(errors.count("warning"), 2)
        self.assertEqual(len(errors.strip().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
