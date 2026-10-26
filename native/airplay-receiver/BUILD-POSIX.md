# AirPlay receiver builds on Linux and macOS

Run the producer on the same operating system and architecture as the target:

```sh
npm run build:airplay-receiver -- --arch x64
# On an Apple silicon host:
npm run build:airplay-receiver -- --arch arm64
```

Supported slices are Linux x64, macOS x64, and macOS arm64. Cross-compilation is
not part of this producer. Native execution and loader/signature verification
must run on each available matching host; a Windows build does not validate
these slices.

## Build tools

Both platforms require Node.js 22.17 or newer with Zstandard support,
CMake 3.21+, Ninja, Meson, pkg-config, Python, Perl, Make, Flex, Bison, M4, and a native C/C++
compiler. Linux additionally requires `patchelf`, Debian/Ubuntu's `dpkg-query`
and APT tools, and the development packages for Avahi's DNS-SD compatibility
library and D-Bus (`libavahi-compat-libdnssd-dev`, `libdbus-1-dev`). Enable the
matching `deb-src` repositories before running the producer. Source packages
for the installed runtime versions must still be downloadable from those
repositories; the producer fails rather than substituting a different source
version.

An unprivileged validation host can supply `linuxSysroot` to
`buildPosixAirPlay` after extracting development/runtime `.deb` files with
`dpkg-deb -x`. Relocate only that sysroot's pkg-config prefixes, and provide
`origins.json` with a `libraries` array containing each extracted library's
absolute `path`, `binaryPackage`, `version`, `architecture`, `sourcePackage`,
and `sourceVersion`. The producer uses these exact origins for corresponding
source collection. `APT_CONFIG` may point at a task-local APT configuration
with private lists/cache and signed source repositories. Neither this route
nor the normal build installs system packages or manages a discovery service.
Keep build tools on `PATH`; a private Bison extraction also needs its
`BISON_PKGDATADIR` set to the extracted `usr/share/bison` directory.

macOS requires Xcode Command Line Tools, including `otool`,
`install_name_tool`, and `codesign`. Bonjour is supplied by macOS. Homebrew may
provide build tools, but no Homebrew framework or runtime library is accepted
as a packaged dependency. The deployment target is macOS 13, matching
[Electron 44's minimum supported macOS version](https://www.electronjs.org/blog/electron-44-0).

## Source and build inputs

`scripts/airplay/build-posix.mjs` builds a private prefix from the upstream
tarballs inside the checksum-locked source archives in
`dependencies.lock.json`. The MSYS2 archive is a transport for the exact
upstream source; this recipe does not apply its Windows patches on POSIX.
It builds libffi, PCRE2, zlib, GLib, OpenSSL 3, libplist, FFmpeg, GStreamer,
gst-plugins-base, gst-plugins-good, gst-plugins-bad, and gst-libav. macOS also
builds libiconv and gettext's runtime. Meson automatic features and network
fallbacks are disabled. Only the explicitly selected GStreamer plugins are
enabled and copied.

FFmpeg uses `lock.codec.configure`: AAC and ALAC decoding and the ALAC encoder
needed by the lossless package probe, with optional external codecs, programs,
network access, and automatic dependency detection disabled. gst-libav is
built against that exact private FFmpeg installation. No arbitrary installed
FFmpeg plugin is reused.

UxPlay uses the pinned source and common lifecycle diagnostic patch from the
main producer. The POSIX patch removes upstream pkg-config path overrides
that prefer a developer's Homebrew or GStreamer framework installation.
The build disables X11 dependencies and native-CPU specialization.

## Runtime closure and corresponding source

The producer writes `out/native/airplay-receiver/<platform>-<arch>/` with the
receiver, package probe, `lib/`, `plugins/`, empty `uxplay.conf`, runtime
manifest, notices, licenses, and `source/`.

On Linux, `ldd` identifies the actual private-library and Avahi/D-Bus client
closure. The loader and base glibc libraries remain system dependencies.
`patchelf` gives each copied ELF file an `$ORIGIN` path to the packaged
libraries. Each redistributed system library is mapped to its canonical dpkg
owner and exact source package/version using the existing provenance parsers.
APT downloads the corresponding `.dsc`, upstream source, and Debian patch
archives without installing packages. Every referenced source file's size and
SHA-256 are checked, and the package copyright notices are included.

On macOS, `otool` identifies dependencies. Apple system libraries remain OS
dependencies; every other dependency must come from the private build prefix.
`install_name_tool` rewrites copied dependencies to `@loader_path`, then an
ad-hoc signature permits native smoke checks. Electron Builder's existing
macOS signing pass discovers native files throughout the application bundle,
including `Resources/airplay`, and applies the configured release identity.
Do not claim release signing or notarization was verified when the credentials
were unavailable.

The `source/` bundle contains the locked source archives, native probe,
lockfile, build instructions, producer modules, and shared Debian provenance
parser needed to rebuild the runtime. Keep that bundle with distributed
resources. No build or runtime command depends on files under `tmp/`.

The producer finally invokes the packaged `uxplay -h` and exact stereo ALAC
round-trip probe with developer loader paths and system plugin discovery
disabled. It does not start, stop, install, or remove a discovery service.
Linux requires an existing Avahi service for normal receiver discovery;
bundling the client libraries does not provide that service.
