
import bpy, traceback
INITIAL_DELAY = 0.45
STEP_DELAY = 0.18
_lingxi_steps = []

def add_step(fn, delay=STEP_DELAY):
    _lingxi_steps.append((fn, delay))

def _run_step(index=0):
    try:
        if index >= len(_lingxi_steps):
            return None
        fn, delay = _lingxi_steps[index]
        fn()
        try:
            bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
        except Exception:
            pass
        return max(0.01, float(delay))
    except Exception:
        traceback.print_exc()
        return None

import bpy, math, os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAT_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "cats")
GLB_PATH = os.path.join(CAT_DIR, "lingxi-kitten.glb")
BLEND_PATH = os.path.join(CAT_DIR, "lingxi-kitten.blend")
PREVIEW_PATH = os.path.join(CAT_DIR, "lingxi-kitten.png")
os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)

def mat(name, color, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = 0.58
        if emission:
            bsdf.inputs['Emission Color'].default_value = emission
            bsdf.inputs['Emission Strength'].default_value = strength
    return m

orange = None
cream = None
pink = None
dark = None

def setup_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.render.resolution_x = 1280
    bpy.context.scene.render.resolution_y = 960
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.color = (0.96, 0.97, 1.0)

def create_materials():
    global orange, cream, pink, dark
    orange = mat('cat_orange', (0.92, 0.58, 0.24, 1))
    cream = mat('cat_cream', (0.98, 0.9, 0.78, 1))
    pink = mat('cat_pink', (0.96, 0.64, 0.72, 1))
    dark = mat('cat_dark', (0.1, 0.08, 0.08, 1))

def add_body():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=(0, 0, 0.72))
    body = bpy.context.object
    body.name = 'cat_body'
    body.scale = (0.72, 0.5, 0.62)
    body.data.materials.append(orange)

def add_head():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, location=(0, -0.34, 1.35))
    head = bpy.context.object
    head.name = 'cat_head'
    head.scale = (0.5, 0.48, 0.46)
    head.data.materials.append(orange)

def add_ears():
    for x in (-0.22, 0.22):
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.16, depth=0.34, location=(x, -0.34, 1.74))
        ear = bpy.context.object
        ear.name = 'cat_ear_L' if x < 0 else 'cat_ear_R'
        ear.rotation_euler[2] = math.radians(45)
        ear.data.materials.append(orange)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.08, depth=0.18, location=(x, -0.36, 1.69))
        inner = bpy.context.object
        inner.name = 'cat_inner_ear_L' if x < 0 else 'cat_inner_ear_R'
        inner.rotation_euler[2] = math.radians(45)
        inner.data.materials.append(pink)

def add_face():
    for x in (-0.12, 0.12):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(x, -0.76, 1.42))
        eye = bpy.context.object
        eye.name = 'cat_eye_L' if x < 0 else 'cat_eye_R'
        eye.scale = (0.055, 0.03, 0.07)
        eye.data.materials.append(dark)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(0, -0.7, 1.28))
    muzzle = bpy.context.object
    muzzle.name = 'cat_muzzle'
    muzzle.scale = (0.2, 0.14, 0.13)
    muzzle.data.materials.append(cream)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=(0, -0.86, 1.31))
    nose = bpy.context.object
    nose.name = 'cat_nose'
    nose.scale = (0.045, 0.025, 0.03)
    nose.data.materials.append(pink)

def add_legs():
    coords = [(-0.24, -0.08), (0.24, -0.08), (-0.24, 0.22), (0.24, 0.22)]
    for idx, (x, y) in enumerate(coords):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(x, y, 0.18))
        leg = bpy.context.object
        leg.name = f'cat_leg_{idx}'
        leg.scale = (0.12, 0.12, 0.28)
        leg.data.materials.append(orange)

def add_tail():
    bpy.ops.curve.primitive_bezier_curve_add(location=(0.0, 0.46, 0.95))
    tail = bpy.context.object
    tail.name = 'cat_tail'
    tail.data.bevel_depth = 0.06
    tail.data.resolution_u = 24
    p0 = tail.data.splines[0].bezier_points[0]
    p1 = tail.data.splines[0].bezier_points[1]
    p0.co = (0.0, 0.35, 0.8)
    p0.handle_right = (0.0, 0.55, 1.05)
    p1.co = (0.0, 0.92, 1.42)
    p1.handle_left = (0.0, 0.72, 1.18)
    tail.data.materials.append(orange)

def add_ground():
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.12))
    plane = bpy.context.object
    plane.name = 'ground'
    plane.data.materials.append(cream)

def add_lights():
    bpy.ops.object.light_add(type='AREA', location=(0, -3.4, 4.1))
    key = bpy.context.object
    key.data.energy = 900
    key.data.size = 4
    bpy.ops.object.light_add(type='POINT', location=(-1.8, 2.0, 2.1))
    rim = bpy.context.object
    rim.data.energy = 180
    rim.data.color = (1.0, 0.78, 0.62)

def add_camera():
    bpy.ops.object.camera_add(location=(0, -4.8, 1.7), rotation=(math.radians(80), 0, 0))
    camera = bpy.context.object
    camera.name = 'cat_camera'
    bpy.context.scene.camera = camera

def save_blend():
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

def export_glb():
    bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format='GLB')

def render_preview():
    bpy.context.scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print('LINGXI_CAT_OUTPUT', GLB_PATH, BLEND_PATH, PREVIEW_PATH)

add_step(setup_scene, 0.2)
add_step(create_materials, 0.18)
add_step(add_body, 0.2)
add_step(add_head, 0.2)
add_step(add_ears, 0.22)
add_step(add_face, 0.2)
add_step(add_legs, 0.2)
add_step(add_tail, 0.22)
add_step(add_ground, 0.14)
add_step(add_lights, 0.18)
add_step(add_camera, 0.16)
add_step(save_blend, 0.18)
add_step(export_glb, 0.26)
add_step(render_preview, 0.32)


def _register():
    for idx in range(len(_lingxi_steps)):
        bpy.app.timers.register(lambda step_index=idx: _run_step(step_index), first_interval=INITIAL_DELAY + idx * STEP_DELAY)
    return None

bpy.app.timers.register(_register, first_interval=0.05)
