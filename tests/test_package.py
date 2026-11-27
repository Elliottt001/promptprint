import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from package_portable import build_package

class PackageTests(unittest.TestCase):
    def test_portable_archive_has_empty_snapshot_and_no_developer_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=build_package(Path(tmp)/'portable.zip')
            with zipfile.ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
                names=archive.namelist()
                self.assertTrue(all('.venv' not in n and '.git/' not in n for n in names))
                data=json.loads(archive.read('ai-dialogue-wordcloud/web/data.json'))
                self.assertEqual(data['buckets'],[])
                self.assertEqual(data['meta']['uniqueMessages'],0)
                self.assertNotIn('/Users/',json.dumps(data))
                self.assertIn('ai-dialogue-wordcloud/start.cmd',names)
                self.assertIn('ai-dialogue-wordcloud/start.sh',names)
                self.assertIn('ai-dialogue-wordcloud/assets/preview.png',names)
                self.assertTrue(archive.read('ai-dialogue-wordcloud/assets/preview.png').startswith(b'\x89PNG\r\n\x1a\n'))

    # 添加到 tests/test_package.py 的 PackageTests。
    def test_portable_archive_contains_all_personal_feature_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=build_package(Path(tmp)/'portable.zip')
            with zipfile.ZipFile(output) as archive:
                for filename in ('settings.mjs','data-model.mjs','insights.mjs','features-ui.mjs','cloud-layout.mjs','share.mjs'):
                    self.assertIn('ai-dialogue-wordcloud/web/'+filename,archive.namelist())
                data=json.loads(archive.read('ai-dialogue-wordcloud/web/data.json'))
                self.assertEqual(data['buckets'],[])
                self.assertEqual(data['meta']['uniqueMessages'],0)
                self.assertFalse(any('settings.json' in name for name in archive.namelist()))
