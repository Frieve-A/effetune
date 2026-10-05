"""Rewrite an exported float-threshold tree model in place in its compact shipped encoding.

Float thresholds become uint8 indices into per-feature sorted borders (`index8`) when every feature
has at most 256 distinct thresholds; this is exact. `--oblivious` stores a heap tree whose every
level shares one split as an oblivious tree with one split per level; this is exact and requires
index8 thresholds. `--leaves int16|int8` stores float leaves as integers with one scale per
(tree, output), a lossy step that must be accepted by evaluating the model.
"""

import argparse
import hashlib
from itertools import cycle
import json
from pathlib import Path
import struct

from embed_models import (ELEMENTS, INTEGER_LEAF_LIMITS, is_oblivious, model_layout, read_model,
                          unpack_array)


def float32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def compact_model(manifest_path, oblivious=False, leaves=None):
    _, manifest, arrays, data = read_model(manifest_path)
    # Reject layouts read_model cannot load before anything is overwritten.
    to_oblivious, leaf_type = oblivious or is_oblivious(manifest), leaves or manifest["leafType"]
    if to_oblivious and leaf_type not in INTEGER_LEAF_LIMITS:
        raise ValueError("Oblivious trees need int8 or int16 leaves (pass --leaves)")
    if leaf_type == "int8" and not to_oblivious:
        raise ValueError("int8 leaves need the oblivious layout (pass --oblivious)")
    values = {array[0]: unpack_array(data, array) for array in arrays}
    constants = manifest["constants"]
    trees, depth = constants["TreeCount"], constants["Depth"]

    if manifest["thresholdType"] == "float":
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

    if oblivious and not is_oblivious(manifest):
        if manifest["thresholdType"] != "index8":
            raise ValueError("Oblivious trees need index8 thresholds")
        # Heap level l holds the oblivious split depth - 1 - l, so the leaf order is unchanged.
        internal = (1 << depth) - 1
        pairs = list(zip(values["features"], values["thresholds"]))
        splits = [pairs[tree * internal:(tree + 1) * internal] for tree in range(trees)]
        if any(len(set(tree_splits[(1 << level) - 1:(2 << level) - 1])) != 1
               for tree_splits in splits for level in range(depth)):
            raise ValueError("Every level of an oblivious tree must share one split (not symmetric)")
        collapsed = [tree_splits[(1 << (depth - 1 - split)) - 1]
                     for tree_splits in splits for split in range(depth)]
        values["features"] = [feature for feature, _ in collapsed]
        values["thresholds"] = [threshold for _, threshold in collapsed]
        manifest = {"formatVersion": manifest.pop("formatVersion"), "layout": "oblivious",
                    **manifest}

    if leaves:
        if manifest["leafType"] != "float":
            raise ValueError("Integer leaves are made from float leaves")
        limit = INTEGER_LEAF_LIMITS[leaves]
        outputs = manifest["outputCount"]
        leaves_per_tree = (1 << depth) * outputs
        quantized, scales = [], []
        for tree in range(trees):
            tree_leaves = values["leaves"][tree * leaves_per_tree:(tree + 1) * leaves_per_tree]
            # Round each scale to binary32 first so the encoding matches the stored value.
            tree_scales = [float32(max(map(abs, tree_leaves[output::outputs])) / limit)
                           for output in range(outputs)]
            quantized.extend(round(value / scale) if scale else 0
                             for value, scale in zip(tree_leaves, cycle(tree_scales)))
            scales.extend(tree_scales)
        values["leaves"], values["leaf_scales"] = quantized, scales
        manifest["leafType"] = leaves

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
    parser.add_argument("--oblivious", action="store_true")
    parser.add_argument("--leaves", choices=tuple(INTEGER_LEAF_LIMITS))
    arguments = parser.parse_args()
    compact_model(arguments.manifest, arguments.oblivious, arguments.leaves)
