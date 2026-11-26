#include "protocol.h"
#include "runtime.h"

#include <iostream>
#include <string_view>

namespace effetune::openhome {
namespace {

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
  const RunResult result = RunSidecar(bridge, std::cin, useLoopback);
  return result == RunResult::kShutdown || result == RunResult::kEndOfFile ? 0
                                                                           : 2;
}
