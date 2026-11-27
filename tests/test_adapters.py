import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from adapters import CATALOG, platform_paths, read_source, scan_sources


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def fixture(self, name, obj, jsonl=False):
        p = self.home / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(('\n'.join(json.dumps(o) for o in obj) if jsonl else json.dumps(obj)), encoding='utf-8')
        return p

    def test_catalog_matches_requested_products(self):
        names = {a.name for a in CATALOG}
        self.assertEqual(names, {'TRAE','Codex','Claude Code','Gemini CLI','Cursor','GitHub Copilot Chat','Grok','Qwen Code','Kimi Code','CodeBuddy / WorkBuddy','DeepSeek Harness'})

    def test_three_platform_roots_and_env_overrides(self):
        for platform, expected in [('darwin','Library/Application Support'),('win32','Roaming'),('linux','.config')]:
            env = {'APPDATA':str(self.home/'Roaming')} if platform=='win32' else {}
            paths = platform_paths(self.home,platform,env)
            self.assertIn(expected,str(paths['app']))
        paths=platform_paths(self.home,'linux',{'XDG_CONFIG_HOME':str(self.home/'custom')})
        self.assertEqual(paths['app'], self.home/'custom')

    def test_rollout_event_user_excludes_injected_response_and_subagents(self):
        p=self.fixture('rollout.jsonl',[
          {'type':'session_meta','payload':{'id':'c'}},
          {'timestamp':'2026-01-01T00:00:00Z','type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'runtime injected noise'}]}},
          {'timestamp':'2026-01-01T00:01:00Z','type':'event_msg','payload':{'type':'user_message','id':'u','message':'human prompt'}},
        ],True)
        messages,_=read_source('Codex',p)
        self.assertEqual([m.text for m in messages],['human prompt'])
        self.assertEqual(messages[0].message_id,'u')

    def test_claude_excludes_tool_results_and_meta(self):
        rows=[{'type':'user','sessionId':'s','uuid':'1','timestamp':'2026-01-01T00:00:00Z','message':{'role':'user','content':'human'}},
          {'type':'user','isMeta':True,'message':{'role':'user','content':'generated'}},
          {'type':'user','message':{'role':'user','content':[{'type':'tool_result','content':'tool output'}]}},
          {'type':'user','isSidechain':True,'message':{'role':'user','content':'delegation'}}]
        p=self.fixture('claude.jsonl',rows,True)
        for source in ('Claude Code',):
            messages,_=read_source(source,p)
            self.assertEqual([m.text for m in messages],['human'])

    def test_gemini_json_and_jsonl_rewind(self):
        row={'id':'a','type':'user','timestamp':'2026-01-01T00:00:00Z','content':'old'}
        p=self.fixture('session.json',{'sessionId':'g','messages':[row,{'type':'gemini','content':'reply'}]})
        self.assertEqual([m.text for m in read_source('Gemini CLI',p)[0]],['old'])
        p=self.fixture('session.jsonl',[{'sessionId':'g'},row,{'$rewindTo':'a'},{'id':'b','type':'user','content':'new'}],True)
        self.assertEqual([m.text for m in read_source('Gemini CLI',p)[0]],['new'])

    def test_qwen_and_codebuddy(self):
        p=self.fixture('qwen.jsonl',[{'type':'user','sessionId':'q','message':{'role':'user','parts':[{'text':'human'},{'thought':True,'text':'reasoning'},{'functionResponse':{'response':'tool'}}]}}],True)
        self.assertEqual([m.text for m in read_source('Qwen Code',p)[0]],['human'])
        p=self.fixture('buddy.jsonl',[{'type':'message','role':'user','content':[{'type':'input_text','text':'human'}]}, {'type':'message','role':'user','providerData':{'skipRun':True},'content':[{'type':'input_text','text':'hook'}]}],True)
        self.assertEqual([m.text for m in read_source('CodeBuddy / WorkBuddy',p)[0]],['human'])

    def test_cursor_sqlite_bubbles_and_copilot_turns_readonly(self):
        p=self.home/'cursor.vscdb'; c=sqlite3.connect(p)
        c.execute('create table cursorDiskKV(key text,value text)')
        c.executemany('insert into cursorDiskKV values (?,?)', [('bubbleId:c:u',json.dumps({'type':1,'text':'human','timestamp':1767225600000})),('bubbleId:c:a',json.dumps({'type':2,'text':'reply'}))]);c.commit();c.close()
        before=p.read_bytes()
        self.assertEqual([m.text for m in read_source('Cursor',p)[0]],['human'])
        self.assertEqual(p.read_bytes(),before)
        p=self.home/'copilot.db';c=sqlite3.connect(p)
        c.execute('create table turns(id integer, session_id text,user_message text,assistant_response text,timestamp text)')
        c.execute("insert into turns values(1,'s','human','reply','2026-01-01')");c.commit();c.close()
        self.assertEqual([m.text for m in read_source('GitHub Copilot Chat',p)[0]],['human'])

    def test_copilot_patch_log(self):
        p=self.fixture('copilot.jsonl',[{'kind':0,'v':{'sessionId':'s','responderUsername':'GitHub Copilot','requests':[]}}, {'kind':2,'k':['requests'],'v':[{'requestId':'r','timestamp':1767225600000,'message':{'text':'human'},'response':[{'value':'reply'}]}]}],True)
        self.assertEqual([m.text for m in read_source('GitHub Copilot Chat',p)[0]],['human'])

    def test_grok_chunk_merge(self):
        p=self.fixture('updates.jsonl',[{'timestamp':1767225600,'params':{'update':{'sessionUpdate':'user_message_chunk','content':{'type':'text','text':part}},'_meta':{'promptIndex':1}}} for part in ['hello ','world']],True)
        self.assertEqual([m.text for m in read_source('Grok',p)[0]],['hello world'])

    def test_kimi_wire_and_cloud_explicit_import(self):
        p=self.fixture('wire.jsonl',[{'timestamp':'2026-01-01','type':'context.append_message','payload':{'role':'user','content':[{'type':'text','text':'human'}]}}, {'type':'tool.result','payload':{'content':'tool'}}],True)
        self.assertEqual([m.text for m in read_source('Kimi Code',p)[0]],['human'])
        for name in ('Grok','TRAE','DeepSeek Harness'):
            p=self.fixture('import.json',{'id':'c','messages':[{'id':'u','role':'user','content':'human','timestamp':'2026-01-01'}, {'role':'assistant','content':'reply'}]})
            self.assertEqual([m.text for m in read_source(name,p,explicit=True)[0]],['human'])

    def test_scan_reports_encryption_unknown_schema_and_missing_paths(self):
        path=self.home/'Library/Application Support/Trae CN/ModularData/ai-agent/database.db';path.parent.mkdir(parents=True);path.write_bytes(b'not sqlite')
        messages,statuses=scan_sources(self.home,platform='darwin',env={})
        self.assertEqual(statuses['TRAE'].state,'encrypted')
        self.assertEqual(statuses['Codex'].state,'absent')
        p=self.fixture('unknown.json',{'text':'not a user role'})
        messages,statuses=scan_sources(self.home,platform='darwin',env={},overrides={'DeepSeek Harness':[p]})
        self.assertEqual(messages,[])
        self.assertEqual(statuses['DeepSeek Harness'].state,'unsupported_format')

    def test_grok_prompt_indices_are_scoped_to_each_session(self):
        paths=[]
        for sid in ('session1','session2'):
            paths.append(self.fixture(sid+'/updates.jsonl',[{'timestamp':1767225600,'params':{'update':{'sessionUpdate':'user_message_chunk','content':{'type':'text','text':sid}},'_meta':{'promptIndex':1}}}],True))
        messages=[read_source('Grok',p)[0][0] for p in paths]
        self.assertNotEqual(messages[0].message_id,messages[1].message_id)

    def test_kimi_person_origin_and_time_field(self):
        p=self.fixture('wire.jsonl',[{'time':'2026-01-01T10:00:00Z','type':'context.append_message','message':{'role':'user','origin':{'kind':'user'},'content':[{'type':'text','text':'human'}]}}, {'type':'context.append_message','message':{'role':'user','origin':{'kind':'system_trigger'},'content':[{'type':'text','text':'hook'}]}}],True)
        messages,_=read_source('Kimi Code',p)
        self.assertEqual([m.text for m in messages],['human'])
        self.assertEqual(messages[0].timestamp,'2026-01-01T10:00:00Z')

    def test_unknown_native_jsonl_is_not_reported_as_empty(self):
        p=self.fixture('unknown.jsonl',[{'text':'arbitrary string'}],True)
        messages,statuses=scan_sources(self.home,env={},overrides={'Claude Code':[p]})
        self.assertEqual(messages,[])
        self.assertEqual(statuses['Claude Code'].state,'unsupported_format')

    def test_claude_generated_activity_telemetry_is_not_human_input(self):
        p=self.fixture('activity.jsonl',[
          {'type':'user','promptSource':'sdk','entrypoint':'sdk-cli','message':{'role':'user','content':'Foreground apps today (minutes): Chrome 45 min; git commits 2'}},
          {'type':'user','promptSource':'sdk','entrypoint':'sdk-cli','message':{'role':'user','content':'Please inspect this bug'}},
        ],True)
        messages,_=read_source('Claude Code',p)
        self.assertEqual([m.text for m in messages],['Please inspect this bug'])

    def test_duplicate_rollout_events_count_one_prompt(self):
        event={'timestamp':'2026-01-01T00:00:00Z','type':'event_msg','payload':{'type':'user_message','id':'u','message':'human'}}
        p=self.fixture('rollout-pair.jsonl',[event,event],True)
        self.assertEqual(len(read_source('Codex',p)[0]),1)

    def test_trae_accepts_standard_import_without_reading_other_directories(self):
        self.fixture('unrelated/sessions/rollout-demo.jsonl',[
            {'type':'event_msg','timestamp':'2026-01-01T00:00:00Z','payload':{'type':'user_message','message':'unrelated prompt'}}
        ],True)
        self.fixture('.ai-wordcloud/imports/trae/import.json',{'id':'cn','messages':[{'id':'cn-user','role':'user','content':'figma cn','timestamp':'2026-01-01T01:00:00Z'}]})
        messages,statuses=scan_sources(self.home,platform='darwin',env={})
        self.assertEqual([m.text for m in messages],['figma cn'])
        self.assertEqual(statuses['TRAE'].messages,1)
        self.assertEqual(statuses['TRAE'].state,'available')

    def test_trae_does_not_accept_rollout_logs_as_product_data(self):
        path=self.fixture('rollout-demo.jsonl',[
            {'type':'event_msg','timestamp':'2026-01-01T00:00:00Z','payload':{'type':'user_message','message':'unrelated prompt'}}
        ],True)
        messages,statuses=scan_sources(self.home,platform='darwin',env={},overrides={'TRAE':[path]})
        self.assertEqual(messages,[])
        self.assertEqual(statuses['TRAE'].state,'unsupported_format')

    def test_trae_database_probe_is_readonly_and_import_remains_available(self):
        path=self.home/'Library/Application Support/Trae CN/ModularData/ai-agent/database.db'
        path.parent.mkdir(parents=True);path.write_bytes(b'encrypted database')
        before=path.read_bytes()
        self.fixture('.ai-wordcloud/imports/trae/import.json',{'messages':[{'role':'user','content':'imported prompt'}]})
        messages,statuses=scan_sources(self.home,platform='darwin',env={})
        self.assertEqual([m.text for m in messages],['imported prompt'])
        self.assertEqual(statuses['TRAE'].state,'partial')
        self.assertEqual(path.read_bytes(),before)
        self.assertTrue(any(issue['state']=='encrypted' for issue in statuses['TRAE'].issues))
