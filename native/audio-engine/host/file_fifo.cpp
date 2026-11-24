#include "host/file_fifo.h"
#include <algorithm>
#include <cmath>
#include <utility>

namespace effetune::audio {

FileFifo::FileFifo() : pcm_(capacity) {}

void FileFifo::configure(unsigned rate, unsigned period) noexcept {
  rate_.store(rate, std::memory_order_release);
  period_.store(period, std::memory_order_relaxed);
  formatRevision_.fetch_add(1, std::memory_order_release);
}

bool FileFifo::start(TrackInfo info, bool next) {
  const auto outputRate = rate_.load(std::memory_order_acquire);
  if (!outputRate || info.rate < 8000 || info.rate > 384000 || info.channels < 1 ||
      info.channels > maxChannels || !info.track || !info.generation || !std::isfinite(info.gain) ||
      (next ? !accepting_ || info.generation != writeGeneration_
            : info.generation <= writeGeneration_))
    return false;
  auto *command = commands_.writable();
  if (!command)
    return false;
  while (auto *retired = retired_.readable()) {
    retired->reset();
    retired_.pop();
  }
  command->type = next ? Command::Type::Next : Command::Type::Start;
  command->info = info;
  command->converter = info.rate == outputRate
                           ? nullptr
                           : std::make_unique<Resampler>(info.channels, info.rate, outputRate);
  if (!next) {
    accepting_ = true;
    writeGeneration_ = info.generation;
    writtenFrames_.store(0, std::memory_order_relaxed);
    writtenGeneration_.store(info.generation, std::memory_order_release);
  }
  commands_.publish();
  return true;
}

bool FileFifo::write(TrackInfo info, const float *planar, unsigned frames) noexcept {
  if (!accepting_ || info.generation != writeGeneration_ || !frames || frames > 8192 ||
      info.channels < 1 || info.channels > maxChannels)
    return false;
  const auto samples = std::uint64_t(frames) * info.channels;
  auto *command = commands_.writable();
  if (!command || writeOffset_ - released_.load(std::memory_order_acquire) + samples > capacity) {
    overflows_.fetch_add(1, std::memory_order_relaxed);
    return false;
  }
  auto index = writeOffset_ % capacity;
  for (unsigned i = 0; i < frames; ++i) {
    for (unsigned c = 0; c < info.channels; ++c) {
      pcm_[index] = planar[c * frames + i];
      if (++index == capacity)
        index = 0;
    }
  }
  command->type = Command::Type::Data;
  command->info = info;
  command->offset = writeOffset_;
  command->end = writeOffset_ += samples;
  commands_.publish();
  writtenFrames_.fetch_add(frames, std::memory_order_release);
  return true;
}

bool FileFifo::queueControl(Command::Type type, std::uint64_t generation, std::uint64_t track,
                            std::uint64_t totalFrames, float value) noexcept {
  auto *command = commands_.writable();
  if (!command)
    return false;
  command->type = type;
  command->info = {generation, track, 0, 0, 0, value};
  command->end = totalFrames;
  commands_.publish();
  return true;
}

bool FileFifo::end(std::uint64_t generation, std::uint64_t track,
                   std::uint64_t totalFrames) noexcept {
  return queueControl(Command::Type::End, generation, track, totalFrames);
}
bool FileFifo::gain(std::uint64_t generation, std::uint64_t track, float value) noexcept {
  return std::isfinite(value) && queueControl(Command::Type::Gain, generation, track, 0, value);
}
bool FileFifo::flush(std::uint64_t generation) noexcept {
  if (!queueControl(Command::Type::Flush, generation))
    return false;
  if (writeGeneration_ == generation)
    accepting_ = false;
  return true;
}
bool FileFifo::cancelNext(std::uint64_t generation, std::uint64_t track) noexcept {
  return queueControl(Command::Type::Cancel, generation, track);
}

void FileFifo::Track::clear() noexcept {
  info = {};
  readRange = writeRange = available = 0;
  expected = position = totalFrames = outputs = 0;
  ended = gap = finished = draining = false;
}

bool FileFifo::Track::append(std::uint64_t first, std::uint64_t end) noexcept {
  if (readRange < writeRange && ranges[(writeRange - 1) % slotCount].end == first) {
    ranges[(writeRange - 1) % slotCount].end = end;
  } else {
    if (writeRange - readRange == slotCount)
      return false;
    ranges[writeRange++ % slotCount] = {first, end};
  }
  available += (end - first) / info.channels;
  return true;
}

void FileFifo::emit(Event::Type type, std::uint64_t generation, std::uint64_t track,
                    std::uint64_t frame) noexcept {
  if (auto *event = events_.writable()) {
    *event = {type, generation, track, frame};
    events_.publish();
  }
}

bool FileFifo::popEvent(Event &event) noexcept {
  auto *next = events_.readable();
  if (!next)
    return false;
  event = *next;
  events_.pop();
  return true;
}

void FileFifo::clearTrack(Track &track) noexcept {
  if (track.converter) {
    // Only start/next commands can provide converters. Between producer
    // reclamations at most one command queue plus two tracks can retire one.
    auto *slot = retired_.writable();
    slot->swap(track.converter);
    retired_.publish();
  }
  track.clear();
}

void FileFifo::beginTrack(Track &track, Command &command) noexcept {
  clearTrack(track);
  track.info = command.info;
  track.expected = track.position = track.info.startFrame;
  track.converter.swap(command.converter);
}

void FileFifo::resetStream() noexcept {
  clearTrack(current_);
  clearTrack(next_);
  running_ = false;
  discard_ = fadeIn_ = flush_ = fadeTail_ = fadeTailLength_ = 0;
  groupSource_ = groupOutput_ = 0;
  last_ = tail_ = {};
}

void FileFifo::abandon() noexcept {
  const auto info = current_.info;
  const auto position = current_.position;
  const auto last = last_;
  const auto remainingFade = flush_;
  resetStream();
  current_.info = info;
  current_.position = position;
  current_.finished = true;
  if (remainingFade) {
    tail_ = last;
    fadeTail_ = fadeTailLength_ = remainingFade;
  }
}

void FileFifo::consumeCommands() noexcept {
  using Type = Command::Type;
  for (std::size_t i = 0; i < slotCount; ++i) {
    auto *command = commands_.readable();
    if (!command)
      break;
    const auto &info = command->info;
    if (command->type == Type::Data)
      parsedEnd_ = command->end;
    if (command->type == Type::Start) {
      const auto last = last_;
      const auto fade = flush_;
      resetStream();
      fadeTail_ = fadeTailLength_ = fade;
      tail_ = last;
      generation_ = info.generation;
      beginTrack(current_, *command);
      if (current_.converter)
        discard_ = static_cast<unsigned>(std::lround(current_.converter->delayInputFrames() /
                                                     current_.converter->inputPerOutput()));
      fadeIn_ = info.fadeIn ? std::max(1u, sampleRate_ / 50) : 0;
    } else if (command->type == Type::Next) {
      const bool accepted = info.generation == generation_ && !next_.info.track &&
                            current_.info.track && !current_.finished &&
                            info.track > current_.info.track;
      if (accepted)
        beginTrack(next_, *command);
      emit(accepted ? Event::Type::NextAccepted : Event::Type::NextRejected, info.generation,
           info.track);
    } else if (info.generation == generation_) {
      auto *track = info.track == current_.info.track ? &current_
                    : info.track == next_.info.track  ? &next_
                                                      : nullptr;
      switch (command->type) {
      case Type::Data: {
        if (!track || track->finished || track->gap)
          break;
        const auto frames = (command->end - command->offset) / info.channels;
        if (track->expected != info.startFrame || track->info.rate != info.rate ||
            track->info.channels != info.channels ||
            (track->ended && info.startFrame + frames > track->totalFrames)) {
          ++gaps_;
          track->gap = true;
        } else if (!track->append(command->offset, command->end)) {
          overflows_.fetch_add(1, std::memory_order_relaxed);
          track->gap = true;
        } else {
          track->expected += frames;
        }
        break;
      }
      case Type::End:
        if (track && command->end >= track->expected) {
          track->ended = true;
          track->totalFrames = command->end;
        }
        break;
      case Type::Gain:
        if (track)
          track->info.gain = info.gain;
        break;
      case Type::Flush:
        if (running_ && !flush_)
          flush_ = std::max(1u, sampleRate_ / 50);
        else if (!running_)
          abandon();
        break;
      case Type::Cancel: {
        const bool playing =
            track == &current_ || (track == &next_ && next_.position > next_.info.startFrame);
        if (!playing && track == &next_)
          clearTrack(next_);
        emit(playing ? Event::Type::AlreadyPlaying : Event::Type::Cancelled, generation_,
             info.track);
        break;
      }
      default:
        break;
      }
    } else if (command->type == Type::Cancel) {
      emit(Event::Type::Cancelled, info.generation, info.track);
    }
    commands_.pop();
  }
}

bool FileFifo::continuesWithNext() const noexcept {
  return !current_.draining && next_.info.track && next_.info.rate == current_.info.rate &&
         next_.info.channels == current_.info.channels;
}

bool FileFifo::raw(Track &track, Frame &sample) noexcept {
  if (!track.available)
    return false;
  auto &range = track.ranges[track.readRange % slotCount];
  auto index = range.first % capacity;
  for (unsigned c = 0; c < track.info.channels; ++c) {
    sample[c] = pcm_[index];
    if (++index == capacity)
      index = 0;
  }
  range.first += track.info.channels;
  if (range.first == range.end)
    ++track.readRange;
  --track.available;
  ++track.position;
  return true;
}

bool FileFifo::sample(Frame &value) noexcept {
  auto *converter = current_.converter.get();
  bool produced = !converter && raw(current_, value);
  while (converter && !produced) {
    Frame input{};
    if (converter->inputNeeded(1) && !raw(current_, input)) {
      if (!current_.ended || current_.position != current_.totalFrames)
        return false;
      if (continuesWithNext()) {
        if (!raw(next_, input)) {
          if (!next_.ended || next_.position != next_.totalFrames)
            return false;
          next_.draining = true;
        }
      } else {
        current_.draining = true;
      }
    }
    const auto result =
        converter->process(input.data(), 1, converter->inputNeeded(1) ? 1 : 0, value.data(), 1, 1);
    if (result.produced && discard_)
      --discard_;
    else
      produced = result.produced;
  }
  // Mono feeds both front channels, as the stereo bus did before.
  if (produced && current_.info.channels == 1)
    value[1] = value[0];
  return produced;
}

std::uint64_t FileFifo::outputLength() const noexcept {
  const auto source = groupSource_ + current_.totalFrames - current_.info.startFrame;
  const auto output = static_cast<std::uint64_t>(
      std::llround(static_cast<double>(source) * sampleRate_ / current_.info.rate));
  return output - groupOutput_;
}

bool FileFifo::atEnd() const noexcept {
  return current_.ended && current_.position == current_.totalFrames &&
         current_.outputs >= outputLength();
}

void FileFifo::advanceTrack(std::uint64_t frame, void *context, Boundary boundary) noexcept {
  if (!flush_) {
    if (boundary)
      boundary(context, frame);
    emit(Event::Type::Ended, generation_, current_.info.track, frame);
  }
  if (!next_.info.track || flush_) {
    abandon();
    return;
  }
  if (continuesWithNext()) {
    groupSource_ += current_.totalFrames - current_.info.startFrame;
    groupOutput_ += current_.outputs;
    current_.converter.swap(next_.converter);
  } else {
    groupSource_ = groupOutput_ = 0;
    discard_ = next_.converter
                   ? static_cast<unsigned>(std::lround(next_.converter->delayInputFrames() /
                                                       next_.converter->inputPerOutput()))
                   : 0;
  }
  clearTrack(current_);
  std::swap(current_, next_);
}

void FileFifo::mix(float *planar, unsigned channels, unsigned frames, std::uint64_t position,
                   void *context, Boundary boundary) noexcept {
  const auto format = formatRevision_.load(std::memory_order_acquire);
  if (format != format_) {
    resetStream();
    format_ = format;
    sampleRate_ = rate_.load(std::memory_order_relaxed);
    periodFrames_ = period_.load(std::memory_order_relaxed);
  }
  consumeCommands();
  activeThisBlock_ = false;
  if (!generation_)
    return;
  const auto fadeFrames = std::max(1u, sampleRate_ / 50);
  const auto recoveryFrames = std::max(1u, sampleRate_ / 200);
  if (!running_ && current_.info.track && !current_.finished && !current_.gap) {
    const auto target =
        (std::uint64_t(std::max(sampleRate_ / 20, 2 * periodFrames_)) * current_.info.rate +
         sampleRate_ - 1) /
        sampleRate_;
    running_ = current_.available >= target ||
               (current_.ended && current_.expected == current_.totalFrames);
  }
  activeThisBlock_ = running_;
  if (!running_ && !fadeTail_) {
    publish(position + frames);
    return;
  }
  const auto outputs = std::min(channels, maxChannels);
  for (unsigned i = 0; i < frames; ++i) {
    Frame value{};
    while (running_ && atEnd())
      advanceTrack(position + i, context, boundary);
    if (running_ && sample(value)) {
      ++current_.outputs;
      float gain = current_.info.gain;
      if (fadeIn_)
        gain *= static_cast<float>(fadeFrames - fadeIn_--) / static_cast<float>(fadeFrames);
      if (flush_)
        gain *= static_cast<float>(flush_) / static_cast<float>(fadeFrames);
      for (auto &channel : value)
        channel *= gain;
      last_ = value;
      if (flush_ && !--flush_)
        abandon();
    } else if (running_) {
      if (flush_) {
        abandon();
      } else {
        running_ = false;
        ++underruns_;
        tail_ = last_;
        fadeTail_ = fadeTailLength_ = recoveryFrames;
      }
    }
    if (fadeTail_) {
      const float level = static_cast<float>(fadeTail_ - 1) / static_cast<float>(fadeTailLength_);
      for (unsigned c = 0; c < maxChannels; ++c)
        value[c] += tail_[c] * level;
      --fadeTail_;
    }
    for (unsigned c = 0; c < outputs; ++c)
      planar[c * frames + i] += value[c];
  }
  while (running_ && atEnd())
    advanceTrack(position + frames, context, boundary);
  publish(position + frames);
}

void FileFifo::publish(std::uint64_t pipelineFrame) noexcept {
  auto release = parsedEnd_;
  if (current_.available)
    release = std::min(release, current_.ranges[current_.readRange % slotCount].first);
  if (next_.available)
    release = std::min(release, next_.ranges[next_.readRange % slotCount].first);
  released_.store(release, std::memory_order_release);
  published_.sequence.fetch_add(1);
  published_.generation.store(generation_);
  published_.track.store(current_.info.track);
  const bool sharedConverter = current_.converter && continuesWithNext();
  published_.readFrame.store(current_.position +
                             (sharedConverter ? next_.position - next_.info.startFrame : 0));
  published_.queued.store(current_.available + next_.available);
  published_.underruns.store(underruns_);
  published_.gaps.store(gaps_);
  published_.pipelineFrame.store(pipelineFrame);
  published_.delay.store(current_.converter ? current_.converter->delayInputFrames() /
                                                  current_.converter->inputPerOutput()
                                            : 0);
  published_.running.store(running_);
  published_.sequence.fetch_add(1);
}

FileFifo::Snapshot FileFifo::snapshot() const noexcept {
  Snapshot result;
  std::uint64_t sequence;
  do {
    sequence = published_.sequence.load();
    if (sequence & 1)
      continue;
    result = {published_.generation.load(),    published_.track.load(),
              published_.readFrame.load(),     0,
              published_.queued.load(),        published_.underruns.load(),
              published_.gaps.load(),          overflows_.load(),
              published_.pipelineFrame.load(), published_.delay.load(),
              published_.running.load()};
  } while ((sequence & 1) || sequence != published_.sequence.load());
  if (result.generation == writtenGeneration_.load(std::memory_order_acquire))
    result.writtenFrames = writtenFrames_.load(std::memory_order_acquire);
  return result;
}

} // namespace effetune::audio
