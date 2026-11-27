import struct
import unittest
from pathlib import Path
from tests.test_personal_features import feature_page, HAS_PLAYWRIGHT, CHROME

@unittest.skipUnless(HAS_PLAYWRIGHT and CHROME.exists(),'Install requirements-dev.txt and Chrome')
class ShareBrowserTests(unittest.TestCase):
    def test_options_download_three_png_sizes_without_page_navigation(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            original_url=page.url
            for size,dimensions in [('square',(1080,1080)),('portrait',(1080,1920)),('landscape',(1600,1000))]:
                page.locator('.share-link').click()
                expect(page.locator('#share-dialog')).to_have_attribute('open','')
                page.select_option('#share-size',size)
                with page.expect_download() as event: page.click('#share-export')
                png=Path(event.value.path()).read_bytes()
                self.assertEqual(png[:8],b'\x89PNG\r\n\x1a\n')
                self.assertEqual(struct.unpack('>II',png[16:24]),dimensions)
                expect(page.locator('#share-dialog')).not_to_have_attribute('open','')
                self.assertEqual(page.url,original_url)
                expect(page.locator('#share-preview')).to_have_count(0)

    def test_empty_word_cloud_can_switch_to_recap_and_download(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.fill('#word-search','no-such-word')
            page.locator('.share-link').click()
            expect(page.locator('#share-export')).to_be_disabled()
            expect(page.locator('#share-status')).to_contain_text('没有可分享的词语')
            page.select_option('#share-kind','recap')
            expect(page.locator('#share-export')).to_be_enabled()
            with page.expect_download() as event: page.click('#share-export')
            self.assertTrue(event.value.suggested_filename.endswith('.png'))

    def test_blob_failure_keeps_dialog_open_and_allows_retry(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.locator('.share-link').click()
            page.evaluate('() => { window.originalToBlob=HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);}; }')
            page.click('#share-export')
            expect(page.locator('#share-status')).to_contain_text('重试')
            expect(page.locator('#share-dialog')).to_have_attribute('open','')
            expect(page.locator('#share-export')).to_be_enabled()
            page.evaluate('() => { HTMLCanvasElement.prototype.toBlob=window.originalToBlob; }')
            with page.expect_download(): page.click('#share-export')
            expect(page.locator('#share-dialog')).not_to_have_attribute('open','')

    def test_custom_title_is_text_and_dialog_closes_with_escape(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.locator('.share-link').click()
            page.fill('#share-title','<img src=x onerror=window.__xss=1>')
            expect(page.locator('#share-title')).to_have_attribute('maxlength','80')
            self.assertIsNone(page.evaluate('window.__xss ?? null'))
            self.assertEqual(page.locator('#share-dialog img').count(),0)
            page.keyboard.press('Escape')
            expect(page.locator('#share-dialog')).not_to_have_attribute('open','')
            expect(page.locator('.share-link')).to_be_focused()

    def test_changing_recap_period_changes_download(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.locator('.share-link').click();page.select_option('#share-kind','recap')
            with page.expect_download() as first: page.click('#share-export')
            before=Path(first.value.path()).read_bytes()
            page.fill('#recap-anchor','2026-01');page.locator('#recap-anchor').dispatch_event('change')
            expect(page.locator('#recap-messages')).to_have_text('10')
            page.locator('.share-link').click()
            with page.expect_download() as second: page.click('#share-export')
            self.assertNotEqual(before,Path(second.value.path()).read_bytes())
