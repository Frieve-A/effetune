#include <csignal>

bool initializeAudioEnginePlatform() { return std::signal(SIGPIPE, SIG_IGN) != SIG_ERR; }
