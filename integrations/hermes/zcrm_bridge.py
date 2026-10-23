#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Pull one ZCRM research task, run Hermes with its skill, submit the result."""
import argparse
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ApiError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__(f"ZCRM HTTP {status}")


class Bridge:
    def __init__(self):
        self.base = (os.environ.get("ZCRM_BASE_URL") or os.environ["ZALOCRM_URL"]).rstrip("/")
        parsed = urllib.parse.urlsplit(self.base)
        if (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1"))) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("Use an HTTPS ZCRM origin; localhost HTTP is allowed for testing")
        self.key = os.environ.get("ZALOCRM_AGENT_KEY") or os.environ["ZCRM_API_KEY"]
        self.auth_header = "Authorization" if self.key.startswith("zcrm_agent.") else "X-API-Key"
        if not self.key:
            raise ValueError("ZCRM_API_KEY is empty")
        self.opener = urllib.request.build_opener(NoRedirect())

    def post(self, path, body):
        req = urllib.request.Request(self.base + "/api/public/research/hermes/" + path,
            data=json.dumps(body, ensure_ascii=False).encode(), method="POST",
            headers={"Content-Type": "application/json", self.auth_header: ("Bearer " + self.key) if self.auth_header == "Authorization" else self.key})
        try:
            with self.opener.open(req, timeout=25) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise ApiError(status) from None

    def run_once(self):
        task = self.post("claim", {}).get("task")
        if task is None:
            return False
        task_id = task["taskId"]
        prefix = "tasks/" + urllib.parse.quote(task_id, safe="") + "/"
        token = {"leaseToken": task.pop("leaseToken")}
        deadline = datetime.fromisoformat(task["deadline"].replace("Z", "+00:00"))
        remaining = max(1, (deadline - datetime.now(timezone.utc)).total_seconds())
        stop = threading.Event()
        lost = threading.Event()

        def heartbeat():
            while not stop.wait(35):
                try:
                    self.post(prefix + "progress", {**token, "message": "Hermes đang xử lý yêu cầu"})
                except ApiError as error:
                    if error.status in (401, 403, 404, 409):
                        lost.set()
                        return
                except (OSError, ValueError):
                    pass

        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        process = None
        try:
            with tempfile.TemporaryDirectory(prefix="zcrm-hermes-") as directory:
                task_file = Path(directory) / "task.json"
                result_file = Path(directory) / "result.json"
                task_file.write_text(json.dumps(task, ensure_ascii=False), encoding="utf-8")
                task_file.chmod(0o600)
                prompt = (f"/{task['skill']} Process the ZCRM research task in {task_file}. "
                    f"Write ONLY the required result JSON object to {result_file} using your file tools. "
                    "Follow the skill and task limits. The bridge handles API and heartbeat. "
                    "Do not access credentials. If tools or access are missing, do not fabricate a result.")
                command = shlex.split(os.environ.get("HERMES_COMMAND", "hermes")) + ["chat", "-q", prompt]
                child_env = {k: v for k, v in os.environ.items() if k not in ("ZCRM_API_KEY", "ZALOCRM_AGENT_KEY")}
                with (Path(directory) / "hermes.log").open("w", encoding="utf-8") as log:
                    process = subprocess.Popen(command, stdout=log, stderr=log, env=child_env,
                        start_new_session=os.name != "nt")
                    end = time.monotonic() + remaining
                    while process.poll() is None:
                        if lost.is_set() or time.monotonic() >= end:
                            raise TimeoutError("Task cancelled or lease/deadline expired")
                        time.sleep(0.5)
                if process.returncode != 0 or not result_file.exists():
                    raise ValueError("Hermes did not produce a result file")
                if result_file.stat().st_size > 950000:
                    raise ValueError("Result exceeds the response limit")
                result = json.loads(result_file.read_text(encoding="utf-8-sig"))
                if not isinstance(result, dict):
                    raise ValueError("Result must be a JSON object")
                # Reuse identical body after an uncertain network response.
                for attempt in range(3):
                    try:
                        self.post(prefix + "complete", {**token, "result": result})
                        print("Completed ZCRM research task", task_id, flush=True)
                        return True
                    except ApiError as error:
                        if error.status < 500 or attempt == 2:
                            raise
                        time.sleep(1)
                    except OSError:
                        if attempt == 2:
                            raise
                        time.sleep(1)
        except (OSError, ValueError, TimeoutError, ApiError):
            try:
                self.post(prefix + "fail", {**token, "message": "Hermes không hoàn thành. Kiểm tra công cụ, kết nối và thời gian trên máy chủ Hermes."})
            except (OSError, ValueError, ApiError):
                pass
            print("ZCRM research task failed; check Hermes tools/configuration", task_id, flush=True)
            return True
        finally:
            stop.set()
            if process is not None and process.poll() is None:
                if os.name != "nt":
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    process.wait()
            thread.join(timeout=26)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true", help="Keep polling for research tasks")
    args = parser.parse_args()
    bridge = Bridge()
    while True:
        try:
            bridge.run_once()
        except (OSError, ValueError, ApiError) as error:
            print(type(error).__name__ + ": cannot contact ZCRM research API", flush=True)
            if not args.watch:
                raise SystemExit(1) from None
        if not args.watch:
            break
        time.sleep(15)


if __name__ == "__main__":
    main()
