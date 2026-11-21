#pragma once
#include "device_host.h"
#include "frame.h"
namespace effetune::audio {
bool isPowerControl(std::string_view type) noexcept;
void handlePowerControl(DeviceHost &host, Session &session, const Frame &frame);
void notifyPower(DeviceHost &host, Session &session, unsigned branch);
void clearPowerRequests(unsigned branch);
} // namespace effetune::audio
