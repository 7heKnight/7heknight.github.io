import atexit
import signal
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from os import getcwd
from os.path import isfile

# https://gist.github.com/mdonkers/63e115cc0c79b4f6b8b3a6b797e485c7
# CURL Request: curl -H "Content-Type: application/x-www-form-urlencoded" -X POST http://192.168.204.1:80/ -d "<Post_Data>"

LOG_FILENAME = 'log.txt'

if not isfile(LOG_FILENAME):
    file = open(LOG_FILENAME, 'wb')
else:
    file = open(LOG_FILENAME, 'ab')


def _cleanup():
    """Flush and close the log file on exit."""
    if file and not file.closed:
        file.flush()
        file.close()


atexit.register(_cleanup)


class LoggingHTTPRequestHandler(BaseHTTPRequestHandler):
    def _set_response(self, code=200, content_type='text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.end_headers()

    def do_GET(self):
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"\n[+] [{timestamp}] GET Request: {str(self.path)}\n")
        file.write(f"[{timestamp}] [GET] Path: {self.path}\n".encode())
        file.flush()
        self._set_response()
        self.wfile.write("GET request for {}".format(self.path).encode('utf-8'))

    def do_POST(self):
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        content_length_hdr = self.headers.get('Content-Length')
        if content_length_hdr is None:
            self._set_response(400)
            self.wfile.write(b"Missing Content-Length header")
            return
        try:
            content_length = int(content_length_hdr)
        except ValueError:
            self._set_response(400)
            self.wfile.write(b"Invalid Content-Length header")
            return
        post_data = self.rfile.read(content_length)
        file.write(f"[{timestamp}] [POST] Path: {self.path}, Data: ".encode() + post_data + b'\n')
        file.flush()
        try:
            decoded = post_data.decode('utf-8')
        except UnicodeDecodeError:
            decoded = repr(post_data)
        print(f"\n[+] [{timestamp}] POST Request: {str(self.path)}\n{decoded}\n")
        self._set_response()
        self.wfile.write(f"POST request for {self.path}".encode('utf-8'))


def run(server_class=HTTPServer, handler_class=LoggingHTTPRequestHandler, port=444):
    print(f'[+] Server running on port: {port}')
    print(f'[+] Log file: {getcwd()}/{LOG_FILENAME}')
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()
    print(f'[+] Output file: {getcwd()}/{LOG_FILENAME}')
    print('[-] Stopping HTTP Server...\n')


if __name__ == '__main__':
    from sys import argv

    if len(argv) == 2:
        try:
            port = int(argv[1])
        except ValueError:
            print(f"[-] Invalid port: {argv[1]} (must be a number)")
            sys.exit(1)
        if not (1 <= port <= 65535):
            print(f"[-] Port out of range: {port} (must be 1-65535)")
            sys.exit(1)
        run(port=port)
    else:
        run()
