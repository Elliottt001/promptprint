import json
import threading
import unittest
from contextlib import contextmanager
from functools import partial
from http.server import ThreadingHTTPServer
from tests.test_browser_smoke import CHROME, ROOT
from tests.test_browser_interactions import HAS_PLAYWRIGHT, QuietHandler

FIXTURE={
 'meta':{'schemaVersion':2,'generatedAt':'2026-02-02T00:00:00Z','timezone':'Asia/Shanghai','lastDay':'2026-02-01'},
 'sources':{name:{'state':'available','messages':count,'files':1,'coverage':'fixture'}
            for name,count in [('Codex',10),('Claude Code',5)]},
 'stopwords':['work'],'modes':{'raw':{'words':[]},'refined':{'words':[]}},
 'buckets':[
  {'day':'2026-01-01','source':'Codex','messageCount':5,'words':{'python':6,'飞书':3,'shared':3,'work':3}},
  {'day':'2026-01-02','source':'Claude Code','messageCount':5,'words':{'figma':6,'feishu':3,'shared':3,'work':3}},
  {'day':'2026-02-01','source':'Codex','messageCount':5,'words':{'python':3,'feishu':6,'shared':3,'work':3}}
 ]}

@contextmanager
def feature_page(viewport=None, init_script=None):
    from playwright.sync_api import sync_playwright
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'web')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=str(CHROME),headless=True)
            page=browser.new_page(viewport=viewport or {'width':1440,'height':1000})
            page.set_default_timeout(5000)
            if init_script: page.add_init_script(init_script)
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(FIXTURE)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            try: yield page
            finally: browser.close()
    finally:
        server.shutdown();server.server_close()

@unittest.skipUnless(HAS_PLAYWRIGHT and CHROME.exists(),'Install requirements-dev.txt and Chrome')
class PersonalFeatureTests(unittest.TestCase):
    def test_removed_features_and_old_settings_do_not_hide_words(self):
        from playwright.sync_api import expect
        old_settings={'schemaVersion':1,'hiddenWords':['python'],'aliasGroups':[],'productLabels':{'Codex':'学习'}}
        with feature_page(init_script=f"localStorage.setItem('lingua-orbit.settings.v1', {json.dumps(json.dumps(old_settings))});") as page:
            for selector in ['#settings-panel','#product-section','#hide-word','#share-panel']:
                expect(page.locator(selector)).to_have_count(0)
            expect(page.locator('[data-word="python"]')).to_have_count(1)
            expect(page.locator('#stat-messages')).to_have_text('15')

    def test_recap_compare_and_heatmap(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.click('.main-nav a[href="#recap-section"]')
            page.fill('#recap-anchor','2026-01');page.locator('#recap-anchor').dispatch_event('change')
            expect(page.locator('#recap-messages')).to_have_text('10')
            expect(page.locator('#recap-active-days')).to_have_text('2')
            expect(page.locator('#recap-longest-streak')).to_have_text('2')
            page.click('.main-nav a[href="#compare-section"]')
            for field,value in [('compare-a-start','2026-01-01'),('compare-a-end','2026-01-02'),('compare-b-start','2026-02-01'),('compare-b-end','2026-02-01')]:
                page.fill('#'+field,value)
            page.click('#compare-apply')
            expect(page.locator('#compare-counts')).to_have_text('10 条消息 vs 5 条消息')
            expect(page.locator('[data-change-word="feishu"]')).to_have_text('feishu · 3 次 → 6 次')
            page.click('.main-nav a[href="#heatmap-section"]')
            page.fill('#heatmap-year','2026');page.locator('#heatmap-year').dispatch_event('change')
            expect(page.locator('#heatmap-grid button')).to_have_count(365)
            page.locator('#heatmap-grid [data-day="2026-01-02"]').focus();page.keyboard.press('Enter')
            expect(page.locator('#period-summary')).to_have_text('2026-01-02')
            expect(page.locator('#stat-messages')).to_have_text('5')
            expect(page.locator('#heatmap-grid [data-day="2026-02-03"]')).to_be_disabled()

    def test_invalid_range_retains_previous_results(self):
        from playwright.sync_api import expect
        with feature_page(viewport={'width':390,'height':844}) as page:
            page.click('.main-nav a[href="#compare-section"]')
            previous=page.locator('#compare-rising').inner_text()
            page.fill('#compare-a-start','2026-03-01');page.fill('#compare-a-end','2026-01-01')
            page.click('#compare-apply')
            expect(page.locator('#compare-status')).to_contain_text('起始日期')
            expect(page.locator('#compare-rising')).to_have_text(previous)
            expect(page.locator('#stat-messages')).to_have_text('15')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)

    def test_source_cloud_contains_only_products_with_message_tooltips(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.click('footer a[href="#adapter-section"]')
            expect(page.locator('#source-cloud text')).to_have_count(2)
            for name,count in [('Codex',10),('Claude Code',5)]:
                word=page.locator(f'#source-cloud [data-source="{name}"]')
                expect(word).to_have_attribute('aria-label',f'{name}，{count} 条消息')
                expect(word.locator('title')).to_have_text(f'{count} 条消息')
                word.hover()
            expect(page.locator('#adapter-section')).not_to_contain_text('文件')
            expect(page.locator('#adapter-section details')).to_have_count(0)

    def test_zero_message_products_remain_visible_on_mobile_and_desktop(self):
        from playwright.sync_api import expect
        from adapters import CATALOG
        empty={**FIXTURE,'buckets':[],'sources':{adapter.name:{'state':'absent','messages':0,'files':0,'coverage':'hidden diagnostic'} for adapter in CATALOG}}
        with feature_page(viewport={'width':320,'height':844}) as page:
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(empty)))
            page.reload()
            for width in [320,1440]:
                page.set_viewport_size({'width':width,'height':900})
                page.click('footer a[href="#adapter-section"]')
                expect(page.locator('#source-cloud text')).to_have_count(len(CATALOG))
                expect(page.locator('#source-cloud title').first).to_have_text('0 条消息')
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
            expect(page.locator('#adapter-section')).not_to_contain_text('hidden diagnostic')

    def test_recap_can_open_its_calendar_word_cloud(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.click('.main-nav a[href="#recap-section"]')
            page.fill('#recap-anchor','2026-01');page.locator('#recap-anchor').dispatch_event('change')
            page.click('#recap-view-cloud')
            expect(page.locator('#period-summary')).to_have_text('2026 年 1 月')
            expect(page.locator('#stat-messages')).to_have_text('10')
