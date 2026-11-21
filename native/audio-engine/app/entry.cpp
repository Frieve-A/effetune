#include <cstdlib>

#if defined(ET_AUDIO_ENGINE_X64_V3)
#if defined(_MSC_VER)
#include <intrin.h>
#else
#include <cpuid.h>
#endif

namespace {
bool supportsV3() noexcept {
#if defined(_MSC_VER)
  char forced[2]{};
  std::size_t length;
  if (getenv_s(&length, forced, sizeof(forced), "EFFETUNE_AUDIO_ENGINE_FORCE_BASELINE") == 0 &&
      length == 2 && forced[0] == '1')
#else
  const char *forced = std::getenv("EFFETUNE_AUDIO_ENGINE_FORCE_BASELINE");
  if (forced && forced[0] == '1' && forced[1] == '\0')
#endif
    return false;
  unsigned ecx = 0, ebx = 0;
#if defined(_MSC_VER)
  int regs[4]{};
  __cpuid(regs, 0);
  if (regs[0] < 7)
    return false;
  __cpuidex(regs, 1, 0);
  ecx = static_cast<unsigned>(regs[2]);
  __cpuidex(regs, 7, 0);
  ebx = static_cast<unsigned>(regs[1]);
#else
  unsigned eax, edx, ignored;
  if (__get_cpuid_max(0, nullptr) < 7)
    return false;
  __cpuid_count(1, 0, eax, ignored, ecx, edx);
  __cpuid_count(7, 0, eax, ebx, ignored, edx);
#endif
  constexpr unsigned required = (1u << 12) | (1u << 27) | (1u << 28);
  if ((ecx & required) != required || (ebx & (1u << 5)) == 0)
    return false;
  unsigned xcr0;
  __asm__ volatile("xgetbv" : "=a"(xcr0) : "c"(0) : "edx");
  return (xcr0 & 6u) == 6u;
}
} // namespace
#endif

int runAudioEngine(int argc, char **argv);

int main(int argc, char **argv) {
#if defined(ET_AUDIO_ENGINE_X64_V3)
  if (!supportsV3())
    return 78;
#endif
  return runAudioEngine(argc, argv);
}
