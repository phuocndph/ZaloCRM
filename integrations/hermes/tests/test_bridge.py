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
import io
from contextlib import redirect_stdout
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
        self.complete_results = []
        self.complete_failures = 0
        self.check_status = 200
        self.check_code = "AGENT_RESEARCH_PERMISSION_REQUIRED"
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append((self.path, body, self.headers.get("X-API-Key"), self.headers.get("Authorization")))
                failing = self.path.endswith("/complete") and owner.complete_failures > 0
                if failing:
                    owner.complete_failures -= 1
                self.send_response(302 if owner.redirect else owner.check_status if self.path.endswith("/check") else 503 if failing else 200)
                if owner.redirect:
                    self.send_header("Location", "/unexpected-redirect")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                result = {"task": owner.task} if self.path.endswith("/claim") else {"status": "completed"}
                if self.path.endswith("/check"):
                    result = {"ok": True, "protocolVersion": 2} if owner.check_status == 200 else {"error": owner.check_code}
                if self.path.endswith("/complete") and owner.complete_results and not failing:
                    result = owner.complete_results.pop(0)
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
            "leaseToken": "private-test-lease", "leaseSeconds": 120,
            "skill": "zcrm-summarize-hotel-pains", "input": {"sources": []}}

    def test_idle_does_not_invoke_hermes(self):
        with patch.object(bridge.subprocess, "Popen") as popen:
            self.assertFalse(bridge.Bridge().run_once())
            popen.assert_not_called()

    def test_runs_cli_and_submits_json_without_exposing_api_key_to_child(self):
        self.make_task()
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "fake_hermes.py"
            fake.write_text("import os,sys,re,pathlib\nassert 'ZCRM_API_KEY' not in os.environ and 'ZALOCRM_AGENT_KEY' not in os.environ\np=re.search(r'JSON object to (.+?) using',sys.argv[-1]).group(1)\npathlib.Path(p).write_text('{\"pains\": []}')\n", encoding="utf-8")
            command = shlex.join([sys.executable, str(fake)])
            with patch.dict(os.environ, {"HERMES_COMMAND": command}):
                self.assertTrue(bridge.Bridge().run_once())
        complete = next(r for r in self.requests if r[0].endswith("/complete"))
        self.assertEqual(complete[1], {"leaseToken": "private-test-lease", "result": {"pains": []}})
        self.assertEqual(complete[2], "test-key")

    def test_continues_all_batches_without_reclaiming_or_a_total_deadline(self):
        self.make_task()
        self.task["batch"] = 0
        for batch in range(1, 5):
            self.complete_results.append({"status": "running", "task": {**self.task, "batch": batch}})
        self.complete_results.append({"status": "completed"})
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "fake_hermes.py"
            fake.write_text("import sys,re,pathlib\np=re.search(r'JSON object to (.+?) using',sys.argv[-1]).group(1)\npathlib.Path(p).write_text('{\"pains\": []}')\n", encoding="utf-8")
            with patch.dict(os.environ, {"HERMES_COMMAND": shlex.join([sys.executable, str(fake)])}):
                self.assertTrue(bridge.Bridge().run_once())
        complete = [r for r in self.requests if r[0].endswith("/complete")]
        self.assertEqual([r[1]["batch"] for r in complete], list(range(5)))
        self.assertEqual(len([r for r in self.requests if r[0].endswith("/claim")]), 1)
        self.assertFalse(any(r[0].endswith("/fail") for r in self.requests))

    def test_submission_retries_more_than_three_times_without_rerunning_hermes(self):
        self.make_task()
        self.complete_failures = 4
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "fake_hermes.py"
            fake.write_text("import sys,re,pathlib\np=re.search(r'JSON object to (.+?) using',sys.argv[-1]).group(1)\npathlib.Path(p).write_text('{\"pains\": []}')\n", encoding="utf-8")
            with patch.dict(os.environ, {"HERMES_COMMAND": shlex.join([sys.executable, str(fake)])}):
                self.assertTrue(bridge.Bridge().run_once())
        bodies = [r[1] for r in self.requests if r[0].endswith("/complete")]
        self.assertEqual(len(bodies), 5)
        self.assertTrue(all(b == bodies[0] for b in bodies))
        self.assertFalse(any(r[0].endswith("/fail") for r in self.requests))

    def test_watch_takes_the_next_job_immediately_and_waits_only_when_idle(self):
        with patch.object(bridge.Bridge, "run_once", side_effect=[True, False, KeyboardInterrupt]), patch.object(bridge.time, "sleep") as sleep, patch.object(sys, "argv", ["bridge", "--watch"]):
            with self.assertRaises(KeyboardInterrupt):
                bridge.main()
        sleep.assert_called_once_with(15)

    def test_configures_only_continuous_settings_for_the_selected_profile(self):
        with patch.object(bridge.subprocess, "run") as run, patch.dict(os.environ, {"HERMES_COMMAND": "hermes -p research"}):
            bridge.configure_continuous()
        self.assertEqual([c.args[0] for c in run.call_args_list], [
            ["hermes", "-p", "research", "config", "set", "agent.max_turns", "none"],
            ["hermes", "-p", "research", "config", "set", "agent.run_budget_seconds", "null"],
            ["hermes", "-p", "research", "config", "set", "tool_loop_guardrails.loop_caps.max_web_searches", "0"],
        ])

    def test_connection_check_never_claims_work_or_starts_hermes(self):
        with redirect_stdout(io.StringIO()), patch.object(bridge.shutil, "which", return_value="/bin/hermes"), patch.object(bridge.subprocess, "Popen") as popen:
            bridge.Bridge().check()
        self.assertEqual([r[0] for r in self.requests], ["/api/public/research/hermes/check"])
        popen.assert_not_called()

    def test_connection_check_reports_the_exact_safe_permission_code(self):
        self.check_status = 403
        with self.assertRaises(bridge.ApiError) as caught:
            bridge.Bridge().check()
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(caught.exception.code, "AGENT_RESEARCH_PERMISSION_REQUIRED")
        output = io.StringIO()
        with redirect_stdout(output):
            bridge.print_connection_error(caught.exception)
        self.assertIn("403", output.getvalue())
        self.assertNotIn("test-key", output.getvalue())

    def test_untrusted_error_text_is_never_printed(self):
        self.check_status = 401
        self.check_code = "Secret token test-key should never be printed"
        with self.assertRaises(bridge.ApiError) as caught:
            bridge.Bridge().check()
        self.assertIsNone(caught.exception.code)
        output = io.StringIO()
        with redirect_stdout(output): bridge.print_connection_error(caught.exception)
        self.assertNotIn("test-key", output.getvalue())

    def test_connection_check_detects_missing_hermes_cli_without_claiming_work(self):
        with patch.object(bridge.shutil, "which", return_value=None), self.assertRaises(ValueError):
            bridge.Bridge().check()
        self.assertTrue(all(r[0].endswith("/check") for r in self.requests))

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
