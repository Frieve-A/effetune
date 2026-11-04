#define _WIN32_WINNT 0x0A00
#include <windows.h>

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cwchar>
#include <iostream>
#include <string>

namespace {
constexpr ULONG kExecutionSpeed = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;

bool readPower(HANDLE process, PROCESS_POWER_THROTTLING_STATE& state) {
  state = {};
  state.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
  return GetProcessInformation(process, ProcessPowerThrottling, &state, sizeof(state)) != 0;
}

void printError(const char* stage, DWORD error) {
  std::cout << "{\"event\":\"error\",\"stage\":\"" << stage
            << "\",\"code\":" << error << "}" << std::endl;
}

uint64_t creationTime(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return 0;
  return (static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}

bool restorePower(HANDLE process, const PROCESS_POWER_THROTTLING_STATE& original,
                  DWORD pid, uint64_t created) {
  DWORD exitCode = 0;
  if (GetExitCodeProcess(process, &exitCode) && exitCode != STILL_ACTIVE) {
    std::cout << "{\"event\":\"terminated\",\"pid\":" << pid << "}" << std::endl;
    return true;
  }
  PROCESS_POWER_THROTTLING_STATE current{};
  if (!readPower(process, current)) {
    printError("restore-read", GetLastError());
    return false;
  }
  current.ControlMask = (current.ControlMask & ~kExecutionSpeed) |
                        (original.ControlMask & kExecutionSpeed);
  current.StateMask = (current.StateMask & ~kExecutionSpeed) |
                      (original.StateMask & kExecutionSpeed);
  if (!SetProcessInformation(process, ProcessPowerThrottling, &current, sizeof(current))) {
    printError("restore-set", GetLastError());
    return false;
  }
  PROCESS_POWER_THROTTLING_STATE restored{};
  if (!readPower(process, restored)) {
    printError("restore-verify", GetLastError());
    return false;
  }
  const bool matched = (restored.ControlMask & kExecutionSpeed) ==
                           (original.ControlMask & kExecutionSpeed) &&
                       (restored.StateMask & kExecutionSpeed) ==
                           (original.StateMask & kExecutionSpeed);
  std::cout << "{\"event\":\"restored\",\"pid\":" << pid
            << ",\"creationTime\":\"" << created << "\",\"controlMask\":"
            << restored.ControlMask << ",\"stateMask\":" << restored.StateMask
            << ",\"matched\":" << (matched ? "true" : "false") << "}" << std::endl;
  return matched;
}
}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc != 2 && argc != 3 && argc != 6) return 2;
  const bool queryOnly = argc == 3 && std::wstring(argv[1]) == L"--query";
  const bool restoreOnly = argc == 6 && std::wstring(argv[1]) == L"--restore";
  if ((argc == 3 && !queryOnly) || (argc == 6 && !restoreOnly)) return 2;
  const wchar_t* pidText = argv[queryOnly || restoreOnly ? 2 : 1];
  wchar_t* end = nullptr;
  errno = 0;
  const unsigned long parsed = std::wcstoul(pidText, &end, 10);
  if (errno || end == pidText || *end != L'\0' || parsed == 0 || parsed > UINT32_MAX) return 2;
  const DWORD pid = static_cast<DWORD>(parsed);
  const DWORD rights = PROCESS_QUERY_LIMITED_INFORMATION | (queryOnly ? 0 : PROCESS_SET_INFORMATION);
  HANDLE process = OpenProcess(rights, FALSE, pid);
  if (!process) {
    printError("open", GetLastError());
    return 3;
  }
  const uint64_t created = creationTime(process);
  PROCESS_POWER_THROTTLING_STATE original{};
  if (!created || !readPower(process, original)) {
    printError("read", GetLastError());
    CloseHandle(process);
    return 4;
  }
  if (queryOnly) {
    std::cout << "{\"event\":\"queried\",\"pid\":" << pid
              << ",\"creationTime\":\"" << created << "\",\"controlMask\":"
              << original.ControlMask << ",\"stateMask\":" << original.StateMask
              << "}" << std::endl;
    CloseHandle(process);
    return 0;
  }
  if (restoreOnly) {
    wchar_t* creationEnd = nullptr;
    errno = 0;
    const unsigned long long expectedCreation = std::wcstoull(argv[3], &creationEnd, 10);
    if (errno || creationEnd == argv[3] || *creationEnd != L'\0' ||
        created != expectedCreation ||
        (std::wstring(argv[4]) != L"0" && std::wstring(argv[4]) != L"1") ||
        (std::wstring(argv[5]) != L"0" && std::wstring(argv[5]) != L"1")) {
      printError("identity", 0);
      CloseHandle(process);
      return 8;
    }
    PROCESS_POWER_THROTTLING_STATE saved{};
    saved.ControlMask = argv[4][0] == L'1' ? kExecutionSpeed : 0;
    saved.StateMask = argv[5][0] == L'1' ? kExecutionSpeed : 0;
    const bool restored = restorePower(process, saved, pid, created);
    CloseHandle(process);
    return restored ? 0 : 7;
  }
  PROCESS_POWER_THROTTLING_STATE high = original;
  high.ControlMask |= kExecutionSpeed;
  high.StateMask &= ~kExecutionSpeed;
  if (!SetProcessInformation(process, ProcessPowerThrottling, &high, sizeof(high))) {
    printError("apply", GetLastError());
    CloseHandle(process);
    return 5;
  }
  PROCESS_POWER_THROTTLING_STATE applied{};
  if (!readPower(process, applied)) {
    printError("apply-verify", GetLastError());
    restorePower(process, original, pid, created);
    CloseHandle(process);
    return 6;
  }
  std::cout << "{\"event\":\"applied\",\"pid\":" << pid
            << ",\"creationTime\":\"" << created
            << "\",\"originalControl\":" << original.ControlMask
            << ",\"originalState\":" << original.StateMask
            << ",\"controlMask\":" << applied.ControlMask
            << ",\"stateMask\":" << applied.StateMask << "}" << std::endl;
  std::string instruction;
  std::getline(std::cin, instruction);
  const bool restored = restorePower(process, original, pid, created);
  CloseHandle(process);
  return restored ? 0 : 7;
}
