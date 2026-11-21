#pragma once
#include "device/device.h"
#include <string_view>
namespace effetune::audio {
std::unique_ptr<AudioDevice> makeRealtimeNull(DeviceCallbacks callbacks);
bool resetRealtimeNull(AudioDevice *device, unsigned sampleRate, unsigned channels,
                       std::string_view unavailableId, bool loseInput);
bool readRealtimeNullOutput(AudioDevice *device, unsigned &frames, float &peak);
bool setRealtimeNullInput(AudioDevice *device, float level);
} // namespace effetune::audio
