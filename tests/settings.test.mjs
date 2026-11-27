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
test('NFKC、英文大小写、未来词及未出现产品标签可迁移',()=>{
  const settings=normalizeSettings({...emptySettings(),aliasGroups:[
    {canonical:'飞书',members:['飞书',' Ｆｅｉｓｈｕ ']}
  ],productLabels:{FutureApp:'学习'}});
  assert.deepEqual(settings.aliasGroups[0].members,['feishu','飞书']);
  assert.equal(settings.productLabels.FutureApp,'学习');
  assert.throws(()=>normalizeSettings({...emptySettings(),schemaVersion:2}));
  assert.throws(()=>normalizeSettings({...emptySettings(),aliasGroups:[{canonical:'a',members:['a',' ']}]}));
});
