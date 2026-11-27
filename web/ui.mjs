/** Shared small DOM/chart primitives, used by the view modules. */
export const $ = (id) => document.getElementById(id);
export function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
export function button(text, handler, className = "") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}
export function svgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  return node;
}
export function drawTrend(root, entries, { bars = false } = {}) {
  const width = 600,
    height = 120,
    max = Math.max(1, ...entries.map(([, value]) => value));
  root.replaceChildren();
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (bars) {
    const gap = entries.length > 28 ? 2 : 8,
      slot = width / Math.max(1, entries.length);
    entries.forEach(([, value], i) =>
      root.append(
        svgElement("rect", {
          x: i * slot + gap / 2,
          y: height - (value / max) * (height - 12),
          width: Math.max(1, slot - gap),
          height: (value / max) * (height - 12),
          rx: 3,
          fill: "var(--accent)",
          opacity: 0.7,
        }),
      ),
    );
  } else {
    const points = entries.map(
      ([, value], i) =>
        `${entries.length === 1 ? width / 2 : (i * width) / (entries.length - 1)},${height - 12 - (value / max) * (height - 24)}`,
    );
    root.append(
      svgElement("path", {
        d: points.length ? `M${points.join(" L")}` : "",
        fill: "none",
        stroke: "var(--accent)",
        "stroke-width": 2,
      }),
    );
    if (entries.length === 1) {
      const [x, y] = points[0].split(",");
      root.append(
        svgElement("circle", { cx: x, cy: y, r: 4, fill: "var(--accent)" }),
      );
    }
  }
}
let timer;
export function toast(text) {
  clearTimeout(timer);
  $("toast").textContent = text;
  $("toast").classList.add("show");
  timer = setTimeout(() => $("toast").classList.remove("show"), 3000);
}
