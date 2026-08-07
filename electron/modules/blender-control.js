/**
 * Blender visual control bridge.
 * Runs Blender in a visible window by default so users can watch model construction.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync, execFile, spawn } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

let blenderTaskQueue = Promise.resolve()

function enqueueBlenderTask(task) {
  const queued = blenderTaskQueue.catch(() => {}).then(task)
  blenderTaskQueue = queued.catch(() => {})
  return queued
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch (error) {
    return false
  }
}

function dirExists(dirPath) {
  try {
    return !!dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
  } catch (error) {
    return false
  }
}

function getCandidatePaths() {
  const candidates = []
  if (process.env.BLENDER_PATH) candidates.push(process.env.BLENDER_PATH)
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'Blender Foundation', 'Blender', 'blender.exe'))
  if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Blender Foundation', 'Blender', 'blender.exe'))
  candidates.push('C:\\Program Files\\Blender Foundation\\Blender\\blender.exe')
  candidates.push('D:\\Steam\\steamapps\\common\\Blender\\blender.exe')
  candidates.push('C:\\Steam\\steamapps\\common\\Blender\\blender.exe')

  const steamCommonRoots = [
    'D:\\Steam\\steamapps\\common',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'C:\\Program Files\\Steam\\steamapps\\common'
  ]
  for (const root of steamCommonRoots) {
    if (!dirExists(root)) continue
    try {
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        if (item.isDirectory() && /blender/i.test(item.name)) {
          candidates.push(path.join(root, item.name, 'blender.exe'))
        }
      }
    } catch (error) { /* 读取 Steam 目录失败 */ }
  }

  try {
    const whereOutput = execFileSync('where', ['blender'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    whereOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(item => candidates.push(item))
  } catch (error) { /* where 命令未找到 blender */ }

  try {
    const regOutput = execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Blender' } | ForEach-Object { $_.InstallLocation; $_.DisplayIcon }"
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    regOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(item => {
      const cleaned = item.replace(/^"|"$/g, '').replace(/,.*$/, '')
      candidates.push(cleaned)
      candidates.push(path.join(cleaned, 'blender.exe'))
    })
  } catch (error) { /* 注册表查询 Blender 安装信息失败 */ }

  return [...new Set(candidates)]
}

function findBlenderExecutable() {
  for (const candidate of getCandidatePaths()) {
    if (fileExists(candidate)) return candidate
  }
  return null
}

function getBlenderStatus() {
  const executable = findBlenderExecutable()
  if (!executable) {
    return {
      success: false,
      found: false,
      error: 'Blender executable not found. Set BLENDER_PATH or install Blender in a standard location.',
      searched: getCandidatePaths()
    }
  }
  let version = ''
  try {
    version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 }).split(/\r?\n/)[0] || ''
  } catch (error) {
    version = error.message
  }
  return { success: true, found: true, executable, version }
}

async function getCandidatePathsAsync() {
  const candidates = []
  if (process.env.BLENDER_PATH) candidates.push(process.env.BLENDER_PATH)
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'Blender Foundation', 'Blender', 'blender.exe'))
  if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Blender Foundation', 'Blender', 'blender.exe'))
  candidates.push('C:\\Program Files\\Blender Foundation\\Blender\\blender.exe')
  candidates.push('D:\\Steam\\steamapps\\common\\Blender\\blender.exe')
  candidates.push('C:\\Steam\\steamapps\\common\\Blender\\blender.exe')

  const steamCommonRoots = [
    'D:\\Steam\\steamapps\\common',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'C:\\Program Files\\Steam\\steamapps\\common'
  ]
  for (const root of steamCommonRoots) {
    if (!dirExists(root)) continue
    try {
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        if (item.isDirectory() && /blender/i.test(item.name)) {
          candidates.push(path.join(root, item.name, 'blender.exe'))
        }
      }
    } catch (error) { /* 读取 Steam 目录失败 */ }
  }

  try {
    const { stdout } = await execFileAsync('where', ['blender'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(item => candidates.push(item))
  } catch (error) { /* where 命令未找到 blender */ }

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Blender' } | ForEach-Object { $_.InstallLocation; $_.DisplayIcon }"
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(item => {
      const cleaned = item.replace(/^"|"$/g, '').replace(/,.*$/, '')
      candidates.push(cleaned)
      candidates.push(path.join(cleaned, 'blender.exe'))
    })
  } catch (error) { /* 注册表查询 Blender 安装信息失败 */ }

  return [...new Set(candidates)]
}

async function findBlenderExecutableAsync() {
  for (const candidate of await getCandidatePathsAsync()) {
    if (fileExists(candidate)) return candidate
  }
  return null
}

async function getBlenderStatusAsync() {
  const executable = await findBlenderExecutableAsync()
  if (!executable) {
    return {
      success: false,
      found: false,
      error: 'Blender executable not found. Set BLENDER_PATH or install Blender in a standard location.',
      searched: await getCandidatePathsAsync()
    }
  }
  let version = ''
  try {
    const { stdout } = await execFileAsync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
    version = stdout.split(/\r?\n/)[0] || ''
  } catch (error) {
    version = error.message
  }
  return { success: true, found: true, executable, version }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
  return dirPath
}

function resolveProjectPath(projectPath, relativeOrAbsolute) {
  if (!relativeOrAbsolute) return projectPath
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(projectPath, relativeOrAbsolute)
}

function writeScript(projectPath, script, name = '') {
  const scriptsDir = ensureDir(path.join(projectPath || process.cwd(), 'assets', 'blender', 'scripts'))
  const fileName = (name || `blender-script-${Date.now()}`).replace(/[<>:"/\\|?*]+/g, '-')
  const scriptPath = path.join(scriptsDir, fileName.endsWith('.py') ? fileName : `${fileName}.py`)
  fs.writeFileSync(scriptPath, script, 'utf8')
  return scriptPath
}

function writeAutoQuitWrapper(projectPath, scriptPath, name = '') {
  const wrapper = `
import bpy, runpy, traceback, time

SCRIPT_PATH = ${toPythonString(scriptPath)}

def wait_for_blender_idle(max_wait=5.0, check_interval=0.1):
    """等待 Blender 后台任务完成（渲染、保存、GPU清理）"""
    start_time = time.time()
    while time.time() - start_time < max_wait:
        # 检查是否有渲染任务运行
        if hasattr(bpy.app, 'is_job_running'):
            try:
                if bpy.app.is_job_running('RENDER'):
                    time.sleep(check_interval)
                    continue
            except Exception:
                pass
        
        # 检查是否有其他后台任务
        try:
            if bpy.context.scene.render.engine == 'CYCLES':
                # Cycles 渲染可能需要更多时间
                time.sleep(check_interval * 2)
            else:
                time.sleep(check_interval)
        except Exception:
            time.sleep(check_interval)
        
        # 如果没有检测到活跃任务，退出等待
        break

try:
    runpy.run_path(SCRIPT_PATH, run_name='__main__')
except SystemExit:
    raise
except Exception:
    traceback.print_exc()
    raise
finally:
    # 等待 Blender 后台任务完成
    wait_for_blender_idle(max_wait=3.0)
    
    # 确保所有视图更新完成
    try:
        bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
        time.sleep(0.5)
    except Exception:
        pass
    
    # 安全退出 Blender
    try:
        bpy.ops.wm.quit_blender()
    except Exception:
        pass
`
  return writeScript(projectPath, wrapper, name || `auto-quit-${path.basename(scriptPath)}`)
}

function runBlenderScript(args = {}, projectPath = '') {
  const status = getBlenderStatus()
  if (!status.success) return status

  const script = args.script || ''
  const openOnly = args.open_only === true || args.openOnly === true
  const originalScriptPath = args.script_path
    ? resolveProjectPath(projectPath, args.script_path)
    : openOnly
      ? ''
    : writeScript(projectPath, script, args.name || 'ai-blender-script')
  if (!openOnly && !fileExists(originalScriptPath)) {
    return { success: false, error: `Blender script not found: ${originalScriptPath}` }
  }

  const scriptPath = openOnly
    ? ''
    : args.auto_quit === true
    ? writeAutoQuitWrapper(projectPath, originalScriptPath, `${args.name || 'ai-blender-script'}-auto-quit`)
    : originalScriptPath

  const visible = args.visible !== false
  const requestedWait = args.wait === true
  const wait = requestedWait && (!visible || args.allow_visible_wait === true || args.auto_quit === true)
  const blenderArgs = []
  if (!visible) blenderArgs.push('--background')
  if (args.blend_path || args.blendPath) {
    const blendPath = resolveProjectPath(projectPath, args.blend_path || args.blendPath)
    if (!fileExists(blendPath)) {
      return { success: false, error: `Blender file not found: ${blendPath}` }
    }
    blenderArgs.push(blendPath)
  }
  if (!openOnly) blenderArgs.push('--python', scriptPath)

  if (wait && args.__queued !== true) {
    return enqueueBlenderTask(() => runBlenderScript({
      ...args,
      script: '',
      script_path: originalScriptPath,
      __queued: true
    }, projectPath))
  }

  const child = spawn(status.executable, blenderArgs, {
    cwd: projectPath || path.dirname(scriptPath),
    windowsHide: !visible,
    detached: false,
    stdio: wait ? ['ignore', 'pipe', 'pipe'] : 'ignore'
  })

  if (!wait) {
    child.unref?.()
    return {
      success: true,
      executable: status.executable,
      scriptPath,
      originalScriptPath,
      visible,
      pid: child.pid,
      waitDowngraded: requestedWait && visible && args.allow_visible_wait !== true,
      message: visible
        ? 'Blender opened visibly and is running the script.'
        : 'Blender background task started.'
    }
  }

  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let resolved = false
    
    child.stdout?.on('data', data => { stdout += data.toString() })
    child.stderr?.on('data', data => { stderr += data.toString() })
    
    child.on('error', error => {
      if (!resolved) {
        resolved = true
        resolve({ success: false, error: error.message, executable: status.executable, scriptPath })
      }
    })
    
    child.on('close', code => {
      if (!resolved) {
        resolved = true
        resolve({
          success: code === 0,
          executable: status.executable,
          scriptPath,
          originalScriptPath,
          visible,
          exitCode: code,
          stdout: stdout.slice(-8000),
          stderr: stderr.slice(-8000)
        })
      }
    })
    
    // 添加超时保护，防止 Blender 进程卡住
    if (args.timeout && Number.isFinite(args.timeout)) {
      const timeoutMs = Math.max(1000, Number.parseInt(args.timeout, 10))
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          try {
            child.kill()
          } catch (e) { /* 进程可能已退出 */ }
          resolve({
            success: false,
            error: `Blender process timeout after ${timeoutMs}ms`,
            executable: status.executable,
            scriptPath,
            stdout: stdout.slice(-8000),
            stderr: stderr.slice(-8000)
          })
        }
      }, timeoutMs)
    }
  })
}

function toPythonString(value) {
  return JSON.stringify(String(value || ''))
}

function safeFileName(value = 'blender-asset') {
  return String(value || 'blender-asset').replace(/[<>:"/\\|?*]+/g, '-')
}

function wrapDeferredBlenderScript(body, options = {}) {
  const initialDelay = Number.isFinite(options.initialDelay) ? options.initialDelay : 0.45
  const stepDelay = Number.isFinite(options.stepDelay) ? options.stepDelay : 0.2
  return `
import bpy, traceback

INITIAL_DELAY = ${initialDelay}
STEP_DELAY = ${stepDelay}
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

${body}

def _register():
    for idx in range(len(_lingxi_steps)):
        bpy.app.timers.register(lambda step_index=idx: _run_step(step_index), first_interval=INITIAL_DELAY + idx * STEP_DELAY)
    return None

bpy.app.timers.register(_register, first_interval=0.05)
`
}

function buildDemoScript(projectPath, options = {}) {
  const outputDir = ensureDir(resolveProjectPath(projectPath, options.output_dir || path.join('assets', 'blender', 'models')))
  const previewDir = ensureDir(resolveProjectPath(projectPath, options.preview_dir || path.join('assets', 'blender', 'previews')))
  const safeName = String(options.name || 'lingxi-cyber-orb').replace(/[<>:"/\|?*]+/g, '-')
  const glbPath = path.join(outputDir, `${safeName}.glb`)
  const blendPath = path.join(outputDir, `${safeName}.blend`)
  const previewPath = path.join(previewDir, `${safeName}.png`)
  const theme = options.theme || 'cyberpunk glowing artifact'
  const slowMode = options.slow_mode !== false && options.visual_delay !== false
  const initialDelay = slowMode ? 0.65 : 0.35
  const stepDelay = slowMode ? 0.45 : 0.2
  const satelliteSteps = Array.from({ length: 18 }, (_, i) => `add_step(lambda: create_satellite(${i}), 0.08)`).join('\n')
  const script = wrapDeferredBlenderScript(`
import bpy, math

GLB_PATH = ${toPythonString(glbPath)}
BLEND_PATH = ${toPythonString(blendPath)}
PREVIEW_PATH = ${toPythonString(previewPath)}
THEME = ${toPythonString(theme)}

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

core_mat = None
ring_mat = None
gold_mat = None

def setup_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.view_settings.view_transform = 'Filmic'
    bpy.context.scene.view_settings.look = 'Medium High Contrast'

def create_materials():
    global core_mat, ring_mat, gold_mat
    core_mat = mat('deep violet glass', (0.18, 0.08, 0.36, 1), (0.62, 0.22, 1.0, 1), 0.35)
    ring_mat = mat('neon cyan metal', (0.02, 0.55, 0.78, 1), (0.0, 0.9, 1.0, 1), 1.4)
    gold_mat = mat('warm gold accent', (1.0, 0.58, 0.16, 1), (1.0, 0.34, 0.08, 1), 0.4)

def create_core():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, location=(0, 0, 0))
    core = bpy.context.object
    core.name = 'AI generated central world - ' + THEME
    core.scale = (1.35, 1.35, 1.35)
    core.data.materials.append(core_mat)

def create_ring(index, angle):
    bpy.ops.mesh.primitive_torus_add(major_radius=1.85 + index * 0.12, minor_radius=0.025, major_segments=160, minor_segments=12, location=(0, 0, 0))
    ring = bpy.context.object
    ring.name = 'animated orbit ring %d' % (index + 1)
    ring.rotation_euler[0] = math.radians(65)
    ring.rotation_euler[2] = math.radians(angle)
    ring.data.materials.append(ring_mat if index % 2 == 0 else gold_mat)

def create_satellite(i):
    angle = math.tau * i / 18
    radius = 2.35 + (i % 3) * 0.18
    z = ((i % 5) - 2) * 0.18
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.075 + (i % 4) * 0.012, location=(math.cos(angle) * radius, math.sin(angle) * radius, z))
    sat = bpy.context.object
    sat.name = 'small orbit asset %02d' % i
    sat.data.materials.append(gold_mat if i % 2 else ring_mat)

def add_lights():
    bpy.ops.object.light_add(type='AREA', location=(0, -4, 5))
    key = bpy.context.object
    key.name = 'large softbox key light'
    key.data.energy = 520
    key.data.size = 5
    bpy.ops.object.light_add(type='POINT', location=(-2.4, 2.2, 1.8))
    rim = bpy.context.object
    rim.name = 'cyan rim light'
    rim.data.color = (0.2, 0.9, 1.0)
    rim.data.energy = 280

def add_camera():
    bpy.ops.object.camera_add(location=(4.5, -5.0, 3.2), rotation=(math.radians(60), 0, math.radians(42)))
    camera = bpy.context.object
    bpy.context.scene.camera = camera
    camera.name = 'preview camera'

def save_blend():
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

def export_glb():
    bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format='GLB')

def render_preview():
    bpy.context.scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print('LINGXI_BLENDER_OUTPUT', GLB_PATH, BLEND_PATH, PREVIEW_PATH)

add_step(setup_scene, 0.2)
add_step(create_materials, 0.2)
add_step(create_core, 0.28)
add_step(lambda: create_ring(0, 0), 0.22)
add_step(lambda: create_ring(1, 60), 0.22)
add_step(lambda: create_ring(2, 120), 0.22)
${satelliteSteps}
add_step(add_lights, 0.2)
add_step(add_camera, 0.18)
add_step(save_blend, 0.2)
add_step(export_glb, 0.28)
add_step(render_preview, 0.35)
`, { initialDelay, stepDelay })

  return { script, glbPath, blendPath, previewPath, outputDir, previewDir }
}

function createDemoModel(args = {}, projectPath = '') {
  const built = buildDemoScript(projectPath || process.cwd(), args)
  const scriptPath = writeScript(projectPath || process.cwd(), built.script, `${args.name || 'lingxi-cyber-orb'}-demo`)
  const runResult = runBlenderScript({
    script_path: scriptPath,
    visible: args.visible !== false,
    wait: args.wait === true
  }, projectPath || process.cwd())

  if (runResult && typeof runResult.then === 'function') {
    return runResult.then(result => ({ ...result, ...built, scriptPath }))
  }
  return { ...runResult, ...built, scriptPath }
}

function buildModifySceneScript(projectPath, options = {}) {
  const baseProjectPath = projectPath || process.cwd()
  const safeName = safeFileName(options.name || 'lingxi-blender-asset')
  const outputDir = ensureDir(resolveProjectPath(baseProjectPath, options.output_dir || path.join('assets', 'blender', 'models')))
  const previewDir = ensureDir(resolveProjectPath(baseProjectPath, options.preview_dir || path.join('assets', 'blender', 'previews')))
  const viewsDir = ensureDir(resolveProjectPath(baseProjectPath, options.views_dir || path.join('assets', 'blender', 'views', safeName)))
  const blendPath = resolveProjectPath(baseProjectPath, options.output_blend || path.join('assets', 'blender', 'models', `${safeName}.blend`))
  const glbPath = resolveProjectPath(baseProjectPath, options.output_glb || path.join('assets', 'blender', 'models', `${safeName}.glb`))
  const previewPath = resolveProjectPath(baseProjectPath, options.preview_path || path.join('assets', 'blender', 'previews', `${safeName}.png`))
  const operations = Array.isArray(options.operations) && options.operations.length
    ? options.operations
    : [{ type: 'smooth' }, { type: 'lighting' }, { type: 'render_preview' }, { type: 'save' }]

  ensureDir(path.dirname(blendPath))
  ensureDir(path.dirname(glbPath))
  ensureDir(path.dirname(previewPath))

  const script = `
import bpy, math, os, json, traceback

OPERATIONS = json.loads(${toPythonString(JSON.stringify(operations))})
OUTPUT_BLEND = ${toPythonString(blendPath)}
OUTPUT_GLB = ${toPythonString(glbPath)}
PREVIEW_PATH = ${toPythonString(previewPath)}
VIEWS_DIR = ${toPythonString(viewsDir)}

def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if getattr(obj, 'type', None) == 'MESH']

def selected_or_all_meshes():
    selected = [obj for obj in bpy.context.selected_objects if getattr(obj, 'type', None) == 'MESH']
    return selected or mesh_objects()

def set_active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def ensure_material(name='auto material', color=(0.72, 0.72, 0.78, 1.0), metallic=0.05, roughness=0.42, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        if 'Base Color' in bsdf.inputs:
            bsdf.inputs['Base Color'].default_value = color
        if 'Metallic' in bsdf.inputs:
            bsdf.inputs['Metallic'].default_value = float(metallic)
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = float(roughness)
        if emission is not None and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = emission
        if emission is not None and 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = float(emission_strength)
    return mat

def op_smooth(op):
    angle = float(op.get('angle', 30))
    count = 0
    for obj in selected_or_all_meshes():
        set_active(obj)
        try:
            for poly in obj.data.polygons:
                poly.use_smooth = True
            count += 1
            try:
                mod = obj.modifiers.get('Lingxi Weighted Normal') or obj.modifiers.new('Lingxi Weighted Normal', 'WEIGHTED_NORMAL')
                mod.keep_sharp = True
                mod.weight = 50
            except Exception:
                pass
            try:
                obj.data.update()
            except Exception:
                pass
        except Exception:
            traceback.print_exc()
    print('LINGXI_SMOOTHED', count, 'angle', angle)

def op_subdivision(op):
    levels = max(0, min(4, int(op.get('levels', 1))))
    render_levels = max(levels, min(4, int(op.get('render_levels', levels))))
    count = 0
    for obj in selected_or_all_meshes():
        mod = obj.modifiers.get('Lingxi Subdivision') or obj.modifiers.new('Lingxi Subdivision', 'SUBSURF')
        mod.levels = levels
        mod.render_levels = render_levels
        count += 1
        if op.get('apply') is True:
            set_active(obj)
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception:
                traceback.print_exc()
    print('LINGXI_SUBDIVISION', count, levels, render_levels)

def op_bevel(op):
    width = max(0.0, float(op.get('width', 0.025)))
    segments = max(1, min(16, int(op.get('segments', 3))))
    count = 0
    for obj in selected_or_all_meshes():
        mod = obj.modifiers.get('Lingxi Bevel') or obj.modifiers.new('Lingxi Bevel', 'BEVEL')
        mod.width = width
        mod.segments = segments
        mod.affect = 'EDGES'
        count += 1
        if op.get('apply') is True:
            set_active(obj)
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception:
                traceback.print_exc()
    print('LINGXI_BEVEL', count, width, segments)

def op_material(op):
    color = op.get('color') or [0.72, 0.72, 0.78, 1.0]
    if len(color) == 3:
        color = [color[0], color[1], color[2], 1.0]
    emission = op.get('emission')
    if isinstance(emission, list) and len(emission) == 3:
        emission = [emission[0], emission[1], emission[2], 1.0]
    mat = ensure_material(
        op.get('name') or 'Lingxi material',
        tuple(color),
        op.get('metallic', 0.05),
        op.get('roughness', 0.42),
        tuple(emission) if isinstance(emission, list) else None,
        op.get('emission_strength', 0.0)
    )
    count = 0
    for obj in selected_or_all_meshes():
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)
        count += 1
    print('LINGXI_MATERIAL', count, mat.name)

def op_merge_by_distance(op):
    distance = max(0.0, float(op.get('distance', 0.001)))
    count = 0
    for obj in selected_or_all_meshes():
        set_active(obj)
        try:
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.remove_doubles(threshold=distance)
            bpy.ops.object.mode_set(mode='OBJECT')
            count += 1
        except Exception:
            try:
                bpy.ops.object.mode_set(mode='OBJECT')
            except Exception:
                pass
            traceback.print_exc()
    print('LINGXI_MERGE_BY_DISTANCE', count, distance)

def op_lighting(op):
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'LIGHT' and op.get('replace', True):
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.light_add(type='AREA', location=(0, -4.5, 5.0))
    key = bpy.context.object
    key.name = 'Lingxi soft key light'
    key.data.energy = float(op.get('key_energy', 550))
    key.data.size = float(op.get('key_size', 5.0))
    bpy.ops.object.light_add(type='POINT', location=(-2.6, 2.2, 2.1))
    rim = bpy.context.object
    rim.name = 'Lingxi rim light'
    rim.data.energy = float(op.get('rim_energy', 180))
    rim.data.color = tuple(op.get('rim_color') or [0.55, 0.78, 1.0])
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.color = tuple(op.get('world_color') or [0.03, 0.035, 0.045])
    print('LINGXI_LIGHTING')

def look_at(obj, target):
    dx = target[0] - obj.location.x
    dy = target[1] - obj.location.y
    dz = target[2] - obj.location.z
    direction = mathutils.Vector((dx, dy, dz))
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

def scene_center():
    objs = mesh_objects()
    if not objs:
        return (0, 0, 0)
    xs = [obj.location.x for obj in objs]
    ys = [obj.location.y for obj in objs]
    zs = [obj.location.z for obj in objs]
    return (sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs))

def setup_camera(location=(4.2, -5.2, 3.2), target=None, lens=55):
    import mathutils
    target = target or scene_center()
    if not bpy.context.scene.camera:
        bpy.ops.object.camera_add()
    cam = bpy.context.scene.camera
    cam.location = location
    direction = mathutils.Vector((target[0] - cam.location.x, target[1] - cam.location.y, target[2] - cam.location.z))
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    return cam

def op_render_preview(op):
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.render.resolution_x = int(op.get('width', 1200))
    bpy.context.scene.render.resolution_y = int(op.get('height', 900))
    setup_camera(tuple(op.get('camera') or [4.2, -5.2, 3.2]), None, float(op.get('lens', 55)))
    bpy.context.scene.render.filepath = op.get('path') or PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print('LINGXI_PREVIEW', bpy.context.scene.render.filepath)

def op_render_views(op):
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.render.resolution_x = int(op.get('width', 900))
    bpy.context.scene.render.resolution_y = int(op.get('height', 900))
    os.makedirs(VIEWS_DIR, exist_ok=True)
    views = {
        'front': (0, -5, 1.6),
        'back': (0, 5, 1.6),
        'left': (-5, 0, 1.6),
        'right': (5, 0, 1.6),
        'top': (0, -0.01, 6.5)
    }
    written = []
    for name, loc in views.items():
        setup_camera(loc, None, float(op.get('lens', 55)))
        out = os.path.join(VIEWS_DIR, name + '.png')
        bpy.context.scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        written.append(out)
        print('LINGXI_VIEW', name, out)
    return written

def op_save(op):
    filepath = op.get('path') or OUTPUT_BLEND
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=filepath)
    print('LINGXI_BLEND', filepath)

def op_export_glb(op):
    filepath = op.get('path') or OUTPUT_GLB
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=filepath, export_format='GLB')
    print('LINGXI_GLB', filepath)

handlers = {
    'smooth': op_smooth,
    'shade_smooth': op_smooth,
    'subdivision': op_subdivision,
    'subdivide': op_subdivision,
    'bevel': op_bevel,
    'material': op_material,
    'merge_by_distance': op_merge_by_distance,
    'weld': op_merge_by_distance,
    'lighting': op_lighting,
    'render_preview': op_render_preview,
    'render_views': op_render_views,
    'save': op_save,
    'export_glb': op_export_glb
}

for op in OPERATIONS:
    try:
        op_type = str(op.get('type', '')).lower()
        fn = handlers.get(op_type)
        if not fn:
            print('LINGXI_UNKNOWN_OPERATION', op_type)
            continue
        fn(op)
    except Exception:
        traceback.print_exc()
`
  return { script, blendPath, glbPath, previewPath, viewsDir, outputDir, previewDir }
}

function modifyBlenderScene(args = {}, projectPath = '') {
  const baseProjectPath = projectPath || process.cwd()
  const built = buildModifySceneScript(baseProjectPath, args)
  const scriptPath = writeScript(baseProjectPath, built.script, `${args.name || 'lingxi-blender-modify'}-modify`)
  const runResult = runBlenderScript({
    script_path: scriptPath,
    blend_path: args.blend_path || args.blendPath,
    visible: args.visible !== false,
    wait: args.wait === true,
    auto_quit: args.auto_quit === true,
    timeout: args.timeout
  }, baseProjectPath)

  const payload = {
    ...built,
    scriptPath,
    operations: Array.isArray(args.operations) ? args.operations : []
  }
  if (runResult && typeof runResult.then === 'function') {
    return runResult.then(result => ({ ...result, ...payload }))
  }
  return { ...runResult, ...payload }
}

function buildImportAssetScript(projectPath, options = {}) {
  const baseProjectPath = projectPath || process.cwd()
  const safeName = safeFileName(options.name || 'lingxi-blender-import')
  const sourcePath = resolveProjectPath(baseProjectPath, options.path || options.source_path || options.sourcePath || '')
  const outputDir = ensureDir(resolveProjectPath(baseProjectPath, options.output_dir || path.join('assets', 'blender', 'models')))
  const previewDir = ensureDir(resolveProjectPath(baseProjectPath, options.preview_dir || path.join('assets', 'blender', 'previews')))
  const blendPath = resolveProjectPath(baseProjectPath, options.output_blend || path.join('assets', 'blender', 'models', `${safeName}.blend`))
  const glbPath = resolveProjectPath(baseProjectPath, options.output_glb || path.join('assets', 'blender', 'models', `${safeName}.glb`))
  const previewPath = resolveProjectPath(baseProjectPath, options.preview_path || path.join('assets', 'blender', 'previews', `${safeName}.png`))
  const kind = String(options.kind || '').toLowerCase()

  if (!fileExists(sourcePath)) {
    return { success: false, error: `Asset not found: ${sourcePath}`, sourcePath }
  }

  ensureDir(path.dirname(blendPath))
  ensureDir(path.dirname(glbPath))
  ensureDir(path.dirname(previewPath))

  const script = `
import bpy, os, math, traceback

SOURCE_PATH = ${toPythonString(sourcePath)}
OUTPUT_BLEND = ${toPythonString(blendPath)}
OUTPUT_GLB = ${toPythonString(glbPath)}
PREVIEW_PATH = ${toPythonString(previewPath)}
KIND = ${toPythonString(kind)}
REFERENCE_PLANE = ${options.reference_plane === false ? 'False' : 'True'}
SCALE = float(${Number.isFinite(options.scale) ? options.scale : 1.0})

def ext():
    return os.path.splitext(SOURCE_PATH)[1].lower()

def clear_scene():
    if ${options.clear_scene === false ? 'False' : 'True'}:
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete()

def make_material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = 0.5
    return mat

def import_model():
    extension = ext()
    before = set(bpy.data.objects)
    if extension in ['.glb', '.gltf']:
        bpy.ops.import_scene.gltf(filepath=SOURCE_PATH)
    elif extension == '.fbx':
        bpy.ops.import_scene.fbx(filepath=SOURCE_PATH)
    elif extension == '.obj':
        bpy.ops.wm.obj_import(filepath=SOURCE_PATH)
    elif extension == '.stl':
        bpy.ops.wm.stl_import(filepath=SOURCE_PATH)
    elif extension == '.ply':
        bpy.ops.wm.ply_import(filepath=SOURCE_PATH)
    elif extension == '.blend':
        with bpy.data.libraries.load(SOURCE_PATH, link=False) as (data_from, data_to):
            data_to.objects = data_from.objects
        for obj in data_to.objects:
            if obj:
                bpy.context.collection.objects.link(obj)
    else:
        raise RuntimeError('Unsupported model format: ' + extension)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    for obj in imported:
        obj.name = 'Imported - ' + obj.name
        obj.scale = (obj.scale.x * SCALE, obj.scale.y * SCALE, obj.scale.z * SCALE)
    print('LINGXI_IMPORTED_MODEL', len(imported), SOURCE_PATH)

def import_reference_image():
    extension = ext()
    if extension not in ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']:
        raise RuntimeError('Unsupported reference image format: ' + extension)
    if REFERENCE_PLANE:
        bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0, 1.8, 1.6), rotation=(math.radians(90), 0, 0))
        plane = bpy.context.object
        plane.name = 'Reference image plane'
        mat = bpy.data.materials.new('Reference image material')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get('Principled BSDF')
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(SOURCE_PATH)
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        plane.data.materials.append(mat)
    else:
        image = bpy.data.images.load(SOURCE_PATH)
        print('LINGXI_REFERENCE_IMAGE_LOADED', image.name, image.size[0], image.size[1])

def add_lights_camera():
    bpy.ops.object.light_add(type='AREA', location=(0, -4.5, 5.0))
    key = bpy.context.object
    key.name = 'Lingxi import key light'
    key.data.energy = 450
    key.data.size = 5
    bpy.ops.object.camera_add(location=(4.2, -5.2, 3.2))
    cam = bpy.context.object
    bpy.context.scene.camera = cam
    import mathutils
    target = mathutils.Vector((0, 0, 1))
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 45

def save_outputs():
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
    try:
        bpy.ops.export_scene.gltf(filepath=OUTPUT_GLB, export_format='GLB')
    except Exception:
        traceback.print_exc()
    bpy.context.scene.render.filepath = PREVIEW_PATH
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.render.resolution_x = 1200
    bpy.context.scene.render.resolution_y = 900
    bpy.ops.render.render(write_still=True)
    print('LINGXI_IMPORT_OUTPUTS', OUTPUT_BLEND, OUTPUT_GLB, PREVIEW_PATH)

clear_scene()
if KIND == 'reference_image' or ext() in ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']:
    import_reference_image()
else:
    import_model()
add_lights_camera()
save_outputs()
`
  return { script, sourcePath, blendPath, glbPath, previewPath, outputDir, previewDir }
}

function importBlenderAsset(args = {}, projectPath = '') {
  const baseProjectPath = projectPath || process.cwd()
  const built = buildImportAssetScript(baseProjectPath, args)
  if (built.success === false) return built
  const scriptPath = writeScript(baseProjectPath, built.script, `${args.name || 'lingxi-blender-import'}-import`)
  const runResult = runBlenderScript({
    script_path: scriptPath,
    visible: args.visible !== false,
    wait: args.wait === true,
    auto_quit: args.auto_quit === true,
    timeout: args.timeout
  }, baseProjectPath)
  const payload = { ...built, scriptPath }
  if (runResult && typeof runResult.then === 'function') {
    return runResult.then(result => ({ ...result, ...payload }))
  }
  return { ...runResult, ...payload }
}

function buildInspectSceneScript(projectPath, options = {}) {
  const baseProjectPath = projectPath || process.cwd()
  const safeName = safeFileName(options.name || 'lingxi-blender-inspect')
  const reportPath = resolveProjectPath(baseProjectPath, options.report_path || path.join('assets', 'blender', 'reports', `${safeName}.json`))
  const viewsDir = ensureDir(resolveProjectPath(baseProjectPath, options.views_dir || path.join('assets', 'blender', 'views', safeName)))
  ensureDir(path.dirname(reportPath))
  const script = `
import bpy, os, json, math

REPORT_PATH = ${toPythonString(reportPath)}
VIEWS_DIR = ${toPythonString(viewsDir)}
RENDER_VIEWS = ${options.render_views === false ? 'False' : 'True'}

def mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']

def bounds(obj):
    corners = [obj.matrix_world @ v.co for v in obj.data.vertices] if getattr(obj.data, 'vertices', None) else []
    if not corners:
        return None
    xs = [v.x for v in corners]
    ys = [v.y for v in corners]
    zs = [v.z for v in corners]
    return {
        'min': [min(xs), min(ys), min(zs)],
        'max': [max(xs), max(ys), max(zs)],
        'size': [max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)]
    }

def material_names(obj):
    return [slot.material.name for slot in obj.material_slots if slot.material]

def inspect():
    meshes = mesh_objects()
    lights = [obj for obj in bpy.context.scene.objects if obj.type == 'LIGHT']
    cameras = [obj for obj in bpy.context.scene.objects if obj.type == 'CAMERA']
    issues = []
    objects = []
    for obj in meshes:
        b = bounds(obj)
        verts = len(obj.data.vertices)
        faces = len(obj.data.polygons)
        mats = material_names(obj)
        if verts == 0 or faces == 0:
            issues.append({'level': 'high', 'object': obj.name, 'issue': '空网格或无面'})
        if not mats:
            issues.append({'level': 'medium', 'object': obj.name, 'issue': '没有材质'})
        if b and (min(b['size']) <= 0.0001 or max(b['size']) > 1000):
            issues.append({'level': 'medium', 'object': obj.name, 'issue': '尺寸异常', 'size': b['size']})
        if obj.location.z < -5:
            issues.append({'level': 'low', 'object': obj.name, 'issue': '对象可能远离主场景'})
        objects.append({
            'name': obj.name,
            'vertices': verts,
            'faces': faces,
            'materials': mats,
            'location': [obj.location.x, obj.location.y, obj.location.z],
            'bounds': b
        })
    if not meshes:
        issues.append({'level': 'high', 'issue': '场景没有网格模型'})
    if not lights:
        issues.append({'level': 'medium', 'issue': '场景没有灯光'})
    if not cameras:
        issues.append({'level': 'medium', 'issue': '场景没有相机'})
    return {
        'mesh_count': len(meshes),
        'light_count': len(lights),
        'camera_count': len(cameras),
        'object_count': len(bpy.context.scene.objects),
        'objects': objects,
        'issues': issues
    }

def setup_camera(location):
    import mathutils
    if not bpy.context.scene.camera:
        bpy.ops.object.camera_add()
        bpy.context.scene.camera = bpy.context.object
    cam = bpy.context.scene.camera
    cam.location = location
    target = mathutils.Vector((0, 0, 1))
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 55

def render_views():
    os.makedirs(VIEWS_DIR, exist_ok=True)
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.render.resolution_x = 900
    bpy.context.scene.render.resolution_y = 900
    views = {
        'front': (0, -5, 1.8),
        'back': (0, 5, 1.8),
        'left': (-5, 0, 1.8),
        'right': (5, 0, 1.8),
        'top': (0, -0.01, 7)
    }
    files = []
    for name, loc in views.items():
        setup_camera(loc)
        out = os.path.join(VIEWS_DIR, name + '.png')
        bpy.context.scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        files.append(out)
    return files

report = inspect()
if RENDER_VIEWS:
    report['view_images'] = render_views()
with open(REPORT_PATH, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print('LINGXI_INSPECT_REPORT', REPORT_PATH)
`
  return { script, reportPath, viewsDir }
}

function inspectBlenderScene(args = {}, projectPath = '') {
  const baseProjectPath = projectPath || process.cwd()
  const built = buildInspectSceneScript(baseProjectPath, args)
  const scriptPath = writeScript(baseProjectPath, built.script, `${args.name || 'lingxi-blender-inspect'}-inspect`)
  const runResult = runBlenderScript({
    script_path: scriptPath,
    blend_path: args.blend_path || args.blendPath,
    visible: args.visible === true,
    wait: args.wait !== false,
    auto_quit: args.auto_quit !== false,
    timeout: args.timeout || 120000
  }, baseProjectPath)
  const payload = { ...built, scriptPath }
  const attachReport = result => {
    let report = null
    try {
      if (fs.existsSync(built.reportPath)) {
        report = JSON.parse(fs.readFileSync(built.reportPath, 'utf8'))
      }
    } catch (error) {
      report = { error: error.message }
    }
    return { ...result, ...payload, report }
  }
  if (runResult && typeof runResult.then === 'function') {
    return runResult.then(attachReport)
  }
  return attachReport(runResult)
}

function registerBlenderIPC(ipcMain) {
  ipcMain.handle('blender:status', async () => getBlenderStatusAsync())
  ipcMain.handle('blender:runScript', async (event, args = {}, projectPath = '') => runBlenderScript(args, projectPath))
  ipcMain.handle('blender:createDemoModel', async (event, args = {}, projectPath = '') => createDemoModel(args, projectPath))
  ipcMain.handle('blender:modifyScene', async (event, args = {}, projectPath = '') => modifyBlenderScene(args, projectPath))
  ipcMain.handle('blender:importAsset', async (event, args = {}, projectPath = '') => importBlenderAsset(args, projectPath))
  ipcMain.handle('blender:inspectScene', async (event, args = {}, projectPath = '') => inspectBlenderScene(args, projectPath))
}

module.exports = {
  getBlenderStatus,
  getBlenderStatusAsync,
  runBlenderScript,
  createDemoModel,
  modifyBlenderScene,
  importBlenderAsset,
  inspectBlenderScene,
  registerBlenderIPC
}
