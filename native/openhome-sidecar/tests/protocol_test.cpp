#include "protocol.h"

#include <chrono>
#include <condition_variable>
#include <deque>
#include <future>
#include <iostream>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <streambuf>
#include <string>
#include <thread>
#include <vector>

namespace {

using effetune::openhome::JsonError;
using effetune::openhome::JsonValue;
using effetune::openhome::kInvokeTransportTimeout;
using effetune::openhome::kMaxJsonContainerItems;
using effetune::openhome::kMaxProtocolLineBytes;
using effetune::openhome::ProtocolBridge;
using effetune::openhome::ProtocolConfiguration;
using effetune::openhome::RunResult;
using namespace std::chrono_literals;

void Check(bool condition, const char *message) {
  if (!condition)
    throw std::runtime_error(message);
}

template <typename Callback>
void ExpectJsonError(Callback callback, const char *message) {
  try {
    callback();
  } catch (const JsonError &) {
    return;
  }
  throw std::runtime_error(message);
}

class BlockingInputBuffer : public std::streambuf {
public:
  ~BlockingInputBuffer() override { Close(); }

  void Append(std::string_view value) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      for (const char character : value)
        data_.push_back(character);
    }
    condition_.notify_one();
  }

  void Close() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      closed_ = true;
    }
    condition_.notify_all();
  }

protected:
  int_type underflow() override {
    std::unique_lock<std::mutex> lock(mutex_);
    condition_.wait(lock, [&] { return closed_ || !data_.empty(); });
    if (data_.empty())
      return traits_type::eof();
    current_ = data_.front();
    data_.pop_front();
    setg(&current_, &current_, &current_ + 1);
    return traits_type::to_int_type(current_);
  }

private:
  std::mutex mutex_;
  std::condition_variable condition_;
  std::deque<char> data_;
  char current_ = 0;
  bool closed_ = false;
};

class CollectingOutputBuffer : public std::streambuf {
public:
  bool WaitForLineCount(std::size_t count,
                        std::chrono::milliseconds timeout = 2s) {
    std::unique_lock<std::mutex> lock(mutex_);
    return condition_.wait_for(lock, timeout,
                               [&] { return lineCount_ >= count; });
  }

  std::vector<std::string> Lines() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> lines;
    std::size_t begin = 0;
    while (begin < data_.size()) {
      const std::size_t end = data_.find('\n', begin);
      if (end == std::string::npos)
        break;
      lines.push_back(data_.substr(begin, end - begin));
      begin = end + 1;
    }
    return lines;
  }

protected:
  std::streamsize xsputn(const char *value, std::streamsize count) override {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      data_.append(value, static_cast<std::size_t>(count));
      for (std::streamsize index = 0; index < count; ++index) {
        if (value[index] == '\n')
          ++lineCount_;
      }
    }
    condition_.notify_all();
    return count;
  }

  int_type overflow(int_type value) override {
    if (traits_type::eq_int_type(value, traits_type::eof())) {
      return traits_type::not_eof(value);
    }
    {
      std::lock_guard<std::mutex> lock(mutex_);
      const char character = traits_type::to_char_type(value);
      data_.push_back(character);
      if (character == '\n')
        ++lineCount_;
    }
    condition_.notify_all();
    return value;
  }

private:
  mutable std::mutex mutex_;
  std::condition_variable condition_;
  std::string data_;
  std::size_t lineCount_ = 0;
};

std::string ConfigureLine(std::string_view friendlyName = "EffeTune",
                          std::string_view udn = "uuid:test-device",
                          int version = 1) {
  return JsonValue(
             JsonValue::Object{
                 {"type", JsonValue("configure")},
                 {"protocolVersion", JsonValue(static_cast<double>(version))},
                 {"device",
                  JsonValue(JsonValue::Object{
                      {"friendlyName", JsonValue(std::string(friendlyName))},
                      {"udn", JsonValue(std::string(udn))}})}})
             .Serialize() +
         "\n";
}

void TestJsonParserAndSerializer() {
  const JsonValue value = JsonValue::Parse(
      R"({"array":[true,false,null,-12.5e2],"escaped":"A\u00df\u6771\ud834\udd1e","quote":"\"\\\n"})");
  Check(value.IsObject(), "root must be an object");
  Check(value.GetString("escaped") ==
            std::optional<std::string_view>(u8"Aß東𝄞"),
        "unicode escapes must decode to UTF-8");
  Check(value.Find("array") && value.Find("array")->AsArray().size() == 4,
        "array values must parse");
  Check(value.Find("array")->AsArray()[3].AsNumber() == -1250,
        "JSON numbers must parse");

  const JsonValue reparsed = JsonValue::Parse(value.Serialize());
  Check(reparsed.GetString("quote") == value.GetString("quote"),
        "serialized escapes must round-trip");
  Check(!reparsed.GetBool("array"), "typed accessors must reject wrong types");
  Check(JsonValue::Parse(R"({"id":4294967295})").GetUInt32("id") ==
            std::optional<std::uint32_t>(4294967295U),
        "uint32 accessor must accept its upper bound");
  Check(!JsonValue::Parse(R"({"id":-1})").GetUInt32("id"),
        "uint32 accessor must reject negatives");

  ExpectJsonError([] { JsonValue::Parse(R"({"a":1,"a":2})"); },
                  "duplicate object keys must fail");
  ExpectJsonError([] { JsonValue::Parse(R"("\ud800")"); },
                  "unpaired surrogates must fail");
  ExpectJsonError([] { JsonValue::Parse("01"); },
                  "invalid number grammar must fail");
}

void TestJsonBounds() {
  const std::string tooLarge(kMaxProtocolLineBytes + 1, ' ');
  ExpectJsonError([&] { JsonValue::Parse(tooLarge); },
                  "oversized JSON must fail");

  std::string tooDeep(34, '[');
  tooDeep += '0';
  tooDeep.append(34, ']');
  ExpectJsonError([&] { JsonValue::Parse(tooDeep); },
                  "overly deep JSON must fail");

  std::string tooManyItems = "[";
  for (std::size_t index = 0; index <= kMaxJsonContainerItems; ++index) {
    if (index != 0)
      tooManyItems += ',';
    tooManyItems += '0';
  }
  tooManyItems += ']';
  ExpectJsonError([&] { JsonValue::Parse(tooManyItems); },
                  "oversized containers must fail");

  const JsonValue oversizedString(std::string(kMaxProtocolLineBytes, 'x'));
  ExpectJsonError([&] { oversizedString.Serialize(); },
                  "oversized serialized JSON must fail");
}

void TestInvokeTransportDeadlineFollowsHostDeadline() {
  Check(kInvokeTransportTimeout == 12s,
        "native transport safety timeout must include IPC grace");
  Check(kInvokeTransportTimeout > 10s,
        "native transport safety timeout must not beat the host deadline");
}

void TestConfigureStateAndShutdown() {
  std::istringstream input(
      ConfigureLine() +
      R"({"type":"state","snapshot":{"transportState":"Playing","position":3}})"
      "\n" +
      R"({"type":"shutdown"})"
      "\n");
  std::ostringstream output;
  ProtocolConfiguration configuration;
  JsonValue snapshot;
  ProtocolBridge bridge(output);
  const RunResult result = bridge.Run(
      input,
      [&](const ProtocolConfiguration &value) {
        configuration = value;
        return true;
      },
      [&](const JsonValue &value) { snapshot = value; });

  Check(result == RunResult::kShutdown, "shutdown must stop the run loop");
  Check(configuration.friendlyName == "EffeTune" &&
            configuration.udn == "uuid:test-device",
        "configure callback must receive validated fields");
  Check(snapshot.GetString("transportState") ==
            std::optional<std::string_view>("Playing"),
        "state callback must receive the snapshot");

  std::istringstream framed(output.str());
  std::string readyLine;
  Check(static_cast<bool>(std::getline(framed, readyLine)),
        "ready must be emitted as one NDJSON line");
  const JsonValue ready = JsonValue::Parse(readyLine);
  Check(ready.GetString("type") == std::optional<std::string_view>("ready") &&
            ready.GetUInt32("protocolVersion") ==
                std::optional<std::uint32_t>(1),
        "ready frame must identify protocol version 1");
  Check(!static_cast<bool>(std::getline(framed, readyLine)),
        "successful lifecycle must not emit unexpected frames");
}

void TestConfigureFailsClosed() {
  for (const std::string &configuration :
       {ConfigureLine("EffeTune", "uuid:test-device", 2),
        ConfigureLine("EffeTune", ""),
        ConfigureLine(std::string(129, 'x'), "uuid:test-device")}) {
    std::istringstream input(configuration);
    std::ostringstream output;
    bool callbackCalled = false;
    ProtocolBridge bridge(output);
    const RunResult result = bridge.Run(input,
                                        [&](const ProtocolConfiguration &) {
                                          callbackCalled = true;
                                          return true;
                                        },
                                        {});
    Check(result == RunResult::kProtocolError,
          "invalid configure must fail closed");
    Check(!callbackCalled, "invalid configure must not reach the callback");
    Check(output.str().find("\"type\":\"ready\"") == std::string::npos,
          "invalid configure must not emit ready");
  }
}

void TestResponseCorrelationAndFraming() {
  BlockingInputBuffer inputBuffer;
  std::istream input(&inputBuffer);
  CollectingOutputBuffer outputBuffer;
  std::ostream output(&outputBuffer);
  ProtocolBridge bridge(output);

  auto run = std::async(std::launch::async, [&] {
    return bridge.Run(input, [](const ProtocolConfiguration &) { return true; },
                      {});
  });
  inputBuffer.Append(ConfigureLine());
  Check(outputBuffer.WaitForLineCount(1), "ready frame timed out");

  auto rejected = std::async(std::launch::async, [&] {
    return bridge.Invoke("Playlist", "Read", JsonValue::Object{}, 2s);
  });
  Check(outputBuffer.WaitForLineCount(2), "first action frame timed out");
  std::vector<std::string> lines = outputBuffer.Lines();
  Check(lines.size() >= 2, "action must be a complete NDJSON frame");
  const JsonValue firstAction = JsonValue::Parse(lines[1]);
  Check(firstAction.GetString("requestId") ==
                std::optional<std::string_view>("r1") &&
            firstAction.GetString("service") ==
                std::optional<std::string_view>("Playlist") &&
            firstAction.Find("args") && firstAction.Find("args")->IsObject(),
        "action frame must contain bounded correlation fields");
  inputBuffer.Append(
      R"({"type":"response","requestId":"r1","ok":false,"error":{"code":"track-missing"}})"
      "\n");
  const auto rejectedResponse = rejected.get();
  Check(rejectedResponse && !rejectedResponse->ok &&
            rejectedResponse->errorCode == "track-missing",
        "error response must correlate and expose only its code");

  auto accepted = std::async(std::launch::async, [&] {
    return bridge.Invoke("Time", "Time", JsonValue::Object{}, 2s);
  });
  Check(outputBuffer.WaitForLineCount(3), "second action frame timed out");
  lines = outputBuffer.Lines();
  const JsonValue secondAction = JsonValue::Parse(lines[2]);
  Check(secondAction.GetString("requestId") ==
            std::optional<std::string_view>("r2"),
        "request IDs must be short and monotonic");
  inputBuffer.Append(
      R"({"type":"response","requestId":"r2","ok":true,"result":{"position":17}})"
      "\n");
  const auto acceptedResponse = accepted.get();
  Check(acceptedResponse && acceptedResponse->ok &&
            acceptedResponse->result.GetUInt32("position") ==
                std::optional<std::uint32_t>(17),
        "success response must return its bounded result");

  JsonValue::Object oversizedArgs;
  oversizedArgs.emplace("metadata",
                        JsonValue(std::string(kMaxProtocolLineBytes, 'x')));
  const auto oversized = bridge.Invoke("Playlist", "Insert",
                                       JsonValue(std::move(oversizedArgs)), 2s);
  Check(oversized && !oversized->ok &&
            oversized->errorCode == "request-too-large",
        "oversized action input must fail only that invocation");
  Check(outputBuffer.Lines().size() == 3,
        "oversized action input must not emit a partial frame");

  auto pending = std::async(std::launch::async, [&] {
    return bridge.Invoke("Playlist", "Play", JsonValue::Object{}, 2s);
  });
  Check(outputBuffer.WaitForLineCount(4), "pending action frame timed out");
  inputBuffer.Close();
  Check(!pending.get(), "EOF must release pending actions without a response");
  Check(run.get() == RunResult::kEndOfFile, "closed input must report EOF");

  for (const std::string &line : outputBuffer.Lines()) {
    Check(line.size() < kMaxProtocolLineBytes,
          "output frame must stay bounded");
    Check(JsonValue::Parse(line).IsObject(),
          "concurrent output must never interleave NDJSON frames");
  }
}

} // namespace

int main() {
  try {
    TestJsonParserAndSerializer();
    TestJsonBounds();
    TestInvokeTransportDeadlineFollowsHostDeadline();
    TestConfigureStateAndShutdown();
    TestConfigureFailsClosed();
    TestResponseCorrelationAndFraming();
    std::cout << "protocol tests passed\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "protocol test failed: " << error.what() << '\n';
    return 1;
  }
}
