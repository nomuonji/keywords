"""Run with isolated API/Vite servers through with_server.py."""
import json
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

request = Request('http://127.0.0.1:18787/projects', data=json.dumps({'name':'Portfolio UI fixture','domain':'fixture.example'}).encode(), headers={'Content-Type':'application/json'})
with urlopen(request) as response:
    project = json.load(response)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:15173')
        page.wait_for_load_state('networkidle')
        assert page.get_by_role('heading',name='サイト群の実績').is_visible()
        print(page.get_by_role('button').all_text_contents())
        page.get_by_label('サイト・状態で絞り込み').fill('fixture.example')
        assert page.locator('tbody tr').count() == 1
        page.get_by_role('button',name='実績・Blog連携',exact=True).click()
        page.get_by_role('heading',name='Blogとの連携').wait_for()
        page.get_by_role('button',name='サイト群の実績',exact=True).click()
        page.get_by_role('button',name='作業・レビュー',exact=True).click()
        page.wait_for_load_state('networkidle')
        assert not page.get_by_role('heading',name='サイト群の実績').count()
        page.get_by_role('button',name='サイト群の実績',exact=True).click()
        page.get_by_role('button',name='保存データを再読込').click()
        page.wait_for_load_state('networkidle')
        screenshot=Path(tempfile.gettempdir())/'keywords-portfolio-ui.png'
        page.screenshot(path=str(screenshot), full_page=True)
        assert not errors, errors
        print(json.dumps({'passed':True,'screenshot':str(screenshot),'errors':errors}))
    finally:
        browser.close()
