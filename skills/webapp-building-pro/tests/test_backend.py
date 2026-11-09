"""Exercise backend patching with stub npm and a loopback-only fake Portal."""
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest

SKILL = Path(__file__).resolve().parents[1]
BACKEND = SKILL / "modules/backend-building/scripts/init.sh"


@unittest.skipUnless(shutil.which("node") and shutil.which("bash"), "requires Node.js and Bash")
class Backend(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="webapp-backend-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / "project's space"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        npm = self.bin / "npm"
        npm.write_text("#!/bin/sh\nexit 0\n")
        npm.chmod(0o755)
        self.env = dict(os.environ, PROJECT_PATH=str(self.project),
                        WEBAPP_BUILDING_PRO_CONFIG=str(self.root / "config.json"),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        self.env.pop("WEBAPP_BUILDING_PRO_TEMPLATE_DIRS", None)
        init = subprocess.run(["python3", str(SKILL / "scripts/webapp.py"), "init", "Test",
                               "--output", str(self.project), "--no-install"],
                              env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(init.returncode, 0, init.stderr)

    def graft(self, *args, ok=True):
        result = subprocess.run(["bash", str(BACKEND), '中文 "App" & title', *args],
                                env=self.env, capture_output=True, text=True, timeout=30)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def test_local_db_preserves_env_and_frontend_and_is_incremental(self):
        (self.project / ".env").write_text("USER_CONFIG=keep\n")
        before = (self.project / "src/App.tsx").read_bytes()
        self.graft("--local", "--features", "db")
        self.assertEqual((self.project / ".env").read_text(), "USER_CONFIG=keep\n")
        self.assertEqual((self.project / "src/App.tsx").read_bytes(), before)
        self.assertTrue((self.project / "api/boot.ts").exists())
        self.assertTrue((self.project / "db/schema.ts").exists())
        self.assertIn(".env", (self.project / ".gitignore").read_text())
        manifest = json.loads((self.project / ".backend-features.json").read_text())
        self.assertEqual(manifest["features"], ["db"])
        before = (self.project / "api/router.ts").read_bytes()
        self.graft("--local", "--features", "db")
        self.assertEqual((self.project / "api/router.ts").read_bytes(), before)
        self.assertFalse((self.project / ".git").exists())

    def test_invalid_shape_and_local_auth_fail_before_mutation(self):
        self.graft("--local", "--features", "auth", ok=False)
        self.assertFalse((self.project / "api").exists())
        (self.project / "vite.config.ts").unlink()
        self.graft("--local", "--features", "db", ok=False)
        self.assertFalse((self.project / "api").exists())

    def test_portal_auth_json_and_env_merge(self):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(inner):
                payload = json.loads(inner.rfile.read(int(inner.headers["Content-Length"])))
                requests.append(payload)
                inner.send_response(200)
                inner.send_header("Content-Type", "application/json")
                inner.end_headers()
                inner.wfile.write(json.dumps({"app_id": "mock-app", "app_secret": "mock-only",
                    "credentials": {"DATABASE_URL": "mysql://mock.invalid/test",
                                    "KIMI_AUTH_URL": "https://mock.invalid/auth",
                                    "KIMI_OPEN_URL": "https://mock.invalid/open"}}).encode())
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            self.env["PORTAL_URL"] = f"http://127.0.0.1:{server.server_port}/api/v1/apps"
            (self.project / ".env").write_text("USER_CONFIG=keep\n")
            self.graft("--features", "auth")
            self.assertEqual(requests[0]["name"], '中文 "App" & title')
            self.assertEqual(set(requests[0]["features"]), {"db", "auth"})
            env = (self.project / ".env").read_text()
            self.assertIn("USER_CONFIG=keep", env)
            self.assertIn("APP_ID=mock-app", env)
            self.assertTrue((self.project / "api/kimi/auth.ts").exists())
            self.assertTrue((self.project / "src/pages/Login.tsx").exists())
            self.assertEqual((self.project / ".env").stat().st_mode & 0o777, 0o600)
        finally:
            server.shutdown()
            worker.join(timeout=2)
            server.server_close()


if __name__ == "__main__":
    unittest.main()
