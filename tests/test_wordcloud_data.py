import json
import tempfile
import unittest
from pathlib import Path

from wordcloud_data import (
    Message,
    SourceStatus,
    aggregate,
    clean_user_text,
    discover_sources,
    extract_jsonl,
    normalize_for_dedupe,
    tokenize,
)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.fixture = Path(self.tempdir.name) / "rollout.jsonl"
        rows = [
            {
                "type": "session_meta",
                "payload": {"id": "conversation-1", "timestamp": "2026-11-26T08:00:00Z"},
            },
            {
                "timestamp": "2026-11-26T08:01:00Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "developer",
                    "content": [{"type": "input_text", "text": "never include me"}],
                },
            },
            {
                "timestamp": "2026-11-26T08:02:00Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "<environment_context><cwd>/private/path</cwd></environment_context>\n"
                                "请实现词云\n"
                                "<turn_aborted>old turn stopped</turn_aborted>"
                            ),
                        }
                    ],
                },
            },
            {
                "timestamp": "2026-11-26T08:03:00Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "never include me"}],
                },
            },
            {
                "timestamp": "2026-11-26T08:04:00Z",
                "type": "response_item",
                "payload": {"type": "function_call", "role": "user", "content": "tool data"},
            },
        ]
        with self.fixture.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            handle.write("{malformed json\n")

    def tearDown(self):
        self.tempdir.cleanup()

    def test_extract_jsonl_keeps_only_clean_user_text(self):
        messages, skipped = extract_jsonl(self.fixture, "Codex")

        self.assertEqual([message.text for message in messages], ["请实现词云"])
        self.assertEqual(messages[0].source, "Codex")
        self.assertEqual(messages[0].conversation_id, "conversation-1")
        self.assertEqual(messages[0].timestamp, "2026-11-26T08:02:00Z")
        self.assertEqual(skipped, 1)

    def test_clean_user_text_removes_injected_blocks(self):
        text = (
            "真实问题"
            "<system-reminder>generated reminder</system-reminder>"
            "<environment_context>generated context</environment_context>"
        )

        self.assertEqual(clean_user_text(text), "真实问题")

    def test_extract_jsonl_skips_subagent_prompts(self):
        subagent = Path(self.tempdir.name) / "subagent.jsonl"
        rows = [
            {
                "type": "session_meta",
                "payload": {
                    "id": "child-thread",
                    "source": {"subagent": {"thread_spawn": {"depth": 1}}},
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "agent-authored delegation"}],
                },
            },
        ]
        subagent.write_text(
            "".join(json.dumps(row) + "\n" for row in rows),
            encoding="utf-8",
        )

        messages, skipped = extract_jsonl(subagent, "Codex")

        self.assertEqual(messages, [])
        self.assertEqual(skipped, 0)

    def test_extract_jsonl_skips_generated_skill_payloads(self):
        generated = Path(self.tempdir.name) / "generated-skill.jsonl"
        rows = [
            {"type": "session_meta", "payload": {"id": "generated-context"}},
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": "<skill><name>tooling</name><path>/tmp/tooling/SKILL.md</path>" + "generated " * 400,
                    }],
                },
            },
        ]
        generated.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

        messages, skipped = extract_jsonl(generated, "Codex")

        self.assertEqual(messages, [])
        self.assertEqual(skipped, 0)

    def test_discover_sources_reports_current_machine_states(self):
        home = Path(self.tempdir.name)
        (home / ".codex" / "sessions").mkdir(parents=True)
        encrypted = home / "Library/Application Support/Trae CN/ModularData/ai-agent/database.db"
        encrypted.parent.mkdir(parents=True)
        encrypted.write_bytes(b"not a readable sqlite database")

        statuses = discover_sources(home)

        self.assertNotIn("Trae", statuses)
        self.assertNotIn("Trae CN", statuses)
        self.assertEqual(statuses["TRAE"].state, "encrypted")
        self.assertEqual(statuses["Codex"].state, "absent")


class AggregationTests(unittest.TestCase):
    APPROVED_REFINED_STOPWORDS = {
        "实际", "就是", "必须", "通过", "具体", "按照", "部分", "不是", "但是", "之后",
        "全部", "存在", "对应", "为什么", "包含", "每个", "的话", "主要", "最终", "其他",
        "另外", "之前", "不同", "分别", "还有", "可能", "哪些", "一样", "作为",
        "工作", "保留", "状态", "运行", "信息", "时间", "目标", "失败", "核对", "检查",
        "删除", "独立", "范围", "计划", "方式", "后续", "相关", "明确", "结果", "已有",
        "过程", "判断", "开始", "现有", "理解", "参考", "说明", "操作", "保存", "建议",
        "选择", "输出", "处理", "情况", "重新", "默认",
        "原始", "刚刚", "一次", "用于", "我要", "觉得",
        "docs", "in", "md", "app", "main", "sessions", "file", "entries", "events", "source",
        "text", "line", "full",
    }

    def setUp(self):
        self.messages = [
            Message("TRAE", "tr-1", "2026-10-01T08:00:00Z", "我们需要一个文件 词云 Codex"),
            Message("Codex", "cx-1", "2026-10-02T08:00:00Z", "我们需要一个文件 词云 Codex"),
            Message("Codex", "cx-2", "2026-11-03T08:00:00Z", "词云 数据可视化 Python"),
        ]
        self.statuses = {
            "TRAE": SourceStatus("TRAE", "available", "fixture", files=1, messages=1),
            "Trae CN": SourceStatus("Trae CN", "encrypted", "encrypted"),
            "Codex": SourceStatus("Codex", "available", "fixture", files=1, messages=2),
        }

    @staticmethod
    def words(result, mode):
        return {item["text"]: item for item in result["modes"][mode]["words"]}

    def test_normalize_for_dedupe_ignores_spacing_and_case(self):
        self.assertEqual(
            normalize_for_dedupe("  Codex   词云 "),
            normalize_for_dedupe("codex 词云"),
        )

    def test_tokenize_preserves_chinese_and_latin_terms(self):
        tokens = tokenize("词云 Python 数据可视化")

        self.assertIn("词云", tokens)
        self.assertIn("python", tokens)

    def test_aggregate_builds_distinct_raw_and_refined_modes(self):
        result = aggregate(self.messages, self.statuses)
        raw = self.words(result, "raw")
        refined = self.words(result, "refined")

        self.assertIn("需要", raw)
        self.assertNotIn("需要", refined)
        self.assertEqual(raw["词云"]["count"], 3)
        self.assertEqual(raw["词云"]["sources"], {"Codex": 2, "TRAE": 1})
        self.assertEqual(raw["词云"]["months"], {"2026-10": 2, "2026-11": 1})

        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("original_text", serialized)
        self.assertEqual(set(result), {"meta", "sources", "modes", "stopwords", "buckets"})

    def test_refined_mode_removes_operational_filler_only(self):
        messages = [Message("Codex", "cx", "2026-11-03T08:00:00Z", "当前 任务 执行 数据可视化")]

        result = aggregate(messages, self.statuses)
        raw = self.words(result, "raw")
        refined = self.words(result, "refined")

        self.assertTrue({"当前", "任务", "执行"} <= set(raw))
        self.assertFalse({"当前", "任务", "执行"} & set(refined))
        self.assertTrue({"数据", "可视化"} <= set(refined))

    def test_refined_mode_removes_approved_filler_but_keeps_topics(self):
        topics = {"词云", "数据", "代码", "figma", "api"}
        text = " ".join(sorted(self.APPROVED_REFINED_STOPWORDS | topics))
        messages = [Message("Codex", "cx", "2026-11-03T08:00:00Z", text)]

        result = aggregate(messages, self.statuses)
        raw = self.words(result, "raw")
        refined = self.words(result, "refined")

        self.assertTrue(self.APPROVED_REFINED_STOPWORDS <= set(raw))
        self.assertFalse(self.APPROVED_REFINED_STOPWORDS & set(refined))
        self.assertTrue(topics <= set(refined))

    def test_aggregate_reports_source_states_and_unique_message_count(self):
        result = aggregate(self.messages, self.statuses)

        self.assertEqual(result["meta"]["uniqueMessages"], 3)
        self.assertEqual(result["sources"]["Trae CN"]["state"], "encrypted")
        self.assertEqual(result["sources"]["Codex"]["messages"], 2)


if __name__ == "__main__":
    unittest.main()


class CalendarAggregationTests(unittest.TestCase):
    def test_preserves_same_prompt_on_different_days(self):
        messages=[Message('Codex','c','2026-01-01T10:00:00Z','词云'),Message('Codex','c','2026-01-02T10:00:00Z','词云')]
        result=aggregate(messages,{},timezone_name='UTC')
        self.assertEqual(result['meta']['uniqueMessages'],2)
        self.assertEqual([b['day'] for b in result['buckets']],['2026-01-01','2026-01-02'])

    def test_stable_id_deduplicates_forked_prefix(self):
        result=aggregate([Message('Codex','a','2026-01-01','词云','u'),Message('Codex','fork','2026-01-01','词云','u')],{},timezone_name='UTC')
        self.assertEqual(result['meta']['uniqueMessages'],1)

    def test_midnight_timezone_unknown_and_full_vocabulary(self):
        result=aggregate([Message('Codex','c','2026-01-01T23:30:00Z','词云 python'),Message('Codex','c','','figma')],{},top_n=1,timezone_name='Asia/Shanghai')
        self.assertEqual({b['day'] for b in result['buckets']},{'2026-01-02','unknown'})
        known=next(b for b in result['buckets'] if b['day']!='unknown')
        self.assertEqual(set(known['words']),{'词云','python'})
        self.assertEqual(result['meta']['unknownDateMessages'],1)

    def test_user_stopwords_and_english_variants(self):
        result=aggregate([Message('Codex','c','2026-01-01','项目 文档 实际 work status files instructions figure figma api')],{},timezone_name='UTC')
        raw={r['text'] for r in result['modes']['raw']['words']}
        refined={r['text'] for r in result['modes']['refined']['words']}
        self.assertTrue({'项目','文档','work','status','files'}<=raw)
        self.assertFalse({'项目','文档','实际','work','status','files','instructions'} & refined)
        self.assertTrue({'figma','api'}<=refined)
