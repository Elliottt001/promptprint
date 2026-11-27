# Portable AI Word Cloud Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. No delegation is authorized.

**Goal:** Provide portable local scans, honest adapter coverage and accurate calendar filters.
**Architecture:** Explicit product catalog normalizes messages; Python writes full daily sparse counts; pure JS selects calendar periods and sources; native launcher regenerates before serving.
**Tech Stack:** Python 3.10+, jieba, SQLite stdlib, HTML/CSS/JS, Node built-in test runner.
**Spec:** docs/superpowers/specs/2026-11-26-portable-adapters-design.md

## Global constraints

Read only source files. Never scan browser cookies or arbitrary files. Keep project/document user stopwords. No backend API or network scan. Distinguish catalog entries from verified readable formats. Preserve repeated real prompts across dates. Local artifacts may include aggregate data; portable distribution must contain an empty snapshot.

## Task 1: Adapters and extraction

Files: adapters.py; tests/test_adapters.py; wordcloud_data.py.
Interface: Adapter catalog; platform_paths(home, platform, env); scan_sources -> (messages,statuses); Message(source,conversation_id,timestamp,text,message_id,timestamp_quality).

- [x] Create synthetic real-schema fixtures for rollout event user messages, Claude/Qoder tool-result exclusion, Gemini rewind, Qwen thought exclusion, CodeBuddy meta exclusion, Cursor SQLite bubble type, Copilot turns and patch log, Aider fenced user lines, Grok chunk joining.
- [x] Run `.venv/bin/python -m unittest tests.test_adapters -v`; verify missing adapter implementation failure.
- [x] Implement only the documented record shapes and platform paths; report unreadable inputs individually; SQLite use `mode=ro`.
- [x] Run adapter tests and inspect actual source counts, no raw message printing.

```python
messages,statuses = scan_sources(Path.home(), platform=sys.platform, overrides={})
assert all(s.state in VALID_STATES for s in statuses.values())
```

## Task 2: Date buckets and stopwords

Files: wordcloud_data.py; tests/test_wordcloud_data.py.
Interface: aggregate(messages,statuses,timezone_name=None), buckets(day,source,words,messageCount); meta timezone.

- [x] Add failing tests for same-body new-day preservation, duplicated IDs across forks, midnight conversion, unknown timestamps, project/document stops and English variants.
- [x] Run focused tests before updating aggregation.
- [x] Canonicalize identity, count each distinct occurrence, preserve full daily vocabulary, keep raw and refined modes compatible; JSON writes atomically.
- [x] Run all Python tests and generate actual snapshot.

```python
result = aggregate([Message('Codex','c','2026-01-01T23:30:00Z','词云')],{},timezone_name='Asia/Shanghai')
assert result['buckets'][0]['day'] == '2026-01-02'
```

## Task 3: Calendar and source UI

Files: web/data-model.mjs; web/app.js; web/index.html; web/styles.css; tests/data-model.test.mjs.
Interface: periodBounds(kind,anchor), selectPeriod(data,state), filterWords(data,state).

- [x] Write `node --test tests/data-model.test.mjs` tests for Monday weeks, year crossing, leap month, one-day-only words and source totals; watch fail.
- [x] Implement pure calendar helpers with UTC arithmetic over local date strings; select buckets before top-N.
- [x] Add five-option time selector, anchor input, previous/next buttons, period label and detailed source report; use CSS/source palette dynamically.
- [x] Test search, mode, source/period changes and per-period trends in browser; screen reader labels and reduced motion remain.

```js
assert.deepEqual(periodBounds('week','2026-01-01'), {start:'2025-12-29',end:'2026-01-05'});
```

## Task 4: Portable launch and delivery

Files: launch.py; start.sh; start.cmd; README.md; tests/test_launcher.py; web/data.json.

- [x] Write isolated-home launch fixture test so no developer home is read.
- [x] Launch regenerates before serving `127.0.0.1`, uses available port, opens browser; `--no-scan`, `--no-browser` allow explicit control.
- [x] Shell/CMD scripts create project-local venv and install requirements, execute launcher from script directory.
- [x] Update product support matrix with format evidence links and test limitations; CLI import contract documented.
- [x] Run `.venv/bin/python -m unittest discover -s tests -v`, `node --test tests/data-model.test.mjs`, `node --check web/app.js`, JSON and diff checks.
- [x] Build ZIP with tracked runtime files and empty data.json; inspect ZIP privacy and startup contract; commit owned source changes and report real data counts.

## 完成验证

2026-11-26：40 项 Python 测试、7 项 Node 日期测试通过；Chrome 实测桌面/手机周期选择、来源筛选、搜索、词详情、PNG 下载。Windows/Linux 路径使用模拟平台测试，尚未实机验证。便携 ZIP 空快照检查通过。Claude SDK 自动活动摘要排除。
