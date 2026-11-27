import { layoutField, layoutWords } from "./cloud-layout.mjs";
import { $, element, button, svgElement, drawTrend } from "./ui.mjs";

const WORD_COLORS = ["#a6dfce", "#f0ddbf", "#d69987"];
export function mountCloud({ showDetail, colorForSource }) {
  const svg = $("word-cloud"),
    measure = document.createElement("canvas").getContext("2d");
  function render(words, selection) {
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) return;
    const family = getComputedStyle(document.body).fontFamily;
    const placed = layoutField(words, width, height, (text, size) => {
      measure.font = `500 ${size}px ${family}`;
      return (
        measure.measureText(text).width -
        Math.max(0, [...text].length - 1) * (width < 600 ? 1 : 3)
      );
    });
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();
    for (const word of placed) {
      const group = svgElement("g");
      const hit = svgElement("rect", {
        class: "word-hit",
        x: word.x - Math.max(44, word.width) / 2,
        y: word.y - Math.max(44, word.height) / 2,
        width: Math.max(44, word.width),
        height: Math.max(44, word.height),
        rx: 6,
        "aria-hidden": "true",
      });
      const node = svgElement("text", {
        class: `word word-${word.rank}`,
        x: word.x,
        y: word.y,
        "font-size": word.fontSize,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        tabindex: 0,
        role: "button",
        "data-word": word.text,
        "aria-label": `${word.text}，${word.count} 次`,
      });
      node.textContent = word.text;
      node.style.fill = word.rank < 11 ? WORD_COLORS[word.rank % 3] : "#a8b9be";
      if (word.rank >= 11) node.style.letterSpacing = "-1px";
      const title = svgElement("title");
      title.textContent = `${word.count} 次`;
      node.append(title);
      for (const target of [node, hit])
        target.addEventListener("click", () => showDetail(word, node));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showDetail(word, node);
        }
      });
      group.append(hit, node);
      svg.append(group);
    }
    requestAnimationFrame(() =>
      svg
        .querySelectorAll(".word")
        .forEach((node) => node.classList.add("entered")),
    );
    $("cloud-status").textContent =
      `当前显示 ${placed.length} 个词语，共 ${selection.words.length} 个有效词`;
    $("explore-word").disabled = !words.length;
    $("explore-word").textContent = words.length
      ? `先从「${words[0].text}」开始\n查看这个词的轨迹`
      : "当前还没有可探索的词";
    $("explore-word").onclick = () =>
      words[0] && showDetail(words[0], $("explore-word"));
    renderOverview(selection);
    drawTrend(
      $("summary-trend"),
      selection.days.map(({ day, messageCount }) => [day, messageCount]),
    );
    return placed;
  }
  function renderOverview(selection) {
    $("top-word-list").replaceChildren(
      ...selection.words.slice(0, 6).map((word) => {
        const item = element("li"),
          action = button("", () => showDetail(word, action));
        const label = element("span", word.text, "ranking-word"),
          count = element("span", String(word.count), "ranking-count");
        count.append(element("small", "次"));
        const meter = element("span", "", "ranking-meter"),
          fill = element("i");
        fill.style.width = `${(word.count / selection.words[0].count) * 100}%`;
        meter.append(fill);
        action.append(label, count, meter);
        item.append(action);
        return item;
      }),
    );
    if (!selection.words.length)
      $("top-word-list").append(
        element("li", "这个范围还没有有效词语", "overview-empty"),
      );
    const entries = Object.entries(selection.sourceMessages)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    $("source-distribution").replaceChildren(
      ...entries.map(([name, count]) => {
        const row = element("div", "", "distribution-row"),
          label = element("div", "", "distribution-label"),
          title = element("span", name),
          dot = element("i");
        dot.style.background = colorForSource(name);
        title.prepend(dot);
        label.append(
          title,
          element("span", `${Math.round((count / total) * 100)}%`),
        );
        const track = element("div", "", "distribution-track"),
          fill = element("i");
        fill.style.width = `${(count / total) * 100}%`;
        fill.style.background = colorForSource(name);
        track.append(fill);
        row.append(label, track);
        return row;
      }),
    );
    if (!entries.length)
      $("source-distribution").append(
        element("p", "这个范围未读取到对话", "overview-empty"),
      );
  }
  function renderSources(data) {
    const cloud = $("source-cloud"),
      width = cloud.clientWidth;
    if (!width) return;
    const words = Object.entries(data.sources)
      .map(([text, source]) => ({
        text,
        count: source.messages,
        sources: { [text]: source.messages },
      }))
      .sort((a, b) => b.count - a.count);
    let layoutWidth = width,
      layoutHeight = 240,
      placed = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      placed = layoutWords(words, layoutWidth, layoutHeight, (text, size) => {
        measure.font = `500 ${size}px ${getComputedStyle(document.body).fontFamily}`;
        return measure.measureText(text).width;
      });
      if (placed.length === words.length) break;
      layoutWidth *= 1.3;
      layoutHeight *= 1.3;
    }
    cloud.replaceChildren();
    cloud.setAttribute("viewBox", `0 0 ${layoutWidth} ${layoutHeight}`);
    placed.forEach((word) => {
      const text = svgElement("text", {
        class: "source-word",
        x: word.x,
        y: word.y,
        "font-size": word.fontSize,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        tabindex: 0,
        "data-source": word.text,
        "aria-label": `${word.text}，${word.count} 条消息`,
        fill: colorForSource(word.text),
      });
      text.textContent = word.text;
      const title = svgElement("title");
      title.textContent = `${word.count} 条消息`;
      text.append(title);
      cloud.append(text);
    });
  }
  return { render, renderSources };
}
