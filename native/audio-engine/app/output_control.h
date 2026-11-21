#pragma once
#include "device_host.h"
#include "frame.h"
namespace effetune::audio {
bool isOutputControl(std::string_view type) noexcept;
void handleOutputControl(DeviceHost &host, Session &session, const Frame &frame);
void sendSpectrum(DeviceHost &host, Session &session, unsigned branch);
} // namespace effetune::audio
