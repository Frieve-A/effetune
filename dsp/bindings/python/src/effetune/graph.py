"""Immutable Graph v1 documents and stateful native Graph streams."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
import json
import struct
from typing import Any

import numpy as np

from ._base import Effect
from .assets import AssetData, AssetResolver, resolve_asset, resolve_rate_divider, resolve_topology
from .chain import Chain, _effect_channels, _native_effect_channel
from .errors import AssetError, EffeTuneRuntimeError, StateError, ValidationError
from .graph_document import (
    chain_document_from_graph,
    graph_document_from_chain,
    normalize_graph_input,
    send_return_graph_document,
    structural_snapshot,
    visualization_snapshot,
    wet_dry_graph_document,
)
from ._generated_graph_contract import GRAPH_V1_CAPACITY
from .validation import (
    effect_metadata,
    pack_parameter_bytes,
    pack_parameters,
    validate_audio,
    validate_block_size,
    validate_parameters,
    validate_positive_integer,
    validate_sample_rate,
    validate_seed,
)

_GRAPH_MAGIC = 0x31475445
_SNAPSHOT_MAGIC = 0x31535445
_ENDPOINT = 0xFFFFFFFF
_UNASSIGNED_SLOT = 0xFFFFFFFF
_STREAM_SAFE_PARAMETERS = {"Volume": frozenset({"volume"})}


def _channel_spec(channel: str) -> int:
    if channel == "all":
        return -2
    if channel == "stereo":
        return -1
    if channel in {"left", "1"}:
        return 0
    if channel in {"right", "2"}:
        return 1
    if len(channel) == 1 and "3" <= channel <= "8":
        return int(channel) - 1
    return {"34": 17, "56": 18, "78": 19}[channel]


def _effective_node_ids(document: Mapping[str, Any]) -> set[str]:
    solo_groups = {
        (edge["destination"], edge["mixGroup"])
        for edge in document["edges"]
        if edge["solo"]
    }
    active = [
        edge
        for edge in document["edges"]
        if not edge["mute"]
        and (
            (edge["destination"], edge["mixGroup"]) not in solo_groups
            or edge["solo"]
        )
    ]
    incoming: dict[str, list[Mapping[str, Any]]] = {}
    for edge in active:
        incoming.setdefault(edge["destination"], []).append(edge)
    node_ids = {node["id"] for node in document["nodes"]}
    result: set[str] = set()
    visited = {document["output"]["id"]}
    queue = [document["output"]["id"]]
    while queue:
        for edge in incoming.get(queue.pop(0), ()):
            if edge["source"] in node_ids:
                result.add(edge["source"])
            if edge["source"] not in visited:
                visited.add(edge["source"])
                queue.append(edge["source"])
    return result


def _encode_graph_descriptor(
    document: Mapping[str, Any],
    instance_tokens: Mapping[str, int],
    asset_node_ids: set[str],
) -> np.ndarray:
    strings = bytearray()

    def add_string(value: str) -> tuple[int, int]:
        encoded = value.encode("utf-8")
        offset = len(strings)
        strings.extend(encoded)
        return offset, len(encoded)

    node_strings = [add_string(node["id"]) for node in document["nodes"]]
    edge_strings = [
        (add_string(edge["id"]), add_string(edge["mixGroup"]))
        for edge in document["edges"]
    ]
    descriptor = bytearray(
        32 + len(document["nodes"]) * 24 + len(document["edges"]) * 40 + len(strings)
    )
    struct.pack_into(
        "<8I",
        descriptor,
        0,
        _GRAPH_MAGIC,
        1,
        len(document["nodes"]),
        len(document["edges"]),
        len(strings),
        0,
        0,
        0,
    )
    indexes = {node["id"]: index for index, node in enumerate(document["nodes"])}
    edge_offset = 32 + len(document["nodes"]) * 24
    for index, node in enumerate(document["nodes"]):
        flags = 0
        if node["enabled"]:
            flags = 1
            if node["id"] in asset_node_ids:
                flags |= 2
            if node["type"] != "IRReverb" or node["parameters"]["dryLevel"] <= -96:
                flags |= 4
        string_offset, string_length = node_strings[index]
        struct.pack_into(
            "<4IiI",
            descriptor,
            32 + index * 24,
            instance_tokens.get(node["id"], 0),
            string_offset,
            string_length,
            flags,
            _channel_spec(node["channel"]),
            0,
        )
    for index, edge in enumerate(document["edges"]):
        (id_offset, id_length), (mix_offset, mix_length) = edge_strings[index]
        flags = (1 if edge["mute"] else 0) | (2 if edge["solo"] else 0)
        if "pan" in edge:
            flags |= 4
        struct.pack_into(
            "<6I2f2I",
            descriptor,
            edge_offset + index * 40,
            _ENDPOINT if edge["source"] == document["input"]["id"] else indexes[edge["source"]],
            _ENDPOINT if edge["destination"] == document["output"]["id"] else indexes[edge["destination"]],
            id_offset,
            id_length,
            mix_offset,
            mix_length,
            edge["gain"],
            edge.get("pan", 0),
            flags,
            0,
        )
    string_offset = edge_offset + len(document["edges"]) * 40
    descriptor[string_offset:] = strings
    return np.ascontiguousarray(np.frombuffer(descriptor, dtype=np.uint8))


def _vector(data: memoryview, offset: int, channels: int) -> list[int]:
    return list(struct.unpack_from(f"<{channels}I", data, offset))


def _decode_snapshot(raw: bytes, document: Mapping[str, Any]) -> dict[str, Any]:
    data = memoryview(raw)
    if len(data) < 128:
        raise EffeTuneRuntimeError("native DSP returned an invalid Graph compile snapshot")
    header = struct.unpack_from("<16I", data, 0)
    if header[0] != _SNAPSHOT_MAGIC or header[1] != 1:
        raise EffeTuneRuntimeError("native DSP returned an unsupported Graph compile snapshot")
    node_count, edge_count, schedule_count, channels = header[2:6]
    node_bytes, edge_bytes = header[10:12]
    schedule_offset, nodes_offset, edges_offset, total_bytes = header[12:16]
    if (
        node_count != len(document["nodes"])
        or edge_count != len(document["edges"])
        or channels < 1
        or channels > 8
        or node_bytes != 128
        or edge_bytes != 48
        or total_bytes != len(data)
    ):
        raise EffeTuneRuntimeError("native DSP returned an inconsistent Graph compile snapshot")
    schedule_indexes = struct.unpack_from(f"<{schedule_count}I", data, schedule_offset)
    nodes = []
    for index, node in enumerate(document["nodes"]):
        offset = nodes_offset + index * node_bytes
        flags, schedule_index, buffer_slot, _instance, first_channel, channel_count, kernel_latency = struct.unpack_from(
            "<7I", data, offset
        )
        nodes.append(
            {
                "id": node["id"],
                "effective": bool(flags & 1),
                "dormant": bool(flags & 2),
                "enabled": bool(flags & 4),
                "disabledBypass": bool(flags & 8),
                "scheduleIndex": (
                    None if schedule_index == _UNASSIGNED_SLOT else schedule_index
                ),
                "bufferSlot": None if buffer_slot == _UNASSIGNED_SLOT else buffer_slot,
                "processingGroup": {
                    "firstChannel": first_channel,
                    "channelCount": channel_count,
                },
                "kernelLatency": kernel_latency,
                "inputLatency": _vector(data, offset + 32, channels),
                "outputLatency": _vector(data, offset + 64, channels),
                "preNodeCompensation": _vector(data, offset + 96, channels),
            }
        )
    edges = []
    for index, edge in enumerate(document["edges"]):
        offset = edges_offset + index * edge_bytes
        flags = struct.unpack_from("<I", data, offset)[0]
        edges.append(
            {
                "id": edge["id"],
                "active": bool(flags & 1),
                "suppressed": bool(flags & 2),
                "dormant": bool(flags & 4),
                "fanInCompensation": _vector(data, offset + 16, channels),
            }
        )
    return {
        "version": 1,
        "identity": bool(header[9] & 1),
        "silence": bool(header[9] & 2),
        "effectiveSchedule": [document["nodes"][index]["id"] for index in schedule_indexes],
        "nodes": nodes,
        "edges": edges,
        "outputLatency": _vector(data, 64, channels),
        "outputCompensation": _vector(data, 96, channels),
        "latencySamples": header[7],
        "capacity": {"bufferSlots": header[6], "workspaceBytes": header[8]},
    }


_STATUS_CODES = {
    -9: "GRAPH_DOCUMENT_CYCLE",
    -10: "GRAPH_DOCUMENT_CONNECTIVITY",
    -11: "GRAPH_CAPACITY",
    -14: "GRAPH_INSTANCE_PREPARE",
    -12: "GRAPH_LATENCY_OVERFLOW",
    -13: "GRAPH_UNSUPPORTED_CAPABILITY",
    -3: "GRAPH_PLAN_MEMORY",
}
_NODE_PATHS = {2: "/id", 3: "", 4: "/assets", 5: "", 6: "/channel"}
_EDGE_PATHS = {7: "/id", 8: "/source", 9: "/destination", 10: "/gain", 11: "/pan", 12: ""}


def _invalid_graph_code(native_path: int) -> str:
    if native_path in (2, 7):
        return "GRAPH_DOCUMENT_ID"
    if native_path == 6:
        return "GRAPH_DOCUMENT_CHANNEL"
    if native_path in (1, 8, 9):
        return "GRAPH_DOCUMENT_REFERENCE"
    if native_path in (10, 11, 12):
        return "GRAPH_DOCUMENT_EDGE_CONTROL"
    if native_path in (3, 4):
        return "GRAPH_INSTANCE_PREPARE"
    if native_path == 5:
        return "GRAPH_UNSUPPORTED_CAPABILITY"
    if native_path == 15:
        return "GRAPH_CAPACITY"
    if native_path in (16, 18):
        return "GRAPH_LATENCY_OVERFLOW"
    if native_path == 17:
        return "GRAPH_PLAN_MEMORY"
    return "GRAPH_DOCUMENT_REFERENCE"


def _compile_error(
    status: int, diagnostic: tuple[int, ...], state: Mapping[str, Any]
) -> EffeTuneRuntimeError | ValidationError:
    _native_status, kind, index, native_path, _required, _capacity = diagnostic
    code = _invalid_graph_code(native_path) if status == -8 else _STATUS_CODES.get(status, "GRAPH_PLAN_MEMORY")
    path = ""
    node_id = None
    edge_id = None
    node_type = None
    if kind == 1 and index < len(state["document"]["nodes"]):
        node = state["document"]["nodes"][index]
        node_id = node["id"]
        node_type = node["type"]
        original = state["original_node_indexes"][node_id]
        path = f"/nodes/{original}{_NODE_PATHS.get(native_path, '')}"
        if code == "GRAPH_UNSUPPORTED_CAPABILITY" and node["type"] == "IRReverb":
            path = f"/nodes/{original}/parameters/dryLevel"
    elif kind == 2 and index < len(state["document"]["edges"]):
        edge = state["document"]["edges"][index]
        edge_id = edge["id"]
        original = state["original_edge_indexes"][edge_id]
        path = f"/edges/{original}{_EDGE_PATHS.get(native_path, '')}"
        if native_path == 12 and edge["mixGroup"] == "":
            path += "/mixGroup"
    unsupported = code == "GRAPH_UNSUPPORTED_CAPABILITY"
    error_type = (
        ValidationError
        if code.startswith("GRAPH_DOCUMENT_") or unsupported
        else EffeTuneRuntimeError
    )
    message = "the native DSP Graph could not be prepared"
    if unsupported:
        message = (
            "IRReverb must be wet-only in a Graph; set dryLevel to -96 dB "
            "(the parameter minimum) and use the external dry edge."
            if node_type == "IRReverb"
            else "the native DSP Graph requires a capability this build does not support"
        )
    return error_type(
        message,
        code=code,
        path=path,
        node_id=node_id,
        edge_id=edge_id,
    )


def _prepare_asset(native: Any, native_index: int, effect: Effect, asset: AssetData, sample_rate: float, effect_channels: int) -> None:
    if effect.effect_type == "IRReverb":
        topology = resolve_topology(asset, effect_channels, effect.parameters["channelMode"])
        divider = resolve_rate_divider(asset.sample_rate, sample_rate, effect.parameters["convolutionRate"])
        head_block = int(effect.parameters["latency"])
    elif effect.effect_type == "FIRCrossover":
        band_count = int(effect.parameters["bandCount"])
        expected_paths = tuple(
            (input_slot, band * 2 + input_slot, band)
            for band in range(band_count)
            for input_slot in range(2)
        )
        if asset.topology == "automatic":
            asset = AssetData(
                asset.samples,
                asset.sample_rate,
                kind=asset.kind,
                topology="matrix",
                paths=expected_paths,
                input_count=2,
            )
        topology = resolve_topology(asset, effect_channels, "matrix")
        divider = 1
        head_block = int(effect.parameters["latencyMode"])
        actual_paths = tuple(
            (path.input_slot, path.output_slot, path.ir_channel)
            for path in asset.paths
        )
        if (
            effect_channels not in (4, 6, 8)
            or asset.samples.shape[0] != band_count
            or band_count * 2 > effect_channels
            or asset.input_count != 2
            or actual_paths != expected_paths
        ):
            raise AssetError(
                f"{effect.id or effect.effect_type} requires 4, 6, or 8 "
                "processing channels and one matrix filter channel per band"
            )
    else:
        topology = resolve_topology(asset, effect_channels, "mono")
        divider = 1
        head_block = int(effect.parameters["latencyMode"])
    if divider == 1 and abs(asset.sample_rate - sample_rate) >= 0.5:
        raise AssetError(
            f"{effect.id or effect.effect_type} requires filter coefficients "
            "at the processing sample rate"
        )
    paths = np.asarray(
        [(path.input_slot, path.output_slot, path.ir_channel) for path in asset.paths],
        dtype=np.uint32,
    ).reshape((-1, 3))
    native.set_ir(
        native_index,
        asset.samples,
        int(asset.sample_rate),
        topology,
        head_block,
        divider,
        paths,
        int(asset.input_count or 0),
        effect_channels,
    )


class GraphStream:
    """A stateful, statically compiled Graph processing context."""

    def __init__(
        self,
        graph: "Graph",
        *,
        sample_rate: float,
        channels: int,
        block_size: int,
        seed: int,
        asset_resolver: AssetResolver | None,
    ) -> None:
        self.sample_rate = validate_sample_rate(sample_rate)
        self.channels = validate_positive_integer(channels, "channels")
        if self.channels > 8:
            raise ValidationError("channels must be at most 8")
        self.block_size = validate_block_size(block_size)
        self.seed = validate_seed(seed)
        self._closed = False
        self._native: Any | None = None
        self._state = deepcopy(graph._state)
        self._initial_document = deepcopy(self._state["document"])
        self._native_nodes: dict[str, tuple[int, Effect, np.ndarray, np.ndarray | None, int]] = {}

        for edge in self._state["document"]["edges"]:
            if "pan" in edge and self.channels != 2:
                raise ValidationError(
                    "Edge pan is supported only for stereo Graph streams.",
                    code="GRAPH_DOCUMENT_CHANNEL",
                    path=f"/edges/{self._state['original_edge_indexes'][edge['id']]}/pan",
                    edge_id=edge["id"],
                )
        document = self._state["document"]
        maximum_nodes = GRAPH_V1_CAPACITY["maxStructuralNodes"]
        if len(document["nodes"]) > maximum_nodes:
            node = next(
                item
                for item in document["nodes"]
                if self._state["original_node_indexes"][item["id"]] == maximum_nodes
            )
            raise EffeTuneRuntimeError(
                "the native DSP Graph exceeds the structural node capacity "
                f"({maximum_nodes})",
                code="GRAPH_CAPACITY",
                path=f"/nodes/{maximum_nodes}",
                node_id=node["id"],
            )
        maximum_edges = GRAPH_V1_CAPACITY["maxEdges"]
        if len(document["edges"]) > maximum_edges:
            edge = next(
                item
                for item in document["edges"]
                if self._state["original_edge_indexes"][item["id"]] == maximum_edges
            )
            raise EffeTuneRuntimeError(
                f"the native DSP Graph exceeds the edge capacity ({maximum_edges})",
                code="GRAPH_CAPACITY",
                path=f"/edges/{maximum_edges}",
                edge_id=edge["id"],
            )
        effective = _effective_node_ids(self._state["document"])
        effective_nodes = [
            node
            for node in self._state["document"]["nodes"]
            if node["enabled"] and node["id"] in effective
        ]
        maximum_instances = GRAPH_V1_CAPACITY["maxEffectiveInstances"]
        if len(effective_nodes) > maximum_instances:
            node = effective_nodes[maximum_instances]
            raise EffeTuneRuntimeError(
                "the native DSP Graph exceeds the effective instance capacity",
                code="GRAPH_CAPACITY",
                path=f"/nodes/{self._state['original_node_indexes'][node['id']]}",
                node_id=node["id"],
            )
        for node in self._state["document"]["nodes"]:
            try:
                _effect_channels(node["channel"], self.channels)
            except ValidationError as error:
                raise ValidationError(
                    str(error),
                    code="GRAPH_DOCUMENT_CHANNEL",
                    path=(
                        f"/nodes/{self._state['original_node_indexes'][node['id']]}"
                        "/channel"
                    ),
                    node_id=node["id"],
                ) from error
        for node in effective_nodes:
            rates = effect_metadata(node["type"]).get("sampleRates")
            if rates and self.sample_rate not in rates:
                raise ValidationError(
                    f"{node['type']} does not support a sample rate of "
                    f"{self.sample_rate:g} Hz"
                )
        if not self._state["document"]["nodes"] and not self._state["document"]["edges"]:
            self._compile_snapshot = {
                "version": 1,
                "identity": True,
                "silence": False,
                "effectiveSchedule": [],
                "nodes": [],
                "edges": [],
                "outputLatency": [0] * self.channels,
                "outputCompensation": [0] * self.channels,
                "latencySamples": 0,
                "capacity": {"bufferSlots": 0, "workspaceBytes": 0},
            }
            return
        try:
            from ._native import _NativeChain

            native = _NativeChain(self.sample_rate, self.channels, max(32, self.block_size))
            tokens: dict[str, int] = {}
            asset_nodes: set[str] = set()
            resolver = asset_resolver if asset_resolver is not None else graph.asset_resolver
            for node in self._state["document"]["nodes"]:
                effect = Effect(
                    node["type"],
                    parameters=node["parameters"],
                    id=node["id"],
                    enabled=node["enabled"],
                    channel=node["channel"],
                    assets=node.get("assets"),
                )
                if not effect.enabled or effect.id not in effective:
                    continue
                packed, layout_hash, internal_type = pack_parameters(effect)
                packed_bytes = pack_parameter_bytes(effect)
                native_index = native.add_effect(
                    internal_type,
                    packed,
                    layout_hash,
                    self.seed,
                    _native_effect_channel(effect.channel, self.channels),
                )
                tokens[effect.id] = native_index + 1
                if packed_bytes is not None:
                    native.set_effect_parameter_bytes(native_index, packed_bytes, layout_hash)
                if effect.assets:
                    asset_nodes.add(effect.id)
                    reference = next(iter(effect.assets.values()))
                    original = self._state["original_node_indexes"][effect.id]
                    # Resolution and preparation are one step from the caller's point of view, so
                    # both report the node whose asset could not be made ready.
                    try:
                        asset = resolve_asset(reference, resolver, effect.id)
                        _prepare_asset(
                            native,
                            native_index,
                            effect,
                            asset,
                            self.sample_rate,
                            _effect_channels(effect.channel, self.channels),
                        )
                    except AssetError as error:
                        raise AssetError(
                            str(error),
                            code="GRAPH_INSTANCE_PREPARE",
                            path=f"/nodes/{original}/assets",
                            node_id=effect.id,
                        ) from error
                    except Exception as error:
                        raise EffeTuneRuntimeError(
                            f"{effect.id} asset could not be prepared",
                            code="GRAPH_INSTANCE_PREPARE",
                            path=f"/nodes/{original}/assets",
                            node_id=effect.id,
                        ) from error
                self._native_nodes[effect.id] = (
                    native_index,
                    effect,
                    packed.copy(),
                    packed_bytes.copy() if packed_bytes is not None else None,
                    layout_hash,
                )
            descriptor = _encode_graph_descriptor(self._state["document"], tokens, asset_nodes)
            try:
                status = int(native.finish_graph(descriptor))
            except Exception as error:
                node_id = next(
                    (
                        node["id"]
                        for node in self._state["document"]["nodes"]
                        if node["id"] in asset_nodes
                    ),
                    None,
                )
                original = (
                    self._state["original_node_indexes"].get(node_id)
                    if node_id is not None
                    else None
                )
                raise EffeTuneRuntimeError(
                    "the native DSP Graph instances could not be prepared",
                    code="GRAPH_INSTANCE_PREPARE",
                    path=(f"/nodes/{original}/assets" if original is not None else ""),
                    node_id=node_id,
                ) from error
            if status != 0:
                raise _compile_error(status, tuple(native.graph_diagnostic()), self._state)
            self._compile_snapshot = _decode_snapshot(native.graph_snapshot(), self._state["document"])
            self._native = native
        except (AssetError, EffeTuneRuntimeError, ValidationError):
            raise
        except Exception as error:
            raise EffeTuneRuntimeError("the native DSP Graph could not be prepared") from error

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def graph(self) -> dict[str, Any]:
        self._assert_open()
        return deepcopy(self._state["document"])

    @property
    def latency_samples(self) -> int:
        self._assert_open()
        return 0 if self._native is None else int(self._native.graph_latency_samples())

    @property
    def compile_snapshot(self) -> dict[str, Any]:
        self._assert_open()
        return deepcopy(self._compile_snapshot)

    def visualization_snapshot(self) -> dict[str, Any]:
        self._assert_open()
        return visualization_snapshot(self._state, self._compile_snapshot)

    def _assert_open(self) -> None:
        if self._closed:
            raise StateError("cannot use a closed Graph stream")

    def set_param(self, node_id: str, parameter_name: str, value: Any) -> "GraphStream":
        self._assert_open()
        node_index = next(
            (
                index
                for index, node in enumerate(self._state["document"]["nodes"])
                if node["id"] == node_id
            ),
            None,
        )
        if node_index is None:
            raise ValidationError(
                f"unknown Graph node: {node_id}",
                code="GRAPH_DOCUMENT_REFERENCE",
                path="",
                node_id=node_id,
            )
        record = self._native_nodes.get(node_id)
        if record is None:
            # Enabling a node only helps when its edges already reach the main output, so a
            # dormant node keeps the routing wording even when it is also disabled.
            enabled = self._state["document"]["nodes"][node_index]["enabled"]
            dormant = next(
                (
                    node["dormant"]
                    for node in self._compile_snapshot["nodes"]
                    if node["id"] == node_id
                ),
                False,
            )
            raise ValidationError(
                f"Graph node {node_id} is disabled and bypassed; enable it and create a new stream"
                if not enabled and not dormant
                else f"Graph node {node_id} is not effective; create a new stream to change it",
                code="GRAPH_RECONFIGURATION_REQUIRED",
                path=f"/nodes/{self._state['original_node_indexes'][node_id]}",
                node_id=node_id,
            )
        native_index, effect, _packed, _bytes, _hash = record
        parameters = dict(effect.parameters)
        parameters[parameter_name] = value
        try:
            validated = validate_parameters(effect.effect_type, parameters)
        except ValidationError as error:
            raise ValidationError(
                str(error),
                code="GRAPH_DOCUMENT_PARAMETER",
                path=(
                    f"/nodes/{self._state['original_node_indexes'][node_id]}"
                    f"/parameters/{parameter_name}"
                ),
                node_id=node_id,
            ) from error
        if effect.effect_type == "IRReverb" and parameter_name == "dryLevel":
            if not (
                effect.parameters["latency"] == 0
                or (
                    effect.parameters["dryLevel"] <= -96
                    and validated["dryLevel"] <= -96
                )
            ):
                self._raise_reconfiguration(effect, parameter_name)
            changed_index = 4
        elif parameter_name not in _STREAM_SAFE_PARAMETERS.get(effect.effect_type, ()):
            self._raise_reconfiguration(effect, parameter_name)
        else:
            changed_index = 0
        updated = Effect(
            effect.effect_type,
            parameters=validated,
            id=effect.id,
            enabled=effect.enabled,
            channel=effect.channel,
            assets=effect.assets,
        )
        packed, layout_hash, _internal = pack_parameters(updated)
        packed_bytes = pack_parameter_bytes(updated)
        status = self._native.set_graph_instance_parameters(
            native_index, packed, layout_hash, changed_index
        )
        if status != 0:
            self._raise_reconfiguration(effect, parameter_name)
        self._native_nodes[node_id] = (native_index, updated, packed, packed_bytes, layout_hash)
        self._state["document"]["nodes"][node_index] = updated.to_dict()
        return self

    def _raise_reconfiguration(self, effect: Effect, parameter_name: str) -> None:
        index = self._state["original_node_indexes"][effect.id]
        raise ValidationError(
            f"{effect.effect_type}.{parameter_name} cannot be updated while a Graph stream is open; create a new stream",
            code="GRAPH_RECONFIGURATION_REQUIRED",
            path=f"/nodes/{index}/parameters/{parameter_name}",
            node_id=effect.id,
        )

    def process(self, audio: np.ndarray) -> np.ndarray:
        self._assert_open()
        source = validate_audio(audio, channels=self.channels)
        output = source.copy(order="C")
        if self._native is None:
            return output
        for start in range(0, source.shape[1], self.block_size):
            end = min(start + self.block_size, source.shape[1])
            block = source[:, start:end].copy(order="C")
            self._native.process_graph_in_place(block)
            output[:, start:end] = block
        return output

    def reset(self) -> "GraphStream":
        self._assert_open()
        if self._native is not None:
            self._native.reset()
            restored: dict[
                str, tuple[int, Effect, np.ndarray, np.ndarray | None, int]
            ] = {}
            initial_by_id = {
                node["id"]: node for node in self._initial_document["nodes"]
            }
            for node_id, (
                native_index,
                _effect,
                _packed,
                _packed_bytes,
                _layout_hash,
            ) in self._native_nodes.items():
                node = initial_by_id[node_id]
                effect = Effect(
                    node["type"],
                    parameters=node["parameters"],
                    id=node_id,
                    enabled=node["enabled"],
                    channel=node["channel"],
                    assets=node.get("assets"),
                )
                packed, layout_hash, _internal = pack_parameters(effect)
                packed_bytes = pack_parameter_bytes(effect)
                restored[node_id] = (
                    native_index,
                    effect,
                    packed,
                    packed_bytes,
                    layout_hash,
                )
            self._native_nodes = restored
        self._state["document"] = deepcopy(self._initial_document)
        return self

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._native is not None:
            self._native.close()
            self._native = None

    def __enter__(self) -> "GraphStream":
        self._assert_open()
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()


class Graph:
    """A canonical immutable Graph v1 document."""

    def __init__(self, document: Any, *, asset_resolver: AssetResolver | None = None) -> None:
        self._state = normalize_graph_input(document)
        self.asset_resolver = asset_resolver
        self._closed = False

    @classmethod
    def from_dict(cls, document: Mapping[str, Any], *, asset_resolver: AssetResolver | None = None) -> "Graph":
        return cls(document, asset_resolver=asset_resolver)

    @classmethod
    def load(cls, source: str, *, asset_resolver: AssetResolver | None = None) -> "Graph":
        return cls(source, asset_resolver=asset_resolver)

    @classmethod
    def from_chain(cls, chain: Chain, *, asset_resolver: AssetResolver | None = None) -> "Graph":
        return cls(
            graph_document_from_chain(chain),
            asset_resolver=asset_resolver if asset_resolver is not None else chain.asset_resolver,
        )

    @classmethod
    def wet_dry(
        cls,
        effect: Effect | Mapping[str, Any],
        *,
        wet: float = 1.0,
        dry: float = 1.0,
        node_id: str | None = None,
        input_id: str = "input",
        output_id: str = "output",
        asset_resolver: AssetResolver | None = None,
    ) -> "Graph":
        return cls(
            wet_dry_graph_document(
                effect,
                wet=wet,
                dry=dry,
                node_id=node_id,
                input_id=input_id,
                output_id=output_id,
            ),
            asset_resolver=asset_resolver,
        )

    @classmethod
    def send_return(
        cls,
        effect: Effect | Mapping[str, Any],
        *,
        send: float = 1.0,
        return_gain: float = 1.0,
        node_id: str | None = None,
        input_id: str = "input",
        output_id: str = "output",
        asset_resolver: AssetResolver | None = None,
    ) -> "Graph":
        return cls(
            send_return_graph_document(
                effect,
                send=send,
                return_gain=return_gain,
                node_id=node_id,
                input_id=input_id,
                output_id=output_id,
            ),
            asset_resolver=asset_resolver,
        )

    def _assert_open(self) -> None:
        if self._closed:
            raise StateError("cannot use a closed Graph")

    def to_dict(self) -> dict[str, Any]:
        self._assert_open()
        return deepcopy(self._state["document"])

    def serialize(self, *, indent: int | None = None) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def to_chain(self) -> Chain:
        self._assert_open()
        document = chain_document_from_graph(self._state)
        effects = [
            Effect(
                node["type"],
                parameters=node["parameters"],
                id=node["id"],
                enabled=node["enabled"],
                channel=node["channel"],
                assets=node.get("assets"),
            )
            for node in document["chain"]
        ]
        return Chain(effects, asset_resolver=self.asset_resolver)

    @property
    def nodes(self) -> tuple[dict[str, Any], ...]:
        return tuple(self.to_dict()["nodes"])

    @property
    def edges(self) -> tuple[dict[str, Any], ...]:
        return tuple(self.to_dict()["edges"])

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        self._assert_open()
        node = next((node for node in self._state["document"]["nodes"] if node["id"] == node_id), None)
        return deepcopy(node)

    def get_edge(self, edge_id: str) -> dict[str, Any] | None:
        self._assert_open()
        edge = next((edge for edge in self._state["document"]["edges"] if edge["id"] == edge_id), None)
        return deepcopy(edge)

    def incoming(self, endpoint_id: str) -> tuple[dict[str, Any], ...]:
        self._assert_open()
        return tuple(deepcopy(self._state["incoming"].get(endpoint_id, ())))

    def outgoing(self, endpoint_id: str) -> tuple[dict[str, Any], ...]:
        self._assert_open()
        return tuple(deepcopy(self._state["outgoing"].get(endpoint_id, ())))

    def structural_snapshot(self) -> dict[str, Any]:
        self._assert_open()
        return structural_snapshot(self._state)

    def visualization_snapshot(self) -> dict[str, Any]:
        self._assert_open()
        return visualization_snapshot(self._state)

    def stream(
        self,
        sample_rate: float,
        *,
        channels: int,
        block_size: int = 128,
        seed: int = 0,
        asset_resolver: AssetResolver | None = None,
    ) -> GraphStream:
        self._assert_open()
        return GraphStream(
            self,
            sample_rate=sample_rate,
            channels=channels,
            block_size=block_size,
            seed=seed,
            asset_resolver=asset_resolver,
        )

    def latency_samples(self, sample_rate: float, *, channels: int = 2, block_size: int = 128, asset_resolver: AssetResolver | None = None) -> int:
        with self.stream(
            sample_rate,
            channels=channels,
            block_size=block_size,
            asset_resolver=asset_resolver,
        ) as stream:
            return stream.latency_samples

    def process(
        self,
        audio: np.ndarray,
        *,
        sample_rate: float,
        seed: int = 0,
        block_size: int = 128,
        asset_resolver: AssetResolver | None = None,
    ) -> np.ndarray:
        source = validate_audio(audio)
        with self.stream(
            sample_rate,
            channels=source.shape[0],
            block_size=block_size,
            seed=seed,
            asset_resolver=asset_resolver,
        ) as stream:
            return stream.process(source)

    def close(self) -> None:
        self._closed = True


__all__ = ["Graph", "GraphStream"]
