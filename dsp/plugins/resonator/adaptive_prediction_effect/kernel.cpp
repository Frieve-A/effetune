#include "effetune/kernel.h"
#include "AdaptivePredictionEffectPluginParams.h"
#include "effetune/dsp/math.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif

namespace effetune::plugins::resonator {
namespace {

constexpr std::uint32_t kUnits = 32u;
constexpr std::uint32_t kFeatures = 48u;
constexpr std::uint32_t kHistoryStride = kUnits + 1u;
constexpr std::uint32_t kTableIntervals = 4096u;
// Keep float32 learning products normal as well as the recursive state itself.
constexpr float kMinimumMagnitude = 1.0e-18F;
constexpr std::array<std::uint32_t, 4> kOffsets{1u, 5u, 11u, 17u};
constexpr std::array<std::uint32_t, 16> kTapPositions{0u,  1u,  2u,  3u,  4u,  6u,  8u,   12u,
                                                      16u, 24u, 32u, 48u, 64u, 96u, 192u, 384u};
constexpr std::array<float, 4> kLeaks{1.0F, 0.125F, 0.015625F, 0.001953125F};

#if defined(__wasm_simd128__)
using Float4 = v128_t;
inline Float4 load4(const float *source) noexcept { return wasm_v128_load(source); }
inline void store4(float *destination, Float4 value) noexcept {
  wasm_v128_store(destination, value);
}
inline Float4 splat4(float value) noexcept { return wasm_f32x4_splat(value); }
inline Float4 add4(Float4 left, Float4 right) noexcept { return wasm_f32x4_add(left, right); }
inline Float4 subtract4(Float4 left, Float4 right) noexcept { return wasm_f32x4_sub(left, right); }
inline Float4 multiply4(Float4 left, Float4 right) noexcept { return wasm_f32x4_mul(left, right); }
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
using Float4 = float32x4_t;
inline Float4 load4(const float *source) noexcept { return vld1q_f32(source); }
inline void store4(float *destination, Float4 value) noexcept { vst1q_f32(destination, value); }
inline Float4 splat4(float value) noexcept { return vdupq_n_f32(value); }
inline Float4 add4(Float4 left, Float4 right) noexcept { return vaddq_f32(left, right); }
inline Float4 subtract4(Float4 left, Float4 right) noexcept { return vsubq_f32(left, right); }
inline Float4 multiply4(Float4 left, Float4 right) noexcept { return vmulq_f32(left, right); }
#else
struct Float4 final {
  std::array<float, 4> lanes{};
};
inline Float4 load4(const float *source) noexcept {
  return {{source[0], source[1], source[2], source[3]}};
}
inline void store4(float *destination, Float4 value) noexcept {
  for (std::uint32_t lane = 0u; lane < 4u; ++lane)
    destination[lane] = value.lanes[lane];
}
inline Float4 splat4(float value) noexcept { return {{value, value, value, value}}; }
inline Float4 add4(Float4 left, Float4 right) noexcept {
  for (std::uint32_t lane = 0u; lane < 4u; ++lane)
    left.lanes[lane] += right.lanes[lane];
  return left;
}
inline Float4 subtract4(Float4 left, Float4 right) noexcept {
  for (std::uint32_t lane = 0u; lane < 4u; ++lane)
    left.lanes[lane] -= right.lanes[lane];
  return left;
}
inline Float4 multiply4(Float4 left, Float4 right) noexcept {
  for (std::uint32_t lane = 0u; lane < 4u; ++lane)
    left.lanes[lane] *= right.lanes[lane];
  return left;
}
#endif

Float4 flushTiny4(Float4 value) noexcept {
#if defined(__wasm_simd128__)
  return wasm_v128_bitselect(splat4(0.0F), value,
                             wasm_f32x4_lt(wasm_f32x4_abs(value), splat4(kMinimumMagnitude)));
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
  return vbslq_f32(vcltq_f32(vabsq_f32(value), splat4(kMinimumMagnitude)), splat4(0.0F), value);
#else
  for (float &lane : value.lanes)
    lane = dsp::flush_denorm(lane, kMinimumMagnitude);
  return value;
#endif
}

float sum4(Float4 value) noexcept {
  std::array<float, 4> lanes{};
  store4(lanes.data(), value);
  return ((lanes[0] + lanes[1]) + lanes[2]) + lanes[3];
}

float dot(const float *left, const float *right) noexcept {
  Float4 total = splat4(0.0F);
  for (std::uint32_t feature = 0u; feature < kFeatures; feature += 4u)
    total = add4(total, multiply4(load4(left + feature), load4(right + feature)));
  return sum4(total);
}

float clamp(float value, float minimum, float maximum) noexcept {
  return value < minimum ? minimum : (value > maximum ? maximum : value);
}

float parameter(float value, float minimum, float maximum, float fallback) noexcept {
  return std::isfinite(value) ? clamp(value, minimum, maximum) : fallback;
}

std::uint32_t resetToken(float value) noexcept {
  return static_cast<std::uint32_t>(parameter(value, 0.0F, 16777215.0F, 0.0F));
}

std::uint32_t randomBits(std::uint32_t &state) noexcept {
  state ^= state << 13u;
  state ^= state >> 17u;
  state ^= state << 5u;
  return state;
}

float randomWeight(std::uint32_t &state) noexcept {
  return static_cast<float>(randomBits(state) >> 8u) * (2.0F / 16777216.0F) - 1.0F;
}

struct PathState final {
  std::array<float, kUnits> state{};
  std::uint32_t position = 0u;
  std::uint32_t valid = 0u;

  void reset() noexcept {
    state.fill(0.0F);
    position = 0u;
    valid = 0u;
  }
};

struct ChannelState final {
  std::array<float, kFeatures> weights{};
  std::array<float, kFeatures> gradient{};
  PathState training{};
  PathState generation{};
  float feature_energy = 0.0F;
  float input_energy = 0.0F;
  float feedback_previous_input = 0.0F;
  float feedback_previous_output = 0.0F;
  float last_prediction = 0.0F;
  float last_generation = 0.0F;
  std::uint32_t batch_samples = 0u;
  bool batch_allowed = true;
  bool fault = false;

  void clearBatch() noexcept {
    gradient.fill(0.0F);
    feature_energy = 0.0F;
    input_energy = 0.0F;
    batch_samples = 0u;
    batch_allowed = true;
  }

  void reset() noexcept {
    weights.fill(0.0F);
    training.reset();
    generation.reset();
    clearBatch();
    feedback_previous_input = 0.0F;
    feedback_previous_output = 0.0F;
    last_prediction = 0.0F;
    last_generation = 0.0F;
    fault = false;
  }
};

enum Control : std::size_t {
  Gap,
  Learn,
  DecayRate,
  Autonomy,
  Original,
  Residual,
  Prediction,
  Count
};
using Controls = std::array<float, Control::Count>;

} // namespace

class AdaptivePredictionEffectKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AdaptivePredictionEffectPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    max_channels_ = info.maxChannels > 2u ? 2u : info.maxChannels;
    max_frames_ = info.maxFrames;
    if (!std::isfinite(sample_rate_) || sample_rate_ <= 0.0F || max_channels_ == 0u ||
        max_frames_ == 0u) {
      sample_rate_ = 0.0F;
      return;
    }
    const double minimum_history =
        std::ceil(static_cast<double>(sample_rate_) * 0.5) +
        std::round(static_cast<double>(kTapPositions.back()) * sample_rate_ / 48000.0) + 2.0;
    if (minimum_history > std::numeric_limits<std::uint32_t>::max() / kHistoryStride - 511u) {
      sample_rate_ = 0.0F;
      return;
    }
    for (std::uint32_t tap = 0u; tap < taps_.size(); ++tap)
      taps_[tap] = static_cast<std::uint32_t>(
          std::round(static_cast<float>(kTapPositions[tap]) * sample_rate_ / 48000.0F));
    history_length_ = ((static_cast<std::uint32_t>(minimum_history) + 511u) / 512u) * 512u;
    history_.resize(static_cast<std::size_t>(max_channels_) * 2u * history_length_ *
                    kHistoryStride);
    tanh_table_.resize(kTableIntervals + 1u);
    for (std::uint32_t index = 0u; index <= kTableIntervals; ++index)
      tanh_table_[index] = std::tanh(-8.0F + static_cast<float>(index) / 256.0F);
    std::uint32_t seed = 0x41504531u;
    for (std::uint32_t unit = 0u; unit < kUnits; ++unit) {
      float row_magnitude = 0.0F;
      for (std::uint32_t connection = 0u; connection < kOffsets.size(); ++connection) {
        const float weight = randomWeight(seed);
        recurrent_[connection][unit] = weight;
        row_magnitude += weight < 0.0F ? -weight : weight;
      }
      const float scale = 0.9F / row_magnitude;
      for (std::uint32_t connection = 0u; connection < kOffsets.size(); ++connection)
        recurrent_[connection][unit] *= scale;
      input_weights_[unit] = randomWeight(seed);
    }
    feedback_pole_ = std::exp(-2.0F * 3.14159265358979323846F * 20.0F / sample_rate_);
    ramp_frames_ = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.01F));
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return sample_rate_ > 0.0F; }

  void reset() noexcept override {
    resetModel();
    controls_initialized_ = false;
    ramp_remaining_ = 0u;
    seen_reset_token_ = resetToken(params_.resetToken);
  }

  void readRuntimeEvent(RuntimeEventState &state) const noexcept override { state = event_; }

#if defined(ET_DEBUG_STATE)
  [[nodiscard]] bool readDebugState(DebugStateSnapshot &snapshot) const noexcept override {
    snapshot = {};
    snapshot.runtimeEvent = event_;
    snapshot.auxiliaryWords[0] =
        history_.size() * sizeof(float) + tanh_table_.size() * sizeof(float) + sizeof(*this);
    const auto count_subnormal = [&snapshot](float value) {
      std::uint32_t bits = 0u;
      std::memcpy(&bits, &value, sizeof(bits));
      if ((bits & 0x7f800000u) == 0u && (bits & 0x007fffffu) != 0u)
        ++snapshot.auxiliaryWords[5];
    };
    for (const float value : history_)
      count_subnormal(value);
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      const ChannelState &state = channels_[channel];
      for (const auto *values : {&state.training.state, &state.generation.state})
        for (const float value : *values)
          count_subnormal(value);
      for (const auto *values : {&state.weights, &state.gradient})
        for (const float value : *values)
          count_subnormal(value);
      for (const float value :
           {state.input_energy, state.feature_energy, state.feedback_previous_input,
            state.feedback_previous_output, state.last_prediction, state.last_generation})
        count_subnormal(value);
      snapshot.auxiliaryWords[1u + channel] = state.training.valid;
      snapshot.auxiliaryWords[3u + channel] = state.fault ? 1u : 0u;
      snapshot.auxiliaryValues[channel] =
          std::sqrt(dot(state.weights.data(), state.weights.data()));
      snapshot.auxiliaryValues[2u + channel] = state.last_prediction;
      snapshot.auxiliaryValues[4u + channel] = state.last_generation;
    }
    return true;
  }
#endif

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0F)
      return;
    const std::uint32_t token = resetToken(params_.resetToken);
    if (token != seen_reset_token_) {
      resetModel();
      seen_reset_token_ = token;
    }
    if (active_channels_ != channel_count) {
      resetModel();
      active_channels_ = channel_count;
    }
    updateControls();
    const bool freeze = params_.freeze != 0.0F || params_.hold != 0.0F;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      advanceControls();
      const float delay = controls_[Gap] * sample_rate_ * 0.001F + 1.0F;
      const std::uint32_t delay_integer = static_cast<std::uint32_t>(delay);
      const float delay_fraction = delay - static_cast<float>(delay_integer);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        ChannelState &state = channels_[channel];
        float *sample = audio + static_cast<std::size_t>(channel) * frame_count + frame;
        float input = *sample;
        if (!std::isfinite(input)) {
          latchFault(state);
          input = 0.0F;
        }
        input = dsp::flush_denorm(input, kMinimumMagnitude);
        std::array<float, kFeatures> training_features{};
        std::array<float, kFeatures> generation_features{};
        readFeatures(state.training, historyFor(channel, false), delay_integer, delay_fraction,
                     training_features.data());
        float prediction = dot(state.weights.data(), training_features.data());
        float generation = 0.0F;
        if (!state.fault) {
          readFeatures(state.generation, historyFor(channel, true), delay_integer, delay_fraction,
                       generation_features.data());
          generation = dot(state.weights.data(), generation_features.data());
        }
        if (!std::isfinite(prediction) || !std::isfinite(generation)) {
          latchFault(state);
          prediction = 0.0F;
          generation = 0.0F;
        }
        prediction = dsp::flush_denorm(prediction, kMinimumMagnitude);
        generation = dsp::flush_denorm(generation, kMinimumMagnitude);
        const float autonomy = controls_[Autonomy];
        const float predicted = (1.0F - autonomy) * prediction + autonomy * generation;
        float output = (controls_[Original] + controls_[Residual]) * input +
                       (controls_[Prediction] - controls_[Residual]) * predicted;
        const float feedback = state.fault ? 0.0F : feedbackSignal(state, generation);
        float generated_input = (1.0F - autonomy) * input + autonomy * feedback;
        const float error = input - prediction;
        if (!std::isfinite(output) || !std::isfinite(generated_input) || !std::isfinite(error)) {
          latchFault(state);
          output = clamp(controls_[Original] + controls_[Residual], -4.0F, 4.0F) *
                   clamp(input, -1.0F, 1.0F);
          generated_input = 0.0F;
        }
        *sample = clamp(output, -1.0F, 1.0F);
        state.last_prediction = prediction;
        state.last_generation = state.fault ? 0.0F : generation;
        if (!updatePath(state.training, historyFor(channel, false), input)) {
          state.training.reset();
          latchFault(state);
        }
        if (!state.fault &&
            !updatePath(state.generation, historyFor(channel, true), generated_input))
          latchFault(state);
        accumulateLearning(state, training_features.data(), input, error, freeze);
      }
    }
  }

private:
  float *historyFor(std::uint32_t channel, bool generation) noexcept {
    return history_.data() + (static_cast<std::size_t>(channel) * 2u + (generation ? 1u : 0u)) *
                                 history_length_ * kHistoryStride;
  }

  void resetModel() noexcept {
    // Invalidating each path's sample count avoids clearing the large history in the callback.
    for (ChannelState &state : channels_)
      state.reset();
    if (event_.latched != 0u)
      ++event_.generation;
    event_.latched = 0u;
    event_.cause = 0u;
    active_channels_ = 0u;
  }

  void latchFault(ChannelState &state) noexcept {
    if (!state.fault) {
      state.fault = true;
      state.generation.reset();
      state.clearBatch();
      state.feedback_previous_input = 0.0F;
      state.feedback_previous_output = 0.0F;
      ++event_.generation;
      event_.latched = 1u;
      event_.cause = 1u;
    }
  }

  Controls controlTargets() const noexcept {
    const float decay = parameter(params_.weightDecay, 0.0F, 60.0F, 0.0F);
    return {parameter(params_.gap, 0.0F, 500.0F, 1.0F),
            parameter(params_.learn, 0.0F, 0.1F, 0.02F),
            decay == 0.0F ? 0.0F : 1.0F / (decay < 0.5F ? 0.5F : decay),
            params_.hold != 0.0F ? 1.0F : parameter(params_.autonomy, 0.0F, 1.0F, 0.0F),
            parameter(params_.original, -2.0F, 2.0F, 0.0F),
            parameter(params_.residual, -2.0F, 2.0F, 1.0F),
            parameter(params_.prediction, -2.0F, 2.0F, 0.0F)};
  }

  void updateControls() noexcept {
    const Controls targets = controlTargets();
    if (!controls_initialized_) {
      controls_ = targets;
      targets_ = targets;
      controls_initialized_ = true;
    } else if (targets != targets_) {
      targets_ = targets;
      ramp_remaining_ = ramp_frames_;
    }
  }

  void advanceControls() noexcept {
    if (ramp_remaining_ == 0u)
      return;
    const float scale = 1.0F / static_cast<float>(ramp_remaining_);
    for (std::size_t index = 0u; index < controls_.size(); ++index)
      controls_[index] += (targets_[index] - controls_[index]) * scale;
    --ramp_remaining_;
    if (ramp_remaining_ == 0u)
      controls_ = targets_;
  }

  float activation(float value) const noexcept {
    const float limited = clamp(value, -8.0F, 8.0F);
    const float position = (limited + 8.0F) * 256.0F;
    const std::uint32_t index = static_cast<std::uint32_t>(position);
    if (index >= kTableIntervals)
      return tanh_table_[kTableIntervals];
    const float fraction = position - static_cast<float>(index);
    return tanh_table_[index] + fraction * (tanh_table_[index + 1u] - tanh_table_[index]);
  }

  std::uint32_t historyPosition(const PathState &path, std::uint32_t age) const noexcept {
    return path.position >= age ? path.position - age : path.position + history_length_ - age;
  }

  void readFeatures(const PathState &path, const float *history, std::uint32_t delay,
                    float fraction, float *features) const noexcept {
    if (path.valid >= delay) {
      const float *recent = history + historyPosition(path, delay) * kHistoryStride;
      const float *older = path.valid > delay
                               ? history + historyPosition(path, delay + 1u) * kHistoryStride
                               : nullptr;
      for (std::uint32_t unit = 0u; unit < kUnits; unit += 4u) {
        const Float4 latest = load4(recent + unit);
        const Float4 previous = older == nullptr ? splat4(0.0F) : load4(older + unit);
        store4(features + unit,
               flushTiny4(add4(latest, multiply4(subtract4(previous, latest), splat4(fraction)))));
      }
    }
    for (std::uint32_t tap = 0u; tap < taps_.size(); ++tap) {
      const std::uint32_t age = delay + taps_[tap];
      const float recent =
          path.valid >= age ? history[historyPosition(path, age) * kHistoryStride + kUnits] : 0.0F;
      const float older = path.valid > age
                              ? history[historyPosition(path, age + 1u) * kHistoryStride + kUnits]
                              : 0.0F;
      features[kUnits + tap] =
          dsp::flush_denorm(recent + fraction * (older - recent), kMinimumMagnitude);
    }
  }

  bool updatePath(PathState &path, float *history, float input) noexcept {
    std::array<float, kUnits * 2u> previous{};
    std::memcpy(previous.data(), path.state.data(), kUnits * sizeof(float));
    std::memcpy(previous.data() + kUnits, path.state.data(), kUnits * sizeof(float));
    for (std::uint32_t unit = 0u; unit < kUnits; unit += 4u) {
      Float4 recurrent = multiply4(load4(recurrent_[0].data() + unit),
                                   load4(previous.data() + kUnits + unit - kOffsets[0]));
      for (std::uint32_t connection = 1u; connection < kOffsets.size(); ++connection)
        recurrent = add4(recurrent,
                         multiply4(load4(recurrent_[connection].data() + unit),
                                   load4(previous.data() + kUnits + unit - kOffsets[connection])));
      std::array<float, 4> activated{};
      store4(activated.data(),
             add4(recurrent, multiply4(load4(input_weights_.data() + unit), splat4(input))));
      for (float &value : activated) {
        if (!std::isfinite(value))
          return false;
        value = activation(value);
      }
      const Float4 old = load4(path.state.data() + unit);
      store4(path.state.data() + unit,
             flushTiny4(add4(old, multiply4(subtract4(load4(activated.data()), old),
                                            splat4(kLeaks[unit / 8u])))));
    }
    float *destination = history + path.position * kHistoryStride;
    std::memcpy(destination, path.state.data(), kUnits * sizeof(float));
    destination[kUnits] = input;
    ++path.position;
    if (path.position == history_length_)
      path.position = 0u;
    if (path.valid < history_length_)
      ++path.valid;
    return true;
  }

  float feedbackSignal(ChannelState &state, float prediction) noexcept {
    const float filtered =
        dsp::flush_denorm(feedback_pole_ * (state.feedback_previous_output + prediction -
                                            state.feedback_previous_input),
                          kMinimumMagnitude);
    state.feedback_previous_input = prediction;
    state.feedback_previous_output = filtered;
    if (!std::isfinite(filtered)) {
      latchFault(state);
      return 0.0F;
    }
    return activation(filtered);
  }

  void accumulateLearning(ChannelState &state, const float *features, float input, float error,
                          bool freeze) noexcept {
    state.batch_allowed = state.batch_allowed && !freeze && !state.fault;
    state.input_energy += input * input;
    if (state.batch_allowed) {
      const Float4 clipped_error =
          splat4(dsp::flush_denorm(clamp(error, -0.25F, 0.25F), kMinimumMagnitude));
      Float4 energy = splat4(0.0F);
      for (std::uint32_t feature = 0u; feature < kFeatures; feature += 4u) {
        const Float4 value = load4(features + feature);
        energy = add4(energy, multiply4(value, value));
        store4(state.gradient.data() + feature,
               flushTiny4(
                   add4(load4(state.gradient.data() + feature), multiply4(value, clipped_error))));
      }
      state.feature_energy += sum4(energy);
    }
    ++state.batch_samples;
    if (state.batch_samples < 4u)
      return;
    if (!std::isfinite(state.input_energy) || !std::isfinite(state.feature_energy))
      latchFault(state);
    // Four-sample external RMS below -60 dBFS freezes both learning and weight decay.
    if (state.batch_allowed && state.input_energy >= 4.0e-6F) {
      const float decay = std::exp(-4.0F * controls_[DecayRate] / sample_rate_);
      const float scale = controls_[Learn] / (1.0e-6F + state.feature_energy);
      for (std::uint32_t feature = 0u; feature < kFeatures; feature += 4u)
        store4(state.weights.data() + feature,
               flushTiny4(add4(multiply4(load4(state.weights.data() + feature), splat4(decay)),
                               multiply4(load4(state.gradient.data() + feature), splat4(scale)))));
      const float norm_squared = dot(state.weights.data(), state.weights.data());
      if (!std::isfinite(norm_squared)) {
        state.weights.fill(0.0F);
        latchFault(state);
      } else if (norm_squared > 16.0F) {
        const Float4 projection = splat4(4.0F / std::sqrt(norm_squared));
        for (std::uint32_t feature = 0u; feature < kFeatures; feature += 4u)
          store4(state.weights.data() + feature,
                 flushTiny4(multiply4(load4(state.weights.data() + feature), projection)));
      }
    }
    state.clearBatch();
  }

  std::vector<float> history_;
  std::vector<float> tanh_table_;
  std::array<std::array<float, kUnits>, 4> recurrent_{};
  std::array<float, kUnits> input_weights_{};
  std::array<std::uint32_t, 16> taps_{};
  std::array<ChannelState, 2> channels_{};
  Controls controls_{};
  Controls targets_{};
  RuntimeEventState event_{0u, 0u, 0u};
  float sample_rate_ = 0.0F;
  float feedback_pole_ = 0.0F;
  std::uint32_t history_length_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t ramp_frames_ = 0u;
  std::uint32_t ramp_remaining_ = 0u;
  std::uint32_t seen_reset_token_ = 0u;
  bool controls_initialized_ = false;
};

static_assert(sizeof(AdaptivePredictionEffectKernel) <= 8192u);

} // namespace effetune::plugins::resonator

EFFETUNE_REGISTER_KERNEL(AdaptivePredictionEffectPlugin,
                         effetune::plugins::resonator::AdaptivePredictionEffectKernel)
