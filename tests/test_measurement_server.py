import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('measurement_server', ROOT / 'features/measurement/server.py')
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class MeasurementServerTests(unittest.TestCase):
    def test_public_assets_and_legacy_measurement_urls(self):
        handler = SERVER.NoCacheHTTPRequestHandler.__new__(SERVER.NoCacheHTTPRequestHandler)
        for url in ('/', '/measurement.html', '/features/measurement/measurement.html',
                    '/js/theme-boot.js', '/styles.css', '/plugins/theme-palette.js'):
            self.assertTrue(Path(handler.translate_path(url)).is_file(), url)

    def test_private_files_and_directories_are_not_served(self):
        handler = SERVER.NoCacheHTTPRequestHandler.__new__(SERVER.NoCacheHTTPRequestHandler)
        for url in ('/.git/config', '/package.json', '/server.py', '/features/measurement/server.py',
                    '/js/', '/%2e%2e/package.json', '/js/%5c..%5cpackage.json', '/tmp/dev/secret.txt'):
            self.assertFalse(Path(handler.translate_path(url)).exists(), url)


if __name__ == '__main__':
    unittest.main()
