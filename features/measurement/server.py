from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlsplit

APP_ROOT = Path(__file__).resolve().parents[2]
MEASUREMENT_ROOT = APP_ROOT / 'features' / 'measurement'
PUBLIC_ROOTS = ('features/measurement', 'js', 'plugins', 'images', 'css')
PUBLIC_EXTENSIONS = {'.html', '.js', '.mjs', '.css', '.json', '.json5',
                     '.wasm', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.txt'}

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parts = unquote(urlsplit(path).path).lstrip('/').split('/')
        if any(part.startswith('.') or '\\' in part or '\x00' in part for part in parts):
            return str(APP_ROOT / '__unavailable__')
        relative = '/'.join(parts) or 'measurement.html'
        # Keep the original measurement-relative URLs as well as app-root URLs.
        candidates = (MEASUREMENT_ROOT / relative, APP_ROOT / relative)
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved.suffix.lower() not in PUBLIC_EXTENSIONS:
                continue
            if any(resolved.is_relative_to(APP_ROOT / root) for root in PUBLIC_ROOTS):
                if resolved.is_file():
                    return str(resolved)
        return str(APP_ROOT / '__unavailable__')

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    server_address = ('127.0.0.1', 8000)
    httpd = ThreadingHTTPServer(server_address, NoCacheHTTPRequestHandler)
    print('Open http://127.0.0.1:8000/features/measurement/measurement.html (Press CTRL+C to quit)')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('Server stopped.')
