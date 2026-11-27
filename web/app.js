import { selectPeriod, periodBounds, shiftAnchor } from "./data-model.mjs";
import { mountFeatures } from "./features-ui.mjs";
import { mountCloud } from "./cloud-view.mjs";
import { mountDialogs } from "./dialogs.mjs";
import { mountNavigation } from "./navigation.mjs";
import { $, element, button, toast, drawTrend } from "./ui.mjs";

const state = {
  mode: "refined",
  sources: new Set(),
  limit: 24,
  query: "",
  period: "all",
  anchor: "",
};
let dataset, selectedPeriod, features, dialogs, cloud, resizeTimer;
const demo = new URLSearchParams(location.search).get("demo") === "1";
const colors = ["#9cdbc4", "#f0ddbf", "#d69987", "#a8b9be"];
function sourceColor(name) {
  const index = Object.keys(dataset.sources).indexOf(name);
  return colors[Math.max(0, index) % colors.length];
}
const navigation = mountNavigation({
  onView: (id) => {
    if (!dataset) return;
    if (id === "cloud-stage") renderCloud();
    if (id === "adapter-section") cloud.renderSources(dataset);
  },
});
function filterWords() {
  return selectedPeriod.words
    .filter(
      (word) =>
        !state.query ||
        word.text
          .toLocaleLowerCase("zh-CN")
          .includes(state.query.trim().toLocaleLowerCase("zh-CN")),
    )
    .slice(0, state.limit);
}
function emptyState(
  title,
  description,
  { reset = false, retry = false, showDemo = false } = {},
) {
  $("empty-state").hidden = false;
  $("empty-state").querySelector("strong")?.remove();
  const heading = element("strong", title);
  $("empty-state").prepend(heading);
  $("empty-state").querySelector("p").textContent = description;
  $("reset-filters").hidden = !reset;
  $("retry-data").hidden = !retry;
  $("demo-link").hidden = !showDemo;
}
function renderCloud() {
  if (!dataset) return;
  selectedPeriod = selectPeriod(dataset, state);
  const words = filterWords();
  $("stat-messages").textContent = String(selectedPeriod.messageCount);
  $("summary-messages").textContent = String(selectedPeriod.messageCount);
  $("stat-words").textContent = String(selectedPeriod.words.length);
  const span = selectedPeriod.firstDay
    ? (new Date(selectedPeriod.lastDay + "T00:00:00Z") -
        new Date(selectedPeriod.firstDay + "T00:00:00Z")) /
        86400000 +
      1
    : 0;
  $("summary-days").textContent = String(span);
  $("period-summary").textContent = periodLabel();
  $("source-filter-open").firstChild.textContent =
    state.sources.size ===
    Object.values(dataset.sources).filter((source) => source.messages > 0)
      .length
      ? "全部来源 "
      : `${state.sources.size} 个来源 `;
  $("empty-state").hidden = words.length > 0;
  if (!words.length) {
    if (!dataset.buckets.length)
      emptyState(
        "还没有找到你的对话记录",
        "确认本机已有受支持客户端的记录，重新启动后读取本地快照。",
        { showDemo: false },
      );
    else if (!state.sources.size)
      emptyState(
        "还没有选择参与统计的来源",
        "选择至少一个来源，或恢复全部来源。",
        { reset: true },
      );
    else if (state.query)
      emptyState("暂时没找到这个词", "试试其他词，或清空搜索。", {
        reset: true,
      });
    else if (selectedPeriod.messageCount)
      emptyState(
        "有消息记录，但没有有效词",
        "试试原始词频，或选择其他时间范围。",
        { reset: true },
      );
    else
      emptyState(
        "这个范围还没有记录",
        "试试选择更长的时间范围，或查看全部记录。",
        { reset: true },
      );
  }
  cloud.render(words, selectedPeriod);
  renderActivity();
  features?.refresh();
}
function periodLabel() {
  let label = "全部时间";
  if (state.period === "month")
    label = `${state.anchor.slice(0, 4)} 年 ${Number(state.anchor.slice(5, 7))} 月`;
  else if (state.period === "year") label = `${state.anchor.slice(0, 4)} 年`;
  else if (state.period === "day") label = state.anchor;
  else if (state.period === "week") {
    const bounds = periodBounds(state.period, state.anchor);
    label = `${bounds.start} — ${shiftAnchor("day", bounds.end, -1)}`;
  }
  if (selectedPeriod?.unknownMessages)
    label += ` · ${selectedPeriod.unknownMessages} 条日期未知`;
  return demo ? `${label} / 演示数据` : label;
}
function syncPeriodInput() {
  const input = $("period-anchor"),
    disabled = state.period === "all";
  input.disabled = disabled;
  $("period-prev").disabled = disabled;
  $("period-next").disabled = disabled;
  input.removeAttribute("min");
  input.removeAttribute("max");
  if (state.period === "month") {
    input.type = "month";
    input.value = state.anchor.slice(0, 7);
  } else if (state.period === "year") {
    input.type = "number";
    input.min = "1900";
    input.max = "9998";
    input.value = state.anchor.slice(0, 4);
  } else {
    input.type = "date";
    input.value = state.anchor;
  }
  $("period-kind").value = state.period;
  $("period-label").textContent =
    state.period === "all"
      ? "全部时间"
      : state.period === "month"
        ? `${state.anchor.slice(0, 4)} 年 ${Number(state.anchor.slice(5, 7))} 月`
        : state.period === "year"
          ? `${state.anchor.slice(0, 4)} 年`
          : state.anchor;
}
function changePeriod(kind, anchor) {
  state.period = kind;
  state.anchor = anchor;
  syncPeriodInput();
  dialogs.closeDetail();
  renderCloud();
}
function selectDay(day) {
  changePeriod("day", day);
  navigation.show("cloud-stage");
}
function renderActivity() {
  let days = selectedPeriod.days;
  if (state.period === "month" || state.period === "week") {
    const { start, end } = periodBounds(state.period, state.anchor),
      counts = new Map(days.map((day) => [day.day, day.messageCount]));
    days = [];
    const cutoff = dataset.meta.lastDay;
    for (
      let day = start;
      day < end && (!cutoff || day <= cutoff);
      day = shiftAnchor("day", day, 1)
    )
      days.push({ day, messageCount: counts.get(day) || 0 });
  }
  // B's timeline is a compact entry point; the calendar holds the full history.
  days = days.slice(-31);
  const max = Math.max(1, ...days.map((day) => day.messageCount));
  $("activity-bars").replaceChildren(
    ...days.map(({ day, messageCount }) => {
      const node = button("", () => selectDay(day));
      node.dataset.day = day;
      node.dataset.count = messageCount;
      node.style.setProperty(
        "--height",
        `${Math.max(messageCount ? 12 : 2, (messageCount / max) * 84)}%`,
      );
      node.title = `${day}，${messageCount} 条消息`;
      node.setAttribute("aria-label", node.title);
      node.classList.toggle(
        "active",
        state.period === "day" && state.anchor === day,
      );
      return node;
    }),
  );
  $("activity-title").textContent =
    state.period === "month"
      ? `${Number(state.anchor.slice(5, 7))}月的对话节奏`
      : "这段时间的对话节奏";
  const ticks = days.length
    ? [
        days[0],
        days[Math.floor((days.length - 1) / 4)],
        days[Math.floor((days.length - 1) / 2)],
        days[Math.floor(((days.length - 1) * 3) / 4)],
        days.at(-1),
      ]
    : [];
  drawTrend(
    $("summary-trend"),
    days.map(({ day, messageCount }) => [day, messageCount]),
  );
  $("activity-ticks").replaceChildren(
    ...ticks.map(({ day }, index) =>
      element(
        "span",
        index === 0
          ? `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日`
          : `${Number(day.slice(8))} 日`,
      ),
    ),
  );
}
function renderSourceFilters() {
  $("source-filters").replaceChildren(element("legend", "来源"));
  for (const [name, source] of Object.entries(dataset.sources)) {
    const available =
      ["available", "partial"].includes(source.state) && source.messages > 0;
    if (!available) continue;
    state.sources.add(name);
    const label = element("label", "", "source-filter"),
      input = element("input");
    input.type = "checkbox";
    input.dataset.source = name;
    input.checked = true;
    input.setAttribute("aria-label", name);
    input.onchange = () => {
      input.checked ? state.sources.add(name) : state.sources.delete(name);
      dialogs.closeDetail();
      renderCloud();
    };
    label.append(input, element("span", name));
    $("source-filters").append(label);
  }
}
function renderDiagnostics() {
  const names = {
    available: "已读取",
    partial: "部分可读",
    unreadable: "无法读取",
    absent: "未发现记录",
    unsupported: "暂不支持",
  };
  $("source-diagnostics").replaceChildren(
    ...Object.entries(dataset.sources).map(([name, source]) => {
      const row = element("div", "", "source-row");
      row.dataset.state = source.state;
      const description = element("div");
      description.append(
        element("h3", name),
        element("p", `${source.messages} 条已读取消息`),
      );
      const status = element(
        "span",
        names[source.state] || "状态未知",
        "source-state",
      );
      row.append(description, status);
      return row;
    }),
  );
  const readable = Object.values(dataset.sources).filter(
    (source) => source.messages > 0,
  ).length;
  $("source-summary").textContent =
    `${readable} / ${Object.keys(dataset.sources).length} 个来源可读${demo ? "，当前为匿名模拟记录" : ""}`;
}
function bindControls() {
  $("period-kind").onchange = (event) =>
    changePeriod(event.target.value, state.anchor);
  $("period-anchor").onchange = (event) => {
    const anchor =
      event.target.value +
      (state.period === "month"
        ? "-01"
        : state.period === "year"
          ? "-01-01"
          : "");
    try {
      periodBounds(state.period, anchor);
      changePeriod(state.period, anchor);
    } catch {
      toast("请选择有效日期");
      syncPeriodInput();
    }
  };
  for (const [id, direction] of [
    ["period-prev", -1],
    ["period-next", 1],
  ])
    $(id).onclick = () =>
      changePeriod(
        state.period,
        shiftAnchor(state.period, state.anchor, direction),
      );
  document.querySelectorAll("[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        state.mode = button.dataset.mode;
        document.querySelectorAll("[data-mode]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-pressed", active);
        });
        dialogs.closeDetail();
        renderCloud();
      }),
  );
  $("word-search").oninput = (event) => {
    state.query = event.target.value;
    renderCloud();
  };
  $("word-limit").oninput = (event) => {
    state.limit = Number(event.target.value);
    $("limit-output").value = event.target.value;
    renderCloud();
  };
  $("export-png").onclick = () => dialogs.exportShare("cloud");
  $("reset-filters").onclick = () => {
    state.query = "";
    $("word-search").value = "";
    document.querySelectorAll("#source-filters input").forEach((input) => {
      input.checked = true;
      state.sources.add(input.dataset.source);
    });
    if (!selectedPeriod.messageCount)
      changePeriod(
        demo ? "month" : "all",
        dataset.meta.lastDay || state.anchor,
      );
    else renderCloud();
  };
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderCloud();
      cloud.renderSources(dataset);
    }, 120);
  }).observe($("word-cloud"));
}
async function init() {
  document.querySelector(".share-link").disabled = true;
  $("export-png").disabled = true;
  document.body.classList.add("loading");
  emptyState("正在整理关注场…", "读取聚合记录，不读取原始对话。");
  try {
    if (demo) {
      const { createDemoData } = await import("./.local-preview/demo-data.mjs");
      dataset = createDemoData();
    } else {
      const response = await fetch("data.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      dataset = await response.json();
    }
    if (dataset.meta?.schemaVersion !== 2 || !Array.isArray(dataset.buckets))
      throw new Error("请重新生成数据快照");
    state.sources.clear();
    state.anchor =
      dataset.meta.lastDay || new Date().toISOString().slice(0, 10);
    state.period = demo ? "month" : "all";
    $("data-mode").textContent = demo ? "演示数据" : "本地数据";
    document.body.dataset.demo = String(demo);
    syncPeriodInput();
    selectedPeriod = selectPeriod(dataset, state);
    if (!dialogs) {
      dialogs = mountDialogs({
        getSelection: () => selectedPeriod,
        getVisibleWords: filterWords,
        getRecap: () => features?.getRecap(),
        getData: () => dataset,
        colorForSource: sourceColor,
      });
      cloud = mountCloud({
        showDetail: dialogs.showDetail,
        colorForSource: sourceColor,
      });
      bindControls();
    }
    renderSourceFilters();
    renderDiagnostics();
    features = mountFeatures({
      data: dataset,
      getState: () => state,
      onRefresh: () => dialogs.refreshShare(),
      selectDay,
      selectPeriod: (kind, anchor) => {
        changePeriod(kind, anchor);
        navigation.show("cloud-stage");
      },
      showWord: dialogs.showDetail,
    });
    renderCloud();
  } catch (error) {
    dataset = null;
    $("period-summary").textContent = "数据未加载";
    emptyState(
      "数据暂时无法加载",
      "重新加载聚合快照，或使用演示数据。网页不会执行扫描。",
      { retry: true, showDemo: false },
    );
    $("cloud-status").textContent = error.message;
  } finally {
    document.body.classList.remove("loading");
    document.querySelector(".share-link").disabled = !dataset;
    $("export-png").disabled = !dataset;
  }
}
$("retry-data").onclick = init;
init();
