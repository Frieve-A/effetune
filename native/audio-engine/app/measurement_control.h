#pragma once
#include "device_host.h"
#include "frame.h"

namespace effetune::audio {
bool isMeasurementCommand(std::string_view type) noexcept;
bool handleMeasurement(DeviceHost &host, Frame &frame);
} // namespace effetune::audio
