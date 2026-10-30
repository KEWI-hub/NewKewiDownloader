# Prism — key visuals ("One beam. Many rays.")

3D hero stills of the brand metaphor: a white beam enters a glass prism and splits into the
spectral rays (= parallel connections). Rendered in Blender 5.2 / Cycles (OptiX, 192 spp,
OptiX denoiser, AgX "Medium High Contrast", compositor bloom) from
`marketing/video/src/blender/prism_scene.py` — the same scene the promo film uses.

| File | Size | Composition / free space for type |
|---|---|---|
| `prism-kv-01-hero-3840x2160.png` | 3840×2160 | Prism left third, rays fan to the right edge. Empty top-left and lower-left. |
| `prism-kv-02-macro-3840x2160.png` | 3840×2160 | 135 mm close-up of the exit face: real Cycles dispersion inside the glass, rays fanning to the right, shallow depth of field. Dark lower-left and bottom band. |
| `prism-kv-03-lanes-3840x2160.png` | 3840×2160 | Rays bend into 16 parallel lanes (the app's connection lanes, spectrum-1…8 ×2). Empty top and bottom bands. |
| `prism-kv-04-burst-3840x2160.png` | 3840×2160 | Low angle down the rays; dramatic perspective. Empty left half. |
| `prism-kv-05-front-3840x2160.png` | 3840×2160 | Calm frontal view, prism centred-left, lots of negative space top & bottom. |
| `prism-kv-06-portrait-2160x3840.png` | 2160×3840 | Portrait; prism in the upper third, lower 40 % dark for headline/CTA. |
| `prism-kv-07-square-3000x3000.png` | 3000×3000 | Square; prism centre, upper half dark for headline. |

`*-alpha.png` variants (01, 03, 05, 06, 07): rendered on pure black without the backdrop glow and
converted to straight alpha with a luma key (`alpha = brightest channel`, colour unpremultiplied).
Composited normally over a **dark** background they reproduce the render exactly (the glow
behaves like an additive/screen layer). Over light backgrounds use the opaque versions instead.

Colours: rays use the design-system spectrum (`--spectrum-1 … 8`), backdrop glow is the prism
accent `#6461f2` on near-black. Re-render: `bash marketing/video/src/blender/render_keyvisuals.sh [samples]`.
