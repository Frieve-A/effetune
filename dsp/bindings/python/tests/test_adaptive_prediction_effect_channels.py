from __future__ import annotations

from types import ModuleType
import unittest
from unittest.mock import Mock, patch

import numpy as np

import effetune


class AdaptivePredictionEffectChannelTests(unittest.TestCase):
    def test_native_chain_and_graph_accept_low_high_and_nonstandard_sample_rates(self):
        source = np.full((2, 8), 0.25, dtype=np.float32)
        for sample_rate in (8000, 32000, 50000, 96000, 192000, 352800, 384000):
            effect = effetune.AdaptivePredictionEffect(
                id="ape", freeze=True, original=0, residual=0, prediction=1
            )
            for owner in self._owners(effect):
                with self.subTest(sample_rate=sample_rate, owner=type(owner).__name__):
                    with owner.stream(sample_rate, channels=2, block_size=8) as stream:
                        np.testing.assert_array_equal(stream.process(source), np.zeros_like(source))

    @staticmethod
    def _owners(effect, *, mute=False):
        chain = effetune.Chain([effect])
        graph = effetune.Graph(
            {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": [effect.to_dict()],
                "edges": [
                    {"id": "in", "source": "input", "destination": effect.id},
                    {
                        "id": "out",
                        "source": effect.id,
                        "destination": "output",
                        "mute": mute,
                    },
                ],
            }
        )
        return chain, graph

    @staticmethod
    def _prepare(owner, route, channels):
        if route == "stream":
            return owner.stream(48_000, channels=channels, block_size=8)
        return owner.process(
            np.zeros((channels, 8), dtype=np.float32),
            sample_rate=48_000,
            block_size=8,
        )

    @staticmethod
    def _native_module(constructor):
        module = ModuleType("effetune._native")
        module._NativeChain = constructor
        return module

    def test_all_on_multichannel_audio_rejects_before_native_allocation(self):
        effect = effetune.AdaptivePredictionEffect(id="ape")
        constructor = Mock()
        with patch.dict("sys.modules", {"effetune._native": self._native_module(constructor)}):
            for owner in self._owners(effect):
                for route in ("stream", "process"):
                    for channels in (3, 4, 16):
                        with self.subTest(owner=type(owner).__name__, route=route, channels=channels):
                            with self.assertRaises(effetune.ValidationError) as caught:
                                self._prepare(owner, route, channels)
                            self.assertEqual(
                                str(caught.exception),
                                "AdaptivePredictionEffect processes one or two channels; "
                                "select stereo or a single channel.",
                            )
                            if isinstance(owner, effetune.Graph):
                                self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_CHANNEL")
                                self.assertEqual(caught.exception.path, "/nodes/0/channel")
                                self.assertEqual(caught.exception.node_id, "ape")
            constructor.assert_not_called()

    def test_supported_selections_reach_native_allocation(self):
        selections = (
            ("all", 1), ("all", 2), ("stereo", 1), ("stereo", 16),
            ("left", 16), ("right", 16), ("16", 16), ("34", 4), ("1516", 16),
        )
        sentinel = RuntimeError("native allocation reached")
        constructor = Mock(side_effect=sentinel)
        with patch.dict("sys.modules", {"effetune._native": self._native_module(constructor)}):
            for channel, channels in selections:
                effect = effetune.AdaptivePredictionEffect(id="ape", channel=channel)
                for owner in self._owners(effect):
                    for route in ("stream", "process"):
                        with self.subTest(channel=channel, channels=channels, owner=type(owner).__name__, route=route):
                            constructor.reset_mock()
                            with self.assertRaises(effetune.EffeTuneRuntimeError) as caught:
                                self._prepare(owner, route, channels)
                            self.assertIs(caught.exception.__cause__, sentinel)
                            constructor.assert_called_once_with(48_000, channels, 32)

    def test_disabled_chain_effect_keeps_multichannel_bypass(self):
        effect = effetune.AdaptivePredictionEffect(id="ape", enabled=False)
        constructor = Mock()
        source = np.ones((4, 8), dtype=np.float32)
        with patch.dict("sys.modules", {"effetune._native": self._native_module(constructor)}):
            output = effetune.Chain([effect]).process(source, sample_rate=48_000)
            np.testing.assert_array_equal(output, source)
            constructor.assert_not_called()

    def test_graph_checks_processing_limit_only_for_enabled_effective_nodes(self):
        sentinel = RuntimeError("native allocation reached")
        constructor = Mock(side_effect=sentinel)
        with patch.dict("sys.modules", {"effetune._native": self._native_module(constructor)}):
            for enabled, mute in ((False, False), (True, True)):
                effect = effetune.AdaptivePredictionEffect(id="ape", enabled=enabled)
                graph = self._owners(effect, mute=mute)[1]
                for route in ("stream", "process"):
                    with self.subTest(enabled=enabled, mute=mute, route=route):
                        constructor.reset_mock()
                        with self.assertRaises(effetune.EffeTuneRuntimeError) as caught:
                            self._prepare(graph, route, 4)
                        self.assertIs(caught.exception.__cause__, sentinel)
                        constructor.assert_called_once()

            for enabled, mute in ((False, False), (True, True)):
                effect = effetune.AdaptivePredictionEffect(id="ape", enabled=enabled, channel="1516")
                graph = self._owners(effect, mute=mute)[1]
                constructor.reset_mock()
                with self.subTest(enabled=enabled, mute=mute), self.assertRaises(effetune.ValidationError) as caught:
                    graph.stream(48_000, channels=4)
                self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_CHANNEL")
                self.assertEqual(caught.exception.path, "/nodes/0/channel")
                self.assertEqual(caught.exception.node_id, "ape")
                constructor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
