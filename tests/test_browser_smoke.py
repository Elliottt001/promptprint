import shutil
import subprocess
import threading
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *args):
        pass


@unittest.skipUnless(CHROME.exists(), "Google Chrome is required for the visual smoke test")
class BrowserSmokeTests(unittest.TestCase):
    def test_default_empty_snapshot_renders_without_words(self):
        handler = partial(QuietHandler, directory=str(ROOT / "web"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = subprocess.run(
                [
                    str(CHROME),
                    "--headless=new",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--virtual-time-budget=3000",
                    "--window-size=1440,1200",
                    "--dump-dom",
                    f"http://127.0.0.1:{server.server_port}/",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )
        finally:
            server.shutdown()
            server.server_close()

        rendered_words = result.stdout.count('class="word word-')
        self.assertEqual(rendered_words, 0)
        self.assertIn('id="source-cloud"', result.stdout)


if __name__ == "__main__":
    unittest.main()
