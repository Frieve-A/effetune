#include "av-providers.h"
#include "DvUpnpOrgAVTransport1.h"
#include "DvUpnpOrgConnectionManager1.h"
#include "DvUpnpOrgRenderingControl1.h"
#include <OpenHome/Net/Cpp/DvInvocation.h>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace effetune::openhome {
namespace {
using namespace OpenHome::Net;
[[noreturn]] void Fail(IDvInvocationStd &i, uint32_t code,
                       const char *message) {
  i.ReportError(code, message);
  throw std::runtime_error("Invocation did not abort");
}
void Instance(IDvInvocationStd &i, uint32_t id) {
  if (id != 0)
    Fail(i, 718, "Invalid InstanceID");
}
void Master(IDvInvocationStd &i, uint32_t id, const std::string &channel) {
  if (id != 0)
    Fail(i, 702, "Invalid InstanceID");
  if (channel != "Master")
    Fail(i, 402, "Invalid channel");
}
JsonValue Call(IDvInvocationStd &i, ProtocolBridge &bridge, const char *service,
               const char *action, JsonValue::Object args = {}) {
  auto result = bridge.Invoke(service, action, JsonValue(std::move(args)));
  if (!result || !result->ok) {
    const auto error = result ? result->errorCode : "action-timeout";
    if (error == "seek-not-supported")
      Fail(i, 710, "Seek mode not supported");
    if (error == "invalid-seek")
      Fail(i, 711, "Illegal seek target");
    if (error == "no-media" || error == "empty-queue")
      Fail(i, 701, "Transition not available");
    if (error == "invalid-uri" || error == "invalid-media-uri")
      Fail(i, 716, "Resource not found");
    if (error == "invalid-metadata" || error == "invalid-action")
      Fail(i, 402, "Invalid arguments");
    if (error == "invalid-preset")
      Fail(i, 701, "Invalid preset name");
    Fail(i, 501, "The player could not complete this action");
  }
  return std::move(result->result);
}
std::string Str(const JsonValue &value, const char *key,
                const char *fallback = "") {
  return std::string(value.GetString(key).value_or(fallback));
}
std::string Time(double value) {
  if (!std::isfinite(value) || value < 0 || value > 4294967295.0)
    value = 0;
  const auto milliseconds =
      static_cast<uint64_t>(std::round(std::max(0.0, value) * 1000));
  const auto seconds = milliseconds / 1000;
  std::ostringstream out;
  out << seconds / 3600 << ':' << std::setfill('0') << std::setw(2)
      << (seconds / 60) % 60 << ':' << std::setw(2) << seconds % 60;
  if (milliseconds % 1000)
    out << '.' << std::setw(3) << milliseconds % 1000;
  return out.str();
}
std::string Escape(std::string_view text) {
  std::string out;
  for (char c : text) {
    switch (c) {
    case '&':
      out += "&amp;";
      break;
    case '<':
      out += "&lt;";
      break;
    case '>':
      out += "&gt;";
      break;
    case '"':
      out += "&quot;";
      break;
    case '\'':
      out += "&apos;";
      break;
    default:
      out += c;
    }
  }
  return out;
}
std::string Field(const char *name, const std::string &value,
                  const char *channel = "") {
  return "<" + std::string(name) + channel + " val=\"" + Escape(value) + "\"/>";
}
std::string Duration(const JsonValue &s) {
  const auto value = s.GetNumber("duration").value_or(0);
  return !Str(s, "uri").empty() && value <= 0 ? "NOT_IMPLEMENTED" : Time(value);
}
class Transport final : public DvProviderUpnpOrgAVTransport1Cpp {
public:
  Transport(DvDeviceStd &device, ProtocolBridge &bridge)
      : DvProviderUpnpOrgAVTransport1Cpp(device), bridge_(bridge) {
    EnablePropertyLastChange();
    EnableActionSetAVTransportURI();
    EnableActionGetMediaInfo();
    EnableActionGetTransportInfo();
    EnableActionGetPositionInfo();
    EnableActionGetDeviceCapabilities();
    EnableActionGetTransportSettings();
    EnableActionStop();
    EnableActionPlay();
    EnableActionPause();
    EnableActionSeek();
    EnableActionNext();
    EnableActionPrevious();
    EnableActionGetCurrentTransportActions();
    Apply(JsonValue(JsonValue::Object{}));
  }
  void Apply(const JsonValue &s) {
    std::string fields =
        Field("TransportState", Str(s, "state", "NO_MEDIA_PRESENT")) +
        Field("TransportStatus", Str(s, "status", "OK")) +
        Field("TransportPlaySpeed", Str(s, "speed", "1")) +
        Field("CurrentPlayMode", Str(s, "playMode", "NORMAL")) +
        Field("NumberOfTracks", Str(s, "uri").empty() ? "0" : "1") +
        Field("CurrentTrack", Str(s, "uri").empty() ? "0" : "1") +
        Field("PlaybackStorageMedium",
              Str(s, "uri").empty() ? "NONE" : "NETWORK") +
        Field("PossiblePlaybackStorageMedia", "NETWORK") +
        Field("RecordStorageMedium", "NOT_IMPLEMENTED") +
        Field("PossibleRecordStorageMedia", "NOT_IMPLEMENTED") +
        Field("RecordMediumWriteStatus", "NOT_IMPLEMENTED") +
        Field("CurrentRecordQualityMode", "NOT_IMPLEMENTED") +
        Field("PossibleRecordQualityModes", "NOT_IMPLEMENTED") +
        Field("NextAVTransportURI", "NOT_IMPLEMENTED") +
        Field("NextAVTransportURIMetaData", "NOT_IMPLEMENTED") +
        Field("AVTransportURI", Str(s, "uri")) +
        Field("AVTransportURIMetaData", Str(s, "metadata")) +
        Field("CurrentTrackURI", Str(s, "uri")) +
        Field("CurrentTrackMetaData", Str(s, "metadata")) +
        Field("CurrentTrackDuration", Duration(s)) +
        Field("CurrentMediaDuration", Duration(s)) +
        Field("CurrentTransportActions", Str(s, "actions"));
    SetPropertyLastChange(
        "<Event xmlns=\"urn:schemas-upnp-org:metadata-1-0/AVT/\"><InstanceID "
        "val=\"0\">" +
        fields + "</InstanceID></Event>");
  }

private:
  JsonValue State(IDvInvocationStd &i, uint32_t id) {
    Instance(i, id);
    return Call(i, bridge_, "AVTransport", "Snapshot");
  }
  void SetAVTransportURI(IDvInvocationStd &i, uint32_t id,
                         const std::string &uri,
                         const std::string &metadata) override {
    Instance(i, id);
    Call(i, bridge_, "AVTransport", "SetAVTransportURI",
         {{"uri", JsonValue(uri)}, {"metadata", JsonValue(metadata)}});
  }
  void GetMediaInfo(IDvInvocationStd &i, uint32_t id, uint32_t &tracks,
                    std::string &duration, std::string &uri,
                    std::string &metadata, std::string &nextUri,
                    std::string &nextMetadata, std::string &medium,
                    std::string &record, std::string &write) override {
    auto s = State(i, id);
    uri = Str(s, "uri");
    metadata = Str(s, "metadata");
    tracks = uri.empty() ? 0 : 1;
    duration = Duration(s);
    nextUri = nextMetadata = "NOT_IMPLEMENTED";
    medium = uri.empty() ? "NONE" : "NETWORK";
    record = "NOT_IMPLEMENTED";
    write = "NOT_IMPLEMENTED";
  }
  void GetTransportInfo(IDvInvocationStd &i, uint32_t id, std::string &state,
                        std::string &status, std::string &speed) override {
    auto s = State(i, id);
    state = Str(s, "state", "NO_MEDIA_PRESENT");
    status = Str(s, "status", "OK");
    speed = Str(s, "speed", "1");
  }
  void GetPositionInfo(IDvInvocationStd &i, uint32_t id, uint32_t &track,
                       std::string &duration, std::string &metadata,
                       std::string &uri, std::string &relative,
                       std::string &absolute, int32_t &relativeCount,
                       int32_t &absoluteCount) override {
    auto s = State(i, id);
    uri = Str(s, "uri");
    metadata = Str(s, "metadata");
    track = uri.empty() ? 0 : 1;
    duration = Duration(s);
    relative = Time(s.GetNumber("position").value_or(0));
    absolute = relative;
    relativeCount = absoluteCount = 2147483647;
  }
  void GetDeviceCapabilities(IDvInvocationStd &i, uint32_t id,
                             std::string &play, std::string &record,
                             std::string &quality) override {
    Instance(i, id);
    play = "NETWORK";
    record = quality = "NOT_IMPLEMENTED";
  }
  void GetTransportSettings(IDvInvocationStd &i, uint32_t id, std::string &play,
                            std::string &quality) override {
    play = Str(State(i, id), "playMode", "NORMAL");
    quality = "NOT_IMPLEMENTED";
  }
  void Play(IDvInvocationStd &i, uint32_t id,
            const std::string &speed) override {
    Instance(i, id);
    if (speed != "1")
      Fail(i, 717, "Play speed not supported");
    Call(i, bridge_, "AVTransport", "Play");
  }
  void Stop(IDvInvocationStd &i, uint32_t id) override {
    Instance(i, id);
    Call(i, bridge_, "AVTransport", "Stop");
  }
  void Pause(IDvInvocationStd &i, uint32_t id) override {
    Instance(i, id);
    Call(i, bridge_, "AVTransport", "Pause");
  }
  void Next(IDvInvocationStd &i, uint32_t id) override {
    Instance(i, id);
    Call(i, bridge_, "AVTransport", "Next");
  }
  void Previous(IDvInvocationStd &i, uint32_t id) override {
    Instance(i, id);
    Call(i, bridge_, "AVTransport", "Previous");
  }
  void Seek(IDvInvocationStd &i, uint32_t id, const std::string &unit,
            const std::string &target) override {
    Instance(i, id);
    if (unit == "TRACK_NR") {
      if (target != "1")
        Fail(i, 711, "Illegal seek target");
      Call(i, bridge_, "AVTransport", "Seek", {{"seconds", JsonValue(0.0)}});
      return;
    }
    if (unit != "REL_TIME" && unit != "ABS_TIME")
      Fail(i, 710, "Seek mode not supported");
    uint64_t hours = 0;
    uint32_t minutes = 0;
    double seconds = 0;
    double fraction = 0;
    auto time = target;
    const auto slash = time.find('/');
    if (slash != std::string::npos) {
      const auto dot = time.find('.');
      if (dot == std::string::npos || slash <= dot + 1)
        Fail(i, 711, "Illegal seek target");
      std::istringstream numeratorInput(time.substr(dot + 1, slash - dot - 1)),
          denominatorInput(time.substr(slash + 1));
      double numerator = 0, denominator = 0;
      if (!(numeratorInput >> numerator) || numeratorInput.peek() != EOF ||
          !(denominatorInput >> denominator) ||
          denominatorInput.peek() != EOF || !std::isfinite(numerator) ||
          !std::isfinite(denominator) || numerator < 0 ||
          numerator >= denominator)
        Fail(i, 711, "Illegal seek target");
      fraction = numerator / denominator;
      time.resize(dot);
    }
    char a = 0, b = 0;
    std::istringstream input(time);
    if (target.size() > 128 ||
        target.find_first_not_of("0123456789:./") != std::string::npos ||
        !(input >> hours >> a >> minutes >> b >> seconds) || a != ':' ||
        b != ':' || minutes > 59 || !std::isfinite(seconds) || seconds < 0 ||
        seconds >= 60 || input.peek() != EOF || hours > 1193046)
      Fail(i, 711, "Illegal seek target");
    const double value = static_cast<double>(hours) * 3600 +
                         static_cast<double>(minutes) * 60 + seconds + fraction;
    if (value > 4294967295ULL)
      Fail(i, 711, "Illegal seek target");
    Call(i, bridge_, "AVTransport", "Seek",
         {{"seconds", JsonValue(static_cast<double>(value))}});
  }
  void GetCurrentTransportActions(IDvInvocationStd &i, uint32_t id,
                                  std::string &actions) override {
    actions = Str(State(i, id), "actions");
  }
  ProtocolBridge &bridge_;
};
class Rendering final : public DvProviderUpnpOrgRenderingControl1Cpp {
public:
  Rendering(DvDeviceStd &device, ProtocolBridge &bridge)
      : DvProviderUpnpOrgRenderingControl1Cpp(device), bridge_(bridge) {
    EnablePropertyLastChange();
    EnableActionListPresets();
    EnableActionSelectPreset();
    EnableActionGetMute();
    EnableActionSetMute();
    EnableActionGetVolume();
    EnableActionSetVolume();
    Apply(JsonValue(JsonValue::Object{}));
  }
  void Apply(const JsonValue &s) {
    SetPropertyLastChange(
        "<Event xmlns=\"urn:schemas-upnp-org:metadata-1-0/RCS/\"><InstanceID "
        "val=\"0\">" +
        Field("Volume", std::to_string(s.GetUInt32("volume").value_or(100)),
              " channel=\"Master\"") +
        Field("Mute", s.GetBool("mute").value_or(false) ? "1" : "0",
              " channel=\"Master\"") +
        "</InstanceID></Event>");
  }

private:
  void ListPresets(IDvInvocationStd &i, uint32_t id,
                   std::string &presets) override {
    Master(i, id, "Master");
    presets = "FactoryDefaults";
  }
  void SelectPreset(IDvInvocationStd &i, uint32_t id,
                    const std::string &preset) override {
    Master(i, id, "Master");
    if (preset != "FactoryDefaults")
      Fail(i, 701, "Invalid preset name");
    Call(i, bridge_, "RenderingControl", "SelectPreset",
         {{"preset", JsonValue(preset)}});
  }
  void GetVolume(IDvInvocationStd &i, uint32_t id, const std::string &channel,
                 uint32_t &volume) override {
    Master(i, id, channel);
    volume = Call(i, bridge_, "RenderingControl", "Snapshot")
                 .GetUInt32("volume")
                 .value_or(100);
  }
  void SetVolume(IDvInvocationStd &i, uint32_t id, const std::string &channel,
                 uint32_t volume) override {
    Master(i, id, channel);
    if (volume > 100)
      Fail(i, 402, "Invalid volume");
    Call(i, bridge_, "RenderingControl", "SetVolume",
         {{"volume", JsonValue(static_cast<double>(volume))}});
  }
  void GetMute(IDvInvocationStd &i, uint32_t id, const std::string &channel,
               bool &mute) override {
    Master(i, id, channel);
    mute = Call(i, bridge_, "RenderingControl", "Snapshot")
               .GetBool("mute")
               .value_or(false);
  }
  void SetMute(IDvInvocationStd &i, uint32_t id, const std::string &channel,
               bool mute) override {
    Master(i, id, channel);
    Call(i, bridge_, "RenderingControl", "SetMute",
         {{"mute", JsonValue(mute)}});
  }
  ProtocolBridge &bridge_;
};
class Connection final : public DvProviderUpnpOrgConnectionManager1Cpp {
public:
  Connection(DvDeviceStd &device, ProtocolBridge &bridge)
      : DvProviderUpnpOrgConnectionManager1Cpp(device), bridge_(bridge) {
    EnablePropertySourceProtocolInfo();
    EnablePropertySinkProtocolInfo();
    EnablePropertyCurrentConnectionIDs();
    EnableActionGetProtocolInfo();
    EnableActionGetCurrentConnectionIDs();
    EnableActionGetCurrentConnectionInfo();
    SetPropertySourceProtocolInfo("");
    SetPropertySinkProtocolInfo(std::string(kAudioProtocolInfo));
    SetPropertyCurrentConnectionIDs("0");
  }

private:
  void GetProtocolInfo(IDvInvocationStd &, std::string &source,
                       std::string &sink) override {
    source.clear();
    sink = kAudioProtocolInfo;
  }
  void GetCurrentConnectionIDs(IDvInvocationStd &, std::string &ids) override {
    ids = "0";
  }
  void GetCurrentConnectionInfo(IDvInvocationStd &i, int32_t id, int32_t &rcs,
                                int32_t &av, std::string &protocol,
                                std::string &peer, int32_t &peerId,
                                std::string &direction,
                                std::string &status) override {
    if (id != 0)
      Fail(i, 706, "Invalid connection reference");
    rcs = av = 0;
    protocol = Str(Call(i, bridge_, "AVTransport", "Snapshot"), "protocolInfo");
    peer.clear();
    peerId = -1;
    direction = "Input";
    status = "OK";
  }
  ProtocolBridge &bridge_;
};
} // namespace
class AvProviders::Impl {
public:
  Impl(DvDeviceStd &device, ProtocolBridge &bridge)
      : transport(device, bridge), rendering(device, bridge),
        connection(device, bridge) {}
  Transport transport;
  Rendering rendering;
  Connection connection;
};
AvProviders::AvProviders(DvDeviceStd &device, ProtocolBridge &bridge)
    : impl_(std::make_unique<Impl>(device, bridge)) {}
AvProviders::~AvProviders() = default;
bool AvProviders::ApplySnapshot(const JsonValue &snapshot) {
  const auto *transport = snapshot.Find("avTransport"),
             *rendering = snapshot.Find("renderingControl");
  if (!transport || !transport->IsObject() || !rendering ||
      !rendering->IsObject())
    return false;
  impl_->transport.Apply(*transport);
  impl_->rendering.Apply(*rendering);
  return true;
}
} // namespace effetune::openhome
