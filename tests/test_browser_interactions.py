import importlib.util
import json
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from tests.test_browser_smoke import CHROME, ROOT

HAS_PLAYWRIGHT=importlib.util.find_spec('playwright') is not None
FIXTURE={
 'meta':{'schemaVersion':2,'uniqueMessages':3,'lastDay':'2026-01-01','timezone':'Asia/Shanghai'},
 'sources':{'Codex':{'state':'available','messages':2,'files':1,'coverage':'fixture'},'Claude Code':{'state':'available','messages':1,'files':1},'Grok':{'state':'absent','messages':0,'files':0}},
 'stopwords':['work'],'modes':{'raw':{'words':[]},'refined':{'words':[]}},
 'buckets':[
  {'day':'2025-12-31','source':'Codex','messageCount':1,'words':{'python':2,'work':1}},
  {'day':'2026-01-01','source':'Claude Code','messageCount':1,'words':{'figma':3}},
  {'day':'unknown','source':'Codex','messageCount':1,'words':{'unknownword':1}},
 ]}

def select_period(page, kind):
    page.click('#source-filter-open')
    page.select_option('#period-kind', kind)
    page.click('#source-filter-apply')


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

@unittest.skipUnless(HAS_PLAYWRIGHT and CHROME.exists(),'Install requirements-dev.txt and Chrome to run interaction checks')
class BrowserInteractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'web')))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close()

    def test_period_source_search_details_and_export(self):
        from playwright.sync_api import sync_playwright, expect
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=str(CHROME),headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(FIXTURE)))
            page.goto(f'http://127.0.0.1:{self.server.server_port}/')
            expect(page.locator('#stat-messages')).to_have_text('3')
            select_period(page,'day')
            expect(page.locator('#period-summary')).to_have_text('2026-01-01')
            expect(page.locator('.word')).to_have_count(1)
            expect(page.locator('.word')).to_have_attribute('data-word','figma')
            page.locator('.word').click();expect(page.locator('#detail-panel')).to_have_class('detail-panel open')
            expect(page.locator('#detail-count')).to_have_text('3')
            page.keyboard.press('Escape')
            page.click('#period-prev')
            expect(page.locator('#period-summary')).to_have_text('2025-12-31')
            expect(page.locator('[data-word="python"]')).to_have_count(1)
            page.click('[data-mode="raw"]')
            expect(page.locator('[data-word="work"]')).to_have_count(1)
            page.fill('#word-search','work');expect(page.locator('.word')).to_have_count(1)
            with page.expect_download() as download:
                page.click('#export-png')
            self.assertTrue(download.value.suggested_filename.endswith('.png'))
            page.fill('#word-search','');select_period(page,'week')
            expect(page.locator('#period-summary')).to_have_text('2025-12-29 — 2026-01-04')
            page.click('#source-filter-open')
            page.locator('label:has(input[data-source="Codex"])').click()
            page.click('#source-filter-apply')
            expect(page.locator('#stat-messages')).to_have_text('1')
            self.assertEqual(errors,[])
            browser.close()

    def test_mobile_period_navigation_has_no_horizontal_overflow(self):
        from playwright.sync_api import sync_playwright,expect
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=str(CHROME),headless=True)
            page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True)
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(FIXTURE)))
            page.goto(f'http://127.0.0.1:{self.server.server_port}/')
            select_period(page,'month')
            expect(page.locator('#period-anchor')).to_have_attribute('type','month')
            page.fill('#period-anchor','2025-12');page.locator('#period-anchor').dispatch_event('change')
            expect(page.locator('#stat-messages')).to_have_text('1')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
            browser.close()

    def test_overview_tracks_period_and_opens_word_details(self):
        from playwright.sync_api import sync_playwright, expect
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=str(CHROME),headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000})
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(FIXTURE)))
            page.goto(f'http://127.0.0.1:{self.server.server_port}/')
            expect(page.locator('#source-distribution')).to_contain_text('67%')
            select_period(page,'day')
            expect(page.locator('#top-word-list button')).to_have_count(1)
            expect(page.locator('#top-word-list')).to_contain_text('figma')
            expect(page.locator('#source-distribution')).to_contain_text('100%')
            expect(page.locator('#source-distribution')).not_to_contain_text('Codex')
            page.locator('#top-word-list button').focus()
            page.keyboard.press('Enter')
            expect(page.locator('#detail-word')).to_have_text('figma')
            expect(page.locator('#detail-count')).to_have_text('3')
            page.keyboard.press('Escape')
            browser.close()

    def test_navigation_opens_share_and_narrow_screen_keeps_controls_in_bounds(self):
        from playwright.sync_api import sync_playwright, expect
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=str(CHROME),headless=True)
            page=browser.new_page(viewport={'width':320,'height':740},reduced_motion='reduce')
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(FIXTURE)))
            page.goto(f'http://127.0.0.1:{self.server.server_port}/')
            page.locator('.share-link').click()
            expect(page.locator('#share-dialog')).to_have_attribute('open','')
            expect(page.locator('#share-title')).to_be_in_viewport()
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),320)
            page.keyboard.press('Escape')
            page.locator('.main-nav a[href="#cloud-stage"]').click()
            expect(page.locator('#cloud-title')).to_be_in_viewport()
            select_period(page,'month')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),320)
            browser.close()
