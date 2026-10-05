"""Validate and embed the analyzers' immutable binary tree models."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct

# Element name -> (C++ type, little-endian struct code).
ELEMENTS = {
    "uint8": ("std::uint8_t", "B"), "index8": ("std::uint8_t", "B"),
    "uint32": ("std::uint32_t", "I"), "int16": ("std::int16_t", "h"),
    "int8": ("std::int8_t", "b"), "float": ("float", "f"), "double": ("double", "d"),
}


# Integer leaf type -> largest magnitude; the encoding is symmetric.
INTEGER_LEAF_LIMITS = {"int16": 32767, "int8": 127}


def is_oblivious(manifest):
    return manifest.get("layout") == "oblivious"


def model_layout(manifest):
    """Return (suffix, element, count, offset, size) for each array of the binary, in order.

    A heap tree stores 2^depth - 1 splits per tree; an oblivious tree stores one split per level.
    """
    constants = manifest["constants"]
    features, trees, depth = constants["FeatureCount"], constants["TreeCount"], constants["Depth"]
    splits = trees * (depth if is_oblivious(manifest) else (1 << depth) - 1)
    threshold_type, leaf_type = manifest["thresholdType"], manifest["leafType"]
    layout = [("features", "uint8", splits), ("thresholds", threshold_type, splits)]
    if threshold_type == "index8":
        layout += [("borders", "float", manifest["borderCount"]),
                   ("border_offsets", "uint32", features)]
    layout.append(("leaves", leaf_type, trees * (1 << depth) * manifest["outputCount"]))
    if leaf_type in INTEGER_LEAF_LIMITS:
        layout.append(("leaf_scales", "float", trees * manifest["outputCount"]))
    arrays = []
    offset = 0
    for suffix, element, count in layout:
        width = struct.calcsize(ELEMENTS[element][1])
        offset = (offset + width - 1) // width * width
        arrays.append((suffix, element, count, offset, count * width))
        offset += count * width
    return arrays


def unpack_array(data, array):
    _, element, count, offset, size = array
    return struct.unpack(f"<{count}{ELEMENTS[element][1]}", data[offset:offset + size])


def read_model(manifest_path):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    name = manifest_path.stem
    if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
        raise ValueError("Invalid model name")
    if manifest["formatVersion"] != 1:
        raise ValueError("Unsupported model format")
    constants = manifest["constants"]
    for key, value in constants.items():
        if not re.fullmatch(r"[A-Z][A-Za-z0-9]*", key) or not math.isfinite(value):
            raise ValueError("Invalid model constant")
    for key in ("FeatureCount", "TreeCount", "Depth"):
        if type(constants[key]) is not int or constants[key] <= 0:
            raise ValueError(f"Invalid {key}")
    if constants["FeatureCount"] > 256 or constants["Depth"] > 16:
        raise ValueError("Unsupported feature count or tree depth")
    if manifest["outputCount"] not in (1, 3, 4):
        raise ValueError("Unsupported output count")
    oblivious = is_oblivious(manifest)
    if "layout" in manifest and not oblivious:
        raise ValueError("Unsupported model layout")
    # The oblivious evaluator reads index8 thresholds and integer leaves only.
    threshold_types, leaf_types = ((("index8",), ("int8", "int16")) if oblivious else
                                   (("float", "index8"), ("float", "double", "int16")))
    if manifest["thresholdType"] not in threshold_types:
        raise ValueError("Unsupported threshold type")
    if manifest["leafType"] not in leaf_types:
        raise ValueError("Unsupported leaf type")
    if manifest["thresholdType"] == "index8" and (
            type(manifest["borderCount"]) is not int or manifest["borderCount"] < 0):
        raise ValueError("Invalid border count")
    arrays = model_layout(manifest)
    data = manifest_path.with_suffix(".bin").read_bytes()
    if len(data) != arrays[-1][3] + arrays[-1][4]:
        raise ValueError("Model byte count does not match its dimensions")
    if hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        raise ValueError("Model SHA-256 mismatch")
    values = {array[0]: unpack_array(data, array) for array in arrays}
    if max(values["features"]) >= constants["FeatureCount"]:
        raise ValueError("Model contains a forbidden feature split")
    for suffix, element, *_ in arrays:
        if element in ("float", "double") and not all(map(math.isfinite, values[suffix])):
            raise ValueError("Model contains a non-finite value")
    if manifest["thresholdType"] == "index8":
        starts = values["border_offsets"]
        ends = starts[1:] + (manifest["borderCount"],)
        borders = values["borders"]
        if starts[0] != 0 or any(start > end for start, end in zip(starts, ends)):
            raise ValueError("Invalid border offsets")
        if any(borders[i] >= borders[i + 1]
               for start, end in zip(starts, ends) for i in range(start, end - 1)):
            raise ValueError("Borders are not strictly increasing")
        if any(index >= ends[feature] - starts[feature]
               for feature, index in zip(values["features"], values["thresholds"])):
            raise ValueError("Model contains an out-of-range threshold index")
    limit = INTEGER_LEAF_LIMITS.get(manifest["leafType"])
    if limit is not None and (min(values["leaves"]) < -limit or min(values["leaf_scales"]) < 0.0):
        raise ValueError("Invalid integer leaf encoding")
    return name, manifest, arrays, data


def symbol(name, suffix):
    return f"et_tree_{name}_{suffix}"


def model_header(name, manifest, arrays):
    lines = [
        "// Generated by embed_models.py; do not edit.",
        "#pragma once",
        f'#include "{"oblivious" if is_oblivious(manifest) else "heap"}_tree_model.h"',
        "#include <bit>", "#include <limits>",
        "static_assert(std::endian::native == std::endian::little);",
        "static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);",
        "static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);",
        f"namespace effetune::plugins::analyzer::{name} {{",
    ]
    for key, value in manifest["constants"].items():
        kind = "std::uint32_t" if type(value) is int else "double"
        literal = f"{value}u" if type(value) is int else float(value).hex()
        lines.append(f"inline constexpr {kind} k{key} = {literal};")
    for suffix, element, count, _, _ in arrays:
        lines.append(f'extern "C" const {ELEMENTS[element][0]} {symbol(name, suffix)}[{count}];')
    present = {array[0] for array in arrays}
    pointers = [symbol(name, suffix) if suffix in present else "nullptr" for suffix in (
        "features", "thresholds", "leaves", "borders", "border_offsets", "leaf_scales")]
    leaf, threshold = (ELEMENTS[manifest[key]][0] for key in ("leafType", "thresholdType"))
    view = (f"ObliviousTreeModelView<{leaf}>" if is_oblivious(manifest)
            else f"BasicHeapTreeModelView<{leaf}, {threshold}>")
    lines.extend([
        f"inline constexpr {view} model() noexcept {{",
        "  return {kFeatureCount, kTreeCount, kDepth, kScale, kBias,",
        "          " + ", ".join(pointers) + "};",
        "}", "}", "",
    ])
    return "\n".join(lines)


def model_assembly(binary_path, name, arrays, target):
    # Each typed array is a separate aligned symbol; no runtime decoding or copying.
    path = binary_path.resolve().as_posix().replace('"', '\\"')
    lines = []
    for suffix, _, _, offset, size in arrays:
        label = symbol(name, suffix)
        if target == "macho":
            label = "_" + label
            lines.extend([".section __TEXT,__const", f".private_extern {label}"])
        else:
            section_type = "" if target == "wasm" else "progbits"
            flags = "a" if target == "elf" else ""
            lines.extend([f'.section .rodata.{label},"{flags}",@{section_type}',
                          f".hidden {label}", f".type {label},@object"])
        lines.extend([f".globl {label}", ".p2align 3", f"{label}:",
                      f'.incbin "{path}", {offset}, {size}'])
        if target != "macho":
            lines.append(f".size {label}, {size}")
    if target == "elf":
        lines.append('.section .note.GNU-stack,"",@progbits')
    return "\n".join(lines) + "\n"


def model_coff(name, arrays, data, machine):
    # MSVC has no .incbin. Emit a relocation-free COFF data object instead.
    # https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
    strings = bytearray()
    symbols = bytearray()
    for suffix, _, _, offset, _ in arrays:
        symbols.extend(struct.pack("<IIIhHBB", 0, 4 + len(strings), offset, 1, 0, 2, 0))
        strings.extend(symbol(name, suffix).encode("ascii") + b"\0")
    header = struct.pack("<HHIIIHH", machine, 1, 0, 60 + len(data), len(arrays), 0, 0)
    # One initialized, read-only section aligned to eight bytes; no relocations.
    section = struct.pack("<8sIIIIIIHHI", b".rdata", 0, 0, len(data), 60,
                          0, 0, 0, 0, 0x40400040)
    return header + section + data + symbols + struct.pack("<I", 4 + len(strings)) + strings


def embed_model(manifest_path, output_dir, target):
    name, manifest, arrays, data = read_model(manifest_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    header = output_dir / f"{name}.generated.h"
    header.write_text(model_header(name, manifest, arrays), encoding="utf-8", newline="\n")
    if target.startswith("coff-"):
        machine = {"coff-x64": 0x8664, "coff-arm64": 0xAA64}[target]
        (output_dir / f"{name}.obj").write_bytes(model_coff(name, arrays, data, machine))
    else:
        (output_dir / f"{name}.S").write_text(
            model_assembly(manifest_path.with_suffix(".bin"), name, arrays, target),
            encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--target", choices=("elf", "macho", "wasm", "coff-x64", "coff-arm64"),
                        required=True)
    arguments = parser.parse_args()
    embed_model(arguments.manifest, arguments.output_dir, arguments.target)
