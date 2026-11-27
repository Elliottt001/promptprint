#!/usr/bin/env python3
"""Build aggregate word-frequency data from local AI conversation histories."""

from __future__ import annotations

import json
import re
import argparse
import hashlib
import os
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from models import Message, SourceStatus, clean_user_text, generated
from adapters import scan_sources, read_source
from pathlib import Path
from typing import Iterable

try:
    import jieba
except ImportError:  # The dependency is installed in the project venv for real builds.
    jieba = None


INJECTED_BLOCK = re.compile(
    r"<(environment_context|system-reminder|turn_aborted)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
URL = re.compile(r"https?://\S+", re.IGNORECASE)
ABSOLUTE_PATH = re.compile(r"(?<!\w)(?:/[\w.@+~-]+){2,}")
LONG_HASH = re.compile(r"\b[0-9a-f]{16,}\b", re.IGNORECASE)
TOKEN_RUN = re.compile(r"[a-zA-Z][a-zA-Z0-9_.+\-]{1,}|[\u3400-\u9fff]+|\d{2,}")
REFINED_STOPWORDS = {
    "一个", "一些", "这个", "那个", "这些", "那些", "我们", "你们", "他们", "自己",
    "需要", "文件", "实现", "进行", "使用", "可以", "能够", "应该", "直接", "现在",
    "已经", "没有", "不要", "然后", "以及", "或者", "还是", "如果", "因为", "所以",
    "根据", "关于", "对于", "所有", "要求", "帮我", "请问", "一下", "这里", "里面",
    "什么", "怎么", "如何", "是否", "继续", "完成", "修改", "添加", "生成", "提供",
    "当前", "任务", "执行", "确认", "不能", "用户", "内容", "完整", "问题", "阶段",
    "提交", "查询", "读取", "方案", "task", "id", "项目", "文档",
    # High-frequency discourse and connective words found in the real snapshot.
    "实际", "就是", "必须", "通过", "具体", "按照", "部分", "不是", "但是", "之后",
    "全部", "存在", "对应", "为什么", "包含", "每个", "的话", "主要", "最终", "其他",
    "另外", "之前", "不同", "分别", "还有", "可能", "哪些", "一样", "作为",
    # Generic workflow words: useful in raw counts, but not as personal themes.
    "工作", "保留", "状态", "运行", "信息", "时间", "目标", "失败", "核对", "检查",
    "删除", "独立", "范围", "计划", "方式", "后续", "相关", "明确", "结果", "已有",
    "过程", "判断", "开始", "现有", "理解", "参考", "说明", "操作", "保存", "建议",
    "选择", "输出", "处理", "情况", "重新", "默认",
    "原始", "刚刚", "一次", "用于", "我要", "觉得",
    # Structural tokens produced by paths, formats, and protocol payloads.
    "docs", "in", "md", "app", "main", "sessions", "file", "entries", "events", "source",
    "text", "line", "full",
    "the", "and", "for", "with", "this", "that", "from", "into", "please", "need",
    "want", "should", "would", "could", "have", "has", "just", "use", "using", "make",
    "actually", "must", "specific", "according", "however", "after", "all", "why", "every",
    "final", "other", "additionally", "before", "different", "separately", "also", "possible", "which", "same",
    "work", "keep", "status", "run", "information", "info", "time", "target", "failure", "failed",
    "check", "delete", "independent", "range", "plan", "plans", "way", "later", "related", "clear", "result",
    "existing", "process", "start", "understand", "reference", "explanation", "operation", "save", "suggestion",
    "select", "output", "handle", "situation", "retry", "default", "original", "once", "think",
    "is", "of", "files", "messageid", "startoffset", "endoffset", "ms", "user", "instructions", "head", "ok",
    "worker", "case", "src", "include", "comment", "array", "its", "response-annotations",
}


def extract_jsonl(path: Path, source: str) -> tuple[list[Message], int]:
    return read_source(source, path)


def normalize_for_dedupe(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"\s+", " ", normalized).strip()


def tokenize(text: str) -> list[str]:
    """Return normalized Chinese and Latin terms without punctuation noise."""
    cleaned = unicodedata.normalize("NFKC", text)
    cleaned = URL.sub(" ", cleaned)
    cleaned = ABSOLUTE_PATH.sub(" ", cleaned)
    cleaned = LONG_HASH.sub(" ", cleaned)
    tokens: list[str] = []
    for run in TOKEN_RUN.findall(cleaned):
        if re.fullmatch(r"[\u3400-\u9fff]+", run):
            if jieba is None:
                raise RuntimeError("请先安装依赖：python -m pip install -r requirements.txt")
            pieces = jieba.lcut(run, cut_all=False)
            tokens.extend(piece.strip() for piece in pieces if len(piece.strip()) >= 2)
        else:
            token = run.lower().strip("._+-")
            if (
                len(token) >= 2
                and not token.isdigit()
                and not re.search(r"\.(md|json|jsonl|yaml|yml|toml|txt|py|js|ts|tsx|css|html)$", token)
            ):
                tokens.append(token)
    return tokens


def _month(timestamp: str) -> str:
    match = re.match(r"(\d{4}-\d{2})", timestamp or "")
    return match.group(1) if match else "未知"


def _word_rows(
    counts: Counter[str],
    sources: dict[str, Counter[str]],
    months: dict[str, Counter[str]],
    top_n: int,
) -> list[dict]:
    rows = []
    for word, count in counts.most_common(top_n):
        rows.append(
            {
                "text": word,
                "count": count,
                "sources": dict(sorted(sources[word].items())),
                "months": dict(sorted(months[word].items())),
            }
        )
    return rows


def _generation_zone(timezone_name=None):
    if timezone_name:
        return ZoneInfo(timezone_name)
    from tzlocal import get_localzone
    return get_localzone()


def aggregate(messages: Iterable[Message], statuses: dict[str, SourceStatus], top_n: int = 600, timezone_name=None) -> dict:
    """Keep real repeated prompts, deduplicate copied events, and emit complete day buckets."""
    zone = _generation_zone(timezone_name)
    buckets = {}
    ids = set()
    copies = set()
    dates = []
    timestamps = []
    unique_count = 0
    unknown_count = 0
    raw_counts = Counter()
    raw_sources = defaultdict(Counter)
    raw_months = defaultdict(Counter)
    quality_counts = Counter()
    for message in messages:
        body_hash = hashlib.sha256(normalize_for_dedupe(message.text).encode('utf-8')).hexdigest()
        identity = (message.source, message.message_id) if message.message_id else None
        copy = (message.source, message.timestamp, body_hash) if message.timestamp else None
        if (identity and identity in ids) or (copy and copy in copies):
            continue
        if identity: ids.add(identity)
        if copy: copies.add(copy)
        day = 'unknown'
        try:
            stamp = datetime.fromisoformat(message.timestamp.replace('Z', '+00:00'))
            if stamp.tzinfo is None: stamp = stamp.replace(tzinfo=zone)
            stamp = stamp.astimezone(zone)
            day = stamp.date().isoformat()
            dates.append(day)
            timestamps.append(stamp.isoformat())
        except (ValueError, TypeError):
            unknown_count += 1
        unique_count += 1
        quality_counts[message.timestamp_quality] += 1
        terms = Counter(tokenize(message.text))
        key = (day, message.source)
        bucket = buckets.setdefault(key, {'day': day, 'source': message.source, 'messageCount': 0, 'words': Counter()})
        bucket['messageCount'] += 1
        bucket['words'].update(terms)
        raw_counts.update(terms)
        for term, count in terms.items():
            raw_sources[term][message.source] += count
            raw_months[term][day[:7] if day != 'unknown' else '未知'] += count
    refined = Counter({word:count for word,count in raw_counts.items() if word not in REFINED_STOPWORDS})
    return {
        'meta': {
            'schemaVersion': 2,
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'timezone': str(zone),
            'totalMessages': sum(s.messages for s in statuses.values()),
            'uniqueMessages': unique_count,
            'unknownDateMessages': unknown_count,
            'timestampQuality': dict(quality_counts),
            'rangeStart': min(timestamps) if timestamps else None,
            'rangeEnd': max(timestamps) if timestamps else None,
            'firstDay': min(dates) if dates else None,
            'lastDay': max(dates) if dates else None,
            'skippedRecords': sum(s.skipped for s in statuses.values()),
            'platform': sys.platform,
        },
        'sources': {name:asdict(status) for name,status in statuses.items()},
        'modes': {
            'raw': {'words':_word_rows(raw_counts,raw_sources,raw_months,top_n)},
            'refined': {'words':_word_rows(refined,raw_sources,raw_months,top_n)},
        },
        'stopwords': sorted(REFINED_STOPWORDS),
        'buckets': [dict(bucket,words=dict(sorted(bucket['words'].items()))) for _,bucket in sorted(buckets.items())],
    }


def write_snapshot(output: Path, payload: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(output)


def discover_sources(home: Path) -> dict[str, SourceStatus]:
    return scan_sources(home)[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('web/data.local.json'))
    parser.add_argument('--home', type=Path, default=Path.home())
    parser.add_argument('--top', type=int, default=600)
    parser.add_argument('--timezone', help='IANA 时区，例如 Asia/Shanghai，默认本机时区')
    parser.add_argument('--source', action='append', default=[], metavar='PRODUCT=PATH', help='显式指定产品的会话目录或标准消息 JSON')
    parser.add_argument('--project-root', action='append', type=Path, default=[], help='允许查找 Aider 历史的项目根目录')
    args = parser.parse_args()
    overrides = defaultdict(list)
    from adapters import CATALOG
    names = {a.name for a in CATALOG}
    for item in args.source:
        name, separator, path = item.partition('=')
        if not separator or name not in names or not path:
            parser.error('--source 必须是目录中的产品名=路径')
        overrides[name].append(Path(path))
    if jieba is None:
        parser.error('请先安装依赖：python -m pip install -r requirements.txt')
    # A specified home must not accidentally scan environment paths from another user.
    env = os.environ if args.home == Path.home() else {}
    messages, statuses = scan_sources(args.home, env=env, overrides=overrides, project_roots=args.project_root)
    payload = aggregate(messages, statuses, max(1,args.top), args.timezone)
    write_snapshot(args.output, payload)
    print(f"Wrote {args.output}: {payload['meta']['uniqueMessages']} unique messages, {len(payload['buckets'])} day/source buckets")
    for name,status in statuses.items():
        print(f'  {name}: {status.state} / {status.messages} messages / {status.files} files')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
