#include "providers.h"

#include "DvAvOpenhomeOrgInfo1.h"
#include "DvAvOpenhomeOrgPlaylist1.h"
#include "DvAvOpenhomeOrgProduct1.h"
#include "DvAvOpenhomeOrgTime1.h"

#include <OpenHome/Net/Cpp/DvInvocation.h>
#include <OpenHome/Net/Cpp/DvProvider.h>

#include <cstdint>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace effetune::openhome {
namespace {

using OpenHome::Net::AutoPropertyLock;
using OpenHome::Net::DvDeviceStd;
using OpenHome::Net::DvProviderAvOpenhomeOrgInfo1Cpp;
using OpenHome::Net::DvProviderAvOpenhomeOrgPlaylist1Cpp;
using OpenHome::Net::DvProviderAvOpenhomeOrgProduct1Cpp;
using OpenHome::Net::DvProviderAvOpenhomeOrgTime1Cpp;
using OpenHome::Net::IDvInvocationStd;

constexpr std::string_view kProtocolInfo =
    "http-get:*:audio/mpeg:*,http-get:*:audio/flac:*,"
    "http-get:*:audio/x-flac:*";
constexpr std::string_view kSourceXml =
    "<SourceList><Source><SystemName>Playlist</SystemName>"
    "<Type>Playlist</Type><Name>Playlist</Name><Visible>true</Visible>"
    "</Source></SourceList>";
constexpr std::string_view kAttributes = "Info Time Playlist";

[[noreturn]] void ReportActionError(IDvInvocationStd &invocation,
                                    std::uint32_t code,
                                    std::string_view description) {
  invocation.ReportError(code, std::string(description));
  throw std::runtime_error(
      "OpenHome invocation did not abort after ReportError");
}

JsonValue Invoke(IDvInvocationStd &invocation, ProtocolBridge &bridge,
                 std::string_view service, std::string_view action,
                 JsonValue::Object args = {}) {
  auto response = bridge.Invoke(service, action, JsonValue(std::move(args)));
  if (response && !response->ok && response->errorCode == "request-too-large") {
    ReportActionError(invocation, 402, "The action input is too large.");
  }
  if (!response || !response->ok) {
    ReportActionError(invocation, 501,
                      "The player could not complete this action.");
  }
  return std::move(response->result);
}

JsonValue Snapshot(IDvInvocationStd &invocation, ProtocolBridge &bridge,
                   std::string_view service) {
  return Invoke(invocation, bridge, service, "Snapshot");
}

std::string RequireString(IDvInvocationStd &invocation, const JsonValue &value,
                          std::string_view key) {
  auto result = value.GetString(key);
  if (!result)
    ReportActionError(invocation, 501,
                      "The player returned an invalid response.");
  return std::string(*result);
}

std::uint32_t RequireUint(IDvInvocationStd &invocation, const JsonValue &value,
                          std::string_view key) {
  auto result = value.GetUInt32(key);
  if (!result)
    ReportActionError(invocation, 501,
                      "The player returned an invalid response.");
  return *result;
}

bool RequireBool(IDvInvocationStd &invocation, const JsonValue &value,
                 std::string_view key) {
  auto result = value.GetBool(key);
  if (!result)
    ReportActionError(invocation, 501,
                      "The player returned an invalid response.");
  return *result;
}

JsonValue::Object UintArg(std::string key, std::uint32_t value) {
  JsonValue::Object args;
  args.emplace(std::move(key), JsonValue(static_cast<double>(value)));
  return args;
}

JsonValue::Object IntArg(std::string key, std::int32_t value) {
  JsonValue::Object args;
  args.emplace(std::move(key), JsonValue(static_cast<double>(value)));
  return args;
}

JsonValue::Object BoolArg(std::string key, bool value) {
  JsonValue::Object args;
  args.emplace(std::move(key), JsonValue(value));
  return args;
}

std::string XmlEscape(std::string_view input) {
  std::string output;
  output.reserve(input.size());
  for (const char character : input) {
    switch (character) {
    case '&':
      output += "&amp;";
      break;
    case '<':
      output += "&lt;";
      break;
    case '>':
      output += "&gt;";
      break;
    case '\"':
      output += "&quot;";
      break;
    case '\'':
      output += "&apos;";
      break;
    default:
      output.push_back(character);
      break;
    }
  }
  return output;
}

std::optional<std::string> DecodeBase64(std::string_view input) {
  if (input.size() % 4 != 0 || input.size() > 64 * 1024)
    return std::nullopt;
  auto decode = [](char character) -> int {
    if (character >= 'A' && character <= 'Z')
      return character - 'A';
    if (character >= 'a' && character <= 'z')
      return character - 'a' + 26;
    if (character >= '0' && character <= '9')
      return character - '0' + 52;
    if (character == '+')
      return 62;
    if (character == '/')
      return 63;
    return -1;
  };
  std::string output;
  output.reserve((input.size() / 4) * 3);
  for (std::size_t offset = 0; offset < input.size(); offset += 4) {
    const bool pad2 = input[offset + 2] == '=';
    const bool pad3 = input[offset + 3] == '=';
    const int a = decode(input[offset]);
    const int b = decode(input[offset + 1]);
    const int c = pad2 ? 0 : decode(input[offset + 2]);
    const int d = pad3 ? 0 : decode(input[offset + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0 || (pad2 && !pad3) ||
        ((pad2 || pad3) && offset + 4 != input.size())) {
      return std::nullopt;
    }
    const std::uint32_t block = (static_cast<std::uint32_t>(a) << 18) |
                                (static_cast<std::uint32_t>(b) << 12) |
                                (static_cast<std::uint32_t>(c) << 6) |
                                static_cast<std::uint32_t>(d);
    output.push_back(static_cast<char>((block >> 16) & 0xff));
    if (!pad2)
      output.push_back(static_cast<char>((block >> 8) & 0xff));
    if (!pad3)
      output.push_back(static_cast<char>(block & 0xff));
  }
  return output;
}

struct SnapshotValues {
  std::string transportState;
  bool repeat = false;
  bool shuffle = false;
  std::uint32_t currentId = 0;
  std::string idArray;
  std::uint32_t tracksMax = 0;
  std::string uri;
  std::string metadata;
  std::uint32_t duration = 0;
  std::uint32_t seconds = 0;
  std::uint32_t bitrate = 0;
  std::uint32_t bitDepth = 0;
  std::uint32_t sampleRate = 0;
  bool lossless = false;
  std::string codecName;
  std::uint32_t trackToken = 0;
  std::uint32_t detailsToken = 0;
};

std::optional<SnapshotValues> ParseSnapshot(const JsonValue &value) {
  const auto transportState = value.GetString("transportState");
  const auto repeat = value.GetBool("repeat");
  const auto shuffle = value.GetBool("shuffle");
  const auto currentId = value.GetUInt32("currentId");
  const auto idArray = value.GetString("idArray");
  const auto tracksMax = value.GetUInt32("tracksMax");
  const auto uri = value.GetString("uri");
  const auto metadata = value.GetString("metadata");
  const auto duration = value.GetUInt32("duration");
  const auto seconds = value.GetUInt32("seconds");
  const auto bitrate = value.GetUInt32("bitrate");
  const auto bitDepth = value.GetUInt32("bitDepth");
  const auto sampleRate = value.GetUInt32("sampleRate");
  const auto lossless = value.GetBool("lossless");
  const auto codecName = value.GetString("codecName");
  const auto trackToken = value.GetUInt32("trackToken");
  const auto detailsToken = value.GetUInt32("detailsToken");
  if (!transportState || !repeat || !shuffle || !currentId || !idArray ||
      !tracksMax || !uri || !metadata || !duration || !seconds || !bitrate ||
      !bitDepth || !sampleRate || !lossless || !codecName || !trackToken ||
      !detailsToken) {
    return std::nullopt;
  }
  if (*transportState != "Buffering" && *transportState != "Paused" &&
      *transportState != "Playing" && *transportState != "Stopped") {
    return std::nullopt;
  }
  auto decodedIds = DecodeBase64(*idArray);
  if (!decodedIds || decodedIds->size() % 4 != 0)
    return std::nullopt;
  return SnapshotValues{std::string(*transportState),
                        *repeat,
                        *shuffle,
                        *currentId,
                        std::move(*decodedIds),
                        *tracksMax,
                        std::string(*uri),
                        std::string(*metadata),
                        *duration,
                        *seconds,
                        *bitrate,
                        *bitDepth,
                        *sampleRate,
                        *lossless,
                        std::string(*codecName),
                        *trackToken,
                        *detailsToken};
}

class ProductProvider final : public DvProviderAvOpenhomeOrgProduct1Cpp {
public:
  ProductProvider(DvDeviceStd &device, std::string friendlyName)
      : DvProviderAvOpenhomeOrgProduct1Cpp(device),
        friendlyName_(std::move(friendlyName)) {
    EnablePropertyManufacturerName();
    EnablePropertyManufacturerInfo();
    EnablePropertyManufacturerUrl();
    EnablePropertyManufacturerImageUri();
    EnablePropertyModelName();
    EnablePropertyModelInfo();
    EnablePropertyModelUrl();
    EnablePropertyModelImageUri();
    EnablePropertyProductRoom();
    EnablePropertyProductName();
    EnablePropertyProductInfo();
    EnablePropertyProductUrl();
    EnablePropertyProductImageUri();
    EnablePropertyStandby();
    EnablePropertySourceIndex();
    EnablePropertySourceCount();
    EnablePropertySourceXml();
    EnablePropertyAttributes();
    EnableActionManufacturer();
    EnableActionModel();
    EnableActionProduct();
    EnableActionStandby();
    EnableActionSetStandby();
    EnableActionSourceCount();
    EnableActionSourceXml();
    EnableActionSourceIndex();
    EnableActionSetSourceIndex();
    EnableActionSetSourceIndexByName();
    EnableActionSource();
    EnableActionAttributes();
    EnableActionSourceXmlChangeCount();
    SetPropertyManufacturerName("EffeTune");
    SetPropertyManufacturerInfo("EffeTune audio processing software");
    SetPropertyManufacturerUrl("");
    SetPropertyManufacturerImageUri("");
    SetPropertyModelName("EffeTune");
    SetPropertyModelInfo("EffeTune OpenHome player");
    SetPropertyModelUrl("");
    SetPropertyModelImageUri("");
    SetPropertyProductRoom(friendlyName_);
    SetPropertyProductName(friendlyName_);
    SetPropertyProductInfo("EffeTune music file player");
    SetPropertyProductUrl("");
    SetPropertyProductImageUri("");
    SetPropertyStandby(false);
    SetPropertySourceIndex(0);
    SetPropertySourceCount(1);
    SetPropertySourceXml(std::string(kSourceXml));
    SetPropertyAttributes(std::string(kAttributes));
  }

private:
  void Manufacturer(IDvInvocationStd &, std::string &name, std::string &info,
                    std::string &url, std::string &imageUri) override {
    name = "EffeTune";
    info = "EffeTune audio processing software";
    url.clear();
    imageUri.clear();
  }
  void Model(IDvInvocationStd &, std::string &name, std::string &info,
             std::string &url, std::string &imageUri) override {
    name = "EffeTune";
    info = "EffeTune OpenHome player";
    url.clear();
    imageUri.clear();
  }
  void Product(IDvInvocationStd &, std::string &room, std::string &name,
               std::string &info, std::string &url,
               std::string &imageUri) override {
    room = friendlyName_;
    name = friendlyName_;
    info = "EffeTune music file player";
    url.clear();
    imageUri.clear();
  }
  void Standby(IDvInvocationStd &, bool &value) override { value = false; }
  void SetStandby(IDvInvocationStd &invocation, bool value) override {
    if (value)
      ReportActionError(invocation, 801, "Standby is not supported.");
  }
  void SourceCount(IDvInvocationStd &, std::uint32_t &value) override {
    value = 1;
  }
  void SourceXml(IDvInvocationStd &, std::string &value) override {
    value = kSourceXml;
  }
  void SourceIndex(IDvInvocationStd &, std::uint32_t &value) override {
    value = 0;
  }
  void SetSourceIndex(IDvInvocationStd &invocation,
                      std::uint32_t value) override {
    if (value != 0)
      ReportActionError(invocation, 802, "The source does not exist.");
  }
  void SetSourceIndexByName(IDvInvocationStd &invocation,
                            const std::string &value) override {
    if (value != "Playlist")
      ReportActionError(invocation, 802, "The source does not exist.");
  }
  void Source(IDvInvocationStd &invocation, std::uint32_t index,
              std::string &systemName, std::string &type, std::string &name,
              bool &visible) override {
    if (index != 0)
      ReportActionError(invocation, 802, "The source does not exist.");
    systemName = "Playlist";
    type = "Playlist";
    name = "Playlist";
    visible = true;
  }
  void Attributes(IDvInvocationStd &, std::string &value) override {
    value = kAttributes;
  }
  void SourceXmlChangeCount(IDvInvocationStd &, std::uint32_t &value) override {
    value = 0;
  }

  std::string friendlyName_;
};

class PlaylistProvider final : public DvProviderAvOpenhomeOrgPlaylist1Cpp {
public:
  PlaylistProvider(DvDeviceStd &device, ProtocolBridge &bridge)
      : DvProviderAvOpenhomeOrgPlaylist1Cpp(device), bridge_(bridge) {
    EnablePropertyTransportState();
    EnablePropertyRepeat();
    EnablePropertyShuffle();
    EnablePropertyId();
    EnablePropertyIdArray();
    EnablePropertyTracksMax();
    EnablePropertyProtocolInfo();
    EnableActionPlay();
    EnableActionPause();
    EnableActionStop();
    EnableActionNext();
    EnableActionPrevious();
    EnableActionSetRepeat();
    EnableActionRepeat();
    EnableActionSetShuffle();
    EnableActionShuffle();
    EnableActionSeekSecondAbsolute();
    EnableActionSeekSecondRelative();
    EnableActionSeekId();
    EnableActionSeekIndex();
    EnableActionTransportState();
    EnableActionId();
    EnableActionRead();
    EnableActionReadList();
    EnableActionInsert();
    EnableActionDeleteId();
    EnableActionDeleteAll();
    EnableActionTracksMax();
    EnableActionIdArray();
    EnableActionIdArrayChanged();
    EnableActionProtocolInfo();
    SetPropertyTransportState("Stopped");
    SetPropertyRepeat(false);
    SetPropertyShuffle(false);
    SetPropertyId(0);
    SetPropertyIdArray("");
    SetPropertyTracksMax(4096);
    SetPropertyProtocolInfo(std::string(kProtocolInfo));
  }

  void Apply(const SnapshotValues &values) {
    AutoPropertyLock lock(*this);
    SetPropertyTransportState(values.transportState);
    SetPropertyRepeat(values.repeat);
    SetPropertyShuffle(values.shuffle);
    SetPropertyId(values.currentId);
    SetPropertyIdArray(values.idArray);
    SetPropertyTracksMax(values.tracksMax);
  }

private:
  void Command(IDvInvocationStd &invocation, std::string_view action,
               JsonValue::Object args = {}) {
    Invoke(invocation, bridge_, "Playlist", action, std::move(args));
  }
  void Play(IDvInvocationStd &invocation) override {
    Command(invocation, "Play");
  }
  void Pause(IDvInvocationStd &invocation) override {
    Command(invocation, "Pause");
  }
  void Stop(IDvInvocationStd &invocation) override {
    Command(invocation, "Stop");
  }
  void Next(IDvInvocationStd &invocation) override {
    Command(invocation, "Next");
  }
  void Previous(IDvInvocationStd &invocation) override {
    Command(invocation, "Previous");
  }
  void SetRepeat(IDvInvocationStd &invocation, bool value) override {
    Command(invocation, "SetRepeat", BoolArg("repeat", value));
  }
  void Repeat(IDvInvocationStd &invocation, bool &value) override {
    value = RequireBool(invocation, Snapshot(invocation, bridge_, "Playlist"),
                        "repeat");
  }
  void SetShuffle(IDvInvocationStd &invocation, bool value) override {
    Command(invocation, "SetShuffle", BoolArg("shuffle", value));
  }
  void Shuffle(IDvInvocationStd &invocation, bool &value) override {
    value = RequireBool(invocation, Snapshot(invocation, bridge_, "Playlist"),
                        "shuffle");
  }
  void SeekSecondAbsolute(IDvInvocationStd &invocation,
                          std::uint32_t value) override {
    Command(invocation, "SeekSecondAbsolute", UintArg("seconds", value));
  }
  void SeekSecondRelative(IDvInvocationStd &invocation,
                          std::int32_t value) override {
    Command(invocation, "SeekSecondRelative", IntArg("seconds", value));
  }
  void SeekId(IDvInvocationStd &invocation, std::uint32_t value) override {
    Command(invocation, "SeekId", UintArg("id", value));
  }
  void SeekIndex(IDvInvocationStd &invocation, std::uint32_t value) override {
    Command(invocation, "SeekIndex", UintArg("index", value));
  }
  void TransportState(IDvInvocationStd &invocation,
                      std::string &value) override {
    value = RequireString(invocation, Snapshot(invocation, bridge_, "Playlist"),
                          "transportState");
  }
  void Id(IDvInvocationStd &invocation, std::uint32_t &value) override {
    value = RequireUint(invocation, Snapshot(invocation, bridge_, "Playlist"),
                        "currentId");
  }
  void Read(IDvInvocationStd &invocation, std::uint32_t id, std::string &uri,
            std::string &metadata) override {
    const auto result =
        Invoke(invocation, bridge_, "Playlist", "Read", UintArg("id", id));
    uri = RequireString(invocation, result, "uri");
    metadata = RequireString(invocation, result, "metadata");
  }
  void ReadList(IDvInvocationStd &invocation, const std::string &idList,
                std::string &trackList) override {
    JsonValue::Object args;
    args.emplace("idList", JsonValue(idList));
    const auto result =
        Invoke(invocation, bridge_, "Playlist", "ReadList", std::move(args));
    const JsonValue *tracks = result.Find("tracks");
    if (!tracks || !tracks->IsArray()) {
      ReportActionError(invocation, 501,
                        "The player returned an invalid response.");
    }
    std::ostringstream xml;
    xml << "<TrackList>";
    for (const auto &track : tracks->AsArray()) {
      const auto id = track.GetUInt32("id");
      const auto uri = track.GetString("uri");
      const auto metadata = track.GetString("metadata");
      if (!id || !uri || !metadata) {
        ReportActionError(invocation, 501,
                          "The player returned an invalid response.");
      }
      xml << "<Entry><Id>" << *id << "</Id><Uri>" << XmlEscape(*uri)
          << "</Uri><Metadata>" << XmlEscape(*metadata)
          << "</Metadata></Entry>";
    }
    xml << "</TrackList>";
    trackList = std::move(xml).str();
  }
  void Insert(IDvInvocationStd &invocation, std::uint32_t afterId,
              const std::string &uri, const std::string &metadata,
              std::uint32_t &newId) override {
    JsonValue::Object args;
    args.emplace("afterId", JsonValue(static_cast<double>(afterId)));
    args.emplace("uri", JsonValue(uri));
    args.emplace("metadata", JsonValue(metadata));
    const auto result =
        Invoke(invocation, bridge_, "Playlist", "Insert", std::move(args));
    newId = RequireUint(invocation, result, "newId");
  }
  void DeleteId(IDvInvocationStd &invocation, std::uint32_t value) override {
    Command(invocation, "DeleteId", UintArg("id", value));
  }
  void DeleteAll(IDvInvocationStd &invocation) override {
    Command(invocation, "DeleteAll");
  }
  void TracksMax(IDvInvocationStd &invocation, std::uint32_t &value) override {
    value = RequireUint(invocation, Snapshot(invocation, bridge_, "Playlist"),
                        "tracksMax");
  }
  void IdArray(IDvInvocationStd &invocation, std::uint32_t &token,
               std::string &array) override {
    const auto result = Invoke(invocation, bridge_, "Playlist", "IdArray");
    token = RequireUint(invocation, result, "token");
    const auto encoded = RequireString(invocation, result, "array");
    auto decoded = DecodeBase64(encoded);
    if (!decoded || decoded->size() % 4 != 0) {
      ReportActionError(invocation, 501,
                        "The player returned an invalid response.");
    }
    array = std::move(*decoded);
  }
  void IdArrayChanged(IDvInvocationStd &invocation, std::uint32_t token,
                      bool &value) override {
    const auto snapshot = Snapshot(invocation, bridge_, "Playlist");
    value = token != RequireUint(invocation, snapshot, "idArrayToken");
  }
  void ProtocolInfo(IDvInvocationStd &, std::string &value) override {
    value = kProtocolInfo;
  }

  ProtocolBridge &bridge_;
};

class InfoProvider final : public DvProviderAvOpenhomeOrgInfo1Cpp {
public:
  InfoProvider(DvDeviceStd &device, ProtocolBridge &bridge)
      : DvProviderAvOpenhomeOrgInfo1Cpp(device), bridge_(bridge) {
    EnablePropertyTrackCount();
    EnablePropertyDetailsCount();
    EnablePropertyMetatextCount();
    EnablePropertyUri();
    EnablePropertyMetadata();
    EnablePropertyDuration();
    EnablePropertyBitRate();
    EnablePropertyBitDepth();
    EnablePropertySampleRate();
    EnablePropertyLossless();
    EnablePropertyCodecName();
    EnablePropertyMetatext();
    EnableActionCounters();
    EnableActionTrack();
    EnableActionDetails();
    EnableActionMetatext();
    SetPropertyTrackCount(0);
    SetPropertyDetailsCount(0);
    SetPropertyMetatextCount(0);
    SetPropertyUri("");
    SetPropertyMetadata("");
    SetPropertyDuration(0);
    SetPropertyBitRate(0);
    SetPropertyBitDepth(0);
    SetPropertySampleRate(0);
    SetPropertyLossless(false);
    SetPropertyCodecName("");
    SetPropertyMetatext("");
  }

  void Apply(const SnapshotValues &values) {
    AutoPropertyLock lock(*this);
    SetPropertyTrackCount(values.trackToken);
    SetPropertyDetailsCount(values.detailsToken);
    SetPropertyUri(values.uri);
    SetPropertyMetadata(values.metadata);
    SetPropertyDuration(values.duration);
    SetPropertyBitRate(values.bitrate);
    SetPropertyBitDepth(values.bitDepth);
    SetPropertySampleRate(values.sampleRate);
    SetPropertyLossless(values.lossless);
    SetPropertyCodecName(values.codecName);
  }

private:
  void Counters(IDvInvocationStd &invocation, std::uint32_t &trackCount,
                std::uint32_t &detailsCount,
                std::uint32_t &metatextCount) override {
    const auto result = Snapshot(invocation, bridge_, "Info");
    trackCount = RequireUint(invocation, result, "trackToken");
    detailsCount = RequireUint(invocation, result, "detailsToken");
    metatextCount = 0;
  }
  void Track(IDvInvocationStd &invocation, std::string &uri,
             std::string &metadata) override {
    const auto result = Snapshot(invocation, bridge_, "Info");
    uri = RequireString(invocation, result, "uri");
    metadata = RequireString(invocation, result, "metadata");
  }
  void Details(IDvInvocationStd &invocation, std::uint32_t &duration,
               std::uint32_t &bitRate, std::uint32_t &bitDepth,
               std::uint32_t &sampleRate, bool &lossless,
               std::string &codecName) override {
    const auto result = Snapshot(invocation, bridge_, "Info");
    duration = RequireUint(invocation, result, "duration");
    bitRate = RequireUint(invocation, result, "bitrate");
    bitDepth = RequireUint(invocation, result, "bitDepth");
    sampleRate = RequireUint(invocation, result, "sampleRate");
    lossless = RequireBool(invocation, result, "lossless");
    codecName = RequireString(invocation, result, "codecName");
  }
  void Metatext(IDvInvocationStd &, std::string &value) override {
    value.clear();
  }

  ProtocolBridge &bridge_;
};

class TimeProvider final : public DvProviderAvOpenhomeOrgTime1Cpp {
public:
  TimeProvider(DvDeviceStd &device, ProtocolBridge &bridge)
      : DvProviderAvOpenhomeOrgTime1Cpp(device), bridge_(bridge) {
    EnablePropertyTrackCount();
    EnablePropertyDuration();
    EnablePropertySeconds();
    EnableActionTime();
    SetPropertyTrackCount(0);
    SetPropertyDuration(0);
    SetPropertySeconds(0);
  }

  void Apply(const SnapshotValues &values) {
    AutoPropertyLock lock(*this);
    SetPropertyTrackCount(values.trackToken);
    SetPropertyDuration(values.duration);
    SetPropertySeconds(values.seconds);
  }

private:
  void Time(IDvInvocationStd &invocation, std::uint32_t &trackCount,
            std::uint32_t &duration, std::uint32_t &seconds) override {
    const auto result = Snapshot(invocation, bridge_, "Time");
    trackCount = RequireUint(invocation, result, "trackToken");
    duration = RequireUint(invocation, result, "duration");
    seconds = RequireUint(invocation, result, "seconds");
  }

  ProtocolBridge &bridge_;
};

} // namespace

class OpenHomeProviders::Impl {
public:
  Impl(DvDeviceStd &device, ProtocolBridge &bridge, std::string friendlyName)
      : product(device, std::move(friendlyName)), playlist(device, bridge),
        info(device, bridge), time(device, bridge) {}

  ProductProvider product;
  PlaylistProvider playlist;
  InfoProvider info;
  TimeProvider time;
};

OpenHomeProviders::OpenHomeProviders(DvDeviceStd &device,
                                     ProtocolBridge &bridge,
                                     std::string friendlyName)
    : impl_(std::make_unique<Impl>(device, bridge, std::move(friendlyName))) {}

OpenHomeProviders::~OpenHomeProviders() = default;

bool OpenHomeProviders::ApplySnapshot(const JsonValue &snapshot) {
  auto values = ParseSnapshot(snapshot);
  if (!values)
    return false;
  impl_->playlist.Apply(*values);
  impl_->info.Apply(*values);
  impl_->time.Apply(*values);
  return true;
}

} // namespace effetune::openhome
