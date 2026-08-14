from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np

import effetune
from effetune.graph import _compile_error, _effective_node_ids
from effetune.graph_document import (
    graph_document_from_chain,
    normalize_graph_document,
    normalize_graph_input,
    send_return_graph_document,
    visualization_snapshot,
    wet_dry_graph_document,
)
from effetune.validation import validate_chain_document


_FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "common"
        / "graph-v1-contract.fixture.json"
    ).read_text(encoding="utf-8")
)


class GraphDocumentTests(unittest.TestCase):
    def test_native_invalid_diagnostics_map_to_stable_document_errors(self) -> None:
        state = normalize_graph_input(
            next(item for item in _FIXTURE["valid"] if item["name"] == "serial")["document"]
        )
        invalid_id = _compile_error(-8, (-8, 1, 0, 2, 0, 0), state)
        self.assertIsInstance(invalid_id, effetune.ValidationError)
        self.assertEqual(invalid_id.code, "GRAPH_DOCUMENT_ID")
        self.assertEqual(invalid_id.path, "/nodes/0/id")
        self.assertEqual(invalid_id.node_id, "volume")

        cycle = _compile_error(-9, (-9, 2, 0, 13, 0, 0), state)
        self.assertIsInstance(cycle, effetune.ValidationError)
        self.assertEqual(cycle.code, "GRAPH_DOCUMENT_CYCLE")
        self.assertEqual(cycle.edge_id, "input-volume")

    def test_ids_use_unicode_scalar_length_and_mix_groups_are_nonempty(self) -> None:
        emoji_128 = "😀" * 128
        document = normalize_graph_document(
            {
                "version": 1,
                "input": {"id": emoji_128},
                "output": {"id": "output"},
                "nodes": [],
                "edges": [],
            }
        )
        self.assertEqual(len(document["input"]["id"]), 128)
        with self.assertRaises(effetune.ValidationError) as caught:
            normalize_graph_document(
                {
                    "version": 1,
                    "input": {"id": emoji_128 + "😀"},
                    "output": {"id": "output"},
                    "nodes": [],
                    "edges": [],
                }
            )
        self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_ID")
        self.assertEqual(caught.exception.path, "/input/id")

        serial = deepcopy(
            next(item for item in _FIXTURE["valid"] if item["name"] == "serial")["document"]
        )
        serial["edges"][0]["mixGroup"] = ""
        with self.assertRaises(effetune.ValidationError) as caught:
            normalize_graph_document(serial)
        self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_EDGE_CONTROL")
        self.assertEqual(caught.exception.path, "/edges/0/mixGroup")

    def test_shared_fixture_normalizes_and_rejects_with_stable_diagnostics(self) -> None:
        for entry in _FIXTURE["valid"]:
            document = normalize_graph_document(entry["document"])
            self.assertEqual(document["version"], 1, entry["name"])
            self.assertEqual(
                [node["id"] for node in document["nodes"]],
                sorted(node["id"] for node in document["nodes"]),
            )
            for edge in document["edges"]:
                self.assertIn("gain", edge)
                self.assertIn("mute", edge)
                self.assertIn("mixGroup", edge)
                self.assertIn("solo", edge)
        for entry in _FIXTURE["invalid"]:
            if "streamChannels" in entry:
                continue
            with self.subTest(entry["name"]), self.assertRaises(
                effetune.ValidationError
            ) as caught:
                normalize_graph_document(entry["document"])
            self.assertEqual(caught.exception.code, entry["code"])
            self.assertEqual(caught.exception.path, entry["path"])

    def test_node_failures_name_the_field_that_caused_them(self) -> None:
        def base(node: dict) -> dict:
            return {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": [node],
                "edges": [
                    {"id": "in", "source": "input", "destination": "node"},
                    {"id": "out", "source": "node", "destination": "output"},
                ],
            }

        cases = [
            # A rejected IRReverb.channelMode value is a parameter failure even though
            # its message mentions a channel.
            (
                {
                    "id": "node",
                    "type": "IRReverb",
                    "parameters": {
                        "channelMode": "quadraphonic",
                        "latency": 0,
                        "convolutionRate": "auto",
                        "wetLevel": 0,
                        "dryLevel": 0,
                        "preDelay": 0,
                    },
                    "assets": {"impulseResponse": "room-ir"},
                },
                effetune.ValidationError,
                "GRAPH_DOCUMENT_PARAMETER",
                "/nodes/0/parameters/channelMode",
            ),
            (
                {"id": "node", "type": "Volume", "parameters": {"volume": 99}},
                effetune.ValidationError,
                "GRAPH_DOCUMENT_PARAMETER",
                "/nodes/0/parameters/volume",
            ),
            (
                {"id": "node", "type": "Volume", "parameters": {"gain": 0}},
                effetune.ValidationError,
                "GRAPH_DOCUMENT_PARAMETER",
                "/nodes/0/parameters/gain",
            ),
            (
                {
                    "id": "node",
                    "type": "Volume",
                    "channel": "surround",
                    "parameters": {"volume": 0},
                },
                effetune.ValidationError,
                "GRAPH_DOCUMENT_CHANNEL",
                "/nodes/0/channel",
            ),
            (
                {"id": "node", "type": "NotAnEffect", "parameters": {}},
                effetune.EffectError,
                "GRAPH_DOCUMENT_REFERENCE",
                "/nodes/0/type",
            ),
        ]
        for node, error_type, code, path in cases:
            with self.subTest(path=path), self.assertRaises(error_type) as caught:
                normalize_graph_document(base(node))
            self.assertEqual(caught.exception.code, code)
            self.assertEqual(caught.exception.path, path)
            self.assertEqual(caught.exception.node_id, "node")

    def test_node_asset_failures_keep_asset_error_and_gain_a_document_location(self) -> None:
        def base(node: dict) -> dict:
            return {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": [node],
                "edges": [
                    {"id": "in", "source": "input", "destination": "node"},
                    {"id": "out", "source": "node", "destination": "output"},
                ],
            }

        def zero_latency_ir(assets: dict | None) -> dict:
            node = {
                "id": "node",
                "type": "IRReverb",
                "parameters": {
                    "channelMode": "automatic",
                    "latency": 0,
                    "convolutionRate": "auto",
                    "wetLevel": 0,
                    "dryLevel": 0,
                    "preDelay": 0,
                },
            }
            if assets is not None:
                node["assets"] = assets
            return node

        cases = [
            (
                "declares no assets",
                {
                    "id": "node",
                    "type": "Volume",
                    "parameters": {"volume": 0},
                    "assets": {"impulseResponse": "x"},
                },
            ),
            ("missing required assets", zero_latency_ir(None)),
            ("unknown asset name", zero_latency_ir({"bogus": "x"})),
            ("empty asset reference", zero_latency_ir({"impulseResponse": ""})),
        ]
        for label, node in cases:
            with self.subTest(label=label), self.assertRaises(effetune.AssetError) as caught:
                normalize_graph_document(base(node))
            self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_REFERENCE")
            self.assertEqual(caught.exception.path, "/nodes/0/assets")
            self.assertEqual(caught.exception.node_id, "node")

    def test_every_recipe_rejects_positive_latency_ir_with_one_message(self) -> None:
        wet_plus_dry_ir = {
            "id": "node",
            "type": "IRReverb",
            "parameters": {
                "channelMode": "automatic",
                "latency": 128,
                "convolutionRate": "auto",
                "wetLevel": 0,
                "dryLevel": 0,
                "preDelay": 0,
            },
            "assets": {"impulseResponse": "room-ir"},
        }
        expected = (
            "IRReverb must be wet-only in a Graph; turn dryEnabled off or set "
            "dryLevel to -96 dB (the parameter minimum), then use the external dry edge."
        )
        builders = [
            ("wet_dry", lambda: wet_dry_graph_document(wet_plus_dry_ir)),
            ("send_return", lambda: send_return_graph_document(wet_plus_dry_ir)),
            (
                "from_chain",
                lambda: graph_document_from_chain(
                    {"version": 1, "chain": [wet_plus_dry_ir]}
                ),
            ),
        ]
        for label, build in builders:
            with self.subTest(builder=label), self.assertRaises(
                effetune.ValidationError
            ) as caught:
                build()
            self.assertEqual(caught.exception.code, "GRAPH_UNSUPPORTED_CAPABILITY")
            self.assertEqual(caught.exception.path, "/nodes/0/parameters/dryLevel")
            self.assertEqual(caught.exception.node_id, "node")
            self.assertEqual(str(caught.exception), expected)

        wet_only_ir = dict(
            wet_plus_dry_ir,
            parameters=dict(wet_plus_dry_ir["parameters"], dryLevel=-96),
        )
        send_return_graph_document(wet_only_ir)
        dry_disabled_ir = dict(
            wet_plus_dry_ir,
            parameters=dict(wet_plus_dry_ir["parameters"], dryEnabled=False),
        )
        send_return_graph_document(dry_disabled_ir)

    def test_recipes_reject_a_non_effect_before_deriving_a_node_id(self) -> None:
        for value in ("Volume", 5, None, ["Volume"]):
            for label, build in (
                ("wet_dry", wet_dry_graph_document),
                ("send_return", send_return_graph_document),
            ):
                with self.subTest(value=repr(value), builder=label), self.assertRaises(
                    effetune.ValidationError
                ) as caught:
                    build(value)
                self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_REFERENCE")
                self.assertEqual(caught.exception.path, "/nodes/0")

        # A falsy explicit id is a caller mistake, not a request for the default id.
        for build in (wet_dry_graph_document, send_return_graph_document):
            for label, call in (
                ("empty id field", lambda build=build: build(
                    {"id": "", "type": "Volume", "parameters": {"volume": 0}}
                )),
                ("empty node_id argument", lambda build=build: build(
                    {"id": "kept", "type": "Volume", "parameters": {"volume": 0}}, node_id=""
                )),
            ):
                with self.subTest(builder=build.__name__, case=label), self.assertRaises(
                    effetune.ValidationError
                ) as caught:
                    call()
                self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_ID")
                self.assertEqual(caught.exception.path, "/nodes/0/id")

    def test_graph_errors_speak_graph_vocabulary_and_chain_wording_is_unchanged(self) -> None:
        with self.assertRaises(effetune.ValidationError) as caught:
            normalize_graph_document(
                {
                    "version": 1,
                    "input": {"id": "input"},
                    "output": {"id": "output"},
                    "nodes": [
                        {
                            "id": "node",
                            "type": "Volume",
                            "parameters": {"volume": 0},
                            "bogus": 1,
                        }
                    ],
                    "edges": [
                        {"id": "in", "source": "input", "destination": "node"},
                        {"id": "out", "source": "node", "destination": "output"},
                    ],
                }
            )
        self.assertEqual(
            str(caught.exception), "Graph node node contains unknown fields: bogus"
        )
        self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_REFERENCE")
        self.assertEqual(caught.exception.path, "/nodes/0")

        with self.assertRaises(effetune.ValidationError) as caught:
            validate_chain_document(
                {
                    "version": 1,
                    "chain": [
                        {"type": "Volume", "parameters": {"volume": 0}, "bogus": 1}
                    ],
                }
            )
        self.assertEqual(
            str(caught.exception), "chain[0] contains unknown fields: bogus"
        )

        with self.assertRaises(effetune.ValidationError) as caught:
            validate_chain_document({"version": 1, "chain": [{"type": "Volume"}]})
        self.assertEqual(
            str(caught.exception), "chain[0] requires type and parameters"
        )

    def test_structural_snapshot_exposes_document_order_and_adjacency(self) -> None:
        entry = next(item for item in _FIXTURE["valid"] if item["name"] == "serial")
        graph = effetune.Graph(entry["document"])
        snapshot = graph.structural_snapshot()
        self.assertEqual(
            list(snapshot), ["document", "topologicalOrder", "incoming", "outgoing"]
        )
        self.assertEqual(snapshot["document"], graph.to_dict())
        self.assertEqual(snapshot["topologicalOrder"], ["volume"])
        self.assertEqual(
            snapshot["incoming"],
            {"input": [], "volume": ["input-volume"], "output": ["volume-output"]},
        )
        self.assertEqual(
            snapshot["outgoing"],
            {"input": ["input-volume"], "volume": ["volume-output"], "output": []},
        )

    def test_compile_error_reports_unsupported_capability_as_validation_error(self) -> None:
        state = normalize_graph_input(
            next(
                item
                for item in _FIXTURE["valid"]
                if item["name"] == "wet-dry-ir-diamond"
            )["document"]
        )
        unsupported = _compile_error(-13, (-13, 1, 0, 5, 0, 0), state)
        self.assertIsInstance(unsupported, effetune.ValidationError)
        self.assertEqual(unsupported.code, "GRAPH_UNSUPPORTED_CAPABILITY")
        self.assertEqual(unsupported.path, "/nodes/0/parameters/dryLevel")
        self.assertEqual(unsupported.node_id, "wet")
        self.assertIn("wet-only", str(unsupported))

        plan_memory = _compile_error(-3, (-3, 0, 0, 0, 0, 0), state)
        self.assertIsInstance(plan_memory, effetune.EffeTuneRuntimeError)
        self.assertNotIsInstance(plan_memory, effetune.ValidationError)
        self.assertEqual(plan_memory.code, "GRAPH_PLAN_MEMORY")

    def test_recipe_classmethods_expose_builder_arguments(self) -> None:
        def resolver(reference: str) -> bytes:
            raise AssertionError("a Graph recipe must not resolve assets")

        wet_dry = effetune.Graph.wet_dry(
            effetune.IRReverb(
                id="wet",
                channel_mode="automatic",
                latency=128,
                convolution_rate="auto",
                wet_level=0,
                dry_level=-96,
                pre_delay=0,
                assets={"impulseResponse": "room-ir"},
            ),
            wet=0.5,
            dry=0.5,
            asset_resolver=resolver,
        )
        self.assertIs(wet_dry.asset_resolver, resolver)
        self.assertEqual(
            [
                edge["gain"]
                for edge in wet_dry.to_dict()["edges"]
                if edge["mixGroup"] == "main"
            ],
            [0.5, 0.5],
        )

        send_return = effetune.Graph.send_return(
            effetune.Volume(id="return-level", volume=-3),
            send=0.25,
            asset_resolver=resolver,
        )
        self.assertIs(send_return.asset_resolver, resolver)
        self.assertEqual(
            next(
                edge
                for edge in send_return.to_dict()["edges"]
                if edge["id"] == "send"
            )["gain"],
            0.25,
        )

        with self.assertRaises(TypeError) as caught:
            effetune.Graph.send_return(effetune.Volume(id="ret"), bogus=1)
        self.assertIn("send_return", str(caught.exception))
        self.assertNotIn("send_return_graph_document", str(caught.exception))

    def test_muted_solo_suppresses_normal_edge_in_effective_binding_plan(self) -> None:
        entry = next(
            item
            for item in _FIXTURE["valid"]
            if item["name"] == "muted-solo-suppresses-normal-edge"
        )
        document = normalize_graph_document(entry["document"])
        self.assertEqual(
            sorted(_effective_node_ids(document)),
            entry["expectedEffectiveNodeIds"],
        )

    def test_recipes_expand_to_canonical_edges(self) -> None:
        effect = effetune.Volume(id="return-level", volume=-3)
        document = send_return_graph_document(effect, send=0.25)
        self.assertEqual([edge["id"] for edge in document["edges"]], ["main", "return", "send"])
        self.assertEqual(next(edge for edge in document["edges"] if edge["id"] == "send")["gain"], 0.25)
        with self.assertRaises(effetune.ValidationError) as caught:
            wet_dry_graph_document(
                {
                    "id": "wet",
                    "type": "IRReverb",
                    "parameters": {
                        "channelMode": "automatic",
                        "latency": 128,
                        "convolutionRate": "auto",
                        "wetLevel": 0,
                        "dryLevel": 0,
                        "preDelay": 0,
                    },
                    "assets": {"impulseResponse": "room-ir"},
                }
            )
        self.assertEqual(caught.exception.code, "GRAPH_UNSUPPORTED_CAPABILITY")
        self.assertEqual(caught.exception.path, "/nodes/0/parameters/dryLevel")
        wet_dry_graph_document(
            {
                "id": "zero-latency-wet",
                "type": "IRReverb",
                "parameters": {
                    "channelMode": "automatic",
                    "latency": 0,
                    "convolutionRate": "auto",
                    "wetLevel": 0,
                    "dryLevel": 0,
                    "preDelay": 0,
                },
                "assets": {"impulseResponse": "room-ir"},
            }
        )

    def test_recipe_edge_ids_avoid_global_identifier_collisions(self) -> None:
        implicit_return = send_return_graph_document(
            {"type": "Volume", "parameters": {"volume": 0}}
        )
        self.assertEqual(implicit_return["nodes"][0]["id"], "return")
        self.assertEqual(
            [edge["id"] for edge in implicit_return["edges"]],
            ["main", "return-2", "send"],
        )

        send_return = send_return_graph_document(
            {"id": "return", "type": "Volume", "parameters": {"volume": 0}},
            input_id="main",
            output_id="send",
        )
        self.assertEqual(send_return["input"]["id"], "main")
        self.assertEqual(send_return["output"]["id"], "send")
        self.assertEqual(send_return["nodes"][0]["id"], "return")
        self.assertEqual(
            [edge["id"] for edge in send_return["edges"]],
            ["main-2", "return-2", "send-2"],
        )

        wet_dry = wet_dry_graph_document(
            {"id": "dry", "type": "Volume", "parameters": {"volume": 0}},
            input_id="wet-input",
            output_id="wet-output",
        )
        self.assertEqual(wet_dry["input"]["id"], "wet-input")
        self.assertEqual(wet_dry["output"]["id"], "wet-output")
        self.assertEqual(wet_dry["nodes"][0]["id"], "dry")
        self.assertEqual(
            [edge["id"] for edge in wet_dry["edges"]],
            ["dry-2", "wet-input-2", "wet-output-2"],
        )

    def test_disabled_positive_latency_ir_bypasses_graph_adc_eligibility(self) -> None:
        disabled_ir = {
            "id": "disabled-ir",
            "type": "IRReverb",
            "enabled": False,
            "parameters": {
                "channelMode": "automatic",
                "latency": 128,
                "convolutionRate": "auto",
                "wetLevel": 0,
                "dryLevel": 0,
                "preDelay": 0,
            },
            "assets": {"impulseResponse": "room-ir"},
        }
        direct = normalize_graph_document(
            {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": [disabled_ir],
                "edges": [
                    {"id": "in", "source": "input", "destination": "disabled-ir"},
                    {"id": "out", "source": "disabled-ir", "destination": "output"},
                ],
            }
        )
        self.assertFalse(direct["nodes"][0]["enabled"])
        self.assertFalse(
            graph_document_from_chain({"version": 1, "chain": [disabled_ir]})[
                "nodes"
            ][0]["enabled"]
        )
        self.assertFalse(wet_dry_graph_document(disabled_ir)["nodes"][0]["enabled"])

        with self.assertRaises(effetune.ValidationError) as caught:
            graph_document_from_chain(
                {
                    "version": 1,
                    "chain": [{**disabled_ir, "enabled": True}],
                }
            )
        self.assertEqual(caught.exception.code, "GRAPH_UNSUPPORTED_CAPABILITY")
        self.assertEqual(caught.exception.path, "/nodes/0/parameters/dryLevel")

    def test_visualization_joins_compile_state_without_pruning(self) -> None:
        document = normalize_graph_document(
            next(item for item in _FIXTURE["valid"] if item["name"] == "serial")["document"]
        )
        snapshot = visualization_snapshot(
            document,
            {
                "nodes": [
                    {
                        "id": node["id"],
                        "effective": False,
                        "dormant": True,
                        "disabledBypass": False,
                    }
                    for node in document["nodes"]
                ],
                "edges": [
                    {
                        "id": edge["id"],
                        "active": False,
                        "suppressed": index == 0,
                        "dormant": index != 0,
                    }
                    for index, edge in enumerate(document["edges"])
                ],
            },
        )
        self.assertEqual(len(snapshot["nodes"]), len(document["nodes"]) + 2)
        effect = next(node for node in snapshot["nodes"] if node["kind"] == "effect")
        self.assertEqual(effect["state"], "dormant")
        self.assertEqual(len(snapshot["edges"]), len(document["edges"]))
        self.assertEqual(snapshot["edges"][0]["state"], "suppressed")

    def test_serial_graph_converts_explicitly_to_chain_v1(self) -> None:
        entry = next(item for item in _FIXTURE["valid"] if item["name"] == "serial")
        graph = effetune.Graph(entry["document"])
        chain = graph.to_chain()
        self.assertEqual(chain.to_dict()["version"], 1)
        self.assertEqual(
            [effect["id"] for effect in chain.to_dict()["chain"]],
            [node["id"] for node in graph.to_dict()["nodes"]],
        )

        branched = effetune.Graph(
            send_return_graph_document(effetune.Volume(id="return-level"))
        )
        with self.assertRaises(effetune.ValidationError) as caught:
            branched.to_chain()
        self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_CONNECTIVITY")


class GraphRuntimeTests(unittest.TestCase):
    def test_stream_channel_errors_identify_the_original_node(self) -> None:
        cases = [
            ("right in mono", "right", 1, "z-right"),
            ("third channel in stereo", "3", 2, "z-third"),
        ]
        for label, channel, channels, node_id in cases:
            with self.subTest(case=label):
                graph = effetune.Graph(
                    {
                        "version": 1,
                        "input": {"id": "input"},
                        "output": {"id": "output"},
                        "nodes": [
                            {
                                "id": node_id,
                                "type": "Volume",
                                "channel": channel,
                                "parameters": {"volume": 0},
                            },
                            {
                                "id": "a-volume",
                                "type": "Volume",
                                "parameters": {"volume": 0},
                            },
                        ],
                        "edges": [
                            {"id": "in", "source": "input", "destination": node_id},
                            {
                                "id": "middle",
                                "source": node_id,
                                "destination": "a-volume",
                            },
                            {
                                "id": "out",
                                "source": "a-volume",
                                "destination": "output",
                            },
                        ],
                    }
                )
                with self.assertRaises(effetune.ValidationError) as caught:
                    graph.stream(48_000, channels=channels)
                self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_CHANNEL")
                self.assertEqual(caught.exception.path, "/nodes/0/channel")
                self.assertEqual(caught.exception.node_id, node_id)

    @unittest.skipUnless(
        importlib.util.find_spec("effetune._native") is not None,
        "native extension is not installed",
    )
    def test_sample_rate_support_is_checked_only_for_enabled_effective_nodes(self) -> None:
        cases = [
            ("disabled node", False, False, False),
            ("dormant node", True, True, False),
            ("effective node", True, False, True),
        ]
        for label, enabled, mute, rejects in cases:
            with self.subTest(case=label):
                graph = effetune.Graph(
                    {
                        "version": 1,
                        "input": {"id": "input"},
                        "output": {"id": "output"},
                        "nodes": [
                            {
                                "id": "tube",
                                "type": "TubeSimulator",
                                "enabled": enabled,
                                "parameters": {},
                            }
                        ],
                        "edges": [
                            {"id": "in", "source": "input", "destination": "tube"},
                            {
                                "id": "out",
                                "source": "tube",
                                "destination": "output",
                                "mute": mute,
                            },
                        ],
                    }
                )
                if rejects:
                    with self.assertRaises(effetune.ValidationError) as caught:
                        graph.stream(32_000, channels=2)
                    self.assertIn(
                        "does not support a sample rate of 32000 Hz",
                        str(caught.exception),
                    )
                else:
                    with graph.stream(32_000, channels=2):
                        pass

    @unittest.skipUnless(
        importlib.util.find_spec("effetune._native") is not None,
        "native extension is not installed",
    )
    def test_muted_solo_suppresses_normal_edge_audio_and_snapshot(self) -> None:
        entry = next(
            item
            for item in _FIXTURE["valid"]
            if item["name"] == "muted-solo-suppresses-normal-edge"
        )
        graph = effetune.Graph(entry["document"])
        with graph.stream(48_000, channels=2, block_size=8) as stream:
            output = stream.process(np.ones((2, 8), dtype=np.float32))
            self.assertTrue(np.all(output == entry["expectedOutput"]))
            snapshot = stream.compile_snapshot
            self.assertTrue(snapshot["silence"])
            self.assertEqual(
                snapshot["effectiveSchedule"],
                entry["expectedEffectiveNodeIds"],
            )
            self.assertEqual(
                [edge["id"] for edge in snapshot["edges"] if edge["active"]],
                entry["expectedActiveEdgeIds"],
            )

    @unittest.skipUnless(
        importlib.util.find_spec("effetune._native") is not None,
        "native extension is not installed",
    )
    def test_graph_owned_safe_update_reset_and_visualization(self) -> None:
        node_id = "😀" * 128
        graph = effetune.Graph.from_chain(
            effetune.Chain([effetune.Volume(id=node_id, volume=-6)])
        )
        with graph.stream(48_000, channels=2, block_size=64) as stream:
            source = np.ones((2, 64), dtype=np.float32)
            initial = stream.process(source)
            np.testing.assert_allclose(initial, 10 ** (-6 / 20), atol=1e-5, rtol=0)
            visual = stream.visualization_snapshot()
            node = next(item for item in visual["nodes"] if item["kind"] == "effect")
            self.assertEqual(node["id"], node_id)
            self.assertTrue(node["effective"])
            self.assertFalse(node["dormant"])
            self.assertFalse(node["disabledBypass"])
            self.assertEqual(node["state"], "effective")

            stream.set_param(node_id, "volume", -12)
            updated = stream.process(source)
            np.testing.assert_allclose(updated, 10 ** (-12 / 20), atol=1e-5, rtol=0)
            stream.reset()
            np.testing.assert_allclose(stream.process(source), initial, atol=1e-5, rtol=0)

    def test_effective_instance_capacity_fails_before_native_creation(self) -> None:
        nodes = [
            effetune.Volume(id=f"node-{index:03d}").to_dict()
            for index in range(97)
        ]
        edges = [
            {
                "id": f"edge-{index:03d}",
                "source": "input" if index == 0 else nodes[index - 1]["id"],
                "destination": node["id"],
            }
            for index, node in enumerate(nodes)
        ]
        edges.append(
            {"id": "edge-097", "source": nodes[-1]["id"], "destination": "output"}
        )
        graph = effetune.Graph(
            {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": nodes,
                "edges": edges,
            }
        )
        with self.assertRaises(effetune.EffeTuneRuntimeError) as caught:
            graph.stream(48_000, channels=2)
        self.assertEqual(caught.exception.code, "GRAPH_CAPACITY")
        self.assertEqual(caught.exception.path, "/nodes/96")
        self.assertEqual(caught.exception.node_id, "node-096")

    def test_structural_node_and_edge_capacity_fail_before_native_creation(self) -> None:
        nodes = [
            effetune.Volume(id=f"node-{index:03d}").to_dict() for index in range(129)
        ]
        edges = [
            {
                "id": f"edge-{index:03d}",
                "source": "input" if index == 0 else nodes[index - 1]["id"],
                "destination": node["id"],
            }
            for index, node in enumerate(nodes)
        ]
        edges.append(
            {"id": "edge-129", "source": nodes[-1]["id"], "destination": "output"}
        )
        deep = effetune.Graph(
            {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": nodes,
                "edges": edges,
            }
        )
        with self.assertRaises(effetune.EffeTuneRuntimeError) as caught:
            deep.stream(48_000, channels=2)
        self.assertEqual(caught.exception.code, "GRAPH_CAPACITY")
        self.assertEqual(caught.exception.path, "/nodes/128")
        self.assertEqual(caught.exception.node_id, "node-128")
        self.assertIn("structural node capacity (128)", str(caught.exception))

        wide = effetune.Graph(
            {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": [],
                "edges": [
                    {
                        "id": f"edge-{index:03d}",
                        "source": "input",
                        "destination": "output",
                    }
                    for index in range(513)
                ],
            }
        )
        with self.assertRaises(effetune.EffeTuneRuntimeError) as caught:
            wide.stream(48_000, channels=2)
        self.assertEqual(caught.exception.code, "GRAPH_CAPACITY")
        self.assertEqual(caught.exception.path, "/edges/512")
        self.assertEqual(caught.exception.edge_id, "edge-512")
        self.assertIn("edge capacity (512)", str(caught.exception))

    @unittest.skipUnless(
        importlib.util.find_spec("effetune._native") is not None,
        "native extension is not installed",
    )
    def test_set_param_separates_unknown_dormant_and_rejected_updates(self) -> None:
        graph = effetune.Graph(
            {
                "version": 1,
                "input": {"id": "input"},
                "output": {"id": "output"},
                "nodes": [
                    effetune.Volume(id="a", volume=-6).to_dict(),
                    effetune.Volume(id="b", volume=-6).to_dict(),
                    effetune.Volume(id="c", volume=-6, enabled=False).to_dict(),
                    effetune.Volume(id="d", volume=-6, enabled=False).to_dict(),
                ],
                "edges": [
                    {"id": "a-in", "source": "input", "destination": "a"},
                    {"id": "a-out", "source": "a", "destination": "output"},
                    {"id": "b-in", "source": "input", "destination": "b"},
                    {
                        "id": "b-out",
                        "source": "b",
                        "destination": "output",
                        "mute": True,
                    },
                    {"id": "c-in", "source": "input", "destination": "c"},
                    {"id": "c-out", "source": "c", "destination": "output"},
                    {"id": "d-in", "source": "input", "destination": "d"},
                    {
                        "id": "d-out",
                        "source": "d",
                        "destination": "output",
                        "mute": True,
                    },
                ],
            }
        )
        with graph.stream(48_000, channels=2, block_size=8) as stream:
            snapshot = stream.compile_snapshot
            dormant = next(node for node in snapshot["nodes"] if node["id"] == "b")
            self.assertTrue(dormant["dormant"])
            self.assertIsNone(dormant["scheduleIndex"])
            self.assertIsNone(dormant["bufferSlot"])
            effective = next(node for node in snapshot["nodes"] if node["id"] == "a")
            self.assertIsInstance(effective["scheduleIndex"], int)
            self.assertIsInstance(effective["bufferSlot"], int)

            with self.assertRaises(effetune.ValidationError) as caught:
                stream.set_param("missing", "volume", -6)
            self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_REFERENCE")
            self.assertEqual(caught.exception.node_id, "missing")
            self.assertIn("unknown Graph node", str(caught.exception))

            with self.assertRaises(effetune.ValidationError) as caught:
                stream.set_param("b", "volume", -6)
            self.assertEqual(caught.exception.code, "GRAPH_RECONFIGURATION_REQUIRED")
            self.assertEqual(caught.exception.path, "/nodes/1")
            self.assertEqual(caught.exception.node_id, "b")

            with self.assertRaises(effetune.ValidationError) as caught:
                stream.set_param("c", "volume", -6)
            self.assertEqual(caught.exception.code, "GRAPH_RECONFIGURATION_REQUIRED")
            self.assertEqual(caught.exception.path, "/nodes/2")
            self.assertEqual(caught.exception.node_id, "c")
            self.assertIn("disabled and bypassed", str(caught.exception))

            # Enabling a dormant node would not make it effective, so it keeps the routing
            # wording.
            self.assertTrue(
                next(
                    node
                    for node in stream.compile_snapshot["nodes"]
                    if node["id"] == "d"
                )["dormant"]
            )
            with self.assertRaises(effetune.ValidationError) as caught:
                stream.set_param("d", "volume", -6)
            self.assertEqual(caught.exception.code, "GRAPH_RECONFIGURATION_REQUIRED")
            self.assertEqual(caught.exception.path, "/nodes/3")
            self.assertEqual(caught.exception.node_id, "d")
            self.assertIn("is not effective", str(caught.exception))

            for parameter in ("volume", "gain"):
                with self.subTest(parameter=parameter), self.assertRaises(
                    effetune.ValidationError
                ) as caught:
                    stream.set_param("a", parameter, 99)
                self.assertEqual(caught.exception.code, "GRAPH_DOCUMENT_PARAMETER")
                self.assertEqual(
                    caught.exception.path, f"/nodes/0/parameters/{parameter}"
                )
                self.assertEqual(caught.exception.node_id, "a")

    @unittest.skipUnless(
        importlib.util.find_spec("effetune._native") is not None,
        "native extension is not installed",
    )
    def test_asset_preparation_failures_name_the_node_whose_asset_failed(self) -> None:
        document = {
            "version": 1,
            "input": {"id": "input"},
            "output": {"id": "output"},
            "nodes": [
                effetune.IRReverb(
                    id="room",
                    channel_mode="mono",
                    latency=0,
                    convolution_rate="full",
                    dry_level=-96,
                    assets={"impulseResponse": "room-ir"},
                ).to_dict()
            ],
            "edges": [
                {"id": "in", "source": "input", "destination": "room"},
                {"id": "out", "source": "room", "destination": "output"},
            ],
        }

        def open_stream(resolver) -> None:
            graph = effetune.Graph(document, asset_resolver=resolver)
            graph.stream(48_000, channels=1, block_size=8).close()

        def payload_at(sample_rate: int):
            def resolver(_reference: str):
                return effetune.AssetData(
                    np.ones((1, 1), dtype=np.float32), sample_rate, topology="mono"
                )

            return resolver

        def raising(_reference: str):
            raise RuntimeError("boom")

        cases = [
            ("no resolver", None),
            ("resolver raises", raising),
            ("resolver returns nothing", lambda _reference: None),
            ("resolver returns non-asset data", lambda _reference: {"nope": True}),
            ("impulse response at the wrong rate", payload_at(44_100)),
        ]
        for label, resolver in cases:
            with self.subTest(label=label), self.assertRaises(effetune.AssetError) as caught:
                open_stream(resolver)
            self.assertEqual(caught.exception.code, "GRAPH_INSTANCE_PREPARE")
            self.assertEqual(caught.exception.path, "/nodes/0/assets")
            self.assertEqual(caught.exception.node_id, "room")
        open_stream(payload_at(48_000))

        # The Chain entry point keeps its plain AssetError: the Graph diagnostics are Graph-only.
        chain = effetune.Chain(
            [
                effetune.IRReverb(
                    id="room",
                    channel_mode="mono",
                    latency=0,
                    convolution_rate="full",
                    dry_level=-96,
                    assets={"impulseResponse": "room-ir"},
                )
            ]
        )
        with self.assertRaises(effetune.AssetError) as caught:
            chain.stream(48_000, channels=1)
        self.assertIsNone(caught.exception.code)
        self.assertIsNone(caught.exception.path)
        self.assertIsNone(caught.exception.node_id)

    def test_empty_graph_is_a_detached_zero_latency_identity_stream(self) -> None:
        source = next(entry for entry in _FIXTURE["valid"] if entry["name"] == "empty-identity")["document"]
        graph = effetune.Graph(source)
        detached = graph.to_dict()
        detached["input"]["id"] = "changed"
        self.assertEqual(graph.to_dict()["input"]["id"], "input")
        with graph.stream(48_000, channels=2) as stream:
            audio = np.asarray([[1, 2], [3, 4]], dtype=np.float32)
            output = stream.process(audio)
            np.testing.assert_array_equal(output, audio)
            self.assertIsNot(output, audio)
            self.assertEqual(stream.latency_samples, 0)
            self.assertTrue(stream.compile_snapshot["identity"])

    def test_pan_presence_is_rejected_for_mono_stream(self) -> None:
        entry = next(
            item for item in _FIXTURE["invalid"] if item["name"] == "pan-on-mono-stream"
        )
        graph = effetune.Graph(deepcopy(entry["document"]))
        with self.assertRaises(effetune.ValidationError) as caught:
            graph.stream(48_000, channels=entry["streamChannels"])
        self.assertEqual(caught.exception.code, entry["code"])
        self.assertEqual(caught.exception.path, entry["path"])


if __name__ == "__main__":
    unittest.main()
