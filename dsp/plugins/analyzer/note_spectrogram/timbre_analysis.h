#pragma once
#include "timbre_weights.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace effetune::plugins::analyzer {
// This observer only consumes timestamped model features. Note boundaries belong to its caller.
class TimbreAnalysis final {
public:
  static constexpr std::uint32_t kPitches = 88u, kDelayFrames = 1u, kHistory = 10u + kDelayFrames,
                                 kInput = 1337u;
  static constexpr std::uint32_t kOpenEnd = 0xffffffffu;
  struct Result {
    std::uint32_t noteId = 0u, midi = 0u, start = 0u, end = kOpenEnd, event = 0u;
    std::array<float, 9> probabilities{};
  };
  struct Frame {
    std::uint32_t index = kOpenEnd;
    std::array<float, 88u * 216u> a{};
    std::array<float, 88u * 64u> c{};
    std::array<float, 600> amplitudes{};
    std::array<float, 64> envelope{};
  };
  struct Record {
    Result boundary{};
    std::uint32_t time = 0u;
    std::array<float, 9> logits{}, p{};
    std::array<float, 32> z{};
    std::array<float, 8> coarse{};
    std::array<float, 3> cx{};
    float level = 0.0F, f0 = 0.0F;
  };
  struct Features {
    std::array<float, 31> ctx{};
    std::array<float, 11> link{};
    std::array<float, 20> inv{};
    std::array<float, 9> logits{}, probabilities{};
  };
  // 4096 confirmed notes cover the 15-second context at over 270 notes/s.
  // Sustained notes are retained separately, and inventory has no finite window.
  static constexpr std::uint32_t kRecords = 4096u, kCandidates = 192u;
  void reset(std::uint32_t context_start = 0u) noexcept {
    for (auto &frame : history_)
      frame.index = kOpenEnd;
    for (auto &notes : notes_)
      for (auto &note : notes)
        note.result.noteId = 0u;
    active_.fill(kOpenEnd);
    observations_ = decisions_ = 0u;
    chunk_count_ = chunk_cursor_ = batch_count_ = 0u;
    record_count_ = record_head_ = 0u;
    context_start_ = inventory_time_ = context_start;
    for (auto &record : sounding_)
      record.boundary.noteId = 0u;
    for (auto &sum : inventory_)
      sum.fill(0.0);
  }
  Frame &beginFrame(std::uint32_t index) noexcept {
    auto &frame = history_[index % kHistory];
    frame.index = index;
    return frame;
  }
  Frame &frame(std::uint32_t index) noexcept { return history_[index % kHistory]; }
  const Frame *find(std::uint32_t index) const noexcept {
    const auto &frame = history_[index % kHistory];
    return frame.index == index ? &frame : nullptr;
  }
  static void setInput(Frame &frame, const float *short_window, const float *long_window) noexcept {
    for (auto channel = 0u; channel < 2u; ++channel) {
      const auto *input = channel ? long_window : short_window;
      auto *amplitude = frame.amplitudes.data() + channel * 300u;
      for (auto bin = 0u; bin < 300u; ++bin)
        amplitude[bin] = std::expm1(input[bin]) * 1.0e-4F;
      for (auto band = 0u; band < 32u; ++band) {
        const auto begin = band * 300u / 32u, end = (band + 1u) * 300u / 32u;
        float energy = 0.0F;
        for (auto bin = begin; bin < end; ++bin)
          energy += amplitude[bin] * amplitude[bin];
        frame.envelope[channel * 32u + band] =
            10.0F * std::log10(energy / static_cast<float>(end - begin) + 1.0e-12F);
      }
    }
  }
  template <class Emit> void start(std::uint32_t pitch, std::uint32_t origin, Emit emit) noexcept {
    if (!find(origin))
      return;
    stop(pitch, origin, emit);
    auto &notes = notes_[pitch];
    for (auto slot = 0u; slot < notes.size(); ++slot) {
      auto &note = notes[slot];
      if (note.result.noteId)
        continue;
      note = {};
      if (++next_id_ == 0u)
        ++next_id_;
      note.result = {next_id_, pitch + 21u, origin, kOpenEnd, 1u, {}};
      note.input[1336] = static_cast<float>(pitch) / 87.0F;
      note.model_input[1336] = roundHalf(note.input[1336]);
      const auto *previous = origin ? find(origin - 1u) : find(origin);
      if (previous)
        note.pre = previous->envelope;
      else
        note.pre.fill(-120.0F);
      active_[pitch] = slot;
      emit(note.result);
      return;
    }
  }
  template <class Emit> void stop(std::uint32_t pitch, std::uint32_t end, Emit emit) noexcept {
    if (active_[pitch] == kOpenEnd)
      return;
    auto &note = notes_[pitch][active_[pitch]];
    note.result.end = end;
    auto &sounding = sounding_[pitch];
    if (sounding.boundary.noteId == note.result.noteId)
      sounding.boundary.end = end;
    for (auto i = 0u; i < record_count_; ++i) {
      auto &record = records_[(record_head_ + kRecords - 1u - i) % kRecords];
      if (record.boundary.noteId == note.result.noteId) {
        record.boundary.end = end;
        break;
      }
    }
    note.result.event = 3u;
    emit(note.result);
    active_[pitch] = kOpenEnd;
    if (note.observations == 3u)
      note.result.noteId = 0u;
  }
  // Build a bounded work list after all note boundaries for this frame are known.
  // The caller spreads these chunks over the remaining analysis slots.
  void beginAdvance(std::uint32_t confirmed) noexcept {
    chunk_count_ = chunk_cursor_ = batch_count_ = 0u;
    addChunk(ChunkKind::Rest, 1090.74);
    for (auto pitch = 0u; pitch < kPitches; ++pitch)
      for (auto &note : notes_[pitch]) {
        if (!note.result.noteId || note.observations == 3u)
          continue;
        auto observation = note.observations;
        while (observation < 3u && note.result.start + 2u * observation <= confirmed) {
          const auto time = note.result.start + observation * 2u;
          if (time < note.result.end && !find(time))
            break;
          addChunk(ChunkKind::Observe, 1128.52, &note, pitch, observation);
          ++observation;
        }
        if (observation == 3u) {
          const auto index = batch_count_++;
          pending_[index] = &note;
          for (auto part = 0u; part < 8u; ++part)
            addChunk(ChunkKind::Make, 882.965, &note, index, part);
          addChunk(ChunkKind::Sounding, 263.724, &note, index);
        }
      }
    if (!batch_count_)
      return;
    addChunk(ChunkKind::Insert, 313.724);
    auto context = batch_count_, candidates = 0u;
    for (auto i = 0u; i < record_count_; ++i) {
      const auto &record = records_[(record_head_ + kRecords - 1u - i) % kRecords];
      if (record.time > confirmed)
        continue;
      const auto age = confirmed - record.time;
      if (age >= 750u)
        break;
      ++context;
      if (age > 0u && age <= 200u && candidates < kCandidates)
        ++candidates;
    }
    context = context < kRecords ? context : kRecords;
    for (auto i = 0u; i < batch_count_; ++i) {
      addChunk(ChunkKind::Context, 2.46781 * context + 303.46, nullptr, i);
      addChunk(ChunkKind::Link, 316.195 * candidates + 10297.0, nullptr, i);
      addChunk(ChunkKind::Inventory, 613.724, nullptr, i);
      addChunk(ChunkKind::Refine, 763.724, nullptr, i);
    }
    addChunk(ChunkKind::Emit, 13.9416 * batch_count_ + 33.5521);
  }
  bool advancePending() const noexcept { return chunk_cursor_ < chunk_count_; }
  double nextAdvanceCost() const noexcept { return chunks_[chunk_cursor_].cost; }
  double advanceCost() const noexcept {
    double result = 0.0;
    for (auto i = 0u; i < chunk_count_; ++i)
      result += chunks_[i].cost;
    return result;
  }
  template <class Emit> void advanceChunk(Emit emit) noexcept {
    if (!advancePending())
      return;
    const auto &chunk = chunks_[chunk_cursor_++];
    switch (chunk.kind) {
    case ChunkKind::Rest:
      break;
    case ChunkKind::Observe: {
      auto &note = *chunk.note;
      const auto time = note.result.start + chunk.part * 2u;
      auto *destination = note.input.data() + chunk.part * 424u;
      if (time < note.result.end) {
        const auto &source = *find(time);
        std::copy_n(source.a.data() + chunk.index * 216u, 216u, destination);
        descriptor(source, chunk.index, note.pre.data(), destination + 216u);
        std::copy_n(source.c.data() + chunk.index * 64u, 64u, note.input.data() + 1272u);
        for (auto i = 1272u; i < 1336u; ++i)
          note.model_input[i] = roundHalf(note.input[i]);
        ++observations_;
      } else if (chunk.part) {
        std::copy_n(destination - 424u, 424u, destination);
      }
      for (auto i = chunk.part * 424u; i < (chunk.part + 1u) * 424u; ++i)
        note.model_input[i] = roundHalf(note.input[i]);
      ++note.observations;
      break;
    }
    case ChunkKind::Make: {
      auto &record = batch_[chunk.index];
      if (!chunk.part) {
        record = {};
        record.boundary = chunk.note->result;
        record.time = record.boundary.start + 4u;
        latest_input_[record.boundary.midi - 21u] = chunk.note->input.data();
      }
      project(chunk.note->model_input.data(), record.z.data(), chunk.part * 4u,
              (chunk.part + 1u) * 4u);
      if (chunk.part == 7u) {
        inferProjected(record.z.data(), record.logits.data(), record.p.data());
        for (auto &value : record.z)
          value = roundHalf(value);
        describeRecord(record, chunk.note->model_input.data());
      }
      break;
    }
    case ChunkKind::Sounding:
      batch_[chunk.index].cx = soundingContext(batch_[chunk.index].time, chunk.note->result.midi);
      break;
    case ChunkKind::Insert:
      insertBatch(batch_.data(), batch_count_);
      break;
    case ChunkKind::Context:
      batch_features_[chunk.index] = {};
      contextFeatures(batch_[chunk.index], batch_features_[chunk.index].ctx.data());
      break;
    case ChunkKind::Link:
      linkFeatures(batch_[chunk.index], batch_features_[chunk.index].link.data());
      break;
    case ChunkKind::Inventory:
      inventoryFeatures(batch_[chunk.index], batch_features_[chunk.index].inv.data());
      break;
    case ChunkKind::Refine: {
      auto &record = batch_[chunk.index];
      auto &features = batch_features_[chunk.index];
      refine(record, features);
      record.boundary.probabilities = features.probabilities;
      latest_features_[record.boundary.midi - 21u] = features;
      break;
    }
    case ChunkKind::Emit:
      for (auto i = 0u; i < batch_count_; ++i) {
        auto &note = *pending_[i];
        note.result.probabilities = batch_[i].boundary.probabilities;
        ++decisions_;
        note.result.event = 2u;
        emit(note.result);
        if (note.result.end != kOpenEnd)
          note.result.noteId = 0u;
      }
      break;
    }
  }
  // Synchronous entry point for reference tests and offline callers.
  template <class Emit> void advance(std::uint32_t confirmed, Emit emit) noexcept {
    beginAdvance(confirmed);
    while (advancePending())
      advanceChunk(emit);
  }
  static void descriptor(const Frame &frame, std::uint32_t pitch, const float *pre,
                         float *output) noexcept {
    for (auto channel = 0u; channel < 2u; ++channel) {
      const auto *amplitude = frame.amplitudes.data() + channel * 300u;
      const auto base = static_cast<float>(pitch * 3u + 1u);
      const auto fundamental = interpolate(amplitude, base);
      for (auto harmonic = 0u; harmonic < 20u; ++harmonic) {
        const auto number = static_cast<float>(harmonic + 1u);
        const auto position = base + 36.0F * std::log2(number);
        const auto middle = base + 36.0F * std::log2(number + .5F);
        const auto value = interpolate(amplitude, position);
        output[channel * 20u + harmonic] =
            position <= 299.0F ? 20.0F * std::log10((value + 1.0e-6F) / (fundamental + 1.0e-6F))
                               : 0.0F;
        const auto lower = interpolate(amplitude, position - 1.0F);
        const auto upper = interpolate(amplitude, position + 1.0F);
        const auto inter = interpolate(amplitude, middle);
        output[104u + channel * 20u + harmonic] =
            position >= 1.0F && position <= 298.0F && middle <= 299.0F
                ? 10.0F * std::log10(
                              ((lower * lower + value * value + upper * upper) / 3.0F + 1.0e-12F) /
                              (inter * inter + 1.0e-12F))
                : 0.0F;
      }
    }
    for (auto band = 0u; band < 64u; ++band) {
      output[40u + band] = frame.envelope[band];
      output[144u + band] = frame.envelope[band] - pre[band];
    }
  }
  static Record makeRecord(const Result &boundary, const float *input) noexcept {
    Record record;
    record.boundary = boundary;
    record.time = boundary.start + 4u;
    std::array<float, kInput> rounded{};
    for (auto i = 0u; i < kInput; ++i)
      rounded[i] = roundHalf(input[i]);
    project(rounded.data(), record.z.data(), 0u, 32u);
    inferProjected(record.z.data(), record.logits.data(), record.p.data());
    for (auto &value : record.z)
      value = roundHalf(value);
    describeRecord(record, rounded.data());
    return record;
  }
  static void describeRecord(Record &record, const float *input) noexcept {
    double energy = 0.0;
    for (auto i = 848u; i < 1064u; ++i)
      energy += static_cast<double>(input[i]) * input[i];
    record.level = static_cast<float>(std::sqrt(energy / 216.0));
    const auto bin = (record.boundary.midi - 21u) * 3u + 1u;
    auto band = 0u;
    while (band < 31u && bin >= (band + 1u) * 300u / 32u)
      ++band;
    record.f0 = .5F * (input[256u + band] + input[288u + band]);
    for (auto coarse = 0u; coarse < 8u; ++coarse) {
      double sum = 0.0;
      for (auto i = 0u; i < 4u; ++i)
        sum += static_cast<double>(input[256u + coarse * 4u + i]) + input[288u + coarse * 4u + i];
      record.coarse[coarse] = static_cast<float>(sum / 8.0);
    }
  }
  // All base records for one confirmation frame enter history before any refinement.
  void evaluateBatch(Record *batch, std::uint32_t count, Features *diagnostics = nullptr) noexcept {
    if (!count)
      return;
    insertBatch(batch, count);
    for (auto i = 0u; i < count; ++i) {
      Features features;
      contextFeatures(batch[i], features.ctx.data());
      linkFeatures(batch[i], features.link.data());
      inventoryFeatures(batch[i], features.inv.data());
      refine(batch[i], features);
      batch[i].boundary.probabilities = features.probabilities;
      latest_features_[batch[i].boundary.midi - 21u] = features;
      if (diagnostics)
        diagnostics[i] = features;
    }
  }
  const Features &latestFeatures(std::uint32_t pitch) const noexcept {
    return latest_features_[pitch];
  }
  const float *latestInput(std::uint32_t pitch) const noexcept { return latest_input_[pitch]; }
  static void infer(const float *input, float *logits, float *probabilities,
                    float *projection = nullptr) noexcept {
    std::array<float, kInput> rounded{};
    for (auto i = 0u; i < kInput; ++i)
      rounded[i] = roundHalf(input[i]);
    std::array<float, 32> projected{};
    project(rounded.data(), projected.data(), 0u, 32u);
    if (projection)
      std::copy(projected.begin(), projected.end(), projection);
    inferProjected(projected.data(), logits, probabilities);
  }
  static void refine(const Record &record, Features &features) noexcept {
    using namespace timbre_weights;
    std::array<float, 103> input{};
    auto maximum = record.logits[0];
    for (const auto value : record.logits)
      if (value > maximum)
        maximum = value;
    double sum = 0.0;
    for (const auto value : record.logits)
      sum += std::exp(static_cast<double>(value - maximum));
    const auto normalizer = maximum + static_cast<float>(std::log(sum));
    for (auto i = 0u; i < 9u; ++i)
      input[i] = record.logits[i] - normalizer;
    std::copy(record.z.begin(), record.z.end(), input.data() + 9u);
    std::copy(features.ctx.begin(), features.ctx.end(), input.data() + 41u);
    std::copy(features.link.begin(), features.link.end(), input.data() + 72u);
    std::copy(features.inv.begin(), features.inv.end(), input.data() + 83u);
    std::array<float, 64> hidden0{}, hidden1{};
    linear<103, 64>(input.data(), hidden0.data(), kRefineHidden0Weight, kRefineHidden0Bias, true);
    linear<64, 64>(hidden0.data(), hidden1.data(), kRefineHidden1Weight, kRefineHidden1Bias, true);
    linear<64, 9>(hidden1.data(), features.logits.data(), kRefineOutputWeight, kRefineOutputBias,
                  false);
    for (auto i = 0u; i < 9u; ++i)
      features.logits[i] += record.logits[i];
    softmax(features.logits.data(), features.probabilities.data());
  }
  static void softmax(const float *logits, float *probabilities) noexcept {
    auto maximum = logits[0];
    for (auto i = 1u; i < 9u; ++i)
      if (logits[i] > maximum)
        maximum = logits[i];
    float sum = 0.0F;
    for (auto i = 0u; i < 9u; ++i)
      sum += probabilities[i] = std::exp(logits[i] - maximum);
    for (auto i = 0u; i < 9u; ++i)
      probabilities[i] /= sum;
  }
  std::uint64_t observations() const noexcept { return observations_; }
  std::uint64_t decisions() const noexcept { return decisions_; }

private:
  // Match the model's binary16 storage boundaries, using round-to-nearest-even.
  static float roundHalf(float value) noexcept {
    std::uint32_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    const auto sign = bits & 0x80000000u;
    const auto magnitude = bits & 0x7fffffffu;
    std::uint32_t rounded;
    if (magnitude >= 0x7f800000u)
      return value;
    if (magnitude >= 0x38800000u) {
      rounded = (magnitude + 0xfffu + ((magnitude >> 13u) & 1u)) & 0xffffe000u;
      if (rounded >= 0x47800000u)
        rounded = 0x7f800000u;
    } else {
      const auto exponent = magnitude >> 23u;
      if (exponent < 102u)
        rounded = 0u;
      else {
        const auto shift = 126u - exponent;
        const auto mantissa = (magnitude & 0x7fffffu) | 0x800000u;
        const auto units =
            (mantissa + ((1u << (shift - 1u)) - 1u) + ((mantissa >> shift) & 1u)) >> shift;
        const auto small = static_cast<float>(units) * 0x1p-24F;
        std::memcpy(&rounded, &small, sizeof(rounded));
      }
    }
    rounded |= sign;
    std::memcpy(&value, &rounded, sizeof(value));
    return value;
  }
  void insertBatch(const Record *batch, std::uint32_t count) noexcept {
    const auto time = batch[0].time;
    const auto decay = std::exp(-static_cast<double>(time - inventory_time_) / 1000.0);
    for (auto &sum : inventory_)
      for (auto &value : sum)
        value *= decay;
    inventory_time_ = time;
    for (auto i = 0u; i < count; ++i) {
      const auto &record = batch[i];
      records_[record_head_] = record;
      record_head_ = (record_head_ + 1u) % kRecords;
      if (record_count_ < kRecords)
        ++record_count_;
      sounding_[record.boundary.midi - 21u] = record;
      for (const auto slot : {0u, record.boundary.midi - 20u}) {
        auto &sum = inventory_[slot];
        for (auto k = 0u; k < 9u; ++k)
          sum[k] += record.p[k];
        sum[9] += 1.0;
      }
    }
  }
  static void project(const float *input, float *output, std::uint32_t begin,
                      std::uint32_t end) noexcept {
    using namespace timbre_weights;
    for (auto j = begin; j < end; ++j)
      output[j] = kWeights[kProjectBias + j];
    for (auto i = 0u; i < kInput; ++i)
      for (auto j = begin; j < end; ++j)
        output[j] += input[i] * kWeights[kProjectWeight + i * 32u + j];
  }
  static void inferProjected(const float *projected, float *logits, float *probabilities) noexcept {
    using namespace timbre_weights;
    std::array<float, 64> hidden0{}, hidden1{};
    linear<32, 64>(projected, hidden0.data(), kHidden0Weight, kHidden0Bias, true);
    linear<64, 64>(hidden0.data(), hidden1.data(), kHidden1Weight, kHidden1Bias, true);
    linear<64, 9>(hidden1.data(), logits, kOutputWeight, kOutputBias, false);
    softmax(logits, probabilities);
  }
  std::array<float, 3> soundingContext(std::uint32_t time, std::uint32_t midi) const noexcept {
    auto low = 999u, high = 0u, count = 0u;
    for (const auto &notes : notes_)
      for (const auto &note : notes) {
        const auto &boundary = note.result;
        if (!boundary.noteId || boundary.start > time || boundary.end <= time)
          continue;
        low = boundary.midi < low ? boundary.midi : low;
        high = boundary.midi > high ? boundary.midi : high;
        ++count;
      }
    return {midi <= low ? 1.0F : 0.0F, !count || midi >= high ? 1.0F : 0.0F,
            std::log1p(static_cast<float>(count))};
  }
  void contextFeatures(const Record &self, float *output) const noexcept {
    const auto midi = static_cast<float>(self.boundary.midi);
    for (auto i = 0u; i < 6u; ++i) {
      const auto distance = (midi - (24.0F + 14.4F * i)) / 7.2F;
      output[i] = std::exp(-.5F * distance * distance);
    }
    auto low = self.boundary.midi, high = low, count = 1u;
    auto maximum = self.f0;
    for (const auto &record : sounding_) {
      const auto &boundary = record.boundary;
      if (!boundary.noteId || boundary.noteId == self.boundary.noteId || record.time > self.time ||
          boundary.end <= self.time)
        continue;
      low = boundary.midi < low ? boundary.midi : low;
      high = boundary.midi > high ? boundary.midi : high;
      maximum = record.f0 > maximum ? record.f0 : maximum;
      ++count;
    }
    output[6] = static_cast<float>(low - 21u) / 87.0F;
    output[7] = static_cast<float>(high - 21u) / 87.0F;
    output[8] = std::log1p(static_cast<float>(count));
    output[9] = (midi - low) / 12.0F;
    output[10] = (high - midi) / 12.0F;
    output[11] = self.f0;
    output[12] = self.f0 - maximum;
    double salience = 0.0;
    std::array<double, 8> sum{}, square{};
    auto short_count = 0u, long_count = 0u;
    for (auto i = 0u; i < record_count_; ++i) {
      const auto &record = records_[(record_head_ + kRecords - 1u - i) % kRecords];
      if (record.time > self.time)
        continue;
      const auto age = self.time - record.time;
      if (age >= 750u)
        break;
      if (age < 150u) {
        salience += record.f0;
        ++short_count;
      }
      for (auto k = 0u; k < 8u; ++k) {
        sum[k] += record.coarse[k];
        square[k] += static_cast<double>(record.coarse[k]) * record.coarse[k];
      }
      ++long_count;
    }
    output[13] = self.f0 - static_cast<float>(salience / short_count);
    for (auto k = 0u; k < 8u; ++k) {
      const auto mean = sum[k] / long_count;
      const auto variance = square[k] / long_count - mean * mean;
      output[14u + k] = static_cast<float>(mean);
      output[22u + k] = static_cast<float>(std::sqrt(variance > 0.0 ? variance : 0.0));
    }
    const auto age = self.time > context_start_ ? self.time - context_start_ : 0u;
    output[30] = static_cast<float>(age < 750u ? age : 750u) / 750.0F;
  }
  void inventoryFeatures(const Record &self, float *output) const noexcept {
    auto global = inventory_[0];
    std::array<double, 10> pitch{};
    for (auto i = 0u; i < kPitches; ++i) {
      const auto distance = (static_cast<double>(self.boundary.midi) - (i + 21u)) / 4.0;
      const auto weight = std::exp(-.5 * distance * distance);
      for (auto k = 0u; k < 10u; ++k)
        pitch[k] += weight * inventory_[i + 1u][k];
    }
    for (auto group = 0u; group < 2u; ++group) {
      const auto &sum = group ? pitch : global;
      const auto weight = sum[9] > 1.0 ? sum[9] - 1.0 : 0.0;
      for (auto k = 0u; k < 9u; ++k)
        output[group * 10u + k] =
            static_cast<float>((sum[k] - self.p[k] + .5 / 9.0) / (weight + .5));
      output[group * 10u + 9u] = static_cast<float>(std::log1p(weight));
    }
  }
  static float linkScore(const Record &self, const Record &past) noexcept {
    using namespace timbre_weights;
    std::array<float, 58> input{};
    const auto difference = static_cast<float>(self.boundary.midi) - past.boundary.midi;
    const auto absolute = difference < 0.0F ? -difference : difference;
    const auto level = std::log(self.level + 1.0e-5F) - std::log(past.level + 1.0e-5F);
    input[0] = static_cast<float>(self.boundary.start - past.boundary.start) / 200.0F;
    input[1] = static_cast<float>(self.time - past.time) / 200.0F;
    input[2] = difference / 24.0F;
    input[3] = absolute / 24.0F;
    input[4] = difference == 0.0F ? 1.0F : 0.0F;
    input[5] = absolute <= 2.0F ? 1.0F : 0.0F;
    input[6] = absolute == 12.0F ? 1.0F : 0.0F;
    input[7] = past.boundary.end > self.time ? 1.0F : 0.0F;
    input[8] = past.boundary.end < self.time
                   ? static_cast<float>(self.time - past.boundary.end) / 200.0F
                   : 0.0F;
    input[9] = static_cast<float>(past.boundary.midi) / 108.0F;
    input[10] = static_cast<float>(self.boundary.midi) / 108.0F;
    input[11] = level;
    input[12] = level < 0.0F ? -level : level;
    std::copy(self.cx.begin(), self.cx.end(), input.data() + 13u);
    std::copy(past.cx.begin(), past.cx.end(), input.data() + 16u);
    auto self_class = 0u, past_class = 0u;
    for (auto k = 0u; k < 9u; ++k) {
      const auto delta = self.p[k] - past.p[k];
      input[19] += self.p[k] * past.p[k];
      input[20] += delta < 0.0F ? -delta : delta;
      if (self.p[k] > self.p[self_class])
        self_class = k;
      if (past.p[k] > past.p[past_class])
        past_class = k;
    }
    input[21] = self_class == past_class ? 1.0F : 0.0F;
    input[22] = self.p[self_class];
    input[23] = past.p[past_class];
    float dot = 0.0F, self_norm = 0.0F, past_norm = 0.0F, square = 0.0F;
    for (auto k = 0u; k < 32u; ++k) {
      const auto scale = kWeights[kZStdOffset + k];
      const auto a = self.z[k] / scale, b = past.z[k] / scale, delta = a - b;
      dot += a * b;
      self_norm += a * a;
      past_norm += b * b;
      square += delta * delta;
      input[26u + k] = delta < 0.0F ? -delta : delta;
    }
    input[24] = dot / (std::sqrt(self_norm) * std::sqrt(past_norm) + 1.0e-8F);
    input[25] = std::sqrt(square / 32.0F);
    std::array<float, 24> hidden{};
    float logit = 0.0F;
    linear<58, 24>(input.data(), hidden.data(), kLinkHiddenWeight, kLinkHiddenBias, true);
    linear<24, 1>(hidden.data(), &logit, kLinkOutputWeight, kLinkOutputBias, false);
    return 1.0F / (1.0F + std::exp(-logit));
  }
  void linkFeatures(const Record &self, float *output) const noexcept {
    std::array<double, 9> sum{};
    double weight = 0.0;
    auto count = 0u;
    for (auto i = 0u; i < record_count_ && count < kCandidates; ++i) {
      const auto &past = records_[(record_head_ + kRecords - 1u - i) % kRecords];
      if (past.time >= self.time)
        continue;
      if (self.time - past.time > 200u)
        break;
      const auto score = linkScore(self, past);
      weight += score;
      output[10] = score > output[10] ? score : output[10];
      for (auto k = 0u; k < 9u; ++k)
        sum[k] += static_cast<double>(score) * past.p[k];
      ++count;
    }
    if (weight > 0.0)
      for (auto k = 0u; k < 9u; ++k)
        output[k] = static_cast<float>(sum[k] / weight);
    output[9] = static_cast<float>(std::log1p(weight));
  }
  static float interpolate(const float *amplitude, float position) noexcept {
    const auto bounded = position < 0.0F ? 0.0F : position > 299.0F ? 299.0F : position;
    const auto lower = static_cast<std::uint32_t>(bounded);
    const auto upper = lower < 299u ? lower + 1u : lower;
    const auto alpha = bounded - static_cast<float>(lower);
    return amplitude[lower] * (1.0F - alpha) + amplitude[upper] * alpha;
  }
  template <std::uint32_t Inputs, std::uint32_t Outputs>
  static void linear(const float *input, float *output, std::size_t weight, std::size_t bias,
                     bool relu) noexcept {
    std::copy_n(timbre_weights::kWeights.data() + bias, Outputs, output);
    for (auto i = 0u; i < Inputs; ++i) {
      const auto *row = timbre_weights::kWeights.data() + weight + i * Outputs;
      for (auto j = 0u; j < Outputs; ++j)
        output[j] += input[i] * row[j];
    }
    if (relu)
      for (auto j = 0u; j < Outputs; ++j)
        if (output[j] < 0.0F)
          output[j] = 0.0F;
  }
  struct Note {
    Result result{};
    std::array<float, kInput> input{}, model_input{};
    std::array<float, 64> pre{};
    std::uint32_t observations = 0u;
  };
  enum class ChunkKind : std::uint8_t {
    Rest,
    Observe,
    Make,
    Sounding,
    Insert,
    Context,
    Link,
    Inventory,
    Refine,
    Emit
  };
  struct Chunk {
    ChunkKind kind = ChunkKind::Rest;
    double cost = 0.0;
    Note *note = nullptr;
    std::uint32_t index = 0u, part = 0u;
  };
  void addChunk(ChunkKind kind, double cost, Note *note = nullptr, std::uint32_t index = 0u,
                std::uint32_t part = 0u) noexcept {
    chunks_[chunk_count_++] = {kind, cost, note, index, part};
  }
  // Each of the three pending notes per pitch needs at most three observations,
  // eight projection chunks, sounding context and four refinement chunks.
  std::array<Chunk, 3u + kPitches * 3u * 16u> chunks_{};
  std::uint32_t chunk_count_ = 0u, chunk_cursor_ = 0u, batch_count_ = 0u;
  std::array<Features, kPitches * 3u> batch_features_{};
  std::array<Frame, kHistory> history_{};
  std::array<std::array<Note, 3>, kPitches> notes_{};
  std::array<std::uint32_t, kPitches> active_{};
  std::array<Record, kRecords> records_{};
  std::array<Record, kPitches> sounding_{};
  std::array<Features, kPitches> latest_features_{};
  std::array<const float *, kPitches> latest_input_{};
  std::array<Record, kPitches * 3u> batch_{};
  std::array<Note *, kPitches * 3u> pending_{};
  std::array<std::array<double, 10>, kPitches + 1u> inventory_{};
  std::uint32_t record_head_ = 0u, record_count_ = 0u, inventory_time_ = 0u, context_start_ = 0u;
  std::uint32_t next_id_ = 0u;
  std::uint64_t observations_ = 0u, decisions_ = 0u;
};
} // namespace effetune::plugins::analyzer
