import json
import tempfile
import unittest
from pathlib import Path
from launch import generate, main, LocalHandler
from unittest.mock import patch
from functools import partial
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
import threading

class LauncherTests(unittest.TestCase):
    def test_explicit_home_generates_only_that_computers_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp)/'home';output=Path(tmp)/'data.json'
            p=home/'.codex/sessions/rollout-demo.jsonl';p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'type':'session_meta','payload':{'id':'isolated'}})+'\n'+json.dumps({'timestamp':'2026-01-01','type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'isolatedword'}]}})+'\n',encoding='utf-8')
            generate(home,output,timezone_name='UTC')
            data=json.loads(output.read_text())
            self.assertEqual(data['meta']['uniqueMessages'],1)
            self.assertEqual(data['sources']['Codex']['messages'],1)
            self.assertEqual(data['sources']['Claude Code']['messages'],0)
            self.assertEqual(data['buckets'][0]['words'],{'isolatedword':1})

    def test_default_generation_preserves_repository_placeholder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);web=root/'web';web.mkdir()
            placeholder=web/'data.json';placeholder.write_text('{"placeholder":true}')
            home=root/'home';home.mkdir()
            with patch('launch.ROOT',root), patch('sys.argv',['launch.py','--home',str(home),'--generate-only','--timezone','UTC']):
                main()
            self.assertEqual(placeholder.read_text(),'{"placeholder":true}')
            self.assertEqual(json.loads((web/'data.local.json').read_text())['meta']['uniqueMessages'],0)

    def test_preview_serves_local_snapshot_at_existing_data_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'data.json').write_text('{"placeholder":true}')
            (root/'data.local.json').write_text('{"local":true}')
            class QuietHandler(LocalHandler):
                def log_message(self,*args):pass
            server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(root)))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                with urlopen(f'http://127.0.0.1:{server.server_port}/data.json') as response:
                    self.assertEqual(json.load(response),{'local':True})
            finally:
                server.shutdown();server.server_close();thread.join()
