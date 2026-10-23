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
        token = {"leaseToken": task["leaseToken"]}
        stop = threading.Event()
        lost = threading.Event()
        last_renewal = time.monotonic()
        lease_seconds = task.get("leaseSeconds", 120)

        def heartbeat():
            nonlocal last_renewal
            while not stop.wait(min(35, lease_seconds / 3)):
                try:
                    self.post(prefix + "progress", {**token, "message": "Hermes đang xử lý yêu cầu"})
                    last_renewal = time.monotonic()
                except ApiError as error:
                    if error.status in (401, 403, 404, 409):
                        lost.set()
                        return
                except (OSError, ValueError):
                    pass
                if time.monotonic() - last_renewal >= lease_seconds:
                    lost.set()
                    return

        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        process = None
        submitting = False
        try:
            while True:
                # Legacy servers may still issue a deadline. New servers renew leases
                # without a total time or attempt ceiling.
                deadline = datetime.fromisoformat(task["deadline"].replace("Z", "+00:00")) if task.get("deadline") else None
                with tempfile.TemporaryDirectory(prefix="zcrm-hermes-") as directory:
                    task_file = Path(directory) / "task.json"
                    result_file = Path(directory) / "result.json"
                    public_task = {k: v for k, v in task.items() if k != "leaseToken"}
                    task_file.write_text(json.dumps(public_task, ensure_ascii=False), encoding="utf-8")
                    task_file.chmod(0o600)
                    prompt = (f"/{task['skill']} Process the ZCRM research task in {task_file}. "
                        f"Write ONLY the required result JSON object to {result_file} using your file tools. "
                        "Follow the skill and task instructions. The bridge handles API, heartbeat and subsequent batches. "
                        "Do not access credentials. If tools or access are missing, do not fabricate a result.")
                    command = shlex.split(os.environ.get("HERMES_COMMAND", "hermes")) + ["chat", "-q", prompt]
                    child_env = {k: v for k, v in os.environ.items() if k not in ("ZCRM_API_KEY", "ZALOCRM_AGENT_KEY")}
                    submitting = False
                    with (Path(directory) / "hermes.log").open("w", encoding="utf-8") as log:
                        process = subprocess.Popen(command, stdout=log, stderr=log, env=child_env,
                            start_new_session=os.name != "nt")
                        while process.poll() is None:
                            if lost.is_set() or time.monotonic() - last_renewal >= lease_seconds or (deadline and datetime.now(timezone.utc) >= deadline):
                                raise TimeoutError("Task cancelled or lease expired")
                            time.sleep(0.5)
                    if process.returncode != 0 or not result_file.exists():
                        raise ValueError("Hermes did not produce a result file")
                    if result_file.stat().st_size > 950000:
                        raise ValueError("Result exceeds the response limit")
                    result = json.loads(result_file.read_text(encoding="utf-8-sig"))
                    if not isinstance(result, dict):
                        raise ValueError("Result must be a JSON object")
                    body = {**token, "result": result}
                    if "batch" in task:
                        body["batch"] = task["batch"]
                    # Retry identical submissions while the lease is alive. A network
                    # interruption never consumes an arbitrary retry allowance.
                    submitting = True
                    while True:
                        if lost.is_set() or time.monotonic() - last_renewal >= lease_seconds:
                            raise TimeoutError("Lease expired while submitting")
                        try:
                            response = self.post(prefix + "complete", body)
                            break
                        except ApiError as error:
                            if error.status < 500 and error.status != 429:
                                raise
                        except OSError:
                            pass
                        stop.wait(2)
                    if response.get("status") == "completed":
                        print("Completed ZCRM research task", task_id, flush=True)
                        return True
                    next_task = response.get("task")
                    if response.get("status") != "running" or not isinstance(next_task, dict) or next_task.get("taskId") != task_id or next_task.get("leaseToken") != token["leaseToken"] or next_task.get("batch", -1) <= task.get("batch", -1):
                        raise ValueError("Invalid batch continuation from ZCRM")
                    task = next_task
                    last_renewal = time.monotonic()
                    print("Continuing ZCRM research task", task_id, "batch", task["batch"], flush=True)
        except (OSError, ValueError, TimeoutError, ApiError) as error:
            # Leave uncertain submissions for lease recovery, instead of marking
            # a committed result failed after a lost network response.
            uncertain = submitting and (isinstance(error, (OSError, TimeoutError)) or isinstance(error, ApiError) and (error.status >= 500 or error.status in (401, 403, 404, 409, 429)))
            if not uncertain and not lost.is_set() and not isinstance(error, TimeoutError):
                try:
                    self.post(prefix + "fail", {**token, "message": "Hermes không hoàn thành. Kiểm tra công cụ và cấu hình trên máy chủ Hermes."})
                except (OSError, ValueError, ApiError):
                    pass
            print("ZCRM research task interrupted; check Hermes tools/connection", task_id, flush=True)
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


def configure_continuous():
    """Configure only the Hermes profile selected by HERMES_COMMAND/HERMES_HOME."""
    command = shlex.split(os.environ.get("HERMES_COMMAND", "hermes"))
    settings = [("agent.max_turns", "none"), ("agent.run_budget_seconds", "null"),
                ("tool_loop_guardrails.loop_caps.max_web_searches", "0")]
    for key, value in settings:
        try:
            subprocess.run(command + ["config", "set", key, value], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        except (OSError, subprocess.SubprocessError):
            raise SystemExit("Cannot configure " + key + "; check Hermes version/profile") from None
    print("Configured continuous research for the selected Hermes profile", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true", help="Keep polling for research tasks")
    parser.add_argument("--configure-continuous", action="store_true", help="Remove research turn/time/search caps from the selected Hermes profile, then exit")
    args = parser.parse_args()
    if args.configure_continuous:
        configure_continuous()
        return
    bridge = Bridge()
    while True:
        worked = False
        try:
            worked = bridge.run_once()
        except (OSError, ValueError, ApiError) as error:
            print(type(error).__name__ + ": cannot contact ZCRM research API", flush=True)
            if not args.watch:
                raise SystemExit(1) from None
        if not args.watch:
            break
        if not worked:
            time.sleep(15)


if __name__ == "__main__":
    main()
