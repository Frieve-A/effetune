#pragma once

#include "protocol.h"

#include <iosfwd>

namespace effetune::openhome {

// Serves the renderer protocol read from input until end of input or shutdown,
// then closes the UPnP library. ohNet is process-global, so only one call may
// run at a time in a process.
RunResult RunSidecar(ProtocolBridge &bridge, std::istream &input,
                     bool useLoopback);

} // namespace effetune::openhome
