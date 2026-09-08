"""Optional browser smoke. Run against isolated API/Vite instances, never production."""
import os
import json
from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    try:
        page=browser.new_page(viewport={'width':1280,'height':900})
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(os.environ.get('BLOG_TEST_UI_URL','http://127.0.0.1:15173'))
        page.wait_for_load_state('networkidle')
        labels=page.get_by_role('button').all_text_contents()
        assert any('検索実績' in label for label in labels),labels
        page.get_by_role('button',name='検索実績 サイト・GSC').click()
        page.get_by_role('heading',name='Blogとの連携').wait_for()
        page.wait_for_load_state('networkidle')
        assert page.locator('input[type=file]').count()==1
        assert page.get_by_text('fixture',exact=False).count()>0
        assert page.get_by_role('heading',name='受け渡した企画').is_visible()
        page.locator('summary').filter(has_text='Compare the documented requirements').click()
        page.get_by_role('button',name='根拠を確認して企画を承認').click()
        page.wait_for_load_state('networkidle')
        with page.expect_download() as download_info:
            page.get_by_role('button',name='承認済み企画をダウンロード').click()
        package=json.loads(Path(download_info.value.path()).read_text(encoding='utf-8'))
        assert package['blog_site_id']=='fixture'
        assert package['publication_authorized'] is False
        assert not errors,errors
        destination=Path(tempfile.gettempdir())/'keywords-blog-ui-smoke.png'
        page.screenshot(path=str(destination),full_page=True)
        print({'passed':True,'screenshot':str(destination),'page_errors':errors})
    finally:
        browser.close()
