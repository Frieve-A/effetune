"""Clean-install an abi3 wheel on the invoking newer CPython and render audio."""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import venv
from pathlib import Path


def _venv_python(root: Path) -> Path:
    return root / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel_directory", type=Path)
    arguments = parser.parse_args()
    if sys.version_info < (3, 13):
        raise RuntimeError("abi3 forward-compatibility must run on CPython 3.13 or newer")
    wheels = sorted(arguments.wheel_directory.glob("*-cp312-abi3-*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"expected one cp312-abi3 wheel, found {len(wheels)}")
    with tempfile.TemporaryDirectory(prefix="effetune-abi3-") as temporary:
        environment = Path(temporary)
        venv.EnvBuilder(with_pip=True).create(environment)
        python = _venv_python(environment)
        subprocess.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                str(wheels[0].resolve()),
            ],
            check=True,
        )
        subprocess.run(
            [
                str(python),
                "-c",
                (
                    "import importlib.metadata as m; import numpy as np; import effetune; "
                    "assert effetune.__version__ == m.version('effetune'); "
                    "source=np.ones((1, 64), dtype=np.float32); "
                    "output=effetune.Volume(volume=-6).process(source, sample_rate=48000); "
                    "assert output.shape == source.shape and np.isfinite(output).all(); "
                    "assert not np.array_equal(output, source)"
                ),
            ],
            check=True,
        )
    print(f"abi3 clean-install and render verified on CPython {sys.version_info.major}.{sys.version_info.minor}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
