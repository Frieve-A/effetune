#pragma once

#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#define MA_NO_GENERATION
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS

#if defined(ET_AUDIO_ENGINE_TEST_MINIAUDIO_NULL)
#define MA_ENABLE_NULL
#elif defined(__APPLE__)
#define MA_ENABLE_COREAUDIO
#elif defined(__linux__)
#define MA_ENABLE_PULSEAUDIO
#define MA_ENABLE_ALSA
#endif

#include "vendor/miniaudio/miniaudio.h"
