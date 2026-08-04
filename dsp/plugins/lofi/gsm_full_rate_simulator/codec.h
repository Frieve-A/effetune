#ifndef EFFETUNE_GSM_FULL_RATE_SIMULATOR_CODEC_H
#define EFFETUNE_GSM_FULL_RATE_SIMULATOR_CODEC_H

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::lofi::gsmfr {

using Word = std::int16_t;
using Longword = std::int32_t;

constexpr std::size_t kFrameSamples = 160u;
constexpr std::size_t kSubframeSamples = 40u;
constexpr std::size_t kSubframes = 4u;
constexpr std::size_t kLarCount = 8u;
constexpr std::size_t kPulseCount = 13u;
constexpr std::size_t kFrameWords = 76u;
constexpr std::size_t kPackedBytes = 33u;

// GSM 06.11 style substitution and muting. Each consecutive erased frame lowers every subframe
// maximum (Xmaxc) by one step, and the excitation is muted once the run reaches the mute state.
constexpr std::uint32_t kConcealmentMuteState = 6u;
constexpr std::int16_t kConcealmentMaximumStep = 4;

struct Subframe final {
  Word lag = 0;
  Word gain = 0;
  Word grid = 0;
  Word maximum = 0;
  std::array<Word, kPulseCount> pulses{};
};

struct Frame final {
  std::array<Word, kLarCount> lar{};
  std::array<Subframe, kSubframes> subframes{};
};

#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
struct OverflowCounters final {
  std::uint32_t encoderAnalysisFirstAdd = 0u;
  std::uint32_t encoderAnalysisSecondAdd = 0u;
  std::uint32_t encoderLtpAbsolute = 0u;
  std::uint32_t encoderLongTermSubtract = 0u;
  std::uint32_t encoderWeightingScale = 0u;
  std::uint32_t encoderApcmAbsolute = 0u;
  std::uint32_t encoderHistoryAdd = 0u;
  std::uint32_t decoderLongTermAdd = 0u;
  std::uint32_t decoderSynthesisFirstAdd = 0u;
  std::uint32_t decoderSynthesisSecondAdd = 0u;
  std::uint32_t decoderDeemphasisAdd = 0u;
  std::uint32_t decoderUpscaleAdd = 0u;
};
#endif

[[nodiscard]] Word saturateWord(std::int64_t value) noexcept;
[[nodiscard]] Longword saturateLong(std::int64_t value) noexcept;
[[nodiscard]] Word add(Word first, Word second) noexcept;
[[nodiscard]] Word subtract(Word first, Word second) noexcept;
[[nodiscard]] Longword longAdd(Longword first, Longword second) noexcept;
[[nodiscard]] Longword longSubtract(Longword first, Longword second) noexcept;
[[nodiscard]] Word absolute(Word value) noexcept;
[[nodiscard]] Word multiply(Word first, Word second) noexcept;
[[nodiscard]] Word multiplyRounded(Word first, Word second) noexcept;
[[nodiscard]] Longword longMultiply(Word first, Word second) noexcept;
[[nodiscard]] Word arithmeticShiftRight(Word value, unsigned shift) noexcept;
[[nodiscard]] Longword arithmeticShiftRight(Longword value, unsigned shift) noexcept;
[[nodiscard]] Word arithmeticShiftLeft(Word value, unsigned shift) noexcept;
[[nodiscard]] Longword arithmeticShiftLeft(Longword value, unsigned shift) noexcept;
[[nodiscard]] Word normalize(Longword value) noexcept;
[[nodiscard]] Word divide(Word numerator, Word denominator) noexcept;

class Encoder final {
public:
  void reset() noexcept;
  [[nodiscard]] Frame encode(const std::array<Word, kFrameSamples> &input) noexcept;
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  [[nodiscard]] const OverflowCounters &overflowCounters() const noexcept { return counters_; }
#endif

private:
  void preprocess(std::array<Word, kFrameSamples> &samples) noexcept;
  static void analyzeLpc(std::array<Word, kFrameSamples> &samples,
                         std::array<Word, kLarCount> &lar) noexcept;
  static void quantizeLar(std::array<Word, kLarCount> &lar) noexcept;
  void shortTermAnalysis(const std::array<Word, kLarCount> &coded_lar,
                         std::array<Word, kFrameSamples> &samples) noexcept;
  void encodeSubframe(const Word *residual, Subframe &subframe, Word *reconstructed) noexcept;

  Word offset_input_state_ = 0;
  Longword offset_state_ = 0;
  Word preemphasis_state_ = 0;
  std::array<Word, kLarCount> previous_lar_{};
  std::array<Word, kLarCount> analysis_state_{};
  std::array<Word, 280u> residual_history_{};
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  OverflowCounters counters_{};
#endif
};

class Decoder final {
public:
  void reset() noexcept;
  // bad_frame drives the GSM 06.11 substitution path: the previously received parameters are
  // repeated with a decaying subframe maximum instead of the (undecodable) received frame.
  [[nodiscard]] std::array<Word, kFrameSamples> decode(const Frame &frame,
                                                       bool bad_frame = false) noexcept;
  [[nodiscard]] std::uint32_t concealmentState() const noexcept { return concealment_state_; }
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  [[nodiscard]] const OverflowCounters &overflowCounters() const noexcept { return counters_; }
#endif

private:
  void shortTermSynthesis(const std::array<Word, kLarCount> &coded_lar,
                          std::array<Word, kFrameSamples> &samples) noexcept;

  Frame previous_frame_{};
  // Substitution needs a previously received frame. Until one arrives there is nothing to repeat,
  // so an erased frame mutes immediately instead of decoding the all-zero placeholder.
  bool has_good_frame_ = false;
  std::uint32_t concealment_state_ = 0u;
  Word previous_lag_ = 40;
  Word deemphasis_state_ = 0;
  std::array<Word, kLarCount> previous_lar_{};
  std::array<Word, 9u> synthesis_state_{};
  std::array<Word, 280u> residual_history_{};
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  OverflowCounters counters_{};
#endif
};

class Transcoder final {
public:
  void reset() noexcept {
    encoder_.reset();
    decoder_.reset();
  }

  [[nodiscard]] Frame encode(const std::array<Word, kFrameSamples> &input) noexcept {
    return encoder_.encode(input);
  }

  [[nodiscard]] std::array<Word, kFrameSamples> decode(const Frame &frame,
                                                       bool bad_frame = false) noexcept {
    return decoder_.decode(frame, bad_frame);
  }

  [[nodiscard]] std::array<Word, kFrameSamples>
  process(const std::array<Word, kFrameSamples> &input) noexcept {
    return decode(encode(input));
  }

private:
  Encoder encoder_{};
  Decoder decoder_{};
};

[[nodiscard]] std::array<Word, kFrameWords> frameToWords(const Frame &frame) noexcept;
[[nodiscard]] Frame wordsToFrame(const std::array<Word, kFrameWords> &words) noexcept;
[[nodiscard]] std::array<std::uint8_t, kPackedBytes> packFrame(const Frame &frame) noexcept;
[[nodiscard]] bool unpackFrame(const std::array<std::uint8_t, kPackedBytes> &bytes,
                               Frame &frame) noexcept;

} // namespace effetune::plugins::lofi::gsmfr

#endif
