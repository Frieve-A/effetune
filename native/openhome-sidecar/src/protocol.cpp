#include "protocol.h"

#include <atomic>
#include <cmath>
#include <condition_variable>
#include <iomanip>
#include <istream>
#include <limits>
#include <locale>
#include <mutex>
#include <ostream>
#include <sstream>
#include <unordered_map>
#include <utility>

namespace effetune::openhome {
namespace {

constexpr std::chrono::milliseconds kMaxInvokeTimeout =
    std::chrono::seconds(30);
constexpr std::size_t kMaxPendingRequests = 128;

bool IsContinuationByte(unsigned char value) {
  return (value & 0xc0U) == 0x80U;
}

bool IsValidUtf8(std::string_view value) {
  std::size_t index = 0;
  while (index < value.size()) {
    const auto first = static_cast<unsigned char>(value[index]);
    if (first <= 0x7fU) {
      ++index;
      continue;
    }
    if (first >= 0xc2U && first <= 0xdfU) {
      if (index + 1 >= value.size() ||
          !IsContinuationByte(static_cast<unsigned char>(value[index + 1]))) {
        return false;
      }
      index += 2;
      continue;
    }
    if (first >= 0xe0U && first <= 0xefU) {
      if (index + 2 >= value.size())
        return false;
      const auto second = static_cast<unsigned char>(value[index + 1]);
      const auto third = static_cast<unsigned char>(value[index + 2]);
      if (!IsContinuationByte(second) || !IsContinuationByte(third) ||
          (first == 0xe0U && second < 0xa0U) ||
          (first == 0xedU && second >= 0xa0U)) {
        return false;
      }
      index += 3;
      continue;
    }
    if (first >= 0xf0U && first <= 0xf4U) {
      if (index + 3 >= value.size())
        return false;
      const auto second = static_cast<unsigned char>(value[index + 1]);
      const auto third = static_cast<unsigned char>(value[index + 2]);
      const auto fourth = static_cast<unsigned char>(value[index + 3]);
      if (!IsContinuationByte(second) || !IsContinuationByte(third) ||
          !IsContinuationByte(fourth) || (first == 0xf0U && second < 0x90U) ||
          (first == 0xf4U && second >= 0x90U)) {
        return false;
      }
      index += 4;
      continue;
    }
    return false;
  }
  return true;
}

std::size_t Utf8CodePointCount(std::string_view value) {
  std::size_t count = 0;
  for (std::size_t index = 0; index < value.size(); ++count) {
    const auto first = static_cast<unsigned char>(value[index]);
    index += first <= 0x7fU ? 1 : first <= 0xdfU ? 2 : first <= 0xefU ? 3 : 4;
  }
  return count;
}

void AppendUtf8(std::string &output, std::uint32_t codePoint) {
  if (codePoint <= 0x7fU) {
    output.push_back(static_cast<char>(codePoint));
  } else if (codePoint <= 0x7ffU) {
    output.push_back(static_cast<char>(0xc0U | (codePoint >> 6U)));
    output.push_back(static_cast<char>(0x80U | (codePoint & 0x3fU)));
  } else if (codePoint <= 0xffffU) {
    output.push_back(static_cast<char>(0xe0U | (codePoint >> 12U)));
    output.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3fU)));
    output.push_back(static_cast<char>(0x80U | (codePoint & 0x3fU)));
  } else {
    output.push_back(static_cast<char>(0xf0U | (codePoint >> 18U)));
    output.push_back(static_cast<char>(0x80U | ((codePoint >> 12U) & 0x3fU)));
    output.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3fU)));
    output.push_back(static_cast<char>(0x80U | (codePoint & 0x3fU)));
  }
}

class JsonParser {
public:
  explicit JsonParser(std::string_view input) : input_(input) {
    if (input.size() > kMaxProtocolLineBytes)
      throw JsonError("json-too-large");
  }

  JsonValue Parse() {
    SkipWhitespace();
    JsonValue value = ParseValue(0);
    SkipWhitespace();
    if (position_ != input_.size())
      throw JsonError("json-trailing-data");
    return value;
  }

private:
  JsonValue ParseValue(std::size_t depth) {
    if (depth > kMaxJsonDepth || ++nodes_ > kMaxJsonNodes) {
      throw JsonError("json-limit");
    }
    if (position_ >= input_.size())
      throw JsonError("json-unexpected-end");
    const char value = input_[position_];
    if (value == 'n')
      return ParseLiteral("null", JsonValue(nullptr));
    if (value == 't')
      return ParseLiteral("true", JsonValue(true));
    if (value == 'f')
      return ParseLiteral("false", JsonValue(false));
    if (value == '"')
      return JsonValue(ParseString());
    if (value == '[')
      return ParseArray(depth);
    if (value == '{')
      return ParseObject(depth);
    if (value == '-' || (value >= '0' && value <= '9'))
      return ParseNumber();
    throw JsonError("json-invalid-value");
  }

  JsonValue ParseLiteral(std::string_view literal, JsonValue value) {
    if (input_.substr(position_, literal.size()) != literal) {
      throw JsonError("json-invalid-literal");
    }
    position_ += literal.size();
    return value;
  }

  JsonValue ParseArray(std::size_t depth) {
    ++position_;
    SkipWhitespace();
    JsonValue::Array values;
    if (Consume(']'))
      return JsonValue(std::move(values));
    while (true) {
      if (values.size() >= kMaxJsonContainerItems)
        throw JsonError("json-limit");
      values.push_back(ParseValue(depth + 1));
      SkipWhitespace();
      if (Consume(']'))
        break;
      Require(',');
      SkipWhitespace();
    }
    return JsonValue(std::move(values));
  }

  JsonValue ParseObject(std::size_t depth) {
    ++position_;
    SkipWhitespace();
    JsonValue::Object values;
    if (Consume('}'))
      return JsonValue(std::move(values));
    while (true) {
      if (values.size() >= kMaxJsonContainerItems)
        throw JsonError("json-limit");
      if (position_ >= input_.size() || input_[position_] != '"') {
        throw JsonError("json-invalid-object");
      }
      std::string key = ParseString();
      SkipWhitespace();
      Require(':');
      SkipWhitespace();
      JsonValue value = ParseValue(depth + 1);
      if (!values.emplace(std::move(key), std::move(value)).second) {
        throw JsonError("json-duplicate-key");
      }
      SkipWhitespace();
      if (Consume('}'))
        break;
      Require(',');
      SkipWhitespace();
    }
    return JsonValue(std::move(values));
  }

  JsonValue ParseNumber() {
    const std::size_t begin = position_;
    Consume('-');
    if (Consume('0')) {
      if (position_ < input_.size() && input_[position_] >= '0' &&
          input_[position_] <= '9') {
        throw JsonError("json-invalid-number");
      }
    } else {
      ParseDigits();
    }
    if (Consume('.'))
      ParseDigits();
    if (position_ < input_.size() &&
        (input_[position_] == 'e' || input_[position_] == 'E')) {
      ++position_;
      if (position_ < input_.size() &&
          (input_[position_] == '+' || input_[position_] == '-')) {
        ++position_;
      }
      ParseDigits();
    }

    std::istringstream stream(
        std::string(input_.substr(begin, position_ - begin)));
    stream.imbue(std::locale::classic());
    stream >> std::noskipws;
    double number = 0;
    stream >> number;
    if (!stream.eof() || stream.fail() || !std::isfinite(number)) {
      throw JsonError("json-invalid-number");
    }
    return JsonValue(number);
  }

  void ParseDigits() {
    const std::size_t begin = position_;
    while (position_ < input_.size() && input_[position_] >= '0' &&
           input_[position_] <= '9') {
      ++position_;
    }
    if (position_ == begin)
      throw JsonError("json-invalid-number");
  }

  std::string ParseString() {
    Require('"');
    std::string result;
    while (position_ < input_.size()) {
      const unsigned char value =
          static_cast<unsigned char>(input_[position_++]);
      if (value == '"') {
        if (!IsValidUtf8(result))
          throw JsonError("json-invalid-utf8");
        return result;
      }
      if (value < 0x20U)
        throw JsonError("json-invalid-string");
      if (value != '\\') {
        result.push_back(static_cast<char>(value));
        continue;
      }
      if (position_ >= input_.size())
        throw JsonError("json-invalid-escape");
      const char escape = input_[position_++];
      switch (escape) {
      case '"':
        result.push_back('"');
        break;
      case '\\':
        result.push_back('\\');
        break;
      case '/':
        result.push_back('/');
        break;
      case 'b':
        result.push_back('\b');
        break;
      case 'f':
        result.push_back('\f');
        break;
      case 'n':
        result.push_back('\n');
        break;
      case 'r':
        result.push_back('\r');
        break;
      case 't':
        result.push_back('\t');
        break;
      case 'u':
        ParseUnicodeEscape(result);
        break;
      default:
        throw JsonError("json-invalid-escape");
      }
    }
    throw JsonError("json-unexpected-end");
  }

  void ParseUnicodeEscape(std::string &output) {
    std::uint32_t codePoint = ParseHexQuad();
    if (codePoint >= 0xd800U && codePoint <= 0xdbffU) {
      if (position_ + 2 > input_.size() || input_[position_] != '\\' ||
          input_[position_ + 1] != 'u') {
        throw JsonError("json-invalid-surrogate");
      }
      position_ += 2;
      const std::uint32_t low = ParseHexQuad();
      if (low < 0xdc00U || low > 0xdfffU) {
        throw JsonError("json-invalid-surrogate");
      }
      codePoint = 0x10000U + ((codePoint - 0xd800U) << 10U) + (low - 0xdc00U);
    } else if (codePoint >= 0xdc00U && codePoint <= 0xdfffU) {
      throw JsonError("json-invalid-surrogate");
    }
    AppendUtf8(output, codePoint);
  }

  std::uint32_t ParseHexQuad() {
    if (position_ + 4 > input_.size())
      throw JsonError("json-invalid-unicode");
    std::uint32_t value = 0;
    for (int index = 0; index < 4; ++index) {
      const char digit = input_[position_++];
      value <<= 4U;
      if (digit >= '0' && digit <= '9') {
        value |= static_cast<std::uint32_t>(digit - '0');
      } else if (digit >= 'a' && digit <= 'f') {
        value |= static_cast<std::uint32_t>(digit - 'a' + 10);
      } else if (digit >= 'A' && digit <= 'F') {
        value |= static_cast<std::uint32_t>(digit - 'A' + 10);
      } else {
        throw JsonError("json-invalid-unicode");
      }
    }
    return value;
  }

  bool Consume(char expected) {
    if (position_ >= input_.size() || input_[position_] != expected)
      return false;
    ++position_;
    return true;
  }

  void Require(char expected) {
    if (!Consume(expected))
      throw JsonError("json-unexpected-token");
  }

  void SkipWhitespace() {
    while (position_ < input_.size()) {
      const char value = input_[position_];
      if (value != ' ' && value != '\t' && value != '\r' && value != '\n')
        break;
      ++position_;
    }
  }

  std::string_view input_;
  std::size_t position_ = 0;
  std::size_t nodes_ = 0;
};

class JsonSerializer {
public:
  std::string Serialize(const JsonValue &value) {
    AppendValue(value, 0);
    return output_;
  }

private:
  void AppendValue(const JsonValue &value, std::size_t depth) {
    if (depth > kMaxJsonDepth || ++nodes_ > kMaxJsonNodes) {
      throw JsonError("json-limit");
    }
    switch (value.type()) {
    case JsonValue::Type::kNull:
      Append("null");
      return;
    case JsonValue::Type::kBool:
      Append(value.AsBool() ? "true" : "false");
      return;
    case JsonValue::Type::kNumber:
      AppendNumber(value.AsNumber());
      return;
    case JsonValue::Type::kString:
      AppendString(value.AsString());
      return;
    case JsonValue::Type::kArray:
      AppendArray(value.AsArray(), depth);
      return;
    case JsonValue::Type::kObject:
      AppendObject(value.AsObject(), depth);
      return;
    }
  }

  void AppendNumber(double value) {
    if (!std::isfinite(value))
      throw JsonError("json-invalid-number");
    std::ostringstream stream;
    stream.imbue(std::locale::classic());
    stream << std::setprecision(std::numeric_limits<double>::max_digits10)
           << value;
    Append(stream.str());
  }

  void AppendString(std::string_view value) {
    if (!IsValidUtf8(value))
      throw JsonError("json-invalid-utf8");
    AppendChar('"');
    constexpr char kHex[] = "0123456789abcdef";
    for (const unsigned char character : value) {
      switch (character) {
      case '"':
        Append("\\\"");
        break;
      case '\\':
        Append("\\\\");
        break;
      case '\b':
        Append("\\b");
        break;
      case '\f':
        Append("\\f");
        break;
      case '\n':
        Append("\\n");
        break;
      case '\r':
        Append("\\r");
        break;
      case '\t':
        Append("\\t");
        break;
      default:
        if (character < 0x20U) {
          Append("\\u00");
          AppendChar(kHex[character >> 4U]);
          AppendChar(kHex[character & 0x0fU]);
        } else {
          AppendChar(static_cast<char>(character));
        }
      }
    }
    AppendChar('"');
  }

  void AppendArray(const JsonValue::Array &values, std::size_t depth) {
    if (values.size() > kMaxJsonContainerItems)
      throw JsonError("json-limit");
    AppendChar('[');
    bool first = true;
    for (const JsonValue &value : values) {
      if (!first)
        AppendChar(',');
      first = false;
      AppendValue(value, depth + 1);
    }
    AppendChar(']');
  }

  void AppendObject(const JsonValue::Object &values, std::size_t depth) {
    if (values.size() > kMaxJsonContainerItems)
      throw JsonError("json-limit");
    AppendChar('{');
    bool first = true;
    for (const auto &[key, value] : values) {
      if (!first)
        AppendChar(',');
      first = false;
      AppendString(key);
      AppendChar(':');
      AppendValue(value, depth + 1);
    }
    AppendChar('}');
  }

  void Append(std::string_view value) {
    if (value.size() > kMaxProtocolLineBytes - output_.size()) {
      throw JsonError("json-too-large");
    }
    output_.append(value);
  }

  void AppendChar(char value) {
    if (output_.size() >= kMaxProtocolLineBytes)
      throw JsonError("json-too-large");
    output_.push_back(value);
  }

  std::string output_;
  std::size_t nodes_ = 0;
};

bool IsValidProtocolName(std::string_view value) {
  if (value.empty() || value.size() > 64)
    return false;
  for (const unsigned char character : value) {
    if (!((character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') || character == '-')) {
      return false;
    }
  }
  return true;
}

std::string NormalizeDiagnosticCode(std::string_view code) {
  return IsValidProtocolName(code) ? std::string(code) : "sidecar-diagnostic";
}

std::string MakeRequestId(std::uint64_t value) {
  constexpr char kDigits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  char buffer[1 + 13];
  char *cursor = buffer + sizeof(buffer);
  do {
    *--cursor = kDigits[value % 36U];
    value /= 36U;
  } while (value != 0);
  *--cursor = 'r';
  return std::string(cursor, buffer + sizeof(buffer));
}

enum class ReadLineResult { kLine, kEndOfFile, kTooLarge, kReadError };

ReadLineResult ReadLine(std::istream &input, std::string &line) {
  line.clear();
  char value = 0;
  while (input.get(value)) {
    if (value == '\n')
      return ReadLineResult::kLine;
    if (line.size() >= kMaxProtocolLineBytes)
      return ReadLineResult::kTooLarge;
    line.push_back(value);
  }
  if (input.bad())
    return ReadLineResult::kReadError;
  return line.empty() ? ReadLineResult::kEndOfFile : ReadLineResult::kLine;
}

} // namespace

JsonError::JsonError(const char *message) : std::runtime_error(message) {}

JsonValue::JsonValue() : value_(nullptr) {}
JsonValue::JsonValue(std::nullptr_t) : value_(nullptr) {}
JsonValue::JsonValue(bool value) : value_(value) {}
JsonValue::JsonValue(double value) : value_(value) {}
JsonValue::JsonValue(const char *value) : value_(std::string(value)) {}
JsonValue::JsonValue(std::string value) : value_(std::move(value)) {}
JsonValue::JsonValue(Array value) : value_(std::move(value)) {}
JsonValue::JsonValue(Object value) : value_(std::move(value)) {}

JsonValue JsonValue::Parse(std::string_view json) {
  return JsonParser(json).Parse();
}

std::string JsonValue::Serialize() const {
  return JsonSerializer().Serialize(*this);
}

JsonValue::Type JsonValue::type() const noexcept {
  return static_cast<Type>(value_.index());
}

bool JsonValue::IsNull() const noexcept {
  return std::holds_alternative<std::nullptr_t>(value_);
}
bool JsonValue::IsBool() const noexcept {
  return std::holds_alternative<bool>(value_);
}
bool JsonValue::IsNumber() const noexcept {
  return std::holds_alternative<double>(value_);
}
bool JsonValue::IsString() const noexcept {
  return std::holds_alternative<std::string>(value_);
}
bool JsonValue::IsArray() const noexcept {
  return std::holds_alternative<Array>(value_);
}
bool JsonValue::IsObject() const noexcept {
  return std::holds_alternative<Object>(value_);
}

bool JsonValue::AsBool() const {
  const bool *value = std::get_if<bool>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

double JsonValue::AsNumber() const {
  const double *value = std::get_if<double>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

const std::string &JsonValue::AsString() const {
  const std::string *value = std::get_if<std::string>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

const JsonValue::Array &JsonValue::AsArray() const {
  const Array *value = std::get_if<Array>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

const JsonValue::Object &JsonValue::AsObject() const {
  const Object *value = std::get_if<Object>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

JsonValue::Array &JsonValue::AsArray() {
  Array *value = std::get_if<Array>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

JsonValue::Object &JsonValue::AsObject() {
  Object *value = std::get_if<Object>(&value_);
  if (!value)
    throw JsonError("json-type");
  return *value;
}

const JsonValue *JsonValue::Find(std::string_view key) const noexcept {
  const Object *object = std::get_if<Object>(&value_);
  if (!object)
    return nullptr;
  const auto value = object->find(key);
  return value == object->end() ? nullptr : &value->second;
}

std::optional<std::string_view>
JsonValue::GetString(std::string_view key) const noexcept {
  const JsonValue *value = Find(key);
  return value && value->IsString()
             ? std::optional<std::string_view>(value->AsString())
             : std::nullopt;
}

std::optional<double>
JsonValue::GetNumber(std::string_view key) const noexcept {
  const JsonValue *value = Find(key);
  return value && value->IsNumber() ? std::optional<double>(value->AsNumber())
                                    : std::nullopt;
}

std::optional<bool> JsonValue::GetBool(std::string_view key) const noexcept {
  const JsonValue *value = Find(key);
  return value && value->IsBool() ? std::optional<bool>(value->AsBool())
                                  : std::nullopt;
}

std::optional<std::uint32_t>
JsonValue::GetUInt32(std::string_view key) const noexcept {
  const std::optional<double> value = GetNumber(key);
  if (!value || !std::isfinite(*value) || *value < 0 ||
      *value > std::numeric_limits<std::uint32_t>::max() ||
      std::floor(*value) != *value) {
    return std::nullopt;
  }
  return static_cast<std::uint32_t>(*value);
}

class ProtocolBridge::Impl {
public:
  explicit Impl(std::ostream &output) : output_(output) {}

  RunResult Run(std::istream &input, ConfigureCallback configureCallback,
                StateCallback stateCallback) {
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (running_)
        return RunResult::kProtocolError;
      running_ = true;
      stopped_ = false;
      ready_ = false;
    }

    bool configured = false;
    std::string line;
    while (true) {
      const ReadLineResult readResult = ReadLine(input, line);
      if (readResult == ReadLineResult::kEndOfFile) {
        FinishRun();
        return RunResult::kEndOfFile;
      }
      if (readResult == ReadLineResult::kTooLarge) {
        SendDiagnostic("message-too-large");
        FinishRun();
        return RunResult::kProtocolError;
      }
      if (readResult == ReadLineResult::kReadError) {
        SendDiagnostic("read-failed");
        FinishRun();
        return RunResult::kProtocolError;
      }
      if (line.empty())
        continue;

      JsonValue message;
      try {
        message = JsonValue::Parse(line);
      } catch (...) {
        SendDiagnostic("invalid-json");
        if (!configured) {
          FinishRun();
          return RunResult::kProtocolError;
        }
        continue;
      }
      if (!message.IsObject()) {
        SendDiagnostic("invalid-message");
        if (!configured) {
          FinishRun();
          return RunResult::kProtocolError;
        }
        continue;
      }

      const auto type = message.GetString("type");
      if (!configured) {
        if (!type || *type != "configure") {
          SendDiagnostic("configure-required");
          FinishRun();
          return RunResult::kProtocolError;
        }
        const auto configuration = ParseConfiguration(message);
        if (!configuration) {
          SendDiagnostic("invalid-configure");
          FinishRun();
          return RunResult::kProtocolError;
        }
        bool accepted = false;
        try {
          accepted = configureCallback && configureCallback(*configuration);
        } catch (...) {
          SendDiagnostic("configure-failed");
        }
        if (!accepted) {
          FinishRun();
          return RunResult::kConfigureRejected;
        }
        {
          std::lock_guard<std::mutex> lock(stateMutex_);
          if (stopped_) {
            FinishRunLocked();
            return RunResult::kShutdown;
          }
          ready_ = true;
        }
        configured = true;
        if (WriteMessage(JsonValue::Object{
                {"type", JsonValue("ready")},
                {"protocolVersion", JsonValue(1.0)}}) != WriteResult::kOk) {
          FinishRun();
          return RunResult::kProtocolError;
        }
        continue;
      }

      if (!type) {
        SendDiagnostic("invalid-message");
      } else if (*type == "state") {
        HandleState(message, stateCallback);
      } else if (*type == "response") {
        HandleResponse(message);
      } else if (*type == "shutdown") {
        FinishRun();
        return RunResult::kShutdown;
      } else {
        SendDiagnostic("invalid-message");
      }
    }
  }

  std::optional<InvokeResponse> Invoke(std::string_view service,
                                       std::string_view action,
                                       const JsonValue &args,
                                       std::chrono::milliseconds timeout) {
    if (!IsValidProtocolName(service) || !IsValidProtocolName(action) ||
        !args.IsObject() || timeout <= std::chrono::milliseconds::zero()) {
      return std::nullopt;
    }
    if (timeout > kMaxInvokeTimeout)
      timeout = kMaxInvokeTimeout;

    const std::uint64_t sequence = nextRequestId_.fetch_add(1);
    if (sequence == std::numeric_limits<std::uint64_t>::max()) {
      Stop();
      return std::nullopt;
    }
    const std::string requestId = MakeRequestId(sequence);
    auto pending = std::make_shared<Pending>();
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (!ready_ || stopped_ || pending_.size() >= kMaxPendingRequests) {
        return std::nullopt;
      }
      pending_.emplace(requestId, pending);
    }

    const WriteResult writeResult = WriteMessage(
        JsonValue::Object{{"type", JsonValue("action")},
                          {"requestId", JsonValue(requestId)},
                          {"service", JsonValue(std::string(service))},
                          {"action", JsonValue(std::string(action))},
                          {"args", args}});
    if (writeResult != WriteResult::kOk) {
      {
        std::lock_guard<std::mutex> lock(stateMutex_);
        pending_.erase(requestId);
      }
      if (writeResult == WriteResult::kTooLarge) {
        return InvokeResponse{false, JsonValue(nullptr), "request-too-large"};
      }
      Stop();
      return std::nullopt;
    }

    std::unique_lock<std::mutex> lock(stateMutex_);
    if (!pending->condition.wait_for(lock, timeout, [&] {
          return pending->response.has_value() || pending->cancelled;
        })) {
      const auto current = pending_.find(requestId);
      if (current != pending_.end() && current->second == pending) {
        pending_.erase(current);
      }
      return std::nullopt;
    }
    return pending->response;
  }

  void SendDiagnostic(std::string_view code) {
    WriteMessage(
        JsonValue::Object{{"type", JsonValue("diagnostic")},
                          {"code", JsonValue(NormalizeDiagnosticCode(code))}});
  }

  void Stop() noexcept {
    std::lock_guard<std::mutex> lock(stateMutex_);
    StopLocked();
  }

private:
  enum class WriteResult { kOk, kTooLarge, kFailure };

  struct Pending {
    std::condition_variable condition;
    std::optional<InvokeResponse> response;
    bool cancelled = false;
  };

  std::optional<ProtocolConfiguration>
  ParseConfiguration(const JsonValue &message) const {
    const auto protocolVersion = message.GetUInt32("protocolVersion");
    const JsonValue *device = message.Find("device");
    if (!protocolVersion || *protocolVersion != 1 || !device ||
        !device->IsObject()) {
      return std::nullopt;
    }
    const auto friendlyName = device->GetString("friendlyName");
    const auto udn = device->GetString("udn");
    if (!friendlyName || !udn || udn->empty() || !IsValidUtf8(*friendlyName) ||
        !IsValidUtf8(*udn) || Utf8CodePointCount(*friendlyName) > 128 ||
        Utf8CodePointCount(*udn) > 128) {
      return std::nullopt;
    }
    return ProtocolConfiguration{std::string(*friendlyName), std::string(*udn)};
  }

  void HandleState(const JsonValue &message,
                   const StateCallback &stateCallback) {
    const JsonValue *snapshot = message.Find("snapshot");
    if (!snapshot || !snapshot->IsObject()) {
      SendDiagnostic("invalid-state");
      return;
    }
    try {
      if (stateCallback)
        stateCallback(*snapshot);
    } catch (...) {
      SendDiagnostic("state-rejected");
    }
  }

  void HandleResponse(const JsonValue &message) {
    const auto requestId = message.GetString("requestId");
    const auto ok = message.GetBool("ok");
    if (!requestId || requestId->empty() || requestId->size() > 64 || !ok) {
      SendDiagnostic("invalid-response");
      return;
    }

    InvokeResponse response;
    response.ok = *ok;
    if (*ok) {
      const JsonValue *result = message.Find("result");
      response.result = result ? *result : JsonValue(nullptr);
    } else {
      const JsonValue *error = message.Find("error");
      const auto code = error ? error->GetString("code") : std::nullopt;
      response.errorCode = code && IsValidProtocolName(*code)
                               ? std::string(*code)
                               : "action-failed";
    }

    std::shared_ptr<Pending> pending;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      const auto value = pending_.find(std::string(*requestId));
      if (value == pending_.end()) {
        SendDiagnostic("unknown-response");
        return;
      }
      pending = value->second;
      pending_.erase(value);
      pending->response = std::move(response);
    }
    pending->condition.notify_one();
  }

  WriteResult WriteMessage(JsonValue::Object message) {
    std::string json;
    try {
      json = JsonValue(std::move(message)).Serialize();
    } catch (...) {
      return WriteResult::kTooLarge;
    }
    if (json.size() + 1 > kMaxProtocolLineBytes)
      return WriteResult::kTooLarge;
    std::lock_guard<std::mutex> lock(outputMutex_);
    output_ << json << '\n';
    output_.flush();
    return output_.good() ? WriteResult::kOk : WriteResult::kFailure;
  }

  void FinishRun() noexcept {
    std::lock_guard<std::mutex> lock(stateMutex_);
    FinishRunLocked();
  }

  void FinishRunLocked() noexcept {
    StopLocked();
    running_ = false;
  }

  void StopLocked() noexcept {
    stopped_ = true;
    ready_ = false;
    for (auto &[requestId, pending] : pending_) {
      (void)requestId;
      pending->cancelled = true;
      pending->condition.notify_one();
    }
    pending_.clear();
  }

  std::ostream &output_;
  std::mutex outputMutex_;
  std::mutex stateMutex_;
  std::unordered_map<std::string, std::shared_ptr<Pending>> pending_;
  std::atomic<std::uint64_t> nextRequestId_{1};
  bool running_ = false;
  bool ready_ = false;
  bool stopped_ = false;
};

ProtocolBridge::ProtocolBridge(std::ostream &output)
    : impl_(std::make_unique<Impl>(output)) {}

ProtocolBridge::~ProtocolBridge() { impl_->Stop(); }

RunResult ProtocolBridge::Run(std::istream &input,
                              ConfigureCallback configureCallback,
                              StateCallback stateCallback) {
  return impl_->Run(input, std::move(configureCallback),
                    std::move(stateCallback));
}

std::optional<InvokeResponse>
ProtocolBridge::Invoke(std::string_view service, std::string_view action,
                       const JsonValue &args,
                       std::chrono::milliseconds timeout) {
  return impl_->Invoke(service, action, args, timeout);
}

void ProtocolBridge::SendDiagnostic(std::string_view code) {
  impl_->SendDiagnostic(code);
}

void ProtocolBridge::Stop() noexcept { impl_->Stop(); }

} // namespace effetune::openhome
