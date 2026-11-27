/** Pure calendar arithmetic over the generator's local date strings. */
import {emptySettings, normalizeSettings, normalizeTerm} from './settings.mjs';
function dateFromISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid calendar date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('Invalid calendar date');
  return date;
}
const iso = date => date.toISOString().slice(0,10);

export function periodBounds(kind, anchor) {
  if (kind === 'all') return {start:null,end:null};
  const start = dateFromISO(anchor);
  let end;
  if (kind === 'day') {end = new Date(start);end.setUTCDate(end.getUTCDate()+1);}
  else if (kind === 'week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay()+6)%7);
    end = new Date(start);end.setUTCDate(end.getUTCDate()+7);
  } else if (kind === 'month') {
    start.setUTCDate(1);end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  } else if (kind === 'year') {
    start.setUTCMonth(0,1);end=new Date(start);end.setUTCFullYear(end.getUTCFullYear()+1);
  } else throw new Error('Unknown period');
  return {start:iso(start),end:iso(end)};
}

export function shiftAnchor(kind, anchor, direction) {
  const date=dateFromISO(anchor);
  if (kind==='day' || kind==='week') date.setUTCDate(date.getUTCDate()+direction*(kind==='week'?7:1));
  else if(kind==='month') {date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+direction);}
  else if(kind==='year') {date.setUTCMonth(0,1);date.setUTCFullYear(date.getUTCFullYear()+direction);}
  return iso(date);
}

export function selectPeriod(data, state) {
  const kind=state.period || 'all', bounds=periodBounds(kind,state.anchor);
  return selectRange(data,{...state,range:bounds.start?{start:bounds.start,end:shiftAnchor('day',bounds.end,-1)}:null,
    trend:['all','year'].includes(kind)?'month':'day'});
}

export function rangeBounds(range) {
  const start=dateFromISO(range.start),last=dateFromISO(range.end);
  if (start>last) throw new Error('起始日期不能晚于结束日期');
  last.setUTCDate(last.getUTCDate()+1);
  if (last.getUTCFullYear()>9999) throw new Error('结束日期超出支持范围');
  return {start:iso(start),end:iso(last)};
}

export function selectRange(data, state) {
  const bounds=state.range?rangeBounds(state.range):{start:null,end:null};
  const settings=normalizeSettings(state.settings ?? emptySettings());
  const stopwords=new Set(state.mode==='refined' ? (data.stopwords || []).map(normalizeTerm) : []);
  const aliases=new Map(),hidden=new Set(settings.hiddenWords);
  for (const group of settings.aliasGroups) {
    const suppressed=group.members.some(member=>hidden.has(member));
    for (const member of group.members) aliases.set(member,{canonical:group.canonical,suppressed});
  }
  const map=new Map(),dayCounts=new Map(),sourceCounts=new Map();let messageCount=0,unknownMessages=0;
  let firstDay=null,lastDay=null;
  for (const bucket of data.buckets || []) {
    if (!state.sources.has(bucket.source)) continue;
    if (bounds.start && (bucket.day==='unknown' || bucket.day<bounds.start || bucket.day>=bounds.end)) continue;
    messageCount+=bucket.messageCount;
    sourceCounts.set(bucket.source,(sourceCounts.get(bucket.source) || 0)+bucket.messageCount);
    if (bucket.day==='unknown') unknownMessages+=bucket.messageCount;
    else {
      dayCounts.set(bucket.day,(dayCounts.get(bucket.day) || 0)+bucket.messageCount);
      if (!firstDay || bucket.day<firstDay) firstDay=bucket.day;
      if (!lastDay || bucket.day>lastDay) lastDay=bucket.day;
    }
    for (const [original,count] of Object.entries(bucket.words)) {
      const term=normalizeTerm(original),group=aliases.get(term),text=group?.canonical ?? term;
      if (group?.suppressed || hidden.has(term) || stopwords.has(text)) continue;
      const word=map.get(text) || {text,count:0,sources:{},months:{}};
      word.count+=count;
      word.sources[bucket.source]=(word.sources[bucket.source] || 0)+count;
      const point=bucket.day==='unknown'?'未知':state.trend==='month'?bucket.day.slice(0,7):bucket.day;
      word.months[point]=(word.months[point] || 0)+count;
      map.set(text,word);
    }
  }
  const words=[...map.values()].sort((a,b)=>b.count-a.count || a.text.localeCompare(b.text,'zh-CN'));
  return {words,messageCount,unknownMessages,firstDay,lastDay,...bounds,
    tokenCount:words.reduce((sum,word)=>sum+word.count,0),
    days:[...dayCounts].sort(([a],[b])=>a.localeCompare(b)).map(([day,messageCount])=>({day,messageCount})),
    sourceMessages:Object.fromEntries(sourceCounts)};
}
