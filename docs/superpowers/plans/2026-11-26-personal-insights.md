# 语言星云个人回顾与关注分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline to implement this plan task-by-task. No delegation is authorized. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成用户确认的回顾、关注变化、活跃日历、产品对比、分享卡片和个人词语设置六项功能，沿用现有视觉。

**Architecture:** Python 保持只读扫描和 schemaVersion=2 日／产品聚合。浏览器先统一应用个人规则，再由纯函数生成分析；页面和分享绘制消费同一结果。个人设置使用浏览器存储和版本化 JSON 迁移，不新增 API。

**Tech Stack:** Python 3.10+、现有 jieba/tzlocal/tzdata、原生 HTML/CSS/ES modules、Node 内置 test runner、现有 Python unittest 与 Playwright/Chrome。

**Spec:** `docs/superpowers/specs/2026-11-26-personal-insights-design.md`（用户已确认）。

**Status:** 已于 2026-11-26 执行全部九项任务。52 项 Python 测试与 23 项 Node 测试通过，Chrome 交互实测通过，便携包空快照检查通过。执行事实见文末。

## Global Constraints

- 源文件只读，只统计现有适配器可靠识别的用户消息。
- 不增加 AI 回复、原始对话正文、用户画像模型或网络上传。
- 复用完整的日／产品词频 buckets，不用全局 Top 600 作为分析输入。
- 继续按快照时区解释日期，不使用浏览器时区重新划分消息。
- 日期未知的消息只进入“全部时间”的词语和产品统计，不进入日期区间、回顾或热力图。
- 消息数、活跃天数和连续活跃天数按原始去重消息计算，不受词语规则影响。
- 隐藏词和别名合并统一影响所有词语统计与导出；搜索和 Top 只影响词云展示。
- 候选词至少在一边出现 3 次；变化比较两个区间各至少 5 条消息；产品比较至少 5 条消息且有有效词。
- 三种导出尺寸为 1080×1080、1080×1920、1600×1000；自定义标题最多 80 个字符，来源信息默认关闭。
- 个人设置导出仅含 schemaVersion、hiddenWords、aliasGroups、productLabels，不含词频、路径、消息、筛选或身份。
- 导入成功整体替换并可撤销，失败不更改现有设置；重扫不删除规则。
- 本轮完成可操作入口、基础预览和导出；整体视觉、页面重排、动效和模板精细设计下一轮处理。
- 在线演示、GitHub 发布、更多适配器、词云形状、新配色不属于本轮。
- 不新增运行依赖，不改 Python 扫描器、源文件或个人 `web/data.json`；若证据要求改数据协议，先报告接口影响。
- 便携包始终使用空快照并包含全部新运行模块。
- 在执行开始时使用 using-git-worktrees 技能检查隔离需求；本计划编写不创建工作树。不要丢弃用户 WIP，不宽泛暂存，不提交个人快照。
- 单代理顺序执行；每个任务通过相关测试再提交；中间提交只针对完成的文件。
- Windows/Linux 路径模拟验证与实机验证分开报告；不把旧测试通过当作新功能通过。

## 文件与职责

| 文件 | 变化与职责 |
|---|---|
| `web/settings.mjs` | 新增；设置结构、校验、词组操作、保存、导入导出、一步撤销 |
| `web/data-model.mjs` | 扩展；保留原日历 API，增加任意区间和统一规则聚合 |
| `web/insights.mjs` | 新增；日期指标、比较、产品分析和回顾纯函数 |
| `web/features-ui.mjs` | 新增；六项功能必要控件与文本呈现，不接管现有词云渲染 |
| `web/cloud-layout.mjs` | 新增；从 app.js 提取现有文字布局供 SVG 与分享复用 |
| `web/share.mjs` | 新增；分享内容构造、同一路径预览和 PNG 绘制 |
| `web/app.js` | 对接个人设置与功能入口，保留现有筛选和词详情 |
| `web/index.html`, `web/styles.css` | 添加基础表单、结果区域、日历和预览；保留现有品牌及主要结构 |
| `tests/settings.test.mjs`, `tests/insights.test.mjs`, `tests/share.test.mjs` | 新增纯逻辑测试 |
| `tests/data-model.test.mjs` | 扩展共享聚合和日历回归 |
| `tests/test_personal_features.py`, `tests/test_share_browser.py` | 新增合成数据浏览器测试 |
| `tests/test_web_contract.py`, `tests/test_package.py` | 扩展控件和便携文件验证 |
| `package_portable.py`, `README.md` | 新模块分发、用法与统计边界 |

文件提取只服务共享功能；不把 app.js 整体改写成新的应用框架。

## 统一接口合同

以下都是拟新增／扩展的接口；不要假定当前仓库已实现。

```js
// settings.mjs
// Settings={schemaVersion:1, hiddenWords:string[],
// aliasGroups:{canonical:string,members:string[]}[], productLabels:Record<string,string>}
export const emptySettings = () => ({schemaVersion:1, hiddenWords:[], aliasGroups:[], productLabels:{}});
export const normalizeTerm = text => text.normalize('NFKC').trim().toLowerCase();
// normalizeSettings(value):Settings；错误抛 Error；拒绝未知顶层字段和别名冲突。
// changeSettings(settings, action):Settings；action 见 Task 1，不修改输入。
// createSettingsStore(storage, key='lingua-orbit.settings.v1'):
// {get(), error(), canUndo(), replace(value), undo(), serialize()}
// replace/undo 返回 {settings:Settings,persisted:boolean,error:string|null}；
// error() 返回启动加载错误或最后保存错误，无法保存仍更新内存。

// data-model.mjs：保留 periodBounds(kind,anchor)、shiftAnchor(kind,anchor,direction)
// rangeBounds({start,end}):{start:string,end:string}，输入 inclusive，输出 exclusive。
// selectRange(data,{sources:Set<string>,mode:'raw'|'refined',settings?:Settings,
// range:null|{start:string,end:string},trend:'day'|'month'}):Selection
// selectPeriod(data,state):Selection，兼容旧调用，并转接 selectRange。
// Selection={words:Word[],messageCount,unknownMessages,firstDay,lastDay,start,end,
// tokenCount,days:{day,messageCount}[],sourceMessages:Record<string,number>}
// Word={text,count,sources:Record<string,number>,months:Record<string,number>}

// insights.mjs
// snapshotDay(meta):string|null；generatedAt 按 meta.timezone 格式化，无生成时间回退 lastDay。
// activitySummary(selection):{messageCount,activeDays,longestStreak,peakCount,peakDays:string[]}
// heatmapYear(data,{year,sources,cutoffDay}):{cells:Cell[],summary:Activity}
// Cell={day,messageCount,level:0|1|2|3|4,future:boolean,weekday:0..6,weekIndex:number}
// comparisonRanges(kind,anchor):{a:InclusiveRange,b:InclusiveRange}
// compareRanges(data,{a,b,sources,mode,settings}):Comparison
// Comparison={status:'ok'|'low_sample'|'no_words'|'no_change',a:Selection,b:Selection,
// groups:{new:Change[],rising:Change[],falling:Change[],disappeared:Change[]}}
// Change={text,countA,countB,shareA,shareB,delta}，delta 为百分点。
// productInsights(data,{range,sources,mode,settings}):ProductAnalysis
// ProductAnalysis={eligibleSources:string[],products:Product[],common:Word[],unique:Word[]}
// Product={source,label,messageCount,tokenCount,status:'eligible'|'low_sample'|'no_words',
// topWords:Word[],representatives:{text,count,share,otherShare,delta}[]}
// buildRecap(data,{kind:'month'|'year',anchor,sources,mode,settings}):Recap
// Recap={status:'ok'|'empty'|'no_words',range,cutoffDay,partial,selection,activity,
// topWords:Word[],products:ProductAnalysis,comparison:Comparison,sentences:string[]}

// features-ui.mjs
// mountFeatures({data,getState,settingsStore,onSettingsChange,onRefresh,selectDay,selectPeriod,sourceColor,notify}):
// {refresh(),getRecap()}
// getState():{period,anchor,sources,mode,query,limit}；settingsStore 使用 Task 1 合同。
// onSettingsChange():void，由 app.js 关闭旧词详情并重算词云。
// onRefresh():void，同步分享预览；selectPeriod(kind,anchor):void，打开回顾周期词云。

// cloud-layout.mjs
// layoutWords(words,width,height,measureText):PlacedWord[]
// PlacedWord 扩展 Word：{filteredCount,x,y,width,height,fontSize,dominant}
// measureText(text,fontSize):number；DOM Canvas 由调用方传入。

// share.mjs
// ShareOptions={kind:'cloud'|'recap',size:'square'|'portrait'|'landscape',title,
// showRange:boolean,showMessages:boolean,showTopWords:boolean,showSources:boolean}
// createShareContent({selection,recap,visibleWords,rangeLabel,settings},options):ShareContent
// ShareContent 仅含 {kind,title,rangeLabel,messageCount,words,topWords,sources,summary}；
// sources:{name,label,messageCount}[]，从白名单字段构造，不复制 meta/source diagnostics。
// drawShare(canvas,content,options,colorForSource):{width,height,wordCount,drawnTexts:string[]}
// canvasToPng(canvas):Promise<Blob>；失败 reject Error。
```

日期范围里的 end 一律 inclusive；仅 Selection.start/end 是内部排他边界。所有 UI 调用按此合同，不能重复减一天或二次合并。排序使用次数／占比与词名明确的比较器，保留旧 Word.months 字段兼容详情趋势。

---

### Task 1: 可迁移、可撤销的个人设置

**Files:** Create `web/settings.mjs`, `tests/settings.test.mjs`.

**Interfaces:** 消费版本化 JSON 和可注入 Storage；产出 normalizeSettings、changeSettings、createSettingsStore，供全部后续任务使用。

- [x] **Step 1: 添加真实行为的失败测试。**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptySettings,normalizeSettings,changeSettings,createSettingsStore} from '../web/settings.mjs';
const memory = () => {
  const map=new Map();
  return {getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,v)};
};
test('组隐藏在解除合并后保留；恢复和撤销可还原',()=>{
  const storage=memory(),store=createSettingsStore(storage);
  const merged=changeSettings(store.get(),{type:'putAlias',canonical:'飞书',members:['飞书','Feishu']});
  store.replace(merged);
  store.replace(changeSettings(store.get(),{type:'hide',word:'飞书'}));
  assert.deepEqual(store.get().hiddenWords,['feishu','飞书']);
  store.replace(changeSettings(store.get(),{type:'removeAlias',canonical:'飞书'}));
  assert.equal(store.get().aliasGroups.length,0);
  assert.deepEqual(store.get().hiddenWords,['feishu','飞书']);
  store.undo();assert.equal(store.get().aliasGroups.length,1);
  assert.deepEqual(createSettingsStore(storage).get(),store.get());
});
test('导入拒绝冲突和统计字段，失败保留设置',()=>{
  const store=createSettingsStore(memory());
  assert.throws(()=>store.replace({...emptySettings(),buckets:[]}));
  assert.throws(()=>normalizeSettings({...emptySettings(),aliasGroups:[
    {canonical:'a',members:['a','b']},{canonical:'c',members:['c','b']}
  ]}));
  assert.deepEqual(store.get(),emptySettings());
  const serialized=JSON.parse(store.serialize());
  assert.deepEqual(Object.keys(serialized).sort(),['aliasGroups','hiddenWords','productLabels','schemaVersion']);
});
test('存储失败仍更新内存并可导出；禁止加载坏文件',()=>{
  const store=createSettingsStore({getItem:()=>null,setItem:()=>{throw new Error('quota');}});
  const result=store.replace(changeSettings(store.get(),{type:'label',source:'Codex',label:'写代码'}));
  assert.equal(result.persisted,false);
  assert.equal(JSON.parse(store.serialize()).productLabels.Codex,'写代码');
  const broken=createSettingsStore({getItem:()=>'{bad',setItem:()=>{}});
  assert.deepEqual(broken.get(),emptySettings());assert.ok(broken.error());
});
```

- [x] **Step 2: 运行失败测试。** `node --test tests/settings.test.mjs`，预期新模块不存在导致失败；记录失败原因。
- [x] **Step 3: 实现规范化、动作和持久化。**

动作合同固定为 hide(word)、restore(word)、restoreAllHidden、putAlias(canonical,members)、removeAlias(canonical)、label(source,label)、reset。restore 对组清除所有成员隐藏；reset 返回 emptySettings；putAlias 替换同名组前移除旧组，再校验新组与其余组。标签空字符串删除该标签，产品名称保留原身份，不做小写归一；标签最多 80 字符。

```js
export const emptySettings=()=>({schemaVersion:1,hiddenWords:[],aliasGroups:[],productLabels:{}});
export const normalizeTerm=text=>text.normalize('NFKC').trim().toLowerCase();
// normalizeSettings 内先执行以下边界，再逐项验证 string、组成员归属与标签。
function validateEnvelope(value) {
  if (!value || Array.isArray(value) || typeof value!=='object' || value.schemaVersion!==1)
    throw new Error('不支持的个人设置版本');
  const allowed=new Set(['schemaVersion','hiddenWords','aliasGroups','productLabels']);
  if (Object.keys(value).some(key=>!allowed.has(key))) throw new Error('设置文件包含未知字段');
  if (!Array.isArray(value.hiddenWords) || !Array.isArray(value.aliasGroups) ||
      !value.productLabels || Array.isArray(value.productLabels) || typeof value.productLabels!=='object')
    throw new Error('个人设置结构无效');
}
// 每组 canonical 自动加入 members，归一化、去重、排序后至少 2 项。
// owner 是 Map；验证所有代表词和成员只归属一个组。
function groupMembers(settings,word) {
  const normalized=normalizeTerm(word);
  return settings.aliasGroups.find(g=>g.members.includes(normalized))?.members ?? [normalized];
}
// hide/restore 动作采用同一组成员集合，避免解除合并后隐藏丢失。
function hiddenAfter(settings,word,restore=false) {
  const hidden=new Set(settings.hiddenWords);
  for (const member of groupMembers(settings,word)) restore ? hidden.delete(member) : hidden.add(member);
  return [...hidden].sort();
}
```

实现 createSettingsStore 的最小闭包：current、previous、lastError；get 返回深拷贝，replace 先完整校验再替换，previous 仅保存最近一次有效修改；undo 消费 previous，失败修改不覆盖 previous；序列化只构造合同四字段。读／写存储分别捕获异常，序列化按 normalizeSettings 输出。不要把模块顶层绑定到 window.localStorage，以便存储被禁止时仍能初始化。

- [x] **Step 4: 补上失败分支和规范化断言，再运行。**

```js
test('NFKC、英文大小写、未来词及未出现产品标签可迁移',()=>{
  const settings=normalizeSettings({...emptySettings(),aliasGroups:[
    {canonical:'飞书',members:['飞书',' Ｆｅｉｓｈｕ ']}
  ],productLabels:{FutureApp:'学习'}});
  assert.deepEqual(settings.aliasGroups[0].members,['feishu','飞书']);
  assert.equal(settings.productLabels.FutureApp,'学习');
  assert.throws(()=>normalizeSettings({...emptySettings(),schemaVersion:2}));
  assert.throws(()=>normalizeSettings({...emptySettings(),aliasGroups:[{canonical:'a',members:['a',' ']}]}));
});
```

运行 `node --test tests/settings.test.mjs`；验证坏存储加载不被静默覆盖、合法导入可撤销、恢复默认清空标签但不改外部快照。

- [x] **Step 5: 提交通过的设置模块。**

```sh
git add web/settings.mjs tests/settings.test.mjs
git commit -m "feat: add portable personal word settings"
```

### Task 2: 共享词语规则、任意区间和活跃日历

**Files:** Modify `web/data-model.mjs`, `tests/data-model.test.mjs`; Create `web/insights.mjs`, `tests/insights.test.mjs`.

**Interfaces:** 消费 Task 1 Settings 和原 buckets；产出 Selection、rangeBounds、snapshotDay、activitySummary、heatmapYear。保留所有旧日历 API 和 Word 字段。

- [x] **Step 1: 添加共享规则与消息独立性的失败测试。**

```js
// 添加到 tests/data-model.test.mjs，复用该文件现有 test/assert import。
import {selectRange,rangeBounds} from '../web/data-model.mjs';
import {emptySettings} from '../web/settings.mjs';
test('别名合并来源和趋势；隐藏不改变消息与日期',()=>{
  const data={stopwords:['work'],buckets:[
    {day:'2026-01-01',source:'Codex',messageCount:5,words:{飞书:3,python:6,work:3}},
    {day:'2026-01-02',source:'Claude Code',messageCount:5,words:{feishu:3,figma:6,work:3}},
    {day:'unknown',source:'Codex',messageCount:2,words:{undated:2}}
  ]};
  const settings={...emptySettings(),aliasGroups:[{canonical:'飞书',members:['飞书','feishu']}]};
  const state={sources:new Set(['Codex','Claude Code']),mode:'refined',settings,range:null,trend:'day'};
  const selected=selectRange(data,state),word=selected.words.find(w=>w.text==='飞书');
  assert.equal(selected.messageCount,12);assert.equal(selected.tokenCount,20);
  assert.deepEqual(word.sources,{'Codex':3,'Claude Code':3});
  assert.deepEqual(word.months,{'2026-01-01':3,'2026-01-02':3});
  const hidden=selectRange(data,{...state,settings:{...settings,hiddenWords:['feishu']}});
  assert.equal(hidden.words.some(w=>w.text==='飞书'),false);
  assert.equal(hidden.messageCount,selected.messageCount);assert.deepEqual(hidden.days,selected.days);
  const range=selectRange(data,{...state,range:{start:'2026-01-02',end:'2026-01-02'}});
  assert.equal(range.messageCount,5);assert.equal(range.unknownMessages,0);
  assert.throws(()=>rangeBounds({start:'2026-02-30',end:'2026-03-01'}));
  assert.throws(()=>rangeBounds({start:'2026-03-01',end:'2026-02-01'}));
});
```

```js
// tests/insights.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDay,activitySummary,heatmapYear} from '../web/insights.mjs';
import {selectRange} from '../web/data-model.mjs';
test('跨日截止、闰日、并列高峰、断开连续与未来格子',()=>{
  const meta={generatedAt:'2024-02-29T17:00:00Z',timezone:'Asia/Shanghai',lastDay:'2024-02-29'};
  assert.equal(snapshotDay(meta),'2024-03-01');
  const data={stopwords:[],buckets:[
    {day:'2024-02-28',source:'Codex',messageCount:5,words:{python:3}},
    {day:'2024-02-29',source:'Codex',messageCount:5,words:{python:3}},
    {day:'2024-03-02',source:'Codex',messageCount:1,words:{python:1}},
    {day:'unknown',source:'Codex',messageCount:2,words:{undated:2}}
  ]};
  const sources=new Set(['Codex']);
  const activity=activitySummary(selectRange(data,{sources,mode:'raw',range:{start:'2024-01-01',end:'2024-12-31'},trend:'day'}));
  assert.equal(activity.longestStreak,2);assert.equal(activity.activeDays,3);
  assert.deepEqual(activity.peakDays,['2024-02-28','2024-02-29']);
  const heatmap=heatmapYear(data,{year:2024,sources,cutoffDay:'2024-03-01'});
  assert.equal(heatmap.cells.length,366);
  assert.equal(heatmap.cells.find(c=>c.day==='2024-03-02').future,true);
  assert.equal(heatmap.cells.find(c=>c.day==='2024-02-29').level,2);
  assert.equal(heatmap.summary.messageCount,10); // 截止日之后的桶不计入热力图指标。
});
```

- [x] **Step 2: 运行并确认失败。** `node --test tests/data-model.test.mjs tests/insights.test.mjs`；预期新 export 缺失，旧 7 个日期测试继续作为回归。
- [x] **Step 3: 实现聚合与日期函数。**

在 data-model.mjs 复用 dateFromISO，增加 rangeBounds 和 selectRange。selectPeriod 使用现有 periodBounds，转换排他 end 为 inclusive，再调用 selectRange；all 使用 null。内部先按 source、日期计消息和 day map，再转换词，最后构造排序 Word 数组、tokenCount、sourceMessages；不能让词过滤跳过消息计数。

```js
export function rangeBounds(range) {
  const start=dateFromISO(range.start),last=dateFromISO(range.end);
  if (start>last) throw new Error('起始日期不能晚于结束日期');
  last.setUTCDate(last.getUTCDate()+1);
  return {start:iso(start),end:iso(last)};
}
// selectRange 内，normalizeSettings(state.settings ?? emptySettings()) 后：
function termTransform(settings,stopwords,mode) {
  const aliases=new Map(),hidden=new Set(settings.hiddenWords);
  for (const group of settings.aliasGroups) {
    const suppressed=group.members.some(member=>hidden.has(member));
    for (const member of group.members) aliases.set(member,{canonical:group.canonical,suppressed});
  }
  return original=>{
    const term=normalizeTerm(original),group=aliases.get(term),canonical=group?.canonical ?? term;
    if (group?.suppressed || hidden.has(term) || (mode==='refined' && stopwords.has(canonical))) return null;
    return canonical;
  };
}
// insights.mjs：保持 UTC 日期运算，只格式化快照时间时使用 IANA 时区。
export function snapshotDay(meta) {
  if (!meta.generatedAt) return meta.lastDay ?? null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:meta.timezone ?? 'UTC',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(meta.generatedAt));
  const get=type=>parts.find(part=>part.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
```

activitySummary 用升序有消息日期和 shiftAnchor('day',previous,1) 比较计算 streak，不包含 unknown。heatmapYear 遍历自然年每一天，level 按 0/1–4/5–9/10–19/20+ 分级；weekday=(getUTCDay()+6)%7，weekIndex 按年初到本年第一格的周一偏移计算。future 日期保留格子但数量展示无记录状态，不计 summary；cutoffDay 为 null 时不猜今天，格子统一 future=true、summary 为零，并呈现未生成快照状态。

- [x] **Step 4: 补齐边界并运行回归。**

```js
// tests/data-model.test.mjs
test('个人合并后的代表词参与系统停用词匹配，输入不可变',()=>{
  const data={stopwords:['work'],buckets:[{day:'2026-01-01',source:'Codex',messageCount:5,words:{workflow:3,work:3}}]};
  const before=JSON.stringify(data);
  const settings={...emptySettings(),aliasGroups:[{canonical:'work',members:['work','workflow']}]};
  const args={sources:new Set(['Codex']),settings,range:null,trend:'month'};
  assert.equal(selectRange(data,{...args,mode:'raw'}).words[0].count,6);
  assert.equal(selectRange(data,{...args,mode:'refined'}).words.length,0);
  assert.equal(JSON.stringify(data),before);
  assert.equal(selectRange(data,{...args,mode:'raw',sources:new Set()}).messageCount,0);
});
```

运行 `node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs`；检查无设置时旧 selectPeriod 返回词、来源、趋势均兼容，月份／年份仍用月趋势，日／周／月使用日趋势。

- [x] **Step 5: 提交共享聚合和日历计算。**

```sh
git add web/data-model.mjs web/insights.mjs tests/data-model.test.mjs tests/insights.test.mjs
git commit -m "feat: unify word rules and calendar activity metrics"
```

### Task 3: 任意区间的关注变化

**Files:** Modify `web/insights.mjs`, `tests/insights.test.mjs`.

**Interfaces:** 消费 Task 2 selectRange、rangeBounds、periodBounds、shiftAnchor；产出 comparisonRanges、compareRanges 和 Comparison。

- [x] **Step 1: 写占比、公平比较和门槛测试。**

```js
// tests/insights.test.mjs 追加 import 与测试。
import {comparisonRanges,compareRanges} from '../web/insights.mjs';
test('不同次数相同占比不升温，新增消失和降温互斥',()=>{
  const data={stopwords:[],buckets:[
    {day:'2026-01-01',source:'Codex',messageCount:5,words:{steady:3,gone:3,cooling:6}},
    {day:'2026-02-01',source:'Codex',messageCount:10,words:{steady:6,fresh:12,cooling:6}}
  ]};
  const args={a:{start:'2026-01-01',end:'2026-01-01'},b:{start:'2026-02-01',end:'2026-02-01'},sources:new Set(['Codex']),mode:'raw'};
  const result=compareRanges(data,args);
  assert.equal(result.status,'ok');
  assert.deepEqual(result.groups.new.map(w=>w.text),['fresh']);
  assert.deepEqual(result.groups.disappeared.map(w=>w.text),['gone']);
  assert.deepEqual(result.groups.falling.map(w=>w.text),['cooling']);
  assert.equal(Object.values(result.groups).flat().some(w=>w.text==='steady'),false);
  assert.equal(compareRanges(data,{...args,b:{start:'2026-03-01',end:'2026-03-31'}}).status,'low_sample');
  assert.equal(compareRanges(data,{...args,settings:{schemaVersion:1,hiddenWords:['steady','gone','cooling','fresh'],aliasGroups:[],productLabels:{}}}).status,'no_words');
});
test('快捷区间跨年周正确，起止都包含当天',()=>{
  assert.deepEqual(comparisonRanges('week','2026-01-01'),{
    a:{start:'2025-12-22',end:'2025-12-28'},b:{start:'2025-12-29',end:'2026-01-04'}
  });
  assert.deepEqual(comparisonRanges('month','2024-03-31').a,{start:'2024-02-01',end:'2024-02-29'});
});
```

- [x] **Step 2: 确认失败。** `node --test tests/insights.test.mjs`，失败应由新函数不存在造成。
- [x] **Step 3: 实现快捷区间和分类。**

```js
export const MIN_MESSAGES=5,MIN_WORD_COUNT=3,CHANGE_LIMIT=10;
export function comparisonRanges(kind,anchor) {
  if (!['week','month','year'].includes(kind)) throw new Error('不支持的快捷周期');
  const inclusive=value=>({start:value.start,end:shiftAnchor('day',value.end,-1)});
  return {a:inclusive(periodBounds(kind,shiftAnchor(kind,anchor,-1))),b:inclusive(periodBounds(kind,anchor))};
}
export function compareRanges(data,{a,b,sources,mode,settings}) {
  const args={sources,mode,settings,trend:'day'};
  const left=selectRange(data,{...args,range:a}),right=selectRange(data,{...args,range:b});
  const result={status:'ok',a:left,b:right,groups:{new:[],rising:[],falling:[],disappeared:[]}};
  if (left.messageCount<MIN_MESSAGES || right.messageCount<MIN_MESSAGES) return {...result,status:'low_sample'};
  if (!left.tokenCount || !right.tokenCount) return {...result,status:'no_words'};
  const countA=new Map(left.words.map(w=>[w.text,w.count])),countB=new Map(right.words.map(w=>[w.text,w.count]));
  for (const text of new Set([...countA.keys(),...countB.keys()])) {
    const x=countA.get(text) ?? 0,y=countB.get(text) ?? 0;
    if (Math.max(x,y)<MIN_WORD_COUNT) continue;
    const shareA=x/left.tokenCount,shareB=y/right.tokenCount;
    // 通过整数交叉乘法判相等；不要比较四舍五入后的百分比。
    const cross=y*left.tokenCount-x*right.tokenCount;
    const kind=!x?'new':!y?'disappeared':cross>0?'rising':cross<0?'falling':null;
    if (kind) result.groups[kind].push({text,countA:x,countB:y,shareA,shareB,delta:(shareB-shareA)*100});
  }
  for (const kind of Object.keys(result.groups)) result.groups[kind]=result.groups[kind]
    .sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta) || Math.max(y.countA,y.countB)-Math.max(x.countA,x.countB) || x.text.localeCompare(y.text,'zh-CN'))
    .slice(0,CHANGE_LIMIT);
  if (!Object.values(result.groups).some(rows=>rows.length)) result.status='no_change';
  return result;
}
```

- [x] **Step 4: 增加重叠与低频回归并验证。**

```js
test('重叠相同区间没有变化，低频词不入榜',()=>{
  const data={stopwords:[],buckets:[{day:'2026-01-01',source:'Codex',messageCount:5,words:{python:3,tiny:1}}]};
  const interval={start:'2026-01-01',end:'2026-01-31'};
  const result=compareRanges(data,{a:interval,b:interval,sources:new Set(['Codex']),mode:'raw'});
  assert.equal(result.status,'no_change');
  assert.deepEqual(Object.values(result.groups).flat(),[]);
});
```

运行 `node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs`；验证 raw/refined、别名和隐藏在两边统一生效，并且显示 delta 的单位为百分点。

- [x] **Step 5: 提交比较逻辑。**

```sh
git add web/insights.mjs tests/insights.test.mjs
git commit -m "feat: compare attention across arbitrary date ranges"
```

### Task 4: 产品代表词和共同／独有词

**Files:** Modify `web/insights.mjs`, `tests/insights.test.mjs`.

**Interfaces:** 消费 selectRange 和 Settings.productLabels；产出 productInsights、ProductAnalysis。不按标签重新分配产品消息。

- [x] **Step 1: 写产品相对频率与资格测试。**

```js
import {productInsights} from '../web/insights.mjs';
test('代表词使用占比，独有只对符合门槛的所选产品成立',()=>{
  const data={stopwords:[],buckets:[
    {day:'2026-01-01',source:'Codex',messageCount:50,words:{python:30,common:30,generic:90}},
    {day:'2026-01-01',source:'Claude Code',messageCount:5,words:{figma:6,common:3,generic:6}},
    {day:'2026-01-01',source:'Cursor',messageCount:1,words:{python:1}}
  ]};
  const sources=new Set(['Codex','Claude Code','Cursor']);
  const result=productInsights(data,{sources,mode:'raw',range:null});
  assert.deepEqual(result.eligibleSources,['Codex','Claude Code']);
  assert.equal(result.products.find(p=>p.source==='Claude Code').representatives[0].text,'figma');
  assert.equal(result.products.find(p=>p.source==='Cursor').status,'low_sample');
  assert.deepEqual(result.common.map(w=>w.text),['generic','common']);
  assert.deepEqual(result.unique.map(w=>w.text),['python','figma']);
  const only=productInsights(data,{sources:new Set(['Codex']),mode:'raw',range:null});
  assert.deepEqual(only.products[0].representatives,[]);assert.deepEqual(only.unique,[]);
});
```

- [x] **Step 2: 确认失败。** `node --test tests/insights.test.mjs`。
- [x] **Step 3: 实现产品计算。**

遍历 sources 的原有顺序，对每个单产品调用 selectRange；messages<5 为 low_sample，messages>=5 且 tokenCount=0 为 no_words，其余 eligible。所有产品保留基础数据和最多 5 个 topWords，只有 eligibleSources>=2 时产生比较列表。

```js
export function productInsights(data,{range,sources,mode,settings}) {
  const normalized=normalizeSettings(settings ?? emptySettings());
  const products=[...sources].map(source=>{
    const selection=selectRange(data,{range,sources:new Set([source]),mode,settings:normalized,trend:'month'});
    const status=selection.messageCount<MIN_MESSAGES?'low_sample':!selection.tokenCount?'no_words':'eligible';
    return {source,label:normalized.productLabels[source] ?? '',messageCount:selection.messageCount,
      tokenCount:selection.tokenCount,status,topWords:selection.words.slice(0,5),representatives:[],selection};
  });
  const eligible=products.filter(product=>product.status==='eligible');
  const eligibleSources=eligible.map(product=>product.source),common=[],unique=[];
  if (eligible.length>=2) {
    const wordMaps=eligible.map(product=>new Map(product.selection.words.map(word=>[word.text,word.count])));
    for (let index=0;index<eligible.length;index++) {
      const product=eligible[index],otherIndexes=eligible.map((_,i)=>i).filter(i=>i!==index);
      const otherTotal=otherIndexes.reduce((sum,i)=>sum+eligible[i].tokenCount,0);
      product.representatives=product.selection.words.filter(w=>w.count>=MIN_WORD_COUNT).map(word=>{
        const otherCount=otherIndexes.reduce((sum,i)=>sum+(wordMaps[i].get(word.text) ?? 0),0);
        const share=word.count/product.tokenCount,otherShare=otherCount/otherTotal;
        return {text:word.text,count:word.count,share,otherShare,delta:(share-otherShare)*100};
      }).filter(word=>word.delta>0)
        .sort((a,b)=>b.delta-a.delta || b.count-a.count || a.text.localeCompare(b.text,'zh-CN')).slice(0,5);
    }
    const combined=selectRange(data,{range,sources:new Set(eligibleSources),mode,settings:normalized,trend:'month'});
    for (const word of combined.words) {
      const counts=wordMaps.map(map=>map.get(word.text) ?? 0);
      if (counts.every(count=>count>=MIN_WORD_COUNT)) common.push(word);
      if (counts.filter(count=>count>0).length===1 && Math.max(...counts)>=MIN_WORD_COUNT) unique.push(word);
    }
  }
  return {eligibleSources,products:products.map(({selection,...product})=>product),common:common.slice(0,10),unique:unique.slice(0,10)};
}
```

insights.mjs 显式导入 selectRange、periodBounds、shiftAnchor，以及 normalizeSettings、emptySettings；共用 Task 3 门槛常量。combined 仅包括 eligibleSources，不能混入不符合比较门槛的来源。

- [x] **Step 4: 补零有效词与隐藏回归。**

```js
test('全部隐藏时产品只有消息统计，用途标签不改身份',()=>{
  const data={stopwords:[],buckets:[{day:'2026-01-01',source:'Codex',messageCount:5,words:{python:3}}]};
  const settings={schemaVersion:1,hiddenWords:['python'],aliasGroups:[],productLabels:{Codex:'学习'}};
  const result=productInsights(data,{sources:new Set(['Codex']),mode:'raw',range:null,settings});
  assert.equal(result.products[0].source,'Codex');assert.equal(result.products[0].label,'学习');
  assert.equal(result.products[0].messageCount,5);assert.equal(result.products[0].status,'no_words');
  assert.deepEqual(result.eligibleSources,[]);
});
```

运行 `node --test tests/insights.test.mjs`；单产品只显示 Top 词，common/unique 列表不声称覆盖未参与产品。

- [x] **Step 5: 提交产品分析。**

```sh
git add web/insights.mjs tests/insights.test.mjs
git commit -m "feat: identify product-specific and shared words"
```

### Task 5: 自然月／自然年回顾

**Files:** Modify `web/insights.mjs`, `tests/insights.test.mjs`.

**Interfaces:** 消费 Tasks 2–4，产出 buildRecap 和 Recap；不从文案重新推导统计。

- [x] **Step 1: 写回顾一致性、部分周期与空词测试。**

```js
import {buildRecap} from '../web/insights.mjs';
test('回顾保留请求周期、快照截止、消息指标和别名词频',()=>{
  const data={meta:{generatedAt:'2026-02-02T01:00:00Z',timezone:'Asia/Shanghai',lastDay:'2026-02-01'},stopwords:[],buckets:[
    {day:'2026-02-01',source:'Codex',messageCount:5,words:{飞书:3,feishu:3}}
  ]};
  const settings={schemaVersion:1,hiddenWords:[],aliasGroups:[{canonical:'飞书',members:['飞书','feishu']}],productLabels:{}};
  const args={kind:'month',anchor:'2026-02-01',sources:new Set(['Codex']),mode:'raw',settings};
  const recap=buildRecap(data,args);
  assert.deepEqual(recap.range,{start:'2026-02-01',end:'2026-02-28'});
  assert.equal(recap.partial,true);assert.equal(recap.cutoffDay,'2026-02-02');
  assert.equal(recap.activity.messageCount,5);assert.equal(recap.topWords[0].count,6);
  assert.equal(recap.comparison.status,'low_sample');
  const hidden=buildRecap(data,{...args,settings:{...settings,hiddenWords:['feishu']}});
  assert.equal(hidden.status,'no_words');assert.equal(hidden.activity.activeDays,1);
  assert.equal(buildRecap(data,{...args,anchor:'2026-01-01'}).status,'empty');
});
```

- [x] **Step 2: 确认失败。** `node --test tests/insights.test.mjs`。
- [x] **Step 3: 实现回顾构造及受统计约束的文案。**

```js
export function buildRecap(data,{kind,anchor,sources,mode,settings}) {
  if (!['month','year'].includes(kind)) throw new Error('回顾仅支持月和年');
  const bounds=periodBounds(kind,anchor);
  const range={start:bounds.start,end:shiftAnchor('day',bounds.end,-1)};
  const cutoffDay=snapshotDay(data.meta),partial=!!cutoffDay && range.end>cutoffDay;
  const noSnapshot=!cutoffDay || range.start>cutoffDay;
  const effectiveRange=partial && !noSnapshot ? {...range,end:cutoffDay} : range;
  const args={sources:noSnapshot?new Set():sources,mode,settings,range:effectiveRange};
  const selection=selectRange(data,{...args,trend:kind==='year'?'month':'day'});
  const activity=activitySummary(selection),topWords=selection.words.slice(0,5);
  const products=productInsights(data,args);
  const pair=comparisonRanges(kind,anchor);
  // 无快照／未来周期用空 sources，保持完整范围合法；部分周期仅截断 B，A 是上一完整自然周期。
  const comparison=compareRanges(data,{a:pair.a,b:effectiveRange,sources:args.sources,mode,settings});
  const status=!selection.messageCount?'empty':!selection.tokenCount?'no_words':'ok';
  const sentences=[];
  if (selection.messageCount) sentences.push(`已读取 ${selection.messageCount} 条用户消息，分布在 ${activity.activeDays} 天。`);
  if (topWords.length) sentences.push(`出现最多的词是“${topWords[0].text}”，共 ${topWords[0].count} 次。`);
  const change=comparison.groups.new[0] ?? comparison.groups.rising[0];
  if (comparison.status==='ok' && change) sentences.push(`相较上一周期，“${change.text}”的词频占比增加了 ${change.delta.toFixed(2)} 个百分点。`);
  return {status,range,cutoffDay,partial,selection,activity,topWords,products,comparison,sentences};
}
```

产品对象和 sourceMessages 在 UI 展示全年／月全部来源消息分布，包括不足比较门槛的产品。文案只使用结构化结果；不引入职业、人格、用途推断。实际覆盖日期从 selection.firstDay/lastDay 展示，不用文件修改时间。

- [x] **Step 4: 补全无日期、未来周期和自然年回归。**

```js
test('未知日期不进入年回顾，未来周期为空',()=>{
  const data={meta:{generatedAt:'2026-02-01T00:00:00Z',timezone:'UTC',lastDay:'2026-01-01'},stopwords:[],buckets:[
    {day:'2026-01-01',source:'Codex',messageCount:5,words:{python:3}},
    {day:'unknown',source:'Codex',messageCount:9,words:{undated:9}}
  ]};
  const args={kind:'year',anchor:'2026-01-01',sources:new Set(['Codex']),mode:'raw'};
  assert.equal(buildRecap(data,args).activity.messageCount,5);
  assert.equal(buildRecap(data,{...args,anchor:'2027-01-01'}).status,'empty');
});
```

运行所有 Node 设置、共享数据与分析测试。

- [x] **Step 5: 提交回顾。**

```sh
git add web/insights.mjs tests/insights.test.mjs
git commit -m "feat: generate monthly and yearly AI recaps"
```

### Task 6: 词语整理的实际页面入口与自动保存

**Files:** Create `web/features-ui.mjs`, `tests/test_personal_features.py`; Modify `web/app.js`, `web/index.html`, `web/styles.css`, `tests/test_web_contract.py`.

**Interfaces:** mountFeatures 使用统一合同，settingsStore 负责所有设置更改与撤销；app.js 每次渲染将 settingsStore.get() 传入 selectPeriod；onSettingsChange 关闭旧详情并调用 renderCloud。

- [x] **Step 1: 建立合成快照浏览器测试与设置操作断言。**

创建 `tests/test_personal_features.py`，以下辅助 fixture 和浏览器上下文同时供 Task 7–8 使用；不要用个人快照断言新功能。

```python
import json
import threading
import unittest
from contextlib import contextmanager
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from tests.test_browser_smoke import CHROME, ROOT
from tests.test_browser_interactions import HAS_PLAYWRIGHT, QuietHandler

FIXTURE={
 'meta':{'schemaVersion':2,'generatedAt':'2026-02-02T00:00:00Z','timezone':'Asia/Shanghai','lastDay':'2026-02-01'},
 'sources':{name:{'state':'available','messages':count,'files':1,'coverage':'fixture'}
            for name,count in [('Codex',10),('Claude Code',5)]},
 'stopwords':['work'],'modes':{'raw':{'words':[]},'refined':{'words':[]}},
 'buckets':[
  {'day':'2026-01-01','source':'Codex','messageCount':5,'words':{'python':6,'飞书':3,'shared':3,'work':3}},
  {'day':'2026-01-02','source':'Claude Code','messageCount':5,'words':{'figma':6,'feishu':3,'shared':3,'work':3}},
  {'day':'2026-02-01','source':'Codex','messageCount':5,'words':{'python':3,'feishu':6,'shared':3,'work':3}}
 ]}

@contextmanager
def feature_page(viewport=None, init_script=None):
    from playwright.sync_api import sync_playwright
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'web')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=str(CHROME),headless=True)
            page=browser.new_page(viewport=viewport or {'width':1440,'height':1000})
            if init_script: page.add_init_script(init_script)
            page.route('**/data.json',lambda route:route.fulfill(content_type='application/json',body=json.dumps(FIXTURE)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            try: yield page
            finally: browser.close()
    finally:
        server.shutdown();server.server_close()

@unittest.skipUnless(HAS_PLAYWRIGHT and CHROME.exists(),'Install requirements-dev.txt and Chrome')
class PersonalFeatureTests(unittest.TestCase):
    def test_merge_hide_reload_and_restore_preserve_message_count(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            expect(page.locator('#stat-messages')).to_have_text('15')
            page.locator('#settings-panel > summary').click()
            page.fill('#alias-canonical','飞书');page.fill('#alias-members','飞书, Feishu')
            page.locator('#alias-form button[type=submit]').click()
            expect(page.locator('[data-word="feishu"]')).to_have_count(0)
            page.locator('[data-word="飞书"]').click()
            expect(page.locator('#detail-count')).to_have_text('12')
            page.click('#hide-word')
            expect(page.locator('[data-word="飞书"]')).to_have_count(0)
            expect(page.locator('#stat-messages')).to_have_text('15')
            page.reload()
            expect(page.locator('[data-word="飞书"]')).to_have_count(0)
            page.locator('#settings-panel > summary').click()
            page.locator('[data-restore-word="飞书"]').click()
            expect(page.locator('[data-word="飞书"]')).to_have_count(1)
            page.click('#settings-undo')
            expect(page.locator('[data-word="飞书"]')).to_have_count(0)
```

- [x] **Step 2: 运行失败测试。** `.venv/bin/python -m unittest tests.test_personal_features -v`；依赖齐全时因控件不存在失败，依赖缺失则如实记录 skipped，先用现有 requirements-dev.txt 安装，不声称测试通过。
- [x] **Step 3: 添加基础控件并对接统一聚合。**

index.html 在现有控制区之后新增设置 details，词详情增加隐藏按钮；沿用 input/button/details 和现有样式。固定 ID 如下：settings-panel、alias-form、alias-canonical、alias-members、alias-list、hidden-list、settings-export、settings-import、settings-reset、settings-undo、settings-status、hide-word。settings-status 使用 aria-live；别名成员支持英文／中文逗号和换行分隔。

```html
<details id="settings-panel">
  <summary>词语与个人设置</summary>
  <form id="alias-form">
    <label>代表词 <input id="alias-canonical" required></label>
    <label>成员词 <textarea id="alias-members" required></textarea></label>
    <button type="submit">保存词组</button>
  </form>
  <div id="alias-list"></div><div id="hidden-list"></div>
  <button id="settings-export" type="button">导出个人设置</button>
  <label>导入个人设置 <input id="settings-import" type="file" accept="application/json,.json"></label>
  <button id="settings-reset" type="button">恢复默认设置</button>
  <button id="settings-undo" type="button" disabled>撤销最近修改</button>
  <p id="settings-status" aria-live="polite"></p>
</details>
```

```js
// app.js 新增 import，init 在读取快照后初始化；不要在模块顶层访问 localStorage。
import {createSettingsStore,changeSettings} from './settings.mjs';
import {mountFeatures} from './features-ui.mjs';
let settingsStore,features;
function initializeFeatures() {
  let storage;
  try {storage=window.localStorage;} catch {storage={getItem:()=>null,setItem:()=>{throw new Error('浏览器禁止保存个人设置');}};}
  settingsStore=createSettingsStore(storage);
  features=mountFeatures({data:dataset,getState:()=>state,settingsStore,
    onSettingsChange:()=>{closeDetail();renderCloud();},
    selectDay:day=>{state.period='day';state.anchor=day;document.querySelector('#period-kind').value='day';syncPeriodInput();closeDetail();renderCloud();},
    sourceColor,notify:toast});
}
// filterWords 中 selectPeriod(data,{...currentState,settings:settingsStore?.get()})。
// renderCloud 在更新统计后调用 features?.refresh()，refresh 自身不能反向调用 renderCloud。
```

features-ui 绑定输入一次，refresh 只更新结果和列表，不重置正在编辑的表单。每个设置操作先 changeSettings 或 normalizeSettings，成功 replace 后调用 onSettingsChange；验证失败通知原因，不覆盖设置。#hide-word 使用当前详情的原 Word.text，不依据 DOM 中的装饰文本。

列出当前别名组，允许同名组编辑与解除；添加 data-remove-alias、data-edit-alias。隐藏名单可恢复组或单词；解除组后仍能逐个恢复成员，额外提供恢复全部隐藏。label 输入在 Task 7 产品卡中使用同一 store。

导出使用 store.serialize() 和 Blob 下载；导入 file.text()→JSON.parse→store.replace，异常展示在 settings-status，重置文件 input 以便重复导入。撤销调用 store.undo()，按钮禁用状态取 canUndo()。标签、代表词及导入文本一律用 textContent/value，不能拼入 innerHTML。

- [x] **Step 4: 补迁移、无效导入、存储失败和转义测试。**

```python
    # 以下方法追加到 PersonalFeatureTests。
    def test_settings_export_import_and_invalid_file(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.locator('#settings-panel > summary').click()
            settings={'schemaVersion':1,'hiddenWords':['python'],'aliasGroups':[],'productLabels':{'Codex':'学习'}}
            page.set_input_files('#settings-import',{'name':'settings.json','mimeType':'application/json','buffer':json.dumps(settings).encode()})
            expect(page.locator('[data-word="python"]')).to_have_count(0)
            with page.expect_download() as event: page.click('#settings-export')
            saved=json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
            self.assertEqual(set(saved),{'schemaVersion','hiddenWords','aliasGroups','productLabels'})
            self.assertEqual(saved['hiddenWords'],['python'])
            page.set_input_files('#settings-import',{'name':'bad.json','mimeType':'application/json','buffer':b'{"schemaVersion":99}'})
            expect(page.locator('[data-word="python"]')).to_have_count(0)
            expect(page.locator('#settings-status')).to_contain_text('版本')

    def test_storage_failure_keeps_in_memory_settings(self):
        from playwright.sync_api import expect
        with feature_page(init_script="Storage.prototype.setItem=()=>{throw new Error('quota');}") as page:
            page.locator('[data-word="python"]').click();page.click('#hide-word')
            expect(page.locator('[data-word="python"]')).to_have_count(0)
            expect(page.locator('#settings-status')).to_contain_text('未保存')
```

补 `tests/test_web_contract.py` 的新 ID 集合。运行旧浏览器交互和新设置交互，验证窄屏入口及 Enter/Escape 行为保留。导入 `<img src=x onerror=...>` 形式的标签时验证页面没有执行事件且标签显示为文本。

- [x] **Step 5: 提交设置交互。**

```sh
git add web/features-ui.mjs web/app.js web/index.html web/styles.css tests/test_personal_features.py tests/test_web_contract.py
git commit -m "feat: expose personal word rules and settings migration"
```

### Task 7: 回顾、变化、日历与产品分析的可操作入口

**Files:** Modify `web/features-ui.mjs`, `web/index.html`, `web/styles.css`, `tests/test_personal_features.py`, `tests/test_web_contract.py`.

**Interfaces:** 消费 Tasks 2–5 纯函数和 mountFeatures；getRecap 返回当前回顾对象，供 Task 8 分享使用。产品与模式从 app state 读取；回顾周期、比较两区间、热力图年份各自可独立选择，不受词云搜索影响。

- [x] **Step 1: 添加跨功能一致性与日期导航失败测试。**

```python
    def test_recap_compare_heatmap_and_products_share_settings(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.select_option('#recap-kind','month');page.fill('#recap-anchor','2026-01')
            page.locator('#recap-anchor').dispatch_event('change')
            expect(page.locator('#recap-messages')).to_have_text('10')
            expect(page.locator('#recap-active-days')).to_have_text('2')
            expect(page.locator('#recap-longest-streak')).to_have_text('2')
            for field,value in [('compare-a-start','2026-01-01'),('compare-a-end','2026-01-02'),('compare-b-start','2026-02-01'),('compare-b-end','2026-02-01')]:
                page.fill('#'+field,value)
            page.click('#compare-apply')
            expect(page.locator('#compare-status')).to_contain_text('比较')
            page.fill('#heatmap-year','2026');page.locator('#heatmap-year').dispatch_event('change')
            expect(page.locator('#heatmap-grid button')).to_have_count(365)
            page.locator('#heatmap-grid [data-day="2026-01-02"]').focus();page.keyboard.press('Enter')
            expect(page.locator('#period-summary')).to_have_text('2026-01-02')
            expect(page.locator('#stat-messages')).to_have_text('5')
            expect(page.locator('#heatmap-grid [data-day="2026-02-03"]')).to_be_disabled()
            page.select_option('#period-kind','all')
            expect(page.locator('#product-insights [data-source="Codex"]')).to_contain_text('python')
            page.fill('[data-product-label="Codex"]','写代码');page.locator('[data-product-label="Codex"]').dispatch_event('change')
            page.reload();expect(page.locator('[data-product-label="Codex"]')).to_have_value('写代码')
```

- [x] **Step 2: 确认失败。** `.venv/bin/python -m unittest tests.test_personal_features -v`；新功能控件不存在应失败，已完成的设置操作继续通过。
- [x] **Step 3: 添加必要控件和纯函数呈现。**

页面在原词云区域后依次添加四个基础 section，使用现有 section-heading 风格。

| 区域 | 固定控件／结果 ID |
|---|---|
| 回顾 | recap-kind、recap-anchor、recap-messages、recap-active-days、recap-longest-streak、recap-peak-days、recap-top-words、recap-range、recap-coverage、recap-change-status、recap-source-stats、recap-status |
| 比较 | compare-preset、compare-a-start、compare-a-end、compare-b-start、compare-b-end、compare-apply、compare-status、compare-new、compare-rising、compare-falling、compare-disappeared |
| 日历 | heatmap-year、heatmap-grid、heatmap-summary、heatmap-status |
| 产品 | product-insights、product-common、product-unique、product-status |

初始化回顾 anchor 为 meta.lastDay 所在月，回顾 kind=month；热力图年取 lastDay 年；无日期时使用 snapshotDay，二者都缺失时禁用依赖日期的分析并解释未生成快照，不使用今天伪造覆盖。比较默认本月／上月，允许四个日期输入手工修改成 custom。

```js
// features-ui.mjs 内 refresh 的核心调用；uiState 在 mountFeatures 内创建并保存。
import {buildRecap,compareRanges,heatmapYear,snapshotDay,productInsights} from './insights.mjs';
import {periodBounds,shiftAnchor} from './data-model.mjs';
function calculateFeatureResults(data,state,settings,uiState) {
  const recap=buildRecap(data,{kind:uiState.recapKind,anchor:uiState.recapAnchor,
    sources:state.sources,mode:state.mode,settings});
  const comparison=compareRanges(data,{a:uiState.a,b:uiState.b,
    sources:state.sources,mode:state.mode,settings});
  const heatmap=heatmapYear(data,{year:uiState.heatmapYear,sources:state.sources,cutoffDay:snapshotDay(data.meta)});
  const bounds=state.period==='all'?null:periodBounds(state.period,state.anchor);
  const range=bounds?{start:bounds.start,end:shiftAnchor('day',bounds.end,-1)}:null;
  const products=productInsights(data,{range,sources:state.sources,mode:state.mode,settings});
  return {recap,comparison,heatmap,products};
}
// 日历按钮：textContent 或 title 表示日期及数量；不将个人词拼进 HTML。
function createDayButton(cell,selectDay) {
  const button=document.createElement('button');button.type='button';button.dataset.day=cell.day;
  button.disabled=cell.future;button.dataset.level=String(cell.level);
  button.setAttribute('aria-label',cell.future?`${cell.day}，快照截止日之后`:`${cell.day}，${cell.messageCount} 条已读取消息`);
  button.title=button.getAttribute('aria-label');button.addEventListener('click',()=>selectDay(cell.day));
  return button;
}
```

日期变化先调用 periodBounds/rangeBounds 校验，再更新 uiState；非法或倒置日期保留旧结果，用 aria-live 提示，不清空已有内容。比较状态中文固定：ok→“已完成比较”、no_change→“没有符合门槛的明显变化”、low_sample→“消息较少，暂不生成变化排行榜”、no_words→“没有有效词，无法比较”。显示 A/B 消息数、次数、占比和百分点，保留低样本基础统计。

热力图按 weekIndex/weekday 放入 CSS grid；非本年的对齐格子不可聚焦，未来按钮 disabled；小屏允许日历容器内部横向滚动但不让整个页面溢出。显示 0/1–4/5–9/10–19/20+ 图例和“已读取记录”口径。

回顾显示请求范围、实际记录跨度、partial 截止说明，最活跃日期并列全部列出；以 selection.sourceMessages 展示所有来源数量而非只显示 eligible。空词状态保留消息与活跃信息。产品卡展示基础消息、Top、代表词、状态和 data-product-label 输入；每次 label change 走 changeSettings→store.replace→onSettingsChange。

- [x] **Step 4: 添加错误区间、隐藏同步和移动端回归。**

```python
    def test_invalid_range_retains_result_and_hidden_words_leave_all_analyses(self):
        from playwright.sync_api import expect
        with feature_page(viewport={'width':390,'height':844}) as page:
            previous=page.locator('#compare-status').inner_text()
            page.fill('#compare-a-start','2026-03-01');page.fill('#compare-a-end','2026-01-01')
            page.click('#compare-apply')
            expect(page.locator('#compare-status')).to_contain_text('起始日期')
            page.locator('[data-word="python"]').click();page.click('#hide-word')
            expect(page.locator('#recap-top-words')).not_to_contain_text('python')
            expect(page.locator('#product-insights')).not_to_contain_text('python')
            expect(page.locator('#stat-messages')).to_have_text('15')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
```

在该测试补记录比较结果列表在非法范围前后的 text_content 一致；新错误只改变状态，不覆写列表。录入标签时保持焦点，refresh 不重建正在输入的 input。验证隐藏修改立即更新回顾、比较、产品与词详情，热力图消息不变。source 筛选、mode 改变同样触发 refresh；query/limit 修改可以重绘但分析结果不变。

- [x] **Step 5: 运行浏览器回归并提交。**

```sh
.venv/bin/python -m unittest tests.test_personal_features tests.test_browser_interactions tests.test_web_contract -v
node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs
git add web/features-ui.mjs web/index.html web/styles.css tests/test_personal_features.py tests/test_web_contract.py
git commit -m "feat: expose recaps comparisons and activity insights"
```

### Task 8: 三种尺寸的分享卡片、预览与 PNG

**Files:** Create `web/cloud-layout.mjs`, `web/share.mjs`, `tests/share.test.mjs`, `tests/test_share_browser.py`; Modify `web/app.js`, `web/features-ui.mjs`, `web/index.html`, `web/styles.css`, `tests/test_web_contract.py`.

**Interfaces:** layoutWords 使用注入的 measureText，SVG 与 drawShare 共用；createShareContent 仅消费已应用规则的 Selection／Recap；drawShare 负责同一个 preview canvas；canvasToPng 下载该 canvas。features.getRecap 返回 Task 7 当前回顾。

- [x] **Step 1: 写分享白名单与纯布局测试。**

```js
// tests/share.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createShareContent} from '../web/share.mjs';
import {layoutWords} from '../web/cloud-layout.mjs';
test('分享仅选择字段，默认不含来源诊断，尊重可见词',()=>{
  const selection={messageCount:5,words:[{text:'python',count:3,sources:{Codex:3},months:{}}],sourceMessages:{Codex:5},
    paths:['/private/user'],issues:[{detail:'secret'}]};
  const options={kind:'cloud',size:'square',title:'我的足迹',showRange:true,showMessages:true,showTopWords:true,showSources:false};
  const content=createShareContent({selection,recap:null,visibleWords:selection.words,rangeLabel:'2026-01-01',settings:{productLabels:{}}},options);
  assert.deepEqual(content.sources,[]);
  assert.equal(JSON.stringify(content).includes('/private'),false);
  assert.equal(JSON.stringify(content).includes('secret'),false);
  assert.equal(content.words[0].text,'python');
  const blank=createShareContent({selection,recap:null,visibleWords:[],rangeLabel:'全部',settings:{productLabels:{}}},options);
  assert.deepEqual(blank.words,[]);assert.deepEqual(blank.topWords,[]);
});
test('布局使用目标尺寸，不拉伸原位置；词不能越界',()=>{
  const words=[{text:'python',count:10,sources:{Codex:10},months:{}},{text:'飞书',count:3,sources:{Codex:3},months:{}}];
  for (const [width,height] of [[1080,700],[1080,1500],[1600,600]]) {
    const placed=layoutWords(words,width,height,(text,size)=>[...text].length*size*0.6);
    assert.equal(placed.length,2);
    for (const word of placed) {
      assert.ok(word.x-word.width/2>=0 && word.x+word.width/2<=width);
      assert.ok(word.y-word.height/2>=0 && word.y+word.height/2<=height);
    }
  }
});
```

```python
# tests/test_share_browser.py
import base64
import struct
import unittest
from pathlib import Path
from tests.test_personal_features import feature_page, HAS_PLAYWRIGHT, CHROME

@unittest.skipUnless(HAS_PLAYWRIGHT and CHROME.exists(),'Install requirements-dev.txt and Chrome')
class ShareBrowserTests(unittest.TestCase):
    def test_three_sizes_preview_equals_download(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.locator('#share-panel > summary').click()
            for size,dimensions in [('square',(1080,1080)),('portrait',(1080,1920)),('landscape',(1600,1000))]:
                page.select_option('#share-size',size)
                expect(page.locator('#share-preview')).to_have_attribute('width',str(dimensions[0]))
                expect(page.locator('#share-preview')).to_have_attribute('height',str(dimensions[1]))
                with page.expect_download() as event: page.click('#share-export')
                png=Path(event.value.path()).read_bytes()
                self.assertEqual(png[:8],b'\x89PNG\r\n\x1a\n')
                self.assertEqual(struct.unpack('>II',png[16:24]),dimensions)
                preview=page.locator('#share-preview').evaluate('(canvas)=>canvas.toDataURL("image/png").split(",")[1]')
                self.assertEqual(png,base64.b64decode(preview))
```

- [x] **Step 2: 运行失败测试。** `node --test tests/share.test.mjs` 和 `.venv/bin/python -m unittest tests.test_share_browser -v`；确认缺模块或缺控件导致失败。
- [x] **Step 3: 提取布局并实现白名单分享内容。**

从 app.js 移动 intersects、dominantSource 和布局循环到 cloud-layout.mjs，移除内部 document.createElement('canvas') 和 getComputedStyle，改用调用方 measureText；保留布局参数与字体频次规则，输入可只有 count，内部补 filteredCount=count。measureText 负责字体设置；布局不要读全局 dataset、DOM 或 sourceColor。

app.js 使用 wrapper 保留现有调用方式，SVG 节点、键盘操作和装饰轨道不变。提取后重跑旧浏览器 smoke；这是为了共享布局，不是视觉重做。

```js
// app.js wrapper，导入名称避开旧函数名。
import {layoutWords as placeWords} from './cloud-layout.mjs';
function layoutWords(words,width,height) {
  const ctx=document.createElement('canvas').getContext('2d');
  const family=getComputedStyle(document.body).fontFamily;
  return placeWords(words,width,height,(text,size)=>{ctx.font=`560 ${size}px ${family}`;return ctx.measureText(text).width;});
}
// share.mjs 的字段构造只访问合同字段。
export function createShareContent({selection,recap,visibleWords,rangeLabel,settings},options) {
  const chosen=options.kind==='recap'?recap.selection:selection;
  const sourceWords=options.kind==='recap'?recap.selection.words:visibleWords;
  const words=sourceWords.map(({text,count,sources,months})=>({text,count,sources:{...sources},months:{...months}}));
  const sources=options.showSources?Object.entries(chosen.sourceMessages).map(([name,messageCount])=>
    ({name,label:settings.productLabels[name] ?? '',messageCount})):[];
  return {kind:options.kind,title:[...(options.title || '我的 AI 足迹')].slice(0,80).join(''),
    rangeLabel:options.showRange?(options.kind==='recap'?`${recap.range.start} → ${recap.range.end}`:rangeLabel):'',
    messageCount:options.showMessages?chosen.messageCount:null,words,
    topWords:options.showTopWords?words.slice(0,5):[],sources,
    summary:options.kind==='recap'?{activeDays:recap.activity.activeDays,longestStreak:recap.activity.longestStreak,
      peakCount:recap.activity.peakCount,peakDays:[...recap.activity.peakDays],cutoffDay:recap.cutoffDay,partial:recap.partial}:null};
}
export function canvasToPng(canvas) {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 导出失败，请重试')),'image/png'));
}
```

sourceWords 必须来自当前规则变换之后的结果，不直接读取 dataset.modes。回顾模式用 recap 本身的周期与来源；普通词云用当前搜索后的完整可见 Top 候选。来源开关仅决定是否绘制来源文字，词云颜色仍可使用 sources 分布，不绘制诊断。

- [x] **Step 4: 实现单一绘制路径和基础分享控件。**

```js
export const SHARE_SIZES={square:[1080,1080],portrait:[1080,1920],landscape:[1600,1000]};
// drawShare 中先设置 canvas.width/height，再读取 context；禁止 CSS 尺寸替代像素尺寸。
function wrapText(ctx,text,maxWidth) {
  const rows=[];let line='';
  for (const character of text) {
    if (line && ctx.measureText(line+character).width>maxWidth) {rows.push(line);line=character;}
    else line+=character;
  }
  if (line) rows.push(line);
  return rows;
}
function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
```

drawShare 先验证 size/kind，使用现有星云背景颜色。标题和顶部信息使用测量后的行高布局，底部 Top 与来源也换行；剩余矩形作为词云区域，layoutWords(width,height,measureText) 后加该矩形的偏移绘制。长标题最多 80 字符，可自动缩小字号使顶部最多占高度 25%；来源较多时小字号换行，剩余高度不足时减少列表展示并明确“其余 N 项”，不能越界。绘制顺序固定，返回 drawnTexts 仅供绘制结果测试，页面不展示内部日志。

分享 section 固定 ID：share-panel（details）、share-kind、share-size、share-title、share-show-range、share-show-messages、share-show-top、share-show-sources、share-preview（canvas）、share-export、share-status。kind 默认 cloud，size 默认 landscape；三个信息开关默认开启，sources 默认关闭。标题 maxlength=80。预览 CSS width:100%，height:auto。

在 features-ui.refresh 后通知 app 分享预览需要重画，或 app.renderCloud 完成 features.refresh 后统一调用 refreshShare；不得递归。任何选项修改都重绘同一个 #share-preview；下载该 canvas，失败保留状态并显示原因。无可见词的 cloud 禁用分享；recap 无消息禁用，有消息但无词仍绘制活跃统计。

保留 #export-png 快捷按钮一键导出 cloud，不要求先打开面板；使用同一内容构造与 drawShare，避免两套导出算法。回顾与分享的产品信息只用结构化白名单，不包含路径。颜色函数单产品返回 sourceColor；并列来源返回 mixed。

- [x] **Step 5: 补隐藏、空词、转义及失败分支测试，运行回归。**

```python
    def test_hidden_word_never_drawn_and_recap_without_words_can_export(self):
        from playwright.sync_api import expect
        import json
        with feature_page() as page:
            page.locator('#settings-panel > summary').click()
            settings={'schemaVersion':1,'hiddenWords':['python','飞书','feishu','figma','shared','work'],'aliasGroups':[],'productLabels':{}}
            page.set_input_files('#settings-import',{'name':'hidden.json','mimeType':'application/json','buffer':json.dumps(settings).encode()})
            page.locator('#share-panel > summary').click()
            expect(page.locator('#share-export')).to_be_disabled()
            page.select_option('#share-kind','recap')
            expect(page.locator('#share-export')).to_be_enabled()
            with page.expect_download() as event: page.click('#share-export')
            self.assertTrue(event.value.suggested_filename.endswith('.png'))
            drawn=page.evaluate("""async () => {
              const {drawShare}=await import('./share.mjs');
              const content={kind:'cloud',title:'标题',rangeLabel:'',messageCount:5,
                words:[{text:'飞书',count:3,sources:{Codex:3},months:{}}],topWords:[],sources:[],summary:null};
              return drawShare(document.createElement('canvas'),content,
                {kind:'cloud',size:'square',title:'标题',showRange:false,showMessages:true,showTopWords:false,showSources:false},()=> '#67e8f9').drawnTexts;
            }""")
            self.assertIn('飞书',drawn)
            self.assertFalse(any('Codex' in text or '/Users/' in text for text in drawn))
```

上例的后半段只验证来源默认隐藏，不把它当成隐藏规则测试。继续添加真实规则到绘制的测试与 toBlob 失败测试：

```python
    def test_share_drawing_respects_hidden_rules_and_blob_failure_is_reported(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            texts=page.evaluate("""async () => {
              const {selectRange}=await import('./data-model.mjs');
              const {createShareContent,drawShare}=await import('./share.mjs');
              const settings={schemaVersion:1,hiddenWords:['python'],aliasGroups:[],productLabels:{}};
              const data={stopwords:[],buckets:[{day:'2026-01-01',source:'Codex',messageCount:5,words:{python:6,figma:3}}]};
              const selection=selectRange(data,{sources:new Set(['Codex']),mode:'raw',settings,range:null,trend:'day'});
              const options={kind:'cloud',size:'square',title:'足迹',showRange:false,showMessages:true,showTopWords:true,showSources:false};
              const content=createShareContent({selection,recap:null,visibleWords:selection.words,rangeLabel:'',settings},options);
              return drawShare(document.createElement('canvas'),content,options,()=> '#67e8f9').drawnTexts;
            }""")
            self.assertFalse(any('python' in text for text in texts))
            self.assertTrue(any('figma' in text for text in texts))
            page.locator('#share-panel > summary').click()
            page.evaluate('HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);}')
            page.click('#share-export')
            expect(page.locator('#share-status')).to_contain_text('重试')

    def test_custom_title_is_text_and_respects_length(self):
        from playwright.sync_api import expect
        with feature_page() as page:
            page.locator('#share-panel > summary').click()
            page.fill('#share-title','<img src=x onerror=window.__xss=1>')
            expect(page.locator('#share-title')).to_have_attribute('maxlength','80')
            self.assertIsNone(page.evaluate('window.__xss ?? null'))
            self.assertEqual(page.locator('#share-panel img').count(),0)
```

运行 `node --test tests/share.test.mjs tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs` 和 `.venv/bin/python -m unittest tests.test_share_browser tests.test_browser_smoke tests.test_browser_interactions tests.test_personal_features -v`。验证三尺寸、长标题、移动端预览与当前快捷下载。

- [x] **Step 6: 提交分享功能。**

```sh
git add web/cloud-layout.mjs web/share.mjs web/app.js web/features-ui.mjs web/index.html web/styles.css tests/share.test.mjs tests/test_share_browser.py tests/test_web_contract.py
git commit -m "feat: export configurable AI recap share cards"
```

### Task 9: 分发、文档和整体验收

**Files:** Modify `package_portable.py`, `tests/test_package.py`, `README.md`, this plan's execution status. Output `dist/ai-dialogue-wordcloud-portable.zip`（忽略的构建产物）。

**Interfaces:** 分发文件必须包含 settings/data-model/insights/features-ui/cloud-layout/share 全部 ES modules；保持 package_portable.build_package(output) 和空快照协议。

- [x] **Step 1: 先写便携包缺模块的失败测试。**

```python
    # 添加到 tests/test_package.py 的 PackageTests。
    def test_portable_archive_contains_all_personal_feature_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=build_package(Path(tmp)/'portable.zip')
            with zipfile.ZipFile(output) as archive:
                for filename in ('settings.mjs','data-model.mjs','insights.mjs','features-ui.mjs','cloud-layout.mjs','share.mjs'):
                    self.assertIn('ai-dialogue-wordcloud/web/'+filename,archive.namelist())
                data=json.loads(archive.read('ai-dialogue-wordcloud/web/data.json'))
                self.assertEqual(data['buckets'],[])
                self.assertEqual(data['meta']['uniqueMessages'],0)
                self.assertFalse(any('settings.json' in name for name in archive.namelist()))
```

- [x] **Step 2: 运行失败测试。** `.venv/bin/python -m unittest tests.test_package -v`，预期当前 RUNTIME_FILES 缺少新模块。
- [x] **Step 3: 更新包文件与 README。**

```python
# package_portable.py 中把以下新路径纳入现有 RUNTIME_FILES 元组。
NEW_FEATURE_FILES=('web/settings.mjs','web/insights.mjs','web/features-ui.mjs','web/cloud-layout.mjs','web/share.mjs')
# 可直接扩展原元组，不创建自动递归打包；不得携带个人设置或个人快照。
```

README 增加六项功能、3 次／5 条门槛、词频占比公式、来源独有的所选范围、隐藏／别名行为、个人设置迁移、保存同一站点地址限制、三尺寸与回顾导出。明确只有已读取记录，未知日期仅全部；默认导出不包含来源路径，便携包仍为空快照。命令按以下方式更新，避免只跑旧 Node 测试：

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs tests/share.test.mjs
node --check web/app.js
node --check web/features-ui.mjs
node --check web/share.mjs
node --check web/cloud-layout.mjs
.venv/bin/python package_portable.py
```

- [x] **Step 4: 实际运行整体验收，不刷新个人快照。**

使用 tests/test_personal_features.py 的拦截 fixture 跑浏览器操作。真实现有快照可只读打开检查性能与非空显示，启动用 `.venv/bin/python launch.py --no-scan --no-browser`，记录真实 URL，结束后停止本次进程。不得调用默认 launch 造成个人快照更新。

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs tests/share.test.mjs
node --check web/app.js
node --check web/features-ui.mjs
node --check web/share.mjs
node --check web/cloud-layout.mjs
git diff --check
git diff --exit-code -- web/data.json
.venv/bin/python package_portable.py
```

按顺序运行依赖操作，测试独立时可批量执行命令，不授权并行代理。最终新测试数根据真实输出报告，不能预填通过数量。

```python
# 使用 .venv/bin/python 的 heredoc 检查现有便携包；不输出个人原始词表。
import json,zipfile
from pathlib import Path
from package_portable import RUNTIME_FILES
with zipfile.ZipFile('dist/ai-dialogue-wordcloud-portable.zip') as archive:
    assert archive.testzip() is None
    for filename in RUNTIME_FILES:
        assert archive.read('ai-dialogue-wordcloud/'+filename)==Path(filename).read_bytes()
    data=json.loads(archive.read('ai-dialogue-wordcloud/web/data.json'))
    assert data['buckets']==[] and data['meta']['uniqueMessages']==0
    assert '/Users/' not in json.dumps(data)
```

确认现有 start.sh/start.cmd、端口回退、--no-scan、--generate-only 行为未变；不重复安装运行依赖进行无关扫描。若缺 Chrome／Playwright，报告未运行的浏览器检查和原因；不要把 Node 测试冒充完整交互验收。

- [x] **Step 5: 审查变更范围并提交交付文件。**

```sh
git diff --stat
git status --short
git add package_portable.py tests/test_package.py README.md docs/superpowers/plans/2026-11-26-personal-insights.md
git commit -m "docs: document and package personal AI insights"
```

阶段结束报告已实现功能、测试实况、个人快照是否保持原样、ZIP 空快照检查、Windows/Linux 实机边界；不要推送或发布 GitHub，本轮没有发布授权。

## 需求覆盖与执行自查

| 需求设计章节 | 对应任务与关键验证 |
|---|---|
| §4.1 完整 buckets、用户消息、未知日期、时区 | Task 2 聚合／截止／unknown 测试；Task 9 分发和源数据不变 |
| §4.2 统一规则和搜索／Top 边界 | Tasks 1–2；Tasks 6–8 跨功能与导出一致性 |
| §4.3 占比、零分母、百分点 | Tasks 3–4 算法及样本／no_words 测试 |
| §4.4 日期包含边界、未来、覆盖 | Tasks 2、3、5、7 |
| §5.1 年／月回顾、并列高峰、连续活动、实际覆盖 | Tasks 2、5、7、8 |
| §5.2 任意比较、新／升／降／消失、排序门槛 | Tasks 3、7 |
| §5.3 日历等级、周一布局、键盘导航、消息独立 | Tasks 2、7 |
| §5.4 代表／共同／独有、低样本、用途标签 | Tasks 1、4、7 |
| §5.5 三尺寸、开关、长标题、预览同绘、路径排除 | Task 8；Task 9 分发 |
| §5.6 组隐藏、解除／恢复、校验、自动保存、迁移／撤销 | Tasks 1、2、6 |
| §6 模块职责与无新增依赖 | 接口合同及文件表；Tasks 2、6、8、9 |
| §7 回归、交互、空状态、隐私、平台边界 | 每任务测试＋Task 9 整体验收 |

实现时每完成一项更新该项 checkbox 和实际测试记录，不提前勾选。任何 spec 覆盖缺口先补相关任务的测试与行为，不能把“功能设计下一轮”扩展成推迟本轮必要入口。

## 执行交接

用户随后已要求按计划完成全部任务，本轮使用 superpowers:executing-plans 单代理顺序执行完毕。工作位于原项目目录的 feat/personal-insights 分支，main 保留原提交；尚未推送或发布 GitHub。


## 完成验证记录（2026-11-26）

- 基线：40 项 Python 测试、7 项 Node 测试通过。
- 每个新增模块／功能先运行计划中的缺失行为测试，观察失败后再实现；各阶段通过对应验证后提交。
- 最终 `.venv/bin/python -m unittest discover -s tests -v`：52 项通过，0 失败，0 跳过。
- 最终 `node --test tests/settings.test.mjs tests/data-model.test.mjs tests/insights.test.mjs tests/share.test.mjs`：23 项通过。
- app.js、features-ui.mjs、share.mjs、cloud-layout.mjs 语法检查通过；git diff --check 通过。
- 真实启动器以 --no-scan --no-browser --port 0 打开现有快照：1,006 条消息，90 个实际展示词，页面无脚本错误；本次加载约 0.27 秒（单次观察，不作跨设备性能保证），验收进程已停止。
- 个人 web/data.json SHA-256 始终为 4c9fb682df0e63a93dd7ed46012f727a57de11a3f82fbf53e50228bf67b1a9da，没有刷新或提交个人快照。
- dist/ai-dialogue-wordcloud-portable.zip：18 个文件，54,818 字节；ZIP 完整性检查通过，各运行文件逐字节匹配源码，内置 buckets=[]、uniqueMessages=0，无个人路径。
- Windows/Linux 尚未实机验证，沿用现有模拟路径验证边界。

执行中补齐了两条跨功能连接：回顾通过 selectPeriod 回调打开对应周期词云；分析区域通过 onRefresh 回调同步分享预览。修改回顾月份后预览保持旧内容的问题已用图片哈希变化回归测试复现并修复。

计划中 toBlob 失败注入示例的赋值表达式会被 Playwright 当作返回函数调用；实际测试改为外层箭头函数执行赋值，成功验证空 Blob 时的重试提示。测试未引入运行依赖。
