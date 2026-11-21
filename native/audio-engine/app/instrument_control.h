#pragma once
#include "device_host.h"
#include "frame.h"
namespace effetune::audio {
bool instrumentNeedsOwner(std::string_view type) noexcept;
bool pausedMixerNeedsOwner(Session &session, const Frame &frame) noexcept;
bool isInstrumentControl(std::string_view type) noexcept;
bool restoreCheckpoints(Session &session, const Frame &frame);
void handlePausedMixer(Session &session, const Frame &frame);
void handleInstrumentControl(DeviceHost &host, Session &session, const Frame &frame);
} // namespace effetune::audio
