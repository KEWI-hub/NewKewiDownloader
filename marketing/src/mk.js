// Shared helpers for the marketing compositions.
// ?theme=light|dark selects the variant; icons + logo come from the design system.
(function () {
  var q = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = q.get("theme") || "dark";
  document.documentElement.dataset.accent = "prism";

  /** Spectral fan of segmented rays (the brand motif) as an SVG string. */
  window.raysSvg = function (opts) {
    var o = Object.assign({ w: 1600, h: 1000, x0: 0, y0: 500, spread: 520, len: 1600, count: 7, width: 14, blur: 18, opacity: 1 }, opts || {});
    var cols = ["#ff7f8f", "#f2c14e", "#7ad66a", "#2ed3a9", "#2fcbe6", "#46a8ff", "#8b7bff"];
    var s = '<svg width="' + o.w + '" height="' + o.h + '" viewBox="0 0 ' + o.w + " " + o.h + '" fill="none"><defs><filter id="rg" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="' + o.blur + '"/></filter>';
    for (var i = 0; i < o.count; i++) {
      s += '<linearGradient id="rf' + i + '" x1="' + o.x0 + '" y1="0" x2="' + (o.x0 + o.len) + '" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="' + cols[i % 7] + '" stop-opacity="0"/><stop offset=".12" stop-color="' + cols[i % 7] + '" stop-opacity=".95"/><stop offset="1" stop-color="' + cols[i % 7] + '" stop-opacity="0"/></linearGradient>';
    }
    s += "</defs>";
    for (var k = 0; k < o.count; k++) {
      var t = o.count === 1 ? 0 : k / (o.count - 1) - 0.5;
      var x1 = o.x0 + o.len, y1 = o.y0 + t * o.spread * 2;
      var d = "M" + o.x0 + " " + o.y0 + "L" + x1 + " " + y1;
      s += '<path d="' + d + '" stroke="url(#rf' + k + ')" stroke-width="' + o.width * 2.2 + '" filter="url(#rg)" opacity="' + 0.55 * o.opacity + '"/>';
      s += '<path d="' + d + '" stroke="url(#rf' + k + ')" stroke-width="' + o.width * 0.45 + '" stroke-linecap="round" stroke-dasharray="' + (120 + k * 23) + " 26 " + (80 + (k % 3) * 40) + ' 26" opacity="' + o.opacity + '"/>';
    }
    return s + "</svg>";
  };

  /** <img data-shot="main"> → raw/main-<theme>.png */
  window.applyShots = function () {
    var t = document.documentElement.dataset.theme;
    document.querySelectorAll("img[data-shot]").forEach(function (img) {
      img.src = "raw/" + img.dataset.shot + "-" + (img.dataset.theme || t) + ".png";
    });
  };

  /**
   * Show a region of a raw 2x capture inside an element (cover-crop).
   * <div data-crop="details" data-region="x,y,w,h"> — region in CSS px of the 1x window.
   */
  window.applyCrops = function () {
    var t = document.documentElement.dataset.theme;
    document.querySelectorAll("[data-crop]").forEach(function (el) {
      var r = el.dataset.region.split(",").map(Number);
      var src = "raw/" + el.dataset.crop + "-" + (el.dataset.theme || t) + ".png";
      var img = new Image();
      img.onload = function () {
        var W = img.naturalWidth / 2, H = img.naturalHeight / 2;
        var scale = Math.max(el.clientWidth / r[2], el.clientHeight / r[3]);
        el.style.backgroundImage = 'url("' + src + '")';
        el.style.backgroundSize = W * scale + "px " + H * scale + "px";
        el.style.backgroundPosition = -r[0] * scale + "px " + -r[1] * scale + "px";
        el.style.backgroundRepeat = "no-repeat";
      };
      img.src = src;
    });
  };

  /** Replace {{icon:name:size}} tokens in the document. */
  window.fillIcons = function () {
    document.body.innerHTML = document.body.innerHTML.replace(/\{\{icon:([\w-]+):?(\d+)?:?([\d.]+)?\}\}/g, function (_, n, sz, sw) {
      return window.icon(n, Number(sz || 20), "", Number(sw || 1.75));
    });
    window.applyShots();
    window.applyCrops();
  };
})();
