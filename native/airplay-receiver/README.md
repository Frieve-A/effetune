# AirPlay receiver producer

The fixed UxPlay receiver runs as a separate process. It sends 44.1 kHz stereo
S16BE L16 RTP to an internal loopback destination. Audio is decoded by the
packaged GStreamer components and processed by EffeTune after reception.

`node scripts/build-airplay-receiver.mjs --arch x64` produces
`out/native/airplay-receiver/win32-x64/` on Windows. The producer accepts
`--no-publish-development` for consistency with other native producers; it
always writes managed build output and never publishes binaries. The build
accepts `--output-dir <absolute-path>` to stage a separate payload under a direct
child of `out/native/airplay-receiver/`, leaving the normal resource directory
untouched while an application uses it. The build
uses Node.js 24, CMake, Ninja, Visual Studio 2022 C++ tools, Git for Windows
Bash, and the installed electron-builder dependency, which resolves its
checksum-pinned NSIS tool automatically. Nonstandard tool locations can be
supplied with `--makensis <absolute-path-to-makensis.exe>` or
`--bash <absolute-path-to-bash.exe>`.

Compiler and dependency packages are cached under `out/native/airplay-receiver/`.
They are downloaded from official repositories and checked against the tracked
dependency lock. No system compiler, codec pack, or service is installed by
the producer. Windows discovery service registration is part of the product
installer and must not be run by build or package verification.

The producer builds the source-distributed Apple DNS-SD service/client,
minimal FFmpeg AAC/ALAC libraries, fixed UxPlay, and the small package probe.
It stages selected GStreamer plugins and their actual library imports beside
the executable, includes exact corresponding source and licenses, and compiles
the elevated discovery installer. The UxPlay and mDNSResponder build-only
adaptations are explicit in the producer; no protocol implementation is forked.
The existing volume callback additionally emits one flushed line,
`EFFETUNE_AIRPLAY_VOLUME {"fraction":0.5}`, containing its actual sender slider
fraction. This is an observation of the sender's control, not linear gain or
output loudness; decoding and gain calculations remain unchanged.

The package probe performs a deterministic lossless ALAC encode/decode and
checks exact stereo S16BE samples. `--rtp-output <file>` additionally captures
length-prefixed packets from the actual packaged `rtpL16pay` element so tests
can verify the Electron and renderer contract against the real producer.
It never advertises a receiver or opens a listening socket.

Run `node tools/verify-airplay-package.mjs <resource-directory-or-dist>` to
verify the payload and execute the bounded native audio probe on its matching
host. Checks for another operating system inspect contents without claiming
that native loader, discovery, installer, or signing execution passed.

POSIX build and redistribution requirements are implemented by
`scripts/airplay/build-posix.mjs`. Build on the requested operating system and
architecture. macOS signing/notarization still requires the normal desktop
release credentials; Windows service-install verification requires an
appropriate disposable elevated installation environment.
