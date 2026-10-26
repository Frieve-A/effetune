#pragma once
#include "protocol.h"
#include <memory>
namespace OpenHome::Net {
class DvDeviceStd;
}
namespace effetune::openhome {
class AvProviders {
public:
  AvProviders(OpenHome::Net::DvDeviceStd &, ProtocolBridge &);
  ~AvProviders();
  bool ApplySnapshot(const JsonValue &);

private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};
} // namespace effetune::openhome
