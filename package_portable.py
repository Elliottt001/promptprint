#!/usr/bin/env python3
"""Package runtime files with an empty snapshot, never the developer's data."""
import json
import zipfile
from pathlib import Path
from adapters import CATALOG

ROOT=Path(__file__).resolve().parent
RUNTIME_FILES=('adapters.py','models.py','wordcloud_data.py','launch.py','requirements.txt','start.sh','start.cmd','README.md','web/index.html','web/styles.css','web/app.js','web/data-model.mjs','web/settings.mjs','web/insights.mjs','web/features-ui.mjs','web/cloud-layout.mjs','web/share.mjs')


def build_package(output):
    empty={
        'meta':{'schemaVersion':2,'generatedAt':None,'timezone':None,'uniqueMessages':0,'totalMessages':0,'lastDay':None},
        'sources':{a.name:{'state':'absent','detail':'运行启动脚本后扫描本机记录','messages':0,'files':0,'coverage':a.coverage} for a in CATALOG},
        'modes':{'raw':{'words':[]},'refined':{'words':[]}},
        'buckets':[],'stopwords':[],
    }
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for name in RUNTIME_FILES:archive.write(ROOT/name,'ai-dialogue-wordcloud/'+name)
        archive.writestr('ai-dialogue-wordcloud/web/data.json',json.dumps(empty,ensure_ascii=False))
    return output


if __name__=='__main__':
    print(build_package(ROOT/'dist/ai-dialogue-wordcloud-portable.zip'))
