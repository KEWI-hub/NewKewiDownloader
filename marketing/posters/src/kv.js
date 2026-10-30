// Prism key visual: a glass prism splitting one white beam into segmented spectral rays.
// Pure SVG (resolution independent). keyVisual({ theme, rays, segmented, floor }) → <svg> string,
// drawn in a 1600 × 1000 viewBox; place it with CSS (object-fit-like via preserveAspectRatio).
(function () {
  var COLS = ["#ff5f7a", "#ff9a4d", "#f7d046", "#6fdc6a", "#2fd3c4", "#3aa6ff", "#7b6cff"]; // red → violet (red bends least)
  var uid = 0;

  window.keyVisual = function (o) {
    o = Object.assign({ theme: "dark", rays: 7, segmented: true, floor: false, beam: true, beamStart: -40, aspect: "xMidYMid slice" }, o || {});
    var id = "kv" + uid++;
    var light = o.theme === "light";
    // Prism geometry (slightly rotated equilateral triangle).
    var A = [640, 250], B = [420, 700], C = [860, 700]; // apex, base-left, base-right
    var lerp = function (p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
    var entry = lerp(A, B, 0.56); // on the left face
    var exit = lerp(A, C, 0.5); // on the right face
    var f = function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); };

    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="' + o.aspect + '" width="100%" height="100%" style="display:block">';
    s += "<defs>";
    s += '<filter id="' + id + 'b1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>';
    s += '<filter id="' + id + 'b2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>';
    s += '<filter id="' + id + 'b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>';
    s += '<linearGradient id="' + id + 'glass" x1="420" y1="250" x2="860" y2="700" gradientUnits="userSpaceOnUse">' +
      (light
        ? '<stop stop-color="#ffffff" stop-opacity=".85"/><stop offset=".45" stop-color="#e6e4ff" stop-opacity=".45"/><stop offset="1" stop-color="#ffffff" stop-opacity=".7"/>'
        : '<stop stop-color="#ffffff" stop-opacity=".22"/><stop offset=".45" stop-color="#b9b6ff" stop-opacity=".06"/><stop offset="1" stop-color="#ffffff" stop-opacity=".14"/>') +
      "</linearGradient>";
    s += '<linearGradient id="' + id + 'rim" x1="420" y1="240" x2="860" y2="720" gradientUnits="userSpaceOnUse">' +
      (light
        ? '<stop stop-color="#6461f2"/><stop offset=".5" stop-color="#a9a7ff" stop-opacity=".8"/><stop offset="1" stop-color="#5653ea"/>'
        : '<stop stop-color="#ffffff"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity=".85"/>') +
      "</linearGradient>";
    var bc = light ? "#8f8cff" : "#fff";
    s += '<linearGradient id="' + id + 'beam" x1="' + Math.max(0, o.beamStart + 20) + '" y1="0" x2="' + entry[0] + '" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="' + bc + '" stop-opacity="0"/><stop offset=".35" stop-color="' + bc + '" stop-opacity=".9"/><stop offset="1" stop-color="' + (light ? "#6461f2" : "#fff") + '"/></linearGradient>';
    s += '<radialGradient id="' + id + 'caustic" cx="' + exit[0] + '" cy="' + exit[1] + '" r="140" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".9"/><stop offset=".3" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>';
    for (var i = 0; i < o.rays; i++) {
      s += '<linearGradient id="' + id + "r" + i + '" x1="' + exit[0] + '" y1="0" x2="1650" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="' + COLS[i] + '" stop-opacity="1"/><stop offset=".55" stop-color="' + COLS[i] + '" stop-opacity=".85"/><stop offset="1" stop-color="' + COLS[i] + '" stop-opacity=".15"/></linearGradient>';
    }
    s += '<clipPath id="' + id + 'clip"><path d="M' + f(A) + "L" + f(B) + "L" + f(C) + 'Z"/></clipPath>';
    s += "</defs>";

    // Ambient colour bloom where the rays leave (painted first, very soft).
    s += '<g filter="url(#' + id + 'b3)" opacity="' + (light ? 0.22 : 0.3) + '">';
    for (var k = 0; k < o.rays; k++) {
      var tk = k / (o.rays - 1) - 0.5;
      s += '<ellipse cx="1300" cy="' + (exit[1] + 70 + tk * 760) + '" rx="320" ry="34" fill="' + COLS[k] + '"/>';
    }
    s += "</g>";

    // Rays: widening wedges + bloom + segmented bright cores.
    var rays = "";
    var glow = "";
    var cores = "";
    for (var r = 0; r < o.rays; r++) {
      var t = r / (o.rays - 1) - 0.5; // -0.5 (red, top) … 0.5 (violet, bottom)
      var start = [exit[0] + 6, exit[1] + t * 34];
      var endY = exit[1] + 70 + t * 820;
      var spread = 26 + Math.abs(t) * 6;
      var end1 = [1700, endY - spread], end2 = [1700, endY + spread];
      rays += '<path d="M' + f([start[0], start[1] - 3]) + "L" + f(end1) + "L" + f(end2) + "L" + f([start[0], start[1] + 3]) + 'Z" fill="url(#' + id + "r" + r + ')" opacity="' + (light ? 0.75 : 0.55) + '"/>';
      glow += '<path d="M' + f(start) + "L1700 " + endY.toFixed(1) + '" stroke="' + COLS[r] + '" stroke-width="30" opacity=".6"/>';
      cores += '<path d="M' + f(start) + "L1700 " + endY.toFixed(1) + '" stroke="url(#' + id + "r" + r + ')" stroke-width="5" stroke-linecap="round"' +
        (o.segmented ? ' stroke-dasharray="' + (150 + r * 31) + " 16 " + (90 + (r % 3) * 50) + ' 16"' : "") + "/>";
    }
    s += '<g filter="url(#' + id + 'b2)">' + glow + "</g>" + rays + cores;

    // Incoming white beam.
    if (o.beam) {
      var bt = (o.beamStart + 40) / (entry[0] + 40);
      var b0 = [o.beamStart, entry[1] + 110 * (1 - bt)];
      s += '<path d="M' + f(b0) + "L" + f(entry) + '" stroke="' + (light ? "#7c78ff" : "#fff") + '" stroke-width="40" opacity="' + (light ? 0.25 : 0.35) + '" filter="url(#' + id + 'b2)"/>';
      s += '<path d="M' + f(b0) + "L" + f(entry) + '" stroke="url(#' + id + 'beam)" stroke-width="9" stroke-linecap="round"' + (light ? ' style="filter:drop-shadow(0 0 6px rgb(86 83 234 / .6))"' : "") + "/>";
    }

    // Glass prism body.
    s += '<path d="M' + f(A) + "L" + f(B) + "L" + f(C) + 'Z" fill="' + (light ? "#ffffff" : "#0a0b14") + '" opacity="' + (light ? 0.35 : 0.22) + '"/>';
    s += '<path d="M' + f(A) + "L" + f(B) + "L" + f(C) + 'Z" fill="url(#' + id + 'glass)"/>';
    // Internal refraction: the beam crossing the glass, starting to split.
    s += '<g clip-path="url(#' + id + 'clip)">';
    // inner edge glow gives the glass thickness
    s += '<path d="M' + f(A) + "L" + f(B) + "L" + f(C) + 'Z" fill="none" stroke="' + (light ? "#7c78ff" : "#fff") + '" stroke-width="46" opacity="' + (light ? 0.18 : 0.13) + '" filter="url(#' + id + 'b2)"/>';
    // diagonal sheen band
    s += '<path d="M500 250L620 250L470 720L350 720Z" fill="#fff" opacity="' + (light ? 0.35 : 0.06) + '" filter="url(#' + id + 'b2)"/>';
    s += '<path d="M' + f(entry) + "L" + f(exit) + '" stroke="#fff" stroke-width="18" opacity=".35" filter="url(#' + id + 'b1)"/>';
    s += '<path d="M' + f(entry) + "L" + f([exit[0], exit[1] - 14]) + "L" + f([exit[0], exit[1] + 14]) + 'Z" fill="#fff" opacity="' + (light ? 0.6 : 0.5) + '"/>';
    for (var q = 0; q < o.rays; q++) {
      var tq = q / (o.rays - 1) - 0.5;
      s += '<path d="M' + f(entry) + "L" + f([exit[0] + 4, exit[1] + tq * 34]) + '" stroke="' + COLS[q] + '" stroke-width="2" opacity=".55"/>';
    }
    // inner bevel lines (thickness of the glass edge)
    s += '<path d="M' + f(lerp(A, [640, 550], 0.06)) + "L" + f(lerp(B, [640, 550], 0.06)) + "L" + f(lerp(C, [640, 550], 0.06)) + 'Z" fill="none" stroke="' + (light ? "#6461f2" : "#fff") + '" stroke-opacity="' + (light ? 0.25 : 0.18) + '" stroke-width="2"/>';
    s += '<circle cx="' + exit[0] + '" cy="' + exit[1] + '" r="140" fill="url(#' + id + 'caustic)" opacity=".7"/>';
    s += "</g>";
    // Rim + specular highlights.
    s += '<path d="M' + f(A) + "L" + f(B) + "L" + f(C) + 'Z" fill="none" stroke="url(#' + id + 'rim)" stroke-width="4" stroke-linejoin="round"/>';
    var inset = function (p) { return lerp(p, [640, 550], 0.035); };
    s += '<path d="M' + f(inset(lerp(A, B, 0.08))) + "L" + f(inset(lerp(A, B, 0.4))) + '" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="' + (light ? 0.95 : 0.7) + '"/>';
    s += '<path d="M' + f(lerp(B, C, 0.1)) + "L" + f(lerp(B, C, 0.55)) + '" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="' + (light ? 0.9 : 0.35) + '"/>';
    s += '<circle cx="' + exit[0] + '" cy="' + exit[1] + '" r="10" fill="#fff" filter="url(#' + id + 'b1)"/>';

    // Floor reflection line.
    if (o.floor) {
      s += '<ellipse cx="640" cy="718" rx="330" ry="10" fill="' + (light ? "#5653ea" : "#7c78ff") + '" opacity="' + (light ? 0.18 : 0.35) + '" filter="url(#' + id + 'b2)"/>';
    }
    return s + "</svg>";
  };
})();
