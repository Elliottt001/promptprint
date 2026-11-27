# 聊了什么 · Promptprint

AI 对话记录的词云与统计。

在 macOS、Windows、Linux 上扫描已知 AI 客户端的本地会话，只统计可靠识别的用户正文。网页提供“主题提纯 / 原始词频”、日/周/月/年/全部、上一/下一周期、产品筛选、搜索、词语趋势和 PNG 导出。

## 个人回顾与分析

- **月／年回顾**：选择自然月或自然年，查看消息数、活跃日、最长连续活跃、并列最活跃日期、Top 5 词与来源分布。提供与上一周期的变化，以及查看该周期词云的入口。
- **关注变化**：选择两个起止日期均包含当天的区间，或使用本周／上周、本月／上月、本年／上年的快捷选项。按词频占比展示新出现、升温、降温和消失的词；快捷周期以快照截止日为基准。
- **活跃日历**：按年查看已读取消息数量；周一在上方，支持鼠标和键盘选择日期并切到当天词云。未来日期单独显示，空白只表示没有读取到记录。
- **记录来源**：用产品名称组成词云，大小对应已读取的消息数量；悬浮或聚焦名称可查看消息数，包括 0 条消息的产品。页面不展示文件数、路径、读取详情或来源口径。
- **分享卡片**：点击“生成分享卡片”打开选项弹窗，选择当前词云或月／年回顾、标题、信息和图片尺寸后，直接下载 PNG。支持正方形 1080×1080、竖版 1080×1920 和横版 1600×1000。来源信息默认关闭；卡片不包含来源路径、读取诊断或对话原文。原有词云导出按钮仍可直接下载。

分析统一使用完整有效词表，搜索与 Top 数量只影响词云展示。关注变化仍按词频占比判断新出现、升温、降温和消失，结果只显示“词语 · 之前次数 → 之后次数”。比较两边各至少需要 5 条消息，候选词至少在一边出现 3 次；每类最多 10 个词。少于门槛或没有有效词时保留基础统计并说明原因。

词云、回顾、分析、详情和导出使用原始聚合与主题模式停用词。产品差异、隐藏词、别名词组与个人设置入口已移除；浏览器中旧的个人规则不再参与统计。回顾卡片使用整个回顾周期的词表，词云卡片遵循当前搜索和 Top 选择。

界面采用浅紫色个人观察工作台：首屏交互词云、实时高频词与来源占比、侧栏导航，以及回顾、比较、日历、记录来源词云和分享选项弹窗。移动端使用横向导航；字体来自系统，页面不请求在线字体。统计功能不依赖模型 API 或新的运行依赖。

## 启动

需要 Python 3.10 或更高版本。首次启动需要网络安装 Python 依赖；扫描和浏览过程不上传数据。

- macOS / Linux：在项目目录运行 `./start.sh`。
- Windows：双击 `start.cmd`，或在终端运行 `start.cmd`。

脚本创建项目内 `.venv`，安装 jieba、tzlocal、tzdata，扫描当前登录用户的记录，再启动仅监听 `127.0.0.1` 的服务器并打开浏览器。按 Ctrl+C 停止。8765 端口被占用时会选择空闲端口，启动输出中显示真实 URL。

已有虚拟环境也可直接使用：

```sh
.venv/bin/python launch.py
# Windows: .venv\Scripts\python.exe launch.py
```

手动扫描与指定路径：

```sh
python wordcloud_data.py --output web/data.local.json --timezone Asia/Shanghai
python launch.py --source "Codex=/path/to/sessions" --source "DeepSeek Harness=/path/to/session.v4.jsonl.zstd"
```

`--source` 可重复，产品名必须与目录中一致。只扫描目录中所列产品的已知应用目录和明确指定目录。DeepSeek Harness 默认读取 `~/.dsh/sessions`；设置 `DSH_HOME` 可切换到 SDK 或自定义 home，也可用 `--source` 指定会话日志或目录。

其他启动选项：`--no-scan` 明确复用现有快照，`--no-browser` 不打开浏览器，`--generate-only` 只生成，`--home` 读取指定用户目录。指定其他 home 时不继承当前用户的应用路径环境变量。

## 支持目录与边界

参与统计的产品固定为下表 11 个。“进入目录”表示能探测并报告状态，不表示所有版本的加密格式都能读取。DeepSeek Harness 当前适配默认 JSONL 后端；自定义 SQLite 后端尚未适配。压缩读取在 Python 3.14+ 使用标准库，Python 3.10–3.13 由启动脚本安装 zstandard。

| 产品 | 已实现的正文读取与范围 |
|---|---|
| TRAE | 探测 TRAE CN 的应用数据库；加密数据库或未适配格式如实报告状态，可手动导入标准消息 JSON |
| Codex | CLI/Desktop sessions / archived_sessions rollout JSONL |
| Claude Code | projects JSONL；排除 sidechain、tool_result、meta、能力注入、已识别的 SDK 自动活动摘要 |
| Gemini CLI | 完整会话 JSON、JSONL；处理 rewind 控制记录 |
| Cursor | IDE cursorDiskKV 的 type=1 bubble；CLI agent-transcripts 明确 user 消息 |
| GitHub Copilot Chat | VS Code chatSessions JSON/JSONL patch 回放、Copilot turns.user_message SQLite |
| Grok | Grok Build 的 ACP updates.jsonl；网页 Grok 无已验证本地正文协议，可手动导入标准消息 JSON；grok-dev 的 grok.db 尚未适配 |
| Qwen Code | ~/.qwen/projects/*/chats JSONL 的 user message.parts；thought 不计入 |
| Kimi Code | ~/.kimi-code/sessions/*/*/agents/main/wire.jsonl；仅真人 origin 的 context.append_message |
| CodeBuddy / WorkBuddy | .codebuddy、.workbuddy、.workbuddy-ai 的 projects JSONL；排除 skipRun、meta、compaction |
| DeepSeek Harness | `~/.dsh/sessions` 或 `$DSH_HOME/sessions` 下的 v0–v4 JSONL / Zstd 日志；只计 `user/message` 中 `source.kind=user` 的正文；排除子代理与继承前缀，选择最新格式版本 |

自动读取状态包括：可读取、部分可读取、会话为空、未发现、权限不足、已加密、格式未适配、无已验证本地格式、读取失败。具体路径和诊断保留在本地数据快照中；网页记录来源只展示产品名称和消息数量，不能读取的来源不进入词频。未知格式不按任意 `text` 字段猜用户。

### 手动导入协议

只接受以下结构；它不是“任意产品原生导出文件”的保证。可将已导出的文件转换成这个明确角色的格式后指定路径。图片、附件和 AI 回复不统计。

```json
{
  "id": "conversation-1",
  "messages": [
    {"id": "user-1", "role": "user", "content": "用户本人发出的文字", "timestamp": "2026-11-26T10:00:00+08:00"},
    {"role": "assistant", "content": "不会统计"}
  ]
}
```

也支持 `{"conversations":[上述会话对象]}` 或会话对象数组。自动导入目录是 `~/.ai-wordcloud/imports/<slug>/*.json`，支持标准消息导入的目录为 `trae`、`grok` 和 `deepseek-harness`。目录会主动指定产品归属，不扫描下载目录或浏览器缓存。

TRAE CN 默认探测 `Trae CN/ModularData/ai-agent/database.db`，位置分别在 macOS 的 `~/Library/Application Support`、Windows 的 `%APPDATA%` 和 Linux 的 `$XDG_CONFIG_HOME`（默认 `~/.config`）下。当前不支持解密或读取未知数据库结构；发现数据库不代表已提取消息。

## 时间与去重口径

按生成机器的 IANA 时区将消息聚合到日。每周从周一到周日；月、年使用日历边界。无日期的消息只进入“全部”。DeepSeek Harness 使用事件的毫秒时间；来源缺失时间时不会拿文件修改时间伪造提问日期。

去重优先使用稳定消息 ID；没有 ID 使用来源、时间和正文摘要识别复制记录。不同日期的相同提问保留。每条独立消息贡献实际词频，来源占比和消息数量均按当前选择的产品/周期计算。

日级聚合保留完整有效词表，再在网页选定周期后截取 Top N。全局 Top 600 兼容字段不作为时间筛选的输入。分词使用 Jieba 精确模式，英文转小写；不做英文词干合并。主题模式对中英文停用词做精确匹配，包含用户指定的“项目、文档”；原始模式保留泛词。

## 隐私与便携包

所有源文件只读；SQLite 使用 `mode=ro`。不读取登录凭据，不连接聊天服务，不把完整对话原文写入网页。生成的 `web/data.local.json` 仅包含词频、时间/来源聚合与路径诊断，已由 Git 忽略；启动服务器通过原有数据 URL 提供本机快照，仓库中的 `web/data.json` 保持为空。

仓库和便携 ZIP 均提供空快照，首次启动重新扫描目标机器。生成的本机统计快照仅用于本地浏览，不提交到仓库。

```sh
python package_portable.py
```

输出 `dist/ai-dialogue-wordcloud-portable.zip`。

## 验证

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs tests/share.test.mjs
node --check web/app.js
node --check web/features-ui.mjs
node --check web/share.mjs
node --check web/cloud-layout.mjs
```

浏览器测试使用已安装的 Chrome 和 Playwright；没有测试依赖/浏览器则显示跳过，不冒充通过。Windows/Linux 路径通过模拟平台、环境变量和临时目录验证；当前实机扫描和交互验证在 macOS 完成，Windows/Linux 尚未实机验证。

格式依据：

- [Claude Code 官方会话文档](https://code.claude.com/docs/en/sessions)
- [Gemini CLI 官方会话管理](https://geminicli.com/docs/cli/session-management/)
- [VS Code chatSessionStore](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts) 与 [objectMutationLog](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/objectMutationLog.ts)
- [DeepSeek Harness 官方 JSONL 存储实现](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence-jsonl)：核对格式版本、压缩、会话头与用户消息来源。
- [deja-vu 公开格式目录](https://vshulcz.github.io/deja-vu/guide/harnesses.html)：用于核对 Cursor/Grok/Qwen/Kimi/CodeBuddy 等 schema；运行时不依赖或调用该服务。
