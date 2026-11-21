#include "sampler_control.h"
#include "host/pipeline.h"
#include <array>
#include <cmath>
#include <cstring>
#include <iostream>

namespace effetune::audio {
namespace {
using Object = JsonValue::Object;
std::array<std::map<unsigned, std::uint64_t>, 2> announced;
void reply(Object message) { writeFrame(std::cout, {FrameKind::Control, std::move(message), {}}); }
std::optional<std::uint64_t> integer(const JsonValue &value, const char *key) {
  const auto n = value.GetNumber(key);
  if (!n || *n < 0 || *n > 9007199254740991.0 || std::floor(*n) != *n)
    return {};
  return static_cast<std::uint64_t>(*n);
}
std::uint64_t nowNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
Object metadata(const Pipeline::SampleStream &stream, unsigned id, unsigned branch) {
  Object message{{"generation", double(stream.generation)},
                 {"pluginId", double(id)},
                 {"branch", double(branch)}};
  if (stream.operationRevision)
    message.emplace("operationRevision", double(*stream.operationRevision));
  if (stream.replayEpoch)
    message.emplace("replayEpoch", double(*stream.replayEpoch));
  return message;
}
} // namespace
void publishPreparedBank(DeviceHost &host, std::shared_ptr<Pipeline::AssetChange> change,
                         std::function<void(bool)> done) {
  auto ok = std::make_shared<bool>(false);
  host.beginAsset();
  if (!host.submit([change, ok](Session &) { *ok = change->captureRoute(); },
                   [&host, change, ok, done = std::move(done)]() mutable {
                     if (!*ok || !change->prepareRoute()) {
                       host.endAsset();
                       done(false);
                       return;
                     }
                     host.beginAsset();
                     if (!host.submit([change, ok](Session &) { *ok = change->apply(); },
                                      [&host, change, ok, done = std::move(done)]() mutable {
                                        host.endAsset();
                                        if (*ok)
                                          change->finish();
                                        done(*ok);
                                      }))
                       throw std::runtime_error("audio command queue full");
                   }))
    throw std::runtime_error("audio command queue full");
}

void clearSampleStreams(unsigned branch) {
  for (auto [id, generation] : announced.at(branch))
    reply({{"type", "sfzStreamStop"},
           {"pluginId", double(id)},
           {"generation", double(generation)},
           {"branch", double(branch)}});
  announced[branch].clear();
}
void notifySampleStreams(Session &session, unsigned branch) {
  if (!session.pipeline())
    return;
  auto &active = announced.at(branch);
  std::erase_if(active, [&](const auto &entry) {
    auto *stream = session.pipeline()->sampleStream(entry.first);
    if (stream && stream->generation == entry.second)
      return false;
    reply({{"type", "sfzStreamStop"},
           {"pluginId", double(entry.first)},
           {"generation", double(entry.second)},
           {"branch", double(branch)}});
    return true;
  });
  for (const auto &[id, state] : session.pipeline()->streams()) {
    auto &stream = *session.pipeline()->sampleStream(id);
    if (!state.announced) {
      auto message = metadata(state, id, branch);
      message.emplace("type", "sfzStreamReady");
      reply(std::move(message));
      stream.announced = true;
      active[id] = state.generation;
    }
    if (!state.pollPending && nowNs() >= state.nextPollNs) {
      auto message = metadata(state, id, branch);
      message.emplace("type", "sfzStreamPollNeeded");
      reply(std::move(message));
      stream.pollPending = true;
    }
  }
}

bool handleSampleStream(DeviceHost &host, Session &session, const Frame &frame) {
  const auto &m = frame.message;
  const auto type = m.GetString("type");
  const bool publish = type == "sfzPublishPage";
  if (!publish && type != "sfzPollPages" && type != "sfzStreamFailed")
    return false;
  const auto id = m.GetUInt32("pluginId").value_or(0), branch = m.GetUInt32("branch").value_or(0);
  auto *pipeline = session.pipeline();
  auto *stream = pipeline ? pipeline->sampleStream(id) : nullptr;
  const bool current = stream && integer(m, "generation") == stream->generation;
  if (type == "sfzStreamFailed") {
    if (current && pipeline->pendingStream(id))
      pipeline->cancelStream(id);
    else if (current)
      pipeline->clearAsset(id, 0);
    return true;
  }
  Object result{{"type", publish ? "sfzStreamPagesPublished" : "sfzStreamRequests"},
                {"branch", double(branch)}};
  if (const auto *request = m.Find("requestId"))
    result.emplace("requestId", *request);
  if (!current) {
    result.emplace("ok", false);
    if (!publish)
      result.emplace("requests", JsonValue::Array{});
    reply(std::move(result));
    return true;
  }
  const auto generation = stream->generation;
  auto preparing = pipeline->pendingStream(id);
  if (publish) {
    const auto *page = m.Find("page");
    const auto index = page ? integer(*page, "pageIndex") : std::nullopt;
    const auto sample = page ? page->GetUInt32("sample") : std::nullopt;
    const auto frames = page ? page->GetUInt32("frames").value_or(0) : 0;
    const auto channels = page ? page->GetUInt32("channels").value_or(0) : 0;
    const bool valid = page && index && sample && frames && frames <= 4096 &&
                       (channels == 1 || channels == 2) &&
                       frame.attachment.size() == std::size_t(frames) * channels * 4 &&
                       integer(*page, "generation") == generation &&
                       m.GetUInt32("operationRevision") == stream->operationRevision &&
                       m.GetUInt32("replayEpoch") == stream->replayEpoch;
    if (!valid) {
      result.emplace("ok", false);
      reply(std::move(result));
      return true;
    }
    std::vector<float> pcm(std::size_t(frames) * channels);
    std::memcpy(pcm.data(), frame.attachment.data(), frame.attachment.size());
    if (preparing) {
      const bool written = preparing->publish(generation, *sample, *index, pcm, frames, channels,
                                              page->GetBool("resident").value_or(false));
      result.emplace("ok", written);
      reply(std::move(result));
      if (!written || preparing->awaitsPages())
        return true;
      auto status = metadata(*stream, id, branch);
      publishPreparedBank(host, preparing, [=](bool active) mutable {
        if (active) {
          status.emplace("type", "assetState");
          status.emplace("slot", 0.);
          status.emplace("state", double(preparing->state()));
          reply(std::move(status));
        } else {
          pipeline->cancelStream(id);
          status.emplace("type", "assetLoadRejected");
          status.emplace("slot", 0.);
          status.emplace("reason", "sample-read");
          reply(std::move(status));
        }
      });
      return true;
    }
    const auto ok = std::make_shared<bool>(false);
    return host.submit(
        [=, samples = std::move(pcm),
         resident = page->GetBool("resident").value_or(false)](Session &) {
          *ok = pipeline->publishPage(id, generation, *sample, *index, samples, frames, channels,
                                      resident);
        },
        [ok, result = std::move(result)]() mutable {
          result.emplace("ok", *ok);
          reply(std::move(result));
        });
  }
  struct Poll {
    std::array<et_sfz_sample_request, 1024> requests;
    std::uint32_t count = 0;
    et_stream_readiness readiness{};
    bool ok = false, limited = false;
  };
  auto poll = std::make_shared<Poll>();
  auto status = metadata(*stream, id, branch);
  stream->pollPending = false;
  stream->nextPollNs = nowNs() + 10000000;
  if (preparing) {
    result.emplace("ok", true);
    result.emplace("requests", JsonValue::Array{});
    reply(std::move(result));
    return true;
  }
  return host.submit(
      [poll, pipeline, id, &session](Session &) {
        poll->ok = pipeline->takeRequests(id, poll->requests, poll->count, poll->readiness,
                                          session.position(), poll->limited);
      },
      [poll, status = std::move(status), result = std::move(result)]() mutable {
        JsonValue::Array requests;
        if (poll->ok) {
          for (unsigned i = 0; i < poll->count; ++i) {
            const auto &q = poll->requests[i];
            requests.emplace_back(
                Object{{"generation", q.generation_low + q.generation_high * 4294967296.0},
                       {"pageIndex", q.page_low + q.page_high * 4294967296.0},
                       {"sample", double(q.sample)}});
          }
          const auto &r = poll->readiness;
          status.emplace("type", "sfzStreamReadiness");
          status.emplace("limited", poll->limited);
          status.emplace("readiness", Object{{"generation", double(r.generation)},
                                             {"scope", double(r.scope)},
                                             {"admittedFrames", double(r.admitted_frames)},
                                             {"readyAheadFrames", double(r.ready_ahead_frames)},
                                             {"plannedPages", double(r.planned_pages)},
                                             {"pendingPages", double(r.pending_pages)}});
          reply(std::move(status));
        }
        result.emplace("ok", poll->ok);
        result.emplace("requests", std::move(requests));
        reply(std::move(result));
      });
}
} // namespace effetune::audio
