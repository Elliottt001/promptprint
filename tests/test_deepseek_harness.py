import json
import tempfile
import unittest
from pathlib import Path
from adapters import CATALOG, VALID_STATES, platform_paths, read_source, scan_sources

try:
    from compression import zstd
except ImportError:
    import zstandard as zstd


class DeepSeekHarnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.home=Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def header(self,version=4,**extra):
        return {'type':'session','version':version,'id':'session-1','createdAt':1767225600000,'isSeeded':False,'delegationDepth':0,**extra}

    def user(self,text='human prompt',mid='message-1',kind='user',seq=1):
        return {'type':'user/message','seq':seq,'time':1767225601000,'data':{'id':mid,'role':'user','source':{'kind':kind},'content':[{'type':'text','text':text},{'type':'image','url':'not-text'}]}}

    def write(self,path,rows,compressed=False):
        path=self.home/path;path.parent.mkdir(parents=True,exist_ok=True)
        lines=[(json.dumps(row)+'\n').encode() for row in rows]
        path.write_bytes(b''.join(zstd.compress(line) for line in lines) if compressed else b''.join(lines))
        return path

    def test_catalog_is_exact_and_states_are_preserved(self):
        self.assertEqual([a.name for a in CATALOG],['TRAE','Codex','Claude Code','Gemini CLI','Cursor','GitHub Copilot Chat','Grok','Qwen Code','Kimi Code','CodeBuddy / WorkBuddy','DeepSeek Harness'])
        self.assertEqual(VALID_STATES,{'available','partial','empty','absent','permission_denied','encrypted','unsupported_format','cloud_only','error'})

    def test_raw_and_multiframe_zstd_read_only_human_text(self):
        rows=[self.header(),self.user(),self.user('plugin injection','plugin-1','runtime-context'),self.user('goal continuation','goal-1','goal'),{'type':'assistant/message','data':{'message':{'role':'assistant','content':'reply'}}},{'type':'agent/inbox/spliced','data':{'inserted':[self.user('queued duplicate')['data']]}}]
        for compressed in [False,True]:
            path=self.write('session.v4.jsonl'+('.zstd' if compressed else ''),rows,compressed)
            before=path.read_bytes()
            messages,skipped=read_source('DeepSeek Harness',path)
            self.assertEqual([m.text for m in messages],['human prompt'])
            self.assertEqual(messages[0].timestamp,'2026-01-01T00:00:01+00:00')
            self.assertEqual(messages[0].message_id,'message-1')
            self.assertEqual(skipped,0)
            self.assertEqual(path.read_bytes(),before)

    def test_default_and_custom_home_select_latest_generation(self):
        for custom in [False,True]:
            root='custom' if custom else '.dsh'
            self.write(f'{root}/sessions/project/session/session.v2.jsonl',[self.header(2),self.user('old generation')])
            self.write(f'{root}/sessions/project/session/session.v4.jsonl.zstd',[self.header(),self.user('current generation')],True)
            env={'DSH_HOME':str(self.home/root)} if custom else {}
            messages,statuses=scan_sources(self.home,platform='linux',env=env)
            self.assertEqual([m.text for m in messages],['current generation'])
            self.assertEqual(statuses['DeepSeek Harness'].files,1)
            self.assertEqual(statuses['DeepSeek Harness'].state,'available')
        for platform in ['darwin','win32','linux']:
            self.assertEqual(platform_paths(self.home,platform,{'DSH_HOME':str(self.home/'custom')})['dsh'],self.home/'custom')

    def test_subagents_and_inherited_fork_prefix_are_excluded(self):
        for header in [self.header(origin='subagent'),self.header(delegationDepth=1)]:
            path=self.write('child/session.v4.jsonl',[header,self.user('delegation')])
            self.assertEqual(read_source('DeepSeek Harness',path)[0],[])
        path=self.write('fork/session.v4.jsonl',[self.header(isSeeded=True,parentSession='parent'),self.user('inherited'),{'type':'session/end-seed','seq':2,'time':1767225601000,'data':{'inherited':True}},self.user('new question','message-2',seq=3)])
        self.assertEqual([m.text for m in read_source('DeepSeek Harness',path)[0]],['new question'])
        path=self.write('fork/session.v1.jsonl',[self.header(1,seedLength=1),self.user('inherited'),self.user('new question','message-2',seq=2)])
        self.assertEqual([m.text for m in read_source('DeepSeek Harness',path)[0]],['new question'])

    def test_unknown_versions_and_shapes_are_reported_not_guessed(self):
        for rows in [[self.header(99),self.user()], [self.user()], [self.header(isSeeded=True),self.user()]]:
            path=self.write('session.v99.jsonl',rows)
            messages,statuses=scan_sources(self.home,env={},overrides={'DeepSeek Harness':[path]})
            self.assertEqual(messages,[])
            self.assertEqual(statuses['DeepSeek Harness'].state,'unsupported_format')
        path=self.write('export/session.v4.jsonl.zstd',[self.header(),self.user()],True)
        messages,statuses=scan_sources(self.home,env={},overrides={'DeepSeek Harness':[path.parent]})
        self.assertEqual(len(messages),1)
        self.assertEqual(statuses['DeepSeek Harness'].state,'available')

    def test_released_versions_preserve_missing_message_dates_as_unknown(self):
        for version in range(5):
            user=self.user();user.pop('time')
            name='session.jsonl' if version==0 else f'session.v{version}.jsonl'
            path=self.write(name,[self.header(version),user])
            messages,skipped=read_source('DeepSeek Harness',path)
            self.assertEqual(len(messages),1)
            self.assertEqual(messages[0].timestamp,'')
            self.assertEqual(messages[0].timestamp_quality,'unknown')

    def test_damaged_rows_are_partial_and_corrupt_compression_is_reported(self):
        path=self.write('session.v4.jsonl',[self.header(),self.user()])
        with path.open('ab') as handle:handle.write(b'{broken\n')
        messages,statuses=scan_sources(self.home,env={},overrides={'DeepSeek Harness':[path]})
        self.assertEqual(len(messages),1)
        self.assertEqual(statuses['DeepSeek Harness'].state,'partial')
        path=self.home/'session.v4.jsonl.zstd';path.write_bytes(b'not a zstd frame')
        messages,statuses=scan_sources(self.home,env={},overrides={'DeepSeek Harness':[path]})
        self.assertEqual(messages,[])
        self.assertEqual(statuses['DeepSeek Harness'].state,'unsupported_format')

    def test_future_generation_does_not_fall_back_to_stale_history(self):
        self.write('.dsh/sessions/project/session/session.v4.jsonl',[self.header(),self.user('old')])
        self.write('.dsh/sessions/project/session/session.v99.jsonl',[self.header(99),self.user('future')])
        messages,statuses=scan_sources(self.home,env={})
        self.assertEqual(messages,[])
        self.assertEqual(statuses['DeepSeek Harness'].state,'unsupported_format')
