import { createShareContent, drawShare, canvasToPng } from "./share.mjs";
import { $, element, drawTrend, toast } from "./ui.mjs";

export function mountDialogs({
  getSelection,
  getVisibleWords,
  getRecap,
  getData,
  colorForSource,
}) {
  let detailTrigger,
    shareTrigger,
    sourceTrigger,
    exporting = false,
    shareError = "";
  function bindDialog(id, closeId, restore) {
    const dialog = $(id);
    $(closeId).onclick = () => dialog.close();
    dialog.addEventListener("close", restore);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dialog.close();
      }
    });
    return dialog;
  }
  const detail = bindDialog("detail-panel", "detail-close", () => {
    detail.classList.remove("open");
    detailTrigger?.isConnected && detailTrigger.focus({ preventScroll: true });
  });
  const share = bindDialog("share-dialog", "share-close", () =>
    shareTrigger?.focus({ preventScroll: true }),
  );
  const source = bindDialog("source-filter-dialog", "source-filter-close", () =>
    sourceTrigger?.focus({ preventScroll: true }),
  );
  function showDetail(word, trigger) {
    detailTrigger = trigger;
    $("detail-word").textContent = word.text;
    $("detail-count").textContent = String(word.filteredCount ?? word.count);
    const entries = Object.entries(word.months || {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    drawTrend($("detail-trend"), entries, { bars: true });
    $("detail-trend-labels").replaceChildren(
      element("span", entries[0]?.[0] || "暂无时间信息"),
      element("span", entries.length > 1 ? entries.at(-1)[0] : ""),
    );
    $("detail-sources").replaceChildren(
      ...Object.entries(word.sources)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => {
          const row = element("div", "", "source-bar"),
            label = element("div", "", "source-bar-label"),
            track = element("div", "", "source-bar-track"),
            fill = element("div", "", "source-bar-fill");
          label.append(element("span", name), element("span", `${count} 次`));
          fill.style.width = `${(count / Math.max(1, word.count)) * 100}%`;
          fill.style.background = colorForSource(name);
          track.append(fill);
          row.append(label, track);
          return row;
        }),
    );
    detail.classList.add("open");
    detail.showModal();
    $("detail-close").focus({ preventScroll: true });
  }
  function options(kind) {
    return {
      kind: kind || $("share-kind").value,
      size: $("share-size").value,
      title: $("share-title").value,
      showRange: $("share-show-range").checked,
      showMessages: $("share-show-messages").checked,
      showTopWords: $("share-show-top").checked,
      showSources: $("share-show-sources").checked,
    };
  }
  function content(opts) {
    return createShareContent(
      {
        selection: getSelection(),
        visibleWords: getVisibleWords(),
        recap: getRecap(),
        rangeLabel: $("period-summary").textContent,
        demo: getData()?.meta.demo,
      },
      opts,
    );
  }
  function refreshShare() {
    if (!getSelection()) return;
    const opts = options();
    let value;
    try {
      value = content(opts);
    } catch (error) {
      shareError = error.message;
    }
    const available =
      !!value &&
      (value.words.length > 0 ||
        (opts.kind === "recap" &&
          (value.summary?.activeDays > 0 || value.messageCount > 0)));
    $("share-export").disabled = exporting || !available;
    $("share-export").textContent = exporting ? "正在导出…" : "下载 PNG";
    $("share-status").textContent =
      shareError ||
      (!available
        ? `当前没有可分享的${opts.kind === "cloud" ? "词语" : "回顾"}`
        : getData().meta.demo
          ? "将导出带有演示标记的模拟数据"
          : "");
    $("share-preview").hidden = !available;
    $("share-preview-empty").hidden = available;
    if (available) drawShare($("share-preview"), value, opts, colorForSource);
  }
  function openShare(trigger, kind) {
    shareTrigger = trigger;
    shareError = "";
    if (kind) $("share-kind").value = kind;
    refreshShare();
    share.showModal();
  }
  async function exportShare(kind) {
    if (exporting) return;
    const opts = options(kind);
    exporting = true;
    shareError = "";
    refreshShare();
    try {
      const canvas = document.createElement("canvas");
      drawShare(canvas, content(opts), opts, colorForSource);
      const blob = await canvasToPng(canvas),
        url = URL.createObjectURL(blob),
        link = element("a");
      link.href = url;
      link.download = `promptprint-${opts.kind}-${opts.size}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (share.open) share.close();
      toast("PNG 已导出");
    } catch (error) {
      shareError = error.message;
      toast(shareError);
      if (!share.open) share.showModal();
    } finally {
      exporting = false;
      refreshShare();
    }
  }
  document.querySelector(".share-link").onclick = (event) =>
    openShare(event.currentTarget);
  document.querySelector(".recap-share").onclick = (event) =>
    openShare(event.currentTarget, "recap");
  $("share-form").onsubmit = (event) => {
    event.preventDefault();
    exportShare();
  };
  for (const id of [
    "share-kind",
    "share-size",
    "share-title",
    "share-show-range",
    "share-show-messages",
    "share-show-top",
    "share-show-sources",
  ])
    $(id).addEventListener(id === "share-title" ? "input" : "change", () => {
      shareError = "";
      refreshShare();
    });
  $("source-filter-open").onclick = (event) => {
    sourceTrigger = event.currentTarget;
    source.showModal();
  };
  $("source-filter-apply").onclick = () => source.close();
  return {
    showDetail,
    closeDetail: () => {
      if (detail.open) detail.close();
    },
    refreshShare,
    exportShare,
  };
}
