"""Render an HTML animation (with window.seek(t)) frame by frame in headless Chrome and pipe it into FFmpeg.

  python3 render.py http://localhost:8000/template.html out.mp4 [--fps 30] [--frames 0,15,30  (PNG stills only)]
No extra packages: a tiny built-in websocket client talks to Chrome DevTools.
"""
import argparse, base64, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request


def find_chrome():
    """Chrome/Chromium on macOS, Windows or Linux. Override with the CHROME_PATH env var."""
    if os.environ.get("CHROME_PATH"):
        return os.environ["CHROME_PATH"]
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        "/opt/pw-browsers/chromium",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"):
        p = shutil.which(name)
        if p:
            return p
    sys.exit("Chrome not found. Install Google Chrome or set CHROME_PATH to its executable.")


CHROME = find_chrome()


class WS:
    def __init__(self, url):
        host_port, path = url[5:].split("/", 1)
        host, port = host_port.split(":")
        self.s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\n"
                        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b"\r\n\r\n", 1)[1]
        self.id = 0

    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(1 << 20)
            if not chunk:
                raise ConnectionError("closed")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def send(self, text):
        data = text.encode()
        hdr = bytearray([0x81])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += n.to_bytes(2, "big")
        else:
            hdr.append(0x80 | 127); hdr += n.to_bytes(8, "big")
        mask = os.urandom(4)
        hdr += mask
        self.s.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7F
            if n == 126:
                n = int.from_bytes(self._read(2), "big")
            elif n == 127:
                n = int.from_bytes(self._read(8), "big")
            payload = self._read(n)
            msg += payload
            if b1 & 0x80:
                return msg.decode()

    def call(self, method, **params):
        self.id += 1
        my = self.id
        self.send(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            m = json.loads(self.recv())
            if m.get("id") == my:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url"); ap.add_argument("out")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--w", type=int, default=1920); ap.add_argument("--h", type=int, default=1080)
    ap.add_argument("--frames", default="")
    ap.add_argument("--port", type=int, default=9333)
    a = ap.parse_args()

    port = a.port
    prof = tempfile.mkdtemp()
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                               "--hide-scrollbars", "--disable-gpu", f"--window-size={a.w},{a.h}"]
                              + (["--no-sandbox"] if hasattr(os, "geteuid") and os.geteuid() == 0 else [])
                              + ["about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                page = [t for t in tabs if t["type"] == "page"][0]
                break
            except Exception:
                time.sleep(0.2)
        ws = WS(page["webSocketDebuggerUrl"].replace("localhost", "127.0.0.1"))
        ws.call("Emulation.setDeviceMetricsOverride", width=a.w, height=a.h, deviceScaleFactor=1, mobile=False)
        ws.call("Page.enable")
        ws.call("Page.navigate", url=a.url)
        ws.call("Runtime.evaluate", expression="new Promise(r=>{const f=()=>window.ready?window.ready.then(r):setTimeout(f,100);f();})",
                awaitPromise=True)
        time.sleep(0.5)
        dur = ws.call("Runtime.evaluate", expression="window.DURATION", returnByValue=True)["result"]["value"]

        def shot(t):
            ws.call("Runtime.evaluate", awaitPromise=True,
                    expression=f"Promise.resolve(seek({t})).then(()=>new Promise(r=>requestAnimationFrame(()=>r())))")
            r = ws.call("Page.captureScreenshot", format="png", fromSurface=True)
            return base64.b64decode(r["data"])

        if a.frames:
            base = os.path.splitext(a.out)[0]
            for t in a.frames.split(","):
                open(f"{base}_{t}s.png", "wb").write(shot(float(t)))
            print("stills saved"); return

        n = int(dur * a.fps)
        ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(a.fps),
                               "-c:v", "png", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
                               "-preset", "medium", a.out], stdin=subprocess.PIPE)
        for i in range(n):
            ff.stdin.write(shot(i / a.fps))
            if i % 150 == 0:
                print(f"frame {i}/{n}", flush=True)
        ff.stdin.close(); ff.wait()
        print("saved:", a.out, f"{dur:.1f} s")
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
