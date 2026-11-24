# miniaudio

The upstream `miniaudio.h` and `LICENSE` come from [miniaudio 0.11.26](https://github.com/mackron/miniaudio/releases/tag/0.11.26), commit `877ea4a7c2601c7b0f2a44e83dfac42e6470fea6`. The upstream header SHA-256 is `6b376c7fbb1352ba1e0e432ab66069b335ea9405e45cb6c30b97ef0f3c9c3e0e`. Upstream offers the Unlicense and the MIT No Attribution license.

EffeTune patches ALSA device initialization to multiply period size by period count in 64 bits and reject buffer sizes outside 1–4,294,967,295 frames before negotiation. libasound uses an unsigned integer for this parameter. The patched header SHA-256 with LF line endings is `91d24f143b7a1a29a20e4fc3685b265766e300ee3677764a635756ae7df53d2e`. [ALSA buffer-size negotiation](https://github.com/alsa-project/alsa-lib/blob/v1.2.14/src/pcm/pcm.c#L5745-L5752)

The adapter builds only device I/O. Its production backends are CoreAudio on macOS and PulseAudio followed by ALSA on Linux. The adapter tests use miniaudio’s own null backend. The Linux backends use runtime loading for PulseAudio and ALSA.

At this revision, `ma_device_config` exposes the ALSA automatic resampling and channel conversion flags, the variable-size callback flag, the clipping and output buffer initialization flags, and the CoreAudio nominal sample-rate flag. The adapter sets these on every open. PulseAudio device information reports the source or sink sample specification. CoreAudio device initialization uses the Audio Unit’s format when channel count and rate are unspecified. ALSA exposes supported channel/rate pairs through `nativeDataFormats`.

The adapter checks the opened direction’s `internalChannels`, `internalSampleRate`, `converter.hasChannelConverter` and `converter.hasResampler`, along with both converter latency functions. An internal integer format is accepted when these checks confirm that only sample-format conversion is active. Repeat this source and runtime verification whenever the pinned version changes.
