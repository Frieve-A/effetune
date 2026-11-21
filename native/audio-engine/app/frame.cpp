#include "frame.h"
#include <algorithm>
#include <array>
#include <istream>
#include <ostream>
#include <span>

namespace effetune::audio {
namespace {
constexpr std::uint32_t maxFrame = 64u * 1024u * 1024u;
constexpr std::uint32_t maxAttachment = 1024u * 1024u * 1024u;
constexpr std::size_t chunkBytes = 4u * 1024u * 1024u;
std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return std::uint32_t(bytes[0]) | (std::uint32_t(bytes[1]) << 8u) |
         (std::uint32_t(bytes[2]) << 16u) | (std::uint32_t(bytes[3]) << 24u);
}
void writeU32(std::ostream &output, std::uint32_t value) {
  for (unsigned shift = 0; shift != 32; shift += 8)
    output.put(static_cast<char>(value >> shift));
}
bool instrumentMessage(const JsonValue &message) {
  const auto type = message.GetString("type");
  return type == "sfzCheckpoints" || type == "midiCheckpoints" || type == "sfzRuntimeStarted" ||
         type == "soundFontMixerActionApplied" || type == "midiTransport" ||
         type == "sfzStartRuntime";
}
bool readWire(std::istream &input, Frame &frame) {
  std::array<std::uint8_t, 9> header{};
  if (!input.read(reinterpret_cast<char *>(header.data()), 4)) {
    if (!input.bad() && input.eof() && input.gcount() == 0)
      return false;
    throw std::runtime_error("truncated frame header");
  }
  const auto length = readU32(header.data());
  if (length < 5 || length > maxFrame)
    throw std::runtime_error("invalid frame length");
  if (!input.read(reinterpret_cast<char *>(header.data() + 4), 5))
    throw std::runtime_error("truncated metadata header");
  const auto jsonSize = readU32(header.data() + 5);
  if (jsonSize > length - 5 || jsonSize > openhome::kMaxProtocolLineBytes || header[4] < 1 ||
      header[4] > 4)
    throw std::runtime_error("invalid frame header");
  std::string json(jsonSize, '\0');
  if (!input.read(json.data(), jsonSize))
    throw std::runtime_error("truncated JSON header");
  frame.message = JsonValue::Parse(json);
  if (!frame.message.IsObject())
    throw std::runtime_error("expected metadata object");
  frame.kind = static_cast<FrameKind>(header[4]);
  frame.attachment.resize(length - 5 - jsonSize);
  if (!frame.attachment.empty() &&
      !input.read(reinterpret_cast<char *>(frame.attachment.data()), frame.attachment.size()))
    throw std::runtime_error("truncated binary attachment");
  return true;
}

void writeWire(std::ostream &output, FrameKind kind, const std::string &json,
               std::span<const std::uint8_t> bytes) {
  if (json.size() > openhome::kMaxProtocolLineBytes || bytes.size() > maxFrame - 5 - json.size())
    throw std::runtime_error("invalid outgoing frame");
  writeU32(output, static_cast<std::uint32_t>(5 + json.size() + bytes.size()));
  output.put(static_cast<char>(kind));
  writeU32(output, static_cast<std::uint32_t>(json.size()));
  output.write(json.data(), json.size());
  if (!bytes.empty())
    output.write(reinterpret_cast<const char *>(bytes.data()), bytes.size());
  if (!output.flush())
    throw std::runtime_error("failed writing frame");
}
} // namespace

bool readFrame(std::istream &input, Frame &frame,
               const std::function<void(const Frame &)> &onFeed) {
  if (!readWire(input, frame))
    return false;
  if (frame.message.GetString("type") != "attachmentPart")
    return true;
  const auto total = frame.message.GetUInt32("byteLength").value_or(0);
  const auto *target = frame.message.Find("message");
  if (!target || !instrumentMessage(*target) || !total || total > maxAttachment)
    throw std::runtime_error("invalid instrument attachment");
  Frame assembled{FrameKind::Control, *target, {}};
  assembled.attachment.reserve(total);
  for (;;) {
    const auto offset = assembled.attachment.size();
    if (frame.kind != FrameKind::Control || frame.message.GetString("type") != "attachmentPart" ||
        frame.message.GetUInt32("offset") != offset || frame.attachment.empty() ||
        frame.attachment.size() > total - offset)
      throw std::runtime_error("invalid instrument chunk");
    assembled.attachment.insert(assembled.attachment.end(), frame.attachment.begin(),
                                frame.attachment.end());
    if (assembled.attachment.size() == total)
      break;
    for (;;) {
      if (!readWire(input, frame))
        throw std::runtime_error("truncated instrument attachment");
      if (!onFeed ||
          (frame.kind != FrameKind::Feed &&
           (frame.kind != FrameKind::Control || frame.message.GetString("type") != "feedSilence")))
        break;
      onFeed(frame);
    }
  }
  frame = std::move(assembled);
  return true;
}

void writeFrame(std::ostream &output, const Frame &frame) {
  if (!frame.message.IsObject())
    throw std::runtime_error("invalid outgoing metadata");
  const auto json = frame.message.Serialize();
  if (frame.attachment.size() <= chunkBytes || frame.kind != FrameKind::Control ||
      !instrumentMessage(frame.message)) {
    writeWire(output, frame.kind, json, frame.attachment);
    return;
  }
  if (frame.attachment.size() > maxAttachment)
    throw std::runtime_error("instrument attachment too large");
  const std::span<const std::uint8_t> bytes(frame.attachment);
  for (std::size_t offset = 0; offset < bytes.size(); offset += chunkBytes) {
    JsonValue::Object part{{"type", "attachmentPart"}, {"offset", double(offset)}};
    if (!offset) {
      part.emplace("byteLength", double(bytes.size()));
      part.emplace("message", frame.message);
    }
    writeWire(output, frame.kind, JsonValue(std::move(part)).Serialize(),
              bytes.subspan(offset, std::min(chunkBytes, bytes.size() - offset)));
  }
}
} // namespace effetune::audio
