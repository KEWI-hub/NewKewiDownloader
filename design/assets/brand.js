// Inline brand marks for the HTML mockups (kept in sync with assets/brand/*.svg).
(function () {
  var uid = 0;
  // Full-colour mark: glass prism, white beam in, five segmented spectral rays out.
  window.logoMark = function (size, ink) {
    var id = "pm" + uid++;
    var W = ink ? "#151826" : "#fff";
    return (
      '<svg class="logo-mark" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" fill="none" aria-hidden="true">' +
      "<defs>" +
      '<linearGradient id="' + id + 'g" x1="10" y1="8" x2="46" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="' + W + '" stop-opacity="' + (ink ? '.10' : '.42') + '"/><stop offset=".55" stop-color="' + W + '" stop-opacity="' + (ink ? '.03' : '.12') + '"/><stop offset="1" stop-color="' + W + '" stop-opacity="' + (ink ? '.08' : '.22') + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'r" x1="8" y1="8" x2="48" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="' + W + '"/><stop offset=".5" stop-color="' + W + '" stop-opacity=".45"/><stop offset="1" stop-color="' + W + '" stop-opacity=".8"/></linearGradient>' +
      '<linearGradient id="' + id + 'b" x1="1" y1="0" x2="11" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="' + W + '" stop-opacity="0"/><stop offset="1" stop-color="' + W + '"/></linearGradient>' +
      "</defs>" +
      '<path d="M1.5 39.5 L10.6 34.7" stroke="url(#' + id + 'b)" stroke-width="3.2" stroke-linecap="round"/>' +
      '<g stroke-width="3.4" stroke-linecap="round">' +
      '<path d="M41 31.5 L61 16" stroke="#ff7f8f" stroke-dasharray="9 3.5 6 3.5 40"/>' +
      '<path d="M41.6 32.6 L62 25" stroke="#f2c14e" stroke-dasharray="6 3.5 10 3.5 40"/>' +
      '<path d="M42 34 L62.2 34" stroke="#2ed3a9" stroke-dasharray="11 3.5 5 3.5 40"/>' +
      '<path d="M42.2 35.4 L62 43" stroke="#46a8ff" stroke-dasharray="7 3.5 9 3.5 40"/>' +
      '<path d="M42 36.6 L61 51.5" stroke="#8b7bff" stroke-dasharray="10 3.5 7 3.5 40"/>' +
      "</g>" +
      '<path d="M24.4 9.6a3 3 0 0 1 5.2 0l20.3 37.3a3 3 0 0 1-2.6 4.4H6.7a3 3 0 0 1-2.6-4.4z" fill="url(#' + id + 'g)" stroke="url(#' + id + 'r)" stroke-width="2"/>' +
      '<path d="M11.5 34.6 L41.2 33.8" stroke="' + W + '" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M22.6 14.2 L9.4 38.6" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/>' +
      "</svg>"
    );
  };
})();
