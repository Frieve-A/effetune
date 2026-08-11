#pragma once

#include <memory>
#include <string>

#include "protocol.h"

namespace OpenHome::Net {
class DvDeviceStd;
}

namespace effetune::openhome {

class OpenHomeProviders {
public:
  OpenHomeProviders(OpenHome::Net::DvDeviceStd &device, ProtocolBridge &bridge,
                    std::string friendlyName);
  ~OpenHomeProviders();

  OpenHomeProviders(const OpenHomeProviders &) = delete;
  OpenHomeProviders &operator=(const OpenHomeProviders &) = delete;

  bool ApplySnapshot(const JsonValue &snapshot);

private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

} // namespace effetune::openhome
