
import bpy, os, runpy, traceback, time

SCRIPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lingxi-kitten.py")

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
