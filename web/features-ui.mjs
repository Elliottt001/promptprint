import {buildRecap,compareRanges,comparisonRanges,heatmapYear,snapshotDay} from './insights.mjs';
import {periodBounds,rangeBounds} from './data-model.mjs';

const $ = id => document.getElementById(id);
function element(tag,text,className='') {
  const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
}
function button(text,handler) {
  const node=element('button',text);node.type='button';node.addEventListener('click',handler);return node;
}
export function mountFeatures({data,getState,onRefresh,selectDay,selectPeriod}) {
  const initialDay=data.meta.lastDay || snapshotDay(data.meta);
  const ui={recapKind:'month',recapAnchor:initialDay,heatmapYear:initialDay?Number(initialDay.slice(0,4)):null,
    pair:initialDay?comparisonRanges('month',snapshotDay(data.meta) || initialDay):null};
  let currentRecap=null,compareError='',recapError='',heatmapError='';
  const statuses={ok:'',low_sample:'消息较少，暂不生成变化排行榜',no_words:'没有有效词，无法比较',no_change:'没有符合门槛的明显变化'};
  function wordList(root,words) {
    root.replaceChildren(...words.map(word=>element('p',`${word.text} · ${word.count} 次`)));
    if (!words.length) root.append(element('p','暂无符合条件的词'));
  }
  function syncRecapInput() {
    $('recap-anchor').type=ui.recapKind==='month'?'month':'number';
    $('recap-anchor').value=ui.recapAnchor?.slice(0,ui.recapKind==='month'?7:4) || '';
    if (ui.recapKind==='year') {$('recap-anchor').min='1';$('recap-anchor').max='9998';}
    else {$('recap-anchor').removeAttribute('min');$('recap-anchor').removeAttribute('max');}
  }
  function syncCompareInputs() {
    if (!ui.pair) return;
    for (const side of ['a','b']) for (const edge of ['start','end']) $(`compare-${side}-${edge}`).value=ui.pair[side][edge];
  }
  syncRecapInput();syncCompareInputs();$('heatmap-year').value=ui.heatmapYear || '';
  $('recap-view-cloud').disabled=!ui.recapAnchor;
  $('recap-view-cloud').addEventListener('click',()=>{if (ui.recapAnchor) {selectPeriod(ui.recapKind,ui.recapAnchor);$('cloud-stage').scrollIntoView();}});
  $('recap-kind').addEventListener('change',event=>{ui.recapKind=event.target.value;recapError='';syncRecapInput();refresh();});
  $('recap-anchor').addEventListener('change',event=>{
    const anchor=event.target.value+(ui.recapKind==='month'?'-01':'-01-01');
    try {periodBounds(ui.recapKind,anchor);ui.recapAnchor=anchor;recapError='';refresh();}
    catch {recapError='请选择有效月份或年份';$('recap-status').textContent=recapError;}
  });
  $('compare-preset').addEventListener('change',event=>{
    if (event.target.value==='custom' || !initialDay) return;
    ui.pair=comparisonRanges(event.target.value,snapshotDay(data.meta) || initialDay);compareError='';syncCompareInputs();refresh();
  });
  for (const side of ['a','b']) for (const edge of ['start','end']) $(`compare-${side}-${edge}`).addEventListener('input',()=>{$('compare-preset').value='custom';});
  $('compare-apply').addEventListener('click',()=>{
    try {
      const pair={a:{start:$('compare-a-start').value,end:$('compare-a-end').value},b:{start:$('compare-b-start').value,end:$('compare-b-end').value}};
      rangeBounds(pair.a);rangeBounds(pair.b);ui.pair=pair;compareError='';refresh();
    } catch (error) {compareError=error.message;$('compare-status').textContent=compareError;}
  });
  $('heatmap-year').addEventListener('change',event=>{
    try {heatmapYear(data,{year:Number(event.target.value),sources:getState().sources,cutoffDay:snapshotDay(data.meta)});
      ui.heatmapYear=Number(event.target.value);heatmapError='';refresh();}
    catch (error) {heatmapError=error.message;$('heatmap-status').textContent=heatmapError;}
  });
  function refresh() {
    refreshAnalysis();
    onRefresh?.();
  }
  function refreshAnalysis() {
    const state=getState(),common={sources:state.sources,mode:state.mode};
    if (ui.recapAnchor) {
      currentRecap=buildRecap(data,{...common,kind:ui.recapKind,anchor:ui.recapAnchor});
      const recap=currentRecap;
      $('recap-status').textContent=recapError || (recap.status==='empty'?'这个周期未读取到消息':recap.status==='no_words'?'有消息记录，但没有有效词':'');
      $('recap-range').textContent=`回顾周期 ${recap.range.start} → ${recap.range.end}${recap.partial?` · 截至快照日期 ${recap.cutoffDay}`:''}`;
      $('recap-messages').textContent=String(recap.activity.messageCount);$('recap-active-days').textContent=String(recap.activity.activeDays);
      $('recap-longest-streak').textContent=String(recap.activity.longestStreak);
      $('recap-peak-days').textContent=recap.activity.peakDays.length?`最活跃日期：${recap.activity.peakDays.join('、')} · 各 ${recap.activity.peakCount} 条`:'尚无最活跃日期';
      wordList($('recap-top-words'),recap.topWords);
      $('recap-source-stats').replaceChildren(...Object.entries(recap.selection.sourceMessages).map(([source,count])=>element('p',`${source} · ${count} 条消息`)));
      $('recap-change-status').textContent=statuses[recap.comparison.status];
      $('recap-sentences').replaceChildren(...recap.sentences.map(sentence=>element('p',sentence)));
    } else {$('recap-status').textContent='快照没有可用日期，暂不能生成周期回顾';}
    if (ui.pair) {
      const comparison=compareRanges(data,{...common,...ui.pair});
      $('compare-status').textContent=compareError || statuses[comparison.status];
      $('compare-counts').textContent=`${comparison.a.messageCount} 条消息 vs ${comparison.b.messageCount} 条消息`;
      for (const kind of ['new','rising','falling','disappeared']) {
        $(`compare-${kind}`).replaceChildren(...comparison.groups[kind].map(word=>{
          const row=element('p',`${word.text} · ${word.countA} 次 → ${word.countB} 次`);
          row.dataset.changeWord=word.text;return row;
        }));
      }
    } else {$('compare-status').textContent='快照没有可用日期；可以手动选择区间。';}
    if (ui.heatmapYear) {
      const heatmap=heatmapYear(data,{year:ui.heatmapYear,sources:state.sources,cutoffDay:snapshotDay(data.meta)});
      $('heatmap-status').textContent=heatmapError;
      const activity=heatmap.summary;
      $('heatmap-summary').textContent=`${activity.messageCount} 条消息 · ${activity.activeDays} 个活跃日 · 最长连续 ${activity.longestStreak} 天${activity.peakDays.length?` · 高峰 ${activity.peakDays.join('、')}，各 ${activity.peakCount} 条`:''}`;
      $('heatmap-grid').replaceChildren(...heatmap.cells.map(cell=>{
        const node=button('',()=>selectDay(cell.day));node.dataset.day=cell.day;node.dataset.level=String(cell.level);
        node.disabled=cell.future;node.style.gridColumn=String(cell.weekIndex+1);node.style.gridRow=String(cell.weekday+1);
        node.title=cell.future?`${cell.day}，快照截止日之后`:`${cell.day}，${cell.messageCount} 条已读取消息`;
        node.setAttribute('aria-label',node.title);return node;
      }));
    } else {$('heatmap-status').textContent='快照没有可用日期，暂不能显示活跃日历';}
  }
  return {refresh,getRecap:()=>currentRecap};
}
