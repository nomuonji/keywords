import json
import os
import shutil
import socket
import subprocess
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 41739
API_PORT = 41740
BASE = os.environ.get("KEYWORDS_WEB_TEST_URL", f"http://{HOST}:{PORT}/")
response_state = {"errors": False, "delay": True}
mutation_requests = []


def project(project_id, name, domain, environment, reviews=0, active=True):
    return {
        "id": project_id, "name": name, "domain": domain, "mode": "existing_site", "environment": environment,
        "control": {"enabled": True, "autoPublish": False, "cadenceMinutes": 60},
        "state": {"status": "running", "stage": "queued_for_agent", "summary": "Queued", "lastTickAt": "2026-09-11T00:00:00Z", "lastError": None},
        "activeOperation": {"id": f"op-{project_id}", "status": "active", "objective": f"Improve {name}.", "taskTitle": None, "blocker": None, "nextAction": "Continue", "updatedAt": "2026-09-11T00:00:00Z"} if active else None,
        "executor": None, "recovery": None, "openReviews": reviews, "qualityQueue": 0,
    }


def dashboard(errors=None):
    projects = [
        project("p1", "判断サイト", "review.example.jp", "production", reviews=1),
        project("p2", "対象サイト", "target.example.jp", "production"),
        project("test-1", "Smoke fixture", "fixture.example.com", "test", active=False),
    ]
    sites = []
    for p in projects:
        sites.append({
            "name": p["name"], "host": p["domain"], "signal": "通常運転", "error": False,
            "clickChange": None, "sessionChange": None, "openTasks": 0, "openReviews": p["openReviews"],
            "articleCount": 1, "verifiedArticles": 1, "publishedArticles": 0, "pendingEvaluations": 0,
            "improved": 0, "regressed": 0, "projects": [{"id": p["id"], "name": p["name"]}],
        })
    return {
        "generatedAt": "2026-09-11T01:00:00Z", "errors": errors or [],
        "autopilot": {"generatedAt": "2026-09-11T01:00:00Z", "scheduler": {}, "totals": {"projects": 3, "enabled": 2, "executing": 0, "queued": 2, "attention": 1, "activeOperations": 2, "connectedAgents": 0}, "projects": projects},
        "portfolio": {"generatedAt": "2026-09-04T01:00:00Z", "stale": True, "sites": sites, "articles": {"inProgress": [], "complete": []}, "keywordChoices": []},
        "operations": None if errors else {"generatedAt": "2026-09-11T01:00:00Z", "outcomes": []},
    }


def wait_for_port():
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            with socket.create_connection((HOST, PORT), timeout=.2):
                return
        except OSError:
            time.sleep(.1)
    raise RuntimeError("Vite test server did not start")


class MockApi(BaseHTTPRequestHandler):
    def send_json(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if response_state["delay"]:
            time.sleep(2)
            response_state["delay"] = False
        errors = [{"section": "operations", "message": "fixture failure"}] if response_state["errors"] else []
        self.send_json(dashboard(errors))

    def do_POST(self):
        mutation_requests.append(self.path)
        self.send_json({})

    def do_OPTIONS(self):
        self.send_json({})

    def log_message(self, _format, *_args):
        return


server = None
api_server = ThreadingHTTPServer((HOST, API_PORT), MockApi)
api_thread = threading.Thread(target=api_server.serve_forever, daemon=True)
api_thread.start()
if "KEYWORDS_WEB_TEST_URL" not in os.environ:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is required")
    child_env = os.environ.copy()
    child_env["VITE_API_BASE_URL"] = f"http://{HOST}:{API_PORT}"
    server = subprocess.Popen(
        [node, str(ROOT / "node_modules/vite/bin/vite.js"), "--host", HOST, "--port", str(PORT), "--strictPort"],
        cwd=ROOT / "apps/web", env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    wait_for_port()

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        console_errors = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto(BASE, wait_until="domcontentloaded")
        page.locator(".corePage").wait_for(timeout=5000)
        page.locator(".dashboardSkeleton").wait_for(timeout=1500)
        assert page.locator(".dashboardSkeleton").is_visible(), "initial load must show a skeleton"
        assert page.get_by_text("今すぐ行う作業はありません", exact=True).count() == 0, "loading must not look empty"
        page.locator(".dashboardSkeleton").wait_for(state="detached")
        assert page.locator(".staleNotice").is_visible(), "stale analytics must be explicit"
        assert page.locator("#project-focus option").count() == 3, "only production projects plus the all option should show"
        page.locator("#project-focus").select_option("p2")
        assert page.locator(".operationalStats > div").first.locator("strong").inner_text() == "0", "focused stats must use focused scope"
        assert page.locator(".actionItem").count() == 1

        response_state["errors"] = True
        page.reload(wait_until="domcontentloaded")
        page.locator(".partialErrors").wait_for()
        assert page.locator(".actionItem").count() == 1, "one failed section must not erase the queue"
        assert page.get_by_text("今すぐ行う作業はありません", exact=True).count() == 0

        page.locator(".coreNav button").nth(1).click()
        page.locator(".scopeNotice").wait_for()
        assert "1 / 2 sites" in page.locator(".countBadge").inner_text(), "test sites must not enter the site count"
        assert page.get_by_text("fixture.example.com", exact=True).count() == 0
        assert page.get_by_role("button", name="全サイトに戻す").is_visible()
        page.get_by_role("button", name="全サイトに戻す").click()
        assert "project=" not in page.url
        assert "2 / 2 sites" in page.locator(".countBadge").inner_text()
        page.locator(".siteRow").first.locator("summary").click()
        page.locator(".siteControls .switchButton").first.click()
        assert page.get_by_role("button", name="変更を確定").is_visible(), "Autopilot must require confirmation"
        assert mutation_requests == [], "choosing a setting must not mutate"
        page.get_by_role("button", name="キャンセル").click()
        assert mutation_requests == []

        page.locator(".coreNav button").first.click()
        page.get_by_role("button", name="企画・テストも表示").click()
        assert page.locator("#project-focus option").count() == 4, "explicit test environment must control visibility"

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(BASE, wait_until="networkidle")
        assert not mobile.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not console_errors
        browser.close()
        print(json.dumps({"ok": True, "checks": ["loading", "stale", "partial failure", "focused stats", "filter clear", "setting confirmation", "environment scope", "mobile overflow"]}, ensure_ascii=False))
finally:
    api_server.shutdown()
    api_server.server_close()
    if server is not None:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
