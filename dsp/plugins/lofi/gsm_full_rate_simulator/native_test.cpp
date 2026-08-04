#define _CRT_SECURE_NO_WARNINGS

#include "codec.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using effetune::plugins::lofi::gsmfr::Decoder;
using effetune::plugins::lofi::gsmfr::Encoder;
using effetune::plugins::lofi::gsmfr::Frame;
using effetune::plugins::lofi::gsmfr::frameToWords;
using effetune::plugins::lofi::gsmfr::kFrameSamples;
using effetune::plugins::lofi::gsmfr::kFrameWords;
using effetune::plugins::lofi::gsmfr::packFrame;
using effetune::plugins::lofi::gsmfr::Word;
using effetune::plugins::lofi::gsmfr::wordsToFrame;

void require(bool condition, const std::string &message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

std::vector<Word> readWords(const std::filesystem::path &path) {
  std::ifstream stream(path, std::ios::binary);
  require(stream.good(), "cannot open fixture: " + path.string());
  std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(stream)), {});
  require((bytes.size() & 1u) == 0u, "fixture has an odd byte count: " + path.string());
  std::vector<Word> words(bytes.size() / 2u);
  for (std::size_t index = 0u; index < words.size(); ++index) {
    const std::uint16_t value = static_cast<std::uint16_t>(bytes[index * 2u]) |
                                (static_cast<std::uint16_t>(bytes[index * 2u + 1u]) << 8u);
    words[index] = static_cast<Word>(value);
  }
  return words;
}

template <std::size_t Size>
std::array<Word, Size> slice(const std::vector<Word> &words, std::size_t offset) {
  require(offset + Size <= words.size(), "fixture slice exceeds input");
  std::array<Word, Size> result{};
  for (std::size_t index = 0u; index < Size; ++index) {
    result[index] = words[offset + index];
  }
  return result;
}

void testFixedPoint() {
  using namespace effetune::plugins::lofi::gsmfr;
  require(add(32767, 1) == 32767, "saturating add");
  require(subtract(-32768, 1) == -32768, "saturating subtract");
  require(multiply(-32768, -32768) == 32767, "saturating multiply");
  require(multiplyRounded(16384, 16384) == 8192, "rounded multiply");
  require(longMultiply(-32768, -32768) == 2147483647, "saturating long multiply");
  require(arithmeticShiftRight(static_cast<Word>(-3), 1u) == -2, "word arithmetic shift");
  require(arithmeticShiftRight(static_cast<Longword>(-3), 1u) == -2, "long arithmetic shift");
  require(absolute(-32768) == 32767, "saturating absolute");
  require(normalize(1) == 30, "normalization");
  require(divide(1, 2) == 16384, "fractional division");
}

struct ConformanceSummary final {
  std::size_t frames = 0u;
  std::size_t encoder_words = 0u;
  std::size_t decoder_samples = 0u;
};

ConformanceSummary testSequence(const std::filesystem::path &directory, int sequence,
                                std::ofstream *packed_output, bool check_encoder) {
  const std::string stem =
      sequence < 10 ? "Seq0" + std::to_string(sequence) : "Seq" + std::to_string(sequence);
  const std::vector<Word> coded = readWords(directory / (stem + ".cod"));
  const std::vector<Word> decoded_reference = readWords(directory / (stem + ".out"));
  require(coded.size() % kFrameWords == 0u, stem + " coded fixture size");
  const std::size_t frame_count = coded.size() / kFrameWords;
  require(decoded_reference.size() == frame_count * kFrameSamples, stem + " decoder fixture size");
  const bool has_input = std::filesystem::exists(directory / (stem + ".inp"));
  const std::vector<Word> input =
      has_input ? readWords(directory / (stem + ".inp")) : std::vector<Word>{};
  require(!has_input || input.size() == frame_count * kFrameSamples,
          stem + " encoder fixture size");

  Encoder encoder;
  Decoder decoder;
  encoder.reset();
  decoder.reset();
  ConformanceSummary summary{};
  for (std::size_t frame_index = 0u; frame_index < frame_count; ++frame_index) {
    const auto coded_words = slice<kFrameWords>(coded, frame_index * kFrameWords);
    const Frame coded_frame = wordsToFrame(coded_words);
    require(frameToWords(coded_frame) == coded_words, stem + " logical frame round trip");
    Frame unpacked{};
    const auto packed = packFrame(coded_frame);
    require(effetune::plugins::lofi::gsmfr::unpackFrame(packed, unpacked),
            stem + " packed frame magic");
    require(frameToWords(unpacked) == coded_words, stem + " packed frame round trip");
    if (packed_output != nullptr) {
      packed_output->write(reinterpret_cast<const char *>(packed.data()),
                           static_cast<std::streamsize>(packed.size()));
    }

    const auto actual_decoded = decoder.decode(coded_frame);
    for (std::size_t sample = 0u; sample < kFrameSamples; ++sample) {
      const Word expected = decoded_reference[frame_index * kFrameSamples + sample];
      if (actual_decoded[sample] != expected) {
        throw std::runtime_error(stem + " decoder mismatch frame=" + std::to_string(frame_index) +
                                 " sample=" + std::to_string(sample) +
                                 " expected=" + std::to_string(expected) +
                                 " actual=" + std::to_string(actual_decoded[sample]));
      }
    }
    summary.decoder_samples += kFrameSamples;
    if (has_input && check_encoder) {
      const Frame encoded =
          encoder.encode(slice<kFrameSamples>(input, frame_index * kFrameSamples));
      const auto actual_words = frameToWords(encoded);
      for (std::size_t word = 0u; word < kFrameWords; ++word) {
        if (actual_words[word] != coded_words[word]) {
          throw std::runtime_error(stem + " encoder mismatch frame=" + std::to_string(frame_index) +
                                   " word=" + std::to_string(word) +
                                   " expected=" + std::to_string(coded_words[word]) +
                                   " actual=" + std::to_string(actual_words[word]));
        }
      }
      summary.encoder_words += kFrameWords;
    }
    ++summary.frames;
  }
#if defined(EFFETUNE_GSM_FR_DIAGNOSTICS)
  if (sequence == 1 && check_encoder) {
    const auto &counts = encoder.overflowCounters();
    std::cout << "SEQ01 encoder overflows " << counts.encoderAnalysisFirstAdd << ','
              << counts.encoderAnalysisSecondAdd << ',' << counts.encoderLtpAbsolute << ','
              << counts.encoderLongTermSubtract << ',' << counts.encoderWeightingScale << ','
              << counts.encoderApcmAbsolute << ',' << counts.encoderHistoryAdd << '\n';
    require(counts.encoderAnalysisFirstAdd == 1059u, "SEQ01 encoder first analysis add count");
    require(counts.encoderAnalysisSecondAdd == 134u, "SEQ01 encoder second analysis add count");
    require(counts.encoderLtpAbsolute == 5u, "SEQ01 encoder LTP absolute count");
    require(counts.encoderLongTermSubtract == 11u, "SEQ01 encoder long-term subtract count");
    require(counts.encoderWeightingScale == 302u, "SEQ01 encoder weighting scale count");
    require(counts.encoderApcmAbsolute == 49u, "SEQ01 encoder APCM absolute count");
    require(counts.encoderHistoryAdd == 126u, "SEQ01 encoder history add count");
  }
  if (sequence <= 3) {
    constexpr std::array<std::uint32_t, 3u> kLongTerm{126u, 0u, 0u};
    constexpr std::array<std::uint32_t, 3u> kSynthesisFirst{4499u, 0u, 0u};
    constexpr std::array<std::uint32_t, 3u> kSynthesisSecond{405u, 1u, 0u};
    constexpr std::array<std::uint32_t, 3u> kDeemphasis{89u, 0u, 0u};
    constexpr std::array<std::uint32_t, 3u> kUpscale{16691u, 339u, 19u};
    const auto &counts = decoder.overflowCounters();
    std::cout << stem << " decoder overflows " << counts.decoderLongTermAdd << ','
              << counts.decoderSynthesisFirstAdd << ',' << counts.decoderSynthesisSecondAdd << ','
              << counts.decoderDeemphasisAdd << ',' << counts.decoderUpscaleAdd << '\n';
    const std::size_t index = static_cast<std::size_t>(sequence - 1);
    require(counts.decoderLongTermAdd == kLongTerm[index], stem + " decoder long-term add count");
    require(counts.decoderSynthesisFirstAdd == kSynthesisFirst[index],
            stem + " decoder first synthesis add count");
    require(counts.decoderSynthesisSecondAdd == kSynthesisSecond[index],
            stem + " decoder second synthesis add count");
    require(counts.decoderDeemphasisAdd == kDeemphasis[index],
            stem + " decoder deemphasis add count");
    require(counts.decoderUpscaleAdd == kUpscale[index], stem + " decoder upscale add count");
  }
#endif
  return summary;
}


// GSM 06.11 style bad frame handling: a good frame must behave exactly as before, a substituted
// frame must reuse the previous parameters, and a long erasure run must fade to silence.
void testConcealment() {
  using namespace effetune::plugins::lofi::gsmfr;

  std::array<Word, kFrameSamples> stimulus{};
  const auto fill = [&stimulus](std::size_t index_base) {
    for (std::size_t index = 0u; index < kFrameSamples; ++index) {
      const double phase = static_cast<double>(index_base + index);
      stimulus[index] = static_cast<Word>(7000.0 * std::sin(phase * 0.11) +
                                          2500.0 * std::sin(phase * 0.031));
    }
  };

  // A false bad-frame flag must leave the decoder bit-identical to the plain decode path.
  {
    Encoder encoder;
    Decoder plain;
    Decoder flagged;
    for (std::size_t frame = 0u; frame < 24u; ++frame) {
      fill(frame * kFrameSamples);
      const Frame encoded = encoder.encode(stimulus);
      require(plain.decode(encoded) == flagged.decode(encoded, false),
              "explicit good-frame flag changed the decoder output");
    }
    require(flagged.concealmentState() == 0u, "good frames left a concealment run open");
  }

  // A substituted frame must differ from the frame that was actually transmitted, and the run
  // counter must climb until it saturates at the mute state.
  {
    Encoder encoder;
    Decoder good;
    Decoder erased;
    for (std::size_t frame = 0u; frame < 8u; ++frame) {
      fill(frame * kFrameSamples);
      const Frame encoded = encoder.encode(stimulus);
      static_cast<void>(good.decode(encoded));
      static_cast<void>(erased.decode(encoded));
    }
    fill(8u * kFrameSamples);
    const Frame next = encoder.encode(stimulus);
    const std::array<Word, kFrameSamples> received = good.decode(next);
    const std::array<Word, kFrameSamples> concealed = erased.decode(next, true);
    require(received != concealed, "erased frame reproduced the transmitted frame");
    require(erased.concealmentState() == 1u, "first erasure did not open a concealment run");

    const auto framePeak = [](const std::array<Word, kFrameSamples> &block) {
      Longword peak = 0;
      for (Word sample : block) {
        const Longword magnitude =
            sample < 0 ? -static_cast<Longword>(sample) : static_cast<Longword>(sample);
        peak = magnitude > peak ? magnitude : peak;
      }
      return peak;
    };
    const Longword received_peak = framePeak(received);
    require(received_peak > 1000, "the reference stimulus decoded too quietly to compare");

    // Two windows well inside the muted region. The tail must sit far below the transmitted
    // level and must not grow: the fixed-point de-emphasis integrator settles on a small idle
    // residue rather than an exact zero, which is the real decoder behaviour.
    Longword early_tail = 0;
    Longword late_tail = 0;
    for (std::size_t run = 0u; run < kConcealmentMuteState + 40u; ++run) {
      const Longword peak = framePeak(erased.decode(next, true));
      if (run + 1u >= kConcealmentMuteState + 10u && run + 1u < kConcealmentMuteState + 20u) {
        early_tail = peak > early_tail ? peak : early_tail;
      } else if (run + 1u >= kConcealmentMuteState + 30u) {
        late_tail = peak > late_tail ? peak : late_tail;
      }
    }
    require(erased.concealmentState() == kConcealmentMuteState,
            "concealment run counter did not saturate at the mute state");
    require(early_tail * 32 < received_peak,
            "a long erasure run did not fall at least 30 dB below the transmitted frame");
    require(late_tail <= early_tail, "the muted erasure tail grew instead of settling");

    // A good frame after the run must clear the state and resume normal decoding.
    fill(64u * kFrameSamples);
    const Frame resumed = encoder.encode(stimulus);
    static_cast<void>(erased.decode(resumed));
    require(erased.concealmentState() == 0u, "a good frame did not clear the concealment run");
  }

  // Substitution starting from a reset decoder must not read uninitialised parameters, and must
  // not emit the all-zero placeholder frame: that decodes to a sustained negative DC offset, which
  // a per-sample magnitude bound alone would miss. Run past the mute state so the whole
  // no-reference stretch is covered, and gate the frame mean as well as the peak.
  {
    Decoder fresh;
    for (std::size_t run = 0u; run < kConcealmentMuteState + 2u; ++run) {
      const std::array<Word, kFrameSamples> silent = fresh.decode(Frame{}, true);
      Longword sum = 0;
      for (Word sample : silent) {
        require(sample > -4096 && sample < 4096, "concealment from reset produced a large sample");
        sum += static_cast<Longword>(sample);
      }
      const Longword mean = sum / static_cast<Longword>(kFrameSamples);
      // 0.01 full scale of the 16 bit codec domain.
      require(mean > -328 && mean < 328,
              "concealment from reset produced a DC offset above 0.01 full scale");
    }
  }

  // reset() must clear the substitution memory as well as the filter state.
  {
    Encoder encoder;
    Decoder decoder;
    for (std::size_t frame = 0u; frame < 4u; ++frame) {
      fill(frame * kFrameSamples);
      static_cast<void>(decoder.decode(encoder.encode(stimulus), frame == 3u));
    }
    require(decoder.concealmentState() == 1u, "expected an open concealment run before reset");
    decoder.reset();
    require(decoder.concealmentState() == 0u, "reset left the concealment run open");
    Decoder pristine;
    require(decoder.decode(Frame{}, true) == pristine.decode(Frame{}, true),
            "reset leaked substitution state");
  }
}

} // namespace

int main(int argc, char **argv) {
  try {
    testFixedPoint();
    testConcealment();
    const char *fixture_environment = std::getenv("ETSI_GSM_FR_VECTOR_DIR");
    if (fixture_environment == nullptr || *fixture_environment == '\0') {
      std::cout << "PASS fixed-point tests; ETSI_GSM_FR_VECTOR_DIR not set, conformance skipped\n";
      return 0;
    }
    std::ofstream packed;
    bool check_encoder = true;
    int selected_sequence = 0;
    if (argc == 2 && std::string(argv[1]) == "--decoder-only") {
      check_encoder = false;
    } else if ((argc == 3 || argc == 4) && std::string(argv[1]) == "--write-packed") {
      packed.open(argv[2], std::ios::binary);
      require(packed.good(), "cannot create packed output");
      if (argc == 4) {
        selected_sequence = std::stoi(argv[3]);
        require(selected_sequence >= 1 && selected_sequence <= 5,
                "packed sequence must be 1 through 5");
      }
    } else {
      require(argc == 1, "usage: native_test [--decoder-only | --write-packed <file> [sequence]]");
    }
    ConformanceSummary total{};
    for (int sequence = 1; sequence <= 5; ++sequence) {
      if (selected_sequence != 0 && sequence != selected_sequence) {
        continue;
      }
      ConformanceSummary current =
          testSequence(std::filesystem::path(fixture_environment), sequence,
                       packed.is_open() ? &packed : nullptr, check_encoder);
      total.frames += current.frames;
      total.encoder_words += current.encoder_words;
      total.decoder_samples += current.decoder_samples;
    }
    std::cout << "PASS ETSI GSM-FR conformance frames=" << total.frames
              << " encoder_words=" << total.encoder_words
              << " decoder_samples=" << total.decoder_samples << '\n';
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "FAIL " << error.what() << '\n';
    return 1;
  }
}
