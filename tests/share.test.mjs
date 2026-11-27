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
