"""
PowerPoint 自动化控制脚本
使用 pywin32 COM API 操作 PowerPoint
支持高级功能：图片、视频、音频、形状、动画、切换效果等
"""

import sys
import json
import time
import os

# 调试信息输出到 stderr，不影响 stdout 的 JSON 输出
def debug_print(msg):
    print(msg, file=sys.stderr)

# 尝试导入库
try:
    import win32com.client
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False
    debug_print("警告: pywin32 未安装，PPT COM 功能不可用")

# ===== 单位转换常量 =====
INCHES_TO_POINTS = 72  # 1英寸 = 72磅

def inches_to_points(inches):
    """英寸转磅值（不依赖PPT对象）"""
    return inches * INCHES_TO_POINTS

# ===== PowerPoint 常量定义 =====
# 幻灯片布局类型
PP_LAYOUT_BLANK = 12
PP_LAYOUT_TITLE = 1
PP_LAYOUT_TITLE_CONTENT = 2
PP_LAYOUT_SECTION_HEADER = 3
PP_LAYOUT_TWO_CONTENT = 4
PP_LAYOUT_COMPARISON = 5
PP_LAYOUT_TITLE_ONLY = 11
PP_LAYOUT_CONTENT = 6

# 形状类型
MSO_SHAPE_RECTANGLE = 1
MSO_SHAPE_ROUND_RECTANGLE = 5
MSO_SHAPE_ELLIPSE = 9
MSO_SHAPE_OVAL = 9
MSO_SHAPE_DIAMOND = 4
MSO_SHAPE_TRIANGLE = 7
MSO_SHAPE_RIGHT_TRIANGLE = 8
MSO_SHAPE_STAR_5_POINT = 12
MSO_SHAPE_ARROW_RIGHT = 33
MSO_SHAPE_LINE = 20
MSO_SHAPE_FREEFORM = 5

# 动画效果类型 (MsoAnimEffect) - 正确的 VBA 常量值
MSO_ANIM_EFFECT_APPEAR = 1        # 出现
MSO_ANIM_EFFECT_FADE = 2          # 淡入/淡出
MSO_ANIM_EFFECT_FLY = 3           # 飞入
MSO_ANIM_EFFECT_BLINDS = 4        # 百叶窗
MSO_ANIM_EFFECT_BOX = 5           # 盒状
MSO_ANIM_EFFECT_CHECKERBOARD = 6  # 棋盘
MSO_ANIM_EFFECT_COVER = 7         # 覆盖
MSO_ANIM_EFFECT_DISSOLVE = 8      # 溶解
MSO_ANIM_EFFECT_RANDOM_BARS = 9   # 随机线条
MSO_ANIM_EFFECT_SPLIT = 10        # 分裂
MSO_ANIM_EFFECT_STRIPS = 11       # 条纹
MSO_ANIM_EFFECT_WIPE = 12         # 擦除
MSO_ANIM_EFFECT_RANDOM = 13       # 随机
MSO_ANIM_EFFECT_ZOOM = 14         # 缩放
MSO_ANIM_EFFECT_EXPAND = 15       # 展开（类似浮动）
MSO_ANIM_EFFECT_WHEEL = 16        # 轮盘（部分版本）
MSO_ANIM_EFFECT_PUSH = 31         # 推进
MSO_ANIM_EFFECT_GROW_SHRINK = 33  # 放大/缩小
MSO_ANIM_EFFECT_SPIN = 34         # 旋转
MSO_ANIM_EFFECT_BOUNCE = 38       # 弹跳
MSO_ANIM_EFFECT_TRANSPARENT = 39  # 透明

# 动画触发类型 (MsoAnimTriggerType)
MSO_ANIM_TRIGGER_ON_CLICK = 0     # 点击时
MSO_ANIM_TRIGGER_AFTER_PREVIOUS = 1  # 上一个动画之后
MSO_ANIM_TRIGGER_WITH_PREVIOUS = 2   # 与上一个动画同时

# 幻灯片切换效果类型 (PpSlideShowTransitionType / EntryEffect) - 正确的 VBA 常量值
PP_TRANSITION_NONE = 0            # 无切换
PP_TRANSITION_FADE = 2            # 淡出
PP_TRANSITION_PUSH = 3            # 推进
PP_TRANSITION_WIPE = 4            # 擦除
PP_TRANSITION_SPLIT = 5           # 分裂
PP_TRANSITION_COVER = 6           # 覆盖
PP_TRANSITION_UNCOVER = 7         # 揭示
PP_TRANSITION_FLASH = 8           # 闪光
PP_TRANSITION_RANDOM = 9          # 随机
PP_TRANSITION_DISSOLVE = 10       # 溶解
PP_TRANSITION_BLINDS = 11         # 百叶窗
PP_TRANSITION_CHECKERBOARD = 12   # 棋盘
PP_TRANSITION_WHEEL = 40          # 轮盘（不同版本值不同）
PP_TRANSITION_CUT = 1             # 剪切


class PPTController:
    """PowerPoint 控制器"""

    def __init__(self):
        self.ppt = None
        self.presentation = None
        self.slide = None

    def _ensure_ppt_connected(self):
        """确保连接到已运行的 PowerPoint"""
        if self.ppt is not None:
            return True

        try:
            self.ppt = win32com.client.GetActiveObject("PowerPoint.Application")
            debug_print("已连接到运行中的 PowerPoint")

            # 尝试获取当前活动的演示文稿
            try:
                self.presentation = self.ppt.ActivePresentation
                self.slide = self.ppt.ActiveWindow.View.Slide
            except:
                pass  # 可能没有打开的演示文稿

            return True
        except Exception as e:
            debug_print(f"连接 PowerPoint 失败: {e}")
            return False

    def open_ppt(self, visible=True):
        """打开 PowerPoint 应用"""
        if not HAS_WIN32:
            return {"success": False, "error": "pywin32 未安装"}

        try:
            # 尝试获取已有的 PowerPoint 实例
            try:
                self.ppt = win32com.client.GetActiveObject("PowerPoint.Application")
                debug_print("PowerPoint 已在运行")
            except:
                # 如果没有，启动独立的 PowerPoint 进程
                debug_print("启动独立的 PowerPoint 进程...")
                os.system("start powerpnt")

                # 等待并重试连接
                connected = False
                for i in range(5):
                    time.sleep(2)
                    try:
                        self.ppt = win32com.client.GetActiveObject("PowerPoint.Application")
                        connected = True
                        debug_print(f"第{i+1}次尝试连接成功")
                        break
                    except:
                        debug_print(f"第{i+1}次尝试连接失败，继续等待...")
                        continue

                if not connected:
                    return {"success": False, "error": "PowerPoint 启动成功但连接失败，请稍后重试"}

            self.ppt.Visible = visible
            return {"success": True, "message": "PowerPoint 已打开"}
        except Exception as e:
            error_msg = str(e)
            if "2147" in error_msg:
                return {"success": False, "error": "无法连接到 PowerPoint，请确保 PowerPoint 已启动"}
            return {"success": False, "error": f"PowerPoint 操作失败: {error_msg}"}

    def create_new(self):
        """创建新演示文稿"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行，请先打开 PowerPoint"}

        try:
            self.presentation = self.ppt.Presentations.Add()
            self.slide = self.presentation.Slides.Add(1, 1)  # 添加第一张空白幻灯片
            return {"success": True, "message": "新演示文稿已创建", "slide_count": 1}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_slide(self, layout_type="blank"):
        """添加新幻灯片"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.presentation:
            return {"success": False, "error": "没有活动的演示文稿，请先创建或打开演示文稿"}

        try:
            # 幻灯片布局类型映射
            layout_map = {
                "blank": 12,        # 空白
                "title": 1,         # 标题幻灯片
                "title_content": 2, # 标题和内容
                "section_header": 3, # 节标题
                "two_content": 4,   # 两栏内容
                "comparison": 5,    # 比较
                "title_only": 11,   # 仅标题
                "content": 6,       # 内容
                "picture": 8,       # 图片标题
            }
            layout_id = layout_map.get(layout_type, 12)  # 默认空白

            slide_index = self.presentation.Slides.Count + 1
            self.slide = self.presentation.Slides.Add(slide_index, layout_id)
            return {
                "success": True,
                "message": f"已添加第 {slide_index} 张幻灯片",
                "slide_index": slide_index,
                "layout": layout_type
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_slide_title(self, title):
        """设置幻灯片标题"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 尝试找到标题占位符
            try:
                title_shape = self.slide.Shapes.Placeholders(1)  # 标题通常是第一个占位符
                title_shape.TextFrame.TextRange.Text = title
            except:
                # 如果没有标题占位符，创建一个文本框
                left = inches_to_points(0.5)
                top = inches_to_points(0.5)
                width = inches_to_points(9)
                height = inches_to_points(1)
                title_shape = self.slide.Shapes.AddTextbox(1, left, top, width, height)
                title_shape.TextFrame.TextRange.Text = title
                title_shape.TextFrame.TextRange.Font.Size = 36
                title_shape.TextFrame.TextRange.Font.Bold = True

            return {"success": True, "message": f"标题已设置为: {title}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_slide_content(self, content):
        """设置幻灯片内容"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 尝试找到内容占位符
            try:
                content_shape = self.slide.Shapes.Placeholders(2)  # 内容通常是第二个占位符
                content_shape.TextFrame.TextRange.Text = content
            except:
                # 如果没有内容占位符，创建一个文本框
                left = inches_to_points(0.5)
                top = inches_to_points(1.5)
                width = inches_to_points(9)
                height = inches_to_points(5)
                content_shape = self.slide.Shapes.AddTextbox(1, left, top, width, height)
                content_shape.TextFrame.TextRange.Text = content
                content_shape.TextFrame.TextRange.Font.Size = 18

            return {"success": True, "message": f"内容已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_text_box(self, left, top, width, height, text, font_size=18, font_color=None, bold=False):
        """添加文本框"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 将英寸转换为磅值（PPT默认单位）
            left_pt = inches_to_points(left)
            top_pt = inches_to_points(top)
            width_pt = inches_to_points(width)
            height_pt = inches_to_points(height)

            shape = self.slide.Shapes.AddTextbox(1, left_pt, top_pt, width_pt, height_pt)
            shape.TextFrame.TextRange.Text = text
            shape.TextFrame.TextRange.Font.Size = font_size

            if bold:
                shape.TextFrame.TextRange.Font.Bold = True

            if font_color:
                color = self._parse_color(font_color)
                if color:
                    shape.TextFrame.TextRange.Font.Color = color

            return {"success": True, "message": "文本框已添加"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_bullet_list(self, left, top, width, height, items):
        """添加项目符号列表"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            left_pt = inches_to_points(left)
            top_pt = inches_to_points(top)
            width_pt = inches_to_points(width)
            height_pt = inches_to_points(height)

            shape = self.slide.Shapes.AddTextbox(1, left_pt, top_pt, width_pt, height_pt)

            # 设置项目符号列表
            text_range = shape.TextFrame.TextRange
            text_range.Text = "\n".join(items)
            text_range.ParagraphFormat.Bullet.Type = 1  # 项目符号
            text_range.Font.Size = 18

            return {"success": True, "message": f"已添加 {len(items)} 个项目"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_background_color(self, color):
        """设置幻灯片背景颜色"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            ppt_color = self._parse_color(color)
            if ppt_color:
                self.slide.Background.Fill.ForeColor.RGB = ppt_color
                return {"success": True, "message": f"背景颜色已设置为 {color}"}
            return {"success": False, "error": "颜色格式无效"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def go_to_slide(self, slide_index):
        """跳转到指定幻灯片"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.presentation:
            return {"success": False, "error": "没有活动的演示文稿"}

        try:
            if slide_index < 1 or slide_index > self.presentation.Slides.Count:
                return {"success": False, "error": f"幻灯片索引无效，当前有 {self.presentation.Slides.Count} 张"}

            self.slide = self.presentation.Slides(slide_index)
            self.ppt.ActiveWindow.View.GotoSlide(slide_index)
            return {"success": True, "message": f"已跳转到第 {slide_index} 张幻灯片"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def save_file(self, file_path=None):
        """保存文件"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.presentation:
            return {"success": False, "error": "没有活动的演示文稿"}

        try:
            if file_path:
                abs_path = os.path.abspath(file_path)
                self.presentation.SaveAs(abs_path)
                return {"success": True, "message": f"已保存到 {abs_path}", "path": abs_path}
            else:
                self.presentation.Save()
                return {"success": True, "message": "演示文稿已保存"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def load_file(self, file_path):
        """加载演示文稿"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行，请先打开 PowerPoint"}

        try:
            abs_path = os.path.abspath(file_path)
            self.presentation = self.ppt.Presentations.Open(abs_path)
            self.slide = self.presentation.Slides(1)

            return {
                "success": True,
                "message": f"已加载 {abs_path}",
                "slide_count": self.presentation.Slides.Count
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def close_ppt(self, force=False):
        """关闭 PowerPoint"""
        try:
            if force:
                if self.presentation:
                    self.presentation.Close()
                if self.ppt:
                    self.ppt.Quit()
                self.ppt = None
                self.presentation = None
                self.slide = None
                return {"success": True, "message": "PowerPoint 已关闭"}
            else:
                return {"success": True, "message": "PowerPoint 保持运行中，请手动关闭"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _parse_color(self, color_str):
        """解析颜色字符串为 RGB 值"""
        if color_str.startswith("#"):
            hex_color = color_str[1:]
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            # PPT 使用 BGR 格式
            return b * 256 * 256 + g * 256 + r
        return None

    def get_slide_count(self):
        """获取幻灯片数量"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.presentation:
            return {"success": False, "error": "没有活动的演示文稿"}

        return {"success": True, "slide_count": self.presentation.Slides.Count}

    # ===== 高级功能：图片、视频、音频 =====

    def add_image(self, image_path, left, top, width=None, height=None):
        """插入图片"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            abs_path = os.path.abspath(image_path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"图片文件不存在: {abs_path}"}

            left_pt = inches_to_points(left)
            top_pt = inches_to_points(top)

            # 添加图片
            if width and height:
                width_pt = inches_to_points(width)
                height_pt = inches_to_points(height)
                shape = self.slide.Shapes.AddPicture(abs_path, False, True, left_pt, top_pt, width_pt, height_pt)
            else:
                # 使用原始尺寸
                shape = self.slide.Shapes.AddPicture(abs_path, False, True, left_pt, top_pt)

            return {"success": True, "message": f"图片已插入: {abs_path}", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_video(self, video_path, left, top, width=None, height=None, auto_play=True, loop=False, full_screen=False):
        """插入视频"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            abs_path = os.path.abspath(video_path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"视频文件不存在: {abs_path}"}

            left_pt = inches_to_points(left)
            top_pt = inches_to_points(top)

            # 添加视频
            if width and height:
                width_pt = inches_to_points(width)
                height_pt = inches_to_points(height)
                shape = self.slide.Shapes.AddMediaObject2(abs_path, False, False, left_pt, top_pt, width_pt, height_pt)
            else:
                shape = self.slide.Shapes.AddMediaObject2(abs_path, False, False, left_pt, top_pt)

            # 设置播放选项
            try:
                media_format = shape.MediaFormat
                media_format.PlayOnSlideClick = auto_play
                media_format.LoopUntilStopped = loop
                if full_screen:
                    media_format.FullScreen = True
            except:
                pass  # 某些版本可能不支持 MediaFormat

            return {"success": True, "message": f"视频已插入: {abs_path}", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_audio(self, audio_path, auto_play=True, loop=False, hide=True):
        """插入音频"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            abs_path = os.path.abspath(audio_path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"音频文件不存在: {abs_path}"}

            # 音频通常放在角落
            left_pt = inches_to_points(0.5)
            top_pt = inches_to_points(0.5)

            shape = self.slide.Shapes.AddMediaObject2(abs_path, False, False, left_pt, top_pt)

            # 设置播放选项
            try:
                media_format = shape.MediaFormat
                media_format.PlayOnSlideClick = auto_play
                media_format.LoopUntilStopped = loop
                if hide:
                    shape.Visible = False  # 隐藏音频图标
            except:
                pass

            return {"success": True, "message": f"音频已插入: {abs_path}", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：形状绘制 =====

    def add_shape(self, shape_type, left, top, width, height, fill_color=None, line_color=None, line_width=1):
        """绘制形状"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            left_pt = inches_to_points(left)
            top_pt = inches_to_points(top)
            width_pt = inches_to_points(width)
            height_pt = inches_to_points(height)

            # 形状类型映射
            shape_map = {
                "rectangle": MSO_SHAPE_RECTANGLE,
                "round_rectangle": MSO_SHAPE_ROUND_RECTANGLE,
                "oval": MSO_SHAPE_OVAL,
                "ellipse": MSO_SHAPE_ELLIPSE,
                "circle": MSO_SHAPE_OVAL,
                "diamond": MSO_SHAPE_DIAMOND,
                "triangle": MSO_SHAPE_TRIANGLE,
                "right_triangle": MSO_SHAPE_RIGHT_TRIANGLE,
                "star": MSO_SHAPE_STAR_5_POINT,
                "arrow": MSO_SHAPE_ARROW_RIGHT,
                "line": MSO_SHAPE_LINE
            }

            mso_type = shape_map.get(shape_type.lower(), MSO_SHAPE_RECTANGLE)
            shape = self.slide.Shapes.AddShape(mso_type, left_pt, top_pt, width_pt, height_pt)

            # 设置填充颜色
            if fill_color:
                ppt_color = self._parse_color(fill_color)
                if ppt_color:
                    shape.Fill.ForeColor.RGB = ppt_color
                    shape.Fill.Visible = True
            else:
                shape.Fill.Visible = False  # 无填充

            # 设置边框
            if line_color:
                ppt_color = self._parse_color(line_color)
                if ppt_color:
                    shape.Line.ForeColor.RGB = ppt_color
                    shape.Line.Weight = line_width
            else:
                shape.Line.Visible = False

            return {"success": True, "message": f"形状 {shape_type} 已添加", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_line(self, start_x, start_y, end_x, end_y, line_color=None, line_width=1, arrow_type="none"):
        """绘制线条"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            start_x_pt = inches_to_points(start_x)
            start_y_pt = inches_to_points(start_y)
            end_x_pt = inches_to_points(end_x)
            end_y_pt = inches_to_points(end_y)

            shape = self.slide.Shapes.AddLine(start_x_pt, start_y_pt, end_x_pt, end_y_pt)

            # 设置线条颜色
            if line_color:
                ppt_color = self._parse_color(line_color)
                if ppt_color:
                    shape.Line.ForeColor.RGB = ppt_color

            shape.Line.Weight = line_width

            # 设置箭头
            arrow_map = {
                "none": 0,
                "arrow": 1,
                "arrow_both": 2,
                "arrow_start": 3
            }
            shape.Line.BeginArrowheadStyle = arrow_map.get(arrow_type, 0)
            if arrow_type == "arrow" or arrow_type == "arrow_both":
                shape.Line.EndArrowheadStyle = 1

            return {"success": True, "message": "线条已添加", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：动画效果 =====

    def add_animation(self, shape_name, effect_type, trigger="on_click", duration=1.0, delay=0.0, direction="from_left"):
        """添加动画效果"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 查找形状
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            # 动画效果映射（使用正确常量）
            effect_map = {
                "appear": MSO_ANIM_EFFECT_APPEAR,
                "fade": MSO_ANIM_EFFECT_FADE,
                "fly": MSO_ANIM_EFFECT_FLY,
                "blinds": MSO_ANIM_EFFECT_BLINDS,
                "box": MSO_ANIM_EFFECT_BOX,
                "checkerboard": MSO_ANIM_EFFECT_CHECKERBOARD,
                "cover": MSO_ANIM_EFFECT_COVER,
                "dissolve": MSO_ANIM_EFFECT_DISSOLVE,
                "random_bars": MSO_ANIM_EFFECT_RANDOM_BARS,
                "split": MSO_ANIM_EFFECT_SPLIT,
                "strips": MSO_ANIM_EFFECT_STRIPS,
                "wipe": MSO_ANIM_EFFECT_WIPE,
                "random": MSO_ANIM_EFFECT_RANDOM,
                "zoom": MSO_ANIM_EFFECT_ZOOM,
                "expand": MSO_ANIM_EFFECT_EXPAND,
                "push": MSO_ANIM_EFFECT_PUSH,
                "grow": MSO_ANIM_EFFECT_GROW_SHRINK,
                "spin": MSO_ANIM_EFFECT_SPIN,
                "bounce": MSO_ANIM_EFFECT_BOUNCE,
                "wheel": MSO_ANIM_EFFECT_WHEEL
            }

            mso_effect = effect_map.get(effect_type.lower(), MSO_ANIM_EFFECT_FADE)

            # 获取时间线
            timeline = self.slide.TimeLine
            main_sequence = timeline.MainSequence

            # 添加动画效果
            effect = main_sequence.AddEffect(target_shape, mso_effect, trigger)

            # 设置触发方式
            trigger_map = {
                "on_click": MSO_ANIM_TRIGGER_ON_CLICK,
                "after_previous": MSO_ANIM_TRIGGER_AFTER_PREVIOUS,
                "with_previous": MSO_ANIM_TRIGGER_WITH_PREVIOUS
            }
            effect.TriggerType = trigger_map.get(trigger.lower(), MSO_ANIM_TRIGGER_ON_CLICK)

            # 设置持续时间
            effect.Timing.Duration = duration

            # 设置延迟
            if delay > 0:
                effect.Timing.TriggerDelayTime = delay

            # 设置方向（对于飞入等动画）
            try:
                direction_map = {
                    "from_left": 0,
                    "from_top": 1,
                    "from_right": 2,
                    "from_bottom": 3,
                    "from_center": 4
                }
                effect.EffectParameters.Direction = direction_map.get(direction.lower(), 0)
            except:
                pass  # 某些动画不支持方向

            return {"success": True, "message": f"动画 {effect_type} 已添加到 {shape_name}", "effect_index": effect.Index}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_motion_path(self, shape_name, path_type="line", points=None, duration=2.0, trigger="after_previous"):
        """添加动作路径动画"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 查找形状
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            timeline = self.slide.TimeLine
            main_sequence = timeline.MainSequence

            # 路径动画使用 msoAnimEffectPath*
            # 常用路径类型
            path_effect_map = {
                "line": 1,      # 直线
                "arc": 2,       # 弧线
                "circle": 3,    # 圆形
                "figure_8": 4,  # 8字形
                "zigzag": 5     # 锯齿形
            }

            # 添加路径动画 (使用 AddEffect 方法，effect 类型需要特定值)
            # msoAnimEffectPathRight = 1001 等
            effect = main_sequence.AddEffect(target_shape, 1001)  # 临时使用路径右

            trigger_map = {
                "on_click": MSO_ANIM_TRIGGER_ON_CLICK,
                "after_previous": MSO_ANIM_TRIGGER_AFTER_PREVIOUS,
                "with_previous": MSO_ANIM_TRIGGER_WITH_PREVIOUS
            }
            effect.TriggerType = trigger_map.get(trigger.lower(), MSO_ANIM_TRIGGER_AFTER_PREVIOUS)
            effect.Timing.Duration = duration

            return {"success": True, "message": f"路径动画已添加到 {shape_name}", "effect_index": effect.Index}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_animation_timing(self, effect_index, duration=None, delay=None, repeat_count=None, auto_reverse=None):
        """设置动画时间参数"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            timeline = self.slide.TimeLine
            main_sequence = timeline.MainSequence

            if effect_index < 1 or effect_index > main_sequence.Count:
                return {"success": False, "error": f"动画索引无效"}

            effect = main_sequence.Item(effect_index)
            timing = effect.Timing

            if duration is not None:
                timing.Duration = duration
            if delay is not None:
                timing.TriggerDelayTime = delay
            if repeat_count is not None:
                timing.RepeatCount = repeat_count
            if auto_reverse is not None:
                timing.AutoReverse = auto_reverse

            return {"success": True, "message": f"动画 {effect_index} 时间参数已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：幻灯片切换动画 =====

    def set_transition(self, transition_type, duration=1.0, manual=True, auto_advance=False, advance_time=0):
        """设置幻灯片切换效果"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 切换效果映射（使用正确常量）
            trans_map = {
                "none": PP_TRANSITION_NONE,
                "fade": PP_TRANSITION_FADE,
                "push": PP_TRANSITION_PUSH,
                "wipe": PP_TRANSITION_WIPE,
                "split": PP_TRANSITION_SPLIT,
                "cover": PP_TRANSITION_COVER,
                "uncover": PP_TRANSITION_UNCOVER,
                "flash": PP_TRANSITION_FLASH,
                "random": PP_TRANSITION_RANDOM,
                "dissolve": PP_TRANSITION_DISSOLVE,
                "blinds": PP_TRANSITION_BLINDS,
                "checkerboard": PP_TRANSITION_CHECKERBOARD,
                "cut": PP_TRANSITION_CUT,
                "wheel": PP_TRANSITION_WHEEL
            }

            pp_trans = trans_map.get(transition_type.lower(), PP_TRANSITION_NONE)

            # 设置切换效果
            self.slide.SlideShowTransition.EntryEffect = pp_trans
            self.slide.SlideShowTransition.Duration = duration

            # 设置推进方式
            if manual:
                self.slide.SlideShowTransition.AdvanceOnClick = True
            if auto_advance and advance_time > 0:
                self.slide.SlideShowTransition.AdvanceOnTime = True
                self.slide.SlideShowTransition.AdvanceTime = advance_time

            return {"success": True, "message": f"切换效果 {transition_type} 已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_transition_sound(self, sound_path=None, loop=False):
        """设置切换音效"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            transition = self.slide.SlideShowTransition

            if sound_path:
                abs_path = os.path.abspath(sound_path)
                if not os.path.exists(abs_path):
                    return {"success": False, "error": f"音效文件不存在"}
                transition.SoundEffect.ImportFromFile(abs_path)
            if loop:
                transition.SoundEffect.LoopUntilStopped = True

            return {"success": True, "message": "切换音效已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：样式设置 =====

    def set_font_style(self, shape_name, font_size=None, font_color=None, font_name=None, bold=None, italic=None, underline=None):
        """设置文本字体样式"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            # 查找形状
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            # 检查是否有文本
            if not target_shape.HasTextFrame:
                return {"success": False, "error": "该形状没有文本框"}

            text_range = target_shape.TextFrame.TextRange

            if font_size is not None:
                text_range.Font.Size = font_size
            if font_color is not None:
                ppt_color = self._parse_color(font_color)
                if ppt_color:
                    text_range.Font.Color.RGB = ppt_color
            if font_name is not None:
                text_range.Font.Name = font_name
            if bold is not None:
                text_range.Font.Bold = bold
            if italic is not None:
                text_range.Font.Italic = italic
            if underline is not None:
                text_range.Font.Underline = underline

            return {"success": True, "message": f"字体样式已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_element_position(self, shape_name, left=None, top=None):
        """设置元素位置"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            if left is not None:
                target_shape.Left = inches_to_points(left)
            if top is not None:
                target_shape.Top = inches_to_points(top)

            return {"success": True, "message": f"位置已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_element_size(self, shape_name, width=None, height=None):
        """设置元素大小"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            if width is not None:
                target_shape.Width = inches_to_points(width)
            if height is not None:
                target_shape.Height = inches_to_points(height)

            return {"success": True, "message": f"大小已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_element_rotation(self, shape_name, angle):
        """设置元素旋转角度"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            target_shape.Rotation = angle

            return {"success": True, "message": f"旋转角度设置为 {angle} 度"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_gradient_background(self, color1, color2, direction="horizontal"):
        """设置渐变背景"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            ppt_color1 = self._parse_color(color1)
            ppt_color2 = self._parse_color(color2)

            fill = self.slide.Background.Fill
            fill.TwoColorGradient(1, 1)  # msoGradientHorizontal

            fill.ForeColor.RGB = ppt_color1
            fill.BackColor.RGB = ppt_color2

            # 方向设置
            direction_map = {
                "horizontal": 1,
                "vertical": 2,
                "diagonal_up": 3,
                "diagonal_down": 4,
                "from_center": 5,
                "from_corner": 6
            }
            gradient_style = direction_map.get(direction.lower(), 1)
            fill.TwoColorGradient(gradient_style, 1)

            return {"success": True, "message": f"渐变背景已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_shape_fill(self, shape_name, fill_type="solid", color=None, transparency=0, gradient_color2=None, gradient_direction="horizontal"):
        """设置形状填充"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            fill = target_shape.Fill

            if fill_type == "solid":
                fill.Solid()
                if color:
                    ppt_color = self._parse_color(color)
                    fill.ForeColor.RGB = ppt_color
                if transparency > 0:
                    fill.Transparency = transparency
            elif fill_type == "gradient":
                ppt_color1 = self._parse_color(color)
                ppt_color2 = self._parse_color(gradient_color2) if gradient_color2 else ppt_color1
                fill.TwoColorGradient(1, 1)
                fill.ForeColor.RGB = ppt_color1
                fill.BackColor.RGB = ppt_color2
            elif fill_type == "none":
                fill.Visible = False

            return {"success": True, "message": f"填充已设置"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：超链接和交互 =====

    def add_hyperlink(self, shape_name, link_type="url", target=None, tooltip=None):
        """添加超链接"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            action_setting = target_shape.ActionSettings(1)  # ppMouseClick

            if link_type == "url" and target:
                action_setting.Hyperlink.Address = target
            elif link_type == "slide" and target:
                # 链接到其他幻灯片
                action_setting.Hyperlink.SubAddress = target
            elif link_type == "first_slide":
                action_setting.Hyperlink.SubAddress = "1"
            elif link_type == "last_slide":
                action_setting.Hyperlink.SubAddress = str(self.presentation.Slides.Count)
            elif link_type == "next_slide":
                action_setting.Hyperlink.SubAddress = str(self.slide.SlideIndex + 1) if self.slide.SlideIndex < self.presentation.Slides.Count else "1"
            elif link_type == "previous_slide":
                action_setting.Hyperlink.SubAddress = str(self.slide.SlideIndex - 1) if self.slide.SlideIndex > 1 else str(self.presentation.Slides.Count)

            if tooltip:
                action_setting.Hyperlink.ScreenTip = tooltip

            return {"success": True, "message": f"超链接已添加"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_click_action(self, shape_name, action_type="run_macro", macro_name=None, action_value=None):
        """添加点击动作"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            action_setting = target_shape.ActionSettings(1)

            if action_type == "run_program" and action_value:
                action_setting.Run = action_value
            elif action_type == "run_macro" and macro_name:
                action_setting.Run = macro_name

            return {"success": True, "message": f"点击动作已添加"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：图表 =====

    def add_chart(self, chart_type="column", left=1, top=1.5, width=8, height=5, data=None):
        """插入图表"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            left_pt = inches_to_points(left)
            top_pt = inches_to_points(top)
            width_pt = inches_to_points(width)
            height_pt = inches_to_points(height)

            # 图表类型映射
            chart_type_map = {
                "column": 1,      # xlColumnClustered
                "bar": 2,         # xlBarClustered
                "line": 4,        # xlLine
                "pie": 5,         # xlPie
                "scatter": 72,    # xlXYScatter
                "area": 29,       # xlArea
                "doughnut": 80,   # xlDoughnut
            }

            xl_chart_type = chart_type_map.get(chart_type.lower(), 1)

            shape = self.slide.Shapes.AddChart(xl_chart_type, left_pt, top_pt, width_pt, height_pt)
            chart = shape.Chart

            # 如果有数据，设置图表数据
            if data:
                chart_data = chart.ChartData
                workbook = chart_data.Workbook
                worksheet = workbook.Worksheets(1)

                # 写入数据
                if isinstance(data, dict) and "values" in data:
                    values = data["values"]
                    categories = data.get("categories", [])
                    series_name = data.get("series_name", "Series 1")

                    # 清除默认数据
                    worksheet.UsedRange.Clear()

                    # 写入类别
                    if categories:
                        for i, cat in enumerate(categories):
                            worksheet.Cells(i + 2, 1).Value = cat

                    # 写入值
                    for i, val in enumerate(values):
                        worksheet.Cells(i + 2, 2).Value = val

                    worksheet.Cells(1, 2).Value = series_name

            return {"success": True, "message": f"图表 {chart_type} 已添加", "shape_name": shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ===== 高级功能：对齐和排列 =====

    def align_elements(self, align_type="left", shapes=None):
        """对齐多个元素"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            if not shapes:
                return {"success": False, "error": "未指定要对齐的形状"}

            # 查找所有目标形状
            target_shapes = []
            for shape_name in shapes:
                for shape in self.slide.Shapes:
                    if shape.Name == shape_name:
                        target_shapes.append(shape)
                        break

            if len(target_shapes) < 2:
                return {"success": False, "error": "需要至少2个形状进行对齐"}

            # 计算对齐位置
            if align_type == "left":
                min_left = min(s.Left for s in target_shapes)
                for s in target_shapes:
                    s.Left = min_left
            elif align_type == "right":
                max_right = max(s.Left + s.Width for s in target_shapes)
                for s in target_shapes:
                    s.Left = max_right - s.Width
            elif align_type == "top":
                min_top = min(s.Top for s in target_shapes)
                for s in target_shapes:
                    s.Top = min_top
            elif align_type == "bottom":
                max_bottom = max(s.Top + s.Height for s in target_shapes)
                for s in target_shapes:
                    s.Top = max_bottom - s.Height
            elif align_type == "center":
                avg_center = sum(s.Left + s.Width/2 for s in target_shapes) / len(target_shapes)
                for s in target_shapes:
                    s.Left = avg_center - s.Width/2
            elif align_type == "middle":
                avg_middle = sum(s.Top + s.Height/2 for s in target_shapes) / len(target_shapes)
                for s in target_shapes:
                    s.Top = avg_middle - s.Height/2

            return {"success": True, "message": f"已对齐 {len(target_shapes)} 个元素"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def distribute_elements(self, distribute_type="horizontal", shapes=None):
        """均匀分布元素"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            if not shapes:
                return {"success": False, "error": "未指定要分布的形状"}

            target_shapes = []
            for shape_name in shapes:
                for shape in self.slide.Shapes:
                    if shape.Name == shape_name:
                        target_shapes.append(shape)
                        break

            if len(target_shapes) < 3:
                return {"success": False, "error": "需要至少3个形状进行分布"}

            if distribute_type == "horizontal":
                sorted_shapes = sorted(target_shapes, key=lambda s: s.Left)
                total_width = sum(s.Width for s in sorted_shapes)
                total_space = (sorted_shapes[-1].Left + sorted_shapes[-1].Width) - sorted_shapes[0].Left
                spacing = (total_space - total_width) / (len(sorted_shapes) - 1)

                current_left = sorted_shapes[0].Left
                for s in sorted_shapes:
                    s.Left = current_left
                    current_left += s.Width + spacing

            elif distribute_type == "vertical":
                sorted_shapes = sorted(target_shapes, key=lambda s: s.Top)
                total_height = sum(s.Height for s in sorted_shapes)
                total_space = (sorted_shapes[-1].Top + sorted_shapes[-1].Height) - sorted_shapes[0].Top
                spacing = (total_space - total_height) / (len(sorted_shapes) - 1)

                current_top = sorted_shapes[0].Top
                for s in sorted_shapes:
                    s.Top = current_top
                    current_top += s.Height + spacing

            return {"success": True, "message": f"已分布 {len(target_shapes)} 个元素"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def group_shapes(self, shape_names):
        """组合多个形状"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shapes = []
            for shape_name in shape_names:
                for shape in self.slide.Shapes:
                    if shape.Name == shape_name:
                        target_shapes.append(shape)
                        break

            if len(target_shapes) < 2:
                return {"success": False, "error": "需要至少2个形状进行组合"}

            # 组合形状
            shape_range = self.slide.Shapes.Range([s.Name for s in target_shapes])
            group = shape_range.Group()

            return {"success": True, "message": f"已组合 {len(target_shapes)} 个形状", "group_name": group.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def duplicate_shape(self, shape_name, offset_x=0, offset_y=0):
        """复制形状"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            new_shape = target_shape.Duplicate()

            # 移动偏移
            new_shape.Left = target_shape.Left + inches_to_points(offset_x)
            new_shape.Top = target_shape.Top + inches_to_points(offset_y)

            return {"success": True, "message": f"形状已复制", "new_shape_name": new_shape.Name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_shape(self, shape_name):
        """删除形状"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            target_shape.Delete()

            return {"success": True, "message": f"形状 {shape_name} 已删除"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def rename_shape(self, old_name, new_name):
        """重命名形状"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == old_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {old_name}"}

            target_shape.Name = new_name

            return {"success": True, "message": f"形状已重命名为 {new_name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_shape_info(self, shape_name):
        """获取形状信息"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            target_shape = None
            for shape in self.slide.Shapes:
                if shape.Name == shape_name:
                    target_shape = shape
                    break

            if not target_shape:
                return {"success": False, "error": f"未找到形状: {shape_name}"}

            info = {
                "name": target_shape.Name,
                "type": target_shape.Type,
                "left": target_shape.Left / 72,  # 转换为英寸
                "top": target_shape.Top / 72,
                "width": target_shape.Width / 72,
                "height": target_shape.Height / 72,
                "rotation": target_shape.Rotation
            }

            return {"success": True, "shape_info": info}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def list_shapes(self):
        """列出当前幻灯片所有形状"""
        if not self._ensure_ppt_connected():
            return {"success": False, "error": "PowerPoint 未运行"}

        if not self.slide:
            return {"success": False, "error": "没有活动的幻灯片"}

        try:
            shapes = []
            for shape in self.slide.Shapes:
                shapes.append({
                    "name": shape.Name,
                    "type": shape.Type,
                    "left": shape.Left / 72,
                    "top": shape.Top / 72,
                    "width": shape.Width / 72,
                    "height": shape.Height / 72
                })

            return {"success": True, "shapes": shapes, "count": len(shapes)}
        except Exception as e:
            return {"success": False, "error": str(e)}


# 全局控制器实例
_controller = None


def get_controller():
    """获取控制器实例"""
    global _controller
    if _controller is None:
        _controller = PPTController()
    return _controller


def execute_command(action, args):
    """执行命令"""
    ctrl = get_controller()

    result = {"success": False, "error": "未知命令"}

    if action == "open_ppt":
        result = ctrl.open_ppt(args.get("visible", True))

    elif action == "create_new":
        result = ctrl.create_new()

    elif action == "add_slide":
        result = ctrl.add_slide(args.get("layout_type", "blank"))

    elif action == "set_slide_title":
        result = ctrl.set_slide_title(args.get("title", ""))

    elif action == "set_slide_content":
        result = ctrl.set_slide_content(args.get("content", ""))

    elif action == "add_text_box":
        result = ctrl.add_text_box(
            args.get("left", 0.5),
            args.get("top", 1.5),
            args.get("width", 9),
            args.get("height", 5),
            args.get("text", ""),
            args.get("font_size", 18),
            args.get("font_color"),
            args.get("bold", False)
        )

    elif action == "add_bullet_list":
        result = ctrl.add_bullet_list(
            args.get("left", 0.5),
            args.get("top", 1.5),
            args.get("width", 9),
            args.get("height", 5),
            args.get("items", [])
        )

    elif action == "set_background_color":
        result = ctrl.set_background_color(args.get("color", "#ffffff"))

    elif action == "go_to_slide":
        result = ctrl.go_to_slide(args.get("slide_index", 1))

    elif action == "save_file":
        result = ctrl.save_file(args.get("file_path"))

    elif action == "load_file":
        result = ctrl.load_file(args.get("file_path"))

    elif action == "close_ppt":
        result = ctrl.close_ppt(args.get("force", False))

    elif action == "get_slide_count":
        result = ctrl.get_slide_count()

    # ===== 高级功能命令 =====
    elif action == "add_image":
        result = ctrl.add_image(
            args.get("image_path"),
            args.get("left", 0),
            args.get("top", 0),
            args.get("width"),
            args.get("height")
        )

    elif action == "add_video":
        result = ctrl.add_video(
            args.get("video_path"),
            args.get("left", 0),
            args.get("top", 0),
            args.get("width"),
            args.get("height"),
            args.get("auto_play", True),
            args.get("loop", False),
            args.get("full_screen", False)
        )

    elif action == "add_audio":
        result = ctrl.add_audio(
            args.get("audio_path"),
            args.get("auto_play", True),
            args.get("loop", False),
            args.get("hide", True)
        )

    elif action == "add_shape":
        result = ctrl.add_shape(
            args.get("shape_type", "rectangle"),
            args.get("left", 0),
            args.get("top", 0),
            args.get("width", 1),
            args.get("height", 1),
            args.get("fill_color"),
            args.get("line_color"),
            args.get("line_width", 1)
        )

    elif action == "add_line":
        result = ctrl.add_line(
            args.get("start_x", 0),
            args.get("start_y", 0),
            args.get("end_x", 1),
            args.get("end_y", 1),
            args.get("line_color"),
            args.get("line_width", 1),
            args.get("arrow_type", "none")
        )

    elif action == "add_animation":
        result = ctrl.add_animation(
            args.get("shape_name"),
            args.get("effect_type", "fade"),
            args.get("trigger", "on_click"),
            args.get("duration", 1.0),
            args.get("delay", 0.0),
            args.get("direction", "from_left")
        )

    elif action == "add_motion_path":
        result = ctrl.add_motion_path(
            args.get("shape_name"),
            args.get("path_type", "line"),
            args.get("points"),
            args.get("duration", 2.0),
            args.get("trigger", "after_previous")
        )

    elif action == "set_animation_timing":
        result = ctrl.set_animation_timing(
            args.get("effect_index"),
            args.get("duration"),
            args.get("delay"),
            args.get("repeat_count"),
            args.get("auto_reverse")
        )

    elif action == "set_transition":
        result = ctrl.set_transition(
            args.get("transition_type", "fade"),
            args.get("duration", 1.0),
            args.get("manual", True),
            args.get("auto_advance", False),
            args.get("advance_time", 0)
        )

    elif action == "set_transition_sound":
        result = ctrl.set_transition_sound(
            args.get("sound_path"),
            args.get("loop", False)
        )

    elif action == "set_font_style":
        result = ctrl.set_font_style(
            args.get("shape_name"),
            args.get("font_size"),
            args.get("font_color"),
            args.get("font_name"),
            args.get("bold"),
            args.get("italic"),
            args.get("underline")
        )

    elif action == "set_element_position":
        result = ctrl.set_element_position(
            args.get("shape_name"),
            args.get("left"),
            args.get("top")
        )

    elif action == "set_element_size":
        result = ctrl.set_element_size(
            args.get("shape_name"),
            args.get("width"),
            args.get("height")
        )

    elif action == "set_element_rotation":
        result = ctrl.set_element_rotation(
            args.get("shape_name"),
            args.get("angle", 0)
        )

    elif action == "set_gradient_background":
        result = ctrl.set_gradient_background(
            args.get("color1"),
            args.get("color2"),
            args.get("direction", "horizontal")
        )

    elif action == "set_shape_fill":
        result = ctrl.set_shape_fill(
            args.get("shape_name"),
            args.get("fill_type", "solid"),
            args.get("color"),
            args.get("transparency", 0),
            args.get("gradient_color2"),
            args.get("gradient_direction", "horizontal")
        )

    elif action == "add_hyperlink":
        result = ctrl.add_hyperlink(
            args.get("shape_name"),
            args.get("link_type", "url"),
            args.get("target"),
            args.get("tooltip")
        )

    elif action == "add_click_action":
        result = ctrl.add_click_action(
            args.get("shape_name"),
            args.get("action_type", "run_macro"),
            args.get("macro_name"),
            args.get("action_value")
        )

    elif action == "add_chart":
        result = ctrl.add_chart(
            args.get("chart_type", "column"),
            args.get("left", 1),
            args.get("top", 1.5),
            args.get("width", 8),
            args.get("height", 5),
            args.get("data")
        )

    elif action == "align_elements":
        result = ctrl.align_elements(
            args.get("align_type", "left"),
            args.get("shapes")
        )

    elif action == "distribute_elements":
        result = ctrl.distribute_elements(
            args.get("distribute_type", "horizontal"),
            args.get("shapes")
        )

    elif action == "group_shapes":
        result = ctrl.group_shapes(args.get("shape_names"))

    elif action == "duplicate_shape":
        result = ctrl.duplicate_shape(
            args.get("shape_name"),
            args.get("offset_x", 0),
            args.get("offset_y", 0)
        )

    elif action == "delete_shape":
        result = ctrl.delete_shape(args.get("shape_name"))

    elif action == "rename_shape":
        result = ctrl.rename_shape(
            args.get("old_name"),
            args.get("new_name")
        )

    elif action == "get_shape_info":
        result = ctrl.get_shape_info(args.get("shape_name"))

    elif action == "list_shapes":
        result = ctrl.list_shapes()

    elif action == "run_script":
        # 执行用户提供的脚本代码
        script_code = args.get("script", "")
        delay = args.get("delay", 0.3)

        if not script_code:
            result = {"success": False, "error": "脚本代码为空"}
        else:
            try:
                # 创建执行环境
                import io
                from contextlib import redirect_stdout, redirect_stderr

                # 准备执行环境 - 提供所有控制器方法和常量
                exec_globals = {
                    'time': time,
                    'os': os,
                    'HAS_WIN32': HAS_WIN32,
                    'win32com': win32com.client if HAS_WIN32 else None,
                    'inches_to_points': inches_to_points,
                    'INCHES_TO_POINTS': INCHES_TO_POINTS,
                    'get_controller': get_controller,
                    'PPTController': PPTController,
                    # 幻灯片布局常量
                    'PP_LAYOUT_BLANK': PP_LAYOUT_BLANK,
                    'PP_LAYOUT_TITLE': PP_LAYOUT_TITLE,
                    'PP_LAYOUT_TITLE_CONTENT': PP_LAYOUT_TITLE_CONTENT,
                    'PP_LAYOUT_SECTION_HEADER': PP_LAYOUT_SECTION_HEADER,
                    'PP_LAYOUT_TWO_CONTENT': PP_LAYOUT_TWO_CONTENT,
                    'PP_LAYOUT_TITLE_ONLY': PP_LAYOUT_TITLE_ONLY,
                    # 形状常量
                    'MSO_SHAPE_RECTANGLE': MSO_SHAPE_RECTANGLE,
                    'MSO_SHAPE_ROUND_RECTANGLE': MSO_SHAPE_ROUND_RECTANGLE,
                    'MSO_SHAPE_OVAL': MSO_SHAPE_OVAL,
                    'MSO_SHAPE_DIAMOND': MSO_SHAPE_DIAMOND,
                    'MSO_SHAPE_TRIANGLE': MSO_SHAPE_TRIANGLE,
                    'MSO_SHAPE_STAR_5_POINT': MSO_SHAPE_STAR_5_POINT,
                    'MSO_SHAPE_ARROW_RIGHT': MSO_SHAPE_ARROW_RIGHT,
                    # 动画效果常量
                    'MSO_ANIM_EFFECT_APPEAR': MSO_ANIM_EFFECT_APPEAR,
                    'MSO_ANIM_EFFECT_FADE': MSO_ANIM_EFFECT_FADE,
                    'MSO_ANIM_EFFECT_FLY': MSO_ANIM_EFFECT_FLY,
                    'MSO_ANIM_EFFECT_ZOOM': MSO_ANIM_EFFECT_ZOOM,
                    'MSO_ANIM_EFFECT_WIPE': MSO_ANIM_EFFECT_WIPE,
                    'MSO_ANIM_EFFECT_PUSH': MSO_ANIM_EFFECT_PUSH,
                    'MSO_ANIM_EFFECT_DISSOLVE': MSO_ANIM_EFFECT_DISSOLVE,
                    'MSO_ANIM_EFFECT_SPLIT': MSO_ANIM_EFFECT_SPLIT,
                    'MSO_ANIM_EFFECT_BLINDS': MSO_ANIM_EFFECT_BLINDS,
                    'MSO_ANIM_EFFECT_BOX': MSO_ANIM_EFFECT_BOX,
                    'MSO_ANIM_EFFECT_CHECKERBOARD': MSO_ANIM_EFFECT_CHECKERBOARD,
                    'MSO_ANIM_EFFECT_COVER': MSO_ANIM_EFFECT_COVER,
                    'MSO_ANIM_EFFECT_GROW_SHRINK': MSO_ANIM_EFFECT_GROW_SHRINK,
                    'MSO_ANIM_EFFECT_SPIN': MSO_ANIM_EFFECT_SPIN,
                    'MSO_ANIM_EFFECT_BOUNCE': MSO_ANIM_EFFECT_BOUNCE,
                    'MSO_ANIM_EFFECT_WHEEL': MSO_ANIM_EFFECT_WHEEL,
                    'MSO_ANIM_EFFECT_EXPAND': MSO_ANIM_EFFECT_EXPAND,
                    # 动画触发常量
                    'MSO_ANIM_TRIGGER_ON_CLICK': MSO_ANIM_TRIGGER_ON_CLICK,
                    'MSO_ANIM_TRIGGER_AFTER_PREVIOUS': MSO_ANIM_TRIGGER_AFTER_PREVIOUS,
                    'MSO_ANIM_TRIGGER_WITH_PREVIOUS': MSO_ANIM_TRIGGER_WITH_PREVIOUS,
                    # 切换效果常量
                    'PP_TRANSITION_NONE': PP_TRANSITION_NONE,
                    'PP_TRANSITION_FADE': PP_TRANSITION_FADE,
                    'PP_TRANSITION_PUSH': PP_TRANSITION_PUSH,
                    'PP_TRANSITION_WIPE': PP_TRANSITION_WIPE,
                    'PP_TRANSITION_SPLIT': PP_TRANSITION_SPLIT,
                    'PP_TRANSITION_COVER': PP_TRANSITION_COVER,
                    'PP_TRANSITION_DISSOLVE': PP_TRANSITION_DISSOLVE,
                    'PP_TRANSITION_BLINDS': PP_TRANSITION_BLINDS,
                    'PP_TRANSITION_WHEEL': PP_TRANSITION_WHEEL,
                    'PP_TRANSITION_CUT': PP_TRANSITION_CUT,
                    'PP_TRANSITION_RANDOM': PP_TRANSITION_RANDOM,
                    # 内置延迟变量
                    'step_delay': delay,
                    # 当前控制器实例
                    'ctrl': ctrl
                }

                # 添加便捷函数（简化的调用方式）
                def ppt_open(visible=True):
                    r = ctrl.open_ppt(visible)
                    time.sleep(delay)
                    return r

                def ppt_create():
                    r = ctrl.create_new()
                    time.sleep(delay)
                    return r

                def ppt_add_slide(layout_type='blank'):
                    r = ctrl.add_slide(layout_type)
                    time.sleep(delay)
                    return r

                def ppt_goto_slide(index):
                    r = ctrl.go_to_slide(index)
                    time.sleep(delay * 0.5)  # 切换页面延迟较短
                    return r

                def ppt_set_title(title):
                    r = ctrl.set_slide_title(title)
                    time.sleep(delay)
                    return r

                def ppt_set_content(content):
                    r = ctrl.set_slide_content(content)
                    time.sleep(delay)
                    return r

                def ppt_add_text_box(left, top, width, height, text, font_size=18, font_color=None, bold=False):
                    r = ctrl.add_text_box(left, top, width, height, text, font_size, font_color, bold)
                    time.sleep(delay)
                    return r

                def ppt_add_shape(shape_type, left, top, width, height, fill_color=None, line_color=None, line_width=1):
                    r = ctrl.add_shape(shape_type, left, top, width, height, fill_color, line_color, line_width)
                    time.sleep(delay)
                    return r

                def ppt_add_image(image_path, left, top, width=None, height=None):
                    r = ctrl.add_image(image_path, left, top, width, height)
                    time.sleep(delay)
                    return r

                def ppt_add_video(video_path, left, top, width=None, height=None, auto_play=True, loop=False, full_screen=False):
                    r = ctrl.add_video(video_path, left, top, width, height, auto_play, loop, full_screen)
                    time.sleep(delay)
                    return r

                def ppt_add_animation(shape_name, effect_type, trigger='on_click', duration=1.0, delay_time=0.0, direction='from_left'):
                    r = ctrl.add_animation(shape_name, effect_type, trigger, duration, delay_time, direction)
                    time.sleep(delay * 0.5)
                    return r

                def ppt_set_transition(transition_type, duration=1.0):
                    r = ctrl.set_transition(transition_type, duration)
                    time.sleep(delay * 0.5)
                    return r

                def ppt_set_bg_color(color):
                    r = ctrl.set_background_color(color)
                    time.sleep(delay * 0.5)
                    return r

                def ppt_save(file_path=None):
                    r = ctrl.save_file(file_path)
                    return r

                def ppt_close():
                    r = ctrl.close_ppt()
                    return r

                def ppt_list_shapes():
                    return ctrl.list_shapes()

                def delay_step():
                    time.sleep(delay)

                # 将便捷函数添加到执行环境
                exec_globals['ppt_open'] = ppt_open
                exec_globals['ppt_create'] = ppt_create
                exec_globals['ppt_add_slide'] = ppt_add_slide
                exec_globals['ppt_goto_slide'] = ppt_goto_slide
                exec_globals['ppt_set_title'] = ppt_set_title
                exec_globals['ppt_set_content'] = ppt_set_content
                exec_globals['ppt_add_text_box'] = ppt_add_text_box
                exec_globals['ppt_add_shape'] = ppt_add_shape
                exec_globals['ppt_add_image'] = ppt_add_image
                exec_globals['ppt_add_video'] = ppt_add_video
                exec_globals['ppt_add_animation'] = ppt_add_animation
                exec_globals['ppt_set_transition'] = ppt_set_transition
                exec_globals['ppt_set_bg_color'] = ppt_set_bg_color
                exec_globals['ppt_save'] = ppt_save
                exec_globals['ppt_close'] = ppt_close
                exec_globals['ppt_list_shapes'] = ppt_list_shapes
                exec_globals['delay_step'] = delay_step

                # 执行脚本
                stdout_capture = io.StringIO()
                stderr_capture = io.StringIO()

                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    exec(script_code, exec_globals)

                result = {
                    "success": True,
                    "message": "脚本执行完成",
                    "stdout": stdout_capture.getvalue(),
                    "stderr": stderr_capture.getvalue()
                }
            except Exception as e:
                import traceback
                result = {
                    "success": False,
                    "error": str(e),
                    "traceback": traceback.format_exc()
                }

    return result


# 主入口
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "缺少命令参数"}))
        sys.exit(1)

    try:
        command_json = sys.argv[1]
        command = json.loads(command_json)

        action = command.get("action")
        args = command.get("args", {})

        result = execute_command(action, args)
        print(json.dumps(result, ensure_ascii=False))

    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"JSON 解析错误: {str(e)}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))