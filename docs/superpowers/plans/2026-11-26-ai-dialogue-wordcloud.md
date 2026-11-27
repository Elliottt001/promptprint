# AI Dialogue Word Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, privacy-preserving interactive webpage for supported public AI products with switchable refined and raw word-frequency modes. TRAE CN's encrypted database is unsupported; accept explicit standard message imports.

**Architecture:** A Python CLI streams JSONL session files, extracts explicit user-role text, removes injected metadata, deduplicates messages, tokenizes Chinese and English text, and writes a compact aggregate JSON snapshot. A framework-free static page renders that snapshot as an animated SVG word cloud with filters, search, detail trends, summary cards, and PNG export.

**Tech Stack:** Python 3 standard library, `jieba` for Chinese tokenization, `unittest`, semantic HTML, CSS, browser-native JavaScript/SVG/Canvas.

**Spec:** `docs/superpowers/specs/2026-11-26-ai-dialogue-wordcloud-design.md`

## Global Constraints

- Read source files only; never edit TRAE CN or Codex state.
- Include only explicit user-role message content; exclude assistant, developer, system, tool, reasoning, logs, and auto-injected environment blocks.
- Process locally and emit aggregates only; never place complete message text in the website data.
- Provide both `refined` and `raw` frequency datasets from one normalized token stream.
- Report TRAE CN as encrypted or absent when no plain message store can be parsed; do not infer message text from drafts, command logs, encrypted bytes, or unrelated metadata.
- Use no frontend framework or backend service.

---

### Task 1: User-message extraction and source diagnostics

**Files:**
- Create: `wordcloud_data.py`
- Create: `tests/test_wordcloud_data.py`

**Interfaces:**
- Produces: `Message(source: str, conversation_id: str, timestamp: str, text: str)` dataclass.
- Produces: `extract_jsonl(path: Path, source: str) -> tuple[list[Message], int]`, where the integer counts malformed lines.
- Produces: `clean_user_text(text: str) -> str`.
- Produces: `discover_sources(home: Path) -> dict[str, SourceStatus]`.

- [ ] **Step 1: Write failing extraction tests**

Create `tests/test_wordcloud_data.py` with `unittest` cases using a temporary JSONL file containing `session_meta`, user, assistant, developer, and tool items. Assert that only user `input_text` is returned, `environment_context` and `<turn_aborted>` blocks are removed, and malformed lines increase the skipped count.

```python
def test_extract_jsonl_keeps_only_clean_user_text(self):
    messages, skipped = extract_jsonl(self.fixture, "Codex")
    self.assertEqual([message.text for message in messages], ["请实现词云"])
    self.assertEqual(skipped, 1)
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `python3 -m unittest tests.test_wordcloud_data.ExtractionTests -v`

Expected: import failure because `wordcloud_data.py` does not exist.

- [ ] **Step 3: Implement streaming extraction and diagnostics**

Implement JSONL parsing without loading whole files into memory. Read session metadata for the conversation id, then accept only records matching:

```python
item.get("type") == "response_item"
and item.get("payload", {}).get("type") == "message"
and item["payload"].get("role") == "user"
```

Join only `content` entries whose type is `input_text`. Strip XML blocks named `environment_context`, `system-reminder`, and `turn_aborted`. Define `SourceStatus` with `name`, `state`, `detail`, `files`, and `messages` fields. Discovery must open sources read-only and label the encrypted Trae CN `database.db` as unreadable rather than attempting to decode it.

- [ ] **Step 4: Run extraction tests**

Run: `python3 -m unittest tests.test_wordcloud_data.ExtractionTests -v`

Expected: all extraction tests pass.

- [ ] **Step 5: Commit extraction support**

```bash
git add wordcloud_data.py tests/test_wordcloud_data.py
git commit -m "feat: extract local user conversation messages"
```

### Task 2: Deduplication, tokenization, and aggregation

**Files:**
- Modify: `wordcloud_data.py`
- Modify: `tests/test_wordcloud_data.py`
- Create: `requirements.txt`

**Interfaces:**
- Consumes: `Message` records from Task 1.
- Produces: `normalize_for_dedupe(text: str) -> str`.
- Produces: `tokenize(text: str) -> list[str]` using `jieba.lcut` plus normalized Latin tokens.
- Produces: `aggregate(messages: Iterable[Message], statuses: dict[str, SourceStatus], top_n: int = 600) -> dict`.
- Produces: CLI `python3 wordcloud_data.py --output web/data.local.json`.

- [ ] **Step 1: Write failing aggregation tests**

Add tests asserting that duplicate normalized messages count once while merging their source sets, raw mode retains `需要` and `文件`, refined mode removes them, product counts remain separate, month buckets use `YYYY-MM`, and the JSON contains no original message body field.

```python
def test_aggregate_builds_distinct_raw_and_refined_modes(self):
    result = aggregate(self.messages, self.statuses)
    self.assertIn("需要", words(result, "raw"))
    self.assertNotIn("需要", words(result, "refined"))
    serialized = json.dumps(result, ensure_ascii=False)
    self.assertNotIn("original_text", serialized)
    self.assertEqual(set(result), {"meta", "sources", "modes"})
```

- [ ] **Step 2: Run aggregation tests and confirm failure**

Run: `python3 -m unittest tests.test_wordcloud_data.AggregationTests -v`

Expected: failure because aggregation functions are missing.

- [ ] **Step 3: Implement minimal aggregation**

Add `jieba>=0.42.1,<0.43` to `requirements.txt`. Normalize Unicode with NFKC, lowercase Latin text, remove URLs, absolute paths, long hashes, and code-only tokens. Maintain a focused refined stopword set containing generic Chinese request verbs, pronouns, structural words, and English conversational fillers while preserving named technologies and project terms.

Each word object must have this shape:

```json
{
  "text": "词云",
  "count": 42,
  "sources": {"Claude Code": 30, "Codex": 12},
  "months": {"2026-10": 8, "2026-11": 34}
}
```

The top-level payload must contain `meta`, `sources`, and `modes.raw.words` / `modes.refined.words`. Write JSON atomically through a temporary file followed by `Path.replace`.

- [ ] **Step 4: Run all data tests**

Run: `python3 -m unittest discover -s tests -v`

Expected: all tests pass.

- [ ] **Step 5: Commit aggregation support**

```bash
git add wordcloud_data.py tests/test_wordcloud_data.py requirements.txt
git commit -m "feat: aggregate dual-mode conversation word frequencies"
```

### Task 3: Interactive language-starfield webpage

**Files:**
- Create: `web/index.html`
- Create: `web/styles.css`
- Create: `web/app.js`
- Create: `web/data.json`
- Create: `tests/test_web_contract.py`

**Interfaces:**
- Consumes: `web/data.json` contract from Task 2.
- Produces: `filterWords(data, state) -> Word[]`.
- Produces: `layoutWords(words, width, height) -> PositionedWord[]`.
- Produces: page controls with stable ids `mode-toggle`, `source-filters`, `word-limit`, `word-search`, `export-png`, `word-cloud`, and `detail-panel`.

- [ ] **Step 1: Write failing static contract tests**

Create `tests/test_web_contract.py` using `unittest`, `html.parser`, and text inspection. Assert required control ids, accessible labels, module script loading, reduced-motion CSS, and the expected JavaScript function names.

```python
def test_page_exposes_required_controls(self):
    ids = parsed_ids(WEB / "index.html")
    self.assertTrue(REQUIRED_IDS <= ids)
```

- [ ] **Step 2: Run web contract tests and confirm failure**

Run: `python3 -m unittest tests.test_web_contract -v`

Expected: failure because `web/index.html` does not exist.

- [ ] **Step 3: Implement semantic page shell and visual system**

Build a responsive dashboard with a compact header, summary cards, segmented mode toggle, filter toolbar, main SVG cloud, and a slide-in detail panel. Use a dark navy background, cyan/violet/coral word palette, subtle radial glows, grain-like CSS texture, glass panels, and system Chinese fonts. Add visible focus states, `aria-live` status, button labels, and `prefers-reduced-motion` handling.

- [ ] **Step 4: Implement deterministic word-cloud interaction**

Fetch `data.json`, filter by selected sources and query, scale font sizes logarithmically, then place words on a seeded golden-angle spiral while rejecting bounding-box overlap. Render words as focusable SVG buttons. Switching modes or filters must animate opacity and transform, but skip animation when reduced motion is requested.

Clicking a word populates product-share bars and an SVG month sparkline. Implement Top 40–160 range control, search highlighting, responsive relayout with a debounced `ResizeObserver`, empty/error states, and canvas-based PNG export that preserves the current background and visible words.

- [ ] **Step 5: Add a schema-valid placeholder snapshot and run tests**

Create an empty-but-valid `web/data.json` so the page has a deterministic empty state before real generation.

Run: `python3 -m unittest discover -s tests -v`

Expected: all tests pass.

- [ ] **Step 6: Commit the webpage**

```bash
git add web tests/test_web_contract.py
git commit -m "feat: add interactive language starfield webpage"
```

### Task 4: Real snapshot generation, documentation, and end-to-end verification

**Files:**
- Modify: `web/data.json`
- Create: `README.md`
- Create: `.gitignore`

**Interfaces:**
- Consumes: generator and webpage from Tasks 1–3.
- Produces: a ready-to-view static snapshot served by `python3 -m http.server 8765 -d web`.

- [ ] **Step 1: Install the one runtime dependency locally**

Run: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`

Expected: `jieba` installs successfully without modifying global Python.

- [ ] **Step 2: Generate the real aggregate snapshot**

Run: `.venv/bin/python wordcloud_data.py --output web/data.local.json`

Expected: exit code 0; source states reflect the supplied fixtures; encrypted TRAE CN data is not parsed; no source file is modified.

- [ ] **Step 3: Add usage and privacy documentation**

Document setup, regeneration, serving, and browser-opening commands. Source data is read-only; encrypted TRAE CN databases are unsupported. Ignore `.venv/`, Python caches, and `web/data.local.json`; keep only an empty `web/data.json` placeholder versioned.

- [ ] **Step 4: Run automated verification**

Run:

```bash
python3 -m unittest discover -s tests -v
.venv/bin/python wordcloud_data.py --output /tmp/ai-dialogue-wordcloud-data.json
python3 -m json.tool web/data.json >/dev/null
git diff --check
```

Expected: all tests pass, generator exits 0, JSON validates, and no whitespace errors appear.

- [ ] **Step 5: Run browser smoke verification**

Start: `python3 -m http.server 8765 -d web`

Open `http://127.0.0.1:8765/` and verify mode switching, source toggles, limit control, search, word details, responsive relayout, and PNG download. Confirm the page does not make network requests beyond local `index.html`, `styles.css`, `app.js`, and `data.json`.

- [ ] **Step 6: Commit the finished snapshot and docs**

```bash
git add README.md .gitignore web/data.json
git commit -m "docs: ship local word cloud snapshot and usage guide"
```
