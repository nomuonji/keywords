"""Run with the webapp-testing with_server helper on port 4174."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

plan = {
    "id": "site-one", "title": "読書のサイト構想", "concept": "調査した需要からページ構造を考える",
    "audience": "読む時間をつくりたい人", "monetization": "関連商品の紹介", "notes": "まずカテゴリを整理",
    "status": "draft", "revision": 2, "createdAt": "2026-09-16T00:00:00Z", "updatedAt": "2026-09-16T00:00:00Z",
    "nodes": [
        {"id": "home", "parentId": None, "title": "読書案内", "path": "/", "kind": "home", "purpose": "読者を案内", "notes": "", "keywordIds": []},
        {"id": "books", "parentId": "home", "title": "本の選び方", "path": "/books", "kind": "category", "purpose": "目的に合う本を選ぶ", "notes": "比較記事を追加", "keywordIds": ["a" * 32]},
    ],
    "links": [{"from": "home", "to": "books", "label": "本を選ぶ"}],
    "keywords": [{"id": "a" * 32, "keyword": "読書 初心者", "volume": 100, "notes": "テスト用の調査データ"}],
}
other = {**plan, "id": "site-two", "title": "別のサイト構想", "status": "archived", "nodes": [], "links": [], "keywords": []}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1080})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def serve(route):
        url = route.request.url
        if "id=site-one" in url:
            result = plan
        elif "id=site-two" in url:
            result = other
        elif "pageToken=" in url:
            result = {"items": [other], "nextPageToken": None}
        else:
            result = {"items": [plan], "nextPageToken": "next"}
        route.fulfill(json=result, headers={"access-control-allow-origin": "*"})

    page.route("**/site-structures*", serve)
    page.goto("http://127.0.0.1:4174/?view=structures", wait_until="networkidle")
    expect(page.get_by_role("heading", name="読書のサイト構想", exact=True)).to_be_visible()
    expect(page.get_by_text("読書 初心者", exact=True)).to_be_visible()
    expect(page.get_by_text("月間検索数 100", exact=True)).to_be_visible()
    expect(page.get_by_text("親: 読書案内", exact=True)).to_be_visible()
    expect(page.get_by_text("本を選ぶ", exact=True)).to_be_visible()
    output = Path("data/site-structure-verification")
    output.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(output / "desktop.png"), full_page=True)
    page.get_by_role("button", name="さらに読み込む").click()
    page.get_by_role("button", name="別のサイト構想").click()
    expect(page.get_by_role("heading", name="別のサイト構想", exact=True)).to_be_visible()
    expect(page.get_by_text("ページはまだありません。", exact=False)).to_be_visible()
    page.get_by_role("combobox", name="構想の状態").select_option("draft")
    expect(page.get_by_role("button", name="別のサイト構想")).to_have_count(0)
    page.get_by_role("button", name="読書のサイト構想").click()
    page.set_viewport_size({"width": 390, "height": 844})
    expect(page.get_by_role("heading", name="読書のサイト構想", exact=True)).to_be_visible()
    page.screenshot(path=str(output / "mobile.png"), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Page overflows mobile viewport"
    page.unroute("**/site-structures*", serve)
    page.route("**/site-structures*", lambda route: route.fulfill(json={"items": [], "nextPageToken": None}, headers={"access-control-allow-origin": "*"}))
    page.get_by_role("button", name="更新", exact=True).click()
    expect(page.get_by_role("heading", name="最初のサイト構想をつくる")).to_be_visible()
    page.unroute("**/site-structures*")
    page.route("**/site-structures*", lambda route: route.fulfill(status=503, json={"error": "接続テスト"}, headers={"access-control-allow-origin": "*"}))
    page.get_by_role("button", name="更新", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("接続テスト")
    assert not errors, json.dumps(errors, ensure_ascii=False)
    browser.close()
    print("site structure UI passed: hierarchy, research, links, pagination, filtering, selection, empty/error states and mobile viewport")
