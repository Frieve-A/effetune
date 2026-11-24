#pragma once

#include <cstdint>

namespace effetune::audio {

class WasapiRenderPriority {
public:
  enum class Change { None, Demote, Restore };

  Change observe(std::uint64_t workNs, std::uint64_t audioNs) noexcept {
    if (!audioNs)
      return Change::None;
    work_ += workNs;
    audio_ += audioNs;
    if (work_ < 100'000'000 && audio_ < 100'000'000)
      return Change::None;
    const auto work = work_, audio = audio_;
    work_ = audio_ = 0;
    if (!demoted_) {
      // Require two windows so one delayed wake or callback cannot demote
      // the worker. Retain excess work to catch periodic DSP bursts.
      busyWindows_ = work >= audio - audio / 10 ? busyWindows_ + 1 : 0;
      if (busyWindows_ < 2)
        return Change::None;
      busyWindows_ = 0;
      demoted_ = true;
      return Change::Demote;
    }
    healthy_ = work <= audio - audio / 4 ? healthy_ + audio : 0;
    if (healthy_ < 1'000'000'000)
      return Change::None;
    healthy_ = 0;
    demoted_ = false;
    return Change::Restore;
  }

  bool demoted() const noexcept { return demoted_; }

private:
  std::uint64_t work_ = 0, audio_ = 0, healthy_ = 0;
  unsigned busyWindows_ = 0;
  bool demoted_ = false;
};

} // namespace effetune::audio
