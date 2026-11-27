import {normalizeSettings, emptySettings} from './settings.mjs';
/** Analysis of aggregate records. All quantities retain the snapshot's calendar dates. */
import {periodBounds, shiftAnchor, selectRange} from './data-model.mjs';

export function snapshotDay(meta) {
  if (!meta.generatedAt) return meta.lastDay ?? null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:meta.timezone ?? 'UTC',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date(meta.generatedAt));
  const get=type=>parts.find(part=>part.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function activitySummary(selection) {
  const days=selection.days.filter(day=>day.messageCount>0).sort((a,b)=>a.day.localeCompare(b.day));
  let previous=null,streak=0,longestStreak=0,peakCount=0,peakDays=[];
  for (const entry of days) {
    streak=previous && shiftAnchor('day',previous,1)===entry.day?streak+1:1;
    longestStreak=Math.max(longestStreak,streak);previous=entry.day;
    if (entry.messageCount>peakCount) {peakCount=entry.messageCount;peakDays=[entry.day];}
    else if (entry.messageCount===peakCount) peakDays.push(entry.day);
  }
  return {messageCount:selection.messageCount,activeDays:days.length,longestStreak,peakCount,peakDays};
}
export function heatmapYear(data,{year,sources,cutoffDay}) {
  if (!Number.isInteger(Number(year)) || year<1 || year>9998) throw new Error('请选择有效年份');
  const start=`${String(year).padStart(4,'0')}-01-01`,end=`${String(Number(year)+1).padStart(4,'0')}-01-01`;
  periodBounds('year',start);
  const selected=selectRange(data,{sources,mode:'raw',range:{start,end:shiftAnchor('day',end,-1)},trend:'day'});
  const counts=new Map(selected.days.map(entry=>[entry.day,entry.messageCount]));
  const offset=(new Date(start+'T00:00:00Z').getUTCDay()+6)%7,cells=[];
  for (let day=start,index=0;day<end;day=shiftAnchor('day',day,1),index++) {
    const future=!cutoffDay || day>cutoffDay,messageCount=future?0:(counts.get(day) || 0);
    const level=!messageCount?0:messageCount<5?1:messageCount<10?2:messageCount<20?3:4;
    cells.push({day,messageCount,level,future,weekday:(index+offset)%7,weekIndex:Math.floor((index+offset)/7)});
  }
  const days=cells.filter(cell=>!cell.future).map(({day,messageCount})=>({day,messageCount}));
  return {cells,summary:activitySummary({days,messageCount:days.reduce((sum,entry)=>sum+entry.messageCount,0)})};
}

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
