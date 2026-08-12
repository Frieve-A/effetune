from __future__ import annotations

import json
import re
import tempfile
import unittest
import warnings
from pathlib import Path

import numpy as np

import effetune
from effetune._generated_effects import EFFECT_CLASSES, EFFECT_METADATA
from effetune.chain import _effect_channels, _native_effect_channel


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


def _snake_case(name: str) -> str:
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()


def _nondefault_value(definition: dict[str, object]) -> object:
    default = definition["default"]
    count = int(definition.get("count", 1))
    if count > 1:
        values = list(default)
        scalar = dict(definition)
        scalar["count"] = 1
        scalar["default"] = values[0]
        values[0] = _nondefault_value(scalar)
        return values
    allowed = definition.get("values")
    if isinstance(allowed, list):
        return next(value for value in allowed if value != default)
    if definition["type"] == "string":
        return f"{default}p01"
    if definition["type"] == "boolean":
        return not bool(default)
    minimum = float(definition["minimum"])
    maximum = float(definition["maximum"])
    value = float(default)
    candidate = value + (maximum - minimum) * 0.1
    if candidate > maximum:
        candidate = value - (maximum - minimum) * 0.1
    if definition["type"] == "integer":
        candidate = int(round(candidate))
        if candidate == default:
            candidate = int(minimum if default != minimum else maximum)
    return candidate


class NativeChainTests(unittest.TestCase):
    def test_channel_routing_matches_the_shared_cross_language_contract(self) -> None:
        fixture = json.loads(
            (
                REPOSITORY_ROOT
                / "dsp"
                / "bindings"
                / "common"
                / "channel-routing-v1.fixture.json"
            ).read_text(encoding="utf-8")
        )
        for case in fixture["valid"]:
            self.assertEqual(
                _effect_channels(case["channel"], case["channels"]),
                case["processingChannels"],
            )
            self.assertEqual(
                _native_effect_channel(case["channel"], case["channels"]),
                case["nativeChannel"],
            )
        for effect_type in (effetune.Volume, effetune.IRReverb):
            for case in fixture["invalid"]:
                options = {"channel": case["channel"]}
                if effect_type is effetune.IRReverb:
                    options["assets"] = {"impulseResponse": "unused"}
                with self.subTest(effect=effect_type.__name__, case=case["name"]):
                    with self.assertRaises(effetune.ValidationError):
                        effetune.Chain([effect_type(**options)]).stream(
                            48_000, channels=case["channels"]
                        )

    def test_empty_chain_is_copying_identity(self) -> None:
        source = np.arange(24, dtype=np.float32).reshape(2, 12)
        output = effetune.Chain()(source, 48_000)
        np.testing.assert_array_equal(output, source)
        self.assertIsNot(output, source)

    def test_serial_chain_matches_two_fresh_single_effect_calls(self) -> None:
        source = np.linspace(-0.5, 0.5, 257, dtype=np.float32).reshape(1, -1)
        first = effetune.Volume(volume=-6)
        second = effetune.HardClipping(threshold=-18)
        actual = effetune.Chain([first, second]).process(
            source, sample_rate=48_000, block_size=64
        )
        expected = second.process(
            first.process(source, sample_rate=48_000, block_size=64),
            sample_rate=48_000,
            block_size=64,
        )
        np.testing.assert_array_equal(actual, expected)

    def test_disabled_effect_copies_through_and_left_routing_isolated(self) -> None:
        source = np.full((2, 64), 0.5, dtype=np.float32)
        bypassed = effetune.Chain([effetune.Volume(volume=-12, enabled=False)])(
            source, 48_000
        )
        np.testing.assert_array_equal(bypassed, source)
        routed = effetune.Chain([effetune.Volume(volume=-6, channel="left")])(
            source, 48_000
        )
        self.assertFalse(np.array_equal(routed[0], source[0]))
        np.testing.assert_array_equal(routed[1], source[1])

    def test_mono_stereo_route_processes_the_available_channel(self) -> None:
        source = np.ones((1, 17), dtype=np.float32)
        output = effetune.Volume(volume=-6, channel="stereo").process(
            source,
            sample_rate=48_000,
            block_size=7,
        )
        self.assertFalse(np.array_equal(output, source))
        np.testing.assert_allclose(
            output,
            np.full_like(source, 10.0 ** (-6.0 / 20.0)),
            rtol=0,
            atol=1e-7,
        )

    def test_left_routed_mono_ir_prewarms_with_its_processing_channel_count(self) -> None:
        source = np.zeros((2, 128), dtype=np.float32)
        source[0, 0] = 1.0
        ir = effetune.AssetData(
            np.array([[1.0]], dtype=np.float32),
            48_000,
            topology="mono",
        )
        output = effetune.IRReverb(
            assets={"impulseResponse": "left-ir"},
            channel="left",
            channel_mode="mono",
            latency=0,
            wet_level=0,
            dry_level=-96,
        ).process(
            source,
            sample_rate=48_000,
            asset_resolver=lambda _: ir,
            block_size=128,
        )
        self.assertTrue(np.any(output[0] != 0.0))
        np.testing.assert_array_equal(output[1], source[1])

    def test_offline_processing_preserves_requested_partitioning(self) -> None:
        source = np.ones((1, 17), dtype=np.float32)
        expected = np.full_like(source, 10.0 ** (-6.0 / 20.0))
        for block_size in (1, 7, 16_384):
            with self.subTest(block_size=block_size):
                actual = effetune.Volume(volume=-6).process(
                    source,
                    sample_rate=48_000,
                    block_size=block_size,
                )
                np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-7)

    def test_offline_calls_are_fresh(self) -> None:
        source = np.zeros((1, 512), dtype=np.float32)
        source[0, 0] = 1.0
        chain = effetune.Chain([effetune.Delay(delay_size=20, feedback=60, mix=100)])
        first = chain(source, 48_000, block_size=128)
        second = chain(source, 48_000, block_size=128)
        np.testing.assert_array_equal(first, second)

    def test_analyzer_telemetry_is_decoded_owned_and_opt_in(self) -> None:
        frames = 16_384
        phase = np.arange(frames, dtype=np.float32)
        source = np.stack(
            (
                np.sin(phase * np.float32(2.0 * np.pi * 997.0 / 48_000.0)),
                np.float32(0.5)
                * np.sin(phase * np.float32(2.0 * np.pi * 1499.0 / 48_000.0)),
            )
        ).astype(np.float32)
        cases = (
            (effetune.LevelMeter(id="meter"), effetune.LevelTelemetryFrame, "level"),
            (
                effetune.Oscilloscope(id="scope", display_time=0.005),
                effetune.OscilloscopeTelemetryFrame,
                "oscilloscope",
            ),
            (
                effetune.SpectrumAnalyzer(id="spectrum", points=10),
                effetune.SpectrumTelemetryFrame,
                "spectrum",
            ),
            (
                effetune.Spectrogram(id="spectrogram", points=10),
                effetune.SpectrogramTelemetryFrame,
                "spectrogram",
            ),
            (
                effetune.StereoMeter(id="stereo", window_time=0.02),
                effetune.StereoTelemetryFrame,
                "stereo",
            ),
        )
        for effect, frame_class, kind in cases:
            with self.subTest(kind=kind):
                received: list[effetune.TelemetryFrame] = []
                callback = received.append
                chain = effetune.Chain([effect])
                with chain.stream(
                    48_000,
                    channels=2,
                    block_size=128,
                    on_telemetry=callback,
                ) as stream:
                    output = stream.process(source)
                    self.assertEqual(stream.dropped_telemetry_frames, 0)
                    self.assertTrue(received)
                    frame = received[-1]
                    self.assertIsInstance(frame, frame_class)
                    self.assertEqual(frame.kind, kind)
                    self.assertEqual(frame.effect_id, effect.id)
                    self.assertEqual(frame.effect_index, 0)
                    self.assertGreaterEqual(frame.sequence, 0)
                    self.assertEqual(frame.dropped, 0)
                    if kind == "level":
                        self.assertEqual(len(frame.channels), 2)
                        self.assertGreater(frame.channels[0].peak, 0.9)
                        self.assertGreater(frame.channels[0].rms, 0.6)
                        self.assertGreater(
                            frame.channels[0].peak, frame.channels[1].peak
                        )
                        self.assertFalse(
                            any(channel.clipped for channel in frame.channels)
                        )
                    elif kind == "oscilloscope":
                        self.assertEqual(frame.sample_rate, 48_000)
                        self.assertEqual(frame.encoding, "samples")
                        self.assertEqual(
                            len(frame.sample_indices),
                            len(frame.values),
                        )
                        self.assertGreater(len(frame.values), 100)
                        self.assertEqual(frame.sample_indices[0], 0)
                        self.assertLess(
                            frame.sample_indices[-1], frame.capture_sample_count
                        )
                        self.assertTrue(np.isfinite(frame.values).all())
                        self.assertGreater(max(frame.values) - min(frame.values), 0.5)
                    elif kind == "spectrum":
                        self.assertEqual(frame.sample_rate, 48_000)
                        self.assertEqual(frame.points, 10)
                        self.assertFalse(frame.bins_truncated)
                        self.assertEqual(len(frame.current_db), 513)
                        self.assertEqual(len(frame.peak_db), 513)
                        self.assertTrue(np.isfinite(frame.current_db).all())
                        self.assertTrue(np.isfinite(frame.peak_db).all())
                        self.assertGreater(max(frame.current_db), -20)
                        self.assertGreater(
                            max(frame.current_db) - min(frame.current_db),
                            20,
                        )
                    elif kind == "spectrogram":
                        self.assertEqual(frame.sample_rate, 48_000)
                        self.assertEqual(frame.points, 10)
                        self.assertGreater(frame.time_seconds, 0)
                        self.assertEqual(len(frame.intensities), 256)
                        self.assertTrue(
                            all(
                                0 <= intensity <= 255
                                for intensity in frame.intensities
                            )
                        )
                        self.assertGreater(max(frame.intensities), 0)
                    else:
                        self.assertEqual(frame.sample_rate, 48_000)
                        self.assertTrue(frame.samples)
                        self.assertEqual(len(frame.envelope), 360)
                        self.assertTrue(np.isfinite(frame.samples).all())
                        self.assertTrue(np.isfinite(frame.envelope).all())
                        self.assertTrue(
                            all(value >= 0 for value in frame.envelope)
                        )
                        self.assertTrue(-1 <= frame.correlation <= 1)
                        self.assertTrue(np.isfinite(frame.balance))
                        self.assertGreater(frame.peak_left, frame.peak_right)
                        self.assertGreater(frame.peak_right, 0.4)
                    before = len(received)
                    self.assertTrue(stream.unsubscribe(callback))
                    stream.process(source[:, :1024].copy())
                    self.assertEqual(len(received), before)
                np.testing.assert_array_equal(output, source)

    def test_offline_telemetry_callback_receives_semantic_frames(self) -> None:
        received: list[effetune.TelemetryFrame] = []
        source = np.ones((2, 2048), dtype=np.float32)
        output = effetune.Chain([effetune.LevelMeter(id="meter")]).process(
            source,
            sample_rate=48_000,
            on_telemetry=received.append,
        )
        np.testing.assert_array_equal(output, source)
        self.assertTrue(received)
        self.assertEqual(received[-1].effect_id, "meter")

    def test_telemetry_callback_failures_do_not_interrupt_processing(self) -> None:
        source = np.ones((2, 2048), dtype=np.float32)

        def fail(_: effetune.TelemetryFrame) -> None:
            raise RuntimeError("callback failure")

        with warnings.catch_warnings(), self.assertLogs(
            "effetune.chain", level="WARNING"
        ) as logged:
            warnings.simplefilter("error")
            offline = effetune.LevelMeter().process(
                source,
                sample_rate=48_000,
                block_size=128,
                on_telemetry=fail,
            )
            with effetune.Chain([effetune.LevelMeter()]).stream(
                48_000,
                channels=2,
                block_size=128,
                on_telemetry=fail,
            ) as stream:
                streaming = stream.process(source)

        np.testing.assert_array_equal(offline, source)
        np.testing.assert_array_equal(streaming, source)
        self.assertGreaterEqual(len(logged.output), 2)
        self.assertTrue(
            all(
                "EffeTune telemetry callback failed: callback failure" in message
                for message in logged.output
            )
        )

    def test_stream_preserves_state_and_reset_replays_initial_state(self) -> None:
        impulse = np.zeros((1, 128), dtype=np.float32)
        impulse[0, 0] = 1.0
        silence = np.zeros_like(impulse)
        chain = effetune.Chain(
            [effetune.Delay(delay_size=1, feedback=80, mix=100, pre_delay=0)]
        )
        with chain.stream(48_000, channels=1, block_size=128) as stream:
            self.assertGreaterEqual(stream.latency_samples, 0)
            first = stream.process(impulse)
            tail = stream.process(silence)
            self.assertTrue(np.any(tail != 0.0))
            stream.reset()
            replay = stream.process(impulse)
            np.testing.assert_array_equal(replay, first)
        self.assertTrue(stream.closed)
        stream.close()
        with self.assertRaises(effetune.StateError):
            stream.process(impulse)
        with self.assertRaises(effetune.StateError):
            stream.reset()
        with self.assertRaises(effetune.StateError):
            _ = stream.latency_samples

    def test_chain_latency_matches_an_open_stream_without_disturbing_processing(
        self,
    ) -> None:
        source = np.full((1, 64), 0.5, dtype=np.float32)
        chain = effetune.Chain(
            [effetune.BrickwallLimiter(id="limiter", lookahead=3)]
        )
        reference = chain.process(source, sample_rate=48_000, block_size=8)

        latency = chain.latency_samples(48_000, channels=1)
        self.assertEqual(latency, 144)
        with chain.stream(48_000, channels=1, block_size=8) as stream:
            self.assertEqual(latency, stream.latency_samples)

        after_query = chain.process(source, sample_rate=48_000, block_size=8)
        np.testing.assert_array_equal(after_query, reference)
        self.assertEqual(chain.latency_samples(48_000, channels=1), latency)
        self.assertEqual(chain.latency_samples(48_000), 144)

        plain = effetune.Chain([effetune.Volume(volume=-6)])
        self.assertEqual(plain.latency_samples(48_000, channels=1), 0)
        self.assertEqual(effetune.Chain().latency_samples(48_000), 0)
        with self.assertRaises(effetune.ValidationError):
            plain.latency_samples(0)

    def test_frequency_shifter_latency_matches_chain_and_open_stream(self) -> None:
        chain = effetune.Chain([effetune.FrequencyShifter()])
        for sample_rate, expected in (
            (48_000, 114),
            (96_000, 228),
            (192_000, 456),
        ):
            with self.subTest(sample_rate=sample_rate):
                self.assertEqual(
                    chain.latency_samples(sample_rate, channels=2), expected
                )
                with chain.stream(
                    sample_rate, channels=2, block_size=64
                ) as stream:
                    self.assertEqual(stream.latency_samples, expected)

    def test_chain_latency_resolves_assets_for_convolution_effects(self) -> None:
        ir = effetune.AssetData(
            np.array([[1.0]], dtype=np.float32), 48_000, topology="mono"
        )
        chain = effetune.Chain(
            [
                effetune.RoomEQ(
                    latency_mode="512",
                    filter_delay_samples=0,
                    assets={"impulseResponse": "room-ir"},
                )
            ]
        )
        latency = chain.latency_samples(48_000, asset_resolver=lambda _: ir)
        self.assertEqual(latency, 512)
        with chain.stream(
            48_000, channels=2, asset_resolver=lambda _: ir
        ) as stream:
            self.assertEqual(latency, stream.latency_samples)

    def test_stream_parameter_events_are_frame_relative_ordered_and_persistent(self) -> None:
        source = np.ones((1, 12), dtype=np.float32)
        chain = effetune.Chain([effetune.Volume(id="gain", volume=0)])
        with chain.stream(48_000, channels=1, block_size=3) as stream:
            output = stream.process(
                source,
                events=[
                    {
                        "frame": 0,
                        "effectId": "gain",
                        "parameters": {"volume": -6},
                    },
                    {
                        "frame": 4,
                        "effectId": "gain",
                        "parameters": {"volume": -12},
                    },
                    {
                        "frame": 4,
                        "effectId": "gain",
                        "parameters": {"volume": -18},
                    },
                    {
                        "frame": 8,
                        "effectId": "gain",
                        "parameters": {"volume": 0},
                    },
                ],
            )
            expected = np.concatenate(
                (
                    np.full(4, 10.0 ** (-6.0 / 20.0), dtype=np.float32),
                    np.full(4, 10.0 ** (-18.0 / 20.0), dtype=np.float32),
                    np.ones(4, dtype=np.float32),
                )
            )
            np.testing.assert_allclose(output[0], expected, rtol=0, atol=1e-7)

            persistent = stream.process(np.ones((1, 5), dtype=np.float32))
            np.testing.assert_array_equal(persistent, np.ones((1, 5), dtype=np.float32))
            stream.process(
                np.ones((1, 1), dtype=np.float32),
                events=[
                    {
                        "frame": 0,
                        "effectId": "gain",
                        "parameters": {"volume": -6},
                    }
                ],
            )
            reduced = stream.process(np.ones((1, 1), dtype=np.float32))
            self.assertLess(float(reduced[0, 0]), 1.0)
            stream.reset()
            restored = stream.process(np.ones((1, 1), dtype=np.float32))
            np.testing.assert_array_equal(restored, np.ones((1, 1), dtype=np.float32))

    def test_asset_backed_stream_events_keep_assets_for_live_parameters(self) -> None:
        ir = effetune.AssetData(
            np.array([[1.0]], dtype=np.float32), 48_000, topology="mono"
        )
        chain = effetune.Chain(
            [
                effetune.IRReverb(
                    id="room",
                    assets={"impulseResponse": "room-ir"},
                    channel_mode="mono",
                    latency=0,
                    convolution_rate="full",
                    wet_level=-15,
                )
            ],
            asset_resolver=lambda _: ir,
        )
        source = np.zeros((1, 8), dtype=np.float32)
        source[0, 0] = 1.0
        with chain.stream(48_000, channels=1, block_size=8) as stream:
            output = stream.process(
                source,
                events=[
                    {
                        "frame": 0,
                        "effectId": "room",
                        "parameters": {"wetLevel": -6},
                    }
                ],
            )
            self.assertTrue(np.isfinite(output).all())
            self.assertEqual(stream._current_parameters["room"]["wetLevel"], -6)

    def test_asset_reconfiguration_parameters_are_rejected_before_processing(
        self,
    ) -> None:
        mono_ir = effetune.AssetData(
            np.array([[1.0]], dtype=np.float32), 48_000, topology="mono"
        )
        crossover_ir = effetune.AssetData(
            np.ones((2, 1), dtype=np.float32), 48_000, topology="automatic"
        )
        cases = (
            (
                effetune.FIRCrossover(
                    id="effect", assets={"impulseResponse": "filters"}
                ),
                crossover_ir,
                4,
                {
                    "bandCount": 3,
                    "latencyMode": "256",
                    "filterDelaySamples": 1,
                },
            ),
            (
                effetune.FiveBandFIRPEQ(
                    id="effect", assets={"impulseResponse": "filters"}
                ),
                mono_ir,
                2,
                {"latencyMode": "256", "filterDelaySamples": 1},
            ),
            (
                effetune.GroupDelayEQ(
                    id="effect", assets={"impulseResponse": "filters"}
                ),
                mono_ir,
                2,
                {"latencyMode": "256", "filterDelaySamples": 1},
            ),
            (
                effetune.IRReverb(
                    id="effect",
                    assets={"impulseResponse": "room"},
                    channel_mode="mono",
                    convolution_rate="full",
                ),
                mono_ir,
                2,
                {
                    "channelMode": "independent",
                    "latency": 256,
                    "convolutionRate": "half",
                },
            ),
            (
                effetune.RoomEQ(
                    id="effect", assets={"impulseResponse": "filters"}
                ),
                mono_ir,
                2,
                {"latencyMode": "256", "filterDelaySamples": 1},
            ),
        )
        for effect, asset, channels, parameters in cases:
            with self.subTest(effect=effect.effect_type):
                chain = effetune.Chain(
                    [effect], asset_resolver=lambda _, resolved=asset: resolved
                )
                source = np.zeros((channels, 8), dtype=np.float32)
                with chain.stream(
                    48_000, channels=channels, block_size=8
                ) as stream:
                    initial = dict(stream._current_parameters["effect"])
                    for name, value in parameters.items():
                        with self.subTest(parameter=name), self.assertRaisesRegex(
                            effetune.ValidationError,
                            "cannot be updated while a stream is open",
                        ):
                            stream.process(
                                source,
                                events=[
                                    {
                                        "frame": 0,
                                        "effectId": "effect",
                                        "parameters": {name: value},
                                    }
                                ],
                            )
                        self.assertEqual(
                            stream._current_parameters["effect"], initial
                        )

    def test_stream_partial_events_merge_in_order_without_mutating_failed_preparation(
        self,
    ) -> None:
        source = np.full((2, 256), 0.4, dtype=np.float32)
        chain = effetune.Chain(
            [effetune.Compressor(id="comp", threshold=-24, ratio=2)]
        )
        partial_events = [
            {
                "frame": 0,
                "effectId": "comp",
                "parameters": {"threshold": -30},
            },
            {
                "frame": 0,
                "effectId": "comp",
                "parameters": {"ratio": 6},
            },
        ]
        full_parameters = dict(
            effetune.Compressor(threshold=-30, ratio=6).parameters
        )
        full_events = [
            {
                "frame": 0,
                "effectId": "comp",
                "parameters": full_parameters,
            }
        ]
        with (
            chain.stream(48_000, channels=2, block_size=64) as partial,
            chain.stream(48_000, channels=2, block_size=64) as complete,
            chain.stream(48_000, channels=2, block_size=64) as initial,
        ):
            partial_output = partial.process(source, events=partial_events)
            complete_output = complete.process(source, events=full_events)
            np.testing.assert_array_equal(partial_output, complete_output)
            self.assertEqual(
                partial._current_parameters["comp"], full_parameters
            )

            partial.reset()
            reset_output = partial.process(source)
            initial_output = initial.process(source)
            np.testing.assert_array_equal(reset_output, initial_output)

        with (
            chain.stream(48_000, channels=2, block_size=64) as rejected,
            chain.stream(48_000, channels=2, block_size=64) as unchanged,
        ):
            with self.assertRaisesRegex(
                effetune.ValidationError, "unknown fields: missing"
            ):
                rejected.process(
                    source,
                    events=[
                        partial_events[0],
                        {
                            "frame": 0,
                            "effectId": "comp",
                            "parameters": {"missing": 1},
                        },
                    ],
                )
            self.assertEqual(
                rejected._current_parameters["comp"],
                dict(effetune.Compressor(threshold=-24, ratio=2).parameters),
            )
            np.testing.assert_array_equal(
                rejected.process(source), unchanged.process(source)
            )

    def test_modulation_cross_field_rules_match_constructor_json_and_event_order(
        self,
    ) -> None:
        frames = np.arange(512, dtype=np.float32)
        source = np.vstack(
            (
                np.sin(frames * np.float32(0.071)) * np.float32(0.4),
                np.cos(frames * np.float32(0.053)) * np.float32(0.3),
            )
        ).astype(np.float32, copy=False)

        def canonicalize(
            effect_type: str, parameters: dict[str, float]
        ) -> dict[str, float]:
            values = dict(parameters)
            if effect_type == "AutoFilter":
                if values["minimumFrequency"] > values["maximumFrequency"]:
                    values["minimumFrequency"], values["maximumFrequency"] = (
                        values["maximumFrequency"],
                        values["minimumFrequency"],
                    )
            elif effect_type == "Chorus":
                values["depth"] = min(values["depth"], values["delay"])
            elif values["minimumShift"] > values["maximumShift"]:
                values["minimumShift"], values["maximumShift"] = (
                    values["maximumShift"],
                    values["minimumShift"],
                )
            return values

        cases = (
            (
                "AutoFilter",
                effetune.AutoFilter,
                {"minimum_frequency": 8000, "maximum_frequency": 200},
                {"minimumFrequency": 8000, "maximumFrequency": 200},
                {"minimumFrequency": 200, "maximumFrequency": 8000},
                {"minimumFrequency": 100, "maximumFrequency": 9000},
            ),
            (
                "Chorus",
                effetune.Chorus,
                {"delay": 0.5, "depth": 20},
                {"delay": 0.5, "depth": 20},
                {"delay": 0.5, "depth": 0.5},
                {"delay": 10, "depth": 0.25},
            ),
            (
                "FrequencyShifter",
                effetune.FrequencyShifter,
                {"minimum_shift": 900, "maximum_shift": 20},
                {"minimumShift": 900, "maximumShift": 20},
                {"minimumShift": 20, "maximumShift": 900},
                {"minimumShift": 10, "maximumShift": 1000},
            ),
        )
        for (
            effect_type,
            effect_class,
            constructor,
            supplied,
            canonical,
            updates,
        ) in cases:
            with self.subTest(effect=effect_type):
                effect_id = f"{effect_type}-cross-field"
                named = effetune.Chain(
                    [effect_class(id=effect_id, **constructor)]
                )
                serialized = effetune.Chain.from_preset(
                    json.dumps(
                        {
                            "version": 1,
                            "chain": [
                                {
                                    "id": effect_id,
                                    "type": effect_type,
                                    "parameters": supplied,
                                }
                            ],
                        }
                    )
                )
                canonical_chain = effetune.Chain.from_preset(
                    {
                        "version": 1,
                        "chain": [
                            {
                                "id": effect_id,
                                "type": effect_type,
                                "parameters": canonical,
                            }
                        ],
                    }
                )
                self.assertEqual(named.to_dict(), serialized.to_dict())
                expected = canonical_chain.process(
                    source, sample_rate=48_000, block_size=64
                )
                np.testing.assert_array_equal(
                    named.process(source, sample_rate=48_000, block_size=64),
                    expected,
                )
                np.testing.assert_array_equal(
                    serialized.process(
                        source, sample_rate=48_000, block_size=64
                    ),
                    expected,
                )

                entries = list(supplied.items())
                for ordered in (entries, list(reversed(entries))):
                    event_chain = effetune.Chain(
                        [effect_class(id=effect_id)]
                    )
                    with event_chain.stream(
                        48_000, channels=2, block_size=64
                    ) as stream:
                        actual = stream.process(
                            source,
                            events=[
                                {
                                    "frame": 0,
                                    "effectId": effect_id,
                                    "parameters": {name: value},
                                }
                                for name, value in ordered
                            ],
                        )
                        np.testing.assert_array_equal(actual, expected)
                        self.assertEqual(
                            stream._current_parameters[effect_id],
                            named.effects[0].parameters,
                        )

                for names in (list(updates), list(reversed(updates))):
                    candidate_chain = effetune.Chain.from_preset(
                        {
                            "version": 1,
                            "chain": [
                                {
                                    "id": effect_id,
                                    "type": effect_type,
                                    "parameters": supplied,
                                }
                            ],
                        }
                    )
                    reference_chain = effetune.Chain.from_preset(
                        {
                            "version": 1,
                            "chain": [
                                {
                                    "id": effect_id,
                                    "type": effect_type,
                                    "parameters": canonical,
                                }
                            ],
                        }
                    )
                    with candidate_chain.stream(
                        48_000, channels=2, block_size=64
                    ) as candidate_stream, reference_chain.stream(
                        48_000, channels=2, block_size=64
                    ) as reference_stream:
                        steps = (
                            (names[0], supplied[names[0]]),
                            (names[1], supplied[names[1]]),
                            (names[0], updates[names[0]]),
                            (names[1], updates[names[1]]),
                        )
                        effective = dict(canonical)
                        raw = dict(supplied)
                        for name, value in steps:
                            raw[name] = value
                            effective = canonicalize(
                                effect_type, {**effective, name: value}
                            )
                            expected_output = reference_stream.process(
                                source,
                                events=[
                                    {
                                        "frame": 0,
                                        "effectId": effect_id,
                                        "parameters": effective,
                                    }
                                ],
                            )
                            actual_output = candidate_stream.process(
                                source,
                                events=[
                                    {
                                        "frame": 0,
                                        "effectId": effect_id,
                                        "parameters": {name: value},
                                    }
                                ],
                            )
                            np.testing.assert_array_equal(
                                actual_output, expected_output
                            )
                        for name in supplied:
                            self.assertEqual(
                                candidate_stream._current_parameters[effect_id][
                                    name
                                ],
                                raw[name],
                            )
                            self.assertEqual(
                                candidate_stream._processing_parameters[
                                    effect_id
                                ][name],
                                effective[name],
                            )

    def test_stream_parameter_event_validation_is_explicit(self) -> None:
        source = np.ones((1, 8), dtype=np.float32)
        chain = effetune.Chain([effetune.Volume(id="gain")])
        with chain.stream(48_000, channels=1, block_size=4) as stream:
            invalid_events = (
                [
                    {
                        "frame": 8,
                        "effectId": "gain",
                        "parameters": {"volume": -6},
                    }
                ],
                [
                    {
                        "frame": 4,
                        "effectId": "gain",
                        "parameters": {"volume": -6},
                    },
                    {
                        "frame": 3,
                        "effectId": "gain",
                        "parameters": {"volume": -6},
                    },
                ],
                [
                    {
                        "frame": 0,
                        "effectId": "missing",
                        "parameters": {"volume": -6},
                    }
                ],
                [
                    {
                        "frame": 0,
                        "effectId": "gain",
                        "parameters": {"missing": 0},
                    }
                ],
                [
                    {
                        "frame": 0,
                        "effectId": "gain",
                        "parameters": {"volume": 100},
                    }
                ],
            )
            for events in invalid_events:
                with self.subTest(events=events), self.assertRaises(
                    effetune.ValidationError
                ):
                    stream.process(source, events=events)

    def test_phaser_stage_events_reject_odd_values_without_mutating_state(self) -> None:
        source = np.full((1, 8), 0.25, dtype=np.float32)
        chain = effetune.Chain([effetune.Phaser(id="phaser", stages=6)])
        with chain.stream(48_000, channels=1, block_size=8) as stream:
            with self.assertRaises(effetune.ValidationError):
                stream.process(
                    source,
                    events=[
                        {
                            "frame": 0,
                            "effectId": "phaser",
                            "parameters": {"stages": 7},
                        }
                    ],
                )
            self.assertEqual(stream._current_parameters["phaser"]["stages"], 6)
            stream.process(
                source,
                events=[
                    {
                        "frame": 0,
                        "effectId": "phaser",
                        "parameters": {"stages": 12},
                    }
                ],
            )
            self.assertEqual(stream._current_parameters["phaser"]["stages"], 12)

    def test_seed_reproduces_stochastic_output(self) -> None:
        source = np.linspace(-0.8, 0.8, 1024, dtype=np.float32).reshape(1, -1)
        chain = effetune.Chain(
            [effetune.SimpleJitter(rms_jitter_nanoseconds=100_000)]
        )
        first = chain(source, 48_000, seed=17)
        second = chain(source, 48_000, seed=17)
        other = chain(source, 48_000, seed=18)
        np.testing.assert_array_equal(first, second)
        self.assertFalse(np.array_equal(first, other))

    def test_all_76_wrappers_pack_parameters_and_execute_natively(self) -> None:
        source = np.vstack(
            (
                np.linspace(-0.8, 0.8, 257, dtype=np.float32),
                np.linspace(0.7, -0.7, 257, dtype=np.float32),
            )
        )
        ir = effetune.AssetData(
            np.array([[1.0]], dtype=np.float32),
            48_000,
            topology="mono",
        )
        crossover_ir = effetune.AssetData(
            np.ones((2, 1), dtype=np.float32),
            48_000,
            topology="automatic",
        )
        source_four_channels = np.vstack((source, source))
        self.assertEqual(len(EFFECT_METADATA["effects"]), 90)
        for metadata in EFFECT_METADATA["effects"]:
            effect_type = metadata["type"]
            definition = metadata["parameters"][0] if metadata["parameters"] else None
            options = {}
            if definition is not None and effect_type not in {
                "ChannelDivider",
                "FIRCrossover",
            }:
                argument = _snake_case(definition["name"])
                options[argument] = _nondefault_value(definition)
            if metadata["assets"]:
                options["assets"] = {"impulseResponse": "smoke-ir"}
            with self.subTest(effect=effect_type):
                effect = EFFECT_CLASSES[effect_type](**options)
                if definition is not None and options.keys() != {"assets"}:
                    if effect_type not in {"ChannelDivider", "FIRCrossover"}:
                        self.assertNotEqual(
                            effect.parameters[definition["name"]],
                            definition["default"],
                        )
                asset = crossover_ir if effect_type == "FIRCrossover" else ir
                chain = effetune.Chain(
                    [effect],
                    asset_resolver=lambda _, resolved=asset: resolved,
                )
                audio = (
                    source_four_channels
                    if effect_type in {"ChannelDivider", "FIRCrossover"}
                    else source
                )
                with chain.stream(
                    48_000, channels=audio.shape[0], block_size=64
                ) as stream:
                    self.assertIsNotNone(stream._native)
                    output = stream.process(audio)
                self.assertEqual(output.shape, audio.shape)
                self.assertTrue(np.isfinite(output).all())

    def test_fir_crossover_uses_automatic_eta1_as_canonical_matrix(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            effect = effetune.FIRCrossover(
                assets={"impulseResponse": "filters"}
            )
            effetune.Bundle.pack(
                root / "bundle",
                effetune.Chain([effect]).to_dict(),
                {
                    "filters": effetune.AssetData(
                        np.ones((2, 1), dtype=np.float32),
                        48_000,
                        topology="automatic",
                    )
                },
            )
            source = np.zeros((4, 128), dtype=np.float32)
            source[0, 0] = 1.0
            source[1, 0] = -1.0

            output = effetune.Chain.from_bundle(root / "bundle").process(
                source,
                sample_rate=48_000,
            )

            self.assertEqual(output.shape, source.shape)
            self.assertTrue(np.isfinite(output).all())

    def test_compressor_matches_current_nonidentity_native_golden(self) -> None:
        root = REPOSITORY_ROOT / "dsp" / "plugins" / "dynamics" / "compressor" / "golden"
        metadata = json.loads((root / "case-003.json").read_text(encoding="utf-8"))
        expected = np.fromfile(root / metadata["binary"], dtype="<f4").reshape(
            metadata["channels"], metadata["frameCount"]
        )
        source = np.empty_like(expected)
        for channel in range(source.shape[0]):
            for frame in range(source.shape[1]):
                source[channel, frame] = 1.0 if (frame + channel) % 2 == 0 else -1.0
        params = metadata["params"]
        actual = effetune.Compressor(
            threshold=params["th"],
            ratio=params["rt"],
            attack=params["at"],
            release=params["rl"],
            knee=params["kn"],
            gain=params["gn"],
        ).process(
            source,
            sample_rate=metadata["sampleRate"],
            block_size=metadata["blockSize"],
        )
        maximum_error = float(np.max(np.abs(actual - expected)))
        self.assertLessEqual(maximum_error, metadata["tolerance"]["abs"])
        self.assertGreater(
            float(np.max(np.abs(source - expected))), metadata["tolerance"]["abs"]
        )


if __name__ == "__main__":
    unittest.main()
