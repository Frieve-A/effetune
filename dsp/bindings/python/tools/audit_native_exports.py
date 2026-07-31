"""Fail unless the installed private extension has only allowed exports."""

from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path


def _extension_path(supplied: Path | None) -> Path:
    if supplied is not None:
        return supplied.resolve()
    spec = importlib.util.find_spec("effetune._native")
    if spec is None or spec.origin is None:
        raise RuntimeError("the installed effetune._native extension was not found")
    return Path(spec.origin).resolve()


def _run(command: list[str]) -> str:
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"export inspection failed with exit code {result.returncode}: "
            f"{result.stderr.strip()}"
        )
    return result.stdout


def _windows_exports(extension: Path) -> set[str]:
    dumpbin = shutil.which("dumpbin")
    if dumpbin is None:
        vswhere = (
            Path(os.environ.get("ProgramFiles(x86)", ""))
            / "Microsoft Visual Studio"
            / "Installer"
            / "vswhere.exe"
        )
        if vswhere.is_file():
            matches = _run(
                [
                    str(vswhere),
                    "-latest",
                    "-products",
                    "*",
                    "-find",
                    r"VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe",
                ]
            ).splitlines()
            dumpbin = matches[0].strip() if matches else None
    if dumpbin is None:
        raise RuntimeError("dumpbin is required to audit Windows wheel exports")
    output = _run([dumpbin, "/nologo", "/exports", str(extension)])
    exports = set()
    for line in output.splitlines():
        match = re.match(
            r"\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)\s*$", line
        )
        if match:
            exports.add(match.group(1))
    return exports


def _unix_exports(extension: Path, system: str) -> set[str]:
    nm = shutil.which("nm")
    if nm is None:
        raise RuntimeError("nm is required to audit wheel exports")
    arguments = [nm, "-gU", str(extension)] if system == "Darwin" else [
        nm,
        "-D",
        "--defined-only",
        str(extension),
    ]
    output = _run(arguments)
    exports = {line.split()[-1] for line in output.splitlines() if line.split()}
    if system == "Darwin":
        exports = {name[1:] if name.startswith("_") else name for name in exports}
    return exports


def _allowed_windows_export(name: str) -> bool:
    return name == "PyInit__native" or (
        "@nanobind@@" in name
        and ("python_error@nanobind@@" in name or "builtin_exception@nanobind@@" in name)
    )


def audit(extension: Path) -> set[str]:
    system = platform.system()
    exports = (
        _windows_exports(extension)
        if system == "Windows"
        else _unix_exports(extension, system)
    )
    if "PyInit__native" not in exports:
        raise RuntimeError("PyInit__native is missing from the extension export table")
    unexpected = sorted(
        name
        for name in exports
        if not (_allowed_windows_export(name) if system == "Windows" else name == "PyInit__native")
    )
    if unexpected:
        raise RuntimeError(f"unexpected native exports: {', '.join(unexpected)}")
    return exports


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("extension", nargs="?", type=Path)
    arguments = parser.parse_args()
    exports = audit(_extension_path(arguments.extension))
    print(f"native export allowlist verified ({len(exports)} exports)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
