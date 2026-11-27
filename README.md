<h1 align="center">Promptprint</h1>

<p align="center"><strong>聊了什么 · 看见你与 AI 对话中的关注、习惯和变化。</strong></p>

<p align="center">
  <img alt="Python 3.10+" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white">
  <img alt="Vanilla JavaScript" src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black">
  <img alt="Local processing" src="https://img.shields.io/badge/Data-Local%20processing-7C6BB3">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能一览">功能一览</a> ·
  <a href="#支持的来源">支持的来源</a> ·
  <a href="#隐私与数据">隐私与数据</a> ·
  <a href="#开发与贡献">开发与贡献</a>
</p>

Promptprint 将 AI 客户端的本地对话记录整理成可交互词云、活跃日历和月／年回顾。你可以看看自己反复提起什么、比较两个时期的关注变化，再把当前词云或阶段回顾导出成图片。

**本地运行，无需账号、API Key 或模型服务。** 只统计能够可靠识别的用户文字，数据处理在你的电脑上完成。

![Promptprint 界面预览](assets/preview.png)

<p align="center"><sub>界面预览使用专门生成的演示数据，不包含真实对话或个人记录。</sub></p>

## 功能一览

| 功能 | 你可以做什么 |
| --- | --- |
| **交互词云** | 切换原始词频与主题提纯，搜索词语，点击查看频次、来源和趋势。 |
| **时间与来源筛选** | 按日、周、月、年或全部记录浏览，切换周期，选择参与统计的产品。 |
| **月／年回顾** | 查看消息数、活跃日、连续活跃天数、最常提起的词，以及相较上一周期的变化。 |
| **关注变化** | 比较两个日期区间，发现新出现、升温、降温和消失的词。 |
| **活跃日历** | 查看一年中的对话活动，点击日期打开当天的词云。 |
| **图片分享** | 导出词云，或生成正方形、竖版、横版的词云／回顾分享卡片。 |

界面适配桌面和手机，支持键盘操作与减少动画偏好；使用系统字体，运行时不加载在线字体。

## 快速开始

需要 **Python 3.10 或更高版本**。首次启动需要联网安装依赖，之后扫描与浏览无需连接聊天服务。

### macOS / Linux

```sh
git clone https://github.com/Elliottt001/promptprint.git
cd promptprint
./start.sh
```

### Windows

```bat
git clone https://github.com/Elliottt001/promptprint.git
cd promptprint
start.cmd
```

也可以下载仓库 ZIP，解压后在 macOS 上双击 `start.command`，Linux 运行 `start.sh`，Windows 双击 `start.cmd`。

启动脚本会创建项目内的虚拟环境、安装依赖、扫描当前用户的受支持记录，并打开浏览器。默认地址为 **[http://127.0.0.1:8765/](http://127.0.0.1:8765/)**；端口被占用时会自动选择空闲端口，以终端显示的地址为准。按 **Ctrl+C** 停止服务。

> 第一次打开没有数据？确认这台电脑上有受支持客户端的本地记录。仓库自带空快照，不附带任何人的对话数据。
>
> 已在 macOS 实机验证。Windows / Linux 提供启动脚本及路径测试，目前尚未完成实机验证。

## 支持的来源

支持范围取决于客户端版本和存储格式。能发现应用或数据库，并不代表能读取其中的消息。

| 产品 | 当前支持范围 |
| --- | --- |
| **Codex** | CLI / Desktop 的本地 rollout JSONL 会话，包括归档会话。 |
| **Claude Code** | 本地 projects JSONL 会话；过滤子代理、工具结果及已识别的自动注入内容。 |
| **Gemini CLI** | 本地会话 JSON / JSONL，支持会话回退记录。 |
| **Cursor** | 已适配的 IDE SQLite 用户消息，以及 CLI agent-transcripts JSONL。 |
| **GitHub Copilot Chat** | 已适配的 VS Code chatSessions 和 Copilot SQLite 用户消息。 |
| **Qwen Code** | 本地 projects/chats JSONL 用户消息。 |
| **Kimi Code** | 本地 wire.jsonl 中明确来自用户的消息。 |
| **CodeBuddy / WorkBuddy** | 已适配的本地 projects JSONL 用户消息。 |
| **DeepSeek Harness** | 默认 JSONL 存储的 v0–v4 会话，包括 Zstandard 压缩日志；自定义 SQLite 存储未适配。 |
| **Grok** | Grok Build 的本地 ACP 会话；网页对话需转换为标准消息 JSON 后导入。 |
| **TRAE CN** | 支持标准消息 JSON 导入。**加密应用数据库当前不支持读取。** |

未发现记录、权限不足、加密或未知格式会如实报告，无法读取的消息不会进入统计。当前只统计文字，不统计图片、附件或 AI 回复。

### 手动导入

对于 TRAE CN、Grok 和 DeepSeek Harness，可以导入以下标准 JSON。它是 Promptprint 的导入格式；客户端原生导出文件可能需要先转换。

```json
{
  "id": "conversation-1",
  "messages": [
    {
      "id": "message-1",
      "role": "user",
      "content": "我想做一个交互式可视化项目",
      "timestamp": "2026-01-15T10:00:00+08:00"
    },
    {
      "role": "assistant",
      "content": "这条回复不会参与统计"
    }
  ]
}
```

将文件放入对应目录，随后重新启动：

| 来源 | 自动导入目录 |
| --- | --- |
| TRAE CN | `~/.ai-wordcloud/imports/trae/*.json` |
| Grok | `~/.ai-wordcloud/imports/grok/*.json` |
| DeepSeek Harness | `~/.ai-wordcloud/imports/deepseek-harness/*.json` |

也可以显式指定文件或会话目录：

```sh
.venv/bin/python launch.py --source "TRAE=./export.json"
.venv/bin/python launch.py --source "Codex=/path/to/sessions"
```

Windows 使用 `.venv\Scripts\python.exe`。TRAE CN 的命令行产品名为 `TRAE`；`--source` 可重复。标准导入也接受会话对象数组，或 `{"conversations": [...]}`。

## 隐私与数据

- **在本机处理**：不上传对话，不调用模型 API，不读取登录凭据或浏览器 Cookie。
- **只读源文件**：扫描已知应用目录和明确指定的路径，不修改客户端记录。
- **只保存聚合结果**：词频、日期、来源统计及读取诊断写入 `web/data.local.json`，不保存完整对话原文。该文件已由 Git 忽略。
- **默认仅监听本机**：服务绑定 `127.0.0.1`；仓库中的 `web/data.json` 始终为空快照。
- **分享内容由你选择**：分享卡片不包含原始对话、文件路径或读取诊断，来源信息默认关闭。

词语、日期和来源统计仍可能透露个人关注内容。分享图片前请检查可见文字，也不要公开本机聚合文件或手动导入的原始记录。

### 统计口径

只统计可靠识别的用户正文。去重优先使用消息 ID，其次使用来源、时间和正文摘要；不同日期重复发出的提问会保留。

日期按本机时区归入日／周／月／年，周一为每周起点；缺少时间的消息只进入“全部”。中文使用 Jieba 分词，英文转小写。主题提纯通过停用词过滤泛词，原始模式保留这些词。

关注变化按词频占比比较：两个区间各至少 5 条消息，候选词至少在一边出现 3 次。记录不足时会显示说明。活跃日历中的空白表示没有读取到记录。

## 更多用法

在启动脚本后追加参数，或使用虚拟环境中的 Python 运行 `launch.py`：

| 参数 | 用途 |
| --- | --- |
| `--no-scan` | 复用现有本机快照。 |
| `--no-browser` | 启动服务，但不自动打开浏览器。 |
| `--generate-only` | 只扫描并生成数据，不启动服务。 |
| `--port 9000` | 指定首选端口。 |
| `--timezone Asia/Shanghai` | 指定统计时区。 |
| `--source "产品=路径"` | 指定某个受支持产品的会话文件或目录。 |
| `--home /path/to/home` | 使用指定用户目录；不会继承当前用户的应用路径环境变量。 |

DeepSeek Harness 默认扫描 `~/.dsh/sessions`，可通过 `DSH_HOME` 切换存储位置。

### 打包分享

```sh
.venv/bin/python package_portable.py
```

生成 `dist/ai-dialogue-wordcloud-portable.zip`。压缩包包含运行文件和空快照，首次启动扫描接收者自己的电脑；使用者仍需安装 Python。

## 开发与贡献

后端使用 Python 标准库完成扫描和本地服务；前端使用原生 JavaScript、SVG 和 Canvas。运行依赖为 Jieba、时区库，以及旧版 Python 所需的 Zstandard 支持，无需 Node 构建步骤。

```sh
# Python 与浏览器测试
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v

# 前端逻辑测试，需要 Node.js
node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs tests/share.test.mjs
node --check web/app.js
```

浏览器测试使用 Playwright 和本机安装的 Google Chrome；缺少依赖或浏览器时会跳过相关测试。

欢迎通过 [Issues](https://github.com/Elliottt001/promptprint/issues) 反馈问题，或提交 Pull Request。报告读取问题时，请附上操作系统、客户端版本及脱敏后的格式样例；不要上传原始对话、登录凭据或个人快照。

<details>
<summary>格式参考</summary>

- [Claude Code 会话文档](https://code.claude.com/docs/en/sessions)
- [Gemini CLI 会话管理](https://geminicli.com/docs/cli/session-management/)
- [VS Code chatSessionStore](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts)
- [DeepSeek Harness JSONL 存储实现](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/session/session-persistence-jsonl)
- [deja-vu 公开格式目录](https://vshulcz.github.io/deja-vu/guide/harnesses.html)

</details>
