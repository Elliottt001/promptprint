/** Single-task navigation; the DOM and filters remain mounted between views. */
export function mountNavigation({ onView = () => {} } = {}) {
  const panels = [...document.querySelectorAll("[data-view-panel]")];
  const links = [...document.querySelectorAll(".main-nav a")];
  function show(id, { focus = true, history = false } = {}) {
    if (!panels.some((panel) => panel.id === id)) return;
    for (const panel of panels) panel.hidden = panel.id !== id;
    for (const link of links) {
      const active = link.hash === `#${id}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (history) window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "instant" });
    if (focus) {
      const heading = document.querySelector(`#${id} h1`);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    onView(id);
  }
  document.querySelectorAll('a[href^="#"]').forEach((link) =>
    link.addEventListener("click", (event) => {
      const id = link.hash.slice(1);
      if (panels.some((panel) => panel.id === id)) {
        event.preventDefault();
        show(id, { history: true });
      }
    }),
  );
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(
    panels.some((panel) => `#${panel.id}` === location.hash)
      ? location.hash.slice(1)
      : "cloud-stage",
    { focus: false },
  );
  return { show };
}
