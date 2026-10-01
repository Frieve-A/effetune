"""Rewrite an exported float-threshold tree model in place in its compact shipped encoding.

Thresholds become uint8 indices into per-feature sorted borders (`index8`) when every feature has
at most 256 distinct thresholds; this is exact. `--int16-leaves` stores float leaves as int16
with one scale per (tree, output), a lossy step that must be accepted by evaluating the model.
"""

import argparse
import hashlib
from itertools import cycle
import json
from pathlib import Path
import struct

from embed_models import ELEMENTS, model_layout, read_model, unpack_array


def float32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def compact_model(manifest_path, int16_leaves):
    _, manifest, arrays, data = read_model(manifest_path)
    if manifest["thresholdType"] != "float":
        raise ValueError("The model is already compact")
    values = {array[0]: unpack_array(data, array) for array in arrays}
    constants = manifest["constants"]
    thresholds = values["thresholds"]

    feature_borders = [set() for _ in range(constants["FeatureCount"])]
    for feature, threshold in zip(values["features"], thresholds):
        feature_borders[feature].add(threshold)
    if max(map(len, feature_borders)) <= 256:
        borders, offsets, index_of = [], [], []
        for feature_set in feature_borders:
            offsets.append(len(borders))
            ordered = sorted(feature_set)
            index_of.append({value: index for index, value in enumerate(ordered)})
            borders.extend(ordered)
        values["thresholds"] = [index_of[feature][threshold]
                                for feature, threshold in zip(values["features"], thresholds)]
        values["borders"], values["border_offsets"] = borders, offsets
        manifest["thresholdType"], manifest["borderCount"] = "index8", len(borders)

    if int16_leaves:
        if manifest["leafType"] != "float":
            raise ValueError("int16 leaves are made from float leaves")
        outputs = manifest["outputCount"]
        leaves_per_tree = (1 << constants["Depth"]) * outputs
        quantized, scales = [], []
        for tree in range(constants["TreeCount"]):
            tree_leaves = values["leaves"][tree * leaves_per_tree:(tree + 1) * leaves_per_tree]
            # Round each scale to binary32 first so the encoding matches the stored value.
            tree_scales = [float32(max(map(abs, tree_leaves[output::outputs])) / 32767.0)
                           for output in range(outputs)]
            quantized.extend(round(value / scale) if scale else 0
                             for value, scale in zip(tree_leaves, cycle(tree_scales)))
            scales.extend(tree_scales)
        values["leaves"], values["leaf_scales"] = quantized, scales
        manifest["leafType"] = "int16"

    binary = bytearray()
    for suffix, element, count, offset, size in model_layout(manifest):
        binary.extend(bytes(offset - len(binary)))
        binary.extend(struct.pack(f"<{count}{ELEMENTS[element][1]}", *values[suffix]))
    manifest["sha256"] = hashlib.sha256(binary).hexdigest()
    manifest_path.with_suffix(".bin").write_bytes(binary)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8",
                             newline="\n")
    read_model(manifest_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--int16-leaves", action="store_true")
    arguments = parser.parse_args()
    compact_model(arguments.manifest, arguments.int16_leaves)
