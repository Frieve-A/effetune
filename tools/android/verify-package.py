"""Inspect the actual Android candidate; uses the installed SDK and pinned bundletool."""
import argparse
import os
from pathlib import Path
import struct
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("apk", type=Path)
parser.add_argument("--sdk", type=Path, default=os.environ.get("ANDROID_HOME"))
parser.add_argument("--bundle", type=Path)
parser.add_argument("--bundletool", type=Path)
args = parser.parse_args()
if not args.sdk:
    parser.error("Set ANDROID_HOME or --sdk")
build_tools = args.sdk / "build-tools" / "36.0.0"
java = str(Path(os.environ["JAVA_HOME"]) / "bin" / ("java.exe" if os.name == "nt" else "java"))
subprocess.run([str(build_tools / ("zipalign.exe" if os.name == "nt" else "zipalign")),
                "-c", "-P", "16", "4", str(args.apk)], check=True)
subprocess.run([java, "-jar", str(build_tools / "lib" / "apksigner.jar"),
                "verify", "--verbose", str(args.apk)], check=True)
libraries = []
with zipfile.ZipFile(args.apk) as package, args.apk.open("rb") as raw:
    required_notices = {
        "libcxx-LICENSE.txt", "oboe-LICENSE.txt", "pffft-LICENSE.txt",
        "sonic-LICENSE.txt", "sonic-NOTICE.txt", "netty-LICENSE.txt", "netty-NOTICE.txt",
        *("netty/" + name for name in ["LICENSE.slf4j.txt", "LICENSE.webbit.txt",
          "LICENSE.libdivsufsort.txt", "LICENSE.jbzip2.txt", "LICENSE.jctools.txt",
          "LICENSE.base64.txt", "LICENSE.jsr166y.txt", "LICENSE.harmony.txt", "NOTICE.harmony.txt",
          "LICENSE.jfastlz.txt", "LICENSE.protobuf.txt", "LICENSE.utf8-validator.txt"]),
    }
    for notice in required_notices:
        assert package.read("assets/licenses/" + notice).strip(), notice
    for entry in package.infolist():
        if not entry.filename.startswith("lib/") or not entry.filename.endswith(".so"):
            continue
        data = package.read(entry)
        assert data[:6] == b"\x7fELF\x02\x01", entry.filename
        offset = struct.unpack_from("<Q", data, 32)[0]
        size, count = struct.unpack_from("<HH", data, 54)
        loads = [struct.unpack_from("<Q", data, offset + index * size + 48)[0]
                 for index in range(count) if struct.unpack_from("<I", data, offset + index * size)[0] == 1]
        assert loads and all(value >= 16384 for value in loads), entry.filename
        raw.seek(entry.header_offset + 26)
        name_length, extra_length = struct.unpack("<HH", raw.read(4))
        assert entry.compress_type == zipfile.ZIP_STORED, entry.filename
        assert (entry.header_offset + 30 + name_length + extra_length) % 16384 == 0, entry.filename
        libraries.append(entry.filename)
    assert {name.split("/")[1] for name in libraries} == {"arm64-v8a", "x86_64"}
if args.bundle:
    if not args.bundletool:
        parser.error("--bundle requires --bundletool")
    with zipfile.ZipFile(args.bundle) as bundle, zipfile.ZipFile(args.apk) as package:
        for notice in required_notices:
            assert bundle.read("base/assets/licenses/" + notice) == package.read("assets/licenses/" + notice), notice
    subprocess.run([java, "-jar", str(args.bundletool), "validate", "--bundle=" + str(args.bundle)],
                   check=True, stdout=subprocess.DEVNULL)
print(f"Verified notices, signatures, ZIP and ELF 16 KiB alignment for {len(libraries)} libraries in {args.apk}.")
