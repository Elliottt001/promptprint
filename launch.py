#!/usr/bin/env python3
"""Regenerate this computer's snapshot before opening a loopback-only preview."""
import argparse
import errno
import os
import sys
import webbrowser
from collections import defaultdict
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from adapters import CATALOG, scan_sources
from wordcloud_data import aggregate, write_snapshot

ROOT=Path(__file__).resolve().parent


def generate(home, output, timezone_name=None, overrides=None, project_roots=()):
    home=Path(home)
    messages,statuses=scan_sources(home,env=os.environ if home==Path.home() else {},overrides=overrides,project_roots=project_roots)
    payload=aggregate(messages,statuses,timezone_name=timezone_name)
    write_snapshot(output,payload)
    print(f"Generated {payload['meta']['uniqueMessages']} user messages ({payload['meta']['timezone']})",flush=True)
    for name,status in statuses.items():print(f'  {name}: {status.state} / {status.messages}',flush=True)
    return payload


class LocalHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        resolved=super().translate_path(path)
        if Path(resolved)==Path(self.directory)/'data.json':
            local=Path(self.directory)/'data.local.json'
            if local.is_file():return str(local)
        return resolved

    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home',type=Path,default=Path.home())
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-scan',action='store_true',help='Explicitly reuse the existing aggregate snapshot')
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--generate-only',action='store_true')
    parser.add_argument('--timezone')
    parser.add_argument('--source',action='append',default=[],metavar='PRODUCT=PATH')
    parser.add_argument('--project-root',type=Path,action='append',default=[])
    args=parser.parse_args()
    overrides=defaultdict(list);names={a.name for a in CATALOG}
    for entry in args.source:
        name,sep,path=entry.partition('=')
        if not sep or not path or name not in names:parser.error('Expected supported product name=path')
        overrides[name].append(Path(path))
    if not args.no_scan:
        generate(args.home,ROOT/'web/data.local.json',args.timezone,overrides,args.project_root)
    if args.generate_only:return 0
    handler=partial(LocalHandler,directory=str(ROOT/'web'))
    try:server=ThreadingHTTPServer(('127.0.0.1',args.port),handler)
    except OSError as exc:
        if exc.errno!=errno.EADDRINUSE:raise
        server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    url=f'http://127.0.0.1:{server.server_port}/'
    print(f'Open {url} (Ctrl+C to stop)',flush=True)
    if not args.no_browser:webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
    return 0


if __name__=='__main__':
    raise SystemExit(main())
