import {createShareContent,drawShare,canvasToPng} from './share.mjs';
import {layoutWords as placeWords} from './cloud-layout.mjs';
import { selectPeriod, periodBounds, shiftAnchor } from './data-model.mjs';
import {mountFeatures} from './features-ui.mjs';

const SOURCE_COLORS = {
  "TRAE": "#287f83",
  "Codex": "#7560b7",
  mixed: "#777087",
};

const state = {
  mode: "refined",
  sources: new Set(),
  limit: 90,
  query: "",
  selectedWord: null,
  period: "all",
  anchor: "",
};

let dataset;
let lastLayout = [];
let resizeTimer;
let selectedPeriod;
let features;
let shareError='';
const svg = document.querySelector("#word-cloud");

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { notation: value > 9999 ? "compact" : "standard" }).format(value || 0);
}

function filterWords(data, currentState) {
  selectedPeriod = selectPeriod(data,currentState);
  const query = currentState.query.trim().toLocaleLowerCase('zh-CN');
  return selectedPeriod.words
    .filter(word => !query || word.text.toLocaleLowerCase('zh-CN').includes(query))
    .slice(0,currentState.limit)
    .map(word => ({...word,filteredCount:word.count}));
}

function sourceColor(name) {
  if (!SOURCE_COLORS[name]) {
    const names = Object.keys(dataset.sources);
    const index = names.indexOf(name);
    SOURCE_COLORS[name] = `hsl(${(index * 137.508 + 170) % 360} 35% 43%)`;
  }
  return SOURCE_COLORS[name];
}

function layoutWords(words,width,height) {
  const ctx=document.createElement('canvas').getContext('2d');
  const family=getComputedStyle(document.body).fontFamily;
  return placeWords(words,width,height,(text,size)=>{ctx.font=`560 ${size}px ${family}`;return ctx.measureText(text).width;});
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function decorativeOrbit(width, height) {
  const group = svgElement("g", { "aria-hidden": "true" });
  [0.23, 0.37].forEach((scale, index) => {
    group.append(svgElement("ellipse", {
      class: "orbit",
      cx: width / 2,
      cy: height / 2,
      rx: width * scale,
      ry: height * scale * 0.73,
      transform: `rotate(${index ? -12 : 17} ${width / 2} ${height / 2})`,
    }));
  });
  group.append(svgElement("circle", { class: "orbit-node", cx: width * 0.74, cy: height * 0.31, r: 2.2 }));
  return group;
}

function renderCloud() {
  if (!dataset) return;
  const bounds = svg.getBoundingClientRect();
  const width = Math.max(320, Math.round(bounds.width));
  const height = Math.max(320, Math.round(bounds.height));
  const words = filterWords(dataset, state);
  lastLayout = layoutWords(words, width, height);
  svg.replaceChildren(decorativeOrbit(width, height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const group = svgElement("g");
  lastLayout.forEach((word) => {
    const sourceClass = word.dominant.replaceAll(" ", "-");
    const node = svgElement("text", {
      class: `word word-${sourceClass}${state.query ? " search-hit" : ""}`,
      x: word.x,
      y: word.y,
      "font-size": word.fontSize,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      tabindex: "0",
      role: "button",
      "aria-label": `${word.text}，${word.filteredCount} 次`,
      "data-word": word.text,
    });
    node.textContent = word.text;
    node.style.fill = sourceColor(word.dominant);
    node.style.color = sourceColor(word.dominant);
    node.append(svgElement("title"));
    node.querySelector("title").textContent = `${word.text} · ${word.filteredCount} 次`;
    node.addEventListener("click", () => showDetail(word));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showDetail(word);
      }
    });
    group.append(node);
  });
  svg.append(group);
  requestAnimationFrame(() => group.querySelectorAll(".word").forEach((word) => word.classList.add("entered")));

  document.querySelector("#empty-state").hidden = words.length > 0;
  document.querySelector("#cloud-status").textContent = `当前显示 ${lastLayout.length} 个词语`;
  document.querySelector('#stat-words').textContent = formatNumber(selectedPeriod.words.length);
  document.querySelector('#stat-messages').textContent = formatNumber(selectedPeriod.messageCount);
  updatePeriodSummary();
  renderOverview();
  features?.refresh();
}

function renderOverview() {
  const list = document.querySelector('#top-word-list');
  list.replaceChildren();
  const words = selectedPeriod.words.slice(0, 6);
  for (const word of words) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `${word.text}，${word.count} 次，查看详情`);
    const label = document.createElement('span');
    label.className = 'ranking-word';
    label.textContent = word.text;
    const count = document.createElement('span');
    count.className = 'ranking-count';
    count.textContent = formatNumber(word.count);
    const unit = document.createElement('small');
    unit.textContent = '次';
    count.append(unit);
    const meter = document.createElement('span');
    meter.className = 'ranking-meter';
    meter.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    fill.style.width = `${word.count / words[0].count * 100}%`;
    meter.append(fill);
    button.append(label, count, meter);
    button.addEventListener('click', () => showDetail({...word, filteredCount: word.count}));
    item.append(button);
    list.append(item);
  }
  if (!words.length) {
    const empty = document.createElement('li');
    empty.textContent = '这个范围还没有有效词语';
    empty.className = 'overview-empty';
    list.append(empty);
  }
  const root = document.querySelector('#source-distribution');
  root.replaceChildren();
  const entries = Object.entries(selectedPeriod.sourceMessages).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  for (const [name, count] of entries) {
    const row = document.createElement('div');
    row.className = 'distribution-row';
    const label = document.createElement('div');
    label.className = 'distribution-label';
    const title = document.createElement('span');
    const dot = document.createElement('i');
    dot.style.background = sourceColor(name);
    title.append(dot, document.createTextNode(name));
    const value = document.createElement('span');
    value.textContent = `${Math.round(count / total * 100)}%`;
    row.title = `${name}：${count} 条消息`;
    label.append(title, value);
    const track = document.createElement('div');
    track.className = 'distribution-track';
    const fill = document.createElement('i');
    fill.style.width = `${count / total * 100}%`;
    fill.style.background = sourceColor(name);
    track.append(fill);
    row.append(label, track);
    root.append(row);
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'overview-empty';
    empty.textContent = '这个范围未读取到对话';
    root.append(empty);
  }
}

function bindNavigation() {
  const links = [...document.querySelectorAll('.main-nav a')];
  function markCurrent(target) {
    for (const link of links) {
      const active = link.hash === `#${target.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', () => {
      const target=document.getElementById(link.hash.slice(1));
      if (target) markCurrent(target);
    });
  });
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) markCurrent(entry.target);
  }, {rootMargin: '-15% 0px -65% 0px', threshold: 0});
  for (const link of links) observer.observe(document.getElementById(link.hash.slice(1)));
}

function sourceClass(name) {
  return name.replaceAll(" ", "-");
}

function showDetail(word) {
  state.selectedWord = word;
  const panel = document.querySelector("#detail-panel");
  panel.inert = false;
  document.querySelector("#detail-word").textContent = word.text;
  document.querySelector("#detail-count").textContent = formatNumber(word.filteredCount);
  document.querySelector("#detail-panel h3 + #detail-trend")?.setAttribute("aria-label", "当前范围使用趋势");
  const sourceRoot = document.querySelector("#detail-sources");
  const sourceEntries = Object.entries(word.sources)
    .filter(([source]) => state.sources.has(source))
    .sort((a, b) => b[1] - a[1]);
  const sourceTotal = sourceEntries.reduce((sum, [, count]) => sum + count, 0) || 1;
  sourceRoot.replaceChildren(...sourceEntries.map(([source, count]) => {
    const row = document.createElement("div");
    row.className = "source-bar";
    row.innerHTML = `<div class="source-bar-label"><span>${source}</span><span>${count}</span></div><div class="source-bar-track"><div class="source-bar-fill ${sourceClass(source)}" style="width:${count / sourceTotal * 100}%;background:${sourceColor(source)};color:${sourceColor(source)}"></div></div>`;
    return row;
  }));
  renderTrend(word.months);
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.querySelector("#detail-close").focus({ preventScroll: true });
}

function renderTrend(months) {
  const trend = document.querySelector("#detail-trend");
  const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  const width = 320;
  const height = 120;
  const padding = 16;
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const points = entries.map(([month, value], index) => ({
    month,
    value,
    x: entries.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (entries.length - 1),
    y: height - 28 - value / max * (height - 48),
  }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = points.length ? `${path} L${points.at(-1).x},${height - 28} L${points[0].x},${height - 28} Z` : "";
  trend.innerHTML = `<defs><linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6355c8"/><stop offset="1" stop-color="#6355c8" stop-opacity="0"/></linearGradient></defs><path class="trend-area" d="${area}"/><path class="trend-line" d="${path}"/>`;
  points.forEach((point, index) => {
    trend.append(svgElement("circle", { class: "trend-dot", cx: point.x, cy: point.y, r: 3 }));
    if (index === 0 || index === points.length - 1) {
      const label = svgElement("text", { class: "trend-label", x: point.x, y: height - 8, "text-anchor": index ? "end" : "start" });
      label.textContent = point.month;
      trend.append(label);
    }
  });
}

function closeDetail() {
  const panel = document.querySelector("#detail-panel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;
  if (state.selectedWord) svg.querySelector(`[data-word="${CSS.escape(state.selectedWord.text)}"]`)?.focus({preventScroll:true});
}

function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2200);
}

function shareOptions(kind) {
  return {kind:kind || document.querySelector('#share-kind').value,
    size:document.querySelector('#share-size').value,title:document.querySelector('#share-title').value,
    showRange:document.querySelector('#share-show-range').checked,
    showMessages:document.querySelector('#share-show-messages').checked,
    showTopWords:document.querySelector('#share-show-top').checked,
    showSources:document.querySelector('#share-show-sources').checked};
}
function shareContent(options) {
  const visibleWords=filterWords(dataset,state);
  return createShareContent({selection:selectedPeriod,recap:features.getRecap(),visibleWords,
    rangeLabel:document.querySelector('#period-summary').textContent},options);
}
function refreshShare() {
  if (!features) return;
  const options=shareOptions(),content=shareContent(options);
  const available=content.words.length>0 || (options.kind==='recap' && (content.summary?.activeDays>0 || content.messageCount>0));
  document.querySelector('#share-export').disabled=!available;
  document.querySelector('#share-status').textContent=shareError || (available?'':`当前没有可分享的${options.kind==='cloud'?'词语':'回顾'}`);
}
async function exportShare(kind) {
  const button=document.querySelector('#share-export');
  button.disabled=true;
  try {
    const canvas=document.createElement('canvas'),options=shareOptions(kind);
    drawShare(canvas,shareContent(options),options,sourceColor);
    const blob=await canvasToPng(canvas),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`lingua-orbit-${options.kind}-${options.size}.png`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);shareError='';
    document.querySelector('#share-dialog').close();toast('PNG 已导出');
  } catch (error) {shareError=error.message;toast(shareError);}
  finally {refreshShare();}
}
function exportPng() {return exportShare('cloud');}

function renderSourceFilters() {
  const root = document.querySelector("#source-filters");
  const legend = root.querySelector("legend");
  root.replaceChildren(legend);
  Object.entries(dataset.sources).forEach(([name, source]) => {
    const available = ["available", "partial"].includes(source.state) && source.messages > 0;
    if (!available) return;
    if (available) state.sources.add(name);
    const label = document.createElement("label");
    label.className = "source-filter";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.source = name;
    input.checked = available;
    input.disabled = !available;
    input.setAttribute("aria-label", `${name}${available ? "" : `，${source.detail}`}`);
    input.addEventListener("change", () => {
      input.checked ? state.sources.add(name) : state.sources.delete(name);
      closeDetail();
      renderCloud();
    });
    const text = document.createElement("span");
    text.textContent = name;
    text.style.setProperty("--source-color", sourceColor(name));
    text.title = available ? `${source.messages} 条消息` : source.detail;
    label.append(input, text);
    root.append(label);
  });
}

function updatePeriodSummary() {
  const label = document.querySelector('#period-summary');
  if(state.period==='all') label.textContent='全部时间';
  else {
    const bounds=periodBounds(state.period,state.anchor);
    const last = shiftAnchor('day',bounds.end,-1);
    label.textContent=state.period==='day' ? bounds.start : `${bounds.start} — ${last}`;
  }
  if(selectedPeriod.unknownMessages) label.textContent+=` · ${selectedPeriod.unknownMessages} 条日期未知`;
  const range=document.querySelector('#stat-range');
  range.textContent=selectedPeriod.firstDay ? `${selectedPeriod.firstDay} → ${selectedPeriod.lastDay}` : '无记录';
}

function syncPeriodInput() {
  const input = document.querySelector('#period-anchor');
  const disabled=state.period==='all';
  input.disabled=disabled;
  document.querySelector('#period-prev').disabled=disabled;
  document.querySelector('#period-next').disabled=disabled;
  if(state.period==='month') {input.type='month';input.value=state.anchor.slice(0,7);}
  else if(state.period==='year') {input.type='number';input.min='1900';input.max='9998';input.value=state.anchor.slice(0,4);}
  else {input.type='date';input.removeAttribute('min');input.removeAttribute('max');input.value=state.anchor;}
}

function renderMeta() {
  state.anchor=dataset.meta.lastDay || new Date().toISOString().slice(0,10);
  syncPeriodInput();
  const status=document.querySelector('#source-status');
  const readable=Object.values(dataset.sources).filter(s=>s.messages>0).length;
  status.textContent=`${readable} / ${Object.keys(dataset.sources).length}`;
  renderSourceCloud();
}

function renderSourceCloud() {
  if (!dataset) return;
  const cloud=document.querySelector('#source-cloud'),bounds=cloud.getBoundingClientRect();
  const width=Math.max(280,Math.round(bounds.width)),height=Math.max(320,Math.round(bounds.height));
  const words=Object.entries(dataset.sources).map(([name,source])=>({text:name,count:source.messages,sources:{[name]:source.messages}})).sort((a,b)=>b.count-a.count);
  let layoutWidth=width,layoutHeight=height,placed=layoutWords(words,width,height);
  for (let attempt=0;placed.length<words.length && attempt<6;attempt++) {
    layoutWidth*=1.3;layoutHeight*=1.3;
    placed=layoutWords(words,layoutWidth,layoutHeight);
  }
  cloud.replaceChildren();
  cloud.setAttribute('viewBox',`0 0 ${layoutWidth} ${layoutHeight}`);
  for (const word of placed) {
    const node=svgElement('text',{class:'source-word',x:word.x,y:word.y,'font-size':word.fontSize,
      'text-anchor':'middle','dominant-baseline':'central',tabindex:'0','data-source':word.text,
      'aria-label':`${word.text}，${word.count} 条消息`});
    node.textContent=word.text;
    node.style.fill=sourceColor(word.text);
    const title=svgElement('title');title.textContent=`${word.count} 条消息`;node.append(title);
    cloud.append(node);
  }
}

function bindControls() {
  document.querySelector('#period-kind').addEventListener('change', event => {
    state.period=event.target.value;syncPeriodInput();closeDetail();renderCloud();
  });
  document.querySelector('#period-anchor').addEventListener('change', event => {
    let value=event.target.value;
    if(state.period==='month') value+='-01';
    else if(state.period==='year') value+='-01-01';
    try {periodBounds(state.period,value);} catch {toast('请选择有效日期');return;}
    state.anchor=value;closeDetail();renderCloud();
  });
  for(const [id,direction] of [['period-prev',-1],['period-next',1]]) {
    document.querySelector(`#${id}`).addEventListener('click',()=>{
      state.anchor=shiftAnchor(state.period,state.anchor,direction);syncPeriodInput();closeDetail();renderCloud();
    });
  }
  document.querySelectorAll("#mode-toggle button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll("#mode-toggle button").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      closeDetail();
      renderCloud();
    });
  });
  const limit = document.querySelector("#word-limit");
  limit.addEventListener("input", () => {
    state.limit = Number(limit.value);
    document.querySelector("#limit-output").value = limit.value;
    renderCloud();
  });
  document.querySelector("#word-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderCloud();
  });
  document.querySelector("#export-png").addEventListener("click", exportPng);
  const dialog=document.querySelector('#share-dialog');
  document.querySelector('.share-link').addEventListener('click',()=>{shareError='';refreshShare();dialog.showModal();});
  document.querySelector('#share-close').addEventListener('click',()=>dialog.close());
  document.querySelector('#share-form').addEventListener('submit',event=>{event.preventDefault();exportShare();});
  for (const id of ['share-kind','share-size','share-title','share-show-range','share-show-messages','share-show-top','share-show-sources']) {
    document.querySelector('#'+id).addEventListener(id==='share-title'?'input':'change',()=>{shareError='';refreshShare();});
  }

  document.querySelector("#detail-close").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => event.key === "Escape" && closeDetail());
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=>{renderCloud();renderSourceCloud();}, 120);
  }).observe(document.querySelector(".visual-frame"));
}

async function init() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = await response.json();
    if(dataset.meta.schemaVersion !== 2 || !Array.isArray(dataset.buckets)) throw new Error("请重新运行数据生成器升级快照");
    renderMeta();
    renderSourceFilters();
    features=mountFeatures({data:dataset,getState:()=>state,onRefresh:()=>refreshShare(),
      selectDay:day=>{state.period='day';state.anchor=day;document.querySelector('#period-kind').value='day';syncPeriodInput();closeDetail();renderCloud();},
      selectPeriod:(kind,anchor)=>{state.period=kind;state.anchor=anchor;document.querySelector('#period-kind').value=kind;syncPeriodInput();closeDetail();renderCloud();},
      });
    bindControls();
    renderCloud();
  } catch (error) {
    document.querySelector("#empty-state").hidden = false;
    document.querySelector("#empty-state strong").textContent = "数据暂时无法加载";
    document.querySelector("#empty-state p").textContent = "请运行 start.sh / start.cmd 生成数据并打开本地页面。";
    console.error(error);
  }
}

bindNavigation();
init();
