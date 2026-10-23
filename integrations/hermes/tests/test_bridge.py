# SPDX-License-Identifier: AGPL-3.0-or-later
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).parents[1] / "zcrm_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.task = None
        self.redirect = False
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append((self.path, body, self.headers.get("X-API-Key"), self.headers.get("Authorization")))
                self.send_response(302 if owner.redirect else 200)
                if owner.redirect:
                    self.send_header("Location", "/unexpected-redirect")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                result = {"task": owner.task} if self.path.endswith("/claim") else {"status": "completed"}
                self.wfile.write(json.dumps(result).encode())

            def log_message(self, *_args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.environment = patch.dict(os.environ, {"ZCRM_BASE_URL": f"http://127.0.0.1:{self.server.server_port}", "ZCRM_API_KEY": "test-key", "ZALOCRM_AGENT_KEY": ""})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def make_task(self):
        self.task = {"taskId": "test-task", "projectId": "test-project", "kind": "analyze",
            "leaseToken": "private-test-lease", "deadline": (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat(),
            "skill": "zcrm-summarize-hotel-pains", "input": {"sources": []}}

    def test_idle_does_not_invoke_hermes(self):
        with patch.object(bridge.subprocess, "Popen") as popen:
            self.assertFalse(bridge.Bridge().run_once())
            popen.assert_not_called()

    def test_runs_cli_and_submits_json_without_exposing_api_key_to_child(self):
        self.make_task()
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "fake_hermes.py"
            fake.write_text("import os,sys,re,pathlib\nassert 'ZCRM_API_KEY' not in os.environ\np=re.search(r'JSON object to (.+?) using',sys.argv[-1]).group(1)\npathlib.Path(p).write_text('{\"pains\": []}')\n", encoding="utf-8")
            command = shlex.join([sys.executable, str(fake)])
            with patch.dict(os.environ, {"HERMES_COMMAND": command}):
                self.assertTrue(bridge.Bridge().run_once())
        complete = next(r for r in self.requests if r[0].endswith("/complete"))
        self.assertEqual(complete[1], {"leaseToken": "private-test-lease", "result": {"pains": []}})
        self.assertEqual(complete[2], "test-key")

    def test_missing_cli_reports_failure(self):
        self.make_task()
        with patch.dict(os.environ, {"HERMES_COMMAND": "nonexistent-hermes-test-command"}):
            self.assertTrue(bridge.Bridge().run_once())
        self.assertTrue(any(r[0].endswith("/fail") for r in self.requests))

    def test_reuses_existing_agent_environment_and_bearer_header(self):
        with patch.dict(os.environ, {"ZCRM_BASE_URL": "", "ZCRM_API_KEY": "", "ZALOCRM_URL": f"http://127.0.0.1:{self.server.server_port}", "ZALOCRM_AGENT_KEY": "zcrm_agent.test"}):
            self.assertFalse(bridge.Bridge().run_once())
        request = self.requests[0]
        self.assertIsNone(request[2])
        self.assertEqual(request[3], "Bearer zcrm_agent.test")

    def test_never_follows_redirects_with_the_api_key(self):
        self.redirect = True
        with self.assertRaises(bridge.ApiError):
            bridge.Bridge().post("claim", {})
        self.assertEqual(len(self.requests), 1)

    def test_rejects_remote_plain_http_and_url_credentials(self):
        for origin in ("http://remote.example", "https://user:pass@remote.example", "https://remote.example/path"):
            with patch.dict(os.environ, {"ZCRM_BASE_URL": origin}):
                with self.assertRaises(ValueError):
                    bridge.Bridge()


if __name__ == "__main__":
    unittest.main()
