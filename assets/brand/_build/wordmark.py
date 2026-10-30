# Outlines "Prism" from the bundled Inter variable font (needs fonttools + brotli).
# python wordmark.py app/src/design/fonts/InterVariable-latin.woff2 Prism 640 32 100 -0.02 > wordmark.json
import sys, json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
src, text, wght, opsz, size, track = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
f = TTFont(src)
inst = instantiateVariableFont(f, {"wght": wght, "opsz": opsz})
gs = inst.getGlyphSet(); cmap = inst.getBestCmap(); upm = inst["head"].unitsPerEm
s = size / upm
x = 0; d = ""
for ch in text:
    g = cmap[ord(ch)]
    pen = SVGPathPen(gs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
    tp = TransformPen(pen, (s, 0, 0, -s, x, 0))
    gs[g].draw(tp)
    d += pen.getCommands()
    x += gs[g].width * s + track * size
asc = inst["OS/2"].sCapHeight * s
print(json.dumps({"d": d, "width": round(x - track * size, 2), "capHeight": round(asc, 2)}))
