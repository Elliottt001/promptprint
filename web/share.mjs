import { layoutField as layoutWords } from "./cloud-layout.mjs";

export const SHARE_SIZES = {
  square: [1080, 1080],
  portrait: [1080, 1440],
  landscape: [1620, 1080],
};
export function createShareContent(
  {
    selection,
    recap,
    visibleWords,
    rangeLabel,
    demo = false,
    settings = { productLabels: {} },
  },
  options,
) {
  if (!["cloud", "recap"].includes(options.kind) || !SHARE_SIZES[options.size])
    throw new Error("分享选项无效");
  if (options.kind === "recap" && !recap) throw new Error("没有可分享的回顾");
  const chosen = options.kind === "recap" ? recap.selection : selection;
  const sourceWords =
    options.kind === "recap" ? recap.selection.words : visibleWords;
  const words = sourceWords.map(({ text, count, sources, months }) => ({
    text,
    count,
    sources: { ...sources },
    months: { ...months },
  }));
  const sources = options.showSources
    ? Object.entries(chosen.sourceMessages).map(([name, messageCount]) => ({
        name,
        label: settings.productLabels[name] ?? "",
        messageCount,
      }))
    : [];
  return {
    demo,
    kind: options.kind,
    title: [...(options.title || "我的 AI 足迹")].slice(0, 80).join(""),
    rangeLabel: options.showRange
      ? options.kind === "recap"
        ? `${recap.range.start} → ${recap.range.end}`
        : rangeLabel
      : "",
    messageCount: options.showMessages ? chosen.messageCount : null,
    words,
    topWords: options.showTopWords ? words.slice(0, 5) : [],
    sources,
    summary:
      options.kind === "recap"
        ? {
            activeDays: recap.activity.activeDays,
            longestStreak: recap.activity.longestStreak,
            peakCount: recap.activity.peakCount,
            peakDays: [...recap.activity.peakDays],
            cutoffDay: recap.cutoffDay,
            partial: recap.partial,
          }
        : null,
  };
}
function wrapText(ctx, text, maxWidth) {
  const rows = [];
  let line = "";
  for (const character of text) {
    if (line && ctx.measureText(line + character).width > maxWidth) {
      rows.push(line);
      line = character;
    } else line += character;
  }
  if (line) rows.push(line);
  return rows;
}
export function drawShare(canvas, content, options, colorForSource) {
  if (!SHARE_SIZES[options.size] || content.kind !== options.kind)
    throw new Error("分享尺寸或内容无效");
  if (content.kind === "cloud" && !content.words.length)
    throw new Error("当前没有可分享的词语");
  if (
    content.kind === "recap" &&
    !content.words.length &&
    !content.summary?.activeDays &&
    !(content.messageCount > 0)
  )
    throw new Error("当前没有可分享的回顾");
  const [width, height] = SHARE_SIZES[options.size];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d"),
    drawnTexts = [],
    margin = Math.round(width * 0.04),
    innerWidth = width - margin * 2;
  const family = '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "#213b43";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#213b43";
  ctx.fillRect(margin / 2, margin / 2, width - margin, height - margin);
  const write = (text, x, y, color = "#edf4ef") => {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    drawnTexts.push(text);
  };
  const font = (size) => {
    ctx.font = `500 ${size}px ${family}`;
  };
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let titleSize = Math.round(width / 22),
    titleRows;
  do {
    font(titleSize);
    titleRows = wrapText(ctx, content.title, innerWidth);
    if (titleRows.length * titleSize * 1.3 <= height * 0.22) break;
    titleSize -= 2;
  } while (titleSize > 16);
  let y = margin;
  for (const row of titleRows) {
    write(row, margin, y, "#edf4ef");
    y += titleSize * 1.3;
  }
  const infoSize = Math.round(width / 26);
  font(infoSize);
  const info = [];
  if (content.rangeLabel) info.push(content.rangeLabel);
  if (content.messageCount !== null)
    info.push(`${content.messageCount} 条用户消息`);
  if (content.summary) {
    info.push(
      `${content.summary.activeDays} 个活跃日 · 最长连续 ${content.summary.longestStreak} 天`,
    );
    if (content.summary.partial)
      info.push(`截至快照日期 ${content.summary.cutoffDay}`);
  }
  for (const line of info)
    for (const row of wrapText(ctx, line, innerWidth)) {
      write(row, margin, y, "#a5b5bf");
      y += infoSize * 1.5;
    }
  y += margin / 2;
  const footer = [];
  if (content.topWords.length)
    footer.push(
      `Top 词：${content.topWords.map((word) => `${word.text} ${word.count}`).join(" · ")}`,
    );
  for (const source of content.sources)
    footer.push(
      `${source.name}${source.label ? `（${source.label}）` : ""} · ${source.messageCount} 条`,
    );
  const maxFooterLines = Math.max(
    2,
    Math.floor((height * 0.23) / (infoSize * 1.5)),
  );
  let footerRows = footer.flatMap((text) => wrapText(ctx, text, innerWidth));
  if (footerRows.length > maxFooterLines)
    footerRows = [...footerRows.slice(0, maxFooterLines - 1), "其余内容见页面"];
  const footerStart =
    height - margin - infoSize * 1.5 * (footerRows.length + 1);
  const cloudHeight = Math.max(60, footerStart - y - margin / 2);
  const placed = layoutWords(
    content.words,
    innerWidth,
    cloudHeight,
    (text, size) => {
      font(size);
      return ctx.measureText(text).width;
    },
    { fontScale: 1.5 },
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const word of placed) {
    font(word.fontSize);
    write(
      word.text,
      margin + word.x,
      y + word.y,
      ["#a6dfce", "#f0ddbf", "#d69987"][word.rank % 3],
    );
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  font(infoSize);
  footerRows.forEach((row, index) =>
    write(row, margin, footerStart + index * infoSize * 1.5, "#a5b5bf"),
  );
  font(infoSize);
  write(
    content.demo ? "Promptprint / 演示数据" : "聊了什么 / Promptprint",
    margin,
    height - margin - infoSize,
    "#a5b5bf",
  );
  return { width, height, wordCount: placed.length, drawnTexts };
}
export function canvasToPng(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG 导出失败，请重试")),
      "image/png",
    ),
  );
}
