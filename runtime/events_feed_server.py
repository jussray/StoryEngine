"""Minimal HTTP service that connects `dashboards/l99_events_dashboard.html`
to the shared `samples/events.ndjson` live feed.

Zero third-party dependencies: `http.server` only.

Usage:
    python -m runtime.events_feed_server --feed samples/events.ndjson --port 8099
    python runtime/events_feed_server.py --feed samples/events.ndjson --port 8099
"""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FEED_PATH = ROOT / "samples" / "events.ndjson"
DEFAULT_DASHBOARD_PATH = ROOT / "dashboards" / "l99_events_dashboard.html"


def make_handler(feed_path: Path, dashboard_path: Path) -> type[BaseHTTPRequestHandler]:
    class EventsFeedHandler(BaseHTTPRequestHandler):
        server_version = "L99EventsFeed/1.0"

        def _send_bytes(self, status: int, content_type: str, body: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - required BaseHTTPRequestHandler name
            path = self.path.split("?", 1)[0]
            if path == "/events.ndjson":
                if feed_path.exists():
                    body = feed_path.read_bytes()
                else:
                    body = b""
                self._send_bytes(200, "application/x-ndjson", body)
            elif path in ("/", "/index.html"):
                body = dashboard_path.read_bytes()
                self._send_bytes(200, "text/html; charset=utf-8", body)
            else:
                self._send_bytes(404, "text/plain; charset=utf-8", b"not found")

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
            pass

    return EventsFeedHandler


def serve(feed_path: str | Path = DEFAULT_FEED_PATH, dashboard_path: str | Path = DEFAULT_DASHBOARD_PATH, host: str = "127.0.0.1", port: int = 8099) -> ThreadingHTTPServer:
    handler = make_handler(Path(feed_path), Path(dashboard_path))
    httpd = ThreadingHTTPServer((host, port), handler)
    return httpd


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed", default=str(DEFAULT_FEED_PATH), help="Path to the NDJSON event feed to serve.")
    parser.add_argument("--dashboard", default=str(DEFAULT_DASHBOARD_PATH), help="Path to the dashboard HTML file to serve.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8099)
    args = parser.parse_args()

    httpd = serve(args.feed, args.dashboard, args.host, args.port)
    print(f"L99 events dashboard: http://{args.host}:{args.port}/")
    print(f"Live feed:            http://{args.host}:{args.port}/events.ndjson  (serving {args.feed})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
