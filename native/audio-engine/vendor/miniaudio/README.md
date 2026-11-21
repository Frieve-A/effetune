# miniaudio

The unmodified `miniaudio.h` and `LICENSE` come from [miniaudio 0.11.26](https://github.com/mackron/miniaudio/releases/tag/0.11.26), commit `877ea4a7c2601c7b0f2a44e83dfac42e6470fea6`. The header SHA-256 is `6b376c7fbb1352ba1e0e432ab66069b335ea9405e45cb6c30b97ef0f3c9c3e0e`. Upstream offers the Unlicense and the MIT No Attribution license.

The adapter builds only device I/O. Its production backends are CoreAudio on macOS and PulseAudio followed by ALSA on Linux. The adapter tests use miniaudio’s own null backend. The Linux backends use runtime loading for PulseAudio and ALSA.

At this revision, `ma_device_config` exposes the ALSA automatic resampling and channel conversion flags, the variable-size callback flag, the clipping and output buffer initialization flags, and the CoreAudio nominal sample-rate flag. The adapter sets these on every open. PulseAudio device information reports the source or sink sample specification. CoreAudio device initialization uses the Audio Unit’s format when channel count and rate are unspecified. ALSA exposes supported channel/rate pairs through `nativeDataFormats`.

The adapter checks the opened direction’s `internalChannels`, `internalSampleRate`, `converter.hasChannelConverter` and `converter.hasResampler`, along with both converter latency functions. An internal integer format is accepted when these checks confirm that only sample-format conversion is active. Repeat this source and runtime verification whenever the pinned version changes.
