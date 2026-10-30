// Poster helpers (theme param, icons, dpr-aware crops). Self-contained so the
// earlier marketing sources stay untouched.
(function () {
  var q = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = q.get("theme") || "dark";
  document.documentElement.dataset.accent = "prism";

  /** <div data-crop="video" data-region="x,y,w,h" [data-theme]> — region in 1× window px; raw captures are 3–4×. */
  window.applyCrops = function () {
    var t = document.documentElement.dataset.theme;
    document.querySelectorAll("[data-crop]").forEach(function (el) {
      var r = el.dataset.region.split(",").map(Number);
      var src = "raw/" + el.dataset.crop + "-" + (el.dataset.theme || t) + ".png";
      var base = { video: 680, details: 760, mini: 360, main: 1440 }[el.dataset.crop] || 1440;
      var img = new Image();
      img.onload = function () {
        var dpr = img.naturalWidth / base;
        var W = img.naturalWidth / dpr, H = img.naturalHeight / dpr;
        var scale = Math.max(el.clientWidth / r[2], el.clientHeight / r[3]);
        el.style.backgroundImage = 'url("' + src + '")';
        el.style.backgroundSize = W * scale + "px " + H * scale + "px";
        el.style.backgroundPosition = -r[0] * scale + "px " + -r[1] * scale + "px";
        el.style.backgroundRepeat = "no-repeat";
      };
      img.src = src;
    });
    document.querySelectorAll("img[data-shot]").forEach(function (img) {
      img.src = "raw/" + img.dataset.shot + "-" + (img.dataset.theme || t) + ".png";
    });
  };

  window.fillIcons = function () {
    document.body.innerHTML = document.body.innerHTML.replace(/\{\{icon:([\w-]+):?(\d+)?:?([\d.]+)?\}\}/g, function (_, n, sz, sw) {
      return window.icon(n, Number(sz || 20), "", Number(sw || 1.75));
    });
    window.applyCrops();
  };
})();
