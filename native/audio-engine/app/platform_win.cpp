#include <cstdio>
#include <fcntl.h>
#include <io.h>

bool initializeAudioEnginePlatform() {
  return _setmode(_fileno(stdin), _O_BINARY) != -1 && _setmode(_fileno(stdout), _O_BINARY) != -1;
}
