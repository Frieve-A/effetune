#pragma once
namespace effetune::audio {
class DeviceHost;
void reportNetworkPaths(DeviceHost &host, unsigned branch);
void checkNetworkDelays(DeviceHost &host);
} // namespace effetune::audio
