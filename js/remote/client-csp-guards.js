// A few plugins build a JavaScript function on the UI thread, outside the
// processor registration the WASM-only flag already covers. Under this page's CSP
// that throws (a timer callback, so it surfaces as an uncaught error). Cassette
// Artifacts measures its Dolby noise-reduction quieting that way for the status
// line only; here the measurement is simply never scheduled. The plugin file and
// the desktop behaviour are untouched.
export function guardPluginsForClientCsp(pluginManager) {
    const cassette = pluginManager.pluginClasses?.['Cassette Artifacts'];
    if (cassette?.prototype && typeof cassette.prototype._scheduleNrQuietingUpdate === 'function') {
        cassette.prototype._scheduleNrQuietingUpdate = function () {};
    }
}
