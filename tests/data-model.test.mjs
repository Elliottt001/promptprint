import test from 'node:test';
import assert from 'node:assert/strict';
import {periodBounds, shiftAnchor, selectPeriod} from '../web/data-model.mjs';
const data={stopwords:['work'],buckets:[
 {day:'2025-12-31',source:'Codex',messageCount:1,words:{python:2,work:1}},
 {day:'2026-01-01',source:'Claude Code',messageCount:2,words:{figma:3,work:1}},
 {day:'unknown',source:'Codex',messageCount:1,words:{unknownword:1}}
]};
test('week starts Monday across calendar year',()=>assert.deepEqual(periodBounds('week','2026-01-01'),{start:'2025-12-29',end:'2026-01-05'}));
test('leap month and calendar year end are exclusive',()=>{
 assert.deepEqual(periodBounds('month','2024-02-10'),{start:'2024-02-01',end:'2024-03-01'});
 assert.deepEqual(periodBounds('year','2026-11-26'),{start:'2026-01-01',end:'2027-01-01'});
});
test('day does not include previous or next day',()=>{
 const r=selectPeriod(data,{period:'day',anchor:'2026-01-01',mode:'refined',sources:new Set(['Codex','Claude Code'])});
 assert.equal(r.messageCount,2);assert.deepEqual(r.words.map(w=>w.text),['figma']);
});
test('all includes unknown timestamps and source filtering is exact',()=>{
 const r=selectPeriod(data,{period:'all',anchor:'2026-01-01',mode:'raw',sources:new Set(['Codex'])});
 assert.equal(r.messageCount,2);assert.equal(r.unknownMessages,1);assert.equal(r.words.find(w=>w.text==='python').count,2);
 assert.equal(r.words.some(w=>w.text==='figma'),false);
});
test('raw keeps stopwords, refined removes and source shares sum',()=>{
 const state={period:'week',anchor:'2026-01-01',sources:new Set(['Codex','Claude Code'])};
 const raw=selectPeriod(data,{...state,mode:'raw'});assert.equal(raw.words.find(w=>w.text==='work').count,2);
 const refined=selectPeriod(data,{...state,mode:'refined'});assert.equal(refined.words.some(w=>w.text==='work'),false);
 for(const word of raw.words) assert.equal(word.count,Object.values(word.sources).reduce((a,b)=>a+b,0));
});
test('month navigation handles December and leap February',()=>{
 assert.equal(shiftAnchor('month','2025-12-31',1),'2026-01-01');
 assert.equal(shiftAnchor('month','2024-03-31',-1),'2024-02-01');
 assert.equal(shiftAnchor('week','2026-01-01',-1),'2025-12-25');
});
test('invalid dates are rejected and empty filters stay empty',()=>{
 assert.throws(()=>periodBounds('day','2026-02-30'));
 assert.equal(selectPeriod(data,{period:'all',mode:'raw',sources:new Set()}).words.length,0);
});

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
