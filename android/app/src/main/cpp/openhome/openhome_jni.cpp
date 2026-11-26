#include "protocol.h"
#include "runtime.h"

#include <jni.h>
#include <poll.h>
#include <sys/eventfd.h>
#include <unistd.h>

#include <cerrno>
#include <cstdint>
#include <istream>
#include <memory>
#include <mutex>
#include <ostream>
#include <streambuf>
#include <thread>

namespace {

// Unbuffered-output, buffered-input stream over a pipe pair. Blocking reads and
// writes give up once stopFd becomes readable, so Stop() never waits on Java.
class PipeBuffer final : public std::streambuf {
public:
  PipeBuffer(int readFd, int writeFd, int stopFd)
      : readFd_(readFd), writeFd_(writeFd), stopFd_(stopFd) {}

protected:
  int_type underflow() override {
    if (!WaitReady(readFd_, POLLIN))
      return traits_type::eof();
    ssize_t count;
    do {
      count = read(readFd_, input_, sizeof(input_));
    } while (count < 0 && errno == EINTR);
    if (count <= 0)
      return traits_type::eof();
    setg(input_, input_, input_ + count);
    return traits_type::to_int_type(*gptr());
  }

  std::streamsize xsputn(const char *data, std::streamsize size) override {
    std::streamsize written = 0;
    while (written < size && WaitReady(writeFd_, POLLOUT)) {
      const ssize_t count = write(writeFd_, data + written,
                                  static_cast<size_t>(size - written));
      if (count < 0 && errno != EINTR && errno != EAGAIN)
        break;
      if (count > 0)
        written += count;
    }
    return written;
  }

  int_type overflow(int_type value) override {
    if (traits_type::eq_int_type(value, traits_type::eof()))
      return traits_type::not_eof(value);
    const char character = traits_type::to_char_type(value);
    return xsputn(&character, 1) == 1 ? value : traits_type::eof();
  }

private:
  bool WaitReady(int fd, short events) const {
    pollfd fds[2] = {{fd, events, 0}, {stopFd_, POLLIN, 0}};
    while (poll(fds, 2, -1) < 0) {
      if (errno != EINTR)
        return false;
    }
    return fds[1].revents == 0;
  }

  const int readFd_;
  const int writeFd_;
  const int stopFd_;
  char input_[4096];
};

struct Session {
  int stopFd = -1;
  std::thread thread;
};

std::mutex sessionMutex;
std::unique_ptr<Session> session;

void Serve(int readFd, int writeFd, int stopFd) {
  // An escaping exception would terminate the whole app process.
  try {
    PipeBuffer buffer(readFd, writeFd, stopFd);
    std::istream input(&buffer);
    std::ostream output(&buffer);
    effetune::openhome::ProtocolBridge bridge(output);
    effetune::openhome::RunSidecar(bridge, input, false);
  } catch (...) {
  }
  // Closing the output tells the Java reader that the renderer has finished.
  close(readFd);
  close(writeFd);
}

} // namespace

// Takes ownership of both descriptors, also when it fails.
extern "C" JNIEXPORT jboolean JNICALL
Java_com_frieve_effetune_OpenHomeNative_nativeStart(JNIEnv *, jclass,
                                                    jint readFd, jint writeFd) {
  std::lock_guard<std::mutex> lock(sessionMutex);
  const int stopFd = session ? -1 : eventfd(0, EFD_CLOEXEC);
  if (stopFd < 0) {
    close(readFd);
    close(writeFd);
    return JNI_FALSE;
  }
  try {
    auto started = std::make_unique<Session>();
    started->stopFd = stopFd;
    started->thread = std::thread(Serve, readFd, writeFd, stopFd);
    session = std::move(started);
    return JNI_TRUE;
  } catch (...) {
    close(stopFd);
    close(readFd);
    close(writeFd);
    return JNI_FALSE;
  }
}

// Stops the renderer if running and waits until ohNet has closed.
extern "C" JNIEXPORT void JNICALL
Java_com_frieve_effetune_OpenHomeNative_nativeStop(JNIEnv *, jclass) {
  std::lock_guard<std::mutex> lock(sessionMutex);
  if (!session)
    return;
  const std::uint64_t signal = 1;
  (void)write(session->stopFd, &signal, sizeof(signal));
  session->thread.join();
  close(session->stopFd);
  session.reset();
}
