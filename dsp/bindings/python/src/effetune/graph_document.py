"""Canonical Graph v1 document validation, queries, and recipe builders."""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from copy import deepcopy
import json
import math
from typing import Any

from ._base import Effect
from .errors import AssetError, EffectError, ValidationError, validation_detail
from .validation import validate_chain_document

_ROOT_KEYS = frozenset({"version", "input", "output", "nodes", "edges"})
_EDGE_KEYS = frozenset(
    {"id", "source", "destination", "gain", "mute", "pan", "mixGroup", "solo"}
)


def _error(
    message: str,
    *,
    code: str,
    path: str = "",
    node_id: str | None = None,
    edge_id: str | None = None,
) -> ValidationError:
    return ValidationError(
        message, code=code, path=path, node_id=node_id, edge_id=edge_id
    )


def _id(value: Any, path: str) -> str:
    valid_scalars = isinstance(value, str) and not any(
        0xD800 <= ord(character) <= 0xDFFF for character in value
    )
    if not valid_scalars or not value or len(value) > 128:
        raise _error(
            "Graph IDs must contain between 1 and 128 Unicode scalar values.",
            code="GRAPH_DOCUMENT_ID",
            path=path,
        )
    return value


def _endpoint(value: Any, path: str) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise _error(
            "Graph endpoints must be objects.",
            code="GRAPH_DOCUMENT_REFERENCE",
            path=path,
        )
    unknown = set(value) - {"id"}
    if unknown:
        key = min(unknown)
        raise _error(
            f"Graph endpoint has an unsupported field: {key}",
            code="GRAPH_DOCUMENT_REFERENCE",
            path=f"{path}/{key}",
        )
    return {"id": _id(value.get("id"), f"{path}/id")}


def _node_error(error: Exception, path: str, node_id: str) -> Exception:
    """Classify a Chain validation failure as the Graph node field that caused it.

    The thrown class is preserved so the Chain and Graph entry points report the same
    category for the same mistake.
    """
    detail = validation_detail(error) or {}
    kind = detail.get("kind") or ("assets" if isinstance(error, AssetError) else None)
    code = "GRAPH_DOCUMENT_REFERENCE"
    suffix = ""
    if kind == "channel":
        code = "GRAPH_DOCUMENT_CHANNEL"
        suffix = "/channel"
    elif kind == "parameter":
        parameter = detail.get("parameter")
        code = "GRAPH_DOCUMENT_PARAMETER"
        suffix = "" if parameter is None else f"/parameters/{parameter}"
    elif kind == "type":
        suffix = "/type"
    elif kind == "assets":
        suffix = "/assets"
    if isinstance(error, AssetError):
        error_type: type[Exception] = AssetError
    elif isinstance(error, EffectError):
        error_type = EffectError
    else:
        error_type = ValidationError
    return error_type(
        str(error), code=code, path=f"{path}{suffix}", node_id=node_id
    )


def _node(value: Any, index: int) -> dict[str, Any]:
    path = f"/nodes/{index}"
    if not isinstance(value, Mapping):
        raise _error(
            f"Graph node {index} must be an object.",
            code="GRAPH_DOCUMENT_REFERENCE",
            path=path,
        )
    node_id = _id(value.get("id"), f"{path}/id")
    try:
        effect = validate_chain_document(
            {"version": 1, "chain": [dict(value)]},
            entry_label=f"Graph node {node_id}",
        )[0]
    except (ValidationError, EffectError, AssetError) as error:
        raise _node_error(error, path, node_id) from error
    return effect.to_dict()


def _finite(
    value: Any,
    minimum: float,
    maximum: float,
    label: str,
    path: str,
    edge_id: str,
) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < minimum
        or value > maximum
    ):
        raise _error(
            f"{label} must be a finite number from {minimum:g} to {maximum:g}.",
            code="GRAPH_DOCUMENT_EDGE_CONTROL",
            path=path,
            edge_id=edge_id,
        )
    return float(value)


def _edge(value: Any, index: int) -> dict[str, Any]:
    path = f"/edges/{index}"
    if not isinstance(value, Mapping):
        raise _error(
            f"Graph edge {index} must be an object.",
            code="GRAPH_DOCUMENT_REFERENCE",
            path=path,
        )
    unknown = set(value) - _EDGE_KEYS
    if unknown:
        key = min(unknown)
        raise _error(
            f"Graph edge {index} has an unsupported field: {key}",
            code="GRAPH_DOCUMENT_EDGE_CONTROL",
            path=f"{path}/{key}",
        )
    edge_id = _id(value.get("id"), f"{path}/id")
    source = _id(value.get("source"), f"{path}/source")
    destination = _id(value.get("destination"), f"{path}/destination")
    gain = _finite(value.get("gain", 1), 0, 4, "Edge gain", f"{path}/gain", edge_id)
    mute = value.get("mute", False)
    solo = value.get("solo", False)
    if not isinstance(mute, bool):
        raise _error(
            "Edge mute must be boolean.",
            code="GRAPH_DOCUMENT_EDGE_CONTROL",
            path=f"{path}/mute",
            edge_id=edge_id,
        )
    if not isinstance(solo, bool):
        raise _error(
            "Edge solo must be boolean.",
            code="GRAPH_DOCUMENT_EDGE_CONTROL",
            path=f"{path}/solo",
            edge_id=edge_id,
        )
    mix_group = value.get("mixGroup", "default")
    valid_mix_group = isinstance(mix_group, str) and not any(
        0xD800 <= ord(character) <= 0xDFFF for character in mix_group
    )
    if not valid_mix_group or not mix_group or len(mix_group) > 128:
        raise _error(
            "Edge mixGroup must contain between 1 and 128 Unicode scalar values.",
            code="GRAPH_DOCUMENT_EDGE_CONTROL",
            path=f"{path}/mixGroup",
            edge_id=edge_id,
        )
    result: dict[str, Any] = {
        "id": edge_id,
        "source": source,
        "destination": destination,
        "gain": gain,
        "mute": mute,
        "mixGroup": mix_group,
        "solo": solo,
    }
    if "pan" in value:
        result["pan"] = _finite(
            value["pan"], -1, 1, "Edge pan", f"{path}/pan", edge_id
        )
    return result


def _validate_ids(
    input_endpoint: Mapping[str, str],
    output_endpoint: Mapping[str, str],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    node_indexes: Mapping[str, int],
    edge_indexes: Mapping[str, int],
) -> None:
    seen: set[str] = set()

    def add(value: str, path: str) -> None:
        if value in seen:
            raise _error(
                f"Duplicate Graph id: {value}",
                code="GRAPH_DOCUMENT_ID",
                path=path,
            )
        seen.add(value)

    add(input_endpoint["id"], "/input/id")
    add(output_endpoint["id"], "/output/id")
    for node in nodes:
        add(node["id"], f"/nodes/{node_indexes[node['id']]}/id")
    for edge in edges:
        add(edge["id"], f"/edges/{edge_indexes[edge['id']]}/id")


def _structure(
    input_endpoint: Mapping[str, str],
    output_endpoint: Mapping[str, str],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    node_indexes: Mapping[str, int],
    edge_indexes: Mapping[str, int],
) -> tuple[list[str], dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    input_id = input_endpoint["id"]
    output_id = output_endpoint["id"]
    node_ids = {node["id"] for node in nodes}
    targets = {input_id, output_id, *node_ids}
    incoming_count = {node_id: 0 for node_id in node_ids}
    outgoing_nodes = {node_id: [] for node_id in node_ids}
    incoming: dict[str, list[dict[str, Any]]] = {target: [] for target in targets}
    outgoing: dict[str, list[dict[str, Any]]] = {target: [] for target in targets}

    for edge in edges:
        path = f"/edges/{edge_indexes[edge['id']]}"
        if edge["source"] not in targets or edge["destination"] not in targets:
            field = "source" if edge["source"] not in targets else "destination"
            raise _error(
                f"Graph edge {edge['id']} references an unknown endpoint.",
                code="GRAPH_DOCUMENT_REFERENCE",
                path=f"{path}/{field}",
                edge_id=edge["id"],
            )
        if edge["source"] == output_id or edge["destination"] == input_id:
            field = "source" if edge["source"] == output_id else "destination"
            raise _error(
                "The main input is source-only and the main output is destination-only.",
                code="GRAPH_DOCUMENT_REFERENCE",
                path=f"{path}/{field}",
                edge_id=edge["id"],
            )
        outgoing[edge["source"]].append(edge)
        incoming[edge["destination"]].append(edge)
        if edge["source"] in node_ids and edge["destination"] in node_ids:
            outgoing_nodes[edge["source"]].append(edge["destination"])
            incoming_count[edge["destination"]] += 1

    visit_state = {node_id: 0 for node_id in node_ids}

    def visit(node_id: str) -> None:
        visit_state[node_id] = 1
        for edge in outgoing[node_id]:
            destination = edge["destination"]
            if destination not in node_ids:
                continue
            if visit_state[destination] == 1:
                raise _error(
                    "Graph nodes and edges must form an acyclic graph.",
                    code="GRAPH_DOCUMENT_CYCLE",
                    path=f"/edges/{edge_indexes[edge['id']]}",
                    edge_id=edge["id"],
                )
            if visit_state[destination] == 0:
                visit(destination)
        visit_state[node_id] = 2

    for node in nodes:
        if visit_state[node["id"]] == 0:
            visit(node["id"])

    ready = sorted(node_id for node_id, count in incoming_count.items() if count == 0)
    order: list[str] = []
    while ready:
        node_id = ready.pop(0)
        order.append(node_id)
        for destination in sorted(outgoing_nodes[node_id]):
            incoming_count[destination] -= 1
            if incoming_count[destination] == 0:
                ready.append(destination)
                ready.sort()
    if len(order) != len(nodes):
        raise RuntimeError("internal Graph topological ordering failure")

    if nodes or edges:
        forward = {input_id}
        queue = deque([input_id])
        while queue:
            for edge in outgoing[queue.popleft()]:
                if edge["destination"] not in forward:
                    forward.add(edge["destination"])
                    queue.append(edge["destination"])
        backward = {output_id}
        queue.append(output_id)
        while queue:
            for edge in incoming[queue.popleft()]:
                if edge["source"] not in backward:
                    backward.add(edge["source"])
                    queue.append(edge["source"])
        disconnected_node = next(
            (
                node
                for node in nodes
                if node["id"] not in forward or node["id"] not in backward
            ),
            None,
        )
        if disconnected_node is not None:
            raise _error(
                f"Graph node {disconnected_node['id']} is not on a main input-output path.",
                code="GRAPH_DOCUMENT_CONNECTIVITY",
                path=f"/nodes/{node_indexes[disconnected_node['id']]}",
                node_id=disconnected_node["id"],
            )
        disconnected_edge = next(
            (
                edge
                for edge in edges
                if edge["source"] not in forward
                or edge["destination"] not in backward
            ),
            None,
        )
        if disconnected_edge is not None:
            raise _error(
                f"Graph edge {disconnected_edge['id']} is not on a main input-output path.",
                code="GRAPH_DOCUMENT_CONNECTIVITY",
                path=f"/edges/{edge_indexes[disconnected_edge['id']]}",
                edge_id=disconnected_edge["id"],
            )
        if output_id not in forward:
            raise _error(
                "Graph does not connect the main input to the main output.",
                code="GRAPH_DOCUMENT_CONNECTIVITY",
            )
    return order, incoming, outgoing


def normalize_graph_input(source: Any) -> dict[str, Any]:
    """Validate a Graph v1 source and preserve indexes for native diagnostics."""
    if isinstance(source, str):
        try:
            source = json.loads(source)
        except (TypeError, json.JSONDecodeError) as error:
            raise _error(
                "Graph input is not valid JSON.", code="GRAPH_DOCUMENT_REFERENCE"
            ) from error
    if not isinstance(source, Mapping):
        raise _error(
            "A Graph must be a version 1 Graph document.",
            code="GRAPH_DOCUMENT_REFERENCE",
        )
    unknown = set(source) - _ROOT_KEYS
    if unknown:
        key = min(unknown)
        raise _error(
            f"Unsupported Graph document field: {key}",
            code="GRAPH_DOCUMENT_REFERENCE",
            path=f"/{key}",
        )
    if isinstance(source.get("version"), bool) or source.get("version") != 1:
        raise _error(
            "Only Graph document version 1 is supported.",
            code="GRAPH_DOCUMENT_REFERENCE",
            path="/version",
        )
    if not isinstance(source.get("nodes"), list) or not isinstance(
        source.get("edges"), list
    ):
        raise _error(
            "Graph document nodes and edges must be arrays.",
            code="GRAPH_DOCUMENT_REFERENCE",
        )
    input_endpoint = _endpoint(source.get("input"), "/input")
    output_endpoint = _endpoint(source.get("output"), "/output")
    original_nodes = [_node(node, index) for index, node in enumerate(source["nodes"])]
    original_edges = [_edge(edge, index) for index, edge in enumerate(source["edges"])]
    node_indexes = {node["id"]: index for index, node in enumerate(original_nodes)}
    edge_indexes = {edge["id"]: index for index, edge in enumerate(original_edges)}
    _validate_ids(
        input_endpoint,
        output_endpoint,
        original_nodes,
        original_edges,
        node_indexes,
        edge_indexes,
    )
    order, incoming, outgoing = _structure(
        input_endpoint,
        output_endpoint,
        original_nodes,
        original_edges,
        node_indexes,
        edge_indexes,
    )
    document = {
        "version": 1,
        "input": input_endpoint,
        "output": output_endpoint,
        "nodes": sorted(original_nodes, key=lambda node: node["id"].encode("utf-8")),
        "edges": sorted(original_edges, key=lambda edge: edge["id"].encode("utf-8")),
    }
    return {
        "document": document,
        "original_node_indexes": node_indexes,
        "original_edge_indexes": edge_indexes,
        "structural_order": order,
        "incoming": incoming,
        "outgoing": outgoing,
    }


def normalize_graph_document(source: Any) -> dict[str, Any]:
    return deepcopy(normalize_graph_input(source)["document"])


def structural_snapshot(source: Any) -> dict[str, Any]:
    state = source if isinstance(source, Mapping) and "document" in source else normalize_graph_input(source)
    document = state["document"]
    ids = [document["input"]["id"], *(node["id"] for node in document["nodes"]), document["output"]["id"]]
    return {
        "document": deepcopy(document),
        "topologicalOrder": list(state["structural_order"]),
        "incoming": {
            node_id: sorted(edge["id"] for edge in state["incoming"].get(node_id, ()))
            for node_id in ids
        },
        "outgoing": {
            node_id: sorted(edge["id"] for edge in state["outgoing"].get(node_id, ()))
            for node_id in ids
        },
    }


def visualization_snapshot(
    source: Any, compile_snapshot: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    state = source if isinstance(source, Mapping) and "document" in source else normalize_graph_input(source)
    document = state["document"]
    compiled_nodes = {
        node["id"]: node for node in (compile_snapshot or {}).get("nodes", ())
    }
    compiled_edges = {
        edge["id"]: edge for edge in (compile_snapshot or {}).get("edges", ())
    }

    def visualization_node(node: Mapping[str, Any]) -> dict[str, Any]:
        compiled = compiled_nodes.get(node["id"])
        result = {
            "id": node["id"],
            "kind": "effect",
            "effectType": node["type"],
            "enabled": node["enabled"],
        }
        if compiled is not None:
            result.update(
                effective=compiled["effective"],
                dormant=compiled["dormant"],
                disabledBypass=compiled["disabledBypass"],
            )
        if compiled is not None and compiled["disabledBypass"]:
            result["state"] = "disabled-bypass"
        elif compiled is not None and compiled["effective"]:
            result["state"] = "effective"
        elif compiled is not None and compiled["dormant"]:
            result["state"] = "dormant"
        else:
            result["state"] = "structural" if node["enabled"] else "disabled-bypass"
        return result

    def visualization_edge(edge: Mapping[str, Any]) -> dict[str, Any]:
        compiled = compiled_edges.get(edge["id"])
        result = {
            "id": edge["id"],
            "source": edge["source"],
            "destination": edge["destination"],
        }
        if compiled is not None:
            result.update(
                active=compiled["active"],
                suppressed=compiled["suppressed"],
                dormant=compiled["dormant"],
            )
        if compiled is not None and compiled["suppressed"]:
            result["state"] = "suppressed"
        elif compiled is not None and compiled["dormant"]:
            result["state"] = "dormant"
        elif compiled is not None and compiled["active"]:
            result["state"] = "effective"
        else:
            result["state"] = "structural"
        return result

    return {
        "version": 1,
        "nodes": [
            {"id": document["input"]["id"], "kind": "input"},
            *(visualization_node(node) for node in document["nodes"]),
            {"id": document["output"]["id"], "kind": "output"},
        ],
        "edges": [visualization_edge(edge) for edge in document["edges"]],
    }


def _available_id(preferred: str, used: set[str]) -> str:
    result = preferred
    suffix = 2
    while result in used:
        result = f"{preferred}-{suffix}"
        suffix += 1
    used.add(result)
    return result


def graph_document_from_chain(source: Any) -> dict[str, Any]:
    if hasattr(source, "to_dict"):
        source = source.to_dict()
    effects = validate_chain_document(source)
    nodes = [effect.to_dict() for effect in effects]
    used_ids = {node["id"] for node in nodes if "id" in node}
    counters: dict[str, int] = {}
    for node in nodes:
        if "id" in node:
            continue
        count = counters.get(node["type"], 0)
        while True:
            count += 1
            candidate = f"{node['type']}#{count}"
            if candidate not in used_ids:
                break
        counters[node["type"]] = count
        used_ids.add(candidate)
        node["id"] = candidate
    for index, node in enumerate(nodes):
        if (
            node["enabled"]
            and node["type"] == "IRReverb"
            and node["parameters"]["latency"] > 0
            and node["parameters"]["dryLevel"] > -96
        ):
            raise _error(
                "IRReverb must be wet-only in a Graph; set dryLevel to -96 dB "
                "(the parameter minimum) and use the external dry edge.",
                code="GRAPH_UNSUPPORTED_CAPABILITY",
                path=f"/nodes/{index}/parameters/dryLevel",
                node_id=node["id"],
            )
    used = {node["id"] for node in nodes}
    input_id = _available_id("main-input", used)
    output_id = _available_id("main-output", used)
    edges: list[dict[str, Any]] = []
    previous = input_id
    for index, node in enumerate(nodes, 1):
        edges.append(
            {
                "id": _available_id(f"route-{index}", used),
                "source": previous,
                "destination": node["id"],
            }
        )
        previous = node["id"]
    if nodes:
        edges.append(
            {
                "id": _available_id(f"route-{len(nodes) + 1}", used),
                "source": previous,
                "destination": output_id,
            }
        )
    return normalize_graph_document(
        {
            "version": 1,
            "input": {"id": input_id},
            "output": {"id": output_id},
            "nodes": nodes,
            "edges": edges,
        }
    )


def chain_document_from_graph(source: Any) -> dict[str, Any]:
    state = source if isinstance(source, Mapping) and "document" in source else normalize_graph_input(source)
    document = state["document"]

    def identity_edge(edge: Mapping[str, Any]) -> bool:
        return (
            edge["gain"] == 1
            and not edge["mute"]
            and not edge["solo"]
            and edge["mixGroup"] == "default"
            and edge.get("pan", 0) == 0
        )

    if not all(identity_edge(edge) for edge in document["edges"]):
        raise _error(
            "Only a serial Graph with identity edge controls can be converted to a Chain.",
            code="GRAPH_DOCUMENT_CONNECTIVITY",
            path="/edges",
        )
    if not document["nodes"] and not document["edges"]:
        return {"version": 1, "chain": []}
    by_source: dict[str, Mapping[str, Any]] = {}
    for edge in document["edges"]:
        if edge["source"] in by_source:
            raise _error(
                "Only a serial Graph can be converted to a Chain.",
                code="GRAPH_DOCUMENT_CONNECTIVITY",
                path=f"/edges/{state['original_edge_indexes'][edge['id']]}",
                edge_id=edge["id"],
            )
        by_source[edge["source"]] = edge
    nodes = {node["id"]: node for node in document["nodes"]}
    chain: list[dict[str, Any]] = []
    visited: set[str] = set()
    source_id = document["input"]["id"]
    while source_id != document["output"]["id"]:
        edge = by_source.get(source_id)
        if edge is None or edge["id"] in visited:
            raise _error(
                "Only a serial Graph can be converted to a Chain.",
                code="GRAPH_DOCUMENT_CONNECTIVITY",
            )
        visited.add(edge["id"])
        if edge["destination"] == document["output"]["id"]:
            source_id = document["output"]["id"]
            break
        node = nodes.get(edge["destination"])
        if node is None:
            raise _error(
                "Only a serial Graph can be converted to a Chain.",
                code="GRAPH_DOCUMENT_CONNECTIVITY",
            )
        chain.append(deepcopy(node))
        source_id = node["id"]
    if len(visited) != len(document["edges"]) or len(chain) != len(document["nodes"]):
        raise _error(
            "Only a serial Graph can be converted to a Chain.",
            code="GRAPH_DOCUMENT_CONNECTIVITY",
        )
    return {"version": 1, "chain": chain}


def _recipe_effect(
    effect: Effect | Mapping[str, Any], node_id: str | None, default_id: str
) -> dict[str, Any]:
    if isinstance(effect, Effect):
        value = effect.to_dict()
    elif isinstance(effect, Mapping):
        value = deepcopy(dict(effect))
    else:
        raise _error(
            "A Graph recipe effect must be an Effect or effect document.",
            code="GRAPH_DOCUMENT_REFERENCE",
            path="/nodes/0",
        )
    # Presence, not truthiness: an explicit empty id is a caller mistake that _id() reports as
    # GRAPH_DOCUMENT_ID, exactly as a hand-written document would.
    if node_id is not None:
        value["id"] = node_id
    elif value.get("id") is None:
        value["id"] = default_id
    return value


def _require_wet_only_ir_reverb(node: Mapping[str, Any]) -> None:
    """Every Graph recipe rejects a positive-latency IRReverb that still mixes its own dry
    signal, because the Graph plans delay compensation around a wet-only node."""
    parameters = node.get("parameters", {})
    if (
        node["enabled"]
        and node.get("type") == "IRReverb"
        and parameters.get("latency", 0) > 0
        and parameters.get("dryLevel", 0) > -96
    ):
        raise _error(
            "IRReverb must be wet-only in a Graph; set dryLevel to -96 dB "
            "(the parameter minimum) and use the external dry edge.",
            code="GRAPH_UNSUPPORTED_CAPABILITY",
            path="/nodes/0/parameters/dryLevel",
            node_id=node.get("id"),
        )


def wet_dry_graph_document(
    effect: Effect | Mapping[str, Any],
    *,
    wet: float = 1,
    dry: float = 1,
    node_id: str | None = None,
    input_id: str = "input",
    output_id: str = "output",
) -> dict[str, Any]:
    node = _node(_recipe_effect(effect, node_id, "wet"), 0)
    _require_wet_only_ir_reverb(node)
    used = {input_id, output_id, node["id"]}
    dry_id = _available_id("dry", used)
    wet_input_id = _available_id("wet-input", used)
    wet_output_id = _available_id("wet-output", used)
    return normalize_graph_document(
        {
            "version": 1,
            "input": {"id": input_id},
            "output": {"id": output_id},
            "nodes": [node],
            "edges": [
                {"id": dry_id, "source": input_id, "destination": output_id, "gain": dry, "mixGroup": "main"},
                {"id": wet_input_id, "source": input_id, "destination": node["id"]},
                {"id": wet_output_id, "source": node["id"], "destination": output_id, "gain": wet, "mixGroup": "main"},
            ],
        }
    )


def send_return_graph_document(
    effect: Effect | Mapping[str, Any],
    *,
    send: float = 1,
    return_gain: float = 1,
    node_id: str | None = None,
    input_id: str = "input",
    output_id: str = "output",
) -> dict[str, Any]:
    node = _node(_recipe_effect(effect, node_id, "return"), 0)
    _require_wet_only_ir_reverb(node)
    used = {input_id, output_id, node["id"]}
    main_id = _available_id("main", used)
    send_id = _available_id("send", used)
    return_id = _available_id("return", used)
    return normalize_graph_document(
        {
            "version": 1,
            "input": {"id": input_id},
            "output": {"id": output_id},
            "nodes": [node],
            "edges": [
                {"id": main_id, "source": input_id, "destination": output_id, "mixGroup": "main"},
                {"id": send_id, "source": input_id, "destination": node["id"], "gain": send},
                {"id": return_id, "source": node["id"], "destination": output_id, "gain": return_gain, "mixGroup": "main"},
            ],
        }
    )


__all__ = [
    "chain_document_from_graph",
    "graph_document_from_chain",
    "normalize_graph_document",
    "normalize_graph_input",
    "send_return_graph_document",
    "structural_snapshot",
    "visualization_snapshot",
    "wet_dry_graph_document",
]
