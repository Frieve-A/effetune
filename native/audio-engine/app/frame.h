#pragma once

#include "protocol.h"
#include <cstdint>
#include <functional>
#include <iosfwd>
#include <vector>

namespace effetune::audio {
using openhome::JsonValue;
enum class FrameKind : std::uint8_t { Control = 1, Feed, Telemetry, Network };
struct Frame {
  FrameKind kind = FrameKind::Control;
  JsonValue message;
  std::vector<std::uint8_t> attachment;
};

// A clean EOF is the only false result. Truncation is a protocol error.
// Inbound multipart instrument transfers may carry real-time source frames
// and source controls between parts.
bool isFileControl(const JsonValue &message);
bool readFrame(std::istream &input, Frame &frame,
               const std::function<void(const Frame &)> &onFeed = {});
void writeFrame(std::ostream &output, const Frame &frame);
} // namespace effetune::audio
