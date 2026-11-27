# 语言星云：跨平台、多来源、时间筛选

本设计已在对话中获用户确认；最新支持范围以本文为准。

## 目标与范围

保持静态网页、本地处理、仅统计本人用户消息。提供日、周、月、年、全部筛选，具体周期选择和上一/下一周期。周从周一开始，按生成时区划分；未知日期只能计入全部。

产品目录：TRAE CN、Codex、Claude Code、Gemini CLI、Cursor、Windsurf、Aider、GitHub Copilot Chat、Grok；国内工具加入豆包、DeepSeek、通义千问、Kimi、腾讯元宝、文心一言、智谱清言、讯飞星火，以及 Qwen Code、Kimi Code、CodeBuddy/WorkBuddy、Qoder。

目录覆盖不等于可读取：每个条目需区分未发现、可读但为空、部分可读、权限不足、加密、未知格式和没有已验证本地格式。禁止把登录态、草稿、工具输出或二进制缓存当成用户消息。Grok 网页与 Grok Build/CLI 的覆盖范围需明确区分。

## 架构

- `adapters.py`：跨平台路径、显式适配器目录、已知格式解析与详细诊断。
- `wordcloud_data.py`：公共分词与过滤、身份去重、按本机时区进行日级聚合、CLI。
- `web/data-model.mjs`：日/周/月/年边界与所选来源统计；独立 Node 测试。
- `web/app.js`：沿用语言星云视觉，动态来源颜色、周期控件、趋势、状态报告。
- `launch.py`、`start.sh`、`start.cmd`：三平台启动；先扫描当前用户，再启动仅监听本机的服务器。

保留 `meta/sources/modes` 兼容字段，新增按日期与来源的完整稀疏词频 buckets；时间筛选不依赖全局 Top 600。网页只嵌入聚合统计。分词使用安装后的 jieba；缺少依赖应明确提示，禁止用二元碎片生成假词云。

去重优先使用来源内稳定消息 ID；无 ID 使用时间戳和正文摘要，日期不同的相同提问保留。跨会话前缀复制通过相同 ID 或相同时间/文本识别；不再只按全文全局去重。

提供 `--source 产品=路径`、`--project-root 路径`、时区选项；只在已知应用目录和用户指定路径扫描。手动导入只接收已声明的消息结构，不能据任意 JSON 的 text 字段猜用户。

用户手动加入的“项目、文档”停用词保留并修复逗号；英文泛词扩展同属已有任务。

## 可读格式及边界

- Codex：rollout JSONL，包括用户事件；优先事件并排除子代理和注入。
- Claude Code/Qoder：明确 user 消息，排除 sidechain、tool_result、meta、compaction。
- Gemini CLI：完整会话 JSON 和事件 JSONL；处理 rewind 和元数据 patch。
- Qwen Code：message.parts 中非 thought 文本。
- CodeBuddy/WorkBuddy：user input_text，排除 providerData.skipRun 与系统/摘要标记。
- Cursor：IDE cursorDiskKV 中 type=1 的 bubble；CLI 明确 user 内容，缺失日期保持未知。
- GitHub Copilot Chat：已知 turns.user_message SQLite schema、chatSessions JSON，VS Code JSONL patch 回放；插件身份确认。
- Aider：session header 时间与 #### 用户行；识别代码围栏，不把助手 Markdown 当用户。
- Grok Build：ACP user_message_chunk 合并；网页 Grok 未验证存储明确报告。
- Windsurf/Trae CN：加密存储被发现则报告 encrypted；不假装完成解码。
- 国内网页助手：已安装应用探测和明确指定的 role/content 导入；原生协议未知时报告 unsupported_format。

## 验证与交付

三 OS 路径以注入平台与环境变量的测试验证；本机 macOS 真实数据验证，Windows/Linux 运行须标为未实机验证。每类解析器提供角色/工具排除、坏记录及空状态样本。日期测试覆盖时区跨日、跨年周、闰年、缺时间和重复提问。浏览器测试实际点击时间、模式、产品和搜索。便携压缩包不携带当前用户快照，首次启动读取运行机器数据。
