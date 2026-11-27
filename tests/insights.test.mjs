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
test('重叠相同区间没有变化，低频词不入榜',()=>{
  const data={stopwords:[],buckets:[{day:'2026-01-01',source:'Codex',messageCount:5,words:{python:3,tiny:1}}]};
  const interval={start:'2026-01-01',end:'2026-01-31'};
  const result=compareRanges(data,{a:interval,b:interval,sources:new Set(['Codex']),mode:'raw'});
  assert.equal(result.status,'no_change');
  assert.deepEqual(Object.values(result.groups).flat(),[]);
});

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
test('全部隐藏时产品只有消息统计，用途标签不改身份',()=>{
  const data={stopwords:[],buckets:[{day:'2026-01-01',source:'Codex',messageCount:5,words:{python:3}}]};
  const settings={schemaVersion:1,hiddenWords:['python'],aliasGroups:[],productLabels:{Codex:'学习'}};
  const result=productInsights(data,{sources:new Set(['Codex']),mode:'raw',range:null,settings});
  assert.equal(result.products[0].source,'Codex');assert.equal(result.products[0].label,'学习');
  assert.equal(result.products[0].messageCount,5);assert.equal(result.products[0].status,'no_words');
  assert.deepEqual(result.eligibleSources,[]);
});

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
test('未知日期不进入年回顾，未来周期为空',()=>{
  const data={meta:{generatedAt:'2026-02-01T00:00:00Z',timezone:'UTC',lastDay:'2026-01-01'},stopwords:[],buckets:[
    {day:'2026-01-01',source:'Codex',messageCount:5,words:{python:3}},
    {day:'unknown',source:'Codex',messageCount:9,words:{undated:9}}
  ]};
  const args={kind:'year',anchor:'2026-01-01',sources:new Set(['Codex']),mode:'raw'};
  assert.equal(buildRecap(data,args).activity.messageCount,5);
  assert.equal(buildRecap(data,{...args,anchor:'2027-01-01'}).status,'empty');
});
