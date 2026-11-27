"""Explicit, version-aware local conversation adapters. Never reads browser cookies."""
from dataclasses import dataclass
from pathlib import Path
import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from models import Message, SourceStatus, clean_user_text, generated


@dataclass(frozen=True)
class Adapter:
    name: str
    kind: str
    coverage: str
    slug: str


CATALOG = [
    Adapter('TRAE','trae','TRAE CN 应用数据库探测；加密或未知格式可手动导入标准消息 JSON','trae'),
    Adapter('Codex','rollout','CLI / Desktop rollout JSONL','codex'),
    Adapter('Claude Code','claude','projects JSONL；排除子代理、工具结果与自动活动摘要','claude-code'),
    Adapter('Gemini CLI','gemini','tmp/*/chats 会话 JSON / JSONL','gemini-cli'),
    Adapter('Cursor','cursor','IDE bubble SQLite / CLI agent-transcripts','cursor'),
    Adapter('GitHub Copilot Chat','copilot','VS Code chatSessions / Copilot turns SQLite','copilot-chat'),
    Adapter('Grok','grok','Grok Build ACP JSONL；网页 Grok 需标准消息导入','grok'),
    Adapter('Qwen Code','qwen','projects/*/chats JSONL','qwen-code'),
    Adapter('Kimi Code','kimi','sessions/*/*/agents/main/wire.jsonl','kimi-code'),
    Adapter('CodeBuddy / WorkBuddy','buddy','CodeBuddy / WorkBuddy projects JSONL','codebuddy'),
    Adapter('DeepSeek Harness','dsh','sessions/session*.jsonl / .jsonl.zstd；仅真人 user/message','deepseek-harness'),
]
VALID_STATES={'available','partial','empty','absent','permission_denied','encrypted','unsupported_format','cloud_only','error'}


def platform_paths(home, platform=None, env=None):
    env=os.environ if env is None else env
    platform=platform or sys.platform
    if platform=='darwin':
        app=home/'Library/Application Support'; local=app
    elif platform.startswith('win'):
        app=Path(env.get('APPDATA',str(home/'AppData/Roaming')))
        local=Path(env.get('LOCALAPPDATA',str(home/'AppData/Local')))
    else:
        app=Path(env.get('XDG_CONFIG_HOME',str(home/'.config'))); local=Path(env.get('XDG_DATA_HOME',str(home/'.local/share')))
    return {'app':app,'local':local,
        'codex':Path(env.get('CODEX_HOME',str(home/'.codex'))),
        'claude':Path(env.get('CLAUDE_CONFIG_DIR',str(home/'.claude'))),
        'gemini':Path(env['GEMINI_CLI_HOME'])/'.gemini' if env.get('GEMINI_CLI_HOME') else home/'.gemini',
        'cursor':Path(env.get('CURSOR_CONFIG_DIR',str(home/'.cursor'))),
        'grok':Path(env.get('GROK_HOME',str(home/'.grok'))),
        'dsh':Path(env.get('DSH_HOME') or home/'.dsh').expanduser(),
        'kimi':Path(env.get('KIMI_CODE_HOME',str(home/'.kimi-code'))),
        'buddy':Path(env.get('CODEBUDDY_CONFIG_DIR',str(home/'.codebuddy')))}


def _timestamp(value):
    if isinstance(value,(int,float)):
        try:return datetime.fromtimestamp(value/(1000 if abs(value)>1e11 else 1),timezone.utc).isoformat()
        except (ValueError,OverflowError,OSError):return ''
    return str(value) if value is not None else ''


def _text(content):
    if isinstance(content,str):return content
    if isinstance(content,dict):
        return str(content.get('text','')) if content.get('type') in (None,'text','input_text','Text') else ''
    if not isinstance(content,list):return ''
    return '\n'.join(p['text'] for p in content if isinstance(p,dict) and isinstance(p.get('text'),str) and p.get('type') in (None,'text','input_text','Text') and not p.get('thought'))


def _message(source,path,row,text,cid='',mid='',timestamp=None,quality='message'):
    if not isinstance(text,str) or generated(text):return None
    text=clean_user_text(text)
    if not text:return None
    stamp=_timestamp(timestamp if timestamp is not None else row.get('timestamp'))
    return Message(source,str(cid or path.stem),stamp,text,str(mid or ''),quality if stamp else 'unknown')


def _lines(path,opener=None):
    skipped=0;rows=[]
    with (opener(path) if opener else path.open(encoding='utf-8-sig',errors='strict')) as handle:
        for line in handle:
            if not line.strip():continue
            try:
                row=json.loads(line)
                if not isinstance(row,dict):raise ValueError('record is not an object')
                rows.append(row)
            except (ValueError,TypeError):skipped+=1
    return rows,skipped


def _rollout(path,source):
    # Stream large tool output records; keep only metadata and candidate user messages.
    events=[];fallback=[];skipped=0;cid=path.stem;start='';subagent=False
    with path.open(encoding='utf-8-sig') as handle:
        for ordinal,line in enumerate(handle):
            if not line.strip():continue
            try:row=json.loads(line)
            except ValueError:skipped+=1;continue
            if not isinstance(row,dict):skipped+=1;continue
            p=row.get('payload',{})
            if not isinstance(p,dict):continue
            if row.get('type')=='session_meta':
                cid=p.get('id',p.get('session_id',cid));start=p.get('timestamp','')
                src=p.get('source',{})
                subagent=isinstance(src,dict) and ('subagent' in src)
                continue
            if subagent:continue
            mid='';text=''
            if row.get('type')=='event_msg':
                if p.get('type')=='user_message':
                    text=p.get('message','');mid=p.get('id','')
                if text:
                    ts=row.get('timestamp') or _timestamp(p.get('completed_at_ms')) or start
                    m=_message(source,path,row,text,cid,mid,ts,'message' if ts else 'unknown')
                    if m:events.append(m)
            elif row.get('type')=='response_item' and p.get('type')=='message' and p.get('role')=='user':
                text=_text(p.get('content'));ts=row.get('timestamp') or start
                m=_message(source,path,row,text,cid,p.get('id',''),ts)
                if m:fallback.append(m)
    # User events represent typed messages; response records are the fallback.
    result=events if events else fallback
    unique=[];seen=set()
    for m in result:
        key=m.message_id or (m.timestamp,m.text)
        if key not in seen:unique.append(m);seen.add(key)
    return unique,skipped


def _claude(rows,path,source):
    out=[]
    if 'subagents' in path.parts:return out
    for r in rows:
        msg=r.get('message',{})
        if r.get('type')!='user' or not isinstance(msg,dict) or msg.get('role')!='user':continue
        if any(r.get(k) for k in ('isSidechain','isMeta','isCompactSummary','isSummary')):continue
        if r.get('promptSource')=='sdk' and _text(msg.get('content')).lstrip().startswith('Foreground apps today (minutes):'):
            continue
        m=_message(source,path,r,_text(msg.get('content')),r.get('sessionId'),r.get('uuid'))
        if m:out.append(m)
    return out


def _gemini(obj,path,source):
    if isinstance(obj,dict):
        if not obj.get('sessionId') or not isinstance(obj.get('messages'),list):raise ValueError('not a Gemini session')
        rows=obj['messages'];cid=obj['sessionId'];start=obj.get('startTime','')
    else:
        cid=next((r.get('sessionId') for r in obj if r.get('sessionId')),path.stem);start=next((r.get('startTime') for r in obj if r.get('startTime')),'');rows=[]
        for r in obj:
            if '$rewindTo' in r:
                target=r['$rewindTo'];ids=[x.get('id') for x in rows]
                if target in ids:rows=rows[:ids.index(target)]
            elif r.get('type') in ('user','gemini','model'):rows.append(r)
    return [m for r in rows if r.get('type')=='user' for m in [_message(source,path,r,_text(r.get('content')),cid,f"{cid}:{r['id']}" if r.get('id') else '',r.get('timestamp') or start)] if m]


def _patch_log(rows):
    obj={}
    for r in rows:
        kind=r.get('kind');keys=r.get('k',[])
        if kind==0:
            if not isinstance(r.get('v'),dict):raise ValueError('bad initial object')
            obj=r['v'];continue
        if not keys or kind not in (1,2,3):raise ValueError('unknown patch operation')
        parent=obj
        for key in keys[:-1]:parent=parent[key]
        key=keys[-1]
        if kind==1:parent[key]=r.get('v')
        elif kind==3:
            if isinstance(parent,list):parent.pop(key)
            else:parent.pop(key,None)
        else:
            array=parent[key]
            if not isinstance(array,list):raise ValueError('push target is not array')
            if 'i' in r:del array[r['i']:]
            array.extend(r.get('v',[]))
    return obj


def _copilot(obj,path,source):
    if not isinstance(obj,dict) or not isinstance(obj.get('requests'),list):raise ValueError('not chat session data')
    responder=str(obj.get('responderUsername','')).lower()
    if responder and 'copilot' not in responder:raise ValueError('different chat provider')
    return [m for r in obj['requests'] if isinstance(r,dict) for m in [_message(source,path,r,_text(r.get('message')),obj.get('sessionId',path.stem),r.get('requestId'),r.get('timestamp') or obj.get('creationDate'), 'message' if r.get('timestamp') else 'session')] if m]


def _sqlite(path,source):
    c=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
    out=[]
    try:
        tables={r[0] for r in c.execute("select name from sqlite_master where type='table'")}
        if source=='Cursor' and 'cursorDiskKV' in tables:
            for key,value in c.execute("select key,value from cursorDiskKV where key like 'bubbleId:%'"):
                try:r=json.loads(value)
                except (ValueError,TypeError):continue
                if not isinstance(r,dict) or r.get('type')!=1:continue
                pieces=key.split(':');m=_message(source,path,r,r.get('text') or r.get('rawText',''),pieces[1],pieces[-1],r.get('timestamp'))
                if m:out.append(m)
        elif source=='GitHub Copilot Chat' and 'turns' in tables:
            cols={r[1] for r in c.execute('pragma table_info(turns)')}
            if not {'session_id','user_message','timestamp','id'}<=cols:raise ValueError('unknown turns schema')
            for sid,text,ts,mid in c.execute('select session_id,user_message,timestamp,id from turns'):
                m=_message(source,path,{},text,sid,f'{sid}:{mid}',ts)
                if m:out.append(m)
        else:raise ValueError('no verified message schema in database')
    finally:c.close()
    return out


def _grok(rows,path,source):
    out=[];pending=None;buffer=''
    summary=path.parent/'summary.json';cid=path.parent.name
    if summary.exists():
        meta=json.loads(summary.read_text());info=meta.get('info',meta)
        if info.get('session_kind') in ('subagent','subagent_fork'):return []
        cid=info.get('id',cid)
    for r in rows:
        params=r.get('params',{});update=params.get('update',{});meta=params.get('_meta',{})
        if update.get('sessionUpdate')!='user_message_chunk':
            if pending:
                out.append(Message(source,cid,pending.timestamp,clean_user_text(buffer),pending.message_id))
                pending=None;buffer=''
            continue
        text=_text(update.get('content'));mid=meta.get('promptIndex',meta.get('promptId',meta.get('eventId','')))
        scoped_id=f'{cid}:{mid}' if mid!='' else ''
        m=_message(source,path,r,text,cid,scoped_id,r.get('timestamp') or meta.get('agentTimestampMs'))
        if not m:continue
        if pending and mid!='' and pending.message_id==scoped_id:
            buffer+=text
        else:
            if pending:out.append(Message(source,cid,pending.timestamp,clean_user_text(buffer),pending.message_id))
            pending=m;buffer=text
    if pending:out.append(Message(source,cid,pending.timestamp,clean_user_text(buffer),pending.message_id))
    return out


def _standard(obj,path,source):
    # Only manually selected imports use this contract. Never recurse through arbitrary JSON.
    conversations=obj if isinstance(obj,list) else obj.get('conversations',[obj]) if isinstance(obj,dict) else []
    out=[];recognized=False
    for conv in conversations:
        if not isinstance(conv,dict) or not isinstance(conv.get('messages'),list):continue
        recognized=True
        for r in conv['messages']:
            if not isinstance(r,dict) or r.get('role')!='user':continue
            cid=conv.get('id',conv.get('sessionId',path.stem))
            m=_message(source,path,r,_text(r.get('content')),cid,f"{cid}:{r['id']}" if r.get('id') else '',r.get('timestamp'))
            if m:out.append(m)
    if not recognized:raise ValueError('expected conversations/messages with explicit role/content')
    return out


DSH_GENERATION = re.compile(r'session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$')


def _dsh_generations(candidates):
    # Migrations retain old logs: select the highest committed generation per directory.
    chosen={};other=[]
    for path,explicit in candidates:
        match=DSH_GENERATION.fullmatch(path.name)
        if not match:
            if explicit:other.append((path,explicit))
            continue
        rank=(int(match.group(1) or 0),path.suffix=='.zstd')
        parent=path.resolve().parent
        if parent not in chosen or rank>chosen[parent][0]:chosen[parent]=(rank,path,explicit)
    return other+[(path,explicit) for _,path,explicit in chosen.values()]


def _dsh(path,source):
    if path.suffix=='.zstd':
        try:
            from compression import zstd
        except ImportError:
            import zstandard as zstd
        try:rows,skipped=_lines(path,lambda p:zstd.open(p,'rt',encoding='utf-8-sig'))
        except (zstd.ZstdError,EOFError) as exc:raise ValueError('invalid Zstandard session log') from exc
    else:rows,skipped=_lines(path)
    if not rows:raise ValueError('missing DeepSeek Harness session header')
    header=rows[0];version=header.get('version')
    if header.get('type')!='session' or type(version) is not int or version not in range(5) or not isinstance(header.get('id'),str) or not header['id']:
        raise ValueError('unsupported DeepSeek Harness session format')
    if type(header.get('delegationDepth')) is not int or header['delegationDepth']<0:
        raise ValueError('invalid DeepSeek Harness delegation metadata')
    if version>=2 and type(header.get('isSeeded')) is not bool:
        raise ValueError('invalid DeepSeek Harness seed metadata')
    match=DSH_GENERATION.fullmatch(path.name)
    if match and int(match.group(1) or 0)!=version:raise ValueError('DeepSeek Harness filename/header version mismatch')
    if header.get('origin')=='subagent' or header.get('delegationDepth',0)>0:return [],skipped
    events=rows[1:]
    if version<2:
        seed=header.get('seedLength',0)
        if type(seed) is not int or seed<0:raise ValueError('invalid inherited prefix')
        events=[r for r in events if r.get('seq',0)>seed]
    elif header.get('isSeeded'):
        markers=[i for i,r in enumerate(events) if r.get('type')=='session/end-seed' and isinstance(r.get('data'),dict) and r['data'].get('inherited') is True]
        if not markers:raise ValueError('seeded session has no inherited prefix boundary')
        events=events[markers[-1]+1:]
    out=[]
    for row in events:
        if row.get('type')!='user/message':continue
        data=row.get('data')
        if not isinstance(data,dict) or not isinstance(data.get('source'),dict):
            skipped+=1;continue
        if data.get('role')!='user' or data['source'].get('kind')!='user':continue
        if not isinstance(data.get('id'),str) or not data['id']:skipped+=1;continue
        # Event time is milliseconds. Missing dates stay unknown, never use file mtime.
        stamp=row.get('time')
        if isinstance(stamp,(int,float)) and not isinstance(stamp,bool):stamp=_timestamp(stamp/1000)
        else:stamp=None
        message=_message(source,path,row,_text(data.get('content')),header['id'],data['id'],stamp)
        if message:out.append(message)
    return out,skipped


def read_source(source,path,explicit=False):
    path=Path(path).resolve();adapter=next(a for a in CATALOG if a.name==source);kind=adapter.kind
    if explicit and path.suffix=='.json' and kind in ('cloud','probe','grok','dsh','trae'):
        return _standard(json.loads(path.read_text(encoding='utf-8-sig')),path,source),0
    if kind=='trae':raise ValueError('TRAE CN requires an explicit standard message JSON import')
    if kind=='rollout':return _rollout(path,source)
    if kind=='dsh':return _dsh(path,source)
    if kind in ('probe','cloud'):raise ValueError('native format has no verified reader')
    if kind in ('cursor','copilot') and path.suffix in ('.vscdb','.db','.sqlite'):
        return _sqlite(path,source),0
    if path.suffix=='.json':
        obj=json.loads(path.read_text(encoding='utf-8-sig'));rows=[];skipped=0
    else:rows,skipped=_lines(path);obj=rows
    if rows and kind in ('claude','cursor','qwen','buddy','kimi','grok'):
        known={
            'claude':lambda r:r.get('type') in ('user','assistant','queue-operation','last-prompt','session_meta'),
            'cursor':lambda r:r.get('role') in ('user','assistant'),
            'qwen':lambda r:isinstance(r.get('message'),dict) and r.get('type') in ('user','assistant','tool_result'),
            'buddy':lambda r:r.get('type') in ('message','session-meta','function_call','reasoning','summary'),
            'kimi':lambda r:str(r.get('type','')).startswith('context.'),
            'grok':lambda r:isinstance(r.get('params'),dict) and 'update' in r['params'],
        }
        if not any(known[kind](r) for r in rows):raise ValueError('no verified session record shape')
    if kind=='claude':out=_claude(rows,path,source)
    elif kind=='gemini':out=_gemini(obj,path,source)
    elif kind=='copilot':out=_copilot(_patch_log(rows) if rows else obj,path,source)
    elif kind=='grok':out=_grok(rows,path,source)
    elif kind=='cursor':
        out=[m for r in rows if r.get('role')=='user' and 'subagents' not in path.parts for m in [_message(source,path,r,_text(r.get('message',{}).get('content',r.get('content'))),mid=r.get('id'))] if m]
    elif kind=='qwen':
        out=[m for r in rows if isinstance(r.get('message'),dict) and (r['message'].get('role') or r.get('type'))=='user' for m in [_message(source,path,r,_text(r['message'].get('parts')),r.get('sessionId'),r.get('id'))] if m]
    elif kind=='buddy':
        out=[m for r in rows if r.get('type')=='message' and r.get('role')=='user' and not any(r.get(k) for k in ('isMeta','isCompactInternal','isCompacted','isSummary','compactType','teammateMessage')) and not r.get('providerData',{}).get('skipRun') for m in [_message(source,path,r,_text(r.get('content')),r.get('sessionId'),r.get('id'))] if m]
    elif kind=='kimi':
        out=[]
        for r in rows:
            payload=r.get('payload',r.get('message',{}))
            origin=payload.get('origin') or {}
            person=not origin or (isinstance(origin,dict) and (str(origin.get('kind','')).startswith('user') or origin.get('trigger')=='user-slash'))
            if r.get('type')=='context.append_message' and payload.get('role')=='user' and person:
                m=_message(source,path,r,_text(payload.get('content')),path.parents[2].name,r.get('id'),r.get('time') or r.get('timestamp'))
                if m:out.append(m)
    else:raise ValueError('unsupported format')
    return out,skipped


def _native_candidates(a,home,p,env,project_roots):
    app=p['app'];kind=a.kind
    if a.name=='Codex':return [(p['codex']/x,'rollout-*.jsonl') for x in ('sessions','archived_sessions')]
    if a.name=='Claude Code':return [(p['claude']/'projects','*.jsonl')]
    if a.name=='Gemini CLI':return [(p['gemini']/'tmp','**/chats/session-*.json*')]
    if a.name=='Cursor':return [(app/'Cursor/User/globalStorage','state.vscdb'),(app/'Cursor/User/workspaceStorage','*/state.vscdb'),(p['cursor']/'projects','**/agent-transcripts/**/*.jsonl')]
    if a.name=='GitHub Copilot Chat':
        return [(app/'Code/User/workspaceStorage','*/chatSessions/*.json*'),(app/'Code/User/globalStorage/emptyWindowChatSessions','*.json*'),(app/'Code/User/globalStorage/transferredChatSessions','*.json*'),(app/'Code/User/globalStorage/github.copilot-chat','session-store.db')]
    if a.name=='Grok':return [(p['grok']/'sessions','**/updates.jsonl')]
    if a.name=='DeepSeek Harness':return [(p['dsh']/'sessions','session*.jsonl*')]
    if a.name=='Qwen Code':return [(home/'.qwen/projects','*/chats/*.jsonl')]
    if a.name=='Kimi Code':return [(p['kimi']/'sessions','**/agents/main/wire.jsonl')]
    if a.name=='CodeBuddy / WorkBuddy':return [(r/'projects','*.jsonl') for r in (p['buddy'],home/'.workbuddy',home/'.workbuddy-ai')]
    return []


def _probe_paths(a,home,p):
    if a.kind=='trae':return [p['app']/'Trae CN/ModularData/ai-agent/database.db']
    return []


def scan_sources(home,platform=None,env=None,overrides=None,project_roots=()):
    home=Path(home);env=os.environ if env is None else env;overrides=overrides or {};p=platform_paths(home,platform,env)
    messages=[];statuses={}
    for a in CATALOG:
        status=SourceStatus(a.name,'absent','未发现本地会话文件',coverage=a.coverage);statuses[a.name]=status
        candidates=[]
        try:
            for root,pattern in _native_candidates(a,home,p,env,project_roots):
                if root.is_file():candidates.append((root,False))
                elif root.is_dir():
                    # Specific patterns constrain the walk to documented stores.
                    files=root.glob(pattern) if '/' in pattern else root.rglob(pattern)
                    candidates.extend((f,False) for f in files if f.is_file() and 'subagents' not in f.parts)
            imports=home/'.ai-wordcloud/imports'/a.slug
            if imports.is_dir():candidates.extend((f,True) for f in imports.glob('*.json'))
            for selected in overrides.get(a.name,[]):
                selected=Path(selected).expanduser()
                if selected.is_dir():candidates.extend((f,True) for f in selected.rglob('*') if f.is_file() and (f.suffix in ('.json','.jsonl','.md','.db','.sqlite','.vscdb') or (a.kind=='dsh' and f.name.endswith('.jsonl.zstd'))))
                elif selected.is_file():candidates.append((selected,True))
                else:status.issues.append({'state':'absent','path':str(selected),'detail':'指定路径不存在'})
            if a.kind=='dsh':candidates=_dsh_generations(candidates)
            seen=set();success=0;errors=set()
            for path,explicit in candidates:
                key=str(path.resolve())
                if key in seen:continue
                seen.add(key);status.files+=1;status.paths.append(key)
                try:
                    found,skipped=read_source(a.name,path,explicit);messages.extend(found);status.messages+=len(found);status.skipped+=skipped;success+=1
                    if skipped:status.issues.append({'state':'partial','path':key,'detail':f'{skipped} 条损坏记录已跳过'})
                except PermissionError:
                    errors.add('permission_denied');status.issues.append({'state':'permission_denied','path':key,'detail':'无读取权限'})
                except (ValueError,TypeError,KeyError,IndexError,UnicodeError,sqlite3.DatabaseError,OSError) as exc:
                    state='unsupported_format';errors.add(state);status.skipped+=1
                    status.issues.append({'state':state,'path':key,'detail':type(exc).__name__+'：消息结构无法识别'})
            for path in _probe_paths(a,home,p):
                try:
                    if not path.exists():continue
                    status.paths.append(str(path))
                    with path.open('rb') as handle:header=handle.read(16)
                    state='unsupported_format' if header.startswith(b'SQLite format 3') else 'encrypted'
                    errors.add(state)
                    status.issues.append({'state':state,'path':str(path),'detail':'发现 TRAE CN 应用数据库；加密或未知格式无法可靠读取，可导入标准消息 JSON'})
                except PermissionError:
                    errors.add('permission_denied')
                    status.issues.append({'state':'permission_denied','path':str(path),'detail':'TRAE CN 应用数据库无读取权限'})
            if success:
                status.state='partial' if errors or status.skipped or status.issues else ('available' if status.messages else 'empty')
                status.detail=f'读取 {status.messages} 条用户消息；{status.files} 个文件'
            elif errors:
                status.state=next(iter(errors)) if errors in ({'permission_denied'},{'encrypted'}) else 'unsupported_format';status.detail='发现文件，但无法可靠提取用户消息'
            else:
                if a.kind=='cloud':status.state='cloud_only';status.detail='未发现已验证的本地正文格式；可导入标准消息 JSON'
                elif status.issues:status.state='absent';status.detail='指定路径不存在'
        except PermissionError:
            status.state='permission_denied';status.detail='扫描目录无权限'
        except OSError as exc:
            status.state='error';status.detail=type(exc).__name__+'：扫描失败'
    return messages,statuses
