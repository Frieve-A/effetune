#pragma once
#include "device_host.h"
#include "frame.h"
namespace effetune::audio {
bool isInstrumentControl(std::string_view type) noexcept;
bool restoreCheckpoints(Session &session, const Frame &frame);
void handleInstrumentControl(DeviceHost &host, Session &session, const Frame &frame);
} // namespace effetune::audio
