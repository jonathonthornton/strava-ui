from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import urllib.request
from urllib.parse import urlparse

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(__file__), **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/proxy/'):
            target = parsed.path[len('/proxy/'):]
            if target.startswith('/'):
                target = target[1:]
            if parsed.query:
                target = f'{target}?{parsed.query}'
            target_url = target if target.startswith('http') else f'https://{target}'
            req = urllib.request.Request(target_url, headers={'Accept': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    payload = response.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(payload)
            except Exception as exc:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(exc).encode())
            return
        super().do_GET()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Serving on http://127.0.0.1:{port}')
    server.serve_forever()
