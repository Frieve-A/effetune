#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <iosfwd>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace effetune::openhome {

inline constexpr std::size_t kMaxProtocolLineBytes = 256 * 1024;
inline constexpr std::size_t kMaxJsonDepth = 32;
inline constexpr std::size_t kMaxJsonContainerItems = 4096;
inline constexpr std::size_t kMaxJsonNodes = 16384;
inline constexpr std::chrono::milliseconds kInvokeTransportTimeout{12000};

class JsonError : public std::runtime_error {
public:
  explicit JsonError(const char *message);
};

class JsonValue {
public:
  using Array = std::vector<JsonValue>;
  using Object = std::map<std::string, JsonValue, std::less<>>;
  using Storage =
      std::variant<std::nullptr_t, bool, double, std::string, Array, Object>;

  enum class Type { kNull, kBool, kNumber, kString, kArray, kObject };

  JsonValue();
  JsonValue(std::nullptr_t);
  JsonValue(bool value);
  JsonValue(double value);
  JsonValue(const char *value);
  JsonValue(std::string value);
  JsonValue(Array value);
  JsonValue(Object value);

  static JsonValue Parse(std::string_view json);
  std::string Serialize() const;

  Type type() const noexcept;
  bool IsNull() const noexcept;
  bool IsBool() const noexcept;
  bool IsNumber() const noexcept;
  bool IsString() const noexcept;
  bool IsArray() const noexcept;
  bool IsObject() const noexcept;

  bool AsBool() const;
  double AsNumber() const;
  const std::string &AsString() const;
  const Array &AsArray() const;
  const Object &AsObject() const;
  Array &AsArray();
  Object &AsObject();

  const JsonValue *Find(std::string_view key) const noexcept;
  std::optional<std::string_view>
  GetString(std::string_view key) const noexcept;
  std::optional<double> GetNumber(std::string_view key) const noexcept;
  std::optional<bool> GetBool(std::string_view key) const noexcept;
  std::optional<std::uint32_t> GetUInt32(std::string_view key) const noexcept;

private:
  Storage value_;
};

struct ProtocolConfiguration {
  std::string friendlyName;
  std::string udn;
};

struct InvokeResponse {
  bool ok = false;
  JsonValue result;
  std::string errorCode;
};

enum class RunResult {
  kShutdown,
  kEndOfFile,
  kProtocolError,
  kConfigureRejected
};

class ProtocolBridge {
public:
  using ConfigureCallback = std::function<bool(const ProtocolConfiguration &)>;
  using StateCallback = std::function<void(const JsonValue &)>;

  explicit ProtocolBridge(std::ostream &output);
  ~ProtocolBridge();

  ProtocolBridge(const ProtocolBridge &) = delete;
  ProtocolBridge &operator=(const ProtocolBridge &) = delete;

  RunResult Run(std::istream &input, ConfigureCallback configureCallback,
                StateCallback stateCallback);
  std::optional<InvokeResponse>
  Invoke(std::string_view service, std::string_view action,
         const JsonValue &args,
         std::chrono::milliseconds timeout = kInvokeTransportTimeout);
  void SendDiagnostic(std::string_view code);
  void Stop() noexcept;

private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

} // namespace effetune::openhome
