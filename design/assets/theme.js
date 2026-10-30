// Mockup helper: theme / accent / density / blur from the query string.
//   ?theme=light|dark  &accent=prism|cyan|emerald|amber|rose|graphite
//   &density=compact   &blur=off   &motion=off
// Press "t" to toggle theme, "b" to toggle blur while viewing.
(function () {
  var q = new URLSearchParams(location.search);
  var h = document.documentElement;
  h.dataset.theme = q.get("theme") || h.dataset.theme || "dark";
  h.dataset.accent = q.get("accent") || h.dataset.accent || "prism";
  if (q.get("density")) h.dataset.density = q.get("density");
  if (q.get("blur") === "off") h.classList.add("no-blur");
  if (q.get("motion") === "off") h.classList.add("reduce-motion");
  addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "t") h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark";
    if (e.key === "b") h.classList.toggle("no-blur");
  });
})();
