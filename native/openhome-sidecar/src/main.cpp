#include "protocol.h"
#include "providers.h"

#include <OpenHome/Functor.h>
#include <OpenHome/FunctorMsg.h>
#include <OpenHome/Net/Cpp/DvDevice.h>
#include <OpenHome/Net/Cpp/OhNet.h>
#include <OpenHome/Private/Thread.h>

#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>

namespace effetune::openhome {
namespace {

class StderrLogger {
public:
  void Log(const char *message) {
    if (message != nullptr)
      std::cerr << message;
  }
};

class SidecarRuntime {
public:
  SidecarRuntime(ProtocolBridge &bridge, bool useLoopback)
      : bridge_(bridge), useLoopback_(useLoopback) {}

  ~SidecarRuntime() { Stop(); }

  bool Start(const ProtocolConfiguration &configuration) {
    if (started_)
      return false;
    try {
      auto *params = OpenHome::Net::InitialisationParams::Create();
      params->SetDvUpnpServerPort(0);
      params->SetSchedulingPolicy(OpenHome::Environment::EScheduleNone);
      params->SetLogOutput(
          OpenHome::MakeFunctorMsg(logger_, &StderrLogger::Log));
      if (useLoopback_)
        params->SetUseLoopbackNetworkAdapter();
      OpenHome::Net::UpnpLibrary::Initialise(params);
      libraryInitialised_ = true;
      OpenHome::Net::UpnpLibrary::StartDv();

      std::string udn = configuration.udn;
      constexpr std::string_view prefix = "uuid:";
      if (udn.compare(0, prefix.size(), prefix) == 0)
        udn.erase(0, prefix.size());
      if (udn.empty())
        throw std::runtime_error("Invalid device identifier");

      device_ = std::make_unique<OpenHome::Net::DvDeviceStdStandard>(udn);
      device_->SetAttribute("Upnp.Domain", "av.openhome.org");
      device_->SetAttribute("Upnp.Type", "Source");
      device_->SetAttribute("Upnp.Version", "1");
      device_->SetAttribute("Upnp.FriendlyName",
                            configuration.friendlyName.c_str());
      device_->SetAttribute("Upnp.Manufacturer", "EffeTune");
      device_->SetAttribute("Upnp.ModelName", "EffeTune");
      device_->SetAttribute("Upnp.ModelDescription",
                            "EffeTune OpenHome player");
      providers_ = std::make_unique<OpenHomeProviders>(
          *device_, bridge_, configuration.friendlyName);
      device_->SetEnabled();
      started_ = true;
      return true;
    } catch (...) {
      Stop();
      return false;
    }
  }

  void ApplySnapshot(const JsonValue &snapshot) {
    if (providers_ && !providers_->ApplySnapshot(snapshot)) {
      bridge_.SendDiagnostic("invalid-state");
    }
  }

  void Stop() noexcept {
    bridge_.Stop();
    if (device_ && started_) {
      try {
        OpenHome::Semaphore disabled("OHDS", 0);
        device_->SetDisabled(
            OpenHome::MakeFunctor(disabled, &OpenHome::Semaphore::Signal));
        disabled.Wait();
      } catch (...) {
      }
    }
    started_ = false;
    providers_.reset();
    device_.reset();
    if (libraryInitialised_) {
      OpenHome::Net::UpnpLibrary::Close();
      libraryInitialised_ = false;
    }
  }

private:
  ProtocolBridge &bridge_;
  bool useLoopback_ = false;
  bool libraryInitialised_ = false;
  bool started_ = false;
  StderrLogger logger_;
  std::unique_ptr<OpenHome::Net::DvDeviceStdStandard> device_;
  std::unique_ptr<OpenHomeProviders> providers_;
};

bool ParseArguments(int argc, char *argv[], bool &useLoopback) {
  if (argc < 2 || std::string_view(argv[1]) != "--stdio")
    return false;
  useLoopback = false;
  for (int index = 2; index < argc; ++index) {
    if (std::string_view(argv[index]) == "--loopback") {
      useLoopback = true;
    } else {
      return false;
    }
  }
  return true;
}

} // namespace
} // namespace effetune::openhome

int main(int argc, char *argv[]) {
  using namespace effetune::openhome;
  bool useLoopback = false;
  if (!ParseArguments(argc, argv, useLoopback))
    return 2;

  std::ios::sync_with_stdio(false);
  ProtocolBridge bridge(std::cout);
  SidecarRuntime runtime(bridge, useLoopback);
  const RunResult result = bridge.Run(
      std::cin,
      [&](const ProtocolConfiguration &configuration) {
        const bool started = runtime.Start(configuration);
        if (!started)
          bridge.SendDiagnostic("initialisation-failed");
        return started;
      },
      [&](const JsonValue &snapshot) { runtime.ApplySnapshot(snapshot); });
  runtime.Stop();
  return result == RunResult::kShutdown || result == RunResult::kEndOfFile ? 0
                                                                           : 2;
}
