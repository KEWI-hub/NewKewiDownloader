"""Prism - "One beam. Many rays." hero scene for Blender 5.2 (headless).

Everything is procedural (no .blend needed). The scene is rebuilt from code, then every
frame is rendered by setting the scene state from a pure function of time - so a frame
range can be re-rendered on its own and stays frame-exact with the edit/audio timeline.

    blender -b -P prism_scene.py -- --shot kv_hero --res 3840x2160 --out kv.png
    blender -b -P prism_scene.py -- --shot coldopen --frames 0:744 --out frames/co_####.png

Shots: kv_hero kv_macro kv_lanes kv_low kv_front kv_portrait kv_square   (stills)
       coldopen bridge outro                                             (animations, 60 fps)
Options: --engine eevee|cycles --samples N --transparent (no floor/haze, alpha) --percent P
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--shot", default="kv_hero")
ap.add_argument("--res", default=None)
ap.add_argument("--engine", default="cycles")
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--out", required=True)
ap.add_argument("--frames", default=None, help="a:b (end exclusive) for animated shots")
ap.add_argument("--fps", type=int, default=60)
ap.add_argument("--transparent", action="store_true")
ap.add_argument("--percent", type=int, default=100)
ap.add_argument("--save-blend", default=None)
ap.add_argument("--noglare", action="store_true")
ap.add_argument("--tw", default="", help="tweaks k=v,k=v (multipliers, see TW)")
args = ap.parse_args(argv)
args.out = os.path.abspath(args.out)
TW = dict(back=0.01, spot=0.03, beamspot=0.05, density=0.02, ray=0.35, halo=0.25, beam=0.4, rim=1.0, key=1.0, flash=1.0, nohaze=1, backdrop=1.0, floor=0.0)
for kv in filter(None, args.tw.split(",")):
    k, v = kv.split("=")
    TW[k] = float(v)

# ---------------------------------------------------------------- palette (design tokens)
SPECTRUM = ["#8b7bff", "#6a8cff", "#46a8ff", "#2fcbe6", "#2ed3a9", "#7ad66a", "#f2c14e", "#ff7f8f"]


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h, sat=1.0):
    h = h.lstrip("#")
    r, g, b = (srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    if sat != 1.0:  # push saturation a little: emissions are desaturated by AgX highlights
        m = max(r, g, b)
        r, g, b = (m * (x / m) ** sat if m > 0 else 0 for x in (r, g, b))
    return (r, g, b, 1.0)


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def ease_out_expo(x):
    x = clamp01(x)
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)


def ease_in_out_cubic(x):
    x = clamp01(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease_in_cubic(x):
    x = clamp01(x)
    return x ** 3


def ease_out_cubic(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def ramp(t, a, b, fn=lambda x: x):
    return fn(clamp01((t - a) / (b - a))) if b > a else (1.0 if t >= b else 0.0)


def lerp(a, b, x):
    return a + (b - a) * x


# ---------------------------------------------------------------- 2D optics (x,z plane)
def v2(x, z):
    return Vector((x, z))


def refract(d, n, eta):
    cosi = -d.dot(n)
    k = 1 - eta * eta * (1 - cosi * cosi)
    if k < 0:
        return None
    return (d * eta + n * (eta * cosi - math.sqrt(k))).normalized()


def seg_hit(o, d, a, b):
    e = b - a
    den = d.x * e.y - d.y * e.x
    if abs(den) < 1e-9:
        return None
    w = a - o
    t = (w.x * e.y - w.y * e.x) / den
    s = (w.x * d.y - w.y * d.x) / den
    return t, s


SIDE = 2.2
DEPTH = 1.5


def triangle(theta, center=(0.0, 0.0)):
    h = SIDE * math.sqrt(3) / 2
    pts = [v2(0, 2 * h / 3), v2(-SIDE / 2, -h / 3), v2(SIDE / 2, -h / 3)]
    c, s = math.cos(theta), math.sin(theta)
    return [v2(p.x * c - p.y * s + center[0], p.x * s + p.y * c + center[1]) for p in pts]


def trace(theta, alpha_deg, f, ns, center=(0.0, 0.0)):
    """Beam hits the left face at fraction f (base->apex); returns entry, d0 and per-n paths."""
    A, B, C = triangle(theta, center)
    E = B + (A - B) * f
    d0 = v2(math.cos(math.radians(alpha_deg)), math.sin(math.radians(alpha_deg)))
    e = A - B
    nL = v2(-e.y, e.x).normalized()
    if nL.dot(C - B) > 0:
        nL = -nL
    e2 = A - C
    nR = v2(-e2.y, e2.x).normalized()
    if nR.dot(B - C) > 0:
        nR = -nR
    out = []
    for n in ns:
        d1 = refract(d0, nL, 1 / n)
        t, _ = seg_hit(E, d1, C, A)
        X = E + d1 * t
        d2 = refract(d1, -nR, n)
        if d2 is None:
            d2 = d1
        out.append((X, d2))
    return (A, B, C), E, d0, out


def to3(p, y=0.0):
    return Vector((p.x, y, p.y))


# ---------------------------------------------------------------- scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_obj(name, data):
    ob = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def look_at(ob, target, roll=0.0):
    d = Vector(target) - ob.location
    q = d.to_track_quat("-Z", "Y")
    ob.rotation_euler = q.to_euler()
    if roll:
        ob.rotation_euler.rotate_axis("Z", math.radians(roll))


def tube_mesh(name, pts, radius, sides=14, mesh=None):
    """Tube along a polyline in the y=0 plane. UV.x = arc-length fraction (0 at start)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    lens = [0.0]
    for i in range(1, len(pts)):
        lens.append(lens[-1] + (pts[i] - pts[i - 1]).length)
    total = lens[-1] or 1.0
    rings = []
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        t.normalize()
        n1 = Vector((0, 1, 0))
        n2 = t.cross(n1).normalized()
        ring = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            ring.append(bm.verts.new(p + (n1 * math.cos(a) + n2 * math.sin(a)) * radius))
        rings.append(ring)
    for i in range(len(pts) - 1):
        for j in range(sides):
            j2 = (j + 1) % sides
            f = bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
            us = (lens[i] / total, lens[i + 1] / total)
            for loop, (uu, vv) in zip(f.loops, ((us[0], j / sides), (us[0], (j + 1) / sides), (us[1], (j + 1) / sides), (us[1], j / sides))):
                loop[uv].uv = (uu, vv)
    if mesh is None:
        mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    return mesh


# ---------------------------------------------------------------- materials
def glow_material(name, color, strength=20.0, power=2.0):
    """Additive emissive tube: bright core, soft facing falloff, animated reveal/tail masks."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N = nt.nodes
    L = nt.links
    N.clear()
    out = N.new("ShaderNodeOutputMaterial")
    add = N.new("ShaderNodeAddShader")
    tr = N.new("ShaderNodeBsdfTransparent")
    em = N.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    L.new(em.outputs[0], add.inputs[0])
    L.new(tr.outputs[0], add.inputs[1])
    L.new(add.outputs[0], out.inputs["Surface"])

    def val(nm, v):
        n = N.new("ShaderNodeValue")
        n.name = nm
        n.label = nm
        n.outputs[0].default_value = v
        return n.outputs[0]

    def math_node(op, a, b=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                L.new(x, n.inputs[i])
        return n.outputs[0]

    def maprange(x, fmin, fmax, tmin, tmax):
        n = N.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.clamp = True
        L.new(x, n.inputs["Value"])
        for sock, v in (("From Min", fmin), ("From Max", fmax), ("To Min", tmin), ("To Max", tmax)):
            if isinstance(v, (int, float)):
                n.inputs[sock].default_value = v
            else:
                L.new(v, n.inputs[sock])
        return n.outputs[0]

    uvn = N.new("ShaderNodeUVMap")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(uvn.outputs[0], sep.inputs[0])
    u = sep.outputs[0]
    lw = N.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    facing = math_node("SUBTRACT", 1.0, lw.outputs["Facing"])
    prof = math_node("POWER", facing, val("power", power))
    reveal = val("reveal", 1.0)
    tail = val("tail", 0.0)
    soft = val("soft", 0.015)
    m_rev = maprange(u, math_node("SUBTRACT", reveal, soft), reveal, 1.0, 0.0)
    m_tail = maprange(u, tail, math_node("ADD", tail, soft), 0.0, 1.0)
    fade_start = val("fade_start", 0.55)
    m_fade = maprange(u, fade_start, 1.002, 1.0, 0.0)
    m_in = maprange(u, -0.002, val("fade_in", 0.0), 0.0, 1.0)
    k = math_node("MULTIPLY", prof, m_rev)
    k = math_node("MULTIPLY", k, m_tail)
    k = math_node("MULTIPLY", k, m_fade)
    k = math_node("MULTIPLY", k, m_in)
    k = math_node("MULTIPLY", k, val("strength", strength))
    L.new(k, em.inputs["Strength"])
    m.surface_render_method = "BLENDED"
    m.use_transparency_overlap = True
    return m


def set_mat(m, **kw):
    for k, v in kw.items():
        m.node_tree.nodes[k].outputs[0].default_value = v


def glass_material():
    m = bpy.data.materials.new("PrismGlass")
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.92, 0.94, 1.0, 1)
    p.inputs["Roughness"].default_value = 0.015
    p.inputs["IOR"].default_value = 1.52
    p.inputs["Transmission Weight"].default_value = 1.0
    if "Dispersion" in p.inputs:
        p.inputs["Dispersion"].default_value = 0.35
    p.inputs["Coat Weight"].default_value = 0.2
    # faint inner glow driven per frame (flash when the beam hits)
    p.inputs["Emission Color"].default_value = (0.75, 0.74, 1.0, 1)
    p.inputs["Emission Strength"].default_value = 0.0
    m.surface_render_method = "DITHERED"
    try:
        m.use_raytrace_refraction = True
        m.thickness_mode = "SLAB"
    except AttributeError:
        pass
    return m


def floor_material():
    m = bpy.data.materials.new("Floor")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.006, 0.0065, 0.009, 1)
    p.inputs["Roughness"].default_value = 0.16
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 6.0
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = 0.11
    mr.inputs["To Max"].default_value = 0.26
    nt.links.new(noise.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs[0], p.inputs["Roughness"])
    return m


# ---------------------------------------------------------------- world, render, compositor
def setup_render(w, h, transparent):
    sc = bpy.context.scene
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = args.percent
    sc.render.fps = args.fps
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.render.image_settings.color_depth = "16" if transparent else "8"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    sc.view_settings.exposure = 0.0
    if args.engine == "cycles":
        sc.render.engine = "CYCLES"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        sc.cycles.device = "GPU"
        sc.cycles.samples = args.samples
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = "OPTIX"
        sc.cycles.max_bounces = 12
        sc.cycles.transmission_bounces = 12
        sc.cycles.transparent_max_bounces = 32
        sc.cycles.volume_bounces = 1
        sc.cycles.caustics_refractive = True
    else:
        sc.render.engine = "BLENDER_EEVEE"
        ee = sc.eevee
        ee.taa_render_samples = args.samples
        ee.use_raytracing = True
        ee.ray_tracing_method = "SCREEN"
        ee.ray_tracing_options.resolution_scale = "1"
        ee.ray_tracing_options.use_denoise = True
        ee.use_shadows = True
        ee.volumetric_tile_size = "4"
        ee.volumetric_samples = 96
        ee.volumetric_start = 0.5
        ee.volumetric_end = 60
        ee.use_volumetric_shadows = True
        ee.volumetric_light_clamp = 0.0
        ee.use_fast_gi = True
        ee.clamp_surface_indirect = 10.0
    sc.render.use_motion_blur = False


def setup_world():
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0018, 0.002, 0.0032, 1)
    bg.inputs["Strength"].default_value = 1.0


def setup_compositor(glare=True):
    sc = bpy.context.scene
    tree = bpy.data.node_groups.new("Comp", "CompositorNodeTree")
    sc.compositing_node_group = tree
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    tree.interface.new_socket(name="Alpha", in_out="OUTPUT", socket_type="NodeSocketFloat")
    rl = tree.nodes.new("CompositorNodeRLayers")
    out = tree.nodes.new("NodeGroupOutput")
    if not glare:
        tree.links.new(rl.outputs["Image"], out.inputs[0])
        return
    g1 = tree.nodes.new("CompositorNodeGlare")
    g2 = tree.nodes.new("CompositorNodeGlare")

    def gset(g, gtype, **kw):
        try:
            g.glare_type = gtype
        except Exception:
            g.inputs["Type"].default_value = gtype.replace("_", " ").title()
        for k, v in kw.items():
            if k in g.inputs:
                g.inputs[k].default_value = v
            elif hasattr(g, k.lower()):
                setattr(g, k.lower(), v)

    gset(g1, "BLOOM", Threshold=1.0, Smoothness=0.4, Size=0.85, Strength=0.3, Saturation=1.1)
    gset(g2, "STREAKS", Threshold=6.0, Smoothness=0.2, Strength=0.12, Streaks=2, **{"Streaks Angle": 0.0, "Fade": 0.92})
    tree.links.new(rl.outputs["Image"], g1.inputs["Image"])
    tree.links.new(g1.outputs["Image"], g2.inputs["Image"])
    tree.links.new(g2.outputs["Image"], out.inputs[0])


# ---------------------------------------------------------------- the rig
class Rig:
    pass


R = Rig()
N_RAYS = 8
NS8 = [1.44 + 0.03 * i for i in range(8)]  # exaggerated dispersion: rose ... violet
RAY_COLORS8 = list(reversed(SPECTRUM))  # least bent (top) = rose, most bent = violet


def build(shot, transparent):
    """Create prism, beam, rays, lights, floor, haze, camera."""
    R.shot = shot
    R.transparent = transparent
    R.lanes = shot in ("bridge", "kv_lanes")
    R.root = new_obj("Root", None)

    # prism mesh (rebuilt when rotating, by object rotation instead)
    R.glass = glass_material()
    R.prism = new_obj("Prism", bpy.data.meshes.new("Prism"))
    R.prism.parent = R.root
    R.prism.data.materials.append(R.glass)
    build_prism_mesh(R.prism.data)
    bev = R.prism.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.055
    bev.segments = 6
    bev.limit_method = "ANGLE"
    bev.harden_normals = True

    # beam (white) + inner rays + outer rays
    R.beam_mat = glow_material("Beam", (1.0, 0.98, 0.96, 1), 60, 1.6)
    R.beam_halo_mat = glow_material("BeamHalo", (0.75, 0.78, 1.0, 1), 5, 3.0)
    R.beam = new_obj("Beam", bpy.data.meshes.new("Beam"))
    R.beam_halo = new_obj("BeamHalo", bpy.data.meshes.new("BeamHalo"))
    R.beam.data.materials.append(R.beam_mat)
    R.beam_halo.data.materials.append(R.beam_halo_mat)

    nr = 16 if R.lanes else N_RAYS
    R.n = nr
    R.rays, R.halos, R.inner, R.ray_mats, R.halo_mats, R.inner_mats, R.spots = [], [], [], [], [], [], []
    for k in range(nr):
        col_hex = SPECTRUM[k % 8] if R.lanes else RAY_COLORS8[k]
        col = hex_lin(col_hex, 1.25)
        rm = glow_material(f"Ray{k}", col, 40, 1.4)
        hm = glow_material(f"RayHalo{k}", col, 3.5, 3.2)
        im = glow_material(f"Inner{k}", col, 6, 1.5)
        for lst, m in ((R.ray_mats, rm), (R.halo_mats, hm), (R.inner_mats, im)):
            lst.append(m)
        r = new_obj(f"Ray{k}", bpy.data.meshes.new(f"Ray{k}"))
        h = new_obj(f"RayHalo{k}", bpy.data.meshes.new(f"RayHalo{k}"))
        i = new_obj(f"Inner{k}", bpy.data.meshes.new(f"Inner{k}"))
        r.data.materials.append(rm)
        h.data.materials.append(hm)
        i.data.materials.append(im)
        R.rays.append(r)
        R.halos.append(h)
        R.inner.append(i)
        if not R.lanes:
            sp = bpy.data.lights.new(f"RaySpot{k}", "SPOT")
            sp.color = col[:3]
            sp.spot_size = math.radians(2.6)
            sp.spot_blend = 0.9
            sp.shadow_soft_size = 0.02
            sp.energy = 0
            sp.volume_factor = 1.0
            so = new_obj(f"RaySpot{k}", sp)
            R.spots.append(so)

    # spark at the beam head
    R.spark_mat = glow_material("Spark", (1, 1, 1, 1), 0, 1.0)
    set_mat(R.spark_mat, fade_start=1.0)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, segments=24, ring_count=12)
    R.spark = bpy.context.active_object
    R.spark.name = "Spark"
    sm = bpy.data.materials.new("SparkEm")
    sm.use_nodes = True
    p = sm.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0, 0, 0, 1)
    p.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    p.inputs["Emission Strength"].default_value = 0
    R.spark_em = p
    R.spark.data.materials.append(sm)

    # lights --------------------------------------------------------------
    def area(name, loc, target, size, energy, color):
        L = bpy.data.lights.new(name, "AREA")
        L.shape = "RECTANGLE"
        L.size = size[0]
        L.size_y = size[1]
        L.energy = energy
        L.color = color
        L.volume_factor = 0.0
        o = new_obj(name, L)
        o.location = loc
        look_at(o, target)
        return o

    R.rim1 = area("RimL", (-3.2, 3.6, 3.4), (0, 0, 0.2), (4, 1.2), 900, (0.80, 0.84, 1.0))
    R.rim2 = area("RimR", (3.6, 3.2, 2.6), (0, 0, 0.0), (3, 1.0), 700, hex_lin("#8e8cff")[:3])
    R.key = area("Key", (0.5, -4.0, 5.0), (0, 0, 0), (5, 5), 120, (0.85, 0.88, 1.0))
    R.under = area("Under", (0, 0.5, -2.0), (0, 0, 0.0), (2, 1.5), 0, (0.8, 0.8, 1.0))
    # haze back-light (violet pool behind the prism, lights the volume only)
    R.back = area("BackGlow", (2.0, 14.0, 1.5), (0, 0, 0.5), (14, 8), 0, hex_lin("#6461f2")[:3])
    R.back.data.volume_factor = 1.0
    R.back.data.diffuse_factor = 0.0
    R.back.data.specular_factor = 0.0
    R.back2 = area("BackGlow2", (-6.0, 12.0, -1.0), (0, 0, 0), (10, 6), 0, hex_lin("#2fcbe6")[:3])
    R.back2.data.volume_factor = 1.0
    R.back2.data.diffuse_factor = 0.0
    R.back2.data.specular_factor = 0.0

    R.linked = [R.rim1, R.rim2, R.key]
    # emissive softbox strips: invisible to camera, seen in the glass reflections
    def strip(name, loc, target, size, strength, color=(1, 1, 1, 1)):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
        o = bpy.context.active_object
        o.name = name
        o.scale = (size[0], size[1], 1)
        look_at(o, target)
        o.rotation_euler.rotate_axis("X", math.radians(180))
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = (0, 0, 0, 1)
        p.inputs["Emission Color"].default_value = color
        p.inputs["Emission Strength"].default_value = strength
        o.data.materials.append(m)
        o.visible_camera = False
        o.visible_shadow = False
        R.linked.append(o)
        return p
    R.strips = [
        strip("StripTop", (-1.0, -3.5, 5.0), (0, 0, 0), (6.0, 0.35), 6.0),
        strip("StripLeft", (-5.5, -2.5, 0.8), (0, 0, 0), (0.3, 5.0), 3.0, (0.8, 0.85, 1.0, 1)),
        strip("StripRight", (5.0, -3.0, 1.5), (0, 0, 0), (0.4, 4.0), 2.5, hex_lin("#8e8cff")),
        strip("StripBack", (0.0, 6.0, 2.5), (0, 0, 0), (8.0, 0.5), 4.0, hex_lin("#2fcbe6")),
    ]
    # rim/key lights and strips only light the glass (light linking), not the floor
    only = bpy.data.collections.new("PrismOnly")
    only.objects.link(R.prism)
    for o in R.linked:
        try:
            o.light_linking.receiver_collection = only
        except AttributeError:
            pass

    # backdrop: faint violet light pool far behind the prism (seen directly, in the glass and on the floor)
    if not transparent:
        bpy.ops.mesh.primitive_plane_add(size=1, location=(4.0, 30.0, 2.0))
        bd = bpy.context.active_object
        bd.name = "Backdrop"
        bd.scale = (140, 70, 1)
        bd.rotation_euler = (math.radians(90), 0, 0)
        m = bpy.data.materials.new("Backdrop")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        tc = nt.nodes.new("ShaderNodeTexCoord")
        dist = nt.nodes.new("ShaderNodeVectorMath")
        dist.operation = "DISTANCE"
        dist.inputs[1].default_value = (0.47, 0.52, 0.0)
        sc = nt.nodes.new("ShaderNodeVectorMath")
        sc.operation = "MULTIPLY"
        sc.inputs[1].default_value = (1.0, 2.0, 0.0)
        nt.links.new(tc.outputs["Generated"], sc.inputs[0])
        dist.inputs[1].default_value = (0.47, 1.04, 0.0)
        nt.links.new(sc.outputs[0], dist.inputs[0])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.0
        mr.inputs["From Max"].default_value = 0.42
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.0
        nt.links.new(dist.outputs["Value"], mr.inputs["Value"])
        pw = nt.nodes.new("ShaderNodeMath")
        pw.operation = "POWER"
        pw.inputs[1].default_value = 2.2
        nt.links.new(mr.outputs[0], pw.inputs[0])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.name = "bd_strength"
        mul.inputs[1].default_value = 0.05 * TW["backdrop"]
        nt.links.new(pw.outputs[0], mul.inputs[0])
        em.inputs["Color"].default_value = hex_lin("#4a46c8")
        nt.links.new(mul.outputs[0], em.inputs["Strength"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        bd.data.materials.append(m)
        bd.visible_shadow = False
        R.backdrop = mul

    pr = bpy.data.lightprobes.new("Probe", "SPHERE")
    pr.influence_distance = 6.0
    po = new_obj("Probe", pr)
    po.location = (0, 0, 0.2)

    sp = bpy.data.lights.new("BeamSpot", "SPOT")
    sp.spot_size = math.radians(1.1)
    sp.spot_blend = 0.9
    sp.shadow_soft_size = 0.02
    sp.color = (1.0, 0.98, 0.95)
    sp.energy = 0
    R.beam_spot = new_obj("BeamSpot", sp)

    pl = bpy.data.lights.new("Flash", "POINT")
    pl.shadow_soft_size = 0.4
    pl.energy = 0
    pl.color = (0.85, 0.85, 1.0)
    R.flash = new_obj("Flash", pl)
    for attr in ("visible_camera", "visible_glossy", "visible_transmission", "visible_diffuse"):
        setattr(R.flash, attr, False)

    # floor + haze -------------------------------------------------------
    R.floor = None
    if not transparent and TW["floor"] > 0 and shot not in ("kv_portrait", "bridge", "kv_lanes"):
        bpy.ops.mesh.primitive_plane_add(size=300, location=(0, 0, -3.4))
        R.floor = bpy.context.active_object
        R.floor.data.materials.append(floor_material())
    R.haze = None
    if not transparent and not TW['nohaze']:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 6, 1))
        R.haze = bpy.context.active_object
        R.haze.scale = (70, 50, 20)
        hm = bpy.data.materials.new("Haze")
        hm.use_nodes = True
        nt = hm.node_tree
        nt.nodes.remove(nt.nodes["Principled BSDF"])
        vol = nt.nodes.new("ShaderNodeVolumePrincipled")
        vol.inputs["Density"].default_value = 0.035
        vol.inputs["Anisotropy"].default_value = 0.55
        vol.inputs["Color"].default_value = (0.9, 0.92, 1.0, 1)
        nt.links.new(vol.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
        R.haze.data.materials.append(hm)
        R.haze_density = vol.inputs["Density"]

    cam = bpy.data.cameras.new("Cam")
    cam.lens = 50
    cam.sensor_width = 36
    cam.clip_start = 0.05
    cam.clip_end = 200
    R.cam = new_obj("Cam", cam)
    bpy.context.scene.camera = R.cam
    R.cam.data.dof.use_dof = True
    R.cam.data.dof.aperture_fstop = 2.8


def build_prism_mesh(mesh):
    h = SIDE * math.sqrt(3) / 2
    tri = [(0, 2 * h / 3), (-SIDE / 2, -h / 3), (SIDE / 2, -h / 3)]
    bm = bmesh.new()
    f = [bm.verts.new((x, -DEPTH / 2, z)) for x, z in tri]
    b = [bm.verts.new((x, DEPTH / 2, z)) for x, z in tri]
    bm.faces.new((f[0], f[2], f[1]))
    bm.faces.new((b[0], b[1], b[2]))
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((f[i], f[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------- geometry per state
def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append(p0 * a + p1 * b + p2 * c + p3 * d)
    return out


def set_geometry(theta, alpha, f=0.45, ray_len=24.0, beam_len=26.0, center=(0.0, 0.0), lanes=None, beam_r=0.022):
    """Rebuild beam/rays meshes for a prism rotation theta (radians) and beam angle alpha (deg).
    lanes: dict(ys=[...], x_join, x_end) - bend the 16 rays into horizontal lanes."""
    R.prism.rotation_euler = Euler((0, -theta, 0))
    R.prism.location = Vector((center[0], 0, center[1]))
    ns = NS8 if R.n == 8 else [1.465 + 0.132 * (k / 15) for k in range(16)][::-1]
    tri, E, d0, outs = trace(theta, alpha, f, ns, center)
    R.E, R.d0, R.outs = E, d0, outs
    start = E - d0 * beam_len
    tube_mesh("Beam", [to3(start), to3(E)], beam_r, 16, R.beam.data)
    tube_mesh("BeamHalo", [to3(start), to3(E)], beam_r * 6, 16, R.beam_halo.data)
    R.beam_start = start
    for k in range(R.n):
        X, d2 = outs[k]
        if lanes:
            yk = lanes["ys"][k]
            p0 = X
            p1 = X + d2 * 0.9
            p3 = v2(lanes["x_join"], yk)
            p2 = v2(lanes["x_join"] - 1.6, yk)
            pts = bezier(p0, p1, p2, p3, 40) + [v2(lanes["x_end"], yk)]
        else:
            pts = [X, X + d2 * ray_len]
        pts3 = [to3(p) for p in pts]
        rad = 0.016 if R.lanes else 0.02
        tube_mesh("Ray", pts3, rad, 12, R.rays[k].data)
        tube_mesh("Halo", pts3, rad * (5 if R.lanes else 6), 12, R.halos[k].data)
        tube_mesh("Inner", [to3(E, 0), to3(X, 0)], 0.012, 10, R.inner[k].data)
        if R.spots:
            so = R.spots[k]
            so.location = to3(X + d2 * 0.05)
            look_at(so, to3(X + d2 * 5))


# ---------------------------------------------------------------- shot states
def apply_common(beam_rev, ray_rev, inner_rev, glow=1.0, ray_tail=0.0, beam_tail=0.0, flash=0.0, rim=1.0, haze=1.0, spark=0.0):
    set_mat(R.beam_mat, reveal=beam_rev, tail=beam_tail, fade_start=1.0, fade_in=0.25, strength=55 * TW['beam'] * glow)
    set_mat(R.beam_halo_mat, reveal=beam_rev, tail=beam_tail, fade_start=1.0, fade_in=0.35, strength=4.0 * glow)
    for k in range(R.n):
        rv = ray_rev[k] if isinstance(ray_rev, (list, tuple)) else ray_rev
        set_mat(R.ray_mats[k], reveal=rv, tail=ray_tail, fade_start=0.92 if R.lanes else 0.35, strength=34 * TW['ray'] * glow)
        set_mat(R.halo_mats[k], reveal=rv, tail=ray_tail, fade_start=0.92 if R.lanes else 0.3, strength=(2.4 if R.lanes else 3.2) * TW['halo'] * glow)
        set_mat(R.inner_mats[k], reveal=inner_rev, tail=0.0, fade_start=1.0, strength=5.0 * glow)
        if R.spots:
            R.spots[k].data.energy = 1400 * TW['spot'] * clamp01(rv * 3) * glow * haze
    R.beam_spot.data.energy = 2200 * TW['beamspot'] * clamp01((beam_rev - 0.92) / 0.08) * haze * glow * (1 - clamp01(beam_tail * 4))
    s = R.beam_start
    R.beam_spot.location = to3(s)
    look_at(R.beam_spot, to3(R.E))
    R.flash.location = to3(R.E + (R.outs[R.n // 2][0] - R.E) * 0.5, 0.0)
    R.flash.data.energy = 900 * flash
    R.glass.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.6 * flash
    R.rim1.data.energy = 900 * TW['rim'] * rim
    R.rim2.data.energy = 650 * TW['rim'] * rim
    R.key.data.energy = 110 * TW['key'] * rim
    R.back.data.energy = 9000 * TW['back'] * haze
    R.back2.data.energy = 3500 * TW['back'] * haze
    if R.haze is not None:
        R.haze_density.default_value = TW['density']
    # spark at the beam head (only while the beam travels)
    head = s + (R.E - s) * beam_rev
    R.spark.location = to3(head)
    R.spark_em.inputs["Emission Strength"].default_value = 300 * spark
    R.spark.hide_render = spark <= 0.001


def place_cam(loc, target, lens=50, fstop=2.8, focus=None, roll=0.0):
    R.cam.location = Vector(loc)
    look_at(R.cam, target, roll)
    R.cam.data.lens = lens
    R.cam.data.dof.aperture_fstop = fstop
    R.cam.data.dof.focus_distance = focus if focus else (Vector(target) - Vector(loc)).length


HERO_THETA = math.radians(5)
HERO_ALPHA = 28.0


def state_still(shot):
    full = dict(beam_rev=1.0, ray_rev=1.0, inner_rev=1.0)
    if shot == "kv_hero":
        set_geometry(HERO_THETA, HERO_ALPHA)
        apply_common(**full)
        place_cam((1.6, -10.5, 1.2), (2.2, 0, -0.35), lens=40, fstop=4.0, focus=10.6)
    elif shot == "kv_square":
        set_geometry(HERO_THETA, HERO_ALPHA)
        apply_common(**full)
        place_cam((1.6, -11.0, 1.0), (1.5, 0, -0.45), lens=38, fstop=4.0, focus=10.9)
    elif shot == "kv_macro":
        set_geometry(HERO_THETA, HERO_ALPHA)
        apply_common(**full)
        place_cam((6.2, -11.5, -0.2), (1.25, 0, -0.25), lens=135, fstop=1.8, focus=12.55)
    elif shot == "kv_low":
        set_geometry(HERO_THETA, HERO_ALPHA)
        apply_common(**full)
        place_cam((7.8, -5.2, -1.3), (0.7, 0, 0.1), lens=28, fstop=2.8, focus=8.6)
    elif shot == "kv_front":
        set_geometry(HERO_THETA, HERO_ALPHA)
        apply_common(**full)
        place_cam((0.9, -14.0, 0.1), (0.9, 0, -0.35), lens=50, fstop=5.6, focus=14.0)
    elif shot == "kv_portrait":
        R.root.rotation_euler = Euler((0, 0, 0))
        set_geometry(math.radians(10), 20.0)
        apply_common(**full)
        place_cam((1.9, -13.5, 0.4), (1.9, 0, -2.7), lens=33, fstop=4.0, focus=13.6)
    elif shot == "kv_lanes":
        lanes_state(1.0, 1.0)


# lanes: frontal long-lens camera so the y=0 plane maps linearly to pixels
LANE_CAM_D = 30.0
LANE_LENS = 85.0


def px_to_world(px, py, w=1920, h=1080):
    width = LANE_CAM_D * 36.0 / LANE_LENS  # world units across the frame at the plane
    s = width / w
    return (px - w / 2) * s, -(py - h / 2) * s


LANE_YS_PX = [252 + 38 * k for k in range(16)]  # must match src/film/engine lanes
LANE_JOIN_PX = 1000
LANE_END_PX = 2100
PRISM_PX = (420, 595.5)  # puts the beam entry point exactly on y = 540 px


def lanes_state(beam_rev, ray_rev, inner_rev=None, glow=1.0, flash=0.0, spark=0.0):
    cx, cz = px_to_world(*PRISM_PX)
    ys = [px_to_world(0, y)[1] for y in LANE_YS_PX]
    xj = px_to_world(LANE_JOIN_PX, 0)[0]
    xe = px_to_world(LANE_END_PX, 0)[0]
    set_geometry(0.0, 0.0, f=0.5, center=(cx, cz + 0.05), lanes=dict(ys=ys, x_join=xj, x_end=xe), beam_len=40.0, beam_r=0.03)
    apply_common(beam_rev, ray_rev, 1.0 if inner_rev is None else inner_rev, glow=glow, flash=flash, rim=1.3, haze=0.6, spark=spark)
    place_cam((0, -LANE_CAM_D, 0), (0, 0, 0), lens=LANE_LENS, fstop=11, focus=LANE_CAM_D)


# ---- animated shots (t in seconds, local to the shot) ----------------------------------
def state_coldopen(t):
    """0-12.4 s. Beam travels 1.0->4.8 s, hits the prism at 4.8 (impact), rays burst 4.8->6.0."""
    set_geometry(HERO_THETA, HERO_ALPHA)
    T_HIT = 4.8
    beam = lerp(0.68, 1.0, ramp(t, 0.9, T_HIT, lambda x: 0.35 * x + 0.65 * ease_in_cubic(x)))
    inner = ramp(t, T_HIT, T_HIT + 0.12)
    rays = [ramp(t, T_HIT + 0.06 + 0.012 * k, T_HIT + 1.6 + 0.04 * k, ease_out_expo) for k in range(R.n)]
    flash = math.exp(-max(0.0, t - T_HIT) * 3.2) if t >= T_HIT else 0.0
    rim = lerp(0.05, 0.35, ramp(t, 0.5, 4.6, ease_in_cubic)) + 0.65 * ramp(t, T_HIT, T_HIT + 1.0, ease_out_cubic)
    haze = lerp(0.25, 0.6, ramp(t, 1.0, 4.8)) + 0.4 * ramp(t, T_HIT, T_HIT + 1.5, ease_out_cubic)
    spark = (1.0 if 0.9 < t < T_HIT else 0.0) * ramp(t, 0.9, 1.3)
    glow = 1.0 + 0.6 * flash
    apply_common(beam, rays, inner, glow=glow, flash=flash * 1.5, rim=rim, haze=haze, spark=spark)
    # camera: slow push-in until the hit, micro shake on impact, then a slow lateral orbit
    a = ramp(t, 0.0, T_HIT, ease_in_out_cubic)
    b = ramp(t, T_HIT, 12.4, ease_out_cubic)
    yaw = lerp(-14.0, -4.0, a) + 13.0 * b
    dist = lerp(15.5, 12.0, a) - 1.4 * b
    tz = lerp(0.1, -0.2, a) - 0.1 * b
    target = Vector((lerp(-0.6, 1.6, a) + 0.5 * b, 0, tz))
    ry = math.radians(yaw)
    loc = target + Vector((math.sin(ry) * dist, -math.cos(ry) * dist, lerp(0.6, 1.25, a) + 0.25 * b))
    if t >= T_HIT:
        sh = math.exp(-(t - T_HIT) * 6.0) * 0.05
        loc += Vector((math.sin(t * 91) * sh, 0, math.cos(t * 77) * sh))
    place_cam(loc, target, lens=lerp(42, 40, b), fstop=3.2, focus=(target - loc).length)


def state_bridge(t):
    """0-3.0 s. Horizontal beam enters from the left edge (the lone progress line of the
    previous scene), hits the prism at 0.6 s; 16 rays race out and settle into the lanes."""
    T_HIT = 0.6
    beam = lerp(0.9442, 1.0, ramp(t, 0.0, T_HIT, lambda x: 0.5 * x + 0.5 * ease_in_cubic(x)))  # head enters at x=0 px
    rays = [ramp(t, T_HIT + 0.02 * k, T_HIT + 1.15 + 0.03 * k, ease_out_expo) for k in range(16)]
    flash = math.exp(-max(0.0, t - T_HIT) * 4.0) if t >= T_HIT else 0.0
    # after the lanes settle they pump with the kick (beats every 0.6 s; shot starts on a beat)
    pump = 0.22 * math.exp(-((t % 0.6) * 7.0)) * ramp(t, 2.2, 3.0)
    lanes_state(beam, rays, inner_rev=ramp(t, T_HIT, T_HIT + 0.1), glow=1.0 + 0.5 * flash + pump, flash=flash, spark=1.0 if t < T_HIT else 0.0)


def state_outro(t):
    """0-5.0 s. Rays retract into the prism (0-1.6), the beam follows (0.8-2.2); the prism turns
    to face the camera and the camera centres it (0.6-3.6); a last flash at 3.6 s where the app
    icon takes over in the edit."""
    k_rot = ramp(t, 0.4, 3.6, ease_in_out_cubic)
    theta = lerp(HERO_THETA, 0.0, k_rot)
    set_geometry(theta, lerp(HERO_ALPHA, 10.0, k_rot))
    tail = ramp(t, 0.0, 1.8, ease_in_cubic)
    btail = ramp(t, 0.9, 2.4, ease_in_cubic)
    inner = 1.0 - ramp(t, 1.8, 2.5)
    flash = math.exp(-max(0.0, t - 3.6) * 5.0) if t >= 3.6 else 0.15 * ramp(t, 2.4, 3.6, ease_in_cubic)
    # tails race to the prism: tail param on the beam moves from 0 to 1 (start toward E)
    for k in range(R.n):
        pass
    apply_common(1.0, 1.0 - tail * 0.0, inner, glow=1.0 + 1.2 * flash, ray_tail=0.0, beam_tail=0.0,
                 flash=flash * 2.0, rim=1.0 + 0.8 * k_rot, haze=1.0 - 0.6 * k_rot)
    # retract: rays shrink from their far end toward the prism => reveal goes 1 -> 0
    for k in range(R.n):
        rv = 1.0 - ramp(t, 0.0 + 0.03 * k, 1.6 + 0.03 * k, ease_in_cubic)
        set_mat(R.ray_mats[k], reveal=rv)
        set_mat(R.halo_mats[k], reveal=rv)
        if R.spots:
            R.spots[k].data.energy = 1400 * TW['spot'] * clamp01(rv * 3)
    # beam: the far start runs toward the prism => tail goes 0 -> 1
    set_mat(R.beam_mat, tail=btail)
    set_mat(R.beam_halo_mat, tail=btail)
    R.beam_spot.data.energy = 2200 * TW['beamspot'] * (1 - btail)
    c = ramp(t, 0.3, 3.8, ease_in_out_cubic)
    target = Vector((lerp(2.0, 0.0, c), 0, lerp(-0.3, 0.0, c)))
    yaw = lerp(9.0, 0.0, c)
    dist = lerp(11.2, 18.0, c)
    ry = math.radians(yaw)
    loc = target + Vector((math.sin(ry) * dist, -math.cos(ry) * dist, lerp(1.5, 0.0, c)))
    place_cam(loc, target, lens=lerp(40, 50, c), fstop=lerp(3.2, 8.0, c), focus=(target - loc).length)


# ---------------------------------------------------------------- 2D geometry for the edit
def export_geom(out_png, W, H):
    """Projected screen positions (px) of the beam, rays and prism for this frame, so the 2D
    layers (sparks, overlays, icon hand-off) can be locked to the 3D render."""
    import json
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    bpy.context.view_layer.update()

    def P(v):
        c = world_to_camera_view(sc, R.cam, Vector(v))
        return [round(c.x * W, 2), round((1 - c.y) * H, 2), round(c.z, 3)]

    rays = []
    for k in range(R.n):
        X, d2 = R.outs[k]
        rays.append([P(to3(X)), P(to3(X + d2 * 6.0))])
    tri = triangle(-R.prism.rotation_euler.y, (R.prism.location.x, R.prism.location.z))
    g = dict(beam=[P(to3(R.beam_start)), P(to3(R.E))], rays=rays,
             prism=[P(to3(p)) for p in tri], centroid=P(R.prism.location))
    with open(out_png[:-4] + ".json", "w") as f:
        json.dump(g, f)


# ---------------------------------------------------------------- main
STILL_RES = {"kv_portrait": (2160, 3840), "kv_square": (3000, 3000)}
ANIM = {"coldopen": state_coldopen, "bridge": state_bridge, "outro": state_outro}


def main():
    reset()
    shot = args.shot
    if args.res:
        w, h = (int(x) for x in args.res.split("x"))
    else:
        w, h = STILL_RES.get(shot, (3840, 2160) if shot.startswith("kv_") else (1920, 1080))
    setup_render(w, h, args.transparent)
    setup_world()
    build(shot, args.transparent)
    setup_compositor(glare=not args.noglare and not args.transparent)
    if args.transparent:
        bpy.context.scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    sc = bpy.context.scene
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    if shot in ANIM:
        a, b = (int(x) for x in (args.frames or "0:60").split(":"))
        for fr in range(a, b):
            out = args.out.replace("####", f"{fr:04d}")
            if os.path.exists(out) and os.path.getsize(out) > 0:
                continue
            ANIM[shot](fr / args.fps)
            export_geom(out, w * args.percent // 100, h * args.percent // 100)
            sc.render.filepath = out
            bpy.ops.render.render(write_still=True)
            print("FRAME", fr, flush=True)
    else:
        state_still(shot)
        if args.save_blend:
            bpy.ops.wm.save_as_mainfile(filepath=args.save_blend)
        sc.render.filepath = args.out
        bpy.ops.render.render(write_still=True)
        print("WROTE", args.out, flush=True)


main()
