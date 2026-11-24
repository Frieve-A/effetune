#pragma once
#include "device_host.h"
#include "frame.h"
#include "host/pipeline.h"

namespace effetune::audio {
bool handleSampleStream(DeviceHost &host, Session &session, const Frame &frame);
void notifySampleStreams(Session &session, unsigned branch);
void clearSampleStreams(unsigned branch);
void submitBank(DeviceHost &host, std::shared_ptr<Pipeline::AssetChange> change,
                std::function<void(bool)> done);
void publishPreparedBank(DeviceHost &host, std::shared_ptr<Pipeline::AssetChange> change,
                         std::function<void(bool)> done);
} // namespace effetune::audio
