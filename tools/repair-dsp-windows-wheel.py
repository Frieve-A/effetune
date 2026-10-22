"""Repair a DSP wheel with the redistributable belonging to its actual compiler."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys
import zipfile

import pefile


def runtime_version(data: bytes) -> tuple[int, int, int, int]:
    with pefile.PE(data=data) as image:
        if image.FILE_HEADER.Machine != 0x8664:
            raise RuntimeError("The Windows AMD64 wheel requires an AMD64 runtime.")
        version = image.VS_FIXEDFILEINFO[0]
        return (
            version.FileVersionMS >> 16,
            version.FileVersionMS & 0xFFFF,
            version.FileVersionLS >> 16,
            version.FileVersionLS & 0xFFFF,
        )


def compiler_runtime(build: Path) -> tuple[Path, tuple[int, ...]]:
    metadata = list((build / "CMakeFiles").glob("*/CMakeCXXCompiler.cmake"))
    if len(metadata) != 1:
        raise RuntimeError(f"Expected one actual CMake compiler record in {build}.")
    text = metadata[0].read_text(encoding="utf-8-sig")
    compiler = re.search(r'set\(CMAKE_CXX_COMPILER "([^"]+)"\)', text)
    if compiler is None or not Path(compiler[1]).is_file():
        raise RuntimeError("The actual CMake C++ compiler is unavailable.")
    toolset = re.fullmatch(
        r"(.*[/\\]VC)[/\\]Tools[/\\]MSVC[/\\]([0-9]+\.[0-9]+\.[0-9]+)"
        r"[/\\]bin[/\\]Hostx64[/\\]x64[/\\]cl.exe",
        compiler[1],
        re.IGNORECASE,
    )
    if toolset is None:
        raise RuntimeError("Expected an AMD64 MSVC compiler in its Visual Studio toolset.")
    vc = Path(toolset[1])
    required = tuple(int(part) for part in toolset[2].split(".")) + (0,)
    redist = (vc / "Auxiliary/Build/Microsoft.VCRedistVersion.default.txt").read_text(
        encoding="utf-8-sig"
    ).strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", redist):
        raise RuntimeError("Visual Studio's default redistributable version is invalid.")
    choices = [
        directory
        for directory in (vc / "Redist/MSVC" / redist / "x64").glob("Microsoft.VC*.CRT")
        if (directory / "msvcp140.dll").is_file()
    ]
    if len(choices) != 1:
        raise RuntimeError("The actual compiler's AMD64 redistributable is unavailable.")
    if runtime_version((choices[0] / "msvcp140.dll").read_bytes()) < required:
        raise RuntimeError("Visual Studio's redistributable is older than the build toolset.")
    return choices[0], required


def verify_repaired(wheel: Path, runtime: Path, required: tuple[int, ...]) -> None:
    verified = []
    with zipfile.ZipFile(wheel) as archive:
        for name in archive.namelist():
            original = re.sub(r"-[0-9a-f]{32}(?=\.dll$)", "", Path(name).name.lower())
            if not original.endswith(".dll") or not original.startswith(
                ("msvcp", "msvcr", "vcruntime", "concrt", "vcomp", "vcamp", "vccorlib", "mfc")
            ):
                continue
            source = runtime / original
            if not source.is_file():
                raise RuntimeError(f"Bundled runtime {original} is not in the selected CRT.")
            actual = runtime_version(archive.read(name))
            if actual < required or actual != runtime_version(source.read_bytes()):
                raise RuntimeError(f"Bundled runtime {original} does not match the build toolset.")
            verified.append(original)
    if "msvcp140.dll" not in verified:
        raise RuntimeError("The repaired wheel does not contain the selected MSVCP runtime.")
    print(f"Verified compiler redistributable {runtime}: {', '.join(verified)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel", type=Path)
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    wheel = arguments.wheel.resolve(strict=True)
    tag = wheel.stem.rsplit("-", 3)[-3:]
    if wheel.suffix != ".whl" or len(tag) != 3 or tag[-1] != "win_amd64":
        raise RuntimeError("Expected a Windows AMD64 wheel.")
    root = Path(__file__).resolve().parent.parent
    runtime, required = compiler_runtime(root / "out/phase1-python/build" / "-".join(tag))
    destination = arguments.destination.resolve()
    subprocess.run(
        [
            sys.executable, "-m", "delvewheel", "repair",
            "--add-path", str(runtime), "--wheel-dir", str(destination), str(wheel),
        ],
        check=True,
    )
    verify_repaired(destination / wheel.name, runtime, required)


if __name__ == "__main__":
    main()
