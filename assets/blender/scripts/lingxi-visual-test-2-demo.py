
import bpy, math, os, time
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(SCRIPT_DIR)
GLB_PATH = os.path.join(BLENDER_DIR, "models", "lingxi-visual-test-2.glb")
BLEND_PATH = os.path.join(BLENDER_DIR, "models", "lingxi-visual-test-2.blend")
PREVIEW_PATH = os.path.join(BLENDER_DIR, "previews", "lingxi-visual-test-2.png")
THEME = "cyberpunk AI world"

def redraw(delay=0.45):
    try:
        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
    except Exception:
        pass
    time.sleep(delay)

def mat(name, color, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = 0.36
        bsdf.inputs['Metallic'].default_value = 0.15
        if emission:
            bsdf.inputs['Emission Color'].default_value = emission
            bsdf.inputs['Emission Strength'].default_value = strength
    return m

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 64
bpy.context.scene.view_settings.view_transform = 'Filmic'
bpy.context.scene.view_settings.look = 'Medium High Contrast'

core_mat = mat('deep violet glass', (0.18, 0.08, 0.36, 1), (0.62, 0.22, 1.0, 1), 0.35)
ring_mat = mat('neon cyan metal', (0.02, 0.55, 0.78, 1), (0.0, 0.9, 1.0, 1), 1.4)
gold_mat = mat('warm gold accent', (1.0, 0.58, 0.16, 1), (1.0, 0.34, 0.08, 1), 0.4)

bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, location=(0, 0, 0))
core = bpy.context.object
core.name = 'AI generated central world - ' + THEME
core.scale = (1.35, 1.35, 1.35)
core.data.materials.append(core_mat)
redraw()

for i, angle in enumerate([0, 60, 120]):
    bpy.ops.mesh.primitive_torus_add(major_radius=1.85 + i * 0.12, minor_radius=0.025, major_segments=160, minor_segments=12, location=(0, 0, 0))
    ring = bpy.context.object
    ring.name = 'animated orbit ring %d' % (i + 1)
    ring.rotation_euler[0] = math.radians(65)
    ring.rotation_euler[2] = math.radians(angle)
    ring.data.materials.append(ring_mat if i % 2 == 0 else gold_mat)
    redraw(0.32)

for i in range(18):
    angle = math.tau * i / 18
    radius = 2.35 + (i % 3) * 0.18
    z = ((i % 5) - 2) * 0.18
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.075 + (i % 4) * 0.012, location=(math.cos(angle) * radius, math.sin(angle) * radius, z))
    sat = bpy.context.object
    sat.name = 'small orbit asset %02d' % i
    sat.data.materials.append(gold_mat if i % 2 else ring_mat)
    redraw(0.06)

bpy.ops.object.light_add(type='AREA', location=(0, -4, 5))
key = bpy.context.object
key.name = 'large softbox key light'
key.data.energy = 520
key.data.size = 5
redraw(0.2)

bpy.ops.object.light_add(type='POINT', location=(-2.4, 2.2, 1.8))
rim = bpy.context.object
rim.name = 'cyan rim light'
rim.data.color = (0.2, 0.9, 1.0)
rim.data.energy = 280
redraw(0.2)

bpy.ops.object.camera_add(location=(4.5, -5.0, 3.2), rotation=(math.radians(60), 0, math.radians(42)))
camera = bpy.context.object
bpy.context.scene.camera = camera
camera.name = 'preview camera'

bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format='GLB')
bpy.context.scene.render.filepath = PREVIEW_PATH
bpy.ops.render.render(write_still=True)
print('LINGXI_BLENDER_OUTPUT', GLB_PATH, BLEND_PATH, PREVIEW_PATH)
redraw(1.2)
