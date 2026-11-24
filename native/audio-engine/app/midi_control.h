#pragma once
#include "device_host.h"
#include "frame.h"
namespace effetune::audio {
bool isMidiControl(std::string_view type) noexcept;
void handleMidiControl(DeviceHost &device, Session &session, const Frame &frame);
void notifyMidi(Session &session, unsigned branch);
void clearMidiRequests(unsigned branch);
void retireParallelMidiRequests(DeviceHost &device);
} // namespace effetune::audio
